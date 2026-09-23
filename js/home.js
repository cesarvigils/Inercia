/*
 * js/home.js
 *
 * Home page behavior (footer year + scroll reveal). This used to be an
 * inline <script> in index.html; it lives in its own file so the site's
 * Content-Security-Policy (vercel.json) can block every inline script.
 */

document.getElementById('year').textContent = new Date().getFullYear();
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
