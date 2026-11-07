import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  canonicalJson,
  DomainError,
  type EntityRef,
  money,
  newId,
  requirePermission,
  sha256Hex,
  sum,
} from '@portico/kernel';
import {
  type CanonicalChannelBooking,
  canonicalChannelBooking,
  type IngestResult,
  type NewBookingInput,
  type StayInput,
} from '../contracts';
import { compareRevision, detectFieldLosses, diffChannelBookings, type FieldLoss } from '../domain/channel';
import { RESERVATIONS_EVENTS as E } from '../events';
import { RESERVATIONS_PERMISSIONS as P } from '../manifest';
import type { TermsSnapshot } from '../ports';
import { createBookingInternal, insertStayWithInventory, type PricedStay, priceStay } from './bookings';
import { applyChangeDirect } from './changes';
import { type Deps, db, json, propertyInfo } from './context';
import { resolveGuest } from './guests';
import { openRelocationCase, raiseIssue } from './issues';
import {
  bumpBooking,
  insertSnapshot,
  loadBooking,
  loadStay,
  replaceSegments,
  type StayRecord,
  updateStay,
} from './repo';

type Room = CanonicalChannelBooking['rooms'][number];

function stayInputFromRoom(room: Room): StayInput {
  return {
    unitTypeId: room.unitTypeId,
    ratePlanId: room.ratePlanId,
    arrival: room.arrival,
    departure: room.departure,
    occupancy: { adults: room.adults, childrenAges: room.childrenAges },
    commercialType: 'standard',
    occupants: [...room.guests.map((g, i) => ({ profile: g, kind: 'adult' as const, primary: i === 0 }))],
    requests: room.specialRequests,
  };
}

/** Channel price tolerance before a rate discrepancy is flagged (minor units per stay). */
const PRICE_TOLERANCE_MINOR = 100;

/**
 * Agreed terms for a channel room: the channel's prices are the agreed prices (RES-R33, priceSource 'channel').
 * Policies come from the mapped rate plan's quote when available; otherwise a minimal snapshot is built and the
 * missing mapping is raised as an issue (the channel already confirmed the booking to the guest).
 */
async function pricedFromChannel(
  deps: Deps,
  tx: TxContext,
  input: { propertyId: string; currency: string; room: Room; businessDate: string; bookingRef: string },
): Promise<{
  priced: PricedStay;
  discrepancy: { quoted: number; channel: number } | null;
  mappingProblem: string | null;
}> {
  const stay = stayInputFromRoom(input.room);
  const channelNights = input.room.nightlyPrices.map((n) => ({
    date: n.date,
    amount: money(n.amountMinor, input.currency),
  }));
  let base: TermsSnapshot | null = null;
  let mappingProblem: string | null = null;
  try {
    base = (
      await priceStay(deps, tx, {
        propertyId: input.propertyId,
        stay,
        bookingDate: input.businessDate,
        allowRestrictionViolations: true,
      })
    ).terms;
  } catch (err) {
    if (!(err instanceof DomainError) || err.status >= 500) throw err;
    mappingProblem = err.message;
  }
  const quotedNet = base
    ? sum(
        input.currency,
        base.nights.map((n) => n.net),
      ).amountMinor
    : null;
  const channelNet = sum(
    input.currency,
    channelNights.map((n) => n.amount),
  ).amountMinor;
  const nights = channelNights.map((n) => {
    const quoted = base?.nights.find((q) => q.date === n.date);
    return {
      date: n.date,
      net: n.amount,
      taxes: quoted && quoted.net.amountMinor === n.amount.amountMinor ? quoted.taxes : [],
    };
  });
  const net = sum(
    input.currency,
    nights.map((n) => n.net),
  );
  const taxes = sum(
    input.currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    input.currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  const terms: TermsSnapshot = {
    ...(base ?? {
      schemaVersion: 1,
      propertyId: input.propertyId,
      ratePlanId: input.room.ratePlanId,
      unitTypeId: input.room.unitTypeId,
      inclusions: [],
      policies: {
        cancellation: { tiers: [], noShow: { kind: 'none' }, text: 'Channel terms (not mapped in Portico)' },
        guarantee: { required: ['prepaid_channel'] },
        deposit: { items: [] },
      },
      quotedAt: new Date(0).toISOString(),
    }),
    occupancy: { adults: input.room.adults, childrenAges: input.room.childrenAges },
    currency: input.currency,
    priceSource: 'channel',
    nights,
    totals: { net, taxes, fees, gross: sum(input.currency, [net, taxes, fees]) },
    channel: { bookingRef: input.bookingRef, roomRef: input.room.roomRef },
  };
  const offer = {
    unitTypeId: stay.unitTypeId,
    ratePlanId: stay.ratePlanId,
    nightly: channelNights,
    inclusions: terms.inclusions,
    taxesAndFees: [],
    totals: terms.totals,
    policies: terms.policies,
    restrictionViolations: [],
    terms,
  };
  return {
    priced: { input: stay, offer, terms },
    discrepancy:
      quotedNet !== null && Math.abs(quotedNet - channelNet) > PRICE_TOLERANCE_MINOR
        ? { quoted: quotedNet, channel: channelNet }
        : null,
    mappingProblem,
  };
}

const roomKey = (roomRef: string) => `room:${roomRef}`;

async function recordRevision(
  tx: TxContext,
  input: {
    connectionId: string;
    externalId: string;
    revision: number;
    payloadHash: string;
    payload: CanonicalChannelBooking;
    outcome: Exclude<IngestResult['outcome'], 'duplicate'>;
    applied: boolean;
    bookingId: string | null;
    diff?: unknown;
    fieldLosses?: FieldLoss[];
    note?: string;
  },
): Promise<void> {
  await db(tx)
    .insertInto('reservations.channel_revisions')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      external_id: input.externalId,
      revision: input.revision,
      payload_hash: input.payloadHash,
      payload: json(input.payload),
      outcome: input.outcome,
      applied: input.applied,
      booking_id: input.bookingId,
      diff: input.diff === undefined ? null : json(input.diff),
      field_losses: input.fieldLosses ? json(input.fieldLosses) : null,
      note: input.note ?? null,
      received_at: tx.now,
    })
    .execute();
}

