/* =========================================================
   CONFIG
   ========================================================= */

const PRICES = {
    standard: 200,
    premium: 350
};


/*
 * Fallback mientras conectamos la disponibilidad
 * real con Firebase.
 */

const DEFAULT_INVENTORY = {
    standard: 8,
    premium: 2
};


/*
 * REEMPLAZÁ estas dos rutas con las imágenes de los
 * timones que querás utilizar.
 */

const STANDARD_WHEEL_IMAGE =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';

const PREMIUM_WHEEL_IMAGE =
    'https://firebasestorage.googleapis.com/v0/b/inerciaapp-e0cc4.firebasestorage.app/o/assets%2Ftimon.svg?alt=media&token=42e46a5a-59d8-450f-92df-104e7f891e49';

/* =========================================================
   ELEMENTS
   ========================================================= */

const reservationForm =
    document.getElementById('reservationForm');

const dateSelect =
    document.getElementById('reservationDate');

const timeSelect =
    document.getElementById('reservationTime');

const durationSelect =
    document.getElementById('reservationDuration');

const standardGrid =
    document.getElementById('standardGrid');

const premiumGrid =
    document.getElementById('premiumGrid');

const standardCount =
    document.getElementById('standardCount');

const premiumCount =
    document.getElementById('premiumCount');

const availableCount =
    document.getElementById('availableCount');

const summaryStandard =
    document.getElementById('summaryStandard');

const summaryPremium =
    document.getElementById('summaryPremium');

const summaryDuration =
    document.getElementById('summaryDuration');

const reservationTotal =
    document.getElementById('reservationTotal');

const reservationSubmit =
    document.getElementById('reservationSubmit');


/* =========================================================
   STATE
   ========================================================= */

let inventory = {
    ...DEFAULT_INVENTORY
};


const selected = {
    standard: new Set(),
    premium: new Set()
};


/* =========================================================
   DATES
   ========================================================= */

function createDateOptions() {

    if (!dateSelect) return;

    const formatter =
        new Intl.DateTimeFormat(
            'es-HN',
            {
                weekday: 'short',
                day: 'numeric',
                month: 'short'
            }
        );


    /*
     * Today + next 13 days.
     */

    for (let i = 0; i < 14; i++) {

        const date = new Date();

        date.setHours(
            12,
            0,
            0,
            0
        );

        date.setDate(
            date.getDate() + i
        );


        const value =
            [
                date.getFullYear(),
                String(
                    date.getMonth() + 1
                ).padStart(2, '0'),
                String(
                    date.getDate()
                ).padStart(2, '0')
            ].join('-');


        const option =
            document.createElement('option');


        option.value = value;


        let label =
            formatter.format(date);


        if (i === 0) {
            label =
                `Hoy · ${label}`;
        }

        if (i === 1) {
            label =
                `Mañana · ${label}`;
        }


        option.textContent =
            label.toUpperCase();


        dateSelect.appendChild(
            option
        );
    }
}


/* =========================================================
   FIREBASE INVENTORY
   ========================================================= */

async function loadInventory() {

    /*
     * FRONTEND ONLY FOR NOW.
     *
     * Acá vamos a hacer la consulta de Firebase.
     *
     * Por ejemplo, Firebase podría devolver:
     *
     * {
     *     standard: 8,
     *     premium: 2
     * }
     *
     * Si Firebase falla o todavía no está conectado,
     * usamos 8 Standard y 2 Premium.
     */

    try {

        inventory = {
            ...DEFAULT_INVENTORY
        };

    } catch (error) {

        console.error(
            'No se pudo cargar el inventario:',
            error
        );

        inventory = {
            ...DEFAULT_INVENTORY
        };
    }


    renderSimulators();
}


/* =========================================================
   CREATE SIMULATOR CARD
   ========================================================= */

