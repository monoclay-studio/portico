import { sql, type TxContext, typed } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  canonicalJson,
  NotFoundError,
  newId,
  requirePermission,
  sha256Hex,
  ValidationError,
} from '@portico/kernel';
import {
  type ApplyMode,
  approvalRequired,
  BUNDLE_FORMAT_VERSION,
  type BundleContent,
  type BundleItem,
  type PlannedItem,
  planSection,
  planSummary,
  type SectionPlan,
  type SeparationOfDuties,
} from '../domain/configuration';
import type { OpeningInterval } from '../domain/opening-hours';
import type { ConfigurationSectionProvider, PlatformPorts } from '../ports';
import { actorKey, organizationPolicy, requireEntitlement } from '../service';
import type { PlatformDB } from '../tables';

/**
 * Configuration bundles (templates), bulk setup with dry-run plans, rollout groups and approval with separation of
 * duties (adoption brief §11; PLT-R15, PLT-R29, PLT-R42).
 */
const db = (tx: TxContext) => typed<PlatformDB>(tx.db);

// ───────────────────────────── Platform's own sections ─────────────────────────────

const propertySettingsSection: ConfigurationSectionProvider = {
  key: 'platform.propertySettings',
  title: 'Property settings (check-in and check-out times)',
  schemaVersion: 1,
  carryForward: true,
  async exportItems(tx, propertyId) {
    const p = await db(tx)
      .selectFrom('platform.properties')
      .select(['check_in_time', 'check_out_time'])
      .where('id', '=', propertyId)
      .executeTakeFirstOrThrow();
    return [
      {
        key: 'times',
        value: { checkInTime: p.check_in_time.slice(0, 5), checkOutTime: p.check_out_time.slice(0, 5) },
      },
    ];
  },
  async currentItems(tx, propertyId) {
    const [item] = await this.exportItems(tx, propertyId);
    return new Map(item ? [[item.key, item.value]] : []);
  },
  async applyItems(tx, propertyId, items) {
    for (const i of items) {
      const v = i.after as { checkInTime?: string; checkOutTime?: string };
      await db(tx)
        .updateTable('platform.properties')
        .set({
          ...(v.checkInTime ? { check_in_time: v.checkInTime } : {}),
          ...(v.checkOutTime ? { check_out_time: v.checkOutTime } : {}),
          version: sql`version + 1`,
        })
        .where('id', '=', propertyId)
        .execute();
    }
  },
};

/** Property-level policy values (the model property's local overrides become the template's values). */
const policiesSection: ConfigurationSectionProvider = {
  key: 'platform.policies',
  title: 'Property policies',
  schemaVersion: 1,
  carryForward: true,
  async exportItems(tx, propertyId) {
    const rows = await db(tx)
      .selectFrom('platform.policies')
      .select(['key', 'value'])
      .where('scope_type', '=', 'property')
      .where('scope_id', '=', propertyId)
      .orderBy('key')
      .execute();
    return rows.map((r) => ({ key: r.key, value: { value: r.value } }));
  },
  async currentItems(tx, propertyId) {
    return new Map((await this.exportItems(tx, propertyId)).map((i) => [i.key, i.value]));
  },
  async applyItems(tx, propertyId, items) {
    for (const i of items) {
      const value = JSON.stringify((i.after as { value: unknown }).value);
      await db(tx)
        .insertInto('platform.policies')
        .values({
          id: newId(),
          tenant_id: tx.tenantId,
          key: i.key,
          scope_type: 'property',
          scope_id: propertyId,
          value,
          updated_by: actorKey(tx),
        })
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'key', 'scope_type', 'scope_id']).doUpdateSet({
            value,
            updated_at: tx.now,
            updated_by: actorKey(tx),
            version: sql`platform.policies.version + 1`,
          }),
        )
        .execute();
    }
  },
};

