const FIRST_ROW = 15;
const LAST_ROW = 168;

const MONTHS_ES = [
  null,
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

module.exports = async function handler(req, res) {
  try {
    const { SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY } = process.env;

    if (!SPREADSHEET_ID || !GOOGLE_SHEETS_API_KEY) {
      res.status(500).json({
        error: 'Faltan las variables de entorno SPREADSHEET_ID / GOOGLE_SHEETS_API_KEY en Vercel.',
      });
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

    if (drivers.length === 0) {
      res.status(200).json({
        monthNumber, month: monthName, year,
        circuito: trackName, record: null, drivers: [],
      });
      return;
    }

    const fastestMs = drivers[0].ms;
    const leaderboard = drivers.map((d, i) => ({
      position: i + 1,
      name: d.name,
      time: d.timeStr,
      difference: i === 0 ? 'LEADER' : formatDifference(d.ms - fastestMs),
    }));

    // Edge/CDN cache for a minute so every page load doesn't hit the Sheets API.
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(200).json({
      monthNumber,
      month: monthName,
      year,
      circuito: trackName,
      record: { time: drivers[0].timeStr, piloto: drivers[0].name.toUpperCase() },
      drivers: leaderboard,
    });
  } catch (err) {
    console.error('Error en /api/standings:', err);
    res.status(500).json({ error: 'Error al cargar la tabla de tiempos.' });
  }
};

async function findSheetTitleForMonth(spreadsheetId, apiKey, monthNumber, monthName) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `?key=${apiKey}&fields=sheets.properties.title`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo leer la lista de hojas (HTTP ${r.status})`);
  const data = await r.json();
  const titles = (data.sheets || []).map((s) => s.properties.title);

  const prefixRegex = new RegExp(`^\\s*${monthNumber}\\.\\s*${monthName}\\b`, 'i');
  return titles.find((t) => prefixRegex.test(t)) || null;
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

/** Column offsets within C:H — C=0, D=1, E=2, F=3, G=4, H=5. */
function parseDrivers(rows) {
  const drivers = [];

  rows.forEach((row) => {
    const name = (row[0] || '').trim();    // Col C
    const gender = (row[3] || '').trim();  // Col F — not exposed to the client
    const timeStr = (row[5] || '').trim(); // Col H

    if (!name || !timeStr) return;

    const ms = parseTimeToMs(timeStr);
    if (ms === null) return;

    drivers.push({ name, gender, timeStr, ms });
  });

  drivers.sort((a, b) => a.ms - b.ms);
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

function formatDifference(diffMs) {
  const totalSeconds = Math.floor(diffMs / 1000);
  const millis = diffMs % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millisStr = String(millis).padStart(3, '0');

  if (minutes > 0) return `+${minutes}:${String(seconds).padStart(2, '0')}.${millisStr}`;
  return `+${seconds}.${millisStr}`;
}