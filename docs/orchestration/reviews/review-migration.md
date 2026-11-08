# Steward review — migration ("Move to Portico", D13; increments 1–2)

| | |
|---|---|
| **Verdict** | **do not merge** — fix round for R-P0-1 and R-P1-1…R-P1-8, then a focused re-review (v1-b shape: a P0 was raised). Merging as is would put a ~1 KB request that crashes the shared API (R-P1-1) and a card-number guard that stores ordinary PAN spellings (R-P0-1) on the server |
| **Branch / commit reviewed** | `feat/migration` @ `45be8b93614653fffb9fa5721979d6a63c48ed89` (unchanged at the end of the review) |
| **Scratch copy** | detached worktree of `45be8b9`, merged with `main` @ `2df56d1` (local merge `e9a141a`, clean). `main` moved to `0b108b6` during the review (docs only), no re-merge needed |
| **Playbook** | steward-reviewer v2.1 (launch brief v2) plus the run's v3 items: gates on a merged copy with exit codes; 2 builder mutants re-run + 1 own |
| **Counts** | **P0 1 · P1 8 · P2 9 · P3 12** |
| **Coverage** | checklist 15/15 declared; patterns A–E: 61, **50 applicable** (28 probed, 19 code-read, 3 applied as steps), **0 applicable unprobed**, 11 not applicable; F not applicable (no UI) |
| **Mutants** | builder M1 (ledger skip) **killed** (11 tests), builder M2 (authorization blocker) **killed** (2 tests), own M3 (simulator refused in live at extraction) **survived** → R-P3-8 |
| **PoCs** | `docs/orchestration/reviews/migration-poc/zz-review-domain.test.ts.txt` (14 tests), `zz-review-integration.test.ts.txt` (6 tests, real Postgres), `zz-review-xlsx-oom.test.ts.txt` (child-process crash script). Every PoC asserts the defect on `45be8b9`; the fix inverts it |

**What is good.** The pipeline shape, the ledger-per-key exactly-once guard (proven by a killed mutant), the honest
"waits at the reservations import" stop on a real server, the second-person controls delegated to platform, the
append-only artefacts, the PII-free events and journal, and the builder's disclosure of fakes, unverified layouts and
the failing parity gate are all solid. The findings cluster on four seams: **hostile files** (R-P0-1, R-P1-1), **what
the certificate and the report actually bind** (R-P1-2, R-P1-3, R-P1-4), **the post-switch sweep** (R-P1-5, R-P1-8,
R-P2-3) and **end-of-life of copies** (R-P1-6, R-P1-7).

**Top findings**
1. R-P0-1 — the card guard misses `4111 1111 1111 1111 12/27`, `room 12 4111…`, double spaces, dots, NBSP, full-width digits and headers; those files are stored.
2. R-P1-1 — a 939-byte XLSX aborts the Node process (heap OOM, exit 134); declared zip sizes are trusted.
3. R-P1-2 — the gate passes a rehearsal certificate for different data: an export uploaded while in sync is cut over without ever being rehearsed.
4. R-P1-3 — reconciliation never counts the Portico side: duplicate or extra bookings and balances are "exact".
5. R-P1-5 / R-P1-8 — after the switch the sweep imports re-keyed duplicates (two live bookings for one Booking.com id) and lets a non-finance role post a USD 5,000 opening deposit.

**Fix order suggested:** R-P0-1 and R-P1-1 (shared file-ingest hardening), then R-P1-4 with R-P1-2 (they share the
"what does the gate count/bind" change — bind data and decisions), then R-P1-5/R-P1-8 (sweep = validate + stage money
for finance), R-P1-3 (two-sided reconciliation; needs the MIG-CR-1 read-back), R-P1-6/R-P1-7.

---

## 2. Findings (appended as confirmed)

### R-P0-1 · The card-number guard misses PANs written in ordinary ways, so card numbers are stored

- **Where:** `modules/migration/src/domain/sensitive.ts:45` (`CARD_CANDIDATE = /(?:\d[ -]?){12,18}\d/g`) and `:54-68`
  (`findCardNumbers` scans `rows` only); caller `modules/migration/src/sources/files.ts:79`; storage
  `modules/migration/src/service/extract.ts:397-405` → `:268` (every parsed cell and every header into
  `extract_payloads`).
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

