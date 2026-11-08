# ADR-0015: Authorization and integrity across module ports

**Status:** Accepted · **Date:** 2026-11-07

## Context

Reviews found both failure modes of cross-module calls:
- *Too loose:* finance's delegated functions were unscoped, so a desk user at property A recorded a payment onto a
  folio at property B (payments review P0-1).
- *Too strict:* operations asked inventory to block a unit for a work order; inventory re-checked
  `inventory.block.manage`, which the engineer (holding every operations permission) lacked, and the whole command
  rolled back (operations review P1).

## Decision

1. **The entry module authorizes the user's intent.** The module whose HTTP route / command the user invoked checks
   the user's permission *and property scope* for the whole business action (e.g. `operations.maintenance.manage`
   at property P).
2. **Port calls carry the authorized scope.** Every provider function called through a port receives the
   `propertyId` (and legal entity where relevant) that the caller authorized.
3. **Providers enforce integrity, not the caller's permission keys.** A provider invoked through a port does not
   re-check *its own* permission keys for that user, but it MUST verify that every referenced record belongs to the
   given property/legal entity (and tenant, via RLS), enforce its invariants, and enforce **data authority** for the
   domains it owns. Violations throw — they are never silently accepted.
4. **Provider HTTP routes keep their own permissions.** Direct calls to a provider's routes check that provider's
   permission keys as usual.
5. **Sensitive cross-module effects are explicit.** The explicit capability names the module whose key is checked
   (e.g. `payments.payment.collect`). Choosing the payment method, amount or account is explicit unless it is bound to
   the agreed guarantee (integration-step review P1-2). Where a port call performs something the entry permission should
   not imply (e.g. refunds, overbooking), the provider requires an explicit capability argument whose presence the
   entry module checked (e.g. `overbooking: { authorizedBy }` after `inventory.overbooking.authorize`).
6. **Composite failures do not lose user work.** When a port call refuses (e.g. unit already blocked, external system
   of record), the entry module records its own record (e.g. the work order) with the refusal reason and next step
   instead of rolling everything back — use `withSavepoint` around the port call.

## Consequences

Ports are exercised with real providers in integration tests; each provider adds tests that a call with a mismatched
property/legal entity is refused. Implemented per module during the integration step (`docs/orchestration/pending-fixes.md`).

## Amendment 1 — what makes a card the agreed guarantee (2026-11-07, integration-step re-review R2-P1-1)

Staff linking a person to a booking (as booker, occupant or payer) never grants the right to use that person's
saved card. A card counts as a booking's agreed guarantee only if one of these holds:
- **(a)** the cardholder supplied it for this booking, through hosted entry, a payment link, a terminal, or the
  guest's own self-service;
- **(b)** a recorded mandate covers it: card-on-file consent with its scope (which hotel or legal entity, which
  purposes, which amount limits), stored with evidence.

Any other use of a saved card, or a different amount, is an explicit capability: the entry module checks
`payments.payment.collect`, and the payments provider still verifies the card's property and legal entity (fix
sweep SW-PAY-3). Whether the guest is present or the merchant initiates a charge is derived from server facts, never
from a client field (SW-PAY-4).

## Amendment 2 — staff permission never exceeds cardholder consent (2026-11-07, integration-step re-review #3)

Amendment 1 said "any other use of a saved card, or a different amount, is an explicit capability", which mixed
**staff permission** with **cardholder consent**. They are separate, and both are required:
- **Cardholder consent** (the mandate, or the card supplied for this booking) defines *what may be charged*: purposes,
  amount cap, the bookings or folios covered, and validity. It is enforced on **every** money movement: charge,
  authorize, increase a hold, capture beyond the authorized amount, and payment-request amounts drawn on that card.
