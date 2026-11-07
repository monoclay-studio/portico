# Spec: finance

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `finance` · Prefix `FIN`

## 1. Purpose

Finance is the hotel's book of record. A real-time double-entry ledger per legal entity is the source of truth;
folios, balances, receivables and reports are projections of it. Finance must make "who pays for what" obvious
before it happens, make every correction traceable, make retries harmless, and keep totals reconciling across
folios, payments, payouts and exports — so a controller trained on OPERA loses nothing and a guesthouse owner
never has to understand a journal entry.

## 2. Scope and non-goals

**In scope:** chart of accounts, journal, folios (stay/booking/group/company/house), postings, charge codes,
billing rules and folio transfers, allowance consumption and breakage, deposits ledger, receivables accounts
(direct bill / city ledger), invoices and credit notes (fiscal ledger), cashier sessions, FX rates and
settlement differences, late charges, commissions (SHOULD), period close and restatement reporting, finance
exceptions for Day Close, accounting exports (with `integration`).

**Non-goals:** talking to payment providers (`payments` — finance records only confirmed outcomes via
`LedgerPort`); tax computation (`rates.computeTaxes` is the only tax engine); Monoclay's SaaS invoices
(`billing`, separate money world — architecture rule 14); general ledger beyond hospitality revenue and its
balance-sheet counterparts (expenses, payroll, procurement belong to the hotel's accounting/ERP — boundary
per brief §12); country fiscal device/e-invoicing submission (LATER via fiscal adapters in `integration`).

## 3. Capabilities

### 3.1 Ledger

- **FIN-R01** [MUST] One ledger per legal entity with a chart of accounts seeded from a hospitality template
  (USALI-inspired): guest ledger (receivable per folio sub-account), deposits held (liability per booking),
  receivables (per receivables account), revenue by department/charge-code group, taxes and fees payable (per
  tax rule mapping key), service charge (payable or revenue per configuration), allowance clearing, breakage
  revenue, card clearing (per payment account), cash (per cashier session currency), bank, payout clearing,
  payment fees, commissions payable, FX gains/losses, rounding, suspense.
- **FIN-R02** [MUST] Journal entries are balanced per transaction currency **and** in the legal entity's
  functional currency, immutable, and carry: `businessDate` (property business date at commit),
  `occurredAt` (UTC), and per line `serviceDate` and `revenueDate` where applicable, source ref, actor,
  idempotency key, correlation id.
- **FIN-R03** [MUST] Corrections are new entries linked to the entry they correct (`correctsEntryId`), with
  reason code and actor; amounts of posted rows are never updated (DB grants forbid `UPDATE` on amount and
  account columns, and `DELETE`).
- **FIN-R04** [MUST] Postings are stamped with the property's business date current at commit. No API posts to
  a past business date. Corrections relating to an earlier business date carry `relatesToBusinessDate` and
  appear in reports for that date as **restatements** (with reason and link), never as silent changes.

### 3.2 Folios and postings

- **FIN-R05** [MUST] Folio: owner (`stay | booking | group | company | house`), payer (profile, company,
  agency), legal entity (from property operator at open), currency (default property base), label, default
  flag (each stay/booking/group has exactly one default folio), status (§4.2). A stay may have any number of
  folios (split billing) — never numbered "windows".
- **FIN-R06** [MUST] Posting kinds: `charge`, `tax` (child of a charge), `allowance_usage`, `payment`, `refund`,
  `deposit_application`, `transfer_in`/`transfer_out` (paired), `adjustment` (correction of a posting),
  `write_off`. Each posting is backed by journal lines.
- **FIN-R07** [MUST] `postCharge(...)` (domain map) resolves the destination folio via billing rules when the
  target is a stay/booking/group; computes taxes via `rates.computeTaxes` (`taxMode: 'compute'`) for the service
  date per tax-point policy, or accepts `provided` tax lines only from trusted sources (channel prepaid totals,
  POS with verified tax config) with the rule version reference; creates the charge and tax postings in one
  entry; is idempotent on `idempotencyKey`.
