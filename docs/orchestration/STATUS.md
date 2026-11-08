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

- **2026-11-07 12:36 UTC — PAUSE + CHECKPOINT (5-hour usage 92%; resets 16:10 UTC).** No agents were running.
  `tools/checkpoint.sh` committed WIP and pushed every branch (docs/parity-finance was behind its remote; its
  commits are already in main — nothing lost). UX lab servers may be gone after the pause: `tools/ux-lab.sh refresh`
  then `start`.
  **On main now:** guests, inventory, operations, rates, payments, reservations, integration, finance (all steward
  fixes verified, full suite green), market deep dive, UX round-1 findings, ADR-0017.
  **Resume queue (in order, after re-checking usage):**
  1. identity-plus (`feat/identity-platform-enterprise`, pushed): fix round DONE (both P0 closed, PoCs are regression
     tests). Before merge: (a) **second steward review** focused on ADR-0017 (the promised re-review);
     (b) adapt 13 tests in other modules to the new rules — inventory isolation-permissions ×3, finance
     security-and-corrections ×1, operations real-inventory R2 ×1 (data authority needs an authority transition);
     apps/api payments.test ×6 + integration.test ×1 (sign in with MFA: `signedInOrg`/`enrolMfa` in
     apps/api/test/helpers.ts); guests sharing.test ×1 (Professional plan now has `portfolio.crossPropertyProfiles`).
     Then merge; bind integration FR-2 (platform transitions); kernel `responsiblePerson`/`assertHumanApprover`
     (identity FR-6/platform FR-3); owner questions Q146–Q149 are on the branch.
  2. Integration step: bind ports for real (pending-fixes.md: finance↔rates tax, payments LedgerPort→finance,
     reservations `ratesPortFrom` + guests/finance/payments/operations, ADR-0015 port re-checks removed in inventory
     and payments) → scenario tests S01–S20.
  3. Backoffice fix round (`reviews/review-backoffice.md`, P0 cache leak first) — author agent resumable.
  4. UX refining agent on `docs/ux/round-1/blackbox-findings.md`.
  5. Gap strategist → `docs/strategy/` 10x briefs (input: `docs/research/05-digest.md`).
  6. Resume infra (`TRUSTED_PROXY_CIDRS`, `PORTICO_TERMS_SEAL_KEY`, worker DB role) and parity-ops.

- **2026-11-07 16:20 UTC — RESUMED** (5-hour window reset; seven-day 54%). Postgres restarted (`pnpm db:up`).
  Running: identity-plus second steward review (→ `reviews/review-identity-plus-2.md`); identity author adapting the
  13 cross-module tests; integration step on new branch `feat/integration-step` (wt/integration-step: bind all ports,
  then S01–S20); backoffice fix round (author); UX refining agent on new branch `docs/ux-round-1` (wt/ux-round-1).
  **Still queued:** gap strategist → `docs/strategy/`; infra + parity-ops resume. UX lab not restarted (only the
  tester needs it). Seven-day pacing rule added to `usage-guardrail.md`.

- **2026-11-07 17:10 UTC — next-wave plan.** The 10x briefs are on main (`docs/strategy/`). After
  integration-step and identity-plus merge, start module round 2 from each module's brief, in gap-plan order:
  1. "make it real": backoffice wired to real APIs + reservations front-desk flows (FD-01/FD-09/FD-06);
  2. payments collection plans + finance receipts (MIRA 3-day rule);
  3. day-close (new module);
  4. the remaining modules' first increments (including their parity-file corrections).

  Max 3–4 module agents at once while seven-day usage is ≥ 60%.
  **Q-number collision to resolve at merge:** identity-plus adds Q146–Q149, and integration-step also adds a Q146
  (late-charge auto card). Renumber integration-step's question to the next free number (≥ Q156) when merging.

- **2026-11-07 17:32 UTC — quality-driven queue additions** (`docs/quality/retros/2026-11-07-day1.md`):
  - (1) **P0/P1 fix re-attack sweep**: LAUNCHED 17:59 from steward playbook v2.1 → `reviews/review-fix-sweep.md`.
  - (2) Resume the quality steward after that batch: integration-step review, backoffice merge, identity review 3.
  - (3) Canaries C-L1-02 and C-L1-03 at the next merge batch (CPU only).

