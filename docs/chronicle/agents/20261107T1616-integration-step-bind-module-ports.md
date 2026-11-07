# Agent run: Integration step: bind module ports

- Started: 2026-11-07T16:16:26.294Z · last activity: 2026-11-07T18:37:24.302Z
- Turns: 869 · tool uses: 542 · output tokens: 788,694
- Type: general-purpose

## Brief (2026-11-07T16:16:26.294Z)

````text
You are the integration engineer for Portico, a cloud hospitality management platform: a TypeScript modular monolith at /home/user/portico. Read these first:
- CLAUDE.md (non-negotiable rules)
- docs/orchestration/module-agent-playbook.md
- docs/architecture/domain-map.md
- ADR-0003 (ports and adapters), ADR-0015 (authorization across ports), ADR-0016 (finance decisions)
- docs/orchestration/pending-fixes.md: the queue of cross-module fixes. Many entries are yours.

Your worktree is /home/user/wt/integration-step (branch feat/integration-step, created from main). Commit locally after each meaningful step with Conventional Commits; never push. Postgres: postgres://postgres@127.0.0.1:5432/postgres; use PORTICO_TEST_DB_PREFIX=w1_intstep.

Situation: guests, inventory, operations, rates, payments, reservations, integration and finance are all on main, but many ports in apps/api/src/composition.ts are still bound to stubs that answer 503 `module_not_available`. Your job is to make them one product.

PHASE A — bind every port for real (composition root plus adapters):
1. finance ↔ rates: bind finance's tax port to rates (`bindFinanceTax`, already proven to type-check in apps/api/test/finance.test.ts).
2. payments → finance: bind payments' `LedgerPort` to `financeLedgerForPayments(finance)`, and finance's collection requests to payments. Update apps/api/test/payments.test.ts, which currently expects the stubs. Folio collections must then work, and money must still never cross property or legal entity.
3. reservations → rates: write `ratesPortFrom`. It maps rates' sealed TermsSnapshot v1, Offer and RepricingResult to the fields reservations reads. Store rates' terms document unchanged and pass it back as-is to `priceChange`, `evaluateCancellationPenalty` and `complimentaryTerms`. Deposits use `rates.instantiatePaymentSchedule`. The canonical contract is modules/rates/README.md § Provider contract.
4. reservations → guests, finance, payments, operations: bind each with an adapter in the owning direction. Contract notes are in each module's README "Ports" / "Contract changes" and in pending-fixes.md:
   - reservations passes `propertyId` on the finance calls listed there;
   - reservations reads `getPaymentStatus` first and never re-authorizes while pending;
   - reservations sends v2 booking/stay events (with `stays[]` and `aggregateVersion`), which operations consumes.
5. ADR-0015: inventory and payments must stop re-checking the caller's own permission keys on PORT calls. Keep the checks on their own HTTP routes. Remove the system-scope workarounds this made necessary in composition (operations' and reservations' inventory adapters). Each provider must still verify that every referenced record belongs to the passed property and legal entity.
6. Remaining pending-fixes entries that are cheap and cross-module: the `aggregateVersion` / `isNewerThan` adoption, and payer-type terminology in the glossary. Mark each one you finish as DONE in pending-fixes.md.

Every binding gets an API-level test proving the real path works end to end, plus a refusal test (wrong property, or external system of record). Use the module contracts; never import across modules (`tools/check-boundaries.mjs` runs in `pnpm lint`).

PHASE B — proof scenarios: docs/scenarios/README.md defines S01–S20 with normative test names (`scenarios/sNN-*.test.ts`); host them in apps/api/test/scenarios/.
- Implement every scenario that is possible with the merged modules, through public service/HTTP APIs, ending with the global consistency checks listed in that README.
- For any scenario not yet possible (day close, distribution, comms and similar are wave 2), add a `.todo` with the exact missing capability.
- IMPORTANT: a parallel branch (identity-plus) will soon make sensitive permissions require MFA and data-authority changes require a second approver. Write scenarios so they survive that: build contexts with the existing test helpers or service-level contexts rather than password-only HTTP sign-in, or use helpers I can update in one place. When I tell you identity-plus has merged, `git merge main` and adapt.

Rules:
- Preserve every module's guarantees (idempotency, ETags, audit, RLS, environment safety, data authority).
- Never weaken a test to make a binding pass. If a module has a real contract bug, fix it in that module with a regression test and record it in your report.
- Before you finish: `pnpm lint`, `pnpm turbo run typecheck --force` and `pnpm turbo run test --force`, checking exit codes.

Reply with:
- a table of each port → bound? (adapter file, test name);
- scenarios: passing / todo, each with its reason;
- contract bugs you fixed;
- command results;
- anything that needs an owner decision. Don't block on it: add it to docs/OPEN_QUESTIONS.md with a default.
````

## Follow-up message (2026-11-07T17:27:08.129Z)

