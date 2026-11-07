#!/usr/bin/env bash
# Deploy one release (an immutable git SHA) to one Portico cell. Called by infra/ci/deploy.yml.example with the cell's
# GitHub OIDC deploy role (modules/ci-deploy-role); usable by a human with the same role. docs/runbooks/deploy.md
# explains every step; docs/runbooks/rollback.md what to do when this script stops.
#
#   infra/ci/deploy-cell.sh <cell-name-prefix> <git-sha> [--push-oci <dir>] [--web-dist <dir>]
#     --push-oci   directory with api.oci.tar, worker.oci.tar[, restore-drill.oci.tar] built ONCE by the pipeline:
#                  pushed under the SHA tag with every platform and the index digest preserved (`--all`), so staging
#                  and production run byte-identical images; an existing SHA tag must have the same index digest
#     --web-dist   built staff web app to publish after the API is healthy
#
# What this script can and cannot do (the deploy role's permissions, enforced by IAM, not by this script):
#   it pushes images, moves the one mutable tag (`release`) and forces new deployments of the task definitions
#   TERRAFORM registered. It cannot register task definitions, run tasks, pass roles or read secrets. Migrations and
#   the routing grants run as init containers of every new api task (Terraform-defined, as portico_owner): the api
#   container starts only after both succeed. The role bootstrap (RDS master) is never part of a release.
#
# Fargate cells, in order:
#   0. remember where `release` points now (api, worker, restore-drill) — the rollback target
#   1. api: move `release` to the new SHA's digest, force a new deployment → init containers migrate + grant → api;
#      ECS circuit breaker + 5xx / no-healthy-target alarms roll back a failing deployment automatically
#   2. worker: same (after the api, so the schema is already migrated); restore-drill: move the tag (next drill and
#      the daily freshness check use the same commit's verify.sql)
#   3. smoke test through the public URL (CloudFront → WAF → ALB → api); on any failure the tags go back to the
#      recorded digests and both services are redeployed. The database is never rolled back (rollback.md)
#   4. web app (hashed assets first, index.html last), CloudFront invalidation of index.html
# Demo cells: SSM Run Command with the cell's own deploy document (tag and URL validated by SSM), then smoke + web.
#
# Environment: AWS_REGION (default: deploy-config region), SMOKE_RETRIES (30), AWS_CLI / SKOPEO (aws / skopeo; the
# offline tests point them at stubs). Requires bash, jq, curl, sha256sum, aws CLI v2, skopeo.
set -euo pipefail

PREFIX="${1:?usage: deploy-cell.sh <cell-name-prefix> <git-sha> [--push-oci <dir>] [--web-dist <dir>]}"
TAG="${2:?git SHA required}"
shift 2
WEB_DIST=""
PUSH_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --web-dist) WEB_DIST="${2:?--web-dist needs a directory}"; shift ;;
    --push-oci) PUSH_DIR="${2:?--push-oci needs a directory}"; shift ;;
    --bootstrap-roles)
      echo "--bootstrap-roles was removed: the role bootstrap uses the RDS master and is a human break-glass step (docs/runbooks/database-roles.md)" >&2
      exit 2 ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "release must be an immutable git SHA, got '$TAG'" >&2; exit 2; }

AWS="${AWS_CLI:-aws}"
SKOPEO="${SKOPEO:-skopeo}"
SMOKE_RETRIES="${SMOKE_RETRIES:-30}"
log() { printf '%s deploy[%s]: %s\n' "$(date -u +%FT%TZ)" "$PREFIX" "$*" >&2; }
die() { log "FAILED: $*"; exit 1; }

CONFIG="$($AWS ssm get-parameter --name "/portico/$PREFIX/deploy-config" --query Parameter.Value --output text)" \
  || die "cannot read /portico/$PREFIX/deploy-config (wrong cell, or the role lacks ssm:GetParameter)"
cfg() { jq -r "$1" <<<"$CONFIG"; }
export AWS_REGION="${AWS_REGION:-$(cfg .region)}"
RUNTIME="$(cfg .runtime)"
BASE_URL="$(cfg .smoke_base_url)"
RELEASE="$(cfg '.release_tag // "release"')"

