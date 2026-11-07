# Steward review: `feat/rates-core` (module `rates`)

Worktree `/home/user/wt/rates` · reviewed 2026-11-07 · spec `docs/specs/rates.md` (Draft v1, identical on main and branch)
Reviewer: architecture steward. I modified no files in the worktree. Probe scripts are in
`/tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/rates-probe/`.

## Verdict: **merge after fixes**

The code quality is high. The pure domain is well separated, the tests are numerous and genuinely concurrent, RLS
covers every table, the README is mostly honest, and tenant isolation is proven. Three things stop a merge as it stands:

1. One money-correctness defect: hotel-set fees are re-priced after booking (R-01).
2. The provider contract does not match what the `reservations` and `finance` worktrees consume. Integration breaks on merge (R-03).
3. The parity gate fails (R-02).

Also fix before merge: R-04 to R-08 and R-12. The rest can follow on a short fix list.

**Counts:** P0 = 1 · P1 = 10 · P2 = 18 · P3 = 7

## Command results (`PORTICO_TEST_DB_PREFIX=review_rates`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass (lockfile up to date) |
| `pnpm lint` | pass. Biome checked 142 files; "Module boundaries OK (3 modules checked)" |
| `pnpm typecheck` | pass. Turbo replayed a shared-worktree cache, so I re-ran `tsc --noEmit` uncached for `modules/rates` and `apps/api`: both exit 0 |
| `pnpm --filter @portico/rates test` | pass: 11 files, **105 tests** |
| `pnpm --filter @portico/api test` | pass: 4 files, **13 tests** |
| `git merge-tree --write-tree main HEAD` | clean. The branch is 4 commits behind main, including the parity-gate commit `df48df7` |
| `node tools/parity-report.mjs --gate rates` (on main) | **FAIL**: "No parity file for module "rates"". Exit 1 |

Probe results. I ran pure-domain calls with the shipped MV pack through `tsx`.

| # | Input | Result |
|---|---|---|
| 1 | One night USD 1000, 2 adults + children aged 1 and 5 | Green Tax 3600. The under-2 exemption works |
| 1b | The same night split into a deposit part (`taxPointDate`) and the remainder | Green Tax 3600 + 3600 = **7200** (doubled) |
| 2 | Accommodation adjustment of −USD 50 | Green Tax **−3600** |
| 3 | Tax-inclusive line of amount 0 (free or comp night) | throws `inclusive_amount_below_fixed_taxes` |
| 4 | 150 % promotion on a USD 500 night | night amount **−25000** |
| 5 | Derived plan −USD 200 on a USD 150 parent | **0**, silently |
| 6 | Quote for 29 Jun–2 Jul 2025, no invoice or payment date | TGST 16/16/17 |
| 6b | The same stay invoiced at check-out on 2025-07-02 | TGST 17/17/17 |
| 7 | 2021 supply | TGST **16** |
| 8 | MVR line | Green Tax tax line carries `base` = line net in MVR. No FX rate is recorded and no USD amount |
| 9 | 56 lines per-line vs document-level rounding | TGST 126644 vs 126664 |
| SC | Agreed night with service charge raised from 10 % to 12 % after booking | posted gross **133440 vs agreed 131100** |

## Findings (ranked)

### P0

**R-01 · P0 · Hotel-set fees (service charge) are recomputed from current configuration when a night is posted, so the agreed price changes**

- **Where:**
  - `templates/mv-tax-pack.json` (`MV-SC` `taxPointPolicy: "service_date"`)
  - `src/domain/terms.ts:44-47` (`postingPlan`: "Taxes are computed at posting time … rule versions in force then")
  - `src/contracts.ts` (`termsSnapshot.taxes.ruleVersionIds` is "reference only")
  - `src/services/tax-rules.ts:315-316`
- **Problem:** the service charge, and any resort or destination fee modelled as a rule, is a *commercial* term the hotel sets, not a statutory tax. Because every rule follows its tax point at posting, a later SC version re-prices nights that were already agreed.
  - Probe: agreed gross 131100; posted gross after the hotel raises SC to 12 % is 133440.
  - The activation report shown to the approver states "Agreed stays keep their agreed prices", which is false for fees.
  - The E08 test (`test/terms-immutability.test.ts:97-131`) changes only TGST, so this path is untested.
