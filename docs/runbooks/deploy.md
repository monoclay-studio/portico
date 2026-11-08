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
| Application release (images, migrations, grants, web app) | Pipeline, via the cell's GitHub OIDC deploy role | `infra/ci/deploy.yml.example` → `infra/ci/deploy-cell.sh` |
| Staging / production release | Pipeline **after a reviewer who did not start the run approves** | GitHub Environments (`envs/github`) |
| Infrastructure (Terraform) | A person with the infra role (`role/portico-infra-admin` by convention), from a reviewed commit on `main` | `terraform plan` → review → `terraform apply` |
| Role bootstrap / credential rotation (RDS master) | A person (break-glass) | `db-bootstrap` task ([database roles](database-roles.md)) |
| Anything during a property's Day Close window | Nobody, unless it fixes an incident (support-recovery-plan §6) | — |

**What the deploy role is.** It can push images to the cell's repositories, move the `release` tag, force new
deployments of the api and worker services, publish the web app and read the cell's own logs. It **cannot** read a
secret value, pass an IAM role, register a task definition, run a task, open ECS Exec or send arbitrary commands to the
demo host (`modules/ci-deploy-role/tests/least-privilege.tftest.hcl` asserts each of these). It is nevertheless **as
powerful as the code it deploys**: the images it releases run with the application's secrets and, in the api task's
init containers, with the owner database login. That is why only the deploy workflow file, from `main`, of the real
repository (immutable ids), in a protected environment, can obtain it (`envs/github` + the exact OIDC subject).

## First-time setup of an account and a cell (once, after authorization)

1. **Account guard rails.** Owner creates the AWS account(s) (Q4), enables MFA on root, creates the infra role
   (`portico-infra-admin`) and, separately, the key break-glass role (`portico-key-break-glass`, two-person use, D17).
   Activate the `Cell` cost-allocation tag.
2. **Bootstrap root** (`infra/terraform/envs/bootstrap`, local state): state bucket (S3-native locking), GitHub OIDC
   provider, and the account's detective controls (CloudTrail, GuardDuty, security pages to `security_emails`).
   ```bash
   cd infra/terraform/envs/bootstrap
   terraform init && terraform apply -var 'state_bucket_name=portico-tfstate-<account>' \
     -var 'trail_bucket_name=portico-cloudtrail-<account>' -var 'allowed_account_ids=["<account>"]'
   terraform init -migrate-state   # after adding backend "s3" { key = "portico/bootstrap/terraform.tfstate" … }
   ```
   Confirm the SNS email subscriptions (the security topic exists in the primary region and in us-east-1).
3. **GitHub root** (`infra/terraform/envs/github`, a repository admin with a GitHub token): OIDC subject template,
   environments `demo`/`staging`/`production` limited to `main` with reviewers and no self-review, branch protection
   on `main`. Note the outputs `repository_ids` (immutable repository id) and the organization id.
4. **Cell root** (`envs/demo`, `envs/staging` or `envs/production`): copy `backend.hcl.example` → `backend.hcl` and
   `terraform.tfvars.example` → `terraform.tfvars`; fill every `OWNER` line, including `github_repository =
   "monoclay-studio/portico"`, `github_repository_id`, `github_owner_id`.
   ```bash
   terraform init -backend-config=backend.hcl && terraform plan -out=cell.tfplan && terraform apply cell.tfplan
   ```
   Apply generates the DB logins and the application keys without writing them to state (write-only attributes). In
   production the field, blind-index and seal keys get `prevent_destroy`, a resource policy (only break-glass may
   replace or delete them, never without a 30-day window) and a replica in the DR region.
5. **DNS and email**: the zone must serve the domain (Q1). Request SES production access (external approval; record
   it, never assume it).
6. **First images and roles** (the order is forced by the design: the bootstrap task uses the api image, and the
   api's init containers need the roles the bootstrap creates):
   1. run the deploy workflow once — it pushes the images and moves `release`, then **fails at the api rollout**
      because `portico_owner` does not exist yet (expected on the very first deploy only; nothing was serving);
   2. as a person, run the `db-bootstrap` task ([database roles](database-roles.md) § Two phases);
   3. re-run the workflow: migrations and grants run in the api's init containers, the release completes.
7. **Evidence**: record in the readiness register what ran, where, when, by whom and the result.

## A normal release

1. Merge to `main` (CI green, including the `infra` job). `main` deploys to the **demo** cell automatically.
2. Staging/production: Actions → deploy → Run workflow → `target = staging-then-production` (staging must be
   `active = true`). Runs from any other branch cannot obtain the deploy roles.
3. Per cell (`infra/ci/deploy-cell.sh`):

   | Step | What happens | Stops the release when |
   |---|---|---|
   | push | images built once in this run are copied with `--all`, index digests preserved; an existing SHA tag must have the same digest | digest mismatch |
   | api | `release` tag → new digest; forced deployment; every new api task runs **migrate** then **grants** as init containers (portico_owner) before the api starts | rollout not COMPLETED (a failed migration, an unreviewed definer function, failed health checks, 5xx alarm) → tags back, both services redeployed |
   | worker | same, after the api | same |
   | drill image | `restore-drill:release` → the release (next drill and freshness run use this commit's `verify.sql`) | — |
   | smoke | `/health/ready` = ready **and** unauthenticated `/v1/me` = 401 through CloudFront → WAF → ALB | either fails → tags back, both redeployed |
   | web | hashed assets, then `index.html` (no-cache), CloudFront invalidation | — |

4. Production receives the same image digests staging just ran.
5. After the run: on-call quiet for 15 minutes; release notes to hotels when behaviour changed.

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

The pipeline sends the cell's own SSM document (`<prefix>-deploy`, parameters `tag` = a git SHA and `baseUrl` =
https URL, both validated by SSM) — never `AWS-RunShellScript`. The host pulls, runs the role bootstrap, migrations
and grants behind the env guard, starts api/worker, waits for `/health/ready` and **rolls itself back** if readiness
fails. Administration only through SSM Session Manager (`portico status`, `portico reseed` — sample data only). The
host script is installed at first boot; changes reach an existing host by replacing the instance.

## Switching staging on and off

```bash
cd infra/terraform/envs/staging
terraform apply -var active=true    # ~15–25 min: database, ALB, CloudFront, secrets [unverified timing]
# deploy, rehearse, run scenario checks
terraform apply -var active=false   # destroys the database and everything paid; synthetic data only
```

## Known gaps

- Nothing here has run against AWS. First real run = first evidence; expect fixes (`infra/README.md` § Not verified).
- Container images have never been built (no Docker daemon where they were written).
- Canary releases and per-tenant feature flags are not built; the rollout covers all tasks.
