# External dependency register

Deliverable 2 of the operational-readiness brief (§3, §9, §14, §15). Owner: Operational Readiness lead.
Last updated: 2026-11-07. Status of every integration: **R1 Planned** (see `readiness-register.md`).

## How to read this register

Every factual claim carries one of these labels. Read the label before you rely on the claim.

| Label | Meaning |
|---|---|
| `[verified 2026-11-07]` | Checked on 7 Nov 2026 against the linked official/primary source by the research session that produced `docs/research/04-connectivity-payments-compliance.md` (R04). This readiness session could not reach external sites itself (see README, "Verification status"). |
| `[secondary, read 2026-11-07]` | Read on 7 Nov 2026 from a secondary source (vendor blog, press, review site, consultancy) per R04. Directionally useful; confirm before contracting. |
| `[owner baseline 2026-11-07]` | Figure stated in the owner's readiness brief §5 as checked on 7 Nov 2026. |
| `[reference 2026-10-06]` | Anthropic's `claude-api` reference bundled with Claude Code (pricing table cached 2026-10-06). Not re-checked against the live pricing page. |
| `[unconfirmed]` | Background knowledge or inference. **Do not rely on it** until someone checks the official source or asks the provider. |
| `[quote required]` | Price or term not published, or negotiated. **Never treat as zero.** |
| `[estimate]` | Our own arithmetic or approximation. |
| `[assumption]` | Our planning choice, not a fact. |

Pilot necessity: **P** = needed for the first controlled pilot; **O** = optional for the pilot (manual fallback exists);
**L** = needed later (other markets, enterprise, scale).

Provider claims, verified contractual terms, estimates and our assumptions are kept in separate cells. **No contract,
account, sandbox or partnership listed here exists yet** unless the "Status" row says so. As of 2026-11-07 the only
existing external relationships are Monoclay LLC's own Stripe account and Stripe Atlas formation (owner statement,
`docs/product/decisions.md` D1) and a Claude development subscription (excluded from product costs).

---

## 1. Summary table