- **Why it matters:** this breaks CLAUDE.md §5 ("later configuration changes never rewrite them") and E08. The guest pays more than agreed on tax-exclusive plans. On tax-inclusive plans, revenue and the staff SC pool change silently. The US FTC all-in rule makes this illegal for resort fees.
- **Fix:**
  - Add a rule attribute, e.g. `basis: 'statutory' | 'commercial'`, or a tax-point policy `agreement`. Commercial rules are pinned to the version recorded in the terms. Alternatively set MV-SC to `booking_date` and carry `bookingDate` on `PostingLine` / `ChargeLine`.
  - Make the activation report say which agreements change.
  - Extend the E08 test to change MV-SC after booking and assert that posted SC equals the agreed SC.

### P1

**R-02 · P1 · The parity gate fails: `docs/parity/rates.md` does not exist (also absent in `/home/user/wt/parity-front`)**

- **Why it matters:** CLAUDE.md §7 says the module is not complete without it. The steward must check it on every merge.
- **Fix:** write the matrix and the edge-case catalogue. The section "Parity: capabilities missing" below lists rows to seed it.

**R-03 · P1 · The provider contract does not match the consumers in other worktrees (breaks at merge). README "Contract changes … all additive" is inaccurate**

- **Where:** `src/contracts.ts:1120-1336` vs `/home/user/wt/reservations/modules/reservations/src/ports.ts:19-95,210-262` and `/home/user/wt/finance/modules/finance/src/ports.ts:40-90`.
- **Problem:**
  - `priceChange`: reservations sends `{ratePlanId, typeChange, asOf}`. `stayChangeRequest` silently strips all three (non-strict Zod), so a rate-plan change is ignored and the chosen type-change policy is dropped. Reservations then reads `result.terms` (`changes.ts:548-560`), but rates returns `candidateTerms` and `nights` (reservations expects `nightly`).
  - `TermsSnapshot` shapes differ:
    - `ratePlanId` vs `ratePlan.id`.
    - `priceSource 'portico'|'override'` vs `'portico_quote'|'manual_override'`.
    - Tax lines: `{code,name,kind:'tax'|'fee'}` vs `{ruleCode,ruleName,category}`. Rates' `kind` means the rule kind, so the same field name has two meanings.
    - Cancellation: `tiers[].deadline.daysBeforeArrival` with `Penalty{amount: Money, percent:number}` vs `structure.tiers[].from: Deadline` with `{amountMinor, percent:string}`.
    - `commission{kind:'percent'|'net_rate'}` vs `{model:'commissionable'|'net'}`.
    - `override{kind:'complimentary'|'house_use'…}` has no rates counterpart.
  - `Offer.taxesAndFees` changed from `TaxLine[]` (domain map) to `TaxSummaryLine[]`. This is breaking, not additive.
  - Finance `TaxPort` mismatches:
    - `taxGroup` and `priceMode` vs required `taxCategory` and `taxInclusion.mode`, so finance's lines fail rates validation.
    - `stayContext{stayId,nights}` vs `{stayNights}` (required).
    - The output expects `{name, kind:'service_charge', accountKey, units, exemptUnits}`.
    - Finance expects `getRulePackStatus`, which rates does not provide.
- **Fix:**
  - The orchestrator picks rates' `TermsSnapshot` and `ChargeLine` as canonical, because rates owns them. Update `domain-map.md` § rates.
  - Make `stayChangeRequest` `.strict()` and add `ratePlanId` (plan change) or reject it explicitly.
  - Provide `getRulePackStatus`, or document that finance should derive it from `unverifiedTaxRules`.
  - List every non-additive change under "Contract changes".

**R-04 · P1 · Channel and booking-engine identity, `bookingDate` and `companyId` are declared by the client, so RAT-I07 and eligibility are not enforceable**

- **Where:** `src/services/quote.ts:338` (`req.bookingDate ?? today`), `:354-362`, `:418`; `src/domain/offer.ts:114-119`; `src/domain/promotions.ts:36-42`.
- **Problem:**
  - An `api_client` (OTA) or `guest` (booking engine) actor that omits `channelId` is treated as a direct staff quote. It then sees non-bookable offers and plans restricted to `channels:['direct']`.
  - Any caller may send `bookingDate: '2020-01-01'`. That unlocks early-booking promotions and bypasses `minAdvanceDays`, `maxAdvanceDays` and sell dates. It also back-dates the booking anchor of the payment schedule.
  - `companyId` is accepted from any caller.
  - The test "never channels" (`test/quote.test.ts:132-137`) only proves the case where the channel declares itself.
