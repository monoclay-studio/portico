import { sql, type TxContext } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  type DateRange,
  dateRange,
  type EntityRef,
  eachNight,
  type LocalDate,
  type Money,
  newId,
  requirePermission,
  ValidationError,
} from '@portico/kernel';
import type {
  Booking,
  BookingListQuery,
  BookingPatch,
  BookingSummary,
  NewBookingInput,
  StayInput,
  StayPatch,
} from '../contracts';
import { confirmationCodeFrom } from '../domain/confirmation-code';
import { splitAt } from '../domain/segments';
import {
  assertBookingTransition,
  assertStayTransition,
  type BookingStatus,
  bookingShouldComplete,
  type StayStatus,
} from '../domain/status';
import { complimentarySnapshot, penaltyAmount, rangeTotals } from '../domain/terms';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { KeyOperationResult, Offer, PayerRef, TermsSnapshot } from '../ports';
import { inventoryShortfall } from '../ports';
import { type ForwardedResult, guardAuthority } from './authority';
import {
  actorKey,
  actorName,
  actorUserId,
  businessDateOf,
  type Deps,
  db,
  json,
  policy,
  propertyInfo,
} from './context';
import { emitReservationEvent } from './event-payload';
import { resolveGuest } from './guests';
import { raiseIssue } from './issues';
import { keyOperation } from './keys';
import { bookingRecord } from './record';
import {
  type BookingRecord,
  bumpBooking,
  insertSnapshot,
  loadBooking,
  loadSnapshots,
  loadStay,
  lockBooking,
  readableBooking,
  recordVersion,
  replaceSegments,
  type StayRecord,
  snapshotOf,
  toBookingView,
  updateStay,
} from './repo';

// ───────────────────────────── pricing ─────────────────────────────

export interface PricedStay {
  input: StayInput;
  offer: Offer;
  terms: TermsSnapshot;
}

/** Price one requested stay through rates (agreed terms) and apply complimentary/house-use treatment. */
export async function priceStay(
  deps: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    stay: StayInput;
    companyId?: string | undefined;
    bookingDate: LocalDate;
    allowRestrictionViolations?: boolean;
  },
): Promise<PricedStay> {
  const s = input.stay;
  const nights = dateRange(s.arrival, s.departure);
  const offers = await deps.ports.rates.quote(tx, {
    propertyId: input.propertyId,
    nights,
    occupancy: s.occupancy,
    unitTypeIds: [s.unitTypeId],
    ratePlanIds: [s.ratePlanId],
    bookingDate: input.bookingDate,
    ...(input.companyId ? { companyId: input.companyId } : {}),
  });
  const offer = offers.find((o) => o.unitTypeId === s.unitTypeId && o.ratePlanId === s.ratePlanId);
  if (!offer) {
    throw new BusinessRuleError(
      'rate_not_available',
      'This rate plan is not sold for this unit type on these dates. Choose another rate plan or unit type from the quote.',
      { unitTypeId: s.unitTypeId, ratePlanId: s.ratePlanId, arrival: s.arrival, departure: s.departure },
    );
  }
  if (offer.restrictionViolations.length && !input.allowRestrictionViolations) {
    throw new BusinessRuleError(
      'restriction_violated',
      `This stay breaks the rate plan's restrictions: ${offer.restrictionViolations.map((v) => v.message).join('; ')}. Adjust the dates or choose another rate plan.`,
      { violations: offer.restrictionViolations },
    );
  }
  let terms = offer.terms;
  if (s.commercialType !== 'standard') {
    terms = complimentarySnapshot(terms, {
      kind: s.commercialType,
      reason: s.commercialReason ?? '',
      approvedBy: actorName(tx),
    });
  }
  return { input: s, offer, terms };
}

export function assertCommercialPermissions(
  tx: TxContext,
  propertyId: string,
  stays: readonly StayInput[],
): void {
  for (const s of stays) {
    if (s.commercialType === 'standard') continue;
    if (!s.commercialReason) {
      throw new ValidationError(
        'commercial_reason_required',
        `A ${s.commercialType.replace('_', '-')} stay needs a reason (it is reported separately and audited).`,
      );
    }
    requirePermission(tx, s.commercialType === 'complimentary' ? P.stayComplimentary : P.stayHouseUse, {
      propertyId,
    });
  }
}

// ───────────────────────────── creation ─────────────────────────────

async function newConfirmationCode(deps: Deps, tx: TxContext): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = confirmationCodeFrom(deps.config.randomBytes);
    const clash = await db(tx)
      .selectFrom('reservations.bookings')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst();
    if (!clash) return code;
  }
  throw new Error('Could not allocate a unique confirmation code');
}

function bookerName(input: NewBookingInput['booker']): string | null {
  if (input.name) return input.name;
  if (input.profile) return [input.profile.firstName, input.profile.lastName].filter(Boolean).join(' ');
  return null;
}

export interface CreateOptions {
  priced?: PricedStay[];
  channel?: { connectionId: string; externalId: string };
  onShortfall?: 'reject' | 'record_conflict';
  allowRestrictionViolations?: boolean;
  previewToken?: string;
  acceptedVia?: 'booking' | 'channel' | 'import';
}

export interface CreateOutcome {
  booking: BookingRecord;
  conflicts: Array<{ stayId: string; conflictIds: string[] }>;
}

/**
 * Create a booking with its stays in ONE transaction: agreed terms, inventory (hold or consumption), unit
 * assignment, folios + billing instructions, events and audit. Callers check permission and authority.
 */
