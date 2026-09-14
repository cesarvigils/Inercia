/*
 * POST /api/paypal/webhook
 *
 * Receives asynchronous event notifications directly from PayPal
 * (configured in the PayPal developer dashboard to point at this URL).
 * This exists as a safety net alongside api/paypal/capture-order.js:
 * the frontend-driven capture is the normal path, but if the browser
 * closes/crashes right after PayPal captures the payment but before the
 * capture-order request completes, this webhook is what still marks the
 * reservation 'approved' — otherwise the customer would be charged
 * without a confirmed booking.
 *
 * Security: every event is verified with PayPal's signature-verification
 * API (verifyPaypalWebhook) using headers PayPal sends with the request;
 * unverified events are rejected with 401 and never touch Firestore.
 *
 * Idempotency: each PayPal event has a unique `id`. We record it in
 * paypalWebhookEvents/<id> and skip processing if we've already seen it,
 * because PayPal retries webhook deliveries and can send the same event
 * more than once.
 *
 * Only PAYMENT.CAPTURE.COMPLETED is currently handled; other event types
 * are acknowledged (200 OK) but otherwise ignored.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { method, json } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { verifyPaypalWebhook } from '../_lib/paypal.js';

// Reservations don't store PayPal's capture id until after our own
// capture-order flow runs, so incoming webhooks match by the order id
// that was stored back in api/paypal/create-order.js.
async function findReservationByOrderId(orderId) {
    if (!orderId) return null;
    const snapshot = await adminDb
        .collection('reservations')
        .where('payment.paypalOrderId', '==', orderId)
        .limit(1)
        .get();
    if (snapshot.empty) return null;
    return snapshot.docs[0];
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const event = req.body || {};
        const verified = await verifyPaypalWebhook(req.headers, event);
        if (!verified) {
            return json(res, 401, { error: 'Firma de webhook inválida.' });
        }

        if (event.id) {
            const eventRef = adminDb.doc(`paypalWebhookEvents/${event.id}`);
            const seen = await eventRef.get();
            if (seen.exists) return json(res, 200, { ok: true, duplicate: true });
            await eventRef.set({
                type: event.event_type || null,
                receivedAt: FieldValue.serverTimestamp()
            });
        }

        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
            const capture = event.resource || {};
            const orderId = capture?.supplementary_data?.related_ids?.order_id;
            const doc = await findReservationByOrderId(orderId);

            if (doc) {
                const reservation = doc.data();
                const expected = Number(reservation.payment?.amountUSD || 0).toFixed(2);
                const actual = Number(capture.amount?.value || 0).toFixed(2);

                if (
                    reservation.status === 'payment_pending' &&
                    capture.status === 'COMPLETED' &&
                    capture.amount?.currency_code === 'USD' &&
                    expected === actual
                ) {
                    await doc.ref.update({
                        status: 'approved',
                        'confirmation.status': 'approved',
                        'confirmation.approvedAt': FieldValue.serverTimestamp(),
                        'confirmation.approvedBy': 'paypal_webhook',
                        'confirmation.whatsapp.approvedStatus': 'pending',
                        'confirmation.whatsapp.pdfStatus': 'pending',
                        'payment.status': 'paid',
                        'payment.paypalCaptureId': capture.id,
                        'payment.paidAt': FieldValue.serverTimestamp(),
                        updatedAt: FieldValue.serverTimestamp()
                    });
                }
            }
        }

        return json(res, 200, { ok: true });
    } catch (error) {
        console.error('[PAYPAL WEBHOOK]', error);
        return json(res, 500, { error: 'Webhook no procesado.' });
    }
}
