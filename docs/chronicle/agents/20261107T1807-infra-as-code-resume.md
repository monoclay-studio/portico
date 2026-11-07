# Agent run: Infra-as-code (resume)

- Started: 2026-11-07T18:07:15.924Z · last activity: 2026-11-07T22:49:37.790Z
- Turns: 392 · tool uses: 414 · output tokens: 511,075
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

## Report (2026-11-07T22:49:37.670Z)

````text
## Infra security fix round: all 3 P1 and all 11 P2 fixed, plus 8 of 12 P3; every gate exit 0

Branch `feat/infra-aws` in `/home/user/wt/infra`, merged with the latest main (which includes identity-plus and round-3 quality). Committed, not pushed, no commits rewritten. Nothing deployed: no `terraform apply`, no AWS call that changes state. Docker images are still not built (no daemon). The four P3s left open are listed under "Not done".

### Finding → commit → test
Every test named below was shown to fail with its fix removed, either by a mutant run or by running the pre-fix scripts.

| Finding | Commit | Test (red without the fix) |
|---|---|---|
| **P1-1** deploy role was admin-equivalent; trust pinned only the repo name and environment | `c168bc5` (+ `5e149f6`) | `ci-deploy-role/tests/least-privilege.tftest.hcl`, 6 runs (mutants: PassRole/RunTask added back; trust by name only); cell `ci_cannot_reach_guest_money_keys`; deploy test "no task definition registered…"; `envs/github` tests (3) |
| **P1-2** lean egress default contradicted Q158 | `5e149f6` | cell `lean_tier_plans` (mutant `lean="none"`); `lean_public_task_ips_is_an_explicit_opt_in`; `public_task_ips_refused_on_resilient` |
| **P1-3** drill never ran and nobody was told | `44d71fd` | `restore-drill/tests/fails-loudly.tftest.hcl` (mutant: notBreaching); `event-pattern.test.mjs` (mutant: no missing-exit-code branch); cell backup missing-job alarms (mutant) |
| P2-1 LIVE-key guard checked names only | `15966d4`, `5e149f6` | `env-guard.test.mjs` "staging refuses a LIVE Stripe key under the TEST name" (mutant); cell `live_key_under_a_test_name…`, `channex_production_and_billing_keys…` (mutant) |
| P2-2 unreviewed definer function only warned | `65b301a` | `verify-roles.sh` step 8 (3 checks fail with the pre-fix scripts) |
| P2-3 ops read-only role reached directory PII | `65b301a` | `verify-roles.sh` step 9 (2 checks fail pre-fix) |
| P2-4 drill missed policy and worker defects | `65b301a` | `verify-roles.sh` step 7: 7 planted defects, all missed pre-fix |
| P2-5 PII in Postgres logs | `65b301a` | database `no_bind_values_in_logs` (mutant); `verify-roles.sh` step 10, a log probe with a positive control |
| P2-6 keys could be destroyed or replaced; DR replica unusable | `5e149f6`, `43c56e1` | cell: protected and replicated keys, exact resource-policy statements, reader list (3 mutants) |
| P2-7 base images and pnpm unpinned | `15966d4` | `supply-chain.test.mjs` (mutant); corepack accepts the right hash and refuses a wrong one (manual) |
| P2-8 pipeline used the latest task-definition revision | `c168bc5` | deploy test "no task definition registered" (mutant) |
| P2-9 NODE_ENV and PORTICO_DEPLOYMENT per environment | `5e149f6` | cell `staging_runs_development_mode_behind_the_guard` (mutant); env-guard key test (mutant) |
| P2-10 Backup and SES could not page | `5e149f6` | cell on-call publishers assertion (mutant) |
| P2-11 no CloudTrail, GuardDuty or destructive-call alarms | `5e149f6` | `account-security/tests` (mutant) |
| P3-1, P3-3, P3-4, P3-5, P3-6, P3-7, P3-8, P3-9, P3-12 | various | P3-1: cell `/8` assertion (its mutant run was confounded, so no clean red proof). P3-6: `ci.yml` `infra` job. P3-7: deploy test, which refuses a copy without `--all` (mutant). P3-9: `definer-lists.test.mjs` (mutant). P3-3, P3-4, P3-5, P3-8 and P3-12 are code only, no test. |

**Not done:**
- P3-2 (a CloudFront VPC origin): too large for this round.
- P3-10: the readiness register is outside my write scope.
- P3-11: identity's SCIM URL is cross-module.
- P3-6 is only partly done: the infra job runs in CI, but the deploy test has no explicit grants-failure case (a failed init container only shows up as a failed rollout, which is tested).

