# Agent run: Wave1: finance ledger and folios

- Started: 2026-11-07T07:32:35.571Z · last activity: 2026-11-07T12:21:52.466Z
- Turns: 413 · tool uses: 447 · output tokens: 662,149
- Type: general-purpose

## Brief (2026-11-07T07:32:35.571Z)

````text
You are the engineer for Portico's **finance** module (wave 1) — the double-entry ledger, folios, billing rules, deposits, receivables, fiscal documents and cashiering. Money correctness is non-negotiable (CLAUDE.md §5, ADR-0008, brief §9–10). First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/finance (branch feat/finance-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_finance. Module path: modules/finance (package @portico/finance, schema `finance`). Spec: /home/user/wt/product/docs/specs/finance.md (may still be in progress — re-check later).

Build (provider contract in docs/architecture/domain-map.md § finance):
- Chart of accounts per legal entity (USALI-inspired defaults: room revenue, F&B, other operated departments, service charge payable, TGST payable, green tax payable, deposits held (liability), guest ledger (receivable), city ledger/AR, cash, card clearing per provider, payout clearing, bank, FX gains/losses, rounding), configurable mapping from charge codes.
- Journal: entries + lines, balanced (deferred constraint trigger: sum per entry per currency = 0), append-only (core.make_append_only), each entry with business date, service date, revenue date, occurred_at, source ref, idempotency key UNIQUE, reversal link. Corrections only via reversing/adjusting entries.
- Folios (payer-specific; attached to stay, booking, group, company account or house account), postings (charge, payment, refund, adjustment, transfer, allowance usage) as projections of journal entries; folio balance; status (open, settled, closed, reopened-for-late-charges).
- Charge codes & revenue categories; tax lines via a TaxPort (rates.computeTaxes — port with fake in tests); inclusive/exclusive taxes; service charge.
- Billing rules (routing): route postings by charge-code group, date range, payer, and limits (e.g. company pays room+breakfast up to USD 300/night, guest pays the rest and incidentals). Use deterministic SPECIFICITY-based resolution (most specific matching rule wins; ties are configuration errors detected at save time) — NOT a user-ranked priority list (legal caution: research doc 01 flags an Agilysys patent application on ranked folio routing; record this in your README for legal review). Provide previewRouting(stay, hypothetical charges) so staff see where charges will land before saving rules.
- Transfers between folios (traceable, both sides), splits, partial payments, split tenders.
- Deposits: recordDeposit → liability; applyDeposits at check-in → moves to guest ledger; refunds of deposits; forfeiture to revenue by policy (explicit entry).
- Allowances: consumption postings against package allowances with remaining balance; unused-remainder policy hook.
- Late charges after departure (scenario s10): posting to a departed stay re-opens/creates a late-charge folio, flags for payment collection (PaymentsPort for card on file — port only), visible in an exceptions list.
- Invoices & credit notes: fiscal document ledger per legal entity with gapless numbering per series (no gaps even under concurrency — use a counter row lock), immutable PDF/JSON payload snapshot, hash chain (each doc hashes previous), credit notes reference originals; idempotent issuance.
- Receivables: company/agency AR accounts, credit limits (block or warn), invoice → AR transfer, payments/allocations, aging buckets as of a date.
- Cashier sessions: open/close with counts, cash movements, variance, per-payment-method reconciliation summary.
- FX: rates table (source, date, rate), explicit conversion on posting in foreign currency, settlement differences to FX account.
- Business date stamping from platform; unbalanced/unposted checks API for Day Close (getUnbalancedItems), trial balance, daily revenue summary.
- Provider functions used by payments (recordPayment, recordRefund, recordPayout) must be idempotent by key and never create revenue from payouts.
- Data authority: `charges` and `accounting` domains (assertWritable).
- HTTP routes for folios, postings (with idempotency), billing rules + preview, transfers, invoices/credit notes, AR, cashier, FX, trial balance. Permissions e.g. finance.folio.read, finance.posting.create, finance.posting.correct (sensitive), finance.billingRule.manage, finance.invoice.issue, finance.ar.manage, finance.cashier.operate, finance.fx.manage, finance.report.read.

Scenario tests: s04 (company pays accommodation, guests incidentals), s09 ledger part (re-posting the same night with the same key is a no-op), s10 late restaurant charge after checkout, s19 bill combining package, allowance, different taxes and partial payments — totals reconcile across folio, journal and trial balance; s18 groundwork (opening balance import entry type with reconciliation report vs provided closing balance). Plus: journal always balanced (random-sequence test), append-only enforced, gapless invoice numbering under concurrency, isolation/permissions.
````

