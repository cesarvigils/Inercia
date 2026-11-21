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

function currentMonthNumber() {
    return Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Tegucigalpa',
        month: 'numeric'
    }).format(new Date()));
}

/*
 * One request, GET /api/standings?scope=year: every month of this year
 * that has a tab in the lap-time sheet. The account is matched by name
 * exactly like MI TIEMPO on /standings.
 *
 *   current     this month's time
 *   historical  every time this year, one per month, newest first (months
 *               with no tab, or where the driver has no time, are left out)
 *
 * The sheet has no race sessions, so no record carries a `race` yet.
 * Records also get `period` ("Noviembre 2026") and `monthNumber`; the
 * profile shows `period` in the FECHA column.
 */
export async function loadRecords(user) {
    try {
        const [data, identity] = await Promise.all([
            getJson('/api/standings?scope=year'),
            loadIdentity(user)
        ]);

        const mine = normalizeDriverName(identity.name);
        const months = Array.isArray(data.months) ? data.months : [];

        const historical = mine
            ? months
                .map((month) => {
                    const drivers = Array.isArray(month.drivers) ? month.drivers : [];
                    const row = drivers.find((driver) => normalizeDriverName(driver.name) === mine);
                    if (!row || !Number.isFinite(row.ms)) return null;

                    return {
                        track: month.circuito || '—',
                        category: month.auto || 'F1 2025',
                        lapTime: row.timeStr,
                        lapMs: row.ms,
                        recordedAt: null,
                        period: `${month.month} ${data.year}`,
                        monthNumber: month.monthNumber,
                        status: 'superado',
                        race: null
                    };
                })
                .filter(Boolean)
                .sort((a, b) => b.monthNumber - a.monthNumber)
            : [];

        const thisMonth = currentMonthNumber();
        const current = historical
            .filter((record) => record.monthNumber === thisMonth)
            .map((record) => ({ ...record, status: 'vigente' }));

        historical.forEach((record) => {
            if (record.monthNumber === thisMonth) record.status = 'vigente';
        });

        return { state: 'ready', current, historical };
    } catch (error) {
        console.warn('[PERFIL] No se pudieron leer los récords:', error.message);
        return { state: 'unavailable' };
    }
}

export function sortByLap(records) {
    return [...records].sort((a, b) => (a.lapMs ?? Infinity) - (b.lapMs ?? Infinity));
}
