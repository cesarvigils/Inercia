/*
 * firebase-config.js
 *
 * Initializes the Firebase client SDK (the browser-side app, as opposed
 * to api/_lib/firebase-admin.js which is the server-side admin SDK) and
 * exports `auth` and `db` for the rest of the frontend to import.
 *
 * All config values come from VITE_FIREBASE_* environment variables (see
 * .env.example) instead of being hardcoded, because this project is
 * built with Vite — only variables prefixed VITE_ are exposed to
 * `import.meta.env` in client-side code (see vite.config.js). These
 * values end up bundled into the shipped JS, which is expected: they are
 * NOT secrets, just identifiers for which Firebase project to talk to.
 * Actual access control is enforced by Firebase Auth + Firestore/Storage
 * security rules, not by hiding this config.
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);