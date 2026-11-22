/*
 * js/nav-membership.js
 *
 * For members, the SUSCRIBITE call to action (desktop nav .desk-nav-cta and
 * the side menu link, partials/site-header.html) becomes their membership
 * tier: "GOLD", "PLATINO" or "ZAFIRO", in that tier's color. It still links
 * to /suscripcion, where the membership is managed. Everyone else (signed
 * out, no membership, or the tier can't be read) keeps SUSCRIBITE.
 *
 * The tier comes from GET /api/subscription/status (the server decides it
 * from the PayPal plan; this only displays it). The last answer is kept in
 * localStorage per account so the next page shows the tier right away
 * instead of flashing SUSCRIBITE first; it's refreshed on every page load.
 * Loaded by js/auth.js, which every page includes. Styles: css/navbar.css.
 */

import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'firebase/auth';

const TIERS = ['Gold', 'Platino', 'Zafiro'];
const CACHE_KEY = 'inercia:navTier';

function targets() {
    return [
        ...document.querySelectorAll('.desk-nav-cta[data-nav="suscripcion"], .side-menu-link[href="/suscripcion"]')
    ];
}

function readCache(uid) {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        return cached?.uid === uid && TIERS.includes(cached.tier) ? cached.tier : null;
    } catch {
        return null;
    }
}

function writeCache(uid, tier) {
    try {
        if (tier) localStorage.setItem(CACHE_KEY, JSON.stringify({ uid, tier }));
        else localStorage.removeItem(CACHE_KEY);
    } catch {
        // Private mode / blocked storage: the tier just shows a moment later.
    }
}

function render(tier, { animate = false } = {}) {
    targets().forEach((link) => {
        if (!link.dataset.defaultLabel) link.dataset.defaultLabel = link.textContent.trim();

        const current = link.dataset.tier || '';
        if (current === (tier || '')) return;

        link.classList.remove('is-member', 'tier-gold', 'tier-platino', 'tier-zafiro', 'tier-in');

        if (tier) {
            const label = tier.toUpperCase();
            link.dataset.tier = tier;
            link.classList.add('is-member', `tier-${tier.toLowerCase()}`);
            const dot = document.createElement('span');
            dot.className = 'tier-dot';
            dot.setAttribute('aria-hidden', 'true');
            link.replaceChildren(dot, document.createTextNode(label));
            link.setAttribute('aria-label', `Tu membresía: ${tier}`);
            link.title = `Membresía ${tier}`;

            if (animate) {
                void link.offsetWidth;
                link.classList.add('tier-in');
                link.addEventListener('animationend', () => link.classList.remove('tier-in'), { once: true });
            }
        } else {
            delete link.dataset.tier;
            link.textContent = link.dataset.defaultLabel;
            link.removeAttribute('aria-label');
            link.removeAttribute('title');
        }
    });
}

let requestId = 0;

onAuthStateChanged(auth, async (user) => {
    const id = ++requestId;

    if (!user) {
        render(null);
        return;
    }

    const cached = readCache(user.uid);
    if (cached) render(cached);

    try {
        const { getJson } = await import('./profile/api.js');
        const data = await getJson('/api/subscription/status', { user });
        if (id !== requestId) return; // signed out / switched account meanwhile

        const tier = data?.active === true && TIERS.includes(data?.tier) ? data.tier : null;

        // An active membership whose tier can't be read right now keeps
        // whatever was shown, rather than flipping back to SUSCRIBITE.
        if (data?.active === true && !tier) return;

        writeCache(user.uid, tier);
        render(tier, { animate: !cached && Boolean(tier) });
    } catch {
        // Status unavailable: keep the cached tier (or SUSCRIBITE).
    }
});
