# Portico infrastructure (AWS)

## Checkpoint

**Status (2026-11-07, second session): code written and tested offline, NOTHING deployed.** No AWS credentials exist
and the owner has not authorized spend (OPEN_QUESTIONS Q4/Q22). No `terraform apply`, no AWS API call that changes
state, no image build has ever happened. Readiness: **R2–R3 for the code, R1 for anything running in AWS.**

**Done**
- Terraform (toolchain floor **1.11**, tested with 1.16.7; AWS provider 6.72.0): 16 modules + 4 env roots, all pass
  `terraform validate`; `terraform test` with a mocked AWS provider plans every tier — **17 runs pass** (15 in
  `modules/cell`, 2 in `modules/database`).
- One `tier` variable: `demo` (T1), `lean` (T2), `resilient` (T3) — § Tiers.
- Runtime contract of the merged modules wired for api **and** worker (§ Runtime contract): field-encryption,
  blind-index and terms-seal keys and the payment-simulator secret generated into Secrets Manager **without ever
  entering Terraform state** (write-only attributes); `TRUSTED_PROXY_CIDRS`; `PORTICO_APP_BASE_URL`; SES settings;
  Stripe Connect TEST/LIVE placeholders with guard rails; operator token refused in production.
- `portico_worker` DB role (group + blue/green logins) for apps/worker; the 18 job-routing `SECURITY DEFINER` functions
  are granted to it only, plus `payments.route_webhook` which stays on the API role until request 1 (§ Requests)
  (`bootstrap-roles.mjs grants`, run after every migration, self-verifying). Its drift check
  caught the 19 new `SECURITY DEFINER` functions identity-plus brought when it merged mid-session; each was reviewed
  and classified (3 worker-only jobs, 16 API).
- `infra/db/verify-roles.sh`: **38/38** checks on a SCRAM-auth PostgreSQL 16, using the production runtime layout
  (`pnpm deploy --prod` + pinned tsx, read-only files, no writable TMPDIR).
- `infra/ci/deploy.yml.example` + `infra/ci/deploy-cell.sh` (tested offline: **27/27**, fake AWS CLI).
- Cost per tier from the downloaded AWS Price List (§ Cost per tier); reproducible with `node infra/cost/estimate.mjs`.
- Runbooks in `docs/runbooks/`: deploy, rollback, backup-restore-verification, incident-response, database-roles,
  disaster-recovery. Owner decisions: § Owner decisions.

**Not done / next** (none blocks local development)
- Everything that needs AWS: plan/apply, image builds, the first restore drill, measured RPO/RTO.
- Requests to other modules (§ Requests) — mainly the payments webhook route on a worker pool and a
  finance-owned trial-balance check.
- Cross-region DR cell creation is a written procedure, not automated (`docs/runbooks/disaster-recovery.md`).

---

## Architecture (one cell)

```
                       viewers (staff browsers, later guests)
                                        │ HTTPS
                     ┌──────────────────▼──────────────────┐
                     │ CloudFront  ── AWS WAF (lean: basic, │   static SPA from a private S3 bucket (OAC)
                     │             resilient: full)        │   /v1/* and /health/* → origin, uncached,
                     └──────────────────┬──────────────────┘   + secret X-Origin-Verify header
          demo tier                     │ HTTPS (lean/resilient)                       
   ┌────────────────────┐   ┌───────────▼────────────┐  ALB SG: 443 from CloudFront origin-facing ranges only;
   │ EC2 t4g.small      │   │ ALB (public subnets)   │  listener forwards only with X-Origin-Verify
   │ api + worker +     │   └───────────┬────────────┘
   │ Postgres (Docker)  │               │ :4000 from the ALB SG only
   │ :4000 from         │   ┌───────────▼────────────┐   ┌──────────────────────┐
   │ CloudFront only    │   │ ECS Fargate (ARM64)    │   │ worker (Fargate)     │  outbox, jobs, webhooks
   │ office-hours stop  │   │ api  (portico_app_*)   │   │ (portico_worker_*)   │
   │ DNS Firewall for   │   └───────────┬────────────┘   └──────────┬───────────┘
   │ provider domains   │               │ 5432 (SG→SG)              │
   └────────────────────┘   ┌───────────▼───────────────────────────▼───────────┐
                            │ data subnets (no route out): RDS PostgreSQL 16    │  KMS-encrypted, TLS forced,
                            │ (lean, single-AZ) / Aurora PG 16 (resilient, 2 AZ)│  PITR, deletion protection
                            └───────────────────────────────────────────────────┘
  egress: lean → tasks' public IPs (no inbound rule); resilient → NAT per AZ; S3 gateway endpoint (free) everywhere
  around it: Secrets Manager (+KMS), S3 documents/exports/backups/logs, ECR, CloudWatch logs + alarms → SNS on-call,
  Route 53 external health check, AWS Budgets, monthly restore drill (EventBridge Scheduler → Fargate), AWS Backup
  with cross-region copies (resilient), SES (when a sending domain is set), GitHub OIDC deploy role
```

