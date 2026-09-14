/*
 * js/standings.js
 *
 * Renders the lap-time leaderboard on standings.html. Fetches the raw
 * driver list for the current month from /api/standings (see
 * api/standings.js, which reads a Google Sheet server-side), then does
 * ALL filtering/sorting/formatting here in the browser:
 *   - category filter (todos / team / masculino / femenino) via the
 *     #categorySelect dropdown — see filterByCategory().
 *   - fastest-first sort with "NT" (no time) entries pushed to the
 *     bottom — see buildStandings().
 *   - the "MI TIEMPO" card, which matches the signed-in Firebase user's
 *     display name against the Sheet's driver names (see
 *     normalizeDriverName/updateMyTime) to highlight their own result.
 *     This is a best-effort NAME match (case/accent-insensitive, ignores
 *     a trailing "(S)" team marker) — there's no other link between a
 *     Firebase account and a Sheet row, so a typo'd/different name in the
 *     Sheet vs. the account's display name will show "SIN REGISTRO" even
 *     if that person is actually on the sheet.
 *
 * Also loads /data/tracks.json (a plain "month number" -> track image URL
 * map) to swap in the correct circuit image for the current month.
 */

import {
    auth,
    db
} from '../firebase-config.js';

import {
    onAuthStateChanged
} from 'firebase/auth';

import {
    doc,
    getDoc
} from 'firebase/firestore';
let standingsUserName = null;
let currentStandingsRows = [];

const TRACKS_JSON_PATH = '/data/tracks.json';
const DEFAULT_CATEGORY = 'todos';

let allDrivers = [];

document.addEventListener('DOMContentLoaded', () => {
  initStandings();
});

async function initStandings() {
  try {
    const res = await fetch('/api/standings');
    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Ocurrió un error al cargar la tabla de tiempos.');
      return;
    }

    setMonthLabel(data.month, data.year);
    renderTrackMap(data.monthNumber);

    const circuitoEl = document.getElementById('circuitoName');
    if (circuitoEl) circuitoEl.textContent = data.circuito || 'N/D';

    allDrivers = data.drivers || [];
currentStandingsRows = allDrivers;

updateMyTime();
    setupCategorySelect();
    renderCategory(getSelectedCategory());
  } catch (err) {
    console.error('Error cargando la tabla de tiempos:', err);
    showError('Ocurrió un error al cargar la tabla de tiempos. Intenta de nuevo más tarde.');
  }
}

function setupCategorySelect() {
  const select = document.getElementById('categorySelect');
  if (!select) return;
  select.value = DEFAULT_CATEGORY;
  select.addEventListener('change', () => {
    renderCategory(select.value);
  });
}

function getSelectedCategory() {
  const select = document.getElementById('categorySelect');
  return select ? select.value : DEFAULT_CATEGORY;
}

/** Splits the full roster into the selected category. See rules in the header comment. */
function filterByCategory(drivers, category) {
  if (category === 'todos') return [...drivers];

  return drivers.filter((d) => {
    if (category === 'team') return d.team;
    if (category === 'masculino') return !d.team && d.gender === 'M';
    if (category === 'femenino') return !d.team && d.gender === 'F';
    return false;
  });
}

/**
 * Sorts a filtered list fastest-first (drivers with no time go last, in
 * original sheet order), then builds display rows with position, time
 * ("NT" when there's no time), and difference ("----" when there's no time).
 */
function buildStandings(drivers) {
  const sorted = [...drivers].sort((a, b) => {
    if (a.ms === null && b.ms === null) return a.rowOrder - b.rowOrder;
    if (a.ms === null) return 1;
    if (b.ms === null) return -1;
    return a.ms - b.ms;
  });

  const fastestMs = sorted.length && sorted[0].ms !== null ? sorted[0].ms : null;

  return sorted.map((d, i) => ({
    position: i + 1,
    name: d.name,
    hasTime: d.ms !== null,
    time: d.ms !== null ? d.timeStr : 'NT',
    difference: d.ms === null
      ? '----'
      : (d.ms === fastestMs ? 'LEADER' : formatDifference(d.ms - fastestMs)),
  }));
}

