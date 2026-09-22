// Tests for creating a reservation from the admin panel (NUEVA RESERVA),
// driven through js/reservation-writes.js against the in-memory Firestore
// double in tests/helpers/fake-firestore.mjs.
//
// The thing worth pinning down here is the reservationLocks check. Manual
// reservations used to write only the `reservations` doc — no check against
// existing locks and no lock of their own — so the panel could double-book
// a rig/time that was already taken, silently, and leave that slot looking
// free to the public site (which does respect reservationLocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeFirestore, lockDoc, SERVER_TIMESTAMP } from './helpers/fake-firestore.mjs';
import { createManualReservation } from '../js/reservation-writes.js';
import { calculateReservationTotal, slotIds } from '../js/reservation-logic.js';

const TUESDAY = '2026-06-16';
const WEDNESDAY = '2026-06-17';

const STANDARD_1 = { id: 'std-1', name: 'Sim 1', type: 'standard', order: 1 };
const STANDARD_2 = { id: 'std-2', name: 'Sim 2', type: 'standard', order: 2 };
const PREMIUM_1 = { id: 'prem-1', name: 'Sim 9', type: 'premium', order: 9 };

// Mirrors what js/admin.js hands createManualReservation(): the form's
// values plus the totals calculateTotal() just returned.
function input(overrides = {}) {
  const base = {
    date: WEDNESDAY,
    time: '15:00',
    duration: 1,
    selectedRigs: [STANDARD_1],
    customer: { name: 'Ana Paz', email: 'ana@example.com', phone: '+504 9999-9999' },
    paymentMethod: 'efectivo',
    status: 'approved',
    code: 'ADM-123456',
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

test('creates the reservation doc with the customer, schedule and rigs from the form', async () => {
  const fake = createFakeFirestore();

  const { id } = await createManualReservation(fake.deps, input());
  const saved = fake.get('reservations', id);

  assert.equal(saved.code, 'ADM-123456');
  assert.equal(saved.source, 'admin');
  // Una reserva manual no tiene necesariamente un usuario de Firebase
  // detrás, así que uid queda en null a propósito.
  assert.equal(saved.uid, null);
  assert.deepEqual(saved.customer, {
    name: 'Ana Paz',
    email: 'ana@example.com',
    phone: '+504 9999-9999'
  });
  assert.equal(saved.date, WEDNESDAY);
  assert.equal(saved.time, '15:00');
  assert.equal(saved.duration, 1);
  assert.deepEqual(saved.rigs, [{
    id: 'std-1', rigId: 'std-1', name: 'Standard 1', type: 'standard', number: 1, pricePerHour: 200
  }]);
  assert.deepEqual(saved.payment, { method: 'efectivo' });
  assert.equal(saved.createdBy, 'admin-uid');
  assert.equal(saved.createdAt, SERVER_TIMESTAMP);
  assert.equal(saved.updatedAt, SERVER_TIMESTAMP);
});

test('an empty email or phone is stored as null, not as an empty string', async () => {
  const fake = createFakeFirestore();

  const { id } = await createManualReservation(fake.deps, input({
    customer: { name: 'Sin datos', email: '', phone: '' }
  }));

  assert.deepEqual(fake.get('reservations', id).customer, {
    name: 'Sin datos', email: null, phone: null
  });
});

test('a reservation created as approved records who approved it; a pending one does not', async () => {
  const fake = createFakeFirestore();

  const approved = await createManualReservation(fake.deps, input({ status: 'approved' }));
  assert.deepEqual(fake.get('reservations', approved.id).confirmation, {
    status: 'approved',
    approvedAt: SERVER_TIMESTAMP,
    approvedBy: 'admin-uid'
  });

  const pending = await createManualReservation(fake.deps, input({
    status: 'pending', time: '19:00'
  }));
  assert.deepEqual(fake.get('reservations', pending.id).confirmation, {
    status: 'pending',
    approvedAt: null,
    approvedBy: null
  });
});

test('locks every 30-minute slot of every selected rig, pointing at the new reservation', async () => {
  const fake = createFakeFirestore();

  const { id } = await createManualReservation(fake.deps, input({
    time: '15:00',
    duration: 2,
    selectedRigs: [STANDARD_1, PREMIUM_1]
  }));

  // 2h = 4 slots por rig, 2 rigs.
  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_prem-1', '2026-06-17_1500_std-1',
    '2026-06-17_1530_prem-1', '2026-06-17_1530_std-1',
    '2026-06-17_1600_prem-1', '2026-06-17_1600_std-1',
    '2026-06-17_1630_prem-1', '2026-06-17_1630_std-1'
  ]);

  for (const lock of fake.all('reservationLocks')) {
    assert.equal(lock.reservationId, id);
    assert.equal(lock.createdBy, 'admin-uid');
  }
});

