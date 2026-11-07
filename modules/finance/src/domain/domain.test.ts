import { describe, expect, it } from 'vitest';
import { ageItems, agingBucket } from './aging';
import { closeOutcome, isEligible, usageFor } from './allowance';
import { cashVariance } from './cashier';
import {
  clearingKeyForMethod,
  DEFAULT_CHART,
  derivedAccountTemplate,
  revenueKeyForGroup,
  taxAccountKey,
} from './chart';
import {
  documentHash,
  findNumberingGaps,
  formatDocumentNumber,
  GENESIS_HASH,
  retainUntil,
  verifyChain,
  withinTolerance,
} from './fiscal';
import { assertCanSettle, destinationAction } from './folio';
import { pickRate } from './fx';
import { categorize, invoiceTotals, taxSummary } from './invoice';
import { assertBalanced, functionalize, imbalances, reverseLines } from './ledger';
import { renderTextPdf } from './pdf';
import { proportional, splitComponents } from './split';

let seed = 7;
const rnd = (n: number) => {
  seed = (seed * 48271) % 2147483647;
  return seed % n;
};

describe('splitComponents (charge + taxes across folios)', () => {
  it('keeps row sums, column sums and signs exact for thousands of random splits', () => {
    for (let i = 0; i < 3000; i++) {
      const sign = rnd(5) === 0 ? -1 : 1;
      const comps = Array.from(
        { length: 1 + rnd(4) },
        (_, j) => sign * (j === 0 ? 1 + rnd(100000) : rnd(20000)),
      );
      const gross = comps.reduce((s, c) => s + c, 0);
      const parts = 1 + rnd(4);
      const dests: number[] = [];
      let left = gross;
      for (let k = 0; k < parts - 1; k++) {
        const take = sign * rnd(Math.abs(left) + 1) + 0;
        dests.push(take);
        left -= take;
      }
      dests.push(left);
      const m = splitComponents(comps, dests);
      expect(m.map((row) => row.reduce((s, v) => s + v, 0))).toEqual(dests);
      expect(comps.map((_, j) => m.reduce((s, row) => s + (row[j] ?? 0), 0))).toEqual(comps);
      for (const row of m) for (const v of row) expect(Math.sign(v) * sign).toBeGreaterThanOrEqual(0);
    }
  });

  it('rejects inconsistent or mixed-sign splits', () => {
    expect(() => splitComponents([100, 10], [100])).toThrow(/add up/);
    expect(() => splitComponents([100, -10], [50, 40])).toThrow(/different signs/);
  });

  it('allocates converted amounts proportionally and exactly', () => {
    expect(proportional(1001, [10000, 1000, 1700])).toEqual([788, 79, 134]);
    expect(proportional(-10, [1, 1, 1]).reduce((s, v) => s + v, 0)).toBe(-10);
    expect(() => proportional(10, [1, -1])).toThrow();
  });
});

describe('ledger arithmetic', () => {
  it('derives functional amounts so foreign-currency entries balance exactly', () => {
    const lines = functionalize(
      [
        { accountKey: 'guest_ledger', amountMinor: 10001, currency: 'EUR' },
        { accountKey: 'revenue', amountMinor: -3334, currency: 'EUR' },
        { accountKey: 'revenue', amountMinor: -3333, currency: 'EUR' },
        { accountKey: 'tax', amountMinor: -3334, currency: 'EUR' },
        { accountKey: 'x', amountMinor: 5, currency: 'USD' },
        { accountKey: 'y', amountMinor: -5, currency: 'USD' },
      ],
      'USD',
      () => ({ rate: '1.0833', rateId: 'r1' }),
    );
    expect(imbalances(lines)).toEqual([]);
    expect(lines[0]?.functionalAmountMinor).toBe(10834);
    expect(lines[0]?.fxRateId).toBe('r1');
    expect(() => assertBalanced([lines[0] as (typeof lines)[number]], 'x')).toThrow(/at least two lines/);
    expect(() =>
      assertBalanced(
        [{ ...(lines[0] as (typeof lines)[number]) }, { ...(lines[4] as (typeof lines)[number]) }],
        'x',
      ),
    ).toThrow(/does not balance/);
    expect(imbalances(reverseLines(lines))).toEqual([]);
  });

  it('picks the latest rate on or before the date, operational before reference, inverse when needed', () => {
    const rates = [
      { id: 'a', businessDate: '2026-11-05', fromCurrency: 'USD', toCurrency: 'MVR', rate: '15.40' },
      {
        id: 'b',
        businessDate: '2026-11-07',
        fromCurrency: 'USD',
        toCurrency: 'MVR',
        rate: '15.42',
        source: 'MMA',
      },
      {
        id: 'c',
        businessDate: '2026-11-07',
        fromCurrency: 'USD',
        toCurrency: 'MVR',
        rate: '15.45',
        source: 'Hotel',
      },
      { id: 'd', businessDate: '2026-11-09', fromCurrency: 'USD', toCurrency: 'MVR', rate: '16' },
    ];
    expect(pickRate(rates, 'USD', 'MVR', '2026-11-08', '2026-11-01').rateId).toBe('c');
    const inv = pickRate(rates, 'MVR', 'USD', '2026-11-06', '2026-11-01');
    expect(inv).toMatchObject({ rateId: 'a', inverted: true });
    expect(inv.rate.mul(15.4).toNumber()).toBeCloseTo(1, 12);
    expect(() => pickRate(rates, 'USD', 'MVR', '2026-11-04', '2026-11-01')).toThrow(/No exchange rate/);
  });
});

