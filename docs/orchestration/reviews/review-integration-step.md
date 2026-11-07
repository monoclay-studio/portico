# Steward review: `feat/integration-step` (every port bound, ADR-0015 delegation)

Reviewer: architecture steward · 2026-11-07 · branch `feat/integration-step` @ `dcddb8b`. The worktree
`/home/user/wt/integration-step` was not modified. Experiments ran in a detached scratch copy (`git worktree add
--detach`, then `main` merged in), which was removed afterwards. No steward playbook (`docs/quality/playbooks/`) or
attack-pattern library (`docs/quality/patterns.md`) existed yet on `main` or `docs/quality`, so this review follows
`docs/orchestration/steward-review-brief.md` and the focus list in the task.

## Verdict: **merge after fixes**

The integration step is solid engineering. Several parts hold up under attack:
- The kernel helper `delegateAtProperty` is correct. It never grants org-wide checks, it adds exactly one property, and
  the actor and audit trail are unchanged.
- Inventory's port surface refuses units, blocks, holds, unit types and refs of another property.
- House-use blocks and lock overrides really stay explicit.
- The new platform routes are permission-checked and tenant-isolated.
- Rates' `priceChange` rejects altered terms.
- The `valueOnly` deposit fix is correct (details in §4).
- All gates are green on a copy merged with `main`, and the scenario tests genuinely run the global consistency
  checks.

Binding the real providers makes three money and authorization defects live. Before this step they were hidden
behind stubs, and all three are proven by executable PoCs:

1. **P1-1:** a deposit can be taken and posted at the wrong property's legal entity, for a booking it does not own.
   A deposit for a booking that does not exist is also accepted. The owning property's check-in then throws a 403.
2. **P1-2:** the check-in guarantee step now places a hold of any amount on any saved card. It needs only
   `reservations.stay.checkIn`, because ADR-0015 delegation removed the payments permission check.
3. **P1-3:** a late charge on a folio still in credit sends the guest a payment request for money they do not owe.

None is P0: each needs staff action and the money is recoverable. But each breaks a "money correctness" or
"authorization across ports" guarantee that this step was meant to establish, so fix them before merge. The fixes
are small (see each finding).

Counts: **P0 0 · P1 3 · P2 7 · P3 9**.

---

## 1. Command results

`main` moved twice during the review, so the gates ran on two merged copies:
- Run A: `dcddb8b` + `main` @ `b44cd4c`, a clean merge.
- Run B: `dcddb8b` + `main` @ `1179c98`, after the backoffice merge.
  - This merge **conflicts in two docs**, `docs/OPEN_QUESTIONS.md` and `docs/orchestration/pending-fixes.md`. Both are
    append-only and resolved as a union. There is no question-number collision: branch Q146, main Q150–Q155.
  - The later `main` @ `012652e` changes docs only.

| Command | Run A | Run B |
|---|---|---|
| `pnpm install --frozen-lockfile` | ok | ok |
| `pnpm lint` | **exit 0**: 585 files, "Module boundaries OK (10 modules checked)" | **exit 0**: 751 files, boundaries OK |
| `pnpm turbo run typecheck --force` | **exit 0**: 16/16 (forced) | **exit 0**: 18/18 (forced) |
| `PORTICO_TEST_DB_PREFIX=review_intstep pnpm turbo run test --force --concurrency=2` | **exit 0**: 14/14 tasks, 0 cached | **exit 0**: 16/16 tasks, 0 cached |

Per-package test results (Run B):
- api: 68 passed, 29 todo; 26 files passed, 8 skipped because they contain only todos.
- reservations 148 · payments 113 · finance 85 · inventory 98 · operations 120 · rates 129 · guests 173 · integration 173.
- ui 87 · backoffice 36 · kernel 26 · db 12 · platform 9 · identity 5 · http 3.

Backoffice Playwright e2e was not run; it is not part of `turbo test`. The backoffice reads `frontDeskRow`, and the
branch only adds an optional `redacted` field to it.

PoC run (the 7 files in `integration-step-poc/`, copied into `apps/api/test/`): 9/9 pass, and `tsc --noEmit` is clean
on them.

