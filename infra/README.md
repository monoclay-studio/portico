# Portico infrastructure (AWS)

## Checkpoint

**Status (2026-11-07, security fix round after the steward review `docs/orchestration/reviews/review-infra.md`):
code written and tested offline, NOTHING deployed.** No AWS credentials exist and the owner has not authorized spend
(OPEN_QUESTIONS Q4/Q22). No `terraform apply`, no AWS call that changes state, no image build has ever happened.
Readiness: **R3 for the code (implemented and tested internally, offline), R1 for anything running in AWS.**

**Done in the fix round** (review P1-1…P1-3, P2-1…P2-11, cheap P3s; § Review fixes maps finding → commit → test)
- The CI deploy role can no longer read secrets, pass roles, register task definitions or run tasks; Terraform owns
  every task definition; migrations and routing grants run as init containers; the role bootstrap is human-only;
  the OIDC trust matches an exact subject (immutable repository and owner ids, environment, `main`, the deploy
  workflow), and `envs/github` codifies the GitHub side.
- Lean tier defaults to private tasks behind one NAT gateway (Q158); public task IPs are an explicit opt-in.
- The restore drill runs the release's image; a missing drill, a task that fails to start and a stale backup copy
  all page (missing data = breaching).
- Start-up guard refuses live Stripe keys by value outside production; key protection, read restrictions and DR
  replicas for the irreplaceable keys; CloudTrail, GuardDuty and destructive-call alarms per account; no PII in
  Postgres logs; grants step fails closed; drill checks every policy and both login groups.

**Not done / next** (none blocks local development)
- Everything that needs AWS: plan/apply, image builds, the first drill, measured RPO/RTO (§ Not verified).
- Requests to other modules (§ Requests).

---

## Architecture (one cell)

```
                       viewers (staff browsers, later guests)
                                        │ HTTPS
                     ┌──────────────────▼──────────────────┐
                     │ CloudFront ── AWS WAF (lean: basic,  │  static SPA from a private S3 bucket (OAC)
                     │            resilient: full)          │  /v1/* and /health/* → origin, uncached,
                     └──────────────────┬──────────────────┘  + secret X-Origin-Verify header
          demo tier                     │ HTTPS (lean/resilient)
   ┌────────────────────┐   ┌───────────▼────────────┐  ALB SG: 443 from CloudFront origin-facing ranges only
   │ EC2 t4g.small      │   │ ALB (public subnets)   │
   │ api + worker +     │   └───────────┬────────────┘
   │ Postgres (Docker)  │               │ :4000 from the ALB SG only
   │ CloudFront → :4000 │   ┌───────────▼─────────────────────────┐  ┌────────────────────────┐
   │ deploy: SSM doc    │   │ api task (private subnets, Fargate)  │  │ worker task            │
   │ with validated     │   │  init: migrate → grants (owner)      │  │ (portico_worker_*)     │
   │ parameters         │   │  then api (portico_app_*)            │  └───────────┬────────────┘
   └────────────────────┘   └───────────┬─────────────────────────┘              │
                            ┌───────────▼──────────────────────────────────────────▼──┐
                            │ data subnets (no route out): RDS PostgreSQL 16 (lean) /   │
                            │ Aurora PostgreSQL 16 (resilient)                          │
                            └───────────────────────────────────────────────────────────┘
  egress: NAT gateway (lean: one; resilient: per AZ); public task IPs only by explicit opt-in; S3 gateway endpoint
  per account (envs/bootstrap): state bucket, GitHub OIDC provider, CloudTrail, GuardDuty, security alarms
```

## Tiers (`modules/cell` variable `tier`; cost-model §4a)

| | demo (T1) | lean (T2) | resilient (T3) |
|---|---|---|---|
| Use | hosted demo, sample data only | small guesthouse pilot | resort / group pilot |
| Compute | 1 × EC2 t4g.small, api + worker + Postgres in Docker | Fargate ARM: 1 api + 1 worker | 2–6 api + 2–4 worker, 3 AZs |
| Database | Postgres container on the host | RDS PostgreSQL db.t4g.small, single-AZ, PITR 14 days | Aurora Serverless v2, writer + reader, PITR 35 days |
| Egress | host public IP | **one NAT gateway, private tasks** (Q158); `public_task_ips = true` opt-in | NAT per AZ, private tasks |
| WAF | none | basic: IP reputation, core rules, per-IP + login rate limits | full: + known bad inputs, SQLi |
| Backups | none (reseed) | automated + PITR + drill (monthly) + freshness (daily) | + AWS Backup daily/monthly, DR copies, vault lock |
| Keys | on the host | Secrets Manager; production: protected + DR replica | same |

