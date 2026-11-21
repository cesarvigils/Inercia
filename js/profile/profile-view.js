/*
 * js/profile/profile-view.js
 *
 * The PERFIL overlay, opened from the account menu (js/auth.js loads this
 * module on first use). Full-screen panel with the user's identity and
 * membership on top (with an inline "cancel membership" confirmation), then
 * MIS RESERVAS, personal records, race results and upcoming
 * events. Each section asks its own data module (identity.js,
 * membership.js, reservations.js, records.js, events.js) and renders one of: loading,
 * pending integration, unavailable, empty, or the data.
 *
 * Everything user- or sheet-provided is written with textContent, never
 * innerHTML. Styles: css/profile.css.
 */

import '../../css/profile.css';
import { loadIdentity, identityFromUser } from './identity.js';
import { loadMembership, PERIOD_LABELS } from './membership.js';
import { loadRecords, sortByLap } from './records.js';
import { loadEvents } from './events.js';
import { loadReservations } from './reservations.js';
import { postJson } from './api.js';
import { formatHour, formatDateLong } from '../../lib/time.js';

const DEFAULT_PFP =
    '/media/default-avatar.webp';

let root = null;
let lastFocus = null;
let openFor = null;
let currentUser = null;

/* ---------------------------------------------------------
   DOM helpers
   --------------------------------------------------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-HN', options).replace('.', '').toUpperCase();
}

function stateBlock(kind, title, text) {
    const block = el('div', `pf-state pf-state--${kind}`);
    block.append(el('p', 'pf-state-label', title));
    if (text) block.append(el('p', 'pf-state-text', text));
    return block;
}

function section(number, eyebrow, title) {
    const node = el('section', 'pf-section');
    const head = el('header', 'pf-section-head');
    const titles = el('div');
    titles.append(el('p', 'pf-eyebrow', eyebrow), el('h3', 'pf-section-title', title));
    head.append(titles, el('span', 'pf-section-num', number));
    const body = el('div', 'pf-section-body');
    body.append(stateBlock('loading', 'CARGANDO…'));
    node.append(head, body);
    return { node, body };
}

/* ---------------------------------------------------------
   Skeleton
   --------------------------------------------------------- */

function build() {
    root = el('div', 'profile-view');
    root.id = 'profileView';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-labelledby', 'pfName');
    root.hidden = true;

    const scroller = el('div', 'pf-scroll');
    const page = el('div', 'pf-page');

    const top = el('div', 'pf-top');
    const close = el('button', 'pf-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', 'Cerrar perfil');
    close.addEventListener('click', closeProfile);
    top.append(close);

    // Identity + membership
    const hero = el('div', 'pf-hero');

    const who = el('div', 'pf-who');
    const avatar = el('img', 'pf-avatar');
    avatar.alt = '';
    avatar.dataset.slot = 'avatar';
    const names = el('div', 'pf-names');
    const eyebrow = el('p', 'pf-eyebrow', 'PERFIL');
    const name = el('h2', 'pf-name');
    name.id = 'pfName';
    name.dataset.slot = 'name';
    const meta = el('p', 'pf-meta');
    meta.dataset.slot = 'meta';
    names.append(eyebrow, name, meta);
    who.append(avatar, names);

    const membership = el('div', 'pf-membership');
    membership.dataset.slot = 'membership';
    membership.append(stateBlock('loading', 'CARGANDO…'));

    hero.append(who, membership);

    const bookings = section('01', 'TUS SESIONES', 'MIS RESERVAS');
    bookings.node.dataset.slot = 'reservations';
    bookings.node.id = 'pfReservations';
    const records = section('02', 'TUS TIEMPOS', 'RÉCORDS PERSONALES');
    records.node.dataset.slot = 'records';
    const results = section('03', 'COMPETENCIA', 'RESULTADOS DE CARRERA');
    results.node.dataset.slot = 'results';
    const events = section('04', 'CALENDARIO', 'PRÓXIMOS EVENTOS');
    events.node.dataset.slot = 'events';

    const lower = el('div', 'pf-lower');
    lower.append(results.node, events.node);

    page.append(top, hero, bookings.node, records.node, lower);
    scroller.append(page);
    root.append(scroller);
    document.body.append(root);

    root.addEventListener('keydown', onKeydown);
}

function slot(name) {
    return root.querySelector(`[data-slot="${name}"]`);
}

function sectionBody(name) {
    return slot(name).querySelector('.pf-section-body');
}