export async function createBookingInternal(
  deps: Deps,
  tx: TxContext,
  input: NewBookingInput,
  opts: CreateOptions = {},
): Promise<CreateOutcome> {
  const property = await propertyInfo(deps, tx, input.propertyId);
  const businessDate = property.businessDate;
  for (const s of input.stays) {
    dateRange(s.arrival, s.departure);
    // Channel and import bookings were already confirmed elsewhere: they are recorded (with an issue raised by the
    // caller) rather than refused.
    if (s.arrival < businessDate && input.source !== 'import' && input.source !== 'channel') {
      throw new BusinessRuleError(
        'arrival_in_past',
        `Arrival ${s.arrival} is before the property's business date (${businessDate}). Choose today or a later date.`,
        { arrival: s.arrival, businessDate },
      );
    }
  }
  if (input.intent === 'tentative' && !input.optionDate) {
    throw new ValidationError(
      'option_date_required',
      'A tentative booking needs an option date (when it must be confirmed).',
    );
  }
  const priced =
    opts.priced ??
    (await Promise.all(
      input.stays.map((stay) =>
        priceStay(deps, tx, {
          propertyId: input.propertyId,
          stay,
          companyId: input.companyId,
          bookingDate: businessDate,
          allowRestrictionViolations: opts.allowRestrictionViolations ?? false,
        }),
      ),
    ));
  const currency = priced[0]?.terms.currency ?? property.baseCurrency;

  let bookerProfileId = input.booker.profileId ?? null;
  if (!bookerProfileId && input.booker.profile) {
    bookerProfileId = await resolveGuest(
      deps,
      tx,
      input.propertyId,
      input.booker.profile,
      input.source === 'channel'
        ? { kind: 'channel', ...(opts.channel ? { ref: opts.channel.connectionId } : {}) }
        : { kind: 'booking' },
      input.source === 'channel' ? 'exact_only' : 'suggest',
    );
  }

  const status: BookingStatus =
    input.intent === 'quote'
      ? 'quoted'
      : input.intent === 'hold'
        ? 'held'
        : input.intent === 'tentative' || input.intent === 'waitlist'
          ? 'tentative'
          : 'confirmed';
  const holdExpiresAt =
    status === 'held'
      ? new Date(
          tx.now.getTime() +
            (await policy(deps, tx, input.propertyId, 'reservations.holdMinutes', deps.config.holdMinutes)) *
              60_000,
        )
      : null;
  const bookingId = newId(tx.now.getTime());
  const code = await newConfirmationCode(deps, tx);
  await db(tx)
    .insertInto('reservations.bookings')
    .values({
      id: bookingId,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      code,
      status,
      booker_kind: input.booker.kind,
      booker_profile_id: bookerProfileId,
      booker_name: bookerName(input.booker),
      company_id: input.companyId ?? input.booker.companyId ?? null,
      agency_id: input.agencyId ?? input.booker.agencyId ?? null,
      source: input.source,
      channel_connection_id: opts.channel?.connectionId ?? input.channelConnectionId ?? null,
      channel_external_id: opts.channel?.externalId ?? null,
      external_refs: json(input.externalRefs ?? {}),
      market_segment: input.marketSegment,
      commission: input.commission ? json(input.commission) : null,
      guarantee: json(input.guarantee ?? { kind: 'none' }),
      deposit_requirement: input.depositRequirement ? json(input.depositRequirement) : null,
      billing: input.billing ? json(input.billing) : null,
      option_date:
        input.intent === 'waitlist'
          ? (input.stays[0]?.waitlist?.expiresAt ?? null)
          : (input.optionDate ?? null),
      hold_expires_at: holdExpiresAt,
      owner_id: input.ownerId ?? actorUserId(tx),
      notes: input.notes ?? null,
      special_requests: json(input.specialRequests ?? []),
      tags: input.tags ?? [],
      currency,
      cancellation: null,
      created_by: actorKey(tx),
      created_by_name: actorName(tx),
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();

  const conflicts: CreateOutcome['conflicts'] = [];
  const acceptedVia = status === 'quoted' || status === 'held' ? 'quote' : (opts.acceptedVia ?? 'booking');
  for (const p of priced) {
    const inserted = await insertStayWithInventory(deps, tx, {
      bookingId,
      propertyId: input.propertyId,
      bookingStatus: status,
      priced: p,
      waitlisted: input.intent === 'waitlist' || p.input.waitlist !== undefined,
      defaultWaitlistExpiry: input.optionDate ?? p.input.arrival,
      exactProfileMatch: input.source === 'channel',
      holdExpiresAt,
      acceptedVia,
      previewToken: opts.previewToken ?? null,
      overbooking: input.overbooking
        ? { authorizedBy: actorKey(tx), reason: input.overbooking.reason }
        : null,
      onShortfall: opts.onShortfall ?? null,
    });
    if (inserted.conflictIds.length)
      conflicts.push({ stayId: inserted.stayId, conflictIds: inserted.conflictIds });
  }

  let rec = await loadBooking(tx, bookingId);
  await recordVersion(tx, rec, 'create');
  if ((status === 'tentative' || status === 'confirmed') && input.intent !== 'waitlist') {
    await applyBillingInstructions(deps, tx, rec, input.billing);
  }
  rec = await loadBooking(tx, bookingId);
  await tx.audit({
    action: 'reservations.booking.create',
    target: { type: 'booking', id: bookingId },
    propertyId: input.propertyId,
    after: {
      code,
      status,
      source: input.source,
      stays: rec.stays.map((s) => s.row.id),
      intent: input.intent,
    },
  });
  const payload = { bookingId, code, status, stayIds: rec.stays.map((s) => s.row.id), source: input.source };
  await emitReservationEvent(tx, {
    type: E.bookingCreated,
    propertyId: input.propertyId,
    aggregate: { type: 'booking', id: bookingId },
    payload,
  });
  if (status === 'confirmed') {
    await emitReservationEvent(tx, {
      type: E.bookingConfirmed,
      propertyId: input.propertyId,
      aggregate: { type: 'booking', id: bookingId },
      payload,
    });
  }
  return { booking: rec, conflicts };
}

/** Insert one stay (row, agreed terms, segment, occupants) and its inventory effect for the booking status. */
export async function insertStayWithInventory(
  deps: Deps,
  tx: TxContext,
  input: {
    bookingId: string;
    propertyId: string;
    bookingStatus: BookingStatus;
    priced: PricedStay;
    waitlisted: boolean;
    defaultWaitlistExpiry: LocalDate;
    exactProfileMatch: boolean;
    holdExpiresAt: Date | null;
    acceptedVia: 'booking' | 'channel' | 'import' | 'quote' | 'change';
    previewToken: string | null;
    overbooking: { authorizedBy: string; reason: string } | null;
    onShortfall: 'reject' | 'record_conflict' | null;
  },
): Promise<{ stayId: string; conflictIds: string[] }> {
  const { inventory } = deps.ports;
  const s = input.priced.input;
  if (s.unitId) {
    const unit = await inventory.getUnit(tx, s.unitId);
    if (unit.unitTypeId !== s.unitTypeId || unit.propertyId !== input.propertyId) {
      throw new BusinessRuleError(
        'unit_type_differs',
        `${unit.name} is not a unit of the booked unit type at this property. Choose a unit of that type, or book its unit type.`,
        { unitId: unit.id },
      );
    }
  }
  const stayStatus: StayStatus = input.waitlisted ? 'waitlisted' : 'expected';
  const stayId = newId(tx.now.getTime());
  const position = await db(tx)
    .selectFrom('reservations.stays')
    .select(sql<number>`coalesce(max(position) + 1, 0)::int`.as('next'))
    .where('booking_id', '=', input.bookingId)
    .executeTakeFirstOrThrow();
  await db(tx)
    .insertInto('reservations.stays')
    .values({
      id: stayId,
      tenant_id: tx.tenantId,
      property_id: input.propertyId,
      booking_id: input.bookingId,
      position: position.next,
      status: stayStatus,
      commercial_type: s.commercialType,
      commercial_reason: s.commercialType === 'standard' ? null : (s.commercialReason ?? null),
      arrival: s.arrival,
      departure: s.departure,
      block_id: s.blockId ?? null,
      hold_id: null,
      eta: s.eta ?? null,
      etd: null,
      arrival_details: json(s.arrivalDetails ?? {}),
      requests: json((s.requests ?? []).map((text) => ({ text, status: 'open' }))),
      notes: null,
      waitlist: input.waitlisted
        ? json(s.waitlist ?? { priority: 5, expiresAt: input.defaultWaitlistExpiry })
        : null,
      early_check_in: null,
      late_check_out: null,
      no_show: null,
      checked_in_at: null,
      checked_out_at: null,
      created_at: tx.now,
      updated_at: tx.now,
    })
    .execute();
  const snapshotId = await insertSnapshot(tx, {
    stayId,
    document: input.priced.terms,
    acceptedVia: input.acceptedVia === 'change' ? 'booking' : input.acceptedVia,
    changePreview: input.previewToken,
  });
  await replaceSegments(tx, stayId, [
    {
      from: s.arrival,
      to: s.departure,
      unitTypeId: s.unitTypeId,
      ratePlanId: s.ratePlanId,
      occupancy: s.occupancy,
      termsSnapshotId: snapshotId,
      unitId: null,
    },
  ]);
  await insertOccupants(deps, tx, input.propertyId, stayId, s, input.exactProfileMatch);

  const ref: EntityRef = { type: 'stay', id: stayId };
  const nights = { from: s.arrival, to: s.departure };
  let conflictIds: string[] = [];
  if (!input.waitlisted && input.bookingStatus === 'held' && input.holdExpiresAt) {
    const { holdId } = await inventory.createHold(tx, {
      propertyId: input.propertyId,
      unitTypeId: s.unitTypeId,
      nights,
      quantity: 1,
      expiresAt: input.holdExpiresAt,
      ref,
    });
    await updateStay(tx, stayId, { hold_id: holdId });
  } else if (
    !input.waitlisted &&
    (input.bookingStatus === 'tentative' || input.bookingStatus === 'confirmed')
  ) {
    if (s.commercialType !== 'standard') {
      // Complimentary / house-use: the house carries what is still due (e.g. Green Tax per person-night) on the
      // stay's default folio (first opened); guests' own incidentals can be routed elsewhere by billing rules.
      await deps.ports.finance.openFolio(tx, {
        propertyId: input.propertyId,
        owner: ref,
        payer: { type: 'house', id: input.propertyId },
        label: s.commercialType === 'complimentary' ? 'House (complimentary stay)' : 'House use',
      });
    }
    const result = await inventory.consume(tx, {
      propertyId: input.propertyId,
      unitTypeId: s.unitTypeId,
      nights,
      quantity: 1,
      ref,
      ...(input.overbooking ? { overbooking: input.overbooking } : {}),
      ...(input.onShortfall ? { onShortfall: input.onShortfall } : {}),
    });
    conflictIds = result && typeof result === 'object' ? (result.conflictIds ?? []) : [];
    if (s.unitId) {
      await inventory.assignUnit(tx, { unitId: s.unitId, ref, nights });
      await db(tx)
        .updateTable('reservations.stay_segments')
        .set({ unit_id: s.unitId })
        .where('stay_id', '=', stayId)
        .execute();
    }
  }
  return { stayId, conflictIds };
}

async function insertOccupants(
  deps: Deps,
  tx: TxContext,
  propertyId: string,
  stayId: string,
  s: StayInput,
  exactOnly: boolean,
): Promise<void> {
  let primarySeen = false;
  for (const [i, o] of (s.occupants ?? []).entries()) {
    let profileId = o.profileId ?? null;
    if (!profileId && o.profile) {
      profileId = await resolveGuest(
        deps,
        tx,
        propertyId,
        o.profile,
        { kind: exactOnly ? 'channel' : 'booking' },
        exactOnly ? 'exact_only' : 'suggest',
      );
    }
    const primary = !primarySeen && (o.primary || (i === 0 && !(s.occupants ?? []).some((x) => x.primary)));
    if (primary) primarySeen = true;
    await db(tx)
      .insertInto('reservations.occupants')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        stay_id: stayId,
        position: i,
        profile_id: profileId,
        name: o.profile ? [o.profile.firstName, o.profile.lastName].filter(Boolean).join(' ') : null,
        kind: o.kind,
        age_at_arrival: o.kind === 'child' ? (o.ageAtArrival ?? null) : null,
        is_primary: primary,
      })
      .execute();
  }
}

