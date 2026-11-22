import { auth, db } from '../firebase-config.js';

import {
    signInWithEmailAndPassword,
    onAuthStateChanged,
    signOut
} from 'firebase/auth';
import {
    getStorage,
    ref,
    getDownloadURL
} from 'firebase/storage';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    addDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    query,
    where,
    serverTimestamp,
    writeBatch,
    runTransaction,
    Timestamp,
    orderBy
} from 'firebase/firestore';

import {
    calculateReservationTotal,
    canEditReservation,
    currentPaymentMethod,
    displayRigName,
    hm,
    hourRangeLabel,
    normalizeRigType,
    paymentOptionsFor,
    rigNumber,
    takenRigIds
} from './reservation-logic.js';

import {
    isInSalesRange,
    paymentBreakdown,
    paymentLabel,
    saleDescription,
    salesCsv
} from './sales-logic.js';

import {
    createManualReservation,
    saveReservationEdit
} from './reservation-writes.js';

import { esc, safeUrl } from './html-safety.js';

import { renderRefunds, setupRefunds } from './refunds-view.js';
import {
    MAX_REPUTATION,
    calendarStatus,
    canMarkNoShow,
    filterUserRows,
    loadUserReputation,
    setNoShow
} from './user-reputation.js';

import {
    addDays,
    calendarRowTimes,
    cellPart,
    dayHours,
    daySummary,
    isCalendarReservation,
    isRowClosed,
    lockdownInRow,
    pendingCount,
    reservationWindow,
    reservationsInCell,
    searchReservations,
    telUrl,
    weekDates,
    weekOccupancy,
    whatsappUrl
} from './calendar-logic.js';

import {
    WEEK_DAYS,
    buildHoursPayload,
    buildPricesPayload,
    openHoursCount,
    readHours,
    readPrices
} from './settings-logic.js';

import {
    closeConfirm,
    confirmDialog,
    isConfirmOpen,
    toast,
    toastError,
    withBusy
} from './ui.js';

/*
 * Las funciones de Firestore que usan js/reservation-writes.js, pasadas
 * por parámetro en vez de importadas allá: los tests le pasan el doble en
 * memoria de tests/helpers/fake-firestore.mjs en este mismo lugar.
 */
const firestore = {
    db,
    doc,
    collection,
    runTransaction,
    serverTimestamp,
    timestampFromDate: (date) => Timestamp.fromDate(date)
};

// DOM helpers
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// DOM references
const storage = getStorage(auth.app);
const loginScreen = $('#loginScreen');
const adminShell = $('#adminShell');
const loginForm = $('#loginForm');
const loginMessage = $('#loginMessage');

// Preferencias por navegador (vista, modo del calendario). Si el storage
// no está disponible el panel funciona igual, solo no recuerda.
function readPref(key, fallback) {
    try {
        return localStorage.getItem(key) ?? fallback;
    } catch {
        return fallback;
    }
}

function writePref(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        /* sin storage */
    }
}

// State
let currentUser = null;
let reservations = [];
let rigs = [];
let sales = [];
let products = [];
let lockdowns = [];
let settings = {};
let range = 'month';
let customRange = { from: '', to: '' };
let archive = { reservations: [], sales: [] };
let calendarMode = readPref('admin:calendarMode', 'day') === 'week' ? 'week' : 'day';
let reservationsLoaded = false;
let productsModalOpen = false;
let drawerReservationId = null;
let userRows = null;
let usersLoading = false;
let lastSalesRows = [];
let unsubscribers = [];

// Utility functions
const money = (v) => `L ${Number(v || 0).toLocaleString('es-HN', { maximumFractionDigits: 2 })}`;

const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ftime = (v) => {
    if (!v) return 'N/D';
    const [h, m] = String(v).split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fdate = (v) => (v ? String(v).split('-').reverse().join('/') : 'N/D');

const minutesToTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

const DAY_NAMES = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
const dayName = (v) => {
    if (!v) return '';
    const [y, m, d] = String(v).split('-').map(Number);
    return DAY_NAMES[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()] || '';
};

const dt = (v) => (v?.toDate ? v.toDate() : v ? new Date(v) : null);

const STATUS_LABELS = {
    pending: 'PENDIENTE',
    approved: 'APROBADA',
    rejected: 'RECHAZADA',
    cancelled: 'CANCELADA',
    payment_pending: 'PAGO PENDIENTE'
};
const statusLabel = (r) =>
    r.noShow === true ? 'NO-SHOW' : STATUS_LABELS[r.status] || String(r.status || 'N/D').toUpperCase();

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/*
 * isTuesday(), los helpers de reservationLocks, los de rigs y el cálculo
 * de totales viven en js/reservation-logic.js; el calendario, la búsqueda
 * y los links de contacto en js/calendar-logic.js; CONFIGURACIÓN en
 * js/settings-logic.js. Están afuera de este archivo porque acá todo toca
 * el DOM y el SDK de Firebase apenas se importa, así que nada de esto se
 * podría ejecutar (ni probar) en Node. Ver tests/.
 */

// Authorization check
async function authorized(u) {
    if (!u) return false;
    const s = await getDoc(doc(db, 'adminUsers', u.uid));
    return s.exists() && s.data().enabled === true;
}

// Login handler
loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const b = e.currentTarget.querySelector('button');
    b.disabled = true;
    b.textContent = 'VERIFICANDO...';
    loginMessage.hidden = true;
    try {
        const c = await signInWithEmailAndPassword(auth, $('#loginEmail').value.trim(), $('#loginPassword').value);
        if (!(await authorized(c.user))) {
            await signOut(auth);
            throw Error('unauthorized');
        }
    } catch (x) {
        loginMessage.textContent =
            x.message === 'unauthorized' ? 'Esta cuenta no tiene acceso al panel.' : 'Correo o contraseña incorrectos.';
        loginMessage.hidden = false;
    } finally {
        b.disabled = false;
        b.textContent = 'INICIAR SESIÓN';
    }
};

$('#logoutBtn').onclick = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
    if (!u) {
        stopListening();
        currentUser = null;
        // Al cerrar sesión se olvida la lista; el próximo admin la vuelve a leer.
        userRows = null;
        closeDrawer();
        closeModal();
        adminShell.hidden = true;
        loginScreen.hidden = false;
        return;
    }
    if (!(await authorized(u))) {
        await signOut(auth);
        return;
    }
    currentUser = u;
    $('#adminEmail').textContent = u.email || u.uid;
    loginScreen.hidden = true;
    adminShell.hidden = false;
    listen();
    if (activeView() === 'usuarios') loadUsers();
});

setupRefunds({ currentUser: () => currentUser });

/* =========================================================
   NAVEGACIÓN

   La vista abierta queda en la URL (#ventas) y en el navegador, así
   que recargar vuelve a la misma pantalla en vez de a RESERVAS.
   ========================================================= */

const VIEWS = $$('.nav').map((b) => b.dataset.view);

function showView(view, { updateHash = true } = {}) {
    if (!VIEWS.includes(view)) view = 'reservas';
    const button = $(`.nav[data-view="${view}"]`);
    $$('.nav').forEach((x) => x.classList.toggle('active', x === button));
    $$('.view').forEach((x) => x.classList.toggle('active', x.id === `view-${view}`));
    $('#viewTitle').textContent = button.dataset.title;
    writePref('admin:view', view);
    if (updateHash && location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    if (view === 'usuarios' && currentUser && !userRows) loadUsers();
}

const activeView = () => $('.nav.active')?.dataset.view;

$$('.nav').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
window.addEventListener('hashchange', () => showView(location.hash.slice(1), { updateHash: false }));
showView(location.hash.slice(1) || readPref('admin:view', 'reservas'));

/* =========================================================
   TECLADO

   Esc cierra lo que esté arriba (confirmación, modal, panel lateral,
   resultados de búsqueda). En RESERVAS, ← y → cambian de día (o de
   semana) cuando no se está escribiendo en un campo.
   ========================================================= */

const drawerOpen = () => $('#drawer').classList.contains('open');
const modalOpen = () => !$('#modalBackdrop').hidden;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (isConfirmOpen()) return closeConfirm(false);
        if (modalOpen()) return closeModal();
        if (drawerOpen()) return closeDrawer();
        $('#resSearchResults').hidden = true;
        return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (activeView() !== 'reservas' || isConfirmOpen() || modalOpen() || drawerOpen()) return;
    if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable]')) return;
    e.preventDefault();
    shift(e.key === 'ArrowLeft' ? -1 : 1);
});

/* =========================================================
   CALENDARIO
   ========================================================= */

$('#calendarDate').value = today();
$('#calendarDate').onchange = renderCalendar;

function shift(n) {
    const step = calendarMode === 'week' ? 7 : 1;
    $('#calendarDate').value = addDays($('#calendarDate').value || today(), n * step);
    renderCalendar();
}

$('#prevDay').onclick = () => shift(-1);
$('#nextDay').onclick = () => shift(1);
$('#todayBtn').onclick = () => {
    $('#calendarDate').value = today();
    renderCalendar();
};

function setCalendarMode(mode) {
    calendarMode = mode;
    writePref('admin:calendarMode', mode);
    $$('[data-cal-mode]').forEach((b) => b.classList.toggle('active', b.dataset.calMode === mode));
    renderCalendar();
}

