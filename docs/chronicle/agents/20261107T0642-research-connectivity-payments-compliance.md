# Agent run: Research connectivity, payments, compliance

- Started: 2026-11-07T06:42:05.892Z · last activity: 2026-11-07T06:53:46.300Z
- Turns: 24 · tool uses: 62 · output tokens: 62,820
- Type: general-purpose

## Brief (2026-11-07T06:42:05.892Z)

````text
You are doing cross-cutting market and regulatory research for a new cloud hospitality property-management platform (working company name "Monoclay", the software vendor). Hotels using it collect payments from guests; Monoclay must NOT automatically be merchant of record for hotel stays. Research using web search and fetching official docs:

A. Distribution connectivity
- Booking.com Connectivity Partner Programme: requirements, APIs (OTA XML / B.XML, reservations API, ARI), certification steps, timeline.
- Expedia Group (EQC / Expedia Partner Central connectivity, Rapid API is for demand side) — what a PMS/channel manager needs to connect.
- Airbnb API access (restricted, partner program), Google Hotel Center / Free Booking Links / Hotel Prices API, Agoda, Trip.com, Hotelbeds.
- Standards: OpenTravel Alliance (OTA_HotelAvailNotif, OTA_HotelRateAmountNotif, OTA_HotelResNotif, etc.), HTNG specs. Which are still the de facto standard.
- Using a connectivity hub/aggregator vs direct connections (e.g. SiteMinder SMX, RateGain, DerbySoft, Channex.io as white-label channel manager API). Pricing/approach of Channex specifically.
- How to safely build/test without live partner access (sandboxes, simulators).

B. Payments
- Embedded payments models: Stripe Connect (Standard vs Express vs Custom; who is merchant of record; liability; platform fees), Adyen for Platforms, Checkout.com, and how Mews Payments / Cloudbeds Payments / Shiji ReviewPro? (no) / Shiji Payments / Oracle Payment Cloud are structured.
- Hospitality specifics: pre-authorization/incremental authorization, card-on-file/MIT (merchant-initiated transactions) and SCA/3DS2 exemptions in EU, no-show charges, OTA virtual cards (VCC) handling, tokenization and keeping the PMS out of PCI DSS scope, payment links, terminals (Stripe Terminal, Adyen terminals), chargebacks/disputes.
- Idempotency patterns for payment APIs (Stripe idempotency keys etc.).

C. Compliance & tax (summarize per region with sources)
- GDPR/UK GDPR for guest data, data residency expectations, retention, right to erasure vs. financial record retention.
- PCI DSS v4.0 SAQ levels for a platform using hosted fields.
- Fiscalization/e-invoicing obligations affecting hotel PMS: Germany (KassenSichV/TSE, GoBD), Austria (RKSV), Italy, France (NF525), Portugal (SAF-T/certified software), Spain (Verifactu/TicketBAI), Saudi Arabia (ZATCA Fatoora), UAE (e-invoicing plans, tourism dirham fee), India (GST e-invoicing), Maldives (MIRA TGST, Green Tax per guest-night, service charge norms), US (state/city occupancy taxes, resort fees disclosure rule FTC 2025).
- SOC 2 / ISO 27001 expectations from enterprise hotel groups.

D. Market context
- Hotel PMS market size, share by vendor if available, typical pricing (per room per month), sales cycles, what hotel groups require in RFPs (security questionnaires, SSO/SAML, SLAs, uptime).

Write a thorough, well-structured markdown report to /home/user/research/04-connectivity-payments-compliance.md (create the directory if needed). Cite source URLs inline. Mark clearly what is verified vs. inferred. Aim for depth (~4,000-6,000 words fine). End with "Key decisions this forces on Monoclay" — a list of decisions with your recommended answer and trade-offs.

Your final reply to me should be a ~400-word summary of the most important findings plus the file path. Do not ask me questions; use judgment.
````

## Report (2026-11-07T06:53:46.092Z)

````text
I've written the report to `/home/user/research/04-connectivity-payments-compliance.md` (about 9,300 words counting URLs). Every claim is tagged: [V] for confirmed against an official source, [V2] for secondary sources only, [I] for my own inference. Two limits on what I could check: this environment's network blocked direct page reads from developers.booking.com, channex.io and partner.expediagroup.com, so those were read through search excerpts. Then the shared search budget ran out. That left Spain's guest-registration decree, vendor market share, sales cycles, Checkout.com, Adyen's exact merchant-of-record wording and Stripe's list pricing as [I], listed in the report's "open items" appendix.