/**
 * Billing instructions (brief S04: company pays accommodation, guests pay incidentals). Reservations states WHO
 * pays for WHAT; finance owns folios and routing. Per stay: the incidentals folio (opened first → the stay's
 * default folio) for the primary occupant (or booker), plus — when a different party pays accommodation — an
 * accommodation folio and a billing rule routing room & package charges (and their taxes) to it.
 */
export async function applyBillingInstructions(
  deps: Deps,
  tx: TxContext,
  rec: BookingRecord,
  billing: NewBookingInput['billing'] | null | undefined,
): Promise<void> {
  if (!billing) return;
  const { finance } = deps.ports;
  for (const stay of rec.stays) {
    const owner: EntityRef = { type: 'stay', id: stay.row.id };
    const primary = stay.occupants.find((o) => o.is_primary && o.profile_id);
    const incidentalsPayer: PayerRef | null =
      billing.incidentalsPayer === 'occupants' && primary?.profile_id
        ? { type: 'profile', id: primary.profile_id }
        : rec.row.booker_profile_id
          ? { type: 'profile', id: rec.row.booker_profile_id }
          : null;
    if (!incidentalsPayer) {
      throw new ValidationError(
        'payer_required',
        'Guests pay incidentals, but this stay has no primary occupant or booker profile to bill. Add the guest first.',
        { stayId: stay.row.id },
      );
    }
    await finance.openFolio(tx, {
      propertyId: rec.row.property_id,
      owner,
      payer: incidentalsPayer,
      label: 'Incidentals',
    });
    if (billing.accommodationPayer) {
      const { folioId } = await finance.openFolio(tx, {
        propertyId: rec.row.property_id,
        owner,
        payer: billing.accommodationPayer,
        label: 'Accommodation',
      });
      await finance.setBillingRules(tx, {
        owner,
        rules: [
          {
            destinationFolioId: folioId,
            chargeCodeGroups: ['room', 'package'],
            serviceDates: { from: stay.row.arrival, to: stay.row.departure },
            source: billing.accommodationPayer.type === 'company' ? 'company_default' : 'manual',
          },
        ],
      });
    }
  }
}

