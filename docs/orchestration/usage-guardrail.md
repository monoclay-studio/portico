# Usage guardrail (owner direction, 2026-11-07)

The work runs largely automated, so usage is guarded explicitly. Source of truth: the session's
`rate_limit_event` stream (`list_events` with `kinds: ["rate_limit_event"]`) → `unifiedWindows.five_hour.utilization`
and `resetsAt` (epoch seconds). The seven-day window is checked the same way.

| 5-hour utilization | Action |
|---|---|
| < 80% | normal operation |
| ≥ 80% | **no new agents, reviews or UX rounds**; running work continues; finish merges already verified |
| ≥ 92% | **PAUSE + CHECKPOINT** (below), then schedule the resume for `resetsAt` + 3 minutes |

## When it is checked
- At the start of every orchestrator turn (agent reports, owner messages, heartbeats).
- A self-scheduled check every ~20 minutes while agents run (`send_later`), each check scheduling the next.
- The 3-hourly UX heartbeat checks first and never starts a round at ≥ 80%.

## PAUSE + CHECKPOINT procedure (≥ 92%)
1. Stop every running agent (TaskStop). Their transcripts are kept and they can be resumed with a message.
2. `tools/checkpoint.sh` — commits work in progress in every worktree (`wip(<branch>): usage-limit checkpoint`) and
   pushes every branch to origin.
3. Update `docs/orchestration/STATUS.md` → "Resume log": time, utilization, every stopped agent with its workstream,
   branch, last state and the exact message to resume it; anything half-merged; the next 5 actions.
4. Commit + push main.
5. `send_later` at `resetsAt` + 3 min with the resume prompt (read STATUS.md; resume agents in priority order;
   re-check usage; keep the guardrail running).
6. Tell the owner in two lines: paused at N%, resumes at HH:MM UTC, nothing lost.

## Resume
Same session: resume each stopped agent with "the usage limit has reset — continue exactly where you stopped"
(plus any follow-ups queued in `pending-fixes.md`). New session: follow STATUS.md §8 (recreate worktrees from origin,
relaunch agents from `workstream-briefs.md` + their README "Checkpoint" sections). Resume in priority order and keep
total concurrency moderate so the next window lasts.

## Seven-day window (added 2026-11-07 16:20 UTC; **retired by owner direction 2026-11-07 18:00 UTC: checks use the 5-hour window only**)

The account also has a **seven-day** limit (`unifiedWindows.seven_day`). Running out of it would stall all work for
days, so pace against it as well:
- Read `seven_day.utilization` at every check. Healthy pace: utilization ≤ elapsed share of the week + 15 points.
- **≥ 80% seven-day:** run only the merge/integration critical path (steward reviews, fix rounds, integration step),
  at most 3 agents at once; the UX heartbeat and research pause until the window resets.
- **≥ 92% seven-day:** PAUSE + CHECKPOINT as for the 5-hour window and schedule the resume at the seven-day reset.

**Hard-stop note (2026-11-07 22:38 UTC).** Pacing still follows the 5-hour window only, per the owner. The seven-day
allowance is a hard stop with no overage, though: at 100% all work stops until it resets. So two safety rules stay:
- **≥ 85% seven-day:** only critical-path finishing work starts (fix rounds and merges of branches already in flight).
  No new modules or new reviews.
- **≥ 95% seven-day:** CHECKPOINT (`tools/checkpoint.sh`, STATUS resume log), then schedule the resume at the
  seven-day reset. This is for data safety, not pacing.

## Resume messages (orchestrator v3)
When resuming an agent after a checkpoint, say: "your WIP was committed and pushed as `<sha>`; build on top of it;
never amend, reset or rebase it". Never force-push; reconcile diverged branches with a normal merge or `git merge -s ours`.

