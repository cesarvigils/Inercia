import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase } from 'firebase-admin/database';


/* =========================================================
   ENVIRONMENT VARIABLES
   ========================================================= */

const projectId =
    process.env.FIREBASE_PROJECT_ID;

const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

let privateKey =
    process.env.FIREBASE_PRIVATE_KEY;

const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET;

const databaseURL =
    process.env.FIREBASE_DATABASE_URL;


/* =========================================================
   VALIDATION
   ========================================================= */

if (!projectId) {
    throw new Error(
        'Falta FIREBASE_PROJECT_ID.'
    );
}

if (!clientEmail) {
    throw new Error(
        'Falta FIREBASE_CLIENT_EMAIL.'
    );
}

if (!privateKey) {
    throw new Error(
        'Falta FIREBASE_PRIVATE_KEY.'
    );
}


/* =========================================================
   PRIVATE KEY NORMALIZATION
   ========================================================= */

/*
 * Vercel normalmente guarda:
 *
 * -----BEGIN PRIVATE KEY-----\nABC...\n-----END PRIVATE KEY-----
 *
 * Firebase necesita saltos de línea reales.
 */

privateKey = privateKey
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\\n/g, '\n');


/* =========================================================
   SERVICE ACCOUNT
   ========================================================= */

const serviceAccount = {

    project_id:
        projectId,

    client_email:
        clientEmail,

    private_key:
        privateKey
};


/* =========================================================
   FIREBASE ADMIN APP
   ========================================================= */

const firebaseApp =
    getApps().length
        ? getApps()[0]
        : initializeApp({

            credential:
                cert(serviceAccount),

            ...(storageBucket
                ? {
                    storageBucket
                }
                : {}),

            ...(databaseURL
                ? {
                    databaseURL
                }
                : {})
        });


/* =========================================================
   SERVICES
   ========================================================= */

export const adminDb =
    getFirestore(firebaseApp);

export const adminStorage =
    getStorage(firebaseApp);

export const adminRtdb =
    getDatabase(firebaseApp);

export { firebaseApp };