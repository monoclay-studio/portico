# Steward re-review #6 (focused, after fix round 5): `feat/integration-step`

Reviewer: architecture steward · 2026-11-08 · playbook v2.1, variant "focused re-review", plus the v3 "verify the
proof" step. Scope: ADR-0015 Amendment 4 (consent inputs are facts; coverage where money lands; capped staff
agreements; finance-owned link states).

## Verdict: **merge after fixes**

Counts: **P0 0 · P1 2 · P2 1 · P3 3.**

Coverage: focused re-review. The checklist has 12 items: 9 probed or code-read, 2 not probed (with reasons), 1 N/A.
The focused pattern subset is in § 7. What I did not reach is listed at the end of § 7.

- Branch `feat/integration-step` @ **`333a83e`**. It did not move during the run. The worktree
  `/home/user/wt/integration-step` was not modified.
- `main` @ `a462a4a` was merged into a scratch copy (copy commit `000f6d0`) with no conflicts; `main` changed only docs
  and chronicle files.
- The copy and every `review_intstep6*` database were removed at the end.
- I drafted the attack plan from Amendment 4 and the code **before** reading the builder's round-5 report.

All four r5 FINDINGs are refused (§ 2). Gates are green (§ 1), and the builder's N7 and N8 mutants are killed (§ 5).
Going one step beyond the round finds **two more P1s of the same class**:

1. **R6-P1-1 — capture's purpose is a label.** A guarantee + no-show card pays an ordinary USD 2,500 bill through
   `authorize` + `capture`. A balance charge on the same card is refused. Front-desk role only.
2. **R6-P1-2 — a refund posting is invisible to provenance.** It is moved onto a covered folio, and the cardholder's card
   then pays another guest's refunded charges.

Plus **R6-P2-1**: the no-show fact is not reconciled with the ledger. After the penalty is credited off, an ordinary bill
is taken as `no_show`.