Databases: test databases are dropped by the harness. A check after the runs found no `review_intstep%` database left.
Two `review_idplus_m_*` databases from an earlier review were left untouched.

---

## 2. Findings

### P1-1 — A deposit for a booking is never checked against the property that owns the booking

**Where:**
- `modules/payments/src/service/shared.ts:149`: `if (ref.type === 'booking') return; // first deposit: finance binds
  the booking to this property on posting`.
- `modules/finance/src/service/ledger-port.ts:303-325` (`assertTargetInScope`): "A booking without any finance record
  yet is accepted for its first deposit".
- Composition: no port asks reservations which property owns a booking.

**Attack** (PoC `poc-deposit-wrong-property.test.ts.txt`):
1. A reservations agent books Kandu (legal entity A).
2. A front-desk agent with rights at **Hiyani only** (legal entity B) calls `POST /v1/payments/charges` (`chargeNow`)
   with `propertyId = Hiyani`, a Hiyani card and `ref = {type:'booking', id: <Kandu booking>}`.
3. Result: `payment: succeeded, ledger: posted`. `finance.deposit_accounts` binds Kandu's booking to Hiyani and legal
   entity B. The guest's money is now in another company's merchant account and ledger.
4. Kandu's own desk can no longer read the booking's payment status. Every scoped read throws `scope_mismatch`, and
   the check-in **throws** `403 scope_mismatch` "This booking belongs to another property". That is wrong, since the
   booking is Kandu's.
5. Second test: a deposit for a **random booking id that exists nowhere** is accepted and posted as a liability.

Folios are protected (`ledger_target_unknown`, `ledger_target_other_property`); bookings are not. Before this branch
the stub accepted and parked the deposit. Now it posts.

**Fix:**
- Bind a booking-directory port from reservations: `describeBooking(tx, id) → { propertyId, legalEntityId,
  status } | null`, used by finance's `describeTarget`/`assertTargetInScope` for `booking` refs.
- Refuse unknown bookings (`ledger_target_unknown`) and other-property bookings before any money moves, exactly as for
  folios. Then delete the `return` at `shared.ts:149`.
- In reservations' guarantee step, catch `scope_mismatch` from `getPaymentStatus`. Fail the step with an explanation
  ("a payment for this booking was recorded at another property; finance must move it") instead of throwing.
- Add the PoC as a regression test.

### P1-2 — Check-in places a hold of any amount on any saved card, with no payments permission

**Where:**
- `modules/reservations/src/service/workflows.ts:483`: `methodId = input?.paymentMethodId ?? …`.
- `workflows.ts:514`: `amount = input?.amount ?? …`.
- `workflows.ts:524`: `payments.authorize(…)`.
- `modules/payments/src/service/index.ts:35,186`: `PAYMENTS_PORT_DELEGATION` grants `payments.payment.collect` at the
  stay's property.
- `collect.authorize` → `loadActiveMethod` (`collect.ts:96`) checks only that the method is active and that the account
  matches the property's legal entity.

**Attack** (PoC `poc-checkin-any-card.test.ts.txt`):
1. Create a custom role "night receptionist" with `reservations.stay.checkIn`, `reservations.booking.read`, guests
   read/update and unit reads. It holds **no `payments.*` key**.
2. Calling payments' own authorize command directly with this role is refused with 403 (asserted).
3. Run check-in on a booking with `guarantee: { paymentMethodId: <a card saved for a different guest>, amount: USD
   25,000 }`.
4. Result: an authorization of 2,500,000 minor units on the stranger's card, "Card authorized (confirmed by
   payments)".

ADR-0015 §5 says effects the entry permission should not imply must stay explicit. Choosing *which* card and *how much*
is such an effect: the check-in permission implies "secure this stay with its guest's guarantee", not "hold any card for
any amount". Before this branch the payments port was a stub. In live, a card with a recorded MIT mandate would be held.

**Fix:**
- In reservations, when `input.guarantee.paymentMethodId` differs from the booking's recorded guarantee method, or
  `input.guarantee.amount` is given, require `payments.payment.collect` at the property (an explicit capability).
- Verify that the method's owner is the booker, an occupant or the billing payer of the stay. Payments can expose
  `getMethod(…).owner`; reservations knows the profiles.
