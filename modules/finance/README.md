# @portico/finance

## Checkpoint

- **Done:** everything listed under *Capabilities* below with status R3, tests (domain, integration, scenarios
  S04/S09/S10/S18/S19, API end-to-end), composition wiring, and direct-binding adapters for the payments
  `LedgerPort` and the reservations `FinancePort`.
- **In progress:** nothing.
- **Next steps (orchestrator, at merge):** in `apps/api/src/composition.ts` bind `rates` → `TaxPort`,
  `payments` → `PaymentsPort.requestCollection`; give payments `ledger: financeLedgerForPayments(finance)` and
  reservations `finance: financeForReservations(finance)`; register `financeDemoSeed` in `DEMO_SEED_STEPS`.
- **Known failing tests:** none (`@portico/finance`: 15 files / 64 tests; `@portico/api`: 13 tests incl. finance e2e).

## Purpose

The hotel's book of record (spec `docs/specs/finance.md`, ADR-0008). A double-entry journal per legal entity is
the source of truth; folios, balances, deposits, receivables, invoices and reports are projections of it.
Corrections are new linked entries; retries are harmless; totals reconcile across folios, journal, tax reports,
invoices and the trial balance.

## Layout

```
migrations/0001_finance.sql   schema `finance`: accounts, charge_codes, fx_rates, folios, owner_departures,
                              cashier_sessions, journal_entries, postings, journal_lines (balanced, append-only),
                              billing_rules, deposit_accounts/movements, allowance_instances, receivables_*,
                              fiscal_series/chains/documents, posting_document_locks, cash_movements,
                              opening_balance_imports, exceptions, legal_holds
src/domain/                   pure logic + unit tests: routing (specificity), split, ledger/FX, fiscal (hash chain,
                              numbering, retention, ±2% tolerance), invoice composition, aging, cashier, allowance,
                              folio state, chart template, deterministic PDF
src/service/                  application services (one file per area), records.ts (universal record contract)
src/routes.ts                 HTTP under /v1/finance/*        src/search.ts   SearchProvider
src/ports.ts                  PlatformPort, TaxPort, PaymentsPort        src/wiring.ts   stubs + demo seed step
```

## Capabilities (spec FIN-Rnn) — status and readiness

Readiness uses CLAUDE.md §7. Everything here is **R3 (implemented and tested internally)** unless stated; no
external integration is claimed. Tax figures in tests come from a fake tax engine (`test/helpers.ts`), not the
real `rates` rule pack.

