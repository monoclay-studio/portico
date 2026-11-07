# Parity: payments

Module: `payments` (payment accounts, provider adapters, payment methods, VCC, authorizations, captures, refunds,
disputes, payment requests, collection plans, payouts, reconciliation) · Spec: `docs/specs/payments.md`.

**Baseline.** OPERA Cloud 26.2 cashiering/credit-card topics, Mews Payments (help centre + Connector API), Apaleo
Pay and Finance API, Stripe documentation for scheme mechanics. Evidence links at the end; **all verified
2026-11-07**.

**Status rule.** `built`/`tested` cite branch `feat/payments-core` @ `a219850` (worktree `wt/payments`, under review,
not yet on `main`); Test paths are relative to the repository root on that branch (finance tests from
`feat/finance-core` @ `232be3a`). If a branch merges with changes, the steward re-verifies; if rejected, rows fall
back to `specified`.

**Reconciliation.** This file supersedes the module draft `modules/payments/PARITY.md` (which said "move to
docs/parity/payments.md at merge"): delete the draft when merging so there is one matrix. Every row and edge case of
the draft is carried over; draft IDs map as follows.

| Draft capability → this file | Draft edge case → this file |
|---|---|
| 001 → 001 · 002 → 003 · 003 → 020 | 001 → 001 · 002 → 002 · 003 → 005 · 004/005 → 004 |
| 004 → 030, 032, 034, 036 · 005 → 033 · 006 → 037 | 006 → 016 · 007 → 039 · 008 → 040 · 009 → 022 |
| 007 → 060 · 008 → 070 · 009 → 026 · 010 → 064–066 | 010 → 031 · 011 → 041 · 012 → 042 · 013 → 043 · 014 → 044 |
| 011 → 093–094 · 012 → 005 · 013 → 056, 092 · 014 → 090–091 | 015 → 020 · 016 → 045 · 017 → 019 · 018 → 046 · 019 → 009 |
| 015 → 073 · 016 → 021, 039 · 017 → 007 · 018 → 100 | 020 → 036 · 021 → 047 · 022 → 048 · 023 → 049 · 024 → 025 |
| 019 → 061 · 020 → 006 | 025 → 050 · 026 → 011 · 027 → 029 · 028 → 051 |

## Capabilities

### Accounts, providers and adapters

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-001 | Hotel legal entity is merchant of record on its own payment account | Stripe [direct charges][st-direct] · Mews [payments][mw-review-payments] | P0 | tested | payments.md PAY-R01; decisions D2 | modules/payments/src/providers/stripe-connect.test.ts; test/authorizations.test.ts |
| PAR-PAY-002 | Several payment accounts per legal entity (online acquirer + terminal acquirer) | Apaleo [payments by terminal / by link][ap-fin] | P1 | tested | payments.md PAY-R01 | modules/payments/test/environment-safety.test.ts (accounts per legal entity) |
| PAR-PAY-003 | Provider-agnostic adapter port with declared capabilities; UI offers only supported actions | assumption (OPERA OPI pattern, research 04 §B5) | P0 | built | payments.md PAY-R02 | modules/payments/src/providers/stripe-connect.test.ts (adapter port; second real adapter not built) |
| PAR-PAY-004 | Full-capability simulator with failure injection for demo/training | assumption | P0 | tested | payments.md PAY-R03 | modules/payments/test/scenario-s05-payment-timeout.test.ts; test/scenario-s20-provider-outage.test.ts |
| PAR-PAY-005 | Record-only external terminal payments (approval code, terminal id) matched to batch reports | assumption (Maldives Route D, Q2) | P0 | tested | payments.md PAY-R03, PAY-R24 | modules/payments/test/route-d-recorded.test.ts |
| PAR-PAY-006 | Local Maldivian acquirer/gateway adapter | assumption (Q2) | P0 | deferred | payments.md PAY-R03 — R1 pending Q2 vendor choice | — |
| PAR-PAY-007 | Integrated card-present terminals (tap/insert, tip on terminal, token for later MIT) | Stripe [Terminal][st-terminal] · Mews [terminal setup][mw-terminal] · Apaleo [payment by terminal][ap-fin] | P1 | deferred | payments.md PAY-R02 — after pilot; Route D covers standalone terminals (modules/payments/PARITY.md) | — |
| PAR-PAY-008 | Provider account health (restricted/suspended) with banner and safe alternatives | assumption (research 02 §2.5 pain) | P0 | tested | payments.md PAY-R26 | modules/payments/test/scenario-s20-provider-outage.test.ts |
| PAR-PAY-009 | Environment safety: no live provider call in demo/trial/training | assumption (architecture rule 12) | P0 | tested | payments.md PAY-R04, PAY-I06 | modules/payments/test/environment-safety.test.ts |
| PAR-PAY-010 | Payment method configuration per property (cash, card types, bank transfer, vouchers) with accounting mapping | OPERA [payment methods][op-paymethods] · [credit card types][op-cc-types] · Mews [accounting configuration][mw-acct-config] | P0 | tested | finance.md FIN-R12 (payment codes) | modules/finance/src/domain/domain.test.ts (methods mapped to accounts) |

### Payment methods, tokens and virtual cards

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-020 | Tokenized card on file; no PAN/CVC storage anywhere | Apaleo [payment accounts][ap-payacct] · Mews [credit cards API][mw-cards-api] | P0 | tested | payments.md PAY-R05, PAY-I05 | modules/payments/test/isolation-permissions.test.ts |
| PAR-PAY-021 | Hosted card entry (PSP components) on Portico pages | Stripe [save and reuse][st-save] | P0 | specified | payments.md PAY-R06 | — |
| PAR-PAY-022 | Mandate/consent evidence stored with the token (terms version, 3DS result, network transaction id) | Stripe [3D Secure][st-3ds] · [save and reuse][st-save] | P0 | tested | payments.md PAY-R05 | modules/payments/test/authorizations.test.ts (MIT requires agreement) |
| PAR-PAY-023 | Card wallet on the guest profile reused across stays (where token/mandate allows) | OPERA [credit card wallet][op-wallet] · Apaleo [reuse payment method][ap-payacct] | P1 | specified | payments.md PAY-R08 | — |
| PAR-PAY-024 | Copy a card from one reservation to related reservations | OPERA [copy credit card][op-cc-copy] | P2 | missing | — | — |
| PAR-PAY-025 | OTA virtual card metadata (activation date, amount, currency, expiry) separate from token | Mews [VCC charging][mw-vcc] | P0 | tested | payments.md PAY-R07 | modules/payments/test/requests-vcc.test.ts |
| PAR-PAY-026 | VCC charged automatically at activation for exactly its amount, retries for funding delay, task on final failure | Mews [VCC charging][mw-vcc] | P0 | tested | payments.md PAY-R07 | modules/payments/test/requests-vcc.test.ts |
| PAR-PAY-027 | OTA hotel-collect card data routed through PCI proxy to tokens | assumption (research 04 §B6) | P0 | specified | payments.md §2 (PCI proxy in integration) | — |
| PAR-PAY-028 | Card expiry/replacement handling (ask guest for new card via link) | assumption | P1 | missing | — | — |

### Authorizations, captures and charges

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-030 | Pre-authorization at check-in or T−n days; never shown as a payment | OPERA [authorization rules][op-auth-rules] · Apaleo [authorizations][ap-auth] · Mews [preauthorization policy][mw-preauth-policy] | P0 | tested | payments.md PAY-R09, PAY-R22 | modules/payments/test/authorizations.test.ts (hold never posted) |
| PAR-PAY-031 | Authorization rules estimating expected spend (room + incidentals per night) | OPERA [authorization rules][op-auth-rules] | P1 | missing | — | — |
| PAR-PAY-032 | Incremental authorization as charges approach the authorized amount (incl. nightly batch) | OPERA [batch authorizations][op-batch-auth] · Stripe [incremental][st-incr] | P1 | tested | payments.md PAY-R09 | modules/payments/test/authorizations.test.ts |
| PAR-PAY-033 | Scheme-specific authorization expiry (extended lodging authorizations) with renewal before expiry | Stripe [extended authorization][st-ext-auth] · Apaleo [28-day holds][ap-auth] | P0 | tested | payments.md PAY-R09, PAY-R10 | modules/payments/test/authorizations.test.ts (warns before expiry) |
| PAR-PAY-034 | Capture full or partial; multiple partial captures | Stripe [multicapture][st-multicapture] · Apaleo [payment by authorization][ap-fin] | P0 | tested | payments.md PAY-R09 | modules/payments/test/authorizations.test.ts (partial captures) |
| PAR-PAY-035 | Over-capture (capture above authorized amount where scheme permits) | Stripe [overcapture][st-overcapture] | P2 | missing | — | — |
| PAR-PAY-036 | Release unused authorization at checkout; authorization reversal on payment-method change | OPERA [authorization reversals][op-auth-reversal] | P0 | tested | payments.md PAY-R09 (`release`) | modules/payments/test/authorizations.test.ts (releases holds) |
| PAR-PAY-037 | Customer-initiated and merchant-initiated charges (no-show, post-departure, scheduled) referencing mandate | Stripe [save and reuse][st-save] | P0 | tested | payments.md PAY-R11 | modules/payments/test/authorizations.test.ts; src/providers/stripe-connect.test.ts (off-session MIT) |
| PAR-PAY-038 | Plain-language decline reasons with recovery actions | assumption | P0 | tested | payments.md PAY-R12 | modules/payments/test/authorizations.test.ts; src/domain/domain.test.ts |
| PAR-PAY-039 | 3DS/SCA challenge handling (`requires_action`) for guest-present flows | Stripe [3D Secure][st-3ds] | P1 | tested | payments.md PAY-R12 | modules/payments/src/providers/stripe-connect.test.ts (requires_action); src/domain/domain.test.ts (3DS → link) |
| PAR-PAY-040 | Back-to-back stays sharing an authorization | OPERA [back to back authorization examples][op-b2b-auth] | P2 | missing | — | — |
| PAR-PAY-041 | Credit-limit overage auto-charge when folio balance passes card limit | OPERA [credit limit overage][op-cl-overage] | P1 | missing | — | — |
| PAR-PAY-042 | MOTO (mail/telephone order) card payments | Simphony [MOTO][sim-moto] | P2 | missing | — | — |
| PAR-PAY-043 | Card surcharges per card type passed to guest where legal | OPERA [card payments with surcharges][op-postings] | P2 | missing | — | — |
| PAR-PAY-044 | Dynamic currency conversion offered at terminal | assumption (acquirer feature) | P2 | missing | — | — |

### Pending verification, webhooks and reconciliation

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-050 | Timeout/ambiguous outcome shown as pending verification, resolved by provider query on backoff | Stripe [idempotent requests][st-idem] | P0 | tested | payments.md PAY-R13 | modules/payments/test/scenario-s05-payment-timeout.test.ts |
| PAR-PAY-051 | Second charge for the same item blocked while one is pending | assumption (research 02 §2.5 double-charge pain) | P0 | tested | payments.md PAY-R14 | modules/payments/test/scenario-s05-payment-timeout.test.ts |
| PAR-PAY-052 | Persisted provider operation with idempotency key committed before the call | Stripe [idempotent requests][st-idem] | P0 | tested | payments.md PAY-R04, PAY-I02 | modules/payments/test/scenario-s06-refund-retry.test.ts (racing executors) |
| PAR-PAY-053 | Webhooks verified, de-duplicated, order-tolerant, stored raw (no card data) | Stripe [webhooks][st-webhooks] | P0 | tested | payments.md PAY-R15 | modules/payments/test/webhooks.test.ts |
| PAR-PAY-054 | Manual commit/fail of a pending payment by a supervisor (with evidence) | Apaleo [payment commit/fail][ap-fin-beta] | P1 | missing | — | — |
| PAR-PAY-055 | Daily reconciliation of provider balance transactions vs payments vs ledger | Stripe [payout reconciliation][st-payout-recon] · Mews [reconcile ledgers][mw-ledger-reconcile] | P0 | built | payments.md PAY-R16, PAY-I08 | modules/payments/test/scenario-s05-payment-timeout.test.ts (scheduled reconciliation job); balance-transaction report matching partial |
| PAR-PAY-056 | Terminal batch settlement / card settlement close-out | OPERA [credit card settlement][op-cc-settle] | P0 | tested | payments.md PAY-R24 (batch matching) | modules/payments/test/route-d-recorded.test.ts (acquirer settlement file) |
| PAR-PAY-057 | Review/inspect all payments with state, fees and payout link | Mews [review payments][mw-review-payments] · [payments API][mw-payments-api] | P0 | specified | payments.md §9 Payments & payouts page | — |

### Refunds and disputes

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-060 | Refund full/partial linked to the original payment; idempotent retry | Stripe [refunds][st-refunds] · Apaleo [refund payment][ap-fin] · OPERA [post CC refund][op-postings] | P0 | tested | payments.md PAY-R17 | modules/payments/test/scenario-s06-refund-retry.test.ts |
| PAR-PAY-061 | Refund approval above threshold | assumption | P1 | specified | payments.md PAY-R17 | — |
| PAR-PAY-062 | Unlinked refund to a different card or method (with permission) | Apaleo [folio refund][ap-fin] | P1 | missing | — | — |
| PAR-PAY-063 | Refund by bank transfer (outbound) recorded and confirmed | assumption | P1 | missing | — | — |
| PAR-PAY-064 | Dispute records from provider webhooks with deadlines and finance task | Stripe [disputes][st-disputes] | P0 | tested | payments.md PAY-R18 | modules/payments/test/webhooks.test.ts |
| PAR-PAY-065 | One-click evidence pack (terms acceptance, registration card, 3DS, folio, comms, check-in/out log) | assumption (research 04 §B6) | P1 | built | payments.md PAY-R18 | modules/payments/test/webhooks.test.ts (evidence checklist; export pack pending) |
| PAR-PAY-066 | Dispute fund movements recorded in the ledger | Stripe [disputes][st-disputes] | P0 | tested | payments.md PAY-R18 (`recordDisputeMovement`) | modules/payments/test/webhooks.test.ts; modules/finance/test/payments-ledger-port.test.ts |

### Payment requests and automation

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-070 | Payment links (deposit, balance, custom) with expiry, language, partial payments | Mews [payment requests API][mw-payreq-api] · Apaleo [payment by link][ap-fin] · Stripe [payment links][st-paylinks] | P0 | tested | payments.md PAY-R19 | modules/payments/test/requests-vcc.test.ts |
| PAR-PAY-071 | Cancel a pending payment link | Apaleo [cancel link][ap-fin] | P0 | tested | payments.md §4 (`cancelled`) | modules/payments/test/requests-vcc.test.ts (cancel with If-Match) |
| PAR-PAY-072 | Payment policies per rate group/plan: automatic or manual, preauth or charge, timing | Mews [payment policies][mw-paypolicy] · [multiple policies][mw-multipolicy] | P0 | specified | payments.md PAY-R20, PAY-R22; rates.md RAT-R20 | — |
| PAR-PAY-073 | Collection plan per booking with exactly one executor per item | assumption (Portico design vs Mews double-charge pain) | P0 | specified | payments.md PAY-R20 — not built on branch | — |
| PAR-PAY-074 | Booking change re-plans collections through a previewed diff | assumption | P0 | specified | payments.md PAY-R21 | — |
| PAR-PAY-075 | Failed automation never silent: task + notification to owner role | Mews [no VCC failure email][mw-vcc] (gap) | P0 | built | payments.md PAY-R22 | modules/payments/test/requests-vcc.test.ts (owned task on hard decline) |
| PAR-PAY-076 | Policy exceptions per rate (override automation for one rate/channel) | Mews [policy exception][mw-policy-exception] | P1 | missing | — | — |
| PAR-PAY-077 | Batch deposit charging on due date | OPERA [batch deposits][op-batch-deposits] | P1 | specified | payments.md PAY-R22 | — |
| PAR-PAY-078 | Auto-settlement of folios at checkout or periodically by payment type | OPERA [auto folio settlement][op-auto-settle] | P1 | missing | — | — |
| PAR-PAY-079 | Guest pays balance from a link or QR on the folio (pay-at-table / self-pay) | Simphony [pay using QR code][sim-qr] | P2 | missing | — | — |
| PAR-PAY-080 | Payment request reminders and expiry handling | assumption | P1 | specified | payments.md PAY-R22 (reminders) | — |

### Cash, bank transfers, payouts

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-090 | Cash payments confirmed at entry and attributed to the cashier session | OPERA [cashier closure][op-cashier-close] | P0 | tested | payments.md PAY-R23 | modules/payments/test/route-d-recorded.test.ts |
| PAR-PAY-091 | Bank transfers recorded as awaiting receipt until confirmed with bank reference | assumption (Maldives DMC practice) | P0 | tested | payments.md PAY-R23 | modules/payments/test/route-d-recorded.test.ts (verified against bank statements) |
| PAR-PAY-092 | Bank-feed matching of incoming transfers to awaiting items | Xero [bank reconciliation][xero-rec] | P1 | tested | payments.md PAY-R23 — statement file import + auto-match (branch); live bank feed LATER (Q107) | modules/payments/test/route-d-recorded.test.ts; src/domain/domain.test.ts (matching) |
| PAR-PAY-093 | Payouts with gross, fees, disputes, reserves, net and constituent transactions | Stripe [payouts][st-payouts] · Mews [payments balance][mw-review-payments] | P0 | tested | payments.md PAY-R25 | modules/payments/test/webhooks.test.ts (payouts never revenue) |
| PAR-PAY-094 | Payout reconciliation report per payout; payout never revenue | Stripe [payout reconciliation][st-payout-recon] | P0 | tested | payments.md PAY-R25 | modules/payments/test/webhooks.test.ts; modules/finance/test/payments-ledger-port.test.ts |
| PAR-PAY-095 | Provider fees and SaaS fees never netted against hotel payouts by Monoclay | assumption (architecture rule 14; Mews fee netting pain) | P0 | specified | CLAUDE.md §4 rule 14 | — |
| PAR-PAY-096 | Payment API for integrators: create payment, by terminal, by authorization, by stored method, by link | Apaleo [finance API payments][ap-fin] · Mews [payments API][mw-payments-api] | P1 | tested | payments.md §6 | apps/api/test/payments.test.ts |
| PAR-PAY-097 | Payment events (succeeded, failed, pending, refund, dispute, payout) | Stripe [webhooks][st-webhooks] | P1 | built | payments.md §7 | — (events emitted; consumers tested in finance S10) |
| PAR-PAY-098 | Forward payments to an external PMS folio in connected mode | assumption (adoption brief) | P0 | specified | payments.md §14 | — |
| PAR-PAY-099 | Payment permissions (collect, refund, approve, VCC view, waive, reconcile) | OPERA [cashier login protected functions][op-cashier-login] | P0 | tested | payments.md §8 | modules/payments/test/isolation-permissions.test.ts |
| PAR-PAY-100 | Platform application fee on embedded (Connect) payments, kept separate from hotel funds | Stripe [direct charges][st-direct] | P2 | tested | payments.md PAY-R03 | modules/payments/src/providers/stripe-connect.test.ts |
| PAR-PAY-101 | Circuit breaker per provider account with a single recovery probe | assumption (S20) | P0 | tested | payments.md PAY-R26 | modules/payments/src/domain/domain.test.ts |
| PAR-PAY-102 | Tenant isolation of payments and methods; data-authority refusal when payments are external | assumption (architecture rules 4, 15) | P0 | tested | payments.md §14 | modules/payments/test/isolation-permissions.test.ts |
| PAR-PAY-103 | Terminal refunds and manual authorizations completed on a standalone terminal recorded and matched | assumption (Route D) | P0 | tested | payments.md PAY-R24 | modules/payments/test/route-d-recorded.test.ts |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PAY-001 | Card charge request times out at the desk | Payment shows pending verification; no posting; resolver queries by key; success → exactly one posting and check-in step resumes; failure → shown failed with recovery text | P0 | tested | modules/payments/test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-002 | Agent presses "charge" again while the first attempt is pending | Blocked with the pending amount, start time and "Check now"; no second provider call | P0 | tested | modules/payments/test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-003 | Provider webhook "succeeded" arrives before the API response | Webhook resolves the operation; later API response is matched to the same operation; one posting | P0 | tested | modules/payments/test/scenario-s05-payment-timeout.test.ts (worker consumers resolve) |
| EC-PAY-004 | Duplicate and out-of-order webhooks (refund.updated before refund.created) | Each event id processed once; latest object fetched from provider; final state correct | P0 | tested | modules/payments/test/webhooks.test.ts; src/domain/domain.test.ts |
| EC-PAY-005 | Refund interrupted after provider accepted it; staff retries | Same idempotency key returns the same refund; one refund posting; original payment unchanged (S06) | P0 | tested | modules/payments/test/scenario-s06-refund-retry.test.ts |
| EC-PAY-006 | Retry window longer than the provider's key retention (VCC retried over 5 days) | Before each retry Portico checks its own records and the provider for an existing success by reference; never relies on provider key retention alone | P0 | tested | modules/payments/src/providers/stripe-connect.test.ts (find intent by operation metadata) |
| EC-PAY-007 | Guest pays the deposit by link at the same moment automation charges the card on file | Collection item row lock: first to satisfy wins; the other execution is cancelled before the provider call, or if both already captured, the second is auto-flagged for refund-or-credit with a task | P0 | specified | — |
| EC-PAY-008 | Staff manually charges a VCC while an automated VCC charge is scheduled | Manual charge satisfies the item; scheduled execution is superseded; history shows who collected | P0 | specified | — |
| EC-PAY-009 | VCC charged on activation date but funds not yet loaded | Decline categorised as funding delay; retries per backoff for up to N days; task at final failure; never charged above VCC amount | P0 | tested | modules/payments/test/requests-vcc.test.ts |
| EC-PAY-010 | Channel did not send a VCC activation date | Item scheduled at arrival date in property time with visible "activation date unknown" warning; staff can edit | P1 | missing | — |
| EC-PAY-011 | Authorization expires during a 35-night stay | Renewal task or automatic re-authorization `renewBeforeDays` before expiry; expired authorization shown expired, never as guarantee | P0 | tested | modules/payments/test/authorizations.test.ts |
| EC-PAY-012 | Incremental authorization declined at night | Stay flagged "guarantee insufficient" for the morning desk; no posting block unless policy says so | P1 | missing | — |
| EC-PAY-013 | Checkout amount exceeds authorized amount | Capture up to authorized (or over-capture where supported) and charge the remainder as a new charge with consent; never silently fail | P0 | missing | — |
| EC-PAY-014 | Guest switches card at checkout | New charge on new card; old authorization released and release confirmation tracked; a release that never completes raises a guest-complaint risk task | P0 | built | modules/payments/test/authorizations.test.ts (release; release-confirmation tracking pending) |
| EC-PAY-015 | No-show charge attempted on a card whose terms did not disclose no-show charging | MIT blocked; payment request created instead; reason shown | P0 | tested | modules/payments/test/authorizations.test.ts |
| EC-PAY-016 | Provider account suspended during peak check-in | Banner with what is affected; automation paused; safe alternatives offered (external terminal record, cash, link later); nothing pretends to succeed | P0 | tested | modules/payments/test/scenario-s20-provider-outage.test.ts |
| EC-PAY-017 | Provider recovers; 40 queued automated collections | Each re-validated (still due? not satisfied? guest still in house? amount current?) before execution; skipped items logged with reason (E13/S20) | P0 | tested | modules/payments/test/scenario-s20-provider-outage.test.ts |
| EC-PAY-018 | Island internet drops mid-payment at a guesthouse | UI shows pending verification offline-honestly; no local "paid"; resolution on reconnect; staff can record an external-terminal payment instead | P0 | built | modules/payments/test/scenario-s05-payment-timeout.test.ts (pending verification path) |
| EC-PAY-019 | External terminal record never matches any terminal batch line after N days | Exception to Finance with the record, terminal id and amount; status stays "not verified with provider" | P0 | tested | modules/payments/test/route-d-recorded.test.ts |
| EC-PAY-020 | External terminal record entered twice with the same approval code | Second entry warned as probable duplicate (same terminal, approval code, amount, day); requires override reason | P0 | tested | modules/payments/test/route-d-recorded.test.ts (duplicate approval code refused) |
| EC-PAY-021 | Bank transfer confirmed, then the bank returns it | Reversal of the payment posting, collection item back to due, receivables reopened, task created | P0 | missing | — |
| EC-PAY-022 | Refund requested above the remaining refundable amount (in-flight refunds count) | Rejected with refundable amount shown (PAY-I03) | P0 | tested | modules/payments/test/scenario-s06-refund-retry.test.ts |
| EC-PAY-023 | Refund of a payment made on a card that is now closed | Provider error mapped to "card closed — refund by other method"; alternative refund flow with permission | P1 | missing | — |
| EC-PAY-024 | Chargeback received for a stay already refunded partially | Dispute linked to payment and refunds; evidence pack includes the refund; ledger records dispute debit; task with deadline | P0 | built | modules/payments/test/webhooks.test.ts |
| EC-PAY-025 | Dispute won after funds were debited | Reversal movement recorded; folio unchanged; dispute closed `won` | P1 | tested | modules/payments/test/webhooks.test.ts |
| EC-PAY-026 | Payout total differs from the sum of transactions by an unexplained amount | Reconciliation exception with the difference and candidate causes; never auto-adjusted | P0 | built | modules/payments/test/webhooks.test.ts (missing breakdown flagged) |
| EC-PAY-027 | Payout settles in MVR for USD charges (acquirer conversion) | FX difference to gains/losses at payout reconciliation; rate implied by acquirer recorded | P0 | specified | — |
| EC-PAY-028 | Payment link paid partially (instalments) and then expires | Request `partially_paid → expired`; paid part stays; collection item reflects remainder; new link offered | P1 | built | modules/payments/test/requests-vcc.test.ts |
| EC-PAY-029 | Booking cancelled after a payment link was sent but before guest pays | Link cancelled at provider; if guest still pays (race), payment recorded as unscheduled and a refund-or-credit task created | P0 | built | — (modules/payments/PARITY.md EC-PAY-027: recorded + exception) |
| EC-PAY-030 | Booking shortened after deposit collected beyond new total | Plan diff shows over-collection; refund-or-credit task; satisfied items never removed | P0 | specified | — |
| EC-PAY-031 | Demo environment user enters a real-looking card number | Simulator only; effect blocked for live; labelled simulated; no provider call (PAY-I06) | P0 | tested | modules/payments/test/environment-safety.test.ts |
| EC-PAY-032 | Log line or AI context would contain a PAN-looking string | Redaction removes it; schema has no PAN column; static check in CI (PAY-I05) | P0 | tested | modules/payments/test/isolation-permissions.test.ts; src/domain/domain.test.ts (scrub) |
| EC-PAY-033 | 3DS challenge abandoned by guest on booking engine | Payment `requires_action → expired`; booking held per policy then released; no guarantee recorded | P1 | specified | — |
| EC-PAY-034 | Guest disputes a pre-authorization hold that was never captured | Hold release status visible with timestamps and provider confirmation for the guest letter | P1 | built | — |
| EC-PAY-035 | Same card token used by two guests' bookings (company card) | Allowed; mandate per booking; charges carry booking reference; no cross-booking capture | P1 | missing | — |
| EC-PAY-036 | Time zone: VCC activation date in channel's time zone differs from property's | Activation interpreted in property local time as stored on the VCC record; charge never before 00:00 property time on that date | P0 | tested | modules/payments/test/requests-vcc.test.ts (property-local activation) |
| EC-PAY-037 | MVR cash payment while exchange rate missing | Blocked by finance FX rule (EC-FIN-019) with clear message; payments does not invent a rate | P0 | specified | — |
| EC-PAY-038 | Card payment taken on the Maldivian external terminal in USD but terminal settles in MVR | Payment recorded in USD as the guest saw it; settlement difference reconciled per EC-PAY-027 | P0 | built | modules/payments/test/route-d-recorded.test.ts (settlement mismatch → exception) |
| EC-PAY-039 | Worker is down; a payment intent is not sent for 20 minutes | Intent cancelled with "nothing was charged"; never sent late | P0 | tested | modules/payments/test/scenario-s20-provider-outage.test.ts |
| EC-PAY-040 | Two processes recover the same unsent intent concurrently | Exactly one provider call | P0 | tested | modules/payments/test/scenario-s06-refund-retry.test.ts |
| EC-PAY-041 | Sandbox organization configured with a live provider key | Refused before any request, with the reason | P0 | tested | modules/payments/test/environment-safety.test.ts |
| EC-PAY-042 | Staff paste a card number into a token, reference or name field | Refused at the API boundary and by a database check | P0 | tested | modules/payments/test/isolation-permissions.test.ts |
| EC-PAY-043 | Another organization uses our payment or method ids | 404; RLS hides the rows; nothing refunded or captured | P0 | tested | modules/payments/test/isolation-permissions.test.ts |
| EC-PAY-044 | An external system is the payments system of record | Payment actions refused with the explanation and the external system named | P0 | tested | modules/payments/test/isolation-permissions.test.ts |
| EC-PAY-045 | Settlement amount differs from the recorded terminal amount | Owned exception; correction by adjustment; record verified only after | P0 | tested | modules/payments/test/route-d-recorded.test.ts |
| EC-PAY-046 | Settlement statement line with no record in Portico | Exception "money arrived that no bill shows" with owner | P0 | tested | modules/payments/test/route-d-recorded.test.ts |
| EC-PAY-047 | Finance refuses the ledger posting for a confirmed payment | Payment stays succeeded; ledger state `failed`; urgent exception; retried with the same key, posted once | P0 | tested | modules/payments/test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-048 | Payout reported without a fee breakdown | Not posted; exception until the breakdown is recorded | P1 | tested | modules/payments/test/webhooks.test.ts |
| EC-PAY-049 | Payout fails after it was reported | Urgent exception; ledger reversal flagged if it was posted | P1 | tested | modules/payments/test/webhooks.test.ts |
| EC-PAY-050 | Provider reports success for a payment recorded as failed | Applied (money is never hidden) and an urgent mismatch exception raised | P1 | built | modules/payments/src/domain/domain.test.ts (state machine) |
| EC-PAY-051 | Live-mode provider webhook reaches a sandbox endpoint | Refused; never routed to a non-live organization | P0 | tested | modules/payments/test/webhooks.test.ts |
| EC-PAY-052 | Refund requested for a payment still pending verification | Refused until the payment is resolved; explains why | P0 | tested | modules/payments/test/scenario-s06-refund-retry.test.ts |
| EC-PAY-053 | Refund fails at the provider after the amount was reserved | Reserved refundable amount released; nothing posted; staff told | P0 | tested | modules/payments/test/scenario-s06-refund-retry.test.ts |
| EC-PAY-054 | Statement has no reference; amount, date and last 4 match two records | No automatic match (ambiguous); both listed for staff | P0 | tested | modules/payments/src/domain/domain.test.ts (unique-only fallback) |

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
