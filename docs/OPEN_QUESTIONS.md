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

### Q1 — Final product name and brand                       Status: answered 2026-11-07 — **Portico** (D1)
**Context:** "Portico" is the repository/working name; the brief says the name is not final. The name appears in UI, emails, booking engine, API docs and legal documents.
**Question:** What is the product's public name (and is a brand/visual identity coming)?
**Default we are proceeding with:** "Portico" everywhere, sourced from one configuration constant (`PRODUCT_NAME`) and one design-token set, so renaming is a config change plus copy review.
**If the answer differs:** cosmetic rename; domain names and email sender setup would change.
**Blocks:** nothing in development. Blocks domain purchase, email sender verification, public website.
**Raised by / date:** orchestrator, 2026-11-07

### Q2 — Payment processing for Maldivian hotel legal entities    Status: open — facts verified 2026-11-07, decision pending
**Context:** You chose "hotel is merchant via Stripe Connect". Stripe is believed **not** to onboard businesses incorporated in the Maldives (to be verified from Stripe's official country list). If so, a Maldivian resort cannot be the merchant of record on a Stripe connected account, and Monoclay's US Stripe account cannot collect on its behalf (that would make Monoclay a payment intermediary — a separate regulated business).
**Question:** For Maldives hotels, are you willing to integrate local acquirers/gateways (e.g. Bank of Maldives "BML Connect", MIB, other) and/or allow hotels to use processors they already have — with Stripe Connect used where hotels' legal entities are eligible (e.g. groups with entities in supported countries)?
**Default we are proceeding with:** provider-agnostic payment domain; a full **simulator** provider for development and demo; a Stripe Connect adapter (direct charges) built and sandbox-tested; local-acquirer adapters researched and added to the dependency register as "quote required / unverified".
**If the answer differs:** only the adapter priority changes; the payment domain is unaffected.
**Blocks:** live guest payments for a Maldives pilot. Nothing in development.
**Update 2026-11-07 (verified on stripe.com/global and docs.stripe.com):** the Maldives is not a Stripe-supported country; Connect cross-border payouts work only between the US, UK, EEA, Canada and Switzerland; accounts under a recipient service agreement cannot process payments. Owner confirmed Monoclay LLC (Delaware, Stripe Atlas) runs Portico (D10) — its Stripe account serves Portico's SaaS billing and Connect for eligible (non-Maldivian) hotel entities. For Maldivian hotels the remaining decision is: **which local gateway(s) to integrate first** (e.g. Bank of Maldives' BML Connect) — until then, hotels use their own terminal and Portico records and reconciles (Route D, being built).
**Raised by / date:** orchestrator, 2026-11-07

### Q3 — Commercial plans and prices                         Status: open — owner will set prices after seeing costs (D11)
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

### Q40 — Billing-rule precedence and a third-party patent application   Status: open
**Context:** Research 01 (§6.5, §9 item 3) notes that Agilysys holds US patent application 2017/0124610, which describes evaluating each charge against a stay's *ranked* routing rules, assigning a destination folio, and processing the charge per that folio's payment method. The research recommends a freedom-to-operate check before copying the claimed mechanism. We have not reviewed the claims, their current status (granted, abandoned, expired) or territorial scope, and we draw **no legal conclusion**.
**Question:** Will you have qualified patent counsel review this application (status, claims, territories, design-around options) before we design ranked/prioritized billing-rule precedence?
**Default we are proceeding with:** `finance` billing rules have **no rank or priority field**. Rules on the same folio owner may not overlap (configuration rejects an overlapping rule and explains which rule it collides with); a charge that matches no rule goes to the owner's default folio; a rule's cap overflow goes to the default folio. Manual transfers and previewed retroactive re-application are supported. See `docs/specs/finance.md` §3.4.
**If the answer differs:** if counsel clears ranked precedence or advises a design-around, precedence is an additive change to `finance` (medium effort, no data migration of existing rules).
**Blocks:** ranked/overlapping billing-rule precedence only. Finance wave 1 proceeds.
**Raised by / date:** product strategy, 2026-11-07

### Q41 — Maldives tax and fee computation details               Status: open
**Context:** Research 04 verified TGST 17% (from 1 Jul 2025) and Green Tax of $12 / $6 per person-night by property class. It did **not** verify: the legal treatment of the customary 10% service charge; whether TGST is computed on price + service charge; whether Green Tax is itself subject to TGST or service charge; exemptions (children by age, long stays, residents/work-permit holders, transit nights); rounding; the MVR conversion rate source for returns; MIRA invoice content and numbering requirements.
**Question:** Can you obtain MIRA guidance or a Maldivian tax adviser's confirmation of computation order, exemptions, rounding and invoice requirements, so the Maldives rule pack can be marked *verified*?
**Default we are proceeding with:** the Maldives rule pack ships as data marked `unverified`, citing research 04: service charge 10% on taxable room and F&B net; TGST 17% on (net + service charge); Green Tax per person-night by property classification, outside the service-charge and TGST base, no child exemption; per-line half-up rounding to the currency minor unit. Admins see an "unverified rule pack" warning; a live property cannot issue invoices from an unverified pack (market launch gate).
**If the answer differs:** data change to the rule pack; no code change expected because the tax engine supports compounding bases, exemptions and rounding modes as configuration.
**Blocks:** live invoicing for a Maldives pilot. Nothing in development or demo.
**Raised by / date:** product strategy, 2026-11-07

