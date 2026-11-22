// CONFIGURACIÓN writes the same settings/reservations keys the public site
// reads (prices, hours), with the site's own defaults.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SITE_DEFAULT_HOURS,
  buildHoursPayload,
  buildPricesPayload,
  openHoursCount,
  readHours,
  readPrices
} from '../js/settings-logic.js';

test('readPrices falls back to the site defaults, not the old panel ones', () => {
  assert.deepEqual(readPrices({}), { standard: 200, premium: 400 });
  assert.deepEqual(readPrices({ prices: { premium: 380 } }), { standard: 200, premium: 380 });
  assert.deepEqual(readPrices({ prices: { standard: 0, premium: 400 } }), { standard: 0, premium: 400 });
  // The old `pricing` key never reached the site, so it is ignored.
  assert.deepEqual(readPrices({ pricing: { standard: 1, premium: 2 } }), { standard: 200, premium: 400 });
});

test('readHours merges saved days over the site defaults; null closes a day', () => {
  assert.deepEqual(readHours({}), SITE_DEFAULT_HOURS);
  const h = readHours({ hours: { 1: ['15:00', '20:00'], 6: null } });
  assert.deepEqual(h[1], ['15:00', '20:00']);
  assert.equal(h[6], null);
  assert.deepEqual(h[0], ['12:00', '21:00']);
});

test('buildHoursPayload writes all days, null for closed ones', () => {
  const { hours } = buildHoursPayload([
    { day: 1, closed: true, open: '14:00', close: '21:00' },
    { day: 2, closed: false, open: '14:00', close: '21:00' }
  ]);
  assert.deepEqual(hours, { 1: null, 2: ['14:00', '21:00'] });
});

test('buildHoursPayload rejects a close time before the open time', () => {
  assert.ok(buildHoursPayload([{ day: 2, closed: false, open: '21:00', close: '14:00' }]).error);
  assert.ok(buildHoursPayload([{ day: 2, closed: false, open: '', close: '14:00' }]).error);
});

test('buildPricesPayload validates and writes `prices`', () => {
  assert.deepEqual(buildPricesPayload({ standard: '200', premium: '400' }), { prices: { standard: 200, premium: 400 } });
  assert.ok(buildPricesPayload({ standard: '', premium: '400' }).error);
  assert.ok(buildPricesPayload({ standard: '-5', premium: '400' }).error);
});

test('openHoursCount', () => {
  assert.equal(openHoursCount(['14:00', '21:00']), 7);
  assert.equal(openHoursCount(['12:30', '21:00']), 8.5);
  assert.equal(openHoursCount(null), 0);
});
