# Agent run: Wave1: rates and tax engine

- Started: 2026-11-07T07:32:35.545Z · last activity: 2026-11-07T12:06:37.267Z
- Turns: 292 · tool uses: 491 · output tokens: 627,709
- Type: general-purpose

## Brief (2026-11-07T07:32:35.545Z)

````text
You are the engineer for Portico's **rates** module (wave 1) — pricing, packages, policies, the single tax & fee engine and the quote engine. First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/rates (branch feat/rates-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_rates. Module path: modules/rates (package @portico/rates, schema `rates`). Spec: /home/user/wt/product/docs/specs/rates.md.

Build (provider contract in docs/architecture/domain-map.md § rates):
- Rate plans: base and derived (± amount / ± percent / rounding rule from a parent, multi-level, cycle-safe), meal plan, channel/market availability, member/negotiated (company-specific) plans, promotions & promo codes, sell dates vs stay dates.
- Prices per unit type × night × occupancy (base occupancy + extra adult + child age bands), seasonal/bulk calendar updates (date ranges + weekdays), with history (every price change versioned; who/when).
- Restrictions: min/max LOS (arrival-based and through), closed, CTA, CTD, min/max advance, sales limits.
- Packages, inclusions and allowances (monetary or quantity, per night/per stay/per person, consumable at outlets, unused-remainder policy) and meal plans implemented as inclusions.
- Policies: cancellation (deadlines relative to arrival in property time zone, fee rules: first night / % / fixed / non-refundable), guarantee, deposit schedules.
- TAX & FEE ENGINE (used for everything, not just rooms): rules are effective-dated DATA with source citation and verification status — percentage, per person-night, per unit-night, banded, capped, exempt; inclusive vs exclusive; compounding order (e.g. service charge then GST on top); applicability by charge category, property classification (e.g. mv.establishmentType), guest age, stay length. computeTaxes(tx, lines…) returns per-line tax breakdown with rule versions. Ship a Maldives template (TGST 17% from 2025-07-01 with history row 16% before; Green Tax USD 12 per person-night for resorts/hotels >50 rooms and USD 6 for ≤50-room inhabited-island guesthouses, children exemptions as configurable; 10% service charge) — mark each rule `verificationStatus: 'unverified'` with source URLs from docs/research/04-connectivity-payments-compliance.md and a note to confirm with MIRA. NEVER hard-code rates in code paths; templates are seed data.
- Quote engine: quote(stay request) → offers with nightly prices, inclusions, taxes/fees breakdown, totals (net/taxes/fees/gross), policies, restriction violations (explain why an offer is not bookable), and a self-contained, versioned TermsSnapshot that is sufficient to post every night later without reading current configuration (brief §5: agreed terms never silently change).
- priceChange(terms, change) for change previews: keep agreed nights at agreed prices, price new nights by policy, show differences.
- Rounding: single documented rounding per line; totals consistent with line sums (prove with property-based-style tests over many random inputs).
- Data authority domain `rates` (assertWritable) for configuration writes.
- Events rates.prices.changed / rates.restrictions.changed (coalescible ranges) for distribution.
- HTTP routes for rate plans, price calendar (bulk update with preview of affected dates), restrictions, packages, policies, tax rules (with effective dating), and POST /quotes. Permissions e.g. rates.ratePlan.manage, rates.price.manage, rates.taxRule.manage (sensitive), rates.quote.read.
- Seed helper: realistic Maldives demo rates (guesthouse B&B and half board; resort with seasonal BAR, derived non-refundable −10%, all-inclusive package with dining allowance and seaplane transfer inclusion, honeymoon promo).

Tests: rounding/tax compounding unit tests; rate change after booking does not alter a TermsSnapshot (brief §5 + readiness §19 "tax or rate changes affecting future versus historical records"); scenario s19 pricing part (packages + allowances + different taxes); isolation/permissions.
````

## Follow-up message (2026-11-07T07:32:35.545Z)

````text
You are the engineer for Portico's **rates** module (wave 1) — pricing, packages, policies, the single tax & fee engine and the quote engine. First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/rates (branch feat/rates-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_rates. Module path: modules/rates (package @portico/rates, schema `rates`). Spec: /home/user/wt/product/docs/specs/rates.md.

Build (provider contract in docs/architecture/domain-map.md § rates):
- Rate plans: base and derived (± amount / ± percent / rounding rule from a parent, multi-level, cycle-safe), meal plan, channel/market availability, member/negotiated (company-specific) plans, promotions & promo codes, sell dates vs stay dates.
- Prices per unit type × night × occupancy (base occupancy + extra adult + child age bands), seasonal/bulk calendar updates (date ranges + weekdays), with history (every price change versioned; who/when).
- Restrictions: min/max LOS (arrival-based and through), closed, CTA, CTD, min/max advance, sales limits.
- Packages, inclusions and allowances (monetary or quantity, per night/per stay/per person, consumable at outlets, unused-remainder policy) and meal plans implemented as inclusions.
- Policies: cancellation (deadlines relative to arrival in property time zone, fee rules: first night / % / fixed / non-refundable), guarantee, deposit schedules.
- TAX & FEE ENGINE (used for everything, not just rooms): rules are effective-dated DATA with source citation and verification status — percentage, per person-night, per unit-night, banded, capped, exempt; inclusive vs exclusive; compounding order (e.g. service charge then GST on top); applicability by charge category, property classification (e.g. mv.establishmentType), guest age, stay length. computeTaxes(tx, lines…) returns per-line tax breakdown with rule versions. Ship a Maldives template (TGST 17% from 2025-07-01 with history row 16% before; Green Tax USD 12 per person-night for resorts/hotels >50 rooms and USD 6 for ≤50-room inhabited-island guesthouses, children exemptions as configurable; 10% service charge) — mark each rule `verificationStatus: 'unverified'` with source URLs from docs/research/04-connectivity-payments-compliance.md and a note to confirm with MIRA. NEVER hard-code rates in code paths; templates are seed data.
- Quote engine: quote(stay request) → offers with nightly prices, inclusions, taxes/fees breakdown, totals (net/taxes/fees/gross), policies, restriction violations (explain why an offer is not bookable), and a self-contained, versioned TermsSnapshot that is sufficient to post every night later without reading current configuration (brief §5: agreed terms never silently change).
- priceChange(terms, change) for change previews: keep agreed nights at agreed prices, price new nights by policy, show differences.
- Rounding: single documented rounding per line; totals consistent with line sums (prove with property-based-style tests over many random inputs).
- Data authority domain `rates` (assertWritable) for configuration writes.
- Events rates.prices.changed / rates.restrictions.changed (coalescible ranges) for distribution.
- HTTP routes for rate plans, price calendar (bulk update with preview of affected dates), restrictions, packages, policies, tax rules (with effective dating), and POST /quotes. Permissions e.g. rates.ratePlan.manage, rates.price.manage, rates.taxRule.manage (sensitive), rates.quote.read.
- Seed helper: realistic Maldives demo rates (guesthouse B&B and half board; resort with seasonal BAR, derived non-refundable −10%, all-inclusive package with dining allowance and seaplane transfer inclusion, honeymoon promo).

