import { auth } from '../firebase-config.js';

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
   HELPERS / ELEMENTS
   ========================================================= */

const $ = (id) => document.getElementById(id);

const form = $('reservationForm');

const dateSelect = $('reservationDate');
const timeSelect = $('reservationTime');
const durationSelect = $('reservationDuration');

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
let promotions = [];

let currentUser = null;
let loadingAvailability = false;


/* =========================================================
   ASSETS
   ========================================================= */

const wheel =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';


/* =========================================================
   MONEY
   ========================================================= */

function money(value) {

    return `L ${Number(value || 0).toLocaleString(
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

    const element = $('reservationMessage');

    if (!element) {
        return;
    }

    element.textContent = text || '';
    element.dataset.type = type;
    element.hidden = !text;
}


/* =========================================================
   API
   ========================================================= */

async function api(path, options = {}) {

    const headers = {
        ...(options.headers || {})
    };


    /*
     * Si existe usuario autenticado, enviamos
     * su Firebase ID Token al backend.
     */

    if (currentUser) {

        const token =
            await currentUser.getIdToken();

        headers.Authorization =
            `Bearer ${token}`;
    }


    /*
     * JSON solamente cuando no mandamos FormData.
     */

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

function createDates() {

    if (!dateSelect) {
        return;
    }


    dateSelect.innerHTML = '';


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
     * Máximo 7 días.
     */

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
            prefix = 'HOY · ';
        }

        if (i === 1) {
            prefix = 'MAÑANA · ';
        }


        const label =
            `${prefix}${displayFormatter.format(currentDate)}`
                .toUpperCase();


        dateSelect.add(
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

function timeToMinutes(value) {

    const [
        hours,
        minutes
    ] = value
        .split(':')
        .map(Number);

    return (
        hours * 60 +
        minutes
    );
}


/* =========================================================
   TIMES
   ========================================================= */

function makeTimes() {

    if (!timeSelect) {
        return;
    }


    timeSelect.innerHTML =
        '<option value="">Seleccioná una hora</option>';


    if (
        !dateSelect?.value ||
        !appConfig
    ) {
        return;
    }


    /*
     * Usamos mediodía UTC para evitar que el timezone
     * nos cambie accidentalmente el día.
     */

    const day =
        new Date(
            `${dateSelect.value}T12:00:00Z`
        ).getUTCDay();


    const businessHours =
        appConfig.hours?.[day];


    /*
     * Día cerrado.
     */

    if (!businessHours) {

        timeSelect.innerHTML =
            '<option value="">Cerrado</option>';

        return;
    }


    const start =
        timeToMinutes(
            businessHours[0]
        );

    const end =
        timeToMinutes(
            businessHours[1]
        );


    /*
     * Horas exactas.
     *
     * 14:00
     * 15:00
     * 16:00
     * etc.
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
            `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;


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
                    hour,
                    minute
                )
            );


        timeSelect.add(
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
        !durationSelect ||
        !appConfig
    ) {
        return;
    }


    durationSelect.innerHTML = '';


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
        let hours = min;
        hours <= max;
        hours++
    ) {

        durationSelect.add(
            new Option(
                `${hours} ${hours === 1 ? 'hora' : 'horas'}`,
                String(hours)
            )
        );
    }
}


/* =========================================================
   CONFIG
   ========================================================= */

async function loadConfig() {

    const queryDate =
        dateSelect?.value;


    const endpoint =
        queryDate
            ? `/api/reservations/config?date=${encodeURIComponent(queryDate)}`
            : '/api/reservations/config';


    const data =
        await api(endpoint);


    appConfig =
        data.config || {};


    rigs =
        Array.isArray(data.rigs)
            ? data.rigs
            : [];


    promotions =
        Array.isArray(data.promotions)
            ? data.promotions
            : [];


    makeDurations();

    updatePrices();


    render(
        rigs.map(
            (rig) => ({
                ...rig,
                available: true
            })
        )
    );
}


/* =========================================================
   PRICES
   ========================================================= */

function updatePrices() {

    if (!appConfig) {
        return;
    }


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
            `${money(appConfig.prices?.standard)} / HORA`;
    }


    if (premium) {

        premium.textContent =
            `${money(appConfig.prices?.premium)} / HORA`;
    }
}


/* =========================================================
   RIG CARD
   ========================================================= */

