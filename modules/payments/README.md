# @portico/payments

Guest money through the **hotel legal entity's own merchant account** (owner decision D2, ADR-0007). Monoclay never
holds guest funds; the domain is provider-agnostic; every provider call is journaled; an unknown outcome is
`pending_verification` and is resolved by provider lookup or webhook — never guessed, never re-sent.

Schema `payments` · permissions prefix `payments.` · spec: `docs/specs/payments.md` (product worktree, Draft v1) ·
domain map § payments.

## Checkpoint

- **Done:** wave-1 module, then the steward review fixes (`docs/orchestration/reviews/review-payments.md`, verdict
  "merge after fixes"): P0-1, P0-2, P0-3, P1-1…P1-11, P2-1/2/3/4/6/9/12/13, P3-1/3/4/7/10 — see § Steward review
  fixes. The module draft `PARITY.md` is deleted: main's broader steward matrix `docs/parity/payments.md` supersedes
it, now re-verified against the fixes (overclaims corrected, review rows and edge cases added). Its gate does not
pass — 28 P0 rows/edge cases are not `tested` (mostly unbuilt MUSTs: collection plans, hosted card entry, PCI
proxy, connected-mode forwarding — see § Spec MUSTs not built); that is the honest state. Main merged.
- **In progress:** nothing.
- **Next steps (orchestrator):** bind `LedgerPort` to finance (`FOUNDATION_REQUESTS.md` §5 — finance must re-check
  scope), apply the provider contract below to the domain map, role-template additions (§1).
- **Known failing tests:** none (113 module tests, 7 payments API tests; full `pnpm test`, `pnpm lint`, `pnpm typecheck` green after merging main).

## What is built (wave 1)