function createSimulatorCard(
    type,
    number
) {

    const card =
        document.createElement('button');


    card.type = 'button';

    card.className =
        'simulator-card';


    card.dataset.type =
        type;

    card.dataset.number =
        number;


    const isPremium =
        type === 'premium';


    const image =
        isPremium
            ? PREMIUM_WHEEL_IMAGE
            : STANDARD_WHEEL_IMAGE;


    card.innerHTML = `
        <span class="simulator-check">
            ✓
        </span>

        <img
            class="simulator-wheel"
            src="${image}"
            alt=""
        >

        <span class="simulator-card-info">

            <small>
                ${isPremium ? 'PREMIUM' : 'STANDARD'}
            </small>

            <strong>
                SIMULADOR ${number}
            </strong>

        </span>
    `;


    card.addEventListener(
        'click',
        () => {

            toggleSimulator(
                type,
                number,
                card
            );

        }
    );


    return card;
}


/* =========================================================
   RENDER SIMULATORS
   ========================================================= */

function renderSimulators() {

    standardGrid.innerHTML = '';
    premiumGrid.innerHTML = '';


    for (
        let i = 1;
        i <= inventory.standard;
        i++
    ) {

        standardGrid.appendChild(
            createSimulatorCard(
                'standard',
                i
            )
        );
    }


    for (
        let i = 1;
        i <= inventory.premium;
        i++
    ) {

        premiumGrid.appendChild(
            createSimulatorCard(
                'premium',
                i
            )
        );
    }


    standardCount.textContent =
        `${inventory.standard} DISPONIBLES`;


    premiumCount.textContent =
        `${inventory.premium} DISPONIBLES`;


    availableCount.textContent =
        inventory.standard +
        inventory.premium;


    updateSummary();
}


/* =========================================================
   SELECT SIMULATOR
   ========================================================= */

function toggleSimulator(
    type,
    number,
    card
) {

    const collection =
        selected[type];


    if (collection.has(number)) {

        collection.delete(number);

        card.classList.remove(
            'selected'
        );

    } else {

        collection.add(number);

        card.classList.add(
            'selected'
        );
    }


    updateSummary();
}


/* =========================================================
   TOTAL
   ========================================================= */

function calculateTotal() {

    const duration =
        Number(
            durationSelect.value
        ) || 1;


    const standardSubtotal =
        selected.standard.size *
        PRICES.standard *
        duration;


    const premiumSubtotal =
        selected.premium.size *
        PRICES.premium *
        duration;


    return (
        standardSubtotal +
        premiumSubtotal
    );
}


/* =========================================================
   SUMMARY
   ========================================================= */

function updateSummary() {

    const duration =
        Number(
            durationSelect.value
        ) || 1;


    summaryStandard.textContent =
        selected.standard.size;


    summaryPremium.textContent =
        selected.premium.size;


    summaryDuration.textContent =
        `${duration} ${
            duration === 1
                ? 'hora'
                : 'horas'
        }`;


    reservationTotal.textContent =
        `L ${calculateTotal().toLocaleString(
            'es-HN'
        )}`;


    updateSubmitButton();
}


/* =========================================================
   SUBMIT STATE
   ========================================================= */

function updateSubmitButton() {

    const hasSimulator =
        selected.standard.size > 0 ||
        selected.premium.size > 0;


    const hasDate =
        Boolean(
            dateSelect.value
        );


    const hasTime =
        Boolean(
            timeSelect.value
        );


    reservationSubmit.disabled =
        !(
            hasSimulator &&
            hasDate &&
            hasTime
        );
}


/* =========================================================
   EVENTS
   ========================================================= */

dateSelect?.addEventListener(
    'change',
    updateSubmitButton
);


timeSelect?.addEventListener(
    'change',
    updateSubmitButton
);


durationSelect?.addEventListener(
    'change',
    updateSummary
);


/* =========================================================
   FORM
   ========================================================= */

reservationForm?.addEventListener(
    'submit',
    (event) => {

        event.preventDefault();


        /*
         * FRONTEND ONLY.
         *
         * Después conectamos esto con Firebase/backend.
         */

        const reservation = {

            date:
                dateSelect.value,

            time:
                timeSelect.value,

            duration:
                Number(
                    durationSelect.value
                ),

            simulators: {

                standard:
                    [
                        ...selected.standard
                    ],

                premium:
                    [
                        ...selected.premium
                    ]
            },

            payment:
                document.querySelector(
                    'input[name="payment"]:checked'
                )?.value || null,

            total:
                calculateTotal()
        };


        console.log(
            'RESERVA:',
            reservation
        );
    }
);


/* =========================================================
   INIT
   ========================================================= */

createDateOptions();

loadInventory();