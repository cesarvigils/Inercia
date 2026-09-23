// Unit tests for the pure membership rules in api/_lib/membership.js: which
// stored memberships unlock cash payment, how a PayPal subscription maps to
// the memberships/{uid} document, and when the status endpoint should
// re-check PayPal. The endpoints built on these are covered end to end in
// tests/subscription-endpoints.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isMembershipActive,
  membershipFromPaypal,
  membershipPayload,
  membershipPlanIds,
  needsResync
} from '../api/_lib/membership.js';

const NOW = Date.parse('2026-09-23T15:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test('isMembershipActive: ACTIVE unlocks cash, no membership does not', () => {
  assert.equal(isMembershipActive(null, NOW), false);
  assert.equal(isMembershipActive({ status: 'ACTIVE' }, NOW), true);
});

test('isMembershipActive: a cancelled membership keeps access until the paid period ends', () => {
  assert.equal(isMembershipActive({ status: 'CANCELLED', paidThrough: iso(NOW + DAY) }, NOW), true);
  assert.equal(isMembershipActive({ status: 'CANCELLED', paidThrough: iso(NOW - 1) }, NOW), false);
  assert.equal(isMembershipActive({ status: 'CANCELLED', paidThrough: null }, NOW), false);
});

test('isMembershipActive: suspended, expired and not-yet-approved subscriptions do not unlock cash', () => {
  for (const status of ['SUSPENDED', 'EXPIRED', 'APPROVAL_PENDING', 'APPROVED']) {
    assert.equal(
      isMembershipActive({ status, paidThrough: iso(NOW + DAY) }, NOW),
      false,
      status
    );
  }
});

const subscription = {
  id: 'I-ABC123DEF456',
  plan_id: 'P-NEW',
  status: 'ACTIVE',
  custom_id: 'uid-1',
  start_time: '2026-09-01T00:00:00Z',
  status_update_time: '2026-09-01T00:01:00Z',
  subscriber: { payer_id: 'PAYER1', email_address: 'a@b.hn' },
  billing_info: {
    next_billing_time: '2026-10-01T10:00:00Z',
    failed_payments_count: 0,
    last_payment: { amount: { currency_code: 'USD', value: '10.00' }, time: '2026-09-01T10:00:00Z' }
  }
};

test('membershipFromPaypal: maps the PayPal subscription and uses next_billing_time as paidThrough', () => {
  assert.deepEqual(membershipFromPaypal(subscription), {
    source: 'paypal',
    subscriptionId: 'I-ABC123DEF456',
    planId: 'P-NEW',
    status: 'ACTIVE',
    payerId: 'PAYER1',
    payerEmail: 'a@b.hn',
    startTime: '2026-09-01T00:00:00Z',
    statusUpdateTime: '2026-09-01T00:01:00Z',
    nextBillingTime: '2026-10-01T10:00:00Z',
    paidThrough: '2026-10-01T10:00:00Z',
    lastPaymentAt: '2026-09-01T10:00:00Z',
    lastPaymentAmount: { value: '10.00', currency: 'USD' },
    failedPayments: 0
  });
});

test('membershipFromPaypal: a cancelled subscription keeps the paid period from its own last sync only', () => {
  const cancelled = { ...subscription, status: 'CANCELLED', billing_info: { failed_payments_count: 0 } };

  const sameSub = membershipFromPaypal(cancelled, { subscriptionId: 'I-ABC123DEF456', paidThrough: '2026-10-01T10:00:00Z' });
  assert.equal(sameSub.paidThrough, '2026-10-01T10:00:00Z');
  assert.equal(sameSub.nextBillingTime, null);

  const otherSub = membershipFromPaypal(cancelled, { subscriptionId: 'I-OTHER0000001', paidThrough: '2027-01-01T00:00:00Z' });
  assert.equal(otherSub.paidThrough, null);
});

test('membershipPayload: the browser gets `active` plus a few display fields, nothing else', () => {
  assert.deepEqual(membershipPayload(null, NOW), {
    active: false,
    status: 'NONE',
    subscriptionId: null,
    nextBillingTime: null,
    paidThrough: null
  });

  const cancelled = { status: 'CANCELLED', subscriptionId: 'I-X', nextBillingTime: 'stale', paidThrough: iso(NOW + DAY), payerEmail: 'a@b.hn' };
  assert.deepEqual(membershipPayload(cancelled, NOW), {
    active: true,
    status: 'CANCELLED',
    subscriptionId: 'I-X',
    nextBillingTime: null,
    paidThrough: iso(NOW + DAY)
  });
});

test('membershipPlanIds: parses the comma-separated list; none is a 503', () => {
  const original = process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
  try {
    process.env.PAYPAL_MEMBERSHIP_PLAN_ID = ' P-NEW , P-OLD ,';
    assert.deepEqual(membershipPlanIds(), ['P-NEW', 'P-OLD']);

    delete process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
    assert.throws(() => membershipPlanIds(), (error) => error.status === 503);
  } finally {
    if (original === undefined) delete process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
    else process.env.PAYPAL_MEMBERSHIP_PLAN_ID = original;
  }
});

test('needsResync: only an ACTIVE copy a day past its renewal date, at most hourly', () => {
  const overdue = { status: 'ACTIVE', subscriptionId: 'I-X', nextBillingTime: iso(NOW - 2 * DAY), syncedAtMs: NOW - 2 * DAY };
  assert.equal(needsResync(overdue, NOW), true);

  assert.equal(needsResync({ ...overdue, nextBillingTime: iso(NOW - DAY / 2) }, NOW), false, 'inside the grace period');
  assert.equal(needsResync({ ...overdue, syncedAtMs: NOW - 10 * 60 * 1000 }, NOW), false, 'synced 10 minutes ago');
  assert.equal(needsResync({ ...overdue, status: 'CANCELLED' }, NOW), false);
  assert.equal(needsResync({ ...overdue, nextBillingTime: null }, NOW), false);
  assert.equal(needsResync(null, NOW), false);
});
