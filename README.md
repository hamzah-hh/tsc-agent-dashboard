# TSC Agent Incentive Portal

Call Sales incentive dashboard for The Sleep Company. Every agent sees their **actual** incentive for the cycle and can **simulate** the final payout; TLs, Managers and the Super Admin get team views and location leaderboards. Data comes from the Ops Google Sheet (`MainSheet` + `D-1_QualityAudit_Summary`) through an Apps Script; the app calculates and stores one summary record per agent in Firestore.

**Start here:** [docs/GUIDELINE.md](docs/GUIDELINE.md): how to demo every view, how to go live, blockers and open items.
Spec: the Design Document (Hamza, 25 Sep 2026). What changed in each drop: [CHANGES.md](CHANGES.md).

## What is in the box

| Path | What it is |
| --- | --- |
| `src/` | The React app (agent, TL, manager, Super Admin screens) |
| `src/shared/` | The calculation module (one copy, used by the browser **and** the server), rules, suggestions, demo data, calculation test cases |
| `server-routes.ts` | The whole HTTP API (`/api/*`). Used by both `server.ts` (published app) and `vite-api-plugin.ts` (dev server) |
| `server-import.ts` | Sync and import: reads the sheet rows, calculates, saves agents, access records, leaderboards, sync log |
| `server-db.ts`, `server-firebase-admin.ts` | The database layer: Firestore, strict (a failed save is an error, never a silent success) |
| `server-ai.ts` | Optional Gemini rewording of the coaching text (numbers are validated; runs after the data is saved) |
| `server-readiness.ts` | The "Go-live readiness" checks in the Admin tab |
| `apps-script/` | The Google Apps Script for the sheet (`Code.gs`) and its setup guide |
| `firestore.rules` | Firestore security rules (they match section 11 of the Design Document; publish them in the Firebase console) |
| `tests/` | Server tests: database layer (against a fake Firestore that can fail on purpose) and the full HTTP API |

## Run it on a PC

You need Node 20+ (or Bun). AI Studio uses `bun.lock`; `npm install` works too.

1. `npm install`
2. Create `firebase-applet-config.json` from `firebase-config.example.json` with your Firebase project's web settings. **This file is git-ignored on purpose**: the test and live projects have different files, and a pull must never point the live app at the test database.
3. Copy `.env.example` to `.env.local` and set at least `SYNC_KEY`.
4. `npm run dev` (development, http://localhost:3000) or `npm run build && npm start` (as published).

The server needs Google credentials to reach Firestore. On Cloud Run (the published app) this is automatic. On a PC, set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account key of the Firebase project, or use `DB_MODE=local` for a throw-away in-memory database (development only; the browser cannot see it).

## Tests

```
npm test            # 28 calculation test cases (they also run in the Admin tab)
npm run test:server # ~150 checks: database layer + every API route, no network needed
npm run lint        # type-check
```

Run all three before each release (Design Document, section 13).

## Release (private GitHub repository to the live account)

1. Finish and test in the build account. 2. Push to this repository. 3. In the live account, import or pull from GitHub. 4. Check that `firebase-applet-config.json` still points to the **live** project. 5. Check `firestore.rules` against the Firebase console. 6. Publish, open `/api/health`, run Sync Now from the sheet, check 3 agents (one for each location).
The full checklist is Part B of [docs/GUIDELINE.md](docs/GUIDELINE.md).