Tests: rounding/tax compounding unit tests; rate change after booking does not alter a TermsSnapshot (brief §5 + readiness §19 "tax or rate changes affecting future versus historical records"); scenario s19 pricing part (packages + allowances + different taxes); isolation/permissions.
````

## Follow-up message (2026-11-07T11:25:27.577Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/rates-core — "merge after fixes": P0 1, P1 10, P2 18, P3 7. Full report: /home/user/portico/docs/orchestration/reviews/review-rates.md; probe scripts: /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/rates-probe/.
DECISIONS: rates OWNS the pricing contract (quote/Offer, TermsSnapshot, priceChange, penalties, complimentary/house-use pricing, ChargeLine/TaxLine, computeTaxes). Your shapes are canonical; reservations and finance will adapt to them. So: add what consumers legitimately need and publish a precise "Provider contract" section (exact TS types) in your README.
Fix:
- R-01 (P0): service charge / hotel-set fees must come from the TermsSnapshot at posting, never current config; add a test where the service charge rate changes after booking.
- R-03 (P1): priceChange must support ratePlanId change, unit-type change and `asOf`, returning the new sealed `terms` (name it clearly); provide `getRulePackStatus`; keep `Offer.taxesAndFees` backward-compatible or version it; finance's tax-port fields (taxGroup/priceMode) vs yours (taxCategory/taxInclusion): yours win — document them.
- NEW providers for consumers: `evaluateCancellationPenalty(terms, at)` and `complimentaryTerms(terms, kind: 'complimentary'|'house_use')` (value-based taxes zero; Green Tax per person-day kept, under-2 exempt — MIRA FAQ) so reservations stops re-implementing penalty/comp logic; always emit `TaxLine.basis` (percentage|banded|per_person_night|per_unit_night|per_stay|fixed_per_charge).
- R-04 (P1): never trust caller-declared channel / bookingDate / companyId: derive channel from the authenticated principal (API client → its channel); bookingDate = today in property time zone unless the actor has a dedicated `rates.quote.backdate` permission; company eligibility verified.
- R-08/R-09 (P1): deposits — tax point per payment allocation, never duplicating per-person fees (Green Tax 7200 vs 3600 bug); implement the Green Tax 24-hour block with ≥12-hour check-out rule as a rates function given actual arrival/departure instants (use the new kernel `zonedTimeToInstant`/`instantToZoned`).
- R-06/R-07 (P1): tax-inclusive zero/free night must not throw or abort other plans; bound percent fields (0–100 where applicable), floor at 0 with explicit validation errors.
- R-05 (P1): don't call a plain hash "tamper detection" unless it's keyed — use an HMAC with a server key (kernel `blindIndex`-style keyed hash or a dedicated key) or rename; `/v1/quotes/reprice` must not seal client-supplied terms without verifying the original seal.
- R-10, R-12 and the other P1s per report; R-19: add TGST 12% (general 6%) 2014-11-01..2022-12-31 (now verified on MIRA — see docs/readiness/maldives-tax-rules.md on main).
- Cheap P2s; use @portico/db pgCode/withSavepoint and kernel time-zone helpers instead of local copies.
Then `git merge --no-edit main`, lint/typecheck/tests, commit, and report back briefly with the final provider contract.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:55:28.661Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Read, SubagentHandback, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - Original task: build the Portico **rates** module (wave 1) in worktree /home/user/wt/rates (branch feat/rates-core), following the playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md.
     - Module path modules/rates, package @portico/rates, schema `rates`, test DB prefix PORTICO_TEST_DB_PREFIX=w1_rates.
     - Scope: rate plans (base/derived), prices with history, restrictions, packages/inclusions/allowances/meal plans, policies, the single tax & fee engine with a Maldives template (data, unverified/cited), the quote engine with a sealed TermsSnapshot, priceChange, rounding proofs, data authority, events, HTTP routes, permissions, demo seed, and tests (rounding/compounding, terms immutability, S19, isolation/permissions).
     - Deliverables: README.md, FOUNDATION_REQUESTS.md, and a final report via SubagentHandback.
   - Interim orchestrator instructions, all done:
     - Merge main (demo seeder DemoSeedStep, boundary guardrail).
     - Use docs/readiness/maldives-tax-rules.md: time of supply, `mv.registeredRooms`, `verified_official_source`, GST not on Green Tax, the 12-hour rule, USD reporting.
     - Universal record contract (status/allowedActions/issues/links, recordTypes, SearchProvider).
   - Current request (steward review fix round):
     - Rates OWNS the pricing contract; publish a precise "Provider contract" section (exact TS types) in the README.
     - Fix R-01 (P0, commercial fees pinned to terms + test), R-03 (priceChange ratePlanId/typeChange/asOf, return sealed `terms`, getRulePackStatus, taxesAndFees compat, document finance field mapping).
     - New providers: evaluateCancellationPenalty(terms, at) and complimentaryTerms(terms, kind) keeping Green Tax; always emit TaxLine.basis.
     - R-04 (channel from principal, bookingDate = today unless `rates.quote.backdate`, company verified), R-08/R-09 (deposit tax point per allocation, Green Tax 24h/12h function using kernel tz helpers), R-06/R-07 (zero/free inclusive nights, bounded percents), R-05 (HMAC seal, verify before reprice).
     - R-10, R-12 and the other P1s, R-19 (TGST 12%/GST 6% history 2014-11-01..2022-12-31), cheap P2s; use @portico/db pgCode/withSavepoint and kernel time-zone helpers.
     - Then `git merge --no-edit main`, lint/typecheck/tests, commit, and **report back briefly with the final provider contract**.
   - Constraints to preserve:
     - Write only inside modules/rates plus minimal wiring in apps/api/src/composition.ts, apps/api/package.json and apps/api/test/rates*.test.ts (the parity doc docs/parity/rates.md was explicitly required by R-02).
     - Do not modify packages/kernel, db, http, testing, other modules, CLAUDE.md or other docs.
     - Never push; never rebase or touch other branches; commit with Conventional Commits ending with:
       ```
       Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
       Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
       ```
     - Never drop databases I did not create.
     - Never run Biome on *.md files.
     - No secrets in code; no `any`, no default exports, no floats for money, no `new Date()` in domain code.
     - The final report goes through SubagentHandback (call it last, once).

