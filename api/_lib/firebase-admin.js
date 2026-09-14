/*
 * api/_lib/firebase-admin.js
 *
 * Initializes the Firebase Admin SDK once per serverless instance and
 * exports the admin services (Auth, Firestore, Storage, and optionally
 * Realtime Database) used by every /api handler that needs privileged
 * server-side access (bypassing Firestore security rules).
 *
 * Required environment variables (see .env.example):
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   (these three come from a Firebase service account JSON key).
 *
 * Optional environment variables:
 *   FIREBASE_STORAGE_BUCKET  Enables adminStorage.
 *   FIREBASE_DATABASE_URL    Enables adminRtdb (Realtime Database);
 *                            adminRtdb is `null` if this isn't set, so
 *                            callers must check before using it.
 *
 * Note on FIREBASE_PRIVATE_KEY: when this value comes from a hosting
 * platform's env var UI (e.g. Vercel), newlines are usually stored as the
 * two characters "\n" instead of real line breaks, and the value may be
 * wrapped in extra quotes. The replace() calls below undo both of those
 * so the key parses correctly.
 *
 * `getApps().length ? getApps()[0] : initializeApp(...)` guards against
 * re-initializing the app on hot-reloads / repeated cold-start imports.
 */

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase } from 'firebase-admin/database';


/* =========================================================
   ENVIRONMENT VARIABLES
   ========================================================= */

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/\\n/g, '\n')
    .replace(/^"(.*)"$/s, '$1');

const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET;

const databaseURL =
    process.env.FIREBASE_DATABASE_URL;


/* =========================================================
   VALIDATE CONFIG
   ========================================================= */

if (!projectId) {
    throw new Error(
        'Missing FIREBASE_PROJECT_ID environment variable.'
    );
}

if (!clientEmail) {
    throw new Error(
        'Missing FIREBASE_CLIENT_EMAIL environment variable.'
    );
}

if (!privateKey) {
    throw new Error(
        'Missing FIREBASE_PRIVATE_KEY environment variable.'
    );
}


/* =========================================================
   INITIALIZE FIREBASE ADMIN
   ========================================================= */

const adminApp =
    getApps().length
        ? getApps()[0]
        : initializeApp({
            credential: cert({
                projectId,
                clientEmail,
                privateKey
            }),

            ...(storageBucket
                ? { storageBucket }
                : {}),

            ...(databaseURL
                ? { databaseURL }
                : {})
        });


/* =========================================================
   EXPORT SERVICES
   ========================================================= */

export const adminAuth =
    getAuth(adminApp);

export const adminDb =
    getFirestore(adminApp);

export const adminStorage =
    getStorage(adminApp);

export const adminRtdb =
    databaseURL
        ? getDatabase(adminApp)
        : null;

export { adminApp };