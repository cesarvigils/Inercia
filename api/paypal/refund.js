import { FieldValue } from 'firebase-admin/firestore';
import { method, json, fail, requireUser } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { bad } from '../_lib/reservations.js';
import { paypalRequest } from '../_lib/paypal.js';

async function requireAdmin(user) {
    const snapshot = await adminDb.doc(`adminUsers/${user.uid}`).get();
    if (!snapshot.exists || snapshot.data()?.enabled !== true) {
        throw bad('No tenés permiso para hacer reembolsos.', 403);
    }
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);
        await requireAdmin(user);

        const reservationId = String(req.body?.reservationId || '').trim();
        if (!reservationId) throw bad('Reserva inválida.');

        const ref = adminDb.doc(`reservations/${reservationId}`);
        const snapshot = await ref.get();
        if (!snapshot.exists) throw bad('La reserva no existe.', 404);

        const reservation = snapshot.data();
        const payment = reservation.payment || {};

        if (payment.method !== 'paypal' || payment.status === 'pending') {
            throw bad('Esta reserva no tiene un pago PayPal reembolsable.', 409);
        }
        if (!payment.paypalCaptureId) throw bad('Falta el Capture ID de PayPal.', 409);

        const totalHNL = Number(payment.totalHNL ?? reservation.pricing?.total ?? 0);
        const alreadyRefundedHNL = Number(payment.refundedHNL || 0);
        const remainingHNL = Math.max(0, totalHNL - alreadyRefundedHNL);

        if (remainingHNL <= 0) throw bad('Esta reserva ya fue reembolsada completamente.', 409);

        const requestedHNL = req.body?.amountHNL == null || req.body?.amountHNL === ''
            ? remainingHNL
            : Number(req.body.amountHNL);

        if (!Number.isFinite(requestedHNL) || requestedHNL <= 0 || requestedHNL > remainingHNL) {
            throw bad('Monto de reembolso inválido.');
        }

        const exchangeRate = Number(payment.exchangeRate || 0);
        if (!exchangeRate) throw bad('La reserva no tiene guardada la tasa original de PayPal.', 409);

        const amountUSD = (requestedHNL / exchangeRate).toFixed(2);
        const fullRefund = Math.abs(requestedHNL - remainingHNL) < 0.01;

        const refund = await paypalRequest(
            `/v2/payments/captures/${encodeURIComponent(payment.paypalCaptureId)}/refund`,
            {
                method: 'POST',
                headers: {
                    'PayPal-Request-Id': `refund-${reservationId}-${Date.now()}`
                },
                body: JSON.stringify(
                    fullRefund
                        ? {}
                        : {
                            amount: {
                                currency_code: 'USD',
                                value: amountUSD
                            },
                            note_to_payer: `Reembolso reserva ${reservation.code}`
                        }
                )
            }
        );

        if (!['COMPLETED', 'PENDING'].includes(refund.status)) {
            throw bad('PayPal no aceptó el reembolso.', 409);
        }

        const refundedHNL = Number((alreadyRefundedHNL + requestedHNL).toFixed(2));
        const refundedUSD = Number(payment.refundedUSD || 0) + Number(refund.amount?.value || amountUSD);
        const fullyRefunded = refundedHNL >= totalHNL - 0.01;

        await ref.update({
            'payment.status': fullyRefunded ? 'refunded' : 'partially_refunded',
            'payment.refundedHNL': refundedHNL,
            'payment.refundedUSD': refundedUSD.toFixed(2),
            'payment.lastRefundId': refund.id,
            'payment.lastRefundStatus': refund.status,
            'payment.lastRefundAt': FieldValue.serverTimestamp(),
            'payment.refunds': FieldValue.arrayUnion({
                id: refund.id,
                status: refund.status,
                amountHNL: requestedHNL,
                amountUSD: refund.amount?.value || amountUSD,
                currency: 'USD',
                createdBy: user.uid,
                createdAt: new Date().toISOString()
            }),
            updatedAt: FieldValue.serverTimestamp()
        });

        return json(res, 200, {
            ok: true,
            refundId: refund.id,
            status: refund.status,
            amountHNL: requestedHNL,
            amountUSD: refund.amount?.value || amountUSD,
            fullyRefunded
        });
    } catch (error) {
        return fail(res, error);
    }
}
