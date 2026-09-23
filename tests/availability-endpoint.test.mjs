// Integration tests for GET /api/reservations/availability's reservationLocks
// handling. tests/lockdown-enforcement.test.mjs already covers the
// availabilityLockdowns path through this same handler; this file is about
// the per-rig lock lookup that turns each rig's `available` flag on/off.
//
// Regression coverage for two bugs found in that lookup:
//   1. It used to re-derive a rig's id by splitting the lock doc id
//      (`${date}_${HHMM}_${rigId}`) on '_' and taking the last piece — which
//      silently breaks for any rig id that itself contains an underscore
//      (the doc id's last '_'-separated piece is then only part of the rig
//      id, so `locked.has(rig.id)` never matches and the rig looks
//      permanently available no matter how booked it is).
//   2. It checked a bare `snapshot.exists` instead of isLockActive(), so an
//      expired lock left behind by an abandoned checkout (see isLockActive's
//      comment in api/_lib/reservations.js) kept blocking a rig here even
//      though calendar.js and create.js already treat it as free.
//
// Same single-mock-setup pattern as the other endpoint test files — see
// tests/calendar-endpoint.test.mjs's header comment for why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createFakeFirestore, createFakeReqRes, mockFirebaseAdmin } from './helpers/fake-firestore.mjs';

function addDaysISO(days) {
  const dt = new Date();
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}
function nextDateOnWeekday(weekday, withinDays = 6) {
  for (let i = 1; i <= withinDays; i += 1) {
    const candidate = addDaysISO(i);
    if (weekdayOf(candidate) === weekday) return candidate;
  }
  throw new Error(`No weekday ${weekday} found within ${withinDays} days`);
}

const defaultHours = { 0: ['12:00', '21:00'], 2: ['14:00', '21:00'], 3: ['14:00', '21:00'], 4: ['14:00', '21:00'], 5: ['14:00', '21:00'], 6: ['12:00', '21:00'] };
const testDate = nextDateOnWeekday(2);
const [openTime] = defaultHours[weekdayOf(testDate)];
const requestTime = openTime.replace(/^(\d{2}):/, (_, h) => `${String((Number(h) + 2) % 24).padStart(2, '0')}:`); // 2h after opening
const slotHHMM = requestTime.replace(':', '');

const fake = createFakeFirestore({
  availabilityLockdowns: [],
  rigs: [
    { id: 'standard_1', name: 'Standard 1', type: 'standard', active: true, maintenance: false, sort: 1 },
    { id: 'rig-2', name: 'Rig 2', type: 'standard', active: true, maintenance: false, sort: 2 }
  ],
  reservationLocks: []
});
mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake));

const { default: handler } = await import('../api/reservations/availability.js');
const { __clearCacheForTests } = await import('../api/_lib/reservations.js');

test.beforeEach(() => {
  __clearCacheForTests();
});

async function callAvailability() {
  const { req, res } = createFakeReqRes({ query: { date: testDate, time: requestTime, duration: '1' } });
  await handler(req, res);
  return JSON.parse(res.body);
}

function rigById(payload, id) {
  return payload.rigs.find((r) => r.id === id);
}

test('availability: a rig id containing an underscore is still correctly marked unavailable when locked', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${slotHHMM}_standard_1` }
  ]);
  const payload = await callAvailability();
  assert.equal(rigById(payload, 'standard_1').available, false);
  assert.equal(rigById(payload, 'rig-2').available, true);
});

test('availability: a hyphenated rig id is unaffected (sanity check against the same lock set)', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${slotHHMM}_rig-2` }
  ]);
  const payload = await callAvailability();
  assert.equal(rigById(payload, 'rig-2').available, false);
  assert.equal(rigById(payload, 'standard_1').available, true);
});

test('availability: an expired lock (abandoned checkout) no longer blocks its rig', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${slotHHMM}_standard_1`, expiresAt: { toMillis: () => Date.now() - 60_000 } }
  ]);
  const payload = await callAvailability();
  assert.equal(rigById(payload, 'standard_1').available, true);
});

test('availability: a lock with no expiresAt (a confirmed booking) blocks indefinitely', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${slotHHMM}_standard_1` }
  ]);
  const payload = await callAvailability();
  assert.equal(rigById(payload, 'standard_1').available, false);
  fake.setDocs('reservationLocks', []);
});
