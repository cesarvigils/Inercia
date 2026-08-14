import { FieldValue } from 'firebase-admin/firestore';

import {
    method,
    json,
    fail,
    requireUser
} from '../_lib/http.js';

import {
    adminDb,
    adminStorage,
    adminRtdb
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
         * Todavía no habilitamos tarjeta/PayPal.
         */

        if (payment === 'tarjeta') {
            throw bad(
                'El pago con tarjeta todavía no está disponible.'
            );
        }


        /* =================================================
           CUSTOMER DATA

           NAME / EMAIL:
           Firestore + Firebase Auth fallback

           PHONE:
           Realtime Database:
           users/{uid}/phone
           ================================================= */


        /*
         * Firestore profile.
         */

        const profileDoc =
            await adminDb
                .doc(`users/${user.uid}`)
                .get();

        const profile =
            profileDoc.exists
                ? profileDoc.data() || {}
                : {};


        /*
         * Realtime Database phone.
         *
         * Exact path:
         *
         * users
         *   └── UID
         *       └── phone
         */

        let phone = '';

        try {

            const phoneSnapshot =
                await adminRtdb
                    .ref(
                        `users/${user.uid}/phone`
                    )
                    .get();

            if (phoneSnapshot.exists()) {
                phone =
                    String(
                        phoneSnapshot.val() ?? ''
                    ).trim();
            }

        } catch (error) {

            console.error(
                '[RESERVAS] Error leyendo teléfono de RTDB:',
                error
            );

            throw bad(
                'No pudimos cargar el teléfono de tu cuenta.'
            );
        }


        /*
         * Datos oficiales.
         *
         * NO usamos body.customer.
         */

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
                phone
        };


        console.log(
            '[RESERVAS] Datos de usuario cargados:',
            {
                uid:
                    user.uid,

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


            if (
                proofPath.includes('../') ||
                proofPath.includes('..\\')
            ) {
                throw bad(
                    'Comprobante inválido.'
                );
            }


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
           ================================================= */

        await adminDb.runTransaction(
            async (transaction) => {

                /*
                 * Primero verificamos todos
                 * los locks.
                 */

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


                /*
                 * Creamos locks.
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
                 * Creamos reserva.
                 */

                transaction.create(
                    reservationRef,
                    {

                        code:
                            reservationCode,

                        uid:
                            user.uid,


                        /* =============================
                           SNAPSHOT DEL CLIENTE
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
                           RESERVA
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


                        /* =============================
                           SERVER PRICE
                           ============================= */

                        pricing,


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