````text
The coordinator sent a message while you were working:
The steward review of feat/integration-step says **merge after fixes**: P0 0 · P1 3 · P2 7 · P3 9.
- Report: /home/user/portico/docs/orchestration/reviews/review-integration-step.md (main working tree; read the latest file).
- PoCs: docs/orchestration/reviews/integration-step-poc/*.ts.txt. Each one passes today because it asserts the buggy behaviour; turn every one into a regression test asserting the fix.

Fix the P1s:
- **P1-1:** a deposit for another property's booking, or for a booking that exists nowhere, is accepted and posted to the wrong legal entity.
  - Add a booking-directory port from reservations for payments and finance.
  - Refuse unknown and other-property bookings exactly like folios.
  - Finance must never bind a booking to "whichever property takes the first deposit".
- **P1-2:** check-in could hold any card for any amount without payments permission.
  - Require `payments.payment.collect` when the card or amount is overridden.
  - Verify the card belongs to the booking's guest or payer.
  - Cap the amount by policy.
- **P1-3:** late-charge collection must request at most what the folio actually owes, never the full charge on a folio in credit. Also fix the bindings test so it asserts the amount.

Fix the P2s:
- **FD-15:** hide the money-derived payment-check status, and totals and payment status on booking and stay reads, for roles without money permissions.
- **Finance delegation:** make the property parameter REQUIRED; no all-properties grant.
- **Rates adapter:** verify the terms seal before using a stored document.
- **S04:** make it truly prove child ages and Green Tax drive the price.
- **Your report:** correct the "every stubbed port bound" claim. Integration inbound handlers and catalogs, and rates' `affectedAgreements`, are still stubbed; list them.
- **Rates and guests port re-checks (ADR-0015):** remove them, or record the decision in pending-fixes with a real reason. Pending-fixes points to an OPEN_QUESTIONS entry that doesn't exist; fix that reference.
- Cheap P3s.

New process (on main under docs/quality, after you merge main):
- Before you report done, run docs/quality/playbooks/module-builder-self-check.md and include its tables in your reply.
- Follow docs/quality/playbooks/scenario-tests.md v2: each scenario states which ports were real and which assertion proves each expected outcome.
- For every P1 fix, attack your own fix once more (the re-attack table) before reporting.

Merge main first: backoffice and the quality system are now on main. Conflicts in OPEN_QUESTIONS.md and pending-fixes.md are append-only, so keep both sides. If your late-charge question collides with identity-plus's Q146–Q149, renumber yours to the next free number above Q155.

Gates:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Use PORTICO_TEST_DB_PREFIX=w1_intstep_fix and check the exit codes.

Commit (Conventional Commits) and don't push. Reply with finding → commit → test, the self-check tables and the command results.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:31:30.337Z)

````text
[Request interrupted by user]
````

## Follow-up message (2026-11-07T17:38:53.297Z)

````text
The coordinator sent a message while you were working:
Resume after the owner's checkpoint. Your WIP is committed on feat/integration-step as "wip(...): usage-limit checkpoint". Run `git log -3` to confirm, and amend or keep it as you prefer. Continue the fix round exactly where you stopped: you were reading the check-in guarantee step for P1-2. The brief is unchanged: P1-1 to P1-3 and the P2s from reviews/review-integration-step.md, the self-check tables, and the scenario-tests v2 rules. The gates are unchanged too.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T18:30:13.980Z)

````text
The coordinator sent a message while you were working:
Focused re-review of your fix round: **merge after fixes** (P0 0 · P1 3 · P2 4 · P3 5).
- All 9 original PoCs are now refused. But attacking the fixes themselves found a new P1 for each: every fix stopped the exact attack and failed one step beyond.
- Report: docs/orchestration/reviews/review-integration-step-2.md on main.
- PoCs: integration-step-poc/r2-fix-attacks.test.ts.txt. Each test passes today by asserting the defect; flip each into a regression test asserting refusal.

New rule on main: **ADR-0015 Amendment 1.** A card is the agreed guarantee only if the cardholder supplied it for THIS booking (hosted entry, payment link, terminal or self-service) or a recorded mandate covers it. Staff linking a person to a booking never grants use of that person's saved card.

Fix:
- **R2-P1-1:** implement Amendment 1 for every path that records or uses a guarantee card. That covers booking create and patch, check-in, payments routes, and channel bookings.
- **R2-P1-2, late-charge collection:**
  - With N late charges, the full outstanding balance must be requested. Add a payments command to amend or cancel an open request, or one balance request per folio that tracks the balance.
  - Keep the "collect" exception urgent.
  - Never record an amount as requested when it wasn't.
  - Reversing a late charge reduces or cancels its open request.
- **R2-P1-3, opening-deposit import:** it must ask reservations who owns the booking. Payments' pre-check and finance's posting check use ONE shared predicate, not two that can disagree.
- **R2-P2s, all four:**
  - **R2-P2-1:** card ownership must not be first-saver-wins. Decide owner linking versus refusal, and keep the cardholder relation after a profile merge.
  - **R2-P2-2:** no payment state on the check-in run endpoint or in stay issues for roles without money permissions.
  - **R2-P2-3:** payments checks EVERY reference type, folio included, not only stays and bookings.
  - **R2-P2-4:** connected-mode guarantee is "unknown/external", never "done", without confirmation.
- **P3s:** fix them if cheap, including:
  - P3-1: a non-numeric cap policy must fail closed;
  - make the rates seal check required, not optional;
  - revenue managers keep booking totals.

Also take over the payments residuals from the main-branch fix sweep, because they touch the same code. See docs/orchestration/reviews/review-fix-sweep.md and fix-sweep-poc/payments-zz-review-sweep.test.ts.txt:
- **SW-PAY-1:** the double-collection guard covers EVERY collection path (desk charge, hold + capture, payment request, VCC) with locked reads.
- **SW-PAY-2:** purpose `custom` cannot bypass the guard without a reason and audit.
- **SW-PAY-3:** card-on-file use checks the CARD's property and legal entity.
- **SW-PAY-4:** guest present versus merchant-initiated is derived from server facts, never from client `entryChannel`.

Process:
- Self-check v3 tables.
- One regression test per SIBLING entry point, not only the PoC path.
- A re-attack table for every P1, including the attack "one step beyond" your own fix.
- Never rewrite pushed commits.

Gates:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Use PORTICO_TEST_DB_PREFIX=w1_intstep_fix2. Commit and don't push.

Reply with finding → commit → test, the tables and the exit codes. Another focused re-review will follow.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T18:32:08.673Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Edit, Monitor, SubagentHandback, ToolSearch, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - **Original task.** I am the integration engineer for Portico, a TypeScript modular monolith at /home/user/portico. I work in the worktree /home/user/wt/integration-step on branch feat/integration-step.
     - Commit locally after each meaningful step with Conventional Commits, and never push.
     - Every commit message ends with:
       `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
       `Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR`
     - Postgres is at postgres://postgres@127.0.0.1:5432/postgres.
     - Phase A: bind every stubbed port for real, apply ADR-0015 and fix the cross-module pending-fixes.
     - Phase B: proof scenarios S01–S20 in apps/api/test/scenarios.
     - Preserve every module guarantee. Never weaken a test. Never import across modules.
     - Owner questions go to docs/OPEN_QUESTIONS.md with a default.
     - Scenarios must survive identity-plus (MFA and a second approver).
   - **Fix round 1** (steward review, docs/orchestration/reviews/review-integration-step.md): done and reported.
     - Fixed P1-1/2/3, P2-1..7 and the cheap P3s; turned the PoCs into regression tests.
     - Merged main; renumbered my question to Q156.
     - Self-check tables, scenario-tests v2 (binding manifest and assertion map) and gates with prefix w1_intstep_fix.
   - **Latest request: focused re-review round 2** (docs/orchestration/reviews/review-integration-step-2.md on main; PoCs in integration-step-poc/r2-fix-attacks.test.ts.txt — flip each into a regression test asserting refusal). Verdict "merge after fixes", P0 0 · P1 3 · P2 4 · P3 5. New rule on main: **ADR-0015 Amendment 1** — "A card is the agreed guarantee only if the cardholder supplied it for THIS booking (hosted entry, payment link, terminal or self-service) or a recorded mandate covers it. Staff linking a person to a booking never grants use of that person's saved card."
     - **R2-P1-1:** implement Amendment 1 on every path that records or uses a guarantee card: booking create and patch, check-in, payments routes, channel bookings.
     - **R2-P1-2 (late-charge collection):**
       - with N late charges, the full outstanding balance is requested — add a payments command to amend or cancel an open request, or keep one balance request per folio that tracks the balance;
       - keep the "collect" exception urgent;
       - never record an amount as requested when it wasn't;
       - reversing a late charge reduces or cancels its open request.
     - **R2-P1-3 (opening-deposit import):** it must ask reservations who owns the booking. Payments' pre-check and finance's posting check must use ONE shared predicate.
     - **R2-P2-1:** card ownership is not first-saver-wins. Decide owner linking versus refusal, and keep the cardholder relation after a profile merge.
     - **R2-P2-2:** no payment state on the check-in run endpoint or in stay issues for roles without money permissions.
     - **R2-P2-3:** payments checks EVERY reference type, folio included.
     - **R2-P2-4:** a connected-mode guarantee is "unknown/external", never "done", without confirmation.
     - **P3s if cheap:** a non-numeric cap policy fails closed (P3-1); the rates seal check is required, not optional; revenue managers keep booking totals.
     - **Payments residuals from docs/orchestration/reviews/review-fix-sweep.md** (PoC fix-sweep-poc/payments-zz-review-sweep.test.ts.txt):
       - SW-PAY-1: the double-collection guard covers EVERY collection path (desk charge, hold + capture, payment request, VCC) with locked reads;
       - SW-PAY-2: purpose `custom` cannot bypass the guard without a reason and audit;
       - SW-PAY-3: card-on-file use checks the CARD's property and legal entity;
       - SW-PAY-4: guest-present versus merchant-initiated is derived from server facts, never from the client's `entryChannel`.
     - **Process:**
       - self-check v3 tables;
       - one regression test per SIBLING entry point, not only the PoC path;
       - a re-attack table for every P1, including "one step beyond" my own fix;
       - **never rewrite pushed commits**.
     - **Gates:** `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` with PORTICO_TEST_DB_PREFIX=w1_intstep_fix2. Commit; don't push.
     - **Reply with:** finding → commit → test, the tables and the exit codes. Another focused re-review follows.

2. Key Technical Concepts:
   - **Architecture:** modular monolith with ports and adapters (ADR-0003); the composition root is apps/api/src/composition.ts; tools/check-boundaries.mjs runs in lint.
   - **ADR-0015:**
     - the entry module authorizes;
     - providers do not re-check their own keys on port calls; the kernel `delegateAtProperty` grants provider keys at exactly one property;
     - providers verify a record's property (`scope_mismatch`);
     - sensitive effects stay explicit;
     - Amendment 1 is the new card rule.
   - **Other ADRs:** ADR-0014 data authority (`platform.assertWritable`, `makeExternal`); ADR-0016 deposit tax point (`valueOnly`).
   - **Rates terms:** rates' sealed TermsSnapshot v1 is stored verbatim as `providerDocument` inside reservations' view; the seal is verified with `rates.verifyTerms`.
   - **Payments:** two-phase (`processing` → after commit); one collection in flight per reference; PendingVerificationBlockError code `authorization_pending_verification`.
   - **Money redaction (FD-15):** `seesMoney` (MONEY_READ keys); `moneyRedacted`; nullable `totals`.
   - **Directories:** a booking/reference directory from reservations (`describeBooking`, `describeReference`) bound into finance (`BookingDirectoryPort`) and payments (`ReferenceDirectoryPort`).
   - **Guarantee card checks:** `checkGuaranteeMethod` (allowed owners: booker, occupants, company, agency, billing payer, booking) and the cap policy `reservations.checkIn.guaranteeCapPercent` (default 150). These must now change for Amendment 1.
   - **Late charges:** finance requests `min(share, max(0, folio balance))`; a folio in credit gives `covered_by_credit` (routine). The payer is passed to payments (`payerOf`: guest → guest_profile).
   - **Scenario harness:** fixedClock; demo organizations (simulator payments); role-template staff contexts; the global consistency checks (INV-I02/I03, RES-I02, deposits belong to the booking's property, FIN-I02/I14, no duplicate keys, payments attempts ≤ 1, audit actions).
   - **Quality playbooks:** docs/quality/playbooks/module-builder-self-check.md (now v3 is requested; v2 §3 had re-attack columns (a) reverse, (b) siblings, (c) failure path, (d) griefing, (e) atomic) and scenario-tests.md v2 (binding manifest, assertion map, both gate commands).

3. Files and Code Sections (worktree /home/user/wt/integration-step):
   - **packages/kernel/src/context.ts:**
     `delegateAtProperty<T extends { readonly authz: Authorizer }>(ctx: T, permissions: readonly string[], propertyId: string): T`
     It grants the permissions only where `scope?.propertyId === propertyId`, and `propertyScope` adds the property.
   - **modules/inventory/src/provider.ts:** `inventoryProvider(service)`.
     - delegation INVENTORY_PORT_DELEGATION;
     - `verify`/`verifyRef` refusals (`scope_mismatch`);
     - `getUnit(tx, unitId, { propertyId })`; ref-based calls take propertyId.
     - Test: modules/inventory/test/provider-port.test.ts. Unit and unit-type events carry aggregateVersion.
   - **modules/payments:**
     - src/service/index.ts:
       - PAYMENTS_PORT_DELEGATION and the provider functions (delegation; `getPaymentStatus(tx, ref, scope?)`, `capture({…, propertyId?})`, `describeMethod(tx, methodId, { propertyId })`);
       - `assertRecordAt`/`assertRefAt` → `scope_mismatch`;
       - `PaymentsServiceDeps.references?`.
     - src/service/shared.ts:
       - `assertLedgerTarget` (no booking early return; booking-specific message);
       - `assertReferenceAt` (`reference_unknown` / `reference_other_property`; returns early when the directory is unbound or returns undefined — R2-P2-3 requires folio checks too).
     - src/service/collect.ts: `assertReferenceAt` is called in `authorize` and `recordAuthorization`.
     - src/ports.ts: `ReferenceDirectoryPort { describeReference(tx, ref): Promise<{propertyId}|null|undefined> }`.
     - src/finance-collections.ts: `paymentsCollectionsForFinance` (savepoint; `createPaymentRequest` purpose 'balance'; `payerOf`; business refusal → not_possible). Late-charge collection is the target of R2-P1-2.
     - src/index.ts: exports `createPaymentsModule({…, references?})`.
   - **modules/finance:**
     - src/ports.ts: `BookingDirectoryPort`; `FinancePorts.bookings`; `CollectionRequest.payerName` and `payer`; `RatesChargeLine.valueOnly`.
     - src/wiring.ts: `unavailableFinancePorts` includes a bookings stub returning null.
     - src/service/ledger-port.ts:
       - `describeTarget(tx, deps, ref)` — booking: directory first, then an existing deposit account (imports), else null;
       - `assertTargetInScope` — unknown booking → `ledger_target_unknown`.
     - src/service/deposits.ts: `resolveDepositProperty(tx, deps, bookingId, propertyId?)` uses the directory; it refuses unknown bookings, other properties and mismatched existing accounts. `importOpeningDeposits` does NOT use the directory yet (R2-P1-3).
     - src/service/support.ts: `delegated(tx, permissions, propertyId: string | null)` requires a scope and throws on undefined.
     - src/service/index.ts: `financeForReservations` requires propertyId on every function; `getFolioBalance(tx, folioId, scope)`.
     - src/service/postings.ts: the late-charge block computes `due = max(0, min(share, folio balance))`. When due > 0 the exception is urgent with collect wording; when there is credit the status is `covered_by_credit` and the exception routine. Details include `amountRequested: due`, even if payments then refused — R2-P1-2 says never record an amount as requested when it wasn't.
     - Fiscal/receivables internal `delegated` calls pass the record's property.
     - Tests were updated:
       - helpers.ts has a fake `bookings` Map directory;
       - deposits, payments-ledger-port, reservations-port and review-regressions tests register bookings;
       - test/compat/reservations-finance-port.ts was updated to the propertyId contract.
   - **modules/rates:**
     - src/contracts.ts: `chargeLine.valueOnly` (optional), with a refine that refuses levyOnly && valueOnly.
     - src/domain/tax-engine.ts: `if (quantity && line.valueOnly) continue;`.
     - src/provider.ts: `ratesProvider(service)` delegates `rates.quote.read` for quote, quoteDetailed and priceChange; exported.
     - Tests: tax-engine valueOnly and refine tests.
   - **modules/reservations:**
     - src/ports.ts:
       - `TermsSnapshot.providerDocument`; `PaymentScheduleItem`;
       - `RatesPort.instantiatePaymentSchedule`;
       - InventoryPort calls carry propertyId; `getUnit(tx, unitId, scope)`;
       - FinancePort calls carry propertyId;
       - `PaymentsPort.getPaymentStatus(tx, ref, scope)` and `describeMethod`;
       - P3-2 doc comments on `asOf`/`bookingDate`.
     - src/adapters/rates.ts:
       - `RatesProvider` (now with `verifyTerms`), `termsView`, `penaltyView`;
       - `ratesDocumentOf(view, verify?)` — the verify argument is OPTIONAL and must become required;
       - `ratesPortFrom` (omits bookingDate/asOf; `termsFromChannelPrices` throws `channel_terms_not_available` 503).
     - src/adapters/inventory.ts: `inventoryPortFrom(p)` with propertyId-bearing provider types.
     - src/domain/terms.ts: `termsDigest` excludes providerDocument but includes `providerPolicies`.
     - src/domain/readiness.ts: `ReadinessInput.paymentRedacted?: string`; a redacted payment check is excluded from ready and the blocking reason.
     - src/service/context.ts: `MONEY_READ`, `seesMoney(tx, propertyId)`, `MONEY_NOT_SHOWN`. P3: revenue managers keep totals.
     - src/service/guarantee.ts: `allowedOwners`, `checkGuaranteeMethod`, `assertGuaranteeMethod` (`guarantee_method_not_allowed`), `guaranteeCap` (policy percent; non-numeric must fail closed — P3-1), `PAYMENT_COLLECT`.
     - src/service/workflows.ts, `stepGuarantee`:
       - `externalAttestation` returns `done` when the payments/charges domain is external — must become unknown/external (R2-P2-4); also used in `stepDeposits`;
       - `readStatus` catches `scope_mismatch` → the failed step `elsewhere`;
       - an override card or amount requires `payments.payment.collect`;
       - `checkGuaranteeMethod`; the amount cap check.
     - src/service/bookings.ts: `assertGuaranteeMethod` in createBookingInternal (when guarantee.paymentMethodId) and patchBooking; booking-list money redaction; propertyId on inventory/finance calls.
     - src/service/front-desk.ts: arrivals skip payment reads when `!money` and pass `paymentRedacted`; departures redact the balance.
     - src/service/record.ts: stay and booking records redact totals, depositRequirement, status.payment and folio links (`moneyRedacted`) when `!seesMoney`.
     - src/service/provider.ts: `describeBooking`, `describeReference` (UUID regex guard); exposed via `reservationsService` and `reservationsProvider`.
     - src/contracts.ts: `frontDeskRow.redacted`; stay and booking `totals` nullable plus `moneyRedacted`.
     - Tests:
       - test/fakes/others.ts — FakePayments `methodOwners`, `addMethod(propertyId, owner)`, `describeMethod`;
       - test/fakes/rates.ts — `instantiatePaymentSchedule`;
       - test/helpers.ts — default occupant profileId = guestProfileId, which owns the default card; `inventoryPortFrom(inventoryProvider(real))`;
       - test/check-in-resume.test.ts — P1-2 test plus the patch sibling;
       - isolation-permissions FD-15 test.
   - **modules/operations:**
     - src/reservations-port.ts: `operationsForReservations`.
     - src/service/tasks.ts: `createTaskForModule` has no permission re-check.
     - src/ports.ts and src/service/maintenance.ts: propertyId on blockUnit/releaseBlock.
     - test/real-inventory.test.ts uses `inventoryProvider`.
   - **modules/guests:**
     - src/service/search.ts: phone fragment (a leading + with ≥3 digits, or ≥4 digits) using a `%fragment%` match.
     - Test: src/service/search-kind.test.ts.
   - **modules/platform/src/routes.ts:** `GET /properties/:id/data-authority`, `GET /properties/:id/policies/:key` and `POST /policies/preview`, with a 404 via getProperty.
   - **apps/api/src/composition.ts:**
     - finance ports: bookings → `reservationsRef.describeBooking`; tax → `bindFinanceTax(() => ratesRef)`; payments → `paymentsCollectionsForFinance(paymentsRef)`; payers → guests profiles and companies;
     - payments: `ledger: financeLedgerForPayments(finance)`, `references: describeReference`;
     - reservations ports: inventory, `ratesPortFrom(ratesProvider(rates))`, guests, `financeForReservations`, `payments.service.provider`, `operationsForReservations`, the access fallback;
     - late-bound refs: ratesRef, paymentsRef, reservationsRef;
     - `services` include finance and reservations.
   - **apps/api/test:**
     - scenarios/harness.ts:
       - `startScenario` (fixedClock 2027-03-08T09:00+05:00), `organization`, `property`/`kandu`/`hiyani`;
       - `bookingInput` with `guestProfileId`, `applied`, `makeExternal` (connectionId newId), `signIn`;
       - `cardOnFile(s, org, propertyId, legalEntityId, token, owner)`, `guestWithCard(s, org, p, guest, token)`, `readyUnit`;
       - `assertGlobalConsistency`, including the stray-deposit check.
     - scenarios s01, s03–s08, s13–s17 passing; todo files for s02, s09–s12, s18–s20; scenarios/README.md (binding manifest and assertion map).
     - Other test files: bindings.test.ts, review-regressions.test.ts (P1-1, P1-2, P1-3, P2-1, P2-2, P2-3, P2-6, P3-9 tests), ux-wiring.test.ts, finance.test.ts, payments.test.ts (uses `org.folio()` instead of unknown bookings), reservations.test.ts.
   - **Docs:**
     - docs/orchestration/pending-fixes.md: DONE marks; P2-5 list of still-stubbed ports; P2-6 rates and guests decision; P3-3, P3-7; the payments token-dedupe owner issue.
     - docs/OPEN_QUESTIONS.md: Q156 (late-charge automatic card charging).
     - docs/architecture/domain-map.md: integration-step and fix-round contract changes.
     - docs/product/glossary.md: payer types.
     - Module READMEs: binding status.

4. Errors and fixes:
   - The preview token field is `token`, not `previewToken`. The inventory `ref_id` column is uuid, so the SQL had to drop `::text`. reservations.terms_snapshots has no `created_at`, so order by `supersedes_id`.
   - **Deposits failed to post under the MV Green Tax rule** (`tax_occupancy_required`). Fixed by adding rates `ChargeLine.valueOnly`, set by finance for deposits. This was a contract bug.
   - **Check-in needed inspection, not just clean**, so `readyUnit` uses `setCondition` clean plus `recordInspection`. `readyUnit` and `cardOnFile` moved into the harness.
   - **Check-out with a balance** needs `reservations.stay.checkoutWithBalance`, so the test uses the general_manager role. The late-charge service date had to be '2027-03-12'.
   - **Payments method dedupe by token** returned the first guest's card (owner) for the second guest. Fixed by using a distinct token ('pm_card_mastercard'). This is now R2-P2-1.
   - **Unknown booking refs** in payments.test.ts were refused after P1-1, so the test switched to folios.
   - **Finance test fallout:** a fake booking directory, and tests now register bookings.
   - **Nullable totals fallout:** tests use `?.`. A sed character-class bug was fixed by switching to a python regex. Accidental edits to rates.test.ts and s08 were reverted.
   - **Delegation without scope** threw a TypeError when called with undefined scope; the adapter now uses `scope?.propertyId` so `delegated()` throws "scope".
   - **Lint:** unused imports after the merge (cardOnFile in s03/s07) were removed; formatting fixed with biome.
   - **Merge conflicts** in the append-only docs were resolved as unions; Q146 was renumbered to Q156.
   - Tool errors: reading a file before Edit (I used python edits instead); foreground `sleep` blocked (I used until loops in a background run).

5. Problem Solving:
   - **Last gate results (fix round 1, merged tree, prefix w1_intstep_fix):**

     | Command | Exit / result |
     |---|---|
     | `pnpm install --frozen-lockfile` | 0 |
     | `pnpm lint` | 0 |
     | `pnpm turbo run typecheck --force` | 0 (18/18) |
     | `pnpm turbo run test --force --concurrency=2` | 0 (16/16) |
     | `pnpm turbo run test --force` (default concurrency) | 0 (16/16) |

     - Test counts: api 79 passed and 29 todo; reservations 149; payments 113; finance 85; rates 130; guests 174.
     - No leftover test databases.
   - **HEAD:** 6fb1d00. Fix-round-1 commits:
     - 6d0cae8 — P1-1, P1-2, P2-7
     - 4e061b3 — P1-3, P3-5
     - 7b81cc9 — P2-1
     - 8b3fdfb — P2-2
     - 216200e — P2-3, P3-1
     - ee4fcb4 — P2-4
     - e9e8b7d — P2-6
     - eaa99fc — P3-9, P3-2, P3-4, P3-6, P3-8
     - 1b9cf7b — docs and the deposit consistency check
     - e47ef37 — P1-2 patch sibling test
     - b4370d9 and 4b63ff5 — merges
     - 6fb1d00 — lint
   - **The R2 review says each fix stopped the exact attack but failed one step beyond.** Known weak spots to address:
     - the allowed-owner rule (staff-linked person ≠ supplied card);
     - late-charge per-charge request versus total balance;
     - importOpeningDeposits not using the directory;
     - two predicates (payments pre-check vs finance) that can disagree;
     - `assertReferenceAt` skipping folio and other ref types;
     - `externalAttestation` returning `done`;
     - the run endpoint and stay issues leaking payment step messages;
     - the optional `verify` in `ratesDocumentOf`;
     - `guaranteeCap` with a non-numeric policy;
     - revenue_manager losing totals under the MONEY_READ rule.

6. All user messages:
   - **Message 1 — the initial integration task.**
     - Full Phase A/B brief, including: "Never weaken a test to make a binding pass. If a module has a real contract bug, fix it in that module with a regression test", "Use the module contracts; never import across modules", "a parallel branch (identity-plus) will soon make sensitive permissions require MFA … Write scenarios so they survive that … use helpers I can update in one place", "Before you finish: `pnpm lint`, `pnpm turbo run typecheck --force` and `pnpm turbo run test --force`, checking exit codes", "Commit locally after each meaningful step with Conventional Commits; never push", Postgres URL, and `PORTICO_TEST_DB_PREFIX=w1_intstep`.
     - Reply format: a ports table, scenarios, contract bugs, command results, owner decisions.
     - The CLAUDE.md rules apply: never activate paid contracts, live transactions or production keys; no secrets in code or logs; parallel agents commit locally and do not push.
   - **Message 2 — coordinator mid-task (UX round 1).** "treat these as the API-side specification … check that the HTTP surface those refinements need exists, and note any gaps in your report; don't build the UI": SET-05/INT-03 routes; NAV-03/GST-01 search; FD-15 money redaction. "Cheap additions are fine." Main has turbo hashing changes and a 120 s demo-seed timeout.
   - **Message 3 — coordinator, steward review fix round** ("merge after fixes", P0 0 · P1 3 · P2 7 · P3 9).
     - Fix P1-1 (booking-directory port; refuse unknown and other-property bookings), P1-2 (require `payments.payment.collect` for an override card or amount; verify the card owner; cap the amount by policy) and P1-3 (late charge requests at most what the folio owes; fix the bindings test assertion).
     - Fix the P2s: FD-15 completion; finance delegation property REQUIRED; rates adapter seal verify; S04 proof; correct the report about stubbed ports; rates and guests re-checks (remove or record a decision); fix the dangling OPEN_QUESTIONS reference. Fix the cheap P3s.
     - New process: self-check playbook tables; scenario-tests v2 manifest and assertion map; re-attack table per P1.
     - Merge main first; conflicts are append-only, keep both sides; renumber the question above Q155 if it collides.
     - Gates: `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` with PORTICO_TEST_DB_PREFIX=w1_intstep_fix. "Commit (Conventional Commits) and don't push."
   - **Message 4 — coordinator resume.** "Resume after the owner's checkpoint. Your WIP is committed … as 'wip(...): usage-limit checkpoint' … amend or keep it as you prefer. Continue the fix round exactly where you stopped …"
   - **Message 5 (latest) — coordinator, focused re-review** ("merge after fixes", P0 0 · P1 3 · P2 4 · P3 5).
     - Report: docs/orchestration/reviews/review-integration-step-2.md on main. PoCs: integration-step-poc/r2-fix-attacks.test.ts.txt — flip each into a regression test asserting refusal.
     - ADR-0015 Amendment 1, the R2-P1/P2/P3 fixes and SW-PAY-1..4: details in section 1.
     - Process:
       - "Self-check v3 tables"
       - "One regression test per SIBLING entry point, not only the PoC path"
       - "A re-attack table for every P1, including the attack 'one step beyond' your own fix"
       - "Never rewrite pushed commits"
     - Gates: `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2` with PORTICO_TEST_DB_PREFIX=w1_intstep_fix2. "Commit and don't push."
     - "Reply with finding → commit → test, the tables and the exit codes. Another focused re-review will follow."

7. Pending Tasks (from the latest message):
   - `git merge main`: picks up the round-2 review, the PoCs, ADR-0015 Amendment 1, review-fix-sweep.md and fix-sweep-poc. Run `pnpm install --frozen-lockfile`.
   - Read review-integration-step-2.md, r2-fix-attacks.test.ts.txt, review-fix-sweep.md, payments-zz-review-sweep.test.ts.txt, the ADR-0015 amendment, and self-check playbook v3.
   - **R2-P1-1:** Amendment 1 card guarantee on every path that records or uses a card: booking create and patch, check-in, payments routes, channel bookings.
   - **R2-P1-2:** a late-charge balance request per folio that tracks the full outstanding balance (an amend/cancel command in payments, or one balance request per folio); the collect exception stays urgent; never record an unrequested amount; a reversal reduces or cancels the request.
   - **R2-P1-3:** the opening-deposit import asks reservations; ONE shared predicate for payments' pre-check and finance's posting check.
   - **R2-P2-1:** card ownership is not first-saver-wins (owner link or refusal); keep the cardholder relation across a profile merge.
   - **R2-P2-2:** no payment state on the check-in run endpoint or in stay issues for non-money roles.
   - **R2-P2-3:** payments checks every reference type, folio included.
   - **R2-P2-4:** the connected-mode guarantee is unknown/external, not done, without confirmation.
   - **P3s:**
     - P3-1: a non-numeric cap policy fails closed;
     - the rates seal check is required (not `verify?`);
     - revenue managers keep booking totals;
     - other cheap P3s from review 2.
   - **SW-PAY-1..4:** double-collection guard on all paths with locked reads; `custom` purpose needs a reason and audit; card-on-file checks the card's property and legal entity; CIT/MIT derived from server facts, not the client's `entryChannel`.
   - Regression tests per sibling entry point; re-attack tables; self-check v3 tables; scenario manifest updates if needed.
   - Gates with prefix w1_intstep_fix2; commit (never rewrite pushed commits; don't push); reply via SubagentHandback with finding → commit → test, the tables and the exit codes.

8. Current Work:
   - I had just finished fix round 1 and delivered the report via SubagentHandback. HEAD is 6fb1d00, all gates were green and the tree was clean.
   - The coordinator then sent the focused re-review message (round 2) with R2-P1-1..3, R2-P2-1..4, P3s and SW-PAY-1..4.
   - The current instruction is to produce this summary (text only). No round-2 work has been started yet.

9. Optional Next Step:
   - Begin the round-2 fix work exactly as requested: "Fix: R2-P1-1: implement Amendment 1 for every path that records or uses a guarantee card. That covers booking create and patch, check-in, payments routes, and channel bookings."
   - Concretely:
     1. In /home/user/wt/integration-step, run `git merge --no-edit main` and `pnpm install --frozen-lockfile`.
     2. Read docs/orchestration/reviews/review-integration-step-2.md, docs/orchestration/reviews/integration-step-poc/r2-fix-attacks.test.ts.txt, the ADR-0015 Amendment 1 text, docs/orchestration/reviews/review-fix-sweep.md with fix-sweep-poc/payments-zz-review-sweep.test.ts.txt, and the self-check v3 playbook.
     3. Copy the r2 PoCs into apps/api/test as regression tests asserting refusal, then implement the fixes. Start with the P1s, replacing reservations' `allowedOwners` rule in src/service/guarantee.ts with "supplied by the cardholder for THIS booking or covered by a recorded mandate".
     4. Run the gates with `PORTICO_TEST_DB_PREFIX=w1_intstep_fix2` and commit without rewriting pushed commits.

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a29fdf2e9c7d0e9dc.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T17:04:17.381Z)

````text
## Integration step: report (branch `feat/integration-step`, worktree /home/user/wt/integration-step, HEAD `dcddb8b`, not pushed)

Every reservations, finance and payments port that was still a 503 stub now goes to its real provider. Operations and reservations no longer reach inventory with system scope. I merged main after UX round 1 landed (`a5d0069`).

### 1. Ports
| Port | Bound? | Adapter | Proof → refusal test |
|---|---|---|---|
| finance.tax → rates | yes | `bindFinanceTax` in `apps/api/src/composition.ts` | `finance.test.ts` (a spa charge gets TGST from rates; live invoice refused `tax_rules_unverified`) |
| payments `LedgerPort` → finance | yes | `financeLedgerForPayments(finance)` | `payments.test.ts` "folio collections post to finance…" (posted once; refused: unknown folio, other-property folio). s05 and s06 |
| finance `PaymentsPort.requestCollection` → payments | yes | new `modules/payments/src/finance-collections.ts` (creates a payment request, records intent only) | `bindings.test.ts` "whole stay" (a late charge after departure creates a payment request). Refused: another property's folio → `not_possible`, nothing recorded |
| finance payer directory → guests | yes, now also companies and agencies | composition | s04 (the company folio is named) |
| reservations.rates → rates | yes | new `modules/reservations/src/adapters/rates.ts` `ratesPortFrom` | `bindings.test.ts` (seal verifies on the stored document; extension via `priceChange`; penalty from rates). Refused: `rates_managed_externally` |
| reservations.inventory → inventory | yes, no system scope | `inventoryPortFrom(inventoryProvider(...))`; new `modules/inventory/src/provider.ts` | `bindings.test.ts` (an agent with no inventory keys books and assigns). Refused: `scope_mismatch`. Also `modules/inventory/test/provider-port.test.ts` |
| reservations.guests → guests | yes, direct and type-checked | composition | `bindings.test.ts` (stay history). Refused: guest profiles external. s15 |
| reservations.finance → finance | yes | `financeForReservations` (`propertyId` on every call) | `bindings.test.ts`. Refused: another property's folio → 403; charges external. s04 |
| reservations.payments → payments | yes, direct | `payments.service.provider` (property-scoped) | `bindings.test.ts` (one authorization, sent once). Refused: `scope_mismatch`; payments external. s05 |
| reservations.operations → operations | yes | new `modules/operations/src/reservations-port.ts` | `bindings.test.ts`. Refused: `unit_property_mismatch`. s07 |
| operations.inventory → inventory | yes, no system scope | `inventoryProvider` (`propertyId` added) | `operations/test/real-inventory.test.ts`. s08 (engineer with no inventory keys) |

- **Still unbound (out of scope here):**
  - integration: catalog for tax rules, charge codes and outlets; activation scope; authority transitions (wait for identity-plus, FR-2); inbound handlers.
  - rates: `channelForApiClient`, `affectedAgreements`.
  - guests: reference counters, data-export contributors, booking lookup, comms.
  - reservations: door locks/keys still use the environment-safe fallback (simulated outside live).
- **ADR-0015:**
  - The property-scoped delegation helper now lives in the kernel (`delegateAtProperty`).
  - Inventory and payments no longer re-check their own permissions on port calls; they refuse records of another property instead. Their HTTP routes keep their checks.
  - Refunds, overbooking, house-use blocks and lock overrides still need explicit permission.
  - Operations' `createTask` provider no longer re-checks its own permission.
- **Other cleanup items:**
  - v2 booking and stay events: confirmed working end to end with operations (s07).
  - Payer types are now defined once in the glossary.
  - `aggregateVersion` is only partly adopted: inventory unit and unit-type events now carry it; payments does not yet.
  - 13 entries in `pending-fixes.md` marked DONE, 3 marked PARTLY DONE with what remains, and follow-ups added.

### 2. Scenarios (`apps/api/test/scenarios/`; shared helpers in `harness.ts`)
- **Passing (12), each ending with the global consistency checks:** S01 (+ 20-way stress), S03, S04, S05 (+ failure variant), S06, S07, S08, S13, S14, S15, S16, S17.
- **Parts of passing scenarios left as todo, each naming the missing piece:**
  - payment authorization increase on extension and the 12 Mar move task (S03);
  - Day Close, receivables and invoices per payer, transfer preview (S04);
  - desk alert and waiting-guest timer (S07);
  - relocation to a sister property and relocation costs (S08);
  - "Delayed" labels on the offline device (S13);
  - finance and comms consuming unmerge (S15);
  - policy locks and exemptions (S16);
  - security log, exports and webhook replays (S17).
- **Todo only:**
  - S02: needs distribution, rates channel-price terms and payment collection plans.
  - S09: Day Close.
  - S10: needs resort POS intake, automatic card-on-file charging and a supplementary folio after an invoice. The finance → payments part is already proven in `bindings.test.ts`.
  - S11: groups module.
  - S12: resort and comms modules.
  - S18: migration import.
  - S19: Day Close, POS and cashier (rates' pricing part is proven in the rates module).
  - S20: distribution and collection plans (payments' own S20 test covers its part).
- **For identity-plus:** staff act through service-level contexts built from role templates. Password sign-in happens only in `signIn()` and data-authority changes only in `makeExternal()`, both in `harness.ts`. When identity-plus merges, those two are the places to update.

### 3. Contract bugs fixed
1. **Every booking deposit failed to post to the ledger when the Maldives tax rules were installed.** Finance taxes a deposit at receipt without knowing occupancy, and the per-person Green Tax rule refused (`tax_occupancy_required`). Fix: rates' charge line gets `valueOnly`, and finance sets it for deposits. Regression tests in the rates tax-engine test and the "whole stay" binding test.
2. **Quotes with real rates would need a backdating permission.** Reservations sent the business date as `bookingDate`/`asOf`, which rates treats as backdating (`rates.quote.backdate`). The adapter now omits them, so rates evaluates "now".
3. **Previews would always go stale with real rates.** The preview fingerprint included the sealed document, whose quote id and seal change on every quote. The fingerprint now excludes it.
4. **Operations' `createTask` provider re-checked its own permission**, contrary to its README and ADR-0015. Removed.
5. **Company folios showed a placeholder payer name.** Finance's payer directory now names companies and agencies through guests.

### 4. Commands (final)
- `pnpm lint`: exit 0 (module boundaries OK).
- `pnpm turbo run typecheck --force`: exit 0, 16/16 tasks.
- `pnpm turbo run test --force`: exit 0, 14/14 tasks. API: 68 passed, 29 todo. Reservations 148, guests 173, integration 173, rates 129, operations 120, payments 113, inventory 98, finance 85, kernel 26, plus db, platform, identity and http.
- After that run I added one more refusal test (finance → payments); I re-ran that file, lint and the api typecheck, all green.

### 5. Decisions and next steps
- **Q146 (owner)** in `docs/OPEN_QUESTIONS.md`: should late charges be charged automatically to the card on file? Default: always send a payment request; staff decide on any card charge.
- **Engineering, not owner:** complimentary stays still need both `reservations.stay.complimentary` and `rates.price.override`. Rates also still checks `rates.quote.read` on port calls. Recorded in pending-fixes.
- **UX round 1 wiring:**
  - Added `GET /v1/properties/:id/data-authority`, `GET /v1/properties/:id/policies/:key` and `POST /v1/policies/preview` (INT-03, SET-05). Write routes should wait for identity-plus.
  - Search now matches phone fragments of 3 or more digits (NAV-03). Search hits resolve to record types the UI knows, `guest_profile` included (GST-01).
  - FD-15: balances and payment detail are hidden on the front-desk boards for roles without money permissions (tested).
  - Still open:
    - NAV-03 ranking by stay status and the "why it matched" line;
    - money on booking and stay records beyond the boards (FD-15).
- **Domain map:** the contract changes are recorded in `docs/architecture/domain-map.md` under "Integration step".
````

## Report (2026-11-07T18:07:07.577Z)

````text
## Integration-step fix round: all P1s and P2s fixed, gates green

I fixed the 3 P1s, all 7 P2s, and six of the nine P3s: P3-1, P3-2, P3-4, P3-5, P3-6, P3-8 and P3-9. P3-3 and P3-7 are recorded in pending-fixes, not fixed. Every reviewer PoC is now a regression test in `apps/api/test/review-regressions.test.ts` that asserts the attack is refused. Branch `feat/integration-step` @ `6fb1d00`, worktree /home/user/wt/integration-step, not pushed.

I merged main twice; conflicts were only in the append-only docs and were resolved as unions. My late-charge question is renumbered **Q156** (Q146–Q149 belong to identity-plus, Q150–Q155 were on main). I replaced the usage-limit WIP checkpoint with a proper commit. The pending-fixes reference to a non-existent OPEN_QUESTIONS entry is gone; it now records the rates and guests decisions below.

### Correction to my previous report (P2-5)
"Every port bound" was wrong. These are still stubs on main, now listed in pending-fixes:
- **integration:** `inbound` handlers (`{}`: reservations, roomStatus, charges); catalogs for `taxRule`, `chargeCode`, `ledgerAccount` and `outlet`; `activationScope` and `transitions` (wait for identity-plus).
- **rates:** `affectedAgreements` and `channelForApiClient`.
- **guests:** `referenceCounters`, `personalDataContributors`, `bookingLookup`, `communications`.
- **reservations:** `access` (environment fallback adapter; no access module exists).
- **Reads still made with system scope** (routing metadata, not ADR-0015 port commands): integration's catalog reads of inventory and rates, rates' `getProperty`/`listUnitTypes`/`companyExists`, and platform `getProperty` reads in finance, guests and payments.

### Finding → commit → test
| Finding | Commit | Regression test |
|---|---|---|
| P1-1 deposit for another property's or an unknown booking | `6d0cae8` | review-regressions "P1-1" (2 tests); finance payments-ledger-port test (unknown → `ledger_target_unknown`) |
| P1-2 check-in holds any card for any amount | `6d0cae8`, `e47ef37` | review-regressions "P1-2" (2 tests); reservations check-in-resume "review P1-2" |
| P1-3 late charge over-collects | `4e061b3` | review-regressions "P1-3"; bindings test now asserts the requested amount |
| P2-1 FD-15 money still visible | `7b81cc9` | review-regressions "P2-1"; reservations isolation-permissions FD-15 |
| P2-2 organization-wide finance delegation | `8b3fdfb` | review-regressions "P2-2" (scoped → 403; omitted scope → refused, never widened) |
| P2-3 rates seal not verified before use | `216200e` | review-regressions "P2-3" |
| P2-4 S04 claim weaker than its test | `ee4fcb4` | s04: same villa type, with and without children; Green Tax 12 × persons × nights; infant exempt |
| P2-5 stub list | `1b9cf7b` | pending-fixes entry; `apps/api/test/scenarios/README.md` binding manifest |
| P2-6 rates and guests re-check their own keys | `e9e8b7d` (rates), `1b9cf7b` (guests decision) | review-regressions "P2-6" |
| P2-7 misleading 403 at check-in | `6d0cae8` | guarantee step fails with the recovery instead of throwing |
| P3-1 / P3-2 / P3-4 / P3-5 / P3-6 / P3-8 / P3-9 | `216200e` / `eaa99fc` / `eaa99fc` / `4e061b3` / `eaa99fc` / `eaa99fc` / `eaa99fc` | rates and guests unit tests; s05 (user path) and s01 (no postings asserted); review-regressions "P3-9" ×2 |

What changed:
- **P1-1:** reservations now answers "which property owns this booking or stay". Finance uses it before recording any deposit: unknown booking → `ledger_target_unknown`, another property → `scope_mismatch`. A booking is never bound to the first property that pays. Payments no longer lets unknown bookings through, and refuses holds for another property's or an unknown stay or booking.
- **P1-2:** choosing another card or an amount at check-in needs `payments.payment.collect`. The card must belong to the booking's booker, an occupant, the company/agency or the billing payer; this is also checked when a booking records or patches its card. The amount is capped by policy `reservations.checkIn.guaranteeCapPercent` (default 150 % of the agreed stay total).
- **P1-3:** finance requests `min(late charge, folio balance after posting)`. When the folio is still in credit nothing is requested and a routine exception records `covered_by_credit`. The payer type now reaches payments (P3-5).
- **P2-1:** for roles without finance or payments read permissions, payments is not read at all. The payment check shows `unknown` / "not shown for your role" and does not count towards ready or the blocking reason. Booking and stay records and booking lists return no totals, deposit requirement, payment status or folio links (`moneyRedacted`). `totals` is now nullable on booking and stay views.
- **P2-2:** finance's delegation helper always needs a property (or `null` for legal-entity-level calls) and throws otherwise. Every function of the reservations adapter requires `propertyId`.
- **P2-3:** the reservations rates adapter verifies the seal before evaluating penalties, deposits, complimentary terms or price changes (`terms_seal_invalid`). For P3-1, the preview digest now includes the provider's policies verbatim.
- **P2-6 rates:** a rates port surface grants `rates.quote.read` at the quoted property only. Complimentary terms and price overrides still need `rates.price.override`, and backdating still needs its own key.
- **P2-6 guests (decided, not changed):** `resolveProfile` keeps checking `guests.profile.update`. Matching reveals whether a guest exists by email, phone or document, so delegating it would let roles without guest access probe for guests. Every booking role template already holds that key.
- **P3-9:** when charges or payments are external, the deposits or guarantee step is marked done and names the system of record, instead of interrupting check-in.
- **New global consistency check:** every deposit finance holds must belong to a reservations booking of the same property.

### Re-attack table (self-check §3)
| Finding | (a) reverse order | (b) siblings checked | (c) failure path | (d) griefing | (e) atomic |
|---|---|---|---|---|---|
| P1-1 | Ghost-booking deposit refused first, so nothing can be bound later; first deposit at the owner, later one from another property refused (finance test) | payments charge, capture, payment request, VCC (all through the ledger-target check); finance via payments and the reservations port; Route-D recorded authorization; hold for a stay ref | 0 new payments, 0 deposit accounts (row counts compared before and after) | Hiyani can no longer put Kandu's stay or booking into the refused state (stay/booking holds refused); owner's deposit and check-in still work | n/a (no counter) |
| P1-2 | Stranger's card attached at booking creation or patch is refused before the desk acts | check-in override, booking create, patch booking, the payments route itself | 0 authorizations; booking count and version unchanged | No outside party can make a guest's own card fail; the guest's card succeeds | Cap is a fixed limit per stay; one authorization in flight per reference (payments unique index) |
| P1-3 | Credit first, then a larger charge → exactly the remaining debt is requested | finance's collection request is the only caller | Folio in credit → no request row | n/a | Balance is read after posting, under the folio row lock; a concurrent second request is refused by payments (one in flight). **No concurrent test** |
| P2-1 | n/a | arrivals board, booking and stay records, booking lists (departures were already done) | n/a | n/a | n/a |
| P2-2 | n/a | finance: reservations adapter, credit notes, receivables invoices | omitted scope throws before any read | n/a | n/a |
| P2-3 | n/a | penalties, schedule, complimentary terms, price changes | refused before any evaluation | n/a | n/a |

### Self-check §2 (items 5–32): 19 yes · 5 N/A · 4 no
- **Yes:** 5, 6, 7, 8, 10, 12, 14, 15, 16, 19, 20, 21, 22, 24, 25, 27, 30, 31, 32.
- **N/A:** 18, 23, 26, 28, 29.
- **No, each listed as a gap:**
  - 9 and 11: no concurrent test for two late charges on the same folio.
  - 13: payments events still carry no `aggregateVersion` (in pending-fixes).
  - 17: no ±1 boundary test at the guarantee cap.

### Scenario-tests v2
- **Binding manifest** in `apps/api/test/scenarios/README.md`: no module fakes are imported. Every exercised port is real except access (simulated keys), which S03, S05 and S15 touch only in the check-in keys step. That step is outside their catalogue lines; they are marked accordingly, not as blocked.
- **Assertion map:** every State, Money, Inventory, Audit and Recovery line of the 12 passing scenarios points to a file:line or a named `.todo`. Still todo: S02, S09–S12, S18–S20.

### Commands (merged tree, exit codes read directly, `PORTICO_TEST_DB_PREFIX=w1_intstep_fix`)
| Gate | Exit |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm lint` | 0, boundaries OK, no warnings |
| `pnpm turbo run typecheck --force` | 0, 18/18 |
| `pnpm turbo run test --force --concurrency=2` | 0, 16/16 |
| `pnpm turbo run test --force` (default concurrency) | 0, 16/16 |

- **Test counts:** api 79 passed, 29 todo; reservations 149; payments 113; finance 85; rates 130; guests 174; operations 120; inventory 98; integration 173; ui 87; backoffice 36; kernel 26; db 12; platform 9; identity 5; http 3.
- **Slowest API files (CI run):** review-regressions 7.7 s, rates 6.7 s, bindings 6.4 s, inventory 6.2 s, demo-seed 6.0 s, s01 4.8 s. All are within the 30 s per-test budget.
- **Test databases:** none with the `w1_intstep_fix` prefix left behind.

### Still open, recorded in pending-fixes
- **P3-3:** operations' `getUnitCondition` and provider `createTask` do not check stay, guest or department refs against the property.
- **P3-7:** `booking.depositRequirement` should come from the agreed payment schedule, not client input.
- **Saved-card ownership:** payments returns an already-saved token's method with its original owner. With the new owner check, a second guest saving the same token gets a card they cannot use; payments needs to decide refuse vs owner link.
- **Q156** (owner): automatic charging of a departed guest's card for late charges. Default: always a payment request.
````

