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
const storage = getStorage(auth.app);
const $ = (id) => document.getElementById(id);
function money(value) {
    return `L ${Number(value || 0).toLocaleString(
        'es-HN',
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }
    )}`;
}
function setValue(id, value = '') {
    const element = $(id);

    if (!element) {
        console.warn(
            `[RESERVAS] No existe el elemento #${id}`
        );

        return;
    }

    element.value = value ?? '';
}
function setText(id, value = '') {
    const element = $(id);

    if (!element) return;

    element.textContent = value;
}
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

const submitButton = $('reservationSubmit');


/* =========================================================
   STATE
   ========================================================= */

const selected = new Map();

let appConfig = null;
let rigs = [];
let currentUser = null;
let currentProfile = null;
let promos = [];
let loadingAvailability = false;


/* =========================================================
   ASSETS
   ========================================================= */

const wheel =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';


/* =========================================================
   API
   ========================================================= */

async function api(path, options = {}) {

    const headers = {
        ...(options.headers || {})
    };

    /*
     * Mandamos el Firebase ID Token al backend.
     */
    if (currentUser) {

        const token =
            await currentUser.getIdToken();

        headers.Authorization =
            `Bearer ${token}`;
    }

    /*
     * Solo JSON cuando no estamos mandando FormData.
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

    let data = {};

    try {
        data = await response.json();
    } catch {
        data = {};
    }

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
   MESSAGE
   ========================================================= */

function message(text, type = 'info') {

    const element =
        $('reservationMessage');

    if (!element) {

        if (text) {
            console.log(
                `[RESERVAS:${type}]`,
                text
            );
        }

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
   DATES
   ========================================================= */

function dates() {

    if (!dateSelect) return;

    /*
     * Evita duplicar fechas si la función
     * se ejecuta más de una vez.
     */
    dateSelect.innerHTML =
        '<option value="">Seleccioná una fecha</option>';

    const displayFormatter =
        new Intl.DateTimeFormat(
            'es-HN',
            {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                timeZone:
                    'America/Tegucigalpa'
            }
        );

    const valueFormatter =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                timeZone:
                    'America/Tegucigalpa'
            }
        );

    /*
     * Hoy + próximos 6 días.
     * Total: 7 días.
     */
    for (let i = 0; i < 7; i++) {

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
            (
                prefix +
                displayFormatter.format(d)
            ).toUpperCase();

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

function toMinutes(value) {

    if (!value) return 0;

    const [hours, minutes] =
        value
            .split(':')
            .map(Number);

    return (
        hours * 60 +
        minutes
    );
}

function formatTime(hours, minutes = 0) {

    const d =
        new Date(
            2000,
            0,
            1,
            hours,
            minutes
        );

    return new Intl.DateTimeFormat(
        'en-US',
        {
            hour: 'numeric',
            minute: '2-digit'
        }
    ).format(d);
}




async function makeTimes() {
    if (!timeSelect) return;

    timeSelect.disabled = true;
    timeSelect.innerHTML =
        '<option value="">Cargando horarios...</option>';

    if (!dateSelect?.value || !appConfig) {
        timeSelect.innerHTML =
            '<option value="">Seleccioná una hora</option>';

        timeSelect.disabled = false;
        return;
    }

    const [year, month, dayNumber] =
        dateSelect.value
            .split('-')
            .map(Number);

    const selectedDate =
        new Date(
            Date.UTC(
                year,
                month - 1,
                dayNumber,
                12
            )
        );

    const day =
        selectedDate.getUTCDay();

    const hoursConfig =
        appConfig.hours?.[day] ??
        appConfig.hours?.[String(day)];

    if (
        !hoursConfig ||
        !Array.isArray(hoursConfig)
    ) {
        timeSelect.innerHTML =
            '<option value="">Cerrado este día</option>';

        timeSelect.disabled = true;
        return;
    }

    const open =
        toMinutes(hoursConfig[0]);

    const close =
        toMinutes(hoursConfig[1]);

    const duration =
        Number(
            durationSelect?.value || 1
        );


    /* ================================================
       HORA ACTUAL EN HONDURAS
       ================================================ */

    const hnParts =
        new Intl.DateTimeFormat(
            'en-CA',
            {
                timeZone: 'America/Tegucigalpa',

                year: 'numeric',
                month: '2-digit',
                day: '2-digit',

                hour: '2-digit',
                minute: '2-digit',

                hourCycle: 'h23'
            }
        )
            .formatToParts(
                new Date()
            )
            .reduce(
                (result, part) => {
                    result[part.type] =
                        part.value;

                    return result;
                },
                {}
            );


    const todayHN =
        `${hnParts.year}-${hnParts.month}-${hnParts.day}`;


    const currentMinutes =
        Number(hnParts.hour) * 60 +
        Number(hnParts.minute);


    const minimumAdvanceMinutes =
        Number(
            appConfig.minimumAdvanceMinutes ??
            appConfig.minAdvanceMinutes ??
            30
        );


    /* ================================================
       CREAR POSIBLES HORARIOS
       ================================================ */

    const candidates = [];


    for (
        let minutes = open;
        minutes < close;
        minutes += 60
    ) {

        /*
         * La reserva completa tiene que terminar
         * antes del cierre.
         */

        if (
            minutes +
                duration * 60 >
            close
        ) {
            continue;
        }


        /*
         * Si seleccionó HOY:
         *
         * no mostrar horas pasadas ni horas que
         * estén dentro de los próximos 30 minutos.
         */

        if (
            dateSelect.value === todayHN
        ) {
            const minimumAllowed =
                currentMinutes +
                minimumAdvanceMinutes;


            if (
                minutes <
                minimumAllowed
            ) {
                continue;
            }
        }


        const hh =
            Math.floor(
                minutes / 60
            );

        const mm =
            minutes % 60;


        const value =
            `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;


        candidates.push({
            value,

            label:
                formatTime(
                    hh,
                    mm
                )
        });
    }


    /* ================================================
       CONSULTAR DISPONIBILIDAD REAL
       ================================================ */

    const checks =
        await Promise.all(
            candidates.map(
                async slot => {

                    try {

                        const params =
                            new URLSearchParams({
                                date:
                                    dateSelect.value,

                                time:
                                    slot.value,

                                duration:
                                    String(duration)
                            });


                        const data =
                            await api(
                                `/api/reservations/availability?${params.toString()}`
                            );


                        /*
                         * La hora solamente aparece
                         * si al menos UN rig está disponible.
                         */

                        const hasAvailableRig =
                            Array.isArray(
                                data.rigs
                            ) &&
                            data.rigs.some(
                                rig =>
                                    rig.available
                            );


                        if (
                            !hasAvailableRig
                        ) {
                            console.log(
                                `[RESERVAS] ${slot.value} ocultada: no quedan rigs.`
                            );

                            return null;
                        }


                        return slot;


                    } catch (error) {

                        /*
                         * Si backend devuelve 400,
                         * ocupado, horario inválido, etc.
                         *
                         * NO agregamos esa hora.
                         */

                        console.log(
                            `[RESERVAS] ${slot.value} ocultada:`,
                            error.message
                        );


                        return null;
                    }
                }
            )
        );


    const availableTimes =
        checks.filter(Boolean);


    /* ================================================
       LLENAR DROPDOWN
       ================================================ */

    timeSelect.innerHTML =
        '<option value="">Seleccioná una hora</option>';


    for (
        const slot
        of availableTimes
    ) {

        timeSelect.add(
            new Option(
                slot.label,
                slot.value
            )
        );
    }


    /* ================================================
       NINGÚN HORARIO
       ================================================ */

    if (
        availableTimes.length === 0
    ) {

        timeSelect.innerHTML =
            '<option value="">No hay horarios disponibles</option>';

        timeSelect.disabled =
            true;

        return;
    }


    timeSelect.disabled =
        false;
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
            appConfig.minDurationHours
        ) || 1;

    const max =
        Number(
            appConfig.maxDurationHours
        ) || 8;

    for (
        let i = min;
        i <= max;
        i++
    ) {

        durationSelect.add(
            new Option(
                `${i} ${
                    i === 1
                        ? 'hora'
                        : 'horas'
                }`,
                String(i)
            )
        );
    }
}


/* =========================================================
   CONFIG
   ========================================================= */

async function loadConfig() {

    const queryDate = dateSelect?.value;

const endpoint = queryDate
    ? `/api/reservations/config?date=${encodeURIComponent(queryDate)}`
    : '/api/reservations/config';

const data = await api(endpoint);

    if (!data?.config) {
        throw new Error(
            'El servidor no devolvió la configuración de reservas.'
        );
    }

    appConfig =
        data.config;

    rigs =
        Array.isArray(data.rigs)
            ? data.rigs
            : [];

    promos =
        Array.isArray(data.promotions)
            ? data.promotions
            : [];

    makeDurations();
await makeTimes();
updatePrices();

    /*
     * Hasta que se seleccione fecha/hora,
     * mostramos todos los rigs activos.
     */
    render(
        rigs.map(
            (rig) => ({
                ...rig,
                available: true
            })
        )
    );

    console.log(
        '[RESERVAS] Configuración cargada:',
        {
            config: appConfig,
            rigs: rigs.length,
            promotions: promos.length
        }
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
   SIMULATOR CARD
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

    /*
     * Puede venir como order, number o name.
     * Evita SIMULADOR undefined.
     */
    const rigNumber =
        rig.order ??
        rig.number ??
        '';

    const rigName =
        rig.name ||
        `Simulador ${rigNumber}`;

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
                ${rigName.toUpperCase()}
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

            summary();
        }
    );

    return button;
}


/* =========================================================
   RENDER RIGS
   ========================================================= */

function render(list = []) {

    const safeList =
        Array.isArray(list)
            ? list
            : [];

    for (
        const type of [
            'standard',
            'premium'
        ]
    ) {

        const grid =
            grids[type];

        if (!grid) continue;

        grid.innerHTML = '';

        const typeRigs =
            safeList.filter(
                (rig) =>
                    rig.type === type
            );

        typeRigs.forEach(
            (rig) => {

                grid.appendChild(
                    card(rig)
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

    setText(
        'availableCount',
        safeList.filter(
            (rig) =>
                rig.available
        ).length
    );

    summary();
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

async function availability() {

    if (loadingAvailability) {
        return;
    }

    selected.clear();

    /*
     * Todavía no tenemos suficiente información.
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

    loadingAvailability = true;

    try {

        message('');

        const params =
            new URLSearchParams({
                date:
                    dateSelect.value,

                time:
                    timeSelect.value,

                duration:
                    durationSelect.value
            });

        console.log(
            '[RESERVAS] Consultando disponibilidad:',
            params.toString()
        );

        const data =
            await api(
                `/api/reservations/availability?${params.toString()}`
            );

        render(
            Array.isArray(data.rigs)
                ? data.rigs
                : []
        );

    } catch (error) {

        console.error(
            '[RESERVAS] Error de disponibilidad:',
            error
        );

        message(
            error.message,
            'error'
        );

        /*
         * Si el backend falla, NO permitimos
         * seleccionar rigs.
         *
         * Esto es intencional para evitar
         * reservas sobre disponibilidad desconocida.
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

        summary();
    }
}


/* =========================================================
   LOCAL PRICE PREVIEW
   ========================================================= */

function localPrice() {

    const hours =
        Number(
            durationSelect?.value || 1
        );

    let base = 0;

    for (
        const rig of selected.values()
    ) {

        const price =
            Number(
                appConfig
                    ?.prices
                    ?.[rig.type]
            ) || 0;

        base +=
            price * hours;
    }

    let discount = 0;

    for (
        const promo of promos
    ) {

        if (
            promo.type ===
            'percent'
        ) {

            discount +=
                base *
                (
                    Number(
                        promo.value || 0
                    ) / 100
                );

        } else if (
            promo.type ===
            'fixed'
        ) {

            discount +=
                Number(
                    promo.value || 0
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

function summary() {

    const values =
        [...selected.values()];

    const standard =
        values.filter(
            (rig) =>
                rig.type ===
                'standard'
        ).length;

    const premium =
        values.filter(
            (rig) =>
                rig.type ===
                'premium'
        ).length;

    const hours =
        Number(
            durationSelect?.value || 1
        );

    setText(
        'summaryStandard',
        standard
    );

    setText(
        'summaryPremium',
        premium
    );

    setText(
        'summaryDuration',
        `${hours} ${
            hours === 1
                ? 'hora'
                : 'horas'
        }`
    );

    setText(
        'reservationTotal',
        money(
            localPrice()
        )
    );

    if (submitButton) {

        submitButton.disabled =
            !(
                currentUser &&
                dateSelect?.value &&
                timeSelect?.value &&
                durationSelect?.value &&
                selected.size > 0 &&
                !loadingAvailability
            );
    }
}


/* =========================================================
   USER PROFILE
   ========================================================= */

async function profile(user) {
    if (!user) {
        currentProfile = null;
        return;
    }

    try {
        const snapshot = await getDoc(
            doc(db, 'users', user.uid)
        );

        const firestoreProfile = snapshot.exists()
            ? snapshot.data()
            : {};

        currentProfile = {
            name:
                firestoreProfile.name ||
                user.displayName ||
                '',

            email:
                firestoreProfile.email ||
                user.email ||
                '',

            phoneNumber:
                firestoreProfile.phoneNumber ||
                ''
        };

        console.log('[RESERVAS] Perfil cargado:', {
            name: currentProfile.name,
            email: currentProfile.email,
            phoneNumber: currentProfile.phoneNumber
                ? 'CARGADO'
                : 'NO DISPONIBLE'
        });

    } catch (error) {
        console.error(
            '[RESERVAS] No se pudo cargar el perfil:',
            error
        );

        /*
         * Podemos recuperar nombre/correo desde Auth,
         * pero teléfono normalmente está en Firestore.
         */
        currentProfile = {
            name: user.displayName || '',
            email: user.email || '',
            phoneNumber: ''
        };
    }
}
/* =========================================================
   AUTH
   ========================================================= */

onAuthStateChanged(
    auth,
    async (user) => {

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

            /*
             * Quitamos mensaje viejo de login.
             */
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

dateSelect?.addEventListener(
    'change',
    async () => {

        selected.clear();

        /*
         * Primero cargamos config/promos del día.
         */
        try {

            await loadConfig();

            /*
             * loadConfig ya llama makeTimes().
             */

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

timeSelect?.addEventListener(
    'change',
    async () => {

        await availability();
    }
);


/* =========================================================
   DURATION CHANGE
   ========================================================= */

durationSelect?.addEventListener(
    'change',
    async () => {

        await availability();
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

                    const proofBlock =
                        $('proofBlock');

                    if (!proofBlock) {
                        return;
                    }

                    const payment =
                        document.querySelector(
                            'input[name="payment"]:checked'
                        )?.value;

                    proofBlock.hidden =
                        payment !==
                        'transferencia';
                }
            );
        }
    );


/* =========================================================
   SUBMIT RESERVATION
   ========================================================= */

form?.addEventListener(
    'submit',
    async (event) => {

        event.preventDefault();

        if (!currentUser) {

            message(
                'Iniciá sesión para continuar.',
                'error'
            );

            return;
        }

        if (
            !dateSelect?.value ||
            !timeSelect?.value ||
            !durationSelect?.value
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
         * PayPal todavía no implementado.
         */
        if (
            payment === 'paypal'
        ) {

            message(
                'Para pagar con PayPal, usá el botón de PayPal que aparece en Método de pago.',
                'error'
            );

            return;
        }

        if (submitButton) {
            submitButton.disabled = true;
        }

        message(
            'Procesando reserva…'
        );

        try {

            let proofPath =
                null;

            /* =============================================
               TRANSFER
               ============================================= */

            if (
                payment ===
                'transferencia'
            ) {

                const proofInput =
                    $('paymentReceipt');

                if (!proofInput) {

                    throw new Error(
                        'No se encontró el campo para subir el comprobante.'
                    );
                }

                const file =
                    proofInput.files?.[0];

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
                 * Tipos permitidos.
                 */
                const allowedTypes = [
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


            /* =============================================
               CUSTOMER DATA
               ============================================= */

           if (!currentProfile) {
    throw new Error(
        'No se pudieron cargar los datos de tu cuenta.'
    );
}

if (!currentProfile.name) {
    throw new Error(
        'Tu cuenta no tiene un nombre registrado.'
    );
}

if (!currentProfile.email) {
    throw new Error(
        'Tu cuenta no tiene un correo registrado.'
    );
}

if (!currentProfile.phoneNumber) {
    throw new Error(
        'Tu cuenta no tiene un número de teléfono registrado.'
    );
}

const customer = {
    name: currentProfile.name,
    email: currentProfile.email,
    phoneNumber: currentProfile.phoneNumber
};


            /* =============================================
               REQUEST BODY
               ============================================= */

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
                    [...selected.keys()],

                payment,

                proofPath,

                customer
            };

            console.log(
                '[RESERVAS] Creando reserva:',
                {
                    ...body,
                    proofPath:
                        proofPath
                            ? '[COMPROBANTE]'
                            : null
                }
            );


            /* =============================================
               CREATE
               ============================================= */

            const response =
                await api(
                    '/api/reservations/create',
                    {
                        method: 'POST',
                        body:
                            JSON.stringify(
                                body
                            )
                    }
                );


            /* =============================================
               SUCCESS
               ============================================= */

            const code =
                response.code ||
                response.reservationCode ||
                'CREADA';

            const total =
                response.pricing?.total ??
                response.total ??
                localPrice();

            const successMessage =
                payment === 'transferencia'
                    ? `Su reserva ${code} ha sido procesada, pero está pendiente de verificación del comprobante. Revise su WhatsApp; por ese medio se le confirmará la reserva. Total: ${money(total)}.`
                    : `Su reserva ${code} ha sido procesada. Revise su WhatsApp; por ese medio se le confirmará la reserva. Total: ${money(total)}.`;

            message(
                successMessage,
                'success'
            );

            // Solo mostramos éxito después de recibir 201 del backend.
            window.alert(successMessage);

            selected.clear();

            /*
             * La reserva ya existe en este punto.
             * Esta consulta solo refresca los rigs disponibles.
             */
            try {
                await availability();
            } catch (availabilityError) {
                console.error(
                    '[RESERVAS] Reserva creada, pero no se pudo refrescar disponibilidad:',
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

async function init() {

    console.log(
        '[RESERVAS] Inicializando...'
    );

    /*
     * Verificamos los elementos esenciales.
     */
    const requiredElements = {
        reservationForm: form,
        reservationDate: dateSelect,
        reservationTime: timeSelect,
        reservationDuration:
            durationSelect,
        standardGrid:
            grids.standard,
        premiumGrid:
            grids.premium
    };

    for (
        const [name, element]
        of Object.entries(
            requiredElements
        )
    ) {

        if (!element) {

            console.error(
                `[RESERVAS] Falta #${name} en reservas.html`
            );
        }
    }

    if (
        !dateSelect ||
        !timeSelect ||
        !durationSelect
    ) {

        console.error(
            '[RESERVAS] Faltan elementos esenciales del formulario.'
        );

        return;
    }

    dates();

    try {

        await loadConfig();

        console.log(
            '[RESERVAS] Inicialización completada.'
        );

    } catch (error) {

        console.error(
            '[RESERVAS] Error inicializando:',
            error
        );

        message(
            error.message,
            'error'
        );
    }

    summary();
}


init();