# Re-review #7 — integration-step (fix round 6)

| | |
|---|---|
| Reviewer | Architecture steward (playbook v2.1, focused re-review shape) |
| Branch / commit | `feat/integration-step` @ `932e7c1` (merged with `main` @ `1e1be80` in the scratch copy) |
| Date | 2026-11-08 |
| Status | Complete. Scratch copy and every `review_intstep7*` database removed at the end |

## Verdict: **merge after fixes**

Counts: **P0 0 · P1 2 · P2 2 · P3 5.**

Coverage: focused re-review. Checklist: 15 items — 3 probed, 7 code-read only, 3 not applicable, 2 not probed with reasons
(§ 6). The focused pattern subset is in § 6. The branch did not move during the run (`932e7c1`); the worktree
`/home/user/wt/integration-step` was not modified. I drafted the attack plan from Amendment 5 and the round-6 diff
**before** reading the builder's report.

- **(a)** All three r6 FINDINGs are refused at the right line; the corporate-card regression check still passes (§ 2).
- **(g)** All four gates exit 0 on the merged copy (§ 1).
- **(f)** The front-desk flows still work: walk-in on the hotel terminal, corporate card via the master folio, deposit by
  link then checkout by card on file, no-show fee after the night audit.
- **(e)** Builder mutants R2 and R3 are killed. Deposit per stay is **correct** on a two-segment, two-snapshot stay
  (R7-D1, now the distinguishing test). My mutant M7 on the ledger penalty **survives** every suite (R7-P2-2).

Going one step beyond the round finds two more P1s of the class:
1. **R7-P1-1 — the forfeit rests on the recorded penalty alone** and a forfeit is not "collected": the deposit is
   forfeited for the cancellation and the same penalty, still owed on the folio, is charged to the card as `no_show`
   (both orders); a penalty credited off still lets the deposit be kept. Front desk can do all of it.
2. **R7-P1-2 — money moving off a covered folio leaves an ownerless debit**: Otto's cheque is moved to Vera's folio and
   Otto's card then refills it.

Plus **R7-P2-1**: a penalty already paid by cheque still justifies taking an ordinary bill as `no_show`.

## Findings (appended as confirmed)

PoCs: `docs/orchestration/reviews/integration-step-poc/r7-fix-attacks.test.ts.txt` (drop into `apps/api/test/` as
`*.test.ts`). FINDING tests assert the defect and **pass on `932e7c1` + main**: 5 FINDING tests pass (R7-F1, R7-F2,
R7-F3, R7-N1, R7-M1); 3 CLEAN/PROBE tests pass (R7-N2, R7-C1, R7-D1).

### R7-P1-1 — A card-funded deposit is forfeited on the recorded penalty alone, and a forfeit is not "collected": the cardholder pays one penalty twice

- **Where:** `modules/payments/src/service/consent.ts:430-457` (`cardDepositForfeitProblem`: `recorded += st.penalties…`
  at `:453`, `if (input.amountMinor <= recorded) return null` at `:455`); `modules/finance/src/service/deposits.ts:739-747`
  (`forfeitDeposit`); `modules/payments/src/service/purpose.ts:151-154` (the `no_show` limit subtracts only payments
  whose `purpose_basis` is `penalty:<stay>`, so a forfeit never counts).
- **What:** Amendment 5 rule 1 names **forfeit** as a landing operation whose fact limit is the **penalty owed**, and
  rule 3 says the penalty is "posted minus credited, minus what was already collected". The forfeit check reads the
  reservations record only. It does not look at the ledger (the cancellation penalty is also **posted on the stay's
  folio**, `reservations/src/service/changes.ts:1792`), at credits against it, at no-show money already taken, or at
  earlier forfeits. The no-show limit, in turn, does not subtract forfeited deposit money.
- **Repro (all `front_desk` + `general_manager`; `forfeitDeposit` needs only `finance.posting.create`, which the
  front-desk template holds, `identity/src/domain/role-templates.ts:79`):**
  - **R7-F1:** booking on BAR with the guest's card confirmed for it; USD 100 deposit charged to the card; the stay is
    cancelled inside the flexible window. The penalty is posted on the folio (folio owes the penalty). The deposit is
    forfeited (USD 100 kept as revenue, deposit held → 0) → **accepted**. The folio still owes the full penalty. The
    desk then charges the card the full penalty as `no_show` → **accepted**. The card has paid penalty + USD 100 for one
    penalty.
  - **R7-F2 (reverse order):** the penalty is charged to the card as `no_show` first, then the card-funded deposit is
    forfeited for it → **accepted**.
  - **R7-F3:** the penalty posting is credited in full (goodwill; folio owes 0), then the deposit is forfeited "up to the
    penalty" → **accepted**.