$$('[data-cal-mode]').forEach((b) => {
    b.onclick = () => setCalendarMode(b.dataset.calMode);
    b.classList.toggle('active', b.dataset.calMode === calendarMode);
});

/*
 * Escuchar cambios en Firestore.
 *
 * Cada onSnapshot cobra una lectura por documento al conectarse (y otra
 * por cada cambio después), así que reservas y ventas se limitan al año
 * en curso, que es lo más atrás que llegan los filtros rápidos de ventas.
 * El rango PERSONALIZADO que empieza antes lee esos meses aparte, una vez.
 *
 * listen() puede volver a llamarse si alguien cierra sesión y vuelve a
 * entrar sin recargar; stopListening() suelta los listeners anteriores
 * para no duplicarlos (cada duplicado vuelve a leer todo). Los bloqueos
 * de horario también viven acá: antes se escuchaban al cargar la página,
 * antes del login, y si esa primera lectura fallaba por permisos el
 * listener moría y la lista quedaba vacía hasta recargar.
 */
function stopListening() {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    unsubscribers = [];
    reservationsLoaded = false;
}

function startOfYear() {
    return new Date(new Date().getFullYear(), 0, 1);
}

const listenError = (label) => (error) => {
    console.error(`[${label}]`, error);
    toast(`No se pudo cargar ${label.toLowerCase()}.`, 'error');
};

function listen() {
    stopListening();
    const yearStart = startOfYear();
    const yearStartDate = `${yearStart.getFullYear()}-01-01`;
    unsubscribers.push(onSnapshot(query(collection(db, 'reservations'), where('date', '>=', yearStartDate)), (s) => {
        reservations = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        reservationsLoaded = true;
        renderCalendar();
        renderSales();
        renderRefunds(reservations);
        renderPendingBadge();
    }, listenError('RESERVAS')));
    unsubscribers.push(onSnapshot(collection(db, 'rigs'), (s) => {
        rigs = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 99) - (b.order || 99));
        renderRigs();
        renderCalendar();
    }, listenError('RIGS')));
    unsubscribers.push(onSnapshot(query(collection(db, 'sales'), where('createdAt', '>=', Timestamp.fromDate(yearStart))), (s) => {
        sales = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderSales();
    }, listenError('VENTAS')));
    unsubscribers.push(onSnapshot(collection(db, 'products'), (snapshot) => {
        products = snapshot.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        if (productsModalOpen) renderProductsModal();
    }, listenError('PRODUCTOS')));
    unsubscribers.push(onSnapshot(query(collection(db, 'availabilityLockdowns'), orderBy('date', 'asc')), (snapshot) => {
        lockdowns = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderLockdowns();
        renderCalendar();
    }, listenError('BLOQUEOS')));
    loadSettings();
}

/*
 * Rigs visibles en el calendario y en los formularios. El precio por hora
 * sale de CONFIGURACIÓN (settings/reservations.prices, por tipo), igual que
 * en el sitio público: antes cada rig tenía su propio PRECIO/H que el sitio
 * ignoraba, así que una reserva hecha desde el panel podía cobrar distinto
 * que la misma reserva hecha en la web.
 */
function activeRigs() {
    const prices = readPrices(settings);
    return rigs
        .filter((rig) => rig.status !== 'disabled')
        .map((rig) => {
            const type = normalizeRigType(rig.type);
            return { ...rig, type, pricePerHour: prices[type] };
        })
        .sort((a, b) => {
            // Standard siempre primero.
            if (a.type !== b.type) return a.type === 'standard' ? -1 : 1;
            return rigNumber(a) - rigNumber(b);
        });
}

function rr(reservation) {
    return reservation.rigs || reservation.simulators || [];
}

function hasRig(reservation, calendarRig) {
    const calendarId = String(calendarRig.id || '');
    const calendarType = normalizeRigType(calendarRig.type);
    const calendarNumber = rigNumber(calendarRig);

    return rr(reservation).some((reserved) => {
        // Las reservas nuevas guardan el ID real del rig.
        if (typeof reserved === 'string') return reserved === calendarId;

        const reservedId = String(reserved.id || reserved.rigId || '');
        if (reservedId && calendarId && reservedId === calendarId) return true;

        // Reservas viejas: tipo + número.
        return normalizeRigType(reserved.type) === calendarType && rigNumber(reserved) === calendarNumber;
    });
}

function renderCalendar() {
    const el = $('#reservationCalendar');
    if (!reservationsLoaded) {
        el.innerHTML = '<div class="calendar-loading">CARGANDO RESERVAS...</div>';
        return;
    }
    const date = $('#calendarDate').value || today();
    $('#todayBtn').classList.toggle(
        'active',
        calendarMode === 'day' ? date === today() : weekDates(date).includes(today())
    );
    if (calendarMode === 'week') renderWeek(date);
    else renderDay(date);
}

/*
 * Vista DÍA. Cada reserva ocupa todas las filas de su duración (antes
 * solo la de inicio), la primera muestra nombre y código, las celdas
 * vacías crean una reserva con ese simulador y hora, y si dos reservas
 * caen en la misma celda se muestran las dos en rojo.
 */
function renderDay(date) {
    const el = $('#reservationCalendar');
    const rs = activeRigs();
    const hours = readHours(settings);
    const list = reservations.filter((r) => r.date === date);

    renderDaySummary(date, rs.length, dayHours(hours, date));

    el.classList.remove('week');
    el.style.setProperty('--rig-count', Math.max(rs.length, 1));

    let h = `<div class="cal-head"><div class="cell">HORA</div>${rs
        .map((r) => `<div class="cell">${esc(displayRigName(r))}</div>`)
        .join('')}</div>`;

    for (const t of calendarRowTimes()) {
        const closed = isRowClosed(hours, date, t);
        const lock = lockdownInRow(lockdowns, date, t);
        const rowClass = ['cal-row', closed ? 'closed' : '', lock ? 'locked' : ''].filter(Boolean).join(' ');
        const timeCell = `<div class="cell time">${hourRangeLabel(t)}${
            lock ? `<small class="lock-tag" title="${esc(lock.reason || 'Bloqueado')}">BLOQUEADO</small>` : ''
        }</div>`;

        h += `<div class="${rowClass}">${timeCell}${rs
            .map((rig) => {
                const inCell = reservationsInCell(list, rig, t, hasRig);
                if (!inCell.length) {
                    const label = `Nueva reserva: ${displayRigName(rig)} · ${hourRangeLabel(t)}`;
                    return `<div class="cell"><button class="slot" data-slot-rig="${esc(rig.id)}" data-slot-time="${t}" title="${esc(label)}" aria-label="${esc(label)}">+</button></div>`;
                }
                const clash = inCell.length > 1;
                return `<div class="cell has-booking${clash ? ' clash' : ''}"${
                    clash ? ' title="Hay más de una reserva en este simulador y horario"' : ''
                }>${inCell.map((r) => bookingHtml(r, t, clash)).join('')}</div>`;
            })
            .join('')}</div>`;
    }
    el.innerHTML = h;
    $$('[data-r]').forEach((b) => (b.onclick = () => openReservation(b.dataset.r)));
    $$('[data-slot-rig]').forEach(
        (b) => (b.onclick = () => openNewReservation({ date, time: b.dataset.slotTime, rigId: b.dataset.slotRig }))
    );
}

function bookingHtml(r, t, clash) {
    const part = cellPart(r, t);
    const name = r.customer?.name || 'Sin nombre';
    const title = `${name} · ${r.code || r.id} · ${ftime(r.time)} · ${r.duration || 1} H · ${statusLabel(r)}`;
    const label =
        part === 'start' || part === 'single' || clash
            ? `<strong>${esc(name)}</strong><small>${esc(r.code || '')}${Number(r.duration) > 1 ? ` · ${esc(r.duration)} H` : ''}</small>`
            : '';
    return `<button class="booking ${esc(calendarStatus(r))} ${part}" data-r="${esc(r.id)}" title="${esc(title)}">${label}</button>`;
}

function renderDaySummary(date, rigCount, open) {
    const s = daySummary(reservations, date, rigCount, openHoursCount(open));
    $('#daySummary').innerHTML = `
        <div class="metric"><span>${esc(dayName(date))} ${esc(fdate(date))}</span><strong>${s.total}</strong><small>${
            open ? `ABIERTO ${esc(ftime(open[0]))} – ${esc(ftime(open[1]))}` : 'CERRADO EN EL SITIO'
        }</small></div>
        <div class="metric"><span>PENDIENTES</span><strong class="${s.pending ? 'warn' : ''}">${s.pending}</strong><small>${money(s.pendingIncome)} POR CONFIRMAR</small></div>
        <div class="metric"><span>APROBADAS</span><strong>${s.approved}</strong><small>${money(s.income)}</small></div>
        <div class="metric"><span>OCUPACIÓN</span><strong>${s.occupancy}%</strong><small>DE LAS HORAS ABIERTAS</small></div>`;
}

/*
 * Vista SEMANA: cuántos simuladores hay ocupados por día y hora (más
 * naranja = más lleno; el punto indica pendientes). Tocar un día abre su
 * vista DÍA.
 */
