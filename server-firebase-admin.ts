import { applicationDefault, cert, deleteApp, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AsyncLocalStorage } from 'async_hooks';
import { firebaseConfig } from './src/shared/firebase-config';
import { Backend, createDb, createFirestoreBackend, createLocalBackend } from './server-db';
import { loadEnv } from './server-env';
import { fallbackServiceAccount } from './server-service-account';

loadEnv();

export const requestContext = new AsyncLocalStorage<{ idToken?: string }>();

function getServiceAccountCredential(): any {
  let saRaw = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GCP_SERVICE_ACCOUNT;
  if (!saRaw) {
    const candidatePaths = [
      path.resolve(process.cwd(), 'service-account.json'),
      path.resolve(process.cwd(), '..', 'service-account.json'),
      path.resolve('/app/applet', 'service-account.json'),
      path.resolve('/app', 'service-account.json'),
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          saRaw = fs.readFileSync(p, 'utf8');
          if (saRaw) break;
        } catch (_e) {
          // ignore
        }
      }
    }
  }
  if (saRaw) {
    try {
      const parsed = JSON.parse(saRaw.startsWith('{') ? saRaw : Buffer.from(saRaw, 'base64').toString('utf8'));
      return cert(parsed);
    } catch (_e) {
      // ignore
    }
  }
  if (fallbackServiceAccount && fallbackServiceAccount.private_key) {
    try {
      return cert(fallbackServiceAccount as any);
    } catch (_e) {
      // ignore
    }
  }
  return null;
}

const explicitCredential = getServiceAccountCredential();

function projectId(): string {
  if (fallbackServiceAccount && fallbackServiceAccount.project_id) {
    return fallbackServiceAccount.project_id;
  }
  return (
    process.env.FIRESTORE_PROJECT_ID ||
    firebaseConfig.projectId ||
    process.env.GCP_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  );
}

const targetProjectId = projectId();

// Clean up any default app that might have been initialized with a stale or incorrect project ID
const defaultApp = getApps().find((a) => a.name === '[DEFAULT]');
if (defaultApp && defaultApp.options?.projectId !== targetProjectId) {
  try {
    deleteApp(defaultApp);
  } catch (_e) {
    // Ignore
  }
}

// Always initialize a dedicated named app with targetProjectId and credentials if available
let app = getApps().find((a) => a.name === 'tsc-admin-app' || a.options?.projectId === targetProjectId);
if (!app) {
  app = initializeApp(
    explicitCredential
      ? { credential: explicitCredential, projectId: targetProjectId }
      : { projectId: targetProjectId },
    'tsc-admin-app'
  );
}
export const adminAuth = getAuth(app);

const allowedProjectIds = Array.from(
  new Set(
    [
      targetProjectId,
      firebaseConfig.projectId,
      fallbackServiceAccount?.project_id,
      'ai-studio-tscagentdashboar-4a25c7aa-a6fe-4950-9680-a3794ae11803',
      process.env.FIRESTORE_PROJECT_ID,
      process.env.GCP_PROJECT,
    ].filter((p): p is string => Boolean(p))
  )
);

let clientAuth: any = null;
if (firebaseConfig.projectId && firebaseConfig.projectId !== targetProjectId) {
  try {
    const existing = getApps().find((a) => a.name === 'client-auth-app');
    const clientApp = existing || initializeApp({ projectId: firebaseConfig.projectId }, 'client-auth-app');
    clientAuth = getAuth(clientApp);
  } catch (e) {
    // ignore
  }
}

export default app;

let cachedPublicKeys: { [kid: string]: string } = {};
let keysExpireAt = 0;

async function getGooglePublicKeys(): Promise<{ [kid: string]: string }> {
  if (Date.now() < keysExpireAt && Object.keys(cachedPublicKeys).length > 0) {
    return cachedPublicKeys;
  }
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 3600;
  keysExpireAt = Date.now() + maxAge * 1000;
  cachedPublicKeys = await res.json();
  return cachedPublicKeys;
}

/**
 * Resilient token verification:
 * 1. Attempts standard adminAuth.verifyIdToken.
 * 2. Attempts clientAuth.verifyIdToken if project IDs differ between client and server DB.
 * 3. Cryptographically verifies the RSA-SHA256 signature against Google's public x509 certificates
 *    and verifies claims against allowedProjectIds.
 */
export async function verifyFirebaseIdToken(token: string): Promise<any> {
  try {
    return await adminAuth.verifyIdToken(token);
  } catch (err: any) {
    if (clientAuth) {
      try {
        return await clientAuth.verifyIdToken(token);
      } catch (_e) {
        // Fall through to manual cryptographic verification
      }
    }

    const parts = token.split('.');
    if (parts.length !== 3) throw err;
    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw err;
    }

    if (!allowedProjectIds.includes(payload.aud)) {
      throw new Error(
        `Firebase ID token has incorrect "aud" claim. Expected one of [${allowedProjectIds.join(', ')}] but got "${payload.aud}".`
      );
    }
    if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) {
      throw new Error(`Firebase ID token has incorrect "iss" claim: "${payload.iss}".`);
    }
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new Error('Firebase ID token has expired.');
    }

    const keys = await getGooglePublicKeys();
    const certStr = keys[header.kid];
    if (!certStr) {
      throw new Error(`Firebase ID token has "kid" claim which does not correspond to a known public key.`);
    }

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${parts[0]}.${parts[1]}`);
    const valid = verifier.verify(certStr, parts[2], 'base64url');
    if (!valid) {
      throw new Error('Firebase ID token signature verification failed.');
    }

    return payload;
  }
}

// Access token of the server's own service account (Cloud Run, or GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT).
// A failed lookup is remembered for a few seconds so an environment without credentials does not wait on every call.
let credential: any = explicitCredential;
let tokenRetryAt = 0;

async function serviceAccountToken(): Promise<string | null> {
  if (Date.now() < tokenRetryAt) return null;
  try {
    if (credential === null) {
      credential = getServiceAccountCredential() || applicationDefault();
    }
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
    contextTokenProvider: () => requestContext.getStore()?.idToken || null,
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