| Req | Capability | Status | Evidence |
|---|---|---|---|
| R01 | Chart of accounts per legal entity (USALI-inspired template, derived accounts per card provider / tax key) | R3 | `domain.test.ts` chart; every integration test |
| R02 | Balanced entries per currency **and** functional currency, business date, occurred_at, service/revenue date per line, source ref, actor, idempotency key, correlation id | R3 | deferred constraint trigger; `ledger.test.ts` |
| R03 | Corrections as linked entries (`corrects_entry_id`, `reverses_entry_id` at most once); posted rows immutable | R3 | `security-and-corrections.test.ts` (adjust, reverse), `ledger.test.ts` (append-only) |
| R04 | Business date stamped from platform; earlier service dates need a reason from staff; corrections to earlier dates are restatements | R3 | S10 test (reason), restatement test |
| R05–R06 | Folios (stay/booking/group/company/house, payer-labelled, default folio, supplementary), posting kinds | R3 | all tests |
| R07–R08 | `postCharge` with routing, tax engine (inclusive/exclusive, provided lines only from integrations), one entry, deterministic keys | R3 | S04, S09, S19 |
| R09 | Manual charges with reason for late service dates | R3 | S10 |
| R10 | Adjustments (partial/full, reason code, sensitive permission, same-day flag) | R3 — threshold approvals (identity approvals) **not built** | corrections tests |
| R11 | Transfers (postings or amount, partial with taxes, both sides traceable, same legal entity only) | R3 — transfer *preview* endpoint not built (balances shown before/after by the client) | transfers test |
| R12 | Charge codes (group immutable, revenue account mapping, tax group, allowance tags, restricted codes) | R3 — mapping is "current at posting" (journal lines keep the account used); effective-dated mapping table not built | |
| R13–R14 | Billing rules: selector (codes/groups, dates, weekdays), caps (per night / per stay / percent), **specificity**, conflicts rejected at save | R3 | `routing.test.ts`, S04, cap concurrency test |
| R15 | "Who pays for what" preview (saved or proposed rules, cap usage) | R3 | S04 (preview equals posting) |
| R16 | Retroactive re-application of rules | **Not built** (manual transfers available) | — |
| R17 | Company/agency default rule templates | Not built (rule `source` field exists) | — |
| R18–R20 | Allowances: grant to allowance clearing, consumption (auto/explicit, covers taxes or not, overuse payable), close with forfeit (breakage) / carry forward / credit back | R3 | S19, reversal test, `domain.test.ts` |
| R21 | Package grouping on folio display | Data present (parent links); grouping is a UI concern | — |
| R22–R24 | Deposits: liability, **TGST at receipt (time of supply)**, application at check-in releasing declared tax with rate-change credit, refund (tax released), forfeiture (tax stays due, net to revenue) | R3 | `deposits.test.ts` |
| R25 | Late charges: reopen settled, supplementary folio when invoiced/closed, post-departure flag, exception, collection request via PaymentsPort | R3 | S10 |
| R26 | Settlement: payments, transfer to folio, direct bill to receivables, settle at zero | R3 — write-off **not built** | S04 |
| R27–R29 | Receivables accounts, direct-bill transfer (auto-invoices), payments, allocations, aging as of a date, credit limit block (override permission) / warn | R3 | `receivables-cashier-fx.test.ts` |
| R30–R31 | Write-offs, agency commissions | **Not built** | — |
| R32–R34 | Invoices/credit notes: gapless per series under a row lock, idempotent, immutable snapshot, hash chain per legal entity, postings locked to invoices, credit note `cancel` (re-invoice) and `adjust` (linked corrections) | R3 | `fiscal.test.ts` |
| R35 | Live issuance blocked while tax rules unverified; mandatory particulars enforced in live; non-live documents marked *sample* | R3 | `fiscal.test.ts` |
| R36 | Country fiscal adapters (signatures, QR, submission) | LATER — none | — |
| R37–R39 | Cashier sessions (one open per user/property, floats per currency, blind close, variance to over/short, per-method summary), paid-outs | R3 | S19, cashier test |
| R40–R41 | FX rates (operational + MMA reference per date), explicit conversion of charges and payments, currency-position bridging, realized gain/loss on settlement | R3 — revaluation of open balances not built | FX test, S19 |
| R42 | Trial balance, daily revenue by charge code with taxes and restatements, Green Tax monthly projection | R3 — guest/deposits ledger drill-down lists, cashier report beyond session summary: partial | S19 |
| R43 | Period close / restatement register | **Not built** (domain map now places GL period close in the wave-3 `accounting` module); restatements are flagged per entry | — |
| R44–R45 | `getUnbalancedItems` (Day Close) + integrity report (TB balanced, guest ledger = folios, deposits = bookings, city ledger = accounts, allowance clearing = open allowances) | R3 | every scenario test calls `assertLedgerIntegrity` |
| — | Opening-balance import of deposits with reconciliation report (S18 groundwork) | R3 | S18 |
| — | Payouts (never revenue), refunds linked to the original payment, idempotent LedgerPort functions, recorded-payment corrections, dispute movements, verification state | R3 | `receivables-cashier-fx.test.ts`, `payments-ledger-port.test.ts` |
| — | Retention (`retain_until` = tax-year end + 5 years; legal holds) | R3 — nothing is ever purged in this wave | legal-hold test |

## Maldives rules applied (docs/readiness/maldives-tax-rules.md — not legal advice, Q20)

