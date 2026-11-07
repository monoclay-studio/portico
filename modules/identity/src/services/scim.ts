import { type Selectable, sql, type TxContext, typed } from '@portico/db';
import { BusinessRuleError, DomainError, EntitlementError, newId, requirePermission } from '@portico/kernel';
import {
  interpretGroupPatch,
  interpretUserPatch,
  parseScimFilter,
  SCIM_ERROR_SCHEMA,
  SCIM_GROUP_SCHEMA,
  SCIM_LIST_SCHEMA,
  SCIM_USER_SCHEMA,
  type ScimPatchOperation,
  scimDisplayName,
} from '../domain/scim';
import type { IdentityPorts } from '../ports';
import type { IdentityDB } from '../tables';
import { assertAdministratorRemains, membershipsElsewhere, revokeApiKeysIssuedBy } from './guard';
import { sendInvitation } from './lifecycle';
import { reconcileMappedRoles } from './mapped-roles';

/**
 * SCIM 2.0 provisioning (RFC 7643/7644) for Users and Groups. The IdP authenticates with an API client token whose
 * permissions include `identity.scim.provision` (created by an administrator; shown once, revocable).
 *  - Users: create (membership, no password — members sign in through SSO), read, list/filter, replace, patch
 *    (`active=false` suspends: sessions, roles and the person's API keys revoked; `active=true` reactivates and
 *    re-applies group roles), delete (membership removed; records kept for audit).
 *  - ADR-0017 §2: a person who also belongs to another organization is provisioned `invited` and accepts while
 *    signed in as themselves; SCIM never activates them silently (`active=true` leaves them invited).
 *  - ADR-0017 §6: deactivating or deleting the last administrator is refused.
 *  - Groups: create, read, list, patch membership, rename, delete. Group membership drives roles through the same
 *    group → role mappings as OIDC (assignments with source `scim`).
 */
const db = (tx: TxContext) => typed<IdentityDB>(tx.db);

export class ScimError extends DomainError {
  readonly scimType: string | undefined;
  constructor(status: number, detail: string, scimType?: string) {
    super(`scim_${scimType ?? status}`, detail, { status, details: scimType ? { scimType } : {} });
    this.scimType = scimType;
  }
  body() {
    return {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(this.status),
      ...(this.scimType ? { scimType: this.scimType } : {}),
      detail: this.message,
    };
  }
}

async function guard(tx: TxContext, ports: Pick<IdentityPorts, 'hasEntitlement'>) {
  requirePermission(tx, 'identity.scim.provision');
  if (ports.hasEntitlement && !(await ports.hasEntitlement(tx, 'identity.scim')))
    throw new EntitlementError('identity.scim');
}

type MemberRow = {
  user_id: string;
  email: string;
  display_name: string;
  status: 'invited' | 'active' | 'suspended' | 'removed';
  external_id: string | null;
  created_at: Date;
  updated_at: Date;
};

function userResource(m: MemberRow, base: string) {
  return {
    schemas: [SCIM_USER_SCHEMA],
    id: m.user_id,
    ...(m.external_id ? { externalId: m.external_id } : {}),
    userName: m.email,
    displayName: m.display_name,
    name: { formatted: m.display_name },
    emails: [{ value: m.email, primary: true, type: 'work' }],
    active: m.status === 'active',
    meta: {
      resourceType: 'User',
      created: m.created_at.toISOString(),
      lastModified: m.updated_at.toISOString(),
      location: `${base}/Users/${m.user_id}`,
    },
  };
}

function memberQuery(tx: TxContext) {
  return db(tx)
    .selectFrom('identity.memberships as m')
    .innerJoin('identity.users as u', 'u.id', 'm.user_id')
    .select([
      'm.user_id',
      'u.email',
      'm.display_name',
      'm.status',
      'm.external_id',
      'm.created_at',
      'm.updated_at',
    ])
    .where('m.status', '<>', 'removed');
}

async function loadMember(tx: TxContext, userId: string): Promise<MemberRow> {
  const m = await memberQuery(tx).where('m.user_id', '=', userId).executeTakeFirst();
  if (!m) throw new ScimError(404, `User ${userId} not found.`);
  return m;
}

