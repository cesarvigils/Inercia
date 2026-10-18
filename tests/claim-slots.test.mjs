// claimSlots(): the lock check both booking paths (api/reservations/create.js
// and api/_lib/paypal-reservation.js) run inside their transaction. Covers
// the "Uno de esos simuladores acaba de ser reservado" 409 on rigs nobody
// had booked: locks left behind by a reservation that was cancelled,
// rejected or deleted, and the customer's own unpaid PayPal checkout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { createFakeFirestore, mockFirebaseAdmin } from './helpers/fake-firestore.mjs';

const fake = createFakeFirestore({ reservations: [], reservationLocks: [] });
mock.module('../api/_lib/firebase-admin.js', mockFirebaseAdmin(fake));

const { claimSlots } = await import('../api/_lib/reservations.js');

const LOCK = '2026-10-20_1600_rig-1';

function claim(uid = 'user-a') {
  return fake.runTransaction((transaction) =>
    claimSlots(transaction, [fake.doc(`reservationLocks/${LOCK}`)], uid)
  );
}

function seed(reservation, lock = { reservationId: reservation?.id }) {
  fake.setDocs('reservations', reservation ? [reservation] : []);
  fake.setDocs('reservationLocks', [{ id: LOCK, ...lock }]);
}

test('claimSlots: a free slot is claimed', async () => {
  fake.setDocs('reservations', []);
  fake.setDocs('reservationLocks', []);
  await claim();
});

for (const status of ['cancelled', 'rejected', 'expired', 'payment_failed']) {
  test(`claimSlots: a lock whose reservation is ${status} does not block`, async () => {
    seed({ id: 'old', uid: 'user-b', status });
    await claim();
  });
}

test('claimSlots: a lock whose reservation no longer exists does not block', async () => {
  seed(null, { reservationId: 'gone' });
  await claim();
});

for (const status of ['pending', 'approved', 'payment_pending']) {
  test(`claimSlots: another customer's ${status} reservation blocks with a 409`, async () => {
    seed({ id: 'live', uid: 'user-b', status });
    await assert.rejects(claim(), (error) => error.status === 409);
  });
}

test('claimSlots: a lock with no reservationId still blocks', async () => {
  seed(null, {});
  await assert.rejects(claim(), (error) => error.status === 409);
});

test("claimSlots: the customer's own unpaid PayPal checkout is cancelled instead of blocking", async () => {
  seed({ id: 'mine', uid: 'user-a', status: 'payment_pending' });
  await claim('user-a');
  assert.equal(fake.read('reservations', 'mine').status, 'cancelled');
});

test("claimSlots: the customer's own approved booking still blocks", async () => {
  seed({ id: 'mine', uid: 'user-a', status: 'approved' });
  await assert.rejects(claim('user-a'), (error) => error.status === 409);
  assert.equal(fake.read('reservations', 'mine').status, 'approved');
});

test('claimSlots: an expired lock does not block even if its reservation is live', async () => {
  seed({ id: 'live', uid: 'user-b', status: 'payment_pending' }, { reservationId: 'live', expiresAt: { toMillis: () => Date.now() - 1000 } });
  await claim();
});
