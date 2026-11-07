# Steward re-review (focused, after the fix round): `feat/integration-step`

Reviewer: architecture steward · 2026-11-07 · playbook v2.1, variant "focused re-review".

- Branch `feat/integration-step` @ **`6fb1d00`** (the worktree `/home/user/wt/integration-step` was not modified).
  - During the review the branch moved to `36a5849`. That is a merge recording an old WIP checkpoint, and
    `git diff 6fb1d00 36a5849` is empty, so every finding applies unchanged.
  - `main` moved to `0fa21bd`, with docs-only changes since `318fbab`.
- Scratch copy: `git worktree add --detach` at `6fb1d00`, then `main` @ `318fbab` merged in (copy commit `85f86ae`).
  The merge conflicted only in two append-only docs (`docs/OPEN_QUESTIONS.md`: branch Q156, main Q157;
  `docs/orchestration/pending-fixes.md`). Both were resolved as a union; no code conflicts. The copy was removed at the end.
- Inputs: the first review (`review-integration-step.md`) and its 7 PoCs, ADR-0015 (§5 as amended), the fix commits
  `6d0cae8`, `4e061b3`, `7b81cc9`, `8b3fdfb`, `216200e`, `ee4fcb4`, `e9e8b7d`, `eaa99fc`, `1b9cf7b`, `e47ef37`, `6fb1d00`.

## Verdict: **merge after fixes**

The fix round closes every attack the first review proved. All 7 original PoCs, re-run with their `BUG` assertions
inverted (9 tests), are now refused, and all gates are green on the merged copy.

But attacking the three P1 fixes themselves finds three new P1s. Each fix holds for the exact attack that was reported.
Each one fails at its boundary:

1. **R2-P1-1 (P1-2 reopened by reverse order).** The "card belongs to the booker, an occupant or the payer" rule is
   controlled by the role it is meant to restrain. A reservations agent has no `payments.payment.collect`. They can
   still make a stranger the booker or a sharing occupant of a new booking, and record that stranger's saved card as
   its guarantee. An ordinary check-in by a role with **no payments key** then held USD 7,117.80 on the victim's card.
2. **R2-P1-2 (P1-3 only fixed for one charge).** Payments allows only one open balance link per folio, so a second
   late charge on the same folio is never requested. The fix also leaves the open exception at its first severity, so
   the urgent "collect USD 409.50" stays marked **routine**. The fix introduced that regression. Separately, reversing a
   late charge leaves its payment request open for money the guest no longer owes. That is the original P1-3 harm,
   reached through a sibling path.