### Q42 — Which tax rule applies when tax law changes between booking and stay   Status: open
**Context:** Agreed prices are snapshotted at booking and never silently rewritten. Tax rules are effective-dated data. The Maldives raised TGST from 16% to 17% on 1 Jul 2025, so bookings made before that date for stays after it existed. Whether the applicable rate follows the service date, invoice date or booking/payment date is a legal question.
**Question:** For the Maldives (and as the product default), which date determines the applicable tax rule for agreed bookings?
**Default we are proceeding with:** the rule in force on the **service date** applies. Agreed *prices* stay unchanged; for tax-exclusive agreed prices the tax line changes (the guest pays the difference); for tax-inclusive agreed prices the net changes. Before a new tax rule version is activated, admins see a change report listing affected future stays and the per-stay difference. The tax engine stores a `taxPointPolicy` per rule (`service_date` | `booking_date` | `invoice_date`) so the answer is configuration.
**If the answer differs:** configuration change only.
**Blocks:** nothing.
**Raised by / date:** product strategy, 2026-11-07

### Q43 — Maldives guest registration and tourism reporting obligations   Status: open
**Context:** The readiness brief (§11) requires validating guest-registration, identity-record and reporting obligations before declaring a market supported. Research 04 did not cover what Maldivian resorts and guesthouses must report (immigration, Ministry of Tourism statistics, other authorities), which fields, how often, or whether passport images may or must be kept.
**Question:** Which reports must a Maldivian tourist establishment submit (authority, fields, frequency, format), and what are the rules for storing passport data and images?
**Default we are proceeding with:** passport number, nationality, date of birth and document expiry are optional, field-encrypted occupant fields; document images are not stored unless the property enables it; a manual CSV export of guest-nights by nationality exists; no government submission is built (environment safety would block it anyway).
**If the answer differs:** new export formats or a submission adapter in `integration`; field requirements become property policy.
**Blocks:** Maldives market readiness sign-off. Nothing in development.
**Raised by / date:** product strategy, 2026-11-07

### Q44 — Record-retention periods for the Maldives                Status: open
**Context:** Retention schedules are per data category and per country (readiness §12). Fiscal records must outlive guest-erasure requests. We do not know the Maldivian statutory periods for tax/accounting records or identity data.
**Question:** What retention periods apply in the Maldives to accounting/tax records, invoices, guest identity data and guest communications?
**Default we are proceeding with:** configurable per property and category; placeholder defaults: ledger, folios and fiscal documents 10 years; identity-document fields erased 1 year after departure; communications 3 years; marketing data consent-bound. Erasure anonymizes non-fiscal data and locks fiscal records until their period ends.
**If the answer differs:** configuration change.
**Blocks:** privacy notice and DPA text for a Maldives pilot. Nothing in development.
**Raised by / date:** product strategy, 2026-11-07

### Q45 — How usage-based third-party costs reach hotels            Status: open
**Context:** WhatsApp/SMS conversation fees and AI inference grow with each hotel's activity (readiness §14–16). Editions (`docs/product/editions.md`) meter them as `usage.messages` and `usage.aiCredits` instead of bundling them, so their cost never silently becomes Monoclay's.
**Question:** Should usage-based third-party costs be passed through at cost, marked up, or included as an allowance per edition?
**Default we are proceeding with:** metered per organization, visible to hotel admins in real time, with hard caps (0 in demo; set by the admin in live; budget notifications distinct from caps); paid messaging and AI are off until an admin enables them; intended to be billed as pass-through line items once SaaS billing exists. No included allowance.
**If the answer differs:** billing configuration; entitlement limits for included allowances.
**Blocks:** SaaS billing configuration for usage. Nothing in development.
**Raised by / date:** product strategy, 2026-11-07

### Q46 — Default for sharing guest profiles across properties     Status: open
**Context:** Brief §7 allows cross-property sharing only within permissions and consent rules. Properties of one organization may belong to different legal entities, and the lawful basis can differ by jurisdiction (readiness §12). OPERA's chain-level sharing switch is irreversible (research 01) — we will not copy that.
**Question:** Is the default below acceptable as the product default until market-specific legal advice is obtained?
**Default we are proceeding with:** within one organization, a profile's core identity, contact data, preferences and stay history are visible to staff at other properties who hold `guests.profile.readShared`; property-private notes, alerts marked private, identity documents and payment tokens are never shared; marketing consent is recorded per legal entity; sharing can be switched off and on again per organization (reversible); nothing is ever shared across organizations.
**If the answer differs:** policy defaults change; possibly per-legal-entity partitions (medium).
**Blocks:** nothing in development; privacy documentation for multi-property pilots.
**Raised by / date:** product strategy, 2026-11-07

### Q47 — Tax treatment of Monoclay's SaaS invoices                Status: open
**Context:** `billing` issues Monoclay's own invoices to hotel organizations (Delaware company invoicing Maldivian and
other legal entities). Whether Maldivian GST or other taxes apply to imported digital services, and Monoclay's own US
tax position, need professional advice; we must not hard-code an assumption.
**Question:** What tax (if any) must appear on Monoclay's SaaS invoices to Maldivian customers (and other target
markets), and who is responsible for remitting it?
**Default we are proceeding with:** SaaS invoice tax rules are configuration marked `unverified`; no tax lines are added;
billing is not activated for live customers until this is answered.
**If the answer differs:** configuration of SaaS tax rules; possible registration obligations for Monoclay.
**Blocks:** live SaaS billing. Nothing in development.
**Raised by / date:** product strategy, 2026-11-07

