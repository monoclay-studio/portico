# Operational proof scenarios and evidence

Status: v1 · 2026-11-07. The 20 proof scenarios of brief §17 (`S01`–`S20`), the evidence items of the
operational-readiness brief §19 (`E01`–`E15`) and the adoption evidence implied by the adoption brief (`A01`–`A07`).
A capability is not done until the scenarios it participates in pass **through real product workflows**
(CLAUDE.md §7). Automated tests prove behaviour; staff validation is recorded separately in `docs/readiness/`.

**Test names are normative** (`scenarios/sNN-*.test.ts`, `scenarios/eNN-*.test.ts`, `scenarios/aNN-*.test.ts`); the
hosting package is an engineering choice. Each test creates its own tenant(s) with `createTestTenant()`, loads the
relevant Maldives sample data, runs through public service/HTTP APIs, and finishes with the **global consistency
checks**: inventory ledger = Σ consumption and holds (INV-I02), no oversold cell without a conflict (INV-I03),
reservations ↔ inventory consistency (RES-I02), trial balance zero and control accounts = Σ sub-ledgers (FIN-I02,
FIN-I14), no duplicate idempotency effects, audit rows present for every consequential command.

**Sample data (decision D8):** *Hiyani Guesthouse* (12 rooms, inhabited island, Green Tax class $6), *Kandu Atoll Resort*
(120 villas: Beach, Water, Sunset Water with Pool, Two-Bedroom Beach Residence = composite; Green Tax class $12), and
*Azure Isles Group* (3 properties incl. Kandu). Taxes use the **unverified** Maldives rule pack (Q41 defaults).

Template per item: **Pre** preconditions · **Steps** user experience · **State** expected resulting state ·
**Money** financial effects · **Inventory** inventory effects · **Audit** history · **Recovery** · **Modules** · **Test**.

---

## 1. Proof scenarios (brief §17)

### S01 — Two reservation agents attempt to sell the final available room
- **Pre:** Kandu, Water Villa, exactly 1 available for 10–13 Mar; agents Aishath and Hassan with booking permission.
- **Steps:** both quote and open the change preview showing "1 available"; both press Commit within 50 ms.
- **State:** one booking `confirmed`; the other agent sees "Just sold — Water Villa for 10–13 Mar was booked 0.04 s ago by
  Aishath (K7P2M9QX)" with alternatives (Sunset Water Villa, other dates, waitlist); no partial booking exists.
- **Money:** only the winner gets a collection plan (deposit item); no postings.
- **Inventory:** Water Villa `sold +1` for 10, 11, 12 Mar; `available = 0`; no conflict.
- **Audit:** winner `booking.created/confirmed`; loser's failed command logged with reason `inventory_unavailable`.
- **Recovery:** loser picks an alternative from the preview; no retry storm (deadlocks retried internally).
- **Modules:** reservations, inventory, rates. **Test:** `scenarios/s01-last-room.test.ts` (+ 50-parallel stress variant).

### S02 — An OTA reservation is delivered twice, then modified and cancelled
- **Pre:** channel simulator connected via integration/distribution; mappings complete; hotel-collect booking with a VCC;
  free cancellation until 7 days before arrival, then 1 night.
- **Steps:** revision 1 delivered twice; revision 2 (one night added, special request removed); revision 3 cancellation
  3 days before arrival.
- **State:** one booking; second delivery → `duplicate`; revision 2 applied with a **field-loss review** exception
  ("special request removed by channel"); revision 3 → booking `cancelled` with penalty.
- **Money:** penalty = 1 night + taxes posted to the booking folio; VCC charge for the penalty via collection plan
  (simulated) → one payment posting; folio settled.
- **Inventory:** consumed (3 nights) → changed (4 nights) → released.
- **Audit:** all three revisions stored immutably with diffs; acks sent only after commit.
- **Recovery:** a resent ack or redelivery is harmless (`duplicate`).
- **Modules:** integration, distribution, reservations, inventory, rates, finance, payments.
  **Test:** `scenarios/s02-ota-duplicate-modify-cancel.test.ts`.

### S03 — A guest extends into dates when the assigned villa is already booked
- **Pre:** Ms Ivanova in house in Beach Villa 214 until 12 Mar; 214 booked by Mr Chen 12–15 Mar; Beach Villas 216 and
  218 free; Sunset Water Villa free.
- **Steps:** desk extends to 14 Mar; preview: type-level availability OK, villa 214 unavailable 12–13 Mar, options:
  (a) move to 216 for 12–14 Mar, (b) move whole stay to 216 now, (c) upgrade to Sunset Water Villa, (d) waitlist.
  Agent chooses (a).
