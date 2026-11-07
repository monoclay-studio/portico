# Agent run: Steward review: rates module

- Started: 2026-11-07T08:24:34.709Z · last activity: 2026-11-07T11:23:55.287Z
- Turns: 129 · tool uses: 73 · output tokens: 182,110
- Type: general-purpose

## Brief (2026-11-07T08:24:34.709Z)

````text
You are Portico's architecture steward. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md exactly.
Branch under review: `feat/rates-core` in worktree /home/user/wt/rates — module `rates` (spec: /home/user/portico/docs/specs/rates.md on main). Author's README: modules/rates/README.md (incl. contract changes and open questions). Focus extra care on: (a) the tax & fee engine vs /home/user/portico/docs/readiness/maldives-tax-rules.md (time of supply, Green Tax per-person-day with under-2 exemption and 12-hour check-out rule, GST not on Green Tax, service charge inside the GST base, USD reporting, inclusive/exclusive rounding); (b) TermsSnapshot immutability and whether it is truly sufficient to post every night later; (c) derived-rate semantics (amount adjustments per room-night only — judge whether this matches market practice in OPERA/Mews/Cloudbeds and the spec) and cycle prevention under concurrency; (d) money rounding consistency. Parity file: /home/user/wt/parity-front/docs/parity/rates.md if present, else list capabilities you know OPERA Cloud / Mews / Cloudbeds rate management has that are missing.
Use PORTICO_TEST_DB_PREFIX=review_rates. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-rates.md.
````

## Follow-up message (2026-11-07T11:13:07.943Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue the rates review exactly where you stopped and finish the report as originally specified. Postgres was restarted and is up.

Address this before completing your current task.
````

## Report (2026-11-07T11:23:55.145Z)

````text
**Verdict: merge after fixes.** The rates code is strong (well-separated pure domain, row-level security on every table, isolation proven, genuinely concurrent tests). It still can't merge as is: one money bug, a provider contract that doesn't match what reservations and finance call, and a failing parity gate.

**Counts:** P0 = 1, P1 = 10, P2 = 18, P3 = 7. The full report is at `/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-rates.md`.

**Commands** (worktree `/home/user/wt/rates`, `PORTICO_TEST_DB_PREFIX=review_rates`):
- `pnpm install`, `pnpm lint`, `pnpm typecheck` all pass. Typecheck came from the turbo cache, so I re-ran `tsc` uncached for rates and the API; still clean.
- rates tests: 105/105 pass. API tests: 13/13 pass.
- The branch merges cleanly into main (`git merge-tree`); it is 4 commits behind.
- **Parity gate fails:** `node tools/parity-report.mjs --gate rates` reports no `docs/parity/rates.md` (R-02, P1). The file isn't in `/home/user/wt/parity-front` either.

To confirm the money and tax findings, I ran small scripts against the pure domain functions with the shipped Maldives tax pack. They are in `/tmp/claude-0/-home-user-portico/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/rates-probe/`.

**Top 5:**
1. **R-01 (P0):** Service charge and other hotel-set fees are recomputed from current configuration when a night is posted. If the hotel raises its service charge after booking, the guest is charged more than agreed: 131100 became 133440 in the probe. The activation report tells the approver that agreed stays keep their prices, and the E08 test only changes TGST, so this path is untested.
2. **R-03 (P1):** The rates contract doesn't match its consumers, so integration breaks at merge.
   - Reservations' `priceChange` call sends `ratePlanId`, `typeChange` and `asOf`; rates silently drops all three. Reservations then reads `result.terms`, but rates returns `candidateTerms`.
   - The `TermsSnapshot` and policy/penalty shapes differ between the two modules.
   - Finance's tax port uses different field names (`taxGroup`/`priceMode` vs required `taxCategory`/`taxInclusion`), so its lines would fail validation. Finance also expects a `getRulePackStatus` call rates doesn't provide.
   - `Offer.taxesAndFees` changed type, which is breaking even though the README says all changes are additive.
3. **R-04 (P1):** The caller declares its own channel, `bookingDate` and `companyId`. An OTA or booking-engine client can omit the channel to see direct-only plans, or back-date `bookingDate` to get early-booking discounts and skip advance-booking restrictions. RAT-I07 can't be enforced.
4. **R-08 / R-09 (P1):**
   - The prescribed deposit approach (split a night and set `taxPointDate` on each part) charges Green Tax twice (7200 instead of 3600). The request-level `paymentDate` applies to every line, so one deposit date would fix TGST for the whole stay.
   - Nothing implements the Green Tax 24-hour / 12-hour check-out rule and no module owns it.
   - Reservations' own complimentary snapshot drops all taxes, including Green Tax, which MIRA says is still payable on comps. It also leaves the hash stale, so the snapshot no longer verifies.
5. **R-06 / R-07 (P1):** A tax-inclusive plan with a free or zero night throws, and that aborts the quote for every plan at the property. Percent fields have no upper bound, so a 150 % promotion produces a −USD 250 night with negative taxes that channels can book.

**Other P1s:**
- **R-05:** The terms hash is plain SHA-256 that anyone can recompute, yet the README calls it tamper detection. `/v1/quotes/reprice` accepts client-supplied terms and returns a freshly sealed snapshot.
- **R-10:** The tax change report doesn't list affected stays or deposits (RAT-R25 MUST, documented as partial).
- **R-12:** Rates has no price override or complimentary / house-use pricing. That is why reservations edits rates-owned snapshots itself.

**On your four focus areas:**
- **(a) Tax engine vs the Maldives rules:** correct on the core rules:
  - TGST 17/16 % by time of supply, general GST 8 % for general-sector outlets.
  - Service charge inside the GST base; no GST on Green Tax.
  - Green Tax 12/6 by registered room count, under-2 exemption, and refusal to guess a missing classification.
  - Inclusive/exclusive maths: exact and rounded once, with residue to net.

  The gaps are in the findings: partial deposits (R-08), the 12-hour rule (R-09), USD reporting evidence (R-17), and the quote estimate across a rate change (R-16).
- **(b) TermsSnapshot:** immutable and verifiable, but not sufficient to post every night later (R-01, R-03, R-05, R-08, R-12, R-36).
- **(c) Derived rates:** charging the amount per room-night and scaling everything by percent is coherent and matches the spec; per-person supplements correctly live in inclusions. Gaps against OPERA/Mews: no percent-plus-amount in one step, a silent clamp to $0 instead of a floor, and re-parenting under an inactive parent (R-20). Cycle prevention holds under a real concurrent test, but status changes skip the lock (R-21).
- **(d) Rounding:** consistent apart from the missing per-document rounding (R-18) and minor items R-32 and R-33.

I have not verified R-19. The pack's open-ended TGST 16 % version makes a 2021 supply compute at 16 %; to my knowledge TGST was 12 % before 2023-01-01, but someone should confirm.

**Notes for you as orchestrator:**
- Reconcile reservations and finance with the rates-owned shapes before merging any of the three branches.
- Reservations re-implements penalty and comp-snapshot logic that should come from rates.
- Reservations never calls `recordPlanSale` / `releasePlanSale`, so sales limits won't be enforced.
- The same timezone conversion is written three times (rates, reservations, operations); it should move into the kernel.
- I endorse the platform `getPropertyFacts` foundation request.
- Inventory's `listUnitTypes` still needs binding when inventory merges.
- The domain map needs rates' new providers and events added.
````

