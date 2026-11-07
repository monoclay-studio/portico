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