- **Severity P1:** money correctness against the cardholder (double recovery under their consent), on a rule-1
  operation the round claims to close, reachable by ordinary front-desk work in either order; R6-P1-1 (same rule, same
  roles) was P1. It also happens by accident: the cancellation posts the penalty, a manager forfeits the deposit "for
  the cancellation", and the desk later collects the folio.
- **Fix (principle, with instances):** *the penalty is one fact on the ledger, and every collection of it — whatever it
  is called — draws down the same balance under the same lock.* The penalty owed = Σ over the booking's stays of the
  penalty as it stands on the ledger (`penaltyOn`, summed over every folio of the stay), minus every collection of it:
  `no_show`-basis payments and captures, **forfeited deposit money**, and deposits applied to the penalty. Instances:
  `forfeitDeposit` (limit = penalty owed, not the record; take the collection lock on the booking, so two forfeits or a
  forfeit and a `no_show` charge serialize); the `no_show` limit in `assertWithinFact` (subtract forfeits); and the
  ledger itself — a forfeit while the penalty is posted on a folio should **settle that penalty** (apply the deposit to
  the folio, or post the forfeit as the credit against the penalty posting), otherwise the folio keeps showing a debt
  the hotel has already recovered. Attack run against the fixed design: forfeit first then `no_show` (F1), `no_show`
  first then forfeit (F2), credit then forfeit (F3), and two forfeits each ≤ the penalty (must be refused cumulatively;
  today each call is checked alone at `:455`). Boundary: a booking with two cancelled stays — the sum is per stay, and a
  stay's penalty moved to the booking's master folio must still count once.

### R7-P1-2 — Money moved OFF a card-covered folio leaves a debit with no foreign owner, so the cardholder's card refills money staff gave to another guest

- **Where:** `modules/finance/src/service/provenance.ts:118-121` (a payment without a payments-module id is
  `other_money`; `folioProvenance` ignores it, `:169-180`); the source side of a transfer: the `transfer_out` of a
  credit follows `corrects_posting_id` back to the credit (`:99-104`), so the debit it leaves on the source folio is
  either ignored (cash, cheque, tender) or counted as the source owner's own debt (an adjustment or allowance credit);
  `modules/finance/src/service/postings.ts:1384-1408` (the transfer checks only what lands on the destination).
- **What:** Amendment 5 rule 2 requires every non-zero posting to have an owner **and a direction**. Re-review #6's fix
  for R6-P1-2 said so explicitly: "a payment with no payments-module id (cash, tender, cheque) is money with no
  agreement **but its debit counterpart is still debt**". The builder implemented the first half only. When money
  leaves a folio, the debit it leaves behind is economically the debt of whoever the money now pays (the destination's
  owner), but provenance attributes it to nobody, so `debtOriginsOf` and `coverageProblem` see only the source owner.
- **Repro (PoC R7-M1):** Otto's card is confirmed for his booking (all purposes). Otto owes USD 300 (spa) and pays it by
  cheque; his folio is 0. Vera owes USD 300 (minibar). The GM moves Otto's cheque payment onto Vera's folio →
  **accepted** (Vera's folio is 0, Otto's owes 300). The desk charges Otto's card USD 300 as `balance` → **accepted**.
  Otto has paid USD 600 for USD 300 of his own services; his card refilled the money that now pays Vera's minibar.
