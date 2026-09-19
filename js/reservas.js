/*
 * js/reservas.js
 *
 * The main booking page controller for reservas.html. This is the
 * largest and most stateful frontend file in the project (~3500 lines),
 * driving the whole "pick a date/time/duration -> pick simulators ->
 * pick a payment method -> submit" flow. js/paypal-checkout.js handles
 * only the PayPal-specific button/checkout UI; everything else about the
 * booking form lives here.
 *
 * Rough map (search for the ALL-CAPS section banners below to jump
 * around; they already exist in the file, this is just an index):
 *   HELPERS              money()/setValue()/setText() formatting utils.
 *   ELEMENTS             Cached references to the form's DOM nodes.
 *   STATE                In-memory state: selected rigs, current profile,
 *                        current payment-access flags, etc.
 *   API                  api() - authenticated fetch() wrapper, same
 *                        pattern as js/paypal-checkout.js's api().
 *   MESSAGE / MODAL DE ÉXITO / MODAL DE "INICIÁ SESIÓN"
 *                        Inline status text + two custom modals (success,
 *                        and "you must log in") used instead of
 *                        window.alert()/confirm() for a consistent UI.
 *   CALENDAR + CLOCK / TIME HELPERS / DURATIONS
 *                        Step 01's date and hour pickers: a calendar grid
 *                        (dateSelect) and a circular clock face
 *                        (timeSelect) — both are now hidden <input>s that
 *                        these widgets keep in sync (.value + a dispatched
 *                        'change' event), so every other function that
 *                        reads/listens to them still works unchanged. All
 *                        the data both need — which dates are open and
 *                        which hours on the selected date are still
 *                        bookable — comes from one loadCalendar() call to
 *                        GET /api/reservations/calendar (see
 *                        api/reservations/calendar.js), computed there
 *                        from the same booking rules as
 *                        api/_lib/reservations.js so the UI never offers a
 *                        slot the API would reject anyway. Re-picking a
 *                        date/hour afterward is a pure client-side
 *                        re-render, no extra request.
 *   CONFIG               loadConfig() - fetches
 *                        /api/reservations/config on page load.
 *   SIMULATOR CARD / RENDER RIGS / AVAILABILITY
 *                        Renders the rig picker and checks
 *                        /api/reservations/availability whenever the
 *                        date/time/duration changes, to grey out rigs
 *                        that are already booked.
 *   LOCAL PRICE PREVIEW / SUMMARY
 *                        Client-side price estimate shown before
 *                        submitting (for UX only — the server always
 *                        recomputes the authoritative price; see
 *                        priceReservation() in api/_lib/reservations.js).
 *   USER PROFILE / AUTH  Loads the signed-in user's Firestore profile
 *                        (name/email/phone) and reacts to login/logout.
 *   DATE CHANGE / TIME CHANGE / DURATION CHANGE
 *                        Re-run availability/pricing when those fields change.
 *   PAYMENT METHOD       Toggles the transfer-proof upload block, and
 *                        updatePaymentAccess() enables/disables the
 *                        "efectivo" (pay-in-cash) option based on
 *                        paymentAccess.efectivo (an active-membership
 *                        flag). NOTE: as of this writing,
 *                        api/reservations/create.js's server-side
 *                        `METHODS` set only accepts 'transferencia' — the
 *                        'efectivo' option's actual booking submission
 *                        path (if any) is not in api/reservations/create.js,
 *                        so double-check the current server-side support
 *                        before assuming "efectivo" fully works end to end.
 *                        'paypal' is handled entirely separately via
 *                        js/paypal-checkout.js and api/paypal/*.js.
 *   (unlabeled form submit handler, ~line 2862 onward)
 *                        The "transferencia" submit flow: uploads the
 *                        proof file to Firebase Storage (see USER,
 *                        DATE/TIME, RIG, PAYMENT, CUSTOMER, REQUEST BODY,
 *                        CREATE, SUCCESS sub-sections), then POSTs to
 *                        /api/reservations/create.
 *   INITIALIZE           init() - kicks everything off on page load.
 */

import { auth, db } from '../firebase-config.js';

import { normalizePhone } from '../lib/phone.js';

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


const storage =
    getStorage(auth.app);


const $ =
    (id) =>
        document.getElementById(id);


/* =========================================================
   HELPERS
   ========================================================= */

function money(value) {
    return `L ${Number(value || 0).toLocaleString(
        'es-HN',
        {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }
    )}`;
}


function setValue(
    id,
    value = ''
) {
    const element =
        $(id);

    if (!element) {
        console.warn(
            `[RESERVAS] No existe el elemento #${id}`
        );

        return;
    }

    element.value =
        value ?? '';
}


function setText(
    id,
    value = ''
) {
    const element =
        $(id);

    if (!element) {
        return;
    }

    element.textContent =
        value;
}


/* =========================================================
   ELEMENTS
   ========================================================= */

const form =
    $('reservationForm');

const dateSelect =
    $('reservationDate');

const timeSelect =
    $('reservationTime');

const durationSelect =
    $('reservationDuration');

