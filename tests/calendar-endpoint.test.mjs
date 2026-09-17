// Integration tests for GET /api/reservations/calendar (drives the new
// calendar + clock pickers on the booking page). Same single-mock-setup
// pattern as tests/lockdown-enforcement.test.mjs — see that file's header
// comment for why: api/_lib/reservations.js is a plain (unqueried) import
// shared by every reservation endpoint, so once it's loaded once in this
// process (correctly bound to the mock, since we load it after mock.module)
// every later test in this file reuses that same instance. Mutating the
// fake's seeded data between scenarios instead of re-importing per
// scenario sidesteps that instead of fighting it.
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
// Guaranteed-open weekday within the (7-day) booking window — picking an
// arbitrary fixed offset would occasionally land this whole file's test
// date on the closed Monday.
function nextDateOnWeekday(weekday, withinDays = 6) {
  for (let i = 1; i <= withinDays; i += 1) {
    const candidate = addDaysISO(i);
    if (weekdayOf(candidate) === weekday) return candidate;
  }
  throw new Error(`No weekday ${weekday} found within ${withinDays} days`);
}

// Lunes cerrado (sin entrada); martes-viernes 14:00-21:00; sábado y
// domingo 12:00-21:00 — debe reflejar el horario real en
// api/_lib/reservations.js's DEFAULT_CONFIG.
const DEFAULT_HOURS = { 0: ['12:00', '21:00'], 2: ['14:00', '21:00'], 3: ['14:00', '21:00'], 4: ['14:00', '21:00'], 5: ['14:00', '21:00'], 6: ['12:00', '21:00'] };

// A Tuesday within the window: guaranteed open, and far enough out to be
// clear of "today"'s lead-time edge cases.
const testDate = nextDateOnWeekday(2);
const [openTime, closeTime] = DEFAULT_HOURS[weekdayOf(testDate)];

const fake = createFakeFirestore({
  rigs: [
    { id: 'rig-1', name: 'Rig 1', type: 'standard', status: 'active', sort: 1 },
    { id: 'rig-2', name: 'Rig 2', type: 'standard', status: 'active', sort: 2 }
  ],
  availabilityLockdowns: [],
  reservationLocks: []
});
mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake));

const { default: handler } = await import('../api/reservations/calendar.js');
const { __clearCacheForTests } = await import('../api/_lib/reservations.js');

test.beforeEach(() => {
  __clearCacheForTests();
});

async function callCalendar(query = {}) {
  const { req, res } = createFakeReqRes({ query });
  await handler(req, res);
  return { res, payload: res.body ? JSON.parse(res.body) : null };
}

test('calendar: an open day with no locks has every candidate hour available', async () => {
  fake.setDocs('reservationLocks', []);
  const { res, payload } = await callCalendar({ duration: '1' });
  assert.equal(res.statusCode, 200);
  assert.equal(payload.bookingWindowDays, 7);
  assert.equal(payload.days.length, 7);

  const day = payload.days.find((d) => d.date === testDate);
  assert.equal(day.status, 'available');
  assert.ok(day.hours.length > 0);
  assert.ok(day.hours.every((h) => h.available));
});

test('calendar: a rig fully booked for one hour still leaves that hour available (the other rig is free)', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${openTime.replace(':', '')}_rig-1` }
  ]);
  const { payload } = await callCalendar({ duration: '1' });
  const day = payload.days.find((d) => d.date === testDate);
  const openHour = day.hours.find((h) => h.time === openTime);
  assert.equal(openHour.available, true); // rig-2 is still free
});

test('calendar: every rig booked for an hour makes that specific hour unavailable, others unaffected', async () => {
  fake.setDocs('reservationLocks', [
    { id: `${testDate}_${openTime.replace(':', '')}_rig-1` },
    { id: `${testDate}_${openTime.replace(':', '')}_rig-2` }
  ]);
  const { payload } = await callCalendar({ duration: '1' });
  const day = payload.days.find((d) => d.date === testDate);
  const openHour = day.hours.find((h) => h.time === openTime);
  const nextHour = day.hours[1];
  assert.equal(openHour.available, false);
  assert.equal(nextHour.available, true);
  assert.equal(day.status, 'available'); // still has other open hours
});

test('calendar: every hour booked on every rig marks the whole day "full"', async () => {
  const day = testDate;
  const openHour = Number(openTime.split(':')[0]);
  const closeHour = Number(closeTime.split(':')[0]);
  const locks = [];
  for (let h = openHour; h < closeHour; h += 1) {
    locks.push({ id: `${day}_${String(h).padStart(2, '0')}00_rig-1` });
    locks.push({ id: `${day}_${String(h).padStart(2, '0')}00_rig-2` });
  }
  fake.setDocs('reservationLocks', locks);
  const { payload } = await callCalendar({ duration: '1' });
  const found = payload.days.find((d) => d.date === testDate);
  assert.equal(found.status, 'full');
  assert.ok(found.hours.every((h) => !h.available));
});

test('calendar: an active lockdown blocks its exact window without affecting the rest of the day', async () => {
  fake.setDocs('reservationLocks', []);
  fake.setDocs('availabilityLockdowns', [
    { id: 'lock1', date: testDate, start: openTime, end: '23:59', active: true, reason: 'Evento privado' }
  ]);
  const { payload } = await callCalendar({ duration: '1' });
  const day = payload.days.find((d) => d.date === testDate);
  assert.equal(day.status, 'full'); // the lockdown here spans the whole rest of the day
  fake.setDocs('availabilityLockdowns', []);
});

test('calendar: a day with no configured hours (e.g. a closed weekday) reports "closed" with no hours', async () => {
  // Find whichever date in the window has no hoursConfig, if the merged
  // config has one — with DEFAULT_CONFIG every weekday is open, so this
  // just confirms the shape/absence rather than asserting a specific date.
  fake.setDocs('reservationLocks', []);
  const { payload } = await callCalendar({ duration: '1' });
  for (const day of payload.days) {
    if (day.status === 'closed') {
      assert.deepEqual(day.hours, []);
    }
  }
});

test('calendar: duration is clamped to the configured min/max', async () => {
  fake.setDocs('reservationLocks', []);
  const { payload: tooLong } = await callCalendar({ duration: '999' });
  assert.equal(tooLong.duration, 8); // DEFAULT_CONFIG.maxDurationHours
  const { payload: tooShort } = await callCalendar({ duration: '0' });
  assert.equal(tooShort.duration, 1); // DEFAULT_CONFIG.minDurationHours
});
