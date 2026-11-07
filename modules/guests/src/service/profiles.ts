/**
 * Guest profiles: create / resolve / read / update and their child records (contacts, preferences, alerts,
 * notes, relationships, special needs).
 */
import { explainVersionMiss, sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type {
  AlertInput,
  ContactPointInput,
  CreateProfileInput,
  GuestProfile,
  NoteInput,
  PreferenceInput,
  RelationshipInput,
  SpecialNeedInput,
  UpdateProfileInput,
} from '../contracts';
import { normalizeContact } from '../domain/contact';
import { isSafeExactReuse, type MatchSubject } from '../domain/duplicates';
import { autoTransliterate, detectScript, nameKeys } from '../domain/names';
import { itemVisible } from '../domain/visibility';
import { type GuestsPorts, keyIdOf } from '../ports';
import { detectDuplicates, type ScoredCandidate, scoreAgainstExisting } from './duplicates';
import {
  actingProperty,
  actorKey,
  assertIdentityWritable,
  db,
  iso,
  linkProperty,
  loadProfileRow,
  lockProfileForWrite,
  type ProfileRow,
  propertyCountry,
  requireVisibleProfile,
  requireWritableProfile,
  resolveAccess,
  scrubReason,
  visibilityOf,
} from './internal';
import { buildProfileView } from './view';

export interface PossibleDuplicate {
  profileId: string;
  score: number;
  band: 'high' | 'medium' | 'low' | 'none';
  reasons: Array<{ code: string; detail: string }>;
}

// ───────────────────────────── Names ─────────────────────────────

interface NameFields {
  title?: string | null | undefined;
  givenName?: string | null | undefined;
  middleName?: string | null | undefined;
  familyName?: string | null | undefined;
  nativeGivenName?: string | null | undefined;
  nativeFamilyName?: string | null | undefined;
  preferredName?: string | null | undefined;
}

/**
 * Resolve the stored name columns. A Latin family name is required for passports and manifests; it may be
 * derived automatically from Cyrillic (ICAO 9303). Latin text typed into the native fields is moved over.
 */
export function resolveNames(n: NameFields) {
  let given = n.givenName ?? null;
  let family = n.familyName ?? null;
  let nativeGiven = n.nativeGivenName ?? null;
  let nativeFamily = n.nativeFamilyName ?? null;
  // Non-Latin text typed into the Latin fields belongs in the native fields.
  if (family && detectScript(family) !== 'Latn' && detectScript(family) !== null && !nativeFamily) {
    nativeFamily = family;
    family = null;
  }
  if (given && detectScript(given) !== 'Latn' && detectScript(given) !== null && !nativeGiven) {
    nativeGiven = given;
    given = null;
  }
  if (!family && nativeFamily) family = autoTransliterate(nativeFamily);
  if (!given && nativeGiven) given = autoTransliterate(nativeGiven);
  if (!family) {
    const script = nativeFamily ? detectScript(nativeFamily) : null;
    throw new ValidationError(
      'latin_name_required',
      script
        ? `Add the family name as written in the guest's passport (Latin letters). Portico stores the ${script} name as well, but cannot transliterate it automatically.`
        : 'A family name is required.',
      { field: 'familyName' },
    );
  }
  const nativeAll = [nativeGiven, nativeFamily].filter(Boolean).join(' ');
  const keys = nameKeys({
    givenName: given,
    middleName: n.middleName ?? null,
    familyName: family,
    nativeGivenName: nativeGiven,
    nativeFamilyName: nativeFamily,
  });
  return {
    title: n.title ?? null,
    given_name: given,
    middle_name: n.middleName ?? null,
    family_name: family,
    native_given_name: nativeGiven,
    native_family_name: nativeFamily,
    native_script: nativeAll ? detectScript(nativeAll) : null,
    preferred_name: n.preferredName ?? null,
    search_name: keys.searchName,
    search_name_native: keys.searchNameNative,
  };
}

// ───────────────────────────── Contacts helper ─────────────────────────────

export async function insertContactPoint(
  tx: TxContext,
  profileId: string,
  c: ContactPointInput,
  defaultCountry: string | null,
  opts: { source?: string; requestedProfileId?: string | null; lowConfidence?: boolean } = {},
): Promise<{ id: string; inserted: boolean }> {
  const n = normalizeContact(c.kind, c.value, defaultCountry);
  const id = newId(tx.now.getTime());
  // Verification is a staff statement (in person, OTP, reply). API clients and system feeds cannot self-assert
  // it, because verified emails drive exact-match reuse.
  const verified = tx.actor.kind === 'user' && (c.verified ?? false);
  const row = await db(tx)
    .insertInto('guests.contact_points')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: profileId,
      kind: c.kind,
      value: c.value.trim(),
      normalized: n.normalized,
      label: c.label ?? null,
      is_primary: c.isPrimary ?? false,
      verified,
      verified_at: verified ? tx.now : null,
      verification_method: verified ? (c.verificationMethod ?? 'staff') : null,
      source: c.source ?? opts.source ?? 'staff',
      low_confidence: n.lowConfidence || (opts.lowConfidence ?? false),
      requested_profile_id: opts.requestedProfileId ?? null,
    })
    .onConflict((oc) => oc.doNothing())
    .returning('id')
    .executeTakeFirst();
  return { id: row?.id ?? id, inserted: !!row };
}

