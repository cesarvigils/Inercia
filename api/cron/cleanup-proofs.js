/*
 * GET /api/cron/cleanup-proofs
 *
 * Daily Vercel Cron job (schedule in vercel.json "crons"): deletes bank-
 * transfer proofs older than 60 days from Firebase Storage. All the logic
 * and safety rules (pending reservations are never touched, etc.) live in
 * api/_lib/proof-cleanup.js.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron calls
 * when the CRON_SECRET environment variable is set. Without CRON_SECRET this
 * route refuses every request, so it can never be triggered by the public.
 *
 * Optional env: PROOF_MAX_AGE_DAYS (default 60).
 */

import { json, method, fail } from '../_lib/http.js';
import { cleanupProofs, DEFAULT_PROOF_MAX_AGE_DAYS } from '../_lib/proof-cleanup.js';

function authorized(req) {
    const secret = process.env.CRON_SECRET;

    if (!secret) return false;

    return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
    if (!method(req, res, ['GET'])) return;

    if (!authorized(req)) {
        return json(res, 401, { error: 'No autorizado.' });
    }

    try {
        const days = Number(process.env.PROOF_MAX_AGE_DAYS) || DEFAULT_PROOF_MAX_AGE_DAYS;
        const summary = await cleanupProofs({ days, log: (line) => console.log('[CRON PROOFS]', line) });

        console.log('[CRON PROOFS] Resumen:', JSON.stringify(summary));

        return json(res, 200, { ok: true, ...summary });
    } catch (error) {
        return fail(res, error);
    }
}
