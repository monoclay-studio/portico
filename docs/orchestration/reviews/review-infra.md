# Steward review — infra (AWS IaC, images, DB role model, CI deploy) — security-focused

| | |
|---|---|
| **Verdict** | **merge after fixes** (3 P1 to fix before merge; P2s tracked, most before the first real `apply`) |
| **Branch / commit reviewed** | `feat/infra-aws` @ `0facbba36ccb6e82604ff4fb892c883968cf91a7` |
| **Scratch copy** | detached worktree of `0facbba`, merged with `main` @ `2b1d1a6` (local merge `93cb2ea`). `main` moved to `434e105` during the review (docs + `tools/demo-authenticator.mjs` only), so no re-merge was needed |
| **Playbook** | steward-reviewer v2.1 (launch brief v2) |
| **Counts** | **P0 0 · P1 3 · P2 11 · P3 12** |
| **Patterns** | 57 in groups A–E: 38 applicable, of which 16 probed, 20 code-read and 2 applied as review steps (AP-45, AP-54); 0 applicable left unprobed; 19 not applicable (with reasons) |
| **PoCs** | `docs/orchestration/reviews/infra-poc/*.txt` (listed in § Evidence) |

Nothing here has been deployed. No AWS call was made, and none was possible (no credentials). Every AWS-side
statement below is either code-read against documented AWS behaviour or reproduced locally, and each one says which.

---

## 1. Command results (scratch copy, exit codes captured, `PORTICO_TEST_DB_PREFIX=review_infra`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | exit 0 (biome: 810 files; module boundaries OK) |
| `pnpm turbo run typecheck --force` | exit 0 (18/18, 0 cached) |
| `pnpm turbo run test --force --concurrency=2` | exit 0 (16/16 packages, 0 cached, 2 m 37 s) |
| Terraform 1.16.7 (`terraform_1.16.7_linux_amd64.zip`: sha256 matches SHA256SUMS; SHA256SUMS signed by HashiCorp key `C874 011F 0AB4 0511 0D02 1055 3436 5D94 72D7 468F`; binary identical to the zip) | — |
| `terraform validate`: 4 env roots + 16 modules (offline provider mirror; env roots' committed lock files verified the hashes) | **20/20 valid**; `terraform fmt -check -recursive` clean |
| `terraform test`: `modules/cell` / `modules/database` | **15/15** / **2/2** pass |
| `infra/db/verify-roles.sh` on **my own** throwaway SCRAM-auth PostgreSQL 16.15 (port 55461) | **38/38**, exit 0 |
| `infra/ci/test/deploy-cell.test.sh` | **27/27**, exit 0 |
| Extra: 7 pinned action SHAs vs their tags (`git ls-remote`) | 7/7 match |
| Extra: RDS CA bundle `global-bundle.pem` sha256 | matches the Dockerfile pin `90a6f1a7…f21b` |
| Extra: production runtime layout (`pnpm deploy --prod` + lockfile tsx), API and worker under `strace` | **no file writes** (open-for-write, mkdir, rename and unlink all absent); `/health/ready` = ready, `/v1/me` = 401; worker started with no errors |

---

## 2. Findings (ranked)

### P1

**P1-1 · The CI deploy role is administrator-equivalent for its cell, the runbook says the opposite, and the trust
policy pins only a repository name and an environment name** (AP-09, AP-08, AP-03, AP-10, AP-50)

- **Where:** `infra/terraform/modules/ci-deploy-role/main.tf:25-43` (trust), `:81-121` (permissions);
  `modules/cell/main.tf:286`; `modules/compute/iam.tf:16-36`, `main.tf:288-323`; `docs/runbooks/deploy.md:20-21` and
  `:48-50`; `envs/*/terraform.tfvars.example`; `modules/cell/tests/tiers.tftest.hcl:53`.
- **Problem:** the runbook states: "The deploy role cannot … read secret values or touch the database directly; it can
  only run the task definitions Terraform registered". The policy grants three things together:
  - `ecs:RegisterTaskDefinition` on `*`;
  - `ecs:RunTask` (overrides allowed) on `task-definition/<prefix>-*`;
  - `iam:PassRole` on **every** task and execution role of the cell, including `<prefix>-db-bootstrap-exec`, which
    injects the RDS master password and the owner, app and worker DB secrets.

  Together with `logs:FilterLogEvents` on `*`, one `run-task` with a command override prints `MASTER_PASSWORD`, and
  the role can then read it back (chain A in `infra-poc/ci-deploy-role-equivalence.txt`). A registered revision with
  any image and the api execution role exfiltrates the field, blind-index and seal keys and every injected provider
  key (chain B). The role can also make the **first** push of the immutable `restore-drill:latest-drill` tag, which
  nothing else ever pushes, so it decides what the monthly drill runs with production-restore rights (chain C, AP-47).

  Who can obtain the role: any workflow job in `repo:<name>` whose job declares the environment. Nothing pins the
  branch or ref, the workflow file (`job_workflow_ref`) or the immutable `repository_id` / `repository_owner_id`. The
  GitHub-side controls (required reviewers, deployment-branch policy, "prevent self-review") are not codified, and the
  runbook asks only for reviewers on production. **Reverse order (AP-08):** every example and the test use
  `monoclay/portico`, while this repository is `github.com/monoclay-studio/portico`. Whoever controls the `monoclay`
  namespace on GitHub (not checkable from here) would satisfy a trust policy copied from the example.
- **Why it matters:** the owner will decide who may approve deploys based on a statement that is false. In practice
  this role is the RDS master plus every secret in the cell, and a write-access user may be able to obtain it from an
  unmerged branch if the environment allows it.
- **Fix (principle):** the deploy identity is as powerful as the cell it deploys. Therefore it must be obtainable
  **only** by reviewed code on `main`, through a protected environment, from the real repository identified by an
  immutable id, and the docs must call it administrator-equivalent. Instances:
  1. a customized OIDC subject (`repository_id`, `repository_owner_id`, `environment`, `ref`, `job_workflow_ref`),
     matched exactly with `StringEquals`;
  2. GitHub environments `staging` and `production`: deployment branches = `main` only, required reviewers,
     prevent self-review. Record them as launch-gate evidence, or codify them with the `github` provider;
  3. take `db-bootstrap` out of CI: no `PassRole` on its execution role. Role bootstrap and rotation become a human
     break-glass step;
  4. scope `logs:*` reads to `/portico/<prefix>/*`, and `ecr:PutImage` to the repositories the pipeline really
     pushes;
  5. use the real repository in examples and tests;
  6. correct `deploy.md:20-21`.
- **Attack run against the fix:**
  - A merged malicious PR still deploys; that is inherent, and it is bounded by branch protection on `main`.
  - A deleted and re-created repository gets a new `repository_id`, so the trust fails closed. A name-squatter
    cannot match the id.
  - A changed OIDC subject template fails closed under `StringEquals`.
- **Sibling paths (same power):**
  - demo `ssm:SendCommand` + `AWS-RunShellScript` (root on the demo host; sample data);
  - humans with `ecs:RunTask` + `PassRole`;
  - the restore-drill image push (P1-3);
  - the `migrate` task (portico_owner), which CI legitimately needs. State it as such.
- **Load-bearing (AP-54):** the fix relies on branch protection for `main` and on the GitHub environment rules, and
  neither is codified or evidenced today. Both are re-rated into this P1 as launch prerequisites.

**P1-2 · The recorded default for lean egress (Q158: NAT gateway with private tasks) contradicts the code (public
task IPs)** (AP-50)

- **Where:** `docs/OPEN_QUESTIONS.md` Q158, "Default we are proceeding with: … **NAT gateway** (private tasks) for the
  stricter security posture"; `modules/cell/locals.tf:323` (`nat_mode lean = "none"`), `:380`; `infra/README.md` D6
  ("public task IPs"); the cost tables (lean ≈ $121 excludes NAT).
- **Problem:** if the owner approves "the defaults", the code deploys the weaker posture, which Security Hub ECS.2
  flags and Q158 describes as the non-default.
- **Fix:** make code and record agree. Per CLAUDE.md §1 (conservative and reversible), set the lean preset to
  `nat_mode = "single"` (private tasks) and update the tests, README D6 and the cost tables (+≈ $45). Otherwise the
  orchestrator corrects Q158.
- **Attack run against the fix:** with private tasks, `TRUSTED_PROXY_CIDRS` (the public subnets) no longer contains
  the tasks' own subnet, which is better. The NAT gateway in a public subnet cannot originate inbound traffic to the
  API, whose security group admits the ALB only.
- **Siblings that must follow the same egress mode:** `modules/restore-drill/main.tf:230-235` hard-codes public
  subnets + `assign_public_ip = true`; the deploy-config `ops_subnets` already follow the task subnets.

**P1-3 · As written, the monthly restore drill never runs and nobody is told** (AP-26, AP-29, AP-41, AP-50, AP-57)

- **Where:**
  - `modules/restore-drill/variables.tf:80-83` (`image_tag = "latest-drill"`), never overridden
    (`modules/cell/main.tf:233-256`);
  - no pipeline builds or pushes `infra/restore-drill/Dockerfile` (`deploy.yml.example:95`, `deploy-cell.sh:95`);
  - ECR tags are IMMUTABLE (`modules/registry/main.tf:8`);
  - `modules/restore-drill/main.tf:258-271` (paging rule) and `:244-256` (alarm `notBreaching`).
- **Problem:**
  - The first scheduled run cannot pull its image, so the task stops with `TaskFailedToStart` and **no container exit
    code**.
  - The rule whose comment promises that "a drill task that dies before it can publish a metric (bad image, no
    capacity) still pages someone" matches only `containers.exitCode anything-but 0`. EventBridge does not match
    events that lack the field.
  - No metric is ever published, so the failure alarm stays OK, and nothing alarms on a missing success.
  - Even a manual `latest-drill` push can never be updated, so the drill's `verify.sql` (check 7's allow-list)
    drifts from the release and starts failing falsely.
  - Evidence: `infra-poc/restore-drill-silent.txt`.