// ───────────────────────────── Create / resolve ─────────────────────────────

export interface CreateCoreOptions {
  propertyId: string;
  linkSource: 'created' | 'resolved' | 'mirror';
  provenance?: 'live' | 'copied' | 'external';
  skipAuthority?: boolean;
}

async function createProfileCore(
  tx: TxContext,
  ports: GuestsPorts,
  input: Omit<CreateProfileInput, 'propertyId' | 'matchStrategy'>,
  opts: CreateCoreOptions,
): Promise<string> {
  if (!opts.skipAuthority) {
    const mode = await ports.platform.assertWritable(tx, opts.propertyId, 'guestProfiles');
    if (mode === 'forward') {
      throw new BusinessRuleError(
        'forwarding_not_available',
        'Guest profiles at this property are mastered in another system and forwarding new profiles is not available yet. Create the profile there; it will appear here after the next sync.',
        { domain: 'guestProfiles' },
      );
    }
  }
  const names = resolveNames(input);
  const id = newId(tx.now.getTime());
  const provenance = opts.provenance ?? (tx.environment === 'trial' ? 'copied' : 'live');
  await db(tx)
    .insertInto('guests.profiles')
    .values({
      id,
      tenant_id: tx.tenantId,
      ...names,
      language: input.language ?? null,
      nationality: input.nationality ?? null,
      date_of_birth: input.dateOfBirth ?? null,
      vip_level: input.vipLevel ?? null,
      tags: input.tags ?? [],
      important_dates: JSON.stringify(input.importantDates ?? []),
      home_property_id: opts.propertyId,
      provenance,
      source: JSON.stringify(input.source ?? { kind: tx.actor.kind === 'user' ? 'staff' : tx.actor.kind }),
    })
    .execute();
  await linkProperty(tx, id, opts.propertyId, opts.linkSource === 'resolved' ? 'created' : opts.linkSource);
  const country = await propertyCountry(tx, ports, opts.propertyId);
  for (const c of input.contactPoints ?? []) await insertContactPoint(tx, id, c, country);
  await tx.audit({
    action: 'guests.profile.create',
    target: { type: 'guest_profile', id },
    propertyId: opts.propertyId,
    // No personal values in the audit trail (it is append-only and must survive erasure): field names only.
    metadata: {
      fields: Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== undefined),
      contactPoints: (input.contactPoints ?? []).map((c) => c.kind),
      provenance,
    },
  });
  await tx.emit({
    type: 'guests.profile.created',
    propertyId: opts.propertyId,
    aggregate: { type: 'guest_profile', id },
    payload: { profileId: id, propertyId: opts.propertyId, provenance },
  });
  return id;
}

function toPossible(c: Awaited<ReturnType<typeof detectDuplicates>>[number]): PossibleDuplicate {
  return { profileId: c.profileId, score: c.score, band: c.band, reasons: c.reasons };
}

export interface ProfileInput extends Omit<CreateProfileInput, 'matchStrategy'> {
  /** Identity document captured with the booking (channel / registration). */
  documentHash?: string;
}

/**
 * Provider (domain map): find-or-create a profile for bookings, channel ingestion and imports (GUE-R09).
 *  - exact_only (default): reuse an existing profile only on an exact key (VERIFIED email, E.164 phone, document)
 *    with a compatible name and no conflicting date of birth, only if exactly one qualifies, and only if that
 *    profile is visible at the resolving property — i.e. already known there, or cross-property sharing fully
 *    applies (entitlement + policy + readShared + no guest objection). Otherwise a property-local profile is
 *    created and the pair is queued for an organization-level reviewer (GUE-I05, GUE-R16);
 *  - suggest: same reuse rule, and returns scored suggestions — only profiles the caller may see;
 *  - create_new: always creates.
 * Never merges. Duplicate detection records queue-worthy pairs in every mode.
 */