- **Why it matters:** revenue leakage and contract or parity violations once a channel or booking engine binds this provider.
- **Fix:**
  - Derive the channel from `tx.actor` (`api_client` maps to a channel binding, `guest` to the booking engine).
  - Ignore or refuse `bookingDate` unless the actor is staff holding a permission such as `rates.quote.backdate`.
  - Accept `companyId` from non-staff only from the authenticated principal.
  - Add tests with `api_client` and `guest` actors.

**R-05 · P1 · The terms "hash" is an unkeyed SHA-256, yet it is described as tamper detection; `/v1/quotes/reprice` accepts client-supplied terms and returns a freshly sealed snapshot**

- **Where:** `src/domain/terms-hash.ts:1-17`, `src/routes.ts:507-511`, `src/services/quote.ts:450-457`; README invariants row RAT-I03 ("tampering detected").
- **Problem:** anyone can recompute the hash. A client can fabricate agreed nights (for example USD 1 per night), seal them, and get back a valid-looking `candidateTerms` with `supersedesHash`.
- **Why it matters:** this is a security claim used for money. Any future consumer that trusts `verifyTerms` on client-supplied JSON can be exploited.
- **Fix:**
  - Use an HMAC with a server-side key (kernel secret), or make `/quotes/reprice` take a stay or terms reference loaded server-side.
  - Reword the README: the current hash detects corruption, not forgery.
  - Never accept client-supplied terms for commit.

**R-06 · P1 · A tax-inclusive plan with a zero or low night (free-night promotion, complimentary night, or inclusions consuming the price) aborts the entire quote**

- **Where:** `src/domain/tax-engine.ts:536-543` throws `inclusive_amount_below_fixed_taxes`. Neither `src/domain/offer.ts:341-348` nor the `quote.ts:344-416` loop isolates errors per offer.
- **Problem:** the probe confirms it (row 3). One misbehaving plan or unit type takes down every offer for the property. Inclusive prices with free nights are common for Maldives guesthouses.
- **Fix:**
  - Catch `TaxConfigurationError` per offer and turn it into a non-overridable violation.
  - For inclusive modes, add statutory per-person levies on top when the night price is below them, or never include them. Document which.
  - Add a test: inclusive plan plus stay-4-pay-3.

**R-07 · P1 · Percent inputs have no upper bound, so prices and taxes can go negative**

- **Where:** `src/contracts.ts:584` (promotion `percent`), `:354` (`percent_of_stay`), `:407` (deposit), `:490` (`percent_of_night`); `src/domain/promotions.ts:90-100`.
- **Problem:** a 150 % promotion makes the night −USD 250 (probe 4). That produces negative SC, TGST and Green Tax, and the offer is bookable and visible to channels.
- **Fix:** refine `percent <= 100`. Add an engine guard so no night drops below 0. Add tests.

**R-08 · P1 · The time-of-supply (deposit) mechanism double-charges per-person levies and mis-taxes partial prepayments**

- **Where:** `src/domain/tax-engine.ts:113-126, 337-366`; `src/contracts.ts:288-306`; README contract change 4 ("deposits taxed at payment are expressed by finance passing taxPointDate").
- **Problem:**
  - The prescribed approach splits a night into a prepaid line and a remainder line. That charges Green Tax on each line: 7200 instead of 3600 (probe 1b).
  - The request-level `paymentDate` applies to *every* line. Passing a 30 % deposit's payment date would fix TGST for the whole stay at the old rate.
  - The test `terms-immutability.test.ts:205-213` passes `paymentDate` for the whole stay, so it does not prove partial deposits.
- **Why it matters:** maldives-tax-rules.md §1 calls deposits "critical": TGST at the rate in force at payment, no double taxation, no rate re-application.
- **Fix:**
  - Model the tax-point split *inside* one line (`taxPointSplits: [{amountMinor, taxPointDate}]`) so fixed-quantity rules are computed once.
  - Remove the request-level `paymentDate`, or limit it to "payment covers all lines".
  - Add a test: 30 % deposit before a TGST change, then the balance after it.

**R-09 · P1 · The Green Tax 24-hour / 12-hour check-out rule has no owner or contract; complimentary stays lose Green Tax in the consumer**

