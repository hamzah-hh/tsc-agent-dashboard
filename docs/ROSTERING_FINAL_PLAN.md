# Rostering: final plan (mail last)

Status: **P0 and P1 are built** (18 Nov 2026, not yet deployed); swaps (P2), hardening (P3) and mail (P4) are not. See "Switching it on" at the end.
This document **replaces the open questions** of `docs/ROSTERING_PLAN.md` with the owner's decisions and rewrites the rules, scope and phases accordingly. The first plan stays as the technical reference (data model sketch in C, API table in D, concurrency design in D.4, swap state machine in F, screens in G): where this document differs, this one wins.

**Mail is deliberately the last phase.** Phases 0 to 3 need no mail at all: every notification and approval lives in the app (badge and inbox). Mail (from `crmsales@thesleepcompany.in`, through Netcore) is Phase 4, after IT has answered the request for Netcore details.

---

## 1. Decisions made by the owner

| # | Topic | Decision |
|---|---|---|
| 1 | First WO in a week, Mon to Fri, within the TL's limit | **Confirmed at once.** No approval. The TL sees it in the app (and, in Phase 4, by mail) and can revoke it before the cut-off |
| 2 | Sat / Sun WO | **Always needs TL approval.** The agent may always send the request; the limit is not enforced at request time. The TL decides. Approving above a limit the TL set for that date needs an override with a reason |
| 3 | A 2nd (or later) WO in the same week | **Needs TL approval.** No hard weekly maximum (the TL decides each one). A setting can add a maximum later |
| 4 | PL (planned leave) | **Needs TL approval on any date.** Plan only: the app keeps no leave balance, HR or payroll stays the official record |
| 5 | WO booking window | Current week plus the next 2 weeks |
| 6 | PL booking window | **Up to 60 days ahead** |
| 7 | Limit (inactive agents = WO + PL) | **Per team**, one number per TL's team (a TL controls one team). Set for all days, or for a particular date |
| 8 | Default weekday limit | If the TL has set none: **team size / 5, rounded up** (a team of 17 gets 4 a day). No default for Sat / Sun: there the TL decides each request |
| 9 | Cut-off | Agent until **D-1 18:00 IST**; TL until D 00:00 IST; Managers and the Super Admin any time, with a reason |
| 10 | Swaps | Same caller type **and** same location **and same TL**, both WOs in the **same week**. Both agents confirm **in the app** now; **OTP is added in the mail phase** as a second check. TL approval needed |
| 11 | What agents see of others | Only **slot counts** per day. Names and WO dates of eligible colleagues are shown only inside the swap screen, never PL |
| 12 | Link to incentives | **None.** The roster does not change `absentDays`, active days or any incentive number |
| 13 | TLs' own WO/PL | **Not in the first version** |
| 14 | Rollout | **Pilot with one team first**, behind a switch, then all teams |
| 15 | Mail | Last phase |

## 2. The final rules

**Definitions.** All dates are IST calendar dates. The week runs Monday to Sunday (ISO), so Saturday and Sunday belong to the week that ends on that Sunday. **Weekday** = Mon to Fri, **weekend** = Sat and Sun. **Team** = the agents of one TL (existing `isAgentOfTl` logic). **Inactive** = an agent with a WO or PL on that date whose status is `pending` or `approved`. Test agents and excluded agents never count.

