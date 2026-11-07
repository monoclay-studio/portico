#!/usr/bin/env bash
# Deploy one image tag to one Portico cell. Called by infra/ci/deploy.yml.example with AWS credentials from GitHub
# OIDC (the cell's ci-deploy-role); also usable by a human with the same role. docs/runbooks/deploy.md explains every
# step and docs/runbooks/rollback.md what to do when this script stops.
#
#   infra/ci/deploy-cell.sh <cell-name-prefix> <image-tag> [--push-oci <dir>] [--bootstrap-roles] [--web-dist <dir>]
#     cell-name-prefix  e.g. portico-prod-aps1-c01 (the deploy-config parameter is /portico/<prefix>/deploy-config)
#     image-tag         git SHA; the cell's ECR repositories use immutable tags
#     --push-oci        directory with api.oci.tar and worker.oci.tar built ONCE by the pipeline: pushed to this cell
#                       with their digests preserved, so staging and production run byte-identical images
#     --bootstrap-roles first deploy and after every DB credential rotation: run the role bootstrap task first
#     --web-dist        built staff web app (apps/backoffice/dist) to publish after the API is healthy
#
# Every cell first: [--push-oci] push the images; an existing tag is accepted only when its digest is identical.
# Fargate cells, in order (each step must succeed before the next starts):
#   1. register new revisions of the api, worker, migrate and db-bootstrap task definitions with the new image
#   2. [--bootstrap-roles] run db-bootstrap (RDS master → roles match Secrets Manager)
#   3. run migrations (portico_owner; expand/contract only, so the PREVIOUS app version keeps working)
#   4. run the routing grants (same task, `grants` command): job-routing functions → portico_worker only
#   5. roll the worker, then the api (ECS circuit breaker + 5xx/no-healthy-target alarms roll back automatically)
#   6. smoke test through the public URL (CloudFront → WAF → ALB → api); on failure roll BOTH services back to the
#      revisions recorded in step 0 and exit non-zero. The database is never rolled back (docs/runbooks/rollback.md)
#   7. publish the web app (immutable assets first, index.html last) and invalidate index.html
# Demo cells (single host): SSM Run Command `portico deploy <tag> <base-url>` (the host gates on readiness and
# rolls itself back), then the same smoke test and web publish.
#
# Environment: AWS_REGION (or the deploy-config region), optional SMOKE_RETRIES (default 30), AWS_CLI / SKOPEO
# (default aws / skopeo; the offline tests point them at stubs). Requires bash, jq, curl, aws CLI v2, skopeo.
set -euo pipefail

PREFIX="${1:?usage: deploy-cell.sh <cell-name-prefix> <image-tag> [--bootstrap-roles] [--web-dist <dir>]}"
TAG="${2:?image tag (git SHA) required}"
shift 2
BOOTSTRAP=false
WEB_DIST=""
PUSH_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bootstrap-roles) BOOTSTRAP=true ;;
    --web-dist) WEB_DIST="${2:?--web-dist needs a directory}"; shift ;;
    --push-oci) PUSH_DIR="${2:?--push-oci needs a directory}"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done
[[ "$TAG" =~ ^[0-9a-f]{7,40}$ ]] || { echo "image tag must be a git SHA (immutable tags), got '$TAG'" >&2; exit 2; }

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

smoke_test() {
  local i code body
  for ((i = 1; i <= SMOKE_RETRIES; i++)); do
    body="$(curl -sS --max-time 10 "$BASE_URL/health/ready" 2>/dev/null || true)"
    if [[ "$body" == *'"ready"'* ]]; then
      # An unauthenticated API call must be refused by the API itself (problem+json 401): proves the whole path
      # CloudFront → WAF → ALB/host → api routes /v1, not just that something answers.
      code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/v1/me" 2>/dev/null || true)"
      if [ "$code" = "401" ]; then log "smoke test passed (ready; /v1/me → 401)"; return 0; fi
      log "smoke: /v1/me answered $code, expected 401 (attempt $i)"
    else
      log "smoke: /health/ready not ready yet (attempt $i)"
    fi
    sleep 10
  done
  return 1
}