2. Key Technical Concepts:
   - Modular monolith: modules own their schema; ports and adapters bound in apps/api/src/composition.ts; boundary checker (tools/check-boundaries.mjs) runs in `pnpm lint`.
   - TxContext/withTenantTx, RLS via core.enable_tenant_isolation, runIdempotent with Idempotency-Key, ETag/If-Match, tx.audit, tx.emit outbox, platform.assertWritable (data authority `rates`).
   - Money as integer minor units; Decimal for math; a single documented rounding per rule per line part; inclusive decomposition with the residue assigned to net; property-based tests with the mulberry32 PRNG.
   - Tax engine:
     - Rule kinds: percentage, banded, per_person_night, per_unit_night, per_stay, fixed_per_charge.
     - Compounding bases; classification predicates (3-valued); caps and exemptions; tax point policies service_date / booking_date / invoice_date / time_of_supply.
     - Statutory vs commercial nature; pinned versions selected by start date only.
     - `taxPointSplits` (value-based rules per part, levies once); `adjustment` supply/reversal/price_adjustment; `levyOnly`; `estimated` flag; FX evidence and date validation.
     - `inclusive` mode backs out value-based rules only (levies on top), with dependency closure.
   - Green Tax 24-hour blocks: `levyDays` (≥ 12 h last block) and `levyTrueUp`.
   - TermsSnapshot v1 sealed with HMAC-SHA256 server key (`seal`, `supersedesSeal`), verified over the raw object; key from env PORTICO_TERMS_SEAL_KEY (dev default only outside production).
   - Quote principal rules: staff (user/system) vs api_client (channel from port or `api_client:<id>`) vs guest ('booking_engine'); backdate permission; non-staff never see unbookable offers; connected mode refuses quotes; per-offer TaxConfigurationError isolation.
   - Derived pricing: percent / amount / combined, per unit-night amount semantics, floor/ceiling, below-zero violation, depth ≤ 3, acyclic under an advisory lock, sellable plans only under active parents.
   - Sales limits scoped by the restriction source (plan/all × unit type/all), non-overridable, per-property-night advisory lock.
   - Universal record contract (kernel records.ts), SearchProvider (@portico/db), recordTypes in the manifest.
   - Parity matrix format and gate (`node tools/parity-report.mjs --gate rates`).

