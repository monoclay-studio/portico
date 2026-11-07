# Portico infrastructure (AWS)

## Checkpoint

**Status (2026-11-07): code written, NOTHING deployed.** No AWS credentials exist and the owner has not authorized
spend (OPEN_QUESTIONS Q4/Q22).

**Done**
- `apps/api/Dockerfile`, `apps/worker/Dockerfile`, root `.dockerignore` — multi-stage, `pnpm deploy --prod`, non-root,
  read-only root filesystem, RDS CA bundle pinned by checksum, lockfile-pinned tsx runtime loader
  (`infra/docker/tsx-runtime`). Not built (no Docker daemon); the runtime layout was exercised outside Docker.
- `infra/db/bootstrap-roles.mjs` — creates `portico_owner` (migrations), `portico_app` group + `portico_app_blue/green`
  login roles (zero-downtime rotation), SCRAM verifiers (no plaintext in DB logs), refuses privileged roles.
  Verified against a SCRAM-auth Postgres 16: bootstrap → migrations as non-superuser owner → API/worker as app login
  roles → rotation without breaking the old role.
- Terraform modules (all pass `terraform validate` with AWS provider 6.72.0): `network`, `database` (aurora | rds),
  `secrets`, `storage`, `registry`, `observability`, `compute` (Fargate), `single-host` (demo), `edge`
  (CloudFront + WAF), `email` (SES), `budgets` (alerts + demo stop actions), `backup` (AWS Backup + DR copy),
  `restore-drill`, `ci-deploy-role` (GitHub OIDC), `state-bootstrap`, and `cell` (composition).
- **One `tier` variable** on `modules/cell`: `demo` (single t4g.small host with Postgres on the host, no NAT/WAF,
  office-hours auto-stop, budget stop action), `lean` (Fargate 1 api + 1 worker, single-AZ RDS with PITR, VPC
  endpoints in one AZ instead of NAT, basic WAF, staging off by default), `resilient` (3 AZs, Aurora with replica,
  NAT per AZ, full WAF, AWS Backup with cross-region copies).
- `infra/restore-drill/` — monthly restore drill runner + `verify.sql` (verified on Postgres 16, including four
  negative tests that the checks catch).
- Verified ap-south-1 prices downloaded from the AWS Price List API (publication 2026-11-05).

**In progress**
- `terraform validate` of env roots (`envs/bootstrap|demo|staging|production`).

**Next**
- `terraform test` with mocked providers to plan every tier; README cost tables per tier from the verified prices;
  `infra/ci/deploy.yml.example`; runbooks in `docs/runbooks/` (deploy, rollback, backup-restore-verification,
  incident-response, database-roles, disaster-recovery); owner decisions list.
