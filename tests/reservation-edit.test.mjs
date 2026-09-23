// Tests for EDITAR RESERVA in the admin panel: which reservations can be
// edited, what the payment <select> offers, and what saveReservationEdit()
// actually writes.
//
// Two cases this pass was specifically about:
//   1. Editing a pending reservation before approving it, instead of the
//      old workflow of rejecting it and re-creating it from scratch (which
//      made the WhatsApp bot send the client a fresh PDF each attempt).
//   2. Editing an already-approved PayPal reservation, which the panel
//      could not touch at all before, and whose payment method the edit
//      form would silently rewrite to "efectivo".
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, lockDoc, SERVER_TIMESTAMP } from './helpers/fake-firestore.mjs';
import { saveReservationEdit } from '../js/reservation-writes.js';
import {
  calculateReservationTotal,
  canEditReservation,
  currentPaymentMethod,
  paymentOptionsFor,
  planReservationEdit
} from '../js/reservation-logic.js';

const TUESDAY = '2026-06-16';
const WEDNESDAY = '2026-06-17';

const STANDARD_1 = { id: 'std-1', name: 'Sim 1', type: 'standard', order: 1 };
const STANDARD_2 = { id: 'std-2', name: 'Sim 2', type: 'standard', order: 2 };
const PREMIUM_1 = { id: 'prem-1', name: 'Sim 9', type: 'premium', order: 9 };

// A reservation as it sits in Firestore, plus the locks it already holds,
// so an edit starts from the same state a real one would.
function seeded({ reservation = {}, extraLocks = {} } = {}) {
  const saved = {
    id: 'res-1',
    code: 'ADM-000001',
    date: WEDNESDAY,
    time: '15:00',
    duration: 1,
    status: 'pending',
    rigs: [{ id: 'std-1', rigId: 'std-1', name: 'Standard 1', type: 'standard', number: 1, pricePerHour: 200 }],
    payment: { method: 'efectivo' },
    pricing: {
      beforeTuesdayDiscount: 200, tuesdayDiscount: 0,
      tuesdayDiscountPercent: 0, tuesdayPromotionApplied: false, total: 200
    },
    confirmation: { status: 'pending', approvedAt: null, approvedBy: null },
    ...reservation
  };

  const ownLocks = {};
  const hours = Number(saved.duration) || 1;
  for (const rig of saved.rigs) {
    for (let i = 0; i < hours * 2; i += 1) {
      const minutes = Number(saved.time.split(':')[0]) * 60 + Number(saved.time.split(':')[1]) + i * 30;
      const id = `${saved.date}_${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}_${rig.id}`;
      ownLocks[id] = { ...lockDoc({ reservationId: saved.id }), createdBy: 'admin-original' };
    }
  }

  const { id, ...data } = saved;
  const fake = createFakeFirestore({
    reservations: { [id]: data },
    reservationLocks: { ...ownLocks, ...extraLocks }
  });

  return { fake, reservation: saved };
}

// Mirrors what js/admin.js hands saveReservationEdit(): the form's values
// plus the totals calculateEditTotal() just returned.
function edit(reservation, overrides = {}) {
  const base = {
    reservation,
    currentRigIds: reservation.rigs.map((rig) => rig.id),
    date: reservation.date,
    time: reservation.time,
    duration: reservation.duration,
    selectedRigs: [STANDARD_1],
    paymentMethod: currentPaymentMethod(reservation),
    uid: 'admin-uid'
  };

  const merged = { ...base, ...overrides };

  const { subtotal, tuesdayDiscount, total } = calculateReservationTotal({
    rigs: merged.selectedRigs,
    selectedIds: merged.selectedRigs.map((rig) => rig.id),
    duration: merged.duration,
    date: merged.date
  });

  return { ...merged, pricing: { subtotal, tuesdayDiscount, total } };
}

/* ============================================================
   QUÉ SE PUEDE EDITAR
   ============================================================ */

test('canEditReservation: pending and approved yes, rejected no', () => {
  // EDITAR sigue disponible después de aprobar porque una reserva de
  // PayPal se aprueba sola al capturarse el pago; una rejected ya no
  // cuenta para el calendario ni para disponibilidad.
  assert.equal(canEditReservation('pending'), true);
  assert.equal(canEditReservation('approved'), true);
  assert.equal(canEditReservation('rejected'), false);
  assert.equal(canEditReservation(undefined), false);
});

/* ============================================================
   MÉTODO DE PAGO
   ============================================================ */

test('currentPaymentMethod: reads the object or the legacy string field', () => {
  assert.equal(currentPaymentMethod({ payment: { method: 'transferencia' } }), 'transferencia');
  assert.equal(currentPaymentMethod({ payment: 'tarjeta' }), 'tarjeta');
  assert.equal(currentPaymentMethod({}), 'efectivo');
});

test('paymentOptionsFor: the three editable methods, with the current one selected', () => {
  const options = paymentOptionsFor('transferencia');

  assert.deepEqual(options.map((o) => o.value), ['efectivo', 'transferencia', 'tarjeta']);
  assert.deepEqual(options.filter((o) => o.selected).map((o) => o.value), ['transferencia']);
});

