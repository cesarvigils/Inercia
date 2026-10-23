// Tests for api/_lib/membership-plans.js (tier and billing period read from
// the PayPal plan) and the two endpoints that use it: the tier added to
// GET /api/subscription/status and the public GET /api/subscription/plans.
// PayPal is a stubbed global fetch; Firestore is the in-memory fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createFakeFirestore, createFakeReqRes, mockFirebaseAdmin } from './helpers/fake-firestore.mjs';

process.env.PAYPAL_CLIENT_ID = 'client';
process.env.PAYPAL_CLIENT_SECRET = 'secret';
process.env.PAYPAL_MEMBERSHIP_PLAN_ID = [
  'P-ZAFIROANUAL0000000000000',
  'P-GOLDMENSUAL000000000000',
  'P-PLATINO6000000000000000',
  'P-GOLDTRES00000000000000A',
  'P-INACTIVO000000000000000',
  'P-SINTIER0000000000000000'
].join(',');

const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

function plan(id, name, { unit = 'MONTH', count = 1, price = '10.00', status = 'ACTIVE' } = {}) {
  return {
    id,
    name,
    status,
    billing_cycles: [
      {
        tenure_type: 'REGULAR',
        frequency: { interval_unit: unit, interval_count: count },
        pricing_scheme: { fixed_price: { value: price, currency_code: 'USD' } }
      }
    ]
  };
}

const PLANS = {
  'P-ZAFIROANUAL0000000000000': plan('P-ZAFIROANUAL0000000000000', 'Plan Zafiro Anual', { unit: 'YEAR', price: '300.00' }),
  'P-GOLDMENSUAL000000000000': plan('P-GOLDMENSUAL000000000000', 'Plan Gold', { price: '20.00' }),
  // Named "6" in PayPal; the cycle says every 6 months either way.
  'P-PLATINO6000000000000000': plan('P-PLATINO6000000000000000', 'Plan Platino 6', { count: 6, price: '150.00' }),
  'P-GOLDTRES00000000000000A': plan('P-GOLDTRES00000000000000A', 'Plan Gold 3', { count: 3, price: '55.00' }),
  'P-INACTIVO000000000000000': plan('P-INACTIVO000000000000000', 'Plan Gold', { status: 'INACTIVE' }),
  'P-SINTIER0000000000000000': plan('P-SINTIER0000000000000000', 'Plan Prueba')
};

let planCalls = 0;
let paypalDown = false;

globalThis.fetch = async (url) => {
  const { pathname } = new URL(url);
  const reply = (status, body) => ({ ok: status < 300, status, json: async () => body });

  if (pathname === '/v1/oauth2/token') return reply(200, { access_token: 'token' });

  const match = pathname.match(/^\/v1\/billing\/plans\/([^/]+)$/);
  if (match) {
    planCalls += 1;
    if (paypalDown) return reply(500, { message: 'PayPal down' });
    return PLANS[match[1]] ? reply(200, PLANS[match[1]]) : reply(404, { message: 'RESOURCE_NOT_FOUND' });
  }

  throw new Error(`Unexpected PayPal call ${pathname}`);
};

const fake = createFakeFirestore({ memberships: [] });

mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake, {
  adminAuth: {
    async verifyIdToken(token) {
      if (!token.startsWith('uid-')) throw new Error('bad token');
      return { uid: token };
    }
  }
}));

const {
  tierFromPlanName,
  billingPeriod,
  membershipTier,
  listPlans,
  clearPlanCache
} = await import('../api/_lib/membership-plans.js');
const { default: statusHandler } = await import('../api/subscription/status.js');
const { default: plansHandler } = await import('../api/subscription/plans.js');

test.beforeEach(() => {
  clearPlanCache();
  planCalls = 0;
  paypalDown = false;
});