## Release model (P1-1, P2-8)

```
CI (main only, protected env) ── push SHA images (index digest kept) ── move `release` tag ── force new deployment
                                                                                       │
Terraform-owned api task definition:  migrate (init, owner) → grants (init, owner) → api ─┘   then the worker
```

- Every ECR tag is immutable except `release` (`IMMUTABLE_WITH_EXCLUSION`). Task definitions reference
  `<repo>:release`; ECS resolves it to a digest once per deployment.
- The deploy role: ECR push to the cell's repositories, `ecs:UpdateService`/`DescribeServices` on the cell's services,
  the deploy-config parameter, the web bucket and the distribution, logs of `/portico/<prefix>/*`. Nothing else
  (`modules/ci-deploy-role/tests/least-privilege.tftest.hcl`). It is still as powerful as the code it deploys: that
  code runs with the application's secrets. Only reviewed code on `main`, in a protected environment, reaches it.
- `db-bootstrap` (RDS master) and the standalone `migrate` task are for humans (break-glass, rotation).

## Runtime contract (what the containers get)

| Variable | api | worker | Source |
|---|---|---|---|
| `APP_DATABASE_URL` | `portico_app_blue` | `portico_worker_blue` | Secrets Manager `db/app`, `db/worker` |
| `DATABASE_URL` | init containers only (owner) | — | `db/owner` |
| `PORTICO_FIELD_KEY`, `PORTICO_BLIND_INDEX_KEY`, `PORTICO_TERMS_SEAL_KEY`, `PAYMENTS_SIMULATOR_SIGNING_SECRET` | ✓ | ✓ | `app/*` (generated, write-only) |
| `NODE_ENV` | `production` in production; `development` on demo/staging (operator console works) | same | Terraform; init containers always `production` |
| `PORTICO_DEPLOYMENT` | demo / staging / production | same | Terraform (the guard's source of truth) |
| `TRUSTED_PROXY_CIDRS` | ALB subnets + CloudFront origin-facing ranges (never shorter than /8) | — | Terraform |
| `PORTICO_APP_BASE_URL`, SES settings, Stripe Connect keys (when they hold values) | ✓ | ✓ | Terraform / placeholders |
| `OPERATOR_TOKEN`, `PORTICO_OPERATORS` | demo/staging only, when injected | | refused in production |

Every process starts behind `infra/ops/env-guard.mjs`: unknown deployment, a Stripe LIVE key (by value) or a live-only
credential outside production, or missing/equal app keys → exit 78 before any application code runs.

## Validation status

| What | Result | Where / how |
|---|---|---|
| `terraform fmt -check -recursive` | clean | Terraform 1.16.7 |
| `terraform validate` | **22/22 valid** (5 env roots incl. `envs/github`, 17 modules) | offline provider mirror (aws 6.72.0, random 3.9.1, github 6.13.0) |
| `terraform test` | **38/38**: cell 21, ci-deploy-role 6, database 3, restore-drill 3, account-security 2, envs/github 3 | mocked providers |
| Infra unit tests (`node --test`) | **20/20**: env guard 7, definer lists 3, drill stop pattern 6, supply chain 4 | — |
| Deploy script (`infra/ci/test/deploy-cell.test.sh`) | **28/28** | fake aws CLI, fake skopeo (index digests), local HTTP server |
| Role model (`infra/db/verify-roles.sh`) | **53/53** | SCRAM PostgreSQL 16.15, production runtime layout (`RUNTIME_DIR`), `PG_LOG_FILE` for the log probe; pre-fix scripts fail 13 |
| Mutation proof | 24 mutants, 23 red; the green one removes a redundant branch (`TaskFailedToStart`, also matched by "no exit code") | each guard removed in turn, then restored |
| CI | `.github/workflows/ci.yml` job `infra` runs all of the above (log probe skipped without a log file) | never run on GitHub yet |
| Docker images | **NOT built** (no daemon); corepack hash verified locally (good hash accepted, wrong hash refused) | — |

### Not verified

`terraform plan/apply` against AWS (IAM evaluation of the new policies, including whether ECS supplies
`ecs:task-definition` on UpdateService; ECR `IMMUTABLE_WITH_EXCLUSION`; Secrets Manager resource-policy condition keys
on DeleteSecret; whether the provider's refresh of a secret version needs `GetSecretValue`), image builds, ECS
behaviour (init-container ordering, version consistency of the `release` tag, circuit breaker), the GitHub OIDC
customized subject format on a real run, AWS/Backup metric dimensions, EventBridge matching on real ECS events (the
pattern is tested with a local matcher), GuardDuty cost, the drill against real snapshots, SES sandbox exit.

## Cost per tier

**ESTIMATES**, not quotes: AWS Price List offer files for `ap-south-1` (CloudFront: global), downloaded 2026-11-07;
publication dates 2026-09-11 to 2026-11-07, recorded in `infra/cost/unit-prices-ap-south-1.json`. On-demand USD, no
free tier, no credits, no taxes, 730 h/month. Usage assumptions for one pilot hotel: 2 M requests and 20 GB out per
month through CloudFront (India pricing), 20 GB through NAT, 1 ALB LCU, 3 GB logs (lean) / 8 GB (resilient), 20 GB
database. Regenerate: `node infra/cost/estimate.mjs`.

| Tier | ≈ $/month | vs cost-model §4a |
|---|---:|---|
| T0 local / CI | **$0** | $0 |
| T1 demo, office hours / always on | **$15 / $20** | $10–30 ✓ |
| T2 lean production pilot (NAT default) | **$163** | ≈ $90–160 — slightly above: the NAT gateway (Q158) adds ≈ $45, minus $7 of task IPs |
| T2 lean with the `public_task_ips` opt-in | ≈ $124 | ✓ |
| Staging off (default) / 2-day rehearsal / always on | **$0.30 / $11 / $153** | — |
| T3 resilient quiet / busy (Aurora 0.5 / 1 ACU each) | **$408 / $539** | ≈ $300–500 (busy above) |
| T3 with RDS Multi-AZ instead of Aurora | **$335** | ✓ |
| Per account: CloudTrail + GuardDuty + alarms | ≈ $0.05 + GuardDuty (usage-based, **unpriced**) | — |

Not included: Channex ($137+/month, Q23), the domain and its hosted zone ($0.50/month), AWS Support, paging tools,
GuardDuty usage, taxes. The AWS Free plan gives new accounts $100 + up to $100 in credits over 6 months (cost-model
§4a) — enough for T1 for months, not a basis for a pilot. CloudFront flat-rate plans (Free / Pro $15, page fetched
2026-11-07) could replace the CloudFront + WAF lines — not modelled.

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

**T2 lean — production pilot** — ≈ **$162.54/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 0.5 vCPU/1 GB + worker 0.25 vCPU/0.5 GB | $15.90 |
| NAT gateway × 1 (private tasks; Q158 default) | $40.88 |
| NAT Elastic IP | $3.65 |
| NAT data processing 20 GB | $1.12 |
| RDS PostgreSQL db.t4g.small Single-AZ | $30.66 |
| RDS gp3 20 GB (backups + 14-day PITR within the free allocation) | $2.62 |
| Monthly restore drill (1 h restore) + daily freshness task | $0.24 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 2 | $7.30 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF basic (web ACL + 4 rules + 2M requests) | $10.20 |
| Secrets Manager × 19 | $7.60 |
| KMS keys × 5 | $5.00 |
| CloudWatch: 19 alarms, 7 log-derived metrics, 3 GB logs | $6.10 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 10 GB (documents, exports, backups, logs) | $0.25 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |

**T2 staging — off between releases (default)** — ≈ **$0.30/month**

| Line item | $/month |
|---|---:|
| ECR images kept for the next release (VPC, S3 gateway endpoint, budget: $0) | $0.30 |

**T2 staging — one 2-day release rehearsal** — ≈ **$10.95/month**

| Line item | $/month |
|---|---:|
| Lean cell active 2 days for a release rehearsal (prorated hourly) | $10.65 |
| ECR | $0.30 |

**T2/T3 staging — always on with office-hours scaling** — ≈ **$153.19/month**

| Line item | $/month |
|---|---:|
| Lean cell always on, tasks scaled to zero outside office hours | $152.89 |
| ECR | $0.30 |

**T3 resilient — production, quiet (Aurora at its 0.5 ACU floor)** — ≈ **$407.76/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| Aurora Serverless v2: writer + reader at 0.5 ACU each | $131.40 |
| Aurora storage 10 GB + 30M I/O | $7.70 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h) + daily freshness task | $0.39 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 19 | $7.60 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 23 alarms, 7 log-derived metrics, 8 GB logs | $10.00 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

**T3 resilient — production, busy (Aurora averaging 1 ACU per instance)** — ≈ **$539.16/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| Aurora Serverless v2: writer + reader at 1 ACU each | $262.80 |
| Aurora storage 10 GB + 30M I/O | $7.70 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h) + daily freshness task | $0.39 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 19 | $7.60 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 23 alarms, 7 log-derived metrics, 8 GB logs | $10.00 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

