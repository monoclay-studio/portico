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
- **17:57 — Quality steward round 1 done:** 24 new escapes, 62 cumulative. Half of round 1's escapes came from
  *fixes*: residuals of fixes already on main, defects fix rounds introduced, and reviewers' own recommendations.
  - New: an orchestrator playbook (the orchestrator is now a measured loop, L-orch, with 8 escapes attributed),
    steward v2.1, builder self-check v3, and the first scripted canaries (5/7 held).
  - It caught a wrong pending-fix (`skip` is a call-site bug, not a vocabulary gap) and two orchestrator timestamps
    still estimated. Both were corrected.
- **17:59 — Fix re-attack sweep launched** over every merged P0 and money/security P1 fix, strictly from steward
  playbook v2.1. It is the first run that measures v2.
- **18:00 — Owner: "only check 5hour window on checks".** The seven-day pacing rule is retired; the guardrail checks
  and the heartbeat now read only the 5-hour window.
- **18:02 — Parity research for the operations cluster merged.**
  - Ten matrices: operations, guests, integration, identity, comms, resort, access, guest experience, CRM, AI.
  - All 179 `tested` rows quote their asserting test on main; 17 over-claimed rows were downgraded.
  - No module passes the gate yet.
  - Decisions: consent on profile merge goes to the owner as Q157 (default: the most restrictive wins). Room-move task
    split and out-of-order on an occupied unit were decided by the orchestrator.
  - A new P0 foundation gap: trial → live effect re-checks at execution, and cross-tenant uniqueness of external
    identifiers.
- **18:06 — Usage check (5-hour 57%):** infra resumes as a new agent on `feat/infra-aws` from its saved checkpoint and
  original brief. Deploy nothing.
- **18:07 — Integration-step fix round done.**
  - All 3 P1s, 7 P2s and 6 P3s are fixed; every PoC is now a regression test.
  - The builder corrected its own earlier overclaim and listed the remaining stubs.
  - It filled the re-attack table and declared its own gaps: no concurrent late-charge test, no cap-boundary test.
  - Under the new rule (re-attack P0/P1 fixes before merge), a focused re-review launches from steward playbook v2.1
    before merge.
- **18:15 — Fix re-attack sweep done** (from steward playbook v2.1; the first measured v2 run).
  - 56 original P0/P1 attacks re-run on main: 48 refused, 4 still succeed by a sibling path, 2 held only by
    detection or fail-closed, 2 not re-probed.
  - Residual P1s: payments ×3 (double collection via hold and capture; a card from a sister property; a
    client-chosen "guest present" field) and guests ×1 (PII survives erasure in stored idempotency responses).
  - Pattern: three of the four fixes guarded only the exact path the reviewer named. New self-check rule: one
    regression test per sibling entry point.
- **18:16 — Guests fix launched** (`fix/guests-erasure-idempotency`). The payments fix waits for the integration-step
  merge, because the two overlap. The rates, finance and backoffice P2s go to their next rounds.
- **18:29 — Integration-step focused re-review: merge after fixes.** All 9 original PoCs are refused, but attacking each
  fix found a new P1 one step beyond it (card guarantee by linking the cardholder; only one late charge collected; the
  opening-deposit import skips ownership). ADR-0015 Amendment 1 defines the agreed card guarantee (supplied by the
  cardholder, or a recorded mandate). Fix round 2 goes to the integration engineer, together with the payments
  residuals from the sweep (same code).
- **18:36 — Identity-plus MERGED to main** after 3 steward reviews, 4 fix rounds and the orchestrator's spot-check:
  - the W-1..W-3 regression tests assert refusal;
  - gates green on the merged copy (1,494 tests);
  - Playwright 12/12 on default ports, and 11/12 on non-default ports with one flaky 409-toast test that passed twice
    on rerun (logged for backoffice).
  - It includes the staff-app sign-in code step and the demo second factor (ADR-0017 Amendment 2).
- **18:37 — Guests erasure fix done** (replay plans store ids only; a redaction net; replays wait for an erasure). A
  focused re-review launches before merge.
- **18:43 — Heartbeat (5-hour 72%).**
  - UX round 2 is deliberately deferred: round 1 is in its module-owner stage, and the refiner's plan re-runs the 34
    tasks only once the UI uses real data. Re-testing simulated screens would waste a round.
  - Quality steward meta-loop round 2 starts on the fix sweep, the integration re-review, the identity merge, the
    parity-ops merge and the orchestrator's escapes.