### Q48 — Tax treatment of package allowances and breakage on Maldives tax invoices    Status: open
**Context:** All-inclusive and dining-credit packages include allowances (e.g. USD 100/day dining credit). Finance found that counting both the package and the food paid by the credit overstates value-before-tax, and breakage (unused credit) currently carries no separate tax.
**Question:** For the Maldives adviser — how must a TGST tax invoice present a package with an allowance, consumption against it, and breakage?
**Default we are proceeding with:** package price invoiced once; consumption shown as information only; breakage follows the tax already charged on the package (ADR-0016 §5), configurable.
**If the answer differs:** rule-pack configuration change; invoices regenerated only for future documents.
**Blocks:** live tax invoices for packages with allowances. Nothing in development.
**Raised by / date:** orchestrator (finance review), 2026-11-07

### Q60 — Packaging and pricing for standalone modules and migration services    Status: open
**Context:** The adoption brief lets hotels keep their PMS and use selected Portico capabilities (housekeeping, guest messaging, reporting, transfers — `docs/adoption/adoption-paths.md` §4). Every edition in `modules/platform/src/domain/plans.ts` is built on the full PMS core, and Essentials allows only 1 property, so a 3-property group adopting only housekeeping and messaging cannot be represented. Migration effort (rehearsals, OPERA imports) is also a cost: competitors sell reservation import separately (Cloudbeds) or include it.
**Question:** (a) Do you approve selling standalone modules as separate "connected" packages (per property or per unit, with their own limits), independent of the PMS editions? (b) Is migration of future reservations, profiles and open balances included in onboarding, or a paid service?
**Default we are proceeding with:** entitlements for standalone modules modeled as separate feature keys and limits (e.g. `standalone.housekeeping`) with prices stored as configuration and none published; migration of future reservations, profiles and open balances treated as included in onboarding for planning purposes, history migration and archive as optional.
**If the answer differs:** configuration and commercial documents change; no product rework.
**Blocks:** pricing page, quotes for Path A/B customers. Nothing in development.
**Raised by / date:** Integration & Adoption lead, 2026-11-07

### Q61 — Oracle partner access for OPERA (OHIP for OPERA Cloud; OPERA 5.x interfaces)    Status: open
**Context:** The representative group setup RS-3 (keep OPERA Cloud, adopt Portico housekeeping and messaging) and OPERA migrations need Oracle access. Research 01 found OHIP is partner-gated, the partner (Monoclay) pays usage (about US$10 per 10,000 REST calls/month and US$10 per 100,000 streamed events), and sources conflict on whether an Oracle PartnerNetwork membership is required. Streaming must be enabled per hotel environment by Oracle. OPERA 5.x interface rights (OXI or others) are unconfirmed.
**Question:** May we apply to Oracle's partner programme for OHIP (accepting partner terms and usage fees once a hotel is ready), and approach Oracle about OPERA 5.x interface/export rights?
**Default we are proceeding with:** build the OHIP connector and an OPERA-like simulator from public documentation up to R3; no application, agreement or paid usage until you authorize; OPERA migrations planned via hotel-provided exports.
**If the answer differs:** if declined, RS-3 is replaced by a Mews- or Cloudbeds-based connected group and OPERA support is limited to file-based migration.
**Blocks:** RS-3 beyond R3; any live connection to an OPERA hotel. Not blocking other work.
**Raised by / date:** Integration & Adoption lead, 2026-11-07