/* ---------------------------------------------------------
   Renderers
   --------------------------------------------------------- */

function renderIdentity(identity) {
    const avatar = slot('avatar');
    avatar.src = identity.photoURL || DEFAULT_PFP;
    avatar.referrerPolicy = 'no-referrer';

    slot('name').textContent = (identity.name || 'PILOTO').toUpperCase();

    const meta = slot('meta');
    meta.replaceChildren();
    if (identity.email) meta.append(el('span', null, identity.email));
    const since = identity.memberSince && formatDate(identity.memberSince, { month: 'long', year: 'numeric' });
    if (since) meta.append(el('span', null, `En Inercia desde ${since.toLowerCase()}`));
}

function tierLadder(level) {
    const ladder = el('span', 'pf-ladder');
    ladder.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 3; i += 1) {
        ladder.append(el('i', i <= level ? 'is-on' : null));
    }
    return ladder;
}

function renderMembership(result, { cancelled = false } = {}) {
    const box = slot('membership');
    box.replaceChildren();

    box.append(el('p', 'pf-label', 'MEMBRESÍA'));

    if (cancelled) {
        const done = el('p', 'pf-confirm-done', 'Listo: cancelaste tu membresía. No se te va a cobrar más.');
        done.setAttribute('role', 'status');
        box.append(done);
    }

    if (result.state !== 'ready') {
        box.append(stateBlock('unavailable', 'NO DISPONIBLE', 'No pudimos consultar tu membresía. Probá de nuevo en un rato.'));
        return;
    }

    const tierRow = el('div', 'pf-tier-row');
    const tierName = el('strong', 'pf-tier', result.tier ? result.tier.toUpperCase() : 'ACTIVA');
    tierName.dataset.tier = (result.tier || 'activa').toLowerCase();
    tierRow.append(tierName, tierLadder(result.level));
    box.append(tierRow);

    const details = el('dl', 'pf-tier-details');
    const addDetail = (label, value) => {
        if (!value) return;
        details.append(el('dt', null, label), el('dd', null, value));
    };

    if (result.active) {
        addDetail('PLAN', PERIOD_LABELS[result.period] || null);
        if (result.status === 'ACTIVE') {
            addDetail('PRÓXIMO COBRO', result.nextBillingTime && formatDate(result.nextBillingTime));
        } else {
            addDetail('ACTIVA HASTA', result.paidThrough && formatDate(result.paidThrough));
        }
    } else {
        details.append(el('dd', 'pf-tier-note', 'Sin membresía activa.'));
    }

    if (details.childElementCount) box.append(details);

    const actions = el('div', 'pf-membership-actions');
    const cta = el('a', result.active ? 'pf-link' : 'pf-cta', result.active ? 'VER PLANES' : 'SUSCRIBITE');
    cta.href = '/suscripcion';
    actions.append(cta);

    // Only a renewing membership can be cancelled (PayPal ACTIVE/SUSPENDED);
    // a cancelled one already shows "ACTIVA HASTA".
    if (result.active && (result.status === 'ACTIVE' || result.status === 'SUSPENDED')) {
        const cancel = el('button', 'pf-link pf-link--quiet', 'CANCELAR MEMBRESÍA');
        cancel.type = 'button';
        cancel.addEventListener('click', () => showCancelConfirm(box, result));
        actions.append(cancel);
    }

    box.append(actions);
}

/*
 * Inline confirmation inside the membership box (no modal on top of the
 * profile overlay — works better on phones). On "SÍ, CANCELAR" it calls
 * POST /api/subscription/cancel, then re-reads the full status so the box
 * shows "ACTIVA HASTA …".
 */