- **18:52 — Guests erasure fix re-review: merge after fixes** <!-- t: agent-ab5e454c050d97666 @ 2026-11-07T18:52:45.371Z (Focused re-review: guests erasure fix) -->. P0 0, P1 0, P2 4, P3 5. The redaction net
  matched too broadly: erasing a guest with the address "Maldives" broke an unrelated stored response that contained
  the time zone "Indian/Maldives". Exact-identifier matching is required before merge; the race, scale and
  other-module copies are tracked.
- **18:57 — Quality steward round 2 done** <!-- t: agent-ae7e0c581d1429f84 @ 2026-11-07T18:57:16.308Z (Quality steward (meta loop) round 0) -->.
  - 23 new escapes; 74% are fix-related (7/38 → 12/24 → 17/23).
  - Steward v2.1 works: every re-review P1 came from a named v2.1 step.
  - The missing builder technique is **invariant closure**: state each fix as an invariant over stored data, then
    test every writer of its inputs, repeats and inverses, its own records, and its exemptions (builder self-check
    v4).
  - Recall was measured for the first time: payments about 0.94, guests about 0.80.
  - Orchestrator v3: times are derived by `tools/chronicle/when.py`; `verify-times.py` refuses typed times at commit.
  - A focused UX round 2a is due on the merged UI changes.
  - Merged 18:57 <!-- t: commit:e46c024 @ 2026-11-07T18:57:28Z -->.
- Correction (18:57): the first integration-step review reported at 17:26:51, not 17:27 <!-- t: agent-aef8923307daf19e5 @ 2026-11-07T17:26:51.854Z (Steward review: integration step) -->.
- **19:09 — Owner: make Portico Channex-ready** <!-- t: now @ 2026-11-07T19:09:42Z --> — ARI engine, outbox and queue within 20 ARI/min, a booking-revision
  webhook, and an acknowledgement flow. The distribution spec already covers all four. The build (distribution module +
  Channex adapter) is queued first for the next usage window.
- **19:09 — Guests erasure fix merged** <!-- t: commit:096a038 @ 2026-11-07T19:09:03Z -->. Exact-identifier redaction; every writer of a guest's data locks the
  profile first. The builder proved its tests with 14 mutations: each fix removed one at a time turns its test red.
  This is the first full use of invariant closure (self-check v4 § 5).
- **19:22 — Infrastructure-as-code done, nothing deployed** <!-- t: agent-a5fe5dfcc8ccf4f59 @ 2026-11-07T19:22:32.044Z (Infra-as-code (resume)) -->.
  - Results: 17/17 terraform tests with a mocked AWS provider; 38/38 database-role checks on SCRAM Postgres in the
    production runtime layout; 27/27 deploy-script tests against fake AWS.
  - Bugs caught before any deployment: an RDS master-user name that would have broken bootstrap; lean-tier egress that
    would have blocked Stripe, identity providers and webhooks; trusted proxies that needed CloudFront's ranges.
  - Costs from AWS list prices: lean ≈ $121/month, resilient ≈ $407–538/month.
  - Owner choices are recorded as Q158. A steward security review is queued before merge.
- **19:28 — Integration-step fix round 2 done** <!-- t: agent-a29fdf2e9c7d0e9dc @ 2026-11-07T19:28:21.798Z (Integration step: bind module ports) -->. Covers the 3 re-review P1s and the payments residuals from the
  sweep.
  - Invariants (a)–(f) were closed with every writer tested. The builder ran its new tests against the pre-fix
    commit: api 15/15, payments 22/24, finance 3/3 and reservations 4/5 failed there; every test that passed pre-fix
    covered a guard that already existed.
  - One invariant is declared not yet closed: "card owned by the payer" on payments' own routes, which needs a payer
    directory.
  - The focused re-review (re-check #3) is queued for the next window, because the 5-hour window is ≥ 80%.
- **19:29 — Window closing** <!-- t: now @ 2026-11-07T19:29:00Z -->. 5-hour usage is 85% and no agents are running; everything is pushed. The resume is
  scheduled for 21:13 UTC with the Channex/distribution build first.
- **19:35 — Owner decision D14** <!-- t: now @ 2026-11-07T19:35:24Z -->: "i don't care how long the whole project takes, as long as the final product
  is in its most powerful form". Yes to the partner platform and open API after Channex (gap-plan M15), and keep adding
  capabilities that aren't overkill. Standing capability scouting with a vision-fit test was added. M16 (legacy device
  interface) is gated on counsel (Q159).