async function flagIssues(
  tx: TxContext,
  input: {
    propertyId: string;
    bookingId: string;
    code: string;
    externalId: string;
    revision: number;
    discrepancies: Array<{ roomRef: string; quoted: number; channel: number }>;
    mappingProblems: Array<{ roomRef: string; problem: string }>;
    fieldLosses: FieldLoss[];
  },
): Promise<void> {
  for (const d of input.discrepancies) {
    await raiseIssue(tx, {
      propertyId: input.propertyId,
      kind: 'channel_rate_discrepancy',
      severity: 'routine',
      bookingId: input.bookingId,
      dedupeKey: `rate_discrepancy:${input.bookingId}:${d.roomRef}:${input.revision}`,
      message: `Channel price for booking ${input.code} room ${d.roomRef} differs from Portico's quote (${d.channel} vs ${d.quoted} minor units). The channel's price is the agreed price.`,
      details: d,
    });
  }
  for (const m of input.mappingProblems) {
    await raiseIssue(tx, {
      propertyId: input.propertyId,
      kind: 'channel_mapping_problem',
      severity: 'urgent',
      bookingId: input.bookingId,
      dedupeKey: `channel_mapping:${input.bookingId}:${m.roomRef}`,
      message: `Booking ${input.code} room ${m.roomRef} could not be priced from Portico's rate plans (${m.problem}). Cancellation and deposit terms must be checked against the channel.`,
      details: m,
    });
  }
  if (input.fieldLosses.length) {
    await raiseIssue(tx, {
      propertyId: input.propertyId,
      kind: 'channel_field_loss',
      severity: 'urgent',
      bookingId: input.bookingId,
      dedupeKey: `field_loss:${input.bookingId}:${input.revision}`,
      message: `Channel revision ${input.revision} of booking ${input.code} dropped information the guest gave earlier (${input.fieldLosses.length} item(s)). Review before acting on it.`,
      details: { fieldLosses: input.fieldLosses, externalId: input.externalId },
    });
    await tx.emit({
      type: E.channelFieldLoss,
      propertyId: input.propertyId,
      aggregate: { type: 'booking', id: input.bookingId },
      payload: { bookingId: input.bookingId, revision: input.revision, count: input.fieldLosses.length },
    });
  }
}

/**
 * Replace a stay's commercial content from a channel modification (full replacement, RES-R30). The stay keeps its
 * id; inventory moves atomically and records a conflict instead of throwing when short (RES-R32).
 */
