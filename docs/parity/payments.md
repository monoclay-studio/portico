# Payments — competitive parity matrix and edge-case catalogue

Status: v2 · 2026-11-07 · Spec `docs/specs/payments.md` (PAY) · Code `modules/payments` (branch
`feat/payments-core`, steward review `docs/orchestration/reviews/review-payments.md` fixes applied). Market
evidence comes from `docs/research/04-connectivity-payments-compliance.md` Part B (sources read 2026-11-07 during
research) unless marked `assumption`. Test paths are relative to `modules/payments/` (API tests:
`apps/api/test/payments.test.ts`). The review regression tests are in `test/review-regressions.test.ts`.

**Honesty rules used.** `tested` = Portico's own behavior is covered by an automated test (simulator and/or
recorded Stripe responses — never a real provider; no keys exist). A row whose real-world path needs an external
dependency we do not have (PCI vault, provider certification) says so in the Spec column; readiness levels live in
`docs/readiness/readiness-register.md`. MUSTs from the spec that are not built are `specified` or `deferred` with
the reason, never `built`.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-001 | Hotel legal entity is merchant of record; platform never holds funds (direct charges) | Mews [merchant terms](https://www.mews.com/en/legal/merchant-terms) · Cloudbeds [Adyen terms](https://www.cloudbeds.com/terms/cloudbeds-payments/adyen/) · Stripe [charges](https://docs.stripe.com/connect/charges) (research 04 §B2, §B5) | P0 | tested | PAY-R01, R03 | src/providers/stripe-connect.test.ts; test/authorizations.test.ts |
| PAR-PAY-002 | Provider-agnostic gateway / bring-your-own PSP | OPERA OPI [security guide](https://docs.oracle.com/en/industries/hospitality/payment-interface-cloud/23.1/scggc/F74518_01.pdf) (research 04 §B5) | P1 | built | PAY-R02 (adapter port; only simulator + Stripe Connect adapters exist) | src/providers/stripe-connect.test.ts |
| PAR-PAY-003 | Tokenized cards only; no PAN in the PMS (boundary + DB checks on every free-text column) | OPERA OPI (research 04 §B5) · Mews (assumption) | P0 | tested | PAY-R05, PAY-I05 | test/isolation-permissions.test.ts; test/review-regressions.test.ts (P2-6) |
| PAR-PAY-004 | Pre-authorization, incremental authorization, partial capture, release | Stripe [extended auth](https://docs.stripe.com/payments/extended-authorization) (research 04 §B6) · OPERA (assumption) | P0 | tested | PAY-R09 | test/authorizations.test.ts |
| PAR-PAY-005 | Authorization expiry tracking with a warning before expiry; expired holds shown as expired | Stripe extended auth (research 04 §B6) | P1 | tested | PAY-R10 (warning exception only; renewal task / automatic re-authorization deferred — needs collection plans PAY-R20) | test/authorizations.test.ts |
| PAR-PAY-006 | Card-on-file merchant-initiated charges (no-show, post-departure) only with a recorded mandate (terms version + acceptance); initiator derived by the server, never taken from the client | EBA Q&A / Visa (research 04 §B6) | P0 | tested | PAY-R11 (cross-check against the booking's agreed-terms snapshot waits for reservations) | test/authorizations.test.ts |
| PAR-PAY-007 | Refunds and partial refunds linked to the original payment; ceiling respects in-flight refunds and corrections | assumption (all PMS) | P0 | tested | PAY-R17 | test/scenario-s06-refund-retry.test.ts; test/review-regressions.test.ts (P1-4) |
| PAR-PAY-008 | Payment links / pay-by-link with status from the provider | Stripe [payment links with Connect](https://stripe.com/docs/connect/payment-links) (research 04 §B6) · Mews (research 02) | P0 | tested | PAY-R19 (allowed methods, partial flag, language and delivery via comms not built) | test/requests-vcc.test.ts |
| PAR-PAY-009 | OTA virtual card: metadata, charge scheduled at activation in property-local time, funding retries, never charged twice | Cloudbeds/Preno/myallocator VCC guides (research 04 §B6) | P0 | tested | PAY-R07 (scheduler and charging tested on the simulator; real VCC charging needs the PCI vault, PAR-PAY-032) | test/requests-vcc.test.ts |
| PAR-PAY-010 | Chargeback / dispute handling: record, deadline, fund movements through finance, refund blocked while disputed | research 04 §B6 (assumption on competitor UI) | P1 | building | PAY-R18 (evidence checklist only; evidence-pack export and dispute fee not built) | test/webhooks.test.ts; test/review-regressions.test.ts (P2-9) |
| PAR-PAY-011 | Payout reconciliation (gross, fees, net, included payments; items add up to gross) | Mews/Cloudbeds payments reporting (assumption) | P1 | tested | PAY-R25 | test/webhooks.test.ts |
| PAR-PAY-012 | Standalone terminal / external payments recorded with reference (approval code unique per terminal and day; audited override) | Route D, docs/readiness/responsibility-matrix.md (assumption for competitors) | P0 | tested | PAY-R24 | test/route-d-recorded.test.ts; test/review-regressions.test.ts (P1-3) |
| PAR-PAY-013 | Settlement / bank statement import (gross, fee, net) and auto-matching; acquirer fees posted to finance | research 04 §B7.5 (daily reconciliation) | P0 | tested | coordinator Route D | test/route-d-recorded.test.ts; test/review-regressions.test.ts (P1-9) |
| PAR-PAY-014 | Cash (confirmed at entry) and bank transfers (awaiting receipt until confirmed with the bank reference) | assumption (all PMS) | P0 | tested | PAY-R23 | test/route-d-recorded.test.ts; test/review-regressions.test.ts (P1-7) |
| PAR-PAY-015 | Payment automation / collection plans per booking (deposits, schedules, one executor per item) | Mews automation (research 02 §2.3, §2.5) · RMS (research 03 §7.3) | P1 | specified | PAY-R20–R22 (not built; interim: a payment request owns its purpose on a reference, P1-2) | — |
| PAR-PAY-016 | Hosted card entry with 3-D Secure in booking engine and check-in | Stripe Elements / Adyen Components (research 04 §B6) | P1 | specified | PAY-R06 (not built) | — |
| PAR-PAY-017 | Integrated card terminals at the desk | Mews terminals (research 04 §B3) | P1 | deferred | — (after pilot; Route D covers standalone terminals) | — |
| PAR-PAY-018 | Platform application fee on embedded payments (set by Monoclay operators only) | Stripe Connect application fees (research 04 §B2) | P2 | tested | PAY-R03 | src/providers/stripe-connect.test.ts; test/review-regressions.test.ts (P0-2) |
| PAR-PAY-019 | Refund approval above a threshold | assumption | P1 | specified | PAY-R17 (approval not built; refunds need `payments.refund.create`) | — |
| PAR-PAY-020 | Local Maldivian acquirer gateway adapter (e.g. BML Connect) | responsibility-matrix Route B (unconfirmed) | P1 | deferred | Q2 — waiting for an eligible hotel and bank API access | — |
| PAR-PAY-021 | Card verification without a charge ($0 / setup) to guarantee a booking | Stripe [SetupIntents](https://docs.stripe.com/payments/setup-intents) (assumption for PMS UIs) | P1 | deferred | needs hosted card entry PAY-R06; until then a guarantee is a pre-authorization (PAR-PAY-004) | — |
| PAR-PAY-022 | Card expiry tracking and network account updater | assumption (Stripe card updater for cards saved through Stripe) | P1 | deferred | expiry stored on the method (PAY-R05); expiry warnings and updater results arrive with PAY-R06/R16 | — |
| PAR-PAY-023 | Split tenders on one folio (part card, part cash/transfer) | assumption (all PMS) | P1 | built | sequential tenders allowed; one card collection in flight per folio at a time (PAY-R14, P1-1) | test/review-regressions.test.ts (P1-1) |
| PAR-PAY-024 | Card surcharges and tips | assumption | P2 | missing | — (surcharge rules are jurisdiction-specific; tips belong to F&B POS) | — |
| PAR-PAY-025 | Dynamic currency conversion / charging in the guest's currency | assumption | P2 | deferred | acquirer service; accounts declare their charge currencies (USD/MVR) — after pilot | — |
| PAR-PAY-026 | Payment receipt sent to the guest | assumption (all PMS) | P1 | deferred | needs comms (`message.guest`); finance issues the folio receipt | — |
| PAR-PAY-027 | Fraud screening / 3-D Secure on the booking engine | Stripe Radar / 3DS (research 04 §B6) | P1 | deferred | needs PAY-R06 and the guest booking engine (later wave) | — |
| PAR-PAY-028 | Refund to another method or to guest credit | assumption | P1 | deferred | refunds go to the original payment (PAY-R17); a refund paid outside Portico is recorded (Route D `recordRefund`); credit is finance's | — |
| PAR-PAY-029 | Payout fee breakdown per transaction | Stripe balance transactions (research 04 §B6) | P1 | deferred | payout-level gross/fees/net recorded (PAR-PAY-011); per-transaction fees come with PAY-R16 | — |
| PAR-PAY-030 | 3-D Secure challenge (`requires_action`) on staff and guest flows | Stripe [3DS](https://docs.stripe.com/payments/3d-secure) (research 04 §B6) | P1 | deferred | PAY-R12: `requires_action` is currently reported as a decline with "send a payment link" recovery; needs PAY-R06 | — |
| PAR-PAY-031 | Daily provider balance-transaction reconciliation | research 04 §B7.5 | P1 | deferred | PAY-R16 not built; interim: the event backstop job applies provider events never delivered (P0-3) | test/review-regressions.test.ts (P0-3 backstop) |
| PAR-PAY-032 | Virtual card data received from the channel into a PCI vault (only a token reaches Portico) | Cloudbeds/Preno VCC guides (research 04 §B6) | P1 | deferred | vault/proxy vendor unresolved (owner question); until then hotels charge VCCs on their own terminal and record them (PAR-PAY-012) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PAY-001 | Provider takes the money but the response times out | `pending_verification`; second charge blocked; lookup/webhook resolves to exactly one payment and posting | P0 | tested | test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-002 | Timeout and the provider did NOT take the money | Failed with recovery only after a confirmed not-found (grace + second lookup at least 1 h later, breaker closed); new attempt allowed; nothing posted | P0 | tested | test/scenario-s05-payment-timeout.test.ts; test/scenario-s20-provider-outage.test.ts |
| EC-PAY-003 | Refund interrupted after the provider accepted it; staff retry | Same refund returned; one refund posting; original untouched | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-004 | Duplicate webhooks | Stored once; no second effect | P0 | tested | test/webhooks.test.ts |
| EC-PAY-005 | Webhooks arrive out of order | Monotonic states; older snapshots ignored | P0 | tested | test/webhooks.test.ts |
| EC-PAY-006 | Provider outage during a busy shift | Honest failures; breaker; 503 with alternatives; recovery probe; no replays | P0 | tested | test/scenario-s20-provider-outage.test.ts |
| EC-PAY-007 | Worker down; payment intent not sent for 20 minutes | Intent cancelled ("nothing charged"), never sent late | P0 | tested | test/scenario-s20-provider-outage.test.ts |
| EC-PAY-008 | Two processes recover the same intent concurrently | Exactly one provider call | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-009 | Refund requested for more than remains refundable (incl. in-flight) | Refused with amounts explained; DB check as backstop | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-010 | Demo/trial/training organization with a Stripe account | Simulator only; HTTP never called | P0 | tested | test/environment-safety.test.ts |
| EC-PAY-011 | Sandbox configured with a live key | Refused before sending | P0 | tested | test/environment-safety.test.ts |
| EC-PAY-012 | Staff paste a card number into a token, reference, reason, note, name or description field, or a statement file | Refused at the boundary (every free-text input) and by DB checks on reference/reason/note columns; statement files with card-shaped values refused | P0 | tested | test/isolation-permissions.test.ts; test/review-regressions.test.ts (P2-6) |
| EC-PAY-013 | Another organization uses our payment/method ids | 404; RLS hides rows | P0 | tested | test/isolation-permissions.test.ts; apps/api/test/payments.test.ts |
| EC-PAY-014 | External system is the payments system of record | Actions refused with explanation | P0 | tested | test/isolation-permissions.test.ts |
| EC-PAY-015 | Same terminal approval code recorded twice the same day, incl. at the same moment from two desks | Exactly one record (unique index per account, terminal, reference, day); a genuine repeat needs an audited override | P0 | tested | test/review-regressions.test.ts (P1-3); test/route-d-recorded.test.ts |
| EC-PAY-016 | Settlement amount differs from the recorded amount | Exception with owner; correction by adjustment; verified after | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-017 | Recorded payment missing from the settlement statement | Exception; auto-resolved if a later statement contains it | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-018 | Statement line with no record in Portico | Exception "money arrived that no bill shows" | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-019 | VCC charged before it is funded | Retries 6/12/24/24/48 h; never charged twice; task on final failure | P0 | tested | test/requests-vcc.test.ts |
| EC-PAY-020 | VCC activation date vs UTC midnight (Maldives UTC+5) | Activation evaluated in property-local time | P0 | tested | test/requests-vcc.test.ts |
| EC-PAY-021 | Finance refuses the ledger posting | Payment stays succeeded; ledger `failed`; urgent exception; retried with backoff and the same key | P0 | tested | test/scenario-s05-payment-timeout.test.ts; apps/api/test/payments.test.ts |
| EC-PAY-022 | Payout arrives without fee breakdown | Not posted; exception until breakdown recorded | P1 | tested | test/webhooks.test.ts |
| EC-PAY-023 | Payout fails after being reported | Urgent exception; ledger reversal flagged if posted | P1 | tested | test/webhooks.test.ts |
| EC-PAY-024 | Dispute opened, then won | Debit and reversal recorded once each through finance | P1 | tested | test/webhooks.test.ts |
| EC-PAY-025 | Provider reports success for a payment recorded as failed | Applied (money never hidden) + urgent mismatch exception | P1 | built | src/domain/domain.test.ts (state machine) |
| EC-PAY-026 | Hold expires during a long stay | Warning before expiry; expired hold not usable | P1 | tested | test/authorizations.test.ts |
| EC-PAY-027 | Payment link paid after the request was cancelled or overpaid | Payment recorded; exception to refund or keep credit | P1 | built | — |
| EC-PAY-028 | Stripe webhook from live mode reaches a sandbox endpoint | Refused; never routed to a non-live organization | P0 | tested | test/webhooks.test.ts |
| EC-PAY-029 | Webhook processing fails half-way (DB error), or the provider never delivers an event | Marked processed only in the same transaction as its effects; redelivery reprocesses; the event backstop job lists provider events since a cursor and applies the missing ones | P0 | tested | test/review-regressions.test.ts (P0-3) |
| EC-PAY-030 | Two desks charge the same folio at the same moment | Exactly one collection in flight per folio (unique index); the other is told a charge is in progress | P0 | tested | test/review-regressions.test.ts (P1-1) |
| EC-PAY-031 | A deposit payment link is paid and the desk also charges the deposit | Desk charge refused (the request owns the purpose) unless staff state why it is a separate collection (audited) | P0 | tested | test/review-regressions.test.ts (P1-2) |
| EC-PAY-032 | Acquirer settles net of fees | Matched on gross; fees posted to finance once per statement; net = gross − fee checked | P0 | tested | test/review-regressions.test.ts (P1-9) |
| EC-PAY-033 | Refund after a recorded payment was corrected downwards | Refund ceiling uses the corrected amount | P0 | tested | test/review-regressions.test.ts (P1-4) |
| EC-PAY-034 | Collection references a folio/booking of another property or legal entity | Refused before any money moves; every posting carries property + legal entity for finance to re-check; with finance not connected, folio collections are refused | P0 | tested | test/review-regressions.test.ts (P0-1); apps/api/test/payments.test.ts |
| EC-PAY-035 | A second organization links (or claims by id) a connected account already in use | Refused; routing to exactly one organization; account status and application fee are provider/operator-controlled | P0 | tested | test/review-regressions.test.ts (P0-2) |
| EC-PAY-036 | Organization converts trial → live while a simulated intent is pending | Nothing is sent; intent cancelled as `environment_changed`; lookups only in the environment that issued it | P0 | tested | test/review-regressions.test.ts (P1-11) |
| EC-PAY-037 | The same idempotency key is reused with different content | Refused as a conflict; the original is not altered | P0 | tested | test/review-regressions.test.ts (P2-3) |
| EC-PAY-038 | Ledger failure recurs after staff resolved the exception | Exception reopened (never silently stays resolved) | P1 | tested | test/review-regressions.test.ts (P2-1) |
| EC-PAY-039 | Many cash payments banked as one daily deposit | Verified against the day's cash total, not one line per guest | P1 | tested | test/review-regressions.test.ts (P2-12) |
| EC-PAY-040 | Refund requested on a disputed payment | Refused (the bank may already return the money) | P1 | tested | test/review-regressions.test.ts (P2-9) |
| EC-PAY-041 | Bank statement contains account numbers or long transfer references | Kept as "[number ending 1234]" (DB refuses 12+ digit runs); card-shaped values refuse the file | P1 | tested | src/domain/domain.test.ts |
| EC-PAY-042 | Staff enter a bank reference with 12+ digits | Refused with an explanation (could be a card number); enter the last digits — PCI scope beats convenience (PAY-I05) | P2 | different | — |
