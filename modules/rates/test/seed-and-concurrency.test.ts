import { newId } from '@portico/kernel';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRatesDemoSeed, seedResortRates } from '../src';
import { newOrg, startDb, unitTypes } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

describe('demo seed step (DemoSeedStep-compatible)', () => {
  it('installs the MV tax pack and seeds the guesthouse and resort by profile from the inventory port', async () => {
    const types = new Map<string, ReturnType<typeof unitTypes>>();
    const o = await newOrg(t, {
      environment: 'demo',
      ports: { listUnitTypes: async (_tx, propertyId) => types.get(propertyId) ?? [] },
    });
    const guesthouse = await o.addProperty('CNG', undefined, 'guesthouse');
    types.set(o.propertyId, unitTypes());
    types.set(guesthouse, unitTypes());
    const step = createRatesDemoSeed(o.rates, o.ports);
    await o.run((tx) =>
      step(tx, {
        properties: [
          { id: o.propertyId, profile: 'resort' },
          { id: guesthouse, profile: 'guesthouse' },
        ],
      }),
    );
    const resortPlans = await o.run((tx, r) => r.listRatePlans(tx, { propertyId: o.propertyId }));
    expect(resortPlans.map((p) => [p.code, p.status])).toEqual([
      ['AI', 'active'],
      ['AI-HONEY', 'active'],
      ['BAR', 'active'],
      ['BAR-NR', 'active'],
    ]);
    const ghPlans = await o.run((tx, r) => r.listRatePlans(tx, { propertyId: guesthouse }));
    expect(ghPlans.map((p) => p.code)).toEqual(['BB', 'HB']);
    const quote = await o.run((tx, r) =>
      r.quoteDetailed(tx, {
        propertyId: guesthouse,
        nights: { from: '2026-11-20', to: '2026-11-22' },
        occupancy: { adults: 2 },
      }),
    );
    expect(quote.offers.filter((x) => x.bookable).length).toBeGreaterThan(0);
    expect(quote.offers[0]?.taxesAndFees.map((x) => x.ruleCode)).toContain('MV-GREEN-6');
  });

  it('explains what is missing when the inventory port is not bound', async () => {
    const o = await newOrg(t);
    await expect(
      o.run((tx) => createRatesDemoSeed(o.rates, o.ports)(tx, { properties: [] })),
    ).rejects.toThrow(/bind RatesPorts.listUnitTypes/);
  });
});

describe('concurrency invariants', () => {
  it('two parallel bookings cannot both take the last unit of a sales limit', async () => {
    const o = await newOrg(t);
    const uts = unitTypes();
    const seeded = await o.run((tx, r) =>
      seedResortRates(r, tx, { propertyId: o.propertyId, unitTypes: uts, from: '2026-11-07', days: 120 }),
    );
    const planId = seeded.ratePlans.BAR as string;
    await o.run((tx, r) =>
      r.applyRestrictionUpdate(tx, {
        propertyId: o.propertyId,
        ratePlanId: planId,
        unitTypeIds: [null],
        ranges: [{ from: '2027-01-20', to: '2027-01-21' }],
        set: { salesLimit: 1 },
      }),
    );
    const attempt = () =>
      o.run((tx, r) =>
        r.recordPlanSale(tx, {
          propertyId: o.propertyId,
          ratePlanId: planId,
          unitTypeId: uts[0]?.id as string,
          nights: { from: '2027-01-19', to: '2027-01-22' },
          ref: { type: 'stay', id: newId() },
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt(), attempt()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === 'rejected')
        .every((r) => (r as PromiseRejectedResult).reason.code === 'sales_limit_reached'),
    ).toBe(true);
  });

  it('concurrent derivation edits cannot create a cycle', async () => {
    const o = await newOrg(t);
    const [a, b] = await o.run(async (tx, r) => [
      await r.createRatePlan(tx, { propertyId: o.propertyId, code: 'A', name: 'A' }),
      await r.createRatePlan(tx, { propertyId: o.propertyId, code: 'B', name: 'B' }),
    ]);
    const derive = (child: typeof a, parent: typeof a) =>
      o.run((tx, r) =>
        r.updateRatePlan(tx, child?.id as string, child?.version as number, {
          derivation: {
            parentRatePlanId: parent?.id as string,
            adjustment: { kind: 'percent', percent: '-5' },
          },
        }),
      );
    const results = await Promise.allSettled([derive(a, b), derive(b, a)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.message).toMatch(
      /derive from itself/,
    );
  });
});
