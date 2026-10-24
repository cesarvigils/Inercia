/*
 * api/_lib/membership-plans.js
 *
 * Membership tiers and billing periods, read from the PayPal plans
 * themselves instead of a hand-kept table.
 *
 * There are three paid tiers, Gold, Platino and Zafiro, each sold monthly,
 * every 3 months (trimestral), every 6 months (semestral) or yearly
 * (anual). An account with no active membership is "Nula". The tier comes
 * from the plan's name in PayPal ("Plan Gold 3", "Plan Platino Anual"...)
 * and the period from its billing cycle, so the 12 ids in
 * PAYPAL_MEMBERSHIP_PLAN_ID only need to be listed, not labelled.
 *
 * Exports:
 *   - MEMBERSHIP_TIERS            ['Nula', 'Gold', 'Platino', 'Zafiro'].
 *   - tierFromPlanName(name)      'Gold' | 'Platino' | 'Zafiro' | null.
 *   - billingPeriod(plan)         'mensual' | 'trimestral' | 'semestral' |
 *                                 'anual' | null, from the REGULAR cycle.
 *   - planSummary(plan)           PayPal plan -> public { id, name, tier,
 *                                 period, price }.
 *   - getPlan(id)                 One plan (cached), or null if PayPal
 *                                 can't return it.
 *   - listPlans()                 Every configured plan PayPal returns as
 *                                 ACTIVE with a known tier, sorted by tier
 *                                 then period.
 *   - membershipTier(m, plan)     The tier to show for a memberships/{uid}
 *                                 doc: 'Nula' when it grants no access,
 *                                 else its plan's tier, or null when the
 *                                 plan's tier can't be read (PayPal down,
 *                                 or a plan name without Gold / Platino /
 *                                 Zafiro). null is never shown as Nula, so
 *                                 a paying member isn't told they have none.
 */

import { paypalRequest } from './paypal.js';
import { membershipPlanIds, isMembershipActive } from './membership.js';

export const MEMBERSHIP_TIERS = ['Nula', 'Gold', 'Platino', 'Zafiro'];

const PAID_TIERS = MEMBERSHIP_TIERS.slice(1);
const PERIOD_ORDER = ['mensual', 'trimestral', 'semestral', 'anual'];

// Plans change rarely (a price change makes a new plan id), so an hour of
// caching per warm function instance keeps the profile and the
// subscription page from calling PayPal on every view.
const PLAN_TTL_MS = 60 * 60 * 1000;
const planCache = new Map();

export function tierFromPlanName(name) {
    const text = String(name || '');

    // Checked most expensive first; a name only ever carries one of them.
    for (const tier of [...PAID_TIERS].reverse()) {
        if (new RegExp(`\\b${tier}\\b`, 'i').test(text)) return tier;
    }

    return null;
}

export function billingPeriod(plan) {
    const cycles = Array.isArray(plan?.billing_cycles) ? plan.billing_cycles : [];
    const regular = cycles.find((cycle) => cycle.tenure_type === 'REGULAR') || cycles[0];
    const unit = String(regular?.frequency?.interval_unit || '').toUpperCase();
    const count = Number(regular?.frequency?.interval_count || 1);

    if (unit === 'YEAR' && count === 1) return 'anual';
    if (unit === 'MONTH' && count === 12) return 'anual';
    if (unit === 'MONTH' && count === 6) return 'semestral';
    if (unit === 'MONTH' && count === 3) return 'trimestral';
    if (unit === 'MONTH' && count === 1) return 'mensual';

    return null;
}

function regularPrice(plan) {
    const cycles = Array.isArray(plan?.billing_cycles) ? plan.billing_cycles : [];
    const regular = cycles.find((cycle) => cycle.tenure_type === 'REGULAR') || cycles[0];
    const price = regular?.pricing_scheme?.fixed_price;

    return price?.value
        ? { value: String(price.value), currency: price.currency_code || 'USD' }
        : null;
}

export function planSummary(plan) {
    return {
        id: plan.id,
        name: plan.name || null,
        status: plan.status || null,
        tier: tierFromPlanName(plan.name),
        period: billingPeriod(plan),
        price: regularPrice(plan)
    };
}

export async function getPlan(planId, now = Date.now()) {
    const id = String(planId || '').trim();
    if (!/^P-[A-Z0-9]{10,40}$/.test(id)) return null;

    const hit = planCache.get(id);
    if (hit && now - hit.at < PLAN_TTL_MS) return hit.plan;

    try {
        const plan = planSummary(
            await paypalRequest(`/v1/billing/plans/${id}`, { method: 'GET' })
        );
        planCache.set(id, { plan, at: now });
        return plan;
    } catch (error) {
        console.warn('[MEMBERSHIP PLANS] No se pudo leer el plan', id, error.message);
        // A stale copy beats nothing while PayPal is unreachable.
        return hit ? hit.plan : null;
    }
}

export async function listPlans() {
    const plans = await Promise.all(membershipPlanIds().map((id) => getPlan(id)));

    return plans
        .filter((plan) => plan && plan.status === 'ACTIVE' && plan.tier && plan.period)
        .sort((a, b) =>
            PAID_TIERS.indexOf(a.tier) - PAID_TIERS.indexOf(b.tier) ||
            PERIOD_ORDER.indexOf(a.period) - PERIOD_ORDER.indexOf(b.period)
        );
}

export function membershipTier(membership, plan, now = Date.now()) {
    if (!isMembershipActive(membership, now)) return 'Nula';
    return plan?.tier || null;
}

export function clearPlanCache() {
    planCache.clear();
}