- **State:** stay departure 14 Mar; new segment 12–14 Mar on 216; locked assignment of Mr Chen untouched.
- **Money:** agreed nights unchanged; new nights at current rates; preauthorization increment requested via payments;
  projected folio updated (estimate marker).
- **Inventory:** Beach Villa consumption +2 nights; assignment 216 for 12–14 Mar.
- **Audit:** extension and move with preview id. **Recovery:** if 216 is sold during preview → `preview_stale` with new
  options. Operations receives a move task for 12 Mar.
- **Modules:** reservations, inventory, rates, payments, operations. **Test:** `scenarios/s03-extension-into-booked-villa.test.ts`.

### S04 — A family books several rooms; a company pays accommodation, guests pay incidentals
- **Pre:** company *Seabridge Engineering* with receivables account; one booking with 3 stays (parents; grandparents;
  two children aged 6 and 12 with an aunt).
- **Steps:** booker (company assistant) creates booking; billing rules "company pays room charges and room-related
  taxes/fees (incl. Green Tax)", incidentals to each stay's default folio; "who pays for what" preview; check-in; outlet
  and spa charges; check-out.
- **State:** company folio per stay (or booking-level company folio) settled to receivables; guests' incidental folios
  paid by card; invoices per payer.
- **Money:** postings routed exactly as previewed; receivables invoice to Seabridge; card payments for incidentals.
- **Inventory:** 3 units for the stay dates. **Audit:** billing rules with source; settlement and invoices.
- **Recovery:** an incidental mistakenly routed to the company is transferred back with preview (FIN-R11).
- **Modules:** reservations, guests, finance, payments, rates. **Test:** `scenarios/s04-family-split-billing.test.ts`.

### S05 — A payment succeeds externally, but the screen times out before confirmation
- **Pre:** card on file; simulator scenario "timeout-then-success".
- **Steps:** check-in guarantee step charges USD 500; the request times out; screen shows **Pending verification**; the
  agent presses Charge again → blocked with explanation; "Check now" or resolver/webhook resolves → Paid.
- **State:** payment `succeeded`; check-in step `done`; collection item satisfied.
- **Money:** exactly one provider charge and one payment posting, created only after confirmation.
- **Inventory:** none. **Audit:** provider operation with idempotency key, attempts, resolution source.
- **Recovery:** variant "timeout-then-failure" → `failed`, retry permitted with a new operation.
- **Modules:** payments, finance, reservations. **Test:** `scenarios/s05-payment-timeout.test.ts`.

### S06 — A refund request is retried after an interruption
- **Pre:** captured payment USD 800; refund USD 300 approved; simulator accepts the refund but the process is killed
  before recording the response; webhooks later delivered twice and out of order.
- **Steps:** user retries the refund (same idempotency key).
- **State:** one refund `succeeded`; original payment unchanged.
- **Money:** one refund posting linked to the original payment; folio shows payment and refund.
- **Audit:** operation, retry, webhook dedupe. **Recovery:** retries are safe at any point.
- **Modules:** payments, finance. **Test:** `scenarios/s06-refund-retry.test.ts`.

### S07 — A room fails inspection just before its arriving guest reaches reception
- **Pre:** VIP couple ETA 14:30 assigned Water Villa 305 (clean); other inspected Water Villas available.
- **Steps:** at 14:05 inspector fails 305 (reasons + photos); desk gets an interrupt alert with ETA and the next-best
  inspected villas; agent moves the assignment to 307 (no price change) — or chooses to wait with estimated ready time.
- **State:** 305 `failed_inspection` + priority re-clean task; arrival readiness green on 307.
- **Money:** none. **Inventory:** assignment changed atomically. **Audit:** inspection, alert, move.
- **Recovery:** if the guest arrives first, waiting-guest timer and estimated readiness are shown.
- **Modules:** operations, reservations, inventory. **Test:** `scenarios/s07-failed-inspection-at-arrival.test.ts`.

### S08 — A maintenance outage makes several assigned rooms unavailable
- **Pre:** chiller failure on Jetty B: 4 Water Villas need 2 nights OOO; 3 have assigned stays (2 in house, 1 arriving);
  Water Villas are sold out on the second night.
- **Steps:** engineer creates the work order with OOO; preview lists affected stays and the night that becomes
  oversold; commit; front office works relocation cases: in-house guests moved to Sunset Water Villas (complimentary
  upgrade), arrival relocated to a sister property (group) or upgraded.
