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
| **Times and costs** (from round 1) | Taken only from `git log` and `docs/chronicle/data/agents.json` after extraction, never from the timeline's prose. "≥" figures are re-read the next round and corrected in § 9 | — | Round 0 used timeline estimates in places (E-056) |
| **Recommendation defects** (from round 1) | Defects a later review traces to an earlier review's own recommended fix (RC-9). Counted per review, separately from recall | `escapes.md` | — |

---

## 2. Trend table (append one column per round)

| Loop | Headline metric | Target | R0 (2026-11-07) | R1 | R2 |
|---|---|---|---|---|---|
| All | Escapes, by earliest loop (L1-gate / L1-BSC / L2 / L3 / L4 / L5) | ↓ each round | 9 / 7 / 11 / 0 / 5 / 6 = **38** (reclassified in R1: 8 / 7 / 10 / 0 / 3 / 5 + L-orch 5) | 2 / 13 / 3 / 1 / 0 / 1 + L-orch 3 + L8 1 = **24** | |
| All | Escapes at P0/P1 | 0 | **11** (2 P0, 9 P1) | **5** (0 P0, 5 P1) | |
| L1 | Merge-time breakages a branch's own gate should have caught | 0 | **4** (E-008, E-010, E-011, E-018) | **0** on main; 2 caught by the merge verification before merge (E-053, E-054) | |
| L1 | Gate integrity incidents (stale cache, piped lint, tool false positives, flake) | 0 | **10** (2 cache-hidden errors; 4 lint commits; 2 tool false positives; 2 flaky or timed-out tests) + 1 latent (E-038) | **0** incidents. E-038 closed (C-L1-01 caught). 3 latent gaps found: E-052, E-059, and E-013 still open | |
| L1-BSC | P0+P1 per first review | ↓ | **11.1** (111 across 10 reviews) | **3** (integration step, 1 review) | |
| L1-BSC | Defects a fix round introduced or left, found later | 0 | **6** (identity-plus; the only module re-reviewed) | **8**: E-039, E-045, E-046 (residuals of merged round-0 fixes); E-047, E-049 (identity round 3); E-053, E-054 (backoffice); E-062 | |
| L2 | Precision P0+P1, upper bound | ≥ 0.9 | **1.00** (104 of 104 acted on in 9 reviews; backoffice pending; review 2 accepted 4 of 4) | **1.00** for round 0 is now final: backoffice 7/7 fixed at merge, 111/111 across all 10. The two round-1 reviews are pending (fix rounds running) | |
| L2 | Recall P0+P1 (est., upper bound) | ≥ 0.9 | identity-plus-1 **0.83**; backoffice **0.88**; 8 reviews unmeasured | Unchanged. No round-1 escape was present when an earlier review ran; the round-1 L2 escapes are recommendation defects (next row) | |
| L2 | Reviews with a coverage declaration | 100 % | **0 %** (v1 did not ask) | **0 of 2 formal** (both launched before v2); **1 of 2 de facto** (integration-step § 3, "what I checked and what held") | |
| L2 | Recommendation defects (RC-9) per review | 0 | identity review 1: **1** (E-001) | identity review 2: **3** (E-048, E-050, E-051) | |
| L2 | Identity: new P0+P1 per review (convergence) | → 0 | review 1: **10**; review 2: **4** | review 3: **2** (all fix-related) | |
| L2 | Output tokens per P0/P1 finding | — | **≈ 19k** (2.13M ÷ 111) | integration step **≈ 82k** (244,791 ÷ 3); identity 3 **≈ 127k** (254,826 ÷ 2). Cost per defect rises as defect density falls, which is expected | |
| L3 | Scenarios passing on real providers / total | 20 of 20 | **not yet run** (integration step running) | **12 of 20** claimed (S01, S03–S08, S13–S17); **1 overclaimed** (S04, E-042); 8 todo-only. Binding manifest and assertion map not yet produced (v2 not in force) | |
| L4 | Valid screenshot citations | 100 % | **89 %** (68 of 76) | — (no L4 round). Round-1 evidence repaired: the six `x-0*` files restored and `p2-08` marked invalid (`8ed5bf8`) | |
| L4 | Findings with stable IDs | 100 % | **0 %** | | |
| L4 | Refiner: invalid evidence propagated | 0 | **1** | | |
| L4 | Refinements accepted ÷ decided | — | **pending** (no `decisions/` yet) | backoffice/ui: **32 of 32** accepted or adapted (29 accepted, 3 adapted, 0 rejected); rules C1–C12: 10 accepted, 2 adapted. Other modules' 51 decisions pending. Acceptance is not outcome: round 2 measures outcomes | |
| L5 | Parity rows downgraded by later reviews (overclaims) | 0 | **≥ 8** *(est.)* | 0 found. **Under**-claims found: inventory and reservations at 1 % `tested` against dozens proven, and `COVERAGE.md` showing rates at 2 % against 61 % (E-060) | |
| L5 | Share of edge cases added after review | ≤ 10 % | rates **31 %**, payments **19 %** | | |
| L5 | Built modules with no parity matrix | 0 | **4** (operations, guests, integration, identity) | **4** on main (parity-ops resumed 17:03 and 17:38; operations and guests matrices on its branch) | |
| L5 | Scope gaps found by the owner | 0 | **1** (E-024) | **0** | |
| Canaries | Recall measured by canaries | — | **no runs** (usage constrained) | L1: C-L1-01 **1/1** (orchestrator); `r1-l1` **5/7** (gaps: `sql.raw`, comment false positive). No L2 or L4 canary yet | |
| L-orch | Escapes whose earliest loop is the orchestrator | 0 | **5** (after reclassification: E-010, E-019, E-027, E-032, E-036) | **3** (E-055, E-057, E-060) + 3 contributing (E-040, E-043, E-048) | |
| All | Fix-related share of escapes (introduced, residual, or recommendation-induced) | ↓ | 7 of 38 | **12 of 24 (50 %)** | |
| L1-BSC | Shared-vocabulary copies (BS3-1) / optional scope parameters on ports (BS3-3) | 0 / 0 | — | **6** provenance literals in 5 modules, plus 1 local `ModuleUnavailableError`; **22** matches of the BS3-3 grep (finance `service/index.ts`: 5) | |

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
| 12 | integration step (round 1) | bespoke brief, "read the playbook if it exists"; effectively v1 (v2 published 17:20) | 17:04–17:26 | 22 | 295 | 161 | 244,791 | 77.0M | 0/3/7/9 | merge after fixes |
| 13 | identity-plus (3rd, round 1) | bespoke focused re-review; effectively v1-b | 17:09–17:30 | 21 | 144 | 82 | 254,826 | 29.5M | 0/2/3/5 (new) | merge after fixes |

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
| 10 | backoffice UI | **7/7** (resolved in round 1: P0 cache leak and all P1 fixed; merged at 17:22). 2 of 7 were also independently corroborated by L4 | **E-025…E-031** (1 P1, 6 P2) | P0+P1 **≤ 0.88** (7 ÷ 8); all severities **≤ 0.83** (35 ÷ 42) | 3/3 (Playwright probes, screenshots, prototype diff) | partly (`reviews/backoffice/`) | Brief limited widths to 1280–1920 (E-027 root cause) |
| 11 | identity-plus (2nd) | **4/4 accepted** (ADR-0017 Amendment 1; fix round 3 running) | 0 so far (3rd review pending) | unmeasured | 3/3 (PoCs, HTTP PoC) | **yes** | Found RC-1's root cause (R2-P2-6). Exit codes captured directly. **Round 1:** review 3 confirmed all 9 of its attacks closed. Its own recommendations led to 3 later defects (E-048, E-050, E-051; RC-9) |
| 12 | integration step | pending (fix round running) | 0 so far | unmeasured | 3/3 (7 PoCs kept in `reviews/integration-step-poc/`) | **yes** | Found residuals of 3 merged fixes (E-039, E-045, E-046). Its § 3 "what I checked and what held" is a de facto coverage declaration. Noted that the global consistency checks would miss P1-1 and P1-3. Ran gates on two merged copies as `main` moved |
| 13 | identity-plus (3rd) | pending (fix round 4 running; merge condition: W-1…W-3 regression tests) | 0 so far | unmeasured | 3/3 (W-1…W-6, plus 20 re-runs inverted) | **yes** | Used a test-only `pg_sleep` trigger to make a 50–100 ms race deterministic: a reusable technique (AP-56). Found the superuser test-environment gap (E-052) |

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
| Gap strategist, run 1 | v1 | 16:42–17:09 | 27 | 203 | 125 | 368,530 | 62.3M | `gap-plan.md` (14 platform moves) and 32 module 10x briefs; Q150–Q155 | — | Found 4 measurement problems: parity under-claims, a stale `COVERAGE.md`, 16 modules with no parity file, and the `ACC-R` prefix collision (E-060, E-061) | Acted as a checker of the checkers. Briefs adopted for module round 2 (STATUS queue). Journey walks (GS2-1) not used (v1) |

