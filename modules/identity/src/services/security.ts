import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  actorId,
  BusinessRuleError,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  sha256Hex,
  systemAuthorizer,
  type TenantEnvironment,
} from '@portico/kernel';
import {
  type AlertSeverity,
  alertDedupeKey,
  isCredentialStuffing,
  isMassExport,
  isNewCountry,
  SECURITY_RULES,
  type SecurityAlertRule,
} from '../domain/security-rules';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';

/**
 * Suspicious-activity signals (readiness brief §13; rules in domain/security-rules.ts). Alerts are stored per
 * organization (`identity.security_alerts`) and emitted as `identity.security.alert` events so that comms/ops can
 * notify administrators; platform-level alerts that belong to no organization go to the operator console.
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export async function raiseSecurityAlert(
  tx: TxContext,
  input: {
    rule: SecurityAlertRule;
    severity: AlertSeverity;
    summary: string;
    subjectUserId?: string | null;
    details?: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<boolean> {
  const id = newId();
  const inserted = await db(tx)
    .insertInto('identity.security_alerts')
    .values({
      id,
      tenant_id: tx.tenantId,
      rule: input.rule,
      severity: input.severity,
      subject_user_id: input.subjectUserId ?? null,
      summary: input.summary,
      details: JSON.stringify(input.details ?? {}),
      occurred_at: tx.now,
      dedupe_key: input.dedupeKey,
      acknowledged_by: null,
      acknowledged_at: null,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'dedupe_key']).doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!inserted) return false;
  await tx.emit({
    type: 'identity.security.alert',
    aggregate: { type: 'security_alert', id },
    payload: {
      alertId: id,
      rule: input.rule,
      severity: input.severity,
      summary: input.summary,
      subjectUserId: input.subjectUserId ?? null,
      details: input.details ?? {},
    },
  });
  return true;
}

/**
 * R1: record a sign-in attempt by IP and raise `credential_stuffing_suspected` when one IP fails across many
 * accounts. Raised once per IP per window at platform level, and in each organization of a targeted known account.
 */
export async function recordSignInAttempt(
  database: PorticoDatabase,
  input: { ip: string | undefined; email: string; success: boolean; knownTenantIds: readonly string[] },
): Promise<void> {
  if (!input.ip) return;
  const r = SECURITY_RULES.credentialStuffing;
  const { rows } = await sql<{ failures: number; distinct_accounts: number }>`
    select * from identity.record_login_attempt(${input.ip}, ${sha256Hex(input.email.toLowerCase())}, ${input.success}, ${r.windowMinutes})`.execute(
    database.kysely,
  );
  const stats = { failures: rows[0]?.failures ?? 0, distinctAccounts: rows[0]?.distinct_accounts ?? 0 };
  if (input.success || !isCredentialStuffing(stats)) return;
  const now = database.clock.now();
  const dedupe = alertDedupeKey('credential_stuffing_suspected', input.ip, now, r.windowMinutes);
  await sql`select identity.raise_platform_alert(${newId()}::uuid, 'credential_stuffing_suspected', ${input.ip},
    ${JSON.stringify(stats)}::jsonb, ${dedupe})`.execute(database.kysely);
  if (input.knownTenantIds.length === 0) return;
  const { rows: envs } = await sql<{ id: string; environment: string; status: string }>`
    select id, environment, status from platform.tenant_summaries(${[...input.knownTenantIds]}::uuid[])`.execute(
    database.kysely,
  );
  for (const org of envs.filter((o) => o.status === 'active')) {
    const ctx: RequestContext = {
      tenantId: org.id,
      environment: org.environment as TenantEnvironment,
      actor: { kind: 'system', process: 'security-signals' },
      authz: systemAuthorizer,
      correlationId: newId(),
    };
    await withTenantTx(database, ctx, (tx) =>
      raiseSecurityAlert(tx, {
        rule: 'credential_stuffing_suspected',
        severity: 'high',
        summary: `Many failed sign-ins from IP ${input.ip} across ${stats.distinctAccounts} accounts, including a member of this organization.`,
        details: { ip: input.ip, ...stats, windowMinutes: r.windowMinutes },
        dedupeKey: dedupe,
      }),
    );
  }
}