export async function resolveProfile(
  tx: TxContext,
  ports: GuestsPorts,
  input: ProfileInput,
  opts: { matchStrategy?: 'exact_only' | 'suggest' | 'create_new' } = {},
): Promise<{
  profileId: string;
  created: boolean;
  possibleDuplicates: string[];
  suggestions: PossibleDuplicate[];
}> {
  requirePermission(tx, 'guests.profile.update', { propertyId: input.propertyId });
  const strategy = opts.matchStrategy ?? 'exact_only';
  // What the caller may see AT the resolving property (never more).
  const access = await resolveAccess(tx, ports, { propertyId: input.propertyId });
  const visibleOnly = async (cands: ScoredCandidate[]) => {
    const vis = await visibilityOf(
      tx,
      access,
      cands.map((c) => c.profileId),
    );
    return cands.filter((c) => (vis.get(c.profileId) ?? 'none') !== 'none');
  };
  if (strategy !== 'create_new') {
    const names = resolveNames(input);
    const country = await propertyCountry(tx, ports, input.propertyId);
    const subject: MatchSubject = {
      id: '00000000-0000-0000-0000-000000000000',
      names: { searchName: names.search_name, searchNameNative: names.search_name_native },
      dateOfBirth: input.dateOfBirth ?? null,
      nationality: input.nationality ?? null,
      // The booking's emails are claims: they match only other profiles' VERIFIED emails as exact keys.
      emails: [],
      phones: [],
      documentHashes: input.documentHash ? [input.documentHash] : [],
    };
    for (const c of input.contactPoints ?? []) {
      const n = normalizeContact(c.kind, c.value, country);
      if (!n.normalized || n.lowConfidence) continue;
      if (c.kind === 'email') (subject.emails as string[]).push(n.normalized);
      if (c.kind === 'phone' || c.kind === 'whatsapp') (subject.phones as string[]).push(n.normalized);
    }
    const visible = await visibleOnly(await scoreAgainstExisting(tx, subject));
    const reusable = visible.filter(isSafeExactReuse);
    // Lock, then decide (R2-P2-2): a profile erased or merged since the search is not reused.
    const stillWritable =
      reusable.length === 1 && reusable[0]
        ? await lockProfileForWrite(tx, reusable[0].profileId).then(
            () => true,
            () => false,
          )
        : false;
    if (stillWritable && reusable[0]) {
      const profileId = reusable[0].profileId;
      await linkProperty(tx, profileId, input.propertyId, 'resolved');
      for (const c of input.contactPoints ?? []) {
        await insertContactPoint(tx, profileId, { ...c, verified: false }, country, {
          source: input.source?.kind ?? 'resolved',
        });
      }
      const others = visible.filter((v) => v.profileId !== profileId && v.score >= 0.3);
      return {
        profileId,
        created: false,
        possibleDuplicates: others.map((o) => o.profileId),
        suggestions: strategy === 'suggest' ? others.map(toPossible) : [],
      };
    }
  }
  const profileId = await createProfileCore(tx, ports, input, {
    propertyId: input.propertyId,
    linkSource: 'created',
  });
  // Detection queues pairs organization-wide (for reviewers who may see both); the caller only learns about
  // profiles it may see.
  const dups = await visibleOnly(
    (await detectDuplicates(tx, ports, profileId, 'on_create')).filter((d) => d.score >= 0.3),
  );
  return {
    profileId,
    created: true,
    possibleDuplicates: dups.map((d) => d.profileId),
    suggestions: dups.map(toPossible),
  };
}

/** Staff create (HTTP): suggest by default, returns the view plus scored suggestions. */
export async function createProfile(
  tx: TxContext,
  ports: GuestsPorts,
  input: CreateProfileInput,
): Promise<{ profile: GuestProfile; created: boolean; possibleDuplicates: PossibleDuplicate[] }> {
  const res = await resolveProfile(tx, ports, input, { matchStrategy: input.matchStrategy ?? 'suggest' });
  const profile = await getProfile(tx, ports, res.profileId, { propertyId: input.propertyId });
  return { profile, created: res.created, possibleDuplicates: res.suggestions };
}

// ───────────────────────────── Read ─────────────────────────────

/** Provider + HTTP: the permission-filtered profile; merged ids resolve to the survivor (resolvedFrom). */
export async function getProfile(
  tx: TxContext,
  ports: GuestsPorts,
  id: string,
  opts: { propertyId?: string | null } = {},
): Promise<GuestProfile> {
  const vp = await requireVisibleProfile(tx, ports, id, opts);
  return buildProfileView(tx, ports, vp);
}

// ───────────────────────────── Update ─────────────────────────────

const IDENTITY_FIELDS = [
  'title',
  'givenName',
  'middleName',
  'familyName',
  'nativeGivenName',
  'nativeFamilyName',
  'dateOfBirth',
  'nationality',
] as const;