- **Why it matters:** "a backup counts only when a restore of it has been verified" (readiness brief §17). The README
  tier table and `backup-restore-verification.md` present the drill as running and paging.
- **Fix (principle):** the absence of fresh drill evidence must page, whatever the cause. Instances:
  1. an alarm or scheduled check on the age of the last `RestoreDrillSuccess` or evidence object (more than 35 days
     → page);
  2. the stopped-task rule also matches `stopCode` `TaskFailedToStart` and any `STOPPED` task of the family without
     `"passed"` evidence;
  3. build and push `restore-drill:<sha>` every release, and point the drill task definition at the release tag
     through a reviewed Terraform apply (not the CI role: see P1-1).
- **Attack run against the fix:** if CI registered the drill task definition, CI would need `PassRole` on the drill
  roles, which can restore production and reset its master password. That widens P1-1, so the tag change goes
  through the human apply. The freshness alarm still catches a stale tag.
- **Sibling silent monitors:** P2-10 (Backup and SES cannot publish to on-call); the outbox alarms stay
  `INSUFFICIENT_DATA` until request #4 (already disclosed honestly).

### P2

**P2-1 · The "LIVE keys only in production" guard checks only the variable name. Staging accepts the LIVE Stripe
Connect key under the TEST name** (AP-44, AP-57, AP-35, AP-19)

- **Where:** `modules/cell/variables.tf:213-216`; mapping at `modules/compute/main.tf:46`; consumer
  `modules/payments/src/providers/registry.ts:115`.
