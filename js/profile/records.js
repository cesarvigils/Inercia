/*
 * js/profile/records.js
 *
 * Personal track records and race results for the profile. Records come
 * from the lap-time Google Sheet (GET /api/standings), matched to the
 * account by name the same way /standings does for MI TIEMPO. The sheet
 * only names drivers, so a name that's spelled differently there won't
 * match. For a sturdier link, add a server endpoint (e.g. GET
 * /api/profile/records, scoped with requireUser to the caller's uid) that
 * returns the shape below, and change only loadRecords().
 *
 * Data contract
 *
 *   RecordsResponse = {
 *     current:    PersonalRecord[],  // the driver's best standing time per track/category
 *     historical: PersonalRecord[],  // older or beaten personal times
 *   }
 *
 *   PersonalRecord = {
 *     track:      string,            // "Monza"
 *     category:   string | null,     // "F1 2025", "GT3"...
 *     lapTime:    string,            // "1:23.456", as the sheet writes it
 *     lapMs:      number,            // the same time in milliseconds, for sorting
 *     recordedAt: string | null,     // ISO date
 *     status:     'vigente' | 'superado',
 *     race:       RaceResult | null, // only when the lap was set in a race
 *   }
 *
 *   RaceResult = {
 *     event:          string,          // event name
 *     session:        string | null,   // "Carrera 1", "Final"...
 *     date:           string | null,   // ISO date
 *     position:       number | null,   // final finishing position
 *     classification: string | null,   // "Femenino", "Team Inercia"...
 *   }
 *
 * Result of loadRecords(), one of:
 *   { state: 'pending' }                          source not connected yet
 *   { state: 'unavailable' }                      source connected but failing
 *   { state: 'ready', current: [...], historical: [...] }   (either may be empty)
 */

import { getJson } from './api.js';
import { loadIdentity } from './identity.js';

// Same rule as the standings page (js/standings.js normalizeDriverName):
// "Cesar Vigil (S)" in the sheet matches the account name "Cesar Vigil".
export function normalizeDriverName(value) {
    return String(value || '')
        .trim()
        .replace(/\s*\(S\)\s*$/i, '')
        .trim()
        .toLocaleLowerCase('es');
}

/*
 * Current-month record from the lap-time sheet (GET /api/standings), matched
 * by the account's name exactly like MI TIEMPO on /standings. The sheet only
 * has the current month and no race sessions, so `historical` is empty and
 * no record carries a `race` until a source with that exists.
 */
export async function loadRecords(user) {
    try {
        const [standings, identity] = await Promise.all([
            getJson('/api/standings'),
            loadIdentity(user)
        ]);

        const mine = normalizeDriverName(identity.name);
        const drivers = Array.isArray(standings.drivers) ? standings.drivers : [];
        const row = mine
            ? drivers.find((driver) => normalizeDriverName(driver.name) === mine)
            : null;

        const current = row && Number.isFinite(row.ms)
            ? [{
                track: standings.circuito || '—',
                category: standings.auto || 'F1 2025',
                lapTime: row.timeStr,
                lapMs: row.ms,
                recordedAt: null,
                status: 'vigente',
                race: null
            }]
            : [];

        return { state: 'ready', current, historical: [] };
    } catch (error) {
        // 404: no sheet tab for this month yet -> simply nothing to show.
        if (error.status === 404) return { state: 'ready', current: [], historical: [] };
        console.warn('[PERFIL] No se pudieron leer los récords:', error.message);
        return { state: 'unavailable' };
    }
}

export function sortByLap(records) {
    return [...records].sort((a, b) => (a.lapMs ?? Infinity) - (b.lapMs ?? Infinity));
}