| Area | Capability | Spec | Status | Readiness |
|---|---|---|---|---|
| Accounts | Payment account per legal entity: provider, external account id, capabilities, onboarding status, country/currencies, status `pending/active/restricted/disabled` | PAY-R01 | done | R3 |
| Accounts | Ownership (P0-2): a provider account id is globally unique (one organization; unambiguous webhook routing); Stripe accounts are linked and application fees set only by Monoclay operators (`operator.linkProviderAccount`, `operator.setApplicationFee`); a Stripe account's activation comes only from Stripe (`account.updated`) — tenants can only disable it | PAY-R01, R03 | done | R3 |
| Accounts | Merchant-of-record guard: an account may only be used for properties operated by its legal entity | PAY-R01 | done | R3 |
| Providers | Provider-agnostic adapter port (`authorize`, `incrementAuthorization`, `capture`, `void`, `charge`, `refund`, `lookup`, `createPaymentLink`, `parseWebhook`) with declared capabilities | PAY-R02 | done | R3 |
| Providers | **SimulatorProvider** (default for demo/trial/training/tests), DB-backed so API and worker share one simulated provider; approved test tokens only (`pm_card_*`, `sim_*`); scenarios: approve, decline (reason codes), soft decline, timeout→succeeded, timeout→failed, outage (refuse / timeout), duplicate and out-of-order webhooks, delayed settlement, dispute, VCC funding delay | PAY-R03 | done | R3 (simulator — never called an integration) |
| Providers | **StripeConnectProvider**: direct charges on the connected account (`Stripe-Account`), PaymentIntents with manual capture + extended authorization `if_available`, idempotency keys forwarded, optional `application_fee_amount`, lookups (by id / metadata search), Checkout Session links, webhook signature verification; injectable HTTP client | PAY-R03 | code + unit tests against recorded/mock responses only; **never called Stripe** (no keys) | **R3 adapter code; R1 as an integration** (not R4 — no sandbox test yet) |
| Providers | **Route D — external terminal / recorded** (`external_terminal` account kind): card payments taken on the hotel's own terminal/gateway (e.g. BML), cash and bank transfer are *recorded* (`recorded_unverified`), posted at record time, verified by statement matching, never presented as provider-verified | coordinator, PAY-R23/R24 | done | R3 (likely first Maldives pilot path; R7 needs a hotel) |
| Safety | Every provider call gated by `assertExternalEffectAllowed(ctx,'payment.charge')`: simulate → simulator **always** (even for a Stripe account), sandbox → Stripe TEST keys only, live → LIVE keys; simulator accounts refused in live; unknown keys → nothing sent | PAY-R04, PAY-I06 | done | R3 |
| Journal | Provider-operation journal: intent committed before the call (operation, amount, idempotency key), claim `pending→sent` (one sender), outcome recorded; append-only `operation_journal` | PAY-R04, ADR-0007 | done | R3 |
| Methods | Tokens only (brand, last4, expiry, holder, owner, MIT agreement + mandate, token portability notes); PAN/CVC refused at Zod, service and DB check levels | PAY-R05, PAY-I05 | done | R3 |
| Holds | Authorizations (`processing, pending_verification, authorized, partially_captured, captured, voided, expired, failed`), partial/multiple captures, increments, release, expiry from provider or policy `payments.authorization.validityDays` (default 7), renewal warning `payments.authorization.renewBeforeDays` (default 2) | PAY-R09, PAY-R10 (warning task only) | done | R3 |
| Charges | Who initiates is a server fact (SW-PAY-4): only a guest acting for themselves is customer-initiated, and only with a card saved for them and entered by them (judged on `cardholder_ref`, which a profile merge never rewrites). **Cardholder consent bounds every hotel-initiated use** (ADR-0015 Amendments 2–4, `service/consent.ts`), and every input to it is a cardholder or server fact, never a client label: **purposes are derived where the money lands** (`service/purpose.ts`; Amendment 5 — a charge and a capture alike: a hold's `guarantee` never carries over to its capture, and the fact limits apply at landing under the collection lock): a booking collects a `deposit` up to what the booking's agreed payment schedule asks for, a folio its `balance` up to what it owes (less deposits held and payments not yet posted), and `no_show` only on the folio of a stay whose no-show (night audit, `reservations.stay.noShow`) or cancellation penalty reservations recorded, up to what that penalty still owes — the label a client sends is display text; **coverage**: only the bookings and folios the agreement names, each booking with the stays it had when the cardholder consented (server-built evidence: the server's time and channel, the client's channel kept as declared); a no-show fee rests on the penalty as it stands on the ledger (posted − credited − collected), never the record alone; a deposit is forfeited only up to the penalty still owed on the ledger, and the forfeit settles that penalty (applied to the folios carrying it, so no other method can collect it again; Amendment 6 rule 1) — with no penalty owed, a card-funded deposit is not forfeited; a stay added later is not covered, and a booking-level reference (the booking or a folio it owns) only while every current stay is listed; **where money lands** (Amendment 4 rule 2): a folio carrying another stay's or booking's charges (transferred — followed to the original posting — or routed, or to be routed by an active rule; every non-zero posting has an owner: a refund, reversal, correction, allowance or receivables transfer is debt of the folio it was first posted on, an unknown origin fails closed) is not covered; finance asks the same question (`cardMoneyMayMeet`) before it applies a card-funded deposit, transfers money or charges between folios, or routes charges to a folio, and refuses an uncovered move — on the destination for what lands there, and on the source for the debit a moved credit leaves behind (that debit is owned by whoever the credit now benefits, so card money on the source never meets it; R7-P1-2); the destination is re-checked under the collection lock; **amount**: an agreement recorded by staff must state `maxAmount` (rule 3; only the cardholder, saving their own card, may choose no limit, explicitly); `maxAmount` is the total taken or held (charges and captures in flight, pending verification or done, every open hold, every hold increase in flight, this use), read under a lock on the card row. No staff-editable relationship (booker, occupant, payer, profile merge, add-stay, transfer, routing) extends coverage. More bookings are added to an existing agreement only by the cardholder (`confirmCardForBooking`, guest actor) — **not reachable until the guest portal ships** (no route); consent capture through a payment link or the terminal is **not built**. A future-stays / payer-account scope is not offered (Q160). A customer-initiated hold is captured only inside its booking family and, like every capture, within the fact it lands on (deposit due, folio owed, penalty owed; R7-P3-2). A capture's idempotency hash includes its purpose label and separate-collection reason (R7-P3-1). Completing a recorded (own-terminal) hold with `recordPayment` requires the hold's property and booking family and refuses more than it still holds (R7-P3-3). Charges, holds, increases and captures not covered need new cardholder consent. A card is a parameter only at the property it was saved at (SW-PAY-3). One collection lock per booking family on every path; a link owns its money across the family (SW-PAY-1/2, R3-P2-1). `assessGuaranteeCard` (a named booking is the agreed guarantee only while inside consent) and `syncBalanceRequest` for other modules; decline explanations with recovery | PAY-R11 (no cross-check with the booking's terms snapshot yet), PAY-R12 (`requires_action` → decline) | partial | R3 |
| Ledger targets | Before any money moves, finance must place the folio/booking (`LedgerPort.describeTarget`) in the caller's property **and** legal entity; every posting carries `{propertyId, legalEntityId}` + clearing account (P0-1) | PAY-I01, ADR-0007 | done | R3 |
| Collections | One collection in flight per folio/booking (unique index, concurrent-safe); a payment request owns its purpose on a reference — a desk charge / recorded payment / VCC charge for the same purpose needs `separateCollection.reason` (audited) (P1-1, P1-2) | PAY-R14, interim for PAY-R20 | done | R3 |
| Verification | `pending_verification` first-class; second collection on the same folio/booking blocked while one is pending; "check now"; resolver backoff 10 s/30 s/2 min/10 min/1 h/6 h; "not found" conclusive only after the 15 min grace **and** a second not-found at least 1 h later with the breaker closed; escalation exception after 24 h; an intent is never sent (or looked up) in an environment other than the one that recorded it (`environment_changed`, P1-11) | PAY-R13, PAY-R14 | done | R3 |
| Webhooks | Signature-verified, dedupe by provider event id, stored (card data scrubbed); marked processed only in the same transaction as its effects, so a failed processing is redone on redelivery; hourly **event backstop** lists provider events since a per-account cursor and applies missed ones (P0-3); out-of-order safe; ambiguous routing refused | PAY-R15, PAY-I07 | done | R3 |
| Reconciliation | Callable `runReconciliation`, worker consumers (`payments.operation-executor`, `payments.reconciler`), scheduled jobs (`payments.reconcile` 60 s, `payments.eventBackstop` 1 h, `payments.chargeDueVirtualCards` 15 min); ledger retries with backoff 1 min/5 min/30 min/2 h/6 h, then daily; mismatches → exceptions | PAY-R13, PAY-R16 (provider balance-transaction sweep not built) | partial | R3 |
| Refunds | Separate records referencing the payment; partial; Σ refunds (succeeded + in-flight) ≤ collected **after corrections** (P1-4), enforced by a DB check; retry never refunds twice; refused while disputed; recorded refunds for Route D | PAY-R17, PAY-I03 | done (no approval threshold) | R3 |
| Disputes | From webhooks: record, evidence checklist (If-Match updates), status, deadline exception, ledger debit/reversal through `LedgerPort.recordDisputeMovement` (proposed) | PAY-R18 | done (evidence submission/accept happen in the provider dashboard) | R3 |
| Requests | Payment requests/links (`open/partially_paid/paid/expired/cancelled`), paid only from provider-confirmed payments; link created after commit, retried when the provider is back. A replaced, cancelled or expired link is deactivated at the provider before a replacement is sent (`link_status` `deactivating → deactivated`, or `completed` when the provider answers "already paid" — the replacement then waits until that payment is recorded). A deactivation not confirmed within 30 minutes raises `payment_link_not_stopped` (urgent, owner finance); a finance role (`payments.reconciliation.manage`) can confirm a link they stopped in the dashboard — only while that exception is open, at the version seen (`POST /payments/requests/:id/link-stopped` with If-Match, audited) — and never a link the provider reported as paid (`completed`: the replacement waits for that payment to be recorded). A payment on a retired link raises an urgent refund item for exactly the over-collected amount (paid minus what the folio still owed), stating the folio's credit and this payment's share separately; none when nothing was over-collected. "Already paid" counts as recorded only when the request's paid total reaches the link's amount (an earlier partial payment is not it). Stripe Checkout links live at most 23 h (adapter unit-tested only) | PAY-R19 | done (simulator; Stripe adapter code only) | R3 |
| VCC | OTA virtual cards: metadata separate from the token (vault alias), charge exactly the amount from the property-local activation date, funding-delay retries (6/12/24/24/48 h), final failure → owned task | PAY-R07 | done; **PCI vault/proxy unresolved** | R3 (vault dependency R1) |
| Payouts | Gross/fees/net + included payments/refunds; ledger only when paid and the breakdown is known; webhook payouts without breakdown flagged; failed payouts flagged | PAY-R25 | done | R3 |
| Outage | Circuit breaker per account (3 consecutive unavailability errors → open 60 s → one probe); visible via `/payments/accounts/:id/health` and `/payments/status`; staff actions: accept cash / payment link later / record manual authorization / record terminal payment | PAY-R26, s20 | done (automation pause/re-validation: see gaps) | R3 |
| Statements | CSV statement import (file-based, labeled `file_import`): terminal batch, acquirer settlement (gross/fee/net, fees posted to finance via `recordSettlementFees`), bank statement, cash deposit (matched against the day's cash total); matching by reference/approval code, then amount+date+last4; mismatches → exceptions with owner; a match tells finance the money is verified (`markPaymentVerified`); corrections are linked adjustments; card-shaped values refuse the file, other long numbers are kept as last 4 digits | coordinator (Route D) | done | R3 |
| Route D | Own-terminal approval code unique per account, terminal, reference and property-local day (DB index; audited `duplicateOverride` for a genuine repeat); bank transfers are `awaiting_receipt` (not on the bill) until `confirm-receipt` with the bank reference (`payments.bankTransfer.confirm`), or `cancel-expected` (P1-3, P1-7) | PAY-R23, R24 | done | R3 |
| Experience | Universal record contract on payment, authorization, refund, payment request, exception (`status` per family, `allowedActions` with reasons, `issues`, `owner`, `links`, `provenance`); `recordTypes`; `paymentsSearch` (provider ref, approval/terminal/bank ref, "last4 amount") | CLAUDE.md §4.17 | done | R3 |
| Authority | `platform.assertWritable(…,'payments')` on every write; `forward` refused with an explanation | ADR-0014 | done | R3 |

### Spec MUSTs not built (honest gaps, review P1-12)

| Spec | Missing | Interim behavior | Parity row |
|---|---|---|---|
| PAY-R06 | Hosted card entry pages (PSP components, CSP/SRI) | Methods are saved from provider tokens only | PAR-PAY-021, 029, 046 |
| PAY-R10 | Renewal task / automatic re-authorization | Warning exception before expiry; expired holds shown as expired | PAR-PAY-033, EC-PAY-011 |
| PAY-R11 | Cross-check of MIT against the booking's agreed-terms snapshot | Mandate (terms version + acceptance) on the saved card required | PAR-PAY-037, EC-PAY-015 |
| PAY-R12 | `requires_action` (3DS challenge) | Reported as a decline with "send a payment link" recovery | PAR-PAY-039 |
| PAY-R16 | Daily provider balance-transaction reconciliation | Event backstop job (missed webhooks) + statement import | PAR-PAY-055, 058 |
| PAY-R17 | Refund approval above a threshold | `payments.payment.refund` (sensitive) required | PAR-PAY-061 |
| PAY-R18 | Evidence-pack export; dispute fee | Evidence checklist; evidence submitted in the provider dashboard | PAR-PAY-065 |
| PAY-R19 | Allowed methods, partial flag, language, delivery via comms (`message.guest`) | Link created; staff send it | PAR-PAY-070, 081 |
| PAY-R20–R22 | Collection plans, plan diffs, automation policies | A payment request owns its purpose on a reference (P1-2); one collection in flight per reference | PAR-PAY-072–074, 082 |
| PAY-R07 (real path) | PCI vault/proxy for OTA card data | VCC logic on the simulator; hotels charge VCCs on their own terminal and record them | PAR-PAY-027 |

Also not built: local Maldivian acquirer adapters (Q2), Adyen, integrated terminals, forwarding payments to an
external folio in connected mode, journaling of payment-link creation as a provider operation (review P3-6 — Stripe
idempotency keys expire after 24 h, so a link retried after a day may create a second Checkout Session; only one is
ever recorded as the request's link), payload minimisation/retention for stored webhook payloads (P3-8).

## Invariants and the tests that prove them

| Invariant | Proof |
|---|---|
| No ledger posting for an authorization, request, `processing` or `pending_verification` operation; exactly one per succeeded payment/refund (PAY-I01) | `scenario-s05` (one posting after timeout + retry + reconciliation + webhooks + worker), `authorizations` (holds never post), `scenario-s06` |
| Provider idempotency key persisted before the call, one per operation; at most one send (PAY-I02) | `scenario-s05` (journal `attempts = 1`), `scenario-s06` (two racing executors → one send), `scenario-s20` (timeout never re-sent) |
| Σ refunds (succeeded + in-flight) ≤ collected (PAY-I03) | DB check `refunded_minor + refund_reserved_minor <= amount_minor`; `scenario-s06` partial refunds |
| No PAN/CVC anywhere (PAY-I05) | `isolation-permissions` (Zod `.strict()` + token refinements, DB check, schema scan, audit has no token); `domain.test` scrubber |
| Non-live never runs live; demo/trial/training never reach Stripe (PAY-I06) | `environment-safety` (HTTP spy never called; mode-mismatched keys refused; simulator refused in live) |
| Webhook event processed at most once (PAY-I07) | `webhooks` (duplicates), `scenario-s06` |
| Monotonic states; late events never move backwards; contradictions → exceptions | `domain.test` state machines, `webhooks` out-of-order |
| Recorded (Route D) money is never shown as provider-verified; corrections are adjustments | `route-d-recorded` |
| Outage: nothing shows success; nothing is replayed blindly; stale intents are cancelled, not sent late | `scenario-s20` |
| Merchant of record = property's legal entity; ledger targets belong to the caller's property and legal entity | `authorizations`, `review-regressions` (P0-1), API test (finance not connected → folio refused) |
| A provider account belongs to one organization; status/fees not tenant-controlled | `review-regressions` (P0-2) |
| No webhook effect is lost (processing failure or missed delivery) | `review-regressions` (P0-3) |
| One collection in flight per reference; duplicates are DB facts (concurrent tests) | `review-regressions` (P1-1, P1-2, P1-3) |
| Tenant isolation and property-scoped permissions | `isolation-permissions`, `apps/api/test/payments.test.ts` |

## Scenarios covered

| Test file | Demonstrates |
|---|---|
| `test/scenario-s05-payment-timeout.test.ts` | Timeout after the provider took the money → pending verification (presentation, issues, actions), second charge blocked, reconciliation/retry/webhook/worker/job resolve to exactly one payment and one posting; timeout-then-failed variant |
| `test/scenario-s06-refund-retry.test.ts` | Interrupted refund retried with the same key → same refund, one posting, duplicate + out-of-order webhooks; racing executors send once; partial refunds; failed refund releases reservation |
| `test/scenario-s20-provider-outage.test.ts` | Outage during the shift: honest failures, breaker opens, 503 with alternatives, cash / manual authorization / link-later, recovery probe, pending link created on recovery, no replays; timeouts during outage resolved only by lookup; stale intents cancelled |
| `test/route-d-recorded.test.ts` | Own-terminal, cash and bank-transfer recording, statement matching, owned exceptions, adjustments, recorded refunds and manual authorizations |
| `test/webhooks.test.ts` | Dedupe, out-of-order, disputes (+ ledger debit/reversal), payouts (+ breakdown/failed flags, delayed settlement), Stripe public intake (signature, routing, mode separation) |
| `test/environment-safety.test.ts`, `test/isolation-permissions.test.ts`, `test/authorizations.test.ts`, `test/requests-vcc.test.ts` | as named |
| `test/review-regressions.test.ts` | One regression test per steward finding (P0-1…P2-12), incl. the reviewer's concurrency and failure-injection cases |
| `test/review-r4-regressions.test.ts` | Re-review #4: stays added after a consent, named folios, foreign bookings/folios, cardholder-only confirmation, concurrent holds against the total, guest card ownership, customer-hold family |
| `test/review-r5-regressions.test.ts` | Re-review #5: no-show fee only on a recorded penalty and up to it, deposit and balance up to their facts, debt origins on a folio, staff agreements capped, server-set evidence, stable cardholder after a merge, the card-row lock with the competitor inside the window |
| `apps/api/test/review-regressions-r7.test.ts` | Re-review #7: one balance per penalty across forfeit, card, credit and cheque (F1–F3, N1, N2), moved credits keep their counterpart's owner (M1 and boundaries), a DB-level posting of unknown origin fails closed |
| `apps/api/test/money-invariant.test.ts` | Seeded model-based test of the money invariant (Amendment 6 rule 2): random sequences of every money operation over the real composition, invariants after every step; fixed seeds in CI, `MONEY_SEEDS` / `MONEY_STEPS` for a long run |
| `apps/api/test/review-regressions-r5.test.ts` | Re-review #5 PoC flips over the real composition: no-show after the night audit (and cancellation penalties), add-stay then booking deposit and deposit application (both orders), folio transfers and routing (both orders), the post-lock re-check, finance-only link confirmation, uncertain charges and holds in the total, partial payments before "already paid", the `applyDeposits` lock order (held lock + NOWAIT probe) |
| `apps/api/test/review-regressions-r4.test.ts` | Re-review #4 PoC flips over the real composition (booker / add-stay / merge never extend consent, concurrent charges and holds, over-collection amount, expiry and "already paid", unconfirmed deactivation, E-114 lock-window tests) |
| `apps/api/test/payments.test.ts` | s05 and s20 over HTTP via the composition root (booking deposits — finance not merged), folio refused without finance, 402 declines with recovery, PAN refusal, If-Match on simulator controls, isolation and search, public Stripe webhook route |

Counts (integration-step fix round 6): 161 module tests (39 domain unit, 17 Stripe adapter unit, 105 integration on
Postgres incl. 57 review regressions) + 7 API end-to-end (`apps/api/test/payments.test.ts`); the cross-module review
regressions are in `apps/api/test/review-regressions*.test.ts`.

## HTTP (all under `/v1`)

Accounts `GET/POST /payments/accounts`, `GET/PATCH /payments/accounts/:id` (If-Match), `GET …/:id/health`,
simulator: `PUT …/:id/simulator-controls` (If-Match), `POST …/:id/simulator/deliver-webhooks`, `GET /payments/simulator/test-tokens` ·
methods `POST/GET /payments/methods`, `GET /payments/methods/:id`, `POST …/:id/detach` (If-Match) ·
holds `POST /payments/authorizations`, `POST /payments/authorizations/recorded`, `GET …/:id`, `POST …/:id/{increment,capture,void,check}` ·
payments `POST /payments/charges`, `POST /payments/recorded`, `GET /payments/transactions/:id[/history]`, `POST …/:id/check`,
`POST …/:id/confirm-receipt`, `POST …/:id/cancel-expected` (bank transfers, If-Match),
`GET /payments/status-by-ref`, `POST /payments/adjustments` · refunds `POST /payments/refunds`, `POST /payments/refunds/recorded`,
`GET/POST /payments/refunds/:id[/check]` · requests `POST/GET /payments/requests`, `GET …/:id`, `POST …/:id/cancel` (If-Match),
`POST …/:id/simulate-payment` (Idempotency-Key) · VCC `POST /payments/virtual-cards`, `GET …/:id`, `POST …/run-due` · disputes
`GET /payments/disputes`, `GET …/:id`, `PATCH …/:id/evidence` (If-Match) · `POST/GET /payments/payouts` ·
`POST /payments/statements` · `GET /payments/exceptions`, `POST …/:id/resolve` (If-Match) · `GET /payments/status`,
`POST /payments/reconciliation/run` · **public** `POST /payments/webhooks/stripe` (raw body, signature-verified).

Every create and money movement requires `Idempotency-Key`. Status codes: 201 confirmed/recorded, 202 pending
(processing / pending verification), 402 declined/failed (problem+json with the record in `details` and the recovery
in `detail`), 503 `card_payments_unavailable` with `details.actions`.

## Permissions

`payments.payment.read` · `payments.payment.collect` · `payments.payment.refund` ⚑ · `payments.paymentRequest.create` ·
`payments.method.manage` · `payments.vcc.manage` · `payments.externalRecord.create` (own terminal, cash, expected
transfers) · `payments.bankTransfer.confirm` ⚑ · `payments.reconciliation.manage` ⚑ · `payments.dispute.manage` ⚑ ·
`payments.account.read` (org) · `payments.account.manage` ⚑ (org) · `payments.payout.manage` ⚑ (org).
Reads accept `payments.payment.read` **or** `payments.payment.collect` (the front-desk role template has collect but
not read — role-template additions requested in `FOUNDATION_REQUESTS.md` §1). Linking a Stripe account and setting
an application fee are **not** tenant permissions: they are Monoclay-operator functions (system actor with process
`operator:*`).

## Events

Emitted: `payments.account.created|statusChanged`, `payments.operation.requested|pendingVerification` (internal,
consumed by this module's worker consumers), `payments.authorization.authorized|failed|voided|expired|captured`,
`payments.payment.succeeded|failed|pendingVerification|recorded|verified|adjusted`,
`payments.refund.succeeded|failed|pendingVerification|recorded`, `payments.request.created|paid|expired|cancelled`,
`payments.dispute.opened|updated|closed`, `payments.payout.paid|failed`, `payments.provider.degraded|restored`,
`payments.exception.raised|resolved`, `payments.vcc.charged|failed`, `payments.statement.imported`. Payloads never
carry card data or tokens. Consumed: own operation events only (wave 1).

## Ports and binding status

| Port | Provider | Binding in `apps/api/src/composition.ts` |
|---|---|---|
| `LedgerPort` (`describeTarget`, `recordPayment`, `recordDeposit`, `recordRefund`, `recordPayout`, `recordPaymentAdjustment`, `recordDisputeMovement`, `markPaymentVerified`, `recordSettlementFees` — types in § Ledger contract) | finance | **bound (integration step)** to `financeLedgerForPayments(finance)`; `apps/api/test/payments.test.ts`, scenarios S05/S06. Previously: stub until finance merges: `describeTarget` refuses folios (503 `module_unavailable` — nobody can place the folio) and returns `null` for bookings; every posting throws `module_unavailable`, so booking deposits show `ledger: failed` + urgent exception and are re-posted by reconciliation with the same key once finance is bound. |
| `PlatformPort` (`getProperty`, `getLegalEntity`, `assertWritable`, `resolvePolicy`) | platform (main) | bound to `platform` service (`getProperty` with system authz after payments' own permission check) |
| `ProviderSecretsPort` | env / Secrets Manager | `envProviderSecrets(process.env)` — `PAYMENTS_STRIPE_SECRET_KEY_TEST/LIVE`, `PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST/LIVE`; none set → nothing is ever sent to Stripe |

Also contributed: `paymentsSearch` (search providers), `payments.http`, `payments.subscriptions`, `payments.jobs`,
`paymentsManifest` (with `migrateAfter: ['platform']` because `route_webhook`/`tenants_for_jobs` call
`platform.tenant_environment`). Demo data: `seedPaymentsDemo(tx, org)` (DemoSeedStep-compatible) — a simulated
account and a recorded-only "own terminal" account per legal entity; refuses live.

## Provider contract (for reservations, finance and front desk — domain map § payments)

**ADR-0015 (integration step):** provider functions taking `propertyId` (and `getPaymentStatus(tx, ref, { propertyId })`, `capture({ …, propertyId })`, `listUnresolved`) grant payments' own read/collect/request keys at that property only (kernel `delegateAtProperty`) and refuse records of another property with `scope_mismatch`; `refund` keeps requiring `payments.payment.refund` (sensitive, §5). HTTP routes keep every check. Finance's late-charge collection requests are served by `paymentsCollectionsForFinance` (a payment request, intent only).

`createPaymentsModule(...).service.provider` — every function runs **inside the caller's transaction** (`tx`), checks
payments' own permissions and data authority, and takes an `idempotencyKey` derived from business identity
(e.g. `deposit:{bookingId}:1`). Provider calls happen **after commit** (`tx.afterCommit`); nothing returned here is
"paid" unless its status says so.

```ts
type MoneyIn = { amountMinor: number; currency: string };
type LedgerRef = { type: 'folio' | 'booking'; id: string }; // booking = deposit (finance: recordDeposit)

interface PaymentsProvider {
  /** Payment link. Created `open`; the provider link is created after commit (link.status 'pending' → 'ready'). */
  createPaymentRequest(tx: TxContext, i: {
    propertyId: string;
    legalEntityId?: string;               // derived from the property; if given it must match
    payer: { type: 'guest_profile' | 'company' | 'agency' | 'other'; id?: string; name: string; email?: string };
    amount: MoneyIn;
    purpose: 'deposit' | 'balance' | 'incidentals_preauth' | 'custom'; // the request owns this purpose on `ref`
    ref: LedgerRef;
    expiresAt: Date | string;
    idempotencyKey: string;
    description?: string;
  }): Promise<PaymentRequest>;            // status { request: 'open' | 'partially_paid' | 'paid' | 'expired' | 'cancelled' }

  /** Pre-authorization (guarantee). Returns status { authorization: 'processing' }; executed AFTER COMMIT and settles
   *  to 'authorized' | 'failed' | 'pending_verification' (events payments.authorization.authorized|failed). The
   *  initiator (customer/merchant) is derived from the method's consent record, never passed in. */
  authorize(tx: TxContext, i: {
    propertyId: string; methodId: string; amount: MoneyIn;
    ref: { type: string; id: string };   // stay / booking / folio
    idempotencyKey: string;
  }): Promise<Authorization>;

  capture(tx: TxContext, i: {
    authorizationId: string; amount?: MoneyIn; // default: remaining capturable
    ledgerRef?: LedgerRef;                     // required if the hold's ref is not a folio/booking
    idempotencyKey: string;
  }): Promise<Payment>;                         // status { payment: 'processing', ledger: 'pending' } → after commit

  charge(tx: TxContext, i: {
    propertyId: string; methodId: string; amount: MoneyIn; ref: LedgerRef; idempotencyKey: string;
    purpose?: 'deposit' | 'balance' | 'incidentals' | 'custom'; // default booking → deposit, folio → balance
  }): Promise<Payment>;

  refund(tx: TxContext, i: {
    paymentId: string; amount: MoneyIn; reason: string; idempotencyKey: string;
  }): Promise<Refund>;                          // ceiling: collected − adjustments − refunded − in-flight

  /** Read FIRST before any collection; never charge again while status is 'pending_verification'. */
  getPaymentStatus(tx: TxContext, ref: { type: string; id: string }): Promise<{
    ref: { type: string; id: string };
    status: 'none' | 'pending_verification' | 'authorized' | 'partially_paid' | 'paid' | 'refunded';
    pendingVerification: boolean;           // = hasPendingVerification
    authorizedMinor: number; capturedMinor: number; // first currency seen
    totals: Array<{ currency: string; confirmedMinor: number; recordedUnverifiedMinor: number;
                    pendingVerificationMinor: number; refundedMinor: number; heldMinor: number }>;
    payments: Payment[]; authorizations: Authorization[]; refunds: Refund[];
    hasPendingVerification: boolean;
  }>;

  /** Day Close / dashboards. */
  listUnresolved(tx: TxContext, i: { propertyId: string }): Promise<{
    propertyId: string;
    pendingVerification: Array<{ type: 'payment' | 'authorization' | 'refund'; id: string;
                                 amountMinor: number; currency: string; since: string }>;
    recordedUnverified: number; ledgerPending: number; openExceptions: number;
  }>;
}
```

`Payment`, `Authorization`, `Refund`, `PaymentRequest` are the Zod views in `src/contracts.ts` (universal record
contract: `status` map per family, `allowedActions`, `issues`, `owner`, `links`, `provenance`, plus `mode`
`'simulate' | 'sandbox' | 'live' | 'recorded'` and `presentation { tone, label, confirmed }`). Refusals are
`DomainError`s with stable codes: `ledger_target_unknown`, `ledger_target_other_property`,
`wrong_merchant_of_record`, `payment_pending_verification` (409 — also returned when another collection on the
same reference is in flight), `collection_owned_by_payment_request`, `duplicate_reference`, `mit_not_agreed`, `card_payments_unavailable` (503, `details.actions`),
`payment_declined` (402 over HTTP), `refund_exceeds_refundable`, `payment_disputed`, `idempotency_conflict`.

Other changes vs the original domain map: provider functions take `propertyId` (permission scope, merchant of
record, data authority); additional functions `incrementAuthorization`, `void`, `recordPayment`
(external_terminal/cash/bank_transfer), `confirmBankTransfer`, `cancelBankTransfer`, `recordAuthorization`,
`recordRefund`, `adjustRecordedPayment`, `registerVirtualCard`, `importStatement`, `recordPayout` (service `tx.*`).

### Ledger contract (`LedgerPort`, implemented by finance)

```ts
type LedgerScope = { propertyId: string; legalEntityId: string };
type ClearingRef = { provider: 'simulator' | 'stripe_connect' | 'external_terminal' | 'cash' | 'bank_transfer';
                     accountId: string | null };
interface LedgerPort {
  describeTarget(tx, ref: { type: 'folio' | 'booking'; id: string }): Promise<LedgerScope | null>;
  recordPayment(tx, LedgerScope & { folioId; amount: Money; paymentRef; method; idempotencyKey;
    verification: 'provider_confirmed' | 'recorded_unverified' | 'recorded_verified'; clearing: ClearingRef }): Promise<{ postingId }>;
  recordDeposit(tx, LedgerScope & { bookingId; amount; paymentRef; method; idempotencyKey; verification; clearing }): Promise<{ postingId }>;
  recordRefund(tx, LedgerScope & { folioId: string | null; bookingId: string | null; amount; refundRef;
    originalPaymentRef; idempotencyKey; clearing }): Promise<{ postingId }>;
  recordPayout(tx, { legalEntityId; payoutRef; gross; fees; net; currency; clearing; idempotencyKey }): Promise<{ journalEntryId }>;
  recordPaymentAdjustment(tx, LedgerScope & { folioId | null; bookingId | null; amount /* signed */; paymentRef;
    adjustmentRef; reason; idempotencyKey; clearing }): Promise<{ postingId }>;
  recordDisputeMovement(tx, { legalEntityId; paymentRef; disputeRef; amount; kind: 'debit' | 'reversal'; clearing; idempotencyKey }): Promise<{ journalEntryId }>;
  markPaymentVerified(tx, LedgerScope & { paymentRef: { type: 'payment' | 'refund'; id }; evidenceRef; idempotencyKey }): Promise<void>;
  recordSettlementFees(tx, LedgerScope & { statementRef; amount; clearing; idempotencyKey }): Promise<{ journalEntryId }>;
}
```

Every call runs in a savepoint of the payments transaction; a refusal leaves the money record committed with
`ledger: failed`, an owned urgent exception, and a retry with backoff and the same idempotency key.

## Steward review fixes (2026-11-07)

| Finding | Fix | Regression test |
|---|---|---|
| P0-1 cross-property posting | `describeTarget` check before any collection; scope + clearing on every posting | `review-regressions` P0-1; API folio refusal |
| P0-2 account ownership | Global unique provider account id; operator-only linking and fees; provider-controlled status | P0-2 |
| P0-3 webhook loss | Processed marker in the effects' transaction; reprocess on redelivery; hourly event backstop with cursor | P0-3 (×2) |
| P1-1 / P1-2 | One in-flight collection per reference (unique index); request owns its purpose (audited override) | P1-1, P1-2 |
| P1-3 | Approval-code uniqueness as a DB index per terminal/day; audited override | P1-3 |
| P1-4 | Refund ceiling after adjustments | P1-4 |
| P1-5 / P1-6 / P1-9 | Deposits carry property; verification and acquirer fees reach finance; fee columns; recovery text | P1-5/6/7/9 |
| P1-7 | Bank transfers `awaiting_receipt` until confirmed | P1-7 |
| P1-8 | Initiator derived from consent; mandate required for MIT | `authorizations` |
| P1-10 | Provider contract published (above); `authorize` returns `processing` and settles after commit | — |
| P1-11 | Environment/mode re-checked at send and lookup | P1-11 |
| P1-12 | Honest MUST gaps (above) and parity rows | — |
| P2 | Exception reopen (P2-1), method dedupe (P2-2), request fingerprint (P2-3), not-found confirmation (P2-4), PAN checks on all free text + DB checks (P2-6), dispute blocks refund (P2-9), cash day totals (P2-12), parity honesty (P2-13) | P2 tests |
| P3 | `formatMoney` in messages (P3-1), migration comment (P3-3), If-Match / Idempotency-Key on simulator routes (P3-4), breaker row lock (P3-7), harness guard removed (P3-10) | — |

Not done (recorded): P3-2 `sandbox` provenance (kernel; `mode` carries it), P3-5 worker role (foundation), P3-6 link
journaling, P3-8 payload minimisation; P3-9 (squash at merge) is the orchestrator's.

## Adoption modes

- **Standalone alongside another PMS:** payment links, VCC charging, terminal recording work with folio/booking ids
  supplied by the caller. Forwarding a payment to an external folio is **not built** (integration wave).
- **Connected mode:** `payments` authority external + `read_only` → every Portico payment action is refused with an
  explanation (tested); `forward` → refused ("cannot forward payments yet").
- **Data-authority domain:** `payments` (asserted on every write).
- **Trial/demo/training:** simulated end to end; results labeled "simulated — no real money".

## Owner questions (to add to `docs/OPEN_QUESTIONS.md`)

1. **Q2 (existing): Maldives acquiring.** Default: Route D (own terminal + recorded payments + statement import) is
   the pilot path; Stripe Connect stays R1 as an integration until a hotel entity is confirmed eligible.
2. **Settlement file formats** of the likely acquirers (BML, MIB, SBI Maldives…): the CSV importer uses a generic
   `date, amount, currency, reference, approval_code, last4, type` layout. Default: hotels export to that layout;
   per-bank mappings added when a pilot hotel provides real files.
3. **Cash verification:** cash is `recorded_unverified` until matched to a `cash_deposit` statement. Default kept;
   alternative is "verified at cashier close" once finance cashier sessions exist.
4. **Platform application fee (Q3):** supported (`applicationFeeBps`) but defaults to none; commercial decision.
5. **PCI vault/proxy for OTA cards** (Channex PCI or another vault): unresolved dependency; VCC tokens are assumed
   to be vault aliases.
6. **Refund approval threshold** (spec PAY-R17): not implemented; default = any user with `payments.payment.refund`.

## Known gaps and risks

- The finance binding is a stub: until finance merges, folio collections are refused and booking deposits show
  "not yet on the bill" (honest; every deposit raises a ledger exception in the composed app).
- Stripe adapter has only been tested against recorded fixtures; API version pinned to `2024-06-20` (verify before
  R4); Checkout Session expiry is limited by Stripe to 24 h — longer requests need a new link.
- One collection in flight per folio/booking (no collection plans yet): split tenders are sequential.
- Bank references with 12+ consecutive digits cannot be entered (they could be card numbers); statements keep only
  their last 4 digits.
- Webhook payout events carry net only; ledger posting waits for a breakdown (manual record or report import).
