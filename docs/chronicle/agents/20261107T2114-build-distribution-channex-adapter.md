# Agent run: Build distribution + Channex adapter

- Started: 2026-11-07T21:14:50.867Z · last activity: 2026-11-08T05:46:15.845Z
- Turns: 268 · tool uses: 277 · output tokens: 477,071
- Type: general-purpose

## Brief (2026-11-07T21:14:50.867Z)

````text
You are the module owner for **distribution** in Portico, a cloud hospitality management platform: a TypeScript modular monolith at /home/user/portico. Your mandate (docs/orchestration/operating-model.md) is to make this module 3x–10x better than anything on the market: measured, not claimed.

The owner's direction: make Portico **Channex-ready**. Their requirements, verbatim:
- "ARI Engine: Your PMS must actively track and batch availability, rate, and restriction (ARI) changes (no heavy database polling loops)."
- "Outbox & Queue: A stable queue system that batches updates into Channex API calls while respecting their 20 ARI/minute rate limits."
- "Webhook Endpoint: A live endpoint in your PMS configured to receive, parse, and durably save booking delivery revisions."
- "Acknowledge Flow: A functioning mechanism that sends back booking confirmations/acknowledgments to Channex once received."

Read first:
- CLAUDE.md, especially the non-negotiable rules 1–17;
- docs/orchestration/module-agent-playbook.md;
- docs/quality/playbooks/module-builder-self-check.md (the latest version, v4). It is mandatory: § 5 invariant closure, and a test per sibling entry point;
- docs/specs/distribution.md, the full spec. It includes a Channex readiness note at § 3.2;
- docs/strategy/modules/distribution.md, your 10x brief;
- docs/parity/ for any distribution rows;
- docs/architecture/domain-map.md;
- docs/research/04-connectivity-payments-compliance.md (the channel-manager sections) and docs/research/05-digest.md (distribution items);
- ADRs 0003, 0004, 0010, 0014 and 0015.

Your worktree is /home/user/wt/distribution, on branch feat/distribution-channex, created from main. Create modules/distribution as a new module with its own `distribution` schema, following the pattern of the existing modules. Wire it in apps/api/src/composition.ts and apps/worker. Commit locally after each meaningful step, with Conventional Commits. Never push, and never amend, reset or rebase a pushed checkpoint commit. Postgres is at postgres://postgres@127.0.0.1:5432/postgres; use PORTICO_TEST_DB_PREFIX=w2_dist.

Build, simulator-first (roadmap principle: every external effect simulator-first):
1. **ARI engine.**
   - Consume `inventory.availability.changed`, `rates.prices.changed` and `rates.restrictions.changed` events via the outbox. NO polling loops.
   - Coalesce deltas per (connection, channel room, channel rate, date range); merge overlapping and adjacent ranges.
   - Run a full resync on connect, nightly over 400 days, and on demand. It must be non-destructive.
   - Keep last-acknowledged channel state per cell (DST-R06), and detect discrepancies.
   - Prices come from rates and availability from inventory. Never compute them here.
2. **Outbox queue and rate limiting.**
   - A per-connection token bucket, default 20 ARI requests per minute (configuration per connection).
   - While waiting for budget, keep merging so a burst becomes a few large calls.
   - Idempotent message ids, and acceptance recorded per message.
   - Rejection classification: a payload error means no retry, plus an exception with a plain-language fix. A transient error means backoff 5 s → 10 s → 20 s → 40 s, then every 1 min for at least 30 min, then an urgent exception.
   - Stop-sell protection (DST-R07).
   - No publication when an external system is authoritative for `availability` (DST-I05, data authority).
   - Environment safety: non-live environments go to the simulator or Channex staging only, through `assertExternalEffectAllowed`.