- **State:** blocks active; conflicts resolved by relocation; return to sale only after work order completed and
  inspection passed.
- **Money:** relocation costs posted to the house account; complimentary upgrades keep agreed prices.
- **Inventory:** `outOfOrder +4`; conflict opened then resolved (`relocated`/`upgraded`).
- **Audit:** work order, blocks, relocation decisions. **Recovery:** extending the outage re-runs impact preview.
- **Modules:** operations, inventory, reservations, finance, comms. **Test:** `scenarios/s08-maintenance-outage.test.ts`.

### S09 — Night audit (Day Close) stops after some charges have been posted
- **Pre:** 112 in-house stays; Day Close run for D; fault injected after 67 room postings.
- **Steps:** run fails; run page shows "Room postings: 67 of 112"; auditor presses Resume.
- **State:** run completed; business date D+1; statistics snapshot for D.
- **Money:** exactly 112 room postings (+ inclusions); no duplicates; trial balance balanced at every point.
- **Inventory:** unchanged (integrity check passes). **Audit:** step log with failure and resume.
- **Recovery:** resume is idempotent at every step. **Modules:** day-close, finance, reservations, platform.
  **Test:** `scenarios/s09-day-close-interrupted.test.ts`.

### S10 — A restaurant charge arrives after the guest has checked out
- **Pre:** guest checked out 11:00; folio paid by card and invoiced; POS posts a USD 64 lunch check at 11:20.
- **Steps:** POS intake finds the departed stay; finance posts to a **supplementary folio** (invoice immutable);
  collection follow-up charges the card on file as merchant-initiated (terms allowed it) → supplementary invoice.
  Variant: folio settled but not invoiced → reopened.
- **State:** supplementary folio settled; departures follow-up exception closed.
- **Money:** charge + taxes posted with the POS idempotency key; one MIT payment; guest ledger zero.
- **Audit:** late-charge flag, collection decision. **Recovery:** POS retry → no duplicate.
- **Modules:** resort (POS intake), finance, payments, reservations. **Test:** `scenarios/s10-late-outlet-charge.test.ts`.

### S11 — A group reduces its room block after a contractual deadline
- **Pre:** wedding group, definite block 20 villas × 4 nights; contract: reductions above 10% after the 60-day deadline
  incur 50% of room revenue for released room-nights; today is 30 days before arrival; pickup 12.
- **Steps:** sales manager reduces the block to 14; preview shows released room-nights, attrition fee, deposit effect;
  commit (or waive with permission and reason).
- **State:** grid current = 14, original unchanged; pickup unaffected.
- **Money:** attrition charge on the group folio keyed to the change; deposit schedule recalculated.
- **Inventory:** 6 × 4 room-nights released exactly once. **Audit:** grid before/after, reason.
- **Recovery:** a second identical submission does nothing. **Modules:** groups, inventory, rates, finance, payments.
  **Test:** `scenarios/s11-block-reduction-after-cutoff.test.ts`.

### S12 — A transfer delay affects check-in, dining and an activity booking
- **Pre:** couple on a 13:00 seaplane; sunset dive 17:30; dinner 19:30 overwater restaurant.
- **Steps:** coordinator records a 3-hour delay; itinerary flags: check-in window shifted (housekeeping priority
  adjusted), dive at risk (suggest tomorrow 08:30), dinner OK; one consolidated guest message drafted; guest relations
  confirms; dive rebooked without fee.
- **State:** transfer `delayed → arrived`; flags resolved with owners; itinerary updated.
- **Money:** activity charge moved, no fee; nothing duplicated. **Inventory:** none.
- **Audit:** transfer timeline, flags, decisions. **Recovery:** further delay re-evaluates flags.
- **Modules:** resort, reservations, operations, comms, finance. **Test:** `scenarios/s12-transfer-delay-cascade.test.ts`.

### S13 — A staff member loses connectivity while updating housekeeping
- **Pre:** attendant offline 25 minutes on a jetty; updates 6 units; meanwhile supervisor sets one of them back to dirty.
- **Steps:** reconnect; queue syncs.
- **State:** 5 updates applied; 1 sync conflict shown to attendant and supervisor with both values; lists were labelled
  *Delayed* while offline.
- **Money/Inventory:** none. **Audit:** client and server timestamps, device id.
- **Recovery:** supervisor resolves the conflict. **Modules:** operations. **Test:** `scenarios/s13-offline-housekeeping.test.ts`.

