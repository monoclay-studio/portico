#!/bin/bash
# Portico demo host control script (tier "demo": api + worker + Postgres on one instance).
#
#   portico.sh deploy <image-tag> [app-base-url]
#                                   pull images, bootstrap DB roles, migrate, grant job-routing functions to the
#                                   worker role, seed (first time), replace api/worker, health-gate, roll back to the
#                                   previous tag if /health/ready fails. app-base-url: the CloudFront URL when the
#                                   demo has no custom domain (links in staff invitations / password resets)
#   portico.sh status               containers, current tag, readiness
#   portico.sh reseed               wipe the demo database and seed it again (demo data only — never real data)
#
# Invoked by cloud-init on first boot and by the deploy pipeline through SSM Run Command. Runs as root.
# Database credentials are generated on this host at first boot (/opt/portico/secrets.env, 0600) and never leave
# it, and so are the application keys (field encryption, blind index, terms seal, payment-simulator signing). The
# same role model as AWS-managed tiers applies: the API connects as portico_app_blue and the worker as
# portico_worker_blue (RLS enforced for both), never as a superuser; migrations run as portico_owner.
set -euo pipefail

source /opt/portico/portico.env
source /opt/portico/secrets.env

CMD="${1:-}"
TAG="${2:-}"
APP_BASE_URL="${3:-${APP_BASE_URL:-}}"
NET=portico
REGISTRY="${API_REPO%%/*}"
STATE=/var/lib/portico
RUN=/opt/portico/run
HARDENING=(--read-only --cap-drop ALL --security-opt no-new-privileges --user 1000:1000)

log() { echo "$(date -u +%FT%TZ) portico: $*"; }

logs_for() {
  echo --log-driver awslogs --log-opt "awslogs-region=$REGION" --log-opt "awslogs-group=$LOG_GROUP" \
    --log-opt "awslogs-stream=$1" --log-opt mode=non-blocking
}

app_url() { echo "postgres://portico_app_blue:${APP_BLUE_PASSWORD}@portico-postgres:5432/portico?sslmode=disable"; }
worker_url() { echo "postgres://portico_worker_blue:${WORKER_BLUE_PASSWORD}@portico-postgres:5432/portico?sslmode=disable"; }
owner_url() { echo "postgres://portico_owner:${OWNER_PASSWORD}@portico-postgres:5432/portico?sslmode=disable"; }

write_env_files() {
  install -d -m 0700 "$RUN"
  umask 077
  cat > "$RUN/bootstrap.env" <<EOF
PGHOST=portico-postgres
PGDATABASE=portico
PGSSLMODE=disable
MASTER_USERNAME=postgres
MASTER_PASSWORD=${PG_SUPERUSER_PASSWORD}
OWNER_SECRET_JSON={"username":"portico_owner","password":"${OWNER_PASSWORD}"}
APP_SECRET_JSON={"username":"portico_app_blue","password":"${APP_BLUE_PASSWORD}","standby_username":"portico_app_green","standby_password":"${APP_GREEN_PASSWORD}"}
WORKER_SECRET_JSON={"username":"portico_worker_blue","password":"${WORKER_BLUE_PASSWORD}","standby_username":"portico_worker_green","standby_password":"${WORKER_GREEN_PASSWORD}"}
EOF
  cat > "$RUN/migrate.env" <<EOF
NODE_ENV=production
DATABASE_URL=$(owner_url)
EOF
  # Settings and keys both processes need (both run the full composition root).
  local common
  common="NODE_ENV=production
LOG_LEVEL=info
PORTICO_DEPLOYMENT=demo
PORTICO_CELL=${CELL}
PORTICO_FIELD_KEY_ID=${CELL}-field-v1
PORTICO_FIELD_KEY=${PORTICO_FIELD_KEY}
PORTICO_BLIND_INDEX_KEY=${PORTICO_BLIND_INDEX_KEY}
PORTICO_TERMS_SEAL_KEY=${PORTICO_TERMS_SEAL_KEY}
PAYMENTS_SIMULATOR_SIGNING_SECRET=${PAYMENTS_SIMULATOR_SIGNING_SECRET}"
  if [ -n "$APP_BASE_URL" ]; then
    common="$common
PORTICO_APP_BASE_URL=${APP_BASE_URL}"
  fi
  cat > "$RUN/app.env" <<EOF
$common
PORT=${APP_PORT}
CORS_ORIGINS=${CORS_ORIGINS}
TRUSTED_PROXY_CIDRS=${TRUSTED_PROXY_CIDRS}
APP_DATABASE_URL=$(app_url)
EOF
  cat > "$RUN/worker.env" <<EOF
$common
APP_DATABASE_URL=$(worker_url)
EOF
}

