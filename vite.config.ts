import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    proxy: {
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
    },
  },
  optimizeDeps: {
    // maplibre-gl's worker is loaded via a relative `new URL(...)` from its
    // own module; pre-bundling it into node_modules/.vite/deps/ breaks that
    // resolution (the worker chunk 404s). Excluding it keeps the package
    // served directly from node_modules where the relative path is valid.
    exclude: ['maplibre-gl'],
    // Pre-bundle the deps used exclusively inside Web Workers. Vite can't
    // discover them from the main entry, so the first upload would otherwise
    // trigger "optimized dependencies changed → reload", killing the parse.
    include: ['igc-parser', 'geotiff'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts?(x)'],
    css: true,
  },
});