const departmentsSection: ConfigurationSectionProvider = {
  key: 'platform.departments',
  title: 'Departments',
  schemaVersion: 1,
  carryForward: true,
  async exportItems(tx, propertyId) {
    const rows = await db(tx)
      .selectFrom('platform.departments')
      .select(['code', 'name', 'kind'])
      .where('property_id', '=', propertyId)
      .orderBy('code')
      .execute();
    return rows.map((r) => ({ key: r.code, value: { name: r.name, kind: r.kind } }));
  },
  async currentItems(tx, propertyId) {
    return new Map((await this.exportItems(tx, propertyId)).map((i) => [i.key, i.value]));
  },
  async applyItems(tx, propertyId, items) {
    for (const i of items) {
      const v = i.after as { name: string; kind: string };
      if (i.action === 'create') {
        await db(tx)
          .insertInto('platform.departments')
          .values({
            id: newId(),
            tenant_id: tx.tenantId,
            property_id: propertyId,
            code: i.key,
            name: v.name,
            kind: v.kind,
          })
          .execute();
      } else {
        await db(tx)
          .updateTable('platform.departments')
          .set({ name: v.name, kind: v.kind })
          .where('property_id', '=', propertyId)
          .where('code', '=', i.key)
          .execute();
      }
    }
  },
};

/** Outlets travel with a portable legal entity reference: the property's own, or a legal entity by name. */
const outletsSection: ConfigurationSectionProvider = {
  key: 'platform.outlets',
  title: 'Outlets',
  schemaVersion: 1,
  carryForward: true,
  async exportItems(tx, propertyId) {
    const rows = await db(tx)
      .selectFrom('platform.outlets as o')
      .innerJoin('platform.properties as p', 'p.id', 'o.property_id')
      .innerJoin('platform.legal_entities as le', 'le.id', 'o.legal_entity_id')
      .select([
        'o.code',
        'o.name',
        'o.kind',
        'o.default_charge_code_key',
        'o.opening_hours',
        'o.accepts_room_charge',
        'o.legal_entity_id',
        'p.legal_entity_id as property_legal_entity_id',
        'le.name as legal_entity_name',
      ])
      .where('o.property_id', '=', propertyId)
      .where('o.status', '=', 'active')
      .orderBy('o.code')
      .execute();
    return rows.map((r) => ({
      key: r.code,
      value: {
        name: r.name,
        kind: r.kind,
        defaultChargeCodeKey: r.default_charge_code_key,
        openingHours: r.opening_hours,
        acceptsRoomCharge: r.accepts_room_charge,
        legalEntity:
          r.legal_entity_id === r.property_legal_entity_id ? 'property_default' : r.legal_entity_name,
      },
    }));
  },
  async currentItems(tx, propertyId) {
    return new Map((await this.exportItems(tx, propertyId)).map((i) => [i.key, i.value]));
  },
  async validateItems(tx, _propertyId, items) {
    const conflicts = new Map<string, string>();
    const names = new Set(
      (await db(tx).selectFrom('platform.legal_entities').select('name').execute()).map((r) => r.name),
    );
    for (const i of items) {
      const le = i.value.legalEntity;
      if (typeof le === 'string' && le !== 'property_default' && !names.has(le))
        conflicts.set(
          i.key,
          `Legal entity "${le}" does not exist in this organization. Create it or edit the bundle.`,
        );
    }
    return conflicts;
  },
  async applyItems(tx, propertyId, items) {
    const prop = await db(tx)
      .selectFrom('platform.properties')
      .select('legal_entity_id')
      .where('id', '=', propertyId)
      .executeTakeFirstOrThrow();
    for (const i of items) {
      const v = i.after as {
        name: string;
        kind: string;
        defaultChargeCodeKey: string | null;
        openingHours: OpeningInterval[];
        acceptsRoomCharge: boolean;
        legalEntity: string;
      };
      const legalEntityId =
        v.legalEntity === 'property_default'
          ? prop.legal_entity_id
          : (
              await db(tx)
                .selectFrom('platform.legal_entities')
                .select('id')
                .where('name', '=', v.legalEntity)
                .executeTakeFirstOrThrow()
            ).id;
      const values = {
        name: v.name,
        kind: v.kind as never,
        legal_entity_id: legalEntityId,
        default_charge_code_key: v.defaultChargeCodeKey ?? null,
        opening_hours: JSON.stringify(v.openingHours ?? []),
        accepts_room_charge: v.acceptsRoomCharge ?? false,
      };
      if (i.action === 'create') {
        await db(tx)
          .insertInto('platform.outlets')
          .values({ id: newId(), tenant_id: tx.tenantId, property_id: propertyId, code: i.key, ...values })
          .execute();
      } else {
        await db(tx)
          .updateTable('platform.outlets')
          .set({ ...values, version: sql`version + 1` })
          .where('property_id', '=', propertyId)
          .where('code', '=', i.key)
          .execute();
      }
    }
  },
};

