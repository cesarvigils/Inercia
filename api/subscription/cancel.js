/*
 * POST /api/subscription/cancel
 *
 * Cancels the signed-in user's membership in PayPal, so it won't renew.
 * Cash payment stays available until the end of the period already paid
 * for (see isMembershipActive in api/_lib/membership.js).
 * Body (optional): { reason }.
 *
 * Response: same shape as GET /api/subscription/status.
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { paypalRequest } from '../_lib/paypal.js';
import { bad } from '../_lib/reservations.js';
import {
    getMembership,
    syncSubscription,
    membershipPayload
} from '../_lib/membership.js';

const CANCELLABLE = new Set(['ACTIVE', 'SUSPENDED']);

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `subscription-cancel:${user.uid}`, limit: 5, windowMs: 60_000 })) return;

        const membership = await getMembership(user.uid);
        if (!membership?.subscriptionId || !CANCELLABLE.has(membership.status)) {
            throw bad('No tenés una membresía activa para cancelar.', 409);
        }

        const reason =
            String(req.body?.reason || '').trim().slice(0, 120) ||
            'Cancelada por el cliente desde el sitio.';

        await paypalRequest(
            `/v1/billing/subscriptions/${encodeURIComponent(membership.subscriptionId)}/cancel`,
            { method: 'POST', body: JSON.stringify({ reason }) }
        );

        const synced = await syncSubscription(membership.subscriptionId, {
            expectedUid: user.uid
        });

        return json(res, 200, membershipPayload(synced.membership));
    } catch (error) {
        return fail(res, error);
    }
}
