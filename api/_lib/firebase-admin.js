import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/* =========================================================
   ENV
   ========================================================= */

const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID;

const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

const rawPrivateKey =
    process.env.FIREBASE_PRIVATE_KEY;

const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET;

const databaseURL =
    process.env.FIREBASE_DATABASE_URL;


/* =========================================================
   CHECK ENV
   ========================================================= */

console.log('[FIREBASE ADMIN] Environment:', {
    projectId: projectId ? 'OK' : 'MISSING',
    clientEmail: clientEmail ? 'OK' : 'MISSING',
    privateKey: rawPrivateKey ? 'OK' : 'MISSING',
    storageBucket: storageBucket ? 'OK' : 'MISSING',
    databaseURL: databaseURL ? 'OK' : 'MISSING'
});

if (!projectId) {
    throw new Error(
        'FIREBASE_PROJECT_ID no está configurado en Vercel.'
    );
}

if (!clientEmail) {
    throw new Error(
        'FIREBASE_CLIENT_EMAIL no está configurado en Vercel.'
    );
}

if (!rawPrivateKey) {
    throw new Error(
        'FIREBASE_PRIVATE_KEY no está configurado en Vercel.'
    );
}


/* =========================================================
   PRIVATE KEY
   ========================================================= */

const privateKey = rawPrivateKey
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\\n/g, '\n');


/* =========================================================
   SERVICE ACCOUNT
   ========================================================= */

/*
 * Firebase Admin acepta camelCase en cert():
 * projectId
 * clientEmail
 * privateKey
 *
 * Esto evita el problema que estabas teniendo
 * construyendo manualmente project_id.
 */

const serviceAccount = {
    projectId,
    clientEmail,
    privateKey
};


/* =========================================================
   INITIALIZE
   ========================================================= */

const app =
    getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            credential: cert(serviceAccount),

            ...(storageBucket
                ? { storageBucket }
                : {}),

            ...(databaseURL
                ? { databaseURL }
                : {})
        });


/* =========================================================
   EXPORTS
   ========================================================= */

export const firebaseApp = app;

export const adminDb =
    getFirestore(app);

export const adminStorage =
    getStorage(app);