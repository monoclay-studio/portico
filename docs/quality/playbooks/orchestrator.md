# Orchestrator — playbook

| | |
|---|---|
| **Current version** | **v4** (2026-11-07, meta-loop round 3) |
| **Theme of v4** | **Records and routing checked against their source.** What the orchestrator records (a default, a time, an agent's report) or routes (a checker's findings) is checked against the thing it describes: the code, the event, the transcript, the findings file. v3 (mechanisms over memory) and v2 (exact hand-offs and records) stay in force |
| **Theme of v3** | Mechanisms over memory: the two process escapes that recurred under a v2 rule are replaced by tools and guards (derived and verified times; safe history). v2 (exact hand-offs and records) stays in force. **v2 theme:** Exact hand-offs and records: what the orchestrator passes on (briefs, claims, files, commits) or records (times, generated artifacts, notes) is exact, complete and checked |
| **Previous** | `archive/orchestrator-v3.md` (v3); `archive/orchestrator-v2.md` (v2); `archive/orchestrator-v1.md` (reconstructed from the procedures the orchestrator followed on day 1) |
| **Launch** | The main session reads this file at each resume and before every launch, hand-off, commit to `main` or merge. The quality steward measures it like any other checker (`../scorecard.md` § Orchestrator) |
| **Measured by** | Escapes whose earliest loop is the orchestrator (`../escapes.md`, loop `L-orch`), plus the process counters in § 2 of this file |

## Why the orchestrator has a playbook

The orchestrator is a loop as well. On day 1 its own steps were the earliest point at which 8 escapes could have been
caught, after the round-1 reclassification (`../escapes.md` § Counts):

| Escape | What the orchestrator's step did |
|---|---|
| E-010 | Piped lint output; failing commits reached `main` |
| E-019 | A mid-run instruction weakened the parity evidence rule |
| E-027 | A review brief narrowed the viewports to desk widths |
| E-032 | A compress-and-copy hand-off lost six screenshots |
| E-036 | A brief asked for a file type that the harness refuses |
| E-055 | Estimated timestamps were written into the chronicle |
| E-057 | A broad `git add` swept a running reviewer's unfinished report and PoC files into `main` |
| E-060 | Parity statuses and the generated `COVERAGE.md` went stale after merges |

