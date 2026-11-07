# Orchestrator — playbook v1 (archived)

**Status:** archived. Superseded by `../orchestrator.md` (v2).

**Source.** The orchestrator never had a single brief, so v1 is reconstructed from the procedures it documented and
followed on day 1, quoted or closely paraphrased with their files:

- `CLAUDE.md` (§0–§1);
- `docs/orchestration/operating-model.md`;
- `docs/orchestration/STATUS.md` § 0 resume-log conventions, § 5 merge procedure (as of `8ed5bf8`, 17:28 UTC) and
  § 8 resume procedure;
- `docs/orchestration/usage-guardrail.md`;
- `docs/chronicle/README.md` § "How it is maintained";
- `docs/ux/README.md` steps 3–4;
- `docs/quality/README.md` step 7;
- `tools/commit-checked.sh` and `tools/checkpoint.sh`.

**Used by:** the main session, all of 2026-11-07.

---

## 1. Role

- Owns the vision and the coherence of the whole: one product, a consistent experience, clean boundaries, honest
  readiness, sensible sequencing and owner communication (`operating-model.md`).
- Never stops while other work is unblocked. Owner questions go to `docs/OPEN_QUESTIONS.md` with a default (CLAUDE.md
  §1).

## 2. Launching work

- Launch builders with the module-agent playbook and their `workstream-briefs.md` entry.
- Launch checkers from `docs/quality/playbooks/` (latest). Before round 0 the checkers were launched from
  `steward-review-brief.md` and `parity-researcher-brief.md`.
- Per run, the orchestrator writes the parameters: worktree, prefix, spec, focus areas, scratch copy and report path.
- Usage gate: at or above 80 % of the 5-hour window, start nothing new. At or above 92 %, pause and checkpoint.
  Seven-day pacing applies as well (`usage-guardrail.md`).

## 3. Merge procedure (`STATUS.md` § 5, as of 17:28)

1. Branch reports done → launch the steward review from the playbook. The report and its PoC files are saved in
   `docs/orchestration/reviews/`.
2. Cross-module notes become `pending-fixes.md` entries with owners. Every P0 fix needs the builder's re-attack table
   and a targeted re-check on the merged copy. Findings go back to the author, who fixes them and re-runs the checks.
3. In the worktree: `git merge --no-edit main`, then `pnpm lint && pnpm typecheck && pnpm test`.
4. On main: `git merge --no-ff`. Then update the domain map, the demo seed, the search provider and jobs, the port
   bindings, the role templates and the readiness register.
5. Full checks on main: `pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force
   --concurrency=2`. Then push.
6. Chronicle: append to the timeline; run `extract.py` and `snapshot.py`; commit.
7. Resume the quality steward after every checking round.

## 4. Records

- **Chronicle:** append after every merge, verdict, owner direction, pause or resume. Nothing is deleted; corrections
  are appended with a date (`docs/chronicle/README.md`).
- **STATUS.md resume log:** time, utilization, every stopped agent with its last state and the exact message to
  resume it, and the next actions.
- **Commits to main:** go through `tools/commit-checked.sh`, which commits only when lint passes (from 16:41).
  Conventional Commits with the session trailers.

## 5. Oversight loops

- **UX:** decide when the next round runs; resolve conflicts between modules; re-measure with the same tasks
  (`docs/ux/README.md` step 4).
- **Quality:** apply playbook changes that never weaken a gate (`docs/quality/README.md` step 7).