- Cap the amount at the agreed guarantee (the stay's gross, or the policy's pre-authorization item from
  `instantiatePaymentSchedule`) unless the explicit capability is present.
- Apply the same owner check when a booking stores `guarantee.paymentMethodId` (`contracts.ts:104`), so a reservations
  agent cannot attach another guest's card for the desk to authorize later.

### P1-3 — A late-charge collection request ignores the folio's credit, so the guest is asked to pay money they do not owe

**Where:** `modules/finance/src/service/postings.ts:743-756`. The collection request carries `amount: money(share,
currency)`, the late charge's full share, regardless of the folio balance. The bound
`paymentsCollectionsForFinance` (`modules/payments/src/finance-collections.ts`) creates an open payment request for it.

**Attack** (PoC `poc-late-charge-overcollect.test.ts.txt`):
1. A deposit of USD 500 is applied at check-in.
2. Check-out leaves the folio at −50,000 (the guest is owed USD 500).
3. A USD 100 minibar charge arrives after departure. The folio is now −38,300: still in credit.
4. Payments has an **open payment request for 11,700** (charge + TGST), and finance's exception says "Collect payment
   from the guest".

The bindings test (`apps/api/test/bindings.test.ts`, the "late spa charge" step) has the same over-collection
(64,000 requested against a 14,000 debt) but does not assert the amount.

**Fix:**
- Request `min(share, max(0, folio balance after posting))`.
- When that is 0, create no request: record `collection: 'covered_by_credit'` and raise a routine exception, not an
  urgent one.
- Assert the requested amount in `bindings.test.ts`, and add the PoC as a regression.

### P2-1 — FD-15 / C11.2 only half done: housekeeping still learns each arrival's payment state and reads booking money

**Where:** `modules/reservations/src/service/front-desk.ts:195-206`. Only `message` is redacted; `status`,
`blockingReason.key` and `ready` are kept. The booking and stay records (`record.ts`, `GET /v1/bookings/:id`) return
`totals`, `depositRequirement` and `status.payment` to any `reservations.booking.read` holder.

**Attack** (PoC `poc-fd15-money-leak.test.ts.txt`): the `housekeeping_supervisor` template reads the arrivals board.
- The paid arrival's `payment_secured.status` is `ok`; the unpaid one is `blocking`. Both carry `redacted: true`.
- `getBooking` returns gross USD 2,364.60 and `status.payment: 'paid'`.

This leak is new with the binding: payments reads are delegated at the property, so reservations computes payment
state for roles that hold no payments key. FD-15 said "It does not need balances **or payment state**", and C11.2 says
"Money fields are returned only to roles that handle money".

**Fix:**
- For callers without money-read permission, set `payment_secured` to `{status: 'unknown', message: NOT_SHOWN}` and
  leave it out of `ready` and `blockingReason`. Better still, skip the payments call entirely for them.
- Redact `totals`, `depositRequirement`, `status.payment` and folio links in booking and stay records (already listed
  in pending-fixes; this PoC shows the board is not done either).
- Extend `isolation-permissions.test.ts` to assert on `status`.

### P2-2 — Finance's reservations port still delegates organization-wide when the property is omitted

**Where:** `modules/finance/src/service/index.ts:526,628,635,646,653,682,717`. These functions declare `propertyId?`:
- `recordDeposit`, `applyDeposits`, `getFolioBalance`, `listFolios`, `setBillingRules`, `getDepositBalance`.

`delegated(tx, perms, undefined)` (`support.ts:54-61`) then grants `finance.folio.manage`, `finance.folio.read`,
`finance.posting.create` and `finance.billingRule.manage` at **every** property. `financeForReservations(finance)
satisfies FinancePort` accepts the optional parameter, so TypeScript does not catch a caller that omits it.

**Attack** (PoC `poc-finance-unscoped-delegation.test.ts.txt`):
- A Kandu-only reservations agent calls `getFolioBalance(hiyaniFolio)` and `listFolios({owner: hiyaniStay})` with no
  scope: both succeed.
- With `{ propertyId: kandu }` the same call is refused with 403.

Reservations always passes the property today, so this is not reachable over HTTP. It is the exact shape of the
earlier finance P0-1 and violates ADR-0015 §2.

