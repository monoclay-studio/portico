/**
 * Identity documents (GUE-R05, GUE-I04): field-encrypted (FieldCipher port), keyed blind indexes for exact
 * matching, masked by default, revealed only with guests.document.read at the capturing property — and every
 * reveal is audited with a reason. Never shared across properties; erased on retention.
 */
import { sql, type TxContext } from '@portico/db';
import { NotFoundError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { DocumentInput } from '../contracts';
import {
  documentHashInput,
  documentLast4Input,
  normalizeDocumentNumber,
  retentionDate,
} from '../domain/documents';
import { type GuestsPorts, keyIdOf } from '../ports';
import { detectDuplicates } from './duplicates';
import { actorKey, db, requireVisibleProfile, requireWritableProfile, scrubReason, today } from './internal';

export const DOCUMENT_RETENTION_POLICY_KEY = 'guests.retention.identityDocumentDays';
export const DOCUMENT_RETENTION_DEFAULT_DAYS = 365; // Q44 placeholder default
export const DOCUMENT_IMAGES_POLICY_KEY = 'guests.documentImages.enabled';

const aadFor = (tenantId: string, docId: string) => `guests.identity_document:${tenantId}:${docId}`;

interface DocumentPayload {
  number: string;
  surname?: string;
  givenNames?: string;
  nationality?: string;
  dateOfBirth?: string;
  issueDate?: string;
}

export async function addDocument(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: DocumentInput,
): Promise<{ documentId: string }> {
  const vp = await requireWritableProfile(tx, ports, profileId, 'guests.document.manage', input.propertyId);
  if (input.imageRef) {
    const allowed = await ports.platform.resolvePolicy(
      tx,
      input.propertyId,
      DOCUMENT_IMAGES_POLICY_KEY,
      false,
    );
    if (allowed.value !== true) {
      throw new ValidationError(
        'document_images_disabled',
        'This property does not store identity-document images. Record the document details only, or ask an administrator to enable image storage (property policy).',
      );
    }
  }
  const number = normalizeDocumentNumber(input.number);
  const numberHash = ports.crypto.blindIndex(documentHashInput(number, input.issuingCountry));
  const existing = await db(tx)
    .selectFrom('guests.identity_documents')
    .select('id')
    .where('profile_id', '=', vp.row.id)
    .where('number_hash', '=', numberHash)
    .executeTakeFirst();
  if (existing) {
    throw new ValidationError('document_exists', 'This document is already recorded on the profile.', {
      documentId: existing.id,
    });
  }
  const days = await ports.platform.resolvePolicy(
    tx,
    input.propertyId,
    DOCUMENT_RETENTION_POLICY_KEY,
    DOCUMENT_RETENTION_DEFAULT_DAYS,
  );
  const lastDeparture = await db(tx)
    .selectFrom('guests.stay_history')
    .select(sql<string | null>`max(departure)::text`.as('d'))
    .where('profile_id', '=', vp.row.id)
    .executeTakeFirst();
  const anchor = lastDeparture?.d && lastDeparture.d > today(tx) ? lastDeparture.d : today(tx);
  const id = newId(tx.now.getTime());
  const payload: DocumentPayload = {
    number,
    ...(input.surname ? { surname: input.surname } : {}),
    ...(input.givenNames ? { givenNames: input.givenNames } : {}),
    ...(input.nationality ? { nationality: input.nationality } : {}),
    ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
    ...(input.issueDate ? { issueDate: input.issueDate } : {}),
  };
  const encrypted = ports.crypto.cipher.encrypt(JSON.stringify(payload), aadFor(tx.tenantId, id));
  await db(tx)
    .insertInto('guests.identity_documents')
    .values({
      id,
      tenant_id: tx.tenantId,
      profile_id: vp.row.id,
      property_id: input.propertyId,
      doc_type: input.type,
      issuing_country: input.issuingCountry,
      enc_payload: encrypted,
      key_id: keyIdOf(encrypted),
      number_hash: numberHash,
      last4_hash: ports.crypto.blindIndex(documentLast4Input(number)),
      expiry_date: input.expiryDate ?? null,
      image_ref: input.imageRef ?? null,
      retain_until: retentionDate(anchor, Number(days.value)),
      requested_profile_id: profileId !== vp.row.id ? profileId : null,
      created_by: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'guests.document.capture',
    target: { type: 'identity_document', id },
    propertyId: input.propertyId,
    // Never the number (GUE-I04).
    metadata: { profileId: vp.row.id, type: input.type, issuingCountry: input.issuingCountry },
  });
  await detectDuplicates(tx, ports, vp.row.id, 'on_update');
  return { documentId: id };
}

async function loadDocument(tx: TxContext, documentId: string) {
  const row = await db(tx)
    .selectFrom('guests.identity_documents')
    .selectAll()
    .where('id', '=', documentId)
    .executeTakeFirst();
  if (!row) throw new NotFoundError('identity_document', documentId);
  return row;
}

/** Audited reveal (guests.document.read ⚑ at the capturing property). */
export async function revealDocument(tx: TxContext, ports: GuestsPorts, documentId: string, reason: string) {
  const row = await loadDocument(tx, documentId);
  // The profile must be visible at the document's property, otherwise the document does not exist for the caller.
  await requireVisibleProfile(tx, ports, row.profile_id, { propertyId: row.property_id }).catch(() => {
    throw new NotFoundError('identity_document', documentId);
  });
  requirePermission(tx, 'guests.document.read', { propertyId: row.property_id });
  const why = await scrubReason(tx, reason, [row.profile_id]);
  const payload = JSON.parse(
    ports.crypto.cipher.decrypt(row.enc_payload, aadFor(tx.tenantId, row.id)),
  ) as DocumentPayload;
  await tx.audit({
    action: 'guests.document.read',
    target: { type: 'identity_document', id: row.id },
    propertyId: row.property_id,
    reason: why,
    metadata: { profileId: row.profile_id, type: row.doc_type, fields: Object.keys(payload) },
  });
  return {
    id: row.id,
    type: row.doc_type,
    issuingCountry: row.issuing_country,
    number: payload.number,
    expiryDate: row.expiry_date,
    issueDate: payload.issueDate ?? null,
    surname: payload.surname ?? null,
    givenNames: payload.givenNames ?? null,
    nationality: payload.nationality ?? null,
    dateOfBirth: payload.dateOfBirth ?? null,
  };
}

export async function deleteDocument(tx: TxContext, ports: GuestsPorts, documentId: string, reason: string) {
  const row = await loadDocument(tx, documentId);
  await requireVisibleProfile(tx, ports, row.profile_id, { propertyId: row.property_id }).catch(() => {
    throw new NotFoundError('identity_document', documentId);
  });
  requirePermission(tx, 'guests.document.manage', { propertyId: row.property_id });
  const why = await scrubReason(tx, reason, [row.profile_id]);
  await db(tx).deleteFrom('guests.identity_documents').where('id', '=', documentId).execute();
  await tx.audit({
    action: 'guests.document.delete',
    target: { type: 'identity_document', id: documentId },
    propertyId: row.property_id,
    reason: why,
    metadata: { profileId: row.profile_id, type: row.doc_type },
  });
}

/** Extend document retention to the configured period after a (new) departure. */
export async function extendDocumentRetention(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  propertyId: string,
  departure: string,
): Promise<void> {
  const days = await ports.platform.resolvePolicy(
    tx,
    propertyId,
    DOCUMENT_RETENTION_POLICY_KEY,
    DOCUMENT_RETENTION_DEFAULT_DAYS,
  );
  const until = retentionDate(departure, Number(days.value));
  await db(tx)
    .updateTable('guests.identity_documents')
    .set({ retain_until: until })
    .where('profile_id', '=', profileId)
    .where('retain_until', '<', until)
    .execute();
}

/**
 * Recompute document retention from the profile's own stays (after an unmerge, stays that belonged to the other
 * guest must no longer keep this guest's documents alive).
 */
export async function recomputeDocumentRetention(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
): Promise<void> {
  const docs = await db(tx)
    .selectFrom('guests.identity_documents')
    .select(['id', 'property_id', sql<string>`created_at::date::text`.as('captured')])
    .where('profile_id', '=', profileId)
    .execute();
  if (docs.length === 0) return;
  const last = await db(tx)
    .selectFrom('guests.stay_history')
    .select(sql<string | null>`max(departure)::text`.as('d'))
    .where('profile_id', '=', profileId)
    .executeTakeFirst();
  for (const d of docs) {
    const days = await ports.platform.resolvePolicy(
      tx,
      d.property_id,
      DOCUMENT_RETENTION_POLICY_KEY,
      DOCUMENT_RETENTION_DEFAULT_DAYS,
    );
    const anchor = last?.d && last.d > d.captured ? last.d : d.captured;
    await db(tx)
      .updateTable('guests.identity_documents')
      .set({ retain_until: retentionDate(anchor, Number(days.value)) })
      .where('id', '=', d.id)
      .execute();
  }
}

/**
 * Retention job (GUE-R19, documents category): delete identity documents whose retention date has passed and
 * report what was removed. Scheduled daily by the worker (not wired in wave 1).
 */
export async function purgeExpiredDocuments(
  tx: TxContext,
  opts: { asOf?: string } = {},
): Promise<{ deleted: number; documentIds: string[]; heldByLegalHold: number }> {
  requirePermission(tx, 'guests.document.manage');
  // Manual runs are limited to the caller's properties; the scheduled job runs as system (all properties).
  const scope = tx.authz.propertyScope('guests.document.manage');
  const asOf = opts.asOf ?? today(tx);
  const due = (q: ReturnType<typeof baseDue>) =>
    scope === 'all' ? q : q.where('d.property_id', 'in', [...scope]);
  const baseDue = () =>
    db(tx)
      .selectFrom('guests.identity_documents as d')
      .innerJoin('guests.profiles as p', 'p.id', 'd.profile_id')
      .where('d.retain_until', '<', asOf);
  const held = await due(baseDue())
    .where('p.legal_hold', '=', true)
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirst();
  const ids = (await due(baseDue()).where('p.legal_hold', '=', false).select('d.id').execute()).map(
    (r) => r.id,
  );
  const rows =
    ids.length === 0
      ? []
      : await db(tx)
          .deleteFrom('guests.identity_documents')
          .where('id', 'in', ids)
          .returning(['id', 'profile_id', 'property_id', 'doc_type'])
          .execute();
  for (const r of rows) {
    await tx.audit({
      action: 'guests.document.retentionPurge',
      target: { type: 'identity_document', id: r.id },
      propertyId: r.property_id,
      reason: `Retention period ended before ${asOf}`,
      metadata: { profileId: r.profile_id, type: r.doc_type },
    });
  }
  // Run report: what was deleted, and what a legal hold kept.
  return { deleted: rows.length, documentIds: rows.map((r) => r.id), heldByLegalHold: held?.n ?? 0 };
}
