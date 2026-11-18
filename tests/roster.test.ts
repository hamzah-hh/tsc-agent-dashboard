import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { resetBackendForTests } from '../server-firebase-admin';
import { createApiApp } from '../server-routes';
import { setRawSheetFetchForTests } from '../server-raw-data';
import { setRosterDbForTests } from '../server-roster-db';
import { setRosterClockForTests } from '../server-roster';
import { check, section } from './harness';
import { createTestRosterDb } from './pglite';

// A token is just "test:<email>:<name>". The fake verifier stands in for Firebase Admin.
const tok = (email: string, name = email.split('@')[0]) => `test:${email}:${name}`;
const fakeVerify = async (token: string) => {
  const parts = token.split(':');
  if (parts[0] !== 'test' || !parts[1]) throw new Error('bad test token');
  return { email: parts[1], name: parts[2], email_verified: true };
};

/** An IST wall-clock moment as a UTC timestamp. */
const ist = (day: string, h = 0, m = 0) => Date.parse(day + 'T00:00:00Z') + (h * 60 + m) * 60000 - 330 * 60000;

const L = {
  admin: 'agha.h489@gmail.com',
  manager: 'roster.manager@gmail.com',
  tlA: 'tl.a.login@gmail.com',
  tlB: 'tl.b.login@gmail.com',
  stranger: 'nobody.at.all@gmail.com',
};
const A = (i: number) => ({ official: `a${i}@co.in`, login: `a${i}.login@gmail.com`, name: `Agent ${i}` });
const B = (i: number) => ({ official: `b${i}@co.in`, login: `b${i}.login@gmail.com`, name: `Store ${i}` });
const TEAM_A = 'tl.a@x.in';
const TEAM_B = 'tl.b@x.in';

function row(o: Record<string, any>) {
  return {
    Date: '2026-10-01', Month: 'Oct-26', Agent_Name: '', Agent_Email_Official: '', Agent_Email_Personal: '', Agent_Location: 'Dighe',
    Agent_Tier: 'HO Callers', Count_of_Orders: 4, Sales: 200000, Average_Order_Value: 50000, Unique_Connects: 150, Talk_Time_Minutes: 183,
    TL_Official_Email: TEAM_A, TL_Personal_Email: L.tlA, Store_Visits_Booked: 3, Store_Visits_Attributed: 3, Day: 1, Inbound_Calls: '', Avg_TT_per_day: '', ...o,
  };
}

function rows() {
  const out: any[] = [];
  for (let d = 1; d <= 2; d++) {
    const Date = `2026-10-0${d}`;
    for (let i = 1; i <= 6; i++) out.push(row({ Date, Agent_Name: A(i).name, Agent_Email_Official: A(i).official, Agent_Email_Personal: A(i).login }));
    for (let i = 1; i <= 2; i++) {
      out.push(row({ Date, Agent_Name: B(i).name, Agent_Email_Official: B(i).official, Agent_Email_Personal: B(i).login, Agent_Location: 'Andheri', Agent_Tier: 'Store Callers', TL_Official_Email: TEAM_B, TL_Personal_Email: L.tlB }));
    }
  }
  return out;
}

