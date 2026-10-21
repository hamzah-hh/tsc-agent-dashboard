# Changes

Newest first. How to demo and go live: [docs/GUIDELINE.md](docs/GUIDELINE.md).

---

## v8.6, 21 Oct 2026: Choose the sheets to sync, and the April onwards attribution report

1. **Sync Now** (Incentive App menu) now asks which sheets to sync: a picker with a tick box per sheet group. The incentive data (Agents, Orders, Visits, Dialer, PreSales, Quality, Breaks, Targets) is one unit; Anirban_Ref, Anirban_Cohort_Reportv2, Company_DOD, Diwali_Projection and Business_Overview can each be chosen alone. Report tabs only: the server saves just those (`partial` payload), writes no sync log and leaves everything else as it was. **Sync all sheets (no questions)** in the menu, and the daily trigger, sync everything as before. A report tab missing from the spreadsheet is no longer sent as empty, so it can never blank saved data.
2. **April Onwards Attribution** on the Cohort Report page: a **View April_Onwards Attribution** button under the other sections opens the same cohort tables (cumulative talk time, Shopify / Alt / MP / POS OC, growth against the comparisons) from the new `Anirban_Cohort_Reportv2` tab, for the periods chosen at the top. Loaded only when pressed (`GET /api/cohort-report-v2`, cohort viewers only). Needs the new Code.gs and a sync.
3. Cohort rows that did not change are no longer rewritten on a sync (a content hash is kept), saving writes.

---

## v8.5, 21 Oct 2026: Fewer Firestore reads and writes

Free-tier quota (50k reads, 20k writes a day) was running out. Where it went, and what changed:

1. **Agent heartbeats** (the biggest user): every open agent session pinged every 20 s, and each ping was a read and a write. Now the ping is every 60 s, the day's record is kept in memory, and it is saved to Firestore at most every 2 minutes (at once for the first ping, and when the time left runs low). Roughly 6x fewer writes and almost no reads. If a server restarts, up to 2 minutes of use can go uncounted.
2. **Agent list reads**: the whole agents collection (one read per agent) was re-read every 30 s per server. It is now kept until a sync, AI run or clean-up changes `config/app.dataVersion` (or 30 minutes pass). Config, access and excluded-agent caches went from 30 s to 60 s / 2 min.
3. **Sync writes**: agent and access records whose data did not change are no longer rewritten, so a repeat sync writes only what moved (plus leaderboards, team revenue, the log and the version stamp).

---
## v8.4, 19 Oct 2026: Data status bar and Business Overview export

1. **Last-updated bar** at the top of every page, for every role (agents, TLs, Managers, Super Admin and the cohort report viewer): the time of the last successful sync (IST) and the latest data date it carried. It turns amber when the data is more than 2 days old or the latest sync failed. It comes from the new `GET /api/data-status` (any signed-in user, cached for a minute so it costs few reads).
2. **Export .xlsx** button on the Business Overview: months across newest first, a block of tier rows per KPI with the KPI name merged over it, a financial-year quarter average column after each complete quarter (Apr-Jun = Q1), and the two Quality Score rows, as in the Business Review sample files. Numbers stay numbers (Cr, L, hh:mm:ss, % formats). A TL exports only the tiers they can see. The sheet is named `Performance-till-DD.MM.YYYY` after the latest data date.

---

## v8.3, 18 Oct 2026: Diwali Projection in the Cohort Report

1. **Diwali Projection** section at the bottom of the Talk Time Cohort Report (Anirban and the owner only). It reads the new `Diwali_Projection` tab: company projection against actual per day, achievement %, attributed revenue and 3 min revenue as a share of the actual. Days with an actual of 0 are shown greyed as still ahead.
2. **Summary tiles:** full projection, projection to date, actual to date, achievement to date, attributed and 3 min revenue, remaining projection, and the daily average the remaining days need to reach the full projection.
3. The % columns are recalculated from the amounts, so the tab only needs Date, DoW, Week_Flag, Sale_Percentage, Company_Projection, Company_Actual, Attributed_Revenue and 3_min_Revenue. Paste the updated `Code.gs` and run Sync Now.

---

## v8.2, 17 Oct 2026: Business Overview in Team Summary and Targets

