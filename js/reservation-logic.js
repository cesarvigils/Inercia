/*
 * Lógica pura del panel de reservas: precios, promoción de martes, ids de
 * reservationLocks y los payloads que se escriben en Firestore.
 *
 * Vive fuera de js/admin.js a propósito: admin.js toca el DOM y el SDK de
 * Firebase apenas se importa, así que nada de lo que hay adentro se puede
 * ejecutar en Node. Todo lo de este archivo es determinístico y sin
 * dependencias, que es lo que hace posible probarlo en tests/.
 */

// Regla de negocio permanente: todos los martes son 50% off (espeja
// applyTuesdayPromotion en api/_lib/reservations.js del sitio principal
// para que las reservas creadas desde el panel coincidan).
export const TUESDAY_DISCOUNT_PERCENT = 50;

export const DEFAULT_PRICES = {
    standard: 200,
    premium: 350
};

export const LOCK_SLOT_MINUTES = 30;

export const EDITABLE_PAYMENT_METHODS = [
    "efectivo",
    "transferencia",
    "tarjeta"
];

// Solo pending y approved se pueden editar: una reserva de PayPal se
// aprueba sola al capturarse el pago y puede necesitar la misma
// corrección que una pendiente. Una rejected ya no cuenta para el
// calendario ni para disponibilidad.
export const EDITABLE_STATUSES = ["pending", "approved"];

export const isTuesday = (dateStr) => {
    if (!dateStr) return false;
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === 2;
};

export function normalizeRigType(value) {
    return String(value || "")
        .trim()
        .toLowerCase() === "premium"
        ? "premium"
        : "standard";
}

export function rigNumber(rig) {
    const type = normalizeRigType(rig.type);

    // Primero usamos number si existe.
    if (rig.number != null) {
        return Number(rig.number);
    }

    // Si el order global es 1-10:
    // Standard 1-8
    // Premium 9-10 -> Premium 1-2
    if (rig.order != null) {
        const order = Number(rig.order);

        if (type === "premium" && order > 8) {
            return order - 8;
        }

        return order;
    }

    // Último fallback: sacar número del nombre.
    const match = String(rig.name || "").match(/\d+/);

    return match
        ? Number(match[0])
        : 0;
}

export function displayRigName(rig) {
    const type = normalizeRigType(rig.type);
    const number = rigNumber(rig);

    return `${type === "premium" ? "Premium" : "Standard"} ${number}`;
}

export function rigPricePerHour(rig) {
    const type = normalizeRigType(rig.type);

    return Number(rig.pricePerHour ?? DEFAULT_PRICES[type]);
}

/*
 * El total que muestran (y guardan) tanto NUEVA RESERVA como EDITAR
 * RESERVA. Redondea a centavos en cada paso igual que lo hacía el cálculo
 * inline en admin.js, para no introducir diferencias de centavos contra
 * las reservas ya guardadas.
 */
export function calculateReservationTotal({ rigs = [], selectedIds = [], duration = 1, date } = {}) {
    const hours = Number(duration) || 1;
    const ids = new Set(selectedIds.map(String));

    const selectedRigs = rigs.filter((rig) => ids.has(String(rig.id)));

    const subtotal = selectedRigs.reduce(
        (sum, rig) => sum + (rigPricePerHour(rig) * hours),
        0
    );

    const tuesdayDiscount = isTuesday(date)
        ? Math.round(subtotal * (TUESDAY_DISCOUNT_PERCENT / 100) * 100) / 100
        : 0;

    const total = Math.round((subtotal - tuesdayDiscount) * 100) / 100;

    return { subtotal, tuesdayDiscount, total, selectedRigs };
}

// El bloque `pricing` tal cual se guarda en el doc de la reserva.
export function buildPricingFields({ subtotal, tuesdayDiscount, total }) {
    return {
        beforeTuesdayDiscount: subtotal,
        tuesdayDiscount,
        tuesdayDiscountPercent: tuesdayDiscount ? TUESDAY_DISCOUNT_PERCENT : 0,
        tuesdayPromotionApplied: tuesdayDiscount > 0,
        total
    };
}

// El array `rigs` congelado dentro de la reserva: guarda nombre, tipo,
// número y precio del momento, para que editar un rig después no cambie
// reservas ya hechas.
export function buildReservationRigs(selectedRigs = []) {
    return selectedRigs.map((rig) => ({
        id: rig.id,
        rigId: rig.id,
        name: displayRigName(rig),
        type: normalizeRigType(rig.type),
        number: rigNumber(rig),
        pricePerHour: rigPricePerHour(rig)
    }));
}

