# Steward re-review #5 (focused, after fix round 4): `feat/integration-step`

Reviewer: architecture steward · 2026-11-07 · playbook v2.1, variant "focused re-review", plus the queued v3
"verify the proof" step (run as instructed). Scope: payments consent and limits, the payment-request lifecycle, and
the lock order around finance deposits.

## Verdict: **merge after fixes**

Counts: **P0 0 · P1 2 · P2 2 · P3 4.**

Coverage: 61 patterns, 44 applicable (25 probed, 19 code-read), 17 not applicable, 0 applicable patterns left unprobed (§ 7).

- Branch `feat/integration-step` @ **`a1bdd70`** (`a1bdd70c826f25e32fac6a2f546ec612913b73c6`). It did not move during
  the run. The worktree `/home/user/wt/integration-step` was not modified.
- `main` @ `39ef7e2`, merged into a scratch copy (copy commit `3f5f5d6`) with **no conflicts**. The infra merge
  (`.github/workflows/ci.yml`, `apps/*/Dockerfile`) was already in the branch through `0aa6928`. Since then, `main`
  only changed docs and chronicle files.
- The copy and all `review_intstep5*` databases were removed at the end. No databases remain.
- Fix-round-4 code commits read line by line: `8291b85`, `31502d4`, `7c9c76d`, `efa4120`. Tests and docs: `a95c836`,
  `a1bdd70`, `bd6e576`.
- I drafted the attack plan from the code and Amendment 3 **before** reading the builder's report. Items (A)–(D) below
  were in that plan. The builder's report then confirmed two of them in its own words:
  - its own no-show test charges a future, non-no-show booking and asserts `accepted`;
  - its § 5.1 state machine has no row for "staff confirm a `completed` link".

All r4 attacks are refused (§ 2), and the running total holds at N=10 with mixed uses (§ 4). Going one step beyond
the fix finds **two P1s of the R4-P1-1 class**: consent decided by data that the charging role writes.

1. **R5-P1-1. The `no_show` purpose is a label the desk chooses.**
   - Round 4 made `no_show` a public charge purpose so a no-show fee could match the mandate. Nothing ties that label
     to a recorded no-show.
   - A card agreed for "guarantee + no-show fee" (the standard guarantee consent) pays **USD 2,500 of an ordinary bill**
     when the desk types `purpose: 'no_show'`. Typed as `balance`, the same charge is refused.
   - The same label slips past the collection-ownership guard. It **re-opens R4-J**: a paid deposit is collected
     again, with no reason, before it is applied.
2. **R5-P1-2. "A stay added later is not covered" holds only for stay references.**
   - `stayCovered()` returns `true` when the reference has no stay.
   - After `add_stay` puts Otto on Vera's named booking, the desk charges **Vera's card USD 2,500 as a booking deposit**
     and then applies it to **Otto's added-stay folio**. This is the R4-A2 harm, through the booking-level reference.

---

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep5`)

Exit codes were written straight to a file (`echo $? >> gates.txt`), never read from piped output.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` (`biome check . --error-on-warnings` + boundaries) | **exit 0**: 859 files, no fixes; "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached, 18.1 s |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 1m48s |

Per-package test counts:
- payments 152 · api 152 (+29 todo, 8 files skipped) · finance 92 · reservations 154;
- guests 192 · identity 153 · integration 173 · rates 130 · operations 120 · inventory 98 · platform 62;
- ui 87 · backoffice 53 · kernel 26 · db 17 · http 3.

These match the builder's report. Every probe file type-checks under `apps/api` `tsc --noEmit`.

---

## 2. (a) The r4 attacks, re-run inverted on the merged copy

I copied `r4-fix-attacks` and `r4-inverted-r3-original-pocs` into the copy and ran them as written. I then ran them
again with the setups adapted to Amendment 3: a booking created with a guarantee card now goes through the harness's
`bookWithCard`, so the cardholder confirms the booking first. The adapted files are
`r5-inverted-r4-fix-attacks.test.ts.txt` and `r5-inverted-r4-r3-original-pocs.test.ts.txt`.

