/*
 * POST /api/subscription/create
 *
 * First step of signing up for a membership. Creates a PayPal subscription
 * on the membership plan with custom_id = the caller's uid (that is what
 * later proves the subscription belongs to this account — see
 * api/_lib/membership.js) and returns its id for the buyer to approve.
 *
 * Works with either PayPal flow:
 *   - PayPal Buttons: return `subscriptionID` from createSubscription.
 *   - Redirect: send the buyer to `approveUrl`. PayPal sends them back to
 *     SITE_URL/reservas?membresia=aprobada (or =cancelada) when SITE_URL is
 *     set.
 * Either way, the browser then calls POST /api/subscription/activate; if it
 * never does, the BILLING.SUBSCRIPTION.ACTIVATED webhook records it.
 *
 * Response 201: { subscriptionID, approveUrl, status }
 * 409 if the caller already has an active membership.
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { paypalRequest, assertPaypalEnabled } from '../_lib/paypal.js';
import { bad } from '../_lib/reservations.js';
import {
    membershipPlanIds,
    getMembership,
    isMembershipActive
} from '../_lib/membership.js';

function returnUrls() {
    const site = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(site)) return {};
    return {
        return_url: `${site}/reservas?membresia=aprobada`,
        cancel_url: `${site}/reservas?membresia=cancelada`
    };
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `subscription-create:${user.uid}`, limit: 5, windowMs: 60_000 })) return;

        const [planId] = membershipPlanIds();
        await assertPaypalEnabled();

        const existing = await getMembership(user.uid);
        if (isMembershipActive(existing)) {
            throw bad('Ya tenés una membresía activa.', 409);
        }

        const profileDoc = await adminDb.doc(`users/${user.uid}`).get();
        const profile = profileDoc.exists ? profileDoc.data() || {} : {};
        const email = String(profile.email || user.email || '').trim().toLowerCase();
        const [givenName, ...rest] = String(profile.name || user.name || '').trim().split(/\s+/);

        const subscription = await paypalRequest('/v1/billing/subscriptions', {
            method: 'POST',
            body: JSON.stringify({
                plan_id: planId,
                custom_id: user.uid,
                ...(email || givenName
                    ? {
                        subscriber: {
                            ...(givenName
                                ? { name: { given_name: givenName, ...(rest.length ? { surname: rest.join(' ') } : {}) } }
                                : {}),
                            ...(email ? { email_address: email } : {})
                        }
                    }
                    : {}),
                application_context: {
                    brand_name: 'Simuladores Inercia',
                    shipping_preference: 'NO_SHIPPING',
                    user_action: 'SUBSCRIBE_NOW',
                    ...returnUrls()
                }
            })
        });

        if (!subscription?.id) {
            throw new Error('PayPal no creó la suscripción correctamente.');
        }

        const approveUrl =
            (subscription.links || []).find((link) => link.rel === 'approve')?.href || null;

        return json(res, 201, {
            subscriptionID: subscription.id,
            approveUrl,
            status: subscription.status || null
        });
    } catch (error) {
        return fail(res, error);
    }
}
