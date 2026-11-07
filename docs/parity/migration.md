# Parity matrix and edge cases: migration ("Move to Portico")

Module: `migration` (one-button migration pipeline, source adapters, import ledger, reconciliation, seven human steps,
production gate, cutover journal, rollback). Spec: `docs/specs/integration.md` INT-R29–R34,
`docs/adoption/migration-acceptance-criteria.md` (M0–M10, MG-01…08), `docs/readiness/migration-onboarding-checklist.md`;
10x brief `docs/strategy/modules/migration.md`. Research: `docs/research/05-market-deep-dive/11-one-button-migration.md`
(DD11) and `docs/research/05-digest.md` §3 (DG). Written 2026-11-07 by the migration module owner against
`feat/migration` (increments 1–2).

**Status and tests:** paths are relative to `modules/migration/` unless they start with `apps/`. A row is `tested` only
when a test asserts it; the Test cell quotes `file:line (what it proves)`. Rows proven only against a strict fake of a
requested provider contract (reservations MIG-CR-1, finance in-house/AR MIG-CR-3/4, payments MIG-CR-5) say so — they
are `building` until the real provider exists, except where the asserted behavior is migration's own (ledger, gate,
reconciliation), which is `tested`. Readiness: everything here is at most **R3**; vendor layouts are **unverified** (no
real export sample, D8); the simulator is simulated. **Market evidence** cites DD11/DG, which carry the source links and
evidence labels ([V] verified documentation, [S] secondary, [3P] third party, [VC] vendor claim).

## Capabilities

