/*
 * GET /api/standings
 *
 * Public endpoint that reads lap-time standings for the current month
 * from a Google Sheet (not Firestore) and returns them as JSON for
 * js/standings.js to render. This is a read-only proxy to the Google
 * Sheets API, done server-side so the Google API key never reaches the
 * browser.
 *
 * Required environment variables:
 *   SPREADSHEET_ID          The Google Sheet ID containing the standings.
 *   GOOGLE_SHEETS_API_KEY   A Google Cloud API key with the Sheets API
 *                           enabled (read-only, tied to this spreadsheet
 *                           being shared/public — there's no OAuth here).
 *
 * How it finds the right data:
 *   1. findSheetTitleForMonth() lists all tabs (sheets) in the spreadsheet
 *      and looks for one whose title starts with "<month number>. <month
 *      name>" (e.g. "6. Junio") — this is a manual naming convention that
 *      whoever maintains the spreadsheet needs to follow every month.
 *   2. extractTrackName() strips that "N. Mes" prefix off the tab title to
 *      get the track/circuit name shown in the UI.
 *   3. fetchSheetRows() reads a fixed cell range (C15:H168, see
 *      FIRST_ROW/LAST_ROW below) from that tab — if the spreadsheet's
 *      layout changes (columns added/moved, header rows shifted), this
 *      range and the column offsets in parseDrivers() need to be updated
 *      to match.
 *   4. parseDrivers() turns each row into a driver entry; see its own
 *      comment below for the exact column meanings.
 *
 * GET /api/standings?scope=all returns every tab in the sheet (except
 * "Eventos"), for the profile's RÉCORDS (js/profile/records.js):
 *   { currentYear, currentMonth,
 *     tabs: [{ title, monthNumber, month, year, circuito, auto, drivers }] }
 * Month tabs come newest first (see describeTab for the year), other tabs
 * after them. It's one tab listing plus one values:batchGet call, however
 * many tabs there are.
 *
 * Response is cached at the edge for 60s (with a 5 minute
 * stale-while-revalidate) via the Cache-Control header, so changes to the
 * sheet can take up to a minute to show up.
 */

import { rateLimit } from './_lib/http.js';

const FIRST_ROW = 15;
const LAST_ROW = 168;

const MONTHS_ES = [
  null,
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

export default async function handler(req, res) {  try {
    if (!rateLimit(req, res, { limit: 30, windowMs: 60_000 })) return;

    const { SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY } = process.env;

    if (!SPREADSHEET_ID || !GOOGLE_SHEETS_API_KEY) {
      res.status(500).json({
        error: 'Faltan las variables de entorno SPREADSHEET_ID / GOOGLE_SHEETS_API_KEY en Vercel.',
      });
      return;
    }

    const scope = req.query?.scope ?? new URL(req.url || '/', 'http://x').searchParams.get('scope');

    if (scope === 'all') {
      await sendAllTabs(res, SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY);
      return;
    }

    const now = new Date();
    const monthNumber = now.getMonth() + 1; // 1-12
    const monthName = MONTHS_ES[monthNumber];
    const year = now.getFullYear();

    const sheetTitle = await findSheetTitleForMonth(
      SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY, monthNumber, monthName
    );

    if (!sheetTitle) {
      res.status(404).json({ error: `No se encontró una hoja para ${monthName} ${year}.` });
      return;
    }

    const trackName = extractTrackName(sheetTitle, monthNumber, monthName);
    const rows = await fetchSheetRows(SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY, sheetTitle);
    const drivers = parseDrivers(rows);

    // Sorting, category filtering (Femenino / Masculino / Team Inercia), position
    // numbers, and NT/diff formatting all happen client-side in js/standings.js so
    // switching the category dropdown doesn't need another request.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      monthNumber,
      month: monthName,
      year,
      circuito: trackName,
      // Optional: set STANDINGS_CAR in Vercel to change the car shown (defaults to the HTML's "F1 2025").
      auto: process.env.STANDINGS_CAR || null,
      drivers,
    });
  } catch (err) {
    console.error('Error en /api/standings:', err);
    res.status(500).json({ error: 'Error al cargar la tabla de tiempos.' });
  }
};

