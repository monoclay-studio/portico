/**
 * Data-subject requests (GUE-R17 export, GUE-R18 erasure-with-retention). Both are audited. Erasure anonymizes
 * personal data and keeps the pseudonymous profile id with its stay/folio references and revenue, which finance
 * must retain for the statutory period (research 04 §C1, Q44). Blocked by legal hold.
 */
import { sql, type TxContext } from '@portico/db';
import { BusinessRuleError, NotFoundError, newId, requirePermission } from '@portico/kernel';
import type { PrivacyRequestInput } from '../contracts';
import { anonymizedName, ERASURE_PLAN } from '../domain/privacy';
import type { GuestsPorts } from '../ports';
import { consentHistory } from './consent';
import { getStayHistory } from './history';
import { actingProperty, actorKey, db, iso, linkedPropertyIds, requireVisibleProfile } from './internal';
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
 * audited — personal data does not sit in request logs or idempotency records.
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

async function buildExport(tx: TxContext, ports: GuestsPorts, profileId: string, requestId: string) {
  const snap = await snapshotProfile(tx, profileId);
  const canReadDocs = tx.authz.can('guests.document.read');
  const documents = (snap.children.identity_documents ?? []).map((d) => {
    const base = {
      id: d.id,
      type: d.doc_type,
      issuingCountry: d.issuing_country,
      expiryDate: d.expiry_date,
      propertyId: d.property_id,
    };
    if (!canReadDocs) return { ...base, details: 'withheld: requires guests.document.read' };
    const payload = JSON.parse(
      ports.crypto.cipher.decrypt(String(d.enc_payload), `guests.identity_document:${tx.tenantId}:${d.id}`),
    ) as Record<string, unknown>;
    return { ...base, details: payload };
  });
  const specialNeeds = (snap.children.special_needs ?? []).map((s) => ({
    id: s.id,
    category: s.category,
    propertyId: s.property_id,
    guestAgreedText: s.guest_agreed_text,
    detail: tx.authz.can('guests.sensitive.read')
      ? ports.crypto.cipher.decrypt(String(s.enc_detail), `guests.special_need:${tx.tenantId}:${s.id}`)
      : 'withheld: requires guests.sensitive.read',
  }));
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
    preferences: (snap.children.preferences ?? []).map((x) => ({ category: x.category, value: x.value })),
    alerts: (snap.children.alerts ?? []).map((x) => ({
      severity: x.severity,
      text: x.text,
      status: x.status,
    })),
    notes: (snap.children.notes ?? []).map((x) => ({
      body: x.body,
      visibility: x.visibility,
      createdAt: x.created_at,
    })),
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
    stays: (snap.children.stay_history ?? []).map((s) => ({
      stayId: s.stay_id,
      propertyId: s.property_id,
      role: s.role,
      arrival: s.arrival,
      departure: s.departure,
      status: s.status,
    })),
    knownAtProperties: (snap.children.profile_properties ?? []).map((x) => x.property_id),
    merges: (await listMergesForProfile(tx, ports, profileId)).map((m) => ({
      id: m.id,
      survivorId: m.survivorId,
      mergedId: m.mergedId,
      status: m.status,
      mergedAt: m.mergedAt,
    })),
    otherModules: modules,
    counts: Object.fromEntries(Object.entries(snap.children).map(([k, v]) => [k, v.length])),
    documentDetailsIncluded: canReadDocs,
  };
  return data;
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
  const requestId = await insertRequest(tx, input, vp.row.id);
  // Lock the profile and everything merged into it (recursively).
  const { rows: family } = await sql<{ id: string }>`
    with recursive chain as (
      select id from guests.profiles where id = ${vp.row.id}
      union all select p.id from guests.profiles p join chain c on p.merged_into = c.id
    ) select id from chain`.execute(tx.db);
  const ids = family.map((f) => f.id);
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
  const counts: Record<string, number> = {};
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
  // Consent: keep purpose / state / date as evidence; remove free-text evidence.
  await count(
    'consents',
    db(tx)
      .updateTable('guests.consents')
      .set({ evidence: JSON.stringify({ redacted: true }) })
      .where('profile_id', 'in', ids)
      .execute(),
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
  await db(tx)
    .updateTable('guests.merges')
    .set({ snapshot: JSON.stringify({ redacted: true }) })
    .where((eb) => eb.or([eb('survivor_id', 'in', ids), eb('merged_id', 'in', ids)]))
    .execute();
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
  // Duplicate suggestions about an anonymized person are meaningless.
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
