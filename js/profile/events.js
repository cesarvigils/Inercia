/*
 * js/profile/events.js
 *
 * PRÓXIMOS EVENTOS for the profile, from GET /api/events (which reads the
 * "Eventos" tab of the racing Google Sheet server-side).
 *
 * Event = {
 *   id:       string,
 *   name:     string,
 *   date:     string,          // YYYY-MM-DD
 *   time:     string | null,   // HH:MM, 24h
 *   track:    string | null,
 *   category: string | null,
 *   status:   string | null,   // registration status as the sheet writes it
 *   url:      string | null,   // https link to the event's detail/registration page
 * }
 *
 * Result of loadEvents(), one of:
 *   { state: 'ready', events: Event[] }   upcoming only, soonest first (may be empty)
 *   { state: 'pending' }                  the endpoint isn't set up yet (404/503)
 *   { state: 'unavailable' }              it failed
 */

import { getJson } from './api.js';

export async function loadEvents() {
    try {
        const data = await getJson('/api/events');
        return { state: 'ready', events: Array.isArray(data.events) ? data.events : [] };
    } catch (error) {
        if (error.status === 404 || error.status === 503) return { state: 'pending' };
        console.warn('[PERFIL] No se pudieron leer los eventos:', error.message);
        return { state: 'unavailable' };
    }
}