### S14 — Two users edit the same reservation
- **Pre:** Hassan changes the departure date; Aishath edits occupancy and adds a request on the same booking version.
- **Steps:** Hassan commits first; Aishath's save returns `409 version_conflict` with a field diff ("departure 12 → 13 Mar
  by Hassan, 14:02"); her edits are kept; she re-applies → new preview (repricing for the new date and occupancy) → commit.
- **State:** both changes present; no lost update. **Money:** projected balance reflects both.
- **Audit:** two versions with actors. **Modules:** reservations, rates. **Test:** `scenarios/s14-concurrent-reservation-edit.test.ts`.

### S15 — A profile is merged incorrectly and needs correction
- **Pre:** two *Ahmed Ali* profiles (different DOB and passport hash) merged by mistake; afterwards a stay and messages
  were added to the survivor.
- **Steps:** unmerge; review list proposes owners for post-merge items (stay → the profile whose passport matches);
  confirm.
- **State:** both profiles active; references in reservations, finance (payers) and comms restored exactly.
- **Audit:** merge and unmerge records with reasons. **Modules:** guests, reservations, finance, comms.
  **Test:** `scenarios/s15-profile-unmerge.test.ts`.

### S16 — A group administrator changes a policy that some properties have overridden
- **Pre:** Azure Isles Group (3 properties); org policy `reservations.checkIn.requiredCondition = clean`; property B has
  local override `inspected`; property C local override `clean` (redundant).
- **Steps:** director changes org value to `inspected`; preview: A will change; B unchanged (local override, already
  equal); C unchanged (local override); director applies a lock and marks C exempt with reason.
- **State:** resolved values and sources correct; override report shows C exempt.
- **Audit:** policy versions, lock, exemption reason. **Modules:** platform, identity.
  **Test:** `scenarios/s16-portfolio-policy-override.test.ts`.

### S17 — A user tries to access another hotel customer's records
- **Pre:** organizations A and B; user and API client of A.
- **Steps:** request B's booking/guest/folio ids directly; search for B's guest name; export; report; webhook replay;
  forged tenant context at DB level.
- **State:** 404 for all; zero rows under RLS; no existence leak. **Audit:** security log entries for denied attempts.
- **Modules:** all (platform, identity, db). **Test:** `scenarios/s17-cross-tenant-access.test.ts` (extends the existing
  foundation isolation test).

### S18 — Imported deposits disagree with the previous system's closing balance
- **Pre:** migration file with 40 future bookings carrying deposits totalling USD 48,200; source deposit ledger closing
  balance USD 48,950.
- **Steps:** trial import; reconciliation report shows USD 750 difference, itemized: one deposit in the source ledger not
  linked to a reservation; exception assigned to finance; resolved by linking it to a booking or recording an
  unallocated deposit liability; final run reconciles; sign-off.
- **State:** opening balances via migration suspense; zero unexplained difference or an explicitly signed-off one.
- **Money:** deposits ledger = source closing balance (or documented difference). **Inventory:** imported bookings
  consume inventory (conflicts listed if any).
- **Audit:** import job, reconciliation report, sign-off. **Modules:** integration (migration, wave 2), finance,
  reservations, inventory. **Test:** `scenarios/s18-migration-deposit-mismatch.test.ts`.

### S19 — A guest's bill combines packages, allowances, different taxes and partial payments
- **Pre:** Kandu, half-board package, USD 100/night dining allowance (forfeit), 2 adults + 1 child (8), 3 nights; service
  charge 10% and TGST 17% compounding; Green Tax USD 12 per person-night (Q41 default: no child exemption); deposit 30%
  by payment link; partial MVR cash; balance by card.
- **Steps:** Day Close posts nights (room allocation + meal components + allowance to clearing); outlet charges consume
  allowance partly and exceed it once; breakage posted nightly; check-out settles.
- **State:** folio balance zero; invoice tax summary per rule and rate.
- **Money:** `net + Σ taxes = gross` per line; breakage revenue = unused allowance; MVR cash converted at the business-date
  rate with rate stored; ledger and tax report reconcile to the minor unit.
- **Audit:** postings with rule-version ids. **Modules:** rates, finance, payments, resort, day-close.
  **Test:** `scenarios/s19-complex-bill.test.ts`.

