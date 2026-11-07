/**
 * Shared service internals: typed DB handle, access resolution (profile scoping), profile loading with merge
 * chain resolution, write guards (permission + data authority).
 */
import { type Selectable, sql, type TxContext, typed } from '@portico/db';
import {
  actorId,
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import { followMergeChain } from '../domain/merge';
import {
  type AccessScope,
  aggregateSharingConsent,
  profileVisibility,
  type SharingConsentState,
  type Visibility,
} from '../domain/visibility';
import { CROSS_PROPERTY_FEATURE } from '../manifest';
import type { GuestsPorts } from '../ports';
import type { GuestsDB, ProfilesTable } from '../tables';

export const db = (tx: TxContext) => typed<GuestsDB>(tx.db);
export const actorKey = (tx: TxContext) => `${tx.actor.kind}:${actorId(tx.actor)}`;
export const today = (tx: TxContext) => tx.now.toISOString().slice(0, 10);
export const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : new Date(d).toISOString();

export function pgCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? String((err as { code: unknown }).code)
    : undefined;
}

export type ProfileRow = Selectable<ProfilesTable>;

/** Organization policy for cross-property sharing (platform policy, resolvable per property). Q46 default. */
export const SHARING_POLICY_KEY = 'guests.crossPropertySharing';
export interface SharingPolicy {
  enabled: boolean;
  requireConsent: boolean;
}
export const SHARING_POLICY_DEFAULT: SharingPolicy = { enabled: true, requireConsent: false };

export interface ResolvedAccess extends AccessScope {
  readPrivateNotes: readonly string[] | 'all';
  /** Viewing property, when the caller asked for a property-specific view. */
  propertyId: string | null;
}

/**
 * Compute what the current actor may see. With `propertyId`, the view is narrowed to that property (the desk's
 * current property) — "a user at P without readShared sees nothing for a profile with no stay at P" (GUE-I05).
 */
export async function resolveAccess(
  tx: TxContext,
  ports: GuestsPorts,
  opts: { propertyId?: string | null } = {},
): Promise<ResolvedAccess> {
  const R = tx.authz.propertyScope('guests.profile.read');
  const S = tx.authz.propertyScope('guests.profile.readShared');
  const P = opts.propertyId ?? null;
  let readAll = R === 'all';
  let readPropertyIds: string[] = R === 'all' ? [] : [...R];
  if (P) {
    const has = readAll || readPropertyIds.includes(P);
    readAll = false;
    readPropertyIds = has ? [P] : [];
  }
  let viewing: string[];
  if (P) viewing = S === 'all' || S.includes(P) ? [P] : [];
  else if (readAll) viewing = [];
  else viewing = S === 'all' ? await ports.platform.listPropertyIds(tx) : [...S];

  let sharedViewing = false;
  let sharingRequiresConsent = false;
  if (viewing.length > 0 && (await ports.platform.hasEntitlement(tx, CROSS_PROPERTY_FEATURE))) {
    for (const v of viewing) {
      const pol = await ports.platform.resolvePolicy(tx, v, SHARING_POLICY_KEY, SHARING_POLICY_DEFAULT);
      const value = { ...SHARING_POLICY_DEFAULT, ...(pol.value ?? {}) };
      if (value.enabled) {
        sharedViewing = true;
        if (value.requireConsent) sharingRequiresConsent = true;
      }
    }
  }
  const rp = tx.authz.propertyScope('guests.note.readPrivate');
  return {
    readAll,
    readPropertyIds,
    sharedViewing,
    sharingRequiresConsent,
    readPrivateNotes: rp === 'all' ? 'all' : [...rp],
    propertyId: P,
  };
}

/** The actor holds no guest-profile permission at all → 403 (more helpful than 404 for every id). */
export function requireSomeProfileRead(tx: TxContext): void {
  if (!tx.authz.can('guests.profile.read') && !tx.authz.can('guests.profile.readShared')) {
    throw new ForbiddenError('guests.profile.read');
  }
}

