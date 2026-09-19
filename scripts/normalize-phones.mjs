// scripts/normalize-phones.mjs
//
// One-off, manually-run backfill script (not called by the app or any API route) — run it by hand
// (e.g. `node scripts/normalize-phones.mjs`) to rewrite every existing `users/<uid>` Firestore
// document's `phone`/`phoneNumber` fields into the same canonical format the app now writes and
// reads everywhere (see lib/phone.js) — "+504 9999-9999" for Honduras numbers, best-effort
// "+<digits>" for anything else. The app already tolerates whatever shape was stored (it normalizes
// on every read), so this script is only about making Firestore itself consistent, e.g. so an admin
// looking at raw documents sees one format.
//
// Pass --dry-run to only print what would change, without writing anything.
//
// Requires a GOOGLE_CREDENTIALS environment variable containing a full Firebase service account JSON
// (as a string) — same as scripts/seed.mjs, and only ever run locally/manually.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizePhone } from '../lib/phone.js';

const dryRun = process.argv.includes('--dry-run');

const service = JSON.parse(process.env.GOOGLE_CREDENTIALS);
service.private_key = service.private_key.replace(/\\n/g, '\n');
initializeApp({ credential: cert(service) });
const db = getFirestore();

const usersSnapshot = await db.collection('users').get();

let batch = db.batch();
let pendingInBatch = 0;
let changedCount = 0;

for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data();
    const source = data.phone || data.phoneNumber || '';
    const normalized = normalizePhone(source);

    // No phone on file at all - nothing to normalize.
    if (!normalized) continue;

    // Already consistent - both fields already hold the canonical value.
    if (data.phone === normalized && data.phoneNumber === normalized) continue;

    changedCount++;
    console.log(`${userDoc.id}: ${JSON.stringify(source)} -> ${JSON.stringify(normalized)}`);

    if (dryRun) continue;

    batch.update(userDoc.ref, { phone: normalized, phoneNumber: normalized });
    pendingInBatch++;

    // Firestore batches cap at 500 writes; commit in smaller chunks to stay safely under that.
    if (pendingInBatch === 400) {
        await batch.commit();
        batch = db.batch();
        pendingInBatch = 0;
    }
}

if (pendingInBatch > 0) {
    await batch.commit();
}

console.log(
    dryRun
        ? `Dry run: ${changedCount} de ${usersSnapshot.size} usuarios necesitan normalización.`
        : `Listo: ${changedCount} de ${usersSnapshot.size} usuarios normalizados.`
);
