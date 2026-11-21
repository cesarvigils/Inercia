/*
 * GET /api/reservations/mine
 *
 * Returns the signed-in user's own reservations (most recent 50, newest
 * first), for MIS RESERVAS in the profile (js/profile/reservations.js).
 * Requires a valid Firebase auth token (requireUser); only the caller's own
 * reservations (filtered by uid).
 *
 * The query is a plain `uid ==` filter, sorted here in code. Adding
 * `.orderBy('createdAt')` to it would need a Firestore composite index
 * (uid + createdAt) that this project doesn't define, and without it the
 * query fails, so MIS RESERVAS never loaded. One person's reservations are
 * few enough to sort in memory.
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';

const LIMIT = 50;

function createdMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `mine:${user.uid}`, limit: 20, windowMs: 60_000 })) return;

        const snapshot = await adminDb
            .collection('reservations')
            .where('uid', '==', user.uid)
            .get();

        const reservations = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .sort((a, b) => createdMillis(b.createdAt) - createdMillis(a.createdAt))
            .slice(0, LIMIT);

        return json(res, 200, { reservations });
    } catch (error) {
        return fail(res, error);
    }
}
