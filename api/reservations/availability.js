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
    fail,
    rateLimit
} from '../_lib/http.js';

import {
    adminDb
} from '../_lib/firebase-admin.js';

import {
    getConfig,
    validateWhen,
    slotIds,
    bad,
    getActiveRigs,
    getActiveLockdowns,
    findOverlappingLockdown
} from '../_lib/reservations.js';

// getActiveLockdowns/findOverlappingLockdown used to be defined only in this
// file. They now live in ../_lib/reservations.js, shared with
// api/reservations/create.js and api/_lib/paypal-reservation.js, so a
// lockdown is enforced at booking-creation time too, not just here.


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


        if (
            !rateLimit(req, res, {
                limit: 60,
                windowMs: 60_000
            })
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

        const rigs =
            await getActiveRigs();


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