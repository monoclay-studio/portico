# contracting — 10x brief (tour-operator, DMC and wholesale contracts)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 2; resort-pilot critical if tour operators dominate,
Q121) · Spec `docs/specs/contracting.md` (CTR-R01–R28) · Parity: **none** · Related: `modules/groups.md`
(allotments), `modules/finance.md` (statements) · Source key: `docs/strategy/gap-plan.md` §0. **All targets are
TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **No `contracting` module exists.** Building blocks: rates' negotiated and net plans, restrictions, promotions,
  packages and meal plans, sealed terms (README-rates); guests' companies/agencies with IATA and commission terms
  (README-guests R07/R08); finance's receivables, aging and invoices (README-finance R27–R29); groups' allotment rows
  (`docs/parity/groups.md` PAR-GRP-048–052, specified).
- **Evidence gap:** our research has **no competitor evidence for contract loading** — the spec's premise that
  tour operators deliver most room nights for Maldivian resorts is marked as an assumption to confirm in discovery
  (`docs/specs/contracting.md` §1; Q64, Q81, Q121). No parity file exists.

## 2. Best on the market today (what we know)

| Area | Who | How | Source |
|---|---|---|---|
| Negotiated rates and tiered policies | OPERA | Negotiated rate codes, tiered cancel/deposit schedules (25.4) | DG §2 contracting row; DD02a §1.2 |
| Allotments and release | OPERA blocks/allotments; Cloudbeds allotment blocks | Release days, cut-off | R01 §3.5; `docs/parity/groups.md` baseline |
| Wholesale distribution | Hotelbeds via channel managers | Push ARI to bedbanks, support-enabled | R04 §A6 |
| Contract compilation tools for island resorts | **unknown** — not researched | — | gap: research needed (Q64) |

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Contract aggregate with seasons, markets, rate tables (net/commissionable per meal plan), supplements/reductions, child policies, terms | CTR-R01–R06 |
| 2 | Offer types (early bird, free nights, honeymoon, long stay) with combinability, application order and proof requirements | CTR-R07–R09 |
| 3 | Loading QA and four-eyes approval; addenda | CTR-R10, R12, R13 |
| 4 | Allotments per season × unit type with release visibility; stop-sale/open-sale notices; bookings after a stop-sale | CTR-R15–R18 (shared with groups) |
| 5 | Booking intake (vouchers, emails, channel) with an automatic **contract check** of the price | CTR-R19, R20; PAR-DST-034 |
| 6 | Amendments, name changes, voucher verification at arrival | CTR-R21, R22 |
| 7 | Settlement models, statements, remittance reconciliation, commission processing | CTR-R23–R26 |
| 8 | Production reports and rate sheets | CTR-R27, R28 |

## 4. The 10x outcome (TARGETS)

**Picture:** the contracts manager loads a tour operator's seasonal contract once (with a second person approving), and
from then on every voucher booking is priced and checked against it automatically — wrong prices, expired offers and
bookings after a stop-sale arrive as owned exceptions, not month-end surprises — and the operator's statement reconciles
with its remittance.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Contract features expressible without workarounds (offer stacking, child policies, supplements) | baseline to measure in discovery | 100% of a real pilot contract set (Q121) |
| Seamless | Time to load a 4-season, 3-market contract with 5 offers | baseline to measure | ≤ 45 min incl. QA preview |
| Seamless | Voucher bookings priced and checked without manual calculation | — | ≥ 95%; the rest as exceptions with reasons |
| Friendly | Booking price differences discovered at statement time | — | 0 (caught at intake) |
| Well-rounded | Settlement models (net remittance, commission invoice, prepaid) reconciled | — | all three with statements |

## 5. Next 3 increments

### Increment 0 — Evidence first
Write `docs/parity/contracting.md` from discovery and any official documentation available; until then, every row is
`assumption`. Confirm the model with one real (anonymized) contract under Q121.

### Increment 1 — Contracts compile to rates
- Contract aggregate (seasons, markets, tables, supplements, child policies, terms) compiled into rates structures
  (negotiated plans scoped to the agency and market) with a loading-QA preview and four-eyes approval; addenda as new
  versions; snapshots on bookings.
- **Acceptance:** CTR-R01–R06, R10–R13 tested; a compiled contract quotes identically through rates for a matrix of
  dates × markets × occupancies; approvals compare people, not principals.

### Increment 2 — Offers and the contract check at intake
- Offer types with combinability rules and application order explained per booking; proof requirements (honeymoon
  certificate) as check-in tasks; intake from voucher entry and channel/email drafts; contract check producing
  discrepancy exceptions; amendments and name changes.
- **Acceptance:** CTR-R07–R09, R19–R22 tested; an over-priced voucher raises an exception with the computed price and the
  rule that differs.

### Increment 3 — Allotments, stop-sales and settlement
- Allotments with release (via groups' pools), stop-sale/open-sale notices with acknowledgement log, bookings after a
  stop-sale, settlement models, statements and remittance reconciliation with finance; commission processing.
- **Acceptance:** CTR-R15–R18, R23–R26 tested; EC-GRP-024, 026 tested jointly with groups.

## 6. Cross-module dependencies and contract changes

**rates:** compile target (negotiated plans, offers, policies), explanation of applied offers. **groups:** allotment
pools. **guests:** company sub-types (tour operator, DMC, wholesaler — PAR-GUE-030). **reservations:** voucher intake,
terms snapshots. **finance:** statements, net invoicing, commissions. **distribution:** wholesale channels, email intake.
**comms:** stop-sale notices. **analytics:** production per operator.

## 7. Power check — never lose or hide

Agreed contract terms are snapshotted on each booking; a contract change never re-prices existing bookings silently;
offer application is always explained; approvals are four-eyes; stop-sale effects are timestamped and auditable.