- **21:16 — Resumed after the reset** <!-- t: now @ 2026-11-07T21:16:35Z --> (5-hour 1%; Postgres restarted after a machine restart). Launched together:
  - the **distribution module + Channex adapter** (owner direction);
  - the integration-step focused re-review #3;
  - the infra security review;
  - the parity evidence re-run for inventory and reservations;
  - **UX round 2a**, a focused black-box run from tester playbook v2 with stable finding IDs, on a lab rebuilt from
    main. A demo authenticator command (`tools/demo-authenticator.mjs`) stands in for the tester's phone app.
- **21:37 — Integration-step re-review #3: merge after fixes** <!-- t: agent-ab1275ea4fe3cfee6 @ 2026-11-07T21:37:42.248Z (Focused re-review #3: integration-step) --> (P1 2). Every earlier PoC is refused.
  - New P1s: a payment link for a departed guest outlives settlement and failure, and a superseded link stays payable
    at the provider. The cardholder's mandate scope was stored but not enforced.
  - **ADR-0015 Amendment 2:** staff permission never exceeds cardholder consent; payment links have external writers.
  - Fix round 3 is sent.
  - Day-close build launched (gap-plan M6) on `feat/day-close`.
- Note (21:38): money paths have needed 3 re-reviews. Each round closes the reported invariant and the next finds a
  writer outside it (the provider, settlement, payment failure). This is evidence for the quality steward that
  external systems must be listed as writers in invariant closure. <!-- t: now @ 2026-11-07T21:38:41Z -->
- **21:42 — Parity evidence re-run merged** <!-- t: commit:81b97ad @ 2026-11-07T21:42:31Z -->.
  - Inventory: 1% → 42% of capabilities tested, open P0 53 → 22. Reservations: 1% → 9%; P0 rows stay at 100,
    because many outcomes are decided by stubs until integration-step merges.
  - 49 edge cases were added by the failure-class sweep, and the inventory README's 13 over-claimed rows were
    corrected.
  - EC-INV-017 decided: lowering an allowance below sales is refused, with the affected cells listed.
- **21:49 — UX round 2a done** <!-- t: agent-a81ad3b20abc5995c @ 2026-11-07T21:49:12.661Z (Black-box UX tester, round 2a) -->. The first tester run on playbook v2: 74 cited files, all present, 0 duplicates.
  Praised: one-line blockers with owner and ETA, the Extend preview with Maldives taxes, and honest labelling.
  Friction is mostly simulated-data contradictions (housekeeping and front desk disagree) and dead-end actions. Two
  LIVE defects: a generic error on an empty required field, and the property switcher picking the wrong hotel. No
  refiner run: the LIVE findings go to backoffice, and the SIM findings become acceptance checks for the real-data
  round.
- **21:50 — Infra security review: merge after fixes** <!-- t: agent-a44b6c8e4ea2a81aa @ 2026-11-07T21:50:37.793Z (Steward security review: infra) --> (P1 3, P2 11, P3 12).
  - The deploy role was effectively cell-admin, with a trust policy pinned only by repository name, and the runbook
    claimed otherwise.
  - The lean-tier default contradicted Q158 (resolved: NAT and private tasks is the default).
  - The restore drill could silently never run.
  - Clean: XFF spoofing through the deployed chain, SECURITY DEFINER hygiene, secrets kept out of plans, read-only
    non-root images.
  - The fix round goes back to the infra engineer. The quality steward's round 3 starts on the whole batch.
- **22:00 — Migration module build launched** <!-- t: now @ 2026-11-07T22:00:37Z -->: gap-plan M8 increments 1–2, the guesthouse same-day path. CSV and
  SMB sources, a rehearsal in a trial org, reconciliation, freeze and cutover through data-authority transitions,
  rollback, and a guided checklist of the unavoidable human steps. Money-module rounds and the staff-app real-data
  wiring wait for the integration-step merge.
