# Portico — engineering operating manual

**Portico** is a cloud hospitality management platform built by **Monoclay LLC** (Delaware). It must support everything from a 6-room guesthouse to a 400-villa resort and
multi-brand hotel groups, with the operational depth of OPERA Cloud and the clarity of the best modern systems.
First market: **Maldives / Indian Ocean**. No hotel has agreed to a pilot yet.

Read this file fully before changing anything. Then read **`docs/product/vision.md`** — the single picture of the
outcome (truthful operations, depth without weight, adoption as a ramp, honest readiness). When a decision is
unclear, choose the option that best serves the vision. The owner briefs are the top-level requirements:

- `docs/product/brief.md` — product, behavior and UX standard (incl. the 20 operational proof scenarios).
- `docs/product/operational-readiness-brief.md` — external dependencies, approvals, payments responsibility,
  compliance, costs, reliability, migration, launch gates. The owner calls these *recommendations applied with
  judgment*: preserve the outcomes, choose fitting implementations.
- `docs/product/adoption-integration-brief.md` — the final product ambition: the easiest platform to evaluate,
  integrate and adopt. Three adoption paths (connect alongside / replace selected capabilities / full migration),
  staged evaluation (demo → trial → read-only connection → pilot → production), integration & migration as
  core product capabilities with the same importance as reservations and finance.

Then read `docs/product/decisions.md`, `docs/product/glossary.md`, `docs/architecture/overview.md`,
`docs/architecture/domain-map.md` and the spec for the module you are touching (`docs/specs/<module>.md`).

---

## 1. Autonomy rule (applies to every Claude session and agent)

**Never stop working because you need an answer from the owner, as long as some other part of the work is unblocked.**

When a decision genuinely needs the owner (pricing, legal, commercial agreements, credentials, brand):

1. Append it to `docs/OPEN_QUESTIONS.md` using the template there: context, the question, the **default you
   are proceeding with**, what changes if the answer differs, and who/what is blocked.
2. Proceed with the default (choose the reversible, conservative option), or move on to unblocked work.
3. Never invent facts that only the owner or an external party can provide (credentials, contract terms,
   legal opinions, partner certification status). Leave a clearly marked placeholder instead.

Never activate paid contracts, live guest transactions, live hotel/channel connections, production keys,
government submissions or production data migrations without the owner's explicit authorization. Ordinary
development, research, documentation and safe (simulated / sandbox) testing never need permission.

Ordinary product and engineering details are **not** questions — decide them using this manual, the specs and
the research in `docs/research/`, and record significant decisions as ADRs in `docs/adr/`.

## 2. Repository map

```
apps/api            Composition root: HTTP server (Fastify) that mounts every module's routes
apps/worker         Background processes: outbox dispatcher, schedulers, webhook delivery
apps/backoffice     Staff web app (React SPA) — front desk, reservations, finance, admin
apps/staff          Mobile PWA for housekeeping / maintenance (offline-capable)        [later wave]
apps/guest          Guest-facing booking engine and guest portal                         [later wave]
packages/kernel     Pure shared primitives: ids, Money, dates, errors, context, events. No IO.
packages/db         Postgres access: pool, Kysely, tenant transactions (RLS), migrations, outbox,
                    idempotency, audit
packages/http       Shared Fastify plugins: auth context, problem+json errors, idempotency, ETags
packages/testing    Test harness: database lifecycle, test tenants, HTTP client, fixtures
packages/ui         Design system for all web apps                                       [wave 1]
modules/<name>      One bounded context per package (see docs/architecture/domain-map.md)
infra/terraform     AWS infrastructure as code
docs/               Product, architecture, ADRs, specs, research, scenarios, readiness
```

## 3. Commands

```bash
pnpm install                 # install (Node 22, pnpm 10)
pnpm db:up                   # ensure local Postgres is running (see tools/db-up.sh)
pnpm migrate                 # apply all module migrations to $DATABASE_URL
pnpm test                    # all tests (unit + integration against real Postgres)
pnpm --filter @portico/<pkg> test      # one package
pnpm typecheck               # tsc --noEmit across the workspace
pnpm lint                    # biome check
pnpm format                  # biome format --write
pnpm dev:api                 # run API on :4000
pnpm dev:backoffice          # run staff web app on :5173
```

Integration tests need `DATABASE_URL` pointing at a Postgres 16 server where the connecting role may create
databases (default `postgres://postgres@127.0.0.1:5432/postgres`). Each test run creates its own database
named from `PORTICO_TEST_DB_PREFIX` (agents: set a unique prefix so parallel runs never collide).