1. **Business Overview** at the top of Team Summary and Targets: month by month and per tier (HO Caller, Store Callers - Andheri, Store Callers - Bangalore, and the total / team average): outbound and connected calls, averages per agent per day, talk time, revenue, average revenue per agent, active team size, AOV and Quality Score (Pre Sales quality as well for the total).
2. **Who sees what:** the Super Admin and Managers see every tier and the total; a TL sees only the tiers of their own agents.
3. **Past months (Apr to Sep 2026)** are typed once in the new `Business_Overview` tab (one row per Month and Tier; revenue in rupees, talk time in seconds). **The running month is worked out at every sync** from the Dialer tab's new `Total_Outbound_Calls` and `Total_Connected_Calls` columns, Orders and Quality, and is marked MTD. A month in the tab is replaced by the computed figures when the cycle has days in it.
4. **Quality has a `Month` column** ("Oct-2026"): the Business Overview shows each month's audit-weighted score per tier, while the incentive uses only the months of the cycle (an agent with two months in the cycle gets the weighted average). Average Revenue per Agent is always Total Revenue / Active Team Size.
5. `Code.gs` sends `Business_Overview`. **Paste the new `apps-script/Code.gs`, then Sync Now.**

---

## v8.1, 16 Oct 2026: company revenue in the Cohort Report

1. **New `Company_DOD` tab** (one row per day and channel: `date`, `channel`, `sales`, `order_id`, `Main_Channel`): company orders and revenue per day, with the Retail and Marketplace groups, kept with the private cohort report (same viewers). Company Revenue is the total of all channels.
2. **Company Revenue table** under the cohort tables: orders, revenue and AOV for the base period and every comparison (SDLM or any dates), with the base's growth against each.
3. **Attributed Revenue table** (rows: Company, Retail, Marketplace and Website Revenue, Attributed Revenue, then Attributed as % of Company, of Retail, of Marketplace and of Website Revenue) for the base period and every comparison, with the base's change against each (growth for revenue, percentage points for the %). Attributed Revenue is the cumulative revenue of the `10 Seconds Plus` cohort (`ATTRIBUTED_COHORT` in `src/shared/cohortReport.ts`). Works for month to date or any selected dates, and is part of Copy as PNG.
4. `Code.gs` and the .xlsx import send `Company_DOD`. **Paste the new `apps-script/Code.gs`, then Sync Now.**

---

## v8, 13 Oct 2026: private Talk Time Cohort Report

Verified by: type-check, 30 calculation tests, 260 server checks, production build, and the sample report (sample.xlsx) reproduced from the live Anirban_Ref tab with the app's code (August and July exact).

1. **Talk Time Cohort Report** from the new `Anirban_Ref` tab, laid out like the original Excel report: a month up to a chosen day, ten cumulative talk time cohorts by Shopify / Alt / MP / POS OC orders and revenue, totals and AOV, and orders / revenue / AOV growth against two chosen months (red for a fall), with each comparison month's own table. CSV download.
2. **Only Anirban (anirban.tsc@gmail.com) and the owner (agha.h489@gmail.com, as a Cohort Report tab in the Super Admin console)** (`COHORT_REPORT_VIEWERS`; the `COHORT_REPORT_VIEWERS` environment variable can replace the list). Not Managers or TLs. Anirban gets only this report: he is not a role in the access check, so every other route refuses him. The data is stored in `privateReports/` (no Firestore rule, so no browser reads it directly), and sync warnings about the tab give counts only.
3. `Code.gs` and the .xlsx import send the `Anirban_Ref` tab. **Paste the new `apps-script/Code.gs`, then Sync Now.**
4. **Date ranges and any number of comparisons:** the base period and every comparison have their own From / To dates; add or remove comparisons (each gets its own table and growth columns in the base table). Default: this month to date vs SDLM (the same days last month); a quick pick sets a comparison to the same days 1-12 months back.

---

## v7, 13 Oct 2026: Team Summary & Targets page

Verified by: type-check, 30 calculation tests, 246 server checks, production build, and the three sections rendered with the live sheet's data.

1. **New staff page "Team Summary & Targets"** (TLs see their own team and their own target; Managers and the Super Admin see all), with a date range (cycle to date, last 7 days, latest day, or any dates):
   - **Average Productivity** per TL team from the Dialer tab: average unique connects and talk time per agent per worked day, red below 135 connects or 2h 45m (half for a half day); expand a team for its agents, click an agent for their daily data.
   - **Breaks** per location from the new Breaks tab, per agent per day in hh:mm:ss, red above Bio or Misc 20m, First / Last Break 15m, Lunch 30m, Total Daily Break 1h 20m, Idle Time and ACW over 30.56% of Staffed Duration (2h 45m of a 9-hour shift); same drill-down.
   - **Period Targets and Achievement** from the new Targets tab: sales, target, achievement, remaining, needed per day, and on / behind pace for the day of the cycle.
