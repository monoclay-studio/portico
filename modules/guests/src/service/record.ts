/**
 * Universal record contract for guest profiles and companies (CLAUDE.md §4.17): server-computed next actions
 * (with plain-language reasons when disabled), issues, links to related records. The UI, API, integrations and
 * AI all see the same truth.
 */
import type { TxContext } from '@portico/db';
import type { RecordAction, RecordIssue, RecordLink } from '@portico/kernel';
import { QUEUE_THRESHOLD } from '../domain/duplicates';
import { db, iso, today, type VisibleProfile } from './internal';

/** Holds `permission` at a property where the guest is known (or organization-wide). */
function canOnProfile(
  tx: TxContext,
  permission: string,
  links: readonly string[],
  viewingPropertyId: string | null,
) {
  if (viewingPropertyId) return tx.authz.can(permission, { propertyId: viewingPropertyId });
  const scope = tx.authz.propertyScope(permission);
  return scope === 'all' || links.some((p) => scope.includes(p));
}

const action = (
  a: string,
  label: string,
  enabled: boolean,
  reason?: string,
  previewRequired?: boolean,
): RecordAction => ({
  action: a,
  label,
  enabled,
  ...(enabled || !reason ? {} : { reason }),
  ...(previewRequired ? { previewRequired } : {}),
});

