# Migration and onboarding checklist

Deliverable 9 of the operational-readiness brief (§6, §18; product brief §16, scenario 18). Owner: Migration lead
(role) with the hotel's general manager and finance controller. Last updated: 2026-11-07. Labels as defined in
`dependency-register.md`. All importers are **R1 Planned** (D8: generic CSV and OPERA formats first).

> Never perform a production data migration without the owner's explicit authorization (CLAUDE.md §1). Never promise
> transfer of stored cards, tokens, historical documents or audit records without verifying portability (readiness
> brief §18).

---

## 1. Pre-engagement (before any data moves)

| # | Item | Evidence | Owner |
|---|---|---|---|
| 1.1 | Written authorization from the hotel's legal entity to access/export its data and to process it in Portico | Signed authorization / DPA | Hotel GM |
| 1.2 | Source-system contract checked: export rights, export fees, notice period, API access | Contract excerpt; vendor confirmation | Hotel (owner of contract) |
| 1.3 | Inventory of systems: PMS, channel manager, booking engine, POS, locks, payment terminals/gateway, accounting, spreadsheets | System inventory | Migration lead + hotel |
| 1.4 | Decide authoritative system per data domain during and after cutover (inventory, rates, reservations, folios, AR, guest profiles) | Signed authority table (§4.2) | Hotel GM + migration lead |
| 1.5 | Payment route decided (Route A/B/C/D — responsibility matrix §2) and provider accounts approved where needed | Provider approval or Route D SOP | Hotel finance |
| 1.6 | Tax configuration confirmed by hotel accountant (TGST, green tax class, service charge rules) | Signed tax configuration sheet | Hotel finance controller |
| 1.7 | Pilot scope agreed (which modules, which channels, which outlets, which hardware) | Pilot scope document | Founder + hotel GM |

## 2. Source-system export realities

Details below are `[unconfirmed]` unless labelled; confirm with each hotel's vendor. "Export cost" is hotel-paid by
default and **never assumed zero**.

| Source | Typical export route | Known limits / risks | Cards & tokens | Historical documents / audit | Questions for vendor |
|---|---|---|---|---|---|
| **OPERA Cloud** | OHIP REST APIs (partner pays usage `[verified 2026-11-07, R01]`); environment-owner approval; reports export | Partner access route conflicting `[verified 2026-11-07, conflicting]`; Oracle professional services may be needed for some enablement `[verified 2026-11-07 for streaming]` | Tokens held by OPI/PSP; not portable to another PSP without PSP-to-PSP migration `[unconfirmed]` | Folio history and audit trails available via reports/APIs within limits `[unconfirmed]` | API scope for future reservations, AR, deposits; bulk export options; fees |
| **OPERA 5 (on-premise)** | Report exports (CSV/XML), database extracts by the hotel's DBA or Oracle partner `[unconfirmed]` | Schema complexity; licence terms for DB access `[unconfirmed]` | Same as above | Large history; often summarized | Hotel's support contract terms |
| **Cloudbeds** | Reports to CSV; API for partners `[unconfirmed]`; reservation import into Cloudbeds is sold separately `[verified 2026-11-07, R03]` (indicates import/export are commercial items) | Rate/restriction exports may be partial | Cloudbeds Payments tokens not portable without PSP cooperation `[unconfirmed]` | Invoices as PDFs | Full data export on termination; fees |
| **Mews** | Connector API with hotel-issued access token `[unconfirmed for export scope]`; reports | API access for a competitor's migration tool `[unconfirmed]` | Mews payments tokens (Adyen/Stripe) `[unconfirmed portability]` | Bills/invoices via API/reports | Export of future reservations, deposits, AR |
| **eZee Absolute** | Report exports; partner API `[unconfirmed]` | Reviews cite difficult migration away `[secondary, read 2026-11-07, R03]` | Gateway-dependent | PDF invoices | Full export availability |
| **RoomRaccoon** | Report exports `[unconfirmed]` | Anecdote of payment details lost during migration `[secondary, low confidence, R03]` | RaccoonPay tokens `[unconfirmed portability]` | — | Export on termination |
| **Spreadsheets / paper** (common for small guesthouses `[unconfirmed]`) | Manual CSV templates | Inconsistent room names, duplicates, missing emails, mixed currencies | None (cards never imported) | None | — |
| **Channel manager in use** (e.g. SiteMinder, eZee Centrix) | Mapping export / screenshots | Must be disconnected in a controlled order (§4) | VCC/hotel-collect cards stay at channel | — | Disconnection lead time |

