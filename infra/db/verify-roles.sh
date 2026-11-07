#!/usr/bin/env bash
# Verifies the production database role model end to end against a THROWAWAY PostgreSQL 16 cluster that uses
# SCRAM authentication (so wrong passwords really fail):
#
#   1. roles phase of bootstrap-roles.mjs as the superuser ("RDS master" stand-in);
#   2. every module migration as portico_owner (not a superuser);
#   3. grants phase as portico_owner; then the same phase again (idempotency);
#   4. privilege probes as the LOGIN roles: the worker can call every job-routing function, the API role cannot
#      call the job-only ones but can still sign in and route payment webhooks; nobody bypasses RLS;
#   5. the real API (NODE_ENV=production, generated keys, TRUSTED_PROXY_CIDRS) as portico_app_blue: /health/ready,
#      plus a negative start without PORTICO_TERMS_SEAL_KEY;
#   6. the demo seed as portico_app_blue, then the real worker as portico_worker_blue (must run its jobs and outbox
#      without a permission error) and as portico_app_blue (must be refused — proves the revocation bites).
#
# Usage (roles are CLUSTER-WIDE: this alters portico_app to NOLOGIN, so never point it at a shared dev server):
#   PORTICO_VERIFY_THROWAWAY_CLUSTER=yes ADMIN_URL=postgres://postgres:…@127.0.0.1:55440/postgres \
#     infra/db/verify-roles.sh
# Optional: RUNTIME_DIR=<dir> with `pnpm deploy --prod` outputs in api/ and worker/ to run the image layout
# (node --import <tsx>/register.mjs) instead of the workspace sources.
set -euo pipefail

: "${ADMIN_URL:?ADMIN_URL (superuser URL of a throwaway SCRAM-auth Postgres 16) is required}"
[ "${PORTICO_VERIFY_THROWAWAY_CLUSTER:-}" = "yes" ] || {
  echo "Refusing: set PORTICO_VERIFY_THROWAWAY_CLUSTER=yes to confirm $ADMIN_URL is a throwaway cluster." >&2
  exit 2
}

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'kill $(jobs -p) 2>/dev/null || true; rm -rf "$WORK"' EXIT
DB="portico_roles_verify_$(date +%s)"
PORT_API="${PORT_API:-48731}"

node_eval() { node --input-type=module -e "$1"; }
rand() { node_eval "process.stdout.write((await import('node:crypto')).randomBytes(${1:-24}).toString('${2:-hex}'))"; }
url_part() { node_eval "process.stdout.write(String(new URL(process.env.ADMIN_URL).$1))"; }

HOST="$(url_part hostname)"; PORT="$(url_part port)"; PORT="${PORT:-5432}"
SUPERUSER="$(url_part username)"; SUPERPASS="$(node_eval "process.stdout.write(decodeURIComponent(new URL(process.env.ADMIN_URL).password))")"
OWNER_PW="$(rand)"; APP_BLUE_PW="$(rand)"; APP_GREEN_PW="$(rand)"; WORKER_BLUE_PW="$(rand)"; WORKER_GREEN_PW="$(rand)"
url() { echo "postgres://$1:$2@$HOST:$PORT/$DB?sslmode=disable"; }
OWNER_URL="$(url portico_owner "$OWNER_PW")"
APP_URL="$(url portico_app_blue "$APP_BLUE_PW")"
WORKER_URL="$(url portico_worker_blue "$WORKER_BLUE_PW")"

pass=0; fail=0
ok() { echo "  PASS  $*"; pass=$((pass + 1)); }
ko() { echo "  FAIL  $*"; fail=$((fail + 1)); }
expect_ok() { # <label> <url> <sql>
  if psql "$2" -v ON_ERROR_STOP=1 -Atqc "$3" >"$WORK/out" 2>&1; then ok "$1"; else ko "$1: $(tail -1 "$WORK/out")"; fi
}
expect_denied() { # <label> <url> <sql>
  if psql "$2" -v ON_ERROR_STOP=1 -Atqc "$3" >"$WORK/out" 2>&1; then ko "$1: unexpectedly allowed"
  elif grep -q "permission denied" "$WORK/out"; then ok "$1"; else ko "$1: $(tail -1 "$WORK/out")"; fi
}