function renderCategory(category) {
  const filtered = filterByCategory(allDrivers, category);

  if (filtered.length === 0) {
    renderRecord(null);
    showError('No hay pilotos registrados en esta categoría todavía.');
    return;
  }

  const standings = buildStandings(filtered);
  const leader = standings.find((d) => d.hasTime) || null;

  renderRecord(leader);
  renderLeaderboard(standings);
}

/** Fills RECORD ACTUAL / PILOTO from the fastest timed driver in the current category. */
function renderRecord(leader) {
  const recordEl = document.getElementById('recordTime');
  const pilotoEl = document.getElementById('recordPiloto');

  if (recordEl) recordEl.textContent = leader ? leader.time : '--:--.---';
  if (pilotoEl) pilotoEl.textContent = leader ? leader.name.toUpperCase() : '-';
}

/** Sets the "AGOSTO 2026" style label at the top of the page. */
function setMonthLabel(monthName, year) {
  const el = document.getElementById('eventMonth');
  if (el) el.textContent = `${monthName.toUpperCase()} ${year}`;
}

/** Loads data/tracks.json (month -> image URL) and swaps the track map image. */
async function renderTrackMap(monthNumber) {
  const trackImgEl = document.getElementById('trackMapImg');
  if (!trackImgEl || !monthNumber) return;

  try {
    const res = await fetch(TRACKS_JSON_PATH);
    if (!res.ok) throw new Error(`No se pudo cargar ${TRACKS_JSON_PATH}`);
    const tracksByMonth = await res.json();
    const trackUrl = tracksByMonth[String(monthNumber)];
    if (trackUrl) trackImgEl.src = trackUrl;
  } catch (err) {
    // Non-fatal: leave whichever image is already in the HTML as a fallback.
    console.error('Error cargando el mapa del circuito:', err);
  }
}

/** Builds the leaderboard rows in #leaderboard from a standings array. */
function renderLeaderboard(drivers) {
  const leaderboardEl = document.getElementById('leaderboard');
  if (!leaderboardEl) return;

  leaderboardEl.innerHTML = '';

  drivers.forEach((driver) => {
    const row = document.createElement('div');
    row.className = 'standing-row' + (driver.position === 1 && driver.hasTime ? ' leader' : '');

    const positionSpan = document.createElement('span');
    positionSpan.className = 'position';
    positionSpan.textContent = String(driver.position);

    const driverSpan = document.createElement('span');
    driverSpan.className = 'driver';
    driverSpan.textContent = driver.name;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = driver.time;

    const diffSpan = document.createElement('span');
    diffSpan.className = 'difference';
    diffSpan.textContent = driver.difference;

    row.append(positionSpan, driverSpan, timeSpan, diffSpan);
    leaderboardEl.appendChild(row);
  });
}

/** Formats a millisecond gap as "+M:SS.mmm" or "+SS.mmm" to match the leaderboard style. */
function formatDifference(diffMs) {
  const totalSeconds = Math.floor(diffMs / 1000);
  const millis = diffMs % 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millisStr = String(millis).padStart(3, '0');

  if (minutes > 0) return `+${minutes}:${String(seconds).padStart(2, '0')}.${millisStr}`;
  return `+${seconds}.${millisStr}`;
}

/** Shows a plain error message in place of the leaderboard rows. */
function showError(message) {
  const leaderboardEl = document.getElementById('leaderboard');
  if (leaderboardEl) {
    leaderboardEl.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'standings-error';
    p.textContent = message;
    leaderboardEl.appendChild(p);
  }
}
function normalizeDriverName(value) {

    return String(value || '')
        .trim()

        /*
         * Si el nombre del Sheets es:
         *
         * Cesar Vigil (S)
         *
         * para comparar usamos:
         *
         * Cesar Vigil
         *
         * pero NO modificamos el nombre real.
         */
        .replace(
            /\s*\(S\)\s*$/i,
            ''
        )

        .trim()
        .toLocaleLowerCase('es');
}

