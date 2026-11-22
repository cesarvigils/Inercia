/*
 * Lógica pura de la vista RESERVAS: qué reserva ocupa cada celda del
 * calendario, el resumen del día, la vista semanal, la búsqueda y los
 * links de contacto. Vive fuera de js/admin.js por la misma razón que
 * reservation-logic.js: poder probarla en Node (ver tests/).
 */

import { EDITABLE_STATUSES, hm } from "./reservation-logic.js";

// Filas del calendario: de 10 AM a 10 PM, una por hora.
export const CALENDAR_FIRST_HOUR = 10;
export const CALENDAR_LAST_HOUR = 21;

export const calendarRowTimes = () =>
    Array.from(
        { length: CALENDAR_LAST_HOUR - CALENDAR_FIRST_HOUR + 1 },
        (_, i) => `${String(CALENDAR_FIRST_HOUR + i).padStart(2, "0")}:00`
    );

// [inicio, fin) en minutos del día.
export function reservationWindow(reservation) {
    const start = hm(reservation.time);
    return [start, start + (Number(reservation.duration) || 1) * 60];
}

// Las reservas que el calendario dibuja: pending y approved.
export const isCalendarReservation = (reservation) =>
    EDITABLE_STATUSES.includes(reservation?.status) && Boolean(reservation?.time);

/*
 * Las reservas que ocupan la fila que empieza en `rowTime` para ese rig.
 * Antes el calendario solo miraba la hora de inicio, así que una reserva
 * de 3 horas a las 2 PM dejaba 3 y 4 PM vacías y parecían libres.
 * Devuelve un array: más de una es un choque que hay que ver.
 */
export function reservationsInCell(reservations, rig, rowTime, hasRig) {
    const rowStart = hm(rowTime);
    const rowEnd = rowStart + 60;
    return reservations.filter((r) => {
        if (!isCalendarReservation(r) || !hasRig(r, rig)) return false;
        const [start, end] = reservationWindow(r);
        return start < rowEnd && rowStart < end;
    });
}

/*
 * Qué parte de la reserva cae en esta fila: "start" (la primera fila, la
 * que muestra el nombre), "middle" o "end" (la última); "single" si dura
 * una sola fila.
 */
export function cellPart(reservation, rowTime) {
    const rowStart = hm(rowTime);
    const rowEnd = rowStart + 60;
    const [start, end] = reservationWindow(reservation);
    const first = start >= rowStart && start < rowEnd;
    const last = end <= rowEnd;
    if (first && last) return "single";
    if (first) return "start";
    if (last) return "end";
    return "middle";
}

/*
 * El horario de un día según settings/reservations.hours (el mismo mapa
 * que usa el sitio público: 0 = domingo; sin entrada o null = cerrado).
 */
export function dayHours(hours, date) {
    if (!date) return null;
    const [y, m, d] = String(date).split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    const entry = hours?.[day] ?? hours?.[String(day)];
    return Array.isArray(entry) && entry.length === 2 ? entry : null;
}

// ¿La fila cae fuera del horario de atención de ese día?
export function isRowClosed(hours, date, rowTime) {
    const open = dayHours(hours, date);
    if (!open) return true;
    const rowStart = hm(rowTime);
    return rowStart < hm(open[0]) || rowStart >= hm(open[1]);
}

// El bloqueo (availabilityLockdowns) que pisa esa fila, si hay.
export function lockdownInRow(lockdowns, date, rowTime) {
    const rowStart = hm(rowTime);
    const rowEnd = rowStart + 60;
    return (lockdowns || []).find(
        (l) => l.active !== false && l.date === date && l.start && l.end &&
            hm(l.start) < rowEnd && rowStart < hm(l.end)
    ) || null;
}

const reservationTotal = (r) => Number(r.pricing?.total ?? r.total ?? 0) || 0;

/*
 * Las métricas arriba del calendario. `rigCount` son los simuladores que
 * se muestran; `openHours` las horas que abre ese día (para la ocupación).
 */
