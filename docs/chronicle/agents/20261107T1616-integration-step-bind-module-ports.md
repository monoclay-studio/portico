# Agent run: Integration step: bind module ports

- Started: 2026-11-07T16:16:26.294Z · last activity: 2026-11-07T16:38:15.917Z
- Turns: 288 · tool uses: 179 · output tokens: 261,504
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