| r4 attack | As written | Adapted setup | Refused at the right line? |
|---|---|---|---|
| R4-A (Vera named booker) | fails at its FINDING line `:262` (`mandate_reference_not_covered`) | `:256` (same assertion, shifted) | **Yes** |
| R4-A2 (`add_stay` occupant) | fails at FINDING `:627` | `:621` | **Yes** (but see R5-P1-2 for the booking-level sibling) |
| R4-B (5 concurrent charges) | fails at FINDING `:305`: exactly 10,000 taken | `:299` | **Yes** |
| R4-C (two holds at once) | fails at FINDING `:344`: 10,000 held | `:338` | **Yes** |
| R4-D1 (paid replaced link → refund all) | setup refused (`guarantee_method_not_allowed`, Amendment 3) | fails at FINDING `:385`: no urgent refund item | **Yes** |
| R4-D2 (expired link) | setup refused | fails at FINDING `:649`: the link is `deactivated` | **Yes** |
| R4-E (provider never answers) | setup refused | `:425` ("no exception") **still passes**, because the PoC never moves the clock past the 30-minute deadline; `:426` (the "is open — send it" text) fails | **Yes** for the text. The owner and deadline are proven by the builder's flipped R4-E, which advances 40 minutes (green in the gate run) |
| R4-F (link created for a closed request) | clean, passes | clean, passes | Clean |
| R4-G (two closes racing) | setup refused | **passes** (clean) | Clean |
| R4-H (`applyDeposits` deadlock, 12 rounds) | passes | passes | Clean at 12 rounds (see R5-P3-4 on how weak 12 rounds is) |
| R4-J (balance before the deposit is applied) | fails `:708`, but through `mandate_reference_not_covered`, so consent refused it before the ownership guard ran | same | The guard is proven by the builder's flipped R4-J, and by my R5-A2 for `balance`. The guard is **bypassed with `no_show`** (R5-P1-1) |
| R4-K (scope-less agreement) | setup refused at `:722`/`:716` (no named booking) | same | Not reachable as written; the builder's flipped R4-K is green |
| R3-D1 inverted | `mandate_reference_not_covered` ×2 before the guard | same | As for R4-K; the builder's flipped version is green |
| r3 originals: deposit-wrong-property ×2, checkin-any-card, finance-delegation, rates-adapter | pass | pass | Clean |
| r3 originals: late-charge-overcollect, connected-checkin ×2 | setup refused | **pass** | Clean |
| r3 original fd15 (housekeeping reads booking money) | setup refused at `:242`/`:269`: a staff-entered, booking-owned card with no named booking | same | **Not re-run**. The attack is a read-permission check whose code did not change this round |

---

## 3. New findings

### R5-P1-1 — `no_show` is a label the charging role chooses: it widens a no-show consent to any charge, and re-opens R4-J

**Where:**
- `modules/payments/src/contracts.ts:352` (`chargeInput.purpose`) and `:376` (`recordPaymentInput.purpose`) accept
  `no_show` from any caller holding `payments.payment.collect` (`front_desk`).
- `modules/payments/src/service/consent.ts:167-170`: for a charge, `purposeOk = purposes.includes(use.purpose)`, and
  `use.purpose` is that label.
- `modules/payments/src/service/collect.ts:201-209`: the ownership guard treats `custom` and `incidentals` as labels
  that "can stand for anything", but not `no_show`. A `no_show` charge after a paid link elsewhere in the family needs
  no reason.
- The cardholder-supplied card gets `no_show` implicitly (`consent.ts:126`). So do VCC agreements (`requests.ts:984`)
  and the harness's default agreement.
- Nothing reads the reservations no-show record (`reservations/src/service/bookings.ts:1152-1254`,
  `penalty:no_show:{stayId}`) or the cancellation penalty. The builder's claim ledger says it directly: "reservations
  posts the fee; the desk charges it".

**Attack** (`r5-fix-attacks.test.ts.txt`):
- **R5-A1, `:234`.** The card's agreement covers `guarantee` and `no_show` for booking B, with no `maxAmount`. Business
  date 2027-03-10; the stay is `confirmed`, not a no-show.
  - The desk charges USD 2,500 to B's stay folio as `balance`: `mandate_purpose_not_covered`.
  - The same charge as `no_show`: **`accepted`, succeeded** (`:269`).
- **R5-A2, `:275`.** A deposit link of USD 300 on booking B is paid, and the deposit is not yet applied.
  - A USD 300 `balance` charge on the stay folio: `collection_owned_by_payment_request` (the R4-J fix holds).
  - The same charge as `no_show`, with no reason: **`accepted`** (`:307`). The deposit is collected twice.
- The builder's own regression test (`review-regressions-r4.test.ts:1020-1054`) charges USD 400 `no_show` to a
  booking that arrives three months later, and asserts `accepted`.

