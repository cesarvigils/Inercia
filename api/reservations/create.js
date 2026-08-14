import { FieldValue } from 'firebase-admin/firestore';

import {
    method,
    json,
    fail,
    requireUser
} from '../_lib/http.js';

import {
    adminDb,
    adminStorage
} from '../_lib/firebase-admin.js';

import {
    getConfig,
    validateWhen,
    activePromotions,
    priceReservation,
    slotIds,
    code,
    expiresAt,
    bad
} from '../_lib/reservations.js';


/* =========================================================
   CONSTANTS
   ========================================================= */

const METHODS = new Set([
    'transferencia',
    'tarjeta'
]);

const MAX_RIGS = 10;

const MAX_PROOF_SIZE =
    5 * 1024 * 1024;

const ALLOWED_PROOF_TYPES =
    new Set([
        'image/jpeg',
        'image/png',
        'application/pdf'
    ]);


/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(req, res) {

    try {

        /* =================================================
           METHOD
           ================================================= */

        if (
            !method(
                req,
                res,
                ['POST']
            )
        ) {
            return;
        }


        /* =================================================
           AUTHENTICATION
           ================================================= */

        const user =
            await requireUser(req);

        if (!user?.uid) {
            throw bad(
                'Tenés que iniciar sesión.',
                401
            );
        }


        /* =================================================
           BODY
           ================================================= */

        const body =
            req.body || {};


        /* =================================================
           CONFIG
           ================================================= */

        const config =
            await getConfig();


        /* =================================================
           DATE / TIME / DURATION
           ================================================= */

        const when =
            validateWhen(
                body.date,
                body.time,
                body.duration,
                config
            );


        /* =================================================
           RIG IDS
           ================================================= */

        if (
            !Array.isArray(body.rigIds) ||
            body.rigIds.length === 0 ||
            body.rigIds.length > MAX_RIGS
        ) {

            throw bad(
                'Seleccioná al menos un simulador válido.'
            );
        }


        /*
         * Eliminamos IDs repetidos.
         */

        const uniqueRigIds =
            [
                ...new Set(
                    body.rigIds.map(
                        (id) =>
                            String(id).trim()
                    )
                )
            ].filter(Boolean);


        if (
            uniqueRigIds.length === 0 ||
            uniqueRigIds.length > MAX_RIGS
        ) {

            throw bad(
                'La selección de simuladores es inválida.'
            );
        }


        /* =================================================
           PAYMENT
           ================================================= */

        const payment =
            String(
                body.payment || ''
            ).trim();


        if (
            !METHODS.has(payment)
        ) {

            throw bad(
                'Método de pago inválido.'
            );
        }


        /*
         * Tarjeta / PayPal todavía NO está implementado.
         */

        if (
            payment === 'tarjeta'
        ) {

            throw bad(
                'El pago con tarjeta todavía no está disponible.',
                400
            );
        }


        /* =================================================
           CUSTOMER

           IMPORTANTE:

           NO usamos body.customer.

           El cliente puede modificar cualquier request
           desde DevTools.

           Los datos oficiales salen del usuario
           autenticado + Firestore.
           ================================================= */

        const profileRef =
            adminDb.doc(
                `users/${user.uid}`
            );

        const profileDoc =
            await profileRef.get();

        const profile =
            profileDoc.exists
                ? profileDoc.data()
                : {};


        const customer = {

            name:
                String(
                    profile?.name ||
                    user.name ||
                    ''
                ).trim(),

            email:
                String(
                    profile?.email ||
                    user.email ||
                    ''
                )
                    .trim()
                    .toLowerCase(),

            phoneNumber:
                String(
                    profile?.phoneNumber ||
                    ''
                ).trim()
        };


        /*
         * No permitimos crear una reserva
         * sin los datos necesarios.
         */

        if (!customer.name) {

            throw bad(
                'Tu cuenta no tiene un nombre registrado.'
            );
        }


        if (!customer.email) {

            throw bad(
                'Tu cuenta no tiene un correo registrado.'
            );
        }


        if (!customer.phoneNumber) {

            throw bad(
                'Tu cuenta no tiene un número de teléfono registrado.'
            );
        }


        /* =================================================
           LOAD RIGS FROM FIRESTORE

           Nunca confiamos en:
           - precio enviado por navegador
           - tipo enviado por navegador
           - nombre enviado por navegador
           - disponibilidad enviada por navegador
           ================================================= */

        const rigRefs =
            uniqueRigIds.map(
                (id) =>
                    adminDb.doc(
                        `rigs/${id}`
                    )
            );


        const rigDocs =
            await adminDb.getAll(
                ...rigRefs
            );


        /*
         * Todos tienen que existir.
         */

        if (
            rigDocs.some(
                (snapshot) =>
                    !snapshot.exists
            )
        ) {

            throw bad(
                'Uno de los simuladores seleccionados no existe.'
            );
        }


        /*
         * Construimos los rigs usando solamente
         * datos de Firestore.
         */

        const rigs =
            rigDocs.map(
                (snapshot) => {

                    const data =
                        snapshot.data() || {};

                    return {

                        id:
                            snapshot.id,

                        name:
                            String(
                                data.name ||
                                ''
                            ).trim(),

                        type:
                            String(
                                data.type ||
                                ''
                            )
                                .trim()
                                .toLowerCase(),

                        order:
                            Number(
                                data.order
                            ),

                        active:
                            data.active === true,

                        maintenance:
                            data.maintenance === true
                    };
                }
            );


        /* =================================================
           VALIDATE RIG STATE
           ================================================= */

        if (
            rigs.some(
                (rig) =>
                    !rig.active
            )
        ) {

            throw bad(
                'Uno de los simuladores seleccionados ya no está activo.'
            );
        }


        if (
            rigs.some(
                (rig) =>
                    rig.maintenance
            )
        ) {

            throw bad(
                'Uno de los simuladores seleccionados está en mantenimiento.'
            );
        }


        /*
         * Solo aceptamos tipos conocidos.
         */

        if (
            rigs.some(
                (rig) =>
                    ![
                        'standard',
                        'premium'
                    ].includes(
                        rig.type
                    )
            )
        ) {

            throw bad(
                'Uno de los simuladores tiene una configuración inválida.'
            );
        }


        /* =================================================
           PROMOTIONS
           ================================================= */

        const promotions =
            await activePromotions(
                body.date,
                rigs.map(
                    (rig) =>
                        rig.type
                )
            );


        /* =================================================
           PRICE

           EL SERVIDOR calcula todo.

           No existe body.total.
           No existe body.price.
           ================================================= */

        const pricing =
            priceReservation(
                rigs,
                Number(
                    body.duration
                ),
                config,
                promotions,
                when.lead
            );


        /* =================================================
           TRANSFER PROOF
           ================================================= */

        let proof =
            null;


        if (
            payment ===
            'transferencia'
        ) {

            const proofPath =
                String(
                    body.proofPath ||
                    ''
                ).trim();


            if (!proofPath) {

                throw bad(
                    'Subí el comprobante de transferencia.'
                );
            }


            /*
             * El comprobante DEBE pertenecer
             * al UID autenticado.
             */

            const expectedPrefix =
                `reservation-proofs/${user.uid}/`;


            if (
                !proofPath.startsWith(
                    expectedPrefix
                )
            ) {

                throw bad(
                    'Comprobante inválido.'
                );
            }


            /*
             * Evitamos paths sospechosos.
             */

            if (
                proofPath.includes('../') ||
                proofPath.includes('..\\')
            ) {

                throw bad(
                    'Comprobante inválido.'
                );
            }


            const bucket =
                adminStorage.bucket();


            const file =
                bucket.file(
                    proofPath
                );


            const [exists] =
                await file.exists();


            if (!exists) {

                throw bad(
                    'No encontramos el comprobante subido.'
                );
            }


            const [metadata] =
                await file.getMetadata();


            const size =
                Number(
                    metadata.size || 0
                );


            const contentType =
                String(
                    metadata.contentType ||
                    ''
                ).toLowerCase();


            if (
                !size ||
                size > MAX_PROOF_SIZE
            ) {

                throw bad(
                    'El comprobante no puede pesar más de 5 MB.'
                );
            }


            if (
                !ALLOWED_PROOF_TYPES.has(
                    contentType
                )
            ) {

                throw bad(
                    'El comprobante debe ser JPG, PNG o PDF.'
                );
            }


            proof = {

                path:
                    proofPath,

                contentType,

                size
            };
        }


        /* =================================================
           RESERVATION
           ================================================= */

        const reservationRef =
            adminDb
                .collection(
                    'reservations'
                )
                .doc();


        const reservationCode =
            code();


        /* =================================================
           LOCKS
           ================================================= */

        const lockRefs =
            rigs.flatMap(
                (rig) => {

                    const ids =
                        slotIds(
                            body.date,
                            when.start,
                            when.end,
                            config.slotMinutes,
                            rig.id
                        );

                    return ids.map(
                        (id) =>
                            adminDb.doc(
                                `reservationLocks/${id}`
                            )
                    );
                }
            );


        /* =================================================
           TRANSACTION

           Esta es la protección real contra dos personas
           intentando reservar el mismo rig al mismo tiempo.
           ================================================= */

        await adminDb.runTransaction(
            async (transaction) => {

                const lockDocs =
                    lockRefs.length
                        ? await transaction.getAll(
                            ...lockRefs
                        )
                        : [];


                /*
                 * Si existe UN solo lock,
                 * rechazamos la reserva completa.
                 */

                if (
                    lockDocs.some(
                        (snapshot) =>
                            snapshot.exists
                    )
                ) {

                    throw bad(
                        'Uno de esos simuladores acaba de ser reservado. Actualizá la disponibilidad.',
                        409
                    );
                }


                /*
                 * Creamos todos los locks.
                 */

                for (
                    const lockRef
                    of lockRefs
                ) {

                    transaction.create(
                        lockRef,
                        {
                            reservationId:
                                reservationRef.id,

                            uid:
                                user.uid,

                            /*
                             * Se mantiene bloqueado
                             * según la lógica configurada.
                             */
                            expiresAt:
                                expiresAt(
                                    body.date,
                                    body.time
                                ),

                            createdAt:
                                FieldValue.serverTimestamp()
                        }
                    );
                }


                /*
                 * Creamos la reserva.
                 *
                 * status SIEMPRE pending.
                 *
                 * El navegador no tiene forma de
                 * mandar status: approved.
                 */

                transaction.create(
                    reservationRef,
                    {

                        code:
                            reservationCode,

                        uid:
                            user.uid,

                        customer,

                        date:
                            body.date,

                        time:
                            body.time,

                        duration:
                            Number(
                                body.duration
                            ),


                        /*
                         * Snapshot de información del rig.
                         *
                         * Usamos order, NO number.
                         */

                        rigs:
                            rigs.map(
                                (rig) => ({

                                    id:
                                        rig.id,

                                    name:
                                        rig.name,

                                    type:
                                        rig.type,

                                    order:
                                        rig.order
                                })
                            ),


                        payment,

                        paymentProof:
                            proof,


                        /*
                         * Calculado exclusivamente
                         * por backend.
                         */

                        pricing,


                        promotionIds:
                            promotions.map(
                                (promotion) =>
                                    promotion.id
                            ),


                        /*
                         * Manual approval.
                         */

                        status:
                            'pending',


                        createdAt:
                            FieldValue.serverTimestamp(),

                        updatedAt:
                            FieldValue.serverTimestamp()
                    }
                );
            }
        );


        /* =================================================
           RESPONSE
           ================================================= */

        return json(
            res,
            201,
            {

                id:
                    reservationRef.id,

                code:
                    reservationCode,

                status:
                    'pending',

                pricing
            }
        );


    } catch (error) {

        console.error(
            '[CREATE RESERVATION]',
            error
        );

        return fail(
            res,
            error
        );
    }
}