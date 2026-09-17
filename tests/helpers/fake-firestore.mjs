// Minimal in-memory stand-in for the slice of the Firestore Admin SDK this
// codebase actually uses (doc().get(), collection().where('==').get(),
// getAll(...refs)). Not a general-purpose Firestore emulator — just enough
// to drive api/_lib/reservations.js and the handlers built on it without a
// real Firebase project.
export function createFakeFirestore(seed = {}) {
  const store = {};
  for (const [collection, docs] of Object.entries(seed)) {
    store[collection] = docs.map((d) => ({ ...d }));
  }

  function snapshotFor(collection, id) {
    const found = (store[collection] || []).find((d) => d.id === id);
    return {
      exists: Boolean(found),
      id,
      data: () => (found ? { ...found } : undefined)
    };
  }

  function docRef(path) {
    const [collection, id] = path.split('/');
    return {
      id,
      async get() {
        return snapshotFor(collection, id);
      }
    };
  }

  function collectionRef(name) {
    const filters = [];
    let idRange = null; // { start, end } — set via orderBy(documentId()).startAt()/.endAt()
    const ref = {
      where(field, op, value) {
        if (op !== '==') throw new Error(`fake-firestore: unsupported operator "${op}"`);
        filters.push({ field, value });
        return ref;
      },
      // Only supports ordering by document ID (the one pattern this codebase
      // actually uses, in getLockedSlotIds) — the argument itself (normally
      // FieldPath.documentId()) is ignored, since there's only one thing it
      // could mean here.
      orderBy() {
        idRange = idRange || {};
        return ref;
      },
      startAt(value) {
        idRange = { ...idRange, start: value };
        return ref;
      },
      endAt(value) {
        idRange = { ...idRange, end: value };
        return ref;
      },
      async get() {
        let docs = store[name] || [];
        for (const f of filters) docs = docs.filter((d) => d[f.field] === f.value);
        if (idRange) {
          docs = docs.filter((d) =>
            (idRange.start === undefined || d.id >= idRange.start) &&
            (idRange.end === undefined || d.id <= idRange.end)
          );
        }
        return {
          empty: docs.length === 0,
          docs: docs.map((d) => ({
            id: d.id,
            exists: true,
            data: () => { const { id: _id, ...rest } = d; return rest; }
          }))
        };
      },
      doc() {
        return docRef(`${name}/__auto__`);
      }
    };
    return ref;
  }

  return {
    doc: docRef,
    collection: collectionRef,
    async getAll(...refs) {
      return Promise.all(refs.map((ref) => ref.get()));
    },
    // Lets a test change what a collection returns between assertions,
    // without re-importing the module under test (see the comment in
    // tests/lockdown-enforcement.test.mjs about why re-importing per
    // assertion doesn't reliably re-mock a shared transitive dependency).
    setDocs(collection, docs) {
      store[collection] = docs.map((d) => ({ ...d }));
    }
  };
}

// Config object for node:test's mock.module('../api/_lib/firebase-admin.js', ...).
// Real modules importing from firebase-admin.js (api/_lib/http.js in
// particular, for adminAuth) need every export it normally provides to exist
// on the mock, even when a given test never touches most of them — mock.module
// replaces the whole module, it doesn't merge with the original.
export function mockFirebaseAdmin(adminDb, overrides = {}) {
  return {
    namedExports: {
      adminDb,
      adminAuth: { verifyIdToken: async () => { throw new Error('adminAuth not mocked for this test'); } },
      adminStorage: { bucket: () => ({ file: () => ({}) }) },
      adminRtdb: null,
      adminApp: {},
      ...overrides
    }
  };
}

// Matches the (req, res) shape api/_lib/http.js's json()/method()/rateLimit()
// expect, without needing an actual HTTP server.
export function createFakeReqRes({ method = 'GET', query = {}, body = {}, headers = {} } = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    end(payload) { this.body = payload; },
    get headersSent() { return this.body !== null; }
  };
  const req = {
    method,
    query,
    body,
    headers,
    socket: { remoteAddress: '127.0.0.1' }
  };
  return { req, res };
}
