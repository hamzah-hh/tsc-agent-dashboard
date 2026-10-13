import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseConfig } from './firebase-config';

// Initialize Firebase app for client
export const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
// Sign-in asks only for name and email. The Google Sheets permission is a "sensitive" scope: asking for it
// at every sign-in showed Google's unverified-app screen, or blocked accounts outright while the consent
// screen is in Testing. Only the Super Admin's direct Sheets import needs it, and it asks for it there
// (authorizeGoogleSheets in sheets-auth.ts).
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