**Cards:** the default plan is **not to migrate card data**. Guarantees for future reservations are re-collected
(payment links, OTA re-supply of VCC where possible) unless both PSPs confirm a PCI-compliant token migration in
writing.

## 3. Data mapping and quality checks

| # | Domain | Checks | Evidence |
|---|---|---|---|
| 3.1 | Property configuration & inventory | Unit list vs physical rooms; unit types; composite/connecting units; out-of-order units | Signed inventory list |
| 3.2 | Rates, packages, taxes, policies | Rate plans, derived rules, meal plans, packages and allowances, cancellation/deposit policies; tax/fee rules effective-dated with sources | Rate comparison for sample dates (old quote vs Portico quote) |
| 3.3 | Future reservations & group blocks | Count by arrival month; room nights; revenue on books; group blocks with pickup and release dates; OTA reservation IDs preserved | Reconciliation report: matched / rejected / incomplete |
| 3.4 | Deposits | Deposit balance per booking = source deposit ledger total | Totals reconcile to source closing balance |
| 3.5 | Open folios (in-house guests) | Balance per folio; posted vs unposted charges | Folio-by-folio comparison |
| 3.6 | Accounts receivable | Open items per company/agent; aging buckets; credit limits | AR aging tie-out |
| 3.7 | Guest profiles | Duplicates detected; consents/communication preferences carried with source and date; sensitive fields minimised | Duplicate report; consent mapping |
| 3.8 | OTA mappings | Every channel room/rate mapped or explicitly excluded | Mapping report |
| 3.9 | Payment & hardware config | Terminals, gateway credentials, lock encoder interface, POS posting codes | Test transactions in sandbox/test mode |
| 3.10 | Users, roles, training | Accounts created with least privilege; MFA; training attendance | User list; training log |

**Migration journal rule:** opening balances (deposits, open folios, AR) are posted as **migration journal entries**
referencing the source totals and import batch ID — never typed as ordinary payments, so revenue and payment reports
are not distorted. Discrepancies (scenario 18) go to an exceptions list with owner and resolution, and the hotel's
finance controller signs the reconciliation before go-live.

## 4. Cutover and rollback design

### 4.1 Principles

1. **One authoritative system per domain at any instant** — never two systems controlling the same live inventory
   without an explicitly validated arrangement (readiness brief §6).
2. **Forward-only after cutover.** Portico never restores an old backup over live data; the old system is never
   "restored" over the period after cutover. Rollback **replays** post-cutover transactions; it never erases them.
3. Every booking that arrives during cutover is accounted for in exactly one system, with a log.

### 4.2 Authority table (example — agree per hotel)

| Domain | Before T0 | Cutover window (T0 → T1) | After T1 |
|---|---|---|---|
| Channel ARI master | Old CM | **Stop-sell or freeze** on old CM, no ARI changes | Portico (via Channex) |
| Reservations entry | Old PMS | Old PMS read-only; walk-ins/phone bookings logged on paper/form | Portico |
| In-house folios | Old PMS | Frozen at T0 balances | Portico (opening balances) |
| Payments | Old terminals/gateway | Terminals continue (Route D); recorded on cutover log | Portico records/processes |