- **22:07 — Integration-step fix round 3 done** <!-- t: agent-a29fdf2e9c7d0e9dc @ 2026-11-07T22:07:37.353Z (Integration step: bind module ports) -->.
  - Consent is enforced on every money movement, and mandate amounts are running totals.
  - The payment request is rebuilt as a state machine with the provider as an external writer: deactivate first,
    then replace.
  - New tests on the pre-fix commit: r3 11/12 failed (the 12th is a lock probe that also passed pre-fix), lifecycle
    5/5 failed.
  - Focused re-review #4 launched.

- **22:21 — Usage check: 5-hour window 36%, seven-day 86%** <!-- t: trigger:4f98af2a @ 2026-11-07T22:21:20.575Z -->. Per the owner, pacing follows the 5-hour
  window, but the seven-day allowance is a hard stop that would leave work half-finished. Decision: launch nothing
  new while seven-day is ≥ 85%. The five running items finish. A data-safety checkpoint runs at seven-day ≥ 95%.
- **22:25 — Quality steward round 3 reported** <!-- t: agent-ae7e0c581d1429f84 @ 2026-11-07T22:25:27.857Z (Quality steward (meta loop) round 0) -->; merged to main as `6d18714` <!-- t: commit:6d18714 @ 2026-11-07T22:25:46Z -->.
  - Builder self-check v5 and v6 were published together. v5 covers external writers, the full lifecycle state
    machine and a mutation proof for every P0/P1 fix. v6 adds a claim ledger: every capability statement points to
    the test or code that makes it true.
  - Orchestrator v4: recorded defaults must cite the code that implements them, every finding gets a disposition,
    and chronicle times come from the event, not the moment of writing. Refiner v2.1 adds a triage-only variant.
  - 32 new escapes (117 in total). One was the orchestrator's own: Q158's recorded default disagreed with the code.
    A canary showed that payments' collection lock has no test that fails without it.
  - The cost recount found that the extractor counted multi-block API messages more than once.
- **22:30 — Orchestrator applied round 3's exact edits** <!-- t: now @ 2026-11-07T22:30:05Z -->.
  - The extractor counts each API message once, and the agent records were refreshed (55 runs, 72 reports).
  - `when.py owner` and `when.py trigger` were installed, and `verify-times.py` now refuses `now` on owner
    and resume entries.
  - UX round 2a: all 49 findings routed, checked by `tools/quality/dispositions.py`.
  - Lint now treats warnings as errors.
  - The question template has an "Implemented by" line.
  - Every build and fix brief requires self-check v6. It was sent to the running infra fix round together with the
    restore-drill state machine and the CI infra job.
- **22:33 — Distribution + Channex adapter build done** <!-- t: agent-a7e54633dbf24e059 @ 2026-11-07T22:33:51.080Z (Build distribution + Channex adapter) -->; readiness R3 against a Channex simulator, never the real Channex. Branch `feat/distribution-channex` was pushed.
  - All four owner requirements work end to end:
    - **ARI engine:** an event-driven record of changed nights, with no table polling.
    - **Queue:** a sliding-window budget of 10 + 10 requests per minute, so never more than 20 in any 60 s; 429 pauses
      the budget; 50 edits became 1 call.
    - **Webhook:** each revision is stored unchangeable before the 200 is returned; orphans are parked; a 15-minute
      pull recovers missed deliveries.
    - **Acknowledgement:** only after a committed final outcome, enforced by a database check.
  - 91 module tests and 3 API tests. Each guard was disabled in turn to prove its test fails.
  - The channel/OTA coverage gate rose from 0% to 31% of rows.
  - Blocker: rates cannot yet price a channel booking (`termsFromChannelPrices`), so real bookings are stored but not
    acknowledged. This went to rates.
  - Channex facts that could not be verified from its docs (blocked to automated fetches) are listed for the R4
    staging test, which needs the owner's staging key.
  - Next: steward review, subject to the usage rule.
