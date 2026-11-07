import { addDays, eachNight, type LocalDate, type Money, money, sum } from '@portico/kernel';
import type { CancellationPolicy, DepositItem, TaxLine, TermsSnapshot } from '../../src/ports';

export interface SnapshotSpec {
  from: LocalDate;
  to: LocalDate;
  /** net per night in minor units (or a function of the date) */
  net: number | ((date: LocalDate) => number);
  currency?: string;
  unitTypeId?: string;
  ratePlanId?: string;
  adults?: number;
  childrenAges?: number[];
  /** percentage tax in basis points of net (e.g. 1700 = 17%) */
  taxBp?: number;
  /** fee per person-night in minor units (e.g. Green Tax) */
  feePerPersonNight?: number;
  cancellation?: Partial<CancellationPolicy>;
  deposit?: DepositItem[];
  guaranteeRequired?: TermsSnapshot['policies']['guarantee']['required'];
}

export function makeSnapshot(spec: SnapshotSpec): TermsSnapshot {
  const currency = spec.currency ?? 'USD';
  const adults = spec.adults ?? 2;
  const children = spec.childrenAges ?? [];
  const nights = eachNight({ from: spec.from, to: spec.to }).map((date) => {
    const netMinor = typeof spec.net === 'function' ? spec.net(date) : spec.net;
    const taxes: TaxLine[] = [];
    if (spec.taxBp) {
      taxes.push({
        code: 'TGST',
        name: 'TGST',
        kind: 'tax',
        amount: money(Math.round((netMinor * spec.taxBp) / 10_000), currency),
      });
    }
    if (spec.feePerPersonNight) {
      const persons = adults + children.filter((a) => a >= 2).length;
      taxes.push({
        code: 'GREEN',
        name: 'Green Tax',
        kind: 'fee',
        amount: money(spec.feePerPersonNight * persons, currency),
      });
    }
    return { date, net: money(netMinor, currency), taxes };
  });
  const net = sum(
    currency,
    nights.map((n) => n.net),
  );
  const taxes = sum(
    currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
  );
  const fees = sum(
    currency,
    nights.flatMap((n) => n.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
  );
  return {
    schemaVersion: 1,
    propertyId: 'prop',
    ratePlanId: spec.ratePlanId ?? 'rp-bar',
    unitTypeId: spec.unitTypeId ?? 'ut-beach',
    occupancy: { adults, childrenAges: children },
    currency,
    priceSource: 'portico',
    nights,
    inclusions: [{ code: 'BRK', name: 'Breakfast' }],
    totals: { net, taxes, fees, gross: sum(currency, [net, taxes, fees]) },
    policies: {
      cancellation: { tiers: [], noShow: { kind: 'first_night' }, ...spec.cancellation },
      guarantee: { required: spec.guaranteeRequired ?? ['card'] },
      deposit: { items: spec.deposit ?? [] },
    },
    quotedAt: '2026-11-01T00:00:00.000Z',
  };
}

export const usd = (minor: number): Money => money(minor, 'USD');
export const day = (d: LocalDate, n: number) => addDays(d, n);
