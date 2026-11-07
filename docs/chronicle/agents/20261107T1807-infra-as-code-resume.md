# Agent run: Infra-as-code (resume)

- Started: 2026-11-07T18:07:15.924Z · last activity: 2026-11-07T22:38:11.321Z
- Turns: 374 · tool uses: 393 · output tokens: 493,734
- Type: general-purpose

## Brief (2026-11-07T18:07:15.924Z)

````text
You are the infrastructure engineer for Portico, a cloud hospitality platform (repo /home/user/portico; read CLAUDE.md, docs/adr/0011-aws-deployment-topology.md, and docs/readiness/cost-model.md §4a, which defines tiers T0–T3). You are resuming a workstream whose first engineer's log was lost in a container restart. The committed work survives.

Your worktree is /home/user/wt/infra (branch feat/infra-aws). Your write scope is infra/**, docs/runbooks/**, apps/api/Dockerfile, apps/worker/Dockerfile and .dockerignore. Commit locally after each step; never push.

Start with:
1. `git merge main`. Main has moved a lot since your branch: identity, rates, payments, reservations, finance, operations, integration and the backoffice web app are merged.
2. Read infra/README.md § Checkpoint. It lists what is done, in progress and next.
3. Read the original brief: docs/chronicle/agents/20261107T0733-aws-infrastructure-as-code.md, on main.

**HARD RULE: deploy nothing.** No AWS credentials exist, and the owner has not authorized spend (OPEN_QUESTIONS Q4/Q22). Never run `terraform apply`, never create cloud resources, never call AWS APIs that change state. Only validate, test with mocked providers, and plan offline.

Finish the checkpoint's "In progress" and "Next" items:
- `terraform validate` for env roots bootstrap, demo, staging and production;
- `terraform test` with mocked providers planning every tier (demo, lean, resilient);
- README cost tables per tier from the verified ap-south-1 prices already downloaded. Label them estimates, with the publication date;
- `infra/ci/deploy.yml.example`;
- runbooks in docs/runbooks/: deploy, rollback, backup-restore verification, incident response, database roles, disaster recovery;
- an owner-decisions list.

Also wire in what main now requires (docs/orchestration/pending-fixes.md lists them):
- **`TRUSTED_PROXY_CIDRS`:** set the API env to the VPC CIDR, i.e. the ALB subnets. Never 0.0.0.0/0. Without it, per-IP rate limits throttle everyone together.
- **`PORTICO_TERMS_SEAL_KEY`:** a secret in Secrets Manager, required in production. Rates seals booking terms with it.
- **Field-encryption keys and blind-index keys:** check the env names in packages/kernel and packages/db, `fieldCryptoFromEnv`.
- **A `portico_worker` DB role:** for apps/worker and the public webhook route. Grant the SECURITY DEFINER routing functions (`payments.route_webhook`, `payments.tenants_for_jobs`, and any other module's job-routing functions) to it only, then update bootstrap-roles.mjs and its verification.
- **Whatever the merged modules need at runtime:** check every module's README and apps/api/src/config.ts for required env and secrets. Cover the payments simulator signing secret, the operator token (disabled in production per identity), SES for staff email and invitations, and DNS resolution for identity's SSO domain re-check job.

Docker: there is no Docker daemon here. Validate Dockerfiles statically and exercise the runtime layout outside Docker as the previous engineer did. Say clearly what was not built.

Before you report done, run the self-check in docs/quality/playbooks/module-builder-self-check.md where it applies to infra, and include its tables. Run `pnpm lint` and check the exit code.

Reply with:
- what is done;
- validation and test results;
- the cost estimate per tier;
- the owner decisions needed;
- exactly what was NOT verified.
````

## Follow-up message (2026-11-07T21:51:08.618Z)

````text
The coordinator sent a message while you were working:
The steward security review of feat/infra-aws says **merge after fixes** (P0 0 · P1 3 · P2 11 · P3 12).
- Report: docs/orchestration/reviews/review-infra.md on main.
- Evidence: docs/orchestration/reviews/infra-poc/.

Merge main first. Your write scope also covers .github/workflows/ci.yml for the items below.

Fix:
- **P1-1, deploy role least privilege.** The GitHub deploy role is effectively cell admin today.
  - Split it so the deploy role cannot read secret values or the RDS master password, and cannot run db-bootstrap with an overridden command.
  - Bootstrap and grants run as a separate task role whose definition only Terraform can change.
  - OIDC trust pins:
    - repository **id** and name `monoclay-studio/portico` (fix every `monoclay/portico` example);
    - the `ref` (main, or release tags);
    - the workflow file (`job_workflow_ref`);
    - the environment.
  - Make the runbook true, and test it: a policy simulation or terraform test asserting the denied actions.
- **P1-2, egress default.** Q158's default is **NAT gateway with private tasks** (the stricter posture), so make the lean tier default to that. Public task IPs stay as an explicit opt-in variable, with a warning about Security Hub ECS.2. Update the cost table, about +$45.
- **P1-3, the restore drill must actually run, and fail loudly.**
  - Build and push the drill image in the pipeline.
  - Alarm on "drill didn't run" (missing data counts as BREACHING), on image-pull failure and on task failure.
  - Test the alarm wiring.
- **P2s, all 11:**
  - **LIVE-key guard by value:** check the key prefix (`sk_live_`, `rk_live_`), not only the variable name, and cover Channex production and Monoclay billing keys.
  - **Definer functions:** an unreviewed cross-tenant definer function FAILS the grants phase; no warn-only.
  - **Operator read-only role:** no directory tables holding PII (staff mailbox, login IPs) unless audited, and make the runbook true.
  - **Drill checks:** catch `USING (true)` policies and grants to the worker role.
  - **Slow-query logs:** no bind values in Postgres logs. Use `log_parameter_max_length=0` and `log_parameter_max_length_on_error=0`, or equivalent, and keep a probe.
  - **Irreplaceable keys:** deletion protection, no force-delete, and recovery windows; make the cell module able to use the DR replica.
  - **Images:** pin base images by digest, and cover Dockerfiles and the tsx lockfile with dependabot.
  - **Pipeline:** deploy Terraform's task-definition revision, not the latest one.
  - **Environment:** NODE_ENV and PORTICO_DEPLOYMENT per environment, so the operator console behaves as the README says.
  - **SNS:** the topic policy lets AWS Backup and SES publish.
  - **Audit and threat detection:** a CloudTrail trail (org or account), GuardDuty, and alarms on destructive actions (KMS key deletion, RDS delete, secret delete, IAM changes).
- **main's ci.yml:** pin actions by SHA and add the infra checks:
  - terraform fmt, validate and test with the mocked provider;
  - the deploy-cell tests;
  - verify-roles, if it is feasible in CI.
- **P3s:** fix the cheap ones.

Process:
- Builder self-check v4: § 3 re-attack, and § 5 invariant closure for invariants like "no principal reachable from CI can read guest-money keys" and "a drill that didn't run always pages someone".
- Show that each new test fails without its fix.
- Never deploy and never rewrite pushed commits.

Gates: the infra checks plus `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`. Check the exit codes. Commit and don't push. Reply with finding → commit → test, and the results.

Address this before completing your current task.
````

## Report (2026-11-07T19:22:32.044Z)

````text
## Infra workstream (feat/infra-aws, worktree /home/user/wt/infra): done, nothing deployed

Every checkpoint item is finished, and so is the wiring main now needs. There are 12 commits, local only and not pushed (99ca8ab through 0facbba). I merged main three times. The last merge brought in identity-plus. The branch is up to date with main and the working tree is clean.

**Nothing was deployed.** I ran no `terraform apply`, made no AWS calls that change anything, and built no images.

**Toolchain change you should know about:** I moved the minimum Terraform version to **1.11**. I tested with Terraform 1.16.7, downloaded with its checksum and signature checked; it is in my scratchpad. The 1.9.8 binary in /home/user/tools no longer works. The upgrade lets every generated secret be written through write-only attributes, so **no DB password or app key is ever in Terraform state or plans**.

### What is done
- **Terraform validate and test:** 4 env roots and 16 modules validate. `terraform test` with a mocked AWS provider plans demo, lean, resilient and inactive staging, checks the runtime contract and 8 guard rails, plus a database-module test. 17 of 17 runs pass.
- **`TRUSTED_PROXY_CIDRS`:** set to the ALB subnet CIDRs **plus CloudFront's origin-facing ranges** (on the demo host, CloudFront ranges only). With the VPC CIDR alone, the CloudFront edge would count as the client, so the sign-in limit of 20/min would be shared by everyone behind one edge. A `/0` is refused, and I mutation-tested that.
- **Keys:** `PORTICO_FIELD_KEY`, `PORTICO_BLIND_INDEX_KEY`, `PORTICO_TERMS_SEAL_KEY` and a shared `PAYMENTS_SIMULATOR_SIGNING_SECRET` are generated into Secrets Manager. They are injected into **both api and worker**, because both run `compose()`. On the resilient tier the three irreplaceable keys are replicated to the DR region.
- **`portico_worker` role:** a group role with blue/green logins; the worker connects with it. A new `bootstrap-roles.mjs grants` phase runs as the owner after every migration. It grants 19 routing functions to the worker and revokes 18 job-only ones from `portico_app`. It verifies with `has_function_privilege` and flags any SECURITY DEFINER function nobody has reviewed. `payments.route_webhook` stays on `portico_app` until the API serves that route through a worker connection pool.
- **Other runtime needs:**
  - `PORTICO_APP_BASE_URL` and SES env and permissions for staff email.
  - Stripe Connect TEST/LIVE placeholders. LIVE keys are refused outside production, and billing keys can never be injected as `PAYMENTS_*`.
  - `OPERATOR_TOKEN`/`PORTICO_OPERATORS` are refused in production and not created there.
  - DNS for the SSO domain re-check works through the VPC resolver (asserted in tests).
- **Lean egress changed:** the old design used interface endpoints, which reach AWS APIs only. Stripe, identity providers and webhooks would have failed. Lean tasks now get public IPs with inbound allowed only from the ALB. This is cheaper but trips AWS Security Hub check ECS.2; a NAT override is available. I also removed resilient's redundant endpoints, which cost about $114/month.
- **Bugs found and fixed:**
  - The RDS master defaulted to `portico_master`. The bootstrap and the restore drill reject any privileged `portico_*` role, so the first real bootstrap on RDS would have failed. The default is now `dbmaster`, with a validation and a test.
  - The restore drill failed on main's schema because `integration.tenant_schedule` was not on the reviewed list of tables with RLS enabled but not forced. It is now listed.
  - identity-plus added 19 SECURITY DEFINER functions. Each was reviewed and classified: 3 worker-only jobs, 16 used by the API.
- **Pipeline and runbooks:**
  - `infra/ci/deploy.yml.example` runs verify, builds the images once, then per cell over OIDC: push with digests preserved, migrations, grants, worker, api, smoke test, automatic rollback, web app. Production needs a reviewer. Every action is pinned to a commit SHA.
  - `infra/ci/deploy-cell.sh` does the per-cell work.
  - Six runbooks are in `docs/runbooks/`.
  - Cost tables are in the README; you can regenerate them with `node infra/cost/estimate.mjs`.
  - The owner decisions list is in `infra/README.md`.

### Validation and test results
- **Role model:** `infra/db/verify-roles.sh` passes 38 of 38 checks on a separate SCRAM-auth Postgres 16, which I removed afterwards. It used the production runtime layout: `pnpm deploy --prod`, pinned tsx, read-only files. It ran 19 migrations as a non-superuser owner and the grants phase, including concurrent runs. The API was ready as `portico_app_blue` and refused to start without the seal key. All 15 worker jobs ran as `portico_worker_blue` with none failing, and the worker was refused when run as the app role. The drill SQL passed, and caught a planted re-grant and a planted unbalanced journal entry.
- **Deploy script:** `infra/ci/test/deploy-cell.test.sh` passes 27 of 27 against a fake AWS CLI, a fake skopeo and a local HTTP server.
- **Gates after the final merge:** `pnpm lint` exit 0; typecheck --force exit 0; `pnpm test` exit 0; `turbo run test --force` exit 0.
  - Before that merge, the turbo run failed twice at load average about 42. Two `apps/api` demo-seed tests hit their 30 s timeout (30.2 s and 30.5 s). This branch changes no app code, so it looks like load-sensitive timing in main's tests.

### Self-check (module-builder-self-check v3)

**§1 gate block**

| Gate | Exit |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm lint` | 0 |
| `pnpm turbo run typecheck --force` | 0 (18/18) |
| `pnpm test` | 0 (16/16) |
| `pnpm turbo run test --force` | 0 on the final tree; exit 1 twice before it (timeouts above) |

**§2 checklist (items 5–32):** 14 yes, 14 N/A, 0 no.
- **Yes:**
  - 9, 11: advisory lock plus a concurrency test.
  - 10: immutable tags with digest checks.
  - 12: grants and their verification in one transaction.
  - 14, 15: database steps before services; a failed rollout or smoke test triggers rollback and never reports success.
  - 20: the real API and worker ran with the Terraform-shaped environment.
  - 21: the fakes refuse calls they do not handle.
  - 23: guard rails tested.
  - 25: LIVE keys and operator tokens refused; demo DNS firewall.
  - 27: trusted proxies, never `/0`.
  - 30: no secrets in state or on command lines.
  - 31: README claims cite tests.
  - 32: readiness R2–R3 for code, R1 for AWS.
- **N/A:** items about tenant tables, routes, money, events, data authority, SSRF and erasure, which infra does not own.

**§3 defects fixed this session**

| Finding | Commit | Regression test | Siblings checked | Failure path |
|---|---|---|---|---|
| `portico_master` breaks bootstrap and drill on RDS | 0b68620 | database `portico_prefixed_master_refused` | bootstrap step 6, verify.sql check 4, verify-roles | validation refuses before plan |
| Lean has no third-party egress | 99ca8ab | `lean_tier_plans` | demo, resilient, inactive staging | n/a |
| Guard rails broke `terraform test` | 99ca8ab | 3 expect-failure runs | all preconditions | n/a |
| Null base URL crashed the demo plan | 99ca8ab | `demo_tier_plans` | single-host template | n/a |
| Drill failed on `integration.tenant_schedule` | a4ac7a8 | verify-roles step 7 | core.outbox, core.event_deliveries | drill refuses |
| 19 unreviewed identity-plus functions | 55cc43a | drift check + drill check 7 + re-grant negative | all SECURITY DEFINER functions | grants roll back unless verified |

The griefing question: a migration that re-grants a function to `portico_app` is revoked again on the next deploy and caught by the drill. Reverse-order and atomic-limit checks do not apply.

**§4 contract integrity:** N/A, no module code touched.

### Cost estimate per tier
Estimates only, ap-south-1. Prices come from the AWS Price List files downloaded 2026-11-07; publication dates are 2026-09-11 to 2026-11-07, recorded per service. No free tier, credits or taxes.

| Tier | ≈ $/month |
|---|---:|
| T0 local | $0 |
| T1 demo, office hours | $15 |
| T1 demo, always on | $20 |
| T2 lean production pilot | $121 |
| Staging, off (default) | $0.30 |
| Staging, one 2-day rehearsal | $8 |
| Staging, always on | $108 |
| T3 resilient, quiet | $407 |
| T3 resilient, busy | $538 |
| T3 with RDS Multi-AZ instead of Aurora | $334 |

Channex, the domain and support plans are excluded.

### Owner decisions needed
Full list (D1–D16) is in `infra/README.md`. The main ones:
- AWS account and permission to spend (Q4, Q22); the region.
- Demo budget, and whether to host a demo now.
- **Production tier: lean or resilient.** There is deliberately no default.
- Lean egress: public task IPs, or a NAT gateway for about $45 more.
- DR region and residency (default ap-south-2).
- A separate recovery account for restore drills.
- Restore-drill cadence: monthly now, weekly is the support-plan target.
- Domain and email sender.
- Paging tool and on-call (Q21).
- Staging always on or on demand.
- Stripe Connect (Q2) and Channex (Q23).
- CloudFront flat-rate plan instead of pay-as-you-go.
- IAM Identity Center for operator access in production.

These live in the README because docs/OPEN_QUESTIONS.md is outside my write scope. Please copy them over. cost-model §4a still says lean uses VPC endpoints; it needs updating to match.

### Exactly what was NOT verified
- Any `terraform plan` or `apply` against AWS. That includes AWS-side checks, IAM policies, quotas, availability of engine version 16.10, ACM/DNS validation and WAF capacity.
- **No image was built**, since there is no Docker daemon. Image size and the `node:22.23.4-slim` digest are unchecked.
- ECS behaviour: circuit breaker, deployment alarms and wait timings.
- The restore drill against a real snapshot, so RPO/RTO are not measured; every figure stays a TARGET.
- SES sandbox exit, CloudFront→ALB TLS, the budget stop action.
- The GitHub workflow has never run. I could not confirm that GitHub accepts the YAML anchor it uses, or that skopeo is on the runner image.
- RDS-specific role behaviour: `rds_superuser`, IAM auth for `portico_ops_readonly`.
- The SSO re-check job ran, but no domains were due, so no real DNS TXT lookup happened.
- Creating a DR-region cell is a written procedure, not automated.

### Requests to other modules (README § Requests)
- **payments:** serve the webhook route through a worker connection pool. Then set `api_holds_worker_credentials = true`.
- **packages/db:** create `portico_worker` in the dev bootstrap and run job tests as that role.
- **finance:** provide `verify_trial_balance()`, including folio projection.
- **worker:** emit the outbox-stats log line and a heartbeat.
- **kernel:** key rotation and KMS envelope encryption.
- **identity:** an SES adapter for staff email.
- **apps/api:** add a build step, and fix the `TRUSTED_PROXY_CIDRS` comment in config.ts.

````