function createRigCard(rig) {

    const button =
        document.createElement(
            'button'
        );


    button.type =
        'button';


    button.className =
        'simulator-card';


    button.dataset.id =
        rig.id;


    /*
     * No disponible =
     * no se puede seleccionar.
     */

    button.disabled =
        !rig.available;


    /*
     * Tus rigs usan "order".
     *
     * Si por alguna razón falta, usamos name.
     */

    const rigLabel =
        Number.isFinite(
            Number(rig.order)
        )
            ? `SIMULADOR ${rig.order}`
            : (
                rig.name ||
                'SIMULADOR'
            );


    button.innerHTML = `
        <span class="simulator-check">✓</span>

        <img
            class="simulator-wheel"
            src="${wheel}"
            alt=""
        >

        <span class="simulator-card-info">

            <small>
                ${String(rig.type || '').toUpperCase()}
            </small>

            <strong>
                ${rigLabel}
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
                selected.has(rig.id)
            );


            updateSummary();
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


        grid.innerHTML = '';


        const typeRigs =
            list.filter(
                (rig) =>
                    rig.type === type
            );


        typeRigs.forEach(
            (rig) => {

                grid.appendChild(
                    createRigCard(rig)
                );
            }
        );


        const available =
            typeRigs.filter(
                (rig) =>
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
            String(
                list.filter(
                    (rig) =>
                        rig.available
                ).length
            );
    }


    updateSummary();
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

async function loadAvailability() {

    if (loadingAvailability) {
        return;
    }


    selected.clear();


    /*
     * Todavía no tenemos horario completo.
     */

    if (
        !dateSelect?.value ||
        !timeSelect?.value ||
        !durationSelect?.value
    ) {

        render(
            rigs.map(
                (rig) => ({
                    ...rig,
                    available: true
                })
            )
        );

        return;
    }


    loadingAvailability =
        true;


    try {

        const params =
            new URLSearchParams({
                date:
                    dateSelect.value,

                time:
                    timeSelect.value,

                duration:
                    durationSelect.value
            });


        const data =
            await api(
                `/api/reservations/availability?${params.toString()}`
            );


        render(
            Array.isArray(data.rigs)
                ? data.rigs
                : []
        );


        message('');


    } catch (error) {

        console.error(
            '[RESERVAS] Error cargando disponibilidad:',
            error
        );


        message(
            error.message,
            'error'
        );


        /*
         * Si el servidor no pudo comprobar
         * disponibilidad, NO dejamos seleccionar.
         */

        render(
            rigs.map(
                (rig) => ({
                    ...rig,
                    available: false
                })
            )
        );


    } finally {

        loadingAvailability =
            false;
    }
}


/* =========================================================
   LOCAL DISPLAY PRICE

   Esto es SOLO visual.

   El precio definitivo SIEMPRE lo vuelve
   a calcular el backend.
   ========================================================= */

function calculateDisplayPrice() {

    const hours =
        Number(
            durationSelect?.value ||
            1
        );


    let base = 0;


    for (
        const rig
        of selected.values()
    ) {

        const hourlyPrice =
            Number(
                appConfig?.prices?.[
                    rig.type
                ] ||
                0
            );


        base +=
            hourlyPrice *
            hours;
    }


    let discount = 0;


    for (
        const promotion
        of promotions
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


    discount =
        Math.min(
            base,
            discount
        );


    return Math.max(
        0,
        base - discount
    );
}


/* =========================================================
   SUMMARY
   ========================================================= */

function updateSummary() {

    const standardCount =
        [
            ...selected.values()
        ].filter(
            (rig) =>
                rig.type ===
                'standard'
        ).length;


    const premiumCount =
        [
            ...selected.values()
        ].filter(
            (rig) =>
                rig.type ===
                'premium'
        ).length;


    const summaryStandard =
        $('summaryStandard');

    const summaryPremium =
        $('summaryPremium');

    const summaryDuration =
        $('summaryDuration');

    const total =
        $('reservationTotal');

    const submit =
        $('reservationSubmit');


    if (summaryStandard) {

        summaryStandard.textContent =
            String(
                standardCount
            );
    }


    if (summaryPremium) {

        summaryPremium.textContent =
            String(
                premiumCount
            );
    }


    const hours =
        Number(
            durationSelect?.value ||
            1
        );


    if (summaryDuration) {

        summaryDuration.textContent =
            `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }


    if (total) {

        total.textContent =
            money(
                calculateDisplayPrice()
            );
    }


    if (submit) {

        submit.disabled =
            !currentUser ||
            !dateSelect?.value ||
            !timeSelect?.value ||
            !durationSelect?.value ||
            selected.size === 0;
    }
}


/* =========================================================
   AUTH

   NO cargamos:
   - name
   - email
   - phone

   El backend los obtiene usando el UID.
   ========================================================= */

onAuthStateChanged(
    auth,
    (user) => {

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


        updateSummary();
    }
);


/* =========================================================
   DATE CHANGE
   ========================================================= */

