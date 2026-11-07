# Spec: payments

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `payments` · Prefix `PAY`

## 1. Purpose

Payments moves guest money **through the hotel's own merchant account** (decision D2: the hotel legal entity is
merchant of record; Monoclay never holds guest funds) and tells the truth about every attempt: authorized is not
paid, submitted is not paid, a timeout is *pending verification*, and a retry never charges twice. It turns the
rate plan's payment schedule into one clear collection plan per booking with a single owner for each collection,
so automation and staff never double-charge a guest.

## 2. Scope and non-goals

**In scope:** payment accounts per legal entity and provider, provider adapters (simulator, Stripe Connect direct
charges, local acquirer adapters, manual/external-terminal recording, cash, bank transfer), payment methods
(tokens only), OTA virtual cards (metadata + scheduled charging), authorizations (incl. incremental and expiry),
captures, charges, refunds, disputes and evidence packs, payment requests (links), collection plans and payment
automation, provider webhooks, pending-verification resolution, payouts and reconciliation, provider health.

**Non-goals:** ledger postings (`finance` via `LedgerPort`, only after provider confirmation); cash drawers
(`finance` cashier sessions — payments records the cash payment, finance attributes it to the session); raw card
data (never — OTA card data goes through a PCI proxy/vault in `integration`/`distribution`); Monoclay's SaaS
billing (`billing`, separate Stripe account — architecture rule 14).

## 3. Capabilities

### 3.1 Accounts and providers

- **PAY-R01** [MUST] Payment account: legal entity, provider, provider account reference, capabilities (as
  declared by the adapter), currencies, statement descriptor, status (`onboarding | active | restricted |
  suspended | closed`), environment (live/sandbox/simulated). One legal entity may have several accounts
  (e.g. online acquirer + local terminal acquirer).
- **PAY-R02** [MUST] Provider adapter port with declared capabilities: `hostedCardEntry`, `authorize`,
  `incrementalAuthorize`, `capture`, `partialCapture`, `release`, `charge` (CIT/MIT), `refund`, `partialRefund`,
  `paymentLinks`, `terminals`, `webhooks`, `payoutReports`, `disputes`, `networkTokens`. The UI offers only
  actions the account's adapter supports.
- **PAY-R03** [MUST] Adapters shipped: **simulator** (full capability set, deterministic failure injection:
  decline, timeout-then-success, timeout-then-failure, duplicate webhook, out-of-order webhook, provider outage);
  **Stripe Connect** with *direct charges* on the connected account (`losses.payments = stripe`, research 04 §B2),
  sandbox-tested; **manual / external terminal** (record-only: staff records an approval code and amount from a
  standalone terminal; provenance `external`, "not verified with provider" until matched to a batch report);
  **cash**; **bank transfer**. Local Maldivian acquirer adapters are R1 (planned, unverified — Q2).
- **PAY-R04** [MUST] Every provider call is gated by `assertExternalEffectAllowed(ctx, 'payment.charge')`
  (simulate in demo/trial/training, sandbox in sandbox) and executed **outside** the DB transaction using a
  persisted provider operation (ADR-0007): the operation row with its idempotency key is committed **before** the
  call; the result is recorded after; retries reuse the key.

### 3.2 Payment methods and virtual cards

- **PAY-R05** [MUST] Payment method = provider token + brand, last 4, expiry, funding type, holder name,
  network transaction id (for MIT), owner (profile/company), consent/mandate evidence (terms version, timestamp,
  channel, 3DS result). Portico never stores PAN or CVC; the database has no column able to hold them.
- **PAY-R06** [MUST] Hosted card entry only (PSP iframe/components) on Portico-served pages, with CSP/SRI and
  script inventory on payment pages so hotels can aim for SAQ A (research 04 §C2).
- **PAY-R07** [MUST] **Virtual cards (VCC)**: token (via PCI proxy) + metadata separate from the token:
  issuing channel, amount, currency, activation date (per reservation, not a global rule), expiry; the collection
  plan schedules a charge of exactly the VCC amount at activation in property local time, retries with backoff on
  funding delay (research 04 §B6: funds may arrive days after activation), and raises a task on final failure.