test('the lock expires ~6h after the booking starts, not 6h after it was created', async () => {
  const fake = createFakeFirestore();

  await createManualReservation(fake.deps, input({ date: WEDNESDAY, time: '15:00' }));

  const lock = fake.get('reservationLocks', '2026-06-17_1500_std-1');
  assert.equal(lock.expiresAt.toDate().toISOString(), '2026-06-17T21:00:00.000Z');
});

test('the Tuesday discount reaches the saved pricing block', async () => {
  const fake = createFakeFirestore();

  const { id } = await createManualReservation(fake.deps, input({
    date: TUESDAY,
    duration: 2,
    selectedRigs: [STANDARD_1, PREMIUM_1]
  }));

  assert.deepEqual(fake.get('reservations', id).pricing, {
    beforeTuesdayDiscount: 1100,
    tuesdayDiscount: 550,
    tuesdayDiscountPercent: 50,
    tuesdayPromotionApplied: true,
    total: 550
  });
});

test('refuses to double-book a rig/time another reservation already holds', async () => {
  const fake = createFakeFirestore({
    reservationLocks: {
      '2026-06-17_1530_std-1': lockDoc({ reservationId: 'reserva-del-cliente' })
    }
  });

  // 15:00 + 1h se superpone con el lock de las 15:30.
  await assert.rejects(
    createManualReservation(fake.deps, input({ time: '15:00', duration: 1 })),
    (error) => error.code === 'slot-taken'
  );

  // Y nada quedó a medias: ni la reserva ni locks nuevos.
  assert.equal(fake.count('reservations'), 0);
  assert.deepEqual(fake.ids('reservationLocks'), ['2026-06-17_1530_std-1']);
  assert.equal(fake.get('reservationLocks', '2026-06-17_1530_std-1').reservationId, 'reserva-del-cliente');
});

test('a taken slot on any one of the selected rigs blocks the whole reservation', async () => {
  const fake = createFakeFirestore({
    reservationLocks: { '2026-06-17_1500_prem-1': lockDoc() }
  });

  await assert.rejects(
    createManualReservation(fake.deps, input({
      selectedRigs: [STANDARD_1, PREMIUM_1]
    })),
    (error) => error.code === 'slot-taken'
  );

  assert.equal(fake.count('reservations'), 0);
  // El rig libre tampoco quedó bloqueado por el intento fallido.
  assert.equal(fake.get('reservationLocks', '2026-06-17_1500_std-1'), undefined);
});

test('an expired lock does not block the slot', async () => {
  const fake = createFakeFirestore({
    reservationLocks: {
      '2026-06-17_1500_std-1': lockDoc({ expiresInHours: -1, reservationId: 'abandonada' })
    }
  });

  const { id } = await createManualReservation(fake.deps, input({ time: '15:00', duration: 1 }));

  // El lock vencido se pisa con el de la reserva nueva.
  assert.equal(fake.get('reservationLocks', '2026-06-17_1500_std-1').reservationId, id);
});

test('an adjacent booking on the same rig is allowed', async () => {
  const fake = createFakeFirestore();

  const first = await createManualReservation(fake.deps, input({ time: '15:00', duration: 1 }));
  // 16:00 arranca justo donde termina la anterior: slotIds() es
  // semiabierto, así que no se pisan.
  const second = await createManualReservation(fake.deps, input({ time: '16:00', duration: 1 }));

  assert.notEqual(first.id, second.id);
  assert.equal(fake.count('reservations'), 2);
  assert.deepEqual(fake.ids('reservationLocks'), [
    '2026-06-17_1500_std-1', '2026-06-17_1530_std-1',
    '2026-06-17_1600_std-1', '2026-06-17_1630_std-1'
  ]);
});

test('the same slot on a different rig is allowed', async () => {
  const fake = createFakeFirestore();

  await createManualReservation(fake.deps, input({ selectedRigs: [STANDARD_1] }));
  await createManualReservation(fake.deps, input({ selectedRigs: [STANDARD_2] }));

  assert.equal(fake.count('reservations'), 2);
  assert.equal(fake.count('reservationLocks'), 4);
});

test('the lock ids match slotIds(), the format the public site also writes', async () => {
  const fake = createFakeFirestore();

  const { lockIds } = await createManualReservation(fake.deps, input({
    time: '15:00', duration: 1, selectedRigs: [STANDARD_1]
  }));

  assert.deepEqual(lockIds, slotIds(WEDNESDAY, 15 * 60, 16 * 60, 'std-1'));
});
