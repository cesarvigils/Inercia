/*
 * js/profile/reservations.js
 *
 * MIS RESERVAS for the profile, from GET /api/reservations/mine (the
 * signed-in user's last 50 reservations, newest first).
 *
 * Reservation (as the profile shows it) = {
 *   id, date: 'YYYY-MM-DD', time: 'HH:MM', duration: number (hours),
 *   standard: number, premium: number,   // rig counts
 *   total: number | null,                // HNL, before ISV (pricing.total)
 *   paymentMethod: 'transferencia' | 'paypal' | 'efectivo' | null,
 *   status: { key, label }               // see statusOf()
 * }
 *
 * Result of loadReservations(), one of:
 *   { state: 'ready', upcoming: Reservation[], past: Reservation[] }
 *       upcoming soonest first, past most recent first (max 10).
 *   { state: 'unavailable' }
 *
 * Abandoned PayPal checkouts (cancelled or expired before PayPal took the
 * money) are left out: the person never actually booked those.
 */

import { getJson } from './api.js';

const TIME_ZONE = 'America/Tegucigalpa';
const PAST_LIMIT = 10;

function millis(value) {
    if (!value) return null;
    if (typeof value === 'string' || typeof value === 'number') {
        const time = new Date(value).getTime();
        return Number.isNaN(time) ? null : time;
    }
    // Firestore Timestamp as JSON: { _seconds } or { seconds }.
    const seconds = value._seconds ?? value.seconds;
    return typeof seconds === 'number' ? seconds * 1000 : null;
}

function todayInHonduras() {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function statusOf(raw) {
    const method = raw.payment?.method || null;

    switch (raw.status) {
        case 'approved':
            return { key: 'approved', label: 'CONFIRMADA' };
        case 'pending':
            return method === 'transferencia'
                ? { key: 'pending', label: 'VERIFICANDO PAGO' }
                : { key: 'pending', label: 'PENDIENTE' };
        case 'payment_pending':
            return { key: 'pending', label: 'PAGO PENDIENTE' };
        case 'cancelled':
            return { key: 'cancelled', label: 'CANCELADA' };
        case 'rejected':
            return { key: 'cancelled', label: 'RECHAZADA' };
        default:
            return { key: 'other', label: String(raw.status || '—').toUpperCase() };
    }
}

function isAbandonedCheckout(raw) {
    if (raw.payment?.method !== 'paypal' || raw.payment?.paidAt) return false;

    if (raw.status === 'cancelled') return true;

    if (raw.status === 'payment_pending') {
        const expires = millis(raw.paymentPendingExpiresAt);
        return expires !== null && expires < Date.now();
    }

    return false;
}

function normalize(raw) {
    const rigs = Array.isArray(raw.rigs) ? raw.rigs : [];
    const total = Number(raw.pricing?.total ?? raw.payment?.totalHNL);

    return {
        id: raw.id,
        date: raw.date || '',
        time: raw.time || '',
        duration: Number(raw.duration) || 1,
        standard: rigs.filter((rig) => rig.type === 'standard').length,
        premium: rigs.filter((rig) => rig.type === 'premium').length,
        total: Number.isFinite(total) ? total : null,
        paymentMethod: raw.payment?.method || null,
        status: statusOf(raw)
    };
}

export async function loadReservations(user) {
    try {
        const data = await getJson('/api/reservations/mine', { user });
        const list = (Array.isArray(data.reservations) ? data.reservations : [])
            .filter((raw) => !isAbandonedCheckout(raw))
            .map(normalize)
            .filter((item) => item.date);

        const today = todayInHonduras();
        const sortKey = (item) => `${item.date} ${item.time}`;

        const upcoming = list
            .filter((item) => item.date >= today && item.status.key !== 'cancelled')
            .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

        const past = list
            .filter((item) => !upcoming.includes(item))
            .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
            .slice(0, PAST_LIMIT);

        return { state: 'ready', upcoming, past };
    } catch (error) {
        console.warn('[PERFIL] No se pudieron leer las reservas:', error.message);
        return { state: 'unavailable' };
    }
}
