# Wave 1 module-agent playbook (shared by all wave-1 agents)

You are one of nine engineers building Portico's first wave of modules **in parallel**, each in its own git
worktree. An orchestrator merges your branch after an independent architecture review. Work autonomously:
never stop to ask questions — decide using the docs, record genuine owner questions in your module README.

## Setup
1. `cd` into YOUR worktree (given in your task). Run `pnpm install` there first.
2. Postgres 16 is already running at `postgres://postgres@127.0.0.1:5432/postgres`. Export
   `PORTICO_TEST_DB_PREFIX=<your prefix>` (given in your task) for every test run so your test databases never
   collide with other agents'. Never drop databases you did not create.
3. Do not start anything listening on ports other than the ones given to you.

## Read before coding (in your worktree)
- `CLAUDE.md` (all of it — architecture rules, finance principles, security, definition of done, git rules)
- `docs/product/vision.md`, `docs/product/glossary.md` (use ONLY these terms), `docs/product/decisions.md`
- The three owner briefs in `docs/product/` (at least the sections relevant to your module)
- `docs/architecture/overview.md` (the module recipe!), `docs/architecture/domain-map.md` (contracts),
  `docs/adr/*.md`
- Your module spec: `/home/user/wt/product/docs/specs/<module>.md` — written IN PARALLEL by the product agent in
  another worktree. Read it if it exists; re-check it before you finish and reconcile. If it conflicts with
  `domain-map.md`, follow domain-map for cross-module contracts and the spec for in-module behavior; note
  conflicts in your README.
- Relevant research: `docs/research/0*.md` (competitor patterns; cite what you adopt).
- Reference implementations: `modules/platform`, `modules/identity`, `packages/db/test/core.test.ts`,
  `apps/api/test/api.test.ts`.

## Boundaries
- Write only inside `modules/<your-module>/` (or `packages/ui` + `apps/backoffice` for the UI agent), plus the
  minimal wiring for your module in `apps/api/src/composition.ts` and `apps/api/package.json`, plus new
  tests under `apps/api/test/<module>*.test.ts` if you add HTTP end-to-end tests.
- Do NOT modify `packages/kernel`, `packages/db`, `packages/http`, `packages/testing`, other modules, CLAUDE.md
  or docs outside your module. If you need a foundation change, write it up in
  `modules/<module>/FOUNDATION_REQUESTS.md` (problem, proposed diff) and work around it locally.
- Cross-module needs go through `src/ports.ts` interfaces per `docs/architecture/domain-map.md`. In
  `composition.ts`, bind ports to real providers that exist on main (platform, identity). For providers that are
  other wave-1 modules (being built right now), bind `unavailable('<module>')`-style stubs that throw a clear
  error, and say so in your README; the orchestrator binds them at merge. Your own tests use fakes.
- Implement the PROVIDER functions other modules expect from you exactly as listed in domain-map.md (names,
  shapes). If you must change one, document it under "Contract changes" in your README.

## Quality bar (production, not demo)
- Every table: tenant_id + `core.enable_tenant_isolation`, `version` on mutable aggregates, business-identity
  unique constraints, append-only where financial/history, grants. Migration file(s) under `migrations/`.
- Every service: `requirePermission` (register permissions in your manifest), `platform.assertWritable` for
  authority-governed domains where you write, audit for consequential changes, events via `tx.emit`.
- Every HTTP mutation: Zod contract, `Idempotency-Key` for creates/money, `If-Match` for updates of versioned
  aggregates, ETag on reads, problem+json errors that explain the problem AND the recovery.
- Pure domain logic in `src/domain/` with thorough unit tests (edge cases: boundaries, rounding, time zones,
  concurrency invariants).
- Integration tests on a real database (`createTestDatabase` + `testContext`) proving invariants, permissions
  (a user lacking permission or property scope is refused), tenant isolation (another org cannot read/modify by
  id), idempotency, and the operational proof scenarios your module participates in. Name scenario tests
  `test/scenario-sNN-<slug>.test.ts`.
- Environment safety: any adapter with an external effect calls `assertExternalEffectAllowed`.
- No `any`, no default exports, no floats for money, no `new Date()` in domain code (use `tx.now`/clock).
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/<module> test` and `pnpm --filter @portico/api test`
  must pass before you finish. Run `npx biome check --write modules/<module>` to format (never run Biome on
  `*.md` files — they are excluded; do not change that).

## Git
- Commit early and often on your branch with Conventional Commits (`feat(<module>): …`), each message ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
  ```
- Never push. Never rebase or touch other branches. `git -c commit.gpgsign=false commit …` if signing prompts.

## Deliverables
1. The module (migrations, domain, services, routes, manifest, ports, events, contracts) + tests.
2. `modules/<module>/README.md`: purpose; capabilities implemented (MUST/SHOULD from spec) with status;
   invariants and which test proves each; scenarios covered (test file → what it demonstrates); permissions;
   events emitted/consumed; ports required and binding status; contract changes; adoption modes (standalone?
   connected-mode behavior? data-authority domains); known gaps; open questions for the owner; readiness level
   per capability using CLAUDE.md §7 (most things you finish are R3 "implemented and tested internally";
   anything external is at most R1/R2 — never claim more).
3. Final reply to the orchestrator (≈300 words): what is built, test counts, scenarios proven, contract changes,
   foundation requests, ports needing binding, risks. Be factual; do not overstate.