- **Time of supply:** deposits declare TGST when received (via the tax engine with `chargeGroup: 'deposit'`);
  applying a deposit releases that declared tax against the tax the stay's charges carry; if the rule changed
  since receipt, the difference is credited to the folio so the prepaid part keeps the earlier rate. Forfeited
  deposits keep the declared tax due; refunds release it. Invoices list `depositTaxCredits`.
- **Tax invoice particulars:** title "Tax Invoice", supplier legal name / TIN / address (blocking in live), buyer
  name (+ TIN/address warnings for business buyers), software-generated gapless number, date, lines, value before
  tax (service charge inside), tax charged, **Green Tax as a separately stated levy**, gratuities and paid-outs
  outside the tax base, total.
- **Issue within 3 days:** `invoice_overdue_for_issue` in Day Close checks (`invoicesOverdueForIssue`).
- **USD reporting:** a non-USD invoice of an MV legal entity requires the USD rate for the date and an "MMA"
  reference rate; deviation must be within ±2% (rate, source, date, deviation stored in the snapshot).
- **Retention:** ≥ 5 years after the tax year; legal holds extend it.
- **Green Tax report:** `GET /v1/finance/reports/green-tax?legalEntityId&month` — guest-days, exempt guest-days and
  amounts by rate category per property, in the functional currency (USD).

## Billing-rule resolution and the patent caution (for legal review)

Research 01 (§6.5) notes an **Agilysys patent application (US 2017/0124610)** on evaluating charges against a
stay's *ranked* routing rules. Portico has **no rank or priority field**. Resolution is by **specificity**: a rule
matches a set of (charge code, service date) pairs; two rules may overlap only if one set strictly contains the
other, and then the smaller (more specific) rule wins; identical or partially overlapping rules are rejected at
save time with the colliding rule named. Cap overflow and unmatched charges go to the default folio. No legal
conclusion is drawn; counsel should review before any ranked model is considered (OPEN_QUESTIONS Q40).

**Spec reconciliation:** the spec's Q40 default (FIN-R14, FIN-I13) rejects *every* overlap; the orchestrator
asked for specificity-based resolution. Implemented: specificity, with ties and partial overlaps rejected. Nested
rules are the only difference from the spec default. A one-line switch in `findConflicts` could reject nested
overlaps too if the owner prefers the stricter rule.

## Invariants and the tests that prove them

| Invariant | Enforcement | Test |
|---|---|---|
| FIN-I01/I02 entries balance per currency and in functional currency; TB balanced | deferred constraint trigger `finance.assert_entry_balanced` + `assertBalanced` | `ledger.test.ts` (random sequence; direct unbalanced insert rejected) |
| Lines/postings only in the creating transaction | constraint triggers on `txid` | `ledger.test.ts` |
| FIN-I03 folio = Σ postings = guest-ledger sub-account | trigger requires a mirrored folio line per posting; integrity report | all scenario tests |
| FIN-I04 idempotency key unique per tenant, replay returns originals | `unique (tenant_id, idempotency_key)`; claim-first insert | S09 (sequential + concurrent), refund retry, payout retry |
| FIN-I05 no update/delete of posted rows | `core.make_append_only` (grants + trigger, owner included) | `ledger.test.ts`, `fiscal.test.ts` |
| FIN-I06 gapless numbering | series row lock in the issuing tx; forward-only trigger | `fiscal.test.ts` (24 concurrent requests) |
| FIN-I07 invoiced postings locked | `posting_document_locks`; transfer/adjust refuse | `fiscal.test.ts`, transfers test |
| FIN-I08 deposit balance ≥ 0 | `check (balance_minor >= 0)` + row lock | `deposits.test.ts` |
| FIN-I09 no posting for authorizations | finance has no authorize concept; payments call only after confirmation | by construction |
| FIN-I10 business date = platform business date at commit | stamped from PlatformPort | S10 |
| FIN-I11 allowance used ≤ granted; breakage + carried + credited = remainder | `check (used_minor <= granted_minor)`; `closeOutcome` | S19, `domain.test.ts` |
| FIN-I12 transfers net zero, same legal entity | composite FKs `(folio_id, legal_entity_id)` + checks | transfers test |
| FIN-I13 no tie between rules on an owner | `findConflicts` at save; `matchingChain` re-checks at posting | `routing.test.ts`, S04 |
| FIN-I14 control accounts = sub-ledgers | `integrityReport` | every scenario test |
| Caps never double-used under concurrency | capped rule rows locked `FOR UPDATE` | cap concurrency test |
| Tenant isolation | RLS on every table + app permission checks | `security-and-corrections.test.ts`, API test |

