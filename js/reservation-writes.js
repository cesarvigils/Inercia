/*
 * Las dos escrituras de reservas del panel: crear una reserva manual y
 * guardar la edición de una existente.
 *
 * Reciben las funciones de Firestore por parámetro (`deps`) en vez de
 * importarlas: js/admin.js le pasa el SDK real, y los tests le pasan el
 * doble en memoria de tests/helpers/fake-firestore.mjs. Así la parte que
 * de verdad puede romper — revisar locks antes de escribir — se puede
 * probar sin un proyecto de Firebase.
 *
 * Toda escritura pasa por una transacción que revisa reservationLocks
 * primero, igual que api/reservations/create.js en el sitio público. Antes
 * las reservas manuales solo escribían el doc de `reservations`, sin
 * revisar ni dejar lock, y eso permitía reservar encima de un horario ya
 * tomado en silencio (el calendario del panel solo dibuja un punto por
 * celda).
 */
import {
    buildPricingFields,
    isLockSnapshotActive,
    lockExpiresAtDate,
    planManualReservation,
    planReservationEdit,
    slotTakenError
} from './reservation-logic.js';

export async function createManualReservation(deps, input) {
    const {
        db,
        doc,
        collection,
        runTransaction,
        serverTimestamp,
        timestampFromDate
    } = deps;

    const {
        date,
        time,
        duration,
        selectedRigs,
        customer,
        paymentMethod,
        status,
        code,
        uid,
        pricing
    } = input;

    const { lockIds, reservationRigs } = planManualReservation({
        date,
        time,
        duration,
        selectedRigs
    });

    const reservationRef = doc(collection(db, 'reservations'));

    const lockRefs = lockIds.map((id) => doc(db, 'reservationLocks', id));

    await runTransaction(db, async (transaction) => {
        const snapshots = await Promise.all(
            lockRefs.map((ref) => transaction.get(ref))
        );

        if (snapshots.some(isLockSnapshotActive)) {
            throw slotTakenError();
        }

        for (const lockRef of lockRefs) {
            transaction.set(lockRef, {
                reservationId: reservationRef.id,
                createdBy: uid,
                expiresAt: timestampFromDate(lockExpiresAtDate(date, time)),
                createdAt: serverTimestamp()
            });
        }

        transaction.set(reservationRef, {
            code,
            source: 'admin',

            // No existe usuario Firebase necesariamente porque es
            // reserva manual.
            uid: null,

            customer: {
                name: customer.name,
                email: customer.email || null,
                phone: customer.phone || null
            },

            date,
            time,
            duration,
            rigs: reservationRigs,

            pricing: buildPricingFields(pricing),

            payment: { method: paymentMethod },

            status,

            confirmation: {
                status,
                approvedAt: status === 'approved' ? serverTimestamp() : null,
                approvedBy: status === 'approved' ? uid : null
            },

            createdBy: uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        });
    });

    return { id: reservationRef.id, lockIds, reservationRigs };
}

export async function saveReservationEdit(deps, input) {
    const {
        db,
        doc,
        runTransaction,
        serverTimestamp,
        timestampFromDate
    } = deps;

    const {
        reservation,
        currentRigIds,
        date,
        time,
        duration,
        selectedRigs,
        paymentMethod,
        pricing,
        uid
    } = input;

    const { idsToRelease, idsToCheck, reservationRigs } = planReservationEdit({
        reservation,
        currentRigIds,
        date,
        time,
        duration,
        selectedRigs
    });

    await runTransaction(db, async (transaction) => {
        const checkRefs = idsToCheck.map(
            (id) => doc(db, 'reservationLocks', id)
        );

        const snapshots = await Promise.all(
            checkRefs.map((ref) => transaction.get(ref))
        );

        if (snapshots.some(isLockSnapshotActive)) {
            throw slotTakenError();
        }

        for (const id of idsToRelease) {
            transaction.delete(doc(db, 'reservationLocks', id));
        }

        for (const id of idsToCheck) {
            transaction.set(doc(db, 'reservationLocks', id), {
                reservationId: reservation.id,
                createdBy: uid,
                expiresAt: timestampFromDate(lockExpiresAtDate(date, time)),
                createdAt: serverTimestamp()
            });
        }

        transaction.update(doc(db, 'reservations', reservation.id), {
            date,
            time,
            duration,
            rigs: reservationRigs,
            pricing: buildPricingFields(pricing),
            payment: { method: paymentMethod },
            updatedAt: serverTimestamp()
        });
    });

    return { idsToRelease, idsToCheck, reservationRigs };
}
