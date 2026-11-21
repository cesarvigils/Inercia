/*
 * api/_lib/events.js
 *
 * Reads upcoming events from the "Eventos" tab of the same Google Sheet as
 * the standings (SPREADSHEET_ID / GOOGLE_SHEETS_API_KEY, server-side only).
 *
 * Layout of the "Eventos" tab: row 1 is a header, events in rows 2 to 15:
 *
 *   A  Nombre del evento   e.g. "Copa Inercia - Fecha 3"
 *   B  Fecha               MM/DD, e.g. "12/05" (a date cell or MM/DD/YYYY
 *                          / YYYY-MM-DD text work too)
 *
 * MM/DD has no year: it's this year, unless that date is more than 90 days
 * gone, in which case it's next year (so "01/10" written in November means
 * next January). Rows without a name or a readable date are skipped. Only
 * events from today on (Honduras time) are returned, soonest first. The
 * Event shape keeps time/track/category/status/url, always null for now.
 *
 * Exports:
 *   - EVENTS_SHEET               'Eventos'
 *   - parseEventRows(rows, today) Sheet rows -> Event[] (see js/profile/events.js)
 *   - todayInHonduras(now)       'YYYY-MM-DD'
 *   - fetchEventRows(id, key)    Raw rows from the Sheets API.
 */

export const EVENTS_SHEET = 'Eventos';

const RANGE = `'${EVENTS_SHEET}'!A2:B15`;
const MAX_EVENTS = 14;
const ROLL_TO_NEXT_YEAR_DAYS = 90;

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

function daysBetween(fromIso, toIso) {
    return (Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS;
}

/* parseSheetDate(value, today) -> 'YYYY-MM-DD' | null. `today` ('YYYY-MM-DD')
   supplies the year for MM/DD text. */
export function parseSheetDate(value, today = todayInHonduras()) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        const date = new Date(SHEETS_EPOCH_MS + Math.floor(value) * DAY_MS);
        return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }

    const text = String(value ?? '').trim();
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) return validDate(+match[1], +match[2], +match[3]);

    match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (match) return validDate(+match[3], +match[1], +match[2]);

    match = text.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (match) {
        const year = Number(today.slice(0, 4));
        const thisYear = validDate(year, +match[1], +match[2]);
        if (thisYear && daysBetween(thisYear, today) > ROLL_TO_NEXT_YEAR_DAYS) {
            return validDate(year + 1, +match[1], +match[2]);
        }
        return thisYear;
    }

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
        const date = parseSheetDate(row[1], today);
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
    // FORMATTED_VALUE: column B is read exactly as the sheet shows it and
    // parsed as MM/DD. (If Sheets turned "12/05" into a real date cell, its
    // locale might mean 12 May; the displayed text stays "12/05" either way.)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
        `/values/${encodeURIComponent(RANGE)}` +
        `?valueRenderOption=FORMATTED_VALUE&key=${apiKey}`;

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