export async function runRosterTests() {
  const savedManagerEmails = process.env.MANAGER_EMAILS;
  const savedDbUrl = process.env.DATABASE_URL;
  delete process.env.MANAGER_EMAILS;
  delete process.env.DATABASE_URL;
  process.env.DB_MODE = 'local';
  process.env.DB_LOCAL_FILE = 'none';
  process.env.SYNC_KEY = 'sync-key-for-tests-1234567890';
  delete process.env.GEMINI_API_KEY;
  resetBackendForTests();
  setRawSheetFetchForTests((async () => new Response('"Order ID","Order Value","Agent"\n', { status: 200, headers: { 'content-type': 'text/csv' } })) as typeof fetch);

  const rosterDb = await createTestRosterDb();
  setRosterDbForTests(rosterDb);
  let now = ist('2026-11-18', 10, 0); // Wednesday
  setRosterClockForTests(() => now);

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
  let n = 0;
  const rid = () => `req-${String(++n).padStart(8, '0')}`;
  const book = (login: string, day: string, kind: 'WO' | 'PL' = 'WO', extra: Record<string, any> = {}) =>
    call('POST', '/api/roster/entries', { token: tok(login), body: { day, kind, requestId: rid(), ...extra } });
  const asAgent = (i: number) => A(i).login;
  const msg = (r: { json: any }) => `${r.json?.code || ''} ${r.json?.error || ''}`;

  try {
    // ------------------------------------------------------------------
    section('rostering: setup, the switch and the pilot');
    let r = await call('POST', '/api/sync', { headers: { 'X-Sync-Key': process.env.SYNC_KEY! }, body: { mainRows: rows() } });
    check('sync: 8 agents in two teams', r.status === 200 && r.json.agents === 8, r.text.slice(0, 200));
    await call('POST', '/api/admin/config', { token: tok(L.admin), body: { managers: [L.manager] } });

    r = await call('GET', '/api/roster/status');
    check('status without a token: 401', r.status === 401);
    r = await call('GET', '/api/roster/status', { token: tok(L.stranger) });
    check('status for a stranger: not enabled, no error', r.status === 200 && r.json.enabled === false, r.text);
    r = await call('GET', '/api/roster/status', { token: tok(asAgent(1)) });
    check('switched off by default: the agent does not get the tab', r.status === 200 && r.json.enabled === false, r.text);
    r = await book(asAgent(1), '2026-11-19');
    check('switched off: booking is refused (404 ROSTER_OFF)', r.status === 404 && r.json.code === 'ROSTER_OFF', r.text);

    r = await call('POST', '/api/admin/config', { token: tok(asAgent(1)), body: { roster: { enabled: true } } });
    check('an agent cannot switch rostering on (403)', r.status === 403);
    r = await call('POST', '/api/admin/config', { token: tok(L.admin), body: { roster: { enabled: true, pilotTeams: [TEAM_A] } } });
    check('the Super Admin switches it on for one pilot team', r.status === 200 && r.json.config.roster.enabled === true && r.json.config.roster.pilotTeams[0] === TEAM_A, r.text.slice(0, 300));
    const st = async (login: string) => (await call('GET', '/api/roster/status', { token: tok(login) })).json;
    check('pilot: team A agent and TL get it; team B and its TL do not',
      (await st(asAgent(1))).enabled === true && (await st(L.tlA)).enabled === true && (await st(B(1).login)).enabled === false && (await st(L.tlB)).enabled === false);
    check('managers and the Super Admin always get it', (await st(L.manager)).enabled === true && (await st(L.admin)).role === 'superAdmin');
    r = await book(B(1).login, '2026-11-19');
    check('a team outside the pilot cannot book (404)', r.status === 404, r.text);

    setRosterDbForTests(null);
    r = await call('GET', '/api/roster/status', { token: tok(asAgent(1)) });
    check('no roster database: the tab is shown as unavailable', r.json?.enabled === true && r.json?.unavailable === true, r.text);
    r = await book(asAgent(1), '2026-11-19');
    check('no roster database: 503, and the rest of the app is untouched', r.status === 503 && r.json.code === 'ROSTER_DB_UNAVAILABLE', r.text);
    r = await call('GET', '/api/auth/session', { token: tok(asAgent(1)) });
    check('the rest of the app still works without it', r.status === 200 && r.json.role === 'agent');
    setRosterDbForTests(rosterDb);

    await call('POST', '/api/admin/config', { token: tok(L.admin), body: { roster: { enabled: true, pilotTeams: [TEAM_A, TEAM_B] } } });

    // ------------------------------------------------------------------
    section('rostering: booking rules (team A has 6 agents: default weekday limit 2)');
    r = await book(asAgent(1), '2026-11-19');
    const first = r.json?.entry;
    check('first WO of the week, weekday, under the limit: confirmed at once', r.status === 200 && first?.status === 'approved' && first.needsApproval === false && first.source === 'self', r.text);
    r = await book(asAgent(2), '2026-11-19');
    check('a second agent takes the second slot (2 of 2)', r.status === 200 && r.json.entry.status === 'approved', r.text);
    r = await book(asAgent(3), '2026-11-19');
    check('the third is refused: the day is full (LIMIT_REACHED, says the limit and the day)', r.status === 409 && r.json.code === 'LIMIT_REACHED' && /limit for Thu 19 Nov is 2/.test(r.json.error), msg(r));

    const reqId = 'req-replay-0001';
    r = await call('POST', '/api/roster/entries', { token: tok(asAgent(4)), body: { day: '2026-11-20', kind: 'WO', requestId: reqId } });
    const a4Fri = r.json?.entry;
    const r2 = await call('POST', '/api/roster/entries', { token: tok(asAgent(4)), body: { day: '2026-11-20', kind: 'WO', requestId: reqId } });
    check('a retry with the same request id returns the same entry (no second booking)', r2.status === 200 && r2.json.replayed === true && r2.json.entry.id === a4Fri?.id, r2.text);
    r = await call('POST', '/api/roster/entries', { token: tok(asAgent(5)), body: { day: '2026-11-20', kind: 'WO', requestId: reqId } });
    check('another agent cannot reuse that request id (409)', r.status === 409 && r.json.code === 'REQUEST_REUSED', msg(r));
    r = await call('GET', '/api/roster/me', { token: tok(asAgent(4)) });
    check('the replay created exactly one row', r.json.entries.filter((e: any) => e.day === '2026-11-20').length === 1, r.text.slice(0, 200));

    r = await book(asAgent(1), '2026-11-20');
    const a1Fri = r.json?.entry;
    check('a second WO in the same week waits for the TL (pending)', r.status === 200 && a1Fri?.status === 'pending' && a1Fri.needsApproval === true, r.text);
    r = await book(asAgent(4), '2026-11-21');
    const a4Sat = r.json?.entry;
    check('a Saturday WO always waits for the TL (pending), even with room', r.status === 200 && a4Sat?.status === 'pending', r.text);
    r = await book(asAgent(5), '2026-11-23', 'PL');
    const a5Pl = r.json?.entry;
    check('planned leave always waits for the TL (pending)', r.status === 200 && a5Pl?.status === 'pending' && a5Pl.kind === 'PL', r.text);
    r = await book(asAgent(5), '2027-01-17', 'PL', { reason: 'Family wedding' });
    check('PL can be booked 60 days ahead (17 Jan 2027)', r.status === 200 && r.json.entry.status === 'pending', r.text);
    r = await book(asAgent(5), '2027-01-18', 'PL');
    check('PL beyond 60 days is refused (409 WINDOW)', r.status === 409 && r.json.code === 'WINDOW', msg(r));
    r = await book(asAgent(6), '2026-12-07');
    check('a WO after the Sunday two weeks ahead is refused (6 Dec is the last day)', r.status === 409 && r.json.code === 'WINDOW', msg(r));
    r = await book(asAgent(6), '2026-12-06');
    check('a WO on that last Sunday is allowed (pending: a weekend)', r.status === 200 && r.json.entry.status === 'pending', r.text);
    r = await book(asAgent(6), '2026-11-18');
    check('today is closed to agents (the cut-off was 18:00 yesterday)', r.status === 409 && r.json.code === 'WINDOW', msg(r));
    r = await book(asAgent(6), '2026-11-17');
    check('a past day is refused', r.status === 409 && /passed/.test(r.json.error), msg(r));
    r = await book(asAgent(1), '2026-11-19', 'PL');
    check('a second entry on the same day is refused (ALREADY_BOOKED)', r.status === 409 && r.json.code === 'ALREADY_BOOKED', msg(r));
    r = await call('POST', '/api/roster/entries', { token: tok(asAgent(6)), body: { day: '2026-11-24', kind: 'XX', requestId: rid() } });
    check('a bad kind is a 400', r.status === 400);
    r = await call('POST', '/api/roster/entries', { token: tok(asAgent(6)), body: { day: 'tomorrow', kind: 'WO', requestId: rid() } });
    check('a bad date is a 400', r.status === 400);
    r = await call('POST', '/api/roster/entries', { token: tok(asAgent(6)), body: { day: '2026-11-24', kind: 'WO' } });
    check('a missing request id is a 400', r.status === 400);
    r = await book(asAgent(6), '2026-11-24', 'PL', { reason: 'x'.repeat(301) });
    check('a note over 300 characters is a 400', r.status === 400);

    // The cut-off moves with the clock: at 18:01 Wednesday, Thursday is closed to agents but still open to the TL
    now = ist('2026-11-18', 18, 1);
    r = await book(asAgent(6), '2026-11-19');
    check('after 18:00 the day before, an agent can no longer book (cut-off)', r.status === 409 && r.json.code === 'WINDOW' && /closed at 18:00/.test(r.json.error), msg(r));
    r = await call('POST', '/api/roster/entries', { token: tok(L.tlA), body: { day: '2026-11-19', kind: 'WO', requestId: rid(), agentEmail: A(6).official, override: true, reason: 'Medical' } });
    check('the TL can still set it for them until the day starts (confirmed at once, source tl)', r.status === 200 && r.json.entry.status === 'approved' && r.json.entry.source === 'tl', r.text);
    r = await call('POST', '/api/roster/entries', { token: tok(L.tlA), body: { day: '2026-11-18', kind: 'WO', requestId: rid(), agentEmail: A(3).official } });
    check('but not for today', r.status === 409 && r.json.code === 'WINDOW', msg(r));
    now = ist('2026-11-18', 10, 0);

    section('rostering: at most 3 changes a week');
    r = await book(B(1).login, '2026-11-24');
    const b1Tue = r.json?.entry;
    check('b1 books a Tuesday (change 1)', r.status === 200 && b1Tue?.status === 'approved', r.text);
    r = await call('POST', `/api/roster/entries/${b1Tue.id}/cancel`, { token: tok(B(1).login), body: {} });
    check('and cancels it (change 2)', r.status === 200 && r.json.entry.status === 'cancelled', r.text);
    r = await book(B(1).login, '2026-11-25');
    check('books again (change 3)', r.status === 200 && r.json.entry.status === 'approved', r.text);
    r = await book(B(1).login, '2026-11-26');
    check('the fourth change is refused (CHURN_LIMIT)', r.status === 409 && r.json.code === 'CHURN_LIMIT', msg(r));
    r = await call('GET', '/api/roster/me', { token: tok(B(1).login) });
    const wedEntry = r.json.entries.find((e: any) => e.day === '2026-11-25');
    r = await call('POST', `/api/roster/entries/${wedEntry.id}/cancel`, { token: tok(B(1).login), body: {} });
    check('so is a cancel once the changes are used up', r.status === 409 && r.json.code === 'CHURN_LIMIT', msg(r));

    // ------------------------------------------------------------------
    section('rostering: who can see and do what');
    r = await call('GET', '/api/roster/me', { token: tok(L.stranger) });
    check('a stranger is refused', r.status === 403, r.text);
    r = await call('GET', '/api/roster/me?agent=a2@co.in', { token: tok(asAgent(1)) });
    check('an agent always gets their own roster, whatever agent= says', r.status === 200 && r.json.agentName === 'Agent 1', r.text.slice(0, 120));
    r = await call('GET', '/api/roster/me?agent=a1@co.in', { token: tok(L.tlA) });
    check('a TL opens one of their agents (read-only view)', r.status === 200 && r.json.agentName === 'Agent 1');
    r = await call('GET', '/api/roster/me?agent=b1@co.in', { token: tok(L.tlA) });
    check('a TL cannot open another team\'s agent (404)', r.status === 404, r.text);
    r = await call('GET', '/api/roster/team', { token: tok(asAgent(1)) });
    check('an agent cannot open the team grid (403)', r.status === 403);
    r = await call('GET', '/api/roster/team', { token: tok(L.tlA) });
    check('the TL sees their team: 6 agents, team size 6, default limit 2 on a weekday, none on a weekend',
      r.status === 200 && r.json.agents.length === 6 && r.json.teamSize === 6 && r.json.days.find((d: any) => d.day === '2026-11-19')?.limit === 2 && r.json.days.find((d: any) => d.day === '2026-11-21')?.limit === null, r.text.slice(0, 200));
    r = await call('GET', '/api/roster/team', { token: tok(L.tlB) });
    check('the other TL sees only theirs (2 agents)', r.status === 200 && r.json.agents.length === 2 && r.json.entries.every((e: any) => e.agentEmail.startsWith('b')), r.text.slice(0, 200));
    r = await call('GET', `/api/roster/team?team=${TEAM_A}`, { token: tok(L.tlB) });
    check('a TL asking for another team is refused (403)', r.status === 403);
    r = await call('GET', `/api/roster/team?team=${TEAM_A}`, { token: tok(L.manager) });
    check('a manager can open any team', r.status === 200 && r.json.agents.length === 6);
    r = await call('POST', `/api/roster/entries/${a1Fri.id}/decision`, { token: tok(L.tlB), body: { decision: 'approve' } });
    check('another team\'s TL cannot decide a request (404)', r.status === 404, r.text);
    r = await call('POST', `/api/roster/entries/${a1Fri.id}/cancel`, { token: tok(L.tlB), body: {} });
    check('nor cancel it', r.status === 404);
    r = await call('POST', `/api/roster/entries/${a1Fri.id}/decision`, { token: tok(asAgent(1)), body: { decision: 'approve' } });
    check('an agent cannot approve their own request (403)', r.status === 403);
    r = await call('POST', `/api/roster/entries/${a1Fri.id}/cancel`, { token: tok(asAgent(2)), body: {} });
    check('an agent cannot cancel someone else\'s entry (404)', r.status === 404);

    // ------------------------------------------------------------------
    section('rostering: approvals');
    r = await call('GET', '/api/roster/approvals', { token: tok(L.tlA) });
    const pendingIds = (r.json.entries || []).map((e: any) => e.id);
    check('the TL queue holds the pending requests (a1 2nd WO, a4 Saturday, a5 PL x2, a6 Sunday), oldest first',
      r.status === 200 && r.json.count === 5 && pendingIds.includes(a1Fri.id) && pendingIds.includes(a4Sat.id) && pendingIds.includes(a5Pl.id), r.text.slice(0, 300));
    check('each request shows the day\'s load', r.json.loads[a1Fri.id]?.limit === 2, JSON.stringify(r.json.loads[a1Fri.id]));
    r = await call('POST', `/api/roster/entries/${a5Pl.id}/decision`, { token: tok(L.tlA), body: { decision: 'reject' } });
    check('rejecting needs a reason (400)', r.status === 400 && r.json.code === 'NOTE_REQUIRED', msg(r));
    r = await call('POST', `/api/roster/entries/${a5Pl.id}/decision`, { token: tok(L.tlA), body: { decision: 'reject', note: 'Sale week' } });
    check('rejected with a reason', r.status === 200 && r.json.entry.status === 'rejected' && r.json.entry.decisionNote === 'Sale week', r.text);
    r = await call('POST', `/api/roster/entries/${a5Pl.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve' } });
    check('deciding again is a 409', r.status === 409 && r.json.code === 'STATE', msg(r));
    r = await call('GET', '/api/notifications', { token: tok(asAgent(5)) });
    check('the agent is told in the app', r.json.items.some((x: any) => x.kind === 'rejected' && /Sale week/.test(x.body)) && r.json.unread >= 1, r.text.slice(0, 300));
    r = await book(asAgent(5), '2026-11-23', 'PL');
    check('a rejected request frees the day: the agent can ask again', r.status === 200 && r.json.entry.status === 'pending', r.text);
    r = await call('POST', `/api/roster/entries/${a1Fri.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve', note: 'ok' } });
    check('the TL approves a second WO', r.status === 200 && r.json.entry.status === 'approved' && r.json.entry.decidedBy === L.tlA, r.text);
    r = await call('POST', `/api/roster/entries/${a4Sat.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve' } });
    check('and a Saturday WO (no weekend limit set: the TL decides)', r.status === 200 && r.json.entry.status === 'approved', r.text);
    r = await call('GET', '/api/notifications', { token: tok(L.tlA) });
    check('the TL\'s inbox has the approval requests', r.json.items.some((x: any) => x.kind === 'approval_needed') && r.json.unread > 0, r.text.slice(0, 200));
    r = await call('POST', '/api/notifications/read', { token: tok(L.tlA), body: {} });
    const inbox = await call('GET', '/api/notifications', { token: tok(L.tlA) });
    check('marking read clears the badge', r.status === 200 && inbox.json.unread === 0);
    r = await call('POST', '/api/roster/entries', { token: tok(L.tlA), body: { day: '2026-12-03', kind: 'WO', requestId: rid(), agentEmail: A(3).official } });
    check('a TL can set a WO for an agent: confirmed at once', r.status === 200 && r.json.entry.status === 'approved' && r.json.entry.source === 'tl', r.text);
    r = await call('GET', '/api/notifications', { token: tok(asAgent(3)) });
    check('the agent is told what their TL did', r.json.items.some((x: any) => x.kind === 'set_by_staff'));
    r = await call('POST', '/api/roster/entries', { token: tok(L.manager), body: { day: '2026-12-02', kind: 'WO', requestId: rid(), agentEmail: A(3).official } });
    check('a manager acting for an agent must say why (400)', r.status === 400 && r.json.code === 'NOTE_REQUIRED', msg(r));
    r = await call('POST', '/api/roster/entries', { token: tok(L.manager), body: { day: '2026-12-02', kind: 'WO', requestId: rid(), agentEmail: A(3).official, reason: 'Agent asked by phone' } });
    check('with a reason it works (source manager)', r.status === 200 && r.json.entry.source === 'manager', r.text);
    r = await call('POST', '/api/roster/entries', { token: tok(L.tlA), body: { day: '2026-12-03', kind: 'WO', requestId: rid(), agentEmail: B(1).official } });
    check('a TL cannot book for another team\'s agent (404)', r.status === 404);

    // ------------------------------------------------------------------
    section('rostering: limits');
    r = await call('PUT', '/api/roster/limits', { token: tok(asAgent(1)), body: { maxInactive: 1 } });
    check('an agent cannot set limits (403)', r.status === 403);
    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { maxInactive: -1 } });
    check('a negative limit is a 400', r.status === 400);
    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { maxInactive: 1, day: '2026-11-10' } });
    check('a limit for a past day is refused', r.status === 409);
    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { maxInactive: 1, team: TEAM_B } });
    check('a TL cannot set another team\'s limit (403)', r.status === 403);
    r = await call('PUT', '/api/roster/limits', { token: tok(L.manager), body: { maxInactive: 1 } });
    check('a manager must say which team (400)', r.status === 400);
    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { day: '2026-11-26', maxInactive: 1, note: 'Sale' } });
    check('the TL sets a limit of 1 for Thu 26 Nov', r.status === 200 && r.json.maxInactive === 1, r.text);
    r = await book(asAgent(1), '2026-11-26');
    check('a1 takes the one slot (pending, it is their 2nd... no: first WO that week; confirmed)', r.status === 200, r.text);
    r = await book(asAgent(2), '2026-11-26');
    check('a2 is refused: the date limit is 1', r.status === 409 && r.json.code === 'LIMIT_REACHED' && /limit for Thu 26 Nov is 1/.test(r.json.error), msg(r));

    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { maxInactive: 1 } });
    check('the TL sets an all-days limit of 1', r.status === 200);
    r = await book(asAgent(2), '2026-11-27');
    check('a2 takes Fri 27 (all-days limit 1)', r.status === 200 && r.json.entry.status === 'approved', r.text);
    r = await book(asAgent(3), '2026-11-27');
    check('a3 is refused on Fri 27: the all-days limit applies', r.status === 409 && r.json.code === 'LIMIT_REACHED', msg(r));
    r = await call('GET', '/api/roster/team', { token: tok(L.tlA) });
    check('the grid warns that limits of 1 cannot give 6 agents a WO (5 weekday slots a week)', /allow only 5/.test(r.json.feasibility || ''), r.json.feasibility);
    r = await call('DELETE', '/api/roster/limits', { token: tok(L.tlA) });
    check('clearing the all-days limit', r.status === 200);
    r = await book(asAgent(3), '2026-11-27');
    check('back to the default of 2: a3 gets Fri 27', r.status === 200, r.text);

    section('rostering: lowering a limit keeps what is booked');
    r = await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { day: '2026-11-19', maxInactive: 1 } });
    r = await call('GET', '/api/roster/team', { token: tok(L.tlA) });
    const d19 = r.json.days.find((d: any) => d.day === '2026-11-19');
    check('Thu 19 now has 3 off (a1, a2 and the TL-set a6) against a limit of 1: flagged over-booked, nothing cancelled', d19.used === 3 && d19.limit === 1 && d19.overBooked === true, JSON.stringify(d19));
    r = await call('GET', '/api/roster/me', { token: tok(asAgent(1)) });
    const a1Thu = r.json.entries.find((e: any) => e.day === '2026-11-19');
    check('the agent still sees their WO', a1Thu?.status === 'approved');
    now = ist('2026-11-18', 12, 0);
    const a2Thu = (await call('GET', '/api/roster/me', { token: tok(asAgent(2)) })).json.entries.find((e: any) => e.day === '2026-11-19');
    r = await call('POST', `/api/roster/entries/${a2Thu.id}/revoke`, { token: tok(L.tlA), body: {} });
    check('revoking needs a reason (400)', r.status === 400 && r.json.code === 'NOTE_REQUIRED');
    r = await call('POST', `/api/roster/entries/${a2Thu.id}/revoke`, { token: tok(L.tlA), body: { note: 'Short-staffed' } });
    check('the TL revokes a WO', r.status === 200 && r.json.entry.status === 'revoked', r.text);
    r = await call('GET', '/api/notifications', { token: tok(asAgent(2)) });
    check('the agent is told why', r.json.items.some((x: any) => x.kind === 'revoked' && /Short-staffed/.test(x.body)));
    r = await call('POST', `/api/roster/entries/${a2Thu.id}/revoke`, { token: tok(L.tlA), body: { note: 'again' } });
    check('revoking twice is a 409', r.status === 409);

    section('rostering: weekend approvals follow a limit the TL set');
    await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { day: '2026-11-28', maxInactive: 1 } });
    r = await book(asAgent(3), '2026-11-28');
    const wkA = r.json?.entry;
    r = await book(asAgent(6), '2026-11-28');
    const wkB = r.json?.entry;
    check('two agents ask for the same Saturday: both requests are accepted (the TL decides)', wkA?.status === 'pending' && wkB?.status === 'pending');
    r = await call('POST', `/api/roster/entries/${wkA.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve' } });
    check('the first approval uses the one slot', r.status === 200 && r.json.entry.status === 'approved', r.text);
    r = await call('POST', `/api/roster/entries/${wkB.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve' } });
    check('the second would exceed the limit: refused (LIMIT_REACHED)', r.status === 409 && r.json.code === 'LIMIT_REACHED', msg(r));
    r = await call('POST', `/api/roster/entries/${wkB.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve', override: true } });
    check('an override needs a reason (400)', r.status === 400 && r.json.code === 'NOTE_REQUIRED');
    r = await call('POST', `/api/roster/entries/${wkB.id}/decision`, { token: tok(L.tlA), body: { decision: 'approve', override: true, note: 'Covered by Priya' } });
    check('with a reason it is approved and marked over the limit', r.status === 200 && r.json.entry.status === 'approved' && r.json.entry.overLimit === true, r.text);

    section('rostering: the last slot goes to exactly one agent');
    await call('PUT', '/api/roster/limits', { token: tok(L.tlA), body: { day: '2026-12-01', maxInactive: 2 } });
    const racers = [2, 3, 4, 6].map((i) => book(asAgent(i), '2026-12-01'));
    const results = await Promise.all(racers);
    const won = results.filter((x) => x.status === 200).length;
    const lost = results.filter((x) => x.status === 409 && x.json.code === 'LIMIT_REACHED').length;
    check('four agents ask for a day with 2 slots at the same time: exactly 2 get it, 2 are refused', won === 2 && lost === 2, JSON.stringify(results.map((x) => x.status)));
    const day = (await call('GET', '/api/roster/team', { token: tok(L.tlA) })).json.days.find((d: any) => d.day === '2026-12-01');
    check('and the count says so', day.used === 2 && day.left === 0);

    // ------------------------------------------------------------------
    section('rostering: history, export, expiry');
    r = await call('GET', '/api/roster/audit', { token: tok(asAgent(1)) });
    check('an agent cannot read the audit trail (403)', r.status === 403);
    r = await call('GET', '/api/roster/audit', { token: tok(L.tlA) });
    const actions = new Set((r.json.items || []).map((x: any) => x.action));
    check('the TL reads their team\'s history: book, approve, reject, revoke and limit changes are all there',
      r.status === 200 && ['book', 'approve', 'reject', 'revoke', 'limit_set', 'limit_clear'].every((a) => actions.has(a)), [...actions].join());
    check('every audit row names who did it and in what role', (r.json.items as any[]).every((x) => x.actor && x.actorRole));
    r = await call('GET', '/api/roster/audit', { token: tok(L.tlB) });
    check('another team\'s TL sees only their own history (b1\'s cancel), none of team A\'s', r.status === 200 && r.json.items.length > 0 && r.json.items.every((x: any) => x.teamKey === TEAM_B) && r.json.items.some((x: any) => x.action === 'cancel'), r.text.slice(0, 200));
    r = await call('GET', '/api/roster/export', { token: tok(L.tlA) });
    check('CSV export: header and team A rows only', r.status === 200 && /^Date,Agent,Official Email/.test(r.text) && r.text.includes('a1@co.in') && !r.text.includes('b1@co.in'), r.text.slice(0, 200));

    now = ist('2026-11-23', 10, 0); // Monday: a5's pending PL for today was never approved
    r = await call('GET', '/api/roster/me', { token: tok(asAgent(5)) });
    const a5Mon = r.json.entries.filter((e: any) => e.day === '2026-11-23');
    check('a request nobody approved before its day started has expired (the earlier rejected one stays rejected)', a5Mon.some((e: any) => e.status === 'expired') && a5Mon.some((e: any) => e.status === 'rejected'), JSON.stringify(a5Mon.map((e: any) => e.status)));
    r = await call('GET', '/api/notifications', { token: tok(asAgent(5)) });
    check('and the agent was told', r.json.items.some((x: any) => x.kind === 'expired'));
    r = await call('GET', '/api/roster/me', { token: tok(asAgent(5)) });
    check('the window moved with the clock: WOs now run to Sun 13 Dec', r.json.woLastDay === '2026-12-13' && r.json.today === '2026-11-23', JSON.stringify([r.json.woLastDay, r.json.today]));
  } finally {
    server.close();
    setRosterClockForTests(null);
    setRosterDbForTests(null);
    setRawSheetFetchForTests(null as any);
    if (savedManagerEmails !== undefined) process.env.MANAGER_EMAILS = savedManagerEmails;
    if (savedDbUrl !== undefined) process.env.DATABASE_URL = savedDbUrl;
  }
}
