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
 *   - the "MI TIEMPO" row (#myTimeRow), which matches the signed-in Firebase user's
 *     display name against the Sheet's driver names (see
 *     normalizeDriverName/updateMyTime) to highlight their own result.
 *     This is a best-effort NAME match (case/accent-insensitive, ignores
 *     a trailing "(S)" team marker) — there's no other link between a
 *     Firebase account and a Sheet row, so a typo'd/different name in the
 *     Sheet vs. the account's display name will show "NT" in MI TIEMPO even
 *     if that person is actually on the sheet.
 *
 * Also loads /data/tracks.json (a plain "month number" -> track image URL
 * map) to swap in the correct circuit image for the current month.
 */

import {
    auth
} from '../firebase-config.js';

import {
    onAuthStateChanged
} from 'firebase/auth';

let standingsUserName = null;
let currentStandingsRows = [];

const TRACKS_JSON_PATH = '/data/tracks.json';
const DEFAULT_CATEGORY = 'todos';

let allDrivers = [];

document.addEventListener('DOMContentLoaded', () => {
  initStandings();
});

const MONTHS_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** If the API fails, don't leave "Cargando..." / a stale month on screen. */
function showHeaderFallback() {
  const circuitoEl = document.getElementById('circuitoName');
  if (circuitoEl) circuitoEl.textContent = 'N/D';
}

async function initStandings() {
  // Current month right away (the API confirms it below), instead of a
  // hardcoded month in the HTML that goes stale.
  const now = new Date();
  setMonthLabel(MONTHS_ES[now.getMonth()], now.getFullYear());

  try {
    const res = await fetch('/api/standings');
    const data = await res.json();

    if (!res.ok) {
      showHeaderFallback();
      showError(data.error || 'Ocurrió un error al cargar la tabla de tiempos.');
      return;
    }

    setMonthLabel(data.month, data.year);
    renderTrackMap(data.monthNumber);

    const circuitoEl = document.getElementById('circuitoName');
    if (circuitoEl) circuitoEl.textContent = data.circuito || 'N/D';

    const carEl = document.getElementById('carName');
    if (carEl && data.auto) carEl.textContent = data.auto;

    allDrivers = data.drivers || [];
    currentStandingsRows = allDrivers;

    updateMyTime();
    setupCategorySelect();
    renderCategory(getSelectedCategory());
  } catch (err) {
    console.error('Error cargando la tabla de tiempos:', err);
    showHeaderFallback();
    showError('Ocurrió un error al cargar la tabla de tiempos. Intentá de nuevo más tarde.');
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
      : (d.ms === fastestMs ? 'LÍDER' : formatDifference(d.ms - fastestMs)),
  }));
}

function renderCategory(category) {
  const filtered = filterByCategory(allDrivers, category);

  if (filtered.length === 0) {
    renderRecord(null);
    showError('Todavía no hay tiempos en esta categoría este mes.');
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

    // Placeholder entries in tracks.json still say token=REEMPLAZAR.
    if (!trackUrl || trackUrl.includes('REEMPLAZAR')) return;

    // Only show the image once it actually loads, so a bad URL never
    // shows a broken-image icon.
    trackImgEl.addEventListener('load', () => { trackImgEl.hidden = false; }, { once: true });
    trackImgEl.addEventListener('error', () => { trackImgEl.hidden = true; }, { once: true });
    trackImgEl.src = trackUrl;
  } catch (err) {
    // Non-fatal: the map just stays hidden.
    console.error('Error cargando el mapa del circuito:', err);
  }
}

/* ---------------------------------------------------------
   MI TIEMPO + "your row"

   #myTimeRow (standings.html, above the orange line) is a
   leaderboard row like any other — POS · PILOTO · TIEMPO ·
   DIFERENCIA, no header — showing the signed-in user's result.
   Their row in the table gets the same highlight, and tapping
   MI TIEMPO scrolls to it (handy on phones with a long list).
   Same name match as before: normalizeDriverName().
   --------------------------------------------------------- */

// False until Firebase says whether someone is signed in, so a signed-in
// user doesn't see "INICIÁ SESIÓN" flash first.
let authResolved = false;

function findMyRow() {
  if (!standingsUserName) return null;
  const mine = normalizeDriverName(standingsUserName);
  return [...document.querySelectorAll('#leaderboard .standing-row')]
    .find((row) => row.dataset.match === mine) || null;
}

