/*
 * js/suscripcion.js
 *
 * Membership page (suscripcion.html).
 *   1. Lists the plans from GET /api/subscription/plans (tier, period and
 *      price as PayPal has them) as one comparison panel: pick the billing
 *      period, then Gold / Platino / Zafiro side by side.
 *   2. SUSCRIBIRME: a signed-out visitor gets the login modal (js/auth.js);
 *      a signed-in one gets POST /api/subscription/create { planId } and is
 *      sent to PayPal's approval page.
 *   3. PayPal sends the buyer back to /suscripcion?membresia=aprobada&
 *      subscription_id=I-... (or =cancelada). The page then calls POST
 *      /api/subscription/activate, which re-reads the subscription from
 *      PayPal before recording anything.
 * The current membership (GET /api/subscription/status) is shown above
 * the plans for a signed-in member. Nothing here grants access by itself.
 */

import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';

const TIERS = ['Gold', 'Platino', 'Zafiro'];
const PERIODS = [
    ['mensual', 'MENSUAL', '/ mes'],
    ['trimestral', 'TRIMESTRAL', 'cada 3 meses'],
    ['semestral', 'SEMESTRAL', 'cada 6 meses'],
    ['anual', 'ANUAL', 'al año']
];

const periodsEl = document.getElementById('subPeriods');
const tiersEl = document.getElementById('subTiers');
const noticeEl = document.getElementById('subNotice');

let plans = [];
let period = null;
let membership = null;
let busy = false;

document.getElementById('year').textContent = new Date().getFullYear();

/* ---------------------------------------------------------
   Helpers
   --------------------------------------------------------- */

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

async function api(path, { method = 'GET', body, user } = {}) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;

    const response = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => null);

    if (!response.ok || data === null) {
        const error = new Error(data?.error || 'No pudimos completar la operación.');
        error.status = response.status;
        throw error;
    }

    return data;
}

function notice(kind, title, text) {
    noticeEl.replaceChildren(el('strong', null, title));
    if (text) noticeEl.append(el('span', null, text));
    noticeEl.dataset.kind = kind;
    noticeEl.hidden = false;
}

function formatPrice(price) {
    const value = Number(price?.value);
    if (!Number.isFinite(value)) return '—';
    return `$${value.toFixed(2)}`;
}

function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-HN', { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '').toUpperCase();
}

/* ---------------------------------------------------------
   Rendering
   --------------------------------------------------------- */

function renderPeriods() {
    periodsEl.replaceChildren();

    const available = PERIODS.filter(([key]) => plans.some((plan) => plan.period === key));

    available.forEach(([key, label], index) => {
        const tab = el('button', 'sub-period', label);
        tab.type = 'button';
        tab.setAttribute('role', 'tab');
        tab.dataset.period = key;
        tab.setAttribute('aria-selected', String(key === period));
        tab.tabIndex = key === period ? 0 : -1;
        tab.classList.toggle('active', key === period);

        tab.addEventListener('click', () => {
            period = key;
            renderPeriods();
            renderTiers();
        });

        tab.addEventListener('keydown', (event) => {
            if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
            const step = event.key === 'ArrowRight' ? 1 : -1;
            period = available[(index + step + available.length) % available.length][0];
            renderPeriods();
            renderTiers();
            periodsEl.querySelector(`[data-period="${period}"]`)?.focus();
        });

        periodsEl.append(tab);
    });
}

function tierLadder(level) {
    const ladder = el('span', 'sub-ladder');
    ladder.setAttribute('aria-hidden', 'true');
    for (let i = 1; i <= 3; i += 1) ladder.append(el('i', i <= level ? 'is-on' : null));
    return ladder;
}

function renderTiers() {
    tiersEl.replaceChildren();

    const suffix = PERIODS.find(([key]) => key === period)?.[2] || '';

    TIERS.forEach((tier, index) => {
        const plan = plans.find((item) => item.tier === tier && item.period === period);
        const column = el('article', 'sub-tier');
        column.dataset.tier = tier.toLowerCase();

        const head = el('div', 'sub-tier-head');
        head.append(el('h2', 'sub-tier-name', tier.toUpperCase()), tierLadder(index + 1));
        column.append(head);

        if (!plan) {
            column.append(el('p', 'sub-tier-missing', 'No disponible con esta frecuencia.'));
            tiersEl.append(column);
            return;
        }

        const price = el('p', 'sub-price');
        price.append(
            el('strong', null, formatPrice(plan.price)),
            el('span', null, `${plan.price?.currency || 'USD'} ${suffix}`)
        );
        column.append(price);

        const current = membership?.active && membership.tier === tier && membership.period === period;
        const button = el('button', 'sub-cta', current ? 'TU PLAN ACTUAL' : 'SUSCRIBIRME');
        button.type = 'button';
        button.disabled = Boolean(membership?.active);
        if (membership?.active && !current) button.title = 'Ya tenés una membresía activa.';
        button.addEventListener('click', () => subscribe(plan));
        column.append(button);

        tiersEl.append(column);
    });
}

