// node --test infra/ops/env-guard.test.mjs   — the start-up guard refuses what it must and nothing else.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const guard = fileURLToPath(new URL('./env-guard.mjs', import.meta.url));
const keys = { PORTICO_FIELD_KEY: 'Zm9v', PORTICO_BLIND_INDEX_KEY: 'YmFy', PORTICO_TERMS_SEAL_KEY: 'YmF6' };
const run = (env) =>
  spawnSync(process.execPath, ['--import', guard, '-e', 'process.stdout.write("started")'], {
    env: { PATH: process.env.PATH, ...env },
    encoding: 'utf8',
  });
const started = (env) => run(env).stdout === 'started';

test('production with LIVE keys and all app keys starts', () => {
  assert.ok(
    started({
      PORTICO_DEPLOYMENT: 'production',
      PORTICO_PROCESS: 'api',
      ...keys,
      PAYMENTS_STRIPE_SECRET_KEY_LIVE: 'sk_live_x',
    }),
  );
});

test('staging refuses a LIVE Stripe key under the TEST name (value check, review P2-1)', () => {
  const r = run({
    PORTICO_DEPLOYMENT: 'staging',
    PORTICO_PROCESS: 'api',
    ...keys,
    PAYMENTS_STRIPE_SECRET_KEY_TEST: 'sk_live_abc',
  });
  assert.equal(r.status, 78);
  assert.match(r.stderr, /PAYMENTS_STRIPE_SECRET_KEY_TEST holds a Stripe LIVE key/);
  assert.doesNotMatch(r.stderr, /sk_live_abc/, 'never print the value');
});

test('restricted live keys and comma lists are caught under any name', () => {
  assert.ok(!started({ PORTICO_DEPLOYMENT: 'demo', ...keys, SOMETHING: 'rk_live_1' }));
  assert.ok(!started({ PORTICO_DEPLOYMENT: 'demo', ...keys, LIST: 'whsec_a, sk_live_b' }));
});

test('live-only credential names are refused outside production (Channex production, Monoclay billing)', () => {
  for (const name of [
    'CHANNEX_API_KEY',
    'STRIPE_BILLING_SECRET_KEY',
    'PAYMENTS_STRIPE_WEBHOOK_SECRETS_LIVE',
  ]) {
    assert.ok(!started({ PORTICO_DEPLOYMENT: 'staging', ...keys, [name]: 'whatever' }), name);
  }
});

test('test-mode keys are fine outside production', () => {
  assert.ok(
    started({
      PORTICO_DEPLOYMENT: 'staging',
      PORTICO_PROCESS: 'worker',
      ...keys,
      PAYMENTS_STRIPE_SECRET_KEY_TEST: 'sk_test_1',
    }),
  );
});

test('missing or unknown PORTICO_DEPLOYMENT refuses (fail closed)', () => {
  assert.ok(!started({ ...keys }));
  assert.ok(!started({ PORTICO_DEPLOYMENT: 'prod', ...keys }));
});

test('api/worker refuse missing or equal app keys whatever NODE_ENV says', () => {
  assert.ok(
    !started({
      PORTICO_DEPLOYMENT: 'staging',
      NODE_ENV: 'development',
      PORTICO_PROCESS: 'api',
      PORTICO_FIELD_KEY: 'a',
      PORTICO_BLIND_INDEX_KEY: 'b',
    }),
  );
  assert.ok(
    !started({
      PORTICO_DEPLOYMENT: 'demo',
      PORTICO_PROCESS: 'worker',
      ...keys,
      PORTICO_BLIND_INDEX_KEY: keys.PORTICO_FIELD_KEY,
    }),
  );
  // migrate/grants do not hold app keys
  assert.ok(started({ PORTICO_DEPLOYMENT: 'staging', PORTICO_PROCESS: 'migrate' }));
});
