# TSC Incentive Portal: Demo and Go-Live Guideline

Written 28 Sep 2026 for Hamza. **Part A** shows you how to demo every view. **Part B** is the checklist to make the app live. **Part C** lists what could block you and what I could not test from here.

Everything in this guide was checked against the code and its automated tests (28 calculation cases, about 150 server checks, about 50 screen checks, Apps Script checks). What I could **not** check is anything that needs your Google accounts: the live Firebase project, Google sign-in, the Firestore rules on the console, the AI Studio publish, and a real phone. Those steps are marked **[your check]**.

---

## 0. The app on one page

**Who sees what**

| Person | Signs in with | Sees |
| --- | --- | --- |
| Agent (HO Caller, Store Caller) | the Gmail in `Agent_Email_Personal` | Own **Actual**, **Target & Goals**, **Simulator** |
| Agent (Pre Sales) | the Gmail in `Agent_Email_Personal` | Own **Actual**, **Simulator** (calls per day, talk time, quality gate) |
| TL | the Gmail in `TL_Personal_Email` | **Team** (own direct reports only) and **Leaderboard** of own location; can open a team member's screens |
| Manager (4 people) | a Gmail in the Manager list | **Team** (everyone), **Leaderboards** (all 3 locations), read-only |
| Super Admin (you) | `agha.h489@gmail.com` (set once when the project is first created) | Everything above, plus **Sync Status** and **Admin** |

**The two modes.** The app is either in **Test mode** (demo users are visible to everyone and the demo tools are open) or **Live** (demo users are hidden from everyone except you). A brand-new project starts in Test mode. You switch with one button: **Admin > Go-live readiness > Go Live**. Switching does not touch real agent data.

**The 3 demo users** (created from **Admin > Demo Users**, data up to 15 Nov):

| Demo user | Type, location | Result you will see |
| --- | --- | --- |
| Demo HO Caller | HO Callers, Dighe | Revenue ₹96,25,000 = 106.9% of ₹90,00,000, **Class B**. Total **₹35,175** |
| Demo Store Caller | Store Callers, Andheri | Revenue ₹1,23,20,000 = 94.8% of ₹1,30,00,000, **Class A**. Total **₹25,380** |
| Demo Pre Sales | PreSales, Dighe | 118 calls a day (Tier 2), 195 s talk time (Tier 2), quality 90 (gate 85 met). Total **₹2,000** |

How the totals are made up:

| | Revenue incentive | Quality | Connects | Talk time | Store-visit rider | Total |
| --- | --- | --- | --- | --- | --- | --- |
| Demo HO Caller | ₹28,875 (0.30%) | 92 = High ₹1,300 | 148 a day = High ₹1,300 | 185 min = High ₹1,500 | 154 visits = Tier 1 ₹2,200 | **₹35,175** |
| Demo Store Caller | ₹18,480 (0.15%) | 88 = Mid ₹1,000 | 142 a day = Mid ₹900 | 168 min = Mid ₹1,000 | 308 visits = Tier 2 ₹4,000 | **₹25,380** |

---

# Part A. Demo the tool (about 15 minutes)

## A1. Set up (10 minutes, before people arrive)

1. Open the app and sign in as Super Admin. Open **Admin**. At the top, **Go-live readiness** should say **TEST MODE is on** (yellow). If the mode says LIVE, press **Back to Test mode** first.
2. Scroll to **Demo Users (3)**. Type the Gmail addresses people will use to sign in during the demo, and leave a field blank if nobody needs it:
   - HO Caller login, Store Caller login, Pre Sales login
   - Dighe TL login (this TL sees the HO and Pre Sales demo users), Andheri TL login (sees the Store demo user)
   - Test Manager login (this one is **added to the real Manager list**; you remove it at go-live)
3. Click **Reset: Clear Test Data + Create 3**. It removes every earlier demo record and creates the 3 demo users again. Real agents are never touched.
4. Check: **Team** shows 3 rows with a **Demo** badge and the totals above.
5. Open a second browser profile (or a private window) per demo login you want to show live. **You do not need this if you demo as Super Admin only**: from **Team** you can open any demo user and see exactly what they see.

## A2. The script, view by view

For each step: **Click**, **Show**, **Say**.

### 1. Team view (Super Admin or Manager)
- **Click** the **Team** tab.
- **Show** the four cards (Total Agents, Total Revenue, Avg Achievement, Total Incentive), the Class Distribution (NQ, A, B, C, D) split by branch, then the table. Use the **location** and **type** filters (HO Callers, Store Callers, Pre Sales), the search box, and click a column heading to sort.
- **Say** "One row per agent, straight from the sheet. Pre Sales agents have no revenue, so they show calls a day and *Gate met / Locked* instead of a class, and they are left out of the revenue totals."
- **Click** a row, for example *Demo HO Caller*. You now see exactly what that agent sees. Use **Team** (top left) to come back.

