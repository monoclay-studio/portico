# Spec: rates

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `rates` · Prefix `RAT`

## 1. Purpose

Rates answers "what does this stay cost, under which conditions, with which taxes and fees, and what exactly
did we agree?" It owns rate plans, prices, restrictions, promotions, packages, policies and the **single tax
and fee engine** used everywhere money is computed (quotes, folio postings, booking engine, channel and Google
feeds). Its most important output is the **agreed terms** snapshot that lets every later night be posted
exactly as agreed, whatever happens to configuration afterwards.

## 2. Scope and non-goals

**In scope:** rate plans (base and derived), prices by unit type/night/occupancy, restrictions, eligibility
(channels, companies, agencies, promo codes), promotions, commission terms, packages, inclusions, allowances,
meal plans, cancellation/guarantee/deposit/no-show policies and payment schedule templates, tax & fee rules,
quote engine, terms snapshots, repricing for change previews.

**Non-goals:** availability (`inventory`); folios and postings (`finance` — rates computes, finance posts);
charging cards (`payments`); demand forecasting and revenue analytics (`analytics`); group contract pricing
grids (`groups`, which creates rate plans here); channel rate mapping (`distribution`).

## 3. Capabilities

### 3.1 Rate plans and prices

- **RAT-R01** [MUST] Rate plan: code, name (localized), description, currency (default property base), meal
  plan, inclusions/packages, cancellation, guarantee, deposit and no-show policies, payment schedule template,
  market segment default, eligibility, display mode (tax-inclusive/exclusive), sellable date range, status
  (`draft | active | paused | retired`), version. A rate plan spans unit types (prices per unit type) — one plan,
  many unit types.
- **RAT-R02** [MUST] Prices per (rate plan, unit type, night): price for base occupancy, single-occupancy price
  (optional), extra-adult amount, child amounts by property age bands (e.g. 0–1, 2–11, 12–17; bands are property
  configuration), and per-occupancy overrides. Missing price ⇒ not sellable for that night (`no_price` violation).
- **RAT-R03** [MUST] **Derived plans**: parent ± amount or percent, per-unit-type differential optional, rounding
  rule (e.g. to whole currency units). Maximum depth 3 (base + 2 derivation levels); cycles impossible. A derived
  plan's prices are computed, not editable; editing the parent previews the cascade ("updates 4 plans, 3 unit
  types, 120 nights; 2 channels will receive updates").
- **RAT-R04** [MUST] Derived plans choose **explicitly** per restriction kind and per policy: *inherit from
  parent* or *own value*. The choice is visible on the plan and in the price/restriction grid (badge
  "inherited from BAR").
- **RAT-R05** [MUST] Bulk price editing by date range, days of week, unit types and occupancy with a preview of
  before/after per cell and affected derived plans; seasons are reusable named date patterns that apply prices,
  not a separate pricing object.
- **RAT-R06** [MUST] **Negotiated and contracted rates**: plans restricted to companies or agencies; contracted
  **net** rates for agencies (agency collects from guest; hotel invoices net) vs **commissionable** rates
  (commission percent/amount on a defined base, e.g. room revenue net of taxes). Commission terms are part of
  the plan or the agency contract and are snapshotted.
- **RAT-R07** [SHOULD] Rate plans in a second currency (e.g. EUR contracts at a USD property): quote shows plan
  currency; posting currency and FX handled by finance with the snapshot carrying the plan currency.

### 3.2 Restrictions and eligibility

- **RAT-R08** [MUST] Restrictions per (rate plan | all plans, unit type | all types, night): `closed`,
  `closedToArrival`, `closedToDeparture`, `minLos` (arrival-based) and `minLosThrough` (stay-through),
  `maxLos`, `minAdvanceDays`, `maxAdvanceDays`, `salesLimit` (max stays per night sold on the plan).
- **RAT-R09** [MUST] The quote engine reports every violated restriction with night, kind and plain-language
  reason; staff with `rates.restriction.override` may book through a violation with reason (audited); channels
  and the booking engine never can.
