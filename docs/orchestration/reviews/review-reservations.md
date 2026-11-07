# Steward review — `feat/reservations-core` (module `reservations`)

- Worktree: `/home/user/wt/reservations` (not modified). Experiments: scratch copy
  `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations-copy`
  (`git archive` of the branch; experiment tests `modules/reservations/test/zz-review*.test.ts` exist only there).
- **Reviewed commit: `567dffe`** ("complimentary stays still carry Green Tax, charged to the house"). HEAD was `9f84f2f`
  when the review started. The author committed `567dffe` during the review, and I re-ran every command against it.
- Provider worktrees compared: inventory `94ebd21`, rates `0bc16a2`, guests `4e77010`, finance `232be3a`, payments
  `a219850`, operations `0089542`. Parity file: `/home/user/wt/parity-front/docs/parity/reservations.md` (`1e26024`).

## Verdict: **merge after fixes**

The module's internal design is strong. It has separate status machines, append-only agreed terms, previews with
fingerprints, per-step workflows that can be resumed, deterministic idempotency keys, RLS on every table, real
concurrency tests, and a full universal record contract. Lint, typecheck and tests are all green.

Three problems block a merge as-is:
- **P0 (reservations-internal):** any channel price that differs from Portico's quote removes every tax and fee from
  the agreed terms (R-01).
- **Integrity holes reproduced in the scratch copy:** a stale preview can be committed after a policy change (R-04);
  channel revisions can be applied in the wrong order (R-05, R-06); data authority can be bypassed (R-07, R-08).
- **Contract shapes and semantics:** they diverge so far from the real rates, payments, operations and inventory
  providers that binding them will fail at runtime (R-02, R-10 to R-14).

Fix R-01 and R-04 to R-09 before the merge. The adapters and contract decisions in the compatibility table (§4) must
land before any port is bound to a real provider. The parity gate must be brought up to date before the module is
declared complete.

## 1. Command results (scratch copy at `567dffe`, `PORTICO_TEST_DB_PREFIX=review_reservations`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | pass |
| `pnpm lint` | pass. biome 166 files; module boundaries OK (3 modules) |
| `pnpm typecheck` | pass. 9 tasks; reservations re-run, not cached |
| `pnpm --filter @portico/reservations test` | pass. 21 files, **130 tests**, 10.7 s |
| `pnpm --filter @portico/api test` | pass. 4 files, 13 tests |
| `node tools/parity-report.mjs --gate reservations` (branch) | **FAIL**: "No parity file for module reservations" |
| same, in `/home/user/wt/parity-front` | **FAIL**: 100 P0 rows not tested, 30 P1 rows missing. The file was written before the code existed and says "Code on main: none", so no row cites a test. |
| Review experiments (`zz-review*.test.ts`, 11 cases) | All reproduced the issues below. Output is quoted in the findings. |

## 2. Findings (ranked)

### P0

| id | where | problem | why it matters | fix |
|---|---|---|---|---|
| R-01 | `src/service/channel.ts:103-108` (`taxes: quoted && quoted.net.amountMinor === n.amount.amountMinor ? quoted.taxes : []`), consumed by `src/service/provider.ts:57-72` | When the channel's nightly price differs from Portico's quote by even 1 minor unit, every tax and fee line for that night is dropped from the agreed terms. That includes TGST, service charge and the per-person **Green Tax**, which does not depend on price at all. Experiment E6: the same stay at 30 000/night gives `taxes 10200, fees 4800, gross 75000`. At 30 001/night it gives `taxes 0, fees 0, gross 60002`. `listInHouseStaysForNight` passes `nightly.taxes: []` to Day Close. The canonical payload also does not say whether `nightlyPrices` include tax. | Statutory tax is under-collected on every OTA booking that has a rate discrepancy, and discrepancies are common. The terms are also understated to the guest and in deposit calculations. This breaks CLAUDE.md §5 and rule 13: taxes come from the rates tax engine and are data, never omitted by code. | Compute taxes for channel prices through rates. Use `computeTaxes` on the received amounts, or a rates `termsFromChannelPrice`, which the rates README already lists as the gap. Add `amountsIncludeTax: boolean` (or `amountBeforeTax`/`amountAfterTax`) to `canonicalChannelBooking`. Never write an empty tax list. Add a test that a mismatched channel price still carries TGST and Green Tax. |

### P1