function renderWeek(date) {
    const el = $('#reservationCalendar');
    const rs = activeRigs();
    const hours = readHours(settings);
    const dates = weekDates(date);
    const times = calendarRowTimes();
    const grid = weekOccupancy(reservations, dates, times, rs, hasRig);

    renderWeekSummary(dates, rs.length, hours);

    el.classList.add('week');
    el.style.setProperty('--rig-count', 7);

    let h = `<div class="cal-head"><div class="cell">HORA</div>${dates
        .map(
            (d) =>
                `<div class="cell"><button class="week-day${d === today() ? ' today' : ''}${d === date ? ' selected' : ''}" data-day="${d}">${esc(dayName(d).slice(0, 3))} ${esc(fdate(d).slice(0, 5))}</button></div>`
        )
        .join('')}</div>`;

    times.forEach((t, row) => {
        h += `<div class="cal-row"><div class="cell time">${hourRangeLabel(t)}</div>${dates
            .map((d, col) => {
                const { busy, pending } = grid[col][row];
                const closed = isRowClosed(hours, d, t);
                const lock = lockdownInRow(lockdowns, d, t);
                const ratio = rs.length ? busy / rs.length : 0;
                const title = `${dayName(d)} ${fdate(d)} · ${hourRangeLabel(t)}: ${busy} de ${rs.length} ocupados${lock ? ' · BLOQUEADO' : ''}`;
                return `<div class="cell week-cell${closed ? ' closed' : ''}${lock ? ' locked' : ''}" style="--fill:${ratio.toFixed(2)}"><button data-day="${d}" title="${esc(title)}">${
                    busy ? `${busy}/${rs.length}` : ''
                }${pending ? '<i class="dot pending"></i>' : ''}</button></div>`;
            })
            .join('')}</div>`;
    });
    el.innerHTML = h;
    $$('[data-day]').forEach(
        (b) =>
            (b.onclick = () => {
                $('#calendarDate').value = b.dataset.day;
                setCalendarMode('day');
            })
    );
}

function renderWeekSummary(dates, rigCount, hours) {
    const totals = dates.map((d) => daySummary(reservations, d, rigCount, openHoursCount(dayHours(hours, d))));
    const sum = (k) => totals.reduce((a, b) => a + b[k], 0);
    const openDays = totals.filter((_, i) => dayHours(hours, dates[i]));
    const occupancy = openDays.length ? Math.round(openDays.reduce((a, b) => a + b.occupancy, 0) / openDays.length) : 0;
    $('#daySummary').innerHTML = `
        <div class="metric"><span>SEMANA ${esc(fdate(dates[0]).slice(0, 5))} – ${esc(fdate(dates[6]).slice(0, 5))}</span><strong>${sum('total')}</strong><small>RESERVAS</small></div>
        <div class="metric"><span>PENDIENTES</span><strong class="${sum('pending') ? 'warn' : ''}">${sum('pending')}</strong><small>${money(sum('pendingIncome'))} POR CONFIRMAR</small></div>
        <div class="metric"><span>APROBADAS</span><strong>${sum('approved')}</strong><small>${money(sum('income'))}</small></div>
        <div class="metric"><span>OCUPACIÓN PROMEDIO</span><strong>${occupancy}%</strong><small>DÍAS ABIERTOS</small></div>`;
}

// Número de reservas pendientes (de hoy en adelante) en el menú.
function renderPendingBadge() {
    const n = pendingCount(reservations, today());
    const badge = $('#pendingBadge');
    badge.textContent = n;
    badge.hidden = n === 0;
    badge.title = `${plural(n, 'reserva pendiente', 'reservas pendientes')}`;
    document.title = n ? `(${n}) Simuladores Inercia` : 'Simuladores Inercia';
}

/* =========================================================
   BÚSQUEDA DE RESERVAS
   ========================================================= */

const searchInput = $('#resSearch');
const searchResults = $('#resSearchResults');
let searchMatches = [];

function renderSearch() {
    if (searchInput.value.trim().length < 2) {
        searchMatches = [];
        searchResults.hidden = true;
        return;
    }
    searchMatches = searchReservations(reservations, searchInput.value, { today: today() });
    searchResults.hidden = false;
    searchResults.innerHTML = searchMatches.length
        ? searchMatches
              .map(
                  (r, i) => `<button type="button" class="search-hit" data-hit="${i}">
                    <i class="dot ${esc(calendarStatus(r))}"></i>
                    <span><strong>${esc(r.customer?.name || 'Sin nombre')}</strong><small>${esc(r.code || r.id)} · ${esc(fdate(r.date))} ${esc(ftime(r.time))} · ${esc(statusLabel(r))}</small></span>
                </button>`
              )
              .join('')
        : '<div class="search-empty">Sin resultados este año.</div>';
    $$('[data-hit]').forEach((b) => (b.onclick = () => pickSearch(searchMatches[Number(b.dataset.hit)])));
}

function pickSearch(r) {
    if (!r) return;
    searchResults.hidden = true;
    searchInput.value = '';
    searchInput.blur();
    $('#calendarDate').value = r.date;
    if (calendarMode !== 'day') setCalendarMode('day');
    else renderCalendar();
    openReservation(r.id);
}

searchInput.oninput = renderSearch;
searchInput.onfocus = renderSearch;
searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        pickSearch(searchMatches[0]);
    }
};
document.addEventListener('click', (e) => {
    if (!e.target.closest('.res-search')) searchResults.hidden = true;
});

/* =========================================================
   DETALLE DE RESERVA
   ========================================================= */

async function receipt(r) {
    const path = r.paymentProof?.path || r.proofPath || null;

    if (path) {
        try {
            return await getDownloadURL(ref(storage, path));
        } catch (error) {
            console.error('[ADMIN] No se pudo cargar el comprobante:', path, error);
            return '';
        }
    }

    // Compatibilidad con reservas viejas
    return r.payment?.receiptUrl || r.payment?.proofUrl || r.confirmation?.receiptUrl || r.receiptUrl || '';
}

function contactLinksHtml({ phone, email, message = '' }) {
    const wa = whatsappUrl(phone, message);
    const tel = telUrl(phone);
    if (!wa && !tel && !email) return '';
    return `<div class="contact-links">
        ${wa ? `<a class="ghost" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">WHATSAPP</a>` : ''}
        ${tel ? `<a class="ghost" href="${esc(tel)}">LLAMAR</a>` : ''}
        ${email ? `<a class="ghost" href="mailto:${esc(encodeURIComponent(email))}">CORREO</a>` : ''}
    </div>`;
}

function openDrawer() {
    $('#drawerBackdrop').hidden = false;
    $('#drawer').classList.add('open');
    $('#drawer').scrollTop = 0;
}

async function openReservation(id) {
    const r = reservations.find((x) => x.id === id);
    if (!r) {
        console.error('[ADMIN] Reserva no encontrada:', id);
        toast('No se encontró la reserva.', 'error');
        return;
    }
    drawerReservationId = id;

    const c = r.customer || {};
    const phone = c.phone || c.phoneNumber;
    const names =
        rr(r)
            .map((x) => (typeof x === 'string' ? x : x.name || `${x.type || 'Rig'} ${x.order ?? x.number ?? ''}`))
            .join(', ') || 'N/D';
    const [, endMinutes] = r.time ? reservationWindow(r) : [0, 0];
    const rejectionReason = r.confirmation?.rejectionReason;
    const message = r.code
        ? `Hola ${c.name || ''}, te escribimos de Simuladores Inercia sobre tu reserva ${r.code} del ${fdate(r.date)} a las ${ftime(r.time)}.`.replace(/\s+/g, ' ')
        : '';

    $('#reservationDetail').innerHTML = `
        <span class="eyebrow">RESERVA ${esc(r.code || '')}</span>
        <h2>${esc(c.name || 'Sin nombre')}</h2>
        ${r.noShow === true ? '<div class="noshow-banner">NO-SHOW: EL CLIENTE NO LLEGÓ</div>' : ''}
        <div class="status-pill ${esc(calendarStatus(r))}">${esc(statusLabel(r))}</div>
        ${rejectionReason ? `<p class="rejection-reason"><span>MOTIVO DEL RECHAZO</span>${esc(rejectionReason)}</p>` : ''}
        <div class="detail-grid">
            ${[
                ['CÓDIGO', r.code],
                ['CLIENTE', c.name],
                ['TELÉFONO', phone],
                ['CORREO', c.email],
                ['FECHA', r.date ? `${dayName(r.date)} ${fdate(r.date)}` : ''],
                ['HORA', r.time ? `${ftime(r.time)} – ${ftime(minutesToTime(endMinutes))}` : ''],
                ['DURACIÓN', `${r.duration || 1} H`],
                ['TOTAL', money(r.pricing?.total ?? r.total)],
                ['PAGO', paymentLabel(r.payment)],
                ['RIGS', names]
            ]
                .map((x) => `<div class="detail"><span>${x[0]}</span><strong>${esc(x[1] || 'N/D')}</strong></div>`)
                .join('')}
        </div>
        ${contactLinksHtml({ phone, email: c.email, message })}
        <div class="receipt" id="receiptBox">CARGANDO COMPROBANTE...</div>
        ${
            /*
             * EDITAR queda disponible en pending Y approved: una reserva
             * de PayPal (que se aprueba sola) puede necesitar la misma
             * corrección que una pendiente. RECHAZAR/APROBAR siguen siendo
             * solo para pending. Una rejected no se puede editar.
             */
            canEditReservation(r.status)
                ? `<div class="actions">
                    <button id="editReservation" class="ghost">EDITAR</button>
                    ${
                        r.status === 'pending'
                            ? '<button id="reject" class="danger">RECHAZAR</button><button id="approve" class="primary">APROBAR</button>'
                            : ''
                    }
                    ${noShowButton(r)}
                </div>`
                : ''
        }
    `;

    openDrawer();

    $('#approve')?.addEventListener('click', (e) => approve(r, e.currentTarget));
    $('#reject')?.addEventListener('click', (e) => reject(r, e.currentTarget));
    $('#editReservation')?.addEventListener('click', () => openEditReservation(r));
    $('#noShowBtn')?.addEventListener('click', (e) => toggleNoShow(r, e.currentTarget));

    // El comprobante se carga con el panel ya abierto: getDownloadURL puede
    // tardar, y antes el panel no aparecía hasta que respondía.
    const url = safeUrl(await receipt(r));
    const box = $('#receiptBox');
    if (!box || drawerReservationId !== id) return;
    box.innerHTML = url
        ? `${
              r.paymentProof?.contentType?.startsWith('image/') ? `<img src="${esc(url)}" alt="Comprobante de pago">` : ''
          }<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">VER COMPROBANTE COMPLETO</a>`
        : 'SIN COMPROBANTE ADJUNTO';
}

