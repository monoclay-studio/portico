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
#      without a permission error) and as portico_app_blue (must be refused — proves the revocation bites);
#   7. the restore drill's verify.sql on the seeded database, then with two planted defects it must catch.
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
cp "$ROOT/infra/db/bootstrap-roles.mjs" "$ROOT/infra/db/definer-registry.mjs" "$WORK/ops/"
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
  ENABLE_IAM_READONLY_ROLE=true node "$BOOTSTRAP" >"$WORK/roles.log" 2>&1 && ok "roles phase" || { ko "roles phase"; cat "$WORK/roles.log"; exit 1; }

echo "== 2. migrations as portico_owner"
(cd "$API_DIR" && NODE_ENV=production DATABASE_URL="$OWNER_URL" "${API_CMD[@]}" src/migrate-cli.ts) >"$WORK/migrate.log" 2>&1 \
  && ok "migrations as non-superuser owner ($(tail -1 "$WORK/migrate.log"))" || { ko "migrations"; tail -20 "$WORK/migrate.log"; exit 1; }

echo "== 3. grants phase as portico_owner (once, then twice concurrently: idempotent and serialized)"
DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >"$WORK/grants1.log" 2>&1 \
  && ok "grants phase run 1" || { ko "grants phase run 1"; cat "$WORK/grants1.log"; exit 1; }
DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >"$WORK/grants2.log" 2>&1 & g2=$!
DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >"$WORK/grants3.log" 2>&1 & g3=$!
if wait "$g2" && wait "$g3"; then ok "two concurrent grants runs both succeed (advisory lock)"; else ko "concurrent grants runs"; cat "$WORK/grants2.log" "$WORK/grants3.log"; fi
node_eval "
  const lines = (await import('node:fs')).readFileSync('$WORK/grants3.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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

# Roles phase concurrently with itself (two deploys racing): both must succeed, nothing duplicated.
roles_env() {
  env PGHOST="$HOST" PGPORT="$PORT" PGDATABASE="$DB" PGSSLMODE=disable MASTER_USERNAME="$SUPERUSER" MASTER_PASSWORD="$SUPERPASS" \
    OWNER_SECRET_JSON="{\"username\":\"portico_owner\",\"password\":\"$OWNER_PW\"}" \
    APP_SECRET_JSON="{\"username\":\"portico_app_blue\",\"password\":\"$APP_BLUE_PW\",\"standby_username\":\"portico_app_green\",\"standby_password\":\"$APP_GREEN_PW\"}" \
    WORKER_SECRET_JSON="{\"username\":\"portico_worker_blue\",\"password\":\"$WORKER_BLUE_PW\",\"standby_username\":\"portico_worker_green\",\"standby_password\":\"$WORKER_GREEN_PW\"}" \
    node "$BOOTSTRAP"
}
roles_env >"$WORK/roles2.log" 2>&1 & r2=$!
roles_env >"$WORK/roles3.log" 2>&1 & r3=$!
if wait "$r2" && wait "$r3"; then ok "two concurrent roles runs both succeed"; else ko "concurrent roles runs"; cat "$WORK/roles2.log" "$WORK/roles3.log"; fi

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

echo "== 7. restore-drill verify.sql on this database (positive, then one planted defect per check)"
if psql "$DBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infra/restore-drill/verify.sql" >"$WORK/drill.log" 2>&1; then
  ok "verify.sql passes ($(grep -oE 'ledger balanced: [0-9]+ journal entries|SKIPPED: no finance ledger' "$WORK/drill.log" | head -1))"
else
  ko "verify.sql failed on a correct database: $(grep -m1 'DRILL FAIL' "$WORK/drill.log")"
fi
psql "$DBURL" -qc "grant execute on function payments.tenants_for_jobs() to portico_app" >/dev/null
if psql "$DBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infra/restore-drill/verify.sql" >"$WORK/drill-neg1.log" 2>&1; then
  ko "verify.sql missed a routing function granted to portico_app"
else
  grep -q "unreviewed SECURITY DEFINER functions reachable by a login group: portico_app→payments.tenants_for_jobs()" "$WORK/drill-neg1.log" \
    && ok "verify.sql catches a routing function re-granted to portico_app" || ko "routing negative: $(grep -m1 'DRILL FAIL' "$WORK/drill-neg1.log")"
fi
psql "$DBURL" -qc "revoke execute on function payments.tenants_for_jobs() from portico_app" >/dev/null
# Ledger: plant one balanced and then one unbalanced synthetic entry (bypassing the deferred balance trigger with
# session_replication_role = replica, as a corrupted restore would) — the drill must accept the first, refuse the second.
plant() { # <entry-id> <second-line-amount>
  psql "$DBURL" -v ON_ERROR_STOP=1 -qc "set session_replication_role = replica;
    insert into finance.journal_lines (id, tenant_id, entry_id, legal_entity_id, line_no, account_id, amount_minor, currency,
                                       functional_amount_minor, functional_currency)
    values (gen_random_uuid(), gen_random_uuid(), '$1', gen_random_uuid(), 1, gen_random_uuid(), 1000, 'USD', 1000, 'USD'),
           (gen_random_uuid(), gen_random_uuid(), '$1', gen_random_uuid(), 2, gen_random_uuid(), $2, 'USD', $2, 'USD')" >/dev/null
}
plant 00000000-0000-0000-0000-00000000000a -1000
if psql "$DBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infra/restore-drill/verify.sql" >"$WORK/drill-bal.log" 2>&1; then
  ok "verify.sql accepts a balanced entry ($(grep -oE 'ledger balanced: [0-9]+ journal entries' "$WORK/drill-bal.log"))"
else
  ko "verify.sql refused a balanced entry: $(grep -m1 'DRILL FAIL' "$WORK/drill-bal.log")"
fi
plant 00000000-0000-0000-0000-00000000000b -999
if psql "$DBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infra/restore-drill/verify.sql" >"$WORK/drill-neg2.log" 2>&1; then
  ko "verify.sql missed an unbalanced journal entry"
else
  grep -q "unbalanced journal entries: 00000000-0000-0000-0000-00000000000b" "$WORK/drill-neg2.log" && ok "verify.sql catches an unbalanced journal entry" \
    || ko "ledger negative: $(grep -m1 'DRILL FAIL' "$WORK/drill-neg2.log")"
fi
psql "$DBURL" -qc "set session_replication_role = replica; delete from finance.journal_lines where entry_id = '00000000-0000-0000-0000-00000000000b'" >/dev/null

# One planted defect per drill check (review P2-4): each must FAIL verify.sql with the named message, then be undone.
drill_negative() { # <label> <expected message regex> <plant sql> <undo sql>
  psql "$DBURL" -v ON_ERROR_STOP=1 -qc "$3" >/dev/null 2>"$WORK/plant.err" || { ko "$1: could not plant ($(tail -1 "$WORK/plant.err"))"; return; }
  if psql "$DBURL" -v ON_ERROR_STOP=1 -f "$ROOT/infra/restore-drill/verify.sql" >"$WORK/drill-n.log" 2>&1; then
    ko "verify.sql missed: $1"
  elif grep -qE "$2" "$WORK/drill-n.log"; then ok "verify.sql catches: $1"
  else ko "$1: failed for another reason: $(grep -m1 'DRILL FAIL' "$WORK/drill-n.log")"; fi
  psql "$DBURL" -v ON_ERROR_STOP=1 -qc "$4" >/dev/null
}
TT="$(psql "$DBURL" -Atqc "select c.oid::regclass from pg_policy p join pg_class c on c.oid = p.polrelid where p.polname = 'tenant_isolation' order by 1 limit 1")"
drill_negative "tenant policy replaced by USING (true)" "non-standard tenant policy: $TT" \
  "alter policy tenant_isolation on $TT using (true) with check (true)" \
  "alter policy tenant_isolation on $TT using (tenant_id = core.current_tenant_id()) with check (tenant_id = core.current_tenant_id())"
drill_negative "tenant policy widened with OR true" "non-standard tenant policy: $TT" \
  "alter policy tenant_isolation on $TT using ((tenant_id = core.current_tenant_id()) or true)" \
  "alter policy tenant_isolation on $TT using (tenant_id = core.current_tenant_id())"
drill_negative "extra permissive USING (true) policy" "non-standard tenant policy: $TT\\(open\\)" \
  "create policy open on $TT using (true)" "drop policy open on $TT"
drill_negative "new non-tenant table with a USING (true) policy" "unreviewed policies on non-tenant tables: core.drill_probe.open" \
  "create table core.drill_probe (x int); alter table core.drill_probe enable row level security; create policy open on core.drill_probe using (true); grant select on core.drill_probe to portico_app" \
  "drop table core.drill_probe"
drill_negative "portico_worker granted DELETE on the audit log" "portico_worker can modify core.audit_log" \
  "grant delete on core.audit_log to portico_worker" "revoke delete on core.audit_log from portico_worker"
drill_negative "portico_worker granted SELECT on a non-RLS directory table" "portico_worker→payments.account_directory" \
  "grant select on payments.account_directory to portico_worker" "revoke select on payments.account_directory from portico_worker"
drill_negative "worker-only unreviewed definer function" "portico_worker→core.drill_leak\\(\\)" \
  "create function core.drill_leak() returns int language sql security definer set search_path = core, pg_temp as 'select 1'; revoke execute on function core.drill_leak() from public; grant execute on function core.drill_leak() to portico_worker" \
  "drop function core.drill_leak()"

echo "== 8. grants phase fails CLOSED on an unreviewed definer function (review P2-2)"
psql "$DBURL" -v ON_ERROR_STOP=1 -qc "set role portico_owner;
  create function identity.leak_memberships() returns setof uuid language sql stable security definer
    set search_path = identity, pg_temp as 'select tenant_id from identity.user_tenants';
  revoke execute on function identity.leak_memberships() from public;
  grant execute on function identity.leak_memberships() to portico_app;
  create function core.leak_worker_only() returns int language sql security definer set search_path = core, pg_temp as 'select 1';
  revoke execute on function core.leak_worker_only() from public;
  grant execute on function core.leak_worker_only() to portico_worker;" >/dev/null
if DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >"$WORK/grants-unreviewed.log" 2>&1; then
  ko "grants phase exited 0 with unreviewed definer functions"
else
  grep -q "have been REVOKED: core.leak_worker_only(), identity.leak_memberships()" "$WORK/grants-unreviewed.log" \
    && ok "grants phase exits non-zero and names both unreviewed functions (app and worker-only)" \
    || ko "grants failure message: $(tail -1 "$WORK/grants-unreviewed.log")"
fi
expect_denied "after the failed grants step the app can no longer call the unreviewed function" "$APP_URL" "select count(*) from identity.leak_memberships()"
expect_denied "after the failed grants step the worker can no longer call either function" "$WORKER_URL" "select core.leak_worker_only()"
psql "$DBURL" -qc "drop function identity.leak_memberships(); drop function core.leak_worker_only()" >/dev/null

echo "== 9. portico_ops_readonly reaches no tenant or directory data (review P2-3)"
DATABASE_URL="$OWNER_URL" node "$BOOTSTRAP" grants >/dev/null 2>&1 || ko "grants re-run after cleanup"
reach="$(psql "$DBURL" -Atqc "select string_agg(t, ',' order by t) from unnest(array['identity.dev_mailbox','identity.login_attempts','identity.user_tenants','identity.users','payments.account_directory','platform.tenant_directory','core.audit_log','core.outbox']) t where to_regclass(t) is not null and has_table_privilege('portico_ops_readonly', t, 'SELECT')")"
[ -z "$reach" ] && ok "ops role cannot read mailbox, login attempts, memberships, users, directories, audit, outbox" || ko "ops role can read: $reach"
member="$(psql "$DBURL" -Atqc "select pg_has_role('portico_ops_readonly', 'pg_read_all_data', 'USAGE')")"
[ "$member" = "f" ] && ok "ops role is not a member of pg_read_all_data" || ko "ops role holds pg_read_all_data"
ops_ok="$(psql "$DBURL" -Atqc "select has_table_privilege('portico_ops_readonly', 'core.job_runs', 'SELECT') and has_table_privilege('portico_ops_readonly', 'core.schema_migrations', 'SELECT')")"
[ "$ops_ok" = "t" ] && ok "ops role reads core.job_runs and core.schema_migrations only" || ko "ops role lacks its operational tables"

echo "== 10. no bind values or row values in Postgres logs (review P2-5)"
if [ -n "${PG_LOG_FILE:-}" ] && [ -r "$PG_LOG_FILE" ]; then
  log_probe() { # <marker> → 0 when the marker reached the server log
    psql "$ADMIN_URL" -qc "alter database $DB set log_min_duration_statement = 0" >/dev/null
    (cd "$API_DIR" && node --input-type=module -e "
      import pg from 'pg'; const c = new pg.Client({ connectionString: process.env.U }); await c.connect();
      await c.query('select \$1::text as v', ['$1']); await c.end();" ) 2>/dev/null
    sleep 1; grep -q "$1" "$PG_LOG_FILE"
  }
  psql "$ADMIN_URL" -qc "alter database $DB reset log_parameter_max_length; alter database $DB reset log_parameter_max_length_on_error" >/dev/null
  if U="$APP_URL" log_probe "probe-unsafe-$DB"; then ok "control: without the settings a bind value DOES reach the log (probe works)"; else ko "control probe found nothing — probe broken"; fi
  psql "$ADMIN_URL" -qc "alter database $DB set log_parameter_max_length = 0; alter database $DB set log_parameter_max_length_on_error = 0; alter database $DB set log_error_verbosity = terse" >/dev/null
  if U="$APP_URL" log_probe "probe-guest-$DB"; then ko "bind value reached the log with the shipped settings"; else ok "with the shipped settings (log_parameter_max_length[_on_error]=0, terse) no bind value reaches the log"; fi
  psql "$ADMIN_URL" -qc "alter database $DB reset log_min_duration_statement" >/dev/null
else
  echo "  SKIP  log probe: set PG_LOG_FILE to the server log to run it (not counted as passed)"
fi

psql "$ADMIN_URL" -qc "drop database $DB with (force)" >/dev/null 2>&1 || true
echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