function showCancelConfirm(box, result) {
    if (box.querySelector('.pf-confirm')) return;

    const actions = box.querySelector('.pf-membership-actions');
    if (actions) actions.hidden = true;

    const until = result.nextBillingTime && formatDate(result.nextBillingTime);

    const confirm = el('div', 'pf-confirm');
    confirm.setAttribute('role', 'alertdialog');
    confirm.setAttribute('aria-labelledby', 'pfConfirmTitle');
    confirm.setAttribute('aria-describedby', 'pfConfirmText');

    const title = el('p', 'pf-confirm-title', '¿CANCELAR TU MEMBRESÍA?');
    title.id = 'pfConfirmTitle';
    const text = el(
        'p',
        'pf-confirm-text',
        until
            ? `No se te va a cobrar más. Seguís teniendo los beneficios hasta el ${until.toLowerCase()}.`
            : 'No se te va a cobrar más. Seguís teniendo los beneficios hasta el final del período que ya pagaste.'
    );
    text.id = 'pfConfirmText';
    const message = el('p', 'pf-confirm-error');
    message.setAttribute('role', 'alert');
    message.hidden = true;

    const buttons = el('div', 'pf-confirm-buttons');
    const yes = el('button', 'pf-confirm-yes', 'SÍ, CANCELAR');
    yes.type = 'button';
    const no = el('button', 'pf-confirm-no', 'NO, MANTENERLA');
    no.type = 'button';
    buttons.append(no, yes);

    confirm.append(title, text, message, buttons);
    box.append(confirm);
    no.focus();

    const close = () => {
        confirm.remove();
        if (actions) actions.hidden = false;
        box.querySelector('.pf-link--quiet')?.focus();
    };

    no.addEventListener('click', close);

    yes.addEventListener('click', async () => {
        const user = currentUser;
        if (!user) return;

        yes.disabled = true;
        no.disabled = true;
        yes.textContent = 'CANCELANDO…';
        yes.setAttribute('aria-busy', 'true');
        message.hidden = true;

        try {
            await postJson('/api/subscription/cancel', {}, { user });
            const fresh = await loadMembership(user);
            if (openFor === user.uid) renderMembership(fresh, { cancelled: true });
        } catch (error) {
            message.textContent = error.message && !error.message.startsWith('HTTP')
                ? error.message
                : 'No pudimos cancelarla. Probá de nuevo o escribinos por WhatsApp.';
            message.hidden = false;
            yes.disabled = false;
            no.disabled = false;
            yes.textContent = 'SÍ, CANCELAR';
            yes.removeAttribute('aria-busy');
        }
    });
}

/* ---------------------------------------------------------
   MIS RESERVAS
   --------------------------------------------------------- */

function rigSummary(item) {
    const parts = [];
    if (item.standard) parts.push(`${item.standard} Standard`);
    if (item.premium) parts.push(`${item.premium} Premium`);
    return parts.join(' · ') || 'Simuladores';
}

function money(value) {
    return `L ${Number(value).toLocaleString('es-HN', { maximumFractionDigits: 2 })}`;
}

function reservationItem(item) {
    const row = el('li', `pf-booking pf-booking--${item.status.key}`);

    const day = new Date(`${item.date}T12:00:00`);
    const date = el('div', 'pf-event-date');
    date.setAttribute('aria-hidden', 'true');
    date.append(
        el('strong', null, Number.isNaN(day.getTime()) ? '—' : String(day.getDate()).padStart(2, '0')),
        el('span', null, Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('es-HN', { month: 'short' }).replace('.', '').toUpperCase())
    );

    const info = el('div', 'pf-event-info');
    const when = [
        formatDateLong(item.date),
        item.time && formatHour(item.time),
        `${item.duration} ${item.duration === 1 ? 'hora' : 'horas'}`
    ].filter(Boolean).join(' · ');
    const what = [
        rigSummary(item),
        item.total !== null ? `${money(item.total)} + ISV` : null
    ].filter(Boolean).join(' · ');
    info.append(
        el('span', 'pf-event-name', when),
        el('span', 'pf-event-meta', what)
    );

    const status = el('span', 'pf-booking-status', item.status.label);

    row.append(date, info, status);
    return row;
}

function renderReservations(result) {
    const body = sectionBody('reservations');
    body.replaceChildren();

    if (result.state !== 'ready') {
        body.append(stateBlock('unavailable', 'NO DISPONIBLE', 'No pudimos cargar tus reservas. Probá de nuevo en un rato.'));
        return;
    }

    if (!result.upcoming.length) {
        body.append(stateBlock('empty', 'SIN RESERVAS PRÓXIMAS', 'Cuando reserves un simulador lo vas a ver acá.'));
    } else {
        const list = el('ul', 'pf-events pf-bookings');
        result.upcoming.forEach((item) => list.append(reservationItem(item)));
        body.append(list);
    }

    if (result.past.length) {
        const history = el('details', 'pf-history');
        history.append(el('summary', null, `ANTERIORES (${result.past.length})`));
        const list = el('ul', 'pf-events pf-bookings');
        result.past.forEach((item) => list.append(reservationItem(item)));
        history.append(list);
        body.append(history);
    }
}

