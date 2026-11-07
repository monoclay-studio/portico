/**
 * Stay history projection (GUE-R14) and recognition summary (GUE-R15). Fed by reservations through
 * recordStayHistory; revenue is a placeholder until finance feeds postings (marked `incomplete`).
 */
import { sql, type TxContext } from '@portico/db';
import { diffDays, type Money, newId, ValidationError } from '@portico/kernel';
import type { z } from 'zod';
import type { recognitionSummary, stayHistoryView } from '../contracts';
import { stayVisible } from '../domain/visibility';
import type { GuestsPorts } from '../ports';
import { extendDocumentRetention } from './documents';
import { db, linkProperty, requireVisibleProfile, resolveSurvivor } from './internal';
import { getProfile } from './profiles';

export type StayHistoryView = z.infer<typeof stayHistoryView>;
export type RecognitionSummary = z.infer<typeof recognitionSummary>;

export interface StayHistoryInput {
  profileId: string;
  stayRef: { type: string; id: string };
  propertyId: string;
  bookingId?: string | null;
  role?: 'occupant' | 'booker' | 'payer';
  arrival: string;
  departure: string;
  status: string;
  unitTypeId?: string | null;
  ratePlanId?: string | null;
  companyId?: string | null;
  revenue?: Money | null;
  revenueProvenance?: 'live' | 'incomplete' | 'copied' | 'external';
}

/**
 * Provider (domain map): upsert one stay into a profile's history (idempotent per profile + stay + role). A merged
 * profile id resolves to its survivor; the original id is kept so an unmerge can suggest the right owner.
 * Trusted provider call — reservations authorizes its own command.
 */
export async function recordStayHistory(
  tx: TxContext,
  ports: GuestsPorts,
  input: StayHistoryInput,
): Promise<void> {
  if (input.stayRef.type !== 'stay') {
    throw new ValidationError('invalid_stay_ref', 'stayRef must reference a stay ({ type: "stay", id }).');
  }
  if (input.departure <= input.arrival) {
    throw new ValidationError('invalid_date_range', 'Departure must be after arrival.');
  }
  if (input.revenue && !Number.isSafeInteger(input.revenue.amountMinor)) {
    throw new ValidationError('invalid_money', 'Revenue must be an integer amount in minor units.');
  }
  const { row } = await resolveSurvivor(tx, input.profileId);
  const role = input.role ?? 'occupant';
  await db(tx)
    .insertInto('guests.stay_history')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      profile_id: row.id,
      stay_id: input.stayRef.id,
      booking_id: input.bookingId ?? null,
      property_id: input.propertyId,
      role,
      arrival: input.arrival,
      departure: input.departure,
      status: input.status,
      unit_type_id: input.unitTypeId ?? null,
      rate_plan_id: input.ratePlanId ?? null,
      company_id: input.companyId ?? null,
      revenue_minor: input.revenue?.amountMinor ?? null,
      revenue_currency: input.revenue?.currency ?? null,
      revenue_provenance: input.revenueProvenance ?? 'incomplete',
      requested_profile_id: input.profileId !== row.id ? input.profileId : null,
    })
    .onConflict((oc) =>
      oc.columns(['profile_id', 'stay_id', 'role']).doUpdateSet({
        arrival: input.arrival,
        departure: input.departure,
        status: input.status,
        property_id: input.propertyId,
        booking_id: input.bookingId ?? null,
        unit_type_id: input.unitTypeId ?? null,
        rate_plan_id: input.ratePlanId ?? null,
        company_id: input.companyId ?? null,
        ...(input.revenue
          ? {
              revenue_minor: input.revenue.amountMinor,
              revenue_currency: input.revenue.currency,
              revenue_provenance: input.revenueProvenance ?? 'incomplete',
            }
          : {}),
        version: sql`guests.stay_history.version + 1`,
      }),
    )
    .execute();
  await linkProperty(tx, row.id, input.propertyId, 'stay');
  await extendDocumentRetention(tx, ports, row.id, input.propertyId, input.departure);
}

