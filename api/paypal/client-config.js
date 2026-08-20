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
