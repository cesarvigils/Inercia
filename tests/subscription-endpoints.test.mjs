// End-to-end tests for membership-gated cash payment: the /api/subscription/*
// handlers, the membership events in api/paypal/webhook.js, and the
// 'efectivo' path of api/reservations/create.js, all driven against a fake
// Firestore and a stubbed PayPal API (global fetch). No network, no real
// Firebase project.
//
// Set up once per file, like tests/lockdown-enforcement.test.mjs, because
// api/_lib/*.js is imported with plain specifiers and stays bound to the
// first firebase-admin.js mock that loaded it. Each test uses its own uid so
// the in-process rate limiter never carries over between tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createFakeFirestore, createFakeReqRes, mockFirebaseAdmin } from './helpers/fake-firestore.mjs';

process.env.PAYPAL_CLIENT_ID = 'client';
process.env.PAYPAL_CLIENT_SECRET = 'secret';
process.env.PAYPAL_WEBHOOK_ID = 'webhook';
process.env.PAYPAL_MEMBERSHIP_PLAN_ID = 'P-NEW,P-OLD';
delete process.env.SITE_URL;

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

/* ---------------------------------------------------------------
   Fake PayPal
   --------------------------------------------------------------- */

const paypal = {
  subscriptions: {},
  calls: [],
  failNextGet: false
};

function paypalSubscription({ id, uid, status = 'ACTIVE', plan = 'P-NEW', next = iso(Date.now() + 20 * DAY) }) {
  return {
    id,
    plan_id: plan,
    status,
    custom_id: uid,
    subscriber: { payer_id: 'PAYER', email_address: `${uid}@example.com` },
    billing_info: {
      ...(status === 'ACTIVE' ? { next_billing_time: next } : {}),
      failed_payments_count: 0
    }
  };
}

// Just the parts of a fetch Response that api/_lib/paypal.js reads.
function reply(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
      return JSON.parse(JSON.stringify(body));
    }
  };
}

globalThis.fetch = async (url, options = {}) => {
  const { pathname } = new URL(url);
  const method = options.method || 'GET';
  if (pathname === '/v1/oauth2/token') return reply(200, { access_token: 'token' });

  const body = options.body ? JSON.parse(options.body) : null;
  paypal.calls.push({ method, pathname, body });

  if (pathname === '/v1/notifications/verify-webhook-signature') {
    return reply(200, { verification_status: 'SUCCESS' });
  }

  if (pathname === '/v1/billing/subscriptions' && method === 'POST') {
    const id = `I-NEWSUB${String(paypal.calls.length).padStart(6, '0')}`;
    paypal.subscriptions[id] = {
      ...paypalSubscription({ id, uid: body.custom_id, status: 'APPROVAL_PENDING', plan: body.plan_id })
    };
    return reply(201, {
      id,
      status: 'APPROVAL_PENDING',
      links: [{ rel: 'approve', href: `https://www.sandbox.paypal.com/webapps/billing/subscriptions?ba_token=${id}` }]
    });
  }

  const cancel = pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)\/cancel$/);
  if (cancel && method === 'POST') {
    const sub = paypal.subscriptions[cancel[1]];
    if (!sub) return reply(404, { message: 'not found' });
    sub.status = 'CANCELLED';
    delete sub.billing_info.next_billing_time;
    return reply(204);
  }

  const get = pathname.match(/^\/v1\/billing\/subscriptions\/([^/]+)$/);
  if (get && method === 'GET') {
    if (paypal.failNextGet) {
      paypal.failNextGet = false;
      return reply(500, { message: 'PayPal down' });
    }
    const sub = paypal.subscriptions[get[1]];
    return sub ? reply(200, sub) : reply(404, { message: 'RESOURCE_NOT_FOUND' });
  }

  throw new Error(`Unexpected PayPal call ${method} ${pathname}`);
};

function paypalCallsTo(pattern) {
  return paypal.calls.filter((call) => pattern.test(`${call.method} ${call.pathname}`));
}

/* ---------------------------------------------------------------
   Fake Firebase
   --------------------------------------------------------------- */

const fake = createFakeFirestore({
  memberships: [],
  users: [],
  rigs: [{ id: 'rig-1', name: 'Rig 1', type: 'standard', status: 'active', order: 1 }],
  reservations: [],
  reservationLocks: [],
  paypalWebhookEvents: []
});

mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake, {
  adminAuth: {
    // The bearer token IS the uid in these tests.
    async verifyIdToken(token) {
      if (!token.startsWith('uid-')) throw new Error('bad token');
      return { uid: token, email: `${token}@example.com` };
    }
  }
}));