export async function updateProfile(
  tx: TxContext,
  ports: GuestsPorts,
  id: string,
  expectedVersion: number,
  patch: UpdateProfileInput,
): Promise<GuestProfile> {
  const vp = await requireWritableProfile(tx, ports, id, 'guests.profile.update', patch.propertyId);
  const row = vp.row;
  if (row.id !== id) {
    throw new BusinessRuleError(
      'profile_merged',
      `This profile was merged into ${row.id}. Edit the surviving profile instead.`,
      { survivorId: row.id },
    );
  }
  const changed = (Object.keys(patch) as Array<keyof UpdateProfileInput>).filter(
    (k) => k !== 'propertyId' && patch[k] !== undefined,
  );
  if (changed.some((k) => (IDENTITY_FIELDS as readonly string[]).includes(k))) {
    await assertIdentityWritable(tx, ports, row);
  }
  const pick = <T>(v: T | undefined, current: T): T => (v === undefined ? current : v);
  const names = resolveNames({
    title: pick(patch.title, row.title),
    givenName: pick(patch.givenName, row.given_name),
    middleName: pick(patch.middleName, row.middle_name),
    familyName: pick(patch.familyName, row.family_name),
    nativeGivenName: pick(patch.nativeGivenName, row.native_given_name),
    nativeFamilyName: pick(patch.nativeFamilyName, row.native_family_name),
    preferredName: pick(patch.preferredName, row.preferred_name),
  });
  const updated = await db(tx)
    .updateTable('guests.profiles')
    .set({
      ...names,
      language: pick(patch.language, row.language),
      nationality: pick(patch.nationality, row.nationality),
      date_of_birth: pick(patch.dateOfBirth, row.date_of_birth),
      vip_level: pick(patch.vipLevel, row.vip_level),
      tags: pick(patch.tags, row.tags),
      important_dates: JSON.stringify(pick(patch.importantDates, row.important_dates)),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .where('status', '=', 'active')
    .returningAll()
    .executeTakeFirst();
  if (!updated) {
    return explainVersionMiss(
      'guest_profile',
      id,
      expectedVersion,
      async () => (await loadProfileRow(tx, id))?.version,
    );
  }
  await tx.audit({
    action: 'guests.profile.update',
    target: { type: 'guest_profile', id },
    propertyId: vp.actingPropertyId,
    before: { version: row.version, vipLevel: row.vip_level },
    after: { version: updated.version, vipLevel: updated.vip_level },
    metadata: { changedFields: changed },
  });
  await tx.emit({
    type: 'guests.profile.updated',
    propertyId: vp.actingPropertyId,
    aggregate: { type: 'guest_profile', id },
    payload: { profileId: id, changedFields: changed },
  });
  if (changed.some((k) => (IDENTITY_FIELDS as readonly string[]).includes(k))) {
    await detectDuplicates(tx, ports, id, 'on_update');
  }
  return getProfile(tx, ports, id);
}

async function bumpVersion(tx: TxContext, profileId: string): Promise<void> {
  await db(tx)
    .updateTable('guests.profiles')
    .set({ version: sql`version + 1` })
    .where('id', '=', profileId)
    .execute();
}

// ───────────────────────────── Contact points ─────────────────────────────

export async function addContactPoint(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: ContactPointInput & { propertyId?: string },
): Promise<GuestProfile> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.profile.update', input.propertyId);
  await assertIdentityWritable(tx, ports, vp.row);
  const country = await propertyCountry(tx, ports, vp.actingPropertyId);
  const res = await insertContactPoint(tx, vp.row.id, input, country, {
    requestedProfileId: profileId !== vp.row.id ? profileId : null,
  });
  if (!res.inserted) {
    throw new ConflictError('contact_exists', 'This contact is already on the profile.', {
      kind: input.kind,
    });
  }
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.contactPoint.add',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { contactPointId: res.id, kind: input.kind, verified: input.verified ?? false },
  });
  await tx.emit({
    type: 'guests.profile.updated',
    aggregate: { type: 'guest_profile', id: vp.row.id },
    payload: { profileId: vp.row.id, changedFields: ['contactPoints'] },
  });
  await detectDuplicates(tx, ports, vp.row.id, 'on_update');
  return getProfile(tx, ports, vp.row.id);
}

async function loadChild<
  T extends 'guests.contact_points' | 'guests.preferences' | 'guests.alerts' | 'guests.notes',
>(tx: TxContext, table: T, id: string): Promise<{ id: string; profile_id: string }> {
  const row = await db(tx)
    .selectFrom(table as 'guests.contact_points')
    .select(['id', 'profile_id'])
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError(table.replace('guests.', '').replace(/s$/, ''), id);
  return row;
}

export async function verifyContactPoint(
  tx: TxContext,
  ports: GuestsPorts,
  contactPointId: string,
  input: { method: string; propertyId?: string },
): Promise<GuestProfile> {
  const cp = await loadChild(tx, 'guests.contact_points', contactPointId);
  const vp = await requireWritableProfile(
    tx,
    ports,
    cp.profile_id,
    'guests.profile.update',
    input.propertyId,
  );
  await db(tx)
    .updateTable('guests.contact_points')
    .set({
      verified: true,
      verified_at: tx.now,
      verification_method: input.method,
      version: sql`version + 1`,
    })
    .where('id', '=', contactPointId)
    .execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.contactPoint.verify',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { contactPointId, method: input.method },
  });
  await detectDuplicates(tx, ports, vp.row.id, 'on_update');
  return getProfile(tx, ports, vp.row.id);
}

