/**
 * Inbound booking revisions (DST-R08…R11).
 *
 *  store   — each revision is stored IMMUTABLY, keyed by (connection, channel booking id, revision id); a
 *            redelivery is logged as `duplicate` (and re-acknowledged if its outcome is final), the same id with
 *            different content is a `conflict` (the first stands, an urgent exception is raised).
 *  process — per property, one revision at a time (advisory lock), in revision order within a booking. A
 *            modification or cancellation of a booking Portico does not hold is PARKED (orphan) until the creation
 *            arrives or a recovery pull finds it; > 15 minutes → urgent exception. An unmapped booking is parked
 *            with a provisional inventory hold and an urgent alert (DST-R10/I03). Application calls
 *            `reservations.ingestChannelBooking` in THIS transaction (savepoint): when it commits, the booking change,
 *            the revision outcome and the acknowledgement due date commit together.
 *  ack     — only revisions whose outcome is final and committed are acknowledged (DST-I02, enforced by a CHECK
 *            constraint and by claiming acks in a later transaction); retried until the hub accepts.
 *  recover — a pull of the hub's not-acknowledged revisions (safety net for missed webhooks), and "re-request since
 *            T" reconciliation.
 */
import { type PorticoDatabase, sql, type TxContext, withSavepoint, withTenantTx } from '@portico/db';
import {
  addDays,
  BusinessRuleError,
  DomainError,
  NotFoundError,
  newId,
  type RequestContext,
  VersionConflictError,
} from '@portico/kernel';
import { HubError } from '../adapters/hub';
import type { RevisionView } from '../contracts';
import { type HubFailure, isEscalated, nextAttemptAt, retryDelayMs } from '../domain/delivery';
import {
  decideProcessing,
  type HubRevision,
  type MappingLookup,
  revisionHash,
  revisionOrderOf,
  translateRevision,
  type UnmappedRoom,
} from '../domain/revisions';
import { DISTRIBUTION_EVENTS as E } from '../events';
import { P, RECORD } from '../manifest';
import type { IngestResult } from '../ports';
import type { RevisionState } from '../tables';
import { activeMappings } from './ari-dirty';
import {
  actorKey,
  type ConnectionRow,
  type DistributionDeps,
  db,
  hubContext,
  iso,
  json,
  loadConnection,
  lockPropertyInbound,
  provenanceOfTarget,
  recordExchange,
  requireOnConnection,
  scheduleTenant,
  settingsOf,
} from './common';
import { autoResolve, markCredentialsInvalid, raiseDiscrepancy, raiseException } from './exceptions';

export const PARK_ESCALATION_MS = 15 * 60_000;
const FINAL: readonly RevisionState[] = ['applied', 'duplicate', 'stale', 'rejected'];
const UNSETTLED: readonly RevisionState[] = ['received', 'failed', 'parked'];

// ───────────────────────────── store ─────────────────────────────

export class PropertyMismatchError extends DomainError {
  constructor(expected: string, got: string) {
    super(
      'hub_property_mismatch',
      `The revision belongs to hub property ${got}, but this connection is for ${expected}. It was not stored.`,
      { status: 422, details: { expected, got } },
    );
  }
}

