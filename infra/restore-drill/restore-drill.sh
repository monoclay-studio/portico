#!/bin/bash
# Monthly automated restore drill (docs/runbooks/backup-restore-verification.md).
#
# 1. Restore the production database to its latest restorable time into a NEW, isolated instance/cluster
#    (security group admits only ops tasks; the application can never connect to it).
# 2. Set a throwaway master password that exists only in this task's memory.
# 3. Run verify.sql (tenant isolation, role privileges, append-only audit, finance hook) and collect evidence.
# 4. Write an evidence JSON to S3 and publish metrics (success/failure, restore duration = measured RTO input).
# 5. ALWAYS delete the restored copy (trap), even on failure.
#
# Required env (set by the ECS task definition in modules/restore-drill):
#   ENGINE (aurora|rds) SOURCE_ID DRILL_PREFIX DB_SUBNET_GROUP DRILL_SECURITY_GROUP_ID KMS_KEY_ID
#   EVIDENCE_BUCKET METRIC_NAMESPACE   optional: DB_NAME (portico) INSTANCE_CLASS AWS_REGION
set -euo pipefail

: "${ENGINE:?}" "${SOURCE_ID:?}" "${DRILL_PREFIX:?}" "${EVIDENCE_BUCKET:?}" "${METRIC_NAMESPACE:?}"
MODE="${MODE:-drill}"
MAX_AGE_DAYS="${MAX_EVIDENCE_AGE_DAYS:-35}"

log() { echo "$(date -u +%FT%TZ) drill[$MODE]: $*"; }
metric() { aws cloudwatch put-metric-data --namespace "$METRIC_NAMESPACE" --metric-name "$1" --value "$2" --unit "${3:-None}" || true; }

# Copies left by a killed run (ECS stop, crash) cost money and keep production data: delete any drill copy older
# than 6 hours. Runs daily (freshness mode) and before every drill.
sweep_orphans() {
  local cutoff n=0 id
  cutoff="$(date -u -d '6 hours ago' +%FT%TZ)"
  for id in $(aws rds describe-db-instances --query "DBInstances[?starts_with(DBInstanceIdentifier, '${DRILL_PREFIX}-drill-') && InstanceCreateTime < '${cutoff}'].DBInstanceIdentifier" --output text); do
    log "orphaned drill instance $id: deleting"; n=$((n + 1))
    aws rds delete-db-instance --db-instance-identifier "$id" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || true
  done
  for id in $(aws rds describe-db-clusters --query "DBClusters[?starts_with(DBClusterIdentifier, '${DRILL_PREFIX}-drill-') && ClusterCreateTime < '${cutoff}'].DBClusterIdentifier" --output text); do
    log "orphaned drill cluster $id: deleting"; n=$((n + 1))
    aws rds delete-db-cluster --db-cluster-identifier "$id" --skip-final-snapshot >/dev/null 2>&1 || true
  done
  metric RestoreDrillOrphansDeleted "$n" Count
}

# Freshness: publish the age (days) of the newest PASSED evidence. No evidence at all → a large age. If this task
# cannot run (image missing, task failing) no datapoint is published and the alarm treats missing data as breaching.
if [ "$MODE" = freshness ]; then
  sweep_orphans
  newest="$(aws s3api list-objects-v2 --bucket "$EVIDENCE_BUCKET" --prefix "restore-drills/${SOURCE_ID}/" \
    --query "sort_by(Contents[?ends_with(Key, '-passed.json')], &LastModified)[-1].LastModified" --output text 2>/dev/null || echo None)"
  if [ -z "$newest" ] || [ "$newest" = "None" ]; then
    age=9999
  else
    age=$(( ($(date -u +%s) - $(date -u -d "$newest" +%s)) / 86400 ))
  fi
  metric RestoreDrillEvidenceAgeDays "$age" Count
  log "newest passed evidence: ${newest:-none} (age ${age} days; alarm above ${MAX_AGE_DAYS})"
  exit 0
fi

