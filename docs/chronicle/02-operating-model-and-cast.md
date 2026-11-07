# Operating model and cast

## Who does what

| Role | Who | Responsibility | Defined in |
|---|---|---|---|
| **Owner** | The founder of Monoclay LLC | Vision, briefs, decisions only they can make (legal, commercial, brand, credentials). Never blocked on: questions are logged with defaults (`docs/OPEN_QUESTIONS.md`) | `CLAUDE.md` §1 |
| **Orchestrator / vision owner** | The main Claude session | Turns briefs into vision, architecture and work plans; launches and briefs agents; merges after verification; keeps coherence across modules; owns the usage guardrail and this chronicle. Builds shared foundation code itself (kernel, db, http, composition root) | `docs/orchestration/operating-model.md` |
| **Architecture steward** | Independent review agents, one per branch | Reads the code against specs and ADRs, **runs it**, writes attack and counterexample tests in a scratch copy, and ranks findings P0–P3 with concrete fixes. Verdict: merge / merge after fixes / do not merge. Never edits the branch | `docs/orchestration/steward-review-brief.md` |
| **Module builders (module owners)** | One agent per module, on its own branch and git worktree | Build the module to its spec: domain logic, persistence, API, permissions, audit, tests, README. Then own the fix rounds. Under the operating model they own making their module 3x–10x better than the market | `docs/orchestration/module-agent-playbook.md` |
| **Researchers** | Research agents | Market and vendor research (01–04), market deep dive (05), parity matrices and edge-case catalogues per module | `docs/research/`, `docs/orchestration/parity-researcher-brief.md` |
| **Auditors / spec writers** | Docs agents | Operational readiness, product strategy, adoption, guest-journey gap audit, back-of-house specs | `docs/readiness/`, `docs/specs/`, `docs/journey/`, `docs/backofhouse/` |
| **Black-box tester ("mystery user")** | UX agent with **no build context** | Uses only the running product, as 9 personas, and records friction | `docs/ux/README.md` |
| **Refining agent** | UX agent with full context | Turns findings into per-module refinements, each with a power check | `docs/ux/README.md` |
| **Gap strategist** | Strategy agent (queued) | Market + parity + code → `docs/strategy/` 10x briefs per module | `docs/orchestration/operating-model.md` |
| **Quality steward** (meta loop, from 2026-11-07 17:05) | Agent on `docs/quality` | Oversees every checking agent. Measures precision, recall and cost; traces escapes; versions their playbooks; plants canaries; keeps the attack and UX-trap pattern library. Resumed after every checking round | `docs/quality/README.md` |
| **Integration engineer** | Agent on `feat/integration-step` | Binds module ports for real and proves the 20 scenarios | `docs/orchestration/pending-fixes.md` |

## How work flows

```
owner briefs ──► orchestrator: vision, architecture, ADRs, specs, foundation code
                     │
                     ├─► research agents ──► docs/research ──► parity gate, specs
                     ├─► module builders (one branch + worktree each, in parallel)
                     │        │ "done" (lint + typecheck + tests green, README checkpoint)
                     │        ▼
                     │   architecture steward review (independent; runs code; attack tests)
                     │        │ P0/P1 findings + ADR decisions
                     │        ▼
                     │   fix round by the same builder ──► orchestrator verifies on a merged copy
                     │        ▼
                     │   merge to main (domain map, role templates, composition, pending cross-module fixes)
                     ├─► UX loop: black-box tester ─► refiner ─► module owners ─► re-measure (continuous)
                     └─► usage guardrail: checks every ~20 min; pause + checkpoint at 92%; scheduled resume
```

Rules that shaped the process:
- **Autonomy:** never stop while other work is unblocked. Owner questions go to `OPEN_QUESTIONS.md` with a
  conservative default.
- **Two gates:**
  - A module **merges** when its review has no open P0/P1 and every check is green.
  - It is called **complete** only when it also passes the parity gate.
- **Ports and adapters with one composition root:** modules can be built in parallel against fakes, then bound
  for real.
- **Agents commit locally and never push.** The orchestrator reviews, merges and pushes.
- **Nothing outward-facing without the owner:** no paid contracts, live transactions, production keys or government
  submissions.

## Roster of agent runs

Generated from `data/agents.json` (38 runs as of 2026-11-07 16:38). Briefs and reports are verbatim in `agents/`.

| Start | Agent run | Reports |
|---|---|---|
| 06:41 | Research: enterprise PMS vendors | 1 |
| 06:41 | Research: modern cloud PMS vendors | 1 |
| 06:41 | Research: SMB and distribution vendors | 1 |
| 06:42 | Research: connectivity, payments, compliance | 1 |
| 07:07 | Docs: operational readiness deliverables | 1 |
| 07:07 | Docs: product strategy and capability catalogue | 1 |
| 07:25 | Docs: adoption and integration deliverables | 1 |
| 07:32 | Wave 1 builders ×9: inventory, rates and tax, guests, reservations, finance, payments, operations, integration, backoffice UI | 1–3 each (build + fix rounds) |
| 07:33 | AWS infrastructure as code | paused |
| 07:38 | Identity and platform enterprise features | 3 (build, fix round, test adaptation) |
| 08:02 | Guest-journey gap audit and specs | 1 |
| 08:02 | Back-of-house operations specs | 1 |
| 08:12 | Parity ×3: front (reservations, inventory, rates, distribution); finance cluster; operations cluster (paused) | 1 / 1 / paused |
| 08:17–11:33 | Steward reviews ×10: guests, inventory, rates, payments, operations, reservations, integration, finance, identity-plus, backoffice | 1 each |
| 11:28 | Market deep dive (owner's research prompt + one-button migration) | 1 |
| 11:41 | Black-box UX tester, round 1 | 1 |
| 16:15 | Second steward review: identity-plus | running |
| 16:16 | Integration step: bind module ports + S01–S20 | running |
| 16:16 | UX refining agent, round 1 | running |
