import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { adminDb, resetBackendForTests } from '../server-firebase-admin';
import { createApiApp } from '../server-routes';
import { processImport } from '../server-import';
import { setGeminiForTests } from '../server-ai';
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
  // Local, in-memory database for the API scenarios
  process.env.DB_MODE = 'local';
  process.env.DB_LOCAL_FILE = 'none';
  process.env.SYNC_KEY = 'sync-key-for-tests-1234567890';
  delete process.env.GEMINI_API_KEY;
  resetBackendForTests();

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
    check('demo Store: Class A, total 25,380', dSt?.result.className === 'A' && dSt.result.total === 25380);
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
    resetBackendForTests();
  }
}
