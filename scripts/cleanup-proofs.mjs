// scripts/cleanup-proofs.mjs
//
// Manually-run cleanup (not called by the app or any API route): deletes bank-transfer payment
// proofs ("comprobantes de pago") older than N days from Firebase Storage, under
// `reservation-proofs/<uid>/...` (where js/reservas.js uploads them).
//
//   npm run cleanup:comprobantes                       -> dry run: only lists what would be deleted
//   npm run cleanup:comprobantes -- --confirm          -> actually deletes
//   npm run cleanup:comprobantes -- --days=90 --confirm
//
// Defaults to 60 days (~2 months). Deletion is permanent — always look at the dry run first.
//
// Safety:
//   - Never touches a proof whose reservation is still 'pending' (an admin hasn't reviewed it yet).
//   - Age comes from the file's own Storage creation time, not from the reservation date.
//   - Old files with no reservation at all (upload succeeded, booking failed) are deleted too.
//   - Reservations that pointed at a deleted file get `proof.deletedAt` set, so the admin panel can
//     show "comprobante eliminado" instead of a broken link. `proof.path` is kept for the record.
//
// Needs the same FIREBASE_* variables as the API (see .env.example), including
// FIREBASE_STORAGE_BUCKET. They're read from .env if present.

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from '../api/_lib/firebase-admin.js';

const PREFIX = 'reservation-proofs/';

const confirm = process.argv.includes('--confirm');
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : 60;

if (!Number.isFinite(days) || days < 1) {
    console.error('--days tiene que ser un número mayor a 0.');
    process.exit(1);
}

if (!process.env.FIREBASE_STORAGE_BUCKET) {
    console.error('Falta FIREBASE_STORAGE_BUCKET en el entorno.');
    process.exit(1);
}

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const bucket = adminStorage.bucket();

/* ---------- proofs still waiting for admin review: never delete these ---------- */

const pendingSnapshot = await adminDb
    .collection('reservations')
    .where('status', '==', 'pending')
    .get();

const protectedPaths = new Set(
    pendingSnapshot.docs
        .map((doc) => doc.get('proof.path'))
        .filter(Boolean)
);

/* ---------- find old files ---------- */

const toDelete = [];
let scanned = 0;
let skippedPending = 0;
let pageQuery = { prefix: PREFIX, maxResults: 1000, autoPaginate: false };

while (pageQuery) {
    const [files, nextQuery] = await bucket.getFiles(pageQuery);

    for (const file of files) {
        if (file.name.endsWith('/')) continue; // folder placeholder
        scanned++;

        const created = Date.parse(file.metadata.timeCreated);
        if (!Number.isFinite(created) || created >= cutoff) continue;

        if (protectedPaths.has(file.name)) {
            skippedPending++;
            continue;
        }

        toDelete.push({
            file,
            created: new Date(created),
            size: Number(file.metadata.size) || 0
        });
    }

    pageQuery = nextQuery;
}

const totalMb = (toDelete.reduce((sum, item) => sum + item.size, 0) / (1024 * 1024)).toFixed(1);

for (const { file, created } of toDelete) {
    console.log(`${created.toISOString().slice(0, 10)}  ${file.name}`);
}

console.log(
    `\n${scanned} comprobantes revisados · ${toDelete.length} con más de ${days} días (${totalMb} MB)` +
    ` · ${skippedPending} saltados por reserva pendiente.`
);

if (!confirm) {
    console.log('Dry run: no se borró nada. Volvé a correrlo con --confirm para borrarlos.');
    process.exit(0);
}

/* ---------- delete ---------- */

let deleted = 0;
const deletedPaths = [];

for (const { file } of toDelete) {
    try {
        await file.delete({ ignoreNotFound: true });
        deleted++;
        deletedPaths.push(file.name);
    } catch (error) {
        console.error(`No se pudo borrar ${file.name}: ${error.message}`);
    }
}

/* ---------- mark the reservations that pointed at them ---------- */

let marked = 0;

// Firestore 'in' queries accept at most 30 values.
for (let i = 0; i < deletedPaths.length; i += 30) {
    const chunk = deletedPaths.slice(i, i + 30);

    const snapshot = await adminDb
        .collection('reservations')
        .where('proof.path', 'in', chunk)
        .get();

    if (snapshot.empty) continue;

    const batch = adminDb.batch();

    snapshot.docs.forEach((doc) => {
        batch.update(doc.ref, { 'proof.deletedAt': FieldValue.serverTimestamp() });
    });

    await batch.commit();
    marked += snapshot.size;
}

console.log(`Listo: ${deleted} de ${toDelete.length} comprobantes borrados · ${marked} reservas marcadas.`);
