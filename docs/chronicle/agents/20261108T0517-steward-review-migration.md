# Agent run: Steward review: migration

- Started: 2026-11-08T05:17:02.231Z · last activity: 2026-11-08T05:38:06.516Z
- Turns: 107 · tool uses: 112 · output tokens: 98,647
- Type: general-purpose

## Brief (2026-11-08T05:17:02.231Z)

````text
You are Portico's architecture steward, an independent senior reviewer. Run a full steward review of a newly built module. Read `docs/quality/playbooks/steward-reviewer.md` (v2.1) and follow its **Launch brief** exactly, with these run parameters:

```
MODULE:            migration ("Move to Portico", owner decision D13; increments 1–2: CSV/XLSX + SMB adapters, rehearsal, reconciliation, cutover, rollback)
BRANCH / COMMIT:   feat/migration @ 45be8b9 (record the commit you actually review; re-check findings if it moves)
WORKTREE:          /home/user/wt/migration (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-migration-copy (git worktree add --detach <copy> feat/migration; then merge current main into the copy)
SPEC / README:     modules/migration/README.md; modules/migration/FOUNDATION_REQUESTS.md; docs/strategy/modules/migration.md (10x brief); docs/research/05-market-deep-dive/11-one-button-migration.md; docs/product/decisions.md D13; docs/OPEN_QUESTIONS.md Q140–Q144, Q162
FOCUS AREAS:       see below
PARITY FILE:       docs/parity/migration.md (on the branch)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_migration
REPORT PATH:       docs/orchestration/reviews/review-migration.md; PoC files docs/orchestration/reviews/migration-poc/*.test.ts.txt
UI REVIEW?:        no
```

**The builder's report, verbatim**, is the last report in `docs/chronicle/agents/20261107T2200-build-migration-module-increments-1-2.md`. Quote its claims and verify each one. Draft your own attack plan from the code and the brief before reading its self-assessment.

**Focus areas:**
- **(a) Zero duplicate reservations and opening balances posted once.**
  - Attack the import ledger's unique key: source-key normalisation such as case, whitespace and leading zeros.
  - The same booking delivered by two adapters, or by a re-exported file with new row order.
  - Delta sync racing the post-capture sweep, a crash between the ledger insert and the owning module's write, and five racing importers.
- **(b) The production gate.**
  - Try to cut over with an open blocking exception, a stale rehearsal certificate, a changed plan, an expired or self-granted authorization, the same person as creator and approver, or a non-live environment.
  - Check that a refused gate changes nothing and is audited.
  - Check that the data-authority transition is second-person approved and reversible, and that rollback erases nothing.
- **(c) Reconciliation honesty.** The comparison must be against read-backs from the owning modules, not what migration sent. Check the 1-minor-unit differences, multi-currency, and that "every source record accounted for in exactly one state" really holds.
- **(d) Privacy and card safety.**
  - Any card number in any cell must refuse the whole upload: try PANs with spaces or dashes, Luhn-valid numbers in notes, XLSX shared strings, and formulas.
  - Masked-value detection.
  - The 30-day purge (Q162 default): does it really remove personal data from every staging table and file?
  - The guest data export.
  - PII in logs.
- **(e) File-parsing safety.** The XLSX reader has no dependency, so attack it: zip bombs, XML entity expansion, path traversal in zip entries, huge rows, CSV formula injection in exported reports, and encoding edge cases.
- **(f) Data authority (rule 15) and environment safety (rule 12).** The simulator must be refused in live organizations. Portico must be read-only before the switch.
- **(g) The builder's mutation proof.** Re-run 2 of its mutants and plant 1 of your own on the guard you judge riskiest. A survivor is a finding.
- **(h) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint` (`--error-on-warnings`), `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`.

**Writing the report:**
- Write it incrementally: create the file early and append each confirmed finding.
- Start it with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration.
- Give each finding an ID, file:line and a reproducing test.
- Commit nothing.
- Remove your scratch copy and `review_migration*` databases when done.

**Your final reply:** verdict, counts, top findings, mutant results and the file list.
````

