# @portico/rates

Rates answers *"what does this stay cost, under which conditions, with which taxes and fees, and what exactly did
we agree?"* It owns rate plans (base and derived), prices, restrictions, promotions, packages / inclusions /
allowances / meal plans, cancellation / guarantee / deposit policies, the **single tax & fee engine** used for
every charge in Portico, the **quote engine**, and the sealed **agreed terms** (`TermsSnapshot`).

**Rates owns the pricing contract** (orchestrator decision after the steward review): `quote`/`Offer`,
`TermsSnapshot`, `priceChange`, penalties, complimentary/house-use pricing, `ChargeLine`/`TaxLine` and
`computeTaxes`. The shapes in § Provider contract are canonical; reservations and finance adapt to them.

Spec: `docs/specs/rates.md` (Draft v1). Maldives tax facts: `docs/readiness/maldives-tax-rules.md` (MIRA-sourced).
Parity: `docs/parity/rates.md` (the parity researcher's matrix, statuses updated here; gate **not yet passing** —
see § Known gaps). Steward review: `docs/orchestration/reviews/review-rates.md`.

## Layout

| Path | What |
|---|---|
| `migrations/0001_rates.sql` | 14 tables, tenant-isolated (RLS forced); history append-only; tax versions column-level immutable; exclusion constraint for one active version per date |
| `templates/mv-tax-pack.json` | Maldives rule pack — **seed data**, never code (CLAUDE.md rule 13) |
| `src/contracts.ts` | Zod contracts (the canonical shapes below) |
| `src/domain/` | Pure logic + unit tests: `tax-engine`, `pricing`, `restrictions`, `promotions`, `inclusions`, `policies`, `offer`, `terms`, `terms-seal`, `calendar` |
| `src/services/` | Application services (permission → data authority → state → audit → events) |
| `src/service.ts` | `ratesService(ports, { termsSealKey })` — the bound provider object |
| `src/routes.ts`, `src/search.ts`, `src/seed.ts`, `src/seal-key.ts` | HTTP, global search, demo seed, terms seal key from env |

## Provider contract (canonical)

