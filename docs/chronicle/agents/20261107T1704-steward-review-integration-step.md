# Agent run: Steward review: integration step

- Started: 2026-11-07T17:04:43.667Z · last activity: 2026-11-07T17:26:52.018Z
- Turns: 149 · tool uses: 161 · output tokens: 108,602
- Type: general-purpose

## Brief (2026-11-07T17:04:43.667Z)

````text
You are the architecture steward for Portico, a hospitality management platform (TypeScript modular monolith, repo /home/user/portico). Read CLAUDE.md and docs/orchestration/steward-review-brief.md first. If docs/quality/playbooks/steward-reviewer.md exists, also read it on main or on branch docs/quality in /home/user/wt/quality, and follow its latest version; it holds lessons from earlier reviews. Also read docs/quality/README.md if present, and the attack-pattern library docs/quality/patterns.md if it exists on either.

Review branch `feat/integration-step` (worktree /home/user/wt/integration-step, HEAD dcddb8b or later). Do NOT modify that worktree. Run experiments in a detached scratch copy (`git worktree add --detach <scratch> feat/integration-step`) and remove it at the end.

What the branch does (the engineer's own claims, which you must verify):
- It binds every cross-module port that was stubbed:
  - finance tax → rates;
  - payments LedgerPort → finance;
  - finance collection requests → payments;
  - reservations → rates (new `ratesPortFrom` adapter), inventory, guests, finance, payments and operations;
  - operations → inventory.
- **ADR-0015 changes:** a new kernel helper `delegateAtProperty`. Inventory, payments and operations' createTask no longer re-check the caller's permission keys on PORT calls; they refuse records of another property instead. Refunds, overbooking, house-use blocks and lock overrides keep explicit permissions.
- **Five contract bugs fixed:**
  - deposit tax via a `valueOnly` charge line;
  - the adapter no longer sends bookingDate/asOf to rates;
  - the preview fingerprint excludes the sealed terms document;
  - operations' createTask permission re-check removed;
  - company and agency payer names.
- New HTTP routes:
  - GET /v1/properties/:id/data-authority;
  - GET /v1/properties/:id/policies/:key;
  - POST /v1/policies/preview;
  - search matching phone fragments;
  - FD-15: money hidden on boards for roles without money permissions.
- 12 scenario tests pass in apps/api/test/scenarios/ (S01, S03–S08, S13–S17 with consistency checks); the rest are todo.

Focus your attack effort where this branch can break the platform's guarantees:
1. **Authorization across ports (ADR-0015).** With permission re-checks removed from providers, can any entry point now reach a provider effect the user is not authorized for? Look for:
   - an HTTP route in module A that calls B's provider without A authorizing the intent at that property;
   - property-scope confusion: a propertyId taken from the request rather than from the record;
   - a legal-entity mismatch;
   - delegation that widens scope;
   - port calls reachable by API clients or guests.

   Check every refusal claim with a test of your own.
2. **Money correctness across bindings:**
   - deposits, collections, refunds and taxes posted exactly once under retries and concurrency;
   - property and legal-entity scoping on every posting;
   - the deposit `valueOnly` tax change: is Green Tax still owed correctly later, with no double or missing levy?
   - payment → ledger idempotency;
   - finance → payments collection requests that record intent only and never charge.
3. **Rates adapter:**
   - sealed terms stored and passed back unchanged;
   - can an altered TermsSnapshot get past `priceChange` or `evaluateCancellationPenalty`?
   - the fingerprint change: can a stale preview now commit after the price changed?
4. **Data authority and environment safety** on each newly bound path, when an external system is the system of record or the environment is non-live.
5. **New HTTP routes:**
   - information leaks across properties or tenants, such as policy values and data authority of a property the caller can't read;
   - FD-15 money hiding applies to every route that returns those fields, not just the boards.
6. **Scenario tests:** do they really prove what they claim, and do the global consistency checks run?
7. **Gates on a copy merged with current main:**
   - `pnpm lint`;
   - `pnpm turbo run typecheck --force`;
   - `pnpm turbo run test --force --concurrency=2` (PORTICO_TEST_DB_PREFIX=review_intstep; Postgres at postgres://postgres@127.0.0.1:5432/postgres).

   Check exit codes, and drop the databases you create.

Write your report to /home/user/portico/docs/orchestration/reviews/review-integration-step.md. Don't commit it. Include:
- verdict: merge / merge after fixes / do not merge;
- findings ranked P0–P3 with file:line, attack steps and a concrete fix;
- command results.

Turn every attack you prove into a PoC test file in docs/orchestration/reviews/integration-step-poc/ with a .ts.txt suffix.

Reply with the verdict, counts, the top findings in plain English and the report path.
````

## Report (2026-11-07T17:26:51.854Z)

````text
**Verdict: merge after fixes.** Counts: P0 0 · P1 3 · P2 7 · P3 9.

All gates pass on copies merged with main, both at `b44cd4c` and at `1179c98` after the backoffice merge (later `012652e` is docs only):
- `pnpm lint`: exit 0.
- `pnpm turbo run typecheck --force`: exit 0 (16/16, then 18/18).
- `pnpm turbo run test --force --concurrency=2` with `PORTICO_TEST_DB_PREFIX=review_intstep`: exit 0 (14/14, then 16/16). api has 68 passed and 29 todo.

The second merge has trivial conflicts in two docs, `docs/OPEN_QUESTIONS.md` and `docs/orchestration/pending-fixes.md`. Both are append-only and merge as a union; question numbers don't collide. My test databases are all dropped. Both scratch worktrees are removed, and the branch worktree is untouched at `dcddb8b`.

**Top findings.** Each P1 and P2 marked "PoC" is proven by a test that passes today because it asserts the buggy behaviour. The two unmarked P2s (the S04 test and the overstated binding claim) are code-reading findings.
1. **P1-1 — deposit at the wrong property or company (PoC).** A desk agent with rights only at Hiyani can charge a deposit "for" a Kandu booking. It posts to Hiyani's legal entity. Kandu's own check-in then fails with a misleading 403 saying the booking belongs to another property. A deposit for a booking id that exists nowhere is also accepted and posted. The cause is that payments skips the ownership check for bookings (`modules/payments/src/service/shared.ts:149`), and finance binds a booking to whichever property takes its first deposit. Fix: a booking-directory port from reservations, and refuse unknown or other-property bookings the way folios already are.
2. **P1-2 — check-in can hold any card for any amount (PoC).** A custom role with `reservations.stay.checkIn` and no payments permission placed a USD 25,000 hold on a card saved for a different guest. Payments' own route refuses that same user. The check-in request supplies the card and amount, and the new permission hand-off removed payments' own check (`workflows.ts:483,514,524`). Fix: require `payments.payment.collect` when the card or amount is overridden, check the card belongs to the booking's guest or payer, and cap the amount.
3. **P1-3 — late charges over-collect (PoC).** A late charge on a folio still in credit sends the guest a payment link for the full charge. In the PoC the folio was −383 USD (guest owed money) and an 117 USD request was opened (`finance/src/service/postings.ts:754`). The existing bindings test has the same flaw but doesn't check the amount. Fix: request at most what the folio actually owes.
4. **P2s:**
   - **Money hiding (FD-15) is only partial (PoC).** The housekeeping supervisor still sees which arrivals have paid (the payment check's status is kept, only its message is hidden). They can also read booking totals and payment status.
   - **Finance's port grants rights at every property when no property is passed (PoC).** Reservations always passes one today, but the parameter is optional. That is the shape of the earlier finance P0-1.
   - **The rates adapter never verifies the terms seal (PoC).** A tampered sealed document gives a cancellation penalty of 0 instead of 297,000, and no deposit. Today this needs direct database access.
   - **S04 doesn't prove what it claims.** It compares a Water Villa with children against a cheaper Beach Villa. That doesn't show child ages or Green Tax drive the price.
   - **"Every stubbed port bound" is overstated.** Still stubbed: integration's inbound handlers and catalogs, and rates' `affectedAgreements`.
   - **Rates and guests still re-check their own permissions on port calls.** Pending-fixes points to an OPEN_QUESTIONS entry that doesn't exist.

**What held up under testing:**
- The kernel `delegateAtProperty` helper.
- Inventory and operations refusing records of another property.
- House-use blocks and lock overrides staying explicit.
- The new platform routes.
- `priceChange` rejecting altered terms, and the preview fingerprint still catching price changes between preview and commit.
- The deposit `valueOnly` fix (it changes no declared tax; Green Tax stays due per guest-night).
- Payment-to-ledger idempotency.
- Collection requests that only record intent.
- S01's genuinely concurrent test, and the global consistency checks running in all 12 scenario files.

**Process note:** the orchestrator's commits `1179c98` and `012652e` swept my uncommitted PoC files and an earlier version of the report into main. I did not commit anything. The final report now shows as a working-tree modification on main.

Files are in `/home/user/portico/docs/orchestration/reviews/`:
- review-integration-step.md
- integration-step-poc/poc-deposit-wrong-property.test.ts.txt
- integration-step-poc/poc-checkin-any-card.test.ts.txt
- integration-step-poc/poc-late-charge-overcollect.test.ts.txt
- integration-step-poc/poc-fd15-money-leak.test.ts.txt
- integration-step-poc/poc-finance-unscoped-delegation.test.ts.txt
- integration-step-poc/poc-rates-adapter.test.ts.txt
- integration-step-poc/poc-connected-checkin.test.ts.txt
````

