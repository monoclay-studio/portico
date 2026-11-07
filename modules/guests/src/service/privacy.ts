/**
 * Data-subject requests (GUE-R17 export, GUE-R18 erasure-with-retention). Both are audited. Erasure anonymizes
 * personal data and keeps the pseudonymous profile id with its stay/folio references and revenue, which finance
 * must retain for the statutory period (research 04 §C1, Q44). Blocked by legal hold.
 */
import { redactIdempotencyResponses, sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, requirePermission } from '@portico/kernel';
import type { PrivacyRequestInput } from '../contracts';
import { anonymizedName, ERASURE_PLAN } from '../domain/privacy';
import type { GuestsPorts } from '../ports';
import { consentHistory } from './consent';
import { getStayHistory } from './history';
import {
  actingProperty,
  actorKey,
  db,
  iso,
  linkedPropertyIds,
  requireVisibleProfile,
  scrubReason,
} from './internal';
import { listMergesForProfile, snapshotProfile } from './merge';
import { getProfile } from './profiles';

export interface PrivacyRequestView {
  id: string;
  kind: 'export' | 'erasure';
  profileId: string;
  status: 'received' | 'in_progress' | 'completed' | 'rejected' | 'on_hold';
  reason: string;
  receivedAt: string;
  completedAt: string | null;
  rejectionReason: string | null;
  result: unknown;
}

async function insertRequest(tx: TxContext, input: PrivacyRequestInput, profileId: string): Promise<string> {
  const id = newId(tx.now.getTime());
  await db(tx)
    .insertInto('guests.privacy_requests')
    .values({
      id,
      tenant_id: tx.tenantId,
      kind: input.kind,
      profile_id: profileId,
      status: 'in_progress',
      reason: input.reason,
      requested_by: actorKey(tx),
      received_at: tx.now,
    })
    .execute();
  return id;
}

async function finish(
  tx: TxContext,
  id: string,
  status: 'completed' | 'rejected' | 'on_hold',
  result: unknown,
  rejectionReason?: string,
): Promise<void> {
  await db(tx)
    .updateTable('guests.privacy_requests')
    .set({
      status,
      completed_at: status === 'completed' ? tx.now : null,
      rejection_reason: rejectionReason ?? null,
      result: JSON.stringify(result ?? null),
      version: sql`version + 1`,
    })
    .where('id', '=', id)
    .execute();
}

export async function submitPrivacyRequest(
  tx: TxContext,
  ports: GuestsPorts,
  input: PrivacyRequestInput,
): Promise<PrivacyRequestView> {
  const { requestId } =
    input.kind === 'export' ? await exportProfile(tx, ports, input) : await eraseProfile(tx, ports, input);
  return getPrivacyRequest(tx, ports, requestId);
}

/**
 * Download a completed export. The data is rebuilt on each download (never stored), and every download is
 * audited — personal data never sits in request logs, and the export request's idempotency record holds only
 * the request id (see replay.ts).
 */
export async function downloadExport(tx: TxContext, ports: GuestsPorts, requestId: string): Promise<unknown> {
  const req = await getPrivacyRequest(tx, ports, requestId);
  if (req.kind !== 'export' || req.status !== 'completed') {
    throw new BusinessRuleError('export_not_available', 'Only completed export requests can be downloaded.', {
      kind: req.kind,
      status: req.status,
    });
  }
  const vp = await requireVisibleProfile(tx, ports, req.profileId);
  actingProperty(tx, 'guests.privacy.export', vp.row, vp.links);
  const data = await buildExport(tx, ports, vp.row.id, requestId);
  await tx.audit({
    action: 'guests.privacy.exportDownload',
    target: { type: 'guest_profile', id: vp.row.id },
    metadata: { requestId },
  });
  return data;
}

/**
 * Access / portability export: everything the guests module holds about the person (all properties, unfiltered
 * — this is the data subject's own data), plus contributions from other modules through ports. Identity
 * document numbers are included only when the requester holds guests.document.read (GUE-I04).
 */