export function daySummary(reservations, date, rigCount, openHours) {
    const list = reservations.filter((r) => r.date === date && isCalendarReservation(r));
    const pending = list.filter((r) => r.status === "pending");
    const approved = list.filter((r) => r.status === "approved");
    const rigHours = list.reduce(
        (sum, r) => sum + (Number(r.duration) || 1) * Math.max((r.rigs || r.simulators || []).length, 1),
        0
    );
    const capacity = rigCount * openHours;
    return {
        total: list.length,
        pending: pending.length,
        approved: approved.length,
        income: approved.reduce((sum, r) => sum + reservationTotal(r), 0),
        pendingIncome: pending.reduce((sum, r) => sum + reservationTotal(r), 0),
        occupancy: capacity > 0 ? Math.min(100, Math.round((rigHours / capacity) * 100)) : 0
    };
}

// Las reservas pendientes de hoy en adelante: el número en el menú.
export function pendingCount(reservations, todayStr) {
    return reservations.filter((r) => r.status === "pending" && String(r.date || "") >= todayStr).length;
}

const isoDate = (d) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;

export function addDays(date, n) {
    const [y, m, d] = String(date).split("-").map(Number);
    return isoDate(new Date(Date.UTC(y, m - 1, d + n, 12)));
}

// Los 7 días (lunes a domingo) de la semana de `date`.
export function weekDates(date) {
    const [y, m, d] = String(date).split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
    const monday = addDays(date, -((day + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/*
 * Vista SEMANA: cuántos simuladores hay ocupados en cada día/hora. Se
 * cuenta por rig (una reserva de 3 simuladores ocupa 3).
 */
export function weekOccupancy(reservations, dates, rowTimes, rigs, hasRig) {
    const byDate = new Map(dates.map((d) => [d, reservations.filter((r) => r.date === d && isCalendarReservation(r))]));
    return dates.map((date) =>
        rowTimes.map((t) => {
            const list = byDate.get(date);
            const busy = rigs.filter((rig) => reservationsInCell(list, rig, t, hasRig).length > 0).length;
            const rowStart = hm(t);
            const pending = list.some((r) => {
                const [start, end] = reservationWindow(r);
                return r.status === "pending" && start < rowStart + 60 && rowStart < end;
            });
            return { busy, pending };
        })
    );
}

const fold = (v) =>
    String(v ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");

/*
 * Búsqueda de RESERVAS por código, nombre, correo o teléfono. En el
 * teléfono se comparan solo los dígitos ("9999-0000" encuentra "99990000").
 * Las más cercanas a hoy primero.
 */
export function searchReservations(reservations, text, { limit = 8, today = "" } = {}) {
    const needle = fold(text).trim();
    if (needle.length < 2) return [];
    const digits = needle.replace(/\D/g, "");
    const matches = reservations.filter((r) => {
        const c = r.customer || {};
        if ([r.code, r.id, c.name, c.email].some((v) => fold(v).includes(needle))) return true;
        const phone = String(c.phone || c.phoneNumber || "").replace(/\D/g, "");
        return digits.length >= 3 && phone.includes(digits);
    });
    const distance = (r) => Math.abs(Date.parse(r.date || "1970-01-01") - Date.parse(today || "1970-01-01"));
    return matches.sort((a, b) => distance(a) - distance(b)).slice(0, limit);
}

/*
 * Links de contacto para el detalle de la reserva. Los teléfonos de
 * Honduras tienen 8 dígitos; si viene así, se le agrega el 504.
 */
export function phoneDigits(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.length === 8) return `504${digits}`;
    return digits.length >= 8 ? digits : "";
}

export function whatsappUrl(phone, message = "") {
    const digits = phoneDigits(phone);
    if (!digits) return "";
    return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

export function telUrl(phone) {
    const digits = phoneDigits(phone);
    return digits ? `tel:+${digits}` : "";
}
