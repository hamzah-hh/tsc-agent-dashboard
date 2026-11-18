# Rostering (weekly offs, planned leave, swaps): implementation plan and review of the requirements

Status: plan only, nothing implemented. Written 2026-11-18 (Wednesday). Nothing in the app changes until the owner answers the open questions in section I.

---

## Summary

**What it is.** Agents choose their weekly off (WO) and request planned leave (PL) for the current week and the next 2 weeks. Each Team Leader (TL, the "Reporting Manager") sets how many of their agents may be off on a given day: one limit for every day, plus limits for particular dates. Agents can swap WOs with a colleague of the same caller type and location. A swap needs consent from both agents and the TL's approval. Mails go out from `crmsales@thesleepcompany.in`.

**Key decisions recommended in this plan**

1. **New relational Postgres tables now, not the `doc_store` bridge.** The limit has to hold when two agents take the last slot at the same moment. The bridge has no conditional write: `Backend.commit` in `server-db.ts` and `PgDocBackend.commit` in `server-pg.ts` are blind upserts. Rostering is also the first business data the app creates itself, so the Google Sheet cannot rebuild it if it is lost. The tables are new and stand alone: no change to the sync, to `doc_store` or to any existing table.
2. **Send mail through Microsoft Graph, not Google.** I checked the public DNS records. `thesleepcompany.in` is hosted on **Microsoft 365**: the MX is `...mail.protection.outlook.com`, the M365 DKIM selectors are set up, and DMARC is `p=quarantine`. The Google Workspace SMTP relay and the Gmail API are therefore not options. The recommendation is Graph `sendMail` as the `crmsales` mailbox, with an app registration restricted to that one mailbox. Fallback: the domain also has SendGrid domain authentication (a DKIM selector `s1` pointing at SendGrid), so a SendGrid account already exists somewhere in the company.
3. **Ship in small phases behind a flag, one pilot team first.** P1 is WO/PL with limits and in-app approvals, with no mail at all. Mail comes in P2, swaps in P3.

**Top 10 suggested changes and risks (detail in section B)**

| # | Change or risk | Why it matters |
|---|---|---|
| 1 | **Decide whether this app is the system of record for leave.** If PL also lives in an HRMS or payroll tool, mark PL here as a "plan" that the HRMS must confirm, or leave PL out of v1 | Two places that disagree on leave cause payroll disputes |
| 2 | **Pending requests hold a slot**, and every approval, swap and TL override re-checks the limit inside one database transaction | Without this, a limit of 2 ends up with 3 people off |
| 3 | **A change cut-off** (for example D-1 at 18:00 IST for agents; TL until the day starts; Manager any time) | Stops last-minute WO changes that leave a shift short |
| 4 | **Fairness of popular days.** Open booking for week W+2 at a fixed time (Mon 10:00 IST), and optionally cap weekend WOs per agent per month | Otherwise whoever books first, or at midnight, gets every Saturday and Sunday |
| 5 | **Guarantee that every agent can get their 1 WO.** Warn the TL when 7 × the limit is less than team size, and let PL not crowd WOs out | A full limit must not deny the weekly holiday the law requires |
| 6 | **Swap consent in the app instead of OTP-by-mail** (OTP kept as an option) | Both agents are already signed in with Google, so an OTP adds mail delay and a failure point but little security |
| 7 | **No approve or reject on a link click in mail.** Mail carries a link to the dashboard, and the TL approves there while signed in | Microsoft Defender "Safe Links" opens links in mail by itself, so a one-click link would approve requests nobody looked at |
| 8 | **Expiry and escalation for pending items.** Remind the TL at 24 h, escalate to Managers at 48 h, expire at the cut-off | Requests still pending when the date arrives leave agents not knowing whether they are off |
| 9 | **The roster does not depend on the incentive cycle.** `diwali-2026` ends on 30 Nov, but today's 3-week window already reaches 6 Dec | Agent records live under `cycles/{id}/agents`; when the cycle changes, agents with no data yet disappear |
| 10 | **Mail safety:** an outbox with retries, a `MAIL_MODE` switch (off / log / redirect / live), rate limits, only templated mails to addresses taken from the roster data, and an in-app fallback for every mail | Mail must never block a roster action, spam anyone, or reach real people from a test run |

**Effort:** about 13-17 developer days across 4 phases, plus 1-2 days of the owner's or IT's time for the Microsoft 365 setup (section H).

---

## What exists today (relevant findings)