/** Platform's contributions; the composition root appends other modules' sections. */
export function platformConfigurationSections(): ConfigurationSectionProvider[] {
  return [propertySettingsSection, policiesSection, departmentsSection, outletsSection];
}

function registry(ports: PlatformPorts): Map<string, ConfigurationSectionProvider> {
  const list = ports.configurationSections ?? platformConfigurationSections();
  return new Map(list.map((s) => [s.key, s]));
}

// ───────────────────────────── Bundles ─────────────────────────────

function bundleChecksum(content: BundleContent): string {
  return sha256Hex(canonicalJson(content));
}

/** Export a property's configuration as content (no storage). `carryForwardOnly` limits to promotable sections. */
export async function buildBundleContent(
  tx: TxContext,
  ports: PlatformPorts,
  propertyId: string,
  opts: { sections?: readonly string[]; carryForwardOnly?: boolean } = {},
): Promise<BundleContent> {
  const reg = registry(ports);
  const keys = opts.sections ?? [...reg.keys()];
  const sections: BundleContent['sections'] = {};
  for (const key of keys) {
    const provider = reg.get(key);
    if (!provider)
      throw new ValidationError('unknown_section', `There is no configuration section "${key}".`, {
        section: key,
      });
    if (opts.carryForwardOnly && !provider.carryForward) continue;
    sections[key] = {
      schemaVersion: provider.schemaVersion,
      items: await provider.exportItems(tx, propertyId),
    };
  }
  return { formatVersion: BUNDLE_FORMAT_VERSION, sections };
}

async function storeBundle(
  tx: TxContext,
  input: {
    name: string;
    description?: string | undefined;
    sourceKind: 'property' | 'trial' | 'upload';
    sourceRef?: string | undefined;
    sourcePropertyId?: string | undefined;
    content: BundleContent;
  },
) {
  if (input.content.formatVersion !== BUNDLE_FORMAT_VERSION) {
    throw new ValidationError(
      'unsupported_bundle_format',
      `This bundle uses format ${input.content.formatVersion}; this Portico reads format ${BUNDLE_FORMAT_VERSION}. Export it again from a current Portico.`,
    );
  }
  await sql`select pg_advisory_xact_lock(hashtext(${`platform.bundle:${tx.tenantId}:${input.name}`}))`.execute(
    tx.db,
  );
  const prev = await db(tx)
    .selectFrom('platform.configuration_bundles')
    .select(sql<number>`coalesce(max(version), 0)`.as('v'))
    .where('name', '=', input.name)
    .executeTakeFirstOrThrow();
  const id = newId();
  const checksum = bundleChecksum(input.content);
  const row = await db(tx)
    .insertInto('platform.configuration_bundles')
    .values({
      id,
      tenant_id: tx.tenantId,
      name: input.name,
      version: Number(prev.v) + 1,
      description: input.description ?? null,
      source_kind: input.sourceKind,
      source_ref: input.sourceRef ?? null,
      source_property_id: input.sourcePropertyId ?? null,
      content: JSON.stringify(input.content),
      checksum,
      created_by: actorKey(tx),
      created_at: tx.now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.configurationBundle.create',
    target: { type: 'configuration_bundle', id },
    after: {
      name: input.name,
      version: row.version,
      sourceKind: input.sourceKind,
      sourceRef: input.sourceRef ?? null,
    },
  });
  return toBundle(row);
}

function toBundle(r: {
  id: string;
  name: string;
  version: number;
  description: string | null;
  source_kind: 'property' | 'trial' | 'upload';
  source_ref: string | null;
  checksum: string;
  created_at: Date;
  content: unknown;
}) {
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    description: r.description,
    sourceKind: r.source_kind,
    sourceRef: r.source_ref,
    checksum: r.checksum,
    createdAt: r.created_at.toISOString(),
    content: r.content as BundleContent,
  };
}

