// RESERVAS: multi-hour cells, clashes, closed rows, lockdowns, the day
// summary, week view, search and contact links.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  calendarRowTimes,
  cellPart,
  dayHours,
  daySummary,
  isRowClosed,
  lockdownInRow,
  pendingCount,
  phoneDigits,
  reservationsInCell,
  searchReservations,
  telUrl,
  weekDates,
  weekOccupancy,
  whatsappUrl
} from '../js/calendar-logic.js';

const byId = (r, rig) => (r.rigs || []).some((x) => x.id === rig.id);
const std1 = { id: 'std-1' };
const std2 = { id: 'std-2' };

const res = (over) => ({
  id: 'r1', date: '2026-11-20', time: '14:00', duration: 1, status: 'approved',
  rigs: [{ id: 'std-1' }], pricing: { total: 200 }, ...over
});

test('calendar rows run 10 AM to 9 PM (last row 9-10 PM)', () => {
  const rows = calendarRowTimes();
  assert.equal(rows[0], '10:00');
  assert.equal(rows.at(-1), '21:00');
  assert.equal(rows.length, 12);
});

test('a 3-hour reservation fills every row it covers, not just the first', () => {
  const r = res({ duration: 3 });
  for (const t of ['14:00', '15:00', '16:00']) {
    assert.deepEqual(reservationsInCell([r], std1, t, byId), [r], t);
  }
  assert.deepEqual(reservationsInCell([r], std1, '13:00', byId), []);
  assert.deepEqual(reservationsInCell([r], std1, '17:00', byId), []);
  assert.deepEqual(reservationsInCell([r], std2, '15:00', byId), []);
});

test('cellPart labels the first, middle and last row', () => {
  const r = res({ duration: 3 });
  assert.equal(cellPart(r, '14:00'), 'start');
  assert.equal(cellPart(r, '15:00'), 'middle');
  assert.equal(cellPart(r, '16:00'), 'end');
  assert.equal(cellPart(res(), '14:00'), 'single');
});

test('a half-hour start still shows in the row it starts in and the next', () => {
  const r = res({ time: '14:30', duration: 1 });
  assert.equal(reservationsInCell([r], std1, '14:00', byId).length, 1);
  assert.equal(reservationsInCell([r], std1, '15:00', byId).length, 1);
  assert.equal(cellPart(r, '14:00'), 'start');
  assert.equal(cellPart(r, '15:00'), 'end');
});

test('two overlapping reservations on one rig both come back (a clash)', () => {
  const a = res({ id: 'a', duration: 2 });
  const b = res({ id: 'b', time: '15:00' });
  assert.deepEqual(reservationsInCell([a, b], std1, '15:00', byId).map((r) => r.id), ['a', 'b']);
});

test('rejected reservations never take a cell', () => {
  assert.deepEqual(reservationsInCell([res({ status: 'rejected' })], std1, '14:00', byId), []);
});

const HOURS = { 0: ['12:00', '21:00'], 2: ['14:00', '21:00'], 5: ['14:00', '21:00'] };

test('dayHours reads the site hours map (0 = Sunday, missing = closed)', () => {
  assert.deepEqual(dayHours(HOURS, '2026-11-20'), ['14:00', '21:00']); // Friday
  assert.deepEqual(dayHours(HOURS, '2026-11-22'), ['12:00', '21:00']); // Sunday
  assert.equal(dayHours(HOURS, '2026-11-16'), null); // Monday
  assert.equal(dayHours({ 1: null }, '2026-11-16'), null);
});

test('isRowClosed marks rows outside opening hours', () => {
  assert.equal(isRowClosed(HOURS, '2026-11-20', '13:00'), true);
  assert.equal(isRowClosed(HOURS, '2026-11-20', '14:00'), false);
  assert.equal(isRowClosed(HOURS, '2026-11-20', '20:00'), false);
  assert.equal(isRowClosed(HOURS, '2026-11-20', '21:00'), true);
  assert.equal(isRowClosed(HOURS, '2026-11-16', '15:00'), true);
});