- **RAT-R10** [MUST] Eligibility: channels/sources that may sell the plan, companies/agencies, promo codes,
  min/max occupancy, booking window, member-only (LATER).

### 3.3 Promotions

- **RAT-R11** [MUST] Promotions as rules applied on top of a plan: percent or amount off, free nights
  ("stay 7 pay 6": cheapest/last nights free), early booking (≥ N days), last minute (≤ N days), length of stay
  tiers, booking window, stay window, blackout dates, promo code optional, combinability (exclusive | stackable
  with listed promotions; maximum one exclusive), channel eligibility.
- **RAT-R12** [MUST] The quote shows each promotion line separately with its effect per night; the terms
  snapshot stores the promotion id and version.

### 3.4 Packages, inclusions, allowances, meal plans

- **RAT-R13** [MUST] **Inclusion**: component (charge code), price allocation (fixed amount or percent of the
  night price), calculation basis (`per_unit`, `per_person`, `per_adult`, `per_child_band`, `per_stay`), rhythm
  (`nightly`, `arrival`, `departure`, `days_of_stay[]`), included in rate vs added to rate, fulfilment outlets.
  Revenue for an included component is allocated to its charge code (revenue split) when the night is posted.
- **RAT-R14** [MUST] **Meal plans** (room only, B&B, half board, full board, all inclusive, custom) are
  inclusion sets with display names; a meal plan never hard-codes outlets.
- **RAT-R15** [MUST] **Allowance** (`rates.allowances`): monetary or quantity entitlement (e.g. $100 dining
  credit per night, 2 spa treatments per stay), period (`per_night` | `per_stay`), eligible charge codes/outlets,
  exclusions, remainder policy (`forfeit` → breakage revenue at period end; `carry_within_stay`), per-person or
  per-unit. Consumption is recorded by finance (`allowanceRef` on postings).
- **RAT-R16** [MUST] **Package**: named bundle of inclusions/allowances sellable attached to a plan or added
  to a stay (e.g. "Honeymoon: sunset cruise + couples massage"), priced per basis, with its own policies if any.
- **RAT-R17** [SHOULD] Exclusion lists for all-inclusive tiers (e.g. premium wines excluded) as charge-code or
  item-category lists consumed by `resort` meal-plan consumption.

### 3.5 Policies and payment schedules

- **RAT-R18** [MUST] **Cancellation policy**: ordered tiers by deadline relative to arrival (days/hours, in
  property local time) with penalty (`nights: n`, `percent_of_stay`, `amount`, `first_night`), plus no-show
  penalty and early-departure penalty; non-refundable as a tier at booking time. Text is generated from the
  structure (localized) — never free text alone.
- **RAT-R19** [MUST] **Guarantee policy**: required guarantee kinds (`card`, `deposit`, `company`, `agency`,
  `prepaid_channel`, `none`) and the hold time for non-guaranteed bookings (e.g. release at 18:00 on arrival day).
- **RAT-R20** [MUST] **Deposit policy and payment schedule template** (proposed glossary term *Payment
  schedule*): ordered collection items (`deposit` | `preauthorization` | `balance`), amount basis (`percent`,
  `nights`, `amount`, `remaining`), due anchor (`booking`, `arrival`, `departure`) ± offset, method expectation
  (`card_on_file`, `payment_request`, `bank_transfer`, `agency_invoice`), and what happens when overdue
  (`remind`, `task`, `auto_cancel_after`). Reservations instantiates the schedule per booking; payments
  executes it.
- **RAT-R21** [MUST] Policies are versioned; the version in force at confirmation is snapshotted.

### 3.6 Tax and fee engine

- **RAT-R22** [MUST] Tax & fee rules are **data**, effective-dated, versioned, each with: jurisdiction, name,
  kind (`percentage`, `per_person_night`, `per_unit_night`, `per_stay`, `banded` by price per unit-night,
  `fixed_per_charge`), amount/rate, currency for fixed amounts, base (`net`, or `net + listed rules` for
  compounding, e.g. TGST on net + service charge), applicability (charge-code groups, property classification,
  outlet kinds, stay length range, occupant age range), caps (max nights, max amount), exemptions (occupant age,
  occupant attributes, company tax-exemption with certificate reference and validity), inclusive/exclusive
  default, rounding (`per_line` | `per_document`; `half_up` | `half_even`; minor unit), `taxPointPolicy`
  (`service_date` default; Q42), source citation URL, verification status (`unverified` | `verified` with
  verifier and date) and ledger account mapping key (finance maps to tax-payable accounts).
