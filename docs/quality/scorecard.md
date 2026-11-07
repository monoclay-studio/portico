# Checker scorecard

There is one row per checker run, and a trend table per loop. Every round appends: new rows go in the run tables, and
a new column goes in the trend table. **Numbers marked *(est.)* are estimates.** The method behind each column is in
§ 1.

## 1. Method

| Measure | How it is computed | Source | Caveat |
|---|---|---|---|
| **Findings** | P0/P1/P2/P3 counts as reported by the checker | The final report in `docs/chronicle/agents/*.md`; the reviews in `docs/orchestration/reviews/` | — |
| **Precision (P0+P1)** | P0+P1 findings that were **acted on** (fixed, or accepted as real and deferred with a reason), divided by P0+P1 raised. A finding the builder disputed and the orchestrator upheld counts as a false positive | Builder fix-round reports (`docs/chronicle/agents/20261107T0732-*`, `…T0738-*`); `pending-fixes.md` | **Upper bound.** Fix-round briefs said "must fix", so acting on a finding may be compliance rather than independent confirmation. Where a proof-of-concept (PoC) test reproduced the defect, precision is confirmed, not only acted on |
| **Escapes attributed** | Entries in `escapes.md` whose earliest loop is this run | `escapes.md` | Depends on later loops having looked. Zero escapes is not evidence of recall when nothing re-checked the work |
| **Recall** (estimate) | found ÷ (found + attributed escapes), at the same severity band | Run tables below | An **upper bound** until canaries run (`canaries.md`). "Unmeasured" when no later loop or canary has re-checked the run's scope |
| **Evidence quality** | Rubric 0–3: **R** reproduction (PoC tests, scripts, exact steps); **L** location (file:line, or a screenshot that exists and shows the claimed state); **I** stable finding IDs. For L4, also the share of valid screenshot citations | Reports and `docs/ux/round-1/screens/` | — |
| **Coverage** | L2: the checklist dimensions and patterns declared as checked. Coverage declarations arrive with v2; round 0 uses a crude count of mentions (§ 3.3). L4: personas × tasks × devices. L5: modules with a matrix, and rows | Reports; `docs/parity/*` | Mentions are not checks; absence is ambiguous |
| **Cost** | Wall window; **active minutes** = wall time minus usage pauses (08:30–11:11 and 12:36–16:14 UTC) *(est.)*; turns; tool uses; output tokens; input tokens including cache | `docs/chronicle/data/agents.json` | Runs still in progress at extraction (16:38–16:42) are **lower bounds** (≥) |
| **Playbook version** | The version the run launched from. Round-0 runs used v1 (reconstructed in `playbooks/archive/`) | — | — |

---

## 2. Trend table (append one column per round)