**Why P1:**
- Amendment 2 says the agreement's **purposes** bound what staff may take, and Amendment 3 says consent "cannot depend
  on data that staff can edit". Here the purpose is data that the charging staff member types, in the same request
  (AP-04, AP-57, AP-60).
- A guarantee consent becomes an open charge authority for the named booking. Without `maxAmount`, which is optional,
  it is unbounded.
- It also undoes the R3-P2-1 / R4-P3-3 rule, "a link owns its money … whatever the label" (README line 38). That is a
  false claim, and money is collected twice.

**Fix (principle):** a purpose that a consent or a guard relies on is derived from a server fact about the money, never
from the label the initiator sends. Labels the client may send are display text.

Instances:
- `no_show` is covered only when reservations has recorded a no-show or cancellation penalty for that stay or booking.
  Pass it through the reservations → payments port (penalty id and amount), or let payments read the penalty posting on
  the folio. The charge must not exceed what that penalty still owes. A public `chargeInput` with
  `purpose: 'no_show'` and no penalty reference is refused.
- In `assertCollectionOwnership`, treat a `no_show` that is not derived like `custom` or `incidentals`.
- The same rule for the other labels the consent reads:
  - `deposit` only on a booking reference before check-in (today a folio charge labelled `deposit` uses a deposit-only
    agreement; code-read);
  - `incidentals` only for incidentals holds and their captures.
- `recordPaymentInput.purpose` is not card-on-file, but it feeds the same ownership guard.

**Attack run against the fix:** can the desk create the fact the fix relies on?
- `reservations.stay.noShow` belongs to `night_auditor`, not `front_desk` (`identity/src/domain/role-templates.ts`).
- `bookings.ts:1160` refuses a no-show before the arrival day (`no_show_too_early`).
- A cancellation penalty comes from the booking's terms snapshot, which the cardholder agreed to at booking.
- Boundary case attacked: a stay that is checked in and then marked a no-show is refused by `assertStayTransition`
  (`bookings.ts:1156`; code-read).
- Residual: a night auditor who also holds `payments.payment.collect`. That is one audited role, bounded by the agreed
  penalty.

### R5-P1-2 — A stay added after consent is paid through the booking-level reference

**Where:**
- `modules/payments/src/service/consent.ts:184-190`: `stayCovered()` returns `true` when `ctx.stayId === null`.
- Two kinds of reference have no stay: a booking (deposit, guarantee hold) and a folio owned by the booking. For both,
  coverage is "the booking is named", whatever stays the booking has **now**.
- `modules/finance/src/service/deposits.ts:419-520` (`applyDeposits`, `finance.posting.create`, held by `front_desk`)
  moves the booking's deposit to any folio of the property. Nothing asks whether the money's consent covers the
  target stay.

**Attack (R5-D, `r5-fix-attacks.test.ts.txt:462`):**
1. Vera confirms her card for her booking V, which has one stay.
2. The desk previews and commits `add_stay` with **Otto** as the guest of a second stay on V.
3. Vera's card on Otto's added-stay folio: `mandate_reference_not_covered`. The builder's fix holds for the stay
   reference.
4. Vera's card charged **USD 2,500 `deposit` on `{ type: 'booking', id: V }`**: **`accepted`** (`:506`).
5. `finance.applyDeposits({ bookingId: V, toFolioId: ottoFolio })` by the desk: **accepted, USD 2,500 applied to
   Otto's stay folio**.

**Why P1:** it is the R4-A2 harm (Vera's card pays for Otto's stay) after one routine, audited `add_stay`, so it is an
open sibling of R4-P1-1 (AP-45). It also contradicts these claims:
- the README ("a stay added later is not covered");
- the domain map (`:367`);
- the builder's § 6 claim ledger ("keep").

The builder's mutants M2 and M3 only exercise stay references.

**Fix (principle):** what money taken under a consent may pay is bounded by the stays the consent covers, at the time
of the use **and** at the time the money is applied.

Instances:
- A booking-level charge or hold, and any folio owned by the booking, is covered only while every current stay of the
  booking is in the evidence. Otherwise the error is `mandate_reference_not_covered`, with "the booking changed since
  the cardholder agreed: ask them to confirm it again".
- The check-in guarantee and deposit steps re-run that check.
- `applyDeposits` (and the check-in deposit step) applies card-on-file deposit money only to folios of covered stays.
  Payments exposes a port such as `depositApplicable(bookingId, folioId)`. Applying it elsewhere needs the cardholder's
  new consent, or a stated, audited reason from a finance role.
