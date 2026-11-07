# Competitive Research 02: Modern Cloud / API-First / Mobile PMS Vendors (Mews, Apaleo, Stayntouch)

Prepared for: Monoclay (working name), a cloud hospitality PMS that aims for OPERA Cloud's operational depth with much better usability.
Research date: 2026-11-07

---

## 0. Method, limits and how to read this report

**How this was researched.** I ran web searches against vendor developer docs (apaleo.dev, docs.mews.com), help centers (apaleo.zendesk.com, help.mews.com, stayntouch.freshdesk.com), vendor press pages, review sites (Hotel Tech Report, Capterra, Software Advice, G2, Trustpilot) and industry press (PhocusWire, SiliconANGLE, Hotel Dive, Hospitality Net).

**Limits you should know about.**
1. **I could not open pages directly.** This session's network allowlist blocks direct fetches of `apaleo.dev`, `api.apaleo.com`, `docs.mews.com`, `mews.com`, `stayntouch.com`, `g2.com`, `hoteltechreport.com` and `reddit.com` (DNS failure on every host). Everything marked "verified" comes from **search-result excerpts of the cited URL**, not from reading the full page. To check field-level details (exact enum values, payload schemas), allow those hosts and run a verification pass.
2. **The shared web-search budget ran out** partway through. Searches still pending: Mews notable customers, Mews rate/availability operation details, the full Mews glossary, and Stayntouch's night-audit behavior. Where I fill these gaps from prior knowledge, I say so.
3. **No Reddit threads came back** from any search. The sentiment sections use review aggregators, Trustpilot and vendor community forums instead.

**Evidence tags used throughout**

| Tag | Meaning |
|---|---|
| **[V]** | Verified: stated in the cited source, as surfaced by search excerpts |
| **[VC]** | Vendor claim or third-party marketing number. Sourced, but not independently validated |
| **[PK]** | Prior knowledge from my training data, **not re-verified in this session**. Treat as a hypothesis to confirm |
| **[INF]** | My inference or analysis |

---

## 1. Executive summary

- **Mews** is the scale leader of the modern cloud PMS wave. It raised **$300M Series D at a $2.5B valuation in Jan 2026**, led by EQT Growth, and reports **~15,000 customers in 85 countries** [V]. Its moat is **PMS plus embedded payments plus marketplace**. It runs as a **payment facilitator with hotels as sub-merchants** (Adyen/Stripe underneath) [V]. Its automation removes classic front-desk chores: no night audit, automatic preauthorization and charging by rate group, OTA virtual-card handling, and payment-request links [V]. Weak spots: **reporting**, **payment and fee transparency**, **support responsiveness**, and limited depth for complex resorts and events [V].
- **Apaleo** is the purest **API-first, "headless" PMS**. Every capability is a documented REST API with OpenAPI specs and OAuth2 [V]. Its most copyable asset is the **finance core**: real-time **double-entry accounting** inspired by USALI, with per-reservation receivable sub-accounts, liabilities for prepayments, automatic prepayment recognition and consumption, and a **business date distinct from posting date**, with an automated, schedulable night audit [V]. Its inventory and booking model is clean: **Property → UnitGroup → Unit**, **RatePlan bound to one UnitGroup**, **Booking as a container of single-unit Reservations**, and per-night **time slices** [V]. Weakness: reporting, CRM and other functions are pushed to the App Store, so small hotels face integration cost and complexity [V]. Scale is mid-sized: ~1,700 properties and 85k units (Nov 2024) [V]. It was first to ship an **MCP server** for AI agents (Sept 2025) [V].
- **Stayntouch** is the **mobile- and tablet-first** US-centric PMS. Its strengths are **tablet front desk ("Rover")**, **mobile housekeeping**, **kiosk with ID scan, facial recognition and key encoding**, and **upsells embedded in mobile check-in and kiosk** that post automatically to the folio [V/VC]. It is owned by MCR (bought for $46M in 2020 after the Shiji deal was blocked) and raised $48M from Sixth Street Growth in Dec 2023 [V]. It is smaller (~116 employees) and leans to US management companies (HEI, Regency) [V]. Complaints center on **reporting depth**, a **hard-to-use room diary**, an inconsistent and unpolished UI, and group workflows [V].

**The big picture for Monoclay [INF].** No modern vendor combines (a) OPERA-grade finance and night-audit integrity, (b) Mews-grade payments automation, (c) Apaleo-grade API openness and accounting model, (d) Stayntouch-grade mobile operations, and (e) **strong built-in reporting**. Reporting is the one complaint shared by all three, and it is the clearest gap.

---

## 2. Mews

### 2.1 Positioning, segments, scale, pricing