### What changed in substance
- **Deploy role (P1-1).**
  - It can now only push to the cell's image repositories and move the one mutable tag, `release` (the repositories use `IMMUTABLE_WITH_EXCLUSION`).
  - It can force new deployments of the task definitions Terraform registered, read the deploy-config parameter, publish the web app and read logs under `/portico/<prefix>/*`.
  - It has no PassRole, RunTask, RegisterTaskDefinition, Secrets Manager, KMS or `AWS-RunShellScript`. The demo host gets an SSM document whose parameters SSM validates.
  - Migrations and grants run as init containers of every api task, as `portico_owner`. The role bootstrap is a human break-glass step.
  - The trust policy matches one exact OIDC subject with StringEquals: owner id, repository id, environment, `ref=refs/heads/main` and `job_workflow_ref=deploy.yml`.
  - The new root `envs/github` codifies the GitHub side: the subject template, environments limited to main with reviewers and no self-review, and branch protection.
  - The role is still as powerful as the code it deploys. That is stated in the README and runbooks, not hidden.
- **Lean tier egress (P1-2).** Defaults to one NAT gateway with private tasks. Public task IPs are a lean-only opt-in that raises a warning.
- **Restore drill (P1-3).**
  - It runs the release's own image.
  - A daily freshness task publishes the evidence age; the alarm fires at more than 35 days or when no datapoint arrives (missing data counts as breaching).
  - A stop rule pages on TaskFailedToStart, a non-zero exit code or no exit code at all.
  - A TERM trap deletes the restored copy, and a daily sweep removes orphaned copies.
  - A skipped check is treated as a failure.
  - AWS Backup now has missing-job alarms for both backups and DR copies.

### Gates (final merged tree)
- `pnpm lint`: exit 0. Main now runs `--error-on-warnings`; one warning was fixed in `ca3d708`.
- `pnpm turbo run typecheck --force`: exit 0, 18/18.
- `pnpm turbo run test --force --concurrency=2`: exit 0, 16/16.
- `terraform fmt -check`: exit 0. `validate`: 22/22 (5 env roots, 17 modules).
- `terraform test`: 38/38 (cell 21, ci-deploy-role 6, database 3, restore-drill 3, account-security 2, envs/github 3).
- `node --test` infra unit tests: 20/20.
- `deploy-cell.test.sh`: 28/28.
- `verify-roles.sh`: 53/53 on a throwaway SCRAM Postgres 16.15 with the production runtime layout. In source mode, as CI runs it, 51/51 plus 1 SKIP (the log probe needs `PG_LOG_FILE`).
- `.github/workflows/ci.yml` now pins every action by SHA and has an `infra` job running fmt, validate, test, the unit tests, `deploy-cell.test.sh` and `verify-roles.sh` (Postgres service with SCRAM). It has never run on GitHub.

### Self-check v6

**§3 re-attack**

| Finding | (a) reverse | (b) siblings checked | (c) failure path | (d) griefing |
|---|---|---|---|---|
| P1-1 | a squatted name or re-created repo fails closed: the repository id differs | demo SSM document; drill scheduler (the only PassRole/RunTask left, service-assumed); humans with the infra role (out of scope, alarmed by P2-11) | migrate fails → api never starts → tags roll back (test) | a reviewer can stall a deploy (accepted) |
| P1-3 | drill disabled or schedule deleted → the stale alarm still fires | DR copy jobs (missing-job alarms); freshness task broken → missing data | killed drill → TERM trap deletes the copy, sweep catches leftovers | none |
| P2-2 | unreviewed function granted only to the worker → also caught | `verify.sql` check 7, both groups; demo `portico.sh` (same script) | revocations committed, then exit non-zero; app and worker then refused (test) | a migration re-granting a function is revoked on the next deploy |

**§5.1 state machine: restore drill**

| From | To | Trigger | Pages? (test) |
|---|---|---|---|
| scheduled | started | scheduler RunTask | — |
| scheduled | failed to start | image pull, capacity, IAM | **yes**, stop rule TaskFailedToStart / no exit code (`event-pattern` tests) |
| started | passed | all checks pass, `…-passed.json` written | resets freshness age |
| started | failed | restore or check fails | **yes**, failure alarm plus stop rule non-zero exit (`fails-loudly`) |
| started | incomplete | a check prints SKIPPED | **yes**, exit 1 → failure (code only) |
| started | killed | SIGTERM from ECS | stop rule, copy deleted (code only) |
| never scheduled / freshness broken | — | — | **yes**, stale alarm, missing = breaching (`fails-loudly`, mutant red) |

The AWS Backup daily backup and DR copy jobs get the same rule: no completed job in 2 days, or no datapoint at all, pages on-call (cell assertion, mutant red).

**External holders.**
- ECR holds the `release` tag. ECS resolves it to a digest once per deployment, so a rollback moves the tag back and redeploys.
- AWS-side behaviour (ECS version consistency, the init-container ordering, the `ecs:task-definition` condition key on UpdateService) is modelled only by the fake AWS CLI. That closure is **unproven** until the first apply.

**Pasted searches.**
- `grep -rn "iam:PassRole\|ecs:RunTask\|ecs:RegisterTaskDefinition" infra/terraform/modules` → only `restore-drill/main.tf:233,237` (the drill scheduler service role).
- `grep -rn "secretsmanager:GetSecretValue" …` → `compute/iam.tf:83` (execution roles) and `secrets/main.tf:238` (the resource-policy Deny for everyone else).
- Writers of the `release` tag → only `deploy-cell.sh:133`.

