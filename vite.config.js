/*
 * vite.config.js
 *
 * Vite build config for this multi-page site (not a single-page app).
 * rollupOptions.input lists every real HTML entry point Vite should
 * build/bundle: index.html (home), standings.html, contacto.html, and
 * reservas.html. If a new top-level page is added later, it needs to be
 * added here too, or Vite won't include it in the production build
 * (`vite build`) output — the dev server (`vite`) serves any file by
 * path regardless, so a missing entry here can go unnoticed until you
 * actually run a production build.
 */

import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        standings: resolve(__dirname, 'standings.html'),
        contacto: resolve(__dirname, 'contacto.html'),
        reservas: resolve(__dirname, 'reservas.html')
      }
    }
  }
})