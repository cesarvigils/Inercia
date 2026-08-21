import { method, json, fail, requireUser } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { bad } from '../_lib/reservations.js';
import { releasePaypalReservation } from '../_lib/paypal-reservation.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['POST'])) return;

        const user = await requireUser(req);
        const reservationId = String(req.body?.reservationId || '').trim();

        if (!reservationId) throw bad('Reserva inválida.');

        const ref = adminDb.doc(`reservations/${reservationId}`);
        const snapshot = await ref.get();

        if (!snapshot.exists) return json(res, 200, { ok: true });

        const reservation = snapshot.data();

        if (reservation.uid !== user.uid) throw bad('No tenés acceso a esta reserva.', 403);

        if (reservation.status === 'approved') {
            throw bad('La reserva ya fue pagada y aprobada.', 409);
        }

        if (!['payment_pending', 'payment_failed'].includes(reservation.status)) {
            return json(res, 200, { ok: true, status: reservation.status });
        }

        await releasePaypalReservation(reservationId, 'cancelled');

        return json(res, 200, { ok: true, status: 'cancelled' });
    } catch (error) {
        return fail(res, error);
    }
}