test('lockdownInRow finds an overlapping, active lockdown on that date', () => {
  const locks = [
    { id: 'l1', date: '2026-11-20', start: '15:30', end: '17:00' },
    { id: 'l2', date: '2026-11-20', start: '18:00', end: '19:00', active: false }
  ];
  assert.equal(lockdownInRow(locks, '2026-11-20', '15:00')?.id, 'l1');
  assert.equal(lockdownInRow(locks, '2026-11-20', '16:00')?.id, 'l1');
  assert.equal(lockdownInRow(locks, '2026-11-20', '17:00'), null);
  assert.equal(lockdownInRow(locks, '2026-11-20', '18:00'), null);
  assert.equal(lockdownInRow(locks, '2026-11-21', '16:00'), null);
});

test('daySummary counts, splits income and computes occupancy', () => {
  const list = [
    res({ id: 'a', duration: 2 }),
    res({ id: 'b', status: 'pending', pricing: { total: 350 }, rigs: [{ id: 'std-1' }, { id: 'std-2' }] }),
    res({ id: 'c', status: 'rejected' }),
    res({ id: 'd', date: '2026-11-21' })
  ];
  const s = daySummary(list, '2026-11-20', 2, 7);
  assert.equal(s.total, 2);
  assert.equal(s.pending, 1);
  assert.equal(s.approved, 1);
  assert.equal(s.income, 200);
  assert.equal(s.pendingIncome, 350);
  // 2 rig-hours + 2 rig-hours of 14 available
  assert.equal(s.occupancy, 29);
  assert.equal(daySummary([], '2026-11-16', 2, 0).occupancy, 0);
});

test('pendingCount ignores past and resolved reservations', () => {
  const list = [
    res({ id: 'a', status: 'pending', date: '2026-11-22' }),
    res({ id: 'b', status: 'pending', date: '2026-11-30' }),
    res({ id: 'c', status: 'pending', date: '2026-11-21' }),
    res({ id: 'd', status: 'approved', date: '2026-11-25' })
  ];
  assert.equal(pendingCount(list, '2026-11-22'), 2);
});

test('weekDates runs Monday to Sunday, across month ends', () => {
  assert.deepEqual(weekDates('2026-11-22'), [
    '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'
  ]);
  assert.equal(weekDates('2026-12-01')[0], '2026-11-30');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('weekOccupancy counts busy rigs per hour and flags pending', () => {
  const list = [
    res({ id: 'a', duration: 2 }),
    res({ id: 'b', status: 'pending', rigs: [{ id: 'std-2' }], time: '15:00' })
  ];
  const grid = weekOccupancy(list, ['2026-11-20'], ['14:00', '15:00', '16:00'], [std1, std2], byId);
  assert.deepEqual(grid[0], [
    { busy: 1, pending: false },
    { busy: 2, pending: true },
    { busy: 0, pending: false }
  ]);
});

test('searchReservations matches code, accent-insensitive name and phone digits', () => {
  const list = [
    res({ id: 'a', code: 'INR-1234', customer: { name: 'José Pérez', phone: '9999-0000' } }),
    res({ id: 'b', code: 'ADM-5555', customer: { name: 'Ana', email: 'ana@example.com' }, date: '2026-12-20' })
  ];
  assert.deepEqual(searchReservations(list, 'inr-12').map((r) => r.id), ['a']);
  assert.deepEqual(searchReservations(list, 'jose').map((r) => r.id), ['a']);
  assert.deepEqual(searchReservations(list, '99990').map((r) => r.id), ['a']);
  assert.deepEqual(searchReservations(list, 'example').map((r) => r.id), ['b']);
  assert.deepEqual(searchReservations(list, 'a'), []); // too short
});

test('searchReservations puts the dates closest to today first', () => {
  const list = [
    res({ id: 'far', customer: { name: 'Luis' }, date: '2026-01-05' }),
    res({ id: 'near', customer: { name: 'Luis' }, date: '2026-11-21' })
  ];
  assert.deepEqual(searchReservations(list, 'luis', { today: '2026-11-22' }).map((r) => r.id), ['near', 'far']);
});

test('contact links add the 504 code to 8-digit Honduran numbers', () => {
  assert.equal(phoneDigits('9999-0000'), '50499990000');
  assert.equal(phoneDigits('+504 9999 0000'), '50499990000');
  assert.equal(phoneDigits('123'), '');
  assert.equal(whatsappUrl('9999-0000'), 'https://wa.me/50499990000');
  assert.equal(whatsappUrl('9999-0000', 'Hola José'), 'https://wa.me/50499990000?text=Hola%20Jos%C3%A9');
  assert.equal(whatsappUrl(''), '');
  assert.equal(telUrl('99990000'), 'tel:+50499990000');
});
