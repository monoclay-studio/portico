import { explainVersionMiss, type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import {
  describeRolePermissions,
  diffRolePermissions,
  groupCatalog,
  indexCatalog,
  type PermissionCatalogIndex,
  validateRolePermissions,
} from '../domain/permissions';
import { NotConfiguredError } from '../errors';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';

/**
 * Custom roles built from the permission catalog (IDN-R10). System role templates are read-only and clonable.
 * Every permission entry is validated against the registered catalog; sensitive (⚑) permissions are flagged so
 * role editors can highlight them; edits are versioned (If-Match) and previewable ("12 staff gain …").
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export function catalogOf(ports: Pick<IdentityPorts, 'permissionCatalog'>): PermissionCatalogIndex {
  if (!ports.permissionCatalog) throw new NotConfiguredError('Role editing', 'the permission catalog');
  return indexCatalog(ports.permissionCatalog());
}

/** The catalog for role editors: grouped by module, with descriptions, scope kinds and ⚑ flags. */
export function getPermissionCatalog(ports: Pick<IdentityPorts, 'permissionCatalog'>) {
  const cat = catalogOf(ports);
  return {
    modules: groupCatalog(cat.all).map((m) => ({
      module: m.module,
      wildcard: m.wildcard,
      containsSensitive: m.permissions.some((p) => p.sensitive === true),
      permissions: m.permissions.map((p) => ({
        key: p.key,
        description: p.description,
        scope: p.scope,
        sensitive: p.sensitive === true,
      })),
    })),
    totals: { permissions: cat.all.length, sensitive: cat.all.filter((p) => p.sensitive).length },
  };
}

type RoleRow = Selectable<IdentityDB['identity.roles']>;

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
  templateKey: string | null;
  archived: boolean;
  version: number;
  sensitivePermissions: string[];
  effectivePermissionCount: number;
  activeAssignments: number;
}

async function toView(tx: TxContext, r: RoleRow, cat: PermissionCatalogIndex | null): Promise<RoleView> {
  const d = cat ? describeRolePermissions(r.permissions, cat) : { effective: [], sensitive: [] };
  const { n } = await db(tx)
    .selectFrom('identity.role_assignments')
    .select(sql<number>`count(distinct user_id)::int`.as('n'))
    .where('role_id', '=', r.id)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return {
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    isSystem: r.is_system,
    templateKey: r.template_key,
    archived: r.archived_at !== null,
    version: r.version,
    sensitivePermissions: d.sensitive,
    effectivePermissionCount: d.effective.length,
    activeAssignments: n,
  };
}

export async function getRole(tx: TxContext, ports: Pick<IdentityPorts, 'permissionCatalog'>, id: string) {
  requirePermission(tx, 'identity.user.read');
  const r = await db(tx).selectFrom('identity.roles').selectAll().where('id', '=', id).executeTakeFirst();
  if (!r) throw new NotFoundError('role', id);
  return toView(tx, r, ports.permissionCatalog ? indexCatalog(ports.permissionCatalog()) : null);
}

export async function listRoleViews(tx: TxContext, ports: Pick<IdentityPorts, 'permissionCatalog'>) {
  requirePermission(tx, 'identity.user.read');
  const rows = await db(tx).selectFrom('identity.roles').selectAll().orderBy('name').execute();
  const cat = ports.permissionCatalog ? indexCatalog(ports.permissionCatalog()) : null;
  return Promise.all(rows.map((r) => toView(tx, r, cat)));
}

function assertValid(entries: readonly string[], cat: PermissionCatalogIndex) {
  const issues = validateRolePermissions(entries, cat);
  if (issues.length) {
    throw new ValidationError(
      'invalid_permissions',
      `Some permissions are not valid: ${issues.map((i) => `${i.entry} (${i.problem.replace(/_/g, ' ')})`).join(', ')}. Choose permissions from the catalog.`,
      { issues },
    );
  }
}

/** The editor may only put permissions into a role that they hold organization-wide themselves. */
function assertEditorHolds(tx: TxContext, entries: readonly string[]) {
  for (const e of entries) {
    if (tx.authz.propertyScope(e) !== 'all')
      throw new ForbiddenError(e, {
        reason: 'You can only add permissions you hold organization-wide yourself.',
      });
  }
}

const KEY_RE = /^[a-z][a-z0-9_]{2,49}$/;

