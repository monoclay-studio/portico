/**
 * Strict fake of `reservations.ingestChannelBooking` (the real provider's channel ingestion needs rates'
 * channel-price terms, which are not bound on main — see README "Ports and binding status"). It mirrors the real
 * contract: same permission check, the real canonical Zod schema (malformed payloads throw ZodError), a per-booking
 * lock, idempotency on (connection, external id, revision), older revisions recorded as `stale`, a cancellation for an
 * unknown booking recorded as `stale`, and the same outcomes. It writes in the caller's transaction.
 */
import { sql, type TxContext } from '@portico/db';
import { DomainError, newId, requirePermission } from '@portico/kernel';
import { canonicalChannelBooking } from '@portico/reservations/contracts';
import type { IngestResult, ReservationsPort } from '../../src/ports';

export type FakeMode =
  | { kind: 'normal' }
  | { kind: 'unavailable'; times: number }
  | { kind: 'refuse'; times: number }
  | { kind: 'needs_review'; times: number }
  | { kind: 'conflict'; times: number };

export class FakeReservations implements ReservationsPort {
  mode: FakeMode = { kind: 'normal' };
  /** Every call that reached the fake (committed or not). */
  calls: Array<{ externalId: string; revision: number; status: string }> = [];
  /** Concurrency probes: after its writes, the call announces `entered` and waits for `gate` (transaction open). */
  hold: { entered: () => void; gate: Promise<void> } | null = null;

  private async pause() {
    const h = this.hold;
    if (!h) return;
    this.hold = null;
    h.entered();
    await h.gate;
  }

  private take(): FakeMode['kind'] {
    const m = this.mode;
    if (m.kind === 'normal') return 'normal';
    m.times -= 1;
    if (m.times <= 0) this.mode = { kind: 'normal' };
    return m.kind;
  }

  async ingestChannelBooking(
    tx: TxContext,
    input: Parameters<ReservationsPort['ingestChannelBooking']>[1],
  ): Promise<IngestResult> {
    const payload = canonicalChannelBooking.parse(input.payload);
    requirePermission(tx, 'reservations.channelBooking.ingest', { propertyId: payload.propertyId });
    this.calls.push({ externalId: input.externalId, revision: input.revision, status: payload.status });
    const mode = this.take();
    if (mode === 'unavailable') {
      throw new DomainError('module_not_available', 'Reservations is temporarily unavailable.', {
        status: 503,
        retryable: true,
      });
    }
    if (mode === 'refuse') {
      throw new DomainError(
        'channel_to_external_system',
        'Another system is the system of record for reservations.',
        { status: 422 },
      );
    }
    await sql`select pg_advisory_xact_lock(hashtext(${`${input.connectionId}|${input.externalId}`}))`.execute(
      tx.db,
    );
    const same = await sql<{ booking_id: string | null }>`select booking_id from fake_res.revisions
      where connection_id = ${input.connectionId} and external_id = ${input.externalId} and revision = ${input.revision}`.execute(
      tx.db,
    );
    if (same.rows[0])
      return {
        outcome: 'duplicate',
        ...(same.rows[0].booking_id ? { bookingId: same.rows[0].booking_id } : {}),
      };
    const last = await sql<{
      revision: number;
      booking_id: string | null;
    }>`select revision, booking_id from fake_res.revisions
      where connection_id = ${input.connectionId} and external_id = ${input.externalId} and applied
      order by revision desc limit 1`.execute(tx.db);
    const record = async (outcome: string, applied: boolean, bookingId: string | null) => {
      await sql`insert into fake_res.revisions (tenant_id, connection_id, external_id, revision, outcome, applied, booking_id, payload)
        values (${tx.tenantId}::uuid, ${input.connectionId}::uuid, ${input.externalId}, ${input.revision}, ${outcome}, ${applied},
                ${bookingId}, ${JSON.stringify(payload)}::jsonb)`.execute(tx.db);
    };
    const lastRow = last.rows[0];
    if (lastRow && input.revision < Number(lastRow.revision)) {
      await record('stale', false, lastRow.booking_id);
      return {
        outcome: 'stale',
        ...(lastRow.booking_id ? { bookingId: lastRow.booking_id } : {}),
        note: 'older revision',
      };
    }
    const nights = payload.rooms.reduce(
      (n, r) => n + Math.round((Date.parse(r.departure) - Date.parse(r.arrival)) / 86_400_000),
      0,
    );
    const existing = await sql<{ id: string; status: string }>`select id, status from fake_res.bookings
      where connection_id = ${input.connectionId} and external_id = ${input.externalId} for update`.execute(
      tx.db,
    );
    const booking = existing.rows[0];
    if (!booking) {
      if (payload.status === 'cancelled') {
        await record('stale', false, null);
        return { outcome: 'stale', note: 'nothing to cancel' };
      }
      const id = newId(tx.now.getTime());
      await sql`insert into fake_res.bookings (id, tenant_id, connection_id, external_id, status, nights)
        values (${id}::uuid, ${tx.tenantId}::uuid, ${input.connectionId}::uuid, ${input.externalId}, 'confirmed', ${nights})`.execute(
        tx.db,
      );
      const outcome = mode === 'conflict' ? 'conflict' : 'created';
      await record(outcome, true, id);
      await this.pause();
      return { outcome, bookingId: id };
    }
    if (mode === 'needs_review') {
      await record('needs_review', false, booking.id);
      return { outcome: 'needs_review', bookingId: booking.id, note: 'The guest is already in house.' };
    }
    const status = payload.status === 'cancelled' ? 'cancelled' : 'confirmed';
    await sql`update fake_res.bookings set status = ${status}, nights = ${nights} where id = ${booking.id}::uuid`.execute(
      tx.db,
    );
    const outcome = payload.status === 'cancelled' ? 'cancelled' : 'modified';
    await record(outcome, true, booking.id);
    await this.pause();
    return { outcome, bookingId: booking.id };
  }
}