## Scenarios

| File | Demonstrates |
|---|---|
| `test/scenario-s04-company-pays-accommodation.test.ts` | Two rooms; company pays room + breakfast up to USD 300/night incl. taxes; preview equals posting; incidentals to guests; direct bill (auto invoice) + card payments; one invoice per payer; nested-rule specificity; partial overlap rejected |
| `test/scenario-s09-ledger-reposting.test.ts` | Interrupted night posting re-run: replays, concurrent duplicates → one entry, same key + different amount refused, TB balanced throughout |
| `test/scenario-s10-late-restaurant-charge.test.ts` | Late POS charge after check-out (event consumer): reopen settled folio / supplementary folio when invoiced, post-departure flags, collection request, Day Close exception, staff reason requirement |
| `test/scenario-s18-opening-deposits.test.ts` | Opening deposits import through migration suspense; duplicate/negative rows rejected; difference reported + urgent exception; idempotent re-run |
| `test/scenario-s19-package-allowance-taxes.test.ts` | Package + daily dining credit, overuse and breakage, SC/TGST/Green Tax (child under 2 exempt), card + MVR cash partial payments; folio, invoice, daily tax report, Green Tax report and TB reconcile to the cent; cashier per-method summary |
| `apps/api/test/finance.test.ts` | HTTP: Idempotency-Key replay, ETag, problem+json, honest 503 when the tax engine is not connected, live invoice gate, search, record history, isolation, rule conflict, preview |

## Permissions

`finance.folio.read` · `finance.folio.manage` · `finance.posting.create` · `finance.posting.correct` ⚑ ·
`finance.posting.transfer` · `finance.posting.restrictedCodes` ⚑ · `finance.billingRule.manage` ·
`finance.folio.settleToReceivables` · `finance.invoice.issue` · `finance.creditNote.issue` ⚑ ·
`finance.receivables.read` (org) · `finance.receivables.manage` ⚑ (org) · `finance.creditLimit.override` ⚑ ·
`finance.cashier.operate` · `finance.cashier.paidOut` ⚑ · `finance.cashier.review` · `finance.fx.manage` ⚑ (org) ·
`finance.chargeCode.manage` ⚑ · `finance.ledger.read` (org) · `finance.ledger.manage` ⚑ (org) ·
`finance.report.read` · `finance.openingBalance.import` ⚑.
Naming vs task brief: `finance.ar.manage` → `finance.receivables.manage` (glossary term), invoice issuance keeps
`finance.invoice.issue`; spec's `finance.document.issue` → `finance.invoice.issue`.

**Provider calls from other modules.** Finance services check finance permissions for the actor in `tx`.
Other modules call finance inside their own, already-authorized commands; `financeProvider(service, caller)`
grants the finance permissions that caller's command implies (`PROVIDER_DELEGATION`: reservations, payments,
dayClose, resort). Corrections, credit notes and write-offs are never delegated. The real actor is audited.

## Universal record contract

