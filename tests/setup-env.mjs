// Preloaded via `node --import ./tests/setup-env.mjs` (see package.json's
// "test" script) so it runs before ANY test file's imports. api/_lib/
// firebase-admin.js throws at import time if FIREBASE_PROJECT_ID/
// FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY aren't set — and it's imported
// transitively by api/_lib/reservations.js, which every test file needs even
// when it never actually talks to Firestore. These are throwaway values:
// a real (but freshly generated, never used anywhere else) RSA key so
// firebase-admin's cert() can parse it, and a fake project id/email. No
// network call is ever made with them in the test suite.
import { generateKeyPairSync } from 'node:crypto';

if (!process.env.FIREBASE_PROJECT_ID) {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' }
  });

  process.env.FIREBASE_PROJECT_ID = 'test-project';
  process.env.FIREBASE_CLIENT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
  process.env.FIREBASE_PRIVATE_KEY = privateKey;
}