2. `Code.gs` and the Admin .xlsx import send the `Breaks` and `Targets` tabs. **Paste the new `apps-script/Code.gs` into the script editor, then Sync Now.**

---

## v6, 12 Oct 2026: Visit Activity, Credit_Date, monitor

Verified by: type-check, 30 calculation tests, 241 server checks, production build, and `scripts/monitor.ts` run on the live sheet.

1. **Orders' `Credit_Date` column was ignored** (the code looked for `Credited_Date`), so 11 orders dated in September (Rs 5.06 lakh) were left out and 43 more counted on their order day instead of their credit day. Both names work now, and a sync warns when Orders has neither.
2. **Visit Activity (Raw Data > visits):** every visit showed "Store Caller", callers showed as emails, the oldest visit came first, and the Visit ID / "1 Credit" columns meant nothing. Now: caller name, the real caller type (HO / Store), newest first, search by name.
3. **Orders table:** an order credited to two agents used the same row key, so rows could be dropped or repeated.
4. With the clean sheet, empty raw data no longer triggers a download of the old Raw_Revenue / Raw_Visit tabs (Google answers with the first tab instead).
5. **Monitor:** read-only `/api/monitor` (needs `MONITOR_KEY` on Vercel) and `scripts/monitor.ts`, run by a scheduled cloud agent.

---

## v5, 11 Oct 2026: clean sheet layout

Verified by: type-check, 30 calculation tests, 234 server checks (14 new for this layout), production build, and the sample workbook `Test_Agent.xlsx` converted and compared with the live MainSheet agent by agent. **Not** verified with a real Apps Script run on the new tabs.