repo_name() { local url; url="$(cfg ".repositories[\"$1\"]")"; echo "${url#*/}"; }
digest_of() { # <repository-name> <tag> → digest, or empty when the tag does not exist
  $AWS ecr describe-images --repository-name "$1" --image-ids "imageTag=$2" \
    --query 'imageDetails[0].imageDigest' --output text 2>/dev/null | grep -E '^sha256:' || true
}

smoke_test() {
  local i code body
  for ((i = 1; i <= SMOKE_RETRIES; i++)); do
    body="$(curl -sS --max-time 10 "$BASE_URL/health/ready" 2>/dev/null || true)"
    if [[ "$body" == *'"ready"'* ]]; then
      # An unauthenticated API call must be refused by the API itself (401): proves the whole path routes /v1.
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/v1/me" 2>/dev/null || true)"
      if [ "$code" = "401" ]; then log "smoke test passed (ready; /v1/me → 401)"; return 0; fi
      log "smoke: /v1/me answered $code, expected 401 (attempt $i)"
    else
      log "smoke: /health/ready not ready yet (attempt $i)"
    fi
    sleep "${SMOKE_SLEEP:-10}"
  done
  return 1
}

publish_web() {
  [ -n "$WEB_DIST" ] || { log "no --web-dist: web app not published"; return 0; }
  [ -f "$WEB_DIST/index.html" ] || die "$WEB_DIST/index.html missing (build apps/backoffice first)"
  local bucket dist
  bucket="$(cfg .web.bucket)"
  dist="$(cfg .web.distribution_id)"
  $AWS s3 sync "$WEB_DIST" "s3://$bucket/" --exclude index.html --cache-control "public,max-age=31536000,immutable" --only-show-errors
  $AWS s3 cp "$WEB_DIST/index.html" "s3://$bucket/index.html" --cache-control "no-cache" --only-show-errors
  $AWS cloudfront create-invalidation --distribution-id "$dist" --paths /index.html / >/dev/null
  log "web app published to s3://$bucket (index.html invalidated)"
}

push_images() {
  [ -n "$PUSH_DIR" ] || return 0
  local name url registry repo raw built existing
  for name in $(cfg '.repositories | keys[]'); do
    if [ ! -f "$PUSH_DIR/$name.oci.tar" ]; then
      [ "$name" = "restore-drill" ] && { log "no restore-drill image in $PUSH_DIR"; continue; }
      die "$PUSH_DIR/$name.oci.tar missing"
    fi
    url="$(cfg ".repositories[\"$name\"]")"
    registry="${url%%/*}"
    repo="${url#*/}"
    # The index digest = sha256 of the top-level manifest bytes; ECR reports exactly that for a pushed index.
    raw="$($SKOPEO inspect --raw "oci-archive:$PUSH_DIR/$name.oci.tar")"
    built="sha256:$(printf '%s' "$raw" | sha256sum | cut -d' ' -f1)"
    existing="$(digest_of "$repo" "$TAG")"
    if [ -n "$existing" ]; then
      [ "$existing" = "$built" ] || die "$repo:$TAG already exists with digest $existing, not $built — tags are immutable; investigate"
      log "$repo:$TAG already present with the same digest"
      continue
    fi
    $AWS ecr get-login-password | $SKOPEO login --username AWS --password-stdin "$registry" >/dev/null
    $SKOPEO copy --all --preserve-digests "oci-archive:$PUSH_DIR/$name.oci.tar" "docker://$url:$TAG" >/dev/null
    existing="$(digest_of "$repo" "$TAG")"
    [ "$existing" = "$built" ] || die "$repo:$TAG pushed with digest '$existing', expected $built"
    log "pushed $repo:$TAG ($built)"
  done
}

move_release() { # <repository-name> <digest> — point the mutable release tag at an image that already exists
  local repo="$1" digest="$2" manifest media out
  [ "$(digest_of "$repo" "$RELEASE")" = "$digest" ] && { log "$repo:$RELEASE already at $digest"; return 0; }
  manifest="$($AWS ecr batch-get-image --repository-name "$repo" --image-ids "imageDigest=$digest" --query 'images[0].imageManifest' --output text)"
  media="$($AWS ecr batch-get-image --repository-name "$repo" --image-ids "imageDigest=$digest" --query 'images[0].imageManifestMediaType' --output text)"
  out="$($AWS ecr put-image --repository-name "$repo" --image-tag "$RELEASE" --image-manifest "$manifest" \
    --image-manifest-media-type "$media" --query 'image.imageId.imageDigest' --output text)" \
    || die "could not move $repo:$RELEASE to $digest"
  [ "$out" = "$digest" ] || die "$repo:$RELEASE moved to $out, expected $digest"
  log "$repo:$RELEASE → $digest"
}

push_images

# ── Demo host ─────────────────────────────────────────────────────────────────────────────────────────────────
if [ "$RUNTIME" = "single_host" ]; then
  instance="$(cfg .instance_id)"
  document="$(cfg .document)"
  log "sending '$document' (portico deploy $TAG) to $instance"
  cmd_id="$($AWS ssm send-command --instance-ids "$instance" --document-name "$document" \
    --comment "portico deploy $TAG" --parameters "tag=$TAG,baseUrl=$BASE_URL" \
    --query Command.CommandId --output text)"
  status=Pending
  for _ in $(seq 1 120); do
    status="$($AWS ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in Success | Failed | Cancelled | TimedOut) break ;; esac
    sleep "${POLL_SLEEP:-10}"
  done
  [ "$status" = "Success" ] || die "host deploy ended '$status' (the host rolls itself back on failed readiness; see the 'deploy' log stream)"
  smoke_test || die "smoke test failed after the host reported success — run 'portico status' via Session Manager"
  publish_web
  log "deployed $TAG to the demo host"
  exit 0
fi
[ "$RUNTIME" = "fargate" ] || die "unknown runtime '$RUNTIME' in deploy-config"

# ── Fargate cell ──────────────────────────────────────────────────────────────────────────────────────────────
CLUSTER="$(cfg .cluster)"
primary() { # <service> <field>
  $AWS ecs describe-services --cluster "$CLUSTER" --services "$1" --query "services[0].deployments[?status=='PRIMARY'] | [0].$2" --output text
}
force_deploy() { # <service> → new PRIMARY deployment id
  $AWS ecs update-service --cluster "$CLUSTER" --service "$1" --force-new-deployment --query 'service.serviceName' --output text >/dev/null
  primary "$1" id
}
rolled_out() { # <service> <deployment-id>
  $AWS ecs wait services-stable --cluster "$CLUSTER" --services "$1" || true
  [ "$(primary "$1" id)" = "$2" ] && [ "$(primary "$1" rolloutState)" = "COMPLETED" ]
}

declare -A PREV NEW
for name in $(cfg '.repositories | keys[]'); do
  repo="$(repo_name "$name")"
  PREV[$name]="$(digest_of "$repo" "$RELEASE")"
  NEW[$name]="$(digest_of "$repo" "$TAG")"
  [ -n "${NEW[$name]}" ] || die "$repo:$TAG does not exist — push the release first (--push-oci)"
done
log "release now: api=${PREV[api]:-none} worker=${PREV[worker]:-none}; new: api=${NEW[api]} worker=${NEW[worker]}"

rollback() {
  log "ROLLING BACK: release tags to the recorded digests, both services redeployed (database stays migrated: expand/contract)"
  local name
  for name in "${!PREV[@]}"; do
    if [ -n "${PREV[$name]}" ]; then move_release "$(repo_name "$name")" "${PREV[$name]}"; fi
  done
  if [ -n "${PREV[api]}" ]; then
    force_deploy "$(cfg .services.api)" >/dev/null
    force_deploy "$(cfg .services.worker)" >/dev/null
    $AWS ecs wait services-stable --cluster "$CLUSTER" --services "$(cfg .services.api)" "$(cfg .services.worker)" || true
  fi
}

# 1. api (its init containers run the migrations and the routing grants before the new api starts)
move_release "$(repo_name api)" "${NEW[api]}"
api_dep="$(force_deploy "$(cfg .services.api)")"
log "api deployment $api_dep started (init containers: migrate, grants)"
if ! rolled_out "$(cfg .services.api)" "$api_dep"; then
  rollback
  die "api deployment did not complete (migration, grants or health check failed: see $(cfg '.log_groups.migrate') and $(cfg '.log_groups.api')). Previous release restored."
fi

# 2. worker, then the drill image tag
move_release "$(repo_name worker)" "${NEW[worker]}"
worker_dep="$(force_deploy "$(cfg .services.worker)")"
if ! rolled_out "$(cfg .services.worker)" "$worker_dep"; then
  rollback
  die "worker deployment did not complete. Previous release restored."
fi
if [ -n "${NEW[restore-drill]:-}" ]; then move_release "$(repo_name restore-drill)" "${NEW[restore-drill]}"; fi

# 3. smoke test through the public path
if ! smoke_test; then
  rollback
  die "smoke test failed. Previous release restored; investigate before re-deploying (docs/runbooks/rollback.md)."
fi

# 4. web app last: the API it calls is already live and backward compatible
publish_web
log "deployed $TAG"
