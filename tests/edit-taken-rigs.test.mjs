// EDITAR RESERVA greys out simulators another reservation already holds for
// the chosen date/time, and the calendar's HORA column shows hour ranges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hourRangeLabel, takenRigIds } from '../js/reservation-logic.js';

const DATE = '2026-06-17';
const OTHER_DATE = '2026-06-18';

const STD_1 = { id: 'std-1', type: 'standard', order: 1 };
const STD_2 = { id: 'std-2', type: 'standard', order: 2 };
const PREM_1 = { id: 'prem-1', type: 'premium', order: 9 };
const RIGS = [STD_1, STD_2, PREM_1];

// Same shape as admin.js's matcher, reduced to ids for these fixtures.
const hasRig = (reservation, rig) => reservation.rigs.some((r) => r.id === rig.id);

const editing = { id: 'mine', date: DATE, time: '15:00', duration: 1, status: 'pending', rigs: [{ id: 'std-1' }] };

function taken(overrides = {}, reservations = []) {
  return [...takenRigIds({
    reservation: editing,
    currentRigIds: ['std-1'],
    reservations: [editing, ...reservations],
    date: DATE,
    time: '15:00',
    duration: 1,
    rigs: RIGS,
    hasRig,
    ...overrides
  })].sort();
}

test('a rig another reservation holds at that hour is taken', () => {
  const other = { id: 'x', date: DATE, time: '15:00', duration: 1, status: 'approved', rigs: [{ id: 'std-2' }] };
  assert.deepEqual(taken({}, [other]), ['std-2']);
});

test('a longer reservation that started earlier still blocks', () => {
  const other = { id: 'x', date: DATE, time: '14:00', duration: 2, status: 'pending', rigs: [{ id: 'prem-1' }] };
  assert.deepEqual(taken({}, [other]), ['prem-1']);
});

test('back-to-back reservations do not block each other', () => {
  const before = { id: 'a', date: DATE, time: '14:00', duration: 1, status: 'approved', rigs: [{ id: 'std-2' }] };
  const after = { id: 'b', date: DATE, time: '16:00', duration: 1, status: 'approved', rigs: [{ id: 'std-2' }] };
  assert.deepEqual(taken({}, [before, after]), []);
});

test('rejected reservations and other dates do not block', () => {
  const rejected = { id: 'a', date: DATE, time: '15:00', duration: 1, status: 'rejected', rigs: [{ id: 'std-2' }] };
  const elsewhere = { id: 'b', date: OTHER_DATE, time: '15:00', duration: 1, status: 'approved', rigs: [{ id: 'std-2' }] };
  assert.deepEqual(taken({}, [rejected, elsewhere]), []);
});

test('the reservation being edited never blocks itself', () => {
  assert.deepEqual(taken({ duration: 2 }), []);
});

test("the reservation's own rig stays selectable in the slot it already holds", () => {
  // A legacy double booking on std-1 at the same hour must not unselect
  // the rig the reservation already has.
  const clash = { id: 'x', date: DATE, time: '15:00', duration: 1, status: 'approved', rigs: [{ id: 'std-1' }] };
  assert.deepEqual(taken({}, [clash]), []);
});

test("the reservation's own rig is taken when extended into someone else's hour", () => {
  const next = { id: 'x', date: DATE, time: '16:00', duration: 1, status: 'approved', rigs: [{ id: 'std-1' }] };
  assert.deepEqual(taken({}, [next]), []);
  assert.deepEqual(taken({ duration: 2 }, [next]), ['std-1']);
});

test("the reservation's own rig is taken when moved to another day", () => {
  const there = { id: 'x', date: OTHER_DATE, time: '15:00', duration: 1, status: 'approved', rigs: [{ id: 'std-1' }] };
  assert.deepEqual(taken({ date: OTHER_DATE }, [there]), ['std-1']);
});

test('hourRangeLabel shows each calendar row as an hour range', () => {
  assert.equal(hourRangeLabel('10:00'), '10AM-11AM');
  assert.equal(hourRangeLabel('11:00'), '11AM-12PM');
  assert.equal(hourRangeLabel('12:00'), '12PM-1PM');
  assert.equal(hourRangeLabel('14:00'), '2PM-3PM');
  assert.equal(hourRangeLabel('21:00'), '9PM-10PM');
});