### 1. Market approaches (what hotels get today)

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-MIG-001 | One action starts a migration that the vendor runs end to end; only legally/technically human steps remain, as a checklist with owners | No vendor sells it (DD11 §1 [V/S]; Oracle OCM is an Oracle-run DB copy, Mews semi-automated, Cloudbeds paid service) · verified 2026-11-07 | P0 | tested | brief §4; DD11 §6–7 | test/scenario-guesthouse-same-day.test.ts:54 (seven steps from the start, owners, due); :88 (pipeline runs itself to the human gates); :185 (steps complete, switch approved) |
| PAR-MIG-002 | Spreadsheet / CSV dataloader with templates | Stayntouch CSV dataloader (DD11 §3.7 [S]); Mews templates (DD07 §1 [VC]) · verified 2026-11-07 | P0 | tested | INT-R30; M1 | src/domain/pack.test.ts:32 (template pack → one record per row); test/smb-export.test.ts:97 (same pack as one Excel workbook); apps/api/test/migration.test.ts:65 (templates served) |
| PAR-MIG-003 | Column auto-detection with a preview before anything is stored | assumption (Stayntouch "test files one week before", DD11 §4 [S]) | P0 | tested | M1 | src/domain/files.test.ts:142 (vendor headers mapped); test/smb-export.test.ts:19 (preview stores nothing, then upload) |
| PAR-MIG-004 | Imports every status including cancelled, no-show and checked-out history | Cloudbeds does NOT import cancelled/no-show (DG #22 [S]); OXI resync includes them (DD11 §3.1 [V]) · verified 2026-11-07 | P0 | building | M1; brief §4 | test/smb-export.test.ts:19 (all six statuses imported) — partial: against the reservations fake (MIG-CR-1) |
| PAR-MIG-005 | Agreed prices and taxes kept as the source states them (no re-pricing, no double tax) | assumption (CLAUDE.md §5); HRS code mapping is manual (DD02c §7 [VC]) | P0 | building | M4; MIG-CR-1 rule 2 | src/domain/pack.test.ts:48 (amounts and taxes verbatim); test/scenario-s18-opening-balances.test.ts:108 (deposit tax carried as declared, TGST payable untouched) — partial: booking terms on the fake |
| PAR-MIG-006 | Rehearsal in an isolated copy, re-runnable, with timings and versioned reports | Mews: semi-automated + manual validation (DD07 §1 [VC]); Oracle "test migration" (DD11 §4 [V]) · verified 2026-11-07 | P0 | tested | M3 | test/scenario-guesthouse-same-day.test.ts:88 (trial organization, copied provenance, trial banner); test/rehearsal.test.ts:81 (two exact reports, same fingerprint) |
| PAR-MIG-007 | Reconciliation report as the sign-off artefact (counts by status × arrival month, room nights and revenue per stay date, deposits, in-house, AR by aging) | No vendor publishes migration correctness metrics (DD11 §4 [S]) · verified 2026-11-07 | P0 | tested | M4; DD11 §7.3 | src/domain/reconcile.test.ts:117 (exact); :164 (per-booking, per-date measures); test/scenario-s18-opening-balances.test.ts:131 (in-house, AR per aging bucket) |
| PAR-MIG-008 | Opening balances through suspense against the source's closing balances; differences never plugged | Finance S18 groundwork; assumption for competitors | P0 | tested | INT-R32; S18 | test/scenario-s18-opening-balances.test.ts:62 (1 minor unit → not reconciled, finance exception); src/domain/reconcile.test.ts:133 |
| PAR-MIG-009 | Profile duplicate detection before import; never merged automatically | Mews warns against importing old profiles (DD02b §1.2 [VC]); dirty profiles migrate intact (DD11 F2 [3P]) | P0 | tested | M2; MG-05 | test/rehearsal.test.ts:140 (flagged in the source and by guests' scoring; two profiles kept) |
| PAR-MIG-010 | Continuous delta sync until the cutover; short freeze | Oracle: "potential for significant downtime" (DD11 §4 [V]); OXI business events (DD11 §3.1 [V]) | P0 | tested | INT-R33; M6 | test/scenario-simulator-drill.test.ts:109 (changes captured while the source keeps changing); test/scenario-guesthouse-same-day.test.ts:241 (freeze measured < 1 min, target ≤ 15) |
| PAR-MIG-011 | Rollback that keeps post-cutover activity (journal + worklist), not a backup restore | assumption (acceptance criteria §9.3); FIDI reverted after 2 months (DG #24 [S]) | P0 | tested | INT-R33; MG-07 | test/scenario-guesthouse-same-day.test.ts:283 (journal worklist, nothing erased); test/scenario-simulator-drill.test.ts:268 (drill) |
| PAR-MIG-012 | Card guarantees: re-collection list and requests (cards never through files) | Stripe PSP-to-PSP only (DD11 §6.3 [S]); RoomRaccoon lost payment details (R03 [3P]) | P0 | building | Q142; MIG-CR-5 | test/rehearsal.test.ts:189 (list); test/scenario-guesthouse-same-day.test.ts:276 (requests, idempotent) — partial: payments provider is a fake |
| PAR-MIG-013 | SMB PMS export importers (Little Hotelier, Cloudbeds, eZee) | DD11 §3.5–3.8 [S/3P] · verified 2026-11-07 | P1 | building | DD11 §7.2 | test/smb-export.test.ts:19 (Little Hotelier assumed layout) — partial: every vendor layout is unverified until a real sample exists |
| PAR-MIG-014 | PMS simulator as a source (demonstrations, drills) | assumption | P1 | tested | INT-R05 | test/scenario-simulator-drill.test.ts:81 (rehearses and certifies from the simulator) |
| PAR-MIG-015 | OPERA concept map and OPERA 5 File Export pack / OHIP extractor | HRS DMT (DD02c §7 [VC]); OHIP limits (DD11 §3.2 [V]) | P1 | specified | brief increment 3 | — next increment |
| PAR-MIG-016 | Physical database copy (OPERA → OPERA Cloud) | Oracle OCM (DD11 §3.1 [V]) | P2 | different | DD11 §3.1; Q144 | — Portico never reads a vendor database without written rights; it migrates through exports/APIs with reconciliation |
| PAR-MIG-017 | Group blocks, packages, routing, AR history and a historical archive | DD11 §8 | P1 | specified | M1, M10 | — not in increments 1–2 |
| PAR-MIG-018 | Data export (exit) | INT-R34 | P1 | specified | INT-R34 | — |

### 2. Trust, safety and the gate

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-MIG-019 | Production migration only with a recorded authorization by a second authorized person, the approved activation scope and every gate | assumption (CLAUDE.md §1; separation of duties) | P0 | tested | brief task §6 | test/production-gate.test.ts:21 (no authorization → nothing changes, audited); :63 (pilot scope without migration refused); test/scenario-guesthouse-same-day.test.ts:134 (creator cannot authorize) |
| PAR-MIG-020 | Rehearsals only in trial / sandbox organizations; the live organization imports nothing before the cutover | assumption (ADR-0010) | P0 | tested | rule 12 | test/production-gate.test.ts:165 (live job waits for a trial link; 0 bookings in live); :200 (bridge refuses a foreign trial) |
| PAR-MIG-021 | Source system of record until the cutover; switch through a two-person authority transition | ADR-0014 | P0 | tested | INT-R33 | test/scenario-guesthouse-same-day.test.ts:185 (external read-only; planner cannot approve); :241 (Portico authoritative after the switch) |
| PAR-MIG-022 | Masked personal data detected, never imported as truth | OPERA exports masked over insecure delivery (DD11 §3.1 [V]); Little Hotelier masks after 180 days (DD11 §3.6 [3P]) | P0 | tested | DD11 F4 | test/safety-isolation.test.ts:74 (masked export flagged, nothing imported); src/domain/files.test.ts:124 |
| PAR-MIG-023 | A file containing a card number is refused before storage | PCI; DD11 §6.3 | P0 | tested | MG-02 | test/safety-isolation.test.ts:33 (nothing stored, positions only); apps/api/test/migration.test.ts:232 (problem+json) |
| PAR-MIG-024 | Personal data of the source purged after the migration ends; included in a guest's data export meanwhile | assumption (Q63 retention) | P1 | tested | readiness §12 | test/safety-isolation.test.ts:207 (export includes it; purge leaves no names) |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-MIG-001 | The same files are uploaded again (or a second rehearsal runs) | No record changes; identical report fingerprint (MG-01) | P0 | tested | test/concurrency-interruption.test.ts:155 |
| EC-MIG-002 | The process crashes in the middle of the reservations import | The chunk rolls back; the step shows failed with the reason; `run` resumes; each record imported once | P0 | tested | test/concurrency-interruption.test.ts:59 |
| EC-MIG-003 | A process dies holding the run lease | A resume is refused while the lease is valid ("already running"), then continues after it expires | P1 | tested | test/concurrency-interruption.test.ts:87 |
| EC-MIG-004 | Two people press "Move to Portico" at once | One runs, the other is told it is already running; one copy of everything | P0 | tested | test/concurrency-interruption.test.ts:114 |
| EC-MIG-005 | Delta sync, sweep and retries import concurrently | Zero duplicate bookings, deposits posted once, inventory consumed once | P0 | tested | test/concurrency-interruption.test.ts:130 |
| EC-MIG-006 | Bookings are created, modified and cancelled in the old system during delta sync | Captured and staged (Portico read-only); applied at the cutover; a cancellation releases inventory | P0 | tested | test/scenario-simulator-drill.test.ts:109, :142 |
| EC-MIG-007 | A booking is created in the old system after the final capture | Imported exactly once by the post-capture sweep (MG-06) | P0 | tested | test/scenario-simulator-drill.test.ts:176 |
| EC-MIG-008 | A booking is changed in the old system after the switch | Not applied over Portico; exception "changed after the final capture" | P0 | tested | test/scenario-simulator-drill.test.ts:192 |
| EC-MIG-009 | A late source booking races a Portico booking for the last unit | Never oversold silently: either Portico's sale is refused or the late booking is imported with a recorded inventory conflict and an exception | P0 | tested | test/scenario-simulator-drill.test.ts:213 |
| EC-MIG-010 | Deposits differ from the reported closing balance by 1 minor unit | Not reconciled; finance exception (migration's and finance's own); never plugged | P0 | tested | test/scenario-s18-opening-balances.test.ts:62 |
| EC-MIG-011 | A deposit for a booking that is not in the export | Held back as a blocking financial exception; only finance excludes it; a loss needs the decision-maker; cannot be "imported as is" | P0 | tested | test/scenario-s18-opening-balances.test.ts:206 |
| EC-MIG-012 | A deposit changes in the source after it was posted as an opening balance | Exception; never posted a second time | P0 | tested | test/scenario-s18-opening-balances.test.ts:269 |
| EC-MIG-013 | Ambiguous day/month dates (03/04/2027) | Never guessed: a mapping decision is required; a column with any day > 12 decides itself | P0 | tested | src/domain/normalize.test.ts:22, :31 |
| EC-MIG-014 | Amounts with an ambiguous separator or more decimals than the currency | Refused per record with the reason; never rounded | P0 | tested | src/domain/normalize.test.ts:62, :72; src/domain/pack.test.ts:93 |
| EC-MIG-015 | Grand total ≠ room total + taxes; nightly prices not covering the stay | Blocking problem on the record | P0 | tested | src/domain/pack.test.ts:93 |
| EC-MIG-016 | The same channel booking id on two reservations (FIDI) | Both blocked until a person decides; never two bookings | P0 | tested | src/domain/pack.test.ts:328 |
| EC-MIG-017 | One unit assigned to two overlapping stays; more stays than units | Blocking for the reservations manager; overbooking imported as a visible inventory conflict | P0 | tested | src/domain/pack.test.ts:328 |
| EC-MIG-018 | A "confirmed" stay already over; an "in house" stay not covering today | Blocking with the dates explained | P0 | tested | src/domain/pack.test.ts:371 |
| EC-MIG-019 | Booking marked prepaid but no deposit listed | Blocking FINANCIAL exception (finance owns and closes it); finance may decide "import as is"; then imported once | P1 | tested | src/domain/pack.test.ts:371; test/scenario-s18-opening-balances.test.ts:295 (decision by finance → imported once) |
| EC-MIG-020 | Folio charges − payments ≠ balance | Blocking for finance | P0 | tested | src/domain/pack.test.ts:250 |
| EC-MIG-021 | Masked names / emails in the export | Record blocked (names) or contact dropped with a warning; > 20 % masked flags the export | P0 | tested | src/domain/pack.test.ts:233; test/safety-isolation.test.ts:74 |
| EC-MIG-022 | A card number in any cell of any file | Whole upload refused; nothing stored; refusal audited with row/column only | P0 | tested | test/safety-isolation.test.ts:33; src/domain/files.test.ts:110 |
| EC-MIG-023 | Unknown status word in the export | Mapping decision required; the record waits | P0 | tested | src/domain/pack.test.ts:93; src/domain/normalize.test.ts:82 |
| EC-MIG-024 | Tax declared on deposits needs an account mapping | Only finance may decide it (INT-R11) | P0 | tested | test/rehearsal.test.ts:49 |
| EC-MIG-025 | The plan changes after the rehearsal or after the authorization | Gate refuses: rehearse / authorize again | P0 | tested | src/domain/reconcile.test.ts:316 |
| EC-MIG-026 | The person who started the migration tries to authorize it; the planner tries to approve the switch | Refused (two people) | P0 | tested | test/scenario-guesthouse-same-day.test.ts:134, :185 |
| EC-MIG-027 | A record imported earlier is no longer in the source | Reconciliation difference ("deleted there?") — never silently kept as truth | P1 | tested | src/domain/reconcile.test.ts:200 |
| EC-MIG-028 | An owning module cannot read back (provider not on this server) | Not reconciled; the pipeline waits with a blocking exception owned by Monoclay | P0 | tested | src/domain/reconcile.test.ts:185; apps/api/test/migration.test.ts:81 |
| EC-MIG-029 | The simulator chosen as a source in a live organization | Refused | P0 | tested | test/production-gate.test.ts:151 |
| EC-MIG-030 | The SMB export has no room list | Unit types derived (warning); stays shown as inventory conflicts until units exist | P1 | tested | test/smb-export.test.ts:19 |
| EC-MIG-031 | Events raised by the migration's own cutover run | Not journaled as post-cutover activity | P1 | tested | test/scenario-guesthouse-same-day.test.ts:283 |
| EC-MIG-032 | The same bookings arrive through a second, different source adapter | Not yet detected across sources (different ledger namespace) | P1 | specified | — README Known gaps |
| EC-MIG-034 | A migration with a planned switch is cancelled | The open authority transition is cancelled; the old system stays the system of record; the job is closed | P1 | tested | test/production-gate.test.ts:224 |
| EC-MIG-033 | A guest asks for erasure while a migration still holds their source rows | Purged 30 days after the migration ends; immediate per-subject erasure needs guests' erase hook (MIG-CR-2) | P1 | specified | — README Known gaps |