- **Company and funding.** Mews was founded in 2012 (Prague origins, now Amsterdam-based) [V: [SiliconANGLE](https://siliconangle.com/2026/01/23/hotel-software-maker-mews-nabs-300m-2-5b-valuation/), [NL Times](https://nltimes.nl/2026/01/26/dutch-unicorn-tech-firm-mews-gets-eu2-billion-valuation-new-funding-round)]. The **$300M Series D** (press release dated 22 Jan 2026) was led by **EQT Growth**, with new investors **Atomico** and **HarbourVest** and existing investors **Kinnevik, Battery Ventures and Tiger Global**, at a **$2.5B valuation** [V: [Mews press](https://www.mews.com/en/press/mews-secures-300-million-investment), [PhocusWire](https://www.phocuswire.com/mews-series-d-300m-ai-fintech-hotel-operations), [Hotel Dive](https://www.hoteldive.com/news/mews-series-d-300-million-funding/810338/)]. The stated use of funds is **AI and payment processing** [V]. An IPO in 2–3 years was mentioned [V: SiliconANGLE]. Earlier rounds: a 2022 Series C (~$185M) and a 2024 round (~$110M at ~$1.2B, led by Kinnevik) [PK]. Aggregators disagree on the total raised ($475M–$717M) [V: [multiples.vc](https://multiples.vc/private-comps/mews), [Tracxn](https://tracxn.com/d/companies/mews/__TV3mQ2g4qkoE_y1R0lQGCFw7VhvA3ieU9NpdBaRsXe8/funding-and-investors)].
- **Scale.** About **15,000 clients in 85 countries** (FD via NL Times; Clay) [V].
- **Acquisitions.** **Atomize** (Swedish cloud RMS), announced 21 Nov 2024. It is now "Mews RMS" with an "Autopilot" mode the vendor says automates pricing for 70% of users [V/VC: [Mews press](https://www.mews.com/en/press/mews-accelerates-ai-powered-revenue-growth-with-atomize-integration), [HTR](https://hoteltechreport.com/news/mews-acquires-atomize)]. **HS/3 Hotelsoftware** (Germany) was also acquired; a Capterra reviewer migrated because "HS/3 got acquired from MEWS" [V: [Capterra](https://capterra.com/p/145487/Mews-Commander/reviews/)].
- **Segments [INF + V].** Independents, urban and lifestyle groups, hostels and serviced apartments. Hostel support in BI is planned for H2 2026, which confirms hostels as a core segment [V: [HTR BI launch](https://hoteltechreport.com/news/smarter-decisions-faster-mews-launches-business-intelligence-for-hotels)]. Reviewers and third parties call it **less suited to complex resorts and to events and banqueting** [V: [Capterra](https://www.capterra.com/p/145487/Mews-Commander/), [hoteltech.review](https://hoteltech.review/mews-pms-review-2026)].
- **Notable customers.** The planned search was blocked by the search budget. From prior knowledge only, at low-to-moderate confidence: hostel and lifestyle brands such as Generator and Accor's Jo&Joe [PK, verify].
- **Pricing.** Quote-based and not published [V: [PricingSaaS](https://pricingsaas.com/companies/mews), [CostBench](https://costbench.com/software/hotel-management/mews/)]. Mews's own help center shows the tier naming changing over time: **Starter → Pro**, and **Advanced → Enterprise** [V: [help.mews.com Starter→Pro](https://help.mews.com/s/article/Upgrading-from-Mews-Starter-to-Pro-subscription), [Advanced→Enterprise](https://help.mews.com/s/article/Upgrading-from-Advanced-to-Enterprise-pricing-plans-in-Mews)]. **Pro includes 30 public rates, data as old as 3 months, and 10 connections** [V], so Mews gates tiers on configuration counts and data history. Third-party estimates are $5–$12 per room per month [VC: softabase] or $8–$15 per room per month [VC: roommaster, a competitor], with about $900/month cited as a starting point [VC]. **A monthly "platform fee" is withdrawn from the hotel's Mews Payments balance** [V: [help.mews.com balance report](https://help.mews.com/en/articles/4245931-mews-payments-balance-report)], so the SaaS bill is netted against payment payouts.

### 2.2 Product surface

- **Mews Operations** (PMS, formerly "Commander"): the timeline, space (room) status, housekeeping, reservations and billing.
- **Mews Payments:** embedded payments, terminals, payment requests and automation [V].
- **Guest Journey:** a web **Guest Portal** with no app download, covering registration, payment and messaging with reception, plus ID capture and e-signature [V: [mews.com self check-in](https://www.mews.com/en/products/guest-self-check-in)].
- **Mews Kiosk:** a tablet app that handles walk-ins and late arrivals, finds reservations, cuts keys, adds upsells and takes payment. Setup is by **QR scan** [V: [Google Play](https://play.google.com/store/apps/details?id=li.mews.android.operator&hl=en), [App Store](https://apps.apple.com/lb/app/mews-kiosk/id1588694529)]. One US hotel reports 30% of guests check in via kiosk and **25% higher upsells** [VC].
- **Mews Digital Key:** Bluetooth keys reachable from online check-in, SMS, email, portal or kiosk. Supports Assa Abloy Vingcard (Vostio, Visionline) and Salto Space. Wallet keys work with Assa Abloy; a 2025 forum post says there was no Salto wallet yet [V: [Mews Digital Key](https://www.mews.com/en/products/marketplace/mews-digital-key), [community](https://community.mews.com/dach-based-customers-42/digitale-schluessel-der-einfachste-weg-ins-gaestezimmer-2628)].
- **Mews BI:** built-in analytics with AI insights. It is included automatically for Mews Analytics and Enterprise customers, insight dashboards are free to all at launch, and there are >1,000 early adopters [V: [HTR](https://hoteltechreport.com/news/smarter-decisions-faster-mews-launches-business-intelligence-for-hotels)]. Shipping BI in response to persistent reporting complaints is telling [INF].
- **Mews RMS** (ex-Atomize) [V].
- **Mews Marketplace:** passed **1,000 integrations in Dec 2023** [V: [Mews press](https://www.mews.com/en/press/mews-surpasses-1000-marketplace-integrations-with-hospitalitys-biggest-app-store)]. Listing requires **certification plus a live pilot at a Mews property**. Booking Engine API integrations are exempt [V: [docs.mews.com your-journey](https://docs.mews.com/connector-api/your-journey)]. Mews says the API is free to build against and it charges hotels no integration or set-up fees for Marketplace apps [V]. No partner revenue-share information was found.

### 2.3 Mews' real competitive advantage

1. **No night audit.** The system **rolls over at midnight** and charges post when a booking or service is created [V: [Mews blog](https://www.mews.com/en/blog/hotel-night-audit-automation)]. Late changes are handled by **editable history windows**. There are two of them:
   - an **accounting window**, stricter, often 1 day;
   - an **operational window**, e.g. cancelling a house-use stay up to 5 days back.

   The shorter window wins. The current max appears to be **7 days**; an older article said 60 [V: [help.mews.com](https://help.mews.com/s/article/set-up-your-editable-history-windows?language=en_US), [community](https://community.mews.com/product-best-practice-7/get-the-most-from-mews-editable-history-windows-623)]. This is a real UX win for staff, but it shifts complexity to finance (see anti-patterns).
2. **Payment automation tied to rate groups.** Each **payment policy / settlement rule** is attached to the **rate group**. With mode **Automatic**, rules **preauthorize** cards (max expiry 28 days) and/or **charge** them on schedule [V: [help.mews.com auto-preauth](https://help.mews.com/s/article/Enable-automatic-card-preauthorization-for-a-new-payment-policy-in-Mews-Operations?language=en_US), [multiple payment policies](https://help.mews.com/s/article/Using-multiple-settlement-rules-in-Mews?language=en_US)]. **OTA virtual cards are detected automatically and override the hotel policy** with a rule based on the VCC's allowance and activation timing. If the card can only be charged at check-in, Mews adjusts timing and creates a **manual task** for the front desk [V: [community VCC](https://community.mews.com/mews-payments-84/automatic-charging-of-virtual-credit-cards-for-prepaid-reservations-1827), [Preauth thread](https://community.mews.com/mews-payments-84/preauthorization-thruu-payment-automation-2794)]. Automation **charges only the card attached to the reservation**, not cards added manually to the profile [V].
3. **Payment requests (pay-by-link).** These are secure links emailed to guests. They support **partial payments and instalments** and need no guest account. Status shows as Completed or Expired. By default Mews emails the guest when an API client creates one, and invoices can carry an automatic pay link [V: [developers.mews.com](https://developers.mews.com/delivering-payment-requests/), [community](https://community.mews.com/mews-payments-84/make-it-easier-and-quicker-for-guests-to-pay-invoices-1522)]. Mews calls this "one of our killer features" [V].
4. **Customer-centric billing.** In Mews a **Bill belongs to the customer (or company) profile, not to the reservation** [V: [Mews glossary](https://docs.mews.com/getting-started/glossary), [POS use case](https://docs.mews.com/connector-api/use-cases/point-of-sale)]. This supports multi-stay guests, companies and non-stay purchases naturally, but it is a mental-model shift for OPERA users who think "folio = reservation" [INF].
5. **Ecosystem gravity.** With 1,000+ certified integrations [V] and 15k customers [V], vendors build to Mews first, which reinforces its position [INF].
6. **Bundled guest self-service.** Portal, kiosk and digital key form a coherent "skip the front desk" story. Mews' survey says **70% of US travelers would rather check in via app or kiosk** [VC: [Mews press](https://www.mews.com/en/press/the-rise-of-self-check-in-hotels)].

### 2.4 Mews Connector API: domain model deep dive

**API style.**
- **RPC-style JSON over HTTPS.** Every operation is a POST to an operation path such as `api/connector/v1/reservations/getAll/2023-06-06`, so operations are versioned by date [PK, high confidence]. Each request body carries **`ClientToken`** (identifies the integrator app, issued by Mews), **`AccessToken`** (identifies the enterprise/property, issued by the property) and **`Client`** (app name and version) [V: [docs.mews.com requests](https://docs.mews.com/connector-api/guidelines/requests), [getting started](https://docs.mews.com/connector-api/getting-started)].
- **Pagination** uses `Limitation { Count, Cursor }`. Time-interval filters have maximum spans [PK].
- **Rate limit: 200 requests per AccessToken per 30-second sliding window** in production, with HTTP 429 and **`Retry-After`** [V: [requests](https://docs.mews.com/connector-api/guidelines/requests)]. Demo limits are best-effort [V: [environments](https://docs.mews.com/connector-api/guidelines/environments)].
- **Events.** "**General Webhooks**" are one consolidated channel. Each message bundles all simultaneous events for the subscribed entities, and each event carries a type plus entity ID. The integrator then **fetches the details** (thin events) [V: [General Webhooks](https://docs.mews.com/connector-api/events/wh-general)]. Examples: `ServiceOrderUpdated` (one per reservation), `CustomerAdded`, `ResourceUpdated`. **WebSockets** are an alternative for near-real-time front-desk-style syncing. **Webhook and WebSocket registration goes through Mews support**, and `ResourceUpdated` / `ResourceDeleted` must be enabled by Mews on request [V]. Third-party guidance says webhook authenticity uses a shared secret embedded in the endpoint URL [VC: codelevate].
- **Multi-property.** **Portfolio Access Tokens** cover all enterprises in a portfolio. Operations take `EnterpriseIds` (omitting it means all in scope) and `ChainIds`. **Chains** model the legal relationship between enterprises and share **customer profiles**. Some single-enterprise operations return a "**dummy enterprise**" that represents the portfolio. Tokens are opaque, so you cannot tell single-property from portfolio tokens by inspection. Multi-property access is enabled by support, not self-serve [V: [multi-property concept](https://docs.mews.com/connector-api/concepts/multi-property)].

**Core entities.** Combined from the glossary and operation pages:

| Concept | What it is in Mews | Evidence |
|---|---|---|
| **Enterprise** | A property. The AccessToken scopes to it. | [V] |
| **Chain / Portfolio** | Chain: legal grouping that shares customer profiles. Portfolio: API access scope across enterprises. | [V] |
| **Service** | A sellable service at the enterprise. **Bookable** services (e.g. "Stay", or parking) generate reservations; **additional** services (e.g. breakfast, spa) generate orders. | [PK] (glossary not retrieved) |
| **Service order / Reservation** | "A Service Order made against a bookable service is called a Reservation." Webhooks currently support reservations only. | [V: [General Webhooks](https://docs.mews.com/connector-api/events/wh-general)] |
| **Reservation fields** | `RequestedResourceCategoryId` (what was sold) vs **`AssignedResourceId`** (actual space). `AssignedResourceLocked` was added to the *Price reservations* request in Apr 2026. The old "extents" model was replaced by explicit properties. | [V: [reservations](https://docs.mews.com/connector-api/operations/reservations), [migration guide](https://docs.mews.com/connector-api/deprecations/migration-guide-get-reservations), [changelog](https://docs.mews.com/connector-api/changelog)] |
| **Reservation states** | Roughly Inquired → Requested / Optional → Confirmed → **Started** (checked in) → **Processed** (checked out), or Canceled. | [PK] (enum not retrieved) |
| **Resource** | A bookable space: room, bed, parking spot, meeting room. It has a housekeeping state (Dirty / Clean / Inspected / OutOfService / OutOfOrder [PK]) updatable via *Update resources*. | [V: [resources](https://docs.mews.com/connector-api/operations/resources), [housekeeping use case](https://docs.mews.com/connector-api/use-cases/housekeeping)] |
| **Resource category** | Room type. Reservations request a category; resources are assigned. | [V] |
| **Resource features** | Attributes of resources, e.g. sea view. | [V] (operation exists) |
| **Resource blocks** | Out-of-order / internal-use blocks on specific resources. | [V] (operation exists) |
| **Rate / Rate group** | Rates belong to rate groups. Payment and settlement policies attach at the rate-group level. Derived (dependent) rates follow a base rate [PK]. | [V: [rates](https://docs.mews.com/connector-api/operations/rates), payment-policy articles] |
| **Restrictions** | Get / Set / Clear restrictions. The old rate-restriction result is deprecated in favour of `restrictions/getAll`. | [V: [operations index](https://docs.mews.com/connector-api/operations)] |
| **Availability block** | Reserves part of resource-category availability for a group. Reservations added with an `AvailabilityBlockId` draw from the block. **The block cannot be exceeded.** A rate of type AvailabilityBlock cannot be created via the rates operation. | [V: [events use case](https://docs.mews.com/connector-api/use-cases/events)] |
| **Availability adjustment** | A **relative** (delta) change to available count per category. Deleting a block removes its adjustments. | [V: [availability adjustments](https://docs.mews.com/connector-api/operations/availabilityadjustments)] |
| **Product** | Items sold within a service, e.g. breakfast per night, often as packages. | [PK] |
| **Customer / Company** | Guest profiles. Companies (and travel agencies) can own bills. Customers carry open `OrderItems` and `PaymentItems`; the legacy combined `Items` is deprecated. | [V: [customers](https://docs.mews.com/connector-api/operations/customers)] |
| **Accounting items** | Split into **order items** (consumed nights, products) and **payment items** (cash, card, invoice). States: **Open, Closed, Inactive** (until the reservation is confirmed), **Canceled**. The combined *Get all accounting items* is deprecated in favour of **Get all order items** and **Get all payments**. | [V: [glossary](https://docs.mews.com/getting-started/glossary), [accounting use case](https://docs.mews.com/connector-api/use-cases/accounting), [accounting items](https://docs.mews.com/connector-api/operations/accountingitems)] |
| **Accounting category** | Property-configured categorization of all accounting items, both orders and payments. POS systems must map to these. | [V: [POS use case](https://docs.mews.com/connector-api/use-cases/point-of-sale)] |
| **Bill** | **Open** (modifiable) or **Closed** (locked, assumed balanced and settled). Closing takes an optional **counter** (numbering sequence). A closed bill becomes a **Receipt** (zero balance) or an **Invoice** (issued without full payment). Items move onto bills via *Update accounting items*; only Open order items can move. | [V: [bills](https://docs.mews.com/connector-api/operations/bills), [close bill](https://jnv.github.io/mews-open-api-starlight/connector-api/reference/operations/bills_close/)] |
| **Outlets / outlet bills** | POS end-of-day revenue push for balancing. Refunds go as negative values. | [V: [POS use case](https://docs.mews.com/connector-api/use-cases/point-of-sale)] |
| **Payments / credit cards** | A kiosk can **charge a card on file** by specifying card and amount. Mews takes the payment and records it on the guest bill. | [V: [Kiosk use case](https://docs.mews.com/connector-api/use-cases/kiosk)] |
| **Payment requests** | API-creatable pay links. Mews emails the guest by default. | [V] |
| **Ledger balances** | An endpoint (`ledgerBalances/getAll`) appears in aggregator listings. Semantics not verified. | [V: existence only, via [apis.io](https://apis.io/providers/mews-com/)] |

**Design reading [INF].** Mews' model is **customer- and order-centric**. Everything sold is an *order* against a *service*, money is held on *bills* owned by *accounts* (customer or company), and accounting items flow from Inactive → Open → Closed. This generalizes cleanly beyond rooms (parking, desks, spa) and suits fiscalization (closing a bill with a numbering counter). The downside: "folio per reservation", routing and split-billing need extra explanation, which shows up in complaints about invoice splitting and credit notes.

### 2.5 Mews payments

- **Model.** Mews acts as a **payment facilitator**: hotels are **sub-merchants**, and processing runs on **Adyen and Stripe** depending on region [V: [help.mews.com Mews Payments](https://help.mews.com/s/article/Mews-Payments?language=en_US), [Merchant T&Cs](https://www.mews.com/en/legal/merchant/terms-conditions)]. Mews is listed among Adyen for Platforms hospitality customers [VC: popularfintech]. Onboarding requires **KYC by Mews**, a Sub-Merchant Agreement and a Cooperation Agreement, plus approval by the PSP and Mews [V: Merchant T&Cs].
- **Who is merchant of record [INF].** Legally the hotel is the seller of the stay. Mews is the facilitator that settles funds to the hotel's sub-merchant account and bears scheme-level liability as master merchant. The terms say "Mews agrees to facilitate payments" and the PSP "will settle available funds on your Sub-Merchant account, withholding applicable fees" [V]. One operator noted card payments are "linked to Mews' Stripe account and not our own" [V: forum].
- **Revenue model.** Merchant fees include: **card fees, a "Card Protection & Tokenisation Fee", chargeback fee, payment request fee, refund fee and cross-border fee** [V: Merchant T&Cs, via [merchantcostconsulting](https://merchantcostconsulting.com/lower-credit-card-processing-fees/mews-hotel-payment-processing-fees-breakdown/) and [fullstreak](https://fullstreak.com/blog/stripe-vs-mews-payments)]. Mews **offsets fees and other sums against payouts**. There is a **chargeback reserve**: Available Balance excludes it, Total Balance includes it. The **monthly platform fee is withdrawn from the Mews Payments balance** [V: [balance report](https://help.mews.com/en/articles/4245931-mews-payments-balance-report)]. A third party says the terms allow payouts up to 30 days [VC]. Rates are not published [V]. The Series D proceeds are earmarked partly for "payment processing features" [V], which signals that payments are a strategic revenue line.
- **Tokenization, preauth and virtual cards.**
  - Automatic **preauthorization** rules with max **28-day** expiry [V].
  - **VCC detection** with activation-time-aware charging [V].
  - **Mews Payment Terminals** for card-present payments [V: [terminals use case](https://docs.mews.com/connector-api/use-cases/mews-terminals)].
  - Tokenized card on file at the kiosk [V].
- **Known payment pain** [V: [Trustpilot](https://www.trustpilot.com/review/mews.com), [HTR](https://hoteltechreport.com/operations/property-management-systems/mews), community]:
  - "Adyen is the biggest problem"
  - unclear billing and fee transparency
  - pain with invoice splitting, refunds and credit notes
  - **VCC charges often fail and there is no automatic failure email**
  - automatic settlements are **not rescheduled**, and a newly added card is not retried
  - **double-charge risk** when staff collect via payment request and an automatic rule also charges, or when staff manually charge a VCC without cancelling the scheduled payment

### 2.6 What customers praise and complain about (Mews)

**Praise**
- Intuitive and quick to learn. Opera switchers call it "easy, extremely recommendable" [V: [Capterra](https://capterra.com/p/145487/Mews-Commander/reviews/)].
- The tablet **kiosk eliminates paper registration cards** [V].
- **Open API ecosystem** [V].
- **Automated payments and cancellation-fee workflows**, and virtual card processing [V].
- Onboarding and the **Mews University** training resources [V: Trustpilot].
- Hotel Tech Report: about **4.6/5 from ~925 reviews**, support about 4.3/5 [V].

**Complaints**
- **Reporting** is the most repeated complaint: limited built-in reports and customization; "confusing, incomplete, or too limited for multi-property and accounting needs" [V: Capterra, HTR].
- **Complexity for small properties:** "many settings can be overwhelming"; "navigation circuitous" [V].
- **Events and banqueting are basic**; less suited to complex resorts [V].
- **Support:** slow replies, chat-heavy, no phone/email in some regions, dedicated support costs extra, and "AI help doesn't assist with support cases". Trustpilot aggregate is about **3.2** [V].
- **Cost:** "expensive"; integrations add to the bill [V].
- **The interface sometimes opens multiple browser tabs**; some hoteliers regret switching because setup was confusing and payments hard to manage [V: [it.trustpilot](https://it.trustpilot.com/review/mews.com)].
- **End-of-day edge cases:** late-closing outlets push cash drops into the next day, auditors reject the resulting daily over/short figures, and midnight postings of some services cause export imbalances [V: [community "End of day time"](https://community.mews.com/community-library-94/end-of-day-time-212)].
- **Housekeeping UX:** assigning cleaners to rooms is "very clunky"; requests to show timeline events in the housekeeping app; a **color-blindness accessibility** request for status colors [V: [feedback.mews.com](https://feedback.mews.com/forums/918232-property-operations-pms/category/353530-housekeeping)].

### 2.7 UX patterns worth copying (Mews)

- **Timeline.**
  - Grouped by **space type, then space number** [V: [help.mews.com Timeline](https://help.mews.com/s/article/The-Timeline-An-overview), [Configuring the Timeline](https://help.mews.com/s/article/Configuring-the-Timeline-view)].
  - **Density modes**: Default, Comfortable, Compact.
  - **Time unit switch**: hours, days, months. Hours matter for day-use and meeting spaces.
  - Blocks and room numbers are colored by reservation and housekeeping status, recently made "more vibrant and easily distinguishable" [V: [release note](https://releases.mews.com/en/space-status-colors-are-now-more-vibrant-and-easily-distinguishable)].
- **Locked vs unlocked assignment.** Reservations can be "locked" to a space so auto-optimization won't move them (the API exposes `AssignedResourceLocked`) [V].
- **Configuration-light self-service hardware.** Kiosk setup by **QR scan** [V].
- **App-less guest journey** (web portal) [V].
- **Status-to-task automation.** A VCC charge-timing problem becomes a **manual task** for the front desk [V]. Exceptions become tasks instead of silent failures (when they work).
- **Two-tier correction windows** (accounting vs operational) is a concept worth adopting with better reconciliation [V/INF].
- **Training academy** (Mews University) [V].
- Keyboard shortcuts and global search: **not verified** in this session. Don't assume Mews has a strong keyboard model.

### 2.8 Anti-patterns to avoid (Mews)

1. **Support-gated developer features.** Webhook and WebSocket registration, `ResourceUpdated` enablement and portfolio tokens all go through support tickets [V]. Make these self-serve.
2. **Tokens in the request body plus RPC POST for reads** [V/PK]. Non-standard; harder for gateways, caching and tooling. Prefer REST with an Authorization header.
3. **Netting the SaaS fee against payment payouts, opaque fee schedules and slow payouts** [V]. These drive distrust.
4. **Silent automation failures.** No failure email for VCC charge failures, no rescheduling of failed automatic settlements, duplicate-charge risk between pay-links and auto-rules [V]. Automation needs idempotency, retries, alerting and a single "who will charge this" source of truth.
5. **Tier gating on configuration counts** (Pro = 30 public rates, 10 connections, 3 months of data) [V]. It forces mid-life upgrades and frustrates growing hotels [INF].
6. **Short editable windows without first-class reconciliation**, e.g. late outlets and over/short [V].
7. **Timeline inconsistencies,** e.g. you can't move unlocked reservations in the monthly view [V].
8. **Multi-tab UI sprawl** [V].

---

## 3. Apaleo

### 3.1 Positioning, segments, scale, pricing

- **Positioning.** The "**open hospitality platform**": an API-first PMS where "every capability (reservations, bookings, blocks, inventory, rate plans, availability, and finance) is exposed through documented REST APIs secured with OAuth 2.0, published as OpenAPI" [V: [api-evangelist profile](https://github.com/api-evangelist/apaleo), [apaleo.com/open-apis](https://apaleo.com/open-apis)]. Founded 2017 in Munich by former protel executives (Uli Pillau, Martin Reichenbach) [PK].
- **Segments and customers.** Tech-forward chains, serviced apartments and "aparthotel" operators. Named customers include **citizenM, easyHotel, Falkensteiner, NUMA, limehome, iLive, Miiro Hotels and Korner Hotels** [V: [shorttermrentalz](https://shorttermrentalz.com/news/apaleo-seriesb-funding-round/), [pulse2](https://pulse2.com/apaleo-open-property-management-platform-raises-e20-million/)].
- **Scale and funding.** **€20M Series B, Nov 2024, led by PSG Equity**, with Redalpine, FOMCAP IV and Rockaway Ventures [V]. At that time Apaleo had **1,700+ properties, 85,000+ units, 30+ countries** [V]. Aggregator totals are about $31–32.5M [V: Crunchbase, Tracxn]. No 2025–26 round was found. One unverifiable claim of "€110M total including €90M growth" conflicts with press and should be ignored [V].
- **AI positioning.** **Agent Hub** (2025) is billed as the "first AI agent marketplace for hospitality". The **MCP server** launched Sept 2025 in alpha [V: [HTR](https://hoteltechreport.com/news/apaleo-becomes-first-property-management-platform-to-launch-mcp-server-bridging-ai-agents-with-hotel-systems), [apaleo blog](https://apaleo.com/blog/apaleo-news/apaleo-launches-mcp-server)]. citizenM's CIO called MCP "the great AI democratiser in hotel tech" [V].
- **Pricing.**
  - One source quotes the official page as **€8 per room per month with a €400 monthly minimum per property**, and no setup, licence or integration fees on the core [VC: [Capterra](https://capterra.com/p/197063/apaleo/) shows €400 starting].
  - HTR says $900/month base [VC].
  - Payments (Apaleo Pay) and many capabilities come from separately priced Store apps [V/VC].
  - No information found on how revenue is shared with Store partners.

### 3.2 Apaleo's real competitive advantage

1. **A real accounting engine in the PMS** (details in 3.3.6). This is what finance teams and auditors want, and what most "easy" PMSs lack [INF].
2. **Clean, composable domain model with stable public contracts** across Inventory, Rate Plan, Availability, Booking, Finance, Operations, Webhook and Identity APIs [V].
3. **Openness as product.** Anything the UI does, the API can do. This enables "composable" stacks for operators like citizenM and limehome that build their own guest apps [INF + V customers].
4. **Agent readiness.** MCP server, Agent Hub, and fine-grained OAuth permissions shown on a consent screen [V].

### 3.3 Apaleo API: domain model deep dive

#### 3.3.1 API surface, auth and limits

- **Separate versioned REST APIs per bounded context**, each with Swagger/OpenAPI. Examples: `https://api.apaleo.com/inventory/v1`, "Rate Plan V1" [V: [Swagger UI](https://api.apaleo.com/swagger/index.html?urls.primaryName=Rate+Plan+V1), [api-evangelist README](https://github.com/api-evangelist/apaleo/blob/main/README.md)]. Contexts include Inventory, Rate Plan, Availability, Booking, Finance, Operations, Distribution, Webhook, Identity, Logs, Settings, Payment [V/PK].
- **OAuth 2.0 / OpenID Connect** [V: [scopes](https://apaleo.dev/guides/api/scopes.html), [authentication](https://apaleo.dev/guides/api/authentication.html)].
  - **"Simple client"** (custom app for a single account) vs **"Connect client"** (Apaleo Store app, authorization-code flow with a **consent screen**) [V: [simple client](https://apaleo.dev/guides/oauth-connection/register-simple-client-app), [connect client](https://apaleo.dev/guides/oauth-connection/register-connect-client-app.html), [consent screen](https://apaleo.dev/guides/oauth-connection/review-consent-screen.html)].
  - **Two access types.** A **scope client** puts API scopes like `reservations.read` in the token. A **fine-grained client** (recommended) uses only OIDC scopes in the token, while **per-API permissions are shown on the consent screen and enforced by the APIs**. Access type **cannot be changed** after registration. Only admins register apps under *Apps → Connected apps* [V].
- **Rate limiting, two mechanisms** [V: [rate-limiting](https://apaleo.dev/guides/api/rate-limiting.html)]:
  - a **request-count limiter** (requests per period);
  - a **concurrency limiter** (simultaneous active requests).

  Both are tracked **per Client ID plus Account Code**, apply **globally and per resource**, and return **429**.
- **Idempotency.** **Not verified in this session.** I believe Apaleo documents an `Idempotency-Key` header on certain POST operations [PK, low confidence]. Confirm against Swagger before citing it as a design reference.
- **Webhooks** [V: [webhook overview](https://apaleo.dev/guides/webhook/overview.html), [create subscription](https://apaleo.dev/guides/webhook/create-subscription.html)].
  - Self-serve **subscriptions** via the Webhook API.
  - Topics include Reservation, Folio, Invoice, RatePlan, Block, Unit and Property.
  - **Wildcards** like `reservation/*`, and specific events like `reservation/picked-up-from-block`.
  - Omitting the property list subscribes to **all current and future properties**.
  - Retries: any non-success response counts as a failure and is retried, with a **24-hour retry window** by default [VC: third-party connector, [guestgraph](https://github.com/guestgraph/connector-apaleo)].
  - Payloads are thin (entity ID plus topic and type, then fetch) [PK].
- **Property rollout actions** in the Inventory API: **clone, archive, set-live** [V: api-evangelist]. Properties have a test vs live lifecycle.
- **Multi-property.** One **account** (identified by an account code) holds many properties. List endpoints filter by `propertyId` [V/PK].

#### 3.3.2 Inventory: Property → UnitGroup → Unit (+ UnitAttribute)

- **Units** can be rooms, **parking lots, beds or meeting rooms**. **Unit groups** are categories such as "single" or "double" [V: api-evangelist].
- **UnitAttribute** is a separate model in the Inventory API [V: Swagger model names].
- Unit groups have a type (bedroom, meeting room, event space, parking, other), a member count, max persons and a rank. Units carry **status**: occupancy plus condition (Clean / CleanToBeInspected / Dirty) and maintenance [PK, moderate].
- Maintenance types such as OutOfService / OutOfOrder / OutOfInventory live in the Operations API [PK, moderate].
- The **night audit flags occupied units as dirty** [V: see 3.3.6].

#### 3.3.3 Rate plans, rates, services and policies

- The **Rate Plan API** covers rate plans, rates, **services**, **companies**, and **cancellation and no-show policies** [V: api-evangelist].
- **Each rate plan is bound to exactly one UnitGroup** [V: [channel integration: map rate plans](https://apaleo.dev/guides/business-cases/channel-integration/rates.html)]. A "rate plan" in Apaleo is therefore a (rate code × room type) product, so channel mapping is 1:1 [INF].
- **IDs are opaque.** The docs warn not to parse them [V].
- **Derived rate plans** [V: [get-rates](https://apaleo.dev/guides/business-cases/revenue-management/get-rates.html), [Rate plans help](https://apaleo.zendesk.com/hc/en-us/articles/360010175080-Rate-Plans-and-Rate-Management)]:
  - Prices can't be edited directly; filter with `isDerived=false` when pushing prices.
  - Updating the base plan cascades through **pricing rules**.
  - **Up to three pricing levels (two derivations).**
  - **Restrictions are NOT inherited** and must be set per derived plan.
- **Time slice definitions** are created automatically: **Overnight** (check-in to check-out time) vs **Day-use** (check-out to check-in time) [V: [Hotel setup](https://apaleo.zendesk.com/hc/en-us/articles/360019080520-Hotel-Setup-Step-by-Step)]. Pricing granularity is a "time slice", not hard-coded "night" [INF].
- **Services** (add-ons) can be included in rate plans as packages. Default prices are suggestions that can be overwritten. A "**Post next day**" setting books revenue for, e.g., breakfast on the morning after the night, while the ordered-services report still shows the right day [V: [Setting up services](https://apaleo.zendesk.com/hc/en-us/articles/360000656731-Setting-up-Services)].

#### 3.3.4 Offers (availability plus price quotes)

- The **Booking API "offers" endpoint** returns offers **per rate plan × unit group** for a date range and occupancy. It filters to rate plans distributed on the requested channel (e.g. IBE) [V: [get-offers](https://apaleo.dev/guides/business-cases/ibe/get-offers.html)].
- A **service-offers** endpoint returns optional add-ons for a chosen rate plan [V].
- An offer carries total gross amount, available units, per-time-slice prices and the applicable policies [PK].

#### 3.3.5 Bookings vs reservations

- **"The booking is a container for one or more reservations. One reservation is for one room."** A booking is therefore a multi-room reservation [V: [send-bookings](https://apaleo.dev/guides/business-cases/channel-integration/send-bookings.html)].
- **Booking-level fields:** credit card / payment account, **booker**, comment, booker comment, list of reservations [V].
- **Create** returns the booking ID **and an ID per reservation** [V].
- **Modify via `PUT /bookings/{id}`.** Reservations without an ID are **added**; those with an ID are **updated**. Omitted first-level fields are **kept** [V: [modify-bookings](https://apaleo.dev/guides/business-cases/channel-integration/modify-bookings.html)].
- A reservation **cannot be moved to another booking** [V]. Lookup by reservation is `GET /booking/v1/bookings?reservationId={id}` [V].
- **Reservation statuses:** Confirmed, InHouse, CheckedOut, Canceled, NoShow [V: third-party MCP listing, [anythingmcp](https://anythingmcp.com/guides/apaleo-to-mcp)].
- **Reservation actions** are separate endpoints (check-in, check-out, cancel, no-show, assign/unassign unit, amend) [PK, high].
- Each reservation is priced by **time slices**, with per-slice unit group, rate plan and amounts [PK, moderate].
- **Blocks:** reservations can be picked up from blocks [V: webhook event `reservation/picked-up-from-block`].

#### 3.3.6 Finance: folios, invoices, accounts, night audit, business date

**Folios** [V: [Folio Types and House Account](https://apaleo.zendesk.com/hc/en-us/articles/360017096760-Folio-Types-and-House-Account), [POS basics](https://apaleo.dev/guides/business-cases/pos-integration/basics.html), [non-reservation postings](https://apaleo.dev/guides/business-cases/pos-integration/non-reservation-postings.html)]

- **Guest folio:** one per reservation, created automatically with all booked charges and prepayments. **Additional folios** can be added per reservation.
- **Booking folio:** one empty folio per booking.
- **External folio:** for non-staying customers, created via `POST /finance/v1/folios` with type `external`. **Room charges must not go to external folios.** Once the external folio for a business day is closed, refunds can no longer be posted to it.
- **House account:** one per property. It is legacy and "not used that much anymore since the external folios are available".
- **Operations:** `PATCH /finance/v1/folios/{id}`, **bulk-move** of charges (`PUT /finance/v1/folio-actions/bulk-move`), move and split charges [V: search excerpt, [Move and Split](https://apaleo.zendesk.com/hc/en-us/articles/27834546342428-Move-and-Split-Charges-Between-Folios)].
- **POS integrations** use the Booking API to find the reservation and the Finance API to post to folios [V].

**Accounting** [V: [Introduction to the Apaleo Accounting](https://apaleo.zendesk.com/hc/en-us/articles/360019220119-Introduction-to-the-Apaleo-Accounting), [Gross Transactions Export](https://apaleo.zendesk.com/hc/en-us/articles/360021083960-Apaleo-Gross-Transactions-Export)]

- **Double-entry, in real time, inspired by USALI.** It focuses on revenue and related entries and is **agnostic to expenses**. **Mapping to the hotel's general ledger happens outside Apaleo.**
- **#1200 Receivables (guest receivables).** Each reservation has its own **receivable sub-account**. It distinguishes in-house from checked-out guests. On city-ledger transfer, #1200 is credited and **#9999 Accounts Receivable** ("Receivables from LuL", German *Lieferungen und Leistungen*, i.e. trade receivables) is debited on the relevant sub-account.
- **Payment matching.** When a payment posts, whichever payment account it uses, Apaleo checks whether the reservation or booking has a receivable on #1200.
- **#3000 Liabilities** (prepayments and deposits) and **#8001 VAT on prepayments.** Apaleo **automatically qualifies whether a payment is a prepayment (VAT-aware) and consumes prepayments** by rule set.
- **Revenue sub-accounts** are configured per property. Each has a unique code per property and belongs to exactly one revenue type [V: POS basics].
- A Google Sheets add-on flags **reservations with non-zero receivable or liability balances** [V: [gsheet.apaleo.com](https://gsheet.apaleo.com/)]. That is a built-in integrity control [INF].

**Business date and night audit** [V: [Night Audit: Revenue Recognition and Prepayment Handling](https://apaleo.zendesk.com/hc/en-us/articles/115003519971-Night-Audit-Revenue-Recognition-and-Prepayment-Handling-payment-deposits), Accounting intro, [Make.com module list](https://www.make.com/en/integrations/acuity-scheduling/apaleo)]

- **Every transaction has two dates:** a **posting date** and a **business date**. The business date is what counts for accounting.
- Direct postings land on the **current** business date. **You cannot post to a past date; only the night audit can post to a past business date.**
- The **night audit** posts the past business day's charges to folios of in-house (and confirmed) reservations, can mark no-shows, and **flags occupied rooms as dirty**.
- It is **scheduled automatically** (*Settings → Automation*, set a time) and can be **triggered by API** (scope `operations.manage` or `operations.trigger-night-audit`).
- **Night audit logs** are searchable.

**Design reading [INF].** Apaleo keeps OPERA's integrity concepts (business date, audit-posted room revenue, deposit liabilities, AR transfer) but **automates the ritual**. That is the closest existing model to Monoclay's "OPERA depth, much easier" goal. Compared with Mews' "no audit plus editable windows", Apaleo's model is more legible to accountants.

### 3.4 Apaleo payments

- **Apaleo Pay is built on Adyen.** Apaleo **handles the merchant account, tokenization, settlement and reconciliation**, and **each live property gets its own sub-merchant ID** [V: [Pay overview](http://apaleo.dev/guides/pay-integration/overview.html)]. That implies an Adyen-for-Platforms-style **facilitator/sub-merchant model** similar to Mews [INF]. The merchant-of-record wording was not found [V: gap].
- **Authorization holds** reserve funds until captured or released. They **expire after 28 days by default**, which varies by scheme [V: [authorizations](https://apaleo.dev/guides/pay-integration/authorizations.html)]. To create a hold from an Adyen pre-auth, the original request must carry the **`BlockNHold`** flow type in its metadata. Capturing an Adyen pre-auth via the folio endpoint using its `pspReference` requires the **`CaptureOnly`** flow type [V].
- **Payment accounts (cards on file).** Apaleo does **not** store the payment method itself. The integrator calls Adyen with a card-on-file setting, gets the stored payment method ID, and **registers it in Apaleo**. The **payer reference must exactly equal the Adyen `shopperReference`** [V: [payment accounts](https://apaleo.dev/guides/pay-integration/payment-accounts.html)]. Help-center guidance covers reusing a guest's payment method for future reservations [V: [zendesk](https://apaleo.zendesk.com/hc/en-us/articles/360011585040-How-to-Use-a-Guest-s-Payment-Method-for-Future-Reservations-in-Apaleo)].
- **Adyen Sessions checkout is not supported**, because Apaleo Pay needs direct control of `additionalData` for capture and tokenization [V: [accept payments online](https://apaleo.dev/guides/pay-integration/payment.html)]. There is also a [pay-a-folio guide](https://apaleo.dev/guides/pay-integration/pay-folio.html) [V].
- **Revenue model.** Not public [V: gap]. Likely a markup on processing, given the platform structure [INF].

### 3.5 What customers praise and complain about (Apaleo)

**Praise**
- Intuitive UI. "Pretty much as easy to use as Google" (Capterra) [V: [Capterra](https://capterra.com/p/197063/apaleo/)].
- HTR describes the UI as reducing the learning curve [V: [HTR](https://hoteltechreport.com/operations/property-management-systems/apaleo-pms)].
- Openness and integrations [V].

**Complaints**
- **Needs third-party apps for advanced reporting and CRM** [V: HTR].
- **Implementation is more involved than an all-in-one** [V: Capterra DE].
- **For small properties the App Store model adds complexity and cost** [V/VC: [hoteltech.review](https://hoteltech.review/apaleo-pms-review-2026), a less established site].
- Some staff used to traditional PMS screens report a learning curve [VC]. This conflicts with other reviews.

### 3.6 UX patterns worth copying (Apaleo)

- **Property clone / test-then-set-live / archive** as first-class lifecycle actions [V]. This makes onboarding and new-property rollout fast and safe [INF].
- **Step-by-step hotel setup** guidance in the help center [V: [Hotel Setup Step-by-Step](https://apaleo.zendesk.com/hc/en-us/articles/360019080520-Hotel-Setup-Step-by-Step)].
- **Consent screen with per-API permissions** for third-party apps [V]. This builds hotel trust in the ecosystem.
- **Derived rates with an explicit depth limit** (three levels) [V]. Simple to reason about.
- **Day-use as a time-slice definition** rather than a hack [V].
- **Integrity reports** that surface non-zero receivable or liability balances [V].

### 3.7 Anti-patterns to avoid (Apaleo)

1. **Hollow core.** Pushing reporting, CRM and more to marketplace apps raises cost and complexity for small hotels [V]. Monoclay should ship strong native reporting.
2. **Restrictions not inherited by derived plans** [V]. This is defensible, but it surprises revenue managers [INF]. Offer explicit, visible inheritance choices.
3. **House account plus external folio overlap** (legacy concept kept around) [V]. Avoid two ways to do the same thing.
4. **Rate plan bound to exactly one unit group** [V]. It multiplies objects (rate × room type) in the UI. Fine for the API, but the UI should let users manage "rate families" across room types [INF].
5. **Payments integration couples integrators to Adyen specifics** (`BlockNHold`, `CaptureOnly`, `shopperReference` matching, no Sessions) [V]. Abstract the PSP in Monoclay's own API.

---

## 4. Stayntouch

### 4.1 Positioning, segments, scale, pricing

- **Positioning.** A cloud PMS for **hotels of all sizes with a mobile/tablet operating model**. Crunchbase calls it an "enterprise mobile cloud platform" [V: [Crunchbase](https://www.crunchbase.com/organization/stayntouch)]. Founded around 2012 in the Bethesda, MD area by Jos Schaap [PK].
- **Ownership and funding.**
  - A 2018 sale to **Shiji** was **blocked by a March 2020 US presidential order** (CFIUS) [V: [PhocusWire](https://www.phocuswire.com/MCR-acquires-Stayntouch-shiji-trump)].
  - **MCR** (a hotel owner-operator) **bought it for $46M in Aug 2020** and committed $10M [V: [Stayntouch news](https://www.stayntouch.com/news/the-future-is-bright-for-stayntouch-backed-by-new-owners-mcr-investors/)].
  - **$48M growth equity led by Sixth Street Growth** (Dec 2023), earmarked for PMS and **payments** [V: [Stayntouch news](https://www.stayntouch.com/news/stayntouch-raises-48-million-in-strategic-growth-equity-investment-led-by-sixth-street-growth/), [Tracxn](https://tracxn.com/d/companies/stayntouch/___lpnghoUO36FSUWNmtspCsJCatJqe66noAmuHQwjhWU)].
  - About **116 employees** (Aug 2026) [V: Tracxn]. Hotel count: ~500 in 2020 [V]; no current figure found.
- **Customers.**
  - **HEI Hotels & Resorts:** preferred PMS for upscale independents [V: [Stayntouch news](https://www.stayntouch.com/news/hei-hotels-resorts-selects-stayntouch-as-preferred-pms-provider-for-upscale-independent-properties/)].
  - **Regency Hotel Management:** 27 properties, Feb 2026, many brand-flagged [V: [Stayntouch news](https://www.stayntouch.com/news/stayntouch-powers-27-regency-properties/)].
  - **Imperial London Hotels:** full migration, Sept 2026 [V: news search].
  - Eden Resort (Best Western Premier) and Chalet View Lodge [V].
  - **No evidence found of brand-standard certification** with Marriott, Hilton, IHG or Choice [V: absence in search]. Its brand-flagged hotels come via management companies.
- **Recognition and partnerships (2026).** HTR **Level 4 Global Customer Support Certification** [V]. Partnerships with **IDeaS (Last Room Value pricing)**, **Ramsi (agentic AI RM)** and **TRYBE (spa/leisure)** [V].
- **Pricing.** Quote-based. A "pricing page test" page showed **$12 per room per month base and $17 for a higher tier** [VC: [stayntouch.com/pricing-page-test](https://www.stayntouch.com/pricing-page-test/)]. Capterra lists $550/month to start and HTR $800/month [VC]. Third parties estimate $6–$15 per room per month [VC].

### 4.2 Products

- **Stayntouch PMS** (staff app historically branded **Rover**). Full front-office functions on a tablet, with a touch UI designed for fast training [V: [Chalet View case](https://www.stayntouch.com/news/stayntouch-brings-mobility-operational-efficiencies-chalet-view-lodge/)].
- **Guest-facing mobile check-in/out** (historically branded **Zest**; see the webinar "Rover & Zest Enhancements: Room Diary Pilot Release" [V: [www-dev.stayntouch.com](https://www-dev.stayntouch.com/?p=12181)]). Stayntouch says it takes **about 30 seconds** [VC].
- **Kiosk:** ID scanning and **facial recognition**, integrated payment authorization, room moves from a single view, and a built-in card reader and **key encoder** [V/VC: [check-in comparison](https://www.stayntouch.com/articles/hotel-check-in-software-comparison)].
- **Guest Messaging:** automated **SMS and WhatsApp** pre-arrival messages with mobile check-in links and upsell offers [V/VC].
- **Housekeeping mobile app** (details below) [V].
- **Stayntouch Pay:** a branded **PayFac powered by Adyen** [VC: [merchantcostconsulting](https://merchantcostconsulting.com/lower-credit-card-processing-fees/stayntouch-payment-processing/)]. Onboarding docs say it covers processing, acquiring and settlement, directly integrated with the PMS. There are also partner gateways: **Shift4 in the US** (including SkyTab POS folio posting) and **Planet in the EU**. Gateway onboarding takes **6–8 weeks** [V: [onboarding outline](https://stayntouch.freshdesk.com/support/solutions/articles/24000099219-stayntouch-pms-onboarding-for-multi-property-configuration-detailed-outline), [Shift4 page](https://www.stayntouch.com/snt-integrations-new/shift4/)].
- **Open APIs / Integration Hub** [VC: [integrations](https://www.stayntouch.com/integrations/), [developers](https://www.stayntouch.com/developers/), [open API 2026 article](https://www.stayntouch.com/articles/hotel-pms-open-api-2026)]:
  - claims **1,400+ integrations / endpoints**;
  - free API certification, sandbox, scoped OAuth;
  - webhooks across "nine object types" (one source says "over a dozen event types");
  - "unlimited integrations at no extra cost".

### 4.3 Stayntouch's real competitive advantage

1. **Operations without a desk.** Staff run check-in, room moves, payments and housekeeping from tablets and phones [V]. This fits select-service and lifestyle hotels with lean or "roaming" staff [INF].
2. **Upsell embedded in every self-service touchpoint.** Mobile check-in and kiosk offer room upgrades, amenities, F&B packages, parking, and early check-in or late check-out, **priced by dynamic algorithms**. **Accepted upsells post automatically to the folio** [V/VC: [upsell strategies](https://www.stayntouch.com/articles/hotel-upselling-strategies), [front desk upsell guide](https://www.stayntouch.com/articles/hotel-front-desk-upsell-guide)]. Vendor-cited ROI is "up to 240% (mobile)" and "up to 120% (kiosk)", explicitly standout cases [VC].
3. **Mobile room-status loop** [V: [housekeeping mobile app](https://www.stayntouch.com/articles/hotel-housekeeping-software-mobile-app), [HTR](https://hoteltechreport.com/operations/property-management-systems/stayntouch)]:
   - a touch-optimized rooms-to-clean list and status update after servicing;
   - **auto task assignment by floor or section**;
   - **forward assignment for tomorrow's departures**;
   - **points coverage and daily progress** tracking;
   - **priority cleaning for early arrivals**, linked to the early check-in upsell.
4. **US management-company fit and support reputation** (HTR L4 support certification) [V].

**Upsell configuration [PK, moderate confidence; verify].** Stayntouch configures room-upgrade upsells as **upgrade amounts between room-type levels**, with per-day limits and a charge code. Front-desk agents see suggested upgrades in the check-in flow, and guests see image-led upgrade cards in mobile check-in.

### 4.4 What customers praise and complain about (Stayntouch)

**Praise**
- **Ease of training and use.** HTR shows 19 reviews with 87% recommending [V: [HTR](https://hoteltechreport.com/operations/property-management-systems/stayntouch)].
- Helpful, quick support for many reviewers [V: [Capterra](https://www.capterra.com/p/157696/StayNTouch-Rover-PMS/reviews/)].

**Complaints** [V: Capterra, [Software Advice](https://www.softwareadvice.com/hotel-management/stayntouch-pms-profile/reviews/), [G2](https://www.g2.com/products/stayntouch-cloud-pms/reviews), HTR]
- **Reporting depth.** You **can't run some reports "as of" a past date without the scheduling feature**, and the guest statistics report "needs work".
- **Room diary.** "Other PMS have drag and drop room calendars, but the room calendar here is barely usable." HTR lists room-diary navigation among the biggest gaps.
- **Polish.** "Lacks a lot of polish": repetitive steps in the availability calendar and rate manager, and an inconsistent interface.
- **Groups and profiles.** The group process needs refining, and **duplicate guest profiles can't be merged**.
- **Product direction.** "Mobile neglected; development leaning to larger hotels" (one reviewer).
- **Support follow-through.** Tickets delayed, forgotten or closed prematurely; limited contact methods; requests for more languages.

### 4.5 UX patterns worth copying (Stayntouch)

- **Room diary interactions** [V: [Room Diary help](https://stayntouch.freshdesk.com/support/solutions/articles/24000100176-room-diary)]:
  - **drag the arrival and departure flags** to extend or shorten a stay, with server-side validation that fails safely;
  - an **"Auto Assign Rooms"** button that assigns by guest preferences;
  - filters (e.g. all high-floor rooms).
- **Housekeeping forward planning** (tomorrow's departures) and **points-based workload balancing** [V].
- **Upsell everywhere**, with automatic folio posting [V].
- **Kiosk that does room moves and payment auth from a single view** [VC].

### 4.6 Anti-patterns to avoid (Stayntouch)

1. **Auto-assign locks the whole diary** until the user presses "UNLOCK DIARY" [V]. Global locks block other staff. Use optimistic, scoped operations.
2. **Calendar and rate-manager UX debt** with repetitive steps [V].
3. **No historical "as-of" reporting** without scheduling [V].
4. **No profile merge** [V]. Duplicate profiles are inevitable, so merge must be first-class.
5. **Long payment onboarding** (6–8 weeks for the gateway path) [V].
6. **Marketing integration counts** (1,400+) that blur endpoints vs partners [VC]. Credibility risk.

---

## 5. Cross-vendor comparison

### 5.1 Positioning snapshot

| | Mews | Apaleo | Stayntouch |
|---|---|---|---|
| Core thesis | All-in-one "hospitality OS" plus fintech | Open, API-first platform plus app store | Mobile/tablet-first PMS plus guest self-service |
| Scale | ~15k customers, 85 countries [V] | ~1,700 properties, 85k units (2024) [V] | ~116 staff; customer count n/a [V] |
| Latest capital | $300M Series D, $2.5B, Jan 2026 [V] | €20M Series B, Nov 2024 [V] | $48M growth equity, Dec 2023 [V] |
| Pricing transparency | Low (quote; tiers renamed) [V] | Higher (per-room price reportedly public) [VC] | Low (quote; "test" page) [VC] |
| Strongest segment | Independents, lifestyle, hostels, EU | Tech-forward chains, apartments, EU | US independents and management companies |

### 5.2 API and openness

| | Mews | Apaleo | Stayntouch |
|---|---|---|---|
| Style | RPC JSON POST, date-versioned operations [V/PK] | REST plus OpenAPI per bounded context [V] | REST "Connect APIs", sandbox [VC] |
| Auth | ClientToken + AccessToken + Client in body [V] | OAuth2/OIDC; scope vs fine-grained clients; consent screen [V] | Scoped OAuth [VC] |
| Limits | 200 req / 30 s sliding window per token; 429 + Retry-After [V] | Request-rate plus concurrency limiter per client+account, global and per resource; 429 [V] | n/a |
| Events | Consolidated thin webhooks plus WebSockets; **registered via support** [V] | **Self-serve** webhook subscriptions, wildcards, property filters [V]; 24 h retries [VC] | Webhooks, ~9–12 object/event types [VC] |
| Multi-property | Portfolio Access Tokens, `EnterpriseIds`, chains share profiles [V] | Account → properties [V/PK] | Multi-property configuration supported [V: onboarding doc] |
| Marketplace | 1,000+ (Dec 2023), certification plus pilot [V] | App Store plus Agent Hub plus MCP [V] | 1,400+ "integrations" [VC] |

### 5.3 Payments

| | Mews Payments | Apaleo Pay | Stayntouch Pay |
|---|---|---|---|
| Underlying PSP | Adyen and Stripe [V] | Adyen [V] | Adyen (PayFac) [VC]; also Shift4 (US) and Planet (EU) as gateways [V] |
| Model | PayFac; hotel = sub-merchant; KYC by Mews [V] | Sub-merchant ID per property; Apaleo handles merchant account, settlement and reconciliation [V] | PayFac [VC] |
| Distinctive | Rate-group payment policies, auto preauth/charge, VCC auto-handling, pay-by-link with instalments, terminals, kiosk charging [V] | Auth holds (28 d), payment accounts tied to Adyen `shopperReference`, capture by `pspReference` [V] | Upsell auto-posting; kiosk payment auth [V/VC] |
| Complaints | Fee opacity, payouts, VCC failures, duplicate-charge risk [V] | Integrator complexity (Adyen specifics) [INF] | Onboarding time (6–8 weeks, gateway path) [V] |

### 5.4 End-of-day philosophy (critical for "OPERA depth")

| | OPERA (reference) | Mews | Apaleo | Stayntouch |
|---|---|---|---|---|
| Business date | Yes; manual or scheduled End of Day | No explicit business-date ritual; midnight rollover [V] | **Yes**; posting date vs business date on every transaction [V] | Not verified |
| Room revenue posting | Night audit | At booking/service creation; corrections via editable windows [V] | **Night audit posts the past day's charges** [V] | Not verified |
| Corrections to the past | Restricted after audit | **Editable history windows** (accounting vs operational, max ~7 days) [V] | **Only the audit posts to past dates** [V] | Not verified |
| Automation | Configurable | Inherent | Scheduled time plus API trigger [V] | Not verified |

---

## 6. Concept crosswalk (reference models, not terminology to copy)

This gives Monoclay neutral concept names to design its own vocabulary around. "Neutral concept" is my phrasing, not a vendor term.

| Neutral concept | Apaleo | Mews | OPERA-style (generic) |
|---|---|---|---|
| Tenant / organization | Account (account code) [V] | Chain / Portfolio [V] | Chain / Enterprise |
| Property | Property [V] | Enterprise [V] | Property / Resort |
| Sellable inventory type | UnitGroup [V] | Resource category [V] | Room type |
| Physical inventory item | Unit (room, bed, parking, meeting room) [V] | Resource (space) [V] | Room |
| Inventory attribute | UnitAttribute [V] | Resource feature [V] | Room feature |
| Inventory taken out of service | Maintenance (OOS/OOO/OOI) [PK] | Resource block [V] | OOO / OOS |
| Sellable service container | (implicit accommodation) | Service (bookable vs additional) [PK] | n/a |
| Add-on | Service (with "post next day") [V] | Product / additional service [PK] | Package element |
| Price plan | Rate plan (bound to one unit group) [V] | Rate within rate group [V] | Rate code |
| Policy carrier | Cancellation / no-show policies on rate plan [V] | Rate group (settlement, preauth rules) [V] | Rate code policies |
| Derived pricing | Pricing rule on base plan, max 3 levels [V] | Dependent rates [PK] | Derived rates |
| Restrictions | Per rate plan; not inherited [V] | Restrictions set/clear [V] | Restrictions |
| Quote | Offer (rate plan × unit group) [V] | Pricing operations [PK] | Rate query / availability |
| Commercial container | Booking (booker, payer) [V] | Reservation group [PK] | Reservation / share / linked |
| Stay | Reservation (one unit) [V] | Reservation = service order [V] | Reservation |
| Per-period pricing atom | Time slice (overnight / day-use) [V] | Per-night order items [PK] | Daily rate detail |
| Allocation / group block | Block (pick-up) [V] | Availability block (+ relative adjustments) [V] | Block / allotment |
| Charge container | Folio (guest, booking, external; house account) [V] | Bill (on customer or company account) [V] | Folio / window |
| Line items | Charges, payments [V] | Order items, payment items (Inactive / Open / Closed / Canceled) [V] | Postings |
| Revenue classification | Revenue sub-accounts / service accounting config [V] | Accounting category [V] | Transaction code |
| Fiscal document | Invoice from folio [V] | Closed bill → invoice or receipt, with counter [V] | Folio / invoice |
| Ledger | #1200 receivables, #3000 liabilities, #9999 AR, VAT on prepayments [V] | Ledger balances [existence only] | Guest / deposit / AR ledgers |
| End of day | Automated night audit + business date [V] | Midnight rollover + editable windows [V] | Night audit / End of Day |
| Card on file | Payment account [V] | Credit card (tokenized) [V] | Credit card |
| Preauthorization | Authorization hold [V] | Preauthorization (auto by rate group) [V] | Authorization |
| Pay-by-link | Payment link [PK] | Payment request [V] | Pay-by-link |

**Design takeaways from the crosswalk [INF].**
- **(a)** Both modern vendors separate **commercial container** from **stay** from **per-period price atoms**. Keep all three.
- **(b)** Both make inventory **type-agnostic** (beds, parking, meeting rooms), which supports hostels, apartments and meeting space without special cases.
- **(c)** The **charge-container question is the big fork**. Apaleo's folio-per-reservation plus ledger-account model is closer to OPERA mental models and accounting. Mews' customer-owned bills generalize better to non-stay commerce. A hybrid is possible: **ledger first**, with folios as **views** that can be owned by a stay, a booking, a guest or a company.

---

## 7. Open questions and verification backlog

These need the blocked hosts allowed, or a follow-up session with more search budget.

1. Apaleo: does it support an **`Idempotency-Key`** header, and on which operations? What is the exact webhook payload schema, signing method and retry schedule?
2. Apaleo: the full **chart of accounts** (`/finance/v1/accounts` schema and export endpoints), and the exact **business-date** source endpoint per property.
3. Mews: exact **reservation state** enum, **service vs product** semantics, **rate pricing** operations (base vs relative), **ledgerBalances** semantics, and **payment request** API fields.
4. Mews: notable chain customers and current tier names and prices.
5. Stayntouch: night-audit behavior, upsell configuration model, webhook event list, and current Stayntouch Pay economics.
6. Keyboard shortcuts and global search in all three UIs (not established here).
7. Reddit and hotel-forum sentiment, which returned nothing in this session.

---

## 8. Top 15 takeaways for Monoclay (ranked by impact)

1. **Build a real double-entry ledger first; derive folios and bills from it.** Use Apaleo's pattern: per-stay receivable sub-accounts, deposit liabilities with VAT-on-deposit handling, automatic prepayment recognition and consumption, AR transfer to a city-ledger account, and integrity checks for non-zero balances [V: Apaleo accounting]. This is the hardest thing to retrofit and the thing OPERA-replacing finance teams test. Make folios and bills flexible **views** that can be owned by a stay, booking, guest or company. That combines Apaleo's accounting legibility with Mews' customer-centric billing [INF].

2. **Keep a business date but kill the night-audit ritual.** Record **posting timestamp plus business date** on every transaction. Run end-of-day **automatically on a schedule, triggerable via API**, with logs [V: Apaleo]. Allow controlled **correction windows** (accounting vs operational, as Mews does) [V]. Add a first-class **late-outlet and over/short reconciliation** flow so auditors aren't fighting the system [V: Mews pain]. This is how to deliver "OPERA depth, easier".

3. **Embedded payments as a PayFac (hotel = sub-merchant), driven by a payment-policy engine.** Policies attach to rate or policy groups and cover preauthorization and charge schedules, **OTA virtual-card detection with activation-date timing**, pay-by-link with partial and instalment payments, terminals and kiosk [V: Mews]. Payments are both the biggest automation win and the biggest revenue line; Mews raised $300M with fintech as a stated focus [V]. **Beat Mews on trust**: published fees, fast payouts, no silent netting of the SaaS fee, failure alerts and automatic retries, and **one source of truth for "who charges this"** to prevent double charges [V: Mews complaints].

4. **Ship reporting and BI natively, including "as-of" historical reporting.** Reporting is the **#1 complaint at all three vendors** [V]. Apaleo outsources it, Stayntouch can't do past-date reports without scheduling, and Mews needed a separate BI launch [V]. Offer finance-grade reports that tie to the ledger, multi-property roll-ups, exports, and a warehouse sync ("open data").

5. **Use a three-layer reservation model: commercial container → single-unit stay → per-period price atoms.** Model it on Apaleo's Booking → Reservation → TimeSlice [V] and Mews' requested category vs assigned resource with a lock flag [V]. Support **overnight and day-use time slices** natively [V], so day rooms, meeting spaces and hourly products need no hacks.

6. **Type-agnostic inventory: unit types and units for rooms, beds, parking, desks and meeting rooms, plus attributes.** Make allocations and **blocks first-class with pick-up**, use **relative availability adjustments**, and make out-of-order a block on a unit [V: Apaleo and Mews]. This opens hostels, apartments and mixed-use buildings, which are Mews' and Apaleo's growth segments.

7. **Make the API a product: REST with OpenAPI per bounded context, OAuth2, fine-grained permissions on a consent screen, published limits.** Copy Apaleo's request-rate plus concurrency limits per client and account with 429 [V] and Mews' Retry-After [V]. Add **Idempotency-Key on every create, charge and post operation** [INF]. Neither competitor clearly documents this; verification pending.

8. **Self-serve, reliable events.** Webhook subscriptions should be created via API or UI with **topic wildcards and property filters** [V: Apaleo]. Never route them through support tickets [V: Mews anti-pattern]. Use thin events plus fetch, **signed payloads**, retries with a visible delivery log and replay, and an optional WebSocket or stream channel for real-time front-desk clients [V: Mews offers WebSockets].

9. **Multi-property and portfolio from the data model up.** Organization → properties; **portfolio-scoped tokens** with an explicit property filter; chain-level shared guest profiles; cross-property reports [V: Mews did this as a retrofit, with "dummy enterprise" workarounds]. OPERA's chain customers will test this immediately.

10. **Mobile-native operations, not a mobile afterthought.** The housekeeping app should cover auto-assignment by floor or section, **points-based workload**, **forward assignment for tomorrow's departures**, real-time status, and priority cleaning linked to early check-in upsell [V: Stayntouch]. Add a tablet front desk. Keep parity and polish across devices; Stayntouch is criticized both for neglecting mobile later and for an inconsistent UI [V].

11. **Make the timeline / room diary the hero UI.**
    - Drag to move, extend or shorten, with safe server validation [V: Stayntouch flags].
    - Density modes and **hours/days/months zoom** [V: Mews].
    - **Accessible, color-blind-safe status palette** [V: Mews request].
    - Lock vs unlock semantics with consistent behavior in every view, unlike Mews' monthly-view limits [V].
    - Auto-assign that **never locks the whole diary** [V: Stayntouch anti-pattern].
    - Keyboard-first navigation and global search [INF: unverified competitor gap, so a likely differentiator].

12. **App-less guest journey plus kiosk, with upsell at every step.** Pre-arrival web check-in with ID capture and e-signature, payment, messaging (SMS and WhatsApp), digital and wallet keys, and a kiosk with key encoding [V: Mews and Stayntouch]. Upsells (upgrades, early check-in or late check-out, add-ons) should be **dynamically priced and posted automatically to the folio** [V: Stayntouch]. This is a direct, measurable revenue story (vendor claims of 25% higher upsell via kiosk [VC]).

13. **Ecosystem without a hollow core.** Run a marketplace with a free sandbox, certification and pilot [V: Mews], but **keep payments, reporting, basic CRM, housekeeping and guest journey native** so small hotels aren't forced into app sprawl and stacked subscriptions [V: Apaleo complaint]. Abstract PSP specifics behind Monoclay's own payment API [V: Apaleo's Adyen coupling].

14. **Onboarding and configuration as a feature.**
    - **Clone property, sandbox/test mode, set live, archive** [V: Apaleo].
    - Guided step-by-step setup and an academy [V: Mews University].
    - Derived rates with a clear depth limit and **explicit, visible restriction inheritance** [V: Apaleo gotcha].
    - Simple, published, per-unit pricing [VC: Apaleo] rather than gating core configuration by counts like "30 rates / 10 connections" [V: Mews Pro tier].
    - Fast payment onboarding, far quicker than 6–8 weeks [V: Stayntouch].

15. **Design for AI agents now.** Expose an **MCP server** and agent-safe API semantics: fine-grained permissions, idempotency, full audit log, dry-run or preview for financial actions. Apaleo shipped an MCP server and Agent Hub in 2025 [V], Mews' Series D is aimed at AI [V], and Stayntouch is partnering on agentic RM [V]. Agents will be a primary API client within the product's lifetime [INF].

---

*Sources are cited inline. All "[V]" items reflect search-tool excerpts of the cited URL; direct page fetches were blocked in this session, so precise field names and enum values should be re-verified before they are used in design docs.*