- **2026-11-07 17:31 UTC — OWNER-REQUESTED CHECKPOINT** (the owner is logging out and back in to refresh the
  usage display). Usage at 17:30: 5-hour 33%, seven-day 62%. Four agents were stopped mid-work, and
  `tools/checkpoint.sh` committed WIP, refreshed the chronicle and pushed every branch. The pending usage-check
  trigger was deleted. **The 3-hourly UX + quality heartbeat is still scheduled** (next 18:43 UTC).
  **Resume exactly these, in this order:**
  1. **Integration-step fix round** (`feat/integration-step`, wt/integration-step; WIP committed). Brief: the
     integration-step review P1-1 to P1-3 plus the P2s (`reviews/review-integration-step.md`, PoCs in
     `reviews/integration-step-poc/`), the self-check playbook, and scenario-tests v2. It had begun reading the
     check-in guarantee step for P1-2.
  2. **Identity fix round 4** (`feat/identity-platform-enterprise`, wt/identity-plus; clean tree, it had just
     started). Brief: `reviews/review-identity-plus-3.md` (R3-P1-1 wipe race with row lock and credential epoch;
     R3-P1-2 groups claim, jit_provisioning and client_id as root changes; R3-P2-1/2/3; P3s). Merge condition: the
     orchestrator spot-checks the W-1..W-3 regression tests.
  3. **Parity-ops** (`docs/parity-ops`; WIP committed; it was on the crm module). Remaining: crm, ai, and whatever
     is unfinished of comms, resort, access, guest-experience, identity and integration. Run from
     `docs/quality/playbooks/parity-researcher.md`.
  4. **Quality steward meta-loop round 1** (`docs/quality`; clean, it had just started). Inputs: the
     integration-step review, identity review 3, the backoffice merge verification, the orchestrator's process
     escapes, and a new `playbooks/orchestrator.md`.

  Then the queue: the P0 re-attack sweep, module round 2 from `docs/strategy/` briefs, and canaries C-L1-02/03.
  Agents can be resumed by message if the session keeps their transcripts; otherwise start new agents on the same
  branches from these briefs. Restart Postgres first if needed (`pnpm db:up`), and recreate the usage-check chain.

- **2026-11-07 18:58 UTC — quality round 2 queue** (`docs/quality/retros/2026-11-07-round2.md`):
  - (1) **UX round 2a (focused)**: the 8 refinements marked "Done", the new sign-in code step, and the C8/C11 language
    and permission-honesty rules. 3 personas + a new hire, from the latest blackbox-tester playbook. Launch when the
    5-hour usage is < 60% (or right after the reset). The full 34-task re-measure still waits for real-data wiring.
  - (2) **Parity evidence re-run** for `docs/parity/inventory.md` and `reservations.md` (still 1% tested on main):
    about 50k tokens, from parity playbook v2.
  - (3) Every fix-round brief names its invariants and requires the builder self-check v4 § 5 (invariant closure)
    table.

- **2026-11-07 19:09 UTC — owner: make Portico Channex-ready.** TOP of the next window, after the reset at 21:10:
  build the `distribution` module (spec `docs/specs/distribution.md` §3.2–3.3) with a **Channex adapter**:
  - an event-driven ARI engine with coalescing (no polling);
  - an outbox queue with a per-connection token bucket (20 ARI/min, configurable);
  - a webhook endpoint for booking revisions with a durable revision log, ordered per property, plus a recovery pull;
  - ack only after `reservations.ingestChannelBooking` commits;
  - mappings, last-acknowledged state, discrepancies and health.

  Build and test against an exact simulator of Channex's API (R3). Then run Channex **staging** tests (R4); this needs a
  free staging account and API key from the owner, requested via `request_credential` for the Channex staging host.
  Channex certification (R5–R6) is an external step. Production activation needs owner authorization (platform fee).

