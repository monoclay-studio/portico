#!/usr/bin/env bash
# Offline tests for infra/ci/deploy-cell.sh: a fake aws CLI (fake-aws.sh) and a local HTTP server standing in for
# the public URL. Proves the control flow — order of steps, refusal paths, rollback — not AWS behaviour.
#   infra/ci/test/deploy-cell.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/../deploy-cell.sh"
TMP="$(mktemp -d)"
PORT="${PORT:-48799}"
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT

# Public URL stand-in: /health/ready and /v1/me behave per $TMP/mode (ok | not-ready | open-api).
cat >"$TMP/server.py" <<'PY'
import http.server, sys, os
mode_file = sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        mode = open(mode_file).read().strip()
        if self.path == "/health/ready":
            ok = mode != "not-ready"
            self.send_response(200 if ok else 503); self.end_headers()
            self.wfile.write(b'{"status":"ready"}' if ok else b'{"status":"not_ready"}')
        elif self.path == "/v1/me":
            self.send_response(200 if mode == "open-api" else 401); self.end_headers()
        else:
            self.send_response(404); self.end_headers()
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
PY
echo ok >"$TMP/mode"
python3 -I "$TMP/server.py" "$PORT" "$TMP/mode" &
SERVER=$!
sleep 1

pass=0; fail=0
check() { if eval "$2"; then echo "  PASS  $1"; pass=$((pass + 1)); else echo "  FAIL  $1"; fail=$((fail + 1)); fi; }

setup() { # <runtime>
  rm -rf "$TMP/fake" && mkdir -p "$TMP/fake/current"
  local p=portico-prod-aps1-c01
  jq -n --arg rt "$1" --arg url "http://127.0.0.1:$PORT" --arg p "$p" '{
    runtime: $rt, region: "ap-south-1", cluster: $p, instance_id: "i-0123",
    services: {api: "api", worker: "worker"},
    task_families: {api: ($p + "-api"), worker: ($p + "-worker"), migrate: ($p + "-migrate"), db_bootstrap: ($p + "-db-bootstrap")},
    repositories: {api: "ecr/api", worker: "ecr/worker"}, ops_subnets: ["subnet-a", "subnet-b"], ops_security: "sg-ops",
    assign_public_ip: true, log_groups: {migrate: "/portico/x/migrate"}, smoke_base_url: $url,
    web: {bucket: "web-bucket", distribution_id: "E123"}, grants_command: ["node", "/app/ops/bootstrap-roles.mjs", "grants"]}' \
    >"$TMP/fake/config.json"
  echo "arn:td/$p-api:1" >"$TMP/fake/current/api"
  echo "arn:td/$p-worker:1" >"$TMP/fake/current/worker"
  mkdir -p "$TMP/web/assets" && echo '<html></html>' >"$TMP/web/index.html"
  mkdir -p "$TMP/oci" && for n in api worker; do : >"$TMP/oci/$n.oci.tar"; echo "sha256:$n-built" >"$TMP/oci/$n.oci.tar.digest"; done
}
run() { FAKE_DIR="$TMP/fake" AWS_CLI="$HERE/fake-aws.sh" SKOPEO="$HERE/fake-skopeo.sh" SMOKE_RETRIES=2 "$DEPLOY" portico-prod-aps1-c01 "$@" >"$TMP/out" 2>&1; }
calls() { cat "$TMP/fake/calls.log"; }
line_of() { grep -n -- "$1" "$TMP/fake/calls.log" | head -1 | cut -d: -f1; }

echo "== happy path (Fargate)"
setup fargate; echo ok >"$TMP/mode"
run abc1234 --bootstrap-roles --web-dist "$TMP/web"; rc=$?
check "exits 0" "[ $rc = 0 ]"
check "every task definition gets the new image" "[ \$(grep -c 'register .*:abc1234' $TMP/fake/calls.log) = 4 ]"
check "bootstrap, migrate, grants run before any service update" "[ \$(line_of 'run-task') -lt \$(line_of 'update-service') ] && [ \$(grep -c 'ecs run-task' $TMP/fake/calls.log) = 3 ]"
check "grants run with the bootstrap-roles grants command" "grep -q 'run-task.*bootstrap-roles.mjs.*grants' $TMP/fake/calls.log"
check "worker rolls before api" "[ \$(line_of 'update-service --cluster portico-prod-aps1-c01 --service worker') -lt \$(line_of 'update-service --cluster portico-prod-aps1-c01 --service api') ]"
check "services end on the new revisions" "grep -q ':2' $TMP/fake/current/api && grep -q ':2' $TMP/fake/current/worker"
check "web published after the services, index.html last" "[ \$(line_of 's3 sync') -gt \$(line_of 'update-service') ] && [ \$(line_of 's3 cp') -gt \$(line_of 's3 sync') ]"

