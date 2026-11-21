/**
 * Rostering API: weekly offs (WO) and planned leave (PL), team limits, approvals, audit trail and the in-app
 * inbox. The rules live in src/shared/roster.ts; this file applies them to the database and enforces who may
 * do what. Registered from createApiApp() in server-routes.ts.
 *
 * Concurrency: the Neon HTTP driver runs non-interactive transactions, so every "check, then write" is one
 * SQL statement, serialised per team-day (and per agent-week) by transaction-scoped advisory locks. Two agents
 * asking for the last slot at the same moment cannot both get it.
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import { getRosterDb, Queryable, Stmt } from './server-roster-db';
import { isAgentOfTl } from './server-scope';
import { normalizeEmail } from './src/shared/incentive';
import { isTestAgentIdentifier } from './src/shared/leaderboard';
import { toCsv } from './src/utils/csv';
import type { AgentRecord, AppConfig } from './src/shared/types';
import {
  ROSTER_RULES,
  RosterDayInfo,
  RosterEntryDTO,
  RosterKind,
  RosterMeResponse,
  RosterNotificationDTO,
  RosterRole,
  RosterStatusResponse,
  RosterSwapDTO,
  RosterTeamResponse,
  ROSTER_SWAP,
  SwapCandidateDTO,
  addDays,
  bookingOutcome,
  canChangeDay,
  dayLabel,
  dayProblem,
  defaultWeekdayLimit,
  effectiveLimit,
  feasibilityWarning,
  firstChangeableDay,
  isDay,
  isWeekend,
  istDay,
  istMidnightMs,
  lastBookableDay,
  sameWeek,
  swapEligible,
  swapExpiryMs,
  teamKeyOf,
  weekEnd,
  weekStart,
} from './src/shared/roster';

import { dispatchPendingPushes, pushConfigured, pushPublicKey, sendTestPush } from './server-push';

// ------------------------------------------------------------------ context from server-routes.ts

type Role = 'superAdmin' | 'manager' | 'tl' | 'agent';

export interface RosterContext {
  authenticate(req: Request): Promise<{ email: string; name: string }>;
  identify(email: string, appConfig: AppConfig): Promise<{ role: Role; access?: { officialEmail?: string; name?: string; location?: string } } | null>;
  ensureSeedData(): Promise<{ appConfig: AppConfig }>;
  loadAgents(cycleId: string): Promise<AgentRecord[]>;
  getExcludedEmails(cycleId: string): Promise<Set<string>>;
  /** The previous cycle's agents during the first 14 days of a new cycle (empty otherwise). */
  loadCarryOverAgents?(appConfig: AppConfig, todayIst: string): Promise<AgentRecord[]>;
}

class RosterError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let clock: () => number = () => Date.now();
/** Tests move the clock (the rules depend on "now" in IST). Pass null to use the real time again. */
export function setRosterClockForTests(fn: (() => number) | null): void {
  clock = fn ?? (() => Date.now());
}

// ------------------------------------------------------------------ who is calling

interface Actor {
  login: string;
  name: string;
  role: RosterRole;
  /** the agent record (role agent) */
  agent?: AgentRecord;
  /** the agents this person may see: their team (TL), everyone (manager, Super Admin) */
  members: AgentRecord[];
  /** team keys this person controls (a TL's own team) or all keys (manager, Super Admin) */
  teamKeys: string[];
  /** every agent, for team sizes */
  everyone: AgentRecord[];
  appConfig: AppConfig;
  /** keys under which this person's notifications are stored */
  inboxKeys: string[];
}

const norm = (s: unknown) => normalizeEmail(s);
const isTestAgent = (a: AgentRecord) => Boolean(a.isTest) || isTestAgentIdentifier(a.officialEmail, a.name);

function pilotAllows(appConfig: AppConfig, actor: { role: RosterRole; agent?: AgentRecord; login: string; officialEmail?: string; members: AgentRecord[] }): boolean {
  const cfg = appConfig.roster;
  if (!cfg?.enabled) return false;
  if (actor.role === 'manager' || actor.role === 'superAdmin') return true;
  const pilot = new Set((cfg.pilotTeams || []).map(norm).filter(Boolean));
  if (pilot.size === 0) return true;
  if (actor.role === 'agent' && actor.agent) {
    return [norm(actor.agent.tlOfficialEmail), norm(actor.agent.tlPersonalEmail), teamKeyOf(actor.agent)].some((k) => k && pilot.has(k));
  }
  if (actor.role === 'tl') {
    if ([norm(actor.login), norm(actor.officialEmail)].some((k) => k && pilot.has(k))) return true;
    return actor.members.some((m) => [norm(m.tlOfficialEmail), norm(m.tlPersonalEmail)].some((k) => k && pilot.has(k)));
  }
  return false;
}

