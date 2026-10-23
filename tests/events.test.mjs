// Tests for the "Eventos" Google Sheet reader (api/_lib/events.js) and
// GET /api/events, with the Sheets API stubbed as a global fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeReqRes } from './helpers/fake-firestore.mjs';
import {
  parseSheetDate,
  parseSheetTime,
  parseEventRows,
  todayInHonduras
} from '../api/_lib/events.js';

const { default: eventsHandler } = await import('../api/events.js');

// 46341 is 2026-11-15 as a Google Sheets serial date; .75 is 18:00.
const NOV_15 = 46341;

test('parseSheetDate: serial numbers and the two text formats', () => {
  assert.equal(parseSheetDate(NOV_15), '2026-11-15');
  assert.equal(parseSheetDate('15/11/2026'), '2026-11-15');
  assert.equal(parseSheetDate('2026-11-15'), '2026-11-15');
  assert.equal(parseSheetDate('31/02/2026'), null);
  assert.equal(parseSheetDate('mañana'), null);
  assert.equal(parseSheetDate(''), null);
});

test('parseSheetTime: time fractions and HH:MM text', () => {
  assert.equal(parseSheetTime(0.75), '18:00');
  assert.equal(parseSheetTime(NOV_15 + 0.5), '12:00');
  assert.equal(parseSheetTime('9:30'), '09:30');
  assert.equal(parseSheetTime('25:00'), null);
  assert.equal(parseSheetTime(''), null);
});

test('todayInHonduras: uses UTC-6', () => {
  assert.equal(todayInHonduras(Date.parse('2026-11-15T05:00:00Z')), '2026-11-14');
  assert.equal(todayInHonduras(Date.parse('2026-11-15T07:00:00Z')), '2026-11-15');
});

test('parseEventRows: upcoming only, soonest first, optional columns left null', () => {
  const rows = [
    ['Copa Inercia - Fecha 3', NOV_15 + 7, 0.75, 'Monza', 'F1 2025', 'Inscripciones abiertas', 'https://inerciahn.com/reservas'],
    ['Evento pasado', NOV_15 - 30, 0.5, 'Spa'],
    ['Noche GT3', '20/11/2026', '20:30', '', 'GT3', '', 'javascript:alert(1)'],
    ['', NOV_15 + 1],
    ['Sin fecha', ''],
    ['Hoy', NOV_15]
  ];

  const events = parseEventRows(rows, '2026-11-15');

  assert.deepEqual(events.map((e) => e.name), ['Hoy', 'Noche GT3', 'Copa Inercia - Fecha 3']);
  assert.deepEqual(events[2], {
    id: 'fila-2',
    name: 'Copa Inercia - Fecha 3',
    date: '2026-11-22',
    time: '18:00',
    track: 'Monza',
    category: 'F1 2025',
    status: 'Inscripciones abiertas',
    url: 'https://inerciahn.com/reservas'
  });
  assert.equal(events[1].track, null);
  assert.equal(events[1].url, null, 'only https links are kept');
});

async function call() {
  const { req, res } = createFakeReqRes();
  await eventsHandler(req, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

test('events endpoint: 503 until the Sheet is configured', async () => {
  delete process.env.SPREADSHEET_ID;
  delete process.env.GOOGLE_SHEETS_API_KEY;
  assert.equal((await call()).status, 503);
});

test('events endpoint: 404 when the Eventos tab does not exist, 200 with events otherwise', async () => {
  process.env.SPREADSHEET_ID = 'sheet';
  process.env.GOOGLE_SHEETS_API_KEY = 'key';

  let tabExists = false;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /Eventos/);
    return tabExists
      ? { ok: true, status: 200, json: async () => ({ values: [['Futuro', '01/01/2099']] }) }
      : { ok: false, status: 400, json: async () => ({}) };
  };

  assert.equal((await call()).status, 404);

  tabExists = true;
  const result = await call();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.events.map((e) => e.date), ['2099-01-01']);
});