| Loop | Headline metric | Target | R0 (2026-11-07) | R1 | R2 |
|---|---|---|---|---|---|
| All | Escapes, by earliest loop (L1-gate / L1-BSC / L2 / L3 / L4 / L5) | ↓ each round | 9 / 7 / 11 / 0 / 5 / 6 = **38** | | |
| All | Escapes at P0/P1 | 0 | **11** (2 P0, 9 P1) | | |
| L1 | Merge-time breakages a branch's own gate should have caught | 0 | **4** (E-008, E-010, E-011, E-018) | | |
| L1 | Gate integrity incidents (stale cache, piped lint, tool false positives, flake) | 0 | **10** (2 cache-hidden errors; 4 lint commits; 2 tool false positives; 2 flaky or timed-out tests) + 1 latent (E-038) | | |
| L1-BSC | P0+P1 per first review | ↓ | **11.1** (111 across 10 reviews) | | |
| L1-BSC | Defects a fix round introduced or left, found later | 0 | **6** (identity-plus; the only module re-reviewed) | | |
| L2 | Precision P0+P1, upper bound | ≥ 0.9 | **1.00** (104 of 104 acted on in 9 reviews; backoffice pending; review 2 accepted 4 of 4) | | |
| L2 | Recall P0+P1 (est., upper bound) | ≥ 0.9 | identity-plus-1 **0.83**; backoffice **0.88**; 8 reviews unmeasured | | |
| L2 | Reviews with a coverage declaration | 100 % | **0 %** (v1 did not ask) | | |
| L2 | Output tokens per P0/P1 finding (first round) | — | **≈ 19k** (2.13M ÷ 111) | | |
| L3 | Scenarios passing on real providers / total | 20 of 20 | **not yet run** (integration step running) | | |
| L4 | Valid screenshot citations | 100 % | **89 %** (68 of 76) | | |
| L4 | Findings with stable IDs | 100 % | **0 %** | | |
| L4 | Refiner: invalid evidence propagated | 0 | **1** | | |
| L4 | Refinements accepted ÷ decided | — | **pending** (no `decisions/` yet) | | |
| L5 | Parity rows downgraded by later reviews (overclaims) | 0 | **≥ 8** *(est.)* | | |
| L5 | Share of edge cases added after review | ≤ 10 % | rates **31 %**, payments **19 %** | | |
| L5 | Built modules with no parity matrix | 0 | **4** (operations, guests, integration, identity) | | |
| L5 | Scope gaps found by the owner | 0 | **1** (E-024) | | |
| Canaries | Recall measured by canaries | — | **no runs** (usage constrained) | | |

---

## 3. L2 — steward reviews

### 3.1 Runs

| # | Run | Playbook | Window (UTC) | Active min *(est.)* | Turns | Tools | Output tok | Input tok (incl. cache) | P0/P1/P2/P3 | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | guests | v1 | 08:17–11:13 | ≈ 16 | 173 | 102 | 150,363 | 43.4M | 2/6/13/10 | do not merge |
| 2 | inventory | v1 | 08:23–11:21 | ≈ 17 | 145 | 84 | 175,535 | 32.1M | 2/6/8/9 | merge after fixes |
| 3 | rates | v1 | 08:24–11:23 | ≈ 18 | 129 | 73 | 182,110 | 29.4M | 1/10/18/7 | merge after fixes |
| 4 | payments | v1 | 11:13–11:32 | 19 | 241 | 137 | 212,362 | 63.8M | 3/12/14/10 | merge after fixes |
| 5 | operations | v1 | 11:15–11:36 | 20 | 209 | 119 | 241,151 | 57.5M | 2/12/22/14 | merge after fixes |
| 6 | reservations | v1 | 11:19–11:38 | 20 | 301 | 179 | 251,546 | 85.1M | 1/16/12/6 | merge after fixes |
| 7 | integration | v1 | 11:20–11:39 | 19 | 221 | 129 | 206,237 | 59.9M | 1/8/10/10 | merge after fixes |
| 8 | finance | v1 | 11:23–11:42 | 19 | 227 | 130 | 241,213 | 63.5M | 2/10/17/12 | do not merge |
| 9 | identity-plus (1st) | v1 | 11:25–11:46 | 21 | 248 | 142 | 237,251 | 70.3M | 2/8/17/12 | do not merge |
| 10 | backoffice UI | v1 (UI-adapted) | 11:33–12:02 | 28 | 289 | 173 | 232,105 | 77.5M | 1/6/18/10 | merge after fixes |
| 11 | identity-plus (2nd) | v1-b | 16:15–16:52 | ≥ 23 (≈ 37 to the 16:52 verdict) | ≥ 196 | ≥ 99 | ≥ 278,744 | ≥ 51.9M | 1/3/6/9 (new) | do not merge |
| | **First round (1–10)** | | | **≈ 197** | **2,183** | **1,268** | **2,129,873** | **582.5M** | **17/94/149/100** | 3 "do not merge" |

### 3.2 Quality per run

