// Pure-function tests for api/_lib/reservations.js — no Firestore, no
// mocking. These cover the two things this fix pass was specifically about:
// the Tuesday discount (applyTuesdayPromotion) and the admin lockdown /
// "rig block" overlap check (findOverlappingLockdown), plus the pricing and
// booking-window validation they build on.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateWhen,
  priceReservation,
  applyTuesdayPromotion,
  findOverlappingLockdown,
  isRigBookable,
  slotIds,
  hm,
  dateDay,
  localParts,
  bad
} from '../api/_lib/reservations.js';

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// A date within the default 7-day booking window, far enough out that
// lead-time checks never flake regardless of what time the suite runs.
function inWindow(days = 2) {
  return addDays(localParts().date, days);
}

// Finds the next date (within `withinDays`) that falls on the given
// day-of-week (0=Sun..6=Sat), so Tuesday-specific tests don't depend on
// today's actual weekday.
function nextDateOnWeekday(weekday, withinDays = 14) {
  const today = localParts().date;
  for (let i = 1; i <= withinDays; i += 1) {
    const candidate = addDays(today, i);
    if (dateDay(candidate) === weekday) return candidate;
  }
  throw new Error(`No ${weekday} found within ${withinDays} days`);
}

const config = {
  bookingWindowDays: 7,
  minLeadMinutes: 30,
  minDurationHours: 1,
  maxDurationHours: 8,
  slotMinutes: 30,
  prices: { standard: 200, premium: 350 },
  hours: {
    0: ['12:00', '21:00'], 1: ['10:00', '21:00'], 2: ['10:00', '21:00'],
    3: ['10:00', '21:00'], 4: ['10:00', '21:00'], 5: ['10:00', '21:00'], 6: ['12:00', '21:00']
  },
  lateBooking: { enabled: true, thresholdMinutes: 60, type: 'percent', value: 10 }
};

test('validateWhen: accepts a well-formed booking inside hours/window/lead time', () => {
  const date = inWindow(2);
  const day = dateDay(date);
  const [openTime] = config.hours[day];
  const start = hm(openTime) + 60; // an hour after opening, safely inside the window
  const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  const result = validateWhen(date, time, 2, config);
  assert.equal(result.start, start);
  assert.equal(result.end, start + 120);
});

test('validateWhen: rejects malformed date/time', () => {
  assert.throws(() => validateWhen('15-06-2026', '10:00', 2, config), /inválida/);
  assert.throws(() => validateWhen('2026-06-15', '10h00', 2, config), /inválida/);
});

test('validateWhen: rejects duration outside min/max', () => {
  const date = inWindow(2);
  assert.throws(() => validateWhen(date, '11:00', 0, config), /duración/);
  assert.throws(() => validateWhen(date, '11:00', 9, config), /duración/);
});

test('validateWhen: rejects a booking outside the configured window', () => {
  const tooFar = inWindow(config.bookingWindowDays + 3);
  assert.throws(() => validateWhen(tooFar, '11:00', 1, config), /próximos/);
});