| id | where | problem | why it matters | fix |
|---|---|---|---|---|
| R-02 | `src/ports.ts:19-103,218-268`; `src/domain/terms.ts:264-290` (`complimentarySnapshot`); `src/service/channel.ts:122-140` | **Agreed terms are not rates' agreed terms.** Reservations defines its own `TermsSnapshot`, `TaxLine`, `Penalty`, `CancellationPolicy`, `DepositItem`, `Offer` and `RepricingResult` shapes, and none of them match rates (details in §4.2). Reservations also **rewrites** terms documents. For complimentary stays it sets `net: 0`, filters `taxes`, sets `priceSource:'override'` (not in rates' enum) and adds `override`/`originalTotals`. For channel stays it replaces `nights`/`totals` and spreads the rest of the base quote, including its `hash`. | With real rates: `priceChange` calls `verifyTerms` and throws `terms_hash_mismatch` for every complimentary or channel stay, so extensions and moves fail. `rates.postingPlan`, which finance is meant to post from, reads `nights[].components[].amount`. The complimentary rewrite leaves those untouched, so **a complimentary stay would be posted at full price**. | Rates owns the document. Reservations persists rates' snapshot verbatim and reads it through a mapping view (§4.2 adapter). Rates must provide constructors for complimentary/house-use terms (zero room amount, then re-run the tax engine) and for channel-price terms, each with a new hash and `supersedesHash`. Reservations must stop mutating documents. |
| R-03 | `src/domain/terms.ts:97-122,154-204,207-232` | **Penalties and deposits are computed by reservations, differently from rates.** Rates' `cancellationStructure.basis` defaults to `'gross'`, but reservations always uses **net**. Reservations cannot express rates' deadline kinds `at_booking` and `hours_before_checkin`. Its `amount` penalty takes `Money` where rates uses `amountMinor`. `requiredDeposit` duplicates `rates.instantiatePaymentSchedule`. The README says rates' `RepricingResult.penalties` is ignored "to avoid double charging". | Cancellation and no-show penalties would be **under-charged by the tax amount** under rates' default policy. Two implementations of one money rule will drift. | Use the tiers rates already resolves into the terms (`policies.cancellation.tiers[].fromInstant` and `structure.basis`), or a single rates provider `penaltyFor(terms, at, removedNights)`. Use `instantiatePaymentSchedule` for deposits. Delete the local copies. |
| R-04 | `src/service/changes.ts:1327-1341` (`fingerprintOf`), `:1431-1470` | **A stale preview can be committed.** The fingerprint covers amounts, availability, penalties and deposits. It does not cover the candidate terms' policies, guarantee rules or rate-plan/config version. RES-R12 (MUST) requires the token to bind "the rates config vector". Experiment E1: preview a new booking on the flexible plan, change the plan to non-refundable with a deposit guarantee, then commit. The commit **succeeds**, and the stored terms are `{"cancellation":{"tiers":[],"nonRefundable":true,...},"guarantee":{"required":["deposit"]}}`. The preview also never showed the policy. | The guest agrees to free cancellation, and the system snapshots non-refundable. This breaks RES-I07 ("commit matches the preview") and brief §5 snapshot integrity. | Add `sha256(candidate terms without quotedAt/quoteId)` per segment (or rates' `configVector`) to the fingerprint material. Show the cancellation/guarantee/deposit policy text in `stayEffect`. Add a test like E1. |
| R-05 | `src/service/channel.ts:434-451` | **A cancellation that arrives before its creation produces a live booking.** If revision 3 (cancelled) arrives first, it is stored as `stale, applied=false`. When revision 1 (create) arrives later, `lastApplied` is null, so it **creates a confirmed booking**. A redelivered revision 3 is then a `duplicate`. Experiment E3: `rev3 first → stale; rev1 → created; booking status: confirmed; rev3 redelivered → duplicate`. | A booking the guest cancelled at the OTA consumes inventory and later produces a no-show penalty. RES-R31 gives ordering to distribution, but reservations has already recorded the higher revision and ignores it. | Before creating, look for any recorded revision of the same `(connection, externalId)` with a higher number. If one is `cancelled`, record the create as `stale` and raise an urgent issue, or create and cancel immediately with no penalty. Add a test. |
| R-06 | `src/service/channel.ts:541-560` and the create path | **Channel messages Portico cannot apply make ingestion fail forever.** A cancellation for a stay that is already in house throws `stay_in_house` (E9), so the revision is never recorded and no issue is raised. EC-RES-039 (P0 edge case) expects "not applied automatically; urgent exception". A channel booking for past dates throws `arrival_in_past` (E10). EC-RES-040 and RES-R32 expect it to be stored with an exception. | Integration retries the message forever and staff are never told. | Record such revisions with outcome `stale` or `needs_review` and a note, raise an urgent `channel_modification_review` issue, and return. Never throw for business states. |
| R-07 | `src/service/bookings.ts:947` (`patchStay`), `:979` (`assignUnit`), `:1171` (`confirmWaitlistedStay`), `src/service/workflows.ts:283-303` (unit step) | **Data authority is bypassed.** These commands write reservation data (stay details, unit assignment, waitlist confirmation that consumes inventory) without `assertWritable` or `guardAuthority`. E4, with reservations set to `read_only` for "Legacy PMS": `patchStay → ok v2`, `assignUnit → ok`. | CLAUDE.md rule 15. In connect-alongside mode Portico's data diverges silently from the system of record. | Call `guardAuthority` in every write command. Add a table-driven test that runs each command in `read_only` and `forward`. |
| R-08 | `src/service/workflows.ts:675-689,755-766` (guard only in `confirm*`) | **Check-in performs external effects before the authority check.** In `read_only` mode, check-in authorizes the card and issues keys, then fails at confirm. E11: `registration:done unit:done guarantee:done deposits:done access:done confirm:failed (external_system_of_record) / authorize calls: 1 / key ops: issue`. In `forward` mode every repeated confirm records a **new** forwarded change. E5: 3 forwarded `check_in` rows for one stay. Other forwarded changes are not de-duplicated either. | Real card holds and door keys are created for a check-in that cannot complete. The external PMS receives the same instruction several times. | Check authority in `startWorkflow`, so `read_only` refuses up front and `forward` decides before any external step. Give `forwarded_changes` a unique `(tenant, kind, stay_id/booking_id, dedupe_key)` where `status='pending'` and return the existing row. |
| R-09 | `src/service/changes.ts:1745-1803`, `src/service/bookings.ts:1121-1133`, `src/service/workflows.ts:509-560` | **Key operations run inside the database transaction.** `moveKeys`, `extendKeys` and `cancelKeys` (and the check-in `issueKeys`) are called while the commit transaction is still open, before events are emitted and before commit. The `AccessPort` contract allows a synchronous effect. | CLAUDE.md rule 5. If the transaction rolls back after the call, the lock system has re-encoded or cancelled keys for a change that never happened. The fake journals in memory, so tests cannot show this. | Make the `AccessPort` contract two-phase, like payments under ADR-0007: inside the transaction, persist the operation and return `pending`; execute after commit; resume reads the status. Alternatively have the access module consume `reservations.stay.moved/extended/shortened/checkedOut/noShow` from the outbox. Reservations already handles `pending`. |
| R-10 | `src/service/changes.ts:643-647,709`, `src/service/bookings.ts:1090-1100`, `src/service/workflows.ts:801-811`, `src/ports.ts:364-380` | **Finance will reject reservations' charges.** (a) Charge codes `CANCEL_FEE`, `NO_SHOW`, `EARLY_DEPARTURE`, `EARLY_CHECK_IN` and `LATE_CHECK_OUT` do not exist. Finance's defaults are ROOM, PKG, BRKF, FOOD, BEV, MINIBAR, SPA, DIVE, TRANSFER, RETAIL, **CXL**, MISC, ALLOW, so every penalty or fee gets `unknown_charge_code`. (b) Early check-in and late check-out fees are posted at commit time with `serviceDate = arrival/departure`, and finance refuses a future service date (`service_date_in_future`, finance `service/postings.ts:280`). (c) A no-show marked manually after the arrival business date posts `serviceDate = arrival`. Finance requires `reason` from user actors (`late_service_date_reason_required`) and the port has no `reason`. The fake finance enforces none of these rules. | RES-R18, R20 and R29 are marked "Built" but would fail against real finance. | Read charge codes from policy (`reservations.chargeCodes.*`, default `CXL`/`MISC`) and ask finance to seed `NOSHOW`, `EARLYDEP`, `ECI` and `LCO`. Post time-request fees when the service happens (in the check-in/check-out step) or at Day Close. Add `reason` to the `postCharge` port. Make the fake enforce the date and code rules. |
| R-11 | `src/service/workflows.ts:375-470`, `src/ports.ts:405-446`, `test/fakes/others.ts:109-164` | **The payments contract does not match.** Real `authorize` is two-phase: it inserts the operation and calls the provider **after commit**. It returns an `Authorization` whose status is a record (`status: { authorization: 'processing' }`) and it requires `propertyId`. Reservations does `switch (attempt.status)` on a string with no default branch, so the step function returns `undefined` and the runner crashes on `outcome.status`. Real `getPaymentStatus` returns `PaymentStatusSummary {totals[], payments[], authorizations[], refunds[], hasPendingVerification}`, not `{status, ...}`. The fake decides the provider outcome **synchronously inside the reservations transaction** and throws on timeout, which the real module never does. | The resume claim (RES-I09 / S05) is proven only against a fake whose semantics are the opposite of the real provider's. | Use the §4.5 adapter. Add a `default:` branch that maps to `pending`. Make the fake two-phase (return `pending_verification`, resolve later). Re-run `check-in-resume.test.ts`. |
| R-12 | `src/service/event-payload.ts:11-31` against operations `src/events.ts:52-66,87-92` | **Operations rejects every reservations booking event.** Operations parses `stays[]` with `earlyCheckIn: z.boolean().optional()` and `eta: z.iso.datetime().nullish()`. Reservations sends `earlyCheckIn: null` or `{time}`, and `eta: 'HH:MM'`. I ran operations' schema on reservations' payload: `stays.0.earlyCheckIn expected boolean, received null`, and with an ETA also `Invalid ISO datetime`. Operations reads `vip: boolean`, but reservations sends `vipLevel`. On moves, operations reads `effectiveDate`, but reservations sends `fromDate`, so future-dated moves are applied today. | `booking.confirmed` and `booking.modified` dead-letter in operations, so housekeeping never learns about arrivals. | Agree one payload schema in `domain-map.md`. The producer should export Zod payload schemas (see §5). Short term: operations accepts `earlyCheckIn: {time}|null`, `eta: HH:MM`, `vipLevel` and `fromDate`. |
| R-13 | `src/service/changes.ts:1873-1874` (`[...explanation.consumers]`), `src/ports.ts:118-151,199-213` | **Inventory read shapes differ.** Real `explainAvailability` returns `sold[{ref, quantity, kind}]`, with no `consumers` and no `consumedAt`, so the stale-commit path throws a **TypeError (500)** instead of `409 preview_stale`. Real `UnitCandidate` has `number`, `name\|null` and `exclusions[]` instead of `name`, `reason` and `conflictingRefs`. Real `Unit` has `number`. `listUnits` and `listUnitTypes` take `(tx, propertyId, ...)`. | The S01 "sold N seconds ago by X" behaviour depends on the fake's shape. | Use the §4.1 adapter. Better, stop needing `consumedAt` and order by reservations' own `booking_versions` for the stay refs. |
| R-14 | Provider calls across modules. Main's role templates: `modules/identity/src/domain/role-templates.ts:48-110` | **Provider calls check the caller's permissions, and the fakes never do.** Real inventory `assignUnit`/`unassignUnit` need `inventory.assignment.manage`. `getAvailability` and `explainAvailability` need `availability.read`. `findAssignableUnits` needs `unit.read` or `assignment.manage`. Overbooking needs `inventory.overbooking.authorize`. Payments `getPaymentStatus` needs `payments.payment.read` or `collect`. Rates `quote` and `priceChange` need `rates.quote.read`. Guests `resolveProfile` needs `guests.profile.update`. With main's templates: the **reservations_agent** role has no payments permission, so `getBooking` returns **403** (`bookingRecord` calls `getPaymentStatus`, and `safely` only swallows `module_not_available`). It also lacks `inventory.unit.read`/`assignment.manage`, so extension and relocation previews return 403. The **night_auditor** role lacks `assignment.manage`, so a manual no-show on an assigned stay returns 403. E7: fakes accept a user that holds only `reservations.booking.create`. | The front desk and reservations agents would break as soon as real providers are bound. | Adopt finance's delegation pattern (`PROVIDER_DELEGATION` + `delegated(tx, perms)`), moved to a shared helper and **property-scoped**; finance's version widens the scope to `'all'`. Make record views degrade a cross-module fact to "unavailable" on 403 instead of failing the record. Add a fake mode that enforces the providers' permission checks. |
| R-15 | n/a (missing call) | Reservations never calls rates' `recordPlanSale`/`releasePlanSale`. Rates' README says reservations calls them in the confirm/cancel transaction. | Rate-plan sales limits (RAT-R08) are never counted, so a limited offer oversells. | Add both to `RatesPort` and call them wherever inventory is consumed or released. |
| R-16 | README "Known gaps" | **MUST requirements missing or partial:** RES-R10 reinstatement / reverse check-in (missing); RES-R14 channel-owned field lock (missing); RES-R06 release-time exception and auto-release (missing); RES-R24 `documents` step and the `reservations.checkIn.steps` policy (missing; only `optionalSteps` exists); RES-R27 `invoice` step (missing); RES-R29 MIT no-show charge (missing); RES-R20 deposit treatment (no consumer of `booking.cancelled` exists in finance or payments); RES-R09 and R21 owner **task** (an issue is created instead); RES-R35 waiting-guests list (missing). | The module cannot pass its definition of done. | Implement them or record them as explicit `deferred` rows in the parity file. RES-R10 and R14 are P0 parity rows (PAR-RES-034 and others). |
| R-17 | `docs/parity/reservations.md` | The parity gate fails. The branch has no parity file. The parity-front file predates the code (100 P0 not tested, 30 P1 missing). | CLAUDE.md §7: a module is not complete until the gate passes. | Merge the parity file and update rows to `tested` with test references, as far as the evidence supports. |