- **RAT-R23** [MUST] `computeTaxes(lines, occupancy?, stayContext?)` is the **only** tax computation in the
  product. Output lines carry the rule id and **rule version id**, base amount, rate, computed amount and
  rounding residue; recomputing with the same versions is bit-identical.
- **RAT-R24** [MUST] Inclusive prices are decomposed by solving for net with the compounding chain, rounding
  once per rule per line; the residue is assigned to the net (documented rule) so `net + Σ taxes = gross`
  exactly.
- **RAT-R25** [MUST] Activating a new rule version produces a **tax change report** before activation: affected
  future confirmed stays, per-stay difference under the rule's tax-point policy, deposits already collected;
  activation requires `rates.taxRule.activate` ⚑ and records the report (E08).
- **RAT-R26** [MUST] A property cannot issue fiscal documents in `live` while any applicable rule is
  `unverified` (go-live checklist blocker contributed to platform; demo/training allowed with a visible
  "unverified rule pack" marker).

### 3.7 Quote engine and agreed terms

- **RAT-R27** [MUST] `quote(...)` returns offers per (unit type, rate plan) with nightly prices
  (base → derivations → promotions → net), occupancy surcharges, inclusions with allocations, allowances,
  tax/fee lines (from RAT-R23), totals `{net, taxes, fees, gross}` and **all-in display total**, policies
  (structured + rendered text), restriction violations, commission terms, and a `TermsSnapshot`. Availability
  is not decided here (callers combine with inventory).
- **RAT-R28** [MUST] **TermsSnapshot** (versioned JSON schema, `schemaVersion`) is self-contained: rate plan id
  and version, unit type, occupancy, currency, per-night lines (stay date, amount, components, promotion
  effects), inclusion allocations and rhythms, allowances, policies (structured, versions, rendered text in the
  booking language), payment schedule, commission/net terms, tax rule version ids used for the quote (reference
  only — posting recomputes by tax-point policy), price override details if any, quotedAt, and a content hash.
  It must be sufficient to post every night without reading current configuration (domain map).
- **RAT-R29** [MUST] `priceChange(terms, change)` for change previews: nights present in the agreed terms keep
  their agreed prices; new nights are priced by policy `reservations.repricing.newNights` (`current_rates`
  default | `agreed_average` | `manual`); removed nights apply early-departure/cancellation tiers; occupancy
  changes reprice by the agreed plan's occupancy rules at agreed base; unit-type changes follow
  `reservations.repricing.typeChange` (`keep_agreed` for complimentary upgrades | `difference` | `reprice`).
  Output: per-night before/after, taxes, totals, penalties, and a new candidate snapshot.
- **RAT-R30** [MUST] Quotes are deterministic for the same inputs and configuration versions (configuration
  version vector returned with the quote; a booking commit with a stale vector re-quotes and shows differences).

### 3.8 Pricing assistance

- **RAT-R31** [SHOULD] Pricing rules (all editions): occupancy- and pickup-based adjustments with floor,
  ceiling, maximum change per day, unit types and nights in scope; each run produces **recommendations** shown
  with assumptions, data freshness, expected effect and uncertainty (brief §5); applying is manual by default;
  auto-apply is opt-in with the same limits and a full history (who/what applied, before/after).
- **RAT-R32** [LATER] Open forecast/ARI interfaces for external revenue systems (IDeaS, Duetto class) via
  `integration`.

## 4. Entities and states

