/**
 * Day Close policy per property (platform policy key `dayClose.policy`, inherited organization → property) and the
 * property's schedule row (kept in sync on every save so the worker can find due closes).
 */
import type { TxContext } from '@portico/db';
import { BusinessRuleError, newId, requirePermission, VersionConflictError } from '@portico/kernel';
import type { DayClosePolicy, DayClosePolicyInput } from '../contracts';
import {
  effectiveBlockingCodes,
  POLICY_KEY,
  type ResolvedPolicy,
  resolvePolicyValue,
  validatePolicyInput,
} from '../domain/policy';
import { scheduledInstant } from '../domain/schedule';
import { ADVANCE_PERMISSION, DAY_CLOSE_PERMISSIONS as P } from '../manifest';
import { actorKey, type Deps, db, json } from './context';

export async function resolvePolicy(deps: Deps, tx: TxContext, propertyId: string): Promise<ResolvedPolicy> {
  const raw = await deps.ports.platform.resolvePolicy(tx, propertyId, POLICY_KEY);
  return resolvePolicyValue(raw.value, raw.source);
}

async function scheduleVersion(tx: TxContext, propertyId: string): Promise<number> {
  const s = await db(tx)
    .selectFrom('day_close.schedules')
    .select('version')
    .where('property_id', '=', propertyId)
    .executeTakeFirst();
  return s?.version ?? 0;
}

export async function getPolicy(deps: Deps, tx: TxContext, propertyId: string) {
  requirePermission(tx, P.runRead, { propertyId });
  const r = await resolvePolicy(deps, tx, propertyId);
  return {
    propertyId,
    policy: r.policy,
    source: r.source,
    valid: r.valid,
    problems: r.problems,
    effectiveBlockingCodes: effectiveBlockingCodes(r.policy),
    version: await scheduleVersion(tx, propertyId),
  };
}

/** Save the property's policy. Refused if it would not work (BS v1 item 23), audited, schedule kept in sync. */
export async function updatePolicy(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  input: { policy: DayClosePolicyInput; reason: string },
  expectedVersion: number,
) {
  requirePermission(tx, P.policyManage, { propertyId });
  const { policy, problems } = validatePolicyInput(input.policy);
  if (problems.length) {
    throw new BusinessRuleError(
      'policy_unusable',
      `This Day Close policy cannot be saved: ${problems.join(' ')} Correct it and save again.`,
      { problems },
    );
  }
  const current = await db(tx)
    .selectFrom('day_close.schedules')
    .selectAll()
    .where('property_id', '=', propertyId)
    .forUpdate()
    .executeTakeFirst();
  const currentVersion = current?.version ?? 0;
  if (currentVersion !== expectedVersion) {
    throw new VersionConflictError('day_close_policy', propertyId, expectedVersion, currentVersion);
  }
  // A schedule acts for the person who configured it (review P2-12): enabling it, or changing when or how an enabled
  // schedule closes, needs the sensitive advance permission at the property — `dayClose.policy.manage` alone must not
  // reach the business date through the scheduler's system authority. Who configured it is recorded.
  const s = policy.schedule;
  const scheduleChanged =
    s.enabled &&
    (!current?.enabled || current.local_time !== s.localTime || current.auto_continue !== s.autoContinue);
  if (scheduleChanged) requirePermission(tx, ADVANCE_PERMISSION, { propertyId });
  await deps.ports.platform.setPropertyPolicy(tx, {
    propertyId,
    key: POLICY_KEY,
    value: policy,
    reason: input.reason,
  });
  await syncSchedule(deps, tx, propertyId, policy, current?.skip_date ?? null, {
    configuredBy: scheduleChanged ? actorKey(tx) : (current?.configured_by ?? null),
  });
  await tx.audit({
    action: 'dayClose.policy.update',
    target: { type: 'property', id: propertyId },
    propertyId,
    reason: input.reason,
    after: policy,
  });
  return getPolicy(deps, tx, propertyId);
}

/** Keep the schedule row in step with the policy and the property's current business date. */
export async function syncSchedule(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  policy: DayClosePolicy,
  skipDate: string | null,
  opts: { configuredBy?: string | null } = {},
): Promise<void> {
  const property = await deps.ports.platform.getProperty(tx, propertyId);
  const s = policy.schedule;
  const due = s.enabled
    ? skipDate === property.businessDate
      ? null
      : scheduledInstant(property.businessDate, s.localTime, property.timezone)
    : null;
  const existing = await db(tx)
    .selectFrom('day_close.schedules')
    .select(['version'])
    .where('property_id', '=', propertyId)
    .executeTakeFirst();
  if (existing) {
    await db(tx)
      .updateTable('day_close.schedules')
      .set({
        enabled: s.enabled,
        local_time: s.localTime,
        timezone: property.timezone,
        auto_continue: s.autoContinue,
        configured_by: opts.configuredBy ?? null,
        next_due_at: due,
        version: existing.version + 1,
        updated_at: tx.now,
      })
      .where('property_id', '=', propertyId)
      .execute();
  } else {
    await db(tx)
      .insertInto('day_close.schedules')
      .values({
        tenant_id: tx.tenantId,
        property_id: propertyId,
        enabled: s.enabled,
        local_time: s.localTime,
        timezone: property.timezone,
        auto_continue: s.autoContinue,
        configured_by: opts.configuredBy ?? null,
        next_due_at: due,
        skip_date: skipDate,
        updated_at: tx.now,
      })
      .execute();
  }
  await db(tx)
    .insertInto('day_close.schedule_log')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: propertyId,
      event: 'configured',
      business_date: property.businessDate,
      detail: json({
        enabled: s.enabled,
        localTime: s.localTime,
        nextDueAt: due?.toISOString() ?? null,
        configuredBy: opts.configuredBy ?? null,
      }),
      actor: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
}

/** Skip today's scheduled close (run it by hand instead), logged (PAR-DCL-083). */
export async function skipToday(deps: Deps, tx: TxContext, propertyId: string, reason: string) {
  requirePermission(tx, P.policyManage, { propertyId });
  const property = await deps.ports.platform.getProperty(tx, propertyId);
  const updated = await db(tx)
    .updateTable('day_close.schedules')
    .set((eb) => ({
      skip_date: property.businessDate,
      next_due_at: null,
      version: eb('version', '+', 1),
      updated_at: tx.now,
    }))
    .where('property_id', '=', propertyId)
    .returning(['version'])
    .executeTakeFirst();
  if (!updated) {
    throw new BusinessRuleError(
      'schedule_not_configured',
      'This property has no Day Close schedule to skip. Run Day Close by hand, or set a schedule in the policy.',
    );
  }
  await db(tx)
    .insertInto('day_close.schedule_log')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      property_id: propertyId,
      event: 'skipped_today',
      business_date: property.businessDate,
      detail: json({ reason }),
      actor: actorKey(tx),
      created_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'dayClose.schedule.skipToday',
    target: { type: 'property', id: propertyId },
    propertyId,
    reason,
    after: { businessDate: property.businessDate },
  });
  return { businessDate: property.businessDate, version: updated.version };
}
