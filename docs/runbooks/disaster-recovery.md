# Runbook: disaster recovery

> **Every RPO/RTO in this document is a TARGET** (support-recovery-plan §1; readiness brief §17). None has been
> measured: no AWS environment exists. A target becomes a claim only with the evidence listed in § Evidence.

## Targets per scenario and tier

| Scenario | Lean (T2) — what happens | Resilient (T3) — what happens | Pilot TARGET |
|---|---|---|---|
| One task / instance fails | ECS replaces it; lean runs **one** api task, so expect a short gap | 2+ tasks per service across AZs: no gap expected | RTO ≤ 15 min |
| One availability zone fails | single-AZ database: **restore from backup / PITR** into another AZ (manual, minutes to hours); ALB and tasks move | Aurora promotes the reader in another AZ (automatic); NAT per AZ keeps egress | RTO ≤ 15 min (T3); hours (T2 — the documented trade-off of the lean tier) |
| Bad deploy | application rollback ([rollback](rollback.md)), database untouched | same | RTO ≤ 4 h incl. repair |
| Data corrupted / wrongly changed | PITR to a **side** instance, forward correction (below) | same | RPO ≤ 5 min (PITR), RTO ≤ 4 h |
| Region lost (ap-south-1) | **no cross-region copy on lean**: recovery depends on AWS restoring the region | AWS Backup copies + key replicas in `dr_region` (default ap-south-2): rebuild the cell there | RTO ≤ 24 h, RPO ≤ 24 h (daily copies) for T3; none for T2 |
| Account compromised / deleted | backups in the same account: **not protected** | vault lock (governance) slows deletion; a separate recovery account is recommended | owner decision |

Readiness consequence: a lean pilot must accept "a regional outage stops Portico until AWS recovers"; the hotel needs
the continuity procedures (support-recovery-plan §3) and should know this before signing.

## Data corruption: repair forward, never overwrite

1. Contain: stop the writer (feature off; worker to 0 if a job is at fault). Note the time the damage started (T).
2. Restore a side copy at T−ε:
   ```bash
   aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier <prefix> \
     --target-db-instance-identifier <prefix>-repair-<date> --restore-time <T-minus-epsilon> \
     --db-subnet-group-name <prefix> --vpc-security-group-ids <drill-database SG> --no-publicly-accessible
   # Aurora: restore-db-cluster-to-point-in-time + create-db-instance for the cluster
   ```
   The side copy uses the **drill security group**: no application can connect to it.
3. Compare side copy and production for the affected records; produce the list of corrections.
4. Apply corrections **forward** through the application's own commands (audited, idempotent): reversing/adjusting
   journal entries for money, normal updates (with a reason) for everything else. Never copy rows from the side copy
   into production with SQL.
5. Explain the correction on each affected record; tell the hotel which records changed and why.
6. Delete the side copy; record the incident and the measured times.

## Region loss (resilient tier)

Prerequisites, checked in the quarterly cross-region drill: AWS Backup copies exist in `dr_region`; the
`field-key`, `blind-index-key` and `terms-seal-key` secrets have **replicas** there; ECR images are available (push the
release to a DR-region registry or rebuild from the same commit — not automated).

1. Declare SEV1; tell hotels to use continuity procedures; status page.
2. Decide to fail over (owner): data written after the last cross-region copy (up to 24 h) is at risk; hotels will
   need to re-enter it from their paper logs.
3. Create the DR cell: a new production root with `region = <dr_region>`, its own `cell`/`cidr_block`, the tier
   preset — and the database restored from the latest DR recovery point instead of an empty one (restore the
   recovery point first, then import it into the cell's state or pass its identifier — **procedure not yet
   automated or rehearsed**).
4. Point the app at the **replicated** keys (the DR cell must reuse the replica secrets, not generate new ones —
   new keys would make every encrypted field unreadable).
5. Deploy the same image digests; run the restore-drill `verify.sql` against the restored database before opening it.
6. Move DNS (`api.`/`app.` aliases) to the DR cell's CloudFront distribution.
7. Reconcile: payments with the PSP (Stripe is authoritative for what was charged), channel bookings with Channex
   (re-pull reservations since the recovery point), then Day Close per property.
8. Fail back later as a planned migration, not in a hurry.

The DR region is a **data-residency decision** (where guest data may be copied) — owner decision, `infra/README.md`.

## Evidence that turns a target into a claim

| Claim | Evidence |
|---|---|
| RPO (PITR) ≤ 5 min | monthly PITR drill: known transactions before/after T, restore at T, compare ([backup verification](backup-restore-verification.md)) |
| Restore works and is complete | monthly automated drill evidence JSON + checks 1–7 passed |
| AZ failover RTO | a failover drill (Aurora `failover-db-cluster`, or RDS Multi-AZ reboot with failover) timed against the external health check |
| Region recovery RTO | the quarterly cross-region drill, timed end to end including DNS and reconciliation |
| Hotels can operate during an outage | continuity drill at the property before go-live (launch Gate 3) |

Record each in `docs/readiness/readiness-register.md` with date, tier, method, measured value and who ran it.
