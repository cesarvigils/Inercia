// GET /api/standings?scope=year: every month of the year that has a tab,
// read with one tab listing + one values:batchGet (Sheets API stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: standingsHandler } = await import('../api/standings.js');

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; }
  };
}

test('standings ?scope=year: one batch read, months without a tab skipped', async (t) => {
  process.env.SPREADSHEET_ID = 'sheet';
  process.env.GOOGLE_SHEETS_API_KEY = 'key';

  // March 2026: January and March have tabs, February doesn't; April is in the future.
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 2, 20, 18) });

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(decodeURIComponent(String(url)));

    if (!String(url).includes('/values')) {
      return {
        ok: true,
        json: async () => ({
          sheets: ['1. Enero Monza', '3. Marzo Spa', '4. Abril Imola', 'Eventos']
            .map((title) => ({ properties: { title } }))
        })
      };
    }

    return {
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '1:20.500'], ['Ana', '', '', 'F', '', '']] },
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '2:01.250']] }
        ]
      })
    };
  };

  const res = fakeRes();
  await standingsHandler({ method: 'GET', query: { scope: 'year' }, headers: {}, socket: { remoteAddress: '10.0.0.9' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2, 'tab listing + one batchGet');
  assert.match(calls[1], /values:batchGet\?ranges='1\. Enero Monza'!C15:H168&ranges='3\. Marzo Spa'!C15:H168/);

  assert.equal(res.body.year, 2026);
  assert.deepEqual(res.body.months.map((m) => [m.monthNumber, m.month, m.circuito]), [
    [1, 'Enero', 'Monza'],
    [3, 'Marzo', 'Spa']
  ]);
  assert.equal(res.body.months[0].drivers[0].ms, 80500);
  assert.equal(res.body.months[0].drivers[1].ms, null);
  assert.equal(res.body.months[1].drivers[0].timeStr, '2:01.250');
});
