# @portico/finance

## Checkpoint

- **Done:** everything under *Capabilities* (R3), the steward review fix round (`docs/orchestration/reviews/
  review-finance.md`: F-01…F-11, the payments-review items, ADR-0015 scope, ADR-0016 §1–§5) with regression tests,
  composition wiring (incl. the payer directory bound to guests), and direct-binding adapters for payments'
  `LedgerPort` and reservations' `FinancePort`, type-checked against verbatim copies of those ports
  (`test/compat/`). Main merged (rates, payments, operations).
- **In progress:** nothing.
- **Next steps (orchestrator, at merge):** in `apps/api/src/composition.ts` bind `tax` to rates
  (`computeTaxesDetailed`, `getRulePackStatus`), payments' `ledger: financeLedgerForPayments(finance)`, finance's
  `payments.requestCollection`, reservations' `finance: financeForReservations(finance)`. The first two are proven to
  compile in `apps/api/test/finance.test.ts` (`bindFinanceTax`, `bindPaymentsLedger`); `apps/api/test/payments.test.ts`
  and the finance API test assume the stubs and change with the binding. Then F-10 receipts (below).
- **Known failing tests:** none (`@portico/finance`: 17 files / 85 tests; `@portico/api`: 10 files / 40 tests).

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
| R16 | Re-applying a stay's billing instructions | R3 — a **merge** (ADR-0016 §2): limit usage and staff rules kept, preview of kept/superseded/added/deactivated; retroactive re-posting not built | `review-regressions.test.ts` (F-04) |
| R17 | Company/agency default rule templates | Not built (rule `source` field exists) | — |
| R18–R20 | Allowances: grant to allowance clearing, consumption (auto/explicit, covers taxes or not, overuse payable), close with forfeit (breakage) / carry forward / credit back | R3 | S19, reversal test, `domain.test.ts` |
| R21 | Package grouping on folio display | Data present (parent links); grouping is a UI concern | — |
| R22–R24 | Deposits: liability, **TGST at receipt (time of supply)**, application at check-in releasing declared tax with rate-change credit, refund (tax released), forfeiture (tax stays due, net to revenue) | R3 | `deposits.test.ts` |
| R25 | Late charges: reopen settled, supplementary folio when invoiced/closed, post-departure flag, exception, collection request via PaymentsPort | R3 | S10 |
| R26 | Settlement: payments, transfer to folio, direct bill to receivables, settle at zero | R3 — write-off **not built** | S04 |
| R27–R29 | Receivables accounts, direct-bill transfer (auto-invoices), payments, allocations, aging as of a date, credit limit block (override permission) / warn | R3 | `receivables-cashier-fx.test.ts` |
| R30–R31 | Write-offs, agency commissions | **Not built** | — |
| R32–R34 | Invoices/credit notes (**receipts not built**, see Known gaps): gapless per series under a row lock, idempotent, immutable snapshot, hash chain per legal entity, postings locked to invoices, credit note `cancel` (re-invoice) and `adjust` (linked corrections) | R3 | `fiscal.test.ts` |
| R35 | Live issuance blocked while tax rules unverified; mandatory particulars enforced in live; non-live documents marked *sample* | R3 | `fiscal.test.ts` |
| R36 | Country fiscal adapters (signatures, QR, submission) | LATER — none | — |
| R37–R39 | Cashier sessions (one open per user/property, floats per currency, blind close, variance to over/short, per-method summary), paid-outs | R3 | S19, cashier test |
| R40–R41 | FX rates (operational + MMA reference per date; a manual rate needs a reason), explicit conversion of charges and payments, currency-position bridging, realized gain/loss on settlement; **a missing rate for the business date blocks** (no fallback, ADR-0016 §3) | R3 — revaluation of open balances not built | FX test, S19, `review-regressions.test.ts` |
| R42 | Trial balance, daily revenue by charge code with taxes and restatements, Green Tax monthly projection | R3 — guest/deposits ledger drill-down lists, cashier report beyond session summary: partial | S19 |
| R43 | Period close / restatement register | **Not built** (domain map now places GL period close in the wave-3 `accounting` module); restatements are flagged per entry | — |
| R44–R45 | `getUnbalancedItems` (Day Close) + integrity report (TB balanced, guest ledger = folios, deposits = bookings, city ledger = accounts, allowance clearing = open allowances) | R3 | every scenario test calls `assertLedgerIntegrity` |
| — | Opening-balance import of deposits with reconciliation report and the tax the previous system already declared (no double TGST, F-09) | R3 | S18 |
| — | Payouts (never revenue), refunds linked to the original payment, idempotent LedgerPort functions with property/legal-entity scope, per-acquirer clearing, recorded-payment corrections, dispute movements, Route D verification, settlement fees | R3 | `receivables-cashier-fx.test.ts`, `payments-ledger-port.test.ts` |
| — | Retention (`retain_until` = tax-year end + 5 years; legal holds) | R3 — nothing is ever purged in this wave | legal-hold test |

