# Gap strategist — playbook v1 (archived)

**Status:** archived. Superseded by `../gap-strategist.md` (v2).
**Source:** the brief actually used for the first run, verbatim. The run started at 16:45 UTC on 2026-11-07, after the
chronicle's last extraction, so the brief is taken from the orchestrator's agent transcript (agent `afed514ccb8eaf8bb`,
first user message, 2026-11-07T16:42:54.033Z). Unchanged.
**Used by:** gap strategist run 1 (still running at round 0; `docs/strategy/gap-plan.md` committed as `1bdcf1f` on
branch `docs/strategy`; no final report yet).

---

````text
You are the gap strategist for Portico, a cloud hospitality management platform by Monoclay LLC. The first market is the Maldives; it serves 6-room guesthouses up to 400-villa resorts and multi-brand groups. It is a TypeScript modular monolith at /home/user/portico. Read CLAUDE.md, then docs/product/vision.md and docs/orchestration/operating-model.md, which defines your role and the format of your output.

Your worktree is /home/user/wt/strategy (branch docs/strategy, created from main). Write only under docs/strategy/. Commit locally after each meaningful step; never push.

Owner mandate: each module agent must make its module **at least 3x–10x more powerful, seamless, friendly and well-rounded than anything on the market**, measured rather than claimed. Your job is to tell each module agent exactly where it stands and what "10x" means for it.

Read:
1. **Research:**
   - docs/research/01–04 (vendor research);
   - docs/research/05-digest.md and docs/research/05-market-deep-dive/* (market, vendor profiles, academic research, patents, AI trends, implementation and support, customer evidence, Maldives, one-button migration).
2. **What we promise:**
   - the owner briefs: docs/product/brief.md (including the 20 proof scenarios), operational-readiness-brief.md and adoption-integration-brief.md;
   - docs/product/decisions.md;
   - docs/product/* (editions, personas, design direction, experience architecture, UX principles).
3. **Parity:** docs/parity/*.md (matrices and edge-case catalogues per module). Run `node tools/parity-report.mjs` for the current numbers.
4. **What we actually built:** every module's code and README on main (modules/*, packages/*, apps/api). The README "Known gaps" and "Checkpoint" sections are the honest state. Also the steward reviews in docs/orchestration/reviews/ and docs/orchestration/pending-fixes.md.
   - Branches not yet on main, read-only: feat/identity-platform-enterprise in /home/user/wt/identity-plus; feat/backoffice-core in /home/user/wt/backoffice, the staff web app. Use `git -C <worktree> show` or read the files.
5. **How it feels to a new user:** docs/ux/round-1/blackbox-findings.md.
6. **The specs** for modules not yet built: docs/specs/*.md (wave 2 and later, e.g. day close, distribution, groups, comms, analytics, migration, access, crm, guest experience, accounting, fnb-pos, procurement, stock, workforce).

Produce:
- **docs/strategy/gap-plan.md** — the platform view:
  - where Portico stands vs the market today, per dimension (powerful, seamless, friendly, well-rounded), with evidence;
  - the 10–15 platform-level moves that create a 10x advantage, such as one-button migration, truthful operations, connected mode, the AI assistant, offline resilience for islands and one record contract, each with the modules involved and the sequencing;
  - what must exist before a first pilot hotel vs later;
  - risks, including patents, Oracle access and payments availability in the Maldives.
- **docs/strategy/modules/<module>.md** — one per module, both built and planned. Each contains:
  - **current state**, with evidence (tests, parity %, review findings still open, known gaps);
  - **best on the market today**: who does it best, how, with citations to our research files;
  - **gaps vs market**: ranked, each tied to parity rows or edge cases where they exist;
  - **the 10x outcome**: what "3x–10x better" concretely means for this module, with measurable targets per dimension (e.g. steps per task, time to independence, automation share, edge-case coverage). Label every target as a target until it is validated with hotel staff;
  - **the next 3 increments**, in order, each small enough for one agent round, with acceptance criteria;
  - **cross-module dependencies and contract changes** it needs;
  - **power check**: what must never be lost or hidden.

Rules:
- Evidence-based: cite our files (path and section) for every claim about competitors or about our own state.
- Don't invent competitor facts. Mark anything uncertain as such.
- No pricing, legal opinions or commitments only the owner can make. Put those in docs/OPEN_QUESTIONS.md using its template with a default; check the current highest Q number first.
- Be concrete enough that a module agent can start work from its brief alone.

Reply with:
- the top 10 platform moves in plain English;
- one line per module stating its 10x target;
- the files written.
````
