# @portico/payments

Guest money through the **hotel legal entity's own merchant account** (owner decision D2, ADR-0007). Monoclay never
holds guest funds; the domain is provider-agnostic; every provider call is journaled; an unknown outcome is
`pending_verification` and is resolved by provider lookup or webhook — never guessed, never re-sent.

Schema `payments` · permissions prefix `payments.` · spec: `docs/specs/payments.md` (product worktree, Draft v1) ·
domain map § payments.

## Checkpoint

- **Done:** module (migration, domain, simulator + Stripe Connect adapters, Route D recorded payments + statement
  import, services, routes, record contract, search, jobs, demo seed), composition wiring, API e2e tests, README,
  `PARITY.md` (gate passes in a scratch copy), `FOUNDATION_REQUESTS.md`. All payments (96) and API tests passed on
  the last full run; `pnpm lint` / `pnpm typecheck` green.
- **In progress:** nothing — final verification passed (lint, typecheck, 96 payments tests ×4 runs, 17 API tests).
- **Next steps:** none required; orchestrator binds `LedgerPort` to finance at merge, moves `PARITY.md` to
  `docs/parity/payments.md`, applies the domain-map contract changes listed below.
- **Known failing tests:** none. The rare teardown race in `@portico/testing` (`FOUNDATION_REQUESTS.md` §1) is
  guarded in this module's harness.

## What is built (wave 1)

| Area | Capability | Spec | Status | Readiness |
|---|---|---|---|---|
| Accounts | Payment account per legal entity: provider, external account id, capabilities, onboarding status, country/currencies, status `pending/active/restricted/disabled`, optional application fee (Route A only) | PAY-R01 | done | R3 |
| Accounts | Merchant-of-record guard: an account may only be used for properties operated by its legal entity | PAY-R01 | done | R3 |
| Providers | Provider-agnostic adapter port (`authorize`, `incrementAuthorization`, `capture`, `void`, `charge`, `refund`, `lookup`, `createPaymentLink`, `parseWebhook`) with declared capabilities | PAY-R02 | done | R3 |
| Providers | **SimulatorProvider** (default for demo/trial/training/tests), DB-backed so API and worker share one simulated provider; approved test tokens only (`pm_card_*`, `sim_*`); scenarios: approve, decline (reason codes), soft decline, timeout→succeeded, timeout→failed, outage (refuse / timeout), duplicate and out-of-order webhooks, delayed settlement, dispute, VCC funding delay | PAY-R03 | done | R3 (simulator — never called an integration) |
| Providers | **StripeConnectProvider**: direct charges on the connected account (`Stripe-Account`), PaymentIntents with manual capture + extended authorization `if_available`, idempotency keys forwarded, optional `application_fee_amount`, lookups (by id / metadata search), Checkout Session links, webhook signature verification; injectable HTTP client | PAY-R03 | code + unit tests against recorded/mock responses only; **never called Stripe** (no keys) | **R3 adapter code; R1 as an integration** (not R4 — no sandbox test yet) |
| Providers | **Route D — external terminal / recorded** (`external_terminal` account kind): card payments taken on the hotel's own terminal/gateway (e.g. BML), cash and bank transfer are *recorded* (`recorded_unverified`), posted at record time, verified by statement matching, never presented as provider-verified | coordinator, PAY-R23/R24 | done | R3 (likely first Maldives pilot path; R7 needs a hotel) |
| Safety | Every provider call gated by `assertExternalEffectAllowed(ctx,'payment.charge')`: simulate → simulator **always** (even for a Stripe account), sandbox → Stripe TEST keys only, live → LIVE keys; simulator accounts refused in live; unknown keys → nothing sent | PAY-R04, PAY-I06 | done | R3 |
| Journal | Provider-operation journal: intent committed before the call (operation, amount, idempotency key), claim `pending→sent` (one sender), outcome recorded; append-only `operation_journal` | PAY-R04, ADR-0007 | done | R3 |
| Methods | Tokens only (brand, last4, expiry, holder, owner, MIT agreement + mandate, token portability notes); PAN/CVC refused at Zod, service and DB check levels | PAY-R05, PAY-I05 | done | R3 |
| Holds | Authorizations (`processing, pending_verification, authorized, partially_captured, captured, voided, expired, failed`), partial/multiple captures, increments, release, expiry from provider or policy `payments.authorization.validityDays` (default 7), renewal warning `payments.authorization.renewBeforeDays` (default 2) | PAY-R09, PAY-R10 (warning task only) | done | R3 |
| Charges | CIT/MIT charges; MIT requires the saved card's agreement; decline explanations with recovery | PAY-R11, PAY-R12 | done | R3 |
| Verification | `pending_verification` first-class; second collection on the same folio/booking blocked while one is pending; "check now"; resolver backoff 10 s/30 s/2 min/10 min/1 h/6 h; "not found" conclusive only after 15 min; escalation exception after 24 h | PAY-R13, PAY-R14 | done | R3 |
| Webhooks | Signature-verified, dedupe by provider event id, stored (card data scrubbed), out-of-order safe (events trigger lookups; monotonic transitions), unknown events stored | PAY-R15, PAY-I07 | done | R3 |
| Reconciliation | Callable `runReconciliation`, worker consumers (`payments.operation-executor`, `payments.reconciler`), scheduled jobs (`payments.reconcile` 60 s, `payments.chargeDueVirtualCards` 15 min); mismatches → exceptions | PAY-R13, PAY-R16 (provider balance-transaction sweep not built) | partial | R3 |
| Refunds | Separate records referencing the payment; partial; Σ refunds (succeeded + in-flight) ≤ collected enforced by a DB check; retry never refunds twice; recorded refunds for Route D | PAY-R17, PAY-I03 | done (no approval threshold yet) | R3 |
| Disputes | From webhooks: record, evidence checklist (If-Match updates), status, deadline exception, ledger debit/reversal through `LedgerPort.recordDisputeMovement` (proposed) | PAY-R18 | done (evidence submission/accept happen in the provider dashboard) | R3 |
| Requests | Payment requests/links (`open/partially_paid/paid/expired/cancelled`), paid only from provider-confirmed payments; link created after commit, retried when the provider is back | PAY-R19 | done | R3 |
| VCC | OTA virtual cards: metadata separate from the token (vault alias), charge exactly the amount from the property-local activation date, funding-delay retries (6/12/24/24/48 h), final failure → owned task | PAY-R07 | done; **PCI vault/proxy unresolved** | R3 (vault dependency R1) |
| Payouts | Gross/fees/net + included payments/refunds; ledger only when paid and the breakdown is known; webhook payouts without breakdown flagged; failed payouts flagged | PAY-R25 | done | R3 |
| Outage | Circuit breaker per account (3 consecutive unavailability errors → open 60 s → one probe); visible via `/payments/accounts/:id/health` and `/payments/status`; staff actions: accept cash / payment link later / record manual authorization / record terminal payment | PAY-R26, s20 | done (automation pause/re-validation: see gaps) | R3 |
| Statements | CSV statement import (file-based, labeled `file_import`): terminal batch, acquirer settlement, bank statement, cash deposit; matching by reference/approval code, then amount+date+last4; mismatches (amount, missing, unrecorded, duplicate, ambiguous) → exceptions with owner; corrections are linked adjustments | coordinator (Route D) | done | R3 |
| Experience | Universal record contract on payment, authorization, refund, payment request, exception (`status` per family, `allowedActions` with reasons, `issues`, `owner`, `links`, `provenance`); `recordTypes`; `paymentsSearch` (provider ref, approval/terminal/bank ref, "last4 amount") | CLAUDE.md §4.17 | done | R3 |
| Authority | `platform.assertWritable(…,'payments')` on every write; `forward` refused with an explanation | ADR-0014 | done | R3 |