test('paymentOptionsFor: PayPal gets a fallback option so it stays selected', () => {
  // Sin esta opción de respaldo el <select> cae en la primera opción
  // (EFECTIVO) sin marcarla, y guardar sin tocar el campo le cambiaría el
  // método de pago real a "efectivo" en silencio.
  const options = paymentOptionsFor('paypal');

  assert.deepEqual(options.map((o) => o.value), ['efectivo', 'transferencia', 'tarjeta', 'paypal']);
  assert.deepEqual(options.filter((o) => o.selected).map((o) => o.value), ['paypal']);
  assert.equal(options.at(-1).label, 'PAYPAL');
});

/* ============================================================
   RECONCILIACIÓN DE LOCKS
   ============================================================ */

test('planReservationEdit: only the slots the reservation did not already hold are checked', () => {
  const plan = planReservationEdit({
    reservation: { id: 'res-1', date: WEDNESDAY, time: '15:00', duration: 2 },
    currentRigIds: ['std-1'],
    date: WEDNESDAY,
    time: '16:00',
    duration: 2,
    selectedRigs: [STANDARD_1]
  });

  // Viejo 15:00-17:00, nuevo 16:00-18:00: 16:00 y 16:30 ya eran suyos.
  assert.deepEqual(plan.idsToRelease, ['2026-06-17_1500_std-1', '2026-06-17_1530_std-1']);
  assert.deepEqual(plan.idsToCheck, ['2026-06-17_1700_std-1', '2026-06-17_1730_std-1']);
});

test('planReservationEdit: saving without changing anything touches no lock at all', () => {
  const plan = planReservationEdit({
    reservation: { id: 'res-1', date: WEDNESDAY, time: '15:00', duration: 1 },
    currentRigIds: ['std-1'],
    date: WEDNESDAY,
    time: '15:00',
    duration: 1,
    selectedRigs: [STANDARD_1]
  });

  assert.deepEqual(plan.idsToRelease, []);
  assert.deepEqual(plan.idsToCheck, []);
});

/* ============================================================
   EDITAR ANTES DE APROBAR
   ============================================================ */

test('editing a pending reservation moves it, and moves its locks with it', async () => {
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' }));

  const saved = fake.get('reservations', 'res-1');
  assert.equal(saved.time, '18:00');
  assert.equal(saved.date, WEDNESDAY);
  assert.equal(saved.updatedAt, SERVER_TIMESTAMP);

  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1800_std-1', '2026-06-17_1830_std-1'
  ]);
  assert.equal(fake.get('reservationLocks', '2026-06-17_1800_std-1').reservationId, 'res-1');
  assert.equal(fake.get('reservationLocks', '2026-06-17_1800_std-1').createdBy, 'admin-uid');
});

test('editing does not approve, reject or otherwise change the reservation status', async () => {
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' }));

  const saved = fake.get('reservations', 'res-1');
  assert.equal(saved.status, 'pending');
  assert.deepEqual(saved.confirmation, { status: 'pending', approvedAt: null, approvedBy: null });
  // El código y el cliente tampoco se tocan.
  assert.equal(saved.code, 'ADM-000001');
});

test('adding a rig re-prices the reservation and locks the added rig', async () => {
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, {
    selectedRigs: [STANDARD_1, PREMIUM_1]
  }));

  const saved = fake.get('reservations', 'res-1');
  assert.deepEqual(saved.rigs.map((rig) => rig.id), ['std-1', 'prem-1']);
  assert.equal(saved.pricing.total, 550);

  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_prem-1', '2026-06-17_1500_std-1',
    '2026-06-17_1530_prem-1', '2026-06-17_1530_std-1'
  ]);
});

test('swapping the rig releases the old one for anyone else to book', async () => {
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, { selectedRigs: [STANDARD_2] }));

  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_std-2', '2026-06-17_1530_std-2'
  ]);
  assert.deepEqual(fake.get('reservations', 'res-1').rigs.map((rig) => rig.id), ['std-2']);
});

test('moving a booking onto a Tuesday applies the 50% discount to the saved pricing', async () => {
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, { date: TUESDAY }));

  assert.deepEqual(fake.get('reservations', 'res-1').pricing, {
    beforeTuesdayDiscount: 200,
    tuesdayDiscount: 100,
    tuesdayDiscountPercent: 50,
    tuesdayPromotionApplied: true,
    total: 100
  });
});

test('moving a booking off a Tuesday drops the discount again', async () => {
  const { fake, reservation } = seeded({
    reservation: {
      date: TUESDAY,
      pricing: {
        beforeTuesdayDiscount: 200, tuesdayDiscount: 100,
        tuesdayDiscountPercent: 50, tuesdayPromotionApplied: true, total: 100
      }
    }
  });

  await saveReservationEdit(fake.deps, edit(reservation, { date: WEDNESDAY }));

  assert.deepEqual(fake.get('reservations', 'res-1').pricing, {
    beforeTuesdayDiscount: 200,
    tuesdayDiscount: 0,
    tuesdayDiscountPercent: 0,
    tuesdayPromotionApplied: false,
    total: 200
  });
});

