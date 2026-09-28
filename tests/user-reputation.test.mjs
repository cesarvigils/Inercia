// Tests for USUARIOS: the reputation score (5/5, minus one per rejected or
// no-show reservation), who a reservation belongs to, and the reads and
// writes behind the view.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUserRows,
  canMarkNoShow,
  filterUserRows,
  loadUserReputation,
  setNoShow
} from '../js/user-reputation.js';

const ANA = { id: 'uid-ana', name: 'Ana', email: 'ana@example.com', phone: '+504 9999-0001' };
const BETO = { id: 'uid-beto', name: 'Beto', email: 'Beto@Example.com', phoneNumber: '+504 9999-0002' };

test('a user with nothing against them is 5/5', () => {
  const [row] = buildUserRows([ANA], []);
  assert.equal(row.reputation, 5);
  assert.equal(row.rejected, 0);
  assert.equal(row.noShows, 0);
});

test('each rejected or no-show reservation takes one point', () => {
  const rows = buildUserRows([ANA], [
    { id: 'r1', uid: ANA.id, status: 'rejected' },
    { id: 'r2', uid: ANA.id, status: 'approved', noShow: true },
    { id: 'r3', uid: ANA.id, status: 'approved' },
    { id: 'r4', uid: ANA.id, status: 'pending' },
    { id: 'r5', uid: ANA.id, status: 'cancelled' },
    { id: 'r6', uid: ANA.id, status: 'approved', noShow: false }
  ]);
  assert.deepEqual(
    { reputation: rows[0].reputation, rejected: rows[0].rejected, noShows: rows[0].noShows },
    { reputation: 3, rejected: 1, noShows: 1 }
  );
});

test('the score never goes below 0', () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, uid: ANA.id, status: 'rejected' }));
  assert.equal(buildUserRows([ANA], many)[0].reputation, 0);
});

test('the same reservation read twice only counts once', () => {
  const r = { id: 'r1', uid: ANA.id, status: 'rejected' };
  assert.equal(buildUserRows([ANA], [r, r])[0].reputation, 4);
});

test('manual reservations (uid null) match the user by email, ignoring case', () => {
  const rows = buildUserRows([ANA, BETO], [
    { id: 'm1', uid: null, source: 'admin', status: 'rejected', customer: { email: ' beto@example.COM ' } }
  ]);
  assert.equal(rows.find((r) => r.id === BETO.id).reputation, 4);
  assert.equal(rows.find((r) => r.id === ANA.id).reputation, 5);
});

test('uid wins over a customer email that belongs to someone else', () => {
  const rows = buildUserRows([ANA, BETO], [
    { id: 'r1', uid: ANA.id, status: 'rejected', customer: { email: BETO.email } }
  ]);
  assert.equal(rows.find((r) => r.id === ANA.id).reputation, 4);
  assert.equal(rows.find((r) => r.id === BETO.id).reputation, 5);
});

test('reservations nobody registered for are ignored', () => {
  const rows = buildUserRows([ANA], [
    { id: 'r1', uid: null, status: 'rejected', customer: { email: 'walkin@example.com' } }
  ]);
  assert.equal(rows[0].reputation, 5);
});

test('rows are sorted by name and fall back to phoneNumber', () => {
  const rows = buildUserRows([BETO, ANA], []);
  assert.deepEqual(rows.map((r) => r.id), [ANA.id, BETO.id]);
  assert.equal(rows[1].phone, '+504 9999-0002');
});

test('search matches name, email or phone', () => {
  const rows = buildUserRows([ANA, BETO], []);
  assert.deepEqual(filterUserRows(rows, 'beto').map((r) => r.id), [BETO.id]);
  assert.deepEqual(filterUserRows(rows, '0001').map((r) => r.id), [ANA.id]);
  assert.equal(filterUserRows(rows, '  ').length, 2);
});

test('no-show only on an approved reservation that already started', () => {
  const now = new Date('2026-06-17T15:30');
  assert.equal(canMarkNoShow({ status: 'approved', date: '2026-06-17', time: '15:00' }, now), true);
  assert.equal(canMarkNoShow({ status: 'approved', date: '2026-06-17', time: '16:00' }, now), false);
  assert.equal(canMarkNoShow({ status: 'pending', date: '2026-06-16', time: '15:00' }, now), false);
  assert.equal(canMarkNoShow({ status: 'rejected', date: '2026-06-16', time: '15:00' }, now), false);
});

// Minimal stand-ins for the client SDK calls loadUserReputation/setNoShow use.
function fakeDeps(collections) {
  const reads = [];
  const writes = [];
  return {
    reads,
    writes,
    db: {},
    collection: (_db, name) => ({ name }),
    query: (ref, filter) => ({ ...ref, filter }),
    where: (field, op, value) => ({ field, op, value }),
    doc: (_db, name, id) => ({ name, id }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    getDocs: async (ref) => {
      reads.push(ref);
      let docs = collections[ref.name] || [];
      if (ref.filter) docs = docs.filter((d) => d[ref.filter.field] === ref.filter.value);
      return { docs: docs.map(({ id, ...data }) => ({ id, data: () => data })) };
    },
    updateDoc: async (ref, data) => { writes.push({ ref, data }); }
  };
}

test('loadUserReputation reads users plus only the reservations that count', async () => {
  const deps = fakeDeps({
    users: [ANA, BETO],
    reservations: [
      { id: 'r1', uid: ANA.id, status: 'rejected' },
      { id: 'r2', uid: ANA.id, status: 'approved', noShow: true },
      { id: 'r3', uid: BETO.id, status: 'approved' }
    ]
  });
  const rows = await loadUserReputation(deps);
  assert.equal(rows.find((r) => r.id === ANA.id).reputation, 3);
  assert.equal(rows.find((r) => r.id === BETO.id).reputation, 5);
  assert.deepEqual(
    deps.reads.map((r) => r.filter ? `${r.name}:${r.filter.field}==${r.filter.value}` : r.name),
    ['users', 'reservations:status==rejected', 'reservations:noShow==true']
  );
});

test('setNoShow writes the flag and who set it, without touching status', async () => {
  const deps = fakeDeps({});
  await setNoShow(deps, { id: 'r1', status: 'approved', date: '2020-01-01', time: '10:00' }, true, 'admin-1');
  assert.deepEqual(deps.writes, [{
    ref: { name: 'reservations', id: 'r1' },
    data: { noShow: true, noShowAt: 'SERVER_TIMESTAMP', noShowBy: 'admin-1', updatedAt: 'SERVER_TIMESTAMP' }
  }]);
});

test('setNoShow can clear the flag, and refuses to mark a future reservation', async () => {
  const deps = fakeDeps({});
  await setNoShow(deps, { id: 'r1', status: 'approved', date: '2020-01-01', noShow: true }, false, 'admin-1');
  assert.equal(deps.writes[0].data.noShow, false);
  assert.equal(deps.writes[0].data.noShowBy, null);
  await assert.rejects(
    setNoShow(deps, { id: 'r2', status: 'approved', date: '2999-01-01', time: '10:00' }, true, 'admin-1')
  );
  assert.equal(deps.writes.length, 1);
});
