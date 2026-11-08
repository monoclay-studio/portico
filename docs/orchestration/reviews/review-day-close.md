# Steward review — day-close (night audit / business-date close)

## Verdict: **merge after fixes**

Blocking before merge: **DCL-P0-1, DCL-P0-2, DCL-P1-1**. Strongly recommended before merge: **P2-1** (FR-3 asks the
kernel to adopt a DST correction that is wrong west of UTC), **P2-6** (guest names written into an append-only
table cannot be removed later), **P2-9** (the gate is flaky under default concurrency). The rest are tracked
follow-ups. Re-review the fix round (playbook "focused re-review"), because both P0 fixes change how lines are
identified and granted.

The engine itself is sound: the lease/heartbeat fencing, the one-transaction advance, the integrity gate and
tenant/property isolation held under every attack I ran (§ 3). The defects are in **what gets posted when the stay
changes after a night closed**: deferred lines, the pre-grant and the catch-up all trust an earlier picture of
the stay.

| | |
|---|---|
| **Branch / commit reviewed** | `feat/day-close` @ `cb0fbf33d31118be1e3c8b979713b6d38f7047e4` (unchanged at the end of the review) |
| **Scratch copy** | detached worktree of `cb0fbf3` merged with `main` @ `2df56d1` (local merge `d2726cc`, clean). `main` moved to `0b108b6` during the review (docs only), so no re-merge |
| **Playbook** | steward-reviewer v2.1 (launch brief v2), plus the queued v3 items the brief asked for (gates with `--force`, exit codes, default-concurrency run; mutation spot-check) |
| **Counts** | **P0 2 · P1 1 · P2 14 · P3 12** |
| **Patterns** | 61 in groups A–E: **44 applicable** (16 probed, 26 code-read, 2 applied as review steps: AP-45, AP-54); **0 applicable left unprobed**; 17 not applicable (reasons in § 1). Group F not applicable (no UI review) |
| **Mutants** | Builder's **M2** (heartbeat lease-owner check) **killed**, **M16** (advance completion in the same transaction) **killed**; my **R1** (seal check in the pre-grant) **survived** → P2-8 |
| **PoCs** | `docs/orchestration/reviews/day-close-poc/*.test.ts.txt` (§ 9) |

### Top findings

