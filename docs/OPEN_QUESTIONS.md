# Open questions for the owner

Questions that materially affect scope, spending, commercial commitments, legal responsibility or live
operations. **Work never stops on these**: each has a default that engineering proceeds with until answered.
Agents: add new questions at the bottom using the template; never delete answered ones (mark them answered
and move the answer into `docs/product/decisions.md`).

Template:

```
### Qn — <short title>                                   Status: open | answered (date)
**Context:** why this matters, in plain English.
**Question:** the precise decision needed.
**Default we are proceeding with:** …
**If the answer differs:** what changes / rework size.
**Blocks:** what cannot proceed (and what can).
**Raised by / date:** …
```

---

### Q1 — Final product name and brand                       Status: open
**Context:** "Portico" is the repository/working name; the brief says the name is not final. The name appears in UI, emails, booking engine, API docs and legal documents.
**Question:** What is the product's public name (and is a brand/visual identity coming)?
**Default we are proceeding with:** "Portico" everywhere, sourced from one configuration constant (`PRODUCT_NAME`) and one design-token set, so renaming is a config change plus copy review.
**If the answer differs:** cosmetic rename; domain names and email sender setup would change.
**Blocks:** nothing in development. Blocks domain purchase, email sender verification, public website.
**Raised by / date:** orchestrator, 2026-11-07