async function replaceStayFromChannel(
  deps: Deps,
  tx: TxContext,
  stay: StayRecord,
  priced: PricedStay,
  propertyId: string,
): Promise<string[]> {
  const { inventory } = deps.ports;
  const ref: EntityRef = { type: 'stay', id: stay.row.id };
  const s = priced.input;
  await inventory.release(tx, { ref });
  const result = await inventory.consume(tx, {
    propertyId,
    unitTypeId: s.unitTypeId,
    nights: { from: s.arrival, to: s.departure },
    quantity: 1,
    ref,
    onShortfall: 'record_conflict',
  });
  const conflictIds = result && typeof result === 'object' ? (result.conflictIds ?? []) : [];
  const oldUnit = stay.segments.find((g) => g.unitId)?.unitId ?? null;
  let keepUnit: string | null = null;
  if (oldUnit) {
    await inventory.unassignUnit(tx, { ref });
    if (stay.segments.every((g) => g.unitTypeId === s.unitTypeId)) {
      const candidates = await inventory.findAssignableUnits(tx, {
        propertyId,
        unitTypeId: s.unitTypeId,
        nights: { from: s.arrival, to: s.departure },
      });
      if (candidates.find((u) => u.unitId === oldUnit)?.assignable) {
        await inventory.assignUnit(tx, {
          unitId: oldUnit,
          ref,
          nights: { from: s.arrival, to: s.departure },
        });
        keepUnit = oldUnit;
      }
    }
  }
  const snapshotId = await insertSnapshot(tx, {
    stayId: stay.row.id,
    document: priced.terms,
    acceptedVia: 'channel',
    supersedesId: stay.segments[0]?.termsSnapshotId ?? null,
  });
  await replaceSegments(tx, stay.row.id, [
    {
      from: s.arrival,
      to: s.departure,
      unitTypeId: s.unitTypeId,
      ratePlanId: s.ratePlanId,
      occupancy: s.occupancy,
      termsSnapshotId: snapshotId,
      unitId: keepUnit,
    },
  ]);
  await db(tx).deleteFrom('reservations.occupants').where('stay_id', '=', stay.row.id).execute();
  for (const [i, o] of s.occupants.entries()) {
    const profileId = o.profile
      ? await resolveGuest(deps, tx, propertyId, o.profile, { kind: 'channel' }, 'exact_only')
      : null;
    await db(tx)
      .insertInto('reservations.occupants')
      .values({
        id: newId(tx.now.getTime()),
        tenant_id: tx.tenantId,
        stay_id: stay.row.id,
        position: i,
        profile_id: profileId,
        name: o.profile ? [o.profile.firstName, o.profile.lastName].filter(Boolean).join(' ') : null,
        kind: o.kind,
        age_at_arrival: null,
        is_primary: i === 0,
      })
      .execute();
  }
  await updateStay(tx, stay.row.id, {
    arrival: s.arrival,
    departure: s.departure,
    requests: json(s.requests.map((text) => ({ text, status: 'open' }))),
  });
  if (oldUnit && !keepUnit) {
    await raiseIssue(tx, {
      propertyId,
      kind: 'assignment_lost',
      severity: 'routine',
      bookingId: stay.row.booking_id,
      stayId: stay.row.id,
      dedupeKey: `assignment_lost:${stay.row.id}`,
      message:
        'A channel modification changed this stay so its assigned unit no longer fits; assign a unit again.',
    });
  }
  return conflictIds;
}

/**
 * ingestChannelBooking (domain map provider; RES-R30..R33). Idempotent on (connection, externalId, revision):
 * duplicates return 'duplicate'; older revisions are stored as 'stale' with a note and not applied; modifications
 * are full replacements diffed against the last applied revision; cancellations apply agreed penalties; inventory
 * shortfalls COMMIT the booking (the channel already confirmed it) and open a relocation case → 'conflict'.
 */