- **Where:** `templates/mv-tax-pack.json` (MV-GREEN-12 note), README "Known gaps"; `/home/user/wt/reservations/modules/reservations/src/domain/terms.ts:247-259`.
- **Problem:**
  - The engine charges one guest-day per agreed night. MIRA counts 24-hour blocks from actual check-in, plus the check-out block if 12 hours or more were spent in it. Arrivals after midnight over-collect one day per guest. Day-use stays and early arrival combined with late departure under-collect.
  - The README delegates this to "an extra accommodation line (finance/reservations)". There is no domain-map contract, no OPEN_QUESTION, and that approach cannot correct over-collection.
  - Reservations' `complimentarySnapshot` sets `taxes: []` (MIRA: complimentary stays are still taxable) and spreads `...doc` without resealing, so `verifyTerms` will fail.
- **Fix:**
  - Add a rule kind `per_person_day_block { minHoursLastBlock: 12 }` computed from actual check-in and check-out instants, or a provider `levyDays(checkIn, checkOut, tz)`.
  - Define in the domain map that finance posts the final Green Tax at check-out as an adjustment from the agreed estimate.
  - Raise an open question for the adviser on day-use stays.
  - See R-12 for complimentary stays.

**R-10 · P1 · Missing MUST: the RAT-R25 tax change report is produced without affected stays or deposits, and activation happens before the impact is known**

- **Where:** `src/services/tax-rules.ts:228-321, 331-393`.
- **Problem:** the report lists only succession and definition diffs. Consumers learn of the impact after `rates.taxRule.activated`. The impact text is also wrong for fees (R-01). The README marks this partial, which is honest.
- **Fix:** add a port `affectedAgreements(tx, {ruleCode, from, to})` bound to reservations and finance. Alternatively make activation two-phase: `scheduled`, then a report assembled from consumers, then `effective`. The spec state machine already has a `scheduled` state.

**R-12 · P1 · Rate override, complimentary and house-use pricing is not a rates capability, so consumers improvise**

- **Where:** `src/contracts.ts:963-980` (no override field); the spec RAT-R28 snapshot includes "price override details if any".
- **Problem:** staff cannot override a nightly price with a reason and permission, and cannot book comp or house-use stays that still carry statutory per-guest levies. Reservations therefore mutates rates-owned snapshots itself (R-09).
- **Why it matters:** OPERA (rate override with discount reason, comp and house-use rate codes) and Mews (price override) both have this. It is a P0 parity capability for front desks.
- **Fix:** add `priceOverride?: { nightly | total, reason }` gated by a sensitive permission `rates.price.override`, plus `complimentary | house_use` kinds. Produce sealed terms with `priceSource: 'manual_override'` and keep the levies.

### P2

**R-11 · P2 · Connected-mode deviation is undocumented**

- **Where:** `src/services/quote.ts:305-441`.
- **Problem:** spec §14 says that when `rates` authority is external, "quotes for rooms are disabled; terms snapshots are not created". The README says "Quotes and the tax engine keep working", and `quoteDetailed` never consults authority.
- **Fix:** refuse room quotes with a plain-language reason (`rates_managed_externally`), or record the deviation in the README and spec.

**R-13 · P2 · Sales limits are counted per plan across all unit types**

- **Where:** migration `0001_rates.sql:294-306` (no `unit_type_id`), `quote.ts:581-674`, `restrictions.ts:179-192`.
- **Problem:** `plan_sales` has no `unit_type_id`, so a unit-type-scoped `salesLimit` is consumed by other unit types. A null-plan ("all plans") limit is applied per plan, not across plans.
- **Fix:** add `unit_type_id` to `plan_sales` and count by the scope of the restriction that set the limit.

**R-14 · P2 · Sales-limit violations are `overridable: true`, but `recordPlanSale` always throws `sales_limit_reached`**

- **Where:** `src/domain/restrictions.ts:95`, `src/services/quote.ts:638-649`.
- **Problem:** a staff override is offered and then fails at confirm.
- **Fix:** either mark sales limits non-overridable, or let `recordPlanSale` accept the snapshot's `restrictionOverride`.

**R-15 · P2 · Negative lines mirror fixed levies**

- **Where:** `src/domain/tax-engine.ts:512-570`; the test "mirrors negative (correction) lines" codifies it.
- **Problem:** a price rebate on accommodation produces negative Green Tax (probe 2). Mirroring is right for a *reversal* and wrong for a *price adjustment*.
- **Fix:** add a `ChargeLine.adjustment: 'reversal' | 'price_adjustment'`. Fixed-quantity rules apply only to supplies and reversals.

**R-16 · P2 · Quote estimates under `time_of_supply` use the service date**

