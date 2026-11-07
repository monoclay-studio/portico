import { type PorticoDatabase, sql, type TxContext, typed, withTenantTx } from '@portico/db';
import {
  BusinessRuleError,
  effectMode,
  ForbiddenError,
  NotFoundError,
  newId,
  type RequestContext,
  requirePermission,
  systemAuthorizer,
  type TenantEnvironment,
  ValidationError,
} from '@portico/kernel';
import { ALL_EFFECTS } from '../domain/activation';
import { isCarryForwardAllowed } from '../domain/configuration';
import type { PlatformPorts } from '../ports';
import { actorKey, getOrganization } from '../service';
import type { PlatformDB } from '../tables';
import { buildBundleContent, importConfigurationBundle } from './configuration';

/**
 * Environments and the trial lifecycle (adoption brief §3; docs/adoption/evaluation-and-trial.md §4, §8, §9).
 * A trial is a separate organization (tenant) with environment `trial`, linked to the hotel's live organization
 * when the hotel is already a customer, or to a prospect name otherwise.
 */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

/** Days between a trial deletion request and the purge of its primary data (evaluation-and-trial.md §8). */
export const TRIAL_DELETION_GRACE_DAYS = 7;

const BANNERS: Record<Exclude<TenantEnvironment, 'live'>, { title: string; detail: string }> = {
  trial: {
    title: 'Trial',
    detail:
      'Copy of your data for evaluation. Nothing you do here reaches guests, cards, channels, government systems or your other systems; read-only connections only.',
  },
  demo: {
    title: 'Demo',
    detail:
      'Sample properties and fictitious guests. Every payment, message and channel update is simulated.',
  },
  training: {
    title: 'Training',
    detail: 'Practice environment with sample data. Payments, messages and channel updates are simulated.',
  },
  sandbox: {
    title: 'Sandbox',
    detail: 'Integration sandbox. Providers are called in their test modes only; nothing is real.',
  },
};

/** What the environment banner and provenance labels need (PLT-R03, CLAUDE.md rule 16). */
export async function getEnvironmentInfo(tx: TxContext) {
  const org = await getOrganization(tx);
  const effects: Record<string, 'live' | 'sandbox' | 'simulate' | 'blocked'> = {};
  for (const e of ALL_EFFECTS) effects[e] = effectMode({ environment: org.environment }, e);
  const lifecycle =
    org.environment === 'trial'
      ? await db(tx).selectFrom('platform.trial_lifecycle').selectAll().executeTakeFirst()
      : undefined;
  const lastImport =
    org.environment === 'trial'
      ? await db(tx)
          .selectFrom('platform.trial_imports')
          .select('copied_at')
          .orderBy('copied_at', 'desc')
          .executeTakeFirst()
      : undefined;
  const banner = org.environment === 'live' ? null : BANNERS[org.environment];
  return {
    organizationId: org.id,
    environment: org.environment,
    banner:
      banner && lastImport
        ? { ...banner, detail: `${banner.detail} Data copied ${lastImport.copied_at.toISOString()}.` }
        : banner,
    effects,
    importedDataProvenance: (org.environment === 'live'
      ? 'live'
      : org.environment === 'trial'
        ? 'copied'
        : 'simulated') as 'live' | 'copied' | 'simulated',
    trial: lifecycle
      ? {
          sourceOrganizationId: lifecycle.source_tenant_id,
          prospectName: lifecycle.prospect_name,
          status: lifecycle.status,
          lastCopiedAt: lastImport?.copied_at.toISOString() ?? null,
          resetCount: lifecycle.reset_count,
          lastResetAt: lifecycle.last_reset_at?.toISOString() ?? null,
          deletionDueAt: lifecycle.deletion_due_at?.toISOString() ?? null,
        }
      : null,
  };
}