- **22:37 — Integration-step re-review #4: merge after fixes** <!-- t: agent-acec0dc12726b7ec8 @ 2026-11-07T22:37:10.903Z (Focused re-review #4: integration-step) --> (P0 0 · P1 2 · P2 2 · P3 6).
  - Every r3 attack, re-run inverted, is now refused. The state-machine brief closed the payment-request exits.
  - Two P1s remain:
    - Staff could still put a guest's saved card within reach of another booking by editing who is on it. Review 3's
      suggested "payer directory" fix had not asked who edits that directory.
    - Parallel charges beat an agreement's spending limit: 5 × USD 100 against a USD 100 cap.
  - The orchestrator decided ADR-0015 Amendment 3: an agreement covers only the bookings it names, and limits are
    locked. Q160 asks whether to offer a future-stays mandate (default: no).
- **22:38 — Usage 41% of 5 h, 88% of the week; fix round 4 sent** <!-- t: now @ 2026-11-07T22:38:28Z -->. The rule was narrowed: at seven-day ≥ 85%
  only critical-path finishing work runs (fix rounds, merges). New modules and new reviews, including distribution's,
  wait. The round includes self-check v6 and the E-114 collection-lock mutant.
- **22:49 — Infra security fix round done** <!-- t: agent-a5fe5dfcc8ccf4f59 @ 2026-11-07T22:49:37.670Z (Infra-as-code (resume)) -->: all 3 P1 and 11 P2 fixed, plus 8 of 12 P3; the infra agent ran under self-check v6.
  - The deploy role can no longer reach guest-money keys, pass roles or run tasks. Its trust matches one exact OIDC
    subject: repository id, owner id, environment, `main` and the workflow file.
  - NAT is the lean default.
  - The restore drill pages when it fails, cannot start or never runs (missing data counts as breaching).
  - 24 of 25 mutants were red; the one survivor was a redundant branch.
  - Four new pre-production decisions became Q161. Lean cost rose to ≈ $163/month with NAT.
- **22:52 — Infra merged to main** <!-- t: commit:a6733ca @ 2026-11-07T22:52:33Z -->; nothing deployed.
  - The orchestrator spot-checked instead of launching a re-review (seven-day usage ≥ 85%).
  - The P1 tests passed: ci-deploy-role 6/6, restore-drill 3/3 and cell 21/21, run with the agent's Terraform 1.16.
    The container's own Terraform 1.9.8 is too old for `>= 1.11`.
  - Two orchestrator mutants were both red: alarm missing data set to notBreaching, and PassRole added to the deploy
    role.
  - Readiness: infrastructure as code R3; AWS R1.
- **22:52 — Day Close build done** <!-- t: agent-a6c837ce590a0c220 @ 2026-11-07T22:52:40.658Z (Build day-close module) -->; branch `feat/day-close` was pushed.
  - Nine steps run from one Start. Nobody is logged out: there is no global lock, and a bar posting during the close
    lands correctly.
  - The interruption proof:
    - S09 crashes after 67 of 112 stays; resume posts exactly the 45 remaining, each attempted once.
    - A real `kill -9` lands mid-item and once inside the advance.
    - A chaos run of 24 crash points over 24 dates leaves no ledger key twice.
  - 87 module tests and 2 HTTP tests. The § 5.4 mutation table has 22 guards, all red.
  - P0 parity rows still open: 57 → 11.
  - 17 contract requests went to the other modules. The steward review waits for the usage rule.
- **23:27 — Migration module ("Move to Portico") increments 1–2 built** <!-- t: agent-ac5ae1ef01ad9bd99 @ 2026-11-07T23:27:11.349Z (Build migration module (increments 1–2)) -->; branch `feat/migration` pushed, every gate green.
  - **Decision:** a new module (`modules/migration`), not part of integration. It writes into every data-owning
    module, so it uses integration only through ports.
  - **Proven in tests:**
    - The same-day guesthouse path: rehearse in a trial org, reconcile twice, second-person authorization and switch,
      cutover, rollback window.
    - Zero duplicate reservations, guarded by a database unique key per source key and tested with five racing
      importers, crash resume and delta sync.
    - A card number in any cell refuses the whole upload.
  - 95 module tests and 3 HTTP tests.
  - **Limits:**
    - Reservations has no migration import yet (MIG-CR-1), so a real run stops honestly at that step.
    - The vendor export layouts (Little Hotelier, Cloudbeds, eZee) are unverified.
    - The parity gate fails on 3 P0 rows that need the real contracts.
  - The agent's open questions became Q162 (source-data retention, default 30 days; Monoclay co-sign).
  - The steward review waits for the usage rule.