- **PAY-R08** [SHOULD] Card-on-file reuse across stays only where the provider token and mandate permit;
  token portability is never promised (readiness §8).

### 3.3 Authorizations, charges, captures

- **PAY-R09** [MUST] `authorize` (pre-authorization) creates an authorization with scheme-specific expiry
  (configuration data per scheme, e.g. lodging extended authorizations up to 30 days where eligible — research 04
  §B6; never hard-coded); `incrementalAuthorize`; `capture` (full/partial, multiple partial captures where
  supported); `release`. An authorization **never** creates a finance posting.
- **PAY-R10** [MUST] Before expiry, policy `payments.authorization.renewBeforeDays` (default 2) creates a renewal
  task or automatic re-authorization (if supported and mandated); expired authorizations are shown as expired,
  not as a guarantee.
- **PAY-R11** [MUST] `charge` with `initiator: 'customer' | 'merchant'`; merchant-initiated charges (no-show,
  post-departure, scheduled deposit) reference the stored mandate and network transaction id and are allowed only
  if the agreed terms (snapshot) disclosed them.
- **PAY-R12** [MUST] Outcomes: `succeeded`, `failed` (with decline category and plain-language reason and
  recovery: "Card declined — insufficient funds. Ask for another card or send a payment link."),
  `requires_action` (3DS), `pending_verification` (timeout, 5xx, network error, ambiguous response).

### 3.4 Pending verification and reconciliation

- **PAY-R13** [MUST] `pending_verification` is a first-class state: the folio shows the amount as *pending
  verification* (never paid, never failed); no finance posting exists; a resolver queries the provider by
  idempotency key/provider reference on a backoff schedule (10 s, 30 s, 2 min, 10 min, 1 h, then every 6 h) and
  webhooks resolve it immediately. Resolution → `succeeded` (finance posting via LedgerPort with the operation's
  key) or `failed`.
