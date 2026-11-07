# Monoclay: Connectivity, Payments and Compliance Research

**Scope:** Cross-cutting market and regulatory research for Monoclay, a cloud hospitality PMS vendor. The design constraint is that Monoclay must not automatically be merchant of record (MoR) for hotel stays.
**Research date:** 7 November 2026
**Report number:** 04 (connectivity, payments, compliance, market context)

---

## How to read this report

Each material claim carries one of three tags:

| Tag | Meaning |
|---|---|
| **[V]** | Verified this session against the cited official or primary source (vendor developer docs, regulator, legislation, Big-4 or law-firm tax alert). |
| **[V2]** | Confirmed only from secondary sources such as vendor blogs, press releases, review sites or consultancies. Directionally reliable, but check before contracting or building to it. |
| **[I]** | Inference, design recommendation, or background knowledge that I did not re-verify this session. Treat it as a hypothesis to validate. |

**Research limitations (please read).** Direct page fetches to `developers.booking.com`, `channex.io` and `partner.expediagroup.com` were blocked by this environment's network allow-list. Those sources were read through search-engine-indexed excerpts, not full pages. The shared web-search budget then ran out before I could cover:

- Spain's guest-registration decree (RD 933/2021)
- vendor-level PMS market share and sales-cycle benchmarks
- Checkout.com's platform model
- Adyen's exact merchant-of-record wording
- Stripe Connect list pricing
- Expedia's test environment
- Google's ARI message set
- AlpineBits

Those topics are tagged [I] below. Allow-listing those hosts, or running a follow-up search session, would close the gaps.

---

## Executive summary

1. **Use a hub for distribution at launch.** Airbnb is closed to new API partners [V2]. Booking.com and Expedia need formal onboarding and certification, and both are moving their APIs (Booking.com is sunsetting legacy OTA content endpoints on 31 Dec 2026; Expedia has put its XML booking APIs into maintenance in favour of GraphQL plus webhooks) [V]. A white-label hub such as **Channex** costs **$130/month plus $7 per hotel** (falling to $4 at 2,000+ hotels), which is roughly $0.10–0.20 per room per month and far below PMS price points [V]. Direct connections to Booking.com and Expedia make sense later, once Monoclay has scale.
2. **The OpenTravel (OTA) XML message vocabulary is still the common language** for rates, availability and reservations (OTA_HotelAvailNotif, OTA_HotelRateAmountNotif, OTA_HotelResNotif, OTA_HotelRatePlanNotif, OTA_HotelProductNotif) [V]. Each partner uses its own dialect, though, and newer APIs are REST, JSON or GraphQL (Expedia GraphQL, SiteMinder SMX REST, Channex JSON) [V]. Monoclay should build a canonical internal model with per-channel adapters and should not use OTA XML internally [I].
3. **"Not merchant of record" is achievable but needs deliberate choices on three separate axes:** who is the settlement merchant, who carries losses and negative balances, and who is the legal seller for tax purposes. In Stripe Connect, **direct charges on accounts where Stripe carries losses** (the old "Standard" profile) make the hotel the merchant and keep dispute debits off Monoclay's balance. **Destination charges, even with `on_behalf_of`, still debit disputes from the platform's balance** [V].
4. **The leading cloud PMS vendors do not act as merchant.** Mews says it is "not the principal payment or acquiring provider and does not hold funds", with Adyen or Stripe under a separate sub-merchant agreement [V]. Cloudbeds Payments is a separate entity (Digital Arbitrage Payments, Inc.) that routes merchants to an Adyen Marketplace agreement or Stripe Connect terms [V]. Oracle OPI Cloud keeps OPERA Cloud out of PCI scope by tokenizing through certified PSPs [V]. This is the pattern Monoclay should follow.
5. **Hospitality payments differ from e-commerce payments.** The main differences are 30-day extended authorizations for lodging [V], incremental authorizations, card-on-file and merchant-initiated transactions where SCA applies when the mandate is set up but not to a later no-show charge [V], OTA virtual cards with variable activation dates and funding delays [V2], and raw card data arriving inside OTA reservation feeds. **The OTA-feed card data is the biggest PCI-scope risk.** Use a PCI proxy or vault (Channex PCI, or similar) so Monoclay never stores card numbers [V/I].
6. **PCI DSS v4.0.1 SAQ A** dropped requirements 6.4.3 and 11.6.1 in Jan 2025 but added an eligibility criterion that the merchant's page must not be susceptible to script attacks [V]. Monoclay serves the pages that host the payment iframes, so hotels' SAQ A eligibility partly depends on Monoclay's script controls. Monoclay should expect to provide a PCI service-provider attestation [I].
7. **Fiscalization is the main barrier to entering most countries** and should drive which markets Monoclay launches in:
   - Germany: TSE certified security device plus GoBD record rules. Mandatory e-invoice receipt has applied since 2025; issuing starts in 2027–28 [V/V2].
   - Austria: RKSV signed cash records once turnover passes €15k and cash/card takings pass €7.5k [V].
   - Italy: RT telematic recorder or e-invoices through SdI, plus Alloggiati Web police reporting [V2].
   - France: NF525 certification or editor self-attestation (self-attestation was reinstated in 2026 [V2]). E-invoice receipt for all businesses from 1 Sep 2026 [V2].
   - Portugal: AT-certified software, ATCUD code, QR code and SAF-T. Qualified e-signature or CIUS-PT on PDFs from 2027 [V2].
   - Spain: Verifactu is legally due Jan/Jul 2027, but an October 2028 delay was announced on 5 Oct 2026 and is not yet in the official gazette (BOE) [V/V2].
   - Saudi Arabia: ZATCA Phase 2 Wave 25 threshold of SAR 187.5k, due 1 Feb 2027 [V2].
   - UAE: e-invoicing becomes mandatory from 2027 for businesses at or above AED 50m [V2].
   - India: GST e-invoicing. Invoices must be reported within 30 days for businesses with aggregate turnover of ₹10 crore or more [V].
   - Maldives: TGST at 17% and a green tax of $12 or $6 per person per night [V].
   - US: the FTC all-in pricing rule for lodging has applied since 12 May 2025 [V].
8. **Market context:** estimates of PMS software market size range from about $1.2bn to $3.8bn for 2025 depending on scope, with 9–11% CAGR, and cloud holds over 70–80% share [V2]. Typical pricing is $5–15 per room per month for mid-market cloud PMS [V2]. Enterprise buyers expect SOC 2 Type II, ISO 27001, SSO via SAML, a PCI attestation, a data processing agreement, data residency and uptime SLAs [V2/I].

---

# Part A: Distribution connectivity

## A1. What "connectivity" means for a PMS

A PMS-side connectivity stack has four flows [I]:

1. **ARI push (availability, rates, inventory):** room counts, prices per date, occupancy and rate plan, plus restrictions (minimum/maximum length of stay, closed to arrival or departure, stop-sell), sent from Monoclay to each channel.
2. **Reservation delivery:** new, modified and cancelled bookings flow from the channel to Monoclay, either pushed by the channel or pulled by Monoclay, with an acknowledgement so the channel knows the booking was received.
3. **Mapping and content:** Monoclay room types and rate plans are mapped to channel room and rate IDs. Increasingly, property content, photos, policies and rate-plan definitions are created through API instead of the extranet.
4. **Ancillary APIs:** guest messaging, reviews, payments and virtual-card data, reporting (no-shows, invalid cards), promotions.

The hard engineering problems are ordering, idempotency, reconciliation and rate-limit-aware fan-out, not message formats. Section A9 covers these.

## A2. Booking.com Connectivity Partner Programme

