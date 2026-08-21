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

        const decoded =
            await adminAuth
                .verifyIdToken(
                    token
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