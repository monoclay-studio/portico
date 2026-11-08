# Re-review #7 — integration-step (fix round 6)

| | |
|---|---|
| Reviewer | Architecture steward (playbook v2.1, focused re-review shape) |
| Branch / commit | `feat/integration-step` @ `932e7c1` (merged with `main` @ `1e1be80` in the scratch copy) |
| Date | 2026-11-08 |
| Status | IN PROGRESS — findings appended as confirmed |

## Verdict

_(pending)_

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