Naming is cell-ready: `portico-<env>-<region code>-<cell>` (e.g. `portico-prod-aps1-c01`); state key
`portico/<env>/<cell>/terraform.tfstate`; secrets under `portico/<env>/<region>-<cell>/…`. More cells (other regions
for data residency, a dedicated cell for a group) are more instances of `modules/cell` with their own CIDR.

## Tiers (`modules/cell` variable `tier`; cost-model §4a)

| | demo (T1) | lean (T2) | resilient (T3) |
|---|---|---|---|
| Use | hosted demo, sample data only | small guesthouse pilot | resort / group pilot |
| Compute | 1 × EC2 t4g.small, api + worker + Postgres in Docker | Fargate ARM: 1 api (0.5 vCPU/1 GB) + 1 worker | 2–6 api + 2–4 worker across 3 AZs |
| Database | Postgres container on the host | RDS PostgreSQL db.t4g.small, single-AZ, PITR 14 days | Aurora PostgreSQL Serverless v2, writer + reader, PITR 35 days |
| Egress | host public IP | **task public IPs** (inbound only from the ALB) | NAT gateway per AZ, private tasks |
| WAF | none (Shield Standard only) | basic: IP reputation, core rules, per-IP rate | full: + known bad inputs, SQLi, login rate limit |
| Backups | none (reseed) | automated + PITR + monthly restore drill | + AWS Backup daily/monthly, cross-region copies, vault lock, key replicas |
| Schedule | office hours (Mon–Sat 08–20 Malé), budget stop action | production never stops | production never stops |
| Planned resources (mock plan) | ≈ 107 | ≈ 237 | ≈ 267 |

Environments: `envs/demo` (demo tier), `envs/staging` (lean shape, **off by default**: `active = false` keeps only
the VPC, ECR and the budget), `envs/production` (lean or resilient — **no default, owner decision**). Every value can be
overridden per cell (`overrides`, see `modules/cell/locals.tf`), e.g. `{ db_multi_az = true }` on lean or
`{ db_engine = "rds", db_multi_az = true }` on resilient.

**Egress decision (lean).** The first draft used VPC interface endpoints instead of NAT. Endpoints reach AWS APIs
only, but the application must reach Stripe Connect, customers' OIDC identity providers, outbound webhook targets and
Channex — so payments, SSO and webhooks would have failed. Lean tasks now run in public subnets with a public IP and
**no inbound rule except the API port from the ALB's security group** (≈ $3.65/month per task, vs ≈ $38 for four
endpoints or ≈ $45 for a NAT gateway). Trade-offs: no fixed egress IP (needed only if a provider allow-lists callers →
`overrides = { nat_mode = "single" }`), and AWS Security Hub control ECS.2 flags public task IPs. The resilient tier
keeps private tasks behind NAT per AZ and no longer adds interface endpoints by default (they duplicated NAT for
≈ $114/month).

DNS: the Amazon-provided resolver answers public names without NAT and security groups never filter it, so identity's
SSO domain re-check job (DNS TXT) works on every tier; the demo's DNS Firewall blocks only payment, channel,
messaging and paid-AI provider domains.

## Runtime contract (what the containers get)

Both api and worker run the full composition root (`apps/api/src/composition.ts`), so both need the keys.

