// scripts/cleanup-proofs.mjs
//
// Manual run of the bank-transfer proof cleanup. The same cleanup also runs
// automatically every day via Vercel Cron (api/cron/cleanup-proofs.js); this
// script is for a dry run or a one-off with a different age. The logic and
// safety rules live in api/_lib/proof-cleanup.js.
//
//   npm run cleanup:comprobantes                       -> dry run: only lists what would be deleted
//   npm run cleanup:comprobantes -- --confirm          -> actually deletes
//   npm run cleanup:comprobantes -- --days=90 --confirm
//
// Defaults to 60 days (~2 months). Deletion is permanent — always look at the dry run first.
//
// Needs the same FIREBASE_* variables as the API (see .env.example), including
// FIREBASE_STORAGE_BUCKET. They're read from .env if present.

import 'dotenv/config';
import { cleanupProofs, DEFAULT_PROOF_MAX_AGE_DAYS } from '../api/_lib/proof-cleanup.js';

const confirm = process.argv.includes('--confirm');
const daysArg = process.argv.find((arg) => arg.startsWith('--days='));
const days = daysArg ? Number(daysArg.split('=')[1]) : DEFAULT_PROOF_MAX_AGE_DAYS;

let summary;

try {
    summary = await cleanupProofs({ days, dryRun: !confirm, log: (line) => console.log(line) });
} catch (error) {
    console.error(error.message);
    process.exit(1);
}

const totalMb = (summary.bytes / (1024 * 1024)).toFixed(1);

console.log(
    `\n${summary.scanned} comprobantes revisados · ${summary.found} con más de ${days} días (${totalMb} MB)` +
    ` · ${summary.skippedPending} saltados por reserva pendiente.`
);

if (!confirm) {
    console.log('Dry run: no se borró nada. Volvé a correrlo con --confirm para borrarlos.');
    process.exit(0);
}

console.log(`Listo: ${summary.deleted} de ${summary.found} comprobantes borrados · ${summary.marked} reservas marcadas.`);