export async function ingestChannelBooking(
  deps: Deps,
  tx: TxContext,
  input: { connectionId: string; externalId: string; revision: number; payload: unknown },
): Promise<IngestResult> {
  const payload = canonicalChannelBooking.parse(input.payload);
  requirePermission(tx, P.channelIngest, { propertyId: payload.propertyId });
  const mode = await deps.ports.platform.assertWritable(tx, payload.propertyId, 'reservations');
  if (mode === 'forward') {
    throw new BusinessRuleError(
      'channel_to_external_system',
      'Another system is the system of record for reservations at this property: channel bookings must be delivered to it, and Portico mirrors them from there.',
    );
  }
  // Serialize deliveries of the same channel booking so concurrent duplicates see each other.
  await sql`select pg_advisory_xact_lock(hashtext(${`${input.connectionId}|${input.externalId}`}))`.execute(
    tx.db,
  );
  const payloadHash = sha256Hex(canonicalJson(payload));
  const same = await db(tx)
    .selectFrom('reservations.channel_revisions')
    .select(['booking_id', 'payload_hash', 'outcome'])
    .where('connection_id', '=', input.connectionId)
    .where('external_id', '=', input.externalId)
    .where('revision', '=', input.revision)
    .executeTakeFirst();
  if (same) {
    return {
      outcome: 'duplicate',
      ...(same.booking_id ? { bookingId: same.booking_id } : {}),
      note:
        same.payload_hash === payloadHash
          ? `Revision ${input.revision} was already received (${same.outcome}); nothing changed.`
          : `Revision ${input.revision} was already received with different content; the first delivery stands. Ask the channel to send a new revision.`,
    };
  }
  const lastApplied = await db(tx)
    .selectFrom('reservations.channel_revisions')
    .select(['revision', 'payload', 'booking_id'])
    .where('connection_id', '=', input.connectionId)
    .where('external_id', '=', input.externalId)
    .where('applied', '=', true)
    .orderBy('revision', 'desc')
    .executeTakeFirst();
  const order = compareRevision(input.revision, lastApplied ? Number(lastApplied.revision) : null);
  if (order === 'older') {
    const note = `Revision ${input.revision} arrived after revision ${lastApplied?.revision} was applied; it is older, so it was recorded and not applied.`;
    await recordRevision(tx, {
      ...input,
      payloadHash,
      payload,
      outcome: 'stale',
      applied: false,
      bookingId: lastApplied?.booking_id ?? null,
      note,
    });
    return {
      outcome: 'stale',
      ...(lastApplied?.booking_id ? { bookingId: lastApplied.booking_id } : {}),
      note,
    };
  }
  const existing = await db(tx)
    .selectFrom('reservations.bookings')
    .select(['id'])
    .where('channel_connection_id', '=', input.connectionId)
    .where('channel_external_id', '=', input.externalId)
    .executeTakeFirst();
  const property = await propertyInfo(deps, tx, payload.propertyId);

  if (!existing) {
    if (payload.status === 'cancelled') {
      const note =
        'A cancellation arrived for a booking Portico never received; nothing to cancel. Check the channel extranet.';
      await recordRevision(tx, {
        ...input,
        payloadHash,
        payload,
        outcome: 'stale',
        applied: false,
        bookingId: null,
        note,
      });
      return { outcome: 'stale', note };
    }
    const priced: PricedStay[] = [];
    const discrepancies: Array<{ roomRef: string; quoted: number; channel: number }> = [];
    const mappingProblems: Array<{ roomRef: string; problem: string }> = [];
    for (const room of payload.rooms) {
      const p = await pricedFromChannel(deps, tx, {
        propertyId: payload.propertyId,
        currency: payload.currency,
        room,
        businessDate: property.businessDate,
        bookingRef: input.externalId,
      });
      priced.push(p.priced);
      if (p.discrepancy) discrepancies.push({ roomRef: room.roomRef, ...p.discrepancy });
      if (p.mappingProblem) mappingProblems.push({ roomRef: room.roomRef, problem: p.mappingProblem });
    }
    const booking: NewBookingInput = {
      propertyId: payload.propertyId,
      intent: 'confirm',
      booker: { kind: 'channel', profile: payload.booker },
      source: 'channel',
      channelConnectionId: input.connectionId,
      externalRefs: { channelBookingId: input.externalId },
      marketSegment: payload.marketSegment,
      ...(payload.commission
        ? { commission: { kind: 'percent' as const, percent: payload.commission.percent } }
        : {}),
      guarantee: {
        kind: payload.guarantee.kind,
        ...(payload.guarantee.paymentMethodId ? { paymentMethodId: payload.guarantee.paymentMethodId } : {}),
      },
      specialRequests: payload.specialRequests,
      tags: [],
      ...(payload.notes ? { notes: payload.notes } : {}),
      stays: priced.map((p) => p.input),
    };
    const { booking: rec, conflicts } = await createBookingInternal(deps, tx, booking, {
      priced,
      channel: { connectionId: input.connectionId, externalId: input.externalId },
      onShortfall: 'record_conflict',
      allowRestrictionViolations: true,
      acceptedVia: 'channel',
    });
    // Remember which stay belongs to which channel room (modifications are matched by room ref).
    const refs: Record<string, string> = { channelBookingId: input.externalId };
    payload.rooms.forEach((room, i) => {
      const stay = rec.stays[i];
      if (stay) refs[roomKey(room.roomRef)] = stay.row.id;
    });
    await db(tx)
      .updateTable('reservations.bookings')
      .set({ external_refs: json(refs) })
      .where('id', '=', rec.row.id)
      .execute();
    for (const c of conflicts) {
      const stay = rec.stays.find((s) => s.row.id === c.stayId) as StayRecord;
      await openRelocationCase(deps, tx, {
        stay,
        cause: 'inventory_conflict',
        nights: { from: stay.row.arrival, to: stay.row.departure },
        causeRef: { conflictIds: c.conflictIds, channel: input.connectionId, externalId: input.externalId },
        ownerId: rec.row.owner_id,
      });
    }
    await flagIssues(tx, {
      propertyId: payload.propertyId,
      bookingId: rec.row.id,
      code: rec.row.code,
      externalId: input.externalId,
      revision: input.revision,
      discrepancies,
      mappingProblems,
      fieldLosses: [],
    });
    const outcome = conflicts.length ? 'conflict' : 'created';
    await recordRevision(tx, {
      ...input,
      payloadHash,
      payload,
      outcome,
      applied: true,
      bookingId: rec.row.id,
    });
    return {
      outcome,
      bookingId: rec.row.id,
      ...(conflicts.length ? { conflictIds: conflicts.flatMap((c) => c.conflictIds) } : {}),
    };
  }

  // Existing booking: cancellation or full-replacement modification.
  const rec = await loadBooking(tx, existing.id, { forUpdate: true });
  const prevPayload = lastApplied ? canonicalChannelBooking.parse(lastApplied.payload) : null;
  if (payload.status === 'cancelled') {
    let note: string | undefined;
    if (['cancelled', 'declined'].includes(rec.row.status)) {
      note = 'The booking was already cancelled.';
    } else {
      await applyChangeDirect(
        deps,
        tx,
        {
          kind: 'cancel_booking',
          bookingId: rec.row.id,
          reason: `Cancelled by channel (revision ${input.revision})`,
        },
        `channel:${input.connectionId}:${input.externalId}:${input.revision}`,
      );
    }
    await recordRevision(tx, {
      ...input,
      payloadHash,
      payload,
      outcome: 'cancelled',
      applied: true,
      bookingId: rec.row.id,
      ...(note ? { note } : {}),
    });
    return { outcome: 'cancelled', bookingId: rec.row.id, ...(note ? { note } : {}) };
  }
  if (['cancelled', 'declined', 'expired'].includes(rec.row.status)) {
    const note = `A modification arrived for booking ${rec.row.code}, which is ${rec.row.status} in Portico. Recorded for review; not applied.`;
    await raiseIssue(tx, {
      propertyId: payload.propertyId,
      kind: 'channel_modification_review',
      severity: 'urgent',
      bookingId: rec.row.id,
      dedupeKey: `channel_mod_review:${rec.row.id}:${input.revision}`,
      message: note,
    });
    await recordRevision(tx, {
      ...input,
      payloadHash,
      payload,
      outcome: 'stale',
      applied: false,
      bookingId: rec.row.id,
      note,
    });
    return { outcome: 'stale', bookingId: rec.row.id, note };
  }
  const fieldLosses = prevPayload ? detectFieldLosses(prevPayload, payload) : [];
  const diff = prevPayload ? diffChannelBookings(prevPayload, payload) : null;
  const refs = { ...((rec.row.external_refs ?? {}) as Record<string, string>) };
  const discrepancies: Array<{ roomRef: string; quoted: number; channel: number }> = [];
  const mappingProblems: Array<{ roomRef: string; problem: string }> = [];
  const conflictIds: string[] = [];
  const seen = new Set<string>();
  for (const room of payload.rooms) {
    const p = await pricedFromChannel(deps, tx, {
      propertyId: payload.propertyId,
      currency: payload.currency,
      room,
      businessDate: property.businessDate,
      bookingRef: input.externalId,
    });
    if (p.discrepancy) discrepancies.push({ roomRef: room.roomRef, ...p.discrepancy });
    if (p.mappingProblem) mappingProblems.push({ roomRef: room.roomRef, problem: p.mappingProblem });
    const stayId = refs[roomKey(room.roomRef)];
    const stay = stayId ? rec.stays.find((s) => s.row.id === stayId) : undefined;
    if (stay) {
      seen.add(stay.row.id);
      if (stay.row.status !== 'expected') {
        await raiseIssue(tx, {
          propertyId: payload.propertyId,
          kind: 'channel_modification_review',
          severity: 'urgent',
          bookingId: rec.row.id,
          stayId: stay.row.id,
          dedupeKey: `channel_mod_review:${stay.row.id}:${input.revision}`,
          message: `The channel modified room ${room.roomRef} of booking ${rec.row.code}, but the guest is already ${stay.row.status.replace('_', ' ')}. Review and apply manually.`,
        });
        continue;
      }
      const ids = await replaceStayFromChannel(
        deps,
        tx,
        await loadStay(tx, stay.row.id),
        p.priced,
        payload.propertyId,
      );
      conflictIds.push(...ids);
      if (ids.length) {
        await openRelocationCase(deps, tx, {
          stay: await loadStay(tx, stay.row.id),
          cause: 'inventory_conflict',
          nights: { from: room.arrival, to: room.departure },
          causeRef: { conflictIds: ids, externalId: input.externalId, revision: input.revision },
          ownerId: rec.row.owner_id,
        });
      }
    } else {
      const inserted = await insertStayWithInventory(deps, tx, {
        bookingId: rec.row.id,
        propertyId: payload.propertyId,
        bookingStatus: 'confirmed',
        priced: p.priced,
        waitlisted: false,
        defaultWaitlistExpiry: room.arrival,
        exactProfileMatch: true,
        holdExpiresAt: null,
        acceptedVia: 'channel',
        previewToken: null,
        overbooking: null,
        onShortfall: 'record_conflict',
      });
      refs[roomKey(room.roomRef)] = inserted.stayId;
      conflictIds.push(...inserted.conflictIds);
      if (inserted.conflictIds.length) {
        await openRelocationCase(deps, tx, {
          stay: await loadStay(tx, inserted.stayId),
          cause: 'inventory_conflict',
          nights: { from: room.arrival, to: room.departure },
          causeRef: {
            conflictIds: inserted.conflictIds,
            externalId: input.externalId,
            revision: input.revision,
          },
          ownerId: rec.row.owner_id,
        });
      }
    }
  }
  await db(tx)
    .updateTable('reservations.bookings')
    .set({
      external_refs: json(refs),
      special_requests: json(payload.specialRequests),
      notes: payload.notes ?? null,
      market_segment: payload.marketSegment,
      guarantee: json({
        kind: payload.guarantee.kind,
        ...(payload.guarantee.paymentMethodId ? { paymentMethodId: payload.guarantee.paymentMethodId } : {}),
      }),
    })
    .where('id', '=', rec.row.id)
    .execute();
  await bumpBooking(tx, rec.row.id, `channel_revision:${input.revision}`);
  // Rooms that disappeared from the full replacement are cancelled per agreed terms.
  for (const stay of rec.stays) {
    if (seen.has(stay.row.id) || !['expected', 'waitlisted'].includes(stay.row.status)) continue;
    if (!Object.values(refs).includes(stay.row.id)) continue;
    await applyChangeDirect(
      deps,
      tx,
      { kind: 'cancel_stay', stayId: stay.row.id },
      `channel:${input.connectionId}:${input.externalId}:${input.revision}`,
    );
  }
  await flagIssues(tx, {
    propertyId: payload.propertyId,
    bookingId: rec.row.id,
    code: rec.row.code,
    externalId: input.externalId,
    revision: input.revision,
    discrepancies,
    mappingProblems,
    fieldLosses,
  });
  await tx.audit({
    action: 'reservations.channelBooking.modify',
    target: { type: 'booking', id: rec.row.id },
    propertyId: payload.propertyId,
    after: { revision: input.revision, changes: diff?.length ?? 0, fieldLosses: fieldLosses.length },
  });
  await tx.emit({
    type: E.bookingModified,
    propertyId: payload.propertyId,
    aggregate: { type: 'booking', id: rec.row.id },
    payload: {
      bookingId: rec.row.id,
      code: rec.row.code,
      change: 'channel_modification',
      revision: input.revision,
    },
  });
  const outcome = conflictIds.length ? 'conflict' : 'modified';
  await recordRevision(tx, {
    ...input,
    payloadHash,
    payload,
    outcome,
    applied: true,
    bookingId: rec.row.id,
    diff,
    fieldLosses,
  });
  return {
    outcome,
    bookingId: rec.row.id,
    ...(fieldLosses.length ? { fieldLosses } : {}),
    ...(conflictIds.length ? { conflictIds } : {}),
  };
}
