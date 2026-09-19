import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone } from '../lib/phone.js';

test('normalizePhone: empty/missing input returns empty string', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone('   '), '');
});

test('normalizePhone: bare 8-digit Honduras numbers get country code + dash added', () => {
  assert.equal(normalizePhone('99999999'), '+504 9999-9999');
  assert.equal(normalizePhone('9999-9999'), '+504 9999-9999');
  assert.equal(normalizePhone('9999 9999'), '+504 9999-9999');
});

test('normalizePhone: numbers already carrying the 504 country code are recognized', () => {
  assert.equal(normalizePhone('50499999999'), '+504 9999-9999');
  assert.equal(normalizePhone('+504 9999-9999'), '+504 9999-9999');
  assert.equal(normalizePhone('+504-9999-9999'), '+504 9999-9999');
  assert.equal(normalizePhone('(504) 9999 9999'), '+504 9999-9999');
});

test('normalizePhone: an explicit non-Honduras country code is kept, not discarded', () => {
  assert.equal(normalizePhone('+1 305-555-1234'), '+13055551234');
});

test('normalizePhone: an unrecognizable shape is returned best-effort, never dropped', () => {
  assert.equal(normalizePhone('123'), '+123');
  assert.equal(normalizePhone('123456789012'), '+123456789012');
});

test('normalizePhone: is idempotent (normalizing an already-normalized number is a no-op)', () => {
  const once = normalizePhone('9999-9999');
  assert.equal(normalizePhone(once), once);
});
