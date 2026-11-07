import type { TxContext } from '@portico/db';
import { eachNight, type LocalDate, money, type Occupancy, sum } from '@portico/kernel';
import type {
  CancellationPolicy,
  DepositItem,
  GuaranteeKind,
  Offer,
  QuoteRequest,
  RatesPort,
  RepricingResult,
  StayChangeRequest,
  TaxLine,
  TermsSnapshot,
} from '../../src/ports';

export interface FakeRatePlan {
  id: string;
  name: string;
  unitTypeIds: string[];
  /** Price per unit-night for 2 adults, minor units. */
  base: Record<string, number>;
  extraAdult: number;
  /** Per child aged 2–11 per night; under 2 free. */
  child: number;
  minLos?: number;
  cancellation: CancellationPolicy;
  deposit: DepositItem[];
  guarantee: GuaranteeKind[];
  inclusions?: Array<{ code: string; name: string }>;
}

export interface FakeTaxConfig {
  /** TGST-like percentage on net, basis points. */
  taxBp: number;
  /** Green-Tax-like levy per person-night for persons aged >= `levyMinAge`. */
  levyPerPersonNight: number;
  levyMinAge: number;
}

/**
 * Fake rates module (RatesPort). Configuration is DATA held per property (prices, tax rules, policies) and can be
 * changed mid-test (`setBase`) to prove agreed terms are never rewritten and stale previews are detected.
 * Implements the repricing rules of RAT-R29: agreed nights keep agreed prices, new nights at current rates,
 * occupancy changes reprice supplements at the agreed base, type changes per keep_agreed / difference / reprice.
 */
export class FakeRates implements RatesPort {
  plans = new Map<string, FakeRatePlan[]>();
  taxes = new Map<string, FakeTaxConfig>();
  currency = 'USD';
  quoteCalls = 0;

  configure(propertyId: string, plans: FakeRatePlan[], taxes: FakeTaxConfig): void {
    this.plans.set(propertyId, plans);
    this.taxes.set(propertyId, taxes);
  }

  setBase(propertyId: string, ratePlanId: string, unitTypeId: string, minor: number): void {
    const plan = (this.plans.get(propertyId) ?? []).find((p) => p.id === ratePlanId);
    if (plan) plan.base[unitTypeId] = minor;
  }

  private supplements(plan: FakeRatePlan, occ: Occupancy): number {
    const extraAdults = Math.max(0, occ.adults - 2) * plan.extraAdult;
    const children = occ.childrenAges.filter((a) => a >= 2 && a < 12).length * plan.child;
    return extraAdults + children;
  }

  private current(plan: FakeRatePlan, unitTypeId: string, occ: Occupancy): number {
    return (plan.base[unitTypeId] ?? 0) + this.supplements(plan, occ);
  }

  private taxLines(propertyId: string, net: number, occ: Occupancy): TaxLine[] {
    const t = this.taxes.get(propertyId) ?? { taxBp: 0, levyPerPersonNight: 0, levyMinAge: 0 };
    const lines: TaxLine[] = [];
    if (t.taxBp)
      lines.push({
        code: 'TGST',
        name: 'Tourism GST',
        kind: 'tax',
        amount: money(Math.round((net * t.taxBp) / 10_000), this.currency),
        ruleVersionId: 'tgst-v1',
        basis: 'percentage',
      });
    const persons = occ.adults + occ.childrenAges.filter((a) => a >= t.levyMinAge).length;
    if (t.levyPerPersonNight)
      lines.push({
        code: 'GREEN',
        name: 'Green Tax',
        kind: 'fee',
        amount: money(t.levyPerPersonNight * persons, this.currency),
        ruleVersionId: 'green-v1',
        basis: 'per_person_night',
      });
    return lines;
  }