1. **P0-1** — a cancelled seaplane (stay extended after the last night closed) charges the departure transfer **twice**; a shortened stay **never** charges it (deferred lines and posted nights are not reconciled with re-sealed terms).
2. **P0-2** — the next night's allowance is pre-granted before the night exists: an early departure is billed USD 128.70 for a night not stayed (forfeited to breakage); an occupancy correction makes the night unpostable and the only recovery skips the room charge.
3. **P1-1** — a night overridden "to be posted by hand" (the module's own advice) is posted again by the next close's catch-up: two room charges.
4. **P2-1** — the FR-3 DST fix schedules (and allows) a close an hour **early** in every zone west of UTC.
5. **P2-2 / P2-3** — a guest checked in after the sweep and gone before the next close is never charged and nothing says so; the day facts are frozen before the sweep's postings (ADR halved in the probe) and the annex calls ordinary postings "restatements".

---

## 1. Coverage declaration

### Checklist (launch brief items 1–15)

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation | **probed — clean.** `R-RLS`: 11/11 `day_close` tables have `tenant_id`, RLS enabled **and forced**, one policy; another tenant's raw `SELECT` on each table returns 0 rows. No cross-schema FKs (references only) |
| 2 | Authorization | **probed — clean** for scope (`R-SCOPE`: 15 service entry points refuse a person with `dayClose.*` at property A acting on property B; portfolio shows A only). **Finding P2-12** (privilege equivalence), **P3-7** (composition `markNoShow` check untested) |
| 3 | Money & finance | **probed — findings P0-1, P0-2, P1-1, P2-3, P2-10, P2-11, P2-13** |
| 4 | Idempotency & concurrency | **probed — clean** for leases and the advance (`R-LEASE`, builder M2/M16 killed, concurrent starts/resumes tested); **finding P0-2** (a key re-sent with changed inputs), **P3-1** (version churn vs `If-Match`) |
| 5 | Events & audit | **probed — finding P3-1** (audit row every minute), **P3-8** (payload schemas not exported); events once per date verified by builder tests |
| 6 | Contracts | **code-read — clean** (typecheck against real providers; documented subsets FR-2/FR-4); **P3-3** (record route); cross-module notes § 8 |
| 7 | Data authority & environment safety | **code-read — clean** (start and preflight refuse external `reservations`/`charges`; finance asserts `charges`; notification mode from `assertExternalEffectAllowed`; builder tests both) |
| 8 | Errors & UX contract | **code-read — findings** P0-2 (409 ⇒ "retryable" for a deterministic conflict), P1-1 (harmful recovery advice "post the night by hand"), P3-6 |
| 9 | Spec coverage | **code-read — findings P2-5** (MUST "schedule ≥ earliest start"), **P2-13** (S10), **P3-11** (R01 sources, cancellations) — § 4 |
| 10 | Scenario claims | **assessed — P2-10** (S19 bakes in the post-check-out transfer); S09/S04/E07 hold at module level (§ 5) |
| 11 | Honest readiness | **probed — findings P2-2, P2-6, P2-14, P3-6** (overclaims); levels never exceed R3 |
| 12 | Code quality | **code-read** — lint clean, no `any`, no default exports, no clock reads in `src/domain/`; dead code P2-11 (`levy_not_posted`), P3-12 |
| 13 | One-product experience | **code-read** — run view carries status, allowed actions with reasons, issues, owner, links; **P3-3** (report record route does not exist) |
| 14 | Parity gate | **probed — P2-14** (gate exit 1, 11 P0 rows; 2 `tested` rows overclaim) |
| 15 | Cross-module coherence | **code-read** — § 8 (`actorKey` duplicated in 10 modules; rates line identity; finance late-posting stamp) |

### Patterns (groups A–E)

| Pattern | Status |
|---|---|
| AP-01 cross-property reference | probed — clean (`R-SCOPE`; `postStayNight` refuses another property's stay; composition `markNoShow` check code-read, P3-7) |
| AP-02 cross-tenant by id | probed — clean (`R-RLS`) |
| AP-03 claimable external id | not applicable — Day Close holds no external identifiers |
| AP-04 client-declared trust attribute | code-read — clean (`trigger` from the actor; `businessDate` must equal current; override keys validated) |
| AP-05 ungated secondary endpoint | probed — clean (`R-SCOPE`; search provider filters by `propertyScope`) |
| AP-06 permission not registered | code-read — clean (8 keys in the manifest; builder's catalogue test green) |
| AP-07 org controls a global credential | not applicable — no credentials |
| AP-08 reverse order | probed — P3-9 (a manual run created first pre-empts auto-continue); P0-1 attacked both orders (extend / shorten after the close) |
| AP-09 privilege equivalence | code-read — **P2-12** (`dayClose.policy.manage` ⊇ advance via the schedule; `dayClose.run.read` ⊇ finance payer names) |
| AP-10 separation of duties | not applicable — the spec requires none for overrides (overrides need a sensitive permission and a reason) |
| AP-11 step-up windows | not applicable — identity's concern; sensitive flags set |
| AP-12 rate limits | not applicable — no rate-limited surface |
| AP-13 XFF | not applicable |
| AP-14 SSRF | not applicable — no outbound HTTP |
| AP-15 secrets | code-read — clean (none stored or logged) |
| AP-16 shared device | not applicable — no UI |
| AP-17 data after erasure | probed — **P2-6** (`R-PII`) |
| AP-18 privacy via secondary path | code-read — P2-12 (readiness passes finance prose to `dayClose.run.read`) |
| AP-19 simulator in live | code-read — clean (notification mode; builder demo test) |
| AP-60 control fact on one path | probed — **P1-1** (overrides not honoured by the catch-up) |
| AP-53 delegated effect parameters | code-read — clean (stays from reservations' property-scoped lists; amounts from sealed terms; fee = reservations' penalty); see P2-5 for *when* |
| AP-20 over-correction race | not applicable — no remaining-amount corrections |
| AP-21 retry duplicates | probed — **P0-1, P1-1** (different keys); same-key retries clean (chaos, M16) |
| AP-22 agreed terms not honoured | probed — **P0-1** |
| AP-23 money boundaries | code-read — clean (Decimal KPIs, builder boundary tests); zero amounts → P2-11 |
| AP-24 tax base / time of supply | code-read — P2-10, P2-13; EC-DCL-016 untested (README admits) |
| AP-25 limits | not applicable |
| AP-26 uncertain shown as definite | code-read — clean (collection outcome recorded as given; the run never claims "paid") |
| AP-27 net-of-fee settlement | not applicable |
| AP-28 collected twice | code-read — clean (one path, key `noshow-fee:{stay}`; follow-up only when nothing was requested) |
| AP-29 time semantics | probed — **P2-1, P2-5**; `R-TZ` (two time zones) clean |
| AP-30 / AP-31 / AP-32 / AP-33 event consumers, offline writes | not applicable — Day Close consumes no events and has no offline client (aggregate versions are set) |
| AP-34 replay after resume | probed — **P0-2**; `R-LEASE` clean |
| AP-35 unknown value fails open | code-read — P3-4 (unknown policy codes accepted); unknown tax-inclusion mode refused ✓ |
| AP-36 read before lock | code-read — clean (claim, cancel, override lock then read; start relies on unique indexes) |
| AP-37 external effect inside the tx | code-read — clean (outbox events; collection/export are provider requests) |
| AP-38 data authority bypass | code-read — clean (builder tests both domains) |
| AP-39 concurrent duplicate insert | code-read — clean (issue upserts serialized by the run row lock; `ON CONFLICT DO NOTHING` on runs, facts, reports) |
| AP-56 transition races in-flight writers | probed — **P2-4** (the advance vs postings in flight, FR-1) |
| AP-59 external copy keeps acting | not applicable today — collection and journal export are stubs (noted in P2-4 for the export) |
| AP-40 port vs provider | code-read — clean (typecheck in composition) |
| AP-41 lenient fake | code-read — P3-10 |
| AP-42 copied enums | code-read — clean (documented subsets; kernel-derived `module_not_available`) |
| AP-43 payload drift | code-read — P3-8 |
| AP-44 save weaker than use | probed — **P2-5**, P3-4 |
| AP-45 sibling paths | applied to every finding |
| AP-46 failure path commits partial state | code-read — P3-2; item failures roll back effects ✓ |
| AP-47 weaponized refusal | code-read — clean (no third party can create a blocker; `policy_invalid` is fixable by the property's policy manager) |
| AP-48 effective-dated bounds | not applicable |
| AP-54 load-bearing | applied (P0-1 ↔ P1-1; P2-4 ↔ P2-3; P2-10 ↔ P0-1) |
| AP-57 premise writers | code-read — P0-1 (deferred-line premise), P1-1 (`night_postings` premise) |
| AP-58 lifecycle closure | probed — P0-2 (pre-grant not undone by a shortened stay), P0-1 (extension) |
| AP-50 claim without asserting test | probed — P2-2, P2-6, P2-14, P3-6 |
| AP-51 scenario only against fakes | code-read — clean (README is explicit: reservations fake; composed runs blocked-by-binding) |
| AP-52 gate integrity | probed — **P2-9** |
| AP-61 dead-man's switch | code-read — **P2-7** |
| AP-62 recorded default ≠ code | code-read — P2-1 (FR-3 "corrected locally"), P3-4 |
| AP-55 test proves nothing | probed — mutation: R1 survived (P2-8); M2, M16 killed |

---

## 2. Command results (scratch copy, exit codes from files, `PORTICO_TEST_DB_PREFIX=review_dayclose`)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` (`biome check . --error-on-warnings` + boundaries) | exit 0 (re-run into `scratchpad/gates-dayclose/` after the orchestrator's heads-up about the shared `scratchpad/gates/` folder: exit 0, 863 files, boundaries OK; my results never used that folder) |
| `pnpm turbo run typecheck --force` | exit 0 (re-run: exit 0, 19/19, 0 cached) |
| `pnpm turbo run test --force --concurrency=2` | **exit 0** — 17/17 tasks, 0 cached, 5 m 58 s; day-close 11 files / 87 tests, api 18 / 71 |
| `pnpm turbo run test --force` (default concurrency), run 1 | **exit 1** — day-close: S09 "resumes at the remaining 45…" and "a day with nothing blocking…" **timed out at 60 s**; api: the tracked demo-seed flake (`rates.test.ts` › "prices every demo property…", 30 s). Machine: 4 cores, load average ≈ 12 (other reviews running) |
| same, run 2 | exit 0 — but S09 took **43.2 s** of its 60 s (builder: 9.4 s; alone: within a 20 s suite) |
| `pnpm turbo run test --force --filter @portico/day-close --filter @portico/api` (default concurrency) | exit 0 |
| day-close alone (`vitest run`) ×3 | 87/87 each (one run reported a missing file because I deleted a probe mid-run — my artefact) |
| `node tools/parity-report.mjs --gate day-close` | **exit 1** — 11 P0 rows not tested (P2-14) |

Flake rate (default concurrency, full workspace): **1 of 2 runs failed**, with **two new day-close timeouts** besides
the tracked api demo-seed flake → P2-9.

### Mutation spot-check (g)

| Mutant | Change | Result |
|---|---|---|
| **M2** (builder) | `repo.ts:82` — heartbeat without `.where('lease_owner','=',owner)` | **killed** — `concurrency` › "a stale executor that wakes up after a take-over…" |
| **M16** (builder) | `steps/index.ts:440-452` — advance-step completion moved out of the advance transaction (`persisted: false`) | **killed** — `chaos-every-step` › "day 22: crash afterItem advance", "day 23…", and the global no-duplicates check |
| **R1** (mine; riskiest unguarded money guard I found) | `steps/postings.ts:248` — seal check removed from the pre-grant | **survived** — 87/87 green → **P2-8** |

---

## 3. What I attacked and what held (focus areas)

- **(a) Zero duplicates after interruption.** *Held:* an executor paused **inside** an item transaction past its
  lease (`R-LEASE`): the take-over waits on the run row lock, sees the committed item, the paused executor gets
  `LeaseLostError`, each `room:` key once. Two starts, two resumes, stale executor, kill -9 in an item and in the
  advance, 24 chaos points (builder tests, re-run green). Advance + completion in one transaction (code + M16).
  *Broke:* retries with **changed inputs** — P0-2 (pre-grant conflict), P0-1 (re-allocated lines), P1-1 (override +
  catch-up).
- **(b) Nobody logged out.** *Held:* bar postings and readiness reads mid-run (builder test); no identity port, no
  global lock (code). *Broke:* check-in after the sweep (P2-2); the late charge for D after the advance never
  reaches D's report (P2-13); FR-1 residual is bounded but not visible (P2-4); frozen facts miss the last postings
  (P2-3).
- **(c) Business date, DST, time zones.** *Held:* two properties (Malé, New York) fire at their own 02:00 and
  advance independently (`R-TZ`). *Broke:* FR-3's local DST fix west of UTC (P2-1); a daytime close is allowed by
  default (P2-5).
- **(d) Integrity never overridable.** *Held* (`R-INTEGRITY`): an organization-level `dayClose.policy` written
  straight through `platform.setPolicy` demoting `integrity_failed` / `folio_ledger_mismatch` / `policy_invalid`
  → defaults + non-overridable `policy_invalid` blocker, override refused (`integrity_not_overridable`), date
  unchanged; after an integrity failure: `item:integrity:*` and `item:advance:*` overrides → `nothing_to_override`,
  cancel → `run_not_cancellable`, a new Start returns the same run, resolve → refused (builder test). The DB trigger
  backs DCL-I02. *Honesty:* the "alarm to finance" reaches nobody in finance on main (P3-6).
- **(e) Money.** Room and tax postings from sealed terms with rule versions (S19, my probes show service charge,
  TGST, Green Tax lines). No-show fees: the only collection path is `payments.collectAgreedNoShowFee` (code); on main
  it is a stub and the follow-up "no-show fee to collect" is raised (builder test; code-read of the `DomainError`
  branch). Seal tampering refused in the posting step (builder) but **untested in the pre-grant** (P2-8).
  *Broke:* P0-1, P0-2, P1-1, P2-10, P2-11.
- **(f) Security.** RLS 11/11 forced; 15 entry points × property scope; portfolio scoped; run access by id hidden
  across properties. `markNoShow` composition check untested (P3-7). PII into append-only report (P2-6).

---

## 4. Spec coverage summary (MUST items)

| Spec | Status |
|---|---|
| DCL-R01 readiness | built; sources partly missing (P3-11) |
| DCL-R02 steps 1–9 | built; payments housekeeping honestly skipped (stub); step 7 lacks cancellations, departures, nationality (P3-11, README) |
| DCL-R03 resume | built and well tested |
| DCL-R04 non-blocking / cut-over | built; I04 hole (P2-2); FR-1 detection weak (P2-4); late charges invisible in D's report (P2-13) |
| DCL-R05 scheduler | built; "≥ earliest start" not enforced (P2-5); DST west of UTC (P2-1); no dead-man's switch (P2-7) |
| DCL-R06 one active run | built and tested |
| DCL-R07 immutable report + annex | built; annex noisy (P2-3) and blind to late postings (P2-13); PII in the pack (P2-6) |
| DCL-R08 / R09 (SHOULD) | built as data and notification requests; delivery needs comms (R1, honest) |
| DCL-I01 | holds for same-key retries; violated in intent by P0-1 / P1-1 (different keys) |
| DCL-I02, I03, I05 | hold (I03 freezes wrong numbers, P2-3) |
| DCL-I04 | does not hold for departed stays (P2-2) |

## 5. Scenario-claim assessment

- **S09** (`scenario-s09…`): genuinely demonstrates 67/112 progress, exactly-once resume (90 finance calls),
  balanced books mid-run and at the end, audit of the recovery. Module level, reservations fake (honest).
- **S04** (Day Close part): routing as previewed — holds.
- **S19** (Day Close part): postings, taxes and breakage hold; but the test **asserts as correct** two behaviours I
  rate as defects — the pre-grant (P0-2) and the departure transfer posted after check-out (P2-10).
- **E07**: holds (24 crash points; kill -9).

## 6. The builder's claims, verified

| Claim (builder report, verbatim or close) | Verdict |
|---|---|
| "87 module tests in 11 files and 2 HTTP tests" | **true** (gate logs) |
| "Resume sends exactly 90 calls to finance (45 × 2)…books balance mid-run and at the end" | **true** (asserted in S09; re-run green) |
| "Real `kill -9`…Chaos test: 24 crash points…No ledger key appears twice" | **true** for same-key effects; **not** for re-allocated lines (P0-1) |
| "Each item's progress commits in the same transaction as its effects…A dead executor's lease must expire before anyone else can take over" | **true** (`R-LEASE`, M2 killed) |
| "The advance commits together with its step completion" | **true** (M16 killed) |
| "Integrity codes are never demoted or overridden, and an unreadable policy fails closed" | **true** (`R-INTEGRITY`) |
| "RLS on all 11 tables; cross-organization reads refused" | **true** (`R-RLS`) |
| "every route and service function checks a permission" | **true** (`R-SCOPE`) |
| "Nights missed because a guest checked in late are caught up…never silently missed" (README DCL-I04) | **false** for a guest who leaves before the next close (P2-2) |
| "Allowances are…pre-granted for the next night after the advance" | true — and the source of P0-2 |
| "Lines whose service date is later than the night are deferred to the close that reaches that date" | true — and the source of P0-1 / P2-10 |
| FR-3: "returns 02:30 instead of 02:00 in a DST gap (fixed locally)" | **false west of UTC** (P2-1) |
| Self-check item 29 "no guest personal data stored, ids only" | **false** (P2-6) |
| "The day-close tests pass under both concurrency settings" | **false under load** (P2-9) |
| "A failure…raises a blocking alarm" (to finance) | partly — finance cannot see it on main (P3-6) |
| Mutation proof "All are red" (22 mutants) | M2, M16 re-run: **red** ✓. My R1 on a sibling guard survived (P2-8) |
| "The composition `markNoShow` property check is code only and untested" | **true** (honest; P3-7) |
| "P0 rows still open dropped from 57 to 11" | **true** (gate output) |

---

## 7. Findings

### DCL-P0-1 — A package line that re-pricing moves to another night is charged twice or never (deferred lines and posted nights are never reconciled with re-sealed terms)

- **Where.** `modules/day-close/src/service/steps/postings.ts:112-131` (a line whose service date is later than the
  night is snapshotted into `day_close.deferred_lines`), `:297-313` (every pending deferred line whose service date
  has come is posted, whatever the stay's current terms say), `:318-364` (`postDeferred` posts the snapshot),
  `:82` (a night is posted from the terms current at that night's close). The line identity comes from rates:
  `modules/rates/src/domain/terms.ts:86-89` (`inclusion:{stay}:{inclusion}:{allocated night}`, departure-rhythm
  lines are allocated to the *last* night).
- **Problem.** Day Close posts each night from whatever terms are sealed at that night's close and never compares
  the stay's full current plan with what it has already posted or deferred. A re-pricing that moves a line to a
  different night (an extension or a shortened stay moves the departure transfer to the new last night) changes the
  line's key, so neither `night_postings` nor finance's unique key notices.
- **Reproduced** (`day-close-poc/zz-review-money.test.ts.txt` › `R-DEFER`, real rates + finance):
  - AI package, 7→9 Nov, departure seaplane USD 750 on the last night (service date 9 Nov) — deferred at the close of
    8 Nov. On 9 Nov the seaplane is cancelled and front office extends the stay to 10 Nov (exactly what Day Close's
    own blocking message tells them to do, `readiness.ts:168`); reservations re-confirms the price. The close of
    9 Nov posts the stale deferred line (the flight that did not happen); night 9 Nov is posted from the new terms,
    whose departure transfer is deferred again (service 10 Nov) and posted by the close of 10 Nov.
    **Result: three `TRANSFER_SEAPLANE` charges of 75 000 (one arrival, two departures) on the folio.**
  - Mirror case (`R-PREGRANT` early-departure probe, same file): stay 7→10 Nov shortened to 7→8 Nov after the close
    of 7 Nov. The new terms put the departure transfer on night 7 Nov, which is already posted, so **the departure
    seaplane that was flown is never charged** (the folio holds only the arrival transfer).
- **Why it matters.** Money correctness (CLAUDE.md §5 "retries must never duplicate charges"; DCL-I01's intent),
  in the single most common Maldives disruption (weather-cancelled seaplane). Latent on `main` only because no
  composed path can re-price a stay until `feat/integration-step` binds reservations' rates port — the calibration
  rule for latent money defects applies, hence P0.
- **Fix (principle).** *A line of the agreement is posted exactly once, identified by what it is, not by the night it
  happens to be allocated to; whatever is pending or already posted is reconciled against the terms in force before
  anything new is posted.* Instances: departure-rhythm lines, arrival-rhythm lines, added components with their own
  service date, a re-allocated inclusion, allowance lines (see P0-2). Concretely: (1) key departure/arrival-rhythm
  lines by occurrence (`inclusion:{stay}:{inclusion}:departure`, contract change in rates), (2) at each close
  recompute the stay's full plan and cancel pending `deferred_lines` that are no longer in it (and post lines whose
  night is already posted but which are new in the plan, e.g. the shortened stay's departure transfer), (3) put a
  `status in ('pending','posted','cancelled')` + reason on `deferred_lines`.
  **Attack run against the fix:** an extension *after* the deferred line was posted (the transfer charged, then the
  flight cancelled) — the occurrence key makes the second posting a replay or an idempotency conflict, never a
  second charge; the refund of a charged-but-not-flown transfer is a finance correction, not Day Close's.
  **Sibling paths** (same state change "post a plan line"): posting step (`postStayNight`), catch-up items, the
  pre-advance sweep, `postDeferred`, `pregrantAllowances`, reservations' future check-out posting (CR-4) — all must
  use the occurrence identity. **Load-bearing:** the fix relies on rates' plan identity (cross-module contract change)
  and on the catch-up (P1-1 below) not re-posting what the reconciliation skipped.

### DCL-P0-2 — The next night's allowance is pre-granted before that night exists: an early departure is billed for it, and any later correction makes the night unpostable

- **Where.** `modules/day-close/src/service/steps/index.ts:589` (`pregrantAllowances(s, D+1)` after the advance),
  `steps/postings.ts:239-265`, `:197-232` (`grantAllowanceLine` uses the plan key; finance hashes the whole request:
  `modules/finance/src/service/allowances.ts:66-67`, `support.ts:315-319`), `domain/errors.ts:24` (409 ⇒ "retryable").
- **Problem.** Right after the advance to N, Day Close charges night N's allowance to the folio (debit folio /
  credit allowance clearing, **with service charge and TGST**). Nothing ties that charge to the night actually
  happening:
  1. **Early departure** (`R-PREGRANT` › "an early departure…"): stay 7→10 Nov shortened to one night and checked out on
     8 Nov. The folio still carries `ALLOWANCE_DINING` for night 8 Nov: 10 000 + 1 870 + 1 000 (taxes) = **USD 128.70
     for a night that is not part of the stay**, and finance's check-out consumer
     (`finance/src/service/index.ts:736`, `closeAllowances(upTo 9999-12-31)`) forfeits it to **breakage revenue**
     (`breakage:{instance}:2026-11-08` entry).
  2. **Any correction between the pre-grant and N's close** (`R-PREGRANT` › "an occupancy correction…"): one adult
     leaves on 8 Nov and the price is re-confirmed (credit 50 instead of 100). At the close of 8 Nov the posting step
     re-sends the plan key with a different amount → finance `idempotency_conflict` → **the whole night is rolled
     back, room charge included**. The failure is marked `retryable: true` (409), so the scheduler retries it 3× in
     vain, no blocking follow-up is raised (only non-retryable item failures raise one, `postings.ts:430`), and
     resume fails identically. The only way out is the item override, which **skips the room night too**; the next
     close's catch-up then fails on the same key again (asserted). A change of default folio or of the inclusion's
     label has the same effect (they are in finance's request hash).
- **Why it matters.** Guest overcharge + wrongly recognized breakage revenue + tax on it (money correctness), and a
  routine correction turns into an unpostable night whose only recovery loses room revenue. Latent on main for the
  same reason as P0-1.
- **Fix (principle).** *Nothing for night N is committed to a folio before night N's own close, unless it is
  provisional and reconciled at that close.* Either drop the pre-grant (CR-5 already asks reservations to grant the
  arrival night at check-in; for the following nights, grant at the close of the previous night as a **provisional
  instance** that N's close confirms, adjusts or reverses), or make the posting step reconcile a pre-grant whose
  inputs differ (reverse + re-grant under a derived key) instead of re-sending the key. A stay that is no longer in
  house for N at N's close must have its pre-granted instance reversed (not forfeited). Classify
  `idempotency_conflict` as **not retryable** in `toFailure` (a deterministic conflict never heals).
  **Attack run against the fix:** the guest *consumes* part of the provisional credit at lunch and leaves early —
  the reversal must cover only the unused part and the consumed part stays a charge (finance's usage rows already
  give the split). **Sibling paths:** the posting step's allowance line, `pregrantAllowances`, reservations' future
  check-in grant (CR-5), finance's check-out consumer (forfeit vs. reverse).

### DCL-P1-1 — A night overridden "to be posted by hand" is posted again by the next close (catch-up ignores overrides)

- **Where.** `modules/day-close/src/service/readiness.ts:475-521` (`catchUpNights` only asks "is there a
  `night_postings` row?"), `steps/postings.ts:288-295` (catch-up items), `postings.ts:76-79` (the item's own
  message: "or override this item and post the night by hand"), `runs.ts:257-274` (the override records no intent).
- **Reproduced** (`zz-review-money.test.ts.txt` › `R-CATCHUP`): a stay with a bad seal fails at the close of 7 Nov;
  the auditor overrides it with the builder's own test reason ("…the night will be posted by hand tomorrow"); the
  next morning revenue posts the night by hand (`manual:{stay}:{D}`, USD 500) and front office re-confirms the price.
  The close of 8 Nov's catch-up posts `room:{stay}:2026-11-07` (USD 830). **Two room charges for one night**; the
  `night_not_posted` readiness item that announces it is only `info`.
- **Fix (principle).** *An overridden stay-night is a decision, not a gap: the catch-up never posts a night that a
  person overrode; it raises a blocking "decide: post now or confirm posted elsewhere" item instead.* Record the
  override's intent (`skip_night` with the run, stay and night) in the register (`night_postings` row with
  `posted_by = 'override'`, or a separate `night_decisions` table), make `catchUpNights` respect it, and change the
  message so it no longer recommends a hand posting that Day Close does not know about.
  **Attack run against the fix:** override, *no* hand posting, price fixed next day — the decision item makes the
  auditor post it (once, with the plan key); the night is not silently lost either. **Sibling paths:** overrides of
  posting-step items, of pre-advance sweep items (step `advance`), of catch-up items themselves, and of deferred-line
  items.

### DCL-P2-1 — The local DST correction (FR-3) is wrong west of UTC: in a spring-forward gap the close is scheduled an hour **early**

- **Where.** `modules/day-close/src/domain/schedule.ts:22-33` (`nextValidLocalMinute`), used by `scheduledInstant`
  (scheduler) and `earliestStart` (start refusal). Test: `src/domain/domain.test.ts:218-226` (Europe/London only).
- **Problem.** The fix assumes the kernel's `zonedTimeToInstant` lands *after* a gap and walks backwards. That is
  true east of / at UTC (London). West of UTC the kernel lands *before* the gap, the backward walk stops at once, and
  the "corrected" instant is an hour before the configured time.
- **Reproduced** (`day-close-poc/zz-review-ops.test.ts.txt` › `R-DST`; standalone `zz-review-dst-standalone.mjs.txt`):
  `scheduledInstant('2027-03-13','02:30','America/New_York')` = `2027-03-14T06:30Z` = **01:30 EST** (expected 03:00
  EDT, 07:00Z). Same for `earliestStart` (a 02:30 floor lets a close start at 01:30). Los Angeles: 01:30 PST.
  America/Santiago `00:30` on 2027-09-05 → **23:30 on the previous calendar day**. London and Sydney are correct.
- **Why it matters.** The focus asked whether the FR-3 fix is correct and tested: it is neither for half the world;
  the earliest-start guard (EC-DCL-026) is undercut on that night; FR-3 asks the kernel to copy this correction.
  Maldives has no DST (P2, not P1).
- **Fix (principle).** *The scheduled instant is the first instant whose local wall time is ≥ the configured time on
  that local date*, computed directly (search forward from the local midnight's instant, or offset-before /
  offset-after the transition), never by correcting a guess in one direction. Test the boundary set: east (London,
  Sydney), west (New York, Los Angeles), a midnight gap (Santiago, Havana), a 30-minute DST zone
  (Australia/Lord_Howe), and the fall-back overlap (pick and document the earlier occurrence — the kernel doc says
  "earlier", the kernel returns the later one for London). **Attack run against the fix:** Lord_Howe's 30-minute shift
  at 02:00 → 02:30 with a 02:15 schedule must give 02:30. **Sibling:** FR-3's kernel request must carry this rule,
  not the current correction; operations/rates use `zonedTimeToInstant` for deadlines.

### DCL-P2-2 — DCL-I04 is claimed but not true: a guest checked in after the pre-advance sweep (or after the advance) and gone before the next close is never charged, and nothing says so

- **Where.** `steps/index.ts:393-436` (sweep → separate re-check transaction → separate advance transaction),
  `readiness.ts:475-521` (catch-up lists only stays *still in house*), README "Invariants" row DCL-I04 and
  DCL-R04 row.
- **Reproduced** (`zz-review-ops.test.ts.txt` › `R-GAP`): a delayed-seaplane arrival (one night, 7→8 Nov) is checked in
  while the advance step re-checks readiness (after the sweep, before the advance). The close completes without its
  night; the guest checks out on 8 Nov; the close of 8 Nov completes. `room:{stay}:2026-11-07` never exists, readiness
  is empty for the stay, no issue is raised. The same hole exists for a check-in after the advance with a
  same-day check-out (the CR-2 case).
- **Why it matters.** Silent revenue loss on an occupied room; the README's invariant table says DCL-I04 is enforced
  and the Known gaps omit this (it is only implied by CR-2). The window is narrow (the re-check plus the advance
  transaction) but the loss is silent.
- **Fix (principle).** *No occupied stay-night may leave the catch-up's sight until it is posted or a person decides.*
  (1) Move the sweep into the advance transaction after a lock that check-in also takes (or re-run the sweep inside
  the advance transaction under the advisory lock and refuse/loop if it finds new stays), and (2) until CR-2 lands,
  compute catch-up from Day Close's own knowledge: record every stay seen in house for a closed night (or listen to
  `reservations.stay.checkedIn` / `checkedOut`) so a departed stay is still found. Raise a blocking
  `night_not_posted_departed` follow-up when a departed stay has an unposted night. Mark DCL-I04 "partial (CR-2)" in
  the README until then. **Attack run against the fix:** check-in commits *during* the advance transaction — the lock
  makes it wait and land on D+1 (then it is the catch-up case with the departed-stay record).

### DCL-P2-3 — The day facts are frozen before the last postings of the day: occupancy, room revenue and ADR are wrong, and the annex reports ordinary postings as restatements

- **Where.** Step order `statistics_snapshot` (7) → `advance` (8, which first sweeps and posts late check-ins on D),
  `steps/index.ts:301-389`, `:393-395`; annex `service/reports.ts:44-57`.
- **Reproduced** (`zz-review-ops.test.ts.txt` › `R-STATS`): a late arrival checked in after the posting step is counted
  as sold (2) but its room night is posted by the sweep after the snapshot, so the frozen facts hold room revenue
  830.00 for two sold rooms (**ADR 415.00 instead of 830.00**). The day report's "restatements since" annex then lists
  `ROOM 83 000 → 166 000` and `FB_BREAKFAST 7 000 → 14 000` although nothing was corrected. Any bar posting between
  step 7 and the advance does the same.
- **Why it matters.** DCL-I03 freezes wrong numbers forever (the analytics hand-off, CR-15, gets them); the annex,
  which is the only "detection" of FR-1's in-flight postings (P2-4), is noisy by construction.
- **Fix (principle).** *The facts for D are frozen from the same state the advance closes:* snapshot inside (or
  immediately after, keyed to) the advance transaction — after the sweep, with revenue read in the advance
  transaction — or run the sweep before step 7 and re-snapshot if the sweep posts. The annex then compares against
  that state and labels entries by cause (correction with `relatesToBusinessDate`, in-flight posting, late posting).
  **Attack run against the fix:** a posting committing between the snapshot and the advance inside the same
  transaction cannot happen (one transaction); a posting in flight across it is FR-1 (P2-4).

### DCL-P2-4 — FR-1 (`lockBusinessDate` missing): "detected, not prevented" is only half honest — the detection is an unlabelled revenue delta, nobody is told, and a journal export would miss the posting

- **Where.** README Known gaps / DCL-R04; `service/reports.ts:44-77`; `steps/index.ts:549-578` (journal export
  requested at post-advance); test `concurrency.test.ts:179-251`.
- **Assessment.** The residual is **bounded** (only postings whose transaction read D before the advance and commit
  after it — a sub-second window per posting) and the ledger stays balanced. But it is **not visible** in any
  actionable way: no follow-up, no alarm, no label — it appears only if someone opens the report and reads a revenue
  delta that also contains sweep postings and late bar postings (P2-3). When accounting is external, the journal for
  D is queued at post-advance (stub today, CR-12) and would not contain a posting that commits after that.
- **Fix (principle).** Until FR-1 lands: *a posting stamped D that commits after D's advance is a named exception*,
  found from the ledger (entries with `business_date = D` whose commit is later than `business_date_log.advanced_at`
  — finance can expose `created_at`/commit order) and raised as a Day Close follow-up on D (and re-exported). Keep
  FR-1 as the real fix. **Load-bearing:** relies on P2-3 being fixed so the annex is not noise.

### DCL-P2-5 — The default policy allows a close at any time of day; a 10:00 close no-shows the afternoon's arrivals and posts their fees; the spec's "schedule ≥ earliest start" is not enforced

- **Where.** `contracts.ts:148` (`earliestStartLocalTime` default `null`), `:138` (no-show mode default `auto`),
  `domain/policy.ts:57-68` (no check of `schedule.localTime` against `earliestStartLocalTime`), spec DCL-R05 [MUST]
  "per property start time (policy, ≥ `dayClose.earliestStartLocalTime`)".
- **Reproduced** (`zz-review-ops.test.ts.txt` › `R-DAYTIME`): with the default policy, an auditor presses Start at 10:00
  Malé time on the business date: the run completes, the expected afternoon arrival is recorded as a no-show with
  `penalty:no_show:{stay}` posted (and a collection would be requested once payments binds), and the business date
  moves at 10:00, so every later posting of the day lands on D+1. A schedule at `13:00` is accepted the same way.
- **Fix (principle).** *Irreversible guest-facing effects of a close (no-show, fee, collection) never happen before the
  property's arrival cut-off for D, whatever the policy.* Default `earliestStartLocalTime` to a conservative value
  (e.g. 23:00, or derive from the property's check-in policy), validate `schedule.localTime ≥ earliestStart` at save,
  and make the no-show step refuse before the cut-off even when someone starts early (EC-DCL-026 for the step, not only
  the run). **Attack run against the fix:** a scheduled close at 01:00 with an arrival on a seaplane due at 01:30 —
  the delayed-transfer protection still applies after the cut-off. **Sibling:** manual start, API start (`trigger
  'api'`), scheduler.

### DCL-P2-6 — Guest names from finance's checks are copied into the append-only day report (and step detail): erasure can never remove them

- **Where.** `steps/index.ts:59-66` (preflight stores each warning's `message`), `:510-516` (copied into the pack),
  `migrations/0001_day_close.sql` (`day_reports` append-only); finance's `departed_with_balance` /
  `settled_folio_with_balance` messages carry `payer_name` (`finance/src/service/reports.ts`).
- **Reproduced** (`zz-review-pii.test.ts.txt` › `R-PII`): a departed guest "Aishath Zz-Unique Rasheed" with a balance →
  after the close, `day_close.day_reports.pack` and `day_close.steps.detail` each contain the name; an UPDATE of the
  pack is refused (append-only).
- **Why it matters.** AP-17 (personal data after erasure) and the builder's self-check item 29 ("no guest personal
  data stored, ids only") is not true. The guests module's erasure cannot reach Day Close's tables.
- **Fix (principle).** *Day Close stores references and codes, never another module's prose about a person.* Store
  `{key, code, ref, owner, amounts}` and render the message on read from the owning module (or store a redacted
  message template). Sibling paths: `steps.detail.warnings`, `overridden`, the pack's `exceptions`, issue `message`s
  built from provider text (`journal_export_pending` uses the provider's error message), audit `after` payloads.

### DCL-P2-7 — No dead-man's switch: a close that never runs (worker down, schedule disabled, a refusal every 5 minutes) notifies nobody (AP-61)

- **Where.** `src/jobs.ts:117-155` (errors only go to `onError` → `console.error` in composition), `scheduler.ts:80-92`
  (`fire_refused` re-tried every 5 minutes forever, logged only), `service/reports.ts:109-137` (lag computed only when
  someone opens the portfolio board).
- **Why it matters.** DCL-R09's guesthouse relies on the auto-close; if it never fires, the date silently stops
  (postings pile onto a stale business date) until someone opens the board. Run notifications exist only for runs
  that start.
- **Fix (principle).** *Alarm on the absence of a completed close within its period*, from something that does not
  depend on the failing job: a per-property "expected completion by" (schedule time + grace) checked by an
  independent job/metric, paging the duty roles; `fire_refused` raises a Day Close follow-up after the first refusal.

### DCL-P2-8 — My own mutant survived: the seal check that guards the pre-grant is untested

- **Mutant R1** (`steps/postings.ts:248`): `if (!ents.length || !verifyTerms(stay.terms)) continue;` →
  `if (!ents.length) continue;`. Full module suite: **87/87 green** (`20.9 s`). Tampered terms would grant a
  monetary allowance (a folio charge and a liability) at every pre-grant, while the posting step refuses the same
  terms. Fix: a test with tampered terms that carry a monetary allowance, asserting no grant at pre-grant (moot if
  P0-2 removes the pre-grant; then the test goes on the provisional grant).

### DCL-P2-9 — Default-concurrency gate: two Day Close tests time out (new flake, not the tracked demo-seed one)

- **What.** `pnpm turbo run test --force` (default concurrency) on the merged copy: exit 1. Besides the tracked
  `apps/api` demo-seed flake (`rates.test.ts` › "prices every demo property…", 30 s), **day-close** failed:
  `scenario-s09…` › "resumes at the remaining 45…" and `lifecycle-and-security` › "a day with nothing blocking…",
  both at the 60 s limit. The same package passes in ~20 s alone and under `--concurrency=2`. The builder reported
  "the day-close tests pass under both concurrency settings". Flake rate: see § 2.
- **Fix.** Reduce the per-test work under load (S09 creates 112 stays through real rates quotes; the attention test
  40) or raise those tests' timeouts deliberately with a comment, and record the flake in `pending-fixes.md`.

### DCL-P2-10 — Departure-dated package lines always become charges after check-out (CR-4), but the README lists it only as a contract request

- **Where.** `steps/postings.ts:112-131`; `scenario-s19…test.ts` treats "the departure transfer is posted by the close
  whose business date reaches its service date" as the desired outcome.
- **Problem.** The guest checks out in the morning of the departure date; the departure seaplane (USD 750 + tax in
  the probes) is posted that night, onto a departed folio → `departed_with_balance` every time. That is a planned
  late charge on every package departure.
- **Fix.** Add it to Known gaps with the money exposure; until CR-4, post departure-dated lines at the close of the
  **last night** with their own service date (finance accepts a future service date from Day Close, or a "due at
  check-out" posting), so they are on the folio when the guest settles. **Load-bearing:** P0-1's occurrence key.

### DCL-P2-11 — Statutory levy on zero-price nights is skipped silently; the follow-up that would say so is never raised

- **Where.** `steps/postings.ts:108-111` (`amountMinor === 0` → `skippedLines`, and the night is still registered as
  posted, so nothing revisits it); `readiness.ts:442` (`levy_not_posted` actions) — no code raises `levy_not_posted`
  (grep).
- **Why it matters.** Green Tax is owed per person-night (Maldives) for complimentary and house-use stays too; the
  README admits the gap (CR-10) but there is no per-stay visibility, so nobody posts it by hand.
- **Fix.** Raise `levy_not_posted` (warning, owner finance, with the person-nights) whenever a zero-price night's
  terms carry a per-person levy, until CR-10 lands.

### DCL-P2-12 — `dayClose.policy.manage` reaches `platform.businessDate.advance` (privilege equivalence, AP-09)

- **Where.** `service/policy.ts:152-193` (only `dayClose.policy.manage`), `jobs.ts:141-148` (scheduled runs execute
  with `systemContext`, which holds every permission), README "Advancing also needs `platform.businessDate.advance` on
  the acting person".
- **Problem.** A person with `dayClose.policy.manage` but without the sensitive advance permission can enable a
  schedule with auto-continue at any local time (P2-5) and the system advances the date (and runs no-shows) for them.
  `dayClose.run.read` similarly reaches finance's payer names and balances (`finance.report.read`-level data) through
  readiness (`readiness.ts:229-231`).
- **Fix (principle).** *A schedule acts with the authority of the person who configured it*: saving or enabling a
  schedule requires `platform.businessDate.advance` at the property (and records who), or scheduled runs execute
  with a delegated context bound to that person's grants and stop before the advance when the grant is revoked.
  Document the read-side equivalence or redact finance prose (P2-6). **Attack run against the fix:** the configurer
  later loses the advance grant — the delegated context must re-check at fire time.

### DCL-P2-13 — A late charge for D posted after D's close never reaches D's report (S10 supporting scenario not met)

- **Where.** `service/reports.ts:58-65` (the annex lists finance `restatements` with `relatesTo = D`);
  finance's `postCharge` sets no `relates_to_business_date` for a late service date
  (`finance/src/service/postings.ts:321-326` only demands a reason); spec §10 S10: "Late charge posted after Day Close
  of the departure date is a D+n posting with `relatesToBusinessDate`; day report annex shows it".
- **Reproduced** (`day-close-poc/zz-review-late.test.ts.txt` › `R-LATE`): close of 7 Nov; on 8 Nov the restaurant
  posts a USD 120 dinner with service date 7 Nov (reason given). D's report: `restatementsSince = { revenueDelta: [],
  entries: [], changed: false }`.
- **Why it matters.** Focus (b): the late charge after the advance is the normal "outlet closed after midnight" case
  (EC-DCL-018, open P0 parity row). The "as closed + restatements" promise (DCL-R07) silently omits it.
- **Fix (principle).** *Anything finance books for service date D after D closed appears in D's annex*, whether a
  correction or a late posting: finance stamps `relatesToBusinessDate = serviceDate` when `serviceDate <
  businessDate` (cross-module request), or Day Close's annex queries finance by service date. **Attack run against
  the fix:** a late posting for a date *before* the catch-up window and a late posting in a different currency — both
  must show, keyed by service date, in functional currency.

### DCL-P2-14 — Parity gate fails (11 P0 rows open) and two rows marked `tested` overclaim

- `node tools/parity-report.mjs --gate day-close` (copy): **exit 1** — P0 not tested: PAR-DCL-033/064/065/067/082/085,
  EC-DCL-012/016/018/034/035 (the builder reported the same 11).
- `EC-DCL-024` (DST) is `tested` with a London-only test; it fails west of UTC (P2-1). `EC-DCL-004` ("never silently
  missed") is `tested` for a stay that stays in house; it is silently missed for a stay that leaves (P2-2).
- Fix: downgrade both rows to `building` with the reason until P2-1/P2-2 are fixed; CLAUDE.md §7 says the module is
  not complete while the gate fails (merging with open P0 rows is the orchestrator's call, as for other modules).

### DCL-P3 (nits and small honesty items)

| ID | file:line | Problem | Fix |
|---|---|---|---|
| P3-1 | `service/engine.ts:199-224`, `scheduler.ts:47-79` | `R-CHURN`: a blocked auto-close writes a `dayClose.run.blocked` audit row and bumps the run version **every minute** (6 audits, version 13 after 6 ticks), so a person's `If-Match` races the worker; once the run is stuck past the next due time the schedule re-fires **every minute** (`fired` ×5 in 4 minutes) | Audit only when the blockers change (as notifications already do); set `next_due_at` from the run's date, not `businessDate+1`, while a run is active |
| P3-2 | `service/engine.ts:262-313` | `recordFailure` writes the step failure, the integrity issue and the `run.fail` audit without the lease fence (only `release` is fenced): a stale executor can mark a step another executor is running as failed and raise an integrity alarm | Heartbeat first in `recordFailure` (throw `LeaseLostError` like every other executor write) |
| P3-3 | `src/manifest.ts:38` | Record type `day_report` declares route `/day-close/reports/:id`; no such route exists (`routes.ts:180-184` uses `/properties/:propertyId/days/:date/report`) | Add the route or fix the declared route |
| P3-4 | `contracts.ts:126`, `domain/policy.ts:57-68` | Comment says saving refuses "unknown codes"; unknown codes are accepted (a typo in `warningCodes` silently has no effect) | Validate codes against the known catalogue, or fix the comment |
| P3-5 | `steps/index.ts:269-278` | Integrity passes when the inventory consistency check is "not connected" (recorded as `checked: false`, but the run says the books proved balanced) | Show "inventory not checked" as a warning in the report and readiness; never as a silent pass |
| P3-6 | README DCL-R02.6, `engine.ts:53` | "Raises a blocking alarm to finance": the alarm is a Day Close issue owned by the finance department, but identity's `finance` template has no `dayClose.*` (CR-13), and run notifications go to `night_audit`/`front_office_manager` only — finance is told nothing on main | Say so in the README until CR-13; include finance in the integrity-failure notification roles |
| P3-7 | `apps/api/src/composition.ts` (`markNoShow` property check) | Untested (builder admits it); stays cannot be created in the composed app on main | Cover it when integration-step lands; keep the README line |
| P3-8 | `src/events.ts` | Event payload Zod schemas not exported (builder self-check item 22 "no") | Export them for consumers (CR-14/15) |
| P3-9 | `scheduler.ts:71-77` | Reverse order (AP-08): a manual run created first (e.g. `execute:false`) pre-empts the schedule's auto-continue; the guesthouse auto-close silently becomes a manual run | Let the schedule adopt an active run for its date (set `auto_continue`) or say so in the run view |
| P3-10 | `test/harness.ts:164-165` | The reservations fake silently drops an in-house stay whose terms do not cover the night (AP-41); the real provider would return it and Day Close would raise `night_not_in_terms` | Return it and let the test see the refusal |
| P3-11 | `service/readiness.ts:221-344`; `steps/index.ts:339-371` | DCL-R01 [MUST] sources not aggregated and not in Known gaps: incomplete check-ins/outs, failed collection items, unresolved relocations/inventory conflicts, unacknowledged handovers; DCL-R02.7 facts omit **cancellations** (departures and nationality are documented as missing) | List them in Known gaps with the owning contract request, or add the sources |
| P3-12 | `steps/index.ts:104-106` | The no-show step honours an override of `arrival_transfer_delayed`, but that item is a warning and `overrideItem` refuses it (`runs.ts:286`): dead branch | Remove it or make the item overridable on purpose |

---

## 8. Cross-module notes for the orchestrator

| To | Note | From |
|---|---|---|
| rates | Plan-line identity for arrival/departure-rhythm lines must be the occurrence, not the allocated night (`terms.ts:86-89`); otherwise any re-pricing moves the key | P0-1 |
| finance | (a) `postCharge` with `serviceDate < businessDate` should stamp `relatesToBusinessDate` (or `dailyRevenue` should list late postings by service date) — S10; (b) the check-out consumer forfeits a pre-granted *future-night* allowance to breakage — it should reverse it; (c) CR-9 provider surface for integrity/TB/revenue | P2-13, P0-2 |
| kernel | FR-3 must adopt the forward-search rule, not Day Close's backward correction; the kernel doc says "earlier" for an overlap but returns the later instant (London) | P2-1 |
| reservations | CR-2 is load-bearing for DCL-I04; CR-4/CR-5 interact with P0-1/P0-2 (post/grant with occurrence keys) | P2-2 |
| identity | CR-13: without `dayClose.run.read` on the finance template, the integrity alarm owned by finance is invisible | P3-6 |
| platform | FR-1 `lockBusinessDate` (still the real fix for P2-4) | P2-4 |
| shared code | `actorKey` is re-implemented in 10 modules (`day-close/src/service/context.ts:51`, finance, rates, reservations, guests, platform, integration, inventory, operations, payments) — a kernel helper | checklist 15 |

## 9. Evidence and clean-up

- PoCs (each was a `zz-review-*.test.ts` in `modules/day-close/test/` of the scratch copy, run against the real
  platform, rates and finance with the module's harness):
  - `day-close-poc/zz-review-money.test.ts.txt` — `R-PREGRANT` (2 tests), `R-DEFER`, `R-CATCHUP`
  - `day-close-poc/zz-review-ops.test.ts.txt` — `R-DST` (fails by design: asserts the correct instant), `R-TZ`
    (clean), `R-GAP`, `R-STATS`, `R-DAYTIME`, `R-CHURN`, `R-LEASE` (clean)
  - `day-close-poc/zz-review-security.test.ts.txt` — `R-RLS`, `R-SCOPE`, `R-INTEGRITY` (all clean)
  - `day-close-poc/zz-review-pii.test.ts.txt` — `R-PII`
  - `day-close-poc/zz-review-late.test.ts.txt` — `R-LATE`
  - `day-close-poc/zz-review-dst-standalone.mjs.txt` — the DST computation for London, New York, Los Angeles,
    Santiago, Sydney without the workspace
- Nothing committed. The scratch worktree and every `review_dayclose*` database were removed at the end (§ below).