function setMyTimeCells(cells) {
  const row = document.getElementById('myTimeRow');
  if (!row) return null;

  ['position', 'driver', 'time', 'difference'].forEach((name) => {
    const cell = row.querySelector(`.${name}`);
    const value = cells[name] ?? '';
    if (cell) cell.replaceChildren(value);
  });

  return row;
}

function loginButton() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'my-time-login';
  button.textContent = 'INICIÁ SESIÓN';
  button.addEventListener('click', () => document.getElementById('authBtn')?.click());
  return button;
}

function renderMyTimeRow(tableRow) {
  const row = document.getElementById('myTimeRow');
  if (!row) return;

  row.classList.remove('can-jump', 'is-empty');
  row.removeAttribute('role');
  row.removeAttribute('tabindex');
  row.setAttribute('aria-label', 'Mi tiempo');

  if (!authResolved) {
    setMyTimeCells({ position: '–', driver: 'CARGANDO…' });
    row.classList.add('is-empty');
    return;
  }

  if (!standingsUserName) {
    setMyTimeCells({ position: '–', driver: loginButton(), time: '--', difference: '' });
    row.classList.add('is-empty');
    return;
  }

  // In the table for the selected category: copy that row as is.
  if (tableRow) {
    const text = (name) => tableRow.querySelector(`.${name}`)?.textContent || '';
    setMyTimeCells({
      position: text('position'),
      driver: text('driver'),
      time: text('time'),
      difference: text('difference')
    });
    row.classList.add('can-jump');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.setAttribute('aria-label', 'Mi tiempo: ver en la tabla');
    return;
  }

  // On the sheet but not in this category, or not on the sheet at all.
  const mine = normalizeDriverName(standingsUserName);
  const sheetRow = currentStandingsRows.find((driver) => normalizeDriverName(driver.name) === mine);
  const hasTime = sheetRow && sheetRow.ms !== null && sheetRow.ms !== undefined;

  setMyTimeCells({
    position: '–',
    driver: sheetRow?.name || standingsUserName,
    time: hasTime ? sheetRow.timeStr : 'NT',
    difference: '----'
  });

  if (!hasTime) row.classList.add('is-empty');
}

function highlightMyRow() {
  document
    .querySelectorAll('#leaderboard .standing-row.is-me')
    .forEach((row) => {
      row.classList.remove('is-me');
      row.removeAttribute('aria-current');
    });

  const row = findMyRow();

  if (row) {
    row.classList.add('is-me');
    row.setAttribute('aria-current', 'true');
  }

  renderMyTimeRow(row);
}

function jumpToMyRow(event) {
  // The login button inside the row has its own job.
  if (event.target.closest('button')) return;

  const row = findMyRow();
  if (!row) return;

  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  row.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
  row.classList.remove('flash');
  void row.offsetWidth;
  row.classList.add('flash');
}

const myTimeRowEl = document.getElementById('myTimeRow');
myTimeRowEl?.addEventListener('click', jumpToMyRow);
myTimeRowEl?.addEventListener('keydown', (event) => {
  if ((event.key === 'Enter' || event.key === ' ') && myTimeRowEl.classList.contains('can-jump')) {
    event.preventDefault();
    jumpToMyRow(event);
  }
});

/** Builds the leaderboard rows in #leaderboard from a standings array. */
function renderLeaderboard(drivers) {
  const leaderboardEl = document.getElementById('leaderboard');
  if (!leaderboardEl) return;

  leaderboardEl.innerHTML = '';

  drivers.forEach((driver) => {
    const row = document.createElement('div');
    row.className = 'standing-row' + (driver.position === 1 && driver.hasTime ? ' leader' : '');
    row.setAttribute('role', 'row');
    row.dataset.match = normalizeDriverName(driver.name);

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

    [positionSpan, driverSpan, timeSpan, diffSpan].forEach((cell) => cell.setAttribute('role', 'cell'));

    row.append(positionSpan, driverSpan, timeSpan, diffSpan);
    leaderboardEl.appendChild(row);
  });

  highlightMyRow();
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

/* Signed-in user or the data changed: refresh MI TIEMPO + the highlight. */
function updateMyTime() {
    highlightMyRow();
}
/* =========================================================
   FIREBASE USER
   ========================================================= */

onAuthStateChanged(
    auth,

    async user => {

        authResolved =
            true;

        if (!user) {

            standingsUserName =
                null;

            updateMyTime();

            return;
        }


        try {

            const { db, doc, getDoc } =
                await import('../firebase-db.js');

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