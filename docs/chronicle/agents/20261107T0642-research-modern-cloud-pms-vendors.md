# Agent run: Research modern cloud PMS vendors

- Started: 2026-11-07T06:42:05.871Z · last activity: 2026-11-07T06:52:38.426Z
- Turns: 26 · tool uses: 61 · output tokens: 55,071
- Type: general-purpose

## Brief (2026-11-07T06:42:05.871Z)

````text
You are doing competitive research for a new cloud hospitality property-management platform (working company name "Monoclay"). It aims to match Oracle OPERA Cloud's operational depth while being much easier to use. Research these MODERN CLOUD / API-FIRST / MOBILE vendors using web search and fetching vendor pages, public API docs, developer portals, review sites (G2, Capterra, Hotel Tech Report), Reddit/hotel forums and industry press:

1. Mews (Mews Operations, Mews Payments, Mews Marketplace, Connector API, guest journey/online check-in, kiosks, automation, Mews BI)
2. Apaleo (API-first PMS, open data, app store, booking/inventory/finance/payment APIs, account-based accounting model)
3. Stayntouch (mobile-first PMS, Stayntouch Rover, kiosk/self check-in, upsell)

For EACH vendor capture:
- Positioning, segments, notable customers, pricing model if public, funding/scale.
- Their real competitive advantage — concrete features, workflows, data models (e.g. Mews' "bill" / "payment request" model and embedded payments with automatic charging; Apaleo's double-entry accounting model with receivables/liabilities accounts, business date handling, its "Unit / UnitGroup" model, idempotency and webhook design; Stayntouch's mobile room-status and upsell flows).
- What customers praise and complain about. Quote/paraphrase specific review themes.
- Architecture & openness: API style (REST/GraphQL/webhooks), auth, rate limits, data export, marketplace model, multi-property.
- Payments: who is the merchant of record, payment facilitator model, revenue model, tokenization, pre-auth, virtual cards.
- UX patterns worth copying (onboarding, timeline/calendar, search, keyboard shortcuts, mobile).
- Anti-patterns to avoid.

Pay special attention to Apaleo's public API documentation (api.apaleo.com / apaleo.dev) — summarize its domain model (properties, unit groups, units, rate plans, offers, bookings vs reservations, folios, accounting/finance accounts, night audit, business date). And Mews' Connector API concepts (reservations, resources, resource categories, bills, payments, accounting categories, services, products, rates, restrictions, availability blocks). These are reference models we need to understand deeply (we will design our own original terminology).

Write a thorough, well-structured markdown report to /home/user/research/02-modern-cloud-vendors.md (create the directory if needed). Cite source URLs inline. Mark clearly what is verified from a source vs. your inference. Aim for depth (~4,000-6,000 words fine). End with a section "Top 15 takeaways for Monoclay" ranked by impact.

Your final reply to me should be a ~400-word summary of the most important findings plus the file path. Do not ask me questions; use judgment.
````

## Report (2026-11-07T06:52:38.310Z)

````text
The report is written to `/home/user/research/02-modern-cloud-vendors.md` (about 9,300 words including tables and inline URLs). It covers all three vendors, a cross-vendor comparison, a concept crosswalk between Apaleo, Mews and OPERA-style terms, a verification backlog, and the ranked "Top 15 takeaways for Monoclay".

**Sourcing limits.** I could not open any vendor page directly: this session's network blocks apaleo.dev, api.apaleo.com, docs.mews.com, mews.com, stayntouch.com, g2, hoteltechreport and reddit. The shared search budget (200 per turn) also ran out partway through. Claims marked "verified" in the report come from search-result excerpts of the cited URLs, not full pages. Things from my own background knowledge are tagged [PK] so they can be confirmed. Still unconfirmed: Apaleo's idempotency header, Mews' reservation status list, Mews customer names, and Stayntouch's night audit. To check field-level details, allow those hosts and run a second pass.

**Most important findings:**
- **Mews** raised $300M at a $2.5B valuation in January 2026 (led by EQT Growth) and reports about 15,000 customers in 85 countries.
  - **Payments:** Mews is a payment facilitator with hotels as sub-merchants, running on Adyen and Stripe. Rules attached to rate groups pre-authorise and charge cards automatically, OTA virtual cards are detected and charged when they activate, and payment links allow instalments. The monthly software fee is taken out of the hotel's payment balance.
  - **No night audit:** the day rolls over at midnight, and staff can correct the past only within short editing windows (about 7 days at most).
  - **API:** every call is a POST with tokens in the request body. The limit is 200 requests per 30 seconds per token. Webhooks have to be registered through support.
  - **Complaints:** reporting, unclear fees and payment failures, support, and thin events/banqueting.
- **Apaleo** has the best reference model for "OPERA depth, made easier".
  - **Accounting:** real-time double-entry bookkeeping based on USALI, the standard US hotel accounting framework. Each reservation has its own receivable account, prepayments sit in a liabilities account with VAT handled on deposits, and prepayments are recognised and used up automatically.
  - **Business date:** every transaction has a posting date and a business date. Only the scheduled night audit, which can also be triggered by API, can post to a past date.
  - **Booking model:** a booking is a container of single-room reservations, each priced per night or day-use slice. Each rate plan is tied to exactly one room type.
  - **API:** REST with OpenAPI specs, OAuth with per-API permissions shown on a consent screen, two rate limiters (request count and concurrency), and self-serve webhooks.
  - **Weakness:** reporting and CRM depend on paid marketplace apps.
  - **Scale and AI:** about 1,700 properties; first to launch an MCP server for AI agents (September 2025).
- **Stayntouch** is tablet- and mobile-first and owned by MCR, with $48M from Sixth Street.
  - **Strengths:** mobile housekeeping (assignment by floor, workload points, planning tomorrow's departures), a kiosk with ID scan, facial recognition and key encoding, and upsells in mobile check-in and kiosk that post straight to the folio.
  - **Complaints:** a hard-to-use room diary, no past-dated reports, missing profile merge, an unpolished interface, and support tickets falling through.
- **Weak reporting is the one complaint common to all three vendors.** It is Monoclay's clearest opening.

**Top takeaways:**
1. Build a double-entry ledger first and show folios as views over it.
2. Keep a business date but make end of day automatic, with reconciliation built in.
3. Offer embedded payments with a policy engine, while being more transparent than Mews on fees and payouts.
4. Make reporting native, including reports as of past dates.
5. Separate the booking, the single-room stay, and per-night pricing.
6. Use inventory that isn't limited to bedrooms (beds, parking, meeting rooms).
7. Make the API and webhooks self-serve, with idempotency keys.
8. Design for multiple properties from the start.
9. Make mobile operations core rather than an add-on.
10. Make the timeline the main screen.
11. Build a guest journey and kiosk that need no app, with upsells at every step.
12. Run a marketplace without moving core features into it.
13. Offer property cloning and test-then-go-live setup.
14. Get ready for AI agents (MCP).
````

