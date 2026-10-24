/*
 * js/profile/records.js
 *
 * Personal track records and race results for the profile. NOT CONNECTED
 * YET: the lap-time Google Sheet (api/standings.js) only names drivers, so
 * a sheet row can't be tied to an account without guessing from the name.
 * Until a source identifies drivers by account, loadRecords() reports
 * 'pending' and the profile says so; it never shows made-up times.
 *
 * To connect it later, add a server endpoint (e.g. GET /api/profile/records,
 * scoped with requireUser to the caller's uid) that returns the shape
 * below, and change only loadRecords().
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

export async function loadRecords() {
    return { state: 'pending' };
}

export function sortByLap(records) {
    return [...records].sort((a, b) => (a.lapMs ?? Infinity) - (b.lapMs ?? Infinity));
}
