# Steward review — migration ("Move to Portico", D13; increments 1–2)

> Written incrementally. Status: IN PROGRESS — the verdict, counts and coverage declaration are filled in at the end.

| | |
|---|---|
| **Verdict** | _pending_ |
| **Branch / commit reviewed** | `feat/migration` @ `45be8b93614653fffb9fa5721979d6a63c48ed89` |
| **Scratch copy** | detached worktree of `45be8b9`, merged with `main` @ `2df56d1` (local merge `e9a141a`, clean) |
| **Playbook** | steward-reviewer v2.1 (launch brief v2), plus the queued v3 items the run parameters asked for (gates on a merged copy with exit codes; re-run 2 builder mutants + plant 1) |
| **PoCs** | `docs/orchestration/reviews/migration-poc/*.test.ts.txt` |

---

## 2. Findings (appended as confirmed)

### R-P0-1 · The card-number guard misses PANs written in ordinary ways, so card numbers are stored

- **Where:** `modules/migration/src/domain/sensitive.ts:57` (`CARD_CANDIDATE = /(?:\d[ -]?){12,18}\d/g`) and `:65-76`
  (`findCardNumbers` scans `rows` only); caller `modules/migration/src/sources/files.ts:80`; storage
  `modules/migration/src/service/extract.ts:403-415` (every parsed cell, every header, into `extract_payloads`).
- **Problem.** The regex is greedy and `matchAll` never retries inside a match, so adjacent digits swallow the PAN:
  - `4111 1111 1111 1111 12/27` and `Visa 4111111111111111 1227` (PAN followed by expiry) → 18–19-digit candidate fails
    the length/IIN check → **not refused**;
  - `room 12 4111111111111111` (a number before it) → not refused;
  - only one `' '` or `'-'` between groups: double spaces, dots, U+00A0, `" - "`, full-width digits → not refused;
  - header cells are never scanned, but are stored and echoed back in the upload review.
- **Why it matters.** CLAUDE.md §5 "Portico never stores raw card numbers"; MIG-I7 / MG-02 / PAR-MIG-023 /
  EC-MIG-022 are claimed `tested`. A PAN in a notes column lands in `migration.extract_payloads`, the rehearsal copy
  in the trial organization (see R-P1-6), and every backup — PCI scope for Portico. The tests only use the forms the
  regex already matches.
- **Reproduce:** `migration-poc/zz-review-domain.test.ts.txt` › "R-P0-1 …" (6 tests, all pass on `45be8b9` = defect
  present; the last one runs `readPack` and shows the PAN in the tables that `uploadFiles` stores).
- **Fix (principle):** *any run of 13–19 digits that can be formed from a cell by ignoring non-alphanumeric
  separators, at any offset, that passes Luhn and an issuer range, refuses the upload* — instances: spaces, multiple
  spaces, dots, dashes, slashes, U+00A0/U+2007/U+202F, full-width and other Unicode decimal digits (`\p{Nd}`,
  NFKC first), adjacent digits before or after (slide a window over each digit run instead of one greedy match), header
  cells, sheet names, and XLSX numeric cells in exponent form (`4.111111111111111E15` is an exact double for 16-digit
  PANs < 9.007e15). **Sibling paths:** `uploads/preview` (same `readPack`, OK once fixed), the simulator records
  (`recordsFromSimulator` — no scan at all today), the trial copy sent through the rehearsal bridge, any future
  connector extract. **Attack on the fix:** a sliding window will raise false positives on long OTA references; that is
  acceptable (the refusal names row/column only and the hotel removes it) and must be stated in the error, not
  "fixed" by shrinking the window back to one greedy match. Add each bypass above as a refusal test.

### R-P1-1 · One ~1 KB workbook kills the API process (XLSX reader has no column/row bound and trusts declared zip sizes)

- **Where:** `modules/migration/src/domain/xlsx.ts:96-101` (`columnIndex` unbounded), `:107-122` (`while (cells.length <
  idx) cells.push('')`), `:154-163` (no row or column limit; CSV has `maxRows`/`maxColumns`, XLSX has neither),
  `:38-71` (`total += size` and the ratio use the **declared** central-directory size; entries may all point at one
  local header).
