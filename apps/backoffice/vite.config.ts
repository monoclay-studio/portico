import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Dev server on 5180 (strict). API calls go to /v1 on the same origin and are proxied to the local API, so
 * the browser never needs CORS and the session token never leaves the app's origin.
 */
const apiTarget = process.env.PORTICO_API_URL ?? 'http://127.0.0.1:4100';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5180,
    strictPort: true,
    host: '127.0.0.1',
    proxy: {
      '/v1': { target: apiTarget, changeOrigin: false },
      '/health': { target: apiTarget, changeOrigin: false },
    },
  },
  preview: { port: 5180, strictPort: true, host: '127.0.0.1' },
  build: { sourcemap: true, target: 'es2023' },
});
