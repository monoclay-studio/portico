/**
 * Day-close fix round 1 — the steward reviewer's money probes as regression tests (review P0-1, P0-2, P1-1, P2-8,
 * P2-11). Real platform, rates and finance; reservations' re-pricing is the harness `requote` (new sealed terms from a
 * real quote, the stay event delivered to Day Close's consumer). Each test failed on the reviewed commit.
 */
import { sql } from '@portico/db';
import { IdempotencyConflictError, money, newId, VersionConflictError } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toFailure } from '../src/domain/errors';
import {
  addStay,
  checkOut,
  D,
  entriesByKey,
  type Harness,
  NIGHT,
  nightAudit,
  type Org,
  requote,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

const DAY = 86_400_000;
const nightOf = (offset: number) => new Date(new Date(NIGHT).getTime() + offset * DAY).toISOString();
const AI2 = { plan: 'AI' as const, unitType: 'WV' as const, occupancy: { adults: 2, childrenAges: [] } };

async function folioLines(org: Org, stayId: string) {
  const { rows } = await sql<{ charge_code: string | null; kind: string; amount: string; key: string }>`
    select p.charge_code, p.kind, p.amount_minor::text as amount, e.idempotency_key as key
      from finance.postings p
      join finance.folios f on f.id = p.folio_id
      join finance.journal_entries e on e.id = p.entry_id
     where f.tenant_id = ${org.tenantId} and f.owner_type = 'stay' and f.owner_id = ${stayId}
     order by e.idempotency_key`.execute(h.t.admin.kysely);
  return rows;
}

const transfers = async (org: Org, stayId: string) =>
  (await folioLines(org, stayId)).filter((l) => l.charge_code === 'TRANSFER_SEAPLANE' && l.kind === 'charge');

async function close(org: Org, offset: number) {
  h.clock.set(nightOf(offset));
  return h.service.startRun(h.t.db, org.auditor, { propertyId: org.propertyId });
}

describe('P0-1: a package line moved by re-pricing is posted once, by what it is', () => {
  it('R-DEFER: a cancelled seaplane (stay extended after the last night closed) never charges the departure twice', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: D, departure: '2026-11-09', ...AI2 });
    nightAudit(h, org);
    expect((await close(org, 0)).runStatus).toBe('completed');
    expect((await close(org, 1)).runStatus).toBe('completed');
    // The departure transfer is on the folio before check-out (posted right after the advance to 9 Nov, P2-10).
    expect(await transfers(org, s.stayId)).toHaveLength(2);
    // 9 Nov: the seaplane is cancelled; front office extends the stay by one night; the price is re-confirmed.
    await requote(h, org, s.stayId, { arrival: D, departure: '2026-11-10', ...AI2 });
    expect((await close(org, 2)).runStatus).toBe('completed');
    // Day Close never charges it twice; it says that what was charged now has another service date.
    const changed = (
      await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), org.auditor)
    ).filter((i) => i.code === 'posted_line_changed' && i.ref?.id === s.stayId);
    expect(changed).toHaveLength(1);
    expect(changed[0]?.details).toMatchObject({
      postedServiceDate: '2026-11-09',
      nowServiceDate: '2026-11-10',
    });
    await checkOut(org, s.stayId);
    expect((await close(org, 3)).runStatus).toBe('completed');
    // One arrival seaplane + one departure seaplane were flown; two are charged (the reviewed commit charged three).
    expect(await transfers(org, s.stayId)).toHaveLength(2);
    expect((await entriesByKey(h, org.tenantId, 'inclusion:')).filter((r) => r.n !== 1)).toEqual([]);
  });

  it('an extension before the departure line was posted moves it to the new last night: charged once, on its new date', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: D, departure: '2026-11-09', ...AI2 });
    nightAudit(h, org);
    expect((await close(org, 0)).runStatus).toBe('completed');
    // 8 Nov, before the close: two more nights.
    await requote(h, org, s.stayId, { arrival: D, departure: '2026-11-11', ...AI2 });
    for (const day of [1, 2]) expect((await close(org, day)).runStatus).toBe('completed');
    expect(await transfers(org, s.stayId)).toHaveLength(1); // the arrival only: the departure is now 11 Nov
    const pending = await h.t.admin.kysely
      .selectFrom('day_close.deferred_lines')
      .select(['service_date', 'status'])
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(pending).toEqual([{ service_date: '2026-11-11', status: 'pending' }]);
    expect((await close(org, 3)).runStatus).toBe('completed');
    const lines = await transfers(org, s.stayId);
    expect(lines).toHaveLength(2);
    const out = await h.t.admin.kysely
      .selectFrom('finance.journal_entries')
      .select(['business_date', 'idempotency_key'])
      .where('tenant_id', '=', org.tenantId)
      .where('idempotency_key', 'like', `inclusion:${s.stayId}:%:departure`)
      .execute();
    expect(out).toHaveLength(1);
    expect(out[0]?.business_date).toBe('2026-11-11');
  });

  it('a shortened stay still charges the departure transfer that was flown — once (agreement lookup connected)', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: D, departure: '2026-11-10', ...AI2 });
    nightAudit(h, org);
    expect((await close(org, 0)).runStatus).toBe('completed');
    // 8 Nov: the guests leave after one night (the new terms put the departure transfer on night 7 Nov, already closed).
    await requote(h, org, s.stayId, { arrival: D, departure: '2026-11-08', ...AI2 });
    await checkOut(org, s.stayId);
    expect((await close(org, 1)).runStatus).toBe('completed');
    expect((await close(org, 2)).runStatus).toBe('completed');
    const lines = await transfers(org, s.stayId);
    expect(lines).toHaveLength(2); // arrival + departure (the reviewed commit never charged the departure)
    const deferred = await h.t.admin.kysely
      .selectFrom('day_close.deferred_lines')
      .select(['status'])
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(deferred).toEqual([{ status: 'posted' }]);
  });

  it('while the agreement lookup is not connected (main): the last known line is posted on its date, flagged', async () => {
    const org = await setupOrg(h);
    h.fakes.reservations.connected = false;
    try {
      const s = await addStay(h, org, { arrival: D, departure: '2026-11-10', ...AI2 });
      nightAudit(h, org);
      expect((await close(org, 0)).runStatus).toBe('completed');
      await requote(h, org, s.stayId, { arrival: D, departure: '2026-11-08', ...AI2 });
      await checkOut(org, s.stayId);
      for (const day of [1, 2]) expect((await close(org, day)).runStatus).toBe('completed');
      expect(await transfers(org, s.stayId)).toHaveLength(2);
      const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), org.auditor);
      expect(issues.filter((i) => i.code === 'posted_from_last_known_agreement')).toHaveLength(1);
    } finally {
      h.fakes.reservations.connected = true;
    }
  });
});