export async function removeContactPoint(
  tx: TxContext,
  ports: GuestsPorts,
  contactPointId: string,
  opts: { propertyId?: string; reason?: string } = {},
): Promise<GuestProfile> {
  const cp = await loadChild(tx, 'guests.contact_points', contactPointId);
  const vp = await requireWritableProfile(tx, ports, cp.profile_id, 'guests.profile.update', opts.propertyId);
  await assertIdentityWritable(tx, ports, vp.row);
  const why = await scrubReason(tx, opts.reason ?? null, [vp.row.id]);
  await db(tx).deleteFrom('guests.contact_points').where('id', '=', contactPointId).execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.contactPoint.remove',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    reason: why,
    metadata: { contactPointId },
  });
  return getProfile(tx, ports, vp.row.id);
}

// ───────────────────────────── Preferences ─────────────────────────────

export async function addPreference(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: PreferenceInput & { propertyId?: string },
): Promise<GuestProfile> {
  const vp = await requireWritableProfile(
    tx,
    ports,
    profileId,
    'guests.profile.update',
    input.propertyId ?? input.scopePropertyId,
  );
  if (input.scopePropertyId)
    requirePermission(tx, 'guests.profile.update', { propertyId: input.scopePropertyId });
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('guests.preferences')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: vp.row.id,
      category: input.category,
      value: input.value,
      scope_property_id: input.scopePropertyId ?? null,
      source: input.source ?? 'staff',
      confirmed_at: tx.now,
      requested_profile_id: profileId !== vp.row.id ? profileId : null,
    })
    .execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.preference.add',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { preferenceId: id, category: input.category },
  });
  return getProfile(tx, ports, vp.row.id);
}

/**
 * A property-scoped preference belongs to its property: it must be visible to the caller (404 otherwise) and is
 * changed only with the permission at that property.
 */
async function requirePreferenceAccess(
  tx: TxContext,
  ports: GuestsPorts,
  preferenceId: string,
  propertyId: string | undefined,
) {
  const pref = await db(tx)
    .selectFrom('guests.preferences')
    .select(['id', 'profile_id', 'scope_property_id'])
    .where('id', '=', preferenceId)
    .executeTakeFirst();
  if (!pref) throw new NotFoundError('preference', preferenceId);
  const seen = await requireVisibleProfile(tx, ports, pref.profile_id).catch(() => {
    throw new NotFoundError('preference', preferenceId);
  });
  const scope = pref.scope_property_id;
  if (scope && !seen.access.readAll && !seen.access.readPropertyIds.includes(scope)) {
    throw new NotFoundError('preference', preferenceId);
  }
  return requireWritableProfile(tx, ports, pref.profile_id, 'guests.profile.update', scope ?? propertyId);
}

export async function updatePreference(
  tx: TxContext,
  ports: GuestsPorts,
  preferenceId: string,
  expectedVersion: number,
  input: { value: string; propertyId?: string },
): Promise<GuestProfile> {
  const vp = await requirePreferenceAccess(tx, ports, preferenceId, input.propertyId);
  const row = await db(tx)
    .updateTable('guests.preferences')
    .set({ value: input.value, confirmed_at: tx.now, version: sql`version + 1` })
    .where('id', '=', preferenceId)
    .where('version', '=', expectedVersion)
    .returning('version')
    .executeTakeFirst();
  if (!row) {
    await explainVersionMiss('preference', preferenceId, expectedVersion, async () => {
      const r = await db(tx)
        .selectFrom('guests.preferences')
        .select('version')
        .where('id', '=', preferenceId)
        .executeTakeFirst();
      return r?.version;
    });
  }
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.preference.update',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { preferenceId },
  });
  return getProfile(tx, ports, vp.row.id);
}

export async function removePreference(
  tx: TxContext,
  ports: GuestsPorts,
  preferenceId: string,
  opts: { propertyId?: string } = {},
): Promise<GuestProfile> {
  const vp = await requirePreferenceAccess(tx, ports, preferenceId, opts.propertyId);
  await db(tx).deleteFrom('guests.preferences').where('id', '=', preferenceId).execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.preference.remove',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { preferenceId },
  });
  return getProfile(tx, ports, vp.row.id);
}

// ───────────────────────────── Alerts ─────────────────────────────

export async function addAlert(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: AlertInput,
): Promise<{ alertId: string; profile: GuestProfile }> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.alert.manage', input.propertyId);
  const alertId = await insertAlert(tx, vp.row.id, profileId, input, 'staff', vp.actingPropertyId);
  return { alertId, profile: await getProfile(tx, ports, vp.row.id) };
}