- **Severity P1:** the R6-P1-2 harm (one guest's card money paying another guest's debt), the mirror direction of the
  same rule, with the same role (GM, `finance.posting.transfer`), on a routine correction ("posted to the wrong
  folio").
- **Fix (principle, with instances):** *a credit that leaves a folio leaves behind a debit owned by whoever the credit
  now benefits.* The `transfer_out` of any credit (money or debt reduction) is debt of the destination folio's owner
  and its debt owners, not of the source owner and not "nobody". Instances: cash / cheque / bank / other tenders
  (`collectPayment`), payments-module recorded payments, card payments (the destination is already checked — the source
  debit must carry the destination owner too), adjustment and allowance credits, deposit applications of non-card
  deposits. Then both orders close: (i) move first, then card — `debtOriginsOf(source)` includes the destination owner
  and consent refuses; (ii) card money already on the source, then move — the transfer runs `assertDebtMayLand(source,
  [destination owners])` before it commits. Attack run against the fixed design: a cheque moved to a folio **of the same
  booking** (the agreement covers it, so it must be accepted — check the fix does not break legitimate re-allocation
  inside a covered booking), and a credit moved off and then moved back (the net must return to zero, not leave a
  stale foreign owner).

### R7-P2-1 — The no-show limit ignores payments that are not labelled `no_show`: a penalty paid in cheque still lets an ordinary bill be taken as `no_show`

- **Where:** `modules/payments/src/service/purpose.ts:151-154`; `modules/finance/src/service/provenance.ts:259-291`
  (`penaltyOn` follows corrections and transfers of the penalty postings only).
- **Repro (PoC R7-N1):** the night audit records the no-show (penalty posted; folio owes the penalty). The guest pays the
  penalty by cheque (folio 0). The desk posts minibar and laundry for the same amount and charges the guarantee + no-show
  card that amount as `no_show` → **accepted**. `onLedger` is still the full penalty (no credit against the posting),
  `collected` (basis `penalty:<stay>`) is 0, and the folio owes the amount.
- **Severity P2:** the R6-P2-1 harm (no-show consent pays an ordinary bill), one sibling further: re-review #6's fix text
  said "net of adjustments, transfers off the folio, routing **and payments**"; payments were left out. Capped by the
  penalty.
- **Fix (principle):** *on a folio that carries a penalty, money that is not attributable to another charge pays the
  penalty first.* The `no_show` limit = penalty on the ledger − all money on the folio since the penalty posted (any
  method, any label, including deposit applications), floored at 0, never more than the folio owes. Instances: cash,
  cheque and terminal records (`collectPayment`, `recordPayment`), link payments with a `balance` purpose, deposit
  applications, captures as `balance`. Attack run against the fix: the penalty paid, then the payment refunded (the
  limit must come back), and the penalty partly paid.

### R7-P2-2 — Reviewer mutant M7 survives: the ledger penalty is never tested through a transfer

- **Where:** `modules/finance/src/service/provenance.ts:281-286` (`penaltyOn` follows `transfer_in` / `transfer_out` /
  `adjustment` back to the penalty posting).
- **Mutant M7:** follow `adjustment` only (drop `transfer_in` / `transfer_out`). **Survives** the whole api suite
  (173 passed), finance (92) and payments (161). Under the mutant, a penalty moved off the stay folio (for example to the
  booking's master folio) still counts in full on the stay folio, and an ordinary bill posted there is taken from the
  guarantee + no-show card as `no_show` — the R6-P2-1 harm through a transfer, which the round's own rule 3 text names
  ("less moved off").
- **Proof:** PoC **R7-N2** (penalty moved to the master folio, minibar posted, `no_show` charge) passes on the real code
  (`no_show_penalty_exceeded`) and **fails under M7** (`accepted`). Adopt it as a regression test, plus its mirror (the
  penalty moved onto a second folio of the same stay counts there).
- **Severity P2:** an untested load-bearing guard of a P2-class rule (playbook v3 "verify the proof": a survivor is a
  finding).

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R7-P3-1 | `payments/src/service/collect.ts:534` | The capture request hash is `{a, m, r}`; the new `purpose` label is not in it. A retry with the same key and a different label (`no_show` vs none) replays the first capture silently instead of `idempotency_mismatch`. The label decides whether the money lands as `no_show` or `balance`, so it is part of the request. | Add `purpose` (and `separateCollection`) to the hash. |
| R7-P3-2 | `collect.ts:603-626`, `:647` | A **customer-initiated** hold is captured with no consent check and no fact limit (only the same-booking check), so it could be captured above the deposit due or the folio balance. Not reachable today: customer holds come only from a guest actor holding `payments.payment.collect`, and no role template grants guests that. The landing table does not list this row. Code-read. | When guest self-service holds exist, apply `assertWithinFact` to every capture whatever the initiator (rule 1: "whatever the operation was called when it started"); add the row to the landing table now. |
| R7-P3-3 | `collect.ts:1134-1146` | `recordPayment` with `authorizationId` checks mode, open state and currency, but not that the recorded hold belongs to `input.propertyId` or to the same booking family as `input.ref`, nor that the amount is within the hold. Permission is checked only on `input.propertyId`, so a desk agent at property A can close property B's recorded hold. Own-terminal money, so no cardholder agreement is engaged. Code-read. | Require `authorization.property_id === input.propertyId` and the same booking family; refuse an amount above the hold's remainder (or flag it). |
| R7-P3-4 | Builder's report, landing table; `modules/payments/README.md`; domain-map round-6 section | "forfeit: recorded penalty" is presented as the rule-1 fact limit, but rule 1 says "penalty owed" (R7-P1-1). "Transfer / routing: coverage for every classified root" holds only for what lands on the destination, not for the debit left on the source (R7-P1-2). | Correct the claims when the fixes land. |
| R7-P3-5 | `finance/src/service/provenance.ts:108,126,134,136,142` | The `unknown` (fail-closed) branch is unreachable through public writers (every `deposit_application` is booking-sourced, `deposits.ts:539-545`; every balance transfer has a peer; every folio has an owner). The builder says so. A future import or migration writer could reach it untested. | Add a DB-level test that inserts an unclassifiable posting with the admin connection and asserts that a transfer onto a card-covered folio and a card charge on it are both refused. |

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep7`)

Exit codes were written straight to a file by a script (`echo "lint=$?" >> gates.txt`), never read from piped output.
My probe files were moved out of the tree before the gates ran.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | **exit 0** |
| `pnpm lint` | **exit 0**: "Checked 864 files … No fixes applied"; "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 2m03s |

Per-package tests: api 173 (+29 todo) · payments 161 · finance 92 · reservations 154 · guests 192 · integration 173 ·
identity 153 · rates 130 · operations 120 · inventory 98 · platform 62 · ui 87 · backoffice 53 · kernel 26 · db 17 ·
http 3. These match the builder's reported counts.

## 2. (a) The r6 PoCs, re-run inverted

`r6-fix-attacks.test.ts.txt` copied unchanged into `apps/api/test/` of the merged copy: **3 FINDING tests fail, 1 CLEAN
test passes.**

| PoC | Refused at | Refused by | Right line? |
|---|---|---|---|
| R6-A (hold + capture pays an ordinary bill) | `:277` (the capture) | `mandate_purpose_not_covered` — the capture is judged as `balance`, which a guarantee + no-show card does not cover | **Yes** |
| R6-B (refund moved onto a covered folio, then charged) | `:354` (the card charge) | `mandate_reference_not_covered` — `debtOriginsOf` now names Otto | **Yes.** The transfer itself (`:342`) is still accepted because no card money is on Vera's folio yet; the reverse order is closed at the charge, as Amendment 4 rule 2 intends. The builder's "card first" sibling refuses the transfer. |
| R6-C (corporate card via master folio) | — | CLEAN, still accepted | regression check holds |
| R6-D (penalty credited off, ordinary bill as `no_show`) | `:440` (the `no_show` charge) | `no_show_penalty_exceeded` | **Yes** |

## 3. (b)–(f) Attacks that held, and probes

| Area | Attack | Result |
|---|---|---|
| (b) capture label | `purpose: 'deposit'` on a folio capture from a guarantee + no-show hold (R7-C1) | refused `mandate_purpose_not_covered` — the label decides only `no_show`; a folio lands as `balance`. **Held.** |
| (b) capture onto another reference | folio hold captured onto the booking with `purpose: 'no_show'` (R7-C1) | refused `no_show_not_recorded`. Onto the booking without a label it lands as `deposit` and is capped by the schedule (builder's sibling test, mutant R2). **Held.** |
| (b) partial captures | two partial `no_show` captures of one hold, each just over half the penalty (R7-C1) | first accepted, second refused `no_show_penalty_exceeded` (the first counts while `processing`). **Held.** |
| (b) increment then capture | code-read: increment is judged as a hold on the hold's total (`collect.ts:466-486`); the capture is judged where it lands | **Held** (code-read). A staff increment of a guest's own hold is refused (`card_not_yours`), fail-closed. |
| (b) recorded payment completing a terminal hold | code-read: only `mode = 'recorded'` holds (own terminal, no Portico card authority) | No consent engaged; scope gaps are R7-P3-3. |
| (b) forfeit | R7-F1/F2/F3 | **R7-P1-1** |
| (c) refund, reversal, correction, paid-out moved onto a covered folio | refund (r6 PoC, builder ×2); paid-out and adjustments resolve to the source owner's debt (code-read `provenance.ts:128-134`) | **Held** for what lands. |
| (c) money leaving a covered folio | cheque moved off Otto's covered folio (R7-M1) | **R7-P1-2** |
| (c) unknown owner | reachability through writers | not reachable (R7-P3-5) |
| (d) partial credit | builder's flipped R6-D (partial credit leaves the rest) | **Held** |
| (d) penalty moved between folios | moved to the master folio, ordinary bill as `no_show` on the stay folio (R7-N2) | refused. **Held**, but untested in the builder's suites (**R7-P2-2**, mutant M7) |
| (d) penalty paid by other money | cheque pays the penalty, then minibar as `no_show` (R7-N1) | **R7-P2-1** |
| (d) penalty corrected and re-posted | code-read: the night-audit key `penalty:no_show:<stay>` cannot post twice; a manual re-post under another key is not counted | fail-closed |
| (d) multi-currency | code-read: folios are single-currency, transfers require the same currency (`postings.ts:1276`), the record is filtered by currency (`purpose.ts:148-150`) | **Held** (code-read) |
| (e) deposit per stay vs per snapshot | **R7-D1**: a 4-night BAR stay, rate plan changed to BAR-NR from night 3 (2 segments, 2 snapshots). Reference bookings: BAR nights 1–2 → 51,633; BAR-NR nights 3–4 → 155,380 | Deposit owed after the change = **207,013 = 51,633 + 155,380**. The old per-snapshot sum would be 103,266 + 155,380 = 258,646. **The fix is right for this case**, and R7-D1 is the distinguishing test the builder lacked — adopt it. |
| (f) walk-in on the hotel terminal | recorded `external_terminal` payment on the folio (R7 desk file) | accepted; folio 0. **No regression.** |
| (f) corporate card via master folio | r6 PoC R6-C | accepted. **No regression.** |
| (f) deposit by link, then checkout by card on file | link deposit USD 200 held; card confirmed for the booking pays what the folio owes net of the deposit | accepted. **No regression.** |
| (f) no-show fee after night audit | guarantee + no-show card: penalty + 1 refused, penalty accepted | **No regression.** |

## 4. (e) Verify the proof: mutants

| Mutant | Guard removed | Suite run | Result |
|---|---|---|---|
| Builder R2 | `assertWithinFact` on capture (`collect.ts:649`) | `review-regressions-r6.test.ts` | **killed** — "a hold bigger than the deposit owed is captured onto the booking only up to the agreed deposit" |
| Builder R3 | refund resolves to no owner (`other_money`) in `rootOf` | `review-regressions-r6.test.ts` | **killed** — R6-B flipped and its card-first sibling (2 red) |
| Reviewer M7 | `penaltyOn` follows adjustments only, not transfers (`provenance.ts:283`) | whole api suite, finance, payments | **survived** (173 + 92 + 161 green) → **R7-P2-2**; killed by R7-N2 |

The source was restored with `git checkout` after each mutant; the copy's tree was clean afterwards.

## 5. Notes for the orchestrator

- **The class is still open one step further, in two directions.** Round 6 closed "what lands" for every classified
  posting. R7-P1-2 is the source side of the same transfer (a credit leaving a covered folio). R7-P1-1 and R7-P2-1 are
  the same idea for the penalty: rule 3 defines the penalty as one ledger fact, but each operation subtracts a different
  subset of collections. Suggested wording for an Amendment 6, as principles:
  1. *A posting's owner includes its direction*: the debit a credit leaves behind belongs to whoever the credit now
     benefits.
  2. *A penalty is one balance*: every collection of it (no-show money, forfeited deposit money, other money paid
     while it is owed, deposits applied) draws it down, under one lock, whatever the operation is called.
- **Pending-fixes lines:** R7-P1-1 (payments + finance), R7-P1-2 (finance provenance + transfer), R7-P2-1 (payments
  `assertWithinFact` + finance), R7-P2-2 (adopt PoC R7-N2 and its mirror), R7-D1 adopted as the deposit-per-stay test,
  R7-P3-1…5.
- **Load-bearing check (AP-54).** The R7-P1-1 fix relies on `penaltyOn` being right through transfers, which is
  untested today (R7-P2-2, re-rated as a required part of the P1 fix). The R7-P1-2 fix relies on `folioProvenance`
  being recomputed under the folio lock on both sides of a transfer (`lockMoneyFolios` already locks both; keep the
  source check inside that lock).
- No contract mismatches with other worktrees were found in the touched ports (`LedgerPort.penaltyOwedOn`,
  `PaymentsPort.cardDepositForfeitProblem`; the finance fallback in `wiring.ts` returns `null`, which is right when no
  payments module is composed).

## 6. Coverage declaration

### Checklist (focused re-review)

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation | code-read only (no new tables or queries outside RLS-scoped `db(tx)`; new SQL in `penaltyOn` and `cardDepositForfeitProblem` runs through the tenant transaction) |
| 2 | Authorization | code-read only: forfeit needs `finance.posting.create` (front desk holds it; relevant to R7-P1-1 severity); transfers `finance.posting.transfer`; capture `payments.payment.collect`. R7-P3-3 (property scope of a recorded hold) |
| 3 | Money and finance principles | probed — findings R7-P1-1, R7-P1-2, R7-P2-1 |
| 4 | Idempotency and concurrency | code-read — R7-P3-1 (capture hash). Concurrency of two forfeits not probed (the R7-P1-1 fix names the lock) |
| 5 | Events and audit | not probed (no new events; forfeit and capture audits unchanged) |
| 6 | Contracts | code-read — new ports match providers; `captureInput.purpose` documented in contracts and README |
| 7 | Data authority and environment safety | not applicable (no new external effects or governed-domain writers in round 6) |
| 8 | Errors and UX contract | code-read — new messages explain problem and recovery (`forfeit_not_covered_by_card_consent`, `no_show_penalty_exceeded` with on-ledger detail) |
| 9 | Spec coverage (ADR-0015 Amendment 5) | probed — rule 1: forfeit gap (R7-P1-1); rule 2: direction gap (R7-P1-2); rule 3: payments and forfeits not subtracted (R7-P2-1, R7-P1-1) |
| 10 | Scenario claims | probed — the builder's landing table re-derived by grep and attacked (§ 3); claims corrected in R7-P3-4 |
| 11 | Honest readiness | not applicable (no readiness changes in round 6) |
| 12 | Code quality | code-read — no `any`, no default exports; lint and typecheck green |
| 13 | One-product experience | not applicable (no record contract changes) |
| 14 | Parity gate | not probed (focused re-review; no parity rows changed) |
| 15 | Cross-module coherence | code-read — `penaltyOn` (finance) and `purpose.ts` (payments) read the same `penalty:*` keys; the forfeit check reads the reservations record instead (R7-P1-1) |

### Patterns (focused subset)

| Pattern | Status |
|---|---|
| AP-08 reverse order | probed — R7-F1/F2 both orders; R7-M1 move-then-charge (charge-then-move covered by the fix text); r6 PoCs |
| AP-44 pre-check equals the posting predicate | code-read — capture now derives the purpose used for storage, consent and ownership from one `fact` |
| AP-45 sibling paths | probed — every landing operation in § 3 (charge, capture, increment, recorded payment, link, deposit application, forfeit, transfer, routing) |
| AP-54 load-bearing | probed — R7-P2-2 re-rated into the R7-P1-1 fix |
| AP-56 concurrent write during a guarded change | not probed (budget) — two concurrent forfeits, or a forfeit racing a `no_show` charge; the fix must take the collection lock |
| Mutation of the builder's guards (v3 "verify the proof") | probed — R2 killed, R3 killed, M7 survived |
| Client label steering a server fact | probed — capture `purpose` label (R7-C1): clean |
| Unknown / fail-closed branch reachability | code-read — R7-P3-5 |

**Not reached:** concurrency probes (AP-56); billing-rule routing of a penalty and of a moved credit (code-read only);
receivables transfer of a folio carrying card money (code-read: it moves debt off the folio, never onto a covered one);
a stay whose dates move while keeping its snapshot (code-read: the deposit owed falls to 0, which fails closed).

