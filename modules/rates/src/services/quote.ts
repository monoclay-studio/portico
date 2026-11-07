/**
 * Quote engine, change previews and price overrides (RAT-R27..R30). Configuration is loaded once, then everything
 * is computed by the pure domain (`priceNights` → `assemble`), so quotes are deterministic for the same
 * configuration vector.
 *
 * Who is asking decides what they may see (R-04): channels and the booking engine get their channel from the
 * authenticated principal (never from the request), always quote "today" in the property's time zone, cannot
 * name a company and never see unbookable offers or override restrictions.
 */
import { sql, type TxContext } from '@portico/db';
import {
  BusinessRuleError,
  canonicalJson,
  type DateRange,
  DomainError,
  type EntityRef,
  eachNight,
  ForbiddenError,
  instantToZoned,
  type LocalDate,
  localDateIn,
  NotFoundError,
  newId,
  type Occupancy,
  requirePermission,
  sha256Hex,
  ValidationError,
  zonedTimeToInstant,
} from '@portico/kernel';
import {
  cancellationStructure,
  depositStructure,
  guaranteeStructure,
  type InclusionSnapshot,
  type OccupancyPricing,
  type Offer,
  priceChangeRequest,
  priceOverrideRequest,
  quoteRequest,
  type RatePlanDto,
  type RepricingResult,
  type TermsSnapshot,
  type Violation,
} from '../contracts';
import { earlierDate, laterDate } from '../domain/calendar';
import { TaxConfigurationError } from '../domain/errors';
import {
  type Assembled,
  type AssembleInput,
  assemble,
  checkEligibility,
  type NightDraft,
  type PlanMeta,
  type PlanPolicies,
  type PolicySnapshot,
  priceNights,
  toOffer,
} from '../domain/offer';
import { ancestry, type ChildAgeBand, DEFAULT_CHILD_AGE_BANDS } from '../domain/pricing';
import { effectiveRestrictions, evaluateRestrictions, type RestrictionRow } from '../domain/restrictions';
import type { LoadedTaxRule } from '../domain/tax-engine';
import { applyPriceOverride, reprice, verifyTerms } from '../domain/terms';
import type { RatesPorts, RatesPropertyInfo } from '../ports';
import { restrictionValues, rowParams } from './calendar';
import { assertPackagesAtProperty, inclusionsForPackages, toPromotionCandidate } from './catalog';
import { derivationSteps, effectivePackageIds, restrictionChain } from './plan-chain';
import { asNodes, effectivePolicyId, loadPlansForProperty } from './rate-plans';
import { actorKey, db, parseInput, type Row } from './shared';
import { loadTaxRulesForProperty } from './tax-rules';

export interface QuoteDeps {
  ports: RatesPorts;
  /** Server key that seals agreed terms (never leaves the server). */
  sealKey: string;
}

export interface QuoteResult {
  quoteId: string;
  configVector: string;
  offers: Offer[];
}

// ───────────────────────────── Who is asking ─────────────────────────────

interface Principal {
  /** Staff (users, trusted system processes) vs. external sellers (API-client channels, booking engine). */
  staff: boolean;
  channelId: string | undefined;
}

async function principalOf(
  ports: RatesPorts,
  tx: TxContext,
  requestedChannel: string | undefined,
): Promise<Principal> {
  const a = tx.actor;
  if (a.kind === 'user' || a.kind === 'system') return { staff: true, channelId: requestedChannel };
  const bound =
    a.kind === 'api_client'
      ? ((await ports.channelForApiClient?.(tx, a.clientId)) ?? `api_client:${a.clientId}`)
      : 'booking_engine';
  if (requestedChannel !== undefined && requestedChannel !== bound) {
    throw new ForbiddenError('rates.quote.channel', { requestedChannel, channel: bound });
  }
  return { staff: false, channelId: bound };
}

/** Quotes are for today in the property's time zone; anything else needs `rates.quote.backdate` (staff only). */
function resolveBookingDate(
  tx: TxContext,
  principal: Principal,
  propertyId: string,
  today: LocalDate,
  requested?: LocalDate,
) {
  if (requested === undefined || requested === today) return today;
  if (!principal.staff || !tx.authz.can('rates.quote.backdate', { propertyId })) {
    throw new ForbiddenError('rates.quote.backdate', { propertyId });
  }
  return requested;
}

async function assertRatesManagedHere(ports: RatesPorts, tx: TxContext, propertyId: string): Promise<void> {
  let external: string | null = null;
  try {
    if ((await ports.assertWritable(tx, propertyId, 'rates')) === 'forward') external = 'an external system';
  } catch (err) {
    if (err instanceof DomainError && err.code === 'external_system_of_record')
      external = 'an external system';
    else throw err;
  }
  if (external) {
    throw new BusinessRuleError(
      'rates_managed_externally',
      'Room rates at this property are managed in an external system of record, so Portico does not quote rooms or create agreed terms here. Quote in that system; Portico mirrors the booking when it arrives.',
      { propertyId, domain: 'rates' },
    );
  }
}