/*
 * Helpers de reservationLocks — espejan hm()/slotIds()/isLockActive()/
 * expiresAt() de api/_lib/reservations.js del sitio principal exactamente
 * (mismo formato de id, mismo tamaño de slot, misma expiración) para que
 * un lock creado de cualquier lado lo entienda el otro.
 */
export function hm(value) {
    const [h, m] = String(value).split(":").map(Number);
    return h * 60 + m;
}

export function slotIds(date, start, end, rigId) {
    const out = [];
    for (let m = start; m < end; m += LOCK_SLOT_MINUTES) {
        out.push(`${date}_${String(Math.floor(m / 60)).padStart(2, "0")}${String(m % 60).padStart(2, "0")}_${rigId}`);
    }
    return out;
}

// Misma regla que expiresAt() en api/_lib/reservations.js: ~6h después de
// la hora de inicio de la reserva, no 6h desde ahora.
export function lockExpiresAtDate(date, time) {
    const [y, m, d] = String(date).split("-").map(Number);
    const [h, mi] = String(time).split(":").map(Number);
    return new Date(Date.UTC(y, m - 1, d, h + 6, mi));
}

export function isLockSnapshotActive(snapshot) {
    if (!snapshot.exists()) return false;
    const expiry = snapshot.data()?.expiresAt;
    if (expiry && typeof expiry.toMillis === "function" && expiry.toMillis() < Date.now()) return false;
    return true;
}

export function canEditReservation(status) {
    return EDITABLE_STATUSES.includes(status);
}

export function currentPaymentMethod(reservation) {
    return typeof reservation?.payment === "string"
        ? reservation.payment
        : reservation?.payment?.method || "efectivo";
}

/*
 * Opciones del <select> MÉTODO DE PAGO al editar. Una reserva pagada por
 * PayPal (o cualquier otro método que el formulario no ofrece) no está en
 * EDITABLE_PAYMENT_METHODS; sin esta opción de respaldo el <select> cae en
 * la primera opción (EFECTIVO) sin marcarla, y guardar sin tocar el campo
 * le cambiaría el método de pago real a "efectivo" en silencio.
 */
export function paymentOptionsFor(currentPayment) {
    const options = EDITABLE_PAYMENT_METHODS.map((method) => ({
        value: method,
        label: method.toUpperCase(),
        selected: method === currentPayment
    }));

    if (!EDITABLE_PAYMENT_METHODS.includes(currentPayment)) {
        options.push({
            value: currentPayment,
            label: String(currentPayment).toUpperCase(),
            selected: true
        });
    }

    return options;
}

/*
 * Todo lo que necesita saber la transacción que crea una reserva manual:
 * qué locks hay que revisar y crear, y el array de rigs congelado.
 */
export function planManualReservation({ date, time, duration, selectedRigs = [] }) {
    const start = hm(time);
    const end = start + (Number(duration) || 1) * 60;
    const reservationRigs = buildReservationRigs(selectedRigs);

    const lockIds = reservationRigs.flatMap(
        (rig) => slotIds(date, start, end, rig.id)
    );

    return { start, end, lockIds, reservationRigs };
}

/*
 * Reconcilia los reservationLocks viejos contra los nuevos: solo se
 * revisan (y pueden bloquear el guardado) los slots que la reserva NO
 * tenía ya — los que se mantienen entre el horario viejo y el nuevo no se
 * tocan, y los que ya no hacen falta se liberan.
 */
export function planReservationEdit({ reservation, currentRigIds = [], date, time, duration, selectedRigs = [] }) {
    const start = hm(time);
    const end = start + (Number(duration) || 1) * 60;

    const oldStart = hm(reservation.time);
    const oldEnd = oldStart + (Number(reservation.duration) || 1) * 60;

    const oldLockIds = new Set(
        [...currentRigIds].flatMap(
            (rigId) => slotIds(reservation.date, oldStart, oldEnd, rigId)
        )
    );

    const reservationRigs = buildReservationRigs(selectedRigs);

    const newLockIds = new Set(
        reservationRigs.flatMap(
            (rig) => slotIds(date, start, end, rig.id)
        )
    );

    return {
        start,
        end,
        reservationRigs,
        idsToRelease: [...oldLockIds].filter((id) => !newLockIds.has(id)),
        idsToCheck: [...newLockIds].filter((id) => !oldLockIds.has(id))
    };
}

export function slotTakenError() {
    return Object.assign(
        new Error("Uno de esos simuladores ya está reservado para ese horario."),
        { code: "slot-taken" }
    );
}
