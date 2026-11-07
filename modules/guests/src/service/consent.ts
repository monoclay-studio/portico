/**
 * Consent and lawful basis per purpose and legal entity (GUE-R06, readiness brief §12).
 * Withdrawal changes the consent state and appends evidence — it never deletes anything else (stay history,
 * revenue and finance references are retained under their own lawful basis).
 */
import { sql, type TxContext } from '@portico/db';
import { ForbiddenError, newId, requirePermission, ValidationError } from '@portico/kernel';
import type { ConsentInput } from '../contracts';
import {
  type ConsentPurpose,
  type ConsentState,
  type LegalBasis,
  mayProcess,
  purposeBasis,
  validateEvidence,
} from '../domain/consent';
import type { GuestsPorts } from '../ports';
import {
  actingProperty,
  actorKey,
  db,
  iso,
  lockProfileForWrite,
  requireVisibleProfile,
  resolveSurvivor,
  SHARING_POLICY_DEFAULT,
  SHARING_POLICY_KEY,
  type SharingPolicy,
} from './internal';

export interface ConsentDecision {
  profileId: string;
  legalEntityId: string;
  purpose: ConsentPurpose;
  state: ConsentState;
  legalBasis: LegalBasis;
  mayProcess: boolean;
  changedAt: string | null;
}

/**
 * Record a consent statement. Staff need guests.profile.update; a signed-in guest may record their own
 * (guest portal / booking engine).
 */
export async function recordConsent(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  input: ConsentInput,
): Promise<ConsentDecision> {
  const isSelf = tx.actor.kind === 'guest' && tx.actor.guestProfileId === profileId;
  const { row } = isSelf
    ? await resolveSurvivor(tx, profileId)
    : await requireVisibleProfile(tx, ports, profileId);
  if (row.status !== 'active') {
    throw new ValidationError('profile_not_active', 'Consent can only be recorded on an active profile.');
  }
  await lockProfileForWrite(tx, row.id); // lock, then decide: never lands on a profile erased meanwhile
  let propertyForCheck: string | null = input.propertyId ?? null;
  if (!isSelf) {
    const links = (
      await db(tx)
        .selectFrom('guests.profile_properties')
        .select('property_id')
        .where('profile_id', '=', row.id)
        .execute()
    ).map((r) => r.property_id);
    propertyForCheck = actingProperty(tx, 'guests.profile.update', row, links, input.propertyId);
  }
  let legalEntityId = input.legalEntityId ?? null;
  if (!legalEntityId) {
    if (!input.propertyId) {
      throw new ValidationError(
        'legal_entity_required',
        'Consent is recorded per legal entity. Give legalEntityId, or the propertyId whose operating company it is.',
      );
    }
    legalEntityId = await ports.platform.getPropertyLegalEntityId(tx, input.propertyId);
  } else if (!(await ports.platform.legalEntityExists(tx, legalEntityId))) {
    throw new ValidationError(
      'unknown_legal_entity',
      'This legal entity does not belong to your organization. Choose one of your operating companies.',
      { legalEntityId },
    );
  }
  const problem = validateEvidence(input.state, input.evidence ?? {});
  if (problem) throw new ValidationError('consent_evidence_required', problem, { purpose: input.purpose });

  const existing = await db(tx)
    .selectFrom('guests.consents')
    .selectAll()
    .where('profile_id', '=', row.id)
    .where('legal_entity_id', '=', legalEntityId)
    .where('purpose', '=', input.purpose)
    .forUpdate()
    .executeTakeFirst();
  // Minimal evidence (what text, which channel, when) lives in the append-only history; free text such as an IP
  // address or ticket reference is kept separately so erasure can clear it (GUE-I06).
  const ev = input.evidence ?? {};
  const evidence = JSON.stringify({
    ...(ev.textVersion ? { textVersion: ev.textVersion } : {}),
    ...(ev.channel ? { channel: ev.channel } : {}),
    ...(ev.capturedAt ? { capturedAt: ev.capturedAt } : {}),
  });
  const reference = ev.reference ?? null;
  let consentId: string;
  if (existing) {
    consentId = existing.id;
    await db(tx)
      .updateTable('guests.consents')
      .set({
        state: input.state,
        source: input.source,
        evidence,
        evidence_reference: reference,
        changed_at: tx.now,
        version: sql`version + 1`,
      })
      .where('id', '=', existing.id)
      .execute();
  } else {
    consentId = newId(tx.now.getTime());
    await db(tx)
      .insertInto('guests.consents')
      .values({
        id: consentId,
        tenant_id: tx.tenantId,
        profile_id: row.id,
        legal_entity_id: legalEntityId,
        purpose: input.purpose,
        state: input.state,
        source: input.source,
        evidence,
        evidence_reference: reference,
        changed_at: tx.now,
        requested_profile_id: profileId !== row.id ? profileId : null,
      })
      .execute();
  }
  await db(tx)
    .insertInto('guests.consent_events')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      consent_id: consentId,
      legal_entity_id: legalEntityId,
      purpose: input.purpose,
      state: input.state,
      source: input.source,
      evidence,
      reference,
      occurred_at: tx.now,
      actor_key: actorKey(tx),
    })
    .execute();
  await tx.audit({
    action: 'guests.consent.record',
    target: { type: 'guest_profile', id: row.id },
    propertyId: propertyForCheck,
    before: existing ? { purpose: input.purpose, state: existing.state } : null,
    after: { purpose: input.purpose, state: input.state },
    metadata: { legalEntityId, source: input.source },
  });
  await tx.emit({
    type: 'guests.consent.changed',
    propertyId: input.propertyId ?? null,
    aggregate: { type: 'guest_profile', id: row.id },
    payload: { profileId: row.id, legalEntityId, purpose: input.purpose, state: input.state },
  });
  return decide(tx, ports, row.id, legalEntityId, input.purpose, input.propertyId ?? null);
}

