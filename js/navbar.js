/*
 * js/navbar.js
 *
 * Desktop navigation bar (#deskNav, styled in css/navbar.css):
 *   - marks the link for the current page with aria-current="page";
 *   - adds .is-stuck once the bar reaches the top of the viewport, which
 *     gives it a solid background and shows the small logo on its left.
 * The bar is display:none below 860px, so this is a no-op on mobile.
 */

const deskNav = document.getElementById('deskNav');

// Vercel rewrites (vercel.json) serve these paths; the .html names are
// what the Vite dev server uses.
const PAGE_BY_PATH = {
    '/': 'inicio',
    '/inicio': 'inicio',
    '/index.html': 'inicio',
    '/reservas': 'reservas',
    '/reservas.html': 'reservas',
    '/standings': 'standings',
    '/standings.html': 'standings',
    '/contacto': 'contacto',
    '/contacto.html': 'contacto',
    '/suscripcion': 'suscripcion',
    '/suscripcion.html': 'suscripcion'
};

function markCurrentPage() {
    const path = window.location.pathname.replace(/\/+$/, '') || '/';
    const page = PAGE_BY_PATH[path];

    if (!page) return;

    deskNav
        .querySelectorAll(`[data-nav="${page}"]`)
        .forEach((link) => link.setAttribute('aria-current', 'page'));
}

let ticking = false;

function updateStuck() {
    ticking = false;

    const stuck =
        window.scrollY > 0 &&
        deskNav.getBoundingClientRect().top <= 0;

    deskNav.classList.toggle('is-stuck', stuck);
}

function onScroll() {
    if (ticking) return;

    ticking = true;
    requestAnimationFrame(updateStuck);
}

if (deskNav) {
    markCurrentPage();
    updateStuck();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
}
