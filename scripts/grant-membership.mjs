// scripts/grant-membership.mjs
//
// TEMPORARY testing helper: gives an account a membership without PayPal,
// by writing memberships/{uid} directly. Delete this script when testing is done.
//
//   node scripts/grant-membership.mjs <uid>                      -> Gold, mensual
//   node scripts/grant-membership.mjs <uid> --tier=Zafiro --period=anual
//   node scripts/grant-membership.mjs <uid> --plan=P-XXXXXXXX    -> exact plan id
//   node scripts/grant-membership.mjs <uid> --revoke             -> removes it again
//
// How it works:
//   - status 'ACTIVE' is what unlocks cash payment (isMembershipActive in
//     api/_lib/membership.js). The tier shown (Gold / Platino / Zafiro) comes
//     from planId, so it uses one of the real PayPal plans in
//     PAYPAL_MEMBERSHIP_PLAN_ID, picked by --tier / --period.
//   - There's no subscriptionId, so nothing re-syncs it from PayPal: it stays
//     ACTIVE until you run --revoke. (nextBillingTime is only for display.)
//   - source: 'manual' marks it; --revoke only deletes manual memberships, never
//     a real PayPal one.
//   - If the user later subscribes for real, that PayPal subscription
//     overwrites this document as usual.
//
// Needs the same env as the API (FIREBASE_* and PAYPAL_*, see .env.example),
// read from .env if present. PayPal is only used to look up the plan's tier.

import 'dotenv/config';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../api/_lib/firebase-admin.js';
import { listPlans, getPlan } from '../api/_lib/membership-plans.js';

const args = process.argv.slice(2);
const uid = args.find((arg) => !arg.startsWith('--'));
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

if (!uid) {
    console.error('Uso: node scripts/grant-membership.mjs <uid> [--tier=Gold|Platino|Zafiro] [--period=mensual|trimestral|semestral|anual] [--plan=P-...] [--revoke]');
    process.exit(1);
}

const ref = adminDb.doc(`memberships/${uid}`);
const existing = (await ref.get()).data() || null;

/* ---------- revoke ---------- */

if (args.includes('--revoke')) {
    if (!existing) {
        console.log(`memberships/${uid} no existe; nada que borrar.`);
    } else if (existing.source !== 'manual') {
        console.error(`memberships/${uid} es una membresía real de PayPal (source: ${existing.source}); no la borro.`);
        process.exit(1);
    } else {
        await ref.delete();
        console.log(`Listo: membresía manual de ${uid} eliminada.`);
    }
    process.exit(0);
}

/* ---------- grant ---------- */

if (existing && existing.source !== 'manual') {
    console.error(
        `memberships/${uid} ya tiene una membresía de PayPal (status ${existing.status}, ` +
        `${existing.subscriptionId}). No la sobrescribo.`
    );
    process.exit(1);
}

const tier = option('tier') || 'Gold';
const period = option('period') || 'mensual';
let plan = null;

if (option('plan')) {
    plan = await getPlan(option('plan'));
    if (!plan) {
        console.error(`No se pudo leer el plan ${option('plan')} en PayPal.`);
        process.exit(1);
    }
} else {
    const plans = await listPlans();
    plan = plans.find((p) => p.tier.toLowerCase() === tier.toLowerCase() && p.period === period);

    if (!plan) {
        console.error(`No hay un plan activo ${tier} ${period}. Planes disponibles:`);
        plans.forEach((p) => console.error(`  ${p.id}  ${p.tier} ${p.period}  (${p.name})`));
        process.exit(1);
    }
}

const months = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 }[plan.period] || 1;
const next = new Date();
next.setMonth(next.getMonth() + months);

await ref.set({
    source: 'manual',
    subscriptionId: null,
    planId: plan.id,
    status: 'ACTIVE',
    payerId: null,
    payerEmail: null,
    startTime: new Date().toISOString(),
    statusUpdateTime: new Date().toISOString(),
    nextBillingTime: next.toISOString(),
    paidThrough: next.toISOString(),
    lastPaymentAt: null,
    lastPaymentAmount: null,
    failedPayments: 0,
    note: 'Membresía de prueba (scripts/grant-membership.mjs)',
    updatedAt: FieldValue.serverTimestamp()
});

console.log(`Listo: ${uid} ahora tiene ${plan.tier} ${plan.period} (${plan.id}), ACTIVE.`);
console.log(`Para quitarla: node scripts/grant-membership.mjs ${uid} --revoke`);