### 2. HO Caller: Actual tab (Demo HO Caller)
- **Show** the **Performance Pulse** line ("Day 46 of 61: you are at 106.9% of target").
- **Show** the **Incentive Class Progression Highway**: Class A, B (active), C, D with the rupee amount each class needs. "Class B. ₹11,75,001 more revenue moves you to Class C."
- **Show** the Projected Incentive Payout card: ₹35,175 with the breakdown (revenue incentive, quality, connects, talk time, store visits).
- **Show** the four small cards (Quality, Connects, Talk Time, Store Visits): each has the target, the next band and what is still missing. Scroll to the coaching checklist: tap an item to tick it off.
- **Say** "Every number is calculated by the same module that the server uses, so what the agent sees is what payroll will use."

### 3. HO Caller: Target & Goals and Simulator
- **Click** **Target & Goals**: the target (₹90,00,000), the run-rate needed per remaining working day, and the four class cards.
- **Click** **Simulator**. Click the preset **Class C (>120%)**: revenue jumps to ₹1,08,00,001 and the payout to the Class C amount. Then **Pinnacle Jackpot**: everything at the top (Class D, all bands High, top visit tier).
- **Show** that you can also type any number (for example 89.6 for quality counts as 90, like the real calculation). **Reset** returns to the starting values (the agent's projection at the current pace).
- **Say** "Simulator values are never saved. It only answers *what if*."

### 4. Store Caller (Demo Store Caller)
- **Click** *Demo Store Caller* in **Team**. Class A, ₹25,380, Mid bands, Tier 2 rider.
- **Show** that this agent is **₹6,80,001 short of Class B**. In the Simulator, press **Class B (>100%)**: the payout jumps. This is the "what should I push for" story.

### 5. Pre Sales (Demo Pre Sales)
- **Show** the **Quality Score Gate**: 90% against a minimum of 85%. Both incentives are unlocked. **Calls per day** 118 (Tier 2, ₹1,000) and **Talk time** 195 s per call (Tier 2, ₹1,000): total **₹2,000**.
- **Click** **Simulator**, set the quality score to **84**: both incentives show **Locked** and ₹0. Set it back to **85**: both unlock. "Both incentives are paid only with a Quality Score of at least 85."
- **Say** "Talk time is weighted by the number of inbound calls each day. No audit yet counts as gate not met."

### 6. TL view
- **Sign in** (second window) as the Dighe TL.
- **Show** **Team**: only the TL's own direct reports (Demo HO Caller and Demo Pre Sales). The Andheri demo user is not there.
- **Show** **Leaderboard**: the TL's own location only.
- **Say** "A TL can open only their own team. The server and the database rules both enforce it."

### 7. Manager view
- **Sign in** as the Test Manager. **Team** lists all agents, **Leaderboards** shows all 3 locations. There is no Admin tab and nothing can be changed.

### 8. Leaderboards
- **Click** **Leaderboards**, switch between Dighe, Andheri and Bangalore. Podium for the top 3, full table below, search box.
- **Say** "Ranked by total incentive, then achievement, then name. Pre Sales agents are not ranked (no revenue). Bangalore is empty because there are no demo users there." Demo users only appear here in Test mode.

### 9. Sync Status and Admin (Super Admin only)
- **Sync Status**: the last 30 syncs with a green, yellow or red dot (green = data up to 2 days old, yellow = older, red = the last sync failed).
- **Admin > Go-live readiness**: the app checks itself and shows what is green, yellow or red. **Admin > System Health Check** writes to and reads from Firestore and tells you why if it cannot.
- **Admin > Roles & Access**: add or remove Managers.

### 10. Phone
- Open the app on a phone. The header wraps, agent screens stack, and the Team view shows a short list (name, achievement, class, incentive); tap a person to open them.
- **[your check]** I checked the layout at phone width in a browser, not on a real phone.

## A3. After the demo

- To demo again: **Admin > Reset: Clear Test Data + Create 3**.
- To finish: leave the demo users as they are (they are hidden once you go live), or clear them (Part B, step 8).

## A4. Questions you may get

| Question | Answer |
| --- | --- |
| How is the class decided? | Total sales must be **more than** the class limit: over 90% of target = A, over 100% = B, over 120% = C, over 160% = D. Exactly 90.00% is not a class. |
| Where does the rate apply? | To **all** the agent's sales, not only the sales above the limit: 0.15%, 0.30%, 0.45%, 0.60%. |
| Do NQ agents get anything? | Yes: the quality, connects and talk-time bonuses (smaller amounts), and the store-visit rider. Only the revenue incentive is ₹0. |
| How old can the data be? | The sheet syncs daily at about 1:30 PM. A yellow banner shows when the latest data date is more than 2 days old. |
| Can an agent see others? | No. Agents see only their own record. TLs see only their team. |
| What does AI do? | Optional: it rewords the coaching text. Numbers are checked; if a number differs, the plain text is shown. It never touches a payout. |

---

# Part B. Make it live

Suggested dates from the Design Document: clear test data and load the real roster on **30 Sep**, agents get the link on **1 Oct**, first real sync and a check of 5 agents on **2 Oct**.

## B1. Firebase project for the live account **[your check]**

The app needs its own Firebase project (the live one). Menu names in the consoles change now and then; the idea is the same.

1. **Authentication > Sign-in method:** turn on **Google**.
2. **Firestore Database:** create the database (production mode). Pick a region close to India; it cannot be changed later.
3. **Firestore Database > Rules:** replace the rules with the content of `firestore.rules` from this repository and **Publish**. Compare with section 11 of the Design Document (the file adds one line for `/health`; that is intended).
4. **Project settings > Your apps:** copy the web app settings. They go into `firebase-applet-config.json` (next step).
5. **Authentication > Settings > Authorized domains:** add the address of the published app (for example `your-app-xxxxx.run.app`, and any custom domain) **after** the first publish. Without this the Google sign-in window fails with `auth/unauthorized-domain`.
6. **Server access to Firestore:** the published app calls Firestore as its own Google service account. On Cloud Run this is automatic when the Firebase project and the app share a Google Cloud project. If you get **HTTP 403 PERMISSION_DENIED** in the health check, give that service account the **Cloud Datastore User** role on the Firebase project (Google Cloud console > IAM).

## B2. Put the code in the live account

1. In the live AI Studio account, import or pull this repository from GitHub (Design Document section 12).
2. `firebase-applet-config.json` is **not** in GitHub on purpose. Create it in the live account from `firebase-config.example.json` (AI Studio's Firebase setup does this) and check that `projectId` is the **live** project. Never copy the test project's file here.
3. Add the secrets:
   - `SYNC_KEY`: 24 or more random characters, **different** from the test account's key. You paste the same value into the Apps Script in B4.
   - `GEMINI_API_KEY`: only if you want AI coaching text. Optional.
   - Optional, used once when the project is first created: `SUPER_ADMIN_EMAILS`, `MANAGER_EMAILS`.
4. Publish. Copy the app URL.
5. Add that URL's host to the Firebase **Authorized domains** (B1, step 5).

## B3. First run

1. Open `<app URL>/api/health`. You must see `{"status":"ok","storage":"firestore"}`. If you see `"status":"error"`, the message says why (for example a 403: B1 step 6). **This is the go/no-go point from the Design Document: if the server cannot write to Firestore, stop and fix it before anything else.**
2. Sign in as Super Admin. Open **Admin**. **Go-live readiness** should show green for Database and Sync key. Fix any red row.
3. Under **Roles & Access**, add the **4 Manager** Gmail addresses. (Nothing is added for you: the old hard-coded manager address is gone.)
4. Leave **Test mode** on while you test.

## B4. The Google Sheet and Apps Script

Full steps are in `apps-script/README.md`. In short:

1. Extensions > Apps Script: paste `apps-script/Code.gs`. Project Settings: time zone **Asia/Kolkata**.
2. Script Properties: `SYNC_URL` (the app URL, no trailing slash), `SYNC_KEY` (same as the server), `CYCLE_START` 2026-10-01, `CYCLE_END` 2026-11-30.
3. **Incentive App > Sync Now**. You should see "Sync successful" with the number of agents.
4. **Incentive App > Install daily trigger** (about 1:30 PM IST), then open **Triggers** and set **Failure notification settings** to notify you immediately. A failed daily sync now marks the run as failed and emails you.

The sheet must have (column names are fixed; order does not matter):

| Needed | Notes |
| --- | --- |
| All the existing `MainSheet` columns | plus for Pre Sales: **`Inbound_Calls`** and **`Avg_TT_per_day`** (seconds per call), otherwise Pre Sales incentives stay ₹0 and the sync log warns |
| `Agent_Tier` | exactly `HO Callers`, `Store Callers` or `PreSales` (`Pre Sales` also works). Anything else is skipped with a warning |
| `Agent_Location` | `Dighe`, `Andheri` or `Bangalore`. Pre Sales agents: `Dighe` |
| `Agent_Email_Personal` | the Gmail the agent signs in with |
| `TL_Personal_Email` | the Gmail the TL signs in with. Without it the TL cannot see the team |
| `D-1_QualityAudit_Summary` | one row for each agent, **including every Pre Sales agent** (no audit = no Pre Sales incentive) |

**How people get access.** Access is created by the sync, from the rows. An agent or TL can sign in only **after a sync has processed at least one `MainSheet` row of theirs dated inside the cycle**. If your sheet only gets a row after each working day, agents who sign in on the morning of 1 Oct will see "Access denied. Contact your TL." To avoid that, add one **roster row** for each agent dated 2026-10-01 (blank numbers, `Day` = 0) before you send the link; they then sign in and see "No data yet" until real data arrives. (I tested exactly this case.)

## B5. Test with real data, then check the numbers

1. Run **Sync Now**. In **Admin > Go-live readiness**, check **Real agents** (count by type), **Last sync** and any **Sync warnings**.
2. Sign in as one HO Caller, one Store Caller (Andheri), one Bangalore agent and one Pre Sales agent, and one TL. Confirm they see the right screens.
3. From **2 Oct**, after the first 1:30 PM sync: take **5 agents** and calculate their incentive by hand (rates and bands are in section 6 of the Design Document; the cheat sheet is below). All 5 must match.

## B6. Go Live

Do these in this order:

1. **Admin > Roles & Access:** remove the **Test Manager** you added for the demo (it is a real Manager entry).
2. **Admin > Clear Test Data** (only visible in Test mode): removes the demo users, their access records and the test sync log entries.
3. **Admin > Go-live readiness > Go Live.** The page reloads. The banner "TEST MODE" disappears, the header says **LIVE**, the demo tools close, and the leaderboards are rebuilt without demo users.
4. Check **Go-live readiness** again: **Mode** green, no red rows. Sign in as a Manager and a TL and check the lists show only real people.
5. Send the link to the agents.

## B7. Every day after that

- **1:30 PM:** the sheet syncs. Check **Sync Status** (green dot).
- If the trigger fails you get an email. Look at **Sync Status** / **Admin > Sync Logs** for the reason.
- Rule changes before the Phase 2 panel exists: edit the `cycles/diwali-2026` record in the Firebase console (targets, class limits, rates, bands, tiers), then run **Sync Now**. Every sync recalculates every agent and the leaderboards.
- New agent: add rows in the sheet, run Sync Now. Agent removed from the sheet: delete their record in the Firebase console (`cycles/diwali-2026/agents/<official email>`), otherwise they stay in the lists.

## B8. If something goes wrong

The app holds no data of its own except in Firestore and every sync rebuilds everything from the sheet. To roll back a bad release: publish the previous version from GitHub, then run **Sync Now**.

## B9. Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| Google sign-in window fails, `auth/unauthorized-domain` | The app address is not an authorized domain | Firebase > Authentication > Settings > Authorized domains: add it (B1 step 5) |
| "The portal could not check your access" with `HTTP 403 PERMISSION_DENIED` | The server cannot use Firestore | Check `projectId` in `firebase-applet-config.json`, that the Firestore database exists, and the service-account role (B1 step 6). Open `/api/health` |
| "Access denied. Contact your TL." | That Gmail is not in the sheet, or no sync has processed a row for it yet | Check `Agent_Email_Personal` / `TL_Personal_Email`, add a roster row, run Sync Now |
| Team or Leaderboard shows "Missing or insufficient permissions" | Firestore rules not published, or a TL whose email does not match `TL_Personal_Email` | Publish `firestore.rules` (B1 step 3) |
| Apps Script: "Sync failed (401)" | `SYNC_KEY` differs between the script and the server | Make them identical |
| "Missing MainSheet headers: ..." | A required column was renamed or removed | Restore the header name |
| Warning "Unknown tier 'X'. Skipped." | `Agent_Tier` value is not mapped | Use `HO Callers`, `Store Callers` or `PreSales`, or add the value to `tierMap` in the `config/app` record |
| Warning "Unknown location" | Location not in `locations` in `config/app` | Fix the sheet value |
| Warning "MainSheet is missing Pre Sales columns" | `Inbound_Calls` / `Avg_TT_per_day` not in the sheet | Add them |
| A Pre Sales agent shows ₹0 and "Locked" | Quality below 85, or no audit row | Check `D-1_QualityAudit_Summary` |
| Yellow banner "Data last updated on ..." | The latest data date is more than 2 days old | Look at Sync Status; run Sync Now |
| Agent screen says "No data yet" | The agent has no working day (`Day` sum 0) in the cycle yet | Normal before the first data |
| Admin says AI text is on but the key is missing | `GEMINI_API_KEY` is not set | Add the secret, or switch AI text off |

## B10. Cheat sheet for the manual check

- **Class** (sales must be **more than** the limit): A over 90% of target, B over 100%, C over 120%, D over 160%. **Targets:** HO ₹90,00,000, Store ₹1,30,00,000 (whole cycle).
- **Revenue incentive** = total sales × rate (A 0.15%, B 0.30%, C 0.45%, D 0.60%), rounded to the rupee.
- **Bonuses** (High / Mid), by class:

| Class | Quality (≥90 / ≥85) | Connects a day (≥145 / ≥140) | Talk minutes a day (≥180 / ≥165) |
| --- | --- | --- | --- |
| NQ | 1,000 / 800 | 1,100 / 800 | 1,000 / 700 |
| A | 1,300 / 1,000 | 1,300 / 900 | 1,500 / 1,000 |
| B | 1,300 / 1,000 | 1,300 / 900 | 1,500 / 1,000 |
| C | 1,500 / 1,100 | 1,500 / 1,100 | 1,800 / 1,250 |
| D | 2,500 / 1,500 | 2,500 / 1,500 | 3,000 / 1,800 |

- Averages are per **active day** (sum of `Day`), rounded to a whole number before the band is looked up. The quality score is the rounded average audit score; no audit = no quality bonus.
- **Store-visit rider** (attributed visits): HO 110 / 160 / 200 / 220 = ₹2,200 / 4,000 / 5,000 / 7,000. Store 225 / 290 / 360 / 420 = the same amounts.
- **Pre Sales** (needs quality ≥ 85, otherwise both are ₹0): calls a day 101 to 115 = ₹500, 116 to 130 = ₹1,000, 131 and up = ₹2,000. Talk time (seconds per call) 166 to 180 = ₹500, 181 to 210 = ₹1,000, 211 and up = ₹2,000. Maximum ₹4,000.

---

# Part C. Blockers and open items

## C1. Things only you can do (each can block the go-live)

1. **Live Firebase project and AI Studio account** (Part B1 and B2). I cannot reach them from here, so the server-to-Firestore path is **untested against the real service**. The database layer is tested against a fake Firestore that can fail on purpose, and it now fails loudly, but the first real check is `/api/health` in B3. If it fails, that is the design's go/no-go point.
2. **The 4 Manager Gmail addresses** (the live account starts with no managers).
3. **The live URL** for the Apps Script (`SYNC_URL`) and the **`SYNC_KEY`** you choose.
4. **The `Inbound_Calls` and `Avg_TT_per_day` columns** in the real sheet, and Pre Sales agents in the quality tab.
5. **Roster rows** so agents can sign in before their first working day (B4).

## C2. Decisions I need from you (each is a one-line change)

I built these five assumptions for Pre Sales and did not receive an answer. Please confirm or correct:

1. Calls per day and talk time are **rounded to a whole number before the tier is looked up** (your tables use whole numbers).
2. **No audit yet = the quality gate is not met = ₹0.**
3. `Avg_TT_per_day` is **seconds per call**.
4. Averages run over the **whole cycle** (2 months for Diwali), like the other incentives.
5. Pre Sales agents are **not on the revenue leaderboards**.

## C3. Not built yet (Phase 2, due 5 Oct)

The Super Admin panel for cycles, rules, people, deduction rules, absenteeism, recalculate and the audit log. Until then, rule edits are made in the Firebase console (B7). Absent days cannot be entered yet; no deduction rules are configured, so this has no effect on payouts today.

## C4. Known limits (not bugs, but you should know)

- Any signed-in Google account can read `config/app`, which contains the Manager and Super Admin email addresses. That is what section 11 of the Design Document specifies. If you want it tighter, say so.
- The AI text instruction mentions Diwali. After the Diwali cycle, change the wording in `server-ai.ts`.
- The Team view's location list and the class columns (NQ, A, B, C, D) are fixed in the screen. The class limits, rates and bands on the agent screens now follow the cycle record.
- The demo "Test Manager" email is stored in the real Manager list until you remove it (B6, step 1).
- An agent removed from the sheet stays in Firestore until deleted in the console (B7).
- Excel import in the Admin tab is a backup for the sheet sync; it uses the same calculation.

## C5. Bugs fixed in this drop

See `CHANGES.md`.
