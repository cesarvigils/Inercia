import { auth, db } from '../firebase-config.js';

import {
    doc,
    getDoc,
    collection,
    getDocs,
    query,
    where,
    orderBy
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
   FIREBASE
   ========================================================= */

const storage = getStorage(auth.app);


/* =========================================================
   DOM
   ========================================================= */

const $ = (id) => document.getElementById(id);

const form = $('reservationForm');

const date = $('reservationDate');
const time = $('reservationTime');
const duration = $('reservationDuration');

const grids = {
    standard: $('standardGrid'),
    premium: $('premiumGrid')
};

const counts = {
    standard: $('standardCount'),
    premium: $('premiumCount')
};


/* =========================================================
   STATE
   ========================================================= */

const selected = new Map();

let appConfig = null;
let rigs = [];
let currentUser = null;
let promos = [];

let availabilityRequestId = 0;


/* =========================================================
   ASSETS
   ========================================================= */

const wheel =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';


/* =========================================================
   MONEY
   ========================================================= */

function money(n) {
    return `L ${Number(n || 0).toLocaleString(
        'es-HN',
        {
            maximumFractionDigits: 2
        }
    )}`;
}


/* =========================================================
   MESSAGE
   ========================================================= */

function message(text, type = 'info') {

    const el = $('reservationMessage');

    if (!el) return;

    el.textContent = text || '';
    el.dataset.type = type;
    el.hidden = !text;
}


/* =========================================================
   API
   ========================================================= */

async function api(path, options = {}) {

    const headers = {
        ...(options.headers || {})
    };


    /*
     * Si hay usuario autenticado mandamos
     * el Firebase ID Token.
     */

    if (currentUser) {

        const token =
            await currentUser.getIdToken();

        headers.Authorization =
            `Bearer ${token}`;
    }


    if (
        options.body &&
        !(options.body instanceof FormData)
    ) {
        headers['Content-Type'] =
            'application/json';
    }


    const response =
        await fetch(
            path,
            {
                ...options,
                headers
            }
        );


    const data =
        await response
            .json()
            .catch(() => ({}));


    if (!response.ok) {

        console.error(
            `[RESERVAS API] ${response.status} ${path}`,
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

    if (!date) return;


    date.innerHTML = '';


    const displayFormatter =
        new Intl.DateTimeFormat(
            'es-HN',
            {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                timeZone: 'America/Tegucigalpa'
            }
        );


    const valueFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                timeZone: 'America/Tegucigalpa'
            }
        );


    /*
     * Hoy + próximos 6 días = 7 días.
     */

    for (
        let i = 0;
        i < 7;
        i++
    ) {

        const d =
            new Date(
                Date.now() +
                i * 86400000
            );


        const value =
            valueFormatter.format(d);


        let prefix = '';

        if (i === 0) {
            prefix = 'HOY · ';
        }

        if (i === 1) {
            prefix = 'MAÑANA · ';
        }


        const label =
            `${prefix}${displayFormatter.format(d)}`
                .toUpperCase();


        date.add(
            new Option(
                label,
                value
            )
        );
    }
}


/* =========================================================
   TIME HELPERS
   ========================================================= */

function toMinutes(value) {

    const [h, m] =
        String(value)
            .split(':')
            .map(Number);

    return h * 60 + m;
}


/* =========================================================
   TIMES
   ========================================================= */

function makeTimes() {

    if (!time) return;


    time.innerHTML =
        '<option value="">Seleccioná una hora</option>';


    if (
        !date?.value ||
        !appConfig
    ) {
        return;
    }


    /*
     * 0 = Domingo
     * 1 = Lunes
     * ...
     * 6 = Sábado
     */

    const day =
        new Date(
            `${date.value}T12:00:00Z`
        ).getUTCDay();


    const businessHours =
        appConfig.hours?.[day];


    /*
     * Día cerrado.
     */

    if (
        !businessHours ||
        !Array.isArray(businessHours)
    ) {

        time.innerHTML =
            '<option value="">CERRADO</option>';

        return;
    }


    const start =
        toMinutes(
            businessHours[0]
        );


    const end =
        toMinutes(
            businessHours[1]
        );


    /*
     * SOLO horas exactas.
     *
     * 14:00
     * 15:00
     * 16:00...
     */

    for (
        let m = start;
        m < end;
        m += 60
    ) {

        const hh =
            Math.floor(
                m / 60
            );


        const mm =
            m % 60;


        const value =
            `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;


        const label =
            new Intl.DateTimeFormat(
                'en-US',
                {
                    hour: 'numeric',
                    minute: '2-digit'
                }
            ).format(
                new Date(
                    2000,
                    0,
                    1,
                    hh,
                    mm
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


    const oldValue =
        duration.value;


    duration.innerHTML = '';


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
                `${i} ${i === 1 ? 'hora' : 'horas'}`,
                String(i)
            )
        );
    }


    /*
     * Conservamos duración si todavía es válida.
     */

    if (
        oldValue &&
        [...duration.options]
            .some(
                option =>
                    option.value ===
                    oldValue
            )
    ) {
        duration.value =
            oldValue;
    }
}


/* =========================================================
   LOAD CONFIG

   /api/reservations/config obtiene:
   - settings
   - rigs
   - promotions
   desde el backend / Firestore.

   NO estamos quitando Firestore.
   ========================================================= */

async function loadConfig() {

    const endpoint =
        date?.value
            ? `/api/reservations/config?date=${encodeURIComponent(date.value)}`
            : '/api/reservations/config';


    console.log(
        '[RESERVAS] Cargando configuración:',
        endpoint
    );


    const data =
        await api(endpoint);


    appConfig =
        data.config || {};


    rigs =
        Array.isArray(data.rigs)
            ? data.rigs
            : [];


    promos =
        Array.isArray(data.promotions)
            ? data.promotions
            : [];


    console.log(
        '[RESERVAS] Configuración cargada:',
        {
            rigs: rigs.length,
            promotions: promos.length,
            prices: appConfig.prices
        }
    );


    makeDurations();

    updatePrices();


    /*
     * Antes de escoger horario mostramos
     * todos los rigs activos.
     */

    render(
        rigs.map(
            r => ({
                ...r,
                available: true
            })
        )
    );
}


/* =========================================================
   PRICES
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
   RIG NUMBER / NAME
   ========================================================= */

function rigDisplayName(rig) {

    /*
     * Soportamos ambos formatos por si tus
     * documentos viejos usan number y los
     * nuevos order.
     */

    const number =
        rig.number ??
        rig.order;


    if (
        number !== undefined &&
        number !== null &&
        number !== ''
    ) {
        return `SIMULADOR ${number}`;
    }


    if (rig.name) {
        return String(rig.name).toUpperCase();
    }


    return 'SIMULADOR';
}


/* =========================================================
   RIG CARD
   ========================================================= */

function card(r) {

    const button =
        document.createElement(
            'button'
        );


    button.type =
        'button';


    button.className =
        'simulator-card';


    button.disabled =
        !r.available;


    button.dataset.id =
        r.id;


    const type =
        String(
            r.type || ''
        ).toUpperCase();


    const name =
        rigDisplayName(r);


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
                ${type}
            </small>

            <strong>
                ${name}
            </strong>

        </span>
    `;


    if (
        selected.has(r.id) &&
        r.available
    ) {

        button.classList.add(
            'selected'
        );
    }


    button.onclick =
        () => {

            if (!r.available) {
                return;
            }


            if (
                selected.has(r.id)
            ) {

                selected.delete(
                    r.id
                );

            } else {

                selected.set(
                    r.id,
                    r
                );
            }


            button.classList.toggle(
                'selected',
                selected.has(r.id)
            );


            summary();
        };


    return button;
}


/* =========================================================
   RENDER
   ========================================================= */

function render(list) {

    const safeList =
        Array.isArray(list)
            ? list
            : [];


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


        grid.innerHTML = '';


        const typeRigs =
            safeList.filter(
                r =>
                    r.type ===
                    type
            );


        typeRigs.forEach(
            r =>
                grid.append(
                    card(r)
                )
        );


        const available =
            typeRigs.filter(
                r =>
                    r.available
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
            String(
                safeList.filter(
                    r =>
                        r.available
                ).length
            );
    }


    summary();
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

async function availability() {

    const requestId =
        ++availabilityRequestId;


    selected.clear();


    if (
        !date?.value ||
        !time?.value ||
        !duration?.value
    ) {

        render(
            rigs.map(
                r => ({
                    ...r,
                    available: true
                })
            )
        );

        return;
    }


    try {

        const params =
            new URLSearchParams({
                date:
                    date.value,

                time:
                    time.value,

                duration:
                    duration.value
            });


        const data =
            await api(
                `/api/reservations/availability?${params.toString()}`
            );


        /*
         * Si mientras esperábamos el usuario cambió
         * otra vez fecha/hora/duración, ignoramos
         * la respuesta vieja.
         */

        if (
            requestId !==
            availabilityRequestId
        ) {
            return;
        }


        const availableRigs =
            Array.isArray(data.rigs)
                ? data.rigs
                : [];


        render(
            availableRigs
        );


        message('');


    } catch (error) {

        if (
            requestId !==
            availabilityRequestId
        ) {
            return;
        }


        console.error(
            '[RESERVAS] Error cargando disponibilidad:',
            error
        );


        /*
         * Fail closed:
         *
         * si no pudimos verificar disponibilidad,
         * NO dejamos reservar.
         */

        render(
            rigs.map(
                r => ({
                    ...r,
                    available: false
                })
            )
        );


        message(
            error.message,
            'error'
        );
    }
}


/* =========================================================
   LOCAL DISPLAY PRICE

   ESTO ES SOLO PARA MOSTRAR EL TOTAL.

   El backend vuelve a calcular TODO:
   - precio
   - promociones
   - penalidad
   - duración
   - rigs

   El cliente NO decide el precio final.
   ========================================================= */

function localPrice() {

    const hours =
        Number(
            duration?.value ||
            1
        );


    let base = 0;


    for (
        const r
        of selected.values()
    ) {

        const hourly =
            Number(
                appConfig
                    ?.prices
                    ?.[r.type] ||
                0
            );


        base +=
            hourly *
            hours;
    }


    let discount = 0;


    for (
        const promotion
        of promos
    ) {

        if (
            promotion.type ===
            'percent'
        ) {

            discount +=
                base *
                (
                    Number(
                        promotion.value ||
                        0
                    ) /
                    100
                );

        } else if (
            promotion.type ===
            'fixed'
        ) {

            discount +=
                Number(
                    promotion.value ||
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

    const standard =
        [
            ...selected.values()
        ].filter(
            x =>
                x.type ===
                'standard'
        ).length;


    const premium =
        [
            ...selected.values()
        ].filter(
            x =>
                x.type ===
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


    const reservationSubmit =
        $('reservationSubmit');


    if (summaryStandard) {

        summaryStandard.textContent =
            String(standard);
    }


    if (summaryPremium) {

        summaryPremium.textContent =
            String(premium);
    }


    const hours =
        Number(
            duration?.value ||
            1
        );


    if (summaryDuration) {

        summaryDuration.textContent =
            `${hours} ${
                hours === 1
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


    if (reservationSubmit) {

        reservationSubmit.disabled =
            !currentUser ||
            !date?.value ||
            !time?.value ||
            !duration?.value ||
            selected.size === 0;
    }
}


/* =========================================================
   AUTH

   IMPORTANTE:

   YA NO LEEMOS EL PERFIL DESDE FIRESTORE AQUÍ.

   No buscamos:
   users/{uid}.name
   users/{uid}.email
   users/{uid}.phoneNumber

   El backend identifica al usuario por su token y
   obtiene los datos personales desde Firebase.
   ========================================================= */

onAuthStateChanged(
    auth,
    user => {

        currentUser =
            user;


        if (user) {

            console.log(
                '[RESERVAS] Usuario autenticado:',
                user.uid
            );


            message('');

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


        /*
         * Invalidamos cualquier request anterior.
         */

        availabilityRequestId++;


        try {

            /*
             * Volvemos a cargar config porque
             * las promociones pueden depender
             * de la fecha.
             */

            await loadConfig();


            makeTimes();


            if (time) {
                time.value = '';
            }


            summary();


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


        /* =================================================
           AUTH
           ================================================= */

        if (!currentUser) {

            message(
                'Iniciá sesión para continuar.',
                'error'
            );

            return;
        }


        /* =================================================
           FORM VALIDATION
           ================================================= */

        if (!date?.value) {

            message(
                'Seleccioná una fecha.',
                'error'
            );

            return;
        }


        if (!time?.value) {

            message(
                'Seleccioná una hora.',
                'error'
            );

            return;
        }


        if (!duration?.value) {

            message(
                'Seleccioná la duración.',
                'error'
            );

            return;
        }


        if (!selected.size) {

            message(
                'Seleccioná al menos un simulador.',
                'error'
            );

            return;
        }


        const payment =
            document.querySelector(
                'input[name="payment"]:checked'
            )?.value;


        if (!payment) {

            message(
                'Seleccioná un método de pago.',
                'error'
            );

            return;
        }


        /*
         * PayPal / tarjeta todavía NO disponible.
         */

        if (
            payment ===
            'tarjeta'
        ) {

            message(
                'El pago con tarjeta todavía no está disponible.',
                'error'
            );

            return;
        }


        const btn =
            $('reservationSubmit');


        if (btn) {
            btn.disabled = true;
        }


        message(
            'Procesando reserva…'
        );


        try {

            /* =================================================
               TRANSFER PROOF
               ================================================= */

            let proofPath =
                null;


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


                /*
                 * Máximo 5 MB.
                 */

                if (
                    file.size >
                    5 * 1024 * 1024
                ) {

                    throw new Error(
                        'El comprobante no puede pesar más de 5 MB.'
                    );
                }


                /*
                 * JPG / PNG / PDF
                 */

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
                    '[RESERVAS] Comprobante subido.'
                );
            }


            /* =================================================
               CREATE REQUEST

               NO mandamos datos personales.

               Tampoco mandamos:
               - precio
               - status
               - promociones
               - penalidad
               - nombre del rig
               - tipo del rig

               El backend determina todo eso.
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
                {
                    date:
                        body.date,

                    time:
                        body.time,

                    duration:
                        body.duration,

                    rigCount:
                        body.rigIds.length,

                    payment:
                        body.payment
                }
            );


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


            /* =================================================
               SUCCESS
               ================================================= */

            message(
                `Reserva ${result.code} creada. Estado: PENDIENTE. Total: ${money(result.pricing?.total)}.`,
                'success'
            );


            console.log(
                '[RESERVAS] Reserva creada:',
                result
            );


            selected.clear();


            /*
             * Limpiamos comprobante.
             */

            const proofInput =
                $('paymentProof');


            if (proofInput) {
                proofInput.value = '';
            }


            /*
             * Consultamos otra vez disponibilidad.
             *
             * Los reservationLocks creados por el
             * backend deben hacer que esos rigs
             * ahora aparezcan ocupados.
             */

            await availability();


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
   INITIALIZATION
   ========================================================= */

async function init() {

    try {

        dates();


        /*
         * date ya tiene seleccionada la primera opción
         * después de dates().
         */

        await loadConfig();


        makeTimes();


        /*
         * El usuario debe seleccionar una hora.
         */

        if (time) {
            time.value = '';
        }


        summary();


        console.log(
            '[RESERVAS] Inicializado correctamente.'
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


init();