publish_web() {
  [ -n "$WEB_DIST" ] || { log "no --web-dist: web app not published"; return 0; }
  [ -f "$WEB_DIST/index.html" ] || die "$WEB_DIST/index.html missing (build apps/backoffice first)"
  local bucket dist
  bucket="$(cfg .web.bucket)"
  dist="$(cfg .web.distribution_id)"
  # Hashed assets first (immutable), index.html last, so a browser never loads an index that points at missing files.
  $AWS s3 sync "$WEB_DIST" "s3://$bucket/" --exclude index.html --cache-control "public,max-age=31536000,immutable" --only-show-errors
  $AWS s3 cp "$WEB_DIST/index.html" "s3://$bucket/index.html" --cache-control "no-cache" --only-show-errors
  $AWS cloudfront create-invalidation --distribution-id "$dist" --paths /index.html / >/dev/null
  log "web app published to s3://$bucket (index.html invalidated)"
}

push_images() {
  [ -n "$PUSH_DIR" ] || return 0
  local name url registry repo built existing
  for name in api worker; do
    url="$(cfg ".repositories.$name")"
    registry="${url%%/*}"
    repo="${url#*/}"
    [ -f "$PUSH_DIR/$name.oci.tar" ] || die "$PUSH_DIR/$name.oci.tar missing"
    built="$($SKOPEO inspect --format '{{.Digest}}' "oci-archive:$PUSH_DIR/$name.oci.tar")"
    existing="$($AWS ecr describe-images --repository-name "$repo" --image-ids "imageTag=$TAG" \
      --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
    if [ -n "$existing" ] && [ "$existing" != "None" ]; then
      [ "$existing" = "$built" ] || die "$repo:$TAG already exists with digest $existing, not $built — tags are immutable; investigate"
      log "$repo:$TAG already present with the same digest"
      continue
    fi
    # Credentials through stdin into skopeo's auth file, never on a command line.
    $AWS ecr get-login-password | $SKOPEO login --username AWS --password-stdin "$registry" >/dev/null
    $SKOPEO copy --preserve-digests "oci-archive:$PUSH_DIR/$name.oci.tar" "docker://$url:$TAG" >/dev/null
    existing="$($AWS ecr describe-images --repository-name "$repo" --image-ids "imageTag=$TAG" --query 'imageDetails[0].imageDigest' --output text)"
    [ "$existing" = "$built" ] || die "$repo:$TAG pushed with digest $existing, expected $built"
    log "pushed $repo:$TAG ($built)"
  done
}
push_images

# ── Demo host ─────────────────────────────────────────────────────────────────────────────────────────────────
if [ "$RUNTIME" = "single_host" ]; then
  instance="$(cfg .instance_id)"
  log "sending 'portico deploy $TAG' to $instance"
  cmd_id="$($AWS ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript \
    --comment "portico deploy $TAG" --parameters "commands=[\"/usr/local/sbin/portico deploy $TAG $BASE_URL\"]" \
    --query Command.CommandId --output text)"
  status=Pending
  for _ in $(seq 1 120); do
    status="$($AWS ssm get-command-invocation --command-id "$cmd_id" --instance-id "$instance" --query Status --output text 2>/dev/null || echo Pending)"
    case "$status" in Success | Failed | Cancelled | TimedOut) break ;; esac
    sleep 10
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
NETWORK="awsvpcConfiguration={subnets=[$(cfg '.ops_subnets | join(",")')],securityGroups=[$(cfg .ops_security)],assignPublicIp=$([ "$(cfg .assign_public_ip)" = true ] && echo ENABLED || echo DISABLED)}"

current_td() { $AWS ecs describe-services --cluster "$CLUSTER" --services "$1" --query 'services[0].taskDefinition' --output text; }

# Register a new revision of <family> from its latest revision, swapping only the image tag of every container.
register() { # <family> <repository-url>
  local family="$1" repo="$2" td
  td="$($AWS ecs describe-task-definition --task-definition "$family" --query taskDefinition --output json)"
  jq --arg img "$repo:$TAG" '
      .containerDefinitions |= map(.image = $img)
      | del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy, .deregisteredAt)' \
    <<<"$td" >"$WORK/$family.json"
  $AWS ecs register-task-definition --cli-input-json "file://$WORK/$family.json" --query taskDefinition.taskDefinitionArn --output text
}