export async function createRole(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  input: {
    key: string;
    name: string;
    description?: string | undefined;
    permissions: string[];
    templateKey?: string | null;
  },
): Promise<RoleView> {
  requirePermission(tx, 'identity.role.manage');
  const cat = catalogOf(ports);
  if (!KEY_RE.test(input.key))
    throw new ValidationError(
      'invalid_role_key',
      'Role keys use 3–50 lowercase letters, digits and underscores.',
    );
  assertValid(input.permissions, cat);
  assertEditorHolds(tx, input.permissions);
  const id = newId();
  try {
    await db(tx)
      .insertInto('identity.roles')
      .values({
        id,
        tenant_id: tx.tenantId,
        key: input.key,
        name: input.name,
        description: input.description ?? '',
        permissions: input.permissions,
        is_system: false,
        template_key: input.templateKey ?? null,
        archived_at: null,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ConflictError('role_key_taken', `A role with key ${input.key} already exists.`);
    throw err;
  }
  const view = await getRole(tx, ports, id);
  await tx.audit({ action: 'identity.role.create', target: { type: 'role', id }, after: view });
  await tx.emit({
    type: 'identity.role.created',
    aggregate: { type: 'role', id },
    payload: { roleId: id, key: input.key, sensitivePermissions: view.sensitivePermissions },
  });
  return view;
}

/** Clone any role (system templates included) into a new editable custom role. */
export async function cloneRole(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  sourceId: string,
  input: { key: string; name: string; description?: string | undefined },
): Promise<RoleView> {
  const src = await db(tx)
    .selectFrom('identity.roles')
    .selectAll()
    .where('id', '=', sourceId)
    .executeTakeFirst();
  if (!src) throw new NotFoundError('role', sourceId);
  const cat = catalogOf(ports);
  // Templates may reference modules that are not installed yet; keep only entries valid in this catalog.
  const valid = src.permissions.filter((p) => validateRolePermissions([p], cat).length === 0);
  return createRole(tx, ports, {
    key: input.key,
    name: input.name,
    description: input.description ?? src.description,
    permissions: valid,
    templateKey: src.key,
  });
}

/** Preview the effect of a permission change on a role before saving it. */
export async function previewRoleChange(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  roleId: string,
  permissions: string[],
) {
  requirePermission(tx, 'identity.role.manage');
  const cat = catalogOf(ports);
  assertValid(permissions, cat);
  const role = await db(tx)
    .selectFrom('identity.roles')
    .selectAll()
    .where('id', '=', roleId)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', roleId);
  const diff = diffRolePermissions(role.permissions, permissions, cat);
  const { n } = await db(tx)
    .selectFrom('identity.role_assignments')
    .select(sql<number>`count(distinct user_id)::int`.as('n'))
    .where('role_id', '=', roleId)
    .where('revoked_at', 'is', null)
    .executeTakeFirstOrThrow();
  return { ...diff, affectedMembers: n };
}

export async function updateRole(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  roleId: string,
  expectedVersion: number,
  patch: { name?: string | undefined; description?: string | undefined; permissions?: string[] | undefined },
): Promise<RoleView> {
  requirePermission(tx, 'identity.role.manage');
  const role = await db(tx)
    .selectFrom('identity.roles')
    .selectAll()
    .where('id', '=', roleId)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', roleId);
  if (role.is_system) {
    throw new BusinessRuleError(
      'system_role_immutable',
      `${role.name} is a system role template and cannot be changed. Clone it to make an editable copy.`,
    );
  }
  if (role.archived_at) throw new BusinessRuleError('role_archived', 'This role is archived.');
  let diff: ReturnType<typeof diffRolePermissions> | null = null;
  if (patch.permissions) {
    const cat = catalogOf(ports);
    assertValid(patch.permissions, cat);
    diff = diffRolePermissions(role.permissions, patch.permissions, cat);
    assertEditorHolds(
      tx,
      patch.permissions.filter((p) => !role.permissions.includes(p)),
    );
  }
  const row = await db(tx)
    .updateTable('identity.roles')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.permissions !== undefined ? { permissions: patch.permissions } : {}),
      version: sql`version + 1`,
    })
    .where('id', '=', roleId)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();
  if (!row) return explainVersionMiss('role', roleId, expectedVersion, async () => role.version);
  const view = await getRole(tx, ports, roleId);
  await tx.audit({
    action: 'identity.role.update',
    target: { type: 'role', id: roleId },
    before: { name: role.name, description: role.description, permissions: role.permissions },
    after: { name: view.name, description: view.description, permissions: view.permissions },
    ...(diff
      ? { metadata: { added: diff.added, removed: diff.removed, addedSensitive: diff.addedSensitive } }
      : {}),
  });
  await tx.emit({
    type: 'identity.role.updated',
    aggregate: { type: 'role', id: roleId },
    payload: { roleId, key: role.key, added: diff?.added ?? [], removed: diff?.removed ?? [] },
  });
  return view;
}

/** Archive a custom role that nobody holds any more (assignment history keeps referring to it). */
export async function archiveRole(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'permissionCatalog'>,
  roleId: string,
  reason: string,
) {
  requirePermission(tx, 'identity.role.manage');
  const role = await db(tx)
    .selectFrom('identity.roles')
    .selectAll()
    .where('id', '=', roleId)
    .executeTakeFirst();
  if (!role) throw new NotFoundError('role', roleId);
  if (role.is_system)
    throw new BusinessRuleError('system_role_immutable', 'System role templates cannot be archived.');
  const inUse = await db(tx)
    .selectFrom('identity.role_assignments')
    .select('id')
    .where('role_id', '=', roleId)
    .where('revoked_at', 'is', null)
    .executeTakeFirst();
  if (inUse)
    throw new BusinessRuleError(
      'role_in_use',
      'Staff still hold this role. Revoke or replace those assignments first.',
    );
  await db(tx)
    .updateTable('identity.roles')
    .set({ archived_at: tx.now, version: sql`version + 1` })
    .where('id', '=', roleId)
    .execute();
  await tx.audit({ action: 'identity.role.archive', target: { type: 'role', id: roleId }, reason });
  return getRole(tx, ports, roleId);
}
