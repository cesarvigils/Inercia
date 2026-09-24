/*
 * GET /api/reservations/calendar?duration=N
 *
 * Bootstrap endpoint for the booking page's step 1 (date + hour pickers).
 * Returns, for every date in the current booking window
 * (config.bookingWindowDays), whether that date is open at all and which
 * specific hourly start times still have at least one rig free for the
 * given duration.
 *
 * This replaces what the frontend used to do: build a plain 7-day date
 * dropdown with no notion of "is this day worth showing", then for
 * whichever date got picked, call /api/reservations/availability once per
 * candidate hour (up to ~11 separate requests) just to find out which hours
 * to list. That was slow, and each of those calls issued its own
 * reservationLocks lookup. Here the whole window is computed in one
 * request, reusing getLockedSlotIds() (one range query per date instead of
 * one per hour/rig) and the same cached getConfig()/getActiveRigs()/
 * getActiveLockdowns() as everything else in api/_lib/reservations.js.
 *
 * Response shape:
 *   {
 *     bookingWindowDays, slotMinutes, duration,
 *     days: [
 *       { date: "2026-06-16", weekday: 2, status: "available"|"full"|"closed",
 *         hours: [ { time: "10:00", available: true }, ... ] },
 *       ...
 *     ]
 *   }
 * `status` is a convenience summary for the calendar view: "closed" means
 * this weekday has no configured opening hours at all, "full" means it's
 * open but every candidate hour is taken (or, for today, already passed),
 * "available" means at least one hour is bookable.
 */

import { method, json, fail, rateLimit } from '../_lib/http.js';
import {
    getConfig,
    getActiveRigs,
    getActiveLockdowns,
    findOverlappingLockdown,
    getLockedSlotIds,
    slotIds,
    hm,
    minutesToTime,
    dateDay,
    addDays,
    localParts
} from '../_lib/reservations.js';

export default async function handler(req, res) {
    try {
        if (!method(req, res, ['GET'])) return;
        if (!rateLimit(req, res, { limit: 30, windowMs: 60_000 })) return;

        const config = await getConfig();
        const duration = Math.min(
            config.maxDurationHours,
            Math.max(config.minDurationHours, Number(req.query.duration) || config.minDurationHours)
        );

        const rigs = await getActiveRigs();
        const now = localParts();

        const days = await Promise.all(
            Array.from({ length: config.bookingWindowDays }, (_value, offset) => offset).map(async (offset) => {
                const date = addDays(now.date, offset);
                const weekday = dateDay(date);
                const hoursConfig = config.hours[weekday];

                if (!hoursConfig) {
                    return { date, weekday, status: 'closed', hours: [] };
                }

                const [lockdowns, lockedSlotIds] = await Promise.all([
                    getActiveLockdowns(date),
                    getLockedSlotIds(date)
                ]);

                const open = hm(hoursConfig[0]);
                const close = hm(hoursConfig[1]);
                const hours = [];

                for (let start = open; start + duration * 60 <= close; start += 60) {
                    const end = start + duration * 60;

                    // Only "today" needs the lead-time filter — every later
                    // date in the window is, by definition, already at
                    // least a full day out.
                    if (offset === 0 && start - now.minutes < config.minLeadMinutes) continue;

                    const blocked = findOverlappingLockdown(lockdowns, start, end);
                    const available = !blocked && rigs.some((rig) => {
                        const ids = slotIds(date, start, end, config.slotMinutes, rig.id);
                        return ids.every((id) => !lockedSlotIds.has(id));
                    });

                    hours.push({ time: minutesToTime(start), available });
                }

                const status = hours.some((hour) => hour.available) ? 'available' : 'full';
                return { date, weekday, status, hours };
            })
        );

        // Shared CDN cache, same 15s freshness as getLockedSlotIds(). The
        // in-memory cache in api/_lib/reservations.js dies with each cold
        // Vercel instance, so without this nearly every page load re-ran
        // the ~16 Firestore queries above. A slot taken in the last few
        // seconds may still show as open; create.js re-checks it anyway.
        res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
        return json(res, 200, {
            bookingWindowDays: config.bookingWindowDays,
            slotMinutes: config.slotMinutes,
            duration,
            days
        });
    } catch (error) {
        return fail(res, error);
    }
}