**Connectivity**
- **Use a hub at launch.** Airbnb is not accepting new API partners [V2].
- **Booking.com** requires onboarding, PCI compliance and a certification run, and changes its API versions several times a year. Several legacy content endpoints shut down on 31 Dec 2026 [V].
- **Expedia** has frozen its XML booking APIs and moved reservations to GraphQL plus webhooks [V].
- **Channex white-label** costs $130/month plus $7 per hotel, falling to $4 at 2,000+ hotels [V]. That is about $0.12 per room per month, against PMS prices of $5–15 per room.
- **Google free booking links** are open to new connectivity partners; build that integration directly.
- **OpenTravel XML** is still the common format between partners. Each uses its own variant, and the newer APIs are REST, JSON or GraphQL. Monoclay should keep its own internal model and write one adapter per channel.

**Payments: staying out of merchant of record**
- **Stripe Connect:**
  - **Use direct charges** on hotel accounts where Stripe carries losses: the hotel is the merchant, and disputes come out of the hotel's balance [V].
  - **Avoid destination charges**: even with `on_behalf_of`, disputes are debited from the platform's balance [V]. With stays prepaid months ahead, a hotel going bust would leave Monoclay with the chargebacks.
- **Adyen:** route chargebacks to each hotel's balance account. Otherwise they come out of Monoclay's [V].
- **Competitors:**
  - Mews says it "does not hold funds" and puts hotels on a separate agreement with Adyen or Stripe [V].
  - Cloudbeds runs payments through a separate company [V].
  - Oracle keeps OPERA Cloud out of PCI scope by using only Oracle-certified payment providers [V].
- **Hotel payment mechanics:**
  - 30-day pre-authorisations for lodging [V].
  - Strong customer authentication when a card is saved; later no-show charges are exempt as merchant-initiated [V].
  - OTA virtual cards with conflicting activation dates and up to 5 days' funding delay [V2].
- **Biggest PCI risk:** raw card numbers arriving in OTA booking feeds. Route them through a card vault or proxy so Monoclay only stores tokens.

**Compliance**
- **PCI:** hotels can use the simplest self-assessment (SAQ A) only if Monoclay's payment pages are protected against script attacks [V]. Monoclay will need its own PCI attestation for enterprise sales.
- **Fiscal rules decide which countries Monoclay can launch in.** The heaviest:
  - Germany: certified security device (TSE).
  - Austria: signed cash records.
  - Italy: telematic takings or e-invoices, plus police reporting.
  - France: e-invoice receipt from Sep 2026; self-certification of cash software reportedly reinstated in 2026.
  - Portugal: government-certified software and a qualified signature on PDFs from 2027.
  - Spain: Verifactu is due in 2027, with an October 2028 delay announced but not yet law.
  - Saudi Arabia: the next e-invoicing wave covers revenue from SAR 187.5k, due Feb 2027.
- **Lodging taxes the tax engine must handle:**
  - UAE: e-invoicing from Jan 2027 for businesses with AED 50m+ revenue, plus Dubai's per-room-night Tourism Dirham.
  - India: 30-day e-invoice reporting; 5% GST on rooms up to ₹7,500 a night.
  - Maldives: 17% tourism GST and a $12 or $6 per-person-per-night green tax.
  - US: the FTC all-in pricing rule; layered state and city occupancy taxes.

**Market**
- 2025 market estimates range from $1.2bn to $3.8bn, growing 7–11% a year, with cloud above 70–80% [V2].
- Enterprise buyers expect SOC 2 Type II or ISO 27001, SSO, 99.9%+ uptime and EU data hosting.

**Key decisions (detailed with trade-offs in the report)**
1. The hotel is always merchant of record and Monoclay never holds funds.
2. Design payments to work with any payment provider, and let large groups bring their own.
3. Monoclay never stores card numbers.
4. Use a hub first, with Google built directly.
5. Build a tamper-proof fiscal-document record from day one and launch light-compliance countries first.
6. Use one pricing service for the folio, booking engine and OTA/Google feeds.
7. Host data in the EU first.
8. Plan the SOC 2 and ISO 27001 roadmap now.
9. Start with independent hotels.
10. Price at $6–12 per room per month plus a payments fee.
````