/** Export a property's configuration as a new version of a named bundle. */
export async function exportConfigurationBundle(
  tx: TxContext,
  ports: PlatformPorts,
  propertyId: string,
  input: { name: string; description?: string | undefined; sections?: readonly string[] | undefined },
) {
  requirePermission(tx, 'platform.configuration.export', { propertyId });
  const content = await buildBundleContent(
    tx,
    ports,
    propertyId,
    input.sections ? { sections: input.sections } : {},
  );
  return storeBundle(tx, {
    name: input.name,
    description: input.description,
    sourceKind: 'property',
    sourceRef: propertyId,
    sourcePropertyId: propertyId,
    content,
  });
}

/** Store a bundle received from elsewhere (an upload, or a trial carry-forward). */
export async function importConfigurationBundle(
  tx: TxContext,
  input: {
    name: string;
    description?: string | undefined;
    content: BundleContent;
    sourceKind?: 'upload' | 'trial';
    sourceRef?: string;
  },
) {
  requirePermission(tx, 'platform.configuration.manage');
  return storeBundle(tx, {
    name: input.name,
    description: input.description,
    sourceKind: input.sourceKind ?? 'upload',
    sourceRef: input.sourceRef,
    content: input.content,
  });
}

export async function getConfigurationBundle(tx: TxContext, id: string) {
  requirePermission(tx, 'platform.configuration.manage');
  const row = await db(tx)
    .selectFrom('platform.configuration_bundles')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('configuration_bundle', id);
  return toBundle(row);
}

export async function listConfigurationBundles(tx: TxContext) {
  requirePermission(tx, 'platform.configuration.manage');
  const rows = await db(tx)
    .selectFrom('platform.configuration_bundles')
    .selectAll()
    .orderBy('name')
    .orderBy('version', 'desc')
    .execute();
  return rows.map(toBundle);
}

// ───────────────────────────── Rollout groups ─────────────────────────────

export async function createRolloutGroup(
  tx: TxContext,
  input: {
    key: string;
    name: string;
    stage: 'pilot' | 'wave1' | 'wave2' | 'wave3' | 'wave4' | 'final';
    propertyIds: string[];
  },
) {
  requirePermission(tx, 'platform.rolloutGroup.manage');
  await requireEntitlement(tx, 'portfolio.policies');
  const id = newId();
  try {
    await db(tx)
      .insertInto('platform.rollout_groups')
      .values({ id, tenant_id: tx.tenantId, key: input.key, name: input.name, stage: input.stage })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ConflictError('rollout_group_key_taken', `Rollout group key ${input.key} is already used.`);
    throw err;
  }
  await addMembers(tx, id, input.propertyIds);
  await tx.audit({
    action: 'platform.rolloutGroup.create',
    target: { type: 'rollout_group', id },
    after: input,
  });
  return getRolloutGroup(tx, id);
}

async function addMembers(tx: TxContext, groupId: string, propertyIds: readonly string[]) {
  for (const propertyId of propertyIds) {
    try {
      await db(tx)
        .insertInto('platform.rollout_group_members')
        .values({ tenant_id: tx.tenantId, group_id: groupId, property_id: propertyId })
        .execute();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '23505')
        throw new ConflictError(
          'property_in_other_group',
          `Property ${propertyId} already belongs to a rollout group. Remove it there first.`,
          { propertyId },
        );
      if (code === '23503') throw new NotFoundError('property', propertyId);
      throw err;
    }
  }
}