Not built (R1): collection plans and payment automation (PAY-R20–R22), refund approval thresholds, 3DS/hosted card
entry pages (PAY-R06 — frontend/booking engine), automatic re-authorization, provider balance-transaction
reconciliation sweep (PAY-R16 full), local Maldivian acquirer adapters (Q2), Adyen, terminals integration, forwarding
payments to an external folio in connected mode.

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
| Merchant of record = property's legal entity | `authorizations` (other legal entity refused) |
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
| `apps/api/test/payments.test.ts` | s05 and s20 over HTTP via the composition root, 402 declines with recovery, PAN refusal, isolation and search, public Stripe webhook route |

Counts: 96 module tests (38 domain unit, 15 Stripe adapter unit, 43 integration on Postgres) + 6 API end-to-end.

## HTTP (all under `/v1`)

Accounts `GET/POST /payments/accounts`, `GET/PATCH /payments/accounts/:id` (If-Match), `GET …/:id/health`,
simulator: `PUT …/:id/simulator-controls`, `POST …/:id/simulator/deliver-webhooks`, `GET /payments/simulator/test-tokens` ·
methods `POST/GET /payments/methods`, `GET /payments/methods/:id`, `POST …/:id/detach` (If-Match) ·
holds `POST /payments/authorizations`, `POST /payments/authorizations/recorded`, `GET …/:id`, `POST …/:id/{increment,capture,void,check}` ·
payments `POST /payments/charges`, `POST /payments/recorded`, `GET /payments/transactions/:id[/history]`, `POST …/:id/check`,
`GET /payments/status-by-ref`, `POST /payments/adjustments` · refunds `POST /payments/refunds`, `POST /payments/refunds/recorded`,
`GET/POST /payments/refunds/:id[/check]` · requests `POST/GET /payments/requests`, `GET …/:id`, `POST …/:id/cancel` (If-Match),
`POST …/:id/simulate-payment` · VCC `POST /payments/virtual-cards`, `GET …/:id`, `POST …/run-due` · disputes
`GET /payments/disputes`, `GET …/:id`, `PATCH …/:id/evidence` (If-Match) · `POST/GET /payments/payouts` ·
`POST /payments/statements` · `GET /payments/exceptions`, `POST …/:id/resolve` (If-Match) · `GET /payments/status`,
`POST /payments/reconciliation/run` · **public** `POST /payments/webhooks/stripe` (raw body, signature-verified).