**Per AWS account (envs/bootstrap): detective controls** — ≈ **$0.05/month**

| Line item | $/month |
|---|---:|
| CloudTrail multi-region trail (first copy of management events: no CloudTrail charge) | $0 |
| CloudTrail log bucket (≈ 2 GB) | $0.05 |
| GuardDuty — usage-based, NOT in the downloaded price files (30-day trial, then a few $/month for a small account) [unpriced] | $0 |
| Security EventBridge rules + 2 SNS topics (email) | $0 |

**T3 variant — resilient with RDS Multi-AZ instead of Aurora (overrides: db_engine = "rds", db_multi_az = true)** — ≈ **$335.22/month**

| Line item | $/month |
|---|---:|
| Fargate ARM: api 2 × (0.5 vCPU/1 GB) + worker 2 × (0.25 vCPU/0.5 GB) | $31.81 |
| NAT gateway × 3 (one per AZ) | $122.64 |
| NAT Elastic IP × 3 | $10.95 |
| NAT data processing 30 GB | $1.68 |
| RDS PostgreSQL db.t4g.small Multi-AZ (synchronous standby, automatic failover) | $61.32 |
| RDS Multi-AZ gp3 20 GB | $5.24 |
| AWS Backup cross-region copies (5 GB × 30 daily copies transferred + DR storage) | $16.92 |
| Monthly restore drill (Aurora db.t4g.medium 1 h) + daily freshness task | $0.39 |
| ALB (hours + 1 LCU average) | $23.29 |
| ALB public IPv4 × 3 | $10.95 |
| CloudFront 20 GB + 2M HTTPS requests (India) | $4.58 |
| WAF full (web ACL + 6 rules + 2M requests) | $12.20 |
| Secrets Manager × 19 | $7.60 |
| KMS keys × 7 | $7.00 |
| CloudWatch: 23 alarms, 7 log-derived metrics, 8 GB logs | $10.00 |
| Route 53 HTTPS health check (external) | $2.75 |
| S3 20 GB (documents, exports, backups, logs) | $0.50 |
| ECR 3 GB | $0.30 |
| SES 1000 emails | $0.10 |
| Container Insights + enhanced monitoring (metrics/logs) | $5.00 |