: "${DB_SUBNET_GROUP:?}" "${DRILL_SECURITY_GROUP_ID:?}" "${KMS_KEY_ID:?}"
DB_NAME="${DB_NAME:-portico}"
INSTANCE_CLASS="${INSTANCE_CLASS:-db.t4g.medium}"
STAMP="$(date -u +%Y%m%d-%H%M)"
TARGET="${DRILL_PREFIX}-drill-${STAMP}"
WORK="$(mktemp -d)"
STARTED="$(date -u +%s)"
STATUS="failed"
PW="$(openssl rand -hex 24)"

cleanup() {
  local rc=$?
  log "cleanup (exit $rc): deleting restored copy $TARGET"
  if [ "$ENGINE" = aurora ]; then
    aws rds delete-db-instance --db-instance-identifier "${TARGET}-1" --skip-final-snapshot >/dev/null 2>&1 || true
    aws rds wait db-instance-deleted --db-instance-identifier "${TARGET}-1" >/dev/null 2>&1 || true
    aws rds delete-db-cluster --db-cluster-identifier "$TARGET" --skip-final-snapshot >/dev/null 2>&1 || true
  else
    aws rds delete-db-instance --db-instance-identifier "$TARGET" --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 || true
  fi
  if [ "$STATUS" != "passed" ]; then metric RestoreDrillFailure 1; fi
  write_evidence || true
  rm -rf "$WORK"
  exit "$rc"
}

write_evidence() {
  local finished; finished="$(date -u +%s)"
  jq -n \
    --arg source "$SOURCE_ID" --arg engine "$ENGINE" --arg target "$TARGET" --arg status "$STATUS" \
    --arg restore_point "${RESTORE_POINT:-unknown}" \
    --argjson restore_seconds "${RESTORE_SECONDS:-null}" --argjson total_seconds "$((finished - STARTED))" \
    --rawfile checks "$WORK/checks.txt" \
    '{source:$source, engine:$engine, restoredCopy:$target, status:$status, restorePoint:$restore_point,
      restoreSeconds:$restore_seconds, totalSeconds:$total_seconds, checksOutput:$checks,
      note:"Restore drill evidence. RTO input = restoreSeconds (+ app cutover time, not measured here)."}' \
    > "$WORK/evidence.json"
  aws s3 cp "$WORK/evidence.json" "s3://${EVIDENCE_BUCKET}/restore-drills/${SOURCE_ID}/${STAMP}-${STATUS}.json" >/dev/null
  log "evidence: s3://${EVIDENCE_BUCKET}/restore-drills/${SOURCE_ID}/${STAMP}-${STATUS}.json"
}

touch "$WORK/checks.txt"
trap cleanup EXIT
# ECS stops a task with SIGTERM (forwarded by the init process): exit, so the EXIT trap deletes the restored copy.
trap 'log "SIGTERM: stopping, cleaning up"; exit 143' TERM
sweep_orphans

wait_cluster_settled() {
  for _ in $(seq 1 120); do
    local s; s="$(aws rds describe-db-clusters --db-cluster-identifier "$TARGET" --query 'DBClusters[0].[Status, length(PendingModifiedValues || `{}`)]' --output text)"
    [ "$s" = "available	0" ] && return 0
    sleep 15
  done
  return 1
}

wait_instance_settled() {
  for _ in $(seq 1 120); do
    local s; s="$(aws rds describe-db-instances --db-instance-identifier "$1" --query 'DBInstances[0].[DBInstanceStatus, length(PendingModifiedValues || `{}`)]' --output text)"
    [ "$s" = "available	0" ] && return 0
    sleep 15
  done
  return 1
}

