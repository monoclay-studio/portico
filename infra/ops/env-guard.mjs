/**
 * Start-up guard for every Portico process in a hosted deployment (api, worker, migrate, grants, db-bootstrap).
 * Loaded before any application code:  node --import /app/ops/env-guard.mjs --import /opt/tsx/register.mjs src/main.ts
 *
 * It refuses to start (exit 78, one JSON line naming the variable, never its value) when:
 *   1. PORTICO_DEPLOYMENT is not demo | staging | production (Terraform sets it per deployment; it — not NODE_ENV — is
 *      the deployment truth);
 *   2. a non-production deployment holds a credential that can move real money or reach a live third party:
 *        - any variable whose value contains a Stripe LIVE secret or restricted key (sk_live_, rk_live_), whatever
 *          the variable is called (values cannot be checked at plan time; names can be wrong on purpose);
 *        - any variable named for a live-only credential (LIVE Stripe Connect keys, Channex production key,
 *          Monoclay SaaS-billing keys);
 *   3. an api or worker process lacks the field-encryption, blind-index or terms-seal key, or the field and
 *      blind-index keys are equal — whatever NODE_ENV says (staging/demo run NODE_ENV=development so the operator
 *      console works there; the keys stay mandatory).
 */
const DEPLOYMENTS = ['demo', 'staging', 'production'];
const LIVE_VALUE = /^(sk|rk)_live_/;
export const LIVE_ONLY_NAMES = [
  'PAYMENTS_STRIPE_SECRET_KEY_LIVE',
  'PAYMENTS_STRIPE_WEBHOOK_SECRETS_LIVE',
  'CHANNEX_API_KEY',
  'STRIPE_BILLING_SECRET_KEY',
  'STRIPE_BILLING_WEBHOOK_SECRET',
];
const APP_KEYS = ['PORTICO_FIELD_KEY', 'PORTICO_BLIND_INDEX_KEY', 'PORTICO_TERMS_SEAL_KEY'];

/** Returns the reasons to refuse (empty = start). Pure, for tests. */
export function refusals(env) {
  const out = [];
  const deployment = env.PORTICO_DEPLOYMENT;
  if (!DEPLOYMENTS.includes(deployment)) {
    out.push(
      `PORTICO_DEPLOYMENT must be one of ${DEPLOYMENTS.join(', ')} (got ${deployment ? 'an unknown value' : 'nothing'})`,
    );
    return out;
  }
  if (deployment !== 'production') {
    for (const [name, value] of Object.entries(env)) {
      if (typeof value !== 'string' || value === '') continue;
      if (value.split(/[\s,]+/).some((part) => LIVE_VALUE.test(part))) {
        out.push(`${name} holds a Stripe LIVE key in the ${deployment} deployment`);
      }
    }
    for (const name of LIVE_ONLY_NAMES) {
      if (env[name]) out.push(`${name} (a live-only credential) is set in the ${deployment} deployment`);
    }
  }
  if (env.PORTICO_PROCESS === 'api' || env.PORTICO_PROCESS === 'worker') {
    for (const name of APP_KEYS) if (!env[name]) out.push(`${name} is missing`);
    if (env.PORTICO_FIELD_KEY && env.PORTICO_FIELD_KEY === env.PORTICO_BLIND_INDEX_KEY) {
      out.push('PORTICO_FIELD_KEY and PORTICO_BLIND_INDEX_KEY must differ');
    }
  }
  return out;
}

const reasons = refusals(process.env);
if (reasons.length > 0) {
  process.stderr.write(`${JSON.stringify({ level: 'fatal', msg: 'env guard refused to start', reasons })}\n`);
  process.exit(78);
}