**Control-fact grid: OIDC trust**

| Path | repository id | owner id | environment | ref | workflow file |
|---|---|---|---|---|---|
| `sts:AssumeRoleWithWebIdentity` | `ci-deploy-role/main.tf` subject string | same | same | same, StringEquals | same |
| GitHub side | `envs/github` subject template | same | environments main-only, reviewers | branch protection | — |

**§5.2 invariants**

| Invariant | Writers checked | Concurrency | Test |
|---|---|---|---|
| No principal reachable from CI can read guest-money or encryption keys | deploy role policy; resource policies on app keys and payment secrets; execution-role names | n/a (IAM is static) | `ci_cannot_reach_guest_money_keys`, least-privilege (mutants red) |
| A drill that didn't run always pages | drill schedule, freshness schedule, image tag, alarms, stop rule | n/a | `fails-loudly`, `event-pattern` (mutants red) |
| No unreviewed cross-tenant definer function reachable by a login group | migrations, the grants phase, `verify.sql` | advisory lock, two concurrent runs tested | `verify-roles` 7–8 (pre-fix red) |

**§5.4 mutation.** 25 mutants in total:
- 24 turned their test red. The 23 listed in the README, plus a key resource-policy mutant (`43c56e1`) added after it.
- 1 stayed green: removing the `TaskFailedToStart` branch. That event is still matched by the "no exit code" branch, so the branch is redundant rather than untested.
- Separately, the pre-fix database scripts fail 13 of the role-model checks.

**§6 claim ledger.** The grep found 134 hits across the README and 6 runbooks. I triaged them; these were wrong and are now rewritten:
- `database-roles.md:15` said the owner is "not used at runtime". Now: init containers use it; the api and worker never receive its URL (cell assertion).
- `deploy.md` (deploy-role powers): now backed by the least-privilege test.
- The ops-role and "unreviewed definer warns" lines: rewritten to match `verify-roles` steps 8–9.
- `incident-response:51`: the ops role is status-only.
- `backup-restore-verification` paging claims: now backed by `fails-loudly` and the cell backup alarms.

Kept as planned or code-only: TERM cleanup, the SourceAccount conditions, `log_statement=none` (RDS permission unverified), ALB access logs keeping query strings for 90 days (now disclosed in the new README section on personal data in logs).

**§2 checklist:**
- **Yes:**
  - 9, 11 (advisory lock, concurrent runs).
  - 10 (immutable SHA tags, digest checks).
  - 12 (grants and their verification in one transaction).
  - 14, 15 (rollout and smoke failures roll back).
  - 20, 21 (the real API and worker run in the runtime contract; the fakes refuse unhandled calls).
  - 23 (variable validations).
  - 25 (env guard, LIVE-key validation).
  - 26 (the OIDC repository and owner ids are immutable).
  - 27 (trusted proxies never shorter than /8).
  - 29 (no bind values in Postgres logs).
  - 30 (write-only secrets, nothing on command lines).
  - 31, 32 (README claims cite tests; readiness stays R3 code / R1 AWS).
- **No:** item 29 partly — ALB access logs keep query strings for 90 days, which erasure does not reach.
- **N/A:** items about money, events, port scope and the UI.

### Cost (estimates)
- Lean is now ≈ **$163/month**, because the NAT default adds about $45 and drops $7 of task IPs. With the public-IP opt-in it is ≈ $124.
- Staging: about $0.30 off, $11 for a 2-day rehearsal, $153 always on.
- Resilient: about $408 quiet, $539 busy, or $335 with RDS Multi-AZ.
- Per account (CloudTrail plus alarms): about $0.05. GuardDuty is usage-based and not in the price files I have.
- Demo is unchanged at $15–20.

### New owner decisions
- **D17:** the break-glass role for the irreplaceable keys and which two people may use it.
- **D18:** compliance-mode vault lock for production backups (it can never be undone).
- **D19:** GitHub reviewers for staging and production.
- **D20:** whether release tags may deploy.
- **D6 (Q158) now defaults to NAT.**
- **cost-model §4a:** the lean figure there needs updating to ≈ $163.

### Not verified
- Any AWS evaluation of the new policies: the `ecs:task-definition` condition on UpdateService; `IMMUTABLE_WITH_EXCLUSION`; the Secrets Manager DeleteSecret condition keys; whether Terraform's refresh needs GetSecretValue (I kept the Terraform role as a reader just in case).
- ECS init-container ordering and the version consistency of the `release` tag.
- The exact format of GitHub's customized OIDC subject on a real run.
- The AWS/Backup metric dimensions.
- EventBridge matching on real ECS events (I tested the pattern only with a local matcher).
- RDS allowing `SET log_statement`.
- Image builds and skopeo on the deploy runner image.
- The `ci.yml` `infra` job on GitHub.
- GuardDuty cost.
- First deploy ordering is awkward: the first release fails at the api, a person runs `db-bootstrap`, then the release is re-run. This is documented in `deploy.md`.

The full finding → commit → test table and the personal-data-in-logs section are in `infra/README.md`.

````

