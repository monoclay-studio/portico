import { sql } from '@portico/db';
import { newId } from '@portico/kernel';
import { platform } from '@portico/platform';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newOrg, type Org, startDb } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

const UT = () => newId();

async function basePlanWithPolicy(o: Org, code = 'BAR') {
  return o.run(async (tx, r) => {
    const cancel = await r.createPolicy(tx, {
      kind: 'cancellation',
      propertyId: o.propertyId,
      code: `C-${code}`,
      name: 'Flexible',
      structure: {
        tiers: [{ from: { kind: 'days_before_arrival', days: 7 }, penalty: { kind: 'first_night' } }],
      },
    });
    return r.createRatePlan(tx, {
      propertyId: o.propertyId,
      code,
      name: code,
      cancellationPolicyId: cancel.id,
    });
  });
}

describe('rate plans — derivation graph and lifecycle', () => {
  it('derives multi-level plans, refuses cycles and depth > base + 2 (RAT-I01)', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    const derive = (code: string, parent: string) =>
      o.run((tx, r) =>
        r.createRatePlan(tx, {
          propertyId: o.propertyId,
          code,
          name: code,
          derivation: { parentRatePlanId: parent, adjustment: { kind: 'percent', percent: '-10' } },
        }),
      );
    const nr = await derive('NR', bar.id);
    const nr2 = await derive('NR2', nr.id);
    await expect(derive('NR3', nr2.id)).rejects.toThrow(/at most 2 levels/);
    // Make BAR derive from its own grandchild → cycle.
    await expect(
      o.run((tx, r) =>
        r.updateRatePlan(tx, bar.id, bar.version, {
          derivation: { parentRatePlanId: nr2.id, adjustment: { kind: 'percent', percent: '5' } },
        }),
      ),
    ).rejects.toThrow(/derive from itself/);
    expect(nr2.kind).toBe('derived');
  });

  it('activates only with prices and a cancellation policy, and refuses retiring a plan with live derived plans', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    const nr = await o.run((tx, r) =>
      r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'NR',
        name: 'NR',
        derivation: { parentRatePlanId: bar.id, adjustment: { kind: 'percent', percent: '-10' } },
      }),
    );
    await expect(
      o.run((tx, r) => r.changeRatePlanStatus(tx, bar.id, bar.version, { status: 'active' })),
    ).rejects.toThrow(/no prices yet/);
    const record = await o.run((tx, r) => r.ratePlanRecord(tx, bar));
    expect(record.status).toEqual({ ratePlan: 'draft' });
    expect(record.allowedActions.find((a) => a.action === 'activate')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/Add prices/),
    });
    expect(record.issues.map((i) => i.code)).toContain('no_prices');
    const ut = UT();
    await o.run((tx, r) =>
      r.applyPriceUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: bar.id,
        unitTypeIds: [ut],
        ranges: [{ from: '2026-12-01', to: '2026-12-10' }],
        set: { baseOccupancy: 2, baseAmountMinor: 50_000 },
      }),
    );
    const active = await o.run((tx, r) =>
      r.changeRatePlanStatus(tx, bar.id, bar.version, { status: 'active' }),
    );
    expect(active.status).toBe('active');
    // NR inherits the cancellation policy and the parent's prices.
    await o.run((tx, r) => r.changeRatePlanStatus(tx, nr.id, nr.version, { status: 'active' }));
    await expect(
      o.run((tx, r) => r.changeRatePlanStatus(tx, active.id, active.version, { status: 'retired' })),
    ).rejects.toThrow(/re-parented or retired first: NR/);
    const nrRecord = await o.run(async (tx, r) => r.ratePlanRecord(tx, await r.getRatePlan(tx, nr.id)));
    expect(nrRecord.allowedActions.find((a) => a.action === 'editPrices')).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/computed from BAR/),
    });
    expect(nrRecord.links).toEqual(
      expect.arrayContaining([{ rel: 'parent', type: 'rate_plan', id: bar.id, title: 'BAR' }]),
    );
  });

  it('detects concurrent edits with versions and audits changes', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    await o.run((tx, r) => r.updateRatePlan(tx, bar.id, bar.version, { name: 'Edited by A' }));
    await expect(
      o.run((tx, r) => r.updateRatePlan(tx, bar.id, bar.version, { name: 'Edited by B' })),
    ).rejects.toThrow(/changed by someone else/);
    const audit = await sql<{
      action: string;
    }>`select action from core.audit_log where target_id = ${bar.id} order by occurred_at`.execute(
      t.admin.kysely,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['rates.ratePlan.create', 'rates.ratePlan.update']);
  });

  it('rejects duplicate codes with a clear message', async () => {
    const o = await newOrg(t);
    await basePlanWithPolicy(o, 'BAR');
    await expect(
      o.run((tx, r) => r.createRatePlan(tx, { propertyId: o.propertyId, code: 'BAR', name: 'Again' })),
    ).rejects.toThrow(/already used/);
  });
});