export async function setRolloutGroupMembers(
  tx: TxContext,
  groupId: string,
  expectedVersion: number,
  propertyIds: string[],
) {
  requirePermission(tx, 'platform.rolloutGroup.manage');
  const before = await getRolloutGroup(tx, groupId);
  const bumped = await db(tx)
    .updateTable('platform.rollout_groups')
    .set({ version: sql`version + 1` })
    .where('id', '=', groupId)
    .where('version', '=', expectedVersion)
    .executeTakeFirst();
  if (Number(bumped.numUpdatedRows) === 0) {
    throw new ConflictError(
      'version_conflict',
      'This rollout group was changed by someone else. Review the latest membership and apply your change again.',
      { currentVersion: before.version, expectedVersion },
    );
  }
  await db(tx).deleteFrom('platform.rollout_group_members').where('group_id', '=', groupId).execute();
  await addMembers(tx, groupId, propertyIds);
  const after = await getRolloutGroup(tx, groupId);
  await tx.audit({
    action: 'platform.rolloutGroup.setMembers',
    target: { type: 'rollout_group', id: groupId },
    before: before.propertyIds,
    after: after.propertyIds,
  });
  return after;
}

export async function getRolloutGroup(tx: TxContext, id: string) {
  const g = await db(tx)
    .selectFrom('platform.rollout_groups')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!g) throw new NotFoundError('rollout_group', id);
  const members = await db(tx)
    .selectFrom('platform.rollout_group_members')
    .select('property_id')
    .where('group_id', '=', id)
    .orderBy('property_id')
    .execute();
  return {
    id: g.id,
    key: g.key,
    name: g.name,
    stage: g.stage,
    propertyIds: members.map((m) => m.property_id),
    version: g.version,
  };
}

export async function listRolloutGroups(tx: TxContext) {
  requirePermission(tx, 'platform.configuration.manage');
  const rows = await db(tx).selectFrom('platform.rollout_groups').select('id').orderBy('key').execute();
  return Promise.all(rows.map((r) => getRolloutGroup(tx, r.id)));
}

// ───────────────────────────── Configuration changes (dry run → approval → apply) ─────────────────────────────

type PropertyPlan = { propertyId: string; propertyName: string; sections: SectionPlan[] };

async function computePlan(
  tx: TxContext,
  ports: PlatformPorts,
  content: BundleContent,
  propertyIds: readonly string[],
  sections: readonly string[],
  mode: ApplyMode,
): Promise<PropertyPlan[]> {
  const reg = registry(ports);
  const props = await db(tx)
    .selectFrom('platform.properties')
    .select(['id', 'name'])
    .where('id', 'in', [...propertyIds])
    .execute();
  const byId = new Map(props.map((p) => [p.id, p.name]));
  const out: PropertyPlan[] = [];
  for (const propertyId of propertyIds) {
    const name = byId.get(propertyId);
    if (!name) throw new NotFoundError('property', propertyId);
    const planned: SectionPlan[] = [];
    for (const key of sections) {
      const source = content.sections[key];
      if (!source) continue;
      const provider = reg.get(key);
      if (!provider) {
        planned.push({
          section: key,
          items: [
            {
              key: '*',
              action: 'conflict',
              before: null,
              after: null,
              note: `Section "${key}" belongs to a module this organization does not run; it will be skipped.`,
            },
          ],
        });
        continue;
      }
      const conflicts = provider.validateItems
        ? await provider.validateItems(tx, propertyId, source.items)
        : undefined;
      planned.push(
        planSection({
          section: key,
          source: source.items,
          current: await provider.currentItems(tx, propertyId),
          mode,
          ...(conflicts ? { conflicts } : {}),
        }),
      );
    }
    out.push({ propertyId, propertyName: name, sections: planned });
  }
  return out;
}

function planHash(plan: PropertyPlan[]): string {
  return sha256Hex(canonicalJson(plan.map((p) => ({ propertyId: p.propertyId, sections: p.sections }))));
}

function toChange(r: {
  id: string;
  bundle_id: string;
  rollout_group_id: string | null;
  target_property_ids: string[];
  sections: string[];
  mode: ApplyMode;
  status: 'pending_approval' | 'approved' | 'applied' | 'rejected' | 'cancelled';
  approval_required: boolean;
  plan: unknown;
  summary: unknown;
  prepared_by: string;
  approved_by: string | null;
  applied_at: Date | null;
  version: number;
}) {
  return {
    id: r.id,
    bundleId: r.bundle_id,
    rolloutGroupId: r.rollout_group_id,
    targetPropertyIds: r.target_property_ids,
    sections: r.sections,
    mode: r.mode,
    status: r.status,
    approvalRequired: r.approval_required,
    plan: r.plan as PropertyPlan[],
    summary: r.summary as ReturnType<typeof planSummary>,
    preparedBy: r.prepared_by,
    approvedBy: r.approved_by,
    appliedAt: r.applied_at?.toISOString() ?? null,
    version: r.version,
  };
}

