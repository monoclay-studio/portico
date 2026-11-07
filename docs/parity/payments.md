# Parity: payments

Module: `payments` (payment accounts, provider adapters, payment methods, VCC, authorizations, captures, refunds,
disputes, payment requests, collection plans, payouts, reconciliation) · Spec: `docs/specs/payments.md`.

**Baseline.** OPERA Cloud 26.2 cashiering/credit-card topics, Mews Payments (help centre + Connector API), Apaleo
Pay and Finance API, Stripe documentation for scheme mechanics. Evidence links at the end; **all verified
2026-11-07**. Nothing in `payments` is built on `main`; statuses are `specified`/`missing`/`deferred`/`different`.

## Capabilities

### Accounts, providers and adapters

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-001 | Hotel legal entity is merchant of record on its own payment account | Stripe [direct charges][st-direct] · Mews [payments][mw-review-payments] | P0 | specified | payments.md PAY-R01; decisions D2 | — |
| PAR-PAY-002 | Several payment accounts per legal entity (online acquirer + terminal acquirer) | Apaleo [payments by terminal / by link][ap-fin] | P1 | specified | payments.md PAY-R01 | — |
| PAR-PAY-003 | Provider-agnostic adapter port with declared capabilities; UI offers only supported actions | assumption (OPERA OPI pattern, research 04 §B5) | P0 | specified | payments.md PAY-R02 | — |
| PAR-PAY-004 | Full-capability simulator with failure injection for demo/training | assumption | P0 | specified | payments.md PAY-R03 | — |
| PAR-PAY-005 | Record-only external terminal payments (approval code, terminal id) matched to batch reports | assumption (Maldives Route D, Q2) | P0 | specified | payments.md PAY-R03, PAY-R24 | — |
| PAR-PAY-006 | Local Maldivian acquirer/gateway adapter | assumption (Q2) | P0 | deferred | payments.md PAY-R03 — R1 pending Q2 vendor choice | — |
| PAR-PAY-007 | Integrated card-present terminals (tap/insert, tip on terminal, token for later MIT) | Stripe [Terminal][st-terminal] · Mews [terminal setup][mw-terminal] · Apaleo [payment by terminal][ap-fin] | P1 | specified | payments.md PAY-R02 (`terminals` capability) | — |
| PAR-PAY-008 | Provider account health (restricted/suspended) with banner and safe alternatives | assumption (research 02 §2.5 pain) | P0 | specified | payments.md PAY-R26 | — |
| PAR-PAY-009 | Environment safety: no live provider call in demo/trial/training | assumption (architecture rule 12) | P0 | specified | payments.md PAY-R04, PAY-I06 | — |
| PAR-PAY-010 | Payment method configuration per property (cash, card types, bank transfer, vouchers) with accounting mapping | OPERA [payment methods][op-paymethods] · [credit card types][op-cc-types] · Mews [accounting configuration][mw-acct-config] | P0 | specified | finance.md FIN-R12 (payment codes) | — |

### Payment methods, tokens and virtual cards

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-020 | Tokenized card on file; no PAN/CVC storage anywhere | Apaleo [payment accounts][ap-payacct] · Mews [credit cards API][mw-cards-api] | P0 | specified | payments.md PAY-R05, PAY-I05 | — |
| PAR-PAY-021 | Hosted card entry (PSP components) on Portico pages | Stripe [save and reuse][st-save] | P0 | specified | payments.md PAY-R06 | — |
| PAR-PAY-022 | Mandate/consent evidence stored with the token (terms version, 3DS result, network transaction id) | Stripe [3D Secure][st-3ds] · [save and reuse][st-save] | P0 | specified | payments.md PAY-R05 | — |
| PAR-PAY-023 | Card wallet on the guest profile reused across stays (where token/mandate allows) | OPERA [credit card wallet][op-wallet] · Apaleo [reuse payment method][ap-payacct] | P1 | specified | payments.md PAY-R08 | — |
| PAR-PAY-024 | Copy a card from one reservation to related reservations | OPERA [copy credit card][op-cc-copy] | P2 | missing | — | — |
| PAR-PAY-025 | OTA virtual card metadata (activation date, amount, currency, expiry) separate from token | Mews [VCC charging][mw-vcc] | P0 | specified | payments.md PAY-R07 | — |
| PAR-PAY-026 | VCC charged automatically at activation for exactly its amount, retries for funding delay, task on final failure | Mews [VCC charging][mw-vcc] | P0 | specified | payments.md PAY-R07 | — |
| PAR-PAY-027 | OTA hotel-collect card data routed through PCI proxy to tokens | assumption (research 04 §B6) | P0 | specified | payments.md §2 (PCI proxy in integration) | — |
| PAR-PAY-028 | Card expiry/replacement handling (ask guest for new card via link) | assumption | P1 | missing | — | — |

