/*
 * api/_lib/http.js
 *
 * Small shared HTTP helpers used by every serverless function under /api.
 * These are plain Node request/response helpers (not a framework) built
 * around Vercel's (req, res) function signature.
 *
 * Exports:
 *   - json(res, status, data)   Send a JSON response and end it. Safe to
 *                                call even if a response was already sent
 *                                (it just no-ops in that case).
 *   - method(req, res, allowed) Guard a handler to only accept certain
 *                                HTTP methods. Sends a 405 + Allow header
 *                                and returns false if the method doesn't
 *                                match, so callers can `if (!method(...)) return;`.
 *   - requireUser(req)          Verify the Firebase ID token from the
 *                                Authorization: Bearer <token> header and
 *                                return the decoded token (has .uid, .email,
 *                                etc). Throws a 401 error if missing/invalid.
 *   - fail(res, error)          Central error handler: logs the error server
 *                                side, then responds with a safe status/message
 *                                (4xx errors expose error.message to the client,
 *                                5xx errors are masked in production).
 *   - rateLimit(req, res, opts)  Best-effort per-key request throttle (see its
 *                                own comment below for how it works and its
 *                                limits). Returns false and already sent a 429
 *                                if the caller is over the limit, so handlers
 *                                do `if (!rateLimit(req, res, {...})) return;`
 *                                the same way they do for method().
 *
 * Typical usage in an /api handler:
 *   if (!method(req, res, ['GET', 'POST'])) return;
 *   try {
 *     const user = await requireUser(req);
 *     ...
 *     return json(res, 200, { ok: true });
 *   } catch (error) {
 *     return fail(res, error);
 *   }
 */

import { adminAuth } from './firebase-admin.js';


/* =========================================================
   JSON RESPONSE
   ========================================================= */

export function json(
    res,
    status,
    data
) {

    /*
     * Evita intentar responder dos veces.
     */
    if (res.headersSent) {
        return;
    }

    res.statusCode = status;

    res.setHeader(
        'Content-Type',
        'application/json; charset=utf-8'
    );

    /*
     * IMPORTANTE:
     * end() termina explícitamente la respuesta.
     *
     * Esto evita que el frontend quede esperando
     * después de que Firestore ya creó la reserva.
     */
    return res.end(
        JSON.stringify(data ?? {})
    );
}


/* =========================================================
   METHOD VALIDATION
   ========================================================= */

export function method(
    req,
    res,
    allowed = []
) {

    if (
        allowed.includes(
            req.method
        )
    ) {
        return true;
    }


    res.setHeader(
        'Allow',
        allowed.join(', ')
    );


    json(
        res,
        405,
        {
            error:
                'Método no permitido.'
        }
    );


    return false;
}


/* =========================================================
   REQUIRE FIREBASE USER
   ========================================================= */

export async function requireUser(
    req
) {

    const authorization =
        String(
            req.headers?.authorization ||
            ''
        ).trim();


    /* -----------------------------------------------------
       CHECK BEARER
       ----------------------------------------------------- */

    if (
        !authorization.startsWith(
            'Bearer '
        )
    ) {

        const error =
            new Error(
                'Tenés que iniciar sesión.'
            );

        error.status =
            401;

        throw error;
    }


    /* -----------------------------------------------------
       TOKEN
       ----------------------------------------------------- */

    const token =
        authorization
            .slice(7)
            .trim();


    if (!token) {

        const error =
            new Error(
                'Token de autenticación inválido.'
            );

        error.status =
            401;

        throw error;
    }


    /* -----------------------------------------------------
       VERIFY FIREBASE TOKEN
       ----------------------------------------------------- */

    try {

        // Second argument = checkRevoked: without it, a token that was valid
        // when issued keeps being accepted here for up to an hour after a
        // staff member disables the account or force-revokes its sessions.
        const decoded =
            await adminAuth
                .verifyIdToken(
                    token,
                    true
                );


        if (!decoded?.uid) {

            const error =
                new Error(
                    'Token de autenticación inválido.'
                );

            error.status =
                401;

            throw error;
        }


        return decoded;


    } catch (error) {

        console.error(
            '[AUTH] Error verificando token:',
            error?.code ||
            error?.message ||
            error
        );


        /*
         * Si nosotros mismos generamos
         * el error 401, lo conservamos.
         */

        if (
            error?.status ===
            401
        ) {
            throw error;
        }


        const authError =
            new Error(
                'Tu sesión expiró o no es válida. Iniciá sesión nuevamente.'
            );

        authError.status =
            401;

        throw authError;
    }
}