export const SEPARATION_OF_DUTIES_POLICY = 'platform.configuration.separationOfDuties';

/**
 * Prepare a configuration change: compute the dry-run plan for every target property and store it. Whether a
 * second person must approve follows the organization policy (default: changes to more than one property or to a
 * rollout group need a different approver).
 */
export async function prepareConfigurationChange(
  tx: TxContext,
  ports: PlatformPorts,
  input: {
    bundleId: string;
    propertyIds?: string[] | undefined;
    rolloutGroupId?: string | undefined;
    sections?: string[] | undefined;
    mode?: ApplyMode | undefined;
  },
) {
  requirePermission(tx, 'platform.configuration.manage');
  if (!!input.propertyIds === !!input.rolloutGroupId) {
    throw new ValidationError('target_required', 'Target either a list of properties or one rollout group.');
  }
  const bundle = await getConfigurationBundle(tx, input.bundleId);
  const targets = input.rolloutGroupId
    ? (await getRolloutGroup(tx, input.rolloutGroupId)).propertyIds
    : [...new Set(input.propertyIds)];
  if (targets.length === 0)
    throw new ValidationError('no_targets', 'The rollout group has no properties. Add properties first.');
  if (targets.length > 1 || input.rolloutGroupId) await requireEntitlement(tx, 'portfolio.policies');
  const sections = input.sections ?? Object.keys(bundle.content.sections);
  const mode = input.mode ?? 'preserve_local';
  const plan = await computePlan(tx, ports, bundle.content, targets, sections, mode);
  const summary = planSummary(plan);
  const policy = await organizationPolicy<SeparationOfDuties>(
    tx,
    SEPARATION_OF_DUTIES_POLICY,
    'portfolio_changes',
  );
  const needsApproval = approvalRequired(policy, targets.length, !!input.rolloutGroupId);
  const id = newId();
  const row = await db(tx)
    .insertInto('platform.configuration_changes')
    .values({
      id,
      tenant_id: tx.tenantId,
      bundle_id: bundle.id,
      rollout_group_id: input.rolloutGroupId ?? null,
      target_property_ids: targets,
      sections,
      mode,
      status: needsApproval ? 'pending_approval' : 'approved',
      approval_required: needsApproval,
      plan: JSON.stringify(plan),
      plan_hash: planHash(plan),
      summary: JSON.stringify(summary),
      prepared_by: actorKey(tx),
      prepared_at: tx.now,
      approved_by: null,
      approved_at: null,
      decision_note: null,
      applied_by: null,
      applied_at: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: 'platform.configurationChange.prepare',
    target: { type: 'configuration_change', id },
    after: {
      bundleId: bundle.id,
      bundle: `${bundle.name}@${bundle.version}`,
      targets,
      sections,
      mode,
      summary,
    },
  });
  return toChange(row);
}

export async function getConfigurationChange(tx: TxContext, id: string) {
  requirePermission(tx, 'platform.configuration.manage');
  const row = await db(tx)
    .selectFrom('platform.configuration_changes')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('configuration_change', id);
  return toChange(row);
}

