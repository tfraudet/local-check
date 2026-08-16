import { fileURLToPath, URL } from 'node:url';
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from 'vitest/config';
import devtoolsJson from 'vite-plugin-devtools-json';
import type { ProxyOptions } from 'vite'
import pkg from './package.json' with { type: 'json' };

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
  // OpenAIP's storage bucket serves per-country data exports without CORS
  // headers, so we proxy it in dev to keep the response same-origin.
  '/openaip-storage-proxy': {
    target: 'https://storage.openaip.net',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/openaip-storage-proxy/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts?(x)'],
    css: true,
  },
})