**Fix:** make `propertyId` required on every `financeForReservations` function, as on `openFolio`/`postCharge`. Have
`delegated()` throw when `propertyId === undefined`; reserve `null` for explicit legal-entity-level calls.

Related nit: `changes.ts:895` passes `propertyId: stays[0]?.row.property_id ?? ''`.

### P2-3 — The rates adapter never verifies the seal before evaluating penalties and deposits

**Where:** `modules/reservations/src/adapters/rates.ts:343` (`ratesDocumentOf`) checks only `kind` and that `seal` is a
string. Rates' pure `evaluateCancellationPenalty` and `instantiatePaymentSchedule` do not verify either. Rates documents
`verifyTerms` as "check stored terms before use" (`modules/rates/src/service.ts:57`).

**Attack** (PoC `poc-rates-adapter.test.ts.txt`): a sealed BAR document with `policies.cancellation` and
`policies.deposit` set to `null` (seal string kept):
- `priceChange` correctly refuses it with `terms_seal_invalid`.
- The bound port evaluates it anyway: penalty **0** instead of 297,000, and deposit items 0 instead of 2.

There is also no check that the view's money fields (nights, totals) match the provider document they claim to
summarise. Reservations posts from the view and evaluates penalties from the document.

Severity: terms snapshots are append-only (`core.make_append_only`), and no current API stores client-supplied terms,
so today this needs DB-level tampering. The adoption brief's migration path (S18) will import agreed terms, which is
where this matters.

**Fix:**
- Add `verifyTerms` to `RatesProvider`, and have `ratesDocumentOf` call it, throwing `terms_seal_invalid`.
- Or have rates' pure functions take the key through the service wrapper.
- Optionally rebuild the view from the document (`termsView(doc)`) when loading, instead of trusting the stored view.

### P2-4 — Scenario S04 does not prove what it claims (child ages drive price and Green Tax)

**Where:** `apps/api/test/scenarios/s04-family-split-billing.test.ts:61-63`. It asserts that the Water Villa stay with
two children costs more than a 2-adult **Beach Villa** stay. A Water Villa costs more anyway: the comment itself says
"of the cheaper type". Green Tax per child is never asserted.

**Fix:**
- Compare the same unit type and plan with and without children (or with ages below and above the child-age band).
- Assert the Green Tax line amounts: the USD 12 class, with children under the exemption age free per the MV pack.

### P2-5 — "Binds every cross-module port that was stubbed" is overstated

Several ports whose providers are now on `main` are still stubs in `apps/api/src/composition.ts`:
- Integration `inbound: {}` (`:415`): reservations and operations/roomStatus handlers. Received records are stored
  `accepted` and never applied. This is the connect-alongside path, and S20 is todo.
- Integration catalogs (`:354-359`): `taxRule` (rates) and `chargeCode`/`ledgerAccount` (finance) still go through
  `unavailableCatalog`.
- Rates `affectedAgreements` (reservations/finance), with the comment "bound when those modules merge" (`:342-343`).
- Integration and rates still read inventory and rates with `asSystem` (`:330-331, :384, :393, :402`), despite the ADR-0015 "no
  system scope" direction.

**Fix:** bind them or list them explicitly in pending-fixes and the module READMEs' binding tables, and narrow the
claim to the ports actually bound.

### P2-6 — ADR-0015 applied to only part of reservations' ports; rates and guests still re-check their own keys

**Where:**
- `rates quote` → `requirePermission('rates.quote.read')` (`modules/rates/src/services/quote.ts:432`).
- `priceChange` → `rates.quote.read`.
- `complimentaryTerms` → `rates.price.override` (`:785-787`).
- `guests resolveProfile` → `guests.profile.update` (`modules/guests/src/service/profiles.ts:256`).

A custom role holding `reservations.booking.create` cannot book unless it also holds rates and guests keys. The binding
tests pass only because the role templates happen to include them. Pending-fixes says the rates gap is recorded "see
docs/OPEN_QUESTIONS.md", but there is **no such entry**; only Q146 was added.