/** Provenance a module should show for a record (rule 16): imported trial data is `copied`. */
export function provenanceFor(
  environment: TenantEnvironment,
  record: { imported: boolean },
): 'live' | 'copied' | 'simulated' {
  if (environment === 'live') return 'live';
  if (environment === 'trial' && record.imported) return 'copied';
  return 'simulated';
}

async function assertTrial(tx: TxContext) {
  const org = await getOrganization(tx);
  if (tx.environment !== 'trial' || org.environment !== 'trial') {
    throw new BusinessRuleError(
      'not_a_trial',
      'This action is only available in a trial organization. Live organizations are never reset or deleted this way.',
      { environment: org.environment },
    );
  }
  const lifecycle = await db(tx).selectFrom('platform.trial_lifecycle').selectAll().executeTakeFirst();
  if (!lifecycle) throw new NotFoundError('trial');
  return { org, lifecycle };
}

/** Called inside the new trial organization when it is provisioned. */
export async function initTrialLifecycle(
  tx: TxContext,
  input: { sourceTenantId?: string | undefined; prospectName?: string | undefined },
): Promise<void> {
  if (tx.environment !== 'trial')
    throw new ValidationError('not_a_trial', 'Only trial organizations have a trial record.');
  if (!input.sourceTenantId && !input.prospectName)
    throw new ValidationError(
      'trial_owner_required',
      'A trial belongs to a live organization or a named prospect.',
    );
  await db(tx)
    .insertInto('platform.trial_lifecycle')
    .values({
      tenant_id: tx.tenantId,
      source_tenant_id: input.sourceTenantId ?? null,
      prospect_name: input.prospectName ?? null,
      created_by: actorKey(tx),
      created_at: tx.now,
      last_reset_at: null,
      closed_at: null,
      closed_by: null,
      close_reason: null,
      deletion_due_at: null,
    })
    .execute();
  await tx.audit({
    action: 'platform.trial.create',
    target: { type: 'organization', id: tx.tenantId },
    after: input,
  });
}

/** Record, in the live organization, that a trial/training/sandbox organization belongs to it. */
export async function linkEnvironment(
  tx: TxContext,
  input: { linkedTenantId: string; environment: 'trial' | 'training' | 'sandbox'; name: string },
): Promise<void> {
  await db(tx)
    .insertInto('platform.environment_links')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      linked_tenant_id: input.linkedTenantId,
      environment: input.environment,
      name: input.name,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'linked_tenant_id']).doNothing())
    .execute();
  await tx.audit({
    action: 'platform.environment.link',
    target: { type: 'organization', id: input.linkedTenantId },
    after: input,
  });
}

/** The organization's linked environments, with their current status from the tenant directory. */
export async function listLinkedEnvironments(tx: TxContext) {
  requirePermission(tx, 'platform.trial.manage');
  const links = await db(tx)
    .selectFrom('platform.environment_links')
    .selectAll()
    .orderBy('created_at')
    .execute();
  if (links.length === 0) return [];
  const { rows } = await sql<{ id: string; status: string }>`
    select id, status from platform.tenant_summaries(${links.map((l) => l.linked_tenant_id)}::uuid[])`.execute(
    tx.db,
  );
  const status = new Map(rows.map((r) => [r.id, r.status]));
  return links.map((l) => ({
    organizationId: l.linked_tenant_id,
    environment: l.environment,
    name: l.name,
    status: status.get(l.linked_tenant_id) ?? 'closed',
    createdAt: l.created_at.toISOString(),
  }));
}

/** Integration records each authorized copy into the trial; the banner shows the copy time (provenance). */
export async function recordTrialImport(
  tx: TxContext,
  input: { sourceSystem: string; copiedAt: Date; recordCounts: Record<string, number> },
): Promise<void> {
  requirePermission(tx, 'platform.trial.manage');
  await assertTrial(tx);
  await db(tx)
    .insertInto('platform.trial_imports')
    .values({
      id: newId(),
      tenant_id: tx.tenantId,
      source_system: input.sourceSystem,
      copied_at: input.copiedAt,
      record_counts: JSON.stringify(input.recordCounts),
      recorded_by: actorKey(tx),
      recorded_at: tx.now,
    })
    .execute();
  await tx.audit({
    action: 'platform.trial.import',
    target: { type: 'organization', id: tx.tenantId },
    after: input,
  });
}