- **2026-11-07 19:29 UTC — window closing (5-hour 85%, no agents running, everything pushed).** NEXT WINDOW
  (resume scheduled 21:13 UTC), launch in this order, each from its latest playbook:
  1. **Distribution module + Channex adapter** (owner direction; `docs/specs/distribution.md` §3.2–3.3 with the Channex
     note): an event-driven ARI engine with coalescing, an outbox with a 20/min token bucket per connection, a
     booking-revision webhook with a durable log and a recovery pull, ack after commit, mappings, last-acked state,
     health. Simulator first (R3); Channex staging needs the owner's staging key (`request_credential`).
  2. **Integration-step focused re-review #3** (steward v2.1, re-review variant) of `feat/integration-step` @ db6ae8c,
     then merge if clean.
  3. **Infra security review** (steward v2.1) of `feat/infra-aws`, then merge.
  4. **UX round 2a** (focused; blackbox-tester playbook): the 8 "Done" refinements, the sign-in code step, C8/C11.
     Update the UX lab with the demo authenticator first.
  5. **Parity evidence re-run** for inventory and reservations.
  6. **Quality steward round 3** after items 2–4 report.
  7. **Module round 2 from the `docs/strategy/` briefs**, gap-plan order: backoffice wired to the real APIs plus
     reservations front-desk flows; payments collection plans plus finance receipts; day-close.
  8. **Partner platform and open API (owner D14: yes)**, gap-plan M15, right after the Channex build. The gap
     strategist re-scans for further additions after each wave (capability scouting, vision-fit test).

- **2026-11-07 22:55 UTC: window 3 state (5-hour 46%, seven-day 89%; the seven-day window resets 2026-11-11 17:00
  UTC).** Rule: at seven-day ≥ 85%, only critical-path finishing work runs. At ≥ 95%, CHECKPOINT and resume at 17:03
  UTC on 11-11 (`usage-guardrail.md`).
  - **Merged this window:** parity evidence re-run; UX round 2a docs; quality rounds 3; infra (`a6733ca`, R3 code /
    R1 AWS).
  - **Running:**
    - the integration-step fix round 4, from re-review #4: R4-P1-1 agreements name their bookings (ADR-0015
      Amendment 3); R4-P1-2 locked limits; the P2s and P3s; E-114 mutant; self-check v6;
    - the migration build (gap plan M8 increments 1–2, `feat/migration`, wt/migration).
  - **Built, waiting for steward review** (both pushed):
    - `feat/distribution-channex` @ a8bd950: R3 against the simulator; blocked on rates `termsFromChannelPrices`;
    - `feat/day-close` @ cb0fbf3: 22 mutants red; 17 contract requests.
  - **RESUME ORDER** (each from its latest playbook; every brief requires self-check v6):
    1. Integration-step: re-review #5 said merge after fixes (2 P1, the same consent class). Fix round 5 (ADR-0015
       Amendment 4) DONE at 333a83e (pushed). Re-review #6 (01:13) says merge after fixes: 2 P1 of the same class (a capture's
       purpose; refund postings with no provenance). No front-desk regressions. ADR-0015 Amendment 5 written. **ON RESUME: send
       fix round 6** (the pending-fixes line "integration-step fix round 6") to the integration-step author, with self-check v6
       plus the landing table. Then focused re-review #7, and merge if clean. Quality round 4 input:
       four rounds of "one step beyond" in consent; the builder grid lacked an input-source column.
    2. Steward reviews of distribution and day-close (in parallel). Then fix rounds, then merge.
    3. Steward review of migration (`feat/migration` @ 45be8b9, built 23:27: 95 module tests, gates green; MIG-CR-1 blocks real runs), in parallel with item 2.
    4. After integration-step merges:
       - the backoffice real-data round (the pending-fixes UX 2a lines);
       - payments collection plans with finance receipts (MIRA 3-day rule);
       - rates `termsFromChannelPrices`, which unblocks Channex ingestion;
       - wire the 2a SIM acceptance checks.
    5. Partner platform and open API (M15, D14).
    6. Quality steward round 4 after items 1–2 report. Then UX full round 2 (34 tasks) after the real-data round.
    7. Channex R4 staging tests once the owner provides a staging key (`request_credential`, staging host only).

