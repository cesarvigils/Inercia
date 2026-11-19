/*
 * js/menu.js
 *
 * Controls the slide-out side navigation menu shared across pages
 * (hamburger button -> overlay + panel). Expects these element ids to
 * exist in the page's HTML: #menuBtn (the toggle button), #sideMenu (the
 * panel), #menuOverlay (the dark backdrop), #menuClose (the close
 * button/X inside the panel). No exports — this file just wires up event
 * listeners when loaded as a <script type="module">, so it must be
 * loaded on any page that includes that markup (see index.html,
 * contacto.html, reservas.html, standings.html, suscripcion.html).
 *
 * Keyboard/screen reader behavior:
 *   - While closed the panel is `inert`, so Tab never walks through its
 *     off-screen links (aria-hidden alone left them focusable).
 *   - Opening moves focus to the first link; closing returns it to the
 *     hamburger button. Escape closes it only when it's open.
 *   - The link for the current page gets aria-current="page" (styled in
 *     css/menu.css), same as the desktop navbar in js/navbar.js.
 */
const menuBtn = document.getElementById('menuBtn');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');

function isOpen() {
    return sideMenu?.classList.contains('active');
}

function openMenu() {
    sideMenu.classList.add('active');
    menuOverlay.classList.add('active');
    document.body.classList.add('menu-open');

    sideMenu.inert = false;
    sideMenu.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
        sideMenu.querySelector('.side-menu-link')?.focus();
    });
}

function closeMenu({ restoreFocus = true } = {}) {
    const hadFocus = sideMenu.contains(document.activeElement);

    sideMenu.classList.remove('active');
    menuOverlay.classList.remove('active');
    document.body.classList.remove('menu-open');

    sideMenu.inert = true;
    sideMenu.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');

    if (restoreFocus && hadFocus) {
        menuBtn.focus();
    }
}

function markCurrentPage() {
    const path = window.location.pathname.replace(/\/+$/, '').replace(/\.html$/, '') || '/inicio';
    const page = path === '/index' || path === '/' ? '/inicio' : path;

    sideMenu.querySelectorAll('.side-menu-link').forEach((link) => {
        if (link.getAttribute('href') === page) {
            link.setAttribute('aria-current', 'page');
        }
    });
}

/*
 * Background video (.page-bg-video, partials/bg-video.html, on every page).
 * It ships with preload="none" and no autoplay; this starts it only when
 * it should play:
 *   - not for people who asked their OS for reduced motion;
 *   - not with Data Saver on (navigator.connection.saveData), so phones on
 *     mobile data don't download a looping video they can barely see;
 *   - paused while the tab is hidden, to save battery.
 */
const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
const saveData = Boolean(navigator.connection?.saveData);

function syncBackgroundVideo() {
    const shouldPlay =
        !reducedMotion?.matches &&
        !saveData &&
        document.visibilityState !== 'hidden';

    document.querySelectorAll('.page-bg-video').forEach((video) => {
        if (!shouldPlay) {
            video.pause();
            return;
        }

        if (video.paused) {
            video.preload = 'auto';
            video.play().catch(() => {});
        }
    });
}

syncBackgroundVideo();
reducedMotion?.addEventListener?.('change', syncBackgroundVideo);
document.addEventListener('visibilitychange', syncBackgroundVideo);

if (menuBtn && sideMenu && menuOverlay) {
    sideMenu.inert = true;
    markCurrentPage();

    menuBtn.addEventListener('click', openMenu);
    menuClose?.addEventListener('click', () => closeMenu());
    menuOverlay.addEventListener('click', () => closeMenu());

    /* ESC closes menu */
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && isOpen()) {
            closeMenu();
        }
    });
}
