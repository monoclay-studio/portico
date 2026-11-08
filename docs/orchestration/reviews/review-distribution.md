# Steward review — distribution (Channex adapter, ARI engine, inbound revisions, simulator)

Playbook: `docs/quality/playbooks/steward-reviewer.md` v2.1 (launch brief as given), plus the run's focus areas (a)–(g).
Reviewer: architecture steward (independent). Date: 2026-11-08.

- **Branch / commit reviewed:** `feat/distribution-channex` @ `a8bd950a8c0c5d31eedf161f5e16386b54cc5971`
- **Merged copy:** `a8bd950` + `main` @ `2df56d1` → merge `d2737e6` (clean merge, no conflicts), in a scratch worktree.
- **DB prefix:** `PORTICO_TEST_DB_PREFIX=review_distribution`

> Status: IN PROGRESS — verdict, counts and coverage are filled in at the end.

## 1. Gate results on the merged copy (exit codes captured, never piped)

| Gate | Exit | Key output |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | lockfile up to date |
| `pnpm lint` (`biome check . --error-on-warnings && node tools/check-boundaries.mjs`) | **1** | 7 warnings, all in `modules/distribution` (3× `noNonNullAssertion` in `src/domain/domain.test.ts:261,271,280`; `useOptionalChain` in `src/search.ts:73`, `src/service/ari-dispatch.ts:435`, `src/service/inbound.ts:845`; `useMathMinMax` in `src/service/calendar.ts:164`) — see G-1 |
| `pnpm turbo run typecheck --force` | 0 | 19 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | 0 | 17 tasks, 0 cached; distribution 11 files, 91 passed + 2 todo; api 18 files, 72 passed |

## 2. Findings

(appended as confirmed)

### P1-1 · "No polling loops" is violated: a blocked connection with pending work re-runs every scheduler tick, forever (owner requirement 1)

- **Where:** `modules/distribution/src/service/jobs.ts:118-128` (`nextDue` pushes `open.next_attempt_at` and
  `dirty.first_dirty_at + freshness + 1 s` whether or not the work can progress), `jobs.ts:149` (floor `now + 1 s`),
  `src/service/ari-dispatch.ts:184-202` (`claim` returns `skip` with `nextDueAt: null` while credentials are invalid or
  publication is blocked, leaving the dirty rows and the open message's past `next_attempt_at` in place),
  `src/service/exceptions.ts:40-54` (every pass rewrites the open exception).
- **Reproduction:** `distribution-poc/zz-review-a.test.ts.txt` A1 and A2. A1: a 401 from the hub (E04, revoked key)
  plus one price change → ten scheduler passes two minutes apart each schedule the next pass **1 000 ms** later
  (`A1 gaps (ms): 1000,1000,…`). A2: availability authority external (connected mode, DST-R15) plus one price change →
  same 1 000 ms loop, and the `publication_blocked` exception is rewritten every pass (`occurrences: 11`).
- **Why it matters:** the owner's requirement is "no heavy database polling loops". In the two most ordinary blocked
  states (a hotel revokes the key at the hub — scenario E04; a property runs in connected mode next to its PMS) the
  organization is claimed every tick and every connection's full work (inbound processing, two claim transactions,
  acknowledgements, escalation, health, ~20 `nextDue` queries) re-runs every 2 s **until a person acts**, which can be
  days. It also writes the exception row every pass. The README's "No polling loops" section and parity row claim the
  opposite ("a tick with nothing due reads one indexed row set and does nothing else").
- **Sibling paths (same mechanism):** acknowledgements pending while credentials are invalid (`jobs.ts:135,144` —
  `ack_next_at` in the past, `dispatchAcks` returns early at `inbound.ts:749`); `publication_refused`
  (`hub_target_not_allowed`, live scope refused, `hub_credential_missing`; `ari-dispatch.ts:205-221`); parked-orphan
  and health instants already in the past.
