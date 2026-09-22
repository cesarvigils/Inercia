// Minimal in-memory stand-in for the slice of the Firestore *client* SDK
// that js/reservation-writes.js actually uses (doc(), collection(),
// runTransaction() with transaction.get/set/update/delete, serverTimestamp()
// and Timestamp.fromDate()). Not a general-purpose Firestore emulator — just
// enough to drive the admin panel's two reservation writes without a real
// Firebase project.
//
// The same idea as tests/helpers/fake-firestore.mjs on `main`, but for the
// client SDK's shape rather than firebase-admin's: snapshots expose
// exists() as a method, and writes go through a transaction object instead
// of a batch.

// Sentinel written where the real SDK would write serverTimestamp(). Tests
// assert against this rather than a wall-clock value.
export const SERVER_TIMESTAMP = Symbol('serverTimestamp');

function fakeTimestamp(date) {
  return {
    toMillis: () => date.getTime(),
    toDate: () => new Date(date.getTime())
  };
}

export function createFakeFirestore(seed = {}) {
  // { collectionName: Map<docId, data> }
  const store = new Map();
  for (const [name, docs] of Object.entries(seed)) {
    store.set(name, new Map(Object.entries(docs).map(([id, d]) => [id, { ...d }])));
  }

  function collectionStore(name) {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  }

  let autoId = 0;

  const db = { __fake: true };

  function collection(dbArg, name) {
    if (dbArg !== db) throw new Error('fake-firestore: collection() called with a foreign db');
    return { __collection: name };
  }

  // doc(db, 'collection', 'id') — an explicit reference.
  // doc(collectionRef)        — a new auto-id reference, the way
  //                             createManualReservation allocates the
  //                             reservation id before the transaction runs.
  function doc(first, name, id) {
    if (first && first.__collection) {
      autoId += 1;
      return { __collection: first.__collection, id: `auto-${autoId}` };
    }
    if (first !== db) throw new Error('fake-firestore: doc() called with a foreign db');
    return { __collection: name, id };
  }

  function snapshotFor(ref) {
    const found = collectionStore(ref.__collection).get(ref.id);
    return {
      id: ref.id,
      exists: () => found !== undefined,
      data: () => (found === undefined ? undefined : { ...found })
    };
  }

  // Writes are buffered and only applied if the transaction body resolves,
  // so a throw (a taken slot, say) leaves the store untouched — the part of
  // the real transaction semantics these tests depend on.
  async function runTransaction(dbArg, updateFunction) {
    if (dbArg !== db) throw new Error('fake-firestore: runTransaction() called with a foreign db');

    const writes = [];
    let reads = 0;
    let wrote = false;

    const transaction = {
      async get(ref) {
        // Real Firestore transactions reject a read issued after a write;
        // keeping that rule here means a reordering that Firestore would
        // reject fails in the test suite too, instead of silently passing.
        if (wrote) throw new Error('fake-firestore: transaction.get() after a write');
        reads += 1;
        return snapshotFor(ref);
      },
      set(ref, data) {
        wrote = true;
        writes.push({ op: 'set', ref, data });
        return transaction;
      },
      update(ref, data) {
        wrote = true;
        writes.push({ op: 'update', ref, data });
        return transaction;
      },
      delete(ref) {
        wrote = true;
        writes.push({ op: 'delete', ref });
        return transaction;
      }
    };

    const result = await updateFunction(transaction);

    for (const write of writes) {
      const docs = collectionStore(write.ref.__collection);
      if (write.op === 'set') docs.set(write.ref.id, { ...write.data });
      else if (write.op === 'update') docs.set(write.ref.id, { ...(docs.get(write.ref.id) || {}), ...write.data });
      else docs.delete(write.ref.id);
    }

    return { result, reads, writes };
  }

  return {
    // The `deps` object js/admin.js builds from the real SDK, so the code
    // under test is called exactly the way production calls it.
    deps: {
      db,
      doc,
      collection,
      runTransaction,
      serverTimestamp: () => SERVER_TIMESTAMP,
      timestampFromDate: fakeTimestamp
    },

    // Inspection helpers for assertions.
    get(name, id) {
      const found = collectionStore(name).get(id);
      return found === undefined ? undefined : { ...found };
    },
    ids(name) {
      return [...collectionStore(name).keys()].sort();
    },
    count(name) {
      return collectionStore(name).size;
    },
    all(name) {
      return [...collectionStore(name).entries()].map(([id, data]) => ({ id, ...data }));
    }
  };
}

// An already-stored reservationLock. `expiresInHours` under 0 makes it an
// expired lock, which isLockSnapshotActive() must treat as free.
export function lockDoc({ reservationId = 'other-reservation', expiresInHours = 6 } = {}) {
  return {
    reservationId,
    createdBy: 'someone-else',
    expiresAt: fakeTimestamp(new Date(Date.now() + expiresInHours * 60 * 60 * 1000)),
    createdAt: SERVER_TIMESTAMP
  };
}
