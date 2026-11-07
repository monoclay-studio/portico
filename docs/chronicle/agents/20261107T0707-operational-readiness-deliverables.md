# Agent run: Operational readiness deliverables

- Started: 2026-11-07T07:07:01.541Z · last activity: 2026-11-07T07:31:35.249Z
- Turns: 0 · tool uses: 0 · output tokens: 0
- Type: general-purpose

## Brief (2026-11-07T07:07:01.541Z)

````text
You are the Operational Readiness lead for "Portico" (working name), a cloud hospitality management platform (PMS + distribution + payments + resort ops) being built by Monoclay LLC (a Delaware company formed via Stripe Atlas; founder lives in the Maldives). First market: Maldives resorts/guesthouses/hotels; every segment from guesthouses to multi-property groups. No pilot hotel has agreed yet.

WORK ONLY in the git worktree /home/user/wt/readiness (branch `docs/operational-readiness`). Commit your work there with Conventional Commit messages ending with these two trailer lines exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do NOT push. Do not edit files outside `docs/readiness/` except: you may add new questions to the bottom of `docs/OPEN_QUESTIONS.md` using its template (numbering from Q20 upward to avoid collisions with other agents).

READ FIRST: /home/user/wt/readiness/CLAUDE.md, docs/product/brief.md, docs/product/operational-readiness-brief.md (THE brief you are executing — its §22 lists your 12 deliverables), docs/product/decisions.md, docs/OPEN_QUESTIONS.md, docs/architecture/domain-map.md, and the four research reports in docs/research/ (especially 04-connectivity-payments-compliance.md). Owner decisions so far: hotel legal entity is merchant of record (Stripe Connect preferred, provider-agnostic design); first market Maldives; AWS; connectivity hub first (Channex being evaluated, not mandatory); no pilot hotel yet; product name not final.

