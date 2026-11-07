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
| **Cost unit** (from round 3, E-116) | Turns = API messages, counted **once per message id**; output and input tokens summed once per message. Tool uses = `tool_use` blocks | Subagent transcripts, `canary-scripts/r3_costs.py` | Rows written before round 3 used `agents.json`, which counts each content block as a turn and repeats its usage (≈ 1.85–2.94× too high). Corrected values are in § 10; the old rows stay as written |
| **Recommendation defects** (from round 1) | Defects a later review traces to an earlier review's own recommended fix (RC-9). Counted per review, separately from recall | `escapes.md` | — |

---

## 2. Trend table (append one column per round)

| Loop | Headline metric | Target | R0 (2026-11-07) | R1 | R2 | R3 |
|---|---|---|---|---|---|---|
| All | Escapes, by earliest loop (L1-gate / L1-BSC / L2 / L3 / L4 / L5) | ↓ each round | 9 / 7 / 11 / 0 / 5 / 6 = **38** (reclassified in R1: 8 / 7 / 10 / 0 / 3 / 5 + L-orch 5) | 2 / 13 / 3 / 1 / 0 / 1 + L-orch 3 + L8 1 = **24** | 1 / 15 / 5 / 0 / 0 / 0 + L-orch 2 + L8 0 = **23** (L8 contributed to E-083) | 2 / 25 / 0 / 0 / 0 / 0 + L-orch 3 + L8 2 = **32** |
| All | Escapes at P0/P1 | 0 | **11** (2 P0, 9 P1) | **5** (0 P0, 5 P1) | **7** (0 P0, 7 P1) | **5** (0 P0, 5 P1: E-086, E-087, E-096, E-097, E-104) |
| L1 | Merge-time breakages a branch's own gate should have caught | 0 | **4** (E-008, E-010, E-011, E-018) | **0** on main; 2 caught by the merge verification before merge (E-053, E-054) | **0** on main. 1 flaky test was caught by the merge verification (E-079) | **0** on main (guests fix verified on a merged copy, 19:06–19:09) |
| L1 | Gate integrity incidents (stale cache, piped lint, tool false positives, flake) | 0 | **10** (2 cache-hidden errors; 4 lint commits; 2 tool false positives; 2 flaky or timed-out tests) + 1 latent (E-038) | **0** incidents. E-038 closed (C-L1-01 caught). 3 latent gaps found: E-052, E-059, and E-013 still open | **1** flake (E-079). C-L3-03(a) caught. Foundation items (lint rule, `sql.raw`, comments, `nobypassrls`) still unbuilt | **2** latent (E-094 warnings exit 0; E-095 infra checks in no gate). 1 flake tracked under O3-3 (`be58bbe`). Mutation canary: 1 untested guard (E-114) |
| L1-BSC | P0+P1 per first review | ↓ | **11.1** (111 across 10 reviews) | **3** (integration step, 1 review) | — (no first review this round) | **3** (infra, 1 review; nothing deployed) |
| L1-BSC | Defects a fix round introduced or left, found later | 0 | **6** (identity-plus; the only module re-reviewed) | **8**: E-039, E-045, E-046 (residuals of merged round-0 fixes); E-047, E-049 (identity round 3); E-053, E-054 (backoffice); E-062 | **15** (8 residuals of round-0 fixes, sweep; 4 from the integration-step fix round; 3 from the guests fix round) + 2 recommendation-induced | **15**: E-086 … E-094, E-114 (integration-step fix round 2, under v4 § 5); E-106 … E-110 (backoffice round-1 claims) |
| L2 | Precision P0+P1, upper bound | ≥ 0.9 | **1.00** (104 of 104 acted on in 9 reviews; backoffice pending; review 2 accepted 4 of 4) | **1.00** for round 0 is now final: backoffice 7/7 fixed at merge, 111/111 across all 10. The two round-1 reviews are pending (fix rounds running) | Round-1 reviews resolved: integration step **3/3**, identity 3 **2/2**. Sweep and re-review pending (fix rounds) | **1.00** so far: guests re-review 4/4 P2 acted on (merged 19:09); sweep 4/4 P1 fixed (re-review #3 inverted its PoCs); re-review #2 3/3 P1 fixed; re-review #3 2/2 and infra 3/3 accepted into fix rounds |
| L2 | Recall P0+P1 (est., upper bound) | ≥ 0.9 | identity-plus-1 **0.83**; backoffice **0.88**; 8 reviews unmeasured | Unchanged. No round-1 escape was present when an earlier review ran; the round-1 L2 escapes are recommendation defects (next row) | **Newly measured by the sweep:** payments ≈ **0.94** (15/16, SW-PAY-3); guests ≈ **0.80** (8/10: SW-GUE-1 and the erasure concurrency defect E-083). The other 6 round-0 reviews held (no recall miss found in 56 re-attacks) | Unchanged. No round-3 escape existed when an earlier review ran: all are in fix-round code, a first build, or claims made after review |
| L2 | Reviews with a coverage declaration | 100 % | **0 %** (v1 did not ask) | **0 of 2 formal** (both launched before v2); **1 of 2 de facto** (integration-step § 3, "what I checked and what held") | **3 of 3** (v2.1; including the guests re-review). Sweep 38/49 applicable probed or code-read (11 not probed: budget); re-review 37/37 declared, 24 probed | **2 of 2** (re-review #3 § 7; infra § 3: 57 patterns, 0 applicable left unprobed) |
| L2 | Recommendation defects (RC-9) per review | 0 | identity review 1: **1** (E-001) | identity review 2: **3** (E-048, E-050, E-051) | integration-step review 1 (v1): **2** (E-073, E-074). v2.1 recommendations: measured next round | v2.1 recommendations (sweep, re-review #2): **0** confirmed. 1 possible: ADR-0015 Amendment 1's wording mixed staff permission with cardholder consent (re-review #3 § 8); authorship not traced |
| L2 | Identity: new P0+P1 per review (convergence) | → 0 | review 1: **10**; review 2: **4** | review 3: **2** (all fix-related) | merged (spot-check passed W-1…W-3) | — |
| L2 | Output tokens per P0/P1 finding | — | **≈ 19k** (2.13M ÷ 111) | integration step **≈ 82k** (244,791 ÷ 3); identity 3 **≈ 127k** (254,826 ÷ 2). Cost per defect rises as defect density falls, which is expected | sweep **≈ 47k** (187,470 ÷ 4); re-review **≈ 84k** (252,872 ÷ 3) | Re-counted per message (E-116): re-review #3 **≈ 63k** (126,075 ÷ 2); infra **≈ 58k** (173,698 ÷ 3). Earlier columns are ≈ 2× high; corrected: R0 ≈ 9.6k, R1 integration step ≈ 36k, identity 3 ≈ 60k, R2 sweep ≈ 22k, re-review #2 ≈ 41k |
| L3 | Scenarios passing on real providers / total | 20 of 20 | **not yet run** (integration step running) | **12 of 20** claimed (S01, S03–S08, S13–S17); **1 overclaimed** (S04, E-042); 8 todo-only. Binding manifest and assertion map not yet produced (v2 not in force) | **12 of 20**, with the binding manifest and assertion map produced (v2 adopted); S04 closed. 0 L3 escapes | — (integration step not merged; fix round 3 done 22:07, re-review #4 running) |
| L4 | Valid screenshot citations | 100 % | **89 %** (68 of 76) | — (no L4 round). Round-1 evidence repaired: the six `x-0*` files restored and `p2-08` marked invalid (`8ed5bf8`) | — (no L4 round; UX round 2 deferred) | **100 %** (74 of 74; hand-off check H-1) |
| L4 | Findings with stable IDs | 100 % | **0 %** | | — | **100 %** (49 of 49, `R2a-…`) |
| L4 | Refiner: invalid evidence propagated | 0 | **1** | | — | — (no refiner run) |
| L4 | Refinements accepted ÷ decided | — | **pending** (no `decisions/` yet) | backoffice/ui: **32 of 32** accepted or adapted (29 accepted, 3 adapted, 0 rejected); rules C1–C12: 10 accepted, 2 adapted. Other modules' 51 decisions pending. Acceptance is not outcome: round 2 measures outcomes | Unchanged. **8 refinements marked "Done"** in `decisions/backoffice.md` are awaiting L4 confirmation | — (no refiner run). **New:** round-1 "Done" claims re-tested by 2a: **4 of 7 refuted** (§ 4.1) |
| L5 | Parity rows downgraded by later reviews (overclaims) | 0 | **≥ 8** *(est.)* | 0 found. **Under**-claims found: inventory and reservations at 1 % `tested` against dozens proven, and `COVERAGE.md` showing rates at 2 % against 61 % (E-060) | **0**. Parity-ops v2: 179/179 `tested` rows quote an assertion; 17 self-downgraded. Under-claims still open: inventory 1 %, reservations 1 % (E-060) | **0** matrix rows. **13** rows the inventory README called tested (E-111), downgraded by the re-run itself |
| L5 | Share of edge cases added after review | ≤ 10 % | rates **31 %**, payments **19 %** | | parity-ops: no review yet | 0 added by reviews. The re-run's own sweep added 21 (inventory) and 28 (reservations): 38 % and 35 % of the new totals |
| L5 | Built modules with no parity matrix | 0 | **4** (operations, guests, integration, identity) | **4** on main (parity-ops resumed 17:03 and 17:38; operations and guests matrices on its branch) | **0** (parity-ops merged 18:02) | **0** |
| L5 | Scope gaps found by the owner | 0 | **1** (E-024) | **0** | **0** | **0** (the Channex-readiness direction re-prioritised existing scope, D7) |
| Canaries | Recall measured by canaries | — | **no runs** (usage constrained) | L1: C-L1-01 **1/1** (orchestrator); `r1-l1` **5/7** (gaps: `sql.raw`, comment false positive). No L2 or L4 canary yet | L3: `r2-l3` **1/1** (C-L3-03a); C-L3-03b has no check (expected miss) | L1-BSC proof: `r3-l1` **5/6** mutants killed (the collection lock survives, E-114) |
| L-orch | Escapes whose earliest loop is the orchestrator | 0 | **5** (after reclassification: E-010, E-019, E-027, E-032, E-036) | **3** (E-055, E-057, E-060) + 3 contributing (E-040, E-043, E-048) | **2** (E-080, E-081) | **3** (E-104, E-105, E-117) + 3 contributing (E-108, E-115, E-116) |
| All | Fix-related share of escapes (introduced, residual, or recommendation-induced) | ↓ | 7 of 38 | **12 of 24 (50 %)** | **17 of 23 (74 %)** | **15 of 32 (47 %)**; **15 of 15** among escapes found by re-checking fixed work |
| L1-BSC | Shared-vocabulary copies (BS3-1) / optional scope parameters on ports (BS3-3) | 0 / 0 | — | **6** provenance literals in 5 modules, plus 1 local `ModuleUnavailableError`; **22** matches of the BS3-3 grep (finance `service/index.ts`: 5) | Unchanged on main (6 provenance literals; platform copies self-reported by identity round 4). Finance scope is now required on the integration-step branch | not re-measured (the fix round reported 2 new copies: reservations' `basis` enum, `bookingPeople` payer mapping) |
| L4 | Round-1 "Done" claims refuted when re-tested | 0 | — | — | — | **4 of 7** (NAV-07, NAV-08, C3/C9, FD-13/C4) |
| L4 | Findings with a disposition (routed, mapped to a refinement, acceptance check, or rejected with a reason) | 100 % | — | — | — | **20 %** (10 of 49; majors 10 of 23) |
| L1-BSC | Guard elements of a fix round with no test that fails without them (mutation canary) | 0 | — | — | — | **1 of 6** (integration-step fix round 2) |
| L1-BSC | Prose claims contradicted later (README, runbook, "Done", self-check "yes", parity list) | 0 | — | — | — | **13** (E-087, E-096 … E-102, E-106, E-107, E-109, E-110, E-111) |

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
| 14 | **fix re-attack sweep** (round 2) | **v2.1** (focused re-review variant, from the playbook) | 17:58–18:15 | 17 | 294 | 180 | 187,470 | 80.0M | 0/4/4/2 (new); 56 original attacks re-run: 48 refused | residuals: payments, guests |
| 15 | integration step re-review (round 2) | **v2.1** (focused re-review variant) | 18:07–18:29 | 22 | 220 | 135 | 252,872 | 50.2M | 0/3/4/5 (new); 9/9 original PoCs refused | merge after fixes |
| 16 | guests erasure fix re-review (round 2) | **v2.1** (focused re-review variant) | 18:37–18:53 (commit `ddc4a85`) | 16 | 80 *(per message)* | 83 | 88,511 *(per message)* | 12.8M *(per message)* | 0/0/4/5 (new); original PoC refused (410, no PII) | merge after fixes |
| 17 | integration step re-review #3 (round 3) | **v2.1** (focused re-review variant) | 21:14–21:37 | 23 | 128 *(per message)* | 132 | 126,075 | 29.8M | 0/2/4/4 (new); 9/9 first-review PoCs, 9/9 re-review-#2 findings and 4/4 sweep PoCs refused | merge after fixes |
| 18 | **infra** security review (round 3, first review) | **v2.1** | 21:14–21:50 | 36 | 137 *(per message)* | 146 | 173,698 | 41.3M | 0/3/11/12 | merge after fixes |

### 3.2 Quality per run

| # | Run | Precision P0+P1 (acted ÷ raised) | Escapes attributed | Recall P0+P1 *(est.)* | Evidence (R/L/I) | PoCs preserved in repo | Notes |
|---|---|---|---|---|---|---|---|
| 1 | guests | **8/8** (all fixed; MUSTs R14/R15/R19/R20 marked Partial) | **R2: E-067** (SW-GUE-1, P1: detected as FR-1 but not connected to G-P0-1); **E-083** (P2, concurrent write survives erasure) | **≈ 0.80** (8/10; measured by the sweep and the guests re-review) | 3/3 (probes in scratch) | no (regression tests in the module) | Reported a flaky suite (57P01, E-016) with 4 re-runs: good practice. Assessed every foundation request |
| 2 | inventory | **8/8** | 0 | unmeasured | 3/3 (CE1–CE8; 7 reproduced, CE4 shown safe) | no (became `regression-review.test.ts`) | Reported what held as well as what failed |
| 3 | rates | **11/11** (R-10 deferred with a reason; R-19 flagged "not verified" and confirmed real, `944ff0f`) | 0 | unmeasured | 3/3 (scripts on pure functions) | no | Re-ran typecheck uncached. Honest about what it had not verified |
| 4 | payments | **15/15** | 0 defects at R0 (E-011 drift detected as a note); **R2: E-065** (SW-PAY-3, P1 recall miss); E-063, E-064 and E-066 are fix residuals (L1-BSC) | **≈ 0.94** (15/16; measured by the sweep) | 3/3 (`zz-steward`, `zz-finance-binding`) | no | Bound to *real* finance in a copy: a strong cross-module technique |
| 5 | operations | **14/14** (P1-5/6/8/11 deferred with reasons) | 0 | unmeasured | 3/3 (16 tests asserting defects) | no | Bound to *real* inventory in a copy |
| 6 | reservations | **17/17** (contract items moved to the integration step) | 0 | unmeasured | 3/3 (11 experiments; port-vs-provider table) | no | Its port-vs-provider table became the integration plan |
| 7 | integration | **9/9** | 0 | unmeasured | 3/3 (PROBE-1…10) | no | Also showed which probes *held* (1, 4) |
| 8 | finance | **12/12** (F-10 not built; F-12 owned by parity) | E-037 (process); detected E-011 drift, not tracked | unmeasured | 3/3 (probes + `typecheck/compat.ts`) | no | Ran the parity gate in another agent's worktree (E-037) |
| 9 | identity-plus (1st) | **10/10** (2nd review: all 11 original attacks closed) | **E-001 (P0), E-002 (P1)** | **≤ 0.83** (10 ÷ 12) | 3/3 (PoCs) | **yes** (`reviews/identity-plus-poc/`) | Its own fix recommendation enabled E-001 (RC-4) |
| 10 | backoffice UI | **7/7** (resolved in round 1: P0 cache leak and all P1 fixed; merged at 17:22). 2 of 7 were also independently corroborated by L4 | **E-025…E-031** (1 P1, 6 P2) | P0+P1 **≤ 0.88** (7 ÷ 8); all severities **≤ 0.83** (35 ÷ 42) | 3/3 (Playwright probes, screenshots, prototype diff) | partly (`reviews/backoffice/`) | Brief limited widths to 1280–1920 (E-027 root cause) |
| 11 | identity-plus (2nd) | **4/4 accepted** (ADR-0017 Amendment 1; fix round 3 running) | 0 so far (3rd review pending) | unmeasured | 3/3 (PoCs, HTTP PoC) | **yes** | Found RC-1's root cause (R2-P2-6). Exit codes captured directly. **Round 1:** review 3 confirmed all 9 of its attacks closed. Its own recommendations led to 3 later defects (E-048, E-050, E-051; RC-9) |
| 12 | integration step | **3/3** P1 fixed (and all 7 P2s; 7/9 P3s, 2 deferred; round 2) | E-073, E-074 (recommendation defects, RC-9) | no recall miss found by the re-review | 3/3 (7 PoCs kept in `reviews/integration-step-poc/`) | **yes** | Found residuals of 3 merged fixes (E-039, E-045, E-046). Its § 3 "what I checked and what held" is a de facto coverage declaration. Noted that the global consistency checks would miss P1-1 and P1-3. Ran gates on two merged copies as `main` moved |
| 13 | identity-plus (3rd) | **2/2** P1 fixed (and all P2/P3; merged 18:36 after the spot-check) | 0 so far | unmeasured | 3/3 (W-1…W-6, plus 20 re-runs inverted) | **yes** | Used a test-only `pg_sleep` trigger to make a 50–100 ms race deterministic: a reusable technique (AP-56). Found the superuser test-environment gap (E-052) |
| 14 | fix sweep | **4/4** P1 fixed (round 3: SW-PAY-1, 3, 4 refused in re-review #3; SW-GUE-1 merged 19:09) | 0 (its SW-PAY-2 attack-on-the-fix line was not implemented by the builder: E-088, L1-BSC) | unmeasured | 3/3 (5 PoCs in `fix-sweep-poc/`, each asserting the safe outcome) | **yes** | **First v2.1 run.** Covered 15 P0 and 41 P1 fixes across 9 modules in 17 minutes. Its exemption audit (round-1 edit 1a) produced SW-PAY-2 and SW-PAY-4. It proposed one test per sibling entry point; builder v4 generalizes that to writers |
| 15 | integration-step re-review | **3/3** P1 fixed (round 3: re-review #3 inverted all 9 findings) | 0 | no miss found by re-review #3 (its P1s are in fix-round-2 code) | 3/3 (r2 PoCs: 9 inverted, 11 attacks) | **yes** | Every P1 came from a v2.1 step (§ 6 steps 2–6). Stated each fix as a principle with instances, and attacked each fix's boundary |
| 16 | guests erasure re-review | n/a (0 P0/P1); P2 **4/4** acted on (R2-P2-1, 2 fixed with 14 mutations; P2-3 FR-10; P2-4 README) | 0 | unmeasured | 3/3 (2 new PoC files, 14 tests, plus a 50,000-row benchmark) | **yes** | Coverage declaration present. Checked the builder's claims verbatim (3 claims: 1 holds, 2 hold with defects). Found a pre-existing concurrency defect (E-083) that the sweep had marked not applicable because of AP-56's wording |
| 17 | integration-step re-review #3 | pending (fix round 3 done 22:07; re-review #4 running) | — | — | 3/3 (r3 PoCs: 3 inverted suites, 9 attacks) | **yes** | Every P1 came from going one step beyond the builder's § 5 table: exits of the record (R3-P1-1) and readers of a stored control fact (R3-P1-2). Its § 4 re-attacked all 7 builder exemptions (3 unsafe) |
| 18 | infra (security) | pending (fix round queued) | — | unmeasured | 3/3 (8 PoC files; three `terraform test` runs that pass when they should be refused; a 14-defect mutation run of the drill SQL) | **yes** | First review of infrastructure. Declared 57 patterns (38 applicable, 0 left unprobed). Made no AWS call and said which statements are code-read against AWS documentation. Ran mutation against the builder's own checks (P2-4) |

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
| Black-box tester R2a (focused) | **v2** | 21:16–21:49 | 33 | 104 *(per message)* | 141 | 98,595 | 20.0M | 4 personas (desktop, tablet, phone; light and dark); 49 findings (23 major, 21 minor, 5 polish; 17 tagged LIVE, 30 SIM, 2 mixed); top 20; top 10 strengths | No refiner. Dispositions: **10 of 49** (E-105) | **74/74** citations valid (H-1), 0 duplicate hashes (H-2), stable IDs 49/49, evidence manifest present. The tester had no round-1 baseline (by design) | Focused scope: sign-in, arrivals, departures, Today tiles, permission honesty, language | 0 |

### 4.1 Round-1 "Done" claims re-tested by UX round 2a

Claims from `docs/ux/round-1/decisions/backoffice.md` that round 2a's tasks exercised.

| Claim ("Done now") | 2a evidence | Verdict |
|---|---|---|
| NAV-05: navigation fits 1024–1440, no overflow at 1024 | No horizontal overflow reported at 1024 (P1 and P4 tablet runs). Column priority hides Balance and Attendant (R2a-P1-F15, P4-F06), a separate question | **Confirmed** (as stated) |
| NAV-07: Today tiles use the same queries as their lists | Exceptions and payments tiles open one unfiltered list; occupancy opens a generic timeline (R2a-X-F01) | **Refuted** (E-107) |
| NAV-08: field validation in staff language | Empty property Name → "This screen ran into a problem" (R2a-P7-F01), the E-025 reproduction | **Refuted** (E-106) |
| NAV-12: switcher's accessible name has the property and business date | Header always shows property, code and business date (P7 Task 2) | **Confirmed** |
| FD-03: never "Paid" while money is due | No "Paid" chip next to a balance reported; "estimate" under every balance (R2a-P1-F09) is a separate finding | **Confirmed** |
| FD-13 / C4: Enter, e, j, k, x; Esc returns focus to the row | 25 Tabs before j/k work; Esc returns to the first row opened (R2a-P1-F06, F07) | **Refuted in part** (E-110) |
| C3 / C9: in-house never "Ready"; sample data made consistent | Arrivals "Ready / Inspected" in villas with in-house departing guests; housekeeping board disagrees (R2a-P1-F01, P4-F01, P4-F02) | **Refuted** (E-109) |

`docs/ux/scorecard.md` has no R2a column yet (E-105); the table above is the quality steward's reading, not the UX
loop's own measurement.

---

## 5. L5 — market and parity

| Run | Playbook | Window (UTC) | Active min *(est.)* | Turns | Tools | Output tok | Input tok | Output | Overclaims found later | Catalogue recall signals | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Parity front (inventory, rates, reservations, groups, distribution, platform) | v1 | 08:12–11:30 | ≈ 37 | 169 | 103 | 360,288 | 44.9M | 6 matrices, **493** capabilities, **222** edge cases, `gaps-front.md`; 387 links opened, 1 dead link fixed | none reported (only platform had `tested` rows) | Rates: +6 capabilities and +16 edge cases after review (**31 %** of edge cases). Inventory: about 6 real P0 rows missing (INV-08, E-022) | Wrote "code on main: none" correctly at the time; matrices went stale when the code merged |
| Parity finance (finance, payments, day-close, accounting, fnb-pos, procurement, stock, analytics) | v1 + the "compare with unmerged branches" instruction | 08:12–11:42 | ≈ 49 | 239 | 154 | 562,119 | 84.1M | 8 matrices, **703** capabilities, **329** edge cases, `gaps-finance.md` | **≥ 8** *(est.)*: finance F-12 "several" (PAR-FIN-132/133 and others); payments P2-13 (4 rows) (E-019) | Payments: +8 capabilities and +13 edge cases after review (**19 %**) (E-021) | Told the orchestrator plainly that it cited unmerged branches: the honesty was good, the evidence rule was weak |
| Parity ops, resumed (10 modules; round 2) | v2 rules (brief: v1 file + "tested needs a test that proves it") | 17:03–18:02 | ≈ 59 | 387 | 197 | 989,478 | 165.8M | 10 matrices, sweep record for 10 of 10 modules; Q157 | 17 self-downgraded (PR2-1 at source) | PR2-2 applied to 10 of 10 | Found 2 new P0 foundation gaps (re-check of trial → live effects at execution; external-identifier uniqueness). No module passes the gate yet |
| Parity ops (10 modules) | v1 | launched 08:12, paused | 0 | 0 | 0 | 0 | 0 | **nothing delivered** (deferred for usage) | — | — | **Coverage gap.** operations, guests, integration and identity are built with no matrix, so their parity gate cannot run |
| Gap strategist, run 1 | v1 | 16:42–17:09 | 27 | 203 | 125 | 368,530 | 62.3M | `gap-plan.md` (14 platform moves) and 32 module 10x briefs; Q150–Q155 | — | Found 4 measurement problems: parity under-claims, a stale `COVERAGE.md`, 16 modules with no parity file, and the `ACC-R` prefix collision (E-060, E-061) | Acted as a checker of the checkers. Briefs adopted for module round 2 (STATUS queue). Journey walks (GS2-1) not used (v1) |
| Parity evidence re-run (inventory, reservations; round 3) | **v2** (PR2-1, PR2-2) | 21:14–21:42 | 28 | 101 *(per message)* | 126 | 182,750 | 34.9M | Inventory 1 % → 42 % tested, reservations 1 % → 9 %; 49 new edge cases from the failure-class sweep; 8 findings and a decision table (EC-INV-017 decided 21:42) | 0 so far. It downgraded 13 rows the inventory README called tested (E-111) | Every `tested` row quotes its assertion: 45/45 and 21/21, checked by a script | Held reservations at `built` where a fake decides the outcome (AP-51). Cited the unmerged branch only as `built (branch@sha)` |

## 6. L3 — scenario proof

| Run | Playbook | Window | Status |
|---|---|---|---|
| Integration step (bind ports, then S01–S20) | v1 | 16:16– (running) | No report at round 0. Not scored. The first L3 result is the baseline for "scenarios passing on real providers" |
| Integration-step fix round (round 2) | v2 | 17:38–18:07 | Binding manifest (no module fakes; access simulated), an assertion map for 12 scenarios, both gate commands, and the 5 slowest tests. S04 fixed. A cross-module stray-deposit check was added and confirmed by canary C-L3-03(a). **No L3 escape this round** |
| Integration step: result (round 1) | v1 | 16:16–17:04 (533 turns, 331 tools, 492,418 output tokens at the report) | **12 of 20** scenarios passing, with global consistency checks run in 12 of 12 files (verified by the reviewer). 5 contract bugs found by binding for real. Escapes: **E-042** (S04 overclaim; the first L3 escape); E-039, E-040, E-041, E-043, E-044 (L1-BSC). Precision of the scenario claims: 11 of 12 proven (S04 overclaims), per review § 7 |
| Integration-step fix round 2 (round 3 data) | v3 (ST3-1, ST3-2) | 18:29–19:28 | Gates green on the merged tree (api 117 passed, 29 todo). No L3 escape. Harness gap E-093: `makeExternal` completes the authority transition with empty platform ports |

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
| **R3:** latent gate gaps | 2 | E-094 (`pnpm lint` exits 0 on warnings); E-095 (infra checks run by hand, in no CI job) | Retro edit 6; canary C-L1-07 |
| **R3:** fix-round guard with no failing test (mutation) | 1 of 6 | E-114 (the collection lock) | Canary `r3-l1`; builder v5 BS5-7 |

## 8. Canary runs

| Run id | Date | Checker / version | Set | Planted | Credit | Recall | Notes |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | Round 0: none (usage constrained; `canaries.md` § 5 has the schedule) |
| c-l1-01-orch | 2026-11-07 17:30 | L1 gate (after edit 6) | C-L1-01 (`apps/api`) | 1 | 1 | 1.00 | Run by the orchestrator. Closes E-038 |
| r1-l1 | 2026-11-07 17:40–17:47 | L1 gates and tools | C-L1-02, C-L1-03 | 7 | 5 | 0.71 | Run by the quality steward, CPU only. Missed: `sql.raw` (E-059); comment false positive (E-013) |
| r2-l3 | 2026-11-07 ≈18:52–18:56 | L3 consistency checks (`feat/integration-step`) | C-L3-03(a) | 1 | 1 | 1.00 | CPU and local Postgres. The new stray-deposit check catches the R2-F plant |
| r3-l1 | 2026-11-07 22:01–22:04 | L1-BSC proof of a fix round (`feat/integration-step` @ `db6ae8c`, then `7b0c59c`) | C-L1-06: 6 mutants, one guard element each | 6 | 5 | 0.83 | CPU and local Postgres. Survivor M4: the collection lock (E-114). The pre-fix-commit method had reported invariant (d) as proven |

## 9. Orchestrator (L-orch, from round 1)

The orchestrator is measured with the counters in `playbooks/orchestrator.md` § 2.

| Counter | R0 | R1 | R2 | R3 |
|---|---|---|---|---|
| Escapes whose earliest loop is L-orch | 5 (reclassified) | 3 (E-055, E-057, E-060) | 2 (E-080, E-081) | 3 (E-104, E-105, E-117) |
| Escapes where the orchestrator contributed | 1 (E-011) | 3 (E-040, E-043, E-048) | 0 | 3 (E-108, E-115, E-116) |
| Briefs deviating from the playbook, or restating claims more broadly | — | ≥ 2 | 0 found | 0 found. The fix-round-3 brief added external writers and a state machine before any playbook asked (ahead of v5) |
| Commits containing another agent's unfinished files | — | 2 (`1179c98`, `012652e`) | 0 (WIP explicitly labelled) | 0 unlabelled (the infra review's WIP checkpoints `1dfa41b`, `80b9fa3`, `285a947` are labelled) |
| Evidence files lost at hand-off | 6 | 0 | 0 | 0 (H-1: 74/74) |
| Chronicle correction batches | — | 1 | 4 single corrections (1–6 min) | 0. Every entry since 18:58 carries a source token, and all 10 agent and commit tokens match (through 22:08). 3 of 5 `now` tokens date the record, not the event (E-115) |
| Stale generated artifacts found later | — | 1 | 0 (but E-060 rows still stale) | 1 (agent briefs and reports, last extracted 18:45: E-117). `COVERAGE.md` refreshed in the parity merge |
| Applied quality edits ÷ proposed | — | **8 of 8** (round-0 edits, `8ed5bf8`); one verified by canary C-L1-01 | **6 of 6** (round-1 edits, `722b345`, 1 min after merge) | **7 of 7** (round-2 edits: `ec5dd3a`, 1 min after the report, plus the fix-round briefs for edit 3). Edit 5 named refiner v2 for round 2a; the refiner was then skipped by a recorded decision (E-105) |
| Time from review report to fix-round launch | — | identity 3: ≈ 5 min (report 17:30:16, timeline 17:35). Integration step: the timeline logs the verdict at **17:24**, but the reviewer finished at **17:26:52** (`agents.json`). Either the time is estimated (E-055 class), or the orchestrator acted on the unfinished report swept into `main` at 17:24 (E-057 class). **To verify in round 2** | | re-review #3: report 21:37:42, brief to the builder 21:38:32 (< 1 min). Infra: fix round queued at 21:51 |

## 10. Corrections (append-only)

- **2026-11-07, round 1 (E-056).** In round-0 rows 11 (identity-plus 2nd) and the refiner, the times and costs were
  estimates or figures cut off by the extraction. The final values from `agents.json` are below; the round-0 rows are
  kept unchanged.

| Run | As written in round 0 | Correct |
|---|---|---|
| identity-plus (2nd), row 11 | 16:15–16:52; ≥ 23 min (≈ 37 to the verdict); ≥ 196 turns; ≥ 99 tools; ≥ 278,744 output; ≥ 51.9M input | **16:15–16:43**; **28 min**; **235** turns; **118** tools; **347,021** output; **68.0M** input |
| UX refiner R1 (§ 4) | 16:16–≈16:58; ≥ 21 min (≈ 42 to delivery); ≥ 104 turns; ≥ 67 tools; ≥ 299,494 output; ≥ 20.3M input | **16:16–16:43**; **27 min**; **123** turns; **78** tools; **428,145** output; **27.2M** input |
| Turbo cache fix `1be3ddc` (cited in § 7) | 17:00 | **16:44** |

- **2026-11-07, round 3 (E-116).** Costs re-counted once per API message (`canary-scripts/r3_costs.py`). The rows
  above keep the values as first written; these are the corrected ones. Tool counts were right and are not repeated.

| Run (§) | Turns → messages | Output tokens | Input tokens incl. cache |
|---|---|---|---|
| 1 guests (3.1) | 173 → **99** | 150,363 → **80,550** | 43.4M → **25.1M** |
| 2 inventory | 145 → **83** | 175,535 → **89,359** | 32.1M → **18.5M** |
| 3 rates | 129 → **69** | 182,110 → **98,667** | 29.4M → **16.0M** |
| 4 payments | 241 → **134** | 212,362 → **109,287** | 63.8M → **35.4M** |
| 5 operations | 209 → **115** | 241,151 → **116,472** | 57.5M → **31.6M** |
| 6 reservations | 301 → **171** | 251,546 → **115,946** | 85.1M → **48.1M** |
| 7 integration | 221 → **127** | 206,237 → **106,380** | 59.9M → **33.9M** |
| 8 finance | 227 → **125** | 241,213 → **113,866** | 63.5M → **35.0M** |
| 9 identity-plus (1st) | 248 → **140** | 237,251 → **120,149** | 70.3M → **39.4M** |
| 10 backoffice UI | 289 → **163** | 232,105 → **114,193** | 77.5M → **43.9M** |
| **First round (1–10)** | 2,183 → **1,226** | 2,129,873 → **1,064,869** | 582.5M → **326.9M** |
| 11 identity-plus (2nd) | 235 → **112** | 347,021 → **139,739** | 68.0M → **31.6M** |
| 12 integration step | 295 → **149** | 244,791 → **108,602** | 77.0M → **38.4M** |
| 13 identity-plus (3rd) | 144 → **77** | 254,826 → **119,076** | 29.5M → **15.3M** |
| 14 fix sweep | 294 → **174** | 187,470 → **89,091** | 80.0M → **47.9M** |
| 15 integration-step re-review | 220 → **126** | 252,872 → **124,069** | 50.2M → **28.1M** |
| Black-box tester R1 (4) | 256 → **148** | 168,642 → **86,541** | 44.0M → **25.3M** |
| UX refiner R1 (4, as corrected in round 1) | 123 → **61** | 428,145 → **175,562** | 27.2M → **13.2M** |
| Parity front (5) | 169 → **95** | 360,288 → **180,026** | 44.9M → **25.0M** |
| Parity finance (5) | 239 → **125** | 562,119 → **233,253** | 84.1M → **43.1M** |
| Parity ops, resumed (5) | 387 → **168** | 989,478 → **336,587** | 165.8M → **71.6M** |
| Gap strategist (5) | 203 → **103** | 368,530 → **166,927** | 62.3M → **31.2M** |
| Quality steward rounds 0 + 1 (11) | 364 → **183** | 833,568 → **314,621** | 160.2M → **79.7M** |

## 11. Meta loop (L8): the quality steward's own cost and escapes

| Round | Window (UTC) | Turns | Tools | Output tokens | Input tokens | Escapes attributed to L8 | Canaries run |
|---|---|---|---|---|---|---|---|
| 0 + 1 | 16:54–17:57 (`agents.json`, both rounds in one record) | 364 | 210 | 833,568 | 160.2M | 1 (E-056) | `r1-l1` (CPU) |
| 2 | 18:43–18:57 | 43 *(per message)* | 50 | 82,305 | 33.2M | 1 found later (E-115: the `now` source my `when.py` design left in) | `r2-l3` (CPU and local Postgres) |
| 3 | 21:51–≈22:35 (still running at this write) | ≥ 120 *(per message)* | ≥ 121 | ≥ 106,764 | ≥ 35.0M | 2 found by itself (E-115, E-116) | `r3-l1` (CPU and local Postgres), plus three scripted checks: times, dispositions, costs |
