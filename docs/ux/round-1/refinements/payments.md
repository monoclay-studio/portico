# Round 1 refinements — Payments

Scope: taking and recording payments wherever money is due, pending verification, and the finance view of payments.
Personas P1 (guesthouse owner collecting cash, card or bank transfer on a phone), P2 (desk), P6 (finance). Citation
keys, categories and the power-check rule are defined at the top of `front-desk.md`. Outcomes are **TARGETS** until
validated with hotel staff.

Payments is on main with authorizations, charges, captures, recorded cash/bank transfers, status checks, requests,
disputes, payouts, exceptions, reconciliation and server-computed `statusPresentation` (`modules/payments/README.md`).
The tester's praise for honest payment language (B3: "Pending verification — do not charge again", "Authorized (not
paid)") must survive wiring.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| PAY-01 | One Collect panel wherever money is due | (a) | payments | blocker |
| PAY-02 | "Pending verification" always comes with Check now and a promise | (c) | payments | major |
| PAY-03 | Record cash or a bank transfer in three taps on a phone | (a) | payments | blocker |
| PAY-04 | A Payments page for finance: unresolved first, evidence to resolve | (a) | payments | major |

Related: SR P1-2 (uncertain network outcomes must read as *pending verification*, not "nothing was sent") and SR P1-3
(render `statusPresentation`, reconcile the payment vocabulary) are already in the backoffice fix round and are
prerequisites for PAY-01/02.

---

### PAY-01 · One Collect panel wherever money is due

**Category** (a) — `/payments/authorizations`, `/payments/charges`, `/payments/recorded`, `/payments/requests`,
`/payments/methods`, `statusPresentation`; finance `/finance/folios/:id/payments` · **Owner** payments (+ finance) ·
**Priority** blocker
**Evidence** P1 › Payment — **No**: "There is no 'Take payment' or 'Record cash / bank transfer' anywhere"; P2 ›
Checkout; T2 · `[screens/p1-16-ahmed.jpg]` `[screens/p1-18-mywork-full.jpg]`

**Proposed change.** One shared component (payments spec §9 "Collect panel") used in: the check-in guarantee step
(FD-01), check-out settle (FD-07), walk-in (FD-09), booking deposit (RSV-01) and a bill's **Settle** (FIN-02).
- **Suggested action first**, from the collection plan: "Deposit 30 % due today — USD 1,260.00" or "Balance USD 191.79".
- **Methods** offered only when the property's payment account supports them: Card on file · Card terminal · Payment
  link (sending needs comms — until then "Copy link") · Cash · Bank transfer · Company / agency account.
- **Amount** defaults to the suggestion; a different amount asks for a reason (partial payments are allowed).
- **Outcome** shown with the server's `statusPresentation` label, tone and explanation: *Authorized (not paid)* ·
  *Paid* · *Pending verification* [Check now] · *Failed* + the server's recovery text ("Declined by the card's bank.
  Ask for another card or take cash.").
- **Demo/sandbox**: "Simulated — no card was charged" (CLAUDE.md §12) on every result.
- **One intent per collection**: the panel keeps one idempotency key; a second press while pending shows the pending
  state — it never sends a second charge.

**Expected outcome (targets).** Take a card or cash payment in ≤ 20 s; 0 duplicate charges in scenario tests and
round-2 tasks. Baseline: not possible.

**Power check.** Authorization increments, capture, void and refunds stay available as actions on the payment record
for experts; the panel is the default path, not the only one.

---

### PAY-02 · "Pending verification" always comes with Check now and a promise

**Category** (c) · **Owner** payments (+ packages/ui status pattern) · **Priority** major
**Evidence** P1 › Payment: "The blocker says 'pending verification — check status; do not charge again'. There is no
**Check status** button and no link to the payment"; B3 · `[screens/p1-16-ahmed.jpg]`

**Proposed change.**
- Every *Pending verification* chip opens (click/focus) an inline explanation:
  "We asked the card provider at 07:31 and have no final answer yet. **Don't charge again.** [Check now] · Portico
  re-checks automatically and will notify the owner of this stay."
- **Check now** calls `POST /payments/transactions/:id/check` and replaces the line with the result: "Still pending —
  checked 07:42" / "Paid — confirmed by the provider 07:42" / "Failed — what to do".
- **Open payment** links to the transaction record (attempts, provider reference, history).
- Rule for every module (summary C7): a message that asks staff to verify something carries the button that verifies
  it.

**Expected outcome (targets).** Resolve a pending verification from the record in ≤ 10 s when the provider has an
answer; 0 duplicate charge attempts in round 2.

**Power check.** Reconciliation is unchanged; no manual "mark as paid" is offered here (that needs evidence, PAY-04).

---

### PAY-03 · Record cash or a bank transfer in three taps on a phone

**Category** (a) — `POST /payments/recorded`, `/payments/transactions/:id/confirm-receipt`; finance bill payments ·
**Owner** payments (+ finance) · **Priority** blocker (guesthouse owner)
**Evidence** P1 › Take or record a payment — **No** (~6 taps, 3 screens); persona ask "takes cash, card or bank transfer
and prints or WhatsApps a receipt"

**Proposed change.**
- On a stay or bill on a phone: a sticky bottom bar **"Balance USD 191.79 · Record payment"** (thumb zone, ux §12).
- Sheet: amount (prefilled), method chips **Cash · Bank transfer · Card terminal**, reference (required for bank
  transfers), **Save**.
- A bank transfer shows as **Recorded (unverified)** until it is confirmed against the statement (confirm-receipt with
  the bank reference) — never "Paid" before that.
- **Receipt**: Download PDF or **Share** through the phone's share sheet (WhatsApp, email) — no Portico messaging needed;
  sending from Portico arrives with comms (b).

**Expected outcome (targets).** Record cash in 3 taps (+ amount check) and ≤ 15 s.

**Power check.** The verification state is preserved; bank transfers still require reconciliation.

---

### PAY-04 · A Payments page for finance: unresolved first, evidence to resolve

**Category** (a) — `/payments/exceptions` (+ resolve), `/payments/status`, `/payments/reconciliation/run`,
`/payments/disputes` (+ evidence), `/payments/payouts`, `/payments/statements`, `/payments/accounts/:id/health` ·
**Owner** payments · **Priority** major
**Evidence** P6: "'Payments pending verification: 2 · $6,546.36' opens *My work*, which lists 14 items … **none are
payments**"; persona ask "a pending-verification queue showing provider status and a 'Mark verified/failed'
reconciliation" · `[screens/p6-02-payments-mywork.jpg]`

**Proposed change.** **Finance › Payments**:
- **Unresolved**: pending verification (age, provider status, last check), failed automations, disputes with an
  evidence **deadline countdown**, recorded bank transfers awaiting the statement. Actions: **Check now** ·
  **Resolve…** (requires provider evidence or a bank reference; permission-gated; recorded in the audit) · **Submit
  evidence**.
- **Payouts**: each with reconciliation state (matched / differences), gross, fees, net.
- **Provider health** per account: Healthy · Delayed · Failing, with "since".
- The Today tile "Payments pending verification" opens this list filtered, and its count and total equal the tile
  (NAV-07).

**Expected outcome (targets).** Tile and list always agree (baseline: 2 vs 0 payment items); resolving with evidence
takes ≤ 1 min.

**Power check.** There is **no** "mark verified" without evidence — reconciliation is strengthened, never skipped
(CLAUDE.md §5, adoption brief §14).
