# Steward review — distribution (Channex adapter, ARI engine, inbound revisions, simulator)

Playbook: `docs/quality/playbooks/steward-reviewer.md` v2.1 (launch brief as given), plus the run's focus areas (a)–(g).
Reviewer: architecture steward (independent). Date: 2026-11-08.

- **Branch / commit reviewed:** `feat/distribution-channex` @ `a8bd950a8c0c5d31eedf161f5e16386b54cc5971`
- **Merged copy:** `a8bd950` + `main` @ `2df56d1` → merge `d2737e6` (clean merge, no conflicts), in a scratch worktree.
- **DB prefix:** `PORTICO_TEST_DB_PREFIX=review_distribution`

## Verdict: **merge after fixes**

The four owner requirements are mostly well built — the budget holds under real multi-worker concurrency on one
clock, 429 storms are respected, revisions are durable before the 200, acknowledgements follow only committed final
outcomes (the CHECK mutant is killed), and no path reaches a real hub from demo/trial/training or production from
sandbox (live is refused). But requirement 1 ("no polling loops") is violated in the two most ordinary blocked states,
and requirement 3's ordering can lose a booking modification or strand a creation. Fix P1-1, P1-2 and G-1 (lint, a
merge blocker) before merging; P2-1 (the surviving mutant's test) should land with P1-2. Nothing here can touch a real
Channex until the owner provides keys, which is why this is not "do not merge".

**Counts:** P0 0 · **P1 2** · **P2 9** (P2-1…P2-8, G-1) · **P3 9** (P3-1…P3-9).
**Mutation:** builder's M1, M2 killed; reviewer's M3 **survived** (P2-1).
**Coverage:** checklist 15/15 declared; patterns 61 declared — 52 applicable (15 probed, 34 code-read, 3 applied as
review steps), 9 not applicable with reasons, 0 applicable left unprobed (§ 5).

| ID | Sev | One line |
|---|---|---|
| P1-1 | P1 | Revoked key or external system of record + one pending change → the organization re-runs every 1 s forever (A1/A2) |
| P1-2 | P1 | Equal/absent hub timestamps: modification acked as `stale` (lost), or creation waits forever behind its parked cancel (A3/A4) |
| P2-1 | P2 | Mutant: per-booking ordered wait removed → 91/91 module + 3/3 API tests still green; PAR-DST-023 overclaims |
| P2-2 | P2 | Budget trusts worker clocks (20 grants in 2 s for limit 10 with 2 s skew) and reservation instants (11 at the hub) |
| P2-3 | P2 | Unrecognised ARI answers (warning without index; 200 with `errors`) are recorded as accepted |
| P2-4 | P2 | Simulator mirrors 7 unverified wire assumptions; 4 wire assumptions live in `client.ts`, not `wire.ts` |
| P2-5 | P2 | Webhook limit keyed per IP shared by all tenants; each unauthenticated post is a permanent row (B6) |
| P2-6 | P2 | A live tenant claims another hotel's production hub property at creation, before any proof (B7) |
| P2-7 | P2 | Guest PII in an append-only table with no erasure/retention (declared FR-5, not built) |
| P2-8 | P2 | Change-capture consumer silently drops unparseable events |
| G-1 | P2 | `pnpm lint` exits 1 on the merged tree (7 warnings, `--error-on-warnings`) |
| P3-1…9 | P3 | Stale hub webhooks; "since T" truncation; readiness register; Dismiss scope; search limit; service-level permission; resync anchor; no dead-man; `owner` |

PoCs: `docs/orchestration/reviews/distribution-poc/zz-review-{a,b,c}.test.ts.txt` (run in the scratch copy under
`modules/distribution/test/`; each `expect` states the safe behaviour, so a failing probe is a reproduced defect —
set C passes and is evidence of clean areas).

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

### P2-5 · Webhook abuse resistance: the rate limit is keyed on the client IP shared by every tenant, and each unauthenticated request writes an append-only row (focus d, AP-12)

- **Where:** `src/routes.ts:525` (`rateLimit: { max: 600, timeWindow: '1 minute' }` — the same per-IP key and value as
  the global default in `packages/http/src/server.ts:111-115`), `src/service/webhooks.ts:84-86` (`logDelivery(…
  'unauthenticated')` into `distribution.inbound_deliveries`, which is `make_append_only`).
- **Reproduction:** `zz-review-b.test.ts.txt` B6 — 50 posts with wrong tokens to a known endpoint → **50** permanent
  `unauthenticated` rows in the victim organization (`expected 50 to be less than 50`).
- **Why it matters:** (1) Channex delivers every hotel's webhooks from a few egress IPs, so all Portico tenants share
  one 600/min bucket per hub IP; growth in tenants turns into 429s on legitimate booking deliveries (recovered only by
  the 15-minute pull). (2) The limit does not bound writes per endpoint: anyone who learns an endpoint URL (it is shown
  to every `distribution.channel.read` holder, `connections.ts:98-102`) can grow an undeletable table at 600 rows/min
  per source IP. What held: the token check is constant time over SHA-256 (`webhooks.ts:36-41`), the endpoint id has
  74 random bits, routing goes through a definer function the app role cannot bypass, and the payload's property is
  checked against the connection (C1 shows the directory is unreadable by `portico_app`).
- **Fix (principle):** *limits on a public receiver are keyed on what identifies the protected resource (the
  endpoint), not on who is sending; refused requests cost the receiver a bounded, aggregatable amount of storage.*
  Key the webhook limit on `endpointId` (plus a per-IP limit for unknown endpoints), and record unauthenticated
  attempts as a per-connection counter/rolling window (`unauthenticated_count`, `last_unauthenticated_at`) or a
  sampled log, never one append-only row each. **Attack run against the fix:** one attacker floods endpoint A to
  exhaust A's bucket — the real hub's deliveries to A then fail; mitigate by exempting requests that pass the token
  check from the bucket (check token first, cheaply, before counting).

### P2-6 · A production hub property is claimed at creation, before anyone proves access to it (AP-03 / AP-08 / AP-47)

- **Where:** `migrations/0001_distribution.sql` (`webhook_directory_production_uq` on rows synced for every
  non-disconnected connection, including `setup`), `src/service/connections.ts:157-246` (creation needs only a hub
  property id and any API key; the key is first tried at Verify).
- **Reproduction:** `zz-review-b.test.ts.txt` B7 — a live organization creates a connection for
  `real-hotel-channex-property` with an invalid key; the real hotel then gets `connection_exists`. The builder's own
  test shows a live creation succeeding before the live-scope refusal (`ari-engine.test.ts:420-428`).
- **Why it matters:** hub property ids appear in URLs, exports and support threads; any live tenant can block a hotel's
  go-live until Monoclay support intervenes (the error text sends the hotel to support). Reverse-order attack (AP-08):
  the squatter acts before the hotel exists in Portico.
- **Fix (principle):** *a global claim on an external identifier is taken only by proof of control of it, and an
  unproven claim never blocks the proven owner.* Sync the directory row as `active` only after Verify succeeded with a
  key that can read that hub property (`credential_state = 'valid'`); on a contested claim, the verified connection
  wins and the unverified one is set `disconnected`. **Attack run against the fix:** the squatter holds a valid key for
  a *different* hub property and enters the victim's id — Verify reads `GET /properties/{victim}` with the squatter's
  key, which must fail (unverified `property.get`; confirm at R4 that a key cannot read foreign properties). Sibling:
  `rotateCredential` keeps the claim while the new key is unverified — it must re-verify against the same property.

### P2-7 · Guest personal data sits in an append-only table with no erasure or retention path (AP-17)

- **Where:** `src/service/inbound.ts:140` (`payload: json(rev)` — customer name, e-mail, phone, country, free-text
  notes), `migrations/0001_distribution.sql` (`make_append_only('distribution.inbound_revisions')`). Declared as a known
  gap (README; FR-5), not built.
- **Why it matters:** the guests module's erasure flow cannot reach it, and nothing expires it. Card data is correctly
  excluded (the normalized `HubRevision` has no guarantee fields; the simulator's masked card is dropped), and no
  revision content reaches logs, events, search hits or the revision view (code-read; C2 for secrets).
- **Fix:** FR-5 as proposed (a reviewed definer redaction function keeping ids and hashes, called by guests' erasure
  and a retention job), **before** any live or trial-with-real-data connection. **Attack run against the fix:** the
  redaction changes `payload` but not `payload_hash`; a later redelivery of the same revision would then hash
  differently from the stored payload — compare redeliveries with `payload_hash` only (already the case) and never
  re-hash the stored payload. Sibling stores: `reservations.channel_revisions.payload` (same data, other module).

### P2-8 · The change-capture consumer silently drops events it cannot parse (AP-35 / AP-43)

- **Where:** `src/service/jobs.ts:245`, `:262`, `:274` — `if (!p.success) return;`.
- **Why it matters:** a producer schema change (the producers export no Zod schemas yet — FR-4) stops change capture
  for that event type with no exception, no log and no health signal; channels go stale until the 24 h resync. The
  consumer is marked processed, so the event is never retried.
- **Fix:** on a parse failure raise a property-level distribution exception (code `change_event_unreadable`, urgent,
  responsible Monoclay) and mark the property's connections fully dirty for the event's kind (a resync is safe because
  values are read at send time). **Attack run against the fix:** an event for a property with no connection must not
  raise anything (check `publishingConnections` first).

### G-1 (P2, merge-blocking) · `pnpm lint` exits 1 on the merged tree

- `--error-on-warnings` is now on main; the branch carries 7 warnings (see § 1). The builder reported "lint 0 (7
  warnings)" against older main — the E-094 class. Mechanical fix: apply the four `useOptionalChain`/`useMathMinMax`
  fixes and replace the three `!` in `domain.test.ts` with a checked helper.

### P3 findings

- **P3-1 · Old webhook registrations stay live at the hub; concurrent Verify registers twice** (AP-59, rule 7).
  `rotateWebhookToken` (`connections.ts:631-643`) and `disconnectConnection` never remove the hub-side webhook; the
  next Verify `POST /webhooks` adds another (`connections.ts:281-286`), so every booking event then arrives once with
  the old token (401, one more append-only row — P2-5) and once with the new. Two concurrent Verify calls both see
  `webhook_registered_at = null` and both register (no Idempotency-Key, no lock across the call). Fix: store the hub
  webhook id, update or delete it on rotation/disconnect, and serialize Verify per connection.
- **P3-2 · "Re-request since T" truncates silently and compares unlike things.** `inbound.ts:1078-1122`: the booking
  list is capped at 20 pages without a "truncated" signal, so Portico bookings beyond page 20 are flagged
  `not_at_channel`; the hub is filtered by booking `inserted_at ≥ T` while Portico's side is revisions **received** since
  T, so a booking created before T and modified after T is a false discrepancy; `known` loads every revision of the
  connection into memory (AP-54 volume). Fix: return and display `truncated`, compare the same field, query `known`
  for the listed booking ids only.
- **P3-3 · Readiness register not updated.** README says R3; `docs/readiness/readiness-register.md:66,93` still say R1
  for "Distribution core" and "Channex". Add the R3 row with evidence (tests, date, simulator only) — AP-62.
- **P3-4 · Dismiss reaches never-processed revisions.** `inbound.ts:1217` allows Dismiss on `received` (not yet
  attempted); the reservations agent role now holds `distribution.reservation.recover`, so an agent can acknowledge a
  new booking away before Portico ever tries it. Limit Dismiss to `parked`, `failed`, `rejected` (and to `received`
  only when it waits on an earlier revision, with that reason shown).
- **P3-5 · Search applies `limit` before the permission filter** (`search.ts:22-48`): a property-scoped user can get
  no hits while other properties' rows fill the limit. Filter by scope in SQL.
- **P3-6 · `pullFeed` and `recoverSince` check no permission themselves**; the route checks in a separate transaction
  first (`routes.ts:276-281`). Move `requireOnConnection(P.reservationRecover)` into the services.
- **P3-7 · "Nightly" resync runs every 24 h from activation time** (`connections.ts:432`), not at a property-local
  quiet hour; a resort activated at 10:00 re-sends 400 days at its morning peak. Anchor to the property's time zone.
- **P3-8 · No dead-man signal for the distribution scheduler** (AP-61). If `distribution.dueWork` stops (worker down,
  job disabled), nothing alarms: the feed pull, the 24 h resync and acknowledgements simply stop, and the stored
  `health` keeps its last value. Add "last successful tick per organization" and "last full resync" to the health facts
  with an alarm on absence of success within the period (one wake per period, compatible with P1-1's fix).
- **P3-9 · Universal record contract: `owner` is never set** on connections (`contracts.ts:298` optional, not populated
  in `connectionView`) and revisions have no `owner` at all. A parked or failed revision is exactly the record that
  needs an owner (CLAUDE.md §4.17).

## 3. Mutation proof (focus e)

| Mutant | Source | Guard | Test run | Result |
|---|---|---|---|---|
| M1 | builder § 5 | `revision_processing` CHECK (`ack_state = 'not_due' or state in final`) replaced by `check (true)` | `test/regressions.test.ts` | **killed** — "an acknowledgement can never be due … (CHECK)" fails |
| M2 | builder § 5 | `.forUpdate()` removed from `loadBudget` (`ari-dispatch.ts:75`) | `test/ari-engine.test.ts -t concurrent` | **killed** — 20 of 20 reservations granted against a limit of 10 |
| M3 | reviewer | per-booking ordered wait disabled (`inbound.ts:680`, `if (false && …)`) | full module suite + `apps/api/test/distribution.test.ts` | **survived** — 91 passed + 2 todo; API 3 passed → **P2-1** |

All three were restored (`git checkout`) in the scratch copy after each run.

## 4. The builder's claims, verified

| Claim (builder report, verbatim or close) | Verdict | Evidence |
|---|---|---|
| "On the merged tree … lint, typecheck and the test gate all exit 0" | **No longer true** — lint exits 1 against current main | § 1, G-1 |
| "Nothing polls the inventory or rates tables. The only periodic work is a 2-second tick that wakes organizations whose work is due." | **Refuted for blocked states** | P1-1 (A1/A2: re-run every 1 s) |
| "The budget is a sliding window: never more than the limit in any 60 seconds." | Holds on one clock under concurrency (B1, M2 killed); **refuted** under clock skew and latency | P2-2 (A5, B5) |
| "HTTP 429: pauses the budget for at least 60 s" | Confirmed | B2: gaps 62 000, 60 000 ×4 ms; all 10 changes arrived |
| "Refused key (401/403): stops that connection only" | Confirmed (sends stop); but it starts the loop in P1-1 | A1 |
| "Nothing is published while an external system is authoritative for availability" | Confirmed (A2 sent nothing); loop in P1-1 | A2 |
| "Every hub call re-checks the environment" | Confirmed by code: all 9 hub call sites go through `hubContext` → `hubModeFor` (`common.ts:97-140`) | code-read |
| "Each revision is stored, unchangeable, before the 200 is returned" | Confirmed (insert + processing row + commit before the answer; `make_append_only`) | `webhooks.ts:82-161`, migration |
| "The same revision id with different content raises an urgent conflict and the first version stands" | Confirmed; the design choice is questioned in P2-4 item 3 | B8 |
| "Processing is ordered per property" | Per-property lock yes; **order within a booking is wrong at ties and untested** | P1-2, P2-1 |
| "Acks are sent from a later transaction and only for final outcomes; a database check also enforces this." | Confirmed | M1 killed; code-read `inbound.ts:740-903` |
| "Genuinely concurrent tests for the budget, dispatchers, the ack-before-commit window, and duplicate deliveries" | Budget test is genuine (M2). Cross-worker and cross-connection concurrency was **not** tested by the builder (B1, B3, A5 added here) | — |
| "Parity coverage rose … to 31% of rows and 47% of edge cases. The module's parity gate still fails" | Confirmed exactly (`parity-report --gate distribution` exit 1: 21 P0 untested, 20 P1 missing) | § 6 |
| § 5 "Every guard below made its test fail when disabled" | 2 of 2 re-run killed; the list omits the per-booking ordering guard, which survives | M3 |
| "No port takes an optional scope" | Confirmed (`ports.ts`: every `propertyId` required) | code-read |
| "Card data is never read or stored" | Confirmed: the stored payload is the normalized `HubRevision` (no guarantee fields) | `inbound.ts:140`, `wire.ts:420-475` |
| "Secrets never in responses, idempotency records, audit or the simulator view" | Confirmed for audit, outbox, exchange log, settings (C2); idempotency stores a request **hash** only and the create replay drops the token | C2; `packages/db/src/idempotency.ts:78` |

## 5. Coverage declaration

### Checklist

| # | Item | Result |
|---|---|---|
| 1 | Tenant isolation | probed — clean (C1: 18 tables, RLS enabled+forced except `tenant_schedule` (enabled, documented) and `webhook_directory` (no app grant, C1); builder isolation tests) |
| 2 | Authorization | code-read + sweep — finding P3-6 (`pullFeed`/`recoverSince`); all other route-reachable services check at the record's property |
| 3 | Money & finance | not applicable (distribution moves no money; channel prices pass through as integer minor units — `fromDecimal` exact, excess precision refused, code-read) |
| 4 | Idempotency & concurrency | probed — findings P2-2, P3-1; B1/B2/B3 clean |
| 5 | Events & audit | code-read — finding P2-8 (consumer drops); emitted names match spec § 7 (+ `stopSell.released`, documented) |
| 6 | Contracts | code-read — clean; FR-1/FR-3/FR-4 deviations documented; reservations `revision` is `bigint` and accepts the ~1.8e15 order |
| 7 | Data authority & environment safety | probed — finding P1-1 (blocked loop); publication blocking and env/target re-check clean (A2; code-read of all hub call sites; builder tests) |
| 8 | Errors & UX contract | code-read — clean (every exception carries problem, impact, party, next step) |
| 9 | Spec coverage | see § 6 |
| 10 | Scenario claims | see § 6 |
| 11 | Honest readiness | code-read — finding P3-3 (register not updated); README levels honest (R3, simulator ≠ integration) |
| 12 | Code quality | gates — finding G-1; no `any`, no default exports, no `new Date()` in `src/domain` (grep) |
| 13 | One-product experience | code-read — finding P3-9 (`owner`); status/allowedActions/issues/links/recordTypes/search present |
| 14 | Competitive parity gate | probed — gate fails (declared); PAR-DST-023 `tested` overclaims (P2-1) |
| 15 | Cross-module coherence | code-read — notes in § 7 |

### Patterns (groups A–E; group F not applicable — no UI in this branch)

| Pattern | Result |
|---|---|
| AP-01 cross-property reference | code-read — clean (mappings validate unit type/rate plan at the connection's property; hold release and rate values verify property in the port binding) |
| AP-02 cross-tenant by id | probed — clean (C1; builder isolation suite) |
| AP-03 claimable external identifier | probed — finding P2-6 (B7) |
| AP-04 trust attribute from client | code-read — clean (target from environment; settings are hotel configuration) |
| AP-05 ungated endpoint | probed (sweep of exported services) — finding P3-6 |
| AP-06 permission catalogue | probed — clean (api `permission-catalog` test green on merged tree) |
| AP-07 org controls global credential | not applicable (no global identities) |
| AP-08 pre-hijacking (reverse order) | probed — finding P2-6 (squatter first) |
| AP-09 privilege equivalence | code-read — no administrator-equivalent permission; see § 7 note on `simulator.control` |
| AP-10 separation of duties | not applicable (no approval flows) |
| AP-11 step-up windows | code-read — clean (`connection.manage` flagged sensitive) |
| AP-12 rate limit keyed wrongly | probed — finding P2-5 (B6) |
| AP-13 XFF spoofing | code-read — inherits `packages/http` trusted-proxy setting; the webhook limit should not be per-IP at all (P2-5) |
| AP-14 SSRF | code-read — clean (exact host allowlist, https default port, no redirects, deadline, body cap; no customer-supplied host) |
| AP-15 secrets persisted/replayed | probed — clean (C2; idempotency stores hash; token shown once) |
| AP-16 shared-device cache | not applicable (no UI) |
| AP-17 PII after erasure | code-read — finding P2-7 |
| AP-18 privacy bypass via secondary path | code-read — clean (no guest data in views, search, events, exceptions) |
| AP-19 simulator/dev path in live; env change mid-operation | code-read — clean (simulator controls refuse live and non-simulator targets; target re-checked per call; builder test) |
| AP-60 stored control fact on one path | code-read — clean (authority, live scope and credential state checked on every send/ack/feed/recover path) |
| AP-53 delegated port parameters | code-read — clean (holds and ingestion bound to the connection's property and validated mappings) |
| AP-20 concurrent over-correction | code-read — clean (hold release + apply in one savepoint under the property lock) |
| AP-21 retry duplicates effect | code-read — clean (unique revision key; reservations idempotent on revision; builder "exactly once" test) |
| AP-22 agreed terms | not applicable (terms are reservations'/rates') |
| AP-23 money boundaries | code-read — clean (`toDecimalString` negatives/exponent 0/3; `fromDecimal` rejects excess precision and unsafe integers) |
| AP-24 tax base | not applicable (no tax computation; `amountsIncludeTax` passthrough) |
| AP-25 limit reset by re-apply | code-read — clean (budget keeps its slot log across settings changes) |
| AP-26 uncertain shown as definite | probed — finding P2-3 (B4) |
| AP-27 net-of-fee | not applicable |
| AP-28 double collection | not applicable |
| AP-29 time semantics | code-read — findings P1-2 (TZ-less hub timestamps parsed as local), P3-7 (resync anchor); window from property business date is correct |
| AP-30 dedupe before effect | code-read — clean (store → process → ack after commit; 15-min feed pull backstop) |
| AP-31 out-of-order | probed — finding P1-2 (A3, A4) |
| AP-32 unexpected state retried forever | code-read — clean (Zod/refusals → `rejected` + exception; retryable errors back off and escalate) |
| AP-33 stale offline write | not applicable |
| AP-34 in-flight replay after pause/resume | code-read — clean (late answers ignored by lease token; resume re-sends current values, non-destructive) |
| AP-35 unknown value fails open | probed — findings P2-3, P2-8; settings fall back to safe defaults |
| AP-36 read before lock | code-read — minor: `claim` reads `status` before `lockAri` (a pause committing in between lets one message go); revision/ack paths re-check under lock |
| AP-37 external effect inside tx | code-read — clean (claim → call → record; verify between two transactions) |
| AP-38 data authority bypassed | probed — clean for publication (A2); loop is P1-1 |
| AP-39 duplicate insert aborts tx | code-read — clean (`on conflict do nothing` + re-read in `raiseException`; dirty set under `lockAri`) |
| AP-56 one-time transition races writers | code-read — clean (disconnect supersedes in-flight messages; late answers ignored) |
| AP-59 external holder keeps acting | code-read — finding P3-1 |
| AP-40 port vs provider | code-read — clean (compat tests; revision type matches) |
| AP-41 fake more lenient | code-read — note: the strict reservations fake lacks the real provider's "later cancellation wins" (R-05) path; scenarios are fake-bound (declared) |
| AP-42 copied enum | code-read — clean (provenance `satisfies Provenance[]`; severity/party copies pinned by compat test, FR-1) |
| AP-43 event payload drift | code-read — finding P2-8; FR-4 |
| AP-44 save-time vs use-time validation | code-read — minor: a fallback rate plan archived after saving is only caught at ingestion (refusal → exception) |
| AP-45 sibling paths | applied to every finding (siblings listed in P1-1, P1-2, P2-6, P3-1) |
| AP-46 failure commits partial state | code-read — clean (apply in a savepoint; refusals before writes) |
| AP-47 weaponized refusal | probed — finding P2-6; P2-5 (bucket exhaustion considered in the fix) |
| AP-48 effective-dated bounds | not applicable (no effective-dated rules here) |
| AP-54 load-bearing check | applied — P1-1 fix relies on `rotateCredential` scheduling (included); P2-6 fix relies on unverified `property.get` (flagged for R4); P2-3 fix relies on a read-back endpoint (unverified, R4) |
| AP-57 premise writers | applied — P2-6: `credential_state = 'valid'` is also written by any accepted ARI message (`ari-dispatch.ts:495-501`); acceptable only if a key cannot publish to a foreign property (R4) |
| AP-58 lifecycle closure | code-read — clean for exceptions (self-resolving), holds and protection; webhook registrations not closed (P3-1) |
| AP-50 claim not backed by test | probed — § 4 table; README "No polling loops" refuted (P1-1) |
| AP-51 scenario only against fakes | code-read — S02/S20 bind the strict reservations fake (declared; S02 money/inventory `.todo`) |
| AP-52 gate integrity | probed — G-1 (lint red); typecheck/test forced, uncached, exit codes read |
| AP-61 dead-man switch | code-read — finding P3-8 |
| AP-62 recorded decision differs from code | code-read — P3-3 (register), P1-1 (README "no polling") |
| AP-55 test exercises without asserting | probed — P2-1 (M3 survivor); E02 asserts only the timestamped path (P1-2) |

**Counts:** 61 patterns in A–E. Applicable 52: probed 15, code-read 34, applied as review steps 3 (AP-45, AP-54, AP-57); not applicable 9 (each with a
reason above); applicable but not probed 0.

## 6. Spec coverage and scenario claims

**MUSTs missing or partial** (verified against the code; all declared in the README unless marked):
DST-R01 (not an integration connection; per-workflow support levels are `WIRE_FACTS` statuses), DST-R02 (occupancy and
child-price compatibility checks not built), DST-R03 (per-channel caps/holdbacks not built), DST-R08 (ordering defect —
**not declared**, P1-2), DST-R11 (works; truncation and comparison caveats — **not declared**, P3-2), DST-R12 (partial),
DST-R13 (push/SMS/e-mail alerts not built), DST-R15 (enforced; loop — **not declared**, P1-1), DST-R16 (booking engine,
increment 3). Parity gate: exit 1 — 21 P0 untested, 20 P1 missing (declared: booking engine, VCC, channel tax rows).

**Scenario claims:**
- **S02/E02** (`scenario-s02-channel-ingestion.test.ts`): demonstrates duplicate, modify, cancel and cancel-before-create
  for the distribution part, against the strict reservations fake; Money and Inventory lines are `.todo` (declared).
  The reorder passes only because the simulator supplies distinct, increasing timestamps; with equal or missing
  timestamps E02 fails (A3, A4).
- **S20** (`scenario-s20-hub-outage.test.ts`): banner with stale-since, protection, coalesced queue within the budget,
  resend, recovery pull storing 2 missed revisions (created + conflict), protection released — asserted. Fake-bound for
  reservations (declared).
- **E04** (revoked key): asserted for "stops that connection only"; the same state is the P1-1 loop.
- **API** (`apps/api/test/distribution.test.ts`): real composition; booking stored and **not** acknowledged because
  reservations' rates port is unbound on main (declared `blocked-by-binding`).

## 7. Cross-module notes for the orchestrator

- **PII twin:** `reservations.channel_revisions.payload` holds the same guest data as `distribution.inbound_revisions`;
  FR-5's redaction must cover both (owner: guests erasure flow).
- **Producer schemas (FR-4)** would remove the silent-drop risk in P2-8; inventory and rates own them.
- **Integration duplication (FR-3):** distribution keeps its own connections, exceptions and exchange log beside
  integration's; until merged, distribution exceptions are absent from "My work".
- **Shared vocabularies (FR-1)** and a body-returning `safeFetch` (FR-2) are kernel/http candidates.
- **Identity role templates** were changed from a module branch (reservations agent gains `distribution.channel.read`
  and `distribution.reservation.recover`); see P3-4 on what "recover" lets an agent do.
- **`distribution.simulator.control`** is organization-scoped and creates (simulated) channel bookings, hence real
  reservations, at **any** property of a demo/trial/training organization — a property-scope bypass inside non-live
  organizations (a trial holds a copy of real hotel data). Not administrator-equivalent; consider property scope.
- **Fake vs provider (AP-41):** the reservations fake lacks R-05 ("a later cancellation that arrived first wins");
  re-run S02 against the real provider once `termsFromChannelPrices` is bound.
- **Scheduler capacity:** P1-1 is shared-worker starvation at scale — every blocked organization is claimed every tick
  (batch 20, sequential), delaying healthy organizations' ARI.

## 8. Cleanup

Scratch worktree removed (`git worktree remove --force` + `prune`); no `review_distribution*` database remains (each test run dropped its own; a final query found 0). The worktree under review is untouched at `a8bd950`. Nothing was committed by the reviewer (the orchestrator checkpointed a partial copy of this report in `91fa86b`).

Note for the orchestrator: my first gate attempt briefly wrote `lint.log`, `lint.exit` and `typecheck.log` into the shared `scratchpad/gates/` folder that the concurrent migration and day-close reviewers also use, before I moved to a private folder; if either relies on those three files, it should re-run its lint/typecheck gate.
