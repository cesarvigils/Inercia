/*
 * js/profile/membership.js
 *
 * The signed-in user's membership, from GET /api/subscription/status. The
 * server decides the tier from the PayPal plan (api/_lib/membership-plans.js);
 * the browser only displays it and never grants anything from it.
 *
 * Result, one of:
 *   { state: 'ready', tier, level, period, active, status, nextBillingTime, paidThrough }
 *       tier is 'Nula' | 'Gold' | 'Platino' | 'Zafiro', or null for an
 *       active membership whose plan PayPal couldn't describe just now.
 *   { state: 'unavailable' }   the status endpoint failed.
 */

import { getJson } from './api.js';

export const MEMBERSHIP_TIERS = ['Nula', 'Gold', 'Platino', 'Zafiro'];

export const PERIOD_LABELS = {
    mensual: 'Mensual',
    trimestral: 'Trimestral',
    semestral: 'Semestral',
    anual: 'Anual'
};

export function tierLevel(tier) {
    const level = MEMBERSHIP_TIERS.indexOf(tier);
    return level === -1 ? 0 : level;
}

export function normalizeMembership(data) {
    const active = data?.active === true;
    const tier = MEMBERSHIP_TIERS.includes(data?.tier) ? data.tier : null;

    return {
        state: 'ready',
        active,
        // An inactive account is Nula whatever the server sent.
        tier: active ? tier : 'Nula',
        level: active ? tierLevel(tier) : 0,
        period: active ? data?.period || null : null,
        status: data?.status || 'NONE',
        nextBillingTime: data?.nextBillingTime || null,
        paidThrough: data?.paidThrough || null
    };
}

export async function loadMembership(user) {
    try {
        return normalizeMembership(await getJson('/api/subscription/status', { user }));
    } catch (error) {
        console.warn('[PERFIL] No se pudo leer la membresía:', error.message);
        return { state: 'unavailable' };
    }
}