## Maldives rules applied (docs/readiness/maldives-tax-rules.md — not legal advice, Q20)

- **Time of supply:** deposits declare TGST when received (the tax engine computes the deposit with
  `taxPointDate` = receipt date, ADR-0016 §4; migrated deposits carry the tax the previous system declared);
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

**Spec reconciliation:** ADR-0016 §1 adopts specificity with nesting (amending the spec's Q40 default, which
rejected every overlap): ties and partial overlaps are rejected, nested rules allowed. Charges are compared against
every charge code's group at posting (F-03), so a code-level rule nested inside a group rule resolves the same way
in preview and posting.

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
| Concurrent corrections/credit notes never over-correct (F-01, F-02) | folio/invoice locked **before** remaining amounts are computed; idempotency re-checked after the lock | `review-regressions.test.ts` |
| Provider calls stay inside the caller's property / legal entity (ADR-0015) | property-scoped delegation + `scope_mismatch` checks | `payments-ledger-port.test.ts`, `reservations-port.test.ts` |
| Adapters satisfy their consumers' ports | verbatim port copies type-checked | `test/compat/port-compat.test.ts`, `apps/api/test/finance.test.ts` (rates/payments bindings) |

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

**Provider calls from other modules (ADR-0015).** Finance services check finance permissions for the actor in
`tx`. Other modules call finance inside their own, already-authorized commands and pass the property they
authorized; the adapters grant the finance permissions that command implies (`PROVIDER_DELEGATION`: reservations,
payments, dayClose, resort) **at that property only**, so a folio, deposit or rule of another property is refused
(payments additionally gets an explicit `scope_mismatch` check including the legal entity). Corrections, credit
notes and write-offs are never delegated. The real actor is audited.

## Universal record contract