**Onboarding and eligibility**
- Booking.com requires companies to meet "specific onboarding requirements" before becoming Connectivity Partners, and expects them to keep up with continuous API changes afterward [V] ([docs](https://developers.booking.com/connectivity/docs)).
- Search-indexed guidance says applicants are expected to be **PCI and PII compliant** and to run **cloud-based or central-server software** [V] ([docs](https://developers.booking.com/connectivity/docs)).
- Access to the Connectivity Portal is "typically" shared during onboarding. Machine accounts (OAuth-style client ID and secret, exchanged for 1-hour tokens) are created there [V] ([auth](https://developers.booking.com/connectivity/docs/authentication/), [token auth](https://developers.booking.com/connectivity/docs/token-based-authentication)).
- Legacy credential-based authentication was scheduled to sunset on **31 Dec 2025** [V] ([deprecation](https://developers.booking.com/connectivity/docs/deprecation-policy/deprecation-and-sunsetting)).
- Booking.com recommends separate machine accounts for test and production properties [V] ([best practices](https://developers.booking.com/connectivity/docs/openapispecs/contracting-api/contracting-api-specificaion/about-try-it/best-practices)).

**API surface** (from docs pages that surfaced in search) [V]:
- **Rates & Availability:** OTA XML (`OTA_HotelRateAmountNotif`, `OTA_HotelAvailNotif`) and B.XML availability endpoints. Booking.com says "all relevant endpoints for the Rates & Availability API and Reservations API currently use XML" ([portal article](https://portal.connectivity.booking.com/s/article/How-can-I-implement-the-Rates-Availability-API-and-Reservations-API?language=en_US)).
- **Reservations API:** served from a separate secure host. The required endpoints are mostly B.XML. OTA XML is sent as `application/xml`, and B.XML as form-encoded. Booking.com advises supporting both formats but not mixing them within a flow ([docs](https://developers.booking.com/connectivity/docs)).
- **Content API:** property, room and rate-plan creation via `OTA_HotelProductNotif` and `OTA_HotelRatePlanNotif`, plus newer modular APIs ([content](https://developers.booking.com/connectivity/docs/content)).
- **Contracting API**, **Messaging API**, **Payments API**, **Request-to-Book API** and a **Notification service** also exist ([messaging](https://developers.booking.com/connectivity/docs/messaging-api/understanding-the-messaging-api), [payments testing](https://developers.booking.com/connectivity/docs/payments-api/testing-your-integration), [RtB self-assessment](https://developers.booking.com/connectivity/docs/request-to-book/self-assessment)).

**Version churn**, which Monoclay would need to budget for continuously [V] ([migration guide](https://developers.booking.com/connectivity/docs/migration-guides/migrating-to-new-versions.md), [deprecations](https://developers.booking.com/connectivity/docs/deprecation-policy/deprecation-and-sunsetting), [changelog](https://developers.booking.com/connectivity/docs/changelog/changelog-archive)):
- `OTA_HotelProductNotif` v1.3: POST launched 28 Apr 2026 and GET on 8 Jun 2026. Old versions sunset 1 Sep 2026. Calls naming a retired version return HTTP 400.
- `OTA_HotelRatePlanNotif` v1.0: deprecated 13 Oct 2025 and sunset 29 Jan 2026.
- `OTA_HotelDescriptiveContentNotif`, `OTA_HotelSummaryNotif`, `OTA_HotelInvNotif` and `OTA_HotelDescriptiveInfo`: deprecated 31 Dec 2024, with **sunset on 31 Dec 2026**.

**Certification and testing**
- Going live requires a certification process made up of test requests against specific endpoints, started through Connectivity Support [V] ([going live](https://developers.booking.com/connectivity/docs/going_live)).
- Testing uses a **test property** with the Reservations and Rates & Availability connection types enabled. Booking.com publishes a tutorial for creating test reservations [V] ([tutorial](https://developers.booking.com/connectivity/docs/tut-create-test-reservation)).
- Live reservation testing needs consent from the connected properties [V].

**Partner tiers**
- Providers start as **Standard** and earn points toward **Advanced** and **Premier** [V2] ([Hospitable](https://hospitable.com/booking-com-connectivity-partners), [Lodgify](https://lodgify.com/blog/booking-premier-partner-status)).
- Criteria cited include number of properties, connection quality, adoption of Booking.com product features, and engagement [V2].
- Vendor posts mention a new "Premier Plus" tier in 2026 [V2, unconfirmed].

**Timeline:** not published. A realistic estimate for a new PMS is **3–9 months** from application to first live property, depending on whether Booking.com accepts the application promptly and how much of the content API is in scope [I].

**Implication [I]:** going direct is feasible but brings permanent upkeep (the deprecations above occur several times a year) plus PCI obligations. It mainly pays off in partner-tier visibility and feature access once Monoclay has hundreds of properties.

## A3. Expedia Group

- Expedia's **Connectivity Partner Program** has Preferred and Elite designations for software providers [V] ([Expedia](https://partner.expediagroup.com/en-us/industries/hotels/hotel-connectivity-providers)). Cloudbeds and OpenHotel publicise Elite status, described as "top 2%" [V2] ([HTR](https://hoteltechreport.com/news/cloudbeds-named-among-elite-2-of-expedia-group-connectivity-partners)).
- **Booking Retrieval/Confirmation (XML):** Monoclay pulls up to 125 pending bookings per call from `https://services.expediapartnercentral.com/eqc/br` and confirms each one [V] ([BR reference](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/booking_retrieval/reference/xml-reference-booking-retrieval)).
- **Booking Notification (push):** "not available for adoption by new or existing partners" [V] ([BN](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/booking_notification/getting_started/introduction)).
- **Strategic direction:** Expedia states that "GraphQL has become Expedia Group's standard for supply APIs". Booking Retrieval and Booking Notification are in maintenance. New reservation delivery uses a **webhook (`ReservationNotificationEvent`) carrying a reservation ID and token**, after which the partner fetches the reservation via a GraphQL query [V] ([reservation delivery](https://developers.expediagroup.com/supply/lodging/docs/booking_apis/reservations/getting_started/res_delivery)).
- **ARI:** delivered through EQC "AR" (Availability & Rates) XML, alongside Product, Image and Property APIs for content [I, not re-verified].
- **Autonomous Onboarding:** a property connecting through an existing PMS or channel manager can select Expedia, accept the agreement and go live in under 24 hours [V2] ([Hospitality Net](https://www.hospitalitynet.org/news/4135020/expedia-group-launches-autonomous-onboarding-helping-properties-access-global-travel-demand-faster)). This raises the value of being a connected provider: Expedia is using connected PMS/channel-manager partners as its onboarding funnel.
- **Rapid API** is Expedia's demand-side (affiliate/B2B selling) API and is **not** what a PMS needs [I].
- **Payment models:** "Expedia Collect" (Expedia charges the guest and pays the hotel by virtual card or bank transfer) versus "Hotel Collect" (guest card details are passed in the booking, which puts the receiver in PCI scope) [I].

**Implication [I]:** if Monoclay ever goes direct with Expedia, build reservation delivery on the GraphQL plus webhook model, not on Booking Retrieval.

## A4. Airbnb

- Airbnb's partner page reportedly says: "At this time, we are not accepting new access requests for our API" [V2] ([Hospitable](https://hospitable.com/airbnb-partnerships), [bnbcalc](https://www.bnbcalc.com/help/articles/does-airbnb-have-an-api)).
- Historically, Airbnb required an NDA, acceptance of the API terms, a data-security review, and building each mandatory API feature within six months of its release [V2] ([Elfsight](https://elfsight.com/blog/how-to-get-and-use-airbnb-api-partnership-and-integration)).
- **The only practical route is through an existing Airbnb API partner** such as a channel-manager hub. Channex's docs reference Airbnb test accounts [V] ([Channex PCI](https://docs.channex.io/channex-pci/overview)).
- Airbnb matters more for apartment-hotels and alternative accommodation than for classic hotels [I].

## A5. Google Hotel Center, free booking links and Hotel Prices API

- Free booking links are free to hotels. Google takes no payment for placement or clicks [V] ([Google](https://support.google.com/hotelprices/answer/10472393)).
- Connectivity partners integrate via **ARI** (recommended when the partner holds nightly rates directly) or **Pull** (live queries) [V] ([Google connectivity partners](https://support.google.com/hotelprices/answer/10687680), [travel.google](https://travel.google/partners/hotels/for-connectivity-partners/)).
- Launch requires an **"Excellent" price-accuracy score**: prices on the booking link must match the landing page [V].
- Google's ARI XML reuses OTA messages (`OTA_HotelRateAmountNotifRQ`, `OTA_HotelAvailNotifRQ`, `OTA_HotelInvCountNotifRQ`) plus Google "Transaction" property-data messages [I, from prior knowledge].
- **Monoclay fit [I]:** this is high value for a PMS that also sells a booking engine. Google is open to new connectivity partners, unlike Airbnb, and the main technical burden is price accuracy, i.e. taxes and fees must be computed identically in the feed and on the booking page. That ties into the US FTC rule (C3).

## A6. Agoda, Trip.com, Hotelbeds

- **Agoda:** the **YCS API** is "an essential API for Channel Manager Partners". It covers rates, availability, inventory, product retrieval and booking lists/details [V] ([Agoda dev](https://developer.agoda.com/supply/docs/introduction)). The hotel enables channel-manager mode in YCS and supplies property, room and rate IDs for mapping [V] ([Agoda partner hub](https://partnerhub.agoda.com/how-do-i-connect-or-change-my-channel-manager/)). Booking pulls must cover the full booking window or bookings can be missed [V2].
- **Trip.com Group:** no public direct-connect documentation was found. Connectivity runs through recognised partners such as RateGain (Favoured Connectivity Partner three years running) and NextPax [V2] ([RateGain](https://www.5paisa.com/blog/rategains-uno-channel-manager-earns-tripcom-favoured-connectivity-partner-recognition-for), [NextPax](https://nextpax.com/nextpax-travel-technology-announces-distribution-partnership-with-trip-com-group)). **Use a hub.** [I]
- **Hotelbeds** (bedbank/wholesale): channel managers offer push of rates, availability and restrictions plus reservation receipt, typically enabled by support teams [V2] ([Channelku](https://doc.bookandlink.com/docs/channelku/channel-manager/control-panel/hotelbeds), [RoomCloud](https://roomcloud.net/?p=2239)). Wholesale contracting such as static net rates and allotments often sits outside the API, so the rate-plan model needs to handle net-rate and allotment semantics [I].

## A7. Standards: OpenTravel, HTNG and what is actually the de facto standard

**Governance**
- **HTNG became part of AHLA** in March 2021 [V] ([AHLA](https://www.ahla.com/node/2169)).
- OpenTravel and HTNG have shared management and staff since 2018–19 and keep distribution messaging synchronised [V] ([OpenTravel](https://opentravel.org/news/recommendations-released-for-future-of-hotel-distribution-connectivity-standards/), [Hospitality Tech](https://hospitalitytech.com/opentravel-alliance-transition-association-management-relationship-htng-2019)).
- AHLA's HTNG announced a collaboration with the new Japan Hospitality Technology Association [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4126671.html)).

**Messages in real use** (all confirmed in partner docs this session) [V]:

| Purpose | OTA message | Where seen |
|---|---|---|
| Availability, restrictions, room counts | `OTA_HotelAvailNotifRQ/RS` | RateGain RG Bridge ([spec](https://developer.rategain.com/our-products/channel-manager/rg-bridge-supply-push/interface-specifications-availability-and-rates-notification-service/operations/availability-notification/ota_hotelavailnotifrq)), Booking.com |
| Rates | `OTA_HotelRateAmountNotifRQ` | Booking.com, RateGain |
| Reservation delivery | `OTA_HotelResNotifRQ/RS` (also used asynchronously in reply to `OTA_ReadRQ`) | RateGain ([reservation spec](https://developer.rategain.com/our-products/rg-bridge-supply-push/interface-specifications-reservation-notification-service)), Tourisoft ([OTA page](https://tourisoft.atlassian.net/wiki/spaces/HOT/pages/6520882/Open+Travel+Alliance+OTA)) |
| Acknowledgement | `OTA_NotifReportRQ/RS` | RateGain |
| Rate plan and product definition | `OTA_HotelRatePlanNotif`, `OTA_HotelProductNotif` | Booking.com |
| Room inventory and content | `OTA_HotelInvNotif`, `OTA_HotelDescriptiveContentNotif` | Booking.com (sunsetting end of 2026) |

**Assessment [I]:**
- OTA messages (versions 2003B–2015B, profiled differently by each partner) remain the de facto common language for ARI and reservations between PMS, channel managers and the major OTAs. Google's ARI also uses them.
- Two things are eroding that: the big OTAs are moving content and reservation management to JSON or GraphQL APIs (Booking.com modular APIs, Expedia GraphQL), and modern hubs expose REST/JSON (Channex, SiteMinder SMX's OpenAPI spec).
- HTNG specs matter mostly for **on-property integrations** (POS, door locks, PBX, payments, guest-room devices) and as OTA extensions. Regional OTA profiles such as AlpineBits (South Tyrol and the German-speaking region) exist [I, not verified].
- **Conclusion:** implement OTA XML in the adapter layer for hub and OTA connections, and possibly as an inbound interface for revenue management and CRS partners. Do not make it Monoclay's internal domain model.

## A8. Hub/aggregator versus direct connections

| Option | What it is | Commercials | Notes |
|---|---|---|---|
| **Channex.io (WhiteLabel)** | Wholesale-only white-label channel manager API. "Never direct to hotels." [V] ([homepage](https://channex.io/)) | **$130/mo platform fee + $7/hotel/mo**, falling to $6 at 500+, $5 at 1,000+, $4 at 2,000+. Vacation rentals $0.50/unit, down to $0.30 at 7,000+. Only properties with at least one active channel are billed. No commission, no setup fee. Chat & Reviews add-on $7/hotel. Prices exclude VAT. [V] ([pricing](https://channex.io/pricing.md)) | UI, API responses and docs can be white-labelled [V]. Booking revisions feed with explicit acknowledgement [V] ([bookings](https://docs.channex.io/api-v.1-documentation/bookings-collection)). Separate **Channex PCI** service: card data is returned only to certified partners, shown through a tokenised iframe, with card-view logging [V] ([PCI overview](https://docs.channex.io/channex-pci/overview), [walkthrough](https://docs.channex.io/channex-pci/walkthough)). A **Payment Application API** charges cards through Stripe without the PMS touching card numbers [V] ([payment app API](https://docs.channex.io/api-v.1-documentation/payment-application-api.md)). PMS certification test suite [V]. |
| **SiteMinder SMX / pmsXchange** | SMX: app-to-PMS reservation data exchange. pmsXchange: PMS rates/restrictions sync with SiteMinder's channel manager [V] ([SMX](https://developer.siteminder.com/siteminder-apis/apps/introduction/siteminder-exchange), [quick start](https://developer.siteminder.com/smx-api/guides/quick-start)) | Partner agreement, per-API certification [V] | pmsXchange and SMX are **separate builds**. A hotel on a certified PMS plus a certified app can use SMX without being a SiteMinder customer [V] ([FAQ](https://developer.siteminder.com/get-started/resources/faq)). The portal provides an OpenAPI/REST spec; an older wiki says SOAP [V]. Mainly useful for being sold alongside SiteMinder's large hotel base, not as Monoclay's own channel manager. |
| **RateGain (RezGain/UNO, RG Bridge)** | Channel manager with OTA-XML PMS push interfaces [V] | Review-site "from ~$900/mo" [V2] ([HTR](https://hoteltechreport.com/compare/derbysoft-vs-rezgain-channel-manager)) | Large channel reach. Trip.com Favoured partner [V2]. |
| **DerbySoft** | Enterprise connectivity switch, strong with chains, GDS and wholesale [V2] ([DerbySoft PMS page](https://www.derbysoft.com/you-are/property-management-system)) | Review-site "from ~$1,000/mo" [V2] | Better suited to chain/CRS-level distribution than independent hotels [I]. |
| **Direct (Booking.com, Expedia, Agoda, Google)** | Monoclay is itself the connectivity provider | No hub fees. Large fixed engineering and certification cost [I] | Gives partner tiers and feature access, and removes dependence on a hub. |

**Unit economics [I, arithmetic from verified prices]:**
- At 300 hotels on Channex: $130 + 300 × $7 = **$2,230/mo**, about $7.43 per hotel.
- For a 60-room hotel that is about **$0.12 per room per month**, roughly 1–2% of a $5–12 per-room PMS price.
- At 2,000 hotels, if the volume rate applies to all units: about $8,130/mo.
- One engineer-year spent maintaining direct OTA connections costs more than the hub fee for roughly 1,000+ hotels.

**Recommendation [I]:**
- **Launch hub-first with Channex white-label** (or a comparable wholesale hub) for Booking.com, Expedia, Airbnb, Agoda, Trip.com and the long tail.
- **Build Google free booking links/ARI directly**, since it is open, strategic for direct bookings, and depends on Monoclay's own price computation.
- **Re-evaluate direct Booking.com and Expedia at around 500–1,000 properties.**
- Contract for: data portability (mapping export), SLAs, PCI responsibilities, sub-processor status for GDPR, and exit terms.

## A9. Building and testing safely without live partner access

**Sandboxes**
- Booking.com test properties and test reservations [V] ([tutorial](https://developers.booking.com/connectivity/docs/tut-create-test-reservation)), and Payments API testing guidance [V].
- Channex test accounts for Booking.com and Airbnb plus a PMS certification suite [V]. Channex runs a staging environment [I].
- Expedia provides test properties during certification [I].
- Stripe test mode and simulated Terminal readers, and the Adyen test environment [I].

**Contract tests [I]:**
- Validate generated XML against OpenTravel XSDs and each partner's published samples.
- Pin partner API versions, and track deprecation calendars as engineering tickets (see Booking.com's cadence in A2).

**Build a channel simulator [I]**, a fake OTA/hub that:
- receives ARI and asserts the final calendar state;
- emits reservation revisions with realistic failure cases: duplicates, out-of-order modify-before-create, cancel of an unknown booking, partial-room modifications, currency or tax mismatches, virtual-card details arriving late;
- injects 5xx errors, timeouts and rate-limit responses.

**Record and replay:** capture sanitised hub payloads, with card data never present, as regression fixtures [I].

**Ingestion correctness [I]:**
- Treat each inbound reservation revision as an immutable event keyed by `(channel, channel_booking_id, revision_id)`.
- Process it idempotently and acknowledge only after the database commit, using a transactional outbox.
- For ARI, send **full-state windows** periodically (for example, nightly 365-day resyncs) in addition to deltas, so drift self-heals.
- Coalesce rapid changes per room/rate/date before fan-out.

---

# Part B: Payments

## B1. What "merchant of record" really means

"MoR" bundles several separate legal and financial roles. Monoclay can stay out of all of them, or take on some deliberately [I]:

| Axis | Question | Target for Monoclay |
|---|---|---|
| **Settlement merchant / card-scheme merchant** | Whose merchant ID and statement descriptor does the cardholder see? Whose country and currency do funds settle in? | The **hotel** (hotel legal entity, hotel descriptor) |
| **Loss and negative-balance liability** | Who pays when a dispute or refund exceeds the merchant's balance, e.g. the hotel closes with prepaid future stays? | The **PSP** (the PSP underwrites the hotel) or the hotel; not Monoclay by default |
| **Seller of record (tax and consumer law)** | Who sells the room night and issues the fiscal invoice? | The **hotel**. Monoclay only invoices hotels for SaaS and payment fees. |
| **Funds flow / safeguarding** | Does money pass through a Monoclay-controlled balance? | **No.** The PSP settles directly to the hotel. This avoids payment-institution or e-money licensing under PSD2 in the EU and money-transmitter licensing in the US [I]. |

## B2. Stripe Connect

**Charge types** [V] ([charges](https://docs.stripe.com/connect/charges), [destination charges](https://docs.stripe.com/docs/connect/destination-charges)):
- **Direct charges** are created on the connected account, which needs the `card_payments` capability. Disputes debit the **connected account's** balance, and the connected account's pricing applies.
- **Destination charges** are created on the platform. The platform is the settlement merchant by default; `on_behalf_of` makes the connected account the settlement merchant, with its country, currency and descriptor. However, **for destination charges and separate charges and transfers, with or without `on_behalf_of`, the platform balance is debited for disputes and dispute fees.**
- Stripe requires `on_behalf_of` when the platform and connected account are in different regions, with exceptions [V].
- Stripe recommends direct charges for Standard accounts and destination charges for Express and Custom accounts [V].

**Account types have become "controller properties"** [V] ([migration guide](https://docs.stripe.com/connect/migrate-to-controller-properties), [typeless Connect](https://docs.stripe.com/connect/update-to-typeless-connect)):

| Legacy type | `losses.payments` | `fees.payer` | `requirement_collection` | Dashboard |
|---|---|---|---|---|
| Standard | `stripe` | `account` | `stripe` | full |
| Express | `application` | `application` (`application_express` when created via `type`) | `stripe` | express |
| Custom | `application` | `application` | `application` | none |

- `losses.payments = stripe` means Stripe, not the platform, covers connected-account negative balances. The platform stays liable for its own platform-account negative balance [V].
- A 24 Jun 2026 changelog rule: when `fees.payer = account`, `losses.payments` must be `stripe` [V] ([changelog](https://docs.stripe.com/changelog/dahlia/2026-06-24/express-connected-accounts-v1-stripe-owned-pricing-negative-balance-liability)).
- For destination charges the platform pays Stripe's fees even if `fees.payer = account` [V].
- Dispute-fee responsibility follows these properties [V] ([disputes on Connect](https://docs.stripe.com/disputes/connect), [manage risk](https://docs.stripe.com/connect/manage-risk)).

**Platform revenue:** Monoclay can earn through `application_fee_amount` on direct charges, or through a markup if it controls pricing (`fees.payer = application`). Platform-paid pricing has historically added per-active-account and per-payout fees (about $2 per active account per month and 0.25% + $0.25 per payout in the US) [I, verify current pricing].

**Recommendation for "not MoR" [I]:**
- **Default:** direct charges on connected accounts with `losses.payments = stripe` and `fees.payer = account`, plus an application fee. The hotel is settlement merchant, Stripe underwrites the hotel, disputes hit the hotel, and Monoclay earns a take rate.
- **Trade-off:** Monoclay cannot fully own pricing or a fully embedded onboarding UX. Stripe's KYC and dashboard are visible, and margin is limited to the application fee.
- **Avoid destination charges for room revenue.** Even with `on_behalf_of`, Monoclay's balance carries disputes. With prepaid stays sold months ahead, a hotel insolvency could leave Monoclay holding the chargebacks.

## B3. Adyen for Platforms

- Adyen offers two models, **Marketplace** and **Platform**, and the choice depends on business model and processing requirements [V] ([Adyen model](https://docs.adyen.com/adyen-for-platforms-model)).
- Accounts are structured as account holders and balance accounts. The platform has a **liable balance account**: if no chargeback split logic is configured, "Adyen withdraws the full disputed amount from the liable balance account of your platform" [V] ([platform structure](https://docs.adyen.com/platforms/account-structure-resources/platform-structure), [marketplace payments](https://docs.adyen.com/marketplaces/process-payments.md)).
- **Configure chargeback splits** so disputes are booked to the hotel's balance account [I].
- In Adyen's Platform model (software platform whose users sell to their own customers), users are generally the sellers. In the Marketplace model the platform sells users' goods [I]. Monoclay fits the **Platform** model.
- Adyen's own platform docs say high-risk categories onboard "as a payment facilitator" [V]. Expect travel/lodging to get extra underwriting, and possibly reserves or delayed payouts for prepaid stays [I].
- **Strengths [I]:** Adyen terminals are widely used in hospitality (Mews uses them; [Mews terminal terms](https://www.mews.com/fr/legal/terminal-terms)), along with strong European local methods, network tokens, and "unified commerce" tokens shared across card-present and card-not-present.
- **Weaknesses [I]:** higher minimum volumes and a heavier commercial process than Stripe for an early-stage vendor.

## B4. Checkout.com

Not researched this session (search budget exhausted). Checkout.com offers platform/sub-entity onboarding and is strong in the Middle East (UAE/KSA acquiring), which could matter for the UAE, Saudi and Maldives-adjacent markets [I, verify].

## B5. How incumbents structure payments

| Vendor | Structure | Source |
|---|---|---|
| **Mews Payments** | Mews "is not the principal payment or acquiring provider and does not hold funds". Third-party PSPs (Adyen/Stripe) provide services under a separate **Sub-Merchant Agreement**. The hotel can hold its own Adyen/Stripe account or use a Mews-operated merchant account. Mews' commission is deducted automatically from the PSP account. Merchant Terms v3.0 is marked effective "[1st October 2026]" in brackets. | [V] ([terms v3.0](https://www.mews.com/en/legal/merchant-terms), [help](https://mewssystems.freshdesk.com/support/solutions/articles/31000129943-payment-integrations)). A critique arguing Mews operates as a PayFac is [V2] ([MCC](https://merchantcostconsulting.com/lower-credit-card-processing-fees/mews-hotel-payment-processing-fees-breakdown/)). |
| **Cloudbeds Payments** | Provided by **Digital Arbitrage Payments, Inc. (dba Cloudbeds Payments)**, which states it is not a bank or money services business. Processing is under an **Adyen Marketplace Account Agreement** or Stripe Connect terms; Cloudbeds is not party to the processor terms. Stripe used since 2019. | [V] ([Adyen terms](https://www.cloudbeds.com/terms/cloudbeds-payments/adyen/), [Stripe case](https://stripe.com/customers/cloudbeds)) |
| **Shiji** | Shiji Payment Platform for processing and tokenization. "Digital PayBy" posts card details and payment results to the PMS, integrates with Shiji Enterprise Platform and OPERA (OWS), and exposes a payment-request API for other systems. | [V2] ([Shiji](https://shijigroup.com/brands/digital-payby)) |
| **Oracle (OPERA Cloud)** | **OPI Cloud** bridges OPERA Cloud to PSPs, "helps remove OPERA Cloud from PCI scope", keeps tokenization always on and does not persist card data. **PSPs must be certified with Oracle.** CRS bookings tokenize via the OHIP Tokenization API before the booking is created. | [V] ([OPI Cloud security guide](https://docs.oracle.com/en/industries/hospitality/payment-interface-cloud/23.1/scggc/F74518_01.pdf), [CRS secure payment](https://docs.oracle.com/en/industries/hospitality/integration-platform/crsig/c_1_secure_payment_data_processing.htm)) |

(ShijiReviewPro is a reputation product, not payments, and is out of scope.)

**Pattern [I]:** two models coexist.
- **Embedded payments** (Mews, Cloudbeds): a revenue line for the vendor, with the PSP as regulated party and the hotel as sub-merchant.
- **Bring your own PSP via certified gateway** (Oracle OPI): what enterprise groups with negotiated acquiring want.

Monoclay will eventually need both.

## B6. Hospitality payment mechanics

### Pre-authorization, extended and incremental authorization
- **Extended authorization** [V] ([Stripe](https://docs.stripe.com/payments/extended-authorization), [Terminal](https://docs.stripe.com/terminal/features/extended-authorizations)):
  - Visa lodging: 30 days (effectively 29 days 18 hours).
  - Amex lodging: 30 days, but capture must happen by the end of the stay.
  - Mastercard: 30 days for all categories.
  - Eligibility depends on merchant category and may need Stripe approval or IC+ pricing [V2].
- **Incremental authorization:** sources conflict on whether increments extend validity. One says Mastercard adds 30 days per increment and Visa does not [V2] ([Revolut](https://developer.revolut.com/docs/guides/merchant/operations/capture-and-settlement/advanced-authorisation/incremental-authorisation)). **Model authorization expiry per scheme in the folio engine** [I].
- **Design [I]:**
  - Model each folio's payment guarantee as a state machine: card-on-file token → pre-auth (with scheme expiry) → increments → partial capture(s) → release.
  - Auto-reauthorize before expiry on long stays.
  - Treat a release that never completes as a guest-complaint risk.

### Card-on-file, merchant-initiated transactions, SCA/3DS2 (EEA/UK)
- **EBA position:** when card details are taken as a guarantee, **setting up the mandate is subject to SCA**, and later payee-initiated charges fall under payee-initiated rules. Accepting the cancellation and charge terms is the cardholder's mandate, regardless of which party handled the booking [V] ([EBA 2019_4791](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4791), [2019_4792](https://eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4792), [2019_4794](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4794)).
- **Visa** classes **no-show charges as merchant-initiated transactions, outside SCA scope**, but requires proof of authentication when terms for future MITs are presented with the cardholder present [V] ([Visa travel guide](https://cy.review.visa.com/dam/VCOM/regional/ve/unitedkingdom/PDF/sca/visa-sca-guide-travel-hospitality.pdf), [Visa infographic](https://hu.review.visa.com/dam/VCOM/regional/ve/unitedkingdom/PDF/sca/visa-travel-merchants-sca-infographic-v3-14th-feb.pdf)).
- The MIT route only works if booking terms clearly disclose no-show and post-departure charges and the guest accepts them [V2] ([GuestCentric](https://blog.guestcentric.com/?p=33250)).
- **Design [I]:**
  - Booking engine: run 3DS2 at booking (or a zero-amount setup) and store the PSP's network transaction ID with the token.
  - Later charges: flag them as MIT (unscheduled card-on-file, no-show, delayed charge) referencing that ID.
  - OTA hotel-collect cards were not authenticated by the hotel, so charges on them often decline or are disputed. Prefer OTA virtual cards or prepayment for non-refundable rates.
  - Monitor the EU PSD3/PSR rewrite for changes to SCA and MIT rules [I].

### No-show and cancellation charges
- These need: (a) policy text versioned and snapshotted onto the reservation, (b) proof of acceptance (timestamp, channel, IP or OTA reference), (c) the MIT flag, and (d) an evidence pack ready for disputes [I].

### OTA virtual cards
- **Booking.com VCC activation dates conflict across sources:** arrival day (Cloudbeds), check-in day (Preno), or the **day after check-in** (myallocator, plus a Booking.com community notice of a change). Funds may arrive **up to 5 days after activation** [V2] ([Cloudbeds](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/44061325834779-Booking-com-VCC-FAQ), [Preno](https://help.prenohq.com/en/articles/15819642-charging-booking-com-virtual-credit-cards), [myallocator](https://myallocator.cloudbeds.com/hc/en-us/articles/4408601390875-Booking-com-Virtual-Credit-Card-VCC-Everything-you-need-to-know), [RoomRaccoon](https://contact.roomraccoon.com/en/support/solutions/articles/150000214174-why-some-booking-com-virtual-credit-cards-vccs-are-not-autocharged-on-the-activation-date)).
- Booking.com's "Payments Clarity" exposes VCC balance, activation and expiry data to PMS/channel managers [V2].
- Cloudbeds purges VCC data 14 days after check-out [V2].
- Expedia and Booking.com VCCs can be auto-charged via distribution hubs [V2] ([Guestline](https://help-guestpay.theaccessgroup.com/en/articles/13113537-guestline-guestpay-virtual-card-automation-for-vcc-faqs), [Guesty](https://help.guesty.com/hc/en-gb/articles/32452340238365)).
- **Design [I]:**
  - Store VCC metadata (activation date, amount, currency, expiry) separately from the card token.
  - Schedule charges from the per-reservation activation date, not a global rule.
  - Retry with backoff for funding delays.
  - Charge only the exact VCC amount.
  - Treat these as card-not-present corporate cards, which are generally outside SCA. Confirm the exemption flags with the PSP.

### Tokenization and staying out of PCI scope
- **Guest-entered cards:** use PSP hosted fields or drop-in components (Stripe Elements, Adyen Components). Monoclay never sees card numbers [I].
- **Front desk:** use PSP-integrated terminals (Stripe Terminal, Adyen terminals), with tokens shared between in-person and online so a card captured at check-in can be charged later [I].
- **OTA-supplied cards** (hotel-collect bookings, VCCs) arrive as raw card data in reservation payloads. **Route these through a PCI proxy or vault**, e.g. Channex PCI [V] or third-party vaults/proxies [I], which forwards the card number directly to the PSP for tokenization. The Monoclay database then holds only tokens.
- Payment links for deposits or balances: generate PSP-hosted links (Stripe Payment Links / Checkout with Connect [V] ([Stripe](https://stripe.com/docs/connect/payment-links)), Adyen Pay by Link). Expose link status by webhook.

### Chargebacks and disputes [I]
- Common lodging dispute families: fraud (card-absent), "services not provided", "cancelled services", "duplicate or incorrect amount".
- Winning evidence: the signed or e-signed registration card, the policy acceptance snapshot, the 3DS result, folio itemisation, guest communications, and check-in/out logs (door-lock logs if available).
- Build a one-click evidence export per reservation, and pass PSP dispute webhooks into a hotel task queue with deadlines.

## B7. Idempotency and correctness for payment APIs

**Stripe semantics** [V] ([Stripe idempotency](https://docs.stripe.com/api/idempotent_requests)):
- Stripe stores the **status code and body of the first request** for a key, including 500 errors, and replays it.
- Keys may be purged after **24 hours**, and can be up to 255 characters. Use V4 UUIDs or similar high-entropy values.
- Keys apply to POST requests only and have no effect on GET or DELETE.

**Monoclay patterns [I]:**
1. **One key per logical business operation**, e.g. `folio:{id}:capture:{seq}`, generated and **persisted in Monoclay's database before calling the PSP**, then reused on every retry. A user clicking twice on purpose is a new operation with a new sequence number.
2. **Transactional outbox:** write the payment intent record and the outbox event in the same database transaction. A worker calls the PSP and records the result. Webhooks reconcile the final state.
3. **Webhook ingestion:** deduplicate on the PSP event ID, verify signatures, and allow for out-of-order delivery (fetch the latest object state instead of trusting event order).
4. **Retry windows longer than 24h** (e.g. VCC funding retries over days) must not rely on the PSP's key retention. Check Monoclay's own ledger for an existing successful capture before re-issuing.
5. **Daily reconciliation** of PSP balance transactions against the Monoclay folio ledger, with alerts on mismatches.
6. Apply the same idempotency discipline to **reservation ingestion** (A9) and **fiscal document issuance** (C3). Fiscal numbering must be gapless, so a retry must never consume a new invoice number.

---

# Part C: Compliance and tax

## C1. GDPR and UK GDPR

**Roles [V2/I]**
- Monoclay is a **processor** for hotels' guest data and a controller only for its own customer, billing and product-telemetry data.
- PMS vendors forward guest erasure requests to the hotel, which decides in light of tax retention duties [V2] ([SabeeApp](https://www.sabeeapp.com/knowledge-base/how-to-anonymise-guest-data-in-sabeeapp-according-to-gdpr)).

**Erasure versus retention**
- Article 17(3)(b) exempts data needed to comply with a legal obligation, so fiscal records containing personal data must be kept for the statutory period, typically 6–10 years depending on country [V2] ([Miramis](https://miramis.co/content-hub/data-retention), [HOTREC guidance via HotellerieSuisse](https://hotelleriesuisse.ch/fileadmin/user_upload/documents/01_Leistungen___Support/02_Recht/01_Rechtsangebote/Rechtsfragen_A-Z/D-1017-246-MM-_Note_Data_Protection_-_HOTREC_guidelines.pdf)).
- Germany shortened retention for accounting vouchers from 10 to 8 years from 2025 [I].

**Design [I]**
- A **per-data-category retention schedule** configurable per hotel and country:
  - guest profile and marketing: consent-bound;
  - reservations: contract period plus limitation period;
  - fiscal invoices and folios: statutory period;
  - police registration data: often short;
  - card tokens: until the guarantee or no-show window ends.
- **Erasure = pseudonymise or anonymise** everything except fiscal documents, which are locked as immutable records and fully deleted when retention expires.
- Keep anonymised aggregates so reports still work [V2].

**Data residency [I]**
- GDPR does not require EU hosting, but enterprise European groups routinely expect **EU-hosted primary data**, an EU sub-processor list, and SCCs or DPF coverage for any US sub-processors.
- The UK, Saudi Arabia (PDPL), UAE (PDPL, with free-zone regimes such as DIFC and ADGM) and India (DPDP Act 2023) each add transfer rules. Plan for **regional deployments** (EU, plus US, plus a Gulf region if KSA government or semi-government hotels are targeted).

**Guest-registration (police) laws** are a GDPR-adjacent obligation PMSs must support:
- Italy's **Alloggiati Web** (State Police) [V2] ([Chekin](https://chekin.com/en/blog/police-connection-to-register-guests-in-italy)).
- Spain's **RD 933/2021 / SES.HOSPEDAJES** (extensive data including payment data, from Dec 2024) [I].
- Portugal's SIBA/AIMA, France's police form for foreigners, India's Form C for foreign nationals [I].
- Germany abolished the registration duty for German nationals from 2025 [I].

## C2. PCI DSS v4.0.1 for a platform using hosted fields

- **SAQ A revision (Jan 2025):** removed requirements **6.4.3** (payment-page script inventory and authorisation), **11.6.1** (change and tamper detection) and **12.3.1**. It added an eligibility criterion that the merchant confirm its site is **not susceptible to attacks from scripts** that could affect its e-commerce systems, using techniques "such as" those in 6.4.3 and 11.6.1, deployed by the merchant or a third party. Effective **31 Mar 2025** [V2/V] ([PCI SSC blog](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants), [Jscrambler](https://jscrambler.com/blog/saq-a-new-eligibility-criteria/), [Integrity360](https://insights.integrity360.com/important-update-on-pci-dss-saq-a-eligibility-criteria), [Report URI](https://blog.report-uri.com/pci-dss-4-0-1-saq-a-and-client-side-security-a-plain-english-faq/)).
- Sources disagree on whether the criterion only bites for iframe embeds. Check PCI SSC FAQ 1588 [V2].
- Adyen also publishes SAQ A eligibility guidance [V] ([Adyen](https://docs.adyen.com/development-resources/pci-dss-compliance-guide/saq-a-eligibility)).

**What this means for Monoclay [I]:**
- **Hotels (merchants):** with PSP-hosted iframes or redirects on Monoclay-served booking and check-in pages, hotels can aim for **SAQ A**. Their eligibility relies on Monoclay's page security, which in practice means:
  - Content Security Policy;
  - Subresource Integrity on scripts;
  - a script inventory;
  - change detection on payment pages.
  Ship these and document them in a **PCI responsibility matrix**.
- **Monoclay (service provider):** if Monoclay never stores, processes or transmits card data, because OTA cards go through a proxy and front-desk cards go through terminals, its scope shrinks to "could impact the security of cardholder data". Enterprise RFPs and the OTAs (Booking.com expects PCI compliance [V]) will still ask for a **service-provider AOC**. Budget for a QSA-assessed AOC by the time enterprise sales start.
- If Monoclay ever receives raw OTA card data directly, it falls into full SAQ D for service providers or a ROC. The proxy approach avoids this.

## C3. Fiscalization, e-invoicing and lodging taxes by country

**General design [I]:** every regime below needs some combination of the following. Build them once as platform primitives and plug country "fiscal adapters" on top, preferably via fiscal middleware (fiskaly, fiscaltrust, Invopop and similar [V2: [fiskaly Italy PMS](https://www.fiskaly.com/e-invoice-italy-pms), [fiskaly SIGN PT](https://workspace.fiskaly.com/blog/2026-sign-pt-launch/), [Invopop Portugal](https://docs.invopop.com/compliance/portugal)]).
- immutable, sequential, gapless document numbering per series;
- signed or hash-chained records;
- a regulated export format;
- real-time or near-real-time submission to the tax authority;
- QR codes or IDs printed on documents;
- B2B structured e-invoices;
- configurable per-night and per-person lodging taxes.

| Country | Obligation affecting a hotel PMS | Status / dates | Tag and source |
|---|---|---|---|
| **Germany** | **KassenSichV:** electronic recording systems with a cash function, including hotel software that records cash or card payments, need a certified **TSE** (usually cloud TSE). Systems must be reported to the tax office. **GoBD:** immutable, complete, traceable records with a data-export format (DSFinV-K for cash systems [I]). | TSE in force (transition ended 2021). Electronic reporting of systems via ELSTER from 2025 [I]. | [V2] ([SabeeApp DE](https://www.sabeeapp.com/compliance/germany), [Access Group](https://www.theaccessgroup.com/de-de/blogs/hos-hotelkassen-muessen-bis-30-september-2021-gesetzeskonform-sein/), [Cloudbeds DE](https://myfrontdesk.cloudbeds.com/hc//articles/20108125522971-Government-Compliance-Germany), [fiskaly integration example](https://www.clock-software.com/products/integrations/fiskaly-fiscalization)) |
| Germany (e-invoicing) | B2B **receipt** of structured e-invoices (XRechnung/ZUGFeRD) since 1 Jan 2025. **Issuing** required from 2027 for businesses over €800k turnover, and from 2028 for all. Invoices of €250 gross or less are exempt. Matters for corporate and MICE folios. | 2025 / 2027 / 2028 | [V2] ([BDO](https://www.bdo.de/en-gb/insights/publishments/tax-legal/e-invoicing-in-germany), [Advisori](https://www.advisori.de/en/blog/e-invoicing-mandate-germany)) |
| **Austria** | **RKSV:** cash register with a signature-creation unit, chained signatures and signed receipts once **annual turnover exceeds €15,000 AND cash takings exceed €7,500** per business. Card payments on site count as cash; online transfers do not. | In force | [V] ([USP.gv.at](https://www.usp.gv.at/themen/steuern-finanzen/steuerliche-rechte-und-pflichten/registrierkassen/registrierkassenpflicht.html), [BMF](https://www.bmf.gv.at/themen/steuern/fuer-unternehmen/registrierkassen.html), [WKO](https://www.wko.at/oe/austriaguides/registrierkassenpflicht.pdf)) |
| **Italy** | **Corrispettivi telematici:** daily takings sent via a telematic recorder (RT) or the free Agenzia delle Entrate web procedure. Hotels may instead issue **e-invoices via SdI** for stays. B2B and requested invoices go through SdI (FatturaPA XML). **Alloggiati Web** daily guest reporting to the police. ISTAT statistics and municipal tourist tax are also needed [I]. POS-RT linking obligations from 2026 [I]. | In force | [V2] ([Fiscal Focus](https://www.fiscal-focus.it/hotel-fattura-registratore-telematico,3,182778), [Agenda Digitale](https://www.agendadigitale.eu/documenti/esperto-risponde/registratore-telematico-ecco-perche-non-e-obbligatorio-se-si-emettono-fatture-elettroniche/), [Il Sole 24 Ore](https://ntplusfisco.ilsole24ore.com/art/corrispettivi-telematici-regole-le-attivita-alberghiere-ACbnen0), [Cloudbeds IT](https://myfrontdesk.cloudbeds.com/hc//articles/20107128833563-Government-Compliance-Italy)) |
| **France** | **Anti-fraud cash-software rule (NF525 or equivalent):** systems recording B2C payments must meet four conditions: tamper-proofing, security, retention, archiving. The 2025 Finance Law would have required third-party certification only. Secondary sources say the **2026 Finance Law (Feb 2026) reinstated editor self-attestation**, so certification by a body (e.g. NF525) **or** an editor attestation now both suffice. Whether a PMS counts as "cash software" depends on whether it records payments; assume yes [I]. | Reversal reported Feb 2026 | [V2] ([Tunder](https://tunder.co/en/blog/letat-reporte-officiellement-la-certification-obligatoire-des-logiciels-de-caisse-au-1er-septembre-2026), [Independant.io](https://independant.io/norme-nf525/), [Hayot](https://hayot-expertise.fr/blog/logiciel-caisse-restaurant-nf525-comparatif-2026)). Verify against the Finance Law text. |
| France (e-invoicing) | **Receipt** of e-invoices via approved platforms (PA/PDP) mandatory for all VAT businesses from **1 Sep 2026**. **Issuing plus e-reporting** for large and mid-sized companies from 1 Sep 2026, and for SMEs and micro-businesses from 1 Sep 2027. **B2C hotel sales fall under e-reporting** (transaction and payment data), not e-invoicing. | Live for receipt as of this report | [V2] ([Fonoa](https://www.fonoa.com/resources/blog/french-e-invoicing-reform), [Fiscal Requirements](https://www.fiscal-requirements.com/news/4666-france-mandatory-e-invoicing-deadlines-and-common-misconceptions), [BDO](https://www.bdo.be/en-gb/insights/articles/2026/france%E2%80%99s-e-invoicing-reform-what-companies-with-french-entities-need-to-know)) |
| **Portugal** | Invoices must come from **AT-certified software**, with an **ATCUD** code and **QR code**, plus monthly **SAF-T (PT)** submission. PDFs from certified software count as e-invoices only under a transitional regime. From **1 Jan 2027**, a **qualified electronic signature** on PDFs or structured CIUS-PT is required. Fines of €3,000–18,750 for uncertified software. Applies to non-residents registered for VAT. | 2027 change ahead | [V2] ([Zone & Co](https://www.zoneandco.com/articles/e-invoicing-portugal-compliance-guide), [Invopop](https://docs.invopop.com/compliance/portugal), [Fiscal Requirements](https://www.fiscal-requirements.com/news/5503-portugal-e-invoicing-no-b2b-clearance-mandate-but-strict-digital-tax-controls)). **Software certification is per product.** Monoclay itself must be certified by AT [I]. |
| **Spain** | **Verifactu** (RD 1007/2023): invoicing software must chain and hash records and optionally submit them in real time; a QR code appears on invoices. **RDL 15/2025** set **1 Jan 2027** (corporate taxpayers) and **1 Jul 2027** (others). On **5 Oct 2026** Hacienda announced a further delay to **Oct 2028**, aligned with SME e-invoicing, but this is **not yet in the BOE**. Technical requirements are unchanged. The Basque Country uses **TicketBAI** instead [I]. SES.HOSPEDAJES guest registration also applies [I]. | 2027 legally binding; 2028 announced | [V] ([Forvis Mazars](https://www.forvismazars.com/es/en/insights/latest-news/tax-alert-royal-decree-law-15-2025), [KPMG](https://assets.kpmg.com/content/dam/kpmgsites/es/pdf/2025/12/tax-alert-english-new-rd-law-postponement-verifactu.pdf.coredownload.inline.pdf)); 2028: [V2] ([Qamarero](https://qamarero.com/blog/verifactu-retraso-octubre-2028/), [Billeo](https://www.billeo.es/blog/retraso-verifactu-2028-que-hacer)) |
| **Saudi Arabia** | **ZATCA Fatoora Phase 2:** UBL XML, cryptographic stamp and QR code. Real-time **clearance** for B2B standard invoices; **reporting within 24h** for simplified (B2C) invoices [I]. Each solution or device is onboarded as an e-invoice generation unit (EGS) [I]. Thresholds: Wave 23 above SAR 750k (due 31 Mar 2026); Wave 24 above SAR 375k (30 Jun 2026); **Wave 25 above SAR 187.5k, due 1 Feb 2027**. Taxpayers get at least 6 months' notice. Effectively all VAT-registered hotels are now in scope. | Wave 25 ahead | [V2] ([EY W24](https://taxnews.ey.com/news/2025-2023-saudi-arabia-announces-24th-wave-of-phase-2-e-invoicing-integration), [EY W23](https://www.ey.com/en_gl/technical/tax-alerts/saudi-arabia-announces-23rd-wave-of-phase-2-e-invoicing-integration), [VATupdate W25](https://www.vatupdate.com/2026/08/05/ksa-zatca-announces-e-invoicing-readiness-for-wave-25/), [Grant Thornton W25](https://www.grantthornton.sa/globalassets/_markets_/sau/media/pdfs/gtksa_zatca-wave-25-e-invoicing-english-arabic.pdf)) |
| **UAE** | **E-invoicing** (Ministerial Decisions 243 and 244 of 2025): Peppol-based "5-corner" model, PINT-AE format, via **accredited service providers**. Pilot from Jul 2026. Businesses with **AED 50m+** revenue: per the amended timeline (MD 66/2026) appoint an ASP by about 30 Oct 2026 and go live **1 Jan 2027**. Others from 1 Jul 2027; government 1 Oct 2027. **B2C excluded for now.** | Imminent for large groups | [V2] ([KPMG](https://kpmg.com/ae/en/insights/tax-insights/implementation-of-the-electronic-invoicing-system-in-the-uae.html), [Grant Thornton](https://www.grantthornton.ae/insights/articles2/e-invoicing-in-the-uae-legal-foundations-phased-rollout-and-strategic-implications/), [Sovos](https://sovos.com/regulatory-updates/vat/uae-mandatory-e-invoicing-deadlines-announced/), [Fiscal Requirements](https://www.fiscal-requirements.com/news/5357-uae-e-invoicing-legal-framework-and-implementation-updated-2026)). Dates conflict across sources; verify with the Ministry of Finance. |
| UAE (Dubai lodging fees) | **Tourism Dirham:** per occupied room per night by classification: AED 20 (5★), 15 (4★), 10 (3★), 7 (1–2★/budget). Hotel apartments and holiday homes AED 10–15 (sources conflict). **Maximum 30 consecutive nights.** If classification changes mid-stay, it is calculated per night. Collected by the property. Dubai also levies a municipality fee and service charge, plus 5% VAT; Abu Dhabi has its own tourism and municipality fees [I]. | In force | Rules: [V] ([Dubai Admin. Resolution 2/2020](https://dlp.dubai.gov.ae/Legislation%20Reference/2020/Administrative%20Resolution%20No.%20(2)%20of%202020%20Prescribing%20the%20Rules%20for%20Calculating,%20Collecting,%20and%20Paying%20the%20Tourism%20Dirham%20Fee%20in%20the%20Emirate%20of%20Dubai.html)); rates [V2] ([Arabian Business](https://www.arabianbusiness.com/industries/travel-hospitality/guide-dubai-s-tourism-dirham-scheme-544516)) |
| **India** | **GST e-invoicing** (IRN and signed QR from the Invoice Registration Portal) for B2B invoices, for taxpayers with aggregate annual turnover above ₹5 crore [I, threshold not re-verified]. From **1 Apr 2025**, businesses with turnover of **₹10 crore or more must report e-invoices within 30 days** or the portal rejects them. **Hotel GST (from 22 Sep 2025):** rooms **at or below ₹7,500 per unit per night: 5% without input tax credit**; above: 18% with credit. The threshold applies per room per night, and sources conflict on declared versus actual tariff. Foreign-guest Form C reporting [I]. | In force | [V] ([GSTN advisory](https://www.mahagst.gov.in/public/uploads/gstnadvisory/1760531580_293%20Advisory%20Time%20Limit%20for%20Reporting%20e%20Invoice%20on%20the%20IRP%20Portal%20%20Lowering%20of%20Threshold%20to%20AATO%2010%20Crores%20and%20Above.pdf), [Taxmann](https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/)); GST rate [V2] ([VATupdate](https://www.vatupdate.com/2025/09/18/finance-ministry-confirms-no-itc-for-hotel-rooms-under-rs-7500-with-5-gst-rate/), [AxisRooms](https://blog.axisrooms.com/hotel-gst/)) |
| **Maldives** | **TGST 17%** from 1 Jul 2025 (previously 16%). **Green tax** from 1 Jan 2025: **$12 per person per night** for resorts, integrated resorts, tourist vessels, uninhabited-island properties and inhabited-island properties with more than 50 rooms; **$6** for 50 rooms or fewer on inhabited islands. **Service charge** is customarily 10%; its legal treatment (distribution to staff, tax base) was not verified. MIRA filing formats were not researched. | In force | [V] ([KPMG](https://kpmg.com/us/en/taxnewsflash/news/2024/11/tnf-maldives-amendments-gst-tourism-act-airport-fees-ratified.html), [Atoll Times](https://atolltimes.mv/post/news/10320), [Travel Trade Maldives](https://www.traveltrademaldives.com/?p=73459)); service charge [I] |
| **United States** | **FTC Rule on Unfair or Deceptive Fees** (effective **12 May 2025**): for **short-term lodging**, the **total price including all mandatory fees** (e.g. resort fees) must be shown clearly, conspicuously and **more prominently** than other pricing. Government taxes and optional amenities may be excluded. Covers hotels, rentals and third-party platforms. **Occupancy taxes:** layered state, county and city rates, often with special districts. OTA marketplace-facilitator rules vary by state (e.g. West Virginia from 2022; Washington exempts OTAs). No comprehensive public database of local rates. | In force | FTC rule [V] ([Federal Register](https://www.govinfo.gov/content/pkg/FR-2025-01-10/html/2024-30293.htm), [FTC PDF](https://www.ftc.gov/system/files/ftc_gov/pdf/r207011_udf_rule_2024_final_0.pdf), [Hotel Dive](https://www.hoteldive.com/news/ftc-junk-fees-rule-takes-effect-hotels/747738/), [NatLawReview FAQ](https://natlawreview.com/article/ftc-rule-unfair-or-deceptive-junk-fees-faqs)); occupancy [V2] ([Avalara](https://www.avalara.com/us/en/blog/OTAs-tax-collection-remittance.html), [Ryan](https://ryan.com/insights/hotel-owners-operators-tax-compliance), [WV Tax](https://tax.wv.gov/Business/HotelOccupancyTax/)) |

**What the tax engine must handle [I], derived from the table:**
- percentage taxes (VAT/GST/TGST, sometimes compounding on service charge);
- per-room-night amounts by property classification (Dubai);
- per-person-per-night amounts by property type (Maldives);
- price-band rate switching per room-night (India's ₹7,500 threshold);
- stay-length caps (Dubai's 30 nights);
- exemptions (long-stay exemptions in many US jurisdictions [I]);
- jurisdiction-by-address lookups (US);
- inclusive versus exclusive display, so FTC "total price" logic and Google price accuracy share **one price computation service**.

## C4. SOC 2, ISO 27001 and enterprise security expectations

- **SOC 2 Type II** is the baseline expectation for cloud hotel software [V2]. Mews publicised completing a SOC 2 Type 2 examination [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4116622.html)). Visual Matrix did the same [V2] ([HTR](https://hoteltechreport.com/news/visual-matrix-achieves-soc-2-certification-reinforcing-data-security-and-platform-reliability)).
- **ISO 27001** is not interchangeable with SOC 2. European and Middle Eastern groups often ask for ISO 27001 specifically [V2/I].
- Typical security-review pack: SOC 2 Type II report, ISO certificate, penetration-test summary, SIG or CAIQ questionnaire, PCI AOC [V2].
- **NIST SP 1800-27** (securing PMS) is a voluntary US reference that sophisticated buyers may cite [V2] ([Baker Donelson](https://bakerdonelson.com/nist-publishes-guidelines-aimed-at-enhancing-hotel-property-management-system-security)).

---

# Part D: Market context

## D1. Market size

| Source | 2025 estimate | Forecast | Note |
|---|---|---|---|
| Global Market Insights | $3.8bn | $8.5bn by 2034 (9.2% CAGR) | Cloud above 80% share in 2024 [V2] ([GMI](https://www.gminsights.com/industry-analysis/hotel-property-management-system-market)) |
| HTF MI | $1.82bn | $4.76bn by 2034 | Cloud 72% / on-premise 28% in 2025 [V2] ([HTF](https://www.htfmarketintelligence.com/report/global-hotel-pms-software-market)) |
| Mordor Intelligence | $1.62bn (2026: $1.73bn) | $2.44bn by 2031 (7.05% CAGR) | [V2] ([GII/Mordor](https://www.giiresearch.com/report/moi2123307-hospitality-property-management-software-pms.html)) |
| Report Prime | $1.22bn | $2.53bn by 2032 (11% CAGR) | [V2] ([Report Prime](https://www.reportprime.com/undefined-r11592)) |

**Takeaway [I]:** licence and subscription revenue for the PMS category alone is roughly **$1.5–4bn**, growing high-single to low-double digits. The bigger prize is payments: embedded-payments take rates on gross booking value are worth multiples of the SaaS fee per hotel, which is why Mews and Cloudbeds invest heavily in fintech.

## D2. Vendor landscape

Vendor-level share data was not found in free sources [V2: none of the market reports exposed it]. Background picture [I, not verified]:
- **Oracle OPERA / OPERA Cloud** dominates upscale and branded chains.
- **Mews**, **Cloudbeds**, **Shiji (Daylight / Enterprise Platform)**, **Infor HMS**, **Protel (Planet)**, **Apaleo**, **Stayntouch**, **RMS**, **Hotelogix**, **eZee** and many regional players compete in cloud and mid-market.
- Branded hotels are constrained by **brand-mandated or brand-certified PMS lists** and brand CRS/loyalty interfaces, which is a high barrier for a new vendor.

## D3. Pricing

- General range: **$4–15 per room per month**. One breakdown: budget $2–5, mid-market cloud $5–12, enterprise $15–30+ [V2] ([Hotelogix](https://www.hotelogix.com/blog/hotel-pms-pricing), [SmartOrder](https://www.smartorder.ai/resources/blog/hotel-pms-pricing-comparison-2026/), [Costbench](https://costbench.com/stats/hotel-management-pricing-2026/)).
- **Mews:** quote-based, per room per month. Estimates range from about €6–12 to about $17 at the entry tier, with property minimums [V2] ([MakerStack](https://makerstack.co/reviews/mews-review/), [HTR comparison](https://hoteltechreport.com/compare/cloudbeds-myfrontdesk-vs-mews-vs-opera)).
- **Cloudbeds:** about $15 per room per month, or flat $180–$1k per month for small properties [V2].
- **OPERA Cloud:** thin data; about $6–8 per room cited, often with large minimums [V2].
- Typical add-on revenue: payments (take rate), channel manager, booking engine, guest app/kiosk, revenue management, and per-interface fees for POS and door locks [I].

## D4. Sales cycles and RFP requirements

Not verified this session (search budget exhausted). Background and inference [I]:

**Sales cycles**
- Independent hotels: **2–8 weeks** to sign. Implementation days to weeks, driven by data migration and OTA remapping.
- Small groups (5–30 hotels): **3–6 months**.
- Enterprise and management companies: **9–18+ months**, typically including an RFP, security review, pilot property, and phased rollout over 1–3 years.
- Contract terms: 1–3 years for independents, 3–5 for enterprise.

**Typical RFP and security requirements**
- **Security and compliance:** SOC 2 Type II and/or ISO 27001; PCI service-provider AOC; annual penetration test; GDPR data processing agreement with sub-processor list and EU hosting; vulnerability disclosure and incident-notification SLAs (e.g. 24–72h); cyber insurance.
- **Identity:** **SSO via SAML 2.0 / OIDC** with Entra ID and Okta; **SCIM** provisioning; granular role-based access across group, brand, property and department; MFA enforcement; full audit logs.
- **Reliability:** **99.9%–99.95% uptime SLA** with service credits; stated RPO/RTO; multi-AZ or multi-region DR; status page; **offline continuity** (cached arrivals and in-house reports, emergency room-key encoding).
- **Integration:** open documented API and webhooks; certified interfaces to POS (Oracle Simphony, Lightspeed and others), door locks (ASSA ABLOY, dormakaba, Salto), revenue management (IDeaS, Duetto), CRS (Sabre SynXis, Amadeus), GDS through CRS, accounting/ERP and BI exports; channel manager; payments with PSP choice.
- **Operational:** multi-currency and multi-language; per-country fiscal compliance (C3); data export on exit; named customer success manager; 24/7 support with SLAs; training and migration services.

---

# Key decisions this forces on Monoclay

Each decision gives a recommendation and its trade-offs. All recommendations are tagged [I].

1. **Payments role: technology platform, hotel as merchant of record.**
   - *Recommend:* hotels are always the settlement merchant and legal seller. Monoclay never holds funds. Use **Stripe Connect direct charges** with Stripe-borne losses (`losses.payments=stripe`, `fees.payer=account`) plus an application fee as the default embedded offer. Use **Adyen for Platforms (Platform model)** with chargeback splits to the hotel balance account for EU-heavy, terminal-heavy or larger customers. Write merchant terms like Mews' ("not the principal payment or acquiring provider and does not hold funds").
   - *Trade-offs:* lower take rate and less control over pricing and onboarding than Custom-style accounts. Monoclay avoids hotel-insolvency chargeback exposure, licensing (EMI/PI/money transmitter) and reserve management. A PayFac-like model with Monoclay holding losses can be revisited once Monoclay has data to underwrite hotels.

2. **Embedded-only or bring-your-own-PSP.**
   - *Recommend:* design a **PSP-agnostic payment domain**: tokens, authorizations, captures, refunds, disputes and MIT references are first-class objects, and PSPs are adapters. Ship one embedded PSP first (Stripe for speed), add Adyen second, and offer **BYO-PSP for enterprise** through the same adapters, as Oracle does with OPI.
   - *Trade-offs:* more upfront abstraction work. Without it, enterprise groups with negotiated acquiring will rule Monoclay out.

3. **PCI scope: Monoclay must never store card numbers.**
   - *Recommend:* PSP hosted fields and terminals for guest cards; a **PCI proxy or vault for OTA-supplied cards** (Channex PCI if using Channex, otherwise a standalone vault). Card tokens only in Monoclay's databases. Ship CSP/SRI/script monitoring on payment pages so hotels can stay on SAQ A. Obtain a **PCI service-provider AOC** before enterprise sales.
   - *Trade-offs:* proxy fees and some vendor lock-in, versus avoiding SAQ D/ROC scope across the whole engineering organisation.

4. **Distribution: hub-first, direct later.**
   - *Recommend:* **Channex white-label at launch** (about $7 per hotel per month) for all OTAs including Airbnb. **Direct Google ARI and free booking links from day one.** Re-evaluate direct Booking.com and Expedia (GraphQL plus webhooks) at about 500–1,000 properties.
   - *Trade-offs:* dependence on a single hub (mitigate with contractual exit, mapping export and an adapter boundary), and no OTA partner-tier badges early on. In exchange, months of certification and permanent deprecation upkeep are avoided.

5. **Internal distribution model.**
   - *Recommend:* a canonical ARI and reservation domain model (room types, rate plans with derived rates, restrictions, occupancy pricing), with OTA XML, Channex JSON and Google ARI as adapters. Reservations are stored as an **immutable revision log** and ingested idempotently. ARI is coalesced and periodically fully resynced.
   - *Trade-offs:* more upfront modelling work. Without it, partner dialects leak into the core and every deprecation becomes a cross-cutting change.

6. **Fiscalization architecture and launch-country sequencing.**
   - *Recommend:* from day one, build an **immutable fiscal-document ledger** (gapless series, hash chaining, signed exports, idempotent issuance) and a **country fiscal-adapter interface**. Buy middleware (fiskaly, fiscaltrust, Invopop or similar) rather than build per-country signing. Treat each country's fiscal pack as a **market-entry gate**. Lighter-burden markets (UK, Ireland, Netherlands, US, UAE before 2027) can launch first. DE, AT, IT, FR, PT, ES and KSA each need a dedicated compliance release; Portugal also needs AT software certification.
   - *Trade-offs:* slower geographic expansion. Shipping into a fiscal market without compliance exposes hotels to fines and Monoclay to reputational loss.

7. **Tax and fee engine plus price display.**
   - *Recommend:* one **price-computation service** used by the PMS folio, booking engine, Google ARI and OTA feeds. It must support percentage, per-room-night, per-person-night, classification-based, banded, capped and exempt rules, and US all-in display (mandatory fees in the headline price). Integrate a US lodging-tax rate provider rather than maintain rates manually.
   - *Trade-offs:* complexity, but this is required for FTC compliance and Google price accuracy, and it is a differentiator.

8. **Data residency and regional deployment.**
   - *Recommend:* **EU primary region at launch** (EU-hosted data, EU support access controls). Make the architecture cell- or region-capable so US and Gulf (KSA/UAE) regions can follow. Publish a DPA, sub-processor list, and transfer mechanisms (SCCs/DPF).
   - *Trade-offs:* more cost and operational complexity, but data residency is a recurring RFP gate in Europe and the Gulf.

9. **GDPR erasure versus fiscal retention.**
   - *Recommend:* a per-category, per-country retention schedule. Erasure means anonymising the guest profile and operational data while **locking fiscal documents** until retention expires, then purging. Police-registration exports are short-lived.
   - *Trade-offs:* more engineering, but this resolves the conflict between erasure requests and statutory retention up front.

10. **Security certification roadmap.**
    - *Recommend:* SOC 2 Type I within about 6 months and Type II within about 12–15 months. **ISO 27001** in parallel if targeting EU or Gulf enterprise. SSO (SAML/OIDC), SCIM, role-based access across group/property and audit logs in the first enterprise-ready release. Map controls to NIST SP 1800-27 for US buyers.
    - *Trade-offs:* about $100–250k per year in audit and tooling [I]. Without it, enterprise and group deals stall at security review.

11. **Target segment at launch.**
    - *Recommend:* **independent and small-group hotels (20–300 rooms)** in one or two lighter-fiscal markets. They have short sales cycles, high payments attach rates, and no brand-certification barrier. Defer branded or flagged hotels until brand CRS/loyalty interfaces and certifications are justified.
    - *Trade-offs:* lower contract values and more self-serve churn, but faster learning and payments revenue sooner.

12. **Pricing model.**
    - *Recommend:* **per room per month in the $6–12 band** (mid-market cloud), including the channel manager. The about $0.12 per room hub cost is easily absorbed. Payments are priced as a separate take rate on processed volume.
    - *Trade-offs:* bundling the channel manager reduces upsell revenue but removes a reason for hotels to choose a third-party channel manager, and keeps Monoclay in the reservation data path, which is central to the payments attach rate.

13. **Payment flows to support at GA (general availability)**, in priority order.
    - *Recommend:*
      1. card-on-file with 3DS2 at booking and MIT-flagged later charges;
      2. extended and incremental pre-auth with scheme-aware expiry and automatic re-authorization;
      3. OTA virtual-card auto-charge driven by per-reservation activation dates and retry on funding delay;
      4. payment links;
      5. terminals with tokens shared between in-person and online;
      6. a dispute evidence pack.
    - Build all PSP calls with persisted idempotency keys, an outbox, webhook deduplication and daily reconciliation.
    - *Trade-offs:* none of these is optional for hotels. They are the minimum hotels expect from an embedded payments product.

---

## Appendix: Open items to verify next

1. Booking.com's current acceptance policy for new connectivity providers and onboarding checklist (needs `developers.booking.com` allow-listed or a call with Booking.com Connectivity).
2. Expedia EQC AR/Product API current state and the test-property process; GraphQL lodging-supply coverage for ARI (not only reservations).
3. Channex contract terms: SLA, exit and mapping export, PCI responsibility split, Expedia certification status, and whether volume tiers apply to all units or only marginal units.
4. Stripe Connect current platform pricing; Adyen Platform-model MoR wording; Checkout.com's platform offer for UAE and KSA.
5. Spain RD 933/2021 (SES.HOSPEDAJES) data fields, and whether the Verifactu October 2028 delay has been published in the BOE.
6. France 2026 Finance Law text on NF525 self-attestation; whether PMS payment recording falls under the cash-software rule.
7. India e-invoicing turnover threshold (₹5 crore) and the current notification; Maldives service-charge law and MIRA invoice format requirements.
8. Vendor market share (paid reports or Hotel Tech Report data) and enterprise RFP templates from target groups.