**Fix:** give rates and guests a port surface (`delegateAtProperty` with rates.quote.read and guests.profile.update at
the passed property, keeping `rates.price.override` explicit per ADR-0015 §5). Or add the missing OPEN_QUESTIONS entry
and correct the dangling reference.

### P2-7 — The arrivals board and check-in fail with a misleading 403 when the payment records are inconsistent

**Where:** `workflows.ts:413` and `front-desk.ts:151-170`. `getPaymentStatus(…, { propertyId })` throws
`scope_mismatch`, which is unhandled in the guarantee step.
- On the board it is swallowed by `safely` and shown as `unknown`.
- In check-in it aborts the workflow with a 403: "This booking belongs to another property, so it cannot be used from
  here".

This is the user-facing half of P1-1. It is listed separately because it also applies to any future data repair.
The rule broken: "Error messages must explain the problem and the recovery".

**Fix:** map it to a failed step with the real explanation and a next step ("finance moves the payment to this
property").

### P3 (nits and hardening)

| ID | Where | Finding | Fix |
|---|---|---|---|
| P3-1 | `reservations/src/adapters/rates.ts:242,310` | `termsView` is lossy: cancellation basis `net_and_fees` and `gross` both map to `gross`; guarantee `accepted` lists containing `none` collapse to `['none']`. The preview fingerprint now excludes the document, so a change to only these fields between preview and commit is not detected. | Carry `basis` and `accepted` verbatim in the view (or include a digest of `providerDocument.policies` in `termsDigest`). |
| P3-2 | `reservations/src/ports.ts:286` and `quote()` | The port contract still declares `StayChangeRequest.asOf` and the quote `bookingDate`, which `ratesPortFrom` silently drops. | Remove them from the port, or document "ignored; rates evaluates now". A walk-in at 01:30 before Day Close was checked and works. |
| P3-3 | `operations/src/reservations-port.ts`, `service/tasks.ts:404-438` | `getUnitCondition(tx, unitId)` has no property scope (ADR-0015 §2). `createTaskForModule` checks only unit refs: a `stay`/`guestProfile` ref or `departmentId` of another property is accepted, and a `dedupeKey` hit returns another property's task. Nothing calls `createTask` through the port today. | Take `propertyId` on both; verify the department and the dedupe hit's property. |
| P3-4 | `rates/src/contracts.ts` `chargeLine` | `valueOnly: true` together with `levyOnly: true` silently yields no taxes. | `.refine` that they are mutually exclusive. |
| P3-5 | `payments/src/finance-collections.ts` | The collection request is always `payer: {type:'other', name}`, even for a guest-profile or company payer, so payments cannot address the link to the guest or company. | Pass finance's payer type and id through `CollectionRequest`. |
| P3-6 | `guests/src/service/search.ts:27` | Any 3+ digit query (a room number "214", a year) now switches guest search to phone-fragment mode. Room-number searches return guests whose phone numbers contain "214". | Require a leading `+` or 4+ digits, or run name and phone matching side by side with ranking. |
| P3-7 | `reservations/src/service/bookings.ts:284` | `booking.depositRequirement` comes only from the client input. A BAR booking with a 30% deposit policy shows `deposit: null` (seen in the FD-15 PoC) while change previews compute deposits through `instantiatePaymentSchedule`. | Derive it from the agreed schedule at creation and commit. |
| P3-8 | `scenarios/s05` (lines 62-77), `s01` (line 73 comment) | S05's "pressing charge again is blocked" calls the port directly, not the user path (re-running check-in or the payments route). S01's "nothing is posted at booking" is a comment with no assertion. | Exercise the user path; assert zero journal entries. |
| P3-9 | Connected mode (PoC `poc-connected-checkin.test.ts.txt`) | With charges or payments external, check-in stops at "Interrupted: Legacy PMS is the system of record…". The guarantee step is mandatory, so only a `reservations.stay.skipCheckInStep` holder can finish. This is ADR-0014 / adoption-brief connected mode. | When the domain is external, mark the step `external` with an attestation ("guarantee taken in Legacy PMS"), not `failed`. |

---

## 3. Authorization across ports (ADR-0015): what I checked and what held

| Path | Property from | Result |
|---|---|---|
| reservations → inventory: consume, hold, convert, release, change, assign, unassign, getUnit, availability | the booking or stay record (every call site in `bookings.ts`, `changes.ts`, `workflows.ts`, `channel.ts`, `issues.ts`) | Held: `requireType(…, propertyId)`, `verify`/`verifyRef`, `scope_mismatch` (bindings and provider-port tests). |
| Overbooking | reservations checks `reservations.booking.overbook` (`bookings.ts:613`, `changes.ts:389`, re-checked at commit by `buildPlan`), and inventory delegates `inventory.overbooking.authorize` only when the argument is present | Held. The explicit key is reservations', not inventory's (note for the ADR §5 wording). |
| House use, lock override | not delegated (`blocks.ts:223`, `assignments.ts:181/393`) | Held. |
| operations → inventory blockUnit/releaseBlock | the work order's property | Held. A unit of another property falls back to the user's own `inventory.block.manage`. |
| reservations → payments getPaymentStatus | the record | Held, but see P2-1 (delegated reads feed redacted views). |
| reservations → payments authorize | the record | **Widened**: P1-2. |
| payments (HTTP) → finance deposit | the request (`propertyId`) | **Unverified booking**: P1-1. |
| finance (HTTP and reservations) → payments createPaymentRequest | the charge's property; folio checked by `assertLedgerTarget` | Held for scope; **amount wrong**: P1-3. |
| finance → rates computeTaxesDetailed | the posting | No permission or scope issue. Rates honours agreed versions only for commercial rules (`tax-engine.ts:219`). |
| New platform routes | the path `:id` | Held: `getProperty`/`listDataAuthority` require `platform.property.read` at the id; the policy route checks explicitly; preview requires org-wide `platform.policy.manage`; other tenant → 404 (`ux-wiring.test.ts`). |
| Kernel `delegateAtProperty` | n/a | Sound: unscoped checks are never delegated; `propertyScope` adds exactly one property; the input context is not mutated (`context.test.ts`). |

Guests and API clients: guest-facing routes do not exist yet. API clients use `staticAuthorizer` grants and are
subject to the same paths as staff, so P1-2 applies to an API client holding `reservations.stay.checkIn`.

## 4. Money across bindings

- **Deposit `valueOnly`:** correct. `prepaymentTaxes` already filtered to `kind === 'tax' && statutory && valueBased`
  (`finance/src/service/deposits.ts:146-148`). `valueOnly` only stops the engine from *refusing* deposits when a
  per-person rule is in force (`tax-engine.ts:232`), so the tax declared on deposits is unchanged.
  - Green Tax is not levied on the deposit and stays due per guest-night with the room postings. Those postings do not
    exist yet: Day Close is wave 2, and S04 posts a room night manually with occupancy.
  - So there is no double levy. Green Tax stays "missing" in the end-to-end flow until Day Close, which the S04 todo
    records honestly.
- **Payment → ledger:** deterministic keys (`payments:payment:{id}`, `payments:refund:{id}`), a savepoint, a failed
  status with backoff, and finance's `claimEntry` unique per key. S05 and S06 show one provider operation and one
  posting, and the consistency check finds no duplicate journal keys. The refund retry in S06 is sequential, which is
  appropriate for the claim. S01's E01 is genuinely concurrent: 20 parallel commits, exactly 3 bookings, no oversell.
- **Collection requests:** they record intent only (a payment request, `open`, link after commit through the payments
  registry with `assertExternalEffectAllowed`), and nothing is charged. The amount is wrong (P1-3).
- **Legal-entity scoping on postings:** held for folios. Not held for a booking's first deposit (P1-1).

## 5. Rates adapter

- **Sealed terms stored and passed back unchanged:** true. `bindings.test.ts` verifies the seal on stored and
  superseding snapshots.
- **Can an altered TermsSnapshot get past `priceChange`?** No (`terms_seal_invalid`).
- **Past `evaluateCancellationPenalty` or `instantiatePaymentSchedule`?** Yes (P2-3).
- **Fingerprint change:** `commitChange` re-plans at commit and compares `fingerprintOf(view)`, which includes totals,
  taxes, penalties, deposits and per-stay agreed-terms digests. A price change after the preview therefore still makes
  the commit stale. The only blind spots are the lossy view fields in P3-1.

## 6. Data authority and environment safety on new paths

- **Charges external:** the finance port refuses (`openFolio`, `applyDeposits`).
- **Payments external:** the payments port refuses (`authorize`, `createPaymentRequest`, `createMethod`). The late-charge
  request becomes `not_possible`.
- **Rates external:** quote and booking are refused.
- **Guest profiles external:** booking creation is refused.

All of these are in `bindings.test.ts`. Connected-mode check-in dead-ends (P3-9).

Environment safety: the new paths add no direct external effect. Card holds and payment links go through the payments
registry, and access keys through `environmentAccessAdapter`. Every PoC ran in a `demo` organization and was labelled
"simulated".

## 7. Scenario claims

| Scenario | Verdict |
|---|---|
| S01 | Proven, with genuine concurrency (`Promise.allSettled`, separate transactions); the "nothing posted" claim is unasserted (P3-8). |
| S03 | Proven for what it tests; 2 todos. |
| S04 | **Overclaims** child-age and Green Tax pricing (P2-4); routing as previewed is proven. |
| S05 | Proven: pending verification, one provider operation, an authorization never posts. The "second attempt" goes through the port (P3-8). |
| S06 | Proven: one refund, one ledger posting, duplicate webhooks harmless. |
| S07 | Proven (failed inspection blocks the unit step). |
| S08 | Proven (engineer without inventory keys blocks through the port; return to service gated by inspection). |
| S13 | Proven at server level; the offline UI is todo. |
| S14 | Proven as a stale If-Match write (sequential, which is valid for optimistic concurrency). |
| S15, S16, S17 | Proven. S17 checks HTTP 404s and RLS. |

`assertGlobalConsistency` runs at the end of every non-todo scenario (12/12 files) and checks real data:
- INV-I02 (ledger = Σ consumption + holds) and INV-I03 (no oversold cell without an open conflict);
- RES-I02 (active stays consume exactly their nights; cancelled stays hold nothing);
- FIN-I02/I14 per legal entity (trial balance zero; control accounts = Σ sub-ledgers);
- duplicate journal keys and payments `attempts > 1`;
- required audit actions.

Two caveats:
- The duplicate-journal-key check is tautological if a unique constraint already exists.
- The checks would **not** catch P1-1 (the deposit sits in a balanced ledger at the wrong entity) or P1-3 (a payment
  request is not a posting). Consider a cross-module check: every `finance.deposit_accounts.booking_id` belongs to a
  reservations booking of the same property.

## 8. Cross-module notes for the orchestrator

- **Booking ownership** is the one fact several modules need and only reservations owns: payments, finance, and later
  distribution and day-close. A `describeBooking` port (P1-1) is a shared need, not a payments patch.
- **Delegation helpers:** finance's `delegated()` and the kernel's `delegateAtProperty()` are two implementations of
  the same idea with **different defaults** (`undefined` means all properties in finance; there is no such mode in the
  kernel). Converge on the kernel helper (P2-2).
- **"Explicit capability" in ADR-0015 §5** should name *which* module's key is checked. Today overbooking is
  reservations' key while inventory's key is delegated, and card choice and amount at check-in have no key at all
  (P1-2).
- **Pending-fixes:** the reference to a rates entry in OPEN_QUESTIONS is dangling (P2-6).

## 9. PoC files (`docs/orchestration/reviews/integration-step-poc/`)

Copy each to `apps/api/test/<name>.test.ts`. Each imports `./scenarios/harness`, and each currently **passes**
because it asserts the buggy behaviour; flip the marked `BUG` assertions once fixed.

| File | Proves |
|---|---|
| `poc-deposit-wrong-property.test.ts.txt` | P1-1, P2-7 |
| `poc-checkin-any-card.test.ts.txt` | P1-2 |
| `poc-late-charge-overcollect.test.ts.txt` | P1-3 |
| `poc-fd15-money-leak.test.ts.txt` | P2-1 |
| `poc-finance-unscoped-delegation.test.ts.txt` | P2-2 |
| `poc-rates-adapter.test.ts.txt` | P2-3 |
| `poc-connected-checkin.test.ts.txt` | P3-9 |