### Authorizations, captures and charges

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-030 | Pre-authorization at check-in or T−n days; never shown as a payment | OPERA [authorization rules][op-auth-rules] · Apaleo [authorizations][ap-auth] · Mews [preauthorization policy][mw-preauth-policy] | P0 | specified | payments.md PAY-R09, PAY-R22 | — |
| PAR-PAY-031 | Authorization rules estimating expected spend (room + incidentals per night) | OPERA [authorization rules][op-auth-rules] | P1 | missing | — | — |
| PAR-PAY-032 | Incremental authorization as charges approach the authorized amount (incl. nightly batch) | OPERA [batch authorizations][op-batch-auth] · Stripe [incremental][st-incr] | P1 | specified | payments.md PAY-R09 | — |
| PAR-PAY-033 | Scheme-specific authorization expiry (extended lodging authorizations) with renewal before expiry | Stripe [extended authorization][st-ext-auth] · Apaleo [28-day holds][ap-auth] | P0 | specified | payments.md PAY-R09, PAY-R10 | — |
| PAR-PAY-034 | Capture full or partial; multiple partial captures | Stripe [multicapture][st-multicapture] · Apaleo [payment by authorization][ap-fin] | P0 | specified | payments.md PAY-R09 | — |
| PAR-PAY-035 | Over-capture (capture above authorized amount where scheme permits) | Stripe [overcapture][st-overcapture] | P2 | missing | — | — |
| PAR-PAY-036 | Release unused authorization at checkout; authorization reversal on payment-method change | OPERA [authorization reversals][op-auth-reversal] | P0 | specified | payments.md PAY-R09 (`release`) | — |
| PAR-PAY-037 | Customer-initiated and merchant-initiated charges (no-show, post-departure, scheduled) referencing mandate | Stripe [save and reuse][st-save] | P0 | specified | payments.md PAY-R11 | — |
| PAR-PAY-038 | Plain-language decline reasons with recovery actions | assumption | P0 | specified | payments.md PAY-R12 | — |
| PAR-PAY-039 | 3DS/SCA challenge handling (`requires_action`) for guest-present flows | Stripe [3D Secure][st-3ds] | P1 | specified | payments.md PAY-R12 | — |
| PAR-PAY-040 | Back-to-back stays sharing an authorization | OPERA [back to back authorization examples][op-b2b-auth] | P2 | missing | — | — |
| PAR-PAY-041 | Credit-limit overage auto-charge when folio balance passes card limit | OPERA [credit limit overage][op-cl-overage] | P1 | missing | — | — |
| PAR-PAY-042 | MOTO (mail/telephone order) card payments | Simphony [MOTO][sim-moto] | P2 | missing | — | — |
| PAR-PAY-043 | Card surcharges per card type passed to guest where legal | OPERA [card payments with surcharges][op-postings] | P2 | missing | — | — |
| PAR-PAY-044 | Dynamic currency conversion offered at terminal | assumption (acquirer feature) | P2 | missing | — | — |

### Pending verification, webhooks and reconciliation

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-050 | Timeout/ambiguous outcome shown as pending verification, resolved by provider query on backoff | Stripe [idempotent requests][st-idem] | P0 | specified | payments.md PAY-R13 | — |
| PAR-PAY-051 | Second charge for the same item blocked while one is pending | assumption (research 02 §2.5 double-charge pain) | P0 | specified | payments.md PAY-R14 | — |
| PAR-PAY-052 | Persisted provider operation with idempotency key committed before the call | Stripe [idempotent requests][st-idem] | P0 | specified | payments.md PAY-R04, PAY-I02 | — |
| PAR-PAY-053 | Webhooks verified, de-duplicated, order-tolerant, stored raw (no card data) | Stripe [webhooks][st-webhooks] | P0 | specified | payments.md PAY-R15 | — |
| PAR-PAY-054 | Manual commit/fail of a pending payment by a supervisor (with evidence) | Apaleo [payment commit/fail][ap-fin-beta] | P1 | missing | — | — |
| PAR-PAY-055 | Daily reconciliation of provider balance transactions vs payments vs ledger | Stripe [payout reconciliation][st-payout-recon] · Mews [reconcile ledgers][mw-ledger-reconcile] | P0 | specified | payments.md PAY-R16, PAY-I08 | — |
| PAR-PAY-056 | Terminal batch settlement / card settlement close-out | OPERA [credit card settlement][op-cc-settle] | P0 | specified | payments.md PAY-R24 (batch matching) | — |
| PAR-PAY-057 | Review/inspect all payments with state, fees and payout link | Mews [review payments][mw-review-payments] · [payments API][mw-payments-api] | P0 | specified | payments.md §9 Payments & payouts page | — |

