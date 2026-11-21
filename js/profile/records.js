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
 * One request, GET /api/standings?scope=all: every tab in the lap-time
 * sheet (except Eventos), month tabs newest first. The account is matched
 * by name exactly like MI TIEMPO on /standings.
 *
 *   current     this month's hotlap time
 *   historical  every entry of yours with a time in any tab — hotlap month
 *               tabs and F1 race tabs ("NOV F1"...), all rows, not one per
 *               tab — in the API's order (newest month first, other tabs
 *               after)
 *
 * The sheet has no race sessions, so no record carries a `race` yet.
 * Records also get `period` ("Noviembre 2026", or the tab's title for a
 * non-month tab), shown in the FECHA column.
 */
export async function loadRecords(user) {
    try {
        const [data, identity] = await Promise.all([
            getJson('/api/standings?scope=all'),
            loadIdentity(user)
        ]);

        const mine = normalizeDriverName(identity.name);
        const tabs = Array.isArray(data.tabs) ? data.tabs : [];
        // ACTUALES is this month's hotlap table; race tabs only go to HISTÓRICOS.
        const isCurrent = (tab) =>
            tab.kind !== 'race' &&
            tab.monthNumber === data.currentMonth &&
            tab.year === data.currentYear;

        const historical = mine
            ? tabs.flatMap((tab) => {
                const drivers = Array.isArray(tab.drivers) ? tab.drivers : [];

                // Every row of yours with a time, not just the first one.
                return drivers
                    .filter((driver) =>
                        normalizeDriverName(driver.name) === mine && Number.isFinite(driver.ms))
                    .map((row) => ({
                        track: tab.circuito || '—',
                        category: tab.auto || 'F1 2025',
                        lapTime: row.timeStr,
                        lapMs: row.ms,
                        recordedAt: null,
                        period: tab.month ? `${tab.month} ${tab.year}` : tab.title,
                        status: isCurrent(tab) ? 'vigente' : 'superado',
                        race: null
                    }));
            })
            : [];

        const current = historical.filter((record) => record.status === 'vigente');

        return { state: 'ready', current, historical };
    } catch (error) {
        console.warn('[PERFIL] No se pudieron leer los récords:', error.message);
        return { state: 'unavailable' };
    }
}

export function sortByLap(records) {
    return [...records].sort((a, b) => (a.lapMs ?? Infinity) - (b.lapMs ?? Infinity));
}
