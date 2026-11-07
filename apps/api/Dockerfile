# syntax=docker/dockerfile:1.10
#
# Portico API image. Also runs the one-off MIGRATION task, the DB ROLE BOOTSTRAP task and the ROUTING GRANTS step
# (same image, different command — see infra/terraform/modules/compute). Build from the repository root:
#
#   docker build -f apps/api/Dockerfile -t portico-api:$(git rev-parse --short HEAD) .
#
# STATUS: written and reviewed, NOT built — no Docker daemon was available when this was authored. The runtime
# layout (pnpm deploy output + tsx loader, read-only files, no writable TMPDIR; migrations as a non-superuser owner,
# API as portico_app_blue, worker as portico_worker_blue) is exercised outside Docker by infra/db/verify-roles.sh
# against a SCRAM-auth Postgres 16; see infra/README.md "Validation status".
#
# Why tsx at runtime (not an esbuild bundle): workspace packages export TypeScript sources with extensionless
# imports, and every module manifest resolves its migrations directory relative to its own source file
# (import.meta.url). Bundling collapses those paths into one file and breaks migration discovery. tsx keeps the
# source layout intact. Follow-up for the app team: a real build step (see infra/README.md, "Requests to other modules").
#
# Why no HEALTHCHECK: ECS ignores the Dockerfile HEALTHCHECK instruction. Liveness/readiness comes from the ALB
# target-group check on /health/ready (DB ping) plus the ECS deployment circuit breaker, which is what decides
# rollback. A Docker HEALTHCHECK would also need curl/wget in the image (larger attack surface) for no benefit.

# Pinned by index digest (resolved 2026-11-07 from Docker Hub). Dependabot (docker ecosystem) proposes updates; a
# frozen digest stops receiving fixes, so those PRs are mandatory reading.
ARG NODE_IMAGE=node:22.23.4-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d

# ── base: Node + pnpm (build stages only) ─────────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS base
ENV CI=true PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# pnpm through corepack with the tarball's sha512 (npm registry integrity, 2026-11-07): corepack refuses a mismatch.
# Keep the version in sync with "packageManager" in the root package.json.
RUN corepack enable && corepack install --global pnpm@10.28.0+sha512.05df71d1421f21399e053fde567cea34d446fa02c76571441bfc1c7956e98e363088982d940465fd34480d4d90a0668bc12362f8aa88000a64e83d0b0e47be48
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

# Amazon RDS CA bundle so node-postgres can use sslmode=verify-full against Aurora (0644: a URL ADD defaults to
# 0600, which the non-root user could not read and Node would then skip silently). The checksum pins the bundle
# as fetched on 2026-11-07; when AWS publishes a new bundle the build fails loudly — update the hash after review.
ADD --chmod=0644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    TSX_DISABLE_CACHE=1 \
    PORT=4000 \
    PORTICO_GIT_SHA=${GIT_SHA}

WORKDIR /app
# Everything is owned by root and only readable by the runtime user: the process cannot modify its own code.
COPY --from=tsx /opt/tsx /opt/tsx
COPY --from=build /out /app
COPY infra/db/bootstrap-roles.mjs infra/db/definer-registry.mjs infra/ops/env-guard.mjs /app/ops/
# No package managers at runtime (smaller attack surface; review P3-8). Then make everything read-only.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && chmod -R a-w /app /opt/tsx

# Read-only root filesystem: TSX_DISABLE_CACHE=1 stops tsx writing its transform cache to /tmp, so the process
# writes nothing to disk (verified outside Docker with no writable TMPDIR). Logs go to stdout.
USER 1000:1000
EXPOSE 4000
STOPSIGNAL SIGTERM

# Exec form: node is the process that receives SIGTERM (ECS initProcessEnabled adds an init for zombie reaping).
# Every command starts behind the env guard (infra/ops/env-guard.mjs): PORTICO_DEPLOYMENT must be set, live keys are
# refused outside production, app keys are mandatory for api/worker. Task definitions (Terraform) set:
#   api:             [node --import /app/ops/env-guard.mjs --import /opt/tsx/register.mjs src/main.ts]
#   migrate (init):  [… src/migrate-cli.ts]
#   grants (init):   [node --import /app/ops/env-guard.mjs /app/ops/bootstrap-roles.mjs grants]
#   role bootstrap:  [node --import /app/ops/env-guard.mjs /app/ops/bootstrap-roles.mjs]   (humans only, RDS master)
CMD ["node", "--import", "/app/ops/env-guard.mjs", "--import", "/opt/tsx/register.mjs", "src/main.ts"]