/** R2: a member signs in from a country never seen for them in this organization. */
export async function checkSignInLocation(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'geo'>,
  input: { userId: string; ip: string | undefined },
): Promise<void> {
  if (!input.ip || !ports.geo) return;
  const country = ports.geo.countryOf(input.ip);
  if (!country) return;
  const known = await db(tx)
    .selectFrom('identity.sign_in_locations')
    .select('country_code')
    .where('user_id', '=', input.userId)
    .execute();
  if (
    isNewCountry(
      country,
      known.map((k) => k.country_code),
    )
  ) {
    await raiseSecurityAlert(tx, {
      rule: 'new_country_sign_in',
      severity: 'medium',
      summary: `Sign-in from a new country (${country}).`,
      subjectUserId: input.userId,
      details: { country, previous: known.map((k) => k.country_code) },
      dedupeKey: alertDedupeKey('new_country_sign_in', `${input.userId}:${country}`, tx.now, 24 * 60),
    });
  }
  await db(tx)
    .insertInto('identity.sign_in_locations')
    .values({
      tenant_id: tx.tenantId,
      user_id: input.userId,
      country_code: country,
      first_seen_at: tx.now,
      last_seen_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'user_id', 'country_code']).doUpdateSet({ last_seen_at: tx.now }),
    )
    .execute();
}

/**
 * R3: modules that export data call this (through their identity port) before producing the export. It records
 * the export, raises `mass_export` past the thresholds, and refuses any export by a Monoclay support session
 * (readiness security assessment §5: "bulk export by support" is prohibited).
 */
export async function recordExportActivity(
  tx: TxContext,
  input: { resource: string; recordCount: number; propertyId?: string | null },
): Promise<void> {
  const actor = tx.actor as RequestContext['actor'] & { via?: string };
  if (actor.via === 'support') {
    throw new BusinessRuleError(
      'support_export_prohibited',
      'Monoclay support sessions cannot export data. Ask the organization to run the export.',
    );
  }
  const actorKey = `${tx.actor.kind}:${actorId(tx.actor)}`;
  await db(tx)
    .insertInto('identity.export_activity')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      actor_key: actorKey,
      resource: input.resource,
      record_count: input.recordCount,
      property_id: input.propertyId ?? null,
      occurred_at: tx.now,
    })
    .execute();
  const r = SECURITY_RULES.massExport;
  const stats = await db(tx)
    .selectFrom('identity.export_activity')
    .select([
      sql<number>`count(*)::int`.as('exports'),
      sql<number>`coalesce(sum(record_count), 0)::int`.as('records'),
    ])
    .where('actor_key', '=', actorKey)
    .where('occurred_at', '>', new Date(tx.now.getTime() - r.windowMinutes * 60_000))
    .executeTakeFirstOrThrow();
  if (isMassExport(stats)) {
    await raiseSecurityAlert(tx, {
      rule: 'mass_export',
      severity: 'high',
      summary: `${actorKey} exported ${stats.records} records in ${stats.exports} exports within ${r.windowMinutes} minutes.`,
      subjectUserId: tx.actor.kind === 'user' ? tx.actor.userId : null,
      details: { ...stats, resource: input.resource },
      dedupeKey: alertDedupeKey('mass_export', actorKey, tx.now, r.windowMinutes),
    });
  }
}

export async function listSecurityAlerts(tx: TxContext, opts: { limit?: number } = {}) {
  requirePermission(tx, 'identity.securityLog.read');
  const rows = await db(tx)
    .selectFrom('identity.security_alerts')
    .selectAll()
    .orderBy('occurred_at', 'desc')
    .limit(Math.min(opts.limit ?? 100, 500))
    .execute();
  return rows.map((r) => ({
    id: r.id,
    rule: r.rule,
    severity: r.severity,
    summary: r.summary,
    subjectUserId: r.subject_user_id,
    details: (r.details ?? {}) as Record<string, unknown>,
    occurredAt: r.occurred_at.toISOString(),
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
  }));
}

export async function acknowledgeSecurityAlert(tx: TxContext, alertId: string, note?: string): Promise<void> {
  requirePermission(tx, 'identity.securityLog.read');
  const res = await db(tx)
    .updateTable('identity.security_alerts')
    .set({ acknowledged_by: `${tx.actor.kind}:${actorId(tx.actor)}`, acknowledged_at: tx.now })
    .where('id', '=', alertId)
    .where('acknowledged_at', 'is', null)
    .executeTakeFirst();
  if (Number(res.numUpdatedRows) === 0) throw new NotFoundError('security_alert', alertId);
  await tx.audit({
    action: 'identity.securityAlert.acknowledge',
    target: { type: 'security_alert', id: alertId },
    reason: note ?? null,
  });
}

/** Operator console: platform-level alerts (no organization). The caller must have authenticated an operator. */
export async function listPlatformAlerts(database: PorticoDatabase, limit = 100) {
  const { rows } = await sql<{
    id: string;
    rule: string;
    subject: string;
    details: unknown;
    occurred_at: Date;
  }>`
    select * from identity.list_platform_alerts(${limit})`.execute(database.kysely);
  return rows.map((r) => ({
    id: r.id,
    rule: r.rule,
    subject: r.subject,
    details: r.details as Record<string, unknown>,
    occurredAt: r.occurred_at.toISOString(),
  }));
}