describe('price calendar — bulk updates, history, derived prices, events', () => {
  it('previews, applies by date range and weekdays, versions every change and emits a coalesced event', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    const nr = await o.run((tx, r) =>
      r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'NR',
        name: 'NR',
        derivation: {
          parentRatePlanId: bar.id,
          adjustment: { kind: 'percent', percent: '-10' },
          rounding: { incrementMinor: 100, mode: 'half_up' },
        },
      }),
    );
    const [a, b] = [UT(), UT()];
    const update = {
      propertyId: o.propertyId,
      ratePlanId: bar.id,
      unitTypeIds: [a, b],
      ranges: [{ from: '2026-12-01', to: '2026-12-15' }],
      set: {
        baseOccupancy: 2,
        baseAmountMinor: 45_050,
        extraAdultMinor: 10_000,
        childAmountsMinor: { child: 5_000 },
      },
      reason: 'winter',
    };
    const preview = await o.run((tx, r) => r.previewPriceUpdate(tx, update));
    expect(preview.summary).toMatchObject({ cells: 28, unitTypes: 2, nights: 14, derivedPlans: 1 });
    expect(preview.affectedDerivedPlans).toEqual([{ ratePlanId: nr.id, code: 'NR' }]);
    // Preview changes nothing.
    expect(
      (
        await o.run((tx, r) =>
          r.getPriceCalendar(tx, { ratePlanId: bar.id, from: '2026-12-01', to: '2026-12-15' }),
        )
      ).cells,
    ).toHaveLength(0);
    const applied = await o.run((tx, r) => r.applyPriceUpdate(tx, update));
    expect(applied.changeSetId).toBeTruthy();
    // Weekend uplift (Fri/Sat) by +20% on existing prices, rounded to whole dollars.
    await o.run((tx, r) =>
      r.applyPriceUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: bar.id,
        unitTypeIds: [a],
        ranges: [{ from: '2026-12-01', to: '2026-12-15' }],
        weekdays: [5, 6],
        adjust: { kind: 'percent', percent: '20' },
        rounding: { incrementMinor: 100, mode: 'half_up' },
        reason: 'weekend uplift',
      }),
    );
    const cal = await o.run((tx, r) =>
      r.getPriceCalendar(tx, { ratePlanId: bar.id, from: '2026-12-04', to: '2026-12-06', unitTypeId: a }),
    );
    expect(cal.cells.map((c) => [c.date, c.baseAmountMinor, c.version])).toEqual([
      ['2026-12-04', 54_100, 2],
      ['2026-12-05', 54_100, 2],
    ]);
    const derived = await o.run((tx, r) =>
      r.getPriceCalendar(tx, { ratePlanId: nr.id, from: '2026-12-01', to: '2026-12-02', unitTypeId: a }),
    );
    expect(derived.cells[0]).toMatchObject({
      baseAmountMinor: 40_500,
      derived: true,
      derivedFrom: bar.id,
      version: null,
      childAmountsMinor: { child: 4_500 },
    });
    const history = await o.run((tx, r) =>
      r.getPriceHistory(tx, { ratePlanId: bar.id, unitTypeId: a, from: '2026-12-04', to: '2026-12-05' }),
    );
    expect(history.map((h) => h.reason)).toEqual(['winter', 'weekend uplift']);
    expect(history[1]?.before).toMatchObject({ baseAmountMinor: 45_050 });
    const events = await sql<{ payload: { ranges: unknown[]; ratePlanIds: string[] } }>`
      select payload from core.outbox where tenant_id = ${o.ctx.tenantId} and type = 'rates.prices.changed' order by created_at`.execute(
      t.admin.kysely,
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows[0]?.payload).toMatchObject({
      ratePlanIds: [bar.id, nr.id],
      ranges: [{ from: '2026-12-01', to: '2026-12-15' }],
    });
    expect(events.rows[1]?.payload.ranges).toEqual([
      { from: '2026-12-04', to: '2026-12-06' },
      { from: '2026-12-11', to: '2026-12-13' },
    ]);
  });

  it('refuses editing derived prices and incomplete new cells, atomically', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    const nr = await o.run((tx, r) =>
      r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'NR',
        name: 'NR',
        derivation: { parentRatePlanId: bar.id, adjustment: { kind: 'percent', percent: '-10' } },
      }),
    );
    const ut = UT();
    await expect(
      o.run((tx, r) =>
        r.applyPriceUpdate(tx, {
          propertyId: o.propertyId,
          ratePlanId: nr.id,
          unitTypeIds: [ut],
          ranges: [{ from: '2026-12-01', to: '2026-12-02' }],
          set: { baseOccupancy: 2, baseAmountMinor: 1 },
        }),
      ),
    ).rejects.toThrow(/derived from BAR; its prices are computed/);
    await expect(
      o.run((tx, r) =>
        r.applyPriceUpdate(tx, {
          propertyId: o.propertyId,
          ratePlanId: bar.id,
          unitTypeIds: [ut],
          ranges: [{ from: '2026-12-01', to: '2026-12-02' }],
          set: { extraAdultMinor: 1 },
        }),
      ),
    ).rejects.toThrow(/could not be priced/);
  });
});

