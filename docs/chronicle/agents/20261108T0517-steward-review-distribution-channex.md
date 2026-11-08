# Agent run: Steward review: distribution + Channex

- Started: 2026-11-08T05:17:02.205Z · last activity: 2026-11-08T05:44:39.874Z
- Turns: 129 · tool uses: 134 · output tokens: 129,124
- Type: general-purpose

## Brief (2026-11-08T05:17:02.205Z)

````text
You are Portico's architecture steward, an independent senior reviewer. Run a full steward review of a newly built module. Read `docs/quality/playbooks/steward-reviewer.md` (v2.1) and follow its **Launch brief** exactly, with these run parameters:

```
MODULE:            distribution (channel distribution + Channex adapter + Channex simulator)
BRANCH / COMMIT:   feat/distribution-channex @ a8bd950 (record the commit you actually review; re-check findings if it moves)
WORKTREE:          /home/user/wt/distribution (read-only for you)
SCRATCH COPY:      /tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-distribution-copy (git worktree add --detach <copy> feat/distribution-channex; then merge current main into the copy)
SPEC / README:     docs/specs/distribution.md (§3.2–3.3, Channex note); modules/distribution/README.md; modules/distribution/FOUNDATION_REQUESTS.md; docs/strategy/modules/distribution.md (10x brief)
FOCUS AREAS:       see below
PARITY FILE:       docs/parity/distribution.md (on the branch)
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_distribution
REPORT PATH:       docs/orchestration/reviews/review-distribution.md; PoC files docs/orchestration/reviews/distribution-poc/*.test.ts.txt
UI REVIEW?:        no
```

**The builder's report, verbatim**, is the last report in `docs/chronicle/agents/20261107T2114-build-distribution-channex-adapter.md`. Quote its claims and verify each one. Draft your own attack plan from the code and spec before reading its self-assessment.

**Focus areas:**
- **(a) The owner's four Channex requirements.**
  - The ARI engine must be event-driven, with no polling.
  - The queue must never exceed the per-connection budget in any 60 seconds. Test this with real concurrency across workers and connections.
  - Webhook revisions must be stored durably before the 200 is returned, with ordered per-property processing, orphan parking and recovery pull.
  - An ack must go out only after a committed final outcome.

  Try to break each requirement: duplicates, out-of-order revisions, same revision id with different content, crash between commit and ack, two dispatchers at once, a 429 storm, a revoked key, and clock skew.
- **(b) Environment safety (rule 12) and LIVE refusal.** No path may reach a real hub from demo, trial or training. Sandbox may only reach Channex staging. Live must be refused until activation.
- **(c) Data authority (rule 15).** Nothing may be published while an external system is authoritative.
- **(d) Webhook security.** Check constant-time auth, the unguessable endpoint ids, rate limits, SSRF via configurable hosts, PII handling and log redaction of stored revisions, and tenant isolation of the endpoint routing.
- **(e) The builder's mutation proof.** Re-run 2 of the builder's mutants and plant 1 of your own on the guard you judge riskiest. A survivor is a finding.
- **(f) The unverified Channex wire assumptions** in `src/adapters/channex/wire.ts`. Confirm they are isolated in that one mapping file, and that the simulator does not merely mirror the adapter's assumptions in a way that hides drift.
- **(g) Gates on the merged copy, exit codes captured, never piped:** `pnpm install --frozen-lockfile`, `pnpm lint` (now `--error-on-warnings`), `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`.

**Writing the report:**
- Write it incrementally: create the file early and append each confirmed finding.
- Start it with the verdict (merge / merge after fixes / do not merge), then counts by severity, then the coverage declaration.
- Give each finding an ID, file:line and a reproducing test.
- Commit nothing.
- Remove your scratch copy and `review_distribution*` databases when done.

**Your final reply:** verdict, counts, top findings, mutant results and the file list.
````

## Report (2026-11-08T05:44:39.770Z)

````text
## Steward review: distribution (Channex adapter) — verdict: **merge after fixes**

I reviewed commit `feat/distribution-channex` @ `a8bd950a8c0c5d31eedf161f5e16386b54cc5971`. The branch did not move during the review. I merged it with main @ `2df56d1` in a scratch copy; the merge was clean.

**Counts:** P0 0 · **P1 2** · **P2 9** · **P3 9**

Most of the work holds up well:
- The ARI budget held under real concurrency: three workers on one clock stayed at 10 requests/min per kind with zero 429s.
- A 429 storm kept gaps of at least 60 s, and every change still arrived.
- Revisions are stored durably before the 200 is returned.
- Acks go out only after a committed final outcome.
- No path reaches a real hub from demo, trial or training, and sandbox reaches only Channex staging. Live is refused.
- Tenant isolation and secret handling probed clean.