1. **New sheet layout with six input tabs** (`Agents`, `Orders`, `Visits`, `Dialer`, `PreSales`, `Quality`) and no MainSheet, Leader_Mapping, Excluded_Agents or DoD_AgentRevenue. The dashboard builds the daily numbers itself (`server-clean-sheet.ts`) and runs them through the unchanged incentive code. The rules are in `apps-script/README.md`. A sheet with no `Agents` tab still syncs the old way.
2. **`Code.gs`:** with an `Agents` tab it sends the six tabs; dates are sent as the sheet shows them (the spreadsheet's time zone). **Paste the new `apps-script/Code.gs` into the script editor before switching the sheet.**
3. **Admin > Import .xlsx** accepts a workbook in the new layout.
4. Raw orders take their location from the agent's `Agents` row (the old `Raw_Revenue` had its columns shifted, so every order was counted under Dighe and the Shopify / Alt / MP / POS split was 0).

Expected changes at switchover, compared with MainSheet: orders bought from another number move to their `Credited_Date`; Pre Sales talk time uses the sheet's per-call figures; Rubiay, Saif and Rakshitha get their 2 Oct back; agents who were missing from MainSheet (Azman and others) appear; talk minutes are exact instead of rounded to 2 decimals.

---

## v4, 10 Oct 2026: security, sign-in mapping and free-tier limits

Verified by: type-check, 30 calculation tests, 220 server checks, production build, and the Pre Sales calculation run on the live MainSheet rows. **Not** verified against the live Firebase project or a real Apps Script run.

### Security
1. **The sync accepted two keys written in the code** (`tsc-sync-secret-2026`, `CHANGE_ME_...`), so anyone who knew them could overwrite agent data and give any Gmail access. Only `SYNC_KEY` (or `config/app.syncKey`) works now, and only in the `X-Sync-Key` header (no `?key=`, which ends up in access logs). With no key configured, the sync answers 503.
2. **`snehatsc@gmail.com` was a Manager by code** and could not be removed. She is moved once into `config/app.managers` (flag `legacyManagerMigrated`), so she stays a Manager and the Admin tab can now remove her.
3. **`/api/leaderboard` returned every agent's total incentive to any signed-in agent.** Now staff only; a TL reads only their own location (as in `firestore.rules`).
4. **Day-on-Day:** a TL could pass `?location=` to see another branch's roster. Agents and TLs now stay in their own location.
5. `firestore.rules`: a TL sees agents by location only when the agent has no TL at all, the same rule as the API. **Publish the rules in the Firebase console.**
6. Removed an unused sign-in helper that accepted the login token in the URL.

### Sign-in mapping (Leader_Mapping)
7. **Leader_Mapping headers had to match exactly** (`Agent_Email_Personal`, ...); any other spelling was silently ignored and the agent could not sign in. Headers are now matched ignoring case, spaces and punctuation, like MainSheet.
8. **Leader_Mapping's Gmail now wins** over a different one in MainSheet, with a sync warning naming both. Old access records are kept, so nobody loses access.
9. **A sync warning names every mapped agent with no MainSheet rows in the cycle** (they cannot sign in until they have one).

### Free-tier limits (Firestore and Vercel)
10. **Fewer Firestore reads:** config, cycle, agents, excluded agents, access records and raw data are cached for 30 s per server instance and dropped after every sync, import or Admin change. Page loads used to re-read the whole agents collection each time (about 500 page loads a day reached the free 50,000-read quota with 100 agents).
11. **Raw orders and visits are split into documents of 1,000 rows** (`data/rawRecords/chunks/*`). One document holds at most 1 MiB, which a full cycle of orders exceeds. Older single-document data still reads.
12. **Big syncs are gzip-compressed** by the Apps Script (over 3.5 MB; Vercel refuses bodies over about 4.5 MB). **Paste the new `apps-script/Code.gs` into the script editor.**
13. `vercel.json`: the API may run up to 60 s (a sync waits up to 35 s for Gemini).

### Other
14. `.github/workflows/ci.yml` runs the type-check, both test suites and the build on every push, and checks that the committed `api/index.js` matches the source.
15. README: `firebase-applet-config.json` is committed (it said git-ignored); `FIREBASE_SERVICE_ACCOUNT` documented for Vercel.

### Pre Sales: calls per day was 0 for every agent
16. **Pre Sales rows in MainSheet leave `Day` blank**, and Active Days is the sum of `Day`, so every Pre Sales agent had 0 active days and 0 calls per day (and no calls incentive). A row with `Day` blank and `Inbound_Calls` above 0 now counts as one worked day; a `Day` that is filled in (1, 0.5, 0) is used as it is. HO and Store rows have no `Inbound_Calls`, so they are unchanged. Checked against the live sheet: all 17 Pre Sales agents match calls ÷ rows (for example 578 calls over 5 rows = 116 a day). Calculation test #30. **Run Sync Now after the deploy** so the stored records are recalculated.

### Talk time is in minutes (confirmed)
17. The live sheet's `Talk_Time_Minutes` holds minutes, which is how the app reads it. The demo data and test fixtures sent seconds under `Talk_Time_(seconds)` (so the demo Store Caller showed 25,880 instead of 25,380); they now send minutes under `Talk_Time_Minutes`, and the docs say minutes.

---

## v3, 28 Sep 2026: bug fixes and go-live tooling

Built on v2 (below). Verified by: type-check (0 errors), 28 calculation test cases (also in three time zones), ~150 server checks (`npm run test:server`), ~50 screen checks in a simulated browser, Apps Script checks against stubbed Google services, a production build, and a boot of both the published server and the dev server. **Not** verified: the real Firebase project, Google sign-in, the AI Studio publish, a real phone.

### Fixed: data safety and access

1. **The database layer swallowed errors** (`server-db.ts`). A failed save was ignored (the data only reached a local file), a failed read fell back to old local copies, and `/api/health` never called Firestore, so a sync could say "ok" while nothing was saved. Now every failed read or write is an error with the reason and a hint (for example the "Cloud Datastore User" role), short outages are retried, saves go out in atomic commits of up to 400 writes, and `/api/health` really writes and reads `health/ping`. A local store exists only for development (`DB_MODE=local`).
2. **A TL could open any agent** through `/api/agent-data`. Now a TL opens only agents whose `TL_Personal_Email` is the TL's own login (the same rule as the Firestore rules). `/api/allowed-agents` follows the same rule; before, it filtered by location.
3. **Every agent received the Manager and Super Admin email lists** in the `/api/agent-data` answer. Removed.
4. **Two copies of the API had drifted apart** (`server.ts` and `vite-api-plugin.ts`): the dev copy ignored the body of `POST /api/admin/config`, and the published copy had no `/api/admin/config-cycle` (the Test Center's role and AI panels were empty in production). One shared `server-routes.ts` now serves both.
5. **Hard-coded people were re-added on every request** (a Super Admin, a Manager and the placeholder `YOUR_PERSONAL_GMAIL`), so a Manager could never be removed. A new project is seeded once (Super Admin `agha.h489@gmail.com`, or `SUPER_ADMIN_EMAILS`; managers from `MANAGER_EMAILS`); after that nobody's access changes behind your back. An empty Super Admin list is repaired, and the API refuses to remove the last Super Admin or your own access.
6. **Gemini ran before the data was saved** during a sync. Now the data is saved first and AI text follows within a time budget (default 35 s); a slow or failing Gemini can never delay or fail a sync. Text is tied to the exact numbers it was written for (a fingerprint), so old text can never sit next to new numbers, and unchanged agents are not sent to Gemini again.
7. **Switching test mode** now rebuilds the leaderboards at once (before, demo users stayed on them until the next sync), and demo users cannot be created while the app is live.
8. **Sign-in error handling:** a server problem was shown as "Access denied. Contact your TL." It now says the portal could not check the access, shows the reason, and offers "Try again".
9. **Smaller:** the public health URL is cached for 10 s (it cannot drain the daily quota); the sync key is compared in constant time; ID tokens must have a verified email (as in the rules); broken JSON returns a JSON 400; `.env.local` and `.env` are loaded when the server starts (the key was read too early); a TL now sees their own name instead of "Team Leader".

### Fixed: screens

10. **The Actual and Target tabs crashed** when the first sync arrived while an agent had the page open and they tapped Refresh (a hook after an early return).
11. **Class limits and rates were fixed in the screens** (90 / 100 / 120 / 160%, 0.15 / 0.30 / 0.45 / 0.60%, "Class D") in the Actual tab, Target tab, milestone ladder and slab table. They now follow the cycle record, so a rule change is reflected everywhere. "Simulate Target" used to set revenue to exactly the limit, which does not reach the class (a class needs **more than** the limit); it now sets the first rupee above it.
12. **Simulator:** the preset "Class A (120% Target)" gave Class B; the level-up confetti ran backwards (it fired on drops); typed decimals were not rounded like the real calculation (89.6 quality counted as Mid, not High); the top class badge looked plain; the starting values used an unrounded quality score. The presets are now built from the plan and the values are rounded like the real calculation.
13. **Quality warning:** shown only when the score was exactly at a band limit. The Design Document says "within 1 point of a band limit": it now shows at the limit and 1 point above it.
14. **Cycle name** in the header, footer and leaderboard title came from a fixed "Diwali 2026"; it now comes from the cycle record.
15. **Phone layout:** the top bar overflowed at phone width (Sign Out was off-screen); it now wraps. "Target & Goals" is "Target" on a phone.
16. **Admin tab:** always there for the Super Admin (roles, AI, health, Live / Test switch); before, it disappeared in live mode together with the only place to manage Managers. New **Go-live readiness** panel (database write test, sync key, mode, people, agents, last sync, warnings, AI key). The demo tools show only in Test mode. A failed "remove Manager" now shows the error.
17. **Faster on phones:** the Admin console and its Excel reader load only for the Super Admin (the first download for everyone else is about 25% smaller).
18. A working-days calculation used the local time zone (`setDate`); it now uses UTC.
19. **Stale-data banner** ("Data last updated on <date>", latest data more than 2 days old) was only on the agent screens. The Design Document asks for it on every screen, so the Team view and the Leaderboards show it too (one shared component).

### Fixed: Google Sheet script and build

20. **Apps Script:** every daily-trigger run ended with an error (a trigger cannot open a dialog), so a real failure looked like a good run. A success is now a success, a failure marks the run as failed (so Apps Script can email you), and the trigger is set for about 1:30 PM (was "1 to 2 PM").
21. **`npm install` failed** (`esbuild@^0.25` conflicted with vite 8). The unused `esbuild` devDependency is removed and `bun.lock` was regenerated; `bun install --frozen-lockfile` and a plain `npm install` both resolve.

### Added

- `tests/`: database-layer tests against a fake Firestore that can fail on purpose, and the full HTTP API (roles, TL scope, go-live, clear test data, AI ordering, broken Firestore). `npm run test:server`.
- Calculation test cases 25 to 28 (quality warning, working days, class ladder, AI fingerprint).
- `docs/GUIDELINE.md`, a rewritten `README.md`, `.env.example` with every setting.

### Environment settings (new, all optional except `SYNC_KEY`)

`SYNC_KEY` (required to sync), `GEMINI_API_KEY`, `SUPER_ADMIN_EMAILS`, `MANAGER_EMAILS`, `AI_SYNC_BUDGET_MS`, and for development only `DB_MODE=local`, `DB_LOCAL_FILE`, `FIRESTORE_EMULATOR_HOST`.

### Still open (not bugs)

See Part C of [docs/GUIDELINE.md](docs/GUIDELINE.md): the Phase 2 admin panel, the five Pre Sales assumptions, and the known limits.

---

## v2, 28 Sep 2026: Pre Sales section and 3 demo users

Built on the AI Studio export of 28 Sep 2026.

1. **Test values cleared, 3 demo users kept.** The Test Center creates exactly 3 demo users (HO Caller, Store Caller, Pre Sales) and has a one-click reset. `local-db.json` (a snapshot of test data) was removed and is git-ignored.
2. **New Pre Sales section** (`Agent_Tier` = `PreSales`, location Dighe): its own plan, agent screens, Team view rows, suggestions and Simulator.
3. **Pre Sales structure:** two incentives (calls per day, talk time in seconds), both paid only with a Quality Score of at least 85%.
4. **Also fixed:** the Actual tab crashed for every HO / Store agent with data (`Store` icon was not imported), and the Test Center Excel import shifted every date back one day; a row flagged `isTest` now marks only that agent; Clear Test Data also removes the sync-log entries written by test runs.

### Pre Sales rules as built

| Incentive | Value used | Payout |
| --- | --- | --- |
| Calls per day | `Inbound_Calls` summed, divided by Active Days (sum of `Day`), rounded half-up | 0-100 = ₹0 · 101-115 = ₹500 · 116-130 = ₹1,000 · 131+ = ₹2,000 |
| Talk time (seconds) | `Avg_TT_per_day` weighted by that day's `Inbound_Calls` (= total talk ÷ total calls), rounded half-up | 0-165 = ₹0 · 166-180 = ₹500 · 181-210 = ₹1,000 · 211+ = ₹2,000 |

- **Quality gate:** the Quality Score (average audit score, rounded half-up) must be **85 or more**. Below 85, or no audit at all, both incentives are ₹0. The agent sees them as "Locked" with the amount waiting, and a warning suggestion.
- Maximum per cycle: ₹4,000. No revenue, class, deductions or store-visit rider for Pre Sales.
- All values live in the cycle record (`plans.PRE_SALES`): `qualityGate`, `calls[]`, `talkSeconds[]`, `talkMethod` (`weighted` or `simple`).
- **Team view:** Pre Sales rows show calls/day, seconds/call and "Gate met / Locked". They are left out of Total Revenue, Avg Achievement and the class counts, and there is an agent-type filter.
- **Leaderboards:** Pre Sales agents are **not** ranked (no revenue).

### Assumptions to confirm (each is a one-line change)
1. Averages are rounded to whole numbers **before** the tier lookup.
2. No audit yet = gate not met = ₹0.
3. `Avg_TT_per_day` is seconds **per call**.
4. Averages run over the whole cycle (2 months for Diwali).
5. Pre Sales stays off the revenue leaderboards.

### Sheet requirements
`MainSheet` gets two columns (found by header name): `Inbound_Calls`, `Avg_TT_per_day`. Pre Sales rows use `Agent_Tier` = `PreSales` (`Pre Sales` and `pre-sales` also work) and `Agent_Location` = `Dighe`; revenue columns stay blank. Every Pre Sales agent needs a row in `D-1_QualityAudit_Summary`. Details: `apps-script/README.md`.

### Demo users (Admin tab, "Demo Users (3)")
| User | Agent_Tier / location | State in the demo data (to 15 Nov) | Total |
| --- | --- | --- | --- |
| Demo HO Caller | HO Callers · Dighe | Class B (106.9%), High bands, Tier 1 rider | ₹35,175 |
| Demo Store Caller | Store Callers · Andheri | Class A (94.8%), Mid bands, Tier 2 rider | ₹25,380 |
| Demo Pre Sales | PreSales · Dighe | 118 calls/day (Tier 2), 195 s (Tier 2), quality 90 | ₹2,000 |

All are `isTest = true`. Once test mode is **off** they never appear in leaderboards, team totals or a TL / Manager's list; only the Super Admin sees them in the Team view (with a "Demo" badge).
