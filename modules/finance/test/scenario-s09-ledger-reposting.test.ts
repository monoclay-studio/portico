import { IdempotencyConflictError } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertLedgerIntegrity, type Harness, openStay, setupOrg, startHarness, usd } from './helpers';

/**
 * S09 (ledger part) — Day Close stops after some room charges were posted. The re-run posts only the missing
 * nights: re-posting the same night with the same deterministic key (`room:{stayId}:{night}`) is a no-op that
 * returns the original postings; the trial balance stays balanced throughout.
 */
let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('S09: interrupted Day Close re-run never posts twice', () => {
  it('posts only the missing nights and replays the rest', async () => {
    const org = await setupOrg(h);
    const stays = [await openStay(h, org), await openStay(h, org), await openStay(h, org)];
    const night = '2026-11-07';
    const postRoom = (stayId: string) =>
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: stayId },
          chargeCode: 'ROOM',
          amount: usd(25000),
          quantity: 1,
          serviceDate: night,
          description: `Room night ${night}`,
          sourceRef: { type: 'stay', id: stayId },
          idempotencyKey: `room:${stayId}:${night}`,
          occupancy: { adults: 2, childrenAges: [5] },
        }),
      );
    // First run: interrupted after two stays.
    const first = [];
    for (const s of stays.slice(0, 2)) first.push(await postRoom(s.stayId));
    const tbMid = await org.run((tx) => h.finance.trialBalance(tx, { legalEntityId: org.legalEntityId }));
    expect(tbMid.balanced).toBe(true);

    // Re-run over every stay.
    const rerun = [];
    for (const s of stays) rerun.push(await postRoom(s.stayId));
    expect(rerun[0]).toMatchObject({
      replayed: true,
      entryId: first[0]?.entryId,
      postingIds: first[0]?.postingIds,
    });
    expect(rerun[1]).toMatchObject({ replayed: true, entryId: first[1]?.entryId });
    expect(rerun[2]?.replayed).toBe(false);

    // Concurrent duplicates of the same night produce exactly one entry.
    const extra = await openStay(h, org);
    const results = await Promise.all([
      postRoom(extra.stayId),
      postRoom(extra.stayId),
      postRoom(extra.stayId),
    ]);
    expect(new Set(results.map((r) => r.entryId)).size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);

    for (const s of [...stays, extra]) {
      const f = await org.run((tx) => h.finance.getFolio(tx, s.guestFolioId));
      // 250.00 + 25.00 SC + 46.75 TGST + Green Tax 3 guests × 12.00
      expect(f.balance.amountMinor).toBe(25000 + 2500 + 4675 + 3600);
      expect(f.postings.filter((p) => p.kind === 'charge')).toHaveLength(1);
    }

    // The same key with different content is refused (never silently re-priced).
    await expect(
      org.run((tx) =>
        h.finance.postCharge(tx, {
          propertyId: org.propertyId,
          target: { type: 'stay', id: (stays[0] as (typeof stays)[number]).stayId },
          chargeCode: 'ROOM',
          amount: usd(99900),
          quantity: 1,
          serviceDate: night,
          description: `Room night ${night}`,
          sourceRef: { type: 'stay', id: (stays[0] as (typeof stays)[number]).stayId },
          idempotencyKey: `room:${(stays[0] as (typeof stays)[number]).stayId}:${night}`,
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await assertLedgerIntegrity(h, org);
    const checks = await org.run((tx) =>
      h.finance.getUnbalancedItems(tx, { propertyId: org.propertyId, businessDate: night }),
    );
    expect(checks.filter((c) => c.severity === 'blocking')).toEqual([]);
  });
});