| Variable | api | worker | Source | Why |
|---|---|---|---|---|
| `APP_DATABASE_URL` | `portico_app_blue` | `portico_worker_blue` | Secrets Manager `db/app`, `db/worker` (`url`) | RLS-bound logins; routing functions worker-only |
| `PORTICO_FIELD_KEY`, `PORTICO_BLIND_INDEX_KEY` | ✓ | ✓ | `app/field-key`, `app/blind-index-key` (generated, distinct) | kernel `fieldCryptoFromEnv` refuses production without them |
| `PORTICO_FIELD_KEY_ID` | ✓ | ✓ | `<cell>-field-v1` | key id stored with every ciphertext |
| `PORTICO_TERMS_SEAL_KEY` | ✓ | ✓ | `app/terms-seal-key` (generated) | rates refuses production without it |
| `PAYMENTS_SIMULATOR_SIGNING_SECRET` | ✓ | ✓ | `app/payments-simulator-signing-secret` | one value for every task, or simulator signatures fail across tasks |
| `TRUSTED_PROXY_CIDRS` | ✓ | — | ALB (public) subnet CIDRs + CloudFront origin-facing ranges; demo: CloudFront only | real viewer IP for per-IP limits; never `0.0.0.0/0` (guarded) |
| `PORTICO_APP_BASE_URL` | ✓ | ✓ | `https://app.<env domain>` (demo without domain: passed at deploy) | links in staff invitations / password resets (identity) |
| `PORTICO_EMAIL_DOMAIN`, `PORTICO_SES_CONFIGURATION_SET` | ✓ | ✓ | email module, when `email_domain` is set | contract for the staff-email adapter (not built yet) |
| `PAYMENTS_STRIPE_SECRET_KEY_TEST/_LIVE`, `PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST/_LIVE` | ✓ | ✓ | placeholders `integrations/payments-stripe-connect-*`, injected only when they hold a value | LIVE only in production; billing keys can never be injected as `PAYMENTS_*` |
| `OPERATOR_TOKEN`, `PORTICO_OPERATORS` | non-production only | | placeholders (not created in production) | static operator tokens are refused in production (identity P2-17) |
| `NODE_ENV=production`, `PORT`, `DB_POOL_MAX`, `CORS_ORIGINS`, `LOG_LEVEL`, `PORTICO_CELL`, `PORTICO_DEPLOYMENT`, bucket names, `AWS_REGION` | ✓ | ✓ (no port/CORS) | Terraform | — |
| `WORKER_DATABASE_URL` | only with `api_holds_worker_credentials` | — | `db/worker` | for the public webhook route once it uses a worker pool |

Why both ALB subnets **and** CloudFront: the chain is viewer → CloudFront (appends the viewer IP) → ALB (appends the
CloudFront edge IP) → task. Trusting only the ALB would make the CloudFront edge the "client", so all viewers behind
one edge location would share per-IP limits (sign-in: 20/minute). A viewer cannot forge its address: CloudFront always
appends the address it saw. The CloudFront list comes from the AWS-managed prefix list at every plan.

`terraform test` asserts this contract (`runtime_contract_lean_production` and the guard-rail runs).

## Validation status

