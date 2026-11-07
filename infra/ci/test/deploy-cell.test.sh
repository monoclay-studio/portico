#!/usr/bin/env bash
# Offline tests for infra/ci/deploy-cell.sh: a fake aws CLI (fake-aws.sh), a fake skopeo and a local HTTP server
# standing in for the public URL. Proves the control flow — order, refusals, digests, rollback — not AWS behaviour.
#   infra/ci/test/deploy-cell.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
DEPLOY="$HERE/../deploy-cell.sh"
TMP="$(mktemp -d)"
PORT="${PORT:-48799}"
trap 'kill $SERVER 2>/dev/null; rm -rf "$TMP"' EXIT

cat >"$TMP/server.py" <<'PY'
import http.server, sys
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
P=portico-prod-aps1-c01
F() { echo "$TMP/fake"; }
raw() { echo "{\"schemaVersion\":2,\"mediaType\":\"application/vnd.oci.image.index.v1+json\",\"manifests\":[\"$1\"]}"; }
dg() { printf '%s' "$(raw "$1")" | sha256sum | cut -d' ' -f1; }

setup() { # <runtime>
  rm -rf "$TMP/fake" && mkdir -p "$TMP/fake/svc" "$TMP/fake/manifests"
  jq -n --arg rt "$1" --arg url "http://127.0.0.1:$PORT" --arg p "$P" '{
    runtime: $rt, region: "ap-south-1", cluster: $p, instance_id: "i-0123", document: ($p + "-deploy"),
    services: {api: "api", worker: "worker"}, release_tag: "release",
    repositories: {api: ("ecr/" + $p + "/api"), worker: ("ecr/" + $p + "/worker"), "restore-drill": ("ecr/" + $p + "/restore-drill")},
    log_groups: {migrate: "/portico/x/migrate", api: "/portico/x/api"}, smoke_base_url: $url,
    web: {bucket: "web-bucket", distribution_id: "E123"}}' >"$TMP/fake/config.json"
  [ "$1" = single_host ] && jq '.repositories |= del(.["restore-drill"])' "$TMP/fake/config.json" >"$TMP/c" && mv "$TMP/c" "$TMP/fake/config.json"
  # the currently released ("old") images
  for n in api worker restore-drill; do
    mkdir -p "$TMP/fake/ecr/${P}__$n"; printf '%s' "$(raw "old-$n")" >"$TMP/fake/manifests/$(dg "old-$n")"
    echo "sha256:$(dg "old-$n")" >"$TMP/fake/ecr/${P}__$n/release"; echo "sha256:$(dg "old-$n")" >"$TMP/fake/ecr/${P}__$n/0000000"
  done
  rm -rf "$TMP/oci" && mkdir -p "$TMP/oci" && for n in api worker restore-drill; do : >"$TMP/oci/$n.oci.tar"; raw "new-$n" >"$TMP/oci/$n.oci.tar.raw"; done
  # raw() above adds a newline through echo; the archive bytes are exactly what the file holds
  for n in api worker restore-drill; do printf '%s' "$(raw "new-$n")" >"$TMP/oci/$n.oci.tar.raw"; done
  mkdir -p "$TMP/web/assets" && echo '<html></html>' >"$TMP/web/index.html"
}
run() { FAKE_DIR="$TMP/fake" AWS_CLI="$HERE/fake-aws.sh" SKOPEO="$HERE/fake-skopeo.sh" SMOKE_RETRIES=2 SMOKE_SLEEP=0 POLL_SLEEP=0 "$DEPLOY" "$P" "$@" >"$TMP/out" 2>&1; }
line_of() { grep -n -- "$1" "$TMP/fake/calls.log" | head -1 | cut -d: -f1; }
release_of() { cat "$TMP/fake/ecr/${P}__$1/release"; }
new_of() { echo "sha256:$(dg "new-$1")"; }
old_of() { echo "sha256:$(dg "old-$1")"; }
L() { echo "$TMP/fake/calls.log"; }

echo "== happy path (Fargate)"
setup fargate; echo ok >"$TMP/mode"
run abc1234 --push-oci "$TMP/oci" --web-dist "$TMP/web"; rc=$?
check "exits 0" "[ $rc = 0 ]"
check "all three images pushed with --all --preserve-digests before anything is deployed" "[ \$(grep -c 'skopeo copy --all --preserve-digests' $(L)) = 3 ] && [ \$(line_of 'skopeo copy') -lt \$(line_of 'update-service') ]"
check "registry credentials never on a command line" "! grep -q 'fake-token' $(L)"
check "api deployment resolved the NEW api image" "grep -q \"deployed api \$(new_of api)\" $(L)"
check "api rolls before the worker (migrations run in the api's init containers)" "[ \$(line_of 'deployed api') -lt \$(line_of 'deployed worker') ]"
check "worker deployment resolved the NEW worker image" "grep -q \"deployed worker \$(new_of worker)\" $(L)"
check "restore-drill release tag moved with the release" "[ \"\$(release_of restore-drill)\" = \"\$(new_of restore-drill)\" ]"
check "no task definition registered, no task run, no role passed, no secret read" "! grep -qE 'register-task-definition|run-task|PassRole|secretsmanager|logs ' $(L)"
check "web published after the services, index.html last" "[ \$(line_of 's3 sync') -gt \$(line_of 'deployed worker') ] && [ \$(line_of 's3 cp') -gt \$(line_of 's3 sync') ]"

