import { auth, db } from '../firebase-config.js';

import {
    doc,
    getDoc
} from 'firebase/firestore';

import {
    getStorage,
    ref,
    uploadBytes
} from 'firebase/storage';

import {
    onAuthStateChanged
} from 'firebase/auth';


/* =========================================================
   FIREBASE STORAGE
   ========================================================= */

const storage = getStorage(auth.app);


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id =>
    document.getElementById(id);


/* =========================================================
   ELEMENTS
   ========================================================= */

const form =
    $('reservationForm');

const date =
    $('reservationDate');

const time =
    $('reservationTime');

const duration =
    $('reservationDuration');


const grids = {
    standard:
        $('standardGrid'),

    premium:
        $('premiumGrid')
};


const counts = {
    standard:
        $('standardCount'),

    premium:
        $('premiumCount')
};


/* =========================================================
   STATE
   ========================================================= */

const selected =
    new Map();

let appConfig =
    null;

let rigs =
    [];

let currentUser =
    null;

let promos =
    [];


/* =========================================================
   ASSETS
   ========================================================= */

const wheel =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';


/* =========================================================
   MONEY
   ========================================================= */

function money(value) {

    return `L ${Number(
        value || 0
    ).toLocaleString(
        'es-HN',
        {
            maximumFractionDigits: 2
        }
    )}`;
}


/* =========================================================
   API
   ========================================================= */

async function api(
    path,
    options = {}
) {

    const headers = {
        ...(options.headers || {})
    };


    /* -----------------------------------------------------
       AUTH TOKEN
       ----------------------------------------------------- */

    if (currentUser) {

        const token =
            await currentUser
                .getIdToken();

        headers.Authorization =
            `Bearer ${token}`;
    }


    /* -----------------------------------------------------
       JSON
       ----------------------------------------------------- */

    if (
        options.body &&
        !(options.body instanceof FormData)
    ) {

        headers['Content-Type'] =
            'application/json';
    }


    /* -----------------------------------------------------
       REQUEST
       ----------------------------------------------------- */

    const response =
        await fetch(
            path,
            {
                ...options,
                headers
            }
        );


    let data = {};

    try {

        data =
            await response.json();

    } catch {

        data = {};
    }


    /* -----------------------------------------------------
       ERROR
       ----------------------------------------------------- */

    if (!response.ok) {

        console.error(
            '[RESERVAS API]',
            response.status,
            path,
            data
        );

        throw new Error(
            data.error ||
            `Error del servidor (${response.status}).`
        );
    }


    return data;
}


/* =========================================================
   DATES
   ========================================================= */

function dates() {

    if (!date) {
        return;
    }


    date.innerHTML = '';


    const labelFormatter =
        new Intl.DateTimeFormat(
            'es-HN',
            {
                weekday:
                    'short',

                day:
                    'numeric',

                month:
                    'short',

                timeZone:
                    'America/Tegucigalpa'
            }
        );


    const valueFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                year:
                    'numeric',

                month:
                    '2-digit',

                day:
                    '2-digit',

                timeZone:
                    'America/Tegucigalpa'
            }
        );


    /* -----------------------------------------------------
       SOLO 7 DÍAS
       ----------------------------------------------------- */

    for (
        let i = 0;
        i < 7;
        i++
    ) {

        const currentDate =
            new Date(
                Date.now() +
                i * 86400000
            );


        const value =
            valueFormatter.format(
                currentDate
            );


        let prefix = '';

        if (i === 0) {
            prefix =
                'HOY · ';
        }

        if (i === 1) {
            prefix =
                'MAÑANA · ';
        }


        const label =
            (
                prefix +
                labelFormatter.format(
                    currentDate
                )
            ).toUpperCase();


        date.add(
            new Option(
                label,
                value
            )
        );
    }
}


/* =========================================================
   TIMES
   ========================================================= */

