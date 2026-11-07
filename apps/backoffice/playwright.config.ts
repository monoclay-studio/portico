import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests + screenshots against the REAL local API (port 4100) and the Vite dev server (port 5180).
 * Database: DATABASE_URL / APP_DATABASE_URL (defaults to the wave-1 UI dev database). Chromium comes from the
 * pre-installed PLAYWRIGHT_BROWSERS_PATH; nothing is downloaded.
 */
const DB = process.env.PORTICO_E2E_DB ?? 'portico_w1_ui';
/** Ports are configurable so parallel worktrees never test each other's servers (P3-7). */
const API_PORT = process.env.PORTICO_E2E_API_PORT ?? '4100';
const WEB_PORT = process.env.PORTICO_E2E_WEB_PORT ?? '5180';
/** Reuse an already running server only when asked (PORTICO_E2E_REUSE=1). */
const reuse = process.env.PORTICO_E2E_REUSE === '1';
export const E2E_ENV = {
  DATABASE_URL: process.env.DATABASE_URL ?? `postgres://postgres@127.0.0.1:5432/${DB}`,
  APP_DATABASE_URL:
    process.env.APP_DATABASE_URL ?? `postgres://portico_app:portico_app_dev@127.0.0.1:5432/${DB}`,
};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
    timezoneId: 'Indian/Maldives',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @portico/api exec tsx src/main.ts',
      url: `http://127.0.0.1:${API_PORT}/health/ready`,
      reuseExistingServer: reuse,
      timeout: 90_000,
      env: { ...E2E_ENV, PORT: API_PORT, LOG_LEVEL: 'warn', NODE_ENV: 'development' },
    },
    {
      command: `pnpm exec vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: reuse,
      timeout: 90_000,
      env: { PORTICO_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
