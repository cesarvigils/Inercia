// Tests for js/refund-logic.js: which PayPal reservations the REEMBOLSOS
// view lists, the balance it shows, the amount validation, and the
// request it sends to /api/paypal/refund. No network: requestRefund()
// gets a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REFUND_ENDPOINT,
  parseRefundAmount,
  refundInfo,
  refundRows,
  refundStatusLabel,
  requestRefund
} from '../js/refund-logic.js';

const paypal = (overrides = {}, extra = {}) => ({
  id: 'r1',
  code: 'INR-1',
  date: '2026-06-16',
  time: '14:00',
  status: 'approved',
  pricing: { total: 400 },
  payment: {
    method: 'paypal',
    status: 'paid',
    totalHNL: 400,
    amountUSD: '16.00',
    exchangeRate: 25,
    paypalCaptureId: 'CAP-1',
    refundedHNL: 0,
    refundedUSD: '0.00',
    ...overrides
  },
  ...extra
});

test('refundInfo: only captured PayPal payments count', () => {
  assert.equal(refundInfo({ payment: { method: 'efectivo' } }), null);
  assert.equal(refundInfo({ payment: 'transferencia' }), null);
  assert.equal(refundInfo({}), null);
  // checkout started but never captured
  assert.equal(refundInfo(paypal({ status: 'pending', paypalCaptureId: null })), null);
  // expired/cancelled checkout released by the server
  assert.equal(refundInfo(paypal({ status: 'expired', paypalCaptureId: null })), null);

  const info = refundInfo(paypal());
  assert.equal(info.totalHNL, 400);
  assert.equal(info.remainingHNL, 400);
  assert.equal(info.refundable, true);
});

test('refundInfo: balance after partial and full refunds', () => {
  const partial = refundInfo(paypal({ status: 'partially_refunded', refundedHNL: 150.5 }));
  assert.equal(partial.remainingHNL, 249.5);
  assert.equal(partial.refundable, true);

  const full = refundInfo(paypal({ status: 'refunded', refundedHNL: 400 }));
  assert.equal(full.remainingHNL, 0);
  assert.equal(full.refundable, false);
});

test('refundInfo: falls back to pricing.total like the server does', () => {
  const info = refundInfo(paypal({ totalHNL: undefined }));
  assert.equal(info.totalHNL, 400);
});

test('refundStatusLabel: marks refunds PayPal still holds as pending', () => {
  assert.equal(refundStatusLabel(refundInfo(paypal())), 'PAGADO');
  assert.equal(
    refundStatusLabel(refundInfo(paypal({ status: 'refunded', refundedHNL: 400, lastRefundStatus: 'PENDING' }))),
    'REEMBOLSADO (PENDIENTE EN PAYPAL)'
  );
});

test('refundRows: filters and newest-first order', () => {
  const list = [
    paypal({}, { id: 'a', date: '2026-06-10' }),
    paypal({ status: 'refunded', refundedHNL: 400 }, { id: 'b', date: '2026-06-20' }),
    paypal({ status: 'partially_refunded', refundedHNL: 100 }, { id: 'c', date: '2026-06-15' }),
    { id: 'cash', payment: { method: 'efectivo' } }
  ];
  assert.deepEqual(refundRows(list, 'pending').map((x) => x.reservation.id), ['c', 'a']);
  assert.deepEqual(refundRows(list, 'refunded').map((x) => x.reservation.id), ['b', 'c']);
  assert.deepEqual(refundRows(list, 'all').map((x) => x.reservation.id), ['b', 'c', 'a']);
});

test('parseRefundAmount: empty or the whole balance means a full refund', () => {
  assert.deepEqual(parseRefundAmount('', 400), { amountHNL: null });
  assert.deepEqual(parseRefundAmount('400', 400), { amountHNL: null });
  assert.deepEqual(parseRefundAmount('150,5', 400), { amountHNL: 150.5 });
  assert.deepEqual(parseRefundAmount('99.999', 400), { amountHNL: 100 });
});

test('parseRefundAmount: rejects zero, negatives, junk and more than the balance', () => {
  for (const bad of ['0', '-5', 'abc', '400.01']) {
    assert.ok(parseRefundAmount(bad, 400).error, bad);
  }
});

const fakeUser = { getIdToken: async () => 'TOKEN' };

test('requestRefund: posts the admin token and omits amount for a full refund', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, status: 'COMPLETED', amountHNL: 400 }) };
  };

  await requestRefund({ user: fakeUser, reservationId: 'r1', fetchImpl });
  await requestRefund({ user: fakeUser, reservationId: 'r1', amountHNL: 150, fetchImpl });

  assert.equal(calls[0].url, REFUND_ENDPOINT);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer TOKEN');
  assert.deepEqual(JSON.parse(calls[0].options.body), { reservationId: 'r1' });
  assert.deepEqual(JSON.parse(calls[1].options.body), { reservationId: 'r1', amountHNL: 150 });
});

test('requestRefund: surfaces the server error message', async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ error: 'Esta reserva ya fue reembolsada completamente.' })
  });
  await assert.rejects(
    requestRefund({ user: fakeUser, reservationId: 'r1', fetchImpl }),
    /ya fue reembolsada/
  );
  await assert.rejects(requestRefund({ user: null, reservationId: 'r1', fetchImpl }), /iniciar sesión/);
});

test('requestRefund: a non-JSON failure (proxy/HTML error page) still throws', async () => {
  const fetchImpl = async () => ({ ok: false, status: 502, json: async () => { throw new Error('html'); } });
  await assert.rejects(requestRefund({ user: fakeUser, reservationId: 'r1', fetchImpl }), /HTTP 502/);
});