  private terms(
    propertyId: string,
    plan: FakeRatePlan,
    unitTypeId: string,
    occ: Occupancy,
    nights: Array<{ date: LocalDate; net: number }>,
  ): TermsSnapshot {
    const c = this.currency;
    const lines = nights.map((n) => ({
      date: n.date,
      net: money(n.net, c),
      taxes: this.taxLines(propertyId, n.net, occ),
    }));
    const net = sum(
      c,
      lines.map((l) => l.net),
    );
    const taxes = sum(
      c,
      lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'tax').map((t) => t.amount)),
    );
    const fees = sum(
      c,
      lines.flatMap((l) => l.taxes.filter((t) => t.kind === 'fee').map((t) => t.amount)),
    );
    return {
      schemaVersion: 1,
      propertyId,
      ratePlanId: plan.id,
      ratePlanVersion: 1,
      unitTypeId,
      occupancy: { adults: occ.adults, childrenAges: [...occ.childrenAges] },
      currency: c,
      priceSource: 'portico',
      nights: lines,
      inclusions: plan.inclusions ?? [],
      totals: { net, taxes, fees, gross: sum(c, [net, taxes, fees]) },
      policies: {
        cancellation: plan.cancellation,
        guarantee: { required: plan.guarantee },
        deposit: { items: plan.deposit },
      },
      quotedAt: '2026-11-07T00:00:00.000Z',
    };
  }

  async quote(_tx: TxContext, input: QuoteRequest): Promise<Offer[]> {
    this.quoteCalls++;
    const out: Offer[] = [];
    const dates = eachNight(input.nights);
    for (const plan of this.plans.get(input.propertyId) ?? []) {
      if (input.ratePlanIds && !input.ratePlanIds.includes(plan.id)) continue;
      for (const unitTypeId of plan.unitTypeIds) {
        if (input.unitTypeIds && !input.unitTypeIds.includes(unitTypeId)) continue;
        const nightly = dates.map((date) => ({ date, net: this.current(plan, unitTypeId, input.occupancy) }));
        const terms = this.terms(input.propertyId, plan, unitTypeId, input.occupancy, nightly);
        out.push({
          unitTypeId,
          ratePlanId: plan.id,
          ratePlanName: plan.name,
          nightly: nightly.map((n) => ({ date: n.date, amount: money(n.net, this.currency) })),
          inclusions: terms.inclusions,
          taxesAndFees: terms.nights.flatMap((n) => n.taxes),
          totals: terms.totals,
          policies: terms.policies,
          restrictionViolations:
            plan.minLos && dates.length < plan.minLos
              ? [{ code: 'min_los', message: `Minimum stay is ${plan.minLos} nights` }]
              : [],
          terms,
        });
      }
    }
    return out;
  }

  /** Channel prices → agreed terms with every tax recomputed (inclusive prices decomposed; levies per person). */
  async termsFromChannelPrices(
    _tx: TxContext,
    input: Parameters<RatesPort['termsFromChannelPrices']>[1],
  ): Promise<TermsSnapshot> {
    const t = this.taxes.get(input.propertyId) ?? { taxBp: 0, levyPerPersonNight: 0, levyMinAge: 0 };
    const persons =
      input.occupancy.adults + input.occupancy.childrenAges.filter((a) => a >= t.levyMinAge).length;
    const levy = t.levyPerPersonNight * persons;
    const nights = input.nights.map((n) => {
      if (!input.amountsIncludeTax) return { date: n.date, net: n.amount.amountMinor };
      // gross = net + round(net × rate) + levy; the rounding residue stays on the net (RAT-R24).
      const exact = (n.amount.amountMinor - levy) / (1 + t.taxBp / 10_000);
      const tax = Math.round((exact * t.taxBp) / 10_000);
      return { date: n.date, net: n.amount.amountMinor - levy - tax };
    });
    const plan =
      (this.plans.get(input.propertyId) ?? []).find((p) => p.id === input.ratePlanId) ??
      ({
        id: input.ratePlanId,
        name: 'Channel rate (not mapped)',
        unitTypeIds: [input.unitTypeId],
        base: {},
        extraAdult: 0,
        child: 0,
        cancellation: { tiers: [], noShow: { kind: 'none' } },
        deposit: [],
        guarantee: ['prepaid_channel'],
      } satisfies FakeRatePlan);
    const terms = this.terms(input.propertyId, plan, input.unitTypeId, input.occupancy, nights);
    return {
      ...terms,
      ...(input.base ? { policies: input.base.policies } : {}),
      priceSource: 'channel',
      channel: input.channelRef,
    };
  }

  async priceChange(
    _tx: TxContext,
    input: { terms: TermsSnapshot; change: StayChangeRequest },
  ): Promise<RepricingResult> {
    const { terms, change } = input;
    const plans = this.plans.get(terms.propertyId) ?? [];
    const agreedPlan = plans.find((p) => p.id === terms.ratePlanId);
    const plan = plans.find((p) => p.id === change.ratePlanId) ?? agreedPlan;
    if (!plan || !agreedPlan) throw new Error('fake rates: unknown rate plan');
    const nightly: RepricingResult['nightly'] = [];
    const lines: Array<{ date: LocalDate; net: number }> = [];
    for (const date of eachNight(change.nights)) {
      const agreed = terms.nights.find((n) => n.date === date);
      let net: number;
      if (!agreed && change.unitTypeId !== terms.unitTypeId && change.typeChange === 'keep_agreed') {
        // New night in an upgraded type, complimentary: priced as the originally booked type.
        net = this.current(plan, terms.unitTypeId, change.occupancy);
      } else if (!agreed || change.ratePlanId !== terms.ratePlanId) {
        net = this.current(plan, change.unitTypeId, change.occupancy);
      } else if (change.unitTypeId !== terms.unitTypeId) {
        const policy = change.typeChange ?? 'difference';
        const agreedNet = agreed.net.amountMinor;
        net =
          policy === 'keep_agreed'
            ? agreedNet
            : policy === 'difference'
              ? agreedNet +
                (this.current(plan, change.unitTypeId, change.occupancy) -
                  this.current(plan, terms.unitTypeId, change.occupancy))
              : this.current(plan, change.unitTypeId, change.occupancy);
      } else {
        const agreedBase = agreed.net.amountMinor - this.supplements(agreedPlan, terms.occupancy);
        net = agreedBase + this.supplements(plan, change.occupancy);
      }
      lines.push({ date, net });
      nightly.push({ date, before: agreed?.net ?? null, after: money(net, this.currency) });
    }
    return {
      nightly,
      penalties: [],
      terms: this.terms(terms.propertyId, plan, change.unitTypeId, change.occupancy, lines),
    };
  }
}
