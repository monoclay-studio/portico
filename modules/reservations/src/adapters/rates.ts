import type { TxContext } from '@portico/db';
import {
  add,
  type DateRange,
  DomainError,
  type EntityRef,
  type LocalDate,
  type Money,
  money,
  type Occupancy,
} from '@portico/kernel';
import type {
  CancellationPolicy,
  DepositItem,
  GuaranteeKind,
  Offer,
  PaymentScheduleItem,
  Penalty,
  PenaltyEvaluation,
  RatesPort,
  TaxLine,
  TermsSnapshot,
} from '../ports';

/*
 * The rates module's canonical provider contract (modules/rates/README.md § Provider contract), described
 * STRUCTURALLY — only the fields reservations reads (a module never imports another module). The composition root
 * passes the real `ratesService`; TypeScript checks it fits, so a drift in rates' contract fails the build.
 */

type RatesTaxBasis = NonNullable<TaxLine['basis']>;

/** Rates `TaxLine` (canonical names: ruleCode / ruleName / category / basis). */
export interface RatesTaxLine {
  ruleCode: string;
  ruleName: string;
  ruleVersionId: string;
  category: 'tax' | 'fee';
  basis: RatesTaxBasis;
  amount: Money;
}

/** Rates `Penalty` (percent as a decimal string, fixed amounts in minor units of the terms' currency). */
export type RatesPenalty =
  | { kind: 'none' }
  | { kind: 'first_night' }
  | { kind: 'nights'; nights: number }
  | { kind: 'percent_of_stay'; percent: string }
  | { kind: 'amount'; amountMinor: number };

export type RatesDeadline =
  | { kind: 'at_booking' }
  | { kind: 'days_before_arrival'; days: number; time: string }
  | { kind: 'hours_before_checkin'; hours: number };

export interface RatesNightPrice {
  date: LocalDate;
  net: Money;
  taxes: RatesTaxLine[];
  components: Array<{ kind: 'room' | 'inclusion' | 'allowance'; code: string; amount: Money }>;
}

type RatesScheduleAmount =
  | { basis: 'percent'; percent: string }
  | { basis: 'nights'; nights: number }
  | { basis: 'amount'; amountMinor: number }
  | { basis: 'remaining' };

/** Rates' sealed agreed terms (`TermsSnapshot` v1) — the fields the view is built from. */
export interface RatesTermsDocument {
  schemaVersion: number;
  kind: string;
  quotedAt: string;
  propertyId: string;
  checkInTime: string;
  currency: string;
  priceSource: 'portico_quote' | 'channel' | 'manual_override' | 'complimentary' | 'house_use';
  ratePlan: { id: string; version: number };
  unitTypeId: string;
  occupancy: { adults: number; childrenAges: number[] };
  nights: RatesNightPrice[];
  addedComponents: Array<{
    code: string;
    name: string;
    nightDate: LocalDate;
    net: Money;
    taxes: RatesTaxLine[];
  }>;
  inclusions: Array<{ code: string; name: string }>;
  policies: {
    cancellation: {
      text: string;
      structure: {
        tiers: Array<{ from: RatesDeadline; penalty: RatesPenalty }>;
        noShow: RatesPenalty;
        earlyDeparture: RatesPenalty;
        basis: 'net_and_fees' | 'gross' | 'net';
      };
    } | null;
    guarantee: { structure: { accepted: GuaranteeKind[]; holdUntil?: string | undefined } } | null;
    deposit: {
      structure: {
        items: Array<{
          kind: 'deposit' | 'preauthorization' | 'balance';
          amount: RatesScheduleAmount;
          due: { anchor: 'booking' | 'arrival' | 'departure'; offsetDays: number };
        }>;
      };
    } | null;
  };
  commission: { model: 'commissionable' | 'net'; percent?: string | undefined } | null;
  totals: { net: Money; taxes: Money; fees: Money; gross: Money };
  priceOverride: {
    kind: 'nightly' | 'total' | 'complimentary' | 'house_use';
    reason: string;
    by: string;
  } | null;
  seal: string;
}

export interface RatesOffer {
  unitTypeId: string;
  ratePlanId: string;
  ratePlanName: string;
  nightly: RatesNightPrice[];
  inclusions: { included: Array<{ code: string; name: string }> };
  taxesAndFees: RatesTaxLine[];
  totals: { net: Money; taxes: Money; fees: Money; gross: Money };
  restrictionViolations: Array<{ kind: string; message: string }>;
  terms: RatesTermsDocument;
}