/** Public command: create a booking (permission, data authority, then the transaction). */
export async function createBooking(
  deps: Deps,
  tx: TxContext,
  input: NewBookingInput,
  opts: CreateOptions = {},
): Promise<Booking | ForwardedResult> {
  requirePermission(tx, P.bookingCreate, { propertyId: input.propertyId });
  assertCommercialPermissions(tx, input.propertyId, input.stays);
  if (input.overbooking) requirePermission(tx, P.bookingOverbook, { propertyId: input.propertyId });
  if (input.intent === 'waitlist') requirePermission(tx, P.waitlistManage, { propertyId: input.propertyId });
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: input.propertyId,
    kind: 'create_booking',
    payload: input,
  });
  if (forwarded) return forwarded;
  const { booking } = await createBookingInternal(deps, tx, input, opts);
  return bookingRecord(deps, tx, booking);
}

/**
 * Walk-in (RES-R22): tonight's dates prefilled, confirmed immediately with the unit assigned. The desk then runs
 * the check-in workflow (registration, guarantee, keys) — kept separate so a failed step is visible.
 */
export async function createWalkIn(
  deps: Deps,
  tx: TxContext,
  input: Omit<NewBookingInput, 'intent' | 'source' | 'stays'> & {
    stay: Omit<StayInput, 'arrival'> & { arrival?: LocalDate };
  },
): Promise<Booking | ForwardedResult> {
  const businessDate = await businessDateOf(deps, tx, input.propertyId);
  const arrival = input.stay.arrival ?? businessDate;
  if (arrival !== businessDate) {
    throw new ValidationError('walk_in_today', `A walk-in arrives today (${businessDate}).`);
  }
  return createBooking(deps, tx, {
    ...input,
    intent: 'confirm',
    source: 'walk_in',
    stays: [{ ...input.stay, arrival }],
  });
}

// ───────────────────────────── status transitions ─────────────────────────────

async function acceptQuotedTerms(tx: TxContext, stay: StayRecord): Promise<void> {
  const snaps = await db(tx)
    .selectFrom('reservations.terms_snapshots')
    .select(['id', 'document', 'accepted_via'])
    .where(
      'id',
      'in',
      stay.segments.map((s) => s.termsSnapshotId),
    )
    .execute();
  const replaced = new Map<string, string>();
  for (const s of snaps) {
    if (s.accepted_via !== 'quote') continue;
    replaced.set(
      s.id,
      await insertSnapshot(tx, {
        stayId: stay.row.id,
        document: s.document as TermsSnapshot,
        acceptedVia: 'booking',
        supersedesId: s.id,
      }),
    );
  }
  if (replaced.size === 0) return;
  await replaceSegments(
    tx,
    stay.row.id,
    stay.segments.map((g) => ({
      ...g,
      termsSnapshotId: replaced.get(g.termsSnapshotId) ?? g.termsSnapshotId,
    })),
  );
}

/**
 * quoted → held | tentative | confirmed, held → tentative | confirmed, tentative → confirmed, inquiry/quoted →
 * declined. Inventory follows the status in the same transaction (RES-R08).
 */
