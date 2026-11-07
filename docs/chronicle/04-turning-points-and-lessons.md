# Turning points and lessons

Append-only. Each entry has the date, what happened, why it mattered, and the evidence.

## Decisions that shaped the product

| When (UTC) | Decision | Why it mattered | Evidence |
|---|---|---|---|
| 11-07 06:47 | **The hotel is the merchant of record**; Monoclay never moves guest money (D2) | Keeps Monoclay out of money transmission. Rule 14 separates the two money worlds | `docs/product/decisions.md`, ADR-0007 |
| 11-07 06:47 | **Complete from day one**, from a 6-room guesthouse to a 400-villa resort and multi-brand groups (D4) | Forced plan-based packaging and progressive disclosure rather than separate products | `docs/product/editions.md` |
| 11-07 06:47 | **Engineering picks the stack**: TypeScript modular monolith, Postgres RLS, Fastify/Zod, React (D5) | One language end to end; modules can be extracted later; isolation is enforced twice | ADR-0001…0003 |
| 11-07 07:50 | **Stripe does not support the Maldives** (verified) → provider-agnostic payments plus "Route D", the hotel's own terminal recorded in Portico | The first time research overturned a plan the owner had chosen. The architecture absorbed it without rework | `docs/readiness/`, Q2 |
| 11-07 07:58 | **Whole-hotel scope** (D12): keys, the full guest journey, accounting, F&B POS, procurement, stock, workforce | The owner caught a gap ("an important thing you missed"). The audit found 235 guest-journey touchpoints and 5 new module specs | `docs/journey/`, `docs/backofhouse/` |
| 11-07 08:03 | **"Power before prettiness"**, with Fin as a reference only | Set the design direction: calm and minimal, but power first | `docs/product/design-direction.md` |
| 11-07 08:08 | **The parity gate**: nothing a competitor does may be missed | A module is "complete" only when every P0 capability and edge case is tested | `docs/parity/README.md`, `tools/parity-report.mjs` |
| 11-07 11:27 | **Operating model**: the orchestrator owns the vision; module agents own being 3x–10x better than the market | Ownership moved from "build to spec" to "beat the market" | `docs/orchestration/operating-model.md` |
| 11-07 11:31 | **One-button migration** from legacy and modern OPERA (D13) | Migration became a headline capability. Research found no vendor sells this today | `docs/research/05-market-deep-dive/11-one-button-migration.md` |
| 11-07 11:38–11:42 | **A continuous UX loop** with a zero-context tester | UX quality is now measured from a newcomer's point of view, not the builder's | `docs/ux/` |
| 11-07 11:44 | **Usage guardrail** at 92% of the 5-hour limit, with a scheduled resume | Long autonomous runs survive usage limits without losing work | `docs/orchestration/usage-guardrail.md` |
| 11-07 11:52 | **ADR-0017: credentials belong to the person**, not to an organization | Closed a class of cross-organization account-takeover bugs at the design level, not with patches | `docs/adr/0017-…md` |

## What independent review caught (the case for a steward)

Every module builder reported "done, tests green". Every one of 10 independent reviews still found real defects. Most
were proven by attack tests that **passed** against the builder's own code. Examples:
- **guests:** cross-tenant or cross-property data exposure paths. Verdict: do not merge.
- **inventory:** releasing expired holds was double-counted, so a hotel could oversell with no conflict record.
- **rates:** the service charge was recomputed from current configuration, so the agreed price changed after booking.
- **payments:** a desk at property A could post a payment onto property B's bill; a Stripe account could be claimed
  by id; a failed webhook was lost forever.
- **operations:** a stale offline phone could overwrite newer changes; the sync endpoint had no permission gate.
- **reservations:** a 1-cent difference in a channel's price dropped every tax from the booking.
- **integration:** server-side request forgery to internal addresses, including cloud metadata.
- **finance:** concurrent corrections and credit notes could over-correct.
- **identity-plus:** an admin of a free trial could take over a member of another organization's live hotel by
  resetting their global password, or strip their MFA. Verdict: do not merge.
- **backoffice UI:** after a session expired, the next user on a shared desk tab saw the previous user's data.

Totals: 17 P0 and 94 P1 across the 10 first reviews (`05-metrics.md`). All P0s were fixed before merge, each with a
regression test made from the reviewer's attack.

## Process lessons

- **Parallelism needs a single composition root.** Nine builders worked at the same time against fakes. Merging was
  mostly conflict-free except in `apps/api/src/composition.ts`, where every merge conflicted: additive conflicts,
  resolved by keeping both sides.
- **Verify on a merged copy, never on the branch alone.** Several "green" branches failed after merging main. Causes
  included a duplicate import, an error code drift (`module_unavailable` vs `module_not_available`), a missing enum
  value, and lockfile drift.
- **Build caches can lie.** Turbo served a cached typecheck that hid a real type error twice; it was caught both times.
  Since then, verification runs `--force`. Root cause, found by the second identity review: `turbo.json` gave `typecheck`
  and `test` no dependency on other workspace packages, so a change in `kernel` did not invalidate `api`'s cached
  result. The `^transit` pattern failed on a `db` ↔ `testing` dependency cycle. The fix (2026-11-07 16:44) makes both
  tasks hash every package's sources (`$TURBO_ROOT$` inputs). It was verified: a kernel edit turns `api`'s cache hit
  into a miss.
- **Pipe output hides failures.** One commit went in while lint was failing because the output was piped through
  `tail`. Since then, exit codes are checked before every commit. It happened twice more on 2026-11-07 (a formatting
  slip and generated JSON). A git pre-commit hook was considered but declined by the session's safety policy (a
  persistent hook runs on every future commit). Instead the orchestrator commits to main through
  `tools/commit-checked.sh`, which commits only when lint passes.
- **Tests that pass alone can time out in parallel.** The demo-seed test needed a larger budget under 10 parallel
  packages on 4 CPUs.
- **Usage limits are a planning input.** The first two 5-hour windows were exhausted by about 9 concurrent agents. A
  seven-day pacing rule was added on resume.
- **Shared tooling has false positives.** The module-boundary checker read `${input.operations.length}` inside a SQL
  template as a reference to the `operations` schema. It was fixed centrally.
- **Do not circumvent bot checks.** MIRA's site blocks automated fetches. Research used official pages through
  restricted web search instead.

- **The orchestrator commits only explicit paths.** Two commits (`1179c98`, `012652e`) used broad `git add docs/…`
  paths and swept a running reviewer's unfinished report and PoC files into main. From 17:30, commits name exact
  files. A running reviewer's files are committed only as explicitly labelled WIP, and again when it reports.
- **The first canary ran at 17:30 (C-L1-01).** A planted signature change in `apps/api` was caught by the worker's
  typecheck once `apps/*` joined the turbo inputs, closing escape E-038.

## Corrections

- 2026-11-07 17:25: several timeline entries written between 16:45 and 17:22 carried estimated times that were 10–60
  minutes late, including some ahead of the actual clock. They were corrected from commit timestamps and the session
  log. Lesson: chronicle times come from `date -u`, commit times or the transcript, never from estimates.