test('validateWhen: rejects a time outside that day\'s opening hours', () => {
  const date = inWindow(2);
  const day = dateDay(date);
  const [, closeTime] = config.hours[day];
  const closeMinutes = hm(closeTime);
  const start = closeMinutes - 30; // only 30 min left before closing
  const time = `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
  assert.throws(() => validateWhen(date, time, 1, config), /horario/); // 1h duration won't fit
});

test('validateWhen: rejects a booking made too close to the requested time', () => {
  const today = localParts();
  const inFiveMinutes = today.minutes + 5;
  const time = `${String(Math.floor(inFiveMinutes / 60) % 24).padStart(2, '0')}:${String(inFiveMinutes % 60).padStart(2, '0')}`;
  assert.throws(() => validateWhen(today.date, time, 1, config), /anticipación/);
});

test('priceReservation: sums per-rig hourly price', () => {
  const rigs = [{ type: 'standard' }, { type: 'premium' }];
  const pricing = priceReservation(rigs, 2, config, [], 999);
  assert.equal(pricing.base, (200 + 350) * 2);
  assert.equal(pricing.discount, 0);
  assert.equal(pricing.total, pricing.base);
});

test('priceReservation: percent discount is capped at the base price', () => {
  const rigs = [{ type: 'standard' }];
  const promos = [{ type: 'percent', value: 150 }]; // absurd value, should clamp to 100%
  const pricing = priceReservation(rigs, 1, config, promos, 999);
  assert.equal(pricing.discount, pricing.base);
  assert.equal(pricing.total, 0);
});

test('priceReservation: fixed discount cannot push total below zero and is capped at base', () => {
  const rigs = [{ type: 'standard' }];
  const promos = [{ type: 'fixed', value: 10000 }];
  const pricing = priceReservation(rigs, 1, config, promos, 999);
  assert.equal(pricing.discount, pricing.base);
  assert.equal(pricing.total, 0);
});

test('priceReservation: late-booking penalty applies only under the threshold', () => {
  const rigs = [{ type: 'standard' }];
  const withinThreshold = priceReservation(rigs, 1, config, [], 30); // < 60 min threshold
  const outsideThreshold = priceReservation(rigs, 1, config, [], 120);
  assert.ok(withinThreshold.penalty > 0);
  assert.equal(outsideThreshold.penalty, 0);
});

test('applyTuesdayPromotion: applies exactly 50% off on a Tuesday', () => {
  const tuesday = nextDateOnWeekday(2);
  const pricing = { base: 400, discount: 0, penalty: 0, total: 400 };
  const result = applyTuesdayPromotion(pricing, tuesday);
  assert.equal(result.tuesdayPromotionApplied, true);
  assert.equal(result.tuesdayDiscount, 200);
  assert.equal(result.total, 200);
  assert.equal(result.beforeTuesdayDiscount, 400);
});

test('applyTuesdayPromotion: no-op on any non-Tuesday', () => {
  const monday = nextDateOnWeekday(1);
  const pricing = { base: 400, discount: 0, penalty: 0, total: 400 };
  const result = applyTuesdayPromotion(pricing, monday);
  assert.equal(result, pricing); // same object back, untouched
  assert.equal(result.tuesdayPromotionApplied, undefined);
});

test('applyTuesdayPromotion: stacks on top of an already-applied normal promotion', () => {
  const tuesday = nextDateOnWeekday(2);
  // e.g. a 400 base with a 100 fixed promo already applied -> total 300 before Tuesday
  const pricing = { base: 400, discount: 100, penalty: 0, total: 300 };
  const result = applyTuesdayPromotion(pricing, tuesday);
  assert.equal(result.beforeTuesdayDiscount, 300);
  assert.equal(result.tuesdayDiscount, 150);
  assert.equal(result.total, 150);
});

test('findOverlappingLockdown: detects a lockdown that overlaps the requested window', () => {
  const lockdowns = [{ start: '10:00', end: '12:00', reason: 'Mantenimiento' }];
  const found = findOverlappingLockdown(lockdowns, hm('11:00'), hm('13:00'));
  assert.equal(found?.reason, 'Mantenimiento');
});

test('findOverlappingLockdown: a reservation ending exactly when the lockdown starts does not overlap', () => {
  const lockdowns = [{ start: '10:00', end: '12:00' }];
  const found = findOverlappingLockdown(lockdowns, hm('08:00'), hm('10:00'));
  assert.equal(found, undefined);
});

test('findOverlappingLockdown: a reservation starting exactly when the lockdown ends does not overlap', () => {
  const lockdowns = [{ start: '10:00', end: '12:00' }];
  const found = findOverlappingLockdown(lockdowns, hm('12:00'), hm('14:00'));
  assert.equal(found, undefined);
});

test('findOverlappingLockdown: no lockdowns means no match', () => {
  assert.equal(findOverlappingLockdown([], hm('10:00'), hm('11:00')), undefined);
});

test('slotIds: generates one id per slotMinutes-sized chunk, in range', () => {
  const ids = slotIds('2026-06-16', hm('10:00'), hm('11:00'), 30, 'rig-1');
  assert.deepEqual(ids, ['2026-06-16_1000_rig-1', '2026-06-16_1030_rig-1']);
});

test('bad(): attaches the given status, defaults to 400', () => {
  const err = bad('nope');
  assert.equal(err.status, 400);
  const err2 = bad('conflict', 409);
  assert.equal(err2.status, 409);
});

// isRigBookable: this is the actual fix for "maintenance/disabled rigs still
// show as bookable on the site". The admin rig editor writes a `status`
// string field, but the code that builds the public rig list used to only
// check separate `active`/`maintenance` booleans that are set once at rig
// creation (see scripts/seed.mjs) and never touched again afterward — so
// toggling a rig's status in the admin panel had no effect on what
// customers could book.
test('isRigBookable: status field is authoritative when present', () => {
  assert.equal(isRigBookable({ status: 'active' }), true);
  assert.equal(isRigBookable({ status: 'maintenance' }), false);
  assert.equal(isRigBookable({ status: 'disabled' }), false);
});

test('isRigBookable: status wins even if the legacy active boolean says otherwise', () => {
  // This is exactly the bug: a rig created with active:true (from the seed
  // script) that an admin later marks unavailable via `status`, without the
  // `active` boolean ever being touched again.
  assert.equal(isRigBookable({ status: 'maintenance', active: true }), false);
  assert.equal(isRigBookable({ status: 'disabled', active: true }), false);
});

test('isRigBookable: falls back to legacy booleans when there is no status field', () => {
  assert.equal(isRigBookable({ active: true }), true);
  assert.equal(isRigBookable({ active: true, maintenance: true }), false);
  assert.equal(isRigBookable({}), false); // no active flag at all -> not bookable
  assert.equal(isRigBookable({ maintenance: false }), false); // active still missing
});