function renderMembership() {
    if (!membership?.active) return;

    const tier = membership.tier ? membership.tier.toUpperCase() : 'ACTIVA';
    const until = membership.status === 'ACTIVE'
        ? membership.nextBillingTime && `Próximo cobro ${formatDate(membership.nextBillingTime)}`
        : membership.paidThrough && `Activa hasta ${formatDate(membership.paidThrough)}`;

    notice('member', `TU MEMBRESÍA: ${tier}`, until || null);
}

/* ---------------------------------------------------------
   Actions
   --------------------------------------------------------- */

async function subscribe(plan) {
    if (busy) return;

    const user = auth.currentUser;

    if (!user) {
        // js/auth.js opens the login modal for a signed-out click.
        document.getElementById('authBtn')?.click();
        return;
    }

    busy = true;
    tiersEl.querySelectorAll('.sub-cta').forEach((button) => { button.disabled = true; });

    try {
        const data = await api('/api/subscription/create', { method: 'POST', body: { planId: plan.id }, user });

        if (!data.approveUrl) throw new Error('PayPal no devolvió el enlace de pago.');

        window.location.assign(data.approveUrl);
    } catch (error) {
        console.error('[SUSCRIPCIÓN] No se pudo iniciar:', error);
        notice('error', 'NO PUDIMOS INICIAR EL PAGO', error.message);
        busy = false;
        renderTiers();
    }
}

async function confirmReturn(user) {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('membresia');
    if (!result) return false;

    // Drop PayPal's query string so a reload doesn't repeat this.
    window.history.replaceState(null, '', window.location.pathname);

    if (result === 'cancelada') {
        notice('info', 'PAGO CANCELADO', 'No se hizo ningún cobro.');
        return false;
    }

    const subscriptionID = params.get('subscription_id');
    if (result !== 'aprobada' || !subscriptionID) return false;

    notice('info', 'CONFIRMANDO TU MEMBRESÍA…');

    try {
        await api('/api/subscription/activate', { method: 'POST', body: { subscriptionID }, user });
        notice('success', '¡LISTO! TU MEMBRESÍA ESTÁ ACTIVA', 'La vas a ver también en tu perfil.');
        return true;
    } catch (error) {
        console.error('[SUSCRIPCIÓN] No se pudo confirmar:', error);
        notice(
            'error',
            'NO PUDIMOS CONFIRMAR TU MEMBRESÍA',
            'Si PayPal te cobró, se va a activar sola en unos minutos.'
        );
        return false;
    }
}

/* ---------------------------------------------------------
   Init
   --------------------------------------------------------- */

async function loadPlans() {
    try {
        plans = (await api('/api/subscription/plans')).plans || [];
    } catch (error) {
        console.error('[SUSCRIPCIÓN] No se pudieron leer los planes:', error);
        plans = [];
    }

    if (!plans.length) {
        tiersEl.replaceChildren(el('p', 'sub-state', 'LOS PLANES NO ESTÁN DISPONIBLES EN ESTE MOMENTO.'));
        return;
    }

    period = PERIODS.map(([key]) => key).find((key) => plans.some((plan) => plan.period === key));
    renderPeriods();
    renderTiers();
}

async function loadMembership(user, { keepNotice = false } = {}) {
    membership = null;

    if (user) {
        try {
            membership = await api('/api/subscription/status', { user });
        } catch (error) {
            console.warn('[SUSCRIPCIÓN] No se pudo leer la membresía:', error.message);
        }
    }

    if (!keepNotice) renderMembership();
    if (plans.length) renderTiers();
}

const plansReady = loadPlans();
let returnHandled = false;

onAuthStateChanged(auth, async (user) => {
    await plansReady;

    let confirmed = false;

    if (user && !returnHandled) {
        returnHandled = true;
        confirmed = await confirmReturn(user);
    }

    await loadMembership(user, { keepNotice: confirmed });
});