const { default: statusHandler } = await import('../api/subscription/status.js');
const { default: createHandler } = await import('../api/subscription/create.js');
const { default: activateHandler } = await import('../api/subscription/activate.js');
const { default: cancelHandler } = await import('../api/subscription/cancel.js');
const { default: webhookHandler } = await import('../api/paypal/webhook.js');
const { default: reservationHandler } = await import('../api/reservations/create.js');

test.beforeEach(() => {
  paypal.calls = [];
  paypal.failNextGet = false;
});

async function call(handler, { uid, method = 'GET', body = {}, headers = {} } = {}) {
  const { req, res } = createFakeReqRes({
    method,
    body,
    headers: { ...(uid ? { authorization: `Bearer ${uid}` } : {}), ...headers }
  });
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

function seedMembership(uid, data) {
  fake.setDocs('memberships', [
    ...fake.list('memberships').filter((doc) => doc.id !== uid),
    { id: uid, uid, source: 'paypal', ...data }
  ]);
}

const webhookHeaders = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/cert',
  'paypal-transmission-id': 'tx',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': new Date().toISOString()
};

function webhook(event) {
  return call(webhookHandler, { method: 'POST', body: event, headers: webhookHeaders });
}

/* ---------------------------------------------------------------
   GET /api/subscription/status
   --------------------------------------------------------------- */

test('status: requires a signed-in user', async () => {
  const result = await call(statusHandler);
  assert.equal(result.status, 401);
});

test('status: no membership means no cash, and never a 404', async () => {
  const result = await call(statusHandler, { uid: 'uid-status-none' });
  assert.equal(result.status, 200);
  assert.equal(result.body.active, false);
  assert.equal(result.body.status, 'NONE');
  assert.equal(paypal.calls.length, 0, 'a plain status check does not call PayPal');
});

test('status: active and cancelled-but-paid memberships unlock cash; lapsed and suspended ones do not', async () => {
  const cases = [
    ['uid-status-active', { status: 'ACTIVE', subscriptionId: 'I-A00000000001', nextBillingTime: iso(Date.now() + DAY), syncedAtMs: Date.now() }, true],
    ['uid-status-paid', { status: 'CANCELLED', subscriptionId: 'I-A00000000002', paidThrough: iso(Date.now() + DAY) }, true],
    ['uid-status-lapsed', { status: 'CANCELLED', subscriptionId: 'I-A00000000003', paidThrough: iso(Date.now() - DAY) }, false],
    ['uid-status-suspended', { status: 'SUSPENDED', subscriptionId: 'I-A00000000004', paidThrough: iso(Date.now() + DAY) }, false]
  ];

  for (const [uid, data, expected] of cases) {
    seedMembership(uid, data);
    const result = await call(statusHandler, { uid });
    assert.equal(result.status, 200, uid);
    assert.equal(result.body.active, expected, uid);
  }
});

test('status: an ACTIVE copy long past its renewal date is re-checked with PayPal', async () => {
  const uid = 'uid-status-stale';
  const id = 'I-STALE0000001';
  seedMembership(uid, {
    status: 'ACTIVE',
    subscriptionId: id,
    planId: 'P-NEW',
    nextBillingTime: iso(Date.now() - 3 * DAY),
    syncedAtMs: Date.now() - 3 * DAY
  });
  paypal.subscriptions[id] = paypalSubscription({ id, uid, status: 'SUSPENDED' });

  const result = await call(statusHandler, { uid });
  assert.equal(result.body.active, false);
  assert.equal(result.body.status, 'SUSPENDED');
  assert.equal(fake.read('memberships', uid).status, 'SUSPENDED');
});

test('status: if PayPal is unreachable during a re-check, the stored copy is used', async () => {
  const uid = 'uid-status-stale-down';
  const id = 'I-STALE0000002';
  seedMembership(uid, {
    status: 'ACTIVE',
    subscriptionId: id,
    nextBillingTime: iso(Date.now() - 3 * DAY),
    syncedAtMs: 0
  });
  paypal.failNextGet = true;

  const result = await call(statusHandler, { uid });
  assert.equal(result.status, 200);
  assert.equal(result.body.active, true);
});

/* ---------------------------------------------------------------
   POST /api/subscription/create
   --------------------------------------------------------------- */