function closeDrawer() {
    drawerReservationId = null;
    $('#drawer').classList.remove('open');
    $('#drawerBackdrop').hidden = true;
}

$('#drawerClose').onclick = closeDrawer;
$('#drawerBackdrop').onclick = closeDrawer;

async function approve(r, button) {
    const ok = await withBusy(
        button,
        'APROBANDO...',
        () =>
            updateDoc(doc(db, 'reservations', r.id), {
                status: 'approved',
                'confirmation.status': 'approved',
                'confirmation.approvedAt': serverTimestamp(),
                'confirmation.approvedBy': currentUser.uid,
                updatedAt: serverTimestamp()
            }),
        { success: `Reserva ${r.code || ''} aprobada.`, error: 'No se pudo aprobar la reserva.' }
    );
    if (ok) closeDrawer();
}

// RECHAZAR pide confirmación y un motivo opcional, que queda guardado en
// confirmation.rejectionReason y se ve en el detalle y en el historial.
async function reject(r, button) {
    const answer = await confirmDialog({
        title: '¿RECHAZAR RESERVA?',
        message: `${r.customer?.name || 'Cliente'} · ${fdate(r.date)} ${ftime(r.time)}. Se liberan sus horarios.`,
        confirmLabel: 'RECHAZAR',
        danger: true,
        reason: true,
        reasonLabel: 'MOTIVO (OPCIONAL, QUEDA EN LA RESERVA)'
    });
    if (!answer) return;
    const ok = await withBusy(
        button,
        'RECHAZANDO...',
        async () => {
            const q = await getDocs(query(collection(db, 'reservationLocks'), where('reservationId', '==', r.id)));
            const b = writeBatch(db);
            b.update(doc(db, 'reservations', r.id), {
                status: 'rejected',
                'confirmation.status': 'rejected',
                'confirmation.rejectedAt': serverTimestamp(),
                'confirmation.rejectedBy': currentUser.uid,
                'confirmation.rejectionReason': answer.reason || null,
                updatedAt: serverTimestamp()
            });
            q.forEach((x) => b.delete(x.ref));
            await b.commit();
        },
        { success: `Reserva ${r.code || ''} rechazada.`, error: 'No se pudo rechazar la reserva.' }
    );
    if (ok) {
        userRows = null;
        closeDrawer();
    }
}

/* =========================================================
   FORMULARIO DE RESERVA (NUEVA / EDITAR)
   ========================================================= */

const timeOptionsHtml = (selected) =>
    calendarRowTimes()
        .map((value) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${ftime(value)}</option>`)
        .join('');

const durationOptionsHtml = (selected = 1) =>
    [1, 2, 3, 4]
        .map((h) => `<option value="${h}" ${Number(selected) === h ? 'selected' : ''}>${h} HORA${h > 1 ? 'S' : ''}</option>`)
        .join('');

const rigOptionsHtml = (availableRigs, name, checkedIds) =>
    availableRigs
        .map(
            (rig) => `<label class="admin-rig-option">
                <input type="checkbox" name="${name}" value="${esc(rig.id)}" ${checkedIds.has(rig.id) ? 'checked' : ''}>
                <span>${esc(displayRigName(rig))}</span>
                <small class="taken-label">OCUPADO</small>
            </label>`
        )
        .join('');

/*
 * Total y simuladores ocupados en vivo, compartido por NUEVA RESERVA y
 * EDITAR: los rigs que otra reserva ya tiene en esa fecha/hora/duración
 * quedan en gris y no se pueden marcar (antes NUEVA RESERVA no lo hacía y
 * solo avisaba al guardar). También avisa si el horario cae en un día
 * cerrado, fuera de horario o en un bloqueo, sin impedirlo: el admin
 * puede abrir a mano.
 */
function wireReservationForm({ prefix, availableRigs, reservation = null, currentRigIds = new Set() }) {
    const field = (k) => $(`#${prefix}${k}`);
    const rigInputs = () => $$(`input[name="${prefix}Rig"]`);

    function calculate() {
        const result = calculateReservationTotal({
            rigs: availableRigs,
            selectedIds: rigInputs()
                .filter((i) => i.checked)
                .map((i) => i.value),
            duration: field('Duration').value,
            date: field('Date').value
        });
        field('Total').textContent = result.tuesdayDiscount ? `${money(result.total)} (-50% MARTES)` : money(result.total);
        return result;
    }

    function warnings(date, time, duration) {
        const out = [];
        if (!date) return out;
        if (date < today()) out.push('La fecha ya pasó.');
        const hours = readHours(settings);
        if (!dayHours(hours, date)) {
            out.push(`El sitio tiene los ${dayName(date).toLowerCase()} cerrados.`);
            return out;
        }
        const start = hm(time);
        const rows = Array.from({ length: Number(duration) || 1 }, (_, i) => minutesToTime(start + i * 60));
        if (rows.some((t) => isRowClosed(hours, date, t))) out.push('Parte del horario cae fuera del horario de atención.');
        const lock = rows.map((t) => lockdownInRow(lockdowns, date, t)).find(Boolean);
        if (lock) out.push(`Hay un bloqueo ${ftime(lock.start)}–${ftime(lock.end)}${lock.reason ? ` (${lock.reason})` : ''}.`);
        return out;
    }

    function markTaken() {
        const date = field('Date').value;
        const time = field('Time').value;
        const duration = field('Duration').value;
        const taken = takenRigIds({
            reservation,
            currentRigIds: [...currentRigIds],
            reservations,
            date,
            time,
            duration,
            rigs: availableRigs,
            hasRig
        });
        rigInputs().forEach((input) => {
            const isTaken = taken.has(input.value);
            if (isTaken) input.checked = false;
            input.disabled = isTaken;
            input.closest('.admin-rig-option').classList.toggle('taken', isTaken);
        });

        const list = warnings(date, time, duration);
        const warn = field('Warn');
        warn.hidden = !list.length;
        warn.innerHTML = list.map((w) => `<span>${esc(w)}</span>`).join('');

        return calculate();
    }

    rigInputs().forEach((input) => input.addEventListener('change', calculate));
    ['Date', 'Time', 'Duration'].forEach((k) => field(k).addEventListener('change', markTaken));
    markTaken();
    return { calculate, markTaken };
}

function openEditReservation(r) {
    const availableRigs = activeRigs();
    const currentRigIds = new Set(availableRigs.filter((rig) => hasRig(r, rig)).map((rig) => rig.id));
    const paymentOptions = paymentOptionsFor(currentPaymentMethod(r));

    modal(`
        <span class="eyebrow">RESERVA ${esc(r.code || '')}</span>
        <h2>EDITAR RESERVA</h2>
        <form id="editReservationForm">
            <div class="form-row">
                <label>FECHA<input id="erDate" type="date" value="${esc(r.date)}" required></label>
                <label>HORA<select id="erTime" required>${timeOptionsHtml(r.time)}</select></label>
            </div>
            <label>DURACIÓN<select id="erDuration">${durationOptionsHtml(r.duration)}</select></label>
            <div>
                <label>SIMULADORES</label>
                <div class="admin-rig-select">${rigOptionsHtml(availableRigs, 'erRig', currentRigIds)}</div>
            </div>
            <label>MÉTODO DE PAGO
                <select id="erPayment">${paymentOptions
                    .map((o) => `<option value="${esc(o.value)}" ${o.selected ? 'selected' : ''}>${esc(o.label)}</option>`)
                    .join('')}</select>
            </label>
            <div id="erWarn" class="form-warn" hidden></div>
            <div class="manual-total"><span>TOTAL</span><strong id="erTotal">L 0</strong></div>
            <button type="submit" class="primary">GUARDAR CAMBIOS</button>
        </form>
    `);

    const form = wireReservationForm({ prefix: 'er', availableRigs, reservation: r, currentRigIds });

    /*
     * Reconcilia los reservationLocks viejos contra los nuevos dentro de
     * una transacción: solo se revisan los slots que la reserva NO tenía
     * ya; los que ya no hacen falta se liberan.
     */
    $('#editReservationForm').onsubmit = async (event) => {
        event.preventDefault();
        const { subtotal, tuesdayDiscount, total, selectedRigs } = form.calculate();
        if (!selectedRigs.length) return toast('Seleccioná al menos un simulador.', 'error');

        const ok = await withBusy(
            event.currentTarget.querySelector('button[type="submit"]'),
            'GUARDANDO...',
            () =>
                saveReservationEdit(firestore, {
                    reservation: r,
                    currentRigIds: [...currentRigIds],
                    date: $('#erDate').value,
                    time: $('#erTime').value,
                    duration: Number($('#erDuration').value),
                    selectedRigs,
                    paymentMethod: $('#erPayment').value,
                    pricing: { subtotal, tuesdayDiscount, total },
                    uid: auth.currentUser.uid
                }),
            { success: 'Cambios guardados.', error: 'No se pudieron guardar los cambios.' }
        );
        if (ok) {
            closeModal();
            closeDrawer();
        } else if ($('#editReservationForm')) {
            form.markTaken();
        }
    };
}