async function decide(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  legalEntityId: string,
  purpose: ConsentPurpose,
  propertyId: string | null,
): Promise<ConsentDecision> {
  const row = await db(tx)
    .selectFrom('guests.consents')
    .select(['state', 'changed_at'])
    .where('profile_id', '=', profileId)
    .where('legal_entity_id', '=', legalEntityId)
    .where('purpose', '=', purpose)
    .executeTakeFirst();
  let sharingRequiresConsent = false;
  if (purpose === 'cross_property_sharing' && propertyId) {
    const pol = await ports.platform.resolvePolicy<SharingPolicy>(
      tx,
      propertyId,
      SHARING_POLICY_KEY,
      SHARING_POLICY_DEFAULT,
    );
    sharingRequiresConsent = { ...SHARING_POLICY_DEFAULT, ...(pol.value ?? {}) }.requireConsent;
  }
  const basis = purposeBasis(purpose, { sharingRequiresConsent });
  const state = row?.state ?? 'unknown';
  const profile = await db(tx)
    .selectFrom('guests.profiles')
    .select('status')
    .where('id', '=', profileId)
    .executeTakeFirst();
  // An anonymized guest's retained consent rows are evidence only — nothing may be processed on them.
  return {
    profileId,
    legalEntityId,
    purpose,
    state,
    legalBasis: basis.basis,
    mayProcess: profile?.status === 'active' && mayProcess(basis, state),
    changedAt: iso(row?.changed_at ?? null),
  };
}

/**
 * Provider (spec proposed contract): may this purpose be processed for this guest and legal entity? Used by comms
 * before marketing sends (GUE-I07). Trusted provider call: the caller enforces its own permissions.
 */
export async function getConsent(
  tx: TxContext,
  ports: GuestsPorts,
  input: { profileId: string; legalEntityId: string; purpose: ConsentPurpose; propertyId?: string },
): Promise<ConsentDecision> {
  // Trusted provider call (comms decides before marketing sends) — still deny-by-default for staff without any
  // guest-profile permission; system consumers (event handlers, schedulers) are allowed.
  if (tx.actor.kind !== 'system' && !tx.authz.can('guests.profile.read')) {
    throw new ForbiddenError('guests.profile.read');
  }
  const { row } = await resolveSurvivor(tx, input.profileId);
  return decide(tx, ports, row.id, input.legalEntityId, input.purpose, input.propertyId ?? null);
}

/** Consent evidence history (append-only), including statements recorded before a merge. */
export async function consentHistory(tx: TxContext, ports: GuestsPorts, profileId: string) {
  const vp = await requireVisibleProfile(tx, ports, profileId);
  if (!tx.authz.can('guests.profile.read') && vp.view !== 'shared')
    throw new ForbiddenError('guests.profile.read');
  const rows = await db(tx)
    .selectFrom('guests.consent_events as e')
    .innerJoin('guests.consents as c', 'c.id', 'e.consent_id')
    .select(['e.id', 'e.legal_entity_id', 'e.purpose', 'e.state', 'e.source', 'e.evidence', 'e.occurred_at'])
    .where('c.profile_id', '=', vp.row.id)
    .orderBy('e.occurred_at')
    .execute();
  return rows.map((r) => ({
    id: r.id,
    legalEntityId: r.legal_entity_id,
    purpose: r.purpose,
    state: r.state,
    source: r.source,
    evidence: r.evidence,
    occurredAt: iso(r.occurred_at),
  }));
}

export { requirePermission };
