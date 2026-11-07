# Timeline

All times UTC. Day 1 is Saturday 2026-11-07. Owner messages are quoted verbatim in `03-owner-directions.md`.
Each agent's brief and report are in `agents/`.

## Day 1 — Saturday 2026-11-07

### Phase 0 — Kickoff, research and the shape of the company (06:40–07:32)

- **06:40 — The first message.** The owner asks for "an entire hospitality management system like opera by oracle".
  - It should research Mews, Cloudbeds and the rest of the market, be cloud-based and built in a systematic,
    large-enterprise way, and use GitHub with branches and parallel agents under an overseer.
  - It should **not stop for answers while other work is unblocked**.
  - Attached is a long product brief (about 20,000 characters) that becomes `docs/product/brief.md`. It includes the
    20 operational proof scenarios S01–S20.
- **06:41–06:42 — Four research agents launch in parallel** (the first fan-out):
  - enterprise PMS vendors (OPERA, Shiji, Agilysys, Infor);
  - modern cloud PMS vendors (Mews, Cloudbeds, Apaleo, Stayntouch);
  - SMB and distribution vendors (SiteMinder, RMS, RoomRaccoon, Guesty);
  - connectivity, payments and compliance.

  All four report back between 06:52 and 06:53, about 11 minutes each. Their output is `docs/research/01–04`.
- **06:47 and 06:54 — Two rounds of clarifying questions.** The owner answers:
  - The hotel is the merchant of record, via Stripe Connect (D2).
  - The Maldives / Indian Ocean is the first market (D3).
  - "Complete from the beginning", covering guesthouses to resorts to multi-property groups, with different pricing
    for small and large (D4).
  - The stack is engineering's choice: "extremely secure… easy migration… easy integration" (D5).
  - AWS (D6).
  - The repository: "i've made a rep named "portico"".
  - Connectivity hub first (D7).
  - No pilot yet (D8).
- **07:04 — Second brief: operational readiness.** The owner pastes it as "just recommendations… use your best
  judgement". It is saved verbatim for every agent as `docs/product/operational-readiness-brief.md`.
- **07:06 — First commit:** repository scaffold, owner briefs, glossary, domain map and the operating manual
  (`CLAUDE.md`).
- **07:07 — Two documentation agents launch:** operational readiness deliverables and product strategy (capability
  catalogue, editions, personas).
- **07:22 — Third brief: the final product ambition.** It becomes `docs/product/adoption-integration-brief.md`: be the
  easiest platform to evaluate, integrate and adopt, through three adoption paths and staged evaluation.
  - 07:25: an adoption and integration agent launches.
  - 07:25: the owner adds "make your own vision" → `docs/product/vision.md`.
- **07:25 — Foundation committed by the orchestrator:** kernel, db, http, testing, platform and identity modules, API
  and worker. ADRs 0001–0014 and the vision follow at 07:28.

### Phase 1 — Wave 1: nine modules in parallel (07:32–08:30)

- **07:32 — Wave 1 launches: nine module agents start in the same minute, each on its own branch and git worktree:**
  - inventory, rates and tax, guests, reservations;
  - finance, payments, operations, integration;
  - the staff web app and design system (backoffice).

  The AWS infrastructure agent follows at 07:33, and the identity/platform enterprise agent at 07:38.
  - At 07:32 the first documentation branch merges (operational readiness: 12 deliverables).
  - At 07:52–07:53 the adoption and product-strategy branches merge, bringing 18 module specs.
- **07:45 — Owner sets out the company and asks four things:**
  - Monoclay LLC (Delaware, Stripe Atlas) operates Portico (D10).
  - "read up on maldives tax rules, use the most recent guaranteed sources" → MIRA-sourced tax rules
    (`docs/readiness/maldives-tax-rules.md`).
  - "why does it cost that much for aws for just a raw software with no users yet" → cost tiers T0–T3.
  - Portico is the final name (D1); prices come later (D11).
- **07:50 — First external-fact correction.** The research found that the Maldives is **not** a Stripe-supported
  country. The plan adapts: payments become provider-agnostic, and in "Route D" the hotel's own terminal is recorded
  in Portico.
- **07:58–08:10 — The owner widens the scope:**
  - Key cards and the whole guest stay: "that's an important thing you missed… go through an entire guest stay".
    This becomes D12, whole-hotel scope. At 08:02 two auditors launch: guest-journey gap audit, and back-of-house
    specs (accounting, F&B POS, procurement, stock, workforce).
  - UI direction: Fin (Intercom) as a reference only. "we need to be powerful above everything else including
    "looking pretty"" → `docs/product/design-direction.md`.
  - One product with seamless module switching and an easy learning curve → the universal record contract, global
    search and record history (08:07).
  - "what's the check to make sure each module is extremely powerful…?" → the **parity gate**: competitive matrices
    and edge-case catalogues with a completion gate (08:11). At 08:12 three parity researchers launch.
  - "ask me again… shortly i don't know what this does and why you're asking" → a standing rule that every approval
    request comes with one line on what it does and why.
