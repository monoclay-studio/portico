# Agent run: Adoption and integration deliverables

- Started: 2026-11-07T07:25:47.535Z · last activity: 2026-11-07T07:51:27.921Z
- Turns: 0 · tool uses: 0 · output tokens: 0
- Type: general-purpose

## Brief (2026-11-07T07:25:47.535Z)

````text
You are the Integration & Adoption lead for "Portico" (working name), a cloud hospitality management platform built by Monoclay LLC. The owner's final product ambition: the EASIEST hospitality platform to evaluate, integrate, adopt and operate — from a Maldivian guesthouse to a multinational group — with integration and migration as core product capabilities.

WORK ONLY in the git worktree /home/user/wt/adoption (branch `docs/adoption-integration`). Commit there with Conventional Commit messages ending with exactly these trailer lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do NOT push. Only create files under docs/adoption/. You may append questions to docs/OPEN_QUESTIONS.md using its template, numbering from Q60 upward.

READ FIRST (all in your worktree): CLAUDE.md (especially rules 12–16: environment safety, data authority/system of record, provenance), docs/product/adoption-integration-brief.md (THE brief you are executing; its §15 lists your deliverables), docs/product/brief.md, docs/product/operational-readiness-brief.md, docs/product/decisions.md, docs/product/glossary.md (use ONLY these terms), docs/architecture/domain-map.md, docs/research/*.md (four competitor/connectivity reports). Also read the implemented code that defines the concepts you build on: modules/platform/migrations/0001_platform.sql and modules/platform/src/service.ts (data authority: domains reservations, availability, rates, guestProfiles, charges, payments, roomStatus, maintenance, accounting; authority portico|external; write_mode exclusive|forward|read_only) and packages/kernel/src/environment.ts (environments live/trial/sandbox/training/demo and the external-effect policy).

Note: two other docs agents are working in parallel — one on operational readiness (dependency register, provider costs, certification matrix, market matrix in docs/readiness/) and one on product strategy and module specs (docs/product/, docs/specs/). Do not duplicate their files; reference them by path (e.g. docs/readiness/dependency-register.md, docs/specs/integration.md) even if they do not exist in your worktree yet.

DELIVER in docs/adoption/ (precise, testable, plain English; current claims about vendors carry source URL + "verified 2026-11-07" or are labeled unconfirmed/assumption; never invent partnerships, certifications, API access or prices):
1. gap-assessment.md — integration & adoption gap assessment against the brief, given what exists now (foundation only: platform, identity, data authority, environments; everything else planned).
2. adoption-paths.md — the three adoption paths (connect alongside / replace selected capabilities / full migration). For each Portico module (inventory, rates, reservations, guests, finance, payments, operations [housekeeping+maintenance+tasks], comms, analytics/reporting, distribution, groups, resort ops, day-close, AI): can it be offered standalone, what are its hard dependencies, what data it needs from the external system of record, what it writes/forwards back. Make an explicit "standalone module catalogue" (e.g. housekeeping alongside OPERA/Cloudbeds/Mews; guest messaging alongside any PMS; reporting over an external PMS) and mark which are NOT offered standalone and why.
3. source-of-truth-matrix.md — for each adoption path and representative setup, which system controls reservations, availability, rates, guest records, charges, payments, room status, maintenance, accounting; the write_mode used; the coordination rules preventing two systems from modifying the same information; the transition steps when authority moves (e.g. cutover) including handling of in-flight bookings.
4. evaluation-and-trial.md — the staged evaluation experience (demo with Maldives sample data → isolated trial with authorized copy of hotel data → optional read-only connection → controlled pilot → separately approved production activation): what the user sees, environment and provenance labeling, what can never happen in each stage (map to the environment effect policy), trial reset/export/delete and retention, what configuration carries forward into production and how it is validated, and "show value with the hotel's own operation" (the questions in brief §4, how each is answered with evidence and discrepancy reports).
5. integration-coverage-matrix.md — prioritized provider × workflow coverage for our target segments (Maldives guesthouses & resorts first, then regional groups, then international operators). Research which PMS, channel managers, POS, accounting/ERP, door-lock, payment, RMS, CRM/guest messaging, spa/activities, transport, procurement, fiscal and identity systems these customers actually use (use web search; cite sources; Maldives specifics where findable). For each provider: products/versions, regions, access model (public API / partner program / on-premise interface / file), workflows per brief §6 broken down into read / create / update / receive-changes, sync mode (immediate / periodic / manual / file — a file export is never a live connection), local connector needs, costs (or "quote required"), limitations, and priority tier (P0 pilot-critical / P1 / P2). Coverage must be measured against segment workflows, not logo counts.
6. connection-lifecycle-and-health-spec.md — the 9-step connection setup journey (brief §7) as a precise product spec: states, preserved progress, mapping suggestions (properties, rooms, rates, outlets, taxes, accounts, statuses) with confidence and mandatory review for ambiguous/financially significant mappings, validation runs, behavior preview, scoped activation; then health & recovery: last successful exchange, delays, failed/incomplete workflows, mapping problems, credential expiry, vendor-required changes, affected properties and operational impact, recovery actions, safe pause/disconnect/credential rotation/provider replacement with impact preview; urgent vs routine separation; exactly what happens on delayed/missing/duplicate/out-of-order messages, conflicting edits, expired credentials, outages; and the rule that reconnecting never blindly replays actions that could double-charge or reopen sold inventory. Include a data model sketch (connections, credentials refs, scopes, mappings, sync runs, exchange log, exceptions) and error message standard (problem, business impact, responsible party, next step).
7. migration-acceptance-criteria.md — migration as a product: source export feasibility assessment (legal/technical, vendor fees, history limits, non-portable payment tokens), preview & mapping, quality checks & duplicate detection, trial imports, reconciliation (reservations, deposits, open balances, AR, inventory) with numeric acceptance thresholds labeled as targets, exception list with owners, final change capture, staff sign-off, cutover runbook, rollback that accounts for post-cutover activity, historical archive option. Include per-source-system notes for OPERA (5.x on-prem and Cloud), Cloudbeds, Mews, eZee, RoomRaccoon, Little Hotelier, spreadsheets.
8. rollout-requirements.md — independent-property simplicity vs enterprise control (brief §11): templates, bulk setup & validation, pilot properties & staged rollout groups, separation of duties & approvals, central integration policies with local exceptions, region-specific compliance, cost allocation, and the rule that one property's pilot success doesn't establish group readiness. Also on-site/local connector requirements (brief §12): which equipment/legacy systems need a local connector, supported environments, installation/update/monitoring responsibility, outage behavior (what keeps working when internet or the connector fails).
9. ecosystem-and-developer-experience.md — partner/vendor integration program (brief §13): scoped OAuth apps, sandbox orgs with sample data, capability docs, error standard, change notices & versioning, production approval by risk, compatibility verification, support ownership, removal of unsafe integrations, marketplace listing rules (demonstrated capabilities only).
10. success-metrics.md — baselines and TESTABLE TARGETS (clearly labeled as targets) for every metric in brief §14, how each is measured, with what users/workloads, and competitor comparison method (better/comparable/behind, with evidence). Include the rule: no speed gains by hiding errors, weakening permissions, or skipping reconciliation.
11. roadmap.md — adoption & integration roadmap distinguishing internal development from external approvals/partnerships, with the critical path; prioritize a complete trustworthy experience for representative setups (e.g. "Maldives 12-room guesthouse fully on Portico", "120-villa resort keeping its POS and accounting", "3-property group keeping OPERA but adopting Portico housekeeping + messaging") before breadth.
12. README.md indexing everything.

Your final reply: ~300 words summarizing the most important decisions (standalone module catalogue, representative setups, P0 integrations for a Maldives pilot, key risks), the files created, and any OPEN_QUESTIONS you added. Do not ask me questions.
````

## Report (2026-11-07T07:51:27.921Z)

````text
I wrote all 12 deliverables in `docs/adoption/` and added Q60–Q64 to `docs/OPEN_QUESTIONS.md`, in two commits on `docs/adoption-integration` (dfbb363, b82cacc). Nothing is pushed. No new vendor facts could be verified this session: the web search budget was used up and vendor sites such as `channex.io` and `developer.xero.com` were unreachable. So every vendor claim comes from `docs/research/` (with its URL, "verified 2026-11-07") or is labeled unconfirmed or assumption. Which systems Maldivian hotels actually use is an assumption throughout.

**Main decisions**
- **Adoption paths are defined by data authority, so they can be checked in the data.** A = Portico controls no governed domain. B = one or more domains move to Portico (e.g. room status). C = Portico is the PMS.
- **Offered standalone:** housekeeping (SM-01), maintenance (SM-02), tasks (SM-03), guest messaging (SM-04), reporting over an external PMS (SM-05), transfers (SM-06). Four more are conditional and later.
- **Not offered standalone, with reasons:** inventory, rates or reservations on their own, finance, payments at launch, channel manager and booking engine, Day Close, group room blocks, meal-plan entitlements, and AI as a product.
- **Housekeeping next to a PMS sends room status to the PMS by default**, so the PMS stays the system of record. Letting Portico own room status is opt-in, with a rule that edits in the PMS which make a room less ready are accepted and edits that make it more ready are rejected.
- **Representative setups, completed before adding more providers:**
  - RS-1: 12-room guesthouse fully on Portico.
  - RS-3: 3-property group keeping OPERA Cloud, adopting Portico housekeeping and messaging.
  - RS-2: 120-villa resort keeping its POS, accounting and spa.
- **Pilot-critical integrations for a Maldives pilot:**
  - spreadsheet and OPERA migration importers;
  - the Channex hub for Booking.com, Expedia and Agoda;
  - email and WhatsApp;
  - manually recorded payments (a card acquirer depends on Q2);
  - accounting journal file export and MIRA tax-return data;
  - OPERA's integration platform (OHIP) for RS-3;
  - a Portico POS posting API plus one POS vendor for RS-2.
- **Key risks:**
  - no named pilot hotel;
  - card acquiring for Maldivian hotels is unresolved;
  - OHIP requires Oracle partner access with per-call fees;
  - on-site connectors and vendor licences for locks and on-premise POS;
  - the provider assumptions above.

**Problems found in the existing code (gap assessment G-01 to G-08)**
- An external system of record with "exclusive" write mode behaves exactly like "read_only" and should be rejected.
- Data authority has no cutover/freeze state and keeps no history.
- The effect policy ignores property status, so a pilot can't be held to a narrow scope.
- The database check on data authority doesn't match the service rule.
- The editions in `plans.ts` don't allow standalone modules.
- The glossary is missing the `trial` and `sandbox` environments; I put proposed glossary additions in the README.

I queued a suggested task card to fix the first and fourth items in code.

**Open questions added**
- Q60: packaging and pricing for standalone modules and migration services.
- Q61: Oracle partner access for OHIP and OPERA 5.x.
- Q62: support commitment for the on-site connector, and vendor interface licensing.
- Q63: trial data retention, processor role, and real AI on copied data.
- Q64: discovery calls with Maldivian hotels and a candidate pilot.

Files are in `/home/user/wt/adoption/docs/adoption/`:
- README.md
- gap-assessment.md
- adoption-paths.md
- source-of-truth-matrix.md
- evaluation-and-trial.md
- integration-coverage-matrix.md
- connection-lifecycle-and-health-spec.md
- migration-acceptance-criteria.md
- rollout-requirements.md
- ecosystem-and-developer-experience.md
- success-metrics.md
- roadmap.md
````