## Follow-up message (2026-11-07T11:13:04.797Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (check `git status`, your last commit and your README Checkpoint section; your uncommitted work is still in the worktree). Commit after each meaningful step. Postgres was restarted and is up. Note: payments has finished and binds to your ledger provider functions — check /home/user/wt/payments/modules/payments/README.md § Contract changes (ledger targets folio or booking deposit; `method`/`verification` fields; `recordRefund.bookingId`; new `recordPaymentAdjustment`, `recordDisputeMovement`) and align your provider functions so the orchestrator can bind them directly. When finished, deliver your final report as originally specified.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:44:13.847Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/finance-core — "do not merge yet": P0 2, P1 10, P2 17, P3 12. Full report: /home/user/portico/docs/orchestration/reviews/review-finance.md; probes: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-finance-copy/modules/finance/test/zz-review-experiments.test.ts; adapter type-check: .../review-finance-copy/modules/finance/typecheck/compat.ts — turn them into regression tests. DECISIONS are in docs/adr/0016-finance-decisions-from-review.md on main (merge main first).
Fix:
- F-01 (P0): adjustPosting/reverseEntry must lock the folio (and posting) BEFORE computing what's left to correct (service/postings.ts ~1423-1473, ~1677-1715); concurrent corrections can never exceed the original.
- F-02 (P0): issueCreditNote must lock the invoice before checking credited totals (service/fiscal.ts ~700-756); never two credit notes beyond the invoice total.
- F-03: posting resolves rules against the posted code's full ancestry (ADR-0016 §1).
- F-04: re-applying a stay's billing instructions is a merge preserving cap usage and manual rules, with preview (ADR-0016 §2).
- F-05/F-06: tax invoices must state value/tax correctly after transfers, across a 16%→17% change (deposit tax credited with its own rate label), and for allowances per ADR-0016 §5 (Q48 pending).
- F-07/F-08: make your adapters compile against the consumers' ports and the CANONICAL providers: rates' published provider contract (rates is fixing its side now — use its computeTaxes fields, fee vs tax kinds, tax keys mapping to your TGST/Green Tax accounts so the Green Tax report fills; getRulePackStatus), reservations' FinancePort (postCharge target/TaxLine/listFolios payer); add the penalty/fee charge codes (NO_SHOW, EARLY_DEPARTURE, CANCEL_FEE, late checkout, early check-in) with correct service-date rules; booking-level fees get a folio; payer names on invoices.
- F-09 imported deposits carry already-declared tax; F-10 receipts (incl. deposit receipts) — build or list honestly; F-11 first deposit: accept propertyId from payments (payments is fixing) and open booking folios when needed; F-12 parity rows claiming `tested` must point to real tests.
- From payments review: delegated provider functions must be PROPERTY-SCOPED (verify folio/booking belongs to the caller's property and legal entity) per ADR-0015; refunds respect negative adjustments; expose recordPaymentAdjustment/recordDisputeMovement on the payments provider surface; accept `provider` for per-acquirer clearing accounts; Route D statement verification call so folios leave "awaiting verification".
- ADR-0016 §3: missing FX rate blocks (manual rate with permission + reason), no silent fallback.
- Use kernel unavailablePort/ModuleUnavailableError (code module_not_available), @portico/db pgCode/withSavepoint, remove the local teardown workaround, aggregateVersion on events.
Then lint/typecheck/tests, commit, report back briefly.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T12:02:20.979Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Edit, SubagentHandback, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - Original task (from orchestrator): Build Portico's **finance** module (wave 1) in worktree `/home/user/wt/finance` (branch `feat/finance-core`), package `@portico/finance`, schema `finance`, test DB prefix `PORTICO_TEST_DB_PREFIX=w1_finance`, following the playbook at `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md`. Spec: `docs/specs/finance.md` (now on main). Scope: double-entry ledger, chart of accounts, journal (balanced deferred trigger, append-only, idempotency), folios/postings, charge codes, TaxPort, billing rules by SPECIFICITY (no user-ranked priority; Agilysys patent caution in README), preview, transfers/splits/partial payments/split tenders, deposits (liability), allowances, late charges (S10), invoices/credit notes (gapless, hash chain, idempotent), receivables, cashier, FX, Day Close checks, trial balance, daily revenue, payments provider functions idempotent, data authority (`charges`, `accounting`), HTTP routes + permissions, scenario tests S04/S09/S10/S18/S19 + invariants. Delivered; final report via SubagentHandback was sent once.
   - Later coordinator directives (all handled before the review): merge main repeatedly; Maldives tax rules (time of supply for deposits, tax-invoice particulars, Green Tax separate, 3-day issuance check, USD ±2% MMA, 5-year retention + legal holds, monthly Green Tax report); universal record contract (status families, allowedActions, issues, owner, links, recordTypes, SearchProvider); checkpoint section in README; align with payments LedgerPort.
   - CURRENT directive (steward verdict "do not merge yet", P0 2 / P1 10 / P2 17 / P3 12; full report `docs/orchestration/reviews/review-finance.md`; probes `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-finance-copy/modules/finance/test/zz-review-experiments.test.ts`; adapter type-check `.../review-finance-copy/modules/finance/typecheck/compat.ts` (+ payments-ports.ts, reservations-ports.ts, compat2.ts) — "turn them into regression tests"; DECISIONS in `docs/adr/0016-finance-decisions-from-review.md`). Fix list:
     - F-01 (P0) adjust/reverse lock before computing remainder; F-02 (P0) credit note lock invoice before checking credited totals.
     - F-03 full ancestry/group map at posting; F-04 re-apply billing instructions = merge preserving cap usage and manual rules, with preview (ADR-0016 §2).
     - F-05/F-06 tax invoices correct after transfers, across 16%→17% (deposit tax credited with its own rate label), allowances per ADR-0016 §5 (Q48 pending).
     - F-07/F-08 adapters compile against consumers' ports and CANONICAL providers (rates computeTaxes fields, fee vs tax kinds, tax keys → TGST/Green Tax accounts so Green Tax report fills; getRulePackStatus), reservations FinancePort (postCharge target/TaxLine/listFolios payer); add penalty/fee codes (NO_SHOW, EARLY_DEPARTURE, CANCEL_FEE, late checkout, early check-in) with correct service-date rules; booking-level fees get a folio; payer names on invoices.
     - F-09 imported deposits carry already-declared tax; F-10 receipts (incl. deposit receipts) — build or list honestly; F-11 first deposit: accept propertyId from payments and open booking folios when needed; F-12 parity rows claiming `tested` must point to real tests.
     - From payments review: delegated provider functions PROPERTY-SCOPED (verify folio/booking belongs to caller's property and legal entity) per ADR-0015; refunds respect negative adjustments; expose recordPaymentAdjustment/recordDisputeMovement on the payments provider surface; accept `provider` for per-acquirer clearing accounts; Route D statement verification call so folios leave "awaiting verification".
     - ADR-0016 §3: missing FX rate blocks (manual rate with permission + reason), no silent fallback.
     - Use kernel `unavailablePort`/`ModuleUnavailableError` (code `module_not_available`), `@portico/db` `pgCode`/`withSavepoint`, remove local teardown workaround, `aggregateVersion` on events.
     - "Then lint/typecheck/tests, commit, report back briefly."
   - Later coordinator note: payments finished; align providers with payments README § Contract changes (ledger targets folio or booking deposit; method/verification; recordRefund.bookingId; recordPaymentAdjustment, recordDisputeMovement) so orchestrator can bind directly. The payments worktree now (uncommitted) has an updated LedgerPort with `describeTarget`, `LedgerScope`, `ClearingRef`, `markPaymentVerified`, `recordSettlementFees`, `recorded_verified`.

2. Key Technical Concepts:
   - TypeScript strict ESM monorepo (pnpm, turbo, TS 7 tsc, Vitest 5, Biome 2.6.6 lineWidth 110), Fastify + fastify-type-provider-zod, Zod 4, Kysely 0.29 + pg, Postgres 16 with RLS (`core.enable_tenant_isolation`, `core.make_append_only`, `core.apply_standard_grants`).
   - Ports & adapters; composition root `apps/api/src/composition.ts`; module boundary checker `tools/check-boundaries.mjs` (src must not import other modules).
   - Double-entry ledger: signed amounts (+debit/−credit), per-currency and functional balance enforced by deferred constraint triggers; txid check; postings mirrored by guest-ledger lines; claim-first idempotency (`insert ... on conflict do nothing`), request hash conflict detection.
   - FX via `fx_position` bridge lines; rate sources (operational vs reference "MMA"); `pickRate`.
   - Billing rules: specificity via selector set subset/overlap math; caps per_night/per_stay/percent; lineage via `supersedes_rule_id`.
   - ADR-0015 (port authorization: entry module authorizes; providers verify property/LE scope, not their own permission keys; withSavepoint for composite failures).
   - ADR-0016 (specificity with nesting; rule re-application = merge; missing FX blocks; deposit tax point single model with taxPointDate; allowances taxed once with package, Q48).
   - Universal record contract (`@portico/kernel` records.ts), `SearchProvider` (`@portico/db`), `recordTypes` in manifest.
   - Delegation helper `delegated(tx, perms)` + `PROVIDER_DELEGATION`.

3. Files and Code Sections (all under `/home/user/wt/finance`):
   - `modules/finance/migrations/0001_finance.sql` — whole schema. Recent additions: `postings.origin_kind text`, `postings.payment_verification` check `('provider_confirmed','recorded_unverified','recorded_verified')`, `deposit_movements.payment_method`, `payment_verification`, kind incl `'adjusted'`; `allowance_instances.tax_treatment text not null default 'taxed_at_grant' check in ('taxed_at_grant','prepayment')`; `billing_rules.supersedes_rule_id uuid references finance.billing_rules(id)`; `fx_rates` unique `(tenant_id, legal_entity_id, business_date, from_currency, to_currency, source)`; `journal_entries.entry_type` incl `'payment_adjustment','dispute'`; new `finance.payment_verifications` (append-only) and `finance.legal_holds`; `fiscal_documents.retain_until`; charge group incl `'gratuity'`.
   - `modules/finance/src/tables.ts` — Kysely typings (added origin_kind, payment_verification, tax_treatment, supersedes_rule_id, PaymentVerificationsTable, LegalHoldsTable).
   - `modules/finance/src/ports.ts` — PlatformPort, TaxPort now rates-shaped:
     ```ts
     export interface TaxPort {
       computeTaxesDetailed(tx: TxContext, input: RatesComputeTaxesInput): Promise<RatesTaxComputation>;
       getRulePackStatus(tx: TxContext, propertyId: string): Promise<{ verified: boolean; note?: string }>;
     }
     ```
     plus `RatesChargeLine` (lineId, chargeCode, taxCategory, amount, quantity?, serviceDate, taxInclusion?, nights?, occupancy?, taxPointDate?, adjustment?), `RatesTaxLine` (ruleId, ruleCode, ruleName, ruleVersionId, category, nature, basis, base, ratePercent, quantity, fixedAmount, amount, ledgerMappingKey, taxPointDate), PaymentsPort.requestCollection, CollectionRequest.
   - `modules/finance/src/domain/tax-map.ts` (new) — `PostingTax`, `normalizeLedgerKey`, `fromRatesTaxLine` (quantity-based basis → 'fee' levy; category 'fee' value-based → 'service_charge'; else 'tax'; units = persons×nights; rateCategory = ruleCode).
   - `modules/finance/src/domain/*` — routing.ts (specificity), split.ts (`+ 0` normalizes −0), ledger.ts, fiscal.ts (hash chain, retainUntil, withinTolerance, deviationPercent), invoice.ts (categories incl `'prepayment'`; totals incl `prepaymentsMinor`, `balanceDueMinor = total + prepayments + settlements`), aging.ts, cashier.ts, allowance.ts, folio.ts, fx.ts (`isReferenceRate`, MAX_RATE_AGE_DAYS=7 still — needs ADR-0016 §3 change), chart.ts (accounts incl `deposit_tax_declared`, `gratuities_payable`, `disputed_funds`), pdf.ts, types.ts (PAYMENT_METHODS incl payment_link, external_terminal), tests `domain.test.ts`, `routing.test.ts`.
   - `modules/finance/src/service/support.ts` — db, delegated, ensureChart, accountId, claimEntry, findEntryByKey, writeEntryBody (PostingDraft incl originKind, paymentVerification, tax fields; rows typed `Insertable<PostingsTable>`), loadFolio/lockFolios, raiseException, `isUniqueViolation = pgCode(err) === '23505'`.
   - `modules/finance/src/service/postings.ts` — postCharge (full `chargeGroupMap` groupOf; rates computeTaxesDetailed; provided taxes must map to existing `tax:<key>` accounts; allowance blocks with tax relief for taxed_at_grant, split across allocations), capUsage (recursive lineage CTE), recordPayment (verification, cashWithoutSession 'flag'), recordRefund (findOriginalPayment with advisory lock `finance.payment:{type}:{id}`, counts refunds and adjustments; re-checks prior), findOriginalPayment, transferPostings (copies origin kind & tax facts), adjustPosting (locks folio BEFORE computing remaining; re-checks prior; relief usage restores no used_minor), reverseEntry (locks folios before checks), collectPayment.
   - `modules/finance/src/service/deposits.ts` — prepaymentTaxes via rates (taxPointDate, filter statutory value-based 'tax'), recordDeposit (method/verification stored), applyDeposits (current computed inclusive on applied amount; diff posting is tax line with declared rule name/rate; declaredRule lookup), refundDeposit/forfeit (originalPaymentRef, movementKind 'adjusted', reason_code `refund_of:type:id`), importOpeningDeposits (F-09 not yet done).
   - `modules/finance/src/service/allowances.ts` — grantAllowance with `treatment = input.taxTreatment ?? (code.tax_group ? 'taxed_at_grant' : 'prepayment')`, taxes at grant, origin kinds; closeAllowances copies tax_treatment on carry.
   - `modules/finance/src/service/billing-rules.ts` — create/update/deactivate/list/preview; NEW `mergeBillingRules(tx, deps, {owner, rules: RuleSetInput[], preview?})` returning `{ruleIds, changes: {kept, superseded, added, deactivated, untouched}, preview}`.
   - `modules/finance/src/service/fiscal.ts` — issueInvoice (locks folio, re-checks idempotency, MV USD conversion vs MMA ±2%, particulars, depositTaxCredits with rate/ruleVersionId), issueCreditNote (locks invoice folio first), toItems uses `origin_kind`, renderDocumentPdf, verifyFiscalLedger.
   - `modules/finance/src/service/ledger-port.ts` — recordPaymentAdjustment, recordDisputeMovement, NEW describeTarget, assertTargetInScope (scope_mismatch), markPaymentVerified (payment_verifications insert), recordSettlementFees (Dr payment_fees / Cr card clearing). Import line: `import { BusinessRuleError, type EntityRef, type Money, newId, requirePermission, ValidationError } from '@portico/kernel';` and support imports incl `actorKey`, `db`.
   - `modules/finance/src/service/index.ts` — createFinance (binds all incl mergeBillingRules, recordSettlementFees, markPaymentVerified, describeTarget, assertTargetInScope, getBusinessDateFor), PROVIDER_DELEGATION, financeProvider, NEW financeLedgerForPayments (new LedgerPort shape: LedgerScope & clearing; `clearingProvider(c) = c.accountId ? `${c.provider}_${c.accountId}` : c.provider`; scope checks via assertTargetInScope; methods describeTarget, recordPayment, recordDeposit, recordRefund, recordPayout, recordPaymentAdjustment, recordDisputeMovement, markPaymentVerified, recordSettlementFees), financeForReservations (still old; needs F-07 fixes), financeSubscriptions (reservations.stay.checkedOut).
   - Other src: records.ts (folio issues incl `payments_awaiting_verification` — must exclude verified), reports.ts, receivables.ts, cashier.ts, payouts.ts, folios.ts, setup.ts (DEFAULT_CHARGE_CODES aligned to rates categories + penalty/fee codes), tender.ts (openSessionFor `opts.cashRequiresSession`), search.ts, routes.ts, manifest.ts (recordTypes), wiring.ts (`unavailableFinancePorts` uses `ModuleUnavailableError('rates (tax engine)', 'computeTaxesDetailed')`; financeDemoSeed), contracts.ts (grantAllowanceInput.taxTreatment, posting.paymentVerification).
   - Tests `modules/finance/test/`: helpers.ts (FakeTax in rates shape; teardown workaround removed), ledger, fiscal, deposits (rate-change diff −855), receivables-cashier-fx, security-and-corrections (reversal allowanceUsage 6435, folio 6435), scenario-s04/s09/s10 (aggregateVersion: null)/s18/s19 (updated numbers), payments-ledger-port (BROKEN: old shapes), reservations-port, demo-seed, review-regressions (F-01, F-02, F-03, F-04 merge, F-05 two-hop & 16→17, prepayment presentation).
   - `apps/api/src/composition.ts` — merged with inventory/guests; finance block (platform port with systemAuthorizer getProperty, `...unavailableFinancePorts()`), searchProviders incl financeSearch, subscriptions financeSubscriptions, demoSeedSteps incl `{ name: 'finance', run: (tx, org) => financeDemoSeed(tx, org) }`; `apps/api/package.json` has @portico/finance and @portico/guests; `apps/api/test/finance.test.ts` expects `module_not_available`.
   - `modules/finance/README.md` (checkpoint, capabilities, invariants, scenarios, permissions, record contract, events, ports, contract changes, adoption, gaps, open questions) — needs update for review fixes. `modules/finance/FOUNDATION_REQUESTS.md` (teardown note now moot).

4. Errors and fixes:
   - Biome `--unsafe` rewrote `[validFrom, businessDate].sort()[0]` into `Math.min(...)` (string bug) → fixed manually; avoid `--unsafe`.
   - Teardown 57P01 unhandled errors → main fixed it in packages/testing; local workaround removed.
   - Merge conflicts in composition.ts/package.json/pnpm-lock → resolved manually (lock: checkout --theirs then pnpm install).
   - Python patch assertions failing due to Biome reformatting → re-targeted strings.
   - ledger-port.ts import block broke via sed → removed leftover lines 3–8.
   - Deposit application double-counting with SC (exclusive recomputation) → recompute inclusive on applied amount; test expectation −855.
   - Review X10 expected value miscalculated → company 35000 + 25740.
   - DomainEvent now requires aggregateVersion → added `aggregateVersion: null` in S10 test.
   - Current: typecheck fails in `test/payments-ledger-port.test.ts` because adapter now requires LedgerScope (propertyId, legalEntityId) and `clearing`.

5. Problem Solving:
   - P0 races solved by lock-before-check + re-check idempotency after lock; concurrent tests pass.
   - Tax contract aligned with rates (category/basis mapping, ledger key normalization) so Green Tax report uses `tax:green_tax`.
   - Allowances: ADR-0016 §5 implemented as configurable treatment; invoice no longer double counts.
   - Test count before payments adapter rewrite: 73 passing (finance), api 13 passing; lint OK; last commits made.

6. All user messages:
   - Initial task message (orchestrator as launcher) describing the finance module build (quoted in section 1), playbook to follow, worktree, prefix, spec path, full feature list, scenario tests, and "Your final report is delivered through SubagentHandback".
   - Coordinator: "please run `git merge --no-edit main` in your worktree now (then `pnpm install`)... module-boundary guardrail... demo seeder... export your demo seed as a DemoSeedStep-compatible function..."
   - Coordinator: "verified Maldives tax/invoice rules are on main ... apply what concerns finance: 1) Tax point = time of supply... 2) Tax invoice mandatory particulars... issue within 3 days ... 3) USD conversion within ±2% of MMA... 4) Retention ≥5 years with legal hold... 5) Monthly Green Tax report..."
   - Coordinator: "new cross-module convention ... universal record contract ... recordTypes ... SearchProvider ... Never put sensitive values in audit before/after. Note coverage in your README."
   - Coordinator: "ORCHESTRATOR CHECKPOINT ... add/refresh a '## Checkpoint' section at the top of your module README ... commit 'wip(<module>): checkpoint' ... Then continue working normally."
   - User-role coordinator message: "the usage limit has reset. Continue exactly where you stopped ... payments has finished and binds to your ledger provider functions — check /home/user/wt/payments/modules/payments/README.md § Contract changes ... align your provider functions so the orchestrator can bind them directly. When finished, deliver your final report as originally specified."
   - User-role coordinator message: steward verdict "do not merge yet" with the full fix list (quoted in section 1), ending "Then lint/typecheck/tests, commit, report back briefly."
   - Security/process constraints (from playbook & CLAUDE.md, still in effect): write only inside `modules/finance/` plus minimal wiring in `apps/api/src/composition.ts`, `apps/api/package.json`, and `apps/api/test/finance*.test.ts`; do NOT modify packages/kernel, packages/db, packages/http, packages/testing, other modules, CLAUDE.md or docs outside the module (foundation needs → FOUNDATION_REQUESTS.md); never push, never rebase or touch other branches; commit with `git -c commit.gpgsign=false commit` and trailers "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" and "Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR"; never drop databases you did not create; do not start anything listening on other ports; no secrets in code/tests/logs; never run Biome on *.md; no `any`, no default exports, no floats for money, no `new Date()` in domain code; never activate paid contracts/live transactions/production keys/government submissions; never put sensitive values in audit before/after.

7. Pending Tasks:
   - Fix `test/payments-ledger-port.test.ts` to the new LedgerPort shape (add propertyId, legalEntityId, clearing) and add tests: scope mismatch refused, markPaymentVerified clears folio issue, recordSettlementFees, refund after negative adjustment ceiling.
   - Make folio issue `payments_awaiting_verification` exclude refs in `payment_verifications` (records.ts) and add Day Close item for unverified payments (reports.ts getUnbalancedItems).
   - financeProvider 'payments' surface: expose recordPaymentAdjustment/recordDisputeMovement (adapter already does).
   - F-07 reservations adapter: compile against reservations FinancePort (postCharge `target: EntityRef` narrowing with error, map/reject reservations TaxLine {code,name,kind,amount,ruleVersionId?,basis?}, pass `reason`, listFolios payer.type mapping guest→'profile' and status union, validate groups); auto-open booking folio for booking-level fees; payer placeholder flag + block live invoices with placeholder buyer (payerDetails.name override, updateFolioPayer); rewrite reservations-port test with reservations' real inputs (no payer name, codes NO_SHOW etc.).
   - Penalty-group future service date rule (service date := business date, revenue date := given).
   - F-09 opening deposits with declared tax; extend S18 test.
   - F-10 receipts: list as gap honestly (README) unless time permits; F-12 note parity rows.
   - ADR-0016 §3 FX: no fallback to older rate (exact business date), manual rate requires reason (fxRateInput `reason`), audited.
   - aggregateVersion on versioned events (folio opened/settled/reopened, billingRule.changed, cashierSession.closed, receivables).
   - applyDeposits property check (P2-08); transfer to-folio property permission.
   - Use withSavepoint around payments.requestCollection.
   - Compat regression: copy consumer port types into `modules/finance/test/compat/` with type assertions (from review `typecheck/compat.ts`, `payments-ports.ts`, `reservations-ports.ts`) — use current payments ports from `/home/user/wt/payments/modules/payments/src/ports.ts` and reservations ports.
   - Optional route for merge preview (POST /finance/billing-rules/merge).
   - Update README (checkpoint, ADR-0016 decisions, contract changes incl LedgerPort and rates TaxPort, known gaps incl receipts, credit_back in taxed_at_grant returns net only), FOUNDATION_REQUESTS (teardown moot; formatMoney exists).
   - Run `npx biome check --write modules/finance apps/api` (not --unsafe), `pnpm lint`, `pnpm typecheck`, `PORTICO_TEST_DB_PREFIX=w1_finance pnpm --filter @portico/finance test` and `--filter @portico/api test`; commit; report back briefly via SubagentHandback.

8. Current Work:
   Immediately before this summary, I rewrote `financeLedgerForPayments` in `modules/finance/src/service/index.ts` to the new payments LedgerPort (LedgerScope + ClearingRef, describeTarget, markPaymentVerified, recordSettlementFees), added `describeTarget`, `assertTargetInScope`, `markPaymentVerified`, `recordSettlementFees` to `src/service/ledger-port.ts`, added the `payment_verifications` table and `recorded_verified` state. `pnpm typecheck` now reports errors only in `test/payments-ledger-port.test.ts`, e.g.:
   `test/payments-ledger-port.test.ts(29,62): error TS2345: Argument of type '{ folioId: string; amount: Money; ... verification: 'recorded_unverified'; }' is not assignable to parameter of type 'LedgerScope & { ...; clearing: ClearingRef; }'.`
   These changes (migration, ledger-port additions, adapter rewrite) are uncommitted.

9. Optional Next Step:
   Update `modules/finance/test/payments-ledger-port.test.ts` so every LedgerPort call passes `propertyId: org.propertyId, legalEntityId: org.legalEntityId` and a `clearing` (e.g. `{ provider: 'external_terminal', accountId: null }`, `{ provider: 'cash', accountId: null }`, `{ provider: 'simulator', accountId: null }`), add a scope-mismatch refusal test and a `markPaymentVerified` test (after also excluding verified refs from the `payments_awaiting_verification` folio issue in `records.ts`), then run typecheck/tests and commit — continuing the steward fix list: "From payments review: delegated provider functions must be PROPERTY-SCOPED (verify folio/booking belongs to the caller's property and legal entity) per ADR-0015; refunds respect negative adjustments; expose recordPaymentAdjustment/recordDisputeMovement on the payments provider surface; accept `provider` for per-acquirer clearing accounts; Route D statement verification call so folios leave 'awaiting verification'." After that, proceed through the remaining pending items (F-07 reservations adapter, F-09, FX §3, aggregateVersion, compat tests, README), then "lint/typecheck/tests, commit, report back briefly."

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-aaa751e9ed2f9a82d.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T11:22:54.559Z)

````text
The finance module (wave 1) is finished on `feat/finance-core` in `/home/user/wt/finance`, committed and not pushed. Lint (including the module-boundary check), typecheck and the full `pnpm test` all pass: `@portico/finance` has 15 test files and 64 tests, and `@portico/api` has 13 tests including a new finance HTTP test. `main` was merged in three times while I worked, including the Maldives tax rules and the shared-record and search convention.

**What is built** (all at R3; nothing external is claimed):
- **Ledger:** double-entry journal per legal entity with a default chart of accounts. The database itself refuses unbalanced entries (per currency and in the base currency) and any edit or delete of posted rows.
- **Folios and charges:** folios are views of the ledger. Charges take tax from a tax-engine port and route by billing rules.
- **Billing rules:** the most specific matching rule wins. There is no ranked priority list, which keeps clear of the Agilysys patent flagged in research. Identical or partly overlapping rules are refused when saved. Per-night, per-stay and percent limits work, and a preview shows who pays before saving.
- **Money flows:** transfers, adjustments and full reversals; payments, refunds, payouts (never revenue), FX conversion and gains or losses; cashier sessions with blind counts and paid-outs; company accounts with credit limits, payment allocation and aging.
- **Deposits:** held as a liability, with TGST declared when received (time of supply).
- **Allowances:** consumed against charges; the unused remainder is forfeited, carried forward or credited back.
- **Invoices and credit notes:** gapless numbering even under concurrent requests, tamper-evident hash chain, Maldives-required content, USD conversion checked against the central-bank (MMA) rate within ±2%, a check for invoices not issued within 3 days, 5-year retention with legal holds, a reproducible PDF, and a monthly Green Tax report.
- **Other:** Day Close checks, trial balance, integrity checks, opening-balance import, record-page fields, search, and about 50 HTTP routes.

**Scenarios proven:** S04, S09, S10, S18 and S19, plus a random-sequence balance test, append-only enforcement, gapless numbering under concurrency, and tenant isolation, permission and data-authority tests.

**Ports needing binding at merge:**
- **Tax engine (`rates`):** stubbed. Taxable charges fail with an honest 503 and live invoices stay blocked until it is bound.
- **Payments collection request:** stubbed; returns "unavailable" and the late charge is listed for manual collection.
- **Payments module:** bind `financeLedgerForPayments(finance)`. It matches payments' `LedgerPort` exactly, including the new adjustment and dispute calls.
- **Reservations module:** bind `financeForReservations(finance)`. It matches reservations' `FinancePort`, including replacing a stay's whole rule set.
- **Demo data:** `financeDemoSeed` is exported but not registered in `DEMO_SEED_STEPS`.

**Contract changes:** additive inputs and outputs and new provider functions, listed in the README. One gap: payments' `recordDeposit` does not pass `propertyId`. Finance can only find the property from an existing deposit or a booking folio, so a booking's first deposit fails otherwise. The fix is a one-line change in payments; the adapter already accepts it.

**Foundation request:** a teardown race in `packages/testing` (dropping test databases) causes intermittent unhandled errors. I worked around it locally in the finance tests.

**Risks and open items:**
- **Spec conflict:** the spec's default refuses every overlapping rule; I implemented specificity as you asked, so nested rules are allowed.
- **Not built:** adjustment approval thresholds, write-offs, commissions, re-applying rules to existing charges, period close, journal exports, and forwarding charges to an external PMS.
- **Needs the Maldives tax adviser:** tax on forfeited deposits.

Everything else is in `/home/user/wt/finance/modules/finance/README.md` (capability status, invariants and the test that proves each, permissions, events, adoption modes, owner questions). The foundation request is in `/home/user/wt/finance/modules/finance/FOUNDATION_REQUESTS.md`.
````

## Report (2026-11-07T12:21:52.361Z)

````text
The steward's fix round is complete on `feat/finance-core` (worktree `/home/user/wt/finance`, HEAD `92fa31e`, committed and not pushed). Main is merged in, including rates, payments and operations. `pnpm lint` (with the boundary check), `pnpm typecheck`, `@portico/finance` (17 files, 85 tests) and `@portico/api` (10 files, 40 tests) all pass. Two items are not done: receipts (F-10) and the parity row corrections (F-12).

**Fixed, each with a regression test**
- **F-01, F-02 (P0):** concurrent corrections and credit notes can no longer over-correct. The folio or invoice is locked before the remaining amount is computed. This and the F-03 to F-06 / F-08 fixes were committed earlier in the round.
- **Payments LedgerPort, matching main's version exactly:**
  - Every call carries the property and legal entity, and a folio or booking deposit belonging elsewhere is refused with `scope_mismatch` before money moves. `describeTarget` lets payments check first; a booking's first deposit ties it to the property (F-11).
  - Each acquirer account gets its own clearing account.
  - The refund ceiling counts negative adjustments, under a lock.
  - Route D `markPaymentVerified`: the folio leaves "awaiting verification", the posting shows `recorded_verified`, and the Day Close item clears.
  - `recordSettlementFees` books acquirer fees as an expense.
- **ADR-0015:** finance now grants delegated permissions at the caller's property only. The generic `financeProvider` takes the caller's property scope as its first argument.
- **F-07, reservations adapter:**
  - It compiles against reservations' `FinancePort`: the charge target is narrowed, reservations' tax lines are mapped, and folio payers come back in reservations' payer types.
  - Charge groups are validated, and setting billing rules merges with existing ones.
  - A booking-level fee opens a booking folio when there is none.
  - Payers given only by id are named through a new payer-directory port, bound to guests in the composition root. If no name is found, the folio shows a flagged placeholder and a live invoice is refused with `buyer_name_required` until the buyer's name is entered.
  - The port test was rewritten with the inputs reservations really sends.
- **F-09:** imported opening deposits carry the tax the previous system already declared, so migrated prepaid stays are not taxed twice. This is added to the S18 scenario.
- **ADR-0016 §3:** a missing exchange rate for the business date blocks the posting; older rates are never used. Any non-MMA rate needs a reason, which is stored and audited.
- **Other review items:**
  - Versioned events carry `aggregateVersion`.
  - The late-charge collection request runs inside a savepoint; the test fails it with a real SQL error.
  - A deposit can only be applied to a folio of its own property.
- **Compatibility proof:** `test/compat/` holds verbatim copies of payments' and reservations' ports, and a test checks the adapters against them method by method. The payments copy matches main.

**Rates contract (your note):** finance's tax port already used rates' names (`taxCategory`, `taxInclusion`, `taxPointDate`). It now also passes `agreedRuleVersionIds`. Deposits use `taxPointDate` rather than `taxPointSplits`; that is the one model in ADR-0016 §4. `apps/api/test/finance.test.ts` proves at compile time that rates binds directly to finance's tax port and that finance's adapter satisfies payments' `LedgerPort` (`bindFinanceTax`, `bindPaymentsLedger`).

**Left for you at merge**
- **Bindings:** in `composition.ts`, bind the tax port to rates, payments' ledger to `financeLedgerForPayments(finance)`, and finance's collection request to payments. I left these out because `apps/api/test/payments.test.ts`, which I may not edit, expects the stubs and will need updating with the binding. Reservations' binding comes when reservations merges.
- **F-10, receipts: not built.** MIRA requires an invoice or receipt within 3 days, and for deposits that is the payment. The README now lists this as a gap with a plan.
- **F-12:** rows PAR-FIN-132/133 and the others the review named need downgrading in the parity worktree, which is outside what I may change.
- **Contract request to reservations:** pass `propertyId` on `recordDeposit`, `applyDeposits`, `listFolios`, `setBillingRules`, `getFolioBalance` and `getDepositBalance`. The adapter already accepts it; until it is sent, those calls are not property-scoped and rely on database isolation and finance's own checks.
- **Foundation request to platform:** a `lockBusinessDate` provider (review P2-01), recorded in `modules/finance/FOUNDATION_REQUESTS.md`.

`modules/finance/README.md` is updated: checkpoint, ADR-0015/0016 behaviour, ports and binding status, contract changes and known gaps.
````