- **2026-11-08 00:58 UTC: seven-day 94%.** The resume task is already scheduled for **2026-11-11 17:03 UTC** (scheduled
  task "Resume Portico after weekly reset"). Plan:
  - At 95%: `tools/checkpoint.sh`.
  - At 97%: stop re-review #6 and commit its partial report as WIP.
  - The resume order is the 22:55 entry above, with item 1 updated: re-review #6 is running on `333a83e`.

- **2026-11-08 01:11 UTC — PAUSED for the weekly reset (seven-day ≈ 95%).**
  - `tools/checkpoint.sh` pushed every branch. The one exception is `ux/lab`: a disposable lab branch whose remote
    diverged. It is not force-pushed; `tools/ux-lab.sh refresh` rebuilds it.
  - No agents are running.
  - The usage-check task and the 3-hour UX heartbeat are **disabled**, so they spend nothing while paused. Re-enable
    both on resume: the heartbeat is "Portico continuous UX loop heartbeat"; the usage-check chain is "Usage guardrail
    check", restarted with a new time.
  - The resume task fires at **2026-11-11 17:03 UTC**.
  - **First action on resume:** send integration-step fix round 6 (pending-fixes line; ADR-0015 Amendment 5). In
    parallel, the steward reviews of distribution, day-close and migration.

- **2026-11-08 05:05 UTC — RESUMED on the owner's direction ("let's keep going").**
  - Integration-step fix round 6 was sent to the integration-step author (lean, a commit after every step).
  - The usage-check chain was re-enabled (each check pushes `feat/integration-step`; `checkpoint.sh` at 97%; stop at 99%).
  - The UX heartbeat stays disabled.
  - If the weekly allowance runs out, the 2026-11-11 17:03 resume task continues from this log.

- **2026-11-08 05:2x UTC — extra (overage) usage in use** (seven-day 100%, overage allowed until 12-01; owner told).
  - Running:
    - integration-step fix round 6 (P1/P2 fixes pushed at 4822639);
    - steward reviews of distribution, day-close and migration (reports in `docs/orchestration/reviews/review-{distribution,day-close,migration}.md`, written incrementally).
  - Next:
    - re-review #7 after fix round 6;
    - fix rounds for the three modules after their reviews;
    - then the STATUS 22:55 order item 4 onward.

