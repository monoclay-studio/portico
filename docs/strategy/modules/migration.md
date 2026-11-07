# migration — 10x brief ("Move to Portico", one-button migration)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (integration wave 2; owner decision D13) · Specs: INT-R29–R34 in
`docs/specs/integration.md`; `docs/adoption/migration-acceptance-criteria.md` (phases M0–M10);
`docs/readiness/migration-onboarding-checklist.md` · Research: DD11 (`11-one-button-migration.md`), DG §3 · Parity:
**none** · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff and
a real source system.**

## 1. Current state (evidence)

- **Nothing migration-specific is built.** Reusable pieces exist: integration's mapping suggestions with confidence and
  mandatory financial review, held unmapped records, exchange log, CSV import of reservations and room status, PMS
  simulator, trial environments with `copied` provenance (identity-plus branch), finance's **opening-balance import
  of deposits with a reconciliation report and no double TGST** (S18 tested), guests' duplicate scoring and reversible
  merge, reservations' terms snapshots, platform data-authority transitions `planned → frozen → effective` (branch).
- **Owner questions open:** Q140 OHIP partner enrolment, Q141 OXI eligibility, Q142 card re-collect (default), Q143
  migration included (default), Q144 no DB extract without written rights (default), Q61, Q62 local connector, Q64
  discovery of systems in use.
- **No parity file; no source-system samples** (no pilot, D8).

## 2. Best on the market today

| Approach | Who | How | Limits | Source |
|---|---|---|---|---|
| Physical DB copy | Oracle OCM (OPERA → OPERA Cloud) | Oracle-run backup/restore after contract | OPERA-only; "potential for significant downtime" | DD11 §4; DD07 §1 |
| Mapping tool | HRS Data Migration Tool | OPERA V5 XML → code mapping → validation; 15 reservations/min | Vendor claim; code mapping manual | DD02c §7; DD07 §1 |
| Factory rollouts | Shiji | 100+ hotels in 2 months (vendor claim) | Group mandates, standard shells | DD07 §1 |
| Semi-automated | Mews | Templates, cloning, semi-automated import + manual validation; avg ~2 months, as little as 1 week | Warns against old profiles | DD07 §1; DD02b §1.2 |
| Paid import | Cloudbeds | Paid Reservation Import; **no cancelled/no-show import**; "always manual adjustments" | History loss | DG #22 |
| CSV dataloader | Stayntouch | Test files one week before | Manual preparation | DD02b §5 |
| Custom / RPA | Omniboost, RobosizeME | Bespoke projects; bots where exports are incomplete | Not productised | DD02c §7 |
| Best bulk source APIs | Mews Exports (JSONL incl. ledger), Apaleo REST, OHIP async + streaming | Incremental extraction | OHIP approvals, 50 rps shared, 1,000-record cap, 2 MB truncation | DD11 §1, §3 |