### S20 — A channel or payment integration goes unavailable during a busy shift
- **Pre:** 18:00 arrivals peak; channel hub outage 45 min; payment provider degraded 20 min.
- **Steps:** banners state what is stale and since when; desk keeps selling and checking in (guarantee steps pending or
  recorded on external terminal); stop-sell protection closes the last 2 Water Villas on the degraded channel; ARI and
  automation queue; on recovery ARI resent, recovery pull ingests 2 OTA bookings made during the outage (one conflicts →
  relocation case), queued collections re-validated before running.
- **State:** nothing shown as synced/paid while failing; all queued work resolved.
- **Money:** no duplicate charges; external-terminal records matched later. **Inventory:** conflict recorded and resolved.
- **Audit:** health timeline, recovery actions. **Modules:** distribution, integration, payments, reservations, inventory.
  **Test:** `scenarios/s20-integration-outage.test.ts`.

---

## 2. Readiness evidence (operational-readiness brief §19)

| ID | Evidence item | Covered by | Additional requirement | Test |
|---|---|---|---|---|
| E01 | Concurrent attempts to sell the last room | S01 | 50 parallel commits, channels + desk mixed | `scenarios/s01-last-room.test.ts` |
| E02 | Delayed, duplicated and reordered channel updates | S02 | cancel-before-create parked then applied; stale older modification stored not applied; ARI acceptance out of order | `scenarios/e02-channel-reordering.test.ts` |
| E03 | Missing bookings recovered after an outage | S20 | "re-request since T" and nightly reconciliation pull ingest 3 missing bookings exactly once | `scenarios/e03-missed-booking-recovery.test.ts` |
| E04 | Expired credentials and revoked hotel permissions | — | channel and PMS credentials expire / hotel revokes access at vendor: urgent exception, affected workflows paused, re-authorize resumes without losing mappings; staff role revoked → immediate loss of access | `scenarios/e04-credential-revocation.test.ts` |
| E05 | Payment timeouts followed by a successful charge | S05 | — | `scenarios/s05-payment-timeout.test.ts` |
| E06 | Retried refunds and duplicate callbacks | S06 | duplicate and out-of-order webhooks for payments, refunds and disputes | `scenarios/e06-duplicate-webhooks.test.ts` |
| E07 | Interrupted night audit and recovery | S09 | crash at each step boundary (parameterized) | `scenarios/s09-day-close-interrupted.test.ts` |
| E08 | Tax or rate changes affecting future vs historical records | — | rate change after booking leaves agreed terms; TGST change (16% → 17% on 2025-07-01 replay) applies by service date with change report; past postings keep rule versions; reports restate nothing | `scenarios/e08-tax-rate-change.test.ts` |
| E09 | Cross-property access attempts | — | user scoped to property A of a group gets 404 for property B in API, search, reports, exports, AI | `scenarios/e09-cross-property-access.test.ts` |
| E10 | Stale offline updates | S13 | an update queued for 2 days (device left offline) is rejected or conflicted, never applied over newer state | `scenarios/e10-stale-offline-updates.test.ts` |
| E11 | Backup restoration | — | restore latest backup into an isolated database; run integrity checks (ledger, inventory, audit chain); measure RPO/RTO against targets; evidence recorded (infrastructure test, run on schedule) | `scenarios/e11-backup-restore.test.ts` (+ runbook) |
| E12 | Migration balance discrepancies | S18 | receivables and open folio balances as well as deposits | `scenarios/s18-migration-deposit-mismatch.test.ts` |
| E13 | Provider suspension | — | payment account suspended by provider; hub suspends a property; organization `suspended` by Monoclay: banners, safe alternatives, export still works, nothing auto-replayed | `scenarios/e13-provider-suspension.test.ts` |
| E14 | Cost-limit exhaustion | — | `usage.messages` and `usage.aiCredits` caps reached: only metered effects stop; reservations, payments, Day Close pass | `scenarios/e14-cost-limit-exhaustion.test.ts` |
| E15 | Staff error and recovery | S15 | wrong check-out reinstated before Day Close; wrong posting corrected by linked adjustment with restatement; wrong room move reversed; wrong no-show reinstated | `scenarios/e15-staff-error-recovery.test.ts` |

Representative volume runs (readiness §19 "a small demonstration is not evidence of enterprise capacity"):
`scenarios/load/peak-resort-day.test.ts` (400 units, 300 arrivals/departures, 2,000 postings, 3 channels) and
`scenarios/load/group-portfolio.test.ts` (3 properties, concurrent Day Close).

---

## 3. Adoption evidence (adoption-integration brief)