- **FIN-R08** [MUST] Deterministic idempotency keys for system postings: `room:{stayId}:{night}`,
  `inclusion:{stayId}:{inclusionId}:{night}`, `fee:{stayId}:{feeKind}:{ref}`, `penalty:{kind}:{stayId}`,
  `pos:{outletId}:{checkId}:{lineId}`, `breakage:{allowanceInstanceId}:{period}`; enforced by a unique constraint.
- **FIN-R09** [MUST] Manual charges by staff: charge code, amount or quantity × unit price, service date (default
  business date; earlier service dates allowed for late-arriving charges with reason), description, optional
  reference; tax computed automatically; preview of the resulting folio balance.
- **FIN-R10** [MUST] **Adjustments**: partial or full, reason code (from a configurable list), permission
  `finance.posting.correct` ⚑ with threshold-based approval (identity approvals) above policy amount; a same-day
  correction is flagged `sameDayCorrection` so daily revenue reports can net it transparently.
- **FIN-R11** [MUST] **Transfers** between folios of the same legal entity: select postings or amount, preview
  balances before/after on both folios; transfers across legal entities are rejected (`intercompany_transfer`,
  LATER inter-company flow).

### 3.3 Charge codes

- **FIN-R12** [MUST] Charge code: code, name (localized), group (`room`, `package`, `food`, `beverage`, `spa`,
  `activity`, `transfer`, `retail`, `minibar`, `fee`, `penalty`, `misc`, `payment`, `deposit`), revenue account
  mapping (effective-dated), tax applicability group (consumed by rates), department, allowance eligibility
  tags, posting permission (some codes restricted), active flag. Payment codes map to clearing accounts.

### 3.4 Billing rules (who pays for what)

- **FIN-R13** [MUST] Billing rule on an owner (stay, booking, group): destination folio, selector (charge codes
  and/or groups; service-date range; days of week), optional cap (amount per night, amount per stay, or percent
  of each matching charge), source (`manual`, `company_default`, `rate_plan`, `group`, `package`), active period.
  Unmatched charges and cap overflow go to the owner's default folio.
- **FIN-R14** [MUST] **No precedence ranking (Q40 default):** two rules on the same owner may not match the same
  charge (same charge code and overlapping service dates/days). Saving an overlapping rule is rejected with the
  colliding rule named and suggested fixes (narrow dates, narrow codes, edit the other rule). Rules inherited
  from sources are materialized on the owner at booking/check-in so overlap is checked on the owner, and the
  user resolves overlaps explicitly. A ranked precedence model must not be designed until Q40 is answered.
- **FIN-R15** [MUST] **"Who pays for what" preview** before saving rules: projected remaining charges (from agreed
  terms: room, inclusions, fees, taxes; plus typical incidentals as categories) allocated to folios with
  per-folio projected totals.
- **FIN-R16** [MUST] **Retroactive re-application** (optional when saving): existing postings that the new rule
  set would route differently are moved by transfers, previewed and audited.
- **FIN-R17** [SHOULD] Company and agency profile defaults (e.g. "company pays room & tax") and group defaults
  are templates applied on booking with visible source.

### 3.5 Allowances and packages

- **FIN-R18** [MUST] At night posting, an included package component's allocation posts to its charge code's
  revenue account; an **allowance** allocation posts to *allowance clearing* (not revenue) and creates an
  allowance instance (`stay`, definition, period, granted amount/quantity, used, remaining).
- **FIN-R19** [MUST] A charge from an eligible outlet/charge code with `allowanceRef` (or auto-matched by
  eligibility) posts the full charge and an `allowance_usage` credit = min(charge incl. taxes per definition,
  remaining); overuse remains payable by the guest.
- **FIN-R20** [MUST] At period end (per night or at check-out for per-stay) the unused remainder with
  `forfeit` policy posts **breakage** (debit allowance clearing, credit breakage revenue) with key
  `breakage:{instance}:{period}`; carry-within-stay rolls it to the next period instead.