export async function exportProfile(
  tx: TxContext,
  ports: GuestsPorts,
  input: PrivacyRequestInput,
): Promise<{ requestId: string; data: unknown }> {
  const vp = await requireVisibleProfile(tx, ports, input.profileId);
  actingProperty(tx, 'guests.privacy.export', vp.row, vp.links);
  input = { ...input, reason: await scrubReason(tx, input.reason, [vp.row.id]) };
  const requestId = await insertRequest(tx, input, vp.row.id);
  const data = await buildExport(tx, ports, vp.row.id, requestId);
  await finish(tx, requestId, 'completed', {
    manifest: data.manifest,
    counts: data.counts,
    documentDetailsIncluded: data.documentDetailsIncluded,
  });
  await tx.audit({
    action: 'guests.privacy.export',
    target: { type: 'guest_profile', id: vp.row.id },
    reason: input.reason,
    metadata: { requestId, manifest: data.manifest, documentDetailsIncluded: data.documentDetailsIncluded },
  });
  return { requestId, data };
}

/**
 * Build the export. Property-bound data (identity documents, special needs, property-private and department
 * notes and alerts, property-scoped preferences, stays) is included only for properties where the requester
 * holds guests.privacy.export — and document / sensitive details additionally need guests.document.read /
 * guests.sensitive.read there. Everything else is listed as withheld so the manifest says honestly whether the
 * export is complete (an organization-wide data-protection role produces a complete one). Every document
 * decrypted into an export is audited like a reveal.
 */