$('#newReservationBtn').onclick = () =>
    openNewReservation({ date: calendarMode === 'day' ? $('#calendarDate').value || today() : today() });

/*
 * NUEVA RESERVA. Desde una celda vacía del calendario llega con la fecha,
 * la hora y el simulador ya elegidos.
 */
function openNewReservation({ date = today(), time = '', rigId = '' } = {}) {
    const availableRigs = activeRigs();

    modal(`
        <span class="eyebrow">RESERVA ADMINISTRATIVA</span>
        <h2>NUEVA RESERVA</h2>
        <form id="manualReservationForm">
            <label>NOMBRE<input id="mrName" type="text" required autocomplete="off"></label>
            <div class="form-row">
                <label>USUARIO / CORREO<input id="mrUser" type="text" placeholder="Opcional" autocomplete="off"></label>
                <label>TELÉFONO<input id="mrPhone" type="tel" placeholder="Opcional" autocomplete="off"></label>
            </div>
            <div class="form-row">
                <label>FECHA<input id="mrDate" type="date" value="${esc(date)}" required></label>
                <label>HORA<select id="mrTime" required>${timeOptionsHtml(time)}</select></label>
            </div>
            <label>DURACIÓN<select id="mrDuration">${durationOptionsHtml(1)}</select></label>
            <div>
                <label>SIMULADORES</label>
                <div class="admin-rig-select">${rigOptionsHtml(availableRigs, 'mrRig', new Set(rigId ? [rigId] : []))}</div>
            </div>
            <div class="form-row">
                <label>MÉTODO DE PAGO
                    <select id="mrPayment">
                        <option value="efectivo">EFECTIVO</option>
                        <option value="transferencia">TRANSFERENCIA</option>
                        <option value="tarjeta">TARJETA</option>
                    </select>
                </label>
                <label>ESTADO
                    <select id="mrStatus">
                        <option value="approved">APROBADA</option>
                        <option value="pending">PENDIENTE</option>
                    </select>
                </label>
            </div>
            <div id="mrWarn" class="form-warn" hidden></div>
            <div class="manual-total"><span>TOTAL</span><strong id="mrTotal">L 0</strong></div>
            <button type="submit" class="primary">CREAR RESERVA</button>
        </form>
    `);

    const form = wireReservationForm({ prefix: 'mr', availableRigs });
    $('#mrName').focus();

    $('#manualReservationForm').onsubmit = async (event) => {
        event.preventDefault();
        const { subtotal, tuesdayDiscount, total, selectedRigs } = form.calculate();
        const name = $('#mrName').value.trim();
        if (!name) return toast('Ingresá el nombre del cliente.', 'error');
        if (!selectedRigs.length) return toast('Seleccioná al menos un simulador.', 'error');

        /*
         * En una transacción: primero se revisa que ningún simulador elegido
         * tenga ya un lock activo para ese horario (igual que
         * api/reservations/create.js en el sitio público), y solo si todos
         * están libres se crea la reserva junto con sus reservationLocks.
         */
        const code = `ADM-${Date.now().toString().slice(-6)}`;
        const date = $('#mrDate').value;
        const ok = await withBusy(
            event.currentTarget.querySelector('button[type="submit"]'),
            'CREANDO...',
            () =>
                createManualReservation(firestore, {
                    date,
                    time: $('#mrTime').value,
                    duration: Number($('#mrDuration').value),
                    selectedRigs,
                    customer: { name, email: $('#mrUser').value.trim(), phone: $('#mrPhone').value.trim() },
                    paymentMethod: $('#mrPayment').value,
                    status: $('#mrStatus').value,
                    code,
                    uid: auth.currentUser.uid,
                    pricing: { subtotal, tuesdayDiscount, total }
                }),
            { success: `Reserva ${code} creada.`, error: 'No se pudo crear la reserva.' }
        );
        if (ok) {
            closeModal();
            // Mostrar el día de la reserva recién creada.
            $('#calendarDate').value = date;
            renderCalendar();
        } else if ($('#manualReservationForm')) {
            form.markTaken();
        }
    };
}

/* =========================================================
   RIGS
   ========================================================= */

function status(s) {
    return { active: 'DISPONIBLE', maintenance: 'MANTENIMIENTO', disabled: 'DESACTIVADO' }[s] || 'DISPONIBLE';
}

function renderRigs() {
    const prices = readPrices(settings);
    const c = {
        total: rigs.length,
        active: rigs.filter((x) => (x.status || 'active') === 'active').length,
        maintenance: rigs.filter((x) => x.status === 'maintenance').length,
        disabled: rigs.filter((x) => x.status === 'disabled').length
    };
    $('#rigMetrics').innerHTML = [
        ['TOTAL', c.total],
        ['DISPONIBLES', c.active],
        ['MANTENIMIENTO', c.maintenance],
        ['DESACTIVADOS', c.disabled]
    ]
        .map((x) => `<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`)
        .join('');
    $('#rigList').innerHTML = rigs.length
        ? rigs
              .map((r) => {
                  const type = normalizeRigType(r.type);
                  return `<div class="rig"><div class="num">${esc(String(r.order ?? '--').padStart(2, '0'))}</div><div><strong>${esc(r.name)} <span class="status ${esc(r.status)}">${status(r.status)}</span></strong><small>${esc(type.toUpperCase())} · ${money(prices[type])}/H</small></div><button class="mini" data-edit="${esc(r.id)}">EDITAR</button></div>`;
              })
              .join('')
        : '<div class="empty-admin">NO HAY RIGS CREADOS</div>';
    $$('[data-edit]').forEach((b) => (b.onclick = () => rigModal(rigs.find((x) => x.id === b.dataset.edit))));
}

$('#newRigBtn').onclick = () => rigModal();

function rigModal(r) {
    const prices = readPrices(settings);
    modal(
        `<span class="eyebrow">${r ? 'MODIFICAR' : 'NUEVO'} RIG</span><h2>${r ? 'EDITAR' : 'CREAR'} SIMULADOR</h2>
        <form id="rigForm">
            <label>NOMBRE<input id="rn" value="${esc(r?.name || '')}" required></label>
            <div class="form-row">
                <label>ORDEN<input id="ro" type="number" min="1" value="${esc(r?.order ?? '')}" required></label>
                <label>TIPO<select id="rt"><option value="standard">STANDARD</option><option value="premium" ${normalizeRigType(r?.type) === 'premium' ? 'selected' : ''}>PREMIUM</option></select></label>
            </div>
            <p class="settings-description">El precio por hora es el de su tipo (Standard ${money(prices.standard)} · Premium ${money(prices.premium)}) y se cambia en CONFIGURACIÓN, igual para el sitio y el panel.</p>
            <label>ESTADO<select id="rs"><option value="active">DISPONIBLE</option><option value="maintenance" ${r?.status === 'maintenance' ? 'selected' : ''}>MANTENIMIENTO</option><option value="disabled" ${r?.status === 'disabled' ? 'selected' : ''}>DESACTIVADO</option></select></label>
            <button class="primary" type="submit">GUARDAR</button>
            ${r ? '<button type="button" id="delRig" class="danger">ELIMINAR</button>' : ''}
        </form>`
    );
    $('#rn').focus();
    $('#rigForm').onsubmit = async (e) => {
        e.preventDefault();
        const d = {
            name: $('#rn').value.trim(),
            order: +$('#ro').value,
            type: $('#rt').value,
            status: $('#rs').value,
            updatedAt: serverTimestamp()
        };
        const ok = await withBusy(
            e.currentTarget.querySelector('button[type="submit"]'),
            'GUARDANDO...',
            () => (r ? updateDoc(doc(db, 'rigs', r.id), d) : addDoc(collection(db, 'rigs'), { ...d, createdAt: serverTimestamp() })),
            { success: r ? 'Rig actualizado.' : 'Rig creado.', error: 'No se pudo guardar el rig.' }
        );
        if (ok) closeModal();
    };
    $('#delRig')?.addEventListener('click', async (e) => {
        const button = e.currentTarget;
        const answer = await confirmDialog({
            title: '¿ELIMINAR ESTE RIG?',
            message: `${r.name}. Las reservas que ya lo tienen no cambian. Si solo está fuera de servicio, mejor ponelo en MANTENIMIENTO o DESACTIVADO.`,
            confirmLabel: 'ELIMINAR',
            danger: true
        });
        if (!answer) return;
        const ok = await withBusy(button, 'ELIMINANDO...', () => deleteDoc(doc(db, 'rigs', r.id)), {
            success: 'Rig eliminado.',
            error: 'No se pudo eliminar el rig.'
        });
        if (ok) closeModal();
    });
}