export async function transitionBooking(
  deps: Deps,
  tx: TxContext,
  input: {
    bookingId: string;
    expectedVersion: number;
    to: 'held' | 'tentative' | 'confirmed' | 'declined';
    optionDate?: LocalDate;
    reason?: string;
  },
): Promise<Booking | ForwardedResult> {
  const row = await lockBooking(tx, input.bookingId, input.expectedVersion);
  requirePermission(tx, input.to === 'declined' ? P.bookingCancel : P.bookingCreate, {
    propertyId: row.property_id,
  });
  const from = row.status as BookingStatus;
  assertBookingTransition(from, input.to);
  if (input.to === 'tentative' && !input.optionDate && !row.option_date) {
    throw new ValidationError('option_date_required', 'A tentative booking needs an option date.');
  }
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: row.property_id,
    kind: `booking_${input.to}`,
    payload: input,
    bookingId: row.id,
  });
  if (forwarded) return forwarded;
  const { inventory } = deps.ports;
  const rec = await loadBooking(tx, row.id);
  const holdMinutes = await policy(
    deps,
    tx,
    row.property_id,
    'reservations.holdMinutes',
    deps.config.holdMinutes,
  );
  const holdExpiresAt = new Date(tx.now.getTime() + holdMinutes * 60_000);
  for (const stay of rec.stays) {
    if (stay.row.status !== 'expected') continue;
    const ref: EntityRef = { type: 'stay', id: stay.row.id };
    const seg = stay.segments[0];
    if (!seg) continue;
    const nights = { from: stay.row.arrival, to: stay.row.departure };
    if (input.to === 'held') {
      const { holdId } = await inventory.createHold(tx, {
        propertyId: row.property_id,
        unitTypeId: seg.unitTypeId,
        nights,
        quantity: 1,
        expiresAt: holdExpiresAt,
        ref,
      });
      await updateStay(tx, stay.row.id, { hold_id: holdId });
    } else if (input.to === 'tentative' || input.to === 'confirmed') {
      if (from === 'held' && stay.row.hold_id) {
        try {
          await inventory.convertHold(tx, { holdId: stay.row.hold_id, ref });
        } catch (err) {
          // An expired hold no longer reserves anything: consume fresh (throws if sold out meanwhile).
          if (!(err instanceof BusinessRuleError) && !inventoryShortfall(err)) throw err;
          for (const s of stay.segments) {
            await inventory.consume(tx, {
              propertyId: row.property_id,
              unitTypeId: s.unitTypeId,
              nights: { from: s.from, to: s.to },
              quantity: 1,
              ref,
            });
          }
        }
        await updateStay(tx, stay.row.id, { hold_id: null });
      } else if (from === 'quoted') {
        for (const s of stay.segments) {
          await inventory.consume(tx, {
            propertyId: row.property_id,
            unitTypeId: s.unitTypeId,
            nights: { from: s.from, to: s.to },
            quantity: 1,
            ref,
          });
        }
      }
      if (input.to === 'confirmed') await acceptQuotedTerms(tx, stay);
    } else if (input.to === 'declined' && stay.row.hold_id) {
      await inventory.release(tx, { ref });
    }
  }
  const updated = await bumpBooking(tx, row.id, `status:${input.to}`, {
    status: input.to,
    hold_expires_at: input.to === 'held' ? holdExpiresAt : null,
    ...(input.optionDate ? { option_date: input.optionDate } : {}),
  });
  if ((input.to === 'tentative' || input.to === 'confirmed') && (from === 'quoted' || from === 'held')) {
    await applyBillingInstructions(deps, tx, updated, rec.row.billing as NewBookingInput['billing']);
  }
  await tx.audit({
    action: `reservations.booking.${input.to}`,
    target: { type: 'booking', id: row.id },
    propertyId: row.property_id,
    reason: input.reason ?? null,
    before: { status: from },
    after: { status: input.to },
  });
  const payload = {
    bookingId: row.id,
    code: row.code,
    from,
    to: input.to,
    stayIds: rec.stays.map((s) => s.row.id),
  };
  await emitReservationEvent(tx, {
    type: E.bookingStatusChanged,
    propertyId: row.property_id,
    aggregate: { type: 'booking', id: row.id },
    payload,
  });
  if (input.to === 'confirmed') {
    await emitReservationEvent(tx, {
      type: E.bookingConfirmed,
      propertyId: row.property_id,
      aggregate: { type: 'booking', id: row.id },
      payload,
    });
  }
  return bookingRecord(deps, tx, updated);
}

/** Expire held bookings whose hold passed, and tentative bookings past their option date when policy says so. */
export async function expireBookings(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string },
): Promise<{ expired: string[]; optionsDue: string[] }> {
  requirePermission(tx, P.bookingUpdate, { propertyId: input.propertyId });
  const businessDate = await businessDateOf(deps, tx, input.propertyId);
  const autoExpire = await policy(deps, tx, input.propertyId, 'reservations.tentative.autoExpire', false);
  const held = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['id'])
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'held')
    .where('hold_expires_at', '<=', tx.now)
    .execute();
  const tentative = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['id', 'code', 'owner_id', 'option_date'])
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'tentative')
    .where('option_date', '<=', businessDate)
    .execute();
  const expired: string[] = [];
  const optionsDue: string[] = [];
  const toExpire = [...held.map((h) => h.id), ...(autoExpire ? tentative.map((t) => t.id) : [])];
  for (const id of toExpire) {
    const rec = await loadBooking(tx, id, { forUpdate: true });
    for (const stay of rec.stays)
      await deps.ports.inventory.release(tx, { ref: { type: 'stay', id: stay.row.id } });
    await bumpBooking(tx, id, 'status:expired', { status: 'expired', hold_expires_at: null });
    await tx.audit({
      action: 'reservations.booking.expire',
      target: { type: 'booking', id },
      propertyId: input.propertyId,
    });
    await emitReservationEvent(tx, {
      type: E.bookingStatusChanged,
      propertyId: input.propertyId,
      aggregate: { type: 'booking', id },
      payload: {
        bookingId: id,
        code: rec.row.code,
        from: rec.row.status,
        to: 'expired',
        stayIds: rec.stays.map((s) => s.row.id),
      },
    });
    expired.push(id);
  }
  if (!autoExpire) {
    for (const t of tentative) {
      await raiseIssue(tx, {
        propertyId: input.propertyId,
        kind: 'option_date_reached',
        severity: 'routine',
        bookingId: t.id,
        dedupeKey: `option:${t.id}:${t.option_date}`,
        message: `Tentative booking ${t.code} reached its option date (${t.option_date}): confirm or release it.`,
        ownerId: t.owner_id,
      });
      optionsDue.push(t.id);
    }
  }
  return { expired, optionsDue };
}

// ───────────────────────────── edits without inventory/price effects ─────────────────────────────

/** Audit history is visible to anyone who can read the booking: never store payment tokens in it. */
function auditSafePatch(values: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = values[k];
    if (k === 'guarantee' && v && typeof v === 'object') {
      const g = v as Record<string, unknown>;
      out[k] = { ...g, ...(g.paymentMethodId ? { paymentMethodId: '[token on file]' } : {}) };
    } else out[k] = v ?? null;
  }
  return out;
}