export async function logDelivery(
  tx: TxContext,
  input: {
    connectionId: string;
    revisionRowId?: string | null;
    via: 'webhook' | 'feed' | 'recovery';
    outcome:
      | 'stored'
      | 'duplicate'
      | 'conflict'
      | 'notification'
      | 'unauthenticated'
      | 'property_mismatch'
      | 'unparseable';
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db(tx)
    .insertInto('distribution.inbound_deliveries')
    .values({
      id: newId(tx.now.getTime()),
      tenant_id: tx.tenantId,
      connection_id: input.connectionId,
      revision_row_id: input.revisionRowId ?? null,
      via: input.via,
      outcome: input.outcome,
      detail: input.detail ? json(input.detail) : null,
      received_at: tx.now,
    })
    .execute();
}

/** Durably store one revision (immutably) and queue it for processing. Idempotent on the revision's identity. */
export async function storeRevision(
  tx: TxContext,
  conn: ConnectionRow,
  rev: HubRevision,
  via: 'webhook' | 'feed' | 'recovery',
): Promise<{ outcome: 'stored' | 'duplicate' | 'conflict'; revisionRowId: string }> {
  if (rev.externalPropertyId !== conn.external_property_id) {
    await logDelivery(tx, {
      connectionId: conn.id,
      via,
      outcome: 'property_mismatch',
      detail: { revisionId: rev.revisionId },
    });
    throw new PropertyMismatchError(conn.external_property_id, rev.externalPropertyId);
  }
  const hash = revisionHash(rev);
  const id = newId(tx.now.getTime());
  const inserted = await db(tx)
    .insertInto('distribution.inbound_revisions')
    .values({
      id,
      tenant_id: tx.tenantId,
      connection_id: conn.id,
      property_id: conn.property_id,
      channel_booking_id: rev.bookingId,
      revision_id: rev.revisionId,
      revision_order: revisionOrderOf(rev.revisionId, rev.insertedAt, tx.now),
      channel_status: rev.status,
      payload: json(rev),
      payload_hash: hash,
      received_via: via,
      received_at: tx.now,
    })
    .onConflict((oc) =>
      oc.columns(['tenant_id', 'connection_id', 'channel_booking_id', 'revision_id']).doNothing(),
    )
    .returning(['id', 'revision_order'])
    .executeTakeFirst();
  if (inserted) {
    await db(tx)
      .insertInto('distribution.revision_processing')
      .values({
        revision_row_id: id,
        tenant_id: tx.tenantId,
        connection_id: conn.id,
        property_id: conn.property_id,
        channel_booking_id: rev.bookingId,
        revision_order: inserted.revision_order,
        state: 'received',
        park_reason: null,
        outcome: null,
        booking_id: null,
        note: rev.insertedAt
          ? null
          : 'The hub did not say when it recorded this revision; it is ordered by arrival time.',
        attempts: 0,
        next_attempt_at: tx.now,
        first_failed_at: null,
        last_error: null,
        parked_since: null,
        escalated_at: null,
        hold_ids: json([]),
        ack_state: 'not_due',
        ack_attempts: 0,
        ack_next_at: null,
        ack_first_failed_at: null,
        ack_lease_token: null,
        ack_lease_until: null,
        acked_at: null,
        processed_at: null,
        resolved_by: null,
        updated_at: tx.now,
      })
      .execute();
    await logDelivery(tx, { connectionId: conn.id, revisionRowId: id, via, outcome: 'stored' });
    await db(tx)
      .updateTable('distribution.connections')
      .set({ last_revision_at: tx.now })
      .where('id', '=', conn.id)
      .execute();
    await tx.emit({
      type: E.bookingReceived,
      propertyId: conn.property_id,
      aggregate: { type: RECORD.revision, id },
      aggregateVersion: 1,
      payload: {
        connectionId: conn.id,
        propertyId: conn.property_id,
        revisionRowId: id,
        channelBookingId: rev.bookingId,
        channelStatus: rev.status,
        via,
      },
    });
    await scheduleTenant(tx, tx.now);
    return { outcome: 'stored', revisionRowId: id };
  }
  const existing = await db(tx)
    .selectFrom('distribution.inbound_revisions')
    .select(['id', 'payload_hash'])
    .where('connection_id', '=', conn.id)
    .where('channel_booking_id', '=', rev.bookingId)
    .where('revision_id', '=', rev.revisionId)
    .executeTakeFirstOrThrow();
  if (existing.payload_hash !== hash) {
    await logDelivery(tx, {
      connectionId: conn.id,
      revisionRowId: existing.id,
      via,
      outcome: 'conflict',
      detail: { hash },
    });
    await raiseException(tx, {
      connectionId: conn.id,
      propertyId: conn.property_id,
      code: 'revision_conflict',
      dedupeKey: `revision_conflict:${existing.id}:${hash.slice(0, 16)}`,
      severity: 'urgent',
      problem: `The hub sent revision ${rev.revisionId} of channel booking ${rev.bookingId} again with DIFFERENT content. The first delivery stands.`,
      businessImpact: 'The booking in Portico may not match what the channel shows.',
      responsibleParty: 'vendor',
      nextStep:
        'Compare the booking with the channel extranet and ask the channel (through the hub) to send a new revision.',
      refs: [{ type: RECORD.revision, id: existing.id }],
    });
    return { outcome: 'conflict', revisionRowId: existing.id };
  }
  await logDelivery(tx, { connectionId: conn.id, revisionRowId: existing.id, via, outcome: 'duplicate' });
  // The hub resends what it believes unacknowledged: acknowledge again — only if the outcome is final.
  await db(tx)
    .updateTable('distribution.revision_processing')
    .set({ ack_state: 'pending', ack_next_at: tx.now, updated_at: tx.now })
    .where('revision_row_id', '=', existing.id)
    .where('state', 'in', [...FINAL])
    .where('ack_state', 'in', ['acked', 'failed'])
    .execute();
  await scheduleTenant(tx, tx.now);
  return { outcome: 'duplicate', revisionRowId: existing.id };
}

// ───────────────────────────── process ─────────────────────────────

type Joined = Awaited<ReturnType<typeof loadJoined>>;

async function loadJoined(tx: TxContext, revisionRowId: string, forUpdate = false) {
  let q = db(tx)
    .selectFrom('distribution.revision_processing as p')
    .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
    .selectAll('p')
    .select(['r.revision_id', 'r.channel_status', 'r.payload', 'r.received_via', 'r.received_at'])
    .where('p.revision_row_id', '=', revisionRowId);
  if (forUpdate) q = q.forUpdate('p');
  const row = await q.executeTakeFirst();
  if (!row) throw new NotFoundError('channel_revision', revisionRowId);
  return row;
}

async function bookingKnown(tx: TxContext, conn: ConnectionRow, channelBookingId: string): Promise<boolean> {
  const row = await db(tx)
    .selectFrom('distribution.revision_processing')
    .select('revision_row_id')
    .where('connection_id', '=', conn.id)
    .where('channel_booking_id', '=', channelBookingId)
    .where('state', '=', 'applied')
    .where('booking_id', 'is not', null)
    .executeTakeFirst();
  return row !== undefined;
}

async function earlierUnsettled(tx: TxContext, row: Joined): Promise<number> {
  const r = await db(tx)
    .selectFrom('distribution.revision_processing')
    .select(sql<number>`count(*)::int`.as('n'))
    .where('connection_id', '=', row.connection_id)
    .where('channel_booking_id', '=', row.channel_booking_id)
    .where('revision_order', '<', row.revision_order)
    .where('state', 'in', [...UNSETTLED])
    .executeTakeFirst();
  return r?.n ?? 0;
}

async function mappingLookup(tx: TxContext, conn: ConnectionRow): Promise<MappingLookup> {
  const m = await activeMappings(tx, conn.id);
  return {
    rooms: new Map(m.rooms.map((r) => [r.channel_room_type_id, r.unit_type_id])),
    rates: new Map(
      m.rates.map((r) => [
        r.channel_rate_plan_id,
        { unitTypeId: r.unit_type_id, ratePlanId: r.rate_plan_id },
      ]),
    ),
    fallbackRatePlanId: settingsOf(conn).fallbackRatePlanId,
  };
}

const label = (rev: HubRevision) =>
  `${rev.otaName ?? 'channel'} booking ${rev.otaReservationCode ?? rev.bookingId}`;

/** After a revision settles: later revisions of the booking may run; parked orphans run once the booking exists. */
async function wakeBooking(tx: TxContext, row: Joined, bookingNowKnown: boolean): Promise<void> {
  await db(tx)
    .updateTable('distribution.revision_processing')
    .set({ next_attempt_at: tx.now, updated_at: tx.now })
    .where('connection_id', '=', row.connection_id)
    .where('channel_booking_id', '=', row.channel_booking_id)
    .where('state', '=', 'received')
    .where('revision_row_id', '<>', row.revision_row_id)
    .execute();
  if (bookingNowKnown) {
    await db(tx)
      .updateTable('distribution.revision_processing')
      .set({
        state: 'received',
        park_reason: null,
        next_attempt_at: tx.now,
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('connection_id', '=', row.connection_id)
      .where('channel_booking_id', '=', row.channel_booking_id)
      .where('state', '=', 'parked')
      .where('park_reason', '=', 'orphan')
      .execute();
  }
  await scheduleTenant(tx, tx.now);
}

async function park(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  row: Joined,
  reason: 'orphan' | 'unmapped',
  note: string,
  holdIds: string[],
): Promise<void> {
  await db(tx)
    .updateTable('distribution.revision_processing')
    .set({
      state: 'parked',
      park_reason: reason,
      parked_since: row.parked_since ?? tx.now,
      note,
      next_attempt_at: null,
      hold_ids: json(holdIds),
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('revision_row_id', '=', row.revision_row_id)
    .execute();
  if (reason === 'orphan') {
    // Ask the hub right away for revisions it still holds unacknowledged (the creation may be among them).
    await db(tx)
      .updateTable('distribution.connections')
      .set({ next_feed_pull_at: tx.now })
      .where('id', '=', conn.id)
      .execute();
    await scheduleTenant(tx, tx.now);
  }
  await tx.audit({
    action: 'distribution.revision.parked',
    target: { type: RECORD.revision, id: row.revision_row_id },
    propertyId: conn.property_id,
    after: { state: 'parked', reason },
    reason: note,
  });
  await tx.emit({
    type: E.bookingParked,
    propertyId: conn.property_id,
    aggregate: { type: RECORD.revision, id: row.revision_row_id },
    aggregateVersion: row.version + 1,
    payload: {
      connectionId: conn.id,
      propertyId: conn.property_id,
      revisionRowId: row.revision_row_id,
      channelBookingId: row.channel_booking_id,
      channelStatus: row.channel_status,
      reason,
    },
  });
  void deps;
}

/** DST-R10 / DST-I03: an unmapped booking is never "accepted without decrementing inventory". */
async function parkUnmapped(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  row: Joined,
  rev: HubRevision,
  unmapped: UnmappedRoom[],
): Promise<void> {
  const existing = (row.hold_ids as string[] | null) ?? [];
  const holds = [...existing];
  const placed: string[] = [];
  const flagged: string[] = [];
  if (existing.length === 0) {
    for (const u of unmapped) {
      if (!u.holdUnitTypeId || u.arrival >= u.departure) {
        flagged.push(u.roomRef);
        continue;
      }
      const maxExpiry = tx.now.getTime() + 179 * 86_400_000;
      const departure = new Date(`${addDays(u.departure, 1)}T00:00:00Z`).getTime();
      try {
        const h = await withSavepoint(tx, 'dst_hold', () =>
          deps.ports.inventory.createHold(tx, {
            propertyId: conn.property_id,
            unitTypeId: u.holdUnitTypeId as string,
            nights: { from: u.arrival, to: u.departure },
            quantity: 1,
            expiresAt: new Date(Math.min(maxExpiry, departure)),
            ref: { type: RECORD.revision, id: row.revision_row_id },
          }),
        );
        holds.push(h.holdId);
        placed.push(u.roomRef);
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        flagged.push(u.roomRef);
      }
    }
  }
  const codes = unmapped
    .map((u) => `room type ${u.channelRoomTypeId ?? '(none)'} / rate plan ${u.channelRatePlanId ?? '(none)'}`)
    .join('; ');
  const holdText =
    holds.length > 0
      ? `A provisional hold protects the inventory (${holds.length} unit(s))${flagged.length ? `; ${flagged.length} room(s) could not be held — check the property total` : ''}.`
      : 'No unit could be held (no matching unit type or no availability): the property total may be overbooked.';
  await raiseException(tx, {
    connectionId: conn.id,
    propertyId: conn.property_id,
    code: 'unmapped_booking',
    dedupeKey: `unmapped:${row.channel_booking_id}`,
    severity: 'urgent',
    problem: `${label(rev)} arrived for an unmapped product (${codes}). ${holdText}`,
    businessImpact: 'The guest is confirmed by the channel but has no booking in Portico yet.',
    responsibleParty: 'hotel',
    nextStep:
      'Map the channel room type and rate plan in the connection’s mappings: the booking is then applied automatically and the hold released.',
    refs: [{ type: RECORD.revision, id: row.revision_row_id }],
  });
  await park(tx, deps, conn, row, 'unmapped', `Unmapped: ${codes}.`, holds);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof DomainError) return err.retryable || err.status >= 500;
  if (err instanceof Error && err.name === 'ZodError') return false;
  return true;
}

function errorMessage(err: unknown): string {
  if (err instanceof DomainError) return err.message;
  if (err instanceof Error && err.name === 'ZodError')
    return 'The booking did not pass the reservations module’s validation.';
  return 'An unexpected error happened while recording the booking.';
}

const STATE_OF: Record<IngestResult['outcome'], RevisionState> = {
  created: 'applied',
  modified: 'applied',
  cancelled: 'applied',
  conflict: 'applied',
  needs_review: 'applied',
  duplicate: 'duplicate',
  stale: 'stale',
};

/** Process one revision (caller holds the property lock). Returns its new state. */
async function processOne(
  tx: TxContext,
  deps: DistributionDeps,
  conn: ConnectionRow,
  row: Joined,
  opts: { forceApply?: boolean } = {},
): Promise<RevisionState> {
  const rev = row.payload as HubRevision;
  if (!opts.forceApply) {
    const decision = decideProcessing({
      channelStatus: row.channel_status,
      bookingKnown: await bookingKnown(tx, conn, row.channel_booking_id),
      earlierUnsettled: 0,
    });
    if (decision.action === 'park_orphan') {
      await park(tx, deps, conn, row, 'orphan', decision.reason, (row.hold_ids as string[]) ?? []);
      return 'parked';
    }
  }
  const translation = translateRevision(rev, {
    propertyId: conn.property_id,
    amountsIncludeTax: settingsOf(conn).amountsIncludeTax,
    mapping: await mappingLookup(tx, conn),
  });
  if (!translation.ok) {
    await parkUnmapped(tx, deps, conn, row, rev, translation.unmapped);
    return 'parked';
  }
  const holds = (row.hold_ids as string[] | null) ?? [];
  let result: IngestResult;
  try {
    result = await withSavepoint(tx, 'dst_apply', async () => {
      for (const holdId of holds) {
        await deps.ports.inventory.releaseHold(tx, {
          propertyId: conn.property_id,
          holdId,
          reason: 'Channel booking applied',
        });
      }
      return deps.ports.reservations.ingestChannelBooking(tx, {
        connectionId: conn.id,
        externalId: row.channel_booking_id,
        revision: row.revision_order,
        payload: translation.payload,
      });
    });
  } catch (err) {
    const retryable = isRetryable(err);
    const attempts = row.attempts + 1;
    const firstFailed = row.first_failed_at ? new Date(row.first_failed_at) : tx.now;
    await db(tx)
      .updateTable('distribution.revision_processing')
      .set({
        state: retryable ? 'failed' : 'rejected',
        attempts,
        first_failed_at: firstFailed,
        next_attempt_at: retryable ? new Date(tx.now.getTime() + retryDelayMs(attempts)) : null,
        last_error: errorMessage(err).slice(0, 1000),
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('revision_row_id', '=', row.revision_row_id)
      .execute();
    await raiseException(tx, {
      connectionId: conn.id,
      propertyId: conn.property_id,
      code: retryable ? 'booking_not_applied' : 'booking_rejected',
      dedupeKey: `apply:${row.revision_row_id}`,
      severity: !retryable || isEscalated(firstFailed, tx.now) ? 'urgent' : 'routine',
      problem: `${label(rev)} (${row.channel_status}) was received and stored, but Portico could not record it: ${errorMessage(err)}`,
      businessImpact:
        'The booking change is NOT in Portico yet and has NOT been acknowledged to the hub, which keeps offering it (no booking is lost).',
      responsibleParty: retryable ? 'monoclay' : 'hotel',
      nextStep: retryable
        ? 'Portico retries automatically. If this lasts, contact Monoclay support.'
        : 'Fix the cause (for example the mapping or the system of record for reservations), then choose Retry on the revision; or Dismiss it after confirming with the channel.',
      refs: [{ type: RECORD.revision, id: row.revision_row_id }],
    });
    return retryable ? 'failed' : 'rejected';
  }
  const state = STATE_OF[result.outcome];
  const wasParked = row.parked_since !== null || opts.forceApply === true;
  await db(tx)
    .updateTable('distribution.revision_processing')
    .set({
      state,
      outcome: result.outcome,
      booking_id: result.bookingId ?? null,
      note:
        result.note ?? (translation.fallbackRooms.length ? 'Applied with the fallback rate plan.' : row.note),
      attempts: row.attempts + 1,
      next_attempt_at: null,
      last_error: null,
      hold_ids: json([]),
      park_reason: null,
      processed_at: tx.now,
      ack_state: 'pending',
      ack_next_at: tx.now,
      updated_at: tx.now,
      version: sql`version + 1`,
    })
    .where('revision_row_id', '=', row.revision_row_id)
    .execute();
  await autoResolve(tx, conn.id, `apply:${row.revision_row_id}`, `Recorded in Portico (${result.outcome}).`);
  await autoResolve(
    tx,
    conn.id,
    `orphan:${row.revision_row_id}`,
    'The booking it changes arrived; the revision was applied.',
  );
  await autoResolve(
    tx,
    conn.id,
    `unmapped:${row.channel_booking_id}`,
    'The product is mapped now; the booking was applied.',
  );
  for (const roomRef of translation.fallbackRooms) {
    await raiseDiscrepancy(tx, {
      connectionId: conn.id,
      propertyId: conn.property_id,
      kind: 'mapping',
      dedupeKey: `fallback_rate:${row.channel_booking_id}:${roomRef}`,
      summary: `${label(rev)} room ${roomRef} used an unmapped channel rate plan; it was recorded with the fallback rate plan at the channel's price.`,
      refs: [{ type: RECORD.revision, id: row.revision_row_id }],
    });
  }
  if (result.outcome === 'needs_review') {
    await raiseDiscrepancy(tx, {
      connectionId: conn.id,
      propertyId: conn.property_id,
      kind: 'reservation',
      dedupeKey: `review:${row.revision_row_id}`,
      summary: `${label(rev)}: ${result.note ?? 'recorded for review, not applied automatically.'}`,
      refs: [
        { type: RECORD.revision, id: row.revision_row_id },
        ...(result.bookingId ? [{ type: 'booking', id: result.bookingId }] : []),
      ],
    });
  }
  await tx.audit({
    action: 'distribution.revision.processed',
    target: { type: RECORD.revision, id: row.revision_row_id },
    propertyId: conn.property_id,
    before: { state: row.state },
    after: { state, outcome: result.outcome, bookingId: result.bookingId ?? null },
  });
  if (wasParked || row.received_via !== 'webhook') {
    await tx.emit({
      type: E.bookingRecovered,
      propertyId: conn.property_id,
      aggregate: { type: RECORD.revision, id: row.revision_row_id },
      aggregateVersion: row.version + 1,
      payload: {
        connectionId: conn.id,
        propertyId: conn.property_id,
        revisionRowId: row.revision_row_id,
        channelBookingId: row.channel_booking_id,
        channelStatus: row.channel_status,
        via: row.received_via,
      },
    });
  }
  await wakeBooking(tx, row, state === 'applied' && !!result.bookingId);
  return state;
}

/**
 * Process due revisions of one connection, one transaction per revision, serialized per property. Returns how
 * many were processed and when the next one is due.
 */
export async function processInbound(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  opts: { max?: number } = {},
): Promise<{ processed: number; states: RevisionState[] }> {
  const states: RevisionState[] = [];
  for (let i = 0; i < (opts.max ?? 100); i++) {
    const r = await withTenantTx(database, ctx, async (tx) => {
      const conn = await loadConnection(tx, connectionId);
      if (conn.status === 'disconnected' || conn.status === 'setup') return null;
      await lockPropertyInbound(tx, conn.property_id);
      const candidates = await db(tx)
        .selectFrom('distribution.revision_processing as p')
        .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
        .select('p.revision_row_id')
        .where('p.connection_id', '=', conn.id)
        .where('p.state', 'in', ['received', 'failed'])
        .where('p.next_attempt_at', 'is not', null)
        .where('p.next_attempt_at', '<=', tx.now)
        .orderBy('p.revision_order')
        .orderBy('r.received_at')
        .limit(50)
        .execute();
      for (const c of candidates) {
        const row = await loadJoined(tx, c.revision_row_id, true);
        if (!['received', 'failed'].includes(row.state)) continue;
        if ((await earlierUnsettled(tx, row)) > 0) {
          // Ordered processing: wait until the earlier revision settles (it wakes this one).
          await db(tx)
            .updateTable('distribution.revision_processing')
            .set({ next_attempt_at: null, updated_at: tx.now })
            .where('revision_row_id', '=', row.revision_row_id)
            .execute();
          continue;
        }
        return processOne(tx, deps, conn, row);
      }
      return null;
    });
    if (r === null) break;
    states.push(r);
  }
  return { processed: states.length, states };
}

/** Escalate orphans parked for more than 15 minutes (DST-R09). */
export async function escalateParked(tx: TxContext, conn: ConnectionRow): Promise<number> {
  const rows = await db(tx)
    .selectFrom('distribution.revision_processing as p')
    .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
    .select(['p.revision_row_id', 'p.channel_booking_id', 'r.channel_status', 'r.payload'])
    .where('p.connection_id', '=', conn.id)
    .where('p.state', '=', 'parked')
    .where('p.park_reason', '=', 'orphan')
    .where('p.escalated_at', 'is', null)
    .where('p.parked_since', '<=', new Date(tx.now.getTime() - PARK_ESCALATION_MS))
    .execute();
  for (const r of rows) {
    await raiseException(tx, {
      connectionId: conn.id,
      propertyId: conn.property_id,
      code: 'orphan_revision',
      dedupeKey: `orphan:${r.revision_row_id}`,
      severity: 'urgent',
      problem: `A ${r.channel_status === 'cancelled' ? 'cancellation' : 'modification'} of ${label(r.payload as HubRevision)} has waited more than 15 minutes for the booking it changes.`,
      businessImpact:
        r.channel_status === 'cancelled'
          ? 'If Portico never received the booking, nothing needs to be released; otherwise a cancelled guest still holds a unit.'
          : 'The guest may hold a booking at the channel that Portico does not have.',
      responsibleParty: 'vendor',
      nextStep:
        'Portico pulls missed revisions from the hub automatically. If the booking is still missing, choose "Apply as new" (creates it from this revision’s full details) or "Dismiss" after confirming with the channel.',
      refs: [{ type: RECORD.revision, id: r.revision_row_id }],
    });
    await db(tx)
      .updateTable('distribution.revision_processing')
      .set({ escalated_at: tx.now, updated_at: tx.now })
      .where('revision_row_id', '=', r.revision_row_id)
      .execute();
  }
  return rows.length;
}

// ───────────────────────────── acknowledgement ─────────────────────────────

/** Send due acknowledgements (claim → call → record). Only final, committed outcomes are ever claimed. */
export async function dispatchAcks(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  opts: { batch?: number } = {},
): Promise<{ sent: number; acked: number }> {
  const claimed = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (conn.status === 'disconnected' || conn.credential_state === 'invalid') return null;
    let hubCtx: Awaited<ReturnType<typeof hubContext>>;
    try {
      hubCtx = await hubContext(tx, deps, conn);
    } catch (err) {
      if (err instanceof DomainError) return null;
      throw err;
    }
    const due = await db(tx)
      .selectFrom('distribution.revision_processing as p')
      .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
      .select(['p.revision_row_id', 'r.revision_id', 'p.ack_attempts'])
      .where('p.connection_id', '=', conn.id)
      .where((eb) =>
        eb.or([
          eb.and([eb('p.ack_state', 'in', ['pending', 'failed']), eb('p.ack_next_at', '<=', tx.now)]),
          eb.and([eb('p.ack_state', '=', 'sending'), eb('p.ack_lease_until', '<', tx.now)]),
        ]),
      )
      .where('p.state', 'in', [...FINAL])
      .orderBy('p.ack_next_at')
      .limit(opts.batch ?? 25)
      .forUpdate('p')
      .skipLocked()
      .execute();
    const items: Array<{ rowId: string; revisionId: string; token: string; attempts: number }> = [];
    for (const d of due) {
      const token = newId(tx.now.getTime());
      await db(tx)
        .updateTable('distribution.revision_processing')
        .set({
          ack_state: 'sending',
          ack_lease_token: token,
          ack_lease_until: new Date(tx.now.getTime() + deps.config.leaseMs),
          ack_attempts: d.ack_attempts + 1,
          updated_at: tx.now,
        })
        .where('revision_row_id', '=', d.revision_row_id)
        .execute();
      items.push({
        rowId: d.revision_row_id,
        revisionId: d.revision_id,
        token,
        attempts: d.ack_attempts + 1,
      });
    }
    return { conn, hubCtx, items };
  });
  if (!claimed || claimed.items.length === 0) return { sent: 0, acked: 0 };
  const results: Array<{
    item: (typeof claimed.items)[number];
    ok: boolean;
    failure?: HubFailure;
    ms: number;
    status: number | null;
  }> = [];
  for (const item of claimed.items) {
    const started = Date.now();
    try {
      const r = await deps.hub.acknowledge(claimed.hubCtx, item.revisionId);
      results.push({ item, ok: true, ms: Date.now() - started, status: r.httpStatus });
    } catch (err) {
      const failure: HubFailure =
        err instanceof HubError
          ? err.failure
          : {
              class: 'transient',
              message: 'Unexpected error while acknowledging.',
              httpStatus: null,
              retryAfterSeconds: null,
              outcomeUnknown: true,
            };
      results.push({ item, ok: false, failure, ms: Date.now() - started, status: failure.httpStatus });
    }
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = claimed.conn;
    const provenance = provenanceOfTarget(conn.target);
    let acked = 0;
    for (const r of results) {
      const row = await db(tx)
        .selectFrom('distribution.revision_processing')
        .selectAll()
        .where('revision_row_id', '=', r.item.rowId)
        .forUpdate()
        .executeTakeFirst();
      await recordExchange(tx, {
        connectionId: conn.id,
        direction: 'outbound',
        operation: 'revision.ack',
        ref: r.item.revisionId,
        httpStatus: r.status,
        outcome: r.ok ? 'acked' : (r.failure?.class ?? 'failed'),
        durationMs: r.ms,
        provenance,
      });
      if (!row || row.ack_state !== 'sending' || row.ack_lease_token !== r.item.token) continue;
      if (r.ok) {
        acked++;
        await db(tx)
          .updateTable('distribution.revision_processing')
          .set({
            ack_state: 'acked',
            acked_at: tx.now,
            ack_next_at: null,
            ack_first_failed_at: null,
            ack_lease_token: null,
            ack_lease_until: null,
            updated_at: tx.now,
          })
          .where('revision_row_id', '=', row.revision_row_id)
          .execute();
        await autoResolve(tx, conn.id, `ack:${row.revision_row_id}`, 'The hub accepted the acknowledgement.');
        continue;
      }
      const f = r.failure as HubFailure;
      const firstFailed = row.ack_first_failed_at ? new Date(row.ack_first_failed_at) : tx.now;
      const stop = f.class === 'payload';
      await db(tx)
        .updateTable('distribution.revision_processing')
        .set({
          ack_state: 'failed',
          ack_first_failed_at: firstFailed,
          ack_next_at: stop ? null : nextAttemptAt(tx.now, r.item.attempts, f),
          ack_lease_token: null,
          ack_lease_until: null,
          updated_at: tx.now,
        })
        .where('revision_row_id', '=', row.revision_row_id)
        .execute();
      if (f.class === 'auth') {
        await markCredentialsInvalid(tx, conn, f.message);
        continue;
      }
      if (stop || isEscalated(firstFailed, tx.now)) {
        await raiseException(tx, {
          connectionId: conn.id,
          propertyId: conn.property_id,
          code: stop ? 'ack_refused' : 'ack_failing',
          dedupeKey: `ack:${row.revision_row_id}`,
          severity: 'urgent',
          problem: `The hub has not accepted the acknowledgement of channel booking ${row.channel_booking_id}: ${f.message}`,
          businessImpact:
            'The booking IS recorded in Portico. The hub keeps offering it and, after 30 minutes, e-mails the hotel that it was not acknowledged.',
          responsibleParty: stop ? 'monoclay' : 'vendor',
          nextStep: stop
            ? 'Contact Monoclay support; once fixed, choose Retry acknowledgement on the revision.'
            : 'Portico keeps retrying every minute; check the hub status.',
          refs: [{ type: RECORD.revision, id: row.revision_row_id }],
        });
      }
    }
    return { sent: results.length, acked };
  });
}

// ───────────────────────────── recovery ─────────────────────────────

/** Pull the hub's not-acknowledged revisions and store any Portico is missing (missed webhooks). */
export async function pullFeed(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  via: 'feed' | 'recovery' = 'feed',
): Promise<{ stored: number; duplicates: number; unparseable: number; failed: boolean }> {
  const pre = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (conn.status === 'disconnected' || conn.status === 'setup' || conn.credential_state === 'invalid')
      return null;
    try {
      return { conn, hubCtx: await hubContext(tx, deps, conn) };
    } catch (err) {
      if (err instanceof DomainError) return null;
      throw err;
    }
  });
  if (!pre) return { stored: 0, duplicates: 0, unparseable: 0, failed: false };
  const started = Date.now();
  let items: Awaited<ReturnType<typeof deps.hub.fetchFeed>> | null = null;
  let failure: HubFailure | null = null;
  try {
    items = await deps.hub.fetchFeed(pre.hubCtx);
  } catch (err) {
    failure =
      err instanceof HubError
        ? err.failure
        : {
            class: 'transient',
            message: 'Unexpected error while pulling revisions.',
            httpStatus: null,
            retryAfterSeconds: null,
            outcomeUnknown: false,
          };
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId, { forUpdate: true });
    const s = settingsOf(conn);
    const provenance = provenanceOfTarget(conn.target);
    let stored = 0;
    let duplicates = 0;
    let unparseable = 0;
    let gap = false;
    if (failure || !items) {
      await recordExchange(tx, {
        connectionId: conn.id,
        direction: 'outbound',
        operation: 'revision.feed',
        httpStatus: failure?.httpStatus ?? null,
        outcome: failure?.class ?? 'failed',
        durationMs: Date.now() - started,
        detail: { message: failure?.message ?? null },
        provenance,
      });
      if (failure?.class === 'auth') await markCredentialsInvalid(tx, conn, failure.message);
      await db(tx)
        .updateTable('distribution.connections')
        .set({ next_feed_pull_at: new Date(tx.now.getTime() + 60_000) })
        .where('id', '=', conn.id)
        .execute();
      return { stored, duplicates, unparseable, failed: true };
    }
    for (const it of items) {
      if (!it.ok) {
        unparseable++;
        await logDelivery(tx, {
          connectionId: conn.id,
          via,
          outcome: 'unparseable',
          detail: { revisionId: it.revisionId, issues: it.issues },
        });
        await raiseException(tx, {
          connectionId: conn.id,
          propertyId: conn.property_id,
          code: 'revision_unreadable',
          dedupeKey: `unreadable:${it.revisionId}`,
          severity: 'urgent',
          problem: `Revision ${it.revisionId} from the hub could not be read (${it.issues.slice(0, 3).join('; ')}).`,
          businessImpact:
            'A channel booking change is not in Portico; it stays unacknowledged at the hub (not lost).',
          responsibleParty: 'monoclay',
          nextStep:
            'Monoclay support checks the hub’s format; meanwhile look the booking up in the channel extranet.',
        });
        continue;
      }
      if (it.revision.externalPropertyId !== conn.external_property_id) {
        await logDelivery(tx, {
          connectionId: conn.id,
          via,
          outcome: 'property_mismatch',
          detail: { revisionId: it.revision.revisionId },
        });
        continue;
      }
      const r = await storeRevision(tx, conn, it.revision, via);
      if (r.outcome === 'stored') {
        stored++;
        const age = it.revision.insertedAt ? tx.now.getTime() - Date.parse(it.revision.insertedAt) : 0;
        if (conn.activated_at && age > s.freshnessTargetSeconds * 1000) gap = true;
      } else duplicates++;
    }
    await recordExchange(tx, {
      connectionId: conn.id,
      direction: 'outbound',
      operation: 'revision.feed',
      httpStatus: 200,
      outcome: 'pulled',
      durationMs: Date.now() - started,
      detail: { items: items.length, stored, duplicates, unparseable },
      provenance,
    });
    await db(tx)
      .updateTable('distribution.connections')
      .set({
        last_feed_pull_at: tx.now,
        next_feed_pull_at: new Date(tx.now.getTime() + s.feedPullMinutes * 60_000),
        ...(gap ? { inbound_gap_at: tx.now } : {}),
      })
      .where('id', '=', conn.id)
      .execute();
    return { stored, duplicates, unparseable, failed: false };
  });
}

