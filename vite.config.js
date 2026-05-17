import { defineConfig } from "vite"
import { resolve } from "path"

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        standings: resolve(__dirname, "standings.html"),
        contacto: resolve(__dirname, "contacto.html")
      }
    }
  }
})