/** Booking-level fields with no inventory, price or balance effect (no preview needed). If-Match required. */
export async function patchBooking(
  deps: Deps,
  tx: TxContext,
  input: { bookingId: string; expectedVersion: number; patch: BookingPatch },
): Promise<Booking | ForwardedResult> {
  const row = await lockBooking(tx, input.bookingId, input.expectedVersion);
  requirePermission(tx, P.bookingUpdate, { propertyId: row.property_id });
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: row.property_id,
    kind: 'modify_booking',
    payload: input.patch,
    bookingId: row.id,
  });
  if (forwarded) return forwarded;
  const p = input.patch;
  await db(tx)
    .updateTable('reservations.bookings')
    .set({
      ...(p.marketSegment !== undefined ? { market_segment: p.marketSegment } : {}),
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.specialRequests !== undefined ? { special_requests: json(p.specialRequests) } : {}),
      ...(p.tags !== undefined ? { tags: p.tags } : {}),
      ...(p.ownerId !== undefined ? { owner_id: p.ownerId } : {}),
      ...(p.optionDate !== undefined ? { option_date: p.optionDate } : {}),
      ...(p.guarantee !== undefined ? { guarantee: json(p.guarantee) } : {}),
      ...(p.externalRefs !== undefined ? { external_refs: json(p.externalRefs) } : {}),
    })
    .where('id', '=', row.id)
    .execute();
  const updated = await bumpBooking(tx, row.id, 'edit');
  await tx.audit({
    action: 'reservations.booking.update',
    target: { type: 'booking', id: row.id },
    propertyId: row.property_id,
    before: auditSafePatch(
      {
        marketSegment: row.market_segment,
        notes: row.notes,
        specialRequests: row.special_requests,
        tags: row.tags,
        ownerId: row.owner_id,
        optionDate: row.option_date,
        guarantee: row.guarantee,
        externalRefs: row.external_refs,
      },
      Object.keys(p),
    ),
    after: auditSafePatch(p as Record<string, unknown>, Object.keys(p)),
  });
  await emitReservationEvent(tx, {
    type: E.bookingModified,
    propertyId: row.property_id,
    aggregate: { type: 'booking', id: row.id },
    payload: { bookingId: row.id, code: row.code, fields: Object.keys(p) },
  });
  return bookingRecord(deps, tx, updated);
}

/** Stay operational details (ETA, arrival details, requests). If-Match on the booking version. */
export async function patchStay(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; expectedVersion: number; patch: StayPatch },
): Promise<Booking | ForwardedResult> {
  const stay = await loadStay(tx, input.stayId);
  const row = await lockBooking(tx, stay.row.booking_id, input.expectedVersion);
  requirePermission(tx, P.bookingUpdate, { propertyId: row.property_id });
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: row.property_id,
    kind: 'modify_stay',
    payload: input.patch,
    bookingId: row.id,
    stayId: stay.row.id,
  });
  if (forwarded) return forwarded;
  const p = input.patch;
  await updateStay(tx, stay.row.id, {
    ...(p.eta !== undefined ? { eta: p.eta } : {}),
    ...(p.etd !== undefined ? { etd: p.etd } : {}),
    ...(p.arrivalDetails !== undefined ? { arrival_details: json(p.arrivalDetails) } : {}),
    ...(p.requests !== undefined ? { requests: json(p.requests) } : {}),
    ...(p.notes !== undefined ? { notes: p.notes } : {}),
  });
  const updated = await bumpBooking(tx, row.id, 'edit_stay');
  await tx.audit({
    action: 'reservations.stay.update',
    target: { type: 'stay', id: stay.row.id },
    propertyId: row.property_id,
    after: p,
  });
  return bookingRecord(deps, tx, updated);
}

// ───────────────────────────── unit assignment ─────────────────────────────

/**
 * Assign a unit of the stay's own unit type (from a night; default the first changeable night). A different unit
 * type is an upgrade/downgrade with price effects → use a `move` change preview instead.
 */
export async function assignUnit(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; unitId: string; expectedVersion: number },
): Promise<Booking | ForwardedResult> {
  const stay = await loadStay(tx, input.stayId);
  const row = await lockBooking(tx, stay.row.booking_id, input.expectedVersion);
  requirePermission(tx, P.stayMove, { propertyId: row.property_id });
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: row.property_id,
    kind: 'assign_unit',
    payload: { unitId: input.unitId },
    bookingId: row.id,
    stayId: stay.row.id,
  });
  if (forwarded) return forwarded;
  if (!['expected', 'in_house'].includes(stay.row.status)) {
    throw new BusinessRuleError(
      'stay_not_assignable',
      `A ${stay.row.status} stay cannot be assigned a unit.`,
    );
  }
  if (!['tentative', 'confirmed'].includes(row.status)) {
    throw new BusinessRuleError(
      'booking_not_consuming',
      'Units can be assigned once the booking is tentative or confirmed.',
    );
  }
  const unit = await deps.ports.inventory.getUnit(tx, input.unitId);
  const businessDate = await businessDateOf(deps, tx, row.property_id);
  const fromDate =
    stay.row.status === 'in_house' && businessDate > stay.row.arrival ? businessDate : stay.row.arrival;
  const segs = stay.segments.filter((s) => s.to > fromDate);
  if (segs.some((s) => s.unitTypeId !== unit.unitTypeId)) {
    throw new BusinessRuleError(
      'unit_type_differs',
      `${unit.name} is a different unit type from the one sold. Use a room move preview to see the price effect of an upgrade or downgrade.`,
      { unitId: unit.id, unitTypeId: unit.unitTypeId },
    );
  }
  const ref: EntityRef = { type: 'stay', id: stay.row.id };
  const nights = { from: fromDate, to: stay.row.departure };
  if (segs.some((s) => s.unitId)) await deps.ports.inventory.unassignUnit(tx, { ref, nights });
  await deps.ports.inventory.assignUnit(tx, { unitId: unit.id, ref, nights });
  const next = splitAt(stay.segments, fromDate).map((s) =>
    s.from >= fromDate ? { ...s, unitId: unit.id } : s,
  );
  await replaceSegments(tx, stay.row.id, next);
  await updateStay(tx, stay.row.id, {});
  const updated = await bumpBooking(tx, row.id, 'assign_unit');
  await tx.audit({
    action: 'reservations.stay.assignUnit',
    target: { type: 'stay', id: stay.row.id },
    propertyId: row.property_id,
    before: { unitId: segs[0]?.unitId ?? null },
    after: { unitId: unit.id, from: fromDate },
  });
  return bookingRecord(deps, tx, updated);
}

// ───────────────────────────── no-show (Day Close provider) ─────────────────────────────

export interface NoShowResult {
  stayId: string;
  status: 'no_show';
  penalty: Money;
  penaltyPostingIds: string[];
  releasedNights: DateRange | null;
  keys: KeyOperationResult | null;
  replayed: boolean;
}

/**
 * markNoShow(stayId, idempotencyKey) — idempotent by business identity: a stay is marked no-show once; repeated
 * calls (any key) return the recorded outcome and never post the penalty twice (finance key
 * `penalty:no_show:{stayId}` as a second guard).
 */