function recordRow(record) {
    const row = el('tr');
    row.append(
        el('td', 'pf-cell-track', record.track),
        el('td', 'pf-cell-dim', record.category || '—'),
        el('td', 'pf-cell-time', record.lapTime),
        el('td', 'pf-cell-dim', (record.recordedAt && formatDate(record.recordedAt)) || record.period || '—'),
        el('td', 'pf-cell-dim', record.race ? record.race.event : '—')
    );
    return row;
}

/* byLap: fastest first (ACTUALES); otherwise kept as given (HISTÓRICOS, newest month first). */
function recordTable(records, { byLap = true } = {}) {
    const table = el('table', 'pf-table');
    const head = el('tr');
    ['CIRCUITO', 'CATEGORÍA', 'TIEMPO', 'FECHA', 'CARRERA'].forEach((label) => head.append(el('th', null, label)));
    const thead = el('thead');
    thead.append(head);
    const tbody = el('tbody');
    (byLap ? sortByLap(records) : records).forEach((record) => tbody.append(recordRow(record)));
    table.append(thead, tbody);
    return table;
}

function renderRecords(result) {
    const body = sectionBody('records');
    body.replaceChildren();

    const tabs = el('div', 'pf-tabs');
    tabs.setAttribute('role', 'tablist');
    const panel = el('div', 'pf-tab-panel');
    panel.setAttribute('role', 'tabpanel');

    const show = (which) => {
        tabs.querySelectorAll('button').forEach((button) => {
            const on = button.dataset.tab === which;
            button.classList.toggle('active', on);
            button.setAttribute('aria-selected', String(on));
            button.tabIndex = on ? 0 : -1;
        });

        panel.replaceChildren();

        if (result.state === 'pending') {
            panel.append(stateBlock(
                'pending',
                'PENDIENTE DE INTEGRACIÓN',
                which === 'current'
                    ? 'Tus récords vigentes van a aparecer acá cuando la tabla de tiempos identifique a cada piloto por su cuenta de Inercia.'
                    : 'Tu historial de tiempos va a aparecer acá cuando la tabla de tiempos identifique a cada piloto por su cuenta de Inercia.'
            ));
        } else if (result.state === 'unavailable') {
            panel.append(stateBlock('unavailable', 'NO DISPONIBLE', 'No pudimos cargar tus tiempos. Probá de nuevo en un rato.'));
        } else {
            const list = which === 'current' ? result.current : result.historical;
            panel.append(list.length
                ? recordTable(list, { byLap: which === 'current' })
                : stateBlock('empty', 'SIN REGISTROS', which === 'current'
                    ? 'No aparecés en la tabla de este mes. Si ya corriste, revisá que tu nombre ahí sea igual al de tu cuenta.'
                    : 'Todavía no tenés tiempos registrados este año.'));
        }
    };

    [['current', 'ACTUALES'], ['historical', 'HISTÓRICOS']].forEach(([key, label]) => {
        const button = el('button', 'pf-tab', label);
        button.type = 'button';
        button.dataset.tab = key;
        button.setAttribute('role', 'tab');
        button.addEventListener('click', () => show(key));
        button.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const next = key === 'current' ? 'historical' : 'current';
            show(next);
            tabs.querySelector(`[data-tab="${next}"]`).focus();
        });
        tabs.append(button);
    });

    body.append(tabs, panel);
    show('current');
}

function renderResults(result) {
    const body = sectionBody('results');
    body.replaceChildren();

    const races = result.state === 'ready'
        ? [...result.current, ...result.historical].filter((record) => record.race)
        : [];

    if (result.state === 'pending') {
        body.append(stateBlock('pending', 'PENDIENTE DE INTEGRACIÓN', 'Posiciones finales y sesiones de tus carreras, cuando estén conectadas a tu cuenta.'));
    } else if (result.state === 'unavailable') {
        body.append(stateBlock('unavailable', 'NO DISPONIBLE', 'No pudimos cargar tus resultados.'));
    } else if (!races.length) {
        // No race-results source is connected yet (records.js only has lap times).
        body.append(stateBlock('pending', 'PRÓXIMAMENTE', 'Las posiciones de tus carreras van a aparecer acá cuando los resultados estén cargados.'));
    } else {
        const list = el('ol', 'pf-races');
        races.forEach(({ race, lapTime }) => {
            const item = el('li', 'pf-race');
            item.append(
                el('span', 'pf-race-pos', race.position ? `P${race.position}` : '—'),
                el('span', 'pf-race-name', race.session ? `${race.event} · ${race.session}` : race.event),
                el('span', 'pf-race-meta', [race.date && formatDate(race.date), race.classification, lapTime && `Vuelta ${lapTime}`].filter(Boolean).join(' · '))
            );
            list.append(item);
        });
        body.append(list);
    }
}

