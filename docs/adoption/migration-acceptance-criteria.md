# Migration acceptance criteria

> Deliverable 7 (adoption brief §10; product brief §16, scenario 18; operational-readiness brief §18).
> Status date: 2026-11-07. Import jobs belong to the `integration` module (domain map). The onboarding
> checklist in `docs/readiness/` (readiness agent) references these criteria; it does not repeat them.
> All numeric thresholds are **targets** until validated in rehearsals with real hotel data.

## 1. Principles

1. **Guided, repeatable, inspectable, recoverable.** Every import is a job that can be re-run from the same
   source files and produces the same result and the same reconciliation report.
2. **Never silently discard.** Every source record ends in exactly one state: `imported`, `merged` (with link),
   `rejected` (with reason), `excluded by decision` (with who and why), or `exception` (with owner).
3. **Never convert ambiguous financial information.** Unclear balances, tax treatments or payment states are
   exceptions for a finance person, not guesses.
4. **Agreed terms come from the source.** Imported stays keep the source's agreed nightly prices, taxes and
   policies as their terms snapshot; Portico does not re-price them (CLAUDE.md §5).
5. **Rollback is planned before cutover**, and accounts for everything done after cutover.

## 2. Phase M0 — Source export feasibility (before committing)

Output: a **feasibility report** signed by the hotel's project owner, with a go/no-go and a loss list.