describe('chart and accounts', () => {
  it('maps groups, methods and tax keys to accounts', () => {
    expect(new Set(DEFAULT_CHART.map((a) => a.systemKey)).size).toBe(DEFAULT_CHART.length);
    expect(revenueKeyForGroup('room')).toBe('revenue:room');
    expect(revenueKeyForGroup('allowance')).toBe('allowance_clearing');
    expect(revenueKeyForGroup('gratuity')).toBe('gratuities_payable');
    expect(clearingKeyForMethod('card', 'Stripe')).toBe('card_clearing:stripe');
    expect(clearingKeyForMethod('cash')).toBe('cash');
    expect(clearingKeyForMethod('bank_transfer')).toBe('bank');
    expect(taxAccountKey('Green Tax')).toBe('tax:green_tax');
    expect(taxAccountKey(null)).toBe('tax:unmapped');
    expect(derivedAccountTemplate('card_clearing:adyen')?.type).toBe('asset');
    expect(derivedAccountTemplate('revenue:other')).toBeNull();
  });
});

describe('fiscal ledger', () => {
  it('chains hashes and detects tampering and gaps', () => {
    const links = [];
    let prev = GENESIS_HASH;
    for (let i = 1; i <= 3; i++) {
      const d = {
        previousHash: prev,
        chainPosition: i,
        documentNumber: formatDocumentNumber('INV-', i),
        kind: 'invoice',
        totalMinor: i * 100,
        currency: 'USD',
        snapshot: { n: i },
      };
      const hash = documentHash(d);
      links.push({ ...d, hash });
      prev = hash;
    }
    expect(verifyChain(links)).toBeNull();
    expect(
      verifyChain([
        links[0],
        { ...(links[1] as (typeof links)[number]), totalMinor: 1 },
        links[2],
      ] as typeof links),
    ).toEqual({ brokenAt: 2, reason: 'content hash mismatch' });
    expect(verifyChain([links[0], links[2]] as typeof links)).toMatchObject({ brokenAt: 3 });
    expect(findNumberingGaps([1, 2, 4, 6])).toEqual([3, 5]);
    expect(formatDocumentNumber('INV-', 42)).toBe('INV-000042');
  });

  it('computes retention and the ±2% central-bank tolerance', () => {
    expect(retainUntil('2026-11-07')).toBe('2031-12-31');
    expect(retainUntil('2026-01-01', 7)).toBe('2033-12-31');
    expect(withinTolerance('0.0660', '0.0648', '2')).toBe(true);
    expect(withinTolerance('0.0662', '0.0648', '2')).toBe(false);
    expect(withinTolerance('1', '0', '2')).toBe(false);
  });

  it('categorizes invoice lines: service charge in the GST base, Green Tax as a levy, tips outside', () => {
    const c = (effectiveKind: string, taxKind: string | null = null, chargeGroup: string | null = null) =>
      categorize({ kind: effectiveKind, effectiveKind, taxKind, chargeGroup });
    expect(c('charge', null, 'room')).toBe('value');
    expect(c('tax', 'service_charge')).toBe('service_charge');
    expect(c('tax', 'tax')).toBe('tax');
    expect(c('tax', 'fee')).toBe('levy');
    expect(c('charge', null, 'gratuity')).toBe('outside');
    expect(c('payment')).toBe('settlement');
    const item = (category: ReturnType<typeof c>, amountMinor: number, taxName: string | null = null) => ({
      postingId: 'p',
      category,
      description: 'd',
      chargeCode: null,
      date: null,
      quantity: null,
      amountMinor,
      taxName,
      taxRate: null,
      taxRuleId: null,
    });
    const items = [
      item('value', 20000),
      item('service_charge', 2000, 'SC'),
      item('tax', 3740, 'TGST'),
      item('levy', 2400, 'Green Tax'),
      item('outside', 500),
      item('settlement', -10000),
    ];
    expect(invoiceTotals(items)).toEqual({
      valueBeforeTaxMinor: 22000,
      serviceChargeMinor: 2000,
      taxChargedMinor: 3740,
      leviesMinor: 2400,
      outsideTaxBaseMinor: 500,
      totalMinor: 28640,
      settlementsMinor: -10000,
      balanceDueMinor: 18640,
    });
    expect(taxSummary(items).map((t) => t.name)).toEqual(['Green Tax', 'SC', 'TGST']);
  });

  it('renders a deterministic PDF', () => {
    const a = renderTextPdf(['TAX INVOICE', 'Café (é) \\ test'], 'INV-1');
    expect(a.equals(renderTextPdf(['TAX INVOICE', 'Café (é) \\ test'], 'INV-1'))).toBe(true);
    expect(a.toString('latin1')).toMatch(/^%PDF-1\.4[\s\S]*%%EOF\n$/);
    const many = renderTextPdf(
      Array.from({ length: 200 }, (_, i) => `line ${i}`),
      'long',
    );
    expect(many.toString('latin1')).toContain('/Count 4');
  });
});

