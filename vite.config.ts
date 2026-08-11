import { fileURLToPath, URL } from 'node:url';
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import devtoolsJson from 'vite-plugin-devtools-json';
import type { ProxyOptions } from 'vite'       

const proxy : Record<string, string | ProxyOptions>= {
  '/ot-proxy': {
    target: 'https://portal.opentopography.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/ot-proxy/, ''),
  },
  // ACPh Auvergne serves the outlanding JSON without CORS headers.
  '/acph-proxy': {
    target: 'https://aeroclub-issoire.fr',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/acph-proxy/, ''),
  },
  // OpenAIP returns CORS headers on 2xx but strips them on 429 (rate
  // limit) — proxying in dev keeps the response same-origin so the
  // error is visible instead of masked as a CORS failure.
  '/openaip-proxy': {
    target: 'https://api.core.openaip.net',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/openaip-proxy/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), devtoolsJson()],
  worker: {
    format: 'es',
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),

    },
  },
  server: { proxy },
  preview: { proxy },
  // optimizeDeps: {
  //   exclude: ['maplibre-gl'],
  // },
  // build: {
  //   rollupOptions: {
  //     output: {
  //       entryFileNames: 'assets/[name]-[hash].mjs',
  //       chunkFileNames: 'assets/[name]-[hash].mjs',
  //       assetFileNames: 'assets/[name]-[hash][extname]',
  //     },
  //   },
  // },

})