| What | Result | Where / how |
|---|---|---|
| `terraform fmt -check -recursive` | clean | Terraform 1.16.7 |
| `terraform validate` — env roots bootstrap, demo, staging, production | **valid** | offline init (provider mirror: aws 6.72.0, random 3.9.1, archive 2.8.1) |
| `terraform validate` — all 16 modules | **valid** | same |
| `terraform test` — cell: demo, lean, resilient, inactive staging, runtime contract, 8 guard rails | **15/15 pass** | mocked AWS provider; real `random` (ephemeral resources cannot be mocked) |
| `terraform test` — database: master-username guard | **2/2 pass** | mocked AWS provider |
| Mutation checks | a `0.0.0.0/0` trusted proxy is refused; removing the smoke-test rollback fails the deploy test | done by hand, reverted |
| Role model end to end (`infra/db/verify-roles.sh`) | **38/38** | SCRAM PostgreSQL 16.15; runtime from `pnpm deploy --prod` + tsx 4 (read-only, no TMPDIR): bootstrap → 19 migrations (main incl. identity-plus) as `portico_owner` → grants, then grants and roles each twice concurrently → probes → API `/health/ready` as `portico_app_blue` (and refusal without the seal key) → demo seed → worker ran all 15 jobs as `portico_worker_blue` (incl. identity's login-attempt purge, orphan-SSO-link purge and SSO domain re-check), 0 failed, outbox drained → worker as `portico_app_blue` refused → restore-drill SQL passes, and catches a re-granted routing function and an unbalanced journal entry |
| Deploy script (`infra/ci/test/deploy-cell.test.sh`) | **27/27** | fake AWS CLI + fake skopeo + local HTTP server: order of steps, digest checks, refused mutable tag, failed migration, ECS rollback, failed smoke test, demo host |
| Workflow file | parses; every action pinned to a commit SHA (resolved with `git ls-remote`, tags ≥ 2 weeks old) | never run on GitHub |
| Dockerfiles | reviewed statically; runtime layout exercised (row above) | **NOT built** — no Docker daemon |
| `pnpm lint` | exit 0 | repository root |
| Gate block after merging `main` (module-builder self-check §1) | install (frozen) exit 0; `turbo typecheck --force` exit 0 (18/18); `pnpm test` exit 0 (16/16 packages); `turbo run test --force` **exit 1**: `apps/api` demo-seed tests time out at 30 s (`inventory.test.ts` 30.2 s, `rates.test.ts` 30.5 s) under default concurrency at load average ≈ 42; reproduced on a re-run (1 test) | this branch changes nothing outside infra/, docs/runbooks/ and the Dockerfiles — a known main-side timing issue, reported, not fixed here |

**Never verified:** `terraform plan/apply` against AWS (provider-side validation, quotas, IAM policy correctness,
service-linked roles, ACM/DNS validation, WAF capacity units, Aurora/RDS engine version availability — `engine_version`
16.10 must be checked in the region), image builds and image size, ECS behaviour (circuit breaker, deployment alarms,
`wait services-stable` timing), the restore drill against real snapshots, SES sandbox exit, CloudFront → ALB TLS with
the origin certificate, the budget stop action, the GitHub workflow, YAML-anchor support in the runner, skopeo on the
runner image, RDS-specific role behaviour (`rds_superuser`, IAM auth for `portico_ops_readonly`).

Run the checks yourself:

```bash
# Terraform (1.11+): offline-capable once providers are cached
cd infra/terraform/modules/cell && terraform init -backend=false && terraform test
# Role model (THROWAWAY SCRAM-auth Postgres 16 only — roles are cluster-wide)
PORTICO_VERIFY_THROWAWAY_CLUSTER=yes ADMIN_URL=postgres://postgres:…@127.0.0.1:55440/postgres infra/db/verify-roles.sh
# Deploy script control flow
infra/ci/test/deploy-cell.test.sh
# Cost tables
node infra/cost/estimate.mjs
```

## Cost per tier

**ESTIMATES**, not quotes. Unit prices: AWS Price List Bulk API offer files for `ap-south-1` (CloudFront: global offer),
downloaded **2026-11-07**; offer publication dates range from **2026-09-11 (Secrets Manager, ECR) to 2026-11-07
(EC2)** — each is recorded in `infra/cost/unit-prices-ap-south-1.json`. On-demand USD, **no free tier, no credits, no
taxes**, 730 h/month. Quantities = what the tier's plan creates (counted from `terraform test -verbose`) plus these
usage assumptions for **one pilot hotel**: 2 M CloudFront requests and 20 GB out per month (India edge pricing; the
"Asia Pacific" price is ≈ 10 % higher), 1 ALB LCU on average, 3 GB of logs (lean) / 8 GB (resilient), 20 GB database
storage, 1,000 emails. Re-check with the AWS Pricing Calculator before authorizing spend.

| Tier | ≈ $/month | vs cost-model §4a |
|---|---:|---|
| T0 local / CI | **$0** | $0 |
| T1 demo, office hours (Mon–Sat 08–20) | **$15** | $10–30 ✓ |
| T1 demo, always on | **$20** | $10–30 ✓ |
| T2 lean production pilot | **$121** | ≈ $90–160 ✓ |
| T2 staging, off between releases (default) | **$0.30** | — |
| T2 staging, one 2-day release rehearsal | **$8** | — |
| Staging always on, tasks scaled to zero off-hours | **$108** | $40–80 (cost model) — higher: RDS, ALB and WAF run all month |
| T3 resilient, quiet (Aurora at its 0.5 ACU floor) | **$407** | ≈ $300–500 ✓ |
| T3 resilient, busy (Aurora ≈ 1 ACU per instance) | **$538** | above the range |
| T3 variant: RDS Multi-AZ db.t4g.small instead of Aurora | **$334** | ≈ $300–500 ✓ |

Not included: Channex ($137+/month when activated, Q23), the domain and its Route 53 hosted zone ($0.50/month,
shared by all environments), AWS Support plans, paging tools, data transfer beyond the assumptions, taxes. AWS Free Tier: new accounts get **$100 + up to $100 in credits over 6 months** on the
Free plan (verified 2026-11-07, cost-model §4a) — enough for the T1 demo for months, not a basis for a pilot. AWS
"always free" allowances (e.g. some CloudWatch alarms and metrics) would trim a few dollars; they are not applied.
CloudFront **flat-rate plans** (page fetched 2026-11-07: Free $0 — 1 M requests, 100 GB, 5 WAF rules; Pro $15 —
10 M requests, 50 TB, 25 WAF rules) could replace the CloudFront + WAF line items (≈ $14 on lean) — not modelled in
Terraform; an owner option to evaluate.

The biggest levers: T3's NAT gateways (≈ $134 for three) and Aurora's two-instance floor (≈ $131); T2's database
(≈ $33) and ALB (≈ $31 incl. IPs). Staging off by default saves ≈ $100/month.

<details>
<summary>Line items per tier (generated by <code>node infra/cost/estimate.mjs</code>)</summary>

**T1 demo — office hours (Mon–Sat 08:00–20:00 Malé)** — ≈ **$15.41/month**

| Line item | $/month |
|---|---:|
| EC2 t4g.small (api + worker + Postgres in Docker) | $3.49 |
| EBS gp3 20 GB | $1.82 |
| Elastic IP (billed while stopped too) | $3.65 |
| CloudFront 5 GB + 0.5M HTTPS requests (India) | $1.15 |
| KMS key (logs + on-call topic) | $1.00 |
| CloudWatch: 7 alarms, 7 log-derived metrics, 1 GB logs | $3.50 |
| DNS Firewall (external-effect providers blocked) | $0.60 |
| ECR 2 GB | $0.20 |
| AWS Budgets (1 budget, 2 actions) — assumed free tier of Budgets, not in the price files: verify | $0 |

**T1 demo — always on** — ≈ **$20.10/month**

| Line item | $/month |
|---|---:|
| EC2 t4g.small (api + worker + Postgres in Docker) | $8.18 |
| EBS gp3 20 GB | $1.82 |
| Elastic IP (billed while stopped too) | $3.65 |
| CloudFront 5 GB + 0.5M HTTPS requests (India) | $1.15 |
| KMS key (logs + on-call topic) | $1.00 |
| CloudWatch: 7 alarms, 7 log-derived metrics, 1 GB logs | $3.50 |
| DNS Firewall (external-effect providers blocked) | $0.60 |
| ECR 2 GB | $0.20 |
| AWS Budgets (1 budget, 2 actions) — assumed free tier of Budgets, not in the price files: verify | $0 |

**T2 lean — production pilot** — ≈ **$121.29/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 0.5 vCPU/1 GB + worker 0.25 vCPU/0.5 GB | $15.90 |
| Task public IPv4 × 2 (egress without NAT) | $7.30 |
| RDS PostgreSQL db.t4g.small Single-AZ | $30.66 |
| RDS gp3 20 GB (backups + 14-day PITR within the free allocation) | $2.62 |
| Monthly restore drill (1 h restore + Fargate minutes) | $0.14 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 2 | $7.30 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF basic (web ACL + 3 rules + 2M requests) | $9.20 |
| Secrets Manager × 15 | $6.00 |
| KMS keys × 5 | $5.00 |
| CloudWatch: 17 alarms, 7 log-derived metrics, 3 GB logs | $5.90 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 10 GB (documents, exports, backups, logs) | $0.25 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |

**T2 staging — off between releases (default)** — ≈ **$0.30/month**

| Line item | $/month |
|---|---:|
| ECR images kept for the next release (VPC, S3 gateway endpoint, budget: $0) | $0.30 |

**T2 staging — one 2-day release rehearsal** — ≈ **$8.25/month**

| Line item | $/month |
|---|---:|
| Lean cell active 2 days for a release rehearsal (prorated hourly) | $7.95 |
| ECR | $0.30 |

**T2/T3 staging — always on with office-hours scaling** — ≈ **$107.86/month**

| Line item | $/month |
|---|---:|
| Lean cell always on, tasks scaled to zero outside office hours | $107.56 |
| ECR | $0.30 |

**T3 resilient — production, quiet (Aurora at its 0.5 ACU floor)** — ≈ **$406.86/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| Aurora Serverless v2: writer + reader at 0.5 ACU each | $131.40 |
| Aurora storage 10 GB + 30M I/O | $7.70 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h + Fargate minutes) | $0.29 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 18 | $7.20 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 19 alarms, 7 log-derived metrics, 8 GB logs | $9.60 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

