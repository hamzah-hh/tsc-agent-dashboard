# Changes

Newest first. How to demo and go live: [docs/GUIDELINE.md](docs/GUIDELINE.md).

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