- **08:17–08:24 — The first steward reviews** (guests, inventory, rates) launch as builders finish.
- **08:26 — "5hour limit reaching… lose nothing."** At 08:28 a full checkpoint is committed: the status of every
  workstream, the briefs, and the merge and resume procedures.

**Pause: about 08:30 → 11:11 (2 h 41 min), 5-hour usage limit.**

### Phase 2 — Reviews, fixes and the first merges (11:11–12:36)

- **11:11 — Resume.** Postgres is restarted. Builders, reviews and docs audits resume. Infra and parity research are
  deferred to save usage.
- **11:13–11:33 — Steward reviews for payments, operations, reservations, integration, finance, identity-plus and
  the backoffice UI.** Every builder's "done" is checked by an independent reviewer that runs the code and writes
  attack tests in a scratch copy. Verdicts and finding counts are in `05-metrics.md`.
- **11:16–11:19:** the guest-journey audit merges (235 touchpoints, 5 new module specs), then the back-of-house specs.
- **11:27 — Owner: a market deep dive**, with an academic research prompt (`docs/orchestration/research-prompt.md`).
  It sets the operating model: "the main looks at the broader vision while the sub agents handling each module is in
  charge of making that model at least 3x to 10x more powerful". The market agent launches at 11:28.
- **11:30 — First module merged to main: guests.** Inventory follows at 11:38.
- **11:31 — Owner: "one button migration from any legacy or modern opera platform"** → D13.
- **11:38 — Owner: the UX refinement loop** — a tester with no context, then a refiner, then module owners, all
  overseen by the vision owner. At 11:41 the black-box tester launches against a running "UX lab".
- **11:42 — Owner: the loop must run "constantly"** → triggers, a 3-hourly heartbeat scheduled task, a scorecard and
  convergence rules.
- **11:44 — Owner: a usage guardrail** → pause and checkpoint at 92% of the 5-hour limit (`tools/checkpoint.sh`).
- **11:50–11:55 — Foundation security fixes from the identity review:**
  - client IPs are trusted only from the load balancer's addresses;
  - ADR-0017 (global identity and cross-organization safety);
  - kernel grants are unioned.
- **11:57 → 12:24 — Six module merges in 27 minutes, each verified first** (main merged into a copy, then lint,
  typecheck and the full suite):
  - operations 11:57, rates 12:07, payments 12:13, reservations 12:20, integration 12:23, finance 12:24;
  - the market deep dive merges at 12:03.
- **12:17 — First black-box UX findings.** The tester could not create a booking, check a guest out or take payment:
  the modules were not yet wired to the UI. It did praise the arrival readiness view, the extend-stay preview and
  the honest payment states.
- **12:35 — Usage reaches 92%.** No agents are running. The checkpoint pushes every branch, the resume queue is
  written, and the resume is scheduled for 16:13.

**Pause: 12:36 → 16:14 (3 h 38 min). The 5-hour window hit 100% at 13:40 from work that was still finishing.**

### Phase 3 — Second reviews and making it one product (16:14– )

- **16:14 — Automatic resume** from the scheduled task. Postgres restarted. Seven-day usage: 54%.
- **16:15–16:16 — Launched together:**
  - the second steward review of identity-plus;
  - the identity engineer adapts 13 tests in other modules to the stricter security rules;
  - the integration step (bind every module port for real, then S01–S20);
  - the backoffice fix round;
  - the UX refining agent for round 1.
- **16:20 — A seven-day usage pacing rule is added** alongside the 5-hour guardrail.
- **16:34 — Owner asks for this chronicle**, "so I can keep it for posterity and use as case study, success story,
  origin story". The chronicle is reconstructed from the session transcript, git history and agent transcripts.
- **16:42 — Second identity review (in progress) says "do not merge" again.** Every attack from the first review is
  closed. But a new P0 takeover path exists: any organization can create a brand-new global identity, with a
  password it chooses, for an email address it does not own.
- **16:42 — Gap strategist launches** on branch `docs/strategy`: 10x briefs per module and a platform gap plan.
  Usage: 5-hour 12%, seven-day 57%. The seven-day allowance is now the binding constraint, at about 6–7 points per
  hour with 6 agents running.
- **16:43 — Second identity review complete: do not merge.** P0 1 · P1 3 · P2 6 · P3 9 new.
  - All 11 original attacks are refused.
  - The new P0 is account pre-hijacking: any org could create a global identity with its own password for someone
    else's email, then accept that person's later invitation to a real hotel, and even become the only admin of a
    newly provisioned live organization.
  - **16:43 — ADR-0017 Amendment 1:** email-verified identities, no organization ever sets a password, first
    verification wipes earlier credentials, onboarding cannot be blocked, SSO configuration is a root change. Fix
    round 3 is sent to the identity engineer.
