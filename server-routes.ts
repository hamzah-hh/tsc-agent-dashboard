import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { adminAuth, adminDb } from './server-firebase-admin';
import { loadEnv } from './server-env';
import {
  clearTestData,
  ensureSeedData,
  processImport,
  rebuildLeaderboards,
  saveAiText,
} from './server-import';
import { buildReadiness } from './server-readiness';
import { generateAiText, isAiConfigured, runBatchAiGeneration } from './server-ai';
import { normalizeEmail } from './src/shared/incentive';
import { AgentRecord, AppConfig, Cycle } from './src/shared/types';

/**
 * The whole HTTP API, in one place. server.ts (published app) and vite-api-plugin.ts (development
 * server) both mount this same app, so the two can never drift apart again.
 */

export type Role = 'superAdmin' | 'manager' | 'tl' | 'agent';

export type TokenVerifier = (
  token: string
) => Promise<{ email?: string; email_verified?: boolean; name?: string }>;

export interface ApiOptions {
  /** Checks a Firebase ID token. Defaults to Firebase Admin. Automated tests pass a fake one. */
  verifyIdToken?: TokenVerifier;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Identity {
  role: Role;
  /** access/{email}: only for TL and agent accounts */
  access?: { role: 'tl' | 'agent'; officialEmail?: string; name?: string; location?: string; isTest?: boolean };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function includesEmail(list: string[] | undefined, email: string): boolean {
  return (list || []).map(normalizeEmail).includes(email);
}

function sameSecret(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanEmailList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be a list of email addresses`);
  const out: string[] = [];
  for (const item of value) {
    const email = normalizeEmail(item);
    if (!email) continue;
    if (!EMAIL_RE.test(email)) throw new HttpError(400, `"${item}" is not a valid email address`);
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** The parts of config/app that any signed-in user may know. The email lists are never included. */
function publicConfig(appConfig: AppConfig) {
  return {
    activeCycleId: appConfig.activeCycleId,
    testMode: Boolean(appConfig.testMode),
    aiEnabled: Boolean(appConfig.aiEnabled),
  };
}

export function createApiApp(options: ApiOptions = {}): express.Express {
  loadEnv();
  const api = express();
  api.disable('x-powered-by');

  const verify: TokenVerifier = options.verifyIdToken ?? ((t) => adminAuth.verifyIdToken(t));

  // JSON bodies (a sync sends the whole sheet), and never cache API answers
  api.use('/api', express.json({ limit: '50mb' }));
  api.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  // ------------------------------------------------------------------ helpers

  /** Checks the Firebase ID token and returns the verified login email. */
  async function authenticate(req: Request): Promise<{ email: string; name: string }> {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new HttpError(401, 'Unauthorized: Missing or invalid Authorization header');
    }
    let decoded;
    try {
      decoded = await verify(header.slice('Bearer '.length).trim());
    } catch (err: any) {
      throw new HttpError(401, `Invalid ID token: ${err?.message || 'could not be verified'}`);
    }
    const email = normalizeEmail(decoded.email);
    if (!email) throw new HttpError(403, 'Forbidden: No email associated with token');
    // Same condition as the Firestore security rules
    if (decoded.email_verified !== true) throw new HttpError(403, 'Forbidden: The email address is not verified');
    return { email, name: decoded.name || email };
  }

  async function identify(email: string, appConfig: AppConfig): Promise<Identity | null> {
    if (includesEmail(appConfig.superAdmins, email)) return { role: 'superAdmin' };
    if (includesEmail(appConfig.managers, email)) return { role: 'manager' };
    const snap = await adminDb.collection('access').doc(email).get();
    if (snap.exists) {
      const data = snap.data();
      if (data?.role === 'tl' || data?.role === 'agent') return { role: data.role, access: data };
    }
    return null;
  }

  async function requireSuperAdmin(req: Request) {
    const user = await authenticate(req);
    const { appConfig, cycle } = await ensureSeedData();
    if (!includesEmail(appConfig.superAdmins, user.email)) {
      throw new HttpError(403, 'Forbidden: User is not a Super Admin');
    }
    return { user, appConfig, cycle };
  }

  // ------------------------------------------------------------------ health

  // A real write + read of health/ping through the same path the sync uses. The answer is kept for
  // 10 seconds so this public URL cannot be used to burn the daily Firestore quota.
  let healthCache: { at: number; status: number; body: any } | null = null;

  api.get(
    '/api/health',
    route(async (_req, res) => {
      const now = Date.now();
      if (healthCache && now - healthCache.at < 10000) {
        return res.status(healthCache.status).json(healthCache.body);
      }
      let status = 200;
      let body: any;
      try {
        await adminDb.healthCheck();
        body = { status: 'ok', storage: adminDb.kind };
      } catch (err: any) {
        console.error('Health check error:', err);
        status = 500;
        body = { status: 'error', storage: adminDb.kind, message: err?.message || String(err) };
      }
      healthCache = { at: now, status, body };
      return res.status(status).json(body);
    })
  );

  // ------------------------------------------------------------------ sync (Apps Script)

  api.post(
    '/api/sync',
    route(async (req, res) => {
      const expected = process.env.SYNC_KEY;
      const given = req.headers['x-sync-key'];
      if (!expected || typeof given !== 'string' || !sameSecret(given, expected)) {
        throw new HttpError(401, 'Unauthorized: Invalid or missing X-Sync-Key');
      }
      const { mainRows, qualityRows } = req.body || {};
      const result = await processImport('apps-script', mainRows || [], qualityRows || []);
      return res.json(result);
    })
  );

  // ------------------------------------------------------------------ Super Admin: import / test data

  api.post(
    '/api/import',
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const { mainRows, qualityRows, source } = req.body || {};
      const importSource = source === 'test' ? 'test' : 'import';
      const result = await processImport(importSource, mainRows || [], qualityRows || []);
      return res.json(result);
    })
  );

  api.post(
    ['/api/clear-test', '/api/admin/clear-test-data'],
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const counts = await clearTestData(appConfig);
      return res.json({ status: 'ok', ...counts });
    })
  );

  api.get(
    '/api/admin/sync-logs',
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const snap = await adminDb.collection('syncLogs').orderBy('time', 'desc').limit(30).get();
      return res.json({ logs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
    })
  );

  // ------------------------------------------------------------------ Super Admin: configuration

  api.get(
    '/api/admin/config',
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      return res.json({ config: appConfig });
    })
  );

  api.post(
    '/api/admin/config',
    route(async (req, res) => {
      const { user, appConfig } = await requireSuperAdmin(req);
      const { aiEnabled, aiTone, testMode, managers, superAdmins } = req.body || {};
      const updates: Partial<AppConfig> = {};

      if (typeof aiEnabled === 'boolean') updates.aiEnabled = aiEnabled;
      if (aiTone === 'english' || aiTone === 'hinglish') updates.aiTone = aiTone;
      if (typeof testMode === 'boolean') updates.testMode = testMode;
      if (managers !== undefined) updates.managers = cleanEmailList(managers, 'managers');
      if (superAdmins !== undefined) {
        const list = cleanEmailList(superAdmins, 'superAdmins');
        // Never lock the app: at least one Super Admin, and the one who is saving stays in
        if (list.length === 0) throw new HttpError(400, 'There must be at least one Super Admin');
        if (!list.includes(user.email)) {
          throw new HttpError(400, 'You cannot remove your own Super Admin access');
        }
        updates.superAdmins = list;
      }

      if (Object.keys(updates).length > 0) {
        await adminDb.collection('config').doc('app').set(updates, { merge: true });
      }
      const next: AppConfig = { ...appConfig, ...updates };

      // The stored leaderboards depend on test mode (demo users only rank while it is on)
      if (typeof updates.testMode === 'boolean' && updates.testMode !== Boolean(appConfig.testMode)) {
        await rebuildLeaderboards(next);
      }

      return res.json({ status: 'ok', config: next });
    })
  );

  api.get(
    '/api/admin/config-cycle',
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      return res.json({
        isSuperAdmin: true,
        appConfig,
        cycle,
        server: {
          storage: adminDb.kind,
          syncKeyConfigured: Boolean(process.env.SYNC_KEY),
          aiKeyConfigured: isAiConfigured(),
        },
      });
    })
  );

  api.get(
    '/api/admin/readiness',
    route(async (req, res) => {
      await requireSuperAdmin(req);
      return res.json(await buildReadiness());
    })
  );

  // ------------------------------------------------------------------ Super Admin: AI text

  api.post(
    '/api/admin/test-ai',
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      const cycleId = appConfig.activeCycleId;
      const agents = adminDb.collection('cycles').doc(cycleId).collection('agents');

      let targetAgent: AgentRecord | null = null;
      const requestedEmail = normalizeEmail(req.body?.officialEmail);
      if (requestedEmail) {
        const snap = await agents.doc(requestedEmail).get();
        if (snap.exists) targetAgent = snap.data() as AgentRecord;
      }
      if (!targetAgent) {
        const first = await agents.limit(1).get();
        if (!first.empty) targetAgent = first.docs[0].data() as AgentRecord;
      }
      if (!targetAgent) {
        throw new HttpError(404, 'No agents found in active cycle. Import dummy data first.');
      }

      // Dry run: nothing is saved
      const aiResult = await generateAiText(targetAgent, cycle, appConfig);
      return res.json({
        agentName: targetAgent.name,
        officialEmail: targetAgent.officialEmail,
        agentType: targetAgent.agentType,
        success: aiResult.success,
        headline: aiResult.aiSuggestions?.headline,
        report: aiResult.report,
        error: aiResult.error,
      });
    })
  );

  api.post(
    '/api/admin/generate-ai-all',
    route(async (req, res) => {
      const { appConfig, cycle } = await requireSuperAdmin(req);
      if (!isAiConfigured()) throw new HttpError(400, 'GEMINI_API_KEY is not set on the server.');
      const cycleId = appConfig.activeCycleId;

      const snap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
      const agents = snap.docs.map((d) => d.data() as AgentRecord);
      if (agents.length === 0) return res.json({ status: 'ok', okCount: 0, failedCount: 0, pendingCount: 0, total: 0 });

      const run = await runBatchAiGeneration(agents, cycle, appConfig, { budgetMs: 120000 });
      await saveAiText(cycleId, run.generatedAgents);
      return res.json({
        status: 'ok',
        okCount: run.okCount,
        failedCount: run.failedCount,
        pendingCount: run.pendingCount,
        total: agents.length,
      });
    })
  );

  // ------------------------------------------------------------------ sessions and agent data

  api.get(
    '/api/auth/session',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig, cycle } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) {
        return res.status(403).json({ role: null, error: 'Access denied. Contact your TL.' });
      }
      const common = {
        email: user.email,
        role: identity.role,
        name: identity.access?.name || user.name,
        activeCycleId: appConfig.activeCycleId,
        activeCycleName: cycle.name,
        testMode: Boolean(appConfig.testMode),
      };
      if (identity.role === 'superAdmin' || identity.role === 'manager') {
        return res.json({ ...common, officialEmail: user.email, name: user.name });
      }
      if (identity.role === 'tl') {
        // The access record only says "Team Leader"; show the person's own Google name instead
        return res.json({
          ...common,
          name: user.name,
          officialEmail: identity.access?.officialEmail || user.email,
          location: identity.access?.location,
        });
      }
      return res.json({
        ...common,
        officialEmail: identity.access?.officialEmail,
        location: identity.access?.location,
      });
    })
  );

  /**
   * One agent's record plus the cycle rules.
   * - agent: only the record that belongs to the login (access/{email}.officialEmail)
   * - TL: only agents whose TL_Personal_Email is the TL's own login (the same rule as the Firestore rules)
   * - manager / Super Admin: any agent
   * Demo agents are hidden from everyone but the Super Admin (and the demo user) once test mode is off.
   */
  api.get(
    '/api/agent-data',
    route(async (req, res) => {
      const user = await authenticate(req);
      const target = normalizeEmail(String(req.query.officialEmail ?? ''));
      if (!target) throw new HttpError(400, 'Missing officialEmail parameter');

      const { appConfig, cycle } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied to this agent record.');

      const snap = await adminDb
        .collection('cycles')
        .doc(appConfig.activeCycleId)
        .collection('agents')
        .doc(target)
        .get();
      const agentRecord = snap.exists ? (snap.data() as AgentRecord) : null;

      if (identity.role === 'agent') {
        if (normalizeEmail(identity.access?.officialEmail) !== target) {
          throw new HttpError(403, 'Access denied to this agent record.');
        }
      } else if (identity.role === 'tl') {
        if (!agentRecord || normalizeEmail(agentRecord.tlPersonalEmail) !== user.email) {
          throw new HttpError(403, 'Access denied to this agent record.');
        }
      }

      const hideDemo =
        agentRecord?.isTest && !appConfig.testMode && identity.role !== 'superAdmin' && identity.role !== 'agent';
      return res.json({
        agentRecord: hideDemo ? null : agentRecord,
        cycle: cycle as Cycle,
        userRole: identity.role,
        config: publicConfig(appConfig),
      });
    })
  );

  /** A short list of the agents this user may open (the Team view reads Firestore directly, this is a helper). */
  api.get(
    '/api/allowed-agents',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const all = await adminDb.collection('cycles').doc(appConfig.activeCycleId).collection('agents').get();
      let agents = all.docs.map((d) => d.data() as AgentRecord);

      if (identity.role === 'agent') {
        const own = normalizeEmail(identity.access?.officialEmail);
        agents = agents.filter((a) => normalizeEmail(a.officialEmail) === own);
      } else if (identity.role === 'tl') {
        agents = agents.filter((a) => normalizeEmail(a.tlPersonalEmail) === user.email);
      }
      if (!appConfig.testMode && identity.role !== 'superAdmin' && identity.role !== 'agent') {
        agents = agents.filter((a) => !a.isTest);
      }

      return res.json({
        role: identity.role,
        agents: agents.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
          agentType: a.agentType,
          total: a.result?.total || 0,
          className: a.result?.className || 'NQ',
          sales: a.totals?.sales || 0,
          isTest: a.isTest || false,
        })),
      });
    })
  );

  // ------------------------------------------------------------------ fall-through and errors

  api.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  api.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body: ' + err.message });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'The request is too large' });
    }
    console.error('API error:', err);
    return res.status(500).json({ error: err?.message || String(err) });
  });

  return api;
}