`rate_plan(id, property_id, code, currency, parent_id?, derivation jsonb?, inherits jsonb, meal_plan_id?,
policy refs, eligibility jsonb, status, version)` · `price(rate_plan_id, unit_type_id, night, base_amount,
single_amount?, extra_adult, child_band_amounts jsonb, version)` · `restriction(scope rate_plan_id?, unit_type_id?,
night, kind, value)` · `promotion(id, rules jsonb, combinability, status, version)` · `inclusion(id, charge_code,
allocation, basis, rhythm, fulfilment_outlets[])` · `allowance_definition(id, kind, amount|quantity, period,
eligible jsonb, remainder_policy, basis)` · `package(id, components[], pricing)` · `policy(id, kind, structure
jsonb, version)` · `payment_schedule_template(id, items jsonb, version)` · `tax_rule(id, jurisdiction, name)` ·
`tax_rule_version(id, tax_rule_id, effective_from, effective_to?, definition jsonb, verification, citation,
activated_at?, activated_by?)` · `quote_log(id, request_hash, config_vector, offers jsonb, created_at)` (TTL).

**Rate plan status:** `draft → active` (has prices for ≥ 1 night and valid policies) · `active ⇄ paused` (paused:
not sellable for new bookings; existing agreed terms unaffected) · `active|paused → retired` (terminal; derived
children must be re-parented or retired first).

**Tax rule version:** `draft → scheduled` (activation with change report) `→ effective` (effective_from reached)
`→ superseded` (next version effective). A version that has been used in any posting is immutable; corrections
are new versions plus finance adjustments.

## 5. Invariants

- **RAT-I01** Derivation depth ≤ 3 and the derivation graph is acyclic.
- **RAT-I02** `net + Σ tax/fee lines = gross` exactly, in minor units, for every quote line and every computed
  tax result; no floating-point arithmetic anywhere (Decimal, single rounding per rule per line).
- **RAT-I03** A `TermsSnapshot` is immutable once persisted by reservations (hash verifies); posting any agreed
  night uses only the snapshot plus tax rule versions selected by tax-point policy.
- **RAT-I04** Changing prices, restrictions, policies or promotions never alters any existing snapshot (E08):
  a test changes all configuration after confirmation and asserts posted night amounts equal agreed amounts.
- **RAT-I05** `computeTaxes` with identical inputs and rule-version ids returns identical outputs.
- **RAT-I06** At most one version of a tax rule is effective for any instant.
- **RAT-I07** A channel or booking-engine quote never returns an offer violating restrictions or eligibility.
- **RAT-I08** Quote totals equal the sum of their nightly lines and inclusions; all-in total equals gross plus
  mandatory fees.

## 6. Cross-module interactions

Provider contract (domain map): `quote`, `priceChange`, `computeTaxes`, `getRatePlan`, `listRatePlans`.
Consumers: `reservations` (quotes, snapshots, previews), `finance` (computeTaxes for every non-snapshot
charge), `distribution` (rate/restriction feeds, Google ARI price accuracy), `groups` (group rate plans),
`resort` (package entitlements, exclusions), `analytics`. Depends on `platform` (classification, policies,
currencies) and `inventory` (unit types, read-only).

### Proposed contract changes

1. `quote` input adds `occupancyPerUnit?: Occupancy[]` for multi-unit requests and `bookerRef?` (agency/company
   for eligibility & commission); output `Offer` adds `allInTotal`, `commission`, `configVector`. Additive.
2. New `instantiatePaymentSchedule(tx, { terms, bookingDate, arrival, departure }): ScheduleItem[]`.
3. New `getTaxRuleVersions(tx, { propertyId, at, chargeContext })` for audit/explanations.
4. `computeTaxes` input adds `serviceDate` and `taxPointDate?` so finance can apply the tax-point policy.

## 7. Events

Emitted: `rates.prices.changed {propertyId, ratePlanIds, unitTypeIds, nights}` · `rates.restrictions.changed` ·
proposed: `rates.ratePlan.statusChanged`, `rates.taxRule.activated {ruleVersionId, effectiveFrom, reportId}`,
`rates.recommendation.generated`.
Consumed: `platform.policy.changed` (rounding/display defaults), `inventory.unitType.changed` (proposed, for
price grid shape).

## 8. Permissions

