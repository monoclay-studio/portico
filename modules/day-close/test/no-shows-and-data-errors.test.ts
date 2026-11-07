/**
 * No-shows per policy (DCL-R02.2, EC-DCL-011): the fee comes from the agreed terms through rates' cancellation
 * evaluation and is posted once; any CHARGE goes only through payments and only on the agreed guarantee
 * (ADR-0015 Amendment 1) — otherwise a follow-up for a person with payment rights. Data errors (EC-DCL-015): one
 * stay with invalid terms never stops the others; the run cannot advance until fixed or overridden with a reason.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SimulatedCrash } from '../src';
import {
  addStay,
  assertBooksBalance,
  businessDate,
  D,
  entriesByKey,
  type Harness,
  nightAudit,
  type Org,
  setupOrg,
  startHarness,
} from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.close());

async function setNoShowPolicy(org: Org, noShow: Record<string, unknown>) {
  await org.run(async (tx) => {
    const p = await h.service.getPolicy(tx, org.propertyId);
    await h.service.updatePolicy(
      tx,
      org.propertyId,
      { policy: { noShow }, reason: 'test policy' },
      p.version,
    );
  });
}

describe('no-shows per policy', () => {
  it('auto: records each no-show once with the agreed fee; collects only on an agreed guarantee, else a follow-up', async () => {
    const org = await setupOrg(h);
    const agreed = await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    const notAgreed = await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    const offline = await addStay(h, org, {
      arrival: '2026-11-06',
      departure: '2026-11-09',
      status: 'expected',
    });
    h.fakes.payments.agreedGuarantee.set(agreed.bookingId, 'cardholder_supplied');
    const auditor = nightAudit(h, org);
    let calls = 0;
    const original = h.ports.reservations.markNoShow;
    h.ports.reservations.markNoShow = (tx, input) => {
      calls++;
      return original(tx, input);
    };
    // Crash after the first no-show; then the collection connector is down for the third.
    const collectBefore = h.ports.payments.collectAgreedNoShowFee;
    h.ports.payments.collectAgreedNoShowFee = async (tx, input) => {
      if (input.stayId === offline.stayId) {
        const { ModuleUnavailableError } = await import('@portico/kernel');
        throw new ModuleUnavailableError('payments', 'collectAgreedNoShowFee');
      }
      return collectBefore(tx, input);
    };
    try {
      await expect(
        h.service.startRun(h.t.db, auditor, {
          propertyId: org.propertyId,
          hooks: {
            afterItem: (s, i) => {
              if (s === 'no_shows' && i === 1) throw new SimulatedCrash('after first no-show');
            },
          },
        }),
      ).rejects.toBeInstanceOf(SimulatedCrash);
      const [run] = await org.run((tx) => h.service.listRuns(tx, org.propertyId, { limit: 1 }), auditor);
      h.clock.advance(3 * 60_000);
      const done = await h.service.resumeRun(h.t.db, auditor, run?.id as string, run?.version as number);
      expect(done.runStatus).toBe('completed');
    } finally {
      h.ports.reservations.markNoShow = original;
      h.ports.payments.collectAgreedNoShowFee = collectBefore;
    }
    expect(calls).toBe(3); // resume never re-asks for the first no-show
    // Fee = rates' evaluation of the agreed terms (BAR flexible: first night), posted once per stay.
    for (const s of [agreed, notAgreed, offline]) {
      const expected = h.rates.evaluateCancellationPenalty(s.terms, h.clock.now(), {
        event: 'no_show',
      }).amount;
      expect(expected.amountMinor).toBeGreaterThan(0);
      expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${s.stayId}`)).toHaveLength(1);
      const posted = await h.t.admin.kysely
        .selectFrom('finance.postings as p')
        .innerJoin('finance.journal_entries as e', 'e.id', 'p.entry_id')
        .select((eb) => eb.fn.sum<number>('p.amount_minor').as('total'))
        .where('e.idempotency_key', '=', `penalty:no_show:${s.stayId}`)
        .executeTakeFirstOrThrow();
      expect(Number(posted.total)).toBe(expected.amountMinor);
    }
    // Charged only where the guarantee was agreed, once.
    expect(h.fakes.payments.collections.map((c) => [c.stayId, c.key])).toEqual([
      [agreed.stayId, `noshow-fee:${agreed.stayId}`],
    ]);
    const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId), auditor);
    const toCollect = issues.filter((i) => i.code === 'no_show_fee_to_collect').map((i) => i.ref?.id);
    expect(toCollect.sort()).toEqual([notAgreed.stayId, offline.stayId].sort());
    expect(issues.find((i) => i.ref?.id === offline.stayId)?.message).toMatch(/not connected yet/);
    expect(issues.find((i) => i.ref?.id === notAgreed.stayId)?.owner).toEqual({
      kind: 'department',
      id: 'finance',
    });
    // Someone collects it by payment link and marks the follow-up handled, with a note.
    const one = issues.find((i) => i.ref?.id === notAgreed.stayId);
    const resolved = await org.run(
      (tx) =>
        h.service.resolveIssue(tx, one?.id as string, one?.version as number, 'Paid by payment link PL-2231'),
      auditor,
    );
    expect(resolved.status).toBe('resolved');
    await assertBooksBalance(h, org);
  });

  it('collectFee "never": the fee is posted to the folio but no collection is ever requested, and no card is touched', async () => {
    const org = await setupOrg(h);
    const a = await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    h.fakes.payments.agreedGuarantee.set(a.bookingId, 'mandate');
    await setNoShowPolicy(org, { mode: 'auto', protectDelayedTransfers: true, collectFee: 'never' });
    const before = h.fakes.payments.collections.length;
    const run = await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    expect(run.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${a.stayId}`)).toHaveLength(1);
    expect(h.fakes.payments.collections.length).toBe(before);
    const issues = await org.run((tx) => h.service.listIssues(tx, org.propertyId), org.auditor);
    expect(issues.filter((i) => i.code === 'no_show_fee_to_collect')).toEqual([]);
  });

  it('decide: every due arrival blocks until decided; "keep expected" with a reason means no no-show and no fee', async () => {
    const org = await setupOrg(h);
    const a = await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    await setNoShowPolicy(org, { mode: 'decide', protectDelayedTransfers: true, collectFee: 'never' });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('blocked');
    expect(run.blockers.map((b) => b.code)).toEqual(['arrival_not_checked_in']);
    const after = await org.run(
      (tx) =>
        h.service.overrideItem(tx, run.id, {
          itemKey: run.blockers[0]?.key as string,
          reason: 'Guest called: arriving on the first seaplane tomorrow, keep the room',
        }),
      auditor,
    );
    const done = await h.service.resumeRun(h.t.db, auditor, run.id, after.version);
    expect(done.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, `penalty:no_show:${a.stayId}`)).toEqual([]);
    expect(done.steps.find((s) => s.key === 'no_shows')?.done).toBe(1);
  });

  it('off: the no-show step is skipped and the arrival rolls over; complimentary no-shows carry no fee', async () => {
    const org = await setupOrg(h);
    await addStay(h, org, { arrival: D, departure: '2026-11-09', status: 'expected' });
    await setNoShowPolicy(org, { mode: 'off', protectDelayedTransfers: true, collectFee: 'never' });
    const run = await h.service.startRun(h.t.db, nightAudit(h, org), { propertyId: org.propertyId });
    expect(run.runStatus).toBe('completed');
    expect(run.steps.find((s) => s.key === 'no_shows')?.status).toBe('skipped');
    expect(await entriesByKey(h, org.tenantId, 'penalty:')).toEqual([]);
  });
});

describe('data errors never stop the other stays (EC-DCL-015)', () => {
  it('a stay with tampered terms fails alone; the run cannot advance until it is fixed or overridden with a reason', async () => {
    const org = await setupOrg(h);
    const good = [
      await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' }),
      await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' }),
    ];
    const bad = await addStay(h, org, {
      arrival: '2026-11-06',
      departure: '2026-11-09',
      mutateTerms: (t) => ({
        ...t,
        nights: t.nights.map((n) => ({ ...n, amount: { ...n.amount, amountMinor: 1 } })),
      }),
    });
    const auditor = nightAudit(h, org);
    const run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(run.runStatus).toBe('failed');
    expect(run.failure).toMatchObject({
      step: 'room_and_package_postings',
      code: 'items_failed',
      retryable: false,
    });
    const step = run.steps.find((s) => s.key === 'room_and_package_postings');
    expect(step).toMatchObject({ done: 2, failed: 1 });
    expect(step?.failedItems).toEqual([
      expect.objectContaining({
        itemKey: `item:room_and_package_postings:night:${bad.stayId}:${D}`,
        code: 'terms_seal_invalid',
        retryable: false,
        overridden: false,
      }),
    ]);
    for (const g of good) expect(await entriesByKey(h, org.tenantId, `room:${g.stayId}`)).toHaveLength(1);
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}`)).toEqual([]);
    expect(await businessDate(org)).toBe(D);
    // The readiness list shows it as a blocking follow-up with its fixes.
    const ready = await org.run((tx) => h.service.getReadiness(tx, org.propertyId), auditor);
    const item = ready.blocking.find((i) => i.code === 'step_item_failed');
    expect(item?.ref).toEqual({ type: 'stay', id: bad.stayId });
    expect(item?.actions.map((a) => a.action)).toEqual(['resume', 'resolveIssue', 'override']);
    // Resume without a fix: only the failed item is retried, and it fails again.
    const again = await h.service.resumeRun(h.t.db, auditor, run.id, run.version);
    expect(again.runStatus).toBe('failed');
    expect(again.steps.find((s) => s.key === 'room_and_package_postings')?.attempts).toBe(2);
    // Override that one stay-night with a reason; the close completes and the follow-up closes itself.
    const ov = await org.run(
      (tx) =>
        h.service.overrideItem(tx, run.id, {
          itemKey: `item:room_and_package_postings:night:${bad.stayId}:${D}`,
          reason: 'Price under review by revenue; the night will be posted by hand tomorrow',
        }),
      auditor,
    );
    const done = await h.service.resumeRun(h.t.db, auditor, run.id, ov.version);
    expect(done.runStatus).toBe('completed');
    expect(done.steps.find((s) => s.key === 'room_and_package_postings')).toMatchObject({
      done: 2,
      skipped: 1,
      failed: 0,
    });
    expect(await entriesByKey(h, org.tenantId, `room:${bad.stayId}`)).toEqual([]);
    const open = await org.run((tx) => h.service.listIssues(tx, org.propertyId, 'open'), auditor);
    expect(open.filter((i) => i.code === 'step_item_failed')).toEqual([]);
    const report = await org.run((tx) => h.service.getReport(tx, org.propertyId, D), auditor);
    expect(report.pack.overrides[0]).toMatchObject({ code: 'terms_seal_invalid' });
    await assertBooksBalance(h, org);
  });

  it('a transient finance outage fails the step retryably; the resume posts only what is missing', async () => {
    const org = await setupOrg(h);
    for (let i = 0; i < 3; i++) await addStay(h, org, { arrival: '2026-11-06', departure: '2026-11-09' });
    const auditor = nightAudit(h, org);
    const original = h.ports.finance.postCharge;
    let n = 0;
    h.ports.finance.postCharge = async (tx, scope, input) => {
      if (input.idempotencyKey.startsWith('room:') && ++n === 2) {
        const { ModuleUnavailableError } = await import('@portico/kernel');
        throw new ModuleUnavailableError('finance', 'postCharge');
      }
      return original(tx, scope, input);
    };
    let run: Awaited<ReturnType<typeof h.service.startRun>>;
    try {
      run = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    } finally {
      h.ports.finance.postCharge = original;
    }
    expect(run.runStatus).toBe('failed');
    expect(run.failure).toMatchObject({ code: 'items_failed', retryable: true });
    expect(run.summary).toMatch(/Resume continues from there/);
    const done = await h.service.resumeRun(h.t.db, auditor, run.id, run.version);
    expect(done.runStatus).toBe('completed');
    expect((await entriesByKey(h, org.tenantId, 'room:')).map((r) => r.n)).toEqual([1, 1, 1]);
  });
});