echo "== image push (digest preserved, immutable tags)"
setup fargate; run abc1234 --push-oci "$TMP/oci"; rc=$?
check "exits 0 and pushes both images before registering task definitions" "[ $rc = 0 ] && [ \$(grep -c 'skopeo copy --preserve-digests' $TMP/fake/calls.log) = 2 ] && [ \$(line_of 'skopeo copy') -lt \$(line_of 'register ') ]"
check "registry credentials never on a command line" "! grep -q 'fake-token' $TMP/fake/calls.log"
setup fargate; mkdir -p "$TMP/fake/ecr"; echo "sha256:api-built" >"$TMP/fake/ecr/api"; echo "sha256:worker-built" >"$TMP/fake/ecr/worker"
run abc1234 --push-oci "$TMP/oci"; rc=$?
check "re-run with identical digests: accepted without pushing" "[ $rc = 0 ] && ! grep -q 'skopeo copy' $TMP/fake/calls.log"
setup fargate; mkdir -p "$TMP/fake/ecr"; echo "sha256:something-else" >"$TMP/fake/ecr/api"
run abc1234 --push-oci "$TMP/oci"; rc=$?
check "existing tag with a different digest: refused before any deploy step" "[ $rc != 0 ] && ! grep -q 'register ' $TMP/fake/calls.log"
setup fargate; FAKE_PUSH_DIGEST=sha256:rewritten run abc1234 --push-oci "$TMP/oci"; rc=$?
check "pushed digest differs from the built one: refused" "[ $rc != 0 ] && ! grep -q 'register ' $TMP/fake/calls.log"

echo "== mutable tag refused"
setup fargate; run latest; rc=$?
check "non-SHA tag refused before any AWS call" "[ $rc = 2 ] && [ ! -s $TMP/fake/calls.log ]"

echo "== migration fails"
setup fargate; FAKE_MIGRATE_EXIT=1 run abc1234; rc=$?
check "exits non-zero" "[ $rc != 0 ]"
check "no service was touched" "! grep -q update-service $TMP/fake/calls.log"
check "grants not run after a failed migration" "[ \$(grep -c 'ecs run-task' $TMP/fake/calls.log) = 1 ]"
check "services still on the old revisions" "grep -q ':1' $TMP/fake/current/api && grep -q ':1' $TMP/fake/current/worker"

echo "== ECS rollout fails (circuit breaker / alarm)"
setup fargate; FAKE_ROLLOUT=FAILED run abc1234; rc=$?
check "exits non-zero" "[ $rc != 0 ]"
check "both services restored to the previous revisions" "grep -q ':1' $TMP/fake/current/api && grep -q ':1' $TMP/fake/current/worker"
check "web app not published" "! grep -q 's3 ' $TMP/fake/calls.log"

echo "== smoke test fails (API path open without auth)"
setup fargate; echo open-api >"$TMP/mode"; run abc1234 --web-dist "$TMP/web"; rc=$?
check "exits non-zero" "[ $rc != 0 ]"
check "both services restored to the previous revisions" "grep -q ':1' $TMP/fake/current/api && grep -q ':1' $TMP/fake/current/worker"
check "web app not published" "! grep -q 's3 ' $TMP/fake/calls.log"
echo ok >"$TMP/mode"

echo "== demo host"
setup single_host; run abc1234 --web-dist "$TMP/web"; rc=$?
check "exits 0" "[ $rc = 0 ]"
check "host told to deploy the tag with the public base URL" "grep -q 'portico deploy abc1234 http://127.0.0.1:$PORT' $TMP/fake/calls.log"
check "no ECS calls" "! grep -q '^ecs ' $TMP/fake/calls.log"
setup single_host; FAKE_HOST_STATUS=Failed run abc1234 --web-dist "$TMP/web"; rc=$?
check "host failure → exits non-zero, web not published" "[ $rc != 0 ] && ! grep -q 's3 ' $TMP/fake/calls.log"

echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
