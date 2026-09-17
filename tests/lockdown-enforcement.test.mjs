// Integration test for the admin-lockdown ("rig block") enforcement fix.
// Before this fix, an active `availabilityLockdowns` entry only greyed out
// the slot in GET /api/reservations/availability — it was never actually
// checked by the endpoints that create a reservation, so a booking could
// still be made (and paid) during a "blocked" window. This test drives the
// real availability.js handler end-to-end against a fake Firestore to prove
// the lockdown is enforced. tests/reservations-logic.test.mjs separately
// unit-tests the same getActiveLockdowns/findOverlappingLockdown pair that
// api/reservations/create.js and api/_lib/paypal-reservation.js now also
// call — this file is about the endpoint wiring, not re-deriving the
// overlap math.
//
// Deliberately structured as ONE test with sequential scenarios (mutating
// the fake Firestore's data between them) rather than several tests that
// each mock.module()+dynamic-import fresh: api/reservations/availability.js
// imports api/_lib/reservations.js with a plain (unqueried) specifier, and
// once any test in this process loads that plain specifier, every later
// test reuses that same cached module instance — including whatever
// firebase-admin.js mock was active the first time it loaded. Setting the
// mock up once and reusing one handler for the whole file sidesteps that
// instead of fighting it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createFakeFirestore, createFakeReqRes, mockFirebaseAdmin } from './helpers/fake-firestore.mjs';

// Plain date math duplicated here on purpose — importing api/_lib/
// reservations.js's own date helpers before the mock is set up would be
// exactly the premature "plain specifier" load described above.
function addDaysISO(days) {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

const testDate = addDaysISO(2);
const defaultHours = { 0: ['12:00', '21:00'], 1: ['10:00', '21:00'], 2: ['10:00', '21:00'], 3: ['10:00', '21:00'], 4: ['10:00', '21:00'], 5: ['10:00', '21:00'], 6: ['12:00', '21:00'] };
const [openTime] = defaultHours[weekdayOf(testDate)];
const requestTime = openTime.replace(/^(\d{2}):/, (_, h) => `${String((Number(h) + 2) % 24).padStart(2, '0')}:`); // 2h after opening

const fake = createFakeFirestore({
  availabilityLockdowns: [],
  rigs: [{ id: 'rig-1', name: 'Rig 1', type: 'standard', active: true, maintenance: false, sort: 1 }],
  reservationLocks: []
});
mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake));

const { default: handler } = await import('../api/reservations/availability.js');

// Safe to import now (not before the line above): api/_lib/reservations.js
// has already been loaded, correctly bound to the mock, as a side effect of
// availability.js's own import chain. This just gets a reference to that
// same singleton instance to reset its cache between scenarios below — the
// cache is keyed by date, and every scenario here reuses the same testDate,
// so without clearing it each scenario would see the previous one's cached
// (now stale) lockdown list instead of the freshly mutated fake data.
const { __clearCacheForTests } = await import('../api/_lib/reservations.js');

test.beforeEach(() => {
  __clearCacheForTests();
});

async function callAvailability() {
  const { req, res } = createFakeReqRes({ query: { date: testDate, time: requestTime, duration: '1' } });
  await handler(req, res);
  return res;
}

test('availability: no lockdown for that date returns the rig list normally', async () => {
  fake.setDocs('availabilityLockdowns', []);
  const res = await callAvailability();
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.rigs.length, 1);
  assert.equal(payload.rigs[0].available, true);
});

test('availability: a date/time overlapping an active lockdown is rejected with 409', async () => {
  fake.setDocs('availabilityLockdowns', [
    { id: 'lock1', date: testDate, start: openTime, end: '23:59', active: true, reason: 'Evento privado' }
  ]);
  const res = await callAvailability();
  assert.equal(res.statusCode, 409);
  assert.match(res.body, /Evento privado/);
});

test('availability: an inactive (soft-deleted) lockdown does not block', async () => {
  fake.setDocs('availabilityLockdowns', [
    { id: 'lock1', date: testDate, start: openTime, end: '23:59', active: false }
  ]);
  const res = await callAvailability();
  assert.equal(res.statusCode, 200);
});

test('availability: a lockdown on a different date does not block this one', async () => {
  fake.setDocs('availabilityLockdowns', [
    { id: 'lock1', date: addDaysISO(3), start: '00:00', end: '23:59', active: true }
  ]);
  const res = await callAvailability();
  assert.equal(res.statusCode, 200);
});