- Any future booking split, move or merge.

**Attack run against the fix: the reverse order.** The deposit is charged while V has only Vera's stay (covered),
then Otto's stay is added, then the deposit is applied to Otto's folio. The charge-time check cannot see this, which is
why the application-time instance is required. Boundary case attacked: a booking-owned folio with no stay (code-read).
It falls under the same rule.

### R5-P2-1 — "Link stopped" on a link the provider reported as **already paid** releases the replacement before that payment is recorded; any desk agent can confirm it at any time

**Where:**
- `modules/payments/src/service/requests.ts:516` accepts `completed` as well as `deactivating`.
  - `completed` means "the provider took a payment on it, and we have not recorded it yet" (`:418-433`).
  - Staff confirmation moves it to `deactivated` and releases the waiting replacement (`:535-536`). That is the
    `already_completed` half of R4-P2-1, re-opened through a new entry point.
- `:515` checks `payments.paymentRequest.create`, held by `front_desk` and `reservations_agent`.
  - The exception's owner is `finance` (`:487`).
  - There is no condition that an exception exists or that the deadline has passed.
  - The route (`routes.ts:562-571`) takes no `If-Match`, although the request is versioned (CLAUDE.md §4.8).
- The builder's § 5.1 state machine lists "completed → deactivated: payment recorded" only. The staff edge out of
  `completed` is missing (AP-58).

**Attack (R5-C, `r5-fix-attacks.test.ts.txt:385`):**
1. Departed folio. Link #1 (USD 200) is paid at the provider, and the webhook has not arrived.
2. A late charge leads to a re-issue. Link #1 becomes `completed`; the replacement is `pending`, with no URL.
3. No `payment_link_not_stopped` exception exists yet. The **front desk** confirms "Stopped it": accepted (`:408`).
4. The replacement is created at once (`:413`), asking for an amount that **includes the USD 200 just paid**.
5. The guest pays the link they were sent, and then the first webhook arrives. The folio ends **in credit** (`:421`),
   and a `payment_request_overpaid` item is raised: the guest has paid twice.

**Why P2:** it re-creates the R4-P2-1 harm through one click by the role the waiting rule restrains. Money moves
wrongly but is recoverable (an urgent refund item is raised). It is not P1 because the refund path exists and the
action is audited with a reason.

**Fix (principle):** a staff attestation can stand only for "the link is dead". It never stands for "its payments are
recorded".

Instances:
- `completed`: staff confirmation is refused. The replacement waits for the payment record (webhook, a lookup by link
  reference, or finance recording the provider payment). After the deadline, finance gets the existing exception.
- `deactivating`: confirmation is limited to the exception's owner role (a finance permission, not
  `paymentRequest.create`), and only once the exception exists (provider refusal, or the deadline passed).
- The route requires `If-Match`.
- The backoffice action (a residual) follows the same rule.

**Attack run against the fix:** the provider says "already paid" and the webhook is lost forever. The lookup by link
reference, or finance recording the payment from the provider dashboard, credits the request and then releases the
replacement (`creditPaymentRequest` already does this for `completed`). No path is left that releases the replacement
without the payment.

### R5-P2-2 — Mutation survivor: an uncertain charge (`pending_verification`) in the running total is untested

**Where:** `modules/payments/src/service/consent.ts:234`, the statuses counted as "taken".