function makeTimes() {

    if (!time) {
        return;
    }


    time.innerHTML =
        '<option value="">Seleccioná una hora</option>';


    if (
        !date?.value ||
        !appConfig
    ) {
        return;
    }


    /*
     * Usamos mediodía UTC para evitar
     * cambios de fecha por timezone.
     */

    const selectedDate =
        new Date(
            `${date.value}T12:00:00Z`
        );


    const day =
        selectedDate.getUTCDay();


    const hours =
        appConfig.hours?.[day];


    /*
     * Día cerrado.
     */

    if (!hours) {
        return;
    }


    const toMinutes =
        value => {

            const [
                hour,
                minute
            ] =
                value
                    .split(':')
                    .map(Number);


            return (
                hour * 60 +
                minute
            );
        };


    const start =
        toMinutes(
            hours[0]
        );

    const end =
        toMinutes(
            hours[1]
        );


    /*
     * Las reservas son en horas exactas.
     */

    for (
        let minutes = start;
        minutes < end;
        minutes += 60
    ) {

        const hour =
            Math.floor(
                minutes / 60
            );

        const minute =
            minutes % 60;


        const value =
            `${String(hour).padStart(
                2,
                '0'
            )}:${String(minute).padStart(
                2,
                '0'
            )}`;


        const label =
            new Intl.DateTimeFormat(
                'en-US',
                {
                    hour:
                        'numeric',

                    minute:
                        '2-digit'
                }
            ).format(
                new Date(
                    2000,
                    0,
                    1,
                    hour,
                    minute
                )
            );


        time.add(
            new Option(
                label,
                value
            )
        );
    }
}


/* =========================================================
   DURATIONS
   ========================================================= */

function makeDurations() {

    if (
        !duration ||
        !appConfig
    ) {
        return;
    }


    duration.innerHTML =
        '';


    const min =
        Number(
            appConfig.minDurationHours ||
            1
        );

    const max =
        Number(
            appConfig.maxDurationHours ||
            8
        );


    for (
        let i = min;
        i <= max;
        i++
    ) {

        duration.add(
            new Option(
                `${i} ${
                    i === 1
                        ? 'hora'
                        : 'horas'
                }`,
                i
            )
        );
    }
}


/* =========================================================
   LOAD CONFIG
   ========================================================= */

async function loadConfig() {

    console.log(
        '[RESERVAS] Cargando configuración...'
    );


    const query =
        date?.value
            ? `?date=${encodeURIComponent(
                date.value
            )}`
            : '';


    const data =
        await api(
            `/api/reservations/config${query}`
        );


    appConfig =
        data.config;

    rigs =
        Array.isArray(data.rigs)
            ? data.rigs
            : [];

    promos =
        Array.isArray(
            data.promotions
        )
            ? data.promotions
            : [];


    console.log(
        '[RESERVAS] Configuración cargada:',
        {
            rigs:
                rigs.length,

            promotions:
                promos.length,

            config:
                appConfig
        }
    );


    makeDurations();

    updatePrices();


    render(
        rigs.map(
            rig => ({
                ...rig,
                available: true
            })
        )
    );
}


/* =========================================================
   UPDATE PRICES
   ========================================================= */

function updatePrices() {

    const standard =
        document.querySelector(
            '[data-price="standard"]'
        );

    const premium =
        document.querySelector(
            '[data-price="premium"]'
        );


    if (standard) {

        standard.textContent =
            `${money(
                appConfig?.prices?.standard
            )} / HORA`;
    }


    if (premium) {

        premium.textContent =
            `${money(
                appConfig?.prices?.premium
            )} / HORA`;
    }
}


/* =========================================================
   RIG CARD
   ========================================================= */