### P2

| id | where | problem | fix |
|---|---|---|---|
| R-18 | `src/service/changes.ts:1375-1410` | Several alternatives of one preview can all be committed. E2: both new-booking alternatives committed, giving two extra bookings for the same guest. | On commit, mark the parent and sibling tokens (`parent_token`) `superseded` and refuse them with `preview_superseded`. |
| R-19 | `src/service/channel.ts:385-396` | The same revision redelivered with **different** content returns `duplicate` with only a note. No issue is raised and nothing is recorded (E8: `issues: []`). | Raise an urgent `channel_revision_conflict` issue and store the payload hash. |
| R-20 | `src/service/bookings.ts:459-472` (house folio only when created tentative/confirmed); `:718-760`; `:1171-1215`; `src/domain/terms.ts:241-257` | The complimentary house folio is not opened when a held, quoted or waitlisted complimentary stay later becomes confirmed. Green Tax then lands on the guest's folio (`stayFolio` opens a profile-payer folio first). Separately, deciding which taxes still apply to a complimentary stay (`QUANTITY_BASED` plus the `fee` fallback) is tax logic written in code (rule 13). If `basis` is missing, a percentage **service charge** (rates category `fee`) is kept at its full original amount. | Open the house folio wherever consumption starts. Let rates compute complimentary terms (R-02). Remove the `fee` fallback. |
| R-21 | `src/service/bookings.ts:571-587`; insert path for `add_stay` | Billing rules are fixed to the original `[arrival, departure)`. After an extension, the company-paid booking (S04) silently routes the extra nights' room charges to the guest's incidentals folio. Stays added through `add_stay` get no billing instructions. Previews do not show this. | Re-apply billing instructions on date changes and new stays, and show per-folio routing in the preview. |
| R-22 | `src/service/subscriptions.ts:70-148`; `test/front-desk-handover.test.ts:296-337` | The `inventory.availability.changed` consumer reads `payload.cells`. Inventory emits `{unitTypeId, range, coalesceKey}`, so every event scans every waitlisted stay. Waitlist `expiresAt` and `priority` are ignored: the test's waitlist entry has expired (`2026-12-09` < business date) and is still flagged. The test payload shape is invented. | Read `unitTypeId` and `range`. Skip expired entries and order by priority, then time (EC-RES-035). Use inventory's real payload in the test. |
| R-23 | `src/service/issues.ts` (resolve relocation); `test/front-desk-handover.test.ts:281-291` | A relocation case can be marked `completed` while the stay is still assigned to the blocked unit. The S08 test resolves "Moved to V102" without moving. | Check that the stay no longer occupies the blocked unit and nights before `completed`, or run the chosen option's preview token as part of resolution. |
| R-24 | `src/routes.ts:325-420,423-540` | The check-in/check-out workflow endpoints, step and skip endpoints, handover, issue and relocation resolve, and forwarded-change acknowledge take no `Idempotency-Key`. | Rule 7. Apply `idem()`. |
| R-25 | `src/service/bookings.ts:473-490`; no consumer of `inventory.assignment.changed` | Unit assignment has two sources of truth: `stay_segments.unit_id` and `inventory.assignments`. Real inventory auto-assigns composite units on `consume`/`convertHold` (`assignedUnitId` is ignored), trims assignments on `release`/`changeConsumption`, and may move them (blocks, optimisation). The fake inventory has **no composite model** (no auto-assignment, no `quantity=1` rule, no `composite_overbooking_not_permitted`, no blocks or out-of-order). | Persist `assignedUnitId`, consume `inventory.assignment.changed`, and add composites to the fake (or use real inventory in tests). |
| R-26 | `src/service/record.ts:26-196`, `front-desk.ts` | N+1 provider calls per stay (`getUnit`, `getUnitCondition`, `getPaymentStatus` ×2, `listFolios`). An arrivals board for a 400-villa resort makes hundreds of calls per page. | Use batch providers (`listUnitConditions`, `listUnits`, payment status by refs). |
| R-27 | `src/service/bookings.ts:94-103` | Channel ingestion quotes without `channelId`, so channel-only plans are not found and the booking falls back to minimal terms (no cancellation policy, `noShow: none`). | Pass the connection's channel code. Also expose `restrictionOverride` and `addOnPackageIds` (missing staff capabilities). |
| R-28 | README §"What is built", scenario table | Claims overstate the evidence. RES-R18, R20, R29, R33 and R05 are "Built", but they cannot work with real finance or rates (R-02, R-03, R-10). The S01 explanation, S02 price handling and S05-style resume are proven only against fakes whose semantics differ (R-11, R-13). | Label these rows "R3 against fakes; provider integration unverified" and list the known incompatibilities (§4). |
| R-29 | `src/service/workflows.ts:315-320`, `src/service/record.ts:12-19` | `safely` and the unit step treat only `module_not_available` as "unknown". Real operations throws `unit_not_found` for units it has not learned from inventory yet, and payments throws 403. Either one breaks the step or the whole record. | Degrade on 403 and 404 from read-only cross-module facts. |

