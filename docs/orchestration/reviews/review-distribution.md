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

### P2-1 · Mutation survivor: ordered processing within a booking is untested (the PAR-DST-023 "ordered" claim has no asserting test)

- **Where:** `src/service/inbound.ts:680` — `if ((await earlierUnsettled(tx, row)) > 0) { … wait … }`.
- **Mutant (reviewer-planted):** `if (false && (await earlierUnsettled(tx, row)) > 0)`. Result: full module suite
  **11 files, 91 passed + 2 todo** (exit 0); `apps/api/test/distribution.test.ts` **3 passed**. Every test that touches
  ordering (S02/E02, "cancel-before-create", "exactly once", S20) still passes, because each orders revisions
  through the parking path, never through the per-booking wait.
- **Why it matters:** "per-property ordered processing; revision order within a booking" is owner requirement 3's
  core promise and parity row PAR-DST-023 is marked `tested`; nothing proves it. P1-2 shows the ordering is also
  wrong at its edges, so this guard will be changed in the fix round with no test to catch a regression.
- **Fix:** a test where an earlier revision of the booking is **unsettled but not parked** (create `failed` with a
  retryable 503 from reservations; modification arrives) — the modification must wait, then apply after the create;
  the mutant above must turn it red. Downgrade PAR-DST-023 to `specified` until then. Same treatment for the sibling
  guard in "Apply as new" (`inbound.ts:1204`).

### P2-2 · The budget's "never more than N in any 60 s" holds only for reservation instants on synchronized worker clocks (owner requirement 2)

- **Where:** `src/domain/budget.ts:27` (`pruneSends` drops stamps **later** than `now`), `src/service/ari-dispatch.ts:95-97`
  (writes the pruned array back, deleting them), `packages/db/src/tx.ts` (`tx.now` is the process clock, read when the
  transaction starts, before any lock wait).
- **Reproduction:** `zz-review-a.test.ts.txt` A5 — worker A (clock +2 s) reserves 10, worker B (correct clock) then
  reserves **10 more**: `granted within 2 s of real time: 20`, and the stored array holds 10 (A's stamps were erased).
  `zz-review-b.test.ts.txt` B5 — the slot returns at exactly +60 s of the reservation instant: with 300 ms latency on
  request 1 (cold TLS) and 20 ms on request 11, the hub sees **11 requests inside 60 s**.
- **What held:** with one clock, three workers ticking the same organization concurrently through a sustained burst
  stayed at 10/min per kind with zero 429s and every change delivered (B1); a 429 storm kept ≥ 60 s gaps (B2);
  two connections' budgets are independent (B3); the builder's "20 concurrent reservations" mutant is killed.
- **Fix (principle):** *a budget slot is accounted on one clock that every worker shares, from the moment the request
  can reach the hub until the hub can no longer count it; nothing a worker cannot see as "past" is discarded.* Stamp
  with the database clock inside the locked statement (`clock_timestamp()`), keep future stamps (count a stamp until
  `stamp + window`), and add a configurable margin (e.g. window 62 s, or record the slot again at completion and count
  the later instant). **Attack run against the fix:** a DB failover with a clock step backwards — keep the slot list
  monotonic (`greatest(stamp, max(sends))`), so a step back cannot free slots.

### P2-3 · An ARI answer Portico does not recognise is recorded as ACCEPTED (unverified response shape fails open; DST-I04, CLAUDE.md §5 "never show synced unless confirmed")

- **Where:** `src/adapters/channex/wire.ts:308-334` (`parseAriSuccess`: a warning without `index` is skipped; a 2xx
  body that matches nothing still parses because every field is optional), `src/service/ari-dispatch.ts:456-480`
  (status `accepted`, cells written to `channel_state`; `unrecognizedAnswer` only goes to the exchange log).
- **Reproduction:** `zz-review-b.test.ts.txt` B4 — `{ data:[{id:'t1'}], meta:{ warnings:[{ warning:'rate_plan_id is
  invalid' }] } }` → `refused: [], unrecognized: false`; a 200 with `{ errors: {…} }` → `refused: [], unrecognized:
  false` (not even flagged).
- **Why it matters:** the answer shape and partial acceptance are `unverified` (`WIRE_FACTS` `ari.response`). If
  Channex reports refusals any other way, Portico shows the channel calendar "in sync", the discrepancy check compares
  Portico with a `channel_state` that copies Portico and finds nothing, and the hotel sells at a price the channel
  never took.
- **Fix (principle):** *only an answer that positively confirms acceptance in the verified shape moves a cell to
  "acknowledged"; anything else is "pending verification" and is resolved by reading the channel back.* Treat a
  warning without a usable index, any `errors` member, and an unrecognised 2xx as `pending_verification` for the whole
  message (cells keep their previous `channel_state`, an exception asks Monoclay to check the format), and schedule a
  read-back. **Attack run against the fix:** a real Channex answer that is a bare `{}` with 200 — it stays pending
  until R4 confirms the shape; acceptable, and visible.

### P2-4 · The simulator mirrors the adapter's unverified assumptions, so drift is invisible; and `client.ts` also holds wire assumptions (focus f)

- **Isolation:** Channex paths, field names and headers are confined to `src/adapters/channex/wire.ts` (search of
  `src/` outside `wire.ts`/`simulator.ts` finds only Portico column names), **except** `client.ts:53` (`retry-after`,
  unverified `limits.retry_after`), `client.ts:164-166` (property answer `data.attributes.title`), `client.ts:206-208`
  and `:248-250` (pagination meta semantics), `client.ts:223` (404 means "no such revision").
- **Mirroring that hides drift** (each is a place where the simulator answers exactly what the parser expects):
  1. revision timestamps are unique and strictly increasing per call (`simulator.ts:441`), so P1-2 cannot appear;
  2. ARI refusals always carry `index` (`simulator.ts:258-262`), so P2-3 cannot appear;
  3. the webhook payload is the feed's attributes plus `id`/`revision_id` (`simulator.ts:522`), so webhook and feed
     always hash equal. If the real `send_data` payload differs from the feed (unverified `webhook.payload`), every
     webhook-first revision becomes an urgent `revision_conflict` at the next feed pull **and the webhook's content
     stands** (`inbound.ts:216-237`; B8 shows a webhook price of 1.00 standing over the feed's 500.00);
  4. `GET /bookings` always answers one page with `limit = data.length` (`simulator.ts:343`), so the 20-page cap is
     never exercised (see P3-2);
  5. acknowledging twice always answers 200 (`simulator.ts:292-296`), mirroring unverified `revisions.ack_idempotent`;
  6. `date_to` is applied inclusively (`eachInclusive`, `simulator.ts:152`), mirroring unverified `ari.availability.dates`;
  7. the rate limit is a sliding 60 s by arrival that ignores refused requests — the same model as the budget.
- **Fix (principle):** *each `unverified` WIRE_FACT has at least one simulator mode in which the hub behaves the other
  plausible way, and a test that shows Portico stays truthful in that mode.* Concretely: timestamp modes (equal, second
  precision, absent, TZ-less), refusal shape modes (no index, `errors` with 200), webhook payload subset mode, multi-page
  booking list, ack-twice → 404/422, exclusive `date_to`, fixed-minute limit counting 429s. Move the four `client.ts`
  assumptions into `wire.ts` with `WIRE_FACTS` entries. **Attack run against the fix:** a mode the simulator models
  but the code still maps to "accepted" must fail a test (B4 inverted).
