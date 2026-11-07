# Agent run: Steward review: finance module

- Started: 2026-11-07T11:23:22.543Z · last activity: 2026-11-07T11:42:40.805Z
- Turns: 227 · tool uses: 130 · output tokens: 241,213
- Type: general-purpose

## Brief (2026-11-07T11:23:22.543Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/finance-core` in worktree /home/user/wt/finance — module `finance` (double-entry ledger, folios, billing rules, deposits, allowances, invoices/credit notes, AR, cashier, FX; spec: /home/user/portico/docs/specs/finance.md; ADR-0008; /home/user/portico/docs/readiness/maldives-tax-rules.md; back-of-house boundary: /home/user/portico/docs/specs/accounting.md and /home/user/portico/docs/backofhouse/spec-change-requests.md). Author's README: modules/finance/README.md.
Money correctness is non-negotiable — focus extra care on: (a) the ledger: balanced per currency AND base currency enforced in the DB, append-only, reversals only; try to create an unbalanced or mutated entry, or a duplicate posting under concurrent retries with the same business key (scratch copy); (b) gapless invoice numbering + hash chain under concurrency, credit notes referencing originals, immutability; (c) deposits as liability with TGST at time of supply and correct crediting on the final invoice (no double taxation, no re-rating); Green Tax line excluded from the GST base; service charge inside it; MMA ±2% conversion; (d) billing-rule specificity resolution: determinism, no ranked list (patent caution), tie detection at save time, limits per night/stay/percent, preview accuracy; (e) payouts never revenue, authorizations never touching the ledger, FX gains/losses; (f) the provider adapters `financeLedgerForPayments` vs payments' LedgerPort (/home/user/wt/payments/modules/payments/src/ports.ts) and `financeForReservations` vs reservations' FinancePort (/home/user/wt/reservations/modules/reservations/src/ports.ts): produce a precise compatibility table. Note: the test-teardown race the author worked around is fixed on main (b484de3).
Do not modify the worktree; experiment in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-finance-copy. Use PORTICO_TEST_DB_PREFIX=review_finance. Parity: /home/user/wt/parity-finance/docs/parity/finance.md if present. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-finance.md.
````

## Report (2026-11-07T11:42:40.593Z)

````text
## Finance review: do not merge yet

Fix the two P0s and the finance-side P1s first. Lint, typecheck and all tests pass (finance 64/64, API 13/13), but probes in a scratch copy showed real money and invoice errors.

**Counts:** P0 2 · P1 10 · P2 17 · P3 12.

**Top 5 findings:**
1. **P0 F-01 – concurrent corrections over-correct.** `adjustPosting` and `reverseEntry` check what is left to correct before locking the folio. Three simultaneous full corrections under different keys turned a 128.70 charge into a folio balance of −257.40 and spa revenue of +200.00 debit (`service/postings.ts:1423-1473`, `:1677-1715`).
2. **P0 F-02 – concurrent credit notes double-credit.** `issueCreditNote` checks the credited total without a lock. Two credit notes (CN-000001 and CN-000002, each −128.70) were issued for one 128.70 invoice (`service/fiscal.ts:700-756`).
3. **P1 F-03 – a valid rule set blocks posting.** Codes `[BRKF, FOOD]` nested inside group `food` are accepted at save. Posting `BRKF` then fails with `billing_rule_conflict`, because posting only knows the group of the posted code (`postings.ts:344`, `domain/routing.ts:247-269`).
4. **P1 F-04 – re-applying a rule set resets limits.** Reservations' `setBillingRules` replaces the whole set, which resets cap usage and deletes staff's manual rules. A company with a 300.00 per-stay cap was billed 514.80 (`billing-rules.ts:412-470`).
5. **P1 F-05 / F-06 – tax invoices misstate tax.** Three cases:
   - A charge transferred twice is invoiced with TGST and service charge as "value", so tax charged shows 0.
   - After a 16%→17% rate change, the deposit difference shows as negative value and the deposit tax is labelled "TGST 17%". The ledger figure is correct.
   - The S19 invoice counts the dining credit and the food it paid for twice in value-before-tax (total 1,238.99 vs 1,087.51 actually paid), and allowance breakage is untaxed. This needs a decision record and the Maldives tax adviser.

**Other P1s:**
- **F-07:** `financeForReservations` does not compile against reservations' `FinancePort` (postCharge target and TaxLine shapes, listFolios payer type), although the README says it matches. At runtime, reservations' charge codes `NO_SHOW`/`EARLY_DEPARTURE`/`CANCEL_FEE` are unknown to finance, booking-level fees have no folio, and with no payer names the tax invoice buyer reads "Accommodation".
- **F-08:** finance's tax port does not match rates' `computeTaxes`.
  - Rates calls service charge a `fee` and Green Tax a `tax`, which finance would read the wrong way round.
  - Rates' `tax.tgst` key would create new accounts instead of using the TGST account, and the Green Tax report would be empty.
  - Rates has no `getRulePackStatus`.
  - Finance and rates each model deposit time of supply differently; one must be chosen.
- **F-09:** imported opening deposits drop the tax the old system already declared, so those deposits are taxed twice.
- **F-10:** FIN-R32 receipts (including deposit receipts) are missing and not listed as a gap.
- **F-11:** payments' first deposit is refused (`property_required`) because reservations never opens booking folios.
- **F-12:** several parity rows are marked `tested` for things that are not built.

**Confirmed correct:**
- Entries are balanced per currency and in functional currency, enforced in the database. Append-only rows cannot be updated or deleted.
- 20 concurrent retries with the same key produced exactly one entry.
- Gapless numbering and the hash chain hold.
- Payouts never touch revenue, and there is no authorization concept.
- Billing rules have no rank or priority field anywhere.
- The payments ledger adapter compiles against payments' port. Its main runtime problem is the missing property on first deposits (F-11).

**For the orchestrator:**
- The branch is behind main: `apps/api/src/composition.ts` conflicts on merge, and the local test-teardown workaround and `isUniqueViolation` helper should move to main's fix and `pgCode`.
- `formatMoney` already exists in the kernel, so finance's request for it is moot; messages still show "(minor units)".
- The "module not connected" error code differs between modules (`module_unavailable` vs `module_not_available`).
- Running the parity gate rewrote the generated `docs/parity/COVERAGE.md` in `/home/user/wt/parity-finance` (the tool always does). The content is deterministic, and an active researcher also writes there.

Files are in `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad`:
- review-finance.md — the full report, including the port compatibility tables (payments, reservations, tax), spec coverage, scenario verdicts and cross-module notes
- review-finance-copy/modules/finance/test/zz-review-experiments.test.ts — the probes
- review-finance-copy/modules/finance/typecheck/compat.ts — the type check of the adapters against the consumer ports
- exp1.log — probe output

````