### P3

| id | where | problem | fix |
|---|---|---|---|
| R-30 | `src/routes.ts:244-253` | `GET /stays/:id` reads the stay and the booking (for the ETag) in two transactions, so the ETag can disagree with the body. | Use one transaction. |
| R-31 | `migrations/0001_reservations.sql:57,76,113,129,145,163,206,275-276` | Foreign keys reference `(id)` instead of `(tenant_id, id)`. `bookings` already has `unique (tenant_id, id)`. | Use composite foreign keys (defence in depth under RLS). |
| R-32 | `src/ports.ts:591-596` | `assignmentConflicts` types `details.conflicts` as `EntityRef[]`. Real inventory sends `AssignmentConflictDetail[]` (the instance `.conflicts` is the `EntityRef[]`). Only truthiness is used today. | Prefer `err.conflicts`, else map `details.conflicts[].ref`. |
| R-33 | `migrations/0001_reservations.sql:370-378`; `src/service/bookings.ts:806-880` | With `autoExpire=false`, the expiry job revisits lapsed tentative bookings every 60 s indefinitely. Issue de-duplication prevents spam, but the work is wasted. | Record `option_issue_raised_at` and skip those bookings. |
| R-34 | `src/service/subscriptions.ts:35-40` | A relocation case for `house_use` or `out_of_service` blocks is labelled `cause: 'out_of_order'`. | Use `payload.kind`. |
| R-35 | `src/ports.ts:457-468`; `createPaymentRequest` | `OperationsPort.createTask` and `PaymentsPort.createPaymentRequest` are declared but never called. Their shapes do not match the providers (task `kind` enum and `dedupeKey`; payment request `propertyId`, payer `name`, `purpose` enum, `idempotencyKey`). | Remove them, or align them when first used (RES-R09/R21 tasks need `createTask`). |

**Counts: P0 1 · P1 16 · P2 12 · P3 6.**

## 3. Focus areas requested

**(a) Change-preview token integrity.** Several protections hold:
- The token row is locked `FOR UPDATE`.
- The booking version is checked under the booking lock.
- The plan is rebuilt and the permission re-checked (`assertPermission` unless trusted).
- Expiry is enforced.
- Replays are refused (`preview_already_committed`).
- Tenant isolation is enforced by RLS.
- Concurrent last-unit commits serialize (S01, 10-agent race).

Two holes remain: a stale **policy or terms** change is undetected (R-04, reproduced), and sibling or alternative tokens are not superseded (R-18, reproduced). With real inventory, the stale path itself returns 500 (R-13).

**(b) Resumable check-in.** Against the fakes:
- The run row is locked.
- There is a unique in-progress run per stay and kind.
- The guarantee step always reads the authoritative status first.
- The idempotency key changes only after a decline.
- The key step uses a fixed per-run key.
- A manual fallback is explicit and attributed.

So no double authorization and no double key issue are possible in the tested flow. Three caveats remain:
1. The real payments module returns `processing` (two-phase), which the current switch does not handle (R-11). After the adapter is added, the first resume after an asynchronous decline replays the same key once before moving on. That is safe.
2. Key effects happen inside the transaction (R-09).
3. In `read_only` and `forward` modes, external effects happen before authority is checked (R-08).

**(c) Channel ingestion.**
- Correct: duplicates (including concurrent ones, serialized by an advisory lock plus a unique constraint), older revisions recorded as stale, full replacement with field-loss detection, and shortfall committed with a conflict and relocation case.
- Wrong: cancel-before-create (R-05); in-house or past-dated messages throw (R-06); same revision with different content is silent (R-19); price mismatch drops taxes (R-01); quoting ignores the channel (R-27).

**(d) Data-authority forward mode.**
- `createBooking`, transitions, `patchBooking` and `commitChange` record a pending forwarded change and apply nothing locally. This is good and tested.
- Gaps: four write paths are unguarded (R-07); confirm is not idempotent and external steps run first (R-08). Acknowledged forwards never become effective because mirror mode is not built (acknowledged gap).

**(e) Separation of status families.** Good:
- `status: { booking }` on bookings.
- `{ stay, booking, payment?, unitCondition? }` on stays.
- Availability appears only in previews.
- Readiness is computed from distinct facts with one blocker each.

Watch-outs:
- Readiness duplicates operations' own `ready`/`readiness` (see §5).
- The payment family is derived through an adapter that does not exist yet (R-11).

## 4. PORT-vs-PROVIDER compatibility (the main deliverable)

Legend: ✅ compatible · 🔧 adapter needed (adapter given) · ❌ incompatible (who must change).

### 4.1 inventory (`/home/user/wt/inventory/modules/inventory`, `createInventoryService`)