</details>

## Personal data in infrastructure logs (infra owns these settings)

| Log | Personal data | Control | Evidence |
|---|---|---|---|
| Postgres (RDS/Aurora, demo) | none: statements show `$n` placeholders; no bind values, no `Key (…)=(…)` details | `log_parameter_max_length[_on_error]=0`, `log_error_verbosity=terse` | database `no_bind_values_in_logs`; `verify-roles.sh` step 10 (log probe with positive control) |
| WAF (CloudWatch, us-east-1) | client IPs, URLs of blocked/counted requests only | `authorization`, `cookie`, `x-origin-verify` redacted; 30 days | code `edge/waf.tf` |
| ALB access logs (production) | client IPs (CloudFront edges), request URLs **including query strings** | 90-day expiry; erasure does not reach them — the retention is the control | code `storage/main.tf` (planned: strip query strings or shorten retention — owner/privacy decision) |
| Application logs | the application's logger redaction list (CLAUDE.md §6) | retention 7/30/90 days per tier | not infra's code |
| CloudTrail | AWS API calls, no guest data | log-file validation | `account-security` tests |

## Budget alerts vs hard caps

**An AWS budget alert is not a spending cap.** Budgets lag usage by up to about a day and never stop spend by
themselves. On the **demo tier only**, budget actions stop the host and block restarts — still not a hard cap (EBS,
Elastic IP and CloudFront keep billing). Production budgets only alert. Real hard stops: `terraform destroy` of the
cell, or an AWS Organizations SCP.