export async function profileRecord(
  tx: TxContext,
  vp: VisibleProfile,
  facts: {
    mirroredFrom: string | null;
    documents: Array<{ id: string; expiry_date: string | null; property_id: string }>;
    contacts: Array<{ verified: boolean; low_confidence: boolean }>;
    alerts: Array<{ severity: string; status: string; text: string }>;
    companies: Array<{ company_id: string; role: string }>;
    relationships: Array<{ id: string; other: string; kind: string }>;
  },
): Promise<{ allowedActions: RecordAction[]; issues: RecordIssue[]; links: RecordLink[] }> {
  const { row, links: known, view } = vp;
  const id = row.id;
  const P = vp.access.propertyId;
  const can = (perm: string) => canOnProfile(tx, perm, known, P);
  const [dups, activeMerges, mergedFrom, stays] = await Promise.all([
    db(tx)
      .selectFrom('guests.duplicate_candidates')
      .select(['id', 'profile_a_id', 'profile_b_id', 'score', 'detected_at'])
      .where('status', '=', 'open')
      .where((eb) => eb.or([eb('profile_a_id', '=', id), eb('profile_b_id', '=', id)]))
      .orderBy('score', 'desc')
      .limit(5)
      .execute(),
    db(tx)
      .selectFrom('guests.merges')
      .select(['id', 'merged_id', 'merged_at'])
      .where('survivor_id', '=', id)
      .where('status', '=', 'active')
      .orderBy('merged_at', 'desc')
      .execute(),
    db(tx).selectFrom('guests.profiles').select('id').where('merged_into', '=', id).execute(),
    db(tx)
      .selectFrom('guests.stay_history')
      .select(['stay_id', 'booking_id', 'arrival', 'departure', 'property_id'])
      .where('profile_id', '=', id)
      .orderBy('arrival', 'desc')
      .limit(20)
      .execute(),
  ]);
  const anonymized = row.status === 'anonymized';
  const full = view === 'full';
  const readOnlyReason = anonymized
    ? 'This guest was anonymized on request; the profile can no longer change.'
    : undefined;
  const mirrorReason = facts.mirroredFrom
    ? `Names and contact details are mastered in ${facts.mirroredFrom}; change them there.`
    : undefined;
  const missing = (perm: string) => `You do not have the permission ${perm} for this guest's property.`;

  const allowedActions: RecordAction[] = [
    action(
      'edit',
      'Edit details',
      !anonymized && !facts.mirroredFrom && can('guests.profile.update'),
      readOnlyReason ?? mirrorReason ?? missing('guests.profile.update'),
    ),
    action(
      'addNote',
      'Add note',
      !anonymized && can('guests.profile.update'),
      readOnlyReason ?? missing('guests.profile.update'),
    ),
    action(
      'addPreference',
      'Add preference',
      !anonymized && can('guests.profile.update'),
      readOnlyReason ?? missing('guests.profile.update'),
    ),
    action(
      'raiseAlert',
      'Raise alert',
      !anonymized && can('guests.alert.manage'),
      readOnlyReason ?? missing('guests.alert.manage'),
    ),
    action(
      'recordConsent',
      'Record consent',
      !anonymized && can('guests.profile.update'),
      readOnlyReason ?? missing('guests.profile.update'),
    ),
    action(
      'merge',
      dups.length ? 'Review possible duplicate' : 'Merge with another profile',
      !anonymized && full && !facts.mirroredFrom && can('guests.profile.merge'),
      readOnlyReason ??
        (facts.mirroredFrom
          ? `Merge duplicates in ${facts.mirroredFrom}, the system of record.`
          : full
            ? missing('guests.profile.merge')
            : 'Only staff at a property where this guest is known can merge the profile.'),
      true,
    ),
    action(
      'unmerge',
      'Reverse a merge',
      activeMerges.length > 0 && can('guests.profile.unmerge'),
      activeMerges.length === 0
        ? 'No profile has been merged into this one.'
        : missing('guests.profile.unmerge'),
      true,
    ),
    action(
      'revealDocument',
      'View identity document',
      facts.documents.length > 0 &&
        facts.documents.some((d) => tx.authz.can('guests.document.read', { propertyId: d.property_id })),
      facts.documents.length === 0 ? 'No identity document is recorded.' : missing('guests.document.read'),
    ),
    action(
      'exportData',
      'Export personal data',
      full && can('guests.privacy.export'),
      missing('guests.privacy.export'),
    ),
    action(
      'erase',
      'Erase on request',
      !anonymized && full && !row.legal_hold && can('guests.privacy.erase'),
      readOnlyReason ??
        (row.legal_hold
          ? 'The guest is under legal hold; erasure waits until the hold is released.'
          : missing('guests.privacy.erase')),
      true,
    ),
  ];

  const issues: RecordIssue[] = [];
  for (const d of dups) {
    if (Number(d.score) < QUEUE_THRESHOLD) continue;
    issues.push({
      code: 'possible_duplicate',
      severity: 'warning',
      message: `Possible duplicate profile (match score ${Number(d.score).toFixed(2)}). Review it before the next stay.`,
      since: iso(d.detected_at) as string,
    });
  }
  const now = today(tx);
  for (const d of facts.documents) {
    if (d.expiry_date && d.expiry_date < now) {
      issues.push({
        code: 'document_expired',
        severity: 'warning',
        message: 'An identity document on file has expired.',
      });
    }
  }
  for (const a of facts.alerts) {
    if (a.status === 'active' && a.severity === 'critical') {
      issues.push({ code: 'critical_alert', severity: 'warning', message: a.text });
    }
  }
  if (!anonymized && facts.contacts.length > 0 && !facts.contacts.some((c) => c.verified)) {
    issues.push({
      code: 'no_verified_contact',
      severity: 'info',
      message: 'No contact detail has been verified yet.',
    });
  }
  if (!anonymized && !row.given_name && facts.contacts.length === 0) {
    issues.push({
      code: 'sparse_profile',
      severity: 'info',
      message:
        'Only a family name is known (e.g. from a tour-operator rooming list). Complete it at check-in.',
    });
  }
  if (row.legal_hold) {
    issues.push({
      code: 'legal_hold',
      severity: 'info',
      message: 'Under legal hold: erasure requests are held.',
    });
  }
  if (facts.mirroredFrom) {
    issues.push({
      code: 'mirrored_profile',
      severity: 'info',
      message: `Mirrored from ${facts.mirroredFrom}. Preferences, alerts, notes and consent recorded here are Portico-only and are not sent to ${facts.mirroredFrom}.`,
    });
  }

  const links: RecordLink[] = [
    ...facts.companies.map((c) => ({ rel: `company:${c.role}`, type: 'company', id: c.company_id })),
    ...facts.relationships.map((r) => ({ rel: r.kind, type: 'guest_profile', id: r.other })),
    ...stays.map((s) => ({
      rel: 'stay',
      type: 'stay',
      id: s.stay_id,
      title: `${s.arrival} → ${s.departure}`,
    })),
    ...[...new Set(stays.map((s) => s.booking_id).filter((b): b is string => !!b))].map((b) => ({
      rel: 'booking',
      type: 'booking',
      id: b,
    })),
    ...activeMerges.map((m) => ({ rel: 'merge', type: 'guest_merge', id: m.id })),
    ...mergedFrom.map((m) => ({ rel: 'mergedFrom', type: 'guest_profile', id: m.id })),
    ...(row.merged_into ? [{ rel: 'mergedInto', type: 'guest_profile', id: row.merged_into }] : []),
  ];
  return { allowedActions, issues, links };
}