| Record (`recordTypes`) | `status` families | `allowedActions` | `issues` | `links` |
|---|---|---|---|---|
| `folio` | folio, balance, invoicing | postCharge, collectPayment, transferPostings, correctPosting, issueInvoice, settle, transferToReceivables, close, void (reasons when disabled) | open finance exceptions (late charge…), departed with balance, settled with balance, reopened | owner record, payer, supplementary-of, documents |
| `fiscal_document` | document | downloadPdf, issueCreditNote | sample, unverified tax rules, particulars warnings | folio, credited invoice, credit notes |
| `receivables_account` | account, credit | recordPayment, allocatePayment, putOnHold/reactivate, close | over credit limit, > 90 days overdue, on hold | company/agency |
| `cashier_session` | session, count | close, paidOut | open across business dates, over/short | — (owner = cashier) |
| `billing_rule`, `journal_entry` | — | — | — | history only |

Folio `attachedTo` replaces the folio's former `owner` field in responses (the universal `owner` means the
responsible person). Audit rows for postings target the **folio**, so folio history shows charges, payments,
transfers and corrections. `financeSearch` finds folios (payer/label), invoices/credit notes (number) and
receivables accounts (name) and summarizes all four record types, permission- and property-scope-aware. No
secrets or identity documents are written to audit (payer names and business tax IDs only).

## Events

Emitted: `finance.posting.created`, `finance.posting.adjusted`, `finance.postings.transferred`,
`finance.folio.opened|settled|reopened`, `finance.invoice.issued`, `finance.creditNote.issued`,
`finance.deposit.recorded|applied|refunded|forfeited`, `finance.billingRule.changed`,
`finance.allowance.breakagePosted`, `finance.receivables.transferred|paymentRecorded`,
`finance.cashierSession.closed`, `finance.payout.recorded`.
Consumed: `reservations.stay.checkedOut` (consumer `finance.stay-departure`: records the departure, closes the
stay's allowance periods). Payload read defensively: `stayId`, `propertyId`, `businessDate | departureDate`.

## Ports and binding status

| Port | Needs | Binding in `composition.ts` |
|---|---|---|
| `PlatformPort` | getProperty (routing metadata; called with a system authorizer), getBusinessDate, getLegalEntity, assertWritable | **real** platform |
| `TaxPort` (`rates.computeTaxes`, rule-pack status) | taxes for charges and prepayments | **stub** (`unavailableFinancePorts`): taxable postings fail with 503 `module_unavailable`; rule pack reported unverified (live invoices blocked). Bind to rates at merge. |
| `PaymentsPort.requestCollection` | late-charge collection follow-up (DB only) | **stub**: returns `unavailable`; the exception tells staff to collect manually. Bind to payments at merge. |

**Providers for other modules (bind directly):**

- `financeLedgerForPayments(finance)` implements payments' `LedgerPort` exactly
  (`modules/payments/src/ports.ts`): `recordPayment` (method incl. `payment_link`/`external_terminal`,
  `verification` stored and shown as "awaiting verification"), `recordDeposit`, `recordRefund` (folio, held
  deposit, or the folio that received an applied deposit), `recordPayout` → `{ journalEntryId }`,
  `recordPaymentAdjustment` (signed, linked correction on folio or deposit), `recordDisputeMovement` (card
  clearing ↔ disputed funds; the bill is untouched). Cash recorded by payments without an open cashier session is
  posted and raised as a `cash_without_session` exception instead of being refused. Deposits have no folio posting:
  their `postingId` carries the journal entry id. Proven in `test/payments-ledger-port.test.ts`.
  **Binding note:** payments' `recordDeposit` does not pass `propertyId`; finance resolves it from an existing
  deposit account or a booking-owned folio and otherwise refuses with `property_required`. Recommended one-line
  change in payments: pass `propertyId: p.property_id` (the adapter accepts it).
- `financeForReservations(finance)` implements reservations' `FinancePort` (`openFolio` with payer refs,
  `postCharge`, `recordDeposit`, `applyDeposits`, `getFolioBalance`, `listFolios`, `setBillingRules` (whole set
  replaced and validated), `getDepositBalance`) plus `markOwnerDeparted`, `grantAllowance`, `closeAllowances`.
  Reservations passes payer refs without names; folios are labelled with the given name/label or a neutral default
  until a name is supplied. Proven in `test/reservations-port.test.ts`.