- **PAY-R14** [MUST] While an operation is pending verification, a new charge for the same collection item is
  blocked with an explanation ("A charge of USD 840.00 started 14:02 is still being verified. Check status or
  wait — charging again could double-charge the guest."); the user may *check now*.
- **PAY-R15** [MUST] Webhooks: signature verification, dedupe by provider event id, out-of-order tolerant
  (fetch latest object state rather than trusting order), stored raw (no card data) for audit.
- **PAY-R16** [MUST] Daily reconciliation of provider balance transactions (captures, refunds, fees, disputes,
  payouts) against payments records and the finance ledger; mismatches become exceptions with owner.

### 3.5 Refunds and disputes

- **PAY-R17** [MUST] `refund(paymentId, amount, reason, idempotencyKey)`: amount ≤ captured − refunded − in-flight
  refunds; approval above policy threshold (identity approvals); state machine §4; a retried request with the same
  key returns the same refund (S06); finance records the refund as a new linked posting; the original payment
  is never altered.
- **PAY-R18** [MUST] Disputes from webhooks: dispute record linked to payment, stay and folio; deadline;
  evidence pack export (agreed terms snapshot with policy acceptance evidence, registration card, 3DS result,
  folio itemization, communications, check-in/out log); task to finance with due date; dispute fund movements
  recorded in finance (`recordDisputeMovement`, proposed).

### 3.6 Payment requests and collection plans

- **PAY-R19** [MUST] Payment request (link): legal entity, payer, amount (fixed or "balance due"), purpose
  (`deposit`, `balance`, `incidentals_preauth`, `custom`), references (booking/folio), expiry, allowed methods,
  partial/instalment allowed flag, language; delivered via comms (guest-facing message = `message.guest` effect);
  status `paid` only on provider confirmation.
- **PAY-R20** [MUST] **Collection plan** per booking, instantiated from the agreed payment schedule (rates
  RAT-R20): items with due date/time, amount, method expectation, **executor** (`automation` | `staff` |
  `channel` (prepaid OTA) | `agency_invoice`) and state. Exactly one executor per item; any collection (automatic
  charge, staff charge, payment link payment, cash, bank transfer, VCC charge) must *satisfy* an item or be
  recorded as unscheduled; satisfying an item under a row lock prevents a second executor from collecting it
  (fixes double-charge risk between links and automation — research 02 §2.5).
- **PAY-R21** [MUST] Booking changes replace the collection plan through a previewed diff (items added,
  re-amounted, cancelled); satisfied items are never removed; over-collection creates a refund-or-credit task.
- **PAY-R22** [MUST] Automation policies per property: pre-authorize card on file at T−n days or at check-in;
  charge deposit on due date; charge VCC at activation; send payment request at T−n days for bank-transfer
  guests; reminders; on failure: task + notification to the owner role (never silent), no automatic retry with a
  different card unless policy enables it.

### 3.7 Cash, bank transfers, external terminals

- **PAY-R23** [MUST] Cash payments are confirmed at entry by the cashier (finance attributes to the open cashier
  session); bank transfers are recorded as `awaiting_receipt` until a staff member confirms receipt with the bank
  reference (or a bank-feed integration LATER) — only then `succeeded`.
- **PAY-R24** [MUST] External-terminal records carry approval code, terminal id, amount, card brand/last 4
  (optional), provenance `external`; they are matched to terminal batch reports at reconciliation; unmatched
  after N days → exception.

### 3.8 Payouts and provider health

- **PAY-R25** [MUST] Payouts from provider reports/webhooks: gross, fees, disputes, reserves, net, currency,
  arrival date, constituent transactions; `finance.recordPayout` (a payout is never revenue); reconciliation
  report per payout.
- **PAY-R26** [MUST] Provider health per account (last successful call, error rate, webhook lag, account status
  e.g. restricted/suspended by provider); degraded/suspended states trigger a banner with safe alternatives
  (payment link later, cash, external terminal, record guarantee as pending) and pause automation; on recovery,
  queued automated collections are **re-validated** (item still due? guest still in house? not already
  satisfied?) before executing — never blindly replayed (adoption brief §8; E13, S20).

## 4. Entities and states

`payment_account(id, legal_entity_id, provider, ref, capabilities, status, mode)` · `payment_method(id,
account_id, token, brand, last4, exp, network_txn_id?, owner_ref, mandate jsonb, status)` · `vcc(method_id,
channel, amount, currency, activation_date, expiry)` · `provider_operation(id, account_id, kind, idempotency_key
UNIQUE, request_hash, status, provider_ref?, response jsonb?, attempts, next_check_at?)` · `payment(id, kind
charge|capture|cash|bank_transfer|external_terminal, amount, currency, status, method_id?, ref, collection_item_id?,
operation_id?, provenance)` · `authorization(id, method_id, amount, captured, status, expires_at)` · `refund(id,
payment_id, amount, status, reason, operation_id)` · `dispute(id, payment_id, status, reason, amount, deadline)` ·
`payment_request(id, legal_entity_id, payer_ref, amount, purpose, ref, status, expires_at, provider_link_ref)` ·
`collection_plan(booking_id, version)` · `collection_item(id, plan_id, due_at, amount, method_expectation,
executor, status)` · `payout(id, account_id, gross, fees, net, currency, arrival_date, status)` ·
`webhook_event(provider_event_id UNIQUE, account_id, type, received_at, processed_at)`.

**Payment (charge/capture):** `created → sent → succeeded | failed | requires_action | pending_verification` ·
`requires_action → succeeded | failed | expired` · `pending_verification → succeeded | failed` (by resolver or
webhook only). Terminal: `succeeded`, `failed`, `expired`. A succeeded payment may later have refunds/disputes
(separate records).

**Authorization:** `pending_verification → authorized | failed` · `authorized → partially_captured → captured` ·
`authorized|partially_captured → released | expired` · `authorized → authorized` (increment, new expiry).

**Refund:** `requested → (approval_required → approved | declined) → sent → succeeded | failed |
pending_verification` · `pending_verification → succeeded | failed`.

**Dispute:** `opened → evidence_required → evidence_submitted → won | lost` · `opened → accepted` (hotel accepts).

**Payment request:** `created → sent → partially_paid → paid` · `created|sent|partially_paid → expired | cancelled`.
`paid` only from provider-confirmed payments summing to the amount.

**Collection item:** `scheduled → due → in_progress → satisfied | failed` · `failed → due` (retry by executor) ·
`scheduled|due|failed → waived` (permission, reason) · `scheduled|due → superseded` (plan replaced).
`in_progress` holds while an operation is `sent` or `pending_verification`.

**Bank transfer:** `awaiting_receipt → succeeded` (receipt confirmed) | `cancelled`.

## 5. Invariants

- **PAY-I01** No finance posting exists for an authorization, a payment request, a `sent` or
  `pending_verification` operation; exactly one posting exists for each `succeeded` payment/refund (S05, S06).
- **PAY-I02** `provider_operation.idempotency_key` is unique; a retry of the same logical operation reuses the key
  and never creates a second provider-side charge or refund.
- **PAY-I03** Σ refunds (succeeded + in-flight) ≤ captured amount of the payment.
- **PAY-I04** A collection item is satisfied by at most one payment (or an explicit set summing to its amount);
  two executors can never both collect the same item.
- **PAY-I05** No column, log line, event payload, AI context or export contains a PAN or CVC (static schema check +
  log redaction test).
- **PAY-I06** In non-live environments no provider call runs in live mode (environment tests).
- **PAY-I07** A webhook event id is processed at most once.
- **PAY-I08** Payments, refunds, payouts and fees reconcile with the provider's balance transactions; any
  difference is an open exception (daily check).
- **PAY-I09** Automated collections paused by a provider outage are re-validated before execution after recovery.

## 6. Cross-module interactions

Provider contract (domain map): `createPaymentRequest`, `authorize`, `capture`, `charge`, `refund`,
`getPaymentStatus`, `listUnresolved`. Calls `finance` through `LedgerPort` (`recordPayment`, `recordRefund`,
`recordDeposit`, `recordPayout`) only after confirmation; `platform` (legal entity, policies, data authority);
`comms` (payment request delivery, failure notifications — via events); `integration` (PCI proxy for OTA cards;
forwarding payments to an external folio in connected mode). Consumers: `reservations` (guarantee step,
collection plans, no-show charges), `finance` (settlement UI), `day-close`, `distribution` (VCC metadata),
`resort`, `analytics`.

### Proposed contract changes

1. New `createCollectionPlan(tx, { bookingId, items })`, `replaceCollectionPlan(tx, { bookingId, items,
   previewToken })`, `satisfyCollectionItem(tx, { itemId, paymentId })`, `waiveCollectionItem(...)`.
2. New `recordCashPayment`, `recordBankTransfer`, `confirmBankTransfer`, `recordExternalTerminalPayment`.
3. New `registerVirtualCard(tx, { methodToken, channel, amount, currency, activationDate, expiry, bookingId })`.
4. New `incrementAuthorization`, `releaseAuthorization`, `getEvidencePack(tx, { disputeId })`.
5. `LedgerPort` adds `recordDisputeMovement(tx, { paymentRef, amount, kind: 'debit'|'reversal' })`.
6. Domain map should list payments events (below).

## 7. Events

Proposed (domain map lists none): `payments.payment.succeeded|failed|pendingVerification|resolved`,
`payments.authorization.created|expiring|expired|released`, `payments.refund.succeeded|failed`,
`payments.dispute.opened|closed`, `payments.payout.received`, `payments.request.paid|expired`,
`payments.collectionItem.failed|satisfied`, `payments.provider.degraded|restored|suspended`.
Consumed: `reservations.booking.confirmed|modified|cancelled` (plan lifecycle), `reservations.stay.checkedIn`
(pre-auth policy), `reservations.stay.noShow` (no-show charge item), `platform.dataAuthority.changed`
(`payments` authority).

## 8. Permissions

Implemented in role templates: `payments.payment.read` · `payments.payment.collect` ·
`payments.paymentRequest.create`. Proposed: `payments.method.read` · `payments.method.manage` ·
`payments.vcc.read` ⚑ · `payments.authorization.capture` · `payments.authorization.release` ·
`payments.refund.create` ⚑ · `payments.refund.approve` ⚑ · `payments.dispute.manage` ⚑ ·
`payments.collectionPlan.manage` · `payments.collectionPlan.waive` ⚑ · `payments.externalRecord.create` ·
`payments.bankTransfer.confirm` ⚑ · `payments.reconciliation.resolve` ⚑ · `payments.account.manage` ⚑ (org).

## 9. UX surfaces

- **Collect panel** (in check-in, folio, booking): suggested action from the collection plan ("Deposit 30% due
  today — USD 1,260.00"), method choice limited to adapter capabilities, outcome shown with the exact state and
  recovery text; pending verification shows a spinner-free status chip with "Check now".
- **Collection plan view** on bookings: items with executor, due date, state; who/what will collect next.
- **Payments & payouts** page: unresolved (pending verification, failed automation, disputes with deadlines),
  payouts with reconciliation status, provider health card per account.
- **Payment request composer** (amount, purpose, expiry, language, preview of the guest message).
- Simulated/sandbox results always carry the provenance badge.

## 10. Proof scenarios and evidence

| ID | Payments must demonstrate |
|---|---|
| S05 / E05 | Timeout on charge → `pending_verification`; folio shows pending; second charge blocked; resolver finds `succeeded` → exactly one posting; check-in step resumes as done. Also timeout → actually failed. |
| S06 / E06 | Refund interrupted after the provider accepted it; retry with same key returns the same refund; duplicate and out-of-order webhooks processed once; one refund posting. |
| S19 | Partial payments (deposit by link, card at check-in, MVR cash at checkout) satisfy collection items; balance exact. |
| S20 / E13 | Provider outage/suspension during peak: banner, alternatives, automation paused; on recovery queued items re-validated; nothing charged twice. |
| S10 (supporting) | Post-departure charge collected by MIT only when terms allowed; otherwise payment request. |
| E14 (supporting) | Payments are never blocked by usage caps. |

## 11. Maldives specifics

- Stripe availability for Maldivian legal entities is unverified and believed unavailable (Q2): for Maldives
  pilots the realistic options are local acquirers/gateways (adapters planned, unverified) and **record-only
  external terminals**, which therefore must be excellent (PAY-R24).
- Resorts price and charge in USD; guests and staff also pay cash in USD and MVR (finance FX).
- Tour operators/DMCs pay by bank transfer against invoices (finance receivables) — bank-transfer confirmation
  workflow matters for guesthouses.
- OTA virtual cards (prepaid OTA bookings) are common for resorts; activation-date handling per reservation.
- Connectivity on islands can drop: payment UIs must surface pending verification rather than encourage retries.

## 12. Competitive inspirations

- Rate-group payment automation, VCC detection/timing, pay-by-link with partial payments — Mews (research 02
  §2.3, §2.5); their pain (silent VCC failures, no rescheduling, double-charge risk between links and automation,
  opaque fees) drives PAY-R20/R22 (research 02 §2.8 item 4).
- Payment schedules at rate or payer level — RMS (research 03 §7.3); optional, fair payments (automation as the
  reward, not lock-in) — RMS vs RoomRaccoon (research 03 §5.3, §10).
- Token-first, PSP-agnostic gateway, OPERA OPI pattern (research 01 §2.4, §9 item 13; research 04 §B5).
- Stripe direct charges keep disputes on the hotel's balance; idempotency semantics (research 04 §B2, §B7).

## 13. Open questions

Q2 (Maldives payment processing). Product decisions: resolver backoff schedule; authorization renewal default
2 days before expiry; no automatic retry with a different card by default.

## 14. Adoption modes

- **Standalone alongside an external PMS:** yes — payment links, VCC charging and terminal/external-terminal
  collection for reservations held in another PMS ("replace selected capabilities").
- **Hard dependencies:** `platform`, `identity`, `finance` (payment clearing ledger, payouts); `reservations`
  mirror for booking context; `integration` to forward payments to the external folio.
- **Connected mode:**
  - `payments` authority = Portico, `charges` external: Portico collects; each succeeded payment is **forwarded**
    to the external folio (idempotent key = provider operation key) and shown pending until acknowledged; a
    rejected forward is an urgent integration exception ("guest paid but bill not updated").
  - `payments` authority external (the PMS's own payment integration): Portico payment actions are disabled;
    payment status may be mirrored read-only (`external`) for messaging and analytics.
- **Data-authority domains:** owns `payments` when authoritative; respects `charges` (never posts to an external
  folio except by forwarding).
- **Trial:** `payment.charge` is simulated; copied payments carry `copied`; trial reconciliation compares copied
  deposits with the source system's deposit ledger.
