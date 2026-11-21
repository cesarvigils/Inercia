/*
 * js/hours.js
 *
 * Opening hours, shown on the home and contact pages. Every element with
 * [data-hours] gets a list like
 *
 *   Lunes ............ Cerrado
 *   Martes a viernes . 2:00 p. m. – 9:00 p. m.
 *   Sábado y domingo . 12:00 p. m. – 9:00 p. m.
 *
 * plus an "ABIERTO AHORA / CERRADO AHORA" badge in [data-hours-status],
 * and fills [data-price-of="standard|premium"] with the hourly price.
 *
 * The hours come from the same booking config the reservations use
 * (GET /api/reservations/config -> config.hours, see DEFAULT_CONFIG in
 * api/_lib/reservations.js), so changing them there updates this too.
 * FALLBACK_HOURS is only used if that request fails — keep it in sync
 * with DEFAULT_CONFIG.hours.
 */

import { formatHourRange, WEEKDAYS } from '../lib/time.js';

const FALLBACK_HOURS = {
    0: ['12:00', '21:00'],
    2: ['14:00', '21:00'],
    3: ['14:00', '21:00'],
    4: ['14:00', '21:00'],
    5: ['14:00', '21:00'],
    6: ['12:00', '21:00']
};

const TIME_ZONE = 'America/Tegucigalpa';

// Monday first, the way people read a week.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function key(hours) {
    return hours ? hours.join('-') : 'closed';
}

/* Groups consecutive days with the same hours: [{ days:[2,3,4,5], hours }]. */
function groupDays(hoursByDay) {
    const groups = [];

    WEEK_ORDER.forEach((day) => {
        const hours = hoursByDay[day] || null;
        const last = groups[groups.length - 1];

        if (last && key(last.hours) === key(hours)) {
            last.days.push(day);
        } else {
            groups.push({ days: [day], hours });
        }
    });

    return groups;
}

function daysLabel(days) {
    const first = WEEKDAYS[days[0]];

    if (days.length === 1) return first;

    const last = WEEKDAYS[days[days.length - 1]].toLowerCase();

    return days.length === 2 ? `${first} y ${last}` : `${first} a ${last}`;
}

function nowInHonduras() {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone: TIME_ZONE,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        })
            .formatToParts(new Date())
            .map((p) => [p.type, p.value])
    );

    return {
        day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
        minutes: Number(parts.hour) * 60 + Number(parts.minute)
    };
}

function toMinutes(hhmm) {
    const [h, m = 0] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

function render(hoursByDay) {
    const today = nowInHonduras();

    document.querySelectorAll('[data-hours]').forEach((list) => {
        list.replaceChildren(
            ...groupDays(hoursByDay).map((group) => {
                const item = document.createElement('li');
                const days = document.createElement('span');
                const time = document.createElement('strong');

                days.textContent = daysLabel(group.days);
                time.textContent = group.hours
                    ? formatHourRange(group.hours[0], group.hours[1])
                    : 'Cerrado';

                if (group.days.includes(today.day)) {
                    item.classList.add('is-today');
                    item.setAttribute('aria-current', 'date');
                }
                if (!group.hours) {
                    item.classList.add('is-closed');
                }

                item.append(days, time);
                return item;
            })
        );
    });

    const todayHours = hoursByDay[today.day];
    const open =
        Boolean(todayHours) &&
        today.minutes >= toMinutes(todayHours[0]) &&
        today.minutes < toMinutes(todayHours[1]);

    document.querySelectorAll('[data-hours-status]').forEach((badge) => {
        badge.hidden = false;
        badge.textContent = open ? 'ABIERTO AHORA' : 'CERRADO AHORA';
        badge.classList.toggle('is-open', open);
    });
}

/* [data-price-of="standard|premium"] -> "L 200" from config.prices (home cards). */
function renderPrices(prices) {
    if (!prices) return;

    document.querySelectorAll('[data-price-of]').forEach((el) => {
        const value = Number(prices[el.dataset.priceOf]);

        if (value > 0) {
            el.textContent = `L ${value.toLocaleString('es-HN', { maximumFractionDigits: 2 })}`;
        }
    });
}

async function init() {
    if (!document.querySelector('[data-hours], [data-price-of]')) return;

    // Something sensible right away; replaced if the API answers.
    render(FALLBACK_HOURS);

    try {
        const res = await fetch('/api/reservations/config');
        if (!res.ok) return;

        const data = await res.json();
        const hours = data?.config?.hours;

        if (hours && typeof hours === 'object') {
            render(hours);
        }

        renderPrices(data?.config?.prices);
    } catch {
        // Keep the fallback.
    }
}

init();