- `financeProvider(finance, caller)` — generic delegated surface for day-close and resort.

## Contract changes (vs `docs/architecture/domain-map.md` § finance)

1. `postCharge` input adds `priceMode`, `revenueDate`, `reason`, `occupancy`; returns
   `{ entryId, postingIds, folioId, folioIds, allowanceUsage, replayed }` (spec proposal 2).
2. `recordPayment` adds `provider?`, `cashierSessionId?`, `reference?`; amount may be in another currency (explicit
   conversion) — spec proposal 9. Returns `{ entryId, postingId, postingIds, replayed }`.
3. `recordDeposit` adds `propertyId?` (resolved from the booking's folio when omitted), `method?`, `provider?`,
   `taxGroup?`. `applyDeposits` adds `amountMinor?`, `idempotencyKey?`.
4. `recordPayout`: `gross`, `fees`, `net` are `Money`; adds `provider?`, `businessDate?`, `destination?`.
5. New providers: `markOwnerDeparted`, `grantAllowance`, `closeAllowances`, `createBillingRule`, `previewRouting`,
   `transferPostings`, `adjustPosting`, `reverseEntry`, `issueInvoice`, `issueCreditNote`, `transferToReceivables`,
   `refundDeposit`, `forfeitDeposit`, `recordFxSettlement`, `importOpeningDeposits`, `getUnbalancedItems` items shape
   `{ code, severity: 'blocking'|'warning', ref, message, details }`.
6. `TaxPort` shape (finance side of `rates.computeTaxes`): lines with `priceMode`; result per line `{ net, taxes[] }`
   where each tax has `kind` (`tax|fee|service_charge`), `accountKey`, `ruleVersionId`, optional `units`,
   `exemptUnits`, `rateCategory`. Prepayments use `chargeGroup: 'deposit'`.
7. Dependency arrow `finance ─► rates` (tax engine) — spec proposal 1.
8. Payments alignment (payments README § Contract changes): `recordPayment`/`recordDeposit` accept `method`
   (adds `payment_link`, `external_terminal`) and `verification`; `recordRefund` accepts `folioId: null` +
   `bookingId`; new `recordPaymentAdjustment` and `recordDisputeMovement`; `recordPayout` returns
   `{ journalEntryId }` through the adapter.
9. Reservations alignment: `setBillingRules(owner, rules)` replaces an owner's rule set atomically
   (`replaceBillingRules`); `getDepositBalance(bookingId)`.

## Adoption modes and data authority

- Writes to folios check `assertWritable(propertyId, 'charges')`; opening-balance imports check `accounting`.
- `charges` external + `read_only` → refused with the system named; `forward` → refused with "forwarding not
  connected yet" (forwarding through `integration` is a gap). Ledger-only entries at legal-entity level (payouts,
  FX settlement, receivables payments) keep Portico's ledger ("accounting bridge": an external ERP being
  authoritative for `accounting` does not stop Portico's own journal; exports are a later capability).
- Standalone dependencies: platform, identity, rates (tax engine); reservations for stay folios.

## Known gaps

Threshold approvals for adjustments; write-offs; agency commissions; rule re-application and company/agency rule
templates; transfer previews; period close and restatement register (now `accounting`, wave 3); journal exports;
forwarding charges to an external PMS; FX revaluation of open foreign balances; cashier float/drop entries (floats
are memo amounts; only variances are posted); effective-dated charge-code mapping; supplementary folio limited to
one open per original; legal-entity-level entries use the UTC date of the transaction as business date when no
property applies; tax on forfeited deposits follows the declared-at-receipt treatment pending adviser (Q20.2).

## Open questions for the owner

- Q40 (patent review) — confirm specificity-based resolution is acceptable pending counsel, or require the
  stricter no-overlap rule.
- Q20 — Maldives adviser: TGST on forfeited deposits; MVR equivalents on invoices; e-invoicing.
- Whether cash floats should be journalized (house bank → drawer) or stay memo amounts.