function ensureMyTimeCard() {

    let card =
        document.getElementById(
            'myTimeCard'
        );

    if (card) {
        return card;
    }

    card =
        document.createElement(
            'div'
        );

    card.id =
        'myTimeCard';

    card.className =
        'my-time-card';

    card.innerHTML = `
        <div class="my-time-copy">
            <span class="my-time-label">
                MI TIEMPO
            </span>

            <strong
                class="my-time-value"
                id="myTimeValue"
            >
                --
            </strong>
        </div>

        <span
            class="my-time-driver"
            id="myTimeDriver"
        ></span>
    `;

    const leaderboard =
        document.getElementById(
            'leaderboard'
        );

    if (leaderboard?.parentNode) {
        leaderboard.parentNode.insertBefore(
            card,
            leaderboard
        );
    } else {
        document.body.appendChild(
            card
        );
    }

    return card;
}

function updateMyTime() {

    ensureMyTimeCard();


    const card =
        document.getElementById(
            'myTimeCard'
        );


    const value =
        document.getElementById(
            'myTimeValue'
        );


    const driver =
        document.getElementById(
            'myTimeDriver'
        );


    if (
        !card ||
        !value ||
        !driver
    ) {

        console.error(
            '[STANDINGS] No se pudieron crear los elementos de Mi Tiempo.'
        );

        return;
    }


    card.classList.remove(
        'found',
        'no-record'
    );


    /*
     * DEBUG
     */



    /* =====================================================
       NO LOGUEADO
       ===================================================== */

    if (!standingsUserName) {

        value.textContent =
            'INICIÁ SESIÓN';


        driver.textContent =
            '';


        card.classList.add(
            'no-record'
        );


        return;
    }


    const firebaseName =
        normalizeDriverName(
            standingsUserName
        );


    /* =====================================================
       BUSCAR EN DATOS DEL SHEETS
       ===================================================== */

    const sheetRow =
        currentStandingsRows.find(
            row => {

                /*
                 * TU API REAL USA row.name.
                 */

                const sheetName =
                    normalizeDriverName(
                        row.name
                    );


            

                return (
                    sheetName ===
                    firebaseName
                );
            }
        );


    /* =====================================================
       NO ENCONTRADO
       ===================================================== */

    if (!sheetRow) {

        console.warn(
            '[STANDINGS] No encontramos al usuario en Sheets:',
            standingsUserName
        );


        value.textContent =
            'SIN REGISTRO';


        driver.textContent =
            standingsUserName;


        card.classList.add(
            'no-record'
        );


        return;
    }


    /* =====================================================
       ENCONTRADO
       ===================================================== */




    /*
     * TU API REAL USA:
     *
     * row.ms
     * row.timeStr
     */

    value.textContent =
        sheetRow.ms !== null &&
        sheetRow.ms !== undefined

            ? (
                sheetRow.timeStr ||
                '--'
            )

            : 'NT';


    /*
     * Enseñamos exactamente el nombre del Sheets.
     *
     * Ej:
     *
     * Cesar Vigil (S)
     */

    driver.textContent =
        sheetRow.name ||
        standingsUserName;


    card.classList.add(
        'found'
    );
}
/* =========================================================
   FIREBASE USER
   ========================================================= */

onAuthStateChanged(
    auth,

    async user => {

        if (!user) {

            standingsUserName =
                null;

            updateMyTime();

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


            const profile =
                snapshot.exists()
                    ? snapshot.data()
                    : {};


            standingsUserName =
                String(
                    profile.name ||
                    user.displayName ||
                    ''
                ).trim();





        } catch (
            error
        ) {

            console.error(
                '[STANDINGS] No se pudo obtener el nombre del usuario:',
                error
            );


            standingsUserName =
                String(
                    user.displayName ||
                    ''
                ).trim();
        }


        updateMyTime();
    }
);