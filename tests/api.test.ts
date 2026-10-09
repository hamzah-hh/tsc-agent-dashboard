import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { adminDb, resetBackendForTests } from '../server-firebase-admin';
import { createApiApp } from '../server-routes';
import { invalidateReadCache, processImport } from '../server-import';
import { setGeminiForTests } from '../server-ai';
import { RAW_RETRY_COOLDOWN_MS, getOrLoadRawRecords, invalidateRawCache, saveRawRecords, setRawSheetFetchForTests } from '../server-raw-data';
import { generateDummyData } from '../src/shared/dummyData';
import { AgentRecord, LeaderboardRecord } from '../src/shared/types';
import { check, section } from './harness';
import { startFakeFirestore } from './fake-firestore';

// A token is just "test:<email>:<name>[:unverified]". The fake verifier stands in for Firebase Admin.
const tok = (email: string, name = email.split('@')[0]) => `test:${email}:${name}`;
const fakeVerify = async (token: string) => {
  const parts = token.split(':');
  if (parts[0] !== 'test' || !parts[1]) throw new Error('bad test token');
  return { email: parts[1], name: parts[2], email_verified: parts[3] !== 'unverified' };
};

const L = {
  admin: 'agha.h489@gmail.com',
  manager: 'manager.one@gmail.com',
  ho: 'ho.login@gmail.com',
  store: 'store.login@gmail.com',
  ps: 'ps.login@gmail.com',
  tlDighe: 'tl.dighe@gmail.com',
  tlAndheri: 'tl.andheri@gmail.com',
  stranger: 'random.person@gmail.com',
};
const CYCLE = 'diwali-2026';

function mainRow(o: Record<string, any>) {
  return {
    Date: '2026-10-01', Month: 'Oct-26', Agent_Name: '', Agent_Email_Official: '', Agent_Email_Personal: '',
    Agent_Location: 'Dighe', Agent_Tier: 'HO Callers', Count_of_Orders: 4, Sales: 200000, Average_Order_Value: 50000,
    Unique_Connects: 150, 'Talk_Time_(seconds)': 11000, TL_Official_Email: 'tl@x.in', TL_Personal_Email: '',
    Store_Visits_Booked: 3, Store_Visits_Attributed: 3, Day: 1, Inbound_Calls: '', Avg_TT_per_day: '', ...o,
  };
}

/** Real (not demo) sheet rows: 5 days for each of 3 agents in 2 teams. */
function realRows() {
  const rows: any[] = [];
  for (let d = 1; d <= 5; d++) {
    const Date = `2026-10-0${d}`;
    rows.push(mainRow({ Date, Agent_Name: 'Real Riya', Agent_Email_Official: 'riya@co.in', Agent_Email_Personal: 'riya.login@gmail.com', TL_Personal_Email: L.tlDighe }));
    rows.push(mainRow({ Date, Agent_Name: 'Real Sam', Agent_Email_Official: 'sam@co.in', Agent_Email_Personal: 'sam.login@gmail.com', Agent_Location: 'Andheri', Agent_Tier: 'Store Callers', Sales: 320000, TL_Personal_Email: L.tlAndheri }));
  }
  return rows;
}
const realQuality = [
  { Agent_Email_Official: 'riya@co.in', Total_Audits: 4, Average_Audit_Score: 91 },
  { Agent_Email_Official: 'sam@co.in', Total_Audits: 3, Average_Audit_Score: 86 },
];

async function readAgents(): Promise<Map<string, AgentRecord>> {
  const snap = await adminDb.collection('cycles').doc(CYCLE).collection('agents').get();
  const m = new Map<string, AgentRecord>();
  snap.forEach((d) => m.set(d.id, d.data() as AgentRecord));
  return m;
}
async function board(loc: string): Promise<LeaderboardRecord> {
  return (await adminDb.collection('cycles').doc(CYCLE).collection('leaderboards').doc(loc).get()).data() as LeaderboardRecord;
}

