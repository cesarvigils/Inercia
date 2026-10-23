/*
 * GET /api/events
 *
 * Public list of upcoming events, read server-side from the "Eventos" tab
 * of the racing Google Sheet so the Google API key never reaches the
 * browser. Column layout and parsing: api/_lib/events.js. Shown in the
 * profile's PRÓXIMOS EVENTOS (js/profile/events.js).
 *
 * Response 200: { events: Event[] }  (may be empty)
 * 404 when the "Eventos" tab doesn't exist yet, 503 when the Sheet isn't
 * configured; the profile shows both as "not connected yet".
 *
 * Cached at the edge for 5 minutes, like the standings.
 */

import { method, json, rateLimit } from './_lib/http.js';
import { fetchEventRows, parseEventRows } from './_lib/events.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;
        if (!rateLimit(req, res, { limit: 30, windowMs: 60_000 })) return;

        const { SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY } = process.env;

        if (!SPREADSHEET_ID || !GOOGLE_SHEETS_API_KEY) {
            return json(res, 503, { error: 'Los eventos todavía no están configurados.' });
        }

        const events = parseEventRows(await fetchEventRows(SPREADSHEET_ID, GOOGLE_SHEETS_API_KEY));

        res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
        return json(res, 200, { events });
    } catch (error) {
        if (error.status === 404) {
            return json(res, 404, { error: error.message });
        }

        console.error('Error en /api/events:', error);
        return json(res, 500, { error: 'Error al cargar los eventos.' });
    }
}
