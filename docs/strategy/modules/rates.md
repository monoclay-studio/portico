# rates — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/rates.md` · Parity
`docs/parity/rates.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated
with hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-rates § Capabilities): base and derived plans (depth ≤ base+2, acyclic, explicit inheritance
  with source), prices per type × night × occupancy, bulk edit with preview, negotiated and net plans, restrictions
  incl. scoped sales limits with explained violations, promotions, inclusions/meal plans/allowances/packages,
  cancellation/guarantee/deposit policies (versioned), **the single tax & fee engine** (rules as data with citations,
  compounding, caps, exemptions, inclusive decomposition exact, tax point), deterministic quotes, sealed
  self-contained `TermsSnapshot`, `priceChange` with penalties. Rates **owns the pricing contract** (canonical shapes).
- **Parity: the most advanced module** — 61% tested/equivalent, P0 open 13, P1 missing 18 (report). Open P0:
  localized names/policy text (PAR-RAT-001, 062), per-document rounding (069, Q41), tax-change impact on affected stays
  (070, needs `affectedAgreements`), fiscal block on unverified packs (071), multi-unit quotes (075); EC-RAT-002, 007,
  009, 026, 027, 034, 035.
- **Review:** REV-rates P0 (hotel fees re-priced after booking) fixed; contract alignment done; consumers still adapting
  (PF: `TaxLine.basis`, renames; channel-price terms not yet constructed).
- **Not built:** pricing assistance (RAT-R31), external RMS (RAT-R32), connected-mode mirroring/forwarding, FX in
  second-currency quotes, occupant-attribute exemptions (residents), quote log, scheduled tax activation with consumer
  sign-off, seal-key rotation (README § Known gaps).
- **Maldives:** TGST 17%, Green Tax by classification, 10% service charge as commercial fee — MIRA-sourced, **not
  adviser-confirmed** (Q20/Q41/Q42).
- **UX1:** no rate, quote or rate-plan screen exists in the UI; tax lines in the preview are sample text.

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Rate model depth | OPERA | Rate codes with packages, generates, allowances; 26.4 price by age category for packages | R01 §3.8; DD02a §1.2 |
| Policy schedules | OPERA 25.4 | Tiered dated cancel/deposit schedules, highest penalty prevails | DD02a §1.2; DG #14 |
| Yield to channels | OPERA 25.4 | FPLOS generated from hurdle rates | DD02a §1.2 |
| Derived-rate hygiene | Apaleo | Derived-rate depth limit (but restrictions not inherited — surprising) | R02 §3.3.3, §3.7 |
| Policies as API objects | Mews (2026) | Versioned cancellation-policy management, payment plans | DD02b §1.3 |
| Automated pricing for small hotels | RoomRaccoon; Mews Atomize "Autopilot" | Auto-pricing built in (RoomRaccoon gates it to the top tier) | R03 §5.2; DD02c §1 |
| AI pricing at zero cost | Lighthouse Revenue Agent (Q1 2026), Oracle assistant | Included, no extra cost | DD02c §1; DG #33 |
| Overbooking science | Academic | Optimal level depends on walk cost, unsold cost, cancellation distribution; up to 9% gains | DD03 §5.1 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | Close the P0 rows that rates can close alone: localized names and generated policy text, multi-unit quotes, concurrent price-cell edits (409 with changed cells), children without ages on channel bookings | Gate cannot pass | PAR-RAT-001, 062, 075; EC-RAT-009, 035 |
| 2 | Tax-change impact across stays + scheduled activation with consumer sign-off; per-document rounding | TGST changed 16→17% in 2025; e-invoicing coming | PAR-RAT-069, 070, 071; EC-RAT-002, 034; DG #45 |
| 3 | Revenue-manager power tools: categories, rate approvals, rate protection central vs property, copy plan, restriction sources and precedence, restriction automation by occupancy | OPERA/central parity | PAR-RAT-002, 019, 020, 023, 040, 041 |
| 4 | Pricing assistant with explanations (RAT-R31) in every edition; accept RMS prices and FPLOS (RAT-R32) | Free AI pricing is the new market floor | DG #15, #33; DD02c §1 |
| 5 | Seasonal policies on one plan; coupons; structured discounts; lowest-price calendar | Booking engine and direct sales | PAR-RAT-025, 044, 061, 074 |
| 6 | Age events (child turns 12 mid-stay), LOS tier crossings on extension, CTA after booking | Correct pricing on changes | EC-RAT-008, 020, 030 |
| 7 | Resident exemptions, FX in second-currency quotes | Maldives local market; USD/MVR | RAT-R07, RAT-R22 gap |
| 8 | Package/meal forecast (breakfasts, dinners, transfers per day) | Kitchen and transfer planning | PAR-RAT-054 |
| 9 | Default rate structure per property profile (BAR + non-refundable + …) | Guesthouse in minutes | PAR-RAT-030 |

## 4. The 10x outcome (TARGETS)

**Picture:** a guesthouse owner gets a sensible rate structure on day one and a pricing assistant that says *why* it
suggests $142 tonight (pickup, comp set, events, data age, confidence) and never changes a price without approval;
a resort revenue manager edits a season across 40 plans with one preview, sees which rule wins in every tier, and
knows exactly which in-house stays a tax change affects before it activates.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | 61% / 13 open | — | 100% |
| Powerful | Tax computation differences vs adviser-confirmed worked examples (Maldives) | not confirmed | OPERA country packs (DD02a §1.1) | 0 differences on the adviser's example set (Q20) |
| Seamless | Change a season's prices across N plans with preview | API only | baseline to measure | ≤ 5 interactions regardless of N; preview shows every derived plan |
| Seamless | "Which rule wins?" explanation for a quote | violations explained | OPERA "highest penalty prevails" without explanation (DD02a §1.2) | every price, restriction and penalty has a one-line reason |
| Friendly | Pricing suggestions shown with assumptions, freshness, expected effect, uncertainty (brief §5) | none | Lighthouse/Oracle free agents (DG #15, #33) — explanation depth unverified | 100% of suggestions; 0 auto-applied without an approved automation limit |
| Friendly | Guesthouse rate setup from sign-up to first sellable plan | — | RoomRaccoon 28-day onboarding to first channel live (R03 §5.2) | ≤ 15 min with the profile default structure |
| Well-rounded | Edge cases handled | 59% | — | 100% P0, ≥ 90% P1 |
| Well-rounded | Country packs | Maldives (unconfirmed) | OPERA treadmill | Maldives confirmed + one second pack (e.g. Sri Lanka or Mauritius) as proof of the model |

## 5. Next 3 increments

### Increment 1 — Close rates-owned P0s
- Localized plan names and generated policy text (en + one RTL locale stub test); multi-unit quotes with different
  occupancies; concurrent price-cell edits → 409 listing changed cells; channel bookings without child ages → priced
  by policy with an `ages_missing` issue; channel-price `TermsSnapshot` (`priceSource: 'channel'`) for reservations.
- **Acceptance:** PAR-RAT-001, 062, 075 and EC-RAT-009, 035 `tested`; reservations' channel ingestion binds the real
  channel-price terms (PF item closed).

### Increment 2 — Tax change as a controlled release
- Two-phase tax activation: draft rule version → impact report (affected agreements via `affectedAgreements`, bound
  at the integration step) → consumer sign-off (finance) → scheduled activation; per-document rounding option (Q41
  default kept); resident/occupant-attribute exemptions as data; `getRulePackStatus` enforced by finance for live
  documents.
- **Acceptance:** EC-RAT-002 (16→17% between booking and stay), EC-RAT-007, EC-RAT-034 and PAR-RAT-069/070/071
  tested end to end with finance; impact report lists stays by property with old/new tax.

### Increment 3 — Explainable pricing assistant v1 (rule-based, every edition)
- Suggestions from Portico's own data (on-the-books pace by stay date, pickup, cancellations, lead time, day of week,
  events calendar entered by staff) with **assumptions, data freshness, expected effect and uncertainty** shown;
  guardrails (floor/ceiling, max daily change), approval or bounded automation with a change history; accept external
  RMS prices/FPLOS through `integration` as `external` provenance (RAT-R32). No machine-learned demand model until
  counsel reviews (Q150; DD04 P2).
- **Acceptance:** every suggestion carries the four explanation parts (brief §5); backtest on the public 119,390-booking
  dataset (DD03 §5.2) recorded as evidence; automation never exceeds its limits (tested).

## 6. Cross-module dependencies and contract changes

- **reservations:** consume channel-price terms and `instantiatePaymentSchedule`. **finance:** tax activation sign-off,
  `getRulePackStatus` enforcement, per-document rounding at invoice level. **distribution:** FPLOS/restriction
  publication with source precedence (PAR-RAT-040); lowest-price calendar for the booking engine. **analytics:**
  pace/pickup facts for the assistant. **groups/contracting:** contract rate tables and allotment pricing reuse rate
  structures (CTR-R03). **platform:** effective-dated property classification (EC-RAT-007).
- **New contract:** `planTaxActivation`, `approveTaxActivation`; `suggestPrices(range)` returning explanation
  objects; restriction `source` field.

## 7. Power check — never lose or hide

Agreed terms are sealed and never re-priced; tax rules stay data with citation and verification date; one tax engine
for every charge; derived-plan inheritance stays explicit; overrides need permission and leave history; channels
never override restrictions; no pricing automation acts outside its approved limits; unverified rule packs never
produce live fiscal documents.
