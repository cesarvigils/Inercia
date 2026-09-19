/*
 * lib/phone.js
 *
 * Shared, dependency-free phone number normalization used on both sides:
 * the browser (js/auth.js writes it, js/reservas.js reads it) and the
 * server (api/reservations/create.js, api/_lib/paypal-reservation.js),
 * plus the one-off backfill script (scripts/normalize-phones.mjs). One
 * function, imported everywhere, so a number is never stored or checked
 * two different ways.
 *
 * The business is Honduras-only (physical location, HNL pricing, BAC bank
 * transfer), so any number without an explicit different country code is
 * assumed to be a Honduran 8-digit mobile/landline. Customers type
 * numbers in all kinds of shapes - "99999999", "9999-9999", "9999 9999",
 * "504 9999 9999", "+504-9999-9999", "(504) 9999-9999" - normalizePhone()
 * folds all of those into one canonical display format:
 * "+504 9999-9999".
 *
 * Anything that isn't recognizably an 8-digit Honduras number (an
 * explicit "+" with a different country code, or just a wrong digit
 * count) is returned as "+<digits>" instead of being rejected outright -
 * treating an unrecognized shape as "no phone number" is exactly the bug
 * that made real customers' numbers look missing even though they had
 * typed one in.
 */

const HONDURAS_COUNTRY_CODE = '504';


export function normalizePhone(
    raw
) {

    if (!raw) {

        return '';
    }


    const trimmed =
        String(raw).trim();

    if (!trimmed) {

        return '';
    }


    const explicitCountryCode =
        trimmed.startsWith('+');

    const digits =
        trimmed.replace(
            /\D/g,
            ''
        );

    if (!digits) {

        return '';
    }


    let local =
        digits;

    if (
        digits.length === 11 &&
        digits.startsWith(
            HONDURAS_COUNTRY_CODE
        )
    ) {

        local =
            digits.slice(3);

    } else if (
        explicitCountryCode &&
        !digits.startsWith(
            HONDURAS_COUNTRY_CODE
        )
    ) {

        /*
         * Explicit non-Honduras country code (a foreign visitor's
         * number) - keep it as typed, just cleaned up to "+<digits>".
         */

        return `+${digits}`;
    }


    if (local.length !== 8) {

        /*
         * Not a standard 8-digit Honduras number and no recognizable
         * country code - return best effort instead of discarding it.
         */

        return `+${digits}`;
    }


    return (
        `+${HONDURAS_COUNTRY_CODE} ` +
        `${local.slice(0, 4)}-${local.slice(4)}`
    );
}
