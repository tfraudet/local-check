import { fileURLToPath, URL } from 'node:url';
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from 'vitest/config';
import devtoolsJson from 'vite-plugin-devtools-json';
import type { ProxyOptions } from 'vite'
import pkg from './package.json' with { type: 'json' };

const proxy : Record<string, string | ProxyOptions>= {
  // ACPH Auvergne serves the outlanding JSON without CORS headers. In
  // prod the app is hosted on aeroclub-issoire.fr itself, so the fetch
  // hits `/wp-content/...` same-origin with no proxy. We mirror that
  // path here so dev and `vite preview` behave the same as production.
  '/wp-content/uploads/acph': {
    target: 'https://aeroclub-issoire.fr',
    changeOrigin: true,
  },
  // OpenAIP's storage bucket serves per-country data exports without CORS
  // headers. In prod an Apache reverse-proxy in `.htaccess` handles the
  // same path (`/local-check/openaip-storage-proxy/*` →
  // `storage.openaip.net/*`); this dev/preview proxy mirrors that so the
  // client uses a single URL everywhere.
  '/local-check/openaip-storage-proxy': {
    target: 'https://storage.openaip.net',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/local-check\/openaip-storage-proxy/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [react(), tailwindcss(), devtoolsJson()],
  base: '/local-check/',
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
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts?(x)'],
    css: true,
  },
})
