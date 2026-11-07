# payments — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/payments.md` · Parity
`docs/parity/payments.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated
with hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-payments § What is built): provider-agnostic port; DB-backed **simulator** with fault
  scenarios; Stripe Connect adapter (direct charges) tested only against recorded fixtures — **never called Stripe,
  R1 as an integration**; **Route D** (own terminal, cash, bank transfer recorded then verified by statement import);
  environment safety on every call; provider-operation journal (intent before call, one sender); tokens only (PAN/CVC
  refused at three layers); authorizations with partial/multiple captures and expiry warnings; `pending_verification`
  with resolver backoff and an hourly event backstop; refunds bounded after corrections; disputes; payment links; VCC
  logic; payouts with breakdown; circuit breaker with staff fallbacks; universal record contract. 113 module tests +
  7 API tests.
- **Review:** 3 P0 (one on the Route D pilot path) + 11 P1 fixed (REV-payments; README § Steward review fixes).
- **Parity:** 50% tested/equivalent, **28 P0 open**: hosted card entry (PAR-PAY-021), PCI proxy for OTA cards (027),
  scheme-specific authorization expiry/renewal (033), daily balance-transaction reconciliation (055), payments review
  list (057), payment policies and **collection plans with one executor per item** (072–074), fees never netted by
  Monoclay (095), forwarding to an external PMS (098), local Maldivian acquirer (006, deferred); EC-PAY-007, 008, 011, 013,
  015, 021, 027, 030, 037.
- **Not built:** collection plans/automation policies (PAY-R20–R22), 3DS `requires_action`, refund approval threshold,
  evidence-pack export, link delivery via comms, local gateways, Adyen, integrated terminals, connected-mode forwarding
  (README § Spec MUSTs not built). Finance binding of `LedgerPort` on `feat/integration-step`.
- **Unowned:** cancellation deposit treatment and no-show MIT charging (PF "unowned").
- **UX1:** no "Take payment" or "Record cash/bank transfer" anywhere; the pending-verification blocker has no "Check
  status" button; the "Paid" chip contradicts a balance due — but the tester rated "Pending verification — do not charge
  again" and "Authorized (not paid)" as better than systems they know (UX1 persona 1; top-10 #3).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Embedded payments + automation | Mews | Rate-group payment automation, VCC handling, payment requests — but double-charge risk between links and automation, silent failures | R02 §2.3, §2.5, §2.8 #4 |
| Payout reconciliation | Mews (2026) | Payouts, payout transactions, balance transactions API | DD02b §1.3; DG #18 |
| Pay-by-link status, VCC auto-transfer, token proxy | OPERA 24.2–26.4 | Status-check intervals, batch deposits, OPI Cloud Token Proxy, auto-transfer VCC | DD02a §1.2 |
| Payment schedules | RMS Cloud | Schedules at rate/payer level | R03 §7.3 |
| Hospitality mechanics | Industry | Extended/incremental auth, MIT/CIT, no-show charges, VCC, tokenization | R04 §B6 |
| Card portability | Stripe | PSP-to-PSP only with PCI Level 1 counterparts; wallet cards not portable | DD02c §4; DG #25 |
| Local rails | Maldives | Favara instant payments; national QR announced for 2026; card fee ~2.5% | DD09 §6 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | Collection plans with exactly one executor per item; plan diffs on booking changes; automation policies per plan | The market's biggest payment failure (double charges, silent failures) | PAR-PAY-072–076; EC-PAY-007, 008, 029, 030 |
| 2 | Maldivian methods first-class: bank transfer returns, MVR settlement of USD charges, QR/Favara as external method, cash with missing FX rate | Pilot path (Route D) | EC-PAY-021, 027, 037, 038; PAR-PAY-006 |
| 3 | Cancellation deposit treatment and no-show charging with terms cross-check (MIT) | Unowned today | PAY-R11; EC-PAY-015; PF |
| 4 | Authorization lifecycle at resorts: renewal before expiry for 35-night stays, checkout above authorized, incremental decline at night, expected-spend rules | Long stays, high incidentals | PAR-PAY-031, 033; EC-PAY-011, 012, 013 |
| 5 | Daily balance-transaction / fee / payout reconciliation | "Trust gate" (vision) | PAR-PAY-055, 057; PAY-R16 |
| 6 | Hosted card entry; 3DS challenge | Guest-present card capture in the booking engine and portal | PAR-PAY-021, 039 |
| 7 | Supervisor manual resolve of a pending payment with evidence; unlinked refund to another method; bank refunds | Real-world recovery | PAR-PAY-054, 062, 063; EC-PAY-023 |
| 8 | PCI vault/proxy for OTA hotel-collect cards | VCC at scale | PAR-PAY-027 |
| 9 | Card migration workflow (token map, guarantee report, re-collect fallback) | One-button migration | DG §3.3 item 6; Q142 |
| 10 | Forwarding payments to an external PMS folio | Connected mode | PAR-PAY-098 |

## 4. The 10x outcome (TARGETS)

**Picture:** a guesthouse owner on a local island records a bank transfer from her phone, the next morning's statement
import confirms it automatically, and the guest receives a receipt — while a resort's deposits, balances and VCCs are
collected by plans that can never fire twice, and every payment, fee and payout ties to the ledger daily with zero
unexplained differences.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | 50% / 28 open | — | 100% |
| Powerful | Duplicate charges/refunds under the full fault matrix (timeouts, duplicate/out-of-order webhooks, outages, concurrent link + automation) | 0 in simulator tests | Mews double-charge risk (R02 §2.8) | 0 |
| Powerful | Share of payments verified (provider, terminal batch or bank line) within 1 business day | statement matching built | baseline to measure | ≥ 98%; the rest owned exceptions |
| Seamless | Record cash / terminal / bank transfer at the desk | API only | baseline to measure | ≤ 20 s, from the folio or arrivals row |
| Seamless | Payment state shown identically on folio, arrivals, booking and My work | contradictions in UX1 (simulated) | — | 1 server-derived status, 0 contradictions (M3) |
| Friendly | Payment failures that become a silent state | 0 (tasks/exceptions) | Mews silent VCC failures (R02 §2.8) | 0; every failure has an owner and a recovery action |
| Well-rounded | Methods supported with reconciliation: card (gateway), own terminal, cash, bank transfer, QR/Favara, VCC, payment link | most, recorded | — | all seven, each with a verification path |
| Well-rounded | Edge cases handled | 66% | — | 100% P0, ≥ 90% P1 |

## 5. Next 3 increments

### Increment 1 — Collection plans (one executor per item)
- `CollectionPlan` per booking from rates' payment schedule (`instantiatePaymentSchedule`): items with amount, due
  date, method policy (auto-charge card on file, send link, expect transfer, collect at desk) and **exactly one
  executor** (unique constraint); re-plan with a previewed diff on booking changes; automation failures → owned task;
  cancellation deposit treatment (forfeit/refund per agreed terms) and no-show charging with MIT terms cross-check,
  executed through the plan; link delivery via a `comms` port (simulated until comms exists).
- **Acceptance:** PAR-PAY-072, 073, 074, 075, 037 and EC-PAY-007, 008, 015, 029, 030 tested; scenario S05/S06 still
  green; the PF "unowned" item closed with finance and reservations.

### Increment 2 — Maldives rails, verified
- External payment methods as data (`bank_transfer`, `qr_favara`, `own_terminal`, `cash`) with expected-receipt
  states, statement mappings per bank (generic layout + mapping editor), returned transfers, MVR settlement of USD
  charges (acquirer conversion recorded as FX difference in finance), cash with missing FX rate refused with a guided
  fix; supervisor resolve of pending payments with evidence; refund by bank transfer recorded and confirmed.
- **Acceptance:** EC-PAY-021, 027, 037, 038 and PAR-PAY-054, 063 tested; Route D readiness row upgraded with evidence;
  no bank contact needed (Q154 default).

### Increment 3 — Authorization lifecycle and reconciliation
- Scheme-aware authorization validity with renewal tasks/automatic re-authorization, expected-spend authorization
  rules (room + incidentals per night), incremental decline handling, checkout above authorized amount; daily
  provider balance-transaction reconciliation (simulator + Stripe adapter) with fees and payouts tied to the ledger;
  payments review list (state, fees, payout link).
- **Acceptance:** PAR-PAY-031, 033, 055, 057 and EC-PAY-011, 012, 013, 026 tested; Stripe adapter sandbox test (R4)
  only for an eligible non-Maldivian entity and only with owner-approved test keys.

## 6. Cross-module dependencies and contract changes

- **finance:** `LedgerPort` (property-scoped), `recordDeposit` with `propertyId` (PF), FX differences, receipts on
  payment. **rates:** payment schedules as the source of plan items. **reservations:** guarantee and check-in steps
  read collection plan status; cancellation/no-show events. **comms:** `message.guest` for links and receipts.
  **distribution:** VCC metadata and activation dates from channels (EC-PAY-010). **migration:** card re-collect
  workflow (Q142). **guest-experience:** hosted card entry in the portal and booking engine.
  **integration:** forwarding to an external folio.
- **New contract:** `createCollectionPlan`, `previewPlanChange`, `ExternalPaymentMethod` registry, `resolvePending`
  (supervisor, evidence), `reconcileBalanceTransactions`.

## 7. Power check — never lose or hide

The hotel's legal entity is always the merchant; Monoclay never holds or nets guest funds; tokens only; every provider
call journaled before it is sent; unknown outcomes stay `pending_verification` until a lookup or webhook resolves
them; non-live environments never reach a real provider; recorded payments never look provider-verified; one
collection in flight per purpose; disputes and refunds never erase the original payment.