async function listSheetTitles(spreadsheetId, apiKey) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `?key=${apiKey}&fields=sheets.properties.title`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo leer la lista de hojas (HTTP ${r.status})`);
  const data = await r.json();
  return (data.sheets || []).map((s) => s.properties.title);
}

function titleForMonth(titles, monthNumber, monthName) {
  const prefixRegex = new RegExp(`^\\s*${monthNumber}\\.\\s*${monthName}\\b`, 'i');
  return titles.find((t) => prefixRegex.test(t)) || null;
}

async function findSheetTitleForMonth(spreadsheetId, apiKey, monthNumber, monthName) {
  return titleForMonth(await listSheetTitles(spreadsheetId, apiKey), monthNumber, monthName);
}

// Tabs that aren't lap-time tables.
const NON_STANDINGS_TABS = /^\s*eventos\s*$/i;

/*
 * "11. Noviembre Interlagos" -> { monthNumber: 11, month: 'Noviembre',
 * year, circuito: 'Interlagos' }. Titles have no year, so a month later
 * than the current one is last year's ("12. Diciembre" read in November).
 * An explicit year right after the month ("11. Noviembre 2025 Monza") wins.
 * Any other title is kept as is (monthNumber/month/year null).
 */
export function describeTab(title, now = new Date()) {
  const match = title.match(/^\s*(\d{1,2})\.\s*([^\s\d]+)\s*(\d{4})?\s*(.*)$/);
  const monthNumber = match ? Number(match[1]) : 0;

  if (
    match &&
    monthNumber >= 1 &&
    monthNumber <= 12 &&
    MONTHS_ES[monthNumber].toLowerCase() === match[2].toLowerCase()
  ) {
    const currentYear = now.getFullYear();
    const year = match[3]
      ? Number(match[3])
      : monthNumber > now.getMonth() + 1 ? currentYear - 1 : currentYear;

    return {
      title,
      monthNumber,
      month: MONTHS_ES[monthNumber],
      year,
      circuito: match[4].trim() || 'N/D'
    };
  }

  return { title, monthNumber: null, month: null, year: null, circuito: title.trim() || 'N/D' };
}

/*
 * ?scope=all: every tab in the sheet (except Eventos), read with one
 * values:batchGet. Month tabs newest first, then any other tabs in sheet
 * order. A tab with another layout simply yields no valid times.
 */
async function sendAllTabs(res, spreadsheetId, apiKey) {
  const now = new Date();
  const titles = (await listSheetTitles(spreadsheetId, apiKey))
    .filter((title) => !NON_STANDINGS_TABS.test(title));

  let valueRanges = [];

  if (titles.length) {
    const ranges = titles
      .map((title) => `ranges=${encodeURIComponent(`'${title}'!C${FIRST_ROW}:H${LAST_ROW}`)}`)
      .join('&');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
      `/values:batchGet?${ranges}&key=${apiKey}`;

    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudieron leer las hojas de tiempos (HTTP ${r.status})`);
    valueRanges = (await r.json()).valueRanges || [];
  }

  const dated = (tab) => (tab.year ? tab.year * 100 + tab.monthNumber : -1);

  const tabs = titles
    .map((title, index) => ({
      ...describeTab(title, now),
      auto: process.env.STANDINGS_CAR || null,
      drivers: parseDrivers(valueRanges[index]?.values || []),
      sheetOrder: index
    }))
    .sort((a, b) => dated(b) - dated(a) || a.sheetOrder - b.sheetOrder)
    .map(({ sheetOrder: _sheetOrder, ...tab }) => tab);

  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.status(200).json({
    currentYear: now.getFullYear(),
    currentMonth: now.getMonth() + 1,
    tabs
  });
}

function extractTrackName(sheetTitle, monthNumber, monthName) {
  const prefixRegex = new RegExp(`^\\s*${monthNumber}\\.\\s*${monthName}\\s*`, 'i');
  return sheetTitle.replace(prefixRegex, '').trim() || 'N/D';
}

async function fetchSheetRows(spreadsheetId, apiKey, sheetTitle) {
  const range = `'${sheetTitle}'!C${FIRST_ROW}:H${LAST_ROW}`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `/values/${encodeURIComponent(range)}?key=${apiKey}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudieron leer los tiempos (HTTP ${r.status})`);
  const data = await r.json();
  return data.values || [];
}

/**
 * Column offsets within C:H — C=0, D=1, E=2, F=3, G=4, H=5.
 * A row only needs a name to count as an entry now — a blank time (Col H)
 * is kept and shown as "NT" on the client instead of being dropped.
 * Team Inercia members are identified by "(S)" anywhere in the name (Col C);
 * gender (Col F) is expected to be "M" or "F".
 */
function parseDrivers(rows) {
  const drivers = [];

  rows.forEach((row, idx) => {
    const name = (row[0] || '').trim();          // Col C
    const genderRaw = (row[3] || '').trim().toUpperCase(); // Col F
    const timeStr = (row[5] || '').trim();        // Col H

    if (!name) return; // still need a name to count as a real entry

    const isTeam = /\(s\)/i.test(name);
    const gender = genderRaw === 'M' || genderRaw === 'F' ? genderRaw : null;
    const ms = timeStr ? parseTimeToMs(timeStr) : null;

    drivers.push({
      name,
      gender,
      team: isTeam,
      timeStr: ms !== null ? timeStr : null,
      ms,
      rowOrder: idx, // stable tiebreaker for NT entries, which have no time to sort by
    });
  });

  return drivers;
}

function parseTimeToMs(timeStr) {
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\.(\d{1,3})$/);
  if (!match) return null;

  const minutes = parseInt(match[1], 10);
  const seconds = parseInt(match[2], 10);
  const millis = parseInt(match[3].padEnd(3, '0'), 10);

  return (minutes * 60 + seconds) * 1000 + millis;
}