- **Proof:** `infra-poc/live-key-guard-bypass.txt`. In staging, `{ PAYMENTS_STRIPE_SECRET_KEY_TEST =
  "payments-stripe-connect-secret-key-live", PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST = "…-webhook-secrets-live" }` plans
  without error and reaches both tasks. Non-live tenants on staging would then move real money through Monoclay's live
  Connect platform.
- **Siblings the guard never covers:** `channex-api-key` (production activation, Q23) and `stripe-billing-*`, both
  injectable into staging under any non-`PAYMENTS_` name. The operator guard checks both names and keys; this one
  checks one side only.
- **Fix (principle):** no non-production deployment may hold a credential that can move real money or reach a live
  third party, whatever the variable or secret is named. Instances:
  1. the guard checks both the env name **and** the secret key against a "live-capable" set (`*-live`, `channex-*`,
     `stripe-billing-*`);
  2. the app refuses `sk_live_` / `rk_live_` keys unless `PORTICO_DEPLOYMENT = production`. Today the app never
     reads `PORTICO_DEPLOYMENT` (cross-module note).
- **Attack run against the fix:** webhook secrets (`whsec_`) do not encode their mode, so the name/key guard must
  hold for them.
- **Load-bearing:** `PORTICO_DEPLOYMENT` must be reliable. It is a validated enum set by Terraform, and the demo host
  hard-codes it. `NODE_ENV` is **not** reliable (P2-9).

**P2-2 · The grants step only warns about an unreviewed cross-tenant `SECURITY DEFINER` function, so it deploys**
(AP-02, AP-45, AP-52)

- **Where:** `infra/db/bootstrap-roles.mjs:405-425`; `deploy-cell.sh:201-206`.
- **Proof:** `infra-poc/unreviewed-definer-deploys.txt`. A migration-style definer function over
  `identity.user_tenants` is granted to `portico_app`. The grants step exits **0** with a warning; a request-handler
  login then reads **13 membership rows across 2 tenants** without tenant context. Only the monthly drill catches it,
  and P1-3 shows the drill does not run.
- **Gaps:** `verify-roles.sh`, which is fatal on unreviewed functions, runs in no CI (§3). Definer functions granted
  **only** to `portico_worker` are never reviewed: the drill-mutation probe shows them MISSED.
- **Fix (principle):** a cross-tenant capability that any login role can reach is refused at deploy time before any
  service rolls, and in CI before merge. Instances:
  1. the grants phase revokes EXECUTE from `portico_app`, `portico_worker` and `public` on every unreviewed definer,
     then exits non-zero (fail closed);
  2. CI runs migrate + grants as `portico_owner` with the unreviewed list required to be empty.
- **Siblings:** the demo host's `portico.sh` (same script); `verify.sql` check 7 (extend it to the worker).
- **Attack run against the fix:** the migration has already run, but the revoked function harms no running version
  (expand/contract), and the new release never serves.

**P2-3 · `portico_ops_readonly` cannot read any RLS table, but reads every tenant's directory tables, and none of it
is audited. Three runbook claims are false** (AP-09, AP-18, AP-50)

- **Where:** `bootstrap-roles.mjs:286-299` (`pg_read_all_data`); `docs/runbooks/database-roles.md:20,86-88`.
- **Proof:** `infra-poc/ops-readonly-reach.txt`.
  - With `app.tenant_id` set, reading `identity.users` fails with `permission denied for function
    current_tenant_id`.
  - Meanwhile `identity.user_tenants`, `identity.dev_mailbox` (recipient, subject, body),
    `identity.login_attempts` (IPs), `identity.verified_domains`, `identity.platform_security_alerts`,
    `payments.account_directory`, `platform.tenant_directory` and `operations.property_directory` are readable for
    all tenants. These are exactly the tables `verify.sql` check 3 forbids to the app.
  - Nothing is audited: `log_statement = ddl`, no pgaudit, no connection logging, and IAM DB tokens are signed client
    side.
- **Why it matters:** this contradicts security-privacy-readiness §5 ("no standing access … every view audited").
  If someone "fixes" the role by granting the function, they get every tenant by setting the GUC.
- **Fix (principle):** no standing human read access to tenant data; human access is per ticket, time-boxed, scoped
  and audited (§5, D16).
  - Do not create the role, and drop `pg_read_all_data`, until that flow exists.
  - If a read role is needed now, give it only non-tenant operational tables (`core.job_runs`,
    `core.schema_migrations`).
  - Correct the runbook.
- **Sibling:** ECS Exec break-glass has no session logging (`aws_ecs_cluster` has no `execute_command_configuration`),
  so a shell in a task, with every key, is unrecorded.
- **Attack run against the fix:** curated views over FORCE-RLS tables return nothing to their owner without context,
  so a cross-tenant "read-only" view needs a definer, which P2-2 must then review. Keep human reads off tenant
  tables.

**P2-4 · The restore drill's isolation checks miss the most likely isolation defects, and the claimed "earlier
negative tests" are absent** (AP-02, AP-50, AP-55)