export async function runApiTests() {
  const savedManagerEmails = process.env.MANAGER_EMAILS;
  delete process.env.MANAGER_EMAILS;

  // Local, in-memory database for the API scenarios
  process.env.DB_MODE = 'local';
  process.env.DB_LOCAL_FILE = 'none';
  process.env.SYNC_KEY = 'sync-key-for-tests-1234567890';
  delete process.env.GEMINI_API_KEY;
  resetBackendForTests();

  // The Google Sheet download is faked so no test reads the real sheet over the network. By default it
  // answers like a public sheet whose raw tabs have only a header row.
  const emptyRawTabs = { status: 200, type: 'text/csv; charset=utf-8', body: '"Order ID","Order Value","Agent"\n' };
  const sheet = { calls: 0, answer: emptyRawTabs as { status: number; type: string; body: string | ((url: string) => string) } };
  setRawSheetFetchForTests((async (input: any) => {
    sheet.calls++;
    const body = typeof sheet.answer.body === 'function' ? sheet.answer.body(String(input)) : sheet.answer.body;
    return new Response(body, { status: sheet.answer.status, headers: { 'content-type': sheet.answer.type } });
  }) as typeof fetch);

  const app = createApiApp({ verifyIdToken: fakeVerify });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, opts: { token?: string; body?: any; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { ...(opts.headers || {}) };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch (_e) { /* not json */ }
    return { status: res.status, json, text };
  };

  try {
    // ------------------------------------------------------------------
    section('sign-in and roles');
    let r = await call('GET', '/api/health');
    check('health: ok, storage reported', r.status === 200 && r.json.status === 'ok' && r.json.storage === 'local', r.text);
    r = await call('GET', '/api/auth/session');
    check('session without a token: 401', r.status === 401);
    r = await call('GET', '/api/auth/session', { token: 'garbage' });
    check('session with a bad token: 401', r.status === 401, r.text);
    r = await call('GET', '/api/auth/session', { token: `${tok(L.admin)}:unverified` });
    check('session with an unverified email: 403', r.status === 403, r.text);
    r = await call('GET', '/api/auth/session', { token: tok(L.stranger) });
    check('a stranger is refused: 403, role null, "Contact your TL"', r.status === 403 && r.json.role === null && /Contact your TL/.test(r.json.error), r.text);
    r = await call('GET', '/api/auth/session', { token: tok(L.admin, 'Hamza Agha') });
    check('the Super Admin is recognised and told the cycle name and test mode', r.status === 200 && r.json.role === 'superAdmin' && r.json.activeCycleName === 'Diwali 2026' && r.json.testMode === true, r.text);
    const cfg0 = (await adminDb.collection('config').doc('app').get()).data();
    check('a new project starts with one Super Admin, no managers, and no placeholder address', cfg0.superAdmins.join() === L.admin && cfg0.managers.length === 0 && !JSON.stringify(cfg0).includes('YOUR_PERSONAL'), JSON.stringify(cfg0));

    // ------------------------------------------------------------------
    section('demo users (test mode on)');
    const demo = generateDummyData('2026-10-01', '2026-11-15', {
      hoEmail: L.ho, storeEmail: L.store, preSalesEmail: L.ps, tlDigheEmail: L.tlDighe, tlAndheriEmail: L.tlAndheri,
    });
    r = await call('POST', '/api/import', { token: tok(L.stranger), body: { source: 'test', mainRows: demo.mainRows, qualityRows: demo.qualityRows } });
    check('import: a non-admin is refused (403)', r.status === 403, r.text);
    r = await call('POST', '/api/import', { body: { source: 'test', mainRows: demo.mainRows } });
    check('import: no token is refused (401)', r.status === 401);
    r = await call('POST', '/api/import', { token: tok(L.admin), body: { source: 'test', mainRows: demo.mainRows, qualityRows: demo.qualityRows } });
    check('import as Super Admin: 3 demo agents, no warnings', r.status === 200 && r.json.result === 'ok' && r.json.agents === 3 && r.json.warnings.length === 0, r.text);
    let agents = await readAgents();
    const dHo = agents.get('demo.ho@test.local')!;
    const dSt = agents.get('demo.store@test.local')!;
    const dPs = agents.get('demo.presales@test.local')!;
    check('demo HO: Class B, total 35,175', dHo?.result.className === 'B' && dHo.result.total === 35175, JSON.stringify(dHo?.result.total));
    check('demo Store: Class A, total 25,380', dSt?.result.className === 'A' && dSt.result.total === 25380, JSON.stringify(dSt?.result));
    check('demo Pre Sales: gate met, 118 calls/day tier 2, 195 s tier 2, total 2,000', dPs?.result.preSales?.eligible === true && dPs.result.preSales.calls.tier === 2 && dPs.result.preSales.talk.tier === 2 && dPs.result.total === 2000);
    check('all three are flagged isTest', dHo.isTest === true && dSt.isTest === true && dPs.isTest === true);

    r = await call('GET', '/api/auth/session', { token: tok(L.ho) });
    check('demo HO login: role agent, location Dighe', r.json.role === 'agent' && r.json.location === 'Dighe' && r.json.officialEmail === 'demo.ho@test.local', r.text);
    r = await call('GET', '/api/auth/session', { token: tok(L.tlDighe, 'Tara Lead') });
    check('TL login: role tl, shows the TL\'s own name (not "Team Leader")', r.json.role === 'tl' && r.json.name === 'Tara Lead' && r.json.location === 'Dighe', r.text);

    // ------------------------------------------------------------------
    section('who may open which agent (/api/agent-data)');
    const open = (token: string, officialEmail: string) => call('GET', `/api/agent-data?officialEmail=${encodeURIComponent(officialEmail)}`, { token });

    r = await open(tok(L.ho), 'demo.ho@test.local');
    check('an agent opens their own record', r.status === 200 && r.json.agentRecord.name === 'Demo HO Caller' && r.json.userRole === 'agent' && Boolean(r.json.cycle?.plans?.HO), r.text.slice(0, 200));
    check('the answer contains no manager / admin email list and no appConfig', !('appConfig' in r.json) && !r.text.includes(L.admin) && !/superAdmins|managers/.test(r.text), r.text.slice(0, 300));
    r = await open(tok(L.ho), 'demo.store@test.local');
    check('an agent cannot open another agent (403)', r.status === 403, r.text);
    r = await open(tok(L.tlDighe), 'demo.ho@test.local');
    check('TL Dighe opens a Dighe team member (HO)', r.status === 200 && r.json.agentRecord.name === 'Demo HO Caller');
    r = await open(tok(L.tlDighe), 'demo.presales@test.local');
    check('TL Dighe opens a Dighe team member (Pre Sales)', r.status === 200 && r.json.agentRecord.agentType === 'PRE_SALES');
    r = await open(tok(L.tlDighe), 'demo.store@test.local');
    check('TL Dighe can NOT open the Andheri team\'s agent (was: any TL could open any agent)', r.status === 403, r.text);
    r = await open(tok(L.tlAndheri), 'demo.ho@test.local');
    check('TL Andheri can NOT open a Dighe agent', r.status === 403, r.text);
    r = await open(tok(L.tlAndheri), 'demo.store@test.local');
    check('TL Andheri opens their own team member', r.status === 200);
    r = await open(tok(L.tlDighe), 'nobody@co.in');
    check('a TL asking for an agent that does not exist gets 403 (the team cannot be verified)', r.status === 403);
    r = await open(tok(L.admin), 'demo.store@test.local');
    check('the Super Admin opens any agent', r.status === 200 && r.json.userRole === 'superAdmin');
    r = await open(tok(L.admin), 'nobody@co.in');
    check('the Super Admin asking for a missing agent gets an empty record, not an error', r.status === 200 && r.json.agentRecord === null);
    r = await call('GET', '/api/agent-data', { token: tok(L.admin) });
    check('a missing officialEmail is a 400', r.status === 400);
    r = await open(tok(L.stranger), 'demo.ho@test.local');
    check('a stranger cannot open anything (403)', r.status === 403);

    r = await call('GET', '/api/allowed-agents', { token: tok(L.tlDighe) });
    check('allowed-agents: TL Dighe sees exactly their 2 team members', r.status === 200 && r.json.agents.map((a: any) => a.officialEmail).sort().join() === 'demo.ho@test.local,demo.presales@test.local', r.text.slice(0, 300));
    r = await call('GET', '/api/allowed-agents', { token: tok(L.ho) });
    check('allowed-agents: an agent sees only themself', r.json.agents.length === 1 && r.json.agents[0].officialEmail === 'demo.ho@test.local');

    // ------------------------------------------------------------------
    section('admin endpoints');
    for (const [method, path] of [['GET', '/api/admin/config'], ['GET', '/api/admin/config-cycle'], ['GET', '/api/admin/readiness'], ['GET', '/api/admin/sync-logs'], ['POST', '/api/admin/test-ai'], ['POST', '/api/admin/generate-ai-all'], ['POST', '/api/clear-test']] as const) {
      const ra = await call(method, path, { token: tok(L.ho), body: method === 'POST' ? {} : undefined });
      const rb = await call(method, path, { body: method === 'POST' ? {} : undefined });
      check(`${method} ${path}: agent 403, no token 401`, ra.status === 403 && rb.status === 401, `${ra.status}/${rb.status}`);
    }
    r = await call('POST', '/api/admin/config', { token: tok(L.tlDighe), body: { testMode: false } });
    check('a TL cannot change the configuration', r.status === 403);

    r = await call('GET', '/api/admin/config-cycle', { token: tok(L.admin) });
    check('config-cycle (was missing in the published server): config, cycle, and server flags, without secrets', r.status === 200 && r.json.appConfig.superAdmins[0] === L.admin && r.json.cycle.name === 'Diwali 2026' && r.json.server.syncKeyConfigured === true && r.json.server.aiKeyConfigured === false && !r.text.includes('sync-key-for-tests'), r.text.slice(0, 300));

    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { managers: [' Manager.One@Gmail.com ', L.manager, 'second.mgr@gmail.com'] } });
    check('managers are saved lower-cased and de-duplicated (was: ignored by the dev server)', r.status === 200 && r.json.config.managers.join() === `${L.manager},second.mgr@gmail.com`, r.text);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { managers: ['not-an-email'] } });
    check('an invalid manager email is refused (400)', r.status === 400 && /not a valid email/.test(r.json.error), r.text);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { superAdmins: ['someone.else@gmail.com'] } });
    check('a Super Admin cannot remove their own access (400)', r.status === 400, r.text);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { superAdmins: [] } });
    check('the Super Admin list cannot be emptied (400)', r.status === 400, r.text);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { managers: [L.manager] } });
    check('a manager can be removed and stays removed', r.json.config.managers.join() === L.manager);
    await call('GET', '/api/auth/session', { token: tok(L.admin) });
    check('… and nothing re-adds hard-coded people on later requests', (await adminDb.collection('config').doc('app').get()).data().managers.join() === L.manager);

    r = await call('GET', '/api/auth/session', { token: tok(L.manager, 'Mona Manager') });
    check('the manager is recognised', r.json.role === 'manager');
    r = await open(tok(L.manager), 'demo.store@test.local');
    check('a manager opens any agent (test mode on)', r.status === 200 && r.json.agentRecord.name === 'Demo Store Caller');

    r = await call('GET', '/api/admin/readiness', { token: tok(L.admin) });
    const ids = (r.json.checks as any[]).map((c) => c.id);
    check('readiness: lists database, sync key, mode, people, agents, sync, AI', r.status === 200 && ['database', 'sync-key', 'mode', 'super-admins', 'managers', 'agents', 'sync', 'ai'].every((i) => ids.includes(i)), ids.join());
    const chk = (id: string) => (r.json.checks as any[]).find((c) => c.id === id);
    check('readiness: a local-file database is a red flag', chk('database').status === 'fail' && /DB_MODE=local/.test(chk('database').detail));
    check('readiness: test mode on is a warning; 3 demo users counted; no real agents yet', chk('mode').status === 'warn' && r.json.facts.demoAgents === 3 && r.json.facts.realAgents === 0 && chk('agents').status === 'warn');
    check('readiness never returns a secret', !r.text.includes('sync-key-for-tests'));

    // ------------------------------------------------------------------
    section('real sync (Apps Script) and leaderboards');
    r = await call('POST', '/api/sync', { body: { mainRows: realRows(), qualityRows: realQuality } });
    check('sync without a key: 401', r.status === 401);
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': 'wrong' }, body: { mainRows: realRows() } });
    check('sync with a wrong key: 401', r.status === 401);
    const bad = await fetch(base + '/api/sync', { method: 'POST', headers: { 'X-Sync-Key': process.env.SYNC_KEY!, 'Content-Type': 'application/json' }, body: '{not json' }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) }));
    check('a broken JSON body is a 400 with a JSON error (not an HTML page)', bad.status === 400 && /Invalid JSON/.test(bad.json?.error), JSON.stringify(bad));
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality } });
    check('sync with the key: ok, 2 agents, 10 rows', r.status === 200 && r.json.result === 'ok' && r.json.agents === 2 && r.json.rows === 10 && r.json.lastDataDate === '2026-10-05', r.text);
    agents = await readAgents();
    check('real agents are not flagged as test', agents.get('riya@co.in')?.isTest === false && agents.get('sam@co.in')?.isTest === false);
    check('demo agents survive a real sync', agents.get('demo.ho@test.local')?.isTest === true);
    let dighe = await board('Dighe');
    check('test mode ON: Dighe board = demo HO first, then the real agent; Pre Sales not ranked', dighe.rows.map((x) => x.name).join() === 'Demo HO Caller,Real Riya', dighe.rows.map((x) => x.name).join());

    // ------------------------------------------------------------------
    section('going live');
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { testMode: false } });
    check('switching test mode off is saved', r.status === 200 && r.json.config.testMode === false);
    dighe = await board('Dighe');
    let andheri = await board('Andheri');
    check('the leaderboards are rebuilt at once (no waiting for the next sync): demo agents gone', dighe.rows.map((x) => x.name).join() === 'Real Riya' && andheri.rows.map((x) => x.name).join() === 'Real Sam', `${dighe.rows.map((x) => x.name)} | ${andheri.rows.map((x) => x.name)}`);

    // A board saved by older code in incentive order is served in revenue order (podium and table).
    const staleRow = (rank: number, name: string, sales: number, totalIncentive: number) =>
      ({ rank, name, officialEmail: `${rank}@x.in`, sales, achievementPct: 0, className: 'B', totalIncentive });
    await adminDb.collection('cycles').doc(CYCLE).collection('leaderboards').doc('Bangalore').set({
      location: 'Bangalore',
      updatedAt: '2026-10-05T00:00:00.000Z',
      rows: [staleRow(1, 'Bucket Big', 500000, 9000), staleRow(2, 'Bucket Mid', 600000, 8000), staleRow(3, 'Top Seller', 874473, 4000)],
    });
    r = await call('GET', `/api/leaderboard?cycleId=${CYCLE}&location=Bangalore`, { token: tok(L.manager) });
    const served = (r.json?.leaderboard?.rows || []).map((x: any) => `${x.rank}:${x.name}`).join();
    check('a stored revenue board is served by revenue: highest seller is #1 even with the smallest incentive', r.status === 200 && served === '1:Top Seller,2:Bucket Mid,3:Bucket Big', `${r.status} ${served} ${r.text.slice(0, 200)}`);
    r = await open(tok(L.manager), 'demo.store@test.local');
    check('live: a manager can no longer open a demo agent', r.status === 200 && r.json.agentRecord === null);
    r = await open(tok(L.tlAndheri), 'demo.store@test.local');
    check('live: a TL can no longer open a demo agent', r.status === 200 && r.json.agentRecord === null);
    r = await open(tok(L.admin), 'demo.store@test.local');
    check('live: the Super Admin still can', r.json.agentRecord?.name === 'Demo Store Caller');
    r = await open(tok(L.store), 'demo.store@test.local');
    check('live: the demo user can still open their own record', r.json.agentRecord?.name === 'Demo Store Caller');
    r = await call('GET', '/api/allowed-agents', { token: tok(L.manager) });
    check('live: allowed-agents hides demo agents from a manager', r.json.agents.every((a: any) => !a.isTest) && r.json.agents.length === 2, r.text.slice(0, 200));
    r = await call('POST', '/api/import', { token: tok(L.admin), body: { source: 'test', mainRows: demo.mainRows, qualityRows: demo.qualityRows } });
    check('live: demo users cannot be created (test mode is off)', r.json.result === 'error' && /Test mode is off/.test(r.json.error), r.text);
    const readyLive = (await call('GET', '/api/admin/readiness', { token: tok(L.admin) })).json;
    check('readiness now: LIVE mode ok, 2 real agents, leftover demo users flagged', readyLive.checks.find((c: any) => c.id === 'mode').status === 'ok' && readyLive.facts.realAgents === 2 && readyLive.checks.find((c: any) => c.id === 'demo-users')?.status === 'warn');

    // ------------------------------------------------------------------
    section('clear test data');
    await call('POST', '/api/admin/config', { token: tok(L.admin), body: { testMode: true } });
    r = await call('POST', '/api/clear-test', { token: tok(L.admin) });
    check('clear test data removes the 3 demo agents and their access records', r.status === 200 && r.json.deletedAgents === 3 && r.json.deletedAccess >= 3, r.text);
    agents = await readAgents();
    check('only the real agents remain', [...agents.keys()].sort().join() === 'riya@co.in,sam@co.in');
    check('the test sync log entries are gone, real ones stay', (await call('GET', '/api/admin/sync-logs', { token: tok(L.admin) })).json.logs.every((l: any) => l.source !== 'test'));
    r = await call('GET', '/api/auth/session', { token: tok(L.ho) });
    check('a removed demo login can no longer sign in', r.status === 403);
    dighe = await board('Dighe');
    check('leaderboards rebuilt after the clean-up', dighe.rows.map((x) => x.name).join() === 'Real Riya');
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { testMode: false } });

    // ------------------------------------------------------------------
    section('roster rows: agents can sign in before their first working day');
    const roster = [
      mainRow({ Date: '2026-10-01', Agent_Name: 'New Nia', Agent_Email_Official: 'nia@co.in', Agent_Email_Personal: 'nia.login@gmail.com', TL_Personal_Email: L.tlDighe, Count_of_Orders: '', Sales: '', Average_Order_Value: '', Unique_Connects: '', 'Talk_Time_(seconds)': '', Store_Visits_Booked: '', Store_Visits_Attributed: '', Day: 0 }),
    ];
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: [...realRows(), ...roster], qualityRows: realQuality } });
    check('a roster row (blank numbers, Day 0) is accepted: 3 agents', r.json.result === 'ok' && r.json.agents === 3, r.text);
    r = await call('GET', '/api/auth/session', { token: tok('nia.login@gmail.com') });
    check('the new agent can sign in right away', r.status === 200 && r.json.role === 'agent' && r.json.officialEmail === 'nia@co.in', r.text);
    r = await open(tok('nia.login@gmail.com'), 'nia@co.in');
    check('and sees "no data yet" (0 active days), not an error', r.status === 200 && r.json.agentRecord.totals.activeDays === 0 && r.json.agentRecord.result.total === 0, r.text.slice(0, 200));

    // ------------------------------------------------------------------
    section('AI text never blocks or fails a sync');
    const okGemini = async (payload: string) => {
      const p = JSON.parse(payload);
      const head = p.items.find((i: any) => i.id === 'headline');
      return { text: JSON.stringify({ headline: head ? head.defaultText : 'Keep going', items: p.items.map((i: any) => ({ id: i.id, text: i.defaultText })) }) };
    };
    process.env.GEMINI_API_KEY = 'test-key';
    setGeminiForTests(okGemini);
    await call('POST', '/api/admin/config', { token: tok(L.admin), body: { aiEnabled: true } });
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality } });
    check('AI on: sync ok, text written for both agents', r.json.result === 'ok' && r.json.aiOk === 2 && r.json.aiFailed === 0, r.text);
    agents = await readAgents();
    check('AI text is stored with a fingerprint of the numbers', Boolean(agents.get('riya@co.in')?.aiSuggestions?.fingerprint) && agents.get('riya@co.in')!.aiSuggestions!.items!.length > 0);
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality } });
    check('same data again: text is kept, no new AI calls (aiSkipped 2)', r.json.aiSkipped === 2 && r.json.aiOk === 0, r.text);
    agents = await readAgents();
    check('… and the earlier text is still on the record', Boolean(agents.get('riya@co.in')?.aiSuggestions?.headline));
    const changed = realRows().map((x, i) => (i === 0 ? { ...x, Sales: 999999 } : x));
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: changed, qualityRows: realQuality } });
    check('one agent\'s numbers changed: only that agent gets new text', r.json.aiOk === 1 && r.json.aiSkipped === 1, r.text);

    setGeminiForTests(async () => { throw new Error('Gemini is down'); });
    const changed2 = realRows().map((x, i) => (i === 0 ? { ...x, Sales: 777777 } : x));
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: changed2, qualityRows: realQuality } });
    agents = await readAgents();
    check('Gemini down: the sync still succeeds and the new numbers are saved', r.json.result === 'ok' && r.json.aiFailed >= 1 && agents.get('riya@co.in')!.totals.sales === 777777 + 4 * 200000, r.text);
    check('… and the agent has no stale text (it would not match the new numbers)', !agents.get('riya@co.in')?.aiSuggestions);

    setGeminiForTests(async (p) => { await new Promise((res) => setTimeout(res, 150)); return okGemini(p); });
    const changed3 = realRows().map((x) => ({ ...x, Sales: 555555 }));
    const started = Date.now();
    const budgeted = await processImport('apps-script', changed3 as any, realQuality as any, { aiBudgetMs: 0 });
    check('no time budget left: agents stay pending instead of waiting for Gemini, and the data is saved', budgeted.result === 'ok' && budgeted.aiPending === 2 && budgeted.aiOk === 0 && (await readAgents()).get('riya@co.in')!.totals.sales === 555555 * 5 && Date.now() - started < 2000, JSON.stringify(budgeted));
    // Three agents, one call at a time can finish inside the budget: the rest are pending, not failed
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].flatMap((n, i) => [1, 2].map((d) => mainRow({ Date: `2026-10-0${d}`, Agent_Name: `Many ${n}`, Agent_Email_Official: `many.${n}@co.in`, Agent_Email_Personal: `many.${n}@gmail.com`, TL_Personal_Email: L.tlDighe, Sales: 100000 + i * 1000 })));
    setGeminiForTests(async (p) => { await new Promise((res) => setTimeout(res, 120)); return okGemini(p); });
    // 3 calls run at once and take 120 ms; the budget (100 ms) is over when the first three finish
    const partial = await processImport('apps-script', many as any, [], { aiBudgetMs: 100 });
    check('with a short budget only some agents get text (the rest are pending, none failed)', partial.result === 'ok' && partial.aiOk === 3 && partial.aiPending === 3 && partial.aiFailed === 0, JSON.stringify(partial));

    setGeminiForTests(null);
    delete process.env.GEMINI_API_KEY;
    const changed4 = realRows().map((x) => ({ ...x, Sales: 444444 }));
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: changed4, qualityRows: realQuality } });
    check('AI on but no Gemini key: sync ok, one clear warning', r.json.result === 'ok' && r.json.warnings.some((w: string) => /GEMINI_API_KEY is not set/.test(w)), r.text);
    r = await call('GET', '/api/admin/readiness', { token: tok(L.admin) });
    check('readiness flags "AI on without a key" as red', r.json.checks.find((c: any) => c.id === 'ai').status === 'fail');
    r = await call('POST', '/api/admin/generate-ai-all', { token: tok(L.admin), body: {} });
    check('generate-ai-all without a key is a clear 400', r.status === 400 && /GEMINI_API_KEY/.test(r.json.error), r.text);
    await call('POST', '/api/admin/config', { token: tok(L.admin), body: { aiEnabled: false } });

    // ------------------------------------------------------------------
    section('routing');
    r = await call('GET', '/api/nothing-here', { token: tok(L.admin) });
    check('an unknown /api route is a JSON 404', r.status === 404 && r.json?.error === 'Not Found', r.text);
    check('API answers are marked no-store', (await fetch(base + '/api/health')).headers.get('cache-control') === 'no-store');
    const health1 = await call('GET', '/api/health');
    const health2 = await call('GET', '/api/health');
    check('health answers within 10 s come from a cache (the public URL cannot drain the quota)', health1.status === 200 && health2.status === 200);

    // ------------------------------------------------------------------
    section('raw orders, attributed visits and role-based access checks');
    await adminDb.collection('access').doc(L.tlDighe).set({
      role: 'tl',
      name: 'TL Dighe',
      location: 'Dighe',
      officialEmail: 'tl.dighe@x.in',
      isTest: false,
    });
    await adminDb.collection('access').doc(L.tlAndheri).set({
      role: 'tl',
      name: 'TL Andheri',
      location: 'Andheri',
      officialEmail: 'tl.andheri@x.in',
      isTest: false,
    });
    await adminDb.collection('access').doc('riya.login@gmail.com').set({
      role: 'agent',
      name: 'Real Riya',
      location: 'Dighe',
      officialEmail: 'riya@co.in',
      isTest: false,
    });
    await adminDb.collection('access').doc('sam.login@gmail.com').set({
      role: 'agent',
      name: 'Real Sam',
      location: 'Andheri',
      officialEmail: 'sam@co.in',
      isTest: false,
    });

    const agentColl = adminDb.collection('cycles').doc(CYCLE).collection('agents');
    await agentColl.doc('riya@co.in').set({
      name: 'Real Riya',
      officialEmail: 'riya@co.in',
      personalEmail: 'riya.login@gmail.com',
      location: 'Dighe',
      agentType: 'HO',
      tlPersonalEmail: L.tlDighe,
      tlOfficialEmail: 'tl.dighe@x.in',
      isTest: false,
    }, { merge: true });
    await agentColl.doc('sam@co.in').set({
      name: 'Real Sam',
      officialEmail: 'sam@co.in',
      personalEmail: 'sam.login@gmail.com',
      location: 'Andheri',
      agentType: 'STORE',
      tlPersonalEmail: L.tlAndheri,
      tlOfficialEmail: 'tl.andheri@x.in',
      isTest: false,
    }, { merge: true });

    await adminDb.collection('cycles').doc(CYCLE).collection('data').doc('rawRecords').set({
      orders: [
        {
          orderId: 'ORD-RIYA-1',
          date: '2026-10-01',
          orderTime: '2026-10-01 10:00:00',
          orderValue: 25000,
          orderPhone: '9999900001',
          agentEmail: 'riya@co.in',
          category: '1. Shopify',
          talkTimeCohort: '10. More than 5 minutes',
          originalPhoneOrMarketplace: 'NA',
          consideredForOverall: true,
          consideredForAgent: true,
          agentCategory: 'HO Caller',
          location: 'Dighe',
          channel: 'Website',
        },
        {
          orderId: 'ORD-RIYA-2',
          date: '2026-10-02',
          orderTime: '2026-10-02 11:00:00',
          orderValue: 15000,
          orderPhone: '9999900002',
          agentEmail: 'riya@co.in',
          category: '2. Bought From Another Number',
          talkTimeCohort: '08. 3 Minutes Plus',
          originalPhoneOrMarketplace: 'NA',
          consideredForOverall: true,
          consideredForAgent: true,
          agentCategory: 'HO Caller',
          location: 'Dighe',
          channel: 'Retail',
        },
        {
          orderId: 'ORD-SAM-1',
          date: '2026-10-01',
          orderTime: '2026-10-01 12:00:00',
          orderValue: 50000,
          orderPhone: '9999900003',
          agentEmail: 'sam@co.in',
          category: '1. Shopify',
          talkTimeCohort: '10. More than 5 minutes',
          originalPhoneOrMarketplace: 'NA',
          consideredForOverall: true,
          consideredForAgent: true,
          agentCategory: 'Store Callers - Andheri',
          location: 'Andheri',
          channel: 'Retail',
        },
        {
          orderId: 'ORD-SAM-2',
          date: '2026-10-03',
          orderTime: '2026-10-03 14:00:00',
          orderValue: 30000,
          orderPhone: '9999900004',
          agentEmail: 'sam@co.in',
          category: '4. POS OC',
          talkTimeCohort: '10. More than 5 minutes',
          originalPhoneOrMarketplace: 'NA',
          consideredForOverall: true,
          consideredForAgent: true,
          agentCategory: 'Store Callers - Andheri',
          location: 'Andheri',
          channel: 'Retail',
        },
      ],
      visits: [
        {
          id: 'VISIT-RIYA-1',
          type: 'HO',
          date: '2026-10-01',
          visitDateTime: '2026-10-01 15:00:00',
          phoneNumber: '9999900001',
          agentEmail: 'riya@co.in',
          location: 'Dighe',
          talkTimeSeconds: 320,
          visitSource: 'Same Number',
        },
        {
          id: 'VISIT-SAM-1',
          type: 'STORE',
          date: '2026-10-02',
          visitDateTime: '2026-10-02 16:00:00',
          phoneNumber: '9999900003',
          agentEmail: 'sam@co.in',
          location: 'Andheri',
          talkTimeSeconds: 240,
          visitSource: 'Same Number',
        },
      ],
      locationSummaries: {
        Dighe: {
          location: 'Dighe',
          totalOrders: 2,
          totalRevenue: 40000,
          aov: 20000,
          categories: {
            shopify: { orders: 1, sales: 25000 },
            bfan: { orders: 1, sales: 15000 },
            bfmp: { orders: 0, sales: 0 },
            posoc: { orders: 0, sales: 0 },
          },
          rows: [
            {
              agentEmail: 'riya@co.in',
              shopifyOrders: 1,
              shopifyRevenue: 25000,
              altOrders: 1,
              altRevenue: 15000,
              mpOrders: 0,
              mpRevenue: 0,
              posOrders: 0,
              posRevenue: 0,
              totalOrders: 2,
              totalRevenue: 40000,
              aov: 20000,
            },
          ],
        },
        Andheri: {
          location: 'Andheri',
          totalOrders: 2,
          totalRevenue: 80000,
          aov: 40000,
          categories: {
            shopify: { orders: 1, sales: 50000 },
            bfan: { orders: 0, sales: 0 },
            bfmp: { orders: 0, sales: 0 },
            posoc: { orders: 1, sales: 30000 },
          },
          rows: [
            {
              agentEmail: 'sam@co.in',
              shopifyOrders: 1,
              shopifyRevenue: 50000,
              altOrders: 0,
              altRevenue: 0,
              mpOrders: 0,
              mpRevenue: 0,
              posOrders: 1,
              posRevenue: 30000,
              totalOrders: 2,
              totalRevenue: 80000,
              aov: 40000,
            },
          ],
        },
      },
      updatedAt: new Date().toISOString(),
    });

    // 1. Unauthenticated or stranger call to raw data
    r = await call('GET', '/api/raw-data');
    check('raw-data: no token is 401', r.status === 401);
    r = await call('GET', '/api/raw-data', { token: tok(L.stranger) });
    check('raw-data: stranger is 403', r.status === 403);

    // 2. Agent Riya opens raw data -> only sees Riya's records
    r = await call('GET', '/api/raw-data', { token: tok('riya.login@gmail.com') });
    check('raw-data agent: Riya sees exactly her 2 orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.agentEmail === 'riya@co.in'));
    check('raw-data agent: Riya sees exactly her 1 visit', r.json.visits.length === 1 && r.json.visits[0].agentEmail === 'riya@co.in');
    check('raw-data agent: Riya cannot see Sam data', !r.json.orders.some((o: any) => o.agentEmail === 'sam@co.in') && !r.json.visits.some((v: any) => v.agentEmail === 'sam@co.in'));

    // 3. Agent Sam opens raw data -> only sees Sam's records
    r = await call('GET', '/api/raw-data', { token: tok('sam.login@gmail.com') });
    check('raw-data agent: Sam sees exactly his 2 orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.agentEmail === 'sam@co.in'));
    check('raw-data agent: Sam sees exactly his 1 visit', r.json.visits.length === 1 && r.json.visits[0].agentEmail === 'sam@co.in');
    check('raw-data agent: Sam cannot see Riya data', !r.json.orders.some((o: any) => o.agentEmail === 'riya@co.in'));

    // 4. TL Dighe opens raw data -> sees Riya (in team), cannot see Sam (in Andheri)
    r = await call('GET', '/api/raw-data', { token: tok(L.tlDighe) });
    check('raw-data TL: TL Dighe sees Riya team orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.agentEmail === 'riya@co.in'));
    check('raw-data TL: TL Dighe does NOT see Andheri team orders', !r.json.orders.some((o: any) => o.agentEmail === 'sam@co.in'));
    check('raw-data TL: TL Dighe sees Riya visit', r.json.visits.length === 1 && r.json.visits[0].agentEmail === 'riya@co.in');

    // 5. TL Andheri opens raw data -> sees Sam (in team), cannot see Riya (in Dighe)
    r = await call('GET', '/api/raw-data', { token: tok(L.tlAndheri) });
    check('raw-data TL: TL Andheri sees Sam team orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.agentEmail === 'sam@co.in'));
    check('raw-data TL: TL Andheri does NOT see Dighe team orders', !r.json.orders.some((o: any) => o.agentEmail === 'riya@co.in'));

    // 6. TL tries to query agent outside team -> 403 Forbidden
    r = await call('GET', '/api/raw-data?agentEmail=sam@co.in', { token: tok(L.tlDighe) });
    check('raw-data TL: TL querying agent outside team is 403', r.status === 403);

    // 7. Manager opens raw data -> sees company-wide (all 4 orders and all 2 visits)
    r = await call('GET', '/api/raw-data', { token: tok(L.manager) });
    check('raw-data manager: sees all 4 orders across branches', r.status === 200 && r.json.orders.length === 4);
    check('raw-data manager: sees all 2 visits across branches', r.json.visits.length === 2);
    check('raw-data manager: summary totals correct (1,20,000 revenue)', r.json.summary.totalRevenue === 120000 && r.json.summary.totalOrders === 4);

    // 8. Filters: Location, Category, Search
    r = await call('GET', '/api/raw-data?location=Dighe', { token: tok(L.manager) });
    check('raw-data filter: location=Dighe returns only 2 Dighe orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.location === 'Dighe'));

    r = await call('GET', '/api/raw-data?category=Shopify', { token: tok(L.manager) });
    check('raw-data filter: category=Shopify returns only 2 Shopify orders', r.status === 200 && r.json.orders.length === 2 && r.json.orders.every((o: any) => o.category.includes('Shopify')));

    r = await call('GET', '/api/raw-data?search=9999900003', { token: tok(L.manager) });
    check('raw-data search: phone search returns Sam order and visit', r.status === 200 && r.json.orders.length === 1 && r.json.orders[0].agentEmail === 'sam@co.in');

    // 9. Location Revenue endpoint
    r = await call('GET', '/api/location-revenue?location=Dighe', { token: tok('riya.login@gmail.com') });
    check('location-revenue agent: returns Dighe location summary and breakdown table', r.status === 200 && r.json.locationRevenue.location === 'Dighe' && r.json.locationRevenue.totalRevenue === 40000 && r.json.locationRevenue.rows.length === 1);

    r = await call('GET', '/api/location-revenue?location=Andheri', { token: tok(L.manager) });
    check('location-revenue manager: returns Andheri location summary and breakdown table', r.status === 200 && r.json.locationRevenue.location === 'Andheri' && r.json.locationRevenue.totalRevenue === 80000);

    r = await call('GET', '/api/location-revenue', { token: tok(L.stranger) });
    check('location-revenue: stranger is 403', r.status === 403);

    // 10. Per-Agent Drill-In Scoping for Super Admin & TL
    r = await call('GET', '/api/raw-data?agentEmail=riya@co.in', { token: tok(L.admin) });
    check('raw-data drill-in: Super Admin filtering to Riya sees strictly Riya 2 orders (not all 4)', r.status === 200 && r.json.orders.length === 2 && r.json.summary.totalRevenue === 40000);

    // 11. Day-on-Day (D-o-D) Data Endpoint & RBAC
    r = await call('GET', '/api/dod-data', { token: tok('riya.login@gmail.com') });
    check('dod-data agent: returns Riya daily breakdown alongside Dighe team totals', r.status === 200 && r.json.agent.officialEmail === 'riya@co.in' && r.json.team.location === 'Dighe' && r.json.dailyComparison.length > 0);
    check('dod-data agent: calculations include sales delta and share percentage', r.json.summary.totalAgentSales === 40000 && r.json.dailyComparison.every((d: any) => typeof d.sharePct === 'number'));

    r = await call('GET', '/api/dod-data?agentEmail=sam@co.in', { token: tok('riya.login@gmail.com') });
    check('dod-data agent: requesting other agent data is forced to own data', r.status === 200 && r.json.agent.officialEmail === 'riya@co.in');

    r = await call('GET', '/api/dod-data?agentEmail=sam@co.in', { token: tok(L.tlDighe) });
    check('dod-data TL: TL requesting agent outside team is 403', r.status === 403);

    r = await call('GET', '/api/dod-data?agentEmail=riya@co.in', { token: tok(L.tlDighe) });
    check('dod-data TL: TL Dighe views Riya DoD comparison', r.status === 200 && r.json.agent.officialEmail === 'riya@co.in');

    r = await call('GET', '/api/dod-data?location=Dighe', { token: tok(L.manager) });
    check('dod-data manager: views Dighe team matrix and roster', r.status === 200 && r.json.teamRosterMatrix.length > 0);

    r = await call('GET', '/api/dod-data', { token: tok(L.stranger) });
    check('dod-data: stranger is 403', r.status === 403);

    // 12. Agent Login Tracker / Time-Boxed Access Limits & RBAC
    r = await call('POST', '/api/admin/login-tracker', {
      token: tok(L.admin),
      body: { enabled: true, amWindowMinutes: 30, pmWindowMinutes: 30 },
    });
    check('admin: toggle login tracker status ok', r.status === 200 && r.json.loginTracker.enabled === true);

    r = await call('POST', '/api/agent/heartbeat', { token: tok('riya.login@gmail.com') });
    check('heartbeat agent: initial heartbeat is allowed', r.status === 200 && r.json.allowed === true && r.json.remainingSeconds > 0);

    r = await call('GET', '/api/auth/session', { token: tok('riya.login@gmail.com') });
    check('session agent: includes login tracker session state', r.status === 200 && r.json.loginTracker !== undefined && r.json.loginTracker.allowed === true);

    // Get today's activity listing as admin
    r = await call('GET', '/api/admin/login-tracker/activity', { token: tok(L.admin) });
    check('admin: can list today login activities', r.status === 200 && r.json.activities.length > 0 && r.json.config !== undefined);

    // Non-superAdmin cannot load login activities
    r = await call('GET', '/api/admin/login-tracker/activity', { token: tok(L.tlDighe) });
    check('admin activity: TL cannot load login activities (403)', r.status === 403);

    // Reset usage for Riya
    r = await call('POST', '/api/admin/login-tracker/reset', {
      token: tok(L.admin),
      body: { agentEmail: 'riya@co.in' },
    });
    check('admin: can reset today login usage for an agent', r.status === 200);

    r = await call('GET', '/api/admin/login-tracker/activity', { token: tok(L.admin) });
    const riyaAct = r.json.activities.find((a: any) => a.agentEmail === 'riya@co.in');
    check('admin: riya login time is reset to 0', riyaAct !== undefined && riyaAct.amSecondsUsed === 0 && riyaAct.pmSecondsUsed === 0);
    // ------------------------------------------------------------------
    section('raw data sync: failures are reported, not shown as zero orders');
    await adminDb.collection('cycles').doc(CYCLE).collection('data').doc('rawRecords').delete();
    await adminDb.collection('cycles').doc(CYCLE).collection('data').doc('rawRecordsStatus').delete();
    sheet.calls = 0;
    sheet.answer = { status: 200, type: 'text/html; charset=utf-8', body: '<html>Sign in</html>' }; // not shared publicly
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality } });
    check('sync without raw rows + a sheet that is not public: still ok for incentives, raw failure is a warning with the reason',
      r.json.result === 'ok' && r.json.rawData?.error && r.json.warnings.some((w: string) => /Raw data .*not saved.*Anyone with the link/.test(w)), r.text.slice(0, 400));
    let log = (await adminDb.collection('syncLogs').get()).docs.map((d) => d.data()).sort((a: any, b: any) => String(b.time).localeCompare(String(a.time)))[0];
    check('the raw failure is in the sync log', (log?.warnings || []).some((w: string) => /Raw data/.test(w)), JSON.stringify(log).slice(0, 300));
    r = await call('GET', '/api/raw-data', { token: tok(L.admin) });
    check('raw-data: the Super Admin is told why there is no data', r.status === 200 && r.json.summary.totalOrders === 0 && r.json.syncStatus?.ok === false && /Anyone with the link/.test(r.json.syncStatus.error), JSON.stringify(r.json?.syncStatus));
    const callsAfterFail = sheet.calls;
    await call('GET', '/api/raw-data', { token: tok(L.admin) });
    await call('GET', '/api/raw-data', { token: tok(L.admin) });
    check(`raw-data: a failed fetch is not retried on every page view (cooldown ${RAW_RETRY_COOLDOWN_MS / 60000} min)`, sheet.calls === callsAfterFail, `${callsAfterFail} -> ${sheet.calls}`);
    r = await call('GET', '/api/raw-data', { token: tok('riya.login@gmail.com') });
    check('raw-data: an agent sees that it failed, but not the technical reason', r.status === 200 && r.json.syncStatus?.ok === false && r.json.syncStatus.error === undefined, JSON.stringify(r.json?.syncStatus));

    // Apps Script sends cell values as numbers (Order Value 25000, not "25000"); this used to crash the sync.
    const payloadOrders = [
      { 'Order ID': 'A-1', 'Order Value': 25000, Date: '2026-10-01', 'Order Time': '10:00', 'Order Phone / Alternate Phone': 9999900001, Agent: 'riya@co.in', 'Talk Time Cohort': '10. More than 5 minutes', Category: '1. Shopify', 'Agent Category': 'HO Caller', Channel: 'Website' },
      { 'Order ID': 'A-2', ' Order Value ': '15,000', Date: '2026-10-02', Agent: 'sam@co.in', Category: '4. POS', 'Agent Category': 'Andheri Store Caller', Channel: 'Store' },
    ];
    const payloadVisits = [
      { 'Phone Number': 9999900003, 'Visit Date Time': '2026-10-03 17:49:31', 'Agent ID': 'riya@co.in', Location: 'HO Caller', 'Talk Time (before visit)': 445, 'Visit Source': 'Same Number' },
    ];
    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality, rawRevenueTabRows: payloadOrders, rawVisitRows: payloadVisits } });
    check('sync with raw rows (numeric cells): ok, 2 orders and 1 visit saved, no raw warning',
      r.json.result === 'ok' && r.json.rawData?.ordersCount === 2 && r.json.rawData?.visitsCount === 1 && !r.json.warnings.some((w: string) => /Raw data/.test(w)), r.text.slice(0, 400));
    r = await call('GET', '/api/raw-data', { token: tok(L.admin) });
    check('raw-data after a good sync: 2 orders worth 40,000, 1 visit, status ok', r.json.summary.totalOrders === 2 && r.json.summary.totalRevenue === 40000 && r.json.summary.totalVisits === 1 && r.json.syncStatus?.ok === true, JSON.stringify(r.json?.summary));
    const riyaVisit = r.json.visits.find((v: any) => v.agentEmail === 'riya@co.in');
    check('an "HO Caller" visit is a Dighe visit; numeric talk time is kept', riyaVisit?.location === 'Dighe' && riyaVisit?.talkTimeSeconds === 445, JSON.stringify(riyaVisit));

    r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: realRows(), qualityRows: realQuality, rawRevenueTabRows: [{ foo: 1, bar: 2 }], rawVisitRows: payloadVisits } });
    check('raw rows without an Order Value / Agent header: warning names the missing columns', r.json.result === 'ok' && r.json.warnings.some((w: string) => /Raw_Revenue: missing column Order Value, Agent/.test(w)), r.text.slice(0, 400));
    r = await call('GET', '/api/raw-data', { token: tok(L.admin) });
    check('a bad raw payload does not wipe the last good raw data', r.json.summary.totalOrders === 2, JSON.stringify(r.json?.summary));

    // Manual re-sync from the sheet's CSV export (configured sheet, not the old default one)
    sheet.answer = {
      status: 200,
      type: 'text/csv; charset=utf-8',
      body: (url: string) => /sheet=Raw_Visit/.test(url)
        ? '"Phone Number","Visit Date Time","Agent ID","Location","Talk Time (before visit)","Visit Source"\n"1","2026-10-03 10:00:00","sam@co.in","Andheri","60","Same Number"\n'
        : '"Order ID","Order Value","Date","Agent","Category","Agent Category"\n"B-1","50000","2026-10-04","sam@co.in","1. Shopify","Andheri"\n',
    };
    let lastUrl = '';
    const csvAnswer = sheet.answer.body as (url: string) => string;
    sheet.answer.body = (url: string) => { lastUrl = url; return csvAnswer(url); };
    r = await call('POST', '/api/admin/sync-raw-sheet', { token: tok(L.admin), body: {} });
    const cfgNow = (await adminDb.collection('config').doc('app').get()).data();
    const cfgId = String(cfgNow.googleSpreadsheetUrl || '').match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
    check('manual raw re-sync: reads the configured sheet with headers=1, 1 order and 1 visit', r.status === 200 && r.json.ordersCount === 1 && r.json.visitsCount === 1 && !!cfgId && lastUrl.includes(cfgId) && lastUrl.includes('headers=1'), `${r.status} ${r.text.slice(0, 200)} ${lastUrl}`);
    sheet.answer = { status: 404, type: 'text/html', body: 'Not found' };
    r = await call('POST', '/api/admin/sync-raw-sheet', { token: tok(L.admin), body: {} });
    check('manual raw re-sync failure: 502 with the reason', r.status === 502 && /HTTP 404/.test(r.json?.error), r.text.slice(0, 200));

    // ------------------------------------------------------------------
    section('sync key: only the configured key');
    for (const oldKey of ['tsc-sync-secret-2026', 'CHANGE_ME_TO_24_OR_MORE_RANDOM_CHARACTERS']) {
      r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': oldKey }, body: { mainRows: realRows() } });
      check(`the old built-in key "${oldKey.slice(0, 8)}..." is refused (401)`, r.status === 401, r.text);
    }
    {
      const { gzipSync } = await import('zlib');
      const zipped = await fetch(base + '/api/sync', {
        method: 'POST',
        headers: { 'X-Sync-Key': process.env.SYNC_KEY!, 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
        body: gzipSync(JSON.stringify({ mainRows: realRows(), qualityRows: realQuality })),
      }).then((x) => x.json());
      check('a gzip-compressed sync (what Apps Script sends for a big sheet) is unpacked and accepted', zipped.result === 'ok' && zipped.rows === 10, JSON.stringify(zipped).slice(0, 200));
    }
    r = await call('POST', `/api/sync?key=${encodeURIComponent(process.env.SYNC_KEY!)}`, { body: { mainRows: realRows() } });
    check('the key in the URL is refused (header only, so it never lands in access logs)', r.status === 401, r.text);

    // ------------------------------------------------------------------
    section('location leaderboard: staff only');
    r = await call('GET', `/api/leaderboard?cycleId=${CYCLE}&location=Dighe`, { token: tok('riya.login@gmail.com') });
    check('an agent cannot read the location leaderboard (it carries every total incentive): 403', r.status === 403, r.text.slice(0, 200));
    r = await call('GET', `/api/leaderboard?cycleId=${CYCLE}&location=Dighe`, { token: tok(L.tlDighe) });
    check('a TL reads their own location', r.status === 200, r.text.slice(0, 200));
    r = await call('GET', `/api/leaderboard?cycleId=${CYCLE}&location=Andheri`, { token: tok(L.tlDighe) });
    check('a TL cannot read another location: 403', r.status === 403, r.text.slice(0, 200));
    r = await call('GET', `/api/dod-data?cycleId=${CYCLE}&location=Andheri`, { token: tok(L.tlDighe) });
    check('day-on-day: a TL asking for another location gets their own', r.status === 200 && r.json.team.location === 'Dighe', r.text.slice(0, 200));

    // ------------------------------------------------------------------
    section('Leader_Mapping: headers in any spelling, and its Gmail wins');
    r = await call('GET', '/api/auth/session', { token: tok('sam.mapped@gmail.com') });
    check('before the mapping: the new Gmail is refused', r.status === 403);
    r = await call('POST', '/api/sync', {
      headers: { 'X-Sync-Key': process.env.SYNC_KEY! },
      body: {
        mainRows: realRows(),
        qualityRows: realQuality,
        leaderMappingRows: [
          { ' Agent Official Email ': 'sam@co.in', 'agent personal email': 'Sam.Mapped@gmail.com', Status: 'Active' },
          { Agent_Email_Official: 'ghost@co.in', Agent_Gmail_Mail: 'ghost@gmail.com', Status: 'Active' },
        ],
      },
    });
    check('sync ok', r.json?.result === 'ok', r.text.slice(0, 300));
    const warns: string[] = r.json?.warnings || [];
    check('a warning names the Gmail difference between MainSheet and Leader_Mapping', warns.some((w) => w.includes('sam.login@gmail.com') && w.includes('sam.mapped@gmail.com')), JSON.stringify(warns));
    check('a warning names the mapped agent with no MainSheet rows', warns.some((w) => w.includes('ghost@co.in') && /cannot sign in/.test(w)), JSON.stringify(warns));
    r = await call('GET', '/api/auth/session', { token: tok('sam.mapped@gmail.com') });
    check('the mapped Gmail signs in right after the sync (the access cache was dropped)', r.status === 200 && r.json.role === 'agent' && r.json.officialEmail === 'sam@co.in', r.text);
    r = await call('GET', '/api/auth/session', { token: tok('sam.login@gmail.com') });
    check('the old Gmail keeps working (access records are never removed by a sync)', r.status === 200, r.text);

    // ------------------------------------------------------------------
    section('the Manager that used to be in the code');
    const cfgBefore = (await adminDb.collection('config').doc('app').get()).data();
    check('the code no longer makes snehatsc@gmail.com a Manager on its own', !(cfgBefore.managers || []).includes('snehatsc@gmail.com'));
    await adminDb.collection('config').doc('app').set({ ...cfgBefore, legacyManagerMigrated: false });
    invalidateReadCache();
    r = await call('GET', '/api/auth/session', { token: tok('snehatsc@gmail.com') });
    const cfgAfter = (await adminDb.collection('config').doc('app').get()).data();
    check('an existing project keeps her as Manager, now in the managers list', r.json?.role === 'manager' && cfgAfter.managers.includes('snehatsc@gmail.com') && cfgAfter.legacyManagerMigrated === true, r.text);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { managers: cfgAfter.managers.filter((m: string) => m !== 'snehatsc@gmail.com') } });
    r = await call('GET', '/api/auth/session', { token: tok('snehatsc@gmail.com') });
    check('and the Admin tab can remove her like anyone else', r.status === 403, r.text);

    // ------------------------------------------------------------------
    section('raw orders are split over several documents (Firestore: 1 MiB a document)');
    const order = (i: number) => ({
      orderId: `O-${i}`, date: '2026-10-02', orderTime: '', orderValue: 1000, orderPhone: String(9000000000 + i), agentEmail: 'sam@co.in',
      category: '1. Shopify', talkTimeCohort: '', originalPhoneOrMarketplace: '', consideredForOverall: true, consideredForAgent: true,
      agentCategory: 'Andheri', location: 'Andheri', channel: 'Shopify',
    });
    await saveRawRecords(CYCLE, Array.from({ length: 2500 }, (_, i) => order(i)), []);
    const head = (await adminDb.collection('cycles').doc(CYCLE).collection('data').doc('rawRecords').get()).data();
    check('2,500 orders: 3 chunks, and no rows in the summary document', head.orderChunks === 3 && head.orders === undefined && head.ordersCount === 2500, JSON.stringify({ ...head, locationSummaries: undefined }));
    const back = await getOrLoadRawRecords(CYCLE);
    check('they read back complete and in order', back.orders.length === 2500 && back.orders[0].orderId === 'O-0' && back.orders[2499].orderId === 'O-2499');
    await saveRawRecords(CYCLE, [order(1)], []);
    const left = await adminDb.collection('cycles').doc(CYCLE).collection('data').doc('rawRecords').collection('chunks').doc('orders-2').get();
    invalidateRawCache();
    check('a smaller save removes the leftover chunks', !left.exists && (await getOrLoadRawRecords(CYCLE)).orders.length === 1);
  } finally {
    setGeminiForTests(null);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ------------------------------------------------------------------
  section('a broken Firestore is reported, never hidden');
  const fake = await startFakeFirestore();
  try {
    process.env.DB_MODE = 'firestore';
    process.env.FIRESTORE_REST_BASE = fake.url;
    process.env.GOOGLE_CLOUD_PROJECT = 'demo-project';
    process.env.METADATA_SERVER_DETECTION = 'none';
    resetBackendForTests();

    const app2 = createApiApp({ verifyIdToken: fakeVerify });
    const s2: Server = await new Promise((resolve) => {
      const s = app2.listen(0, '127.0.0.1', () => resolve(s));
    });
    const b2 = `http://127.0.0.1:${(s2.address() as AddressInfo).port}`;
    try {
      fake.failNext = { status: 403, message: 'Missing or insufficient permissions.', state: 'PERMISSION_DENIED', times: 1000 };
      const health = await fetch(b2 + '/api/health').then(async (x) => ({ status: x.status, json: await x.json() }));
      check('health: 500 with the reason when Firestore refuses the server', health.status === 500 && health.json.status === 'error' && health.json.storage === 'firestore' && /HTTP 403/.test(health.json.message), JSON.stringify(health));

      const sync = await fetch(b2 + '/api/sync', { method: 'POST', headers: { 'X-Sync-Key': process.env.SYNC_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ mainRows: realRows(), qualityRows: realQuality }) }).then(async (x) => ({ status: x.status, json: await x.json() }));
      check('sync: reports an ERROR (never "ok") when nothing could be saved', sync.json.result === 'error' && /HTTP 403/.test(sync.json.error || ''), JSON.stringify(sync).slice(0, 300));

      const session = await fetch(b2 + '/api/auth/session', { headers: { Authorization: `Bearer ${tok(L.admin)}` } }).then(async (x) => ({ status: x.status, json: await x.json() }));
      check('sign-in: a database error is a 500 with the reason, not "access denied"', session.status === 500 && /HTTP 403/.test(session.json.error), JSON.stringify(session));
      check('nothing was stored', fake.docs.size === 0);

      fake.failNext = null;
      await new Promise((r2) => setTimeout(r2, 10100)); // the health answer is cached for 10 s
      const healthOk = await fetch(b2 + '/api/health').then(async (x) => ({ status: x.status, json: await x.json() }));
      check('health: ok again once Firestore accepts the server, and the data really is in Firestore', healthOk.status === 200 && fake.docs.has('health/ping'), JSON.stringify(healthOk));
      const syncOk = await fetch(b2 + '/api/sync', { method: 'POST', headers: { 'X-Sync-Key': process.env.SYNC_KEY!, 'Content-Type': 'application/json' }, body: JSON.stringify({ mainRows: realRows(), qualityRows: realQuality }) }).then(async (x) => ({ status: x.status, json: await x.json() }));
      check('sync: ok against the (fake) Firestore, agents, access records and leaderboards all saved', syncOk.json.result === 'ok' && fake.docs.has(`cycles/${CYCLE}/agents/riya@co.in`) && fake.docs.has('access/riya.login@gmail.com') && fake.docs.has(`cycles/${CYCLE}/leaderboards/Dighe`) && fake.docs.has('config/app'), JSON.stringify(syncOk).slice(0, 200));
    } finally {
      await new Promise<void>((resolve) => s2.close(() => resolve()));
    }
  } finally {
    await fake.close();
    delete process.env.FIRESTORE_REST_BASE;
    process.env.DB_MODE = 'local';
    if (savedManagerEmails !== undefined) process.env.MANAGER_EMAILS = savedManagerEmails;
    setRawSheetFetchForTests(null);
    resetBackendForTests();
  }
}