// ───────────────────────────── Configuration ─────────────────────────────

async function childBands(ports: RatesPorts, tx: TxContext, propertyId: string): Promise<ChildAgeBand[]> {
  const r = await ports.resolvePolicy<ChildAgeBand[]>(tx, propertyId, 'rates.childAgeBands', [
    ...DEFAULT_CHILD_AGE_BANDS,
  ]);
  return r.value;
}

/** Everything a quote reads, loaded once (and the source of the configuration vector). */
interface QuoteConfig {
  property: RatesPropertyInfo;
  plans: Array<RatePlanDto & { parentId: string | null }>;
  priceRows: Array<Row<'rates.prices'>>;
  restrictionRows: Array<Row<'rates.restrictions'>>;
  promotions: Array<Row<'rates.promotions'>>;
  policies: Map<string, Row<'rates.policies'>>;
  inclusionsByPlan: Map<string, InclusionSnapshot[]>;
  sales: Array<{ rate_plan_id: string; unit_type_id: string; stay_date: string; quantity: number }>;
  taxRules: LoadedTaxRule[];
  bands: ChildAgeBand[];
}

async function loadQuoteConfig(
  ports: RatesPorts,
  tx: TxContext,
  input: {
    propertyId: string;
    arrival: LocalDate;
    departure: LocalDate;
    planIds: (plans: Array<RatePlanDto & { parentId: string | null }>) => string[];
    unitTypeIds?: readonly string[] | undefined;
    addOnPackageIds?: readonly string[] | undefined;
    agreedVersionIds?: readonly string[] | undefined;
  },
): Promise<QuoteConfig & { candidateIds: string[] }> {
  const property = await ports.getProperty(tx, input.propertyId);
  const plans = asNodes(await loadPlansForProperty(tx, input.propertyId));
  const candidateIds = input.planIds(plans);
  const chainIds = new Set(candidateIds.flatMap((id) => ancestry(plans, id).map((p) => p.id)));
  const rootIds = [
    ...new Set(candidateIds.map((id) => ancestry(plans, id)[0]?.id).filter((x): x is string => !!x)),
  ];
  let priceQ = db(tx)
    .selectFrom('rates.prices')
    .selectAll()
    .where('stay_date', '>=', input.arrival)
    .where('stay_date', '<', input.departure);
  priceQ =
    rootIds.length > 0 ? priceQ.where('rate_plan_id', 'in', rootIds) : priceQ.where(sql<boolean>`false`);
  if (input.unitTypeIds && input.unitTypeIds.length > 0)
    priceQ = priceQ.where('unit_type_id', 'in', [...input.unitTypeIds]);
  const priceRows = await priceQ.execute();
  const restrictionRows = await db(tx)
    .selectFrom('rates.restrictions')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('stay_date', '>=', input.arrival)
    .where('stay_date', '<=', input.departure)
    .where((eb) =>
      chainIds.size > 0
        ? eb.or([eb('rate_plan_id', 'is', null), eb('rate_plan_id', 'in', [...chainIds])])
        : eb('rate_plan_id', 'is', null),
    )
    .execute();
  const promotions = await db(tx)
    .selectFrom('rates.promotions')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('status', '=', 'active')
    .execute();
  const policyIds = new Set<string>();
  const inclusionsByPlan = new Map<string, InclusionSnapshot[]>();
  const addOnIds = [...new Set(input.addOnPackageIds ?? [])];
  if (addOnIds.length > 0) await assertPackagesAtProperty(tx, input.propertyId, addOnIds);
  const addOns = await inclusionsForPackages(tx, addOnIds);
  for (const id of candidateIds) {
    const chain = ancestry(plans, id);
    for (const k of ['cancellationPolicy', 'guaranteePolicy', 'depositPolicy'] as const) {
      const pid = effectivePolicyId(chain, k);
      if (pid) policyIds.add(pid);
    }
    const own = await inclusionsForPackages(tx, effectivePackageIds(chain));
    // Add-on packages are charged on top of the plan price (never allocated out of it).
    const extra = addOns
      .filter((a) => !own.some((i) => i.id === a.id))
      .map((a) => ({ ...a, priceMode: 'added' as const }));
    inclusionsByPlan.set(id, [...own, ...extra]);
  }
  const policyRows =
    policyIds.size > 0
      ? await db(tx)
          .selectFrom('rates.policies')
          .selectAll()
          .where('id', 'in', [...policyIds])
          .execute()
      : [];
  // Sales of every plan and unit type: a limit may be scoped to all plans or all unit types.
  const sales = await db(tx)
    .selectFrom('rates.plan_sales')
    .select(['rate_plan_id', 'unit_type_id', 'stay_date', 'quantity'])
    .where('property_id', '=', input.propertyId)
    .where('stay_date', '>=', input.arrival)
    .where('stay_date', '<', input.departure)
    .where('released_at', 'is', null)
    .execute();
  return {
    property,
    plans,
    priceRows,
    restrictionRows,
    promotions,
    policies: new Map(policyRows.map((p) => [p.id, p])),
    inclusionsByPlan,
    sales,
    taxRules: await loadTaxRulesForProperty(tx, property, { agreedVersionIds: input.agreedVersionIds }),
    bands: await childBands(ports, tx, input.propertyId),
    candidateIds,
  };
}

