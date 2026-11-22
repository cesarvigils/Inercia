/*
 * POST /api/subscription/upgrade
 *
 * "MEJORAR SUSCRIPCIÓN" on /suscripcion: moves the caller's existing PayPal
 * subscription to a higher tier (Gold -> Platino -> Zafiro), any billing
 * period. It's PayPal's subscription revise
 * (POST /v1/billing/subscriptions/{id}/revise with the new plan_id), which
 * the buyer has to approve in PayPal: this returns `approveUrl` and the page
 * sends them there. No second subscription is created, so nobody is billed
 * twice.
 *
 * PayPal sends the buyer back to SITE_URL/suscripcion?membresia=mejorada
 * (or =mejora-cancelada). The page then calls POST /api/subscription/activate,
 * which re-reads the subscription from PayPal (syncSubscription) and records
 * the new plan; the BILLING.SUBSCRIPTION.UPDATED webhook does the same if the
 * page never gets the chance. Nothing is recorded here.
 *
 * Billing of the new price is up to PayPal's revise rules (the subscription
 * keeps its billing date); check it in the PayPal sandbox.
 *
 * Body: { planId } — one of PAYPAL_MEMBERSHIP_PLAN_ID, of a higher tier
 * than the current one.
 *
 * Response 200: { approveUrl, planId }
 * 409 when there's no active PayPal membership to upgrade (none, cancelled,
 * or one granted by hand without a PayPal subscription).
 */

import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { paypalRequest, assertPaypalEnabled } from '../_lib/paypal.js';
import { bad } from '../_lib/reservations.js';
import { membershipPlanIds, getMembership } from '../_lib/membership.js';
import { getPlan, MEMBERSHIP_TIERS } from '../_lib/membership-plans.js';

function returnUrls() {
    const site = String(process.env.SITE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(site)) return {};
    return {
        return_url: `${site}/suscripcion?membresia=mejorada`,
        cancel_url: `${site}/suscripcion?membresia=mejora-cancelada`
    };
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);

        if (!rateLimit(req, res, { key: `subscription-upgrade:${user.uid}`, limit: 5, windowMs: 60_000 })) return;

        const planId = String(req.body?.planId || '').trim();
        if (!membershipPlanIds().includes(planId)) {
            throw bad('Ese plan de membresía no existe.');
        }

        const membership = await getMembership(user.uid);

        if (!membership || membership.status !== 'ACTIVE') {
            throw bad('Necesitás una membresía activa para mejorarla.', 409);
        }
        if (!membership.subscriptionId) {
            throw bad('Tu membresía no está asociada a PayPal; escribinos para cambiarla.', 409);
        }
        if (membership.planId === planId) {
            throw bad('Ya tenés ese plan.', 409);
        }

        const [current, target] = await Promise.all([getPlan(membership.planId), getPlan(planId)]);

        if (!target?.tier) {
            throw bad('No pudimos leer ese plan en PayPal. Probá de nuevo en un rato.', 503);
        }
        if (current?.tier && MEMBERSHIP_TIERS.indexOf(target.tier) <= MEMBERSHIP_TIERS.indexOf(current.tier)) {
            throw bad(`Solo podés mejorar a un nivel mayor que ${current.tier}.`, 409);
        }

        await assertPaypalEnabled();

        const revision = await paypalRequest(
            `/v1/billing/subscriptions/${encodeURIComponent(membership.subscriptionId)}/revise`,
            {
                method: 'POST',
                body: JSON.stringify({
                    plan_id: planId,
                    application_context: {
                        brand_name: 'Simuladores Inercia',
                        shipping_preference: 'NO_SHIPPING',
                        ...returnUrls()
                    }
                })
            }
        );

        const approveUrl =
            (revision?.links || []).find((link) => link.rel === 'approve')?.href || null;

        if (!approveUrl) {
            throw new Error('PayPal no devolvió el enlace para aprobar la mejora.');
        }

        return json(res, 200, { approveUrl, planId });
    } catch (error) {
        return fail(res, error);
    }
}
