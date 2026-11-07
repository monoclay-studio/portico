# syntax=docker/dockerfile:1.10
#
# Portico API image. Also runs the one-off MIGRATION task and the DB ROLE BOOTSTRAP task (same image, different
# command — see infra/terraform/modules/compute). Build from the repository root:
#
#   docker build -f apps/api/Dockerfile -t portico-api:$(git rev-parse --short HEAD) .
#
# STATUS: written and reviewed, NOT built — no Docker daemon was available when this was authored. The runtime
# layout (pnpm deploy output + tsx loader, migrations as a non-superuser owner, API as an app login role) was
# exercised outside Docker against Postgres 16; see infra/README.md "Validation status".
#
# Why tsx at runtime (not an esbuild bundle): workspace packages export TypeScript sources with extensionless
# imports, and every module manifest resolves its migrations directory relative to its own source file
# (import.meta.url). Bundling collapses those paths into one file and breaks migration discovery. tsx keeps the
# source layout intact. Follow-up for the app team: a real build step (see infra/README.md, "Findings").
#
# Why no HEALTHCHECK: ECS ignores the Dockerfile HEALTHCHECK instruction. Liveness/readiness comes from the ALB
# target-group check on /health/ready (DB ping) plus the ECS deployment circuit breaker, which is what decides
# rollback. A Docker HEALTHCHECK would also need curl/wget in the image (larger attack surface) for no benefit.

# Pin by digest before the first real build: docker buildx imagetools inspect node:22.23.4-slim
ARG NODE_IMAGE=node:22.23.4-slim

# ── base: Node + pnpm (build stages only) ─────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV CI=true PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# Keep in sync with "packageManager" in the root package.json.
RUN npm install --global --no-audit --no-fund pnpm@10.28.0
WORKDIR /repo

# ── deps: fetch the whole lockfile into the store (cached layer; only invalidated by lockfile changes) ────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# The store lives in this layer (not a cache mount): a cached layer with an evicted cache mount would make the
# offline install below fail.
RUN pnpm fetch --store-dir /pnpm/store

# ── build: offline install, then a production-only deploy of @portico/api with its workspace dependencies ────
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --store-dir /pnpm/store \
 && pnpm --filter=@portico/api --prod --legacy --offline --store-dir /pnpm/store deploy /out \
 && rm -rf /out/test /out/vitest.config.ts

# ── tsx: TypeScript loader installed from a committed npm lockfile (integrity-checked, no ranges) ─────────────
FROM ${NODE_IMAGE} AS tsx
WORKDIR /opt/tsx
COPY infra/docker/tsx-runtime/package.json infra/docker/tsx-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && printf "import 'tsx';\n" > register.mjs

# ── runtime ───────────────────────────────────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="portico-api" \
      org.opencontainers.image.vendor="Monoclay LLC" \
      org.opencontainers.image.revision="${GIT_SHA}"

# Amazon RDS CA bundle so node-postgres can use sslmode=verify-full against Aurora. The checksum pins the bundle
# as fetched on 2026-11-07; when AWS publishes a new bundle the build fails loudly — update the hash after review.
ADD --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    PORT=4000 \
    PORTICO_GIT_SHA=${GIT_SHA}

WORKDIR /app
# Everything is owned by root and only readable by the runtime user: the process cannot modify its own code.
COPY --from=tsx /opt/tsx /opt/tsx
COPY --from=build /out /app
COPY infra/db/bootstrap-roles.mjs /app/ops/bootstrap-roles.mjs
RUN chmod -R a-w /app /opt/tsx

# Read-only root filesystem friendly: the only write path is /tmp (tsx transform cache), which ECS mounts as an
# ephemeral volume. Nothing else writes to disk; logs go to stdout.
USER 1000:1000
EXPOSE 4000
STOPSIGNAL SIGTERM

# Exec form: node is the process that receives SIGTERM (ECS initProcessEnabled adds an init for zombie reaping).
#   migrations:      ["node", "--import", "/opt/tsx/register.mjs", "src/migrate-cli.ts"]
#   role bootstrap:  ["node", "/app/ops/bootstrap-roles.mjs"]
CMD ["node", "--import", "/opt/tsx/register.mjs", "src/main.ts"]
