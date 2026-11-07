# Agent run: Steward review: reservations module

- Started: 2026-11-07T11:19:20.140Z · last activity: 2026-11-07T11:38:54.448Z
- Turns: 301 · tool uses: 179 · output tokens: 251,546
- Type: general-purpose

## Brief (2026-11-07T11:19:20.140Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/reservations-core` in worktree /home/user/wt/reservations — module `reservations` (bookings, stays, change preview/commit, check-in/out, front desk, channel ingestion; spec: /home/user/portico/docs/specs/reservations.md on main). Author's README: modules/reservations/README.md (contract changes, not-built list). The author may still be committing a small Green Tax-on-complimentary-stays fix; review the latest HEAD when you start and note the commit you reviewed.
This is the most cross-cutting module, built against FAKES of inventory, rates, guests, finance, payments, operations and access. Your most valuable output: a precise PORT-vs-PROVIDER compatibility table comparing reservations' src/ports.ts (and its fakes' semantics) with the real providers in the other worktrees — inventory (/home/user/wt/inventory/modules/inventory), rates (/home/user/wt/rates/modules/rates), guests (/home/user/wt/guests/modules/guests), finance (/home/user/wt/finance/modules/finance — may still be in progress), payments (/home/user/wt/payments/modules/payments), operations (/home/user/wt/operations/modules/operations): every function name, argument shape, return shape, error code (e.g. inventory_unavailable, unit_assignment_conflict), event name and payload, and semantic difference (e.g. does the fake inventory enforce composites the way the real one does?). Mark each: compatible / adapter needed (give the adapter) / incompatible (who must change).
Also review with extra care: (a) change-preview token integrity (can a stale preview be committed? try in a scratch copy); (b) resumable check-in never double-authorizes or double-issues keys; (c) channel ingestion ordering/duplicates/stale revisions; (d) data-authority forward mode; (e) separation of the status families. Parity file: /home/user/wt/parity-front/docs/parity/reservations.md if it exists by then.
Do not modify the worktree; experiment in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations-copy. Use PORTICO_TEST_DB_PREFIX=review_reservations. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations.md.
````

## Report (2026-11-07T11:38:54.240Z)

````text
**Verdict: merge after fixes.** I reviewed `feat/reservations-core` at commit **`567dffe`** (the Green Tax fix landed during the review, so I re-ran everything on it). The full report, including the port-vs-provider compatibility table, is at `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-reservations.md`.

**Commands** (on a copy of the branch): lint, typecheck, module tests (130) and API tests (13) all pass. The parity gate fails. The branch has no parity file, and the parity-front file was written before the code (100 P0 rows untested, 30 P1 missing).

**Findings:** P0: 1 · P1: 16 · P2: 12 · P3: 6. I reproduced 11 of them with experiment tests in the scratch copy only; the worktree is unchanged.

**Top 5:**
1. **P0, R-01:** a channel price that differs from Portico's quote by even 1 cent drops every tax, including TGST and Green Tax, from the agreed terms and from the nightly feed Day Close posts from. Reproduced: gross 75 000 at the quoted price, 60 002 at +1 cent with taxes and fees at 0 (`service/channel.ts:107`).
2. **P1, R-02/R-03:** reservations' agreed-terms, offer and repricing shapes don't match rates' real ones. Reservations also rewrites rates' hashed terms for complimentary and channel stays, so with real rates:
   - repricing throws `terms_hash_mismatch` on those stays;
   - finance's posting plan would charge a complimentary stay at full price;
   - penalties ignore rates' default gross basis and are under-charged by the tax.
3. **P1, R-04:** a stale preview can be committed. After the rate plan became non-refundable, the old free-cancellation preview still committed and stored non-refundable terms. The spec requires the token to bind the rates configuration; it doesn't.
4. **P1, R-05/R-06:** channel ordering and unhandled states.
   - A cancellation that arrives before its booking leaves a live confirmed booking.
   - A cancellation for an in-house stay, or a booking for past dates, throws, so ingestion retries forever and no issue is raised.
5. **P1, R-07/R-08/R-09:** data authority and external effects.
   - In read-only mode, `patchStay`, `assignUnit` and the check-in unit step still write locally.
   - Check-in authorizes the card and issues keys before the authority check fails at confirm.
   - In forward mode, repeated confirms create duplicate forwarded changes.
   - Key operations run inside the database transaction, so a rollback leaves real keys changed.

**Other providers, checked against their worktrees:**
- **Payments (R-11):** real `authorize` calls the provider after commit and returns a nested status, so the guarantee step crashes. The fake decides synchronously, so the "never authorizes twice" test doesn't prove the real flow.
- **Operations (R-12):** reservations' new booking event payload fails operations' schema, confirmed by running its parser (`earlyCheckIn: null`, `eta` as HH:MM). Booking events would dead-letter.
- **Inventory (R-13):** real `explainAvailability` has no `consumers`/`consumedAt`, so the stale-preview path returns 500 instead of 409. Unit and candidate shapes need small adapters.
- **Permissions (R-14):** real providers check the caller's own inventory, payments, rates and guests permissions. With main's role templates, `reservations_agent` gets 403 on `getBooking` (no payments permission) and on extension previews; the fakes never check.
- **Finance (R-10):** reservations' five penalty and fee charge codes don't exist in finance. Late-checkout and early-check-in fees post with a future service date, which finance refuses.
- **Guests:** compatible.

**For the orchestrator:**
- Move finance's provider-delegation helper into a shared package, scoped to the property (finance's version widens to all properties), and use it in every provider.
- Make rates' terms the single canonical contract, with rates owning penalty, deposit and complimentary/channel-price logic.
- Have every producer export event payload schemas, so producer and consumer can't drift again.
- Nobody consumes `reservations.booking.cancelled` for deposit treatment, and nobody charges no-shows by merchant-initiated payment.
- Make the fakes strict and re-run S01–S04 and the check-in resume test against the real providers before binding them.

Fix R-01 and R-04 to R-09 before merging. The other R-10 to R-14 contract fixes must land before any real provider is bound. The parity file must be updated with tested rows before the module counts as complete.
````

