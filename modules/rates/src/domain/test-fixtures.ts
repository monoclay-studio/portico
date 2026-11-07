/**
 * Shared fixtures for domain unit tests (test-only helpers; not exported from the module).
 * Rule VALUES here are test data, not product configuration — the shipped Maldives pack is
 * templates/mv-tax-pack.json.
 */
import type { ChargeLine, ChargeLineInput, TaxRuleDefinition } from '../contracts';
import { chargeLine, taxRuleDefinition } from '../contracts';
import type { LoadedTaxRule, TaxRuleHeader, TaxRuleVersionData } from './tax-engine';

let seq = 0;
const fakeUuid = () => {
  seq++;
  return `00000000-0000-7000-8000-${seq.toString(16).padStart(12, '0')}`;
};

export function rule(
  header: Partial<TaxRuleHeader> & { code: string },
  versions: Array<{ from?: string | null; to?: string | null; def: unknown; verified?: boolean }>,
): LoadedTaxRule {
  return {
    rule: {
      id: fakeUuid(),
      name: header.code,
      category: 'tax',
      taxPointPolicy: 'service_date',
      ledgerMappingKey: `tax.${header.code.toLowerCase()}`,
      sequence: 100,
      ...header,
    },
    versions: versions.map(
      (v): TaxRuleVersionData => ({
        id: fakeUuid(),
        effectiveFrom: v.from ?? null,
        effectiveTo: v.to ?? null,
        definition: taxRuleDefinition.parse(v.def) as TaxRuleDefinition,
        verificationStatus: v.verified ? 'verified_official_source' : 'unverified',
      }),
    ),
  };
}

export function line(
  input: Partial<ChargeLineInput> & { amountMinor: number; currency?: string },
): ChargeLine {
  const { amountMinor, currency, ...rest } = input;
  return chargeLine.parse({
    lineId: rest.lineId ?? `L${fakeUuid().slice(-4)}`,
    chargeCode: 'ROOM',
    taxCategory: 'accommodation',
    serviceDate: '2026-12-01',
    ...rest,
    amount: { amountMinor, currency: currency ?? 'USD' },
  });
}

/** Maldives-shaped test rules: service charge 10% (fee), TGST 16%→17% on net + SC, Green Tax 12/6 USD. */
export function maldivesLikeRules(): LoadedTaxRule[] {
  return [
    rule({ code: 'SC', category: 'fee', sequence: 10 }, [
      {
        def: {
          kind: 'percentage',
          ratePercent: '10',
          appliesTo: { taxCategories: ['accommodation', 'food_beverage'] },
        },
      },
    ]),
    rule({ code: 'TGST', sequence: 20 }, [
      {
        to: '2025-07-01',
        def: {
          kind: 'percentage',
          ratePercent: '16',
          base: { includeNet: true, includeRuleCodes: ['SC'] },
          appliesTo: { taxCategories: ['accommodation', 'food_beverage', 'transfer', 'spa'] },
        },
      },
      {
        from: '2025-07-01',
        def: {
          kind: 'percentage',
          ratePercent: '17',
          base: { includeNet: true, includeRuleCodes: ['SC'] },
          appliesTo: { taxCategories: ['accommodation', 'food_beverage', 'transfer', 'spa'] },
        },
      },
    ]),
    rule({ code: 'GREEN12', sequence: 30 }, [
      {
        from: '2025-01-01',
        def: {
          kind: 'per_person_night',
          amount: { value: '12.00', currency: 'USD' },
          appliesTo: {
            taxCategories: ['accommodation'],
            classification: {
              any: [
                { key: 'mv.inhabitedIsland', equals: false },
                { key: 'mv.registeredRooms', min: 51 },
              ],
            },
          },
        },
      },
    ]),
    rule({ code: 'GREEN6', sequence: 31 }, [
      {
        from: '2025-01-01',
        def: {
          kind: 'per_person_night',
          amount: { value: '6.00', currency: 'USD' },
          appliesTo: {
            taxCategories: ['accommodation'],
            classification: {
              all: [
                { key: 'mv.inhabitedIsland', equals: true },
                { key: 'mv.registeredRooms', max: 50 },
              ],
            },
          },
        },
      },
    ]),
  ];
}

export const RESORT = {
  'mv.establishmentType': 'resort',
  'mv.inhabitedIsland': false,
  'mv.registeredRooms': 120,
};
export const GUESTHOUSE = {
  'mv.establishmentType': 'guesthouse',
  'mv.inhabitedIsland': true,
  'mv.registeredRooms': 12,
};

/** Deterministic PRNG (mulberry32) for property-based-style tests. */
export function prng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T,
    bool: () => next() < 0.5,
  };
}
