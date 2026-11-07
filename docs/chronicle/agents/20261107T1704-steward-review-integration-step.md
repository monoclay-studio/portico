# Agent run: Steward review: integration step

- Started: 2026-11-07T17:04:43.667Z · last activity: 2026-11-07T17:24:23.306Z
- Turns: 281 · tool uses: 152 · output tokens: 237,187
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