const submitButton =
    $('reservationSubmit');


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

let currentProfile =
    null;

let promos =
    [];

/*
 * Payload from GET /api/reservations/calendar — one row per date in the
 * booking window, each with the full list of hourly start times and
 * whether they're bookable. Fetched once (on load, and again whenever
 * duration changes); clicking a different date or hour afterward is a pure
 * re-render from this, no extra request.
 */
let calendarData =
    null;

let loadingAvailability =
    false;
let paymentAccess = {
    transferencia: true,
    paypal: true,
    efectivo: false
};


let loginRequiredShown =
    false;


const wheel =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';


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


    /*
     * Firebase ID Token.
     */

    if (currentUser) {

        const token =
            await currentUser
                .getIdToken();


        headers.Authorization =
            `Bearer ${token}`;
    }


    /*
     * Solo ponemos JSON cuando el body
     * no es FormData.
     */

    if (
        options.body &&
        !(options.body instanceof FormData)
    ) {

        headers[
            'Content-Type'
        ] =
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


    let data =
        {};


    try {

        data =
            await response.json();

    } catch {

        data =
            {};
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

   IMPORTANTE:

   Además de escribir el mensaje en el panel de la página,
   ahora TAMBIÉN disparamos un alert() nativo para errores
   y éxito, de forma segura (nunca puede romper el flujo).
   ========================================================= */

function message(
    text,
    type = 'info'
) {

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
   MODAL DE ÉXITO (REEMPLAZA window.alert)

   window.alert() puede ser silenciado por el navegador SIN
   lanzar ninguna excepción (por ejemplo cuando el usuario
   tilda "Evitar que este sitio cree más cuadros de diálogo",
   o dentro de ciertos iframes/webviews). En esos casos no hay
   forma de detectarlo desde JS: el código sigue corriendo
   normal, simplemente no aparece nada en pantalla.

   Por eso dejamos de depender de window.alert() y mostramos
   un modal propio (un <div> que nosotros controlamos). Esto
   SIEMPRE se ve, sin importar configuración del navegador.
   ========================================================= */

function safeAlert(
    text,
    onClose
) {

    let closed =
        false;


    const runOnClose =
        () => {

            if (closed) {
                return;
            }


            closed =
                true;


            if (
                typeof onClose ===
                'function'
            ) {

                try {

                    onClose();

                } catch (
                    error
                ) {

                    console.error(
                        '[RESERVAS] Error en onClose del modal:',
                        error
                    );
                }
            }
        };


    try {

        const existing =
            document.getElementById(
                'inercia-success-modal'
            );


        if (existing) {

            existing.remove();
        }


        const overlay =
            document.createElement(
                'div'
            );


        overlay.id =
            'inercia-success-modal';


        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            z-index: 999999;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        `;


        const box =
            document.createElement(
                'div'
            );


        box.style.cssText = `
            background: #ffffff;
            color: #111111;
            border-radius: 12px;
            padding: 24px;
            max-width: 420px;
            width: 100%;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 15px;
            line-height: 1.5;
            white-space: pre-line;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.35);
        `;


        box.textContent =
            text;


        const button =
            document.createElement(
                'button'
            );


        button.type =
            'button';


        button.textContent =
            'Aceptar';


        button.style.cssText = `
            margin-top: 20px;
            padding: 12px 20px;
            border: none;
            border-radius: 8px;
            background: #111111;
            color: #ffffff;
            font-weight: 600;
            font-size: 15px;
            cursor: pointer;
            width: 100%;
        `;


        const closeModal =
            () => {

                overlay.remove();


                clearTimeout(
                    fallbackTimer
                );


                runOnClose();
            };


        button.addEventListener(
            'click',
            closeModal
        );


        overlay.addEventListener(
            'click',
            (
                event
            ) => {

                if (
                    event.target ===
                    overlay
                ) {

                    closeModal();
                }
            }
        );


        box.appendChild(
            button
        );


        overlay.appendChild(
            box
        );


        document.body.appendChild(
            overlay
        );


        /*
         * Respaldo: si nadie toca el botón,
         * igual queremos que onClose corra
         * tarde o temprano.
         */

        const fallbackTimer =
            setTimeout(
                () => {

                    overlay.remove();


                    runOnClose();
                },
                8000
            );


    } catch (
        error
    ) {

        console.error(
            '[RESERVAS] No se pudo mostrar el modal de éxito:',
            error
        );


        /*
         * Último recurso.
         */

        try {

            window.alert(
                text
            );

        } catch {

            /*
             * Si ni esto funciona, ya quedó
             * el mensaje visible vía message().
             */
        }


        runOnClose();
    }
}


/* =========================================================
   MODAL DE "INICIÁ SESIÓN"

   Se muestra cuando un usuario sin sesión intenta
   reservar. Antes esta función no existía en este
   archivo (se perdió en un revert), por eso el flujo
   de "iniciá sesión" no aparecía nunca.
   ========================================================= */

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


/* =========================================================
   CALENDAR + CLOCK (step 01)

   dateSelect/timeSelect are now hidden inputs, not <select>s — the
   calendar and clock below are custom widgets that just keep those two
   inputs' .value in sync and dispatch a real 'change' event on them,
   so every other function in this file that reads dateSelect.value /
   timeSelect.value or listens for their 'change' event (loadConfig(),
   makeTimes()'s old caller, availability(), summary(), ...) keeps
   working completely unchanged.

   All the data both widgets need — which dates are open at all, and
   which specific hours on the selected date are still bookable — comes
   from ONE call to /api/reservations/calendar (see loadCalendar()
   below), instead of the old approach of assuming fixed hours/days
   client-side and then querying /api/reservations/availability once per
   candidate hour.
   ========================================================= */

const calendarWidget =
    document.getElementById(
        'calendarWidget'
    );

const clockFace =
    document.getElementById(
        'clockFace'
    );

const clockReadoutTime =
    document.getElementById(
        'clockReadoutTime'
    );

const clockReadoutHint =
    document.getElementById(
        'clockReadoutHint'
    );


function setHiddenValue(
    input,
    value
) {

    if (!input) {
        return;
    }

    input.value =
        value;

    input.dispatchEvent(
        new Event(
            'change',
            { bubbles: true }
        )
    );
}


async function loadCalendar() {

    if (!calendarWidget) {
        return;
    }

    const duration =
        durationSelect?.value ||
        1;

    try {

        calendarData =
            await api(
                `/api/reservations/calendar?duration=${encodeURIComponent(
                    duration
                )}`
            );

    } catch (
        error
    ) {

        console.error(
            '[RESERVAS] Error cargando calendario:',
            error
        );

        calendarWidget.innerHTML =
            '<p class="picker-loading">No se pudo cargar el calendario.</p>';

        return;
    }

    renderCalendar();


    /*
     * La duración pudo cambiar la disponibilidad
     * de la fecha/hora ya elegidas — si esa hora
     * ya no está disponible, se limpia.
     */

    const currentDay =
        calendarData.days.find(
            (
                day
            ) =>
                day.date ===
                dateSelect?.value
        );

    if (
        !currentDay ||
        currentDay.status !==
            'available'
    ) {

        setHiddenValue(
            dateSelect,
            ''
        );
    }

    makeTimes();
}


function calendarDayLabel(
    day,
    index
) {

    if (index === 0) {
        return 'HOY';
    }

    if (index === 1) {
        return 'MAÑANA';
    }

    const [
        year,
        month,
        dayNumber
    ] =
        day.date
            .split('-')
            .map(Number);

    const asDate =
        new Date(
            Date.UTC(
                year,
                month - 1,
                dayNumber,
                12
            )
        );

    return new Intl.DateTimeFormat(
        'es-HN',
        { weekday: 'short', timeZone: 'UTC' }
    )
        .format(asDate)
        .replace('.', '')
        .toUpperCase();
}


function renderCalendar() {

    if (
        !calendarWidget ||
        !calendarData
    ) {
        return;
    }

    calendarWidget.innerHTML =
        '';

    calendarData.days.forEach(
        (
            day,
            index
        ) => {

            const [
                ,
                ,
                dayNumber
            ] =
                day.date
                    .split('-');

            const button =
                document.createElement(
                    'button'
                );

            button.type =
                'button';

            button.className =
                'calendar-day';

            button.dataset.date =
                day.date;

            button.setAttribute(
                'role',
                'option'
            );

            const isAvailable =
                day.status ===
                'available';

            if (!isAvailable) {

                button.classList.add(
                    'unavailable'
                );

                button.disabled =
                    true;

                button.title =
                    day.status ===
                    'closed'
                        ? 'Cerrado este día'
                        : 'Sin horarios disponibles';
            }

            if (
                day.date ===
                dateSelect?.value
            ) {

                button.classList.add(
                    'selected'
                );
            }

            button.innerHTML = `
                <span class="calendar-day-weekday">${calendarDayLabel(day, index)}</span>
                <span class="calendar-day-number">${Number(dayNumber)}</span>
                ${!isAvailable ? `<span class="calendar-day-tag">${day.status === 'closed' ? 'Cerrado' : 'Completo'}</span>` : ''}
            `;

            calendarWidget.appendChild(
                button
            );
        }
    );
}


calendarWidget
    ?.addEventListener(
        'click',

        (
            event
        ) => {

            const button =
                event.target.closest(
                    '.calendar-day'
                );

            if (
                !button ||
                button.disabled
            ) {
                return;
            }

            renderCalendar
                .lastSelected =
                button.dataset.date;

            setHiddenValue(
                dateSelect,
                button.dataset.date
            );

            renderCalendar();
        }
    );



/* =========================================================
   TIME HELPERS
   ========================================================= */

function formatTime(
    hours,
    minutes = 0
) {

    const date =
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
            hour:
                'numeric',

            minute:
                '2-digit'
        }
    )
        .format(date);
}
/* =========================================================
   CLOCK

   Renders the hour markers on the circular clock face from
   calendarData (see loadCalendar() above) — no network call here,
   this is a pure re-render for whichever date is currently selected.
   Hours the backend marked unavailable (already booked on every rig,
   or inside an admin lockdown) render disabled/greyed, matching the
   .simulator-card.unavailable treatment elsewhere on this page.
   ========================================================= */

function clockPosition(
    time
) {

    const hour =
        Number(
            time.split(':')[0]
        ) % 12;

    /*
     * 12 arriba, avanza en sentido horario cada 30°
     * (como un reloj analógico real).
     */

    const angleRad =
        (
            hour * 30 -
            90
        ) *
        (Math.PI / 180);

    const radius =
        37;

    return {
        left:
            50 +
            radius *
            Math.cos(
                angleRad
            ),

        top:
            50 +
            radius *
            Math.sin(
                angleRad
            )
    };
}


function updateClockReadout() {

    if (!clockReadoutTime) {
        return;
    }

    if (!timeSelect?.value) {

        clockReadoutTime.textContent =
            '--:--';

        clockReadoutHint.textContent =
            dateSelect?.value
                ? 'Elegí una hora'
                : 'Elegí una fecha';

        return;
    }

    const [
        hh,
        mm
    ] =
        timeSelect.value
            .split(':')
            .map(Number);

    clockReadoutTime.textContent =
        formatTime(
            hh,
            mm
        );

    clockReadoutHint.textContent =
        'Hora seleccionada';
}


function renderClock(
    hours
) {

    if (!clockFace) {
        return;
    }

    clockFace
        .querySelectorAll(
            '.clock-hour'
        )
        .forEach(
            (
                el
            ) =>
                el.remove()
        );

    hours.forEach(
        (
            hour
        ) => {

            const position =
                clockPosition(
                    hour.time
                );

            const button =
                document.createElement(
                    'button'
                );

            button.type =
                'button';

            button.className =
                'clock-hour';

            button.dataset.time =
                hour.time;

            button.style.left =
                `${position.left}%`;

            button.style.top =
                `${position.top}%`;

            button.setAttribute(
                'role',
                'option'
            );

            const [
                hh
            ] =
                hour.time
                    .split(':')
                    .map(Number);

            button.textContent =
                String(
                    hh % 12 ||
                    12
                );

            if (!hour.available) {

                button.classList.add(
                    'unavailable'
                );

                button.disabled =
                    true;

                button.title =
                    'Ya reservado';
            }

            if (
                hour.time ===
                timeSelect?.value
            ) {

                button.classList.add(
                    'selected'
                );
            }

            clockFace.appendChild(
                button
            );
        }
    );

    updateClockReadout();
}


clockFace
    ?.addEventListener(
        'click',

        (
            event
        ) => {

            const button =
                event.target.closest(
                    '.clock-hour'
                );

            if (
                !button ||
                button.disabled
            ) {
                return;
            }

            setHiddenValue(
                timeSelect,
                button.dataset.time
            );

            const day =
                calendarData?.days?.find(
                    (
                        d
                    ) =>
                        d.date ===
                        dateSelect?.value
                );

            if (day) {

                renderClock(
                    day.hours
                );
            }
        }
    );


/*
 * Re-render puro desde calendarData — no hace ningún
 * request. El fetch real pasa una sola vez en
 * loadCalendar(), disparado al cargar la página y
 * cuando cambia la duración.
 */

function makeTimes() {

    if (!clockFace) {
        return;
    }

    const day =
        calendarData?.days?.find(
            (
                d
            ) =>
                d.date ===
                dateSelect?.value
        );

    if (
        !dateSelect?.value ||
        !day
    ) {

        clockFace.classList.add(
            'is-empty'
        );

        clockFace
            .querySelectorAll(
                '.clock-hour'
            )
            .forEach(
                (
                    el
                ) =>
                    el.remove()
            );

        setHiddenValue(
            timeSelect,
            ''
        );

        updateClockReadout();

        return;
    }

    clockFace.classList.remove(
        'is-empty'
    );


    /*
     * Si la hora ya elegida dejó de estar
     * disponible (cambió la duración, o alguien
     * más reservó ese cupo), se limpia.
     */

    const stillAvailable =
        day.hours.some(
            (
                hour
            ) =>
                hour.time ===
                    timeSelect?.value &&
                hour.available
        );

    if (
        timeSelect?.value &&
        !stillAvailable
    ) {

        setHiddenValue(
            timeSelect,
            ''
        );
    }

    renderClock(
        day.hours
    );
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


    durationSelect.innerHTML =
        '';


    const min =
        Number(
            appConfig
                .minDurationHours
        ) || 1;


    const max =
        Number(
            appConfig
                .maxDurationHours
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

    const queryDate =
        dateSelect?.value;


    const endpoint =
        queryDate

            ? `/api/reservations/config?date=${encodeURIComponent(
                queryDate
            )}`

            : '/api/reservations/config';


    const data =
        await api(
            endpoint
        );


    if (!data?.config) {

        throw new Error(
            'El servidor no devolvió la configuración de reservas.'
        );
    }


    appConfig =
        data.config;


    rigs =
        Array.isArray(
            data.rigs
        )
            ? data.rigs
            : [];


    promos =
        Array.isArray(
            data.promotions
        )
            ? data.promotions
            : [];


    /*
     * Primero duración porque makeTimes()
     * necesita saber cuántas horas pidió.
     */

    makeDurations();


    /*
     * Ahora sí consultamos horarios reales.
     */

    await makeTimes();


    updatePrices();


    /*
     * Hasta que el usuario escoja una hora,
     * mostramos los rigs activos.
     */

    render(
        rigs.map(
            (
                rig
            ) => ({
                ...rig,
                available:
                    true
            })
        )
    );


    console.log(
        '[RESERVAS] Configuración cargada:',
        {
            config:
                appConfig,

            rigs:
                rigs.length,

            promotions:
                promos.length
        }
    );
}


function updatePrices() {

    const standard =
        document.querySelector(
            '[data-price="standard"]'
        );


    const premium =
        document.querySelector(
            '[data-price="premium"]'
        );
}


/* =========================================================
   SIMULATOR CARD
   ========================================================= */

function card(
    rig
) {

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
        selected.has(
            rig.id
        ) &&
        rig.available
    ) {

        button.classList.add(
            'selected'
        );
    }


    button.addEventListener(
        'click',
        () => {

            if (
                !rig.available
            ) {

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

function render(
    list = []
) {

    const safeList =
        Array.isArray(
            list
        )
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


        grid.innerHTML =
            '';


        const typeRigs =
            safeList.filter(
                (
                    rig
                ) =>
                    rig.type ===
                    type
            );


        typeRigs.forEach(
            (
                rig
            ) => {

                grid.appendChild(
                    card(
                        rig
                    )
                );
            }
        );


        const available =
            typeRigs.filter(
                (
                    rig
                ) =>
                    rig.available
            ).length;


        if (
            counts[type]
        ) {

            counts[type]
                .textContent =
                `${available} DISPONIBLES`;
        }
    }


    setText(
        'availableCount',

        safeList.filter(
            (
                rig
            ) =>
                rig.available
        ).length
    );


    summary();
}


/* =========================================================
   AVAILABILITY
   ========================================================= */

async function availability() {

    if (
        loadingAvailability
    ) {

        return;
    }


    selected.clear();


    /*
     * Todavía falta fecha/hora/duración.
     */

    if (
        !dateSelect?.value ||
        !timeSelect?.value ||
        !durationSelect?.value
    ) {

        render(
            rigs.map(
                (
                    rig
                ) => ({
                    ...rig,
                    available:
                        true
                })
            )
        );


        return;
    }


    loadingAvailability =
        true;


    try {

        message(
            ''
        );


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
            Array.isArray(
                data.rigs
            )
                ? data.rigs
                : []
        );


    } catch (
        error
    ) {

        console.error(
            '[RESERVAS] Error de disponibilidad:',
            error
        );


        message(
            error.message,
            'error'
        );


        /*
         * Si falla backend no permitimos
         * seleccionar rigs.
         */

        render(
            rigs.map(
                (
                    rig
                ) => ({
                    ...rig,
                    available:
                        false
                })
            )
        );


    } finally {

        loadingAvailability =
            false;


        summary();
    }
}
function getTuesdayDiscount() {
    if (!dateSelect?.value) {
        return 0;
    }

    const [year, month, day] =
        dateSelect.value
            .split('-')
            .map(Number);

    const selectedDate =
        new Date(year, month - 1, day);

    // 2 = martes
    return selectedDate.getDay() === 2
        ? 0.50
        : 0;
}

/* =========================================================
   LOCAL PRICE PREVIEW
   ========================================================= */

function localPrice() {

    const hours =
        Number(
            durationSelect?.value ||
            1
        );


    let base =
        0;


    for (
        const rig
        of selected.values()
    ) {

        const price =
            Number(
                appConfig
                    ?.prices
                    ?.[rig.type]
            ) || 0;


        base +=
            price *
            hours;
    }


    let discount =
        0;


    /*
     * PROMOCIONES EXISTENTES
     */

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


    /*
     * EMERGENCY PATCH
     * TODOS LOS MARTES = 50% OFF
     */

    if (
        dateSelect?.value
    ) {

        const [
            year,
            month,
            day
        ] =
            dateSelect.value
                .split('-')
                .map(Number);


        const selectedDate =
            new Date(
                year,
                month - 1,
                day
            );


        /*
         * 0 domingo
         * 1 lunes
         * 2 martes
         */

        if (
            selectedDate.getDay() === 2
        ) {

            /*
             * Si ya existe una promo del 50%
             * para martes en Firebase, NO la duplicamos.
             */

            const alreadyHasTuesday50 =
                promos.some(
                    promo =>
                        promo.type === 'percent' &&
                        Number(promo.value) === 50
                );


            if (
                !alreadyHasTuesday50
            ) {

                discount +=
                    base * 0.50;
            }
        }
    }


    /*
     * Nunca permitir descuento mayor al total.
     */

    discount =
        Math.min(
            base,
            discount
        );


    return Math.max(
        0,
        base -
        discount
    );
}

/* =========================================================
   SUMMARY
   ========================================================= */

function summary() {

    const values =
        [
            ...selected.values()
        ];


    const standard =
        values.filter(
            (
                rig
            ) =>
                rig.type ===
                'standard'
        ).length;


    const premium =
        values.filter(
            (
                rig
            ) =>
                rig.type ===
                'premium'
        ).length;


    const hours =
        Number(
            durationSelect?.value ||
            1
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
    `${money(localPrice())} + ISV`
);

    if (
        submitButton
    ) {

        /*
         * FIX:
         *
         * Antes el botón quedaba disabled cuando
         * !currentUser, y un <button disabled> NUNCA
         * dispara el evento "submit" del formulario.
         *
         * Eso significaba que un usuario sin sesión
         * no podía ni siquiera hacer click para
         * enterarse de que necesitaba loguearse: el
         * navegador ignoraba el click por completo.
         *
         * Ahora: si NO hay sesión, el botón se queda
         * habilitado (para que el submit handler pueda
         * atraparlo y mostrar el modal de login). Si SÍ
         * hay sesión, aplicamos las validaciones de
         * siempre (fecha, hora, duración, rig, etc).
         */

        submitButton.disabled =
            !currentUser

                ? false

                : !(
                    dateSelect
                        ?.value &&

                    timeSelect
                        ?.value &&

                    durationSelect
                        ?.value &&

                    selected.size >
                    0 &&

                    !loadingAvailability
                );
    }
}

async function loadPaymentAccess() {


    paymentAccess.transferencia =
        true;

    paymentAccess.paypal =
        true;

    paymentAccess.efectivo =
        false;


    if (!currentUser) {

        updatePaymentAccess();

        return;
    }


    try {

        const data =
            await api(
                '/api/subscription/status'
            );


        paymentAccess.efectivo =
            data?.active === true;


    } catch (error) {

        console.error(
            '[RESERVAS] No se pudo verificar membresía:',
            error
        );

        paymentAccess.efectivo =
            false;
    }


    updatePaymentAccess();
}
/* =========================================================
   USER PROFILE
   ========================================================= */

async function profile(
    user
) {

    if (!user) {

        currentProfile =
            null;


        return;
    }


    try {

        const snapshot =
            await getDoc(
                doc(
                    db,
                    'users',
                    user.uid
                )
            );


        const firestoreProfile =
            snapshot.exists()
                ? snapshot.data()
                : {};


        currentProfile = {

            name:
                firestoreProfile
                    .name ||

                user.displayName ||

                '',


            email:
                firestoreProfile
                    .email ||

                user.email ||

                '',


            phoneNumber:
                normalizePhone(
                    firestoreProfile
                        .phone ||

                    firestoreProfile
                        .phoneNumber ||

                    ''
                )
        };


        console.log(
            '[RESERVAS] Perfil cargado:',
            {
                name:
                    currentProfile.name,

                email:
                    currentProfile.email,

                phoneNumber:
                    currentProfile
                        .phoneNumber
                        ? 'CARGADO'
                        : 'NO DISPONIBLE'
            }
        );


    } catch (
        error
    ) {

        console.error(
            '[RESERVAS] No se pudo cargar el perfil:',
            error
        );


        currentProfile = {

            name:
                user.displayName ||
                '',


            email:
                user.email ||
                '',


            phoneNumber:
                ''
        };
    }
}


/* =========================================================
   AUTH
   ========================================================= */

onAuthStateChanged(
    auth,

    async (
        user
    ) => {

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


            message(
                ''
            );


            /*
             * Si el modal de "iniciá sesión" estaba
             * abierto (porque el usuario intentó
             * reservar sin sesión), lo cerramos ahora
             * que ya inició sesión.
             */

            closeLoginRequiredModal();


            loginRequiredShown =
                false;


            /*
             * Revisamos el acceso a "efectivo"
             * (depende de si tiene membresía activa).
             */

            await loadPaymentAccess();


        } else {

            console.log(
                '[RESERVAS] Usuario no autenticado.'
            );


            currentProfile =
                null;


            message(
                'Iniciá sesión para hacer una reserva.',
                'error'
            );


            updatePaymentAccess();


            /*
             * FIX: mostrar el modal de "iniciá sesión"
             * INMEDIATAMENTE al detectar que no hay
             * sesión, sin esperar a que el usuario
             * intente enviar el formulario.
             *
             * Solo lo mostramos una vez por carga de
             * página (loginRequiredShown) para no
             * volver a abrirlo si Firebase dispara este
             * callback más de una vez mientras se
             * confirma que no hay sesión.
             */

            if (
                !loginRequiredShown
            ) {

                loginRequiredShown =
                    true;


                openLoginRequiredModal();
            }
        }


        summary();
    }
);


/* =========================================================
   DATE CHANGE
   ========================================================= */

dateSelect
    ?.addEventListener(
        'change',

        async () => {

            selected.clear();


            /*
             * loadConfig carga promociones,
             * config y vuelve a crear horas.
             */

            try {

                await loadConfig();


                summary();


            } catch (
                error
            ) {

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

timeSelect
    ?.addEventListener(
        'change',

        async () => {

            selected.clear();


            /*
             * Volvió a "Seleccioná una hora".
             */

            if (
                !timeSelect.value
            ) {

                render(
                    rigs.map(
                        (
                            rig
                        ) => ({
                            ...rig,
                            available:
                                true
                        })
                    )
                );


                summary();


                return;
            }


            /*
             * Ahora mostramos exactamente
             * qué rigs quedan disponibles.
             */

            await availability();
        }
    );


/* =========================================================
   DURATION CHANGE
   ========================================================= */

durationSelect
    ?.addEventListener(
        'change',

        async () => {

            selected.clear();


            /*
             * IMPORTANTE:
             *
             * Una hora puede servir para
             * una reserva de 1 hora pero
             * no para una de 3 horas, y un
             * día completo para 1 hora puede
             * no tener espacio para 3 —
             * por eso recargamos el calendario
             * entero, no solo el reloj.
             */

            await loadCalendar();


            /*
             * Como loadCalendar/makeTimes dejan
             * la hora sin seleccionar, mostramos
             * todos los rigs hasta escoger otra hora.
             */

            render(
                rigs.map(
                    (
                        rig
                    ) => ({
                        ...rig,
                        available:
                            true
                    })
                )
            );


            summary();
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
        (
            input
        ) => {

            input.addEventListener(
                'change',

                () => {

                    const proofBlock =
                        $('proofBlock');


                    if (
                        !proofBlock
                    ) {

                        return;
                    }


                    const payment =
                        document.querySelector(
                            'input[name="payment"]:checked'
                        )?.value;
if (
    payment === 'efectivo' &&
    paymentAccess.efectivo !== true
) {

    message(
        'El pago en efectivo está disponible únicamente para miembros con una suscripción activa.',
        'error'
    );

    return;
}

                    proofBlock.hidden =
                        payment !==
                        'transferencia';
                }
            );
        }
    );

function updatePaymentAccess() {

    const cashOption =
        document.getElementById(
            'cashPaymentOption'
        );

    const cashInput =
        document.getElementById(
            'cashPaymentInput'
        );


    if (
        !cashOption ||
        !cashInput
    ) {
        return;
    }


    const cashEnabled =
        paymentAccess.efectivo ===
        true;


    cashInput.disabled =
        !cashEnabled;


    cashOption.classList.toggle(
        'payment-option-disabled',
        !cashEnabled
    );


    cashOption.setAttribute(
        'aria-disabled',
        String(
            !cashEnabled
        )
    );


    const badge =
        cashOption.querySelector(
            '.payment-coming-soon'
        );


    const description =
        cashOption.querySelector(
            'small'
        );


    if (cashEnabled) {

        if (badge) {
            badge.hidden = true;
        }


        if (description) {

            description.textContent =
                'Pagá al llegar a Inercia';
        }

    } else {

        if (badge) {
            badge.hidden = false;
        }


        if (description) {

            description.textContent =
                'Disponible con membresía';
        }
    }
}

form
    ?.addEventListener(
        'submit',

        async (
            event
        ) => {

            event.preventDefault();


            /* =====================================================
               USER

               FIX: si no hay sesión iniciada, además del
               mensaje inline, mostramos el modal de
               "iniciá sesión" (createLoginRequiredModal /
               openLoginRequiredModal), que se había perdido
               en un revert anterior.
               ===================================================== */

            if (
                !currentUser
            ) {

                message(
                    'Iniciá sesión para continuar.',
                    'error'
                );


                openLoginRequiredModal();


                return;
            }


            /* =====================================================
               DATE / TIME
               ===================================================== */

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


            /* =====================================================
               RIG
               ===================================================== */

            if (
                selected.size ===
                0
            ) {

                message(
                    'Seleccioná al menos un simulador.',
                    'error'
                );


                return;
            }


            /* =====================================================
               PAYMENT
               ===================================================== */

            const payment =
                document.querySelector(
                    'input[name="payment"]:checked'
                )?.value;


            if (
                !payment
            ) {

                message(
                    'Seleccioná un método de pago.',
                    'error'
                );


                return;
            }


            /*
             * PayPal utiliza su propio botón.
             */

            if (
                payment ===
                'paypal'
            ) {

                message(
                    'Para pagar con PayPal, usá el botón de PayPal que aparece en Método de pago.',
                    'error'
                );


                return;
            }


            if (
                submitButton
            ) {

                submitButton.disabled =
                    true;
            }


            message(
                'Procesando reserva…'
            );


            /*
             * Guardamos el resultado de la reserva
             * (si se creó) FUERA del try/catch de
             * arriba para que un fallo del alert()
             * jamás pueda pisar el flujo de éxito.
             */

            let reservationSucceeded =
                false;


            let successMessage =
                '';


            try {

                let proofPath =
                    null;


                if (
                    payment ===
                    'transferencia'
                ) {

                    const proofInput =
                        $('paymentReceipt');


                    if (
                        !proofInput
                    ) {

                        throw new Error(
                            'No se encontró el campo para subir el comprobante.'
                        );
                    }


                    const file =
                        proofInput
                            .files?.[0];


                    if (
                        !file
                    ) {

                        throw new Error(
                            'Subí el comprobante de transferencia.'
                        );
                    }


                    if (
                        file.size >
                        5 *
                        1024 *
                        1024
                    ) {

                        throw new Error(
                            'El comprobante no puede pesar más de 5 MB.'
                        );
                    }


                    const allowedTypes = [
                        'image/jpeg',
                        'image/png',
                        'application/pdf'
                    ];


                    if (
                        !allowedTypes
                            .includes(
                                file.type
                            )
                    ) {

                        throw new Error(
                            'El comprobante debe ser JPG, PNG o PDF.'
                        );
                    }


                    const safeName =
                        file.name
                            .replace(
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
                   CUSTOMER
                   ================================================= */

                if (
                    !currentProfile
                ) {

                    throw new Error(
                        'No se pudieron cargar los datos de tu cuenta.'
                    );
                }


                if (
                    !currentProfile.name
                ) {

                    throw new Error(
                        'Tu cuenta no tiene un nombre registrado.'
                    );
                }


                if (
                    !currentProfile.email
                ) {

                    throw new Error(
                        'Tu cuenta no tiene un correo registrado.'
                    );
                }


                if (
                    !currentProfile
                        .phoneNumber
                ) {

                    throw new Error(
                        'Tu cuenta no tiene un número de teléfono registrado.'
                    );
                }


                const customer = {

                    name:
                        currentProfile
                            .name,


                    email:
                        currentProfile
                            .email,


                    phoneNumber:
                        currentProfile
                            .phoneNumber
                };


                /* =================================================
                   REQUEST BODY
                   ================================================= */

                const body = {

                    date:
                        dateSelect
                            .value,


                    time:
                        timeSelect
                            .value,


                    duration:
                        Number(
                            durationSelect
                                .value
                        ),


                    rigIds:
                        [
                            ...selected.keys()
                        ],


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


                /* =================================================
                   CREATE
                   ================================================= */

                const response =
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

                const code =
                    response.code ||

                    response
                        .reservationCode ||

                    'CREADA';


                const total =
                    response
                        .pricing
                        ?.total ??

                    response
                        .total ??

                    localPrice();


                successMessage =
    payment === 'transferencia'
        ? (
            `Reserva ${code} creada correctamente.\n\n` +
            `Estado: PENDIENTE\n` +
            `Total: ${money(total)} + ISV\n\n` +
            `Te notificaremos por WhatsApp cuando sea aprobada.`
        )
        : (
            `Reserva ${code} creada y pagada correctamente.\n\n` +
            `Estado: APROBADA\n` +
            `Total: ${money(total)} + ISV\n\n` +
            `Recibirás tu confirmación por WhatsApp.`
        );


                reservationSucceeded =
                    true;


            } catch (
                error
            ) {

                console.error(
                    '[RESERVAS] Error creando reserva:',
                    error
                );


                message(
                    error.message ||

                    'No se pudo crear la reserva.',

                    'error'
                );


            }


            if (
                reservationSucceeded
            ) {


                message(
                    successMessage,
                    'success'
                );


                /*
                 * ALERT NATIVO (a prueba de fallos).
                 */

                safeAlert(
                    successMessage
                );


                selected.clear();


                /*
                 * Refrescar las horas después
                 * de reservar.
                 *
                 * Esto hace que, si esa reserva
                 * agotó completamente una hora,
                 * desaparezca inmediatamente
                 * del dropdown.
                 */

                try {

                    await makeTimes();


                    /*
                     * Limpiar selección de rigs.
                     */

                    render(
                        rigs.map(
                            (
                                rig
                            ) => ({
                                ...rig,

                                available:
                                    true
                            })
                        )
                    );

                } catch (
                    refreshError
                ) {

                    /*
                     * Si el refresco post-reserva falla,
                     * no queremos que parezca que la
                     * reserva falló: solo lo logueamos.
                     */

                    console.error(
                        '[RESERVAS] Error refrescando horarios post-reserva:',
                        refreshError
                    );
                }
            }


            summary();
        }
    );


/* =========================================================
   INITIALIZE
   ========================================================= */

async function init() {

    console.log(
        '[RESERVAS] Inicializando...'
    );


    const requiredElements = {

        reservationForm:
            form,


        reservationDate:
            dateSelect,


        reservationTime:
            timeSelect,


        reservationDuration:
            durationSelect,


        standardGrid:
            grids.standard,


        premiumGrid:
            grids.premium
    };


    for (
        const [
            name,
            element
        ]
        of Object.entries(
            requiredElements
        )
    ) {

        if (
            !element
        ) {

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


    updatePaymentAccess();

    try {

        await loadConfig();

        await loadCalendar();


        console.log(
            '[RESERVAS] Inicialización completada.'
        );


    } catch (
        error
    ) {

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