- **Where:** `modules/migration/src/domain/xlsx.ts:98-103` (`columnIndex` unbounded), `:124` (`while (cells.length <
  idx) cells.push('')`), `:133-170` (no row or column limit; CSV has `maxRows`/`maxColumns`, XLSX has neither),
  `:64-66` (`total += size` and the ratio use the **declared** central-directory size; entries may all point at one
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

- **Where:** `modules/migration/src/service/cutover.ts:360-381` (gate input: `certificate: { planFingerprint, exact }`
  only); `src/domain/cutover.ts:111-128`; `src/service/cutover.ts:254-325` (`runDeltaSyncStep` re-rehearses only when
  `res.changes > 0`, and `changes` is counted **only** for `pms.simulator`, `:269`); `src/service/extract.ts:272-284`
  (a `sync` or `final` upload resets no step and keeps the certificate). The certificate carries `extractFingerprint`
  (`pipeline.ts:352`, `rehearsal-bridge.ts:234`) — nothing compares it.
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

- **Where:** `modules/migration/src/domain/reconcile.ts:263-336` (per-booking loop over **source** records;
  `resBySource = new Map(…sourceKey)` (`:263`) collapses two bookings with one key; `countPor` (`:293`) is incremented
  only for matched pairs, so "counts by status × arrival month" compares the source with itself); `:358-385` room
  nights only from the business date and only for consuming statuses; `:400-433` money totals are summed over
  **source** items (`:415`, `portico = Σ item.portico`), never over the read-back; control-total `count` is parsed
  (`pack.ts:622`) but never compared.
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

- **Where:** `modules/migration/src/service/plan.ts:234-245` (`blocking++` at `:243` for every blocking problem,
  decisions ignored) → `src/service/cutover.ts:377` (`finalExtractBlocking: quality.blocking`) →
  `src/domain/cutover.ts:170-175` ("Resolve them or exclude them by decision").
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

- **Where:** `modules/migration/src/domain/pack.ts:348` (confirmation used verbatim: case, leading zeros, Excel's
  `00123 → 123`, `1.23E+16`); `src/service/cutover.ts:550-566` (`sweep` → `importAll(onlyNew)` at `:563`, without
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
  `src/service/state.ts:15-18` (ledger namespace = adapter key) and the guests/reservations contracts keyed by the
  same namespace (`importer.ts:469`, `:507`); README Known gaps and EC-MIG-032 call cross-namespace detection "next increment".
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-5" (tail): after the first migration completes, a new
  production job for the same property from `littlehotelier.csv` is created; its ledger namespace differs, so every
  booking would be created again (only future stays surface later, as room-night differences — history never does, see
  R-P1-3). The error text for a closed job even invites it: "start a new one to move more data" (`context.ts:201`).
- **Why it matters.** Zero duplicates is the module's P0 target; the README's "One open migration per property is
  enforced" reads as a mitigation but does not cover sequential migrations (template pack first, real PMS export later
  — a likely pilot path).
- **Fix (principle):** *the ledger is per property and data class, whatever adapter delivered the record* — until
  cross-adapter identity exists, refuse a production job when the property already has imported records from another
  namespace (or require an explicit "additive" scope that excludes reservations/deposits), and make R-P1-3's
  reconciliation read all bookings at the property. **Attack on the fix:** the same adapter with a different simulator
  account (`sourceRef`) is also a different namespace — include it.

### R-P1-8 · After the switch, a non-finance role posts opening deposits into the live ledger through the sweep

- **Where:** `modules/migration/src/routes.ts:512-541` and `src/service/cutover.ts:550-566` (`sweep` needs only
  `migration.job.manage`); `src/service/importer.ts:576-700` (`importMoney` posts any not-yet-imported deposit,
  in-house balance or receivable through finance; on a partial batch `providedClosingMinor` falls back to the batch's
  own total, `:643`, so finance sees no difference either).
- **Reproduce:** `zz-review-integration.test.ts.txt` › "R-P1-8": after a verified cutover the migration lead (role
  template without `migration.finance.signoff`) uploads a deposits file with a new row "CN1003, 5000.00" and sweeps →
  the ledger says `imported` and finance holds a **USD 5,000.00** opening deposit on CN1003. The reconciliation raises a
  closing-balance exception only afterwards; the posting is immutable.
- **Why it matters.** Money decisions belong to finance (M5; builder §5 "Money decisions belong to finance — yes";
  checklist "Confirm the opening balances" is finance's). A deposit is a liability that reduces what the guest pays at
  check-out; inside the 48 h window a migration lead can credit any booking, and the same path creates bookings with
  arbitrary agreed terms (MIG-CR-1 rule 2: never re-priced) without any reservations permission (AP-53/AP-09).
  Rated P1 (privileged insider, short window, detected afterwards); it is a money-correctness path.
- **Fix (principle):** *after the opening balances are confirmed, nothing from the source changes money without
  finance* — in the sweep (and any post-confirmation import), every record of a financial class, and every booking
  that carries a financial problem code, is staged as a **financial exception** for `migration.finance.signoff`
  instead of being posted; new bookings from a sweep are staged for the reservations manager when they fail any
  quality check (R-P1-5). **Sibling paths:** the cutover import after a `sync`/`final` upload that finance never
  re-confirmed (R-P1-2 — re-open `opening_balances` and `staff_acceptance` when data changes after they were signed),
  `in_house_balance` and `ar_open_item` in `importMoney`, the simulator sweep. **Attack on the fix:** a sweep that
  changes an already-posted deposit is already an exception (`opening_balance_changed`) — keep that; check that a
  *deleted-then-re-added* deposit row (new key) is also staged, not posted.

### P2

| ID | Where | Problem and why it matters | Fix (principle; siblings; attack on the fix) | Evidence |
|---|---|---|---|---|
| R-P2-1 | `src/service/cutover.ts:83-96`; `apps/api/src/composition.ts:620-630` (`declareExternalAuthority` as the system process); `cancelJob` `:797-823` | **One person makes a property's Portico read-only for 8 domains, and cancelling does not undo it.** `planCutover` (`migration.cutover.execute` only) declares the source system of record for reservations, availability, rates, guestProfiles, charges, payments, accounting and roomStatus immediately; the job's `domains` are fixed to all 8 (`jobs.ts:86`). Harmless for a hotel not yet on Portico; for "replace selected capabilities" (housekeeping already authoritative in Portico) or a second migration (R-P1-7) it stops operations, and `cancelJob` leaves it external. "Restricting only" (builder exemption BS4-2) is not safe once the domain is in use. AP-09 / AP-47. | *Restricting a domain that Portico already operates needs the same second-person approval as moving it back, and a cancelled or rolled-back migration restores what it changed* — declare external authority only for domains whose current authority is not already exercised in Portico (no records / not `portico` with activity), let the job's domains be chosen (adoption path), and have `cancelJob` plan the transition back. Attack: a domain that became active **after** planning (staff started housekeeping meanwhile) must be re-checked at cancel. | code-read |
| R-P2-2 | `src/service/cutover.ts:430-472` (`runCutoverStep` re-checks nothing); gate only in `runFreezeStep` | **The gate is evaluated once.** After a successful freeze, a revoked authorization (or an expired one, a new blocking exception, a cancelled transition approval) does not stop the switch when the run resumes (crash, `maxSteps`, lease). AP-56 / AP-60. | *The irreversible step re-evaluates the gate inputs that can change after the freeze* (authorization current and unrevoked, transition approved, open blocking exceptions) and, if refused, offers "unfreeze" (cancel the frozen transition). | `zz-review-integration.test.ts.txt` › "R-P2 the gate is evaluated once" (revoke after freeze → next run switches; reservations authority = portico) |
| R-P2-3 | `src/service/cutover.ts:550-566` (`sweep` holds no lease, so its correlation id is never added to `run_correlations`); `:724`; `packages/http/src/server.ts:80-83` (`X-Request-Id` accepted from the client as the correlation id) | **The rollback worklist is wrong both ways.** (a) The sweep's own imports are journaled as post-cutover activity, so a rollback asks staff to re-enter, in the old system, records that came **from** the old system (duplicates there). (b) The exclusion trusts a client-chosen value: any request sent with `X-Request-Id` equal to a pipeline run's id (the lead chooses it when pressing "run") is left out of the journal, so a post-cutover change can be hidden from the rollback ("rollback erases nothing"). | *Journal exclusion is decided by a server-issued marker on the migration's own writes*, never by the request's correlation id — e.g. a per-run id stamped by migration into the provider calls (or the actor `system:migration`), covering run, sweep and cutover/start. Attack: a staff write made inside the same HTTP request as a run (none today) must still be journaled. | (a) `zz-review-integration.test.ts.txt` › "R-P1-5" tail (`journalEvent` of the sweep's `guests.profile.*` event → `true`); (b) code-read |
| R-P2-4 | `src/routes.ts:497-505`, `:531-539` | The two uploads that are **never rehearsed** (final capture at `cutover/start`, post-switch `sweep`) force `confirmDetection: true`, so a low-confidence column detection ("Total" read as room total) is stored without the person's confirmation that every other upload requires (`extract.ts:367-374`). | *Detection confirmation is never skipped*; a final/sweep upload whose detection differs from the job's confirmed column map for that file is refused with the review. | code-read |
| R-P2-5 | `src/service/extract.ts:161-163` (first occurrence kept); `src/domain/quality.ts:42-58` | **Multi-room bookings under one confirmation number** (common in PMS exports) are blocked as `duplicate_key_conflict`, and the advice is "Keep one row in the export and upload it again" — i.e. drop a real room. There is no way to import a group/multi-room booking and no parity row for it. | *Never advise deleting a source record*: key multi-room rows by confirmation + room/line, or offer "split into N bookings"; add the parity row (OPERA shares/multi-room, Cloudbeds group bookings). | `zz-review-domain.test.ts.txt` › "R-P2 duplicate keys" + code-read |
| R-P2-6 | `src/domain/xlsx.ts:133-170` (no `workbookPr date1904`); `src/domain/normalize.ts:36-40`; `src/domain/pack.ts:327` | (a) Workbooks in the 1904 date system (Mac Excel) shift **every** date by 4 years and 1 day, silently; both sides of the reconciliation then agree on the wrong dates. (b) Dates of birth before 1980 in a workbook are serials < 29,221 → "invalid" → the problem goes into a throw-away array → DOB silently dropped (INT-R31 "never silently discard"). | Read `date1904`; accept DOB serials from 1900; route DOB problems to the record as a warning. | `zz-review-domain.test.ts.txt` › "R-P2 XLSX 1904" (serial 46000 → 2025-12-09 instead of 2029-12-10); (b) code-read |
| R-P2-7 | `migrations/0001_migration.sql:313-326`; `src/jobs.ts:15` | Housekeeping (reminders, rollback-window closing, purge) visits `tenants_with_open_jobs(500)` with **no ORDER BY**, and rehearsal jobs never leave that set (R-P1-6), so as trials accumulate some tenants are never visited — purges and window closings silently stop. No alarm on "housekeeping has not succeeded for tenant X" (AP-61). | Page by tenant id with a cursor; exclude purged/ended jobs; emit a metric per run and alarm on absence. | code-read |
| R-P2-8 | `src/service/exceptions.ts:121-176`; `src/service/state.ts:236-251` | **"Mark resolved" / "deferred" on a still-present blocking problem looks successful and is never re-opened.** The record stays un-importable, but the exception shows resolved, `openExceptions.blocking` drops to 0 and the job headline no longer lists it; re-validation keeps the status unless the outcome was `corrected`. Today the gate still refuses only because of R-P1-4's raw count — fixing R-P1-4 must not turn this into a silent exclusion. | *Closing an exception without an outcome is a claim the data changed*: store it as `corrected` so the next validation re-opens it, or refuse "resolved" while the problem is present. | code-read (+ R-P1-4 PoC shows the counters) |
| R-P2-9 | `docs/parity/migration.md`; `node tools/parity-report.mjs --gate migration` | **Parity gate fails** (exit 1: PAR-MIG-004/005/012 `building`, disclosed by the builder; the module is not complete per CLAUDE.md §7). Rows claimed `tested` that this review disproves: PAR-MIG-023 / EC-MIG-022 (R-P0-1), PAR-MIG-024 (R-P1-6), PAR-MIG-007 (R-P1-3), PAR-MIG-019 (R-P1-2), EC-MIG-019 "then imported once" (never reaches a cutover, R-P1-4), EC-MIG-007 (sweep without checks, R-P1-5). Missing rows: multi-room/shared bookings, re-keyed or normalised source keys, archive-don't-import for old profiles (10x gap #9), staff user accounts (10x §6 "users re-created, never passwords"), companies/travel-agent profiles behind AR accounts, the published correctness report (gap #10). | Downgrade those rows to `building` with the finding id; add the missing rows (P1 `specified` at least). | parity-report output (scratch copy) |

### P3

| ID | Where | Problem | Suggested fix |
|---|---|---|---|
| R-P3-1 | `src/routes.ts:173-182` | `uploads` requires an `Idempotency-Key` but never stores or replays it (no `runIdempotent`), unlike the header comment's promise. Harmless (re-upload changes nothing) but misleading. | Use `runIdempotent` (response has no personal data) or drop the requirement and say why. |
| R-P3-2 | `src/service/importer.ts:182-240` | `importAll` loads the records **before** the per-chunk job lock; an upload landing mid-run makes later chunks import stale content over a newer version (AP-36). Reconciliation catches it; in the sweep it raises a spurious "changed after final capture". | Re-read each chunk's records under the job lock. |
| R-P3-3 | `src/service/importer.ts:643` | `providedClosingMinor` falls back to the batch's own total whenever any deposit of that currency is held back, so finance's closing-balance check is a tautology then (migration's reconciliation still compares). | Pass the reported closing balance minus listed exclusions, or say in code that finance's check is skipped. |
| R-P3-4 | `src/service/importer.ts:717`, `:750` | In-house and receivable rejections are matched by `bookingId` / `invoiceRef` only: two folios of one booking, or one invoice number under two accounts, mark a posted item `rejected`. | Key the rejection map like the ledger key. |
| R-P3-5 | `src/service/exceptions.ts:22-35`, `:135` vs `importer.ts`/`plan.ts` | Lock order exception → job (resolve) vs job → exception (import/validate upserts) can deadlock (40P01 → a 500). | Lock the job first in `resolveException`/`assignException`. |
| R-P3-6 | `src/domain/sensitive.ts:76-86`; no encoding check | Masking with single characters ("J\*hn D\*e") is not detected; mojibake/U+FFFD names (wrong code page) are imported as truth. | Treat any `*`/`•` inside a name and any U+FFFD as masked/unreadable. |
| R-P3-7 | `src/service/extract.ts:254`; refusal audit `:347-356` | Upload file names are kept after the purge (and in the card-refusal audit); hotels name exports after guests or groups. | Purge file names with the payloads; audit a hash. |
| R-P3-8 | `src/service/extract.ts:429-433` | **Mutant M3 survived** (see § 5): the extraction-time "simulator never in live" refusal can be deleted with all 113 module + 7 API tests green; only `createJob`'s refusal is tested. Defence in depth today (no org environment change exists on `main`; `rehearseHere` also refuses live). | Add a test that runs the discover/delta step on a simulator job whose context is live. |
| R-P3-9 | `src/service/cutover.ts:152-183` (`:169`) | The production authorization accepts any other user, including an account the creator invited and granted minutes before (AP-10 R2-P2-4); no provenance-of-grant check exists platform-wide. | Cross-module (identity): record who granted `migration.production.authorize` and refuse when it is the job creator. |
| R-P3-10 | `src/domain/csv.ts:142-149` | `toCsv`'s formula neutralisation misses a leading space/tab-then-`=` and full-width `＝`; only templates use it today (no report is exported as CSV). | Strip leading whitespace before the test; NFKC first. |
| R-P3-11 | `apps/api/test/rates.test.ts` (not this branch) | Gate flake: "prices every demo property … right after seeding" timed out (30 s) once in 5 runs (load average 22, three reviews in parallel); passed in the `--continue` re-run and 3/3 isolated re-runs. | Owner rates/api: raise the per-test timeout or slim the seed; track as a flake (E-079 rule). |
| R-P3-12 | `src/service/pipeline.ts:31` | The 10-minute run lease is never renewed; a resort-size import outlives it and a second runner starts (locks keep it correct, but "already running" stops being true). | Renew the lease per chunk. |

---

## 1. Command results (scratch copy = `45be8b9` + `main` @ `2df56d1`, exit codes read from files, never piped)

`PORTICO_TEST_DB_PREFIX=review_migration`, `DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres`. `main` later moved
to `0b108b6` (docs only — no code file changed), so no re-merge was needed.

| Command | Exit | Notes |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm lint` (= `biome check . --error-on-warnings && node tools/check-boundaries.mjs`) | 0 | 877 files, no fixes; module boundaries OK (11 modules) |
| `pnpm turbo run typecheck --force` | 0 | 19/19 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | **1** | `@portico/api#test` failed: `test/rates.test.ts` "prices every demo property … right after seeding" **timed out (30 s)**; turbo stopped, so 11/17 tasks ran (migration did not run). Load average was 22 (three reviews in parallel) |
| `pnpm turbo run test --force --concurrency=2 --continue` (re-run) | 0 | 17/17 tasks, 0 cached, 4 m 36 s; migration 95/95, api 72/72 |
| `apps/api: vitest run test/rates.test.ts` × 3 | 0, 0, 0 | 3/3 each; flake rate 1 in 5 runs → R-P3-11 (not this branch's code) |
| `node tools/parity-report.mjs --gate migration` | **1** | "P0 not tested: PAR-MIG-004, PAR-MIG-005, PAR-MIG-012" (disclosed by the builder) → R-P2-9 |
| Review PoCs `zz-review-domain.test.ts` + `zz-review-integration.test.ts` | 0 | 14 + 6 tests, all asserting the defects |
| `zz-review/xlsx-oom.ts ZZZZZ 40` (child process) | **134** | `FATAL ERROR … JavaScript heap out of memory` from a 939-byte workbook (R-P1-1) |

## 3. The builder's claims, verified

Quoted from the builder's report (chronicle `20261107T2200-build-migration-module-increments-1-2.md`, § Report).

| Claim (verbatim) | Verdict | Evidence |
|---|---|---|
| "All gates were run on the merged tree … `pnpm turbo run test --force --concurrency=2` (17/17 tasks) 0" | **Holds on re-run**; first run failed on a load-dependent api flake outside this module | § 1 |
| "Zero duplicate reservations — Tested. The guard is a database unique key on the import ledger … Covered: re-run, crash resume, five racing importers, delta sync, post-capture sweep, the trial rehearsal." | **Partly false.** Within one ledger namespace and one key spelling it holds (mutant M1 is killed by 11 tests). The sweep imports re-keyed copies (R-P1-5), a second adapter re-imports everything (R-P1-7), and reconciliation cannot see duplicates (R-P1-3) | PoCs R-P1-5, R-P1-3 |
| "Reconcile exactly twice before cutover … The comparison is against read-backs from the owning modules, not against what migration sent." | **Partly false.** Read-backs are used, but only looked up by source key; nothing on the Portico side is counted on its own (R-P1-3). And the cutover can run data the trial never reconciled (R-P1-2) | PoCs R-P1-3, R-P1-2 |
| "0 cutovers with open blocking exceptions" | **Holds** (and over-holds: decided exceptions block forever, R-P1-4) | PoC R-P1-4 |
| "Before the switch the old system is the system of record and Portico is read-only." | **Holds from `planCutover` on** (not from job creation); one person can trigger it and cancel does not undo it (R-P2-1) | code-read |
| "The switch is a platform authority transition approved by a second person." | **Holds** (platform `segregation_of_duties`; guesthouse step 4). Rollback also needs a second person (charges/payments/accounting/availability are second-approver domains) | code-read + builder test |
| "The production gate checks: live environment, rehearsal certificate, unchanged plan, all seven steps, an authorization by a person other than the creator (it expires), the approved switch, zero open blocking exceptions, a clean final capture, and the platform activation scope." | **Holds as a list at freeze time**, but the certificate is not bound to the data (R-P1-2) and nothing is re-checked before the irreversible switch (R-P2-2). Mutant M2 (authorization check removed) is killed | PoCs; § 5 |
| "A refused gate changes nothing and is audited." | **Holds for the owning modules and platform** (no freeze, no import; `migration.cutover.refused` audited in the committed transaction). Migration's own state does change (a `final` extract, quality findings, certificate copy) — acceptable, but say so | code-read `cutover.ts:322-428` |
| "a two-person rollback that erases nothing" | **Holds** for Portico data; the worklist it hands over is wrong both ways (R-P2-3) | PoC R-P1-5 tail |
| "Any card number in any cell refuses the whole upload; nothing is stored and the refusal is audited with row and column only." | **False** for ordinary spellings (R-P0-1); headers never scanned | PoC R-P0-1 |
| "Masked-value detection: a record with a masked name waits; an export with more than 20 % masked names is refused as a whole." | Holds for runs of `*`/`•`/`#`/`X`; single-character masks pass (R-P3-6) | code-read |
| "XLSX reader has no dependency" (README: "ZIP64 and encrypted workbooks refused", csv.ts "bounded so a hostile file cannot exhaust memory") | **False as a safety claim** (R-P1-1) | child-process PoC |
| "Source personal data is purged 30 days after a migration ends … and a guest's data export includes what a migration still holds." | **False for the trial copy** and for `failed` jobs (R-P1-6) | PoC R-P1-6 |
| "Money decisions belong to finance — yes" (§5) | **False after the switch** (R-P1-8); true before it for import-as-is and tax mappings | PoC R-P1-8 |
| "Freeze ≤ 15 min … under 1 minute, and the test asserts it. Still a TARGET for real sources." | Holds as stated (honest TARGET) | builder test |
| "**The parity gate fails** … 3 P0 rows are still 'building'" | **Holds** (honest) | § 1 |
| §5 mutation table rows "One Portico record per source key … yes (ledger skip removed)" and "Production gate holds … yes (authorization check removed)" | **Reproduced** — both mutants killed (§ 5) | § 5 |

## 5. Mutation check (v3 "verify the proof")

Run on the merged copy by `rvmig/mutants.sh`; each mutant applied alone, the source restored with `git checkout` after
each (`git status --short src` clean apart from review files).

| Mutant | Change | Tests run | Result |
|---|---|---|---|
| **M1** (builder §5 row 1) | `importer.ts:302-305` — delete `if (imported && ledger.importedHash === hash) { summary.unchanged++; return; }` | `rehearsal`, `concurrency-interruption`, `scenario-simulator-drill` | **Killed** — exit 1, 11 tests fail (e.g. "running again (and again) creates nothing: zero duplicate reservations", "a crash inside the reservations import …") |
| **M2** (builder §5 row 3) | `domain/cutover.ts:143-147` — the `production_authorization_missing` blocker removed | `production-gate`, `src/domain/reconcile.test.ts` | **Killed** — exit 1, 2 tests fail ("without a valid authorization the cutover does not start …", "lists each blocker in plain language") |
| **M3** (mine; the guard I judged riskiest for rule 12: the simulator refused in live **at extraction time**) | `extract.ts:429-433` — the `simulator_not_in_live` throw removed; `createJob`'s refusal kept | whole module (113 incl. review PoCs) + `apps/api` `migration` and `integration` tests (7) | **Survived** — exit 0 / 0 → R-P3-8. Only `createJob`'s refusal is tested; the extraction guard (the one that would matter if an organization's environment ever changed mid-job, AP-19) has no test |

## 4. Coverage declaration

### Checklist items 1–15

| # | Item | Result |
|---|---|---|
| 1 | Tenant isolation | **probed — clean.** 12 tables, each `core.enable_tenant_isolation` (code-read `0001_migration.sql`); no cross-module FKs; `safety-isolation.test.ts` cross-tenant reads; the rehearsal bridge refuses a foreign trial (`trialContext`, builder test) and runs inside the trial with RLS. The definer function returns tenant ids only (payments uses the same `platform.tenant_environment` pattern) |
| 2 | Authorization | **probed — finding R-P1-8, R-P2-1.** Every route reaches `loadJobFor`/`requirePermission` (enumerated `routes.ts`); catalogue and templates deny by default; the API permission-catalogue test passes. Delegation issues are in R-P1-8 (sweep posts money with `job.manage`) and R-P2-1 |
| 3 | Money & finance principles | **probed — finding R-P1-8, R-P1-3, R-P3-3, R-P3-4.** Integer minor units, amounts never rounded (`parseMoney` refuses extra decimals), declared taxes carried verbatim (S18), posted once per ledger key; deposit liability vs suspense in finance |
| 4 | Idempotency & concurrency | **probed — clean for duplicates within a namespace (mutant M1 killed); finding R-P3-1, R-P3-2, R-P3-5, R-P3-12.** Unique ledger key + row lock + job lock; five-importer test genuinely concurrent per builder (not re-proven beyond M1) |
| 5 | Events & audit | **probed — finding R-P2-3.** Events carry ids/statuses only (builder test); refusals audited (card refusal in its own transaction, gate refusal committed); journal consumer idempotent per (job, event) |
| 6 | Contracts | **code-read — clean with notes.** Ports match providers on `main` where bound (composition typechecks); MIG-CR-1/3/4/5 have no provider (503 stubs); R-P1-3's fix needs MIG-CR-1 `listImported` widened (cross-module note) |
| 7 | Data authority & environment safety | **probed — finding R-P2-1, R-P3-8.** Simulator refused in live at `createJob` and extraction (the latter untested: M3 survived); rehearsals refuse live (`rehearseHere`); trial context forced to `trial`; fakes call `assertWritable` |
| 8 | Errors & UX contract | **probed — finding R-P2-5 (advice deletes a booking), R-P2-8 (closed-looking exceptions), R-P1-1 (500 on hostile XLSX).** Other messages explain problem + recovery |
| 9 | Spec coverage | **code-read** — § 6 |
| 10 | Scenario claims | **probed** — § 6 |
| 11 | Honest readiness | **code-read — clean with corrections.** Everything ≤ R3, vendor layouts "unverified", fakes named; the specific overclaims are in § 3 and R-P2-9 |
| 12 | Code quality | **probed — clean.** No `any`, no default exports, no `new Date()` without an argument in `src`, no logging calls, pure domain in `src/domain`, migration append-only friendly (one file) |
| 13 | One-product experience | **code-read — clean.** Jobs and exceptions return `status`, `allowedActions` with reasons, `issues`, `owner`, `links`; `migrationSearch` checks `migration.job.read` per property; summaries hold codes and keys, no guest data |
| 14 | Competitive parity gate | **probed — finding R-P2-9** (gate exit 1; 6 `tested` rows disproved; missing rows listed) |
| 15 | Cross-module coherence | **probed — notes in § 7** (PAN detection duplicated in payments with the same greedy flaw; CSV parsing duplicated in integration; `MigratedDomain` copy pending FR-MIG-1) |

### Patterns A–E (F not applicable: no UI in this branch)

| Pattern | Result |
|---|---|
| AP-01 cross-property reference | probed — clean: `loadJobFor` checks the job's property; exceptions checked at the row's property; the trial property re-resolved inside the trial; mapping targets resolved at the job's property (`plan.ts:113-127`) |
| AP-02 per-table isolation | code-read — clean (12/12 tables; builder isolation tests). Not re-run with a `nobypassrls` owner (round-1 addition): the definer function only routes tenant ids |
| AP-03 claimable external identifier | not applicable — migration registers no external identifier (a trial link is checked against platform's trial record) |
| AP-04 trust attribute from client | probed — finding R-P2-3 (client `X-Request-Id` decides journal exclusion); the certificate/evidence is server-side, but not bound to data (R-P1-2) |
| AP-05 ungated endpoint | probed — clean (all 30 routes enumerated; `sources`/templates `requireAnyRead`) |
| AP-06 permission not registered | probed — clean (API `permission-catalog.test.ts` green on the merged copy) |
| AP-07 org controls global credential | not applicable — no credential handling |
| AP-08 pre-hijacking / reverse order | probed — R-P1-7 in reverse order: staff (or a first migration) create the bookings first, the migration imports later → duplicates; between job creation and `planCutover` live is writable |
| AP-09 privilege equivalence | probed — finding R-P1-8 (`job.manage` → bookings and opening balances in live after the switch), R-P2-1 (`cutover.execute` → read-only for 8 domains); `production.authorize` + another person ≡ `platform.dataAuthority.manage` (by design, documented) |
| AP-10 separation of duties by one person | probed — clean for creator≠authorizer and planner≠approver (platform); finding R-P3-9 (second account created/granted by the creator) |
| AP-11 step-up bypass | code-read — `authorizeProduction` refuses non-user actors; `planCutover` (restricting) accepts API clients (part of R-P2-1) |
| AP-12 rate limits | not applicable — no counters or codes |
| AP-13 XFF spoofing | not applicable — no per-IP control |
| AP-14 SSRF | not applicable — no outbound HTTP (simulator via port) |
| AP-15 secrets persisted | code-read — clean; no secrets; idempotency bodies are job views (no guest data) |
| AP-16 shared-device state | not applicable — no UI |
| AP-17 personal data after erasure | probed — finding R-P1-6 (trial copy kept forever); per-subject erasure is a documented gap (MIG-CR-2) |
| AP-18 privacy bypass via secondary path | code-read — search summaries and journal hold no guest data; guest export includes migration rows but not the trial copy (R-P1-6) |
| AP-19 simulator in live / env change | probed — mutant M3 survived (R-P3-8); refusals present at create, extract, rehearse |
| AP-60 stored control fact on one path | probed — finding R-P2-2 (authorization enforced at freeze, not at the switch) |
| AP-53 delegated effect parameters | probed — finding R-P1-8 (sweep: amounts and terms from the file, authority from `job.manage`) |
| AP-20 concurrent over-correction | code-read — clean: opening balances under the job lock, one claim per key |
| AP-21 same-key retry | code-read — clean (ledger unique key; finance `importRef`) |
| AP-22 agreed terms honoured | code-read — terms verbatim to the provider (fake enforces rule 2); real provider absent (MIG-CR-1) |
| AP-23 boundary money | probed — clean: 1 minor unit (builder S18), too-precise amounts refused, zero/negative deposits blocked |
| AP-24 tax base | code-read — clean: declared deposit tax carried with a finance-reviewed account; no recomputation |
| AP-25 limits/adjustments | not applicable — no limits |
| AP-26 uncertain outcome shown definite | code-read — card requests depend on MIG-CR-5 (two-phase in the contract); R-P2-8 is the UX variant |
| AP-27 net-of-fee settlement | not applicable |
| AP-28 same money twice | probed — finding R-P1-8 (a second, file-driven deposit path after the switch) |
| AP-29 time semantics | probed — finding R-P2-6 (1904 dates, DOB); business date used for history vs future; rollback window closed by a job (no lazy expiry) |
| AP-30 dedupe before effect | code-read — clean: journal insert is the effect and the dedupe in one statement |
| AP-31 out-of-order overwrite | probed — R-P3-2 (stale chunk overwrites a newer version); the fake accepts any newer `sourceVersion` without ordering |
| AP-32 valid state crashes consumer | code-read — clean: `journalEvent` returns false on unknown property/job |
| AP-33 stale offline write | not applicable |
| AP-34 replay after resume | code-read — runs resume by step; lease not renewed (R-P3-12); the switch is re-entrant (`switchedAt` check) |
| AP-35 unknown value fails open | probed — clean for statuses, adapters, table kinds, guarantees (unknown → decision or `unknown`) |
| AP-36 read before lock | probed — R-P3-2, R-P3-5 (lock-order inversion) |
| AP-37 external effect in tx | code-read — card request port called in the transaction; contract requires two-phase (MIG-CR-5) — re-check when bound |
| AP-38 data authority bypassed | probed — R-P2-1; imports after the switch only; fakes assert writability |
| AP-39 duplicate insert aborts tx | code-read — clean (`on conflict` everywhere; savepoint in `createJob`) |
| AP-56 one-time transition races writers | probed — R-P2-2 (gate not re-evaluated at the switch); platform freeze blocks writers during the transition |
| AP-59 external holder keeps acting | code-read — after a rollback, card re-collection links already sent stay live at the provider (MIG-CR-5 should cancel them); noted for the provider contract |
| AP-40 port vs provider | code-read — bound ports typecheck; MIG-CR providers absent |
| AP-41 fake more lenient | code-read — `FakeReservations` does not check guest-profile visibility or unit ownership (rule 5) and accepts out-of-order versions; acceptable until MIG-CR-1, list in the contract tests |
| AP-42 enum copied | code-read — `MigratedDomain` subset (FR-MIG-1, disclosed) |
| AP-43 event payload drift | not applicable — no consumer of migration events yet; the journal reads envelopes only |
| AP-44 save weaker than use | probed — clean: mapping targets validated at save against inventory/rates/finance |
| AP-45 sibling paths | applied — every finding names its siblings (e.g. R-P1-2: final capture via `cutover/start`, simulator final capture, sign-offs) |
| AP-46 failure path commits partial state | probed — gate refusal leaves migration's own `final` extract (§ 3, acceptable); card refusal stores nothing (but R-P0-1) |
| AP-47 refusal weaponized | probed — R-P2-1 (read-only for 8 domains by one person); one open job per property can be held by any `job.manage` (cancel is the recovery) |
| AP-48 effective-dated bounds | not applicable — no tax or rate rules evaluated (amounts verbatim) |
| AP-54 load-bearing check | applied — R-P1-4's fix makes "exclude by decision" the way to leave a record behind → re-rated in that fix (decision-maker for future/in-house bookings and money; decisions bound into the certificate, R-P1-2) |
| AP-57 premise writers | applied — R-P1-2: the certificate's premise (the data) is written by any `job.manage` upload after certification |
| AP-58 lifecycle closure | probed — R-P2-8 (closed exceptions never re-open), R-P1-6 (trial job never ends) |
| AP-50 claim backed by asserting test | probed — § 3 claim ledger |
| AP-51 scenario proven against fakes | code-read — disclosed (reservations, in-house, AR, cards are fakes); scenario readiness stays R3/"measured in tests only" |
| AP-52 gate integrity | probed — § 1 (exit codes, `--force`, `--continue`, flake re-runs); parity gate fails |
| AP-61 dead-man's switch | probed — R-P2-7 |
| AP-62 recorded default vs code | probed — R-P1-6 (Q162 a); Q142/Q143/Q144 defaults match the code |
| AP-55 test exercises without asserting | probed — mutants M1/M2 killed; M3 survived (R-P3-8); no decided-exception test reaches the freeze (R-P1-4) |

**Totals:** 61 patterns in A–E; **50 applicable** — 28 probed, 19 code-read, 3 applied as review steps (AP-45, AP-54,
AP-57); **0 applicable left unprobed**; 11 not applicable (AP-03, 07, 12, 13, 14, 16, 25, 27, 33, 43, 48 — reasons above).
Group F (18 UX traps) not applicable — no UI in this branch.

## 6. Spec coverage and scenario claims

**Spec (INT-R29–R34, M0–M10, 10x brief increments 1–2).**

| Requirement | State |
|---|---|
| INT-R29 / M0 source assessment, feasibility sign-off | assessment shown; sign-off record not built (disclosed) |
| INT-R30 pipeline "re-run until accepted" | built; the last export before the freeze is never re-run in the trial (R-P1-2) |
| INT-R31 never silently discard; every record in exactly one state | holds per key; second rows with the same key are blocked with advice to delete one (R-P2-5); XLSX DOB < 1980 dropped silently (R-P2-6) |
| INT-R32 / S18 opening balances | deposits real, in-house/AR on fakes (disclosed); sweep path posts without finance (R-P1-8) |
| INT-R33 / M7–M9 cutover, freeze, rollback | built; gate once (R-P2-2); worklist (R-P2-3); read-only side effects not undone (R-P2-1) |
| INT-R34 exit export; M10 archive | not built (disclosed) |
| M1 preview before storage | built; skipped for final/sweep uploads (R-P2-4) |
| M2 quality checks | built; not run in the sweep (R-P1-5) |
| M4 reconciliation exact | one-directional (R-P1-3) |
| M5 decisions with owners | built; decided exceptions can never reach a cutover (R-P1-4) |
| M6 final capture, sweep | built for the simulator; files: final capture unrehearsed (R-P1-2), sweep duplicates (R-P1-5) |
| MG-02 card numbers | bypassable (R-P0-1) |
| 10x increment-1 acceptance "re-running the import creates 0 duplicates" | holds (M1 killed) |
| 10x increment-2 acceptance "rollback keeps every post-cutover booking and payment" | holds for Portico data |

**Scenario claims.**
- `scenario-guesthouse-same-day` — real platform, inventory, guests, finance deposits; reservations, in-house/AR and
  cards are strict fakes (disclosed, "measured in tests only"). It proves the happy path only with perfectly clean
  data: no decided exception, no change after certification. Both untested branches fail (R-P1-4, R-P1-2).
- `scenario-simulator-drill` — sandbox; delta sync and sweep demonstrated; the drill does not check what its rollback
  worklist contains (R-P2-3 a) or that the sweep validates (R-P1-5).
- `scenario-s18-opening-balances` — 1-minor-unit difference, no double tax, orphan deposits: hold. "Finance may decide
  import as is; then imported once" holds inside a rehearsal job only; it cannot reach a production cutover (R-P1-4).
- `rehearsal.test.ts` MG-08 "every source record ends in exactly one state" — holds per key; the report cannot see
  Portico-side extras (R-P1-3).

## 7. Cross-module notes for the orchestrator

| Owner | Note | Proposed pending-fixes line |
|---|---|---|
| payments + migration (shared code) | `payments/src/domain/pci.ts:28-35` `containsPossiblePan` has the same greedy one-match flaw as R-P0-1 (`4111 1111 1111 1111 12/27` passes), and it guards what is stored for audit from provider payloads. One PAN detector belongs in `@portico/kernel` (sliding window, Unicode digits, separators), used by both | "kernel: shared PAN detector; payments `scrubCardData` and migration `findCardNumbers` switch to it (R-P0-1)" |
| reservations (MIG-CR-1) | R-P1-3/R-P1-7 need `listImported` (or a new read) to return **all** bookings at the property in the window with their source system and key, and the provider to accept migration's normalised source key | "MIG-CR-1: read-back of all bookings at the property; key normalisation rule" |
| packages/http | `X-Request-Id` (client-chosen) becomes `ctx.correlationId`; any module that treats the correlation id as proof of origin is spoofable (migration journal, R-P2-3 b) | "http: document correlationId as untrusted; migration stamps its own writes" |
| platform | `setDataAuthority` lets a module (as system process) restrict any domain with no approval and no automatic reversal; a restriction of a domain already operated in Portico should need the same approval as moving it back (R-P2-1) | "platform: approval for restricting an active domain; module-initiated restrictions reversible" |
| integration | migration ships its own CSV parser and XLSX reader; integration has `domain/csv.ts` and `connectors/file-csv.ts`. Shared file-ingest (limits, card scan, encoding checks) would fix R-P0-1/R-P1-1 once | "packages: shared file ingest (CSV/XLSX) with limits and PAN scan" |
| identity (FR-MIG-2) | role templates; R-P3-9 provenance-of-grant for `migration.production.authorize` | — |
| guests (MIG-CR-2) | erase hook; the trial copy must be reachable by the guest's export/erasure (R-P1-6) | "guests: erase hook covers trial copies made by migration" |
| rates/api | flaky `apps/api/test/rates.test.ts` demo-seed test under load (R-P3-11) | "api: rates demo-seed test flake (1/5 at load 22)" |

