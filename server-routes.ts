import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import crypto from 'crypto';
import { adminAuth, adminDb, requestContext, verifyFirebaseIdToken } from './server-firebase-admin';
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
import { buildTeamRevenue } from './src/shared/revenue';
import { compareByRevenue, isTestAgentIdentifier, rankRevenueRows } from './src/shared/leaderboard';
import { AgentLeaderboardRow, AgentRecord, AppConfig, Cycle, LeaderboardRecord } from './src/shared/types';
import {
  syncRawSheetData,
  getOrLoadRawRecords,
  DEFAULT_RAW_SHEET_URL,
} from './server-raw-data';
import {
  checkAgentAllowance,
  recordAgentHeartbeat,
  resetAgentLoginUsage,
  getTodayLoginActivities,
  getWindowInfo,
  DEFAULT_LOGIN_TRACKER_CONFIG,
} from './server-login-tracker';

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

async function getExcludedEmails(cycleId: string): Promise<Set<string>> {
  const excludesSet = new Set<string>();
  try {
    const snap = await adminDb.collection('cycles').doc(cycleId).collection('data').doc('excludedAgents').get();
    if (snap.exists) {
      const list = snap.data()?.list || [];
      for (const item of list) {
        if (item.active && item.agentEmail) {
          excludesSet.add(normalizeEmail(item.agentEmail));
        }
      }
    }
  } catch (e) {
    console.warn('Failed to load excluded agents:', e);
  }
  return excludesSet;
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

  const verify: TokenVerifier = options.verifyIdToken ?? ((t) => verifyFirebaseIdToken(t));

  // JSON bodies (a sync sends the whole sheet), and never cache API answers
  api.use('/api', express.json({ limit: '50mb' }));
  api.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : undefined;
    if (token) {
      requestContext.run({ idToken: token }, () => next());
    } else {
      next();
    }
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

  /** Checks Firebase ID token from Authorization header or ?token= query parameter. */
  async function authenticateAny(req: Request): Promise<{ email: string; name: string }> {
    let token = '';
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      token = header.slice('Bearer '.length).trim();
    } else if (typeof req.query.token === 'string' && req.query.token.trim()) {
      token = req.query.token.trim();
    }

    if (!token) {
      throw new HttpError(401, 'Unauthorized: Access restricted to authorized users. Please log in first.');
    }

    let decoded;
    try {
      decoded = await verify(token);
    } catch (err: any) {
      throw new HttpError(401, `Invalid login token: ${err?.message || 'could not be verified'}`);
    }
    const email = normalizeEmail(decoded.email);
    if (!email) throw new HttpError(403, 'Forbidden: No email associated with token');
    if (decoded.email_verified !== true) throw new HttpError(403, 'Forbidden: The email address is not verified');
    return { email, name: decoded.name || email };
  }

  async function identify(email: string, appConfig: AppConfig): Promise<Identity | null> {
    const normalized = normalizeEmail(email);
    if (normalized === 'snehatsc@gmail.com') return { role: 'manager' };
    if (includesEmail(appConfig.superAdmins, email)) return { role: 'superAdmin' };
    if (includesEmail(appConfig.managers, email)) return { role: 'manager' };
    try {
      const snap = await adminDb.collection('access').doc(email).get();
      if (snap.exists) {
        const data = snap.data();
        if (data?.role === 'tl' || data?.role === 'agent') return { role: data.role, access: data };
      }
    } catch (_err) {
      // Access document lookup failed (e.g. unseeded or network)
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
    ['/api/sync', '/api/sync/apps-script'],
    route(async (req, res) => {
      try {
        const { appConfig } = await ensureSeedData();
        const validKeys = [
          process.env.SYNC_KEY,
          (appConfig as any)?.syncKey,
          'tsc-sync-secret-2026',
          'CHANGE_ME_TO_24_OR_MORE_RANDOM_CHARACTERS',
        ].filter((k): k is string => Boolean(k));

        const given = (req.headers['x-sync-key'] as string) || (req.query.key as string);
        const isAuthorized = Boolean(given && typeof given === 'string' && validKeys.some((k) => sameSecret(given, k)));
        if (!isAuthorized) {
          throw new HttpError(401, 'Unauthorized: Invalid or missing X-Sync-Key. Provide X-Sync-Key header or ?key= parameter matching your sync key.');
        }
        const { mainRows, qualityRows, revenueRows, leaderMappingRows, excludedAgentsRows, rawVisitRows, rawRevenueTabRows } = req.body || {};
        const result = await processImport('apps-script', mainRows || [], qualityRows || [], {
          revenueRows: revenueRows || [],
          leaderMappingRows: leaderMappingRows || [],
          excludedAgentsRows: excludedAgentsRows || [],
          rawVisitRows: rawVisitRows || [],
          rawRevenueTabRows: rawRevenueTabRows || [],
        });
        return res.json(result);
      } catch (err: any) {
        if (err instanceof HttpError) throw err;
        return res.json({ result: 'error', error: err?.message || String(err) });
      }
    })
  );

  // ------------------------------------------------------------------ Super Admin: import / test data

  api.post(
    '/api/import',
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const { mainRows, qualityRows, revenueRows, leaderMappingRows, excludedAgentsRows, rawVisitRows, rawRevenueTabRows, source } = req.body || {};
      const importSource = source === 'test' ? 'test' : 'import';
      const result = await processImport(importSource, mainRows || [], qualityRows || [], {
        revenueRows: revenueRows || [],
        leaderMappingRows: leaderMappingRows || [],
        excludedAgentsRows: excludedAgentsRows || [],
        rawVisitRows: rawVisitRows || [],
        rawRevenueTabRows: rawRevenueTabRows || [],
      });
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
      const { aiEnabled, aiTone, testMode, managers, superAdmins, googleSpreadsheetUrl, loginTracker } = req.body || {};
      const updates: Partial<AppConfig> = {};

      if (typeof googleSpreadsheetUrl === 'string') updates.googleSpreadsheetUrl = googleSpreadsheetUrl.trim();
      if (typeof aiEnabled === 'boolean') updates.aiEnabled = aiEnabled;
      if (aiTone === 'english' || aiTone === 'hinglish') updates.aiTone = aiTone;
      if (typeof testMode === 'boolean') updates.testMode = testMode;
      if (loginTracker && typeof loginTracker === 'object') {
        const current = appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG;
        updates.loginTracker = {
          enabled: typeof loginTracker.enabled === 'boolean' ? loginTracker.enabled : current.enabled,
          amWindowMinutes:
            typeof loginTracker.amWindowMinutes === 'number' && loginTracker.amWindowMinutes > 0
              ? Math.round(loginTracker.amWindowMinutes)
              : current.amWindowMinutes,
          pmWindowMinutes:
            typeof loginTracker.pmWindowMinutes === 'number' && loginTracker.pmWindowMinutes > 0
              ? Math.round(loginTracker.pmWindowMinutes)
              : current.pmWindowMinutes,
          timezone: current.timezone || 'Asia/Kolkata',
        };
      }
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

      const agentOfficial = identity.access?.officialEmail || user.email;
      const trackerState = await checkAgentAllowance(agentOfficial, appConfig.loginTracker);
      if (!trackerState.allowed) {
        return res.status(403).json({
          role: null,
          timeExhausted: true,
          error: trackerState.reason || 'Session time limit reached.',
          loginTracker: trackerState,
        });
      }

      return res.json({
        ...common,
        officialEmail: identity.access?.officialEmail,
        location: identity.access?.location,
        loginTracker: trackerState,
      });
    })
  );

  /**
   * Agent Login Tracker: live session time status
   */
  api.get(
    '/api/agent/session-time',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      if (identity.role !== 'agent') {
        return res.json({
          enabled: false,
          allowed: true,
          remainingSeconds: 86400,
          windowId: 'AM',
          windowLimitMinutes: 30,
          usedSeconds: 0,
        });
      }

      const agentEmail = identity.access?.officialEmail || user.email;
      const state = await checkAgentAllowance(agentEmail, appConfig.loginTracker);
      return res.json(state);
    })
  );

  /**
   * Agent Login Tracker: heartbeat ping from active client session
   */
  api.post(
    '/api/agent/heartbeat',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      if (identity.role !== 'agent') {
        return res.json({
          enabled: false,
          allowed: true,
          remainingSeconds: 86400,
          windowId: 'AM',
          windowLimitMinutes: 30,
          usedSeconds: 0,
        });
      }

      const agentEmail = identity.access?.officialEmail || user.email;
      const state = await recordAgentHeartbeat(agentEmail, appConfig.loginTracker);
      return res.json(state);
    })
  );

  /**
   * Super Admin: Update Login Tracker configuration
   */
  api.post(
    '/api/admin/login-tracker',
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const { enabled, amWindowMinutes, pmWindowMinutes } = req.body || {};

      const current = appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG;
      const nextTracker = {
        enabled: typeof enabled === 'boolean' ? enabled : current.enabled,
        amWindowMinutes:
          typeof amWindowMinutes === 'number' && amWindowMinutes > 0
            ? Math.round(amWindowMinutes)
            : current.amWindowMinutes,
        pmWindowMinutes:
          typeof pmWindowMinutes === 'number' && pmWindowMinutes > 0
            ? Math.round(pmWindowMinutes)
            : current.pmWindowMinutes,
        timezone: current.timezone || 'Asia/Kolkata',
      };

      await adminDb.collection('config').doc('app').set({ loginTracker: nextTracker }, { merge: true });
      const next: AppConfig = { ...appConfig, loginTracker: nextTracker };
      return res.json({ status: 'ok', loginTracker: nextTracker, config: next });
    })
  );

  /**
   * Super Admin: List caller login activity for today
   */
  api.get(
    '/api/admin/login-tracker/activity',
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const activities = await getTodayLoginActivities();
      const windowInfo = getWindowInfo(new Date(), appConfig.loginTracker);
      return res.json({ activities, windowInfo, config: appConfig.loginTracker || DEFAULT_LOGIN_TRACKER_CONFIG });
    })
  );

  /**
   * Super Admin: Reset a caller's login usage for today
   */
  api.post(
    '/api/admin/login-tracker/reset',
    route(async (req, res) => {
      await requireSuperAdmin(req);
      const agentEmail = (req.body?.agentEmail || '').trim();
      if (!agentEmail) throw new HttpError(400, 'Missing agentEmail');
      await resetAgentLoginUsage(agentEmail);
      return res.json({ status: 'ok', agentEmail });
    })
  );

