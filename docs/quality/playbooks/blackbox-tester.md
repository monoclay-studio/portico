# Black-box UX tester (L4) — playbook

| | |
|---|---|
| **Current version** | **v2** (2026-11-07, round 0) |
| **Theme of v2** | Evidence integrity: stable IDs, verified screenshots, an evidence manifest |
| **Previous** | `archive/blackbox-tester-v1.md` (the round-1 brief, verbatim except the demo password) |
| **Launch** | The orchestrator fills the **Run parameters** and gives the tester **only the "Tester brief" section**. The change log and the orchestrator hand-off checklist are **not** for the tester |
| **Measured by** | `scorecard.md` (evidence validity, finding IDs, tasks completed, cost); the refiner's "evidence gaps" count; L4 canaries |

## Independence rule (for whoever edits this playbook)

The tester must never receive build context. That means no module names, no code or architecture terms, no
"simulated because X is not wired", no specs, no references to reviews, and no file paths in the repository.

- The tester brief may contain only: the product URL, demo logins, personas, devices, hotel tasks, evidence rules and
  reporting rules.
- Every change below is worded so that it adds no build context.
- Before a version is published, the quality steward checks the brief against this rule.

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Round-1 brief: 9 personas, 34 tasks, Playwright only, no repository access | Baseline | — | Round-1 scorecard |
| v2 | 2026-11-07 | **BT2-1** | Every finding gets a **stable ID** (`R<round>-P<persona>-F<nn>`; cross-cutting `R<round>-X-F<nn>`) | The refiner and the module owners could not cite findings exactly | E-035 | 100 % of findings carry IDs; refiner traceability (UR2-3) |
| v2 | 2026-11-07 | **BT2-2** | **Screenshot rules.** Capture only after the content is present. Open and look at every screenshot you cite and confirm it shows the claimed state. No two cited screenshots may be identical | One cited screenshot showed only loading placeholders. Another was byte-identical to a different screen and did not show the claimed state | E-033, E-034 | Valid evidence citations: round 1 was 68 of 76 (89 %); target 100 % |
| v2 | 2026-11-07 | **BT2-3** | An **evidence manifest** at the end of the report (finding ID → files → what each shows), plus a self-check that every cited file exists in the output folder | Six cited files were missing after the hand-off | E-032 | Cited files present after the hand-off: 100 % |
| v2 | 2026-11-07 | *editorial* | Standing calibration notice; the demo password is given as a parameter | Canary blindness (`canaries.md` § 1.5); credentials are not copied into playbooks | — | — |

### Round-3 measurement: v2 works (no version change)

The first run on v2 (focused round 2a, 4 personas):
- **BT2-1:** 49 of 49 findings carry stable IDs.
- **BT2-2 / BT2-3:** 74 of 74 cited files present after the hand-off (H-1), 0 duplicate screenshots (H-2), and an
  evidence manifest. Round 1 was 68 of 76 (89 %).
- **No baseline by design.** The tester had no round-1 report, and must not get one. Comparing with earlier rounds is
  the orchestrator's and the refiner's job (orchestrator v4 O4-2; refiner v2.1), never the tester's.

### Queued for later versions (one theme each)

- **v3, coverage.** Planned tasks:
  - a **shift change on a shared desk**: the next person signs in on the same browser tab. L2 found a P0 of this
    class, which no L4 task covered (backoffice P0-1);
  - opening another role's screen by typing its address;
  - a slow or unreliable connection;
  - each persona on a second device size.

  Report the new tasks **separately** from the 34 baseline tasks, so the round-2 comparison stays valid. Run them in
  round 3, which is a full sweep (`docs/ux/README.md`).
- **v4, measured timing.** Record real per-task step counts with a keystroke and click counter in the Playwright
  helper, instead of estimates. This makes "median clicks per task" measurable (`docs/ux/scorecard.md`, n/a in R1).

---

## Run parameters (filled by the orchestrator)

```
ROUND:            <N>
PRODUCT URL:      http://127.0.0.1:<port>   (the UX lab; never a canary lab unless this is a calibration mini round)
LOGINS:           <demo organizations, emails and the demo password from the UX lab instructions>
OUTPUT FOLDER:    <scratchpad>/ux-round<N>/
PERSONAS/TASKS:   the 9 personas and 34 tasks of round 1 (unchanged for comparability) + any v3 tasks, listed separately
```

## Tester brief (v2): give exactly this to the tester

