/*
 * POST /api/subscription/activate
 *
 * Called by the browser right after the buyer approves the subscription in
 * PayPal. Body: { subscriptionID }.
 *
 * Nothing from the browser is trusted beyond the id itself: the
 * subscription is re-read from PayPal, and it must be on the membership
 * plan and carry this user's uid as custom_id (set by
 * api/subscription/create.js), or it is rejected. PayPal usually reports
 * ACTIVE immediately after approval; if it still says APPROVED, it is saved
 * as such and the BILLING.SUBSCRIPTION.ACTIVATED webhook finishes the job.
 *
 * Response: same shape as GET /api/subscription/status.
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { syncSubscription, membershipPayload } from '../_lib/membership.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `subscription-activate:${user.uid}`, limit: 10, windowMs: 60_000 })) return;

        const { membership } = await syncSubscription(req.body?.subscriptionID, {
            expectedUid: user.uid
        });

        return json(res, 200, membershipPayload(membership));
    } catch (error) {
        return fail(res, error);
    }
}
