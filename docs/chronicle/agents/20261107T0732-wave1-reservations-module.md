# Agent run: Wave1: reservations module

- Started: 2026-11-07T07:32:35.563Z · last activity: 2026-11-07T12:15:03.424Z
- Turns: 755 · tool uses: 444 · output tokens: 1,618,460
- Type: general-purpose

## Brief (2026-11-07T07:32:35.563Z)

````text
You are the engineer for Portico's **reservations** module (wave 1) — bookings, stays and the front desk workflows. It is the heart of the product and depends on other wave-1 modules being built in parallel, so you code against PORTS (src/ports.ts) matching docs/architecture/domain-map.md exactly, and test with high-fidelity in-memory fakes of those ports (write them carefully: e.g. a fake inventory that enforces capacity and assignment overlap, a fake rates that returns a TermsSnapshot). First read the shared playbook at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md and follow it exactly.

Your worktree: /home/user/wt/reservations (branch feat/reservations-core). Test DB prefix: PORTICO_TEST_DB_PREFIX=w1_reservations. Module path: modules/reservations (package @portico/reservations, schema `reservations`). Spec: /home/user/wt/product/docs/specs/reservations.md (long — read it all).

Ports you need (from domain-map): InventoryPort (consume/release/changeConsumption/createHold/convertHold/assignUnit/unassignUnit/findAssignableUnits), RatesPort (quote, priceChange), GuestsPort (resolveProfile, recordStayHistory), FinancePort (openFolio, postCharge, recordDeposit/applyDeposits, getFolioBalance), PaymentsPort (getPaymentStatus, createPaymentRequest), OperationsPort (getUnitCondition), PlatformPort (getProperty/getBusinessDate/assertWritable — real platform exists on main; you may call it directly or via port).

Build:
- Booking (confirmation code, booker, source/channel/market segment, company/agency, commission terms, guarantee, deposit requirement, notes) containing Stays (unit type, nights, occupants adults/children ages, rate plan, TermsSnapshot persisted immutably, assigned unit, status). Booking status and stay status machines per glossary; keep booking status, stay status, occupancy, unit condition, availability and payment status DISTINCT.
- Flows: quote → hold (expiring) → tentative → confirm; walk-ins; multi-room bookings; cancellation with policy fee computed from the snapshot (property time zone deadlines); no-show (markNoShow idempotent); waitlist; comps & house use.
- CHANGE PREVIEW (brief §4): for date changes, unit type changes, occupancy changes, rate plan changes, room moves, extensions, shortenings, split stays, early arrival / late departure — compute and return the effect on availability, nightly prices, taxes, inclusions, deposits and remaining balance BEFORE commit; commit requires the preview token/hash so the user commits exactly what they saw (if anything changed meanwhile → 409 with new preview).
- Room assignment and moves (unit reassignment mid-stay creates segments), extensions into nights where the assigned villa is taken (scenario s03: preview shows the conflict + alternatives: same type other villa, move for the extra nights, upgrade).
- Check-in as a resumable multi-step workflow with persisted step status (verify identity/required info, unit assigned & ready (OperationsPort), payment guarantee/authorization (PaymentsPort), deposits applied (FinancePort), keys issued (AccessPort stub honoring environment safety), status → in_house). An interrupted check-in shows exactly which steps succeeded and which remain (brief §6). Check-out similarly (balance resolved, folio settlement status, keys revoked).
- Front desk views: arrivals, departures, in-house with readiness composition (assigned? unit inspected? payment secured? requests pending?) and the single blocking reason per arrival.
- Shift handover: log of unresolved tasks/financial exceptions/guest commitments with owner, acknowledged by the incoming shift.
- ingestChannelBooking(connectionId, externalId, revision, payload) idempotent: duplicates by (connection, externalId, revision) → 'duplicate'; out-of-order older revisions ignored with a recorded note; modification/cancellation of existing; inventory conflicts create a `relocation required` issue rather than silently overbooking (scenario s02 reservations part).
- Optimistic concurrency on bookings/stays (version, If-Match) — scenario s14: two users edit the same reservation, the second gets 409 with what changed.
- Data authority: `reservations` domain via assertWritable (read_only → refuse with explanation; forward → create a pending forwarded change record and do not mark effective until acknowledged — model the record, the integration module will deliver it later).
- Events per domain-map. HTTP routes for all of the above with ETag/If-Match/Idempotency-Key; list endpoints with filters and cursor pagination.
- Groups/blocks are NOT in scope (wave 2 `groups` module) — but keep a nullable block reference on stays.

