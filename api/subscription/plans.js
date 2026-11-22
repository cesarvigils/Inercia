/*
 * GET /api/subscription/plans
 *
 * Public list of the membership plans the subscription page offers: every
 * plan in PAYPAL_MEMBERSHIP_PLAN_ID that PayPal reports as ACTIVE, with its
 * tier, billing period and price as PayPal has them (see
 * api/_lib/membership-plans.js). Nothing here is typed by hand, so a price
 * change in PayPal shows up without a deploy.
 *
 * PayPal bills the plans in USD (it doesn't support HNL), but the page shows
 * prices in lempiras: `priceHNL` is the USD price converted with the same
 * HNL-per-USD rate reservations use (settings/payments, or
 * PAYPAL_HNL_USD_RATE), rounded to whole lempiras. It's null when no rate is
 * configured, and the page then falls back to the USD price.
 *
 * Response: {
 *   plans: [{ id, name, tier, period, price: { value, currency }, priceHNL }],
 *   hnlPerUsd
 * }
 */

import { method, json, fail, rateLimit } from '../_lib/http.js';
import { listPlans, priceInHnl } from '../_lib/membership-plans.js';
import { getDisplayRate } from '../_lib/paypal.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;
        if (!rateLimit(req, res, { limit: 30, windowMs: 60_000 })) return;

        const [plans, hnlPerUsd] = await Promise.all([listPlans(), getDisplayRate()]);

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
        return json(res, 200, {
            plans: plans.map(({ id, name, tier, period, price }) => ({
                id,
                name,
                tier,
                period,
                price,
                priceHNL: priceInHnl(price, hnlPerUsd)
            })),
            hnlPerUsd
        });
    } catch (error) {
        return fail(res, error);
    }
}