async function insertAlert(
  tx: TxContext,
  profileId: string,
  requestedId: string,
  input: AlertInput,
  source: string,
  actingPropertyId: string,
): Promise<string> {
  if (input.visibility === 'property_private' && !input.propertyId) {
    throw new ValidationError(
      'property_required',
      'A property-private alert needs the property it belongs to.',
    );
  }
  if (input.activeFrom && input.activeTo && input.activeTo < input.activeFrom) {
    throw new ValidationError('invalid_date_range', 'The alert must end on or after the day it starts.');
  }
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('guests.alerts')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: profileId,
      property_id: input.propertyId ?? null,
      severity: input.severity,
      text: input.text,
      audience: input.audience ?? [],
      visibility: input.visibility,
      active_from: input.activeFrom ?? null,
      active_to: input.activeTo ?? null,
      source,
      requested_profile_id: requestedId !== profileId ? requestedId : null,
    })
    .execute();
  await bumpVersion(tx, profileId);
  await tx.audit({
    action: 'guests.alert.raise',
    target: { type: 'guest_profile', id: profileId },
    propertyId: input.propertyId ?? actingPropertyId,
    metadata: { alertId: id, severity: input.severity, visibility: input.visibility, source },
  });
  await tx.emit({
    type: 'guests.alert.raised',
    propertyId: input.propertyId ?? null,
    aggregate: { type: 'guest_profile', id: profileId },
    payload: { profileId, alertId: id, severity: input.severity, audience: input.audience ?? [] },
  });
  return id;
}

export async function resolveAlert(
  tx: TxContext,
  ports: GuestsPorts,
  alertId: string,
  expectedVersion: number,
  opts: { propertyId?: string; reason?: string } = {},
): Promise<GuestProfile> {
  const alert = await db(tx)
    .selectFrom('guests.alerts')
    .selectAll()
    .where('id', '=', alertId)
    .executeTakeFirst();
  if (!alert) throw new NotFoundError('alert', alertId);
  // The alert must be visible to the caller (property-private alerts never leave their property) …
  const seen = await requireVisibleProfile(tx, ports, alert.profile_id).catch(() => {
    throw new NotFoundError('alert', alertId);
  });
  if (
    !itemVisible(
      seen.access,
      seen.view,
      { visibility: alert.visibility, propertyId: alert.property_id },
      seen.consent,
    )
  ) {
    throw new NotFoundError('alert', alertId);
  }
  // … and an alert recorded at a property is managed by staff of that property.
  const vp = await requireWritableProfile(
    tx,
    ports,
    alert.profile_id,
    'guests.alert.manage',
    alert.property_id ?? opts.propertyId,
  );
  const why = await scrubReason(tx, opts.reason ?? null, [vp.row.id]);
  const row = await db(tx)
    .updateTable('guests.alerts')
    .set({ status: 'resolved', version: sql`version + 1` })
    .where('id', '=', alertId)
    .where('version', '=', expectedVersion)
    .returning('id')
    .executeTakeFirst();
  if (!row) {
    await explainVersionMiss('alert', alertId, expectedVersion, async () => {
      const r = await db(tx)
        .selectFrom('guests.alerts')
        .select('version')
        .where('id', '=', alertId)
        .executeTakeFirst();
      return r?.version;
    });
  }
  await tx.audit({
    action: 'guests.alert.resolve',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    reason: why,
    metadata: { alertId },
  });
  return getProfile(tx, ports, vp.row.id);
}

// ───────────────────────────── Notes (never edited in place) ─────────────────────────────

export async function addNote(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: NoteInput,
  opts: { supersedesId?: string } = {},
): Promise<{ noteId: string; profile: GuestProfile }> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.profile.update', input.propertyId);
  if (input.visibility !== 'shared' && !input.propertyId) {
    throw new ValidationError(
      'property_required',
      'Property-private and department notes need their property.',
    );
  }
  if (input.visibility === 'department' && !input.department) {
    throw new ValidationError('department_required', 'A department note needs the department it is for.');
  }
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('guests.notes')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: vp.row.id,
      property_id: input.propertyId ?? null,
      department: input.department ?? null,
      visibility: input.visibility,
      body: input.body,
      author: JSON.stringify(tx.actor),
      author_key: actorKey(tx),
      supersedes_id: opts.supersedesId ?? null,
      requested_profile_id: profileId !== vp.row.id ? profileId : null,
    })
    .execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: opts.supersedesId ? 'guests.note.revise' : 'guests.note.add',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: input.propertyId ?? vp.actingPropertyId,
    metadata: { noteId: id, visibility: input.visibility, supersedesId: opts.supersedesId ?? null },
  });
  return { noteId: id, profile: await getProfile(tx, ports, vp.row.id) };
}

