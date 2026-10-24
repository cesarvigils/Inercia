/*
 * api/_lib/events.js
 *
 * Reads upcoming events from the "Eventos" tab of the same Google Sheet as
 * the standings (SPREADSHEET_ID / GOOGLE_SHEETS_API_KEY, server-side only).
 *
 * Expected layout of the "Eventos" tab: row 1 is a header, one event per
 * row from row 2, columns A to G:
 *
 *   A  Nombre      required, e.g. "Copa Inercia - Fecha 3"
 *   B  Fecha       required, a date cell (or text DD/MM/YYYY or YYYY-MM-DD)
 *   C  Hora        optional, a time cell (or text HH:MM, 24h)
 *   D  Circuito    optional
 *   E  Categoría   optional, e.g. "F1 2025", "GT3"
 *   F  Estado      optional, registration status as you want it shown,
 *                  e.g. "Inscripciones abiertas", "Cupo lleno"
 *   G  Link        optional, https link to the event's page or sign-up form
 *
 * Rows without a name or a readable date are skipped. Only events from
 * today on (Honduras time) are returned, soonest first.
 *
 * Exports:
 *   - EVENTS_SHEET               'Eventos'
 *   - parseEventRows(rows, today) Sheet rows -> Event[] (see js/profile/events.js)
 *   - todayInHonduras(now)       'YYYY-MM-DD'
 *   - fetchEventRows(id, key)    Raw rows from the Sheets API.
 */

export const EVENTS_SHEET = 'Eventos';

const RANGE = `'${EVENTS_SHEET}'!A2:G200`;
const MAX_EVENTS = 20;

// Google Sheets serial dates count days from 1899-12-30.
const SHEETS_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 24 * 60 * 60 * 1000;

const pad = (n) => String(n).padStart(2, '0');

function validDate(y, m, d) {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
        ? `${y}-${pad(m)}-${pad(d)}`
        : null;
}

export function parseSheetDate(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const date = new Date(SHEETS_EPOCH_MS + Math.floor(value) * DAY_MS);
        return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }

    const text = String(value ?? '').trim();
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return validDate(+match[1], +match[2], +match[3]);

    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return validDate(+match[3], +match[2], +match[1]);

    return null;
}

export function parseSheetTime(value) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        const minutes = Math.round((value % 1) * 24 * 60) % (24 * 60);
        return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    }

    const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!match || +match[1] > 23 || +match[2] > 59) return null;
    return `${pad(+match[1])}:${match[2]}`;
}

function text(value) {
    const out = String(value ?? '').trim();
    return out ? out.slice(0, 120) : null;
}

function safeUrl(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    try {
        const url = new URL(raw);
        return url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

export function todayInHonduras(now = Date.now()) {
    // Honduras is UTC-6 all year (no daylight saving time).
    const local = new Date(now - 6 * 60 * 60 * 1000);
    return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

export function parseEventRows(rows, today = todayInHonduras()) {
    const events = [];

    (rows || []).forEach((row, index) => {
        const name = text(row[0]);
        const date = parseSheetDate(row[1]);
        if (!name || !date || date < today) return;

        events.push({
            id: `fila-${index + 2}`,
            name,
            date,
            time: parseSheetTime(row[2]),
            track: text(row[3]),
            category: text(row[4]),
            status: text(row[5]),
            url: safeUrl(row[6])
        });
    });

    return events
        .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''))
        .slice(0, MAX_EVENTS);
}

export async function fetchEventRows(spreadsheetId, apiKey) {
    // UNFORMATTED + SERIAL_NUMBER returns date/time cells as numbers, so the
    // sheet's display format (or locale) doesn't matter.
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `/values/${encodeURIComponent(RANGE)}` +
        `?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&key=${apiKey}`;

    const response = await fetch(url);

    // 400 is what the Sheets API answers when the tab doesn't exist yet.
    if (response.status === 400) {
        const error = new Error(`No existe la hoja "${EVENTS_SHEET}".`);
        error.status = 404;
        throw error;
    }

    if (!response.ok) throw new Error(`No se pudieron leer los eventos (HTTP ${response.status})`);

    const data = await response.json();
    return data.values || [];
}
