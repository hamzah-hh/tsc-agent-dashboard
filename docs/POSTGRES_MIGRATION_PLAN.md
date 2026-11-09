# Firestore to Postgres (Neon) migration plan

Status: plan, nothing implemented. Written 2026-10-30 (Friday). Owner deadline: Monday 2026-11-02.

## 0. Summary and the one key decision

All server data access already goes through a small Firestore-like facade (`server-db.ts`): `collection / doc / get / set / where / orderBy / limit / batch`. Under it is a 3-method `Backend` contract (`getDoc`, `listDocs`, `commit`) with two implementations (Firestore REST, local). The browser uses Firebase only for Auth (`src/shared/firebase-client.ts` creates a Firestore client but no screen reads data with it; everything goes through `/api/*`).

**Recommendation: two layers, in this order.**

1. **Bridge, by Saturday night.** Add a third backend, `PgDocBackend`, that stores every existing document as one `jsonb` row in a `doc_store` table (`DB_MODE=postgres`). No route, sync or screen changes. This alone ends the quota problem, because Postgres does not charge per read. All 297 server checks run unchanged against it (on PGlite).
2. **Relational model, from Sunday on.** Add typed, month-partitioned tables. The sync writes to them as well as to the bridge. Read paths then move to them page by page behind flags. Retention, CSV export and purge come after that. The bridge's agent-data documents are retired last.

Why not go straight to the relational model by Monday: `server-import.ts` and `server-routes.ts` (about 3,200 lines) build and read whole agent documents. Rewriting every read path in 3 days without a safety net would be the riskiest way to fix a problem that the bridge fixes in one day. The Google Sheet is the source of truth for nearly all data, so a fresh sync rebuilds everything. That makes every step cheap to roll back.

What can realistically be finished by Monday: the bridge is live in production and Firestore is off the critical path; the relational schema is deployed; the sync dual-writes; the first two or three pages read from the relational tables in shadow or live mode. Not by Monday, but well before the first purge is due (see §4.6): retention, export and purge, the backfill, per-tab sync in Apps Script, and the remaining pages.

---

## 1. Inventory: every Firestore path the code touches

Sizes are estimates from the code: chunk sizes and comments; there are about 70 agents and one active cycle, `diwali-2026` (2026-10-01 to 2026-11-30). "Bridge" = `doc_store` row(s) in phase A. "Target" = the relational destination.

| # | Path | Shape | Size | Writes | Reads | Used by | Target |
|---|------|-------|------|--------|-------|---------|--------|
| 1 | `config/app` | `AppConfig` (superAdmins, managers, activeCycleId, tierMap, locations, testMode, aiEnabled, aiTone, googleSpreadsheetUrl, loginTracker, dataVersion, syncKey?) | 1 doc, <5 KB | every sync (`dataVersion`), admin config, login-tracker config | `ensureSeedData` on almost every request (60 s cache per instance) | all routes | `app_config` (jsonb, 1 row). superAdmins/managers move to `app_user` in P3 |
| 2 | `cycles/{cycleId}` | `Cycle` (name, dates, status, workingDaysPerWeek, plans HO/STORE/PRE_SALES) | 1-2 docs | seed only | `ensureSeedData` | incentive calc | `cycle` |
| 3 | `cycles/{c}/agents/{officialEmail}` | `AgentRecord`: profile, `totals`, `daily[]` (one entry per day), `quality`, `result` (IncentiveResult), `absentDays`, `aiSuggestions`, isTest | ~70 docs, 10-30 KB each | sync (changed docs only), AI text (`aiSuggestions` merge), clear-test | `loadAgents` reads all 70 (cache keyed on dataVersion, 30 min max); identify() fallback | agent-data, allowed-agents, team-agents, leaderboards, team-summary, dod-data, raw-data, team-revenue, readiness, monitor, AI | `agent` (roster) + `agent_daily` (partitioned) + `cycle_agent_result` |
| 4 | `cycles/{c}/leaderboards/{location}` | `{location, updatedAt, rows: LeaderboardRow[]}` | 4 docs | every sync, config change, clear-test | `/api/leaderboard` | TL / Manager leaderboards | computed on read from `cycle_agent_result` (no table) |
| 5 | `cycles/{c}/teamRevenue/{loc}` | `TeamRevenueDoc` (category split + daily[]) | 3 docs (Dighe, Andheri, Bangalore) | every sync | `/api/team-revenue` (falls back to computing from agents) | team revenue view | computed on read from `raw_order` + `agent_daily` |
| 6 | `cycles/{c}/data/excludedAgents` | `{list:[{agentEmail, reason, excludedSince, active}]}` | 1 doc | sync (clean sheet: Agents.Status) | many routes (120 s cache), raw sync | scoping | `excluded_agent` |
| 7 | `cycles/{c}/data/rawRecords` + `/chunks/orders-N`, `/chunks/visits-N` | head: counts, chunk hashes, `locationSummaries`; chunks: 1,000 `RawOrderRecord` / `RawVisitRecord` each (~0.4 MB) | 1 head + ~10-40 chunks | sync (changed chunks only, hash-compared) | raw-data, dod-data, location-revenue, monitor: **all chunks** per 30 s cache miss | Raw Data, Day-on-Day, Location Revenue | `raw_order`, `raw_visit` (partitioned by month); locationSummaries computed |
| 8 | `cycles/{c}/data/rawRecordsStatus` | `RawSyncStatus` | 1 doc | each raw save | raw views | error display | `sheet_tab_state` |
| 9 | `cycles/{c}/data/teamOps` + `/chunks/breaks-N` | head: targets[], counts; chunks: 1,000 `BreakDay` | 1 + 1-3 docs | sync | `/api/team-summary`, monitor | Overall Team Summary | `raw_break_day` (partitioned), `sheet_target` |
| 10 | `access/{loginEmail}` | `AccessRecord` (role agent/tl, officialEmail, name, location, isTest) | ~80-90 docs | sync (only changed fields) | identify() per user (120 s cache); sync reads all; clear-test | auth / scoping | `app_user` |
| 11 | `syncLogs/{auto}` | `SyncLogRecord` + AI counts | 1 per sync, grows forever | each sync, clear-test deletes test ones | `orderBy time desc limit 10/30` | data-status bar, Admin, readiness, monitor | `sync_run` (keep 90 days) |
| 12 | `loginActivity/{email}_{YYYY-MM-DD}` | `AgentDailyLoginActivity` | ~70 a day, ~2,100 a month | heartbeat persist every 2 min per active agent, admin reset | heartbeat (3 min cache), admin `where date ==` | login time limiter | `login_activity` (partitioned, retained) |
| 13 | `privateReports/businessOverview` | `{history[], live[]}` of `BusinessOverviewRow` | 1 doc | sync, partial sync | team-summary | Business Overview | `business_overview_month` (forever) |
| 14 | `privateReports/cohort`, `privateReports/cohortV2` + `/chunks/rows-N` | head (hash, count) + 2,000 `CohortRow` per chunk | 2 heads + few chunks | sync (skipped if hash same) | cohort-report(-v2) | Anirban_Ref, Anirban_Cohort_Reportv2 | `cohort_row` (forever) |
| 15 | `privateReports/companyDod` | `{rows: CompanyDay[]}` | 1 doc | sync | cohort-report | Company_DOD | `company_dod_day` (forever) |
| 16 | `privateReports/diwali` | `{rows: DiwaliDay[]}` | 1 doc | sync | cohort-report | Diwali_Projection | `diwali_projection_day` (forever) |
| 17 | `health/ping` | `{time}` | 1 doc | `/api/health` (10 s cache) | same | uptime | `SELECT 1` plus an upsert into `health_ping` |
| 18 | `auditLog/*` | in `firestore.rules` only, never written by code | 0 | - | - | - | `audit_log` (new, forever) |

