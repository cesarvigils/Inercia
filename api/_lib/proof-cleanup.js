/*
 * api/_lib/proof-cleanup.js
 *
 * Deletes bank-transfer payment proofs ("comprobantes de pago") older than
 * N days (default 60, ~2 months) from Firebase Storage, under
 * `reservation-proofs/<uid>/...` (where js/reservas.js uploads them).
 *
 * Used by:
 *   - api/cron/cleanup-proofs.js   Vercel Cron, runs daily (vercel.json "crons").
 *   - scripts/cleanup-proofs.mjs   Manual run / dry run from a terminal.
 *
 * Safety:
 *   - Never touches a proof whose reservation is still 'pending' (an admin
 *     hasn't reviewed it yet).
 *   - Age comes from the file's own Storage creation time, not from the
 *     reservation date.
 *   - Old files with no reservation at all (upload succeeded, booking
 *     failed) are deleted too.
 *   - Reservations that pointed at a deleted file get `proof.deletedAt` set,
 *     so the admin panel can show "comprobante eliminado" instead of a broken
 *     link. `proof.path` is kept for the record.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, adminStorage } from './firebase-admin.js';

export const PROOF_PREFIX = 'reservation-proofs/';
export const DEFAULT_PROOF_MAX_AGE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_CONCURRENCY = 10;

/* Firestore 'in' queries accept at most 30 values. */
const IN_QUERY_LIMIT = 30;

async function pendingProofPaths() {
    const snapshot = await adminDb
        .collection('reservations')
        .where('status', '==', 'pending')
        .get();

    return new Set(
        snapshot.docs
            .map((doc) => doc.get('proof.path'))
            .filter(Boolean)
    );
}

async function findOldProofs(bucket, cutoff, protectedPaths) {
    const old = [];
    let scanned = 0;
    let skippedPending = 0;
    let pageQuery = { prefix: PROOF_PREFIX, maxResults: 1000, autoPaginate: false };

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

            old.push({
                file,
                created: new Date(created),
                size: Number(file.metadata.size) || 0
            });
        }

        pageQuery = nextQuery;
    }

    return { old, scanned, skippedPending };
}

async function deleteFiles(items, log) {
    const deletedPaths = [];
    let failed = 0;

    for (let i = 0; i < items.length; i += DELETE_CONCURRENCY) {
        const chunk = items.slice(i, i + DELETE_CONCURRENCY);

        const results = await Promise.allSettled(
            chunk.map(({ file }) => file.delete({ ignoreNotFound: true }))
        );

        results.forEach((result, index) => {
            const name = chunk[index].file.name;

            if (result.status === 'fulfilled') {
                deletedPaths.push(name);
            } else {
                failed++;
                log(`No se pudo borrar ${name}: ${result.reason?.message || result.reason}`);
            }
        });
    }

    return { deletedPaths, failed };
}

async function markReservations(deletedPaths) {
    let marked = 0;

    for (let i = 0; i < deletedPaths.length; i += IN_QUERY_LIMIT) {
        const chunk = deletedPaths.slice(i, i + IN_QUERY_LIMIT);

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

    return marked;
}

/*
 * cleanupProofs({ days, dryRun, log }) -> summary
 *
 *   days    Delete proofs older than this many days (default 60).
 *   dryRun  true: only find them; nothing is deleted or marked.
 *   log     Called with one line per file found / per failure (default: nothing).
 */
export async function cleanupProofs({
    days = DEFAULT_PROOF_MAX_AGE_DAYS,
    dryRun = false,
    log = () => {}
} = {}) {
    if (!Number.isFinite(days) || days < 1) {
        throw new Error('days tiene que ser un número mayor a 0.');
    }

    if (!adminStorage || !process.env.FIREBASE_STORAGE_BUCKET) {
        throw new Error('Falta FIREBASE_STORAGE_BUCKET en el entorno.');
    }

    const cutoff = Date.now() - days * DAY_MS;
    const bucket = adminStorage.bucket();

    const protectedPaths = await pendingProofPaths();
    const { old, scanned, skippedPending } = await findOldProofs(bucket, cutoff, protectedPaths);

    old.forEach(({ file, created }) => {
        log(`${created.toISOString().slice(0, 10)}  ${file.name}`);
    });

    const summary = {
        days,
        dryRun,
        scanned,
        found: old.length,
        skippedPending,
        bytes: old.reduce((sum, item) => sum + item.size, 0),
        deleted: 0,
        failed: 0,
        marked: 0
    };

    if (dryRun || old.length === 0) {
        return summary;
    }

    const { deletedPaths, failed } = await deleteFiles(old, log);

    summary.deleted = deletedPaths.length;
    summary.failed = failed;
    summary.marked = await markReservations(deletedPaths);

    return summary;
}