export interface RatesPenaltyEvaluation {
  event: PenaltyEvaluation['event'];
  at: string;
  nights: LocalDate[];
  tier: { fromInstant: string | null; description: string } | null;
  penalty: RatesPenalty;
  basisAmount: Money;
  amount: Money;
  description: string;
}

/** The rates provider functions reservations binds (rates README § Provider contract). */
export interface RatesProvider {
  quote(tx: TxContext, request: unknown): Promise<RatesOffer[]>;
  priceChange(
    tx: TxContext,
    input: unknown,
  ): Promise<{
    nightly: Array<{ date: LocalDate; before: Money | null; after: Money | null }>;
    penalties: Array<{ kind: string; amount: Money; description: string }>;
    terms: RatesTermsDocument;
  }>;
  complimentaryTerms(
    tx: TxContext,
    input: { terms: RatesTermsDocument; kind: 'complimentary' | 'house_use'; reason: string },
  ): Promise<RatesTermsDocument>;
  evaluateCancellationPenalty(
    terms: RatesTermsDocument,
    at: Date,
    opts?: { event?: PenaltyEvaluation['event']; nights?: readonly LocalDate[] },
  ): RatesPenaltyEvaluation;
  instantiatePaymentSchedule(
    terms: RatesTermsDocument,
    opts?: { bookingDate?: LocalDate },
  ): Array<{ kind: PaymentScheduleItem['kind']; dueDate: LocalDate; amount: Money }>;
  recordPlanSale(
    tx: TxContext,
    input: {
      propertyId: string;
      ratePlanId: string;
      unitTypeId: string;
      nights: DateRange;
      quantity?: number;
      ref: EntityRef;
    },
  ): Promise<void>;
  releasePlanSale(tx: TxContext, input: { ref: EntityRef; nights?: DateRange }): Promise<void>;
}

// ───────────────────────────── mapping: rates' document → reservations' view ─────────────────────────────

const RATES_TERMS_KIND = 'portico.rates.terms';

function taxLine(t: RatesTaxLine): TaxLine {
  return {
    code: t.ruleCode,
    name: t.ruleName,
    kind: t.category,
    amount: t.amount,
    ruleVersionId: t.ruleVersionId,
    basis: t.basis,
  };
}

export function penaltyView(p: RatesPenalty, currency: string): Penalty {
  switch (p.kind) {
    case 'none':
    case 'first_night':
      return { kind: p.kind };
    case 'nights':
      return { kind: 'nights', nights: p.nights };
    case 'percent_of_stay':
      return { kind: 'percent_of_stay', percent: Number(p.percent) };
    case 'amount':
      return { kind: 'amount', amount: money(p.amountMinor, currency) };
  }
}