| # | Run | Precision P0+P1 (acted ÷ raised) | Escapes attributed | Recall P0+P1 *(est.)* | Evidence (R/L/I) | PoCs preserved in repo | Notes |
|---|---|---|---|---|---|---|---|
| 1 | guests | **8/8** (all fixed; MUSTs R14/R15/R19/R20 marked Partial) | 0 | unmeasured | 3/3 (probes in scratch) | no (regression tests in the module) | Reported a flaky suite (57P01, E-016) with 4 re-runs: good practice. Assessed every foundation request |
| 2 | inventory | **8/8** | 0 | unmeasured | 3/3 (CE1–CE8; 7 reproduced, CE4 shown safe) | no (became `regression-review.test.ts`) | Reported what held as well as what failed |
| 3 | rates | **11/11** (R-10 deferred with a reason; R-19 flagged "not verified" and confirmed real, `944ff0f`) | 0 | unmeasured | 3/3 (scripts on pure functions) | no | Re-ran typecheck uncached. Honest about what it had not verified |
| 4 | payments | **15/15** | 0 defects; detected E-011 drift as a shared-code note | unmeasured | 3/3 (`zz-steward`, `zz-finance-binding`) | no | Bound to *real* finance in a copy: a strong cross-module technique |
| 5 | operations | **14/14** (P1-5/6/8/11 deferred with reasons) | 0 | unmeasured | 3/3 (16 tests asserting defects) | no | Bound to *real* inventory in a copy |
| 6 | reservations | **17/17** (contract items moved to the integration step) | 0 | unmeasured | 3/3 (11 experiments; port-vs-provider table) | no | Its port-vs-provider table became the integration plan |
| 7 | integration | **9/9** | 0 | unmeasured | 3/3 (PROBE-1…10) | no | Also showed which probes *held* (1, 4) |
| 8 | finance | **12/12** (F-10 not built; F-12 owned by parity) | E-037 (process); detected E-011 drift, not tracked | unmeasured | 3/3 (probes + `typecheck/compat.ts`) | no | Ran the parity gate in another agent's worktree (E-037) |
| 9 | identity-plus (1st) | **10/10** (2nd review: all 11 original attacks closed) | **E-001 (P0), E-002 (P1)** | **≤ 0.83** (10 ÷ 12) | 3/3 (PoCs) | **yes** (`reviews/identity-plus-poc/`) | Its own fix recommendation enabled E-001 (RC-4) |
| 10 | backoffice UI | **pending** (fix round running). 2 of 7 P0/P1 independently corroborated by L4 (P1-1 drawer focus, P1-4 truncation) | **E-025…E-031** (1 P1, 6 P2) | P0+P1 **≤ 0.88** (7 ÷ 8); all severities **≤ 0.83** (35 ÷ 42) | 3/3 (Playwright probes, screenshots, prototype diff) | partly (`reviews/backoffice/`) | Brief limited widths to 1280–1920 (E-027 root cause) |
| 11 | identity-plus (2nd) | **4/4 accepted** (ADR-0017 Amendment 1; fix round 3 running) | 0 so far (3rd review pending) | unmeasured | 3/3 (PoCs, HTTP PoC) | **yes** | Found RC-1's root cause (R2-P2-6). Exit codes captured directly |

**Reading the table.**

- **Precision.** No P0/P1 finding was disputed in round 0. One P3 was declined with a reason that the re-review
  accepted (identity P3-8, wording prescribed by the ADR). Precision may be inflated by "must fix" briefs; see § 1.
- **Recall.** Measured only where something re-checked the scope: a second review, or the black-box tester on the
  UI. In both cases it was **≈ 0.83**. For the other 8 reviews, recall is **unknown**; canary sets A–D are designed to
  measure it (`canaries.md` § 5).
- **Evidence durability.** PoCs were kept in the repository only for identity-plus. For the other 9 reviews the
  probes live in the session scratchpad and are lost when the container is reclaimed. The builders' regression tests
  partly preserve them (retro, edit 3).

### 3.3 Coverage: crude count of dimension mentions (round 0 only)

