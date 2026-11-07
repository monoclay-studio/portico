# syntax=docker/dockerfile:1.10
#
# Portico worker image (outbox fan-out and delivery; later schedulers and connector sync). Build from the root:
#
#   docker build -f apps/worker/Dockerfile -t portico-worker:$(git rev-parse --short HEAD) .
#
# STATUS: written and reviewed, NOT built — no Docker daemon was available when this was authored. The same
# deploy + tsx runtime layout is exercised outside Docker by infra/db/verify-roles.sh (the worker runs every job as
# portico_worker_blue); see infra/README.md "Validation status".
#
# Why tsx at runtime and why no HEALTHCHECK: see apps/api/Dockerfile. The worker has no HTTP port; ECS restarts
# it if the process exits, and stalls are caught by the outbox backlog / worker-error alarms (observability
# module). A container-level liveness check needs a heartbeat from the worker first (infra/README.md, Findings).

ARG NODE_IMAGE=node:22.23.4-slim

FROM ${NODE_IMAGE} AS base
ENV CI=true PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN npm install --global --no-audit --no-fund pnpm@10.28.0
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# The store lives in this layer (not a cache mount): a cached layer with an evicted cache mount would make the
# offline install below fail.
RUN pnpm fetch --store-dir /pnpm/store

FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline --store-dir /pnpm/store \
 && pnpm --filter=@portico/worker --prod --legacy --offline --store-dir /pnpm/store deploy /out

FROM ${NODE_IMAGE} AS tsx
WORKDIR /opt/tsx
COPY infra/docker/tsx-runtime/package.json infra/docker/tsx-runtime/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && printf "import 'tsx';\n" > register.mjs

FROM ${NODE_IMAGE} AS runtime
ARG GIT_SHA=unknown
LABEL org.opencontainers.image.title="portico-worker" \
      org.opencontainers.image.vendor="Monoclay LLC" \
      org.opencontainers.image.revision="${GIT_SHA}"

ADD --chmod=0644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem \
    TSX_DISABLE_CACHE=1 \
    PORTICO_GIT_SHA=${GIT_SHA}

WORKDIR /app
COPY --from=tsx /opt/tsx /opt/tsx
COPY --from=build /out /app
RUN chmod -R a-w /app /opt/tsx

# Read-only root filesystem: nothing is written to disk (TSX_DISABLE_CACHE=1); logs go to stdout.
USER 1000:1000
STOPSIGNAL SIGTERM
CMD ["node", "--import", "/opt/tsx/register.mjs", "src/main.ts"]
