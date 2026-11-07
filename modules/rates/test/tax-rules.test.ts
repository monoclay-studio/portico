import { sql } from '@portico/db';
import type { TestDatabase } from '@portico/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newOrg, startDb } from './harness';

let t: TestDatabase;
beforeAll(async () => {
  t = await startDb();
});
afterAll(async () => t?.drop());

const roomLine = (serviceDate: string, amountMinor = 10_000) => ({
  lineId: `room:${serviceDate}`,
  chargeCode: 'ROOM',
  taxCategory: 'accommodation',
  amount: { amountMinor, currency: 'USD' },
  serviceDate,
  occupancy: { adults: 2, childrenAges: [1, 6] },
});

describe('Maldives template (seed data, not code)', () => {
  it('installs cited, effective-dated rules idempotently with verification status', async () => {
    const o = await newOrg(t);
    const first = await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    expect(first.installed).toEqual(['MV-SC', 'MV-TGST', 'MV-GST-GENERAL', 'MV-GREEN-12', 'MV-GREEN-6']);
    expect(first.disclaimer).toMatch(/not legal or tax advice/);
    const again = await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    expect(again).toMatchObject({ installed: [], skipped: first.installed });
    const rules = await o.run((tx, r) => r.listTaxRules(tx, { jurisdiction: 'MV' }));
    const tgst = rules.find((x) => x.code === 'MV-TGST');
    expect(tgst?.taxPointPolicy).toBe('time_of_supply');
    expect(
      tgst?.versions.map((v) => [
        v.effectiveFrom,
        v.effectiveTo,
        (v.definition as { ratePercent: string }).ratePercent,
      ]),
    ).toEqual([
      ['2014-11-01', '2023-01-01', '12'],
      ['2023-01-01', '2025-07-01', '16'],
      ['2025-07-01', null, '17'],
    ]);
    for (const rule of rules) {
      for (const v of rule.versions) {
        expect(v.sources.length).toBeGreaterThan(0);
        expect(v.sources.every((s) => /^https:\/\//.test(s.url))).toBe(true);
      }
    }
    expect(rules.find((x) => x.code === 'MV-GREEN-12')?.versions[0]?.verification.status).toBe(
      'verified_official_source',
    );
    expect(rules.find((x) => x.code === 'MV-SC')?.versions[0]?.verification.status).toBe('unverified');
    const record = await o.run(async (tx, r) => r.taxRuleRecord(tx, tgst as NonNullable<typeof tgst>));
    expect(record.status).toEqual({ taxRule: 'active', verification: 'verified_official_source' });
    expect(record.issues.map((i) => i.code)).toContain('not_adviser_confirmed');
  });

  it('computes TGST on (net + service charge), Green Tax per guest with under-2 exemption, outside the GST base', async () => {
    const o = await newOrg(t);
    await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    const result = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, { propertyId: o.propertyId, lines: [roomLine('2026-12-01')] }),
    );
    const by = Object.fromEntries((result.lines[0]?.taxes ?? []).map((x) => [x.ruleCode, x]));
    expect(by['MV-SC']?.amount.amountMinor).toBe(1_000);
    expect(by['MV-TGST']?.base?.amountMinor).toBe(11_000);
    expect(by['MV-TGST']?.amount.amountMinor).toBe(1_870);
    expect(by['MV-GREEN-12']?.quantity?.persons).toBe(3); // 2 adults + 6-year-old; 1-year-old exempt
    expect(by['MV-GREEN-12']?.amount.amountMinor).toBe(3_600);
    expect(by['MV-GREEN-6']).toBeUndefined();
    expect(result.totals).toMatchObject({
      net: { amountMinor: 10_000 },
      fees: { amountMinor: 1_000 },
      taxes: { amountMinor: 5_470 },
      gross: { amountMinor: 16_470 },
    });
  });

  it('applies the USD 6 Green Tax for a small inhabited-island guesthouse and refuses to guess missing classification', async () => {
    const o = await newOrg(t, { profile: 'guesthouse' });
    await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    const r1 = await o.run((tx, r) =>
      r.computeTaxes(tx, { propertyId: o.propertyId, lines: [roomLine('2026-12-01', 6_500)] }),
    );
    expect(r1.find((x) => x.ruleCode === 'MV-GREEN-6')?.amount.amountMinor).toBe(1_800);
    const unclassified = await o.addProperty('BARE', { 'mv.establishmentType': 'guesthouse' }, 'guesthouse');
    await expect(
      o.run((tx, r) => r.computeTaxes(tx, { propertyId: unclassified, lines: [roomLine('2026-12-01')] })),
    ).rejects.toThrow(/mv.inhabitedIsland|mv.registeredRooms/);
  });

  it('uses the time of supply: a deposit paid before 1 July 2025 fixed TGST at 16% (no re-taxing)', async () => {
    const o = await newOrg(t);
    await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    const line = { ...roomLine('2025-07-15'), occupancy: { adults: 2, childrenAges: [] } };
    const paidEarly = await o.run((tx, r) =>
      r.computeTaxes(tx, {
        propertyId: o.propertyId,
        lines: [line],
        fullPaymentDate: '2025-06-20',
        invoiceDate: '2025-07-16',
      }),
    );
    expect(paidEarly.find((x) => x.ruleCode === 'MV-TGST')).toMatchObject({
      ratePercent: '16',
      taxPointDate: '2025-06-20',
    });
    const invoiced = await o.run((tx, r) =>
      r.computeTaxes(tx, { propertyId: o.propertyId, lines: [line], invoiceDate: '2025-07-16' }),
    );
    expect(invoiced.find((x) => x.ruleCode === 'MV-TGST')?.ratePercent).toBe('17');
    // Green Tax follows the service date.
    expect(paidEarly.find((x) => x.ruleCode === 'MV-GREEN-12')?.taxPointDate).toBe('2025-07-15');
  });

  it('recomputing with the same pinned rule versions is bit-identical (RAT-I05)', async () => {
    const o = await newOrg(t);
    await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    const first = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, { propertyId: o.propertyId, lines: [roomLine('2026-12-01')] }),
    );
    const pinned = await o.run((tx, r) =>
      r.computeTaxesDetailed(tx, {
        propertyId: o.propertyId,
        lines: [roomLine('2026-12-01')],
        ruleVersionIds: first.ruleVersionIds,
      }),
    );
    expect(JSON.stringify(pinned)).toBe(JSON.stringify(first));
  });
});