/** Version vector of everything the quote read: same vector + same request ⇒ same result (RAT-R30). */
function configVector(c: QuoteConfig): string {
  const parts = [
    `property:${canonicalJson({
      country: c.property.countryCode,
      tz: c.property.timezone,
      checkIn: c.property.checkInTime,
      currency: c.property.baseCurrency,
      classification: c.property.classification,
    })}`,
    ...c.plans.map((p) => `plan:${p.id}:${p.version}`),
    ...c.priceRows.map((r) => `price:${r.id}:${r.version}`),
    ...c.restrictionRows.map((r) => `restriction:${r.id}:${r.version}`),
    ...c.promotions.map((r) => `promotion:${r.id}:${r.version}`),
    ...[...c.policies.values()].map((r) => `policy:${r.id}:${r.version}`),
    ...[...c.inclusionsByPlan.values()].flat().map((i) => `inclusion:${i.id}:${i.version}:${i.priceMode}`),
    ...c.taxRules.flatMap((r) => r.versions.map((v) => `tax:${v.id}:${v.effectiveFrom}:${v.effectiveTo}`)),
    ...c.sales.map((s) => `sold:${s.rate_plan_id}:${s.unit_type_id}:${s.stay_date}:${s.quantity}`),
    `bands:${canonicalJson(c.bands)}`,
  ].sort();
  return `cv1:${sha256Hex(parts.join('\n')).slice(0, 32)}`;
}

function planPolicies(c: QuoteConfig, chain: RatePlanDto[]): PlanPolicies {
  const snap = <T>(id: string | null, parse: (v: unknown) => T): PolicySnapshot<T> | null => {
    const r = id ? c.policies.get(id) : undefined;
    return r && r.status === 'active'
      ? { id: r.id, code: r.code, name: r.name, version: r.version, structure: parse(r.structure) }
      : null;
  };
  return {
    cancellation: snap(effectivePolicyId(chain, 'cancellationPolicy'), (v) => cancellationStructure.parse(v)),
    guarantee: snap(effectivePolicyId(chain, 'guaranteePolicy'), (v) => guaranteeStructure.parse(v)),
    deposit: snap(effectivePolicyId(chain, 'depositPolicy'), (v) => depositStructure.parse(v)),
  };
}

function rootPricesFor(c: QuoteConfig, rootId: string, unitTypeId: string): Map<LocalDate, OccupancyPricing> {
  return new Map(
    c.priceRows
      .filter((r) => r.rate_plan_id === rootId && r.unit_type_id === unitTypeId)
      .map((r) => [r.stay_date, rowParams(r)]),
  );
}

function restrictionRowsFor(c: QuoteConfig): RestrictionRow[] {
  return c.restrictionRows.map((r) => ({
    ratePlanId: r.rate_plan_id,
    unitTypeId: r.unit_type_id,
    date: r.stay_date,
    values: restrictionValues(r),
  }));
}

/** Units sold on a night within a restriction's scope (its plan or all plans × its unit type or all types). */
function soldWithin(
  sales: QuoteConfig['sales'],
  date: LocalDate,
  scope: { ratePlanId: string | null; unitTypeId: string | null },
  planIfOwn: string,
): number {
  const plan = scope.ratePlanId === null ? null : (scope.ratePlanId ?? planIfOwn);
  return sales
    .filter(
      (s) =>
        s.stay_date === date &&
        (plan === null || s.rate_plan_id === plan) &&
        (scope.unitTypeId === null || s.unit_type_id === scope.unitTypeId),
    )
    .reduce((n, s) => n + s.quantity, 0);
}

interface PriceForPlanInput {
  planId: string;
  unitTypeId: string;
  arrival: LocalDate;
  departure: LocalDate;
  nights: LocalDate[];
  occupancy: Occupancy;
  bookingDate: LocalDate;
  channelId?: string | undefined;
  promoCode?: string | undefined;
}