# Mirror the image layout (/app/ops/bootstrap-roles.mjs resolving `pg` from /app/node_modules).
mkdir -p "$WORK/ops" "$WORK/node_modules"
cp "$ROOT/infra/db/bootstrap-roles.mjs" "$WORK/ops/"
ln -s "$(cd "$ROOT/apps/api" && node -e "process.stdout.write(require('path').dirname(require.resolve('pg/package.json')))")" "$WORK/node_modules/pg"
BOOTSTRAP="$WORK/ops/bootstrap-roles.mjs"

if [ -n "${RUNTIME_DIR:-}" ]; then
  API_CMD=(node --import "$RUNTIME_DIR/tsx/register.mjs"); API_DIR="$RUNTIME_DIR/api"; WORKER_DIR="$RUNTIME_DIR/worker"
else
  API_CMD=(pnpm exec tsx); API_DIR="$ROOT/apps/api"; WORKER_DIR="$ROOT/apps/worker"
fi

echo "== database $DB on $HOST:$PORT"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -qc "create database $DB" >/dev/null

echo "== 1. roles phase (superuser as the RDS master stand-in)"
PGHOST="$HOST" PGPORT="$PORT" PGDATABASE="$DB" PGSSLMODE=disable \
  MASTER_USERNAME="$SUPERUSER" MASTER_PASSWORD="$SUPERPASS" \
  OWNER_SECRET_JSON="{\"username\":\"portico_owner\",\"password\":\"$OWNER_PW\"}" \
  APP_SECRET_JSON="{\"username\":\"portico_app_blue\",\"password\":\"$APP_BLUE_PW\",\"standby_username\":\"portico_app_green\",\"standby_password\":\"$APP_GREEN_PW\"}" \
  WORKER_SECRET_JSON="{\"username\":\"portico_worker_blue\",\"password\":\"$WORKER_BLUE_PW\",\"standby_username\":\"portico_worker_green\",\"standby_password\":\"$WORKER_GREEN_PW\"}" \
  node "$BOOTSTRAP" >"$WORK/roles.log" 2>&1 && ok "roles phase" || { ko "roles phase"; cat "$WORK/roles.log"; exit 1; }

echo "== 2. migrations as portico_owner"
(cd "$API_DIR" && NODE_ENV=production DATABASE_URL="$OWNER_URL" "${API_CMD[@]}" src/migrate-cli.ts) >"$WORK/migrate.log" 2>&1 \
  && ok "migrations as non-superuser owner ($(tail -1 "$WORK/migrate.log"))" || { ko "migrations"; tail -20 "$WORK/migrate.log"; exit 1; }

echo "== 3. grants phase as portico_owner (twice: idempotent)"
for i in 1 2; do
  DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >"$WORK/grants$i.log" 2>&1 \
    && ok "grants phase run $i" || { ko "grants phase run $i"; cat "$WORK/grants$i.log"; exit 1; }