async function buildExport(tx: TxContext, ports: GuestsPorts, profileId: string, requestId: string) {
  const snap = await snapshotProfile(tx, profileId);
  const exportScope = tx.authz.propertyScope('guests.privacy.export');
  const inScope = (propertyId: unknown) =>
    exportScope === 'all' || (typeof propertyId === 'string' && exportScope.includes(propertyId));
  const withheld: Array<{ category: string; count: number; reason: string }> = [];
  const withhold = (category: string, count: number, reason: string) => {
    if (count > 0) withheld.push({ category, count, reason });
  };
  const outOfScope = 'recorded at a property where you do not hold guests.privacy.export';
  const byScope = <T extends Record<string, unknown>>(
    rows: T[],
    prop: (r: T) => unknown,
    category: string,
  ) => {
    const ok = rows.filter((r) => inScope(prop(r)));
    withhold(category, rows.length - ok.length, outOfScope);
    return ok;
  };

  const docs = byScope(snap.children.identity_documents ?? [], (d) => d.property_id, 'identityDocuments');
  let docDetailsWithheld = 0;
  const documents = [];
  for (const d of docs) {
    const base = {
      id: d.id,
      type: d.doc_type,
      issuingCountry: d.issuing_country,
      expiryDate: d.expiry_date,
      propertyId: d.property_id,
    };
    if (!tx.authz.can('guests.document.read', { propertyId: String(d.property_id) })) {
      docDetailsWithheld++;
      documents.push({ ...base, details: 'withheld: requires guests.document.read at this property' });
      continue;
    }
    const payload = JSON.parse(
      ports.crypto.cipher.decrypt(String(d.enc_payload), `guests.identity_document:${tx.tenantId}:${d.id}`),
    ) as Record<string, unknown>;
    await tx.audit({
      action: 'guests.document.read',
      target: { type: 'identity_document', id: String(d.id) },
      propertyId: String(d.property_id),
      reason: `Data-subject export ${requestId}`,
      metadata: { profileId, type: d.doc_type, via: 'privacy_export' },
    });
    documents.push({ ...base, details: payload });
  }
  withhold(
    'identityDocumentDetails',
    docDetailsWithheld,
    'requires guests.document.read at the capturing property',
  );

  const needs = byScope(snap.children.special_needs ?? [], (n) => n.property_id, 'specialNeeds');
  let needDetailsWithheld = 0;
  const specialNeeds = [];
  for (const n of needs) {
    const allowed = tx.authz.can('guests.sensitive.read', { propertyId: String(n.property_id) });
    if (!allowed) needDetailsWithheld++;
    else {
      await tx.audit({
        action: 'guests.sensitive.read',
        target: { type: 'special_need', id: String(n.id) },
        propertyId: String(n.property_id),
        reason: `Data-subject export ${requestId}`,
        metadata: { profileId, category: n.category, via: 'privacy_export' },
      });
    }
    specialNeeds.push({
      id: n.id,
      category: n.category,
      propertyId: n.property_id,
      guestAgreedText: n.guest_agreed_text,
      detail: allowed
        ? ports.crypto.cipher.decrypt(String(n.enc_detail), `guests.special_need:${tx.tenantId}:${n.id}`)
        : 'withheld: requires guests.sensitive.read at this property',
    });
  }
  withhold(
    'specialNeedDetails',
    needDetailsWithheld,
    'requires guests.sensitive.read at the capturing property',
  );

  // Shared items follow the person; private / department items stay with their property.
  const SHARED = '*shared*';
  const sharedOr = (shared: boolean, propertyId: unknown) => (shared ? SHARED : propertyId);
  const inScopeOrShared = (v: unknown) => v === SHARED || inScope(v);
  const scoped = <T extends Record<string, unknown>>(rows: T[], key: (r: T) => unknown, category: string) => {
    const ok = rows.filter((r) => inScopeOrShared(key(r)));
    withhold(category, rows.length - ok.length, outOfScope);
    return ok;
  };
  const notes = scoped(
    snap.children.notes ?? [],
    (n) => sharedOr(n.visibility === 'shared', n.property_id),
    'notes',
  );
  const alerts = scoped(
    snap.children.alerts ?? [],
    (a) => sharedOr(a.visibility === 'shared', a.property_id),
    'alerts',
  );
  const preferences = scoped(
    snap.children.preferences ?? [],
    (x) => sharedOr(x.scope_property_id === null, x.scope_property_id),
    'preferences',
  );
  const stays = byScope(snap.children.stay_history ?? [], (x) => x.property_id, 'stays');
  const knownAt = (snap.children.profile_properties ?? []).map((x) => String(x.property_id)).filter(inScope);

  const p = snap.profile;
  const modules: Record<string, unknown> = {};
  const manifest: Array<{ module: string; status: 'included' | 'unavailable' }> = [
    { module: 'guests', status: 'included' },
  ];
  for (const c of ports.personalDataContributors ?? []) {
    try {
      modules[c.module] = await c.collect(tx, profileId);
      manifest.push({ module: c.module, status: 'included' });
    } catch {
      manifest.push({ module: c.module, status: 'unavailable' });
    }
  }
  const data = {
    format: 'portico.guest-export.v1',
    generatedAt: tx.now.toISOString(),
    requestId,
    manifest,
    complete: withheld.length === 0 && manifest.every((m) => m.status === 'included'),
    withheld,
    profile: {
      id: p.id,
      status: p.status,
      title: p.title,
      givenName: p.given_name,
      middleName: p.middle_name,
      familyName: p.family_name,
      nativeGivenName: p.native_given_name,
      nativeFamilyName: p.native_family_name,
      preferredName: p.preferred_name,
      language: p.language,
      nationality: p.nationality,
      dateOfBirth: p.date_of_birth,
      vipLevel: p.vip_level,
      tags: p.tags,
      importantDates: p.important_dates,
      createdAt: p.created_at,
    },
    contactPoints: (snap.children.contact_points ?? []).map((c) => ({
      kind: c.kind,
      value: c.value,
      verified: c.verified,
      source: c.source,
    })),
    preferences: preferences.map((x) => ({ category: x.category, value: x.value })),
    alerts: alerts.map((x) => ({ severity: x.severity, text: x.text, status: x.status })),
    notes: notes.map((x) => ({ body: x.body, visibility: x.visibility, createdAt: x.created_at })),
    relationships: [
      ...(snap.children.relationships_out ?? []),
      ...(snap.children.relationships_in ?? []),
    ].map((r) => ({
      kind: r.kind,
      profileId: r.profile_id,
      relatedProfileId: r.related_profile_id,
    })),
    companies: (snap.children.company_contacts ?? []).map((c) => ({ companyId: c.company_id, role: c.role })),
    consents: await consentHistory(tx, ports, profileId),
    identityDocuments: documents,
    specialNeeds,
    stays: stays.map((x) => ({
      stayId: x.stay_id,
      propertyId: x.property_id,
      role: x.role,
      arrival: x.arrival,
      departure: x.departure,
      status: x.status,
    })),
    knownAtProperties: knownAt,
    merges: (await listMergesForProfile(tx, ports, profileId)).map((m) => ({
      id: m.id,
      survivorId: m.survivorId,
      mergedId: m.mergedId,
      status: m.status,
      mergedAt: m.mergedAt,
    })),
    otherModules: modules,
    counts: Object.fromEntries(Object.entries(snap.children).map(([k, v]) => [k, v.length])),
    documentDetailsIncluded:
      docDetailsWithheld === 0 && docs.length === (snap.children.identity_documents ?? []).length,
  };
  return data;
}

