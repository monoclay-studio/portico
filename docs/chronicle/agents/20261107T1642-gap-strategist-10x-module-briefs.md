# Agent run: Gap strategist: 10x module briefs

- Started: 2026-11-07T16:42:54.033Z · last activity: 2026-11-07T17:09:22.047Z
- Turns: 103 · tool uses: 125 · output tokens: 166,927
- Type: general-purpose

## Brief (2026-11-07T16:42:54.033Z)

````text
You are the gap strategist for Portico, a cloud hospitality management platform by Monoclay LLC. The first market is the Maldives; it serves 6-room guesthouses up to 400-villa resorts and multi-brand groups. It is a TypeScript modular monolith at /home/user/portico. Read CLAUDE.md, then docs/product/vision.md and docs/orchestration/operating-model.md, which defines your role and the format of your output.

Your worktree is /home/user/wt/strategy (branch docs/strategy, created from main). Write only under docs/strategy/. Commit locally after each meaningful step; never push.

Owner mandate: each module agent must make its module **at least 3x–10x more powerful, seamless, friendly and well-rounded than anything on the market**, measured rather than claimed. Your job is to tell each module agent exactly where it stands and what "10x" means for it.

Read:
1. **Research:**
   - docs/research/01–04 (vendor research);
   - docs/research/05-digest.md and docs/research/05-market-deep-dive/* (market, vendor profiles, academic research, patents, AI trends, implementation and support, customer evidence, Maldives, one-button migration).
2. **What we promise:**
   - the owner briefs: docs/product/brief.md (including the 20 proof scenarios), operational-readiness-brief.md and adoption-integration-brief.md;
   - docs/product/decisions.md;
   - docs/product/* (editions, personas, design direction, experience architecture, UX principles).
3. **Parity:** docs/parity/*.md (matrices and edge-case catalogues per module). Run `node tools/parity-report.mjs` for the current numbers.
4. **What we actually built:** every module's code and README on main (modules/*, packages/*, apps/api). The README "Known gaps" and "Checkpoint" sections are the honest state. Also the steward reviews in docs/orchestration/reviews/ and docs/orchestration/pending-fixes.md.
   - Branches not yet on main, read-only: feat/identity-platform-enterprise in /home/user/wt/identity-plus; feat/backoffice-core in /home/user/wt/backoffice, the staff web app. Use `git -C <worktree> show` or read the files.
5. **How it feels to a new user:** docs/ux/round-1/blackbox-findings.md.
6. **The specs** for modules not yet built: docs/specs/*.md (wave 2 and later, e.g. day close, distribution, groups, comms, analytics, migration, access, crm, guest experience, accounting, fnb-pos, procurement, stock, workforce).

Produce:
- **docs/strategy/gap-plan.md** — the platform view:
  - where Portico stands vs the market today, per dimension (powerful, seamless, friendly, well-rounded), with evidence;
  - the 10–15 platform-level moves that create a 10x advantage, such as one-button migration, truthful operations, connected mode, the AI assistant, offline resilience for islands and one record contract, each with the modules involved and the sequencing;
  - what must exist before a first pilot hotel vs later;
  - risks, including patents, Oracle access and payments availability in the Maldives.
- **docs/strategy/modules/<module>.md** — one per module, both built and planned. Each contains:
  - **current state**, with evidence (tests, parity %, review findings still open, known gaps);
  - **best on the market today**: who does it best, how, with citations to our research files;
  - **gaps vs market**: ranked, each tied to parity rows or edge cases where they exist;
  - **the 10x outcome**: what "3x–10x better" concretely means for this module, with measurable targets per dimension (e.g. steps per task, time to independence, automation share, edge-case coverage). Label every target as a target until it is validated with hotel staff;
  - **the next 3 increments**, in order, each small enough for one agent round, with acceptance criteria;
  - **cross-module dependencies and contract changes** it needs;
  - **power check**: what must never be lost or hidden.

Rules:
- Evidence-based: cite our files (path and section) for every claim about competitors or about our own state.
- Don't invent competitor facts. Mark anything uncertain as such.
- No pricing, legal opinions or commitments only the owner can make. Put those in docs/OPEN_QUESTIONS.md using its template with a default; check the current highest Q number first.
- Be concrete enough that a module agent can start work from its brief alone.

Reply with:
- the top 10 platform moves in plain English;
- one line per module stating its 10x target;
- the files written.
````

## Report (2026-11-07T17:09:21.944Z)

````text
I wrote the platform gap plan, 32 module briefs and six new owner questions (Q150–Q155). Everything is committed on branch `docs/strategy` in /home/user/wt/strategy (7 commits, `1bdcf1f..ebec424`), not pushed. Only `docs/strategy/` and `docs/OPEN_QUESTIONS.md` were changed. Running `tools/parity-report.mjs` rewrote `docs/parity/COVERAGE.md`; I reverted that.

**Where Portico stands**
- **Engines:** ten wave-1 modules are on main at R3, with about 1,000 automated tests. The core designs (ledger, previews, pending verification, composite inventory, data authority) are at or ahead of competitors.
- **What a hotel would use:** nothing is usable end to end. Cross-module ports are still being bound. The staff web app shows its operational screens on simulated data. Nothing is R4 or higher, and no staff validation has happened.
- **UX round 1 baseline:** the tester completed 5 of 34 core tasks and hit 14 blockers across 8 of 9 personas.
- **Identity:** the enterprise branch still has an open P0 cross-organization account takeover (review 2, R2-P0-1). It must not merge until that is fixed.

**Measurement problems to fix first** (each brief's first increment covers its own module)
- The parity files for inventory and reservations show 1% tested, but their READMEs prove dozens of rows with tests.
- The committed `docs/parity/COVERAGE.md` is stale: it shows rates at 2%, while a fresh run gives 61%.
- 16 modules have no parity file at all.
- A stale build cache once reported a passing typecheck that actually failed.
- `docs/specs/access.md` and `docs/specs/accounting.md` both use the `ACC-Rnn` requirement prefix; one needs renaming.

**Top 10 platform moves, in plain English**
1. **Make it real:** connect every module to every other and run all 20 proof scenarios through the real API. Replace every simulated screen with live data.
2. **One record, one command surface, one search:** every action is reachable the same way from the screen, a keyboard shortcut, the command palette, the API and later the AI. Search finds anyone who ever stayed.
3. **Truthful operations:** the server decides every status and the screens only display it. Provenance labels go everywhere. Automated checks make it impossible for two screens to contradict each other.
4. **Productive in one shift:** plain-language copy and errors, role workspaces, guided tasks and a practice organization for each user. Measure time to independence with real Maldivian staff.
5. **Money without doubt:** collection plans so the same payment can never be taken twice. Receipts within MIRA's 3-day rule. Bank transfers, own terminals, cash and QR payments are recorded, then verified against statements.
6. **Day Close that never blocks:** a running list of open items through the day, steps that are safe to repeat and resume after a failure, and nobody logged out.
7. **Connected mode everywhere:** run Portico housekeeping, messaging or reporting next to OPERA or Mews, and let a trial hotel see its own yesterday with discrepancies listed.
8. **One-button migration:** connect, map, rehearse, sync, reconcile, cut over with a freeze of 15 minutes or less. Only the 7 steps that legally or technically need a person remain.
9. **Distribution you can see and recover:** an OTA outage never shows as synced, a booking is never dropped, AI booking assistants are treated as a channel, and there is a booking engine.
10. **Island-grade resilience:** the housekeeping app works offline, and a continuity snapshot answers "who is in which villa and what do they owe" during an outage.

The plan has four further moves:
- **The connected resort:** transfers, activities, meal plans and POS on one itinerary and one bill.
- **An AI assistant** that acts only through the same commands as staff, cites its sources, is included in every edition and has a published evaluation.
- **Portfolio control:** a policy centre with visible local overrides, plus a calendar of upcoming changes that properties can defer.
- **Trustworthy numbers:** analytics with definitions and drill-down, and bulk export and import of all data.

**Headline 10x target per module (all labelled targets until validated with hotel staff)**
- **reservations:** walk-in in 3 minutes or less; check-out with split bills in 90 seconds or less; one action re-plans every arrival on a grounded seaplane.
- **inventory:** every availability number explained in one click; no oversell without a conflict record; tomorrow's room assignments suggested with reasons.
- **rates:** an explainable pricing assistant in every edition; a season change across many plans in 5 interactions or fewer; zero differences from the tax adviser's worked examples.
- **guests:** find anyone in 5 seconds or less by name, phone, email or code; at least 95% of duplicates caught before creation; nothing re-typed for known guests.
- **finance:** tax invoices and receipts always issued within the legal window; zero unexplained ledger differences; one bank transfer allocated to 40 invoices in 2 minutes or less.
- **payments:** zero duplicate charges in any failure scenario; at least 98% of payments verified within one business day, including bank transfers and QR.
- **operations:** room status updated in 2 taps or fewer; tomorrow's plan for 40 rooms in 5 minutes or less; housekeeping works end to end next to another PMS.
- **integration:** hotel staff make a first read-only connection in 30 minutes or less; all 10 data domains can be mirrored and forwarded; partners self-serve in 15 minutes or less.
- **platform:** a portfolio policy change previewed with local overrides in 3 interactions or fewer; a guesthouse goes from sign-up to first booking in 30 minutes or less.
- **identity:** zero open P0/P1 findings; switching user on a shared desk PC with a PIN in 3 seconds or less.
- **backoffice and staff app:** 100% of core tasks completed by a new user (today 5 of 34); a new desk agent productive in one shift.
- **migration:** a guesthouse moves the same day; an OPERA Cloud resort in 5 days or less with a freeze of 15 minutes or less; zero duplicate reservations.
- **day-close:** 2 minutes or less of the auditor's attention; nobody logged out; zero duplicate postings after any interruption.
- **distribution:** median rate and availability update reaches channels in 60 seconds or less; zero lost bookings; outages shown with their impact within 2 minutes.
- **groups:** a 30-room, 5-night block with rates built in 5 minutes or less; cuts after the deadline previewed with their contract consequences.
- **comms:** zero duplicate or contradictory replies; automated messages re-checked whenever the booking changes.
- **analytics:** no figure without a definition and drill-down; zero unexplained differences from the ledger.
- **access:** no key still valid after checkout without a visible exception; a key is never shown as issued before the encoder confirms.
- **contracting:** at least 95% of tour-operator voucher bookings priced and checked against the contract automatically.
- **guest-services:** no allergy unacknowledged by an outlet at service time; the in-house list available offline in 30 seconds or less.
- **guest-experience:** online check-in in 4 minutes or less; nothing re-typed at the desk; every self-service failure handed to staff with context.
- **resort:** one action re-plans transfer, check-in, dining and activity; an outlet charge with the meal-plan entitlement posted in 20 seconds or less.
- **ai:** every answer cites its records; zero invented facts and zero unsafe actions in a published evaluation.
- **crm:** no message sent without consent; a negative survey answer becomes an owned case within 5 minutes.
- **billing:** no code path from guest money to Monoclay; no usage cost charged without a prior estimate and cap.
- **fnb-pos:** every outlet charge lands exactly once with the right entitlement and tax; each outlet closes its day balanced.
- **accounting:** month-end close inside Portico in 3 working days or less, with nothing re-keyed between the PMS and the books.
- **procurement:** at least 85% of supplier invoices matched automatically; island shipment delays propagate before goods arrive.
- **stock:** days of cover shown for every critical island supply; stock value equals the ledger at month end.
- **workforce:** rosters built from the forecast in 15 minutes or less; service-charge runs reproducible to the cent.
- **concessions:** partner settlements tie to folio postings and are approved in 10 minutes or less.
- **utilities:** diesel and water per guest-night available daily after each Day Close; every anomaly has an owner.

**Owner questions added (each with a default in force)**
- **Q150:** counsel review of the remaining patents. Default: rule-based upsell, staff-entered service times, lock-vendor kits only, no biometrics.
- **Q151:** publishing comparisons with named competitors. Default: internal only.
- **Q152:** usability sessions with Maldivian hotel staff. Default: no recruiting or spend.
- **Q153:** whether assistive AI is included in every edition. Default: designed as included, with visible caps.
- **Q154:** contacting Maldivian banks about gateways and Favara/QR. Default: no contact; payments are recorded and verified.
- **Q155:** Dhivehi and expatriate staff-language translations. Default: English, with strings ready for translation.

**Files written** (all in /home/user/wt/strategy)
- `docs/strategy/gap-plan.md`: standing per dimension, the 14 moves, sequencing, pilot gates, risks, contract changes, and the per-module target table.
- `docs/strategy/modules/` — 32 briefs, each with current state, best on the market, ranked gaps, targets, 3 increments with acceptance criteria, dependencies and a power check:
  - built: platform, identity, inventory, rates, guests, reservations, finance, payments, operations, integration, backoffice
  - planned: migration, day-close, distribution, groups, comms, analytics, access, contracting, guest-services, guest-experience, resort, ai, crm, billing, fnb-pos, accounting, procurement, stock, workforce, concessions, utilities
- `docs/OPEN_QUESTIONS.md`: Q150–Q155 appended. Q146–Q149 already exist on the identity branch.
````