/**
 * "Re-request since T" (DST-R11, E03): compare the hub's booking list since T with Portico; fetch and ingest
 * what Portico is missing (exactly once — the same store path), and flag Portico bookings the hub does not list.
 */
export async function recoverSince(
  database: PorticoDatabase,
  deps: DistributionDeps,
  ctx: RequestContext,
  connectionId: string,
  since: Date,
): Promise<{ listed: number; fetched: number; stored: number; notAtChannel: number }> {
  const pre = await withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    if (conn.status === 'disconnected' || conn.credential_state === 'invalid') {
      throw new BusinessRuleError(
        'hub_not_reachable',
        conn.status === 'disconnected'
          ? 'The connection is disconnected.'
          : 'The hub refused the API key: replace and verify it before asking the hub for bookings.',
      );
    }
    return { conn, hubCtx: await hubContext(tx, deps, conn) };
  });
  // The same rule as every other hub path: a refused key pauses this connection with an urgent exception, and a
  // hub failure is explained (never an unexplained 500).
  const guarded = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof HubError)) throw err;
      if (err.failure.class === 'auth') {
        await withTenantTx(database, ctx, (tx) => markCredentialsInvalid(tx, pre.conn, err.failure.message));
      }
      throw new DomainError(
        'hub_request_failed',
        `${err.failure.message} Nothing was changed; try again later.`,
        {
          status: 502,
          retryable: err.failure.class !== 'payload' && err.failure.class !== 'auth',
          details: { class: err.failure.class },
        },
      );
    }
  };
  const listed = await guarded(() => deps.hub.listBookingsSince(pre.hubCtx, since.toISOString()));
  const known = await withTenantTx(database, ctx, async (tx) =>
    db(tx)
      .selectFrom('distribution.inbound_revisions')
      .select(['channel_booking_id', 'revision_id'])
      .where('connection_id', '=', connectionId)
      .execute(),
  );
  const knownRevisions = new Set(known.map((k) => k.revision_id));
  const fetched: HubRevision[] = [];
  for (const b of listed) {
    if (!b.latestRevisionId || knownRevisions.has(b.latestRevisionId)) continue;
    const id = b.latestRevisionId;
    const item = await guarded(() => deps.hub.fetchRevision(pre.hubCtx, id));
    if (item?.ok) fetched.push(item.revision);
  }
  return withTenantTx(database, ctx, async (tx) => {
    const conn = await loadConnection(tx, connectionId);
    let stored = 0;
    for (const rev of fetched) {
      const r = await storeRevision(tx, conn, rev, 'recovery');
      if (r.outcome === 'stored') stored++;
    }
    const channelIds = new Set(listed.map((b) => b.bookingId));
    const ours = await db(tx)
      .selectFrom('distribution.revision_processing as p')
      .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
      .select(['p.channel_booking_id', 'p.booking_id'])
      .where('p.connection_id', '=', conn.id)
      .where('p.state', '=', 'applied')
      .where('r.received_at', '>=', since)
      .execute();
    let notAtChannel = 0;
    for (const o of ours) {
      if (channelIds.has(o.channel_booking_id)) continue;
      notAtChannel++;
      await raiseDiscrepancy(tx, {
        connectionId: conn.id,
        propertyId: conn.property_id,
        kind: 'reservation',
        dedupeKey: `not_at_channel:${o.channel_booking_id}`,
        summary: `Portico holds channel booking ${o.channel_booking_id}, but the hub does not list it since ${since.toISOString()}.`,
        refs: o.booking_id ? [{ type: 'booking', id: o.booking_id }] : [],
      });
    }
    if (stored > 0)
      await db(tx)
        .updateTable('distribution.connections')
        .set({ inbound_gap_at: tx.now })
        .where('id', '=', conn.id)
        .execute();
    await recordExchange(tx, {
      connectionId: conn.id,
      direction: 'outbound',
      operation: 'booking.reconcile',
      outcome: 'ok',
      detail: {
        listed: listed.length,
        fetched: fetched.length,
        stored,
        notAtChannel,
        since: since.toISOString(),
      },
      provenance: provenanceOfTarget(conn.target),
    });
    return { listed: listed.length, fetched: fetched.length, stored, notAtChannel };
  });
}

