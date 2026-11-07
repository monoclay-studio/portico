# Runbook: deploy

**Status:** written, never executed. No AWS account, no cell, no pipeline run exists yet (OPEN_QUESTIONS Q4/Q22).
The deploy script's control flow is tested offline (`infra/ci/test/deploy-cell.test.sh`, fake AWS CLI); the role
model and the runtime layout are tested against PostgreSQL 16 (`infra/db/verify-roles.sh`). Everything that needs a
real AWS account is marked **[unverified]**.

Related: [rollback](rollback.md) · [database roles](database-roles.md) · [backup/restore verification](backup-restore-verification.md)
· [incident response](incident-response.md) · [disaster recovery](disaster-recovery.md) · `infra/README.md`.

## Who may deploy

| Change | Who | How |
|---|---|---|
| Application release (images, migrations, web app) | Pipeline, via the cell's GitHub OIDC deploy role | `infra/ci/deploy.yml.example` → `infra/ci/deploy-cell.sh` |
| Production release | Pipeline **after an owner approval** (GitHub Environment `production`, required reviewer) | same |
| Infrastructure (Terraform) | A person with the infra role, from a reviewed commit on `main` | `terraform plan` → review → `terraform apply` |
| Anything during a property's Day Close window | Nobody, unless it fixes an incident (support-recovery-plan §6) | — |

The deploy role cannot change infrastructure, read secret values or touch the database directly; it can only run the
task definitions Terraform registered (`modules/ci-deploy-role`).

## First-time setup of an account and a cell (once, after authorization)

1. **Account guard rails.** Owner creates the AWS account(s) (Q4), enables MFA on root, creates the infra role.
   Activate the `Cell` cost-allocation tag (Billing → Cost allocation tags) so budgets can be scoped per cell.
2. **Bootstrap root** (`infra/terraform/envs/bootstrap`, local state): creates the state bucket (S3-native locking)
   and the GitHub OIDC provider.
   ```bash
   cd infra/terraform/envs/bootstrap
   terraform init && terraform apply -var 'state_bucket_name=portico-tfstate-<account id>' -var 'allowed_account_ids=["<id>"]'
   # then move its own state into the bucket: add backend "s3" { key = "portico/bootstrap/terraform.tfstate" ... }
   terraform init -migrate-state
   ```
3. **Cell root** (`envs/demo`, `envs/staging` or `envs/production`): copy `backend.hcl.example` → `backend.hcl` and
   `terraform.tfvars.example` → `terraform.tfvars`; fill every `OWNER` line. Terraform ≥ 1.11 is required (write-only
   secrets).
   ```bash
   terraform init -backend-config=backend.hcl
   terraform plan -out=cell.tfplan     # review: resource counts per tier are in infra/README.md
   terraform apply cell.tfplan
   ```
   Apply generates and stores, without ever writing them to state: the DB logins (owner, app, worker), the field
   encryption key, the blind-index key, the terms-seal key and the payment-simulator signing secret.
4. **DNS and email** (managed tiers): the zone in `route53_zone_id` must already serve the domain (Q1). If SES is
   enabled, request SES production access (an external approval — record it in the readiness register; never
   assume it).
5. **GitHub Environments**: create `demo`, `staging`, `production`; set variables `AWS_DEPLOY_ROLE_ARN`
   (output `ci_deploy_role_arn`), `AWS_REGION`, `CELL_PREFIX` (output `name_prefix`); production gets required
   reviewers. Copy `infra/ci/deploy.yml.example` to `.github/workflows/deploy.yml`.
6. **First deploy**: run the workflow with `bootstrap_roles = true` (creates `portico_owner`, `portico_app_*`,
   `portico_worker_*` from the secrets before the first migration).
7. **Evidence**: record in `docs/readiness/readiness-register.md` what ran, where, when, by whom and the result. A
   successful apply is R3-level evidence for the infrastructure, not an approval of anything external.

## A normal release

1. Merge to `main` (CI green: lint, typecheck, tests). `main` deploys to the **demo** cell automatically.
2. For staging/production: Actions → deploy → Run workflow → `target = staging-then-production`
   (staging must be `active = true`; it is off by default — `terraform apply -var active=true` first).
3. The pipeline, per cell (`infra/ci/deploy-cell.sh`):

   | Step | What happens | Stops the release when |
   |---|---|---|
   | push | the images built once in this run are copied with their digests preserved; a tag that already exists must have the same digest | digest mismatch |
   | register | new revisions of the api, worker, migrate and db-bootstrap task definitions with the new image | registration refused |
   | bootstrap (optional) | `bootstrap-roles.mjs` as the RDS master: roles match Secrets Manager | non-zero exit |
   | migrate | all module migrations as `portico_owner` (expand/contract only — see below) | non-zero exit; **no service was touched** |
   | grants | `bootstrap-roles.mjs grants` as `portico_owner`: job-routing functions → `portico_worker` only, verified | non-zero exit |
   | worker, then api | ECS rolling update, 100 % healthy capacity kept; circuit breaker + 5xx-rate / no-healthy-target alarms | rollout not COMPLETED → both services restored to the previous revisions |
   | smoke | `/health/ready` = ready **and** unauthenticated `/v1/me` = 401 through CloudFront → WAF → ALB | either fails → both services restored |
   | web | hashed assets, then `index.html` (no-cache), CloudFront invalidation of `/index.html` | — |

4. Production waits for the reviewer between the staging and production jobs. Production receives the same image
   digests staging just ran.
5. After the run: check the on-call topic stayed quiet for 15 minutes; note the release in the change log the hotel
   receives when behaviour changed (support-recovery-plan §6).

## Migration rules that make app rollback safe

Every migration must be **expand/contract**: the previous application version must keep working on the new schema.

- Add columns nullable or with defaults; add tables; add indexes `concurrently` where large.
- Renames and drops happen in a later release, after no running version reads the old shape.
- Never rewrite posted financial records in a migration; corrections are new entries (CLAUDE.md §5).
- A migration that cannot be expand/contract needs a written plan reviewed before the release (maintenance window,
  hotel notice, how to roll forward).

Migrations are append-only once merged (CLAUDE.md §8). Each release re-runs the grants step because a migration may
recreate a routing function or re-grant it to `portico_app`; the step reports any **unreviewed** `SECURITY DEFINER`
function the API can call — review it before the next release.

## Demo cell

`portico deploy <tag> <base-url>` on the host via SSM Run Command (the pipeline does this). The host pulls, runs the
role bootstrap, migrations and grants, starts api/worker, waits for `/health/ready` and **rolls itself back** to the
previous tag if readiness fails. Administration only through SSM Session Manager (`portico status`,
`portico reseed` — sample data only). Note: the host script is installed at first boot; changes to it reach an
existing host only by replacing the instance (`terraform apply -replace=module.cell.module.single_host[0].aws_instance.host`),
which is acceptable for a reseedable demo.

## Switching staging on and off

```bash
cd infra/terraform/envs/staging
terraform apply -var active=true    # ~15–25 min: database, ALB, CloudFront, secrets [unverified timing]
# deploy, rehearse, run scenario checks
terraform apply -var active=false   # destroys the database and everything paid; synthetic data only
```

## Known gaps

- Nothing here has run against AWS. First real run = first evidence; expect fixes.
- Container images have never been built (no Docker daemon where they were written).
- Canary releases and per-tenant feature flags (support-recovery-plan §6) are not built; the rollout is all tasks.