It also contributed to three more:
- E-011: cross-module notes were not tracked;
- E-043: a brief restated a builder's claim more broadly than the builder had made it;
- E-048: the ADR rule enumerated fields instead of stating a principle.

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | The day-1 procedures (archive) | Baseline | — | Round-1 reclassification: 8 L-orch escapes |
| v2 | 2026-11-07 | **O2-1** | **Exact briefs.** Launch checkers only from the playbook's launch brief, with run parameters. Take scope parameters (viewports, devices, roles) from the personas and specs, never chosen ad hoc. Quote the builder's claims **verbatim** and attribute them. Never change a checker's evidence rule in a mid-run message: change the playbook instead | A brief narrowed the viewports. A mid-run instruction pointed researchers at unmerged branches. A review brief turned "every reservations, finance and payments port" into "every cross-module port that was stubbed". A brief asked for a file the harness refuses | E-027, E-019, E-043, E-036 | Briefs that deviate from their playbook or restate claims (round 1: ≥ 2) |
| v2 | 2026-11-07 | **O2-2** | **Exact commits.** Stage only named files (`git add -- <paths>`), never a directory while any agent writes under it. Commit a running agent's files only as `wip(<agent>): … (in progress)`, and again when it reports. Commit to `main` through `tools/commit-checked.sh` | Commits `1179c98` and `012652e` swept the integration-step reviewer's PoC files and its unfinished 400-line report into `main` 2–4 minutes before it finished. Lint failures reached `main` through piped output | E-057, E-010 | Commits containing another agent's unfinished files (round 1: 2); lint fix-up commits (round 0: 3–4) |
| v2 | 2026-11-07 | **O2-3** | **Exact file hand-offs.** When copying a checker's evidence into the repository, copy every file in its manifest, then run the cited-file and duplicate checks (`blackbox-tester.md` H-1…H-4). Every cross-module note in a review becomes a `pending-fixes.md` entry with an owner | Six screenshots were lost in the round-1 compress step. Contract drift that two reviews had noted broke `main` | E-032, E-011 | Evidence lost at hand-off (round 0: 6 files); untracked notes that later break something (round 0: 2) |
| v2 | 2026-11-07 | **O2-4** | **Exact records.** Timeline times come from `date -u`, commit times or transcripts, never estimates. Agent costs come from `agents.json` after the chronicle extraction. At every merge, regenerate generated artifacts (`docs/parity/COVERAGE.md`) and queue the update of the merged module's parity rows from its README evidence | Times were 10–60 minutes off, some ahead of the clock (corrected at 17:25), and the quality steward copied them (E-056). Inventory and reservations parity showed 1 % tested while their READMEs proved dozens of rows; `COVERAGE.md` showed rates at 2 % instead of 61 % | E-055, E-060 | Chronicle correction batches (round 1: 1); stale generated artifacts found later (round 1: 1) |
| v3 | 2026-11-07 | **O3-1** | **Times are derived and verified, never typed.** A helper, `tools/chronicle/when.py` (prototype at `<scratchpad>/canary-scripts/when.py`), prints the time and a source token: `agent "<title>"` reads the subagent transcript's last assistant message **live** (not the lagging chronicle extract); `commit <sha>` reads the committer time; `now` reads `date -u`. Every new timeline bullet carries the source token. A verifier run by `tools/commit-checked.sh`, whenever `docs/chronicle/01-timeline.md` is staged, recomputes each token's time and refuses the commit if HH:MM differs from the floor of the source time | Four more estimated times (E-080) after O2-4 had made it a rule. The error fell from 10–60 to 1–6 minutes but never reached zero: memory is not a mechanism. The prototype printed the right times for the sweep (18:15), the re-review (18:29), the parity merge (18:02) and integration review 1 (17:26) | E-055, E-080 | Timeline time corrections per round (round 2: 4 → target 0); bullets without a source token |
| v3 | 2026-11-07 | **O3-2** | **Safe history.** Never force-push, for any reason. Reconcile a diverged branch with a merge (`-s ours` for a superseded checkpoint, as on 18:08). After every checkpoint, the resume message names the WIP commit and says: "build on top of it; never amend, reset or rebase it" | A pushed checkpoint commit was rewritten by an agent that had not been told; the orchestrator then attempted a force-push, which the safety policy declined | E-081 | Force-push attempts (round 2: 1 → 0); rewritten checkpoint commits |
| v3 | 2026-11-07 | **O3-3** | **A flaky test is a tracked defect.** A failure that passes on re-run gets a `pending-fixes.md` line (owner, test, port or seed) before merge. It is never accepted silently | The 409-toast test passed on re-run at the identity merge (11/12) | E-079 | Untracked flakes at merge |
| v4 | 2026-11-07 | **O4-1** | **A recorded default cites its code.** Every "Default we are proceeding with" in `OPEN_QUESTIONS.md`, every ADR decision and every runbook statement of what the system does cites the file:line that implements it, or a `pending-fixes.md` line (owner) that will make the code match. When a builder lists owner decisions, ask which option the code does today before recording a default | Q158 recorded "NAT gateway (private tasks)" as the default while the code deployed public task IPs; approving "the defaults" would have deployed the weaker posture | E-104 (AP-62, RC-15) | Recorded defaults that differ from the code (canary C-L1-09) |
| v4 | 2026-11-07 | **O4-2** | **Every finding gets a disposition, checked by script.** When a checker's findings arrive, and always when a loop step such as the refiner is skipped: each finding ID → a `pending-fixes.md` line with an owner, an existing refinement or decision ID, an acceptance check, or "rejected: reason". **Triage by cause, not by badge:** UI logic (navigation, focus, keys, routing, validation, column priority) is fixed now even on simulated screens; data contradictions become real-data acceptance checks. A re-test of earlier "Done" claims gets a confirm/refute table and a column in the loop's own scorecard | Round 2a routed 10 of 49 findings (13 of 23 majors had none), sent a tile-routing defect nowhere because it was tagged SIM, and recorded no verdict on the round-1 "Done" claims it refuted | E-105, E-107 (RC-16) | Findings with a disposition (round 3: 20 %); canary C-L4-12 |
| v4 | 2026-11-07 | **O4-3** | **The chronicle's agent records move with the timeline.** The commit that records an agent's report in `01-timeline.md` also runs `tools/chronicle/extract.py`, so its brief and report are in `docs/chronicle/agents/`. Costs are counted once per API message (retro edit 7) | No extraction since 18:45; 7 finished agents' briefs and reports exist only in transcripts, and a container restart already lost one log today. The extractor counted each content block as a turn | E-117, E-116 (RC-12) | Hours since the last extraction at each merge; cost figures re-checked against one known record |
| v4 | 2026-11-07 | O3-1a *(clarification of v3)* | **The time of an event, not of the record.** `when.py owner "<text>"` gives the time the owner's message was queued; `when.py trigger` gives the time the scheduled task fired (run it as the first act after a resume). `now` is only for the orchestrator's own act at the moment of writing. `verify-times.py` refuses `now` on entries that begin "Owner" or "Resumed" | Three entries were dated 1–3 minutes after their event, each with a valid `now` token | E-115 | `now` tokens on event entries (round 3: 3 of 5) |

