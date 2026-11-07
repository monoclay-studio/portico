# Steward re-review #3 (focused, after fix round 2): `feat/integration-step`

Reviewer: architecture steward · 2026-11-07 · playbook v2.1, variant "focused re-review".

- Branch `feat/integration-step` @ **`db6ae8c`** (`db6ae8cf2234e16c33ea2b7352aefe4ad687fb52`). The worktree
  `/home/user/wt/integration-step` was not modified.
- `main` @ `2b1d1a6` (docs only since the branch's last merge).
- Scratch copy: `git worktree add --detach` at `db6ae8c`, then `main` merged in (copy commit `e0332d8`). The merge
  conflicted only in `docs/orchestration/pending-fixes.md` (append-only), which was resolved as a union. There were no
  code conflicts. The copy was removed at the end.
- Inputs:
  - the first review and re-review #2 with their PoCs;
  - the payments sweep (`review-fix-sweep.md`, SW-PAY-1..4) and its PoC;
  - ADR-0015 with Amendment 1;
  - the builder's fix-round-2 report (the last `SubagentHandback` of the "Integration step: bind module ports" agent,
    19:28 UTC). Its 7 commits are `60b3238`, `73c9931`, `8fda978`, `8605368`, `00c7639` (merge), `c3855a1` and
    `db6ae8c`.

## Verdict: **merge after fixes**

Every attack proven so far is now refused:
- all 9 first-review PoCs (inverted);
- all 9 re-review-#2 findings (each `FINDING` assertion now fails);
- all 4 payments-sweep PoCs.

All gates are green on the merged copy. Invariants (a), (c), (d), (e) and (f) hold for the attacks the builder listed.

Going one step beyond the fixes again finds **two P1s**:

1. **R3-P1-1: invariant (b) "a departed folio's one balance request equals its debt" leaks at three exits.** Each one
   leaves a guest payment link live for money the folio no longer owes.
   - (i) **Settling the folio to a company account.** `transferToReceivables` never re-syncs the request. In the PoC
     the company was invoiced USD 234, and the guest then paid the same USD 234 through the still-open link.
   - (ii) **The "defer while a payment is in flight" exemption is never resumed.** A reversal during an unconfirmed
     payment closed the late-charge item as "owes nothing", but left the USD 234 link open forever.
   - (iii) **Re-issued requests leave the old link payable.** The re-issue cancels the old request in Portico but never
     deactivates its link at the provider. The guest paid both emails: USD 585 collected for a USD 351 debt.
2. **R3-P1-2: the cardholder's mandate scope is stored but not enforced where money moves.** Only the legal entity and
   the properties are checked. The purposes, the amount limit and the named bookings are not. The payments README
   says all of them are.
   - A card agreed for "a guarantee of booking A, at most USD 100" was charged USD 5,000 by a front-desk agent. The
     money went to *another guest's* folio, as a merchant-initiated charge, and a USD 9,000 hold was also accepted.
   - This is the control the declared open item (e) relies on (AP-54).

Counts: **P0 0 · P1 2 · P2 4 · P3 4.**

**The declared open item, invariant (e) on payments' own routes:**
- Rated **P2**. By itself it does **not** block merge, because Amendment 1 names `payments.payment.collect` as the
  explicit capability, and payments verifies the card's property and legal entity.
- This holds **only once R3-P1-2 is fixed**. Until then, every front-desk agent can charge any guest's saved card at
  the property, for any amount, onto any folio.