// ───────────────────────────── staff actions and views ─────────────────────────────

export async function resolveRevision(
  tx: TxContext,
  deps: DistributionDeps,
  revisionRowId: string,
  expectedVersion: number,
  input: { action: 'retry' | 'apply_as_new' | 'dismiss'; reason: string },
): Promise<RevisionView> {
  const peek = await loadJoined(tx, revisionRowId);
  const conn = await loadConnection(tx, peek.connection_id);
  requireOnConnection(tx, conn, P.reservationRecover);
  await lockPropertyInbound(tx, conn.property_id);
  const row = await loadJoined(tx, revisionRowId, true);
  if (row.version !== expectedVersion)
    throw new VersionConflictError('channel_revision', revisionRowId, expectedVersion, row.version);
  const by = actorKey(tx);
  if (input.action === 'retry') {
    // A dismissed revision is closed by a person's decision (and acknowledged): it is never re-opened by Retry.
    if ((row.state === 'failed' || row.state === 'rejected') && row.ack_state === 'not_due') {
      await db(tx)
        .updateTable('distribution.revision_processing')
        .set({
          state: 'received',
          next_attempt_at: tx.now,
          resolved_by: by,
          updated_at: tx.now,
          version: sql`version + 1`,
        })
        .where('revision_row_id', '=', row.revision_row_id)
        .execute();
    } else if (row.ack_state === 'failed' && FINAL.includes(row.state)) {
      await db(tx)
        .updateTable('distribution.revision_processing')
        .set({
          ack_state: 'pending',
          ack_next_at: tx.now,
          resolved_by: by,
          updated_at: tx.now,
          version: sql`version + 1`,
        })
        .where('revision_row_id', '=', row.revision_row_id)
        .execute();
    } else {
      throw new BusinessRuleError(
        'revision_not_retryable',
        `This revision is ${row.state}; only a failed or refused revision (or a failed acknowledgement) can be retried.`,
      );
    }
    await scheduleTenant(tx, tx.now);
  } else if (input.action === 'apply_as_new') {
    if (row.state !== 'parked' || row.park_reason !== 'orphan') {
      throw new BusinessRuleError(
        'revision_not_orphan',
        'Only a revision parked because its booking was never received can be applied as new.',
      );
    }
    if ((await earlierUnsettled(tx, row)) > 0) {
      throw new BusinessRuleError(
        'earlier_revision_unsettled',
        'An earlier revision of this booking is not settled yet; resolve it first.',
      );
    }
    await processOne(tx, deps, conn, row, { forceApply: true });
    await db(tx)
      .updateTable('distribution.revision_processing')
      .set({ resolved_by: by })
      .where('revision_row_id', '=', row.revision_row_id)
      .execute();
  } else {
    if (!['parked', 'failed', 'rejected', 'received'].includes(row.state)) {
      throw new BusinessRuleError('revision_settled', `This revision is already ${row.state}.`);
    }
    for (const holdId of (row.hold_ids as string[] | null) ?? []) {
      await deps.ports.inventory.releaseHold(tx, {
        propertyId: conn.property_id,
        holdId,
        reason: 'Channel revision dismissed',
      });
    }
    // A person decided: the revision is closed in Portico and acknowledged so the hub stops offering it.
    await db(tx)
      .updateTable('distribution.revision_processing')
      .set({
        state: 'rejected',
        outcome: 'dismissed',
        note: `Dismissed: ${input.reason}`,
        next_attempt_at: null,
        hold_ids: json([]),
        park_reason: null,
        ack_state: 'pending',
        ack_next_at: tx.now,
        resolved_by: by,
        processed_at: tx.now,
        updated_at: tx.now,
        version: sql`version + 1`,
      })
      .where('revision_row_id', '=', row.revision_row_id)
      .execute();
    await autoResolve(tx, conn.id, `apply:${row.revision_row_id}`, `Dismissed by staff: ${input.reason}`);
    await autoResolve(tx, conn.id, `orphan:${row.revision_row_id}`, `Dismissed by staff: ${input.reason}`);
    await autoResolve(
      tx,
      conn.id,
      `unmapped:${row.channel_booking_id}`,
      `Dismissed by staff: ${input.reason}`,
    );
    await wakeBooking(tx, row, false);
  }
  await tx.audit({
    action: `distribution.revision.${input.action}`,
    target: { type: RECORD.revision, id: row.revision_row_id },
    propertyId: conn.property_id,
    before: { state: row.state, ack: row.ack_state },
    reason: input.reason,
  });
  return getRevision(tx, revisionRowId);
}