**Mutant (reviewer's own):**
- Drop `'pending_verification'` from the list, keeping `'processing'` and `'succeeded'`.
- Full payments suite: **152/152 green**. Full api suite: **152 green**. **Survives.**
- The broader mutant that drops both in-flight statuses is killed by R4-B, because concurrent charges are still
  `processing`.

**Why it matters:** a timed-out charge may have taken the money (CLAUDE.md §5: "uncertain outcomes are pending
verification"). If the guard regresses, a second charge goes through while the first is unresolved, and the cap is
exceeded once both settle. The guard works today, but nothing proves it (AP-50; v3 "a survivor is a finding").

**Fix:** add the test I wrote, R5-M (`r5-fix-attacks.test.ts.txt:428`).
- Card token `sim_timeout_then_succeeded`, an agreement of USD 100, two named bookings.
- The first charge is `pending_verification`; the second is refused with `mandate_amount_exceeded`.
- It passes on `a1bdd70` and **kills the mutant** (`accepted` ≠ `mandate_amount_exceeded`).
- Sibling: the same for holds, the `'processing', 'pending_verification'` entries of the authorization list
  (`consent.ts:241`), with a timed-out hold.

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R5-P3-1 | `accounts.ts:458`, `:476-482` | The comment says the evidence (when, which channel, the stays) "is built here, never by the client". Only `stayIds` is server-built. `at` is `input.mandate.acceptedAt` and `channel` is `input.mandate.channel`, so staff can record `channel: 'guest_self_service'` or a future `acceptedAt`. The `at` fallback is reached only when no stay list exists (fakes), so the impact is the claim (AP-04, AP-62). | Stamp `at = tx.now`. Store a server channel from the actor (`staff_recorded` / `hosted_entry`), and keep the client's value as `declaredChannel`. Correct the comment and README line 38. |
| R5-P3-2 | `consent.ts:106-109`, `accounts.ts:888-892`; derived-list claim "merge and unmerge change the owner only; consent never reads the owner" | False. The guest-actor checks (customer-initiated use, `confirmCardForBooking`) key on `owner_type/owner_id`, which a staff profile merge rewrites (`accounts.ts:818`). After a merge, the merged-in guest could confirm the other person's card for their own booking. This is **latent**: `confirmCardForBooking` has **no route** (grep of `routes.ts` and `apps/*/src`), so README line 38's "today it is guest self-service" is also an overclaim. Today the only way to widen coverage is staff saving a new agreement with a fresh token. | Key guest ownership on who entered the card (record the guest actor at hosted entry), not on the owner that a merge rewrites. Change the README to "not reachable until the guest portal ships". |
| R5-P3-3 | `requests.ts:423-430` | After `already_completed`, `recorded` means "any link payment exists on this request", not "the payment the provider just reported". With a partly paid link (the simulator accepts `amountMinor`), a second payment reported as `already_completed` releases the replacement at once. Stripe Checkout takes one payment per session, so this is simulator-only and latent. Separately, the overpaid item's "the folio is now X in credit" prints `min(payment, credit)`, not the folio's credit, when the folio was already in credit (`operations.ts:1060-1066`). | Compare `paid_minor` before and after the provider's report (or match the provider payment reference). State the folio's credit and the amount to refund as two numbers. |
| R5-P3-4 | Proof strength: `review-r4-regressions.test.ts` (module), R4-H probe | (i) **M6** (card-row `FOR UPDATE` removed) is killed by the api tests (R4-B, three concurrent holds) and by my R5-B. The **module** "concurrent holds" test killed it in the full-suite run but **passed in isolation**, so its kill depends on timing. (ii) The R4-P3-2 fix (`deposits.ts:445`) is guarded only by the R4-H probe at 12 rounds. At r4's measured rate (3 deadlocks in about 88 rounds), 12 rounds detect a regression only about 34 % of the time, and the lock is not in the builder's mutation table. | Use a held-transaction test like E-114 (deposit account locked in tx 1, link webhook in tx 2: it must wait on the collection lock, not deadlock). Make the module concurrency test deterministic with a held lock. |

---

## 4. (b)–(d) The focus areas: attacks that held

**(b) Consent scope.**

| Path | Attack | Result |
|---|---|---|
| New agreement recorded by staff naming bookings | A foreign or other-entity booking or folio (module M5) | Refused (`mandate_booking_unknown` / `mandate_folio_unknown`) |
| The same, re-saving an existing card under another owner with a fresh agreement | Live mode is unique on (tenant, account, token), so it returns the existing row. Simulator tokens are stored per owner | **Clean** (code-read). Recording the cardholder's consent at the desk stays a staff attestation (R5-P3-1) |
| `scope.folioIds` | Named folio only, exactly that id | Clean as coded. A named folio pays whatever staff post or transfer onto it, which is the same as posting a charge and is bounded only by `maxAmount` (see § 6) |
| Folio transfers and splits; moving charges | `transferPostings` needs `finance.posting.transfer` (finance and GM roles, not the desk). The target folio must be covered for the card to pay | Equivalent to posting; no new widening (code-read) |
| Moving money between folios or bookings | **`applyDeposits` to an added stay: R5-P1-2** | **Finding** |
| Group, master and booking-owned folios | `ctx.stayId === null` makes them covered for the booking | Falls under **R5-P1-2** |
| Profile merge and unmerge | Merge moves the owner; coverage is unchanged (builder's test) | Clean for staff-initiated use; latent for guest checks (R5-P3-2) |
| Channel VCC | Channel bookings only (`requests.ts:919-925`); stays recorded at registration | Clean (code-read) |
| Re-confirmation | `confirmCardForBooking` needs a guest actor and is `FOR UPDATE` on the card | Clean, but it has no route (R5-P3-2) |
| Capture onto another ledger reference | Consent checks the capture's ledger reference | Clean (code-read, `collect.ts:603`) |
| Purpose labels | **R5-P1-1** | **Finding** |

**(c) The running total.** Code-read: refunds never restore headroom, which is conservative.

| What moves it | Result |
|---|---|
| Void or expiry | Removes the hold from the open list; correct, because the hold is released |
| Failed capture | The payment is `failed` and not counted; `capture_reserved_minor` is excluded from "open" while in flight |
| Partial capture | Open = amount − captured − reserved, with no double count (M8) |
| Increases in flight | Counted (M11) |
| Multi-currency | A use in another currency than the cap is refused. Summing across currencies can only over-count (fail-closed) |

**Concurrency at N=10** (R5-B, 3 rounds):
- One USD 60 hold is captured while 4 charges and 5 holds of USD 40 run at once, on a USD 100 agreement.
- Taken plus open ≤ USD 100 in every round, with no deadlock. **Clean.**

**Lock cycles**:

| Path | Order |
|---|---|
| charge, authorize | card → collection |
| increment | authorization → card |
| capture | authorization → card → collection |
| authorization webhook | authorization → card |
| `detachMethod` | card only |
| finance | never calls a card path (check-in steps run in separate transactions, `workflows.ts:1310`) |
| `applyDeposits` | collection → deposit account → folio. When the deposit's booking differs from the folio's family there is no shared second lock, so no cycle |

No collection → card edge was found, so the orders are consistent (code-read, grep of `forUpdate` and
`lockCollectionRefs`).

**(d) Link lifecycle.**

| Exit | Result |
|---|---|
| deactivating → deactivated (provider) | Clean |
| deactivating → completed → deactivated (webhook credit) | Clean (builder's sibling test) |
| completed / deactivating → urgent exception after 30 minutes | Clean (builder's R4-E) |
| staff confirm | **R5-P2-1** |
| Idempotency | Clean: `Idempotency-Key` through `idem()`, and state-idempotent (only `deactivating` or `completed` change) |
| Audit | Clean: before, after and reason |
| Over-collected amount with several links | Two retired-link payments on one folio produce items summing to exactly the folio's credit (code-read). Partial payments: R5-P3-3 |

## 5. (e) Verify the proof: mutants

| Mutant | Guard removed | Tests run | Result |
|---|---|---|---|
| Builder **M6** | `consent.ts:93` card row `FOR UPDATE` | api `review-regressions-r4` (+ R5-B); payments module, isolated and then full | **Killed** by api R4-B, "three concurrent holds" and R5-B ×3. Module: passed in isolation, killed in the full run (timing-dependent, R5-P3-4) |
| Builder **M9** | `collect.ts:175` collection lock in `assertCollectionOwnership` | api `review-regressions-r4` | **Killed**, by E-114 ×2, as claimed |
| Reviewer **R5-M1** | `consent.ts:234` "taken" without `processing` and `pending_verification` | full payments and full api | Killed (api R4-B only) |
| Reviewer **R5-M2** | `consent.ts:234` "taken" without `pending_verification` | full payments and full api | **SURVIVED → R5-P2-2.** Killed by R5-M |

Every planted mutant was restored with `git checkout`, and `git diff --stat -- modules/` was empty after each one.

## 6. Notes for the orchestrator

- **Owner question candidate (append to Q160):** should `maxAmount` be **mandatory** for staff-recorded agreements?
  - Today every remaining widening is bounded only by an optional cap: named-folio postings, transfers onto a named
    folio, and the residuals of R5-P1-1 and R5-P1-2.
  - Default if asked: mandatory for staff-recorded agreements; optional for hosted entry.
- **Shared-code candidate:** the purpose taxonomy now lives in three places:
  - `CollectionPurpose` (`collect.ts:82`);
  - `ConsentPurpose` (`consent.ts:30`);
  - `mandatePurpose` plus the `chargeInput` enum (`contracts.ts:126,352,376`).

  R5-P1-1's fix is the moment to derive them from one source (AP-42).
- **Claims to correct** (domain map, README, builder ledger):
  - "a stay added later is not covered" (R5-P1-2);
  - "whatever the label" (R5-P1-1);
  - "evidence … never by the client" (R5-P3-1);
  - "consent never reads the owner" and "today it is guest self-service" (R5-P3-2);
  - § 5.1 is missing the staff edge out of `completed` (R5-P2-1).
- **The builder's "choices to review":**
  - `folioIds`: acceptable as coded.
  - The r3 "one step beyond" expectation change: correct under R4-P2-1.
  - The `confirmLinkStopped` permission: the answer is in R5-P2-1 (finance role, after the exception).

## 7. Coverage declaration

### Checklist

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation | not applicable this round: no new tables. Migration 0004 only alters checks and adds a column and index on the RLS tables `payments.payment_requests` and `payments.payments` |
| 2 | Authorization | probed — finding R5-P2-1 (link-stopped permission); `confirmCardForBooking` refuses staff (builder M4, code-read) |
| 3 | Money and finance principles | probed — findings R5-P1-1, R5-P1-2, R5-P2-1 |
| 4 | Idempotency and concurrency | probed — clean (R5-B at N=10; link-stopped idempotent); `If-Match` gap folded into R5-P2-1 |
| 5 | Events and audit | code-read only: `linkStoppedConfirmed`, `bookingConsented` and `linkDeactivated` audited with before/after; `requestPaid` emitted once (`operations.ts:1031`) |
| 6 | Contracts | probed — finding R5-P1-1 (purpose enum on public inputs); `LedgerPort.balanceOf` / `depositsHeldFor` match finance's provider (code-read) |
| 7 | Data authority and environment safety | code-read only: `assertPaymentsWritable` on every new write path; the deactivation adapter is unchanged |
| 8 | Errors and UX contract | code-read only: new messages state problem and recovery; R5-P3-3 is a wording defect |
| 9 | Spec coverage | code-read only: Amendment 3 bullets 1–5 mapped (§ 4b). Bullet 1 is broken by R5-P1-2 and the purpose limit by R5-P1-1 |
| 10 | Scenario claims | code-read only: s05, s06, s20 and the edited scenario tests still assert outcomes; no new scenario claims |
| 11 | Honest readiness | code-read only: Stripe deactivation is still R3 (unit-tested only); README "not built" residuals are correct except R5-P3-2 |
| 12 | Code quality | probed — lint and typecheck clean; no `any`; three purpose enums (§ 6) |
| 13 | One-product experience | not applicable (no new primary record type or UI this round) |
| 14 | Competitive parity gate | not applicable ("PARITY FILE: none for this round") |
| 15 | Cross-module coherence | code-read only: finance ↔ payments ports (`lockCollections`, `balanceOf`, `depositsHeldFor`) consistent; taxonomy duplication (§ 6) |

### Patterns

| Pattern | Status |
|---|---|
| AP-01 | code-read only: named bookings and folios validated to the entity and properties at save (`accounts.ts:463-503`) |
| AP-02 | not applicable: no new tables or queries without RLS |
| AP-03 | code-read only: card token unique per (tenant, account, token); VCC by (channel, reference) |
| AP-04 | probed — **finding R5-P1-1** (purpose); R5-P3-1 (evidence channel and time) |
| AP-05 | probed — finding R5-P2-1 (link-stopped reachable by the desk role) |
| AP-06 | code-read only: no new permission keys (link-stopped reuses `paymentRequest.create`) |
| AP-07 | not applicable (no identity credentials) |
| AP-08 | probed — reverse order run for R5-P1-2 (deposit first, stay added after) and R5-C (paid first, re-issue after) |
| AP-09 | code-read only: `payments.payment.collect` with `no_show` reaches any consented charge (folded into R5-P1-1); no admin equivalence |
| AP-10 | code-read only: the R5-P2-1 fix moves confirmation to finance (separation from link creation) |
| AP-11 | not applicable (no step-up surface touched) |
| AP-12 | not applicable (no rate limits touched) |
| AP-13 | not applicable |
| AP-14 | not applicable (no new outbound URL inputs) |
| AP-15 | code-read only: no tokens returned; Stripe adapter unchanged except the lifetime cap |
| AP-16 | not applicable (no UI) |
| AP-17 | not applicable (no erasure path touched) |
| AP-18 | not applicable |
| AP-19 | code-read only: simulator-only `simulateRequestPayment` with partial amounts → R5-P3-3 (simulator more lenient) |
| AP-20 | probed — clean (R5-B N=10, running total under the card lock) |
| AP-21 | probed — clean (link-stopped replay; charge business keys) |
| AP-22 | probed — finding R5-P1-1 (the no-show fee is not bound to the agreed penalty) |
| AP-23 | code-read only: running-total arithmetic, `Math.max(0, …)` on open holds |
| AP-24 | not applicable (no tax paths changed) |
| AP-25 | probed — clean (refunds never restore headroom; void and expiry release correctly) |
| AP-26 | probed — finding R5-P2-1 (a "stopped" attestation stands in for "payment recorded"); R5-P3-3 wording |
| AP-27 | not applicable |
| AP-28 | probed — **finding R5-P1-1 (R5-A2)** and R5-P2-1 (the guest pays twice) |
| AP-29 | probed — clean (30-minute deadline in R4-E with the clock advanced); finding R5-P2-1 (confirmation needs no deadline) |
| AP-30 | not applicable (no new consumers) |
| AP-31 | code-read only: a late provider confirmation after a staff confirm is a no-op (`where link_status = 'deactivating'`) |
| AP-32 | not applicable |
| AP-33 | not applicable |
| AP-34 | not applicable |
| AP-35 | code-read only: unknown deactivation outcome → `pending` (fails closed) |
| AP-36 | probed — clean (lock order § 4c; M6 and M9 killed); R5-P3-4 (deposits guard is probabilistic) |
| AP-37 | code-read only: deactivation and link creation run after commit |
| AP-38 | code-read only: `assertWritable('charges')` in `applyDeposits` before the lock |
| AP-39 | code-read only: `createMethod` `onConflict doNothing`; VCC token pre-check |
| AP-40 | code-read only: `LedgerPort` additions match `financeLedgerForPayments` |
| AP-41 | code-read only — finding R5-P3-3 (simulator accepts partial link payments) |
| AP-42 | code-read only — note § 6 (purpose taxonomy in three places) |
| AP-43 | not applicable (no event payload changes) |
| AP-44 | probed — finding R5-P1-2 (validation at consent time, not at deposit application) |
| AP-45 | probed — **finding R5-P1-2** (booking-level sibling of R4-A2); R5-P1-1 (`no_show` sibling of the `custom`/`incidentals` labels) |
| AP-46 | code-read only: confirm and credit run in one transaction; release after commit |
| AP-47 | code-read only: holding the full cap blocks further use (builder's (d) column); recovery stated |
| AP-48 | not applicable |
| AP-50 | probed — finding R5-P2-2 (untested guard); R5-P3-4 |
| AP-51 | code-read only: Stripe deactivation is unit-tested only, still R3 |
| AP-52 | probed — clean (§ 1, merged copy, `--force`, exit codes) |
| AP-53 | probed — finding R5-P1-1 (an effect parameter, the purpose, not bounded by the entry permission) |
| AP-54 | probed — R5-P2-2 (the R4-P1-2 fix relies on in-flight statuses; re-rated from untested to P2); R5-P3-4 |
| AP-55 | probed — the builder's no-show test asserts `accepted` for a non-no-show (evidence for R5-P1-1) |
| AP-56 | probed — clean (revocation and charge serialize on the card row; `detachMethod` code-read) |
| AP-57 | probed — **findings R5-P1-1 and R5-P1-2** (the label and `add_stay` are written by the role the control restrains) |
| AP-58 | probed — finding R5-P2-1 (the `completed` exit missing from the state machine) |
| AP-59 | probed — clean for the provider link (deactivated before replacement), except R5-P2-1 |
| AP-60 | probed — finding R5-P1-1 (the stored no-show consent is enforced against a client label) |
| AP-61 | probed — clean (`payment_link_not_stopped` after the deadline, owner finance) |
| AP-62 | probed — findings R5-P3-1, R5-P3-2 (recorded claims differ from code) |
| Group F (UX-*) | not applicable (UI REVIEW: no) |

Totals: 61 patterns; **44 applicable**, all probed (25) or code-read (19); 17 not applicable, each with a reason.

## 8. Files

- Report: `docs/orchestration/reviews/review-integration-step-5.md`
- `docs/orchestration/reviews/integration-step-poc/r5-fix-attacks.test.ts.txt`
  - FINDING tests: R5-A1, R5-A2, R5-C, R5-D.
  - CLEAN tests: R5-B ×3, R5-M (the mutant killer).
- `docs/orchestration/reviews/integration-step-poc/r5-inverted-r4-fix-attacks.test.ts.txt`: the r4 PoCs with
  `bookWithCard` setups.
- `docs/orchestration/reviews/integration-step-poc/r5-inverted-r4-r3-original-pocs.test.ts.txt`
