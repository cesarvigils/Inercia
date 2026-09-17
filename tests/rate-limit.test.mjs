import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../api/_lib/http.js';
import { createFakeReqRes } from './helpers/fake-firestore.mjs';

test('rateLimit: allows up to the limit, then blocks with 429', () => {
  const key = `test-${Math.random()}`;
  for (let i = 0; i < 3; i += 1) {
    const { req, res } = createFakeReqRes();
    const allowed = rateLimit(req, res, { key, limit: 3, windowMs: 60_000 });
    assert.equal(allowed, true, `request ${i + 1} should be allowed`);
  }

  const { req, res } = createFakeReqRes();
  const blocked = rateLimit(req, res, { key, limit: 3, windowMs: 60_000 });
  assert.equal(blocked, false);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After'] > 0);
  assert.match(res.body, /Demasiadas solicitudes/);
});

test('rateLimit: different keys are independent', () => {
  const keyA = `a-${Math.random()}`;
  const keyB = `b-${Math.random()}`;

  const { req: reqA, res: resA } = createFakeReqRes();
  const { req: reqB, res: resB } = createFakeReqRes();

  assert.equal(rateLimit(reqA, resA, { key: keyA, limit: 1, windowMs: 60_000 }), true);
  assert.equal(rateLimit(reqA, resA, { key: keyA, limit: 1, windowMs: 60_000 }), false);
  // keyB has its own independent bucket, unaffected by keyA being exhausted.
  assert.equal(rateLimit(reqB, resB, { key: keyB, limit: 1, windowMs: 60_000 }), true);
});

test('rateLimit: resets after the window elapses', async () => {
  const key = `window-${Math.random()}`;
  const { req: req1, res: res1 } = createFakeReqRes();
  assert.equal(rateLimit(req1, res1, { key, limit: 1, windowMs: 50 }), true);

  const { req: req2, res: res2 } = createFakeReqRes();
  assert.equal(rateLimit(req2, res2, { key, limit: 1, windowMs: 50 }), false);

  await new Promise((resolve) => setTimeout(resolve, 70));

  const { req: req3, res: res3 } = createFakeReqRes();
  assert.equal(rateLimit(req3, res3, { key, limit: 1, windowMs: 50 }), true);
});

test('rateLimit: falls back to client IP when no key is given', () => {
  const { req, res } = createFakeReqRes();
  req.socket.remoteAddress = `10.0.0.${Math.floor(Math.random() * 255)}`;
  assert.equal(rateLimit(req, res, { limit: 1, windowMs: 60_000 }), true);
  const { req: req2, res: res2 } = createFakeReqRes();
  req2.socket.remoteAddress = req.socket.remoteAddress;
  assert.equal(rateLimit(req2, res2, { limit: 1, windowMs: 60_000 }), false);
});