- **FIN-R21** [MUST] Folio display groups package components under the package line with an expandable
  breakdown; guests see allowance balances (guest portal, LATER) from the same instances.

### 3.6 Deposits, late charges and settlement

- **FIN-R22** [MUST] `recordDeposit` (from payments after provider confirmation) credits deposits held for the
  booking (liability, not revenue). Tax on prepayments is a rate-pack option (`taxOnPrepayment`), default off
  pending Q41/Q42.
- **FIN-R23** [MUST] `applyDeposits(bookingId, toFolioId)` at check-in (or earlier by policy) moves deposit
  liability to the folio as `deposit_application`; multi-stay bookings allocate by stay share or by staff choice.
- **FIN-R24** [MUST] Deposit outcomes on cancellation per agreed terms: forfeit (credit cancellation revenue
  charge code), refund (payments), or keep as guest credit (liability remains, linked to profile).
- **FIN-R25** [MUST] **Late charges** (S10): posting to a departed stay —
  folio `open` → posts and flags *post-departure*; folio `settled` → folio is **reopened** (status `open`,
  `reopenedReason = late_charge`) and flagged; folio **fully invoiced** → posts to a new *supplementary folio*
  for the same payer so issued invoices stay immutable. Each case creates a collection follow-up (payments:
  MIT charge on card on file if the agreed terms allow post-departure charges; otherwise payment request) and a
  departures follow-up exception.
- **FIN-R26** [MUST] **Settlement** options per folio: payment(s) (via payments), transfer to a receivables
  account (direct bill; requires active account and available credit), transfer to another folio, write-off
  (approval), leave open with permission. A folio reaches `settled` only at zero balance.

### 3.7 Receivables (city ledger)

- **FIN-R27** [MUST] Receivables account per company/agency per legal entity: terms (days), currency, contacts,
  status (`active | on_hold | closed`), credit limit (optional). Direct-bill transfer from a folio creates a
  receivables invoice (fiscal document if required) with due date.
- **FIN-R28** [MUST] Payments received (bank transfer, card) are allocated to invoices (full/partial);
  unallocated amounts remain as account credit; aging by due date (current, 1–30, 31–60, 61–90, > 90);
  statement of account on demand.
- **FIN-R29** [MUST] Credit checks at transfer: over-limit transfer requires approval (`finance.creditControl`
  enforces limits and automates reminders/dunning schedules and periodic statements; without it the limit is
  advisory with a warning).
- **FIN-R30** [MUST] Write-offs with approval and reason; bad-debt account mapping.
- **FIN-R31** [SHOULD] Agency commission accrual from agreed terms at check-out; settlement by offset against
  the agency's receivables (net invoicing) or payment; net-rate bookings invoice the agency the net amount.

### 3.8 Fiscal documents

- **FIN-R32** [MUST] Invoices, credit notes and receipts are issued from folios (or receivables accounts) into
  **series** per legal entity (and per property if configured) with **gapless** numbering; the number is
  allocated inside the issuing transaction under a series row lock; a failed transaction consumes no number;
  issuance is idempotent (retry returns the same document).
- **FIN-R33** [MUST] A document stores an immutable snapshot: issuer legal entity data, payer data, lines, tax
  summary by rule and rate, currency and FX rate (if a second currency is shown), payments applied, totals,
  references, rendering template version; PDF rendering is reproducible from the snapshot.
- **FIN-R34** [MUST] Postings included in an issued invoice are locked to it; correcting them requires a credit
  note (full or partial, referencing the invoice) and, if needed, a new invoice.
- **FIN-R35** [MUST] Live issuance is blocked while the property's tax rule pack is unverified (RAT-R26) and
  while a required fiscal adapter is not configured (country pack metadata).
- **FIN-R36** [LATER] Fiscal adapters (hash chaining, signatures, QR codes, real-time submission) per country via
  `integration`, with `fiscal_submission` external-effect checks.