describe('P0-2: no allowance before its night exists; a correction never rolls the night back', () => {
  it('R-PREGRANT: an occupancy correction is posted from the corrected agreement — no idempotency conflict, room charged', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: D, departure: '2026-11-10', ...AI2 });
    nightAudit(h, org);
    const r1 = await close(org, 0);
    expect(r1.runStatus).toBe('completed');
    // Nothing for 8 Nov exists after the close of 7 Nov (the reviewed commit pre-granted its dining credit).
    expect((await folioLines(org, s.stayId)).filter((l) => l.key.endsWith(':2026-11-08'))).toEqual([]);
    // 8 Nov: one adult leaves; the price is re-confirmed for one adult (dining credit 50 instead of 100).
    await requote(h, org, s.stayId, {
      arrival: D,
      departure: '2026-11-10',
      plan: 'AI',
      unitType: 'WV',
      occupancy: { adults: 1, childrenAges: [] },
    });
    const r2 = await close(org, 1);
    expect(r2.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `room:${s.stayId}:2026-11-08`)).toHaveLength(1);
    const credit = (await folioLines(org, s.stayId)).filter(
      (l) => l.charge_code === 'ALLOWANCE_DINING' && l.kind === 'charge' && l.key.endsWith(':2026-11-08'),
    );
    expect(credit.map((c) => Number(c.amount))).toEqual([5_000]);
  });

  it('R-PREGRANT: an early departure leaves nothing on the folio for the night it did not stay', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: D, departure: '2026-11-10', ...AI2 });
    nightAudit(h, org);
    expect((await close(org, 0)).runStatus).toBe('completed');
    // 8 Nov, 10:00: the guests leave early (one night) and check out; finance's check-out consumer closes allowances.
    await requote(h, org, s.stayId, { arrival: D, departure: '2026-11-08', ...AI2 });
    await checkOut(org, s.stayId);
    await org.run((tx) => h.finance.closeAllowances(tx, { stayId: s.stayId, upTo: '9999-12-31' }));
    expect((await close(org, 1)).runStatus).toBe('completed');
    const lines = await folioLines(org, s.stayId);
    // Nothing keyed to the night of 8 Nov (the reviewed commit billed USD 128.70 and forfeited it to breakage).
    expect(lines.filter((l) => l.key.endsWith(':2026-11-08'))).toEqual([]);
    // The night of 7 Nov was stayed: its credit (valid on 8 Nov, the departure morning) is the only one.
    const instances = await h.t.admin.kysely
      .selectFrom('finance.allowance_instances')
      .select(['period_key'])
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(instances).toEqual([{ period_key: '2026-11-08' }]);
    expect(await entriesByKey(h, org.tenantId, `room:${s.stayId}:2026-11-08`)).toEqual([]);
  });

  it('finance holding a line key with other content: the line is set aside with a follow-up, the night is posted, not retryable', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-10', ...AI2 });
    const plan = h.rates.postingPlan(s.terms, s.stayId);
    const board = plan.find((l) => l.nightDate === D && l.kind === 'inclusion');
    expect(board).toBeDefined();
    // Someone posted the board line's key with different content before the close (e.g. before a guest-count change).
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: s.stayId },
        chargeCode: board?.chargeCode as string,
        amount: money(1_234, 'USD'),
        serviceDate: D,
        description: 'Board (posted earlier with other details)',
        sourceRef: { type: 'manual', id: newId() },
        idempotencyKey: board?.lineKey as string,
      }),
    );
    nightAudit(h, org);
    const run = await close(org, 0);
    expect(run.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `room:${s.stayId}:${D}`)).toHaveLength(1);
    const reg = await h.t.admin.kysely
      .selectFrom('day_close.line_postings')
      .select(['outcome'])
      .where('stay_id', '=', s.stayId)
      .where('line_key', '=', board?.lineKey as string)
      .execute();
    expect(reg).toEqual([{ outcome: 'conflict' }]);
    const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), org.auditor);
    expect(issues.filter((i) => i.code === 'posting_conflict' && i.ref?.id === s.stayId)).toHaveLength(1);
  });

  it('a deterministic conflict is never classified retryable; a concurrent change still is', () => {
    expect(toFailure(new IdempotencyConflictError('held with other content')).retryable).toBe(false);
    expect(toFailure(new VersionConflictError('run', 'x', 1, 2)).retryable).toBe(true);
  });
});