test('create: makes a PayPal subscription on the current plan, tagged with the caller uid', async () => {
  const uid = 'uid-create-ok';
  fake.setDocs('users', [{ id: uid, name: 'Ana María López', email: 'ANA@example.com' }]);

  const result = await call(createHandler, { uid, method: 'POST' });
  assert.equal(result.status, 201);
  assert.match(result.body.subscriptionID, /^I-/);
  assert.match(result.body.approveUrl, /paypal\.com/);

  const [created] = paypalCallsTo(/^POST \/v1\/billing\/subscriptions$/);
  assert.equal(created.body.plan_id, 'P-NEW');
  assert.equal(created.body.custom_id, uid);
  assert.deepEqual(created.body.subscriber, {
    name: { given_name: 'Ana', surname: 'María López' },
    email_address: 'ana@example.com'
  });
  assert.equal(created.body.application_context.shipping_preference, 'NO_SHIPPING');
  assert.equal(fake.read('memberships', uid), undefined, 'nothing is stored until the buyer approves');
});

test('create: the buyer can pick any configured plan, but not an unknown one', async () => {
  const picked = await call(createHandler, { uid: 'uid-create-pick', method: 'POST', body: { planId: 'P-OLD' } });
  assert.equal(picked.status, 201);
  assert.equal(picked.body.planId, 'P-OLD');
  assert.equal(paypalCallsTo(/^POST \/v1\/billing\/subscriptions$/)[0].body.plan_id, 'P-OLD');

  const unknown = await call(createHandler, { uid: 'uid-create-unknown', method: 'POST', body: { planId: 'P-HACKED' } });
  assert.equal(unknown.status, 400);
  assert.equal(paypalCallsTo(/^POST \/v1\/billing\/subscriptions$/).length, 1);
});

test('create: refuses when the caller is already a member', async () => {
  const uid = 'uid-create-member';
  seedMembership(uid, { status: 'ACTIVE', subscriptionId: 'I-B00000000001' });

  const result = await call(createHandler, { uid, method: 'POST' });
  assert.equal(result.status, 409);
  assert.equal(paypalCallsTo(/billing\/subscriptions/).length, 0);
});

test('create: 503 until a membership plan is configured', async () => {
  const original = process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
  delete process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
  try {
    const result = await call(createHandler, { uid: 'uid-create-noplan', method: 'POST' });
    assert.equal(result.status, 503);
    assert.equal(paypal.calls.length, 0);
  } finally {
    process.env.PAYPAL_MEMBERSHIP_PLAN_ID = original;
  }
});

/* ---------------------------------------------------------------
   POST /api/subscription/activate
   --------------------------------------------------------------- */

test('activate: saves an approved subscription that belongs to the caller', async () => {
  const uid = 'uid-activate-ok';
  const id = 'I-ACTIVATE0001';
  paypal.subscriptions[id] = paypalSubscription({ id, uid });

  const result = await call(activateHandler, { uid, method: 'POST', body: { subscriptionID: id } });
  assert.equal(result.status, 200);
  assert.equal(result.body.active, true);

  const stored = fake.read('memberships', uid);
  assert.equal(stored.subscriptionId, id);
  assert.equal(stored.status, 'ACTIVE');
  assert.equal(stored.planId, 'P-NEW');
  assert.equal(stored.paidThrough, paypal.subscriptions[id].billing_info.next_billing_time);
});

test('activate: someone else\'s subscription id is rejected and nothing is written', async () => {
  const id = 'I-ACTIVATE0002';
  paypal.subscriptions[id] = paypalSubscription({ id, uid: 'uid-real-owner' });

  const result = await call(activateHandler, { uid: 'uid-activate-thief', method: 'POST', body: { subscriptionID: id } });
  assert.equal(result.status, 403);
  assert.equal(fake.read('memberships', 'uid-activate-thief'), undefined);
  assert.equal(fake.read('memberships', 'uid-real-owner'), undefined);
});

test('activate: a subscription to some other PayPal plan is rejected', async () => {
  const uid = 'uid-activate-otherplan';
  const id = 'I-ACTIVATE0003';
  paypal.subscriptions[id] = paypalSubscription({ id, uid, plan: 'P-SOMETHING-ELSE' });

  const result = await call(activateHandler, { uid, method: 'POST', body: { subscriptionID: id } });
  assert.equal(result.status, 400);
  assert.equal(fake.read('memberships', uid), undefined);
});

test('activate: an older plan listed in PAYPAL_MEMBERSHIP_PLAN_ID is still accepted', async () => {
  const uid = 'uid-activate-oldplan';
  const id = 'I-ACTIVATE0004';
  paypal.subscriptions[id] = paypalSubscription({ id, uid, plan: 'P-OLD' });

  const result = await call(activateHandler, { uid, method: 'POST', body: { subscriptionID: id } });
  assert.equal(result.body.active, true);
});