- **Where:** `infra/restore-drill/verify.sql` checks 2, 3, 5 and 7; `docs/runbooks/backup-restore-verification.md:8`.
- **Proof:** `infra-poc/drill-mutations.txt`. One planted defect per run:

  | Planted defect | Result |
  |---|---|
  | RLS disabled | caught |
  | RLS not forced | caught |
  | App may UPDATE `audit_log` | caught |
  | App may INSERT into a non-RLS directory table | caught |
  | `BYPASSRLS` | caught |
  | App group made a member of `pg_write_all_data` | caught |
  | PUBLIC execute on a job function | caught |
  | RLS disabled on `core.audit_log` | caught |
  | Tenant policy replaced by `USING (true)` | **missed** |
  | Extra permissive `USING (true)` policy | **missed** |
  | `portico_worker` granted DELETE on `audit_log` | **missed** |
  | `portico_worker` granted SELECT on a non-RLS directory table | **missed** |
  | Worker-only definer function | **missed** |
  | New table without `tenant_id`, RLS on with a `USING (true)` policy, readable by the app | **missed** (borderline: not tenant-owned by the drill's definition) |

  `verify-roles.sh` plants only two defects (re-granted routing function, unbalanced entry).
- **Fix (principle):** a restore passes only if tenant isolation holds for **every login role**, not only if RLS is
  switched on. Instances:
  1. each RLS table has exactly the standard permissive policy (`pg_get_expr` equal to
     `tenant_id = core.current_tenant_id()` for USING and WITH CHECK), plus allow-listed, reasoned exceptions;
  2. checks 3, 5 and 7 run for `portico_worker` too;
  3. one planted negative per check in `verify-roles.sh`.
- **Attack run against the fix:** `USING (tenant_id = core.current_tenant_id() OR true)` defeats a substring match.
  Compare the normalized expression exactly.

**P2-5 · Guest PII reaches Postgres logs (bind values of slow queries; key values in error DETAIL)** (AP-15, AP-17,
AP-18; CLAUDE.md §6)

- **Where:** `modules/database/main.tf:83-93` (`log_min_duration_statement = 1000`; `log_parameter_max_length` left
  at −1 = full). Sibling: the demo host's Postgres (`portico.sh:100`).
- **Proof:** `infra-poc/pii-in-postgres-logs.txt` (PG 16.15, node-postgres, threshold lowered for the probe):
  `DETAIL: parameters: $1 = 'jane.guest@example.com', $2 = 'Passport X1234567'`. Unique violations add
  `Key (email)=(…)` to the ERROR DETAIL. The logs keep this for 30–90 days, beyond any erasure.
- **Fix (principle):** the database never writes bind or row values to logs. Set `log_parameter_max_length = 0`,
  keep `log_parameter_max_length_on_error = 0`, and set `log_error_verbosity = terse`, on both RDS/Aurora and the demo
  container.
- **Attack run against the fix:** `log_min_error_statement` still logs statement text, but parameterized SQL shows
  only `$n` placeholders. Any literal-built SQL (`sql.raw`) would still leak; grep for it.

**P2-6 · The irreplaceable keys can be destroyed or silently replaced, and the DR replica cannot be used by the cell
module** (AP-22, AP-58)

- **Where:** `modules/secrets/main.tf:153-173`; `docs/runbooks/disaster-recovery.md` ("Region loss" step 4);
  `backup-restore-verification.md` ("Keys are part of the backup").
- **Problems:**
  - There is no resource policy, so any principal allowed `secretsmanager:DeleteSecret` can pass
    `ForceDeleteWithoutRecovery` (the "30-day recovery" is optional). `RemoveRegionsFromReplication` first removes
    the DR copy.
  - Two `PutSecretValue` calls push the original out of `AWSPREVIOUS`, after which new ciphertexts are written under
    the same key id `-field-v1`.
  - There is no `prevent_destroy`, and bumping `secret_string_wo_version` replaces the keys.
  - The DR replica keeps the **primary's name** (`…/aps1-c01/app/field-key`). A DR cell built from the module
    generates **new** keys under `…/aps2-…`; there is no input to reuse existing secrets, and the runbook never
    promotes the replica.
  - Lean keeps no copy of the keys outside the region.
- **Fix (principle):** only a deliberate, two-person, logged break-glass action can destroy or replace the field,
  blind-index or seal key, in any region. Instances:
  1. a secret resource policy denying `DeleteSecret` with force or a window under 30 days, `PutSecretValue`,
     `UpdateSecret`, `RemoveRegionsFromReplication` and `Put`/`DeleteResourcePolicy` except to a break-glass role;
  2. `prevent_destroy` in production;
  3. a module input `existing_app_key_secret_arns` for DR cells, plus replica promotion in the runbook;
  4. a replica for lean too (≈ $0.40/secret/month).
- **Attack run against the fix:** the account root can always override, so alarm on these API calls. That is P2-11,
  which becomes load-bearing here.

**P2-7 · Supply chain: no base image is digest-pinned, and nothing proposes updates for images or the tsx
lockfile** (focus e)

- **Where:**
  - `apps/api/Dockerfile:22-23` and `apps/worker/Dockerfile:105` use `node:22.23.4-slim`. The digest was resolvable
    today: index `sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d`.
  - `infra/restore-drill/Dockerfile:132` uses `amazonlinux:2023` (a rolling tag) with an unversioned `dnf install`.
  - The demo uses `postgres:16-bookworm` (rolling).
  - pnpm comes from `npm install --global pnpm@10.28.0`, with no integrity check.
  - `.github/dependabot.yml` covers npm `/` and actions only: no `docker`, no `/infra/docker/tsx-runtime`, no
    `terraform`.
- **Fix:** pin every `FROM` and image by digest now (the deploy workflow would otherwise build unpinned on its first
  run). Install pnpm with corepack and the `packageManager` hash. Add the dependabot ecosystems (docker for `apps/*`
  and `infra/restore-drill`, npm for `infra/docker/tsx-runtime`, terraform for `infra/terraform`).
- **Attack run against the fix:** frozen digests stop receiving security fixes, so the digest-update PRs are
  mandatory.
- **Clean, by probe:** action SHAs (7/7), the tsx lockfile (29 integrity hashes, `--ignore-scripts`), frozen offline
  installs, the RDS CA pin, non-root `1000:1000`, a read-only root FS (strace), `capabilities drop ALL`.

**P2-8 · The pipeline renders each release from the family's *latest* revision, not Terraform's, so any registered
revision becomes the template for every later deploy**

- **Where:** `infra/ci/deploy-cell.sh:146-154`; the "Terraform owns the shape" claim at `modules/compute/main.tf:10-12`.
- **Problem:** any principal with `RegisterTaskDefinition` + `PassRole` on the cell's roles (the cell's deploy role,
  humans) can add environment entries (`PORTICO_APP_BASE_URL=https://evil…` poisons reset and invitation links), a
  command or an image. Every later deploy perpetuates it, and Terraform never sees it (`ignore_changes`). In a shared
  account another environment's deploy role (`RegisterTaskDefinition` on `*`) can register a production-family
  revision with its own roles, which breaks every production deploy (denial of service).
