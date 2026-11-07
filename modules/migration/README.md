# @portico/migration — "Move to Portico" (one-button migration, owner decision D13)

## Checkpoint

- **Done (increments 1 and 2 of `docs/strategy/modules/migration.md`, the guesthouse same-day path):** the pipeline
  (discover → extract → map → validate → rehearse → reconcile → sign-off → delta sync → freeze → cutover → verify →
  rollback window), file packs (CSV / XLSX, column auto-detection, card-number refusal, masked-value detection), SMB
  export adapters (layouts **unverified**), the PMS simulator as a source, the import ledger (exactly once), the
  reconciliation engine (the sign-off artefact), the seven human steps, the production gate, the cutover journal,
  rollback, the card re-collection list, the cross-organization trial rehearsal, the composition wiring and tests.
- **Known failing tests:** none. 93 module tests (48 domain, 45 integration on a real database) + 3 HTTP tests in
  `apps/api/test/migration.test.ts`.
- **Next:** increment 3 (OPERA concept map, File Export pack, OHIP extractor against public specs + simulator) — see
  "Next increment" below. Real providers for MIG-CR-1/3/4/5 (FOUNDATION_REQUESTS.md) to make the live path work end
  to end on this server.

## Purpose

The hotel presses **Move to Portico**, signs what only it can sign, and watches a plain-language page ("Found 3 unit
types, 6 units, 8 reservations (4 future, 1 in house, 3 history) … rehearsed twice with zero differences … waiting for:
Confirm the opening balances (Finance controller)"). Portico does the rest. Nothing is called migrated until it
reconciles against what the owning modules actually hold; every difference is an exception with an owner; the only
human steps are the seven that legally or technically must be human — never hidden, never faked.

## Why a new module (not part of integration)

Migration is a long-running orchestrator that **writes into every data-owning module** (inventory, guests,
reservations, finance, payments) and moves the system of record (platform). Integration is the connector framework
those owning modules plug into (inbound handlers, mappings, exchange); putting migration inside it would make
integration depend on reservations, finance and guests and invert the dependency graph (domain map: no cycles).
So `migration` is its own bounded context with schema `migration`, above the owning modules, and uses integration only
through ports (the PMS simulator today; file-exchange connections and the mapping engine requested, MIG-CR-6). It owns
job state, extracts, the import ledger, exceptions, reconciliation reports, sign-offs, authorizations, the checklist,
the cutover journal and the card re-collection list.

## How it works

| Step | What Portico does | Waits for a person when |
|---|---|---|
| discover | Reads the extract (or the simulator), counts per class, plain-language headline; source access observed | nothing has been uploaded / connected |
| extract | Every read is an append-only extract (metadata) + purgeable content; records are materialized with the current plan | — |
| map | Unit types (create from source or map by code/name), rate plans (suggestions only — never priced), status words, date order, tax accounts for tax declared on deposits (finance only, INT-R11) | a decision is below 0.9 confidence, unknown, ambiguous or financial |
| validate | M2 quality checks → exceptions with owners (blocking records wait; warnings are imported and listed) | — |
| rehearse | Rehearsal job: imports into its own trial / sandbox organization. Production job: runs the SAME importer in the linked trial organization (cross-organization bridge) | no trial organization is linked |
| reconcile | Report against read-backs from the owning modules (counts by status × arrival month, room nights per stay date vs inventory, revenue per stay date, per-booking totals and taxes, deposits / in-house / AR per item, per currency, per aging bucket, closing balances); unexplained differences → exceptions | any unexplained difference |
| signoff | Rehearsal: a second import must change nothing and reconcile to the identical fingerprint → certificate. Production: the checklist (except cutover time) and a production authorization by a second person | anything missing |
| delta sync | Declares the source the system of record (Portico read-only) and plans the switch back as a platform authority transition approved by a second person; reads changes (simulator) and re-rehearses them | the cutover time is not chosen |
| freeze | **Started by a person** who confirms the old system is frozen: final capture, mapping and quality re-checked, every gate evaluated; a refused gate changes nothing and is audited | always started by a person |
| cutover | Transition becomes effective, then everything is imported (Portico is the system of record) | — |
| verify | Reconciles after the switch; exact → Portico opens, the freeze is measured, the rollback window (48 h TARGET) starts | a difference remains |
| rollback window | Journals every business change after the switch; rollback (two people) moves the system of record back and hands over the journal as a worklist — nothing in Portico is erased | until the window closes (housekeeping job completes it) |

## Targets (brief §4) — what is measured here

| Target | Status (evidence) |
|---|---|
| Guesthouse moved the same day (CSV / SMB) | **Measured in tests only (no real hotel, no real source):** the whole guesthouse pack goes from upload to verified cutover in one test run of a few seconds (`test/scenario-guesthouse-same-day.test.ts`). Real-world elapsed time depends on the hotel's human steps — TARGET until a pilot |
| Freeze ≤ 15 min | Measured from the person's confirmation to the verified opening: **under 1 minute** for the guesthouse pack (asserted `< 1` and `≤ 15`, same test, step 5). TARGET for real sources |
| Zero duplicate reservations (creation, re-run, delta sync, sweep, retries, concurrent runners) | **Tested** — DB unique ledger key; `rehearsal.test.ts` (re-run creates 0), `concurrency-interruption.test.ts` (crash resume, 5 racing importers), `scenario-simulator-drill.test.ts` (delta + sweep) |
| Reconciliation exact or listed exclusions; 0 cutovers with open blocking exceptions | **Tested** — `reconcile.test.ts`, `scenario-s18-opening-balances.test.ts`, gate in `production-gate.test.ts` |
| 7 human steps with owners and reminders | **Tested** — `scenario-guesthouse-same-day.test.ts` steps 1, 3, 4; reminders in `jobs.ts` (`remindOverdue`) — reminder delivery to people needs comms (wave 2) |
| History statuses imported (cancelled / no-show / departed) | **Tested** against the fake reservations provider (`smb-export.test.ts`, `rehearsal.test.ts`); real reservations import is MIG-CR-1 |
| Rollback never erases post-cutover activity | **Tested** (drill and live) — journal worklist, counts unchanged |

## Capabilities vs spec (INT-R29–R34, acceptance criteria M0–M10)

| Spec | Capability | Status | Readiness |
|---|---|---|---|
| INT-R29 / M0 | Source assessment per source adapter (export route, fees "quote required", history limits, access restrictions, tokens non-portable, masking, evidence label) shown with the source; hotel sign-off of feasibility | assessment shown (`GET /migration/sources`); a separate feasibility sign-off record is **not built** (the data-authorization step carries the legal part) | R3 |
| INT-R30 | Pipeline: upload/connect → preview → mapping → quality → trial import → reconciliation → exceptions → re-run until accepted → staff acceptance → final capture → cutover | built and tested | R3 |
| INT-R31 | Never silently discard: every record in exactly one state (imported, merged, rejected, excluded, exception, suggested, pending) — MG-08 count query | built and tested | R3 |
| INT-R32 / S18 | Opening balances through migration suspense (finance on main for deposits, with tax already declared); in-house and AR through the requested finance contract; closing-balance agreement per currency; differences are exceptions, never plugged | deposits **real**; in-house and AR **against fakes** (MIG-CR-3/4) | R3 (deposits) / R2-fake (in-house, AR) |
| INT-R33 / M7–M9 | Cutover plan with authority switch per domain (platform transitions planned → approved → frozen → effective), freeze, final capture, rollback that accounts for post-cutover activity (journal + worklist) | built and tested; channel switch is a person's attestation (MIG-CR-7) | R3 |
| INT-R34 | Data export (exit) | **not in scope** of this increment | R1 |
| M1 | Preview per class (counts, detection review) before storage; mapping decisions open | built (`uploads/preview`) | R3 |
| M2 | Quality checks: required fields, dates, inverted dates, unmapped unit types, overlapping unit assignments, overbooked nights (warning + inventory conflict), currency, deposit without booking, prepaid without deposit, folio not balancing, duplicate channel bookings, profile duplicates (flagged, never merged), invalid contacts, masked data | built and tested | R3 |
| M3 | Rehearsals in a trial organization (copied provenance, trial banner), re-runnable, versioned reports | built and tested | R3 |
| M4 | Reconciliation thresholds (exact) | built and tested (block grids: no groups module yet) | R3 |
| M5 | Exception list with owners, due dates, financial ones closed only by finance, "accepted as loss" only by the decision-maker | built and tested | R3 |
| M6 | Final change capture; post-capture sweep imports late records once; changes after the switch are exceptions | built and tested (simulator); file sources re-upload | R3 |
| M10 | Historical archive | **not built** (history statuses are imported as bookings; an archive for older history is increment 3+) | R1 |
| MG-01…08 | Acceptance tests | MG-01, 02, 03, 05, 06, 07, 08 tested; MG-04 (source prices kept after a rate change) is a reservations-provider rule (MIG-CR-1 rule 2) asserted on the fake | — |

Sources: Portico template pack (verified against its own templates), **Little Hotelier, Cloudbeds, eZee layouts —
unverified** (no real sample, D8), PMS simulator (simulated, refused in live). XLSX reader is dependency-free (ZIP64
and encrypted workbooks refused).

## Invariants and the tests that prove them

| Invariant (over stored state) | Enforced by | Test |
|---|---|---|
| MIG-I1 At most one Portico record per (property, source, class, source key) — zero duplicate reservations | unique key on `import_ledger`; claim (insert-or-wait + row lock) in the record's transaction; job row lock; provider unique key (MIG-CR-1 rule 1) | `rehearsal.test.ts` "running again…"; `concurrency-interruption.test.ts` "crash…", "five importers racing…"; `scenario-simulator-drill.test.ts` MG-06 |
| MIG-I2 Every source record is in exactly one state | ledger state per record, `reconcile` accounting | `rehearsal.test.ts` "every source record ends in exactly one state" |
| MIG-I3 Nothing is "migrated" until the report against read-backs is exact | `reconcile` (read-back from inventory, guests, finance, reservations; unavailable provider = not reconciled) | `reconcile.test.ts`; `scenario-s18-opening-balances.test.ts` |
| MIG-I4 Opening balances posted once; a later change is an exception | ledger hash check in `importMoney`; finance idempotency by import ref | `scenario-s18…` "changes in the source after it was posted" |
| MIG-I5 No double tax: tax declared by the previous system is carried as declared | `declaredTaxes` to finance; terms taxes verbatim (MIG-CR-1 rule 2) | `scenario-s18…` "no double tax" (TGST payable untouched, deposit declared map) |
| MIG-I6 No double inventory | provider consumes by ref (real inventory, idempotent per ref and night) | `rehearsal.test.ts` "inventory once"; drill (cancel releases, extension re-consumes) |
| MIG-I7 No card number is stored | scan of every cell before storage; refusal audited with positions only | `safety-isolation.test.ts` MG-02; `apps/api/test/migration.test.ts` |
| MIG-I8 Masked data never imported as truth | masked names block the record; > 20 % masked refuses the export | `pack.test.ts`; `safety-isolation.test.ts` "masked export" |
| MIG-I9 Rehearsals never in live; production only in live, after every gate | purpose from environment; gate (certificate, plan fingerprint, checklist, authorization by another person, approved transition, open blocking exceptions, final capture, activation scope) | `production-gate.test.ts`; `reconcile.test.ts` gate |
| MIG-I10 A refused cutover changes nothing | the gate runs before any platform freeze or import | `production-gate.test.ts` test 1 |
| MIG-I11 Rollback erases nothing; post-cutover activity is journaled (the migration's own run is not) | journal consumer (idempotent per event, excludes the run's correlation ids); rollback moves authority only | same-day test 7; drill rollback |
| MIG-I12 Personal data of the source is purged after the retention period | `purgeSourceData` (housekeeping), payload table separate from append-only metadata | `safety-isolation.test.ts` "purged" (PII scan) |
| MIG-I13 Resumable: a crash loses at most one chunk; the lease is released or expires | per-step persisted status, chunked transactions, lease | `concurrency-interruption.test.ts` |

## Scenarios covered

| File | Demonstrates |
|---|---|
| `test/scenario-guesthouse-same-day.test.ts` | The production path end to end in a LIVE organization with its linked TRIAL organization: seven steps, finance-only tax mapping, trial rehearsal (copied provenance), checks that cannot be faked, second-person authorization and approval, cutover with measured freeze, card requests, rollback keeping post-cutover activity |
| `test/scenario-simulator-drill.test.ts` | Same-day migration from the PMS simulator in a SANDBOX organization: rehearsal, delta sync while the source changes, final capture, MG-06 sweep, change-after-switch exception, last-unit race, rollback drill |
| `test/scenario-s18-opening-balances.test.ts` | S18 extended: 1-minor-unit difference, no double tax, in-house and AR per item / aging bucket, orphan deposit decisions, changed deposit |
| `test/rehearsal.test.ts` | Increment-1 acceptance: guesthouse pack into a trial, exact twice, zero duplicates, MG-08 |
| `test/smb-export.test.ts` | Little Hotelier layout (unverified), derived guests and unit types, all statuses, XLSX workbook |
| `test/concurrency-interruption.test.ts`, `test/production-gate.test.ts`, `test/safety-isolation.test.ts` | Crash resume, lease, racing importers, MG-01; production gate and environment safety; card refusal, masking, isolation, permissions, PII-free events, retention purge |

## Permissions (all property-scoped)

`migration.job.read`; `migration.job.manage` ⚑ (start, upload, run); `migration.mapping.review`;
`migration.exception.manage`; `migration.finance.signoff` ⚑ (tax mappings, financial exceptions, card plan, opening
balances); `migration.checklist.complete` ⚑; `migration.staff.accept`; `migration.cutover.execute` ⚑ (plan, start,
rollback request); `migration.production.authorize` ⚑ (production authorization, cutover / rollback approval,
accept as loss). Suggested role templates: `MIGRATION_ROLE_TEMPLATES` (FR-MIG-2). Platform's own rules still apply:
the planner of an authority transition cannot approve it.

## Events

Emitted (ids and statuses only — tested): `migration.job.created|completed`, `migration.extract.taken`,
`migration.step.succeeded|waiting|failed`, `migration.reconciliation.completed`, `migration.rehearsal.certified`,
`migration.checklist.completed|reminderDue`, `migration.production.authorized`,
`migration.cutover.planned|frozen|switched|verified|rolledBack`, `migration.rollback.requested`,
`migration.exception.resolved`. Consumed: `reservations.*`, `finance.*`, `payments.*`, `guests.profile.*`,
`inventory.unit.*`, `inventory.assignment.*`, `operations.unit.*`, `operations.workOrder.*` → cutover journal.

## Ports and binding status (composition)

| Port | Binding |
|---|---|
| platform (property, data authority, authority transitions, activation scope, trial link, trial import record) | **real** (`declareExternalAuthority` runs as the migration process — restricting only; moving back needs the second-person transition) |
| inventory (unit types, units, availability read-back) | **real** |
| rates (rate plans for suggestions) | **real** |
| guests (import profile, existence read-back) | **real** via `resolveProfile` (MIG-CR-2 for a keyed provider) |
| finance (opening deposits, deposit balances, tax accounts) | **real**; in-house and AR **unavailable** (MIG-CR-3/4) |
| reservations (import, read-back) | **unavailable** (MIG-CR-1) — the live pipeline waits at the reservations import with a blocking exception (HTTP test) |
| payments (card re-collection) | **unavailable** (MIG-CR-5) |
| integration PMS simulator | **real** (refused in live) |
| rehearsal (cross-organization) | **real** (`createRehearsalBridge`: trial must belong to the live organization; runs as the system inside the trial, environment `trial`) |
| guests ← migration (personal-data contributor) | bound: a guest's data export includes what a migration still holds |

## Adoption modes and data authority

Migration is the **full migration** adoption path (and "replace selected capabilities" by choosing the scope). Domains
moved: reservations, availability, rates, guestProfiles, charges, payments, accounting, roomStatus. Before the
cutover the source is declared the system of record (Portico read-only — staff cannot diverge from the source); at the
cutover a platform authority transition (approved by a second person) makes Portico authoritative; rollback moves it
back. A cancelled migration leaves the source as the system of record (true: the hotel keeps using it).

## Contract changes

None to existing provider contracts. New consumer requests: FOUNDATION_REQUESTS.md MIG-CR-1…7, FR-MIG-1…3.

## Known gaps

- **Real reservations / in-house / AR / card providers do not exist yet** (MIG-CR-1/3/4/5): the live path is proven
  against strict fakes; on this server a real migration waits at the reservations import (honestly).
- **Per-subject erasure inside a running migration** needs an erase hook on guests' personal-data contributors
  (MIG-CR-2); meanwhile source data is purged 30 days after the migration ends.
- **A second source adapter for the same bookings** (e.g. the template pack, later the PMS export) is a different
  ledger namespace; cross-namespace duplicate detection (channel id, guest + dates) is the next increment. One open
  migration per property is enforced.
- Units are not derived when the source has no room list (SMB exports): stays show inventory conflicts until units are
  added (flagged, never hidden).
- Groups / blocks, packages, routing, AR history, the historical archive (M10), data export (INT-R34), feasibility
  sign-off record (M0), the channel switch hook, reminder delivery (comms) — not built.
- Delta sync for file sources is "re-upload"; there is no scheduled automatic re-read of the simulator (the run reads
  it at each pass).
- The mapping suggestion engine is migration's own small one (MIG-CR-6 asks to reuse integration's).

## Open questions for the owner

- Retention of migration source data: **default 30 days after the migration ends**, then purged (keys, hashes and
  reports kept). Related to Q63.
- Operator co-sign for production migrations (FR-MIG-3): default — the hotel's second authorized person plus the
  platform activation scope; no Monoclay co-sign record yet.
- Defaults in force: Q142 re-collect cards; Q144 no database extraction (no such adapter exists); Q140/Q141 no Oracle
  contact (no OPERA adapter in this increment); Q143 migration included (nothing priced or published).

## Next increment (3 — OPERA)

OPERA concept map (profile types, statuses by type, reservation types deduct / non-deduct, rate codes, packages,
routing → billing rules, transaction codes / generates → charge codes / tax rules, AR, deposits — DD11 §8) with
confidence and reasons and finance review; the **File Export pack** path for OPERA 5 (hotel-run exports over
SFTP/HTTPS; masked-value detection already here); an **OHIP extractor against the public OpenAPI specs plus an
OPERA-like simulator** (throttled 10–20 rps, 429 back-off, size-aware paging, completeness counts — R3, no partner
access until Q140); the DB-extract route kept disabled without a rights upload (Q144); blocks and AR history.
