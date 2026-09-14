/*
 * GET /api/reservations/availability?date=YYYY-MM-DD&time=HH:MM&duration=N
 *
 * Given a requested date/time/duration, returns every active, non-maintenance
 * rig with an `available: boolean` flag for that specific slot. Used by the
 * frontend booking UI to grey out rigs that are already taken.
 *
 * Two independent things can make a rig unavailable for the requested
 * window:
 *   1. An admin "lockdown" (collection `availabilityLockdowns`) — a manually
 *      configured date/time range where booking is blocked, e.g. for
 *      maintenance or a private event. getActiveLockdowns() below loads
 *      lockdowns for the date, findOverlappingLockdown() checks if the
 *      requested window overlaps one of them; if so, the whole request is
 *      rejected with a 409 (no rigs are even considered available).
 *   2. An existing reservationLocks/<slotId> document for a rig+timeslot
 *      (see slotIds() in api/_lib/reservations.js) — this is what actually
 *      marks a specific rig as booked for that window.
 */

import {
    method,
    json,
    fail
} from '../_lib/http.js';

import {
    adminDb
} from '../_lib/firebase-admin.js';

import {
    getConfig,
    validateWhen,
    slotIds,
    bad
} from '../_lib/reservations.js';


/* =========================================================
   HELPERS
   ========================================================= */

function toMinutes(value) {

    if (!value) {
        return 0;
    }

    const [
        hours,
        minutes
    ] =
        String(value)
            .split(':')
            .map(Number);

    return (
        hours * 60 +
        minutes
    );
}


/* =========================================================
   CHECK AVAILABILITY LOCKDOWNS
   ========================================================= */

async function getActiveLockdowns(
    date
) {

    const snapshot =
        await adminDb
            .collection(
                'availabilityLockdowns'
            )
            .where(
                'date',
                '==',
                date
            )
            .get();


    return snapshot.docs
        .map(document => ({
            id:
                document.id,

            ...document.data()
        }))
        .filter(lockdown =>
            lockdown.active !== false
        );
}


function findOverlappingLockdown(
    lockdowns,
    reservationStart,
    reservationEnd
) {

    return lockdowns.find(
        lockdown => {

            const lockdownStart =
                toMinutes(
                    lockdown.start
                );

            const lockdownEnd =
                toMinutes(
                    lockdown.end
                );


            /*
             * OVERLAP:
             *
             * Reserva empieza antes de que
             * termine el lockdown
             *
             * Y
             *
             * Reserva termina después de que
             * empezó el lockdown.
             */

            return (
                reservationStart <
                    lockdownEnd
                &&
                reservationEnd >
                    lockdownStart
            );
        }
    );
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

export default async function handler(
    req,
    res
) {

    try {

        if (
            !method(
                req,
                res,
                ['GET']
            )
        ) {
            return;
        }


        const {
            date,
            time,
            duration
        } =
            req.query;


        /* =================================================
           CONFIG
           ================================================= */

        const config =
            await getConfig();


        /* =================================================
           VALIDATE DATE/TIME
           ================================================= */

        const {
            start,
            end
        } =
            validateWhen(
                date,
                time,
                Number(
                    duration
                ),
                config
            );


        /* =================================================
           ADMIN LOCKDOWNS
           ================================================= */

        const lockdowns =
            await getActiveLockdowns(
                date
            );


        const overlappingLockdown =
            findOverlappingLockdown(
                lockdowns,
                start,
                end
            );


        if (
            overlappingLockdown
        ) {

            console.log(
                '[AVAILABILITY LOCKDOWN]',
                {
                    date,
                    reservation:
                        `${time} / ${duration}h`,

                    lockdown:
                        `${overlappingLockdown.start} - ${overlappingLockdown.end}`,

                    reason:
                        overlappingLockdown.reason ||
                        null
                }
            );


            throw bad(
                overlappingLockdown.reason

                    ? `Horario no disponible: ${overlappingLockdown.reason}.`

                    : 'Este horario no está disponible temporalmente.',

                409
            );
        }


        /* =================================================
           ACTIVE RIGS
           ================================================= */

        const rigsSnapshot =
            await adminDb
                .collection(
                    'rigs'
                )
                .where(
                    'active',
                    '==',
                    true
                )
                .get();


        const rigs =
            rigsSnapshot.docs
                .map(document => ({
                    id:
                        document.id,

                    ...document.data()
                }))
                .filter(
                    rig =>
                        rig.maintenance !==
                        true
                );


        /* =================================================
           RESERVATION LOCKS
           ================================================= */

        const refs =
            rigs.flatMap(
                rig =>
                    slotIds(
                        date,
                        start,
                        end,
                        config.slotMinutes,
                        rig.id
                    )
                        .map(
                            id =>
                                adminDb.doc(
                                    `reservationLocks/${id}`
                                )
                        )
            );


        const docs =
            refs.length
                ? await adminDb.getAll(
                    ...refs
                )
                : [];


        const locked =
            new Set(
                docs
                    .filter(
                        snapshot =>
                            snapshot.exists
                    )
                    .map(
                        snapshot =>
                            snapshot.id
                                .split('_')
                                .at(-1)
                    )
            );


        /* =================================================
           RESPONSE
           ================================================= */

        return json(
            res,
            200,
            {
                rigs:
                    rigs.map(
                        rig => ({
                            ...rig,

                            available:
                                !locked.has(
                                    rig.id
                                )
                        })
                    )
            }
        );


    } catch (
        error
    ) {

        return fail(
            res,
            error
        );
    }
}