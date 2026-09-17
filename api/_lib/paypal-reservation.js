/*
 * api/_lib/paypal-reservation.js
 *
 * Builds and persists a "payment_pending" reservation for the PayPal
 * checkout flow. This is the bridge between the booking rules in
 * reservations.js and the PayPal order in api/paypal/create-order.js.
 *
 * Flow:
 *   1. api/paypal/create-order.js calls createPaypalPendingReservation(user, body).
 *   2. That calls buildPaypalReservationData() to validate the request,
 *      price it, and build the full Firestore document to write.
 *   3. It then runs a Firestore transaction that (a) checks none of the
 *      required reservationLocks/<slotId> documents already exist (i.e.
 *      the rig/time isn't already booked or held), (b) creates those lock
 *      documents, and (c) creates the reservation document itself, all
 *      atomically — this is what prevents double-booking.
 *   4. If the user never completes payment, releasePaypalReservation()
 *      is called (e.g. from a cancel/expire path) to mark the reservation
 *      as cancelled/expired and delete its locks so the slot frees up.
 *
 * The permanent "every Tuesday = 50% off" rule and admin lockdown
 * enforcement both live in ./reservations.js (applyTuesdayPromotion,
 * getActiveLockdowns/findOverlappingLockdown) and are called the same way
 * from api/reservations/create.js's bank-transfer path, so both payment
 * methods behave identically.
 */

import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebase-admin.js';
import {
    getConfig,
    validateWhen,
    activePromotions,
    priceReservation,
    applyTuesdayPromotion,
    getActiveLockdowns,
    findOverlappingLockdown,
    slotIds,
    code,
    bad
} from './reservations.js';
import { getPaypalRate, hnlToUsd } from './paypal.js';

const MAX_RIGS = 10;
const CHECKOUT_TTL_MINUTES = 15;