| Area | Questions answered | Evidence |
|---|---|---|
| Legal right | Does the hotel's contract with the current vendor allow export and use by a new provider? Data ownership clause? Termination assistance? Notice periods? | Contract clauses (hotel provides); professional review where unclear |
| Technical route | API, report exports, database extract, vendor-provided export service, or manual re-entry? Formats? Completeness? | Sample export inspected |
| Vendor fees and restrictions | Fees for exports, API access, extra licences, or professional services | Vendor quote ("quote required" until received; never assumed zero) |
| History limits | How far back reservations, folios, invoices and audit records can be exported | Sample export |
| Payment tokens | Stored cards are held by the current PSP/payment facilitator. Can they be migrated PSP-to-PSP? Usually requires both PSPs' cooperation and the card schemes' rules | Written statement from the PSP; otherwise **non-portable**: guests re-enter cards (plan in §9.3) |
| Documents | Invoices, credit notes, registration cards, signed documents: portable as files? | Sample |
| Personal data | Lawful basis and processing terms for the transfer; minimization | Processing terms (readiness agent's contract register) |
| Fiscal records | Must the source system be kept for statutory record retention? | Market matrix (`docs/readiness/market-matrix.md`) |
| Timing | Best cutover window (low arrivals, after the source's end of day) | Occupancy forecast |

## 3. Phase M1 — Preview and mapping

| Data class | Migration treatment | Notes |
|---|---|---|
| Property structure, unit types, units, features | Imported | Mapped once; reused by connections |
| Rate plans, restrictions, packages | Active plans imported or re-created; retired plans excluded by decision | Derived-rate logic re-created and previewed |
| Tax and fee rules | **Re-created as dated configuration** with source citation (CLAUDE.md rule 13), not imported as numbers | Finance sign-off |
| Charge codes / transaction codes | Mapped (financially significant) | |
| Guest profiles, companies, agencies | Imported with duplicate detection (§4) | Consent flags preserved; no consent invented |
| Future bookings and stays | Imported with source identifiers, channel booking ids and agreed terms | Assigned units imported where known |
| Group blocks and allotments | Imported with original and current grids, release dates and pickup | |
| Deposits held | Imported as liabilities per booking with source payment reference | |
| In-house open folios | Imported as opening balance lines per folio with source references | Detail available in the archive |
| Receivables (city ledger) | Open items per account with invoice references and aging dates | |
| Stay history | Last N years imported as history (N agreed per hotel), older in the archive | |
| OTA mappings | Re-created in the channel hub, validated before switch | |
| Users | Not imported; invited | |
| Stored cards / tokens | Not imported unless §2 proves portability | |
| Audit records of the source | Archived, not imported | |

The preview shows, per class: counts in source, counts to import, sample records side by side, and every
mapping decision still open.

## 4. Phase M2 — Quality checks and duplicate detection

| Check | Severity | Rule |
|---|---|---|
| Required fields (dates, unit type, guest name) | Blocking | Record cannot import; exception |
| Dates in the past for "future" stays; departure ≤ arrival | Blocking | Exception |
| Unit type unmapped | Blocking | Mapping decision |
| Overlapping assignments of one unit | Blocking | Exception for reservations manager |
| Overbooked nights in source | Warning | Imported as **authorized overbooking** only with a named authorizer; otherwise inventory conflict exception |
| Currency missing or inconsistent | Blocking for money | Exception |
| Deposit without a booking, or booking marked prepaid without a payment record | Blocking for money | Exception for finance |
| Folio not balancing (charges − payments ≠ balance) | Blocking for money | Exception |
| Profile duplicates | Warning | Pairs flagged with match reasons; **never merged automatically** during migration; merge decisions recorded and reversible (glossary: reversible merges) |
| Booking duplicates (same channel booking id) | Blocking | Exception |
| Invalid contact data | Warning | Imported, flagged; messaging automations skip it |

## 5. Phase M3 — Trial imports (rehearsals)

- Run in a **trial organization** (never the live one), with the same import job definition planned for cutover.
- Minimum rehearsals (target): RS-1 one full rehearsal; RS-2 two (one full, one including a simulated final
  change capture and timed cutover).
- Each rehearsal produces: a reconciliation report (§6), an exception list (§7), timings per phase, and staff
  spot-check results (front office checks 20 random arrivals; finance checks 20 folios/deposits).
- A rehearsal can be reset and re-run; results are versioned for comparison between rehearsals.

## 6. Phase M4 — Reconciliation and numeric acceptance thresholds (targets)

| Area | Measure | Acceptance threshold (target) |
|---|---|---|
| Future reservations | Source count vs imported + exceptions + excluded-by-decision | **100% accounted for; 0 unexplained** |
| Inventory | Rooms sold per unit type per night, next 365 days | **Exact match**, or each difference traced to a listed exception |
| Agreed prices | Per-night price and stay total on imported stays vs source | **100% match** on all stays (automated) plus 50 random stays checked by a person |
| Taxes on imported stays | Source tax amounts preserved; differences vs Portico's current rules counted | Source amounts **100% preserved**; differences reported, not changed |
| Deposits | Total held per currency; per booking | **Equal to the minor unit** in total and for **100%** of bookings |
| Open folios (in-house) | Balance per folio | **Equal to the minor unit for 100%** of folios |
| Receivables | Balance per account and per aging bucket | **Equal to the minor unit for 100%** of accounts |
| Group blocks | Rooms per night (original and current), pickup, release dates | **Exact match** |
| Guest profiles | Imported or merged-with-link | **≥ 99.5%**, remainder rejected with reasons; **0 silently dropped** |
| Exceptions | Open exceptions at go/no-go | **0 blocking**; non-blocking ≤ 0.5% of records, each with owner and due date |
| Closing balance agreement | Source closing balances report vs Portico opening balances (scenario 18) | **Agreed and signed by finance**; any difference is an exception, never an adjustment entry made without approval |

## 7. Phase M5 — Exception list with owners

Each exception: id, data class, source record reference, problem, business impact, proposed resolution,
**owner** (hotel role or Monoclay onboarding lead), due date, status (`open`, `in_progress`, `resolved`,
`accepted as loss`, `deferred to post-cutover`), resolution evidence. Financial exceptions can only be closed by
a user with finance permission. "Accepted as loss" requires the hotel decision-maker's sign-off and appears in
the final migration report.

## 8. Phase M6 — Final change capture

- After the last rehearsal, a **final capture** reads or exports everything created or changed in the source
  since the rehearsal extract (by modification timestamp where the source provides it; otherwise a full
  re-extract compared against the rehearsal).
- Where the source cannot provide change information, the runbook shortens the gap: a full extract at freeze
  start and a manual review of today's and tomorrow's arrivals against the source screen.
- After switch, the **post-capture sweep** continues for 72 hours (target) where the source stays readable
  ([source-of-truth-matrix.md](source-of-truth-matrix.md) §6).

## 9. Phases M7–M9 — Sign-off, cutover and rollback

### 9.1 Staff acceptance and sign-off

| Signer | Signs that |
|---|---|
| Front office manager | Arrivals, in-house and departures for the first 7 days match the source; rooming lists correct |
| Reservations/revenue manager | Rates, restrictions, channel mappings and group blocks correct |
| Finance manager | Deposits, folios, receivables and opening balances reconcile (§6) |
| Housekeeping manager | Units, statuses and out-of-order records correct |
| General manager (decision-maker) | Go decision for the cutover window; acceptance of listed losses |

Sign-off is recorded in the import job with the reconciliation report version it refers to.

### 9.2 Cutover runbook (outline; property-specific runbook generated from the plan)

| Time (example) | Action | Owner |
|---|---|---|
| T-7 days | Channel hub mappings prepared (inactive); OTA connectivity-provider change requests prepared for the hotel to submit; POS/spa vendors scheduled | Onboarding lead |
| T-1 day | Final rehearsal accepted; staff briefed; paper freeze log printed | Onboarding lead, managers |
| T0 | Source end of day completed; final capture starts; freeze begins (§6 of the source-of-truth matrix) | Night manager, system |
| T0 + 30 min | Final capture imported; reconciliation run | System, onboarding lead |
| T0 + 45 min | Finance and front office confirm reconciliation | Managers |
| T0 + 60 min (RS-1 target) / + 3 h (RS-2 target) | Switch: authority effective, full ARI published, channel mappings active, POS/spa re-pointed | System, vendors |
| +72 h | Post-capture sweep ends; source set to read-only | System |
| End of rollback window | Rollback window closes (§9.3) | GM |

### 9.3 Rollback that accounts for post-cutover activity

Restoring the old database alone is **not** a recovery plan. Rollback is a reverse migration of the activity
created after the switch.

1. **Rollback window:** from switch until 48 hours after the first successful Day Close in Portico (target;
   agreed per property). After it, problems are fixed forward.
2. **Triggers (examples):** reconciliation failure that cannot be resolved within 4 hours; Day Close cannot
   complete; channel delivery failing beyond 2 hours with no workaround; decision-maker's call.
3. **Cutover journal:** from the switch, Portico records every business change in the migrated domains:
   bookings created/modified/cancelled (with channel ids), stays checked in/out, room moves, postings,
   payments, refunds, deposits, room status and out-of-order changes, profile changes. The journal is
   exportable in a reviewable form and, where the source accepts imports, in the source's import format.
4. **Rollback steps:** freeze Portico for the migrated domains → export journal → re-enable the source and its
   channel connections (CR-7: deactivate Portico's channel mappings first) → re-enter or import journal
   items into the source (assisted worklist, each item ticked off) → reconcile source against Portico's final
   state → set Portico authority back to external → record the rollback report.
5. **Payments during the window:** payments captured through Portico's adapter remain with the PSP; they are
   recorded in the source as external payments with the PSP reference. Refunds go through the PSP that took
   the payment.
6. **Non-portable tokens:** stays that saved cards in Portico after cutover keep them only in Portico's PSP;
   the rollback report lists these stays for re-collection.

## 10. Phase M10 — Historical archive

When full history migration is impractical, the hotel keeps a clearly identified **historical archive**:

- Read-only, searchable export of source reservations, folios, invoices and profiles (files plus an index),
  labeled with source system, extract date and completeness notes.
- Linked from migrated profiles and companies ("History before 12 Mar 2027 is in the archive").
- Retention follows the hotel's legal obligations (market matrix); deletion follows the processing terms.
- Never presented as live data; provenance `copied` with the extract date.

## 11. Per-source notes

Claims carry evidence labels (see [README.md](README.md#evidence-labels)). Every source has the M0 checklist
completed with the hotel before commitment.

| Source | Export route | Mapping notes | Payment tokens | Known risks |
|---|---|---|---|---|
| **OPERA 5.x (on-premise)** | Reports and exports from the hotel's own installation; OXI interface for rates/reservations [V r01, existence]; direct database extraction only if the hotel's Oracle licence permits [Unconfirmed] | Transaction codes and generates → charge codes and tax rules; routing instructions → billing rules; folio windows 1–8 → folios per payer; packages with posting rhythm → packages/allowances; block statuses → block statuses; AR (direct bill) → receivables accounts [V r01 for OPERA concepts] | Held by the hotel's PSP via OPERA's payment interface [Unconfirmed for 5.x]; treat as non-portable unless the PSP confirms | Customised codes; data quality varies by property; Oracle interface licence costs (quote required); D8: OPERA formats are first-priority importers |
| **OPERA Cloud** | OHIP REST APIs (reservations, profiles, blocks, AR) [V r01, existence]; partner fees per call apply (~US$10 per 10,000 calls) [V r01] | As OPERA 5.x | OPI Cloud token exchange with PSPs [V r01]; portability only via PSP | Large extractions incur OHIP call fees (estimate before starting); partner access required (Q61) |
| **Cloudbeds** | Report/CSV exports [Unconfirmed]; API [Unconfirmed] | Dorm/linked inventory needs composite or bed-level unit mapping [V r03 for linked inventory] | Cloudbeds Payments operated by a separate payments entity on Adyen/Stripe terms [V r03] — portability unconfirmed | Cloudbeds' channel manager must be disconnected before Portico publishes (CR-7) |
| **Mews** | Connector API (reservations, customers, order items, payments, bills) [V r02] | Bills belong to customers, not reservations → map to folios per payer; order items with states Open/Closed/Inactive/Canceled [V r02] | Mews Payments as payment facilitator with Adyen/Stripe [V r02] — portability unconfirmed | Editable history windows (up to ~7 days) mean recent past can still change in Mews: run final capture after the window closes or re-sweep [V r02] |
| **eZee Absolute** | Report exports [Unconfirmed]; API [Unconfirmed] | Bundled channel manager (eZee Centrix) to disconnect | Unconfirmed | Reviewers report "difficult migration away" [3P r03] |
| **RoomRaccoon** | Exports [Unconfirmed] | — | RaccoonPay [V r03]; treat as non-portable [Assumption] | A reported migration lost payment details [3P r03, low confidence] → explicit deposit/payment reconciliation |
| **Little Hotelier** | Exports [Unconfirmed] | SiteMinder channel manager relationship must be ended or moved (SiteMinder pmsXchange not supported at launch) | Unconfirmed | — |
| **Spreadsheets** | Portico templates (units, rates, reservations, guests, deposits) | Template validation shows errors cell by cell | None (cards never in spreadsheets; if found, the file is rejected and the hotel is told to delete it) | Deposits often only in bank statements → reconcile against bank records |

## 12. Data model sketch (integration schema, migration part)

```sql
integration.import_jobs (id, tenant_id, property_id, source_system, source_version, purpose,  -- 'trial' | 'rehearsal' | 'cutover'
  state, plan jsonb, created_by, created_at, version)
integration.import_batches (id, job_id, data_class, source_file_ref, extracted_at, record_count, checksum)
integration.import_records (id, batch_id, source_ref, target_ref jsonb, status, reason, exception_id)
                                     -- status: 'imported' | 'merged' | 'rejected' | 'excluded_by_decision' | 'exception'
integration.reconciliation_reports (id, job_id, version, results jsonb, generated_at, signed_off_by jsonb)
integration.migration_exceptions (id, job_id, data_class, source_ref, problem, impact, proposed_resolution,
  owner_user_id, due_at, status, resolution, closed_by)
integration.cutover_journal (id, property_id, transition_id, occurred_at, domain, action, record_ref, before jsonb, after jsonb)
```

## 13. Acceptance tests

| # | Test |
|---|---|
| MG-01 | Re-running a rehearsal from the same files yields identical import record states and an identical reconciliation report (except timestamps). |
| MG-02 | A source file containing a card number is rejected before storage; nothing from it is persisted. |
| MG-03 | Imported deposits that differ from the source closing balance by 1 minor unit fail reconciliation and create a finance exception (scenario 18). |
| MG-04 | An imported stay keeps its source nightly prices after a rate plan change in Portico. |
| MG-05 | Profile duplicates are flagged but not merged; a later merge is reversible. |
| MG-06 | After switch, a booking created in the source 10 minutes after final capture is found by the post-capture sweep and imported once. |
| MG-07 | Rollback drill: 30 post-cutover changes in Portico are all present in the rollback worklist and the reconciled source state. |
| MG-08 | Every source record ends in exactly one terminal state; a count query proves no record is unaccounted for. |
