# Parity matrix and edge cases — rates

Module: `rates` (`modules/rates`) · spec `docs/specs/rates.md` · last updated 2026-11-07 by the rates engineer.

**Evidence honesty.** Competitor rows below come from the steward review (`docs/orchestration/reviews/review-rates.md`
§ "Parity: capabilities missing") and general product knowledge; the official documentation links have **not**
been verified in this pass, so the evidence column says `assumption` until the parity research
(`docs/parity/README.md`, parity-researcher brief) adds dated links. Tests are in `modules/rates` unless noted.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RAT-001 | Rate plans priced per unit type × night × occupancy (base occupancy, single, extra adult, child age bands, occupancy overrides) | assumption — OPERA rate codes, Mews rates | P0 | tested | RAT-R01, R02 | test/quote.test.ts; src/domain/pricing.test.ts |
| PAR-RAT-002 | Derived rates (± percent / ± amount, multi-level, rounding, per-unit-type differential), computed not editable | assumption — OPERA based-on rates, Mews dependent rates, Apaleo derived rates | P0 | tested | RAT-R03 | test/rates-config.test.ts; src/domain/pricing.test.ts |
| PAR-RAT-003 | Derived rate with percent AND amount in one rule, floor and ceiling | assumption — OPERA based-on rates, Mews relative + absolute adjustments | P0 | tested | RAT-R03 | test/provider-contract.test.ts (robust pricing) |
| PAR-RAT-004 | Explicit restriction / policy inheritance per kind, visible source ("inherited from BAR") | assumption — Apaleo derived rates (inheritance surprises) | P0 | tested | RAT-R04 | test/rates-config.test.ts (effective restrictions) |
| PAR-RAT-005 | Bulk price edit by date ranges × weekdays × unit types, absolute or relative, preview with affected derived plans | assumption — OPERA rate grid, Mews rate grid | P0 | tested | RAT-R05 | test/rates-config.test.ts |
| PAR-RAT-006 | Price change history (who, when, why) | assumption — OPERA rate change log | P0 | tested | RAT-R05 | test/rates-config.test.ts |
| PAR-RAT-007 | Restrictions: closed, CTA, CTD, min LOS (arrival), min LOS through, max LOS, min/max advance | assumption — OPERA restrictions, channel managers | P0 | tested | RAT-R08 | src/domain/rules.test.ts; test/quote.test.ts |
| PAR-RAT-008 | Sales limits per plan, scoped to unit type / all plans, never oversold under concurrency | assumption — OPERA rate code sell limits | P0 | tested | RAT-R08 | test/provider-contract.test.ts; test/seed-and-concurrency.test.ts |
| PAR-RAT-009 | Explained restriction violations; authorized staff override with reason; channels never | assumption — OPERA restriction override | P0 | tested | RAT-R09 | test/quote.test.ts; test/provider-contract.test.ts |
| PAR-RAT-010 | Channel eligibility derived from the authenticated seller (OTA, booking engine), never self-declared | assumption — channel managers, OPERA rate availability by channel | P0 | tested | RAT-R10 | test/provider-contract.test.ts |
| PAR-RAT-011 | Negotiated company / agency rates | assumption — OPERA negotiated rates, Mews company rates | P0 | tested | RAT-R06 | test/quote.test.ts (eligibility) |
| PAR-RAT-012 | Net (contracted) vs commissionable rates, terms snapshotted | assumption — OPERA commission handling, DMC contracting practice | P0 | tested | RAT-R06 | test/provider-contract.test.ts (net rates); test/quote.test.ts |
| PAR-RAT-013 | Promotions: % / amount / stay-N-pay-M, early booking, last minute, LOS, blackouts, promo codes, combinability; never auto-applied to contracted plans | assumption — booking engines, OPERA promotions | P0 | tested | RAT-R11, R12 | src/domain/rules.test.ts; test/quote.test.ts |
| PAR-RAT-014 | Meal plans and packages with revenue split (inclusions per person / per stay, rhythms) | assumption — OPERA packages (posting rhythm, calculation rule) | P0 | tested | RAT-R13, R14, R16 | test/scenario-s19-package-bill-pricing.test.ts |
| PAR-RAT-015 | Allowances (monetary / quantity, per night / stay, eligible outlets, forfeit → breakage) | assumption — OPERA package allowances, Agilysys S.P.E.N.D. | P0 | tested | RAT-R15 | test/scenario-s19-package-bill-pricing.test.ts |
| PAR-RAT-016 | Packages added to a stay on top of the plan | assumption — OPERA packages at reservation level | P0 | tested | RAT-R16 | test/quote.test.ts (add-on packages) |
| PAR-RAT-017 | Cancellation policies with deadlines in property time zone; non-refundable; no-show; early departure; text from structure | assumption — OPERA cancellation rules, Mews cancellation policies | P0 | tested | RAT-R18 | src/domain/rules.test.ts; src/domain/offer.test.ts |
| PAR-RAT-018 | Deposit / payment schedules (percent, nights, remaining; due anchors) | assumption — OPERA deposit rules | P0 | tested | RAT-R20 | test/quote.test.ts; src/domain/rules.test.ts |
| PAR-RAT-019 | Single tax & fee engine: percentage, per person-night, per unit-night, per stay, banded, caps, exemptions, compounding, inclusive / exclusive | assumption — OPERA generates (inheritable, chainable taxes) | P0 | tested | RAT-R22..R24 | src/domain/tax-engine*.test.ts |
| PAR-RAT-020 | Effective-dated, cited, versioned tax rules; historical recompute with recorded versions | assumption — OPERA tax history, Mews tax environments | P0 | tested | RAT-R22, R23 | test/tax-rules.test.ts; test/terms-immutability.test.ts |
| PAR-RAT-021 | Agreed price snapshot unaffected by later rate, policy, promotion, inclusion, fee and tax changes | assumption — OPERA fixed rate / rate on reservation | P0 | tested | RAT-R28, I03, I04 | test/terms-immutability.test.ts |
| PAR-RAT-022 | Change repricing: extension, shortening, occupancy, room type, rate plan, with penalties | assumption — OPERA rate change on stay, Mews price recalculation | P0 | tested | RAT-R29 | test/quote.test.ts; test/provider-contract.test.ts; src/domain/offer.test.ts |
| PAR-RAT-023 | Price override with reason; complimentary and house-use pricing keeping statutory per-guest levies | assumption — OPERA rate override / comp / house use codes, Mews price override | P0 | tested | RAT-R28 | test/provider-contract.test.ts; src/domain/offer.test.ts |
| PAR-RAT-024 | Quote with nightly breakdown, taxes per line, totals, policies, violations, sealed agreement | assumption — OPERA rate query, Mews booking quote | P0 | tested | RAT-R27, R28 | test/quote.test.ts; apps/api/test/rates.test.ts |
| PAR-RAT-025 | Maldives TGST (time of supply), service charge in GST base, Green Tax per guest-day with under-2 exemption | assumption — local PMS practice; rules from MIRA (docs/readiness/maldives-tax-rules.md) | P0 | tested | RAT-R22, §11 | test/tax-rules.test.ts; test/terms-immutability.test.ts |
| PAR-RAT-026 | Deposit taxed at payment (time of supply) for the paid part only | assumption — MIRA time-of-supply rule | P0 | tested | RAT-R22 | src/domain/tax-engine.test.ts; test/terms-immutability.test.ts |
| PAR-RAT-030 | Restrictions at rate-group / category level; FPLOS; max LOS through | assumption — Mews rate groups, OPERA rate category / class | P1 | deferred | wave 2 (distribution needs FPLOS) | — |
| PAR-RAT-031 | Day-use and hourly pricing | assumption — OPERA day use, Mews time units | P1 | deferred | wave 2; Green Tax day-use treatment is an adviser question | — |
| PAR-RAT-032 | Vouchers and promo codes with usage limits / single use | assumption — Mews vouchers, booking engines | P1 | deferred | wave 2 (booking engine) | — |
| PAR-RAT-033 | Pricing rules / recommendations (occupancy, pickup) with limits and history | assumption — OPERA rate strategies, Mews / Cloudbeds automation | P1 | specified | RAT-R31 | — |
| PAR-RAT-034 | Chain-level rate templates; copy rate plans across properties | assumption — group PMS practice | P1 | deferred | groups / portfolio wave | — |
| PAR-RAT-035 | Alternate dates / nearest available when restricted | assumption — booking engines, OPERA rate query | P1 | deferred | booking engine (distribution wave 2) | — |
| PAR-RAT-036 | Localized rate names, descriptions and policy text in the booking language | assumption — all major PMS | P1 | specified | RAT-R01, R28 | — |
| PAR-RAT-037 | Upsell and upgrade offers attached to rates | assumption — Mews upsells, OPERA upsell | P1 | deferred | guest journey wave | — |
| PAR-RAT-038 | Inventory-limited add-ons (seaplane seats, spa slots) | assumption — resort systems | P1 | deferred | resort module (wave 3) | — |
| PAR-RAT-039 | Length-of-stay-based prices (distinct from LOS promotions) | assumption — channel managers | P1 | deferred | wave 2 with FPLOS | — |
| PAR-RAT-040 | Contracted DMC net rates with allotments, release and stop-sale | assumption — Maldives DMC contracting practice | P1 | deferred | contracting module (wave 2); rates provides the net model (PAR-RAT-012) | — |
| PAR-RAT-041 | Rate plans in a second currency with FX for fixed levies | assumption — resorts with EUR contracts | P1 | specified | RAT-R07 | — |
| PAR-RAT-042 | Per-document tax rounding | assumption — fiscal invoice practice | P1 | specified | RAT-R22 (per_line default until Q41) | — |
| PAR-RAT-043 | Tax change report listing affected stays and deposits before activation | assumption — enterprise PMS practice | P1 | building | RAT-R25 (port `affectedAgreements`, consumer binding pending) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-RAT-001 | Hotel raises the service charge after a stay was booked | Agreed nights post at the agreed service-charge version; charges outside the agreement use the new one; activation report says so | P0 | tested | test/terms-immutability.test.ts |
| EC-RAT-002 | TGST changes in the middle of an agreed stay | Agreed prices unchanged; supplies on/after the change use the new version by tax point; historical recompute keeps recorded versions | P0 | tested | test/terms-immutability.test.ts |
| EC-RAT-003 | 30% deposit paid before a TGST change, balance after | Deposit part keeps the old rate, remainder the new; Green Tax charged once | P0 | tested | test/terms-immutability.test.ts; src/domain/tax-engine.test.ts |
| EC-RAT-004 | Tax-inclusive plan with a free promotional night | Quote succeeds; free night carries Green Tax on top; other offers unaffected | P0 | tested | test/provider-contract.test.ts |
| EC-RAT-005 | A tax configuration problem on one plan (missing classification, FX, band gap) | Only that offer is unbookable with the explanation; the rest of the quote works | P0 | tested | test/provider-contract.test.ts (isolation); src/domain/tax-engine.test.ts |
| EC-RAT-006 | Promotion of 150% or a derivation making the price negative | Input refused (bounded percent) / night unsellable with `derived_price_below_zero` | P0 | tested | test/provider-contract.test.ts |
| EC-RAT-007 | Two agents book the last unit of a sales limit at the same time | Exactly one succeeds; the other gets `sales_limit_reached` | P0 | tested | test/seed-and-concurrency.test.ts |
| EC-RAT-008 | Two managers re-parent plans at the same time creating a cycle | One succeeds; the other is refused with an explanation | P0 | tested | test/seed-and-concurrency.test.ts |
| EC-RAT-009 | An OTA omits or fakes its channel, back-dates the booking date or names a company | Channel derived from the principal; back-dating and companies refused; only bookable offers shown | P0 | tested | test/provider-contract.test.ts |
| EC-RAT-010 | Client sends forged agreed terms (e.g. USD 1 per night) to reprice, override or penalty endpoints | Refused: the HMAC seal does not verify | P0 | tested | test/provider-contract.test.ts; apps/api/test/rates.test.ts |
| EC-RAT-011 | Property classification lacks a key a tax rule needs | Computation refuses to guess and names the missing key | P0 | tested | test/tax-rules.test.ts |
| EC-RAT-012 | Family with a child under 2 | Green Tax exempts the infant | P0 | tested | test/tax-rules.test.ts; test/scenario-s19-package-bill-pricing.test.ts |
| EC-RAT-013 | Complimentary or house-use stay | Price 0, value-based taxes 0, Green Tax still due, sealed with the original recorded | P0 | tested | test/provider-contract.test.ts; src/domain/offer.test.ts |
| EC-RAT-014 | Late check-out spends ≥ 12 h in the final 24-hour block | `levyTrueUp` adds one Green Tax day per guest | P0 | tested | src/domain/tax-engine.test.ts; src/domain/offer.test.ts |
| EC-RAT-015 | Guest arrives after midnight and leaves at noon | `levyTrueUp` reverses the over-collected Green Tax day | P0 | tested | src/domain/offer.test.ts |
| EC-RAT-016 | Retiring a plan that still has derived plans | Refused with the list of derived plans | P0 | tested | test/rates-config.test.ts |
| EC-RAT-017 | Rates managed by an external system of record | Configuration writes refused with the system's name; room quotes refused; tax engine still works | P0 | tested | test/rates-config.test.ts; test/provider-contract.test.ts |
| EC-RAT-018 | Another organization reads a rate plan or tax rule by id | Not found; nothing returned or changed | P0 | tested | test/rates-config.test.ts; test/provider-contract.test.ts |
| EC-RAT-019 | Fixed USD levy on an MVR charge with an exchange rate for another date | Refused (`fx_rate_date_mismatch`); used rate recorded on the tax line otherwise | P0 | tested | src/domain/tax-engine.test.ts |
| EC-RAT-020 | Price rebate posted on an accommodation charge | Value-based taxes follow the rebate; per-guest levies untouched | P0 | tested | src/domain/tax-engine.test.ts |
| EC-RAT-021 | Cancellation inside a penalty tier | Penalty on night price + hotel fees, never statutory per-guest levies | P0 | tested | src/domain/offer.test.ts |
| EC-RAT-030 | Day-use room (< 24 h) and Green Tax | Counted only when the block reaches 12 h — pending adviser confirmation | P1 | specified | — |
| EC-RAT-031 | Forfeited deposit / cancellation fee and TGST | Treatment pending adviser (maldives-tax-rules.md open item 2) | P1 | specified | — |
| EC-RAT-032 | Two admins activate overlapping versions of one rule at once | Rule row locked; overlap mapped to a conflict with recovery text | P1 | built | — |