- **Problem / evidence (run in the scratch copy):**
  - `zz-review/xlsx-oom.ts ZZZZZ 40` — a **939-byte** workbook (1,252 base64 characters, well under the 32 MiB upload
    limit) → `FATAL ERROR: Ineffective mark-compacts near heap limit … JavaScript heap out of memory`, **exit 134**
    (uncatchable abort; in production this is the shared API process for every tenant).
  - One cell at `ZZZZZZ1` → `RangeError: Invalid array length` after 3.6 s (a 500, not a `ValidationError`).
  - One cell at `AAAAA1` → a 475,255-column table is accepted (CSV refuses > 200).
  - Overlapping entries: 6 central-directory entries that declare size 0 and point at one 8 KiB deflated part inflate
    > 40 MiB from a < 64 KiB file (PoC "zip bomb not bounded"); `maxEntries` 2000 × `maxOutputLength` 60 MiB ≈ 117 GiB
    from a ~120 KiB upload; `inflateRawSync` also blocks the event loop for the whole time.
- **Who can do it:** anyone with `migration.job.manage` at any property — including a live organization's member in
  the **trial organization** they create (trial admins hold every right there; up to 3 trials per organization),
  via `POST /v1/migration/jobs/:id/uploads/preview` (no Idempotency-Key needed). Rate P0 if trials ever become
  self-serve.
- **Fix (principle):** *every quantity the file declares is untrusted; the reader enforces its own limits on what it
  actually produces* — instances: cap the column index (e.g. ≤ `CSV_LIMITS.maxColumns`, refuse beyond), cap rows per
  sheet and cells per workbook (same as CSV), count **actual** inflated bytes across all entries against
  `maxUncompressed` (pass the remaining budget as `maxOutputLength`), refuse duplicate names and overlapping or
  out-of-order local-header offsets, refuse a declared size that differs from the inflated size, parse each sheet
  lazily (only `xl/workbook.xml`, its rels, `sharedStrings.xml` and the referenced sheets), and map any parser
  exception to `unreadable_spreadsheet`. **Sibling paths:** `uploads/preview` and `uploads` (same `readPack`); the
  final-capture `files` in `startCutoverInput` (`contracts.ts:163`) if wired; future connector imports. Run the parse in
  a worker thread with a memory cap so a missed case degrades to one refused upload, not a process crash. **Attack on
  the fix:** a sheet with 200 columns × the row cap must still parse within the request time; shared strings can be
  referenced 10⁶ times (count cells, not bytes).

### R-P1-2 · The production gate accepts a rehearsal certificate for different data (file sources)

- **Where:** `modules/migration/src/service/cutover.ts:350-382` (gate input: `certificate: { planFingerprint, exact }`
  only); `src/domain/cutover.ts:111-128`; `src/service/cutover.ts:270-320` (`runDeltaSyncStep` re-rehearses only when
  `res.changes > 0`, and `changes` is counted **only** for `pms.simulator`); `src/service/extract.ts:280-287`
  (a `sync` upload resets no step and keeps the certificate). The certificate carries `extractFingerprint`
  (`pipeline.ts:349`, `rehearsal-bridge.ts:236`) — nothing compares it.
- **Problem.** For file sources, "delta sync" is a re-upload while `in_sync`. That upload is never rehearsed, yet the
  freeze gate passes on the old certificate whenever the codes (and so the plan fingerprint) are unchanged.
- **Reproduce:** `migration-poc/zz-review-integration.test.ts.txt` › "R-P1-2": after `in_sync`, upload an export where
  CN1003 costs 999.00 instead of 180.00 and CN1099 is new → `freeze:succeeded, cutover:succeeded, verify:succeeded`;
  the trial (the only rehearsal) still holds **8** bookings at the old price, live now holds **9**.
- **Why it matters.** "Rehearsed twice with zero differences" is the headline the hotel signs off on (10x brief §4;
  INT-R30 "re-run until accepted"); the production authorization names a plan, not data. The cutover can run a dataset
  nobody rehearsed or reconciled in the trial.
- **Fix (principle):** *the certificate binds everything the cutover will import: plan **and** data* — the gate
  compares the certificate's extract fingerprint with the live job's current source-state fingerprint (computed the
  same way on both sides), and **any** new extract after certification (sync, final, re-upload, simulator) either
  re-rehearses in the trial before the freeze or the gate refuses (`rehearsal_stale_data`). **Sibling paths:**
  `runFreezeStep`'s simulator final capture (taken after the last re-rehearsal, never rehearsed either — decide
  explicitly: re-rehearse the final delta, or accept it only if it is empty/below a stated threshold and listed);
  `productionSignoff`; `evidenceStep`. **Attack on the fix:** a change that alters only decisions (an exception closed
  as "excluded") must also invalidate the certificate — include the decisions copied to the trial in the fingerprint.

