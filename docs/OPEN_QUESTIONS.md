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