/**
 * The identifiers that let erasure find copies of a person in stored API responses (R2-P2-1). Only values that
 * identify the subject exactly, matched later as whole JSON string values: profile ids (the survivor and every
 * profile merged into it), normalized emails and E.164 phone numbers. Never addresses, names or numbers as typed.
 * An email or phone the person shares with another guest who is on LEGAL HOLD is left out, and that guest's id is
 * kept, so the held guest's records are never redacted by someone else's erasure.
 */
export async function erasureIdentifiers(
  tx: TxContext,
  profileIds: readonly string[],
): Promise<{ identifiers: string[]; keep: string[] }> {
  const ids = [...profileIds];
  const own = await db(tx)
    .selectFrom('guests.contact_points')
    .select(['normalized'])
    .where('profile_id', 'in', ids)
    .where('kind', 'in', ['email', 'phone', 'whatsapp'])
    .where('normalized', 'is not', null)
    .execute();
  const values = [...new Set(own.map((c) => c.normalized as string))];
  const held =
    values.length === 0
      ? []
      : await db(tx)
          .selectFrom('guests.contact_points as c')
          .innerJoin('guests.profiles as p', 'p.id', 'c.profile_id')
          .select(['c.profile_id', 'c.normalized'])
          .where('c.normalized', 'in', values)
          .where('c.profile_id', 'not in', ids)
          .where('p.legal_hold', '=', true)
          .execute();
  const heldValues = new Set(held.map((h) => h.normalized));
  return {
    identifiers: [...ids, ...values.filter((v) => !heldValues.has(v))],
    keep: [...new Set(held.map((h) => h.profile_id))],
  };
}

/**
 * Erasure = anonymization (GUE-R18). Profiles merged into this one (same person by staff decision) are
 * anonymized with it and the merge snapshots are redacted — those merges become irreversible (status erased).
 */
