import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/* =========================================================
   FIREBASE SERVICE ACCOUNT
   ========================================================= */

const rawServiceAccount =
    process.env.FIREBASE_SERVICE_ACCOUNT;

if (!rawServiceAccount) {
    throw new Error(
        'Falta FIREBASE_SERVICE_ACCOUNT en las variables de entorno.'
    );
}

let serviceAccount;

try {
    serviceAccount =
        JSON.parse(rawServiceAccount);
} catch (error) {
    console.error(
        '[FIREBASE ADMIN] FIREBASE_SERVICE_ACCOUNT no contiene JSON válido.'
    );

    throw new Error(
        'FIREBASE_SERVICE_ACCOUNT contiene JSON inválido.'
    );
}


/* =========================================================
   VALIDATION
   ========================================================= */

if (
    !serviceAccount.project_id ||
    typeof serviceAccount.project_id !== 'string'
) {
    throw new Error(
        'FIREBASE_SERVICE_ACCOUNT no contiene project_id.'
    );
}

if (
    !serviceAccount.client_email ||
    typeof serviceAccount.client_email !== 'string'
) {
    throw new Error(
        'FIREBASE_SERVICE_ACCOUNT no contiene client_email.'
    );
}

if (
    !serviceAccount.private_key ||
    typeof serviceAccount.private_key !== 'string'
) {
    throw new Error(
        'FIREBASE_SERVICE_ACCOUNT no contiene private_key.'
    );
}


/*
 * Por si Vercel terminó guardando los \n literalmente.
 */
serviceAccount.private_key =
    serviceAccount.private_key.replace(
        /\\n/g,
        '\n'
    );


console.log(
    '[FIREBASE ADMIN] Service Account:',
    {
        project_id:
            serviceAccount.project_id,

        client_email:
            serviceAccount.client_email,

        private_key:
            serviceAccount.private_key
                ? 'OK'
                : 'MISSING'
    }
);


/* =========================================================
   INITIALIZE FIREBASE ADMIN
   ========================================================= */

const firebaseApp =
    getApps().length
        ? getApps()[0]
        : initializeApp({
            credential:
                cert(serviceAccount),

            storageBucket:
                process.env.FIREBASE_STORAGE_BUCKET,

            databaseURL:
                process.env.FIREBASE_DATABASE_URL
        });


/* =========================================================
   SERVICES
   ========================================================= */

export const adminDb =
    getFirestore(firebaseApp);

export const adminStorage =
    getStorage(firebaseApp);

export {
    firebaseApp
};