### R-P1-3 · Reconciliation only walks source → Portico: duplicates and extras in the owning modules are invisible

- **Where:** `modules/migration/src/domain/reconcile.ts:275-336` (per-booking loop over **source** records;
  `resBySource = new Map(…sourceKey)` collapses two bookings with one key; `countPor` is incremented only for matched
  pairs, so "counts by status × arrival month" compares the source with itself); `:356-386` room nights only from the
  business date and only for consuming statuses; `:393-433` money totals are summed over **source** items
  (`portico = Σ item.portico`), never over the read-back; control-total `count` is parsed (`pack.ts:604`) but never
  compared.
- **Reproduce:** `migration-poc/zz-review-domain.test.ts.txt` › "R-P1-3": reservations holds two bookings for one source
  booking, or an extra re-keyed history booking → `exact: true`, no difference; the control total "1 reservation" vs 2
  held is never checked.
- **Why it matters.** Focus (c) and MIG-I3: "nothing is migrated until the report against read-backs is exact".
  Duplicates are exactly what this report exists to catch (FIDI, DG #24), and history/cancelled duplicates never touch
  inventory, so nothing else catches them. R-P1-5 and R-P1-7 below create such duplicates and the verify step stays
  exact for the history ones.
- **Fix (principle):** *every measure is computed independently on each side and then compared* — Portico side from the
  read-back alone: number of bookings (per status × arrival month) and per source key (> 1 is a difference), deposits /
  folios / receivables totals per currency summed over the read-back (items with no source record are differences),
  and the source's control-total counts compared with both. Ask the reservations provider for **all** bookings at the
  property in the migrated window (not only this namespace) so another namespace's copy shows up (R-P1-7). **Attack on
  the fix:** bookings made in Portico after the switch would now appear as extras in the verify/sweep reports —
  classify them by `created_at > switched_at` / journal, not by silencing the measure.

### R-P1-4 · A record excluded (or imported as is) by decision blocks the cutover forever

- **Where:** `modules/migration/src/service/plan.ts:224-246` (`blocking++` for every blocking problem, decisions
  ignored) → `src/service/cutover.ts:378` (`finalExtractBlocking: quality.blocking`) → `src/domain/cutover.ts:181-185`
  ("Resolve them or exclude them by decision").
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-4": one stale "confirmed" booking (future_stay_in_past) →
  the lead excludes it as documented → 0 open blocking exceptions, in sync, every sign-off done → freeze refused with
  "1 record(s) in the final capture have blocking problems. Resolve them or exclude them by decision" — and it stays
  refused. The same holds for finance's "import as is" (`IMPORT_AS_IS_ALLOWED`) and "accepted as loss".
- **Why it matters.** M5 decisions (EC-MIG-011, EC-MIG-019 "finance may decide import as is; then imported once") can
  never reach a production cutover; the only way out is editing the source export to drop the record, which the
  error text does not say. No test reaches a freeze with any decided exception, so the gate's pass path is tested only
  with perfectly clean data.
- **Fix (principle):** *the final-capture check counts records whose verdict is "exception" (`importability` with the
  current decisions), never raw problems* — reuse `importability` so the gate, the importer and the trial agree.
  **Attack on the fix:** a record whose problem **changed** after the decision (decision was for `future_stay_in_past`,
  final capture now also has `unit_double_assigned`) must count again — `importability` already checks per problem
  code; add that case to the test.

### R-P1-5 · After the switch, a re-keyed export creates duplicate bookings in live (keys not normalised; the sweep skips quality checks)

- **Where:** `modules/migration/src/domain/pack.ts:333` (confirmation used verbatim: case, leading zeros, Excel's
  `00123 → 123`, `1.23E+16`); `src/service/cutover.ts:548-566` (`sweep` → `importAll(onlyNew)` without
  `runValidateStep`); `src/service/importer.ts:296-318` (a key never seen is "new" → created).
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-5": after a verified cutover, the hotel uploads its latest
  export in which CN1003 reads `cn1003` and CN1001 was re-keyed `CN1001-R` (same Booking.com id BDC-4471002) → the sweep
  imports both again: live goes from 8 to **11** bookings (incl. one legitimate late booking) and **two live bookings
  carry BDC-4471002** — the duplicate-channel check (`quality.ts:65-80`) never ran. Reconciliation then flags the
  originals as "missing in source", after the duplicates exist.
- **Why it matters.** "Zero duplicate reservations — Tested … sweep" (README Targets, MIG-I1) is the module's P0
  invariant; a re-saved CSV after the switch is the normal file-source sweep.
- **Fix (principle):** *a record that may duplicate an existing one is never imported automatically after the switch*
  — the sweep runs the same validate step (with the live job's full record set, including already-imported ones) and
  treats as a blocking exception any new key that matches an imported record by a normalised key (trim, case-fold,
  strip leading zeros, numeric canonical form) or by a natural identity (channel code + channel booking id; guest +
  arrival + departure + unit type). Normalise keys once, in the ledger key, for every adapter. **Sibling paths:** the
  rehearsal/cutover import (same normalisation), the simulator sweep (`extractFromSimulator(…'sweep')`), the trial
  bridge (records copied verbatim). **Attack on the fix:** two genuinely different bookings `0012` and `12` in one
  export must then raise `duplicate_key_conflict`, not silently merge — normalise into the conflict check too.

### R-P1-6 · The 30-day purge (Q162 default) never reaches the rehearsal copy in the trial organization

- **Where:** `modules/migration/src/jobs.ts:57-67` (purges only jobs in `completed|rolled_back|cancelled`);
  `src/rehearsal-bridge.ts:83-200` (the trial job is created as a rehearsal, receives **every** live source record —
  names, emails, phones, dates of birth — and ends in `rehearsed`); nothing closes or cancels it when the live job
  completes, rolls back or is cancelled (`cancelJob`, `runWindowStep`, housekeeping).
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-6": live job cancelled, 31 days later housekeeping purges
  the live job; the trial job is `{ state: 'rehearsed', purged_at: null }` and its `source_records` / `extract_payloads`
  still contain the guest's name and email.
- **Why it matters.** Q162 (a) and README "Source personal data is purged 30 days after a migration ends" (MIG-I12,
  PAR-MIG-024 `tested`) — AP-62: the recorded default is not what the code does for the copy that holds the most data.
  Also `failed` jobs are never purged, and the guest data export (`migrationPersonalData.collect`) does not include the
  trial copy.
- **Fix (principle):** *every copy of source data a migration creates has the same end-of-life as the migration* — the
  live job's end (complete, rollback, cancel, fail) closes its trial rehearsal job through the bridge (a new
  `rehearsal.close(liveJobId)` port call) and the housekeeping purges any rehearsal job whose live job ended, plus
  `failed` jobs; the trial organization's own closure (trial lifecycle) purges too. **Sibling paths:** the trial's
  owning-module copies (bookings, profiles with `copied` provenance — trial retention, Q63, say so in the README), the
  sandbox drill jobs. **Attack on the fix:** a trial job whose live organization was deleted must still be purged
  (housekeeping cannot rely on the live side answering).

### R-P1-7 · A second production migration of the same property from another adapter is accepted and nothing dedupes it

- **Where:** `modules/migration/src/service/jobs.ts:38-140` (`createJob` refuses only while another job is **open**);
  `src/service/state.ts:15-18` (ledger namespace = adapter key) and the reservations contract keyed by the same
  namespace (`importer.ts:494`); README Known gaps and EC-MIG-032 call cross-namespace detection "next increment".
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-5" (tail): after the first migration completes, a new
  production job for the same property from `littlehotelier.csv` is created; its ledger namespace differs, so every
  booking would be created again (only future stays surface later, as room-night differences — history never does, see
  R-P1-3). The error text for a closed job even invites it: "start a new one to move more data" (`context.ts:200`).
- **Why it matters.** Zero duplicates is the module's P0 target; the README's "One open migration per property is
  enforced" reads as a mitigation but does not cover sequential migrations (template pack first, real PMS export later
  — a likely pilot path).
- **Fix (principle):** *the ledger is per property and data class, whatever adapter delivered the record* — until
  cross-adapter identity exists, refuse a production job when the property already has imported records from another
  namespace (or require an explicit "additive" scope that excludes reservations/deposits), and make R-P1-3's
  reconciliation read all bookings at the property. **Attack on the fix:** the same adapter with a different simulator
  account (`sourceRef`) is also a different namespace — include it.