Also: `firestore.rules` gives the browser read rules for several of these paths. They are unused, because the browser reads nothing. At retirement (P4) set the rules to deny everything and drop the `getFirestore` import from `firebase-client.ts`.

Where the quota goes today: the 70-document `loadAgents` on every cold instance or dataVersion change; reading every raw chunk on each raw-view cache miss; heartbeats; whole-collection reads in each sync (`agents`, `access`). Postgres turns all of these into a few queries with no per-row cost.

---

## 2. Schema (concrete DDL)

Conventions: one schema, `public`. Dates are `date` in IST calendar days (the sheet's days, as the code already parses them). Money is `numeric(14,2)`. Emails are stored lower-case (`normalizeEmail`). Every typed table has `extra jsonb` for sheet columns we do not model yet, so a new sheet column never breaks a sync.

### 2.1 Migrations approach
- Plain numbered SQL files in `db/migrations/NNN_name.sql`, plus a 60-line runner `scripts/migrate.ts` that applies each file in its own transaction and records it in `schema_migrations`. No ORM. Queries are hand-written SQL in a `server-pg/` repository layer.
- Migrations run from the owner's or developer's machine with the Neon **owner** role (`npm run db:migrate`), never at request time. The app connects with a restricted role, `app_rw` (see §7).
- Forward-only. A rollback is a new migration. Breaking changes follow expand, then migrate, then contract.

### 2.2 Phase A: the bridge (`001_doc_store.sql`)
```sql
CREATE TABLE schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

CREATE TABLE doc_store (
  path       text PRIMARY KEY,                 -- 'cycles/diwali-2026/agents/a@tsc.in'
  parent     text NOT NULL,                    -- 'cycles/diwali-2026/agents'
  id         text NOT NULL,                    -- 'a@tsc.in'
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_store_parent_idx ON doc_store (parent);
CREATE INDEX doc_store_synclog_time_idx ON doc_store (parent, (data->>'time') DESC) WHERE parent = 'syncLogs';
CREATE INDEX doc_store_login_date_idx  ON doc_store (parent, (data->>'date'))      WHERE parent = 'loginActivity';
```
`PgDocBackend` mapping:
- `getDoc(p)` becomes `SELECT data WHERE path=$1`.
- `listDocs(col, {where, orderBy, limit})` becomes `WHERE parent=$1 AND data->$f = to_jsonb($v) ... ORDER BY data->$f ... LIMIT`. ISO time strings sort correctly as text.
- `commit(writes)` runs as **one transaction**. `set` becomes `INSERT ... ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data`; `set merge` becomes `data = doc_store.data || EXCLUDED.data` (top-level merge, the same as the REST `updateMask` and `LocalBackend`); `delete` becomes `DELETE WHERE path=$1`. Undefined values are stripped first, as `toFirestoreValue` does.

`kind` becomes `'postgres'`. Readiness must treat `postgres` as healthy (today only `firestore` passes).

### 2.3 Phase B: relational tables (`002_core.sql`, `003_partitioned.sql`, `004_reports.sql`, `005_ops.sql`)

```sql
-- ---------- reference / identity (kept forever) ----------
CREATE TABLE app_config (
  id text PRIMARY KEY DEFAULT 'app' CHECK (id = 'app'),
  data jsonb NOT NULL,                         -- AppConfig as today, plus pgReads flags (§6)
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_user (                         -- was access/{email}; later also superAdmins/managers
  login_email    text PRIMARY KEY,
  role           text NOT NULL CHECK (role IN ('superAdmin','manager','tl','agent')),
  official_email text,
  name           text,
  location       text,
  is_test        boolean NOT NULL DEFAULT false,
  source         text NOT NULL DEFAULT 'sheet' CHECK (source IN ('sheet','admin')),
  attrs          jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX app_user_official_idx ON app_user (official_email);

CREATE TABLE cycle (
  id                    text PRIMARY KEY,       -- 'diwali-2026'
  name                  text NOT NULL,
  start_date            date NOT NULL,
  end_date              date NOT NULL,
  status                text NOT NULL CHECK (status IN ('active','closed')),
  working_days_per_week int  NOT NULL DEFAULT 6,
  plans                 jsonb NOT NULL,         -- HO / STORE / PRE_SALES plans, as today
  closed_at             timestamptz,
  CHECK (end_date >= start_date)
);

CREATE TABLE agent (                            -- roster from the Agents tab; never purged (small)
  official_email    text PRIMARY KEY,
  name              text NOT NULL,
  personal_email    text,
  location          text NOT NULL,
  agent_type        text NOT NULL CHECK (agent_type IN ('HO','STORE','PRE_SALES')),
  tier_raw          text,
  tl_official_email text,
  tl_personal_email text,
  status            text NOT NULL DEFAULT 'Active',
  is_test           boolean NOT NULL DEFAULT false,
  first_seen        date,
  last_seen         date,
  extra             jsonb NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_personal_uq ON agent (personal_email) WHERE personal_email IS NOT NULL;
CREATE INDEX agent_tl_official_idx ON agent (tl_official_email);
CREATE INDEX agent_tl_personal_idx ON agent (tl_personal_email);

CREATE TABLE excluded_agent (
  cycle_id text REFERENCES cycle(id), agent_email text, reason text, excluded_since text,
  active boolean NOT NULL, PRIMARY KEY (cycle_id, agent_email)
);

-- ---------- per-cycle results (kept forever: this is what keeps incentives after a purge) ----------
CREATE TABLE cycle_agent_result (
  cycle_id        text NOT NULL REFERENCES cycle(id),
  agent_email     text NOT NULL REFERENCES agent(official_email),
  agent_type      text NOT NULL,
  location        text NOT NULL,                -- as of the cycle (people move teams)
  tl_official_email text, tl_personal_email text,
  totals          jsonb NOT NULL,               -- AgentTotals
  quality         jsonb NOT NULL,               -- QualitySummary (Quality tab, per cycle)
  result          jsonb NOT NULL,               -- IncentiveResult, unchanged shape
  total_incentive numeric(14,2) GENERATED ALWAYS AS ((result->>'total')::numeric) STORED,
  achievement_pct numeric GENERATED ALWAYS AS ((result->>'achievementPct')::numeric) STORED,
  class_name      text    GENERATED ALWAYS AS (result->>'className') STORED,
  absent_days     numeric,
  last_data_date  date,
  ai_suggestions  jsonb,
  is_test         boolean NOT NULL DEFAULT false,
  frozen          boolean NOT NULL DEFAULT false,   -- true once the cycle is closed: never recomputed
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cycle_id, agent_email)
);
CREATE INDEX car_cycle_location_idx ON cycle_agent_result (cycle_id, location);

CREATE TABLE sheet_quality (                   -- Quality tab: one row per agent per cycle (small, forever)
  cycle_id text REFERENCES cycle(id), agent_email text, total_audits int, average_score numeric,
  extra jsonb NOT NULL DEFAULT '{}', PRIMARY KEY (cycle_id, agent_email)
);
CREATE TABLE sheet_target (                    -- Targets tab
  cycle_id text REFERENCES cycle(id), manager_email text, sales numeric(14,2), target numeric(14,2),
  PRIMARY KEY (cycle_id, manager_email)
);

-- ---------- permanent monthly summary ----------
CREATE TABLE agent_month_summary (
  agent_email        text NOT NULL REFERENCES agent(official_email),
  month              date NOT NULL CHECK (extract(day FROM month) = 1),
  agent_type         text NOT NULL, location text NOT NULL,
  revenue            numeric(14,2) NOT NULL DEFAULT 0,
  orders             int NOT NULL DEFAULT 0,
  active_days        numeric(5,1) NOT NULL DEFAULT 0,
  unique_connects    int NOT NULL DEFAULT 0,
  avg_unique_connects numeric(8,2),             -- per worked day
  talk_seconds       bigint NOT NULL DEFAULT 0,
  avg_talk_seconds   numeric(10,2),
  visits_attributed  int NOT NULL DEFAULT 0,
  calls              int, avg_tt_per_call numeric(10,2),     -- Pre Sales
  quality_audits     int, quality_score numeric(6,4),
  incentive_cycle_id text REFERENCES cycle(id), -- the cycle that ENDS in this month, if any
  incentive_total    numeric(14,2),             -- that cycle's total (not pro-rated)
  finalized          boolean NOT NULL DEFAULT false,  -- set before the month's daily rows are purged
  extra              jsonb NOT NULL DEFAULT '{}',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_email, month)
);
```

Partitioned, agent-related, high-volume tables (`003_partitioned.sql`). Every one is `PARTITION BY RANGE (day)` with one partition per calendar month. The partition key is part of every primary key, as Postgres requires.
```sql
CREATE TABLE raw_order (                        -- Orders tab (and old Raw_Revenue)
  day            date NOT NULL,                 -- Credit_Date, or the order date when blank
  order_id       text NOT NULL,
  agent_email    text NOT NULL,
  order_date     date, order_time timestamp,
  order_value    numeric(14,2) NOT NULL,
  phone          text, category text, talk_time_cohort text, agent_category text,
  channel        text, location text, original_phone_or_marketplace text,
  considered_for_overall boolean NOT NULL DEFAULT true,
  considered_for_agent   boolean NOT NULL DEFAULT true,
  sync_run_id    bigint, extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, order_id, agent_email)       -- same order under 2 agents counts for both (rule kept)
) PARTITION BY RANGE (day);
CREATE INDEX ON raw_order (agent_email, day);

CREATE TABLE raw_visit (                        -- Visits tab (and old Raw_Visit)
  day date NOT NULL, visit_id text NOT NULL, agent_email text NOT NULL,
  visit_at timestamp, booking_date date, phone text, location text,
  talk_time_seconds int, visit_source text, interested_sub_status text, attributed_visit int,
  sync_run_id bigint, extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, visit_id, agent_email)
) PARTITION BY RANGE (day);
CREATE INDEX ON raw_visit (agent_email, day);

CREATE TABLE raw_dialer_day (day date, agent_email text, day_type numeric(2,1), unique_connects int,
  talk_seconds int, sync_run_id bigint, extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, agent_email)) PARTITION BY RANGE (day);
CREATE TABLE raw_presales_day (day date, agent_email text, calls int, tt_per_call_sec numeric(10,2),
  sync_run_id bigint, extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, agent_email)) PARTITION BY RANGE (day);
CREATE TABLE raw_break_day (day date, agent_email text, day_type numeric(2,1), bio int, first_break int,
  lunch int, last_break int, total int, acw int, idle int, staffed int, idle_acw int,
  sync_run_id bigint, extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, agent_email)) PARTITION BY RANGE (day);

CREATE TABLE agent_daily (                      -- derived: today's AgentDailyEntry, one row per agent-day
  day date NOT NULL, agent_email text NOT NULL,
  sales numeric(14,2) NOT NULL DEFAULT 0, orders int NOT NULL DEFAULT 0,
  connects int NOT NULL DEFAULT 0, talk_seconds int NOT NULL DEFAULT 0,
  visits_booked int NOT NULL DEFAULT 0, visits_attributed int NOT NULL DEFAULT 0,
  day_worked numeric(2,1) NOT NULL DEFAULT 0,   -- AgentDailyEntry.day (1 / 0.5 / 0)
  calls int, avg_talk_sec numeric(10,2),
  extra jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (day, agent_email)
) PARTITION BY RANGE (day);
CREATE INDEX ON agent_daily (agent_email, day);

CREATE TABLE login_activity (
  day date NOT NULL, agent_email text NOT NULL,
  am_seconds int NOT NULL DEFAULT 0, pm_seconds int NOT NULL DEFAULT 0,
  last_heartbeat_ms bigint, last_window text, reset_by_admin_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, agent_email)
) PARTITION BY RANGE (day);

-- partition helper: called by migrations, by every sync (for the months in the payload) and by the cron
CREATE OR REPLACE FUNCTION ensure_month_partitions(p_month date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE t text; m date := date_trunc('month', p_month)::date; s text := to_char(m, 'YYYY_MM');
BEGIN
  FOREACH t IN ARRAY ARRAY['raw_order','raw_visit','raw_dialer_day','raw_presales_day',
                           'raw_break_day','agent_daily','login_activity'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   t || '_' || s, t, m, (m + interval '1 month')::date);
  END LOOP;
END $$;
SELECT ensure_month_partitions(d::date) FROM generate_series('2026-04-01'::date, '2027-03-01', '1 month') d;
```
There is no DEFAULT partition, so detach/drop stays instant and stray dates are caught. The sync calls `ensure_month_partitions` for each month it is about to write. A row dated more than 7 months back or more than 40 days ahead is rejected with a sync warning.

Reports and ops (`004_reports.sql`, `005_ops.sql`), kept forever unless stated:
```sql
CREATE TABLE business_overview_month (month date, tier text, source text CHECK (source IN ('history','live')),
  outbound numeric, avg_outbound numeric, connected numeric, avg_connected numeric, talk_sec numeric,
  avg_talk_sec numeric, revenue numeric(14,2), avg_revenue numeric, team_size numeric, aov numeric,
  quality numeric, quality_pre_sales numeric, extra jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (month, tier, source));
CREATE TABLE cohort_row (report text CHECK (report IN ('v1','v2')), day date, category text, cohort text,
  label text, day_number int, orders numeric, sales numeric(14,2), PRIMARY KEY (report, day, category, cohort));
CREATE TABLE company_dod_day (day date PRIMARY KEY, orders numeric, sales numeric(14,2),
  retail numeric(14,2), marketplace numeric(14,2), website numeric(14,2));
CREATE TABLE diwali_projection_day (day date PRIMARY KEY, dow text, week_flag text, sale_pct numeric,
  projection numeric(14,2), actual numeric(14,2), attributed numeric(14,2), three_min numeric(14,2));

CREATE TABLE sync_run (                         -- was syncLogs; keep 90 days (cron deletes older)
  id bigserial PRIMARY KEY, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  source text NOT NULL, tabs text[] NOT NULL DEFAULT '{}', result text NOT NULL,
  rows int, agents int, last_data_date date, warnings jsonb NOT NULL DEFAULT '[]', error text,
  ai jsonb, timings jsonb, checksums jsonb);    -- checksums: sheet vs stored, see §5.3
CREATE INDEX sync_run_started_idx ON sync_run (started_at DESC);

CREATE TABLE sheet_tab_state (                  -- per-tab sync bookkeeping (was rawRecordsStatus + hashes)
  tab text PRIMARY KEY, last_ok_at timestamptz, last_attempt_at timestamptz, ok boolean,
  row_count int, content_hash text, covers_from date, covers_to date, last_sync_run_id bigint, error text);

CREATE TABLE month_export (                     -- the purge gate (§4)
  month date PRIMARY KEY, status text NOT NULL DEFAULT 'due'
    CHECK (status IN ('due','downloaded','confirmed','purged')),
  files jsonb NOT NULL DEFAULT '[]',            -- [{table, rows, sha256, downloadedAt, by}]
  confirmed_by text, confirmed_at timestamptz, purged_by text, purged_at timestamptz,
  reminded_at timestamptz);

CREATE TABLE audit_log (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(),
  actor_email text NOT NULL, action text NOT NULL, target text, details jsonb NOT NULL DEFAULT '{}');

CREATE TABLE health_ping (id int PRIMARY KEY DEFAULT 1, at timestamptz NOT NULL);
```

### 2.4 Extension point for the Sales Agent Portal
Features such as announcements, training, leave requests and call notes are not defined yet. So: **one generic table now, and a dedicated table only once a feature's fields settle.**
```sql
CREATE TABLE portal_item (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,                    -- 'announcement' | 'training' | 'leave_request' | 'call_note' | ...
  agent_email text REFERENCES agent(official_email),   -- subject agent (null = not about one agent)
  author_email text NOT NULL,
  audience    jsonb NOT NULL DEFAULT '{"scope":"all"}', -- {scope:'all'|'location'|'team'|'agent', value}
  status      text NOT NULL DEFAULT 'open',
  title       text, body text,
  starts_at   timestamptz, ends_at timestamptz,
  data        jsonb NOT NULL DEFAULT '{}',      -- kind-specific fields, validated in TS per kind
  created_at  timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_item_kind_idx  ON portal_item (kind, created_at DESC);
CREATE INDEX portal_item_agent_idx ON portal_item (agent_email, kind);
```
Rules: each `kind` has a TypeScript validator and a scope rule in the same repository layer that scopes agent data (§7). When a kind becomes heavily used or relational (leave balances, for example), a migration promotes it to its own table. Retention: a `kind` that holds agent activity (call notes) follows the 7-month rule through the cron; announcements and training are kept. `agent.extra` and `app_user.attrs` hold ad-hoc per-person settings.

---

## 3. How the sync maps to Postgres

### 3.1 Phase A (bridge)
No change: every `batch.commit()` becomes one Postgres transaction. This is stronger than today, because the 400-write chunking (`MAX_WRITES_PER_COMMIT`) no longer splits a save. The hash-skipping of unchanged chunks can stay; it is harmless.

### 3.2 Phase B (relational dual-write, then relational-only)
`processCleanSheetImport` is split into three steps:

1. **Store tabs.** Each tab that came in the payload is parsed into typed rows (the parsing half of `buildFromCleanSheet`, `normalizeRawOrders` / `normalizeRawVisits`, `parseCohortRows`, etc.) and written to its own table **inside one transaction per tab**:
   - Date tabs (Orders, Visits, Dialer, PreSales, Breaks): `DELETE FROM t WHERE day BETWEEN min(day) AND max(day) of the payload`, then a bulk insert. **Rows outside the payload's date span are kept.** This is what lets the database keep history after the sheet drops old months.
   - Agents: upsert into `agent`. A person who is missing from the tab is not deleted. Status other than Active goes to `excluded_agent`.
   - Quality and Targets: replace for the active cycle. Report tabs: replace the whole table (cohort by `report`).
   - Bulk insert uses one statement per table: `INSERT INTO raw_order SELECT * FROM jsonb_populate_recordset(NULL::raw_order, $1::jsonb)`. 20k rows is about 1 s; no 400-row batching.
   - Then `sheet_tab_state` is updated (row_count, content_hash). **An identical hash skips the tab entirely**, which replaces the chunk-hash trick.
2. **Recompute** (only when a core tab changed). This loads the cycle window from the tables (`agent`, raw_* for `[cycle.start, cycle.end]`, `sheet_quality`) and runs the *existing* build rules (the "build" half of `buildFromCleanSheet`, then `aggregateAgent`, `calculateFromMetrics`, `calculatePreSales`). It then writes `agent_daily` (delete and insert for the window), `cycle_agent_result` (upsert; `frozen` rows skipped) and `agent_month_summary` (upsert for the months touched, one `INSERT ... SELECT ... GROUP BY` from `agent_daily`), plus `app_user` rows (only changed ones). All payout rules stay in TypeScript, unchanged.
3. **AI text.** As today, after the data is saved, within the time budget. It writes `cycle_agent_result.ai_suggestions`.

Leaderboards, team revenue and location summaries are no longer stored. They are computed on read from `cycle_agent_result` and `raw_order`, using the existing `buildLocationRows` / `buildTeamRevenue` / `buildLocationSummaries` functions, with a 30-60 s per-instance cache. For 70 agents this is milliseconds.

### 3.3 Per-sheet syncing (owner request)
Raw tabs live in their own tables and the recompute reads from the database, not from the payload. So **each core tab can be synced alone**. Apps Script: split `SYNC_GROUPS_[0]` into one group per tab (Agents, Orders, Visits, Dialer, PreSales, Quality, Breaks, Targets). Each request sends `{format:'clean-v1', tabs:[...]}` with only those keys. The server stores them and recomputes once. The "Sync now" daily trigger stays a full sync, but a large tab (Orders) can be sent alone, keeping each request well under Vercel's **4.5 MB request-body limit** and 60 s. Server-side support comes first; the old "core must go together" rule is kept for Firestore mode only.

### 3.4 Old MainSheet layout (`processImport` with mainRows)
This stays supported in bridge mode. In relational mode it maps MainSheet rows to `raw_dialer_day`, `raw_presales_day` and a synthetic `agent_daily`. Recommendation: drop it after P2 if the clean layout is the only one in use (owner to confirm).

---

## 4. Retention, export gate and monthly summary

### 4.1 Rule
Keep the **current calendar month plus the previous 6** of agent activity: `raw_order`, `raw_visit`, `raw_dialer_day`, `raw_presales_day`, `raw_break_day`, `agent_daily`, `login_activity`, and `portal_item` kinds that hold agent activity. The oldest month is `date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') - interval '6 months'`. A month older than that is **purge-eligible**.

The following are never purged: `agent`, `cycle`, `cycle_agent_result`, `agent_month_summary`, `sheet_quality`, `sheet_target`, the reports tables, `app_config`, `app_user`, `audit_log`, `month_export`. `sync_run` keeps 90 days, deleted by the cron (logs only; nothing depends on them).

### 4.2 Cycles that span months (for example a 2-month Diwali cycle)
- `cycle_agent_result` holds each agent's totals, quality and full `IncentiveResult` per cycle, permanently. Past incentives never depend on daily rows.
- **Purge guard:** a month cannot be purged while any `cycle` overlapping it is `active`, or while any of its `cycle_agent_result` rows is not `frozen`. Closing a cycle (Admin action, or automatic 15 days after `end_date`) runs one final recompute and sets `frozen = true`.
- After a purge, the agent view for that old cycle shows the frozen totals and result, plus a note: "daily detail removed after 7 months; CSV kept by admin". The day-on-day table shows only the months still present.

### 4.3 Monthly summary roll-up
`agent_month_summary` is upserted by every recompute for the months it touched, so it is always current. `incentive_total` is filled from the cycle that **ends** in that month (no pro-rating, so a 2-month cycle's incentive appears once, in its final month, and `incentive_cycle_id` says which cycle). Before a purge, the purge function recomputes the month's summary from `agent_daily` one last time and sets `finalized = true`.

### 4.4 Admin flow (Admin tab, then "Data retention", superAdmin only)
1. The page lists the retained months with row counts per table, and flags purge-eligible months as **"Export due"**.
2. **Download**: one button per table: `GET /api/admin/retention/2026-05/export?table=raw_order`. This streams CSV (the existing shared CSV helper on the client; server-side `COPY (SELECT ...) TO STDOUT`-style streaming, or a keyset-paged `SELECT`). A "Download all" button runs them in sequence. Each download records `{table, rows, sha256, downloadedAt, by}` in `month_export.files` and sets status `downloaded` once every table is present.
3. **Confirm**: the admin ticks "I have saved these 8 files on my device", types the month (`2026-05`) and presses Confirm. The server re-counts rows. If any count differs from the downloaded one (data changed since), confirmation is refused and a fresh download is required. Otherwise status becomes `confirmed`, and `audit_log` records it.
4. **Purge**: the button is enabled only for `confirmed`, purge-eligible, guard-passing months. It calls `SELECT purge_month('2026-05-01')`, a `SECURITY DEFINER` function owned by the owner role. It re-checks every condition **inside the database**, finalizes the summaries, then runs `ALTER TABLE ... DETACH PARTITION ...; DROP TABLE ...` for each of the 7 tables in one transaction (instant). It sets status `purged`.

### 4.5 Scheduled check (Vercel Cron; Hobby allows daily jobs)
`vercel.json`: `"crons":[{"path":"/api/cron/retention","schedule":"30 21 * * *"}]` (03:00 IST), authenticated by Vercel's `CRON_SECRET` header. Each run:
- creates next month's partitions (`ensure_month_partitions(now() + 1 month)`);
- inserts `month_export` rows with status `due` for newly eligible months and sets `reminded_at`;
- deletes `sync_run` rows older than 90 days;
- auto-closes and freezes cycles 15 days past their end;
- **never detaches or drops anything.** The Admin tab and the data-status bar show a red banner to superAdmins while any month is `due` or `downloaded`. Data is never deleted without the admin's confirmation, so a missed export just means the database holds an extra month (~15 MB).

### 4.6 When the first purge is actually due
Today the only agent data is October 2026. Without the backfill, nothing is purge-eligible until **1 May 2027**. With the May-August 2026 backfill, May 2026 becomes eligible on **1 Dec 2026**, June on 1 Jan 2027, and so on. So retention must be live by **30 Nov 2026**, not by Monday. Tell the owner: backfilled May data lives in daily detail for only one month; its lasting value is in `agent_month_summary` (and `cycle_agent_result` if old cycles are defined).

---

## 5. Data migration (Firestore to Postgres) and backfill

### 5.1 Firestore export: use a read script, not the managed export
`gcloud firestore export` needs a billing-enabled project (Cloud Storage), which the owner will not set up. So the copy is a script, `scripts/copy-firestore-to-pg.ts`. It uses the existing `FirestoreRestBackend.listDocs` over a fixed list of collection paths (the §1 inventory; subcollections are listed explicitly, because REST does not recurse) and upserts each document into `doc_store` by path.
- **Read cost:** about 70 agents + ~90 access + ~40 raw chunks + ~15 report docs + ~10 small docs + syncLogs (last 90 days, a few hundred) + loginActivity (**current month only**, ~2,100). That is under 3,000 reads, about 6% of a day's quota.
- **When:** just after the daily quota reset, which is midnight US Pacific: **12:30 IST until Sat 31 Oct, 13:30 IST from Sun 1 Nov** (US DST ends). That is also when the daily Apps Script sync runs, so run the copy first, or after the sync on Saturday.
- **Idempotent:** an upsert by path. Rerunning it overwrites with the newer copy. It writes nothing to Firestore. `--dry-run` prints counts only.
- **Verify** (the script prints a table, and it is also `npm run db:verify`): per collection, the Firestore document count against the `doc_store` count; for agents, the sum of `totals.sales`, `totals.orders` and `result.total`, and the number of `daily` entries; for raw records, `ordersCount`/`visitsCount` from the head against the row totals of all chunks, and the sum of `orderValue`. Every value must match exactly.

### 5.2 Sheet-rebuild parity check (the strongest proof)
After the copy, run one full sync **into Postgres**. Point the preview deployment's `/api/sync` at a Neon branch, or use `scripts/sync-from-payload.ts` with a saved payload. Compare the rebuilt agent documents with the copied ones, field by field (ignoring `updatedAt`, `aiSuggestions.generatedAt`). Any difference is either a real bug or data that changed in the sheet since the last Firestore sync. Both must be explained before cut-over.

### 5.3 Self-verifying syncs (keeps verifying after cut-over)
Apps Script adds `checksums: {Orders:{rows, sumOrderValue}, Dialer:{rows, sumConnects, sumTalkSec}, Visits:{rows}, PreSales:{rows, sumCalls}, Breaks:{rows}}`, computed in `readTab_`. After step 1 the server runs the same aggregates over the payload's date span in Postgres and stores both in `sync_run.checksums`. A mismatch becomes a sync warning (red in the Admin tab and the monitor). This also covers per-tab syncs.

### 5.4 Relational backfill from the bridge (P1)
`scripts/doc-to-relational.ts` fills `cycle`, `agent`, `cycle_agent_result`, `agent_daily` (from `daily[]`), `raw_order` / `raw_visit` (from chunks), `raw_break_day`, the report tables, `app_user` and `sync_run` from `doc_store`. It is idempotent (upserts, or delete-and-insert per cycle window) and verified with the same sums. In practice the next full sync also fills them; the script exists so that nothing depends on the sheet still holding October.

### 5.5 May-August backfill (owner supplies the files)
- **Format:** one XLSX per month (or one with a month column) in the **clean layout**: the tabs `Agents`, `Orders`, `Visits`, `Dialer`, `PreSales`, `Quality`, `Breaks`, with the same headers as the live sheet. CSVs named `2026-05_Orders.csv` and so on also work.
- **Path:** `scripts/backfill.ts --file May2026.xlsx --month 2026-05 [--cycle may-2026] [--dry-run]`. It runs **locally against DATABASE_URL** (no 60 s or 4.5 MB limits). It reuses the same parse, store and recompute code as the sync (§3.2), with the window set to the month or the named cycle. Dry-run prints row counts and sums per tab, for the owner to compare with their own totals. A real run writes `sync_run` with `source='backfill'`.
- **Incentives for past months:** only if the owner supplies the cycle definitions (dates and plans) for May-August. Then `cycle` rows are created, results computed and immediately `frozen`. Otherwise only `agent_daily` and `agent_month_summary` (no incentive) are filled. **Open question Q3.**
- The backfill never touches the active cycle's rows: its window is outside 2026-10-01 to 2026-11-30, and the delete is scoped to the window.

---

## 6. Phased cut-over, flags, rollback, tests

### 6.1 Flags
- `DB_MODE` env: `firestore` (today) | `postgres` (bridge) | `local` (tests). The existing switch in `buildBackend()` gains one branch.
- `PG_RELATIONAL_WRITE` env: `off` | `on`. When on, the sync runs the relational steps after the bridge commit; a failure there becomes a **warning**, never a failed sync, until P2 completes.
- `app_config.data.pgReads`: per page, `off` | `shadow` | `on`, editable by the superAdmin in the Admin tab, so it flips with **no redeploy**. Keys: `agentData`, `allowedAgents`, `teamAgents`, `leaderboard`, `agentLeaderboard`, `teamSummary`, `dodData`, `rawData`, `locationRevenue`, `teamRevenue`, `cohort`, `loginTracker`, `syncLogs`. In `shadow` mode the route serves the bridge answer, also computes the relational one, and logs a structured diff (first 5 differences) to `sync_run`-adjacent logs. Postgres reads cost nothing, so shadow mode is free.

### 6.2 Phases

| Phase | What | Exit check | Rollback |
|---|---|---|---|
| **P0** (Fri) | `PgDocBackend`, migrations runner, `001`, PGlite in tests; db.test backend suite + all API checks green on Postgres | `npm run test:server` green twice (local and pglite) | nothing deployed |
| **P1a** (Sat) | Copy Firestore to `doc_store`; deploy with `DB_MODE=postgres` to **Preview** (Neon branch `preview`); parity sync (§5.2); then Production `DB_MODE=postgres` and press "Sync now" | verify table all equal; parity diff explained; health ok; each role (agent, TL, manager, superAdmin) checked by hand on production | set `DB_MODE=firestore` in Vercel and redeploy (2 min). Firestore still holds Friday's data; press "Sync now" to refresh it (one sync is ~1-2k writes) |
| **P1b** (Sun) | Migrations `002-005`, partitions; relational dual-write behind `PG_RELATIONAL_WRITE=on`; `sheet_tab_state`; `doc-to-relational` backfill; checksums | relational sums = bridge sums for the cycle; sync time logged < 40 s | `PG_RELATIONAL_WRITE=off` (the bridge is untouched) |
| **P2** (Mon onward) | Read paths one at a time: `shadow` for one day of real use with zero diffs, then `on`. Order: rawData, dodData, locationRevenue (biggest win: SQL date and agent filters instead of loading every chunk), then agentData/allowedAgents/teamAgents (AgentRecord rebuilt from `agent` + `cycle_agent_result` + `agent_daily`, **same JSON shape**), leaderboard/agentLeaderboard, teamSummary, teamRevenue, cohort/business overview, loginTracker, syncLogs/monitor/readiness | each page: 0 diffs in shadow over a working day | flip that page back to `off` in the Admin tab |
| **P3** (by ~Nov 20) | Sync writes relational only (bridge agent/raw docs no longer written); per-tab Apps Script groups; retention page, export, purge function, cron; backfill script; superAdmins/managers into `app_user` | retention tests green; a dry-run purge on a Neon branch | re-enable bridge writes (`PG_BRIDGE_WRITE=on`) and set pages to `off` |
| **P4** (by Nov 30) | Retire: delete agent, raw and report docs from `doc_store` (keep it for anything not yet moved); `firestore.rules` deny-all; remove the Firestore REST backend and the client `getFirestore` after 2 quiet weeks | no `adminDb` call left for moved data (grep) | restore from Neon point-in-time history or re-sync from the sheet |

### 6.3 Tests
- **PGlite** (`@electric-sql/pglite`: real Postgres compiled to WASM, in-process, supports declarative partitioning, jsonb, plpgsql and `SECURITY DEFINER` semantics). **Not pg-mem**, which lacks partitioning and plpgsql. The pg layer depends only on a tiny `Queryable` interface (`query(sql, params)`, `transaction(fn)`), so the same code runs on PGlite in tests, the Neon driver in production, and `pg` locally against a Neon branch.
- `tests/db.test.ts` already has a `backendSuite(name, backend)`. Add `backendSuite('postgres', createPgDocBackend(pglite))`, so the bridge is proven against the same contract as Firestore and local.
- `tests/api.test.ts` (297 checks): `run-all.ts` runs the suite twice, with `DB_MODE=local` and `DB_MODE=postgres` (fresh PGlite per run, migrations applied). The readiness check "local-file database is a red flag" gets a postgres twin.
- New relational suites: (a) **parity**: for the existing sync fixtures, every endpoint in relational mode returns JSON deep-equal to bridge mode, for each role, including TL scoping and test-mode filtering; (b) **per-tab sync**: Orders alone changes revenue but not connects, rows outside the payload's span are kept, an unchanged hash writes nothing; (c) **retention**: partitions are created; purge is refused when not confirmed, when counts changed, for an active-cycle month, or for a month with unfrozen results; `cycle_agent_result` and `agent_month_summary` survive a purge; the CSV row count equals the table count; the cron never drops; (d) **backfill**: dry-run writes nothing, and a real run leaves the active cycle untouched.
- `npm test` (shared incentive logic) is unaffected: payout rules do not move.

---

## 7. Risks and open questions

### Risks (with the chosen mitigation)
1. **Neon free compute hours.** At the time of writing the free plan is about 0.5 GB storage per project and a monthly compute-hour allowance (on the order of 100 CU-hours at 0.25 CU), with scale-to-zero after 5 idle minutes. **Verify the current numbers when creating the project.** Heartbeats every 60 s from open agent tabs (persisted every 2 min) keep the compute awake during the working day: about 12-14 h/day × 31 × 0.25 CU = 93-108 CU-h, which is at the limit. Mitigations, in order: (a) pin the compute to 0.25 CU (the free plan's minimum); (b) the heartbeat already persists every 2 min; raise `PERSIST_EVERY_MS` to 5 min in Postgres mode (worst case 5 min of uncounted use); (c) watch usage in the Neon console during week 1; the monitor reads it from the Neon API if an API key is added. Storage: ~10-20 MB/month of agent rows, so the 7-month window plus reports is under 200 MB.
2. **Connections on serverless.** Use `@neondatabase/serverless`. Its **HTTP** `neon()` for single queries holds no connection, so there is nothing to pool or leak across many short-lived instances. `sql.transaction([...])` sends a non-interactive transaction in one HTTP round trip, which is exactly the `commit(writes)` model, so no WebSocket `Pool` is needed in P0/P1. The relational recompute in P1b builds all its statements first, then one `transaction()`. If an interactive transaction is ever needed, use `Pool` over WebSocket, created and `end()`ed inside the request. Use the **pooled** connection string anyway.
3. **Cold starts.** A Neon resume adds ~0.3-1 s to the first request after 5 idle minutes, on top of the Vercel cold start. That is acceptable. The existing per-instance caches stay, and `/api/health` stays cheap. The **Neon region must match the Vercel function region** (Vercel's default `iad1` goes with AWS us-east-1; if the functions run in Asia, choose the nearest Neon region and set `"regions"` in `vercel.json`). Every query pays this round trip.
4. **60 s sync limit and 4.5 MB body.** Postgres removes the 400-write chunking and the per-chunk REST calls. The bulk insert is one statement per table, and unchanged tabs are skipped by hash. Per-tab sync (§3.3) is the escape hatch for body size. Timings are already logged and go into `sync_run.timings`.
5. **Security / row-level enforcement.** The browser never gets a database credential: `DATABASE_URL` exists only in Vercel env and the developer's local `.env`. Two roles: `neondb_owner` (migrations, `purge_month` owner, local scripts only) and `app_rw` (SELECT/INSERT/UPDATE/DELETE on app tables, EXECUTE on `purge_month` and `ensure_month_partitions`, no DDL); Vercel gets `app_rw`. Scoping lives in **one** place, `server-pg/scope.ts`, which returns the SQL predicate for an identity: agent, `agent_email = $me`; TL, the agent's TL fields match (the `isAgentOfTl` rules, ported verbatim, plus a test per rule); manager and superAdmin, all. Every repository function takes the identity and applies the predicate. There is no endpoint where the caller supplies a raw filter, and all SQL is parameterized. Postgres RLS is **deferred**: with the HTTP driver and pooling, a per-request `SET LOCAL` needs a transaction for every read, so it adds cost without adding much while the browser cannot connect at all. Revisit if anything other than this server ever connects.
6. **Backups.** The free plan's point-in-time history window is short (verify). Mitigations: the sheet rebuilds the current cycle; the monthly CSV exports are the archive; optionally `npm run db:backup` (`pg_dump` from the owner's machine) weekly.
7. **Shape drift.** Read paths must return byte-for-byte the same JSON as today, or screens break subtly. Shadow mode plus the parity suite is the control, and no page flips without a clean shadow day.

### Open questions for the owner
- Q1. Is the old MainSheet layout still used anywhere, or can `processImport(mainRows)` be dropped after P2?
- Q2. Who besides the owner is a superAdmin who may export and purge? Should purge need a second person?
- Q3. For May-August: are there incentive cycles (dates and plans) to compute and freeze, or only activity summaries?
- Q4. What time should the cron reminder run, and should it also email (that needs an email provider, not in scope)?
- Q5. Close a cycle automatically 15 days after `end_date`, or only by an Admin click?
- Q6. Is a Vercel function region set today (Settings > Functions)? This picks the Neon region.

---

## 8. Schedule to Monday and prioritized task list

### Day by day
- **Fri 30 Oct (today, evening)**: code P0 (no database needed): `PgDocBackend`, `Queryable` adapters (PGlite, Neon HTTP), the `001` migration and runner, `DB_MODE=postgres`, readiness accepting postgres, tests running twice. **Owner:** create the Neon project (free, no card; region per Q6); create the `preview` branch; create the `app_rw` role; set `DATABASE_URL` (app_rw, pooled) in Vercel for Production and Preview (the Preview one pointing at the `preview` branch) and `DATABASE_URL_OWNER` in the local `.env` only.
- **Sat 31 Oct**: run migrations; copy script `--dry-run`, then the real copy after 12:30 IST; verify table; Preview deploy plus parity sync; fix diffs; **Production switch to `DB_MODE=postgres` by evening**, "Sync now", role checks. **Owner:** run "Sync now" in the sheet when asked; sign in as each role (or have one agent and one TL test) and confirm the screens look the same.
- **Sun 1 Nov**: migrations 002-005 and partitions; parse/build split of `buildFromCleanSheet`; relational store and recompute; dual-write on; `doc-to-relational`; checksums in Apps Script (owner pastes the new `Code.gs`).
- **Mon 2 Nov**: `pgReads` flags and shadow diffing; rawData / dodData / locationRevenue to `shadow`, and `on` by evening if clean; agentData to `shadow`. Retention page read-only view (row counts per month). **Owner:** hand over the May-August files if ready (the importer dry-run starts Tue).

**Promise for Monday:** production runs on Postgres; the Firestore quota no longer matters; the sync dual-writes the relational model; the heaviest raw-data pages read from it. **Defer, with dates:** remaining pages (by Fri 6 Nov); backfill (2 days after the files arrive); per-tab Apps Script groups (by 13 Nov); export, purge and cron (by 20 Nov, needed by 1 Dec); retirement (by 30 Nov); portal features (after that). **Cut entirely for now:** Postgres RLS, an ORM, email reminders, moving superAdmins/managers out of `app_config` before P3.

### Can be coded now, without a database
1. `PgDocBackend` + `Queryable` interface + PGlite adapter + Neon HTTP adapter (`server-pg/`).
2. `DB_MODE=postgres` branch in `buildBackend()`; readiness and health accept postgres.
3. Migration runner + `001_doc_store.sql`; `run-all.ts` runs the API suite on local and on PGlite.
4. `scripts/copy-firestore-to-pg.ts` and `db:verify` (tested against the fake Firestore in `tests/fake-firestore.ts` plus PGlite).
5. Migrations `002-005` (relational DDL, partitions, `ensure_month_partitions`, `purge_month`), all exercised on PGlite.
6. Split `buildFromCleanSheet` into parse and build; relational store and recompute; computed-on-read leaderboard, team revenue and location summaries.
7. `server-pg/scope.ts` with a test per TL matching rule; repository functions per page; the shadow-diff helper; `pgReads` flags in the Admin tab.
8. Apps Script: `checksums`, per-tab groups (server tolerant of both old and new payloads).
9. Retention: export CSV endpoints, confirm/purge endpoints, cron handler, Admin "Data retention" page; tests (c).
10. `scripts/backfill.ts` with `--dry-run`, tested on a synthetic XLSX.
11. `portal_item` table plus a validator and scope stub (no UI).

### Needs the Neon project (and some the owner)
1. **Owner:** create the project, the `preview` branch and the `app_rw` role; set the `DATABASE_URL`s in Vercel and the local `.env`; answer Q6 (region).
2. Run migrations on `preview`, then on `main`.
3. Firestore copy (after the 12:30/13:30 IST quota reset) and the verify table.
4. Preview deploy plus parity sync; **owner** presses "Sync now" or points `SYNC_URL` at the preview for one run.
5. Production `DB_MODE=postgres` switch plus role checks (**owner** helps with sign-ins).
6. `PG_RELATIONAL_WRITE=on`; `doc-to-relational` backfill; shadow days per page.
7. **Owner:** supply the May-August files (and the answer to Q3); run the backfill dry-run, then the real run.
8. Cron (`CRON_SECRET` in Vercel), with a first purge rehearsal on a Neon branch before 1 Dec.
9. Retirement: `firestore.rules` deny-all (**owner** deploys the rules in the Firebase console), remove the Firestore code.

---

## 9. Owner answers (2026-11-09)
- Q2: every TL and Manager may **export** CSVs; only the Super Admin (owner) may **purge**. No second approver.
- Q3: May-August will be agent-wise incentive **summaries** supplied by the owner (no cycle dates or plans to recompute). They go into `agent_month_summary`, not through the incentive calculation.
- Q1 (MainSheet): asked again in plain words; pending.
- Q6 (Vercel function region): pending.