describe('rule lifecycle: draft → activation report → active; immutable versions', () => {
  const pct = (ratePercent: string) => ({
    kind: 'percentage',
    ratePercent,
    appliesTo: { taxCategories: ['accommodation'] },
  });
  const source = [{ url: 'https://example.gov/tax', title: 'Example authority' }];

  it('activation closes the predecessor, records the report, and future vs historical service dates use their own version', async () => {
    const o = await newOrg(t);
    const rule = await o.run((tx, r) =>
      r.createTaxRule(tx, {
        code: 'CITY-FEE',
        name: 'City fee',
        jurisdiction: 'MV',
        category: 'fee',
        ledgerMappingKey: 'fee.city',
        firstVersion: { effectiveFrom: '2026-01-01', definition: pct('2'), sources: source },
      }),
    );
    expect(rule.versions[0]?.status).toBe('draft');
    // Drafts never compute.
    expect(
      await o.run((tx, r) =>
        r.computeTaxes(tx, { propertyId: o.propertyId, lines: [roomLine('2026-06-01')] }),
      ),
    ).toEqual([]);
    const v1 = rule.versions[0]?.id as string;
    await expect(
      o.run((tx, r) => r.activateTaxRuleVersion(tx, v1, { reason: 'go live', acknowledgeReport: false })),
    ).rejects.toThrow(/Review the change report/);
    await o.run((tx, r) => r.activateTaxRuleVersion(tx, v1, { reason: 'initial', acknowledgeReport: true }));
    const withV2 = await o.run((tx, r) =>
      r.addTaxRuleVersion(tx, rule.id, {
        effectiveFrom: '2027-01-01',
        definition: pct('3'),
        sources: source,
      }),
    );
    const v2 = withV2.versions[1]?.id as string;
    const report = await o.run((tx, r) => r.previewTaxRuleActivation(tx, v2));
    expect(report.closes).toEqual([
      {
        ruleVersionId: v1,
        versionNo: 1,
        effectiveFrom: '2026-01-01',
        effectiveToBefore: null,
        effectiveToAfter: '2027-01-01',
      },
    ]);
    expect(report.definitionChanges).toEqual([{ field: 'ratePercent', before: '2', after: '3' }]);
    await o.run((tx, r) =>
      r.activateTaxRuleVersion(tx, v2, { reason: 'rate rise', acknowledgeReport: true }),
    );
    const lines = await o.run((tx, r) =>
      r.computeTaxes(tx, {
        propertyId: o.propertyId,
        lines: [roomLine('2026-12-31'), { ...roomLine('2027-01-01'), lineId: 'jan' }],
      }),
    );
    expect(lines.map((l) => [l.lineId, l.ratePercent, l.ruleVersionId])).toEqual([
      ['room:2026-12-31', '2', v1],
      ['jan', '3', v2],
    ]);
    const ev = await sql<{
      n: number;
    }>`select count(*)::int n from core.outbox where tenant_id = ${o.ctx.tenantId} and type = 'rates.taxRule.activated'`.execute(
      t.admin.kysely,
    );
    expect(ev.rows[0]?.n).toBe(2);
    // A version already in effect cannot be withdrawn; a future one can, re-opening its predecessor.
    await expect(o.run((tx, r) => r.withdrawTaxRuleVersion(tx, v1, { reason: 'oops' }))).rejects.toThrow(
      /already in effect/,
    );
    const after = await o.run((tx, r) => r.withdrawTaxRuleVersion(tx, v2, { reason: 'law postponed' }));
    expect(after.versions.map((v) => [v.status, v.effectiveTo])).toEqual([
      ['active', null],
      ['withdrawn', null],
    ]);
  });

  it('refuses activations that would overlap without a clean succession', async () => {
    const o = await newOrg(t);
    const rule = await o.run((tx, r) =>
      r.createTaxRule(tx, {
        code: 'X-FEE',
        name: 'X',
        jurisdiction: 'MV',
        category: 'fee',
        ledgerMappingKey: 'fee.x',
        firstVersion: {
          effectiveFrom: '2026-01-01',
          effectiveTo: '2026-12-31',
          definition: pct('2'),
          sources: source,
        },
      }),
    );
    await o.run((tx, r) =>
      r.activateTaxRuleVersion(tx, rule.versions[0]?.id as string, {
        reason: 'go live',
        acknowledgeReport: true,
      }),
    );
    const split = await o.run((tx, r) =>
      r.addTaxRuleVersion(tx, rule.id, {
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-07-01',
        definition: pct('5'),
        sources: source,
      }),
    );
    await expect(
      o.run((tx, r) =>
        r.activateTaxRuleVersion(tx, split.versions[1]?.id as string, {
          reason: 'split test',
          acknowledgeReport: true,
        }),
      ),
    ).rejects.toMatchObject({ code: 'tax_rule_version_conflict' });
  });

  it('the database enforces one active version per date and immutable definitions (RAT-I06)', async () => {
    const o = await newOrg(t);
    await o.run((tx, r) => r.installTaxTemplate(tx, { template: 'MV' }));
    const tgst = (await o.run((tx, r) => r.listTaxRules(tx))).find((x) => x.code === 'MV-TGST');
    const v17 = tgst?.versions[1]?.id as string;
    await expect(
      o.run((tx) =>
        sql`update rates.tax_rule_versions set definition = '{}'::jsonb where id = ${v17}`.execute(tx.db),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      o.run((tx) => sql`delete from rates.tax_rule_versions where id = ${v17}`.execute(tx.db)),
    ).rejects.toThrow(/permission denied/);
    await expect(
      o.run((tx) =>
        sql`update rates.tax_rule_versions set effective_to = null where tax_rule_id = ${tgst?.id as string} and version_no = 1`.execute(
          tx.db,
        ),
      ),
    ).rejects.toThrow(/tax_rule_versions_no_overlap/);
  });

  it('requires the sensitive activation permission', async () => {
    const o = await newOrg(t);
    await expect(
      o.as([{ permission: 'rates.taxRule.manage', propertyIds: 'all' }], (tx, r) =>
        r.installTaxTemplate(tx, { template: 'MV' }),
      ),
    ).rejects.toThrow(/rates.taxRule.activate/);
    await expect(
      o.as([{ permission: 'rates.quote.read', propertyIds: 'all' }], (tx, r) => r.listTaxRules(tx)),
    ).rejects.toThrow(/rates.taxRule.read/);
  });
});