- **Where:** `tax-engine.ts:121-124`.
- **Problem:** a stay invoiced at check-out after a rate change is quoted at the old rate (probes 6 and 6b). Displayed totals and the deposit schedule are wrong.
- **Fix:** estimate with the expected invoice date (departure, or a policy), and flag the tax line as `estimated`.

**R-17 · P2 · No USD reporting evidence**

- **Where:** `src/contracts.ts:278-328`, `tax-engine.ts:290-307, 404-407`.
- **Problem:**
  - Tax lines on non-USD charges do not record the FX rate, source or date used, nor the USD liability of USD-fixed levies (probe 8).
  - Nothing validates the ±2 % MMA band.
  - `TaxLine.base` for fixed rules is the line net, which is misleading.
- **Fix:**
  - Add `fx: {from, to, rate, source, asOf}` and `fixedAmount` (original currency) to `TaxLine`.
  - Set `base` to null or the quantity for fixed kinds.
  - Validate `asOf` against the tax point.

**R-18 · P2 · RAT-R22 MUST partly missing: no `per_document` rounding**

- **Problem:** 56 lines drift by 20 minor units against document-level rounding (probe 9). There are also no occupant-attribute exemptions (residents or work-permit holders if applicable; ask the adviser, Q41). Both are documented gaps.
- **Fix:** implement `per_document` (residue allocated to the largest line) and attribute exemptions. Keep `per_line` as the documented default until Q41 is answered.

**R-19 · P2 · The TGST 16 % and GST 8 % versions have an open start (`effectiveFrom: null`)**

- **Where:** `templates/mv-tax-pack.json`.
- **Problem:** supplies before 2023 compute at 16 % (probe 7). To my knowledge TGST was 12 % and GGST 6 % until 2022-12-31. I have not verified this here; confirm it.
- **Why it matters:** this matters for trial comparison of copied historical bookings and for migration.
- **Fix:** set `effectiveFrom: "2023-01-01"` with a citation, or make an open start refuse dates before the earliest verified date.

**R-20 · P2 · Derived-rate semantics have gaps against market practice**

- **Where:** `src/contracts.ts:661-683`, `src/domain/pricing.ts:40-77`, `rate-plans.ts:98-131`.
- **Problem:**
  - (a) A step takes either a percent *or* an amount. OPERA "based-on" rate codes and Mews dependent rates allow both together (e.g. "BAR −10 % + USD 30"). Here that needs an intermediate plan, which uses one of the two allowed levels.
  - (b) Negative results are clamped to 0 silently, giving a USD 0 sellable night (probe 5). There is no floor or ceiling.
  - (c) Re-parenting an active plan under a draft or paused parent is allowed; only retired parents are refused.
  - Amount-per-room-night semantics are coherent (per-person supplements belong in inclusions) and match the spec.
- **Fix:**
  - Allow `{percent?, amountMinor?}` in one step, with percent applied first.
  - Replace the silent clamp with a `derived_price_floor` violation and add optional floor and ceiling values.
  - Refuse non-active parents for non-draft plans.

**R-21 · P2 · `changeRatePlanStatus` does not take the plan-graph advisory lock**

- **Where:** `src/services/rate-plans.ts:315-402`.
- **Problem:** retiring a parent while a child is created under it, or pausing a parent while a child is activated, can race. The result is a derived plan under a retired or non-active parent. The cycle test covers only `updateRatePlan`.
- **Fix:** call `lockPlanGraph` before reading the plans, and add a concurrent test.

**R-22 · P2 · Promotions apply to every plan by default**

- **Where:** `src/domain/promotions.ts:33-47`.
- **Problem:** this includes negotiated and net DMC plans. In market practice, promotions attach to chosen rate plans.
- **Fix:** default to opt-in (require `ratePlanIds`), or exclude plans that carry `companyIds` or `commission.model = 'net'`.

**R-23 · P2 · The net-rate model is indistinguishable from the commissionable model**

- **Where:** `src/domain/offer.ts:465-479`.
- **Problem:** a commission amount is computed even for `model: 'net'`, and no test covers the net model. RAT-R06 is a MUST and critical for the Maldives.
- **Fix:** for net plans, record the hotel's invoiceable net and the agency-collects flag, with no commission amount, and add a test.

**R-24 · P2 · `priceChange` trusts client inputs**

- **Problem:** `changeAt` comes from the client, so a penalty preview can be back-dated (`quote.ts:481`). `stayChangeRequest` silently strips unknown keys (see R-03).
- **Fix:** use `.strict()`, and allow `changeAt` only for staff with a permission.

**R-25 · P2 · README readiness overclaims**