**Booking**
- R1. WO on a weekday, the agent's first WO of that week, and the day is below the team's limit: **approved immediately**.
- R2. WO on a weekday and the day is already at the limit: **refused** ("Your team's limit for Wed 25 Nov is 4 and 4 are already off").
- R3. WO on Sat or Sun: **pending**, whatever the limit. It counts as the week's WO.
- R4. A second or later WO in the same ISO week: **pending** (needs the TL), and still subject to R2 on a weekday.
- R5. PL on any date: **pending**. On a weekday it is refused when the day is full (R2); on a weekend the TL decides (as R3).
- R6. Pending entries **hold a slot** on weekdays, so two agents cannot both take the last one. A rejected, cancelled or expired entry frees it.
- R7. An agent holds at most one active entry per date.
- R8. WOs only in the window "today's week plus 2 weeks"; PL up to 60 days ahead. Never in the past.
- R9. An agent changes or cancels an entry only before the cut-off (D-1 18:00). After that, ask the TL.
- R10. When the TL approves an entry, the limit is checked again. If it would exceed the limit, the TL must tick "override" and give a reason (audited). Weekend approvals follow the same rule only when the TL has set a limit for that date.
- R11. **Lowering a limit never cancels anything.** The day shows "Over limit: 5 off, limit 4"; new weekday bookings are refused; the TL revokes whom they choose.

**Limits**
- R12. A TL sets the limit for all days and for particular dates, for their own team only. Managers and the Super Admin can set any team's.
- R13. Precedence: a date limit, then the team's all-days limit, then the default (team size / 5, rounded up). The default applies to weekdays only.
- R14. The TL screen warns when the week's limits cannot fit everyone's WO ("17 agents, but the limits allow only 15 WOs on weekdays this week"), since weekends are not self-service.