dateSelect?.addEventListener(
    'change',
    async () => {

        try {

            selected.clear();


            /*
             * Cargamos promociones/configuración
             * correspondientes a esa fecha.
             */

            await loadConfig();


            makeTimes();


            /*
             * Después de cambiar fecha obligamos
             * a seleccionar hora otra vez.
             */

            if (timeSelect) {
                timeSelect.value = '';
            }


            updateSummary();


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

timeSelect?.addEventListener(
    'change',
    () => {

        loadAvailability();
    }
);


/* =========================================================
   DURATION CHANGE
   ========================================================= */

durationSelect?.addEventListener(
    'change',
    () => {

        loadAvailability();
    }
);


/* =========================================================
   PAYMENT METHOD
   ========================================================= */

document
    .querySelectorAll(
        'input[name="payment"]'
    )
    .forEach(
        (input) => {

            input.addEventListener(
                'change',
                () => {

                    const payment =
                        document.querySelector(
                            'input[name="payment"]:checked'
                        )?.value;


                    const proofBlock =
                        $('proofBlock');


                    if (proofBlock) {

                        proofBlock.hidden =
                            payment !==
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
    async (event) => {

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
           VALIDATION
           ================================================= */

        if (!dateSelect?.value) {

            message(
                'Seleccioná una fecha.',
                'error'
            );

            return;
        }


        if (!timeSelect?.value) {

            message(
                'Seleccioná una hora.',
                'error'
            );

            return;
        }


        if (!durationSelect?.value) {

            message(
                'Seleccioná la duración.',
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
         * Tarjeta todavía no disponible.
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


        /* =================================================
           BUTTON
           ================================================= */

        const submitButton =
            $('reservationSubmit');


        if (submitButton) {

            submitButton.disabled =
                true;
        }


        message(
            'Procesando reserva…',
            'info'
        );


        try {

            /* =================================================
               PAYMENT PROOF
               ================================================= */

            let proofPath =
                null;


            if (
                payment ===
                'transferencia'
            ) {

                const fileInput =
                    $('paymentProof');


                const file =
                    fileInput?.files?.[0];


                if (!file) {

                    throw new Error(
                        'Subí el comprobante de transferencia.'
                    );
                }


                /*
                 * 5 MB máximo.
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
                 * Solamente JPG, PNG o PDF.
                 */

                const allowedTypes =
                    [
                        'image/jpeg',
                        'image/png',
                        'application/pdf'
                    ];


                if (
                    !allowedTypes.includes(
                        file.type
                    )
                ) {

                    throw new Error(
                        'El comprobante debe ser JPG, PNG o PDF.'
                    );
                }


                /*
                 * Sanitizamos filename.
                 */

                const safeFileName =
                    file.name.replace(
                        /[^a-zA-Z0-9._-]/g,
                        '_'
                    );


                proofPath =
                    `reservation-proofs/${currentUser.uid}/${crypto.randomUUID()}-${safeFileName}`;


                /*
                 * Upload directo a Firebase Storage.
                 */

                const storageRef =
                    ref(
                        storage,
                        proofPath
                    );


                await uploadBytes(
                    storageRef,
                    file,
                    {
                        contentType:
                            file.type
                    }
                );
            }


            /* =================================================
               REQUEST BODY

               IMPORTANTE:

               NO mandamos:
               - customer
               - name
               - email
               - phone
               - price
               - total
               - status

               Todo eso lo decide el backend.
               ================================================= */

            const body = {

                date:
                    dateSelect.value,

                time:
                    timeSelect.value,

                duration:
                    Number(
                        durationSelect.value
                    ),

                rigIds:
                    [
                        ...selected.keys()
                    ],

                payment,

                proofPath
            };


            console.log(
                '[RESERVAS] Solicitando reserva:',
                {
                    date:
                        body.date,

                    time:
                        body.time,

                    duration:
                        body.duration,

                    rigs:
                        body.rigIds.length,

                    payment:
                        body.payment
                }
            );


            /* =================================================
               CREATE
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


            /* =================================================
               SUCCESS
               ================================================= */

            message(
                `Reserva ${result.code} creada. Estado: PENDIENTE. Total: ${money(result.pricing?.total)}.`,
                'success'
            );


            console.log(
                '[RESERVAS] Reserva creada:',
                {
                    id:
                        result.id,

                    code:
                        result.code,

                    status:
                        result.status
                }
            );


            /*
             * Limpiamos selección.
             */

            selected.clear();


            /*
             * Limpiamos comprobante.
             */

            const fileInput =
                $('paymentProof');


            if (fileInput) {
                fileInput.value = '';
            }


            /*
             * Volvemos a consultar disponibilidad
             * porque los rigs reservados ahora
             * deben estar bloqueados.
             */

            await loadAvailability();


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

            updateSummary();
        }
    }
);


/* =========================================================
   INITIALIZE
   ========================================================= */

async function init() {

    try {

        createDates();


        /*
         * Cargamos config usando la primera fecha,
         * que createDates() ya seleccionó.
         */

        await loadConfig();


        makeTimes();


        /*
         * Dejamos que el usuario elija hora.
         */

        if (timeSelect) {
            timeSelect.value = '';
        }


        updateSummary();


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