This counts how often each review report mentions a checklist dimension (`grep -ci` on each review file). A zero means
the dimension is **not mentioned**. It does not show whether it was checked. This ambiguity is the reason for SR2-1
(the coverage declaration).

| Review | isolat- | permission | idempot- | concurren- | audit | contract | authorit- | environment | spec/MUST | scenario | readiness | record contract | parity | cross-module |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| guests | 5 | 8 | 7 | 3 | 9 | 9 | 2 | 1 | 7 | 5 | 3 | 2 | 5 | 3 |
| inventory | 2 | 7 | 1 | 9 | **0** | 8 | 10 | 1 | 8 | 3 | 4 | **0** | 7 | 1 |
| rates | 3 | 6 | **0** | 4 | **0** | 19 | 1 | **0** | 8 | 3 | 2 | **0** | 9 | 1 |
| payments | 1 | 4 | 5 | 13 | 2 | 6 | 1 | 4 | 9 | 3 | 3 | **0** | 3 | 1 |
| operations | **0** | 13 | 3 | 5 | 2 | 11 | 7 | **0** | 11 | 5 | 17 | 1 | 7 | 1 |
| reservations | 2 | 13 | 10 | 6 | 1 | 8 | 7 | 1 | 25 | 3 | 9 | 1 | 6 | 3 |
| integration | 2 | 4 | 3 | 13 | 4 | 3 | 6 | 4 | 8 | 4 | 2 | **0** | 2 | 1 |
| finance | 3 | 9 | 9 | 18 | 4 | 7 | 1 | 1 | 7 | 5 | 1 | 1 | 7 | 4 |
| identity-plus 1 | 4 | 16 | 1 | 4 | 8 | 3 | 18 | 4 | 17 | 1 | 7 | 1 | 5 | 1 |
| backoffice | 1 | 3 | 5 | **0** | **0** | 12 | **0** | 3 | 5 | 3 | 9 | 3 | 1 | 2 |
| identity-plus 2 | 1 | 6 | **0** | 2 | 3 | 2 | 5 | 1 | 4 | **0** | **0** | **0** | **0** | **0** |

The second review was a focused re-review, so its zeros are expected.

