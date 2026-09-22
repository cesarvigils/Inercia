// Pure-function tests for the total the admin panel shows and saves —
// no Firestore, no DOM. calculateReservationTotal() is what both
// calculateTotal() (NUEVA RESERVA) and calculateEditTotal() (EDITAR
// RESERVA) in js/admin.js call, so these cover the Tuesday 50% discount
// for the create and the edit form at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPricingFields,
  buildReservationRigs,
  calculateReservationTotal,
  isTuesday,
  rigPricePerHour
} from '../js/reservation-logic.js';

// Fixed dates rather than offsets from today, so the Tuesday cases can
// never drift onto another weekday depending on when the suite runs.
const TUESDAY = '2026-06-16';
const WEDNESDAY = '2026-06-17';

const RIGS = [
  { id: 'std-1', name: 'Sim 1', type: 'standard', order: 1 },
  { id: 'std-2', name: 'Sim 2', type: 'standard', order: 2 },
  { id: 'prem-1', name: 'Sim 9', type: 'premium', order: 9 },
  { id: 'custom', name: 'Sim 3', type: 'standard', order: 3, pricePerHour: 275 }
];

test('isTuesday: only Tuesdays, and midday-UTC so no timezone flips the day', () => {
  assert.equal(isTuesday(TUESDAY), true);
  assert.equal(isTuesday(WEDNESDAY), false);
  assert.equal(isTuesday('2026-06-15'), false); // lunes
  assert.equal(isTuesday(''), false);
  assert.equal(isTuesday(undefined), false);
});

test('rigPricePerHour: falls back to 200 standard / 350 premium', () => {
  assert.equal(rigPricePerHour({ type: 'standard' }), 200);
  assert.equal(rigPricePerHour({ type: 'premium' }), 350);
  assert.equal(rigPricePerHour({}), 200);                       // sin tipo => standard
  assert.equal(rigPricePerHour({ type: 'PREMIUM' }), 350);      // el tipo se normaliza
  assert.equal(rigPricePerHour({ type: 'premium', pricePerHour: 400 }), 400);
  assert.equal(rigPricePerHour({ type: 'standard', pricePerHour: 0 }), 0); // ?? no pisa el 0
});

test('calculateReservationTotal: sums each selected rig at its hourly price', () => {
  const result = calculateReservationTotal({
    rigs: RIGS,
    selectedIds: ['std-1', 'prem-1'],
    duration: 2,
    date: WEDNESDAY
  });

  assert.equal(result.subtotal, (200 + 350) * 2);
  assert.equal(result.tuesdayDiscount, 0);
  assert.equal(result.total, result.subtotal);
  assert.deepEqual(result.selectedRigs.map((rig) => rig.id), ['std-1', 'prem-1']);
});

test('calculateReservationTotal: ignores rigs that are not selected', () => {
  const result = calculateReservationTotal({
    rigs: RIGS,
    selectedIds: ['std-2'],
    duration: 1,
    date: WEDNESDAY
  });

  assert.equal(result.selectedRigs.length, 1);
  assert.equal(result.total, 200);
});

test('calculateReservationTotal: a rig with no selection at all totals 0', () => {
  const result = calculateReservationTotal({
    rigs: RIGS,
    selectedIds: [],
    duration: 3,
    date: TUESDAY
  });

  assert.equal(result.subtotal, 0);
  assert.equal(result.tuesdayDiscount, 0);
  assert.equal(result.total, 0);
});

test('calculateReservationTotal: Tuesday takes 50% off the subtotal', () => {
  const result = calculateReservationTotal({
    rigs: RIGS,
    selectedIds: ['std-1', 'prem-1'],
    duration: 2,
    date: TUESDAY
  });

  assert.equal(result.subtotal, 1100);
  assert.equal(result.tuesdayDiscount, 550);
  assert.equal(result.total, 550);
});

test('calculateReservationTotal: the same booking on a Wednesday gets no discount', () => {
  const tuesday = calculateReservationTotal({
    rigs: RIGS, selectedIds: ['std-1', 'std-2'], duration: 1, date: TUESDAY
  });
  const wednesday = calculateReservationTotal({
    rigs: RIGS, selectedIds: ['std-1', 'std-2'], duration: 1, date: WEDNESDAY
  });

  assert.equal(wednesday.subtotal, tuesday.subtotal);
  assert.equal(wednesday.total, tuesday.total * 2);
});

test('calculateReservationTotal: the Tuesday discount rounds to cents', () => {
  // 275/h por 1h con 50% off cae en .50 exacto; el redondeo a centavos
  // existe para que el total guardado nunca traiga decimales de punto
  // flotante largos.
  const result = calculateReservationTotal({
    rigs: RIGS, selectedIds: ['custom'], duration: 1, date: TUESDAY
  });

  assert.equal(result.subtotal, 275);
  assert.equal(result.tuesdayDiscount, 137.5);
  assert.equal(result.total, 137.5);
});

test('calculateReservationTotal: a missing/invalid duration counts as 1 hour', () => {
  const result = calculateReservationTotal({
    rigs: RIGS, selectedIds: ['std-1'], date: WEDNESDAY
  });

  assert.equal(result.total, 200);
});

test('buildPricingFields: a Tuesday booking is flagged as promoted, others are not', () => {
  const tuesday = buildPricingFields({ subtotal: 400, tuesdayDiscount: 200, total: 200 });
  assert.deepEqual(tuesday, {
    beforeTuesdayDiscount: 400,
    tuesdayDiscount: 200,
    tuesdayDiscountPercent: 50,
    tuesdayPromotionApplied: true,
    total: 200
  });

  const plain = buildPricingFields({ subtotal: 400, tuesdayDiscount: 0, total: 400 });
  assert.equal(plain.tuesdayDiscountPercent, 0);
  assert.equal(plain.tuesdayPromotionApplied, false);
});

test('buildReservationRigs: freezes name, type, number and price into the reservation', () => {
  // La reserva guarda una copia del rig para que editar el simulador
  // después (renombrarlo, subirle el precio) no altere reservas viejas.
  const rigs = buildReservationRigs([
    { id: 'prem-1', name: 'Lo que sea', type: 'Premium', order: 9 },
    { id: 'std-3', name: 'Sim 3', type: 'standard', order: 3, pricePerHour: 275 }
  ]);

  assert.deepEqual(rigs, [
    { id: 'prem-1', rigId: 'prem-1', name: 'Premium 1', type: 'premium', number: 1, pricePerHour: 350 },
    { id: 'std-3', rigId: 'std-3', name: 'Standard 3', type: 'standard', number: 3, pricePerHour: 275 }
  ]);
});
