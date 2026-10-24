/*
 * GET /api/subscription/plans
 *
 * Public list of the membership plans the subscription page offers: every
 * plan in PAYPAL_MEMBERSHIP_PLAN_ID that PayPal reports as ACTIVE, with its
 * tier, billing period and price as PayPal has them (see
 * api/_lib/membership-plans.js). Nothing here is typed by hand, so a price
 * change in PayPal shows up without a deploy.
 *
 * Response: { plans: [{ id, name, tier, period, price: { value, currency } }] }
 * 503 when no plan is configured.
 */

import { method, json, fail, rateLimit } from '../_lib/http.js';
import { listPlans } from '../_lib/membership-plans.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;
        if (!rateLimit(req, res, { limit: 30, windowMs: 60_000 })) return;

        const plans = await listPlans();

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
        return json(res, 200, {
            plans: plans.map(({ id, name, tier, period, price }) => ({ id, name, tier, period, price }))
        });
    } catch (error) {
        return fail(res, error);
    }
}