- **Fix (principle):** a deployed revision is Terraform's reviewed shape plus the release image, nothing else. Put
  Terraform's revision ARNs in the deploy-config parameter, register from them, and refuse when the latest revision
  differs from Terraform's in anything but the image.
- **Attack run against the fix:** Terraform's revision carries the image `:bootstrap`, and the pipeline swaps only
  the image, so this works.

**P2-9 · Every deployment runs `NODE_ENV=production`, so the app treats demo and staging as production. The README's
runtime contract ("operator tokens: non-production only") is false** (AP-40, AP-55)

- **Where:** `modules/compute/main.tf:26`; `single-host/files/portico.sh:61`; `apps/api/src/composition.ts:248,271`;
  `infra/README.md` runtime-contract table.
- **Proof:** `infra-poc/live-key-guard-bypass.txt`, third run. Staging plans with `NODE_ENV` and the operator
  secrets, yet `operatorConsoleEnabled = !production` disables the console on every deployment. Hosted-demo and
  staging trial provisioning through the operator console cannot work, and the placeholders are dead.
  `PORTICO_DEPLOYMENT`, `PORTICO_CELL`, the bucket names and `PORTICO_FIELD_KMS_KEY_ID` are read by nothing.
- **Fix (principle):** the app's notion of "production" is the deployment, read from `PORTICO_DEPLOYMENT`; `NODE_ENV`
  only selects build behaviour. Either change composition (cross-module) or correct the README and stop creating the
  operator placeholders.
- **Test gap:** `runtime_contract` asserts names, not values; add `NODE_ENV` and `PORTICO_DEPLOYMENT` value
  assertions.

**P2-10 · The on-call topic refuses AWS Backup and SES, so "failed backup / copy jobs page on-call" is false**
(AP-26, AP-50)

- **Where:** `modules/observability/main.tf:38-60,86-104` (KMS and topic policy allow only cloudwatch, budgets and
  events); `modules/backup/main.tf:152-158`; `modules/email/main.tf:40-52`.
- **Problem:** both services need `sns:Publish` in the topic policy **and** `kms:GenerateDataKey*` / `Decrypt` on the
  topic's CMK.
- **Fix:** add `backup.amazonaws.com` and `ses.amazonaws.com` with `aws:SourceAccount` to both policies.
- **Attack run against the fix:** `SourceAccount` stops another account's service from publishing.

**P2-11 · No account-level detective controls, and the governance-mode locks are described as stopping a compromised
admin** (AP-11, AP-50)