/** Night drafts + restriction violations for one plan × unit type (current configuration). */
function priceForPlan(c: QuoteConfig, i: PriceForPlanInput) {
  const chain = ancestry(c.plans, i.planId);
  const root = chain[0] as RatePlanDto;
  const plan = chain[chain.length - 1] as RatePlanDto;
  const priced = priceNights({
    nights: i.nights,
    rootPrices: rootPricesFor(c, root.id, i.unitTypeId),
    steps: derivationSteps(chain),
    unitTypeId: i.unitTypeId,
    ratePlanId: plan.id,
    occupancy: i.occupancy,
    bands: c.bands,
    promotions: c.promotions.map(toPromotionCandidate),
    promotionContext: {
      arrival: i.arrival,
      departure: i.departure,
      nights: eachNight({ from: i.arrival, to: i.departure }).length,
      bookingDate: i.bookingDate,
      channelId: i.channelId,
      unitTypeId: i.unitTypeId,
      ratePlanId: plan.id,
      promoCode: i.promoCode,
      planIsContracted: !!plan.eligibility.companyIds || plan.commission?.model === 'net',
    },
    currency: plan.currency,
  });
  const restrictionViolations = evaluateRestrictions({
    arrival: i.arrival,
    departure: i.departure,
    bookingDate: i.bookingDate,
    effective: effectiveRestrictions(restrictionRowsFor(c), restrictionChain(chain), i.unitTypeId),
    soldFor: (date, scope) => soldWithin(c.sales, date, scope, plan.id),
  });
  return { chain, plan, priced, restrictionViolations };
}

function planMeta(plan: RatePlanDto, chain: RatePlanDto[]): PlanMeta {
  return {
    id: plan.id,
    code: plan.code,
    name: plan.name,
    version: plan.version,
    currency: plan.currency,
    mealPlan: plan.mealPlan,
    roomChargeCode: plan.roomChargeCode,
    marketSegment: plan.marketSegment,
    taxInclusion: plan.taxInclusion,
    commission: plan.commission,
    chain: chain.map((p) => ({ id: p.id, code: p.code, version: p.version })),
  };
}

/**
 * Assemble one offer; a tax configuration problem (missing classification, FX rate, band gap…) makes THIS offer
 * unbookable with an explanation instead of failing the whole quote (R-06).
 */
function assembleIsolated(input: AssembleInput): { assembled: Assembled; failure: Violation | null } {
  try {
    return { assembled: assemble(input), failure: null };
  } catch (err) {
    if (!(err instanceof TaxConfigurationError)) throw err;
    return {
      assembled: assemble({ ...input, taxRules: [] }),
      failure: {
        kind: 'tax_computation_failed',
        date: null,
        message: `Taxes could not be computed: ${err.message}`,
        required: null,
        actual: null,
        overridable: false,
        source: null,
      },
    };
  }
}

const RELEVANCE_FILTER: ReadonlySet<Violation['kind']> = new Set([
  'not_eligible_channel',
  'not_eligible_company',
]);

