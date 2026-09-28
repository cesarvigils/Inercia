/*
 * Lógica pura de REEMBOLSOS: qué reservas pagadas con PayPal se pueden
 * reembolsar, cuánto queda por devolver y la llamada al endpoint que
 * hace el reembolso.
 *
 * El reembolso en sí lo hace api/paypal/refund.js del sitio principal
 * (rama main), que es donde están las credenciales de PayPal y el Admin
 * SDK: verifica el token de Firebase contra adminUsers/{uid}, reembolsa
 * el capture de PayPal y guarda payment.refundedHNL / payment.refunds[]
 * en la reserva. vercel.json de este panel reescribe /api/paypal/refund
 * hacia el sitio, así que desde el navegador es una llamada al mismo
 * origen (sin CORS y sin tocar el CSP).
 *
 * Igual que reservation-logic.js, vive fuera de js/admin.js para poder
 * probarlo en Node (tests/refund-logic.test.mjs).
 */

export const REFUND_ENDPOINT = "/api/paypal/refund";

// Estados de payment con los que api/paypal/refund.js deja reembolsar.
// "refunded" se incluye para que el historial siga visible; su saldo es 0.
export const PAID_PAYMENT_STATUSES = ["paid", "partially_refunded", "refunded"];

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/*
 * Resumen de pago/reembolso de una reserva, o null si no fue pagada con
 * PayPal (efectivo, transferencia, o un checkout que nunca se capturó).
 * El total sale de payment.totalHNL como en el servidor, con
 * pricing.total de respaldo.
 */
export function refundInfo(reservation) {
    const payment = reservation?.payment;
    if (!payment || typeof payment !== "object") return null;
    if (payment.method !== "paypal" || !payment.paypalCaptureId) return null;
    if (!PAID_PAYMENT_STATUSES.includes(payment.status)) return null;

    const totalHNL = round2(payment.totalHNL ?? reservation.pricing?.total ?? 0);
    const refundedHNL = round2(payment.refundedHNL);
    const remainingHNL = Math.max(0, round2(totalHNL - refundedHNL));

    return {
        totalHNL,
        refundedHNL,
        remainingHNL,
        amountUSD: payment.amountUSD ?? null,
        refundedUSD: payment.refundedUSD ?? "0.00",
        paymentStatus: payment.status,
        lastRefundStatus: payment.lastRefundStatus || null,
        refunds: Array.isArray(payment.refunds) ? payment.refunds : [],
        refundable: remainingHNL > 0
    };
}

export function refundStatusLabel(info) {
    if (!info) return "";
    const base = {
        paid: "PAGADO",
        partially_refunded: "REEMBOLSO PARCIAL",
        refunded: "REEMBOLSADO"
    }[info.paymentStatus] || String(info.paymentStatus || "").toUpperCase();
    return info.lastRefundStatus === "PENDING" ? `${base} (PENDIENTE EN PAYPAL)` : base;
}

/*
 * Filas para la tabla de REEMBOLSOS, más reciente primero.
 *   filter "pending"  -> con saldo por devolver (el caso de uso normal:
 *                        una reserva PayPal rechazada o cancelada)
 *   filter "refunded" -> con al menos un reembolso hecho
 *   filter "all"      -> todas las pagadas con PayPal
 */
export function refundRows(reservations, filter = "pending") {
    return (reservations || [])
        .map((reservation) => ({ reservation, info: refundInfo(reservation) }))
        .filter(({ info }) => {
            if (!info) return false;
            if (filter === "pending") return info.refundable;
            if (filter === "refunded") return info.refundedHNL > 0;
            return true;
        })
        .sort((a, b) =>
            `${b.reservation.date || ""} ${b.reservation.time || ""}`.localeCompare(
                `${a.reservation.date || ""} ${a.reservation.time || ""}`
            )
        );
}

/*
 * Valida el monto que escribió el admin. Vacío = reembolso total del
 * saldo. Devuelve { amountHNL } (null = total) o { error }.
 */
export function parseRefundAmount(input, remainingHNL) {
    const raw = String(input ?? "").trim().replace(",", ".");
    if (!raw) return { amountHNL: null };

    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount <= 0) {
        return { error: "Ingresá un monto mayor a 0." };
    }
    const rounded = round2(amount);
    if (rounded > round2(remainingHNL)) {
        return { error: `El monto no puede ser mayor al saldo (L ${round2(remainingHNL)}).` };
    }
    // El saldo exacto es un reembolso total; el servidor lo trata igual.
    return { amountHNL: rounded === round2(remainingHNL) ? null : rounded };
}

/*
 * POST al endpoint de reembolso con el ID token del admin. fetchImpl se
 * pasa por parámetro para que los tests no hagan red.
 */
export async function requestRefund({ user, reservationId, amountHNL = null, fetchImpl = fetch }) {
    if (!user) throw new Error("Tenés que iniciar sesión.");
    const token = await user.getIdToken();

    const response = await fetchImpl(REFUND_ENDPOINT, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(
            amountHNL == null ? { reservationId } : { reservationId, amountHNL }
        )
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
        throw new Error(data.error || `No se pudo hacer el reembolso (HTTP ${response.status}).`);
    }
    return data;
}