3. **Booking-revision webhook.**
   - A public endpoint for Channex booking-revision notifications.
   - Authenticate by a verified secret or signature. If Channex's actual mechanism is unconfirmed in our research, say so and make it pluggable.
   - Parse and durably store each revision immutably, keyed by (connection, channel booking id, revision).
   - Per-property ordered processing.
   - Out-of-order handling: park orphans, re-process, and raise an urgent exception after 15 min (DST-R09).
   - A recovery pull of revisions not acknowledged, in case a webhook is missed.
   - Duplicates are acknowledged and logged, never applied twice.
4. **Acknowledgement flow.** Acknowledge back to Channex ONLY after `reservations.ingestChannelBooking` (or the existing reservations channel-ingestion entry point; check its contract) has committed (DST-I02). Retry the ack until it is accepted. Never ack a revision that failed to apply; it goes to an exception with a recovery path.
5. **Channex adapter behind a port, plus an exact Channex API simulator.**
   - Use the existing integration module's connector framework where it fits: connections, secrets, safeFetch, exchange log, inbound handlers (`ports.inbound`).
   - Fault injection in the simulator: 429 rate limiting, 5xx, timeouts, duplicate and out-of-order deliveries, revisions for unknown bookings, partial acceptance.
   - Encode only Channex API facts that are verifiable. Where our research doesn't confirm an endpoint or field shape, mark the adapter field `unverified` in code comments and the README, and keep it in one mapping file.
   - Do NOT call the real Channex. Staging tests (R4) need the owner's staging key, so stop at R3 and say exactly what the staging run would check.
6. **Mappings, health and records.**
   - Product mapping between unit types and rate plans and channel codes.
   - A distribution health record: last successful push, oldest unacknowledged message, queue depth, budget use.
   - The universal record contract (status, allowedActions, issues, owner, links), the search provider, permissions in the manifest, role templates (revenue manager, reservations) and a demo seed with a simulated Channex connection.
7. **Proof.**
   - Implement scenario S02 (channel ingestion) and S20 parts that are now possible, following docs/scenarios/README.md and docs/quality/playbooks/scenario-tests.md (latest).
   - Prove the rate limit holds under bursts, ARI coalescing, ordering, exactly-once ingestion and ack-after-commit with concurrency tests.
   - A parity file docs/parity/distribution.md, with every `tested` row quoting its asserting test.

Before reporting, the gates on a tree merged with main:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Check exit codes.

Reply with:
- what is built, by owner requirement 1–4;
- the self-check tables, including § 5 invariant closure with each test shown failing without its fix;
- what is unverified about Channex's API;
- exactly what the staging test (R4) will check once the owner provides a Channex staging key.

A steward review will follow.
````

## Follow-up message (2026-11-07T22:33:16.296Z)