Tests: s01 (via fake inventory with real concurrency semantics is not enough — also add a test note for the integration test the orchestrator will run with real inventory), s03, s04 booking side (family multi-room, company payer for accommodation, guests pay incidentals → billing instructions passed to FinancePort), s14, s02 ingestion idempotency, interrupted check-in resume, change-preview commit token mismatch, isolation/permissions.
````

## Follow-up message (2026-11-07T11:13:04.297Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (check `git status`, your last commit and your README Checkpoint section; your uncommitted work is still in the worktree). Commit after each meaningful step. Postgres was restarted and is up. When finished, deliver your final report as originally specified.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:19:05.636Z)

````text
The coordinator sent a message while you were working:
Orchestrator: answer to your owner question — MIRA's official Green Tax FAQ says complimentary (free) stays STILL pay Green Tax (docs/readiness/maldives-tax-rules.md §5, verified source). Please stop zeroing all taxes on complimentary terms: Green Tax (per person-day, under-2 exempt) still applies and is posted to the house/comp account's folio; value-based taxes (TGST, service charge) follow the zero value of the complimentary room. Add a test. Then the steward will review your branch. No reply needed.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:39:31.242Z)

````text
The coordinator sent a message while you were working:
Orchestrator: steward verdict on feat/reservations-core @567dffe — "merge after fixes": P0 1, P1 16, P2 12, P3 6. Full report incl. port-vs-provider compatibility table: /home/user/portico/docs/orchestration/reviews/review-reservations.md; reproducing tests in the reviewer's scratch copy (/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations-copy) — turn them into regression tests.
Before merge, fix:
- R-01 (P0): a channel price differing from the quote (even 1 cent) drops all taxes (TGST, Green Tax) from agreed terms and the nightly posting feed (service/channel.ts ~107). Channel price ≠ quote must keep taxes per the canonical rates logic (gross vs net handling, recorded difference), never zero them.
- R-04: preview token must bind the rates configuration/terms it priced (stale free-cancellation preview committed non-refundable terms).
- R-05/R-06: cancellation arriving before its booking must be recorded and applied when the booking arrives (no live confirmed booking); cancellation for in-house stays / bookings for past dates must raise an issue, not throw-and-retry forever.
- R-07/R-08/R-09: read-only data authority must block patchStay/assignUnit/check-in unit step; check the authority BEFORE any external effect (card authorization, keys); forward mode must not duplicate forwarded changes on repeated confirms; key operations must happen after commit (outbox/after-commit with idempotency) — a rollback must never leave real keys changed.
Then the contract work (must land before any real provider is bound — coordinate via the providers' published README "Provider contract" sections): R-02/R-03 adopt rates' canonical TermsSnapshot/Offer/priceChange and use rates.evaluateCancellationPenalty + rates.complimentaryTerms (stop rewriting rates' hashed terms); R-11 payments authorize is async (provider call after commit, nested status) — the guarantee step must poll/await, never re-authorize; R-12 your v2 booking event payload must pass operations' schema (no null earlyCheckIn, ETA as full instant not HH:MM) — export your event payload Zod schemas from contracts; R-13 inventory adapters (explainAvailability shape, unit/candidate shapes); R-14 per ADR-0015 (docs/adr/0015 on main) providers won't re-check their own permission keys on port calls — you check reservations permission + property scope; R-10 charge codes/fees per finance. Also aggregateVersion on your events (kernel) and recordPlanSale/releasePlanSale. Make your fakes strict (mirror the real providers' contracts).
Then `git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T11:54:12.784Z)

````text
This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.

<system-reminder>
<tools-used-before-summary>Bash, Edit, Read, SubagentHandback, Write</tools-used-before-summary>
</system-reminder>
Summary:
1. Primary Request and Intent:
   - Original task (orchestrator): build Portico's **reservations** module (wave 1) in worktree `/home/user/wt/reservations` (branch `feat/reservations-core`), package `@portico/reservations`, schema `reservations`, test DB prefix `PORTICO_TEST_DB_PREFIX=w1_reservations`, following `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/wave1-playbook.md` exactly; code against PORTS in `src/ports.ts` matching `docs/architecture/domain-map.md`; test with high-fidelity fakes; bookings/stays/flows/change previews/moves/check-in-out workflows/front desk/handover/channel ingestion/optimistic concurrency/data authority/events/HTTP; scenario tests s01, s03, s04, s14, s02, interrupted check-in, preview token mismatch, isolation/permissions. Final report via SubagentHandback (done twice already).
   - Playbook constraints (must keep): write only inside `modules/reservations/` plus minimal wiring in `apps/api/src/composition.ts`, `apps/api/package.json`, and `apps/api/test/<module>*.test.ts`; do NOT modify packages/kernel, db, http, testing, other modules, CLAUDE.md or docs outside module (foundation needs → `modules/reservations/FOUNDATION_REQUESTS.md`); never drop databases you did not create; don't start listeners on other ports; commit early/often with Conventional Commits ending with:
     ```
     Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
     Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
     ```
     Never push; never rebase/touch other branches; use `git -c commit.gpgsign=false commit`. No `any`, no default exports, no floats for money, no `new Date()` in domain code; run `npx biome check --write modules/reservations` (never Biome on `*.md`). `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/reservations test`, `pnpm --filter @portico/api test` must pass. No secrets; never put sensitive values in audit before/after.
   - **Current request (steward review fixes)**: verdict "merge after fixes" on @567dffe; report `/home/user/portico/docs/orchestration/reviews/review-reservations.md`; reviewer experiments in `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations-copy/modules/reservations/test/zz-review*.test.ts` → turn into regression tests. Before merge fix: R-01 (P0 channel price drops taxes), R-04 (preview token binds terms/config), R-05/R-06 (cancel-before-create; in-house/past-date must raise issue not throw), R-07/R-08/R-09 (read_only blocks patchStay/assignUnit/check-in unit step; authority before external effects; forward dedupe; keys after commit). Then contract work: R-02/R-03 (rates canonical TermsSnapshot/Offer/priceChange, rates.evaluateCancellationPenalty + rates.complimentaryTerms, stop rewriting rates' hashed terms), R-11 (payments authorize async, poll/await, never re-authorize), R-12 (v2 payload passes operations' schema; export Zod payload schemas), R-13 (inventory adapters), R-14 (ADR-0015: reservations checks its own permission + property scope), R-10 (charge codes/fees per finance), aggregateVersion on events, recordPlanSale/releasePlanSale, strict fakes. Then `git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly (via SubagentHandback).

2. Key Technical Concepts:
   - TypeScript modular monolith, Kysely + Postgres 16 with RLS (`core.enable_tenant_isolation`), `withTenantTx`, `runIdempotent` (now binds actor_key), outbox `tx.emit` (now supports `aggregateVersion`), `tx.audit`, `tx.afterCommit`, `withSavepoint(tx, name, fn)` from `@portico/db`, `zonedTimeToInstant` from `@portico/kernel`, ADR-0015 (entry module authorizes; providers don't re-check permission keys), ADR-0014 data authority (`assertWritable`: portico | forward | read_only throws).
   - Ports & adapters; fakes in `test/fakes/` (inventory & finance Postgres-backed in test-only schemas `fake_inventory`, `fake_finance` via `test/fakes/sql/0001_fakes.sql` migration source `zz_test_fakes`; rates/guests/payments/operations/access in memory).
   - Change preview → commit token with fingerprint (sha256 canonical JSON) incl. agreed terms digest; `commitChangeSafely` recovery → 409 `preview_stale` with fresh preview, differences, explanation.
   - Two-phase external effects (payments, keys): recorded in tx, executed after commit; workflow polls external pending steps once.
   - Universal record contract (status families, allowedActions with reasons, issues, owner, links, provenance), SearchProvider, recordTypes.
   - Event payload v2 with `stays[]`, exported Zod schemas, aggregateVersion.

3. Files and Code Sections (all under /home/user/wt/reservations unless absolute):
   - `modules/reservations/migrations/0001_reservations.sql` (unmerged, editable): tables bookings (now + `property_timezone text not null`), booking_versions (append-only), stays (`position` int, unique per booking), stay_segments (exclusion constraint), occupants (`position`), terms_snapshots (append-only), room_moves, change_previews (status incl. `'superseded'`), workflow_runs, channel_revisions (outcome incl. `'needs_review'`), issues, relocation_cases, handover_items, handovers, forwarded_changes (+ `dedupe_key text not null`, unique `(tenant_id, dedupe_key) where status='pending'`), SECURITY DEFINER `reservations.due_booking_expiries(p_now)`.
   - `src/ports.ts`: InventoryPort (consume w/ onShortfall returns `{conflictIds?}|undefined`, release, changeConsumption, createHold, convertHold, assignUnit, unassignUnit, findAssignableUnits, getAvailability, explainAvailability, getUnit, listUnits, listUnitTypes); **AvailabilityExplanation now** `{ unitTypeId, date, available, sold: Array<{ ref, quantity, kind? }> }`; RatesPort quote, **termsFromChannelPrices**(tx, {propertyId, unitTypeId, ratePlanId, occupancy, currency, nights[{date, amount}], amountsIncludeTax, base: TermsSnapshot|null, channelRef}), priceChange; TaxLine has `basis?`; GuestsPort (GuestProfileInput with propertyId, recordStayHistory with bookingId/role, recordReferenceRepoints); FinancePort (postCharge now has `reason?`, setBillingRules, getDepositBalance); PaymentsPort (getPaymentStatus, createPaymentRequest, authorize — still old shapes); OperationsPort; PlatformPort; AccessPort (issueKeys/extendKeys/moveKeys/cancelKeys, KeyOperationResult status issued|cancelled|pending|unavailable|simulated, documented TWO-PHASE); `inventoryShortfall`, `assignmentConflicts` (now prefers instance `.conflicts`, else `details.conflicts[].ref`), `unavailablePort`.
   - `src/contracts.ts`: Zod contracts; stayEffect has `agreedTerms: [{from,to,digest,ratePlanId,cancellation,guarantee}]`; canonicalChannelBooking `amountsIncludeTax: z.boolean().default(false)`; ingestResult outcome includes `'needs_review'`; exported event schemas `stayEventInfo`, `bookingEventPayload`, `stayEventPayload`, `stayMovedPayload` (eta ISO instant, etaLocal, etdLocal, earlyCheckIn boolean + earlyCheckInTime, lateCheckOut boolean + time, vip boolean + vipLevel, occupants, requests).
   - `src/domain/terms.ts`: penalties, cancellationPenalty (tz), requiredDeposit, complimentarySnapshot (keeps quantity-based levies via `appliesWhenComplimentary`), `termsDigest(doc)` (excludes hash/quotedAt/quoteId), `describeCancellationPolicy`.
   - `src/service/context.ts`: `isModuleUnavailable` now true for `module_not_available` or DomainError status 403/404; `chargeCodes(deps, tx, propertyId)` policy `reservations.chargeCodes` defaults `{cancellation:'CXL', noShow:'CXL', earlyDeparture:'CXL', earlyCheckIn:'MISC', lateCheckOut:'MISC'}`.
   - `src/service/channel.ts`: pricedFromChannel uses `rates.termsFromChannelPrices`; R-19 issue on different-content duplicate; R-05 laterCancel check; `needsReview` helper; apply wrapped in `withSavepoint(tx, 'channel_ingest', apply)` catching DomainError status<500; past arrival issue `channel_past_arrival`; in-house cancel → needs_review.
   - `src/service/changes.ts`: Ctx has `codes`; agreedTermsOf in stay effects; R-18 family supersede check & update; key ops after events via keyOperation (results pending); time-request fees skipped at commit; postCharge with `reason`; moves carry `effectiveDate`; explainShortfall rewritten:
     ```ts
     const stayIds = explanation.sold.filter((x) => x.ref.type === 'stay').map((x) => x.ref.id);
     ... select b.code, v.actor_name, v.changed_at from stays s join bookings b join booking_versions v where s.id in stayIds order by v.changed_at desc
     out.push(`${date}: sold ${seconds} second(s) ago by ${latest.actor_name}, booking ${latest.code}.`)
     ```
   - `src/service/authority.ts`: guardAuthority dedupes pending forwards by `dedupe_key = sha256(canonicalJson({kind, bookingId, stayId, payload}))`.
   - `src/service/bookings.ts`: patchStay/assignUnit/confirmWaitlistedStay guarded (return Booking|ForwardedResult); channel source allowed past arrival; house folio for comp stays; no-show uses chargeCodes + reason; property_timezone stored.
   - `src/service/workflows.ts`: startWorkflow guards authority first (returns WorkflowRun|ForwardedResult); performWorkflow returns `{run: WorkflowRun|null, interrupted, forwarded}` and polls external pending steps once (`polled` Set); access step two-phase messages; guarantee step always reads authoritative status first, key `checkin:{runId}:guarantee:{declinedAttempts}`; `postTimeRequestFee` at check-in/out confirm; early departure uses chargeCodes + reason.
   - `src/service/event-payload.ts`: `staysForEvent` returns `{stays, bookingVersion, stayVersion}`; `emitReservationEvent` sets version 2, aggregateVersion, payload.stays.
   - `src/service/keys.ts`: keyOperation raises issue only for `unavailable` (not quiet), not for pending; `environmentAccessAdapter()`.
   - `src/routes.ts`: patchStay/assignment/waitlist confirm return 202 for forwarded via reply202OrBody; workflow perform response `run` nullable + `forwarded`; step route returns 202 when forwarded.
   - `test/fakes/inventory.ts`: explainAvailability now returns `sold` (just changed); `test/fakes/rates.ts`: termsFromChannelPrices (inclusive decomposition), basis on tax lines; `test/fakes/finance.ts`: strict (GROUP catalogue ROOM, PKG, BRKF, FOOD, BEV, MINIBAR, SPA, DIVE, TRANSFER, RETAIL, CXL, MISC, ALLOW; unknown_charge_code; service_date_in_future; late_service_date_reason_required reading `platform.properties.business_date`); `test/fakes/others.ts`: FakeGuests (provider shapes, merges map, recordReferenceRepoints), FakePayments (sync, script incl 'timeout'), FakeOperations, FakeAccess (two-phase, `executed`), realPlatformPort.
   - Tests added for review: s02 (R-01 one-cent & inclusive; R-05; R-06 in-house & past; R-19), change-preview (R-04, R-18, R-09 rollback; move/key assertions now `pending` + `executed`), data-authority (read_only refusals with zero authorize/key calls; forward check-in once), bookings (v2 payload + operations schema contract test + aggregateVersion), check-in-resume (late check-out fee at check-out), charge code expectations now 'CXL'/'MISC'.
   - `apps/api/src/composition.ts`: merged main (inventory, guests, reservations); reservations ports still stubs except platform & environmentAccessAdapter; jobs include reservationsJobs; searchProviders include reservations.search().
   - `modules/reservations/README.md`, `FOUNDATION_REQUESTS.md`: need update for review changes (not yet).

4. Errors and fixes:
   - Merge conflict in composition.ts/package.json → resolved keeping both sides.
   - DomainEvent now requires aggregateVersion → added `aggregateVersion: null` in fabricated test events.
   - HTTP test idempotency replay failing (runIdempotent binds actor_key; test authenticator generated new userId per request) → stable userIds map.
   - Python edit assertion failure in workflows (multiline formatting differed) → re-applied with exact text; fake access edit redone.
   - Two-phase keys changed semantics → updated assertions (pending results, `executed` list).
   - Earlier: double-authorization bug, ordering of stays/occupants (position columns), pg-pool error (fixed on main), lint issues.

5. Problem Solving:
   - Pre-merge fixes R-01, R-04, R-05, R-06, R-07, R-08, R-09 completed and tested; plus R-18, R-19, R-12, aggregateVersion, R-10, R-14/R-29 done. R-13 partially done (explanation shape + conflicts parsing). R-02/R-03 and R-15 blocked on rates publishing a "Provider contract" (rates worktree has uncommitted work; pending-fixes says "after rates fix round").

6. All user messages (orchestrator/coordinator):
   - Initial task (build reservations module per playbook; ports/fakes; features; tests; final report via SubagentHandback).
   - "please run `git merge --no-edit main` ... (then pnpm install) ... boundary guardrail ... demo seeder ... export your demo seed as DemoSeedStep-compatible ... No reply needed."
   - AccessPort as real key-lifecycle contract (issueKeys {stayId, unitId, validFrom, validTo, count, kind card|wristband|mobile, idempotencyKey} → {status issued|pending|unavailable|simulated, keyRefs}; extendKeys, moveKeys, cancelKeys; 'unavailable' → recorded manual fallback, never silently done; check-out and moves call cancel/move; document in README).
   - Universal record contract (merge main; status families, allowedActions with reasons, issues, owner, links; recordTypes; SearchProvider with search+summarize by code, guest name, unit number, external channel id; never put sensitive values in audit before/after; note in README).
   - Checkpoint: add "## Checkpoint" section to README and commit wip.
   - Usage limit reset: continue, commit after each step; Postgres restarted.
   - Guests alignment: align GuestsPort + fake to guests provider shapes; merged/unmerged consumers repoint and report via recordReferenceRepoints; add test.
   - Operations: v2 booking events with stays[] (stayId, propertyId, unitTypeId, unitId, arrival/departure, ETA, early/late, VIP, occupants counts, request flags), version 2, keep fields, README note.
   - Green Tax: complimentary stays still pay Green Tax (MIRA); stop zeroing all taxes; value-based follow zero; add test; then steward review.
   - Steward verdict message (current): fixes R-01, R-04, R-05/R-06, R-07/R-08/R-09 before merge; contract work R-02/R-03, R-11, R-12, R-13, R-14, R-10, aggregateVersion, recordPlanSale/releasePlanSale, strict fakes; then `git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly.

7. Pending Tasks:
   - Finish R-13: run tests after explainAvailability shape change; commit; optionally write composition adapter mapping real `inventoryService` (from `@portico/inventory`, exported as `inventoryService` in composition) to reservations InventoryPort (findAssignableUnits: name = c.name ?? c.number, reason = exclusions messages joined, conflictingRefs = exclusions refs, fitScore = score; getUnit name = u.name ?? u.number; listUnits(tx,{propertyId}) → inventoryService.listUnits(tx, propertyId); listUnitTypes(tx,{propertyId}) → inventoryService.listUnitTypes(tx, propertyId) mapping rank/maxOccupancy; explainAvailability pass sold).
   - R-11: align PaymentsPort with real payments (authorize input adds propertyId, returns Authorization with `status: { authorization: processing|pending_verification|authorized|partially_captured|captured|voided|expired|failed }`, `decline`; getPaymentStatus summary `{ref, totals[], payments[], authorizations[], refunds[], hasPendingVerification}`); map in guarantee step/record/front desk; default branch → pending; make FakePayments two-phase (pending, settle after commit).
   - R-15: add recordPlanSale/releasePlanSale to RatesPort and call on consume/release (signature from rates once published; note if blocked).
   - R-02/R-03: document as blocked on rates publishing its Provider contract (rates worktree mid-edit).
   - Update README (contract changes: termsFromChannelPrices, amountsIncludeTax, needs_review outcome, AccessPort two-phase, explainAvailability `sold`, postCharge reason, charge codes policy, event schemas/aggregateVersion, performWorkflow result shape; relabel readiness "R3 against fakes; provider integration unverified" per R-28; list blocked items) and Checkpoint section.
   - Then `git merge --no-edit main`, `pnpm install`, `pnpm lint`, `pnpm typecheck`, module + api tests, commit, brief report via SubagentHandback.

8. Current Work:
   Working on R-13 (inventory read shapes). Just changed `AvailabilityExplanation` in `src/ports.ts` to `sold: Array<{ ref, quantity, kind? }>`, updated `assignmentConflicts` to read instance `.conflicts` or `details.conflicts[].ref`, rewrote `explainShortfall` in `src/service/changes.ts` to use `explanation.sold` stay refs and reservations' own `booking_versions` (latest changed_at, actor_name, booking code), and replaced the fake inventory's `consumers` output with `sold: rows.map((r) => ({ ref: { type: r.ref_type, id: r.ref_id }, quantity: r.quantity, kind: 'stay' }))`. `npx tsc -p tsconfig.json` passed with no output. Not yet run tests or committed. Last commit: 73c6f98 "fix(reservations): finance-compatible charges; degrade cross-module facts on 403/404". Test count before: 140 module tests (+1 fee test added in check-in-resume), API 13→ (after merge api had 7 files/26 tests).

9. Optional Next Step:
   Run `npx biome check --write modules/reservations` and `PORTICO_TEST_DB_PREFIX=w1_reservations pnpm --filter @portico/reservations test` to verify the R-13 explanation change (S01 test asserts explanation contains winner code/name and "sold N seconds ago"), then commit (e.g. "fix(reservations): read inventory's explainAvailability shape; who-sold-it from own history (R-13)"), then continue with the remaining contract items from the steward message: "R-11 payments authorize is async (provider call after commit, nested status) — the guarantee step must poll/await, never re-authorize", "R-13 inventory adapters (explainAvailability shape, unit/candidate shapes)", "recordPlanSale/releasePlanSale", "Make your fakes strict", then "`git merge --no-edit main`, lint/typecheck/tests, commit, report back briefly."

If you need specific details from before compaction (like exact code snippets, error messages, or content you generated), read the full transcript at: /root/.claude/projects/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/subagents/agent-a3a77e940055c93af.jsonl
Continue the conversation from where it left off without asking the user any further questions. Resume directly — do not acknowledge the summary, do not recap what was happening, do not preface with "I'll continue" or similar. Pick up the last task as if the break never happened.
````

## Report (2026-11-07T11:18:42.457Z)

````text
The reservations module is finished on branch `feat/reservations-core` in /home/user/wt/reservations; everything is committed and not pushed. `pnpm lint` (including the boundary check) and `pnpm typecheck` pass. With `PORTICO_TEST_DB_PREFIX=w1_reservations`, the reservations package passes 129 tests (75 unit, 54 integration/scenario/HTTP) and the API passes 13. All other modules are stand-in fakes, so nothing has run against real inventory, rates, guests, finance, payments or operations yet. Readiness is R3 at most; door locks are R1.

**What's built**
- **Bookings and stays:** create a booking by quote, hold, tentative, confirm, waitlist or walk-in. A stay is split into segments by date (split stays and room moves). Agreed terms are stored and cannot be edited afterwards. Complimentary/house-use stays need permission and a reason; no-show is idempotent. A scheduled job expires lapsed holds and flags tentative bookings at their option date.
- **Change preview → commit:** covers dates, unit type, rate plan, guests, room moves, early check-in / late check-out, adding or cancelling stays, cancelling the whole booking, and waitlisting an extension. The token is tied to the booking version and to every previewed price, availability and penalty. If anything changed, commit returns 409 `preview_stale` with a fresh preview and the differences; for a lost sale it also says who sold the unit and on which booking.
- **Check-in / check-out:** each step runs in its own transaction and its result is saved, so an interrupted run shows what succeeded and what remains.
- **Front desk:** arrivals (each with one blocking reason), departures, in-house; shift handover; relocation cases; issues.
- **Channel ingestion** and **data authority**: `read_only` refuses with the system's name; `forward` records a pending change and applies nothing until acknowledged.
- **Shared record contract:** bookings and stays return status by family, allowed actions with reasons when disabled, issues, owner and links. A search provider finds bookings by confirmation code, channel id, guest name or unit number.
- **API wiring:** HTTP routes with ETag / If-Match / Idempotency-Key, plus the composition wiring.

**Your later requests**
- **Keys:** `AccessPort` has issue/extend/move/cancel. A lock outage fails the check-in keys step until staff confirm the manual fallback. Room moves, extensions, check-out, no-show and cancellation call the matching operation and report the result.
- **Guests:** the port now uses the guests module's real input shape. Merge events re-point booker and occupant links and report them through `recordReferenceRepoints`. Unmerge events restore exactly the listed links. Both are tested.
- **Operations:** booking and stay events are now payload version 2 with a `stays[]` array. It holds ids, dates, counts and flags only, no personal data. The VIP level comes from booking tags like `vip:gold`, since full recognition belongs to guests.

**Scenarios proven** (with fakes): S01 (two agents, plus 10 agents racing for 3 units → exactly 3 succeed), S02, S03, S04, S14, and S17 isolation. Also covered: interrupted check-in, stale preview tokens, S08 relocation when a unit is blocked, and the waitlist.

**Bug found and fixed:** after a payment timeout, resuming check-in would have authorized the card a second time. The step now always reads the payment status first and only uses a new key after the card is actually declined.

**Contract changes** (detailed in the README):
- Channel ingestion can return `stale` and adds field losses, conflict ids and a note.
- `markNoShow` returns penalty, posting ids, released nights, keys and a replay flag.
- New `previewChange` / `commitChange`.
- Inventory: `onShortfall`, conflict ids, rank and max occupancy, `listUnits`. Reservations recognises errors by the codes `inventory_unavailable` and `unit_assignment_conflict`; if inventory uses other codes, two helpers in `src/ports.ts` need adjusting.
- Finance: `setBillingRules` and a new `getDepositBalance`.
- Penalties are computed only by reservations, from the stored agreed terms; rates' penalty output is ignored so nothing is charged twice.

**Foundation requests:** the test-database pool error is already fixed on main. One minor item about read-only occupancy types remains in `FOUNDATION_REQUESTS.md`.

**What you need to do**
- Bind the inventory, rates, guests, finance, payments, operations and access providers; they currently return 503 `module_not_available`.
- Re-run `scenario-s01-last-unit.test.ts` against the real inventory.
- Register `reservationsDemoSeed` in the demo seed steps.
- Note that `docs/parity/reservations.md` doesn't exist yet (the parity researcher's job), so the parity gate can't pass from this branch.

**Not built yet** (listed in the README): reinstatement and reverse check-in, the lock on channel-owned fields, automatic release of non-guaranteed bookings, upgrade offers, the waiting-guests list, handover escalation, payment collection plans, and mirroring an external PMS.

**Owner question:** I couldn't add this to `docs/OPEN_QUESTIONS.md` from this worktree, so please add it. Does Green Tax apply to complimentary stays? For now all taxes are zeroed on complimentary terms.
````

## Report (2026-11-07T11:21:18.076Z)

````text
Complimentary and house-use stays now keep Green Tax and charge it to the house; it is committed on `feat/reservations-core`, which is ready for the steward's review. Lint (with the boundary check) and typecheck pass, the reservations package passes 130 tests and the API passes 13.

- **What changed:** on complimentary or house-use terms the room price and value-based taxes are zero (TGST, a percentage service charge). Per-person and other quantity-based charges stay. The Maldives Green Tax is still due per person-night, with children under 2 exempt.
- **How a line is classified:** each tax line from rates can carry a new optional `basis` field (percentage, banded, per person-night, per unit-night, per stay, fixed per charge), and that decides what survives. When rates doesn't send it, `fee` lines are kept and `tax` lines are zeroed. Rates should always send `basis`; this is noted under contract changes in the README.
- **Where the levy is charged:** confirming a complimentary or house-use stay now opens a house folio first, so it is the stay's default folio and the Green Tax lands there.
- **Tests added:** a unit test for the complimentary terms (room and TGST zero; Green Tax kept for 2 adults and an 8-year-old, infant exempt). A rule test covers each basis and the fallback. An integration test checks the booking totals and stored terms, that the house folio is the default, and that a Green Tax charge posts to it.

The README now records the owner question as answered with the MIRA reference. Everything else in my earlier report is unchanged.
````

## Report (2026-11-07T12:15:03.295Z)

````text
Reservations fix round is finished on `feat/reservations-core` @ ab2578f in /home/user/wt/reservations. It is committed locally, not pushed, and main (f0aedae) is merged in. `pnpm lint`, `pnpm typecheck` and the boundary check are clean. 147 module tests and 33 API tests pass.

**Pre-merge fixes:** R-01, R-04, R-05/R-06 and R-07/R-08/R-09 are fixed, plus R-18 and R-19. Each has a regression test made from the reviewer's `zz-review` experiments.

**Contract work done:**
- **R-10:** charge codes come from policy `reservations.chargeCodes`, defaulting to CXL and MISC. `postCharge` now sends `reason`. Early check-in and late check-out fees are posted at check-in/check-out confirm, when the service happens. The finance fake now enforces finance's rules.
- **R-11:** `PaymentsPort` now uses payments' real shapes and treats authorization as two-phase (`processing` until the provider answers after commit). The guarantee step always reads `getPaymentStatus` first, polls once after commit, and never authorizes again while one is processing, pending or authorized. Attempt keys count declines from payments' own records. A decline marked not retryable is not re-sent with the same card. The payments fake is now strict and two-phase.
- **R-12 / operations' request:** v2 booking and stay events with `stays[]` and `aggregateVersion`, exported Zod payload schemas, and a contract test against operations' schema.
- **R-13:** `inventoryPortFrom` (`src/adapters/inventory.ts`) is bound to the real inventory module in `composition.ts`. S01 (including the 10-agent race) and S03 now run against both the fake and the real inventory module, and pass. "Who sold the last unit" now comes from `sold[]` plus reservations' own booking history.
- **R-14:** reservations authorizes each command itself.
- **R-15:** `recordPlanSale` / `releasePlanSale` are called in the same transaction as every change to what a booking consumes. A channel booking over the limit is accepted and raises an urgent issue instead of being refused.
- **R-02/R-03, part 1:** penalties come from `rates.evaluateCancellationPenalty` and complimentary terms from `rates.complimentaryTerms`. That logic is deleted from reservations and now lives only in the rates fake, with its own tests.
- **R-28:** the README now labels readiness "R3 against fakes; provider integration unverified", except the inventory path.

**One change you won't see from the commit messages:** the merge commit 700b1e4 also binds inventory with system scope (`{ scope: asSystem }`), the same way operations does. The reason is that real inventory re-checks the caller's own permissions, which goes against ADR-0015.

**Still open; adapting to the canonical rates contract wasn't cheap, so these are for the integration step:**
1. **Bind the real rates module.** It needs a `ratesPortFrom` adapter that maps rates' sealed `TermsSnapshot` v1, `Offer` and `RepricingResult` to the fields reservations reads. That covers the `TaxLine` renames and `nights`/`candidateTerms` → `nightly`/`terms`. The adapter must also store rates' document unchanged and pass it back as-is to `priceChange`, `evaluateCancellationPenalty` and `complimentaryTerms`. Until then the rates port stays stubbed in `composition.ts`.
2. **Channel-price terms don't exist in rates yet.** Its README lists them as a gap, and channel ingestion (R-01) needs them.
3. **Deposits:** switch to `rates.instantiatePaymentSchedule` (the rest of R-03).
4. **Other ports:** bind payments, finance, guests and operations in the composition root. Payments still re-checks the caller's permissions, against ADR-0015.
5. **R-25:** persist inventory's `assignedUnitId` for composite types and consume `inventory.assignment.changed`.

Everything is in `modules/reservations/README.md`: the Checkpoint, Ports and Contract changes sections, and "Known gaps → Next (integration)".
````