- **Problem:** RAT-R09 and R10 are at R3 although "channels never" depends on the caller (R-04). RAT-R28 is at R3 ("sufficient to post"), contradicted by R-01, R-03 and R-08. RAT-R27 says "Done" while the inclusive and free-night crash exists (R-06).
- **Fix:** downgrade these claims until the fixes land.

**R-26 · P2 · Policy text and plan names are English-only**

- **Problem:** RAT-R28 requires rendered text "in the booking language", and RAT-R01 requires localized names.
- **Fix:** add a `language` parameter and localized templates.

**R-27 · P2 · The cancellation penalty basis defaults to `gross`**

- **Where:** `src/contracts.ts:383-390`, `terms.ts:286-288`.
- **Problem:** `gross` includes Green Tax, a per-guest-day levy that is not owed for nights never stayed. Whether TGST applies to cancellation fees is an open adviser item (maldives-tax-rules.md, open item 2).
- **Fix:** default to net plus commercial fees, excluding statutory per-person levies.

**R-28 · P2 · The configuration vector omits property classification, time zone and check-in time**

- **Where:** `src/services/quote.ts:190-202`.
- **Problem:** changing `mv.registeredRooms` switches Green Tax from USD 12 to USD 6 without changing the vector, so RAT-R30 does not hold.
- **Fix:** include them in the vector.

**R-29 · P2 · Spec proposed contracts are missing and not listed as deviations**

- **Problem:** `occupancyPerUnit` (multi-unit quotes), `bookerRef` and `getTaxRuleVersions` are not implemented. The spec's `instantiatePaymentSchedule(tx, {…})` shape was also changed to the pure `(terms, opts)` without saying so.
- **Fix:** implement them or list them under "Contract changes".

### P3

**R-30 · P3 · "Today" is the UTC date in tax rules**

- **Where:** `src/services/tax-rules.ts:30`.
- **Problem:** the withdraw guard and the "past date" warning use the UTC date. In the Maldives (UTC+5) the first 5 hours of each local day still count as the previous date.

**R-31 · P3 · Concurrent overlapping activations surface a raw database error**

- **Where:** `tax-rules.ts:331-393`.
- **Problem:** the exclusion constraint raises 23P01, which is not mapped to a conflict with recovery text. There is no rule-row lock.

**R-32 · P3 · Inclusive residue is not reflected in tax-line bases**

- **Where:** `tax-engine.ts:544-549`.
- **Problem:** the residue moves to the net, but tax-line `base` values stay on the pre-residue net. A printed invoice can show "TGST on 110.00" next to net + SC = 110.01.

**R-33 · P3 · The agreed-average night uses JS arithmetic**

- **Where:** `terms.ts:166`.
- **Problem:** it uses `Math.round` on a JS division rather than `Decimal`, which is inconsistent with the §5 rule.

**R-34 · P3 · Hygiene**

- Search LIKE patterns are not escaped (`search.ts:36`).
- There is no cross-tenant test for tax rules.
- `/rate-policies/:id/versions` and `/rate-plans/:id/effective-restrictions` have no response schema.
- `POST /tax-rules` sets no ETag.

**R-35 · P3 · Snapshot schema versioning will break stored terms**

- **Problem:** `termsSnapshot.schemaVersion` is `z.literal(1)` and verification hashes the parsed object. A v2 schema with defaults will break verification of stored v1 terms.
- **Fix:** plan a versioned union and verify over the raw stored JSON.

**R-36 · P3 · Snapshot components lack `outletKind`**

- **Problem:** the general-sector exclusion cannot apply at posting to included components fulfilled by a general-sector outlet.

## Focus areas (orchestrator asks)

### (a) Tax and fee engine vs maldives-tax-rules.md

| Rule | Assessment |
|---|---|
| TGST 17 % from 2025-07-01, 16 % before; general GST 8 % only for `general_sector` outlets | correct |
| Service charge inside the GST base (`includeRuleCodes:["MV-SC"]`) | correct |
| GST not charged on Green Tax | correct |
| Green Tax rates by classification, using the *registered* room count | correct |
| Green Tax under-2 exemption | correct (probe 1, S19 test) |
| Green Tax on complimentary nights | kept on exclusive plans only; inclusive plans crash (R-06) |
| Missing classification refuses to guess | correct |
| Time of supply | correct for whole-document invoice or payment. Partial deposits are not workable (R-08). Quote estimate is wrong across rate changes (R-16) |
| 12-hour check-out rule | not implemented and has no owner (R-09) |
| USD reporting | no FX or USD evidence on tax lines (R-17) |
| Inclusive / exclusive rounding | exact and single-rounded. Property tests hold `net + Σ = gross`. Residue goes to the net per spec; tax-line bases are not adjusted (R-32). No `per_document` (R-18) |

