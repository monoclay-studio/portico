# @portico/rates

Rates answers *"what does this stay cost, under which conditions, with which taxes and fees, and what exactly did
we agree?"* It owns rate plans (base and derived), prices, restrictions, promotions, packages / inclusions /
allowances / meal plans, cancellation / guarantee / deposit policies, the **single tax & fee engine** used for
every charge in Portico, the **quote engine**, and the self-contained **agreed terms** (`TermsSnapshot`).

Spec: `docs/specs/rates.md` (Draft v1). Contract: `docs/architecture/domain-map.md` § rates.
Maldives tax facts: `docs/readiness/maldives-tax-rules.md` (MIRA-sourced, 2026-11-07).

## Layout

| Path | What |
|---|---|
| `migrations/0001_rates.sql` | 14 tables, all tenant-isolated (RLS forced); history tables append-only; tax versions column-level immutable |
| `templates/mv-tax-pack.json` | Maldives rule pack — **seed data**, never code (CLAUDE.md rule 13) |
| `src/contracts.ts` | Zod contracts (config structures, quotes, offers, `TermsSnapshot` v1, record views) |
| `src/domain/` | Pure logic + unit tests: `tax-engine`, `pricing` (occupancy, derivation, graph), `restrictions`, `promotions`, `inclusions`, `policies` (time zones, penalties, schedules, text), `offer` (assembly), `terms` (posting plan, repricing, hash), `calendar` |
| `src/services/` | Application services (permission → data authority → state → audit → events) |
| `src/service.ts` | `ratesService(ports)` — the bound provider object the composition root creates |
| `src/routes.ts` | HTTP (`/v1/...`), Zod-validated, Idempotency-Key on creates/applies, ETag/If-Match on plans/policies/packages/inclusions/promotions |
| `src/search.ts` | `ratesSearch` (global search + hover summaries) |
| `src/seed.ts` | Realistic Maldives demo rates + `createRatesDemoSeed` (DemoSeedStep-compatible) |

## Capabilities (spec §3) — status and readiness

Readiness uses CLAUDE.md §7. "R3" = implemented and tested internally (automated tests below). Nothing here is
validated with hotel staff or approved externally.