test('activate: a malformed id never reaches PayPal', async () => {
  const result = await call(activateHandler, {
    uid: 'uid-activate-bad',
    method: 'POST',
    body: { subscriptionID: '../../v1/payments' }
  });
  assert.equal(result.status, 400);
  assert.equal(paypal.calls.length, 0);
});

/* ---------------------------------------------------------------
   POST /api/subscription/cancel
   --------------------------------------------------------------- */

test('cancel: cancels in PayPal and keeps cash until the paid period ends', async () => {
  const uid = 'uid-cancel-ok';
  const id = 'I-CANCEL000001';
  const next = iso(Date.now() + 10 * DAY);
  paypal.subscriptions[id] = paypalSubscription({ id, uid, next });
  await call(activateHandler, { uid, method: 'POST', body: { subscriptionID: id } });

  const result = await call(cancelHandler, { uid, method: 'POST' });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'CANCELLED');
  assert.equal(result.body.active, true);
  assert.equal(result.body.paidThrough, next);
  assert.equal(paypalCallsTo(/^POST \/v1\/billing\/subscriptions\/I-CANCEL000001\/cancel$/).length, 1);
});

test('cancel: nothing to cancel is a 409 and no PayPal call', async () => {
  const result = await call(cancelHandler, { uid: 'uid-cancel-none', method: 'POST' });
  assert.equal(result.status, 409);
  assert.equal(paypal.calls.length, 0);
});

/* ---------------------------------------------------------------
   Webhook: membership events
   --------------------------------------------------------------- */

test('webhook: ACTIVATED records a membership even if the browser never called activate', async () => {
  const uid = 'uid-webhook-activated';
  const id = 'I-WEBHOOK00001';
  paypal.subscriptions[id] = paypalSubscription({ id, uid });

  const result = await webhook({ id: 'WH-1', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id } });
  assert.equal(result.status, 200);
  assert.equal(fake.read('memberships', uid).status, 'ACTIVE');
});

test('webhook: the event payload is not trusted, the subscription is re-read from PayPal', async () => {
  const uid = 'uid-webhook-reread';
  const id = 'I-WEBHOOK00002';
  paypal.subscriptions[id] = paypalSubscription({ id, uid, status: 'SUSPENDED' });

  await webhook({
    id: 'WH-2',
    event_type: 'BILLING.SUBSCRIPTION.ACTIVATED',
    resource: { id, status: 'ACTIVE', custom_id: uid }
  });
  assert.equal(fake.read('memberships', uid).status, 'SUSPENDED');
});

test('webhook: a renewal payment moves the renewal date forward', async () => {
  const uid = 'uid-webhook-renewal';
  const id = 'I-WEBHOOK00003';
  paypal.subscriptions[id] = paypalSubscription({ id, uid, next: iso(Date.now() + DAY) });
  await webhook({ id: 'WH-3a', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id } });

  const renewed = iso(Date.now() + 31 * DAY);
  paypal.subscriptions[id].billing_info.next_billing_time = renewed;
  await webhook({ id: 'WH-3b', event_type: 'PAYMENT.SALE.COMPLETED', resource: { id: 'SALE-1', billing_agreement_id: id } });

  assert.equal(fake.read('memberships', uid).nextBillingTime, renewed);
  assert.equal(fake.read('memberships', uid).paidThrough, renewed);
});

test('webhook: a late cancellation of an old subscription does not wipe a newer active one', async () => {
  const uid = 'uid-webhook-late';
  const oldId = 'I-WEBHOOKOLD01';
  const newId = 'I-WEBHOOKNEW01';
  paypal.subscriptions[oldId] = paypalSubscription({ id: oldId, uid, status: 'CANCELLED' });
  paypal.subscriptions[newId] = paypalSubscription({ id: newId, uid });
  await webhook({ id: 'WH-4a', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: newId } });

  const result = await webhook({ id: 'WH-4b', event_type: 'BILLING.SUBSCRIPTION.CANCELLED', resource: { id: oldId } });
  assert.equal(result.status, 200);
  assert.equal(fake.read('memberships', uid).subscriptionId, newId);
  assert.equal(fake.read('memberships', uid).status, 'ACTIVE');
});

test('webhook: subscriptions for other plans or without a uid are ignored', async () => {
  const foreign = 'I-WEBHOOKFOR01';
  paypal.subscriptions[foreign] = paypalSubscription({ id: foreign, uid: 'uid-webhook-foreign', plan: 'P-SOMETHING-ELSE' });
  const orphan = 'I-WEBHOOKORP01';
  paypal.subscriptions[orphan] = paypalSubscription({ id: orphan, uid: '' });

  assert.equal((await webhook({ id: 'WH-5a', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: foreign } })).status, 200);
  assert.equal((await webhook({ id: 'WH-5b', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: orphan } })).status, 200);
  assert.equal(fake.read('memberships', 'uid-webhook-foreign'), undefined);
});

