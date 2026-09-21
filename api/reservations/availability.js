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
    findOverlappingLockdown,
    isLockActive
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

           Each rig keeps its own slot-doc refs (rather than a single
           flattened list re-parsed back into a rig id from the doc id
           string afterward) so this holds up even if a rig id ever
           contains an underscore itself — slotIds()'s doc ids are
           `${date}_${HHMM}_${rigId}`, and splitting that back apart on
           '_' would silently mis-associate such a rig's lock with the
           wrong id, making it look permanently available.

           isLockActive(), not a bare `snapshot.exists`, so a lock left
           behind by an abandoned checkout (see isLockActive's own
           comment in ../_lib/reservations.js) stops blocking once it
           expires here too, same as calendar.js and create.js already
           do — this endpoint was the one path still checking existence
           alone.
           ================================================= */

        const rigSlotRefs =
            rigs.map(
                rig => ({
                    rig,
                    refs:
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
                })
            );


        const allRefs =
            rigSlotRefs.flatMap(
                entry =>
                    entry.refs
            );


        const allDocs =
            allRefs.length
                ? await adminDb.getAll(
                    ...allRefs
                )
                : [];


        let cursor = 0;

        const availabilityByRigId =
            new Map(
                rigSlotRefs.map(
                    ({ rig, refs }) => {

                        const docs =
                            allDocs.slice(
                                cursor,
                                cursor + refs.length
                            );

                        cursor +=
                            refs.length;

                        return [
                            rig.id,
                            !docs.some(
                                isLockActive
                            )
                        ];
                    }
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
                                availabilityByRigId.get(
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