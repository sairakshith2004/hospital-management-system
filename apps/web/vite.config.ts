import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Matches the API's default HOST and PORT (apps/api/src/config/env.ts).
const API_TARGET = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // The browser calls /api/health; Vite forwards it to http://127.0.0.1:3000/health.
      // The browser sees a single origin, so no CORS configuration is needed.
      // TEMPORARY: the API has no /api prefix yet. On Day 4 the API mounts its routes
      // under /api and this rewrite is removed, so dev and production paths match.
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: { name: '@hospitalos/web', environment: 'jsdom', setupFiles: ['./src/test-setup.ts'] },
});