````text
[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.
````

## Follow-up message (2026-11-08T05:45:24.894Z)

````text
The coordinator sent a message while you were working:
Distribution fix round 1. The steward review says "merge after fixes": P0 0, P1 2, P2 9, P3 9.

Much held up well under attack:
- the budget held under real concurrency;
- a 429 storm handled correctly;
- revisions stored durably before the 200;
- ack only after a committed outcome;
- environment safety and live refusal;
- tenant isolation and secrets.

Thank you.

**Read first, all on main:**
- `docs/orchestration/reviews/review-distribution.md`
- the probes in `docs/orchestration/reviews/distribution-poc/zz-review-{a,b,c}.test.ts.txt`
- the "distribution fix round 1" line in `docs/orchestration/pending-fixes.md`

Merge main into `feat/distribution-channex` first.

**Must fix before merge:**
1. **P1-1, a polling loop.** A revoked key (E04), or an external system of record, plus one pending change makes the org re-run all its work every 1 s, forever (`jobs.ts:118-128`). It also rewrites the exception every pass and starves the shared scheduler.
   - Work that cannot progress must be parked until the blocking state changes: the key is re-verified, or authority returns.
   - The exception is written once per state change.
   - Turn the probes A1/A2 into regression tests.
2. **P1-2, revision ordering.** Today it uses `Date.parse` (millisecond precision, zone-less strings read as local time), breaks ties with a hash and falls back to arrival time.
   - Order on the hub's own sequence where it exists, otherwise on timezone-safe timestamps with a deterministic, causal tie-break.
   - A modification carrying the creation's timestamp must be applied, never acknowledged as `stale` (A3).
   - A cancellation that arrives first must never strand the creation (A4).
   - Mark any assumption about Channex's ordering fields as unverified in `wire.ts`, and add it to the R4 staging checklist.
3. **P2-1:** add a test that fails when the per-booking ordered wait (`inbound.ts:680`) is disabled. It survived the reviewer's mutant. Also correct parity row PAR-DST-023.
4. **G-1:** zero lint warnings. Main now runs `--error-on-warnings`; the merged copy failed with your 7 warnings.

**Then the P2s:**
- **P2-2:** the budget must not depend on synchronized worker clocks or on latency jitter. Use DB time and a safety margin, so the hub never sees more than its limit in any 60 s.
- **P2-3/P2-4:**
  - An unrecognised hub answer fails closed. That covers a warning with no index and a 200 carrying `errors`.
  - The simulator must stop mirroring the adapter's 7 unverified assumptions, so drift becomes visible.
  - Move the 4 wire assumptions from `client.ts` into `wire.ts`.
- **P2-5:** webhook rate limits per endpoint, not per IP (every tenant shares Channex's IPs). Unauthenticated posts are not stored permanently.
- **P2-6:** a live tenant cannot claim a production hub property before proving access to it.
- **P2-7:** an erasure path for guest data in stored revisions. Coordinate with guests' erasure contract; if it needs a guests port, declare it and bind a strict fake.
- **P2-8:** an unparseable change event raises an exception, never a silent drop.

**Then the cheap P3s.**

**Self-check v6** (`docs/quality/playbooks/module-builder-self-check.md`). Include the tables:
- § 5.1 state machines for a revision and for a connection's health, with external holders (the hub);
- pasted writer searches;
- a control-fact grid with an input-source column;
- the § 5.4 mutation table for every P1/P2 guard (each guard removed → its named test fails → restored);
- the § 6 claim ledger over the README, the spec and the parity rows you touch.

**How to work:**
- Commit after every meaningful step.
- Do not push.
- Never amend or rewrite commits.
- Gates: `pnpm lint`, `pnpm turbo run typecheck --force`, `pnpm turbo run test --force --concurrency=2`, all exit 0.

Address this before completing your current task.
````

## Report (2026-11-07T22:33:51.080Z)

````text
I've built Portico's distribution module with a Channex adapter and a Channex API simulator. All four owner requirements work end to end against the simulator, so readiness is R3. Nothing has called the real Channex. Real booking ingestion is still blocked on main: the reservations module can't price channel bookings yet. On the merged tree (main 6d18714, branch head a8bd950), lint, typecheck and the test gate all exit 0.

Work is on `feat/distribution-channex` in `/home/user/wt/distribution`, committed locally, not pushed.

## Built, by owner requirement

**1. ARI engine.**
- An outbox consumer listens for `inventory.availability.changed`, `rates.prices.changed`, `rates.restrictions.changed` and `platform.dataAuthority.changed`.
- It records only which nights changed, never values. Overlapping and adjacent date ranges merge per (connection, kind, unit type, rate plan).
- Values come from inventory and rates when a message is built, so only the latest state per night is sent.
- Nothing polls the inventory or rates tables. The only periodic work is a 2-second tick that wakes organizations whose work is due.
- Full resync runs on connect, every 24 h over 400 nights, and on demand for a date range. It only re-sends values and never removes anything.
- Last-acknowledged channel state is kept per cell. A check turns unexplained differences into discrepancies and re-sends them.

**2. Outbox and queue.**
- There is at most one open message per connection and kind. While it waits, newer changes merge into it, so 50 edits became one call.
- The default budget is 10 availability plus 10 restriction requests per minute, which matches your 20/min and Channex's published split. It is configurable per connection.
- The budget is a sliding window: never more than the limit in any 60 seconds. A standard token bucket would allow twice that within one minute.
- Each request is classified:
  - **Bad request:** never retried; raises an exception with a plain-language fix, and the cells show "not accepted".
  - **Temporary failure:** retries at 5 s, 10 s, 20 s, 40 s, then every minute; urgent after 30 minutes.
  - **HTTP 429:** pauses the budget for at least 60 s.
  - **Refused key (401/403):** stops that connection only, with an urgent exception.
- Stop-sell protection closes the last 2 units of a type while the connection is behind; there is also a manual stop-sell.
- Nothing is published while an external system is authoritative for availability.
- Every hub call re-checks the environment:

| Environment | Where calls go |
|---|---|
| Demo, trial, training | Simulator |
| Sandbox | Channex staging only |
| Live | Refused, until platform's activation scope is bound |

**3. Webhook endpoint.**
- The endpoint is `POST /v1/distribution/webhooks/channex/:endpointId`, routed by an unguessable id and rate-limited.
- Authentication is pluggable. The default is a secret token header compared in constant time; HMAC signatures are also supported.
- Each revision is stored, unchangeable, before the 200 is returned, keyed by (connection, channel booking id, revision id).
- A redelivery is logged as a duplicate. The same revision id with different content raises an urgent conflict and the first version stands.
- Processing is ordered per property:
  - **Orphans:** a modification or cancellation for an unknown booking is parked; after 15 minutes it raises an urgent exception, with "Apply as new" and "Dismiss" actions.
  - **Unmapped bookings:** they get a provisional inventory hold plus an urgent alert.
  - **Recovery:** a pull of unacknowledged revisions runs on webhook gaps and every 15 minutes, plus a "re-request since T" reconciliation.

**4. Acknowledgement flow.**
- The reservations change, the revision outcome and the ack due date commit in one transaction.
- Acks are sent from a later transaction and only for final outcomes; a database check also enforces this.
- A failed revision is never acknowledged. It retries, or a person retries or dismisses it.
- Acks are retried until Channex accepts them.

**Proof.** 91 module tests (2 todo) and 3 API tests. Scenarios S02/E02 and S20 pass at module level. There are genuinely concurrent tests for the budget, dispatchers, the ack-before-commit window, and duplicate deliveries. Parity coverage rose from 0% to 31% of rows and 47% of edge cases. The module's parity gate still fails: the booking engine, VCC and channel tax rows are outside this increment.

## Blockers and decisions for you

- **Real channel ingestion is blocked on main.** The reservations module can't price channel bookings until rates provides `termsFromChannelPrices`. The API test shows a booking is stored and **not** acknowledged, with an exception. So the module tests and the S02/S20 scenarios use a strict fake of reservations, which runs the real validation schema and permission check. S02's money and inventory lines are todo.
- **Live publication is refused** until platform's activation scope is bound.
- **I edited the identity module's role templates.** Reservations agents now get channel read and booking recovery. Revenue manager already had `distribution.*`.
- **Channex isn't an integration-module connection.** The integration catalogue can't host it yet, so distribution keeps its own connections, exceptions and exchange log.
- **Five foundation requests are filed** in `modules/distribution/FOUNDATION_REQUESTS.md`: shared vocabularies, a body-reading safe HTTP client, Channex as an integration connection, producer event schemas, and erasure for stored guest data.
- **Known gaps:** guest personal data in stored revisions has no erasure path yet. Only the base-occupancy price is published.

## Self-check (v4, as briefed)

The self-check playbook moved to v5/v6 on main during the run. I applied v4 plus one mutant per guard; I did not produce v6's claim ledger.

**§ 1 Gate block** (merged tree, exit codes read directly)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm lint` | 0 (7 warnings) |
| `pnpm turbo run typecheck --force` | 0 (19 tasks) |
| `pnpm turbo run test --force --concurrency=2` | 0 (17 tasks) |
| `pnpm turbo run test --force` (default concurrency) | not run |

**§ 2 Checklist (items 5–32):** 24 yes, 4 N/A, 1 no, 3 partial.

| Answer | Items |
|---|---|
| Yes | 5–12, 14, 20, 21, 23, 24, 25, 27, 30, 31, 32: isolation, permissions, concurrency, atomic effects, compatibility, strict fakes, authority, environment, no secrets, cited claims and readiness. 13 is satisfied by design: the consumer only marks cells, so a stale event re-sends current values at most. 26: one production hub property per organization, proven by test. |
| N/A | 16–18 (distribution moves no money); 19 (distribution provides no functions to other modules yet) |
| No | 29: erasure (foundation request) |
| Partial | 15: an unknown ARI outcome is retried, which is safe for absolute values. 22: producer event schemas (foundation request). 28: fixed-host transport instead of the shared safe client (foundation request). |

**§ 3 Findings I found and fixed during the build:**

| Finding | Commit | Test | (b) Siblings checked | (c) Failure path | (d) Griefing | (e) Atomic |
|---|---|---|---|---|---|---|
| A refused key on the feed pull raised no exception | 6d03086 | "a revoked key…" | ARI, ack, feed, verify, re-request since T | Only the flag and the exception are written | Only the hub's 401/403 can trigger it; recovery is re-verify | n/a |
| Re-request since T bypassed that rule, surfacing a bare 500 | 59c4580 | inbound "re-request since T" (refused key at the end) | Found by searching for every hub call site | Throws 502, changes nothing | Same as above | n/a |
| Rates were published while availability was external | 6d03086 | "nothing is published while…" | The only send path, plus activate and resume | Nothing is sent | Authority needs platform permission | n/a |
| One 5xx triggered stop-sell protection (flapping) | 6d03086 | "transient errors…" (no stop-sells) | Ack and apply failures use the same health rule | n/a | n/a | n/a |
| "Recovered" event missing for revisions woken from parking | 8b37b3a | S02 E02 | n/a | n/a | n/a | n/a |
| Lock-order cycle (outcome → connection → ARI lock) | 4208cda | Existing concurrency tests | All lockers follow connection → ARI lock → message → budget | n/a | n/a | No test provokes the cycle |
| Retry could re-open a dismissed revision | 2de3b8c | Orphan test (dismiss part) | Retry, apply-as-new, dismiss | Refused cleanly | n/a | n/a |
| Simulated booking not idempotent | 7cdd6f5 | API test | n/a | n/a | n/a | n/a |

Column (a) reverse order applies to none of these: no fix adds an "only when new" exception.

**§ 4 Contract integrity:** the grep checks are clean. `severity` and `responsibleParty` are equal copies of integration's, pinned by a compatibility test (modules can't import each other). Provenance is typed against the kernel. No port takes an optional scope.

**§ 5 Invariant closure.** Every guard below made its test fail when disabled; I disabled each one in turn and restored it afterwards.

| Invariant | Guard disabled | Test that failed |
|---|---|---|
| Ack only after a committed final outcome | Check constraint + final-state filter on ack claims + ack on failure | inbound "failed to apply is never acknowledged" |
| Ack only after a committed final outcome | Check constraint alone | regressions "acknowledgement can never be due" |
| One effect per revision | Property lock + re-check after lock | inbound "exactly once" |
| Channel state = last accepted payload | Lease token check | delivery-edges "late answer" |
| Channel state = last accepted payload | Sequence guard | regressions "OLDER message" |
| Budget never exceeded | Row lock on the budget | ari-engine "20 concurrent reservations" |
| No ARI while availability is external | Authority check | ari-engine "nothing is published while…" |
| No ARI while availability is external | Rates also blocked (narrowed back to rates only) | same test |
| Unmapped booking has an alert | Alert | inbound "parks with a provisional hold" |
| Unmapped booking has a hold | Hold release | same test |
| Orphans parked, not applied | Parking decision | S02 E02 |
| Parked orphan resumes when its booking arrives | Wake-up of parked orphans | S02 E02 |
| Escalation only after 15 minutes | 15-minute window | inbound "orphan never matched" |
| Refused key handled on every path | Feed path | ari-engine "revoked key" |
| Refused key handled on every path | Re-request since T path | inbound "re-request since T" |
| No protection flapping | Freshness-target rule | ari-engine "transient errors" |
| Environment decides the hub | Target re-check at each call | isolation "never reaches a hub" |
| Dismissed revision stays closed | Retry condition | inbound "orphan never matched" |
| One active connection per production hub property, across all organizations | Uniqueness | isolation "production hub property" |
| No secrets replayed | Idempotency replay plan | API "permissions, isolation, idempotent create" |

The writer lists were derived by searching the code for every writer of the ack and revision states and the key's state, and every hub call site. The duplicate re-ack filter on its own is redundant: the check constraint covers it, which the constraint test proves.

**Exemptions (BS4-2), each failing closed or defended:**
- No price for a night → that night is published closed, never with an invented price.
- Unmapped cells are dropped from a message rather than guessed.
- Unreadable stored settings fall back to the conservative defaults.
- Unknown errors are retried and never acknowledged.
- Missing guest surname → placeholder "Channel guest", flagged in the notes.
- Non-booking webhooks get a 200 and are logged.
- Dismiss acknowledges a revision that wasn't applied: it's an explicit, audited human decision.
- Simulator fault and outage controls aren't idempotent (test tools only).

## What is unverified about Channex

Direct fetches of `docs.channex.io` are blocked here. I confirmed some facts only from search-engine excerpts:
- Hosts and the `user-api-key` header.
- `POST /availability` and `/restrictions` taking a list of values.
- Limits of 10 + 10 per minute per property, with 429 when exceeded. A "coming soon" page says 5 per minute, which is why the limits are per-connection settings.
- The revision feed, ack and get-revision endpoints; unacknowledged revisions stay in the feed and Channex e-mails the hotel after 30 minutes; statuses `new`, `modified`, `cancelled`.
- Webhook settings: callback URL, event mask, custom headers, `send_data`.

**Unverified** (each marked in `src/adapters/channex/wire.ts`, the single mapping file):
- ARI fields:
  - Date field names, and whether the end date is inclusive (assumed inclusive).
  - Restriction field names and their "no restriction" values.
  - Rate sent as a decimal string.
- Responses and limits:
  - The success response shape, and partial acceptance via warnings.
  - `Retry-After` on 429.
- Bookings:
  - The revision JSON shape and attribute names.
  - That acknowledging twice is safe.
  - The "bookings since T" filter.
- Webhooks:
  - Whether webhooks are signed at all (assumed not).
  - The webhook body when it carries data, and event names other than `booking_new`.
- The credential test endpoint.

The simulator encodes the same assumptions independently, so it catches drift between adapter and simulator but cannot verify Channex itself.

## What the R4 staging test will check (once you provide a staging key)

1. The credential test returns 200 for the staging property and 401 for a wrong key.
2. Availability fields and date inclusivity, read back from Channex.
3. Restriction fields, the clearing values, and the rate format, read back.
4. The success response shape, and whether a bad value fails the whole request or comes back as a warning with an index.
5. Whether the 11th request in 60 s gets a 429 and `Retry-After`, confirming 10 + 10 or 5 per minute.
6. A real webhook from a staging OTA booking: event names, body, and whether our token header arrives; check whether any signature exists.
7. The real revision JSON: arrival-order timestamp, nightly amounts, child ages, who collects payment, and that no card data reaches us.
8. Acknowledgement: POST vs PUT, acknowledging twice, and that the revision leaves the feed.
9. Create, modify and cancel with webhooks off, then confirm the 15-minute pull recovers all three in order, and check the "since T" filter.
10. Channex's PMS certification checklist. Passing staging calls is not certification; submission (R5) and approval (R6) are separate.

The full module README with these details is at `modules/distribution/README.md`.
````

