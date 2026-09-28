export interface FirebaseConfig {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  measurementId?: string;
  oAuthClientId?: string;
  recaptchaSiteKey?: string;
}

// Single source of Firebase project configuration
// Imports from firebase-applet-config.json
import rawConfig from '../../firebase-applet-config.json';

export const firebaseConfig: FirebaseConfig = {
  projectId: rawConfig.projectId || '',
  appId: rawConfig.appId || '',
  apiKey: rawConfig.apiKey || '',
  authDomain: rawConfig.authDomain || '',
  firestoreDatabaseId: rawConfig.firestoreDatabaseId || '(default)',
  storageBucket: rawConfig.storageBucket || '',
  messagingSenderId: rawConfig.messagingSenderId || '',
  measurementId: rawConfig.measurementId || '',
  oAuthClientId: rawConfig.oAuthClientId || '',
  recaptchaSiteKey: rawConfig.recaptchaSiteKey || ''
};

export default firebaseConfig;