```ts
// Composition root
const rates = ratesService(ports: RatesPorts, { termsSealKey: termsSealKeyFromEnv().key });

// ── Quoting ───────────────────────────────────────────────────────────────────────────────────────
quote(tx, req: QuoteRequest): Promise<Offer[]>
quoteDetailed(tx, req: QuoteRequest): Promise<{ quoteId: Uuid; configVector: string; offers: Offer[] }>

interface QuoteRequest {
  propertyId: Uuid;
  nights: DateRange;                               // [arrival, departure)
  occupancy: { adults: number; childrenAges?: number[] };
  unitTypeIds?: Uuid[]; ratePlanIds?: Uuid[];
  channelId?: string;        // staff only (preview a channel's view). API clients / guests: derived from the
                             // principal (port channelForApiClient, else `api_client:<id>`; guest = 'booking_engine')
  companyId?: Uuid;          // staff only; verified through port companyExists when bound
  promoCode?: string;
  bookingDate?: LocalDate;   // default: today in the property time zone; other dates need rates.quote.backdate (staff)
  restrictionOverride?: { reason: string };      // staff + rates.restriction.override; never channels
  addOnPackageIds?: Uuid[];  // packages added to the stay on top of the plan
}

interface Offer {
  unitTypeId: Uuid; ratePlanId: Uuid; ratePlanCode: string; ratePlanName: string; mealPlan: string; currency: string;
  bookable: boolean;                               // non-staff never receive bookable === false
  nightly: NightPrice[];
  inclusions: { included: { inclusionId; code; name; priceMode }[]; added: AddedComponent[]; allowances: AllowanceEntitlement[] };
  taxesAndFees: TaxLine[];                         // every tax/fee line (domain-map shape)
  taxSummary: TaxSummaryLine[];                    // summed per rule (display)
  totals: { net: Money; taxes: Money; fees: Money; gross: Money; allInTotal: Money };   // net + taxes + fees = gross
  policies: OfferPolicies;                         // structured + rendered text + resolved tiers + payment schedule
  commission: CommissionTerms | null;
  restrictionViolations: Violation[]; overriddenViolations: Violation[];
  unverifiedTaxRules: string[];                    // rules not confirmed by a qualified adviser
  terms: TermsSnapshot;
}
interface NightPrice { date; baseAmount: Money; promotions: PromotionEffect[]; amount: Money;   // agreed night price
  components: PriceComponent[]; occupancyPricing: OccupancyPricing; taxes: TaxLine[]; net: Money; gross: Money }
interface PriceComponent { kind: 'room' | 'inclusion' | 'allowance'; inclusionId: Uuid | null; code: string;
  chargeCode: string; taxCategory: string; outletKind: string | null; amount: Money }
interface Violation { kind: ViolationKind; date: LocalDate | null; message: string; required: number | null;
  actual: number | null; overridable: boolean; source: { ratePlanId; unitTypeId } | null }
interface CommissionTerms { model: 'commissionable' | 'net'; percent?: string; amountPerNightMinor?: number;
  base: 'room_net' | 'stay_net' | 'stay_gross'; amount: Money; agencyCollects: boolean; invoiceable: Money }

// ── Agreed terms (TermsSnapshot v1) ─────────────────────────────────────────────────────────────────
interface TermsSnapshot {
  schemaVersion: 1; kind: 'portico.rates.terms'; quoteId; quotedAt; configVector;
  propertyId; propertyTimezone; checkInTime; currency;
  priceSource: 'portico_quote' | 'channel' | 'manual_override' | 'complimentary' | 'house_use';
  ratePlan: { id; code; name; version; mealPlan; roomChargeCode; marketSegment; derivationChain: { id; code; version }[] };
  unitTypeId; stay: { arrival; departure; nights }; bookingDate; occupancy; childAgeBands: { code; minAge; maxAge }[];
  taxInclusion: TaxInclusion;
  nights: NightPrice[]; addedComponents: AddedComponent[]; allowances: AllowanceEntitlement[]; inclusions: InclusionSnapshot[];
  promotions: { id; version; code; name; discount }[];
  policies: { cancellation: { id; code; name; version; text; structure: CancellationStructure;
                              tiers: { fromInstant: string | null; penalty: Penalty; description }[] } | null;
              guarantee: { id; code; name; version; text; structure } | null;
              deposit: { id; code; name; version; text; structure; schedule: ScheduleInstance[] } | null };
  commission: CommissionTerms | null;
  taxes: { summary: TaxSummaryLine[]; ruleVersionIds: Uuid[]; commercialRuleVersionIds: Uuid[] };
  totals: Totals;
  restrictionOverride: { reason; by; at; violations: Violation[] } | null;
  priceOverride: { kind: 'nightly' | 'total' | 'complimentary' | 'house_use'; reason; by; at;
                   original: { seal: string; totals: Totals } } | null;
  supersedesSeal: string | null;
  seal: string;              // 'hmac-sha256:…' over every other field with a server key
}
verifyTerms(terms: unknown): boolean               // checks the seal over the raw stored object

// ── Changes, overrides, penalties ───────────────────────────────────────────────────────────────────
priceChange(tx, { terms: TermsSnapshot; change: StayChangeRequest }): Promise<RepricingResult>  // seal verified
interface StayChangeRequest {    // strict: unknown keys are rejected
  nights?: DateRange; occupancy?: Occupancy; unitTypeId?: Uuid;
  ratePlanId?: Uuid;             // plan change: every night at current rates on the new plan + its policies
  newNights?: 'current_rates' | 'agreed_average' | 'manual';   // default policy reservations.repricing.newNights
  manualNightAmountsMinor?: Record<LocalDate, number>;
  typeChange?: 'keep_agreed' | 'difference' | 'reprice';      // default policy reservations.repricing.typeChange
  asOf?: LocalDate | string;     // ISO instant or business date; other than now needs rates.quote.backdate
}
interface RepricingResult {
  nightly: { date; before: Money | null; after: Money | null;
             source: 'agreed' | 'occupancy_repriced' | 'current_rates' | 'agreed_average' | 'manual' | 'removed'
                   | 'type_difference' | 'type_repriced' | 'plan_changed'; difference: Money }[];
  penalties: { kind: 'cancellation' | 'early_departure'; nights: LocalDate[]; amount: Money; description }[];
  before: Totals; after: Totals; difference: Money; violations: Violation[];
  terms: TermsSnapshot;          // the NEW sealed agreement (supersedes the old seal); persist only on commit
}
overridePrice(tx, { terms; override: { kind: 'nightly'; nightsMinor: Record<LocalDate, number> } | { kind: 'total';
  totalMinor: number } | { kind: 'complimentary' } | { kind: 'house_use' }; reason }): Promise<TermsSnapshot>
complimentaryTerms(tx, { terms; kind: 'complimentary' | 'house_use'; reason }): Promise<TermsSnapshot>
  // staff + rates.price.override ⚑; value-based taxes 0, per-guest levies (Green Tax) kept; audited
evaluateCancellationPenalty(terms, at: Date, opts?: { event?: 'cancellation' | 'no_show' | 'early_departure';
  nights?: LocalDate[] }): PenaltyEvaluation        // pure; basis default = night price + hotel fees (no levies)
interface PenaltyEvaluation { event; at; nights; tier: { fromInstant; description } | null; penalty: Penalty;
  basisAmount: Money; amount: Money; description }
instantiatePaymentSchedule(terms, opts?: { bookingDate?: LocalDate }): ScheduleInstance[]          // pure

// ── Posting (finance / Day Close) ──────────────────────────────────────────────────────────────────
postingPlan(terms, stayId): PostingLine[]           // keys room:{stay}:{night}, inclusion:{stay}:{inclusion}:{night}
postingChargeLines(terms, stayId): ChargeLine[]     // ready for computeTaxes; carries agreedRuleVersionIds
levyDays(checkInAt: Date, checkOutAt: Date, minHoursLastBlock = 12): { days; fullBlocks; lastBlockHours }
levyTrueUp(terms, { checkInAt; checkOutAt; minHoursLastBlock? }): { agreedDays; actualDays; deltaDays;
  lastBlockHours; line: ChargeLine | null }        // post `line` at check-out through computeTaxes

// ── Tax & fee engine ───────────────────────────────────────────────────────────────────────────────
computeTaxes(tx, input: ComputeTaxesInput): Promise<TaxLine[]>
computeTaxesDetailed(tx, input: ComputeTaxesInput): Promise<TaxComputation>   // per-line nets (inclusive lines)
getRulePackStatus(tx, propertyId): Promise<{ propertyId; jurisdiction; verified: boolean; note: string;
  rules: { ruleId; code; name; category; nature; versionInForceId; verificationStatus }[]; unverifiedRuleCodes: string[] }>
interface ComputeTaxesInput {
  propertyId: Uuid; lines: ChargeLine[]; occupancy?: Occupancy;
  stayContext?: { stayNights: number; arrival?: LocalDate; bookingDate?: LocalDate };
  invoiceDate?: LocalDate;
  fullPaymentDate?: LocalDate;      // a payment covering ALL lines; partial payments use ChargeLine.taxPointSplits
  expectedInvoiceDate?: LocalDate;  // quote estimate; lines flagged `estimated`
  ruleVersionIds?: Uuid[];          // pin versions (historical recompute; selection by start date only)
  fxRates?: { from; to; rate: string; source?: string; asOf?: LocalDate }[];
  exemptionCertificates?: { ruleCode; reference; validFrom; validTo }[];
}
interface ChargeLine {
  lineId: string; chargeCode: string; taxCategory: string;   // e.g. accommodation, food_beverage, transfer, spa, activity, gratuity
  amount: Money; quantity?: number /* 1 */; serviceDate: LocalDate;
  taxInclusion?: { mode: 'exclusive' } | { mode: 'inclusive' } | { mode: 'rules'; includedRuleCodes: string[] }
               | { mode: 'rule_default' };          // default exclusive; 'inclusive' backs out value-based rules only
  outletKind?: string; nights?: number /* 1 */; units?: number /* 1 */; occupancy?: Occupancy; nightIndex?: number;
  taxPointDate?: LocalDate;                          // the whole amount's tax point is fixed
  taxPointSplits?: { amountMinor: number; taxPointDate: LocalDate }[];   // e.g. deposit part; levies charged once
  agreedRuleVersionIds?: Uuid[];                     // under agreed terms: commercial rules pinned to these versions
  adjustment?: 'supply' | 'reversal' | 'price_adjustment';   // default: supply (≥ 0) / price_adjustment (< 0)
  levyOnly?: boolean;                                // only quantity-based levies (Green Tax true-up)
  valueOnly?: boolean;                               // only value-based rules (prepayments: no occupancy needed)
}
interface TaxLine {
  lineId; ruleId; ruleCode; ruleName; ruleVersionId;
  category: 'tax' | 'fee'; nature: 'statutory' | 'commercial';
  basis: 'percentage' | 'banded' | 'per_person_night' | 'per_unit_night' | 'per_stay' | 'fixed_per_charge';
  inclusive: boolean; base: Money | null; ratePercent: string | null;
  quantity: { persons; exemptPersons; nights; units } | null; fixedAmount: { value: string; currency } | null;
  fx: FxRate | null; amount: Money; ledgerMappingKey: string; verificationStatus: 'unverified' | 'verified_official_source' | 'verified';
  taxPointDate: LocalDate; estimated: boolean;
}

// ── Plan sales (sales limits), plans ───────────────────────────────────────────────────────────────
recordPlanSale(tx, { propertyId; ratePlanId; unitTypeId; nights: DateRange; quantity?: number; ref: EntityRef }): Promise<void>
releasePlanSale(tx, { ref: EntityRef; nights?: DateRange }): Promise<void>
getRatePlan(tx, id): Promise<RatePlanDto>;  listRatePlans(tx, { propertyId; status? }): Promise<RatePlanDto[]>
```