export interface ScimUserInput {
  userName: string;
  externalId?: string | undefined;
  displayName?: string | undefined;
  name?:
    | { formatted?: string | undefined; givenName?: string | undefined; familyName?: string | undefined }
    | undefined;
  active?: boolean | undefined;
}

export async function scimCreateUser(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement' | 'notifier' | 'config' | 'organizationName'>,
  base: string,
  input: ScimUserInput,
) {
  await guard(tx, ports);
  const email = input.userName.toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    throw new ScimError(400, 'userName must be the person’s work email.', 'invalidValue');
  const candidate = newId();
  const { rows } = await sql<{
    id: string;
  }>`select identity.ensure_user(${candidate}::uuid, ${email}) as id`.execute(tx.db);
  const userId = rows[0]?.id as string;
  const existing = await db(tx)
    .selectFrom('identity.memberships')
    .select(['id', 'status'])
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (existing && existing.status !== 'removed')
    throw new ScimError(409, `${email} is already provisioned.`, 'uniqueness');
  const active = input.active ?? true;
  // ADR-0017 §2: someone who already works for another organization joins only with their consent.
  const invited = userId !== candidate && (await membershipsElsewhere(tx, userId)) > 0;
  const status = invited ? 'invited' : active ? 'active' : 'suspended';
  const values = {
    display_name: scimDisplayName(input),
    status: status as 'invited' | 'active' | 'suspended',
    activated_at: status === 'active' ? tx.now : null,
    provisioned_by: 'scim' as const,
    external_id: input.externalId ?? null,
    status_reason: null,
    removed_at: null,
  };
  if (existing) {
    await db(tx)
      .updateTable('identity.memberships')
      .set({ ...values, version: sql`version + 1` })
      .where('id', '=', existing.id)
      .execute();
  } else {
    await db(tx)
      .insertInto('identity.memberships')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        user_id: userId,
        job_title: null,
        default_property_id: null,
        ...values,
      })
      .execute();
  }
  await tx.audit({
    action: 'identity.scim.createUser',
    target: { type: 'user', id: userId },
    after: { externalId: input.externalId ?? null, active, status },
  });
  if (invited) {
    await sendInvitation(tx, ports, { userId, email, displayName: values.display_name });
  } else if (status === 'active') {
    await tx.emit({
      type: 'identity.membership.activated',
      aggregate: { type: 'user', id: userId },
      payload: { userId, via: 'scim' },
    });
  }
  await reconcileFromGroups(tx, userId);
  return userResource(await loadMember(tx, userId), base);
}

export async function scimGetUser(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  userId: string,
) {
  await guard(tx, ports);
  return userResource(await loadMember(tx, userId), base);
}

export async function scimListUsers(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  q: { filter?: string | undefined; startIndex?: number | undefined; count?: number | undefined },
) {
  await guard(tx, ports);
  const filter = parseScimFilter(q.filter);
  if (filter === null)
    throw new ScimError(
      400,
      'Only "attribute eq \\"value\\"" filters on userName, externalId, displayName or id are supported.',
      'invalidFilter',
    );
  let query = memberQuery(tx).orderBy('m.created_at');
  if (filter?.attribute === 'userName')
    query = query.where(sql`lower(u.email)`, '=', filter.value.toLowerCase());
  if (filter?.attribute === 'externalId') query = query.where('m.external_id', '=', filter.value);
  if (filter?.attribute === 'displayName') query = query.where('m.display_name', '=', filter.value);
  if (filter?.attribute === 'id') query = query.where('m.user_id', '=', filter.value);
  const all = await query.execute();
  const start = Math.max(1, q.startIndex ?? 1);
  const count = Math.min(Math.max(0, q.count ?? 100), 200);
  const page = all.slice(start - 1, start - 1 + count);
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: all.length,
    startIndex: start,
    itemsPerPage: page.length,
    Resources: page.map((m) => userResource(m, base)),
  };
}