function renderEvents(result) {
    const body = sectionBody('events');
    body.replaceChildren();

    if (result.state === 'pending') {
        body.append(stateBlock('pending', 'PENDIENTE DE INTEGRACIÓN', 'El calendario de eventos todavía no está conectado.'));
        return;
    }

    if (result.state === 'unavailable') {
        body.append(stateBlock('unavailable', 'NO DISPONIBLE', 'No pudimos cargar los eventos. Probá de nuevo en un rato.'));
        return;
    }

    if (!result.events.length) {
        body.append(stateBlock('empty', 'SIN EVENTOS PROGRAMADOS', 'Cuando haya un evento nuevo lo vas a ver acá.'));
        return;
    }

    const list = el('ul', 'pf-events');
    result.events.forEach((event) => {
        const item = el('li', 'pf-event');
        const date = el('div', 'pf-event-date');
        const day = new Date(`${event.date}T12:00:00`);
        date.append(
            el('strong', null, Number.isNaN(day.getTime()) ? '—' : String(day.getDate()).padStart(2, '0')),
            el('span', null, Number.isNaN(day.getTime()) ? '' : day.toLocaleDateString('es-HN', { month: 'short' }).replace('.', '').toUpperCase())
        );
        const info = el('div', 'pf-event-info');
        info.append(el('span', 'pf-event-name', event.name));
        // The Eventos sheet only has name + date (A/B) today; no empty meta line.
        const meta = [event.time, event.track, event.category].filter(Boolean).join(' · ');
        if (meta) info.append(el('span', 'pf-event-meta', meta));
        item.append(date, info);

        if (event.url) {
            const link = el('a', 'pf-link', event.status ? event.status.toUpperCase() : 'VER EVENTO');
            link.href = event.url;
            link.target = '_blank';
            link.rel = 'noopener';
            item.append(link);
        } else if (event.status) {
            item.append(el('span', 'pf-event-status', event.status.toUpperCase()));
        }

        list.append(item);
    });
    body.append(list);
}

/* ---------------------------------------------------------
   Open / close
   --------------------------------------------------------- */

function focusables() {
    return [...root.querySelectorAll('button, a[href], summary, [tabindex="0"]')]
        .filter((node) => !node.disabled && node.tabIndex !== -1 && node.getClientRects().length > 0);
}

function onKeydown(event) {
    if (event.key === 'Escape') {
        event.preventDefault();
        closeProfile();
        return;
    }

    if (event.key !== 'Tab') return;

    // Keep focus inside the dialog.
    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];

    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

export function openProfile(user) {
    if (!user) return;
    if (!root) build();

    lastFocus = document.activeElement;
    openFor = user.uid;
    currentUser = user;

    // Reset every section so one account's data never lingers for another.
    renderIdentity(identityFromUser(user));
    slot('membership').replaceChildren(el('p', 'pf-label', 'MEMBRESÍA'), stateBlock('loading', 'CARGANDO…'));
    ['reservations', 'records', 'results', 'events'].forEach((name) => {
        sectionBody(name).replaceChildren(stateBlock('loading', 'CARGANDO…'));
    });

    root.hidden = false;
    document.body.classList.add('profile-view-open');
    requestAnimationFrame(() => root.classList.add('open'));
    root.querySelector('.pf-close').focus();
    root.querySelector('.pf-scroll').scrollTop = 0;

    const uid = user.uid;
    const current = () => openFor === uid;

    loadIdentity(user).then((identity) => current() && renderIdentity(identity));
    loadMembership(user).then((result) => current() && renderMembership(result));
    loadReservations(user).then((result) => current() && renderReservations(result));
    loadRecords(user).then((result) => {
        if (!current()) return;
        renderRecords(result);
        renderResults(result);
    });
    loadEvents().then((result) => current() && renderEvents(result));
}

export function closeProfile() {
    if (!root || root.hidden) return;

    openFor = null;
    currentUser = null;
    root.classList.remove('open');
    document.body.classList.remove('profile-view-open');
    root.hidden = true;

    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
}