# Run a one-off task to completion; succeed only on exit code 0 of its essential container.
run_once() { # <label> <task-definition-arn> [overrides-json]
  local label="$1" td="$2" overrides="${3:-}" task exit_code reason
  local args=(ecs run-task --cluster "$CLUSTER" --launch-type FARGATE --task-definition "$td" --network-configuration "$NETWORK"
    --started-by "deploy-$TAG" --query 'tasks[0].taskArn' --output text)
  [ -n "$overrides" ] && args+=(--overrides "$overrides")
  task="$($AWS "${args[@]}")" || die "$label: run-task refused"
  [ -n "$task" ] && [ "$task" != "None" ] || die "$label: no task started (capacity or configuration)"
  log "$label: running $task"
  $AWS ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$task" || die "$label: did not stop in time ($task)"
  exit_code="$($AWS ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].containers[0].exitCode' --output text)"
  reason="$($AWS ecs describe-tasks --cluster "$CLUSTER" --tasks "$task" --query 'tasks[0].stoppedReason' --output text)"
  [ "$exit_code" = "0" ] || die "$label: exit code '$exit_code' ($reason). Logs: $(cfg '.log_groups.migrate')"
  log "$label: succeeded"
}

roll() { # <service> <task-definition-arn>
  $AWS ecs update-service --cluster "$CLUSTER" --service "$1" --task-definition "$2" --query 'service.serviceName' --output text >/dev/null
}

rolled_out() { # <service> <expected-task-definition-arn> → 0 when the PRIMARY deployment completed on that revision
  local primary state
  primary="$($AWS ecs describe-services --cluster "$CLUSTER" --services "$1" --query "services[0].deployments[?status=='PRIMARY'] | [0].taskDefinition" --output text)"
  state="$($AWS ecs describe-services --cluster "$CLUSTER" --services "$1" --query "services[0].deployments[?status=='PRIMARY'] | [0].rolloutState" --output text)"
  [ "$primary" = "$2" ] && [ "$state" = "COMPLETED" ]
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# 0. Remember what runs now (rollback target).
PREV_API="$(current_td "$(cfg .services.api)")"
PREV_WORKER="$(current_td "$(cfg .services.worker)")"
log "currently running: api=$PREV_API worker=$PREV_WORKER"

# 1. New task-definition revisions.
API_TD="$(register "$(cfg .task_families.api)" "$(cfg .repositories.api)")"
WORKER_TD="$(register "$(cfg .task_families.worker)" "$(cfg .repositories.worker)")"
MIGRATE_TD="$(register "$(cfg .task_families.migrate)" "$(cfg .repositories.api)")"
BOOTSTRAP_TD="$(register "$(cfg .task_families.db_bootstrap)" "$(cfg .repositories.api)")"
log "registered api=$API_TD worker=$WORKER_TD migrate=$MIGRATE_TD"

# 2–4. Database: roles (optional), migrations, routing grants. Nothing user-facing has changed yet.
if $BOOTSTRAP; then run_once "db-bootstrap" "$BOOTSTRAP_TD"; fi
run_once "migrate" "$MIGRATE_TD"
run_once "routing-grants" "$MIGRATE_TD" \
  "$(jq -cn --argjson cmd "$(cfg '.grants_command')" '{containerOverrides: [{name: "migrate", command: $cmd}]}')"

# 5. Services: worker first (it only consumes), then the api.
roll "$(cfg .services.worker)" "$WORKER_TD"
roll "$(cfg .services.api)" "$API_TD"
log "waiting for both services to become stable (ECS rolls back automatically on failed health checks or alarms)"
$AWS ecs wait services-stable --cluster "$CLUSTER" --services "$(cfg .services.worker)" "$(cfg .services.api)" || true

rollback() {
  log "ROLLING BACK both services to api=$PREV_API worker=$PREV_WORKER (database stays migrated: expand/contract)"
  roll "$(cfg .services.api)" "$PREV_API"
  roll "$(cfg .services.worker)" "$PREV_WORKER"
  $AWS ecs wait services-stable --cluster "$CLUSTER" --services "$(cfg .services.worker)" "$(cfg .services.api)" || true
}

if ! rolled_out "$(cfg .services.api)" "$API_TD" || ! rolled_out "$(cfg .services.worker)" "$WORKER_TD"; then
  # ECS may already have rolled the failing service back; make sure BOTH are on the previous pair.
  rollback
  die "new revisions did not complete their rollout (circuit breaker or alarm). Previous revisions restored."
fi

# 6. Smoke test through the public path.
if ! smoke_test; then
  rollback
  die "smoke test failed. Previous revisions restored; investigate before re-deploying (docs/runbooks/rollback.md)."
fi

# 7. Web app last: the API it calls is already live and backward compatible.
publish_web
log "deployed $TAG"