### Queued for later versions (one theme each)

- **v3, fix-verification depth at merge.**
  - Extend the targeted re-check from P0 fixes to **P1 fixes**.
  - Audit every **exemption** a fix leaves behind: an early `return`, or a comment such as "first deposit is accepted".
  - Run the queued re-attack sweep of merged P0 and P1 fixes.
  - Prompted by E-039: the payments and finance P0-1 fix exempted booking deposits.
  - Prompted by E-045: the finance fix left an optional scope that widens to every property.
  - Prompted by E-046: the rates R-05 seal fix was not applied to the sibling evaluators.
  - All three were found only because the integration step made those paths live. Retro edit 1 already proposes this
    as a `STATUS.md` change; v3 makes it the orchestrator's standing practice once round 2 confirms it.
- **v5, merge depth (the v3 queue, plus round 3).**
  - Re-check P1 fixes at merge, not only P0; audit every exemption a fix leaves (E-039, E-045, E-046; now partly
    standing practice through the re-attack sweep rule in `STATUS.md`).
  - **A fix round that adds a user-facing surface** (a route, a keyboard binding, a switcher, a dialog) gets a UI
    review of that surface before merge, or is recorded as unreviewed and put into the next UX round's scope. Prompted
    by E-108: the `g s` switcher, built in the backoffice fix round, silently switched hotels in round 2a.
- **v6, test environment realism at merge.**
  - Run UI end-to-end tests at merge on non-default ports (E-053).
  - Know which checks the merge gate does **not** run, for example Playwright outside `turbo test`, and run them on
    the merged copy.
  - Prompted by E-053, and by the integration-step review's note that the Playwright tests were not run.

---

## 1. The playbook (v2)

v2 is v1 (`archive/orchestrator-v1.md` §§ 1–5) plus the four checks below. They apply at the moment named in each
heading.

### O2-1 When launching a checker or sending it a message

1. Take the launch brief from `docs/quality/playbooks/<checker>.md` (current version), and fill only its **run
   parameters**.
2. Scope parameters come from the source documents:
   - viewports, devices and roles from `docs/product/personas-and-workspaces.md`;
   - focus areas from the spec, the review history and `docs/quality/patterns.md`.

   Write down where each one came from.
3. Quote the builder's claims verbatim in a "Claims to verify" block, with the source file and section. Do not
   summarize them.
4. A mid-run message may add context or answer a question. It may not change an evidence rule or a gate. Those
   changes go through the playbook's change log.

### O2-2 When committing

1. Use `git add -- <file> <file> …` with exact paths. Before staging, check `git status` against the running agents'
   write areas (their report paths, PoC folders and worktrees).
2. A running agent's files are committed only on purpose, as `wip(<agent>): … (in progress)`. Commit them again when
   the agent reports, and note which commit holds the final version.
3. Commits to `main` go through `tools/commit-checked.sh "<message>" <paths…>`.

### O2-3 When handing files or notes from one agent to another

1. Evidence: copy every file in the checker's manifest. After any conversion, run the cited-file and duplicate-hash
   checks (`blackbox-tester.md` H-1…H-4).
2. Notes: every "for the orchestrator" or "cross-module" item in a report becomes a `pending-fixes.md` line with an
   owner, or an explicit "not doing: reason", before the next fix round starts.

### O2-4 When recording

1. Times come from `date -u`, `git log --format=%ad`, or the transcript and `agents.json` timestamps. If a time is
   estimated, write "≈" and the method.
