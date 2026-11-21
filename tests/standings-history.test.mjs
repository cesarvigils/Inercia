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
    title: '11. Noviembre Interlagos', monthNumber: 11, month: 'Noviembre', year: 2026, circuito: 'Interlagos', kind: 'hotlap'
  });
  assert.equal(describeTab('12. Diciembre Abu Dhabi', now).year, 2025);
  assert.equal(describeTab('3. marzo Spa', now).month, 'Marzo');
  assert.deepEqual(
    [describeTab('11. Noviembre 2025 Monza', now).year, describeTab('11. Noviembre 2025 Monza', now).circuito],
    [2025, 'Monza']
  );
  assert.deepEqual(describeTab('Copa Inercia', now), {
    title: 'Copa Inercia', monthNumber: null, month: null, year: null, circuito: 'Copa Inercia', kind: 'other'
  });
  assert.equal(describeTab('13. Noviembre X', now).monthNumber, null, 'not a real month');
});

test('describeTab: F1 race tabs get kind race and their month, PTS is not a race tab', () => {
  const now = new Date(2026, 10, 20); // 20 Nov 2026
  const month = (title) => [describeTab(title, now).kind, describeTab(title, now).monthNumber];

  assert.deepEqual(month('NOV F1'), ['race', 11]);
  assert.deepEqual(month('OCT F1'), ['race', 10]);
  assert.deepEqual(month('AGosto F1'), ['race', 8]);
  assert.deepEqual(month('Septiembre F1'), ['race', 9]);
  assert.deepEqual(month('JUNIO F1'), ['race', 6]);
  assert.deepEqual(month('4. ABRIL F1'), ['race', 4]);
  assert.deepEqual(month('3.F1 JPN'), ['race', 3]);
  assert.equal(describeTab('F1 2026 PTS', now).kind, 'other');
});

test('parseRaceRows: header found by name, Piloto in C or D, Tiempo before LAP', async () => {
  const { parseRaceRows } = await import('../api/standings.js');

  // Early layout: Column 1 | Piloto | Contacto | Categoria | LAP | 2 hrs GRATIS
  const early = parseRaceRows([
    [],
    ['', '-'],
    ['', '', 'Column 1', 'Piloto', 'Contacto', 'Categoria', 'LAP', '2 hrs GRATIS', 'Asistio'],
    ['', '', '1', 'Cesar Vigil', '9999', 'Masculino', '1:31.200', 'x'],
    ['', '', '2', 'Ana', '', 'F', '', ''],
    ['', '', '3', 'Cesar Vigil', '', 'M', '1:30.900']
  ]);
  assert.deepEqual(early.map((d) => [d.name, d.gender, d.ms]), [
    ['Cesar Vigil', 'M', 91200],
    ['Ana', 'F', null],
    ['Cesar Vigil', 'M', 90900]
  ]);

  // Later layout: Piloto | Pagado | Contacto | Categoria | LAP | Tiempo
  const later = parseRaceRows([
    ['', '', 'Piloto', 'Pagado', 'Contacto', 'Categoría', 'LAP', 'Tiempo'],
    ['', '', 'Edwin Suazo', 'Sí', '', 'M', '12', '1:29.123']
  ]);
  assert.equal(later[0].timeStr, '1:29.123', 'Tiempo wins over a LAP that is not a time');

  assert.deepEqual(parseRaceRows([['no header here']]), []);
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

test('standings ?scope=all: race tabs read whole, after their month, with that month\'s track', async (t) => {
  process.env.SPREADSHEET_ID = 'sheet';
  process.env.GOOGLE_SHEETS_API_KEY = 'key';

  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 10, 20, 12).getTime() }); // Nov 2026

  const titles = ['NOV F1', '11. Noviembre Interlagos', 'F1 2026 PTS'];
  const calls = [];

  globalThis.fetch = async (url) => {
    calls.push(decodeURIComponent(String(url)));

    if (!String(url).includes('/values')) {
      return { ok: true, json: async () => ({ sheets: titles.map((title) => ({ properties: { title } })) }) };
    }

    return {
      ok: true,
      json: async () => ({
        valueRanges: [
          { values: [['', '', 'Piloto', 'Pagado', 'Contacto', 'Categoria', 'LAP', 'Tiempo'],
            ['', '', 'Cesar Vigil', '', '', 'M', '', '1:10.100'],
            ['', '', 'Cesar Vigil', '', '', 'M', '', '1:09.900']] },           // NOV F1
          { values: [['Cesar Vigil (S)', '', '', 'M', '', '1:08.000']] },        // Noviembre
          { values: [] }                                                         // PTS
        ]
      })
    };
  };

  const res = fakeRes();
  await standingsHandler({ method: 'GET', query: { scope: 'all' }, headers: {}, socket: { remoteAddress: '10.0.0.10' } }, res);

  assert.equal(res.statusCode, 200);
  assert.match(calls[1], /ranges='NOV F1'!A1:Z400&ranges='11\. Noviembre Interlagos'!C15:H168/);
  assert.deepEqual(res.body.tabs.map((tab) => [tab.title, tab.kind]), [
    ['11. Noviembre Interlagos', 'hotlap'],
    ['NOV F1', 'race'],
    ['F1 2026 PTS', 'other']
  ]);
  assert.equal(res.body.tabs[1].circuito, 'Interlagos');
  assert.deepEqual(res.body.tabs[1].drivers.map((d) => d.timeStr), ['1:10.100', '1:09.900']);
});