**Swaps** (Phase 2)
- R15. Agent A (WO on day X) and agent B (WO on day Y) of the **same `agentType`, same location, same TL**, with X and Y in the **same week**, both entries `approved`, both before their cut-off, neither in another open swap.
- R16. Flow: A requests, B accepts in the app, the TL approves, then it applies in one step. At apply time everything is re-checked (still the same TL, type and location, both entries intact, each day's limit, the weekly WO count). If anything fails, the swap is `failed` and both agents see why.
- R17. A swap onto or off a weekend date is allowed; the TL's approval is the weekend approval.
- R18. Swap eligibility is read from the **current** agent record: `agentType` and `location` must match (Dighe Pre Sales is a different location and type from Dighe HO; Andheri and Bangalore Store are different locations). The same-TL check uses the team key.
- R19. Swaps expire when either date's agent cut-off passes, or after 72 hours.
- R20. (Mail phase) Each agent also confirms an emailed one-time code; the app already holds the confirmation state, so this is added without changing the flow.

**Everything**
- R21. Append-only **audit log** of every action (who, what, before and after, on whose behalf, when).
- R22. Agents never see PL reasons or other people's names, except as in decision 11.
- R23. Time in the Roster tab counts against the agent's 30-minute portal windows (accepted for now).

## 3. Assumptions (all confirmed by the owner on 2026-11-18)

**Pilot team: the Dighe HO Caller team.** The pilot switch (`appConfig.roster.pilotTeams`) is keyed by the TL's team key, so the Dighe HO TL's official email is needed when P1 is ready to switch on. If Dighe HO has more than one TL, all of them go in the list.

1. Week starts on **Monday**; "today" is IST.
2. A weekend WO still counts as the agent's weekly WO (so a later weekday WO in the same week is "the second" and needs approval).
3. PL is **not** subject to the limit on weekends at request time (the TL decides), but it is on weekdays, as the owner's rule 2 says.
4. The limit for the 60-day PL window uses the same all-days limit and default as nearer dates; TLs can set date limits as far ahead as they like.
5. Pending requests older than the cut-off for their date become `expired` automatically (in the app first; the reminder and escalation mails come in Phase 4).
6. Churn limit: an agent can change (book or cancel) at most **3 times a week**, and have at most 1 open swap request.
7. No fixed "booking opens at" time in the first version (the TL's limits are the control). It can be added if first-come-first-served causes disputes.
8. If an agent leaves or is excluded, their future entries are cancelled by a daily job.
9. The roster does not depend on the incentive cycle: membership comes from the active agent list, plus the previous cycle's for 14 days after a cycle change.

## 4. Technical design (unchanged from the first plan, summary)

- **New relational Postgres tables**, standalone (no change to the sync or `doc_store`): `roster_limit`, `roster_entry`, `roster_swap`, `roster_audit`, `app_notification` (in-app inbox). Migration `db/migrations/010_roster.sql` with a minimal runner (`npm run db:migrate`), run by the developer with the owner connection. Roster code reads `DATABASE_URL` directly.
- **Concurrency:** one SQL statement per booking, serialised by advisory locks, so exactly `limit` bookings can succeed (first plan, D.4). Pure rules live in `src/shared/roster.ts`, used by the server and the UI.
- **Changes to make to the first plan's rules:** day type (weekday / weekend) and "default limit = ceil(team size / 5) on weekdays only" in `roster.ts`; weekend entries are always `pending` and skip the limit check at creation; PL window of 60 days; no `maxWoPerWeek` by default; swap eligibility adds the same-team check from the start; OTP columns are left out until Phase 4.
- **API:** as the first plan's D.1, minus the mail endpoints and the OTP calls until Phase 4. Notifications: `GET /api/notifications` and read, driving a badge on the Roster tab.
- **UI:** a **Roster** tab in the agent view (3-week calendar for WOs, a PL date picker up to 60 days, swap wizard, my requests, inbox) and in the staff portal for TLs, managers and the Super Admin (team grid, limits editor, approvals queue, act on behalf, history, CSV export). Details in the first plan's G.
- **Feature switch:** `appConfig.roster.enabled` and `pilotTeams`. With the database missing, the Roster tab says "temporarily unavailable" and nothing else is affected.

## 5. Phases

| Phase | Contents | Effort |
|---|---|---|
| **P0 Setup** | Neon branch for development; migration runner; test database (PGlite); move `isAgentOfTl` into a shared scope module | 1 day |
| **P1 Core, in-app only** | WO / PL booking with all the rules above, limits (all days and per date), default limit, approvals queue, revoke, act on behalf, audit, in-app notifications and badge, agent and staff Roster tabs, feature switch and pilot team, tests (rules and API) | 6 to 7 days |
| **P2 Swaps, in-app** | Candidates, request, partner accepts, TL approves, atomic apply, expiry, wizard UI, tests | 3 to 4 days |
| **P3 Hardening and all teams** | Churn limits, feasibility warning, Manager all-teams view, CSV export, weekly backup export, documentation, then switch on for all teams | 2 to 3 days |
| **P4 Mail (last)** | Netcore sender module and outbox with retries, templates (approval requests, decisions, swap events), daily digest to TLs, reminders and escalation, swap OTP as a second check, Admin outbox panel, `MAIL_MODE` test redirect, then live | 4 to 5 days, plus IT's answers |

Total about 16 to 20 developer days. The pilot team goes live at the end of P1 (without swaps), swaps join at P2, everyone at P3, mail at P4.

## 6. Parked for the mail phase (nothing needed now)

- IT's answers on the Netcore account (see the message drafted in the conversation and section E.6 of the first plan).
- The mail contents and timing: who is mailed at which event, the digest hour, the 24 h reminder and 48 h escalation, and whether agents are mailed at their personal Gmail or official address.
- Whether the Vercel project allows the scheduled jobs needed for reminders (Hobby plans allow daily jobs only).

## 7. What the owner has to do

- Give the Dighe HO TL's official email (all of them, if there are several) before the pilot switch is turned on at the end of P1.
- For P4: get the Netcore details from IT.

## 8. Switching it on (P0 and P1)

1. Deploy this version. With the switch off nothing changes for anyone.
2. Run the migration once against Neon with the owner connection: `npm run db:migrate` (it uses `DATABASE_URL_UNPOOLED`, else `DATABASE_URL`). It only adds four tables and records itself in `schema_migrations`.
3. Super Admin, Admin tab, Rostering: tick **Rostering is on**, put the Dighe HO TL's official email in the pilot list, Save. The Roster tab then appears for that TL, their agents, managers and the Super Admin only.
4. To roll back, untick the switch. The tables can stay.