### Q62 — On-site local connector: support commitment and legacy interface licensing    Status: open
**Context:** Door-lock encoders, on-premise POS and OPERA 5.x cannot talk to a cloud service; they need software installed on the hotel network (`docs/adoption/rollout-requirements.md` §5). That creates obligations: updates, monitoring, incident response for equipment-dependent functions (keys at check-in), plus vendor interface licences. Some widely used legacy hotel interface protocols are owned by vendors (e.g. Oracle's PMS interface specifications); implementing a compatible interface may need a licence or partner agreement.
**Question:** (a) Will Monoclay offer and support an on-site connector for resorts, and with what support hours? (b) May we pursue vendor interface agreements (POS, door locks, OPERA interfaces) where they carry fees or contractual obligations?
**Default we are proceeding with:** design and build the local connector to R3 with business-hours support assumed; implement only interfaces whose documentation and usage terms we can verify; no vendor agreements signed; manual alternatives (encode keys in the lock vendor's software, manual POS posting lists) documented for pilots.
**If the answer differs:** if no on-site connector, resorts with on-premise locks/POS must use cloud-native vendors or manual alternatives; RS-2 scope shrinks.
**Blocks:** RS-2 live key issuance and POS posting beyond R4. Not blocking cloud-only setups.
**Raised by / date:** Integration & Adoption lead, 2026-11-07

### Q63 — Trial data governance: retention, roles, and real AI on copied hotel data    Status: open
**Context:** Trials hold an authorized copy of a hotel's data in an isolated organization (`docs/adoption/evaluation-and-trial.md`). We need defaults for how long copied data is kept, whether Monoclay acts as the hotel's processor for trial copies, and whether trials may use real (paid) AI over copied guest data — today the environment policy simulates AI in trials.
**Question:** Approve (a) trial expiry after 60 days of inactivity with deletion within 7 days of request (backups aging out per the backup policy), (b) Monoclay acting as processor under the hotel's data processing terms for trial copies, subject to professional review, and (c) keeping AI simulated in trials (or allowing real AI with a per-trial spending cap).
**Default we are proceeding with:** (a) and (b) as stated, pending legal review of the processing terms; (c) AI stays simulated in trials; guest email/phone masked by default; identity documents and card data never copied.
**If the answer differs:** configuration change (retention periods, policy value for `ai.inference` in `trial`) plus cost-model update if real AI is allowed.
**Blocks:** trials with real hotel data (needs signed processing terms). Demo and sample-data work proceed.
**Raised by / date:** Integration & Adoption lead, 2026-11-07

### Q64 — Discovery with Maldivian hotels to confirm the systems they actually use    Status: open
**Context:** Integration priorities must follow the systems our target customers use (adoption brief §5), not logo counts. This session could not verify which PMS, POS, accounting, payment acquirers, door locks and messaging tools Maldivian guesthouses and resorts use (web research budget exhausted; vendor hosts unreachable), so P0/P1 tiers for RS-1 and RS-2 rest partly on labeled assumptions (`docs/adoption/integration-coverage-matrix.md` §2).
**Question:** Can you arrange 5–10 short discovery conversations (or a questionnaire) with Maldivian guesthouses and resorts — and, if possible, identify a candidate pilot property — so we can confirm their systems, versions, contracts and pain points?
**Default we are proceeding with:** build the vendor-neutral pieces first (Portico POS posting API, journal file export, CSV and OPERA importers, Channex hub, email/WhatsApp); defer vendor-specific POS, ERP, lock and acquirer connectors until discovery confirms them.
**If the answer differs:** priorities in the coverage matrix and roadmap are re-ranked; no completed work is lost.
**Blocks:** choosing the RS-2 POS/ERP/lock vendors; any readiness level above R6 (needs a named hotel).
**Raised by / date:** Integration & Adoption lead, 2026-11-07

### Q80 — Door-lock vendor partner programmes and key issuance for pilots    Status: open
**Context:** The guest-journey audit found no module for keys (`docs/journey/gap-register.md` JG-01; new spec `docs/specs/access.md`). Issuing keys from Portico requires each lock vendor's PMS interface or cloud API (ASSA ABLOY Vostio/Visionline, Salto Space, dormakaba Ambiance and others), usually under a partner agreement, an SDK or interface licence and sometimes per-door or per-key fees paid by the hotel; on-premise lock servers also need the local connector (Q62). Which systems Maldivian resorts use is unconfirmed (Q64).
**Question:** May we apply to lock vendors' partner programmes (accepting NDAs and, once a hotel is ready, interface fees that the hotel or Monoclay pays), and which vendor should be first once discovery names the pilot's lock system?
**Default we are proceeding with:** build the vendor-neutral `access` module with the **manual key log**, mechanical-key register, key rules for room moves/extensions/checkout and a lock **simulator** (all usable at a pilot without any vendor agreement); no partner applications or agreements; first vendor chosen after Q64 discovery.
**If the answer differs:** declining keeps key issuance manual (encode in the lock vendor's software, record in Portico) — acceptable for a pilot but weaker at check-in; approving moves one lock connector into wave 3.
**Blocks:** live key issuance from Portico (R4+ for any lock vendor). Not blocking the pilot (manual path) or development.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q81 — Tour-operator contracting in the first pilot slice    Status: open
**Context:** Maldivian resorts (and many guesthouses selling through Malé DMCs) are believed to earn most room nights through tour-operator contracts with seasons, net rates per market, supplements, allotments with release periods, combinable offers and stop-sales [assumption — Q64]. The specs had only net rates and simple allotments; the audit proposes a `contracting` module (`docs/specs/contracting.md`) that compiles contracts into rates and allotments and checks every tour-operator voucher against the contract. Loading contracts is labour-intensive; some vendors offer it as a service.
**Question:** (a) Confirm that contracting belongs in the first pilot slice (it moves contracts, offers, allotments and the contract check into wave 2 and pushes other wave-2 items back); (b) should Monoclay offer contract loading as an onboarding service, and on what terms?
**Default we are proceeding with:** contracting is P0 for any resort pilot and for guesthouses that sell through DMCs; wave 2 includes contracts, offers with combinability, allotments/release, stop-sale notices and the contract check; statements and rate sheets in wave 3; contract loading is done by the hotel in Portico with Monoclay guidance, no paid service defined.
**If the answer differs:** if not in the pilot slice, the pilot must be a property with little tour-operator business (or accept manual pricing of vouchers, a known source of errors); a loading service changes onboarding cost and the cost model.
**Blocks:** a resort pilot's pricing accuracy for tour-operator bookings. Development proceeds on the default.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q82 — Review platforms: access, the paid reviews add-on and publishing replies    Status: open
**Context:** Answering OTA, Google and TripAdvisor reviews from Portico (`docs/specs/crm-marketing.md` §3.4) needs the channel hub's messaging-and-reviews add-on (planning baseline +US$7 per property per month, readiness brief §5, per-channel support unverified) and API access from Google (Business Profile) and TripAdvisor, each with its own terms. Publishing a reply is a public statement on the hotel's behalf.
**Question:** May we (a) enable the hub's reviews add-on for pilot properties at that cost, (b) apply for Google Business Profile and TripAdvisor API access, and (c) publish replies through APIs after staff approval?
**Default we are proceeding with:** review aggregation and reply drafting built against simulators and manual import; replies are approved in Portico and then copied to the platform by staff ("copy and open extranet"); no add-on activation or API applications.
**If the answer differs:** approving adds per-property cost (pass-through per Q45) and API publication (`reputation.publish` effect, live only with authorization).
**Blocks:** automatic review import and API reply publication. Not blocking the reputation workflow itself.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q83 — Gift vouchers: tax point, expiry rules and launch    Status: open
**Context:** Selling gift vouchers (`docs/specs/crm-marketing.md` §3.6; finance SCR-26) creates a liability on the hotel's books. The tax point for vouchers under MIRA's time-of-supply rule (earlier of invoice or payment), whether monetary and experience vouchers are treated differently, and any consumer-law limits on expiry are unverified for the Maldives and other markets.
**Question:** Can the Maldives tax/legal adviser (Q20 scope) confirm the TGST treatment of monetary and experience vouchers and any rules on voucher expiry and unredeemed balances?
**Default we are proceeding with:** vouchers are P2; built as hotel-merchant stored-value liabilities with a configurable tax point per voucher type (default: tax at redemption for monetary vouchers, at sale for experience vouchers — marked `unverified`), configurable expiry and breakage, and no live voucher sale until verified.
**If the answer differs:** configuration change of the voucher tax rule and expiry policy.
**Blocks:** live voucher sales. Nothing in development.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q84 — Guest-facing AI (automatic answers to guests)    Status: open
**Context:** Hotels increasingly use AI to answer guest questions in chat, WhatsApp and the booking engine. Portico's AI is staff-facing: drafts are suggestions a person sends (AI-R03/R04). Letting AI answer guests directly would speed replies at night but sends model output to guests without review, adds per-message AI cost, and processes guest messages with an AI provider (Q25).
**Question:** Should Portico offer automatic AI answers to guests (limited to approved property content and live tool results, never inventing availability, prices or policies), or keep AI to staff-approved drafts only?
**Default we are proceeding with:** staff-approved drafts only; no automatic guest-facing AI answers (`docs/journey/gap-register.md` JG-57, P2).
**If the answer differs:** an `ai` capability for gated auto-replies with per-property opt-in, budget caps, evaluation and an "answered by AI" label; cost model update.
**Blocks:** nothing in development.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q85 — Paid flight-status data for arrival and departure tracking    Status: open
**Context:** Seaplane transfers fly in daylight only and are scheduled around international flights; late arrivals need transit nights in Malé/Hulhumalé (`docs/journey/guest-journey-coverage.md` §1.4). Automatic flight-status updates would keep ETAs, transfers and arrival preparation current, but flight-data APIs are paid per query or per property.
**Question:** May we budget a flight-status data provider (choice after price comparison) for resort properties, passed through or included?
**Default we are proceeding with:** manual ETA updates by the transfer desk (RES-R39) and operator information; the integration workflow `flightStatus` is designed but no provider is contracted.
**If the answer differs:** a connector for one provider; cost per property in the cost model.
**Blocks:** automatic flight tracking only.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q86 — Incident, medical and security records: scope, legal duties and retention    Status: open
**Context:** The audit adds an incident/security log, minimal medical-visit records (no clinical notes) and an emergency muster list (`docs/specs/guest-services.md` §3.4–3.5). These hold sensitive personal data; Maldivian duties to notify authorities (police, Ministry of Tourism, health) after incidents, rules for keeping such records, and retention periods are unconfirmed.
**Question:** Can the Maldives adviser (Q20 scope) confirm incident-notification duties for tourist establishments and the retention rules for incident, medical and security records?
**Default we are proceeding with:** incident and medical records restricted by permission, append-only, retained 7 years by default (configurable), no clinical notes, no automatic submissions; notification fields are free text references.
**If the answer differs:** retention and field requirements change as configuration; possibly a report format for authority notifications (file, never an automatic submission without authorization).
**Blocks:** privacy notice wording for these records at a pilot. Nothing in development.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q87 — Loyalty: recognition only, or a points programme    Status: open
**Context:** Groups expect guest recognition across properties; some want a points programme. Points create a financial liability (accrual, redemption, breakage), terms and conditions, and possibly tax questions, and compete with brand programmes some hotels already belong to.
**Question:** Should Portico offer a points programme for hotel groups, or recognition tiers and benefits only?
**Default we are proceeding with:** recognition tiers and benefits (`docs/specs/crm-marketing.md` CRM-R16–R18) and capture of external programme numbers; points programme LATER and only after this answer.
**If the answer differs:** a points ledger in `finance` (liability and breakage like vouchers) and programme management in `crm` (medium effort).
**Blocks:** nothing now.
**Raised by / date:** guest-journey audit, 2026-11-07

### Q100 — Back-of-house scope, sequencing and the vision wording          Status: open
**Context:** You asked for Portico to also cover accounting, room charges, F&B, procurement and the rest of back-of-house. The brief (§12) and the vision ("No shallow clones of payroll, procurement or ERP") warn against shallow versions. Seven deep, staged modules are proposed (`docs/backofhouse/README.md`): accounting, F&B POS, procurement, stock, workforce, concessions, utilities — each coexisting with systems a hotel keeps.
**Question:** (a) Do you confirm this scope and the build order BOH-0…BOH-5? (b) Do you agree that back-of-house work starts only after the pilot slice (Q26) is green, except the small ledger contracts (BOH-0)? (c) May the vision line be reworded as in CR-01 and recorded as decision D12?
**Default we are proceeding with:** specs only; BOH-0 contract changes proposed for the next finance iteration; no back-of-house build before the pilot slice; vision unchanged until you confirm.
**If the answer differs:** a resort-first pilot moves BOH-1 (POS) into wave 3; dropping modules removes specs, no rework elsewhere.
**Blocks:** engineering capacity planning for wave 4. Nothing in the pilot slice.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q101 — Payroll: integrate (export) or build                          Status: open
**Context:** Payroll gross-to-net in the Maldives involves employee withholding tax (MIRA 601, monthly by the 15th, computed after pension contributions), pension (7% employer / 7% employee), multi-currency pay and annual reconciliations; groups add other countries. Building it adds legal liability and requires storing salaries and bank accounts. Trade-offs: `docs/specs/workforce.md` §15.
**Question:** Do you accept that Portico does **not** compute payroll, and instead exports approved payroll inputs (hours, leave, days worked, service-charge shares) to payroll providers and checks the payroll journal that comes back?
**Default we are proceeding with:** export to payroll providers; revisit only if discovery (Q64) shows Maldivian hotels lack adequate payroll providers.
**If the answer differs:** a "Maldives payroll pack" becomes a new module with adviser sign-off (several months), plus the IDN-R13 change in Q102 widened to salaries and bank accounts.
**Blocks:** nothing now.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q102 — Pay-related data in Portico (identity rule IDN-R13)          Status: open
**Context:** IDN-R13 says "salary-like data never stored". Service-charge distribution is computed in Portico from the ledger, so per-employee shares and days worked exist in Portico. Labour forecasting uses department cost bands, not individual salaries.
**Question:** May Portico store per-employee service-charge shares and days worked (field-restricted, audited per read), while never storing individual salaries or salary bank accounts?
**Default we are proceeding with:** yes as described, behind `workforce.serviceCharge.readIndividual` ⚑; no salaries or bank accounts (CR-21).
**If the answer differs:** service-charge runs are computed and exported without persisting per-employee lines (weaker audit evidence for the Labour Relations Authority) or the feature is dropped.
**Blocks:** workforce service-charge build (BOH-4).
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q103 — Service-charge distribution rules and payout currency           Status: open
**Context:** Found via search-indexed sources (2026-11-07): tourism businesses levy at least 10% service charge; the Regulation on Service Charge (2021/R-41) allows at most a 1% administrative deduction from the service charge collected per month; a law-firm guide describes shares by days worked (paid leave and holidays counted), while press reports describe equal distribution; distribution is due before the end of the following month. An Employment Act amendment requiring payment in the currency collected was accepted by Parliament in April 2026 and sent to committee; enactment was not found. Some resort groups pay in MVR since January 2026. Sources in `docs/specs/workforce.md`.
**Question:** With a Maldivian adviser: (a) posted (levied) or collected basis? (b) days-worked or equal shares? (c) are temporary/agency staff eligible? (d) which payout currency may a hotel choose today, and with what employee consent?
**Default we are proceeding with:** rules as data marked `unverified`; posted basis with the collected basis computed alongside; days-worked shares; deduction ≤ 1%; pools per collection currency, paid in the collection currency unless the property records another policy with consent.
**If the answer differs:** rule-pack data change; no code change expected.
**Blocks:** live use of service-charge runs. Development proceeds.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q104 — Concession partners: agent or principal, tax and invoice presentation   Status: open
**Context:** Dive centres, spas and boutiques run by partners charge guests to the villa bill. If the hotel collects as **agent**, the amounts are a liability to the partner and the partner reports its own TGST; if the hotel is **principal**, they are hotel revenue and the partner invoices the hotel. The guest invoice wording and the MIRA 206 treatment differ.
**Question:** Which model(s) must Portico support for Maldivian resorts, and how must agent collections appear on the hotel's tax invoice and return?
**Default we are proceeding with:** agent model by default (liability "due to concessionaire", separate invoice section naming the partner and its TIN), principal model as an option; marked `unverified`.
**If the answer differs:** charge-code mapping and invoice template change (configuration and template work).
**Blocks:** live concession settlements.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q105 — USALI materials and wording                                     Status: open
**Context:** The chart-of-accounts templates and statements follow the publicly described USALI 12th Revised Edition structure (effective 1 January 2026, new sustainability and all-inclusive sections). Line-level definitions and the revenue and expense dictionary are HFTP publications. Claiming compliance without them would breach the no-unsupported-claims rule.
**Question:** May Monoclay buy the USALI 12th Revised Edition (and, if useful, the HFTP dictionary subscription), and do you accept the wording "USALI-aligned" (never "USALI-compliant") until an accountant has reviewed the templates?
**Default we are proceeding with:** no purchase; "USALI-aligned" wording; templates built from public descriptions and labelled for review.
**If the answer differs:** a small purchase (quote required); template detail improves; claims still need review.
**Blocks:** detailed line mapping and the sustainability section; nothing else.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q106 — Maldives back-of-house items for the tax/legal adviser (extends Q20)   Status: open
**Context:** Back-of-house adds questions the adviser list (Q20, Q41) does not yet contain.
**Question:** Please add to the adviser engagement: (1) input-tax and import-GST recovery for tourism-sector registrants and the boxes of MIRA 206/205; (2) withholding tax on payments to non-residents (e.g. foreign OTA commissions, foreign suppliers); (3) whether per-device receipt series and receipt issue after an offline sale (within 3 days) satisfy tax-invoice rules; (4) GST on staff purchases and staff meals; (5) GST on utility and housing recharges to partners; (6) employment rule pack values (hours, Ramadan hours, rest days, leave types); (7) statutory financial-statement presentation; (8) halal/alcohol import permits and alcohol sale limits by establishment type.
**Default we are proceeding with:** all as data marked `unverified`; live issuance and return filing from Portico data blocked until verified.
**If the answer differs:** data changes in rule packs and templates.
**Blocks:** live use of the affected features in the Maldives. Development proceeds.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q107 — Bank statements and supplier payment instructions with Maldivian banks   Status: open
**Context:** Bank reconciliation and payment runs need statement files and payment-instruction formats from the hotel's banks (e.g. BML, MIB). Formats and any APIs are unverified. Portico never moves money; it prepares instructions the bank executes.
**Question:** May we ask Maldivian banks (with a pilot hotel's consent) for statement export formats (CSV/MT940/CAMT.053) and bulk-payment file formats, and later evaluate statement feeds or payment APIs (which would need bank agreements)?
**Default we are proceeding with:** generic CSV statement import with mapping profiles and a generic payment CSV; no bank contact or agreement; payment files watermarked outside live.
**If the answer differs:** bank-specific profiles added; an API path would add a `bank.payment` effect and a dependency-register entry.
**Blocks:** bank-specific formats only.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q108 — POS hardware and on-site support                               Status: open
**Context:** Portico POS runs in the browser on tablets with offline operation, but outlets also need printers, KDS screens, cash drawers and sometimes an on-site outlet hub (a local connector) for kitchens that must keep working when the internet drops. That creates support duties similar to Q62.
**Question:** (a) Does Monoclay support a tested hardware list (hotel buys the hardware, Monoclay never resells)? (b) What support hours apply to POS incidents at night (bars, dinner service)?
**Default we are proceeding with:** hotel-procured hardware; a short tested list with evidence; business-hours support assumed (as Q21/Q62); documented manual fallbacks; no resale.
**If the answer differs:** hardware partnership or resale changes the commercial model and support costs.
**Blocks:** a live POS pilot (R7+). Development proceeds.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q109 — Packaging of back-of-house modules                             Status: open
**Context:** New entitlement keys are proposed (CR-29) for accounting, POS, procurement, stock, workforce, concessions and utilities, including a "Guesthouse books" add-on and Connect packs SM-11…SM-15 for hotels keeping their PMS.
**Question:** Approve the packaging approach (add-ons in Essentials/Professional, POS included in Resort, all included in Enterprise, Connect packs), with prices set later (Q3)?
**Default we are proceeding with:** keys and packaging as configuration; no prices; never gate ERP export, offline POS, environment safety or audit.
**If the answer differs:** configuration change only.
**Blocks:** pricing page and quotes; nothing in development.
**Raised by / date:** back-of-house product architect, 2026-11-07

### Q120 — Guest self-service in the first release (online check-in, booking-engine content, online check-out)    Status: open
**Context:** The front-cluster parity matrices (`docs/parity/reservations.md`, `distribution.md`) show that every modern competitor offers online check-in, online check-out and a booking engine with unit photos and descriptions. In Portico these sit in the "guest journey, later wave" and are in no spec yet (PAR-RES-083, PAR-RES-099, PAR-DST-042). For Maldives resorts, pre-arrival collection of flight details also drives seaplane transfer planning.
**Question:** Should online check-in (details, ID, arrival flight, signature, payment) and booking-engine content be part of the pilot scope, or stay in a later wave?
**Default we are proceeding with:** treat online check-in and booking-engine content as P0 for competitiveness; specify them in the guest-journey specs so they feed the existing check-in checklist (RES-R24) and booking engine (DST-R16); build after the desk workflows they depend on. A pilot can start without them if the hotel accepts that.
**If the answer differs:** if deferred, the pilot hotel collects arrival details by e-mail/WhatsApp and keeps its current booking engine; no rework of core modules.
**Blocks:** nothing in wave 1 core work; blocks the guest-journey wave plan and pilot scope.
**Raised by / date:** parity researcher (front cluster), 2026-11-07

### Q121 — How Maldives resorts contract with tour operators (allotment, free sale, stop-sale)    Status: open
**Context:** GRP-R11 covers allotments with release days. Tour-operator practice also includes free-sale contracts (sell until a stop-sale notice), stop-sale/release notices, and bookings confirmed by e-mail rather than through a channel (PAR-GRP-052/053, PAR-DST-034). These facts should come from real resorts (see Q64).
**Question:** In discovery, can we confirm which contract forms the target resorts use with tour operators/DMCs (allotment, free sale, commitment/guarantee), how stop-sales are sent today, and how tour-operator bookings arrive (channel, extranet, e-mail)?
**Default we are proceeding with:** support allotment, free-sale and commitment contracts, a stop-sale notice log with acknowledgements, and e-mail bookings turned into draft bookings for staff review (never auto-confirmed).
**If the answer differs:** free-sale or e-mail intake may drop in priority; allotment support is unaffected.
**Blocks:** final priority of GRP-R11 extensions; nothing in wave 1.
**Raised by / date:** parity researcher (front cluster), 2026-11-07

### Q122 — What we promise about working through an island internet outage    Status: open
**Context:** Island connectivity drops. The vision promises "offline-honest" operation; the staff PWA is offline-first (OPS-R21–R23), but the desk web app is not, and no spec covers check-in/check-out during an outage (EC-RES-046). Offline writes for reservations and money are costly and risky; a read-only continuity snapshot plus late entry is cheap and safe.
**Question:** For the pilot, is a read-only continuity snapshot (arrivals, assignments, balances, in-house list) plus labelled late entry of what happened during the outage an acceptable promise, or must the desk be able to check guests in and out offline?
**Default we are proceeding with:** read-only continuity snapshot available offline on desk devices, and late entry of actions with original times labelled "entered late"; no offline writes to reservations or money in wave 1.
**If the answer differs:** offline desk writes need a conflict-resolution design for reservations and payments (several weeks of work) and new edge-case tests.
**Blocks:** nothing now; affects the pilot readiness checklist and what sales may promise.
**Raised by / date:** parity researcher (front cluster), 2026-11-07

### Q123 — GDS distribution through an intermediary    Status: open
**Context:** OPERA and SiteMinder offer GDS distribution (Sabre, Amadeus, Travelport) through a CRS/intermediary; it needs a commercial contract and per-booking fees (PAR-DST-060/061). DST marks it LATER as the `distribution.gds` add-on. Corporate and MICE travel to the Maldives is small compared with leisure.
**Question:** Is GDS distribution needed for the first target customers, and if so through which intermediary?
**Default we are proceeding with:** no GDS work before a customer asks; keep the data model GDS-ready (rate codes, commission, IATA numbers on agencies).
**If the answer differs:** a GDS connection is an intermediary integration plus contract work, priced separately; no change to core modules.
**Blocks:** nothing.
**Raised by / date:** parity researcher (front cluster), 2026-11-07

### Q124 — Which Maldives taxes OTAs collect in prepaid bookings    Status: open
**Context:** For OTA-prepaid bookings, the channel may or may not include Green Tax and TGST in the amount it collects. If Portico guesses wrong, the guest is charged twice or the tax is never collected (EC-DST-016, EC-DST-017). This complements Q41 (computation details) and needs facts from hotels and the hub.
**Question:** Can discovery with pilot candidates and the chosen hub confirm, per major channel, whether Green Tax and TGST are included in channel-collected amounts or payable at the property?
**Default we are proceeding with:** per-channel configuration of which taxes the channel collects, defaulting to "Green Tax payable at property, TGST included in the channel price", with any mismatch between the channel amount and Portico's computation raised as an exception, never silently posted.
**If the answer differs:** only the per-channel defaults change.
**Blocks:** live channel activation (already gated by Q23); nothing in development.
**Raised by / date:** parity researcher (front cluster), 2026-11-07

### Q130 — Maldives foreign-exchange rules for tourism businesses          Status: open
**Context:** Resorts price in USD, take USD and MVR cash, and settle cards and bank transfers in either currency. Finance converts with a business-date rate and checks MVR conversions against the MMA reference rate (±2%, from `docs/readiness/maldives-tax-rules.md`). We have not verified whether Maldivian law or Maldives Monetary Authority rules oblige tourism businesses to convert or deposit a share of foreign-currency receipts through local banks, which rate is authoritative for accounting (MMA mid rate, bank buy/sell), or whether cash change may be given in USD.
**Question:** With the Maldivian adviser (Q20/Q106 scope): what foreign-currency obligations apply to tourism establishments (conversion/deposit duties, rate source for accounting, limits on USD cash handling and change)?
**Default we are proceeding with:** no conversion or deposit duty is modelled; FX rates are data per business date with source; MMA ±2% check marked `unverified`; cash exchange at the desk allowed with configurable limits; a rate older than the business date is used only with a visible stale-rate warning.
**If the answer differs:** policy/data changes in finance FX (FIN-R40/R41) and accounting cash management (ACC-R25); possibly a reporting export.
**Blocks:** nothing in development; live Maldives FX configuration.
**Raised by / date:** finance-cluster parity research, 2026-11-07

### Q131 — Liability for offline card and room-charge acceptance            Status: open
**Context:** Island connectivity drops. `fnb-pos` allows room charges offline up to an exposure limit (default USD 200 per stay, FNB-R20) and record-only card tenders; some acquirers offer store-and-forward offline card authorisation where the merchant carries the decline risk. These are the hotel's commercial risks, but the defaults Portico ships shape them.
**Question:** Are you comfortable shipping the default offline exposure limit (USD 200 per stay, hotel-configurable, 0 allowed) and keeping acquirer store-and-forward card acceptance off by default, enabled only by a hotel admin who acknowledges the risk in-product?
**Default we are proceeding with:** yes as described; acknowledgement recorded in the audit log; never enabled in demo/trial.
**If the answer differs:** policy default changes only.
**Blocks:** nothing in development; live POS pilot configuration.
**Raised by / date:** finance-cluster parity research, 2026-11-07

### Q132 — Unclaimed guest credits and expired deposits                      Status: open
**Context:** Finance can keep a cancelled booking's deposit "as guest credit" (FIN-R24) and folios can end with credit balances that guests never claim; receivables accounts can hold unallocated payments. Whether a hotel may recognise unclaimed balances as income after a period, must refund them, or must hold them indefinitely is a legal/tax question per market (Q83 covers vouchers only).
**Question:** What rule should the Maldives pack apply to unclaimed guest credits, retained deposits kept as credit, and unallocated receivables payments?
**Default we are proceeding with:** balances remain liabilities indefinitely; an aging report lists them with owners; release to income only by an explicit, approved journal with reason (no automatic breakage).
**If the answer differs:** a configurable expiry/breakage policy per balance type (data change plus a small Day Close/period task).
**Blocks:** nothing.
**Raised by / date:** finance-cluster parity research, 2026-11-07