3. **R2-P1-3 (P1-1's trusted exemption has an unguarded writer).** The fix trusts `finance.deposit_accounts` for
   imported opening deposits. But the opening-deposit import never asks reservations who owns the booking.
   - A Hiyani finance user imported a deposit onto Kandu's booking.
   - Kandu's real deposit then charged the guest's card and failed to post (`payment: succeeded, ledger: failed`).
   - Rated at P1 under AP-54: a weakness the fix depends on takes the fix's severity.

Counts: **P0 0 · P1 3 · P2 4 · P3 5.**

---

## 1. Command results (merged copy, `PORTICO_TEST_DB_PREFIX=review_intstep2`)

Exit codes were captured directly, never from piped output.

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | **exit 0**: 755 files checked; "Module boundaries OK (10 modules checked)" |
| `pnpm turbo run typecheck --force` | **exit 0**: 18/18 tasks, 0 cached |
| `pnpm turbo run test --force --concurrency=2` | **exit 0**: 16/16 tasks, 0 cached, 1m42s |

Per-package test results:
- api: 79 passed, 29 todo (27 files, 8 skipped because they contain only todos);
- reservations 149 · payments 113 · finance 85 · rates 130 · guests 174 · integration 173 · inventory 98 · operations 120;
- ui 87 · backoffice 36 · kernel 26 · db 12 · platform 9 · identity 5 · http 3.

Probe runs, in the copy's `apps/api/test/`:

| File | Result |
|---|---|
| `zz-review-r2-inverted.test.ts` | 9/9 pass: every original attack is refused |
| `zz-review-r2-attacks.test.ts` | 11/11 pass: each asserts the defect it demonstrates |
| Both files | `tsc --noEmit` clean |

Databases: the harness dropped every `review_intstep2*` database, and none remain. Two `review_idplus_m_*` databases from
an earlier review were left untouched.

Not run: the backoffice Playwright e2e suite (not part of `turbo test`; this round changes no UI).

---

## 2. Original findings: closed?

| ID | Status | Evidence |
|---|---|---|
| P1-1 deposit for another property's or an unknown booking | **Closed as reported**; a sibling is open (R2-P1-3) and an exemption is open (R2-P2-3) | Inverted PoC: `ledger_target_other_property` / `ledger_target_unknown`, 0 deposit accounts, Kandu reads status and checks in. Builder regressions in `apps/api/test/review-regressions.test.ts` (P1-1). |
| P1-2 check-in holds any card for any amount | **Closed as reported; reopened by reverse order** (R2-P1-1) | Inverted PoC: the night receptionist gets 403 and 0 authorizations. A stranger's card is refused even with `collect`. Cap ±1 holds: `cap` is authorized, `cap+1` fails with nothing held (R2-B). |
| P1-3 late charge on a folio in credit requests money | **Closed for one charge; incomplete** (R2-P1-2) | Inverted PoC: no request while in credit. Multi-charge and reversal cases fail (R2-D, R2-E). |
| P2-1 FD-15 money leak | **Closed for** the arrivals board, booking and stay records and booking list; **siblings open** (R2-P2-2) | Inverted PoC: `payment_secured` is `unknown` for both rows, `totals`, `depositRequirement` and `status.payment` withheld. |
| P2-2 finance unscoped delegation | **Closed** | Inverted PoC: an omitted scope throws. Listing with Kandu scope excludes Hiyani's folio. `support.ts` `delegated()` has no "all" mode. |
| P2-3 rates seal not verified | **Closed** (nit R2-P3-3) | Inverted PoC: penalty and schedule throw `terms_seal_invalid`. |
| P2-4 S04 overclaim | **Closed** | `s04-family-split-billing.test.ts`: same type and plan, Green Tax asserted per person-night, infant exempt. |
| P2-5 "every port bound" overclaim | **Closed (documented)** | `pending-fixes.md` lists every still-stubbed port; the domain map is updated. |
| P2-6 rates and guests re-check keys | **Rates closed; guests deferred** | `modules/rates/src/provider.ts` (`delegateAtProperty`, overrides explicit); the guests decision is in pending-fixes. |
| P2-7 misleading 403 at check-in | **Closed** | `workflows.ts:415-430` `readStatus` maps `scope_mismatch` to a failed step that names the recovery. |
| P3-1, P3-2, P3-4, P3-5, P3-6, P3-8 | Closed | Code-read of `216200e` and `eaa99fc`. |
| P3-3, P3-7 | Deferred (pending-fixes) | — |
| P3-9 connected-mode dead end | **Closed, but the replacement over-claims** (R2-P2-4) | Inverted PoC: check-in completes for charges or payments external. |

---

## 3. New findings

### R2-P1-1 — P1-2 reopened by reverse order: whoever links the cardholder to a booking chooses the card held at check-in

**Where:**
- `modules/reservations/src/service/guarantee.ts:13-35` (`allowedOwners`: booker, occupants of any stay, company, agency,
  billing payer).
- Card recorded with only the owner check: `bookings.ts:333` (create) and `bookings.ts:931` (patch).
- `workflows.ts:500-505`: `payments.payment.collect` is required only when the check-in *input* differs from the
  booking's recorded card.
- Discovery: `GET /v1/bookings/:id` returns `guarantee.paymentMethodId` and the booker's profile id to any
  `reservations.booking.read` holder.

**Attack** (PoC `r2-fix-attacks.test.ts.txt`, R2-A, both variants pass):
1. The victim, a returning guest, has a card on file from their own booking.
2. A `reservations_agent` (template: `reservations.booking.*`, **no** `payments.payment.collect`) reads that booking and
   learns the card's method id and the victim's profile id.
3. The agent creates a 7-night booking for an accomplice. Either the victim is the **booker**, or the victim is a
   **sharing occupant**. The victim's card is recorded as the guarantee. The owner check passes.
4. A check-in by a custom role with **no payments key**, choosing nothing, authorizes the victim's card for the agreed
   total: `amount_minor: 711780`, status `authorized`, "Card authorized … (confirmed by payments)".

Not verified here: whether check-out settlement then captures against the guarantee card.

**Why it matters:**
- ADR-0015 §5 (as amended) says choosing the payment method "is explicit unless it is bound to the agreed guarantee".
  The agreed guarantee is written by a role without payments rights, and the owner set it is checked against is
  written by the same role. So the exception is not safe (AP-08 reverse order, AP-53).
- Privilege equivalence (AP-09): `reservations.booking.create` or `reservations.booking.update` now reaches "choose
  whose card is held". That is part of `payments.payment.collect`.
- The cap does not help. Its base, the agreed total, is also chosen by the agent: book a longer or dearer stay.

**Fix (principle):**
- Rule: choosing which stored card secures or pays for a booking is a payments decision.
- A role without `payments.payment.collect` may cause a hold only on a card that one of these two things makes safe:
  - the **cardholder supplied it for this booking**: the method is owned by `booking:<this id>`, saved through hosted
    entry, a terminal or a channel VCC for this booking; or
  - a **recorded mandate** whose scope covers reuse for this booking.
- Linking a person as booker, occupant, payer, company or agency is a reservations act, **not** cardholder consent.

Instances to cover:
- `createBooking` and `patchBooking` guarantee (`bookings.ts:333/931`);
- channel create and modify (`channel.ts:537/760`, see R2-P3-2);
- the check-in input (`workflows.ts:501`);
- later: waitlist and quote conversion, group masters, `incrementAuthorization` on extension (S03 follow-up), and
  check-out settlement against the guarantee card.

Also:
- Return `guarantee.paymentMethodId` only to roles that handle money, as `card on file` plus last-4 through payments.
- Name in ADR-0015 §5 that "agreed guarantee" means a card the cardholder supplied for this booking, not one staff
  attached.

**Attack run against the fix.** "Owner = this booking": who controls a method owned by the booking?
- `payments.method.manage` holders, through hosted entry or a terminal, where the card data comes from the
  cardholder.
- `payments.vcc.manage` holders, through `registerVirtualCard` (`payments/src/service/requests.ts:434-490`). It
  creates a `booking`-owned method with an MIT mandate. The reservations-agent template holds this permission.
  - It cannot rebind a token that is already saved: the unique (tenant, account, token) constraint refuses the insert.
  - But it does not check that the booking came from that channel.

So the rule must read "a VCC registered for a **channel** booking from **that** channel". With that refinement the
boundary holds. A side note for payments: in demo, registering a VCC with a test token that is already in use aborts
the transaction (AP-39).

### R2-P1-2 — P1-3 fixed for one charge only: the collection request is not kept in step with the folio

**Where:**
- `modules/finance/src/service/postings.ts:743-800` (departure branch of `postCharge`).
- `modules/payments/src/service/requests.ts:79-105`: one open `balance` request per folio, otherwise
  `collection_already_in_progress`.
- `modules/payments/src/finance-collections.ts`: every 4xx becomes `not_possible`.
- `modules/finance/src/service/support.ts:528-529`: the exception upsert updates `message` and `details` but **not
  `severity`**.

**Attack** (R2-D, run concurrently **and** sequentially with the same result; R2-E):

(a) The folio is at −50,000 after check-out. Three late charges of 40,950 gross each arrive:
- Charge 1 is covered by the credit: a routine exception, `covered_by_credit`.
- Charge 2 requests 31,900. Correct.
- Charge 3 is refused by payments ("An open payment link for the balance of this folio already exists"):
  `collection: not_possible`.

Result: the folio owes **72,850**, but only **31,900** is requested. The single open exception:
- still has severity **`routine`**, inherited from charge 1. Before the fix every late-charge exception was `urgent`, so
  this downgrade is a regression introduced by the fix;
- says "which now owes 40950 … Collect payment", although the folio owes 72,850;
- records `amountRequested: 40950`, although nothing was requested. A failed action looks done.

The folio lock itself works: lock order and balance read are correct (AP-20/AP-36 clean). The defect is the state
model, not the race.

(b) A late charge of 23,400 is requested (`open`). The charge is then reversed as posted in error: `reverseEntry` by the
night auditor, and the folio is back to 0. The payment request for 23,400 **stays open**. The guest is asked to pay
money they do not owe, which is exactly the P1-3 harm.

**Fix (principle):**
- After departure, a folio has **at most one open balance request, and it always equals the folio's current debt**.
- Every change to a departed folio's balance recomputes that request under the folio row lock: amend it up, amend it
  down, or cancel it at zero.

Instances:
- late charge: `postCharge` departure branch;
- reversal: `reverseEntry` `postings.ts:1797`;
- adjustment: `adjustPosting` `:1531`;
- transfer in or out: `transferPostings` `:1292`;
- payment and refund: `recordPayment` `:882`, `recordRefund` `:1035`;
- deposit application;
- and any later Day Close posting to a departed folio.

Payments needs an "amend the amount of an open request" command (or cancel and re-issue with link continuity), not a
second request.

The exception must also be recomputed:
- the upsert updates `severity`;
- `amountRequested` is only what payments accepted;
- the message states the folio's debt and the open request.

Add regressions for: 3 late charges; a charge followed by its reversal; a charge followed by a transfer out.

**Attack run against the fix.**
- The guest is paying the link (`partially_paid`) when a reversal amends it down. The amended amount must never fall
  below what was paid, and an in-flight payment must not be invalidated.
- Two late charges with an open request run concurrently. R2-D shows `lockFolios` serializes them, so the amend reads
  committed state.

### R2-P1-3 — P1-1's trusted fallback has an unguarded writer: opening deposits bind another property's booking, and a real deposit is then charged but not posted

**Where:**
- `modules/finance/src/service/deposits.ts:968-1120` (`importOpeningDeposits`): no ownership check per item. Rows are
  bound to `input.propertyId` and its legal entity.
- `ledger-port.ts:280-305` (`describeTarget`): falls back to `deposit_accounts` when reservations does not know the
  booking.
- `deposits.ts:87`: an account at another property is a hard stop.
- `payments/src/service/shared.ts:143-172` (`assertLedgerTarget`): checks only reservations' owner, not finance's
  deposit-account consistency.

**Attack** (R2-F):
1. A `finance` user scoped to **Hiyani** imports an opening deposit of 100 for **Kandu's** booking. The import is
   accepted (`importedCount: 1`) and the account is created at Hiyani and its legal entity.
2. Kandu's desk later takes the real deposit:
   - payments' pre-check passes, because reservations says the booking is Kandu's;
   - the card is charged;
   - finance then refuses the posting.
3. Result: `{"payment":"succeeded","ledger":"failed"}`. The guest's money is taken and not on any ledger.
4. Code-read: Kandu's check-in `applyDeposits` would then hit `intercompany_transfer`, because the account is at
   Hiyani's legal entity.

The same import also accepts ids that exist nowhere. Those then pass `describeTarget` as "imported" bookings: the
"deposit for a booking that exists nowhere" case of the original P1-1.

**Why P1:** under AP-54, the P1-1 fix newly treats `deposit_accounts` as authoritative for unknown bookings and as a
blocking fact for known ones, so the weakness of its writer is load-bearing. The actor needs
`finance.openingBalance.import`, which is sensitive. But a wrong-property migration file is a realistic mistake (S18),
and the damage crosses legal entities.

**Fix (principle):**
- A deposit account may exist for a booking only when the booking's owning module confirms that the booking belongs
  to the account's property and legal entity, **on every path that creates one**: `recordDeposit` (done),
  `importOpeningDeposits`, and later migrations.
- Import rows for another property's booking are rejected per row.
- An id unknown to reservations is accepted only if the import marks it explicitly as `legacy_not_migrated`. Such an
  account is frozen for new money until it is linked.
- Payments' pre-check must use the **same predicate** as finance's posting (`assertTargetInScope`, including
  deposit-account consistency) before any card is charged. Pre-check and post-check must not disagree (AP-44).

**Attack run against the fix.** If bookings are migrated *after* deposits (migration order), the strict check rejects
legitimate rows. The explicit `legacy_not_migrated` flag plus the freeze keeps them safe without trusting them.

### R2-P2-1 — The card owner the P1-2 rule relies on is not a stable fact (declared gap, rated)

**Where:**
- `modules/payments/src/service/accounts.ts:416-457`: a re-save of a token returns the existing method with its
  original owner and property.
- Payments has no consumer of `guests.profile.merged` or `unmerged`, while reservations re-points bookers and occupants
  (`subscriptions.ts:52-65`).

**Attack** (R2-C):
- In a demo organization, guest Ana saves the simulator token `pm_card_visa`.
- Guest Ben saves the same test token and receives **Ana's** method (owner Ana).
- Ben's own booking with it is refused: `guarantee_method_not_allowed`.

Effects:
- Demo and trial accept only a few simulator test tokens. So every second guest using the same token cannot secure
  their booking, which breaks the evaluation path the adoption brief prioritizes.
- In live, a duplicate profile that is later merged leaves the guest's own card owned by the merged-away id. Their
  check-in then fails with "belongs to someone who is not a guest". This was code-read, not run.

**Fix (principle):** card ownership is a set of links, not a first-saver attribute.
- A re-save for another owner adds an audited owner link, or simulators issue a distinct token per save.
- Merges and unmerges re-point method owner links.
- A token saved at another property of the same account is not returned across properties.

### R2-P2-2 — FD-15 siblings: workflow runs and stay issues still give payment state (and amounts) to every booking reader

**Where:**
- `workflows.ts:204-220` (`getWorkflow`, `GET /v1/stays/:id/check-in` and `/check-out`, checks only
  `reservations.booking.read`). It returns step results and messages: `paymentStatus: 'authorized'`, "Card authorized
  …", deposit and settle steps.
- `record.ts:115`: the stay's `check_in_incomplete` issue embeds the failed step's message. For the guarantee step that
  includes "at most {cap} minor units (the agreed stay total …)".

**Attack** (R2-G): `housekeeping_supervisor` reads the check-in run and sees `paymentStatus: 'authorized'` and
"Card authorized (confirmed by payments)".

**Fix (principle):** every response derived from payment state or money goes through the same `seesMoney` filter:
status, step results, step messages, issues and counts.

Instances:
- `getWorkflow` (check-in and check-out);
- the stay and booking issues built from runs;
- `performWorkflow`'s response for a non-money actor;
- booking version history, if exposed.

### R2-P2-3 — Payments' reference check fails open for every type except stay and booking, and when unbound

**Where:** `payments/src/service/shared.ts:187-189`:
- `if (!d.references) return;` (an optional dependency, `index.ts` `references?`);
- `if (owner === undefined) return;`, so any ref type other than `stay` or `booking` is unchecked.

`anyRef.type` is free text of up to 40 characters.

**Attack** (R2-H):
- A Hiyani desk agent authorizes a card with `ref: {type:'folio', id: <Kandu folio>}`: **accepted**.
- Kandu's desk then gets **403** reading its own folio's payment status (AP-47 griefing, same class as P2-7).

**Fix (principle):**
- Use an allow-list: payments accepts only reference types whose owner it can verify, and refuses any other type
  (including `'Stay'`):
  - `stay`/`booking` through reservations;
  - `folio` through finance's `assertTargetInScope`.
- Make the directory a required dependency. A standalone deployment binds an adapter that verifies against the
  connected PMS or refuses stay and booking references.

Siblings: `authorize` (`collect.ts:273`), `recordAuthorization` (`:1164`), and any future hold or link command.

### R2-P2-4 — P3-9 replacement over-claims: an external domain auto-completes the money step with an unverified "taken in X"

**Where:** `workflows.ts:647-665` (`externalAttestation`). When `authority === 'external'`, the guarantee or deposits
step is set to `done` with "The guarantee is taken in Legacy PMS …". Nobody attests anything: no person, reference or
time, and the external system has confirmed nothing. Forward write mode is treated like read-only.

**Why it matters:**
- CLAUDE.md §5: never show confirmed unless the authoritative system confirmed it.
- AP-26: an uncertain outcome is shown as definite.
- The builder's P3-9 regression asserts `done`, not attestation (AP-55).

**Fix (principle):** an external domain changes **who** confirms, not **whether** it is confirmed.
- The step stays `external_pending` until a person attests: who, when, and the reference in the external system.
- Or the integration confirms it.
- With `writeMode: 'forward'`, the request is forwarded.
- Provenance is `external`.

### P3

| ID | Where | Finding | Fix |
|---|---|---|---|
| R2-P3-1 | `guarantee.ts:73-84`; `platform/src/service.ts` `setPolicy` | The cap **fails open**. A non-numeric policy value makes the cap `NaN`, and `amount > NaN` is false: R2-B held USD 25,000 on a 1-night stay after a GM saved `"no cap for VIPs"`. A negative value makes the cap 0, so every guarantee fails. The policy is not declared or validated anywhere (AP-35, AP-44). Impact is limited: only `collect` holders give amounts, and they can authorize through payments anyway. | Validate at save (a registry of policy keys with schemas). At use, a non-finite or out-of-range value means "use the default", so the cap fails closed. |
| R2-P3-2 | `channel.ts:756-765` (modify), `:535-540` (create) | Channel **modify** writes `guarantee.paymentMethodId` without the owner check; check-in re-checks it. Channel **create** throws `guarantee_method_not_allowed` inside ingestion, which would reject an OTA booking that was already sold. | Modify: apply the same rule as R2-P1-1. Create: record an issue and drop the card, never refuse the booking. |
| R2-P3-3 | `reservations/src/adapters/rates.ts:345` | `ratesDocumentOf(view, verify?)`: every call site passes `verify` today, but the default is open. | Make `verify` required. |
| R2-P3-4 | `modules/payments/src/events.ts` | Payments events lack `aggregateVersion` (declared gap). No consumer derives state from them today (grep), so this is latent (AP-31). | Add versions before the first consumer (comms, integration). |
| R2-P3-5 | `reservations/src/service/context.ts:101-108` | `seesMoney` treats payment state and commercial value as one thing. `revenue_manager` and `read_only` lose booking totals in lists and records, though booking value is the revenue manager's core data. | Split: payment state, balances and folio links need money roles; commercial totals also go to `rates.price.read` or `analytics.*` holders. |

---

## 4. Gaps the builder declared

| Declared gap | Probe | Result |
|---|---|---|
| No concurrent test for two late charges on one folio | R2-D: 3 charges with `Promise.allSettled`, separate transactions, and the same 3 charges sequentially | The lock is correct (identical results). The state model is not: **R2-P1-2(a)**. |
| No ±1 test at the guarantee cap | R2-B | `cap` is authorized and `cap+1` fails with nothing held: **clean**. Non-numeric policy: **R2-P3-1**. |
| Saved-card ownership when a second guest saves the same token | R2-C | **R2-P2-1**: in demo or trial, every second guest using the same test token is refused. |
| Payments events lack `aggregateVersion` | Grep for consumers | None today: **R2-P3-4** (latent). |

## 5. Exemption audit of the fixes

| Exemption | Safe? |
|---|---|
| `assertReferenceAt`: `if (!d.references) return` and `owner === undefined → return` | **No**: R2-P2-3. |
| finance `describeTarget` falls back to `deposit_accounts` for bookings unknown to reservations | **No**: R2-P1-3 (the writer is unguarded). |
| `resolveDepositProperty(…, propertyId?)`: an omitted property uses the owner | Safe. The owner comes from reservations, and the permission is checked at that property. |
| check-in `overridesCard` compares against the booking's recorded card | **No**: R2-P1-1 (the recorded card is written without the capability). |
| `describeMethod` returns `null` for an inactive method or one of another property | Safe, and the message is helpful. |
| Guarantee cap: `Math.max(0, percent)` | **No** for `NaN`: R2-P3-1. |
| P3-9 "external domain ⇒ step done" | **No**: R2-P2-4. |
| FD-15 `unknown` payment state excluded from `ready` and `blockingReason` | Safe. `ready` feeds only the board count (`front-desk.ts:196`); operations' readiness is a different computation. Board and record siblings: R2-P2-2. |
| Finance `delegated()` still grants **unscoped** checks (`!scope?.propertyId`) | Acceptable. No finance function reached through the reservations surface checks those keys without a property (grep). The intent is documented as legal-entity-level only. It still differs from kernel `delegateAtProperty`: converge later. |
| `describeBooking` and `describeReference` check no permission | Acceptable. They return routing metadata only, with RLS, and are reachable only through ports. |

## 6. Pattern sweep steps 2–6 against the fix commits

**Step 2, reverse order (AP-08):**
- P1-1: a deposit or hold for an id before it exists is refused (unknown). An import before the booking exists is
  R2-P1-3.
- P1-2: link the cardholder first: **R2-P1-1**.
- P1-3: a request already open: **R2-P1-2(a)**; a correction after the request: **R2-P1-2(b)**.

**Step 3, attack the fix:** stated in each finding above. Each recommended fix is written as a rule with its known
instances.

**Step 4, sibling paths (AP-45):**

| Fixed path | Siblings |
|---|---|
| Card choice | create, patch, channel create, channel modify, check-in input (R2-P1-1, R2-P3-2) |
| Deposit binding | `recordDeposit`, `importOpeningDeposits`, payments pre-check (R2-P1-3) |
| Collection amount | late charge, reversal, adjustment, transfer, payment, refund (R2-P1-2) |
| Money redaction | board, records, list, workflow runs, issues (R2-P2-2) |
| Reference check | `authorize`, `recordAuthorization`, folio refs (R2-P2-3) |

**Step 5, privilege equivalence (AP-09):**
- `reservations.booking.create` and `reservations.booking.update` now reach "whose card is held". That is part of
  `payments.payment.collect`: R2-P1-1.
- `finance.openingBalance.import` at property H reaches property K's deposits and money: R2-P1-3.
- `platform.policy.override` at a property reaches the guarantee cap. It is not an escalation (the GM holds
  `payments.*`), but the cap fails open: R2-P3-1.
- The new rates delegation (`rates.quote.read` at the authorized property) reaches only quotes: clean.

**Step 6, load-bearing (AP-54):**
- P1-1 relies on the `deposit_accounts` fallback, re-rated as R2-P1-3, and on the reference type allow-list (R2-P2-3).
- P1-2 relies on method-owner accuracy (R2-P2-1: a false refusal, not a bypass, so it stays P2) and on booker,
  occupant and payer links (R2-P1-1).
- P1-3 relies on payments accepting a second request (it refuses) and on the exception upsert (its severity is
  frozen): R2-P1-2.

---

## 7. Coverage declaration

### Checklist 1–15

| # | Item | Result |
|---|---|---|
| 1 | Tenant isolation | Code-read only: no new tables; the new provider reads rely on RLS. |
| 2 | Authorization | **Probed** (inverted PoCs, R2-A, R2-H): finding R2-P1-1. |
| 3 | Money and finance | **Probed** (R2-D, R2-E, R2-F, R2-B): findings R2-P1-2, R2-P1-3, R2-P3-1. |
| 4 | Idempotency and concurrency | **Probed** (R2-D, genuinely concurrent): clean for the lock. Collect keys `…:collect:{folio}`: code-read, clean. |
| 5 | Events and audit | Code-read: findings R2-P3-4 and R2-P1-2 (exception state). |
| 6 | Contracts | Code-read: `describe*` ports match their providers (`satisfies`, typecheck); domain map updated (`1b9cf7b`). Clean. |
| 7 | Data authority and environment safety | **Probed** (inverted P3-9): finding R2-P2-4. No new external effects. |
| 8 | Errors and UX contract | Probed: findings R2-P1-2 (misleading exception), R2-P2-4. P2-7 is closed. |
| 9 | Spec coverage | Not probed: focused re-review, with no spec MUST added in this round. |
| 10 | Scenario claims | S04 re-read: closed. S05 and S01 (P3-8): code-read, clean. |
| 11 | Honest readiness | Not probed: no readiness changes in the fix commits. |
| 12 | Code quality | Code-read: no `any` or default exports in the fix diffs. Optional parameters noted (R2-P3-3). |
| 13 | One-product experience | Code-read: `moneyRedacted` and nullable totals are documented. Finding R2-P3-5. |
| 14 | Parity gate | Not applicable: no parity file for this step (run parameters). |
| 15 | Cross-module coherence | Code-read: payer-type mapping is duplicated (finance `profile→guest`, payments `guest→guest_profile`, reservations `profile→guest_profile`); see §8. |

### Patterns

**Group A — isolation, authorization and identity**

| Pattern | Result |
|---|---|
| AP-01 | **Probed**: findings R2-P2-3 and R2-P1-3. |
| AP-02 | Not applicable: no new tables; RLS untouched. |
| AP-03 | Probed through R2-C: finding R2-P2-1 (the token is unique per account, first saver wins). |
| AP-04 | **Probed** (R2-A, R2-B): finding R2-P1-1. |
| AP-05 | **Probed** (R2-G, workflow GET): finding R2-P2-2. |
| AP-06 | Code-read: `payments.payment.collect` is registered in the payments manifest. Clean. |
| AP-07 | Not applicable (identity). |
| AP-08 | **Probed**: finding R2-P1-1. |
| AP-09 | **Probed** (§6 step 5): findings R2-P1-1 and R2-P1-3. |
| AP-10 to AP-14 | Not applicable: no identity, step-up, rate-limit, IP or outbound-URL changes. |
| AP-15 | Code-read: method views and audits exclude the token. Clean. |
| AP-16 | Not applicable: no UI. |
| AP-17 | Not applicable. |
| AP-18 | **Probed**: finding R2-P2-2. |
| AP-19 | Code-read: no new effect paths. Clean. |
| AP-53 | **Probed**: finding R2-P1-1. |

**Group B — money and finance**

| Pattern | Result |
|---|---|
| AP-20 | **Probed** (R2-D): clean. |
| AP-21 | Code-read: clean. |
| AP-22 | Probed through the inverted P2-3 PoC: clean. |
| AP-23 | **Probed** (cap ±1): clean; `NaN` is finding R2-P3-1. |
| AP-24 | Not applicable: no tax logic change beyond the P3-4 refine. |
| AP-25 | **Probed** (R2-E): finding R2-P1-2. |
| AP-26 | **Probed**: finding R2-P2-4. R2-F's "succeeded / ledger failed" is shown honestly. |
| AP-27 | Not applicable. |
| AP-28 | **Probed** (R2-D): finding R2-P1-2. |
| AP-29 | Not applicable: unchanged. |

**Group C — events, integration and concurrency**

| Pattern | Result |
|---|---|
| AP-30 | Not applicable: no new consumers. |
| AP-31 | Code-read: finding R2-P3-4. |
| AP-32 and AP-33 | Not applicable. |
| AP-34 | Code-read: a check-in resume re-checks the resuming user's capability. Clean. |
| AP-35 | **Probed**: findings R2-P3-1 and R2-P2-3; omitted scope (P2-2) is clean. |
| AP-36 | Code-read and R2-D: clean. |
| AP-37 | Code-read: links are sent after commit. Clean. |
| AP-38 | **Probed**: finding R2-P2-4 (forward mode). |
| AP-39 | Code-read: `createMethod` uses `onConflict doNothing`. Clean. |
| AP-56 | Not applicable. |

**Group D — contracts and cross-module coherence**

| Pattern | Result |
|---|---|
| AP-40 | Code-read: clean. |
| AP-41 | Code-read: the reservations fake `describeMethod` checks the property but not the status. Minor. |
| AP-42 | Code-read: payer-type mappings are copied (§8). |
| AP-43 | Not applicable. |
| AP-44 | **Probed**: findings R2-P3-1 and R2-P1-3 (pre-check weaker than posting). |
| AP-45 | **Probed** (§6 step 4): findings R2-P1-1, R2-P1-2, R2-P1-3, R2-P2-2 and R2-P3-2. |
| AP-46 | Probed: the refused booking creates nothing (builder test, verified). R2-F charged the card but did not post: finding R2-P1-3. |
| AP-47 | **Probed**: findings R2-P1-3, R2-P2-3 and R2-P2-1. |
| AP-48 | Not applicable. |
| AP-54 | **Probed** (§6 step 6): finding R2-P1-3 re-rated. |

**Group E — claims and gates**

| Pattern | Result |
|---|---|
| AP-50 | **Probed** against the builder's three P1 claims: the P1-3 claim fails for more than one charge (R2-P1-2). |
| AP-51 | Code-read: the regressions use the real composition. Clean. |
| AP-52 | Gates ran forced on a merged copy with exit codes: clean. Playwright is outside `turbo test` (known). |
| AP-55 | Probed: the P3-9 regression asserts `done`, not attestation (R2-P2-4). The P1-3 regression asserts the amount (good). |

Group F (UI) is not applicable: no UI review.

Totals:

| | Probed | Code-read only | Not applicable | Not probed |
|---|---|---|---|---|
| Checklist (15) | 5 | 7 | 1 | 2 (#9, #11) |
| Patterns A–E (55) | 24 | 13 | 18 | 0 |

So **24 of the 37 applicable patterns** were probed.

---

## 8. Notes for the orchestrator

- **ADR-0015 §5 wording.** "Bound to the agreed guarantee" needs a definition. The card must be supplied by the
  cardholder for this booking, or covered by a mandate. A card attached by staff does not qualify (R2-P1-1).
  Otherwise every module that adds an "agreed X" reopens AP-53.
- **Payments requests need an amend command.** R2-P1-2 cannot be fixed in finance alone. It is a payments contract
  change: amend or cancel an open request with link continuity.
- **One predicate for "may money be held for this target".** Today it lives in three places:
  - reservations: `describeReference`;
  - finance: `describeTarget`, `assertTargetInScope`, and the deposit-account check;
  - payments: `assertLedgerTarget` and `assertReferenceAt`.

  They disagree (R2-P1-3, R2-P2-3). Make finance's `assertTargetInScope` the one predicate payments calls before any
  money moves.
- **Payer-type mapping is duplicated three times:**
  - finance `payerType` (`profile→guest`);
  - payments `payerOf` (`guest→guest_profile`);
  - reservations `allowedOwners` (`profile→guest_profile`).

  Candidate for a kernel `payerRef` codec (AP-42, foundation drift list).
- **Policy registry.** Policies are unvalidated JSON platform-wide (`setPolicy`). R2-P3-1 is one instance. A
  foundation item: modules declare their policy keys with schemas and defaults.

## 9. PoC files (`docs/orchestration/reviews/integration-step-poc/`)

Copy each file to `apps/api/test/<name>.test.ts`. It imports `./scenarios/harness`. Run it with
`--silent=false` to see the evidence lines.

| File | Proves |
|---|---|
| `r2-inverted-original-pocs.test.ts.txt` | All 7 first-review PoCs with their assertions inverted: every attack refused (9 tests pass) |
| `r2-fix-attacks.test.ts.txt` | Each test passes by asserting the defect it demonstrates. R2-A: R2-P1-1. R2-B: cap ±1 clean, R2-P3-1. R2-C: R2-P2-1. R2-D (concurrent and sequential): R2-P1-2(a). R2-E: R2-P1-2(b). R2-F: R2-P1-3. R2-G: R2-P2-2. R2-H: R2-P2-3. Flip the `FINDING` assertions once fixed. |
