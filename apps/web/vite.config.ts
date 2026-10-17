import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Matches the API's default HOST and PORT (apps/api/src/config/env.ts).
const API_TARGET = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // The browser calls /api/…; Vite forwards the same path to the API, which serves
      // every route under /api. The browser sees a single origin, so no CORS is needed,
      // and development and production use identical paths.
      '/api': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: { name: '@hospitalos/web', environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