3. Files and Code Sections (all under /home/user/wt/rates):
   - **modules/rates/src/contracts.ts** — the canonical Zod contracts.
     - Fix-round additions: `percent0to100`, `percentAdjustment`; taxRuleInput `nature: z.enum(['statutory','commercial']).default('statutory')`; taxRule DTO `nature`.
     - chargeLine adds `taxPointSplits`, `agreedRuleVersionIds`, `adjustment`, `levyOnly` (default false), `taxPointDate`.
     - computeTaxesInput: `fullPaymentDate` and `expectedInvoiceDate` replace `paymentDate`.
     - taxLine now has: `category`, `nature`, `basis` (renamed from kind), `inclusive`, `base: money.nullable()`, `ratePercent`, `quantity {persons, exemptPersons, nights, units} | null`, `fixedAmount`, `fx`, `amount`, `ledgerMappingKey`, `verificationStatus`, `taxPointDate`, `estimated`.
     - penalty `percent_of_stay` is bounded; cancellationStructure.basis enum `['net_and_fees','gross','net']`, default `net_and_fees`.
     - inclusionInput/inclusion/inclusionSnapshot gain `outletKind`; adjustment adds a `combined` kind; derivationInput adds `floorMinor`/`ceilingMinor`.
     - Violation kinds add `derived_price_below_zero` and `tax_computation_failed`; component gains `outletKind`; taxSummaryLine gains `nature` and `basis`.
     - commissionTerms adds `agencyCollects` and `invoiceable`; new `priceOverrideRecord`.
     - termsSnapshot: priceSource adds `complimentary`/`house_use`; taxes gain `commercialRuleVersionIds`; adds `priceOverride`, `supersedesSeal`, `seal`.
     - offer: `taxesAndFees: z.array(taxLine)` plus `taxSummary`.
     - stayChangeRequest is `.strict()` with `nights`, `occupancy`, `unitTypeId`, `ratePlanId`, `newNights`, `manualNightAmountsMinor`, `typeChange`, `asOf` (LocalDate or ISO).
     - repricingResult: `nightly` (source adds `plan_changed`) and `terms`.
     - New schemas: `penaltyEvaluation`, `priceOverrideRequest` (strict; override nightly / total / complimentary / house_use plus reason), `rulePackStatus`, `levyTrueUp`, `effectiveRestrictionDay`; recordAction / recordIssue / recordLink, `ratePlanRecord`, `taxRuleRecord`.
   - **modules/rates/src/domain/tax-engine.ts** — fully rewritten.
     - TaxRuleHeader has `nature`; TaxEngineContext has `fullPaymentDate`/`expectedInvoiceDate`.
     - `taxPointDate()` returns `{date, estimated}`; `isQuantityBased`; commercial pinning via `line.agreedRuleVersionIds`; scope `{valueBased, quantityBased}`; adjustment handling.
     - `includedSet` (inclusive excludes quantity rules) plus dependency closure; `toLineMinor` returns fx and validates asOf vs pointDate (`fx_rate_date_mismatch`).
     - Bases use the final net; `computeSingle`, `computeSplitLine` (validates splits, levies once, errors `invalid_tax_point_splits`, `split_with_included_levies`), `computeLine`, `computeTaxesPure`.
     - `levyDays(checkInAt, checkOutAt, minHoursLastBlock=12)`.
   - **modules/rates/src/domain/pricing.ts**
     - `adjustExact(amount, adj, perPerson)` (percent first, then amount; amount never changes per-person values).
     - `applyAdjustment`; `adjustParams(p, adj, rounding, bounds, flags)` with floor/ceiling and `flags.belowZero`.
     - DerivationStep has `floorMinor`/`ceilingMinor`; `deriveParams` and `resolveDerivedParams(root, steps, ut, flags?)`.
   - **modules/rates/src/domain/offer.ts**
     - priceNights emits `derived_price_below_zero`.
     - AssembleInput gains `agreedRuleVersionIds?` and meta `{priceOverride?, supersedesSeal, sealKey}`.
     - Components carry outletKind; lines carry outletKind and agreedRuleVersionIds; tax context gets `expectedInvoiceDate: input.departure`.
     - Assembled has `taxesAndFees: TaxLine[]` and `taxSummary`; commercialRuleVersionIds in the terms; net commission model.
     - `sealTerms(input.meta.sealKey, {...})`; toOffer includes taxSummary.
   - **modules/rates/src/domain/terms-seal.ts** (new; replaces terms-hash.ts, which was git rm'd):
     ```ts
     const PREFIX = 'hmac-sha256:';
     export function sealOf(key: string, content: Record<string, unknown>): string {
       const { seal: _seal, ...rest } = content;
       return `${PREFIX}${createHmac('sha256', Buffer.from(key, 'base64')).update(canonicalJson(rest)).digest('hex')}`;
     }
     export function sealTerms(key, draft) { return { ...draft, seal: sealOf(key, draft) }; }
     export function verifyTerms(key: string, terms: unknown): boolean // constantTimeEqual over the raw object
     ```
   - **modules/rates/src/seal-key.ts** (new): `termsSealKeyFromEnv(env)` returns `{ key, keySource }`; production requires PORTICO_TERMS_SEAL_KEY and rejects the dev key.
   - **modules/rates/src/domain/terms.ts** — rewritten.
     - `PostingLine` (outletKind, bookingDate, agreedRuleVersionIds), `postingPlan`, `postingChargeLines`, `instantiatePaymentSchedule`, `penaltyBasisAmount`.
     - `evaluateCancellationPenalty(terms, at, {event?, nights?})`.
     - `levyTrueUp(terms, {checkInAt, checkOutAt, minHoursLastBlock?})`: levyOnly line; reversal if delta < 0; nightIndex ≥ 1.
     - `plannedPolicies`, `planMetaOf`.
     - `applyPriceOverride` keeps base = max(original, new); comp/house_use zero nights and added inclusions; sealed with priceOverride.original.
     - `reprice` supports `newPlan`, asOf `changeAt`, Decimal average, penalties via evaluateCancellationPenalty, `nightly` / `terms`, agreedRuleVersionIds unless the plan changed.
   - **modules/rates/src/domain/policies.ts**: `zonedInstant`/`formatLocal` now wrap kernel `zonedTimeToInstant`/`instantToZoned`; schedule uses `laterDate`.
   - **modules/rates/src/domain/restrictions.ts**:
     - `soldFor?(date, scope)` replaces the sold map.
     - The sales_limit violation has `overridable: false`.
     - `ownerPlanForKind` makes salesLimit the plan's own.
   - **modules/rates/src/domain/promotions.ts**: PromotionContext `planIsContracted`; a promotion without `ratePlanIds` never applies to contracted (companyIds or net) plans.
   - **modules/rates/src/domain/calendar.ts**: `earlierDate`/`laterDate` helpers.
   - **modules/rates/migrations/0001_rates.sql** (edited in place; not yet on main): `inclusions.outlet_kind text`, `tax_rules.nature text not null default 'statutory' check (...)`, `plan_sales.unit_type_id uuid not null`, and a plan_sales index on (tenant_id, property_id, stay_date) where released_at is null. src/tables.ts is updated to match.
   - **modules/rates/templates/mv-tax-pack.json**:
     - MV-SC is `nature: commercial` with notes.
     - MV-TGST versions: 12% 2014-11-01→2023-01-01, 16% 2023-01-01→2025-07-01, 17% from 2025-07-01; MIRA news URL https://www.mira.gov.mv/ContentItems/View/newsgstratechange; verified_official_source.
     - MV-GST-GENERAL: 6% 2014-11-01→2023-01-01, then 8%.
     - Green Tax 12/6 USD rules are statutory.
   - **modules/rates/src/ports.ts**: adds optional `channelForApiClient(tx, clientId)`, `companyExists(tx, companyId)`, and `affectedAgreements(tx, {ruleId, ruleCode, nature, from, to}) → {stays, deposits, items}`.
   - **modules/rates/src/manifest.ts**:
     - Adds permissions `rates.quote.backdate` (sensitive) and `rates.price.override` (sensitive).
     - recordTypes: rate_plan, rate_policy, inclusion, package, promotion, tax_rule, tax_rule_version.
   - **modules/rates/src/services/tax-rules.ts**:
     - Conservative today = date in Pacific/Kiritimati.
     - Nature stored and returned.
     - Rule row `forUpdate` in buildActivationReport; nature-aware impact text; `affectedAgreements` port.
     - Activation update inside `withSavepoint` mapping `pgCode(err)==='23P01'` to ConflictError `tax_rule_version_overlap`.
     - `previewTaxRuleActivation(ports, tx, id)` and `activateTaxRuleVersion(ports, tx, id, raw)`.
     - `loadTaxRulesForProperty(tx, property, {ruleVersionIds?, agreedVersionIds?})` with nature in the header.
     - computeTaxesDetailed collects agreed ids.
     - `getRulePackStatus(ports, tx, propertyId)` excludes rules whose classification evaluates to false.
   - **modules/rates/src/services/quote.ts** — rewritten.
     - `QuoteDeps {ports, sealKey}`; `principalOf`, `resolveBookingDate`, `assertRatesManagedHere` (`rates_managed_externally`).
     - loadQuoteConfig loads all property sales with unit type; configVector includes property facts and sales; `soldWithin`; `assembleIsolated`.
     - `quoteDetailed`/`quote(deps, …)`; `assertSealed` (`terms_seal_invalid`); `resolveAsOf`.
     - `priceChange` (plan change via newPlan; strict; asOf).
     - `overridePrice` (staff only; `rates.price.override`; audit `rates.terms.priceOverride`) and `complimentaryTerms`.
     - `recordPlanSale` (unit type, scoped limit, per-property-night lock) and `releasePlanSale`.
   - **modules/rates/src/services/rate-plans.ts**: `lockPlanGraph` in changeRatePlanStatus; validateDerivation refuses a non-active parent for non-draft plans (`parent_plan_not_active`).
   - **modules/rates/src/services/catalog.ts**: inclusion outletKind mapping.
   - **modules/rates/src/services/calendar.ts**: getEffectiveRestrictions uses `as const` for scope.
   - **modules/rates/src/search.ts**: `likeEscape` for ILIKE patterns.
   - **modules/rates/src/service.ts**: `ratesService(ports, options: { termsSealKey })`.
     - Exposes quote, quoteDetailed, priceChange, overridePrice, complimentaryTerms, computeTaxes, computeTaxesDetailed, getRulePackStatus, getRatePlan, listRatePlans, recordPlanSale, releasePlanSale.
     - Also postingPlan, postingChargeLines, `verifyTerms(terms: unknown)` (bound to the key), instantiatePaymentSchedule, evaluateCancellationPenalty, levyDays, levyTrueUp.
     - Plus record views, config CRUD and tax rule operations (preview/activate wrapped with ports).
   - **modules/rates/src/routes.ts**:
     - New routes: POST `/terms/price-override`, POST `/terms/penalty` (seal verified, `rates.quote.read`), GET `/tax-rule-packs/:propertyId`.
     - Response schemas for `/rate-policies/:id/versions` and `/rate-plans/:id/effective-restrictions`; ETag on POST /tax-rules; imports `ValidationError`.
   - **modules/rates/src/index.ts**: rewritten to export levyDays, evaluateCancellationPenalty, instantiatePaymentSchedule, levyTrueUp, postingChargeLines, postingPlan, termsSealKeyFromEnv, RatesServiceOptions, etc. It no longer exports hashTerms/verifyTerms.
   - **apps/api/src/composition.ts**: imports termsSealKeyFromEnv; `const rates = ratesService(ratesPorts, { termsSealKey: termsSealKeyFromEnv().key });` with platform-bound ports; ratesSearch registered.
   - Tests:
     - src/domain/*.test.ts: test-fixtures has nature and SC commercial.
     - tax-engine.test.ts adds R-01/R-06/R-08/R-09/R-15/R-16/R-17 tests.
     - The property test's P5 uses `rules` mode.
     - offer.test.ts uses `KEY` and a shared `RULES`, plus penalty/true-up/override tests.
     - rules.test.ts uses soldFor and the non-overridable sales limit.
   - Integration tests:
     - test/harness.ts: `TEST_SEAL_KEY`; ratesService(ports, {termsSealKey}).
     - test/quote.test.ts: taxSummary, nightly, terms, seal.
     - test/terms-immutability.test.ts: postingChargeLines; SC 12% change after booking (R-01); deposit split (R-08); fullPaymentDate; draft selected by status.
     - test/tax-rules.test.ts: TGST 3 versions; fullPaymentDate.
     - New **test/provider-contract.test.ts** (11 tests): principal/channel/backdate/company, connected mode, inclusive free night, bounds/negative/combined, net model, override/complimentary, scoped sales limits, priceChange plan change/strict/asOf, rule pack status, tax-rule isolation.
     - apps/api/test/rates.test.ts: nightly, penalty route, forged terms, rule pack route.
   - **docs/parity/rates.md** (new): 40 capability rows (P0 tested; P1 specified/deferred/building) and 24 edge cases. Evidence column says "assumption" honestly. Gate result: "Gate passed for rates." COVERAGE.md was restored to avoid churn.
   - **modules/rates/README.md**: just rewritten. Contains the canonical Provider contract (exact TS types), a consumer mapping table (finance and reservations names to canonical), capabilities/readiness with downgrades, rounding rule, invariants→tests, scenarios, permissions, events, ports/binding status, seal key, contract changes (breaking listed), known gaps, and open questions.
   - **modules/rates/FOUNDATION_REQUESTS.md** (unchanged from the first round): platform getPropertyFacts request; domain-map update request.

4. Errors and fixes:
   - First round:
     - Free-night negative room line: inclusions now shrink proportionally.
     - Sales limit inheritance: never inherited.
     - Per-person child-band pricing fixed.
     - Pinned versions closed by a successor broke historical recompute: select pinned versions by start date only.
     - unverifiedTaxRules now means "not adviser-verified".
     - Assorted test expectation fixes.
   - Fix round:
     - Python replace patterns didn't match Biome-formatted text (e.g. `verificationStatus,` shorthand). I inspected the actual text and re-patched.
     - The Write tool refused unread files; I used Read first or a bash heredoc.
     - Property test "Include both or neither" error: added dependency closure for inclusive/rule_default modes.
     - Fixture GREEN12 has no child exemption, so test expectations were adjusted; quantity now includes exemptPersons.
     - offer.test used separate maldivesLikeRules() instances with different fake ids: fixed with a shared `RULES`.
     - Complimentary override produced 0 taxes (negative room line → price_adjustment skipped Green Tax): fixed by setAmount keeping baseAmountMinor = max(original, new).
     - Rule pack listed GREEN-6/GST-GENERAL: classification filter added (GST-GENERAL stays as outlet-dependent) and the expectation updated. A first patch attempt aborted on a formatting mismatch and was re-applied.
     - Immutability test picked the wrong TGST version number: now selects drafts by `status === 'draft'`.
     - Effective restriction scope typing fixed with `as const`.
     - index.ts edits had silently not applied earlier: the file was rewritten.

5. Problem Solving:
   - Every steward finding addressed in code or documentation:
     - R-01, R-03, R-04, R-05 (HMAC), R-06, R-07, R-08, R-09.
     - R-10 (port; two-phase activation deferred and documented), R-11, R-12, R-13/R-14, R-16, R-17 (fx evidence; MMA ±2% left to finance), R-19, R-20, R-21, R-22, R-23, R-24, R-25 (README downgrades), R-27, R-28, R-29 (documented), R-30–R-36.
     - R-18 (per_document rounding) and R-26 (localization) deferred and documented.
     - R-02 parity file added; the gate passes.
   - Current results: rates 12 files / 126 tests pass; API 5 files / 14 tests pass; `pnpm lint` (Biome + boundaries) passes; `pnpm typecheck` passes.
   - Fix-round commit: 5663f25.

6. All user messages:
   - Initial task message:
     - Rates module engineer for wave 1; read and follow the playbook exactly.
     - Worktree /home/user/wt/rates (branch feat/rates-core); PORTICO_TEST_DB_PREFIX=w1_rates; module path modules/rates (package @portico/rates, schema `rates`); spec /home/user/wt/product/docs/specs/rates.md.
     - Full build list: rate plans, prices, restrictions, packages/allowances, policies, tax & fee engine, Maldives template marked unverified with source URLs and a note to confirm with MIRA (never hard-code rates), quote engine with TermsSnapshot, priceChange, rounding with property-based tests, data authority `rates`, events, HTTP routes and permissions, demo seed.
     - Tests requested: rounding/compounding, TermsSnapshot immutability, S19 pricing, isolation/permissions.
     - Final report via SubagentHandback.
   - Orchestrator: run `git merge --no-edit main` then `pnpm install`. Main has: a flaky DB fix, the module-boundary guardrail in `pnpm lint`, and a demo seeder DEMO_SEED_STEPS (export the demo seed as a DemoSeedStep-compatible function). No reply needed.
   - Orchestrator: verified Maldives tax rules are on main (docs/readiness/maldives-tax-rules.md); merge main and use them. It listed:
     - Time of supply.
     - Green Tax details (`mv.registeredRooms`, under-2 exempt, complimentary taxable, 12-hour check-out).
     - GST not on Green Tax; service charge in the GST base.
     - USD reporting ±2% MMA.
     - Mark template rules `verified_official_source` with MIRA URLs ("not legal advice — adviser to confirm", Q20).
     - No reply needed.
   - Orchestrator: new cross-module convention. Merge main; read domain-map § "Universal record contract" and experience-architecture.md:
     - (1) GET includes status, allowedActions, issues, owner, links.
     - (2) Declare recordTypes.
     - (3) Export a SearchProvider.
     - (4) Never put secrets or sensitive identity values in audit before/after.
     - Note coverage in the README. No reply needed.
   - Orchestrator (latest), steward verdict on feat/rates-core — "merge after fixes": P0 1, P1 10, P2 18, P3 7.
     - Report: /home/user/portico/docs/orchestration/reviews/review-rates.md; probes: /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/rates-probe/.
     - DECISIONS: rates OWNS the pricing contract (quote/Offer, TermsSnapshot, priceChange, penalties, complimentary/house-use pricing, ChargeLine/TaxLine, computeTaxes). Its shapes are canonical; reservations and finance adapt. Add what consumers legitimately need and publish a precise "Provider contract" section (exact TS types) in the README.
     - Fix R-01 (P0) with a service-charge-change test.
     - Fix R-03: priceChange ratePlanId change, unit-type change and `asOf`, returning the new sealed `terms`; provide `getRulePackStatus`; keep `Offer.taxesAndFees` backward-compatible or version it; finance taxGroup/priceMode vs rates taxCategory/taxInclusion — rates wins, document them.
     - New providers: `evaluateCancellationPenalty(terms, at)` and `complimentaryTerms(terms, kind)` (value-based taxes zero; Green Tax per person-day kept, under-2 exempt); always emit `TaxLine.basis`.
     - Fix R-04 (channel from the principal, bookingDate = today unless `rates.quote.backdate`, company eligibility verified).
     - Fix R-08/R-09 (deposits: tax point per payment allocation, no duplicated per-person fees; a Green Tax 24-hour block function using kernel `zonedTimeToInstant`/`instantToZoned`).
     - Fix R-06/R-07 (zero/free inclusive nights must not throw; bound percents; floor at 0 with explicit validation).
     - Fix R-05 (HMAC with a server key or rename; `/v1/quotes/reprice` must not seal client-supplied terms without verifying).
     - Fix R-10, R-12 and the other P1s; R-19 (add TGST 12%, general 6%, 2014-11-01..2022-12-31).
     - Cheap P2s; use @portico/db pgCode/withSavepoint and the kernel time-zone helpers.
     - "Then `git merge --no-edit main`, lint/typecheck/tests, commit, and report back briefly with the final provider contract."

7. Pending Tasks:
   - Commit the new README.md and docs/parity/rates.md (plus any remaining changes).
   - Run `git merge --no-edit main` again, then `pnpm install`.
   - Re-run `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/rates test`, `pnpm --filter @portico/api test` (with PORTICO_TEST_DB_PREFIX=w1_rates) and `node tools/parity-report.mjs --gate rates`. Restore docs/parity/COVERAGE.md afterwards if it is regenerated.
   - Commit, then report back briefly with the final provider contract via SubagentHandback, as the last action.

8. Current Work:
   - Immediately before this summary I finished the steward-review fix round. Code was committed as 5663f25: "fix(rates): steward review round — canonical provider contract and money-correctness fixes".
   - Since then:
     - I wrote docs/parity/rates.md; the gate passed and COVERAGE.md was restored with `git checkout`.
     - I rewrote modules/rates/README.md (via bash heredoc) with the "Provider contract (canonical)" section, the consumer mapping table, updated readiness, invariants, contract changes (breaking listed), gaps and open questions.
   - Both files are uncommitted. All tests (126 rates + 14 API), lint and typecheck were green before the README/parity docs were added.

9. Optional Next Step:
   - Continue the orchestrator's latest instruction: "Then `git merge --no-edit main`, lint/typecheck/tests, commit, and report back briefly with the final provider contract."
   - Concretely:
     - Commit README.md and docs/parity/rates.md, e.g. "docs(rates): provider contract, parity matrix".
     - Run `git merge --no-edit main` and `pnpm install`.
     - Re-run lint, typecheck, rates and API tests, and the parity gate.
     - Commit any merge fixes.
   - Then call SubagentHandback with a brief report:
     - Fixes made, test counts and commits.
     - The final provider contract summary: ratesService(ports, {termsSealKey}); quote/quoteDetailed; priceChange returning `{nightly, penalties, before, after, difference, violations, terms}`; overridePrice/complimentaryTerms; evaluateCancellationPenalty; postingPlan/postingChargeLines; levyDays/levyTrueUp; computeTaxes/computeTaxesDetailed with the ChargeLine/TaxLine shapes; getRulePackStatus; recordPlanSale/releasePlanSale; verifyTerms.
     - Bindings needed: listUnitTypes, channelForApiClient, companyExists, affectedAgreements, PORTICO_TERMS_SEAL_KEY.
     - Consumer adaptations required in reservations and finance.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a22524f08e4267407.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T08:24:21.260Z)

````text
The rates module is built on `feat/rates-core` in /home/user/wt/rates, in 13 commits; nothing is pushed. I merged main three times as you asked. Lint (including the boundary check), workspace typecheck and the full test run all pass, and the migrations apply cleanly to an empty database.

**What's built** (`modules/rates`, schema `rates`, 14 tables)
- **Rate plans:** base plans plus derived plans up to two levels deep. Derived plans can't form cycles, even with two people editing at once. Each derived plan chooses per restriction type and per policy whether to inherit from its parent. Also covered: meal plans, channel/company eligibility (negotiated plans with commission or net terms), sell and stay windows, and draft/active/paused/retired status.
- **Prices:** set per unit type, night and occupancy (base, single, extra adult, child age bands, occupancy overrides). Bulk updates by date ranges and weekdays come with a preview that also lists the derived plans affected. Every change is kept in history with who and when.
- **Restrictions:** all the listed kinds, with plain-language explanations when a stay breaks one. Staff with the override permission can book through them with a reason; channels never can.
- **Promotions, packages, inclusions and allowances:** promo codes, early booking, stay-7-pay-6 and combinability rules. Packages can be part of a plan or added to a stay; allowances carry their remainder policy.
- **Policies:** cancellation deadlines in the property's time zone, guarantee, and deposit schedules. Policy text is generated from the structure.
- **Tax & fee engine:** rules are dated, cited data. It handles compounding, prices that include tax, caps, exemptions, and four tax-point policies including Maldives time of supply. Activation shows a change report first.
- **Quote engine and agreed terms:** every offer carries a sealed, versioned TermsSnapshot that is enough to post every night without reading current configuration. `priceChange` handles extensions, shortenings, occupancy and unit-type changes.
- **Plumbing:** HTTP routes, the universal record contract (rate plans and tax rules only), search provider, events, and the Maldives demo seed.

**Maldives template** comes from main's `maldives-tax-rules.md`: TGST 16%→17%, general-sector GST 8%, Green Tax USD 12 / USD 6 using `mv.registeredRooms` with under-2s exempt, and service charge 10%. The MIRA-sourced rules are marked `verified_official_source`; service charge is `unverified` because its legal basis wasn't confirmed. All carry "adviser to confirm (Q20)".

**Tests:** 105 in rates (70 pure logic, including ~6,000 random cases proving totals always add up exactly; 35 against a real database) plus 2 HTTP end-to-end tests in the API.
- The required scenario tests pass: S19 pricing (`test/scenario-s19-package-bill-pricing.test.ts`) and rate/tax changes after booking (`test/terms-immutability.test.ts`).
- The tests found and I fixed four real defects:
  - closing an old tax version changed later recalculations of past charges;
  - a free promotional night produced a negative room line;
  - derived plans inherited sales limits;
  - per-person inclusions ignored child bands.

**Things that differ from the brief or spec**
- Amount adjustments on derived plans apply per room-night and don't change extra-adult or child prices; percent adjustments change everything. This is a product decision; it's listed in the README's open questions.
- Sales limits needed a sales ledger that reservations feeds through two new calls, `recordPlanSale` / `releasePlanSale`.
- I added a `rates.taxRule.read` permission, since nothing in the spec covered reading tax rules.

**What you need to do at merge**
- Bind the optional `listUnitTypes` port to inventory. Until then, unit type ids aren't checked on price writes and the demo seed can't run.
- Register the demo seed: `{ name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) }`, after the inventory step.
- Copy the additive contract changes from the README into `domain-map.md`. The main ones: richer `ChargeLine` for `computeTaxes` (including `taxPointDate`), `computeTaxesDetailed`, `postingPlan`, `instantiatePaymentSchedule`, and the sales-ledger calls.
- Foundation request: a platform `getPropertyFacts` that needs no permission. Rates is currently bound to `platform.getProperty` using the system authorizer.

**Gaps:**
- Pricing recommendations, mirroring rates from an external system, and forwarding rate edits to one aren't built; rate writes are refused when another system owns rates.
- Second-currency plans need exchange rates in quotes and don't get them yet.
- The tax change report can't list affected stays; reservations and finance own that data.
- Policies, packages, inclusions and promotions return plain records, not the full record contract yet.

Readiness is R3 at most (implemented and tested internally); none of it is validated with staff or approved externally.

````

## Report (2026-11-07T08:24:21.260Z)

````text
The rates module is built on `feat/rates-core` in /home/user/wt/rates, in 13 commits; nothing is pushed. I merged main three times as you asked. Lint (including the boundary check), workspace typecheck and the full test run all pass, and the migrations apply cleanly to an empty database.

**What's built** (`modules/rates`, schema `rates`, 14 tables)
- **Rate plans:** base plans plus derived plans up to two levels deep. Derived plans can't form cycles, even with two people editing at once. Each derived plan chooses per restriction type and per policy whether to inherit from its parent. Also covered: meal plans, channel/company eligibility (negotiated plans with commission or net terms), sell and stay windows, and draft/active/paused/retired status.
- **Prices:** set per unit type, night and occupancy (base, single, extra adult, child age bands, occupancy overrides). Bulk updates by date ranges and weekdays come with a preview that also lists the derived plans affected. Every change is kept in history with who and when.
- **Restrictions:** all the listed kinds, with plain-language explanations when a stay breaks one. Staff with the override permission can book through them with a reason; channels never can.
- **Promotions, packages, inclusions and allowances:** promo codes, early booking, stay-7-pay-6 and combinability rules. Packages can be part of a plan or added to a stay; allowances carry their remainder policy.
- **Policies:** cancellation deadlines in the property's time zone, guarantee, and deposit schedules. Policy text is generated from the structure.
- **Tax & fee engine:** rules are dated, cited data. It handles compounding, prices that include tax, caps, exemptions, and four tax-point policies including Maldives time of supply. Activation shows a change report first.
- **Quote engine and agreed terms:** every offer carries a sealed, versioned TermsSnapshot that is enough to post every night without reading current configuration. `priceChange` handles extensions, shortenings, occupancy and unit-type changes.
- **Plumbing:** HTTP routes, the universal record contract (rate plans and tax rules only), search provider, events, and the Maldives demo seed.

**Maldives template** comes from main's `maldives-tax-rules.md`: TGST 16%→17%, general-sector GST 8%, Green Tax USD 12 / USD 6 using `mv.registeredRooms` with under-2s exempt, and service charge 10%. The MIRA-sourced rules are marked `verified_official_source`; service charge is `unverified` because its legal basis wasn't confirmed. All carry "adviser to confirm (Q20)".

**Tests:** 105 in rates (70 pure logic, including ~6,000 random cases proving totals always add up exactly; 35 against a real database) plus 2 HTTP end-to-end tests in the API.
- The required scenario tests pass: S19 pricing (`test/scenario-s19-package-bill-pricing.test.ts`) and rate/tax changes after booking (`test/terms-immutability.test.ts`).
- The tests found and I fixed four real defects:
  - closing an old tax version changed later recalculations of past charges;
  - a free promotional night produced a negative room line;
  - derived plans inherited sales limits;
  - per-person inclusions ignored child bands.

**Things that differ from the brief or spec**
- Amount adjustments on derived plans apply per room-night and don't change extra-adult or child prices; percent adjustments change everything. This is a product decision; it's listed in the README's open questions.
- Sales limits needed a sales ledger that reservations feeds through two new calls, `recordPlanSale` / `releasePlanSale`.
- I added a `rates.taxRule.read` permission, since nothing in the spec covered reading tax rules.

**What you need to do at merge**
- Bind the optional `listUnitTypes` port to inventory. Until then, unit type ids aren't checked on price writes and the demo seed can't run.
- Register the demo seed: `{ name: 'rates', run: createRatesDemoSeed(rates, ratesPorts) }`, after the inventory step.
- Copy the additive contract changes from the README into `domain-map.md`. The main ones: richer `ChargeLine` for `computeTaxes` (including `taxPointDate`), `computeTaxesDetailed`, `postingPlan`, `instantiatePaymentSchedule`, and the sales-ledger calls.
- Foundation request: a platform `getPropertyFacts` that needs no permission. Rates is currently bound to `platform.getProperty` using the system authorizer.

**Gaps:**
- Pricing recommendations, mirroring rates from an external system, and forwarding rate edits to one aren't built; rate writes are refused when another system owns rates.
- Second-currency plans need exchange rates in quotes and don't get them yet.
- The tax change report can't list affected stays; reservations and finance own that data.
- Policies, packages, inclusions and promotions return plain records, not the full record contract yet.

Readiness is R3 at most (implemented and tested internally); none of it is validated with staff or approved externally.

````

## Report (2026-11-07T12:06:37.109Z)

````text
## Rates: steward fix round done and merged with main

**Branch:** feat/rates-core in /home/user/wt/rates. Nothing pushed. The tree is clean.

**Commits:**
- 5663f25 — review fixes
- 6403140 — provider contract and parity docs
- 7edf495 — new test: pausing the plan a stay was booked on leaves the agreed terms intact
- e11fa46 — merge of the latest main (ddcc839, including operations)

**Checks, all with `PORTICO_TEST_DB_PREFIX=w1_rates`:**
- `pnpm lint` passes, including the boundary check.
- `pnpm typecheck` passes.
- `pnpm test` passes for the whole workspace.
- Rates: 12 files, 128 tests. API: 8 files, 31 tests.

**Parity gate fails.** Main already had the parity researcher's `docs/parity/rates.md`, with 87 capabilities and 35 edge cases. I used that matrix instead of mine and filled in the real status and tests for every row. I also added the guarantees from the review as new rows: PAR-RAT-088…093 and EC-RAT-036…051.
- **13 P0 rows are not tested:**
  - Localized names and policy text.
  - Per-document rounding (waits on Q41).
  - Affected stays and deposits in the tax change report (needs the `affectedAgreements` port).
  - Blocking fiscal documents while rule packs are unverified (finance and platform).
  - Multi-unit quotes.
  - Classification history over time (platform).
  - Channel bookings with child ages missing.
  - Allowance breakage and consumption (finance).
  - A 409 conflict when two people edit the same price cells.
- **18 P1 rows are `missing`.**
- All of these are listed in README § Known gaps. I did not mark any row better than its evidence.

**Merge wiring in apps/api/src/composition.ts:**
- Rates is added: manifest, HTTP routes, search, `services.rates`, and a demo seed step that runs after inventory.
- `listUnitTypes` is now bound to inventory, and `companyExists` to guests `getCompany` (a company counts if it is not inactive). Both read with the system authorizer, because rates checks its own permissions.
- New tests prove it:
  - An unknown unit type is refused over HTTP.
  - After the demo seed, every demo property returns a bookable quote.
  - A tax configuration problem marks offers unbookable with the reason, and the quote still succeeds.

## Final provider contract

The exact TypeScript types are in modules/rates/README.md § Provider contract (canonical).

```
ratesService(ports, { termsSealKey: termsSealKeyFromEnv().key })
quote / quoteDetailed(tx, QuoteRequest) → Offer[] / { quoteId, configVector, offers }
  - channel comes from the principal; bookingDate = today unless rates.quote.backdate; companyId is staff-only and verified
  - non-staff never see unbookable offers
  - Offer.taxesAndFees: TaxLine[] (domain-map shape); per-rule sums are in taxSummary
TermsSnapshot v1, sealed with HMAC-SHA256 (seal, supersedesSeal); verifyTerms(terms)
priceChange(tx, { terms, change }) → { nightly, penalties, before, after, difference, violations, terms }
  - verifies the seal first; the change is strict; supports ratePlanId / typeChange / asOf
  - returns the new sealed terms
overridePrice / complimentaryTerms(tx, …) → TermsSnapshot
  - needs rates.price.override and is audited
  - value-based taxes become 0; Green Tax per guest is kept (under-2 exempt)
evaluateCancellationPenalty(terms, at, { event?, nights? })  (pure; basis = price + hotel fees, never levies)
instantiatePaymentSchedule(terms)
postingPlan / postingChargeLines(terms, stayId)  (charge lines carry agreedRuleVersionIds)
levyDays(checkInAt, checkOutAt, 12) / levyTrueUp(terms, { checkInAt, checkOutAt })
computeTaxes / computeTaxesDetailed(tx, { lines: ChargeLine[], fullPaymentDate?, expectedInvoiceDate?, ruleVersionIds?, fxRates?, … })
  - ChargeLine adds taxPointSplits, agreedRuleVersionIds, adjustment, levyOnly
  - TaxLine adds basis, nature, base|null, quantity, fixedAmount, fx, taxPointDate, estimated
getRulePackStatus(tx, propertyId)
recordPlanSale / releasePlanSale, getRatePlan / listRatePlans
```

**Still to bind or set:**
- `channelForApiClient` (distribution). Until then, an API client sells as `api_client:<id>`.
- `affectedAgreements` (reservations/finance), for the tax change report.
- `PORTICO_TERMS_SEAL_KEY` must be set in production.

**What reservations and finance must change:** these breaking renames and removals are listed in the README.
- `TaxLine.kind` is now `basis`.
- `paymentDate` is replaced by `fullPaymentDate` plus `ChargeLine.taxPointSplits`.
- `nights` / `candidateTerms` are now `nightly` / `terms`.
- Terms are sealed with `seal` instead of a plain hash.
- Finance's `taxGroup` / `priceMode` map to rates' `taxCategory` / `taxInclusion`.

**For the domain map (orchestrator):** FOUNDATION_REQUESTS.md asks for a permission-free `platform.getPropertyFacts` and for the domain map's rates section to be updated.

````