- **Where:** no `aws_cloudtrail`, GuardDuty or Config/Security Hub anywhere; `modules/backup/main.tf:7-8` ("a
  compromised admin credential cannot shorten retention or delete recovery points silently") with vault lock in
  **governance** mode and S3 Object Lock **GOVERNANCE**; `incident-response.md:59` relies on CloudTrail. Human access
  (an MFA-enforced infra role, SCPs) is not codified.
- **Fix (before production):**
  - an organization or multi-region trail with log-file validation into a separate log account or bucket;
  - GuardDuty;
  - EventBridge alarms on root sign-in, IAM policy changes, `ScheduleKeyDeletion`, `DeleteSecret`,
    `RemoveRegionsFromReplication`, `DeleteBackupVaultLockConfiguration` and `PutBucketPolicy` on the backups bucket;
  - compliance-mode vault lock for production, once the owner accepts that it cannot be undone;
  - correct the comment.
- **Load-bearing:** P2-6's fix depends on these alarms.

### P3

| ID | Where | Problem | Fix (principle → instances) |
|---|---|---|---|
| P3-1 | `modules/cell/main.tf:8-12`, `locals.tf:393-402` | The guard rejects only CIDRs ending in `/0` (`0.0.0.0/1` passes). Trusting all CloudFront origin-facing ranges is safe only while every CloudFront distribution appends the address it saw. `infra-poc/xff-trusted-proxies.txt` C shows that a forwarded, un-appended forged XFF would become the client. A and B (deployed chain, XFF rotation, IPv6 rotation in D) are **clean** | Trust only addresses that cannot carry attacker text. Instances: reject any prefix shorter than /8; read the viewer address from `CloudFront-Viewer-Address` only on requests carrying the verified origin header (cross-module, `packages/http`); or use a CloudFront VPC origin (below) |
| P3-2 | `modules/compute/main.tf:196-209`, `edge/main.tf:5-6,219-234`, `single-host/main.tf:5-7` | The origin secret has one value, so rotation means 403s while CloudFront deploys. It is readable through ReadOnly APIs and state (disclosed for state). The demo host does not check the header (the edge comment says the origin requires it), and CloudFront → demo is plain HTTP; "inside AWS's network" is unverified | Remove the public origin entirely: a **CloudFront VPC origin** (internal ALB or instance; also saves the ALB public IPv4). Otherwise use a two-value listener rule for rotation, and correct the comments |
| P3-3 | `infra/restore-drill/restore-drill.sh:30-44`, `modules/restore-drill/main.tf:146-171,230-235`, `verify.sql:100-101,122-123` | Bash is PID 1 with no init and no TERM trap, so an ECS stop skips the cleanup and leaves an **orphaned production copy** (cost, and erased data kept; AP-17). Nothing sweeps `-drill-*`. The drill has no hardening, and its public IP is hard-coded. `SKIPPED` checks count as passed (AP-35) | Instances: `initProcessEnabled` + `trap … TERM`; each run deletes `<prefix>-drill-*` older than 6 h and alarms on any; a skip is reported as `skipped`, never `passed` |
| P3-4 | `restore-drill/main.tf:27-35,175-183`, `single-host/main.tf:41-49,134-142`, `budgets/main.tf:63-95`, `backup/main.tf:119-127`, `database/main.tf:47-58`, `network/main.tf:202-210`, `ci-deploy-role/main.tf:114-140` | Service trust policies lack `aws:SourceAccount` (confused deputy). The budget role has `ec2:StopInstances` on `*` and `iam:AttachRolePolicy` with no `iam:PolicyARN` condition. The recovery-account KMS grant has no `kms:ViaService`. The CI role reads logs and SSM invocations on `*` | Every service-assumed role carries `aws:SourceAccount` / `SourceArn`; every IAM grant that can attach policies is conditioned on the policy ARN; KMS cross-account use goes `ViaService` rds |
| P3-5 | `modules/database/main.tf:90` | `log_statement = ddl` writes the SCRAM verifiers of every `ALTER ROLE` into CloudWatch, which the CI role can read (P3-4) | Exclude role DDL: `ALTER ROLE … SET log_statement = none` for the bootstrap session, or `SET log_statement = 'none'` inside `bootstrap-roles.mjs` (master only) |
| P3-6 | `.github/workflows/ci.yml`, `infra/ci/deploy.yml.example:50-76`, `infra/ci/test/deploy-cell.test.sh` | No gate runs `terraform fmt/validate/test`, `verify-roles.sh` or `deploy-cell.test.sh` (AP-52). The deploy test lacks grants-failure and bootstrap-failure cases. The README's "run the checks yourself" `verify-roles` command uses workspace sources (the runtime-layout claim needs `RUNTIME_DIR`; I confirmed the layout separately with strace) | Add an infra job to `ci.yml` (Postgres service with SCRAM, not `trust`). Add the two failure cases. Document `RUNTIME_DIR` |
| P3-7 | `infra/ci/deploy-cell.sh:100-112`, `test/fake-skopeo.sh` | Likely, not verified: real skopeo on the amd64 deploy runner resolves the arm64-only OCI index (plus attestation) to the host platform and fails. The fake is platform-agnostic (AP-41). It fails closed | Use `skopeo inspect --raw` → index digest and `copy --all --preserve-digests`; compare index digests with ECR; make the fake model an index |
| P3-8 | `.dockerignore:13-14`, `infra/.gitignore:7` | `.env` is ignored only at the root (`**/.env` is missing); only `terraform.tfvars` is git-ignored (`*.auto.tfvars` and other names are not); the runtime image keeps npm and corepack | Use `**/.env*`, `*.tfvars` (except `*.example`); remove npm from the runtime stage, or use a distroless base |
| P3-9 | `infra/db/bootstrap-roles.mjs:63-118` vs `infra/restore-drill/verify.sql:131-142` | AP-42: the definer allow-lists are copied ("keep in sync"). They are equal today (22 = 22, checked); only `verify-roles` keeps them in sync | Generate the `verify.sql` list from the module, or add a unit test comparing them |
| P3-10 | `modules/cell/variables.tf:10-11`; `docs/readiness/readiness-register.md:80,105`; ADR-0011; `modules/secrets/main.tf:98-127` | Stale or inaccurate: the tier description says lean uses VPC endpoints instead of NAT; the register does not record the code-level R3 (technical) state; ADR-0011's OpenTelemetry is absent; DB secret URLs embed the host and are never rewritten (the lean→resilient engine change leaves stale URLs) | Correct the text; add register rows (technical R3 offline, AWS R1); note the OTel gap; add the URL rewrite to the engine-migration runbook |
| P3-11 | `modules/identity/src/routes.ts:1085` (cross-module) | Behind CloudFront, `Host` is the origin FQDN (`AllViewerExceptHostHeader`), so SCIM `meta.location` exposes `origin-…` and those links return 403 | Use the public base URL from configuration |
| P3-12 | `modules/edge/waf.tf:12-24,90-124` | Core-rule-set body rules (XSS, RFI) can block legitimate staff or webhook payloads with CloudFront's HTML 403 (no problem+json; failure looks generic). The login rate rule exists only on "full" | Run CRS in count mode for `/v1/*` webhook paths first; add a custom 403 response body in problem+json; add the login rule on lean (+$1) |

---

## 3. Coverage declaration (required)

### Checklist items 1–15

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation | probed — findings P2-2, P2-3, P2-4. Clean: RLS forced (drill check 2), every definer function pins `search_path` and revokes PUBLIC (45 functions listed), app and worker cannot read non-RLS tables or create objects, no `portico_*` role is privileged |
| 2 | Authorization (here: IAM least privilege) | probed (code-read chains) — P1-1, P3-4. Clean: task and execution roles split per task, `kms:ViaService` on secrets decrypt, S3 bucket deny policies |
| 3 | Money & finance | probed — the drill's ledger check catches an unbalanced entry (verify-roles 7); P2-1 (live keys); P2-6 (terms-seal key) |
| 4 | Idempotency & concurrency | probed — concurrent roles and grants runs (advisory lock) clean; re-deploy with the same digest accepted, a different digest refused (deploy test) |
| 5 | Events & audit | probed — `audit_log` append-only for the app (caught) but not checked for the worker (P2-4); unaudited human DB access (P2-3); no CloudTrail (P2-11) |
| 6 | Contracts (runtime contract vs app) | probed — P2-9; `PORTICO_DEPLOYMENT` unused (cross-module note) |
| 7 | Data authority & environment safety | probed — P2-1, P2-9; demo DNS firewall (code-read, clean); operator console off in production (clean) |
| 8 | Errors & UX contract | code-read — deploy, drill and bootstrap messages explain the cause and the next step (clean); P3-12 |
| 9 | Spec coverage | code-read — § 4 |
| 10 | Scenario claims | code-read — readiness brief §17 (restore-tested backups): P1-3 |
| 11 | Honest readiness | probed — mostly honest ("NOTHING deployed", R1 in AWS, never-verified list). Overclaims: P1-1, P1-3, P2-3, P2-4, P2-9, P2-10, P2-11 |
| 12 | Code quality | probed — fmt and lint clean, no secrets committed (scan), write-only secrets confirmed in plans; log hygiene P2-5, P3-5 |
| 13 | One-product experience | not applicable (no records, no UI) |
| 14 | Competitive parity gate | not applicable (parity file: none, per the run parameters) |
| 15 | Cross-module coherence | code-read — § 6; P3-9 (copied lists) |

### Pattern library (groups A–E; group F not applicable, since this is not a UI review)

| ID | Status |
|---|---|
| AP-01 | not applicable — no record-scoped service APIs in this branch |
| AP-02 | probed — P2-2 (13 rows / 2 tenants), P2-3; definer `search_path`/PUBLIC hygiene clean |
| AP-03 | code-read — P1-1 (OIDC trust keyed on a claimable repository name, not `repository_id`) |
| AP-04 | probed — `X-Forwarded-For` (A/B clean; C residual → P3-1); viewer-supplied `X-Origin-Verify` is overwritten by the CloudFront custom header (code-read, clean) |
| AP-05 | code-read — the ALB gated (SG + header) clean; the demo origin ungated → P3-2 |
| AP-06 | not applicable — no permission catalogue changes |
| AP-07 | not applicable — no person credentials managed by infra |
| AP-08 | code-read (reverse order on the GitHub namespace) — P1-1 |
| AP-09 | code-read — P1-1 (deploy role), P2-3 (ops role), P3-4 (budget role) |
| AP-10 | code-read — P1-1 (production approval by the dispatcher not prevented) |
| AP-11 | code-read — P2-11 (human AWS access and MFA not codified; D16) |
| AP-12 | probed — app per-IP limit holds under XFF rotation and IPv6 /64 rotation (clean) |
| AP-13 | probed — clean for the deployed chain; P3-1 (guard boundary, CloudFront-chain residual) |
| AP-14 | code-read — clean (Fargate metadata at link-local is refused by safeFetch; IMDSv2 hop limit 1 on the demo host) |
| AP-15 | probed — plans: write-only (clean); P2-5, P3-5, P3-8 |
| AP-16 | not applicable — no UI |
| AP-17 | code-read — P3-3 (orphaned restored copies), P2-5 (PII in logs outlives erasure) |
| AP-18 | code-read — P2-3, P2-5 |
| AP-19 | probed — P2-1, P2-9; the dev mailbox is behind `requireOperator`, off in production (clean) |
| AP-53 | not applicable — no delegated port calls |
| AP-20 | not applicable — no money mutation |
| AP-21 | probed (deploy test) — re-run with the same digest is idempotent (clean) |
| AP-22 | code-read — P2-6 (seal-key replacement invalidates agreed terms) |
| AP-23, AP-24, AP-25, AP-27, AP-28 | not applicable — no money arithmetic, tax, limits, settlement or collection in infra |
| AP-26 | code-read — P1-3, P2-10 (silent failure shown as covered) |
| AP-29 | code-read — P1-3 (monthly cadence enforced by nothing) |
| AP-30, AP-31, AP-32, AP-33 | not applicable — no event consumers or offline writes in infra |
| AP-34 | code-read — clean (office-hours stop mid-deploy: every phase is idempotent and a re-run converges) |
| AP-35 | probed — P2-1 (name-only guard), P3-1 (`/0`-only guard), P3-3 (skip = pass) |
| AP-36 | code-read — clean (advisory lock taken before the role reads) |
| AP-37 | not applicable — bootstrap and grants are DB-only; the drill's AWS calls are not inside a DB transaction |
| AP-38 | not applicable — no governed-domain writes |
| AP-39 | probed — concurrent roles and grants runs both succeed (clean) |
| AP-56 | code-read — alternating-user rotation keeps the old login valid; no in-flight writer is invalidated (clean) |
| AP-40 | probed (tf probe + grep) — P2-9; unused runtime variables |
| AP-41 | code-read — P3-7 (fake skopeo), P1-3 (fake AWS never models a no-exit-code stop) |
| AP-42 | probed (diff script) — P3-9 |
| AP-43 | not applicable — no event payloads |
| AP-44 | probed — P2-1 (plan-time name check vs runtime value) |
| AP-45 | applied to every finding (siblings listed in each) |
| AP-46 | probed / code-read — failed migration touches no service (tested, clean); grants and bootstrap failures untested (P3-6); drill cleanup (P3-3) |
| AP-47 | code-read — P1-1 / P1-3 (the first push of the immutable `latest-drill` tag locks it); a pre-pushed SHA tag fails closed (acceptable) |
| AP-48 | not applicable — no effective-dated rules (price files are dated) |
| AP-54 | applied — P1-1 (GitHub rules), P2-1 (`PORTICO_DEPLOYMENT`), P2-6 (needs P2-11) |
| AP-57 | probed — P2-1 (the guard trusts names the restrained actor writes); P1-3 (drill checks written by whoever pushes the image) |
| AP-58 | code-read — P2-6 (a `wo_version` bump replaces the keys); repeated rotation clean |
| AP-50 | probed — overclaims in P1-1, P1-3, P2-3, P2-4, P2-9, P2-10, P2-11 |
| AP-51 | code-read — the deploy is proven only against fakes and the drill never ran on AWS; both are **disclosed** in the README (clean) |
| AP-52 | probed — gates run with `--force` and exit codes; P3-6 |
| AP-55 | code-read — P2-9 (`runtime_contract` asserts names, not `NODE_ENV`/`PORTICO_DEPLOYMENT` values) |

Totals: 57 IDs: 19 not applicable and 38 applicable (16 probed, 20 code-read, 2 applied as review steps, 0 unprobed).

---

## 4. Spec coverage (ADR-0011, focus areas, the owner-decision table)

- **ADR-0011:** ECS Fargate ✓, Aurora Multi-AZ + PITR ✓ (resilient), S3 + KMS ✓, CloudFront + WAF ✓, Secrets
  Manager ✓, SES ✓ (the infra side; the adapter is not built), CloudWatch ✓; **OpenTelemetry ✗** (P3-10); one state
  per environment ✓; `ap-south-1` ✓; cell-ready naming ✓; zero resources until authorized ✓.
- **(a) IAM:**
  - The task, execution and drill roles are tight. The CI role is administrator-equivalent (P1-1). The operator path
    is undefined (D16, P2-3). The recovery account is not automated (D8; P3-4 KMS condition).
  - The OIDC trust pins repository + environment only (P1-1).
- **(b) Secrets:**
  - Write-only attributes really are write-only (plan shows `(write-only attribute)`).
  - The origin secret is in state (disclosed).
  - Rotation is documented for DB logins and absent for keys (disclosed).
  - DR replica: P2-6.
  - Logs: P2-5, P3-5.
- **(c) Network:**
  - The SGs admit only the ALB and CloudFront.
  - WAF lean/full.
  - TLS 1.2+ end to end on managed tiers.
  - Egress default contradicts Q158 (P1-2).
  - Origin bypass needs the secret (P3-2); the demo has no header check (P3-2).
  - `TRUSTED_PROXY_CIDRS` probed (P3-1).
- **(d) DB roles:**
  - The blue/green and worker split works (38/38).
  - Request handlers cannot reach job-only routing functions (probed: refused).
  - RLS forced.
  - Gaps: P2-2, P2-3, P2-4.
- **(e) Supply chain:** P2-7 (digests); the rest is clean (see P2-7).
- **(f) Deploy safety:**
  - Migrations run before services, and rollback works (tested offline). The production gate is not codified
    (P1-1).
  - The LIVE guard is bypassable (P2-1). Operator tokens are refused in production, and in practice everywhere
    (P2-9).
  - The pipeline perpetuates drift (P2-8).
- **(g) Honest readiness:** headline honest; specific overclaims listed under AP-50.

## 5. Scenario-claim assessment

Infra claims no brief §17 scenario directly. Its implicit claim, "backups restore-tested monthly", fails as written
(P1-3). The verify SQL itself is real and partly mutation-tested (P2-4). "Automatic rollback" is demonstrated only
against a fake AWS CLI (disclosed).

## 6. Cross-module notes for the orchestrator

- **Q158 ↔ code** (P1-2): decide which side changes.
- **kernel / payments:** make `PORTICO_DEPLOYMENT` the deployment truth. Refuse live keys and live effects unless it
  is `production` (P2-1, P2-9). `NODE_ENV=production` is set on every deployment.
- **identity:** the SCIM base URL comes from `Host` (P3-11). The operator console cannot run on hosted demo or
  staging (P2-9).
- **packages/http:** an optional `CloudFront-Viewer-Address` client-IP source, gated on the origin header (P3-1).
- **main's `.github/workflows/ci.yml`:**
  - its actions are pinned by tag (`@v4`), not by SHA, unlike the infra workflow;
  - it runs no infra checks (P3-6);
  - dependabot misses docker, terraform and the tsx-runtime lockfile (P2-7).
- **The infra requests 1–10 stand.** Add to request 2: module migrations should never grant `SECURITY DEFINER` to
  `portico_worker` directly without listing it (P2-2).
- **Duplicated concept:** the routing and definer allow-lists live in `bootstrap-roles.mjs` and `verify.sql` (P3-9).
  A packages/db-owned registry of reviewed definer functions would serve migrations, CI, deploy and drill.

## 7. Evidence (PoCs and probes)

| File | What it shows |
|---|---|
| `infra-poc/ci-deploy-role-equivalence.txt` | P1-1 code-read chains A–C, file:line |
| `infra-poc/restore-drill-silent.txt` | P1-3 chain |
| `infra-poc/live-key-guard-bypass.txt` + `zz-review-probes.tftest.hcl.txt` | P2-1, P2-9: three `terraform test` runs that pass when they should be refused |
| `infra-poc/unreviewed-definer-deploys.txt` | P2-2: grants exit 0; 13 rows / 2 tenants read by the app login |
| `infra-poc/ops-readonly-reach.txt` | P2-3 |
| `infra-poc/drill-mutations.txt` | P2-4: 8 defects caught, 6 missed (one borderline); the baseline (no defect) passes correctly |
| `infra-poc/pii-in-postgres-logs.txt` | P2-5 |
| `infra-poc/xff-trusted-proxies.txt` | AP-12/13 clean (A, B, D); P3-1 residual (C) |

Probe environment: my own throwaway SCRAM-auth PostgreSQL 16.15 on port 55461, `review_infra_probe` database (roles
phase, 19 migrations as `portico_owner`, grants, demo seed). Runtime layout built with `pnpm deploy --prod --legacy`
and `npm ci` of `infra/docker/tsx-runtime`. Both the cluster and the database were removed at the end; the shared
cluster has no `review_infra*` databases left.