### (b) TermsSnapshot

- The snapshot is immutable and round-trips (hash verified after JSON and Zod round trips; E08 test).
- It is **not sufficient** to post every night later:
  - Commercial fees re-price (R-01, P0).
  - Fixed levies double on deposit splits (R-08).
  - It lacks `outletKind` (R-36).
  - The consumer cannot read its shape (R-03).
  - The hash is not tamper-proof (R-05).
  - Override and complimentary pricing is missing (R-12).

### (c) Derived rates

- Amount-per-room-night with percent scaling of every parameter is coherent and matches the spec.
- Per-person supplements belong in inclusions, which is a good design that avoids rate-code proliferation.
- The gap against OPERA and Mews is the combined percent plus amount in one step, and floor or ceiling handling (R-20).
- Cycle prevention: a per-property advisory lock, then a reload under the lock, proven by a genuinely concurrent test (`test/seed-and-concurrency.test.ts:96-116`).
- Hole: status changes skip the lock (R-21).

### (d) Rounding consistency

- Single Decimal rounding is applied consistently in derivations (per step per parameter), promotions, inclusion percentages, commission, penalties, deposits and taxes.
- Inclusion shrink uses largest-remainder allocation. Totals are sums of lines.
- Exceptions: R-32, R-33, R-18, and multi-level derivations round once per level, which is documented.

## Spec coverage (MUSTs)

| Status | Requirements |
|---|---|
| Implemented and tested | R02, R04, R08, R11, R12, R13, R15, R16, R18, R19, R20, R21, R23, R24, R27 (except R-06), R29 |
| Partial | R01 (names not localized) · R03 (amount + percent combo, floor; see R-20) · R05 (named seasons only a seed helper) · R06 (net model, R-23) · R09/R10 (client-declared channel, R-04) · R14 (meal plans are packages with a code, acceptable) · R22 (`per_document` and attribute exemptions, R-18) · R25 (no affected stays, R-10) · R26 (enforcement belongs to finance/platform; rates exposes verification) · R28 (localized text, overrides, sufficiency: R-01, R-12, R-26) · R30 (vector gaps, R-28) |
| Not started (SHOULD/LATER) | R07 (FX in quotes, R1, honest) · R31 · R32 |
| Invariants | I01, I02, I05, I06 and I08 are proven. I03 is overclaimed (R-05). I04 is not proven for fees (R-01). I07 depends on the caller (R-04) |

## Scenario-claim assessment

| Scenario | Assessment |
|---|---|
| S19 (pricing part), `test/scenario-s19-package-bill-pricing.test.ts` | **Holds for rates' part.** Revenue split, allowance entitlements with breakage code, TGST-only transfers, SC + TGST compounding checked on every line, Green Tax 3 guests with the under-2 exemption, exact totals, schedule sums to gross, posting plan from terms. The partial-payment tax point is not shown (R-08) |
| E08, `test/terms-immutability.test.ts` | **Holds for prices, restrictions, policies, promotions, inclusions and TGST**, with a strong historical-vs-future tax demonstration. Does **not** cover commercial fees (R-01). The report lacks affected stays (R-10) |
| S03 (rates part), `test/quote.test.ts:325-369` and `offer.test.ts` | Holds in isolation. The end-to-end path breaks at merge because reservations' `priceChange` call shape differs (R-03) |
| S04 (rates part) | Commissionable model snapshotted. The net model is untested (R-23) |
| S17, `rates-config.test.ts:401-451` and API test | Holds: permission, property scope, and cross-org read/write by id |
| S02 (supporting) | Not implemented. The README states this honestly |

## Parity: capabilities missing

There is no `docs/parity/rates.md`. From competitor product knowledge, these should be matrix rows; each needs a documentation link verified when the matrix is written.