function card(rig) {

    const button =
        document.createElement(
            'button'
        );


    button.type =
        'button';

    button.className =
        'simulator-card';

    button.disabled =
        !rig.available;

    button.dataset.id =
        rig.id;


    const number =
        rig.order ??
        rig.number ??
        '';


    button.innerHTML = `
        <span class="simulator-check">
            ✓
        </span>

        <img
            class="simulator-wheel"
            src="${wheel}"
            alt=""
        >

        <span class="simulator-card-info">

            <small>
                ${String(
                    rig.type || ''
                ).toUpperCase()}
            </small>

            <strong>
                SIMULADOR ${number}
            </strong>

        </span>
    `;


    if (
        selected.has(rig.id) &&
        rig.available
    ) {

        button.classList.add(
            'selected'
        );
    }


    button.addEventListener(
        'click',
        () => {

            if (!rig.available) {
                return;
            }


            if (
                selected.has(
                    rig.id
                )
            ) {

                selected.delete(
                    rig.id
                );

            } else {

                selected.set(
                    rig.id,
                    rig
                );
            }


            button.classList.toggle(
                'selected',
                selected.has(
                    rig.id
                )
            );


            summary();
        }
    );


    return button;
}


/* =========================================================
   RENDER RIGS
   ========================================================= */