done
node_eval "
  const lines = (await import('node:fs')).readFileSync('$WORK/grants2.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const r = lines.find((l) => l.msg === 'routing grants applied');
  console.log('  info  granted to worker: ' + r.granted.length + ', revoked from app: ' + r.revokedFromApp.length + ', missing: ' + JSON.stringify(r.missing) + ', unreviewed definers: ' + JSON.stringify(r.unreviewed));
  const w = lines.find((l) => l.level === 'warn'); if (w) console.log('  warn  ' + w.msg);
  process.exit(r.missing.length === 0 && r.unreviewed.length === 0 ? 0 : 1);
" && ok "routing list matches the migrations (nothing missing, no unreviewed SECURITY DEFINER function)" \
  || ko "routing list drifted from the migrations (see info line)"
if DATABASE_URL="$APP_URL" node "$BOOTSTRAP" grants >"$WORK/grants-app.log" 2>&1; then
  ko "grants phase as portico_app_blue should be refused"
elif grep -q "must run as portico_owner" "$WORK/grants-app.log"; then
  ok "grants phase refuses to run as portico_app_blue"
else
  ko "grants phase as app: $(tail -1 "$WORK/grants-app.log")"
fi

echo "== 4. privilege probes as login roles"
if psql "$(url portico_app_blue wrong-password)" -Atqc "select 1" >"$WORK/out" 2>&1; then
  ko "app login with a wrong password succeeded"
elif grep -q "password authentication failed" "$WORK/out"; then
  ok "app login with a wrong password fails (SCRAM)"
else
  ko "wrong-password probe: $(tail -1 "$WORK/out")"
fi
expect_ok     "worker: payments.tenants_for_jobs()" "$WORKER_URL" "select count(*) from payments.tenants_for_jobs()"
expect_ok     "worker: operations.job_properties()" "$WORKER_URL" "select count(*) from operations.job_properties()"
expect_ok     "worker: guests.tenants_with_active_profiles()" "$WORKER_URL" "select count(*) from guests.tenants_with_active_profiles()"
expect_ok     "worker: reservations.due_booking_expiries(now())" "$WORKER_URL" "select count(*) from reservations.due_booking_expiries(now())"
expect_ok     "worker: inventory.tenants_with_due_expiries(now(), 10)" "$WORKER_URL" "select count(*) from inventory.tenants_with_due_expiries(now(), 10)"
expect_ok     "worker: core.claim_unfanned_events(1) (rolled back)" "$WORKER_URL" "begin; select count(*) from core.claim_unfanned_events(1); rollback;"
expect_ok     "worker: payments.route_webhook(...)" "$WORKER_URL" "select count(*) from payments.route_webhook('stripe_connect', 'acct_none', false)"
expect_denied "app: payments.tenants_for_jobs() refused" "$APP_URL" "select count(*) from payments.tenants_for_jobs()"
expect_denied "app: integration.claim_due_tenants() refused" "$APP_URL" "select count(*) from integration.claim_due_tenants(1, 1)"
expect_denied "app: core.claim_unfanned_events() refused" "$APP_URL" "select count(*) from core.claim_unfanned_events(1)"
expect_denied "app: core.claim_job() refused" "$APP_URL" "select core.claim_job('verify', 60, 30)"
expect_ok     "app: payments.route_webhook() still allowed (public webhook route, FR §4)" "$APP_URL" "select count(*) from payments.route_webhook('stripe_connect', 'acct_none', false)"
expect_ok     "app: identity.login_lookup() allowed (sign-in)" "$APP_URL" "select count(*) from identity.login_lookup('nobody@example.invalid')"
expect_ok     "app: platform.tenant_environment() allowed" "$APP_URL" "select platform.tenant_environment('00000000-0000-0000-0000-000000000000'::uuid) is null"
expect_denied "app: cannot read the non-RLS payments directory" "$APP_URL" "select count(*) from payments.account_directory"
expect_denied "worker: cannot read the non-RLS payments directory" "$WORKER_URL" "select count(*) from payments.account_directory"
expect_denied "app: cannot create objects" "$APP_URL" "create table core.verify_should_fail (x int)"
expect_denied "worker: cannot create objects" "$WORKER_URL" "create table core.verify_should_fail (x int)"
priv="$(psql "$ADMIN_URL" -Atqc "select count(*) from pg_roles where rolname like 'portico\_%' and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb)")"
[ "$priv" = "0" ] && ok "no portico_* role is superuser/bypassrls/createrole/createdb" || ko "$priv privileged portico_* roles"
member="$(psql "$ADMIN_URL" -Atqc "select pg_has_role('portico_worker_blue', 'portico_app', 'USAGE') and not pg_has_role('portico_app_blue', 'portico_worker', 'USAGE')")"
[ "$member" = "t" ] && ok "worker inherits app privileges; app does not inherit worker grants" || ko "role membership wrong"

FIELD_KEY="$(rand 48 base64)"; INDEX_KEY="$(rand 48 base64)"; SEAL_KEY="$(rand 48 base64)"; SIM="$(rand 32)"
runtime_env=()
[ -n "${RUNTIME_DIR:-}" ] && runtime_env=(TSX_DISABLE_CACHE=1 TMPDIR=/nonexistent-read-only-root)
common_env=("${runtime_env[@]}" NODE_ENV=production LOG_LEVEL=warn PORTICO_FIELD_KEY="$FIELD_KEY" PORTICO_BLIND_INDEX_KEY="$INDEX_KEY"
  PORTICO_FIELD_KEY_ID=verify-field-v1 PORTICO_TERMS_SEAL_KEY="$SEAL_KEY" PAYMENTS_SIMULATOR_SIGNING_SECRET="$SIM")