2. After every merge:
   - regenerate `docs/parity/COVERAGE.md` (`node tools/parity-report.mjs`) and commit it;
   - if the merged module's parity rows changed status, queue the update with the parity owner, citing the README
     evidence.
3. Agent costs in any report come from `docs/chronicle/data/agents.json` after `extract.py`. Mark a run that is still
   going as "≥".

## 1b. The playbook additions (v3)

- **O3-1 Recording a time.** Run `tools/chronicle/when.py agent "<title>"`, `commit <sha>` or `now`, and paste its
  output: the time plus the source token. Never type a time. Until the tool is in `tools/`, use the scratchpad
  prototype. **Rounding convention:** the floor of the source time to the minute (17:26:51 → 17:26).
- **O3-2 After a checkpoint or a refused push.** Do not force-push. Use `git merge -s ours <superseded>` or an
  ordinary merge. The resume message says: "Your work in progress was committed and pushed as `<sha>`. Build on top;
  never amend, reset or rebase it."
- **O3-3 Flaky tests.** Any test that fails and then passes on re-run becomes a `pending-fixes.md` entry with an owner
  before the merge completes.

## 1c. The playbook additions (v4)

- **O4-1 Recording a default or decision.** Before writing "Default we are proceeding with", find the code that does
  it and cite it (`modules/cell/locals.tf:323`). If the code does the other option, either change the default to match
  the code (and say so), or add a `pending-fixes.md` line that makes the code match, and cite that line.
- **O4-2 When findings arrive.** Run the disposition check (`<scratchpad>/canary-scripts/r3_dispositions.py
  <findings.md> docs/orchestration/pending-fixes.md <decisions files…>` until it is in `tools/`). It lists every
  finding ID with no disposition; each gets one before the round is recorded as handled. For a re-test of "Done"
  claims, add the confirm/refute table to the loop's own scorecard (`docs/ux/scorecard.md` for UX).
- **O4-3 Recording an agent's report.** In the same commit as the timeline entry: `python3 -I tools/chronicle/extract.py
  <session-jsonl> .` and stage `docs/chronicle/agents/` and `docs/chronicle/data/`.
- **O3-1a.** Owner directions: `when.py owner "<a phrase from the message>"`. Resumes: `when.py trigger`, run first.
  `now` only for your own act.

## 2. Process counters (the quality steward measures these each round)

| Counter | R0 | R1 | R2 | R3 |
|---|---|---|---|---|
| Escapes whose earliest loop is L-orch | 5 (after reclassification) | 3 | 2 (E-080, E-081) | 3 (E-104, E-105, E-117) |
| Briefs deviating from the playbook, or restating claims more broadly | — | ≥ 2 (both reviews launched with bespoke briefs; one restated a claim more broadly) | 0 found (both v2.1 runs launched from the playbook) | 0 found (the fix-round-3 brief went beyond v4 § 5 on its own: external writers, state machine) |
| Commits containing another agent's unfinished files | — | 2 | 0 (WIP labelled: `0fa21bd`, `d3bd36a`) | 0 unlabelled (`1dfa41b`, `80b9fa3`, `285a947` labelled WIP) |
| Evidence files lost at hand-off | 6 | 0 (restored 17:28) | 0 | 0 (74/74) |
| Chronicle correction batches | — | 1 (10–60 min errors) | 4 corrections (1–6 min errors) | 0; 3 `now` tokens dated the record, not the event (E-115) |
| Stale generated artifacts found later | — | 1 (`COVERAGE.md`) | 0. But parity rows for inventory and reservations are still 1 % `tested` on `main` (E-060 open) | 1: agent records not extracted since 18:45 (E-117) |
| Lint fix-up commits on `main` | 3–4 | 0 since `commit-checked.sh` | 0 | 0 |
| Force-push attempts | — | — | 1 (declined by policy) | 0 |
| Quality edits applied ÷ proposed | — | 8/8 | 6/6 (`722b345`, 1 min after merge) | 7/7 (`ec5dd3a`, 1 min after the report; the refiner step of edit 5 later skipped by decision) |
| Findings with a disposition (O4-2) | — | — | — | 10 of 49 (UX round 2a) |
| Recorded defaults that differ from the code (O4-1) | — | — | — | 1 (Q158, E-104) |