export async function markNoShow(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; idempotencyKey: string },
): Promise<NoShowResult> {
  const stay0 = await loadStay(tx, input.stayId);
  requirePermission(tx, P.stayNoShow, { propertyId: stay0.row.property_id });
  const row = await lockBooking(tx, stay0.row.booking_id, null);
  const stay = await loadStay(tx, input.stayId);
  if (stay.row.status === 'no_show') {
    const recorded = stay.row.no_show as Omit<NoShowResult, 'replayed'>;
    return { ...recorded, replayed: true };
  }
  assertStayTransition(stay.row.status as StayStatus, 'no_show');
  const businessDate = await businessDateOf(deps, tx, row.property_id);
  if (businessDate < stay.row.arrival) {
    throw new BusinessRuleError(
      'no_show_too_early',
      `The guest is due on ${stay.row.arrival}; a no-show can only be recorded from that business date.`,
    );
  }
  const mode = await deps.ports.platform.assertWritable(tx, row.property_id, 'reservations');
  if (mode === 'forward') {
    throw new BusinessRuleError(
      'no_show_external',
      'Another system is the system of record for reservations here, so no-shows are recorded there.',
    );
  }
  const snapshots = await loadSnapshots(
    tx,
    stay.segments.map((s) => s.termsSnapshotId),
  );
  const first = snapshotOf(snapshots, (stay.segments[0] ?? { termsSnapshotId: '' }).termsSnapshotId);
  const nightlyNet = stay.segments.flatMap((s) =>
    snapshotOf(snapshots, s.termsSnapshotId)
      .nights.filter((n) => n.date >= s.from && n.date < s.to)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((n) => n.net),
  );
  const penalty = penaltyAmount(first.policies.cancellation.noShow, nightlyNet, row.currency);
  let penaltyPostingIds: string[] = [];
  if (penalty.amountMinor > 0 && stay.row.commercial_type === 'standard') {
    const posted = await deps.ports.finance.postCharge(tx, {
      propertyId: row.property_id,
      target: { type: 'stay', id: stay.row.id },
      chargeCode: 'NO_SHOW',
      amount: penalty,
      serviceDate: stay.row.arrival,
      description: `No-show charge per agreed terms (booking ${row.code})`,
      sourceRef: { type: 'stay', id: stay.row.id },
      idempotencyKey: `penalty:no_show:${stay.row.id}`,
      taxMode: 'compute',
    });
    penaltyPostingIds = posted.postingIds;
  }
  const releasePolicy = await policy<'all' | 'keep_first_night'>(
    deps,
    tx,
    row.property_id,
    'reservations.noShow.releaseNights',
    'all',
  );
  const ref: EntityRef = { type: 'stay', id: stay.row.id };
  const releaseFrom = releasePolicy === 'keep_first_night' ? addDays(stay.row.arrival, 1) : stay.row.arrival;
  const releasedNights =
    releaseFrom < stay.row.departure ? { from: releaseFrom, to: stay.row.departure } : null;
  if (releasedNights) {
    await deps.ports.inventory.release(tx, { ref, nights: releasedNights });
    if (stay.segments.some((s) => s.unitId))
      await deps.ports.inventory.unassignUnit(tx, { ref, nights: releasedNights });
  }
  const keys = await keyOperation(deps, tx, {
    propertyId: row.property_id,
    stayId: stay.row.id,
    bookingId: row.id,
    action: 'cancel',
    quietIfUnavailable: true,
    describe: `deactivate any pre-arrival keys for booking ${row.code}`,
    run: (access) =>
      access.cancelKeys(tx, {
        stayId: stay.row.id,
        reason: 'no_show',
        idempotencyKey: `no_show:${stay.row.id}`,
      }),
  });
  const result: Omit<NoShowResult, 'replayed'> = {
    stayId: stay.row.id,
    status: 'no_show',
    penalty,
    penaltyPostingIds,
    releasedNights,
    keys,
  };
  await updateStay(tx, stay.row.id, {
    status: 'no_show',
    no_show: json({ ...result, idempotencyKey: input.idempotencyKey, at: tx.now.toISOString() }),
  });
  const after = await loadBooking(tx, row.id);
  const complete = bookingShouldComplete(
    row.status as BookingStatus,
    after.stays.map((s) => s.row.status as StayStatus),
  );
  await bumpBooking(tx, row.id, 'no_show', complete ? { status: 'completed' } : {});
  await tx.audit({
    action: 'reservations.stay.noShow',
    target: { type: 'stay', id: stay.row.id },
    propertyId: row.property_id,
    before: { status: stay.row.status },
    after: result,
    metadata: { idempotencyKey: input.idempotencyKey },
  });
  await emitReservationEvent(tx, {
    type: E.stayNoShow,
    propertyId: row.property_id,
    aggregate: { type: 'stay', id: stay.row.id },
    payload: { stayId: stay.row.id, bookingId: row.id, penalty, penaltyPostingIds, releasedNights },
  });
  return { ...result, replayed: false };
}

// ───────────────────────────── waitlist ─────────────────────────────

/** Waitlisted → expected (RES-R21): consumes inventory now (throws when still unavailable). */
export async function confirmWaitlistedStay(
  deps: Deps,
  tx: TxContext,
  input: { stayId: string; expectedVersion: number },
): Promise<Booking | ForwardedResult> {
  const stay = await loadStay(tx, input.stayId);
  const row = await lockBooking(tx, stay.row.booking_id, input.expectedVersion);
  requirePermission(tx, P.waitlistManage, { propertyId: row.property_id });
  const forwarded = await guardAuthority(deps, tx, {
    propertyId: row.property_id,
    kind: 'confirm_waitlisted',
    payload: {},
    bookingId: row.id,
    stayId: stay.row.id,
  });
  if (forwarded) return forwarded;
  assertStayTransition(stay.row.status as StayStatus, 'expected');
  if (stay.row.status !== 'waitlisted') {
    throw new BusinessRuleError(
      'not_waitlisted',
      'Only waitlisted stays can be confirmed from the waitlist.',
    );
  }
  for (const s of stay.segments) {
    await deps.ports.inventory.consume(tx, {
      propertyId: row.property_id,
      unitTypeId: s.unitTypeId,
      nights: { from: s.from, to: s.to },
      quantity: 1,
      ref: { type: 'stay', id: stay.row.id },
    });
  }
  await updateStay(tx, stay.row.id, { status: 'expected', waitlist: null });
  await db(tx)
    .updateTable('reservations.issues')
    .set({
      status: 'resolved',
      resolved_at: tx.now,
      resolved_by: actorKey(tx),
      resolution: 'confirmed from waitlist',
    })
    .where('stay_id', '=', stay.row.id)
    .where('kind', '=', 'waitlist_available')
    .where('status', '=', 'open')
    .execute();
  const updated = await bumpBooking(tx, row.id, 'waitlist_confirm');
  await tx.audit({
    action: 'reservations.stay.waitlistConfirm',
    target: { type: 'stay', id: stay.row.id },
    propertyId: row.property_id,
    before: { status: 'waitlisted' },
    after: { status: 'expected' },
  });
  await emitReservationEvent(tx, {
    type: E.bookingModified,
    propertyId: row.property_id,
    aggregate: { type: 'booking', id: row.id },
    payload: { bookingId: row.id, code: row.code, stayId: stay.row.id, change: 'waitlist_confirmed' },
  });
  return bookingRecord(deps, tx, updated);
}