/* =========================================================
   VENTAS

   Los filtros de esta vista se buscan por [data-range]: antes el
   selector era `.filter`, que también agarraba los botones CON SALDO /
   REEMBOLSADAS / TODAS de REEMBOLSOS y les pisaba el click.
   ========================================================= */

$$('[data-range]').forEach(
    (b) =>
        (b.onclick = () => {
            $$('[data-range]').forEach((x) => x.classList.toggle('active', x === b));
            range = b.dataset.range;
            $('#customRange').hidden = range !== 'custom';
            if (range === 'custom') {
                if (!$('#salesFrom').value) $('#salesFrom').value = `${today().slice(0, 8)}01`;
                if (!$('#salesTo').value) $('#salesTo').value = today();
                applyCustomRange();
            } else {
                renderSales();
            }
        })
);

$('#salesFrom').onchange = applyCustomRange;
$('#salesTo').onchange = applyCustomRange;

/*
 * Rango PERSONALIZADO. Si empieza antes del año en curso (lo que traen
 * los listeners), esos meses se leen aparte, una sola vez por cambio.
 */
let archiveRequest = 0;

async function applyCustomRange() {
    customRange = { from: $('#salesFrom').value, to: $('#salesTo').value };
    if (customRange.from && customRange.to && customRange.to < customRange.from) {
        toast('La fecha final es anterior a la inicial.', 'error');
        return;
    }
    const yearStartDate = `${new Date().getFullYear()}-01-01`;
    const request = ++archiveRequest;
    archive = { reservations: [], sales: [] };
    if (customRange.from && customRange.from < yearStartDate) {
        $('#salesTable').innerHTML = '<tr><td colspan="5">Cargando ventas anteriores...</td></tr>';
        try {
            const until = customRange.to && customRange.to < yearStartDate ? customRange.to : addDays(yearStartDate, -1);
            const [y, m, d] = until.split('-').map(Number);
            const [rs, ss] = await Promise.all([
                getDocs(query(collection(db, 'reservations'), where('date', '>=', customRange.from), where('date', '<=', until))),
                getDocs(
                    query(
                        collection(db, 'sales'),
                        where('createdAt', '>=', Timestamp.fromDate(new Date(`${customRange.from}T00:00`))),
                        where('createdAt', '<', Timestamp.fromDate(new Date(y, m - 1, d + 1)))
                    )
                )
            ]);
            if (request !== archiveRequest) return;
            archive = {
                reservations: rs.docs.map((x) => ({ id: x.id, ...x.data() })),
                sales: ss.docs.map((x) => ({ id: x.id, ...x.data() }))
            };
        } catch (error) {
            toastError(error, 'No se pudieron cargar las ventas anteriores.');
        }
    }
    if (request === archiveRequest) renderSales();
}

function salesRows() {
    const byId = (list) => [...new Map(list.map((x) => [x.id, x])).values()];
    const allReservations = range === 'custom' ? byId([...archive.reservations, ...reservations]) : reservations;
    const allSales = range === 'custom' ? byId([...archive.sales, ...sales]) : sales;
    const a = allReservations
        .filter((r) => r.status === 'approved')
        .map((r) => ({
            id: r.id,
            type: 'reservation',
            description: `Reserva ${r.code || r.id}${r.customer?.name ? ` · ${r.customer.name}` : ''}`,
            total: +(r.pricing?.total || 0),
            paymentMethod: typeof r.payment === 'string' ? r.payment : r.payment?.method,
            date: dt(r.confirmation?.approvedAt) || dt(r.updatedAt) || dt(r.createdAt)
        }));
    const b = allSales.map((s) => ({ ...s, type: s.type || 'manual', date: dt(s.createdAt), total: +s.total || 0 }));
    return [...a, ...b]
        .filter((x) => isInSalesRange(x.date, range, new Date(), customRange))
        .sort((x, y) => y.date - x.date);
}

function renderSales() {
    const rows = salesRows();
    lastSalesRows = rows;
    const total = rows.reduce((sum, x) => sum + x.total, 0);
    $('#salesMetrics').innerHTML = [
        ['VENTAS TOTALES', money(total)],
        ['TRANSACCIONES', rows.length],
        ['PROMEDIO', money(rows.length ? total / rows.length : 0)],
        ['RESERVAS', rows.filter((x) => x.type === 'reservation').length]
    ]
        .map((x) => `<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`)
        .join('');

    $('#paymentBreakdown').innerHTML = paymentBreakdown(rows)
        .map(
            (p) => `<div class="breakdown-item">
                <span>${esc(p.label)}</span>
                <strong>${money(p.total)}</strong>
                <small>${plural(p.count, 'TRANSACCIÓN', 'TRANSACCIONES')} · ${total ? Math.round((p.total / total) * 100) : 0}%</small>
                <div class="bar"><i style="width:${total ? Math.round((p.total / total) * 100) : 0}%"></i></div>
            </div>`
        )
        .join('');

    $('#salesTable').innerHTML = rows.length
        ? rows
              .map(
                  (s) =>
                      `<tr><td>${s.date ? s.date.toLocaleDateString('es-HN') : 'N/D'}</td><td>${esc(saleDescription(s))}</td><td>${esc(paymentLabel(s.paymentMethod))}</td><td>${s.type === 'reservation' ? 'RESERVA' : 'MANUAL'}</td><td>${money(s.total)}</td></tr>`
              )
              .join('')
        : '<tr><td colspan="5">No hay ventas en este período.</td></tr>';
    $('#exportSalesBtn').disabled = !rows.length;
}