- **Auth.** `server-routes.ts`: `authenticate()` verifies the Firebase ID token and requires a verified email. `identify()` returns `superAdmin` or `manager` (from `config/app` lists), or `tl` / `agent` from `access/{loginEmail}`, falling back to the agent list. TL scoping is `isAgentOfTl()`: the agent's TL personal or official email matches the TL's login or official email, crosswise too; agents with no TL at all belong to the TL of their location, and a `dighe` TL also gets `dighe (pre sales)`. Agents only ever see their own `officialEmail`.
- **Agent attributes.** `AgentRecord` (`src/shared/types.ts`) has `agentType` (`HO | STORE | PRE_SALES`), `location`, `tlOfficialEmail`, `tlPersonalEmail` and `personalEmail` (the Google login). `server-import.ts` normalises the Pre Sales location to **`Dighe (Pre Sales)`** (lines ~1035-1040). `appConfig.locations` is `['Dighe (Pre Sales)', 'Dighe', 'Andheri', 'Bangalore']`.
- **TLs are not agents.** A TL's `access` record says `name: 'Team Leader'`, and its `location` is the location of whichever of their agents was written last. TLs have no `AgentRecord`, no daily data and no roster today.
- **Agents are per cycle.** `loadAgents(activeCycleId)` reads `cycles/{c}/agents`. An agent with no data rows in the cycle has no record, and the code warns that such agents "cannot sign in yet". `diwali-2026` runs 2026-10-01 to 2026-11-30.
- **Working days.** `Cycle.workingDaysPerWeek = 6`, which matches 1 WO a week. `AgentDailyEntry.day` is 1, 0.5 or 0 per day. `absentDays` exists and feeds `DeductionRule` (`metric: 'absentDays'`), but the clean-sheet sync never computes it: it only carries the old value forward, so it is in practice `null`.
- **Login time limiter.** `server-login-tracker.ts` allows agents 30 min in the AM window and 30 min in the PM window (IST), and it uses `Intl` with `Asia/Kolkata` for the date key. Time spent on rostering screens would count against it.
- **Database.** Production has run `DB_MODE=postgres` since 2026-11-09. `server-pg.ts` is a `doc_store` jsonb bridge on Neon's **HTTP** driver: `sql.transaction([...])` runs a non-interactive transaction, so you cannot read, decide in TypeScript, and then write inside one transaction. Phase B of `docs/POSTGRES_MIGRATION_PLAN.md` (relational tables, the `db/migrations` runner, PGlite in tests, `server-pg/scope.ts`) is **not built yet**: there is no `db/` folder and no PGlite dependency. Tests run `DB_MODE=local` (`tests/run-all.ts`, `tests/api.test.ts`, with the `check/section` harness and fake `test:<email>:<name>` tokens).
- **Mail.** There is no mail-sending code in the app and no mail environment variables. The existing variable names are `SYNC_KEY`, `MONITOR_KEY`, `COHORT_REPORT_VIEWERS`, `FIREBASE_SERVICE_ACCOUNT`, `GEMINI_API_KEY`, `SUPER_ADMIN_EMAILS`, `MANAGER_EMAILS`, `DB_MODE`, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH` and `APP_URL`. The migration plan explicitly left email out of scope (its Q4).
- **Mail domain (public DNS, checked 2026-11-18).** MX is Microsoft 365 (Exchange Online). The SPF record already holds many includes (outlook, mcsv/Mailchimp, netcore, several IPs), so it is close to SPF's 10-lookup limit. DKIM selectors exist for M365 (`selector1/2`) and for SendGrid (`s1`). DMARC is `p=quarantine; pct=100`, so mail that does not authenticate goes to junk.
- **Hosting.** Vercel `sin1`. One function, `api/index.js`, is an esbuild bundle of `api/_source.ts`; it is committed, and CI checks that it matches the source, so every server change must also rebuild and commit `api/index.js`. `maxDuration` is 60 s. The migration plan assumes Vercel Hobby, which allows only **daily** cron jobs.
- **UI.** `AgentView.tsx` has the tabs `home | revenue | calls | breaks | rawData`, with a horizontally scrolling segmented control. `StaffPortal.tsx` has the tabs `team | summary | cohort | leaderboards | dod | rawData | syncStatus | admin`, shown by role. `App.tsx` sends `agent` to `AgentView` and `tl / manager / superAdmin` to `StaffPortal`.

---

## A. The requirements restated as precise rules, with the ambiguities

### A.1 Precise rules (with the recommended defaults applied)

**Definitions**
- **Day:** an IST calendar date (`Asia/Kolkata`). All rules run in IST, whatever time zone the browser is in.
- **Week:** Monday 00:00 to Sunday 23:59 IST (ISO week).
- **Booking window:** from the first date that is still changeable (see cut-off) through the Sunday of the week after next. Today, Wed 18 Nov 2026, that is **19 Nov to 6 Dec** (Thu 19 Nov is changeable until the D-1 18:00 cut-off).
- **Cut-off:** an agent may create or cancel an entry for date D only until **D-1 at 18:00 IST**. A TL may act until D at 00:00 (or later, see A.2 #11). Managers and the Super Admin may act any time, with a reason, and it is audited.
- **Team:** the agents for whom `isAgentOfTl(agent, tlLogin, tlAccess)` is true. The **team key** is the normalised TL official email, else the TL personal email, else `loc:<location>` for agents with no TL.
- **Inactive:** an agent with a WO or PL entry on that date whose status is `pending` or `approved`. Unplanned absences, sick leave and half days are not counted (not tracked in v1).
- **Limit:** the most agents of a team who may be inactive on a date. The precedence is a date-specific limit, then the team's "all days" limit, then the system default (A.2 #5).

**Rules**
- R1. An agent may hold at most **one self-service WO per week**. That WO is confirmed (`approved`) straight away if the limit allows, and the TL is notified.
- R2. A **second or further WO in the same week** is created as `pending`. It holds a slot and needs the TL's approval.
- R3. **PL** is created as `pending` (default; see A.2 #2). It holds a slot and needs the TL's approval.
- R4. No entry is created when the team's inactive count on that date, plus this request, would exceed the limit. The agent sees the reason and the TL is not mailed. (The TL can override with a reason, which is audited.)
- R5. An agent may create, cancel or swap entries only inside the booking window and before the cut-off.
- R6. An agent cannot have two active entries on the same date.
- R7. A TL may set the "all days" limit and date limits for their own team only. Managers and the Super Admin may do it for any team.
- R8. A **swap** exchanges two confirmed WOs: agent A's WO on X and agent B's WO on Y become A on Y and B on X. Both agents must have the same `agentType` **and** the same normalised `location` (F.2). It needs the consent of both agents (OTP or in-app, F.3) **and** the approval of the TL (of both TLs, if they differ). The limits and the weekly WO rule are checked again when the swap is applied.
- R9. Every notification is sent from `crmsales@thesleepcompany.in`. Every notification also appears in the app, so a failed mail never blocks anything.
- R10. Every create, change, decision, limit change and swap step is written to an append-only audit log.

### A.2 Ambiguities and contradictions, with a recommended default for each

| # | Ambiguity | Recommended default |
|---|---|---|
| 1 | **"1 WO a week" vs "more than 1 WO needs approval"** contradict each other unless 1 is the self-service allowance | 1 WO a week is self-service. A 2nd (or 3rd) WO in the same week is a request that needs the TL's approval. Hard maximum of 2 WOs a week, even with approval (configurable) |
| 2 | **What PL means** (Planned Leave or Privilege Leave), whether it needs approval, and whether it has a balance | "Planned Leave", always approved by the TL. **No balance kept in v1.** The app records the plan, and HR or payroll stays the system of record (Q1). If there is an HRMS, the app shows "PL approved here must also be applied in <HRMS>" |
| 3 | **Requirement 2 says agents set WO/PL "up to the limit" but also that the TL must "verify and approve"**: is every WO subject to approval? | A first WO within the limit is **confirmed immediately**. The TL gets it in a daily digest and can revoke it before the cut-off, which mails the agent. Only PL, the 2nd+ WO and swaps wait for approval |
| 4 | **What the limit counts**: approved only, or pending too? WO+PL only? Test or excluded agents? | Pending and approved WO+PL count. Rejected, cancelled, expired and revoked entries do not. Test agents (`isTest`) and excluded agents never count toward a real team, and are never counted as team size |
| 5 | **No limit set yet** | System default limit = `ceil(team size / 6)` (one sixth of the team, matching `workingDaysPerWeek = 6`), with a banner asking the TL to set one. A TL can set 0 for a date (nobody off, for example a sale day) |
| 6 | **Limit per team, or per type and location inside a team?** Some TLs may have mixed teams (for example Dighe HO plus Pre Sales) | v1: one limit per team per date. v2 (if Q8 says so): an optional sub-limit per (team, agentType, location) |
| 7 | **A limit lowered below what is already booked** | Existing entries are **never cancelled automatically**. The day shows "Over limit: 4 off, limit 3"; new bookings are refused; the TL decides whom to revoke, and each revoked agent is mailed and sees it in the app |
| 8 | **Which day the week starts** | Monday (ISO). Shown in the UI as "Week of Mon 16 Nov" |
| 9 | **Time zone** | IST everywhere: dates are stored as SQL `date` values and timestamps as `timestamptz`. "Today" is computed the same way as `getWindowInfo()` in `server-login-tracker.ts` |
| 10 | **"Current week + next 2 weeks"**: does it include past days of the current week, and today? | Not past days. Today only for TLs and Managers (agents are past the D-1 18:00 cut-off) |
| 11 | **Cut-off for changes** | Agent: D-1 18:00 IST. TL: until D 00:00 IST. Manager or Super Admin: any time, with a reason. All configurable in `app_config.roster` |
| 12 | **A TL's own roster and limit**: who approves a TL's WO? TLs have no `AgentRecord` and are not in the agent list | v1: TLs are **not rostered** in the app. v2: TLs request their WO/PL from a Manager, using the same tables with `team_key = 'tls'` |
| 13 | **Managers and Super Admin roles** in rostering | They see every team, can set any team's limits, and can approve, reject, revoke and act on behalf of anyone. They are the escalation target for pending items (A.2 #15). TLs see their own team only |
| 14 | **Effect on incentive "active days" and attendance** | **None in v1.** Incentives use worked days from the Dialer/PreSales tabs (`day` 1/0.5/0). A WO is simply a day with no data, and averages are per worked day, so a WO does not hurt the agent. `absentDays` is not fed from the roster in v1. v2 option: an adherence report comparing rostered working days with Dialer days, and later (only if the owner wants) `absentDays = rostered working days - worked days` |
| 15 | **Approvals still pending when the date arrives** | Reminder to the TL after 24 h, escalation mail to Managers after 48 h, status `expired` at the cut-off for D (the slot is freed, and the agent is mailed and told in the app: "not approved in time") |
| 16 | **Leave or WO on a date already worked**, or a date in the past | Not allowed: past dates are outside the window. If Dialer data later shows that an agent worked on a WO/PL day, the v2 adherence report flags it and the roster is not changed |
| 17 | **Cancelling an approved WO/PL** | The agent may cancel before the cut-off, and the slot is freed. Cancelling a WO that came from a swap is not allowed (ask the TL) |
| 18 | **An agent who picks no WO for a week** | Reminder on Thursday for the following week. If still none by Friday 18:00, the TL sees "no WO yet" in the grid and can assign one. The app does **not** assign WOs by itself in v1 |
| 19 | **Swaps across TLs or across weeks** | Allowed only within the same type and location. **v1: same TL only**, which keeps the limit neutral and needs one approver. Across weeks: allowed only when both dates are in the same week (otherwise one agent ends up with 0 WOs in one week and 2 in the other) |
| 20 | **Where the "official email" goes for agents** | TLs are mailed at `tlOfficialEmail` (@thesleepcompany.in). Agents are mailed at their **personal Gmail** (the address they sign in with and certainly read), unless Q5 says agents use their official mailbox |
| 21 | **Half days** (`day = 0.5` exists in the data) | Out of scope for v1. Whole days only |
| 22 | **Agents moving team, location or type**, or leaving | Team membership is evaluated **at the time of each action** from the current agent list. Future entries stay with the agent. An agent who leaves (Status not Active, so excluded) has future entries cancelled by the daily job, with an audit row |
| 23 | **What happens on a cycle change** (`diwali-2026` ends 30 Nov; the window already reaches 6 Dec) | The roster is **not** stored under a cycle. Team membership comes from the active cycle's agent list and, at the boundary, also from the previous cycle's list (section C.5) |

---

## B. Suggested changes to the requirements (ranked by importance)

1. **Agree the system of record for leave (Critical).** If PL is recorded in an HRMS or payroll, approving it here as well creates two truths. Options: (a) PL lives here and HR exports it (CSV, section D); (b) PL here is only a plan, and HR applies it; (c) leave PL out of v1 and roster WOs only. **Recommendation: (b) for v1.**
2. **Pending requests hold slots, and every state change re-checks the limit atomically (Critical).** That covers create, approve, a TL acting on behalf, swap apply, and the cap set by a limit change. Otherwise "approve" can push a day over the limit, because other bookings happened between the request and the approval.
3. **Cut-offs (High).** Without one, an agent can drop a WO at 08:55 for a 09:00 shift, or the TL approves a PL after the day has started. Recommended: agent D-1 18:00, TL D 00:00, Manager any time with a reason.
4. **Fairness on popular days (High).** First come, first served means the same people get every Sunday, and agents book at midnight when the window opens. Suggested: (a) the window for a new week opens at a fixed time (Monday 10:00 IST opens the week after next); (b) optionally at most N weekend WOs per agent per rolling 4 weeks (configurable, default off); (c) the TL grid shows WO-day distribution per agent, so the TL can rebalance.
5. **The weekly WO guarantee (High).** With limit L, at most 7×L person-days off fit in a week. If team size > 7×L (minus PL), someone cannot get a WO. The app should warn the TL when they set limits that make this impossible ("12 agents, but your limits allow only 9 WOs this week"). Optionally, reserve WO capacity: PL may use at most `L - 1` of a day's slots unless the TL overrides.
6. **Replace OTP-by-mail with in-app consent (Medium-High).** Both agents are signed in with Google, so an in-app "Accept swap" by agent B, plus agent A's own request, already proves consent from both. An OTP mail adds 1-5 minutes of mail delay, a dependency on M365 and on junk filters, codes read out over chat, and cost. Recommendation: in-app accept by default; **OTP stays available** as a switch (`app_config.roster.swapOtp = true`) if the owner wants it for policy reasons.
7. **No one-click approval from mail (High, security).** Microsoft Defender Safe Links and other mail scanners pre-open links, and forwarded mail can be clicked by anyone. Mails link to the dashboard (`APP_URL/?tab=roster&item=<id>`), and the action is a signed-in POST.
8. **Expiry and escalation for pending items (High).** See A.2 #15.
9. **Decouple from the incentive cycle (High).** See A.2 #23 and C.5.
10. **Mail safety and fallbacks (High).** See section E.
11. **Audit and history (Medium-High).** Every change is an append-only row: who, what, before and after, when, and on whose behalf. TLs see their team's history and Managers see all. The CSV export is in the existing style (`src/utils/csv.ts`).
12. **Limits on churn (Medium).** At most 3 WO changes per agent per week, at most 2 swap requests per agent per week, and at most 1 open outgoing swap at a time. This stops gaming and mail floods.
13. **Privacy (Medium).** Agents see slot counts per day ("1 of 3 left"), not who is off, and never PL reasons. The swap screen shows only eligible colleagues' **WO** dates (names needed to pick a partner), never PL.
14. **TL absence (Medium).** If the TL is on leave, approvals stall. Managers can approve every team; an optional "delegate approver" per team can come in v2.
15. **Team-level vs sub-group limits (Medium).** A mixed team may need per-type coverage (Q8).
16. **Backups (Medium).** Roster data cannot be rebuilt from the sheet. The Neon free plan's point-in-time history window is short. Add a weekly CSV export (Admin), and optionally write the roster to a `Roster` tab in the Google Sheet through Apps Script pulling a read-only endpoint (v2). That also gives Ops visibility in the sheet they already use.
17. **Login time limiter (Low-Medium).** Rostering uses up the agents' 30-minute portal windows. Either accept that (a WO takes under a minute) or exempt the roster screen from the heartbeat (Q12).
18. **Later: an adherence report (Low, v2).** Rostered WO vs actual worked day, from the Dialer data the app already has. This is the natural link to the "Breaks & Adherence" tab.

---

## C. Data model

### C.1 Bridge or relational: decision

**Relational tables, created now, standalone (no dependency on Phase B).**

| Criterion | `doc_store` bridge | Relational tables |
|---|---|---|
| Limit under concurrency | No conditional write: `commit()` is blind upserts. A read, check, write sequence across two HTTP calls lets two agents both take the last slot. A compare-and-set would mean extending the `Backend` contract in all three backends (Firestore REST, local, pg) | One non-interactive transaction holding an advisory lock plus a conditional `INSERT` (D.4). Partial unique indexes stop double booking |
| Queries (team × 21 days, approvals queue, audit by agent) | Must load whole collections and filter in TypeScript | Plain indexed SQL |
| Fit with the migration plan | The bridge is to be retired (P4). New data on it means migrating it twice | §2.4 of the plan says a feature like leave requests gets **its own table once it is relational ("leave balances")**. Rostering is exactly that case |
| Rollback | Survives `DB_MODE=firestore` | Needs `DATABASE_URL`. With `DB_MODE=firestore` the Roster tab says "temporarily unavailable" and the rest of the app works. Acceptable |
| Owner's caution about data model and sync | No sync change | **No sync change either.** Purely additive tables, no foreign keys into tables that do not exist yet, no change to `doc_store` |

Practicalities:
- Add the plan's §2.1 migration runner in a minimal form now: `db/migrations/010_roster.sql` plus `scripts/migrate.ts` (`npm run db:migrate`), run by the owner or developer with the owner connection. (The current bridge creates `doc_store` at runtime in `PgDocBackend.init()`. The roster should not, because the plan wants the app role without DDL rights.)
- A small `Queryable` interface (`query(sql, params)`, `transaction(stmts)`) with two adapters: Neon HTTP in production and **PGlite** in tests (new devDependency `@electric-sql/pglite`; the plan already chose it). This is P0 work from the migration plan anyway, so doing it here is not wasted.
- The roster module reads `DATABASE_URL` directly, independently of `DB_MODE`, so it works both when the rest of the app is on the bridge and after Phase B.
- Later, once Phase B's `agent` table exists, add foreign keys from `agent_email` to `agent(official_email)` in a follow-up migration.

### C.2 Tables (`010_roster.sql`)

```sql
-- Limits: one "all days" row per team (day IS NULL) and any number of date rows
CREATE TABLE roster_limit (
  id            bigserial PRIMARY KEY,
  team_key      text NOT NULL,                 -- normalised TL official email, else TL personal, else 'loc:<location>'
  day           date,                          -- NULL = all days
  max_inactive  int  NOT NULL CHECK (max_inactive BETWEEN 0 AND 100),
  note          text CHECK (length(note) <= 200),
  set_by        text NOT NULL,                 -- login email
  set_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX roster_limit_default_uq ON roster_limit (team_key) WHERE day IS NULL;
CREATE UNIQUE INDEX roster_limit_day_uq     ON roster_limit (team_key, day) WHERE day IS NOT NULL;

-- One row per agent per day off (WO or PL), whatever its status
CREATE TABLE roster_entry (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_email      text NOT NULL,              -- official email (AgentRecord.officialEmail), lower-case
  day              date NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('WO','PL')),
  status           text NOT NULL CHECK (status IN ('pending','approved','rejected','cancelled','expired','revoked')),
  needs_approval   boolean NOT NULL,           -- PL, 2nd+ WO in the week, TL over-limit override
  team_key         text NOT NULL,              -- snapshot at creation (membership is re-evaluated per action)
  agent_type       text NOT NULL,              -- snapshot: HO | STORE | PRE_SALES
  location         text NOT NULL,              -- snapshot, normalised ('Dighe (Pre Sales)' etc.)
  source           text NOT NULL CHECK (source IN ('self','tl','manager','swap')),
  swap_id          uuid,
  reason           text CHECK (length(reason) <= 300),   -- agent's note (PL); never shown to other agents
  over_limit       boolean NOT NULL DEFAULT false,       -- created by an override above the limit
  created_by       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_by       text, decided_at timestamptz, decision_note text CHECK (length(decision_note) <= 300),
  request_id       uuid NOT NULL UNIQUE,       -- idempotency key from the client
  is_test          boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
-- an agent holds at most one active entry per day
CREATE UNIQUE INDEX roster_entry_active_uq ON roster_entry (agent_email, day) WHERE status IN ('pending','approved');
CREATE INDEX roster_entry_day_idx    ON roster_entry (day) WHERE status IN ('pending','approved');
CREATE INDEX roster_entry_team_idx   ON roster_entry (team_key, day);
CREATE INDEX roster_entry_agent_idx  ON roster_entry (agent_email, day DESC);
CREATE INDEX roster_entry_pending_idx ON roster_entry (team_key, created_at) WHERE status = 'pending';

CREATE TABLE roster_swap (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email  text NOT NULL,
  partner_email    text NOT NULL,
  requester_entry  uuid NOT NULL REFERENCES roster_entry(id),   -- A's WO on X
  partner_entry    uuid NOT NULL REFERENCES roster_entry(id),   -- B's WO on Y
  requester_day    date NOT NULL,              -- X
  partner_day      date NOT NULL,              -- Y
  agent_type       text NOT NULL,
  location         text NOT NULL,
  requester_team   text NOT NULL,
  partner_team     text NOT NULL,
  status           text NOT NULL CHECK (status IN
                     ('awaiting_partner','awaiting_tl','applied','rejected','declined','expired','cancelled','failed')),
  requester_confirmed_at timestamptz,
  partner_confirmed_at   timestamptz,
  tl_decided_by    text, tl_decided_at timestamptz, tl_note text,
  partner_tl_decided_by text, partner_tl_decided_at timestamptz,   -- only for cross-team swaps (v2)
  fail_reason      text,
  expires_at       timestamptz NOT NULL,       -- min(cut-off of X, cut-off of Y, created_at + 72 h)
  request_id       uuid NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (requester_email <> partner_email)
);
-- one open swap per entry
CREATE UNIQUE INDEX roster_swap_open_req_uq  ON roster_swap (requester_entry) WHERE status IN ('awaiting_partner','awaiting_tl');
CREATE UNIQUE INDEX roster_swap_open_part_uq ON roster_swap (partner_entry)   WHERE status IN ('awaiting_partner','awaiting_tl');

-- OTPs (only when app_config.roster.swapOtp is on)
CREATE TABLE roster_otp (
  id           bigserial PRIMARY KEY,
  swap_id      uuid NOT NULL REFERENCES roster_swap(id),
  party        text NOT NULL CHECK (party IN ('requester','partner')),
  code_hash    text NOT NULL,                  -- HMAC-SHA256(ROSTER_OTP_SECRET, swap_id|party|code)
  expires_at   timestamptz NOT NULL,
  attempts     int NOT NULL DEFAULT 0,
  sent_count   int NOT NULL DEFAULT 1,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  verified_at  timestamptz,
  UNIQUE (swap_id, party)
);

-- Append-only audit (the app role gets INSERT and SELECT only)
CREATE TABLE roster_audit (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL,
  actor_role  text NOT NULL,
  action      text NOT NULL,    -- entry.create|entry.cancel|entry.approve|entry.reject|entry.revoke|entry.expire|
                                -- limit.set|limit.clear|swap.request|swap.confirm|swap.decline|swap.approve|swap.reject|
                                -- swap.apply|swap.fail|swap.expire|otp.send|otp.fail|otp.lock|mail.fail|override
  entity      text NOT NULL,    -- 'entry' | 'limit' | 'swap'
  entity_id   text NOT NULL,
  team_key    text,
  agent_email text,
  day         date,
  before      jsonb,
  after       jsonb,
  request_id  uuid
);
CREATE INDEX roster_audit_agent_idx ON roster_audit (agent_email, at DESC);
CREATE INDEX roster_audit_team_idx  ON roster_audit (team_key, at DESC);

-- Mail outbox (shared by every future mail feature)
CREATE TABLE email_outbox (
  id               bigserial PRIMARY KEY,
  dedupe_key       text NOT NULL UNIQUE,       -- e.g. 'entry:<id>:approved:agent'
  to_email         text NOT NULL,
  cc_email         text,
  template         text NOT NULL,
  subject          text NOT NULL,
  payload          jsonb NOT NULL,             -- template data only, never a free-form body
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed','dead','suppressed')),
  attempts         int NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  last_error       text,
  provider_id      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz
);
CREATE INDEX email_outbox_due_idx ON email_outbox (next_attempt_at) WHERE status IN ('queued','failed');

-- In-app notifications (the fallback for every mail, and the source of the badge)
CREATE TABLE app_notification (
  id          bigserial PRIMARY KEY,
  user_email  text NOT NULL,                   -- official email (agent) or TL team key / manager login
  kind        text NOT NULL,
  title       text NOT NULL,
  link        text,
  entity_id   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz
);
CREATE INDEX app_notification_user_idx ON app_notification (user_email, read_at, created_at DESC);

REVOKE UPDATE, DELETE ON roster_audit FROM app_rw;   -- if the app_rw role exists (migration plan §7)
```

Global policy lives in the existing `config/app` document as `appConfig.roster`, editable by the Super Admin in the Admin tab with no redeploy, like the planned `pgReads` flags:
`{ enabled: false, pilotTeams: string[], windowWeeks: 3, weekStart: 'MON', agentCutoff: 'D-1T18:00', tlCutoff: 'D', maxWoPerWeek: 2, selfServiceWoPerWeek: 1, defaultLimitRule: 'ceilSixth', swapOtp: false, swapSameTeamOnly: true, bookingOpensAt: 'MON10:00', weekendCap: null, mailMode: 'off' }` (`mailMode` may also be set by an environment variable, which wins).

### C.3 Relation to the existing data

- `agent_email` is `AgentRecord.officialEmail`, lower-case (`normalizeEmail`). The agent's login (personal Gmail) maps to it through `identify()`, which returns `access.officialEmail`.
- `agent_type` and `location` come from `AgentRecord.agentType` and `AgentRecord.location`, already normalised by the sync (`Dighe (Pre Sales)` for Pre Sales).
- **Team membership** is computed per request from `loadAgents(activeCycleId)` (cached per `dataVersion`) using the same `isAgentOfTl()` logic. The team key is `normalize(tlOfficialEmail) || normalize(tlPersonalEmail) || 'loc:' + location`. For a TL caller, the team key is `normalize(access.officialEmail) || normalize(login)`. `isAgentOfTl` should move into a shared module (for example `server-scope.ts`) so routes and the roster use one copy. It is defined inside `server-routes.ts` today.
- Test agents (`isTest`) and excluded agents (`getExcludedEmails`) are left out of team size and counts. Their entries carry `is_test = true`.

### C.4 Retention

- `roster_entry`, `roster_swap`, `roster_limit` and `roster_audit` are kept **for good**. They are HR records and tiny: 70 agents × about 60 days off a year comes to well under 10k rows a year. The migration plan's 7-month purge does not apply. Add them to its "never purged" list.
- `roster_otp`: rows deleted 30 days after the swap closes (daily job).
- `email_outbox`: `payload` cleared after 90 days, keeping metadata. `app_notification`: deleted 90 days after being read.
- Backups: a weekly CSV export (Admin) and Neon point-in-time restore. Optionally, a v2 `Roster` tab in the sheet.

### C.5 Cycle boundary

Membership comes from the active cycle's agents. For the first 14 days of a new cycle, it also comes from the previous cycle's agents (for anyone not yet in the new cycle). Otherwise, on 1 Dec, agents with no December data yet could neither see nor keep their roster. The clean answer is Phase B's `agent` table (the Agents tab, independent of cycles); switch to it when it exists.

---

## D. API design

All routes live in a new `server-roster.ts`, registered from `createApiApp()` in `server-routes.ts` and reusing `authenticate`, `identify` and `HttpError`. Rebuild and commit `api/index.js` with each change (the CI bundle check). Every route is `Cache-Control: no-store` (already the default for `/api`). Every write needs `appConfig.roster.enabled`, and pilot teams only while `pilotTeams` is non-empty. Otherwise the answer is 404 `{"error":"Rostering is not switched on"}`.

### D.1 Endpoints

| Method and path | Who | Purpose |
|---|---|---|
| `GET /api/roster/me?from&to` | agent | Own entries in the window, week summaries (WOs used and allowed), per-day `{limit, used, left, locked}` for the team (numbers only), open swaps in and out, notifications |
| `POST /api/roster/entries` `{day, kind, reason?, requestId}` | agent (own); TL, manager, admin with `agentEmail` | Create a WO or PL. Response: the entry with status `approved` or `pending` |
| `POST /api/roster/entries/:id/cancel` `{requestId}` | agent (own, before the cut-off); staff in scope | Cancel |
| `POST /api/roster/entries/:id/decision` `{decision:'approve'|'reject', note?, override?}` | TL (team), manager, admin | Approve or reject a pending entry (approval re-checks the limit; `override:true` plus a note lets a TL exceed it) |
| `POST /api/roster/entries/:id/revoke` `{note}` | TL (team), manager, admin | Revoke an approved entry (for example after the limit was lowered) |
| `GET /api/roster/team?from&to&team?` | TL (own team; `team` ignored); manager/admin (any `team`, or `all`) | Grid: agents × days, limits, over-limit flags, pending count, agents with no WO this week |
| `PUT /api/roster/limits` `{team?, day?: 'YYYY-MM-DD'|null, maxInactive, note?}` | TL (own), manager, admin | Set the all-days or date limit. The response includes `overBooked` days and a weekly feasibility warning |
| `DELETE /api/roster/limits?team&day` | as above | Remove a date limit (falls back to the all-days limit) |
| `GET /api/roster/approvals` | TL, manager, admin | Pending entries and swaps in scope, oldest first; badge count |
| `GET /api/roster/swap-candidates?entryId` | agent | Eligible partners and their WO dates (same type, location and (v1) team, inside the window, before the cut-off, not already in a swap) |
| `POST /api/roster/swaps` `{myEntryId, partnerEntryId, requestId}` | agent | Request a swap |
| `POST /api/roster/swaps/:id/confirm` `{otp?}` | requester / partner | In-app consent, or OTP verification when OTP is on |
| `POST /api/roster/swaps/:id/resend-otp` | either party | Rate-limited resend |
| `POST /api/roster/swaps/:id/decline` | partner | Decline |
| `POST /api/roster/swaps/:id/cancel` | requester (before it is applied) | Cancel |
| `POST /api/roster/swaps/:id/decision` `{decision, note?}` | TL (both TLs in v2), manager, admin | Approve (and apply atomically) or reject |
| `GET /api/roster/audit?agent&team&from&to` | TL (team), manager, admin; agent sees own history via `/me` | History |
| `GET /api/roster/export?from&to&team?` | TL (team), manager, admin | CSV (existing CSV conventions) |
| `GET /api/notifications`, `POST /api/notifications/read` | everyone | In-app inbox and badge |
| `GET /api/admin/mail/outbox`, `POST /api/admin/mail/retry/:id`, `POST /api/admin/mail/test` | superAdmin | Mail status, retry, send a test mail to yourself |
| `POST /api/cron/roster` | Vercel Cron (`CRON_SECRET` header) | Daily: expire, remind, escalate, digest, outbox retry, clean up leavers and OTPs |

### D.2 Scoping rules (enforced on the server, one helper)

- **agent**: `agent_email` is always `identity.access.officialEmail`. Any `agentEmail` in the body is ignored for agents. The agent must exist in the membership list and not be excluded.
- **tl**: the target agent must pass `isAgentOfTl(agent, login, access)`. `team` is forced to the TL's own team key. Limits only for that key.
- **manager / superAdmin**: any team. Every action on someone else's behalf needs a `note` and is audited with `actor_role`.
- `reportViewer` (cohort-only users) and strangers: 403.
- Test-mode rules as elsewhere: demo agents are hidden from TL and Manager views when `testMode` is off.

### D.3 Validation (in a pure shared module `src/shared/roster.ts`, so the UI uses the same rules)

- `day` is a valid `YYYY-MM-DD` inside `[firstChangeableDay(role, now), lastWindowDay(now)]`, both computed in IST. Error: "You can only plan days from Thu 19 Nov to Sun 6 Dec."
- Cut-off by role. Error: "Changes for Thu 19 Nov closed at 18:00 yesterday. Ask your TL."
- `kind` is `WO` or `PL`. `reason` is at most 300 characters, stripped of control characters, and stored as text (HTML-escaped in mail).
- Weekly WO count (approved plus pending) of the agent in the ISO week of `day`: 0 means self-service and `approved`; 1 up to `maxWoPerWeek - 1` means `pending`, needs approval; at `maxWoPerWeek` the request is refused. Error: "You already have 2 weekly offs in the week of 16 Nov."
- One active entry per day (unique index). Error: "You already have a weekly off on Sat 21 Nov."
- Limit (D.4). Error: "Your team's limit for Sat 21 Nov is 2 and 2 are already off. Pick another day, or ask your TL."
- Churn limits (B #12). Error: "You have changed your weekly offs 3 times this week. Ask your TL."
- Booking-open time for the newest week (B #4). Error: "Week of 30 Nov opens on Mon 23 Nov at 10:00."

### D.4 Limit enforcement under concurrency

The Neon HTTP driver runs **non-interactive** transactions: `sql.transaction([...stmts])` sends all statements at once. So the "check and insert" must be **inside SQL**, serialised by a transaction-scoped advisory lock:

```sql
-- one HTTP round trip, one transaction, READ COMMITTED
SELECT pg_advisory_xact_lock(hashtextextended('roster:agentweek:' || $agent || ':' || $weekStart, 0));
SELECT pg_advisory_xact_lock(hashtextextended('roster:teamday:'  || $team  || ':' || $day, 0));
WITH cap AS (
  SELECT COALESCE(
    (SELECT max_inactive FROM roster_limit WHERE team_key = $team AND day = $day),
    (SELECT max_inactive FROM roster_limit WHERE team_key = $team AND day IS NULL),
    $defaultCap) AS n),
used AS (
  SELECT count(*) AS n FROM roster_entry
  WHERE day = $day AND status IN ('pending','approved') AND agent_email = ANY($memberEmails::text[]) AND NOT is_test),
week AS (
  SELECT count(*) AS n FROM roster_entry
  WHERE agent_email = $agent AND kind = 'WO' AND status IN ('pending','approved') AND day BETWEEN $weekStart AND $weekEnd),
ins AS (
  INSERT INTO roster_entry (agent_email, day, kind, status, needs_approval, team_key, agent_type, location, source,
                            reason, created_by, request_id, is_test)
  SELECT $agent, $day, $kind,
         CASE WHEN $kind = 'PL' OR (SELECT n FROM week) >= 1 THEN 'pending' ELSE 'approved' END,
         ($kind = 'PL' OR (SELECT n FROM week) >= 1), $team, $type, $loc, $source, $reason, $actor, $requestId, $isTest
  WHERE (SELECT n FROM used) < (SELECT n FROM cap)
    AND ($kind = 'PL' OR (SELECT n FROM week) < $maxWoPerWeek)
  ON CONFLICT DO NOTHING
  RETURNING *)
SELECT (SELECT n FROM cap) AS cap, (SELECT n FROM used) AS used, (SELECT n FROM week) AS week_wo,
       (SELECT row_to_json(ins) FROM ins) AS entry;
-- now() is the transaction start time, so this matches only a row inserted by THIS transaction (none on a retry)
INSERT INTO roster_audit (...) SELECT ... FROM roster_entry WHERE request_id = $requestId AND created_at = now();
```

- The second agent waits on the advisory lock until the first commits. Under READ COMMITTED, its `used` count is a fresh snapshot taken after it got the lock, so it sees the first booking. **Exactly `cap` bookings can succeed.**
- Locks are always taken in a fixed order (agent-week, then team-day; several days sorted by date), so there are no deadlocks. A swap locks both days and both agent-weeks, in sorted order.
- `ON CONFLICT DO NOTHING` covers both the per-day unique index (double booking) and `request_id` (a retry). The handler then reads by `request_id`. If the row exists and belongs to this caller, it returns the original answer: idempotent, the same 200 response. If not, it reports which rule failed (`used >= cap`, `week_wo >= max`, or "already booked").
- **Approve, TL on behalf, and swap apply** use the same pattern (lock, then a conditional `UPDATE ... WHERE (used excluding this entry) < cap`).
- **Lowering a limit** never fails. It returns `overBooked` and the UI shows it.
- `memberEmails` comes from the cached agent list. A membership change in the same second is harmless: the next action re-evaluates it.
- Tests: logic on PGlite (sequential). A **live race smoke test** `tests/roster-race-smoke.ts` (not in `run-all`, like `tests/pg-smoke.ts`) fires 10 parallel bookings at a limit of 2 against a **Neon branch** and expects exactly 2 to succeed.

### D.5 Errors

JSON `{error, code, details?}` with `400` (validation), `403` (scope), `404` (feature off, or not found in scope; the same message whether or not the item exists outside scope), `409` (`LIMIT_REACHED`, `WEEK_LIMIT`, `ALREADY_BOOKED`, `CUTOFF_PASSED`, `SWAP_STALE`, `OTP_INVALID`, `OTP_LOCKED`), `429` (rate limits) and `503` (`ROSTER_DB_UNAVAILABLE`). Messages are written for agents in plain English, as in the examples above.

---

## E. Mail

> **Correction from the owner (2026-11-18): `crmsales@thesleepcompany.in` sends through Netcore's mail server, not Outlook.** The Microsoft Graph route in E.1 and E.2 below therefore does not apply. Netcore Email API becomes the primary provider (see E.6); the rest of this section (templates, outbox, retries, `MAIL_MODE`, OTP, in-app fallback) is provider-independent and stays. The `MS_GRAPH_*` variables are replaced by `NETCORE_API_KEY` and `NETCORE_API_BASE`.

### E.1 Options compared

| Option | Works for this domain? | From `crmsales@` really | Deliverability (DMARC p=quarantine) | Setup | Cost | Verdict |
|---|---|---|---|---|---|---|
| Google Workspace SMTP relay / Gmail API with domain-wide delegation | **No**: the domain's mail is on Microsoft 365, not Google | - | - | - | - | Not possible |
| **Microsoft Graph `sendMail`** (app-only, client credentials), restricted to the `crmsales` mailbox | Yes | Yes. It is sent by the mailbox itself, appears in its Sent Items, and replies come back to it | M365 already signs with DKIM `selector1/2`, and SPF includes outlook. Passes with no DNS change | An Entra app registration, admin consent and an Exchange restriction (E.2). About 1 hour of the M365 admin's time | Included in M365 | **Recommended** |
| M365 SMTP AUTH (`smtp.office365.com:587`) | Technically | Yes | Passes | Needs SMTP AUTH enabled on the mailbox. Basic auth is being retired by Microsoft, and OAuth SMTP is more work than Graph | Included | Not recommended |
| SendGrid / Postmark / Resend | Yes | Address only (not in the mailbox's Sent Items) | Needs DKIM alignment. SendGrid domain authentication **already exists** (`s1._domainkey` points at SendGrid), so an existing company SendGrid account could send at once. A new provider would need new DKIM CNAMEs. **Do not add another SPF include**: the record is already near the 10-lookup limit | API key with "Mail Send" only; DNS only if it is a new provider | Free tiers suffice (about 100 mails/day) | **Fallback**, if IT will not grant Graph access |
| Netcore (already in SPF) | Probably | Address only | Depends on DKIM | Marketing-oriented | Paid | No |

### E.2 Owner / IT steps (Graph)

1. Confirm that `crmsales@thesleepcompany.in` is a user or shared mailbox in Exchange Online, and who owns it (Q4).
2. In Microsoft Entra admin center, under App registrations, create a new registration, "TSC Agent Dashboard Mailer", single tenant. Note the **tenant ID** and **client ID**.
3. API permissions: Microsoft Graph, **Application** permission `Mail.Send`, then **Grant admin consent**. (Alternatively, use Exchange "RBAC for Applications" instead of a tenant-wide grant; see step 5.)
4. Certificates & secrets: create a client secret (12 or 24 months) and put a renewal reminder in the calendar. A certificate is better if IT prefers it.
5. **Restrict the app to the one mailbox** (essential; otherwise it could send as anyone in the company): in Exchange Online PowerShell, either use RBAC for Applications (`New-ServicePrincipal`, `New-ManagementScope` limited to the crmsales mailbox, `New-ManagementRoleAssignment -Role "Application Mail.Send"`), or the older `New-ApplicationAccessPolicy -AccessRight RestrictAccess` on a mail-enabled security group that contains only crmsales. Verify with `Test-ServicePrincipalAuthorization` or `Test-ApplicationAccessPolicy`.
6. Optional: a transport rule or mailbox rule to keep the Sent Items tidy, and decide who reads replies sent to crmsales.
7. In Vercel (Production and Preview), set the variables below. The developer never needs to see the values: IT can type them straight into Vercel.
8. In the Admin tab, "Send test mail to me", then check that the message lands in the inbox (not junk) at a @thesleepcompany.in address and at a Gmail address.

**Environment variable names (new):** `MAIL_PROVIDER` (`graph` | `sendgrid`), `MAIL_FROM` (`crmsales@thesleepcompany.in`), `MS_GRAPH_TENANT_ID`, `MS_GRAPH_CLIENT_ID`, `MS_GRAPH_CLIENT_SECRET`, `MAIL_MODE` (`off` | `log` | `redirect` | `live`), `MAIL_REDIRECT_TO` (a test inbox for `redirect`), `ROSTER_OTP_SECRET` (HMAC key for OTPs), `CRON_SECRET` (Vercel Cron). Already exists: `APP_URL` (links in mails). Only with the SendGrid fallback: `SENDGRID_API_KEY`. Add them all to `.env.example` with no values, and to the readiness checks in `server-readiness.ts` (the names and whether they are set, never the values).

### E.3 Mail design

- **Templates (plain HTML plus a text part, IST times, names, no secrets):** `wo_confirmed` (agent; TL in the digest), `pl_requested` / `wo_extra_requested` (TL, per event), `entry_decided` (agent), `entry_revoked` (agent), `entry_expired` (agent and TL), `swap_requested` (partner), `swap_otp` (party), `swap_awaiting_tl` (TL), `swap_applied` / `swap_rejected` / `swap_failed` (both agents), `reminder_pending` (TL, 24 h), `escalation` (Managers, 48 h), `no_wo_yet` (agent, Thursday), `daily_digest` (TL, 18:00 IST: tomorrow's roster, today's new WOs, pending items, over-limit days).
- **Per event vs digest:** per event only when someone must act (approvals, swap consent, decisions on your own request). Everything informational goes into the TL's daily digest. That is about 5-15 mails a day for 70 agents, not hundreds.
- **Links:** always `APP_URL/?tab=roster&item=<id>`. No action on GET and no login token in the URL; the dashboard's Google sign-in does the authentication (B #7). The mail says "Open the dashboard to approve".
- **Recipients:** TL = `tlOfficialEmail`; agent = personal Gmail (A.2 #20); Managers = `appConfig.managers`. Recipients come only from roster data, never from request input, so the endpoint cannot be used to mail arbitrary addresses.
- **Anti-spam and abuse:** rate limits per actor (for example 20 roster mails a day per agent caused), a global circuit breaker (more than 300 mails a day switches to `suppressed` and alerts the Super Admin in the Admin tab), the `dedupe_key` unique index (no duplicate mails on retries), the reason text length-capped and escaped, a fixed `From`, `Reply-To: crmsales@`, and a footer "Automatic message from the Agent Dashboard. Do not reply with OTPs or personal data".
- **Test safety:** `MAIL_MODE=redirect` sends every mail to `MAIL_REDIRECT_TO` with the intended recipient in the subject line. Use it in Preview and during the pilot. `testMode` or `isTest` agents never mail real people.

### E.4 Delivery, outbox and failures

- Every mail is first written to `email_outbox` **in the same transaction** as the roster change (the transactional outbox), so a roster change never exists without its mail and a mail never goes out for a change that rolled back.
- After the commit, the request handler tries to send the new rows inline with a 4 s timeout. It awaits the send before responding, because a Vercel function may be frozen once the response is sent (`waitUntil` from `@vercel/functions` is the alternative). On success the row is `sent`. On failure it is `failed`, with `next_attempt_at` set by backoff (1 m, 5 m, 30 m, 2 h, 12 h); after 6 attempts it is `dead`.
- **Retries without a frequent cron:** Vercel Hobby crons run only daily. So (a) every roster API call drains up to 3 due outbox rows (1.5 s budget), (b) the daily cron drains the rest, and (c) optionally a free GitHub Actions schedule calls `/api/cron/roster` every 15 min with `CRON_SECRET` (the repo already has `.github/workflows/ci.yml`).
- **The in-app fallback is always there:** every mail also creates an `app_notification`. The Roster tab shows the badge and the inbox. Approvals queues are in-app, so a TL who gets no mail still sees the queue. When an OTP mail fails, the swap screen says "We could not send the code. Ask your TL to approve the swap without a code", and the TL (or a Manager) can mark consent with a note (audited).
- Admin tab: an outbox panel (queued, failed or dead counts, last error, retry button); `server-readiness.ts` shows mail-configured, last success and dead-letter count.

### E.6 Netcore Email API (replaces E.2)

Netcore is an email delivery service (an API and SMTP relay), not a mailbox: the app hands it a message and Netcore sends it with `crmsales@thesleepcompany.in` as the sender. What the owner or IT must confirm and provide:

1. **Which Netcore account and product send for crmsales?** Netcore sells an Email API (transactional) and a campaign / engagement product. The roster mails need the transactional Email API enabled on that account, and an **API key** created for it. The key goes straight into Vercel as `NETCORE_API_KEY`.
2. **Region / base URL.** Netcore documents `https://emailapi.netcorecloud.net/` for non-EU accounts and `https://apieu.netcorecloud.net/` for EU accounts. Put the right one in `NETCORE_API_BASE`, and confirm whether the account uses API v5 or v6 (the body shape differs slightly; follow what the account's own docs say).
3. **Sender and domain authentication.** `crmsales@thesleepcompany.in` must be an approved sender on that Netcore account, and the domain must be authenticated there (SPF already includes Netcore; confirm the Netcore DKIM CNAME records exist in DNS). The domain's DMARC policy is `quarantine`, so mail without proper DKIM or SPF alignment goes to junk.
4. **Where do replies go?** If crmsales has no monitored mailbox, set a `Reply-To` that someone reads, or send with a no-reply notice.
5. **Netcore limits and plan.** Ask the account owner for the daily sending limit, any IP allow-listing (Vercel has no fixed IP), and whether bounce and spam-complaint events can be sent to a webhook.

How the app uses it:
- One provider adapter, `server-mail.ts`: `fetch` POST to Netcore's send endpoint with the key in the `api_key` header and a JSON body of `from`, `personalizations` (recipient, subject), `content`, plus `tags` for reporting. Netcore's `priorityflag` is set to `1` (OTP/transactional) for approval and OTP mails.
- Everything else is as designed: the outbox, retries, `dedupe_key`, `MAIL_MODE` (`off` | `log` | `redirect` | `live`), rate limits and the in-app fallback.
- Optional later: a Netcore webhook into the app so bounces and complaints mark an address as undeliverable and show a warning to the TL.
- New environment variable names: `MAIL_PROVIDER=netcore`, `MAIL_FROM`, `NETCORE_API_KEY`, `NETCORE_API_BASE`, plus the existing `MAIL_MODE`, `MAIL_REDIRECT_TO`, `ROSTER_OTP_SECRET`, `CRON_SECRET`.
- P0 changes: instead of the Microsoft 365 setup, the owner gets the Netcore API key and confirms steps 1 to 5 above (about the same effort, usually less).

### E.5 OTP (only if `swapOtp` is on)

- 6 digits from `crypto.randomInt`, stored only as `HMAC-SHA256(ROSTER_OTP_SECRET, swapId|party|code)`, compared in constant time (as `sameSecret()` already does).
- Valid for 10 minutes. At most 5 wrong attempts per code, after which the swap is `failed` (`OTP_LOCKED`) and must be requested again. Resend: 60 s cooldown, at most 3 sends per party per swap, at most 10 OTP mails per agent per day.
- Each party gets their own code at their own address and types it into their own signed-in session. A code never has to be passed between people.
- The mail says: "Your code is 123456. It expires at 14:32 IST. Never share it, not even with your TL."

---

## F. The swap flow

### F.1 State machine

```
            request (A)                     A and B confirmed            TL approves (+ re-check passes)
 [none] ───────────────► awaiting_partner ─────────────────► awaiting_tl ─────────────────────────► applied
                              │   │                               │   │
              B declines ─────┘   └──── A cancels / expires       │   └── TL rejects ──► rejected
                ▼                          ▼                      │
            declined                 cancelled / expired          ├── A cancels / expires ──► cancelled / expired
                                                                  └── re-check fails at apply ──► failed (both told why)
```

- **request:** A picks their approved WO on X and B's approved WO on Y. Checks: eligibility (F.2); both entries `approved`, `kind = 'WO'`, not in another open swap; X and Y in the window and before the agent cut-off; X ≠ Y; v1: X and Y in the same ISO week and the same team; churn limits. A's request counts as A's consent (with OTP on, A must also verify their own code).
- **awaiting_partner:** B is notified (app plus mail). B confirms (in-app, or with OTP) or declines.
- **awaiting_tl:** the TL is notified (approvals queue plus mail). Cross-team (v2): both TLs must approve; the swap stays `awaiting_tl` until the second approval.
- **apply (on TL approval, one transaction):** lock both team-days and both agent-weeks in sorted order; re-read both entries (still `approved`, still owned by A and B, days unchanged); re-check eligibility (type and location unchanged), the cut-off, each agent's weekly WO count after the swap, and each affected team-day's limit (same team: net zero; cross-team: team A gets +1 on Y and -1 on X, and team B the opposite). Then set both old entries to `cancelled` (with `swap_id`), insert two new `approved` entries with `source = 'swap'`, set the swap to `applied`, and write the audit and outbox rows. If any check fails: `failed`, with a `fail_reason` that names the rule.
- **expiry:** `expires_at = min(agent cut-off of X, agent cut-off of Y, created_at + 72 h)`. The daily cron and every read mark overdue swaps `expired` and notify both agents (and the TL if it was waiting on them).
- **Side effects while open:** the WOs being swapped cannot be cancelled. Cancelling first requires cancelling the swap, which is enforced.

### F.2 Eligibility

`eligible(A, B) = A.agentType === B.agentType && normLoc(A.location) === normLoc(B.location)`, plus (v1) `teamKey(A) === teamKey(B)`, and both are active (not excluded), not test agents (unless both are), and both currently in the membership list.

- `normLoc` = trim, lower-case and collapse spaces. The sync already turns Pre Sales locations into `Dighe (Pre Sales)` (`server-import.ts`), so a Dighe Pre Sales caller (`PRE_SALES`, `dighe (pre sales)`) never matches a Dighe HO caller (`HO`, `dighe`): both type and location differ.
- Andheri Store vs Bangalore Store: same type, different location, so not eligible.
- Attributes are read from the **current** `AgentRecord` at request time and again at apply time. The snapshot on the entry is for audit only.

### F.3 Consent mode

- Default (recommended): **in-app confirmation** by B, plus A's own request, both from authenticated sessions, both audited with time and login.
- With `swapOtp = true`: each party verifies a mailed OTP before the swap moves on (E.5).

---

## G. UI

### G.1 Agent: a new **"Roster"** tab in `AgentView.tsx`

- It is a sixth button in the existing segmented control (`activeTab: 'home' | 'revenue' | 'calls' | 'breaks' | 'rawData' | 'roster'`), lazy-loaded like the others through `lazyView` (`RosterTab.tsx`), with a `CalendarDays` icon from lucide-react and a red **badge** with the number of actions waiting (incoming swap, OTP to enter).
- Shown only when `roster.enabled` and the agent's team is in the pilot. When staff open an agent in `AgentView`, it is read-only.
- **3-week view.** Desktop: 3 rows × 7 day cells (Mon to Sun). Phone: a vertical list of weeks, each week a 7-cell strip, with big tap targets (44 px or more). Each cell shows the date, a status chip (Working / WO / WO pending / PL pending / PL / swapped), team slots ("1 left", red at 0), and a lock icon past the cut-off. Today is outlined. Days outside the window are greyed.
- A week header shows "WO: 1 of 1 used", or "No WO yet: pick a day" in amber.
- **Tap a day:** a bottom sheet (phone) or popover (desktop) with "Take weekly off", "Request planned leave" (with an optional reason) and, on an approved WO, "Cancel" and "Swap with a colleague". Disabled actions explain why ("Team limit reached", "Changes closed at 18:00 yesterday").
- **Swap wizard:** (1) my WO date → (2) a list of eligible colleagues and their WO dates in the same week → (3) confirm → (4) status ("Waiting for Priya to accept", then "Waiting for TL"). With OTP on, a 6-digit input with a countdown and a resend button with its cooldown.
- **My requests:** a list of entries and swaps with status, decision note, and time (IST).
- **Inbox:** notifications (mirrors the mails).
- States: loading skeleton, empty ("No days planned yet"), error with retry, "Rostering is temporarily unavailable" (database down), and an optimistic update rolled back if the server says 409, with the server's message.

### G.2 TL: a new **"Roster"** tab in `StaffPortal.tsx`

- `StaffTab` gains `'roster'`, shown for `tl`, `manager` and `superAdmin`, with a badge of pending approvals.
- **Team grid:** rows = agents (name, type, location chips), columns = 21 days. Cells are coloured WO / PL / pending / swapped. The header row shows "off / limit" per day (amber at the limit, red over it). A footer shows agents with no WO per week. On a phone: a sticky name column with horizontal scroll, or a "day view" toggle (one day, list of who is off).
- **Limits editor:** an "All days" number input at the top, and clicking a day header to set or clear that day's limit (with a note). The feasibility warning (B #5) and the over-booked warning (A.2 #7) appear inline.
- **Approvals queue:** cards (agent, kind, date, team load that day "2/3 → 3/3", reason, age) with Approve and Reject (note required on reject); "Approve over limit" only with a reason. Swaps show both agents and both dates and the effect on each day.
- **Act on behalf:** from the grid cell menu (set WO, set PL, revoke, with a note).
- **History:** a filterable audit list and Export CSV (existing `ExportCsvButton`).

### G.3 Manager / Super Admin

- The same Roster tab with a team selector ("All teams" summary: per team per day off/limit, pending counts, teams with no limit set) and a location filter.
- Admin tab: roster settings (`appConfig.roster`: enabled, pilot teams, window, cut-offs, OTP switch, mail mode), the mail outbox panel, "Send test mail", and readiness lines.

### G.4 Notifications badge

- `GET /api/notifications?unreadOnly=1` is polled with the existing data-status cadence (about 60 s) only while the tab is visible, or piggybacked on the agent heartbeat response to save requests. The badge appears on the Roster tab button, and for staff also on the StaffPortal tab.

---

## H. Rollout, phases, testing, monitoring

### H.1 Phases

| Phase | Contents | Effort (dev days) | Exit check |
|---|---|---|---|
| **P0: decisions and setup** | Owner answers section I; IT sets up Graph (E.2); create the Neon branch `roster-dev`; agree the pilot team | 0.5 dev + owner/IT time | Answers to Q1-Q8; mail credentials in Vercel |
| **P1: WO/PL and limits, in-app only** | `Queryable` + PGlite; `db/migrations/010_roster.sql` + `scripts/migrate.ts`; `src/shared/roster.ts` (dates, IST, window, cut-off, week rules, eligibility: pure functions); `server-roster.ts` (me, entries, cancel, decision, revoke, team, limits, approvals, audit, export); move `isAgentOfTl` into a shared scope module; agent `RosterTab`; staff Roster tab (grid, limits, approvals); `appConfig.roster` flag + pilot teams; Admin settings card; tests | 5-6 | All tests green; the race smoke test on a Neon branch gives exactly `cap` successes; the pilot TL and 2 agents check it by hand |
| **P2: mail** | `email_outbox`, `app_notification`, Graph sender (`server-mail.ts`, no SDK needed: `fetch` for the token plus `/users/{from}/sendMail`), templates, inline send + drain + daily cron (`vercel.json` `crons`), digest, reminders, escalation, `MAIL_MODE`, Admin outbox panel, readiness checks | 3-4 | `redirect` mode for 2 days with real flows, then `live` for the pilot team |
| **P3: swaps** | `roster_swap`, `roster_otp`, candidates, request, confirm, decline, cancel, TL decision + atomic apply, expiry, wizard UI, optional OTP | 3-4 | Swap scenarios in the test suite; a pilot swap done by hand |
| **P4: hardening and roll-out to all teams** | Churn and fairness limits, booking-open time, feasibility warning, Manager all-teams view, CSV export polish, backups (weekly export), docs (`CHANGES.md` entry, a GUIDELINE section) | 2-3 | A week with all teams; no stuck pending items; outbox dead count 0 |
| **Later (v2)** | Cross-team swaps (two TL approvals), TL rosters approved by Managers, adherence report (roster vs Dialer), sheet `Roster` tab via Apps Script, sub-limits per type and location, half days, leave balances (only if this becomes the system of record) | - | - |

Total P1-P4: about **13-17 dev days**.

### H.2 Feature flag and migration

- Server: `appConfig.roster.enabled` (default false) plus `pilotTeams` (team keys). With `DATABASE_URL` missing, the routes answer 503, and the UI hides the tab or shows "unavailable".
- The migration is additive (new tables only), run once by the owner or developer: `npm run db:migrate` against the `roster-dev` branch, then production. Rollback: switch the flag off; the tables can stay (or `DROP` them in a new migration if the feature is abandoned).
- There are no existing data to migrate. If TLs keep a roster today (Excel or sheet), offer a one-off CSV import of the next 3 weeks (Q11).

### H.3 Testing

- **Unit (pure rules)**, `src/shared/roster.testcases.ts` run by `npm test` next to `incentive.testcases.ts`: IST "today" around midnight (also with the process in UTC and US time zones, as the existing tests do); window boundaries (Sunday of week+2; Wednesday today); cut-off D-1 17:59 vs 18:01; week start Monday; weekly WO count across a month and a cycle boundary; default limit `ceil(n/6)`; feasibility warning; eligibility (HO Dighe vs HO Dighe yes; HO Dighe vs Pre Sales `Dighe (Pre Sales)` no; Store Andheri vs Store Bangalore no; case and space differences in location yes); swap same-week rule.
- **API**, `tests/roster.test.ts` in the style of `tests/api.test.ts` (`check()` / `section()`, fake `test:<email>` tokens, sync fixtures from `mainRow()` to create agents and TLs), added to `tests/run-all.ts`, running on PGlite (migrations applied to a fresh instance per run):
  - Scope: agent books only for self (an `agentEmail` in the body is ignored); TL cannot read or set another team (403); TL cannot approve another team's entry; manager can do all; stranger and reportViewer get 403; excluded agent 403; test agents hidden when test mode is off.
  - Rules: 1st WO approved; 2nd WO pending; 3rd refused; PL pending; limit reached gives 409 `LIMIT_REACHED`; pending holds the slot; reject frees it; approve re-checks the limit (two pending entries for the last slot: the second approval gets 409 unless overridden); lowering the limit keeps entries and reports `overBooked`; cut-off by role; window edges; duplicate day 409; idempotent retry with the same `requestId` returns the same entry and creates no second row or mail.
  - Swaps: eligibility refusals; partner decline; TL reject; apply re-check failure (B's WO cancelled meanwhile gives `failed`); expiry; OTP wrong 5× gives a lock; resend cooldown; the hash, not the code, stored.
  - Mail: an outbox row per event with `MAIL_MODE=log`; dedupe on retry; a failure leaves the row `failed` and the roster change intact; in-app notification created.
  - Audit: one row per action with before and after.
- **Live smoke tests** (not in CI): `tests/roster-race-smoke.ts` (parallel bookings on a Neon branch), plus a Graph send to `MAIL_REDIRECT_TO`.
- Before each deploy: `npm run lint`, `npm test`, `npm run test:server`, `npm run build`, `npm run build:api`, and commit `api/index.js`.

### H.4 Monitoring

- Readiness (`server-readiness.ts`): roster database reachable, migrations applied, mail configured, last mail success, dead-letter count, pending items older than 48 h.
- `/api/monitor` (read-only, `MONITOR_KEY`): roster counts per day, over-limit days, stuck swaps, outbox status, so the existing scheduled monitor agent reports them.
- Structured `console.warn` lines for `LIMIT_REACHED`, lock waits over 1 s, and mail failures (visible in Vercel logs).

### H.5 What needs the owner's decision or action

- Answers to section I (Q1-Q8 before P1).
- IT/M365 admin: the Graph app registration, restriction to the crmsales mailbox, and the secrets in Vercel (E.2). If not possible: access to the existing SendGrid account (an API key with Mail Send only).
- Choosing the pilot team and TL.
- Running `npm run db:migrate` (or allowing the developer to run it) with the owner connection.
- Approving `vercel.json` cron changes, and optionally the GitHub Actions 15-minute schedule.

---

## I. Open questions for the owner (priority order, each with a recommended answer)

1. **Q1. Is there an HRMS, payroll tool or Ops sheet that already records WO/PL, and which one is the source of truth?** Recommended: the HRMS/payroll stays the truth for PL, and the dashboard holds the plan; WO is decided here.
2. **Q2. Does every first WO need TL approval, or is it confirmed at once (within the limit) and only notified?** Recommended: confirmed at once, with a daily digest to the TL, who can revoke it before the cut-off.
3. **Q3. What is PL, and does it need approval and a balance?** Recommended: Planned Leave, always TL-approved, no balance in the app in v1.
4. **Q4. Is `crmsales@thesleepcompany.in` an Exchange Online mailbox, who administers M365, and may an app send as it through Microsoft Graph?** Recommended: yes, Graph restricted to that one mailbox (E.2). Fallback: the existing SendGrid account.
5. **Q5. Do agents read their official @thesleepcompany.in mailbox, or only the personal Gmail they sign in with?** Recommended: mail agents at the personal Gmail, and TLs at the official address.
6. **Q6. Swap consent: OTP by mail as written, or in-app acceptance by both agents?** Recommended: in-app acceptance (both are signed in), with OTP as a switch.
7. **Q7. Swaps across different TLs, and across different weeks?** Recommended: v1 same TL and same week only; cross-TL in v2, needing both TLs.
8. **Q8. Is the limit per whole team, or per caller type and location inside a team?** Recommended: per team in v1; sub-limits in v2 if any TL has a mixed team.
9. **Q9. Cut-off times.** Recommended: agents until 18:00 the day before; TLs until midnight; Managers any time with a reason.
10. **Q10. Default limit before a TL sets one, and should a full limit be able to block someone's only WO of the week?** Recommended: `ceil(team size / 6)`, plus a warning to the TL when the week's limits cannot fit every agent's WO.
11. **Q11. Which pilot team first, and should their current roster be imported?** Recommended: one Dighe HO team; import the next 3 weeks from their sheet if one exists.
12. **Q12. Should time spent in the Roster tab count against the agents' 30-minute login windows?** Recommended: yes for v1 (actions take seconds); revisit if agents complain.
13. **Q13. Are TLs rostered too, and who approves a TL's WO/PL?** Recommended: not in v1; in v2, Managers approve.
14. **Q14. Should the roster ever affect incentives (`absentDays`) or attendance?** Recommended: no; v2 adds a read-only adherence report only.
15. **Q15. Fairness rules: open week+2 at a fixed time, and cap weekend WOs per agent?** Recommended: the fixed opening time (Monday 10:00 IST) yes; the weekend cap off by default, on if TLs report disputes.
16. **Q16. Is the Vercel project on Hobby (daily cron only), and may a GitHub Actions schedule call a cron endpoint every 15 minutes?** Recommended: yes, for timely mail retries and expiries.
