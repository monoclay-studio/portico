/**
 * Builds the permission-filtered profile view (what a staff member at their properties may see).
 */
import type { TxContext } from '@portico/db';
import { type Actor, actorLabel } from '@portico/kernel';
import type { GuestProfile } from '../contracts';
import { type ConsentPurpose, mayProcess, purposeBasis } from '../domain/consent';
import { isExpired } from '../domain/documents';
import { displayName } from '../domain/names';
import { documentVisible, itemVisible } from '../domain/visibility';
import { actorKey, db, iso, today, type VisibleProfile } from './internal';

export async function buildProfileView(tx: TxContext, vp: VisibleProfile): Promise<GuestProfile> {
  const { row, view, access, consent } = vp;
  const id = row.id;
  const [contacts, prefs, alerts, notes, relOut, relIn, companies, consents, docs, needs, ext] =
    await Promise.all([
      db(tx)
        .selectFrom('guests.contact_points')
        .selectAll()
        .where('profile_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db(tx)
        .selectFrom('guests.preferences')
        .selectAll()
        .where('profile_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db(tx)
        .selectFrom('guests.alerts')
        .selectAll()
        .where('profile_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db(tx)
        .selectFrom('guests.notes')
        .selectAll()
        .where('profile_id', '=', id)
        .orderBy('created_at')
        .execute(),
      db(tx).selectFrom('guests.relationships').selectAll().where('profile_id', '=', id).execute(),
      db(tx).selectFrom('guests.relationships').selectAll().where('related_profile_id', '=', id).execute(),
      db(tx).selectFrom('guests.company_contacts').selectAll().where('profile_id', '=', id).execute(),
      db(tx)
        .selectFrom('guests.consents')
        .selectAll()
        .where('profile_id', '=', id)
        .orderBy('purpose')
        .execute(),
      db(tx).selectFrom('guests.identity_documents').selectAll().where('profile_id', '=', id).execute(),
      db(tx).selectFrom('guests.special_needs').selectAll().where('profile_id', '=', id).execute(),
      db(tx)
        .selectFrom('guests.external_refs')
        .select(['system_name', 'last_synced_at'])
        .where('entity_type', '=', 'profile')
        .where('entity_id', '=', id)
        .executeTakeFirst(),
    ]);
  const me = actorKey(tx);
  const ownProperty = (p: string) => access.readAll || access.readPropertyIds.includes(p);
  const sharingRequiresConsent = access.sharingRequiresConsent;

  return {
    id,
    status: row.status,
    ...(vp.resolvedFrom ? { resolvedFrom: vp.resolvedFrom } : {}),
    visibility: view,
    provenance: row.provenance,
    external: ext ? { systemName: ext.system_name, lastSyncedAt: iso(ext.last_synced_at) as string } : null,
    title: row.title,
    givenName: row.given_name,
    middleName: row.middle_name,
    familyName: row.family_name,
    nativeGivenName: row.native_given_name,
    nativeFamilyName: row.native_family_name,
    nativeScript: row.native_script,
    preferredName: row.preferred_name,
    displayName: displayName({
      title: row.title,
      givenName: row.given_name,
      preferredName: row.preferred_name,
      familyName: row.family_name,
    }),
    language: row.language,
    nationality: row.nationality,
    dateOfBirth: row.date_of_birth,
    vipLevel: row.vip_level,
    tags: row.tags,
    importantDates: (row.important_dates ?? []) as GuestProfile['importantDates'],
    homePropertyId: row.home_property_id,
    knownAtPropertyIds: vp.links,
    legalHold: row.legal_hold,
    contactPoints: contacts.map((c) => ({
      id: c.id,
      kind: c.kind,
      value: c.value,
      normalized: c.normalized,
      label: c.label,
      isPrimary: c.is_primary,
      verified: c.verified,
      verifiedAt: iso(c.verified_at),
      source: c.source,
      lowConfidence: c.low_confidence,
    })),
    preferences: prefs
      .filter((p) => p.scope_property_id === null || (view === 'full' && ownProperty(p.scope_property_id)))
      .map((p) => ({
        id: p.id,
        category: p.category,
        value: p.value,
        scopePropertyId: p.scope_property_id,
        source: p.source,
        confirmedAt: iso(p.confirmed_at),
        version: p.version,
      })),
    alerts: alerts
      .filter((a) =>
        itemVisible(access, view, { visibility: a.visibility, propertyId: a.property_id }, consent),
      )
      .map((a) => ({
        id: a.id,
        severity: a.severity,
        text: a.text,
        audience: a.audience,
        visibility: a.visibility,
        propertyId: a.property_id,
        activeFrom: a.active_from,
        activeTo: a.active_to,
        status: a.status,
        version: a.version,
      })),
    notes: notes
      .filter((n) =>
        itemVisible(
          access,
          view,
          { visibility: n.visibility, propertyId: n.property_id, authoredByActor: n.author_key === me },
          consent,
          { readPrivateNotePropertyIds: access.readPrivateNotes },
        ),
      )
      .map((n) => ({
        id: n.id,
        body: n.body,
        visibility: n.visibility,
        propertyId: n.property_id,
        department: n.department,
        author: actorLabel(n.author as Actor),
        createdAt: iso(n.created_at) as string,
        supersedesId: n.supersedes_id,
        superseded: n.superseded_at !== null,
        redacted: n.redacted_at !== null,
      })),
    relationships: [
      ...relOut.map((r) => ({
        id: r.id,
        relatedProfileId: r.related_profile_id,
        kind: r.kind as GuestProfile['relationships'][number]['kind'],
        direction: 'outgoing' as const,
      })),
      ...relIn.map((r) => ({
        id: r.id,
        relatedProfileId: r.profile_id,
        kind: r.kind as GuestProfile['relationships'][number]['kind'],
        direction: 'incoming' as const,
      })),
    ],
    companies: companies.map((c) => ({ companyId: c.company_id, role: c.role })),
    consents: consents.map((c) => {
      const basis = purposeBasis(c.purpose as ConsentPurpose, { sharingRequiresConsent });
      return {
        legalEntityId: c.legal_entity_id,
        purpose: c.purpose as ConsentPurpose,
        state: c.state,
        source: c.source,
        changedAt: iso(c.changed_at) as string,
        legalBasis: basis.basis,
        mayProcess: mayProcess(basis, c.state),
      };
    }),
    documents: docs
      .filter((d) => documentVisible(access, view, d.property_id))
      .map((d) => ({
        id: d.id,
        type: d.doc_type,
        issuingCountry: d.issuing_country,
        expiryDate: d.expiry_date,
        expired: isExpired(d.expiry_date, today(tx)),
        propertyId: d.property_id,
        numberMasked: '••••••' as const,
        hasImage: d.image_ref !== null,
        retainUntil: d.retain_until,
      })),
    specialNeeds: needs
      .filter((s) => documentVisible(access, view, s.property_id))
      .map((s) => ({
        id: s.id,
        category: s.category,
        propertyId: s.property_id,
        guestAgreedText: s.guest_agreed_text,
        detailAvailable: tx.authz.can('guests.sensitive.read', { propertyId: s.property_id }),
      })),
    createdAt: iso(row.created_at) as string,
    updatedAt: iso(row.updated_at) as string,
    version: row.version,
  };
}