/** A deadline as days before arrival at a local time (hours before check-in resolved against the check-in time). */
function deadlineView(d: RatesDeadline, checkInTime: string): { daysBeforeArrival: number; time: string } {
  if (d.kind === 'days_before_arrival') return { daysBeforeArrival: d.days, time: d.time };
  const [hh, mm] = checkInTime.split(':').map(Number);
  let minutes = (hh ?? 0) * 60 + (mm ?? 0) - (d.kind === 'hours_before_checkin' ? d.hours * 60 : 0);
  let days = 0;
  while (minutes < 0) {
    minutes += 1440;
    days += 1;
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return { daysBeforeArrival: days, time: `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}` };
}

function cancellationView(doc: RatesTermsDocument): CancellationPolicy {
  const c = doc.policies.cancellation;
  if (!c) return { tiers: [], noShow: { kind: 'none' }, text: 'Free cancellation (no cancellation policy).' };
  const s = c.structure;
  const atBooking = s.tiers.find((t) => t.from.kind === 'at_booking');
  return {
    ...(atBooking
      ? { nonRefundable: true, nonRefundablePenalty: penaltyView(atBooking.penalty, doc.currency) }
      : {}),
    tiers: s.tiers
      .filter((t) => t.from.kind !== 'at_booking')
      .map((t) => ({
        deadline: deadlineView(t.from, doc.checkInTime),
        penalty: penaltyView(t.penalty, doc.currency),
      })),
    noShow: penaltyView(s.noShow, doc.currency),
    earlyDeparture: penaltyView(s.earlyDeparture, doc.currency),
    basis: s.basis === 'net' ? 'net' : 'gross',
    text: c.text,
  };
}

function depositItemView(
  i: NonNullable<RatesTermsDocument['policies']['deposit']>['structure']['items'][number],
  currency: string,
): DepositItem {
  const due = { anchor: i.due.anchor, offsetDays: i.due.offsetDays };
  switch (i.amount.basis) {
    case 'percent':
      return { kind: i.kind, basis: 'percent', value: Number(i.amount.percent), due };
    case 'nights':
      return { kind: i.kind, basis: 'nights', value: i.amount.nights, due };
    case 'amount':
      return { kind: i.kind, basis: 'amount', amount: money(i.amount.amountMinor, currency), due };
    case 'remaining':
      return { kind: i.kind, basis: 'remaining', due };
  }
}

/**
 * Reservations' view of rates' agreed terms. The document itself is kept VERBATIM under `providerDocument` (stored
 * with the view, sealed by rates) and is what goes back to rates; the view is never sent to rates.
 */
export function termsView(doc: RatesTermsDocument): TermsSnapshot {
  const names = new Map(doc.inclusions.map((i) => [i.code, i.name]));
  const nights = new Map(
    doc.nights.map((n) => [
      n.date,
      {
        date: n.date,
        net: n.net,
        taxes: n.taxes.map(taxLine),
        inclusions: n.components
          .filter((c) => c.kind !== 'room')
          .map((c) => ({ code: c.code, name: names.get(c.code) ?? c.code, amount: c.amount })),
      },
    ]),
  );
  // Components added to the stay (add-on packages) belong to a night: they count in that night's figures.
  for (const c of doc.addedComponents) {
    const n = nights.get(c.nightDate);
    if (!n) continue;
    n.net = add(n.net, c.net);
    n.taxes.push(...c.taxes.map(taxLine));
    n.inclusions.push({ code: c.code, name: c.name, amount: c.net });
  }
  const g = doc.policies.guarantee;
  const accepted = g?.structure.accepted ?? ['none'];
  const override = doc.priceOverride;
  return {
    schemaVersion: doc.schemaVersion,
    propertyId: doc.propertyId,
    ratePlanId: doc.ratePlan.id,
    ratePlanVersion: doc.ratePlan.version,
    unitTypeId: doc.unitTypeId,
    occupancy: { adults: doc.occupancy.adults, childrenAges: [...doc.occupancy.childrenAges] },
    currency: doc.currency,
    priceSource: doc.priceSource,
    nights: [...nights.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
    inclusions: doc.inclusions.map((i) => ({ code: i.code, name: i.name })),
    totals: { net: doc.totals.net, taxes: doc.totals.taxes, fees: doc.totals.fees, gross: doc.totals.gross },
    policies: {
      cancellation: cancellationView(doc),
      guarantee: {
        // `accepted` lists the guarantees that secure the booking; when 'none' is acceptable none is required.
        required: accepted.includes('none') ? ['none'] : [...accepted],
        ...(g?.structure.holdUntil ? { releaseTime: g.structure.holdUntil } : {}),
      },
      deposit: {
        items: (doc.policies.deposit?.structure.items ?? []).map((i) => depositItemView(i, doc.currency)),
      },
    },
    ...(doc.commission
      ? {
          commission: {
            kind: doc.commission.model === 'net' ? ('net_rate' as const) : ('percent' as const),
            ...(doc.commission.percent !== undefined ? { percent: Number(doc.commission.percent) } : {}),
          },
        }
      : {}),
    ...(override
      ? {
          override: {
            kind:
              override.kind === 'complimentary' || override.kind === 'house_use'
                ? override.kind
                : ('manual' as const),
            reason: override.reason,
            approvedBy: override.by,
          },
        }
      : {}),
    quotedAt: doc.quotedAt,
    providerDocument: doc,
  };
}

/** The rates document stored inside a view, passed back to rates exactly as stored (seal intact). */
export function ratesDocumentOf(view: TermsSnapshot): RatesTermsDocument {
  const doc = view.providerDocument;
  if (
    typeof doc !== 'object' ||
    doc === null ||
    (doc as { kind?: unknown }).kind !== RATES_TERMS_KIND ||
    typeof (doc as { seal?: unknown }).seal !== 'string'
  ) {
    throw new DomainError(
      'terms_not_from_rates',
      'These agreed terms were not issued by the rates module (for example they were imported, or recorded before rates was connected), so rates cannot re-price or evaluate them. Re-quote the stay to replace them with sealed terms.',
      { status: 422 },
    );
  }
  return doc as RatesTermsDocument;
}

function offerView(o: RatesOffer): Offer {
  const terms = termsView(o.terms);
  return {
    unitTypeId: o.unitTypeId,
    ratePlanId: o.ratePlanId,
    ratePlanName: o.ratePlanName,
    nightly: o.nightly.map((n) => ({ date: n.date, amount: n.net })),
    inclusions: o.inclusions.included.map((i) => ({ code: i.code, name: i.name })),
    taxesAndFees: o.taxesAndFees.map(taxLine),
    totals: { net: o.totals.net, taxes: o.totals.taxes, fees: o.totals.fees, gross: o.totals.gross },
    policies: terms.policies,
    restrictionViolations: o.restrictionViolations.map((v) => ({ code: v.kind, message: v.message })),
    terms,
  };
}

const occupancyOf = (o: Occupancy) => ({ adults: o.adults, childrenAges: [...(o.childrenAges ?? [])] });

/**
 * Bind reservations' RatesPort to the rates module (pending-fixes "ratesPortFrom"). Rates owns the pricing
 * contract: its sealed document is stored verbatim (inside the view) and passed back unchanged; reservations reads
 * only the view. Quotes and price changes are evaluated "now" by rates: reservations' business date is not a
 * backdated quote (rates requires `rates.quote.backdate` for other dates), so `bookingDate` / `asOf` are not sent.
 */
export function ratesPortFrom(rates: RatesProvider): RatesPort {
  return {
    async quote(tx, input) {
      const offers = await rates.quote(tx, {
        propertyId: input.propertyId,
        nights: input.nights,
        occupancy: occupancyOf(input.occupancy),
        ...(input.unitTypeIds ? { unitTypeIds: input.unitTypeIds } : {}),
        ...(input.ratePlanIds ? { ratePlanIds: input.ratePlanIds } : {}),
        ...(input.channelId ? { channelId: input.channelId } : {}),
        ...(input.companyId ? { companyId: input.companyId } : {}),
        ...(input.promoCode ? { promoCode: input.promoCode } : {}),
      });
      return offers.map(offerView);
    },
    evaluateCancellationPenalty(terms, at, opts) {
      const doc = ratesDocumentOf(terms);
      const e = rates.evaluateCancellationPenalty(doc, at, { event: opts.event, nights: opts.nights });
      return {
        event: e.event,
        at: e.at,
        nights: e.nights,
        tier: e.tier,
        penalty: penaltyView(e.penalty, doc.currency),
        basisAmount: e.basisAmount,
        amount: e.amount,
        description: e.description,
      };
    },
    async complimentaryTerms(tx, input) {
      return termsView(
        await rates.complimentaryTerms(tx, {
          terms: ratesDocumentOf(input.terms),
          kind: input.kind,
          reason: input.reason,
        }),
      );
    },
    async termsFromChannelPrices() {
      // Rates does not build channel-price terms yet (rates README gap; pending-fixes "channel-price terms").
      throw new DomainError(
        'channel_terms_not_available',
        "Portico cannot yet turn a channel's delivered prices into agreed terms (rates must recompute every tax for them), so this channel booking was not recorded. The channel will redeliver it; meanwhile enter it from the channel extranet as a desk booking.",
        { status: 503, retryable: true, details: { module: 'rates', operation: 'termsFromChannelPrices' } },
      );
    },
    async priceChange(tx, input) {
      const c = input.change;
      const r = await rates.priceChange(tx, {
        terms: ratesDocumentOf(input.terms),
        change: {
          nights: c.nights,
          unitTypeId: c.unitTypeId,
          ratePlanId: c.ratePlanId,
          occupancy: occupancyOf(c.occupancy),
          ...(c.typeChange ? { typeChange: c.typeChange } : {}),
        },
      });
      return {
        nightly: r.nightly.map((n) => ({ date: n.date, before: n.before, after: n.after })),
        penalties: r.penalties.map((p) => ({ kind: p.kind, amount: p.amount, description: p.description })),
        terms: termsView(r.terms),
      };
    },
    recordPlanSale: (tx, input) => rates.recordPlanSale(tx, input),
    releasePlanSale: (tx, input) => rates.releasePlanSale(tx, input),
    instantiatePaymentSchedule(terms, opts) {
      return rates
        .instantiatePaymentSchedule(
          ratesDocumentOf(terms),
          opts?.bookingDate ? { bookingDate: opts.bookingDate } : {},
        )
        .map((i) => ({ kind: i.kind, dueDate: i.dueDate, amount: i.amount }));
    },
  };
}