export async function eraseProfile(
  tx: TxContext,
  ports: GuestsPorts,
  input: PrivacyRequestInput,
): Promise<{ requestId: string; result: unknown }> {
  const vp = await requireVisibleProfile(tx, ports, input.profileId);
  const acting = actingProperty(tx, 'guests.privacy.erase', vp.row, vp.links);
  if (vp.resolvedFrom) {
    throw new BusinessRuleError(
      'profile_merged',
      `This profile was merged into ${vp.row.id}. Erase the surviving profile (it includes the merged one) or unmerge first.`,
      { survivorId: vp.row.id },
    );
  }
  if (vp.row.status === 'anonymized') {
    throw new BusinessRuleError('already_anonymized', 'This profile has already been anonymized.');
  }
  // The profile and everything merged into it (recursively).
  const { rows: family } = await sql<{ id: string }>`
    with recursive chain as (
      select id from guests.profiles where id = ${vp.row.id}
      union all select p.id from guests.profiles p join chain c on p.merged_into = c.id
    ) select id from chain`.execute(tx.db);
  const ids = family.map((f) => f.id);
  input = { ...input, reason: await scrubReason(tx, input.reason, ids) };
  const requestId = await insertRequest(tx, input, vp.row.id);
  const locked = await db(tx)
    .selectFrom('guests.profiles')
    .select(['id', 'legal_hold'])
    .where('id', 'in', ids)
    .forUpdate()
    .execute();
  if (locked.some((l) => l.legal_hold)) {
    // Recorded (not thrown) so the request and its hold survive: it is resumed when the hold is released.
    const onHold = {
      onHold: true,
      explanation:
        'This guest is under legal hold, so the erasure is on hold. Release the hold (with its reason) when the legal matter ends, then submit the request again.',
    };
    await finish(tx, requestId, 'on_hold', onHold, 'Legal hold');
    await tx.audit({
      action: 'guests.privacy.eraseBlocked',
      target: { type: 'guest_profile', id: vp.row.id },
      propertyId: acting,
      reason: input.reason,
      metadata: { requestId, cause: 'legal_hold' },
    });
    return { requestId, result: onHold };
  }
  // Stored idempotent responses of ANY module that contain this person's exact identifiers are replaced by an
  // erased marker; a replay then answers 410 instead of returning their data (SW-GUE-1). Guests' own endpoints
  // store ids only (replay.ts); this safety net reaches other modules' responses and older records.
  const idempotencyResponses = await redactIdempotencyResponses(tx, await erasureIdentifiers(tx, ids));
  const counts: Record<string, number> = { idempotencyResponses };
  const count = async (k: string, p: Promise<{ numDeletedRows?: bigint; numUpdatedRows?: bigint }[]>) => {
    const r = await p;
    counts[k] =
      (counts[k] ?? 0) + r.reduce((n, x) => n + Number(x.numDeletedRows ?? x.numUpdatedRows ?? 0n), 0);
  };
  await count(
    'contactPoints',
    db(tx).deleteFrom('guests.contact_points').where('profile_id', 'in', ids).execute(),
  );
  await count(
    'identityDocuments',
    db(tx).deleteFrom('guests.identity_documents').where('profile_id', 'in', ids).execute(),
  );
  const needs = await db(tx)
    .deleteFrom('guests.special_needs')
    .where('profile_id', 'in', ids)
    .returning('alert_id')
    .execute();
  counts.specialNeeds = needs.length;
  await count(
    'preferences',
    db(tx).deleteFrom('guests.preferences').where('profile_id', 'in', ids).execute(),
  );
  await count('alerts', db(tx).deleteFrom('guests.alerts').where('profile_id', 'in', ids).execute());
  await count(
    'relationships',
    db(tx)
      .deleteFrom('guests.relationships')
      .where((eb) => eb.or([eb('profile_id', 'in', ids), eb('related_profile_id', 'in', ids)]))
      .execute(),
  );
  await count(
    'companyContacts',
    db(tx).deleteFrom('guests.company_contacts').where('profile_id', 'in', ids).execute(),
  );
  await count(
    'notes',
    db(tx)
      .updateTable('guests.notes')
      .set({ body: '[redacted]', redacted_at: tx.now })
      .where('profile_id', 'in', ids)
      .where('redacted_at', 'is', null)
      .execute(),
  );
  // Consent: purpose / state / date / text version / channel stay as minimal evidence (never personal); the
  // free-text reference (IP, ticket…) is cleared — in the current rows and in the append-only history.
  await count(
    'consents',
    db(tx)
      .updateTable('guests.consents')
      .set({ evidence_reference: null })
      .where('profile_id', 'in', ids)
      .execute(),
  );
  await sql`update guests.consent_events set reference = null
    where reference is not null
      and consent_id in (select c.id from guests.consents c where c.profile_id = any(${ids}::uuid[]))`.execute(
    tx.db,
  );
  await db(tx)
    .deleteFrom('guests.external_refs')
    .where('entity_type', '=', 'profile')
    .where('entity_id', 'in', ids)
    .execute();
  // Merge snapshots contain personal data: redact and mark irreversible.
  await count(
    'mergeRecords',
    db(tx)
      .updateTable('guests.merges')
      .set({ snapshot: JSON.stringify({ redacted: true }), status: 'erased', version: sql`version + 1` })
      .where((eb) => eb.or([eb('survivor_id', 'in', ids), eb('merged_id', 'in', ids)]))
      .where('status', '=', 'active')
      .execute(),
  );
  // Every merge record touching the person: snapshots, field values in decisions, survivor-row before/after,
  // unmerge conflict values and the free-text reasons are removed; field names, sides and rules remain.
  await sql`update guests.merges set
      snapshot = '{"redacted": true}'::jsonb,
      decisions = coalesce((select jsonb_agg(d - 'survivorValue' - 'mergedValue' - 'value')
                            from jsonb_array_elements(decisions) d), '[]'::jsonb),
      survivor_updates = '[]'::jsonb,
      unmerge_result = case when unmerge_result is null then null else '{"redacted": true}'::jsonb end,
      reason = '[redacted]',
      reverse_reason = case when reverse_reason is null then null else '[redacted]' end
    where survivor_id = any(${ids}::uuid[]) or merged_id = any(${ids}::uuid[])`.execute(tx.db);
  for (const id of ids) {
    await db(tx)
      .updateTable('guests.profiles')
      .set({
        status: id === vp.row.id ? 'anonymized' : 'merged',
        title: null,
        given_name: null,
        middle_name: null,
        family_name: anonymizedName(id),
        native_given_name: null,
        native_family_name: null,
        native_script: null,
        preferred_name: null,
        search_name: '',
        search_name_native: null,
        language: null,
        date_of_birth: null,
        vip_level: null,
        tags: [],
        important_dates: '[]',
        source: JSON.stringify({ kind: 'anonymized' }),
        anonymized_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', id)
      .execute();
  }
  // Duplicate suggestions about an anonymized person are meaningless; their match evidence is removed.
  await db(tx)
    .updateTable('guests.duplicate_candidates')
    .set({
      status: 'dismissed',
      resolution_reason: 'Profile anonymized',
      resolved_at: tx.now,
      version: sql`version + 1`,
    })
    .where('status', '=', 'open')
    .where((eb) => eb.or([eb('profile_a_id', 'in', ids), eb('profile_b_id', 'in', ids)]))
    .execute();
  await db(tx)
    .updateTable('guests.duplicate_candidates')
    .set({ reasons: '[]', exact_keys: [], resolution_reason: 'Profile anonymized' })
    .where((eb) => eb.or([eb('profile_a_id', 'in', ids), eb('profile_b_id', 'in', ids)]))
    .execute();
  const retained = await db(tx)
    .selectFrom('guests.stay_history')
    .select([
      sql<number>`count(*)::int`.as('stays'),
      sql<number>`count(revenue_minor)::int`.as('withRevenue'),
    ])
    .where('profile_id', 'in', ids)
    .executeTakeFirstOrThrow();
  const result = {
    plan: ERASURE_PLAN,
    counts,
    anonymizedProfileIds: ids,
    retained: {
      pseudonymousProfileId: vp.row.id,
      stayHistoryRows: retained.stays,
      stayRowsWithRevenue: retained.withRevenue,
      why: 'Stay, booking and folio references and revenue are kept under the pseudonymous id for fiscal retention (finance keeps fiscal documents until their retention period ends).',
    },
  };
  await finish(tx, requestId, 'completed', result);
  await tx.audit({
    action: 'guests.privacy.erase',
    target: { type: 'guest_profile', id: vp.row.id },
    propertyId: acting,
    reason: input.reason,
    metadata: { requestId, counts, alsoAnonymized: ids.filter((i) => i !== vp.row.id) },
  });
  await tx.emit({
    type: 'guests.profile.anonymized',
    aggregate: { type: 'guest_profile', id: vp.row.id },
    payload: {
      profileId: vp.row.id,
      privacyRequestId: requestId,
      alsoAnonymized: ids.filter((i) => i !== vp.row.id),
    },
  });
  return { requestId, result };
}

export async function getPrivacyRequest(
  tx: TxContext,
  ports: GuestsPorts,
  id: string,
): Promise<PrivacyRequestView> {
  const row = await db(tx)
    .selectFrom('guests.privacy_requests')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('privacy_request', id);
  const links = await linkedPropertyIds(tx, row.profile_id);
  const perm = row.kind === 'export' ? 'guests.privacy.export' : 'guests.privacy.erase';
  const scope = tx.authz.propertyScope(perm);
  if (scope !== 'all' && !links.some((p) => scope.includes(p))) {
    requirePermission(tx, perm); // 403 if none at all
    throw new NotFoundError('privacy_request', id);
  }
  void ports;
  return {
    id: row.id,
    kind: row.kind,
    profileId: row.profile_id,
    status: row.status,
    reason: row.reason,
    receivedAt: iso(row.received_at) as string,
    completedAt: iso(row.completed_at),
    rejectionReason: row.rejection_reason,
    result: row.result ?? null,
  };
}

export { getProfile, getStayHistory };