ensure_network() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
}

ensure_postgres() {
  if ! docker inspect portico-postgres >/dev/null 2>&1; then
    log "starting postgres ($POSTGRES_IMAGE)"
    install -d -m 0700 "$STATE/pg"
    # shellcheck disable=SC2046
    docker run -d --name portico-postgres --network "$NET" --restart unless-stopped \
      -e POSTGRES_PASSWORD="$PG_SUPERUSER_PASSWORD" -e POSTGRES_DB=portico \
      -v "$STATE/pg:/var/lib/postgresql/data" --shm-size 256m \
      $(logs_for postgres) \
      "$POSTGRES_IMAGE" -c max_connections=100 -c shared_buffers=256MB -c log_statement=ddl >/dev/null
  fi
  for _ in $(seq 1 60); do
    docker exec portico-postgres pg_isready -U postgres -d portico >/dev/null 2>&1 && return 0
    sleep 2
  done
  log "postgres did not become ready"; exit 1
}

one_off() { # <name> <env-file> <image> <command...>
  local name="$1" envf="$2" image="$3"; shift 3
  # shellcheck disable=SC2046
  docker run --rm --name "portico-$name" --network "$NET" "${HARDENING[@]}" --env-file "$envf" \
    $(logs_for "$name") "$image" "$@"
}

start_services() { # <tag>
  local tag="$1"
  docker rm -f portico-api portico-worker >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  docker run -d --name portico-api --network "$NET" --restart unless-stopped "${HARDENING[@]}" \
    --env-file "$RUN/app.env" -p "${APP_PORT}:${APP_PORT}" $(logs_for api) "$API_REPO:$tag" >/dev/null
  # shellcheck disable=SC2046
  docker run -d --name portico-worker --network "$NET" --restart unless-stopped "${HARDENING[@]}" \
    --env-file "$RUN/worker.env" $(logs_for worker) "$WORKER_REPO:$tag" >/dev/null
}

ready() {
  for _ in $(seq 1 45); do
    curl -fsS "http://127.0.0.1:${APP_PORT}/health/ready" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

deploy() {
  [ -n "$TAG" ] || { echo "usage: portico.sh deploy <image-tag>"; exit 2; }
  log "deploying $TAG"
  aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY" >/dev/null
  docker pull -q "$API_REPO:$TAG" >/dev/null
  docker pull -q "$WORKER_REPO:$TAG" >/dev/null
  ensure_network
  ensure_postgres
  write_env_files

  one_off db-bootstrap "$RUN/bootstrap.env" "$API_REPO:$TAG" node /app/ops/bootstrap-roles.mjs
  one_off migrate "$RUN/migrate.env" "$API_REPO:$TAG" node --import /opt/tsx/register.mjs src/migrate-cli.ts
  one_off db-grants "$RUN/migrate.env" "$API_REPO:$TAG" node /app/ops/bootstrap-roles.mjs grants
  if [ "$SEED_DEMO" = "true" ] && [ ! -f "$STATE/seeded" ]; then
    one_off seed "$RUN/app.env" "$API_REPO:$TAG" node --import /opt/tsx/register.mjs src/seed/demo-cli.ts
    touch "$STATE/seeded"
  fi

  local previous=""
  [ -f "$STATE/current-tag" ] && previous="$(cat "$STATE/current-tag")"
  start_services "$TAG"
  if ready; then
    echo "$TAG" > "$STATE/current-tag"
    log "deployed $TAG (previous: ${previous:-none})"
  else
    log "readiness failed for $TAG"
    if [ -n "$previous" ]; then
      log "rolling back to $previous (migrations are expand/contract, so the previous app runs on the new schema)"
      start_services "$previous"
      ready && log "rollback to $previous healthy" || log "ROLLBACK ALSO UNHEALTHY — investigate"
    fi
    exit 1
  fi
}

status() {
  docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
  echo "current tag: $(cat "$STATE/current-tag" 2>/dev/null || echo none)"
  curl -fsS "http://127.0.0.1:${APP_PORT}/health/ready" && echo
}

reseed() {
  [ -f "$STATE/current-tag" ] || { echo "nothing deployed yet"; exit 1; }
  local tag; tag="$(cat "$STATE/current-tag")"
  log "reseeding demo data with $tag"
  docker rm -f portico-api portico-worker portico-postgres >/dev/null 2>&1 || true
  rm -rf "$STATE/pg" "$STATE/seeded"
  TAG="$tag" deploy
}

case "$CMD" in
  deploy) deploy ;;
  status) status ;;
  reseed) reseed ;;
  *) echo "usage: portico.sh deploy <tag> [app-base-url] | status | reseed"; exit 2 ;;
esac