## 6. L3 — scenario proof

| Run | Playbook | Window | Status |
|---|---|---|---|
| Integration step (bind ports, then S01–S20) | v1 | 16:16– (running) | No report at round 0. Not scored. The first L3 result is the baseline for "scenarios passing on real providers" |
| Integration step: result (round 1) | v1 | 16:16–17:04 (533 turns, 331 tools, 492,418 output tokens at the report) | **12 of 20** scenarios passing, with global consistency checks run in 12 of 12 files (verified by the reviewer). 5 contract bugs found by binding for real. Escapes: **E-042** (S04 overclaim; the first L3 escape); E-039, E-040, E-041, E-043, E-044 (L1-BSC). Precision of the scenario claims: 11 of 12 proven (S04 overclaims), per review § 7 |

## 7. L1 — gate integrity (round 0, with round-1 additions)

| Incident type | Count | Escapes | Status |
|---|---|---|---|
| Type errors hidden by a stale turbo cache | 2 errors, 3 detections | E-008, E-009 | Root cause fixed (`1be3ddc`). Residual hole in `apps/*` (E-038, latent) |
| Lint failures committed | 4 commits | E-010 | `tools/commit-checked.sh` since 16:41 |
| Shared-tool false positives | 2 | E-012 (boundary checker), E-013 (catalogue test reads comments) | Boundary checker fixed; catalogue test not fixed (comment reworded) |
| Unregistered permission | 1 | E-014 | Catalogue test added |
| Flaky or timed-out tests | 2 | E-016 (drop race), E-015 (demo-seed timeout) | Both fixed. No flake tracking yet |
| Merge-only breakages (lockfile, duplicate import) | 2 | E-017, E-018 | Builder self-check v2, gate block |
| Packages with **0 tests** | 2 | `packages/testing` (harness), `apps/worker` (`05-metrics.md`) | E-016 traces to the harness |
| **R1:** latent gaps found by canary or review | 3 | E-059 (`sql.raw` false negative, C-L1-03b2); E-052 (superuser migrations in tests); E-013 still open (C-L1-03c) | Retro edits 3a and 3c |
| **R1:** environment-coupled gate | 1 | E-053: backoffice e2e passes only on port 5180; Playwright outside `turbo test` | Retro edit 1c |
| **R1:** gate checks that held under canary | 6 of 8 conditions | C-L1-01, 02a, 02b (through one copy only), 03a, 03b, 03d | `canaries.md` § 6 |

