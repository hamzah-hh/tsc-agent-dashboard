import { GoogleAuthProvider, signInWithPopup, User, onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase-client';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

let cachedAccessToken: string | null = null;
let isSigningIn = false;

// Clear in-memory token whenever the user logs out
onAuthStateChanged(auth, (user) => {
  if (!user) {
    cachedAccessToken = null;
  }
});

export const getCachedSheetsToken = (): string | null => cachedAccessToken;

export const setCachedSheetsToken = (token: string | null) => {
  cachedAccessToken = token;
};

/**
 * Authorizes Google Sheets readonly access via Firebase Auth GoogleAuthProvider.
 * Keeps the resulting OAuth access token in-memory only.
 */
export const authorizeGoogleSheets = async (): Promise<{ user: User; accessToken: string }> => {
  const provider = new GoogleAuthProvider();
  provider.addScope(SHEETS_SCOPE);
  provider.setCustomParameters({
    prompt: 'consent',
  });

  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Google Sign-In completed, but no OAuth access token was returned for Google Sheets.');
    }
    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: credential.accessToken };
  } finally {
    isSigningIn = false;
  }
};
