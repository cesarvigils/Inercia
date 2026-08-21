import { FieldValue } from 'firebase-admin/firestore';
import { method, json } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { verifyPaypalWebhook } from '../_lib/paypal.js';

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