function assertConfirmation(orgName: string, confirm: string) {
  if (confirm.trim() !== orgName) {
    throw new ValidationError(
      'confirmation_mismatch',
      `Type the trial organization's name exactly ("${orgName}") to confirm.`,
    );
  }
}

/**
 * Reset a trial: every registered module deletes its operational data (bookings, guests, folios, tasks …);
 * configuration and the audit history stay. Refused outside trial organizations.
 */
export async function resetTrial(
  tx: TxContext,
  ports: PlatformPorts,
  input: { reason: string; confirmOrganizationName: string },
) {
  requirePermission(tx, 'platform.trial.manage');
  const { org, lifecycle } = await assertTrial(tx);
  assertConfirmation(org.name, input.confirmOrganizationName);
  if (lifecycle.status !== 'active')
    throw new BusinessRuleError('trial_closed', 'This trial has been closed and is scheduled for deletion.');
  const removed: Record<string, number> = {};
  for (const p of ports.trialParticipants ?? [])
    removed[p.module] = (await p.resetOperationalData(tx)).removed;
  await db(tx)
    .updateTable('platform.trial_lifecycle')
    .set({ reset_count: sql`reset_count + 1`, last_reset_at: tx.now, version: sql`version + 1` })
    .execute();
  await tx.audit({
    action: 'platform.trial.reset',
    target: { type: 'organization', id: tx.tenantId },
    reason: input.reason,
    after: { removed },
  });
  await tx.emit({
    type: 'platform.trial.reset',
    aggregate: { type: 'organization', id: tx.tenantId },
    payload: { removed },
  });
  return { removed, resetCount: lifecycle.reset_count + 1 };
}

/** Export the whole trial: configuration of every property plus each module's operational data, labeled TRIAL. */
export async function exportTrial(tx: TxContext, ports: PlatformPorts) {
  requirePermission(tx, 'platform.trial.manage');
  const { org } = await assertTrial(tx);
  const properties = await db(tx).selectFrom('platform.properties').select(['id', 'code', 'name']).execute();
  const configuration: Record<string, unknown> = {};
  for (const p of properties) configuration[p.code] = await buildBundleContent(tx, ports, p.id);
  const operationalData: Record<string, unknown> = {};
  for (const p of ports.trialParticipants ?? [])
    if (p.exportOperationalData) operationalData[p.module] = await p.exportOperationalData(tx);
  await tx.audit({ action: 'platform.trial.export', target: { type: 'organization', id: tx.tenantId } });
  return {
    label: 'TRIAL' as const,
    organization: { id: org.id, name: org.name },
    exportedAt: tx.now.toISOString(),
    provenance: 'copied' as const,
    environment: await getEnvironmentInfo(tx),
    configuration,
    operationalData,
  };
}

/**
 * Close (delete) a trial: the organization is closed immediately (no sign-in, no API access) and its primary data
 * is scheduled for purge after a short grace period. A legal hold prevents closing. Copies held in backups age
 * out with the backup retention period (stated in the processing terms; Q63).
 */
