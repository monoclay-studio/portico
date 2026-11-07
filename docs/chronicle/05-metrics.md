# Metrics

Headline numbers over time. Raw data is in `data/snapshots/*.json` (`tools/chronicle/snapshot.py`) and
`data/agents.json`.

## Snapshot 2026-11-07 16:36 UTC (after 8 module merges)

| Measure | Value |
|---|---|
| Elapsed since first message | 9 h 56 min, of which 6 h 19 min were paused for usage limits (2 pauses) |
| Commits on main / all branches | 300 / 360 |
| TypeScript + SQL on main | 150,308 lines in 531 files (UI and identity-plus branches not yet merged) |
| Test files / tests passing on main | 145 / **1,135** (full suite, 14 packages) |
| SQL migrations | 17 |
| Markdown docs | 198 files, 36,646 lines |
| Specs / ADRs / parity files | 31 / 17 / 18 |
| Owner questions logged | 57 (1 answered via decisions; the rest proceed on defaults) |
| Owner messages | 19, plus 2 rounds of clarifying answers |
| Agent runs | 38 (29 with full transcripts) |
| Orchestrator | 1,140 assistant messages; 334 shell commands; 38 agent launches; 82 messages to agents |

### Lines of code and tests per package (main)

| Package | Lines | Test files | Tests passing |
|---|---|---|---|
| modules/finance | 20,520 | 17 | 85 |
| modules/integration | 20,112 | 18 | 173 |
| modules/reservations | 19,806 | 23 | 147 |
| modules/payments | 18,990 | 12 | 113 |
| modules/operations | 17,785 | 18 | 120 |
| modules/rates | 15,698 | 12 | 128 |
| modules/inventory | 13,691 | 12 | 96 |
| modules/guests | 13,503 | 14 | 173 |
| apps/api | 3,732 | 12 | 46 |
| modules/platform | 1,857 | 1 | 9 |
| packages/kernel | 1,386 | 3 | 25 |
| modules/identity | 1,349 | 1 | 5 |
| packages/db | 1,258 | 1 | 12 |
| packages/http | 439 | 1 | 3 |
| packages/testing, apps/worker | 182 | 0 | — |

### Steward reviews (first round)

| Module | Verdict | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| guests | do not merge | 2 | 6 | 13 | 10 |
| inventory | merge after fixes | 2 | 6 | 8 | 9 |
| rates | merge after fixes | 1 | 10 | 18 | 7 |
| payments | merge after fixes | 3 | 12 | 14 | 10 |
| operations | merge after fixes | 2 | 12 | 22 | 14 |
| reservations | merge after fixes | 1 | 16 | 12 | 6 |
| integration | merge after fixes | 1 | 8 | 10 | 10 |
| finance | do not merge | 2 | 10 | 17 | 12 |
| identity-plus | do not merge | 2 | 8 | 17 | 12 |
| backoffice UI | merge after fixes | 1 | 6 | 18 | 10 |
| **Total** | 3 "do not merge" | **17** | **94** | **149** | **100** |

### Merge times to main (day 1)

guests 11:30 · inventory 11:38 · operations 11:57 · rates 12:07 · payments 12:13 · reservations 12:20 ·
integration 12:23 · finance 12:24. Docs branches: operational readiness 07:32, adoption 07:52, product strategy 07:53,
guest journey 11:16, back-of-house 11:19, parity-front 11:32, parity-finance 11:44, market deep dive 12:03.

### Usage

| Window | Peak | Outcome |
|---|---|---|
| 5-hour window ending about 08:30 | limit reached | checkpoint at 08:28; resumed 11:11 |
| 5-hour window ending 16:10 | 92% at 12:35 (100% at 13:40) | pause and checkpoint at 12:36; automatic resume 16:14 |
| Seven-day window | 54% at 16:14 on day 1 | pacing rule added |