---

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep3`)

Exit codes were captured directly, never from piped output.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | **exit 0**: 843 files; **1 warning**, `modules/payments/src/service/accounts.ts:630` `useOptionalChain` (R3-P3-2); "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 2m40s |

Per-package test counts:
- api: 117 passed, 29 todo (33 files, 8 skipped);
- payments 137 · finance 92 · reservations 154 · guests 192 · identity 153 · integration 173;
- rates 130 · operations 120 · inventory 98 · platform 62;
- ui 87 · backoffice 53 · kernel 26 · db 17 · http 3.

These match the builder's report.

Probe runs in the copy:

| Run | Result |
|---|---|
| First review's 7 PoCs inverted: `r2-inverted-original-pocs`, re-run as `r3-inverted-original-pocs` | **9/9 pass**, after one adaptation the builder announced. The P3-9 *payments* variant fails as written: the run stays `in_progress` (R2-P2-4). It now first asserts the guarantee step is `pending` with **0 holds**, then records `checkIn.guarantee.externalReference`; the run then `completed` with provenance `external`. |
| `r2-fix-attacks` **as written** (each test asserts its defect) | **9 of 11 fail at the `FINDING` line**, so every defect is gone (details below). Of the other two: R2-B cap ±1 still passes (it was a clean test), and R2-H had no assertion, so it is re-written inverted in the r3 file and passes (clean). |
| `fix-sweep-poc/payments-zz-review-sweep` (asserts the safe outcome) | **4/4 pass**: SW-PAY-1..4 refused |
| `r3-fix-attacks` (new) | 10/10 pass: 8 tests assert a defect, R2-H inverted is clean, and the R3-B4 lock-order probe is clean (not reproduced) |
| r3 files | `tsc --noEmit` clean |

How each r2 attack is now refused (as-is run):

| Attack | Result now |
|---|---|
| R2-A booker / occupant | Refused at `createBooking`: `guarantee_method_not_allowed`, "Linking a person to a booking does not let staff use that person's saved card…" |
| R2-B non-numeric cap | `expected [] to deeply equal [{amount_minor: 2500000}]`: nothing held |
| R2-C | Ben gets his own method |
| R2-D ×2 | The requested total includes the cancelled re-issued request: one open request now equals the debt (see R3-P1-1(iii)) |
| R2-E | The reversal cancels the request |
| R2-F | The import is rejected (`importedCount 0`) |
| R2-G | `result` is `null` for housekeeping |

Databases: the harness dropped every `review_intstep3*` database, and none remain. The leftover
`w1_payments_*` and `review_idplus_m_*` databases belong to other runs and were not touched.

---

## 2. Earlier findings: closed?

| ID | Status | Evidence |
|---|---|---|
| R1 P1-1, P1-2, P1-3, P2-1, P2-2, P2-3, P3-9 (first-review PoCs) | **Closed** | `r3-inverted-original-pocs`: 9/9. The stranger's card is refused even with `collect` on the guarantee path (as the builder said). |
| R2-P1-1 card guarantee (Amendment 1) | **Closed as reported**; one step beyond → R3-P1-2 and R3-P2-4 | R2-A refused at create (as-is run); builder `review-regressions-r2` R2-A ×2, "one step beyond" and "mandate naming THIS booking" pass. Check-in re-checks the card with the holder's rights (`workflows.ts:576`). |
| R2-P1-2 late-charge request | **Closed for charges, reversal, adjustment, transfer between folios, payment, refund and deposit application; open at three exits** → R3-P1-1 | R2-D and R2-E as-is fail at `FINDING`. R3-B1, R3-B2 and R3-B3 prove the exits. |
| R2-P1-3 opening deposits, one predicate | **Closed sequentially**; concurrent sibling open → R3-P2-3 | R2-F as-is: import rejected. Payments' pre-check calls `assertTargetUsable` (`shared.ts:178-182`). R3-C1 shows the race. |
| R2-P2-1 card ownership | **Closed** | R2-C as-is fails at `FINDING`. A real token already saved for another owner is refused (`accounts.ts:483-497`, code-read). |
| R2-P2-2 money redaction | **Closed for** runs, step results, `check_in_incomplete` and `performWorkflow`; **sibling open** → R3-P2-2 | R2-G as-is: `result` is null. R3-G1 shows stored issues still leak. |
| R2-P2-3 reference allow-list | **Closed** | R2-H inverted: `folio` → `ledger_target_other_property`, `Folio`/`invoice` → `reference_type_not_supported`, `stay` → `reference_other_property`, `booking` → `ledger_target_other_property`. Kandu reads its folio status. |
| R2-P2-4 connected mode | **Closed** | P3-9 payments variant adapted (above). The charges variant is `skipped`, not `done`. |
| R2-P3-1, R2-P3-2, R2-P3-3, R2-P3-5 | Closed | R2-B as-is; channel issue instead of refusal (code-read `channel.ts:842-865`); `verify` is required (typecheck); revenue manager totals (builder test). |
| R2-P3-4 payments `aggregateVersion` | Deferred (pending-fixes) | No consumer yet (grep). |
| SW-PAY-1..4 | **Closed as reported**; one step beyond → R3-P2-1 (labels and family), R3-P1-2 (mandate scope) | Sweep PoC 4/4. |

---

## 3. New findings

### R3-P1-1 — Invariant (b) leaks at three exits: a payable guest link for money the departed folio no longer owes

The claimed invariant (builder § 5): "a departed folio has at most one open balance request, equal to its debt".
`syncDepartedFolios` (`modules/finance/src/service/departed-folios.ts`) is called by 7 writers:
- `postings.ts:747/966/1128/1473/1724/1983`;
- `deposits.ts:665`.

Three exits are not covered.

**(i) A sibling writer: settling the folio to receivables.**
- Where: `modules/finance/src/service/receivables.ts:266-457` (`transferToReceivables`). It settles the folio at :457
  and never calls `syncDepartedFolios`.
- Code-read sibling: `ledger-port.ts:33` `recordPaymentAdjustment` (payments reconciliation, "Route D") also changes
  a folio's balance without a sync.
- PoC R3-B1:
  1. A late charge of USD 234 opens one request of 23,400 (the R2 fix holds up to here).
  2. The GM direct-bills the folio to the company account: the folio is at 0 and the invoice is issued.
  3. The request is **still open** for 23,400. The urgent item still says "A payment link for $234.00 is open — send it
     to Elena Ivanova".
  4. The guest pays the link: `succeeded`, `ledger: posted`, onto a **new folio of the stay in credit −23,400**.
  5. No alert is raised: the request was `open`, so it was never "overpaid".
- Result: the company is invoiced USD 234 and the guest paid USD 234.

**(ii) The deferral exemption is never resumed.**
- Where: `modules/payments/src/service/requests.ts:467-476` (`if (inflight) return 'deferred'`) and
  `departed-folios.ts:102-117`. A deferral at `owed = 0` *resolves* the late-charge item.
- PoC R3-B2:
  1. A late charge opens a request of 23,400.
  2. The desk takes 3,400 on a `sim_timeout_then_failed` card (`pending_verification`, with a separate-collection
     reason).
  3. The night auditor reverses the late charge. The sync is `deferred`: the folio owes **0**, the late-charge item
     is **resolved** ("the folio owes nothing"), and the link stays **open for 23,400**.
  4. The provider then reports the payment failed. Nothing re-runs the sync.
- Final state: the link is open for 23,400, the folio is at 0, and **no open item** exists.
- When the in-flight payment *succeeds* instead, its posting re-syncs and cancels the request (observed with
  `sim_timeout_then_succeeded`). The hole is the failure or expiry branch, plus an item that reads "resolved" while
  the link is live (AP-26).

**(iii) A record the fix creates: re-issued requests.**
- Where: `requests.ts:587-610`. When the open request already has a provider link, the sync cancels it in Portico and
  creates a new one. Nothing tells the provider: no deactivation exists anywhere in payments (`cancelPaymentRequest`
  `:331-372` neither), and `simulateRequestPayment` still pays a cancelled request's link.
- PoC R3-B3:
  1. Link #1 for 23,400 is emailed.
  2. A second late charge re-issues the request as #2 for 35,100.
  3. The guest pays #1, then #2: **58,500 collected for a 35,100 debt**. The folio ends at −23,400, and only two
     **routine** `payment_request_overpaid` items are raised.
- Before fix round 2 this needed a manual cancel. Now it happens automatically on every second late charge.

**Why P1:**
- It is the same harm as R2-P1-2(b) and the original P1-3: the guest is asked for, and charged, money they do not
  owe.
- (i) is the standard direct-bill flow after a late charge.
- The builder's invariant table marks (b) closed (AP-50). These are AP-45 (sibling writer), AP-58 (exemption exit and
  the fix's own records) and AP-26.

**Fix (principle):**
- Every change to a departed folio's balance re-runs the sync under the folio lock. Examples: settle to receivables,
  payment adjustment, write-off, folio void or reopen, and anything added later.
- Every **end** of a deferral re-runs it too: the in-flight payment succeeds, fails or expires.
- A request Portico cancels **stops taking money at the provider before** a replacement is sent.

Instances:
- `transferToReceivables`;
- `recordPaymentAdjustment`;
- any write-off or settle path;
- the deferral end: a payments `payment.failed`/`succeeded` consumer in finance, or payments re-running the sync
  itself when it resolves a payment on a `post_departure` folio;
- a provider operation `expireLink` (after commit, with simulator support) on every cancel, including
  `cancelPaymentRequest`.

While deferred, the item must say "deferred — link for X still open", never "resolved".

As a backstop, consider an idempotent consumer of a finance "folio balance changed" event that re-runs the sync. That
catches any future writer that forgets the call.

**Attack run against the fix:**
- The guest pays the old link while `expireLink` is in flight. The payment lands on a cancelled request. It must be
  raised as **urgent**, with a refund proposal, not as a routine item. The re-issue should wait until the provider
  confirms the expiry, or should amend in place where the provider supports it.
- A failed payment ends a deferral while another late charge posts at the same moment. Both run under the folio lock,
  so the second sync reads committed state. See R3-P3-3 for the lock order this relies on.

**Load-bearing (AP-54):**
- Provider link expiry is a new mechanism. The simulator must model it (a cancelled link refuses payment), or the
  regression passes trivially.

### R3-P1-2 — The mandate's purposes, amount limit and named bookings are not enforced where money moves

**Where:**
- `modules/payments/src/service/collect.ts:138-170`. `assertMitAllowed` checks the terms version, the acceptance,
  `scope.legalEntityId` and `scope.propertyIds`, and nothing else. It is used by `authorize` (`:313ff`) and `charge`
  (`:727ff`).
- `incrementAuthorization` (`:435`) checks only `collect`.
- The full scope is read only in `accounts.ts:650-700` (`assessGuaranteeCard`), and there only to grant the
  non-`collect` `mandate` basis.
- **Claim:** `modules/payments/README.md:38` says "its `scope` — legal entity, properties, purposes, amount, bookings
  — is enforced".

**Attack** (PoC R3-F1):
1. The victim's card is saved with
   `mandate.scope = { purposes: ['guarantee'], maxAmount: USD 100, bookingIds: [A] }`.
2. Reservations' path enforces it: `assessGuaranteeCard(…, 5,000)` returns `basis: null` (clean).
3. A `front_desk` agent, whose template holds `payments.payment.collect`, calls `chargeNow` for **USD 5,000** onto
   **another guest's** folio: `payment: succeeded, ledger: posted`. The charge is merchant-initiated.
4. The same agent authorizes **USD 9,000** on that other guest's stay: accepted.

**Why P1:**
- **The harm of SW-PAY-4 returns.** That is a merchant-initiated charge outside the cardholder's agreement:
  scheme-rule non-compliance, lost disputes, and an unauthorized charge on a cardholder's card. The fix stores the
  consent but does not read it where money moves (AP-57).
- **Amendment 1 (b) defines a mandate by "which purposes, which amount limits".**
- **The README claims the full scope is enforced** (AP-50).
- **AP-54.** The builder and Amendment 1 leave invariant (e) open on payments' routes because `collect` is explicit
  *and* staff use needs the cardholder's mandate. The mandate is the load-bearing control, so its gap takes P1.
  - Combined effect: every front-desk agent can charge any guest's saved card at the property, for any amount, onto
    any folio.

**Fix (principle):**
- A merchant-initiated use of a stored card is allowed only inside the cardholder's recorded agreement: its legal
  entity, its properties, its purposes, its per-use amount and its named bookings. This applies **whoever acts**: a
  staff permission cannot widen a cardholder's consent.
- Instances:
  - `charge`: purpose maps to the mandate purpose (`deposit`, `balance`, `incidentals`; `custom` is refused unless
    covered);
  - `authorize`: `guarantee` or `incidentals`;
  - `incrementAuthorization`: the cumulative amount must not exceed `maxAmount`;
  - no-show and cancellation charges;
  - VCC runs (already channel-scoped);
  - `bookingIds`: a stay or booking reference is resolved through reservations' directory, a folio through finance's
    folio owner.
- On the guarantee path, `designated` (a `collect` holder) must also stay within the mandate.
- Anything else needs new consent: a payment link, or the terminal with the guest.

**Attack run against the fix:**
- *Cards with a mandate but no `scope`*: legacy rows, or a client that omits it. Decide explicitly whether that means
  "the account's legal entity, all purposes, no limit" (documented) or requires new consent. Do not leave it as
  "unlimited" by accident.
- *Split charges* (5 × USD 100 instead of 1 × USD 500) pass a per-use cap. Add a cumulative cap per booking, or at
  least audit and flag repeated merchant-initiated uses.

### R3-P2-1 — The collection guard still depends on the purpose label and the exact reference

**Where:**
- `modules/payments/src/service/collect.ts:194-215`: `owners.find((r) => REQUEST_PURPOSE[r.purpose] === purpose)`,
  and `custom` → `owners[0]`.
- The purpose is chosen by the client (`contracts.ts` `chargeInput.purpose`, `recordPaymentInput.purpose`).

**Attack** (PoC R3-D1):
1. A balance link of 30,000 on a folio is paid.
2. A desk charge on the same folio with the default purpose or with `custom` is refused (SW-PAY-1/2 fixed as reported).
3. The same 30,000 labelled **`incidentals`** is charged again: **2 × 30,000** collected, **0** override audits.
4. A paid deposit link on a booking, then a `custom` charge on that booking's stay folio: **accepted**. This is
   exactly the sweep's "attack on the fix" for SW-PAY-2 ("treat a booking and its stays' folios as one ref family"),
   which was not implemented.

**Fix (principle):**
- A collection on a **reference family** (a booking, its stays and their folios) while a link on that family is open
  or paid needs the stated separate-collection reason and audit, **whatever its label**.
- Instances: `charge`, `authorize`, `capture`, `recordPayment`, the VCC run, link creation.
- Family lookup: reservations' directory plus finance's folio owner.
- Attack on the fix: a legitimate incidentals charge after a paid deposit link now needs one audited sentence.
  Acceptable.

### R3-P2-2 — R2-P2-2 sibling: stored issues show folio balances to every booking reader

**Where:**
- `workflows.ts:868-872`: `departed_with_balance` embeds "folio 17550 USD" in its message, and `details.folios[]`
  holds the balance.
- `record.ts:144-157`: stored stay issues are copied with no `seesMoney` filter.
- `issues.ts:52-70`: `listIssues` needs only `reservations.booking.read` and returns `message` and `details`.
- Also read through `handover.ts`.

**Attack** (PoC R3-G1): a `housekeeping_supervisor` gets a stay record with `moneyRedacted: true`, yet its issue reads
"Guest departed with an open balance: folio 17550 USD (minor units)". `listIssues` returns the same, plus
`details.folios[].balance`.

**Fix (principle):**
- Issues raised from money carry a `money` flag. Examples: `departed_with_balance`, `payment_follow_up`,
  `guarantee_card_not_attached`.
- Non-money roles get `MONEY_NOT_SHOWN` and no `details`.
- Instances: stay and booking records, `listIssues`, handover open items, search summaries.

### R3-P2-3 — Opening deposits: concurrent imports skip the "held elsewhere" check and mix two legal entities

**Where:**
- `modules/finance/src/service/deposits.ts:1034-1046` reads `held` without a lock.
- `:1144-1160` → `lockDepositAccount` (`:88-118`) inserts with `onConflict doNothing`, then locks **whatever row
  exists** and adds the balance, without re-checking its property or legal entity.

**Attack** (PoC R3-C1): Kandu and Hiyani (different legal entities) import the same `legacyNotMigrated` booking id
concurrently.
- Both are accepted (`importedCount 1` each).
- The result is **one** deposit account with **20,000**, and 2 movements.
- Run sequentially, the second import is rejected, so the builder's check works.

**Why P2:** it needs the sensitive import permission and the same legacy id in two files: the wrong-file migration
mistake R2-P1-3 already called realistic. The damage is one legal entity's deposit liability held in another's
sub-ledger, and refundable there.

**Fix:**
- Re-check the account's property and legal entity under the row lock, after `lockDepositAccount` returns, on every
  caller (`:246` `recordDeposit`, `:1144` import). Reject the row on a mismatch.
- Alternatively, take `pg_advisory_xact_lock(hashtext('deposit:' || booking_id))` before validating.

### R3-P2-4 — Declared open item: invariant (e) "card owned by the payer" on payments' own routes

**Judgement under ADR-0015 Amendment 1:**
- "Any other use of a saved card … is an explicit capability: the entry module checks `payments.payment.collect`, and
  the payments provider still verifies the card's property and legal entity."
- Payments does exactly that. It is clean in the sweep's SW-PAY-3 PoC and in R2-H inverted. Staff use also needs the
  cardholder's mandate (SW-PAY-4).
- So the open item is **P2** and **does not block merge on its own**, provided R3-P1-2 is fixed first (AP-54).

**What is true today (AP-09 / AP-45):**
- `payments.payment.collect`, which every front-desk agent holds, means "charge any guest's mandated card at this
  property onto any folio".
- The guarantee path's "a stranger's card is refused even with `collect`" is defeated by the sibling `chargeNow` for
  the same role (R3-F1 does exactly that).

**Fix:** choose one, and make the docs say it:
- **(a)** Implement the payer directory (finance folio payer, reservations booking people). A card outside it needs an
  audited third-party-payer reason.
- **(b)** Amend ADR-0015 to say `collect` on payments' routes is not owner-restricted, and stop listing "owned by the
  payer" as an invariant in the builder's tables, the domain map or the README.

Cheap interim either way: audit `thirdPartyCard: true` when the method's owner is not among the reference's people.

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R3-P3-1 | `collect.ts:134-136` (`deriveInitiator`), `:101-125` (`loadUsableMethod`) | Latent: any `guest` actor is customer-initiated, for any method, so a guest could pay with another guest's saved card with no mandate check. No guest-actor surface exists yet (grep: nothing creates `kind: 'guest'` contexts). | Customer-initiated only for a method owned by the acting guest's profile or booking; otherwise refuse. Add before the guest portal ships. |
| R3-P3-2 | `accounts.ts:630` | Lint warning (`useOptionalChain`): the gate is exit 0 but not clean. | `if (m?.status !== 'active' …)`. |
| R3-P3-3 | Late charge: `postings.ts` `lockFolios` → `departed-folios.ts` → `syncBalanceRequest` → `lockCollectionRefs`. Link webhook: `webhooks.ts:840` `lockCollectionRefs` → request row → `ledger.ts:62` → finance `recordPayment` → `lockFolios`. | **Cross-module lock order is reversed** (AP-36): folio→collection versus collection→folio. Not reproduced in 12 concurrent rounds (R3-B4, clean). The consequence would be a `40P01` abort: the webhook is retried, and a POS late charge gets a 5xx. | One documented order: the collection lock first. Finance asks payments (port) for the collection lock before locking a `post_departure` folio. Write the order into the domain map. |
| R3-P3-4 | `apps/api/test/scenarios/harness.ts` `makeExternal` | Completes the authority transition with empty platform ports `{}` (no `transitionGuard`). The approver is a fabricated user id with the setup role's authz. Setup only; no assertion is weakened. | Use the composition's platform ports, so scenarios exercise the real guard. |

---

## 4. Invariants (a)–(f) and the 7 exemptions, re-attacked

| Invariant | Attack one step beyond | Result |
|---|---|---|
| (a) A card held without `collect` was supplied by its cardholder for this booking, or is mandated for it | Reverse order (R2-A as-is), a mandate without `bookingIds`, a VCC on a direct booking (code-read `requests.ts:670-686`), re-check at the hold with the holder's rights | **Holds** |
| (b) One open balance request per departed folio, equal to its debt | Settle to receivables, deferral end, re-issued link | **Fails**: R3-P1-1 (i), (ii), (iii) |
| (c) A deposit account's booking belongs to its property and legal entity | Concurrent legacy imports | **Fails under concurrency**: R3-P2-3 |
| (d) At most one collection per reference and purpose | Purpose relabel; booking ↔ folio family | **Fails one step beyond**: R3-P2-1 |
| (e) A card used at a property is readable there and owned by the payer | Property and legal entity: R2-H inverted, sweep SW-PAY-3 | Property and legal entity **hold**. "Owner" is declared open: R3-P2-4 |
| (f) "Customer present" only from evidence the server verified | Sweep SW-PAY-4 passes; the mandate scope on charge, authorize and increment (R3-F1); a guest actor with someone else's card | **Fails one step beyond**: R3-P1-2. Latent: R3-P3-1 |

| Builder exemption | Attack run | Safe? |
|---|---|---|
| 1. A `collect` holder designates a card of someone linked to the booking | The set of linked people is written by reservations agents (AP-57); the same role can `chargeNow` any mandated card (R3-F1) | Restrains nothing beyond `collect`: **R3-P2-4** |
| 2. Cross-property card use with `collect` at the card's property, same legal entity, audited | Sweep SW-PAY-3 PoC; a user scoped to A only gets "not found" | **Safe** |
| 3. A separate-collection reason is audited on every path, including `custom` | Relabel to `incidentals`; booking ↔ folio family | **No**: R3-P2-1 |
| 4. A balance request from the ledger skips "already collected" and defers while a payment is in flight | Deferral, then the payment fails | **No**: R3-P1-1(ii) |
| 5. Outflow on a legacy deposit (refunds only) | New money for a legacy id is refused (`ledger-port.ts:344-353`); concurrent imports | Inflow safe. Concurrent imports: **R3-P2-3** |
| 6. Simulator token suffix | Simulate mode only; a real token for another owner is refused (`accounts.ts:487-497`) | **Safe** |
| 7. The workflow loop continues over `skipped` | Only external-charges deposits (`workflows.ts:716`) and `skipStep` (permissioned and audited; a mandatory step needs `staySkipCheckInStep`) produce it | **Safe** |

## 5. Focus (d): merged-tree changes after identity-plus

`c3855a1` and the test diffs in `60b3238`, `73c9931` and `8605368` were read line by line. **No weakened assertion
was found.**

- **`signIn`** now enrols MFA once per tenant with the scenario clock and caches the session. Its users (s05, s06,
  s17, ux-wiring) sign in once per organization, and s17 still asserts cross-tenant refusals.
- **Admin addresses** use `*.portico.invalid` (ADR-0017 rule 12).
- **`makeExternal`** goes through plan → approve (a second user when `approvalRequired`) → freeze → complete. Nit:
  R3-P3-4.
- **The duplicate `GET /properties/:id/data-authority`** was removed. Main's enterprise route now does the same
  `getProperty` 404 check, so behaviour is unchanged.
- **ux-wiring** counts `dataDomain.options` (main added a domain).
- **Fixture changes:**
  - Payments fixtures gained card-on-file mandates (now required by SW-PAY-4).
  - The P1-8 test was rewritten to the **stricter** guest-actor rule.
  - The P1-3 test now expects `collection: 'none'` instead of `covered_by_credit`, and still asserts `routine`, 0
    requested and 0 owed.
  - The P3-9 test now asserts pending, then attestation (stricter).
  - S18 registers the bookings first (migration order).

## 6. Pattern sweep steps 2–6 against the fix commits

**Step 2, reverse order (AP-08):**
- (a): linking the person first is refused (R2-A).
- (b): a correction during an unconfirmed payment → R3-P1-1(ii).
- (c): the import racing an import → R3-P2-3.
- (d): the link paid before a desk charge with another label → R3-P2-1.

**Step 3, attack the fix:** stated in each finding. Each fix is written as a rule with its instances.

**Step 4, sibling paths (AP-45):**

| Fixed path | Siblings |
|---|---|
| Balance sync | 7 writers covered. Missing: `transferToReceivables`, `recordPaymentAdjustment`, deferral end, link cancel (R3-P1-1) |
| Mandate | guarantee path enforces; `charge`, `authorize`, `incrementAuthorization` do not (R3-P1-2) |
| Money redaction | runs and derived issues covered; stored issues, `listIssues` and handover not (R3-P2-2) |
| Collection guard | default purpose and `custom` covered; other labels and the reference family not (R3-P2-1) |

**Step 5, privilege equivalence (AP-09):**
- `payments.payment.collect` (front desk) = charge any mandated card at the property, any amount, any folio:
  R3-P1-2 and R3-P2-4.
- `finance.folio.settleToReceivables` now reaches "leave a guest link live for the invoiced amount": R3-P1-1(i).

**Step 6, load-bearing (AP-54):**
- The open item (e) relies on the mandate check, which is re-rated to P1 (R3-P1-2).
- The R3-P1-1 fix relies on provider link expiry, a new mechanism the simulator must model.
- The R3-P2-3 fix relies on the row lock in `lockDepositAccount`, which exists.

---

## 7. Coverage declaration

### Checklist 1–15

| # | Item | Result |
|---|---|---|
| 1 | Tenant isolation | Code-read: migration `0002_method_integrity.sql` only adds columns to an RLS table, with no new tables. Clean. |
| 2 | Authorization | **Probed** (R3-F1, R3-D1, R2-H inverted, R3-G1): findings R3-P1-2 and R3-P2-4. |
| 3 | Money and finance | **Probed** (R3-B1, B2, B3, R3-C1, R3-F1): findings R3-P1-1, R3-P1-2 and R3-P2-3. |
| 4 | Idempotency and concurrency | **Probed** (R3-C1 and R3-B4, genuinely concurrent): R3-P2-3, and R3-P3-3 (code-read). `balance-sync:{folio}:{n}` keys: code-read, clean. |
| 5 | Events and audit | Code-read: balance sync, merge and unmerge, and cross-property use are audited. No override audit on a relabel (R3-P2-1). |
| 6 | Contracts | Code-read: domain map updated (`db6ae8c`); ports match providers (typecheck). Clean. |
| 7 | Data authority and environment safety | **Probed** (P3-9 adapted, inverted): clean. No new external effects; link expiry is missing (R3-P1-1(iii)). |
| 8 | Errors and UX contract | **Probed**: R3-P1-1 (an item resolved while the link is live; the "send it" item stays after the direct bill). |
| 9 | Spec coverage | Not probed: focused re-review, with no new spec MUST added. |
| 10 | Scenario claims | Code-read: the S10 R2-P1-2 block covers charges, reversal, adjustment, transfer and payment, but not settling to receivables (R3-P1-1). |
| 11 | Honest readiness | Code-read: readiness unchanged (R3). The payments README over-claims mandate enforcement (R3-P1-2). |
| 12 | Code quality | Code-read: no `any`, default exports or `new Date()` in the fix diffs (grep). Lint warning R3-P3-2. |
| 13 | One-product experience | **Probed** (R3-G1): R3-P2-2. |
| 14 | Parity gate | Not applicable: no parity file (run parameters). |
| 15 | Cross-module coherence | Code-read: the declared drift (guarantee `basis` enum copy; `bookingPeople` payer mapping) and the lock order across finance and payments (R3-P3-3). |

### Patterns

**Group A — isolation, authorization and identity**

| Pattern | Result |
|---|---|
| AP-01 | **Probed** (R2-H inverted, R3-F1): property clean; owner → R3-P2-4 |
| AP-02 | Code-read: clean |
| AP-03 | **Probed** (R2-C as-is): clean |
| AP-04 | **Probed**: R3-P1-2, R3-P2-1 |
| AP-05 | **Probed**: R3-P2-2 |
| AP-06 | Code-read: no new permissions. Clean. |
| AP-07 | Not applicable |
| AP-08 | **Probed**: R3-P1-1(ii), R3-P2-3 |
| AP-09 | **Probed**: R3-P1-2, R3-P2-4 |
| AP-10 to AP-14 | Not applicable |
| AP-15 | Code-read: the token is not in views. Clean. |
| AP-16 and AP-17 | Not applicable |
| AP-18 | **Probed**: R3-P2-2 |
| AP-19 | Code-read: link expiry missing (R3-P1-1) |
| AP-53 | **Probed** (exemption 1): R3-P2-4 |
| AP-57 | **Probed**: R3-P1-2 (the scope is written but not read), exemption 1 |

**Group B — money and finance**

| Pattern | Result |
|---|---|
| AP-20 | **Probed** (R3-B4): not reproduced; code-read R3-P3-3 |
| AP-21 | Code-read: clean |
| AP-22 | Not applicable: `verify` required (typecheck) |
| AP-23 | **Probed** (mandate `maxAmount` ±): R3-P1-2. Cap ±1 clean (R2-B as-is). |
| AP-24 | Not applicable |
| AP-25 | **Probed**: R3-P1-1 |
| AP-26 | **Probed**: R3-P1-1(ii) |
| AP-27 | Not applicable |
| AP-28 | **Probed**: R3-P2-1, R3-P1-1(iii) |
| AP-29 | Not applicable |

**Group C — events, integration and concurrency**

| Pattern | Result |
|---|---|
| AP-30 | Code-read: merge consumer idempotent. Clean. |
| AP-31 | Code-read: R2-P3-4 still deferred |
| AP-32 and AP-33 | Not applicable |
| AP-34 | Code-read: a hold is re-checked with the holder's rights. Clean. |
| AP-35 | **Probed** (R2-B non-numeric cap as-is: fails closed, clean); a mandate without `scope` (R3-P1-2 attack) |
| AP-36 | **Probed**: R3-P2-3, R3-P3-3 |
| AP-37 | Code-read: links created after commit, but never expired: R3-P1-1(iii) |
| AP-38 | **Probed** (P3-9 attestation): clean |
| AP-39 | Code-read: the VCC token pre-check means no aborted transaction. Clean. |
| AP-56 | Not applicable |

**Group D — contracts and cross-module coherence**

| Pattern | Result |
|---|---|
| AP-40 | Code-read: clean |
| AP-41 | Code-read: the reservations fake `assessGuaranteeCard` mirrors the basis rules |
| AP-42 | Code-read: declared drift (payer mapping ×4 now) |
| AP-43 | Not applicable |
| AP-44 | **Probed** (R2-F as-is, R3-F1): the deposit predicate is one, clean. Mandate on the guarantee path vs the charge path disagree: R3-P1-2. |
| AP-45 | **Probed**: R3-P1-1, R3-P2-2, R3-P1-2 (increment) |
| AP-46 | **Probed** (R3-B1): the payment posted to a new folio; nothing lost, double collected |
| AP-47 | **Probed** (R2-H inverted): clean |
| AP-48 | Not applicable |
| AP-54 | Code-read (applied, § 6): R3-P1-2 re-rated |
| AP-58 | **Probed** (3 charges, inverse, the fix's own records): R3-P1-1(ii) and (iii) |

**Group E — claims and gates**

| Pattern | Result |
|---|---|
| AP-50 | **Probed**: the invariant (b) claim (R3-P1-1) and the README mandate claim (R3-P1-2) |
| AP-51 | Code-read: regressions use the real composition. Clean. |
| AP-52 | **Probed**: forced gates on a merged copy, exit codes read. Clean (1 lint warning, R3-P3-2). |
| AP-55 | **Probed**: the builder's mandate regressions assert only the guarantee path, never `charge`/`authorize` (R3-P1-2) |

Group F (UI) is not applicable: no UI review.

Totals:

| | Probed | Code-read only | Not applicable | Not probed |
|---|---|---|---|---|
| Checklist (15) | 6 | 7 | 1 | 1 (#9) |
| Patterns A–E (57) | 25 | 15 | 17 | 0 |

So **25 of the 40 applicable patterns** were probed.

---

## 8. Notes for the orchestrator

- **ADR-0015 Amendment 1 wording.** "Any other use of a saved card, or a different amount, is an explicit capability"
  mixes staff authorization with cardholder consent.
  - Suggested: `collect` may choose among cards the cardholder agreed to, but a merchant-initiated use never goes
    beyond the cardholder's recorded agreement (purposes, amount, bookings).
  - Also decide R3-P2-4 explicitly (payer directory, or "not owner-restricted, audited").
- **Payments contract change: provider link expiry** (`expireLink`, simulator plus Stripe adapter). R3-P1-1(iii) and
  every manual cancel need it, as does any amend-by-reissue design.
- **Finance backstop.** A "folio balance changed" event, consumed idempotently, would re-run the departed-folio sync
  for any writer, so the next writer cannot forget it (R3-P1-1(i)).
- **Lock order between finance and payments** (R3-P3-3). Write one order into the domain map before more cross-module
  money paths are added.

## 9. PoC files (`docs/orchestration/reviews/integration-step-poc/`)

Copy each file to `apps/api/test/<name>.test.ts` (it imports `./scenarios/harness`). Run it with `--silent=false` to
see the evidence lines.

| File | Proves |
|---|---|
| `r3-inverted-original-pocs.test.ts.txt` | The first review's PoCs, inverted, with the P3-9 payments variant adapted for attestation: 9/9 refused |
| `r3-fix-attacks.test.ts.txt` | Each `FINDING` test passes by asserting the defect; flip the marked assertions once fixed. **R3-B1, R3-B2, R3-B3:** R3-P1-1 (i), (ii), (iii). **R3-B4:** the lock-order probe (not reproduced). **R3-D1 ×2:** R3-P2-1. **R3-F1:** R3-P1-2, and the R3-P2-4 consequence. **R3-G1:** R3-P2-2. **R2-H inverted:** clean. **R3-C1:** R3-P2-3. |

The re-review #2 PoC (`r2-fix-attacks`) was run as written, with the results in § 1. The payments sweep PoC asserts
safe outcomes and passes as written.
