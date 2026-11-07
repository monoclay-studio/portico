/**
 * S19 (Day Close part) — a guest's bill combines packages, allowances and different taxes. Kandu, all-inclusive
 * package (room + board + nightly dining credit for each adult, forfeit; seaplane in on arrival, out on departure),
 * 2 adults + 1 child (8), 2 nights. Day Close posts each night from the sealed agreed terms through rates' posting
 * plan, with taxes from the real Maldives rule pack (service charge + TGST compounding, Green Tax per person-night);
 * allowances are granted for the night (and pre-granted at the start of the next night so guests can use them that
 * day); unused allowance is forfeited (breakage) at that night's close; the departure transfer is posted by the
 * close whose business date reaches its service date. Ledger reconciles to the minor unit.
 */
import { sql } from '@portico/db';
import { money, newId } from '@portico/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addStay,
  assertBooksBalance,
  checkOut,
  D,
  entriesByKey,
  type Harness,
  NIGHT,
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

const DAY = 86_400_000;
const nightOf = (offset: number) => new Date(new Date(NIGHT).getTime() + offset * DAY).toISOString();

async function linesOf(h: Harness, org: Org, key: string) {
  const { rows } = await sql<{ system_key: string | null; amount: number }>`
    select a.system_key, sum(l.amount_minor)::bigint as amount
      from finance.journal_entries e
      join finance.journal_lines l on l.entry_id = e.id
      join finance.accounts a on a.id = l.account_id
     where e.tenant_id = ${org.tenantId} and e.idempotency_key = ${key}
     group by a.system_key`.execute(h.t.admin.kysely);
  return new Map(rows.map((r) => [r.system_key ?? 'revenue', Number(r.amount)]));
}

describe('S19: packages, allowances and taxes posted by Day Close', () => {
  it('posts each night of the package once with the agreed split and taxes; breakage nightly; departure transfer on its date', async () => {
    const org = await setupOrg(h);
    const s = await addStay(h, org, {
      arrival: D,
      departure: '2026-11-09',
      plan: 'AI',
      unitType: 'WV',
      occupancy: { adults: 2, childrenAges: [8] },
    });
    const plan = h.rates.postingPlan(s.terms, s.stayId);
    const n1 = plan.filter((l) => l.nightDate === D);
    expect(n1.map((l) => l.kind).sort()).toEqual(['allowance', 'inclusion', 'inclusion', 'room']);
    const allowanceLine = n1.find((l) => l.kind === 'allowance');
    expect(allowanceLine?.amount).toEqual(money(10_000, 'USD')); // 2 adults × USD 50

    // ── Close of D (arrival night) ──
    const auditor = nightAudit(h, org);
    const r1 = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(r1.runStatus).toBe('completed');
    // Every line of night D posted once with its plan key; the departure transfer waits for its service date.
    for (const l of n1)
      expect(await entriesByKey(h, org.tenantId, l.idempotencyKey)).toEqual([
        { idempotency_key: l.idempotencyKey, n: 1 },
      ]);
    // Taxes follow the rules: room line carries service charge, TGST and Green Tax for 3 persons × USD 12.
    const room = await linesOf(h, org, `room:${s.stayId}:${D}`);
    expect(room.get('tax:green_tax')).toBe(-3_600);
    expect(room.get('tax:tgst')).toBeLessThan(0);
    // Unused dining credit of the arrival night is forfeited at its close (breakage), once.
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toHaveLength(1);
    // After the advance, tonight's (D+1) dining credit is already granted so the guests can use it today.
    const n2 = plan.filter((l) => l.nightDate === '2026-11-08');
    const credit2 = n2.find((l) => l.kind === 'allowance');
    expect(await entriesByKey(h, org.tenantId, credit2?.idempotencyKey as string)).toHaveLength(1);
    expect(r1.steps.find((x) => x.key === 'post_advance')?.detail.allowances).toMatchObject({ granted: 1 });

    // ── Day D+1: dinner consumes the credit and goes over it once ──
    const desk = org.as(['finance.posting.create', 'finance.folio.read']);
    const dine = (amountMinor: number, ref: string) =>
      org.run(
        (tx) =>
          h.finance.postCharge(tx, {
            propertyId: org.propertyId,
            target: { type: 'stay', id: s.stayId },
            chargeCode: 'FB_ALACARTE',
            amount: money(amountMinor, 'USD'),
            serviceDate: '2026-11-08',
            description: 'Overwater grill',
            sourceRef: { type: 'pos_check', id: newId() },
            idempotencyKey: `pos:${ref}`,
            allowanceRef: 'auto',
          }),
        desk,
      );
    const lunch = await dine(3_000, 'lunch');
    expect(lunch.allowanceUsage?.amountMinor).toBeGreaterThan(0);
    await dine(9_000, 'dinner'); // goes over what is left of tonight's credit: the excess is payable
    const instances = await h.t.admin.kysely
      .selectFrom('finance.allowance_instances')
      .select(['period_key', 'granted_minor', 'used_minor', 'status'])
      .where('stay_id', '=', s.stayId)
      .orderBy('period_key')
      .execute();
    expect(instances).toEqual([
      { period_key: D, granted_minor: 10_000, used_minor: 0, status: 'closed' }, // forfeited at the close of D
      { period_key: '2026-11-08', granted_minor: 10_000, used_minor: 10_000, status: 'consumed' },
    ]);

    // ── Close of D+1: the pre-granted credit is replayed (not granted twice); nothing left to forfeit ──
    h.clock.set(nightOf(1));
    const r2 = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(r2.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, credit2?.idempotencyKey as string)).toHaveLength(1);
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toHaveLength(1); // fully used: no second breakage
    const out = plan.find((l) => l.serviceDate === '2026-11-09');
    expect(out).toBeDefined();
    const pending = await h.t.admin.kysely
      .selectFrom('day_close.deferred_lines')
      .select(['idempotency_key', 'status', 'service_date'])
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(pending).toEqual([
      { idempotency_key: out?.idempotencyKey, status: 'pending', service_date: '2026-11-09' },
    ]);

    // ── Departure D+2; the close of D+2 posts the departure transfer once on its service date ──
    await checkOut(org, s.stayId);
    h.clock.set(nightOf(2));
    const r3 = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(r3.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, out?.idempotencyKey as string)).toEqual([
      { idempotency_key: out?.idempotencyKey, n: 1 },
    ]);
    const deferredEntry = await h.t.admin.kysely
      .selectFrom('finance.journal_entries')
      .select(['business_date'])
      .where('idempotency_key', '=', out?.idempotencyKey as string)
      .executeTakeFirstOrThrow();
    expect(deferredEntry.business_date).toBe('2026-11-09');

    // Ledger: trial balance zero; guest ledger = folios; allowance clearing = open allowances.
    const report = await assertBooksBalance(h, org);
    expect(report.checks.find((c) => c.check === 'allowance_clearing_equals_outstanding')?.ok).toBe(true);
    // Every effect once across three closes.
    for (const prefix of ['room:', 'inclusion:', 'breakage:']) {
      expect((await entriesByKey(h, org.tenantId, prefix)).filter((x) => x.n !== 1)).toEqual([]);
    }
    // Postings carry the agreed rule versions (audit: postings with rule-version ids).
    const tg = await sql<{ n: number }>`select count(*)::int as n from finance.postings p
      join finance.journal_entries e on e.id = p.entry_id
      where e.tenant_id = ${org.tenantId} and e.idempotency_key like 'room:%' and p.tax_rule_version_id is not null`.execute(
      h.t.admin.kysely,
    );
    expect(tg.rows[0]?.n).toBeGreaterThan(0);
  });
});