export async function getStayHistory(
  tx: TxContext,
  ports: GuestsPorts,
  profileId: string,
  opts: { propertyId?: string | null } = {},
): Promise<StayHistoryView> {
  const vp = await requireVisibleProfile(tx, ports, profileId, opts);
  const rows = await db(tx)
    .selectFrom('guests.stay_history')
    .selectAll()
    .where('profile_id', '=', vp.row.id)
    .orderBy('arrival', 'desc')
    .execute();
  const visible = rows.filter((r) => stayVisible(vp.access, vp.view, r.property_id, vp.consent));
  const spend = new Map<string, number>();
  let nights = 0;
  let stays = 0;
  const counted = new Set<string>();
  const revenueCounted = new Set<string>();
  for (const r of visible) {
    // One stay can appear under several roles (occupant + payer): count its revenue once.
    if (r.revenue_minor !== null && r.revenue_currency && !revenueCounted.has(r.stay_id)) {
      revenueCounted.add(r.stay_id);
      spend.set(r.revenue_currency, (spend.get(r.revenue_currency) ?? 0) + r.revenue_minor);
    }
    if (['cancelled', 'no_show'].includes(r.status) || counted.has(r.stay_id)) continue;
    counted.add(r.stay_id);
    stays++;
    nights += diffDays(r.arrival, r.departure);
  }
  const last = visible.find((r) => !['cancelled', 'no_show'].includes(r.status));
  let communications: StayHistoryView['communications'] = { status: 'not_connected', items: [] };
  if (ports.communications) {
    communications = { status: 'connected', items: await ports.communications.listForProfile(tx, vp.row.id) };
  }
  return {
    items: visible.map((r) => ({
      stayId: r.stay_id,
      bookingId: r.booking_id,
      propertyId: r.property_id,
      role: r.role,
      arrival: r.arrival,
      departure: r.departure,
      nights: diffDays(r.arrival, r.departure),
      status: r.status,
      unitTypeId: r.unit_type_id,
      ratePlanId: r.rate_plan_id,
      companyId: r.company_id,
      revenue:
        r.revenue_minor !== null && r.revenue_currency
          ? { amountMinor: r.revenue_minor, currency: r.revenue_currency }
          : null,
      revenueProvenance: r.revenue_provenance,
    })),
    summary: {
      stays,
      nights,
      lastStay: last
        ? { propertyId: last.property_id, arrival: last.arrival, departure: last.departure }
        : null,
      spend: [...spend.entries()].sort().map(([currency, amountMinor]) => ({ currency, amountMinor })),
      spendProvenance: 'incomplete',
    },
    communications,
  };
}

/** Arrival-screen recognition (GUE-R15): returning guest, VIP, critical alerts, key preferences. */
export async function getRecognitionSummary(
  tx: TxContext,
  ports: GuestsPorts,
  input: { profileId: string; propertyId: string },
): Promise<RecognitionSummary> {
  const profile = await getProfile(tx, ports, input.profileId, { propertyId: input.propertyId });
  const history = await getStayHistory(tx, ports, profile.id, { propertyId: input.propertyId });
  const done = history.items.filter((i) => ['departed', 'checked_out', 'completed'].includes(i.status));
  const atProperty = done.filter((i) => i.propertyId === input.propertyId);
  return {
    profileId: profile.id,
    displayName: profile.displayName,
    nativeName: [profile.nativeGivenName, profile.nativeFamilyName].filter(Boolean).join(' ') || null,
    vipLevel: profile.vipLevel,
    returningGuest: done.length > 0,
    staysAtProperty: new Set(atProperty.map((i) => i.stayId)).size,
    staysInOrganization: new Set(done.map((i) => i.stayId)).size,
    lastStay: done[0]
      ? { propertyId: done[0].propertyId, arrival: done[0].arrival, departure: done[0].departure }
      : null,
    criticalAlerts: profile.alerts
      .filter((a) => a.activeNow && a.severity !== 'info')
      .map((a) => ({ id: a.id, text: a.text, severity: a.severity })),
    keyPreferences: profile.preferences.slice(0, 8).map((p) => ({ category: p.category, value: p.value })),
    importantDates: profile.importantDates,
    language: profile.language,
  };
}