**T3 resilient — production, busy (Aurora averaging 1 ACU per instance)** — ≈ **$538.26/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| Aurora Serverless v2: writer + reader at 1 ACU each | $262.80 |
| Aurora storage 10 GB + 30M I/O | $7.70 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h + Fargate minutes) | $0.29 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 18 | $7.20 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 19 alarms, 7 log-derived metrics, 8 GB logs | $9.60 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

**T3 variant — resilient with RDS Multi-AZ instead of Aurora (overrides: db_engine = "rds", db_multi_az = true)** — ≈ **$334.32/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| RDS PostgreSQL db.t4g.small Multi-AZ (synchronous standby, automatic failover) | $61.32 |
| RDS Multi-AZ gp3 20 GB | $5.24 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h + Fargate minutes) | $0.29 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 18 | $7.20 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 19 alarms, 7 log-derived metrics, 8 GB logs | $9.60 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

</details>

## Budget alerts vs hard caps

**An AWS budget alert is not a spending cap.** Budgets evaluate billing data that lags usage by up to about a day and
never stop spend by themselves. `modules/budgets` notifies at 50/80/100 % of actual and 100 % of forecast spend. On the
**demo tier only**, budget actions at 100 % stop the host and attach a deny-StartInstances policy to the office-hours
scheduler — still not a hard cap: EBS, the Elastic IP and CloudFront keep billing (≈ $5/month) and spend between the
last billing update and the stop is incurred. Production budgets **only alert**: stopping a live hotel's system is
worse than an overspend. Real hard stops: `terraform destroy` of the cell, or an AWS Organizations SCP denying
everything in the account.

