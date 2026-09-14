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
 * contacto.html, reservas.html, standings.html).
 */
const menuBtn = document.getElementById('menuBtn');
const sideMenu = document.getElementById('sideMenu');
const menuOverlay = document.getElementById('menuOverlay');
const menuClose = document.getElementById('menuClose');

function openMenu() {
    sideMenu.classList.add('active');
    menuOverlay.classList.add('active');
    document.body.classList.add('menu-open');

    sideMenu.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
}

function closeMenu() {
    sideMenu.classList.remove('active');
    menuOverlay.classList.remove('active');
    document.body.classList.remove('menu-open');

    sideMenu.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', openMenu);

menuClose.addEventListener('click', closeMenu);

menuOverlay.addEventListener('click', closeMenu);

/* ESC closes menu */
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        closeMenu();
    }
});
