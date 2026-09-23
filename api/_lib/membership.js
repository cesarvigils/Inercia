/*
 * api/_lib/membership.js
 *
 * Membership ("membresía") backed by a PayPal subscription. An active
 * membership is what unlocks paying in cash ("efectivo") on the booking
 * page: js/reservas.js asks GET /api/subscription/status, and
 * api/reservations/create.js re-checks it server-side before accepting an
 * 'efectivo' booking, so the browser flag is never trusted on its own.
 *
 * Source of truth: PayPal. Firestore keeps a copy in memberships/{uid} so
 * the status check is one document read instead of a PayPal round trip.
 * The copy is refreshed by:
 *   - api/subscription/activate.js, right after the buyer approves;
 *   - api/paypal/webhook.js, on every BILLING.SUBSCRIPTION.* event and on
 *     each renewal payment (PAYMENT.SALE.COMPLETED);
 *   - api/subscription/status.js, as a fallback, when the copy says ACTIVE
 *     but its renewal date passed without a webhook arriving.
 * Every refresh re-reads the subscription from PayPal (syncSubscription)
 * rather than trusting a webhook payload or a browser-sent id, so events
 * arriving out of order can't leave a stale status behind.
 *
 * Binding a subscription to a user: api/subscription/create.js sets the
 * subscription's `custom_id` to the Firebase uid. Nothing else ties a
 * PayPal subscription to an account, so a subscription id without the
 * caller's uid in custom_id is rejected (otherwise anyone could claim
 * someone else's subscription id).
 *
 * Environment:
 *   PAYPAL_MEMBERSHIP_PLAN_ID  PayPal billing plan id(s) (P-...). The first
 *                              one is used for new subscriptions; any
 *                              others (comma separated) are still accepted
 *                              for existing subscribers, so a price change
 *                              (a new plan) doesn't cut off current members.
 *
 * Exports:
 *   - membershipPlanIds()          Configured plan ids (throws 503 if none).
 *   - isMembershipActive(m, now)   Whether a memberships/{uid} doc grants
 *                                  cash payment right now.
 *   - membershipFromPaypal(sub)    PayPal subscription -> Firestore fields.
 *   - membershipPayload(m)         Public shape returned to the browser.
 *   - getMembership(uid)           Reads memberships/{uid} (or null).
 *   - fetchSubscription(id)        GET the subscription from PayPal.
 *   - syncSubscription(id, opts)   Fetch from PayPal, validate, save.
 *   - needsResync(m, now)          Whether status.js should re-check PayPal.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.js';
import { paypalRequest } from './paypal.js';
import { bad } from './reservations.js';

// Subscription statuses, as PayPal reports them:
// APPROVAL_PENDING -> APPROVED -> ACTIVE <-> SUSPENDED -> CANCELLED / EXPIRED
const ACTIVE = 'ACTIVE';
const CANCELLED = 'CANCELLED';

// How long after a missed renewal date status.js waits before asking
// PayPal directly, and how often it may ask for the same membership.
const RENEWAL_GRACE_MS = 24 * 60 * 60 * 1000;
const RESYNC_INTERVAL_MS = 60 * 60 * 1000;

export function membershipPlanIds() {
    const ids = String(process.env.PAYPAL_MEMBERSHIP_PLAN_ID || '')
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);

    if (ids.length === 0) {
        throw bad('La membresía todavía no está disponible.', 503);
    }

    return ids;
}

function time(value) {
    const ms = Date.parse(value || '');
    return Number.isFinite(ms) ? ms : null;
}

/*
 * ACTIVE grants access. A CANCELLED membership keeps access until the end
 * of the period it already paid for (paidThrough), the same way cancelling
 * any subscription works. SUSPENDED (PayPal gave up retrying a failed
 * payment), EXPIRED and anything not yet approved do not.
 */
export function isMembershipActive(membership, now = Date.now()) {
    if (!membership) return false;
    if (membership.status === ACTIVE) return true;

    if (membership.status === CANCELLED) {
        const paidThrough = time(membership.paidThrough);
        return paidThrough !== null && paidThrough > now;
    }

    return false;
}

export function membershipFromPaypal(subscription, previous = null) {
    const billing = subscription.billing_info || {};
    const lastPayment = billing.last_payment || null;

    // PayPal drops next_billing_time once a subscription is cancelled, so
    // the end of the paid period is carried over from the last sync of the
    // SAME subscription. A different subscription never inherits it.
    const carried =
        previous && previous.subscriptionId === subscription.id
            ? previous.paidThrough || null
            : null;

    return {
        source: 'paypal',
        subscriptionId: subscription.id,
        planId: subscription.plan_id || null,
        status: String(subscription.status || '').toUpperCase() || null,
        payerId: subscription.subscriber?.payer_id || null,
        payerEmail: subscription.subscriber?.email_address || null,
        startTime: subscription.start_time || null,
        statusUpdateTime: subscription.status_update_time || null,
        nextBillingTime: billing.next_billing_time || null,
        paidThrough: billing.next_billing_time || carried,
        lastPaymentAt: lastPayment?.time || null,
        lastPaymentAmount: lastPayment?.amount
            ? {
                value: lastPayment.amount.value,
                currency: lastPayment.amount.currency_code
            }
            : null,
        failedPayments: Number(billing.failed_payments_count || 0)
    };
}