| Record (`recordTypes`) | `status` families | `allowedActions` | `issues` | `links` |
|---|---|---|---|---|
| `folio` | folio, balance, invoicing | postCharge, collectPayment, transferPostings, correctPosting, issueInvoice, settle, transferToReceivables, close, void (reasons when disabled) | open finance exceptions (late charge, cash without session…), departed with balance, settled with balance, payments awaiting verification, payer name missing, reopened | owner record, payer, supplementary-of, documents |
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
`finance.cashierSession.closed`, `finance.payout.recorded`, `finance.dispute.recorded`.
Folio, billing-rule and cashier-session events carry `aggregateVersion` (the row version after the change).
Consumed: `reservations.stay.checkedOut` (consumer `finance.stay-departure`: records the departure, closes the
stay's allowance periods). Payload read defensively: `stayId`, `propertyId`, `businessDate | departureDate`.

## Ports and binding status

| Port | Needs | Binding in `composition.ts` |
|---|---|---|
| `PlatformPort` | getProperty (routing metadata; system authorizer), getBusinessDate, getLegalEntity, assertWritable | **real** platform |
| `TaxPort` — rates' canonical contract (`computeTaxesDetailed`, `getRulePackStatus`; `taxCategory`, `taxInclusion`, `taxPointDate`, `agreedRuleVersionIds`) | taxes for charges and prepayments; live-invoice gate | **stub** (`unavailableFinancePorts`): taxable postings fail with 503 `module_not_available`; rule pack unverified (live invoices blocked). Binding to rates compiles (`bindFinanceTax`). |
| `PaymentsPort.requestCollection` | late-charge collection follow-up (DB only), called inside a savepoint | **stub**: returns `unavailable`; the exception tells staff to collect manually |
| `PayerDirectoryPort.describePayer` | payer names for folios and tax invoices when a caller gives only an id | **real**: guest profiles (`guestsService.getProfile`, system scope); companies/agencies → null until that module exists |

Tax mapping (ADR-0016, F-08): rates' `category`/`basis` → finance's invoice treatment (quantity-based → levy outside
the GST base, value-based `fee` → service charge inside it, else tax); `ledgerMappingKey` `tax.tgst` → account
`tax:tgst` (seeded 2200/2210/2220 accounts are used; the Green Tax report reads `tax:green_tax`).

**Providers for other modules (bind directly).** Every adapter grants finance permissions **at the property the
caller authorized only** (ADR-0015: `delegated(tx, perms, propertyId)`); finance still enforces data authority,
invariants, idempotency and audit with the real actor.

- `financeLedgerForPayments(finance)` = payments' `LedgerPort` (`modules/payments/src/ports.ts`): every call carries
  `LedgerScope { propertyId, legalEntityId }` and is refused with `scope_mismatch` when the folio/booking deposit
  belongs elsewhere (`describeTarget` lets payments check first; a booking's first deposit binds it to the
  property). `clearing { provider, accountId }` keeps one clearing account per acquirer account
  (`card_clearing:stripe_connect_acct_1`). `recordPayment` / `recordDeposit` (method, verification),
  `recordRefund` (folio, held deposit, or the folio that received an applied deposit; ceiling counts refunds **and**
  negative adjustments, under a lock), `recordPayout`, `recordPaymentAdjustment`, `recordDisputeMovement`,
  `markPaymentVerified` (Route D: a separate append-only fact; the folio leaves "awaiting verification", the
  posting shows `recorded_verified`, the Day Close item clears), `recordSettlementFees` (acquirer fees → expense).
  Proven in `test/payments-ledger-port.test.ts`.
- `financeForReservations(finance)` = reservations' `FinancePort`: payers by id (`profile` → guest) named through
  the payer directory, otherwise a flagged placeholder (`payer_name_missing` issue; a live tax invoice asks for the
  buyer's name, `buyer_name_required`); `postCharge` narrows `target` (stay/booking/group, else
  `invalid_charge_target`), maps reservations' `TaxLine`, and opens a booking folio for booking-level fees;
  `listFolios` returns reservations' `PayerRef` and `open|settled` (voided folios omitted); `setBillingRules`
  validates charge groups and **merges** (ADR-0016 §2); `getDepositBalance`. Proven with reservations' real inputs
  (CXL, MISC, `['room','package']`, payers without names) in `test/reservations-port.test.ts`.
- `financeProvider(finance, caller)` — generic surface (day-close, resort): every function takes the caller's
  `ProviderScope { propertyId, legalEntityId? }` first.

## Contract changes (vs `docs/architecture/domain-map.md` § finance)

1. `postCharge` input adds `priceMode`, `revenueDate`, `reason`, `occupancy`, `agreedRuleVersionIds`; returns
   `{ entryId, postingIds, folioId, folioIds, allowanceUsage, replayed }` (spec proposal 2).
2. `recordPayment` adds `provider?`, `cashierSessionId?`, `reference?`, `verification?`; amount may be in another
   currency (explicit conversion) — spec proposal 9. Returns `{ entryId, postingId, postingIds, replayed }`.
3. `recordDeposit` adds `propertyId?` (payments always passes it via `LedgerScope`), `method?`, `provider?`,
   `verification?`. `applyDeposits` adds `amountMinor?`, `idempotencyKey?`; refuses a deposit of another property.
4. `recordPayout`: `gross`, `fees`, `net` are `Money`; adds `provider?`, `businessDate?`, `destination?`.
5. New providers: `markOwnerDeparted`, `grantAllowance` (`taxTreatment`), `closeAllowances`, `createBillingRule`,
   `mergeBillingRules` (with preview), `previewRouting`, `transferPostings`, `adjustPosting`, `reverseEntry`,
   `issueInvoice` (`payerDetails.name`), `issueCreditNote`, `transferToReceivables`, `refundDeposit`,
   `forfeitDeposit`, `recordFxSettlement`, `importOpeningDeposits` (`declaredTaxes` per row, F-09),
   `getUnbalancedItems` items `{ code, severity, ref, message, details }`.
6. `TaxPort` = rates' canonical provider contract (rates README § Provider contract); finance sends `taxPointDate`
   for deposits (ADR-0016 §4: one model — no `chargeGroup: 'deposit'`).
7. Dependency arrows `finance ─► rates` (tax engine), `finance ─► guests` (payer names, `PayerDirectoryPort`).
8. Payments `LedgerPort` (payments README § Contract changes): `LedgerScope` on every call, `clearing`,
   `describeTarget`, `markPaymentVerified`, `recordSettlementFees`, `recorded_verified`.
9. Reservations `FinancePort`: `setBillingRules` is a merge; payers by id. **Requested:** reservations passes
   `propertyId` on `recordDeposit`, `applyDeposits`, `listFolios`, `setBillingRules`, `getFolioBalance`,
   `getDepositBalance` (the adapter accepts it and then scopes the delegation; without it those calls rely on RLS
   and finance's invariants only).
10. `fxRateInput.reason` (required for any non-MMA rate, ADR-0016 §3).

## Adoption modes and data authority

- Writes to folios check `assertWritable(propertyId, 'charges')`; opening-balance imports check `accounting`.
- `charges` external + `read_only` → refused with the system named; `forward` → refused with "forwarding not
  connected yet" (forwarding through `integration` is a gap). Ledger-only entries at legal-entity level (payouts,
  FX settlement, receivables payments) keep Portico's ledger ("accounting bridge": an external ERP being
  authoritative for `accounting` does not stop Portico's own journal; exports are a later capability).
- Standalone dependencies: platform, identity, rates (tax engine); reservations for stay folios.

## Known gaps

- **Receipts (FIN-R32, F-10): not built.** MIRA requires a tax invoice *or receipt* within 3 days of the time of
  supply; for deposits that is the payment. Finance declares the tax at receipt but issues no receipt document.
  Plan: a `receipt` fiscal kind with its own series and chain, issued idempotently per payment/deposit ref (booking
  reference instead of a folio). Parity rows PAR-FIN-132/133 must read `building` until then (parity worktree).
- Threshold approvals for adjustments; write-offs; agency commissions; company/agency rule templates; retroactive
  re-posting after a rule change (re-application is a merge for future postings); transfer previews; period close
  and restatement register (`accounting`, wave 3); journal exports; forwarding charges to an external PMS; FX
  revaluation of open balances; cashier float/drop entries (memo amounts); effective-dated charge-code mapping;
  one open supplementary folio per original.
- Business date is read without a lock (P2-01: needs a platform `lockBusinessDate`); legal-entity-level entries
  (payouts, settlement fees, disputes) use the UTC date when no property applies.
- Future service dates are refused for every charge; reservations posts penalties with the business date.
- Receivables events carry no `aggregateVersion` (the account row is not versioned by those flows).
- Tax on forfeited deposits follows the declared-at-receipt treatment pending the adviser (Q20.2); allowance
  taxation per ADR-0016 §5 is configurable per grant (`taxed_at_grant` default for taxable codes) pending Q48.

## Open questions for the owner

- Q40 (patent review) — confirm specificity-based resolution is acceptable pending counsel, or require the
  stricter no-overlap rule.
- Q20 — Maldives adviser: TGST on forfeited deposits; MVR equivalents on invoices; e-invoicing.
- Whether cash floats should be journalized (house bank → drawer) or stay memo amounts.
