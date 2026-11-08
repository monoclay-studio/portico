# Runbook: backup and restore verification

> A backup counts only when a restore of it has been verified (readiness brief §17). The existence of snapshots,
> retention settings or a green AWS Backup job is **not** evidence.

**Status:** the automated drill (`infra/terraform/modules/restore-drill`, `infra/restore-drill/`) is written and its
verification SQL is tested on PostgreSQL 16 (`infra/db/verify-roles.sh` step 7: passes on a correct database and
catches one planted defect per check — a re-granted routing function, an unbalanced journal entry, a `USING (true)`
or `… OR true` tenant policy, an extra permissive policy, an unreviewed policy on a new table, worker DELETE on the
audit log, worker access to a directory table, an unreviewed worker-only definer function). The alarm wiring is
asserted by `modules/restore-drill/tests/fails-loudly.tftest.hcl` and the stop pattern by
`infra/restore-drill/test/event-pattern.test.mjs`. **No restore of an AWS backup has ever run** — there is no AWS account yet. Every number below is
a TARGET (support-recovery-plan §1).

## What is backed up

| Data | Mechanism | Tier | Retention | Where |
|---|---|---|---|---|
| Primary database | RDS/Aurora automated backups + point-in-time recovery (PITR) | lean, resilient | 14 days (lean), 35 days (resilient) | same region |
| Primary database | AWS Backup daily + monthly, vault lock in production | resilient | 35 days daily, 365 days monthly | same region **and** the DR region (`dr_region`, default ap-south-2) |
| Documents bucket | S3 versioning; AWS Backup (resilient) | lean, resilient | lifecycle rules | same region (+ DR on resilient) |
| Backups bucket (tenant exports, drill evidence) | S3 versioning + Object Lock (governance, 30 days in production) | lean, resilient | lifecycle | same region |
| Field-encryption, blind-index, terms-seal keys | Secrets Manager; replica in the DR region | resilient (replica); all tiers (30-day recovery window on delete in production) | — | — |
| Demo host database | none (sample data, reseedable with `portico reseed`) | demo | — | — |

**Keys are part of the backup.** A restored database whose identity documents were encrypted with a key we no longer
have is not a recovery. The drill below checks the database; the key replica is checked by the cross-region drill.

## Automated drill (lean and resilient)

### State machine — "a drill that did not run always pages someone"

| State | Reached by | Exit | Pages? |
|---|---|---|---|
| scheduled | EventBridge Scheduler, 1st of the month 10:00 Malé (drill) and daily 09:00 (freshness) | started, or failed to start | — |
| failed to start | image missing/unpullable, no capacity, IAM | — | **yes, immediately**: stop rule (`TaskFailedToStart` / no exit code) |
| started | task running | passed, failed, incomplete, killed | — |
| passed | all checks passed, evidence `…-passed.json` | — | no; resets the freshness age |
| failed | restore or check failed | — | **yes**: `restore-drill-failed` + stop rule (non-zero exit) |
| incomplete | a check printed `SKIPPED` | — | **yes**, like failed |
| killed (ECS stop) | SIGTERM | restored copy deleted by the TERM trap; a copy left by a crash is swept after 6 h by the daily run | yes: stop rule (non-zero exit) |
| never ran / schedule deleted / freshness task broken | — | — | **yes**: `restore-drill-stale` — newest passed evidence older than 35 days, **or no freshness datapoint for two days (missing data = breaching)** |

The drill image is `restore-drill:release`, moved by every release, so `verify.sql` always matches the deployed
schema and definer lists.

### What a drill run does

EventBridge Scheduler → Fargate task (`infra/restore-drill/restore-drill.sh`, `MODE=drill`), in the cell's task
subnets (private behind NAT unless public task IPs were opted into):

1. Restores the primary database to its **latest restorable time** into a new instance/cluster in the
   `drill_database` security group (Postgres only from ops tasks — the application can never connect to it).
