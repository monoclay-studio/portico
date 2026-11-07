# Runbook: rollback

**Status:** written, never executed against AWS. The automatic rollback paths of `infra/ci/deploy-cell.sh` are tested
offline with a fake AWS CLI (`infra/ci/test/deploy-cell.test.sh`: failed rollout, failed smoke test, failed
migration). ECS behaviour itself is **[unverified]**.

## The one rule

**Roll back the application, never the database.** Hotels keep working while we fix things: a reservation taken,
a payment recorded or a folio closed after the release is real. Restoring an older database backup over production
would silently erase it (readiness brief §17–§18). Data problems are repaired **forward**, from a side copy, with
new correcting entries ([disaster recovery](disaster-recovery.md) § Data corruption).

This works only because migrations are expand/contract ([deploy](deploy.md) § Migration rules): the previous
application version runs on the new schema.

## What rolls back automatically

| Failure | Detected by | What happens |
|---|---|---|
| New api tasks fail health checks (`/health/ready`) or crash | ECS deployment circuit breaker | ECS returns the service to the last good revision |
| 5xx rate or "no healthy targets" alarm during the rollout | ECS deployment alarms | same |
| Rollout not COMPLETED after the wait (including a failed `migrate` or `grants` init container) | `deploy-cell.sh` | the `release` tags go back to the digests recorded before the release; api and worker redeployed |
| Smoke test fails (`/health/ready` not ready, or `/v1/me` not 401 through the public URL) | `deploy-cell.sh` | same |
| Migration fails | the api's `migrate` init container exits non-zero | the new api never starts; the previous tasks keep serving; the failed migration's transaction rolled back |
| Demo host readiness fails | `portico.sh` on the host | previous tag restarted |

The pipeline job fails red in every case. Read its log first: it names the failing step.

## Manual application rollback (Fargate)

When a release passed every check but misbehaves:

1. Declare an incident if a hotel is affected ([incident response](incident-response.md)).
2. Re-run the deploy workflow for the **previous commit SHA** (its images are still in ECR under immutable SHA tags):
   it moves `release` back to those digests and forces new deployments of the api and the worker. Migrations are a
   no-op (expand/contract); the grants step re-applies the reviewed lists.
3. Without the pipeline (a person with the deploy role): move the tag and force the deployments by hand —
   ```bash
   M=$(aws ecr batch-get-image --repository-name <prefix>/api --image-ids imageTag=<previous sha> --query 'images[0].imageManifest' --output text)
   aws ecr put-image --repository-name <prefix>/api --image-tag release --image-manifest "$M"   # same for worker
   aws ecs update-service --cluster <prefix> --service api --force-new-deployment
   aws ecs update-service --cluster <prefix> --service worker --force-new-deployment
   aws ecs wait services-stable --cluster <prefix> --services api worker
   ```
   Task definitions are never edited: Terraform owns them (`terraform apply` would revert any hand edit).
4. Web app: re-run the deploy for the previous SHA.
5. Verify `/health/ready`, a login and the screen that broke; keep the incident open until the hotel confirms.

## When the problem is in the data

Do not roll anything back. Follow [disaster recovery](disaster-recovery.md) § Data corruption: stop the writer that
corrupts (feature off, worker scaled to 0 if the corruption is in background jobs), restore a **side copy** to the
point before the damage, compute the correct state, apply **forward corrections** (reversing/adjusting entries for
money, audited changes for everything else) and explain the correction on each affected record.

## When a migration must be undone

Never `down`-migrate production. Write a new forward migration that restores the needed shape, review it, release
it. If the bad migration destroyed data, it is a data-corruption incident (above).

## Secrets and keys

- A rotated **database password** that broke tasks: the standby login still works — see
  [database roles](database-roles.md) § Rotation (switch `username` back in the secret, redeploy).
- The **field-encryption, blind-index and terms-seal keys** are never rotated by a release and must never be
  "rolled back" to another value: a different key makes stored identity documents unreadable and sealed booking terms
  invalid. If one was changed by mistake, restore the previous secret version (`aws secretsmanager
  update-secret-version-stage … --move-to-version-id <previous>`) and redeploy.