export function registerRosterRoutes(api: Express, ctx: RosterContext): void {
  // Roster handlers answer with {error, code}; anything else goes to the app's own error handler
  const route =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req: Request, res: Response, next: NextFunction) => {
      // A change may have written inbox messages: push them to people's devices before answering
      // (a serverless function can be frozen once the answer is sent)
      if (req.method !== 'GET' && pushConfigured()) {
        const answer = res.json.bind(res);
        res.json = ((body?: any) => {
          const db = getRosterDb();
          (db ? dispatchPendingPushes(db) : Promise.resolve(0)).finally(() => answer(body));
          return res;
        }) as typeof res.json;
      }
      fn(req, res).catch((err: any) => {
        if (err instanceof RosterError) return res.status(err.status).json({ error: err.message, code: err.code });
        if (err && typeof err.status === 'number' && err.message) return res.status(err.status).json({ error: err.message });
        next(err);
      });
    };

  const needDb = (): Queryable => {
    const db = getRosterDb();
    if (!db) throw new RosterError(503, 'ROSTER_DB_UNAVAILABLE', 'Rostering is temporarily unavailable.');
    return db;
  };

  async function resolveActor(req: Request, opts: { requireEnabled?: boolean } = {}): Promise<Actor | null> {
    const user = await ctx.authenticate(req);
    const { appConfig } = await ctx.ensureSeedData();
    const identity = await ctx.identify(user.email, appConfig);
    if (!identity) {
      if (opts.requireEnabled === false) return null;
      throw new RosterError(403, 'FORBIDDEN', 'Access denied.');
    }
    const cycleId = appConfig.activeCycleId;
    const excluded = await ctx.getExcludedEmails(cycleId);
    const everyone = (await ctx.loadAgents(cycleId)).filter((a) => !excluded.has(norm(a.officialEmail)));
    if (ctx.loadCarryOverAgents) {
      const have = new Set(everyone.map((a) => norm(a.officialEmail)));
      for (const a of await ctx.loadCarryOverAgents(appConfig, istDay(clock()))) {
        if (!have.has(norm(a.officialEmail))) everyone.push(a);
      }
    }
    let visible = everyone;
    if (!appConfig.testMode && identity.role !== 'superAdmin') visible = visible.filter((a) => !isTestAgent(a));

    const role = identity.role as RosterRole;
    const base = { login: user.email, name: user.name || identity.access?.name || user.email, role, everyone, appConfig };
    if (role === 'agent') {
      const mine = norm(identity.access?.officialEmail);
      const agent = everyone.find((a) => norm(a.officialEmail) === mine);
      if (!agent) {
        if (opts.requireEnabled === false) return null;
        throw new RosterError(403, 'FORBIDDEN', 'Your agent record was not found.');
      }
      return { ...base, agent, members: [agent], teamKeys: [teamKeyOf(agent)], inboxKeys: [norm(agent.officialEmail)] };
    }
    if (role === 'tl') {
      const members = visible.filter((a) => isAgentOfTl(a, user.email, identity.access));
      const keys = [...new Set(members.map(teamKeyOf))];
      const ownKey = norm(identity.access?.officialEmail) || norm(user.email);
      return { ...base, members, teamKeys: keys.length ? keys : [ownKey], inboxKeys: [...new Set([...keys, ownKey, norm(user.email)])] };
    }
    // manager / Super Admin
    const keys = [...new Set(visible.map(teamKeyOf))];
    return { ...base, members: visible, teamKeys: keys, inboxKeys: [] };
  }

  /** The roster must be switched on for this person; returns the actor. */
  async function actorOrRefuse(req: Request): Promise<Actor> {
    const actor = (await resolveActor(req)) as Actor;
    const officialEmail = actor.agent?.officialEmail;
    if (!pilotAllows(actor.appConfig, { role: actor.role, agent: actor.agent, login: actor.login, officialEmail, members: actor.members })) {
      throw new RosterError(404, 'ROSTER_OFF', 'Rostering is not switched on.');
    }
    return actor;
  }

  const isStaff = (a: Actor) => a.role !== 'agent';

  // ------------------------------------------------------------------ small helpers

  const teamSizeOf = (actor: Actor, key: string, isTest: boolean) =>
    actor.everyone.filter((a) => teamKeyOf(a) === key && isTestAgent(a) === isTest).length;

  const nameOf = (actor: Actor) => {
    const m = new Map<string, string>();
    for (const a of actor.everyone) m.set(norm(a.officialEmail), a.name);
    return (email: string) => m.get(norm(email)) || email;
  };

  const ENTRY_COLS = `e.id::text AS id, e.agent_email, e.day::text AS day, e.kind, e.status, e.needs_approval, e.team_key, e.source, e.reason,
    e.over_limit, e.created_by, to_char(e.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, e.decided_by,
    to_char(e.decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS decided_at, e.decision_note, e.is_test`;

  const toEntry = (row: any, name: (e: string) => string): RosterEntryDTO => ({
    id: row.id,
    agentEmail: row.agent_email,
    agentName: name(row.agent_email),
    day: row.day,
    kind: row.kind,
    status: row.status,
    needsApproval: Boolean(row.needs_approval),
    source: row.source,
    reason: row.reason,
    overLimit: Boolean(row.over_limit),
    createdBy: row.created_by,
    createdAt: row.created_at,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  });

  async function getEntry(db: Queryable, id: string): Promise<any | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.id = $1::uuid`, [id]);
    return rows[0] ?? null;
  }

  async function getEntryByRequest(db: Queryable, requestId: string): Promise<any | null> {
    const rows = await db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.request_id = $1`, [requestId]);
    return rows[0] ?? null;
  }

  const clean = (value: unknown, max: number, field: string): string | null => {
    if (value === undefined || value === null || value === '') return null;
    const s = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (s.length > max) throw new RosterError(400, 'BAD_REQUEST', `${field} can be at most ${max} characters.`);
    return s || null;
  };

  /** Expire pending entries whose day has started (nobody approved them in time); at most once a minute. */
  let lastExpiry = 0;
  async function expireOverdue(db: Queryable, nowMs: number): Promise<void> {
    if (nowMs - lastExpiry < 60000 && nowMs >= lastExpiry) return;
    lastExpiry = nowMs;
    const today = istDay(nowMs);
    await db.batch([
      { text: `UPDATE roster_entry SET status = 'expired', updated_at = now() WHERE status = 'pending' AND day <= $1::date`, params: [today] },
      {
        text: `INSERT INTO app_notification (recipient, kind, title, body, entry_id)
               SELECT agent_email, 'expired', 'Not approved in time', 'Your request for ' || day::text || ' was not approved before the day started.', id
               FROM roster_entry WHERE status = 'expired' AND updated_at = now()`,
      },
      {
        text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail)
               SELECT 'system', 'system', 'expire', id, agent_email, team_key, day, '{}'::jsonb
               FROM roster_entry WHERE status = 'expired' AND updated_at = now()`,
      },
      // A swap request nobody finished before it lapsed
      { text: `UPDATE roster_swap SET status = 'expired', updated_at = now() WHERE status IN ('awaiting_partner','awaiting_tl') AND expires_at <= $1::timestamptz`, params: [new Date(nowMs).toISOString()] },
      {
        text: `INSERT INTO app_notification (recipient, kind, title, body)
               SELECT requester_email, 'swap_expired', 'Swap request expired', 'The swap of ' || requester_day::text || ' and ' || partner_day::text || ' was not finished in time.' FROM roster_swap WHERE status = 'expired' AND updated_at = now()`,
      },
      {
        text: `INSERT INTO app_notification (recipient, kind, title, body)
               SELECT partner_email, 'swap_expired', 'Swap request expired', 'The swap of ' || requester_day::text || ' and ' || partner_day::text || ' was not finished in time.' FROM roster_swap WHERE status = 'expired' AND updated_at = now()`,
      },
      {
        text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail)
               SELECT 'system', 'system', 'swap_expire', requester_entry, requester_email, team_key, requester_day, jsonb_build_object('swapId', id::text)
               FROM roster_swap WHERE status = 'expired' AND updated_at = now()`,
      },
    ]);
  }

  // ------------------------------------------------------------------ per-day information

  async function dayInfos(db: Queryable, actor: Actor, teamKey: string, isTest: boolean, from: string, to: string, teamSize: number, viewerRole: RosterRole, nowMs: number): Promise<RosterDayInfo[]> {
    const [limitRows, usedRows] = await Promise.all([
      db.query(`SELECT day::text AS day, max_inactive FROM roster_limit WHERE team_key = $1 AND (day IS NULL OR day BETWEEN $2::date AND $3::date)`, [teamKey, from, to]),
      db.query(
        `SELECT day::text AS day,
                count(*) FILTER (WHERE status = 'approved' OR (status = 'pending' AND extract(isodow FROM day) <= 5))::int AS n,
                count(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM roster_entry
         WHERE team_key = $1 AND is_test = $2::boolean AND status IN ('pending','approved') AND day BETWEEN $3::date AND $4::date GROUP BY day`,
        [teamKey, isTest, from, to]
      ),
    ]);
    const allDays = (limitRows.find((r) => r.day === null)?.max_inactive ?? null) as number | null;
    const byDay = new Map<string, number>(limitRows.filter((r) => r.day !== null).map((r) => [r.day, r.max_inactive]));
    const used = new Map<string, number>(usedRows.map((r) => [r.day, r.n]));
    const pendingBy = new Map<string, number>(usedRows.map((r) => [r.day, r.pending]));
    const out: RosterDayInfo[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const { limit, source } = effectiveLimit(d, byDay.has(d) ? (byDay.get(d) as number) : null, allDays, teamSize);
      const u = used.get(d) ?? 0;
      out.push({ day: d, weekend: isWeekend(d), limit, limitSource: source, used: u, pending: pendingBy.get(d) ?? 0, left: limit === null ? null : Math.max(0, limit - u), locked: !canChangeDay(d, viewerRole, nowMs), overBooked: limit !== null && u > limit });
    }
    return out;
  }

  async function unreadCount(db: Queryable, keys: string[]): Promise<number> {
    if (!keys.length) return 0;
    const rows = await db.query(`SELECT count(*)::int AS n FROM app_notification WHERE recipient = ANY($1::text[]) AND read_at IS NULL`, [keys]);
    return rows[0]?.n ?? 0;
  }

  /** Agents whose entries this person may see/act on. */
  const inScope = (actor: Actor, agentEmail: string, teamKey?: string) => {
    if (actor.role === 'manager' || actor.role === 'superAdmin') return true;
    if (actor.role === 'agent') return norm(actor.agent?.officialEmail) === norm(agentEmail);
    return actor.members.some((m) => norm(m.officialEmail) === norm(agentEmail)) || (teamKey ? actor.teamKeys.includes(teamKey) : false);
  };

  // ------------------------------------------------------------------ status (the Roster tab is shown or not)

  api.get(
    '/api/roster/status',
    route(async (req, res) => {
      const actor = await resolveActor(req, { requireEnabled: false });
      const body: RosterStatusResponse = { enabled: false };
      if (!actor) return res.json(body);
      const allowed = pilotAllows(actor.appConfig, { role: actor.role, agent: actor.agent, login: actor.login, officialEmail: actor.agent?.officialEmail, members: actor.members });
      if (!allowed) return res.json(body);
      const db = getRosterDb();
      if (!db) return res.json({ enabled: true, unavailable: true, role: actor.role } as RosterStatusResponse);
      // The badge on the tab: an agent's unread notifications; a TL's or manager's requests waiting for a decision
      let badge = 0;
      try {
        if (isStaff(actor)) {
          if (actor.teamKeys.length) {
            const p = await db.query(`SELECT count(*)::int AS n FROM roster_entry WHERE status = 'pending' AND team_key = ANY($1::text[]) AND day > $2::date`, [actor.teamKeys, istDay(clock())]);
            badge = p[0]?.n ?? 0;
            const sw = await db.query(`SELECT count(*)::int AS n FROM roster_swap WHERE status = 'awaiting_tl' AND team_key = ANY($1::text[])`, [actor.teamKeys]);
            badge += sw[0]?.n ?? 0;
          }
        } else {
          badge = await unreadCount(db, actor.inboxKeys);
        }
      } catch (_err) {
        badge = 0;
      }
      return res.json({ enabled: true, role: actor.role, badge } as RosterStatusResponse);
    })
  );

  // ------------------------------------------------------------------ an agent's own roster

  api.get(
    '/api/roster/me',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const nowMs = clock();
      await expireOverdue(db, nowMs);

      // Staff may open one agent (read-only); an agent always gets their own
      let agent = actor.agent;
      if (isStaff(actor)) {
        const wanted = norm(String(req.query.agent ?? ''));
        agent = actor.members.find((m) => norm(m.officialEmail) === wanted);
        if (!agent) throw new RosterError(404, 'NOT_FOUND', 'Agent not found.');
      }
      if (!agent) throw new RosterError(403, 'FORBIDDEN', 'No agent record.');

      const today = istDay(nowMs);
      const from = weekStart(today);
      const woLast = lastBookableDay('WO', today);
      const plLast = lastBookableDay('PL', today);
      const key = teamKeyOf(agent);
      const test = isTestAgent(agent);
      const viewerRole: RosterRole = isStaff(actor) ? actor.role : 'agent';
      const name = nameOf(actor);

      const [entryRows, days, changes, unread] = await Promise.all([
        db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.agent_email = $1 AND e.day BETWEEN $2::date AND $3::date ORDER BY e.day, e.created_at`, [norm(agent.officialEmail), from, plLast]),
        dayInfos(db, actor, key, test, from, plLast, teamSizeOf(actor, key, test), viewerRole, nowMs),
        db.query(`SELECT count(*)::int AS n FROM roster_audit WHERE actor = $1 AND actor_role = 'agent' AND action IN ('book','cancel') AND at >= $2::timestamptz`, [actor.login, new Date(istMidnightMs(from)).toISOString()]),
        unreadCount(db, actor.inboxKeys),
      ]);
      const entries = entryRows.map((r) => toEntry(r, name));
      const weeks: Array<{ weekStart: string; woCount: number }> = [];
      for (let w = from; w <= woLast; w = addDays(w, 7)) {
        weeks.push({ weekStart: w, woCount: entries.filter((e) => e.kind === 'WO' && (e.status === 'pending' || e.status === 'approved') && e.day >= w && e.day <= weekEnd(w)).length });
      }
      const body: RosterMeResponse = {
        today,
        firstDay: firstChangeableDay(viewerRole, nowMs),
        woLastDay: woLast,
        plLastDay: plLast,
        agentName: agent.name,
        agentEmail: norm(agent.officialEmail),
        teamSize: teamSizeOf(actor, key, test),
        entries,
        days,
        weeks,
        changesThisWeek: changes[0]?.n ?? 0,
        unread,
      };
      return res.json(body);
    })
  );

  // ------------------------------------------------------------------ booking

  api.post(
    '/api/roster/entries',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const nowMs = clock();
      const body = req.body || {};
      const kind = body.kind as RosterKind;
      const day = String(body.day ?? '');
      if (kind !== 'WO' && kind !== 'PL') throw new RosterError(400, 'BAD_REQUEST', 'kind must be WO or PL.');
      if (!isDay(day)) throw new RosterError(400, 'BAD_REQUEST', 'Pick a valid date.');
      const requestId = String(body.requestId ?? '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new RosterError(400, 'BAD_REQUEST', 'requestId is required (8 to 64 letters, digits, - or _).');
      const reason = clean(body.reason, 300, 'The note');

      // Whose roster: an agent books for themselves; staff for an agent in their scope
      let target = actor.agent;
      if (isStaff(actor)) {
        const wanted = norm(String(body.agentEmail ?? ''));
        target = actor.members.find((m) => norm(m.officialEmail) === wanted);
        if (!target) throw new RosterError(404, 'NOT_FOUND', 'Agent not found.');
        if ((actor.role === 'manager' || actor.role === 'superAdmin') && !reason) throw new RosterError(400, 'NOTE_REQUIRED', 'Say why you are changing this on the agent\'s behalf.');
      }
      if (!target) throw new RosterError(403, 'FORBIDDEN', 'No agent record.');

      const problem = dayProblem(kind, day, actor.role, nowMs);
      if (problem) throw new RosterError(409, 'WINDOW', problem);

      const today = istDay(nowMs);
      if (actor.role === 'agent') {
        const changes = await db.query(`SELECT count(*)::int AS n FROM roster_audit WHERE actor = $1 AND actor_role = 'agent' AND action IN ('book','cancel') AND at >= $2::timestamptz`, [actor.login, new Date(istMidnightMs(weekStart(today))).toISOString()]);
        if ((changes[0]?.n ?? 0) >= ROSTER_RULES.maxChangesPerWeek) {
          throw new RosterError(409, 'CHURN_LIMIT', `You have changed your days off ${ROSTER_RULES.maxChangesPerWeek} times this week. Ask your TL.`);
        }
      }

      const email = norm(target.officialEmail);
      const key = teamKeyOf(target);
      const test = isTestAgent(target);
      const weekend = isWeekend(day);
      const override = isStaff(actor) && body.override === true;
      if (override && !reason) throw new RosterError(400, 'NOTE_REQUIRED', 'Give a reason for going over the limit.');
      const forceApproved = isStaff(actor);
      // Agents: weekdays are checked against the limit when they ask; the TL decides weekends. Staff: checked unless overriding.
      const enforce = forceApproved ? !override : !weekend;
      const defaultCap = weekend ? null : defaultWeekdayLimit(teamSizeOf(actor, key, test));
      const source = actor.role === 'agent' ? 'self' : actor.role === 'tl' ? 'tl' : 'manager';

      const stmts: Stmt[] = [
        { text: `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, params: [`roster:agentweek:${email}:${weekStart(day)}`] },
        { text: `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, params: [`roster:teamday:${key}:${day}`] },
        {
          text: `WITH cap AS (
                   SELECT COALESCE(
                     (SELECT max_inactive FROM roster_limit WHERE team_key = $6::text AND day = $2::date),
                     (SELECT max_inactive FROM roster_limit WHERE team_key = $6::text AND day IS NULL),
                     $15::int) AS n),
                 used AS (
                   SELECT count(*)::int AS n FROM roster_entry
                   WHERE team_key = $6::text AND day = $2::date AND is_test = $11::boolean
                     AND (status = 'approved' OR (status = 'pending' AND extract(isodow FROM day) <= 5))),
                 week AS (
                   SELECT count(*)::int AS n FROM roster_entry
                   WHERE agent_email = $1::text AND kind = 'WO' AND status IN ('pending','approved') AND day BETWEEN $12::date AND $13::date),
                 ins AS (
                   INSERT INTO roster_entry (agent_email, day, kind, status, needs_approval, team_key, agent_type, location, source, reason,
                                             over_limit, created_by, request_id, is_test, decided_by, decided_at)
                   SELECT $1::text, $2::date, $3::text,
                          CASE WHEN $17::boolean THEN 'approved'
                               WHEN ($3::text = 'PL' OR $14::boolean OR (SELECT n FROM week) >= 1) THEN 'pending' ELSE 'approved' END,
                          (($3::text = 'PL' OR $14::boolean OR (SELECT n FROM week) >= 1) AND NOT $17::boolean),
                          $6::text, $7::text, $8::text, $4::text, $9::text,
                          ((SELECT n FROM cap) IS NOT NULL AND (SELECT n FROM used) >= (SELECT n FROM cap)),
                          $5::text, $10::text, $11::boolean,
                          CASE WHEN $17::boolean THEN $5::text END, CASE WHEN $17::boolean THEN now() END
                   WHERE (NOT $16::boolean OR (SELECT n FROM cap) IS NULL OR (SELECT n FROM used) < (SELECT n FROM cap))
                     AND ($18::int IS NULL OR $3::text = 'PL' OR (SELECT n FROM week) < $18::int)
                   ON CONFLICT DO NOTHING
                   RETURNING id)
                 SELECT (SELECT n FROM cap) AS cap, (SELECT n FROM used) AS used, (SELECT n FROM week) AS week_wo, (SELECT count(*)::int FROM ins) AS inserted`,
          params: [email, day, kind, source, actor.login, key, target.agentType, norm(target.location) ? target.location : '', reason, requestId, test, weekStart(day), weekEnd(day), weekend, defaultCap, enforce, forceApproved, null],
        },
        {
          text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
                 SELECT $2::text, $3::text, 'book', id, agent_email, team_key, day,
                        jsonb_build_object('kind', kind, 'status', status, 'source', source, 'overLimit', over_limit), $4::text
                 FROM roster_entry WHERE request_id = $1::text AND created_at = now()`,
          params: [requestId, actor.login, actor.role, reason],
        },
      ];

      const outcome = bookingOutcome(kind, day, 0);
      const who = target.name;
      // Notifications (in the same transaction): the TL is told of new bookings; the agent of what staff did for them
      stmts.push({
        text: `INSERT INTO app_notification (recipient, kind, title, body, entry_id)
               SELECT $2::text, CASE WHEN status = 'pending' THEN 'approval_needed' ELSE 'booked' END,
                      CASE WHEN status = 'pending' THEN $3::text ELSE $4::text END,
                      $5::text || ' on ' || $6::text || CASE WHEN over_limit THEN ' (over the limit)' ELSE '' END, id
               FROM roster_entry WHERE request_id = $1::text AND created_at = now() AND source = 'self'`,
        params: [requestId, key, `${who} needs your approval`, `${who} booked a day off`, kind === 'PL' ? 'Planned leave' : 'Weekly off', dayLabel(day)],
      });
      if (isStaff(actor)) {
        stmts.push({
          text: `INSERT INTO app_notification (recipient, kind, title, body, entry_id)
                 SELECT agent_email, 'set_by_staff', $2::text, $3::text, id FROM roster_entry WHERE request_id = $1::text AND created_at = now()`,
          params: [requestId, 'Your roster was updated', `${actor.name} set ${kind === 'PL' ? 'planned leave' : 'a weekly off'} for you on ${dayLabel(day)}.`],
        });
      }

      const results = await db.batch(stmts);
      const info = results[2][0] || {};
      const row = await getEntryByRequest(db, requestId);
      const name = nameOf(actor);
      if (info.inserted === 1 && row) {
        return res.json({ entry: toEntry(row, name), message: forceApproved ? 'Saved.' : bookingOutcome(kind, day, info.week_wo ?? 0).why });
      }
      // Not inserted: a retry of the same request, or a rule stopped it
      if (row) {
        if (norm(row.agent_email) === email) return res.json({ entry: toEntry(row, name), replayed: true });
        throw new RosterError(409, 'REQUEST_REUSED', 'That request id was already used.');
      }
      const active = await db.query(`SELECT kind FROM roster_entry WHERE agent_email = $1 AND day = $2::date AND status IN ('pending','approved')`, [email, day]);
      if (active.length) throw new RosterError(409, 'ALREADY_BOOKED', `${isStaff(actor) ? who + ' already has' : 'You already have'} a ${active[0].kind === 'PL' ? 'planned leave' : 'weekly off'} on ${dayLabel(day)}.`);
      if (enforce && info.cap !== null && info.cap !== undefined && info.used >= info.cap) {
        throw new RosterError(409, 'LIMIT_REACHED', `The team's limit for ${dayLabel(day)} is ${info.cap} and ${info.used} are already off. Pick another day, or ask your TL.`);
      }
      void outcome;
      throw new RosterError(409, 'NOT_ALLOWED', 'That could not be saved.');
    })
  );

  // ------------------------------------------------------------------ cancel, decide, revoke

  /** One status change on an entry, with its audit row and a notification, in one transaction. */
  async function changeStatus(
    db: Queryable,
    entry: any,
    actor: Actor,
    to: 'cancelled' | 'rejected' | 'revoked',
    from: string[],
    note: string | null,
    notify: { recipient: string; kind: string; title: string; body: string } | null
  ): Promise<boolean> {
    const stmts: Stmt[] = [
      { text: `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, params: [`roster:teamday:${entry.team_key}:${entry.day}`] },
      {
        text: `UPDATE roster_entry SET status = $2::text, decided_by = $3::text, decided_at = now(), decision_note = $4::text, updated_at = now()
               WHERE id = $1::uuid AND status = ANY($5::text[]) RETURNING id::text AS id`,
        params: [entry.id, to, actor.login, note, from],
      },
      {
        text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
               SELECT $2::text, $3::text, $4::text, id, agent_email, team_key, day, jsonb_build_object('from', $5::text, 'kind', kind), $6::text
               FROM roster_entry WHERE id = $1::uuid AND status = $7::text AND updated_at = now()`,
        params: [entry.id, actor.login, actor.role, to === 'cancelled' ? 'cancel' : to === 'rejected' ? 'reject' : 'revoke', entry.status, note, to],
      },
    ];
    if (notify) {
      stmts.push({
        text: `INSERT INTO app_notification (recipient, kind, title, body, entry_id)
               SELECT $2::text, $3::text, $4::text, $5::text, id FROM roster_entry WHERE id = $1::uuid AND status = $6::text AND updated_at = now()`,
        params: [entry.id, notify.recipient, notify.kind, notify.title, notify.body, to],
      });
    }
    if (to === 'cancelled' || to === 'revoked') {
      // A weekly off that is part of an open swap request: the swap cannot go ahead, so it is cancelled too
      const reason = 'A weekly off in this swap was withdrawn.';
      stmts.push({
        text: `UPDATE roster_swap SET status = 'cancelled', fail_reason = $2::text, updated_at = now()
               WHERE status IN ('awaiting_partner','awaiting_tl') AND (requester_entry = $1::uuid OR partner_entry = $1::uuid)
                 AND EXISTS (SELECT 1 FROM roster_entry WHERE id = $1::uuid AND status IN ('cancelled','revoked') AND updated_at = now())`,
        params: [entry.id, reason],
      });
      for (const col of ['requester_email', 'partner_email']) {
        stmts.push({
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT ${col}, 'swap_cancelled', 'Swap cancelled', 'A weekly off in your swap (' || requester_day::text || ' and ' || partner_day::text || ') was withdrawn, so the swap was cancelled.'
                 FROM roster_swap WHERE status = 'cancelled' AND fail_reason = $1::text AND updated_at = now()`,
          params: [reason],
        });
      }
    }
    const results = await db.batch(stmts);
    return results[1].length === 1;
  }

  api.post(
    '/api/roster/entries/:id/cancel',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const nowMs = clock();
      const entry = await getEntry(db, String(req.params.id));
      if (!entry || !inScope(actor, entry.agent_email, entry.team_key)) throw new RosterError(404, 'NOT_FOUND', 'Entry not found.');
      if (entry.status !== 'pending' && entry.status !== 'approved') throw new RosterError(409, 'STATE', 'This entry is no longer active.');
      if (!canChangeDay(entry.day, actor.role, nowMs)) throw new RosterError(409, 'CUTOFF', `Changes for ${dayLabel(entry.day)} have closed. Ask your TL.`);
      const note = clean(req.body?.note, 300, 'The note');
      if (actor.role === 'agent') {
        const inSwap = await db.query(`SELECT 1 FROM roster_swap WHERE status IN ('awaiting_partner','awaiting_tl') AND (requester_entry = $1::uuid OR partner_entry = $1::uuid)`, [entry.id]);
        if (inSwap.length) throw new RosterError(409, 'SWAP_OPEN', 'This day is part of a swap request. Cancel the swap request first.');
        const today = istDay(nowMs);
        const changes = await db.query(`SELECT count(*)::int AS n FROM roster_audit WHERE actor = $1 AND actor_role = 'agent' AND action IN ('book','cancel') AND at >= $2::timestamptz`, [actor.login, new Date(istMidnightMs(weekStart(today))).toISOString()]);
        if ((changes[0]?.n ?? 0) >= ROSTER_RULES.maxChangesPerWeek) throw new RosterError(409, 'CHURN_LIMIT', `You have changed your days off ${ROSTER_RULES.maxChangesPerWeek} times this week. Ask your TL.`);
      } else if ((actor.role === 'manager' || actor.role === 'superAdmin') && !note) {
        throw new RosterError(400, 'NOTE_REQUIRED', 'Say why you are cancelling this for the agent.');
      }
      const name = nameOf(actor);
      const notify =
        actor.role === 'agent'
          ? entry.status === 'approved'
            ? { recipient: entry.team_key, kind: 'cancelled', title: `${name(entry.agent_email)} cancelled a day off`, body: `${dayLabel(entry.day)}` }
            : null
          : { recipient: entry.agent_email, kind: 'cancelled_by_staff', title: 'Your roster was updated', body: `${actor.name} cancelled your ${entry.kind === 'PL' ? 'planned leave' : 'weekly off'} on ${dayLabel(entry.day)}.` };
      const changed = await changeStatus(db, entry, actor, 'cancelled', ['pending', 'approved'], note, notify);
      if (!changed) throw new RosterError(409, 'STATE', 'This entry changed. Reload and try again.');
      return res.json({ entry: toEntry((await getEntry(db, entry.id))!, name) });
    })
  );

  api.post(
    '/api/roster/entries/:id/decision',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only a TL or manager can approve or reject.');
      const db = needDb();
      const nowMs = clock();
      const entry = await getEntry(db, String(req.params.id));
      if (!entry || !inScope(actor, entry.agent_email, entry.team_key)) throw new RosterError(404, 'NOT_FOUND', 'Entry not found.');
      if (entry.status !== 'pending') throw new RosterError(409, 'STATE', 'This request has already been decided.');
      if (!canChangeDay(entry.day, actor.role, nowMs)) throw new RosterError(409, 'CUTOFF', `${dayLabel(entry.day)} has started, so this can no longer be decided.`);
      const decision = String(req.body?.decision ?? '');
      const note = clean(req.body?.note, 300, 'The note');
      const name = nameOf(actor);
      const label = entry.kind === 'PL' ? 'planned leave' : 'weekly off';

      if (decision === 'reject') {
        if (!note) throw new RosterError(400, 'NOTE_REQUIRED', 'Say why you are rejecting this.');
        const changed = await changeStatus(db, entry, actor, 'rejected', ['pending'], note, {
          recipient: entry.agent_email, kind: 'rejected', title: 'Request not approved', body: `Your ${label} on ${dayLabel(entry.day)} was not approved: ${note}`,
        });
        if (!changed) throw new RosterError(409, 'STATE', 'This request has already been decided.');
        return res.json({ entry: toEntry((await getEntry(db, entry.id))!, name) });
      }
      if (decision !== 'approve') throw new RosterError(400, 'BAD_REQUEST', 'decision must be approve or reject.');

      const override = req.body?.override === true;
      if (override && !note) throw new RosterError(400, 'NOTE_REQUIRED', 'Give a reason for approving over the limit.');
      const target = actor.everyone.find((a) => norm(a.officialEmail) === norm(entry.agent_email));
      const size = target ? teamSizeOf(actor, entry.team_key, Boolean(entry.is_test)) : 0;
      const defaultCap = isWeekend(entry.day) ? null : defaultWeekdayLimit(size);
      const results = await db.batch([
        { text: `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, params: [`roster:teamday:${entry.team_key}:${entry.day}`] },
        {
          text: `WITH cap AS (
                   SELECT COALESCE(
                     (SELECT max_inactive FROM roster_limit WHERE team_key = $2::text AND day = $3::date),
                     (SELECT max_inactive FROM roster_limit WHERE team_key = $2::text AND day IS NULL),
                     $4::int) AS n),
                 used AS (
                   SELECT count(*)::int AS n FROM roster_entry
                   WHERE team_key = $2::text AND day = $3::date AND is_test = $5::boolean AND id <> $1::uuid
                     AND (status = 'approved' OR (status = 'pending' AND extract(isodow FROM day) <= 5))),
                 upd AS (
                   UPDATE roster_entry SET status = 'approved', decided_by = $6::text, decided_at = now(), decision_note = $7::text,
                          over_limit = over_limit OR ($8::boolean AND (SELECT n FROM cap) IS NOT NULL AND (SELECT n FROM used) >= (SELECT n FROM cap)),
                          updated_at = now()
                   WHERE id = $1::uuid AND status = 'pending'
                     AND ($8::boolean OR (SELECT n FROM cap) IS NULL OR (SELECT n FROM used) < (SELECT n FROM cap))
                   RETURNING id)
                 SELECT (SELECT n FROM cap) AS cap, (SELECT n FROM used) AS used, (SELECT count(*)::int FROM upd) AS changed`,
          params: [entry.id, entry.team_key, entry.day, defaultCap, Boolean(entry.is_test), actor.login, note, override],
        },
        {
          text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
                 SELECT $2::text, $3::text, 'approve', id, agent_email, team_key, day, jsonb_build_object('kind', kind, 'overLimit', over_limit), $4::text
                 FROM roster_entry WHERE id = $1::uuid AND status = 'approved' AND updated_at = now()`,
          params: [entry.id, actor.login, actor.role, note],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body, entry_id)
                 SELECT agent_email, 'approved', 'Request approved', $2::text, id FROM roster_entry WHERE id = $1::uuid AND status = 'approved' AND updated_at = now()`,
          params: [entry.id, `Your ${label} on ${dayLabel(entry.day)} was approved.`],
        },
      ]);
      const info = results[1][0] || {};
      if (info.changed !== 1) {
        const fresh = await getEntry(db, entry.id);
        if (fresh && fresh.status !== 'pending') throw new RosterError(409, 'STATE', 'This request has already been decided.');
        throw new RosterError(409, 'LIMIT_REACHED', `Approving this would put ${(info.used ?? 0) + 1} off against a limit of ${info.cap} on ${dayLabel(entry.day)}. Approve over the limit with a reason, or reject.`);
      }
      return res.json({ entry: toEntry((await getEntry(db, entry.id))!, name) });
    })
  );

  api.post(
    '/api/roster/entries/:id/revoke',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only a TL or manager can revoke.');
      const db = needDb();
      const nowMs = clock();
      const entry = await getEntry(db, String(req.params.id));
      if (!entry || !inScope(actor, entry.agent_email, entry.team_key)) throw new RosterError(404, 'NOT_FOUND', 'Entry not found.');
      if (entry.status !== 'approved') throw new RosterError(409, 'STATE', 'Only an approved entry can be revoked.');
      if (!canChangeDay(entry.day, actor.role, nowMs)) throw new RosterError(409, 'CUTOFF', `${dayLabel(entry.day)} has started, so this can no longer be changed.`);
      const note = clean(req.body?.note, 300, 'The note');
      if (!note) throw new RosterError(400, 'NOTE_REQUIRED', 'Say why you are revoking this.');
      const label = entry.kind === 'PL' ? 'planned leave' : 'weekly off';
      const changed = await changeStatus(db, entry, actor, 'revoked', ['approved'], note, {
        recipient: entry.agent_email, kind: 'revoked', title: 'Day off withdrawn', body: `Your ${label} on ${dayLabel(entry.day)} was withdrawn: ${note}`,
      });
      if (!changed) throw new RosterError(409, 'STATE', 'This entry changed. Reload and try again.');
      return res.json({ entry: toEntry((await getEntry(db, entry.id))!, nameOf(actor)) });
    })
  );

  // ------------------------------------------------------------------ the team grid (TL, manager, Super Admin)

  api.get(
    '/api/roster/team',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Staff only.');
      const db = needDb();
      const nowMs = clock();
      await expireOverdue(db, nowMs);
      const today = istDay(nowMs);
      const from = isDay(req.query.from) ? String(req.query.from) : weekStart(today);
      let to = isDay(req.query.to) ? String(req.query.to) : lastBookableDay('WO', today);
      const maxTo = addDays(from, 69);
      if (to > maxTo) to = maxTo;
      if (to < from) throw new RosterError(400, 'BAD_REQUEST', 'to must not be before from.');

      // A TL sees their team; a manager picks one (the first by default)
      const keys = actor.teamKeys;
      const wantedKey = String(req.query.team ?? '').trim().toLowerCase();
      const key = wantedKey && keys.includes(wantedKey) ? wantedKey : keys[0] || '';
      if (actor.role === 'tl' && wantedKey && !keys.includes(wantedKey)) throw new RosterError(403, 'FORBIDDEN', 'That is not your team.');
      const agents = actor.members.filter((m) => teamKeyOf(m) === key);
      const test = agents.length ? isTestAgent(agents[0]) : false;
      const size = agents.filter((a) => isTestAgent(a) === test).length;
      const name = nameOf(actor);

      const [entryRows, days, limitRow, pendingRow, unread] = await Promise.all([
        db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.team_key = $1 AND e.day BETWEEN $2::date AND $3::date ORDER BY e.day, e.created_at`, [key, from, to]),
        dayInfos(db, actor, key, test, from, to, size, actor.role, nowMs),
        db.query(`SELECT max_inactive FROM roster_limit WHERE team_key = $1 AND day IS NULL`, [key]),
        db.query(`SELECT count(*)::int AS n FROM roster_entry WHERE team_key = $1 AND status = 'pending'`, [key]),
        unreadCount(db, actor.inboxKeys),
      ]);
      const entries = entryRows.map((r) => toEntry(r, name));
      const noWo: Array<{ weekStart: string; agents: string[] }> = [];
      for (let w = weekStart(from); w <= to; w = addDays(w, 7)) {
        if (weekEnd(w) < today) continue;
        const have = new Set(entries.filter((e) => e.kind === 'WO' && (e.status === 'pending' || e.status === 'approved') && e.day >= w && e.day <= weekEnd(w)).map((e) => norm(e.agentEmail)));
        noWo.push({ weekStart: w, agents: agents.filter((a) => !have.has(norm(a.officialEmail))).map((a) => a.name) });
      }
      let feasibility: string | undefined;
      for (let w = weekStart(from); w <= to && !feasibility; w = addDays(w, 7)) {
        const limits = days.filter((d) => d.day >= w && d.day <= addDays(w, 4) && d.day >= today).map((d) => d.limit ?? 0);
        if (limits.length === 5) feasibility = feasibilityWarning(size, limits);
      }
      const body: RosterTeamResponse = {
        today,
        teamKeys: keys,
        teamSize: size,
        agents: agents.map((a) => ({ email: norm(a.officialEmail), name: a.name, agentType: a.agentType, location: a.location })),
        entries,
        days,
        allDaysLimit: limitRow[0]?.max_inactive ?? null,
        pending: pendingRow[0]?.n ?? 0,
        noWo,
        feasibility,
        unread,
      };
      return res.json({ ...body, teamKey: key });
    })
  );

  // ------------------------------------------------------------------ limits

  const limitKeys = (actor: Actor, team: unknown): string[] => {
    const wanted = String(team ?? '').trim().toLowerCase();
    if (actor.role === 'tl') {
      if (wanted && !actor.teamKeys.includes(wanted)) throw new RosterError(403, 'FORBIDDEN', 'That is not your team.');
      return wanted ? [wanted] : actor.teamKeys;
    }
    if (!wanted) throw new RosterError(400, 'BAD_REQUEST', 'Say which team.');
    if (!actor.teamKeys.includes(wanted)) throw new RosterError(404, 'NOT_FOUND', 'Team not found.');
    return [wanted];
  };

  api.put(
    '/api/roster/limits',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only a TL or manager can set limits.');
      const db = needDb();
      const nowMs = clock();
      const keys = limitKeys(actor, req.body?.team);
      const max = Number(req.body?.maxInactive);
      if (!Number.isInteger(max) || max < 0 || max > 200) throw new RosterError(400, 'BAD_REQUEST', 'The limit must be a whole number from 0 to 200.');
      const day = req.body?.day === null || req.body?.day === undefined || req.body?.day === '' ? null : String(req.body.day);
      if (day !== null) {
        if (!isDay(day)) throw new RosterError(400, 'BAD_REQUEST', 'Pick a valid date.');
        if (day < istDay(nowMs)) throw new RosterError(409, 'WINDOW', 'That day has already passed.');
        if (day > addDays(istDay(nowMs), 120)) throw new RosterError(409, 'WINDOW', 'That is too far ahead.');
      }
      const note = clean(req.body?.note, 200, 'The note');
      const stmts: Stmt[] = [];
      for (const key of keys) {
        stmts.push({
          text: day === null
            ? `INSERT INTO roster_limit (team_key, day, max_inactive, note, set_by) VALUES ($1::text, NULL, $2::int, $3::text, $4::text)
               ON CONFLICT (team_key) WHERE day IS NULL DO UPDATE SET max_inactive = EXCLUDED.max_inactive, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()`
            : `INSERT INTO roster_limit (team_key, day, max_inactive, note, set_by) VALUES ($1::text, $5::date, $2::int, $3::text, $4::text)
               ON CONFLICT (team_key, day) WHERE day IS NOT NULL DO UPDATE SET max_inactive = EXCLUDED.max_inactive, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now()`,
          params: day === null ? [key, max, note, actor.login] : [key, max, note, actor.login, day],
        });
        stmts.push({
          text: `INSERT INTO roster_audit (actor, actor_role, action, team_key, day, detail, note) VALUES ($1::text, $2::text, 'limit_set', $3::text, $4::date, jsonb_build_object('maxInactive', $5::int), $6::text)`,
          params: [actor.login, actor.role, key, day, max, note],
        });
      }
      await db.batch(stmts);
      return res.json({ ok: true, teamKeys: keys, day, maxInactive: max });
    })
  );

  api.delete(
    '/api/roster/limits',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only a TL or manager can change limits.');
      const db = needDb();
      const keys = limitKeys(actor, req.query.team);
      const day = req.query.day ? String(req.query.day) : null;
      if (day !== null && !isDay(day)) throw new RosterError(400, 'BAD_REQUEST', 'Pick a valid date.');
      const stmts: Stmt[] = [];
      for (const key of keys) {
        stmts.push({ text: day === null ? `DELETE FROM roster_limit WHERE team_key = $1::text AND day IS NULL` : `DELETE FROM roster_limit WHERE team_key = $1::text AND day = $2::date`, params: day === null ? [key] : [key, day] });
        stmts.push({ text: `INSERT INTO roster_audit (actor, actor_role, action, team_key, day) VALUES ($1::text, $2::text, 'limit_clear', $3::text, $4::date)`, params: [actor.login, actor.role, key, day] });
      }
      await db.batch(stmts);
      return res.json({ ok: true });
    })
  );

  // ------------------------------------------------------------------ approvals, history, export

  api.get(
    '/api/roster/approvals',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Staff only.');
      const db = needDb();
      const nowMs = clock();
      await expireOverdue(db, nowMs);
      const keys = actor.teamKeys;
      const rows = keys.length ? await db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.status = 'pending' AND e.team_key = ANY($1::text[]) ORDER BY e.created_at`, [keys]) : [];
      const name = nameOf(actor);
      const entries = rows.map((r) => toEntry(r, name));
      // The load on each requested day: "2 of 3 are already off"
      const loads: Record<string, { used: number; limit: number | null }> = {};
      for (const key of new Set(rows.map((r) => r.team_key as string))) {
        const mine = rows.filter((r) => r.team_key === key);
        const lo = mine.reduce((m, r) => (r.day < m ? r.day : m), mine[0].day);
        const hi = mine.reduce((m, r) => (r.day > m ? r.day : m), mine[0].day);
        const test = Boolean(mine[0].is_test);
        const infos = await dayInfos(db, actor, key, test, lo, hi, teamSizeOf(actor, key, test), actor.role, nowMs);
        for (const r of mine) {
          const info = infos.find((i) => i.day === r.day);
          if (info) loads[r.id] = { used: info.used, limit: info.limit };
        }
      }
      return res.json({ entries, loads, count: entries.length, unread: await unreadCount(db, actor.inboxKeys) });
    })
  );

  const auditQuery = async (db: Queryable, actor: Actor, from: string, to: string, agent: string, limit: number) => {
    const params: any[] = [from, to];
    let where = `a.day BETWEEN $1::date AND $2::date OR (a.day IS NULL AND a.at >= $1::date)`;
    where = `(${where})`;
    if (actor.role === 'tl') {
      params.push(actor.teamKeys);
      where += ` AND a.team_key = ANY($${params.length}::text[])`;
    }
    if (agent) {
      params.push(agent);
      where += ` AND a.agent_email = $${params.length}::text`;
    }
    params.push(limit);
    return db.query(
      `SELECT a.id, to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, a.actor, a.actor_role, a.action, a.agent_email, a.team_key, a.day::text AS day, a.detail, a.note
       FROM roster_audit a WHERE ${where} ORDER BY a.at DESC, a.id DESC LIMIT $${params.length}::int`,
      params
    );
  };

  api.get(
    '/api/roster/audit',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Staff only.');
      const db = needDb();
      const today = istDay(clock());
      const from = isDay(req.query.from) ? String(req.query.from) : addDays(today, -30);
      const to = isDay(req.query.to) ? String(req.query.to) : addDays(today, 70);
      const agent = norm(String(req.query.agent ?? ''));
      if (agent && !inScope(actor, agent)) throw new RosterError(404, 'NOT_FOUND', 'Agent not found.');
      const rows = await auditQuery(db, actor, from, to, agent, 300);
      const name = nameOf(actor);
      return res.json({ items: rows.map((r) => ({ id: Number(r.id), at: r.at, actor: r.actor, actorRole: r.actor_role, action: r.action, agentEmail: r.agent_email, agentName: r.agent_email ? name(r.agent_email) : null, teamKey: r.team_key, day: r.day, detail: r.detail, note: r.note })) });
    })
  );

  api.get(
    '/api/roster/export',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Staff only.');
      const db = needDb();
      const today = istDay(clock());
      const from = isDay(req.query.from) ? String(req.query.from) : weekStart(today);
      const to = isDay(req.query.to) ? String(req.query.to) : lastBookableDay('PL', today);
      const keys = actor.role === 'tl' ? actor.teamKeys : actor.teamKeys;
      const rows = keys.length ? await db.query(`SELECT ${ENTRY_COLS} FROM roster_entry e WHERE e.team_key = ANY($1::text[]) AND e.day BETWEEN $2::date AND $3::date ORDER BY e.day, e.agent_email`, [keys, from, to]) : [];
      const name = nameOf(actor);
      const csv = toCsv([
        ['Date', 'Agent', 'Official Email', 'Type', 'Status', 'Source', 'Note', 'Decided By', 'Decision Note'],
        ...rows.map((r) => [r.day, name(r.agent_email), r.agent_email, r.kind === 'PL' ? 'Planned leave' : 'Weekly off', r.status, r.source, r.reason || '', r.decided_by || '', r.decision_note || '']),
      ]);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      return res.send(csv);
    })
  );

  // ------------------------------------------------------------------ swaps (phase 2)

  const SWAP_COLS = `s.id::text AS id, s.requester_email, s.partner_email, s.requester_entry::text AS requester_entry, s.partner_entry::text AS partner_entry,
    s.requester_day::text AS requester_day, s.partner_day::text AS partner_day, s.team_key, s.is_test, s.status, s.note, s.decision_note, s.fail_reason,
    to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, to_char(s.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS expires_at`;

  const toSwap = (row: any, name: (e: string) => string): RosterSwapDTO => ({
    id: row.id,
    requesterEmail: row.requester_email,
    requesterName: name(row.requester_email),
    partnerEmail: row.partner_email,
    partnerName: name(row.partner_email),
    requesterDay: row.requester_day,
    partnerDay: row.partner_day,
    requesterEntryId: row.requester_entry,
    partnerEntryId: row.partner_entry,
    status: row.status,
    note: row.note,
    decisionNote: row.decision_note,
    failReason: row.fail_reason,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });

  async function getSwap(db: Queryable, id: string): Promise<any | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await db.query(`SELECT ${SWAP_COLS} FROM roster_swap s WHERE s.id = $1::uuid`, [id]);
    return rows[0] ?? null;
  }

  const isOpenSwap = (status: string) => status === 'awaiting_partner' || status === 'awaiting_tl';
  const iso = (ms: number) => new Date(ms).toISOString();
  const myEmail = (actor: Actor) => norm(actor.agent?.officialEmail);
  const lockDays = (team: string, a: string, b: string): Stmt[] =>
    [a, b].sort().map((d) => ({ text: `SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))`, params: [`roster:teamday:${team}:${d}`] }));

  /** Agents (and the TL) of a swap, for the screens. */
  const swapInScope = (actor: Actor, s: any) =>
    actor.role === 'agent' ? myEmail(actor) === s.requester_email || myEmail(actor) === s.partner_email : inScope(actor, s.requester_email, s.team_key);

  async function notifyBoth(db: Queryable, swapId: string, kind: string, title: string, body: string): Promise<void> {
    await db.batch([
      { text: `INSERT INTO app_notification (recipient, kind, title, body) SELECT requester_email, $2::text, $3::text, $4::text FROM roster_swap WHERE id = $1::uuid`, params: [swapId, kind, title, body] },
      { text: `INSERT INTO app_notification (recipient, kind, title, body) SELECT partner_email, $2::text, $3::text, $4::text FROM roster_swap WHERE id = $1::uuid`, params: [swapId, kind, title, body] },
    ]);
  }

  api.get(
    '/api/roster/swap-candidates',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (actor.role !== 'agent' || !actor.agent) throw new RosterError(403, 'FORBIDDEN', 'Only an agent can ask for a swap.');
      const db = needDb();
      const nowMs = clock();
      const mine = await getEntry(db, String(req.query.entryId ?? ''));
      if (!mine || norm(mine.agent_email) !== myEmail(actor)) throw new RosterError(404, 'NOT_FOUND', 'Entry not found.');
      if (mine.kind !== 'WO' || mine.status !== 'approved') throw new RosterError(409, 'NOT_ALLOWED', 'Only a confirmed weekly off can be swapped.');
      if (!canChangeDay(mine.day, 'agent', nowMs)) throw new RosterError(409, 'CUTOFF', `Changes for ${dayLabel(mine.day)} have closed. Ask your TL.`);
      const me = actor.agent;
      const key = teamKeyOf(me);
      const test = isTestAgent(me);
      const ws = weekStart(mine.day);
      const we = weekEnd(mine.day);
      const [rows, busy] = await Promise.all([
        db.query(
          `SELECT ${ENTRY_COLS} FROM roster_entry e
           WHERE e.kind = 'WO' AND e.status = 'approved' AND e.team_key = $1::text AND e.is_test = $2::boolean AND e.agent_email <> $3::text
             AND e.day BETWEEN $4::date AND $5::date AND e.day <> $6::date
             AND NOT EXISTS (SELECT 1 FROM roster_swap s WHERE s.status IN ('awaiting_partner','awaiting_tl') AND (s.requester_entry = e.id OR s.partner_entry = e.id))
           ORDER BY e.day, e.agent_email`,
          [key, test, myEmail(actor), ws, we, mine.day]
        ),
        db.query(`SELECT agent_email, day::text AS day FROM roster_entry WHERE team_key = $1::text AND is_test = $2::boolean AND status IN ('pending','approved') AND day BETWEEN $3::date AND $4::date`, [key, test, ws, we]),
      ]);
      const taken = new Set(busy.map((b) => `${b.agent_email}|${b.day}`));
      const name = nameOf(actor);
      const candidates: SwapCandidateDTO[] = [];
      for (const r of rows) {
        const other = actor.everyone.find((a) => norm(a.officialEmail) === r.agent_email);
        if (!other || !swapEligible(me, other)) continue;
        if (!canChangeDay(r.day, 'agent', nowMs)) continue;
        // each would end up on a day where they already have something else: not possible
        if (taken.has(`${r.agent_email}|${mine.day}`) || taken.has(`${myEmail(actor)}|${r.day}`)) continue;
        candidates.push({ entryId: r.id, agentEmail: r.agent_email, agentName: name(r.agent_email), day: r.day });
      }
      return res.json({ myDay: mine.day, candidates });
    })
  );

  api.get(
    '/api/roster/swaps',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      await expireOverdue(db, clock());
      const name = nameOf(actor);
      let rows: any[];
      if (actor.role === 'agent') {
        rows = await db.query(
          `SELECT ${SWAP_COLS} FROM roster_swap s WHERE s.requester_email = $1::text OR s.partner_email = $1::text
           ORDER BY (s.status IN ('awaiting_partner','awaiting_tl')) DESC, s.created_at DESC LIMIT 20`,
          [myEmail(actor)]
        );
      } else {
        rows = actor.teamKeys.length
          ? await db.query(
              `SELECT ${SWAP_COLS} FROM roster_swap s WHERE s.team_key = ANY($1::text[])
               ORDER BY (s.status = 'awaiting_tl') DESC, (s.status = 'awaiting_partner') DESC, s.created_at DESC LIMIT 40`,
              [actor.teamKeys]
            )
          : [];
      }
      const items = rows.map((r) => toSwap(r, name));
      const count = actor.role === 'agent' ? items.filter((s) => s.status === 'awaiting_partner' && s.partnerEmail === myEmail(actor)).length : items.filter((s) => s.status === 'awaiting_tl').length;
      return res.json({ items, count });
    })
  );

  api.post(
    '/api/roster/swaps',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (actor.role !== 'agent' || !actor.agent) throw new RosterError(403, 'FORBIDDEN', 'Only an agent can ask for a swap.');
      const db = needDb();
      const nowMs = clock();
      const body = req.body || {};
      const requestId = String(body.requestId ?? '');
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) throw new RosterError(400, 'BAD_REQUEST', 'requestId is required (8 to 64 letters, digits, - or _).');
      const note = clean(body.note, 300, 'The note');
      const [mine, theirs] = await Promise.all([getEntry(db, String(body.myEntryId ?? '')), getEntry(db, String(body.partnerEntryId ?? ''))]);
      const me = actor.agent;
      if (!mine || norm(mine.agent_email) !== myEmail(actor)) throw new RosterError(404, 'NOT_FOUND', 'Your weekly off was not found.');
      if (!theirs || theirs.agent_email === mine.agent_email) throw new RosterError(404, 'NOT_FOUND', 'That colleague\'s weekly off was not found.');
      for (const e of [mine, theirs]) {
        if (e.kind !== 'WO' || e.status !== 'approved') throw new RosterError(409, 'NOT_ALLOWED', 'Only confirmed weekly offs can be swapped.');
        if (!canChangeDay(e.day, 'agent', nowMs)) throw new RosterError(409, 'CUTOFF', `Changes for ${dayLabel(e.day)} have closed. Ask your TL.`);
      }
      const partner = actor.everyone.find((a) => norm(a.officialEmail) === theirs.agent_email);
      if (!partner || !swapEligible(me, partner) || mine.team_key !== theirs.team_key || Boolean(mine.is_test) !== Boolean(theirs.is_test)) {
        throw new RosterError(409, 'NOT_ELIGIBLE', 'You can only swap with an agent of the same caller type, location and team leader.');
      }
      if (!sameWeek(mine.day, theirs.day)) throw new RosterError(409, 'NOT_ELIGIBLE', 'Both weekly offs must be in the same week.');
      if (mine.day === theirs.day) throw new RosterError(409, 'NOT_ELIGIBLE', 'Pick a weekly off on a different day.');

      const ws = istMidnightMs(weekStart(istDay(nowMs)));
      const [open, recent] = await Promise.all([
        db.query(`SELECT count(*)::int AS n FROM roster_swap WHERE requester_email = $1::text AND status IN ('awaiting_partner','awaiting_tl')`, [myEmail(actor)]),
        db.query(`SELECT count(*)::int AS n FROM roster_audit WHERE actor = $1::text AND action = 'swap_request' AND at >= $2::timestamptz`, [actor.login, iso(ws)]),
      ]);
      if ((open[0]?.n ?? 0) >= 1) throw new RosterError(409, 'SWAP_OPEN', 'You already have a swap request waiting. Cancel it or wait for the answer.');
      if ((recent[0]?.n ?? 0) >= ROSTER_SWAP.maxRequestsPerWeek) throw new RosterError(409, 'CHURN_LIMIT', `You have sent ${ROSTER_SWAP.maxRequestsPerWeek} swap requests this week. Ask your TL.`);

      const expires = swapExpiryMs(mine.day, theirs.day, nowMs);
      const requesterName = actor.agent.name;
      const results = await db.batch([
        ...lockDays(mine.team_key, mine.day, theirs.day),
        {
          text: `INSERT INTO roster_swap (requester_email, partner_email, requester_entry, partner_entry, requester_day, partner_day, team_key, agent_type, location, is_test,
                                         status, note, expires_at, created_by, request_id)
                 SELECT $1::text, $2::text, $3::uuid, $4::uuid, $5::date, $6::date, $7::text, $8::text, $9::text, $10::boolean, 'awaiting_partner', $11::text, $12::timestamptz, $13::text, $14::text
                 WHERE (SELECT count(*) FROM roster_entry WHERE id = $3::uuid AND agent_email = $1::text AND kind = 'WO' AND status = 'approved' AND day = $5::date) = 1
                   AND (SELECT count(*) FROM roster_entry WHERE id = $4::uuid AND agent_email = $2::text AND kind = 'WO' AND status = 'approved' AND day = $6::date) = 1
                   AND NOT EXISTS (SELECT 1 FROM roster_swap s WHERE s.status IN ('awaiting_partner','awaiting_tl')
                                   AND (s.requester_entry IN ($3::uuid, $4::uuid) OR s.partner_entry IN ($3::uuid, $4::uuid)))
                   AND NOT EXISTS (SELECT 1 FROM roster_entry WHERE agent_email = $1::text AND day = $6::date AND status IN ('pending','approved') AND id <> $3::uuid)
                   AND NOT EXISTS (SELECT 1 FROM roster_entry WHERE agent_email = $2::text AND day = $5::date AND status IN ('pending','approved') AND id <> $4::uuid)
                 ON CONFLICT DO NOTHING
                 RETURNING id::text AS id`,
          params: [myEmail(actor), theirs.agent_email, mine.id, theirs.id, mine.day, theirs.day, mine.team_key, partner.agentType, partner.location, Boolean(mine.is_test), note, iso(expires), actor.login, requestId],
        },
        {
          text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
                 SELECT $2::text, 'agent', 'swap_request', requester_entry, requester_email, team_key, requester_day,
                        jsonb_build_object('swapId', id::text, 'partner', partner_email, 'partnerDay', partner_day::text), $3::text
                 FROM roster_swap WHERE request_id = $1::text AND created_at = now()`,
          params: [requestId, actor.login, note],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT partner_email, 'swap_request', $2::text, $3::text FROM roster_swap WHERE request_id = $1::text AND created_at = now()`,
          params: [requestId, `${requesterName} wants to swap weekly offs`, `They give up ${dayLabel(mine.day)} and would take your ${dayLabel(theirs.day)}. Open Roster to accept or decline.`],
        },
      ]);
      const inserted = results[2][0];
      const name = nameOf(actor);
      const row = (await db.query(`SELECT ${SWAP_COLS} FROM roster_swap s WHERE s.request_id = $1::text`, [requestId]))[0];
      if (inserted && row) return res.json({ swap: toSwap(row, name) });
      if (row) {
        if (row.requester_email === myEmail(actor)) return res.json({ swap: toSwap(row, name), replayed: true });
        throw new RosterError(409, 'REQUEST_REUSED', 'That request id was already used.');
      }
      throw new RosterError(409, 'SWAP_STALE', 'One of the weekly offs changed or is already in another swap. Reload and try again.');
    })
  );

  /** A swap the caller may act on, with the day/state checks every action shares. */
  async function loadSwapFor(db: Queryable, actor: Actor, id: string): Promise<any> {
    const s = await getSwap(db, id);
    if (!s || !swapInScope(actor, s)) throw new RosterError(404, 'NOT_FOUND', 'Swap not found.');
    return s;
  }

  api.post(
    '/api/roster/swaps/:id/accept',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const nowMs = clock();
      const s = await loadSwapFor(db, actor, String(req.params.id));
      if (actor.role !== 'agent' || s.partner_email !== myEmail(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only the colleague who was asked can accept.');
      if (s.status !== 'awaiting_partner') throw new RosterError(409, 'STATE', 'This swap is no longer waiting for you.');
      if (Date.parse(s.expires_at) <= nowMs) throw new RosterError(409, 'EXPIRED', 'This swap request has expired.');
      const name = nameOf(actor);
      const results = await db.batch([
        {
          text: `UPDATE roster_swap SET status = 'awaiting_tl', partner_confirmed_at = now(), updated_at = now()
                 WHERE id = $1::uuid AND status = 'awaiting_partner' AND partner_email = $2::text AND expires_at > $3::timestamptz RETURNING id::text AS id`,
          params: [s.id, myEmail(actor), iso(nowMs)],
        },
        {
          text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail)
                 SELECT $2::text, 'agent', 'swap_accept', partner_entry, partner_email, team_key, partner_day, jsonb_build_object('swapId', id::text)
                 FROM roster_swap WHERE id = $1::uuid AND status = 'awaiting_tl' AND updated_at = now()`,
          params: [s.id, actor.login],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT team_key, 'swap_approval_needed', $2::text, $3::text FROM roster_swap WHERE id = $1::uuid AND status = 'awaiting_tl' AND updated_at = now()`,
          params: [s.id, `${name(s.requester_email)} and ${name(s.partner_email)} want to swap weekly offs`, `${dayLabel(s.requester_day)} and ${dayLabel(s.partner_day)}. Both agreed. Open Roster to approve.`],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT requester_email, 'swap_accepted', $2::text, $3::text FROM roster_swap WHERE id = $1::uuid AND status = 'awaiting_tl' AND updated_at = now()`,
          params: [s.id, `${name(s.partner_email)} accepted your swap`, 'It now waits for your TL to approve.'],
        },
      ]);
      if (results[0].length !== 1) throw new RosterError(409, 'STATE', 'This swap changed. Reload and try again.');
      return res.json({ swap: toSwap((await getSwap(db, s.id))!, name) });
    })
  );

  /** Decline (the partner) or cancel (the requester, or a TL's rejection): one open swap to a closed state, with notices. */
  async function closeSwap(db: Queryable, s: any, actor: Actor, to: 'declined' | 'cancelled' | 'rejected', note: string | null, notify: Array<{ to: 'requester' | 'partner'; kind: string; title: string; body: string }>): Promise<boolean> {
    const action = to === 'declined' ? 'swap_decline' : to === 'cancelled' ? 'swap_cancel' : 'swap_reject';
    const stmts: Stmt[] = [
      {
        text: `UPDATE roster_swap SET status = $2::text, decided_by = $3::text, decided_at = now(), decision_note = $4::text, updated_at = now()
               WHERE id = $1::uuid AND status IN ('awaiting_partner','awaiting_tl') RETURNING id::text AS id`,
        params: [s.id, to, actor.login, note],
      },
      {
        text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
               SELECT $2::text, $3::text, $4::text, requester_entry, requester_email, team_key, requester_day, jsonb_build_object('swapId', id::text), $5::text
               FROM roster_swap WHERE id = $1::uuid AND status = $6::text AND updated_at = now()`,
        params: [s.id, actor.login, actor.role, action, note, to],
      },
    ];
    for (const n of notify) {
      stmts.push({
        text: `INSERT INTO app_notification (recipient, kind, title, body)
               SELECT ${n.to === 'requester' ? 'requester_email' : 'partner_email'}, $2::text, $3::text, $4::text FROM roster_swap WHERE id = $1::uuid AND status = $5::text AND updated_at = now()`,
        params: [s.id, n.kind, n.title, n.body, to],
      });
    }
    const results = await db.batch(stmts);
    return results[0].length === 1;
  }

  api.post(
    '/api/roster/swaps/:id/decline',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const s = await loadSwapFor(db, actor, String(req.params.id));
      if (actor.role !== 'agent' || s.partner_email !== myEmail(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only the colleague who was asked can decline.');
      if (s.status !== 'awaiting_partner') throw new RosterError(409, 'STATE', 'This swap is no longer waiting for you.');
      const name = nameOf(actor);
      const ok = await closeSwap(db, s, actor, 'declined', clean(req.body?.note, 300, 'The note'), [
        { to: 'requester', kind: 'swap_declined', title: `${name(s.partner_email)} declined your swap`, body: `Your weekly off on ${dayLabel(s.requester_day)} stays as it is.` },
      ]);
      if (!ok) throw new RosterError(409, 'STATE', 'This swap changed. Reload and try again.');
      return res.json({ swap: toSwap((await getSwap(db, s.id))!, name) });
    })
  );

  api.post(
    '/api/roster/swaps/:id/cancel',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      const s = await loadSwapFor(db, actor, String(req.params.id));
      if (actor.role !== 'agent' || s.requester_email !== myEmail(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only the agent who asked can cancel the request.');
      if (!isOpenSwap(s.status)) throw new RosterError(409, 'STATE', 'This swap is already closed.');
      const name = nameOf(actor);
      const ok = await closeSwap(db, s, actor, 'cancelled', null, [
        { to: 'partner', kind: 'swap_cancelled', title: `${name(s.requester_email)} cancelled the swap request`, body: `Your weekly off on ${dayLabel(s.partner_day)} stays as it is.` },
      ]);
      if (!ok) throw new RosterError(409, 'STATE', 'This swap changed. Reload and try again.');
      return res.json({ swap: toSwap((await getSwap(db, s.id))!, name) });
    })
  );

  api.post(
    '/api/roster/swaps/:id/decision',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      if (!isStaff(actor)) throw new RosterError(403, 'FORBIDDEN', 'Only a TL or manager can approve or reject a swap.');
      const db = needDb();
      const nowMs = clock();
      const s = await loadSwapFor(db, actor, String(req.params.id));
      if (s.status !== 'awaiting_tl') throw new RosterError(409, 'STATE', s.status === 'awaiting_partner' ? 'The colleague has not accepted yet.' : 'This swap has already been decided.');
      if (!canChangeDay(s.requester_day, actor.role, nowMs) || !canChangeDay(s.partner_day, actor.role, nowMs)) {
        throw new RosterError(409, 'CUTOFF', 'One of the days has started, so this swap can no longer be decided.');
      }
      if (Date.parse(s.expires_at) <= nowMs) throw new RosterError(409, 'EXPIRED', 'This swap request has expired.');
      const decision = String(req.body?.decision ?? '');
      const note = clean(req.body?.note, 300, 'The note');
      const name = nameOf(actor);
      const when = `${dayLabel(s.requester_day)} and ${dayLabel(s.partner_day)}`;

      if (decision === 'reject') {
        if (!note) throw new RosterError(400, 'NOTE_REQUIRED', 'Say why you are rejecting this swap.');
        const ok = await closeSwap(db, s, actor, 'rejected', note, [
          { to: 'requester', kind: 'swap_rejected', title: 'Swap not approved', body: `Your swap (${when}) was not approved: ${note}` },
          { to: 'partner', kind: 'swap_rejected', title: 'Swap not approved', body: `The swap (${when}) was not approved: ${note}` },
        ]);
        if (!ok) throw new RosterError(409, 'STATE', 'This swap has already been decided.');
        return res.json({ swap: toSwap((await getSwap(db, s.id))!, name) });
      }
      if (decision !== 'approve') throw new RosterError(400, 'BAD_REQUEST', 'decision must be approve or reject.');

      // Apply: both weekly offs trade places in one transaction, after checking that nothing changed since the request
      const entryCols = `agent_email, day, kind, status, needs_approval, team_key, agent_type, location, source, swap_id, created_by, request_id, is_test, decided_by, decided_at`;
      const results = await db.batch([
        ...lockDays(s.team_key, s.requester_day, s.partner_day),
        {
          text: `UPDATE roster_swap s SET status = 'applied', decided_by = $2::text, decided_at = now(), decision_note = $3::text, updated_at = now()
                 WHERE s.id = $1::uuid AND s.status = 'awaiting_tl' AND s.expires_at > $4::timestamptz
                   AND (SELECT count(*) FROM roster_entry e WHERE e.id = s.requester_entry AND e.agent_email = s.requester_email AND e.kind = 'WO' AND e.status = 'approved' AND e.day = s.requester_day) = 1
                   AND (SELECT count(*) FROM roster_entry e WHERE e.id = s.partner_entry AND e.agent_email = s.partner_email AND e.kind = 'WO' AND e.status = 'approved' AND e.day = s.partner_day) = 1
                   AND NOT EXISTS (SELECT 1 FROM roster_entry e WHERE e.agent_email = s.requester_email AND e.day = s.partner_day AND e.status IN ('pending','approved') AND e.id <> s.requester_entry)
                   AND NOT EXISTS (SELECT 1 FROM roster_entry e WHERE e.agent_email = s.partner_email AND e.day = s.requester_day AND e.status IN ('pending','approved') AND e.id <> s.partner_entry)
                 RETURNING s.id::text AS id`,
          params: [s.id, actor.login, note, iso(nowMs)],
        },
        {
          text: `UPDATE roster_entry SET status = 'cancelled', swap_id = $1::uuid, decided_by = $2::text, decided_at = now(), decision_note = 'Swapped', updated_at = now()
                 WHERE id IN (SELECT requester_entry FROM roster_swap WHERE id = $1::uuid AND status = 'applied' AND updated_at = now()
                              UNION SELECT partner_entry FROM roster_swap WHERE id = $1::uuid AND status = 'applied' AND updated_at = now())`,
          params: [s.id, actor.login],
        },
        {
          text: `INSERT INTO roster_entry (${entryCols})
                 SELECT s.requester_email, s.partner_day, 'WO', 'approved', false, s.team_key, s.agent_type, s.location, 'swap', s.id, $2::text, 'swap-' || s.id::text || '-r', s.is_test, $2::text, now()
                 FROM roster_swap s WHERE s.id = $1::uuid AND s.status = 'applied' AND s.updated_at = now()`,
          params: [s.id, actor.login],
        },
        {
          text: `INSERT INTO roster_entry (${entryCols})
                 SELECT s.partner_email, s.requester_day, 'WO', 'approved', false, s.team_key, s.agent_type, s.location, 'swap', s.id, $2::text, 'swap-' || s.id::text || '-p', s.is_test, $2::text, now()
                 FROM roster_swap s WHERE s.id = $1::uuid AND s.status = 'applied' AND s.updated_at = now()`,
          params: [s.id, actor.login],
        },
        {
          text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
                 SELECT $2::text, $3::text, 'swap_apply', requester_entry, requester_email, team_key, requester_day,
                        jsonb_build_object('swapId', id::text, 'partner', partner_email, 'partnerDay', partner_day::text), $4::text
                 FROM roster_swap WHERE id = $1::uuid AND status = 'applied' AND updated_at = now()`,
          params: [s.id, actor.login, actor.role, note],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT requester_email, 'swap_applied', 'Swap approved', 'Your weekly off is now on ' || partner_day::text || '.' FROM roster_swap WHERE id = $1::uuid AND status = 'applied' AND updated_at = now()`,
          params: [s.id],
        },
        {
          text: `INSERT INTO app_notification (recipient, kind, title, body)
                 SELECT partner_email, 'swap_applied', 'Swap approved', 'Your weekly off is now on ' || requester_day::text || '.' FROM roster_swap WHERE id = $1::uuid AND status = 'applied' AND updated_at = now()`,
          params: [s.id],
        },
      ]);
      if (results[lockDays(s.team_key, s.requester_day, s.partner_day).length][0] === undefined) {
        // Something changed since the request (a weekly off was cancelled, revoked or covered by another entry)
        const stale = 'One of the weekly offs changed after the request was made, so the swap could not be applied.';
        await db.batch([
          { text: `UPDATE roster_swap SET status = 'failed', fail_reason = $2::text, updated_at = now() WHERE id = $1::uuid AND status = 'awaiting_tl'`, params: [s.id, stale] },
          {
            text: `INSERT INTO roster_audit (actor, actor_role, action, entry_id, agent_email, team_key, day, detail, note)
                   SELECT $2::text, $3::text, 'swap_fail', requester_entry, requester_email, team_key, requester_day, jsonb_build_object('swapId', id::text), $4::text
                   FROM roster_swap WHERE id = $1::uuid AND status = 'failed' AND updated_at = now()`,
            params: [s.id, actor.login, actor.role, stale],
          },
        ]);
        const fresh = await getSwap(db, s.id);
        if (fresh?.status === 'failed') {
          await notifyBoth(db, s.id, 'swap_failed', 'Swap could not be applied', `${when}: ${stale}`);
          throw new RosterError(409, 'SWAP_STALE', stale);
        }
        throw new RosterError(409, 'STATE', 'This swap has already been decided.');
      }
      return res.json({ swap: toSwap((await getSwap(db, s.id))!, name) });
    })
  );

  // ------------------------------------------------------------------ in-app inbox

  api.get(
    '/api/notifications',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      if (!actor.inboxKeys.length) return res.json({ items: [], unread: 0 });
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
      const rows = await db.query(
        `SELECT id, kind, title, body, entry_id::text AS entry_id, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, read_at IS NOT NULL AS read
         FROM app_notification WHERE recipient = ANY($1::text[]) ORDER BY created_at DESC, id DESC LIMIT $2::int`,
        [actor.inboxKeys, limit]
      );
      const items: RosterNotificationDTO[] = rows.map((r) => ({ id: Number(r.id), kind: r.kind, title: r.title, body: r.body, entryId: r.entry_id, createdAt: r.created_at, read: Boolean(r.read) }));
      return res.json({ items, unread: await unreadCount(db, actor.inboxKeys) });
    })
  );

  // ------------------------------------------------------------------ web push

  api.get(
    '/api/push/config',
    route(async (req, res) => {
      await ctx.authenticate(req);
      return res.json({ enabled: pushConfigured(), publicKey: pushConfigured() ? pushPublicKey() : '' });
    })
  );

  api.post(
    '/api/push/subscribe',
    route(async (req, res) => {
      const actor = (await resolveActor(req)) as Actor;
      const db = needDb();
      const sub = req.body?.subscription;
      const endpoint = String(sub?.endpoint || '');
      const p256dh = String(sub?.keys?.p256dh || '');
      const auth = String(sub?.keys?.auth || '');
      if (!endpoint.startsWith('https://') || endpoint.length > 2048 || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
        throw new RosterError(400, 'BAD_SUBSCRIPTION', 'That notification address is not valid.');
      }
      await db.query(
        `INSERT INTO push_subscription (endpoint, p256dh, auth, login_email, keys, user_agent)
         VALUES ($1::text, $2::text, $3::text, $4::text, $5::text[], $6::text)
         ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, login_email = EXCLUDED.login_email,
           keys = EXCLUDED.keys, user_agent = EXCLUDED.user_agent, failed_count = 0, last_seen_at = now()`,
        [endpoint, p256dh, auth, norm(actor.login), actor.inboxKeys, String(req.headers['user-agent'] || '').slice(0, 200)]
      );
      return res.json({ ok: true, receives: actor.inboxKeys.length > 0 });
    })
  );

  api.post(
    '/api/push/unsubscribe',
    route(async (req, res) => {
      const actor = (await resolveActor(req)) as Actor;
      const db = needDb();
      await db.query(`DELETE FROM push_subscription WHERE endpoint = $1::text AND login_email = $2::text`, [String(req.body?.endpoint || ''), norm(actor.login)]);
      return res.json({ ok: true });
    })
  );

  api.post(
    '/api/push/test',
    route(async (req, res) => {
      const actor = (await resolveActor(req)) as Actor;
      const db = needDb();
      if (!pushConfigured()) throw new RosterError(503, 'PUSH_OFF', 'Notifications are not set up on the server yet.');
      return res.json({ ok: true, reached: await sendTestPush(db, norm(actor.login)) });
    })
  );

  api.post(
    '/api/notifications/read',
    route(async (req, res) => {
      const actor = await actorOrRefuse(req);
      const db = needDb();
      if (!actor.inboxKeys.length) return res.json({ ok: true });
      const ids: number[] | null = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
      await db.query(
        ids
          ? `UPDATE app_notification SET read_at = now() WHERE recipient = ANY($1::text[]) AND read_at IS NULL AND id = ANY($2::bigint[])`
          : `UPDATE app_notification SET read_at = now() WHERE recipient = ANY($1::text[]) AND read_at IS NULL`,
        ids ? [actor.inboxKeys, ids] : [actor.inboxKeys]
      );
      return res.json({ ok: true });
    })
  );
}