### Mapping for consumers (their current names → canonical)

| Consumer field | Canonical |
|---|---|
| finance `TaxChargeLine.taxGroup` | `ChargeLine.taxCategory` |
| finance `priceMode: 'inclusive' \| 'exclusive'` | `ChargeLine.taxInclusion = { mode: 'inclusive' }` / `{ mode: 'exclusive' }` |
| finance `stayContext { stayId, nights }` | `stayContext { stayNights }` (+ `nightIndex` per line) |
| finance `TaxLine.name / kind / accountKey / rate / units / exemptUnits / rateCategory` | `ruleName` / `category` + `nature` + `basis` / `ledgerMappingKey` / `ratePercent` / `quantity` / `quantity.exemptPersons` / `ruleCode` |
| finance `getRulePackStatus → { verified, note }` | same fields (plus `rules`, `unverifiedRuleCodes`) |
| finance deposit taxation | `ChargeLine.taxPointSplits` on the stay lines; full prepayment: `fullPaymentDate` |
| finance Green Tax at check-out | `levyTrueUp(terms, { checkInAt, checkOutAt }).line` → `computeTaxes` |
| reservations `TermsSnapshot.ratePlanId` | `ratePlan.id` |
| reservations `priceSource 'portico' \| 'override'` | `'portico_quote'` / `'manual_override' \| 'complimentary' \| 'house_use'` |
| reservations tax line `{ code, name, kind: 'tax'\|'fee' }` | `{ ruleCode, ruleName, category }` (`basis` always present) |
| reservations cancellation `tiers[].deadline.daysBeforeArrival`, penalty math | `policies.cancellation.structure.tiers[].from` + resolved `tiers[].fromInstant`; use `evaluateCancellationPenalty` |
| reservations `commission.kind 'percent' \| 'net_rate'` | `commission.model 'commissionable' \| 'net'` |
| reservations `override { kind, reason }`, `complimentarySnapshot` | `priceOverride`; use `complimentaryTerms` / `overridePrice` (keeps Green Tax, re-seals) |
| reservations `StayChangeRequest.typeChange`, `asOf`, `ratePlanId` | supported as named |
| reservations `RepricingResult.nightly`, `.terms` | as named |
| reservations sales limits | call `recordPlanSale` on confirm and `releasePlanSale` on cancel / shorten |