### Refunds and disputes

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-060 | Refund full/partial linked to the original payment; idempotent retry | Stripe [refunds][st-refunds] · Apaleo [refund payment][ap-fin] · OPERA [post CC refund][op-postings] | P0 | specified | payments.md PAY-R17 | — |
| PAR-PAY-061 | Refund approval above threshold | assumption | P1 | specified | payments.md PAY-R17 | — |
| PAR-PAY-062 | Unlinked refund to a different card or method (with permission) | Apaleo [folio refund][ap-fin] | P1 | missing | — | — |
| PAR-PAY-063 | Refund by bank transfer (outbound) recorded and confirmed | assumption | P1 | missing | — | — |
| PAR-PAY-064 | Dispute records from provider webhooks with deadlines and finance task | Stripe [disputes][st-disputes] | P0 | specified | payments.md PAY-R18 | — |
| PAR-PAY-065 | One-click evidence pack (terms acceptance, registration card, 3DS, folio, comms, check-in/out log) | assumption (research 04 §B6) | P1 | specified | payments.md PAY-R18 | — |
| PAR-PAY-066 | Dispute fund movements recorded in the ledger | Stripe [disputes][st-disputes] | P0 | specified | payments.md PAY-R18 (`recordDisputeMovement`) | — |

### Payment requests and automation

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-070 | Payment links (deposit, balance, custom) with expiry, language, partial payments | Mews [payment requests API][mw-payreq-api] · Apaleo [payment by link][ap-fin] · Stripe [payment links][st-paylinks] | P0 | specified | payments.md PAY-R19 | — |
| PAR-PAY-071 | Cancel a pending payment link | Apaleo [cancel link][ap-fin] | P0 | specified | payments.md §4 (`cancelled`) | — |
| PAR-PAY-072 | Payment policies per rate group/plan: automatic or manual, preauth or charge, timing | Mews [payment policies][mw-paypolicy] · [multiple policies][mw-multipolicy] | P0 | specified | payments.md PAY-R20, PAY-R22; rates.md RAT-R20 | — |
| PAR-PAY-073 | Collection plan per booking with exactly one executor per item | assumption (Portico design vs Mews double-charge pain) | P0 | specified | payments.md PAY-R20, PAY-I04 | — |
| PAR-PAY-074 | Booking change re-plans collections through a previewed diff | assumption | P0 | specified | payments.md PAY-R21 | — |
| PAR-PAY-075 | Failed automation never silent: task + notification to owner role | Mews [no VCC failure email][mw-vcc] (gap) | P0 | specified | payments.md PAY-R22 | — |
| PAR-PAY-076 | Policy exceptions per rate (override automation for one rate/channel) | Mews [policy exception][mw-policy-exception] | P1 | missing | — | — |
| PAR-PAY-077 | Batch deposit charging on due date | OPERA [batch deposits][op-batch-deposits] | P1 | specified | payments.md PAY-R22 | — |
| PAR-PAY-078 | Auto-settlement of folios at checkout or periodically by payment type | OPERA [auto folio settlement][op-auto-settle] | P1 | missing | — | — |
| PAR-PAY-079 | Guest pays balance from a link or QR on the folio (pay-at-table / self-pay) | Simphony [pay using QR code][sim-qr] | P2 | missing | — | — |
| PAR-PAY-080 | Payment request reminders and expiry handling | assumption | P1 | specified | payments.md PAY-R22 (reminders) | — |