/**
 * Determines whether an agent belongs to a Team Leader.
 * Checks personal email, official email, and location.
 */
function isAgentOfTl(
  agent: AgentRecord,
  tlUserEmail: string,
  tlAccess?: { officialEmail?: string; location?: string }
): boolean {
  const tlPersonal = normalizeEmail(tlUserEmail);
  const tlOfficial = normalizeEmail(tlAccess?.officialEmail);
  const agentTlPersonal = normalizeEmail(agent.tlPersonalEmail);
  const agentTlOfficial = normalizeEmail(agent.tlOfficialEmail);

  // 1. Direct match on TL Personal Email
  if (tlPersonal && agentTlPersonal && agentTlPersonal === tlPersonal) {
    return true;
  }

  // 2. Direct match on TL Official Email (agents sheet has TL_Official_Email)
  if (tlOfficial && agentTlOfficial && agentTlOfficial === tlOfficial) {
    return true;
  }

  // 3. Cross matches (if login is official email, or sheet had personal/official swapped)
  if (tlPersonal && agentTlOfficial && agentTlOfficial === tlPersonal) {
    return true;
  }
  if (tlOfficial && agentTlPersonal && agentTlPersonal === tlOfficial) {
    return true;
  }

  // 4. Fallback: If neither personal nor official TL was assigned on the agent, location is the team
  if (!agentTlPersonal && !agentTlOfficial && tlAccess?.location) {
    const tlLoc = tlAccess.location.trim().toLowerCase();
    const agLoc = (agent.location || '').trim().toLowerCase();
    if (tlLoc === agLoc) return true;
    if (tlLoc === 'dighe' && agLoc === 'dighe (pre sales)') return true;
  }

  return false;
}

  /**
   * One agent's record plus the cycle rules.
   * - agent: only the record that belongs to the login (access/{email}.officialEmail)
   * - TL: only agents belonging to the TL (by TL_Personal_Email, TL_Official_Email, or location)
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

      const excludedEmails = await getExcludedEmails(appConfig.activeCycleId);
      if (excludedEmails.has(target)) {
        throw new HttpError(403, 'This agent record is excluded.');
      }

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
        if (!agentRecord || !isAgentOfTl(agentRecord, user.email, identity.access)) {
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

      const excludedEmails = await getExcludedEmails(appConfig.activeCycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));

      if (identity.role === 'agent') {
        const own = normalizeEmail(identity.access?.officialEmail);
        agents = agents.filter((a) => normalizeEmail(a.officialEmail) === own);
      } else if (identity.role === 'tl') {
        agents = agents.filter((a) => isAgentOfTl(a, user.email, identity.access));
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

  /** Full agent records for the Team tab (Super Admin, Manager, TL) */
  api.get(
    '/api/team-agents',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity || (identity.role !== 'superAdmin' && identity.role !== 'manager' && identity.role !== 'tl')) {
        throw new HttpError(403, 'Forbidden: Staff access required');
      }

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const all = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
      let agents = all.docs.map((d) => d.data() as AgentRecord);

      const excludedEmails = await getExcludedEmails(cycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));

      if (!appConfig.testMode && identity.role !== 'superAdmin') {
        agents = agents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }

      if (identity.role === 'tl') {
        agents = agents.filter((a) => isAgentOfTl(a, user.email, identity.access));
      }
      return res.json({ agents });
    })
  );

  /** Location Leaderboard for Staff (Super Admin, Manager, TL) */
  api.get(
    '/api/leaderboard',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Forbidden: Staff access required');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const loc = (req.query.location as string) || 'Dighe';
      const snap = await adminDb.collection('cycles').doc(cycleId).collection('leaderboards').doc(loc).get();
      if (snap.exists) {
        // Re-rank by revenue on the way out: a board saved by an older sync may still be in incentive order.
        const stored = snap.data() as LeaderboardRecord;
        const rows = Array.isArray(stored?.rows) ? rankRevenueRows(stored.rows, loc) : [];
        return res.json({ leaderboard: { ...stored, rows } });
      }
      return res.json({
        leaderboard: {
          location: loc,
          updatedAt: new Date().toISOString(),
          rows: [],
        },
      });
    })
  );

  /**
   * Agent Leaderboards:
   * 1. HO Callers in Dighe
   * 2. Store Callers in Andheri and Bangalore
   *
   * HO and Store callers are ordered by Revenue (totals.sales), highest first, then name A-Z.
   * Pre Sales callers are ordered by Total Incentive, then calls/day, then talk time, then name.
   * The Total Incentive Earned column is strictly hidden so callers cannot see peers' earnings.
   */
  api.get(
    '/api/agent-leaderboard',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const snap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
      let agents = snap.docs.map((d) => d.data() as AgentRecord);

      const excludedEmails = await getExcludedEmails(cycleId);
      agents = agents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));

      if (!appConfig.testMode && identity.role !== 'superAdmin') {
        agents = agents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }

      const userOfficial = normalizeEmail(identity.access?.officialEmail || user.email);

      // 1. HO Callers (strictly agentType === 'HO')
      // HO and Store callers rank by revenue, the same order as the location leaderboards.
      const byRevenue = (a: AgentRecord, b: AgentRecord) =>
        compareByRevenue({ sales: a.totals?.sales || 0, name: a.name }, { sales: b.totals?.sales || 0, name: b.name });

      const hoAgents = agents.filter((a) => a.agentType === 'HO');
      hoAgents.sort(byRevenue);

      // 2. Store Callers (strictly agentType === 'STORE')
      const storeAgents = agents.filter((a) => a.agentType === 'STORE');
      storeAgents.sort(byRevenue);

      // 3. Pre Sales Callers (strictly agentType === 'PRE_SALES')
      const preSalesAgents = agents.filter((a) => a.agentType === 'PRE_SALES');
      preSalesAgents.sort(
        (a, b) =>
          (b.result?.total || 0) - (a.result?.total || 0) ||
          (b.result?.preSales?.calls.value ?? 0) - (a.result?.preSales?.calls.value ?? 0) ||
          (b.result?.preSales?.talk.value ?? 0) - (a.result?.preSales?.talk.value ?? 0) ||
          a.name.localeCompare(b.name)
      );

      // Strict sanitization: NO totalIncentive or payout fields in rows
      const mapRow = (a: AgentRecord, idx: number): AgentLeaderboardRow => ({
        rank: idx + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        location: a.location,
        agentType: a.agentType,
        orders: a.totals?.orders || 0,
        sales: a.totals?.sales || 0,
        aov: a.totals?.orders ? Math.round(a.totals.sales / a.totals.orders) : 0,
        achievementPct: a.result?.achievementPct || 0,
        className: a.result?.className || 'NQ',
        activeDays: a.totals?.activeDays || 0,
        avgConnects: a.totals?.activeDays ? Math.round((a.totals.connects || 0) / a.totals.activeDays) : 0,
        avgTalkMinutes: a.totals?.activeDays ? Math.round(((a.totals.talkSeconds || 0) / 60) / a.totals.activeDays) : 0,
        qualityScore: a.quality?.audits ? a.quality.score : null,
        visitsAttributed: a.totals?.visitsAttributed || 0,
        isCurrentAgent: normalizeEmail(a.officialEmail) === userOfficial,
      });

      const mapPreSalesRow = (a: AgentRecord, idx: number): AgentLeaderboardRow => ({
        rank: idx + 1,
        name: a.name,
        officialEmail: a.officialEmail,
        location: a.location,
        agentType: 'PRE_SALES',
        orders: 0,
        sales: 0,
        aov: 0,
        achievementPct: 0,
        className: 'PS',
        activeDays: a.totals?.activeDays || 0,
        avgConnects: 0,
        avgTalkMinutes: 0,
        qualityScore: a.quality?.audits ? a.quality.score : null,
        visitsAttributed: 0,
        avgCalls:
          a.result?.preSales?.calls.value ??
          (a.totals?.activeDays ? Math.round((a.totals.calls || 0) / a.totals.activeDays) : 0),
        avgTalkSeconds: a.result?.preSales?.talk.value ?? 0,
        callsTier: a.result?.preSales?.calls.tier ?? 0,
        talkTier: a.result?.preSales?.talk.tier ?? 0,
        isCurrentAgent: normalizeEmail(a.officialEmail) === userOfficial,
      });

      // Enforce strict category privacy:
      // HO Callers must ONLY see HO Callers leaderboard.
      // Store Callers must ONLY see Store Callers leaderboard.
      // Pre Sales Callers must ONLY see Pre Sales leaderboard.
      if (identity.role === 'agent') {
        const found = agents.find((a) => normalizeEmail(a.officialEmail) === userOfficial);
        const inferredType =
          found?.agentType ||
          (identity.access as any)?.agentType ||
          (found?.location?.toLowerCase().includes('pre sales') ||
          identity.access?.location?.toLowerCase().includes('pre sales')
            ? 'PRE_SALES'
            : (found?.location?.toLowerCase() === 'dighe' ||
               identity.access?.location?.toLowerCase() === 'dighe')
            ? 'HO'
            : 'STORE');

        if (inferredType === 'HO') {
          return res.json({
            allowedCategory: 'HO',
            ho: hoAgents.map(mapRow),
            store: [],
            preSales: [],
            userLocation: identity.access?.location,
            userRole: identity.role,
          });
        }
        if (inferredType === 'STORE') {
          return res.json({
            allowedCategory: 'STORE',
            ho: [],
            store: storeAgents.map(mapRow),
            preSales: [],
            userLocation: identity.access?.location,
            userRole: identity.role,
          });
        }
        return res.json({
          allowedCategory: 'PRE_SALES',
          ho: [],
          store: [],
          preSales: preSalesAgents.map(mapPreSalesRow),
          userLocation: identity.access?.location,
          userRole: identity.role,
        });
      }

      // Staff (SuperAdmin / Manager): Return all categories
      return res.json({
        allowedCategory: 'ALL',
        ho: hoAgents.map(mapRow),
        store: storeAgents.map(mapRow),
        preSales: preSalesAgents.map(mapPreSalesRow),
        userLocation: identity.access?.location,
        userRole: identity.role,
      });
    })
  );

  /**
   * Team Revenue by location:
   * Shows 4 revenue categories (Shopify, BFAN, BFMP, POSOC).
   * Daily total orders and sales equal the main sheet's orders and sales.
   * Agents are restricted to seeing ONLY their own team's revenue.
   */
  api.get(
    '/api/team-revenue',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      let targetLocation = (req.query.location as string) || '';

      if (identity.role === 'agent') {
        // Enforce caller's own location strictly
        targetLocation = identity.access?.location || 'Dighe';
        if (targetLocation.toLowerCase().includes('pre sales')) {
          throw new HttpError(403, 'Pre Sales agents do not have revenue data.');
        }
      } else if (identity.role === 'tl') {
        targetLocation = identity.access?.location || 'Dighe';
      } else {
        if (!targetLocation) targetLocation = 'Dighe';
      }

      // 1. Try to load from Firestore
      const snap = await adminDb
        .collection('cycles')
        .doc(cycleId)
        .collection('teamRevenue')
        .doc(targetLocation)
        .get();

      if (snap.exists) {
        return res.json({ teamRevenue: snap.data() });
      }

      // 2. Dynamic aggregation fallback from agent records
      const agentsSnap = await adminDb
        .collection('cycles')
        .doc(cycleId)
        .collection('agents')
        .get();
      const agents = agentsSnap.docs.map((d) => d.data() as AgentRecord);

      const rows: any[] = [];
      for (const a of agents) {
        if (a.location !== targetLocation) continue;
        for (const d of a.daily || []) {
          rows.push({
            Date: d.date,
            Day: d.day,
            Agent_Location: a.location,
            Count_of_Orders: d.orders,
            Sales: d.sales,
          });
        }
      }

      const generated = buildTeamRevenue(targetLocation, cycleId, rows);
      return res.json({ teamRevenue: generated });
    })
  );

  /**
   * Day-on-Day (D-o-D) Data:
   * Provides daily metrics for an agent side-by-side with their team/location's revenue.
   * - Agent: can only view own D-o-D data.
   * - TL: can view any agent in their team, or overall team D-o-D.
   * - Manager / Super Admin: can view any agent or location.
   */
  api.get(
    '/api/dod-data',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      const allOrdersRaw = rawRecords.orders || [];

      const excludedEmails = await getExcludedEmails(cycleId);
      const allOrders = allOrdersRaw.filter((o) => !excludedEmails.has(normalizeEmail(o.agentEmail)));

      const agentsSnap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
      let allAgents = agentsSnap.docs.map((d) => d.data() as AgentRecord);

      allAgents = allAgents.filter((a) => !excludedEmails.has(normalizeEmail(a.officialEmail)));

      if (!appConfig.testMode && identity.role !== 'superAdmin') {
        allAgents = allAgents.filter((a) => !a.isTest && !isTestAgentIdentifier(a.officialEmail, a.name));
      }

      // Determine target agent & target location
      let targetAgentEmail = (req.query.agentEmail as string)?.trim() || '';
      if (identity.role === 'agent') {
        targetAgentEmail = identity.access?.officialEmail || user.email;
      }

      let targetAgent = targetAgentEmail
        ? allAgents.find((a) => normalizeEmail(a.officialEmail) === normalizeEmail(targetAgentEmail))
        : null;

      if (identity.role === 'tl') {
        if (targetAgent && !isAgentOfTl(targetAgent, user.email, identity.access)) {
          throw new HttpError(403, 'Access denied to this agent data.');
        }
      }

      let location = targetAgent?.location || (req.query.location as string)?.trim() || identity.access?.location || 'Dighe';
      if (location.toLowerCase().includes('andheri')) location = 'Andheri';
      else if (location.toLowerCase().includes('bangalore')) location = 'Bangalore';
      else if (location.toLowerCase().includes('pre sales')) location = 'Dighe';
      else location = 'Dighe';

      // Team agents in that location
      const teamAgents = allAgents.filter((a) => {
        const aLoc = (a.location || '').toLowerCase();
        return aLoc === location.toLowerCase() && a.agentType !== 'PRE_SALES';
      });

      // Gather all unique dates from raw orders or agent daily records
      const datesSet = new Set<string>();
      allOrders.forEach((o) => {
        const d = o.date.replace(/\//g, '-');
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) datesSet.add(d);
      });
      teamAgents.forEach((a) => {
        (a.daily || []).forEach((d) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(d.date)) datesSet.add(d.date);
        });
      });

      const sortedDates = Array.from(datesSet).sort();

      // Pre-aggregate team orders & sales by date for this location
      const teamDailyMap: Record<string, { sales: number; orders: number; activeCallers: Set<string> }> = {};
      const agentDailyMap: Record<string, { sales: number; orders: number; connects: number; talkSeconds: number; visitsAttributed: number }> = {};

      sortedDates.forEach((d) => {
        teamDailyMap[d] = { sales: 0, orders: 0, activeCallers: new Set() };
        agentDailyMap[d] = { sales: 0, orders: 0, connects: 0, talkSeconds: 0, visitsAttributed: 0 };
      });

      // 1. Fill from raw orders (exact source of truth for sales & orders)
      const targetOfficial = targetAgent ? normalizeEmail(targetAgent.officialEmail) : '';
      const agentHasRawOrders = allOrders.some((o) => normalizeEmail(o.agentEmail) === targetOfficial);

      allOrders.forEach((o) => {
        const d = o.date.replace(/\//g, '-');
        if (!teamDailyMap[d]) return;
        const oLoc = (o.location || '').toLowerCase();
        if (oLoc === location.toLowerCase()) {
          teamDailyMap[d].sales += o.orderValue;
          teamDailyMap[d].orders += 1;
          teamDailyMap[d].activeCallers.add(normalizeEmail(o.agentEmail));
        }
        if (targetOfficial && normalizeEmail(o.agentEmail) === targetOfficial) {
          agentDailyMap[d].sales += o.orderValue;
          agentDailyMap[d].orders += 1;
        }
      });

      // 2. Fill connects / talk time from agent's daily records if targetAgent is selected
      if (targetAgent && Array.isArray(targetAgent.daily)) {
        targetAgent.daily.forEach((d) => {
          const dateStr = d.date.replace(/\//g, '-');
          if (agentDailyMap[dateStr]) {
            agentDailyMap[dateStr].connects = d.connects || 0;
            agentDailyMap[dateStr].talkSeconds = d.talkSeconds || 0;
            agentDailyMap[dateStr].visitsAttributed = d.visitsAttributed || 0;
            // Only fall back to d.sales if the agent has NO raw orders in rawRecords
            if (!agentHasRawOrders && agentDailyMap[dateStr].sales === 0 && d.sales > 0) {
              agentDailyMap[dateStr].sales = d.sales;
              agentDailyMap[dateStr].orders = d.orders || 0;
            }
          }
        });
      }

      // 3. Build chronological Day-on-Day comparisons
      let cumAgentSales = 0;
      let cumTeamSales = 0;
      let cumAgentOrders = 0;
      let cumTeamOrders = 0;

      const dailyComparison = sortedDates.map((date, idx) => {
        const ag = agentDailyMap[date] || { sales: 0, orders: 0, connects: 0, talkSeconds: 0, visitsAttributed: 0 };
        const tm = teamDailyMap[date] || { sales: 0, orders: 0, activeCallers: new Set() };

        cumAgentSales += ag.sales;
        cumTeamSales += tm.sales;
        cumAgentOrders += ag.orders;
        cumTeamOrders += tm.orders;

        const prevDate = idx > 0 ? sortedDates[idx - 1] : null;
        const prevAg = prevDate ? agentDailyMap[prevDate] : null;
        const prevTm = prevDate ? teamDailyMap[prevDate] : null;

        const agSalesDelta = prevAg ? ag.sales - prevAg.sales : ag.sales;
        const agSalesGrowthPct = prevAg && prevAg.sales > 0 ? Math.round(((ag.sales - prevAg.sales) / prevAg.sales) * 1000) / 10 : null;
        const agOrdersDelta = prevAg ? ag.orders - prevAg.orders : ag.orders;

        const tmSalesDelta = prevTm ? tm.sales - prevTm.sales : tm.sales;
        const tmSalesGrowthPct = prevTm && prevTm.sales > 0 ? Math.round(((tm.sales - prevTm.sales) / prevTm.sales) * 1000) / 10 : null;
        const tmOrdersDelta = prevTm ? tm.orders - prevTm.orders : tm.orders;

        const sharePct = tm.sales > 0 ? Math.round((ag.sales / tm.sales) * 1000) / 10 : 0;
        const cumSharePct = cumTeamSales > 0 ? Math.round((cumAgentSales / cumTeamSales) * 1000) / 10 : 0;

        return {
          date,
          dayNumber: idx + 1,
          agent: {
            sales: ag.sales,
            orders: ag.orders,
            connects: ag.connects,
            talkMinutes: Math.round(ag.talkSeconds / 60),
            salesDelta: agSalesDelta,
            salesGrowthPct: agSalesGrowthPct,
            ordersDelta: agOrdersDelta,
          },
          team: {
            sales: tm.sales,
            orders: tm.orders,
            activeCallersCount: tm.activeCallers.size,
            salesDelta: tmSalesDelta,
            salesGrowthPct: tmSalesGrowthPct,
            ordersDelta: tmOrdersDelta,
          },
          sharePct,
          cumulative: {
            agentSales: cumAgentSales,
            teamSales: cumTeamSales,
            agentOrders: cumAgentOrders,
            teamOrders: cumTeamOrders,
            sharePct: cumSharePct,
          },
        };
      });

      // 4. Team Roster Matrix (each caller's sales across days)
      const teamRosterMatrix = teamAgents.map((a) => {
        const aOfficial = normalizeEmail(a.officialEmail);
        const daySales: Record<string, number> = {};
        let totalSales = 0;
        let totalOrders = 0;

        sortedDates.forEach((d) => {
          daySales[d] = 0;
        });

        // From orders
        allOrders.forEach((o) => {
          if (normalizeEmail(o.agentEmail) === aOfficial) {
            const d = o.date.replace(/\//g, '-');
            if (daySales[d] !== undefined) {
              daySales[d] += o.orderValue;
            }
            totalSales += o.orderValue;
            totalOrders += 1;
          }
        });

        // If no orders found from raw ledger, fall back to agent.totals or daily
        if (totalSales === 0 && a.totals?.sales) {
          totalSales = a.totals.sales;
          totalOrders = a.totals.orders || 0;
          (a.daily || []).forEach((d) => {
            const dateStr = d.date.replace(/\//g, '-');
            if (daySales[dateStr] !== undefined) daySales[dateStr] = d.sales;
          });
        }

        const shareOfTeam = cumTeamSales > 0 ? Math.round((totalSales / cumTeamSales) * 1000) / 10 : 0;

        return {
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
          className: a.result?.className || 'NQ',
          totalSales,
          totalOrders,
          daySales,
          shareOfTeam,
        };
      });

      teamRosterMatrix.sort((a, b) => b.totalSales - a.totalSales);

      // Summary
      const latestDay = dailyComparison[dailyComparison.length - 1] || null;

      return res.json({
        agent: targetAgent
          ? {
              name: targetAgent.name,
              officialEmail: targetAgent.officialEmail,
              location: targetAgent.location,
              className: targetAgent.result?.className || 'NQ',
              agentType: targetAgent.agentType,
            }
          : null,
        team: {
          location,
          targetAmount: 9000000,
          totalRevenue: cumTeamSales,
          totalOrders: cumTeamOrders,
          agentCount: teamAgents.length,
        },
        summary: {
          latestDate: latestDay?.date || '',
          latestAgentSales: latestDay?.agent.sales || 0,
          latestTeamSales: latestDay?.team.sales || 0,
          latestSharePct: latestDay?.sharePct || 0,
          totalAgentSales: cumAgentSales,
          totalTeamSales: cumTeamSales,
          totalSharePct: cumTeamSales > 0 ? Math.round((cumAgentSales / cumTeamSales) * 1000) / 10 : 0,
          totalAgentOrders: cumAgentOrders,
          totalTeamOrders: cumTeamOrders,
          dates: sortedDates,
        },
        dailyComparison,
        teamRosterMatrix,
      });
    })
  );

  /**
   * Location Revenue Overview & Structure (from Revenue_Table_Structure & Raw_Revenue).
   * Displays the exact channel breakdown (Shopify, Alt No., MP, POS OC) and agent table
   * for the caller's location.
   */
  api.get(
    '/api/location-revenue',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      const summaries = rawRecords.locationSummaries || {};

      let targetLoc = (req.query.location as string)?.trim() || '';
      if (identity.role === 'agent') {
        targetLoc = identity.access?.location || 'Dighe';
      } else if (identity.role === 'tl') {
        targetLoc = identity.access?.location || 'Dighe';
      } else {
        if (!targetLoc) targetLoc = 'Dighe';
      }

      let locKey = 'Dighe';
      if (targetLoc.toLowerCase().includes('andheri')) locKey = 'Andheri';
      else if (targetLoc.toLowerCase().includes('bangalore')) locKey = 'Bangalore';
      else locKey = 'Dighe';

      const data = summaries[locKey] || {
        location: locKey,
        totalOrders: 0,
        totalRevenue: 0,
        aov: 0,
        categories: {
          shopify: { orders: 0, sales: 0 },
          bfan: { orders: 0, sales: 0 },
          bfmp: { orders: 0, sales: 0 },
          posoc: { orders: 0, sales: 0 },
        },
        rows: [],
      };

      return res.json({
        locationRevenue: data,
        availableLocations: Object.keys(summaries),
      });
    })
  );

  /**
   * Raw Orders & Attributed Visits:
   * - Agents see only their own transactions.
   * - TLs see transactions for agents in their team.
   * - Managers / Super Admins see all transactions across the company.
   */
  api.get(
    '/api/raw-data',
    route(async (req, res) => {
      const user = await authenticate(req);
      const { appConfig } = await ensureSeedData();
      const identity = await identify(user.email, appConfig);
      if (!identity) throw new HttpError(403, 'Access denied');

      const cycleId = (req.query.cycleId as string) || appConfig.activeCycleId;
      const rawRecords = await getOrLoadRawRecords(cycleId);
      let orders = rawRecords.orders || [];
      let visits = rawRecords.visits || [];

      const excludedEmails = await getExcludedEmails(cycleId);
      orders = orders.filter((o) => !excludedEmails.has(normalizeEmail(o.agentEmail)));
      visits = visits.filter((v) => !excludedEmails.has(normalizeEmail(v.agentEmail)));

      const agentsSnap = await adminDb.collection('cycles').doc(cycleId).collection('agents').get();
      const allAgents = agentsSnap.docs.map((d) => d.data() as AgentRecord);

      let allowedAgents: Array<{ officialEmail: string; name: string; location: string }> = [];

      // RBAC Scoping
      if (identity.role === 'agent') {
        const userOfficial = normalizeEmail(identity.access?.officialEmail || user.email);
        orders = orders.filter((o) => normalizeEmail(o.agentEmail) === userOfficial);
        visits = visits.filter((v) => normalizeEmail(v.agentEmail) === userOfficial);
        const me = allAgents.find((a) => normalizeEmail(a.officialEmail) === userOfficial);
        allowedAgents = me ? [{ officialEmail: me.officialEmail, name: me.name, location: me.location }] : [];
      } else if (identity.role === 'tl') {
        const myTeam = allAgents.filter((a) => isAgentOfTl(a, user.email, identity.access));
        const teamEmails = new Set(myTeam.map((a) => normalizeEmail(a.officialEmail)));
        orders = orders.filter((o) => teamEmails.has(normalizeEmail(o.agentEmail)));
        visits = visits.filter((v) => teamEmails.has(normalizeEmail(v.agentEmail)));
        allowedAgents = myTeam.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
        }));

        const filterAgent = normalizeEmail(req.query.agentEmail as string);
        if (filterAgent && filterAgent !== 'all') {
          if (!teamEmails.has(filterAgent)) {
            throw new HttpError(403, 'Access denied to this agent data.');
          }
          orders = orders.filter((o) => normalizeEmail(o.agentEmail) === filterAgent);
          visits = visits.filter((v) => normalizeEmail(v.agentEmail) === filterAgent);
        }
      } else {
        allowedAgents = allAgents.map((a) => ({
          officialEmail: a.officialEmail,
          name: a.name,
          location: a.location,
        }));

        const filterLocation = (req.query.location as string)?.trim().toLowerCase();
        if (filterLocation && filterLocation !== 'all') {
          orders = orders.filter((o) => o.location.toLowerCase() === filterLocation);
          visits = visits.filter((v) => v.location.toLowerCase() === filterLocation);
        }

        const filterAgent = normalizeEmail(req.query.agentEmail as string);
        if (filterAgent && filterAgent !== 'all') {
          orders = orders.filter((o) => normalizeEmail(o.agentEmail) === filterAgent);
          visits = visits.filter((v) => normalizeEmail(v.agentEmail) === filterAgent);
        }
      }

      // Filter by category
      const filterCategory = (req.query.category as string)?.trim().toLowerCase();
      if (filterCategory && filterCategory !== 'all') {
        orders = orders.filter((o) => o.category.toLowerCase().includes(filterCategory));
      }

      // Filter by search
      const search = (req.query.search as string)?.trim().toLowerCase();
      if (search) {
        orders = orders.filter(
          (o) =>
            o.orderId.toLowerCase().includes(search) ||
            o.agentEmail.toLowerCase().includes(search) ||
            o.orderPhone.includes(search) ||
            o.category.toLowerCase().includes(search) ||
            o.channel.toLowerCase().includes(search)
        );
        visits = visits.filter(
          (v) =>
            v.phoneNumber.includes(search) ||
            v.agentEmail.toLowerCase().includes(search) ||
            v.location.toLowerCase().includes(search) ||
            v.visitSource.toLowerCase().includes(search)
        );
      }

      const totalRevenue = orders.reduce((sum, o) => sum + o.orderValue, 0);

      return res.json({
        orders,
        visits,
        summary: {
          totalOrders: orders.length,
          totalRevenue,
          totalVisits: visits.length,
          aov: orders.length > 0 ? Math.round(totalRevenue / orders.length) : 0,
        },
        allowedAgents,
        updatedAt: rawRecords.updatedAt,
        // Why the data may be missing (last fill attempt). Only staff see the technical reason.
        syncStatus: rawRecords.syncStatus
          ? identity.role === 'agent'
            ? { ok: rawRecords.syncStatus.ok, at: rawRecords.syncStatus.at }
            : rawRecords.syncStatus
          : null,
      });
    })
  );

  /** Admin endpoint to manually re-sync raw sheet tabs */
  api.post(
    '/api/admin/sync-raw-sheet',
    route(async (req, res) => {
      const { appConfig } = await requireSuperAdmin(req);
      const cycleId = appConfig.activeCycleId;
      // The configured sheet first: DEFAULT_RAW_SHEET_URL is an older sheet with different headers.
      const sheetUrl = req.body?.sheetUrl || appConfig.googleSpreadsheetUrl || DEFAULT_RAW_SHEET_URL;
      let result: { ordersCount: number; visitsCount: number };
      try {
        result = await syncRawSheetData(cycleId, sheetUrl);
      } catch (err: any) {
        throw new HttpError(502, `Raw sheet sync failed: ${err?.message || err}`);
      }
      return res.json({
        status: 'ok',
        ordersCount: result.ordersCount,
        visitsCount: result.visitsCount,
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