## 8. Canary runs

| Run id | Date | Checker / version | Set | Planted | Credit | Recall | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Round 0: none (usage constrained; `canaries.md` § 5 has the schedule) |
| c-l1-01-orch | 2026-11-07 17:30 | L1 gate (after edit 6) | C-L1-01 (`apps/api`) | 1 | 1 | 1.00 | Run by the orchestrator. Closes E-038 |
| r1-l1 | 2026-11-07 17:40–17:47 | L1 gates and tools | C-L1-02, C-L1-03 | 7 | 5 | 0.71 | Run by the quality steward, CPU only. Missed: `sql.raw` (E-059); comment false positive (E-013) |

## 9. Orchestrator (L-orch, from round 1)

The orchestrator is measured with the counters in `playbooks/orchestrator.md` § 2.

| Counter | R0 | R1 |
|---|---|---|
| Escapes whose earliest loop is L-orch | 5 (reclassified) | 3 (E-055, E-057, E-060) |
| Escapes where the orchestrator contributed | 1 (E-011) | 3 (E-040, E-043, E-048) |
| Briefs deviating from the playbook, or restating claims more broadly | — | ≥ 2 |
| Commits containing another agent's unfinished files | — | 2 (`1179c98`, `012652e`) |
| Evidence files lost at hand-off | 6 | 0 |
| Chronicle correction batches | — | 1 |
| Stale generated artifacts found later | — | 1 |
| Applied quality edits ÷ proposed | — | **8 of 8** (round-0 edits, `8ed5bf8`); one verified by canary C-L1-01 |
| Time from review report to fix-round launch | — | identity 3: ≈ 5 min (report 17:30:16, timeline 17:35). Integration step: the timeline logs the verdict at **17:24**, but the reviewer finished at **17:26:52** (`agents.json`). Either the time is estimated (E-055 class), or the orchestrator acted on the unfinished report swept into `main` at 17:24 (E-057 class). **To verify in round 2** |

## 10. Corrections (append-only)

- **2026-11-07, round 1 (E-056).** In round-0 rows 11 (identity-plus 2nd) and the refiner, the times and costs were
  estimates or figures cut off by the extraction. The final values from `agents.json` are below; the round-0 rows are
  kept unchanged.

| Run | As written in round 0 | Correct |
|---|---|---|
| identity-plus (2nd), row 11 | 16:15–16:52; ≥ 23 min (≈ 37 to the verdict); ≥ 196 turns; ≥ 99 tools; ≥ 278,744 output; ≥ 51.9M input | **16:15–16:43**; **28 min**; **235** turns; **118** tools; **347,021** output; **68.0M** input |
| UX refiner R1 (§ 4) | 16:16–≈16:58; ≥ 21 min (≈ 42 to delivery); ≥ 104 turns; ≥ 67 tools; ≥ 299,494 output; ≥ 20.3M input | **16:16–16:43**; **27 min**; **123** turns; **78** tools; **428,145** output; **27.2M** input |
| Turbo cache fix `1be3ddc` (cited in § 7) | 17:00 | **16:44** |
