import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getDatabase } from 'firebase-admin/database';

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ?.replace(/^"(.*)"$/s, '$1')
    .replace(/\\n/g, '\n');

if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
        'Faltan variables de entorno de Firebase Admin.'
    );
}

const app =
    getApps()[0] ||
    initializeApp({
        credential: cert({
            projectId,
            clientEmail,
            privateKey
        }),

        storageBucket:
            process.env.FIREBASE_STORAGE_BUCKET,

        databaseURL:
            process.env.FIREBASE_DATABASE_URL ||
            `https://${projectId}-default-rtdb.firebaseio.com`
    });

export const adminDb =
    getFirestore(app);

export const adminStorage =
    getStorage(app);

export const adminRtdb =
    getDatabase(app);