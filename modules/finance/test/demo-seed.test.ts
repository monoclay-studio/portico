import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeDemoSeed } from '../src';
import { type Harness, setupOrg, startHarness } from './helpers';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => h?.t.drop());

describe('demo seed step', () => {
  it('seeds the chart, charge codes and document series idempotently', async () => {
    const org = await setupOrg(h, { environment: 'demo' });
    const demo = { properties: [{ id: org.propertyId, legalEntityId: org.legalEntityId }] };
    await org.run((tx) => financeDemoSeed(tx, demo));
    await org.run((tx) => financeDemoSeed(tx, demo));
    const accounts = await org.run((tx) => h.finance.listAccounts(tx, org.legalEntityId));
    expect(accounts.find((a) => a.systemKey === 'guest_ledger')).toBeDefined();
    const codes = await org.run((tx) => h.finance.listChargeCodes(tx, org.propertyId));
    expect(codes.map((c) => c.code)).toEqual(expect.arrayContaining(['ROOM', 'FOOD', 'ALLOW']));
    const series = await org.run((tx) => h.finance.listFiscalSeries(tx, org.legalEntityId));
    expect(series.map((s) => s.prefix).sort()).toEqual(['CN-', 'INV-']);
  });
});