`rates.ratePlan.read` · `rates.ratePlan.manage` · `rates.price.manage` · `rates.restriction.manage` ·
`rates.restriction.override` ⚑ · `rates.promotion.manage` · `rates.package.manage` · `rates.policy.manage` ·
`rates.taxRule.manage` ⚑ · `rates.taxRule.activate` ⚑ · `rates.quote.create` · `rates.recommendation.apply`.

## 9. UX surfaces

- **Rate calendar**: plans × unit types × nights with price, restrictions as compact glyphs + text on hover/focus,
  inherited badges, derived values greyed and non-editable; bulk edit with preview.
- **Rate plan editor**: sections (prices, restrictions, policies, inclusions, eligibility, distribution) with
  plain-language policy preview ("Free cancellation until 14 days before arrival (Malé time); then 100% of
  stay").
- **Quote panel** (used inside reservations): offers comparison with totals, all-in price, policy summary, and
  restriction violations explained.
- **Tax rules admin**: versions timeline, citation and verification status, change report before activation.
- **Recommendations list**: each with assumptions, freshness, expected effect, uncertainty; apply/dismiss.

## 10. Proof scenarios and evidence

| ID | Rates must demonstrate |
|---|---|
| S03 | Extension reprices only new nights per policy; agreed nights unchanged; preview shows taxes and totals. |
| S04 | Company-negotiated plan for rooms; incidentals outside the plan; commission/net terms snapshotted. |
| S11 | Group plan prices for reduced block unchanged for picked-up stays (snapshots). |
| S19 | Bill combining half-board package (inclusion allocation), dining allowance with forfeited remainder (breakage), service charge + TGST compounding, Green Tax per person-night with child band, exact totals. |
| E08 | Rate change after booking leaves agreed stays unchanged; tax rule change applies per tax-point policy with change report; historical postings keep their rule versions. |
| S02 (supporting) | Channel booking with OTA-supplied price is snapshotted as `channel_price` with discrepancy flag if it differs from Portico's quote beyond tolerance. |

## 11. Maldives specifics

- Rule pack (data, `unverified` until Q41 answered): service charge 10% (custom; on room and F&B net); TGST 17%
  from 2025-07-01 (16% before) on net + service charge; Green Tax USD 12 or 6 per person-night by property
  classification (research 04). Green Tax is a fixed USD amount — when the folio currency is MVR it converts
  at the property's FX rate for the business date (finance).
- Meal plans dominate resort pricing (HB/FB/AI and tiered all-inclusive); transfers (seaplane/speedboat) are
  frequently **included per person** in packages — modelled as an inclusion with `per_person` basis and
  `arrival`+`departure` rhythm fulfilled by the resort transfer desk.
- Promotions common in the market: early booking, "stay X pay Y", honeymoon packages; combinability rules matter.
- Tour-operator/DMC contracted **net** rates in USD (and EUR) with allotments are normal for resorts and many
  guesthouses — RAT-R06 is MUST, not enterprise-only.
- Child age bands vary by resort (e.g. 2–11, 12–17); Green Tax child treatment is unverified (Q41).

## 12. Competitive inspirations

- OPERA rate codes + packages with posting rhythm, calculation rule and allowance P&L (research 01 §3.8) —
  adopted at the model level; avoid rate-code proliferation by base + derivation + inclusions.
- OPERA generates (inheritable, chainable taxes) → our compounding base and single tax engine (research 01 §3.7).
- Derived-rate depth limit and explicit restriction inheritance — Apaleo; their non-inheritance surprised
  revenue managers, so we make it an explicit visible choice (research 02 §3.3.3, §3.7).
- Packages as guest-visible entitlements — Agilysys S.P.E.N.D. (research 01 §6.2) — allowances designed for
  guest visibility in `resort`/guest portal.
- One price computation for folio, booking engine, Google ARI and FTC all-in display (research 04 §C3, A5).
- Built-in pricing assistance in every edition — RoomRaccoon gating it to the top tier is an anti-pattern
  (research 03 §5.6).

## 13. Open questions

Q41 (Maldives computation details), Q42 (tax point). Product decisions: max derivation depth 3; new nights in
extensions priced at current rates by default; tax residue assigned to net.
