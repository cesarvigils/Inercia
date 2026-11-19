/*
 * lib/time.js
 *
 * One time/date format for the whole site, shared by the browser
 * (js/reservas.js, js/hours.js, js/profile/*) and the API
 * (api/_lib/reservations.js error messages), so a booking never shows
 * "2:00 PM" on the clock and "14:00" in an error.
 *
 *   formatHour('14:00')        -> '2:00 p. m.'
 *   formatHourRange('14:00','21:00') -> '2:00 p. m. – 9:00 p. m.'
 *   formatDateLong('2026-11-24') -> 'martes 24 de noviembre'
 *
 * Dates are plain 'YYYY-MM-DD' strings (Honduras local), formatted in UTC
 * at noon so the viewer's time zone can never shift the day.
 */

export function formatHour(value) {
    const [h, m = 0] = String(value || '').split(':').map(Number);

    if (!Number.isFinite(h)) {
        return '';
    }

    const suffix = h < 12 || h === 24 ? 'a. m.' : 'p. m.';
    const hour12 = h % 12 || 12;

    return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function formatHourRange(start, end) {
    return `${formatHour(start)} – ${formatHour(end)}`;
}

function asNoonUtc(isoDate) {
    const [y, mo, d] = String(isoDate || '').split('-').map(Number);

    if (!y || !mo || !d) {
        return null;
    }

    return new Date(Date.UTC(y, mo - 1, d, 12));
}

export function formatDateLong(isoDate, { weekday = true, year = false } = {}) {
    const date = asNoonUtc(isoDate);

    if (!date) {
        return '';
    }

    return new Intl.DateTimeFormat('es-HN', {
        timeZone: 'UTC',
        ...(weekday ? { weekday: 'long' } : {}),
        day: 'numeric',
        month: 'long',
        ...(year ? { year: 'numeric' } : {})
    })
        .format(date)
        .replace(',', '');
}

export function formatDateShort(isoDate) {
    const date = asNoonUtc(isoDate);

    if (!date) {
        return '';
    }

    return new Intl.DateTimeFormat('es-HN', {
        timeZone: 'UTC',
        weekday: 'short',
        day: 'numeric',
        month: 'short'
    })
        .format(date)
        .replace(/\./g, '')
        .replace(',', '');
}

/* Weekday names, Sunday first (matches Date#getDay and config.hours keys). */
export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