| # | Provider / service | Category | Pilot need | Connection | Account owner | Who pays | Status 2026-11-07 | Main blocker |
|---|---|---|---|---|---|---|---|---|
| 2.1 | Stripe Connect (+ Terminal) | Guest payments | O (only if hotel entity is eligible) | Direct API | Monoclay (platform) + hotel (connected account) | Hotel pays processing; Monoclay may take an application fee | Not started; Monoclay has a Stripe account (not a Connect platform yet) | Maldivian legal entities believed **not eligible** `[unconfirmed]` (Q2) |
| 2.2 | Stripe Billing (Monoclay SaaS) | Monoclay revenue | P (to invoice a paying pilot) — manual invoice fallback | Direct API | Monoclay | Monoclay | Existing Monoclay Stripe account; Billing not configured | Commercial prices (Q3); tax position of SaaS sold to Maldives (Q20) |
| 2.3 | Adyen for Platforms | Guest payments | L | Direct API | Monoclay (platform) + hotel | Hotel / negotiated | Not started | Country coverage for Maldives `[unconfirmed]`; commercial minimums `[quote required]` |
| 2.4 | Bank of Maldives (BML Connect, acquiring) | Guest payments (local) | O → likely P for online payments in Maldives | Direct API `[unconfirmed]` | Hotel (merchant) | Hotel | Not started | API docs, sandbox, partner terms all `[unconfirmed]` |
| 2.5 | Maldives Islamic Bank (MIB) | Guest payments (local) | O | `[unconfirmed]` | Hotel | Hotel | Not started | Gateway/API existence `[unconfirmed]` |
| 2.6 | "CBM" (owner-listed; identity to confirm) | Guest payments (local) | O | `[unconfirmed]` | Hotel | Hotel | Not started | Identity of provider and offering `[unconfirmed]` |
| 2.7 | Other Maldives payment rails (other banks' acquiring, MMA instant payments, telco wallets) | Guest payments (local) | L | `[unconfirmed]` | Hotel | Hotel | Not researched (sources unreachable) | Everything `[unconfirmed]` |
| 2.8 | Standalone terminal + manual recording | Guest payments fallback | **P (default pilot path)** | None (record only) | Hotel | Hotel | Can be built without any provider | None external; reconciliation discipline |
| 2.9 | PCI vault / card proxy (Channex PCI or standalone) | Card data for OTA hotel-collect | O | Via Channex or direct | Monoclay | Monoclay `[quote required]` | Not started | Certified-partner status with Channex |
| 3.1 | Channex | Channel manager hub | P (if pilot wants OTA sync) | Direct API | Monoclay | Monoclay | Not started; free staging available `[owner baseline 2026-11-07]` | Certification, contract, hotel OTA authorization |
| 3.2 | Booking.com | OTA | P via Channex; direct = L | Via Channex | Hotel (extranet) | Hotel pays commission | Not started | Channex certification; direct partner acceptance later |
| 3.3 | Expedia Group | OTA | O via Channex; direct = L | Via Channex | Hotel | Hotel commission | Not started | Channex's Expedia certification status `[unconfirmed]` |
| 3.4 | Airbnb | OTA | O via Channex | Via Channex only (closed to new API partners `[secondary, read 2026-11-07]`) | Hotel | Hotel fees | Not started | Hub route only |
| 3.5 | Agoda | OTA | O via Channex; direct = L | Via Channex | Hotel | Hotel commission | Not started | Channex coverage depth `[unconfirmed]` |
| 3.6 | Trip.com Group | OTA | O | Via hub only | Hotel | Hotel commission | Not started | No public direct program found `[secondary, read 2026-11-07]` |
| 3.7 | Hotelbeds / bedbanks | Wholesale | O (common for Maldives resorts `[unconfirmed]`) | Via hub | Hotel (wholesale contract) | Hotel margin | Not started | Net-rate/allotment semantics; hub support `[unconfirmed]` |
| 3.8 | GDS (Sabre, Amadeus, Travelport) via CRS/switch | GDS | L | Via intermediary | Hotel / chain | Hotel per-booking fees `[quote required]` | Not started | Needs CRS partner |
| 3.9 | Google Hotel Center / free booking links | Metasearch / direct | O (high value, free to hotel) | Direct (connectivity partner) | Monoclay (partner) + hotel listing | Free for free booking links `[verified 2026-11-07]` | Not started | Price-accuracy score; partner onboarding |
| 3.10 | SiteMinder (coexistence) | Channel manager | L | Direct (partner) | Monoclay | Partner terms `[quote required]` | Not started | Only if a hotel insists on keeping SiteMinder |
| 4.1 | AWS (hosting) | Infrastructure | P | Direct | Monoclay | Monoclay | No account designated; nothing deployed (Q4) | Owner authorization for paid resources |
| 4.2 | Amazon SES | Email | P | Direct | Monoclay (sender domains per hotel optional) | Monoclay | Not started | Sandbox exit; domain (Q1) |
| 4.3 | Twilio | SMS (and optional WhatsApp) | O | Direct | Monoclay or hotel `[assumption: hotel-paid pass-through]` | `[quote required]` per country | Not started | Maldives sender rules `[unconfirmed]` |
| 4.4 | Meta WhatsApp Cloud API | Messaging | O (high value in Maldives `[unconfirmed]`) | Direct | Hotel's own WhatsApp Business Account `[assumption]` | Hotel `[assumption]` | Not started | Business verification, template approval, Tech Provider status |
| 4.5 | Push (APNs, FCM, Web Push) | Staff notifications | O | Direct | Monoclay | Free `[unconfirmed]` | Not started | Apple developer account for iOS (later) |
| 5.1 | Anthropic Claude API | AI | O (product must work without AI) | Direct or via Amazon Bedrock | Monoclay | Monoclay (usage) | Not started for product use; dev subscription is excluded | Data-processing terms; spend caps |
| 5.2 | Translation (Claude, Amazon Translate, DeepL, Google) | Language | O | Direct | Monoclay | Monoclay | Not started | Dhivehi support `[unconfirmed]` |
| 6.1 | Door locks (ASSA ABLOY Vostio/Visionline, dormakaba, Salto) | Hardware integration | O (lock system's own software is the fallback) | Vendor SDK / API / on-prem gateway | Hotel (system) + Monoclay (partner agreement) | `[quote required]` | Not started | Partner agreements; model/firmware compatibility |
| 6.2 | POS (Oracle Simphony, Lightspeed, Toast, Agilysys, local) | Outlet charges | O (manual posting fallback) | Vendor API / interface | Hotel | `[quote required]` | Not started | Partner programs; on-prem interfaces |
| 6.3 | Accounting / ERP (Xero, QuickBooks, NetSuite, SAP) | Finance export | O (CSV/GL export fallback) | API | Hotel | Hotel licences; partner fees `[unconfirmed]` | Not started | App partner terms |
| 6.4 | Salesforce | CRM | L | API | Hotel's org | Hotel licences | Not started | Only for groups that use it |
| 6.5 | Identity / document verification | Guest registration | L | API / SDK / scanner | Monoclay or hotel | `[quote required]` | Not started | Privacy design; per-check pricing |
| 6.6 | Fiscal / e-invoicing middleware (fiskaly, fiscaltrust, Invopop) | Fiscal compliance | L (no Maldives fiscal device requirement identified `[unconfirmed]`) | API | Monoclay | `[quote required]` | Not started | Only for EU/other fiscal markets |
| 6.7 | Revenue management (IDeaS, Duetto, Atomize/Mews RMS) | Pricing | L | Partner API | Hotel (RMS licence) + Monoclay (partner) | Hotel | Not started | Partner certification; Atomize is owned by Mews (competitor) |
| 6.8 | Oracle OHIP (OPERA Cloud source/coexistence) | Migration source | O (only for OPERA Cloud migrations) | API (partner) | Monoclay partner + hotel environment approval | Partner pays usage `[verified 2026-11-07]` | Not started | Partner access route conflicting in sources |
| 6.9 | Transport operators (seaplane, domestic air, speedboat) | Resort transfers | O | None known (email/manual manifests) `[unconfirmed]` | Hotel | Hotel | Not started | No known API |
| 6.10 | Government portals (MIRA, Ministry of Tourism, Immigration) | Tax filing / reporting | O (hotel files manually; Portico produces reports) | None (manual) `[unconfirmed]` | Hotel | — | Not started | Requirements unconfirmed (see market matrix) |
| 7.1 | Monitoring and on-call (Sentry, uptime/status page, paging) | Operations | P | SaaS | Monoclay | Monoclay | Not started | Plan choice; data location of error payloads |
| 7.2 | Support desk tooling | Operations | P (email inbox is the minimum) | SaaS | Monoclay | Monoclay | Not started | None |
| 7.3 | Development tooling (GitHub, CI) | Engineering | — (existing) | SaaS | Monoclay | Monoclay (existing; excluded if already paid) | Repository exists (`monoclay-studio/portico`) | None |

---

## 2. Payments

> Design rule (owner decision D2, CLAUDE.md §4.14): the **hotel legal entity is the merchant of record** for guest
> money. No code path moves guest funds through Monoclay. The payment domain is provider-agnostic. Monoclay's US
> incorporation and Stripe account **do not** make a Maldivian hotel eligible for any processor, and do not make
> Monoclay eligible to collect on a hotel's behalf (readiness brief §1, §7).

### 2.1 Stripe Connect (guest payments; hotel as merchant) — includes Stripe Terminal

| Field | Detail |
|---|---|
| Purpose & workflows | Card-on-file, deposits, booking-engine checkout, payment links, pre-authorization/incremental/capture, no-show charges, refunds, disputes, payouts, terminals. Modules: `payments`, `finance`, `reservations`, booking engine. |
| Pilot necessity | **O** — usable only if the pilot hotel's operating legal entity is incorporated in a Stripe-supported country. For a Maldivian legal entity, plan as **unavailable** until verified (Q2). |
| Connection | Direct API (Stripe Connect). Charge type: **direct charges** on the connected account so disputes debit the hotel, not Monoclay. Destination charges (even with `on_behalf_of`) debit the **platform** for disputes `[verified 2026-11-07]` ([Stripe charges](https://docs.stripe.com/connect/charges), [destination charges](https://docs.stripe.com/docs/connect/destination-charges)). |
| Supported countries / capabilities | **Maldives as a country where businesses can open Stripe accounts: not on Stripe's supported list to our knowledge `[unconfirmed]`** — stripe.com/global could not be fetched in this session. Connected accounts need the `card_payments` capability for direct charges `[verified 2026-11-07]`. Stripe also offers "cross-border payouts" for platforms, where recipients in additional countries receive transfers but **do not process payments themselves**, which makes the platform the settlement merchant `[unconfirmed]` — this is **incompatible with D2** (it would put guest money through Monoclay) regardless of whether the Maldives is on that list. Lodging extended authorizations up to ~30 days by scheme `[verified 2026-11-07]` ([extended authorization](https://docs.stripe.com/payments/extended-authorization)). |
| API eligibility & application | Monoclay must enable Connect on its account and complete a platform profile; Stripe reviews platform use cases `[unconfirmed]`. Account "controller properties" replace Standard/Express/Custom: recommended `losses.payments=stripe`, `fees.payer=account` (Stripe-owned loss liability) `[verified 2026-11-07]` ([controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties), [changelog 2026-06-24](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v1-stripe-owned-pricing-negative-balance-liability)). |
| Sandbox | Test mode and sandboxes with test cards; simulated Terminal readers `[unconfirmed]` (R04 tags as inference). No charge for test mode `[unconfirmed]`. |
| Production access | Connected account onboarding (KYC/KYB) by Stripe for each hotel entity; Stripe may restrict lodging/travel or require reserves for prepaid future stays `[unconfirmed]`. |
| Certification / review / contract | Stripe Connect Platform Agreement (Monoclay) + Stripe Connected Account Agreement accepted by each hotel `[unconfirmed]`. PCI: hotels on Stripe-hosted fields can aim for SAQ A; Monoclay as service provider (see certification matrix). |
| Hotel authorization & credentials | Hotel completes Stripe onboarding (hosted), authorizes Monoclay platform access. No hotel secret keys stored by Portico (platform keys + connected account ID) `[assumption]`. |
| Account owner / who pays | Platform account: Monoclay. Connected account: hotel. With `fees.payer=account`, Stripe bills processing fees to the hotel `[verified 2026-11-07]`; Monoclay may add an `application_fee_amount` `[verified 2026-11-07]`. |
| Charges | Processing fees per connected account's country pricing `[unconfirmed]`. Platform pricing when the platform pays fees historically included per-active-account and per-payout fees `[unconfirmed]` (R04 flagged for verification). Terminal hardware purchase per country `[unconfirmed]`. **No fee assumed to be zero.** |
| Billing start / minimum | No minimum known `[unconfirmed]`. |
| Hardware / other vendor dependencies | Stripe Terminal readers are country-specific; availability in the Maldives `[unconfirmed — assume unavailable]`. |
| Limits / SLA / support | API rate limits per account `[unconfirmed]`; idempotency keys may be purged after 24 h, POST only `[verified 2026-11-07]` ([idempotency](https://docs.stripe.com/api/idempotent_requests)). No contractual SLA for standard accounts `[unconfirmed]`. |
| Outage / suspension / termination | Outage: card collection unavailable → fall back to standalone terminal + manual record (§2.8). Suspension of a hotel's connected account: payouts frozen by Stripe; Portico must show "pending verification" and route to other tender. Termination of Monoclay platform: hotels' accounts may continue as standalone Stripe accounts `[unconfirmed]`. |
| Data ownership / portability | Card tokens belong to the Stripe account they were created on; moving saved cards to another processor requires a PSP-to-PSP migration `[unconfirmed]`. Portico never stores PANs (CLAUDE.md §5). |
| Owner, status, source | Owner: Monoclay founder (commercial) + payments engineer. Status: not started. Questions: see §8.1. |

### 2.2 Stripe Billing (Monoclay's SaaS subscriptions to hotels)

| Field | Detail |
|---|---|
| Purpose | Monoclay invoices organizations for Portico editions (module `billing`). **Never mixed with guest money** (CLAUDE.md §4.14). Product-level bookkeeping: tag every Stripe object with the product code so Portico revenue is identifiable inside Monoclay (D1). |
| Pilot necessity | **P** if the pilot is paid. Fallback: manual invoice + bank transfer. |
| Connection | Direct API on Monoclay's existing Stripe account. |
| Coverage | Monoclay (US) is eligible (existing account). Collecting from Maldivian hotels: international cards and possibly bank transfers `[unconfirmed]`. |
| Charges | Stripe card processing (US pricing for domestic cards plus surcharges for international cards and currency conversion) `[unconfirmed]`; Stripe Billing usage fee as a % of billing volume `[unconfirmed]`; Stripe Tax (optional) per-transaction fee `[unconfirmed]`. Planning figure in `cost-model.md` is an `[estimate]`. |
| Tax | Whether Monoclay must register for Maldives GST on digital services, and whether a Maldivian hotel must withhold Maldivian tax on fees paid to Monoclay, is **unresolved** (Q20, market matrix §2.11). US sales-tax treatment of SaaS for US customers depends on state nexus `[unconfirmed]`. |
| Owner, status | Owner: founder (pricing, Q3) + engineering (`billing` module, wave 3). Status: Stripe account exists; Billing not configured. |

### 2.3 Adyen for Platforms

| Field | Detail |
|---|---|
| Purpose | Alternative embedded PSP for groups/terminal-heavy customers; unified tokens across card-present and online `[unconfirmed]`. |
| Pilot necessity | **L**. |
| Model | "Platform" model fits Monoclay (users sell to their own customers) `[unconfirmed]`; platform has a **liable balance account** and Adyen withdraws disputed amounts from it unless chargeback splits are configured `[verified 2026-11-07]` ([platform structure](https://docs.adyen.com/platforms/account-structure-resources/platform-structure), [marketplace payments](https://docs.adyen.com/marketplaces/process-payments.md)). High-risk categories onboard "as a payment facilitator" `[verified 2026-11-07]`. |
| Coverage | Maldives merchant onboarding `[unconfirmed — assume unavailable]`. |
| Sandbox | Test environment `[unconfirmed]`. |
| Charges / minimums | Interchange-plus style pricing and minimum volumes `[quote required]`. |
| Contract | Adyen platform agreement; sub-merchant terms for hotels `[quote required]`. |
| Owner, status | Founder. Not started. |

### 2.4 Bank of Maldives (BML) — "BML Connect" gateway and card acquiring

| Field | Detail |
|---|---|
| Purpose | Local acquiring for Maldivian hotel legal entities: online card payments (booking engine, payment links) and in-person terminals. |
| Pilot necessity | **O → likely P** for online payments by a Maldivian pilot hotel, since Stripe/Adyen are believed unavailable `[unconfirmed]`. |
| What exists | BML is believed to offer merchant acquiring (POS terminals) and an online gateway branded "BML Connect" with hosted checkout, payment links and an API `[unconfirmed]`. **No BML documentation could be read in this session.** |
| Connection | Direct API from Portico to BML with the **hotel's** merchant credentials `[assumption]`; hosted payment page so card data never touches Portico. |
| Coverage | Card schemes accepted, currencies (USD/MVR), settlement accounts, refunds/partial refunds/pre-auth support via API — all `[unconfirmed]`. |
| API eligibility | Whether a third-party software platform may integrate on behalf of many merchants, and whether a partner/aggregator agreement is needed `[unconfirmed]`. |
| Sandbox | `[unconfirmed]`. |
| Production access | Each hotel holds a BML merchant agreement; KYC by BML `[unconfirmed]`. |
| Certification | Possible integration certification/test sign-off by BML `[unconfirmed]`. |
| Hotel credentials | Hotel's gateway API keys stored in Portico's secret store (encrypted, per legal entity) `[assumption]`. |
| Who pays | Hotel pays merchant discount rate and fees to BML `[unconfirmed rates — quote required]`. |
| Terminals | BML-supplied terminals are likely standalone (not PMS-integrated) `[unconfirmed]` → manual recording (§2.8) until an integration path is confirmed. |
| Outage | Fall back to terminal or payment later; Portico shows "pending verification". |
| Data | Token/card-on-file support and portability `[unconfirmed]`. |
| Owner, status | Founder to request documentation and sandbox (questions §8.2). Not started. |

### 2.5 Maldives Islamic Bank (MIB)

| Field | Detail |
|---|---|
| Purpose / need | Alternative local acquirer. **O**. |
| What exists | Merchant services and possibly an e-commerce gateway `[unconfirmed]`. Nothing could be read this session. |
| All other fields | `[unconfirmed]` — use the BML question list (§8.2). Owner: founder. Status: not started. |

### 2.6 "CBM" (listed by the owner)

The owner listed "CBM". It may refer to Commercial Bank of Maldives (believed to be a subsidiary of Commercial Bank of
Ceylon) `[unconfirmed]`. Identity, acquiring offering, gateway and API are all `[unconfirmed]`. Action: owner to confirm
which institution was meant; then apply the §8.2 question list.

### 2.7 Other Maldives payment rails (not researched)

Other banks operating in the Maldives (e.g. branches/subsidiaries of foreign banks) may offer acquiring; the Maldives
Monetary Authority (MMA) has been reported to operate a domestic instant-payment system; telecom operators run mobile
wallets. **All `[unconfirmed]`** — none could be researched. Relevance: guesthouses with domestic guests and staff
payments; not needed for the first pilot.

### 2.8 Standalone terminal + manual recording (default pilot path)

| Field | Detail |
|---|---|
| Purpose | Guaranteed fallback and the **lowest-dependency pilot path**: the hotel takes payments on its existing bank terminal / gateway; Portico **records** the tender (method, last 4 digits optional, terminal reference, amount, currency) without processing it. |
| Pilot necessity | **P** — must exist in every deployment (also the continuity procedure for outages). |
| External dependency | None for Portico. The hotel's existing acquirer agreement. |
| Risks | Duplicate or missed recording; reconciliation is by staff against the acquirer's settlement report (Portico provides an import/matching screen). Portico must label these as "recorded, not processed". |
| Status | Can be built and demonstrated with no external account. |

### 2.9 PCI vault / card proxy (OTA-supplied cards)

| Field | Detail |
|---|---|
| Purpose | OTA hotel-collect reservations and virtual cards arrive with raw card data in reservation feeds; this is the **biggest PCI-scope risk** `[verified 2026-11-07, R04 B6]`. A proxy/vault forwards card data to the PSP so Portico stores only tokens. |
| Options | **Channex PCI**: card data returned only to certified partners, shown through a tokenised iframe, card views logged `[verified 2026-11-07]` ([Channex PCI overview](https://docs.channex.io/channex-pci/overview)); Channex "Payment Application API" charges cards through Stripe without the PMS touching card numbers `[verified 2026-11-07]` ([payment app API](https://docs.channex.io/api-v.1-documentation/payment-application-api.md)). Standalone vaults/proxies exist `[unconfirmed]`. |
| Pilot necessity | **O**. Without it, the pilot shows "card held at channel — view in OTA extranet / Channex PCI iframe" and staff charge via terminal. |
| Charges | `[quote required]`. |
| Key questions | Can Channex PCI forward to a **local acquirer** (e.g. BML) rather than Stripe? `[unconfirmed]` |

---

## 3. Distribution

> Using an intermediary simplifies our approvals but does not remove them: Channex certification, Channex's own OTA
> approvals, the hotel's OTA contracts and the hotel's authorization of the connection are **separate dependencies**
> (readiness brief §4). Hotel OTA commissions are separate from Channex fees and from Portico SaaS fees.

### 3.1 Channex (white-label channel manager API)

| Field | Detail |
|---|---|
| Purpose & workflows | ARI push (availability, rates, restrictions), booking revisions feed with acknowledgement, mapping UI, optional messaging & reviews, PCI card access. Modules: `distribution`, `reservations`, `inventory`, `rates`, `comms`. |
| Pilot necessity | **P** if the pilot hotel sells on OTAs and wants Portico to manage channels; **O** if it keeps its current channel manager during the pilot (then **no two systems may control live inventory** — readiness brief §6). |
| Connection | Direct REST/JSON API from Portico to Channex; Channex connects onward to OTAs. "Wholesale-only… never direct to hotels" `[verified 2026-11-07]` ([channex.io](https://channex.io/)). |
| Coverage | Channel list and per-channel capability depth: see `channel-capability-matrix.md` (mostly `[unconfirmed]`). |
| Pricing — planning baseline | Platform fee **$130/month**; **$7/month per property with an active channel**; optional messaging & reviews **+$7/property/month**; VAT, applicable extras and overages additional; free staging for development; production requires integration testing, certification and OTA account authorization `[owner baseline 2026-11-07]`. Volume tiers $6 at 500+, $5 at 1,000+, $4 at 2,000+ hotels; vacation rentals $0.50/unit; only properties with ≥1 active channel billed; no commission, no setup fee `[verified 2026-11-07]` ([pricing](https://channex.io/pricing.md)). **channex.io could not be re-fetched in this session; re-verify before purchasing.** |
| Charges not known | Overage definitions, size limits, certification fee (none published), cancellation terms, production billing start date, whether the platform fee applies with zero connected properties after activation (assume **yes** — readiness brief §5) — all `[quote required]`. VAT on a US buyer `[unconfirmed]`. |
| API eligibility | Sign-up for staging is self-serve `[unconfirmed]`; production after certification. |
| Sandbox | Free staging `[owner baseline 2026-11-07]`; Booking.com and Airbnb test accounts referenced in Channex docs `[verified 2026-11-07]`. Expiry/limits `[unconfirmed]`. |
| Certification | PMS certification test suite exists `[verified 2026-11-07]`. Must be passed with **real Portico workflows**, not scripts (readiness brief §5). Separate certified-partner status for Channex PCI card access `[verified 2026-11-07]`. |
| Hotel authorization | Hotel authorizes the Channex connection in each OTA extranet (e.g. selecting the connectivity provider) `[unconfirmed per OTA]`. |
| Account owner / payer | Monoclay holds the Channex contract and pays; may pass through or bundle in SaaS price `[assumption]`. |
| Rate limits / SLA / support | `[quote required]` — contract must cover SLA, support hours, exit and mapping export, PCI responsibility split, sub-processor status (R04 open item 3). |
| Outage consequences | Channels stop receiving ARI and Portico stops receiving bookings via Channex → overbooking risk; Portico must show stale-sync warnings, queue ARI, and recover missed revisions from the feed after recovery (unacknowledged revisions remain retrievable `[verified 2026-11-07]` ([bookings](https://docs.channex.io/api-v.1-documentation/bookings-collection))). Hotel fallback: OTA extranets directly (stop-sell). |
| Suspension / termination | Loss of all hub channels at once. Mitigation: adapter boundary in `distribution`, mapping export, contractual exit period `[quote required]`. |
| Data | Reservation data received from OTAs is the hotel's (hotel = controller); Channex is a sub-processor of Monoclay `[assumption — confirm in DPA]`. |
| Owner, status | Owner: Operational Readiness lead (commercial) + distribution engineer. Status: not started. Activate production **only** for a named pilot (Q23). |

### 3.2 Booking.com (Connectivity Partner Programme — direct, later)

| Field | Detail |
|---|---|
| Purpose | Largest OTA for most markets. Pilot route: **via Channex**. Direct connection: **L** (re-evaluate at hundreds of properties, R04). |
| Eligibility | Must meet "specific onboarding requirements"; expected to be PCI and PII compliant and cloud-based `[verified 2026-11-07]` ([docs](https://developers.booking.com/connectivity/docs)). Acceptance of new partners not confirmed (R04 open item 1). |
| API surface | Rates & Availability (OTA XML / B.XML), Reservations, Content, Contracting, Messaging, Payments, Request-to-Book, Notifications `[verified 2026-11-07]`. Machine-account OAuth tokens (1 hour) `[verified 2026-11-07]`. |
| Version churn | `OTA_HotelDescriptiveContentNotif`, `OTA_HotelSummaryNotif`, `OTA_HotelInvNotif`, `OTA_HotelDescriptiveInfo` sunset **31 Dec 2026** `[verified 2026-11-07]` ([deprecations](https://developers.booking.com/connectivity/docs/deprecation-policy/deprecation-and-sunsetting)). |
| Sandbox / certification | Test property + certification via Connectivity Support; live reservation testing needs property consent `[verified 2026-11-07]` ([going live](https://developers.booking.com/connectivity/docs/going_live)). Timeline not published. |
| Who pays | Hotel pays Booking.com commission under its own contract. No connectivity fee to Monoclay known `[unconfirmed]`. |
| VCC | Activation-date rules conflict across sources; funds up to ~5 days after activation `[secondary, read 2026-11-07]`. |

### 3.3 Expedia Group

| Field | Detail |
|---|---|
| Purpose / need | Via Channex for pilot (**O**); direct **L**. |
| Program | Connectivity Partner Program with Preferred/Elite designations `[verified 2026-11-07]` ([Expedia](https://partner.expediagroup.com/en-us/industries/hotels/hotel-connectivity-providers)). |
| API direction | GraphQL is the standard for supply APIs; Booking Retrieval/Notification in maintenance; new reservation delivery via webhook + GraphQL fetch `[verified 2026-11-07]` ([reservation delivery](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/reservations/getting_started/res_delivery)). ARI via EQC AR XML `[unconfirmed]`. |
| Onboarding | "Autonomous Onboarding" lets a property on a connected PMS/CM go live quickly `[secondary, read 2026-11-07]`. |
| Payments | Expedia Collect (VCC/bank transfer) vs Hotel Collect (card in booking → PCI scope) `[unconfirmed]`. |
| Open | Channex's Expedia certification status `[unconfirmed]`. |

### 3.4 Airbnb

Not accepting new API access requests `[secondary, read 2026-11-07]` ([Hospitable](https://hospitable.com/airbnb-partnerships)).
Only practical route: an existing API partner (Channex docs reference Airbnb test accounts `[verified 2026-11-07]`).
Need: **O** (more relevant to apartments/guesthouses). Hotel pays Airbnb host/guest fees per its own terms.

### 3.5 Agoda

YCS API for channel-manager partners: rates, availability, inventory, product retrieval, booking list/details
`[verified 2026-11-07]` ([Agoda supply docs](https://developer.agoda.com/supply/docs/introduction)). Hotel enables
channel-manager mode in YCS and supplies IDs for mapping `[verified 2026-11-07]`. Booking pulls must cover the full
window or bookings can be missed `[secondary, read 2026-11-07]`. Pilot route: via Channex (**O**); coverage depth through
Channex `[unconfirmed]`. Relevance for the Maldives (Asian source markets) `[unconfirmed]`.

### 3.6 Trip.com Group

No public direct-connect documentation found; connectivity runs through recognised partners `[secondary, read 2026-11-07]`.
Use a hub. Whether Channex connects Trip.com, and with which capabilities, `[unconfirmed]`. Relevance for Chinese
source market to the Maldives `[unconfirmed]`.

### 3.7 Hotelbeds and other bedbanks / wholesalers

Channel managers typically push rates/availability/restrictions and receive reservations, usually enabled by support
teams `[secondary, read 2026-11-07]`. Wholesale contracting (static net rates, allotments, release periods) often sits
outside the API `[unconfirmed]` → Portico's rate model must support net rates, allotments and release dates (`groups`/
`rates`). Maldives resorts are believed to rely heavily on tour operators and wholesalers `[unconfirmed]`, many of which
send bookings by email/extranet rather than API. Hub coverage `[unconfirmed]`. Need: **O**.

### 3.8 GDS (Sabre, Amadeus, Travelport) via intermediaries

A PMS does not connect to GDSs directly; hotels reach GDSs through a CRS (e.g. Sabre SynXis, Amadeus hospitality CRS) or
a connectivity switch (e.g. DerbySoft) `[unconfirmed]`. Requires a chain code/representation and per-booking GDS/CRS fees
paid by the hotel `[quote required]`. Need: **L** (corporate/luxury segments). Not supported by Channex as far as we know
`[unconfirmed]`.

### 3.9 Google Hotel Center / free booking links

| Field | Detail |
|---|---|
| Purpose | Free booking links drive direct bookings to the Portico booking engine. |
| Cost | Free to hotels; Google takes no payment for placement or clicks `[verified 2026-11-07]` ([Google](https://support.google.com/hotelprices/answer/10472393)). |
| Connection | Connectivity partners integrate via ARI or Pull `[verified 2026-11-07]` ([connectivity partners](https://support.google.com/hotelprices/answer/10687680)). |
| Requirement | "Excellent" price-accuracy score before launch `[verified 2026-11-07]` → taxes/fees (TGST, green tax, service charge) must be computed identically in feed and booking page (single quote engine in `rates`). |
| Need | **O** for pilot; requires the booking engine (later wave). |
| Account | Monoclay as connectivity partner + hotel's Hotel Center listing/Business Profile `[unconfirmed]`. |

### 3.10 SiteMinder (coexistence only)

pmsXchange/SMX are separate partner builds with per-API certification `[verified 2026-11-07]`
([SMX](https://developer.siteminder.com/siteminder-apis/apps/introduction/siteminder-exchange)). Only relevant if a hotel
insists on keeping SiteMinder as its channel manager. **L**.

---

## 4. Infrastructure and communications

### 4.1 Amazon Web Services (hosting)

| Field | Detail |
|---|---|
| Purpose | Production, staging and (optionally) hosted demo: compute (ECS Fargate), PostgreSQL (RDS), object storage (S3), keys (KMS), secrets (Secrets Manager), load balancing, WAF, DNS (Route 53), logs/metrics (CloudWatch), backups (AWS Backup / snapshots), email (SES, §4.2). Decision D6; Terraform. |
| Pilot necessity | **P**. |
| Region | Default `ap-south-1` (Mumbai), cell-capable (Q4). |
| Account | Monoclay's AWS Organization (not yet designated, Q4). |
| Pricing | On-demand list prices for `ap-south-1` **could not be verified this session**; all AWS figures in `cost-model.md` are `[estimate]`. New-account free-tier/credit programmes changed in 2025 and are time-limited `[unconfirmed]` — **not** treated as permanent. |
| Spending controls | AWS Budgets sends notifications and can trigger actions (e.g. apply a restrictive policy / stop instances) but is **not a hard spending cap** `[unconfirmed]`. Brief §16 requires this distinction to be shown. |
| SLAs | Service-level agreements exist per service (e.g. RDS Multi-AZ, ECS) `[unconfirmed values]`. |
| Contract / data | AWS Customer Agreement + data processing addendum `[unconfirmed]`. Data stays in the chosen region unless replicated by us. |
| Outage | Regional outage → restore in another region from cross-region backups (RTO target in `support-recovery-plan.md`). |
| Owner, status | Founder authorizes spend (Q4). Nothing deployed; zero AWS spend. |

### 4.2 Amazon SES (transactional email)

| Field | Detail |
|---|---|
| Purpose | Booking confirmations, pre-arrival, invoices/receipts, staff notifications, password resets. |
| Need | **P**. |
| Access | New accounts start in a sandbox (only verified recipients) and must request production access `[unconfirmed]`. Domain verification with DKIM/SPF/DMARC; sending domain depends on product name (Q1). |
| Charges | Per-1,000-email pricing plus data `[unconfirmed]`; dedicated IPs optional `[unconfirmed]`. Planning figure `[estimate]` in cost model. |
| Constraints | Bounce/complaint thresholds can lead to sending pause `[unconfirmed]`. Duplicate prevention: Portico outbox idempotency per message key. |
| Hotel sender identity | Option to send "from" the hotel's own domain after the hotel verifies DNS `[assumption]`. |
| Status | Not started. |

### 4.3 Twilio (SMS; optionally WhatsApp)

| Field | Detail |
|---|---|
| Purpose | SMS fallback for arrival info, OTP for staff MFA (prefer TOTP/passkeys instead). |
| Need | **O**. |
| Maldives specifics | Per-country SMS price, alphanumeric sender ID support, sender registration rules for the Maldives — all `[unconfirmed]` / `[quote required]`. |
| WhatsApp via Twilio | Adds Twilio's per-message fee on top of Meta's `[unconfirmed]`. Direct Meta Cloud API (§4.4) avoids that. |
| Account / payer | `[assumption]` hotel-paid pass-through, or hotel brings its own account. |
| Status | Not started. |

### 4.4 Meta WhatsApp Business Platform (Cloud API)

| Field | Detail |
|---|---|
| Purpose | Guest messaging (pre-arrival, transfers, requests) — believed to be a primary guest channel in Maldives resorts `[unconfirmed]`. |
| Need | **O** for pilot (email works without it). |
| Requirements | Meta Business verification, WhatsApp Business Account (WABA), phone number, display-name review, message-template approval, opt-in, 24-hour customer-service window rules `[unconfirmed]`. For a platform onboarding many hotels, Meta's Tech Provider / Embedded Signup route `[unconfirmed]`. |
| Pricing | Meta moved to **per-message** pricing for template categories (marketing, utility, authentication) in 2025, with service replies inside the customer-service window not charged `[unconfirmed]`; rates per recipient country/region on Meta's rate card `[quote required — rate card not read]`. |
| Account / payer | `[assumption]` Hotel owns its WABA and pays Meta (hotel is the sender identity); Monoclay is technology provider. |
| Outage / suspension | Template rejection or number quality downgrade blocks sends → fall back to email; never mark "sent" without delivery status. |
| Data | Message content passes through Meta; Meta's role (processor vs independent controller) per its terms `[unconfirmed]`. |
| Status | Not started. |

### 4.5 Push notifications (APNs, FCM, Web Push)

Staff PWA notifications (housekeeping/maintenance). Web Push is free to send `[unconfirmed]`; iOS native apps would need an
Apple Developer Program membership (annual fee) `[unconfirmed]`. **O**; later wave.

---

## 5. AI and language

### 5.1 Anthropic Claude API

| Field | Detail |
|---|---|
| Purpose | Staff assistant (cited answers about stays/policies), handover summaries, reply drafting, anomaly hints, translation (module `ai`, wave 3). **Critical operations must work without AI** (brief §3, §14). |
| Need | **O**. The development subscription does **not** pay for in-product AI (readiness brief §14). |
| Connection | Direct API, or Claude on **Amazon Bedrock** (keeps processing in the AWS account/billing; partner-operated with separate pricing) `[reference 2026-10-06]`. Claude on Bedrock availability in `ap-south-1` `[unconfirmed]`. |
| Pricing (first-party API, per million tokens) | Claude Opus 5.5 $4 input / $20 output; Claude Sonnet 5.5 $2 / $10; Claude Haiku 5.5 $0.10 / $0.50 (prompts up to 100K tokens; $0.50 / $2.50 beyond) `[reference 2026-10-06]`. Cache reads $0.20/MTok on Opus 5.5 and Sonnet 5.5; cache writes 1.25× input (5-minute TTL) or 2× (1-hour) `[reference 2026-10-06]`. Message Batches at 50% of standard price `[reference 2026-10-06]`. Live page to re-check: `https://platform.claude.com/docs/en/about-claude/pricing`. |
| Spend control | Organization/workspace spend limits exist in Anthropic's console/Admin API `[reference 2026-10-06 — scope unconfirmed]`; Portico must also enforce per-tenant budgets and degrade gracefully when exhausted. |
| Data handling | Retention defaults, zero-data-retention eligibility, DPA terms, and US-only inference option (`inference_geo`) `[reference 2026-10-06 — contract terms unconfirmed]`. Sending guest personal data requires hotel authorization (Q25). |
| Security | Guest messages and imported documents are untrusted input; AI acts only through permission-checked tools and proposals that require human approval (`security-privacy-readiness.md` §5). |
| Status | Not started for product use. |

### 5.2 Translation

Options: Claude (Haiku-class model) `[reference 2026-10-06]`, Amazon Translate, DeepL API, Google Cloud Translation —
pricing per million characters for the latter three `[unconfirmed]`. **Dhivehi (Thaana script, right-to-left)** support
varies by provider `[unconfirmed]`; relevant for local guesthouse staff and government-facing documents. Original message
always preserved (brief §7). **O**.

---

## 6. Hospitality systems (category tables)

> A documented API does not establish compatibility with a hotel's installed equipment (readiness brief §9). For every
> hardware-dependent feature the safe manual alternative is listed.

### 6.1 Door locks and key encoders

| Field | ASSA ABLOY (Vostio cloud, Visionline on-prem) | dormakaba | Salto |
|---|---|---|---|
| Purpose | Encode RFID/mobile keys at check-in; revoke at check-out/room move | same | same |
| Need | **O** (pilot can use the lock system's own front-desk software) | O | O |
| Connection | Vendor SDK/API; Visionline requires an on-property server; Vostio cloud API `[unconfirmed]`. Another PMS (Mews) supports Vostio, Visionline and Salto Space `[verified 2026-11-07, R02]` | Vendor interface (product line dependent) `[unconfirmed]` | Salto Space (on-prem) / cloud products `[unconfirmed]` |
| Partner program / contract | Partner agreement, SDK licence `[quote required]` | `[quote required]` | `[quote required]` |
| Hardware dependencies | Encoders, local gateway/server, lock firmware versions, BLE for mobile keys `[unconfirmed]` | same | same |
| Hotel authorization | Hotel's lock system admin enables PMS interface; interface licence often billed to hotel `[unconfirmed]` | same | same |
| Charges | Interface licence / per-door / per-key fees `[quote required]` | `[quote required]` | `[quote required]` |
| Outage fallback | Lock system's own software encodes keys; emergency master keys per hotel SOP | same | same |
| Data | Lock audit trails (door opening logs) useful for dispute evidence; ownership = hotel | same | same |
| Status | Not started | Not started | Not started |

### 6.2 POS and outlet systems

| Field | Oracle Simphony | Lightspeed (Restaurant) | Toast | Agilysys (InfoGenesis etc.) | Local / other POS |
|---|---|---|---|---|---|
| Purpose | Post outlet charges to room/folio; meal-plan allowance consumption; room/guest lookup | same | same | same | same |
| Need | **O** (manual posting / end-of-shift CSV import fallback) | O | **L** (market availability outside North America/UK-Ireland `[unconfirmed]`) | O (resort segment) | O |
| Connection | Simphony PMS interface / Oracle APIs; partner access rules `[unconfirmed]` | Partner API `[unconfirmed]` | Partner API program `[unconfirmed]` | Partner interface `[unconfirmed]` | Portico's posting API + CSV `[assumption]` |
| Contract / fees | `[quote required]` | `[quote required]` | `[quote required]` | `[quote required]` | — |
| Hardware | Workstations, on-prem or cloud `[unconfirmed]` | iPad-based `[unconfirmed]` | Toast hardware | Workstations | Varies |
| Outage fallback | Charges held in POS, posted later with original service date; never duplicate (idempotent posting key = POS check ID) | same | same | same | same |
| Status | Not started | Not started | Not started | Not started | Generic posting API planned |

Usage in Maldives resorts (which POS is common) `[unconfirmed]` — confirm with pilot candidates.

### 6.3 Accounting and ERP

| Field | Xero | QuickBooks Online | Oracle NetSuite | SAP (Business One / S/4HANA) |
|---|---|---|---|---|
| Purpose | Export daily summarized journals (revenue, taxes, payments, AR) from Portico ledger | same | same | same |
| Need | O (CSV/GL export fallback) | O | L | L |
| Connection | OAuth2 API `[unconfirmed]` | OAuth2 API `[unconfirmed]` | SuiteTalk / REST `[unconfirmed]` | Service Layer / OData APIs `[unconfirmed]` |
| Partner terms | App partner programme; Xero has announced developer/API pricing changes `[unconfirmed — verify]` | Intuit app partner programme with API usage tiers `[unconfirmed — verify]` | SuiteCloud partner programme `[quote required]` | PartnerEdge `[quote required]` |
| Hotel credentials | Hotel connects its organization (OAuth) | same | Token-based auth from hotel admin | Hotel's SAP admin |
| Outage fallback | Exports queue and resend; journals carry idempotency keys | same | same | same |
| Status | Not started | Not started | Not started | Not started |

### 6.4 Salesforce (CRM)

REST/Bulk APIs against the hotel group's own org; OAuth connected app; API limits depend on the customer's edition
`[unconfirmed]`; AppExchange listing requires a security review `[unconfirmed]`. **L** (groups only). Hotel pays its
Salesforce licences. Status: not started.

### 6.5 Identity and document verification

Passport/ID capture, MRZ/NFC reading, liveness checks — vendors and per-check pricing `[quote required]`; front-desk
document scanners are hardware dependencies. **L**; pilot uses manual capture into encrypted fields with restricted
access. Retention driven by Maldives requirements `[unconfirmed]` (see market matrix).

### 6.6 Fiscal and e-invoicing middleware

fiskaly, fiscaltrust and Invopop serve EU fiscal regimes (Germany TSE, Italy, Portugal, Spain etc.) `[secondary, read 2026-11-07]`
([fiskaly Italy PMS](https://www.fiskaly.com/e-invoice-italy-pms), [Invopop Portugal](https://docs.invopop.com/compliance/portugal)).
**No Maldives fiscal-device or e-invoicing clearance requirement was identified** `[unconfirmed]`. **L**.

### 6.7 Revenue management systems

| Field | IDeaS | Duetto | Atomize (Mews RMS) |
|---|---|---|---|
| Purpose | Receive reservations/inventory/rates; send back price/restriction decisions | same | same |
| Need | L (enterprise) | L | L |
| Notes | Expected by OPERA-class customers `[secondary, read 2026-11-07, R03]` | Average deployment ~3.5 weeks from PMS integration `[verified 2026-11-07, R03]` | Acquired by **Mews** (a competitor) in Nov 2024 and now "Mews RMS" `[verified 2026-11-07, R02]` — partner access may be restricted `[unconfirmed]` |
| Contract | Partner certification `[quote required]` | `[quote required]` | `[quote required]` |

### 6.8 Oracle Hospitality Integration Platform (OHIP) — OPERA Cloud migrations

Partner pays usage (about $10 per 10,000 REST calls/month; $10 per 100,000 streamed events, tiers above) `[verified 2026-11-07, R01]`
([OHIP datasheet](https://www.oracle.com/a/ocom/docs/industries/hospitality/hosp-integration-platform-ds.pdf)); streaming
subscriptions need environment-owner approval and Oracle enablement `[verified 2026-11-07, R01]`. Partner access route
conflicts between sources `[verified 2026-11-07, conflicting]`. Needed only to migrate from (or coexist with) OPERA Cloud.
On-premise OPERA 5 exports: see `migration-onboarding-checklist.md`.

### 6.9 Transport operators (seaplane, domestic flights, speedboats)

Maldives transfers rely on seaplane and domestic-flight operators and resort-owned boats `[unconfirmed]`. No public
integration API is known `[unconfirmed]`; manifests are exchanged by email/portal. Portico plans manual manifest entry
and export. **O**.

### 6.10 Government portals

MIRA tax filing, Ministry of Tourism reporting and Immigration requirements are in `market-matrix.md` §2. Portico
produces reports; hotels file. **No government submission is automated** without owner authorization (CLAUDE.md §1).

---

## 7. Operations tooling

| Field | Error monitoring (e.g. Sentry) | Uptime + status page | On-call paging | Support desk |
|---|---|---|---|---|
| Need | P | P | P (for pilot P1 alerts) | P (shared inbox minimum) |
| Pricing | Free developer tier and paid team tiers `[unconfirmed]` | Free tiers exist `[unconfirmed]` | Free/paid tiers `[unconfirmed]` | Per-agent pricing `[unconfirmed]` |
| Data | Error payloads must be scrubbed of PII; choose data region `[unconfirmed options]` | — | — | Tickets must never contain card data; PII minimised |
| Status | Not started | Not started | Not started | Not started |

---

## 8. Precise questions for providers

### 8.1 Stripe

1. Can a business incorporated in the Maldives open a Stripe account or be a Connect connected account with
   `card_payments`? (Expected: no — confirm on `stripe.com/global` and with Stripe.)
2. For a **group** whose operating entity is incorporated in a supported country but whose property is in the Maldives,
   may that entity be the merchant for Maldives accommodation (MCC, descriptor, settlement currency, lodging extended
   authorization eligibility)?
3. Confirm that cross-border payouts (recipient service agreement) cannot make the recipient the merchant of record.
4. Connect pricing applicable to Monoclay with `fees.payer=account` and `losses.payments=stripe`; any per-account or
   per-payout platform fees; application fee mechanics.
5. Stripe Terminal availability by country; lodging incremental authorization support per scheme on Terminal.
6. Stripe Billing/Tax fees for Monoclay's SaaS and support for invoicing Maldivian customers (cards, bank transfer).

### 8.2 Bank of Maldives (apply the same list to MIB and "CBM")

1. Do you offer an e-commerce gateway (BML Connect) with a documented API, hosted payment page, payment links and webhooks?
2. Is there a sandbox? How does a software platform get access, and is a partner/aggregator agreement required?
3. Supported operations: pre-authorization, incremental authorization, partial capture, void/release, refund and partial
   refund, card-on-file/tokenization and merchant-initiated charges (no-show), 3-D Secure.
4. Settlement: currencies (USD, MVR), settlement account rules, timing, fees, chargeback process and data provided.
5. Can terminals be integrated with a PMS (semi-integrated or cloud terminal API), or are they standalone only?
6. Token portability: can tokens be migrated to/from another processor?
7. Certification or security review required for integrators; PCI expectations of the software provider.
8. Merchant pricing for hotels (discount rate, monthly fees, minimums) — for hotels' business cases.

### 8.3 Channex

1. Confirm current pricing, VAT treatment for a US company, overages, size limits, billing start for production, and
   whether the platform fee continues with zero active properties.
2. Certification steps, expected effort, re-certification triggers.
3. Per-channel capability list (see `channel-capability-matrix.md` questions).
4. SLA, support hours, incident communication, mapping/data export and exit terms, DPA and sub-processor list,
   PCI responsibility split, Channex PCI forwarding to non-Stripe acquirers.

### 8.4 Meta / Twilio

1. WhatsApp rate card applicable to recipients in our guests' countries; Tech Provider onboarding requirements; whether
   each hotel needs its own WABA and verification.
2. SMS to Maldivian numbers: price, sender ID rules, registration.

### 8.5 Anthropic

1. Commercial terms and DPA for processing hotel guest data; retention; zero-data-retention eligibility; regional
   processing options; spend-limit enforcement behaviour (hard stop vs notification).