- **Fix (principle):** *the due index holds only instants at which work can actually progress; work that waits on a
  person or on another system (credentials invalid, another system of record, environment or live-scope refusal,
  missing key, connection paused) contributes no due instant, and the transition that unblocks it pulls the schedule.*
  Known unblocking transitions: verify (already schedules when active), rotate key (`rotateCredential` — does not
  schedule today), authority back to Portico (`onAuthorityChanged` → `requestResync` schedules), resume, live-scope
  grant. **Attack run against the fix:** "if blocked work contributes nothing, does the health banner ever flip to
  stale?" — the freshness crossing must still produce exactly **one** wake per blocked connection (store a
  `stale_evaluated_at`), not a loop. Test: the A1/A2 probes inverted (next due ≥ 15 min while blocked; one wake when the
  key is replaced).

### P1-2 · Revision order can put a modification or cancellation before its own creation: a modification is acknowledged as "stale" (lost), or the creation waits forever (owner requirement 3, DST-R08/R09)

- **Where:** `src/domain/revisions.ts:52-57` (`revisionOrderOf`: `Date.parse(insertedAt)` — millisecond precision,
  TZ-less strings parsed as **local** time — plus a tie-break that is a **hash of the revision id**; arrival time when the
  hub gives no timestamp), `src/service/inbound.ts:138` (order fixed at first store), `inbound.ts:281-291` and `:680`
  (`earlierUnsettled` counts a **parked orphan** as an earlier unsettled revision, so a creation ordered after its own
  orphan waits on it), and the reservations provider, which records any lower revision number as `stale`.
- **Reproduction:** `zz-review-a.test.ts.txt`
  - **A3:** creation and modification of one booking with the same hub timestamp (second precision, or two revisions
    within one millisecond — `Date.parse` drops microseconds: `.123456Z` and `.123999Z` parse equal). Revision ids are
    chosen so the hash puts the modification first. Result: `A3 modification: { revision: 'stale' } older revision`,
    booking stays at 3 nights instead of 4. (In the probe the ack then fails only because the simulator never held
    that revision; against a hub it is acknowledged, so the channel considers the change delivered.)
  - **A4:** no hub timestamp (the code's documented fallback, `inbound.ts:164-166`), cancellation delivered before
    creation. After 20 simulated minutes: creation `received` with `next_attempt_at = null` (waiting on the parked
    cancellation), cancellation `parked`. The only exits are staff "Apply as new" on the cancellation (then the creation,
    numbered later, is applied as newer — a live booking the guest cancelled) or "Dismiss" (same result).
- **Why it matters:** a guest's change at the OTA is silently dropped and acknowledged (overbooking or a wrong stay), or
  a booking never arrives. `inserted_at`'s presence, name and precision are **unverified** (README; `WIRE_FACTS`
  `revisions.shape`), and the code comment claims "microsecond scale", which the implementation does not deliver. The
  simulator always emits unique, strictly increasing millisecond timestamps (`simulator.ts:441`), so no test can see
  this (see P2-4).
- **Fix (principle):** *within one booking, revision order is a total order consistent with the hub's sequence; where
  the hub's timestamp cannot separate two revisions, the tie is broken by lifecycle meaning (new < modified <
  cancelled) and then by first arrival — never by a hash; a creation never waits behind a parked orphan of its own
  booking (the orphan exists because the creation is missing).* Parse the full fractional part (µs) as an integer and
  TZ-less hub timestamps as UTC. Equal-timestamp **modifications** cannot be ordered safely by anything Portico holds:
  apply by arrival and raise a routine discrepancy so staff compare with the extranet. **Attack run against the fix:**
  create + cancel with equal timestamps delivered cancel-first → create (rank 0) applies, cancel un-parks and applies
  (one cancelled booking); create + modify equal timestamps delivered modify-first → modify parks, create applies,
  modify un-parks and applies (4 nights). **Sibling paths:** `recoverSince` stores only each booking's latest revision
  (orders against older ones already stored); the feed pull; "Apply as new" (`inbound.ts:1197-1215`) which must use the
  same order; reservations' `compareRevision` (it receives this number).