// ───────────────────────────── reads ─────────────────────────────

export async function getBooking(deps: Deps, tx: TxContext, bookingId: string): Promise<Booking> {
  const rec = await readableBooking(tx, bookingId);
  return bookingRecord(deps, tx, rec);
}

export async function getBookingByStay(deps: Deps, tx: TxContext, stayId: string): Promise<Booking> {
  const stay = await loadStay(tx, stayId);
  return getBooking(deps, tx, stay.row.booking_id);
}

/** Cursor-paginated booking list (newest first; cursor = last booking id, UUIDv7 time-ordered). */
export async function listBookings(
  tx: TxContext,
  q: BookingListQuery,
): Promise<{ items: BookingSummary[]; nextCursor: string | null }> {
  requirePermission(tx, P.bookingRead, { propertyId: q.propertyId });
  let query = db(tx)
    .selectFrom('reservations.bookings as b')
    .selectAll('b')
    .select([
      sql<string>`(select min(s.arrival)::text from reservations.stays s where s.booking_id = b.id)`.as(
        'first_arrival',
      ),
      sql<string>`(select max(s.departure)::text from reservations.stays s where s.booking_id = b.id)`.as(
        'last_departure',
      ),
      sql<number>`(select count(*)::int from reservations.stays s where s.booking_id = b.id)`.as(
        'stay_count',
      ),
    ])
    .where('b.property_id', '=', q.propertyId)
    .orderBy('b.id', 'desc')
    .limit(q.limit + 1);
  if (q.status) query = query.where('b.status', '=', q.status);
  if (q.source) query = query.where('b.source', '=', q.source);
  if (q.code) query = query.where('b.code', '=', q.code.toUpperCase());
  if (q.cursor) query = query.where('b.id', '<', q.cursor);
  if (q.arrivalFrom) {
    const from = q.arrivalFrom;
    query = query.where(
      sql<boolean>`exists (select 1 from reservations.stays s where s.booking_id = b.id and s.arrival >= ${from}::date)`,
    );
  }
  if (q.arrivalTo) {
    const to = q.arrivalTo;
    query = query.where(
      sql<boolean>`exists (select 1 from reservations.stays s where s.booking_id = b.id and s.arrival <= ${to}::date)`,
    );
  }
  const rows = await query.execute();
  const page = rows.slice(0, q.limit);
  const items: BookingSummary[] = [];
  for (const r of page) {
    const rec = await loadBooking(tx, r.id);
    const view = await toBookingView(tx, rec);
    const {
      stays: _s,
      pendingForwardedChanges: _f,
      allowedActions: _a,
      issues: _i,
      links: _l,
      ...rest
    } = view;
    items.push({ ...rest, arrival: r.first_arrival, departure: r.last_departure, stayCount: r.stay_count });
  }
  return { items, nextCursor: rows.length > q.limit ? (page[page.length - 1]?.id ?? null) : null };
}

/** Quote for the desk: offers from rates combined with inventory availability (nothing is persisted). */
export async function quote(
  deps: Deps,
  tx: TxContext,
  input: {
    propertyId: string;
    arrival: LocalDate;
    departure: LocalDate;
    occupancy: { adults: number; childrenAges: number[] };
    unitTypeIds?: string[] | undefined;
    ratePlanIds?: string[] | undefined;
    companyId?: string | undefined;
    promoCode?: string | undefined;
  },
) {
  requirePermission(tx, P.bookingCreate, { propertyId: input.propertyId });
  const nights = dateRange(input.arrival, input.departure);
  const businessDate = await businessDateOf(deps, tx, input.propertyId);
  const offers = await deps.ports.rates.quote(tx, {
    propertyId: input.propertyId,
    nights,
    occupancy: input.occupancy,
    bookingDate: businessDate,
    ...(input.unitTypeIds ? { unitTypeIds: input.unitTypeIds } : {}),
    ...(input.ratePlanIds ? { ratePlanIds: input.ratePlanIds } : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.promoCode ? { promoCode: input.promoCode } : {}),
  });
  const typeIds = [...new Set(offers.map((o) => o.unitTypeId))];
  const cells = typeIds.length
    ? await deps.ports.inventory.getAvailability(tx, {
        propertyId: input.propertyId,
        unitTypeIds: typeIds,
        range: nights,
      })
    : [];
  return offers.map((o) => {
    const typeCells = cells.filter((c) => c.unitTypeId === o.unitTypeId);
    const available = Math.min(
      ...eachNight(nights).map((d) => typeCells.find((c) => c.date === d)?.available ?? 0),
    );
    const unavailableNights = eachNight(nights).filter(
      (d) => (typeCells.find((c) => c.date === d)?.available ?? 0) < 1,
    );
    return {
      unitTypeId: o.unitTypeId,
      ratePlanId: o.ratePlanId,
      ...(o.ratePlanName ? { ratePlanName: o.ratePlanName } : {}),
      available: Number.isFinite(available) ? available : 0,
      bookable: unavailableNights.length === 0 && o.restrictionViolations.length === 0,
      unavailableNights,
      nightly: o.nightly,
      totals: rangeTotals(o.terms, nights),
      inclusions: o.inclusions,
      cancellation: o.policies.cancellation.text ?? 'See agreed terms.',
      restrictionViolations: o.restrictionViolations,
    };
  });
}