Every create and money movement requires `Idempotency-Key`. Status codes: 201 confirmed/recorded, 202 pending
(processing / pending verification), 402 declined/failed (problem+json with the record in `details` and the recovery
in `detail`), 503 `card_payments_unavailable` with `details.actions`.

## Permissions

`payments.payment.read` · `payments.payment.collect` · `payments.payment.refund` ⚑ · `payments.paymentRequest.create` ·
`payments.method.manage` · `payments.vcc.manage` · `payments.reconciliation.manage` ⚑ · `payments.dispute.manage` ⚑ ·
`payments.account.read` (org) · `payments.account.manage` ⚑ (org) · `payments.payout.manage` ⚑ (org).
Reads accept `payments.payment.read` **or** `payments.payment.collect` (the front-desk role template has collect but
not read — identity may want to add `payments.payment.read` to `front_desk`).

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
| `LedgerPort` (`recordPayment`, `recordDeposit`, `recordRefund`, `recordPayout`, `recordPaymentAdjustment`*, `recordDisputeMovement`*) | finance (wave 1, parallel) | **`unavailablePort('finance')` stub** — confirmed payments then show `ledger: failed` + urgent exception and are re-posted by reconciliation with the same key once finance is bound. Orchestrator: bind to finance at merge (adapt return shapes if needed). |
| `PlatformPort` (`getProperty`, `getLegalEntity`, `assertWritable`, `resolvePolicy`) | platform (main) | bound to `platform` service (`getProperty` with system authz after payments' own permission check) |
| `ProviderSecretsPort` | env / Secrets Manager | `envProviderSecrets(process.env)` — `PAYMENTS_STRIPE_SECRET_KEY_TEST/LIVE`, `PAYMENTS_STRIPE_WEBHOOK_SECRETS_TEST/LIVE`; none set → nothing is ever sent to Stripe |

\* proposed additions (see contract changes).

Also contributed: `paymentsSearch` (search providers), `payments.http`, `payments.subscriptions`, `payments.jobs`,
`paymentsManifest` (with `migrateAfter: ['platform']` because `route_webhook`/`tenants_for_jobs` call
`platform.tenant_environment`). Demo data: `seedPaymentsDemo(tx, org)` (DemoSeedStep-compatible) — a simulated
account and a recorded-only "own terminal" account per legal entity; refuses live.

## Contract changes (domain map § payments / § finance)

1. Provider functions take **`propertyId`** (needed for permission scope, merchant-of-record check and data
   authority; payments cannot resolve a stay's property without calling reservations). `createPaymentRequest`
   accepts `legalEntityId?` but derives it from the property. All take `idempotencyKey`.
2. `charge`/`capture` ledger targets are `ref: { type: 'folio' | 'booking' }` (booking = deposit → `recordDeposit`).
   Authorizations may reference any entity (stay/booking/folio); `capture` accepts `ledgerRef`.
3. Return shapes: `authorize → Authorization`, `capture/charge → Payment`, `refund → Refund` views with the universal
   record contract; `status` is a per-family map (`{ payment: 'pending_verification', ledger: 'pending' }`).
4. `LedgerPort` additions (finance): `recordPayment`/`recordDeposit` gain `method` and `verification`
   (`provider_confirmed | recorded_unverified`); `recordRefund` gains `bookingId` (deposit refunds);
   **new** `recordPaymentAdjustment` (Route D corrections) and `recordDisputeMovement` (spec PAY-R18).
   Return shapes assumed: `{ postingId }` / `{ journalEntryId }` (payouts, disputes).
5. New provider functions beyond the domain map (spec "proposed"): `incrementAuthorization`, `void`,
   `recordPayment` (external_terminal/cash/bank_transfer), `recordAuthorization`, `recordRefund`,
   `adjustRecordedPayment`, `registerVirtualCard`, `importStatement`, `recordPayout`.

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

- The finance binding is a stub: until finance merges, succeeded payments show "not yet on the bill" (honest, but
  every card payment raises a ledger exception in the composed app).
- Stripe adapter has only been tested against recorded fixtures; API version pinned to `2024-06-20` (verify before
  R4); Checkout Session expiry is limited by Stripe to 24 h — longer requests need a new link.
- Pending-collection guard is per folio/booking (no collection plans yet) — conservative; may block legitimate
  parallel split tenders on the same folio until the first resolves.
- Webhook payout events carry net only; ledger posting waits for a breakdown (manual record or report import).
- Rare test-teardown race in `@portico/testing` drop (see `FOUNDATION_REQUESTS.md`).
