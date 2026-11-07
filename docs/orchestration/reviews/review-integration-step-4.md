# Steward re-review #4 (focused, after fix round 3): `feat/integration-step`

Reviewer: architecture steward · 2026-11-07 · playbook v2.1, variant "focused re-review" (money paths only).

- Branch `feat/integration-step` @ **`1424662`** (`1424662d12f8666b2b62398804b9c8993598c5e9`). The worktree
  `/home/user/wt/integration-step` was not modified.
- `main` @ `e4954c1` (chronicle only since the branch's last merge).
- Scratch copy: `git worktree add --detach` at `1424662`, then `main` merged in (copy commit `8c68698`, no conflicts).
  The copy was removed at the end.
- Fix-round-3 commits read line by line: `7026624` (payments, finance), `915d82b` (reservations, api), `7b0c59c`
  (tests, docs), `1424662` (style), `5e6605c` (merge).
- Inputs: review #3 and its PoCs (`r3-*`), ADR-0015 Amendments 1 and 2, `modules/payments/README.md`, domain map
  § "Integration-step fix round 3", the patterns library (AP-01 … AP-62).

## Verdict: **merge after fixes**

Every r3 attack is now refused:
- all 9 first-review PoCs (inverted; one fixture adapted to Amendment 2);
- all 8 r3 `FINDING` tests now fail at, or one line before, their `FINDING` assertion, so each defect is gone;
- the R3-D1 label attack is re-run inverted and is refused.

All gates are green on the merged copy, and lint is clean (0 warnings). The request lifecycle holds where the builder
said it would:
- two closes racing (10 interleavings, both orders seen);
- a link created for a request that was closed meanwhile (now a deterministic test);
- a scope-less legacy agreement, refused on charge, hold, increase and capture.

Going one step beyond the fixes finds **two P1s on the consent claim**:

1. **R4-P1-1: the bookings a standing agreement covers are decided by links the charging role writes.**
   - A front-desk agent creates a booking for Otto that names Vera as booker. Vera's card is then charged USD 5,000
     for it.
   - Worse: one routine `add_stay` change puts Vera as an occupant on Otto's existing booking. Vera's card then pays
     USD 2,500 onto **Otto's original stay folio**.
   - This is the R3-F1 harm with one extra audited step by the same role. The harness's default card on file has no
     amount limit.
   - Payments' own contract comment says "staff linking the cardholder to another booking never extends the consent".
2. **R4-P1-2: the `maxAmount` running total is read without a lock.**
   - Five concurrent USD 100 charges on a USD 100 agreement all succeed: **USD 500** taken.
   - The probe reproduced in 4 of 4 runs (USD 500, 300, 500, 500).

Counts: **P0 0 · P1 2 · P2 2 · P3 6.**

---

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep4`)

Exit codes were captured directly (`echo $? > file`), never from piped output.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | **exit 0**: 847 files, **0 warnings** (R3-P3-2 closed); "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 2m13s |

Per-package test counts:
- api: 129 passed, 29 todo (34 files, 8 skipped);
- payments 142 · finance 92 · reservations 154 · guests 192 · identity 153 · integration 173;
- rates 130 · operations 120 · inventory 98 · platform 62;
- ui 87 · backoffice 53 · kernel 26 · db 17 · http 3.

Probe runs in the copy (all type-check under `apps/api`'s `tsc --noEmit`, exit 0):

| Run | Result |
|---|---|
| `r3-inverted-original-pocs`, as written | 8/9. The P2-1 (fd15) PoC fails **in its setup** with `mandate_reference_not_covered`: it charged a random-owner card for a booking deposit, which is exactly what Amendment 2 refuses. Adapted to a card owned by that booking: **9/9** (`r4-inverted-r3-original-pocs`). |
| `r3-fix-attacks`, as written (each test asserts its defect) | **8 `FINDING` tests fail, so the defects are gone.** Seven fail at their `FINDING` line: B1 `:177`, B2 `:261`, B3 `:340`, D1-family `:518`, F1 `:628`, G1 `:650`, C1 `:750`. D1-label fails one line earlier (`:440`), because `custom` is now refused by consent (`mandate_purpose_not_covered`) before the guard. It is re-run inverted in `r4-fix-attacks` and is **clean**: `incidentals` and `deposit` give `collection_owned_by_payment_request`, and `custom` gives `mandate_purpose_not_covered`. The B4 lock probe and R2-H inverted pass (clean). |
| `r4-fix-attacks` (new, 13 tests) | 8 assert a defect and pass: R4-A, A2, B, C, D1, D2, E, J. 4 assert a clean outcome and pass: F, G, K, R3-D1 inverted. The R4-H probe asserts the safe outcome and **fails intermittently**: a deadlock in 3 of about 88 rounds. |

Databases: the harness dropped every `review_intstep4*` database, and none remain.

---

## 2. Earlier findings: closed?

| ID | Status | Evidence |
|---|---|---|
| R3-P1-1 (i) settle to receivables | **Closed** | r3 B1 fails at `:177`; builder regression; `receivables.ts:460` syncs |
| R3-P1-1 (ii) deferral end | **Closed** | r3 B2 fails at `:261`; the open item reads "Deferred …"; consumer `finance.departed-folio-payment-ended` (`finance/service/index.ts:750-766`) |
| R3-P1-1 (iii) re-issued link payable | **Closed as stated**; one step beyond → **R4-P2-1, R4-P2-2** | r3 B3 fails at `:340`; the old link refuses payment; R4-F and R4-G are clean |
| R3-P1-2 mandate scope not enforced | **Closed on the direct path**; one step beyond → **R4-P1-1, R4-P1-2** | r3 F1 fails at `:628`. R4-K: a scope-less agreement is refused on all four paths |
| R3-P2-1 label / family | **Closed** | r3 D1-family fails at `:518`; R3-D1 inverted is clean. Carve-out → R4-P3-3 |
| R3-P2-2 money issues | **Closed** | r3 G1 fails at `:650`; handover and record code-read (`issueForReader`) |
| R3-P2-3 concurrent imports | **Closed** | r3 C1 fails at `:750` (one import rejected, 10,000) |
| R3-P2-4 invariant (e) owner | Marked DONE through consent | **Re-opened as R4-P1-1** (AP-54: it now carries the consent claim) |
| R3-P3-1 guest actor | Closed for charges; latent siblings → R4-P3-6 | `consent.ts:67-76` |
| R3-P3-2 lint | Closed | 0 warnings |
| R3-P3-3 lock order | **Closed for folio writers**; one inverter left → **R4-P3-2** | `lockMoneyFolios` is used in every balance writer that syncs |
| R3-P3-4 `makeExternal` | Closed | `harness.ts:343-344` uses `org_admin` staff and the composition's ports |

---

## 3. The builder's claims, verbatim, attacked one step beyond

| Claim | One step beyond | Result |
|---|---|---|
| "Hotel staff can no longer take money from a stored card beyond what the cardholder agreed to … a stored agreement without a recorded scope is now refused" | (1) A scope-less legacy row on charge, hold, increase and capture (R4-K). (2) The cardholder linked to a booking by staff, at creation (R4-A) or by `add_stay` (R4-A2). (3) Concurrency (R4-B). | (1) **Holds.** (2) **Fails: R4-P1-1.** (3) **Fails: R4-P1-2** |
| "maxAmount caps everything taken on the card under the agreement … custom is never a covered purpose" | Concurrent charges (R4-B); holds at once (R4-C); refunds and reversals restoring headroom, and currency mixing (code-read) | `custom` **holds**. Refunds and adjustments never restore headroom (gross sum, conservative) and currencies cannot mix (every path requires the cap's currency; scopes are immutable): **clean**. Concurrency **fails (R4-P1-2)**. Holds at once **fail (R4-P3-1)** |
| "the guest no longer receives a new payment link until the old one is confirmed dead at the provider … while the provider is down, the old link stays marked possibly payable and the replacement waits" | Paid before deactivated (R4-D1); expiry (R4-D2); a provider that never answers (R4-E); two closes racing (R4-G); a link created for a request closed meanwhile (R4-F); reconciliation retries; `already_completed` (code-read) | True as stated (F and G clean). But the replacement waits **forever, with no owner**, while the item says "send it" (**R4-P2-2**). A payment on a retired request is raised as "refund all of it" even when the guest owes it, and `already_completed` releases a replacement asking for money just paid (**R4-P2-1**) |

---

## 4. New findings

### R4-P1-1 — A standing agreement covers whatever booking the charging role links the cardholder to

**Where:**
- `modules/payments/src/service/consent.ts:128-134`: with no `bookingIds`, coverage is `ctx.people.has(ownerKey)`.
- `ctx.people` comes from `shared.ts:241-260` (`referenceContext`). It holds the folio payer, plus reservations'
  `bookingPeople` (`reservations/src/service/guarantee.ts:66-88`): booker, every stay's occupants, company, agency
  and accommodation payer.
- Every one of these is written by staff:
  - `createBooking` (`reservations.booking.create`);
  - `add_stay` (`changes.ts:399-401`, `reservations.booking.update`);
  - finance `openFolio` payer (`finance.folio.manage`);
  - guest-profile merge, which moves the card and repoints booker and occupants (`accounts.ts:755`,
    `subscriptions.ts:168`).
- The "card the guest entered for a booking" exemption (`consent.ts:80-92`, `:130-131`) covers any stay that is later
  `add_stay`ed into that booking. That was code-read; no booking move, split or merge exists today (`stays.booking_id`
  and folio owner and payer are written only at insert).

**Attack:**
- **R4-A:**
  1. Vera has a standing card-on-file agreement (the harness default: all purposes, **no `maxAmount`**, no
     bookings).
  2. Her card on Otto's booking: `mandate_reference_not_covered` (the R3-F1 fix holds).
  3. The desk agent creates a booking for Otto with Vera as booker.
  4. A `reservations_agent` designating Vera's card as its guarantee: `guarantee_method_not_allowed` (Amendment 1
     holds).
  5. The **desk agent charges Vera's card USD 5,000** for it: `payment: succeeded, ledger: posted`.
- **R4-A2 (existing booking):**
  1. Otto's booking, with his own stay folio. Vera's card on that folio: refused.
  2. The desk agent previews and commits `add_stay` with Vera as occupant of a one-night extra stay.
  3. Vera's card now pays **USD 2,500 onto Otto's original stay folio**: succeeded and posted.

**Why P1:**
- It is the R3-P1-2 / SW-PAY-4 harm: a merchant-initiated charge outside the cardholder's agreement, onto another
  guest's bill. Here the amount is unlimited, and it takes one routine, audited step by the role the control
  restrains (AP-57).
- **The claim is contradicted in the code's own words:** `contracts.ts:138-141` says "staff linking the cardholder to
  another booking never extends the consent (Amendment 1)". Amendment 2 says another booking "needs new cardholder
  consent … no staff permission can stand in for it".
- **AP-54 re-rating:** review #3 noted that booking people "are written by reservations agents (AP-57)" and rated
  exemption 1 P2. Fix round 3 made those people the **coverage of the consent itself** and marked invariant (e) DONE
  in `pending-fixes.md`. The weakness is now load-bearing, so it takes the fix's severity.
- This traces partly to review #3's own recommendation (a) for R3-P2-4 ("payer directory"), which did not attack
  the directory's writers. That is a recommendation defect, recorded for RC-9.

**Fix (principle):** what a cardholder's consent covers is fixed by facts the cardholder created or confirmed. A link
the charging staff can write, or a merge they can perform, never widens it.

Instances to close:
- booker, occupants, company, agency and accommodation payer, at creation and through `add_stay` and channel modify;
- the folio payer;
- the guest-profile merge (the card's owner and the repointed people);
- `add_stay` into the booking a card was entered for (the hosted-entry exemption);
- any future booking move, split or merge.

Suggested default (conservative and reversible):
- A **guest's** standing agreement covers only the bookings it names. Any other booking needs new consent: a link or
  the terminal. When the cardholder confirms through one of those, the booking id is appended to the agreement with
  its evidence.
- A **company or agency** card's agreement states "bookings billed to this account" explicitly, and carries a
  mandatory per-booking cap.
- If the owner wants "card on file for future stays" for guests, record it as an explicit coverage kind with its
  evidence, a mandatory per-booking cap, and coverage only where the cardholder was booker **at creation** (never
  added later). Each first merchant-initiated use on such a booking must be visible to finance. This is an
  `OPEN_QUESTIONS` item; the default above applies until the owner answers.
- Align reservations' designation path (`guarantee.ts:32-63`, exemption 1) with the same coverage.

**Attack run against the fix:**
- A staff member "confirms" by sending a link to an address they control. A link is paid by whoever types the card,
  never with the stored token, so the stored card stays out of reach.
- A booking created with the cardholder as booker is still covered under the owner-optional variant. That residual is
  bounded by the cap and the visible first-use record, and it is the owner's explicit choice.
- Boundary cases attacked: creation (R4-A), `add_stay` (R4-A2), merge (code-read).

### R4-P1-2 — The `maxAmount` running total is read without a lock: parallel charges pass it N times

**Where:**
- `consent.ts:145-170` sums the card's merchant payments with a plain `SELECT`.
- The card row is read without a lock in `collect.ts:103-108` (`loadUsableMethod`), `:455-459` (increment) and
  `:586-590` (capture).
- In `charge` the consent check (`:766`) runs **before** the collection lock (`:772`). The collection lock is per
  booking family anyway, and the unique "one in flight" index is per reference, so neither protects a total across
  references.

**Attack (R4-B):**
- A card agreed for deposits on five named bookings, at most USD 100 in total.
- Five `chargeNow` calls of USD 100, one per booking, are started together.
- Result: all five `succeeded/posted`, **USD 500 taken**. Reproduced in 4 of 4 runs (USD 500, 300, 500, 500).
- Sequentially the builder's "five charges of 100" test holds. This is the same split-charge bypass, done in parallel.
- Sibling: the mandate's revocation (`detachMethod`, `accounts.ts:553-582`) does not serialize with a charge that has
  already read the card (AP-56).

**Why P1:** "Money-moving operations … enforce [limits] with unique constraints, not only in memory" (CLAUDE.md §4.7).
The cap is the load-bearing control of the R3-P1-2 fix. Exceeding it collects real money beyond the cardholder's
agreement, posted to the ledger, and needs no special permission.

**Fix (principle):** a running total that bounds money is read under a lock that every writer to that total takes
first.

Instances:
- `charge` (including the VCC run and every port caller);
- `capture`;
- `authorize` and `incrementAuthorization` (and the hold-at-once total, if R4-P3-1 is fixed);
- `detachMethod`, and the profile-merge repoint of cards.

Lock: `SELECT … FROM payments.payment_methods WHERE id = $1 FOR UPDATE` (or an advisory `payments:card:<id>`), taken
before `consentProblem`. Documented order: authorization row → card → collection → folio → request.

**Attack run against the fix:**
- `capture` already holds the authorization row before the card lock. The authorization outcome
  (`operations.ts:723-738`) also locks the authorization and then the card, so the order stays consistent.
- No path takes the card after the collection lock (grep of `payment_methods` writers).
- Under READ COMMITTED, the second locker re-reads the sum after the first commits, so it sees the first payment.
- Write the order into the domain map.

### R4-P2-1 — A payment on a retired request is raised as "refund all of it", even when the guest owes it; `already_completed` releases a stale replacement

**Where:**
- `operations.ts:1017-1035`: on a `cancelled` or `expired` request, `excess = amountMinor` (the whole payment).
- `requests.ts:407-409`: `already_completed` counts as deactivated and releases the waiting replacement, whose amount
  was computed **before** that payment.
- `reconcile.ts:251-268`: expiry closes a request **without** retiring its link.
- The simulator never returns `already_completed`. A paid simulator link can still be "deactivated" and paid again
  (`simulator.ts:683-705`, `:834-843`), so no test can reach these branches (AP-41, AP-59).

**Attack:**
- **R4-D1 (the builder's own "one step beyond" scenario):**
  1. The folio owes USD 351. Link #1 (USD 234) is retired while the provider is down.
  2. The guest pays link #1, and the folio now owes USD 117.
  3. The urgent item reads "The guest has probably paid **$234.00 they do not owe** … **Refund $234.00**". Nothing
     was over-collected.
- **R4-D2:**
  1. The 7-day balance link expires. Its `link_status` stays `created`, and the simulator still takes payment.
  2. The guest pays exactly the USD 234 owed, and the folio goes to 0.
  3. The urgent item says "Refund $234.00".
- Following either instruction refunds money owed by a guest who has left. The builder's test asserts only
  `severity: 'urgent'` (AP-55).

**Fix (principle):** the amount to refund after money arrives on a retired request is what its reference no longer owes
once that money is posted, never the payment by default. A replacement is released only when the old link is known
dead **and** its payments are accounted for.

Instances:
- replaced (re-issued), closed at zero, expired, closed-as-paid, staff cancel;
- on `already_completed`, keep the replacement waiting until the old link's payment is recorded (webhook or lookup),
  then re-run the sync;
- expiry retires the link like a cancel;
- the simulator models `already_completed` and one payment per Checkout-style link.

**Attack run against the fix:**
- The webhook for the old link never arrives. The event backstop, plus a lookup by link reference, ends the wait.
  If neither answers, it falls under R4-P2-2's owner and deadline.
- Excess computed from the folio's balance after posting: when it is negative, refund at most that credit. When the
  balance cannot be read, the item says "check before refunding", never a figure.

### R4-P2-2 — A provider that never confirms leaves the replacement waiting forever, with no owner, while the item says "send it"

**Where:**
- `requests.ts:409`: `failed` and `unknown` both return `pending`.
- `reconcile.ts:121-125` retries `deactivating` rows with `limit`, no order and no back-off. Permanently failing rows
  can starve newer ones.
- No exception is raised anywhere (grep `deactivating`).
- `departed-folios.ts:100` writes "A payment link for X is open — send it to …" for `reissued`, while the new request
  has no link (`link_status: pending`, `link_url: null`).
- `:133` resolves the item with "the payment link was cancelled" while the old link is still `deactivating`.

**Attack (R4-E):**
1. Outage, then a re-issue, then three reconciliation runs.
2. State: `{cancelled, deactivating}`, `{open, pending, link_url null}`.
3. Payments exceptions: **none**.
4. Late-charge item: "…now owes $351.00. A payment link for $351.00 is open — send it to Elena Ivanova".

**Why P2:** the debt is never asked for, and nobody owns that (AP-61). The staff text claims a link exists that does not
(AP-26). Not P1: no money moves wrongly.

**Fix (principle):** every "possibly live" external state has an owner and a deadline.

Instances:
- `deactivating` older than N minutes, or any `failed` outcome, raises an urgent payments exception. Its next step:
  stop the link in the provider dashboard and confirm in Portico, or send the replacement with an explicit
  acknowledgement of the double-pay risk.
- The late-charge item says "waiting for the provider to stop the old link" until the new link exists.
- A resolved item says "old link still being stopped" while it is `deactivating`.
- Reconciliation takes the oldest first, with back-off.
- The unknown-reference recovery (`requests.ts:377-384`) sends the **original** amount, so the provider's idempotency
  check matches.

**Attack run against the fix:** the dashboard step is done, and then the provider confirms late. Confirming is
idempotent (`where link_status = 'deactivating'`), so nothing is released twice.

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R4-P3-1 | `consent.ts:15-17,153-163` | "The most it may hold at once" is checked per hold. **R4-C:** two USD 100 holds stand at once on a USD 100 agreement (USD 200 of the cardholder's credit blocked). Captures are capped (the second is refused). The builder's "split holds" sibling test has no two-hold case (AP-55). | Count open holds (`authorized`, `partially_captured`: amount minus captured) in the hold check, under the R4-P1-2 card lock. |
| R4-P3-2 | `finance/service/deposits.ts:443-448` (deposit account `FOR UPDATE`) before `:518` `lockMoneyFolios` (collection lock). The link webhook is collection → `recordDeposit` → deposit account. | **Lock order inverted (AP-36), reproduced:** `deadlock detected` in 3 of about 88 rounds (R4-H). The webhook's ledger posting is the victim: an urgent `ledger_posting_failed` item is raised and reconciliation retries; or the check-in deposit step fails. No corrupt state. | In `applyDeposits`, take `lockMoneyFolios` (collection lock) before the deposit-account row. Add deposits to the domain-map order. |
| R4-P3-3 | `collect.ts:163-164,187-194` | Exemption "a balance after a paid deposit link needs no reason". **R4-J:** before check-in applies the deposit, a USD 300 `balance` charge on a folio owing 0 is accepted without a reason. The folio goes to −30,000 while the deposit of 30,000 is still held. | Free only when the charge does not exceed the folio's current balance (which nets applied deposits). Otherwise the separate-collection reason is required. |
| R4-P3-4 | `contracts.ts:126,135`; `consent.ts:117-121`; `collect.ts:81` | Purpose taxonomy: the mandate purpose `no_show` never matches a use (charges carry `CollectionPurpose`, which has no `no_show`). Under a guarantee and no-show consent with no pre-authorization, a no-show fee cannot be charged (fails closed) (AP-60, AP-42). The contract says `maxAmount` is "per use"; the code and domain map say "total" (AP-62). | Map no-show and cancellation charges to `no_show` (a charge purpose, or a `reason` passed by reservations). Fix the contract comment. |
| R4-P3-5 | `providers/stripe-connect.ts:396-415`, `:438-470` | Latent (R1 adapter): Checkout `expires_at` is set to the request expiry (7 days for balance requests). Stripe accepts at most 24 h, so those links would fail. `deactivatePaymentLink` has no recorded-response unit test, although the README says "simulator and Stripe adapters deactivate links" (AP-50). | Cap the session expiry, or re-issue daily. Add unit tests for expire → `complete`/`expired`/error. |
| R4-P3-6 | `collect.ts:585` (capture consent only when `a.initiator === 'merchant'`); `consent.ts:72` | Latent (no guest-actor surface yet): staff can capture a **customer-initiated** hold onto any folio at the property with no consent check. A guest acting for booking X may use any card owned by booking X, including the OTA's virtual card or a staff-entered card. | Capture of a customer hold stays on its own booking family. Customer-initiated use only of cards with `entry_channel = 'hosted_entry'` entered by that guest. |

---

## 5. The exemptions added in round 3, each attacked

The builder's round-3 report is not in the repository, so these are the five exemptions the round-3 code adds:

| # | Exemption (code) | Attack | Safe? |
|---|---|---|---|
| 1 | A card its cardholder entered for a booking is consent for that booking's guarantee, deposit, balance and no-show, with **no cap** (`consent.ts:80-92`) | `entry_channel` declared by staff (server-derived `hosted_entry` only for a guest actor, `accounts.ts:448-449`: clean). Booking move, split or merge: none exist (code-read). **`add_stay` into that booking:** covered, code-read | No → **R4-P1-1** (instance) |
| 2 | A standing agreement covers "the cardholder's own bookings and bills" (`consent.ts:132-134`) | Booking created naming the cardholder (R4-A); `add_stay` (R4-A2); folio payer; profile merge | **No → R4-P1-1** |
| 3 | Holds are not in the running total, and any hold is covered by `guarantee` or `incidentals` (`consent.ts:121,154`) | Two holds at once (R4-C); captures capped (clean) | Partly → **R4-P3-1** |
| 4 | A balance after a paid deposit link needs no reason (`collect.ts:163-164`) | Balance charged before the deposit is applied (R4-J) | Partly → **R4-P3-3** |
| 5 | A payment on a retired link is accepted (urgent refund), and `already_completed` counts as dead (`operations.ts:1017`, `requests.ts:407-409`) | Paid before the deactivation is confirmed (R4-D1); expired (R4-D2); `already_completed` (code-read; the simulator cannot produce it) | **No → R4-P2-1** |

The pre-existing deferral exemption (review #3's exemption 4) now **holds**: the r3 B2 PoC is flipped, the item stays
open, and the consumer re-syncs on success or failure.

## 6. Lock order: collection → folio → request

| Path | Order | Result |
|---|---|---|
| Finance balance writers (postCharge, recordPayment, recordRefund, transfer, adjust, reverse, receivables, payment adjustment, resync) | `lockMoneyFolios`: collection → folio → (sync) request | Clean (code-read; the R3-B4 probe stays clean) |
| Link webhook | collection → request → folio or deposit account | Clean against folio writers |
| `applyDeposits` | **deposit account → collection → folio** | **Inverted: R4-P3-2** (reproduced) |
| `capture` | authorization → collection | Clean: no path takes collection → authorization |
| VCC run | virtual card → collection | Clean: the outcome path takes no collection lock |
| `postCharge` (billing-rule caps), `transferToReceivables` (AR account) | rule or AR row → collection | Clean: no payments path locks these rows |
| `cancelPaymentRequest`, `ensurePaymentLink`, `ensureLinkDeactivated` | request row only | Clean (R4-G: 10 interleavings, no deadlock) |
| Lock key | `referenceContext` reads (no locks) before the advisory lock | Clean. Forward note: the key and `family_booking_id` follow the stay's **current** booking; revisit if a stay move between bookings is ever built |

## 7. Pattern sweep steps 2–6 against the fix commits

**Step 2, reverse order (AP-08):**
- The cardholder linked **after** the agreement (R4-A2).
- Payment before deactivation (R4-D1).
- Cancel before or after the sync (R4-G, both orders seen).
- Close before link creation (R4-F).

**Step 3, attack the fix:** stated in each finding. Each fix is written as a rule with instances.

**Step 4, sibling paths (AP-45, AP-60 grid):**

| Consent path | Entity and property | Purpose | Bookings | Amount | Scope required |
|---|---|---|---|---|---|
| `charge` (+ VCC run, port callers) | `consent.ts:107-116` | `:118-120` (`no_show` unmapped: R4-P3-4) | `:128-144` (R4-P1-1) | total, no lock (R4-P1-2) | `:101` (R4-K clean) |
| `authorize` | yes | yes | yes | per hold (R4-P3-1) | yes |
| `incrementAuthorization` | yes | yes | yes | hold total | yes |
| `capture` (merchant hold) | yes | `guarantee` | yes | total, no lock | yes |
| `capture` (customer hold) | — | — | — | — | — (R4-P3-6, latent) |
| guarantee designation (`assessGuaranteeCard`) | yes | yes | yes, people (R4-P1-1) | per hold | yes |

Lifecycle transitions × "retire the link first": cancel (yes), re-issue (yes), close at zero (yes), close as paid (yes),
**expire (no: R4-P2-1)**, created after close (yes, R4-F).

**Step 5, privilege equivalence (AP-09):**
- `reservations.booking.create` and `reservations.booking.update` (front desk, reservations agent) now reach "widen a
  cardholder's standing consent to any booking". With `payments.payment.collect`, that means charging any standing
  card for any booking: R4-P1-1.
- `finance.folio.manage` (folio payer) and `guests.profile.merge` reach the same.

**Step 6, load-bearing (AP-54):**
- R4-P1-1 is itself the re-rating of review #3's people-links gap.
- The R4-P1-2 fix relies on a lock order with one known inverter (R4-P3-2, which involves no card rows). Fix both
  together and write the order down.
- The R4-P2-1 fix relies on the simulator modelling `already_completed` (AP-41), so it is included in that fix.

---

## 8. Coverage declaration

### Checklist 1–15

| # | Item | Result |
|---|---|---|
| 1 | Tenant isolation | Code-read: migration `0003` only adds columns and an index to an RLS table. Clean |
| 2 | Authorization | **Probed** (R4-A, A2): R4-P1-1 |
| 3 | Money and finance | **Probed** (R4-B, C, D1, D2, J): R4-P1-2, R4-P2-1, R4-P3-1, R4-P3-3 |
| 4 | Idempotency and concurrency | **Probed** (R4-B, G, H, F, genuinely concurrent): R4-P1-2, R4-P3-2; G and F clean |
| 5 | Events and audit | Code-read: `linkDeactivated` and `balanceSync` audited; the consumer is idempotent. Clean (first-use visibility belongs to the R4-P1-1 fix) |
| 6 | Contracts | Code-read: domain-map round-3 section matches the code. Drift: R4-P3-4 (`maxAmount` "per use") |
| 7 | Data authority and environment safety | Code-read: deactivation goes through `registry.forAccount` (`assertExternalEffectAllowed`); `syncBalanceRequest` asserts writability. Clean |
| 8 | Errors and UX contract | **Probed**: R4-P2-1 (false refund instruction), R4-P2-2 ("send it" with no link) |
| 9 | Spec coverage | Not probed: focused re-review (no-show mapping noted, R4-P3-4) |
| 10 | Scenario claims | Code-read: the builder's r3 regression asserts the urgent severity but not the amount (R4-P2-1, AP-55) |
| 11 | Honest readiness | Code-read: payments README over-claims (R4-P1-1, R4-P1-2); Stripe deactivation untested (R4-P3-5) |
| 12 | Code quality | Code-read: no `any` or default exports in the fix diffs; lint has 0 warnings. Clean |
| 13 | One-product experience | **Probed** (r3 G1 flipped): clean |
| 14 | Parity gate | Not applicable: no parity file (run parameters) |
| 15 | Cross-module coherence | Code-read: purpose enums ×3 (R4-P3-4); people and payer mapping (R4-P1-1) |

### Patterns

| Group | Probed | Code-read only | Not applicable |
|---|---|---|---|
| A | AP-01 (R2-H inverted, clean), AP-04 (labels, `entry_channel`: clean), AP-08 (step 2), AP-09 (R4-P1-1), AP-18 (G1: clean), AP-57 (R4-P1-1), AP-60 (grid: R4-P1-2, R4-P3-1, R4-P3-4, R4-P3-6) | AP-02, AP-03, AP-15, AP-19 (a deactivation in a changed mode stays `pending`: folded into R4-P2-2), AP-53 (clean) | AP-05, AP-06 (no new routes or permissions), AP-07, AP-10…AP-14, AP-16, AP-17 |
| B | AP-20 (R4-P1-2), AP-22 (consent), AP-23 (±1, currency: clean), AP-26 (R4-P2-1, R4-P2-2), AP-28 (R4-J, D1), AP-29 (R4-D2, R4-P3-5, R4-E) | AP-21 (link and off keys: clean), AP-25 (refunds do not restore headroom: clean) | AP-24, AP-27 |
| C | AP-31 (R4-D1), AP-35 (R4-K: clean; no `maxAmount` means no cap: R4-P1-1), AP-36 (R4-B, R4-H), AP-56 (revocation race: R4-P1-2), AP-59 (R4-D1, D2, E, F) | AP-30, AP-32, AP-37, AP-38, AP-39 (clean) | AP-33, AP-34 |
| D | AP-41 (simulator: R4-P2-1), AP-45 (R4-A2, R4-D2), AP-46 (R4-H victim inside a savepoint: clean), AP-58 (R4-G ×10: clean) | AP-40, AP-43 (clean), AP-42 (R4-P3-4), AP-44 (`maxAmount` doc: R4-P3-4), AP-47 (R4-P2-2), AP-54 (applied, § 7) | AP-48 |
| E | AP-50 (claims table; R4-P3-5), AP-52 (forced gates: clean), AP-55 (R4-P2-1, R4-P3-1), AP-61 (R4-E), AP-62 (contract comment vs code: R4-P1-1, R4-P3-4) | AP-51 (regressions run on the composition, simulator only) | — |

Group F (UI) is not applicable: no UI review.

Totals:

| | Probed | Code-read only | Not applicable | Not probed |
|---|---|---|---|---|
| Checklist (15) | 5 | 8 | 1 | 1 (#9) |
| Patterns A–E (61; there is no AP-49) | 27 | 19 | 15 | 0 |

So **27 of the 46 applicable patterns** were probed.

---

## 9. Notes for the orchestrator

- **ADR-0015 Amendment 3 (suggested):** what a standing agreement covers, and that staff-written links never extend
  it. The owner question goes to `OPEN_QUESTIONS`: does a guest's card on file cover future stays they book by phone?
  The default until answered is named bookings only.
- **Domain map:** the full lock order is authorization → card → collection → folio → request, plus deposit account
  after collection (R4-P1-2, R4-P3-2).
- **Simulator fidelity (payments):** add `already_completed`, one payment per link, and provider-side expiry. Without
  them, the lifecycle tests cannot reach the branches that matter (AP-41).
- **Reservations:** `add_stay`, create and merge feed payments' consent through `bookingPeople`. Any future booking
  move, split or merge must be reviewed against payments' consent coverage and `family_booking_id`.

## 10. PoC files (`docs/orchestration/reviews/integration-step-poc/`)

Copy each file to `apps/api/test/<name>.test.ts` (it imports `./scenarios/harness`). Run it with `--silent=false` to
see the evidence lines.

| File | Proves |
|---|---|
| `r4-fix-attacks.test.ts.txt` | **FINDING tests (pass today by asserting the defect; flip the marked lines):** R4-A and A2 → R4-P1-1. R4-B → R4-P1-2. R4-C → R4-P3-1. R4-D1 and D2 → R4-P2-1. R4-E → R4-P2-2. R4-J → R4-P3-3. **Clean tests:** R4-F (deterministic close during link creation), R4-G (two closes ×10), R4-K (scope-less agreement on 4 paths), R3-D1 inverted. **Probe R4-H** asserts no deadlock and fails intermittently today; run it with `R4_ROUNDS_H=40` (R4-P3-2). |
| `r4-inverted-r3-original-pocs.test.ts.txt` | The first review's PoCs, inverted, with the fd15 fixture adapted to Amendment 2 (a card owned by the booking it pays): 9/9 |

`r3-fix-attacks` was run as written, with the results in § 1.
