/*
 * POST /api/paypal/create-order
 *
 * First step of the PayPal checkout flow. Given the booking details in
 * the request body (date, time, duration, rigIds, ...), this:
 *   1. Validates and prices the reservation, then writes it to Firestore
 *      as 'payment_pending' (and locks the requested rig/time slots) via
 *      createPaypalPendingReservation() — see api/_lib/paypal-reservation.js
 *      for the full transaction logic.
 *   2. Creates a matching PayPal order (CAPTURE intent, amount in USD)
 *      and stores its order id back onto the reservation.
 *   3. Returns the PayPal orderID to the frontend, which uses it to render
 *      the PayPal Buttons popup.
 *
 * If anything fails after the reservation was created but before this
 * responds successfully, the catch block releases the reservation (marks
 * it 'payment_failed' and frees its locks) so the slot doesn't stay stuck
 * as reserved.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { method, json, fail, requireUser, rateLimit } from '../_lib/http.js';
import { bad } from '../_lib/reservations.js';
import { paypalRequest } from '../_lib/paypal.js';
import {
    createPaypalPendingReservation,
    releasePaypalReservation
} from '../_lib/paypal-reservation.js';

export default async function handler(req, res) {
    let draft = null;

    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);
        if (!user?.uid) throw bad('Tenés que iniciar sesión.', 401);

        if (!rateLimit(req, res, { key: `paypal-create:${user.uid}`, limit: 5, windowMs: 60_000 })) return;

        draft = await createPaypalPendingReservation(user, req.body || {});

        const order = await paypalRequest('/v2/checkout/orders', {
            method: 'POST',
            headers: {
                'PayPal-Request-Id': `reservation-${draft.reservationRef.id}`
            },
            body: JSON.stringify({
                intent: 'CAPTURE',
                purchase_units: [
                    {
                        reference_id: draft.reservationRef.id,
                        custom_id: draft.reservationRef.id,
                        invoice_id: draft.reservationCode,
                        description: `Reserva ${draft.reservationCode} - Simuladores Inercia`,
                        amount: {
                            currency_code: 'USD',
                            value: draft.amountUSD
                        }
                    }
                ]
            })
        });

        if (!order?.id || order.status !== 'CREATED') {
            throw new Error('PayPal no creó la orden correctamente.');
        }

        await draft.reservationRef.update({
            'payment.paypalOrderId': order.id,
            'payment.paypalOrderStatus': order.status,
            updatedAt: FieldValue.serverTimestamp()
        });

        return json(res, 201, {
            orderID: order.id,
            reservationId: draft.reservationRef.id,
            code: draft.reservationCode,
            totalHNL: Number(draft.pricing.total),
            amountUSD: draft.amountUSD,
            currency: 'USD',
            exchangeRate: draft.exchangeRate
        });
    } catch (error) {
        if (draft?.reservationRef?.id) {
            await releasePaypalReservation(draft.reservationRef.id, 'payment_failed')
                .catch((cleanupError) => console.error('[PAYPAL CREATE CLEANUP]', cleanupError));
        }
        return fail(res, error);
    }
}