| ID | Capability | Status | Readiness |
|---|---|---|---|
| RAT-R01 | Rate plan: code, name, currency (default property base), meal plan, packages, policies, eligibility, display/tax-inclusion mode, sell dates, status lifecycle, version | Done (name not localized yet) | R3 |
| RAT-R02 | Prices per plan × unit type × night: base occupancy, single, extra adult, child age bands (property policy `rates.childAgeBands`), per-occupancy overrides; missing ⇒ `no_price` / `no_child_price` | Done | R3 |
| RAT-R03 | Derived plans ± percent / ± amount, per-unit-type differential, rounding increment, depth ≤ base+2, acyclic (advisory-locked), computed not editable, cascade preview | Done | R3 |
| RAT-R04 | Explicit inheritance per restriction kind and per policy (+ packages); visible via `inherit` and `GET /rate-plans/:id/effective-restrictions` (source plan, inherited flag) | Done | R3 |
| RAT-R05 | Bulk price editing by date ranges × weekdays × unit types, absolute or relative, preview (before/after per cell, affected derived plans) | Done; named reusable seasons only as a seed helper (`seasonRanges`) | R3 |
| RAT-R06 | Negotiated (company/agency-only) plans; commissionable vs net, commission snapshotted | Done | R3 |
| RAT-R07 | Second-currency plans (SHOULD) | Partial: plan currency may differ; quotes do not yet pass FX for fixed-amount taxes (Green Tax in USD on a EUR plan fails with `fx_rate_required`) | R1 |
| RAT-R08 | Restrictions: closed, CTA, CTD, minLOS (arrival), minLOS-through, maxLOS, min/max advance, sales limit; scope plan/all × unit type/all; most restrictive wins | Done | R3 |
| RAT-R09 | Every violation explained (night, kind, plain language); staff override with `rates.restriction.override` + reason (audited, snapshotted); channels never | Done | R3 |
| RAT-R10 | Eligibility: channels, companies/agencies, occupancy, sell/stay windows | Done; member-only is LATER | R3 |
| RAT-R11 | Promotions: percent, amount/night, stay-N-pay-M (cheapest/last), early booking, last minute, LOS, booking/stay windows, blackouts, promo codes, channels, combinability (≤ 1 exclusive; stackables listing each other) | Done (LOS "tiers" = several promotions) | R3 |
| RAT-R12 | Promotion effects per night on the quote; promotion id + version in terms | Done | R3 |
| RAT-R13 | Inclusions: charge code, fixed / percent-of-night allocation, basis (unit, person, adult, child bands, stay), rhythm (nightly/arrival/departure/days), included (revenue split) vs added, outlets | Done | R3 |
| RAT-R14 | Meal plans as inclusion sets (packages with `mealPlanCode`) | Done | R3 |
| RAT-R15 | Allowances: monetary/quantity, per night/stay, per person (by basis), eligible/excluded charge codes & outlets, remainder policy (`forfeit` + breakage code / `carry_within_stay`) | Done (consumption is finance's) | R3 |
| RAT-R16 | Packages attached to plans or **added to a stay** (`addOnPackageIds` on quotes) | Done | R3 |
| RAT-R17 | All-inclusive exclusion lists (SHOULD) | Via allowance `excludedChargeCodes` | R3 |
| RAT-R18 | Cancellation tiers relative to arrival in property time zone (days@time, hours before check-in, at booking), penalties (none, first night, n nights, % of stay, amount), no-show, early departure; text generated from structure | Done | R3 |
| RAT-R19 | Guarantee policy (accepted kinds, hold time) | Done | R3 |
| RAT-R20 | Deposit / payment schedule template; instantiated in offers and by `instantiatePaymentSchedule(terms)` | Done (execution is payments') | R3 |
| RAT-R21 | Policies versioned (`policy_versions`, append-only); version in force snapshotted | Done | R3 |
| RAT-R22 | Tax & fee rules as effective-dated DATA: percentage, per person-night, per unit-night, per stay, banded, fixed per charge; compounding base; applicability by tax category, outlet kind (include/exclude), property classification predicate, stay length; caps (first N nights, max per line); exemptions (child age, long stay, certificates); inclusive/exclusive; rounding mode; tax point policy (`service_date`, `booking_date`, `invoice_date`, `time_of_supply`); citations; verification status | Done; `per_document` rounding and occupant-attribute exemptions (e.g. residents) not yet | R3 |
| RAT-R23 | `computeTaxes` is the only tax computation; lines carry rule id + version id, base, rate, amount; identical inputs ⇒ identical output | Done | R3 |
| RAT-R24 | Inclusive prices decomposed through the compounding chain; residue to net; net + Σ = gross exactly | Done | R3 |
| RAT-R25 | Tax change report before activation; activation needs `rates.taxRule.activate` and records the report | Partial: report has succession, definition diff, warnings and impact; the list of **affected stays/deposits** belongs to reservations/finance (they react to `rates.taxRule.activated`) | R3 (rates part) |
| RAT-R26 | Block live fiscal documents while rules are unconfirmed | Rates exposes verification on every tax line, `unverifiedTaxRules` on offers and record issues; the block itself is finance/platform's | R1 (enforcement) |
| RAT-R27 | Quote: offers per plan × unit type with nightly prices, promotions, occupancy, inclusions, allowances, taxes/fees, totals {net, taxes, fees, gross, allInTotal}, policies (structured + text), violations, commission, terms | Done (`allInTotal` = gross: every mandatory tax/fee is already in gross) | R3 |
| RAT-R28 | `TermsSnapshot` v1: self-contained, content-hashed (`sha256:` over canonical JSON) | Done | R3 |
| RAT-R29 | `priceChange`: agreed nights keep agreed prices; new nights by `reservations.repricing.newNights` (current / agreed average / manual); removed nights → cancellation tier or early-departure penalty; occupancy repriced from the agreed occupancy pricing; unit-type change by `reservations.repricing.typeChange` (keep / difference / reprice); candidate terms supersede by hash | Done | R3 |
| RAT-R30 | Deterministic quotes + configuration vector | Done | R3 |
| RAT-R31 | Pricing assistance / recommendations (SHOULD) | Not started | R1 |
| RAT-R32 | External RMS interfaces (LATER) | Not started | R1 |

### Maldives tax template (`templates/mv-tax-pack.json`)

| Rule | Value | Effective | Verification status | Notes |
|---|---|---|---|---|
| MV-SC service charge (fee) | 10% on accommodation + F&B | open | `unverified` | ≥ 10% per news sources; hotel sets its own; *in the GST base* is verified |
| MV-TGST | 16% → **17%** on net + service charge | 16% until 2025-07-01 (start date not recorded); 17% from 2025-07-01 | `verified_official_source` | tax point **time of supply** (earlier of invoice / payment); excludes `general_sector` outlets |
| MV-GST-GENERAL | 8% | open | `verified_official_source` | only outlets of kind `general_sector` |
| MV-GREEN-12 | USD 12 / guest / day | from 2025-01-01 | `verified_official_source` | resorts, integrated resorts, resort hotels, vessels, or hotels/guesthouses not (inhabited ∧ ≤ 50 registered rooms); under-2 exempt; not in GST base |
| MV-GREEN-6 | USD 6 / guest / day | from 2025-01-01 | `verified_official_source` | hotels/guesthouses on inhabited islands with ≤ 50 **registered** rooms (`mv.registeredRooms`) |

`verified_official_source` = read from MIRA's own published pages — **not legal advice; a Maldives adviser must
confirm (OPEN_QUESTIONS Q20/Q41/Q42)**. Per-line half-up rounding is Portico's default, not a MIRA rule. A property
whose classification lacks a key a rule needs gets `tax_classification_missing` instead of a guess.

## The rounding rule (documented once)

- **Prices**: integer minor units. A derivation step adjusts each price parameter and rounds **once** to its
  increment (e.g. whole dollars). Percent adjustments scale every parameter; amount adjustments are per unit-night
  (base, single, occupancy overrides) and leave per-person extra-adult/child amounts unchanged.
- **Promotions**: each effect rounds once per night (half-up).
- **Inclusion allocations**: fixed amounts are exact; percent-of-night rounds once; when a promotion reduces a
  night below its inclusions' value the shares shrink proportionally with largest-remainder allocation (never a
  negative room line).
- **Taxes**: each rule × line is computed exactly (Decimal) and rounded **once** (rule's mode, default half-up);
  compounding bases use the rounded amounts of the rules they include. Inclusive lines: the exact net is solved
  from the affine compounding chain, rounded half-up, included rules evaluated as above, and the residue
  (≤ 1 minor unit per included rule) goes to the **net**.
- **Totals** are sums of line values, never recomputed: `net + taxes + fees = gross` exactly.
- Proven over thousands of random inputs in `src/domain/tax-engine.property.test.ts` (deterministic PRNG).

## Invariants and the tests that prove them

| Invariant | Test |
|---|---|
| RAT-I01 derivation depth ≤ 3, acyclic, also under concurrent edits | `src/domain/pricing.test.ts`, `test/rates-config.test.ts`, `test/seed-and-concurrency.test.ts` |
| RAT-I02 net + Σ taxes/fees = gross exactly; no floats | `src/domain/tax-engine.property.test.ts` (P1–P7), `tax-engine.test.ts`, `offer.test.ts`, `test/quote.test.ts`, `test/scenario-s19-…` |
| RAT-I03 snapshot immutable & verifiable (hash survives JSON + schema round trip; tampering detected) | `src/domain/offer.test.ts`, `test/terms-immutability.test.ts`, `test/quote.test.ts` (priceChange refuses tampered terms) |
| RAT-I04 configuration changes never alter an agreement; posting from snapshot only | `test/terms-immutability.test.ts` (prices, derivation, restrictions, policy, promotion, inclusion and TGST changed after booking) |
| RAT-I05 identical inputs + rule versions ⇒ bit-identical taxes (pinned versions ignore later closing dates) | `test/tax-rules.test.ts`, `tax-engine.test.ts`, `test/terms-immutability.test.ts` |
| RAT-I06 one active version per rule per date (DB exclusion constraint); versions immutable (column grants) | `test/tax-rules.test.ts` |
| RAT-I07 channel quotes never return offers violating restrictions/eligibility; overrides never for channels | `test/quote.test.ts` |
| RAT-I08 quote totals = Σ nightly lines + added items | `test/quote.test.ts`, `test/scenario-s19-…` |
| Sales limit never oversold under parallel bookings | `test/seed-and-concurrency.test.ts` |
| History append-only (`core.make_append_only` on price/restriction history, change sets, policy versions; proven for price history and change sets) | `test/rates-config.test.ts` |
| Tenant isolation & property-scoped permissions | `test/rates-config.test.ts`, `apps/api/test/rates.test.ts` |
| Readiness §19 "tax or rate changes affecting future vs historical records" | `test/terms-immutability.test.ts`: historical recompute with recorded versions = quote; future supplies after a mid-stay TGST change use the new version; an amount whose time of supply was fixed by a deposit is not re-taxed |

## Scenarios

| Test | Demonstrates |
|---|---|
| `test/scenario-s19-package-bill-pricing.test.ts` | S19 (pricing part): family half-board package with revenue split, dining allowance (forfeit → breakage code), included seaplane transfers (TGST only), added excursion, SC + TGST compounding, Green Tax per guest with under-2 exemption, exact totals, deposit/balance schedule, posting plan from terms |
| `test/quote.test.ts` › change previews | S03 (rates part): extension keeps agreed nights, prices new nights at current rates, taxes and totals in the preview |
| `test/terms-immutability.test.ts` | E08 + readiness §19 |
| `test/rates-config.test.ts` › isolation | S17 for rates records |
| `test/quote.test.ts` › negotiated plans | S04 (rates part): company plan with commission snapshotted |

## Permissions

`rates.ratePlan.read` · `rates.ratePlan.manage` · `rates.price.manage` · `rates.restriction.manage` ·
`rates.restriction.override` ⚑ · `rates.promotion.manage` · `rates.package.manage` · `rates.policy.manage` ·
`rates.taxRule.read` (org) · `rates.taxRule.manage` ⚑ (org) · `rates.taxRule.activate` ⚑ (org) · `rates.quote.read`.
`rates.taxRule.read` is added to the spec's list (reading rule data needs its own grant). Provider calls made inside
another module's command (`computeTaxes`, `recordPlanSale`, `postingPlan`) do not re-check rates permissions; the
caller's command is already authorized. The HTTP tax preview requires `rates.quote.read`.

## Events

Emitted (outbox): `rates.prices.changed` {propertyId, changeSetId, ratePlanIds (edited + affected derived),
unitTypeIds, ranges (coalesced)} · `rates.restrictions.changed` (same shape; `null` = all plans/types) ·
`rates.ratePlan.changed` · `rates.ratePlan.statusChanged` · `rates.taxRule.activated` {ruleVersionId,
effectiveFrom, effectiveTo, supersededVersionId}. Consumed: none (child bands and repricing policies are resolved
on demand through `platform.resolvePolicy`).

## Ports and binding status (`src/ports.ts`)

| Port | Bound in `apps/api/src/composition.ts` to |
|---|---|
| `getProperty` | `platform.getProperty` with the system authorizer (see FOUNDATION_REQUESTS.md) |
| `assertWritable` | `platform.assertWritable` |
| `resolvePolicy` | `platform.resolvePolicy` |
| `getBusinessDate` | `platform.getBusinessDate` |
| `listUnitTypes` (optional) | **unbound** — bind to inventory's unit-type listing at merge. Until then unit type ids are not validated on price writes and `createRatesDemoSeed` explains that it needs it. |

To register the demo seed at merge: `DEMO_SEED_STEPS.push({ name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) })`
(after the inventory step). `ratesSearch` is registered in composition.

## Contract changes (domain-map § rates) — all additive

1. `quote` input adds `restrictionOverride?: { reason }` (staff only) and `addOnPackageIds?`; `Offer` adds
   `ratePlanCode/Name`, `mealPlan`, `currency`, `bookable`, `overriddenViolations`, `commission`,
   `unverifiedTaxRules`, `totals.allInTotal`. `quoteDetailed` also returns `{ quoteId, configVector }`.
   `Offer.taxesAndFees` is a per-rule summary; per-line tax lines are on each night / added item.
2. `computeTaxes` input: `ChargeLine` has `taxCategory` (finance supplies it from the charge code), `taxInclusion`,
   `nights`, `units`, `occupancy`, `nightIndex`, `outletKind` and **`taxPointDate`** (an amount whose tax point is
   fixed, e.g. a deposit); request adds `stayContext`, `invoiceDate`, `paymentDate`, `ruleVersionIds` (pin),
   `fxRates` (with source/date), `exemptionCertificates`. `computeTaxesDetailed` returns per-line nets for
   inclusive lines (finance needs the net to post revenue).
3. New providers: `recordPlanSale` / `releasePlanSale` (reservations calls them in the confirm/cancel transaction for
   sales limits), `postingPlan(terms, stayId)` (pure, deterministic keys `room:{stay}:{night}` /
   `inclusion:{stay}:{inclusion}:{night}` matching finance FIN-R08), `instantiatePaymentSchedule(terms)`,
   `verifyTerms(terms)`.
4. Spec deviations: tax point policy adds `time_of_supply` (MIRA, per maldives-tax-rules.md); verification status
   adds `verified_official_source`; deposits taxed at payment are expressed by finance passing `taxPointDate`.

## Adoption modes

- **Data authority `rates`**: every configuration write calls `assertWritable`; `read_only` → refused with the
  external system's name; `forward` → refused with `rates_forwarding_unavailable` (forwarding rate edits through an
  integration is not built yet). Quotes and the tax engine keep working.
- **Tax rules** are always Portico data (not authority-governed), usable standalone (e.g. by resort/outlets).
- **Connected mode** mirroring of external rate plans/prices (provenance `external`) is not built (R1).

## Universal record contract coverage

`rate_plan` (status `{ ratePlan }`, actions edit/activate/pause/retire/editPrices/editRestrictions/quote with
reasons, issues no_prices / no_prices_next_30_days / no_cancellation_policy / parent_not_active /
external_system_of_record, links parent/derived/policies/packages/property) and `tax_rule` (status
`{ taxRule, verification }`, actions addVersion/activateVersion/withdrawVersion, issues no_version_in_force /
not_adviser_confirmed / draft_pending / scheduled_change). Policies, packages, inclusions and promotions return
their plain DTOs (record views planned). `recordTypes` declared for the seven configuration record types (`quote`,
`tax_template` and property-wide restriction audit entries have no record page); search covers rate
plans, promotions (incl. promo codes), packages, policies and tax rules. No secrets are audited.

## Known gaps

- Pricing assistance (RAT-R31), connected-mode mirroring, rate forwarding to an external system of record.
- FX for second-currency plans in quotes; `per_document` tax rounding; occupant-attribute tax exemptions.
- Channel-price snapshots (`priceSource: 'channel'`, S02) — the enum exists; constructing terms from a channel
  price is left to reservations/distribution (or a later `termsFromChannelPrice`).
- Tax change report does not list affected stays (reservations/finance own that data).
- Named reusable seasons (only a helper); localized names; quote log (TTL) not persisted.
- Green Tax "check-out block ≥ 12 h" is handled by posting an extra accommodation line (finance/reservations).
- Unit types are not validated until the inventory port is bound.

## Open questions for the owner (proceeding with the stated defaults)

1. Q20/Q41: confirm Maldives service-charge rate base and categories (default: 10% on accommodation + F&B,
   `unverified`), rounding (default per line half-up), and whether TGST applies to transfers/activities sold by
   the resort (default: yes, tourism sector).
2. Q42: tax point for non-Maldives markets (default `service_date`; Maldives TGST uses `time_of_supply`).
3. Should amount adjustments on derived plans also change per-person (extra adult/child) prices? Default: no — an
   amount is per unit-night; percent adjustments scale everything.
4. Should a promotion reduce allocated inclusion revenue proportionally (default) or keep inclusions at full value
   and discount only the room?
