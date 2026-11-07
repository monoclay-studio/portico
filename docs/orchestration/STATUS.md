# Orchestration status — checkpoint 2026-11-07

> **Resume here.** This is the orchestrator's complete working state so a new or resumed session continues
> exactly as if it never stopped. Read top to bottom, then follow "Resume procedure".

## 0. Resume log

- 2026-11-07 ~08:30 UTC checkpoint (usage limit). All branches pushed.
- 2026-11-07 11:12 UTC resumed: Postgres restarted; all branches re-pushed; resumed module builders (reservations,
  finance, operations, integration, backoffice, identity-plus), steward reviews (guests, inventory, rates) and
  docs audits (journey, backofhouse); launched payments steward review. **Deferred to limit usage:** infra and the
  three parity researchers — resume them when the first builders finish (they keep their saved progress).

## 1. Owner, product and how to work with the owner

- Owner: founder of **Monoclay LLC** (Delaware, Stripe Atlas), based in the Maldives. Product: **Portico** (final name).
- Owner's requirements: `docs/product/brief.md`, `operational-readiness-brief.md`, `adoption-integration-brief.md`
  (all verbatim), synthesized in `docs/product/vision.md`. Decisions D1–D12 in `docs/product/decisions.md`.
- Later owner directions (all recorded in repo):
  - Whole-hotel scope incl. keys, guest journey end to end, accounting, F&B POS, procurement, stock, workforce (D12).
  - UI reference = Intercom Fin dashboard *qualities only*; **power before prettiness** → `docs/product/design-direction.md`.
  - Modules must feel like one product, easy to learn, more powerful than OPERA; courses/videos later on the website
    → `docs/product/experience-architecture.md` (universal record contract, global search, help anchors).
  - Nothing competitors do may be missing → `docs/parity/README.md` (parity matrices + edge cases + gate).
  - Maldives tax from official sources → `docs/readiness/maldives-tax-rules.md` (MIRA-sourced).
  - AWS cost concern → `docs/readiness/cost-model.md` §4a (T0 $0 local … T3 resilient).
- **Communication preferences:** short, plain-English updates; when asking for an approval (environment/network
  changes etc.) give a one-line "what it does and why" — the owner said they didn't understand an earlier prompt.
