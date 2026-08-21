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