export async function loadProfileRow(tx: TxContext, id: string, opts: { forUpdate?: boolean } = {}) {
  let q = db(tx).selectFrom('guests.profiles').selectAll().where('id', '=', id);
  if (opts.forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** Follow merged_into to the active survivor (GUE-I01, GUE-R13). Returns the chain when it was followed. */
export async function resolveSurvivor(
  tx: TxContext,
  id: string,
): Promise<{ row: ProfileRow; resolvedFrom: string[] | undefined }> {
  const seen = new Map<string, ProfileRow>();
  let cursor: string | null = id;
  for (let i = 0; cursor && i < 33; i++) {
    const row = await loadProfileRow(tx, cursor);
    if (!row) break;
    seen.set(row.id, row);
    cursor = row.status === 'merged' ? row.merged_into : null;
    if (cursor && seen.has(cursor)) break;
  }
  const chain = followMergeChain(id, (x) => {
    const r = seen.get(x);
    return r ? { status: r.status, mergedInto: r.merged_into } : undefined;
  });
  const row = seen.get(chain.id);
  if (!row) throw new NotFoundError('guest_profile', id);
  return { row, resolvedFrom: chain.path.length > 1 ? chain.path.slice(0, -1) : undefined };
}

export async function linkedPropertyIds(tx: TxContext, profileId: string): Promise<string[]> {
  const rows = await db(tx)
    .selectFrom('guests.profile_properties')
    .select('property_id')
    .where('profile_id', '=', profileId)
    .execute();
  return rows.map((r) => r.property_id);
}

export async function sharingConsent(tx: TxContext, profileId: string): Promise<SharingConsentState> {
  const rows = await db(tx)
    .selectFrom('guests.consents')
    .select('state')
    .where('profile_id', '=', profileId)
    .where('purpose', '=', 'cross_property_sharing')
    .execute();
  return aggregateSharingConsent(rows.map((r) => r.state));
}

export interface VisibleProfile {
  row: ProfileRow;
  resolvedFrom: string[] | undefined;
  view: Exclude<Visibility, 'none'>;
  links: string[];
  consent: SharingConsentState;
  access: ResolvedAccess;
}

/** Load a profile (following merges) and check the actor may see it; 404 otherwise (never reveals existence). */
export async function requireVisibleProfile(
  tx: TxContext,
  ports: GuestsPorts,
  id: string,
  opts: { propertyId?: string | null; access?: ResolvedAccess } = {},
): Promise<VisibleProfile> {
  requireSomeProfileRead(tx);
  const access = opts.access ?? (await resolveAccess(tx, ports, { propertyId: opts.propertyId ?? null }));
  const { row, resolvedFrom } = await resolveSurvivor(tx, id);
  const links = await linkedPropertyIds(tx, row.id);
  const consent = await sharingConsent(tx, row.id);
  const view = profileVisibility(access, links, consent);
  if (view === 'none') throw new NotFoundError('guest_profile', id);
  return { row, resolvedFrom, view, links, consent, access };
}

/**
 * The property a write is performed at: the given one (permission checked there) or the first property the
 * profile is known at where the actor holds the permission. Org-wide holders default to the home property.
 */
export function actingProperty(
  tx: TxContext,
  permission: string,
  profile: { home_property_id: string },
  links: readonly string[],
  propertyId?: string | null,
): string {
  if (propertyId) {
    requirePermission(tx, permission, { propertyId });
    return propertyId;
  }
  const scope = tx.authz.propertyScope(permission);
  if (scope === 'all') return profile.home_property_id;
  const hit = links.find((p) => scope.includes(p));
  if (!hit) throw new ForbiddenError(permission);
  return hit;
}

/** Write access to a profile at a property: permission there + the profile must be visible there. */
export async function requireWritableProfile(
  tx: TxContext,
  ports: GuestsPorts,
  id: string,
  permission: string,
  propertyId?: string | null,
): Promise<VisibleProfile & { actingPropertyId: string }> {
  const vp = await requireVisibleProfile(tx, ports, id);
  if (vp.row.status === 'anonymized') {
    throw new BusinessRuleError(
      'profile_anonymized',
      'This guest profile was anonymized on request and can no longer be changed. Create a new profile if the guest returns.',
      { profileId: vp.row.id },
    );
  }
  // Writing never links the profile to the acting property (that would silently widen visibility there, and
  // survive sharing being switched off). Properties become "known" only through resolve, stays or mirroring.
  const acting = actingProperty(tx, permission, vp.row, vp.links, propertyId);
  return { ...vp, actingPropertyId: acting };
}

export async function linkProperty(
  tx: TxContext,
  profileId: string,
  propertyId: string,
  source: 'created' | 'stay' | 'resolved' | 'mirror' | 'merge' | 'manual',
): Promise<void> {
  await db(tx)
    .insertInto('guests.profile_properties')
    .values({
      tenant_id: tx.tenantId,
      profile_id: profileId,
      property_id: propertyId,
      first_seen_at: tx.now,
      source,
    })
    .onConflict((oc) => oc.columns(['profile_id', 'property_id']).doNothing())
    .execute();
}

/**
 * Identity and contact edits are governed by data authority (ADR-0014): a mirrored profile is changed in its
 * system of record; a profile whose home property is externally authoritative is read-only (or would be
 * forwarded — not available until the integration module provides forwarding).
 */
export async function assertIdentityWritable(
  tx: TxContext,
  ports: GuestsPorts,
  row: ProfileRow,
): Promise<void> {
  const ext = await db(tx)
    .selectFrom('guests.external_refs')
    .select(['system_name'])
    .where('entity_type', '=', 'profile')
    .where('entity_id', '=', row.id)
    .executeTakeFirst();
  if (ext) {
    throw new BusinessRuleError(
      'external_system_of_record',
      `This profile is mirrored from ${ext.system_name}, which is the system of record for guest profiles. Change names and contact details there; preferences, alerts, notes and consent recorded in Portico stay Portico-only.`,
      { domain: 'guestProfiles', systemName: ext.system_name },
    );
  }
  const mode = await ports.platform.assertWritable(tx, row.home_property_id, 'guestProfiles');
  if (mode === 'forward') throw forwardingUnavailable();
}

export function forwardingUnavailable(): BusinessRuleError {
  return new BusinessRuleError(
    'forwarding_not_available',
    'Guest profile changes at this property must be forwarded to the external system of record, and forwarding is not available yet. Make the change in that system; it will appear here after the next sync.',
    { domain: 'guestProfiles' },
  );
}

export async function propertyCountry(tx: TxContext, ports: GuestsPorts, propertyId: string | null) {
  if (!propertyId) return null;
  return ports.platform.getPropertyCountry(tx, propertyId);
}

export function assertNotSame(a: string, b: string, message: string): void {
  if (a === b) throw new ValidationError('same_profile', message);
}

/** Visibility of several profiles for the given access (batch: links + sharing consent). */
export async function visibilityOf(
  tx: TxContext,
  access: AccessScope,
  ids: readonly string[],
): Promise<Map<string, Visibility>> {
  const out = new Map<string, Visibility>();
  if (ids.length === 0) return out;
  const links = await db(tx)
    .selectFrom('guests.profile_properties')
    .select(['profile_id', 'property_id'])
    .where('profile_id', 'in', [...ids])
    .execute();
  const consents = await db(tx)
    .selectFrom('guests.consents')
    .select(['profile_id', 'state'])
    .where('profile_id', 'in', [...ids])
    .where('purpose', '=', 'cross_property_sharing')
    .execute();
  for (const id of ids) {
    const l = links.filter((x) => x.profile_id === id).map((x) => x.property_id);
    const c = aggregateSharingConsent(consents.filter((x) => x.profile_id === id).map((x) => x.state));
    out.set(id, profileVisibility(access, l, c));
  }
  return out;
}

/** SQL visibility predicate on alias `p` (search, queues). Mirrors domain/visibility.ts profileVisibility. */
export function visibilitySql(access: AccessScope, alias = 'p') {
  const p = sql.ref(`${alias}.id`);
  if (access.readAll) return sql<boolean>`true`;
  const own =
    access.readPropertyIds.length > 0
      ? sql`exists (select 1 from guests.profile_properties pp where pp.profile_id = ${p} and pp.property_id = any(${[...access.readPropertyIds]}::uuid[]))`
      : sql`false`;
  if (!access.sharedViewing) return sql<boolean>`(${own})`;
  const notWithdrawn = sql`not exists (select 1 from guests.consents c where c.profile_id = ${p} and c.purpose = 'cross_property_sharing' and c.state = 'withdrawn')`;
  const granted = access.sharingRequiresConsent
    ? sql`and exists (select 1 from guests.consents c2 where c2.profile_id = ${p} and c2.purpose = 'cross_property_sharing' and c2.state = 'granted')`
    : sql``;
  return sql<boolean>`(${own} or (${notWithdrawn} ${granted}))`;
}