1. Rate or price override at booking with discount reason codes, and complimentary / house-use rate codes (OPERA, Mews). See R-12.
2. Derived or dependent rates with % + amount in one rule, plus rate floor and ceiling (OPERA based-on rates; Mews relative and absolute adjustments). See R-20.
3. Restrictions at rate-group or category level (Mews rate groups; OPERA rate category and class), FPLOS, and max-LOS-through.
4. Day-use and hourly pricing (OPERA day use; Mews time units). Also needed for the Green Tax day-use rule.
5. Voucher and promo codes with usage limits or single use (Mews vouchers, booking engines).
6. Dynamic pricing rules and occupancy-based rate strategies (OPERA rate strategies, Mews and Cloudbeds pricing automation). RAT-R31, not started.
7. Chain-level rate templates and copying rate plans across properties, for multi-property groups.
8. Alternate dates or lengths of stay suggested when restricted (rate query and booking-engine "nearest available").
9. Localized rate names, descriptions and policy text.
10. Upsell and upgrade offers attached to rates (Mews upsells, OPERA upsell).
11. Inventory-limited add-ons and packages (e.g. seaplane seats, spa slots), sold separately.
12. Length-of-stay-based prices (distinct from LOS promotions), common in channel managers.
13. Contracted DMC net rates with allotments, release and stop-sale. Owned by `contracting` (wave 2), but the rates interface should be specified.

## Cross-module notes for the orchestrator

- **Reservations ↔ rates contract (R-03).**
  - Reconcile before merging either branch. Rates owns `TermsSnapshot`, `Offer`, `StayChangeRequest` and `RepricingResult`.
  - Reservations should stop re-implementing penalty computation (`reservations/src/domain/terms.ts` `penaltyAmount`, `removalPenalty`) on its own policy shape. It should use rates' `priceChange.penalties`, or a pure `penaltyFor(terms, removedNights, at)` exported by rates.
  - Reservations should stop building `complimentarySnapshot` itself (it drops Green Tax and breaks the hash). See R-09 and R-12.
  - Reservations must call `recordPlanSale` and `releasePlanSale` in confirm and cancel. Its port does not declare them today, so sales limits would never be enforced.
- **Finance ↔ rates contract.**
  - Finance's `TaxPort` uses `taxGroup` / `priceMode` / `stayContext{stayId,nights}` and expects `TaxComputation{lines:{lineId,net,taxes}}` with different `TaxLine` field names. Bind it to `computeTaxesDetailed` through an adapter, or align the names.
  - Finance needs `getRulePackStatus`, which rates must add.
  - Finance must carry `taxPointDate` per amount for deposits (R-08) and post the final Green Tax at check-out (R-09).
- **Shared-code candidates.**
  - Wall-clock to instant conversion in a time zone through `Intl.formatToParts` is implemented three times: `rates/src/domain/policies.ts:18-56`, `reservations/src/domain/time.ts`, `operations/src/service/internal.ts`. Move it into `@portico/kernel` as `zonedInstant` / `formatLocal`.
  - `FOUNDATION_REQUESTS.md` asks platform for a permission-free `getPropertyFacts`. Endorsed: the current binding widens to `systemAuthorizer` inside a composition-root closure (`apps/api/src/composition.ts`).
- **Pending bindings.** `listUnitTypes` (inventory) is unbound, so unit-type ids are unvalidated on price writes and the demo seed cannot run. Bind it when inventory merges. Register `createRatesDemoSeed` after the inventory step.
- **Domain-map updates.** Copy rates' providers (`quoteDetailed`, `computeTaxesDetailed`, `recordPlanSale`/`releasePlanSale`, `postingPlan`, `instantiatePaymentSchedule`, `verifyTerms`) and events (`rates.ratePlan.changed`/`statusChanged`, `rates.taxRule.activated`) into `docs/architecture/domain-map.md`. Mark `Offer.taxesAndFees` as a breaking change.

## Top 5 (one line each)

1. **R-01 (P0):** service charge and other hotel fees are recomputed at posting from current configuration, so agreed prices change after booking (131100 to 133440 in the probe), while the activation report says they do not.
2. **R-03 (P1):** the rates provider's `TermsSnapshot`, `priceChange` and tax-line shapes do not match what the reservations and finance worktrees consume; integration breaks at merge.
3. **R-04 (P1):** channel identity, `bookingDate` and `companyId` are client-declared, so OTAs and the booking engine can back-date for early-bird prices and see direct-only plans; RAT-I07 is unenforceable.
4. **R-08 / R-09 (P1):** the deposit time-of-supply approach doubles Green Tax on split lines, and the Green Tax 12-hour block rule has no owner (complimentary stays lose Green Tax in reservations).
5. **R-06 / R-07 (P1):** an inclusive plan with a free night aborts the whole quote, and unbounded percentages (a 150 % promotion) produce negative, bookable prices and taxes.