/** Provider (domain map) + HTTP: price a stay request into offers. */
export async function quoteDetailed(deps: QuoteDeps, tx: TxContext, raw: unknown): Promise<QuoteResult> {
  const { ports } = deps;
  const req = parseInput(quoteRequest, raw);
  requirePermission(tx, 'rates.quote.read', { propertyId: req.propertyId });
  const principal = await principalOf(ports, tx, req.channelId);
  if (req.restrictionOverride) {
    if (!principal.staff || principal.channelId) {
      throw new ValidationError(
        'override_not_allowed_for_channels',
        'Restriction overrides are for staff bookings only; channels and the booking engine can never book through restrictions.',
      );
    }
    requirePermission(tx, 'rates.restriction.override', { propertyId: req.propertyId });
  }
  if (req.companyId) {
    if (!principal.staff) {
      throw new ForbiddenError('rates.quote.company', {
        reason: 'Only staff can quote negotiated company rates.',
      });
    }
    if (ports.companyExists && !(await ports.companyExists(tx, req.companyId))) {
      throw new NotFoundError('company', req.companyId);
    }
  }
  await assertRatesManagedHere(ports, tx, req.propertyId);
  const arrival = req.nights.from;
  const departure = req.nights.to;
  if (eachNight(req.nights).length > 366)
    throw new ValidationError('stay_too_long', 'A quote can cover at most 366 nights.');
  const config = await loadQuoteConfig(ports, tx, {
    propertyId: req.propertyId,
    arrival,
    departure,
    unitTypeIds: req.unitTypeIds,
    addOnPackageIds: req.addOnPackageIds,
    planIds: (plans) =>
      plans
        .filter((p) =>
          req.ratePlanIds ? req.ratePlanIds.includes(p.id) && p.status !== 'retired' : p.status === 'active',
        )
        .map((p) => p.id),
  });
  if (req.ratePlanIds) {
    const missing = req.ratePlanIds.filter((id) => !config.plans.some((p) => p.id === id));
    if (missing.length > 0) throw new NotFoundError('rate_plan', missing[0]);
  }
  const today = localDateIn(tx.now, config.property.timezone);
  const bookingDate = resolveBookingDate(tx, principal, req.propertyId, today, req.bookingDate);
  const vector = configVector(config);
  const quoteId = newId();
  const nights = eachNight(req.nights);
  const offers: Offer[] = [];
  for (const planId of config.candidateIds) {
    const chain = ancestry(config.plans, planId);
    const plan = chain[chain.length - 1] as RatePlanDto;
    const root = chain[0] as RatePlanDto;
    const unitTypes =
      req.unitTypeIds ??
      [
        ...new Set(config.priceRows.filter((r) => r.rate_plan_id === root.id).map((r) => r.unit_type_id)),
      ].sort();
    for (const unitTypeId of unitTypes) {
      const eligibility = checkEligibility(plan, {
        channelId: principal.channelId,
        companyId: req.companyId,
        occupancy: req.occupancy,
        bookingDate,
        arrival,
        departure,
      });
      if (eligibility.some((v) => RELEVANCE_FILTER.has(v.kind))) continue;
      const p = priceForPlan(config, {
        planId,
        unitTypeId,
        arrival,
        departure,
        nights,
        occupancy: req.occupancy,
        bookingDate,
        channelId: principal.channelId,
        promoCode: req.promoCode,
      });
      const violations = [...eligibility, ...p.priced.violations, ...p.restrictionViolations];
      const overridable = violations.filter((v) => v.overridable);
      const useOverride = !!req.restrictionOverride && overridable.length > 0;
      const meta = planMeta(plan, chain);
      const { assembled, failure } = assembleIsolated({
        property: {
          id: config.property.id,
          timezone: config.property.timezone,
          checkInTime: config.property.checkInTime,
          classification: config.property.classification,
        },
        plan: meta,
        unitTypeId,
        arrival,
        departure,
        bookingDate,
        occupancy: req.occupancy,
        bands: config.bands,
        drafts: p.priced.drafts,
        inclusions: config.inclusionsByPlan.get(planId) ?? [],
        promotions: p.priced.chosen,
        policies: planPolicies(config, chain),
        taxRules: config.taxRules,
        meta: {
          quoteId,
          quotedAt: tx.now.toISOString(),
          configVector: vector,
          priceSource: 'portico_quote',
          restrictionOverride: useOverride
            ? {
                reason: req.restrictionOverride?.reason ?? '',
                by: actorKey(tx),
                at: tx.now.toISOString(),
                violations: overridable,
              }
            : null,
          supersedesSeal: null,
          sealKey: deps.sealKey,
        },
      });
      offers.push(
        toOffer(assembled, {
          unitTypeId,
          plan: meta,
          violations: failure ? [...violations, failure] : violations,
          override: useOverride,
        }),
      );
    }
  }
  // Channels and the booking engine never see unbookable offers (RAT-I07).
  const visible = principal.staff && !principal.channelId ? offers : offers.filter((o) => o.bookable);
  visible.sort(
    (a, b) =>
      Number(b.bookable) - Number(a.bookable) ||
      a.totals.gross.amountMinor - b.totals.gross.amountMinor ||
      a.ratePlanCode.localeCompare(b.ratePlanCode) ||
      a.unitTypeId.localeCompare(b.unitTypeId),
  );
  const overridden = visible.filter((o) => o.overriddenViolations.length > 0);
  if (overridden.length > 0) {
    await tx.audit({
      action: 'rates.quote.restrictionOverride',
      target: { type: 'quote', id: quoteId },
      propertyId: req.propertyId,
      reason: req.restrictionOverride?.reason ?? null,
      after: overridden.map((o) => ({
        ratePlanId: o.ratePlanId,
        unitTypeId: o.unitTypeId,
        violations: o.overriddenViolations.map((v) => v.kind),
      })),
    });
  }
  return { quoteId, configVector: vector, offers: visible };
}

/** Provider (domain map): quote(tx, request) → Offer[]. */
export async function quote(deps: QuoteDeps, tx: TxContext, raw: unknown): Promise<Offer[]> {
  return (await quoteDetailed(deps, tx, raw)).offers;
}

// ───────────────────────────── Agreed terms in (verified) ─────────────────────────────

