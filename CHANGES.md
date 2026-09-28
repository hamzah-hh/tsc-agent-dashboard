# Changes in this drop (28 Sep 2026)

Built on the AI Studio export from 28 Sep 2026 (`tsc-agent-dashboard.zip`). 25 files changed; `tsc-agent-dashboard_v2.patch` (next to this zip) applies to that export with `git apply`.

1. **Test values cleared, 3 demo users kept.** The Test Center now creates exactly 3 demo users (HO Caller, Store Caller, Pre Sales) and has a one-click reset. `local-db.json` (a snapshot of test data) is removed and git-ignored.
2. **New Pre Sales section** (`Agent_Tier` = `PreSales`, location Dighe): its own plan, agent screens, Team view rows, suggestions and Simulator.
3. **Pre Sales structure as in your image:** two incentives (calls per day, talk time in seconds), both paid only with a Quality Score of at least 85%.
4. **Also fixed:** the Actual tab crashed for every HO / Store agent with data (`Store` icon was not imported), and the Test Center Excel import shifted every date back one day (see "Other fixes").

## Pre Sales rules as built

| Incentive | Value used | Payout |
| --- | --- | --- |
| Calls per day | `Inbound_Calls` summed, divided by Active Days (sum of `Day`), rounded half-up | 0-100 = ₹0 · 101-115 = ₹500 · 116-130 = ₹1,000 · 131+ = ₹2,000 |
| Talk time (seconds) | `Avg_TT_per_day` weighted by that day's `Inbound_Calls` (= total talk ÷ total calls), rounded half-up | 0-165 = ₹0 · 166-180 = ₹500 · 181-210 = ₹1,000 · 211+ = ₹2,000 |

- **Quality gate:** the Quality Score (average audit score, rounded half-up) must be **85 or more**. Below 85, or no audit at all, both incentives are ₹0. The agent sees them as "Locked" with the amount waiting, and a warning suggestion.
- Maximum per cycle: ₹4,000. No revenue, class, deductions or store-visit rider for Pre Sales.
- All values live in the cycle record (`plans.PRE_SALES`): `qualityGate`, `calls[]`, `talkSeconds[]`, `talkMethod` (`weighted` or `simple`). The UI reads them from there.
- **Team view:** Pre Sales rows show calls/day, seconds/call and "Gate met / Locked". They are left out of Total Revenue, Avg Achievement and the class counts, and there is a new agent-type filter.
- **Leaderboards:** Pre Sales agents are **not** ranked (no revenue). The 3 location leaderboards are unchanged.

### Assumptions to confirm (each is a one-line change)
1. Averages are rounded to whole numbers **before** the tier lookup (your table has whole-number From/To).
2. No audit yet = gate not met = ₹0.
3. `Avg_TT_per_day` is seconds **per call**, as in the image header.
4. Averages run over the whole cycle (2 months for Diwali), like the other incentives.
5. Pre Sales stays off the revenue leaderboards.

## Sheet requirements
`MainSheet` gets two columns (found by header name): `Inbound_Calls`, `Avg_TT_per_day`. Pre Sales rows use `Agent_Tier` = `PreSales` (`Pre Sales` and `pre-sales` also work) and `Agent_Location` = `Dighe`; revenue columns stay blank. Every Pre Sales agent needs a row in `D-1_QualityAudit_Summary`. Details: `apps-script/README.md`. The Apps Script itself is unchanged.

## Demo users (Test Center, section 4)
| User | Agent_Tier / location | State in the demo data (to 15 Nov) | Total |
| --- | --- | --- | --- |
| Demo HO Caller | HO Callers · Dighe | Class B (106.9%), High bands, Tier 1 rider | ₹35,175 |
| Demo Store Caller | Store Callers · Andheri | Class A (94.8%), Mid bands, Tier 2 rider | ₹25,380 |
| Demo Pre Sales | PreSales · Dighe | 118 calls/day (Tier 2), 195 s (Tier 2), quality 90 | ₹2,000 |

All are `isTest = true`. Once `testMode` is **off** they never appear in leaderboards, team totals or a TL / Manager's list; only the Super Admin sees them in the Team view (with a "Demo" badge). A blank login email gets a placeholder nobody can sign in with; the Super Admin can still open that user from the Team view.

