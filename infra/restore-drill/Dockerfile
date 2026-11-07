# syntax=docker/dockerfile:1.10
# Restore-drill runner: AWS CLI v2 + psql 16 + jq. Build from the repository root:
#   docker build -f infra/restore-drill/Dockerfile -t portico-restore-drill:$(git rev-parse --short HEAD) .
# STATUS: written and reviewed, NOT built (no Docker daemon available when authored). The package names below are
# the Amazon Linux 2023 names as understood on 2026-11-07 — verify on first build.
ARG BASE_IMAGE=public.ecr.aws/amazonlinux/amazonlinux:2023
FROM ${BASE_IMAGE}
RUN dnf install -y awscli-2 postgresql16 jq openssl findutils \
 && dnf clean all && rm -rf /var/cache/dnf
ADD --chmod=0644 --checksum=sha256:90a6f1a7978a1b1b096dca6c57511ca48d3b8cf052f8e704baf358f34ea2f21b \
    https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --chmod=0755 infra/restore-drill/restore-drill.sh /drill/restore-drill.sh
COPY --chmod=0644 infra/restore-drill/verify.sql /drill/verify.sql
USER 1000:1000
ENV HOME=/tmp
ENTRYPOINT ["/drill/restore-drill.sh"]