## 4. Architecture rules (non-negotiable)

1. **Modular monolith.** One deployable API and one worker, composed of modules with hard boundaries, so
   any module can be extracted into a service later without rewriting it.
2. **A module owns its tables** in its own Postgres schema (`inventory.*`, `finance.*`…). No module reads or
   writes another module's tables. Cross-module calls go through the other module's public `index.ts`
   service API, wired in the composition root, or through domain events.
3. **Ports and adapters.** A module that needs another module declares a *port* (TypeScript interface) in
   `src/ports.ts`. The composition root (`apps/api/src/composition.ts`) binds ports to real services.
   Tests bind ports to fakes. This is what lets modules be built in parallel.
4. **Tenant isolation is enforced twice**: application authorization *and* Postgres Row Level Security.
   Every tenant-owned table has `tenant_id uuid not null`, RLS enabled and forced, and the standard policy
   (see `packages/db/README.md`). All tenant data access goes through `withTenantTx(ctx, fn)`.
5. **One transaction per command.** A command (e.g. confirm booking) runs in a single DB transaction that
   may span modules (they receive the same `tx`). Side effects outside the DB (payments provider, email,
   channels) happen *after* commit via the outbox, or via an explicit two-phase pattern with idempotency keys.
6. **Transactional outbox** for every domain event (`ctx.events.emit(...)` inside the tx). Consumers are
   idempotent (dedupe by event id).
7. **Idempotency** for every mutating public endpoint (`Idempotency-Key` header, stored response replayed).
   Money-moving operations derive deterministic keys from business identity (e.g. `room-charge:{stayId}:{date}`)
   and enforce them with unique constraints, not only in memory.
8. **Optimistic concurrency.** Mutable aggregates carry `version int`. Reads return `ETag`; writes require
   `If-Match`; mismatches return `409 conflict` with the current version so the UI can show what changed.
9. **Audit everything consequential.** `ctx.audit(...)` records actor, action, target, before/after, reason.
   Audit rows are append-only (DB grants forbid update/delete).
10. **Contracts are Zod schemas** in `modules/<m>/src/contracts.ts` (no server imports there — the web apps
    import them). OpenAPI is generated from them. Public API is versioned under `/v1`.
11. **Pure domain logic** lives in `src/domain/` with no IO, and is unit-tested exhaustively.
12. **Environment safety (demo / trial / training / sandbox).** Every adapter that causes an external effect (card
    charges, guest messages, channel publication, government/fiscal submission, paid AI, production key issue)
    must call `assertExternalEffectAllowed(ctx, effect)` from `@portico/kernel` before acting. Non-live environments
    route effects to simulators/sandboxes or block them, and the UI labels results as *simulated* or *sandbox*.
13. **Tax rules and rates are data, never code constants.** Rules are effective-dated configuration with a
    source citation and verification date; historical calculations keep the rule version they used.