- **16:43 — UX refining agent, round 1, delivered 83 refinements:** 44 wiring, 6 missing capability, 33 design;
  23 blockers.
  - Also delivered: cross-module consistency rules C1–C12 and new-user metrics with baselines. The tester completed
    5 of 34 tasks; the right action was found for 0 of 17 action words.
  - The agent's summary file was refused by a harness policy on report files. The orchestrator committed it verbatim.
    Merged to main at 16:46.
- **16:44 — Build-cache root cause fixed:** `turbo.json` now hashes every workspace package's sources.
- **16:52 — Owner: "a very very intelligent self improving system with many feedback loops"**, with an agent in
  charge of the testing agents.
  - The quality system is designed (`docs/quality/README.md`): eight loops L1–L8, a meta loop with escape analysis,
    canary defects to measure recall, versioned playbooks and a pattern library.
  - 16:54: the quality steward launches (round 0: playbooks v1/v2 from today's real briefs, escapes, patterns, canaries,
    scorecard, retro).
  - The 3-hourly heartbeat now also resumes the quality steward after every checking round.
- **17:04 — Integration step done** (branch `feat/integration-step`; 331 tool uses, about 48 minutes).
  - Every stubbed port between reservations, rates, finance, payments, guests, operations and inventory is bound to
    its real provider.
  - ADR-0015 is applied: providers refuse foreign-property records instead of re-checking the caller's permissions,
    using a new kernel `delegateAtProperty`.
  - 12 of the 20 proof scenarios pass end to end with global consistency checks; the rest are todo with the missing
    capability named.
  - Five contract bugs were found only by binding for real. The worst: every booking deposit failed to post when the
    Maldives tax rules were installed, because Green Tax needs occupancy and the deposit has none.
  - 17:04: an independent steward review launches before merge, because authorization moved across module
    boundaries.
- **17:08 — Identity fix round 3 done:** ADR-0017 Amendment 1 is implemented (no org ever sets a password; first
  email verification wipes earlier credentials). All 9 new and all 11 original attacks are refused; identity has
  135 tests. A short third review launches.
- **17:09 — Gap strategist done:** `docs/strategy/gap-plan.md` (14 platform moves; "make it real" first) and 32 module
  10x briefs, each with targets and the next 3 increments. Owner questions Q150–Q155 are added. Merged to main.
  - It also flagged measurement problems: stale parity coverage, parity files under-reporting tested rows, and a
    requirement-prefix collision. The orchestrator fixed the coverage and the collision (`ACS-R` for access).
- **17:22 — Staff web app (backoffice) merged** after its fix round.
  - Shared-desk data leak fixed; drawer focus fixed; uncertain outcomes shown as "pending verification"; vocabularies
    aligned with the real module contracts; arrivals layout redesigned from the reviewer's prototype.
  - Bulk selection and list keys added; the data layer is swappable per domain; Departures and In house added.
  - Main bundle cut from 938 kB to 366 kB.
  - Verified on a merged copy: lint, forced typecheck, every package's tests (ui 87, backoffice 36) and the Playwright
    suite 11/11, including an axe scan with zero violations (WCAG 2.2 AA, every screen, drawer and palette open,
    light and dark).
  - All ten wave-1 code branches except identity-plus and the integration step are now on main.
- **17:27 — Quality steward round 0 done.**
  - 38 escapes traced (2 P0, 9 P1, 17 P2, 10 P3); L2 steward review is the largest source at 11.
  - v2 playbooks for 7 checkers; 51 attack patterns and 17 UX traps; a canary catalogue; a checker scorecard.
  - Top improvement: re-attack every fix before merge. The 14 P0 fixes already on main have never been re-attacked.
  - Merged; its 8 process edits applied 17:30, including the `apps/*` turbo inputs, verified by canary C-L1-01.
- **17:27 — Integration-step review: merge after fixes** (P0 0, P1 3, P2 7, P3 9). The P1s: a deposit can land on
  another property's books, check-in can hold any card for any amount, and late charges over-collect from a folio in
  credit. The fix round goes back to the integration engineer with the new self-check playbook.
- **17:35 — Third identity review: merge after fixes.** P0 0, P1 2, P2 3, P3 5. Every earlier attack is refused.
  The new P1s are a race that lets a pre-registered authenticator survive the first-verification wipe, and the SSO
  groups-claim name not being treated as a root change. Fix round 4 is sent. Merge condition: the W-1 to W-3
  regression tests, spot-checked by the orchestrator, with no fourth full review.
  - Pattern across the three identity reviews: P0 2 → 1 → 0, and each round's fix opened a narrower new class. This
    is the strongest evidence for the quality steward's "re-attack every fix" rule.
- **17:31 — Owner-requested checkpoint** before logging out and back in (the usage display wasn't updating). Four
  agents were stopped, all work was committed and pushed, and the resume order was written in STATUS.
- **17:38 — Resumed** after the owner's re-login (5-hour 41%, seven-day 64%). The four agents were resumed by message
  with their transcripts intact: integration-step fixes, identity fix round 4, parity-ops, and quality steward
  round 1.