### Cash, bank transfers, payouts

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-090 | Cash payments confirmed at entry and attributed to the cashier session | OPERA [cashier closure][op-cashier-close] | P0 | specified | payments.md PAY-R23 | — |
| PAR-PAY-091 | Bank transfers recorded as awaiting receipt until confirmed with bank reference | assumption (Maldives DMC practice) | P0 | specified | payments.md PAY-R23 | — |
| PAR-PAY-092 | Bank-feed matching of incoming transfers to awaiting items | Xero [bank reconciliation][xero-rec] | P1 | deferred | payments.md PAY-R23 (bank feed LATER) | — |
| PAR-PAY-093 | Payouts with gross, fees, disputes, reserves, net and constituent transactions | Stripe [payouts][st-payouts] · Mews [payments balance][mw-review-payments] | P0 | specified | payments.md PAY-R25 | — |
| PAR-PAY-094 | Payout reconciliation report per payout; payout never revenue | Stripe [payout reconciliation][st-payout-recon] | P0 | specified | payments.md PAY-R25 | — |
| PAR-PAY-095 | Provider fees and SaaS fees never netted against hotel payouts by Monoclay | assumption (architecture rule 14; Mews fee netting pain) | P0 | specified | CLAUDE.md §4 rule 14 | — |
| PAR-PAY-096 | Payment API for integrators: create payment, by terminal, by authorization, by stored method, by link | Apaleo [finance API payments][ap-fin] · Mews [payments API][mw-payments-api] | P1 | specified | payments.md §6 | — |
| PAR-PAY-097 | Payment events (succeeded, failed, pending, refund, dispute, payout) | Stripe [webhooks][st-webhooks] | P1 | specified | payments.md §7 | — |
| PAR-PAY-098 | Forward payments to an external PMS folio in connected mode | assumption (adoption brief) | P0 | specified | payments.md §14 | — |
| PAR-PAY-099 | Payment permissions (collect, refund, approve, VCC view, waive, reconcile) | OPERA [cashier login protected functions][op-cashier-login] | P0 | specified | payments.md §8 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PAY-001 | Card charge request times out at the desk | Payment shows pending verification; no posting; resolver queries by key; success → exactly one posting and check-in step resumes; failure → shown failed with recovery text | P0 | specified | — |
| EC-PAY-002 | Agent presses "charge" again while the first attempt is pending | Blocked with the pending amount, start time and "Check now"; no second provider call | P0 | specified | — |
| EC-PAY-003 | Provider webhook "succeeded" arrives before the API response | Webhook resolves the operation; later API response is matched to the same operation; one posting | P0 | specified | — |
| EC-PAY-004 | Duplicate and out-of-order webhooks (refund.updated before refund.created) | Each event id processed once; latest object fetched from provider; final state correct | P0 | specified | — |
| EC-PAY-005 | Refund interrupted after provider accepted it; staff retries | Same idempotency key returns the same refund; one refund posting; original payment unchanged (S06) | P0 | specified | — |
| EC-PAY-006 | Retry window longer than the provider's key retention (VCC retried over 5 days) | Before each retry Portico checks its own records and the provider for an existing success by reference; never relies on provider key retention alone | P0 | specified | — |
| EC-PAY-007 | Guest pays the deposit by link at the same moment automation charges the card on file | Collection item row lock: first to satisfy wins; the other execution is cancelled before the provider call, or if both already captured, the second is auto-flagged for refund-or-credit with a task | P0 | specified | — |
| EC-PAY-008 | Staff manually charges a VCC while an automated VCC charge is scheduled | Manual charge satisfies the item; scheduled execution is superseded; history shows who collected | P0 | specified | — |
| EC-PAY-009 | VCC charged on activation date but funds not yet loaded | Decline categorised as funding delay; retries per backoff for up to N days; task at final failure; never charged above VCC amount | P0 | specified | — |
| EC-PAY-010 | Channel did not send a VCC activation date | Item scheduled at arrival date in property time with visible "activation date unknown" warning; staff can edit | P1 | missing | — |
| EC-PAY-011 | Authorization expires during a 35-night stay | Renewal task or automatic re-authorization `renewBeforeDays` before expiry; expired authorization shown expired, never as guarantee | P0 | specified | — |
| EC-PAY-012 | Incremental authorization declined at night | Stay flagged "guarantee insufficient" for the morning desk; no posting block unless policy says so | P1 | missing | — |
| EC-PAY-013 | Checkout amount exceeds authorized amount | Capture up to authorized (or over-capture where supported) and charge the remainder as a new charge with consent; never silently fail | P0 | missing | — |
| EC-PAY-014 | Guest switches card at checkout | New charge on new card; old authorization released and release confirmation tracked; a release that never completes raises a guest-complaint risk task | P0 | specified | — |
| EC-PAY-015 | No-show charge attempted on a card whose terms did not disclose no-show charging | MIT blocked; payment request created instead; reason shown | P0 | specified | — |
| EC-PAY-016 | Provider account suspended during peak check-in | Banner with what is affected; automation paused; safe alternatives offered (external terminal record, cash, link later); nothing pretends to succeed | P0 | specified | — |
| EC-PAY-017 | Provider recovers; 40 queued automated collections | Each re-validated (still due? not satisfied? guest still in house? amount current?) before execution; skipped items logged with reason (E13/S20) | P0 | specified | — |
| EC-PAY-018 | Island internet drops mid-payment at a guesthouse | UI shows pending verification offline-honestly; no local "paid"; resolution on reconnect; staff can record an external-terminal payment instead | P0 | specified | — |
| EC-PAY-019 | External terminal record never matches any terminal batch line after N days | Exception to Finance with the record, terminal id and amount; status stays "not verified with provider" | P0 | specified | — |
| EC-PAY-020 | External terminal record entered twice with the same approval code | Second entry warned as probable duplicate (same terminal, approval code, amount, day); requires override reason | P0 | missing | — |
| EC-PAY-021 | Bank transfer confirmed, then the bank returns it | Reversal of the payment posting, collection item back to due, receivables reopened, task created | P0 | missing | — |
| EC-PAY-022 | Refund requested above the remaining refundable amount (in-flight refunds count) | Rejected with refundable amount shown (PAY-I03) | P0 | specified | — |
| EC-PAY-023 | Refund of a payment made on a card that is now closed | Provider error mapped to "card closed — refund by other method"; alternative refund flow with permission | P1 | missing | — |
| EC-PAY-024 | Chargeback received for a stay already refunded partially | Dispute linked to payment and refunds; evidence pack includes the refund; ledger records dispute debit; task with deadline | P0 | specified | — |
| EC-PAY-025 | Dispute won after funds were debited | Reversal movement recorded; folio unchanged; dispute closed `won` | P1 | specified | — |
| EC-PAY-026 | Payout total differs from the sum of transactions by an unexplained amount | Reconciliation exception with the difference and candidate causes; never auto-adjusted | P0 | specified | — |
| EC-PAY-027 | Payout settles in MVR for USD charges (acquirer conversion) | FX difference to gains/losses at payout reconciliation; rate implied by acquirer recorded | P0 | specified | — |
| EC-PAY-028 | Payment link paid partially (instalments) and then expires | Request `partially_paid → expired`; paid part stays; collection item reflects remainder; new link offered | P1 | specified | — |
| EC-PAY-029 | Booking cancelled after a payment link was sent but before guest pays | Link cancelled at provider; if guest still pays (race), payment recorded as unscheduled and a refund-or-credit task created | P0 | specified | — |
| EC-PAY-030 | Booking shortened after deposit collected beyond new total | Plan diff shows over-collection; refund-or-credit task; satisfied items never removed | P0 | specified | — |
| EC-PAY-031 | Demo environment user enters a real-looking card number | Simulator only; effect blocked for live; labelled simulated; no provider call (PAY-I06) | P0 | specified | — |
| EC-PAY-032 | Log line or AI context would contain a PAN-looking string | Redaction removes it; schema has no PAN column; static check in CI (PAY-I05) | P0 | specified | — |
| EC-PAY-033 | 3DS challenge abandoned by guest on booking engine | Payment `requires_action → expired`; booking held per policy then released; no guarantee recorded | P1 | specified | — |
| EC-PAY-034 | Guest disputes a pre-authorization hold that was never captured | Hold release status visible with timestamps and provider confirmation for the guest letter | P1 | missing | — |
| EC-PAY-035 | Same card token used by two guests' bookings (company card) | Allowed; mandate per booking; charges carry booking reference; no cross-booking capture | P1 | missing | — |
| EC-PAY-036 | Time zone: VCC activation date in channel's time zone differs from property's | Activation interpreted in property local time as stored on the VCC record; charge never before 00:00 property time on that date | P0 | specified | — |
| EC-PAY-037 | MVR cash payment while exchange rate missing | Blocked by finance FX rule (EC-FIN-019) with clear message; payments does not invent a rate | P0 | specified | — |
| EC-PAY-038 | Card payment taken on the Maldivian external terminal in USD but terminal settles in MVR | Payment recorded in USD as the guest saw it; settlement difference reconciled per EC-PAY-027 | P0 | missing | — |

