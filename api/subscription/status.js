/*
 * GET /api/subscription/status
 *
 * Whether the signed-in user has an active membership, which is what
 * unlocks the cash ("efectivo") payment option. js/reservas.js's
 * loadPaymentAccess() calls this on login and only reads `active`.
 *
 * Reads the memberships/{uid} copy kept in sync by the PayPal webhook (see
 * api/_lib/membership.js). If that copy looks stale — still ACTIVE a day
 * past its renewal date — it re-checks PayPal before answering; if PayPal
 * can't be reached, the stored copy is used as is.
 *
 * Response: { active, status, subscriptionId, nextBillingTime, paidThrough }
 *   status is PayPal's subscription status, or 'NONE' with no membership.
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import {
    getMembership,
    needsResync,
    syncSubscription,
    membershipPayload
} from '../_lib/membership.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `subscription-status:${user.uid}`, limit: 30, windowMs: 60_000 })) return;

        let membership = await getMembership(user.uid);

        if (needsResync(membership)) {
            try {
                const synced = await syncSubscription(membership.subscriptionId);
                if (synced.uid === user.uid && synced.membership) membership = synced.membership;
            } catch (error) {
                console.warn('[SUBSCRIPTION STATUS] No se pudo refrescar desde PayPal:', error.message);
            }
        }

        return json(res, 200, membershipPayload(membership));
    } catch (error) {
        return fail(res, error);
    }
}
