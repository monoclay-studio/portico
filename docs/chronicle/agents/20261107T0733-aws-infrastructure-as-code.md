# Agent run: AWS infrastructure as code

- Started: 2026-11-07T07:33:46.210Z · last activity: 2026-11-07T08:29:58.727Z
- Turns: 110 · tool uses: 170 · output tokens: 307,401
- Type: general-purpose

## Brief (2026-11-07T07:33:46.210Z)

````text
You are the platform/infrastructure engineer for Portico (cloud hospitality platform by Monoclay LLC). Build production-grade AWS infrastructure as code. NOTHING may be deployed: no AWS credentials exist and the owner has not authorized spend (OPEN_QUESTIONS Q4/Q22). Your job is code + docs that are ready to apply once authorized.

WORK ONLY in the git worktree /home/user/wt/infra (branch feat/infra-aws), only under infra/ and docs/runbooks/ plus a Dockerfile per deployable (apps/api/Dockerfile, apps/worker/Dockerfile) and a root .dockerignore. Commit with Conventional Commits ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do not push. Do not ask questions; record owner questions in infra/README.md.

READ FIRST: CLAUDE.md, docs/product/vision.md, docs/architecture/overview.md, docs/adr/ (esp. 0002 RLS roles, 0004 outbox worker, 0010 environment safety, 0011 AWS topology), docs/product/operational-readiness-brief.md §15–§17 (costs, zero-cost demo, reliability), docs/readiness/cost-model.md and docs/readiness/support-recovery-plan.md (on main — read them at /home/user/portico/docs/readiness/ since your worktree predates them), apps/api/src/config.ts (env vars), packages/db/src/migrate.ts (roles: migration owner vs portico_app).

Tools: a Terraform 1.9.8 binary is at /home/user/tools/terraform. The Terraform registry is blocked by the network proxy, so `terraform init` with providers will fail — use `terraform fmt -recursive -check` and careful review; state clearly in the README that `validate`/`plan` have NOT been run (honest readiness: R2 at most). Docker daemon is not running; Dockerfiles cannot be built here — say so.

Build:
- infra/terraform/modules/: network (VPC, private/public subnets across 3 AZs, NAT strategy with a cost note, VPC endpoints for S3/ECR/Secrets Manager/CloudWatch), database (Aurora PostgreSQL 16 Multi-AZ, encryption with a customer-managed KMS key, PITR, backup retention, deletion protection, IAM auth option, parameter group enforcing TLS, performance insights; separate master/migration role and the `portico_app` role created by a migration job, never superuser for the app), compute (ECS Fargate cluster; api service behind ALB with health checks /health/ready; worker service; one-off migration task definition run before deploys; autoscaling; least-privilege task roles), storage (S3 buckets for documents/exports/backups with SSE-KMS, block public access, versioning, lifecycle, signed-URL access only), edge (CloudFront + WAF managed rule groups + rate limiting for web apps and API; ACM certs), secrets (Secrets Manager for DB credentials, field-encryption data key via KMS, Stripe/channel credentials placeholders — no values), observability (CloudWatch log groups with retention, alarms on 5xx, latency, DB CPU/connections/replica lag, outbox backlog/dead deliveries metric filter, SNS topic for on-call), email (SES domain identity placeholders, configuration set), budgets (AWS Budgets with notifications AND a clearly documented distinction between a budget alert and a hard cap — AWS budgets do not stop spend; describe actual hard-stop options).
- infra/terraform/envs/: demo (smallest viable footprint for a hosted demo with zero real external effects — consider single-AZ/serverless v2 min capacity, scale-to-low, no NAT if avoidable; estimate monthly cost with assumptions), staging, production (ap-south-1 default per Q4; region a variable; cell-ready naming so more regions/cells can be added for data residency). Remote state (S3 + DynamoDB lock) bootstrap module.
- Deploy pipeline: .github/workflows/deploy.yml is NOT allowed (write it as infra/ci/deploy.yml.example instead, documented, using GitHub OIDC to assume a deploy role — no long-lived keys), with steps: build images → push ECR → run migration task → deploy api/worker → smoke test → automatic rollback on failed health checks.
- Dockerfiles: multi-stage, non-root user, read-only filesystem friendly, pnpm deploy/prune, node:22-slim pinned by version, HEALTHCHECK not needed for ECS (ALB health checks) — explain.
- docs/runbooks/: deploy.md, rollback.md (incl. why restoring an old DB backup is not a rollback — readiness brief §17/§18), backup-restore-verification.md (automated monthly restore test into an isolated account/cluster with verification queries — backups only count when restored), incident-response.md (severity levels, roles, comms), database-roles.md (owner vs portico_app, RLS, rotation), disaster-recovery.md (targets labeled as TARGETS: RPO/RTO proposals and what evidence is needed).
- infra/README.md: architecture diagram (text), environments, cost estimates per environment with assumptions and sources (AWS public pricing pages; label estimates), what is not done, owner decisions needed.

Final reply (~250 words): what was built, honest validation status, estimated monthly cost for demo/staging/production with key assumptions, and owner decisions needed.
````