function revisionView(tx: TxContext, row: Joined, conn: Pick<ConnectionRow, 'target'>): RevisionView {
  const rev = row.payload as HubRevision;
  const canRecover = tx.authz.can(P.reservationRecover, { propertyId: row.property_id });
  const noPerm = 'Needs permission to recover channel bookings.';
  const action = (name: string, labelText: string, ok: boolean, why: string) => ({
    action: name,
    label: labelText,
    enabled: ok && canRecover,
    ...(!ok ? { reason: why } : !canRecover ? { reason: noPerm } : {}),
  });
  const retryable =
    ((row.state === 'failed' || row.state === 'rejected') && row.ack_state === 'not_due') ||
    (row.ack_state === 'failed' && FINAL.includes(row.state));
  const issues: RevisionView['issues'] = [];
  if (row.state === 'parked') {
    issues.push({
      code: row.park_reason === 'unmapped' ? 'unmapped' : 'orphan',
      severity: 'blocking',
      message: row.note ?? 'Waiting.',
      ...(row.parked_since ? { since: iso(row.parked_since) as string } : {}),
    });
  }
  if (row.state === 'failed' || row.state === 'rejected') {
    issues.push({
      code: 'not_applied',
      severity: 'blocking',
      message: row.last_error ?? row.note ?? 'Not applied.',
    });
  }
  if (row.ack_state === 'failed')
    issues.push({
      code: 'ack_failed',
      severity: 'warning',
      message: 'The hub has not accepted the acknowledgement yet.',
    });
  const arrival = rev.rooms.map((r) => r.checkin).sort()[0] ?? null;
  const departure =
    rev.rooms
      .map((r) => r.checkout)
      .sort()
      .reverse()[0] ?? null;
  return {
    id: row.revision_row_id,
    connectionId: row.connection_id,
    propertyId: row.property_id,
    channelBookingId: row.channel_booking_id,
    revisionId: row.revision_id,
    channelStatus: row.channel_status,
    receivedVia: row.received_via,
    receivedAt: iso(row.received_at) as string,
    status: { revision: row.state, ack: row.ack_state },
    parkReason: row.park_reason,
    outcome: row.outcome,
    bookingId: row.booking_id,
    note: row.note,
    attempts: row.attempts,
    nextAttemptAt: iso(row.next_attempt_at),
    lastError: row.last_error,
    ackedAt: iso(row.acked_at),
    otaName: rev.otaName,
    otaReservationCode: rev.otaReservationCode,
    arrival,
    departure,
    provenance: provenanceOfTarget(conn.target),
    allowedActions: [
      action(
        'retry',
        'Retry',
        retryable,
        'Only a failed or refused revision (or acknowledgement) can be retried.',
      ),
      action(
        'apply_as_new',
        'Apply as new booking',
        row.state === 'parked' && row.park_reason === 'orphan',
        'Only a revision waiting for a booking Portico never received.',
      ),
      action(
        'dismiss',
        'Dismiss',
        ['parked', 'failed', 'rejected', 'received'].includes(row.state) && row.outcome !== 'dismissed',
        'This revision is settled.',
      ),
    ],
    issues,
    links: [
      { rel: 'connection', type: RECORD.connection, id: row.connection_id },
      ...(row.booking_id ? [{ rel: 'booking', type: 'booking', id: row.booking_id }] : []),
    ],
    version: row.version,
  };
}