async function setActive(tx: TxContext, userId: string, active: boolean) {
  const m = await loadMember(tx, userId);
  if (m.status === (active ? 'active' : 'suspended')) return;
  // An invitation is accepted only by the person (ADR-0017 §2): SCIM can neither activate nor suspend it.
  if (m.status === 'invited') return;
  if (active) {
    const row = await db(tx)
      .selectFrom('identity.memberships')
      .select('activated_at')
      .where('user_id', '=', userId)
      .executeTakeFirstOrThrow();
    if (row.activated_at === null && (await membershipsElsewhere(tx, userId)) > 0) {
      // Provisioned inactive and never accepted, and the person now works elsewhere too: invite, don't activate.
      await db(tx)
        .updateTable('identity.memberships')
        .set({ status: 'invited', status_reason: 'scim: awaiting acceptance', version: sql`version + 1` })
        .where('user_id', '=', userId)
        .execute();
      await tx.audit({
        action: 'identity.scim.activateUser',
        target: { type: 'user', id: userId },
        metadata: { result: 'invited' },
      });
      return;
    }
    await db(tx)
      .updateTable('identity.memberships')
      .set({
        status: 'active',
        activated_at: tx.now,
        status_reason: 'scim: reactivated',
        version: sql`version + 1`,
      })
      .where('user_id', '=', userId)
      .execute();
    await reconcileFromGroups(tx, userId);
    await tx.emit({
      type: 'identity.membership.activated',
      aggregate: { type: 'user', id: userId },
      payload: { userId, via: 'scim' },
    });
  } else {
    await lastAdministratorGuard(tx, userId);
    await db(tx)
      .updateTable('identity.memberships')
      .set({ status: 'suspended', status_reason: 'scim: deactivated', version: sql`version + 1` })
      .where('user_id', '=', userId)
      .execute();
    await db(tx)
      .updateTable('identity.sessions')
      .set({ revoked_at: tx.now, revoked_reason: 'scim_deactivated' })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    await db(tx)
      .updateTable('identity.role_assignments')
      .set({ revoked_at: tx.now, revoked_by: 'scim', revoke_reason: 'scim_deactivated' })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();
    await revokeApiKeysIssuedBy(tx, userId);
    await tx.emit({
      type: 'identity.membership.suspended',
      aggregate: { type: 'user', id: userId },
      payload: { userId, via: 'scim' },
    });
  }
  await tx.audit({
    action: active ? 'identity.scim.activateUser' : 'identity.scim.deactivateUser',
    target: { type: 'user', id: userId },
  });
}

async function applyUserChanges(
  tx: TxContext,
  userId: string,
  changes: {
    active?: boolean | undefined;
    displayName?: string | undefined;
    externalId?: string | undefined;
  },
) {
  if (changes.displayName !== undefined || changes.externalId !== undefined) {
    await db(tx)
      .updateTable('identity.memberships')
      .set({
        ...(changes.displayName !== undefined ? { display_name: changes.displayName } : {}),
        ...(changes.externalId !== undefined ? { external_id: changes.externalId } : {}),
        version: sql`version + 1`,
      })
      .where('user_id', '=', userId)
      .execute();
    await tx.audit({
      action: 'identity.scim.updateUser',
      target: { type: 'user', id: userId },
      after: changes,
    });
  }
  if (changes.active !== undefined) await setActive(tx, userId, changes.active);
}

export async function scimReplaceUser(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  userId: string,
  input: ScimUserInput,
) {
  await guard(tx, ports);
  const m = await loadMember(tx, userId);
  if (input.userName.toLowerCase() !== m.email.toLowerCase()) {
    throw new ScimError(
      400,
      'userName (email) cannot be changed through SCIM: the sign-in identity may be shared with other organizations.',
      'mutability',
    );
  }
  await applyUserChanges(tx, userId, {
    displayName: scimDisplayName(input),
    ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
    active: input.active ?? true,
  });
  return userResource(await loadMember(tx, userId), base);
}

export async function scimPatchUser(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  userId: string,
  ops: ScimPatchOperation[],
) {
  await guard(tx, ports);
  await loadMember(tx, userId);
  const { changes, unsupported } = interpretUserPatch(ops);
  if (unsupported.length)
    throw new ScimError(400, `Unsupported attributes: ${unsupported.join(', ')}.`, 'invalidPath');
  await applyUserChanges(tx, userId, changes);
  return userResource(await loadMember(tx, userId), base);
}