async function decide(
  tx: TxContext,
  id: string,
  decision: 'approved' | 'rejected' | 'cancelled',
  note: string | undefined,
) {
  const change = await db(tx)
    .selectFrom('platform.configuration_changes')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!change) throw new NotFoundError('configuration_change', id);
  if (change.status !== 'pending_approval' && !(decision === 'cancelled' && change.status === 'approved')) {
    throw new BusinessRuleError(
      'change_not_pending',
      `This configuration change is ${change.status.replace('_', ' ')}; it can no longer be ${decision}.`,
    );
  }
  if (decision === 'approved' && change.prepared_by === actorKey(tx)) {
    throw new BusinessRuleError(
      'segregation_of_duties',
      'The person who prepared a portfolio configuration change cannot approve it. Ask another administrator with approval rights.',
      { preparedBy: change.prepared_by },
    );
  }
  const row = await db(tx)
    .updateTable('platform.configuration_changes')
    .set({
      status: decision,
      ...(decision === 'approved' ? { approved_by: actorKey(tx), approved_at: tx.now } : {}),
      decision_note: note ?? null,
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.audit({
    action: `platform.configurationChange.${decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'cancel'}`,
    target: { type: 'configuration_change', id },
    reason: note ?? null,
  });
  return toChange(row);
}

export async function approveConfigurationChange(tx: TxContext, id: string, note?: string) {
  requirePermission(tx, 'platform.configuration.approve');
  return decide(tx, id, 'approved', note);
}

export async function rejectConfigurationChange(tx: TxContext, id: string, note?: string) {
  requirePermission(tx, 'platform.configuration.approve');
  return decide(tx, id, 'rejected', note);
}

export async function cancelConfigurationChange(tx: TxContext, id: string, note?: string) {
  requirePermission(tx, 'platform.configuration.manage');
  return decide(tx, id, 'cancelled', note);
}

/**
 * Apply an approved change. The plan is recomputed first; if anything changed since approval (someone edited a
 * target property, or another change was applied) the apply is refused as stale so nobody applies something other
 * than what was approved. Conflict items are skipped; local differences are kept in `preserve_local` mode.
 */
export async function applyConfigurationChange(tx: TxContext, ports: PlatformPorts, id: string) {
  requirePermission(tx, 'platform.configuration.manage');
  const change = await db(tx)
    .selectFrom('platform.configuration_changes')
    .selectAll()
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!change) throw new NotFoundError('configuration_change', id);
  if (change.status !== 'approved') {
    throw new BusinessRuleError(
      change.status === 'pending_approval' ? 'approval_pending' : 'change_not_applicable',
      change.status === 'pending_approval'
        ? 'This configuration change is waiting for approval by another administrator.'
        : `This configuration change is ${change.status}; it cannot be applied.`,
    );
  }
  const bundle = await getConfigurationBundle(tx, change.bundle_id);
  const plan = await computePlan(
    tx,
    ports,
    bundle.content,
    change.target_property_ids,
    change.sections,
    change.mode,
  );
  if (planHash(plan) !== change.plan_hash) {
    throw new ConflictError(
      'plan_stale',
      'The target properties changed since this plan was prepared and approved. Prepare the change again to see the current effect, then get it approved.',
      { changeId: id },
    );
  }
  const reg = registry(ports);
  for (const p of plan) {
    for (const s of p.sections) {
      const provider = reg.get(s.section);
      const items: PlannedItem[] = s.items.filter((i) => i.action === 'create' || i.action === 'update');
      if (!provider || items.length === 0) continue;
      await provider.applyItems(tx, p.propertyId, items);
    }
    await tx.audit({
      action: 'platform.configuration.apply',
      target: { type: 'property', id: p.propertyId },
      propertyId: p.propertyId,
      after: {
        changeId: id,
        bundle: `${bundle.name}@${bundle.version}`,
        sections: p.sections.map((s) => ({
          section: s.section,
          created: s.items.filter((i) => i.action === 'create').map((i) => i.key),
          updated: s.items.filter((i) => i.action === 'update').map((i) => i.key),
          preserved: s.items.filter((i) => i.action === 'local_preserved').map((i) => i.key),
          conflicts: s.items.filter((i) => i.action === 'conflict').map((i) => i.key),
        })),
      },
    });
  }
  const row = await db(tx)
    .updateTable('platform.configuration_changes')
    .set({ status: 'applied', applied_by: actorKey(tx), applied_at: tx.now, version: sql`version + 1` })
    .where('id', '=', id)
    .returningAll()
    .executeTakeFirstOrThrow();
  await tx.emit({
    type: 'platform.configuration.applied',
    aggregate: { type: 'configuration_change', id },
    payload: {
      changeId: id,
      bundleId: bundle.id,
      propertyIds: change.target_property_ids,
      sections: change.sections,
    },
  });
  return toChange(row);
}

export type { BundleItem };
