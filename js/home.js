/*
 * js/home.js
 *
 * Home page behavior (scroll reveal; the footer year is set by js/navbar.js). This used to be an
 * inline <script> in index.html; it lives in its own file so the site's
 * Content-Security-Policy (vercel.json) can block every inline script.
 */

const revealEls = document.querySelectorAll('.reveal, .reveal-up');

const io = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach(el => io.observe(el));
