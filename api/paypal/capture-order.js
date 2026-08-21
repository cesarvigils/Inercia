import { FieldValue } from 'firebase-admin/firestore';
import { method, json, fail, requireUser } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { bad } from '../_lib/reservations.js';
import { paypalRequest } from '../_lib/paypal.js';

function captureFromOrder(order) {
    return order?.purchase_units?.[0]?.payments?.captures?.[0] || null;
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);
        const reservationId = String(req.body?.reservationId || '').trim();
        const orderID = String(req.body?.orderID || '').trim();

        if (!reservationId || !orderID) throw bad('Orden de PayPal inválida.');

        const reservationRef = adminDb.doc(`reservations/${reservationId}`);
        const before = await reservationRef.get();
        if (!before.exists) throw bad('La reserva ya no existe.', 404);

        const reservation = before.data();
        if (reservation.uid !== user.uid) throw bad('No tenés acceso a esta reserva.', 403);

        if (reservation.status === 'approved' && reservation.payment?.paypalCaptureId) {
            return json(res, 200, {
                ok: true,
                status: 'approved',
                code: reservation.code,
                captureId: reservation.payment.paypalCaptureId,
                totalHNL: reservation.pricing?.total,
                amountUSD: reservation.payment?.amountUSD
            });
        }

        if (reservation.status !== 'payment_pending') {
            throw bad(`La reserva ya está ${reservation.status}.`, 409);
        }

        if (reservation.payment?.paypalOrderId !== orderID) {
            throw bad('La orden de PayPal no corresponde a esta reserva.', 409);
        }

        const order = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
            method: 'POST',
            headers: {
                'PayPal-Request-Id': `capture-${reservationId}`
            },
            body: '{}'
        });

        const capture = captureFromOrder(order);
        if (order.status !== 'COMPLETED' || !capture || capture.status !== 'COMPLETED') {
            throw bad('PayPal todavía no confirmó el pago.', 409);
        }

        const expectedValue = Number(reservation.payment?.amountUSD || 0).toFixed(2);
        const actualValue = Number(capture.amount?.value || 0).toFixed(2);
        const currency = capture.amount?.currency_code;

        if (currency !== 'USD' || actualValue !== expectedValue) {
            console.error('[PAYPAL AMOUNT MISMATCH]', { expectedValue, actualValue, currency });
            throw bad('El monto confirmado por PayPal no coincide con la reserva.', 409);
        }

        await adminDb.runTransaction(async (transaction) => {
            const freshSnapshot = await transaction.get(reservationRef);
            if (!freshSnapshot.exists) throw bad('La reserva ya no existe.', 404);

            const fresh = freshSnapshot.data();
            if (fresh.status === 'approved') return;
            if (fresh.status !== 'payment_pending') {
                throw bad(`La reserva ya está ${fresh.status}.`, 409);
            }

            transaction.update(reservationRef, {
                status: 'approved',
                'confirmation.status': 'approved',
                'confirmation.approvedAt': FieldValue.serverTimestamp(),
                'confirmation.approvedBy': 'paypal',
                'confirmation.whatsapp.approvedStatus': 'pending',
                'confirmation.whatsapp.pdfStatus': 'pending',
                'payment.status': 'paid',
                'payment.paypalOrderStatus': order.status,
                'payment.paypalCaptureId': capture.id,
                'payment.paidAt': FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            });
        });

        return json(res, 200, {
            ok: true,
            status: 'approved',
            code: reservation.code,
            captureId: capture.id,
            totalHNL: reservation.pricing?.total,
            amountUSD: actualValue,
            currency: 'USD'
        });
    } catch (error) {
        return fail(res, error);
    }
}