- **Staff permission** (`payments.payment.collect` at the card's property and legal entity) defines *who may initiate*
  within that consent.
- Anything beyond the consent, such as a higher amount, another purpose or another booking, needs **new cardholder
  consent**, for example a payment link or the terminal. No staff permission can stand in for it.

**Payment requests are externally visible and have external writers.** A request (link) can be paid at the provider
until the provider confirms it is deactivated. Replacing, amending or cancelling a request therefore deactivates it at
the provider first. Until that is confirmed, the old link counts as possibly payable, and any resulting
over-collection is detected and resolved as an urgent refund exception, never left as routine.


## Amendment 3 — a general card-on-file agreement names its bookings (2026-11-07, integration-step re-review #4)

Re-review #4 (R4-P1-1) showed that "the cardholder's own bookings" is not a cardholder fact: staff decide who is named
on a booking. A desk agent named a guest as booker on someone else's booking (or added a stay that put her on it) and
her saved card then paid for it. Consent cannot depend on data that staff can edit. Therefore:
- A card-on-file agreement covers **only the bookings and folios it names** (recorded when the cardholder gave
  consent, with evidence), plus the purposes and limits it states. No agreement covers "any booking where this person
  appears", and no relationship that staff can create (booker, occupant, payer, profile merge) extends one.
- Anything else needs new cardholder consent for that booking: a payment link, the terminal, hosted entry or the
  guest's own self-service.
- A future-stays mandate (for example a corporate or repeat guest who wants phone bookings charged to a saved card) is
  an explicit scope that the cardholder grants and that names a payer account the cardholder controls, never staff
  data. Whether to offer it in the first release is Q160; the default is not to offer it.
- **Limits hold under concurrency.** The running total against an agreement's amount limit is read and written under a
  lock on the saved card (or the agreement), on charge, authorization, hold increase and capture (R4-P1-2). Holds
  count against the limit while they are open.
- Lock order across modules stays: the shared collection lock, then the folio, then the payment request; modules
  that touch deposits take the shared lock first (R4-P3-2).

## Amendment 4 — consent is checked where money lands, and purposes are facts (2026-11-07, integration-step re-review #5)

Four reviews in a row found the same class of defect one step beyond the previous fix. A staff-editable input reached
the consent check as if it were a cardholder fact:
- the booker, then the payer directory (R3, R4);
- the purpose label `no_show` (R5-P1-1);
- a booking-level reference with no stay, later re-allocated to a stay added after consent (R5-P1-2).

From now on the rule is about the class, not the path:
1. **Every input to a consent decision is either a cardholder fact or a server fact, never a client label.**
   - A purpose is derived from the record that justifies it: a no-show or cancellation penalty that reservations
     recorded, capped at what it still owes; a deposit due under the booking's deposit schedule; a balance on a named
     folio.
   - Evidence time and channel are set by the server.
   - Ownership is judged on stable identities, never on fields that a merge rewrites.
2. **Coverage is checked where money lands, not only where it is taken.** Card-funded money that is moved or applied
   to a folio, stay or booking keeps its agreement's coverage. This includes deposit application, folio transfer,
   routing and split. If the destination is not covered, the move is refused, or held for new cardholder consent.
   Reverse order (move first, then charge) is closed by the same check.
3. **Staff-recorded agreements carry an amount limit.** `maxAmount` is required when an agreement is recorded by staff
   (terminal, phone, paper form). Then any residual widening is bounded by what the cardholder agreed to. An agreement
   the cardholder captures in self-service may be uncapped only if the cardholder chose it explicitly. (Default,
   reversible; see Q160.)
4. **Staff cannot clear money-risk states that finance owns.** A payment request the provider reported as already paid
   (`completed`) is never "confirmed stopped" by staff. Only a finance role may confirm a deactivating link, only
   while its exception is open, and only with `If-Match`.

## Amendment 5 — the purpose is judged where money lands, and every posting has an owner (2026-11-08, integration-step re-review #6)

Re-review #6 found two more siblings of the Amendment 4 class:
- a capture was checked as `guarantee` but landed on a folio as `balance` (R6-P1-1);
- a refund posting counted as neither money nor debt in finance's provenance, so it could be moved onto a covered
  folio and then charged (R6-P1-2).

The rules, stated so they close the class:
1. **Consent is judged on the purpose of the money where it lands.** This covers every operation that turns card
   authority into money on a ledger reference: charge, capture, increment, recorded payment, link payment, deposit
   application and forfeit. The fact limits (deposit schedule, folio balance, penalty owed) apply at that point, under
   the collection lock, whatever the operation was called when it started. A hold's stated purpose never carries
   through to its capture.
2. **Every non-zero posting is someone's money or someone's debt.** Finance's provenance never returns `none` for a
   posting with an amount. Refunds, reversals, corrections, allowances, forfeits and receivables transfers each have a
   defined owner and direction, and the coverage checks run for each.
3. **A no-show fee rests on the penalty as it stands on the ledger**: posted minus credited, minus what was already
   collected. It never rests on the penalty record alone.

## Amendment 6 — every obligation is one balance, and the invariant is tested generatively (2026-11-08, integration-step re-review #7)

Re-review #7 found two more siblings:
- a card-funded deposit could be forfeited for a penalty that was then also charged to the card (R7-P1-1);
- when a credit moved off a folio, the debit it left behind had no owner, so another guest's card could pay it
  (R7-P1-2).

Seven review rounds have now closed named paths and stated rules, and each time a sibling remained. Two changes end
that pattern.
1. **One balance per obligation.**
   - Every amount someone owes is a single finance-owned balance with an owner: each deposit due, each penalty
     (no-show, cancellation), and each folio balance.
   - Every way of settling it draws that same balance down, under one lock: card charge or capture, cash, cheque,
     terminal, link, forfeit of a deposit, transfer, credit or write-off.
   - No collection is limited by a record of what was due. It is limited by what is still owed on the ledger, net of
     everything already applied by any method.
   - Moving money or debt between folios moves the obligation and its owner. The debit a credit leaves behind belongs
     to whoever the credit now benefits.
2. **The invariant is tested generatively, not by enumeration.** A seeded, model-based test runs random sequences of
   every money operation, across at least two guests, two folios and two cards with agreements, including
   concurrency. It asserts after every step:
   - no card ever pays more than the obligations its agreement covers;
   - no obligation is collected more than once across all methods;
   - the ledger balances.

   A failing seed is kept as a regression test. Reviewers then check the generator's coverage of operations instead
   of hunting siblings by hand.