test('webhook: before a plan is configured, subscription events are acknowledged and ignored', async () => {
  const original = process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
  delete process.env.PAYPAL_MEMBERSHIP_PLAN_ID;
  try {
    const result = await webhook({ id: 'WH-7', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id: 'I-WEBHOOKNOP01' } });
    assert.equal(result.status, 200);
    assert.equal(paypalCallsTo(/billing\/subscriptions/).length, 0);
  } finally {
    process.env.PAYPAL_MEMBERSHIP_PLAN_ID = original;
  }
});

test('webhook: if PayPal is down the event fails and PayPal\'s retry is processed, not skipped', async () => {
  const uid = 'uid-webhook-retry';
  const id = 'I-WEBHOOKRTY01';
  paypal.subscriptions[id] = paypalSubscription({ id, uid });
  const event = { id: 'WH-6', event_type: 'BILLING.SUBSCRIPTION.ACTIVATED', resource: { id } };

  paypal.failNextGet = true;
  const first = await webhook(event);
  assert.equal(first.status, 500);
  assert.equal(fake.read('paypalWebhookEvents', 'WH-6'), undefined);

  const retry = await webhook(event);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, undefined);
  assert.equal(fake.read('memberships', uid).status, 'ACTIVE');

  const duplicate = await webhook(event);
  assert.equal(duplicate.body.duplicate, true);
});

/* ---------------------------------------------------------------
   POST /api/reservations/create with payment 'efectivo'
   --------------------------------------------------------------- */

// First open day from tomorrow, 2 hours after opening. Mirrors
// DEFAULT_CONFIG's hours in api/_lib/reservations.js (Monday closed).
function bookableSlot() {
  const hours = { 0: '12:00', 2: '14:00', 3: '14:00', 4: '14:00', 5: '14:00', 6: '12:00' };
  for (let i = 1; i <= 3; i += 1) {
    const date = new Date(Date.now() + i * DAY).toISOString().slice(0, 10);
    const [y, m, d] = date.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    if (hours[weekday]) {
      const hour = Number(hours[weekday].slice(0, 2)) + 2;
      return { date, time: `${hour}:00` };
    }
  }
  throw new Error('No open day in the next 3 days');
}

function cashBooking(uid) {
  fake.setDocs('users', [{ id: uid, name: 'Cliente Miembro', email: `${uid}@example.com`, phone: '99998888' }]);
  return call(reservationHandler, {
    uid,
    method: 'POST',
    body: { ...bookableSlot(), duration: 1, rigIds: ['rig-1'], payment: 'efectivo' }
  });
}

test('reservations/create: cash without a membership is refused and books nothing', async () => {
  fake.setDocs('reservations', []);
  fake.setDocs('reservationLocks', []);

  const result = await cashBooking('uid-cash-nonmember');
  assert.equal(result.status, 403);
  assert.match(result.body.error, /miembros/);
  assert.equal(fake.list('reservations').length, 0);
  assert.equal(fake.list('reservationLocks').length, 0);
});

test('reservations/create: a lapsed membership does not allow cash either', async () => {
  const uid = 'uid-cash-lapsed';
  seedMembership(uid, { status: 'CANCELLED', subscriptionId: 'I-C00000000001', paidThrough: iso(Date.now() - DAY) });

  const result = await cashBooking(uid);
  assert.equal(result.status, 403);
});

test('reservations/create: an active member can book in cash, no proof needed', async () => {
  fake.setDocs('reservations', []);
  fake.setDocs('reservationLocks', []);
  const uid = 'uid-cash-member';
  seedMembership(uid, { status: 'ACTIVE', subscriptionId: 'I-C00000000002' });

  const result = await cashBooking(uid);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.payment, 'efectivo');
  assert.equal(result.body.paymentVerification, 'not_required');

  const [reservation] = fake.list('reservations');
  assert.equal(reservation.uid, uid);
  assert.equal(reservation.payment, 'efectivo');
  assert.equal(reservation.paymentProof, null);
  assert.deepEqual(reservation.paymentVerification, { required: false, status: 'not_required', verifiedAt: null, verifiedBy: null });
  assert.deepEqual(reservation.membership, { source: 'paypal', subscriptionId: 'I-C00000000002' });
  assert.equal(reservation.status, 'pending');
  assert.equal(fake.list('reservationLocks').length, 2, 'one hour on one rig = two 30-minute locks');
});
