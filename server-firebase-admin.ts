import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { firebaseConfig } from './src/shared/firebase-config';
import { serverDb } from './server-db';

const app = getApps().length === 0
  ? initializeApp({
      projectId: firebaseConfig.projectId || process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT,
    })
  : getApp();

export const adminDb = serverDb;
export const adminAuth = getAuth(app);
export default app;