function render(list) {

    for (
        const type
        of [
            'standard',
            'premium'
        ]
    ) {

        const grid =
            grids[type];

        if (!grid) {
            continue;
        }


        grid.innerHTML =
            '';


        const typeRigs =
            list.filter(
                rig =>
                    rig.type === type
            );


        typeRigs.forEach(
            rig =>
                grid.append(
                    card(rig)
                )
        );


        const available =
            typeRigs.filter(
                rig =>
                    rig.available
            ).length;


        if (counts[type]) {

            counts[type].textContent =
                `${available} DISPONIBLES`;
        }
    }


    const availableCount =
        $('availableCount');


    if (availableCount) {

        availableCount.textContent =
            list.filter(
                rig =>
                    rig.available
            ).length;
    }


    summary();
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

async function availability() {

    selected.clear();


    if (
        !date?.value ||
        !time?.value ||
        !duration?.value
    ) {

        render(
            rigs.map(
                rig => ({
                    ...rig,
                    available: true
                })
            )
        );

        return;
    }


    const params =
        new URLSearchParams({
            date:
                date.value,

            time:
                time.value,

            duration:
                duration.value
        });


    console.log(
        '[RESERVAS] Consultando disponibilidad:',
        params.toString()
    );


    try {

        const data =
            await api(
                `/api/reservations/availability?${params.toString()}`
            );


        render(
            Array.isArray(
                data.rigs
            )
                ? data.rigs
                : []
        );


    } catch (error) {

        console.error(
            '[RESERVAS] Error consultando disponibilidad:',
            error
        );


        message(
            error.message,
            'error'
        );


        /*
         * Si no podemos comprobar disponibilidad,
         * NO dejamos seleccionar rigs.
         */

        render(
            rigs.map(
                rig => ({
                    ...rig,
                    available: false
                })
            )
        );
    }
}


/* =========================================================
   LOCAL PRICE PREVIEW

   Esto es únicamente visual.

   El backend vuelve a calcular TODO.
   ========================================================= */

function localPrice() {

    const hours =
        Number(
            duration?.value ||
            1
        );


    let base =
        0;


    for (
        const rig
        of selected.values()
    ) {

        base +=
            (
                Number(
                    appConfig
                        ?.prices
                        ?.[rig.type]
                ) ||
                0
            ) *
            hours;
    }


    let discount =
        0;


    for (
        const promo
        of promos
    ) {

        if (
            promo.type ===
            'percent'
        ) {

            discount +=
                base *
                (
                    Number(
                        promo.value ||
                        0
                    ) /
                    100
                );

        } else if (
            promo.type ===
            'fixed'
        ) {

            discount +=
                Number(
                    promo.value ||
                    0
                );
        }
    }


    return Math.max(
        0,
        base -
        Math.min(
            base,
            discount
        )
    );
}


/* =========================================================
   SUMMARY
   ========================================================= */

function summary() {

    const standardCount =
        [
            ...selected.values()
        ].filter(
            rig =>
                rig.type ===
                'standard'
        ).length;


    const premiumCount =
        [
            ...selected.values()
        ].filter(
            rig =>
                rig.type ===
                'premium'
        ).length;


    const summaryStandard =
        $('summaryStandard');

    const summaryPremium =
        $('summaryPremium');

    const summaryDuration =
        $('summaryDuration');

    const reservationTotal =
        $('reservationTotal');

    const submit =
        $('reservationSubmit');


    if (summaryStandard) {

        summaryStandard.textContent =
            standardCount;
    }


    if (summaryPremium) {

        summaryPremium.textContent =
            premiumCount;
    }


    if (summaryDuration) {

        const value =
            Number(
                duration?.value ||
                1
            );


        summaryDuration.textContent =
            `${value} ${
                value === 1
                    ? 'hora'
                    : 'horas'
            }`;
    }


    if (reservationTotal) {

        reservationTotal.textContent =
            money(
                localPrice()
            );
    }


    if (submit) {

        submit.disabled =
            !(
                currentUser &&
                date?.value &&
                time?.value &&
                duration?.value &&
                selected.size > 0
            );
    }
}


/* =========================================================
   MESSAGE
   ========================================================= */

function message(
    text,
    type = 'info'
) {

    const element =
        $('reservationMessage');


    if (!element) {
        return;
    }


    element.textContent =
        text || '';

    element.dataset.type =
        type;

    element.hidden =
        !text;
}


/* =========================================================
   PROFILE
   ========================================================= */

async function profile(user) {

    try {

        const snapshot =
            await getDoc(
                doc(
                    db,
                    'users',
                    user.uid
                )
            );


        const data =
            snapshot.exists()
                ? snapshot.data()
                : {};


        /*
         * Estos elementos son opcionales.
         *
         * Si existen en HTML, los rellenamos.
         * Si no existen, no explota reservas.js.
         */

        const name =
            $('reservationName');

        const email =
            $('reservationEmail');

        const phone =
            $('reservationPhone');


        if (name) {

            name.value =
                data.name ||
                user.displayName ||
                '';
        }


        if (email) {

            email.value =
                data.email ||
                user.email ||
                '';
        }


        if (phone) {

            phone.value =
                data.phone ||
                data.phoneNumber ||
                '';
        }


        console.log(
            '[RESERVAS] Perfil cargado:',
            {
                name:
                    data.name ||
                    user.displayName ||
                    'NO DISPONIBLE',

                email:
                    data.email ||
                    user.email ||
                    'NO DISPONIBLE',

                phoneNumber:
                    data.phone ||
                    data.phoneNumber
                        ? 'OK'
                        : 'NO DISPONIBLE'
            }
        );


    } catch (error) {

        console.error(
            '[RESERVAS] Error cargando perfil:',
            error
        );
    }
}


/* =========================================================
   AUTH
   ========================================================= */

onAuthStateChanged(
    auth,
    async user => {

        currentUser =
            user;


        if (user) {

            console.log(
                '[RESERVAS] Usuario autenticado:',
                user.uid
            );


            await profile(
                user
            );

        } else {

            console.log(
                '[RESERVAS] Usuario no autenticado.'
            );


            message(
                'Iniciá sesión para hacer una reserva.',
                'error'
            );
        }


        summary();
    }
);


/* =========================================================
   DATE CHANGE
   ========================================================= */

date?.addEventListener(
    'change',
    async () => {

        selected.clear();


        try {

            await loadConfig();

            makeTimes();

        } catch (error) {

            console.error(
                '[RESERVAS] Error cambiando fecha:',
                error
            );


            message(
                error.message,
                'error'
            );
        }


        summary();
    }
);


/* =========================================================
   TIME CHANGE
   ========================================================= */

time?.addEventListener(
    'change',
    availability
);


/* =========================================================
   DURATION CHANGE
   ========================================================= */

duration?.addEventListener(
    'change',
    availability
);


/* =========================================================
   PAYMENT
   ========================================================= */

document
    .querySelectorAll(
        'input[name="payment"]'
    )
    .forEach(
        input => {

            input.addEventListener(
                'change',
                () => {

                    const selectedPayment =
                        document.querySelector(
                            'input[name="payment"]:checked'
                        )?.value;


                    const proofBlock =
                        $('proofBlock');


                    if (proofBlock) {

                        proofBlock.hidden =
                            selectedPayment !==
                            'transferencia';
                    }
                }
            );
        }
    );


/* =========================================================
   SUBMIT
   ========================================================= */

form?.addEventListener(
    'submit',
    async event => {

        event.preventDefault();


        /* -------------------------------------------------
           AUTH
           ------------------------------------------------- */

        if (!currentUser) {

            message(
                'Iniciá sesión para continuar.',
                'error'
            );

            return;
        }


        /* -------------------------------------------------
           BASIC VALIDATION
           ------------------------------------------------- */

        if (
            !date?.value ||
            !time?.value ||
            !duration?.value
        ) {

            message(
                'Seleccioná fecha, hora y duración.',
                'error'
            );

            return;
        }


        if (
            selected.size === 0
        ) {

            message(
                'Seleccioná al menos un simulador.',
                'error'
            );

            return;
        }


        /* -------------------------------------------------
           PAYMENT
           ------------------------------------------------- */

        const payment =
            document.querySelector(
                'input[name="payment"]:checked'
            )?.value;


        if (
            ![
                'transferencia',
                'tarjeta'
            ].includes(payment)
        ) {

            message(
                'Seleccioná un método de pago.',
                'error'
            );

            return;
        }


        /* -------------------------------------------------
           BUTTON
           ------------------------------------------------- */

        const button =
            $('reservationSubmit');


        if (button) {

            button.disabled =
                true;
        }


        message(
            'Procesando reserva…',
            'info'
        );


        console.log(
            '[RESERVAS] Procesando reserva...',
            {
                date:
                    date.value,

                time:
                    time.value,

                duration:
                    Number(
                        duration.value
                    ),

                rigs:
                    [
                        ...selected.keys()
                    ],

                payment
            }
        );


        try {

            /* =================================================
               PROOF
               ================================================= */

            let proofPath =
                null;


            /* -------------------------------------------------
               TRANSFERENCIA
               ------------------------------------------------- */

            if (
                payment ===
                'transferencia'
            ) {

                const input =
                    $('paymentProof');


                const file =
                    input?.files?.[0];


                if (!file) {

                    throw new Error(
                        'Subí el comprobante de transferencia.'
                    );
                }


                /* ---------------------------------------------
                   MAX 5 MB
                   --------------------------------------------- */

                if (
                    file.size >
                    5 * 1024 * 1024
                ) {

                    throw new Error(
                        'El comprobante no puede pesar más de 5 MB.'
                    );
                }


                /* ---------------------------------------------
                   TYPE
                   --------------------------------------------- */

                const allowed =
                    [
                        'image/jpeg',
                        'image/png',
                        'application/pdf'
                    ];


                if (
                    !allowed.includes(
                        file.type
                    )
                ) {

                    throw new Error(
                        'El comprobante debe ser JPG, PNG o PDF.'
                    );
                }


                /* ---------------------------------------------
                   STORAGE PATH
                   --------------------------------------------- */

                const safeName =
                    file.name.replace(
                        /[^a-zA-Z0-9._-]/g,
                        '_'
                    );


                proofPath =
                    `reservation-proofs/${currentUser.uid}/${crypto.randomUUID()}-${safeName}`;


                console.log(
                    '[RESERVAS] Subiendo comprobante...'
                );


                await uploadBytes(
                    ref(
                        storage,
                        proofPath
                    ),
                    file,
                    {
                        contentType:
                            file.type
                    }
                );


                console.log(
                    '[RESERVAS] Comprobante subido:',
                    proofPath
                );
            }


            /* =================================================
               CREATE BODY

               NO mandamos customer.
               El backend carga esos datos desde Firestore.
               ================================================= */

            const body = {

                date:
                    date.value,

                time:
                    time.value,

                duration:
                    Number(
                        duration.value
                    ),

                rigIds:
                    [
                        ...selected.keys()
                    ],

                payment,

                proofPath
            };


            console.log(
                '[RESERVAS] Creando reserva:',
                body
            );


            /* =================================================
               CREATE RESERVATION
               ================================================= */

            const result =
                await api(
                    '/api/reservations/create',
                    {
                        method:
                            'POST',

                        body:
                            JSON.stringify(
                                body
                            )
                    }
                );


            console.log(
                '[RESERVAS] Respuesta create:',
                result
            );


            /* =================================================
               VALIDATE RESPONSE
               ================================================= */

            if (
                !result?.code
            ) {

                throw new Error(
                    'El servidor creó una respuesta inválida.'
                );
            }


            const reservationCode =
                result.code;


            const total =
                result.pricing?.total ??
                localPrice();


            /* =================================================
               SUCCESS MESSAGE
               ================================================= */

            let successMessage;


            if (
                payment ===
                'transferencia'
            ) {

                successMessage =
                    `Su reserva ${reservationCode} ha sido procesada, pero está pendiente de verificación del comprobante.\n\nRevisá tu WhatsApp; por ese medio se te confirmará la reserva.\n\nTotal: ${money(total)}.`;

            } else {

                successMessage =
                    `Su reserva ${reservationCode} ha sido procesada.\n\nRevisá tu WhatsApp; por ese medio se te confirmará la reserva.\n\nTotal: ${money(total)}.`;
            }


            /* =================================================
               PAGE MESSAGE
               ================================================= */

            message(
                successMessage.replace(
                    /\n+/g,
                    ' '
                ),
                'success'
            );


            /* =================================================
               ALERT

               IMPORTANTE:
               Esto ocurre DESPUÉS del 201 del backend.
               ================================================= */

            window.alert(
                successMessage
            );


            console.log(
                '[RESERVAS] Reserva creada correctamente:',
                {
                    code:
                        reservationCode,

                    payment:
                        result.payment,

                    paymentVerification:
                        result.paymentVerification,

                    confirmationStatus:
                        result.confirmationStatus,

                    whatsappStatus:
                        result.whatsappStatus
                }
            );


            /* =================================================
               CLEAR SELECTION
               ================================================= */

            selected.clear();


            /* =================================================
               CLEAR PROOF
               ================================================= */

            const proofInput =
                $('paymentProof');


            if (proofInput) {

                proofInput.value =
                    '';
            }


            /* =================================================
               REFRESH AVAILABILITY

               La reserva YA existe.
               Si esto falla NO mostramos la reserva como fallida.
               ================================================= */

            try {

                await availability();

            } catch (
                availabilityError
            ) {

                console.error(
                    '[RESERVAS] La reserva fue creada, pero no se pudo refrescar disponibilidad:',
                    availabilityError
                );
            }


        } catch (error) {

            console.error(
                '[RESERVAS] Error creando reserva:',
                error
            );


            message(
                error.message ||
                'No se pudo crear la reserva.',
                'error'
            );


        } finally {

            summary();
        }
    }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

async function initialize() {

    console.log(
        '[RESERVAS] Inicializando...'
    );


    try {

        dates();

        await loadConfig();

        makeTimes();

        summary();


        console.log(
            '[RESERVAS] Inicialización completada.'
        );


    } catch (error) {

        console.error(
            '[RESERVAS] Error inicializando:',
            error
        );


        message(
            error.message ||
            'No se pudo cargar el sistema de reservas.',
            'error'
        );
    }
}


initialize();