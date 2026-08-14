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

const MAX_PROOF_SIZE = 5 * 1024 * 1024;

const ALLOWED_PROOF_TYPES = new Set([
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

        if (!method(req, res, ['POST'])) {
            return;
        }


        /* =================================================
           AUTH
           ================================================= */

        const user = await requireUser(req);

        if (!user?.uid) {
            throw bad(
                'Tenés que iniciar sesión.',
                401
            );
        }

        const body = req.body || {};


        /* =================================================
           CONFIG + DATE/TIME
           ================================================= */

        console.log(
            '[RESERVAS] Cargando configuración...'
        );

        const config = await getConfig();

        const when = validateWhen(
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

        const uniqueRigIds = [
            ...new Set(
                body.rigIds.map(
                    id => String(id).trim()
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

        const payment = String(
            body.payment || ''
        ).trim();

        if (!METHODS.has(payment)) {
            throw bad(
                'Método de pago inválido.'
            );
        }

        /*
         * FLUJO:
         *
         * transferencia
         * --------------
         * Requiere comprobante.
         * paymentVerification queda pending.
         *
         * tarjeta
         * -------
         * NO requiere comprobante de transferencia.
         * paymentVerification queda not_required.
         *
         * La integración real del cobro con tarjeta
         * se puede conectar posteriormente.
         *
         * WhatsApp todavía NO se envía aquí.
         */


        /* =================================================
           CUSTOMER PROFILE
           ================================================= */

        let profile = {};

        try {

            const profileDoc = await adminDb
                .doc(`users/${user.uid}`)
                .get();

            if (profileDoc.exists) {
                profile = profileDoc.data() || {};
            }

        } catch (error) {

            console.error(
                '[RESERVAS] Error leyendo perfil:',
                error
            );

            throw bad(
                'No pudimos cargar los datos de tu cuenta.'
            );
        }


        /* =================================================
           CUSTOMER DATA

           NO confiamos en datos enviados desde DevTools.

           Nombre/teléfono/email salen de:
           Firestore users/{uid}

           Auth sirve de fallback para nombre/email.
           ================================================= */

        const customer = {

            name: String(
                profile.name ||
                user.name ||
                ''
            ).trim(),

            email: String(
                profile.email ||
                user.email ||
                ''
            )
                .trim()
                .toLowerCase(),

            phoneNumber: String(
                profile.phone ||
                profile.phoneNumber ||
                ''
            ).trim()
        };


        console.log(
            '[RESERVAS] Perfil:',
            {
                uid: user.uid,

                name:
                    customer.name
                        ? 'OK'
                        : 'FALTANTE',

                email:
                    customer.email
                        ? 'OK'
                        : 'FALTANTE',

                phone:
                    customer.phoneNumber
                        ? 'OK'
                        : 'FALTANTE'
            }
        );


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
           LOAD RIGS
           ================================================= */

        const rigRefs = uniqueRigIds.map(
            id =>
                adminDb.doc(
                    `rigs/${id}`
                )
        );

        const rigDocs = await adminDb.getAll(
            ...rigRefs
        );

        if (
            rigDocs.some(
                snapshot => !snapshot.exists
            )
        ) {
            throw bad(
                'Uno de los simuladores seleccionados no existe.'
            );
        }


        const rigs = rigDocs.map(
            snapshot => {

                const data =
                    snapshot.data() || {};

                return {
                    id: snapshot.id,

                    name: String(
                        data.name || ''
                    ).trim(),

                    type: String(
                        data.type || ''
                    )
                        .trim()
                        .toLowerCase(),

                    order: Number(
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
           VALIDATE RIGS
           ================================================= */

        if (
            rigs.some(
                rig => !rig.active
            )
        ) {
            throw bad(
                'Uno de los simuladores seleccionados ya no está activo.'
            );
        }

        if (
            rigs.some(
                rig => rig.maintenance
            )
        ) {
            throw bad(
                'Uno de los simuladores seleccionados está en mantenimiento.'
            );
        }

        if (
            rigs.some(
                rig =>
                    ![
                        'standard',
                        'premium'
                    ].includes(rig.type)
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
                    rig => rig.type
                )
            );


        /* =================================================
           SERVER-SIDE PRICE

           El frontend NO decide el precio.
           ================================================= */

        const pricing =
            priceReservation(
                rigs,
                Number(body.duration),
                config,
                promotions,
                when.lead
            );


        console.log(
            '[RESERVAS] Precio calculado:',
            pricing
        );


        /* =================================================
           PAYMENT PROOF
           ================================================= */

        let proof = null;


        /* -------------------------------------------------
           TRANSFERENCIA
           ------------------------------------------------- */

        if (payment === 'transferencia') {

            const proofPath = String(
                body.proofPath || ''
            ).trim();


            if (!proofPath) {
                throw bad(
                    'Subí el comprobante de transferencia.'
                );
            }


            /* =============================================
               CHECK OWNER
               ============================================= */

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


            /* =============================================
               PATH TRAVERSAL
               ============================================= */

            if (
                proofPath.includes('../') ||
                proofPath.includes('..\\')
            ) {
                throw bad(
                    'Comprobante inválido.'
                );
            }


            /* =============================================
               STORAGE
               ============================================= */

            console.log(
                '[RESERVAS] Verificando comprobante...'
            );

            const file =
                adminStorage
                    .bucket()
                    .file(proofPath);

            const [exists] =
                await file.exists();

            if (!exists) {
                throw bad(
                    'No encontramos el comprobante subido.'
                );
            }


            /* =============================================
               METADATA
               ============================================= */

            const [metadata] =
                await file.getMetadata();

            const size =
                Number(
                    metadata.size || 0
                );

            const contentType =
                String(
                    metadata.contentType || ''
                ).toLowerCase();


            /* =============================================
               SIZE
               ============================================= */

            if (
                !size ||
                size > MAX_PROOF_SIZE
            ) {
                throw bad(
                    'El comprobante no puede pesar más de 5 MB.'
                );
            }


            /* =============================================
               MIME
               ============================================= */

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
                path: proofPath,
                contentType,
                size
            };

            console.log(
                '[RESERVAS] Comprobante válido.'
            );
        }


        /* =================================================
           PAYMENT VERIFICATION STATE
           ================================================= */

        const paymentVerification =
            payment === 'transferencia'
                ? {
                    required: true,
                    status: 'pending',
                    verifiedAt: null,
                    verifiedBy: null
                }
                : {
                    required: false,
                    status: 'not_required',
                    verifiedAt: null,
                    verifiedBy: null
                };


        /* =================================================
           FUTURE CONFIRMATION / WHATSAPP

           NO manda WhatsApp todavía.

           Dejamos la estructura para posteriormente hacer:

           confirmation.whatsapp.status = sent
           confirmation.whatsapp.sentAt = Timestamp
           confirmation.whatsapp.messageId = ...
           ================================================= */

        const confirmation = {

            status: 'pending',

            whatsapp: {
                status: 'pending',
                sentAt: null,
                messageId: null
            }
        };


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
                rig => {

                    const ids =
                        slotIds(
                            body.date,
                            when.start,
                            when.end,
                            config.slotMinutes,
                            rig.id
                        );

                    return ids.map(
                        id =>
                            adminDb.doc(
                                `reservationLocks/${id}`
                            )
                    );
                }
            );


        console.log(
            '[RESERVAS] Locks necesarios:',
            lockRefs.length
        );


        /* =================================================
           TRANSACTION

           IMPORTANTE:
           Locks + reserva se crean juntos.

           Si falla cualquier parte, Firestore no crea
           ninguno de los dos.
           ================================================= */

        await adminDb.runTransaction(
            async transaction => {

                /* =========================================
                   CHECK LOCKS
                   ========================================= */

                const lockDocs =
                    lockRefs.length
                        ? await transaction.getAll(
                            ...lockRefs
                        )
                        : [];


                if (
                    lockDocs.some(
                        snapshot =>
                            snapshot.exists
                    )
                ) {
                    throw bad(
                        'Uno de esos simuladores acaba de ser reservado. Actualizá la disponibilidad.',
                        409
                    );
                }


                /* =========================================
                   CREATE LOCKS
                   ========================================= */

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


                /* =========================================
                   CREATE RESERVATION
                   ========================================= */

                transaction.create(
                    reservationRef,
                    {

                        /* ---------------------------------
                           IDENTIFICATION
                           --------------------------------- */

                        code:
                            reservationCode,

                        uid:
                            user.uid,


                        /* ---------------------------------
                           CUSTOMER
                           --------------------------------- */

                        customer: {
                            name:
                                customer.name,

                            email:
                                customer.email,

                            phoneNumber:
                                customer.phoneNumber
                        },


                        /* ---------------------------------
                           DATE / TIME
                           --------------------------------- */

                        date:
                            body.date,

                        time:
                            body.time,

                        duration:
                            Number(
                                body.duration
                            ),


                        /* ---------------------------------
                           RIGS
                           --------------------------------- */

                        rigs:
                            rigs.map(
                                rig => ({
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


                        /* ---------------------------------
                           PAYMENT
                           --------------------------------- */

                        payment,

                        paymentProof:
                            proof,

                        paymentVerification,


                        /* ---------------------------------
                           CONFIRMATION / WHATSAPP
                           --------------------------------- */

                        confirmation,


                        /* ---------------------------------
                           PRICING
                           --------------------------------- */

                        pricing,


                        /* ---------------------------------
                           PROMOTIONS
                           --------------------------------- */

                        promotionIds:
                            promotions.map(
                                promotion =>
                                    promotion.id
                            ),


                        /* ---------------------------------
                           STATUS
                           --------------------------------- */

                        status:
                            'pending',


                        /* ---------------------------------
                           TIMESTAMPS
                           --------------------------------- */

                        createdAt:
                            FieldValue.serverTimestamp(),

                        updatedAt:
                            FieldValue.serverTimestamp()
                    }
                );
            }
        );


        /* =================================================
           TRANSACTION COMPLETED
           ================================================= */

        console.log(
            '[RESERVAS] Reserva creada:',
            {
                id:
                    reservationRef.id,

                code:
                    reservationCode,

                uid:
                    user.uid,

                payment,

                paymentVerification:
                    paymentVerification.status,

                status:
                    'pending'
            }
        );


        /* =================================================
           RESPONSE

           El frontend espera esta respuesta ANTES
           de mostrar el alert de éxito.
           ================================================= */

        return json(
            res,
            201,
            {
                success: true,

                id:
                    reservationRef.id,

                code:
                    reservationCode,

                status:
                    'pending',

                payment,

                paymentVerification:
                    paymentVerification.status,

                confirmationStatus:
                    confirmation.status,

                whatsappStatus:
                    confirmation.whatsapp.status,

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