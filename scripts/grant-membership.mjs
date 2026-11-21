// scripts/grant-membership.mjs
//
// TEMPORARY testing helper: gives accounts a membership without PayPal, by
// writing memberships/{uid} directly. Delete this script (and the "prebuild"
// line in package.json) when testing is done.
//
// Runs automatically on every build ("prebuild" in package.json, so every
// Vercel deploy) in --auto mode:
//   - grants AUTO_UIDS below (or GRANT_MEMBERSHIP_UIDS, comma separated, if
//     that env var is set) a Gold mensual membership;
//   - does nothing for an account that already has one (manual or PayPal);
//   - skips quietly without Firebase credentials, and never fails the build.
//
// Manual use:
//   node scripts/grant-membership.mjs <uid>                      -> Gold, mensual
//   node scripts/grant-membership.mjs <uid> --tier=Zafiro --period=anual
//   node scripts/grant-membership.mjs <uid> --plan=P-XXXXXXXX    -> exact plan id
//   node scripts/grant-membership.mjs <uid> --revoke             -> removes it again
//   (to keep a revoked account revoked, also remove it from AUTO_UIDS,
//   or the next deploy grants it again)
//
// How it works:
//   - status 'ACTIVE' is what unlocks cash payment (isMembershipActive in
//     api/_lib/membership.js). The tier shown (Gold / Platino / Zafiro) comes
//     from planId, so it uses one of the real PayPal plans in
//     PAYPAL_MEMBERSHIP_PLAN_ID, picked by --tier / --period.
//   - There's no subscriptionId, so nothing re-syncs it from PayPal: it stays
//     ACTIVE until revoked. (nextBillingTime is only for display.)
//   - source: 'manual' marks it; this script never overwrites or deletes a
//     real PayPal membership. If the user later subscribes for real, that
//     PayPal subscription overwrites this document as usual.
//
// Needs the same env as the API (FIREBASE_* and PAYPAL_*, see .env.example),
// read from .env if present. PayPal is only used to look up the plan's tier.

import 'dotenv/config';

const AUTO_UIDS = ['97FevBMmnnRXtDEUnUgF8bHOD1L2'];

const args = process.argv.slice(2);
const auto = args.includes('--auto');
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

async function findPlan({ tier, period, planId }) {
    const { listPlans, getPlan } = await import('../api/_lib/membership-plans.js');

    if (planId) {
        const plan = await getPlan(planId);
        if (!plan) throw new Error(`No se pudo leer el plan ${planId} en PayPal.`);
        return plan;
    }

    const plans = await listPlans();
    const plan = plans.find((p) => p.tier.toLowerCase() === tier.toLowerCase() && p.period === period);

    if (!plan) {
        const available = plans.map((p) => `  ${p.id}  ${p.tier} ${p.period}  (${p.name})`).join('\n');
        throw new Error(`No hay un plan activo ${tier} ${period}. Planes disponibles:\n${available}`);
    }

    return plan;
}

async function grant(uid, { tier = 'Gold', period = 'mensual', planId = null, skipExisting = false } = {}) {
    const { FieldValue } = await import('firebase-admin/firestore');
    const { adminDb } = await import('../api/_lib/firebase-admin.js');

    const ref = adminDb.doc(`memberships/${uid}`);
    const existing = (await ref.get()).data() || null;

    if (existing && existing.source !== 'manual') {
        console.log(`[grant-membership] ${uid}: ya tiene una membresía de PayPal (${existing.status}); no la toco.`);
        return;
    }

    if (existing && skipExisting) {
        console.log(`[grant-membership] ${uid}: ya tiene la membresía manual (${existing.status}).`);
        return;
    }

    const plan = await findPlan({ tier, period, planId });
    const months = { mensual: 1, trimestral: 3, semestral: 6, anual: 12 }[plan.period] || 1;
    const now = new Date();
    const next = new Date(now);
    next.setMonth(next.getMonth() + months);

    await ref.set({
        source: 'manual',
        subscriptionId: null,
        planId: plan.id,
        status: 'ACTIVE',
        payerId: null,
        payerEmail: null,
        startTime: now.toISOString(),
        statusUpdateTime: now.toISOString(),
        nextBillingTime: next.toISOString(),
        paidThrough: next.toISOString(),
        lastPaymentAt: null,
        lastPaymentAmount: null,
        failedPayments: 0,
        note: 'Membresía de prueba (scripts/grant-membership.mjs)',
        updatedAt: FieldValue.serverTimestamp()
    });

    console.log(`[grant-membership] ${uid}: ahora tiene ${plan.tier} ${plan.period} (${plan.id}), ACTIVE.`);
}

async function revoke(uid) {
    const { adminDb } = await import('../api/_lib/firebase-admin.js');
    const ref = adminDb.doc(`memberships/${uid}`);
    const existing = (await ref.get()).data() || null;

    if (!existing) {
        console.log(`memberships/${uid} no existe; nada que borrar.`);
    } else if (existing.source !== 'manual') {
        throw new Error(`memberships/${uid} es una membresía real de PayPal; no la borro.`);
    } else {
        await ref.delete();
        console.log(`Listo: membresía manual de ${uid} eliminada.`);
    }
}

/* ---------- auto (prebuild): never fails the build ---------- */

if (auto) {
    const uids = (process.env.GRANT_MEMBERSHIP_UIDS || AUTO_UIDS.join(','))
        .split(',')
        .map((uid) => uid.trim())
        .filter(Boolean);

    if (!process.env.FIREBASE_PROJECT_ID || !process.env.FIREBASE_PRIVATE_KEY) {
        console.log('[grant-membership] Sin credenciales de Firebase; me salto la membresía de prueba.');
        process.exit(0);
    }

    for (const uid of uids) {
        try {
            await grant(uid, { skipExisting: true });
        } catch (error) {
            console.warn(`[grant-membership] ${uid}: no se pudo dar la membresía: ${error.message}`);
        }
    }

    process.exit(0);
}

/* ---------- manual ---------- */

const uid = args.find((arg) => !arg.startsWith('--'));

if (!uid) {
    console.error('Uso: node scripts/grant-membership.mjs <uid> [--tier=Gold|Platino|Zafiro] [--period=mensual|trimestral|semestral|anual] [--plan=P-...] [--revoke]');
    process.exit(1);
}

try {
    if (args.includes('--revoke')) {
        await revoke(uid);
    } else {
        await grant(uid, {
            tier: option('tier') || 'Gold',
            period: option('period') || 'mensual',
            planId: option('plan') || null
        });
        console.log(`Para quitarla: node scripts/grant-membership.mjs ${uid} --revoke`);
    }
    process.exit(0);
} catch (error) {
    console.error(error.message);
    process.exit(1);
}