echo "== 5. API as portico_app_blue"
(cd "$API_DIR" && env "${common_env[@]}" PORTICO_TERMS_SEAL_KEY= APP_DATABASE_URL="$APP_URL" PORT="$PORT_API" \
  timeout 60 "${API_CMD[@]}" src/main.ts) >"$WORK/api-noseal.log" 2>&1 \
  && ko "API started without PORTICO_TERMS_SEAL_KEY" \
  || { grep -q "PORTICO_TERMS_SEAL_KEY must be set in production" "$WORK/api-noseal.log" && ok "API refuses to start in production without PORTICO_TERMS_SEAL_KEY" || ko "API without seal key: $(tail -2 "$WORK/api-noseal.log")"; }
(cd "$API_DIR" && exec env "${common_env[@]}" APP_DATABASE_URL="$APP_URL" PORT="$PORT_API" \
  TRUSTED_PROXY_CIDRS="10.20.0.0/20,10.20.16.0/20,13.32.0.0/15" "${API_CMD[@]}" src/main.ts) >"$WORK/api.log" 2>&1 &
API_PID=$!
ready=""
for _ in $(seq 1 90); do
  if curl -fsS "http://127.0.0.1:$PORT_API/health/ready" >"$WORK/ready.json" 2>/dev/null; then ready=yes; break; fi
  sleep 1
done
[ -n "$ready" ] && ok "API /health/ready as portico_app_blue: $(head -c 120 "$WORK/ready.json")" || { ko "API not ready"; tail -20 "$WORK/api.log"; }
kill "$API_PID" 2>/dev/null || true; wait "$API_PID" 2>/dev/null || true

echo "== 6. demo seed as portico_app_blue, then the worker"
(cd "$API_DIR" && env "${common_env[@]}" APP_DATABASE_URL="$APP_URL" timeout 300 "${API_CMD[@]}" src/seed/demo-cli.ts) >"$WORK/seed.log" 2>&1 \
  && ok "demo seed as portico_app_blue" || { ko "demo seed"; tail -15 "$WORK/seed.log"; }
run_worker() { # <url> <log> <seconds>
  (cd "$WORKER_DIR" && exec env "${common_env[@]}" APP_DATABASE_URL="$1" timeout "$3" "${API_CMD[@]}" src/main.ts) >"$2" 2>&1 || true
}
run_worker "$WORKER_URL" "$WORK/worker.log" 25
if grep -q '"worker started"' "$WORK/worker.log" && ! grep -qiE "permission denied|job failed|worker loop error" "$WORK/worker.log"; then
  ok "worker as portico_worker_blue: started, ran jobs/outbox with no permission error"
else
  ko "worker as portico_worker_blue: $(grep -iE 'permission denied|job failed|loop error|Error' "$WORK/worker.log" | head -3)"
fi
DBURL="$(node_eval "const u = new URL(process.env.ADMIN_URL); u.pathname = '/$DB'; process.stdout.write(u.toString())")"
runs="$(psql "$DBURL" -Atqc "select string_agg(name || '=' || last_status, ', ' order by name) from core.job_runs" 2>/dev/null || echo '?')"
echo "  info  job runs recorded by the worker: $runs"
failed="$(psql "$DBURL" -Atqc "select count(*) from core.job_runs where last_status = 'failed'" 2>/dev/null || echo '?')"
[ "$failed" = "0" ] && ok "no job recorded a failed run" || ko "$failed job(s) failed: $(psql "$DBURL" -Atqc "select string_agg(name || ': ' || left(last_error, 120), ' | ') from core.job_runs where last_status = 'failed'")"
pending="$(psql "$DBURL" -Atqc "select count(*) from core.outbox where fanned_out_at is null" 2>/dev/null || echo '?')"
echo "  info  outbox events still unfanned after the worker ran: $pending"
run_worker "$APP_URL" "$WORK/worker-as-app.log" 8
grep -q "permission denied for function" "$WORK/worker-as-app.log" \
  && ok "worker as portico_app_blue is refused the routing functions (revocation effective)" \
  || ko "worker as portico_app_blue was not refused: $(tail -3 "$WORK/worker-as-app.log")"

psql "$ADMIN_URL" -qc "drop database $DB with (force)" >/dev/null 2>&1 || true
echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