export async function companyRecord(
  tx: TxContext,
  c: {
    id: string;
    kind: 'company' | 'agency';
    status: 'active' | 'on_hold' | 'inactive';
    parent_company_id: string | null;
    ar_account_ref: string | null;
    billing_email: string | null;
    commission: unknown;
    provenance: string;
    home_property_id: string | null;
    contacts: Array<{ profileId: string; role: string }>;
  },
): Promise<{ allowedActions: RecordAction[]; issues: RecordIssue[]; links: RecordLink[] }> {
  const manage = tx.authz.can(
    'guests.company.manage',
    c.home_property_id ? { propertyId: c.home_property_id } : undefined,
  );
  const mirrored = c.provenance === 'external';
  const why = mirrored
    ? 'This company is mastered in the external system of record; change it there.'
    : 'You do not have the permission guests.company.manage.';
  const subs = await db(tx)
    .selectFrom('guests.companies')
    .select(['id', 'legal_name'])
    .where('parent_company_id', '=', c.id)
    .execute();
  const allowedActions: RecordAction[] = [
    action('edit', 'Edit company', manage && !mirrored, why),
    action('addContact', 'Add contact', manage, why),
    action(
      'putOnHold',
      'Put on hold',
      manage && !mirrored && c.status === 'active',
      c.status !== 'active' ? `The company is ${c.status.replace('_', ' ')}.` : why,
    ),
    action(
      'activate',
      'Reactivate',
      manage && !mirrored && c.status !== 'active',
      c.status === 'active' ? 'The company is already active.' : why,
    ),
    action(
      'deactivate',
      'Deactivate',
      manage && !mirrored && c.status !== 'inactive',
      c.status === 'inactive' ? 'The company is already inactive.' : why,
    ),
  ];
  const issues: RecordIssue[] = [];
  if (c.status === 'on_hold') {
    issues.push({
      code: 'company_on_hold',
      severity: 'warning',
      message: 'On hold: confirm payment arrangements before accepting new bookings on account.',
    });
  }
  if (!c.billing_email && !c.contacts.some((x) => x.role === 'billing')) {
    issues.push({
      code: 'no_billing_contact',
      severity: 'info',
      message: 'No billing contact or billing email recorded.',
    });
  }
  if (c.kind === 'agency' && (c.commission as { model?: string } | null)?.model === 'none') {
    issues.push({
      code: 'no_commission_terms',
      severity: 'info',
      message: 'No commission arrangement recorded for this travel agent.',
    });
  }
  const links: RecordLink[] = [
    ...(c.parent_company_id ? [{ rel: 'parent', type: 'company', id: c.parent_company_id }] : []),
    ...subs.map((s) => ({ rel: 'subsidiary', type: 'company', id: s.id, title: s.legal_name })),
    ...c.contacts.map((x) => ({ rel: `contact:${x.role}`, type: 'guest_profile', id: x.profileId })),
    ...(c.ar_account_ref ? [{ rel: 'receivables', type: 'ar_account', id: c.ar_account_ref }] : []),
  ];
  return { allowedActions, issues, links };
}