| Function / event | reservations port (fake semantics) | real provider | verdict |
|---|---|---|---|
| `consume` | `{propertyId, unitTypeId, nights, quantity, ref, overbooking?, onShortfall?}` returns `{conflictIds?}\|undefined`. **Fake:** row-locked counters; overbooking just raises the allowance; no composite, archived-type or permission rules. | Same input plus `kind?` and `preferUnitId?`. Returns `{applied, nights, overbookingAllowanceIds, conflictIds, assignedUnitId}`. **Composite types auto-assign a unit**, need `quantity=1` (`composite_quantity_one`) and cannot be overbooked (`inventory_unavailable` reason `composite_overbooking_not_permitted`). `consumption_mismatch` (409) for the same ref with a different quantity. `unit_type_archived`. Overbooking needs `inventory.overbooking.authorize` and a reason of at least 3 characters. | 🔧 Shape is compatible. Reservations must persist `assignedUnitId` into the segment (R-25). Permission delegation needed (R-14). |
| `release` | `{ref, nights?}` returns void. **Fake:** releases **all** active holds even when `nights` is given; never unassigns. | Same input. Returns `{releasedCells, holdsReleased, unassigned, conflictsResolved}`. **Trims assignments** in the range. Holds and ad-hoc allowances are released only when `nights` is omitted. | ✅ Reservations' extra `unassignUnit` afterwards becomes a no-op. |
| `changeConsumption` | `{ref, from:{unitTypeId,nights}, to:{unitTypeId,nights}}`. **Fake:** deletes, then decrements `sold` by 1 for **every** from-night (even unconsumed ones), re-consumes, never unassigns. | Same, plus optional `quantity`, `overbooking`, `onShortfall`, `reason` and `preferUnitId`. `from` must match the existing consumption exactly (`consumption_not_found`, `consumption_quantity_varies`). Uses a savepoint. **Trims old-type assignments.** | ✅ for reservations' use (`planInventory` emits type changes only over consumed nights). Fix the fake's blind decrement. |
| `createHold` | `{propertyId, unitTypeId, nights, quantity, expiresAt, ref}` returns `{holdId}` | Returns `{holdId, expiresAt}`. Expiry must be in the future and at most 180 days away (`invalid_hold_expiry`, `hold_too_long`). Composite holds also hold component types. | ✅ |
| `convertHold` | `{holdId, ref}`. **Fake error:** `hold_expired` (BusinessRuleError). | `hold_not_active` or `hold_already_converted` (BusinessRuleError), or `inventory_unavailable` reason `hold_not_convertible` after a lazy fresh-sale attempt. Converting to the same ref again is a no-op. | ✅ Reservations catches BusinessRuleError and shortfall. |
| `assignUnit` | `{unitId, ref, nights, locked?}`. **Fake:** any overlap, **including the ref's own**, is a conflict; no other checks. `details.conflicts = EntityRef[]`. | Needs `inventory.assignment.manage`. `locked` needs `lockReason` (`lock_reason_required`). Needs consumption on every night (`assignment_without_consumption`). Unit type must equal the consumed type unless `upgrade:{reason,chargeable}` (`unit_type_mismatch`). Unit must be active (`unit_not_assignable`). Re-assigning the same ref **moves** it. Locked assignments need `overrideLock` (`assignment_locked`). Conflict error `unit_assignment_conflict` with `details.conflicts = [{ref, unitId, unitNumber, nights}]` (instance `.conflicts: EntityRef[]`). | 🔧 Add `lockReason?` and `overrideLock?` to the port. Map conflicts from `err.conflicts`. Delegation needed (R-14). Reservations already consumes before assigning and assigns only the same type. ✅ ordering. |
| `unassignUnit` | `{ref, nights?}`. **Fake:** deletes every assignment of the ref, then re-inserts the parts outside the cut. | Needs `assignment.manage` when there is something to unassign. Locked assignments give `assignment_locked` unless `overrideLock`. | 🔧 Add `overrideLock` and `reason` (RES-R17 "respects locked assignments" needs them). |
| `findAssignableUnits` | `{propertyId, unitTypeId, nights}` returns `[{unitId, name, unitTypeId, assignable, reason?, conflictingRefs?, fitScore?}]`. **Fake:** checks assignments only. | Input adds `ref?` (the ref's own assignments are not conflicts), `features?` and `includeUnavailable` (default true). Returns `[{unitId, number, name\|null, location, features, assignable, score, isComponent, isComposite, compositeUnitIds, matchedFeatures, missingFeatures, exclusions[{code: assigned\|out_of_order\|out_of_service\|house_use\|inactive\|component_unavailable\|composite_in_use, message, ref, nights, blockId}], ranking}]`. Needs `unit.read` or `assignment.manage`. | 🔧 `name = c.name ?? c.number`; `reason = c.exclusions.map(e => e.message).join('; ') \|\| undefined`; `conflictingRefs = c.exclusions.flatMap(e => e.ref ? [e.ref] : [])`; `fitScore = c.score`; pass `ref` when re-placing a stay. |
| `getAvailability` | `AvailabilityCell` (8 fields) | Superset (adds `outOfService`, `houseUse`, `overbookingInUse`, `oversoldBy`, `conflictId`, `status`, `composite`). Needs `availability.read`. | ✅ |
| `explainAvailability` | `{unitTypeId, date, available, consumers[{ref, quantity, consumedAt}]}` | `{propertyId, unitTypeId, unitTypeName, date, status, headline, formula, available, terms, reasons, units[], sold[{ref, quantity, kind}], holds, allowances, conflict, composite, provenance, authority, generatedAt}`. **No `consumers`, no `consumedAt`.** | ❌ The stale path throws a TypeError (R-13). **Reservations must change:** map `sold` to consumers and order by its own `booking_versions.changed_at` (it already looks up the booking). Alternatively inventory adds `consumedAt`. |
| `getUnit` | `{id, propertyId, unitTypeId, name}` | `Unit {…, number, name\|null, status, isComposite, componentUnitIds, …}`. Needs read permissions. | 🔧 `name = u.name ?? u.number` (search by "unit number" needs `number`). |
| `listUnits` | `(tx, {propertyId})` | `(tx, propertyId, filter?)` | 🔧 Signature adapter. |
| `listUnitTypes` | `(tx, {propertyId})`, needs `rank` and `maxOccupancy` | `(tx, propertyId, opts?)`; `UnitType` has `rank` and `maxOccupancy`. | 🔧 Signature adapter. |
| error `inventory_unavailable` | `details.shortNights` | `details.{unitTypeId, requested, shortNights, reason}`; `shortNights` may be `[]` for `hold_not_convertible`. | ✅ |
| event `inventory.unit.blocked` (consumed) | reads `unitId`, `kind`, `affectedAssignments[{ref,nights}]` | `UnitBlockedPayload` includes those, plus `unitId` per affected assignment. | ✅ |
| event `inventory.availability.changed` (consumed) | reads `payload.cells[{unitTypeId,night}]` | `{propertyId, unitTypeId, range, coalesceKey, cause}` | 🔧 Reservations reads `unitTypeId`/`range` (R-22). |
| event `inventory.assignment.changed` | not consumed | emitted on auto-assign, moves and trims | ❌ Reservations must consume it, or read assignments through `listAssignments` (R-25). |
| permissions | fake checks none | assignment, overbooking, availability and unit-read checks on the caller | ❌ **Inventory** must adopt provider delegation (R-14). |

### 4.2 rates (`/home/user/wt/rates/modules/rates`, `ratesService(ports)`)

| Function / shape | reservations port (fake semantics) | real provider | verdict |
|---|---|---|---|
| `quote` input | `{propertyId, nights, occupancy, unitTypeIds?, ratePlanIds?, channelId?, companyId?, promoCode?, bookingDate?}` | Same, plus `restrictionOverride?{reason}` (staff permission; refused for channels) and `addOnPackageIds?`. Needs `rates.quote.read`. | ✅ input (R-27: pass `channelId`). |
| `Offer` | `{unitTypeId, ratePlanId, ratePlanName?, nightly[{date,amount}], inclusions[{code,name}], taxesAndFees: TaxLine[], totals{net,taxes,fees,gross}, policies (reservations shape), restrictionViolations[{code,message}], terms}` | `{…, ratePlanCode, ratePlanName, mealPlan, currency, bookable, nightly: NightPrice[] (has date, amount, net, gross, taxes, components, occupancyPricing), inclusions:{included, added, allowances}, taxesAndFees: TaxSummaryLine[] (ruleCode, ruleName, category, inclusive, ruleVersionIds), totals (+allInTotal), policies:{cancellation\|null, guarantee\|null, deposit\|null} (policyRef + structure + resolved tiers/schedule), commission, restrictionViolations[{kind, date, message, required, actual, overridable, source}], overriddenViolations, unverifiedTaxRules, terms}` | 🔧 `inclusions = o.inclusions.included.map(i => ({code: i.code, name: i.name}))`; `restrictionViolations = v.map(x => ({code: x.kind, message: x.message}))`; ignore `taxesAndFees` (use `terms`). Reservations should also respect `bookable` and `unverifiedTaxRules`. |
| `TermsSnapshot` | `{schemaVersion, propertyId, ratePlanId, ratePlanVersion?, unitTypeId, occupancy, currency, priceSource: 'portico'\|'channel'\|'override', nights[{date, net, taxes: TaxLine[], inclusions?}], inclusions[{code,name}], totals{net,taxes,fees,gross}, policies{cancellation:{tiers[{deadline:{daysBeforeArrival,time}, penalty}], nonRefundable?, nonRefundablePenalty?, noShow, earlyDeparture?, text?}, guarantee:{required: GuaranteeKind[], releaseTime?}, deposit:{items[{kind, basis, value?, amount?: Money, due?}]}}, commission?{kind, percent?}, override?, quotedAt, configVector?}` | `{schemaVersion: 1, kind:'portico.rates.terms', quoteId, quotedAt, configVector, propertyId, propertyTimezone, checkInTime, currency, priceSource: 'portico_quote'\|'channel'\|'manual_override', ratePlan:{id, code, name, version, mealPlan, roomChargeCode, marketSegment, derivationChain}, unitTypeId, stay:{arrival, departure, nights}, bookingDate, occupancy, childAgeBands, taxInclusion, nights: NightPrice[], addedComponents, allowances, inclusions: InclusionSnapshot[], promotions, policies:{cancellation: {…policyRef, structure:{tiers[{from: at_booking\|days_before_arrival{days,time}\|hours_before_checkin{hours}, penalty}], noShow, earlyDeparture, basis: gross\|net}, tiers[{fromInstant, penalty, description}]}\|null, guarantee:{…, structure:{accepted, holdUntil?}}\|null, deposit:{…, structure:{items[{kind, amount:{basis, percent\|nights\|amountMinor}, due, method, onOverdue}]}, schedule[]}\|null}, commission, taxes:{summary, ruleVersionIds}, totals (+allInTotal), restrictionOverride, supersedesHash, hash}` | ❌ **Both modules change.** Reservations persists rates' document **verbatim** and reads it through a view adapter. Rates adds complimentary and channel-price constructors (R-02). Mapping: `ratePlanId = t.ratePlan.id`. `priceSource`: `portico_quote`→`portico`, `manual_override`→`override`. `nights[].taxes[]`: `{code: ruleCode, name: ruleName, kind: category, amount, ruleVersionId, basis: kind}` (**the `kind` field collides**: reservations' `kind` is rates' `category`, and reservations' `basis` is rates' `kind`). `guarantee.required = t.policies.guarantee?.structure.accepted ?? ['none']`. Deposits come from `instantiatePaymentSchedule(terms)`. Cancellation comes from `structure` (basis, deadline kinds) or the resolved `fromInstant` tiers (R-03). Penalty `amount`: `{amountMinor}` becomes Money in the terms currency; `percent` is a decimal string, not a number. |
| `priceChange` input | `{terms, change:{nights, unitTypeId, ratePlanId, occupancy, typeChange?, asOf: LocalDate}}` | `{terms (hash-verified), change:{nights?, occupancy?, unitTypeId?, newNightsPolicy?, manualNightAmountsMinor?, typeChangePolicy?, changeAt?: ISO instant}}`. **No `ratePlanId`**: changing the rate plan is not a `priceChange` concern in rates. | 🔧/❌ `typeChange`→`typeChangePolicy`; `asOf` (business date)→`changeAt` (instant now, or the business-date start in the property time zone). Reservations' `rate_plan` change kind must re-quote, not call `priceChange`. Rates rejects documents reservations has mutated (R-02). |
| `RepricingResult` | `{nightly[{date, before, after}], penalties[{kind, amount, description}], terms}` | `{nights[{date, before, after, source, difference}], penalties[{kind: cancellation\|early_departure, nights[], amount, description}], before, after, difference, violations, candidateTerms}` | 🔧 `nightly = r.nights`; `terms = r.candidateTerms`. Rates' penalties should become the single source (R-03). |
| `recordPlanSale` / `releasePlanSale` | absent | provider additions for sales limits | ❌ Reservations must call them (R-15). |
| `instantiatePaymentSchedule`, `postingPlan`, `verifyTerms` | not used (reservations has its own `requiredDeposit` and terms hash) | pure helpers | 🔧 Reservations should use them (duplicate logic, R-03). |
| event `rates.taxRule.activated` | not consumed | rates' README says the affected-stays list is reservations' or finance's job | gap (record in README). |
| permissions | fake checks none | `rates.quote.read` on `quote` and `priceChange` | ❌ Delegation (R-14). |

### 4.3 guests (`/home/user/wt/guests/modules/guests`, `createGuestsService`)

| Function / event | port | provider | verdict |
|---|---|---|---|
| `resolveProfile` | `GuestProfileInput` (= guests `ProfileInput`), opts `matchStrategy` returns `{profileId, created, possibleDuplicates}`. **Fake:** matches on any non-channel email. | Same input. Also returns `suggestions`. Default strategy is `exact_only`. Reuses only **verified** emails, E.164 phones or document hashes. Needs `guests.profile.update`. | ✅ shape. The fake over-matches (booking emails are claims in guests). Delegation needed for agents without `guests.profile.update` (R-14). |
| `recordStayHistory` | `{profileId, stayRef, propertyId, bookingId?, role?, arrival, departure, status, unitTypeId?, ratePlanId?, companyId?}` | Same, plus `revenue?` and `revenueProvenance?`. `stayRef.type` must be `'stay'`. Trusted provider call (no permission check). | ✅ |
| `recordReferenceRepoints` | `{mergeId, module, references}` returns `{recorded}`. Error `merge_not_active`. | Same. | ✅ |
| `guests.profile.merged` / `unmerged` | `{mergeId, survivorId, mergedId}` / `{mergeId, restoredId, survivorId, referencesToRestore, reassigned}` | Identical (`ProfileMergedPayload`, `ProfileUnmergedPayload`) | ✅ |

### 4.4 finance (`/home/user/wt/finance/modules/finance`, bind **`financeForReservations(finance)`**, which finance already wrote)

| Function | port | provider (through `financeForReservations`) | verdict |
|---|---|---|---|
| `openFolio` | `{propertyId, owner, payer: PayerRef{profile\|company\|agency\|house}, label?}` | Maps `profile`→`guest`; defaults the payer name; the first folio of an owner is the default. | ✅ |
| `postCharge` | `{propertyId, folioId?\|target?, chargeCode, amount, quantity?, serviceDate, description, sourceRef, idempotencyKey, taxMode?, taxLines?: TaxLine[]}`. **Fake:** any code, any date, `amount×quantity`. | Same core fields. **Codes must exist** (`unknown_charge_code`). `serviceDate > businessDate` is refused. A user posting with `serviceDate < businessDate` must give `reason`. `taxLines` is `{ruleId, ruleVersionId, name, accountKey, amount}` (reservations only uses `compute`). `amount` is the line total. | ❌ **Reservations** changes its charge codes, fee timing and `reason` (R-10). Make the fake strict. |
| `recordDeposit` | `{bookingId, amount, paymentRef, idempotencyKey}` | Same (+`propertyId?`) | ✅ |
| `applyDeposits` | returns `{applied}\|undefined` | `{applied}` only when an entry was created | ✅ |
| `getFolioBalance` / `listFolios` | `{folioId, balance, status}` / `FolioSummary[]` | Mapped, including `isDefault` | ✅ |
| `setBillingRules` | `{owner, rules[]}`. **Fake:** appends. | `replaceBillingRules` (**replaces** the owner's whole set) | ✅ as used, but R-21 (rules never re-applied on date changes or new stays). |
| `getDepositBalance` | `Money\|null` | `getDeposits(...)?.balance ?? null` | ✅ |
| event `reservations.stay.checkedOut` | payload `{stayId, bookingId, unitId, businessDate, earlyDeparture, stays[]}` | Finance consumes `stayId`, `propertyId` and `businessDate` | ✅ |
| event `reservations.booking.cancelled` (penalties, `depositHeld`) | emitted | **no consumer** in finance or payments | ❌ Gap: RES-R20 deposit treatment is never executed (finance or payments must add a consumer). |

### 4.5 payments (`/home/user/wt/payments/modules/payments`, `createPaymentsService(...).provider`)

| Function | port (fake semantics) | provider | verdict |
|---|---|---|---|
| `authorize` | `{methodId, amount, ref, idempotencyKey}` returns `PaymentAttempt{id, status: authorized\|succeeded\|pending_verification\|failed\|requires_action, amount, failureReason?}`. **Fake:** the provider outcome is decided synchronously inside the transaction; a timeout throws `external_service_error`. | `{propertyId, methodId, amount, ref, idempotencyKey (business key), initiator?}`. The operation is persisted in the transaction and the **provider call runs after commit**. Returns `Authorization{id, amount, capturedMinor, status:{authorization: processing\|pending_verification\|authorized\|partially_captured\|captured\|voided\|expired\|failed}, decline, mode, presentation, …}`. Needs `payments.payment.collect`. | ❌ Without an adapter the step crashes (R-11). Adapter: `status = {processing:'pending_verification', pending_verification:'pending_verification', authorized:'authorized', partially_captured:'authorized', captured:'succeeded', failed:'failed', expired:'failed', voided:'failed'}[a.status.authorization]`; `failureReason = a.decline?.message`. Add `propertyId` to the port. Make the fake two-phase. |
| `getPaymentStatus` | returns `{ref, status: none\|requested\|authorized\|pending_verification\|succeeded\|failed\|requires_action, authorized, captured, pendingVerification}` | Returns `{ref, totals[{currency, confirmedMinor, recordedUnverifiedMinor, pendingVerificationMinor, refundedMinor, heldMinor}], payments[], authorizations[], refunds[], hasPendingVerification}`. Needs `payments.payment.read` or `collect`. | 🔧 `status = hasPendingVerification ? 'pending_verification' : any payment succeeded/recorded_verified ? 'succeeded' : any auth authorized/partially_captured ? 'authorized' : latest auth or payment failed ? 'failed' : 'none'`. `requested` cannot be derived: it needs a payment-request lookup by ref, which payments must add. Money fields come from `totals`. Degrade on 403 (R-14, R-29). |
| `createPaymentRequest` | `{legalEntityId, payer: PayerRef, amount, purpose: string, ref, expiresAt}` | `{propertyId, legalEntityId?, payer:{type: guest_profile\|company\|agency\|other, id?, name, email?}, amount, purpose: deposit\|balance\|incidentals_preauth\|custom, ref:{type: folio\|booking}, expiresAt, idempotencyKey, description?}` | ❌ Unused by reservations. Remove it, or align when deposits are collected (R-35). |
| `charge` (merchant-initiated) | absent | provider exists | ❌ Needed for the RES-R29 no-show charge. |

### 4.6 operations (`/home/user/wt/operations/modules/operations`)

| Function / event | port | provider | verdict |
|---|---|---|---|
| `getUnitCondition` | returns `{condition, inspectedAt?, discrepancy?}` | Returns `{unitId, condition, inspectedAt\|null, discrepancy\|null, occupancy, dnd, ready, readiness, blocked, provenance, pendingChange}`. No permission check (internal provider). Throws `unit_not_found` for units operations has not learned yet. | ✅ shape (null vs undefined is harmless). 🔧 Treat `unit_not_found` as "unknown" (R-29). Consider using `ready`/`readiness` instead of recomputing (§5). |
| `createTask` | `{propertyId, departmentId?, kind: string, title, ref?, dueAt?, priority}` returns `{taskId}` | `kind: TaskKind` enum; adds `departmentKind`, `description` and `dedupeKey`. Returns `{taskId, created}`. Needs `operations.task.manage`. | ❌ Unused today. Align when RES-R09/R21 tasks are built (R-35). |
| reservations `booking.confirmed/modified` (v2 `stays[]`), consumed by operations | `stays[].earlyCheckIn: {time}\|null`, `eta: 'HH:MM'\|null`, `vipLevel: string\|null` | `stayShape.earlyCheckIn: boolean?`, `eta: ISO datetime?`, `vip: boolean?` | ❌ **Verified failure** (R-12). Operations must accept reservations' v2 shape, or both agree a domain-map schema. |
| reservations `stay.moved`, consumed by operations | `{stayId, fromUnitId, toUnitId, fromDate, reason}` | `movedPayload {stayId, fromUnitId?, toUnitId, effectiveDate?}` | 🔧 Rename to `effectiveDate`, or have operations read `fromDate`. Operations must honour future-dated moves. |
| reservations `stay.checkedIn/checkedOut/extended/shortened/noShow`, `booking.cancelled` | as emitted | `stayEventPayload` and `bookingCancelledPayload` (loose) | ✅ |

### 4.7 platform / access

- **PlatformPort**: bound to the real platform (`getProperty` through the system authorizer). ✅
- **AccessPort**: no provider exists yet. The `environmentAccessAdapter` correctly calls `assertExternalEffectAllowed(ctx, 'access.key')`. The contract must become two-phase before a lock vendor is bound (R-09).

## 5. Cross-module notes for the orchestrator

1. **Provider delegation must be shared.** Only finance has `PROVIDER_DELEGATION` + `delegated()` (`finance/src/service/support.ts:43`). Inventory, payments, rates, guests and operations re-check the caller's own permissions inside provider calls, so each reservations command implicitly requires 5–10 foreign permissions (R-14). Finance's helper also widens the scope to `'all'`. Move a property-scoped `delegated(tx, perms, propertyId)` into `@portico/db` or the kernel and use it in every provider.
2. **Agreed terms are a shared contract and currently diverge** (R-02, R-03). Recommendation: rates exports its `TermsSnapshot` Zod schema as the canonical contract (mirrored in domain-map). Reservations keeps a read-only view adapter. Penalty, deposit and tax-applicability logic lives only in rates (`penaltyFor`, `instantiatePaymentSchedule`, complimentary and channel constructors).
3. **Event payload contracts need a single source.** Reservations' v2 payloads and operations' consumer schemas already disagree (R-12). Inventory's `availability.changed` and reservations' consumer disagree (R-22). Proposal: every producer exports Zod payload schemas from `contracts.ts` (no server imports), the domain map lists them, and a contract test in `apps/api` validates every emitted event against its schema.
4. **The fakes encode the wrong semantics.** Synchronous payments outcome, inventory without permissions or composites, finance without code and date rules, rates' terms shape. Before binding: re-run S01, S02, S03, S04 and check-in-resume with the real inventory, rates and finance providers, as the README already asks for S01, and make the remaining fakes strict.
5. **Duplicate concepts.** Unit readiness is computed both in reservations (`domain/readiness.ts`) and in operations (`readiness`). Unit assignment is stored both in `stay_segments.unit_id` and `inventory.assignments`. Reservations "issues" overlap operations "tasks" (RES-R09/R21 expect tasks). Each needs one owner.
6. **Missing consumers.** No one executes deposit treatment on `reservations.booking.cancelled` (RES-R20), and no one charges a no-show by merchant-initiated payment (RES-R29). Finance and payments must decide who owns these.
7. **Finance charge-code catalogue.** Reservations needs no-show, early-departure, early-check-in and late-check-out codes. Either finance seeds them, or reservations reads them from policy (R-10).

## 6. Spec coverage summary (MUST)

| Status | Requirements |
|---|---|
| Built and tested (against fakes) | R01, R02, R03, R04, R05 (after the Green Tax fix; see R-02/R-20), R07, R08, R11 (no payment schedule or policy text), R13, R15, R16, R17 (no lock override), R19, R22, R25, R26, R30, R32, R34 (case only), R37, R39 |
| Partial | R06 (no release-time exception), R09 and R21 (issue instead of task; waitlist expiry and priority ignored), R12 (no config vector; R-04), R18 (fees cannot post in real finance), R20 (deposit treatment unowned), R24 (no `documents` step or `checkIn.steps` policy), R27 (no `invoice` step), R29 (no merchant-initiated charge), R31 (cancel-before-create; R-05), R33 (taxes dropped; R-01), R35 (no waiting guests), R36 (no timeline API), R38 (`listIssues`, not the common exception shape) |
| Missing | R10 reinstatement / reverse check-in, R14 channel-owned field lock |
| SHOULD | R23 upgrade offers: not built |

Invariants: I01, I02, I04, I05, I06, I08 and I10 are enforced and tested. I07 has the policy-drift hole (R-04). I09 is proven only against a synchronous fake (R-11). I03 is enforced at check-in.

## 7. Scenario-claim assessment

| Scenario (README) | Assessment |
|---|---|
| S01 last unit | Concurrency is genuinely tested (`Promise.allSettled`, 10-agent race). The explanation and alternatives depend on the fake inventory's `consumers[].consumedAt` shape, so real inventory returns 500 on this path (R-13). Composites are not modelled. **Valid against the fake only.** |
| S02 channel | Duplicates (including concurrent), stale older revisions, cancellation charged at the agreed price, and conflict with relocation are demonstrated. The price-discrepancy test asserts only `net`. With a discrepancy, taxes are dropped (R-01, P0). Cancel-before-create (R-05) and in-house cancellation (R-06) are not covered. **Partially valid.** |
| S03 extension conflict | Alternatives are fully previewed and commit atomically. This is good. It relies on the fake's `findAssignableUnits` shape and gives no permissions to inventory (R-13, R-14). |
| S04 family / company | Child ages drive price and Green Tax through the fake rates. Billing instructions are passed. Extension and added-stay routing is not covered (R-21). |
| S14 concurrent edits | Genuine; good. |
| Check-in resume (S05 support) | Proves "never authorize twice" only with a synchronous fake payments module. The real provider is two-phase (R-11). Key effects happen inside the transaction (R-09). |
| S08 relocation | The case opens once (idempotent consumer). The case can be closed as "completed" with no move (R-23). |
| S17 isolation | Good: by id, list, preview, change, search and raw SQL under RLS. |

## 8. Honest readiness

The README marks everything R3 and correctly states that the fakes are not proof for S01. It still lists as "Built"
capabilities that cannot work with the real providers (R-10, R-11, R-13). Re-label them "R3 (fakes); provider
integration unverified" and link this compatibility table (R-28). Access/locks at R1 is correct. Nothing is claimed
above R3.

## 9. Experiments run (scratch copy only)

| id | Result |
|---|---|
| E1 | Stale preview committed after the plan became non-refundable with a deposit guarantee; the stored terms are non-refundable (R-04). |
| E2 | Both alternatives of one infeasible new-booking preview committed: 3 bookings (R-18). |
| E3 | Cancellation revision 3 before creation revision 1 leaves the booking `confirmed` (R-05). |
| E4 | `read_only`: `patchStay` and `assignUnit` succeed (R-07). |
| E5 | `forward`: 3 forwarded `check_in` rows; authorization and key issue performed (R-08). |
| E6 | Channel price +1 minor unit: taxes 0, fees 0 (R-01). |
| E7 | A user with only `reservations.booking.create` creates a booking with a unit assignment, because the fakes skip provider permissions (R-14). |
| E8 | Same revision with different content: `duplicate`, no issue (R-19). |
| E9 | Channel cancellation of an in-house stay throws `stay_in_house` (R-06). |
| E10 | Past-dated channel booking throws `arrival_in_past` (R-06). |
| E11 | `read_only`: check-in authorizes the card and issues keys, then fails at confirm (R-08). |
| Operations schema probe | Reservations' v2 booking payload fails operations' `bookingPayload` parse (R-12). |
