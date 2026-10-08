import { adminDb } from './server-firebase-admin';
import { isAiConfigured } from './server-ai';
import { ensureSeedData, loadAgents } from './server-import';
import { AgentType, SyncLogRecord } from './src/shared/types';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
}

export interface Readiness {
  checks: ReadinessCheck[];
  facts: {
    storage: 'firestore' | 'local';
    testMode: boolean;
    cycle: { id: string; name: string; startDate: string; endDate: string; status: string };
    realAgents: number;
    demoAgents: number;
    realByType: Record<AgentType, number>;
    lastSync: (SyncLogRecord & { id?: string }) | null;
    lastRealSync: (SyncLogRecord & { id?: string }) | null;
  };
}

function todayIST(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

function daysBetween(fromDate: string, toDate: string): number {
  const a = new Date(fromDate + 'T00:00:00Z').getTime();
  const b = new Date(toDate + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Everything the Super Admin needs to see before (and after) going live, as green / yellow / red rows.
 * It never returns a secret: only whether a secret is set.
 */
export async function buildReadiness(): Promise<Readiness> {
  const { appConfig, cycle } = await ensureSeedData();
  const checks: ReadinessCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, detail: string) =>
    checks.push({ id, label, status, detail });

  // 1. Database: can the server really write and read?
  if (adminDb.kind === 'local') {
    add(
      'database',
      'Database',
      'fail',
      'The server is using a local file (DB_MODE=local), not Firestore. Nothing is shared with the browser. Remove DB_MODE before going live.'
    );
  } else {
    try {
      await adminDb.healthCheck();
      add('database', 'Database', 'ok', 'The server can write to and read from Firestore.');
    } catch (err: any) {
      add('database', 'Database', 'fail', err?.message || String(err));
    }
  }

  // 2. Secrets
  const syncKey = process.env.SYNC_KEY || '';
  if (!syncKey) {
    add('sync-key', 'Sync key', 'fail', 'SYNC_KEY is not set on the server, so the Google Sheet cannot sync. Add it in the AI Studio secrets.');
  } else if (syncKey.length < 16) {
    add('sync-key', 'Sync key', 'warn', `SYNC_KEY is set but short (${syncKey.length} characters). Use 24 or more random characters, different from the test key.`);
  } else {
    add('sync-key', 'Sync key', 'ok', 'SYNC_KEY is set on the server. The Apps Script must use the same value.');
  }

  // 3. Mode
  if (appConfig.testMode) {
    add('mode', 'Mode', 'warn', 'TEST MODE is on: demo users are visible to everyone and the demo tools are open. Switch to Live before real agents log in.');
  } else {
    add('mode', 'Mode', 'ok', 'LIVE: demo users are hidden from everyone except the Super Admin.');
  }

  // 4. People
  add(
    'super-admins',
    'Super Admins',
    appConfig.superAdmins.length > 0 ? 'ok' : 'fail',
    `${appConfig.superAdmins.length} Super Admin account(s).`
  );
  add(
    'managers',
    'Managers',
    appConfig.managers.length > 0 ? 'ok' : 'warn',
    appConfig.managers.length > 0
      ? `${appConfig.managers.length} Manager account(s).`
      : 'No Managers yet. Add their personal Gmail addresses under Roles & access.'
  );

  // 5. Agents
  const agents = await loadAgents(appConfig.activeCycleId);
  const real = agents.filter((a) => !a.isTest);
  const demo = agents.filter((a) => a.isTest);
  const realByType: Record<AgentType, number> = { HO: 0, STORE: 0, PRE_SALES: 0 };
  for (const a of real) realByType[a.agentType] = (realByType[a.agentType] || 0) + 1;

  add(
    'agents',
    'Real agents',
    real.length > 0 ? 'ok' : 'warn',
    real.length > 0
      ? `${real.length} real agent(s): ${realByType.HO} HO, ${realByType.STORE} Store, ${realByType.PRE_SALES} Pre Sales.`
      : 'No real agents loaded yet. Run Sync Now from the Google Sheet (Incentive App menu).'
  );

  if (demo.length > 0) {
    add(
      'demo-users',
      'Demo users',
      appConfig.testMode ? 'ok' : 'warn',
      appConfig.testMode
        ? `${demo.length} demo user(s) stored.`
        : `${demo.length} demo user(s) are still stored. Only the Super Admin sees them. Switch to test mode and use Clear Test Data to remove them.`
    );
  }

  // 6. Last syncs
  const logsSnap = await adminDb.collection('syncLogs').orderBy('time', 'desc').limit(30).get();
  const logs = logsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as SyncLogRecord) }));
  const lastSync = logs[0] || null;
  const lastRealSync = logs.find((l) => l.source !== 'test') || null;

  if (!lastRealSync) {
    add('sync', 'Last sync from the sheet', 'warn', 'No sync from the Google Sheet or an Excel import yet.');
  } else if (lastRealSync.result === 'error') {
    add('sync', 'Last sync from the sheet', 'fail', `The last sync failed: ${lastRealSync.error || 'unknown error'}`);
  } else {
    const stale =
      lastRealSync.lastDataDate && daysBetween(lastRealSync.lastDataDate, todayIST()) > 2;
    add(
      'sync',
      'Last sync from the sheet',
      stale ? 'warn' : 'ok',
      `${new Date(lastRealSync.time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST, ${lastRealSync.agents ?? 0} agents, data up to ${lastRealSync.lastDataDate || 'n/a'}${stale ? ' (more than 2 days old)' : ''}.`
    );
    const psWarning = (lastRealSync.warnings || []).find((w) => /missing Pre Sales columns/i.test(w));
    if (psWarning) add('pre-sales-columns', 'Pre Sales columns', 'warn', psWarning);
    const otherWarnings = (lastRealSync.warnings || []).filter((w) => w !== psWarning);
    if (otherWarnings.length > 0) {
      add('sync-warnings', 'Sync warnings', 'warn', otherWarnings.slice(0, 3).join(' | ') + (otherWarnings.length > 3 ? ` (+${otherWarnings.length - 3} more)` : ''));
    }
  }

  // 7. AI text
  if (!appConfig.aiEnabled) {
    add('ai', 'AI coaching text', 'ok', 'Off: agents see the rule-based coaching text.');
  } else if (!isAiConfigured()) {
    add('ai', 'AI coaching text', 'fail', 'AI text is on, but GEMINI_API_KEY is not set on the server. Add it in the AI Studio secrets, or switch AI text off.');
  } else {
    add('ai', 'AI coaching text', 'ok', 'On, and the Gemini key is set. Text is written after each sync; the numbers are validated.');
  }

  return {
    checks,
    facts: {
      storage: adminDb.kind,
      testMode: Boolean(appConfig.testMode),
      cycle: {
        id: appConfig.activeCycleId,
        name: cycle.name,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        status: cycle.status,
      },
      realAgents: real.length,
      demoAgents: demo.length,
      realByType,
      lastSync,
      lastRealSync,
    },
  };
}