14. **Two Monoclay money worlds never mix.** Monoclay's SaaS billing (`billing` module, Monoclay's own Stripe
    account, tagged with the product code) is fully separate from hotel guest money (`finance`/`payments`,
    the hotel legal entity's own merchant account). No code path moves guest funds through Monoclay.
15. **Data authority (system of record).** For each property and data domain (`reservations`, `availability`,
    `rates`, `guestProfiles`, `charges`, `payments`, `roomStatus`, `maintenance`, `accounting`) exactly one system
    is authoritative: Portico or an external connection. Before writing in such a domain, call
    `platform.assertWritable(tx, propertyId, domain)`; when an external system is authoritative, either reject with
    a clear explanation or route the change through the integration (`write_mode = 'forward'`). Modules must work
    in **connected mode** (mirroring an external system of record) wherever the adoption brief offers them
    standalone — document each module's standalone dependencies in its spec.
16. **Provenance is visible.** Data shown to users carries its provenance: `live`, `simulated`, `copied` (trial),
    `delayed` (stale beyond SLA), `incomplete`, `external` (received from another system, with last-sync time).

## 5. Money, time and finance principles (non-negotiable)

- Money is integer **minor units** + ISO currency (`Money` in `@portico/kernel`). Never floats. Tax and
  proration math uses `Decimal` and rounds once, by the documented rule.
- Distinguish: **business date** (property's accounting day), **stay date** (night), **service date**,
  **occurred_at** (UTC timestamp), and **revenue date**. Never conflate them.
- Double-entry ledger is the source of truth for money; folios, balances and reports are projections of it.
- An authorization is not a payment. A deposit is a liability, not revenue. A payout is not a sale.
- Posted financial records are immutable. Corrections are new, linked reversing/adjusting entries.
- Retries must never duplicate charges, refunds, invoices or journal entries.
- Never show "paid"/"confirmed"/"synced" unless the authoritative system confirmed it. Uncertain outcomes are
  shown as **pending verification** and resolved by reconciliation.
- Agreed prices/terms are **snapshotted** at booking; later configuration changes never rewrite them.
- Portico never stores raw card numbers. Only PSP tokens.

## 6. Security baseline

- Least privilege everywhere; permission checks on every endpoint via `requirePermission(...)` with property
  scope. Deny by default.
- No secrets in code, tests, fixtures or logs. PII is never logged (use the logger redaction list).
- Sensitive identity documents are field-encrypted (envelope encryption, `packages/db/crypto`).
- Validate all input with Zod at the boundary. Parameterized SQL only (Kysely / `sql` tagged templates).
- Anything returning another tenant's data is a **P0 bug**; tests in `packages/testing` assert isolation.

## 7. Definition of done and readiness levels

A feature is **not** done because a screen exists. Done means: working behavior, persisted records, correct
permissions, error handling, audit trail, tests (unit + integration), and evidence from the relevant
operational scenarios in `docs/scenarios/`.

Every capability and integration's readiness is tracked in `docs/readiness/readiness-register.md` on the
owner's scale (operational-readiness brief §2):

| Level | Meaning |
|---|---|
| R1 | Planned |
| R2 | Demonstrated with sample data |
| R3 | Implemented and tested internally |
| R4 | Tested against the provider's sandbox (integrations only) |
| R5 | Submitted for required external approval |
| R6 | Approved for the specific production scope |
| R7 | Configured and validated for a particular hotel |
| R8 | Operating successfully in a controlled live pilot |
| R9 | Supported for wider production use |

Technical implementation and external approval are **separate columns**; one never implies the other. Staff
validation of a workflow (UX) is recorded separately from automated test coverage. Every claim cites evidence:
what was tested, where, when, by whom, result. A mock/simulator is never called a working integration; a
successful API call is never called certification; a provider's certification is never presented as ours.
No compliance badges, certifications or partner logos without evidence and permission.

## 8. Git workflow

- Trunk-based. `main` is always releasable. Work on short-lived branches: `feat/<module>-<topic>`,
  `fix/<module>-<topic>`, `docs/<topic>`, `chore/<topic>`.
- Conventional Commits (`feat(reservations): …`). Small, reviewable commits.
- Parallel agents work in separate git worktrees on their own branch; they commit locally and **do not push**.
  The orchestrating session reviews (with the architecture steward), merges and pushes.
- Before merging: `pnpm lint && pnpm typecheck && pnpm test` green; migrations applied from scratch.
- Migrations are append-only once merged to `main`. Never edit a merged migration; add a new one.

## 9. Coding conventions

- TypeScript strict, ESM, Node 22. No `any` (use `unknown` + narrowing). No default exports.
- Files `kebab-case.ts`; types `PascalCase`; functions `camelCase`; DB columns `snake_case`.
- IDs are UUIDv7 (`newId()`), generated in the application.
- Errors: throw `DomainError` subclasses with stable `code`s (see `@portico/kernel/errors`); the HTTP layer
  maps them to RFC 9457 problem+json. Error messages must explain the problem and the recovery.
- Every module exports a `ModuleDefinition` (see `packages/kernel/src/module.ts`).
- Tests: Vitest. Domain unit tests next to code (`*.test.ts`); integration tests in `test/`.
  Each integration test creates its own tenant via `createTestTenant()` — no shared mutable fixtures.

## 10. UX principles (for every screen)

Visual direction: `docs/product/design-direction.md` (simple, minimal, calm — **power before prettiness**).
Interaction rules: `docs/product/ux-principles.md`.


Current state, history, outstanding issues, owner and next actions visible on every important record.
Facts vs pending vs estimates vs suggestions vs external data are visually distinct. Failed actions never look
successful. Previews before consequential changes. Keyboard-first for desk staff, touch-first for mobile staff.
Progressive disclosure: a guesthouse never sees resort/enterprise complexity it did not enable.