$('#exportSalesBtn').onclick = () => {
    if (!lastSalesRows.length) return;
    const label = range === 'custom' ? `${customRange.from || 'inicio'}_a_${customRange.to || 'hoy'}` : `${range}_${today()}`;
    const blob = new Blob([salesCsv(lastSalesRows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ventas_inercia_${label}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${plural(lastSalesRows.length, 'venta exportada', 'ventas exportadas')}.`);
};

$('#newSaleBtn').onclick = () => {
    const activeProducts = products.filter((product) => product.active !== false);

    modal(`
        <span class="eyebrow">VENTA ADMINISTRATIVA</span>
        <h2>NUEVA VENTA</h2>
        <form id="saleForm">
            <label>PRODUCTO
                <select id="saleProduct">
                    <option value="">OTRO / MANUAL</option>
                    ${activeProducts.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} — ${money(p.price)}</option>`).join('')}
                </select>
            </label>
            <label>PRODUCTO / CONCEPTO<input id="sd" required autocomplete="off"></label>
            <div class="form-row">
                <label>CANTIDAD<input id="sq" type="number" min="1" step="1" value="1" required></label>
                <label>PRECIO UNITARIO<input id="sp" type="number" min="0" step="0.01" required></label>
            </div>
            <label>MÉTODO
                <select id="sm">
                    <option value="efectivo">EFECTIVO</option>
                    <option value="transferencia">TRANSFERENCIA</option>
                    <option value="tarjeta">TARJETA</option>
                </select>
            </label>
            <div class="manual-total"><span>TOTAL</span><strong id="saleTotal">L 0</strong></div>
            <button class="primary" type="submit">REGISTRAR VENTA</button>
        </form>
    `);

    const calculate = () => {
        $('#saleTotal').textContent = money((Number($('#sq').value) || 0) * (Number($('#sp').value) || 0));
    };

    $('#saleProduct').onchange = (e) => {
        const product = products.find((p) => p.id === e.target.value);
        $('#sd').value = product ? product.name : '';
        $('#sp').value = product ? Number(product.price || 0) : '';
        calculate();
    };
    $('#sq').oninput = calculate;
    $('#sp').oninput = calculate;
    $('#saleProduct').focus();

    $('#saleForm').onsubmit = async (e) => {
        e.preventDefault();
        const quantity = Number($('#sq').value);
        const unitPrice = Number($('#sp').value);
        if (!(quantity > 0) || !(unitPrice >= 0)) return toast('Revisá la cantidad y el precio.', 'error');
        const total = Math.round(quantity * unitPrice * 100) / 100;
        const ok = await withBusy(
            e.currentTarget.querySelector('button[type="submit"]'),
            'REGISTRANDO...',
            () =>
                addDoc(collection(db, 'sales'), {
                    type: 'manual',
                    productId: $('#saleProduct').value || null,
                    description: $('#sd').value.trim(),
                    quantity,
                    unitPrice,
                    total,
                    paymentMethod: $('#sm').value,
                    createdBy: auth.currentUser.uid,
                    createdAt: serverTimestamp()
                }),
            { success: `Venta registrada: ${money(total)}.`, error: 'No se pudo registrar la venta.' }
        );
        if (ok) closeModal();
    };
};

/* =========================================================
   MODAL
   ========================================================= */

function modal(h) {
    productsModalOpen = false;
    $('#modalContent').innerHTML = h;
    $('#modalBackdrop').hidden = false;
}

function closeModal() {
    productsModalOpen = false;
    $('#modalBackdrop').hidden = true;
    $('#modalContent').innerHTML = '';
}

$('#modalClose').onclick = closeModal;
$('#modalBackdrop').onclick = (e) => {
    if (e.target === $('#modalBackdrop')) closeModal();
};

/* =========================================================
   CONFIGURACIÓN

   Guarda en las claves que lee el sitio público (prices, hours). Ver
   js/settings-logic.js.
   ========================================================= */

function renderHoursForm() {
    const hours = readHours(settings);
    $('#hoursTable').innerHTML = WEEK_DAYS.map(([day, label]) => {
        const entry = hours[day];
        return `<div class="hours-row${entry ? '' : ' is-closed'}" data-day="${day}">
            <strong>${label}</strong>
            <label class="check"><input type="checkbox" data-closed ${entry ? '' : 'checked'}>CERRADO</label>
            <input type="time" data-open value="${esc(entry?.[0] || '14:00')}" ${entry ? '' : 'disabled'} aria-label="${label} apertura">
            <input type="time" data-close value="${esc(entry?.[1] || '21:00')}" ${entry ? '' : 'disabled'} aria-label="${label} cierre">
        </div>`;
    }).join('');
    $$('#hoursTable [data-closed]').forEach(
        (box) =>
            (box.onchange = () => {
                const row = box.closest('.hours-row');
                row.classList.toggle('is-closed', box.checked);
                row.querySelectorAll('input[type="time"]').forEach((i) => (i.disabled = box.checked));
            })
    );
}

function renderSettingsForms() {
    const prices = readPrices(settings);
    $('#standardPrice').value = prices.standard;
    $('#premiumPrice').value = prices.premium;
    renderHoursForm();
}

async function loadSettings() {
    try {
        const s = await getDoc(doc(db, 'settings', 'reservations'));
        settings = s.exists() ? s.data() : {};
    } catch (error) {
        toastError(error, 'No se pudo cargar la configuración.');
    }
    renderSettingsForms();
    renderRigs();
    renderCalendar();
}

$('#pricingForm').onsubmit = async (e) => {
    e.preventDefault();
    const payload = buildPricesPayload({ standard: $('#standardPrice').value, premium: $('#premiumPrice').value });
    if (payload.error) return toast(payload.error, 'error');
    const ok = await withBusy(
        e.currentTarget.querySelector('button[type="submit"]'),
        'GUARDANDO...',
        () => setDoc(doc(db, 'settings', 'reservations'), { ...payload, updatedAt: serverTimestamp() }, { merge: true }),
        { success: 'Precios guardados. Ya aplican en el sitio.', error: 'No se pudieron guardar los precios.' }
    );
    if (ok) {
        settings = { ...settings, ...payload };
        renderRigs();
        renderCalendar();
    }
};

$('#scheduleForm').onsubmit = async (e) => {
    e.preventDefault();
    const rows = $$('#hoursTable .hours-row').map((row) => ({
        day: Number(row.dataset.day),
        closed: row.querySelector('[data-closed]').checked,
        open: row.querySelector('[data-open]').value,
        close: row.querySelector('[data-close]').value
    }));
    const payload = buildHoursPayload(rows);
    if (payload.error) return toast(payload.error, 'error');
    const ok = await withBusy(
        e.currentTarget.querySelector('button[type="submit"]'),
        'GUARDANDO...',
        () => setDoc(doc(db, 'settings', 'reservations'), { ...payload, updatedAt: serverTimestamp() }, { merge: true }),
        { success: 'Horario guardado. Ya aplica en el sitio.', error: 'No se pudo guardar el horario.' }
    );
    if (ok) {
        settings = { ...settings, hours: { ...(settings.hours || {}), ...payload.hours } };
        renderCalendar();
    }
};

/* =========================================================
   PRODUCTOS
   ========================================================= */

$('#manageProductsBtn').onclick = () => renderProductsModal();

function renderProductsModal() {
    const scroll = $('.product-admin-list')?.scrollTop || 0;
    modal(`
        <span class="eyebrow">CATÁLOGO INTERNO</span>
        <h2>PRODUCTOS</h2>
        <form id="productForm">
            <div class="form-row">
                <label>NOMBRE<input id="productName" required autocomplete="off"></label>
                <label>PRECIO<input id="productPrice" type="number" min="0" step="0.01" required></label>
            </div>
            <button class="primary" type="submit">AGREGAR PRODUCTO</button>
        </form>
        <div class="product-admin-list">
            ${
                products.length
                    ? products
                          .map(
                              (p) => `<form class="product-admin-item${p.active === false ? ' inactive' : ''}" data-product="${esc(p.id)}">
                                <input name="name" value="${esc(p.name)}" required aria-label="Nombre">
                                <input name="price" type="number" min="0" step="0.01" value="${esc(p.price)}" required aria-label="Precio">
                                <div class="product-actions">
                                    <button type="submit" class="mini">GUARDAR</button>
                                    <button type="button" class="mini" data-toggle>${p.active === false ? 'ACTIVAR' : 'DESACTIVAR'}</button>
                                    <button type="button" class="danger mini" data-delete>ELIMINAR</button>
                                </div>
                            </form>`
                          )
                          .join('')
                    : '<div class="empty-admin">NO HAY PRODUCTOS CREADOS</div>'
            }
        </div>
        <p class="settings-description">Los productos desactivados no aparecen en NUEVA VENTA, pero las ventas ya registradas no cambian.</p>
    `);
    productsModalOpen = true;
    const list = $('.product-admin-list');
    if (list) list.scrollTop = scroll;

    $('#productForm').onsubmit = async (e) => {
        e.preventDefault();
        const name = $('#productName').value.trim();
        const price = Number($('#productPrice').value);
        if (!name || !(price >= 0)) return toast('Revisá el nombre y el precio.', 'error');
        await withBusy(
            e.currentTarget.querySelector('button[type="submit"]'),
            'AGREGANDO...',
            () =>
                addDoc(collection(db, 'products'), {
                    name,
                    price,
                    active: true,
                    createdBy: auth.currentUser.uid,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                }),
            { success: `${name} agregado.`, error: 'No se pudo agregar el producto.' }
        );
    };

    $$('.product-admin-item').forEach((item) => {
        const id = item.dataset.product;
        const product = products.find((p) => p.id === id);
        item.onsubmit = async (e) => {
            e.preventDefault();
            const name = item.elements.name.value.trim();
            const price = Number(item.elements.price.value);
            if (!name || !(price >= 0)) return toast('Revisá el nombre y el precio.', 'error');
            await withBusy(
                item.querySelector('button[type="submit"]'),
                '...',
                () => updateDoc(doc(db, 'products', id), { name, price, updatedAt: serverTimestamp() }),
                { success: 'Producto actualizado.', error: 'No se pudo actualizar el producto.' }
            );
        };
        item.querySelector('[data-toggle]').onclick = (e) =>
            withBusy(
                e.currentTarget,
                '...',
                () => updateDoc(doc(db, 'products', id), { active: product?.active === false, updatedAt: serverTimestamp() }),
                {
                    success: product?.active === false ? 'Producto activado.' : 'Producto desactivado.',
                    error: 'No se pudo cambiar el producto.'
                }
            );
        item.querySelector('[data-delete]').onclick = async (e) => {
            const button = e.currentTarget;
            const answer = await confirmDialog({
                title: '¿ELIMINAR PRODUCTO?',
                message: `${product?.name || ''}. Si solo no lo vendés por ahora, mejor desactivalo.`,
                confirmLabel: 'ELIMINAR',
                danger: true
            });
            if (!answer) return;
            await withBusy(button, '...', () => deleteDoc(doc(db, 'products', id)), {
                success: 'Producto eliminado.',
                error: 'No se pudo eliminar el producto.'
            });
        };
    });
}

/* =========================================================
   BLOQUEOS DE HORARIO
   ========================================================= */

const lockdownForm = $('#lockdownForm');
const lockdownList = $('#lockdownList');
$('#lockdownDate').value = today();

function lockdownItem(lock) {
    return `<div class="lockdown-item">
        <div class="lockdown-date">
            <strong>${esc(dayName(lock.date))} ${esc(fdate(lock.date))}</strong>
            <span>${esc(ftime(lock.start))} — ${esc(ftime(lock.end))}</span>
        </div>
        <div class="lockdown-info">${lock.reason ? `<small>${esc(lock.reason)}</small>` : ''}</div>
        <button type="button" class="danger lockdown-delete" data-id="${esc(lock.id)}">ELIMINAR</button>
    </div>`;
}

// Los próximos primero; los que ya pasaron quedan plegados abajo.
function renderLockdowns() {
    const upcoming = lockdowns.filter((l) => String(l.date || '') >= today());
    const past = lockdowns.filter((l) => String(l.date || '') < today()).reverse();

    lockdownList.innerHTML = `
        ${upcoming.length ? upcoming.map(lockdownItem).join('') : '<div class="lockdown-empty">NO HAY BLOQUEOS PROGRAMADOS</div>'}
        ${
            past.length
                ? `<details class="lockdown-past"><summary>${plural(past.length, 'BLOQUEO PASADO', 'BLOQUEOS PASADOS')}</summary>${past
                      .map(lockdownItem)
                      .join('')}</details>`
                : ''
        }
    `;

    $$('.lockdown-delete').forEach((button) => {
        button.onclick = async () => {
            const answer = await confirmDialog({ title: '¿ELIMINAR ESTE BLOQUEO?', confirmLabel: 'ELIMINAR', danger: true });
            if (!answer) return;
            await withBusy(button, '...', () => deleteDoc(doc(db, 'availabilityLockdowns', button.dataset.id)), {
                success: 'Bloqueo eliminado.',
                error: 'No se pudo eliminar el bloqueo.'
            });
        };
    });
}

lockdownForm.onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const date = $('#lockdownDate').value;
    const start = $('#lockdownStart').value;
    const end = $('#lockdownEnd').value;
    const reason = $('#lockdownReason').value.trim();

    if (!date || !start || !end) return toast('Completá la fecha y las horas.', 'error');
    if (end <= start) return toast('La hora final debe ser posterior a la hora inicial.', 'error');

    // Un bloqueo no cancela las reservas que ya hay: avisar antes.
    const affected = reservations.filter((r) => {
        if (r.date !== date || !isCalendarReservation(r)) return false;
        const [a, b] = reservationWindow(r);
        return a < hm(end) && hm(start) < b;
    });
    if (affected.length) {
        const answer = await confirmDialog({
            title: 'YA HAY RESERVAS EN ESE HORARIO',
            message: `${plural(affected.length, 'reserva', 'reservas')} (${affected
                .map((r) => r.customer?.name || r.code)
                .join(', ')}) ${affected.length === 1 ? 'no se cancela sola' : 'no se cancelan solas'}. ¿Bloquear igual?`,
            confirmLabel: 'BLOQUEAR IGUAL'
        });
        if (!answer) return;
    }

    const ok = await withBusy(
        submit,
        'BLOQUEANDO...',
        () =>
            addDoc(collection(db, 'availabilityLockdowns'), {
                date,
                start,
                end,
                reason: reason || null,
                active: true,
                createdBy: auth.currentUser?.uid || null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }),
        { success: 'Horario bloqueado.', error: 'No se pudo crear el bloqueo.' }
    );
    if (ok) {
        lockdownForm.reset();
        $('#lockdownDate').value = today();
    }
};

/* =========================================================
   USUARIOS

   Todos los usuarios registrados (users/{uid}) con su reputación. La
   lógica y las lecturas viven en js/user-reputation.js. Se cargan una
   sola vez al abrir la vista (no hay listener), porque cada lectura
   cuenta contra la cuota de Firestore; ACTUALIZAR vuelve a leer. Tocar
   una fila abre el historial de reservas de ese usuario.
   ========================================================= */

const userDeps = { db, collection, query, where, getDocs, doc, updateDoc, serverTimestamp };

async function loadUsers() {
    if (usersLoading) return;
    usersLoading = true;
    $('#usersTable').innerHTML = '<tr><td colspan="7">Cargando usuarios...</td></tr>';
    try {
        userRows = await loadUserReputation(userDeps);
    } catch (error) {
        console.error('[USUARIOS]', error);
        userRows = null;
        $('#usersTable').innerHTML = '<tr><td colspan="7">No se pudieron cargar los usuarios.</td></tr>';
        $('#userCount').textContent = '';
        return;
    } finally {
        usersLoading = false;
    }
    renderUsers();
}

function renderUsers() {
    if (!userRows) return;
    const rows = filterUserRows(userRows, $('#userSearch').value);
    $('#userCount').textContent =
        rows.length === userRows.length ? `${userRows.length} USUARIOS` : `${rows.length} DE ${userRows.length} USUARIOS`;
    $('#usersTable').innerHTML = rows.length
        ? rows
              .map(
                  (u) =>
                      `<tr class="clickable" data-user="${esc(u.id)}" tabindex="0"><td>${esc(u.name || 'N/D')}</td><td>${esc(u.email || 'N/D')}</td><td>${esc(u.phone || 'N/D')}</td><td>${esc(u.createdAt ? dt(u.createdAt).toLocaleDateString('es-HN') : 'N/D')}</td><td>${u.rejected}</td><td>${u.noShows}</td><td><strong class="rep rep-${u.reputation}">${u.reputation}/${MAX_REPUTATION}</strong></td></tr>`
              )
              .join('')
        : '<tr><td colspan="7">No hay usuarios que coincidan.</td></tr>';
    $$('[data-user]').forEach((tr) => {
        const open = () => openUserHistory(userRows.find((u) => u.id === tr.dataset.user));
        tr.onclick = open;
        tr.onkeydown = (e) => {
            if (e.key === 'Enter') open();
        };
    });
}

$('#refreshUsersBtn').onclick = loadUsers;
$('#userSearch').oninput = renderUsers;

/*
 * Historial de un usuario: sus reservas de todos los años, por uid (las
 * del sitio) y por correo (las manuales del panel se guardan sin uid).
 */
async function openUserHistory(user) {
    if (!user) return;
    drawerReservationId = null;
    $('#reservationDetail').innerHTML = `
        <span class="eyebrow">USUARIO</span>
        <h2>${esc(user.name || user.email || 'Sin nombre')}</h2>
        <div class="detail-grid">
            ${[
                ['CORREO', user.email],
                ['TELÉFONO', user.phone],
                ['REGISTRO', user.createdAt ? dt(user.createdAt).toLocaleDateString('es-HN') : ''],
                ['REPUTACIÓN', `${user.reputation}/${MAX_REPUTATION}`]
            ]
                .map((x) => `<div class="detail"><span>${x[0]}</span><strong>${esc(x[1] || 'N/D')}</strong></div>`)
                .join('')}
        </div>
        ${contactLinksHtml({ phone: user.phone, email: user.email })}
        <h3 class="history-title">RESERVAS</h3>
        <div id="userHistory" class="user-history">Cargando...</div>
    `;
    openDrawer();

    try {
        const reservationsRef = collection(db, 'reservations');
        const queries = [getDocs(query(reservationsRef, where('uid', '==', user.id)))];
        if (user.email) queries.push(getDocs(query(reservationsRef, where('customer.email', '==', user.email))));
        const snaps = await Promise.all(queries);
        const list = [...new Map(snaps.flatMap((s) => s.docs).map((d) => [d.id, { id: d.id, ...d.data() }])).values()].sort(
            (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.time).localeCompare(String(a.time))
        );
        const box = $('#userHistory');
        if (!box) return;
        const spent = list.filter((r) => r.status === 'approved').reduce((s, r) => s + Number(r.pricing?.total || 0), 0);
        box.innerHTML = list.length
            ? `<p class="history-summary">${plural(list.length, 'RESERVA', 'RESERVAS')} · ${money(spent)} EN APROBADAS</p>${list
                  .map(
                      (r) => `<button type="button" class="history-item" data-history="${esc(r.id)}" ${
                          reservations.some((x) => x.id === r.id) ? '' : 'disabled title="De un año anterior"'
                      }>
                        <i class="dot ${esc(calendarStatus(r))}"></i>
                        <span><strong>${esc(fdate(r.date))} · ${esc(ftime(r.time))} · ${esc(r.duration || 1)} H</strong><small>${esc(r.code || r.id)} · ${esc(statusLabel(r))} · ${money(r.pricing?.total ?? r.total)}${
                            r.confirmation?.rejectionReason ? ` · ${esc(r.confirmation.rejectionReason)}` : ''
                        }</small></span>
                    </button>`
                  )
                  .join('')}`
            : '<p class="history-summary">Sin reservas.</p>';
        $$('[data-history]').forEach((b) => (b.onclick = () => openReservation(b.dataset.history)));
    } catch (error) {
        console.error('[USUARIOS]', error);
        const box = $('#userHistory');
        if (box) box.textContent = 'No se pudo cargar el historial.';
    }
}

/*
 * NO-SHOW en el detalle de una reserva aprobada que ya empezó. Queda como
 * campo aparte (noShow) y no como status, así que la reserva sigue en el
 * calendario y en ventas; solo resta un punto de reputación.
 */
function noShowButton(r) {
    if (r.noShow === true) return '<button id="noShowBtn" class="ghost">QUITAR NO-SHOW</button>';
    if (r.status !== 'approved') return '';
    return canMarkNoShow(r)
        ? '<button id="noShowBtn" class="danger">MARCAR NO-SHOW</button>'
        : '<button class="danger" disabled title="Se puede marcar cuando empiece la reserva">MARCAR NO-SHOW</button>';
}

async function toggleNoShow(r, button) {
    const marking = r.noShow !== true;
    if (marking) {
        const answer = await confirmDialog({
            title: '¿MARCAR NO-SHOW?',
            message: 'Le resta un punto de reputación al cliente.',
            confirmLabel: 'MARCAR NO-SHOW',
            danger: true
        });
        if (!answer) return;
    }
    const ok = await withBusy(button, '...', () => setNoShow(userDeps, r, marking, currentUser.uid), {
        success: marking ? 'Marcada como no-show.' : 'No-show quitado.',
        error: 'No se pudo guardar el no-show.'
    });
    if (!ok) return;
    // La reputación cambió: la lista se vuelve a leer la próxima vez.
    userRows = null;
    closeDrawer();
}
