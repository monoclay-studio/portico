# Agent run: Steward review: integration module

- Started: 2026-11-07T11:20:39.863Z · last activity: 2026-11-07T11:39:55.186Z
- Turns: 221 · tool uses: 129 · output tokens: 206,237
- Type: general-purpose

## Brief (2026-11-07T11:20:39.863Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/integration-core` in worktree /home/user/wt/integration — module `integration` (connector framework; spec: /home/user/portico/docs/specs/integration.md; adoption specs: /home/user/portico/docs/adoption/connection-lifecycle-and-health-spec.md, source-of-truth-matrix.md, evaluation-and-trial.md). Author's README: modules/integration/README.md; FOUNDATION_REQUESTS.md (note FR-1 is already fixed on main in commit 8d58366).
Focus extra care on: (a) SECURITY of outbound webhooks and connector calls — SSRF / DNS-rebinding to private addresses (FR-5): judge whether the module must block private/link-local/metadata IPs at send time (it should) and specify the fix; HMAC signing and secret handling; credentials never logged or returned; (b) exactly-once inbound application and never-blind-replay outbound after reconnection — try to break both with concurrent deliveries in a scratch copy; (c) trial organizations can never write to real systems; (d) honesty of catalogue statuses (no connector presented above R3; file connector never "live"); (e) the 9-step journey vs the adoption spec; (f) the `integration.inbound.applied` event design vs the spec's handler port — which is better for "applied means applied" (no module consumes it yet).
Do not modify the worktree; experiment in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration-copy. Use PORTICO_TEST_DB_PREFIX=review_integration. Parity: /home/user/wt/parity-ops/docs/parity/integration.md if present. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration.md.
````

## Report (2026-11-07T11:39:55.104Z)

````text
**Verdict on `feat/integration-core` (module `integration`): merge after fixes.** Findings: P0 1 · P1 8 · P2 10 · P3 10.

Full report: `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-integration.md`. The worktree was not modified.

**Commands** (run on an exact copy of HEAD `8f95d16`):
- `pnpm lint`, `pnpm typecheck`, the integration tests (93) and the api tests (14) all pass.
- With main's code changes applied (the merge is clean), the api tests (15, including the new permission-catalog test) and platform tests also pass. FR-1 is resolved on main.
- The parity gate fails: there is no `integration.md` in `parity-ops/docs/parity`.

**Probes I added** (copy only, `modules/integration/test/zz-review-concurrency.test.ts` and `zz-review-ssrf.test.ts`):
- PROBE-1 and PROBE-4 hold: the same revision ingested concurrently applies once, and concurrent dispatch sends once.
- PROBE-2, 3, 5, 6, 7, 8, 9 and 10 fail, so each of those bugs is reproduced.

**Top 5 findings:**
1. **F1 (P0) – webhook SSRF.** The URL check accepts `[::ffff:127.0.0.1]`, `[::ffff:169.254.169.254]`, `[fe90::1]`, `localhost.` and any port. The production transport has no check when it sends, so DNS names pointing at private addresses are reached. A code comment wrongly says DNS rebinding is handled. The module must block private, link-local and metadata addresses at send time; the report specifies a shared safe-fetch with resolve-and-pin, the range list, port and literal-IP rules, an egress proxy, and tests.
2. **F2 (P1) – blind replay after reconnection.** If a send is in flight when someone pauses and resumes, the send's completion overwrites `needs_revalidation`. The command goes back to queued and is then sent with nobody approving it (PROBE-5, `sentToVendor:1`). Adapter calls also have no deadline relative to the 60-second lease.
3. **F3 (P1) – effect classes fail open.** Any undeclared operation (e.g. `charges/post`) is classed `standard` (PROBE-9). Reservation create and update are also `standard`, against INT-R19.
4. **F4 / F5 (P1) – two more money and ordering bugs.**
   - Disconnect turns an uncertain charge the vendor already holds into `cancelled` and emits a cancelled event (PROBE-6).
   - When two ingestions run at once, an older revision can overwrite a newer one, because the watermark upsert has no guard. This happens through two concurrent CSV imports (PROBE-7) and directly (PROBE-2).
5. **F6–F9 (P1) – design, demo and contract problems.**
   - **F6:** `integration.inbound.applied` doesn't guarantee "applied means applied". The vendor is acknowledged first. The outbox gives no per-record ordering. Consumer failures go dead silently after 12 attempts. Guest names end up in the outbox, which cannot be deleted. The spec's handler port is the better design (focus f); operations' `applyExternalRoomStatus` already has that synchronous shape.
   - **F7:** the worker builds its own empty simulator. Its first periodic sync flips every simulator connection to `error` and raises a false urgent "credential rejected" exception (PROBE-10).
   - **F8:** a live organization can make an in-memory simulator the system of record for charges.
   - **F9:** identity-plus's platform `setDataAuthority` will refuse activation for charges, payments, accounting and availability (`second_approval_required`). Platform also expects integration to provide `pendingOperations`, which doesn't exist yet.

**Other focus areas:**
- **(c) Trial safety** holds at five layers. The remaining gap is that the vendor acknowledge call is never classified as a write (F13).
- **(d) Catalogue honesty** passes: nothing is above R3, and the file connector is never shown as live. Minor nits are in F17, and the readiness register still says R1 (F16).
- **(e) The 9-step journey** is mostly built. It lacks an approval or two-person activation step, the full validation checks, and scope changes on an active connection.

Notable P2s:
- F11: two concurrent raises of the same exception abort the whole transaction (PROBE-8).
- F12: users scoped to one property can read another property's rows on a shared connection.
- F15: the webhook retry window is about 22.4 h, short of the required 24 h, and records held during an authority switch are never reprocessed.
- F18: raw guest data in append-only tables cannot be erased.
````

