/*
 * POST /api/reservations/create
 *
 * Creates a reservation paid by bank transfer ("transferencia"). This is
 * the non-PayPal counterpart to the flow in api/paypal/create-order.js +
 * api/_lib/paypal-reservation.js — it's a single endpoint rather than a
 * create/capture pair because there's no third-party payment step to wait
 * on; the customer instead uploads a transfer proof (image/PDF) directly
 * to Firebase Storage from the browser first, and this endpoint just
 * verifies that upload and records the reservation as awaiting manual
 * verification.
 *
 * Body: { date, time, duration, rigIds: string[], payment: 'transferencia',
 *         proofPath: string }
 *   proofPath must point at a file already uploaded under
 *   `reservation-proofs/<uid>/...` in Firebase Storage (checked below —
 *   see the PAYMENT PROOF section — for ownership, path traversal, size,
 *   and MIME type before trusting it).
 *
 * Like the PayPal flow, pricing is always recalculated server-side
 * (priceReservation()) and rig/time slots are locked inside a Firestore
 * transaction to prevent double-booking — never trust a price or
 * availability sent from the browser.
 *
 * Resulting reservation starts at status 'pending' with
 * paymentVerification.status 'pending', to be manually approved by an
 * admin after checking the uploaded proof.
 */

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
    'transferencia'
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
           AUTH
           ================================================= */

        const user =
            await requireUser(req);


        if (!user?.uid) {

            throw bad(
                'Tenés que iniciar sesión.',
                401
            );
        }


        const body =
            req.body || {};


        /* =================================================
           CONFIG + DATE/TIME
           ================================================= */

        const config =
            await getConfig();


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


        if (!METHODS.has(payment)) {

            throw bad(
                'Método de pago inválido.'
            );
        }


        /*
         * FLUJO DE PAGO
         * transferencia = comprobante + verificación manual
         * PayPal usa endpoints dedicados /api/paypal/*
         * WhatsApp se conectará después.
         */


        /* =================================================
           CUSTOMER PROFILE - FIRESTORE

           IMPORTANTE:

           Los datos del cliente NO vienen del navegador.

           El UID viene del Firebase ID Token y
           buscamos el perfil directamente en:

           Firestore:
           users/{uid}

           Esperamos:
           - name
           - email
           - phone
           - phoneNumber (fallback)
           ================================================= */

        let profile = {};


        try {

            const profileDoc =
                await adminDb
                    .doc(
                        `users/${user.uid}`
                    )
                    .get();


            if (profileDoc.exists) {

                profile =
                    profileDoc.data() || {};
            }


        } catch (error) {

            console.error(
                '[RESERVAS] Error leyendo perfil de Firestore:',
                error
            );


            throw bad(
                'No pudimos cargar los datos de tu cuenta.'
            );
        }


        /* =================================================
           CUSTOMER DATA

           Firestore es la fuente principal.

           Firebase Auth solamente sirve de fallback
           para nombre/email.

           Teléfono:
           1. profile.phone
           2. profile.phoneNumber
           ================================================= */

        const customer = {

            name:
                String(
                    profile.name ||
                    user.name ||
                    ''
                ).trim(),

            email:
                String(
                    profile.email ||
                    user.email ||
                    ''
                )
                    .trim()
                    .toLowerCase(),

            phoneNumber:
                String(
                    profile.phone ||
                    profile.phoneNumber ||
                    ''
                ).trim()
        };


        /*
         * Log seguro.
         *
         * No imprimimos teléfono/email completos.
         */

        console.log(
            '[RESERVAS] Perfil cargado desde Firestore:',
            {
                uid:
                    user.uid,

                documentExists:
                    Object.keys(profile).length > 0,

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


        /* =================================================
           VALIDATE CUSTOMER
           ================================================= */

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
                                data.name || ''
                            ).trim(),

                        type:
                            String(
                                data.type || ''
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
           VALIDATE RIGS
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
           SERVER-SIDE PRICE

           Nunca confiamos en el total enviado
           por el navegador.
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
           PAYMENT PROOF
           ================================================= */

        let proof =
            null;


        if (
            payment ===
            'transferencia'
        ) {

            const proofPath =
                String(
                    body.proofPath || ''
                ).trim();


            if (!proofPath) {

                throw bad(
                    'Subí el comprobante de transferencia.'
                );
            }


            /*
             * El archivo tiene que pertenecer
             * al usuario autenticado.
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
             * Evitamos traversal.
             */

            if (
                proofPath.includes('../') ||
                proofPath.includes('..\\')
            ) {

                throw bad(
                    'Comprobante inválido.'
                );
            }


            /* -------------------------------------------------
               STORAGE FILE
               ------------------------------------------------- */

            const file =
                adminStorage
                    .bucket()
                    .file(
                        proofPath
                    );


            const [exists] =
                await file.exists();


            if (!exists) {

                throw bad(
                    'No encontramos el comprobante subido.'
                );
            }


            /* -------------------------------------------------
               METADATA
               ------------------------------------------------- */

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


            /* -------------------------------------------------
               SIZE
               ------------------------------------------------- */

            if (
                !size ||
                size > MAX_PROOF_SIZE
            ) {

                throw bad(
                    'El comprobante no puede pesar más de 5 MB.'
                );
            }


            /* -------------------------------------------------
               MIME
               ------------------------------------------------- */

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
           RESERVATION REFERENCE
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

           Dentro de la transacción:
           1. comprobamos locks
           2. creamos locks
           3. creamos reserva

           Así evitamos dos reservas simultáneas
           sobre el mismo rig/horario.
           ================================================= */

        await adminDb.runTransaction(
            async (transaction) => {

                /* -------------------------------------------------
                   CHECK LOCKS
                   ------------------------------------------------- */

                const lockDocs =
                    lockRefs.length
                        ? await transaction.getAll(
                            ...lockRefs
                        )
                        : [];


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


                /* -------------------------------------------------
                   CREATE LOCKS
                   ------------------------------------------------- */

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


                /* -------------------------------------------------
                   CREATE RESERVATION
                   ------------------------------------------------- */

                transaction.create(
                    reservationRef,
                    {

                        /* =============================
                           IDENTIFICATION
                           ============================= */

                        code:
                            reservationCode,

                        uid:
                            user.uid,


                        /* =============================
                           CUSTOMER SNAPSHOT

                           Guardamos copia de los datos
                           usados al momento de reservar.
                           ============================= */

                        customer: {

                            name:
                                customer.name,

                            email:
                                customer.email,

                            phoneNumber:
                                customer.phoneNumber
                        },


                        /* =============================
                           DATE / TIME
                           ============================= */

                        date:
                            body.date,

                        time:
                            body.time,

                        duration:
                            Number(
                                body.duration
                            ),


                        /* =============================
                           RIGS
                           ============================= */

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


                        /* =============================
                           PAYMENT
                           ============================= */

                        payment,

                        paymentProof:
                            proof,

                        // Preparado para el flujo futuro de confirmación/WhatsApp.
                        paymentVerification: {
                            required: payment === 'transferencia',
                            status: payment === 'transferencia'
                                ? 'pending'
                                : 'not_required',
                            verifiedAt: null,
                            verifiedBy: null
                        },

                        confirmation: {
                            status: 'pending',
                            whatsapp: {
                                status: 'pending',
                                sentAt: null,
                                messageId: null
                            }
                        },


                        /* =============================
                           SERVER CALCULATED PRICE
                           ============================= */

                        pricing,


                        /* =============================
                           PROMOTIONS
                           ============================= */

                        promotionIds:
                            promotions.map(
                                (promotion) =>
                                    promotion.id
                            ),


                        /* =============================
                           STATUS
                           ============================= */

                        status:
                            'pending',


                        /* =============================
                           TIMESTAMPS
                           ============================= */

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

        console.log(
            '[RESERVAS] Reserva creada:',
            {
                id:
                    reservationRef.id,

                code:
                    reservationCode,

                uid:
                    user.uid,

                status:
                    'pending'
            }
        );


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

                payment,

                paymentVerification:
                    payment === 'transferencia'
                        ? 'pending'
                        : 'not_required',

                confirmationStatus:
                    'pending',

                whatsappStatus:
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