### A01 — Trial isolation
- **Pre:** trial organization created from a copy of Hiyani Guesthouse data; read-only connection to the PMS simulator.
- **Steps:** attempt every external effect (charge, guest message, channel publish, government submission, key issue,
  PMS write) from UI and API; reset, export and delete the trial.
- **State:** effects simulated or blocked with plain explanations; copied data labelled *Copied* with timestamp; the PMS
  simulator receives zero writes; reset re-copies; delete removes trial data (retention-aware).
- **Modules:** platform, integration, all effect adapters. **Test:** `scenarios/a01-trial-isolation.test.ts`.

### A02 — Read-only connection and comparison
- **Pre:** live organization; PMS simulator authoritative for reservations, availability, rates, guest profiles
  (`external/read_only`).
- **Steps:** mirror arrivals; try to modify a reservation and a rate in Portico; run the analytics comparison with the
  simulator's reports.
- **State:** writes rejected with `external_system_of_record` naming the PMS; mirrored data labelled *External* with last
  sync; discrepancy list (e.g. tax compounding differences) for investigation.
- **Modules:** platform, integration, reservations, rates, analytics. **Test:** `scenarios/a02-read-only-connection.test.ts`.

### A03 — Module-only adoption (housekeeping and messaging alongside a PMS)
- **Pre:** Connect plan with Housekeeping and Guest Communications packs; `roomStatus` authority Portico with push to PMS.
- **Steps:** departures from the PMS generate cleaning tasks; attendant updates push to the PMS; a PMS outage occurs;
  a PMS modification triggers automation re-evaluation.
- **State:** push failures become exceptions with business impact; lists labelled *Delayed* during outage; no message sent
  with stale details.
- **Modules:** operations, comms, integration, reservations (mirror). **Test:** `scenarios/a03-module-only-adoption.test.ts`.

### A04 — Data-authority switch at cutover
- **Pre:** reservations/availability external; migration rehearsed (wave 2).
- **Steps:** preview authority change (impact per module); final change capture; reconciliation; switch to Portico.
- **State:** no window where both systems control live inventory; reconciliation zero or signed-off; channels pointed at
  Portico only after switch. **Test:** `scenarios/a04-authority-switch.test.ts`.

### A05 — Setup journey and mapping suggestions
- **Pre:** PMS simulator with realistic codes.
- **Steps:** complete steps 1–5, abandon, resume as another admin, finish 6–9; measure suggestion acceptance.
- **State:** progress preserved; financially significant mappings cannot activate unreviewed; metrics recorded (INT-R14).
  **Test:** `scenarios/a05-setup-journey.test.ts`.

### A06 — No blind replay after reconnect
- **Pre:** charges forwarded to an external folio (`charges` external/forward); outage queues 5 commands incl. a payment
  posting already applied by the PMS before the outage.
- **Steps:** reconnect.
- **State:** commands re-validated; the already-applied one detected by read-back and not resent; inventory never reopened.
  **Test:** `scenarios/a06-no-blind-replay.test.ts`.

### A07 — Pilot scope
- **Pre:** Azure Isles Group; property Kandu in `pilot` with scope (front desk and housekeeping only, 6 named users).
- **Steps:** users outside scope or workflows outside scope attempt actions; activation of Kandu.
- **State:** out-of-scope actions refused with explanation; other properties unchanged; activation applies to Kandu only.
  **Test:** `scenarios/a07-pilot-scope.test.ts`.

---

## 4. Module participation matrix

| Module | Scenarios / evidence |
|---|---|
| platform | S16, S17, E09, E13, E14, A01, A02, A04, A07 |
| identity | S14, S16, S17, E04, E09, E15 |
| inventory | S01, S02, S03, S07, S08, S11, S18, S20, E01, E02 |
| rates | S01, S03, S04, S11, S14, S19, E08 |
| guests | S04, S15, S17, E09, E15 |
| reservations | S01–S05, S07, S08, S10, S12, S14, S15, S18, S20, E15 |
| finance | S02, S04, S05, S06, S09, S10, S11, S18, S19, E08, E12, E15 |
| payments | S02, S03, S05, S06, S10, S19, S20, E05, E06, E13, E14 |
| operations | S03, S07, S08, S12, S13, E10, A03 |
| integration | S02, S18, S20, E02–E04, E13, A01–A07 |
| day-close | S09, S19, E07 |
| distribution | S02, S20, E02, E03 |
| groups | S11 |
| comms | S08, S12, E14, A03 |
| resort | S10, S12, S19 |
| analytics | E08, E15, A02 |
| ai | E14, S17 |
| billing | E14 |