if [ "$ENGINE" = aurora ]; then
  RESTORE_POINT="$(aws rds describe-db-clusters --db-cluster-identifier "$SOURCE_ID" --query 'DBClusters[0].LatestRestorableTime' --output text)"
  log "restoring cluster $SOURCE_ID @ $RESTORE_POINT -> $TARGET"
  aws rds restore-db-cluster-to-point-in-time \
    --source-db-cluster-identifier "$SOURCE_ID" --db-cluster-identifier "$TARGET" --use-latest-restorable-time \
    --db-subnet-group-name "$DB_SUBNET_GROUP" --vpc-security-group-ids "$DRILL_SECURITY_GROUP_ID" \
    --kms-key-id "$KMS_KEY_ID" --no-deletion-protection \
    --tags Key=Purpose,Value=restore-drill Key=Source,Value="$SOURCE_ID" >/dev/null
  aws rds wait db-cluster-available --db-cluster-identifier "$TARGET"
  aws rds create-db-instance --db-instance-identifier "${TARGET}-1" --db-cluster-identifier "$TARGET" \
    --engine aurora-postgresql --db-instance-class "$INSTANCE_CLASS" --no-publicly-accessible \
    --tags Key=Purpose,Value=restore-drill >/dev/null
  aws rds wait db-instance-available --db-instance-identifier "${TARGET}-1"
  RESTORE_SECONDS="$(($(date -u +%s) - STARTED))"
  aws rds modify-db-cluster --db-cluster-identifier "$TARGET" --no-manage-master-user-password \
    --master-user-password "$PW" --apply-immediately >/dev/null 2>&1 \
    || aws rds modify-db-cluster --db-cluster-identifier "$TARGET" --master-user-password "$PW" --apply-immediately >/dev/null
  wait_cluster_settled
  HOST="$(aws rds describe-db-clusters --db-cluster-identifier "$TARGET" --query 'DBClusters[0].Endpoint' --output text)"
  MASTER="$(aws rds describe-db-clusters --db-cluster-identifier "$TARGET" --query 'DBClusters[0].MasterUsername' --output text)"
else
  RESTORE_POINT="$(aws rds describe-db-instances --db-instance-identifier "$SOURCE_ID" --query 'DBInstances[0].LatestRestorableTime' --output text)"
  log "restoring instance $SOURCE_ID @ $RESTORE_POINT -> $TARGET"
  aws rds restore-db-instance-to-point-in-time \
    --source-db-instance-identifier "$SOURCE_ID" --target-db-instance-identifier "$TARGET" --use-latest-restorable-time \
    --db-subnet-group-name "$DB_SUBNET_GROUP" --vpc-security-group-ids "$DRILL_SECURITY_GROUP_ID" \
    --db-instance-class "$INSTANCE_CLASS" --no-multi-az --no-publicly-accessible --no-deletion-protection \
    --tags Key=Purpose,Value=restore-drill Key=Source,Value="$SOURCE_ID" >/dev/null
  aws rds wait db-instance-available --db-instance-identifier "$TARGET"
  RESTORE_SECONDS="$(($(date -u +%s) - STARTED))"
  aws rds modify-db-instance --db-instance-identifier "$TARGET" --no-manage-master-user-password \
    --master-user-password "$PW" --apply-immediately >/dev/null 2>&1 \
    || aws rds modify-db-instance --db-instance-identifier "$TARGET" --master-user-password "$PW" --apply-immediately >/dev/null
  wait_instance_settled "$TARGET"
  HOST="$(aws rds describe-db-instances --db-instance-identifier "$TARGET" --query 'DBInstances[0].Endpoint.Address' --output text)"
  MASTER="$(aws rds describe-db-instances --db-instance-identifier "$TARGET" --query 'DBInstances[0].MasterUsername' --output text)"
fi

log "restored in ${RESTORE_SECONDS}s; running verification"
metric RestoreDurationSeconds "$RESTORE_SECONDS" Seconds
PGPASSWORD="$PW" psql "host=$HOST port=5432 dbname=$DB_NAME user=$MASTER sslmode=verify-full sslrootcert=/etc/ssl/certs/rds-global-bundle.pem" \
  -v ON_ERROR_STOP=1 -X -f /drill/verify.sql > "$WORK/checks.txt" 2>&1
# A skipped check is not a passed check (review P3-3): the drill is "incomplete" and pages like a failure.
if grep -q "SKIPPED" "$WORK/checks.txt"; then
  STATUS="incomplete"
  log "drill INCOMPLETE: $(grep -m1 SKIPPED "$WORK/checks.txt")"
  exit 1
fi
STATUS="passed"
metric RestoreDrillSuccess 1
log "drill passed"