export async function getRevision(tx: TxContext, revisionRowId: string): Promise<RevisionView> {
  const row = await loadJoined(tx, revisionRowId);
  const conn = await loadConnection(tx, row.connection_id);
  requireOnConnection(tx, conn, P.channelRead);
  return revisionView(tx, row, conn);
}

export async function listRevisions(
  tx: TxContext,
  connectionId: string,
  q: { state?: RevisionState; channelBookingId?: string; limit?: number } = {},
): Promise<RevisionView[]> {
  const conn = await loadConnection(tx, connectionId);
  requireOnConnection(tx, conn, P.channelRead);
  let query = db(tx)
    .selectFrom('distribution.revision_processing as p')
    .innerJoin('distribution.inbound_revisions as r', 'r.id', 'p.revision_row_id')
    .selectAll('p')
    .select(['r.revision_id', 'r.channel_status', 'r.payload', 'r.received_via', 'r.received_at'])
    .where('p.connection_id', '=', conn.id)
    .orderBy('r.received_at', 'desc')
    .limit(Math.min(q.limit ?? 100, 500));
  if (q.state) query = query.where('p.state', '=', q.state);
  if (q.channelBookingId) query = query.where('p.channel_booking_id', '=', q.channelBookingId);
  return (await query.execute()).map((row) => revisionView(tx, row, conn));
}