The four front-desk flows checked in (e) still work (no regression).

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep6`)

Exit codes were written straight to a file (`echo $? >> gates.txt`), never read from piped output. My probe files
were moved out of the tree before the gates ran.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | **exit 0**: 863 files, no fixes; "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached, 19.2 s |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 1m54s |

Per-package test counts:
- payments 161 · api 166 (+29 todo) · finance 92 · reservations 154;
- guests 192 · identity 153 · integration 173 · rates 130 · operations 120 · inventory 98 · platform 62;
- ui 87 · backoffice 53 · kernel 26 · db 17 · http 3.

## 2. (a) The r5 PoCs, re-run inverted

`r5-fix-attacks.test.ts.txt` copied unchanged to `apps/api/test/` of the merged copy and run
(`PORTICO_TEST_DB_PREFIX=review_intstep6`): **4 FINDING tests fail, 4 CLEAN tests pass.**

| PoC | Refused at | Refused by | Right line? |
|---|---|---|---|
| R5-A1 (`no_show` label on an ordinary stay) | `:242` (setup, `methodFor`) | `mandate_limit_required` — the PoC's staff agreement has no `maxAmount` (rule 3) | **No — refused before the FINDING line `:269`.** The same attack with a `maxAmount` is the builder's flipped R5-A1 (`review-regressions-r5.test.ts:256`, `no_show_not_recorded`), which passes in the gate run (§ 1). Accepted as closed. |
| R5-A2 (paid deposit collected again as `no_show`) | `:307` | `no_show_not_recorded` | Yes |
| R5-C (desk confirms a `completed` link stopped) | `:408` | `forbidden` (finance role only) | Yes |
| R5-D (booking-level deposit after `add_stay`) | `:506` | `mandate_reference_not_covered` | Yes |

## 3. New findings

PoCs: `docs/orchestration/reviews/integration-step-poc/r6-fix-attacks.test.ts.txt` (drop into `apps/api/test/` as
`*.test.ts`). FINDING tests assert the defect and **pass on `333a83e` + main** (4 of 4 tests pass, 3 FINDING + 1 CLEAN).

### R6-P1-1 — Hold + capture pays an ordinary bill under a guarantee + no-show agreement (the R5-P1-1 harm, through capture)

- **Where:** `modules/payments/src/service/collect.ts:599-607` (capture consent uses `purpose: 'guarantee'`), `:651`
  (the stored purpose is `defaultPurpose(ref)` = `balance` / `deposit`); `consent.ts:252-256` (`purposeOk` for holds and
  captures is `guarantee || incidentals`); authorize `collect.ts:320-323`.
- **What:** Amendment 4 rule 1 says a purpose is derived from the record that justifies it. For charges it now is. For a
  capture, consent is judged against the fixed label `guarantee`, while the money lands as a folio `balance` (or a booking
  `deposit`). `assertWithinFact` is not called on capture, so the deposit-due and owed-now limits do not apply either.
- **Repro (PoC R6-A):** a card agreed for `['guarantee', 'no_show']` (the standard guarantee consent, `maxAmount` set);
  an ordinary USD 2,500 bill. `chargeNow` as balance → `mandate_purpose_not_covered` (correct). The desk then
  `authorize`s USD 2,500 on the folio (accepted: `guarantee` is agreed) and `capture`s it (accepted). The folio balance
  is 0; the payment row reads `balance:succeeded`. Both steps by `front_desk`.
- **Severity P1:** the same harm and the same role as R5-P1-1 (rated P1 in re-review #5); one more sibling of the class
  "consent judged on a label, not the fact".
- **Fix (principle, with instances):** *the purpose consent is judged against is the purpose of the money where it lands.*
  Record on the authorization, at hold time, which agreed hold purpose it uses (`guarantee` or `incidentals`). A capture
  derives the destination's purpose (`derivePurpose`) and needs it agreed: a `guarantee` hold is captured only as a
  recorded `no_show` / cancellation penalty; an `incidentals` hold as `balance`. Apply `assertWithinFact` to the capture
  amount. Instances: capture (`collect.ts:520`), recorded-hold completion (`recordPayment` with `authorizationId`,
  `collect.ts:1116`), hold increase (`:472`), and a VCC capture if one exists. Boundary to attack after the fix: a
  `guarantee` hold captured onto a booking (deposit), and a capture onto a folio of the same stay after a no-show.

### R6-P1-2 — A refund posting is neither money nor debt to finance's provenance, so moving it lets one guest's card pay another guest's refunded charges

- **Where:** `modules/finance/src/service/provenance.ts:125` (`if (p.kind === 'refund') return { kind: 'none' }`);
  `postings.ts:1386-1406` (a moved item whose root is `none` adds nothing to `movedMoney` or `movedDebt`, so neither
  `assertMoneyMayLand` nor `assertDebtMayLand` runs); `postings.ts:1243-1253` (`refund` is `TRANSFERABLE`).
- **What:** a refund posting is a debit: it consumes credit on the folio it sits on. Provenance ignores it, so it can be
  moved onto a folio that a saved card covers, and payments' `coverageProblem` (`debtOriginsOf`) does not see it there.
- **Repro (PoC R6-B):** Otto owes USD 300 (spa) and pays it by link. The GM refunds that payment (folio owes 300 again).
  The refund posting is transferred from Otto's folio to Vera's covered folio → **accepted**. Otto's folio is now 0 (his
  spa "paid" by a payment he got back). Vera's folio owes 300. The desk charges Vera's card 300 as balance → **accepted**.
  Vera's card paid Otto's spa.
- **Severity P1:** this is the R5-P1-2 harm (card money paying another guest's debt), and Amendment 4 rule 2 is the
  rule the round claims to close. The builder's writer list says transfers check "money and debt both"; that holds only
  for roots that are classified.
- **Fix (principle, with instances):** *every posting that changes a folio's balance has an owner in the provenance;
  there is no `none` for a non-zero posting.* A refund is debt of the owner of the payment it reverses (or of the folio
  it was first posted on); a payment with no payments-module id (cash, tender, cheque) is money with no agreement but
  its debit counterpart is still debt; and a transfer item whose root cannot be classified is refused while card money
  is on either folio (fail closed). Instances: `refund` (`provenance.ts:125`), `payment` with `payment_ref_type` other
  than `payment` (`:116-118`), `deposit_application` without a booking source (`:121-123`), a balance transfer whose peer
  is missing (`:105`). Boundary to attack after the fix: the refund moved first, then the card charged (this PoC), and
  the card charged first, then the refund moved onto the paid folio.

### R6-P2-1 — The recorded penalty is not reconciled with the ledger: after the penalty is credited off, an ordinary bill is taken as `no_show`

- **Where:** `modules/payments/src/service/purpose.ts:148-158` (the `no_show` limit is the reservations record minus
  `no_show` money collected, capped by the folio's whole balance); `reservations/src/service/provider.ts:110-121`.
- **Repro (PoC R6-D):** the night audit records a no-show (penalty posted). The GM credits the penalty posting in full
  (`adjustPosting`, "goodwill"); the folio is 0. The desk posts minibar and laundry for the same amount, then charges the
  guarantee + no-show card that amount as `no_show` → **accepted**. The cardholder's no-show consent paid an ordinary
  bill.
- **Severity P2:** same harm as R6-P1-1, but it needs a GM credit and a new charge on a no-show folio, and the amount is
  capped by the recorded penalty.
- **Fix (principle):** *a `no_show` collection rests on the penalty as it stands on the ledger*: what the penalty
  postings (no-show and cancellation charge codes, by their `penalty:*` keys) still owe on this folio, net of
  adjustments, transfers off the folio, routing and payments, never more than the reservations record. Instances:
  penalty credited (this PoC), penalty transferred to another folio, penalty routed away by a billing rule.

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R6-P3-1 | `finance/src/service/deposits.ts:728-740` (`forfeitDeposit` → `depositOutflow`) | A card-funded booking deposit can be kept as revenue (any charge code, any amount up to the balance held, free-text reason) without a recorded no-show or cancellation penalty. It is not a move between folios, so rule 2 does not name it. It is rule 1 again, though: whether the cardholder owes the hotel the deposit rests on a staff label. The builder's writer list leaves it out. Code-read only. | Forfeit up to the recorded penalty of the booking's stays (the same fact `purpose.ts` reads), or require the finance role and a reason code tied to the agreed terms. Add it to the writer list. |
| R6-P3-2 | `reservations/src/service/provider.ts:131-149` | `depositDue` sums the deposit items of **every distinct terms snapshot** of the live stays' segments. A stay with two segments on two snapshots counts its deposit twice. Stays sharing one snapshot count it once. So the "fact" can be larger or smaller than the booking's schedule. Code-read only. | Instantiate the schedule per stay, from the stay's terms and nights, and sum over stays. |
| R6-P3-3 | Builder's report § "Every writer that moves money or debt" | The list says transfers check "money and debt both". `refund` is transferable, but it is neither (R6-P1-2). Captures are listed as "consent plus the re-check", but their purpose is not derived (R6-P1-1). | Correct the claims when the fixes land. |

## 4. (b)–(e) Attacks that held

**(b) Class closure: inputs to `consentProblem`, `purpose.ts`, `cardMoneyMayMeet`, `provenance.ts` (code-read).**

| Input | Source | Verdict |
|---|---|---|
| `initiator` | server: guest actor + `entry_channel = hosted_entry` + `cardholder_ref` | Clean |
| `recordedBy`, `entry_channel`, evidence `at`/`channel`/`stayIds` | server (`accounts.ts:449`, `:459`, `:479`, `bookingConsentEvidence`); `recordedBy` is spread after the client mandate, so it cannot be overridden | Clean (R5-P3-1 closed) |
| client `scope.bookingEvidence` | kept only when `bookingIds` is empty, and then `ownerCoverage` returns `not_named` | Clean |
| purpose label | only `no_show` is read, and it requires a recorded penalty | Clean for charges. **Captures: R6-P1-1** |
| `depositDue` | terms snapshots (no staff writer) | Clean; precision R6-P3-2 |
| no-show penalty | `markNoShow` only (night-audit permission; the builder proves the desk gets 403) | Clean, but **not reconciled with the ledger (R6-P2-1)** |
| cancellation penalty | `planCancellation` from agreed terms; a waiver needs `bookingWaivePenalty` and records no fact | Clean |
| folio balance (`folioOwedNow`) | the ledger. Staff can post charges to a folio, so "balance" includes what the desk posts. That is the card-on-file bargain the agreement's `balance` purpose and `maxAmount` describe, not a label | Accepted by design (note) |
| debt origins / money on a folio | `folioProvenance` | **`refund` is unclassified (R6-P1-2)** |
| `maxAmount`, `purposes`, `bookingIds`, `folioIds` of a staff-recorded agreement | staff attestation (Amendment 4 rule 3, Q160) | By design |

**(c) Where money lands: writers checked beyond the builder's list.**

| Writer | Checked? | Result |
|---|---|---|
| `transferPostings` items: charge, tax, adjustment, payment, deposit_application, paid_out, allowance_usage, transfer_in | money/debt by root | Clean (code-read) |
| `transferPostings` item `refund` | root `none` | **R6-P1-2 (PoC R6-B)** |
| balance transfer (no items) | debt of the source folio; the amount is always positive (`contracts.ts:285`), so a credit cannot be pushed out as a balance | Clean |
| `reverseEntry` | charges only (`postings.ts:1814`) | Clean |
| `adjustPosting` | follows `corrects_posting_id` to the original | Clean for coverage; feeds R6-P2-1 |
| `prepareDestination` (supplementary folio) | same owner (`folios.ts:455`); the payment is found by id in its provenance | Clean |
| billing rules: create / update / merge, rule owner `group` | `assertRoutingCovered`; `group` fails closed (`not_named`) | Clean |
| `transferToReceivables` | moves debt only (`receivables.ts:342` excludes payment, refund and deposit_application) | N/A confirmed |
| `forfeitDeposit` | not checked | R6-P3-1 |
| reservations stay move / booking merge | no such command in `reservations/src/contracts.ts`; folio owners never change | N/A |
| hold → capture onto a folio or booking | coverage yes; purpose and fact no | **R6-P1-1** |

**(e) Front-desk flows after the class fix.** No P1 regression found.

| Flow | Evidence | Result |
|---|---|---|
| Walk-in pays their own folio at the terminal | `recordPayment` `external_terminal` takes no consent path and no fact limit (`collect.ts:1085-1116`); only the label `no_show` is checked | Works (code-read) |
| Corporate card named for the booking pays the master folio its stay is routed to | **PoC R6-C, CLEAN**: routing accepted, card accepted for USD 400 | Works |
| Deposit by payment link | builder's `paidDepositLink` path; links are not fact-bounded (`requests.ts` has no `assertWithinFact`) | Works |
| No-show fee after the night audit | builder's flipped R5-A1: accepted up to the penalty, refused above it | Works. Note: if a billing rule routes the stay's charges elsewhere, the stay folio owes 0 and the fee cannot be taken by card on either folio (`purpose.ts:53`, `:152`). Reported as a P3 note, not raised |
| Deposit by saved card when the rate has no deposit schedule | `deposit_not_due` (due 0). The message points to a link; a MOTO deposit can be recorded | By design

## 5. (d) Verify the proof: mutants

Each mutant was applied alone in the merged copy. I ran the full payments and api suites (`review_intstep6m` prefix),
then reverted with `git checkout`. The tree was clean afterwards.

| Mutant | Planted at | Payments module | api | Verdict |
|---|---|---|---|---|
| Builder **N7** (folio debt origins) | `consent.ts:164`, the origin loop iterates `[]` | 1 failed (`review-r5-regressions` "charges moved or routed onto a named folio…") | 3 failed (transfer sibling, routing sibling, post-lock re-check) | **Killed**, matching the builder's table |
| Builder **N8** (destination re-check under the lock) | `collect.ts:829` removed | 0 failed | 1 failed (post-lock re-check, held transfer) | **Killed**, matching the builder's table (api only) |
| Reviewer **R6-M1** (`cardMoneyMayMeet` ignores card payments by their folio reference: in-flight or unposted card money) | `consent.ts:337` (`folioIds.length < 0`) | 1 failed (same module origins test) | **0 failed** | **Killed** by the module suite only. In the composition, posted payments are also found by id through provenance, so no api test proves the case only this source covers: card money still `processing` or `pending_verification`, not yet on the ledger, when charges are moved or routed onto that folio. Not a survivor. Worth one api test (proof-strength note, no severity). |

The mutation proof holds for the guards it names. Both P1s sit **outside** the guards the table lists: the capture
purpose and the `refund` root. No mutant could have found them.

## 6. Notes for the orchestrator

- Both P1s come from the same pattern as the last four rounds. The builder closed the paths the review named, plus the
  siblings on its own list. The list itself was not derived from the invariant:
  - for consent: "every use is judged on the purpose of the money where it lands";
  - for provenance: "every non-zero posting is money or debt of someone".
- Suggest the fix round derive both lists from the code mechanically:
  - every `insertPayment` call site with its consent purpose;
  - every posting `kind` with its `rootOf` classification, plus a test that fails when a new kind is added unclassified.
- R6-P1-2 needs `finance.posting.transfer` and a refund, which are GM / supervisor permissions, not the front-desk
  template (`identity/src/domain/role-templates.ts`). R6-P1-1 needs only `front_desk`.

## 7. Coverage declaration

### Checklist

| # | Item | Status |
|---|---|---|
| 1 | Module boundaries | probed: lint boundary check exit 0; finance asks payments through its port and never reads an agreement (code-read) |
| 2 | Authorization | code-read: role templates checked for transfer, refund and adjust (§ 6); R5-C still `forbidden` |
| 3 | Money and finance principles | probed: findings R6-P1-1, R6-P1-2, R6-P2-1, R6-P3-1 |
| 4 | Idempotency and concurrency | code-read only: no new lock paths in round 5 beyond `assertRoutingCovered` (collection lock first); N8 proves the post-lock re-check |
| 5 | Tenant isolation / RLS | not probed: round 5 added no tables (only a jsonb column on `reservations.stays`), and the gate suite's isolation tests pass |
| 6 | Contracts | code-read: the purpose label is accepted and ignored except for `no_show` |
| 7 | Audit | not probed: out of focus |
| 8 | Errors and UX contract | code-read: the new messages state the problem and the recovery |
| 9 | Spec coverage (Amendment 4 rules 1–4) | probed: rule 1 broken by R6-P1-1 and R6-P2-1; rule 2 broken by R6-P1-2; rule 3 holds (R5-A1 refused at setup); rule 4 holds (R5-C) |
| 10 | Tests and evidence | probed: § 5 |
| 11 | Honest readiness and claims | code-read: R6-P3-3 |
| 12 | Migrations | code-read: `0005_consent_facts.sql`, `0002_stay_cancellation_penalty.sql` are append-only; applied from scratch in the gate run |

### Patterns (focused subset; full sweep not repeated in a focused re-review)

| Pattern | Status |
|---|---|
| AP-04 (client label used as a fact) | probed: R6-P1-1 (capture purpose) |
| AP-08 (reverse order) | probed: R6-B runs refund-move first, then charge; the reverse (charge, then refund-move) is the same path by code-read |
| AP-22 / AP-28 (amount not bound to the agreed fact; paying twice) | probed: R6-P2-1, R6-P1-2 |
| AP-36 (sibling writers) | probed: § 4 (c) table |
| AP-42 (one source for derived lists) | finding feeds § 6 note |
| AP-54 (load-bearing mechanism) | probed: provenance is now load-bearing for consent, and its `none` root is R6-P1-2 |
| AP-56 (lock order) | code-read only: clean |
| UI patterns | not applicable (UI review: no) |

**Not reached within the budget:**
- a 10-round concurrency re-run;
- allowance grant/close postings (`allowances.ts:291`, `:475`), code-read only by name;
- the hold-increase path's purpose (`collect.ts:472`), folded into R6-P1-1 by code-read and not probed;
- a full pattern sweep.