function assertSealed(deps: QuoteDeps, terms: unknown): asserts terms is TermsSnapshot {
  if (!verifyTerms(deps.sealKey, terms)) {
    throw new ValidationError(
      'terms_seal_invalid',
      'These agreed terms do not carry a valid Portico seal, so they may have been altered or come from elsewhere. Load the agreed terms again from the booking.',
    );
  }
}

/** asOf → instant. Today (or none) → now; another date/instant needs `rates.quote.backdate`. */
function resolveAsOf(tx: TxContext, terms: TermsSnapshot, asOf: string | undefined): Date {
  if (asOf === undefined) return tx.now;
  const localToday = instantToZoned(tx.now, terms.propertyTimezone).date;
  const at = /^\d{4}-\d{2}-\d{2}$/.test(asOf)
    ? asOf === localToday
      ? tx.now
      : zonedTimeToInstant(asOf, '12:00', terms.propertyTimezone)
    : new Date(asOf);
  if (Number.isNaN(at.getTime()))
    throw new ValidationError('invalid_as_of', 'asOf must be a date or an ISO instant.');
  if (Math.abs(at.getTime() - tx.now.getTime()) > 60_000) {
    const staff = tx.actor.kind === 'user' || tx.actor.kind === 'system';
    if (!staff || !tx.authz.can('rates.quote.backdate', { propertyId: terms.propertyId })) {
      throw new ForbiddenError('rates.quote.backdate', { propertyId: terms.propertyId });
    }
  }
  return at;
}

/** Provider (domain map): change preview keeping agreed nights at agreed prices; returns the new sealed terms. */
export async function priceChange(deps: QuoteDeps, tx: TxContext, raw: unknown): Promise<RepricingResult> {
  const { ports } = deps;
  const rawTerms = (raw as { terms?: unknown } | null)?.terms;
  assertSealed(deps, rawTerms);
  const { terms, change } = parseInput(priceChangeRequest, raw);
  requirePermission(tx, 'rates.quote.read', { propertyId: terms.propertyId });
  const range: DateRange = change.nights ?? { from: terms.stay.arrival, to: terms.stay.departure };
  const occupancy = change.occupancy ?? terms.occupancy;
  const unitTypeId = change.unitTypeId ?? terms.unitTypeId;
  const planChanged = change.ratePlanId !== undefined && change.ratePlanId !== terms.ratePlan.id;
  const targetPlanId = change.ratePlanId ?? terms.ratePlan.id;
  const newNightsPolicy =
    change.newNights ??
    (
      await ports.resolvePolicy<'current_rates' | 'agreed_average' | 'manual'>(
        tx,
        terms.propertyId,
        'reservations.repricing.newNights',
        'current_rates',
      )
    ).value;
  const typeChangePolicy =
    change.typeChange ??
    (
      await ports.resolvePolicy<'keep_agreed' | 'difference' | 'reprice'>(
        tx,
        terms.propertyId,
        'reservations.repricing.typeChange',
        'keep_agreed',
      )
    ).value;
  const changeAt = resolveAsOf(tx, terms, change.asOf);
  const agreedDates = new Set(terms.nights.map((n) => n.date));
  const newDates = eachNight(range);
  const typeChanged = unitTypeId !== terms.unitTypeId;
  const needCurrent =
    planChanged || (newDates.some((d) => !agreedDates.has(d)) && newNightsPolicy === 'current_rates');
  const needType = typeChanged && typeChangePolicy !== 'keep_agreed';
  const config = await loadQuoteConfig(ports, tx, {
    propertyId: terms.propertyId,
    arrival: earlierDate(range.from, terms.stay.arrival),
    departure: laterDate(range.to, terms.stay.departure),
    planIds: (plans) => (plans.some((p) => p.id === targetPlanId) ? [targetPlanId] : []),
    agreedVersionIds: terms.taxes.commercialRuleVersionIds,
  });
  if (planChanged && config.candidateIds.length === 0) throw new NotFoundError('rate_plan', targetPlanId);
  const planExists = config.candidateIds.length > 0;
  const property = config.property;
  const bookingDate = localDateIn(changeAt, property.timezone);
  let current: { drafts: Map<LocalDate, NightDraft>; violations: Violation[] } | null = null;
  let currentAgreedType: Map<LocalDate, NightDraft> | null = null;
  let newPlan: Parameters<typeof reprice>[0]['newPlan'];
  if ((needCurrent || needType) && planExists) {
    const p = priceForPlan(config, {
      planId: targetPlanId,
      unitTypeId,
      arrival: range.from,
      departure: range.to,
      nights: newDates,
      occupancy,
      bookingDate,
    });
    const arrivalChanged = range.from !== terms.stay.arrival;
    const departureChanged = range.to !== terms.stay.departure;
    const relevant = p.restrictionViolations.filter((v) => {
      if (planChanged) return true;
      if (v.date && !agreedDates.has(v.date) && newDates.includes(v.date)) return true;
      if (v.kind === 'closed_to_departure') return departureChanged;
      // Length-of-stay rules always matter for a changed stay; arrival rules only when the arrival moved.
      if (v.kind === 'min_los' || v.kind === 'max_los') return true;
      if (v.kind === 'closed_to_arrival' || v.kind === 'min_advance' || v.kind === 'max_advance')
        return arrivalChanged;
      return false;
    });
    const eligibility = planChanged
      ? checkEligibility(p.plan, {
          occupancy,
          bookingDate,
          arrival: range.from,
          departure: range.to,
        }).filter((v) => v.kind !== 'not_eligible_company' && v.kind !== 'not_eligible_channel')
      : [];
    current = {
      drafts: new Map(p.priced.drafts.map((d) => [d.date, d])),
      violations: [...eligibility, ...p.priced.violations, ...relevant],
    };
    if (planChanged) {
      newPlan = {
        plan: planMeta(p.plan, p.chain),
        inclusions: config.inclusionsByPlan.get(targetPlanId) ?? [],
        policies: planPolicies(config, p.chain),
        promotions: p.priced.chosen,
      };
    }
    if (needType && typeChangePolicy === 'difference' && !planChanged) {
      const old = priceForPlan(config, {
        planId: terms.ratePlan.id,
        unitTypeId: terms.unitTypeId,
        arrival: range.from,
        departure: range.to,
        nights: newDates,
        occupancy,
        bookingDate,
      });
      currentAgreedType = new Map(old.priced.drafts.map((d) => [d.date, d]));
    }
  } else if ((needCurrent || needType) && !planExists) {
    current = {
      drafts: new Map(),
      violations: [
        {
          kind: 'plan_not_active',
          date: null,
          message: `Rate plan ${terms.ratePlan.code} no longer exists; new nights cannot be priced at current rates. Use agreed average or manual pricing.`,
          required: null,
          actual: null,
          overridable: false,
          source: null,
        },
      ],
    };
  }
  return reprice({
    terms,
    range,
    occupancy,
    unitTypeId,
    newNightsPolicy,
    typeChangePolicy,
    manualAmountsMinor: change.manualNightAmountsMinor,
    current,
    currentAgreedType,
    newPlan,
    changeAt,
    property: {
      id: property.id,
      timezone: terms.propertyTimezone,
      checkInTime: terms.checkInTime,
      classification: property.classification,
    },
    taxRules: config.taxRules,
    meta: {
      quoteId: newId(),
      quotedAt: tx.now.toISOString(),
      configVector: configVector(config),
      sealKey: deps.sealKey,
    },
  });
}

