# Payments — competitive parity matrix and edge-case catalogue

Format: `docs/parity/README.md` (move this file to `docs/parity/payments.md` at merge). Market evidence comes from
`docs/research/04-connectivity-payments-compliance.md` Part B (sources read 2026-11-07 during research) unless marked
`assumption`. Test paths are relative to `modules/payments/` (API tests: `apps/api/test/payments.test.ts`).

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PAY-001 | Hotel legal entity is merchant of record; platform never holds funds (direct charges) | Mews [merchant terms](https://www.mews.com/en/legal/merchant-terms) · Cloudbeds [Adyen terms](https://www.cloudbeds.com/terms/cloudbeds-payments/adyen/) · Stripe [charges](https://docs.stripe.com/connect/charges) (research 04 §B2, §B5) | P0 | tested | PAY-R01, R03 | src/providers/stripe-connect.test.ts; test/authorizations.test.ts |
| PAR-PAY-002 | Provider-agnostic gateway / bring-your-own PSP | OPERA OPI [security guide](https://docs.oracle.com/en/industries/hospitality/payment-interface-cloud/23.1/scggc/F74518_01.pdf) (research 04 §B5) | P1 | built | PAY-R02 | src/providers/stripe-connect.test.ts (adapter port; second real adapter not built) |
| PAR-PAY-003 | Tokenized cards only; no PAN in the PMS | OPERA OPI (research 04 §B5) · Mews (assumption) | P0 | tested | PAY-R05 | test/isolation-permissions.test.ts |
| PAR-PAY-004 | Pre-authorization, incremental authorization, partial capture, release | Stripe [extended auth](https://docs.stripe.com/payments/extended-authorization) (research 04 §B6) · OPERA (assumption) | P0 | tested | PAY-R09 | test/authorizations.test.ts |
| PAR-PAY-005 | Authorization expiry tracking and renewal reminder | Stripe extended auth (research 04 §B6) | P1 | tested | PAY-R10 | test/authorizations.test.ts |
| PAR-PAY-006 | Card-on-file merchant-initiated charges (no-show, post-departure) with mandate | EBA Q&A / Visa (research 04 §B6) | P0 | tested | PAY-R11 | test/authorizations.test.ts |
| PAR-PAY-007 | Refunds and partial refunds linked to the original payment | assumption (all PMS) | P0 | tested | PAY-R17 | test/scenario-s06-refund-retry.test.ts |
| PAR-PAY-008 | Payment links / pay-by-link with status from the provider | Stripe [payment links with Connect](https://stripe.com/docs/connect/payment-links) (research 04 §B6) · Mews (research 02) | P0 | tested | PAY-R19 | test/requests-vcc.test.ts |
| PAR-PAY-009 | OTA virtual card charging on activation date with funding retries | Cloudbeds/Preno/myallocator VCC guides (research 04 §B6) | P0 | tested | PAY-R07 | test/requests-vcc.test.ts |
| PAR-PAY-010 | Chargeback / dispute handling with evidence | research 04 §B6 (assumption on competitor UI) | P1 | tested | PAY-R18 | test/webhooks.test.ts |
| PAR-PAY-011 | Payout reconciliation (gross, fees, net, included payments) | Mews/Cloudbeds payments reporting (assumption) | P1 | tested | PAY-R25 | test/webhooks.test.ts |
| PAR-PAY-012 | Standalone terminal / external payments recorded with reference | Route D, docs/readiness/responsibility-matrix.md (assumption for competitors) | P0 | tested | PAY-R24 | test/route-d-recorded.test.ts |
| PAR-PAY-013 | Settlement / bank statement import and auto-matching | research 04 §B7.5 (daily reconciliation) | P0 | tested | coordinator Route D | test/route-d-recorded.test.ts |
| PAR-PAY-014 | Cash and bank-transfer payments with references | assumption (all PMS) | P0 | tested | PAY-R23 | test/route-d-recorded.test.ts |
| PAR-PAY-015 | Payment automation / collection plans per booking (deposits, schedules) | Mews automation (research 02 §2.3, §2.5) · RMS (research 03 §7.3) | P1 | specified | PAY-R20–R22 | — |
| PAR-PAY-016 | Hosted card entry with 3-D Secure in booking engine and check-in | Stripe Elements / Adyen Components (research 04 §B6) | P1 | specified | PAY-R06 | — |
| PAR-PAY-017 | Integrated card terminals at the desk | Mews terminals (research 04 §B3) | P1 | deferred | — (after pilot; Route D covers standalone terminals) | — |
| PAR-PAY-018 | Platform application fee on embedded payments | Stripe Connect application fees (research 04 §B2) | P2 | tested | PAY-R03 | src/providers/stripe-connect.test.ts |
| PAR-PAY-019 | Refund approval above a threshold | assumption | P1 | specified | PAY-R17 | — |
| PAR-PAY-020 | Local Maldivian acquirer gateway adapter (e.g. BML Connect) | responsibility-matrix Route B (unconfirmed) | P1 | deferred | Q2 — waiting for an eligible hotel and bank API access | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PAY-001 | Provider takes the money but the response times out | `pending_verification`; second charge blocked; lookup/webhook resolves to exactly one payment and posting | P0 | tested | test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-002 | Timeout and the provider did NOT take the money | Lookup → failed with recovery; new attempt allowed; nothing posted | P0 | tested | test/scenario-s05-payment-timeout.test.ts |
| EC-PAY-003 | Refund interrupted after the provider accepted it; staff retry | Same refund returned; one refund posting; original untouched | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-004 | Duplicate webhooks | Stored once; no second effect | P0 | tested | test/webhooks.test.ts |
| EC-PAY-005 | Webhooks arrive out of order | Monotonic states; older snapshots ignored | P0 | tested | test/webhooks.test.ts |
| EC-PAY-006 | Provider outage during a busy shift | Honest failures; breaker; 503 with alternatives; recovery probe; no replays | P0 | tested | test/scenario-s20-provider-outage.test.ts |
| EC-PAY-007 | Worker down; payment intent not sent for 20 minutes | Intent cancelled ("nothing charged"), never sent late | P0 | tested | test/scenario-s20-provider-outage.test.ts |
| EC-PAY-008 | Two processes recover the same intent concurrently | Exactly one provider call | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-009 | Refund requested for more than remains refundable (incl. in-flight) | Refused with amounts explained; DB check as backstop | P0 | tested | test/scenario-s06-refund-retry.test.ts |
| EC-PAY-010 | Demo/trial/training organization with a Stripe account | Simulator only; HTTP never called | P0 | tested | test/environment-safety.test.ts |
| EC-PAY-011 | Sandbox configured with a live key | Refused before sending | P0 | tested | test/environment-safety.test.ts |
| EC-PAY-012 | Staff paste a card number into a token, reference or name field | Refused at the boundary and by DB check | P0 | tested | test/isolation-permissions.test.ts |
| EC-PAY-013 | Another organization uses our payment/method ids | 404; RLS hides rows | P0 | tested | test/isolation-permissions.test.ts |
| EC-PAY-014 | External system is the payments system of record | Actions refused with explanation | P0 | tested | test/isolation-permissions.test.ts |
| EC-PAY-015 | Same terminal approval code recorded twice | Refused (would double the payment) | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-016 | Settlement amount differs from the recorded amount | Exception with owner; correction by adjustment; verified after | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-017 | Recorded payment missing from the settlement statement | Exception; auto-resolved if a later statement contains it | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-018 | Statement line with no record in Portico | Exception "money arrived that no bill shows" | P0 | tested | test/route-d-recorded.test.ts |
| EC-PAY-019 | VCC charged before it is funded | Retries 6/12/24/24/48 h; never charged twice; task on final failure | P0 | tested | test/requests-vcc.test.ts |
| EC-PAY-020 | VCC activation date vs UTC midnight (Maldives UTC+5) | Activation evaluated in property-local time | P0 | tested | test/requests-vcc.test.ts |
| EC-PAY-021 | Finance refuses the ledger posting | Payment stays succeeded; ledger `failed`; urgent exception; retried with same key | P0 | tested | test/scenario-s05-payment-timeout.test.ts; apps/api/test/payments.test.ts |
| EC-PAY-022 | Payout arrives without fee breakdown | Not posted; exception until breakdown recorded | P1 | tested | test/webhooks.test.ts |
| EC-PAY-023 | Payout fails after being reported | Urgent exception; ledger reversal flagged if posted | P1 | tested | test/webhooks.test.ts |
| EC-PAY-024 | Dispute opened, then won | Debit and reversal recorded once each through finance | P1 | tested | test/webhooks.test.ts |
| EC-PAY-025 | Provider reports success for a payment recorded as failed | Applied (money never hidden) + urgent mismatch exception | P1 | built | src/domain/domain.test.ts (state machine) |
| EC-PAY-026 | Hold expires during a long stay | Warning before expiry; expired hold not usable | P1 | tested | test/authorizations.test.ts |
| EC-PAY-027 | Payment link paid after the request was cancelled or overpaid | Payment recorded; exception to refund or keep credit | P1 | built | — |
| EC-PAY-028 | Stripe webhook from live mode reaches a sandbox endpoint | Refused; never routed to a non-live organization | P0 | tested | test/webhooks.test.ts |