## Evidence sources (all verified 2026-11-07)

[st-direct]: https://docs.stripe.com/connect/direct-charges
[st-terminal]: https://docs.stripe.com/terminal
[st-save]: https://docs.stripe.com/payments/save-and-reuse
[st-3ds]: https://docs.stripe.com/payments/3d-secure
[st-incr]: https://docs.stripe.com/payments/incremental-authorization
[st-ext-auth]: https://docs.stripe.com/payments/extended-authorization
[st-multicapture]: https://docs.stripe.com/payments/multicapture
[st-overcapture]: https://docs.stripe.com/payments/overcapture
[st-idem]: https://docs.stripe.com/api/idempotent_requests
[st-webhooks]: https://docs.stripe.com/webhooks
[st-payout-recon]: https://docs.stripe.com/reports/payout-reconciliation
[st-refunds]: https://docs.stripe.com/refunds
[st-disputes]: https://docs.stripe.com/disputes
[st-paylinks]: https://docs.stripe.com/payments/payment-links
[st-payouts]: https://docs.stripe.com/payouts
[ap-fin]: https://api.apaleo.com/swagger/finance-v1/swagger.json
[ap-fin-beta]: https://api.apaleo.com/swagger/finance-v0-nsfw/swagger.json
[ap-auth]: https://apaleo.dev/guides/pay-integration/authorizations.html
[ap-payacct]: https://apaleo.dev/guides/pay-integration/payment-accounts.html
[mw-review-payments]: https://help.mews.com/s/article/review-your-mews-payments
[mw-terminal]: https://help.mews.com/0TO09000000HOzxGAG
[mw-acct-config]: https://help.mews.com/s/article/what-is-the-accounting-configuration
[mw-cards-api]: https://docs.mews.com/connector-api/operations/creditcards
[mw-vcc]: https://help.mews.com/s/article/how-to-set-up-an-automatic-settlement-for-virtual-credit-cards
[mw-preauth-policy]: https://help.mews.com/s/article/Enable-automatic-card-preauthorization-for-a-new-payment-policy-in-Mews-Operations
[mw-payreq-api]: https://docs.mews.com/connector-api/operations/paymentrequests
[mw-paypolicy]: https://help.mews.com/s/article/how-to-set-up-payment-automation
[mw-multipolicy]: https://help.mews.com/s/article/Using-multiple-settlement-rules-in-Mews
[mw-policy-exception]: https://help.mews.com/s/article/How-to-create-a-policy-exception-for-a-rate-or-rate-group-in-Mews-Operations
[mw-ledger-reconcile]: https://help.mews.com/s/article/How-to-reconcile-your-Ledgers-in-Mews-Operations
[mw-payments-api]: https://docs.mews.com/connector-api/operations/payments
[op-paymethods]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_managing_payment_methods.htm
[op-cc-types]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_admin_financial_configuring_credit_card_types.htm
[op-wallet]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_credit_card_wallet.htm
[op-cc-copy]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_copy_cc_payment_method_to_reservations.htm
[op-auth-rules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_admin_financial_cashiering_about_credit_card_authorization_rules.htm
[op-batch-auth]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_using_batch_credit_card_authorizations.htm
[op-auth-reversal]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_credit_card_authorization_reversal.htm
[op-b2b-auth]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_back_to_back_res_authorization_examples.htm
[op-cl-overage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_using_credit_limit_overage.htm
[op-postings]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_postings_adjustments_postings_adjustments_and_payments_ch.htm
[op-cc-settle]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_billing_credit_card_settlement.htm
[op-batch-deposits]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_batch_folios_processing_batch_deposits.htm
[op-auto-settle]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_auto_folio_settlement.htm
[op-cashier-close]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiers_closure.htm
[op-cashier-login]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_cashiering_finance_cashier_login.htm
[sim-moto]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_moto.htm
[sim-qr]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_payment_qr_code.htm
[xero-rec]: https://central.xero.com/0/article/Reconcile-your-bank-account