// ───────────────────────────── Price override, complimentary, house use ─────────────────────────────

/**
 * Provider: a new sealed agreement with a manual price, or complimentary / house use (value-based taxes 0,
 * per-guest levies kept). Staff only, `rates.price.override` ⚑, reason required, audited.
 */
export async function overridePrice(deps: QuoteDeps, tx: TxContext, raw: unknown): Promise<TermsSnapshot> {
  assertSealed(deps, (raw as { terms?: unknown } | null)?.terms);
  const req = parseInput(priceOverrideRequest, raw);
  const terms = req.terms;
  if (!(tx.actor.kind === 'user' || tx.actor.kind === 'system')) {
    throw new ForbiddenError('rates.price.override', { propertyId: terms.propertyId });
  }
  requirePermission(tx, 'rates.price.override', { propertyId: terms.propertyId });
  const property = await deps.ports.getProperty(tx, terms.propertyId);
  const taxRules = await loadTaxRulesForProperty(tx, property, {
    agreedVersionIds: terms.taxes.commercialRuleVersionIds,
  });
  const next = applyPriceOverride({
    terms,
    override: req.override,
    reason: req.reason,
    by: actorKey(tx),
    at: tx.now.toISOString(),
    property: {
      id: property.id,
      timezone: terms.propertyTimezone,
      checkInTime: terms.checkInTime,
      classification: property.classification,
    },
    taxRules,
    meta: {
      quoteId: newId(),
      quotedAt: tx.now.toISOString(),
      configVector: terms.configVector,
      sealKey: deps.sealKey,
    },
  });
  await tx.audit({
    action: 'rates.terms.priceOverride',
    target: { type: 'terms', id: next.quoteId },
    propertyId: terms.propertyId,
    reason: req.reason,
    before: { seal: terms.seal, totals: terms.totals, priceSource: terms.priceSource },
    after: { seal: next.seal, totals: next.totals, priceSource: next.priceSource, kind: req.override.kind },
  });
  return next;
}