export async function closeTrial(tx: TxContext, input: { reason: string; confirmOrganizationName: string }) {
  requirePermission(tx, 'platform.trial.manage');
  const { org, lifecycle } = await assertTrial(tx);
  assertConfirmation(org.name, input.confirmOrganizationName);
  if (lifecycle.legal_hold)
    throw new BusinessRuleError('legal_hold', 'This trial is under a legal hold and cannot be deleted now.');
  if (lifecycle.status === 'closed')
    throw new BusinessRuleError('trial_closed', 'This trial is already closed.');
  const due = new Date(tx.now.getTime() + TRIAL_DELETION_GRACE_DAYS * 86_400_000);
  await db(tx)
    .updateTable('platform.trial_lifecycle')
    .set({
      status: 'closed',
      closed_at: tx.now,
      closed_by: actorKey(tx),
      close_reason: input.reason,
      deletion_due_at: due,
      version: sql`version + 1`,
    })
    .execute();
  await db(tx)
    .updateTable('platform.tenants')
    .set({ status: 'closed', version: sql`version + 1` })
    .where('id', '=', tx.tenantId)
    .execute();
  await tx.audit({
    action: 'platform.trial.close',
    target: { type: 'organization', id: tx.tenantId },
    reason: input.reason,
    after: { deletionDueAt: due.toISOString() },
  });
  await tx.emit({
    type: 'platform.trial.closed',
    aggregate: { type: 'organization', id: tx.tenantId },
    payload: { deletionDueAt: due.toISOString(), sourceTenantId: lifecycle.source_tenant_id },
  });
  return { deletionDueAt: due.toISOString() };
}

/**
 * Carry configuration forward from a linked trial into this (live) organization as a configuration bundle.
 * Only sections that may move to production are copied (never reservations, guests, money or credentials —
 * evaluation-and-trial.md §9). The bundle is then applied through the normal dry run → approval → apply path.
 */
export async function pullTrialConfiguration(
  database: PorticoDatabase,
  ctx: RequestContext,
  ports: PlatformPorts,
  input: {
    trialOrganizationId: string;
    trialPropertyId: string;
    bundleName: string;
    sections?: string[] | undefined;
  },
) {
  await withTenantTx(database, ctx, async (tx) => {
    requirePermission(tx, 'platform.trial.manage');
    requirePermission(tx, 'platform.configuration.manage');
    const link = await db(tx)
      .selectFrom('platform.environment_links')
      .select(['environment'])
      .where('linked_tenant_id', '=', input.trialOrganizationId)
      .executeTakeFirst();
    if (link?.environment !== 'trial') throw new NotFoundError('trial', input.trialOrganizationId);
  });
  const trialCtx: RequestContext = {
    tenantId: input.trialOrganizationId,
    environment: 'trial',
    actor: { kind: 'system', process: `carry-forward:${ctx.tenantId}` },
    authz: systemAuthorizer,
    correlationId: ctx.correlationId,
  };
  const reg = new Map((ports.configurationSections ?? []).map((s) => [s.key, s.carryForward]));
  const content = await withTenantTx(database, trialCtx, async (tx) => {
    const lifecycle = await db(tx).selectFrom('platform.trial_lifecycle').selectAll().executeTakeFirst();
    if (lifecycle?.source_tenant_id !== ctx.tenantId) throw new ForbiddenError('platform.trial.manage');
    const bundle = await buildBundleContent(tx, ports, input.trialPropertyId, {
      ...(input.sections ? { sections: input.sections } : {}),
      carryForwardOnly: true,
    });
    for (const key of Object.keys(bundle.sections))
      if (!isCarryForwardAllowed(key, reg.get(key) ?? true)) delete bundle.sections[key];
    await tx.audit({
      action: 'platform.trial.carryForward',
      target: { type: 'property', id: input.trialPropertyId },
      propertyId: input.trialPropertyId,
      after: { toOrganization: ctx.tenantId, sections: Object.keys(bundle.sections) },
    });
    return bundle;
  });
  return withTenantTx(database, ctx, (tx) =>
    importConfigurationBundle(tx, {
      name: input.bundleName,
      description: `Carried forward from trial ${input.trialOrganizationId}`,
      content,
      sourceKind: 'trial',
      sourceRef: `${input.trialOrganizationId}:${input.trialPropertyId}`,
    }),
  );
}
