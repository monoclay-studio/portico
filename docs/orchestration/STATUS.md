# Orchestration status — checkpoint 2026-11-07

> **Resume here.** This is the orchestrator's complete working state so a new or resumed session continues
> exactly as if it never stopped. Read top to bottom, then follow "Resume procedure".

## 0. Resume log

> **Usage guardrail:** `docs/orchestration/usage-guardrail.md` — ≥80% start nothing new; ≥92% stop agents,
> `tools/checkpoint.sh`, update this log, schedule resume at reset. Continuous UX loop heartbeat: scheduled task
> "Portico continuous UX loop heartbeat" (every 3 h).


- 2026-11-07 ~08:30 UTC checkpoint (usage limit). All branches pushed.
- 2026-11-07 11:12 UTC resumed: Postgres restarted; all branches re-pushed; resumed module builders (reservations,
  finance, operations, integration, backoffice, identity-plus), steward reviews (guests, inventory, rates) and
  docs audits (journey, backofhouse); launched payments steward review. **Deferred to limit usage:** infra and the
  three parity researchers — resume them when the first builders finish (they keep their saved progress).

- 2026-11-07 ~12:30 UTC owner direction: operating model (orchestrator = vision; module agents own 3–10x superiority,
  `docs/orchestration/operating-model.md`); market deep dive launched with the owner's research prompt
  (`docs/orchestration/research-prompt.md`) on branch `docs/market-deep-dive` (wt/market) → `docs/research/05-*`.
  **Next after it finishes:** launch the gap strategist (reads 05-digest + all research + parity + specs + every
  module's actual code on main/branches) → `docs/strategy/gap-plan.md` + `docs/strategy/modules/<module>.md` 10x briefs;
  then hand each module agent its brief.

- 2026-11-07 ~13:30 UTC: guests + inventory MERGED to main (steward-reviewed, fixes verified). UX refinement loop
  started (`docs/ux/README.md`): UX lab worktree `wt/uxlab` (branch ux/lab = main + feat/backoffice-core; API :4300,
  UI :5380, DB portico_ux, demo seeded via `pnpm --filter @portico/backoffice seed:dev`); black-box tester round 1
  writes to the session scratchpad `ux-round1/`. **Next:** copy findings to `docs/ux/round-1/`, launch refining agent
  (reads findings + code + vision/design/experience docs + specs + parity + market digest) → per-module refinements →
  module agents decide/implement.

- 2026-11-07 12:05 UTC: usage 81% → nothing new started. **Queued for after the reset (16:10 UTC), in order:**
  (1) backoffice fix round from `reviews/review-backoffice.md` (P0-1 cache leak first; arrivals layout proposal in
  `reviews/backoffice/`); (2) gap strategist (brief in this log, 12:30 entry) → `docs/strategy/`; (3) refining agent
  for UX round 1 when the black-box tester finishes; (4) resume infra and parity-ops. Running at this time: fix rounds
  for rates, payments, reservations, integration, finance, identity-plus; black-box UX tester.

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
| `feat/guests-core` | wt/guests | guests module | **MERGED** to main | — |
| `feat/inventory-core` | wt/inventory | inventory | **MERGED** to main | — |
| `feat/rates-core` | wt/rates | rates + tax engine | **MERGED** to main (4aec0d5) — P0 + P1 fixed; parity gate not yet passed (13 P0 rows untested, mostly cross-module; README § Known gaps) | bind `affectedAgreements`, `channelForApiClient` at integration step |
| `feat/reservations-core` | wt/reservations | bookings/stays/front desk | **MERGED** to main (6c53c03) — P0 R-01 + P1s fixed; inventory bound for real; rates/guests/finance/payments/operations ports still stubbed (`module_not_available`) | integration step: `ratesPortFrom` adapter, channel-price terms in rates, `instantiatePaymentSchedule`, bind remaining ports, R-25 |
| `feat/finance-core` | wt/finance | ledger, folios, billing rules, AR, invoices, cashier | steward review: 2 P0 (concurrent corrections, credit notes); ADR-0016 → **fix round running** | merge after rates |
| `feat/payments-core` | wt/payments | payments (simulator, Stripe Connect, Route D) | **MERGED** to main (872e45b) — 3 P0 + P1s fixed; folio collections refused until finance binds `LedgerPort`; parity gate open (28 P0 rows, mostly unbuilt: collection plans, hosted card entry, PCI proxy, forwarding) | finance binds LedgerPort at its merge |
| `feat/operations-core` | wt/operations | housekeeping, maintenance, tasks, offline sync | **MERGED** to main (9296305) — both P0 + most P1 fixed; P1-5/6/8 deferred with reasons (README) | — |
| `feat/integration-core` | wt/integration | connector framework, setup, health, webhooks | steward review: P0 SSRF → **fix round running** | merge after rates |
| `feat/backoffice-core` | wt/backoffice | packages/ui + apps/backoffice | steward review: **merge after fixes** (P0 cached data leaks to next user on shared tab; 6 P1) — `reviews/review-backoffice.md` | **fix round queued for after usage reset** → verify → merge |
| `feat/identity-platform-enterprise` | wt/identity-plus | MFA, SSO, SCIM, custom roles, break-glass, trials, activation | steward review: **do not merge** (2 P0 cross-org takeover, 8 P1) → ADR-0017 → **fix round running** (sent 11:55Z) | second steward review → merge |
| `feat/infra-aws` | wt/infra | Terraform, Dockerfiles, runbooks | **paused** (usage) | resume when usage < 80%; set `TRUSTED_PROXY_CIDRS` (pending-fixes) |
| `docs/parity-ops` | wt/parity-ops | parity: operations, guests, comms, resort, access, guest-experience, crm, identity, integration, ai | **paused** (usage) | resume when usage < 80% |
| journey, back-of-house, parity-front, parity-finance, readiness, product, adoption docs | — | docs | **MERGED** to main | spec change requests folded in at integration step |
| market deep dive | wt/market | owner's research prompt + one-button migration | **MERGED** to main (`docs/research/05-*`; Q140–Q145) | **gap strategist queued for after usage reset** |
| UX loop round 1 | wt/uxlab | black-box tester (no build context) | **findings done** → `docs/ux/round-1/blackbox-findings.md` (top: nothing can be created; no checkout/money; simulated actions don't change state; 1024px overflow; raw technical text) | **refining agent queued for after usage reset** |

Branch briefs: `docs/orchestration/module-agent-playbook.md` (shared module rules), `workstream-briefs.md`
(per-workstream scope + every follow-up instruction sent), `steward-review-brief.md`, `parity-researcher-brief.md`.
Steward reports, when written, go to `docs/orchestration/reviews/review-<module>.md`.

## 5. Merge procedure (per module branch)

**Two gates:** a module **merges** when its steward review has no open P0/P1 and all checks are green; it is only
called **complete** when it also passes the parity gate (`pnpm parity --gate <module>`). Merging partial modules is
expected — the readiness register and README state exactly what is and isn't built.
Pending cross-module fixes awaiting the next round for each author: `docs/orchestration/pending-fixes.md`.


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
- DONE on main 739e671: client IP trusted only from `TRUSTED_PROXY_CIDRS` (identity-plus P1-7/P1-8 foundation part).
- DONE on main: kernel `staticAuthorizer` unions all matching grants (identity-plus review P2-10).
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