describe('restrictions', () => {
  it('sets and clears restrictions by scope with history, previews derived plans that inherit, and emits events', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    const nr = await o.run((tx, r) =>
      r.createRatePlan(tx, {
        propertyId: o.propertyId,
        code: 'NR',
        name: 'NR',
        derivation: { parentRatePlanId: bar.id, adjustment: { kind: 'percent', percent: '-10' } },
        inherit: { restrictions: ['closed'] },
      }),
    );
    const update = {
      propertyId: o.propertyId,
      ratePlanId: bar.id,
      unitTypeIds: [null],
      ranges: [{ from: '2026-12-20', to: '2026-12-27' }],
      set: { minLos: 5, closedToArrival: true },
    };
    const preview = await o.run((tx, r) => r.previewRestrictionUpdate(tx, update));
    expect(preview.summary.cells).toBe(7);
    expect(preview.affectedDerivedPlans).toEqual([]); // NR inherits only `closed`
    await o.run((tx, r) => r.applyRestrictionUpdate(tx, update));
    const closed = await o.run((tx, r) =>
      r.previewRestrictionUpdate(tx, { ...update, set: { closed: true } }),
    );
    expect(closed.affectedDerivedPlans).toEqual([{ ratePlanId: nr.id, code: 'NR' }]);
    await o.run((tx, r) => r.applyRestrictionUpdate(tx, { ...update, set: { closedToArrival: null } }));
    const rows = await o.run((tx, r) =>
      r.getRestrictions(tx, {
        propertyId: o.propertyId,
        from: '2026-12-20',
        to: '2026-12-21',
        ratePlanId: bar.id,
      }),
    );
    expect(rows).toEqual([
      { ratePlanId: bar.id, unitTypeId: null, date: '2026-12-20', values: { minLos: 5 }, version: 2 },
    ]);
    const ev = await sql<{
      n: number;
    }>`select count(*)::int as n from core.outbox where tenant_id = ${o.ctx.tenantId} and type = 'rates.restrictions.changed'`.execute(
      t.admin.kysely,
    );
    expect(ev.rows[0]?.n).toBe(2);
    const hist = await sql<{
      n: number;
    }>`select count(*)::int as n from rates.restriction_history where tenant_id = ${o.ctx.tenantId}`.execute(
      t.admin.kysely,
    );
    expect(hist.rows[0]?.n).toBe(14);
  });
});