T0 = start of cutover (low-activity time, after the old system's night audit); T1 = Portico live after reconciliation.
Window length is set per hotel during rehearsal `[assumption: target a few hours, not days]`.

### 4.3 Cutover steps

1. Rehearsal completed on a copy (§5) with signed reconciliation.
2. At T0: old system night audit complete; export final delta (bookings created/modified since rehearsal export).
3. Freeze ARI on old CM (or stop-sell) — confirm in each channel extranet.
4. Import delta; rerun reconciliation; finance controller signs.
5. Connect Portico to Channex mappings in **inactive** state; validate mapping; then activate ARI push with a full resync.
6. Pull channel bookings for the full future window and compare to imported reservations; resolve differences.
7. Disconnect old CM from channels (order agreed with Channex/old vendor so no channel is left unconnected longer than
   necessary, and no channel is connected to two systems).
8. Process cutover-window paper log in Portico (bookings, payments) with source references.
9. Go/no-go: GM + finance controller + migration lead.

### 4.4 Rollback (never erases post-cutover transactions)

Trigger: go/no-go fails, or a critical defect within the agreed rollback window (e.g. before the first Portico Day
Close or within a defined number of hours `[assumption — agree per hotel]`).

1. Put Portico ARI on stop-sell/freeze; Portico becomes **read-only** for the property (no deletes).
2. Generate the **post-cutover delta report** from Portico: new/modified/cancelled reservations, postings, payments,
   refunds, deposits, guest profile changes — with timestamps and channel references.
3. Re-enter or import the delta into the old system (vendor import or manual), tick off each item; finance controller
   signs that balances match Portico's delta.
4. Reconnect old CM to channels; full ARI resync from the old system.
5. Portico data for the window is **retained** (read-only) as the record of what happened; it is never restored over.
6. Payments taken via Portico-integrated providers remain in the hotel's PSP account; tokens stay with that PSP.
7. Root-cause review before re-attempt.

## 5. Migration rehearsal

| Step | Pass criterion | Evidence |
|---|---|---|
| Full export from source (test or copy) | Complete files received | File manifest with row counts and checksums |
| Import into a **training** environment (never live) | Import completes; rejects listed with reasons | Import job report |
| Reconciliation | Reservations, room nights, revenue on books, deposits, folios, AR all tie out or have explained differences | Signed reconciliation report |
| Workflow check by hotel staff | Arrivals, check-in, posting, payment, check-out, Day Close performed on migrated data | Staff validation notes (operational acceptance, separate from automated tests) |
| Timing | Cutover runbook timed | Timed runbook |

## 6. Onboarding (configuration, training, procedures)

| # | Item | Evidence | Owner |
|---|---|---|---|
| 6.1 | Property profile (type, timezone/"island time" decision, base currency, legal entity, tax class) | Config export | Migration lead + GM |
| 6.2 | Departments, outlets, charge codes, routing rules | Config export | Hotel finance |
| 6.3 | Policies (cancellation, deposit, no-show, early/late, child rules) | Policy sheet signed | GM |
| 6.4 | Roles and users; MFA; leavers process | User list | Hotel admin |
| 6.5 | Training by role (front desk, housekeeping, finance, managers) on the training environment | Attendance; task-completion observations (time, errors, help needed) | Trainer + hotel |
| 6.6 | Standard operating procedures incl. continuity (`support-recovery-plan.md` §3) | SOP sign-off | GM |
| 6.7 | Support contacts, hours and escalation (honest promise — Q21) | Support sheet | Founder |
| 6.8 | Hypercare plan (named contact for the first weeks after go-live) | Plan | Founder |

## 7. Blockers

| Blocker | Affected outcome | Owner | Next action | Proceeds meanwhile |
|---|---|---|---|---|
| No pilot hotel (D8) | Real export samples, rehearsal | Founder | Pilot outreach | Build importers against generic CSV + OPERA formats and synthetic exports |
| Vendor export terms unknown | Migration cost/timeline | Hotel | Ask vendor (§2 questions) | Templates and mapping UI |
| Card portability unverified | Guarantee continuity | Payments engineer | PSP confirmation | Default re-collection workflow |