2. Sets a throwaway master password held only in the task's memory.
3. Runs `infra/restore-drill/verify.sql`:
   1. migrations present;
   2. every tenant-owned table has RLS enabled and forced (reviewed exceptions: `core.outbox`,
      `core.event_deliveries`, `integration.tenant_schedule` — owner-run dispatchers; RLS still applies to the app);
      2b. each carries exactly the standard `tenant_isolation` policy (exact expression comparison);
      2c. policies on tables without `tenant_id` are the reviewed identity ones, exactly;
   3. tables without RLS are not reachable by `portico_app` or `portico_worker`;
   4. no Portico role is superuser / BYPASSRLS / CREATEROLE / CREATEDB;
   5. the audit log is append-only for the app and the worker;
   6. every journal entry balances per currency and in functional currency (until finance ships
      `finance.verify_trial_balance()`, which will also prove folio balances = ledger projection);
   7. `portico_app` and `portico_worker` can execute only the reviewed `SECURITY DEFINER` functions (job routing
      is worker-only); the lists are generated from `infra/db/definer-registry.mjs`;
   then prints evidence: latest committed activity (compare with the restore time → **measured RPO**) and row counts.
4. Writes an evidence JSON to the backups bucket and publishes `RestoreDrillSuccess` / `RestoreDrillFailure` /
   duration (→ **measured RTO input**).
5. Always deletes the restored copy (trap), also on failure.

Cost: about one hour of a restore-sized instance per month, plus a minute of Fargate a day for the freshness check.

### AWS Backup jobs (resilient tier)

Alarms `<prefix>-backup-backup-missing` and `<prefix>-backup-copy-missing` page when no backup job / no DR copy job
**completed** in two days (missing data = breaching), so a plan that silently stops scheduling is caught. Job
failures also reach on-call through the vault notifications (the topic now accepts AWS Backup). Metric dimensions are
as documented by AWS and unverified until the first apply.

### When the drill fails

1. Treat it as **SEV2** (SEV1 if the cause suggests production data is damaged).
2. Read the drill log group (`/portico/<prefix>/restore-drill`) — the first `DRILL FAIL` line names the check.
3. Restore failed (AWS error, quota, KMS): fix and re-run the task manually (ECS → run task → `<prefix>-restore-drill`).
   Until a drill passes, the backup is unproven: say so in the readiness register.
4. A verification check failed: the same defect is very probably in production — an isolation or privilege
   regression from a migration. Open an incident; fix forward with a migration; re-run the drill.
5. Never "fix" the drill by widening an allow-list without a review that explains why the exception is safe.

## Manual drills (cadence TARGETS — support-recovery-plan §5)

| Drill | How | Cadence target | Evidence |
|---|---|---|---|
| Point-in-time restore | `aws rds restore-db-instance-to-point-in-time` (or `restore-db-cluster-to-point-in-time`) to a side instance at T; compare a known set of transactions written just before and after T | monthly | measured RPO |
| Cross-region restore (resilient) | restore the latest DR-region recovery point in `dr_region`; point a throwaway cell at it with the **replicated keys**; run verify.sql and open a document | quarterly; before a resilient pilot goes live | DR report |
| Object recovery | delete a test object in the documents bucket, restore the previous version | quarterly | log |
| Tenant export / re-import | export one tenant, import it into a scratch environment, compare counts and balances | before go-live, then semi-annually | report |
| Corruption repair | plant a bad update on a staging copy, repair by forward correction from a PITR side copy | semi-annually | report |

The support plan's weekly snapshot-restore target is stricter than the monthly automated schedule: running it weekly
roughly quadruples the (small) drill cost — an owner decision (`infra/README.md` § Owner decisions).

## Stronger isolation (recommended before real hotel data)

Restore into a **separate recovery AWS account**: share the snapshot and grant its KMS key to that account
(`recovery_account_ids` on the database module), run the drill there. A compromised production account then cannot
reach the drill copies, and the drill proves the backups are usable outside production. Not automated yet.

## Evidence format (readiness register)

`date · cell · backup used (snapshot id / restore time) · restore duration · checks 1–7 result · evidence object
(s3://…/restore-drills/…) · run by (scheduler or person)`. A failed or skipped check is recorded as such — never as
passed.