**Focus areas.** In the quality steward's reading of the final reports, all 10 first-round reviews addressed the
focus areas the orchestrator set, most in an explicit section ("On your four focus areas" in rates, "Other focus
areas" in integration).

**Parity gate.** 9 of 10 reviews attempted the gate; backoffice had no gate to run. It ran for 6: inventory,
payments, operations, reservations, finance and platform. Guests, rates and integration had no parity file, and
neither did identity.

---

## 4. L4 — UX loop

| Run | Playbook | Window (UTC) | Active min | Turns | Tools | Output tok | Input tok | Output | Precision | Evidence | Coverage | Escapes attributed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Black-box tester R1 | v1 | 11:41–12:17 | 36 | 256 | 157 | 168,642 | 44.0M | 34 tasks: 5 done, 11 partly, 18 not; 14 blocker + 13 major + 5 minor task frictions; top 20; top 10 strengths | **20/20** top frictions mapped to refinements or to SR. 1 (T9, "simulated actions don't change state") resolved differently: "do not build a stateful simulator" | R ✓ (steps, screenshots); L **68 of 76 citations valid (89 %)**: 6 missing after hand-off (E-032), 1 skeleton (E-033), 1 wrong-state duplicate (E-034); I **✗** (no IDs, E-035) | 9 of 9 personas; phone 390, tablet 1024, desktop 1440/1920; keyboard pass; light/dark; errors. **Not covered:** shared-desk handover (the L2 P0-1 class) | E-033, E-034, E-035 (tester); E-032 (hand-off) |
| UX refiner R1 | v1 | 16:16–≈16:58 | ≥ 21 (≈ 42 to delivery) | ≥ 104 | ≥ 67 | ≥ 299,494 | ≥ 20.3M | 83 refinements (44 a / 6 b / 33 c; 23 blocker, 46 major, 14 minor); C1–C12; 10 new metrics with baselines | **pending** (module owners' `decisions/` not written yet) | Power check **83/83**; findings cited by section and T-number; 73 screenshot references; caught 3 evidence gaps; **propagated 1 invalid citation** (GST-01 → `p2-08`) | 10 area files; all 20 top frictions mapped; full-finding traceability not possible without IDs | E-034 (re-cited); E-036 (write refused) |

---

## 5. L5 — market and parity

| Run | Playbook | Window (UTC) | Active min *(est.)* | Turns | Tools | Output tok | Input tok | Output | Overclaims found later | Catalogue recall signals | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parity front (inventory, rates, reservations, groups, distribution, platform) | v1 | 08:12–11:30 | ≈ 37 | 169 | 103 | 360,288 | 44.9M | 6 matrices, **493** capabilities, **222** edge cases, `gaps-front.md`; 387 links opened, 1 dead link fixed | none reported (only platform had `tested` rows) | Rates: +6 capabilities and +16 edge cases after review (**31 %** of edge cases). Inventory: about 6 real P0 rows missing (INV-08, E-022) | Wrote "code on main: none" correctly at the time; matrices went stale when the code merged |
| Parity finance (finance, payments, day-close, accounting, fnb-pos, procurement, stock, analytics) | v1 + the "compare with unmerged branches" instruction | 08:12–11:42 | ≈ 49 | 239 | 154 | 562,119 | 84.1M | 8 matrices, **703** capabilities, **329** edge cases, `gaps-finance.md` | **≥ 8** *(est.)*: finance F-12 "several" (PAR-FIN-132/133 and others); payments P2-13 (4 rows) (E-019) | Payments: +8 capabilities and +13 edge cases after review (**19 %**) (E-021) | Told the orchestrator plainly that it cited unmerged branches: the honesty was good, the evidence rule was weak |
| Parity ops (10 modules) | v1 | launched 08:12, paused | 0 | 0 | 0 | 0 | 0 | **nothing delivered** (deferred for usage) | — | — | **Coverage gap.** operations, guests, integration and identity are built with no matrix, so their parity gate cannot run |
| Gap strategist, run 1 | v1 | 16:42– (running) | — | — | — | — | — | `docs/strategy/gap-plan.md` committed (`1bdcf1f`); module briefs pending | — | — | Not scored in round 0 |

## 6. L3 — scenario proof

| Run | Playbook | Window | Status |
|---|---|---|---|
| Integration step (bind ports, then S01–S20) | v1 | 16:16– (running) | No report at round 0. Not scored. The first L3 result is the baseline for "scenarios passing on real providers" |

## 7. L1 — gate integrity (round 0)

| Incident type | Count | Escapes | Status |
|---|---|---|---|
| Type errors hidden by a stale turbo cache | 2 errors, 3 detections | E-008, E-009 | Root cause fixed (`1be3ddc`). Residual hole in `apps/*` (E-038, latent) |
| Lint failures committed | 4 commits | E-010 | `tools/commit-checked.sh` since 16:41 |
| Shared-tool false positives | 2 | E-012 (boundary checker), E-013 (catalogue test reads comments) | Boundary checker fixed; catalogue test not fixed (comment reworded) |
| Unregistered permission | 1 | E-014 | Catalogue test added |
| Flaky or timed-out tests | 2 | E-016 (drop race), E-015 (demo-seed timeout) | Both fixed. No flake tracking yet |
| Merge-only breakages (lockfile, duplicate import) | 2 | E-017, E-018 | Builder self-check v2, gate block |
| Packages with **0 tests** | 2 | `packages/testing` (harness), `apps/worker` (`05-metrics.md`) | E-016 traces to the harness |

## 8. Canary runs

| Run id | Date | Checker / version | Set | Planted | Credit | Recall | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Round 0: none (usage constrained; `canaries.md` § 5 has the schedule) |
