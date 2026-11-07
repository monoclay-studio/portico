import { execFileSync } from 'node:child_process';
import { E2E_ENV } from '../playwright.config';

/** Migrate the dev database and seed the demo + training organizations (both idempotent). */
export default function globalSetup() {
  const env = { ...process.env, ...E2E_ENV };
  execFileSync('pnpm', ['--filter', '@portico/api', 'migrate'], { stdio: 'inherit', env });
  execFileSync('pnpm', ['exec', 'tsx', 'scripts/seed-dev.ts'], { stdio: 'inherit', env });
}