## Capabilities (spec §3) — status and readiness

R3 = implemented and tested internally (automated tests). Nothing is validated with hotel staff or approved
externally; the Maldives pack is read from MIRA pages but **not adviser-confirmed** (Q20/Q41/Q42).

| ID | Capability | Status | Readiness |
|---|---|---|---|
| RAT-R01 | Rate plan structure, status lifecycle, version | Done; names not localized | R3 (localization R1) |
| RAT-R02 | Prices per unit type × night × occupancy | Done | R3 |
| RAT-R03 | Derived plans (% / amount / combined, floor/ceiling, depth ≤ base+2, acyclic, sellable plans only under active parents) | Done | R3 |
| RAT-R04 | Explicit inheritance; effective-restrictions view with source | Done | R3 |
| RAT-R05 | Bulk price editing with preview | Done; named seasons only as a seed helper | R3 |
| RAT-R06 | Negotiated plans; commissionable vs net (agency collects, invoiceable net) | Done | R3 |
| RAT-R07 | Second-currency plans | Partial (no FX in quotes) | R1 |
| RAT-R08 | Restrictions incl. sales limits scoped to their restriction | Done | R3 |
| RAT-R09 | Violations explained; staff override (not sales limits); never channels — enforced from the principal | Done | R3 |
| RAT-R10 | Eligibility: channels (from the principal), companies (staff), occupancy, sell/stay windows | Done; member-only LATER; company existence checked only when the guests port is bound | R3 |
| RAT-R11/R12 | Promotions per night; never auto-applied to contracted plans | Done | R3 |
| RAT-R13..R17 | Inclusions, meal plans, allowances, packages (plan or added to a stay), exclusions | Done (consumption is finance's) | R3 |
| RAT-R18..R21 | Cancellation (penalty basis excludes statutory levies), guarantee, deposit schedules, versioned policies | Done | R3 |
| RAT-R22 | Tax rules as data: kinds, compounding, applicability, caps, exemptions, inclusion modes, tax point (`time_of_supply`), statutory vs commercial, citations, verification | Done; `per_document` rounding and occupant-attribute exemptions not yet | R3 |
| RAT-R23/R24 | Single computation; inclusive decomposition exact; deposit parts; FX evidence | Done (±2% MMA band check is finance's) | R3 |
| RAT-R25 | Tax change report | Partial: succession, definition diff, nature-aware impact; affected stays via port `affectedAgreements` (unbound until reservations/finance bind it) | R3 (rates part) |
| RAT-R26 | Block live fiscal documents on unconfirmed rules | `getRulePackStatus` provided; enforcement is finance's | R3 (provider) |
| RAT-R27 | Quote with all parts; per-offer isolation of tax errors | Done | R3 |
| RAT-R28 | Sealed, self-contained terms incl. overrides; commercial fees pinned | Done; rendered text English only | R3 (localized text R1) |
| RAT-R29 | priceChange incl. plan / type / occupancy changes, penalties, asOf | Done | R3 |
| RAT-R30 | Deterministic quotes + configuration vector (incl. property classification, sales) | Done | R3 |
| RAT-R31 / R32 | Pricing assistance / external RMS | Not started | R1 |

Integration readiness: none (rates has no external connections). The Maldives template is data at R3 technically;
external approval column: **not submitted / not adviser-confirmed**.

## Rounding rule (documented once)

Prices are integer minor units; each derivation step rounds once per parameter to its increment. Promotions round
once per night. Inclusion allocations are exact, or shrink proportionally (largest remainder) when a promotion or
override reduces the night. Taxes: each rule × line (× tax-point part) is computed exactly with Decimal and rounded
once; compounding bases use rounded amounts; inclusive lines solve the exact net, round it, and assign the residue to
the net (displayed bases use the final net). `inclusive` includes value-based rules only (levies on top). Totals are
sums of line values: `net + taxes + fees = gross`. Proven over thousands of random inputs
(`src/domain/tax-engine.property.test.ts`).

## Invariants and the tests that prove them

| Invariant | Test |
|---|---|
| RAT-I01 derivation depth/acyclicity, also concurrent; status changes under the graph lock | `src/domain/pricing.test.ts`, `test/rates-config.test.ts`, `test/seed-and-concurrency.test.ts` |
| RAT-I02 exact totals, no floats | `src/domain/tax-engine.property.test.ts`, `offer.test.ts`, `test/quote.test.ts`, S19 |
| RAT-I03 terms sealed with an HMAC server key; forged or altered terms refused (reprice, override, penalty) | `src/domain/offer.test.ts`, `test/provider-contract.test.ts`, `apps/api/test/rates.test.ts` |
| RAT-I04 configuration, **service-charge** and tax changes never alter an agreement; posting from terms only | `test/terms-immutability.test.ts` |
| RAT-I05 identical inputs + pinned versions ⇒ identical output, even after a version is closed | `test/tax-rules.test.ts`, `test/terms-immutability.test.ts`, `tax-engine.test.ts` |
| RAT-I06 one active version per rule per date; versions immutable; concurrent overlap → conflict | `test/tax-rules.test.ts` |
| RAT-I07 channels / booking engine never see unbookable or ineligible offers, derived from the principal | `test/provider-contract.test.ts`, `test/quote.test.ts` |
| RAT-I08 quote totals = Σ nights + added items | `test/quote.test.ts`, S19 |
| Sales limits never oversold, scoped to their restriction | `test/seed-and-concurrency.test.ts`, `test/provider-contract.test.ts` |
| Deposit part taxed at its payment date, Green Tax once | `test/terms-immutability.test.ts`, `tax-engine.test.ts` |
| Isolation and permissions (rate plans, tax rules) | `test/rates-config.test.ts`, `test/provider-contract.test.ts`, API test |

## Scenarios

| Test | Demonstrates |
|---|---|
| `test/scenario-s19-package-bill-pricing.test.ts` | S19 (pricing part): packages, allowance, transfers, excursion, different taxes per component, exact totals, schedule |
| `test/quote.test.ts` › change previews; `test/provider-contract.test.ts` › priceChange | S03 (rates part): extension / plan change repricing |
| `test/terms-immutability.test.ts` | E08 + readiness §19 (rate, fee and tax changes; future vs historical; deposits) |
| `test/rates-config.test.ts`, `test/provider-contract.test.ts` | S17 for rate plans and tax rules |
| `test/quote.test.ts`, `test/provider-contract.test.ts` › net rates | S04 (rates part): negotiated, commissionable and net terms |

## Permissions

`rates.ratePlan.read` · `rates.ratePlan.manage` · `rates.price.manage` · `rates.restriction.manage` ·
`rates.restriction.override` ⚑ · `rates.promotion.manage` · `rates.package.manage` · `rates.policy.manage` ·
`rates.taxRule.read` (org) · `rates.taxRule.manage` ⚑ (org) · `rates.taxRule.activate` ⚑ (org) ·
`rates.quote.read` · `rates.quote.backdate` ⚑ · `rates.price.override` ⚑.
Pure providers (`postingPlan`, `evaluateCancellationPenalty`, `levyTrueUp`, …) and `computeTaxes` /
`getRulePackStatus` / `recordPlanSale` run inside the caller's authorized command and do not re-check rates
permissions; the HTTP equivalents require `rates.quote.read`.

## Events

Emitted: `rates.prices.changed` {propertyId, changeSetId, ratePlanIds, unitTypeIds, ranges (coalesced)} ·
`rates.restrictions.changed` (same shape; `null` = all) · `rates.ratePlan.changed` · `rates.ratePlan.statusChanged` ·
`rates.taxRule.activated` {ruleVersionId, effectiveFrom, effectiveTo, supersededVersionId}. Consumed: none.

## Ports (`src/ports.ts`) and binding status

| Port | Binding |
|---|---|
| `getProperty`, `assertWritable`, `resolvePolicy`, `getBusinessDate` | platform (composition; `getProperty` via the system authorizer — FOUNDATION_REQUESTS #1) |
| `listUnitTypes` (optional) | inventory `listUnitTypes` (system authorizer; validates unit types; used by the demo seed) |
| `channelForApiClient` (optional) | **unbound** → bind to integration/distribution channel bindings (default `api_client:<clientId>`) |
| `companyExists` (optional) | guests `getCompany` (system authorizer): exists in the organization and is not `inactive` |
| `affectedAgreements` (optional) | **unbound** → bind to reservations/finance for the tax change report |

Server key: `PORTICO_TERMS_SEAL_KEY` (base64; mandatory in production, development default otherwise).
Demo seed: registered in `Composition.demoSeedSteps` as `{ name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) }`
after inventory. `Composition.services.rates` exposes the provider for consumers' port bindings.

## Contract changes (vs domain-map § rates) — not all additive

Breaking for the consumers' current worktree code (they adapt, rates is canonical): `TermsSnapshot` shape (see
mapping), `seal`/`supersedesSeal` replace a plain hash, `TaxLine.kind` renamed `basis` (+ `nature`, `base` nullable,
`quantity.exemptPersons`, `fixedAmount`, `fx`, `estimated`), `ComputeTaxesInput.paymentDate` replaced by
`fullPaymentDate` + `ChargeLine.taxPointSplits`, `RepricingResult.nights/candidateTerms` → `nightly/terms`,
`StayChangeRequest` is strict (`newNights`, `typeChange`, `asOf`). `Offer.taxesAndFees` is `TaxLine[]` as in the
domain map (per-rule sums moved to `taxSummary`). Additive: new providers listed above, `QuoteRequest.addOnPackageIds`,
`instantiatePaymentSchedule(terms, opts)` (pure, instead of the spec's `(tx, {...})`). Not implemented from the
spec's proposals: `occupancyPerUnit` (multi-unit quotes: call once per unit), `bookerRef` (use `companyId`),
`getTaxRuleVersions` (use `listTaxRules` / `getTaxRule`). **Connected mode:** room quotes are refused while an
external system is authoritative for `rates` (spec §14); the tax engine keeps working.

## Known gaps

Pricing assistance (RAT-R31), rate forwarding to an external system of record, connected-mode mirroring; FX for
second-currency plans in quotes; `per_document` tax rounding; occupant-attribute exemptions (residents); localized
names and policy text; quote log; two-phase (scheduled) tax activation with consumer sign-off; channel-price
snapshots (`priceSource: 'channel'`) are not constructed by rates; terms seal key rotation (key ids) not yet.

Parity gate (`node tools/parity-report.mjs --gate rates`) fails on rows rates cannot close alone or has not built:
P0 — localized names and policy text (PAR-RAT-001, -062), per-document rounding (-069, Q41), affected stays in the
tax change report (-070, EC-RAT-002: needs `affectedAgreements`), fiscal block on unverified packs (-071, EC-RAT-034:
finance/platform), multi-unit quotes (-075), effective-dated classification history (EC-RAT-007: platform), child
ages missing on channel bookings (EC-RAT-009), allowance breakage/consumption (EC-RAT-026/-027: finance),
concurrent price-cell edits returning 409 with the changed cells (EC-RAT-035). P1 `missing`: 18 rows (categories,
approvals, rate protection, copy, discounts, default structures, restriction sources, restriction automation,
coupons, package forecast, seasonal policies, manual tax exemption, lowest-price calendar, rate check report,
EC-RAT-008/-020/-029/-030).

## Open questions (for the owner / adviser; defaults in force)

1. Q20/Q41 — service charge rate base and categories (default 10% on accommodation + F&B, commercial, unverified);
   rounding (per line half-up); TGST on transfers/activities sold by the resort (default: yes, tourism sector).
2. Green Tax for day-use rooms (< 24 h): default counts one guest-day only when the block reaches 12 hours.
3. TGST on forfeited deposits and cancellation fees (maldives-tax-rules.md open item 2): penalties are computed on
   price + hotel fees; their taxation is finance's posting decision.
4. Q42 — tax point outside the Maldives (default `service_date`).
5. Derived amount adjustments are per unit-night and never change per-person prices (product default).
