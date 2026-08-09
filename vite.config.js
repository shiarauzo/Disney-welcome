import { defineConfig } from 'vite'

// The `base` path lets the built app work when served from a GitHub Pages
// project subpath (https://<user>.github.io/Disney-welcome/). Override it with
// the BASE_PATH env var if you fork under a different repo name.
const base = process.env.BASE_PATH ?? '/Disney-welcome/'

export default defineConfig({
  base,
  server: {
    host: true,
    open: true
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    // Three.js + MediaPipe are inherently large; the single bundle is fine for
    // a self-contained visual toy, so quiet the size warning.
    chunkSizeWarningLimit: 800
  }
})
