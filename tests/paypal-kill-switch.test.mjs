// Integration test for the getPaypalRate() kill-switch bug fix (see
// api/_lib/paypal.js). Requires --experimental-test-module-mocks (set in
// package.json's "test" script) to intercept the Firestore import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { invalidateCache } from '../api/_lib/reservations.js';

const ORIGINAL_RATE_ENV = process.env.PAYPAL_HNL_USD_RATE;

test.afterEach(() => {
  mock.restoreAll();
  invalidateCache('paypalSettings');
  if (ORIGINAL_RATE_ENV === undefined) delete process.env.PAYPAL_HNL_USD_RATE;
  else process.env.PAYPAL_HNL_USD_RATE = ORIGINAL_RATE_ENV;
});

test('getPaypalRate: paypal.enabled=false actually blocks, does not fall back to the env rate', async () => {
  process.env.PAYPAL_HNL_USD_RATE = '24.5'; // if the bug were still there, this is what would leak through
  mock.module('../api/_lib/firebase-admin.js', {
    namedExports: {
      adminDb: {
        doc: () => ({
          async get() {
            return { exists: true, data: () => ({ paypal: { enabled: false, hnlPerUsd: 26 } }) };
          }
        })
      }
    }
  });

  const { getPaypalRate } = await import(`../api/_lib/paypal.js?case=disabled-${Date.now()}`);
  await assert.rejects(() => getPaypalRate(), (error) => {
    assert.equal(error.status, 503);
    assert.match(error.message, /desactivado/);
    return true;
  });
});

test('getPaypalRate: enabled=true reads the configured Firestore rate', async () => {
  mock.module('../api/_lib/firebase-admin.js', {
    namedExports: {
      adminDb: {
        doc: () => ({
          async get() {
            return { exists: true, data: () => ({ paypal: { enabled: true, hnlPerUsd: 26.75 } }) };
          }
        })
      }
    }
  });

  const { getPaypalRate } = await import(`../api/_lib/paypal.js?case=enabled-${Date.now()}`);
  assert.equal(await getPaypalRate(), 26.75);
});

test('getPaypalRate: a Firestore read failure still falls back to the env rate (unlike the kill switch)', async () => {
  process.env.PAYPAL_HNL_USD_RATE = '24.5';
  mock.module('../api/_lib/firebase-admin.js', {
    namedExports: {
      adminDb: {
        doc: () => ({
          async get() {
            throw new Error('simulated Firestore outage');
          }
        })
      }
    }
  });

  const { getPaypalRate } = await import(`../api/_lib/paypal.js?case=read-failure-${Date.now()}`);
  assert.equal(await getPaypalRate(), 24.5);
});

test('getPaypalRate: no Firestore doc and no env rate configured is a clear error, not a silent 0', async () => {
  delete process.env.PAYPAL_HNL_USD_RATE;
  mock.module('../api/_lib/firebase-admin.js', {
    namedExports: {
      adminDb: {
        doc: () => ({
          async get() {
            return { exists: false, data: () => undefined };
          }
        })
      }
    }
  });

  const { getPaypalRate } = await import(`../api/_lib/paypal.js?case=unconfigured-${Date.now()}`);
  await assert.rejects(() => getPaypalRate(), /no está configurada/);
});
