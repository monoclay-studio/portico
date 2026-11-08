/**
 * S19 (Day Close part) — a guest's bill combines packages, allowances and different taxes. Kandu, all-inclusive
 * package (room + board + nightly dining credit for each adult, forfeit; seaplane in on arrival, out on departure),
 * 2 adults + 1 child (8), 2 nights. Day Close posts each night from the sealed agreed terms through rates' posting
 * plan, under each line's stable identity (review P0-1), with taxes from the real Maldives rule pack (service charge
 * + TGST compounding, Green Tax per person-night). Night N's dining credit is granted at N's own close — never before
 * the night exists (review P0-2) — valid the next day (the day the guests wake up to), and closed (unused part
 * forfeited as breakage) at N+1's close or at check-out. The departure transfer is posted right after the advance to its service date, so it is on the folio
 * before the guest checks out (review P2-10). Ledger reconciles to the minor unit.
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
    // Every line of night D posted once under its stable identity (the arrival transfer as "arrival").
    for (const l of n1)
      expect(await entriesByKey(h, org.tenantId, l.lineKey)).toEqual([{ idempotency_key: l.lineKey, n: 1 }]);
    expect(n1.find((l) => l.occurrence.rhythm === 'arrival')?.lineKey).toMatch(/:arrival$/);
    // Taxes follow the rules: room line carries service charge, TGST and Green Tax for 3 persons × USD 12.
    const room = await linesOf(h, org, `room:${s.stayId}:${D}`);
    expect(room.get('tax:green_tax')).toBe(-3_600);
    expect(room.get('tax:tgst')).toBeLessThan(0);
    // Tonight's credit is granted now and usable tomorrow; nothing for D+1 exists yet; nothing is forfeited yet.
    const n2 = plan.filter((l) => l.nightDate === '2026-11-08');
    const credit2 = n2.find((l) => l.kind === 'allowance');
    expect(await entriesByKey(h, org.tenantId, allowanceLine?.lineKey as string)).toHaveLength(1);
    expect(await entriesByKey(h, org.tenantId, credit2?.lineKey as string)).toEqual([]);
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toEqual([]);
    const out = plan.find((l) => l.occurrence.rhythm === 'departure');
    expect(out?.serviceDate).toBe('2026-11-09');
    expect(out?.lineKey).toBe(`inclusion:${s.stayId}:${out?.inclusionId}:departure`);

    // ── Day D+1: lunch and dinner consume the credit and go over it once ──
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
    await dine(9_000, 'dinner'); // goes over what is left of the credit: the excess is payable
    const instances = await h.t.admin.kysely
      .selectFrom('finance.allowance_instances')
      .select(['period_key', 'granted_minor', 'used_minor'])
      .where('stay_id', '=', s.stayId)
      .orderBy('period_key')
      .execute();
    // Night D's credit, granted at D's close and valid the day after (the day the guests wake up to).
    expect(instances).toEqual([{ period_key: '2026-11-08', granted_minor: 10_000, used_minor: 10_000 }]);

    // ── Close of D+1: night D+1 posted with its credit; yesterday's (fully used) credit closes, nothing forfeited;
    //    after the advance the departure transfer lands on the folio with service date D+2, before check-out ──
    h.clock.set(nightOf(1));
    const r2 = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(r2.runStatus).toBe('completed');
    for (const l of n2)
      expect(await entriesByKey(h, org.tenantId, l.lineKey)).toEqual([{ idempotency_key: l.lineKey, n: 1 }]);
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toEqual([]); // fully used: nothing to forfeit
    expect(await entriesByKey(h, org.tenantId, out?.lineKey as string)).toEqual([
      { idempotency_key: out?.lineKey, n: 1 },
    ]);
    const transfer = await h.t.admin.kysely
      .selectFrom('finance.journal_entries')
      .select(['business_date'])
      .where('idempotency_key', '=', out?.lineKey as string)
      .executeTakeFirstOrThrow();
    expect(transfer.business_date).toBe('2026-11-09'); // its service date: no future-dated posting, no late charge
    const expectation = await h.t.admin.kysely
      .selectFrom('day_close.deferred_lines')
      .select(['line_key', 'status', 'service_date'])
      .where('stay_id', '=', s.stayId)
      .execute();
    expect(expectation).toEqual([{ line_key: out?.lineKey, status: 'posted', service_date: '2026-11-09' }]);

    // ── Departure D+2: check-out; the close of D+2 forfeits the unused last credit once; nothing is posted twice ──
    await checkOut(org, s.stayId);
    h.clock.set(nightOf(2));
    const r3 = await h.service.startRun(h.t.db, auditor, { propertyId: org.propertyId });
    expect(r3.runStatus).toBe('completed');
    expect(await entriesByKey(h, org.tenantId, out?.lineKey as string)).toHaveLength(1);
    expect(await entriesByKey(h, org.tenantId, 'breakage:')).toHaveLength(1);

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
