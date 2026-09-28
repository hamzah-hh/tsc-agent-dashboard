import { applicationDefault, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { firebaseConfig } from './src/shared/firebase-config';
import { Backend, createDb, createFirestoreBackend, createLocalBackend } from './server-db';
import { loadEnv } from './server-env';

loadEnv();

function projectId(): string {
  return (
    firebaseConfig.projectId ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  );
}

// Firebase Authentication: verifies the ID token of the signed-in user (needs no credentials).
const app = getApps().length === 0 ? initializeApp({ projectId: projectId() }) : getApp();
export const adminAuth = getAuth(app);
export default app;

// Access token of the server's own service account (Cloud Run, or GOOGLE_APPLICATION_CREDENTIALS on a PC).
// A failed lookup is remembered for a few seconds so a PC without credentials does not wait on every call.
let credential: any = null;
let tokenRetryAt = 0;

async function serviceAccountToken(): Promise<string | null> {
  if (Date.now() < tokenRetryAt) return null;
  try {
    if (credential === null) credential = applicationDefault();
    const t = await credential.getAccessToken();
    return t?.access_token || null;
  } catch (_e) {
    credential = null;
    tokenRetryAt = Date.now() + 15000;
    return null;
  }
}

function buildBackend(): Backend {
  loadEnv();
  const mode = (process.env.DB_MODE || 'firestore').toLowerCase();

  if (mode === 'local') {
    // Development and automated tests only. Nothing is shared with the browser.
    const file = process.env.DB_LOCAL_FILE;
    console.warn('[db] DB_MODE=local: using a local store, NOT Firestore. Never use this for the live app.');
    return createLocalBackend(file === 'none' ? null : file || 'local-db.json');
  }
  if (mode !== 'firestore') {
    throw new Error(`Unknown DB_MODE "${mode}". Use "firestore" (default) or "local".`);
  }

  return createFirestoreBackend({
    projectId: projectId(),
    databaseId: firebaseConfig.firestoreDatabaseId || '(default)',
    apiKey: firebaseConfig.apiKey,
    tokenProvider: serviceAccountToken,
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    restBase: process.env.FIRESTORE_REST_BASE,
  });
}

let backend: Backend | null = null;

/** The server's database. The backend is created on first use, after the environment is loaded. */
export const adminDb = createDb(() => (backend ??= buildBackend()));

/** For automated tests that switch DB_MODE between runs. */
export function resetBackendForTests(): void {
  backend = null;
}