test('keeping the same slot leaves its existing lock untouched', async () => {
  const { fake, reservation } = seeded({ reservation: { duration: 2 } });

  // 15:00-17:00 pasa a 16:00-18:00: las 16:00 y 16:30 ya eran suyas.
  await saveReservationEdit(fake.deps, edit(reservation, { time: '16:00', duration: 2 }));

  assert.equal(fake.get('reservationLocks', '2026-06-17_1600_std-1').createdBy, 'admin-original');
  assert.equal(fake.get('reservationLocks', '2026-06-17_1700_std-1').createdBy, 'admin-uid');
  assert.equal(fake.get('reservationLocks', '2026-06-17_1500_std-1'), undefined);
});

test('refuses to move a reservation onto a slot someone else already holds', async () => {
  const { fake, reservation } = seeded({
    extraLocks: { '2026-06-17_1800_std-1': lockDoc({ reservationId: 'otra-reserva' }) }
  });

  await assert.rejects(
    saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' })),
    (error) => error.code === 'slot-taken'
  );

  // La reserva sigue donde estaba y con sus locks originales.
  assert.equal(fake.get('reservations', 'res-1').time, '15:00');
  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_std-1', '2026-06-17_1530_std-1', '2026-06-17_1800_std-1'
  ]);
  assert.equal(fake.get('reservationLocks', '2026-06-17_1800_std-1').reservationId, 'otra-reserva');
});

test('a reservation can be saved unchanged without colliding with its own locks', async () => {
  // El bug obvio de reconciliar locks: revisar los slots que la reserva ya
  // tenía y rebotar contra sí misma.
  const { fake, reservation } = seeded();

  await saveReservationEdit(fake.deps, edit(reservation, { paymentMethod: 'tarjeta' }));

  assert.deepEqual(fake.get('reservations', 'res-1').payment, { method: 'tarjeta' });
  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_std-1', '2026-06-17_1530_std-1'
  ]);
  assert.equal(fake.get('reservationLocks', '2026-06-17_1500_std-1').createdBy, 'admin-original');
});

/* ============================================================
   EDITAR UNA RESERVA DE PAYPAL YA APROBADA
   ============================================================ */

const PAYPAL_RESERVATION = {
  id: 'res-1',
  code: 'RES-PAYPAL',
  status: 'approved',
  payment: { method: 'paypal', orderId: 'PAYPAL-ORDER-9', captureId: 'CAPTURE-9' },
  confirmation: { status: 'approved', approvedAt: 'ya-aprobada', approvedBy: 'paypal-webhook' }
};

test('an approved PayPal reservation can be edited at all', async () => {
  const { fake, reservation } = seeded({ reservation: PAYPAL_RESERVATION });

  assert.equal(canEditReservation(reservation.status), true);

  await saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' }));

  assert.equal(fake.get('reservations', 'res-1').time, '18:00');
  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1800_std-1', '2026-06-17_1830_std-1'
  ]);
});

test('editing an approved PayPal reservation keeps it approved', async () => {
  const { fake, reservation } = seeded({ reservation: PAYPAL_RESERVATION });

  await saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' }));

  const saved = fake.get('reservations', 'res-1');
  assert.equal(saved.status, 'approved');
  assert.deepEqual(saved.confirmation, {
    status: 'approved', approvedAt: 'ya-aprobada', approvedBy: 'paypal-webhook'
  });
});

test('editing an approved PayPal reservation does not rewrite its method to efectivo', async () => {
  // El formulario solo ofrece efectivo/transferencia/tarjeta; el método
  // real viaja desde paymentOptionsFor(), que le agrega PayPal como opción
  // seleccionada, hasta el submit. Guardar sin tocar ese campo tiene que
  // dejar el método como estaba.
  const { fake, reservation } = seeded({ reservation: PAYPAL_RESERVATION });

  const selected = paymentOptionsFor(currentPaymentMethod(reservation))
    .find((option) => option.selected).value;

  await saveReservationEdit(fake.deps, edit(reservation, {
    time: '18:00',
    paymentMethod: selected
  }));

  assert.equal(fake.get('reservations', 'res-1').payment.method, 'paypal');
});

test('an admin can still switch an approved PayPal reservation to another method', async () => {
  const { fake, reservation } = seeded({ reservation: PAYPAL_RESERVATION });

  await saveReservationEdit(fake.deps, edit(reservation, { paymentMethod: 'efectivo' }));

  assert.deepEqual(fake.get('reservations', 'res-1').payment, { method: 'efectivo' });
});

test('an approved reservation is refused the same as a pending one when its new slot is taken', async () => {
  const { fake, reservation } = seeded({
    reservation: PAYPAL_RESERVATION,
    extraLocks: { '2026-06-17_1800_std-1': lockDoc({ reservationId: 'otra-reserva' }) }
  });

  await assert.rejects(
    saveReservationEdit(fake.deps, edit(reservation, { time: '18:00' })),
    (error) => error.code === 'slot-taken'
  );

  assert.equal(fake.get('reservations', 'res-1').time, '15:00');
  assert.equal(fake.get('reservations', 'res-1').payment.method, 'paypal');
});
