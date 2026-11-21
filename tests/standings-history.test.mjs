// GET /api/standings?scope=all: every tab in the lap-time sheet (except
// Eventos), read with one tab listing + one values:batchGet (Sheets API stubbed).
import test from 'node:test';
import assert from 'node:assert/strict';

const { default: standingsHandler, describeTab } = await import('../api/standings.js');

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

test('describeTab: month tabs get a year, a later month is last year, other tabs kept as is', () => {
  const now = new Date(2026, 10, 20); // 20 Nov 2026

  assert.deepEqual(describeTab('11. Noviembre Interlagos', now), {
    title: '11. Noviembre Interlagos', monthNumber: 11, month: 'Noviembre', year: 2026, circuito: 'Interlagos'
  });
  assert.equal(describeTab('12. Diciembre Abu Dhabi', now).year, 2025);
  assert.equal(describeTab('3. marzo Spa', now).month, 'Marzo');
  assert.deepEqual(
    [describeTab('11. Noviembre 2025 Monza', now).year, describeTab('11. Noviembre 2025 Monza', now).circuito],
    [2025, 'Monza']
  );
  assert.deepEqual(describeTab('Copa Inercia', now), {
    title: 'Copa Inercia', monthNumber: null, month: null, year: null, circuito: 'Copa Inercia'
  });
  assert.equal(describeTab('13. Noviembre X', now).monthNumber, null, 'not a real month');
});

test('standings ?scope=all: every tab but Eventos, one batch read, newest month first', async (t) => {
  process.env.SPREADSHEET_ID = 'sheet';
  process.env.GOOGLE_SHEETS_API_KEY = 'key';

  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 2, 20, 12).getTime() }); // March 2026

  const titles = ['1. Enero Monza', 'Eventos', '3. Marzo Spa', '12. Diciembre Imola', 'Copa Inercia'];
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(decodeURIComponent(String(url)));

    if (!String(url).includes('/values')) {
      return { ok: true, json: async () => ({ sheets: titles.map((title) => ({ properties: { title } })) }) };
    }

    // One valueRange per requested tab, in request order (Eventos excluded).
    return {
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '1:20.500'], ['Ana', '', '', 'F', '', '']] }, // Enero
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '2:01.250']] },                               // Marzo
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '1:30.000']] },                               // Diciembre (2025)
          { values: [['Nota suelta']] }                                                                 // Copa Inercia
        ]
      })
    };
  };

  const res = fakeRes();
  await standingsHandler({ method: 'GET', query: { scope: 'all' }, headers: {}, socket: { remoteAddress: '10.0.0.9' } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2, 'tab listing + one batchGet');
  assert.doesNotMatch(calls[1], /Eventos/);
  assert.match(calls[1], /ranges='1\. Enero Monza'!C15:H168&ranges='3\. Marzo Spa'!C15:H168/);

  assert.equal(res.body.currentYear, 2026);
  assert.equal(res.body.currentMonth, 3);
  assert.deepEqual(res.body.tabs.map((tab) => [tab.title, tab.year]), [
    ['3. Marzo Spa', 2026],
    ['1. Enero Monza', 2026],
    ['12. Diciembre Imola', 2025],
    ['Copa Inercia', null]
  ]);
  assert.equal(res.body.tabs[0].drivers[0].timeStr, '2:01.250');
  assert.equal(res.body.tabs[1].drivers[1].ms, null);
  assert.equal(res.body.tabs[3].drivers[0].ms, null, 'a non-standings layout yields no times');
});