echo "== image push (digest preserved, immutable tags)"
setup fargate; for n in api worker restore-drill; do echo "$(new_of $n)" >"$TMP/fake/ecr/${P}__$n/abc1234"; printf '%s' "$(raw "new-$n")" >"$TMP/fake/manifests/$(dg "new-$n")"; done
run abc1234 --push-oci "$TMP/oci"; rc=$?
check "re-run with identical digests: accepted without pushing" "[ $rc = 0 ] && ! grep -q 'skopeo copy' $(L)"
setup fargate; echo "sha256:something-else" >"$TMP/fake/ecr/${P}__api/abc1234"
run abc1234 --push-oci "$TMP/oci"; rc=$?
check "existing SHA tag with a different digest: refused before any deployment" "[ $rc != 0 ] && ! grep -q 'update-service' $(L)"
setup fargate; FAKE_PUSH_DIGEST=sha256:rewritten run abc1234 --push-oci "$TMP/oci"; rc=$?
check "pushed digest differs from the built index digest: refused" "[ $rc != 0 ] && ! grep -q 'update-service' $(L)"
setup fargate; run abc1234; rc=$?
check "release not pushed yet: refused before any tag moves" "[ $rc != 0 ] && [ \"\$(release_of api)\" = \"\$(old_of api)\" ]"

echo "== refusals before any AWS call"
setup fargate; run latest; rc=$?
check "mutable tag name refused" "[ $rc = 2 ] && [ ! -s $(L) ]"
setup fargate; run abc1234 --bootstrap-roles; rc=$?
check "--bootstrap-roles refused (human break-glass only)" "[ $rc = 2 ] && [ ! -s $(L) ]"

echo "== api deployment fails (migration / grants init container or health check → circuit breaker)"
setup fargate; FAKE_ROLLOUT_api=FAILED run abc1234 --push-oci "$TMP/oci" --web-dist "$TMP/web"; rc=$?
check "exits non-zero" "[ $rc != 0 ]"
check "worker never received the new image" "! grep -q \"deployed worker \$(new_of worker)\" $(L)"
check "release tags back on the previous digests" "[ \"\$(release_of api)\" = \"\$(old_of api)\" ] && [ \"\$(release_of worker)\" = \"\$(old_of worker)\" ]"
check "both services redeployed on the previous images" "grep -q \"deployed api \$(old_of api)\" $(L) && grep -q \"deployed worker \$(old_of worker)\" $(L)"
check "web app not published" "! grep -q 's3 ' $(L)"

echo "== worker deployment fails"
setup fargate; FAKE_ROLLOUT_worker=FAILED run abc1234 --push-oci "$TMP/oci"; rc=$?
check "exits non-zero, release tags back, both redeployed on the previous images" "[ $rc != 0 ] && [ \"\$(release_of api)\" = \"\$(old_of api)\" ] && [ \"\$(release_of worker)\" = \"\$(old_of worker)\" ] && grep -q \"deployed api \$(old_of api)\" $(L)"

echo "== smoke test fails (API path open without auth)"
setup fargate; echo open-api >"$TMP/mode"; run abc1234 --push-oci "$TMP/oci" --web-dist "$TMP/web"; rc=$?
check "exits non-zero" "[ $rc != 0 ]"
check "release tags (api, worker, restore-drill) back on the previous digests" "[ \"\$(release_of api)\" = \"\$(old_of api)\" ] && [ \"\$(release_of worker)\" = \"\$(old_of worker)\" ] && [ \"\$(release_of restore-drill)\" = \"\$(old_of restore-drill)\" ]"
check "web app not published" "! grep -q 's3 ' $(L)"
echo ok >"$TMP/mode"

echo "== demo host"
setup single_host; run abc1234 --web-dist "$TMP/web"; rc=$?
check "exits 0" "[ $rc = 0 ]"
check "host gets the cell's deploy document with validated parameters (never AWS-RunShellScript)" "grep -q -- '--document-name $P-deploy' $(L) && grep -q 'tag=abc1234,baseUrl=http://127.0.0.1:$PORT' $(L) && ! grep -q 'AWS-RunShellScript' $(L)"
check "no ECS calls" "! grep -q '^ecs ' $(L)"
setup single_host; FAKE_HOST_STATUS=Failed run abc1234 --web-dist "$TMP/web"; rc=$?
check "host failure → exits non-zero, web not published" "[ $rc != 0 ] && ! grep -q 's3 ' $(L)"

echo "== result: $pass passed, $fail failed"
[ "$fail" = 0 ]