describe('history tables are append-only', () => {
  it('rejects updates and deletes of price history even for the application role', async () => {
    const o = await newOrg(t);
    const bar = await basePlanWithPolicy(o);
    await o.run((tx, r) =>
      r.applyPriceUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: bar.id,
        unitTypeIds: [UT()],
        ranges: [{ from: '2026-12-01', to: '2026-12-02' }],
        set: { baseOccupancy: 2, baseAmountMinor: 100 },
      }),
    );
    await expect(
      o.run((tx) => sql`update rates.price_history set changed_by = 'x'`.execute(tx.db)),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(o.run((tx) => sql`delete from rates.change_sets`.execute(tx.db))).rejects.toThrow(
      /permission denied|append-only/,
    );
  });
});

describe('data authority (adoption: rates managed in an external system)', () => {
  it('refuses configuration writes when an external system is the system of record, with an explanation', async () => {
    const o = await newOrg(t);
    await o.run((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: o.propertyId,
        domain: 'rates',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'read_only',
        reason: 'connect alongside',
      }),
    );
    await expect(
      o.run((tx, r) => r.createRatePlan(tx, { propertyId: o.propertyId, code: 'X', name: 'X' })),
    ).rejects.toThrow(/Legacy PMS is the system of record for rates/);
    await o.run((tx) =>
      platform.setDataAuthority(tx, {
        propertyId: o.propertyId,
        domain: 'rates',
        authority: 'external',
        connectionId: newId(),
        systemName: 'Legacy PMS',
        writeMode: 'forward',
        reason: 'forward changes',
      }),
    );
    await expect(
      o.run((tx, r) => r.createRatePlan(tx, { propertyId: o.propertyId, code: 'X', name: 'X' })),
    ).rejects.toMatchObject({ code: 'rates_forwarding_unavailable' });
  });
});

describe('permissions and isolation (scenario 17)', () => {
  it('refuses users lacking the permission or the property scope', async () => {
    const o = await newOrg(t);
    const other = await o.addProperty('OTHER');
    await expect(
      o.as([{ permission: 'rates.ratePlan.read', propertyIds: [o.propertyId] }], (tx, r) =>
        r.createRatePlan(tx, { propertyId: o.propertyId, code: 'X', name: 'X' }),
      ),
    ).rejects.toThrow(/rates.ratePlan.manage/);
    await expect(
      o.as([{ permission: 'rates.ratePlan.manage', propertyIds: [other] }], (tx, r) =>
        r.createRatePlan(tx, { propertyId: o.propertyId, code: 'X', name: 'X' }),
      ),
    ).rejects.toThrow(/permission/);
    const plan = await o.as([{ permission: 'rates.*', propertyIds: [o.propertyId] }], (tx, r) =>
      r.createRatePlan(tx, { propertyId: o.propertyId, code: 'X', name: 'X' }),
    );
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: [other] }], (tx, r) => r.getRatePlan(tx, plan.id)),
    ).rejects.toThrow(/permission/);
    // Tax rules are organization-level and sensitive.
    await expect(
      o.as([{ permission: 'rates.ratePlan.manage', propertyIds: 'all' }], (tx, r) =>
        r.installTaxTemplate(tx, { template: 'MV' }),
      ),
    ).rejects.toThrow(/rates.taxRule.manage/);
  });

  it('another organization cannot read or change rates records, even by id', async () => {
    const victim = await newOrg(t);
    const bar = await basePlanWithPolicy(victim);
    const attacker = await newOrg(t);
    await expect(attacker.run((tx, r) => r.getRatePlan(tx, bar.id))).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx, r) => r.updateRatePlan(tx, bar.id, bar.version, { name: 'pwned' })),
    ).rejects.toThrow(/not found/);
    await expect(
      attacker.run((tx, r) =>
        r.applyPriceUpdate(tx, {
          propertyId: victim.propertyId,
          ratePlanId: bar.id,
          unitTypeIds: [UT()],
          ranges: [{ from: '2026-12-01', to: '2026-12-02' }],
          set: { baseOccupancy: 2, baseAmountMinor: 1 },
        }),
      ),
    ).rejects.toThrow(/not found/);
    expect(await attacker.run((tx, r) => r.listRatePlans(tx, { propertyId: victim.propertyId }))).toEqual([]);
    expect((await victim.run((tx, r) => r.getRatePlan(tx, bar.id))).name).toBe('BAR');
  });
});