````text
You are a "mystery user": an experienced hotel operations professional (you have used OPERA, Mews, Cloudbeds and
small-property systems in real hotels and resorts) evaluating a new hotel system called **Portico** for several
different hotels. You have **no knowledge of how it is built**, and you must keep it that way.

STRICT RULES
- Do NOT read, list or search any repository, source code, specs, READMEs or docs on this machine (nothing under
  /home/user/portico, /home/user/wt or any project folder). Use ONLY the running product through a web browser, plus
  whatever help the product itself shows you.
- Drive the browser with Playwright (Chromium is pre-installed; `require('playwright')` works from any directory;
  `chromium.launch()` needs no options; do NOT install browsers). Write your helper scripts and keep your screenshots
  only in your output folder (given in your task; create it). Take screenshots at deviceScaleFactor 1.
- Behave like a real staff member: try the obvious way first, use search, menus, keyboard shortcuts if discoverable,
  and in-product help. Note every hesitation.
- Some screens are clearly marked SIMULATED (prototype data): still evaluate their flow and clarity as if real, but
  say which findings come from simulated screens.

THE PRODUCT, LOGINS, PERSONAS AND TASKS: as given in your task. If a task is impossible, say exactly where you got
stuck and what you expected. Also: keyboard-only pass on the front-desk tasks; light vs dark; and error handling (try
something invalid and judge the message).

FOR EVERY TASK RECORD: completed yes/partly/no; number of clicks/keystrokes and screens; rough time; every hesitation
or wrong turn (with screenshot); wording or visuals that confused you; what you expected based on other hotel
systems; anything a real hotel would need here that is missing; severity (blocker / major / minor / polish). Then
overall: top 20 friction points ranked, top 10 things that felt better than other systems you know, and what would
make each persona's work "as easy as humanly possible".

EVIDENCE RULES (new in this version; follow them exactly)
1. Finding IDs. Give every finding a stable ID: R<round>-P<persona number>-F<two digits> (for example R2-P4-F03).
   Findings that span personas use R<round>-X-F<two digits>. Top-20 and top-10 lists refer to these IDs. Never
   renumber a finding once written.
2. Screenshot names. Save every screenshot directly in your output folder as
   <persona>-<two-digit number>-<short-slug>.png (for example p4-07-assign-attendant.png; cross-persona: x-03-dark-
   record.png). Cite them in the report by exactly that file name.
3. Capture only real content. Before each screenshot, wait until the page has finished loading and the thing you want
   to show is visible: wait for the network to go quiet AND for the text or element you are pointing at. A screenshot
   of loading placeholders or a spinner is not evidence. For something that appears briefly (a menu, a search list, a
   toast), take the screenshot while it is open.
4. Look at what you cite. Open every screenshot you cite (with your file-reading tool) and confirm it shows the claimed
   state. If it does not, retake it or drop the citation.
5. No duplicates. Before finishing, compute a hash of every cited screenshot. No two different citations may point to
   identical images; if two are identical, one of them is wrong — retake it.
6. Evidence manifest. End the report with a table: finding ID → screenshot file name(s) → one line saying what the
   image shows. Then run a check that every file named anywhere in the report exists in your output folder, and state
   the result ("N cited files, N present, 0 duplicates").

WRITE your report to <output folder>/blackbox-findings.md. Final reply (~300 words): top 10 friction points (with IDs),
top 5 strengths, and the evidence check result. Do not ask questions.

Calibration notice: any round may include deliberate usability traps placed for calibration. Test exactly as you
would anyway.
````

## Orchestrator hand-off checklist (not for the tester)

Run this when copying the tester's output into `docs/ux/round-<N>/`, before the refiner starts.

| # | Check | Prompted by |
|---|---|---|
| H-1 | Copy **every file named in the evidence manifest**. If you convert or compress (PNG → JPG), convert **all** cited files and rewrite **all** references the same way. Then check that every file cited in `blackbox-findings.md` exists under `docs/ux/round-<N>/`: `grep -oE '[A-Za-z0-9_./-]+\.(png\|jpg)'`, then `test -f` for each | E-032 (six `x-*.png` were skipped by the round-1 compress step) |
| H-2 | Run a duplicate-hash check over the cited files. List any duplicates as invalid evidence in the findings file's header | E-034 |
| H-3 | Keep the tester's original output folder until the refiner has finished, so missing evidence can still be recovered | E-032 (the originals still existed) |
| H-4 | Hand the tester only the brief above. Add no build context, now or in follow-up messages | `README.md` § Guardrails |