It is "after fixes" rather than "do not merge" because nothing here can touch a real Channex until the owner provides keys.

**Must fix before merge: P1-1, P1-2 and G-1.** P2-1 should land with P1-2.

**Gates on the merged copy** (exit codes captured, not piped):

| Gate | Exit | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm lint` | **1** | 7 warnings, all in distribution, now errors with `--error-on-warnings` (G-1) |
| `pnpm turbo run typecheck --force` | 0 | 19 tasks, none cached |
| `pnpm turbo run test --force --concurrency=2` | 0 | 17 tasks, none cached; distribution 91 passed + 2 todo; API 72 passed |

The parity gate fails, as the builder said: 21 P0 rows untested and 20 P1 rows missing.

**Top findings**
1. **P1-1 — "No polling loops" is broken.** A revoked key (E04), or an external system of record (connected mode), plus one pending change makes the organization re-run all its work every 1 s, forever (probes A1/A2). The cause is `jobs.ts:118-128`, which schedules work that cannot progress. It also rewrites the exception every pass and starves the shared scheduler.
2. **P1-2 — Revision ordering can lose or strand bookings.** Order uses `Date.parse` (millisecond precision, timestamps without a zone read as local time), breaks ties with a hash of the revision id, and falls back to arrival time.
   - A modification with the same hub timestamp as its creation is acknowledged as `stale` and lost (A3).
   - With no timestamp, a cancellation that arrives first leaves the creation waiting forever behind it (A4).
3. **P2-1 — Mutation survivor.** Disabling the per-booking ordered wait (`inbound.ts:680`) leaves 91/91 module tests and 3/3 API tests green. Parity row PAR-DST-023 therefore claims a test that does not exist.
4. **P2-2 — The budget depends on synchronized worker clocks.** With 2 s of skew, 20 requests were granted in 2 s against a limit of 10, and the other worker's records were erased. Because it counts reservation times, not arrival times, latency jitter lets the hub see 11 requests in 60 s.
5. **P2-3 / P2-4 — Unverified Channex answers fail open, and the simulator hides drift.**
   - An answer the code does not recognise counts as accepted: a warning without an index, or a 200 carrying an `errors` body.
   - The simulator mirrors 7 of the adapter's unverified assumptions, so no test can see these cases.
   - Four wire assumptions sit in `client.ts` rather than `wire.ts`.

The other P2s:
- **P2-5:** the webhook rate limit is keyed per IP, which all tenants share through Channex, and every unauthenticated post writes a permanent row.
- **P2-6:** a live tenant can claim another hotel's production hub property at creation, before proving any access.
- **P2-7:** guest personal data sits in an append-only table with no erasure path (declared as foundation request FR-5, not built).
- **P2-8:** the change-capture consumer silently drops events it cannot parse.
- **G-1:** the lint failure above.

**Mutation results (focus e)**

| Mutant | Source | Result |
|---|---|---|
| Ack CHECK constraint replaced with `check (true)` | builder | killed (regressions test fails) |
| Budget row lock removed | builder | killed (20 of 20 reservations granted against a limit of 10) |
| Per-booking ordered wait disabled | mine | **survived** → P2-1 |

**Coverage:** all 15 checklist items declared. 61 patterns declared: 52 applicable (15 probed, 34 code-read, 3 applied as review steps), 9 not applicable with reasons, 0 applicable left unprobed.

**Cleanup:** the scratch worktree is removed and no `review_distribution*` databases remain. The worktree under review is untouched, and I committed nothing. You already checkpointed a partial copy of the report in `91fa86b`; the final version is a working-tree change on top of it.

**One thing to pass on:** my first gate attempt briefly wrote `lint.log`, `lint.exit` and `typecheck.log` into the shared `scratchpad/gates/` folder that the migration and day-close reviewers also use. If either of them relies on those three files, they should re-run their lint and typecheck gates.

**Files** (each probe's assertion states the safe behaviour, so a failing probe is a reproduced defect; set C passes and shows the clean areas):
- /home/user/portico/docs/orchestration/reviews/review-distribution.md
- /home/user/portico/docs/orchestration/reviews/distribution-poc/zz-review-a.test.ts.txt (A1–A5: polling loop, ordering, budget clock skew)
- /home/user/portico/docs/orchestration/reviews/distribution-poc/zz-review-b.test.ts.txt (B1–B8: concurrency, 429 storm, answer parsing, budget margin, webhook flood, property squatting, conflicting revision)
- /home/user/portico/docs/orchestration/reviews/distribution-poc/zz-review-c.test.ts.txt (C1–C2: row-level security and secrets)
````