## Review fixes (finding → commit → test)

| Finding | Commit | Test that proves it (red without the fix) |
|---|---|---|
| P1-1 deploy role admin-equivalent; trust by name | `c168bc5` | `ci-deploy-role/tests/least-privilege.tftest.hcl` (6 runs; mutants: PassRole/RunTask re-added, trust by name → red); cell `ci_cannot_reach_guest_money_keys`; `deploy-cell.test.sh` "no task definition registered…" (mutant red); `envs/github/tests` |
| P1-2 egress default contradicts Q158 | `5e149f6` | cell `lean_tier_plans` (mutant `lean = "none"` → red), `lean_public_task_ips_is_an_explicit_opt_in`, `public_task_ips_refused_on_resilient` |
| P1-3 drill never runs, nobody told | `44d71fd` | `restore-drill/tests/fails-loudly.tftest.hcl` (mutant notBreaching → red); `event-pattern.test.mjs` (mutant without the missing-exit-code branch → red); cell backup missing-job assertion (mutant → red) |
| P2-1 LIVE guard by name only | `15966d4`, `5e149f6` | `env-guard.test.mjs` "staging refuses a LIVE Stripe key under the TEST name" (mutant → red); cell `live_key_under_a_test_name_refused_outside_production`, `channex_production_and_billing_keys_refused…` (mutant → red) |
| P2-2 unreviewed definer only warns | `65b301a` | `verify-roles.sh` step 8 (pre-fix: 3 failures) |
| P2-3 ops role reads directory PII | `65b301a` | `verify-roles.sh` step 9 (pre-fix: 2 failures) |
| P2-4 drill misses policy/worker defects | `65b301a` | `verify-roles.sh` step 7, 7 planted defects (pre-fix: 7 missed) |
| P2-5 PII in Postgres logs | `65b301a` | database `no_bind_values_in_logs` (mutant → red); `verify-roles.sh` step 10 (log probe with positive control) |
| P2-6 keys destroyable / DR unusable | `5e149f6` | cell `lean_tier_plans` protected+replicated (mutant → red); `ci_cannot_reach_guest_money_keys` readers (mutant → red) |
| P2-7 unpinned images | `15966d4` | `supply-chain.test.mjs` (mutant → red); corepack wrong-hash refusal (manual) |
| P2-8 latest revision as template | `c168bc5` | deploy test "no task definition registered" + cell runtime_contract image tag |
| P2-9 NODE_ENV everywhere production | `5e149f6` | cell `staging_runs_development_mode_behind_the_guard` (mutant → red); env-guard keys test (mutant → red) |
| P2-10 Backup/SES cannot page | `5e149f6` | cell runtime_contract on-call publishers (mutant → red) |
| P2-11 no detective controls | `5e149f6` | `account-security/tests` (mutant → red) |
| P3-1 /0-only guard | `5e149f6` | cell runtime_contract "no range shorter than /8" |
| P3-3 drill cleanup / skip=pass | `44d71fd` | code: `restore-drill.sh` TERM trap, sweep, SKIPPED → incomplete (no automated test: needs AWS) |
| P3-4 confused deputy | `5e149f6`, `44d71fd` | code only (trust policies) |
| P3-5 SCRAM verifiers in DDL logs | `65b301a` | code only (`bootstrap-roles.mjs` `set log_statement = 'none'`; RDS permission unverified) |
| P3-6 no infra CI gate | `15966d4` | `ci.yml` job `infra` |
| P3-7 skopeo platform | `c168bc5` | deploy test (fake refuses copy without `--all`; mutant → red) |
| P3-8 `.env`, tfvars, npm in image | `15966d4` | code (`.dockerignore`, `infra/.gitignore`, Dockerfiles) |
| P3-9 copied allow-lists | `65b301a` | `definer-lists.test.mjs` (mutant → red) |
| P3-12 login rule only on full | `5e149f6` | code (`edge/waf.tf`) |
| Not fixed: P3-2 (CloudFront VPC origin), P3-10 (readiness register rows — outside infra scope), P3-11 (identity SCIM URL — cross-module) | — | — |

## Requests to other modules