async function call(handler, { uid } = {}) {
  const { req, res } = createFakeReqRes({
    headers: uid ? { authorization: `Bearer ${uid}` } : {}
  });
  await handler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('tierFromPlanName: reads Gold, Platino and Zafiro out of the PayPal plan name', () => {
  assert.equal(tierFromPlanName('Plan Gold 3'), 'Gold');
  assert.equal(tierFromPlanName('Plan Platino Anual'), 'Platino');
  assert.equal(tierFromPlanName('plan zafiro'), 'Zafiro');
  assert.equal(tierFromPlanName('Plan Prueba'), null);
  assert.equal(tierFromPlanName(''), null);
});

test('billingPeriod: monthly, every 3 months, every 6 months and yearly', () => {
  assert.equal(billingPeriod(plan('P', 'x')), 'mensual');
  assert.equal(billingPeriod(plan('P', 'x', { count: 3 })), 'trimestral');
  assert.equal(billingPeriod(plan('P', 'x', { count: 6 })), 'semestral');
  assert.equal(billingPeriod(plan('P', 'x', { unit: 'YEAR' })), 'anual');
  assert.equal(billingPeriod(plan('P', 'x', { unit: 'WEEK' })), null);
  assert.equal(billingPeriod({}), null);
});

test('membershipTier: no access is Nula; an unreadable plan is null, never Nula', () => {
  const active = { status: 'ACTIVE' };
  assert.equal(membershipTier(null, null), 'Nula');
  assert.equal(membershipTier({ status: 'SUSPENDED' }, { tier: 'Gold' }), 'Nula');
  assert.equal(membershipTier(active, { tier: 'Zafiro' }), 'Zafiro');
  assert.equal(membershipTier(active, null), null);
});

test('listPlans: only active plans with a tier, sorted by tier then period', async () => {
  const plans = await listPlans();
  assert.deepEqual(
    plans.map((p) => `${p.tier} ${p.period} ${p.price.value}`),
    ['Gold mensual 20.00', 'Gold trimestral 55.00', 'Platino semestral 150.00', 'Zafiro anual 300.00']
  );

  await listPlans();
  assert.equal(planCalls, 6, 'the second listing is served from the cache');
});

test('plans endpoint: public, returns the listed plans without PayPal status fields', async () => {
  const result = await call(plansHandler);
  assert.equal(result.status, 200);
  assert.equal(result.body.plans.length, 4);
  assert.deepEqual(Object.keys(result.body.plans[0]).sort(), ['id', 'name', 'period', 'price', 'tier']);
});

test('status: no membership is Nula without asking PayPal', async () => {
  const result = await call(statusHandler, { uid: 'uid-tier-none' });
  assert.equal(result.status, 200);
  assert.equal(result.body.tier, 'Nula');
  assert.equal(result.body.period, null);
  assert.equal(planCalls, 0);
});

test('status: an active membership gets its plan tier and period', async () => {
  fake.setDocs('memberships', [{
    id: 'uid-tier-platino',
    uid: 'uid-tier-platino',
    status: 'ACTIVE',
    subscriptionId: 'I-PLATINO000001',
    planId: 'P-PLATINO6000000000000000',
    nextBillingTime: iso(Date.now() + DAY),
    syncedAtMs: Date.now()
  }]);

  const result = await call(statusHandler, { uid: 'uid-tier-platino' });
  assert.equal(result.body.active, true);
  assert.equal(result.body.tier, 'Platino');
  assert.equal(result.body.period, 'semestral');
});

test('status: a lapsed membership is Nula even though its plan has a tier', async () => {
  fake.setDocs('memberships', [{
    id: 'uid-tier-lapsed',
    uid: 'uid-tier-lapsed',
    status: 'CANCELLED',
    subscriptionId: 'I-LAPSED0000001',
    planId: 'P-GOLDMENSUAL000000000000',
    paidThrough: iso(Date.now() - DAY)
  }]);

  const result = await call(statusHandler, { uid: 'uid-tier-lapsed' });
  assert.equal(result.body.active, false);
  assert.equal(result.body.tier, 'Nula');
});

test('status: PayPal down leaves an active member with tier null, not Nula', async () => {
  paypalDown = true;
  fake.setDocs('memberships', [{
    id: 'uid-tier-down',
    uid: 'uid-tier-down',
    status: 'ACTIVE',
    subscriptionId: 'I-DOWN000000001',
    planId: 'P-GOLDMENSUAL000000000000',
    nextBillingTime: iso(Date.now() + DAY),
    syncedAtMs: Date.now()
  }]);

  const result = await call(statusHandler, { uid: 'uid-tier-down' });
  assert.equal(result.status, 200);
  assert.equal(result.body.active, true);
  assert.equal(result.body.tier, null);
});