export function membershipPayload(membership, now = Date.now()) {
    return {
        active: isMembershipActive(membership, now),
        status: membership?.status || 'NONE',
        subscriptionId: membership?.subscriptionId || null,
        nextBillingTime:
            membership?.status === ACTIVE ? membership.nextBillingTime || null : null,
        paidThrough: membership?.paidThrough || null
    };
}

export async function getMembership(uid) {
    const snapshot = await adminDb.doc(`memberships/${uid}`).get();
    return snapshot.exists ? { ...snapshot.data() } : null;
}

export async function fetchSubscription(subscriptionId) {
    const id = String(subscriptionId || '').trim();

    // PayPal subscription ids look like I-XXXXXXXXXXXX. Checking the shape
    // keeps arbitrary strings out of the PayPal URL.
    if (!/^I-[A-Z0-9]{6,40}$/.test(id)) {
        throw bad('Suscripción de PayPal inválida.');
    }

    return paypalRequest(`/v1/billing/subscriptions/${id}`, { method: 'GET' });
}

/*
 * Re-reads a subscription from PayPal and saves it to memberships/{uid},
 * where uid is the subscription's custom_id.
 *
 * opts.expectedUid  When set (a signed-in user claiming this subscription),
 *                   the subscription must belong to that uid, else 403.
 *
 * Returns { uid, membership, ignored }. `ignored` is set (and nothing is
 * written) when no plan is configured (webhook only; a user claiming a
 * subscription gets the 503), when the subscription isn't one of ours, or
 * when saving it would replace a different, still-active membership with a
 * dead one — e.g. a late CANCELLED webhook for an old subscription arriving
 * after the user already subscribed again.
 */
export async function syncSubscription(subscriptionId, opts = {}) {
    let planIds;
    try {
        planIds = membershipPlanIds();
    } catch (error) {
        // Webhooks keep arriving whether or not memberships are set up yet;
        // without a plan there is nothing of ours to record.
        if (opts.expectedUid) throw error;
        return { uid: null, membership: null, ignored: 'no_plan_configured' };
    }

    const subscription = await fetchSubscription(subscriptionId);
    const uid = String(subscription.custom_id || '').trim();

    if (opts.expectedUid && uid !== opts.expectedUid) {
        throw bad('Esta suscripción no pertenece a tu cuenta.', 403);
    }

    if (!planIds.includes(subscription.plan_id)) {
        if (opts.expectedUid) throw bad('Esta suscripción no es la membresía de Inercia.');
        return { uid: uid || null, membership: null, ignored: 'unknown_plan' };
    }

    if (!uid) {
        return { uid: null, membership: null, ignored: 'no_custom_id' };
    }

    const ref = adminDb.doc(`memberships/${uid}`);

    return adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref);
        const previous = snapshot.exists ? snapshot.data() : null;
        const next = membershipFromPaypal(subscription, previous);

        if (
            previous &&
            previous.subscriptionId !== next.subscriptionId &&
            isMembershipActive(previous) &&
            next.status !== ACTIVE
        ) {
            return { uid, membership: previous, ignored: 'older_subscription' };
        }

        const data = {
            uid,
            ...next,
            syncedAt: FieldValue.serverTimestamp(),
            syncedAtMs: Date.now(),
            updatedAt: FieldValue.serverTimestamp()
        };

        if (!previous) data.createdAt = FieldValue.serverTimestamp();

        transaction.set(ref, data, { merge: true });

        return { uid, membership: { ...previous, ...data }, ignored: null };
    });
}

/*
 * The webhook is the normal way a renewal (or a lapse) reaches us. If the
 * stored copy still says ACTIVE a day past its renewal date, a webhook was
 * probably missed, so status.js asks PayPal directly — at most once an hour
 * per membership, since PayPal can legitimately keep a subscription ACTIVE
 * with an old renewal date while it retries a failed payment.
 */
export function needsResync(membership, now = Date.now()) {
    if (!membership || membership.status !== ACTIVE || !membership.subscriptionId) return false;

    const nextBilling = time(membership.nextBillingTime);
    if (nextBilling === null || nextBilling + RENEWAL_GRACE_MS > now) return false;

    const lastSync = Number(membership.syncedAtMs || 0);
    return now - lastSync > RESYNC_INTERVAL_MS;
}
