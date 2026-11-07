# Agent run: Steward review: payments module

- Started: 2026-11-07T11:13:22.687Z · last activity: 2026-11-07T11:32:42.668Z
- Turns: 134 · tool uses: 137 · output tokens: 109,287
- Type: general-purpose

## Brief (2026-11-07T11:13:22.687Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/payments-core` in worktree /home/user/wt/payments — module `payments` (spec: /home/user/portico/docs/specs/payments.md on main; ADR-0007; docs/readiness/responsibility-matrix.md incl. "Route D"). Author's README: modules/payments/README.md (contract changes, open questions), FOUNDATION_REQUESTS.md, and a parity file at modules/payments/PARITY.md (run `node tools/parity-report.mjs` against a copy placed in docs/parity/ of your own scratch copy to check the gate). Focus extra care on: (a) money-safety invariants — authorization ≠ payment, refunds never exceed collected and never duplicate under retries/concurrency (try to break it with concurrent refund attempts in a scratch copy), pending_verification resolved only by provider lookup/webhook, at-most-once provider sends via the operation journal; (b) PCI boundary — no path stores raw card data, logs never include tokens; (c) environment safety — demo/trial/training can never reach Stripe; (d) Route D recorded payments clearly distinguished from provider-verified ones and reconciled by statement import; (e) the LedgerPort contract vs the finance branch in /home/user/wt/finance (provider functions there) — list mismatches precisely.
Do not modify the worktree; copy it to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-payments-copy for experiments. Use PORTICO_TEST_DB_PREFIX=review_payments. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-payments.md.
````

## Report (2026-11-07T11:32:42.560Z)

````text
**Verdict: merge after fixes.** Blocking: P0-1 to P0-3 and P1-1 to P1-11, then a re-review. Counts: **P0 3 · P1 12 · P2 14 · P3 10**.

Full report: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-payments.md

**Command results** (run in a clone, worktree untouched, PORTICO_TEST_DB_PREFIX=review_payments):
- lint, typecheck (uncached), install: pass.
- payments tests: 96 pass. api tests: 17 pass.
- Merges cleanly with main.
- Parity gate: passes with PARITY.md copied to docs/parity/payments.md. Several rows overclaim (P2-13).

**Experiments and finance cross-check:**
- I wrote `modules/payments/test/zz-steward.test.ts` and `modules/payments/test/zz-finance-binding.test.ts` in the clone at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-payments-copy. Logs: /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/payments-exp.log and /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/payments-fin.log.
- The finance cross-check used finance's committed HEAD `4b657a5`, which landed during this review. The finance worktree also has uncommitted edits, which I did not review.

**Top 5 findings:**
1. **P0-1, cross-property posting.** Payments checks the caller's `propertyId` but never checks that the folio or booking belongs to it, and finance's delegated permissions are unscoped. With real finance, a desk user scoped to property A recorded USD 777 onto a folio at property B, owned by another legal entity, and it posted. This is live on Route D.
2. **P0-2, Stripe connected accounts can be claimed by any organization.** The account uniqueness is per tenant only, and `route_webhook` returned 2 rows; the code takes `rows[0]`. The tenant admin can also set `status: active` and an application fee of up to 10% themselves. Not exploitable until Stripe keys exist, but it must be fixed before any key is configured.
3. **P0-3, webhook events can be lost for good.** The dedupe row commits before processing, so any failure afterwards makes every redelivery answer "duplicate". In the experiment a dispute was never recorded. Disputes and payouts have no backstop because the PAY-R16 balance sweep isn't built.
4. **P1-1, P1-2, P1-3, P1-4, money-safety races and limits.**
   - Two concurrent charges on one folio both succeed (2 postings).
   - A paid deposit link plus a desk charge collect the same deposit twice.
   - The duplicate approval-code check isn't backed by a unique constraint (2 postings when recorded concurrently).
   - Refunds ignore negative adjustments, in both payments and finance: a 200.00 refund was accepted on a payment adjusted down to 50.00.
   - Concurrent refunds with different keys are safe: 3 of 6 succeeded, total 900.00 of 1,000.00.
5. **P1-5, P1-6, P1-10, contract mismatches.**
   - Finance: `recordDeposit` doesn't pass `propertyId`, so every first booking deposit (and then its refund) fails to post with real finance.
   - Finance: Route D statement verification never reaches finance, so folios show "awaiting verification" forever.
   - Reservations: its `getPaymentStatus`, `authorize` and `createPaymentRequest` don't match payments' shapes. Payments' authorize starts as `processing` and settles after commit, so the check-in guarantee step's status check fails and it could authorize again.

**Other P1s:**
- P1-7: bank transfers are posted at record time, with no "awaiting receipt" state (spec PAY-R23).
- P1-8: staff can charge a card saved without the guest's agreement to later charges just by sending `initiator: 'customer'`.
- P1-9: the settlement import has no fee columns. Net statements produce amount mismatches whose recovery text says to adjust the guest's payment.
- P1-11: the operation's recorded mode isn't re-checked at execution, so a simulated intent could go to live Stripe after a trial-to-live switch.
- P1-12: missing spec MUSTs. The README declares them honestly: hosted card entry, collection plans, provider balance reconciliation, evidence pack, approval threshold, link delivery via comms.

**What held up:**
- Each provider call is sent at most once (racing executors send once).
- Pending verification is resolved only by provider lookup or webhook, never by re-sending.
- Demo, trial and training never reach Stripe, even with keys present.
- No database column can hold a card number; tokens stay out of audit and logs. The card-number check doesn't cover free-text fields (P2-6).
- Readiness levels are honest: Stripe is R1 as an integration.

**For finance at merge:**
- Bind `financeLedgerForPayments(finance)`. `financeProvider(finance,'payments')` lacks `recordPaymentAdjustment` and `recordDisputeMovement`.
- Payments never passes `provider`, so all acquirers land in one card clearing account.
- Finance's `PaymentsPort.requestCollection` has no payments provider.

**Shared-code candidates:** a savepoint helper (payments, finance, guests, inventory, operations); `unavailablePort` (api composition, reservations, finance); owned and deduped exception queues (payments, integration, finance).

**Terminology drift:** payer types are `guest_profile|other` in payments vs `profile|house` in reservations vs `guest` in finance.
````