- **2026-11-08 05:4x UTC — OWNER DIRECTION:** "let's do this current wave of tasks you are on right now. feel free to
  introduce anything new to finish it. don't add any more on extra usage. finish when done until wednesday reset".
  - **Scope on extra usage:** integration-step (re-review #7 → fix if needed → merge); distribution, day-close and
    migration (reviews running → fix rounds → focused re-checks → merge). Anything required to finish them is allowed.
  - **Not before the Wednesday reset (2026-11-11 17:00 UTC):** new modules, UX rounds, the quality steward round 4,
    M15, and the backoffice real-data round.
  - **When the wave is done:** `tools/checkpoint.sh`, disable the usage-check chain, and leave the 17:03 Wednesday
    resume task to continue the order above.
  - **Owner, 05:4x:** "don't let it effect your current work though. AT ALL". The scope limit never reduces the rigor
    of this wave: full reviews, full fix rounds with self-check v6, re-reviews until clean, and the full merge procedure.

- **2026-11-08 07:0x UTC — STOPPED: extra-usage budget almost spent (owner: "$14 left").** All agents were stopped
  and `tools/checkpoint.sh` committed WIP and pushed every active branch. (Push failures on `docs/parity-finance` and
  `ux/lab` are old merged or disposable branches.) **RESUME (Wednesday 2026-11-11 17:03 UTC task):** resume each agent
  with "your WIP was committed and pushed as a checkpoint; build on top of it, never amend it", in this order:
  1. integration-step fix round 7, mid-way: the model-based money test exists; it was adding refund consistency and
     concurrent-order alternatives;
  2. distribution fix round 1, mid-way: 3 mutants M6, M7 and M10 survived its new ordering tests and need tightening;
  3. migration fix round 1, mid-way: cutover.ts service changes were next;
  4. the day-close focused re-review, stopped early: relaunch it from the same brief
     (`reviews/review-day-close-2.md` may be partial).

  Then focused re-reviews of integration-step (#8), distribution and migration, then merges. Then the 22:55 order item
  4 onward.

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
| `feat/finance-core` | wt/finance | ledger, folios, billing rules, AR, invoices, cashier | **MERGED** to main — 2 P0 + review items fixed; ports to rates/payments still stubbed; F-10 receipts not built | integration step: bind tax→rates, payments LedgerPort→`financeLedgerForPayments`, collection→payments (update apps/api/test/payments.test.ts) |
| `feat/payments-core` | wt/payments | payments (simulator, Stripe Connect, Route D) | **MERGED** to main (872e45b) — 3 P0 + P1s fixed; folio collections refused until finance binds `LedgerPort`; parity gate open (28 P0 rows, mostly unbuilt: collection plans, hosted card entry, PCI proxy, forwarding) | finance binds LedgerPort at its merge |
| `feat/operations-core` | wt/operations | housekeeping, maintenance, tasks, offline sync | **MERGED** to main (9296305) — both P0 + most P1 fixed; P1-5/6/8 deferred with reasons (README) | — |
| `feat/integration-core` | wt/integration | connector framework, setup, health, webhooks | **MERGED** to main (4d90c6a) — P0 SSRF fixed (`safeFetch`), F2–F9 fixed | bind platform transitions after identity-plus merges (FR-2) |
| `feat/backoffice-core` | wt/backoffice | packages/ui + apps/backoffice | **MERGED** to main (40a832c) — P0 cache leak + all P1 fixed; Playwright 11/11 incl. axe (WCAG 2.2 AA, light+dark); UX round-1 decisions recorded | next round: wire to real APIs (after integration-step merges) + UX shell items (NAV-01/02/09, phone bottom bar) |
| `feat/identity-platform-enterprise` | wt/identity-plus | MFA, SSO, SCIM, custom roles, break-glass, trials, activation | **MERGED** to main (18:36 UTC, e5d07c6) after 3 reviews + 4 fix rounds + spot-check | follow-ups: users page offers 'Initial password' (refused now); no in-app step-up/security settings page; SSO callback route in staff app; UX lab needs demo authenticator secret |
| `feat/infra-aws` | wt/infra | Terraform, Dockerfiles, CI deploy, runbooks, DB roles | **done, NOTHING deployed** (pushed): 17/17 terraform tests, 38/38 role checks, 27/27 deploy-script tests; costs lean ≈ $121, resilient ≈ $407–538, demo ≈ $15–20 | **steward security review queued (next window)** → merge; owner choices Q158 |
| `feat/integration-step` | wt/integration-step | bind every port for real; ADR-0015; S01–S20 | fix round 2 **done** (db6ae8c, pushed): invariants (a)–(f) closed with pre-fix-failing tests; (e) on payments' own routes open (payer directory) | **focused re-review #3 queued for next window** → merge |
| `docs/parity-ops` | wt/parity-ops | parity: 10 ops-cluster modules | **MERGED** to main (03ec772) — all matrices done; every `tested` row quotes its asserting test; no module passes the gate yet (open P0 rows) | decisions recorded (Q157, pending-fixes); foundation P0 items queued |
| journey, back-of-house, parity-front, parity-finance, readiness, product, adoption docs | — | docs | **MERGED** to main | spec change requests folded in at integration step |
| market deep dive → gap strategist | wt/market, wt/strategy | research + 10x briefs | **MERGED** (`docs/research/05-*`, `docs/strategy/`: gap plan + 32 module briefs; Q140–Q145, Q150–Q155) | module round 2 from briefs |
| UX loop round 1 | wt/ux-round-1 | tester → refiner | **refinements MERGED** (`docs/ux/round-1/`: 83 refinements, C1–C12) → backoffice (22 shell items, next round), integration step (API surface for 44 wiring items), module owners record decisions | round 2 after modules are bound to the UI |

Branch briefs: `docs/orchestration/module-agent-playbook.md` (shared module rules), `workstream-briefs.md`
(per-workstream scope + every follow-up instruction sent), `steward-review-brief.md`, `parity-researcher-brief.md`.
Steward reports, when written, go to `docs/orchestration/reviews/review-<module>.md`.

## 5. Merge procedure (per module branch)

**Two gates:** a module **merges** when its steward review has no open P0/P1 and all checks are green; it is only
called **complete** when it also passes the parity gate (`pnpm parity --gate <module>`). Merging partial modules is
expected — the readiness register and README state exactly what is and isn't built.
Pending cross-module fixes awaiting the next round for each author: `docs/orchestration/pending-fixes.md`.


1. Branch reports done → launch steward review strictly from the launch brief in `docs/quality/playbooks/steward-reviewer.md`
   (latest), quoting the builder's claims verbatim → report in
   `docs/orchestration/reviews/`; its PoC and probe files are saved as `reviews/<module>-poc/*.ts.txt` next to it.
2. Every cross-module note in the review becomes a `pending-fixes.md` entry with an owner before the fix round
   starts. Every P0 **and P1** fix needs the builder's re-attack table (self-check §3), an audit of every exemption the fix
   leaves (early returns, "first X is accepted"), and a targeted re-check that attacks the fix itself on the merged copy.
   Send P0/P1 (and cheap P2) findings back to the module author (resume the same agent if available, else a new
   agent on the same branch with the playbook + findings) → fix → re-run checks.
3. In the worktree: `git merge --no-edit main`, resolve, `pnpm lint && pnpm typecheck && pnpm test`.
4. On main: `git merge --no-ff feat/<m>-core`; regenerate `docs/parity/COVERAGE.md` and queue the parity owner to update
   the merged module's rows; update `docs/architecture/domain-map.md` with the module's
   "Contract changes"; register its demo seed in `apps/api/src/seed/demo.ts` `DEMO_SEED_STEPS`, its search
   provider and jobs in `composition.ts`; bind ports provided by already-merged modules; update role templates
   (`modules/identity/src/domain/role-templates.ts`) with the module's permissions; update
   `docs/readiness/readiness-register.md`.
5. Run full checks on main (`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`);
   for UI branches also run Playwright on the merged copy with non-default `PORTICO_E2E_WEB_PORT`/`API_PORT`. Commit by
   exact paths only (`tools/commit-checked.sh`). Push.
6. Chronicle: append the merge to `docs/chronicle/01-timeline.md`; refresh with `tools/chronicle/extract.py` +
   `snapshot.py` (pass the test log); commit `docs(chronicle): …`.
7. Quality meta loop: after every steward review / fix round / scenario run / UX round, resume the quality steward
   (retro, scorecard, escapes, playbook versions); launch future checkers from `docs/quality/playbooks/` (latest).
8. After any merge batch that contains fixes for 3 or more modules, run a fix re-attack sweep from steward v2.1.
9. **UI unreviewed** (quality round 3, until orchestrator v5): a fix round that adds a user-facing surface (route, key
   binding, switcher, dialog) is listed below as UI unreviewed, and that surface enters the next UX round's scope.
10. **Every build and fix brief requires builder self-check v6** (`docs/quality/playbooks/module-builder-self-check.md`):
   § 5 with the v5 steps (state machine, external holders, pasted searches, control-fact grid, key fields and
   recommendation lines, concurrency column, the § 5.4 mutation table for P0/P1 fixes) and § 6 (claim ledger), tables
   included. Running builders (day-close, distribution, migration) apply it at their first fix round.

**UI unreviewed (enters the next UX round):** identity-plus `g s` property switcher and sign-in code step (re-tested
in 2a, findings open); help and learning content once HLP-01 lands.
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

**History safety:** never force-push. Reconcile a diverged branch with a normal merge, or `git merge -s ours` when the
remote-only commit is a superseded checkpoint.


1. `cd /home/user/portico && git fetch origin && git pull` (or clone fresh). If worktrees are gone, recreate:
   `git worktree add /home/user/wt/<name> <branch>` for each branch in §4 (fetch them from origin first).
2. `pnpm install && pnpm db:up && pnpm lint && pnpm typecheck && pnpm test`.
3. For each branch in §4: read its README "Checkpoint" section, `git log`, and run its tests.
4. If the original agents are still reachable, resume them with a short message; otherwise launch new agents per
   workstream with the playbook + `workstream-briefs.md` entry + "continue from the README Checkpoint section".
5. Continue the merge procedure (§5) and the task list (§6). Keep the owner updated briefly.