/** DELETE removes the membership (terminal); the person's records stay for audit attribution. */
export async function scimDeleteUser(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  userId: string,
) {
  await guard(tx, ports);
  await loadMember(tx, userId);
  await lastAdministratorGuard(tx, userId);
  await setActive(tx, userId, false);
  await db(tx)
    .updateTable('identity.memberships')
    .set({ status: 'removed', removed_at: tx.now, status_reason: 'scim: deleted', version: sql`version + 1` })
    .where('user_id', '=', userId)
    .execute();
  await db(tx).deleteFrom('identity.scim_group_members').where('user_id', '=', userId).execute();
  await db(tx).deleteFrom('identity.sso_identities').where('user_id', '=', userId).execute();
  await tx.audit({ action: 'identity.scim.deleteUser', target: { type: 'user', id: userId } });
  await tx.emit({
    type: 'identity.membership.removed',
    aggregate: { type: 'user', id: userId },
    payload: { userId, via: 'scim' },
  });
}

/** ADR-0017 §6 for the identity provider: never deprovision the organization's last administrator. */
async function lastAdministratorGuard(tx: TxContext, userId: string) {
  try {
    await assertAdministratorRemains(tx, { userId });
  } catch (err) {
    if (err instanceof BusinessRuleError) throw new ScimError(409, err.message, 'mutability');
    throw err;
  }
}

// ───────────────────────────── Groups ─────────────────────────────

type GroupRow = Selectable<IdentityDB['identity.scim_groups']>;

async function groupResource(tx: TxContext, g: GroupRow, base: string) {
  const members = await db(tx)
    .selectFrom('identity.scim_group_members as gm')
    .innerJoin('identity.users as u', 'u.id', 'gm.user_id')
    .select(['gm.user_id', 'u.email'])
    .where('gm.group_id', '=', g.id)
    .execute();
  return {
    schemas: [SCIM_GROUP_SCHEMA],
    id: g.id,
    displayName: g.display_name,
    ...(g.external_id ? { externalId: g.external_id } : {}),
    members: members.map((m) => ({ value: m.user_id, display: m.email, $ref: `${base}/Users/${m.user_id}` })),
    meta: {
      resourceType: 'Group',
      created: g.created_at.toISOString(),
      lastModified: g.updated_at.toISOString(),
      location: `${base}/Groups/${g.id}`,
      version: `W/"${g.version}"`,
    },
  };
}

async function loadGroup(tx: TxContext, id: string): Promise<GroupRow> {
  const g = await db(tx)
    .selectFrom('identity.scim_groups')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!g) throw new ScimError(404, `Group ${id} not found.`);
  return g;
}

async function groupNamesOf(tx: TxContext, userId: string): Promise<string[]> {
  const rows = await db(tx)
    .selectFrom('identity.scim_group_members as gm')
    .innerJoin('identity.scim_groups as g', 'g.id', 'gm.group_id')
    .select('g.display_name')
    .where('gm.user_id', '=', userId)
    .execute();
  return rows.map((r) => r.display_name);
}

async function reconcileFromGroups(tx: TxContext, userId: string) {
  const m = await db(tx)
    .selectFrom('identity.memberships')
    .select('status')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (m?.status !== 'active') return;
  await reconcileMappedRoles(tx, userId, 'scim', await groupNamesOf(tx, userId));
}

async function setMembers(
  tx: TxContext,
  groupId: string,
  change: { add: string[]; remove: string[]; replace?: string[] | undefined },
) {
  const current = new Set(
    (
      await db(tx)
        .selectFrom('identity.scim_group_members')
        .select('user_id')
        .where('group_id', '=', groupId)
        .execute()
    ).map((r) => r.user_id),
  );
  const target = new Set(change.replace ?? current);
  for (const a of change.add) target.add(a);
  for (const r of change.remove) target.delete(r);
  const touched = new Set([...current, ...target].filter((u) => current.has(u) !== target.has(u)));
  for (const userId of touched) {
    if (target.has(userId)) {
      const member = await db(tx)
        .selectFrom('identity.memberships')
        .select('id')
        .where('user_id', '=', userId)
        .where('status', '<>', 'removed')
        .executeTakeFirst();
      if (!member) throw new ScimError(400, `Member ${userId} is not a provisioned user.`, 'invalidValue');
      await db(tx)
        .insertInto('identity.scim_group_members')
        .values({ tenant_id: tx.tenantId, group_id: groupId, user_id: userId })
        .execute();
    } else {
      await db(tx)
        .deleteFrom('identity.scim_group_members')
        .where('group_id', '=', groupId)
        .where('user_id', '=', userId)
        .execute();
    }
  }
  for (const userId of touched) await reconcileFromGroups(tx, userId);
  return touched.size;
}

