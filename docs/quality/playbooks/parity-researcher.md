# Parity researcher (L5) — playbook

| | |
|---|---|
| **Current version** | **v2** (2026-11-07, round 0) |
| **Theme of v2** | Gate truthfulness: no status above its evidence, and no failure class missing from the edge cases |
| **Previous** | `archive/parity-researcher-v1.md` (the shared brief, a launch example, and the mid-run "compare with unmerged branches" instruction) |
| **Launch** | The orchestrator fills the **Run parameters** and hands over the **Launch brief**. The next use is resuming parity-ops (operations, guests, comms, resort, access, guest-experience, crm, identity, integration, ai), which was paused for usage on day 1 |
| **Measured by** | `scorecard.md`: rows downgraded by later reviews (overclaims); edge-case rows added after a review (catalogue recall); canaries C-L5-01/02 |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Shared brief: official documentation first; ≥ 30 edge cases per core module; statuses compared with specs and code; gap files | Baseline | — | Round-0 scorecard |
| v2 | 2026-11-07 | **PR2-1** | **`tested` needs an asserting test on `main`.** Quote the `file:line` of the assertion that proves the row. A test on an unmerged branch caps the status at `built`, with `branch@sha` in the evidence. A test that only exercises the happy path, or runs sequentially where the row is about concurrency, is not `tested` | Reviews found rows marked `tested` for behaviour that was not built or not proven (finance F-12; payments P2-13: PAR-PAY-006, EC-PAY-012, EC-PAY-015 "sequential only", PAR-PAY-009). The v1 mid-run instruction pointed at unmerged branches. An overclaimed P0 row lets the parity gate pass | E-019 | Rows downgraded by later reviews: round 0 had ≥ 8 (finance "several" plus 4 in payments); target 0. Canary C-L5-01 |
| v2 | 2026-11-07 | **PR2-2** | **Failure-class sweep.** For each module, walk the classes in `docs/quality/patterns.md` groups A–D (isolation, money, events/concurrency, contracts, effective-dated data) and add an edge case for each applicable class with its exact expected behaviour, or record "N/A: reason" in the gap file | 31 % of the rates edge cases and 19 % of the payments edge cases were added *after* review. The inventory review named real P0 rows that were missing. The catalogues came from competitor features, not failure classes | E-020, E-021, E-022, E-023 | Edge-case rows added after the next review, as a share of the catalogue (round 0: rates 31 %, payments 19 %); canary C-L5-02 |

### Round-2 measurement: v2 works (no version change)

Parity-ops (10 modules) ran on v2:
- **PR2-1:** all 179 `tested` rows quote an asserting line on `main`, and the researcher downgraded 17 over-claimed rows
  itself.
- **PR2-2:** a failure-class sweep record for **10 of 10** modules (`docs/parity/gaps-ops.md` § 5), with applied,
  covered and N/A classes.

No later review has downgraded a parity-ops row yet.

**Still open:** E-060 under-claims in matrices written before v2. Inventory and reservations show 1 % `tested` on
`main`. Re-run v2's PR2-1 on those matrices (retro, edit 6).

### Queued for later versions (one theme each)

- **v3, journey cross-check.** Cross-check each matrix against the journey walks in the gap strategist's plan
  (GS2-1), so that no step has a matrix row in no module.
- *(Round 1: the evidence for this item, E-060, showed the refresh is a merge-procedure step. It moved to the orchestrator
  playbook, O2-4.)* **v4, refreshing after merge.** When a module merges, re-verify its `built` and `tested` rows within the same merge
  batch. Rows that cite branches are re-pointed to `main`, or downgraded.

---

## Run parameters (filled by the orchestrator)

```
WORKTREE / BRANCH:  /home/user/wt/parity-<cluster> (docs/parity-<cluster>)
CLUSTER / MODULES:  <cluster>: <module list with spec locations>
QUESTION RANGE:     Q<from>–Q<to> in docs/OPEN_QUESTIONS.md
BASELINES:          <primary competitor documentation for this cluster>
CODE TO COMPARE:    main only (branches may be cited as `built (branch@sha)`, never `tested`)
```

## Launch brief (v2)

v2 is the v1 shared brief (`archive/parity-researcher-v1.md`, Part 1) with two bullets replaced and one section added.

**Replace the "Status" bullet** in "What 'complete' means for your matrices" with:

````text
- **Status:** compare with the specs and code on `main`:
  - `specified` if the spec covers it, `missing` if not;
  - `built` only with code on `main` (or on a named branch, written `built (branch@sha)` in the evidence column);
  - `tested` only when a test on `main` **asserts** the row's behaviour. Quote the asserting line as `file:line` in the
    evidence column. A test that only touches the happy path, or that is sequential where the row is about
    concurrency, does not count. Do not overclaim. When unsure, use the lower status and say why.
````

**Replace the "Edge cases" bullet** with:

````text
- **Edge cases:** at least 30 per core module — failures, timing (midnight, business date, DST, time zones),
  concurrency, money corrections, data errors, partial outages, unusual guests/requests, legal/tax events,
  Maldives realities (seaplane daylight limits, island supply delays, USD/MVR). Each with precise expected behavior.
  **Then sweep the failure classes** in docs/quality/patterns.md groups A–D for each module: for every class that
  applies (for example cross-property reference, concurrent over-correction, lost or out-of-order events, uncertain
  outcomes, data-authority bypass, effective-dated data without bounds), add at least one edge case phrased in this
  module's terms with its exact expected behavior. For classes that do not apply, write "N/A: reason" in the gap file.
````

**Add before the final reply:**

````text
## Self-check before you reply (v2)
- Count your `tested` rows. Each must quote an asserting line on main. List any row you downgraded and why.
- For each module, list the patterns.md classes swept: applied (edge-case ids) / N/A (reason).
Final reply additions: tested rows with assertion quotes / total tested; classes swept per module.
````
