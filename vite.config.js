import { defineConfig } from 'vite'

// Default base is '/' so the app works at a domain root (Vercel, Netlify, local
// dev). GitHub Pages serves from a project subpath, so its workflow sets
// BASE_PATH=/Disney-welcome/ to override this.
const base = process.env.BASE_PATH ?? '/'

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
