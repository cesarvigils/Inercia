import { FieldValue } from 'firebase-admin/firestore';
import { method, json, fail, requireUser } from '../_lib/http.js';
import { adminDb } from '../_lib/firebase-admin.js';
import { bad } from '../_lib/reservations.js';

async function requireAdmin(user) {
    const snapshot = await adminDb.doc(`adminUsers/${user.uid}`).get();
    if (!snapshot.exists || snapshot.data()?.enabled !== true) {
        throw bad('No tenés acceso a esta configuración.', 403);
    }
}

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET', 'POST'])) return;

        const user = await requireUser(req);
        await requireAdmin(user);

        const ref = adminDb.doc('settings/payments');

        if (req.method === 'GET') {
            const snapshot = await ref.get();
            const data = snapshot.exists ? snapshot.data() || {} : {};
            return json(res, 200, {
                paypal: {
                    enabled: data.paypal?.enabled !== false,
                    hnlPerUsd: Number(
                        data.paypal?.hnlPerUsd ||
                        process.env.PAYPAL_HNL_USD_RATE ||
                        0
                    )
                }
            });
        }

        const hnlPerUsd = Number(req.body?.hnlPerUsd);
        const enabled = req.body?.enabled !== false;

        if (!Number.isFinite(hnlPerUsd) || hnlPerUsd <= 0) {
            throw bad('Ingresá una tasa HNL/USD válida.');
        }

        await ref.set({
            paypal: {
                enabled,
                hnlPerUsd
            },
            updatedAt: FieldValue.serverTimestamp(),
            updatedBy: user.uid
        }, { merge: true });

        return json(res, 200, {
            ok: true,
            paypal: { enabled, hnlPerUsd }
        });
    } catch (error) {
        return fail(res, error);
    }
}