/* =========================================================
   ERROR RESPONSE
   ========================================================= */

export function fail(
    res,
    error
) {

    console.error(
        '[API ERROR]',
        error
    );


    /*
     * Si ya respondimos, no intentamos
     * enviar otra respuesta.
     */
    if (res.headersSent) {
        return;
    }


    /* -----------------------------------------------------
       STATUS
       ----------------------------------------------------- */

    let status =
        Number(
            error?.status ||
            error?.statusCode ||
            500
        );


    /*
     * Solo permitimos HTTP status válidos.
     */

    if (
        !Number.isInteger(status) ||
        status < 400 ||
        status > 599
    ) {

        status =
            500;
    }


    /* -----------------------------------------------------
       MESSAGE
       ----------------------------------------------------- */

    let message =
        'Error interno del servidor.';


    /*
     * Para errores controlados podemos
     * mostrar el mensaje real.
     */

    if (
        status >= 400 &&
        status < 500 &&
        error?.message
    ) {

        message =
            error.message;
    }


    /*
     * En desarrollo también podemos
     * devolver el mensaje del 500.
     *
     * En producción NO exponemos
     * detalles internos.
     */

    if (
        status >= 500 &&
        process.env.NODE_ENV !==
            'production' &&
        error?.message
    ) {

        message =
            error.message;
    }


    return json(
        res,
        status,
        {
            error:
                message
        }
    );
}


/* =========================================================
   RATE LIMITING
   ========================================================= */

/*
 * Best-effort, in-process request throttle. No external service, no
 * Firestore reads/writes — the whole point is to stop a scripted abuse loop
 * from generating real Firestore documents and live PayPal orders without
 * adding cost of its own.
 *
 * Honest limitations (worth knowing, not a reason to skip this): each
 * Vercel serverless instance has its own memory, so the effective limit is
 * "per warm instance", not truly global — a cold start resets it, and heavy
 * concurrent traffic can be spread across several instances. It's a
 * best-effort speed bump against a single scripted client, not a hard
 * guarantee. If usage ever grows enough for that gap to matter, move this
 * to a shared store (Vercel KV/Upstash) instead of layering more logic on
 * top of this one.
 */
const buckets = new Map();
let sweepCounter = 0;

function sweepExpiredBuckets(now) {
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
    }
}

function getClientIp(req) {
    const forwarded = req.headers?.['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket?.remoteAddress || 'unknown';
}

/*
 * opts.key      identifier to bucket by (defaults to the client IP) — pass
 *               a uid for endpoints that already require auth, since a
 *               shared office/venue IP shouldn't throttle every customer
 *               together.
 * opts.limit    max requests allowed per window.
 * opts.windowMs window length in ms.
 */
export function rateLimit(req, res, { key, limit, windowMs } = {}) {
    const id = `${key || getClientIp(req)}`;
    const now = Date.now();

    sweepCounter += 1;
    if (sweepCounter % 200 === 0) sweepExpiredBuckets(now);

    let bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(id, bucket);
    }

    bucket.count += 1;

    if (bucket.count > limit) {
        res.setHeader('Retry-After', Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
        json(res, 429, { error: 'Demasiadas solicitudes. Esperá un momento y volvé a intentar.' });
        return false;
    }

    return true;
}