export async function scimCreateGroup(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  input: {
    displayName: string;
    externalId?: string | undefined;
    members?: Array<{ value: string }> | undefined;
  },
) {
  await guard(tx, ports);
  const id = newId();
  try {
    await db(tx)
      .insertInto('identity.scim_groups')
      .values({
        id,
        tenant_id: tx.tenantId,
        display_name: input.displayName,
        external_id: input.externalId ?? null,
      })
      .execute();
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new ScimError(409, `Group ${input.displayName} already exists.`, 'uniqueness');
    throw err;
  }
  await setMembers(tx, id, { add: (input.members ?? []).map((m) => m.value), remove: [] });
  await tx.audit({
    action: 'identity.scim.createGroup',
    target: { type: 'scim_group', id },
    after: { displayName: input.displayName },
  });
  return groupResource(tx, await loadGroup(tx, id), base);
}

export async function scimGetGroup(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  id: string,
) {
  await guard(tx, ports);
  return groupResource(tx, await loadGroup(tx, id), base);
}

export async function scimListGroups(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  q: { filter?: string | undefined },
) {
  await guard(tx, ports);
  const filter = parseScimFilter(q.filter);
  if (
    filter === null ||
    (filter &&
      filter.attribute !== 'displayName' &&
      filter.attribute !== 'externalId' &&
      filter.attribute !== 'id')
  )
    throw new ScimError(400, 'Groups support displayName, externalId and id eq filters.', 'invalidFilter');
  let query = db(tx).selectFrom('identity.scim_groups').selectAll().orderBy('display_name');
  if (filter?.attribute === 'displayName')
    query = query.where(sql`lower(display_name)`, '=', filter.value.toLowerCase());
  if (filter?.attribute === 'externalId') query = query.where('external_id', '=', filter.value);
  if (filter?.attribute === 'id') query = query.where('id', '=', filter.value);
  const rows = await query.execute();
  return {
    schemas: [SCIM_LIST_SCHEMA],
    totalResults: rows.length,
    startIndex: 1,
    itemsPerPage: rows.length,
    Resources: await Promise.all(rows.map((g) => groupResource(tx, g, base))),
  };
}

export async function scimPatchGroup(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  base: string,
  id: string,
  ops: ScimPatchOperation[],
) {
  await guard(tx, ports);
  const g = await loadGroup(tx, id);
  const { changes, unsupported } = interpretGroupPatch(ops);
  if (unsupported.length)
    throw new ScimError(400, `Unsupported operations: ${unsupported.join(', ')}.`, 'invalidPath');
  if (changes.displayName && changes.displayName !== g.display_name) {
    await db(tx)
      .updateTable('identity.scim_groups')
      .set({ display_name: changes.displayName, version: sql`version + 1` })
      .where('id', '=', id)
      .execute();
    // A rename can change which mapping applies: reconcile every member.
    const members = await db(tx)
      .selectFrom('identity.scim_group_members')
      .select('user_id')
      .where('group_id', '=', id)
      .execute();
    for (const m of members) await reconcileFromGroups(tx, m.user_id);
  }
  const touched = await setMembers(tx, id, {
    add: changes.addMembers,
    remove: changes.removeMembers,
    replace: changes.replaceMembers,
  });
  if (touched)
    await db(tx)
      .updateTable('identity.scim_groups')
      .set({ version: sql`version + 1` })
      .where('id', '=', id)
      .execute();
  await tx.audit({ action: 'identity.scim.patchGroup', target: { type: 'scim_group', id }, after: changes });
  return groupResource(tx, await loadGroup(tx, id), base);
}

export async function scimDeleteGroup(
  tx: TxContext,
  ports: Pick<IdentityPorts, 'hasEntitlement'>,
  id: string,
) {
  await guard(tx, ports);
  await loadGroup(tx, id);
  const members = await db(tx)
    .selectFrom('identity.scim_group_members')
    .select('user_id')
    .where('group_id', '=', id)
    .execute();
  await db(tx).deleteFrom('identity.scim_groups').where('id', '=', id).execute();
  for (const m of members) await reconcileFromGroups(tx, m.user_id);
  await tx.audit({ action: 'identity.scim.deleteGroup', target: { type: 'scim_group', id } });
}