/** Edit = a new version superseding the old one; the old text stays in history (GUE-R04). */
export async function reviseNote(
  tx: TxContext,
  ports: GuestsPorts,
  noteId: string,
  input: { body: string },
): Promise<{ noteId: string; profile: GuestProfile }> {
  const old = await db(tx)
    .selectFrom('guests.notes')
    .selectAll()
    .where('id', '=', noteId)
    .forUpdate()
    .executeTakeFirst();
  if (!old) throw new NotFoundError('note', noteId);
  // The reviser must be able to see the note.
  const profile = await getProfile(tx, ports, old.profile_id);
  if (!profile.notes.some((n) => n.id === noteId)) throw new NotFoundError('note', noteId);
  if (old.superseded_at) {
    throw new ConflictError(
      'note_superseded',
      'This note was already revised. Revise the latest version instead.',
    );
  }
  const res = await addNote(
    tx,
    ports,
    old.profile_id,
    {
      body: input.body,
      visibility: old.visibility,
      ...(old.property_id ? { propertyId: old.property_id } : {}),
      ...(old.department ? { department: old.department } : {}),
    },
    { supersedesId: noteId },
  );
  await db(tx).updateTable('guests.notes').set({ superseded_at: tx.now }).where('id', '=', noteId).execute();
  return { noteId: res.noteId, profile: await getProfile(tx, ports, old.profile_id) };
}

// ───────────────────────────── Relationships ─────────────────────────────

export async function addRelationship(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: RelationshipInput & { propertyId?: string },
): Promise<GuestProfile> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.profile.update', input.propertyId);
  const other = await requireVisibleProfile(tx, ports, input.relatedProfileId, { access: vp.access });
  await lockProfileForWrite(tx, other.row.id);
  if (other.row.id === vp.row.id) {
    throw new ValidationError('self_relationship', 'A profile cannot be related to itself.');
  }
  await db(tx)
    .insertInto('guests.relationships')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      profile_id: vp.row.id,
      related_profile_id: other.row.id,
      kind: input.kind,
      note: input.note ?? null,
    })
    .onConflict((oc) => oc.columns(['profile_id', 'related_profile_id', 'kind']).doNothing())
    .execute();
  await bumpVersion(tx, vp.row.id);
  await tx.audit({
    action: 'guests.relationship.add',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: vp.actingPropertyId,
    metadata: { relatedProfileId: other.row.id, kind: input.kind },
  });
  return getProfile(tx, ports, vp.row.id);
}

// ───────────────────────────── Special needs (sensitive category) ─────────────────────────────

export async function addSpecialNeed(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: SpecialNeedInput,
): Promise<{ specialNeedId: string; alertId: string | null }> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.profile.update', input.propertyId);
  const id = newId(tx.now.getTime());
  let alertId: string | null = null;
  if (input.guestAgreedAlertText) {
    alertId = await insertAlert(
      tx,
      vp.row.id,
      profileId,
      {
        propertyId: input.propertyId,
        severity: input.alertSeverity ?? (input.category === 'allergy' ? 'critical' : 'important'),
        text: input.guestAgreedAlertText,
        visibility: 'property_private',
        ...(input.audience ? { audience: input.audience } : {}),
      },
      'special_need',
      vp.actingPropertyId,
    );
  }
  const encDetail = ports.crypto.cipher.encrypt(input.detail, `guests.special_need:${tx.tenantId}:${id}`);
  await db(tx)
    .insertInto('guests.special_needs')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: vp.row.id,
      property_id: input.propertyId,
      category: input.category,
      enc_detail: encDetail,
      key_id: keyIdOf(encDetail),
      alert_id: alertId,
      guest_agreed_text: input.guestAgreedAlertText ?? null,
      created_by: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'guests.specialNeed.add',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: input.propertyId,
    metadata: { specialNeedId: id, category: input.category, alertId },
  });
  return { specialNeedId: id, alertId };
}

/** Sensitive read (GUE-R02): `guests.sensitive.read` at the property, reason required, audited every time. */
export async function readSpecialNeed(
  tx: TxContext,
  ports: GuestsPorts,
  specialNeedId: string,
  reason: string,
): Promise<{ id: string; category: string; detail: string }> {
  const row = await db(tx)
    .selectFrom('guests.special_needs')
    .selectAll()
    .where('id', '=', specialNeedId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('special_need', specialNeedId);
  await requireVisibleProfile(tx, ports, row.profile_id, { propertyId: row.property_id }).catch(() => {
    throw new NotFoundError('special_need', specialNeedId);
  });
  requirePermission(tx, 'guests.sensitive.read', { propertyId: row.property_id });
  const why = await scrubReason(tx, reason, [row.profile_id]);
  const detail = ports.crypto.cipher.decrypt(row.enc_detail, `guests.special_need:${tx.tenantId}:${row.id}`);
  await tx.audit({
    action: 'guests.sensitive.read',
    target: { type: 'special_need', id: row.id },
    propertyId: row.property_id,
    reason: why,
    metadata: { profileId: row.profile_id, category: row.category },
  });
  return { id: row.id, category: row.category, detail };
}

// ───────────────────────────── Legal hold ─────────────────────────────

export async function setLegalHold(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: { hold: boolean; reason: string },
): Promise<GuestProfile> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.privacy.erase');
  const why = await scrubReason(tx, input.reason, [vp.row.id]);
  await db(tx)
    .updateTable('guests.profiles')
    .set({ legal_hold: input.hold, version: sql`version + 1` })
    .where('id', '=', vp.row.id)
    .execute();
  await tx.audit({
    action: input.hold ? 'guests.legalHold.set' : 'guests.legalHold.release',
    target: { type: 'guest_profile', id: vp.row.id },
    reason: why,
    before: { legalHold: vp.row.legal_hold },
    after: { legalHold: input.hold },
  });
  return getProfile(tx, ports, vp.row.id);
}