### 3.9 Cashier sessions and cash

- **FIN-R37** [MUST] Cashier session per user per property (at most one open): opening float per currency,
  every cash payment/refund/paid-out/currency exchange attributed to it; blind close count per currency;
  variance computed and posted to over/short; card totals listed for reconciliation against terminal batches.
- **FIN-R38** [MUST] Paid-outs (cash advances to guests, petty payments on behalf of guests) require
  `finance.cashier.paidOut` ⚑, post a charge to the guest folio and a cash credit.
- **FIN-R39** [MUST] Policy `finance.cashier.closeBeforeDayClose` (default warn) feeds Day Close exceptions.

### 3.10 Multi-currency

- **FIN-R40** [MUST] Exchange rates per legal entity per business date per currency pair with source (manual
  entry, provider feed [SHOULD]), optional buy/sell spread for cash exchange; every converted amount stores the
  rate id used.
- **FIN-R41** [MUST] Folio currency is fixed at open; postings in another currency convert at the posting's
  business-date rate with both amounts stored; payments in another currency (e.g. MVR cash on a USD folio)
  credit the folio converted amount; settlement differences (provider settles a different functional amount)
  post to FX gains/losses at reconciliation.

### 3.11 Reports, close and exports

- **FIN-R42** [MUST] Real-time trial balance; guest ledger, deposits ledger and receivables ledger with
  drill-down to postings; daily revenue by charge code/department; tax report by rule, rate and period (with
  MVR conversion for Maldives returns pending Q41); cashier report; folio balance list; allowance/breakage
  report. Every figure shows definition, period, currency treatment and source (brief §13).
- **FIN-R43** [MUST] **Period close** (`finance.period.close` ⚑): locks an accounting period for export; later
  corrections relating to it are labelled restatements in exports and reports, with a restatement register.
- **FIN-R44** [MUST] `getUnbalancedItems(propertyId, businessDate)` and `listExceptions` for Day Close:
  departed stays with non-zero balance, folios with payments pending verification (from payments), open cashier
  sessions, suspense postings, over-limit receivables transfers awaiting approval, invoices blocked from
  issuance, breakage pending, negative deposit balances (must never happen — integrity alarm).
- **FIN-R45** [MUST] Integrity checks (continuous + Day Close): trial balance balanced; Σ folio balances = guest
  ledger control account; deposits ledger = Σ booking deposit sub-accounts; receivables control = Σ accounts.

## 4. Entities and states

### 4.1 Entities

`account(id, legal_entity_id, code, name, type, system_key?, currency?)` · `journal_entry(id, legal_entity_id,
property_id?, business_date, occurred_at, source_ref, idempotency_key UNIQUE, corrects_entry_id?,
relates_to_business_date?, reason_code?, actor)` · `journal_line(entry_id, account_id, sub_account_ref?, debit,
credit, currency, functional_amount, fx_rate_id?)` · `folio(id, property_id, legal_entity_id, owner_ref, payer_ref,
currency, label, is_default, status, reopen_count, version)` · `posting(id, folio_id, entry_id, kind, charge_code,
amount, currency, quantity?, unit_price?, service_date?, revenue_date?, description, parent_posting_id?,
allowance_instance_id?, invoice_id?, idempotency_key)` · `charge_code(...)` · `billing_rule(id, owner_ref,
destination_folio_id, selector jsonb, cap jsonb?, source, active_from, active_to?, version)` ·
`allowance_instance(id, stay_id, definition_ref, period, granted, used, status)` · `deposit_account(booking_id,
balance)` · `receivables_account(id, company_id, legal_entity_id, terms_days, credit_limit?, status)` ·
`fiscal_series(id, legal_entity_id, kind, prefix, next_number)` · `fiscal_document(id, series_id, number, kind,
snapshot jsonb, folio_id?, receivables_account_id?, issued_at, idempotency_key)` · `cashier_session(id, user_id,
property_id, opened_at, floats jsonb, counts jsonb?, variance jsonb?, status)` · `fx_rate(id, legal_entity_id,
business_date, from, to, rate, source)` · `period(legal_entity_id, start, end, status)`.

