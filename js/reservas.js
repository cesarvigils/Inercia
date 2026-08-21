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


/* =========================================================
   ELEMENTS
   ========================================================= */

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


/* =========================================================
   TIMES
   ========================================================= */

function makeTimes() {

    if (!timeSelect) return;

    timeSelect.innerHTML =
        '<option value="">Seleccioná una hora</option>';

    if (
        !dateSelect?.value ||
        !appConfig
    ) {
        return;
    }

    /*
     * Sacamos el día sin depender de timezone
     * local del navegador.
     *
     * 0 domingo
     * 1 lunes
     * ...
     * 6 sábado
     */
    const [year, month, dayNumber] =
        dateSelect.value
            .split('-')
            .map(Number);

    const day =
        new Date(
            Date.UTC(
                year,
                month - 1,
                dayNumber,
                12
            )
        ).getUTCDay();

    const hoursConfig =
        appConfig.hours?.[day] ??
        appConfig.hours?.[String(day)];

    /*
     * Día cerrado.
     */
    if (
        !hoursConfig ||
        !Array.isArray(hoursConfig)
    ) {
        timeSelect.innerHTML =
            '<option value="">Cerrado este día</option>';

        return;
    }

    const open =
        toMinutes(hoursConfig[0]);

    const close =
        toMinutes(hoursConfig[1]);

    /*
     * IMPORTANTE:
     * Las reservas son solamente en horas exactas.
     *
     * Antes estaba:
     *
     * m += 30
     *
     * Eso permitía 2:30, 3:30, etc.
     */
    for (
        let m = open;
        m < close;
        m += 60
    ) {

        const hh =
            Math.floor(m / 60);

        const mm =
            m % 60;

        const value =
            `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

        const label =
            formatTime(
                hh,
                mm
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
    makeTimes();
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
let loginRequiredShown = false;


function createLoginRequiredModal() {

    if (
        document.getElementById(
            'loginRequiredModal'
        )
    ) {
        return;
    }


    document.body.insertAdjacentHTML(
        'beforeend',
        `
        <div
            class="reservation-login-required"
            id="loginRequiredModal"
            aria-hidden="true"
        >
            <div
                class="reservation-login-backdrop"
            ></div>

            <div
                class="reservation-login-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="reservationLoginTitle"
            >

                <span class="reservation-login-eyebrow">
                    SIMULADORES INERCIA
                </span>

                <h2 id="reservationLoginTitle">
                    INICIÁ SESIÓN
                    <span>PARA RESERVAR</span>
                </h2>

                <p>
                    Para consultar disponibilidad y crear una
                    reserva necesitás iniciar sesión primero.
                </p>

                <button
                    type="button"
                    class="reservation-login-primary"
                    id="reservationLoginBtn"
                >
                    INICIAR SESIÓN
                </button>

                <a
                    href="/"
                    class="reservation-login-back"
                >
                    VOLVER AL INICIO
                </a>

            </div>
        </div>
        `
    );


    const modal =
        document.getElementById(
            'loginRequiredModal'
        );


    const loginButton =
        document.getElementById(
            'reservationLoginBtn'
        );


    loginButton?.addEventListener(
        'click',
        () => {

            closeLoginRequiredModal();


            /*
             * Abrimos el sistema de autenticación
             * que ya tiene la página.
             */

            const authButton =
                document.getElementById(
                    'authBtn'
                );


            if (authButton) {

                authButton.click();

                return;
            }


            /*
             * Fallback por si el auth button
             * no existe por alguna razón.
             */

            const authModal =
                document.getElementById(
                    'authModal'
                );


            if (authModal) {

                authModal.inert =
                    false;

                authModal.setAttribute(
                    'aria-hidden',
                    'false'
                );

                authModal.classList.add(
                    'open'
                );


                document.body.classList.add(
                    'auth-modal-open'
                );
            }
        }
    );


    modal
        ?.querySelector(
            '.reservation-login-backdrop'
        )
        ?.addEventListener(
            'click',
            closeLoginRequiredModal
        );
}


function openLoginRequiredModal() {

    createLoginRequiredModal();


    const modal =
        document.getElementById(
            'loginRequiredModal'
        );


    if (!modal) {
        return;
    }


    modal.classList.add(
        'open'
    );


    modal.setAttribute(
        'aria-hidden',
        'false'
    );


    modal.inert =
        false;


    document.body.classList.add(
        'reservation-login-modal-open'
    );


    requestAnimationFrame(
        () => {

            document
                .getElementById(
                    'reservationLoginBtn'
                )
                ?.focus();
        }
    );
}


function closeLoginRequiredModal() {

    const modal =
        document.getElementById(
            'loginRequiredModal'
        );


    if (!modal) {
        return;
    }


    if (
        modal.contains(
            document.activeElement
        )
    ) {

        document.activeElement
            ?.blur();
    }


    modal.classList.remove(
        'open'
    );


    modal.setAttribute(
        'aria-hidden',
        'true'
    );


    modal.inert =
        true;


    document.body.classList.remove(
        'reservation-login-modal-open'
    );
}
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


            /*
             * Si inició sesión mientras el aviso
             * estaba abierto, lo cerramos.
             */

            closeLoginRequiredModal();


            await profile(
                user
            );


            await loadPaymentAccess();


            message(
                ''
            );


        } else {

            console.log(
                '[RESERVAS] Usuario no autenticado.'
            );


            currentProfile =
                null;


            /*
             * Mostrar solamente una vez por
             * carga de página.
             */

            if (
                !loginRequiredShown
            ) {

                loginRequiredShown =
                    true;


                /*
                 * Pequeño delay para que la página
                 * termine de cargar visualmente.
                 */

                setTimeout(
                    () => {

                        openLoginRequiredModal();

                    },
                    350
                );
            }
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
                'El pago con tarjeta/PayPal todavía no está disponible.',
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
                    $('paymentProof');

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

            message(
                `Reserva ${code} creada. Estado: PENDIENTE. Total: ${money(total)}.`,
                'success'
            );

            selected.clear();

            /*
             * Volvemos a consultar disponibilidad
             * porque esta reserva pending ya debe
             * bloquear esos rigs.
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