describe('P1-1: a night a person took over is a decision, never a gap the catch-up fills', () => {
  async function overriddenNight(org: Org) {
    const bad = await addStay(h, org, {
      arrival: '2026-11-06',
      departure: '2026-11-10',
      mutateTerms: (t) => ({
        ...t,
        nights: t.nights.map((n) => ({ ...n, amount: { ...n.amount, amountMinor: 1 } })),
      }),
    });
    nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, org.auditor, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('failed');
    const ov = await org.run(
      (tx) =>
        h.service.overrideItem(tx, run.id, {
          itemKey: `item:room_and_package_postings:night:${bad.stayId}:${D}`,
          reason: 'Price under review by revenue',
        }),
      org.auditor,
    );
    // The decision it asks for does not block tonight's close (the override is tonight's decision).
    expect((await h.service.resumeRun(h.t.db, org.auditor, run.id, ov.version)).runStatus).toBe('completed');
    // The price is re-confirmed the next morning (valid seal again).
    await requote(h, org, bad.stayId, {
      arrival: '2026-11-06',
      departure: '2026-11-10',
      occupancy: { adults: 2, childrenAges: [] },
    });
    return bad;
  }

  it('R-CATCHUP: overridden and charged by hand → the next close asks, and "charged another way" means never posted', async () => {
    const org = await setupOrg(h);
    const bad = await overriddenNight(org);
    // Revenue posts the night by hand.
    await org.run((tx) =>
      h.finance.postCharge(tx, {
        propertyId: org.propertyId,
        target: { type: 'stay', id: bad.stayId },
        chargeCode: 'ROOM',
        amount: money(50_000, 'USD'),
        serviceDate: D,
        description: `Room — night ${D} (by hand)`,
        sourceRef: { type: 'manual', id: newId() },
        idempotencyKey: `manual:${bad.stayId}:${D}`,
        reason: 'Night left out of Day Close; posted by hand',
        occupancy: { adults: 2, childrenAges: [] },
      }),
    );
    const next = await close(org, 1);
    // The next close stops on the decision instead of posting the night a second time.
    expect(next.runStatus).toBe('blocked');
    expect(next.blockers.map((b) => b.code)).toContain('night_decision_needed');
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}:${D}`)).toEqual([]);
    await org.run(
      (tx) =>
        h.service.decideNight(tx, org.propertyId, {
          stayId: bad.stayId,
          night: D,
          decision: 'posted_elsewhere',
          reason: 'Charged by hand by revenue (manual posting)',
        }),
      org.auditor,
    );
    const done = await h.service.resumeRun(h.t.db, org.auditor, next.id, next.version);
    expect(done.runStatus).toBe('completed');
    // One room charge for the night: the hand posting (the reviewed commit charged it twice).
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}:${D}`)).toEqual([]);
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}:2026-11-08`)).toHaveLength(1);
  });

  it('overridden and not charged → "Day Close posts it" posts the night once, with the plan key', async () => {
    const org = await setupOrg(h);
    const bad = await overriddenNight(org);
    const next = await close(org, 1);
    expect(next.runStatus).toBe('blocked');
    await org.run(
      (tx) =>
        h.service.decideNight(tx, org.propertyId, {
          stayId: bad.stayId,
          night: D,
          decision: 'post_by_day_close',
          reason: 'Price confirmed; nobody charged it',
        }),
      org.auditor,
    );
    expect((await h.service.resumeRun(h.t.db, org.auditor, next.id, next.version)).runStatus).toBe(
      'completed',
    );
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}:${D}`)).toEqual([
      { idempotency_key: `room:${bad.stayId}:${D}`, n: 1 },
    ]);
    // A decision is never taken twice.
    await expect(
      org.run(
        (tx) =>
          h.service.decideNight(tx, org.propertyId, {
            stayId: bad.stayId,
            night: D,
            decision: 'posted_elsewhere',
            reason: 'again',
          }),
        org.auditor,
      ),
    ).rejects.toMatchObject({ code: 'no_decision_pending' });
  });

  it('deciding needs the sensitive override permission at the property', async () => {
    const org = await setupOrg(h);
    const bad = await overriddenNight(org);
    await expect(
      org.run(
        (tx) =>
          h.service.decideNight(tx, org.propertyId, {
            stayId: bad.stayId,
            night: D,
            decision: 'post_by_day_close',
            reason: 'try',
          }),
        org.as(['dayClose.run.read', 'dayClose.run.start']),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('P2-8 (R1): terms failing their seal never grant an allowance or post a line', () => {
  it('tampered all-inclusive terms: no dining credit, no room, no departure transfer', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-09',
      ...AI2,
      mutateTerms: (t) => ({
        ...t,
        nights: t.nights.map((n) => ({ ...n, amount: { ...n.amount, amountMinor: 7 } })),
      }),
    });
    expect(h.rates.verifyTerms(s.terms)).toBe(false);
    expect(h.rates.postingPlan(s.terms, s.stayId).some((l) => l.kind === 'allowance')).toBe(true);
    nightAudit(h, org);
    const run = await close(org, 0);
    expect(run.runStatus).toBe('failed');
    expect(await folioLines(org, s.stayId)).toEqual([]);
    const instances = await h.t.admin.kysely
      .selectFrom('finance.allowance_instances')
      .select('id')
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(instances).toEqual([]);
  });
});

describe('P2-11: a zero-price night still owes its statutory levy — and says so', () => {
  it('a complimentary night raises levy_not_posted with the levy amount, owned by finance', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, {
      arrival: '2026-11-06',
      departure: '2026-11-09',
      commercialType: 'complimentary',
    });
    const comp = await org.run((tx) =>
      h.rates.overridePrice(tx, { terms: s.terms, override: { kind: 'complimentary' }, reason: 'GM guest' }),
    );
    await org.run((tx) =>
      sql`update dcl_fake.stays set segments = ${JSON.stringify([{ from: '2026-11-06', to: '2026-11-09', terms: comp }])}::jsonb
          where id = ${s.stayId}`.execute(tx.db),
    );
    nightAudit(h, org);
    expect((await close(org, 0)).runStatus).toBe('completed');
    const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), org.auditor);
    const levy = issues.find((i) => i.code === 'levy_not_posted' && i.ref?.id === s.stayId);
    expect(levy?.owner).toMatchObject({ kind: 'department', id: 'finance' });
    expect((levy?.details.levy as { amountMinor: number }).amountMinor).toBe(2_400); // Green Tax 2 × USD 12
  });
});