**No vendor sells a productised any-source migration or publishes migration correctness metrics** (DD11 §1, §4).
Failure evidence: FIDI doubled revenue on the books after a CRS–PMS mismatch and reverted in 2 months (DG #24).

## 3. Gaps vs market (ranked — what must be built, in DD11 §7 / DG §3.3 order)

| # | Gap | Why | Reference |
|---|---|---|---|
| 1 | Migration job pipeline + state machine (Connect → Discover → Map → Rehearse → Sync → Cutover → Backfill → Done) with the 7-step human checklist | The product itself | DD11 §6.2, §7.1; INT-R30 |
| 2 | Import APIs in every owning module keyed by source id, accepting agreed terms verbatim; all statuses incl. cancelled/no-show | Duplicates and history loss are the market's failures | gap plan §7.4; DG §3.4 |
| 3 | Reconciliation engine and gates (counts by status/arrival month, room nights and revenue on the books per stay date, deposits, AR open items and aging, in-house balances, block grids) | "Nothing is migrated until reconciled" | DD11 §7.3; acceptance criteria M4 |
| 4 | CSV/report packs for guesthouse tools and spreadsheets (same day) | First pilot is likely a guesthouse (Q26) | DD11 §7.2 |
| 5 | OPERA concept map + mapping engine (profile types, statuses, reservation/block types, rate codes, packages, routing → billing rules, transaction codes/generates → charge codes/tax rules, AR, deposits) | Resorts run OPERA (DD09 §3) | DD11 §8 |
| 6 | Delta sync + cutover orchestrator (authority transition, freeze ≤ 15 min, channel switch, rollback with cutover journal) | Big-bang downtime is the incumbent's weakness | DD11 §6.1; INT-R33 |
| 7 | OPERA Cloud (OHIP) and OPERA 5 (OXI resync / File Export pack) extractors; Mews and Apaleo extractors | Source coverage | DD11 §3, §7.2; Q140/Q141 |
| 8 | Card migration workflow (token map, guarantee report, re-collect fallback) | Hardest honest limit | DD11 §6.3; Q142 |
| 9 | Pre-import profile clean-up (score, merge, archive-don't-import) | Dirty profiles migrate intact elsewhere | DD07 §5 |
| 10 | Published migration correctness report per migration | Category first | DG §3.3 item 8; Q151 for publication |

## 4. The 10x outcome (TARGETS)

**Picture:** the hotel presses **Move to Portico**, signs the authorization, approves access in its current system, and
watches a plain-language progress page: "312 rate codes, 4,812 future reservations, 96,000 profiles found … mapped …
rehearsed twice with zero differences … in sync, 3 minutes behind … cutover booked for Tuesday 14:00, 12-minute
freeze." Nothing is called migrated until it reconciles; the only human steps are the seven that legally or technically
must be human.

| Dimension | Metric | Market reference | Target ([I] from DD11 §7, to validate) |
|---|---|---|---|
| Powerful | Sources supported end to end | none productised | CSV/spreadsheet + 2 SMB packs (Phase B); OPERA Cloud, OPERA 5 (OXI or export pack), Mews, Apaleo (Phase C) |
| Powerful | Reconciliation gates exact (DD11 §7.3) | none published | 100% exact or listed exclusions with reasons; 0 cutovers with open blocking exceptions |
| Powerful | Duplicate reservations created by migration or delta sync | FIDI doubled revenue (DG #24) | 0 |
| Seamless | Human steps | projects of weeks (DD07 §1) | 7 (DD11 §6.2), each with a named owner and reminders |
| Seamless | Elapsed time: guesthouse from CSV/SMB PMS | 2–4 weeks Cloudbeds onboarding (R03 §11) | same day (future business first, history next day) |
| Seamless | Elapsed time: 100-room resort from OPERA Cloud / OPERA 5 OXI | months (DD07 §1) | ≤ 5 days / ≤ 10 days excl. licence lead time |
| Seamless | Cutover freeze | "significant downtime" (Oracle, DD11 §4) | ≤ 15 min (OPERA Cloud streaming), ≤ 60 min (CSV sources) |
| Friendly | Finance controller time on opening balances | — | ≤ 4 h with a prepared ambiguous-items list (DD11 §6.2 step 4) |
| Well-rounded | History statuses imported (incl. cancelled/no-show) | Cloudbeds excludes them (DG #22) | all, labelled `copied` until reconciled |
| Well-rounded | Rollback after cutover never erases post-cutover activity | — | tested (acceptance criteria §9.3) |

## 5. Next 3 increments

### Increment 1 — Pipeline, import APIs, reconciliation (CSV first)
- `integration` migration schema (acceptance criteria §12): job, source assessment (INT-R29), steps with persisted
  status; import APIs in reservations, guests (companies incl.), finance (deposits, in-house balances, AR open items as
  opening balances through suspense — INT-R32), inventory and rates (configuration) keyed by `(connection, sourceId)`;
  reconciliation engine producing the M4 report with drill-down; guided CSV templates; trial-copy rehearsal.
- **Acceptance:** a seeded "guesthouse spreadsheet" and a seeded "SMB PMS export" migrate into a trial organization,
  reconcile exactly twice in a row, then cut over into a live-mode test organization; re-running the import creates 0
  duplicates; S18 extended to AR and in-house balances; parity file `docs/parity/migration.md` written.

### Increment 2 — Delta sync, cutover and rollback
- Delta sync from the PMS simulator (events + periodic catch-up, idempotent upserts), cutover orchestrator (freeze,
  final delta, final gates, authority transition per domain, channel switch hook for distribution), cutover journal and
  rollback that preserves post-cutover activity, staff acceptance checklist (step 7), hypercare exceptions.
- **Acceptance:** simulated cutover with continuous bookings during the run; freeze ≤ 15 min measured; rollback test
  keeps every post-cutover booking and payment; 7-step checklist shows owners, status and reminders.

### Increment 3 — OPERA concept map and the first OPERA path
- Mapping engine with the OPERA concept map (DD11 §8) and confidence/reasons; finance review screen data; **File Export
  pack** path for OPERA 5 (hotel-run exports over SFTP/HTTPS, masked-value detection) and an OHIP extractor against the
  public OpenAPI specs plus an OPERA-like simulator (R3 — no partner access until Q140; throttled ≤ 10–20 rps, 429
  monitoring, size-aware paging, completeness counts); card re-collect workflow (Q142 default).
- **Acceptance:** an OPERA-shaped sample estate (rate codes, packages, routing, transaction codes, blocks) maps with
  every financial mapping reviewed; truncation/paging edge cases tested against the simulator; masked PII is detected
  and blocks import with a clear message; DB-extract route stays disabled without a rights upload (Q144).

## 6. Cross-module dependencies and contract changes

Every data-owning module: `import<Entity>` keyed by source id, accepting source amounts as agreed terms (rates
`TermsSnapshot` from source prices — never recomputed silently). **platform:** authority transitions, trial copies.
**finance:** suspense accounts, AR and in-house opening balances, trial balance comparison. **guests:**
`scoreCandidates(batch)` before import. **payments:** card re-collect and token map. **distribution:** channel switch at
cutover via Channex. **analytics:** migration correctness dashboard (M14). **identity:** users re-created, never
passwords. **comms:** checklist reminders.

## 7. Power check — never lose or hide

Nothing is marked migrated until reconciled; differences are exceptions with owners, never silently "corrected"; agreed
prices and taxes of migrated bookings are preserved as source amounts; source ids stay searchable; masked or truncated
data is detected, not imported as truth; cards never travel through files; no source access without the hotel's
authorization and the vendor's terms (Q140/Q141/Q144); rollback never erases what happened after cutover.
