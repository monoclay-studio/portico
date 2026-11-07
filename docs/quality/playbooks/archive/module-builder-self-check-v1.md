# Module builder self-check — playbook v1 (archived)

**Status:** archived. Superseded by `../module-builder-self-check.md` (v2).
**What it is:** the checks a builder runs before saying "done". v1 has two sources, and each item says which:

- **[B] Briefs actually used.** These are the "quality bar" and "must pass before you finish" lines in
  `docs/orchestration/module-agent-playbook.md` (§ Quality bar), plus the gate lines in the fix-round messages of
  2026-11-07 16:15. Examples are the identity and backoffice fix rounds in `docs/chronicle/agents/20261107T0738-*` and
  `…T0732-wave1-backoffice-*`: "`pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force` …
  check the exit codes".
- **[R] Derived from round-1 reviews.** Each item names the defect class that the first ten steward reviews found in
  "done, tests green" branches (`docs/chronicle/04-turning-points-and-lessons.md` § "What independent review
  caught"), with the finding ids.

v1 was never handed to builders as a single document. It is reconstructed here as the baseline that v2 changes.

---

## 1. Gates [B]

1. `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm turbo run typecheck --force`,
   `pnpm --filter @portico/<module> test` and `pnpm --filter @portico/api test`. Each must pass.
2. Read the exit code of every gate. Never trust output piped through `tail`/`grep`.
3. Before declaring done in a fix round, run `git merge main` and resolve. Then run the gates again on the merged tree.
4. Format with `npx biome check --write modules/<module>`. Never run Biome on `*.md`.

## 2. Isolation and authorization [B][R]

5. Every tenant-owned table has `tenant_id`, `core.enable_tenant_isolation`, and a test that proves another
   organization cannot read or modify a record by id. [B]
6. **Check the scope of the record, not only the scope the caller declares.** Every referenced folio, booking, profile,
   item or task must belong to the property (and legal entity) the caller is authorized for. [R: payments P0-1,
   guests G-P1-1/G-P1-3, integration F12]
7. **Every route and every exported service function checks a permission**, including secondary endpoints such as
   sync, snapshot, export and "internal" helpers. [R: operations P0-2 `/sync/mutations`; guests `snapshotProfile`
   (P2)]
8. Every permission you check is registered in your manifest (`apps/api/test/permission-catalog.test.ts`).
   [R/L1: escape E-014]

## 3. Concurrency [B][R]

9. **Lock, then read, then decide.** Every "check what is left, then write" (remaining refundable, remaining
   correctable, hold status, ledger quantities) runs after the row lock. [R: inventory INV-01/02/05, finance F-01/F-02,
   payments P1-1]
10. Business keys are enforced by unique constraints, not in memory. [B; R: payments P1-3]
11. Concurrency-critical paths have truly concurrent tests: two transactions, with the second proven to wait. [B]

## 4. Idempotency, events and external effects [B][R]

12. The dedupe marker commits in the **same** transaction as the effect it guards. [R: payments P0-3]
13. Consumers that derive state ignore stale events (`aggregateVersion` plus `isNewerThan`), and producers set
    `aggregateVersion`. [R: operations P1-1/P1-2; integration F5]
14. External effects (keys, provider calls, IdP calls) happen after commit, never inside the transaction. [R:
    reservations R-09; identity P2-2]
15. An uncertain outcome is shown as `pending_verification`, never as "cancelled" or "nothing was sent". [R: integration
    F4; backoffice P1-2; payments P1-7]

## 5. Money [B][R]

16. Agreed terms are used for posting and commit. Change the configuration after booking and prove the price does not
    move. [R: rates R-01; reservations R-04]
17. Test the boundaries: ±1 minor unit, zero, 100 %, above 100 %, negative. [R: reservations R-01; rates R-06/R-07]
18. Limits count adjustments, and re-applying a configuration preserves usage. [R: payments P1-4; finance F-04]

## 6. Contracts [B][R]

19. The provider functions you expose match `docs/architecture/domain-map.md`. Any deviation is listed under
    "Contract changes". [B]
20. **Prove compatibility against the real consumer or provider types.** Use a compile-time test against verbatim copies
    of the other side's port, as finance did in `test/compat/`. [R: rates R-03, finance F-07/F-08, operations P1-3,
    guests G-P1-4, reservations R-02/R-03/R-10…R-14]
21. **Fakes are strict.** They check permissions, are asynchronous where the real provider is two-phase, return the
    real refusal codes, and model composites. [R: reservations R-11/R-14]
22. Producers export their event payload schemas, and consumers parse events with them. [R: reservations R-12;
    inventory `range` vs `cells`]
23. Saving a configuration is refused if using it would fail. [R: finance F-03]

## 7. Data authority and environment safety [B][R]

24. `platform.assertWritable` runs before **every** write in a governed domain, and before any external effect.
    [R: inventory INV-03; reservations R-07/R-08]
25. Simulators and dev paths are refused in live organizations. The recorded mode of an operation is re-checked when it
    executes. [R: integration F8; backoffice P2-9; payments P1-11]

## 8. Security and privacy [R]

26. External identifiers (provider account ids, issuers, domains) are globally unique and ownership is proven.
    [payments P0-2; identity P0-2b]
27. Trust attributes come from the server, never from the request body: channel, booking date, initiator, status.
    [rates R-04; payments P1-8, P0-2]
28. Outbound HTTP uses the SSRF-safe client. [integration F1; identity P2-2]
29. Erasure leaves no personal data: scan every table in your schema, plus the outbox, audit and idempotency records,
    for planted values. [guests G-P0-1; integration F18]
30. No secrets or credential links in responses, idempotency records or audit. [identity P0-1, P2-7]

## 9. Honest claims [B][R]

31. Every README claim (capability, invariant, scenario, readiness) points to a test whose assertion proves it.
    [R: guests G-P1-6; backoffice P2-17; integration F10; identity S17]
32. Readiness is at most R3 for internal work and R1/R2 for anything external. [B]