## Go-live checklist (today)
1. Publish this code to the live account. **`firebase-applet-config.json` is not in the zip on purpose:** keep the live account's own file. `local-db.json` is gone and git-ignored.
2. Nothing to edit in Firestore for the new tier or plan: on the first server request `config/app.tierMap` gets `PreSales` and the cycle gets the default Pre Sales plan (tested against an old-style database; safe to run repeatedly).
3. Sign in as Super Admin, open **Test Center**, enter the 3 demo login emails (personal Gmail) and click **Reset: Clear Test Data + Create 3**. It deletes every `isTest` agent and access record and the test sync logs, then creates the 3 demo users.
4. In the Firebase console check `config/app.managers` (remove any test manager added earlier) and that no other test agents remain (agents loaded without the test flag are not removed by Clear Test Data).
5. Set `config/app.testMode` to `false` in the Firebase console (there is no button for it).
6. Add `Inbound_Calls` and `Avg_TT_per_day` to the real sheet, then run **Sync Now**. Check the sync log has no warnings, then open the Pre Sales agent from the Team view (type filter "Pre Sales").

## Other fixes
- `ActualTab.tsx`: missing `Store` icon import. The Actual tab crashed for every HO / Store agent with data (reproduced on the original code).
- Test Center "Import Spreadsheet": Excel dates were read as `cellDates`, which SheetJS returns as 18:29:50 UTC of the previous day in IST, so every date shifted back one day and the first cycle day was dropped. Dates now stay Excel serials (the server already converts them). The Apps Script sync was never affected.
- A row flagged `isTest` now marks only that agent as a test agent (before, one flagged row marked the whole batch).
- Clear Test Data also removes the sync-log entries written by test runs.

## What was verified (scratch toolchain, nothing installed system-wide)
- `tsc --noEmit`: 0 errors. `npm test` (new): 24 of 24 calculation tests (the original 16 unchanged + 8 new Pre Sales cases; they also run in the Test Center).
- `vite build`: OK.
- Server end-to-end (offline, real `processImport`): your `tool_test.xlsx` (HO row + PreSales row), the 3 demo users, leaderboards with test mode on and off, and the upgrade of an already-deployed database: 29 of 29 + 9 of 9 checks.
- UI: agent screens rendered for HO, Store and Pre Sales (gate met, locked, no audit yet, no data, AI text on/off); Team view driven in a simulated browser with mixed rows, all roles, sorting and the type filter: 21 checks.
- **Not** verified: the live Firebase project (no access from here), Google sign-in, and the visual layout on a phone.

## Still open from the earlier review (not changed here)
- `/api/agent-data` lets any TL open any agent (design: own team only).
- `server-db.ts`: failed Firestore writes are ignored, reads fall back to a local file, and `/api/health` never touches Firestore.
- Gemini text is generated inside `/api/sync` before the data is written (design: after).
- The UI hard-codes 90/100/120/160% and some rate labels, so a Phase 2 rule change would leave stale labels.
- `/api/admin/config-cycle` exists only in the dev server (Test Center's manager / AI panel is empty in production); hard-coded seed manager and admin emails are re-added on every request.
- `package.json`: a plain `npm install` fails (`esbuild@^0.25` conflicts with vite 8's peer range). bun / AI Studio are unaffected; removing the unused `esbuild` devDependency fixes it.

## Design doc addendum (paste-ready)
> **Pre Sales (added 28 Sep 2026).** Agent Type "Pre Sales": `Agent_Tier` = `PreSales`, location Dighe. Two incentives, both paid only if the Quality Score is 85 or more (no audit = not met). Calls per day (`Inbound_Calls` ÷ Active Days, rounded): 101-115 = ₹500, 116-130 = ₹1,000, 131+ = ₹2,000. Talk time in seconds (`Avg_TT_per_day` weighted by `Inbound_Calls`, rounded): 166-180 = ₹500, 181-210 = ₹1,000, 211+ = ₹2,000. Not ranked on the location leaderboards; visible in the Team view. Cycle record: `plans.PRE_SALES`.