### 4.2 State machines

**Folio:** `open → settled` (balance = 0 and settlement action) · `settled → open` (reopen: late charge or
correction, `reopen_count++`, reason) · `open → voided` (only if it never had a posting) — terminal.

**Fiscal document:** `issued` (terminal for its content) · `issued → credited` (fully credited by credit note(s))
· `issued → partially_credited`. No deletion; no draft numbers (drafts are previews without numbers).

**Allowance instance:** `active → consumed` (remaining 0) · `active → closed` (period end: breakage or carry) ·
`active → cancelled` (stay cancelled/shortened before the period; allocation reversed).

**Receivables account:** `active ⇄ on_hold` (no new transfers) · `active|on_hold → closed` (zero balance).

**Cashier session:** `open → closing` (count entered) `→ closed`; `closed` is terminal; reopening is forbidden
(adjust via the next session with reason).

**Period:** `open → closed`; `closed → open` only with `finance.period.reopen` ⚑ and reason (logged).

## 5. Invariants

- **FIN-I01** Every journal entry: Σ debits = Σ credits per transaction currency and in functional currency.
- **FIN-I02** Trial balance of every legal entity sums to zero at every committed instant.
- **FIN-I03** For every folio: balance = Σ its postings = its guest-ledger sub-account balance.
- **FIN-I04** `idempotency_key` is unique per tenant; replaying a posting command returns the original ids and
  creates nothing (S06, S09, S10).
- **FIN-I05** No `UPDATE`/`DELETE` of posted amounts, accounts or dates is possible for the application role.
- **FIN-I06** For every fiscal series, issued numbers are exactly `1..next_number−1` with no gaps or duplicates.
- **FIN-I07** A posting is on at most one non-credited invoice; an invoiced posting is never moved by transfer
  or billing-rule re-application.
- **FIN-I08** Deposit balance per booking ≥ 0; deposit applications never exceed the balance.
- **FIN-I09** No posting represents an authorization; payment postings exist only via `LedgerPort` calls made
  after provider confirmation, or cash/bank entries by a cashier (finance has no "authorize" concept).
- **FIN-I10** Every posting's business date equals the property's business date at its commit.
- **FIN-I11** Allowance: `used ≤ granted` per instance; at close, `breakage + carried = granted − used`.
- **FIN-I12** Transfers net to zero across the two folios and never cross legal entities.
- **FIN-I13** For any owner, no two active billing rules match the same (charge code, service date) (Q40 default).
- **FIN-I14** Σ folio balances = guest ledger control; Σ receivables accounts = receivables control (checked by
  Day Close and in every scenario test).

## 6. Cross-module interactions

Provider contract (domain map): `openFolio`, `postCharge`, `recordPayment`, `recordRefund`, `recordDeposit`,
`applyDeposits`, `recordPayout`, `getFolioBalance`, `listFolios`, `getUnbalancedItems`. Payments calls finance
only through `LedgerPort` after provider confirmation. Depends on `platform` (legal entity, business date,
property operator at date) and `rates` (computeTaxes — proposed dependency, see below). Consumers:
`reservations`, `payments`, `day-close`, `groups`, `resort`, `integration` (exports, POS), `analytics`.

### Proposed contract changes

