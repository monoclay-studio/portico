# ai — 10x brief (an assistant that acts through the same commands)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3b; read-only cited answers may come earlier) · Spec
`docs/specs/ai.md` (AI-R01–R11) · Parity: **none** · Research DD05 · Source key: `docs/strategy/gap-plan.md` §0.
**All targets are TARGETS until validated with hotel staff.** Owner questions: Q25, Q84, Q153 (new).

## 1. Current state (evidence)

- **No `ai` module exists.** What makes it possible already exists: permission-aware services behind every module,
  the universal record contract and `/v1/records/:type/:id/{summary,history}`, global search providers, previews with
  fingerprints for consequential changes (reservations, finance "who pays", platform policies), environment safety
  (`assertExternalEffectAllowed`), audit with actor markers (identity branch adds impersonation/support markers).
- **Missing prerequisites:** an **action registry** (commands addressable by UI, palette, API and AI — gap plan M2),
  agent principals and consent scopes (identity brief increment 3), public OpenAPI and partner apps (integration brief
  increment 2), analytics metric catalog for governed questions.
- **Spec stance:** AI never in the critical path; never invents availability, payment outcomes or policy; proposals need
  explicit confirmation; budget caps; simulated inference in demo/trial (AI-R01–R09).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Embedded, explainable, free | Oracle OPERA Cloud | AI Room Search with reason text, AI reservation summary at check-in, regenerate-with-preview for descriptions; OPERA Cloud Assistant (Jun 2026) at no extra cost, opt-in per property | DD02a §1.3; DD05 §1; DG #15 |
| Agent tooling | Apaleo | MCP server with ~260 tools (OAuth, self-serve beta) + Claude plugin bundling SOPs; live agentic task creation; room-allocation agent | DD02b §2; DD05 §2; DG #21 |
| Revenue agent | Lighthouse | Revenue Agent at no extra cost; Ernest assistant | DD02c §1; DG #33 |
| Data-model AI | Cloudbeds Signals / Ask Signals (pilot) | Causal AI; conversational analytics | DD02b §3 |
| Weak spots | Market | Agents mostly announced, not proven; no independent evaluation; ROI claims on n=8 | DD05 §1 obs. 2, §5; DG §5 #4 |
| Workforce | Research | AI job insecurity raises turnover intention; role ambiguity amplifies technostress | DD03 §3; DG #41 |

## 3. Gaps vs market (ranked)

| # | Gap | Spec / research |
|---|---|---|
| 1 | Cited answers over permission-scoped retrieval (guest, booking, balance, policy, availability fetched live) | AI-R01, R02 |
| 2 | Stay, handover and guest summaries at the point of work (check-in, handover, messaging) | AI-R10; Oracle 26.4 parity |
| 3 | Proposals executed only through the action registry with the owning module's preview and human confirmation | AI-R04; gap plan M2/M12 |
| 4 | Untrusted-input defences (guest messages, imported files) and data minimization | AI-R05, R06 |
| 5 | Evaluation suite published (citation accuracy, refusal when data missing, permission leakage, injection, unsafe-action rate, reversal rate) | AI-R11; DD05 §6 |
| 6 | MCP server mirroring public API scopes with **dry-run for every money tool** | DD05 §2, §6 |
| 7 | Budgets, environment simulation, provider-agnostic port, audit with redaction | AI-R07–R09 |
| 8 | Drafts for comms (never auto-sent unless an approved automation) and explanations for rates/inventory suggestions | COM-R11; RAT-R31; INV-R23 |
| 9 | "AI that counts the work it creates" (exceptions, overrides, reversals per AI action) | DD05 §6 |

## 4. The 10x outcome (TARGETS)

**Picture:** a night auditor asks "why is villa 214's balance negative?" and gets a two-line answer that cites the three
postings and the refund behind it, with a proposed correction rendered in finance's own preview that she can accept or
ignore; the same assistant, through the same commands, is available to the hotel's own agents via MCP — with a dry run
for anything that moves money, and a published scorecard of how often it is right.

| Dimension | Metric | Market reference | Target |
|---|---|---|---|
| Powerful | Answers with every factual claim cited to records the user may see | Oracle reason text on room search (DD02a §1.3) | 100% |
| Powerful | Invented availability / payment / policy facts in the evaluation suite | no published evaluations (DD05 §1) | 0 |
| Powerful | Unsafe actions executed without human confirmation (red team, injection corpora) | — | 0 |
| Seamless | Actions an assistant can propose that staff can also do (same registry) | — | 100% parity; 0 AI-only side channels |
| Friendly | Staff who can tell suggestion from fact at a glance | — | 100% in usability sessions (Q152) |
| Well-rounded | Product workflows that fail when AI is off or capped | — | 0 (E14) |
| Well-rounded | Evaluation suite published per release | none in the market | every model/prompt change |

## 5. Next 3 increments

### Increment 1 — Cited answers and summaries (read-only)
- Module skeleton with provider-agnostic port, simulated inference in demo/trial, budgets and audit with redaction;
  retrieval only through module services as the user; cited answers for guest, stay, booking, balance and policy;
  stay/handover summaries at check-in and handover; evaluation suite v1 (citation accuracy, refusal when missing,
  permission leakage, injection from a guest-message corpus).
- **Acceptance:** AI-R01–R03, R05–R09, R10 tested; 0 leakage in the suite; organization can disable AI.

### Increment 2 — Proposals through the action registry
- Proposal aggregate (`drafted → previewed → confirmed → executed | failed`) that calls the owning module's preview and
  commit through the registry; consequential actions never auto-executed; "AI suggested / human approved" trail; work
  counters per AI action (overrides, reversals).
- **Acceptance:** AI-R04 tested for a room move, a payment request and a comms draft; reversal rate tracked.

### Increment 3 — MCP server and published evaluation
- MCP server mirroring public API scopes (via integration's partner apps and identity's consent scopes), dry-run for every
  money/inventory tool, rate limits that protect operations; evaluation scorecard published per release (Q151 governs any
  external comparison).
- **Acceptance:** an external agent completes a scripted task set in a sandbox org with 0 unsafe actions; dry-run
  outputs equal the real previews.

## 6. Cross-module dependencies and contract changes

**kernel:** action registry and status families. **identity:** agent principal, `via` marker, consent scopes.
**integration:** OpenAPI, partner apps, MCP transport. **all modules:** previews callable by proposals; search providers;
record summaries. **analytics:** governed metrics for questions about numbers. **comms:** drafts. **rates/inventory:**
explanations of suggestions. **platform:** budgets and usage meters (Q45, Q153).

## 7. Power check — never lose or hide

AI is never in the critical path; it never invents availability, payment outcomes, policy or confirmed reservations; it
acts only as the user with the user's permissions; every consequential action is previewed and confirmed by a human;
suggestions look different from facts; guest-facing automatic answers stay off until Q84.