describe('folio, allowance, cashier and aging rules', () => {
  it('decides where a new posting lands (scenario 10)', () => {
    expect(destinationAction({ status: 'open', hasActiveInvoice: true })).toBe('post');
    expect(destinationAction({ status: 'settled', hasActiveInvoice: false })).toBe('reopen');
    expect(destinationAction({ status: 'settled', hasActiveInvoice: true })).toBe('supplementary');
    expect(destinationAction({ status: 'closed', hasActiveInvoice: false })).toBe('supplementary');
    expect(() => destinationAction({ status: 'voided', hasActiveInvoice: false })).toThrow(/voided/);
    expect(() => assertCanSettle('open', 1, 'USD')).toThrow(/balance of 1/);
    expect(() => assertCanSettle('settled', 0, 'USD')).toThrow(/Only an open folio/);
  });

  it('consumes allowances up to the remaining balance and handles the unused remainder by policy', () => {
    const a = {
      id: 'a',
      grantedMinor: 10000,
      usedMinor: 9000,
      coversTaxes: true,
      validFrom: '2026-11-07',
      validTo: '2026-11-08',
      eligibleChargeCodes: [],
      eligibleGroups: ['food'],
      eligibleTags: [],
      status: 'active' as const,
    };
    expect(
      isEligible(a, { chargeCode: 'FOOD', chargeGroup: 'food', tags: [], serviceDate: '2026-11-07' }),
    ).toBe(true);
    expect(
      isEligible(a, { chargeCode: 'FOOD', chargeGroup: 'food', tags: [], serviceDate: '2026-11-08' }),
    ).toBe(false);
    expect(
      isEligible(a, { chargeCode: 'SPA', chargeGroup: 'spa', tags: [], serviceDate: '2026-11-07' }),
    ).toBe(false);
    expect(usageFor(a, { netMinor: 800, grossMinor: 1030 })).toBe(1000);
    expect(usageFor({ ...a, coversTaxes: false }, { netMinor: 800, grossMinor: 1030 })).toBe(800);
    expect(closeOutcome(a, 'forfeit', true)).toEqual({ kind: 'forfeit', amountMinor: 1000 });
    expect(closeOutcome(a, 'carry_forward', true)).toEqual({ kind: 'carry_forward', amountMinor: 1000 });
    expect(closeOutcome(a, 'carry_forward', false, 'credit_back')).toEqual({
      kind: 'credit_back',
      amountMinor: 1000,
    });
    expect(closeOutcome({ grantedMinor: 5, usedMinor: 5 }, 'forfeit', false)).toEqual({ kind: 'none' });
  });

  it('computes drawer variance per currency', () => {
    expect(
      cashVariance(
        { USD: 20000 },
        [
          { currency: 'USD', amountMinor: 5000 },
          { currency: 'MVR', amountMinor: 15420 },
        ],
        { USD: 24900, MVR: 15420, EUR: 100 },
      ),
    ).toEqual({
      expected: { USD: 25000, MVR: 15420, EUR: 0 },
      variance: { EUR: 100, MVR: 0, USD: -100 },
    });
  });

  it('ages open items by due date', () => {
    expect(agingBucket('2026-11-07', '2026-11-07')).toBe('current');
    expect(agingBucket('2026-11-07', '2026-12-07')).toBe('d1_30');
    expect(agingBucket('2026-11-07', '2026-12-08')).toBe('d31_60');
    expect(agingBucket('2026-11-07', '2027-02-06')).toBe('over_90');
    const s = ageItems(
      [
        {
          id: 'i1',
          dueDate: '2026-10-01',
          businessDate: '2026-09-01',
          amountMinor: 1000,
          allocatedMinor: 400,
        },
        { id: 'i2', dueDate: '2026-11-30', businessDate: '2026-11-01', amountMinor: 500, allocatedMinor: 0 },
        { id: 'p1', dueDate: null, businessDate: '2026-11-05', amountMinor: -700, allocatedMinor: 400 },
        { id: 'future', dueDate: null, businessDate: '2026-12-01', amountMinor: 999, allocatedMinor: 0 },
      ],
      '2026-11-07',
    );
    expect(s).toEqual({
      buckets: { current: 500, d1_30: 0, d31_60: 600, d61_90: 0, over_90: 0 },
      unallocatedCredits: 300,
      balance: 800,
    });
  });
});