PRODUCE in docs/readiness/ (Markdown, tables where useful, every current claim with source URL + "verified 2026-11-07" or labeled unconfirmed / quote required / estimate / assumption; never treat an unpublished fee as zero; never invent timelines, prices, partnerships, certifications or legal conclusions):
1. gap-assessment.md — the codebase is just starting (foundation in progress), so assess against both briefs: capability areas, what exists (planned), external gaps.
2. dependency-register.md — every external service: Stripe (Connect + Billing for Monoclay SaaS), Adyen, Maldives local acquirers/gateways (Bank of Maldives BML Connect, MIB, CBM, others — research what exists), Channex, Booking.com, Expedia, Airbnb, Agoda, Trip.com, Hotelbeds/bedbanks, GDS (Sabre/Amadeus/Travelport via intermediaries), Google Hotel Center/free booking links, AWS services, email (SES), SMS/WhatsApp (Twilio, Meta WhatsApp Cloud API), Anthropic Claude API, translation, door locks (ASSA ABLOY Vostio/Visionline, dormakaba, Salto), POS (Oracle Simphony, Lightspeed, Toast, Agilysys, local), accounting (Xero, QuickBooks, NetSuite, SAP), Salesforce, identity verification, fiscal/e-invoicing middleware, revenue management (IDeaS, Duetto, Atomize), monitoring (Sentry etc.). Use the field list in brief §3. One section per provider plus a summary table.
3. channel-capability-matrix.md — per channel (direct vs via Channex) × capabilities in brief §4. Mark supported/limited/unsupported/unverified with source. Include the Channex planning baseline from brief §5 exactly as dated.
4. certification-approval-matrix.md — brief §10 categories (legal, payment-network, provider certification, contractual, procurement, voluntary assurance, internal), with applicability, scope, evidence, owner, cost, lead time, renewal, triggers. PCI DSS (service-provider vs merchant, SAQ applicability), OTA certs, SOC 2, ISO 27001, fiscal approvals.
5. market-matrix.md — supported-market register; deep section for MALDIVES: TGST (17% from 1 Jul 2025 per research — verify with MIRA), Green Tax rates by property class, service charge treatment (Employment Act / MIRA guidance on service charge distribution and whether it's in the GST base — research it), invoice requirements (tax invoice contents per MIRA), MIRA filing/reporting, tourism ministry guest registration/reporting requirements (e.g. arrival/departure reporting), currency (USD pricing in resorts, MVR requirements, MMA exchange rate rules if any), data protection status in Maldives, record retention. Also a lighter section for the next likely markets (UAE, Sri Lanka, India, Seychelles, Mauritius, EU, US) marking each requirement as validated / unvalidated.
6. cost-model.md — scenarios: zero live hotels (demo mode), 1 pilot, 10, 50, 100 properties; fixed vs variable vs one-time vs hotel-paid; assumptions (rooms, users, bookings, documents, messages, AI usage); AWS line items (use published on-demand prices for ap-south-1 where you can verify, else mark estimate); Channex; comms; AI (Claude API published per-token pricing — verify); monitoring; support staffing. Show cost per property and heavy-usage sensitivity. Clearly separate Monoclay existing subscriptions (Stripe Atlas, Claude subscription) as excluded. State the zero-cost demo approach.
7. responsibility-matrix.md — RACI-style for Monoclay vs hotel vs provider for each money flow and operational duty; include the money-flow diagrams (text/mermaid) for every payment scenario in brief §7 (merchant of record, processor, acquirer, recipient account, fees, settlement timing, refund/dispute responsibility, reconciliation owner).
8. security-privacy-readiness.md — brief §12–§13 acceptance criteria, processing roles per purpose (controller/processor per purpose — do not apply one label), retention schedule draft, support access controls, incident response outline, evidence required for each control.
9. migration-onboarding-checklist.md — brief §18, incl. cutover/rollback design that never erases post-cutover transactions; source systems (OPERA, Cloudbeds, Mews, eZee, RoomRaccoon, spreadsheets) export realities.
10. launch-checklist.md — the five launch gates of brief §21, each with required evidence, blockers, responsible human decision-maker (role), and what can proceed meanwhile.
11. support-recovery-plan.md — SLO targets (labeled as TARGETS), RPO/RTO targets, continuity procedures for property internet loss (reception, housekeeping, payments, arrivals, departures, emergency guest info), incident roles/escalation, backup-restore verification approach, DST/timezone/business-date risks.
12. roadmap-critical-path.md — prioritized delivery roadmap (engineering waves: foundation → core modules: inventory, rates/tax engine, guests, reservations, finance ledger/folios, payments, operations → day close, distribution, groups, comms, integration/import, analytics → resort ops, AI, booking engine, staff PWA, infra) plus the EXTERNAL critical path (accounts, contracts, sandboxes, certifications, legal reviews, payments eligibility) with owners and what proceeds meanwhile.
Also create docs/readiness/readiness-register.md: a register of capabilities and integrations with columns: capability | technical level (R1–R4 on the scale in CLAUDE.md §7) | external approval status | hotel validation | evidence link. Everything is currently R1 Planned except what the foundation has (leave as R1 — the orchestrator updates it). And docs/readiness/README.md indexing all files, plus docs/readiness/business-documents-register.md (brief §20: documents needing professional/legal review, never presented as approved).

RESEARCH: use WebSearch/WebFetch for official sources (MIRA mira.gov.mv, Ministry of Tourism tourism.gov.mv, Stripe global availability page stripe.com/global, Stripe Connect docs, Channex docs/pricing, AWS pricing, Anthropic pricing, Twilio/Meta pricing, BML). Some domains may be blocked by the network proxy — if so, use search-result excerpts and label the claim accordingly. SPECIFICALLY VERIFY: (a) whether Stripe supports businesses incorporated in the Maldives, and Stripe Connect cross-border options for a US platform; (b) current Maldives TGST rate and green tax rates; (c) Channex pricing page as of today. Put the precise unresolved questions for providers/professionals in each document.

Be thorough but practical; a founder must be able to act on these. Plain English. Your final reply: a ~300-word summary of the most decision-relevant findings (especially payments eligibility in the Maldives, tax facts, cost of zero/1/10 hotels), the list of files, and any new OPEN_QUESTIONS you added. Do not ask me questions.
````

## Report (2026-11-07T07:31:35.249Z)

````text
## Operational readiness deliverables: summary

All 12 deliverables are written, plus the readiness register, the business-documents register and an index. They are in 5 commits on `docs/operational-readiness` (5 commits, `567960f`..`4c2d671`), with the required trailers. Nothing was pushed.

**I could not verify anything live.** The shared web-search budget was used up, and the network policy refused stripe.com and channex.io, so I stopped trying other sites. Claims marked "verified 2026-11-07" come from the same-day research reports and keep their source URLs. Everything else is labelled unconfirmed, quote required, estimate or assumption. `README.md` lists the hosts to allow-list and exactly what to check on each.

### The three checks you asked for
- **Stripe and Maldivian businesses:** not verified. I'm planning on the basis that Maldivian legal entities can't use Stripe. Stripe's cross-border payouts would make Monoclay the merchant that receives the money, which breaks D2 either way.
- **Maldives tax rates:** TGST is 17% from 1 Jul 2025, and green tax is $12 or $6 per guest-night depending on property class. Both are verified 2026-11-07 via KPMG and Maldivian news sources, but not on MIRA's own site.
- **Channex pricing:** not re-fetched. The owner's baseline and the research report, both dated 7 Nov, agree: $130/month plus $7 per property, and $7 more for messaging and reviews.

### Findings that affect decisions
- **Payments don't have to block a pilot.** The hotel keeps its own bank terminal or gateway and Portico records each payment without processing it ("Route D"). Local bank gateways (Bank of Maldives' BML Connect, Maldives Islamic Bank, and "CBM") come next. The questions for them are ready, and you need to confirm which bank "CBM" means.
- **A Maldives adviser is needed before any live invoice.** Still unconfirmed: whether TGST applies to the service charge, the service-charge rules for staff, what a MIRA tax invoice must contain and in which currency, filing formats, guest reporting, foreign-exchange rules, and how long records must be kept.
- **Costs, all estimates and excluding people:** about $0 in demo mode. One pilot is about $460–780/month. Ten properties are about $90–141 each, and 50–100 properties about $49–77 each. Support staff, not infrastructure, is the biggest cost and limits what we can honestly promise.
- **Critical path to a pilot:** a named hotel, an adviser, AWS authorization, reviewed contracts, a penetration test and a defined support promise. Provider certifications are not on it.

### Files (in `/home/user/wt/readiness/docs/readiness/`)
- `README.md`
- `gap-assessment.md`
- `dependency-register.md`
- `channel-capability-matrix.md`
- `certification-approval-matrix.md`
- `market-matrix.md`
- `cost-model.md`
- `responsibility-matrix.md`
- `security-privacy-readiness.md`
- `migration-onboarding-checklist.md`
- `launch-checklist.md`
- `support-recovery-plan.md`
- `roadmap-critical-path.md`
- `readiness-register.md` (everything at R1)
- `business-documents-register.md`

### New open questions in `/home/user/wt/readiness/docs/OPEN_QUESTIONS.md`
- **Q20:** engage a Maldives tax/legal adviser and US counsel.
- **Q21:** support promise for the pilot.
- **Q22:** spending ceiling before a pilot, and whether to host a demo.
- **Q23:** when to activate Channex production.
- **Q24:** when to fund SOC 2, ISO 27001 or a PCI attestation.
- **Q25:** whether AI may process guest data, via Anthropic directly or Amazon Bedrock.
- **Q26:** whether the first pilot is a guesthouse/small hotel or a resort.

Each one states the default being followed in the meantime.
````

