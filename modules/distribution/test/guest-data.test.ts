/**
 * Guest personal data in stored booking revisions (review P2-7). The revision stays immutable evidence; the only
 * change ever allowed is the redaction of the guest's identity and free text, through the reviewed database
 * function. Paths: a staff privacy action, guests' anonymization (through the lookup port, FR-7 — a strict fake
 * here), and daily retention after the stay. Redeliveries are still recognised (compared by hash).
 */
import { sql, withTenantTx } from '@portico/db';
import { addDays, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as svc from '../src/services';
import {
  BUSINESS_DATE,
  type Connected,
  connect,
  type Harness,
  type Org,
  runFor,
  setupOrg,
  startHarness,
  sys,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const d = (n: number) => addDays(BUSINESS_DATE, n);

/** A booking made at the channel and delivered through the simulated hub (so its acknowledgement succeeds). */
async function booked(org: Org, c: Connected, from: number, to: number) {
  const rev = await h.dist.deps.simulator.addRevision(org.tenantId, c.externalPropertyId, {
    status: 'new',
    notes: 'Honeymoon — allergic to peanuts',
    customer: {
      name: 'Aiko',
      surname: 'Tanaka',
      mail: 'aiko@example.com',
      phone: '+81 3 0000 0000',
      country: 'JP',
    },
    rooms: [
      {
        roomTypeId: 'RT-WV',
        ratePlanId: 'RP-WV-BAR',
        checkin: d(from),
        checkout: d(to),
        adults: 2,
        nightly: Object.fromEntries(Array.from({ length: to - from }, (_, i) => [d(from + i), '500.00'])),
      },
    ],
  });
  await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.id]);
  await runFor(org, 3_000);
  return { revisionId: rev.id, bookingId: rev.booking_id };
}

const row = (org: Org, revisionId: string) =>
  org
    .run((tx) =>
      sql<{
        payload: Record<string, unknown>;
        payload_hash: string;
        redacted_at: Date | null;
        redaction_reason: string | null;
      }>`select payload, payload_hash, redacted_at, redaction_reason from distribution.inbound_revisions where revision_id = ${revisionId}`.execute(
        tx.db,
      ),
    )
    .then((r) => r.rows[0]);

async function ready(settings?: Record<string, unknown>) {
  const org = await setupOrg(h);
  const c = await connect(org, settings ? { settings } : {});
  await runFor(org, 3_000);
  return { org, c };
}

describe('guest data in stored revisions (P2-7)', () => {
  it('a privacy action redacts identity and free text; ids, dates, amounts and the hash stay; a redelivery is still a duplicate', async () => {
    const { org, c } = await ready();
    const rev = await booked(org, c, 30, 33);
    const id = rev.bookingId;
    const before = await row(org, rev.revisionId);
    await expect(
      org.as(['distribution.channel.read'], (tx) =>
        svc.eraseRevisionGuestData(tx, h.dist.deps, c.connectionId, {
          channelBookingIds: [id],
          reason: 'request',
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const r = await org.run((tx) =>
      svc.eraseRevisionGuestData(tx, h.dist.deps, c.connectionId, {
        channelBookingIds: [id],
        reason: 'Guest erasure request PR-1',
      }),
    );
    expect(r).toEqual({ redacted: 1, revisions: 1 });
    const after = await row(org, rev.revisionId);
    expect(after?.payload).toMatchObject({ customer: null, notes: null, redacted: true, bookingId: id });
    expect(JSON.stringify(after?.payload)).not.toContain('Tanaka');
    expect(JSON.stringify(after?.payload)).not.toContain('peanuts');
    expect(after?.payload.rooms).toHaveLength(1);
    expect(after?.payload_hash).toBe(before?.payload_hash);
    expect(after?.redaction_reason).toBe('erasure');
    // Idempotent.
    const again = await org.run((tx) =>
      svc.eraseRevisionGuestData(tx, h.dist.deps, c.connectionId, {
        channelBookingIds: [id],
        reason: 'again',
      }),
    );
    expect(again.redacted).toBe(0);
    // The hub resends the original: recognised by hash (duplicate), not a conflict, and nothing is re-stored.
    const [dup] = await h.dist.deps.simulator.deliver(org.tenantId, c.externalPropertyId, [rev.revisionId]);
    expect(dup?.status).toBe(200);
    const exc = await org.run((tx) =>
      svc.listExceptions(tx, { connectionId: c.connectionId, status: 'open' }),
    );
    expect(exc.map((e) => e.code)).not.toContain('revision_conflict');
    expect(JSON.stringify((await row(org, rev.revisionId))?.payload)).not.toContain('Tanaka');
  });

  it('nothing else can change or delete a revision: not the application, not even the owner bypassing the function', async () => {
    const { org, c } = await ready();
    const rev = await booked(org, c, 30, 31);
    await expect(
      org.run((tx) =>
        sql`update distribution.inbound_revisions set channel_status = 'cancelled' where revision_id = ${rev.revisionId}`.execute(
          tx.db,
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' }); // no grant
    await expect(
      sql`update distribution.inbound_revisions set channel_status = 'cancelled' where revision_id = ${rev.revisionId}`.execute(
        h.t.admin.kysely,
      ),
    ).rejects.toMatchObject({ code: 'P0001' }); // the trigger
    await expect(
      sql`update distribution.inbound_revisions set payload = '{}'::jsonb, redacted_at = now(), redaction_reason = 'erasure' where revision_id = ${rev.revisionId}`.execute(
        h.t.admin.kysely,
      ),
    ).rejects.toMatchObject({ code: 'P0001' }); // a "redaction" that is not THE redaction
    await expect(
      sql`delete from distribution.inbound_revisions where revision_id = ${rev.revisionId}`.execute(
        h.t.admin.kysely,
      ),
    ).rejects.toMatchObject({ code: 'P0001' });
  });

  it('guests’ anonymization reaches the stored revisions of the guest’s channel bookings (through the lookup port)', async () => {
    const { org, c } = await ready();
    const rev = await booked(org, c, 30, 32);
    const id = rev.bookingId;
    const profileId = newId();
    h.guestLinks.set(profileId, [{ connectionId: c.connectionId, externalId: id }]);
    await withTenantTx(h.t.db, sys(org), (tx) =>
      tx.emit({
        type: 'guests.profile.anonymized',
        propertyId: null,
        aggregate: { type: 'guest_profile', id: profileId },
        payload: { profileId, privacyRequestId: newId(), alsoAnonymized: [] },
      }),
    );
    await h.drain();
    expect((await row(org, rev.revisionId))?.payload).toMatchObject({ customer: null, notes: null });
  });

  it('retention: settled revisions are redacted once the stay ended more than the retention period ago (nightly step)', async () => {
    const { org, c } = await ready({ guestDataRetentionDays: 1 });
    const past = await booked(org, c, -10, -8);
    const future = await booked(org, c, 30, 32);
    // The nightly step runs (full resync due).
    await withTenantTx(h.t.db, sys(org), (tx) =>
      sql`update distribution.connections set next_full_sync_at = ${h.clock.now()} where id = ${c.connectionId}::uuid`.execute(
        tx.db,
      ),
    );
    await runFor(org, 2_000);
    expect(await row(org, past.revisionId)).toMatchObject({ redaction_reason: 'retention' });
    expect((await row(org, past.revisionId))?.payload).toMatchObject({ customer: null });
    expect((await row(org, future.revisionId))?.redacted_at).toBeNull();
  });
});