// ───────────────────────────── Connected mode (mirror) ─────────────────────────────

export interface MirroredProfileInput {
  connectionId: string;
  systemName: string;
  externalId: string;
  propertyId: string;
  syncedAt: Date;
  profile: Omit<CreateProfileInput, 'propertyId' | 'matchStrategy' | 'contactPoints'>;
  contactPoints?: ContactPointInput[];
}

/**
 * Provider for the integration module: upsert a profile mirrored from an external system of record
 * (`guestProfiles` authority external). Provenance `external` with last-sync time; Portico ids stay stable across
 * syncs (mapped by external id). Identity fields and mirror-sourced contacts are replaced; Portico extension data
 * (preferences, alerts, notes, consent) is untouched.
 */
export async function upsertMirroredProfile(
  tx: TxContext,
  ports: GuestsPorts,
  input: MirroredProfileInput,
): Promise<{ profileId: string; created: boolean }> {
  requirePermission(tx, 'guests.profile.update', { propertyId: input.propertyId });
  const ref = await db(tx)
    .selectFrom('guests.external_refs')
    .selectAll()
    .where('connection_id', '=', input.connectionId)
    .where('entity_type', '=', 'profile')
    .where('external_id', '=', input.externalId)
    .executeTakeFirst();
  const country = await propertyCountry(tx, ports, input.propertyId);
  if (!ref) {
    const profileId = await createProfileCore(
      tx,
      ports,
      {
        ...input.profile,
        contactPoints: (input.contactPoints ?? []).map((c) => ({ ...c, source: 'mirror' })),
      },
      { propertyId: input.propertyId, linkSource: 'mirror', provenance: 'external', skipAuthority: true },
    );
    await db(tx)
      .insertInto('guests.external_refs')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        entity_type: 'profile',
        entity_id: profileId,
        connection_id: input.connectionId,
        system_name: input.systemName,
        external_id: input.externalId,
        last_synced_at: input.syncedAt,
      })
      .execute();
    await detectDuplicates(tx, ports, profileId, 'on_create');
    return { profileId, created: true };
  }
  const { row } = await (async () => {
    const r = await loadProfileRow(tx, ref.entity_id, { forUpdate: true });
    if (!r) throw new NotFoundError('guest_profile', ref.entity_id);
    return { row: r as ProfileRow };
  })();
  await lockProfileForWrite(tx, row.id); // refuses an anonymized profile (erasure raced the sync)
  const names = resolveNames(input.profile);
  await db(tx)
    .updateTable('guests.profiles')
    .set({
      ...names,
      language: input.profile.language ?? null,
      nationality: input.profile.nationality ?? null,
      date_of_birth: input.profile.dateOfBirth ?? null,
      version: sql`version + 1`,
    })
    .where('id', '=', row.id)
    .execute();
  await db(tx)
    .deleteFrom('guests.contact_points')
    .where('profile_id', '=', row.id)
    .where('source', '=', 'mirror')
    .execute();
  for (const c of input.contactPoints ?? [])
    await insertContactPoint(tx, row.id, { ...c, source: 'mirror' }, country);
  await db(tx)
    .updateTable('guests.external_refs')
    .set({ last_synced_at: input.syncedAt, system_name: input.systemName })
    .where('id', '=', ref.id)
    .execute();
  await linkProperty(tx, row.id, input.propertyId, 'mirror');
  await tx.audit({
    action: 'guests.profile.mirrorSync',
    target: { type: 'guest_profile', id: row.id },
    propertyId: input.propertyId,
    metadata: { connectionId: input.connectionId, syncedAt: input.syncedAt.toISOString() },
  });
  return { profileId: row.id, created: false };
}

/** Visible profile ids among the given ones (used by other services). */
export async function visibleIds(
  tx: TxContext,
  ports: GuestsPorts,
  ids: readonly string[],
  opts: { propertyId?: string | null } = {},
): Promise<Set<string>> {
  const access = await resolveAccess(tx, ports, opts);
  const out = new Set<string>();
  for (const id of ids) {
    try {
      await requireVisibleProfile(tx, ports, id, { access });
      out.add(id);
    } catch {
      // not visible
    }
  }
  return out;
}

export { actingProperty, iso };
