/*
 * GET /api/paypal/client-config
 *
 * Public (no auth required) endpoint the frontend calls to bootstrap the
 * PayPal Buttons SDK: it needs the PayPal client id and current
 * HNL-per-USD exchange rate before it can render the checkout button.
 * This is the safe way to expose the client id to the browser without
 * hardcoding it in frontend source — the client secret never leaves the
 * server (see api/_lib/paypal.js).
 */

import { method, json, fail } from '../_lib/http.js';
import { paypalClientId, getPaypalRate } from '../_lib/paypal.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;

        const rate = await getPaypalRate();

        return json(res, 200, {
            clientId: paypalClientId(),
            currency: 'USD',
            environment: String(process.env.PAYPAL_ENV || 'sandbox').toLowerCase(),
            hnlPerUsd: rate
        });
    } catch (error) {
        return fail(res, error);
    }
}