/** Provider: complimentary or house-use agreement from agreed terms (Green Tax per guest-day kept). */
export function complimentaryTerms(
  deps: QuoteDeps,
  tx: TxContext,
  input: { terms: TermsSnapshot; kind: 'complimentary' | 'house_use'; reason: string },
): Promise<TermsSnapshot> {
  return overridePrice(deps, tx, {
    terms: input.terms,
    override: { kind: input.kind },
    reason: input.reason,
  });
}

// ───────────────────────────── Plan sales (sales limits) ─────────────────────────────

/**
 * Provider: record that a stay consumes `quantity` of the sales limits that apply to its plan and unit type.
 * Called by reservations when a booking is confirmed, in the same transaction. Idempotent per ref and night.
 */
export async function recordPlanSale(
  tx: TxContext,
  input: {
    propertyId: string;
    ratePlanId: string;
    unitTypeId: string;
    nights: DateRange;
    quantity?: number;
    ref: EntityRef;
  },
): Promise<void> {
  const qty = input.quantity ?? 1;
  const plans = asNodes(await loadPlansForProperty(tx, input.propertyId));
  const chain = ancestry(plans, input.ratePlanId);
  if (chain.length === 0) throw new NotFoundError('rate_plan', input.ratePlanId);
  const dates = eachNight(input.nights);
  const rows = await db(tx)
    .selectFrom('rates.restrictions')
    .selectAll()
    .where('property_id', '=', input.propertyId)
    .where('stay_date', '>=', input.nights.from)
    .where('stay_date', '<', input.nights.to)
    .where('sales_limit', 'is not', null)
    .execute();
  const effective = effectiveRestrictions(
    rows.map((r) => ({
      ratePlanId: r.rate_plan_id,
      unitTypeId: r.unit_type_id,
      date: r.stay_date,
      values: restrictionValues(r),
    })),
    restrictionChain(chain),
    input.unitTypeId,
  );
  for (const date of dates) {
    // One lock per property-night: limits may span all plans or unit types, so sales of any plan serialize.
    await sql`select pg_advisory_xact_lock(hashtext(${`rates.sales:${input.propertyId}:${date}`}))`.execute(
      tx.db,
    );
    const already = await db(tx)
      .selectFrom('rates.plan_sales')
      .select(['id', 'released_at'])
      .where('rate_plan_id', '=', input.ratePlanId)
      .where('stay_date', '=', date)
      .where('ref_type', '=', input.ref.type)
      .where('ref_id', '=', input.ref.id)
      .executeTakeFirst();
    if (already && already.released_at === null) continue;
    const limit = effective.get(date)?.salesLimit;
    if (limit) {
      const sales = await db(tx)
        .selectFrom('rates.plan_sales')
        .select(['rate_plan_id', 'unit_type_id', 'stay_date', 'quantity'])
        .where('property_id', '=', input.propertyId)
        .where('stay_date', '=', date)
        .where('released_at', 'is', null)
        .execute();
      const sold = soldWithin(sales, date, limit.source, input.ratePlanId);
      if (sold + qty > (limit.value as number)) {
        throw new BusinessRuleError(
          'sales_limit_reached',
          `The sales limit of ${limit.value} for this rate on ${date} has been reached. Offer another rate.`,
          { ratePlanId: input.ratePlanId, date, limit: limit.value, sold },
        );
      }
    }
    if (already) {
      await db(tx)
        .updateTable('rates.plan_sales')
        .set({ released_at: null, quantity: qty, unit_type_id: input.unitTypeId })
        .where('id', '=', already.id)
        .execute();
      continue;
    }
    await db(tx)
      .insertInto('rates.plan_sales')
      .values({
        id: newId(),
        tenant_id: tx.tenantId,
        property_id: input.propertyId,
        rate_plan_id: input.ratePlanId,
        unit_type_id: input.unitTypeId,
        stay_date: date,
        ref_type: input.ref.type,
        ref_id: input.ref.id,
        quantity: qty,
        created_at: tx.now,
      })
      .execute();
  }
}

/** Provider: release a stay's plan consumption (cancellation, shortening). */
export async function releasePlanSale(
  tx: TxContext,
  input: { ref: EntityRef; nights?: DateRange },
): Promise<void> {
  let q = db(tx)
    .updateTable('rates.plan_sales')
    .set({ released_at: tx.now })
    .where('ref_type', '=', input.ref.type)
    .where('ref_id', '=', input.ref.id)
    .where('released_at', 'is', null);
  if (input.nights)
    q = q.where('stay_date', '>=', input.nights.from).where('stay_date', '<', input.nights.to);
  await q.execute();
}
