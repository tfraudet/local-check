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
    },
  },
  optimizeDeps: {
    // maplibre-gl's worker is loaded via a relative `new URL(...)` from its
    // own module; pre-bundling it into node_modules/.vite/deps/ breaks that
    // resolution (the worker chunk 404s). Excluding it keeps the package
    // served directly from node_modules where the relative path is valid.
    exclude: ['maplibre-gl'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    include: ['tests/unit/**/*.{test,spec}.ts?(x)'],
    css: true,
  },
});