| # | For | Request |
|---|---|---|
| 1 | payments + foundation | Serve the public Stripe webhook route with a `portico_worker` pool; then move `payments.route_webhook` to `workerOnly` and set `api_holds_worker_credentials = true` |
| 2 | packages/db | Create `portico_worker` in the development bootstrap; module migrations grant routing functions to it (listed in `infra/db/definer-registry.mjs`, never unlisted); run job tests as that role |
| 3 | finance | `finance.verify_trial_balance()` incl. folio projection (the drill calls it when present) |
| 4 | worker | outbox-stats and dead-delivery log lines; a heartbeat |
| 5 | kernel | KMS envelope encryption and key ids for field/seal key rotation |
| 6 | identity | SES staff-email adapter; IAM Identity Center for operators; key the operator console on `PORTICO_DEPLOYMENT`, not `NODE_ENV`; SCIM URLs from the public base URL (P3-11) |
| 7 | apps/api | real build step; `config.ts` comment on `TRUSTED_PROXY_CIDRS` (ALB + CloudFront ranges); payments: refuse `sk_live_` unless `PORTICO_DEPLOYMENT = production` (defense in depth behind the guard) |
| 8 | orchestrator | readiness register rows: infra technical R3 (offline), AWS R1 (P3-10); cost-model §4a lean figure now ≈ $163 with NAT |

## Owner decisions

Defaults are what the code does today; nothing is applied until Q4/Q22 are answered.

| # | Decision | Default in the code | Cost / risk if different |
|---|---|---|---|
| D1 | AWS account(s), permission to create paid resources (Q4a, Q22) | none; `allowed_account_ids` required | — |
| D2 | Primary region (Q4b) | `ap-south-1` | variable |
| D3 | Budgets: demo ceiling, production alert level (Q22) | demo $25 with stop action; production required (example $200), alert-only | — |
| D4 | Hosted demo now? | no | ≈ $15–20/month |
| D5 | Production tier for the first pilot (Q26) | **no default** | lean ≈ $163; resilient ≈ $410–540 (≈ $335 RDS Multi-AZ) |
| D6 | Lean egress (Q158) | **NAT gateway, private tasks** | `public_task_ips` saves ≈ $38/month; Security Hub ECS.2 |
| D7 | DR region for backups and key replicas (residency) | `ap-south-2`; key replicas on every production tier | — |
| D8 | Separate recovery account for drills | same account | small |
| D9 | Drill cadence | monthly + daily freshness | weekly ≈ 4× ~$1 |
| D10 | Domain and email sender | none | ≈ $15–50/year |
| D11 | Paging tool, who is on call, security emails (Q21) | email via SNS | tool cost |
| D12 | Staging always on vs on demand | on demand | always on ≈ $153/month |
| D13 | Stripe Connect platform account (Q2) | placeholders only | — |
| D14 | Channex production (Q23) | placeholder only, production-only | $137+/month |
| D15 | CloudFront flat-rate plan | pay-as-you-go | Pro $15/month |
| D16 | Operator access in production (IAM Identity Center) | console off in production | — |
| D17 | Break-glass role for the irreplaceable keys and who may use it (two people) | `role/portico-key-break-glass` (not created by Terraform) | — |
| D18 | Compliance-mode vault lock for production backups (irreversible) | governance mode | — |
| D19 | GitHub reviewers for staging/production (`envs/github`) | required input | — |
| D20 | Allow deploys from release tags (`allow_release_tags`) | main only | needs a tag-protection ruleset |

## Layout

```
infra/
  terraform/modules/   network, database, secrets, storage, registry, observability, compute, single-host, edge,
                       email, budgets, backup, restore-drill, ci-deploy-role, state-bootstrap, account-security, cell
  terraform/envs/      bootstrap (state, OIDC, account security), github (GitHub-side controls), demo, staging, production
  db/                  bootstrap-roles.mjs, definer-registry.mjs, definer-lists.test.mjs, verify-roles.sh
  ops/                 env-guard.mjs (+ test)
  restore-drill/       restore-drill.sh, verify.sql, Dockerfile, test/
  ci/                  deploy.yml.example, deploy-cell.sh, test/
  cost/                unit-prices-ap-south-1.json, estimate.mjs
docs/runbooks/         deploy, rollback, backup-restore-verification, incident-response, database-roles, disaster-recovery
```