- Autonomy: never stop for answers when other work is unblocked; owner questions go to `docs/OPEN_QUESTIONS.md`
  (Q1–Q64 + agents' ranges Q80–Q149) with defaults.

## 2. Environment

- Cloud environment **"portico"** (personal) — allowed hosts incl. MIRA, tourism.gov.mv, gazette, AGOC, MMA,
  Stripe, Channex, AWS pricing, Terraform registry, docs.oracle.com, docs.mews.com, help.mews.com, apaleo.dev,
  api.apaleo.com. Setup script runs `pnpm install` (unproven until a fresh session).
- Postgres 16 is local (no Docker daemon): `pnpm db:up` (tools/db-up.sh) starts it at 127.0.0.1:5432, trust auth.
- Terraform 1.9.8 binary was downloaded to `/home/user/tools/terraform` (re-download from releases.hashicorp.com if gone).
- MIRA's site blocks automated fetches (Cloudflare challenge). **Do not circumvent**; use web search restricted to
  `mira.gov.mv` (returns official page text) — this was approved practice.

## 3. What is on `main` (pushed)

Foundation (all tests green, ~55 tests): kernel (ids, Money, dates, errors, authorizer, environment safety incl.
`trial`, crypto, records contract), db (RLS tenant tx, migrations, outbox, idempotency w/ 30-day expiry, audit,
search provider, scheduled jobs), http (Fastify/Zod, problem+json, logging without query strings), testing harness,
platform (orgs, legal entities, properties, business date, policies + preview, plans, data authority), identity
(users/memberships, scoped roles, sessions, API clients, lockout), apps/api (composition root, provisioning, demo
seeder, global search `/v1/search`, `/v1/records/:type/:id/{summary,history}`), apps/worker (outbox + jobs), CI,
CodeQL, Dependabot, boundary guardrail (`pnpm lint`), parity report (`pnpm parity`).
Docs: research (4), vision, briefs, glossary, decisions, domain map (incl. planned modules), architecture
overview, ADR-0001…0014, readiness (12 deliverables + Maldives tax), adoption (12), product strategy
(competitive synthesis, editions, personas, UX principles), 18 module specs, scenario catalogue, design
direction, experience architecture, parity framework, this orchestration folder.

## 4. Workstreams (each on its own branch; all pushed to origin at this checkpoint)

| Branch | Worktree | Scope | State at checkpoint | Next step |
|---|---|---|---|---|
| `feat/guests-core` | wt/guests | guests module | **DONE** — 157 tests; S15/S04/S17 | Steward review (in progress) → fix findings → merge |
| `feat/inventory-core` | wt/inventory | inventory | **DONE** — 74 tests; S01/S03/S08 | Steward review (in progress; check composites & change-consumption) → merge |
| `feat/rates-core` | wt/rates | rates + tax engine | **DONE** — 105 tests; S19 pricing, terms immutability | Steward review (in progress) → merge |
| `feat/reservations-core` | wt/reservations | bookings/stays/front desk | building | finish; AccessPort as real key-lifecycle contract; record contract |
| `feat/finance-core` | wt/finance | ledger, folios, billing rules, AR, invoices, cashier | building | finish; Maldives invoice/tax-point rules |
| `feat/payments-core` | wt/payments | payments (simulator, Stripe Connect, recorded external-terminal "Route D") | **DONE** — 96 tests + 6 API; S05/S06/S20; ledger port = `unavailablePort('finance')` until finance merges (confirmed payments raise 'not yet on the bill' exceptions, idempotent backlog posts once bound) | Steward review → merge after finance; move `modules/payments/PARITY.md` → `docs/parity/payments.md`; add front-desk `payments.payment.read`; README owner questions → OPEN_QUESTIONS |
| `feat/operations-core` | wt/operations | housekeeping, maintenance, tasks, offline sync | building | finish |
| `feat/integration-core` | wt/integration | connector framework, 9-step setup, health, webhooks | building | finish; G-03/G-05 |
| `feat/backoffice-core` | wt/backoffice | packages/ui + apps/backoffice | building | design direction, record drawer, search/palette, learning layer, Today dashboard, screenshots |
| `feat/identity-platform-enterprise` | wt/identity-plus | MFA, SSO, SCIM, custom roles, support/break-glass access, owners, outlets, config bundles, rollout groups, trial lifecycle, activation stages | building | + data-authority fixes G-01/02/04/06/07, editions §7 + Connect plan, `getPropertyFacts` |
| `feat/infra-aws` | wt/infra | Terraform, Dockerfiles, runbooks | building | demo/lean/resilient tier variable; cost table |
| `docs/guest-journey-audit` | wt/journey | full guest-journey audit + specs (access, guest-experience, crm, contracting, guest-services) | writing | finish → merge |
| `docs/back-of-house-specs` | wt/backofhouse | accounting, fnb-pos, procurement, stock, workforce, concessions/utilities specs | writing | finish → merge |
| `docs/parity-front` | wt/parity-front | parity: inventory, rates, reservations, groups, distribution, platform | researching | finish → merge → gaps into specs |
| `docs/parity-finance` | wt/parity-finance | parity: finance, payments, day-close, accounting, fnb-pos, procurement, stock, analytics | researching | same |
| `docs/parity-ops` | wt/parity-ops | parity: operations, guests, comms, resort, access, guest-experience, crm, identity, integration, ai | researching | same |

Branch briefs: `docs/orchestration/module-agent-playbook.md` (shared module rules), `workstream-briefs.md`
(per-workstream scope + every follow-up instruction sent), `steward-review-brief.md`, `parity-researcher-brief.md`.
Steward reports, when written, go to `docs/orchestration/reviews/review-<module>.md`.

## 5. Merge procedure (per module branch)

1. Branch reports done → launch steward review (brief above) → report in `docs/orchestration/reviews/`.
2. Send P0/P1 (and cheap P2) findings back to the module author (resume the same agent if available, else a new
   agent on the same branch with the playbook + findings) → fix → re-run checks.
3. In the worktree: `git merge --no-edit main`, resolve, `pnpm lint && pnpm typecheck && pnpm test`.
4. On main: `git merge --no-ff feat/<m>-core`; update `docs/architecture/domain-map.md` with the module's
   "Contract changes"; register its demo seed in `apps/api/src/seed/demo.ts` `DEMO_SEED_STEPS`, its search
   provider and jobs in `composition.ts`; bind ports provided by already-merged modules; update role templates
   (`modules/identity/src/domain/role-templates.ts`) with the module's permissions; update
   `docs/readiness/readiness-register.md`.
5. Run full checks on main, push.
**Merge order:** guests, inventory, rates (independent) → operations, integration, finance → payments (needs
finance ledger port) → reservations (needs all) → identity-platform-enterprise → backoffice → infra → docs branches
any time (OPEN_QUESTIONS.md always conflicts at the end: keep both sides, sort by number).

## 6. After wave 1 merges (task list)

1. **Cross-module integration:** bind every port to real modules; executable scenario tests S01–S20 (+ E01–E15,
   A01–A07 from `docs/scenarios/README.md`) through real workflows in `apps/api/test/scenarios/`.
2. **Fold audits into specs:** journey + back-of-house gap registers and parity gap files → spec change requests →
   update specs; run `pnpm parity`.
3. **Wave 2:** day-close, distribution (channel manager core + OTA simulator + Channex adapter; uses integration
   framework), groups, comms (+ automation, sender register), analytics, migration toolkit (integration wave 2),
   access (keys), contracting (DMC/tour operator), guest-experience, staff PWA (apps/staff), guest booking engine.
4. **Wave 3/4:** accounting, fnb-pos, procurement, stock, crm, resort (meal plans, transfers, activities, spa),
   workforce, concessions/utilities, ai, billing (Monoclay SaaS).
5. Holistic "chief architect" review of coherence after each wave (terminology, duplication, UX consistency).

## 7. Open foundation follow-ups

- Platform `getPropertyFacts` (permission-free internal lookup) — assigned to identity-plus branch.
- Guests requests: production KMS cipher + separate hashing key; history endpoint vs cross-property sharing;
  role templates need guests permissions (do at merge).
- Domain map: fold in contract changes from guests, inventory, rates READMEs at merge.

## 8. Resume procedure

1. `cd /home/user/portico && git fetch origin && git pull` (or clone fresh). If worktrees are gone, recreate:
   `git worktree add /home/user/wt/<name> <branch>` for each branch in §4 (fetch them from origin first).
2. `pnpm install && pnpm db:up && pnpm lint && pnpm typecheck && pnpm test`.
3. For each branch in §4: read its README "Checkpoint" section, `git log`, and run its tests.
4. If the original agents are still reachable, resume them with a short message; otherwise launch new agents per
   workstream with the playbook + `workstream-briefs.md` entry + "continue from the README Checkpoint section".
5. Continue the merge procedure (§5) and the task list (§6). Keep the owner updated briefly.
