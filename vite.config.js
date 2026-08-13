import { defineConfig } from 'vite';

export default defineConfig({
  // root defaults to the folder containing this config (your project root,
  // where index.html lives) — no need to set it explicitly.
  build: {
    outDir: 'dist'
  }
});