export async function buildPaypalReservationData(user, body) {
    const config = await getConfig();
    const when = validateWhen(body.date, body.time, body.duration, config);

    const lockdowns = await getActiveLockdowns(body.date);
    const overlappingLockdown = findOverlappingLockdown(lockdowns, when.start, when.end);
    if (overlappingLockdown) {
        throw bad(
            overlappingLockdown.reason
                ? `Horario no disponible: ${overlappingLockdown.reason}.`
                : 'Este horario no está disponible temporalmente.',
            409
        );
    }

    if (!Array.isArray(body.rigIds) || body.rigIds.length === 0 || body.rigIds.length > MAX_RIGS) {
        throw bad('Seleccioná al menos un simulador válido.');
    }

    const uniqueRigIds = [...new Set(body.rigIds.map((id) => String(id).trim()))].filter(Boolean);
    if (uniqueRigIds.length === 0 || uniqueRigIds.length > MAX_RIGS) {
        throw bad('La selección de simuladores es inválida.');
    }

    const profileDoc = await adminDb.doc(`users/${user.uid}`).get();
    const profile = profileDoc.exists ? profileDoc.data() || {} : {};

    const customer = {
        name: String(profile.name || user.name || '').trim(),
        email: String(profile.email || user.email || '').trim().toLowerCase(),
        phoneNumber: String(profile.phone || profile.phoneNumber || '').trim()
    };

    if (!customer.name) throw bad('Tu cuenta no tiene un nombre registrado.');
    if (!customer.email) throw bad('Tu cuenta no tiene un correo registrado.');
    if (!customer.phoneNumber) throw bad('Tu cuenta no tiene un número de teléfono registrado.');

    const rigRefs = uniqueRigIds.map((id) => adminDb.doc(`rigs/${id}`));
    const rigDocs = await adminDb.getAll(...rigRefs);

    if (rigDocs.some((snapshot) => !snapshot.exists)) {
        throw bad('Uno de los simuladores seleccionados no existe.');
    }

    const rigs = rigDocs.map((snapshot) => {
        const data = snapshot.data() || {};
        return {
            id: snapshot.id,
            name: String(data.name || '').trim(),
            type: String(data.type || '').trim().toLowerCase(),
            order: Number(data.order),
            active: data.active === true || data.status === 'active',
            maintenance: data.maintenance === true || data.status === 'maintenance'
        };
    });

    if (rigs.some((rig) => !rig.active)) {
        throw bad('Uno de los simuladores seleccionados ya no está activo.');
    }
    if (rigs.some((rig) => rig.maintenance)) {
        throw bad('Uno de los simuladores seleccionados está en mantenimiento.');
    }
    if (rigs.some((rig) => !['standard', 'premium'].includes(rig.type))) {
        throw bad('Uno de los simuladores tiene una configuración inválida.');
    }

    const promotions = await activePromotions(body.date, rigs.map((rig) => rig.type));
    let pricing = priceReservation(rigs, Number(body.duration), config, promotions, when.lead);
    pricing = applyTuesdayPromotion(pricing, body.date);

    const exchangeRate = await getPaypalRate();
    const amountUSD = hnlToUsd(pricing.total, exchangeRate);

    const reservationRef = adminDb.collection('reservations').doc();
    const reservationCode = code();

    const lockRefs = rigs.flatMap((rig) =>
        slotIds(
            body.date,
            when.start,
            when.end,
            config.slotMinutes,
            rig.id
        ).map((id) => adminDb.doc(`reservationLocks/${id}`))
    );

    const paymentPendingExpiresAt = Timestamp.fromMillis(
        Date.now() + CHECKOUT_TTL_MINUTES * 60 * 1000
    );

    return {
        reservationRef,
        reservationCode,
        lockRefs,
        customer,
        rigs,
        pricing,
        promotions,
        exchangeRate,
        amountUSD,
        paymentPendingExpiresAt,
        reservationData: {
            code: reservationCode,
            uid: user.uid,
            customer,
            date: body.date,
            time: body.time,
            duration: Number(body.duration),
            rigs: rigs.map((rig) => ({
                id: rig.id,
                name: rig.name,
                type: rig.type,
                order: rig.order
            })),
            payment: {
                method: 'paypal',
                status: 'pending',
                totalHNL: Number(pricing.total),
                currency: 'USD',
                amountUSD,
                exchangeRate,
                paypalOrderId: null,
                paypalCaptureId: null,
                paidAt: null,
                refundedHNL: 0,
                refundedUSD: '0.00'
            },
            paymentVerification: {
                required: false,
                status: 'not_required',
                verifiedAt: null,
                verifiedBy: null
            },
            confirmation: {
                status: 'payment_pending',
                whatsapp: {
                    pendingStatus: 'skip',
                    approvedStatus: 'pending',
                    pdfStatus: 'pending'
                }
            },
            pricing,
            promotionIds: promotions.map((promotion) => promotion.id),
            status: 'payment_pending',
            paymentPendingExpiresAt,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        }
    };
}

export async function createPaypalPendingReservation(user, body) {
    const draft = await buildPaypalReservationData(user, body);

    await adminDb.runTransaction(async (transaction) => {
        const lockDocs = draft.lockRefs.length
            ? await transaction.getAll(...draft.lockRefs)
            : [];

        if (lockDocs.some((snapshot) => snapshot.exists)) {
            throw bad(
                'Uno de esos simuladores acaba de ser reservado. Actualizá la disponibilidad.',
                409
            );
        }

        for (const lockRef of draft.lockRefs) {
            transaction.create(lockRef, {
                reservationId: draft.reservationRef.id,
                uid: user.uid,
                paymentPending: true,
                expiresAt: draft.paymentPendingExpiresAt,
                createdAt: FieldValue.serverTimestamp()
            });
        }

        transaction.create(draft.reservationRef, draft.reservationData);
    });

    return draft;
}

export async function releasePaypalReservation(reservationId, reason = 'cancelled') {
    const reservationRef = adminDb.doc(`reservations/${reservationId}`);
    const locks = await adminDb
        .collection('reservationLocks')
        .where('reservationId', '==', reservationId)
        .get();

    const batch = adminDb.batch();
    batch.update(reservationRef, {
        status: reason,
        'confirmation.status': reason,
        'payment.status': reason,
        updatedAt: FieldValue.serverTimestamp()
    });

    for (const lock of locks.docs) {
        batch.delete(lock.ref);
    }

    await batch.commit();
}