1. Dependency `finance ─► rates` (computeTaxes) is required by domain map text ("used by finance for non-room
   charges too") but missing from the dependency diagram — add the arrow (no cycle: rates does not call finance).
2. `postCharge` adds `relatesToBusinessDate?`, `allowanceRef?: 'auto' | Uuid`, returns
   `{ postingIds, folioId, allowanceUsage? }`.
3. New: `setBillingRules(tx, { owner, rules, reapply?: boolean, previewToken })`, `previewBillingRules(...)`.
4. New: `transferPostings(tx, { fromFolioId, toFolioId, postingIds | amount, reason, idempotencyKey })`.
5. New: `adjustPosting(tx, { postingId, amount?, reasonCode, note, idempotencyKey })`.
6. New: `issueDocument(tx, { folioId | receivablesAccountId, kind, idempotencyKey })`, `issueCreditNote(...)`.
7. New: `settleToReceivables(tx, { folioId, receivablesAccountId, idempotencyKey })`.
8. New: `closeAllowancePeriod(tx, { stayId, night })` (Day Close) and `listExceptions` (common shape).
9. `recordPayment` adds `currency` and `fxRateId?` for cross-currency payments; `recordPayout` unchanged.

## 7. Events

Emitted (domain map): `finance.posting.created`, `finance.folio.settled`, `finance.invoice.issued`. Proposed:
`finance.posting.adjusted`, `finance.postings.transferred`, `finance.folio.reopened {reason}`,
`finance.creditNote.issued`, `finance.cashierSession.closed {variance}`, `finance.allowance.breakagePosted`,
`finance.receivables.overLimitRequested`, `finance.period.closed`, `finance.integrity.alarm`.
Consumed: `reservations.stay.checkedOut` (close per-stay allowance periods; settle checks),
`reservations.booking.cancelled` (deposit outcome tasks), `guests.profile.merged|unmerged` (payer refs).

## 8. Permissions

`finance.folio.read` · `finance.folio.manage` · `finance.posting.create` · `finance.posting.correct` ⚑ ·
`finance.posting.transfer` · `finance.posting.restrictedCodes` ⚑ · `finance.billingRule.manage` ·
`finance.folio.settleToReceivables` · `finance.folio.writeOff` ⚑ · `finance.receivables.read` ·
`finance.receivables.manage` ⚑ · `finance.creditLimit.override` ⚑ · `finance.document.issue` ·
`finance.creditNote.issue` ⚑ · `finance.cashier.operate` · `finance.cashier.paidOut` ⚑ ·
`finance.cashier.review` · `finance.fx.manage` ⚑ · `finance.chargeCode.manage` ⚑ · `finance.ledger.read` ·
`finance.period.close` ⚑ · `finance.period.reopen` ⚑ · `finance.report.read` · `finance.export.run` ⚑.

## 9. UX surfaces

- **Folio workspace** (inside stay/booking/group records): folios side by side, labelled by **payer name**
  ("Maldivian Holidays Ltd — accommodation", "Mr Ivanov — incidentals"), never by number; balances; postings
  grouped by date and package; pending items (pending-verification payments with trust marker); actions: post,
  adjust, transfer (drag postings between folios → preview), settle, issue document.
- **Who-pays-for-what panel**: billing rules in plain language with projected totals per folio.
- **Cashier session panel**: open/close with blind count, variance explanation.
- **Receivables**: accounts list with aging, account page with invoices/payments/allocations/statement.
- **Finance dashboard**: trial balance status, exceptions, integrity checks with last-run time.
- **Reports** with definitions, drill-down and restatement notes.

## 10. Proof scenarios and evidence

| ID | Finance must demonstrate |
|---|---|
| S04 | Billing rules: company folio receives room + room taxes; occupants' folios receive incidentals; previews match postings; company folio settled to receivables at checkout; invoices per payer. |
| S05 | A payment confirmed later by reconciliation creates exactly one payment posting (no posting while pending). |
| S06 / E06 | Retried refund: one refund posting; original payment posting unchanged; folio shows both. |
| S09 / E07 | Day Close interrupted after some room postings: re-run posts only missing nights (idempotency keys); trial balance balanced throughout. |
| S10 | Late restaurant charge after checkout: folio reopened or supplementary folio (if invoiced), collection follow-up, guest ledger correct. |
| S18 / E12 | Imported deposits vs prior-system closing balance: import posts opening balances through a migration suspense account; reconciliation report shows the difference by booking; nothing balances silently. |
| S19 | Package + allowance + breakage + TGST/service charge/Green Tax + partial payments: folio, tax report and ledger reconcile to the minor unit. |
| E08 | Postings after a tax rule change use the version effective on the service date; earlier postings unchanged; restatement section empty unless corrections made. |
| E15 | Wrong posting corrected by linked adjustment; reports for the original date show the restatement note. |

## 11. Maldives specifics

- Typical setup: folio currency USD; cash drawers in USD and MVR; FX rate per business date entered by finance
  (source noted); MVR cash payments convert into USD folios with rate shown on the receipt.
- Taxes payable accounts: TGST, Green Tax; service charge account mapping configurable (payable to staff fund
  vs revenue) pending Q41. Tax report must support MVR presentation for MIRA returns (rate source pending Q41).
- Receivables are heavily used: tour operators/DMCs settle by bank transfer against agency invoices; net-rate
  invoicing is normal.
- Resorts usually run a separate accounting system; daily/periodic journal export by account mapping is a MUST
  for adoption (format via `integration`).
- MIRA invoice content and numbering requirements unverified (Q41) → live issuance blocked until verified.

## 12. Competitive inspirations

- Real-time double-entry ledger with receivable sub-accounts per reservation, deposit liabilities, AR transfer,
  business date vs posting date, integrity reports for non-zero balances — Apaleo (research 02 §3.3.6, §8 item 1).
- OPERA folio windows/routing with limits and defaults, generates, AR direct-bill review queue, package P&L —
  matched in capability, renamed and simplified (research 01 §3.6–3.9). "Billing parties labelled by payer, not
  by number" (research 01 §7, §9 item 3).
- Split by percentage and routing templates — Agilysys Stay (research 01 §6.5). **Legal caution:** Agilysys
  patent application US 2017/0124610 on ranked rule-based folio routing — FIN-R14 deliberately avoids ranked
  precedence until counsel reviews it (Q40). No legal conclusion is drawn here.
- Mews customer-owned bills generalize to non-stay commerce (research 02 §2.3–2.4) → folios may be owned by
  company/house; late-outlet and over/short reconciliation pain (research 02 §2.6) → cashier sessions + Day Close
  exceptions.
- Fiscal numbering gapless and idempotent (research 04 §B7 item 6, §C3).

## 13. Open questions

Q40 (billing-rule precedence), Q41 (Maldives tax/invoice specifics, service charge treatment), Q42 (tax point),
Q44 (retention of fiscal records).

## 14. Adoption modes

- **Standalone alongside an external PMS:** partially:
  - **Accounting bridge** — when Portico is authoritative for `charges` but the hotel's ERP is authoritative for
    `accounting`, finance produces journals/exports and never posts to the ERP's ledger directly.
  - **Payment clearing ledger** — when `charges` are external but Portico processes payments (payment links,
    terminals), finance keeps a minimal ledger of card clearing, fees and payouts so payouts reconcile, and the
    payment itself is forwarded to the external folio.
  - Full folios, billing rules, receivables and fiscal documents require `charges` authority = Portico.
- **Hard dependencies:** `platform`, `identity`, `rates` (tax engine); `reservations` for stay folios;
  `integration` for exports and forwarding.
- **Connected mode** (`charges` external): Portico-originated charges (outlet, transfer, activity, minibar
  postings from Portico modules) call `assertWritable(charges)` and are **forwarded** to the external folio with a
  deterministic idempotency key (e.g. `pos:{outletId}:{checkId}:{lineId}`) and shown pending until acknowledged;
  rejected forwards become integration exceptions with the business impact ("charge not on guest bill").
  Folio balances shown in Portico are mirrored (`external`) where the connector supports reading them.
- **Data-authority domains:** owns `charges` and (unless an ERP is designated) `accounting`; respects `payments`.
- **Trial:** copied open balances, deposits and receivables are reconciled against the source system's reports;
  every difference becomes a listed discrepancy with an owner (S18 pattern), never an automatic adjustment.
