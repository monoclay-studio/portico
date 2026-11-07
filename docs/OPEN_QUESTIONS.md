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