## Requests to other modules (findings)

| # | For | Request | Why |
|---|---|---|---|
| 1 | payments + foundation | Serve the public Stripe webhook route with a `portico_worker` pool (`WORKER_DATABASE_URL`); then move `payments.route_webhook` to `ROUTING_FUNCTIONS.workerOnly` and set `api_holds_worker_credentials = true` in production | payments review P3-5: today the API role must still execute it |
| 2 | packages/db | Create `portico_worker` (member of `portico_app`) in the development bootstrap (`migrate.ts`), let module migrations grant routing functions to it, and run job tests as that role | production revokes job routing from `portico_app`; tests should see the same privileges (the quality steward's "test as a role without RLS bypass" request) |
| 3 | finance | Provide `finance.verify_trial_balance()` (ledger balanced per tenant **and** folio balances = ledger projection); the restore drill calls it when present | today the drill checks per-entry balance itself; folio projection is unchecked |
| 4 | worker (foundation) | Emit `{"msg":"outbox stats","pending":N,"oldestPendingAgeSeconds":N,"dead":N}` every 60 s and `{"msg":"event delivery dead",…}`; a heartbeat would allow a container liveness check | outbox backlog/dead alarms stay INSUFFICIENT_DATA until then (`outbox_stats_contract_live`) |
| 5 | kernel | KMS envelope encryption for the field key and key ids for field/seal key rotation | the keys are irreplaceable today; rotation would orphan data |
| 6 | identity | Staff-email adapter on SES for `identity.staffMessage.requested` (infra provides `PORTICO_EMAIL_DOMAIN`, `PORTICO_SES_CONFIGURATION_SET`, `ses:SendEmail` on the cell's identity); operator console via IAM Identity Center before production | live invitations are queued with no adapter; the operator console is disabled in production |
| 7 | apps/api | A real build step instead of tsx at runtime (packages export TS sources and resolve migrations via `import.meta.url`) | smaller images, faster start |
| 8 | apps/api | `config.ts` comment for `TRUSTED_PROXY_CIDRS` says "the VPC CIDR"; behind CloudFront it must also list the CloudFront ranges (infra sets both) | avoid a future misconfiguration |
| 9 | integration | `integration.tenant_schedule` is RLS-enabled but not forced (owner-run `claim_due_tenants`); the restore drill now lists it as a reviewed exception — confirm, or force RLS and read through the function only | the drill failed on main's schema until reviewed |
| 10 | demo seed | The demo seed creates no journal entries, so seeded demos exercise no ledger; restore-drill evidence on a demo database proves less | — |

## Owner decisions

Defaults are what the code does today; nothing is applied until Q4/Q22 are answered.

| # | Decision | Default in the code | Cost / risk if different | Blocks |
|---|---|---|---|---|
| D1 | AWS account(s) and permission to create paid resources (Q4a, Q22) | none; `allowed_account_ids` must be set | — | any hosted environment |
| D2 | Primary region (Q4b) | `ap-south-1` Mumbai | variable change; prices differ per region | — |
| D3 | Monthly ceilings: demo budget (Q22) and production alert level | demo $25 with stop action; production: required input (example $200), alert-only | — | hosted demo |
| D4 | Hosted demo (T1) now? | no (local demo, $0) | ≈ $15–20/month; covered by Free-plan credits at first | remote demos |
| D5 | Production tier for the first pilot: lean or resilient (Q26 pilot profile) | **no default** | lean ≈ $121 (zone failure = restore from backup, hours); resilient ≈ $410–540 or ≈ $335 with RDS Multi-AZ | pilot |
| D6 | Lean egress: public task IPs or a NAT gateway (fixed egress IP, private tasks) | public task IPs | NAT ≈ +$45/month | providers that allow-list IPs |
| D7 | DR region and whether guest data may be copied there (data residency) | `ap-south-2` (Hyderabad) for resilient backups and key replicas | — | resilient tier |
| D8 | Separate recovery AWS account for restore drills | same account | small; stronger isolation | — |
| D9 | Restore-drill cadence | monthly (support plan target: weekly) | weekly ≈ 4× a ~$1 cost | — |
| D10 | Domain and email sender (Q1 answered "Portico"; purchase under Q22) | none (demo works on the CloudFront domain) | ≈ $15–50/year domain [estimate] | lean/resilient (HTTPS origins), staff email |
| D11 | Paging/on-call tool and who is on call (Q21 support promise) | email to an SNS topic | tool cost | 24/7 claims (never made without it) |
| D12 | Staging always on vs on demand | on demand (`active = false`) | always on ≈ $108/month | — |
| D13 | Stripe Connect platform account (Q2) — TEST keys first | placeholders, no values; simulator only | — | sandbox payments |
| D14 | Channex production activation (Q23) | placeholder, no value | $137+/month | OTA connectivity |
| D15 | CloudFront flat-rate plan instead of pay-as-you-go CloudFront + WAF | pay-as-you-go | Pro plan $15/month (page 2026-11-07) | — |
| D16 | Operator access in production: AWS IAM Identity Center | operator console disabled in production | — | operator support tooling in production |

## Layout

```
infra/
  terraform/modules/   network, database, secrets, storage, registry, observability, compute, single-host, edge,
                       email, budgets, backup, restore-drill, ci-deploy-role, state-bootstrap, cell (composition)
  terraform/envs/      bootstrap (state bucket + GitHub OIDC), demo, staging, production
  db/                  bootstrap-roles.mjs (roles + grants phases), verify-roles.sh (end-to-end check)
  restore-drill/       restore-drill.sh, verify.sql, Dockerfile
  ci/                  deploy.yml.example, deploy-cell.sh, test/ (offline tests)
  cost/                unit-prices-ap-south-1.json, estimate.mjs
  docker/tsx-runtime/  lockfile-pinned TypeScript loader for the images
apps/api/Dockerfile, apps/worker/Dockerfile, .dockerignore
docs/runbooks/         deploy, rollback, backup-restore-verification, incident-response, database-roles, disaster-recovery
```

## Follow-ups

- First real `terraform plan` in the authorized account; fix whatever AWS rejects; record evidence.
- Pin `node:22.23.4-slim` by digest at the first real build; add image scanning gates on ECR findings.
- Automate the DR-region cell (restore from a recovery point into a new cell, reuse replicated keys).
- Restore drills in a separate recovery account (D8).
- Off-AWS uptime check (the Route 53 checker runs inside AWS).