### Q2 — Payment processing for Maldivian hotel legal entities    Status: open (verification in progress)
**Context:** You chose "hotel is merchant via Stripe Connect". Stripe is believed **not** to onboard businesses incorporated in the Maldives (to be verified from Stripe's official country list). If so, a Maldivian resort cannot be the merchant of record on a Stripe connected account, and Monoclay's US Stripe account cannot collect on its behalf (that would make Monoclay a payment intermediary — a separate regulated business).
**Question:** For Maldives hotels, are you willing to integrate local acquirers/gateways (e.g. Bank of Maldives "BML Connect", MIB, other) and/or allow hotels to use processors they already have — with Stripe Connect used where hotels' legal entities are eligible (e.g. groups with entities in supported countries)?
**Default we are proceeding with:** provider-agnostic payment domain; a full **simulator** provider for development and demo; a Stripe Connect adapter (direct charges) built and sandbox-tested; local-acquirer adapters researched and added to the dependency register as "quote required / unverified".
**If the answer differs:** only the adapter priority changes; the payment domain is unaffected.
**Blocks:** live guest payments for a Maldives pilot. Nothing in development.
**Raised by / date:** orchestrator, 2026-11-07

### Q3 — Commercial plans and prices                         Status: open
**Context:** You want different pricing for small vs large customers. The product enforces this through editions + entitlements (features and limits) — the prices themselves are commercial decisions.
**Question:** Approve the edition structure (Essentials / Professional / Resort / Enterprise — proposed in `docs/product/editions.md`) and set prices, or tell us your intended model (per room, per property, flat, usage).
**Default we are proceeding with:** editions as feature/limit bundles with prices stored as configuration, no prices published anywhere.
**If the answer differs:** configuration change only.
**Blocks:** public pricing page, SaaS billing go-live.
**Raised by / date:** orchestrator, 2026-11-07

### Q4 — AWS account, primary region and data-hosting stance   Status: open
**Context:** Infrastructure is written as Terraform for AWS. Nothing is deployed (no spend). Region affects latency for Maldives users and data-residency answers in future RFPs.
**Question:** (a) Which AWS account/organization should host Portico, and when may we create paid resources? (b) Primary region: Mumbai (`ap-south-1`, lowest latency to the Maldives, our default), UAE (`me-central-1`) or Singapore (`ap-southeast-1`)?
**Default we are proceeding with:** `ap-south-1` primary, cell-based design so EU/US/GCC regions can be added; zero deployed resources until you authorize.
**If the answer differs:** variable change in Terraform.
**Blocks:** any hosted demo/staging environment. Local and CI development continue.
**Raised by / date:** orchestrator, 2026-11-07

### Q20 — Engage professional advisers (Maldives tax/legal, US counsel)    Status: open
**Context:** Only the TGST rate (17% from 1 Jul 2025) and green-tax rates ($12/$6 per guest-night) have dated sources. Whether TGST applies to service charge, the Employment Act service-charge rules, MIRA tax-invoice contents and currency, filing formats, guest-registration/reporting duties, MMA foreign-exchange rules and record-retention periods are unconfirmed. Monoclay's own position (Maldives withholding or GST on SaaS fees paid by Maldivian hotels; any effect of the founder's Maldives residence) is also unresolved. Customer contracts and the DPA need counsel review. See `docs/readiness/market-matrix.md` §2.12 and `business-documents-register.md`.
**Question:** May we obtain quotes and engage (a) a Maldives tax/legal adviser and (b) US counsel for the customer contract set and DPA — and what budget ceiling applies?
**Default we are proceeding with:** no engagement and no spend; the tax engine keeps rules as effective-dated data labelled "unconfirmed"; demo invoices are labelled as samples; question lists are ready for the advisers.
**If the answer differs:** none for engineering; only the pilot date moves.
**Blocks:** live invoices and tax reports for any Maldives hotel; signing a pilot agreement (launch Gate 3). Development is not blocked.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q21 — Support promise for the first pilot                        Status: open
**Context:** Hosting the application around the clock does not mean 24/7 support exists. With the founder as the only operator, a 24/7 promise cannot be honestly met. Support terms appear in the pilot agreement and SLA. See `docs/readiness/support-recovery-plan.md` §1 and `cost-model.md` §8.
**Question:** What support coverage will Monoclay promise the pilot hotel (hours in Maldives time, out-of-hours handling of P1 incidents, contact channels)?
**Default we are proceeding with:** named contact; agreed business hours in Maldives time; P1 acknowledged within 30 minutes during those hours and best effort outside them; no 24/7 claim anywhere; availability numbers published only as targets.
**If the answer differs:** staffing and on-call cost change (cost model §8); the SLA document changes.
**Blocks:** the pilot agreement and the SLA (Gate 3). Runbooks and tooling proceed.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q22 — Pre-pilot spending ceiling and hosted demo                 Status: open
**Context:** The demo runs at about $0 locally. A hosted demo (for showing hotels remotely) costs roughly $10–30/month (estimate) and needs an AWS account (Q4). AWS has no native hard spending cap; budget alerts and automated actions only approximate one. Paid AI in demos must be capped.
**Question:** What monthly ceiling may pre-pilot spending reach (hosted demo, domain, AI calls in demos), and may we create a hosted demo once Q4 is answered?
**Default we are proceeding with:** $0 incremental spend; local demo only; AI in demo off or replayed from fixtures; no domain purchase until Q1.
**If the answer differs:** we add a budget alarm plus an automated stop action at the approved ceiling and deploy the single-instance demo.
**Blocks:** remote demos to prospective pilot hotels. Nothing in development.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q23 — When to activate Channex production                       Status: open
**Context:** Channex staging is free. Production carries a $130/month platform fee plus $7 per property with an active channel (owner baseline, 7 Nov 2026), and the platform fee should be assumed to continue even with no connected properties. Production also requires certification and a contract (SLA, exit, PCI split, DPA terms still unknown).
**Question:** Confirm that Channex production is activated only once a named pilot hotel has signed and wants Portico to manage its OTA connections, after the contract terms have been reviewed.
**Default we are proceeding with:** staging only; certification work happens in staging; production is not activated before a signed pilot needs it; pilots may keep their current channel manager while Portico does not control inventory.
**If the answer differs:** an earlier activation adds about $130/month or more with no hotel benefit.
**Blocks:** live managed OTA distribution only.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q24 — Security assurance roadmap (SOC 2, ISO 27001, PCI service-provider validation)    Status: open
**Context:** Groups and enterprise buyers commonly ask for SOC 2 Type II and/or ISO 27001 and a PCI service-provider attestation. These are not legal requirements, not interchangeable, and cost real money (research estimate about $100–250k/year for a full programme; quote required). Booking.com direct connectivity expects PCI compliance. See `docs/readiness/certification-approval-matrix.md`.
**Question:** At what trigger should Monoclay fund formal assurance — for example, the first group or enterprise prospect that requires it, or before any paid pilot?
**Default we are proceeding with:** no formal programme before the pilot; build controls and evidence so they are audit-ready; an independent penetration test before live guest data (quote required); confirm the PCI validation requirement with the chosen PSP/acquirer.
**If the answer differs:** auditor or QSA engagement and policy work start earlier, at extra cost.
**Blocks:** enterprise/group sales that require reports. Nothing in development.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q25 — AI processing of hotel guest data                         Status: open
**Context:** AI features (cited answers, summaries, drafts, translation) send hotel data to a model provider (Anthropic directly, or Claude on Amazon Bedrock inside the AWS account). That requires provider data-processing terms, an addition to the sub-processor list, and hotel authorization. The Claude development subscription does not pay for in-product AI.
**Question:** Which route is preferred (Anthropic API vs Amazon Bedrock), and may AI process guest personal data for hotels that opt in?
**Default we are proceeding with:** AI is off by default for every live property; when a hotel enables it, the data sent is minimised (never card data or identity documents); per-tenant spend caps; all critical workflows keep working without AI; AI is developed against demo data only until this is answered.
**If the answer differs:** adapter choice and DPA wording change; the product design does not.
**Blocks:** AI features for live hotels only.
**Raised by / date:** operational-readiness agent, 2026-11-07

### Q26 — Profile of the first pilot property                       Status: open
**Context:** The pilot profile decides which integrations sit on the critical path. A small guesthouse or hotel on an inhabited island needs fewer integrations (often no door-lock or POS interface, a simpler green-tax class) and can run with recorded payments. A resort pilot also needs outlets and POS, meal plans, transfers and probably lock integration.
**Question:** Should we target a guesthouse or small hotel first, or a resort?
**Default we are proceeding with:** build for all segments (D4), but sequence the minimum pilot slice for a guesthouse or small hotel first (`docs/readiness/roadmap-critical-path.md` §2), with resort operations following in wave 3. The ~120-villa resort remains in the demo data.
**If the answer differs:** for a resort pilot, the resort module (wave 3a), POS posting and lock interfaces move earlier.
**Blocks:** nothing now; it shapes engineering priority and pilot outreach.
**Raised by / date:** operational-readiness agent, 2026-11-07
