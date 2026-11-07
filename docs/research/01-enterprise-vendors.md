# Enterprise and Resort PMS Competitive Research

**Vendors:** Oracle OPERA Cloud, Infor HMS, Shiji Daylight PMS, Agilysys
**Prepared for:** Monoclay product team (research file 01)
**Date:** 2026-11-07

---

## 0. Method, confidence labels and limitations

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **[V]** | Verified: stated in the cited source (vendor documentation, SEC filing, trade press, review site). |
| **[V-legacy]** | Verified in Oracle's older on-premise OPERA 5.x help. The concept almost certainly carries into OPERA Cloud, but that was not confirmed in this session. |
| **[I]** | Inference, or practitioner background knowledge that was not re-verified in this session. Treat these as hypotheses to check during discovery calls and demos. |

**Limitations (read these before relying on any detail)**

- The research environment's network allowlist blocked direct fetches of `docs.oracle.com` and `hoteltechreport.com`. Content attributed to those URLs comes from the search engine's indexed copies and summaries, so exact wording, menu paths and version numbers may differ slightly from the live pages. The URLs cited are the ones the search returned.
- The shared web-search budget ran out near the end of the Agilysys section. Two items are therefore thinner than the rest: Agilysys Pay specifics and Marriott contract detail.
- Review samples are small. G2 has 3 to 65 reviews per product, and Capterra has 6 to 9 for Infor and Agilysys. Some Hotel Tech Report (HTR) "compare" pages are templated and contradict one another. Treat sentiment as directional only.
- Customer counts and growth claims mostly come from vendor press releases.

---

## 1. Executive summary

| | **Oracle OPERA Cloud** | **Infor HMS** | **Shiji Daylight PMS** | **Agilysys (Stay/Versa/LMS + ancillaries)** |
|---|---|---|---|---|
| Core identity | The de-facto enterprise standard, with the deepest operational and financial model in the industry | A cloud PMS inside a broad Infor/Koch enterprise suite, strong in casinos and upscale independents | A cloud-native, portfolio-first PMS built for chains and luxury groups, growing fastest | The "connected resort": PMS plus POS plus spa, golf, activities and dining, all on one guest itinerary |
| Sweet spot | Chains and full-service hotels of every tier, plus franchise-mandated rollouts | Casinos and resorts, upscale independents, small groups | Luxury and upper-upscale groups, especially APAC/EMEA multi-country portfolios | Casino resorts, destination resorts, cruise lines; F&B-heavy operations |
| Architecture | Oracle-hosted SaaS on OCI; OHIP for REST and streaming | Vendor-stated multi-tenant on AWS | Microservices and event-driven on AWS; claims more than 1,600 APIs | A mix of cloud-native (Stay) and legacy (Versa, LMS); partner-gated APIs |
| Finance depth | Best in class: windows, routing, generates, AR, packages, End of Day, income audit, fiscal framework | Solid (ledgers, direct bill, AR aging, resort fees) | Enterprise-grade, with fiscal compliance in 36 countries (vendor claim) | Solid; separates date roll from fiscal-day close; rules-based routing (patented) |
| UX reputation | Powerful but heavy, with a long learning curve | Mixed: learning curve, extra steps, bugs after updates | Rated "intuitive" on HTR, but a thin review base | Little review data; complaints about support gaps |

**The single biggest strategic finding** is that OPERA's moat is not its UI. The moat is its **canonical data model** (business date, blocks, routing, transaction-code hierarchy, packages) and the **staff labour market** trained on it. Monoclay must match that model concept for concept, so that OPERA-trained staff and finance teams lose nothing. At the same time it should remove OPERA's operational friction: the blocking end-of-day roll, the configuration sprawl and the gated integrations.

---

## 2. Oracle OPERA Cloud

### 2.1 Positioning, segments, customers, pricing

- **Analyst position.** Oracle was named a **Leader in the IDC MarketScape Worldwide Hospitality PMS 2025** (its second time). Nine vendors were evaluated. [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4128554.html); [Oracle IDC page](https://www.oracle.com/hospitality/idc-pms-marketscape/))
  - IDC notes that OPERA Cloud's largest share of hotel clients is in **comfort/midscale**, followed closely by full-service and budget/limited-service. [V] This matters: OPERA is not only an upscale product, it is a chain-mandated standard.
- **Footprint and growth.** Oracle claims deployment in 233 countries and territories. It also claimed more than a 100% increase in OPERA Cloud properties, including 1,500 implementations in Q4 of FY2024. [V, vendor claim] ([Oracle June 2025 release](https://www.oracle.com/kr/news/announcement/hoteliers-continue-to-trust-oracle-to-boost-operations-and-guest-satisfaction-2025-06-16/))
- **Notable customers** [V]:
  - **Wyndham.** First major global rollout; an additional 2,000 hotels were targeted by end of 2024, at "20 hotels a week," with franchisees migrating "in a matter of days." ([Hotel-Online](https://www.hotel-online.com/news/oracle-teams-with-wyndham-to-bring-opera-cloud-to-2000-additional-hotels); [HotelTechnologyNews](https://hoteltechnologynews.com/2023/05/wyndham-to-expand-the-rollout-of-oracle-hospitality-opera-cloud-pms-across-2000-additional-hotel-properties/))
  - **IHG.** In January 2026, IHG approved OPERA Cloud as an *optional* cloud PMS for the Americas and EMEAA, not a mandate. ([eCommerceNews](https://e-commerce.news/story/ihg-approves-oracle-opera-cloud-for-hotels-globally))
  - **Others.** Hyatt, Omni, Rotana, Orascom and Sercotel are named in 2025. An aggregator reports that Accor chose OPERA Cloud Sales & Event Management (S&EM). ([Oracle 2025 release](https://www.oracle.com/kr/news/announcement/hoteliers-continue-to-trust-oracle-to-boost-operations-and-guest-satisfaction-2025-06-16/))
  - **Counter-signal: Marriott.** Agilysys's earnings calls identify its "large-scale PMS project" as a **Marriott** rollout, with "hundreds of Marriott sites" installing it (see section 6). This shows the largest chain is not standardising on OPERA Cloud for everything. [V, earnings-call summaries]
- **Pricing.** Oracle does not publish prices. [V]
  - Third-party estimates run from **$12–18** to **$15–60 per room per month**, sold as subscriptions per room per month. These are low-confidence figures from an SEO-style licensing blog and a software directory. ([Atonement Licensing](https://atonementlicensing.com/blog/hospitality-it/); [SoftwareFinder](https://softwarefinder.com/hotel-management/oracle-hospitality-opera-property-management-system))
  - **OPERA Cloud Foundation** is the economy/limited-service tier, described as covering "as many as 30 functions." [V] ([Oracle Foundation page](https://www.oracle.com/hospitality/hotel-property-management/opera-cloud-foundation-cloud-pms-for-hotels))
  - Functionality is gated by **subscription tier and module**. S&EM, for example, has Standard and Premium functionality matrices. [V] ([S&EM functionality matrix](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/ocsuh/c_osem_functionality_matrix.htm))

### 2.2 The real competitive advantage

OPERA's advantage is **operational completeness, encoded in a data model that the whole industry has learned.** Concretely:

1. **Business date and a configurable End of Day sequence.** Mandatory and optional procedures, restartable steps, final reports, income audit and an automatic scheduler (section 3.1). [V]
2. **Folio windows plus routing instructions.** Up to 8 windows per reservation. Routing works by transaction code or routing code, with date and day-of-week ranges, amount or percentage limits, and room-to-room and comp routing with an authorizer. Defaults are inherited from profiles and rate codes (section 3.6). [V]
3. **Transaction-code hierarchy with "generates".** Taxes and service charges are inherited down the group, subgroup and code tree. They chain onto each other and can be inclusive or exclusive (section 3.7). [V]
4. **Rate codes plus packages.** Posting type, calculation rule, posting rhythm, allowances, and package profit and loss posted at End of Day (section 3.8). [V]
5. **Blocks with typed statuses and a configurable status flow.** Status types decide inventory treatment, reasons are mandatory for lost and cancel, there are original and current grids, cutoff and elastic sell limits, rooming lists and posting masters (sections 3.4–3.5). [V]
6. **AR / direct bill.** A pseudo-payment settles to an AR account, invoices transfer automatically or manually, accruals appear on the trial balance, and restricted accounts need an override permission (section 3.9). [V]
7. **Fiscal framework (OFIS Cloud).** Plug-in fiscal partners per country (section 2.5). [V]
8. **Scale of the ecosystem.** OHIP REST and streaming APIs, distribution via OXI and OPERA Cloud Distribution, and HTNG-based payment tokenization (OPI). [V]

The data model is the moat. Any OPERA-trained night auditor or controller can sit down at any OPERA property worldwide. [I]

### 2.3 What customers praise and what they complain about

**Praise** [V]
- Comprehensive and reliable.
- One G2 reviewer called the in-person training "excellent."
- A night auditor said report preparation became "much faster and less stressful."

([G2](https://www.g2.com/products/opera-cloud-property-management/reviews), 65 reviews; [SoftwareFinder](https://softwarefinder.com/property-management-software/opera-cloud-property-management/reviews), 58 reviews)

**Complaints** [V]

| Theme | What reviewers report |
|---|---|
| Performance and connectivity | "A strong and reliable Internet service is needed or the system runs slowly and crashes a lot"; the system "can feel pretty slow." ([Capterra](https://www.capterra.com/p/266207/OPERA-Cloud-Property-Management/reviews/); [SoftwareFinder](https://softwarefinder.com/property-management-software/opera-cloud-property-management/reviews)) |
| Training time | A new front-desk agent **cannot learn it in one shift**. Administrators and teams handling configuration, reporting or complex workflows "need more time, practice, and site-specific training." ([Capterra](https://www.capterra.com/p/266207/OPERA-Cloud-Property-Management/reviews/)) |
| Support | Uneven: slow ticket responses, time-consuming escalations, "long holds, unresolved tickets, and missed callbacks," slow replies at peak hours. Others found support responsive. ([G2](https://www.g2.com/products/opera-cloud-property-management/reviews); [Software Advice](https://www.softwareadvice.com/hotel-management/opera-cloud-property-management-profile/reviews/)) |
| UI | Click-heavy, crowded layouts; "can feel overwhelming and rather clunky." This last quote is about OPERA generally, from a third-party review. ([TheHotelGM](https://thehotelgm.com/tools/oracle-opera-review/)) |

**Inferred pain points** [I], consistent with the review themes:
- Hundreds of "OPERA Controls" (functions, parameters, settings) make configuration a specialist job.
- Implementations depend on Oracle Consulting or partners.
- Several capabilities need Oracle to switch them on. Streaming is an example: it must be enabled by Professional Services (verified, section 2.4).

### 2.4 Architecture and openness

**OHIP (Oracle Hospitality Integration Platform)** [V]
- **REST APIs**, with public API documentation on GitHub. ([oracle/hospitality-api-docs](https://github.com/oracle/hospitality-api-docs/releases))
- **Streaming API for business events**, introduced in 21.4 (November 2021), is built on **GraphQL Subscriptions over WebSocket**. ([OHIP 21.4 notes](https://docs.oracle.com/en/industries/hospitality/integration-platform/axern/c_release_21_4.htm))
  - OHIP **retains events for 7 days, so they can be replayed.** ([Streaming FAQ](https://docs.oracle.com/en/industries/hospitality/integration-platform/stmig/c_faqs.htm))
  - Subscriptions need **environment-owner approval** in the developer portal.
  - Streaming must be **enabled by Oracle Professional Services** for each environment.
  - Since OHIP 25.4, **only the data elements configured as triggers** appear in an event's `detail` payload. ([OHIP Oct 2025 ReadMe](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_october_2025_readme.htm))
  - Release 26.3 adds event analytics and a GraphQL query for scaling streaming. ([26.3 readiness guide](https://docs.oracle.com/en/industries/hospitality/integration-platform/axern/G58730_01.pdf))
- **Commercial model.** The hotel's OHIP access is bundled with OPERA Cloud, and the **partner pays**:
  - about **$10 per 10,000 REST calls per month**, and
  - **$10 per 100,000 streamed events**,
  - with tiers above that. Customers do not pay for streaming. ([OHIP datasheet](https://www.oracle.com/a/ocom/docs/industries/hospitality/hosp-integration-platform-ds.pdf); [Streaming FAQ](https://docs.oracle.com/en/industries/hospitality/integration-platform/stmig/c_faqs.htm))
- **Partner access.** Self-registration is via the Oracle Store according to one source; another says an Oracle Partner Network reference is required for production. The sources conflict. [V, conflicting]

**Payments (OPI Cloud)** [V]
- OPI bridges OPERA Cloud to PSPs and prepaid-card providers.
- The **Token Exchange** service follows the HTNG tokenization specification and includes a hosted card-entry form.
- `openPaymentBulkTokenExchange` lets partners tokenize card numbers from third-party channels. A 404 with `OPICS-NOT_FOUND` means OPI isn't enabled; a 504 means the PSP timed out.
- **OPI Internal Token Service** serves properties that have no PSP vault.
- Release 25.3 adds migration off the legacy Token Proxy Service.
- Sources: [OPI overview](https://docs.oracle.com/en/industries/hospitality/payment-interface-cloud/26.1/ugopi/ch_functionality_overview.htm); [OPI APIs](https://docs.oracle.com/en/industries/hospitality/integration-platform/ohipu/c_oracle_payment_interface_apis.htm); [OPI 25.3](https://docs.oracle.com/en/industries/hospitality/payment-interface-cloud/25.3/rnopu/ch_features_and_updates.htm)

**Distribution** [V]
- OPERA Cloud Distribution is the channel manager and "single system of record for inventory, pricing, and content."
- OPERA Cloud Central can copy channel settings across properties and holds central GDS templates.
- **OXI** (OPERA Xchange Interface) is the legacy exchange for rate plans and restrictions.
- Channel reservations carry promotion codes, comments and preferred room numbers. External confirmation numbers are stored as custom reference numbers.
- Sources: [Oracle Distribution](https://www.oracle.com/hospitality/hotel-channel-management-software/); [Distribution intro](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/25.1/ohdug/ch_introduction.htm); [Channel reservations](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/23.5/ohdrn/c_features_channel_reservations.htm)

**Multi-property** [V]
- **Profile sharing** is a chain-level switch. It **requires a PIN and cannot be disabled once enabled.**
- With sharing on, property filters in search become multi-select, and reservations can be moved between properties.
- Source: [Configuring Chain](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_admin_configuring_chain.htm)

**Hosting and tenancy** [I]
- Oracle-hosted on Oracle Cloud Infrastructure, with quarterly-ish numbered releases (e.g. 24.4, 25.1 … 26.2 visible in the docs).
- Tenancy is per chain/enterprise environment rather than visibly shared multi-tenant; streaming is enabled per environment (verified).
- Mobile: responsive web plus OPERA Cloud mobile capabilities. Not verified this session.

### 2.5 Finance specifics (summary; detail in section 3)

- **Folios:** windows 1 to 8, each with its own payee and payment method. Interim folios settle and print without checking out. Check-out on an **open folio** is allowed for late charges. [V] ([Settling a balance](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_manage_billing_settling_a_reservation_account_balance.htm))
- **Cashiering:** End of Day closes any open cashier other than the End of Day cashier. [V] ([EOD procedures 22.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/c_mandatory_optional_procedures.htm))
- **Fiscal (OFIS Cloud)** [V]:
  - up to **three fiscal partners**, each with a priority;
  - parameters come from a partner template;
  - the outbound allowlist is configured per partner host and port;
  - fiscal business events retry 3 times by default;
  - payloads trigger at checkout, folio settlement or payment posting;
  - country-specific features exist, e.g. Portugal SAF-T export and QR codes.
  - Sources: [OFIS Cloud](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.3/ocsuh/t_admin_financial_configuring_ofis_cloud_integrations.htm); [Fiscal partners](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/t_financial_admin_fiscal_management_configuring_fiscal_partners.htm); [22.2 feature summary](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.2/oprnc/c_feature_summary.htm)
- **S&EM** [V]:
  - function diary with 1, 7, 14 or 21-day views;
  - shared versus exclusive space;
  - catering packages (events, menus, space; priced per person or flat);
  - sub-events printed together on BEOs;
  - alternate (weather) space;
  - an event waitlist that auto-promotes when space frees up;
  - event revenue posted to the block's master account.
  - Sources: [Function diary](https://docs.oracle.com/cd/F18689_01/doc.193/f23597/ch_osem_about_function_diary.htm); [S&EM matrix](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/ocsuh/c_osem_functionality_matrix.htm)

### 2.6 Adopt and avoid

**Adopt**
- Every concept in section 3, at the data-model level.
- Event replay of at least 7 days.
- Field-level selection of event payloads.
- Pay-per-use partner pricing (it is transparent and cheap).
- A pluggable fiscal partner framework with retries.
- An S&EM event waitlist with auto-promotion.

**Avoid**
- Irreversible global switches, such as profile sharing.
- Features that need the vendor's professional services to switch on (e.g. streaming).
- A roll step that requires every other user to log out (section 3.1).
- A wall of per-property "controls" without opinionated defaults.
- Tier-gated basics.
- A desktop-era density of fields on every screen.

---

## 3. OPERA Cloud reference concepts (deep dive)

> These sections describe how OPERA models each concept so that Monoclay can design **equivalent-or-better, originally named** constructs. Where OPERA Cloud docs were not reachable, older OPERA 5.x behaviour is flagged [V-legacy].

### 3.1 Business date and End of Day (night audit)

**Concept**
- OPERA runs on a **business date** that is decoupled from the calendar. All postings, statistics and status changes belong to a business date, and **End of Day (EOD)** is the only thing that advances it. [V] ([Managing Business Date 25.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/t_toolbox_managing_business_date.htm))

**Pre-roll checks (the interactive part)** [V-legacy plus V]

In OPERA 5.6, these steps run before the audit: arrivals not checked in, departures not checked out, automatic closure of open cashiers, weather and notes, and rolling the business date. ([OPERA 5.6 About EOD](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/about_end_of_day_sequence.htm))

1. **Arrivals not yet checked in.** The auditor resolves each one: check in, cancel, mark as no-show, or roll the arrival date forward. [V-legacy; resolution options I]
2. **Departures not yet checked out.** The OPERA Cloud 22.2 docs say the business date can be updated only when "all the anticipated departures are checked out, extended, or otherwise resolved." [V] ([About EOD 22.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.2/ocsuh/c_endofday_procedures.htm))
3. **Cashier status.** Open cashiers other than the EOD cashier are closed. [V]
4. **Roll business date.** All users except the person running EOD must be logged out, and logged-in users get a countdown warning. [V] ([25.1 business date](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/t_toolbox_managing_business_date.htm); [5.6](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/about_end_of_day_sequence.htm))
5. **Country and state check, and printing outstanding folios** are commonly part of the interactive steps. [I]

**Post-roll procedures** [V]
- **Post Room and Tax** posts room, tax, package and **package profit/loss** transactions to in-house guests for the business date. It also posts to guaranteed no-shows where configured. ([About EOD 25.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.4/ocsuh/c_endofday_procedures.htm); [5.6 mandatory](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/mandatory_procedures.htm))
- In 5.6, Post Room and Tax and no-show processing ran **after** the roll. [V-legacy]
- **Mandatory procedures** [V] ([22.3 procedures](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/c_mandatory_optional_procedures.htm); [25.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.4/ocsuh/c_mandatory_optional_procedures.htm)):
  - process no-shows (Due In moves to No Show);
  - synchronise front-office room statuses;
  - populate the **trial balance**;
  - generate or update reservation and profile statistics (rooms, guests, room revenue, promotion code);
  - purge resolved maintenance requests;
  - auto check-in of pseudo-room arrivals for the next day (after the roll).
- **Optional procedures** [V]:
  - **allotment cutoff**, which releases unpicked block rooms; it must be active for cutoff dates to work;
  - AR amount and aging update;
  - night-audit credit-card authorisation.
  - Only the optional procedures are editable.
- **Failure handling** [V]:
  - a failed procedure is retried by subsequent runs until it shows COMPLETE;
  - the next EOD cannot run until the prior one has completed. This is a legacy rule ([OPERA help mirror](https://55349.wyndham.com/OperaHelp/run_additional_procedures.htm)).
  - Release notes show EOD defects fixed in steps such as "Creating Guest Ledger," which created invoices with wrong amounts in AR. ([24.4 resolved issues](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/oprnc/c_resolved_issues.htm))
- **Final reports** are printed or stored, and **statistics are not available until the audit finishes**. [V-legacy] ([EOD reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/c_reports_end_of_day.htm))
- **Close the day.** In 5.6, the last step closes the business day, after which no further adjustments are allowed. [V-legacy]
- **Income Audit.** If income audit is used, mandatory procedures run twice: once during EOD and once before income audit. [V]

**Automatic End of Day scheduler** (24.4 and later) [V]
- Runs at a scheduled time and "auto continues" through procedures in the background.
- Sends emails at start, on completion, and on errors that need a person.
- Retries every 5 minutes, up to 3 attempts.
- Can be skipped for a given date.
- Requires the previous EOD to have finished within 12 hours.
- **Stops at Print Final Reports**, which a human must run.
- **Halts on** open-folio pseudo rooms, void folios and scheduled room moves that are not completed.
- Sources: [Auto EOD 24.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/ocsuh/t_managing_automatic_end_of_day_schedule.htm); [25.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/t_managing_automatic_end_of_day_schedule.htm); [About EOD 25.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/c_endofday_procedures.htm)

**Design implications for Monoclay** [I]
- Keep a **business date** as a first-class accounting concept. Finance teams and auditors need it.
- Make the **roll non-blocking**: no global logout, and postings during the roll carry a timestamp and the correct date.
- Turn pre-roll checks into a **continuously maintained exception queue** (arrivals not arrived, departures pending, open cashiers, unbalanced folios), so that EOD becomes a one-click confirmation.
- Post room and tax **incrementally**, or as a deterministic, idempotent job.
- Make statistics real-time rather than "after audit."
- Separate the *operational day roll* from the *accounting close*, which Agilysys already does (section 6.5).

### 3.2 Reservation status model

**Statuses** [V, partly via integration guides]
- **Lifecycle values:** Reserved, then (derived) Due In, then Checked In / In House, then (derived) Due Out, then Checked Out. Exits: **No Show**, **Cancelled**, **Waitlisted**.
- **Definitions from the CRS integration guide:**
  - Checked Out: the guest completed the stay;
  - No Show: the guest did not arrive and the booking was not cancelled;
  - Cancelled: cancelled before the arrival date.
  - ([CRS integration guide](https://docs.oracle.com/en/industries/hospitality/integration-platform/crsig/c_2_reservation_management.htm))
- **"Due In" and "Due Out" are derived:** they mean an arrival or departure on the current business date.
  - An early checkout sets the reservation to Due Out first. ([Early checkout 24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_checking_out_guests_early.htm))
  - Reversing a check-in returns it to "Arrival (due in)." ([Reverse check-in](https://docs.oracle.com/cd/F18689_01/doc.193/f23597/t_arrivals_and_in-house_reversing_check_in.htm))
- **Reversibility** [V]:
  - a no-show can be **reinstated** to reserved;
  - a checked-out reservation can be reinstated (to Due Out) **only until the business date is rolled**. ([OPERA help mirror](https://synxis-dtmd.dusit.com/OperaHelp/reinstate_checked_out_guest.htm))
- **History grouping.** Profile history groups past stays as Checked In, Checked Out or No Show, plus Cancelled where the departure is before the business date. [V] ([22.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.2/ocsuh/t_create_manage_viewing_profile_future_past_stays.htm))

**Design implication** [I]
- Store a small **lifecycle state** (booked, in-stay, departed, no-show, cancelled, waitlisted).
- **Derive** "arriving today," "departing today," "early departure" and "overstay" from dates versus the business date.
- Every reversal is an explicit, audited transition, and its window is tied to the accounting close rather than to the roll.

### 3.3 Reservation types (inventory deduction) and waitlist

- A **reservation type** determines whether a booking **deducts inventory** (deduct) or not (non-deduct). [V] ([Reservation types 23.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.1/ocsuh/c_admin_booking_reservation_types.htm); [25.1 config](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.1/ocsuh/t_admin_booking_configuring_reservation_types.htm))
- Types also encode **guarantee** semantics. A "4 PM release," for example, is non-guaranteed and is cancelled if the guest has not arrived. [V]
- Non-deduct bookings are excluded from availability unless a view option is selected. [V]
- Block reservations must match block status. Blocks on Inquiry or non-deduct status require a non-deduct reservation type; blocks on Deduct or Actual status require a deduct type. [V] ([Change Block Status API guide](https://docs.oracle.com/en/industries/hospitality/integration-platform/maeig/t_change_block_status.htm))
- **Waitlist** is a separate function with waitlist reason codes. [V] ([Waitlist codes](https://docs.oracle.com/cd/E81346_01/doc.183/e81527/c_configuration_codes_waitlist.htm))

### 3.4 Block (group) status model

**Status types, not just status codes** [V]
- Each property defines status codes, and each code has a **type** that drives inventory behaviour. ([Configuring Block Status Codes](https://docs.oracle.com/cd/F18689_01/doc.193/f38312/t_blocks_status_codes.htm); [5.6 status codes](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/status_codes.htm))

| Typical code | Type behaviour (OPERA) | Notes |
|---|---|---|
| **INQ** (Inquiry) | Non-deduct; pickup not allowed | Sales lead stage [V] |
| **TEN** (Tentative) | Non-deduct ("tentative" type) | Usually included in forecast as tentative [V; forecast use I] |
| **DEF** (Definite) | **Deducts** inventory; pickup allowed | Contracted [V] |
| **ACT** (Actual) | Deduct or not, depending on whether conversion to actual happens at arrival or at departure | Post-event actualisation [V] |
| **CAN** (Cancel) | Returns inventory; no pickup or deduct; **cancel reason mandatory** | Cannot cancel while active reservations other than the **posting master** are linked [V] |
| **LOS** (Lost) | Returns inventory; **lost reason mandatory** | Lost to competitor or price [V] |
| **REF** (Refused) | Returns inventory; **refused reason mandatory** | The hotel turned the business down [V] |

- A **status flow** defines which next statuses are allowed from each status, for example INQ to TEN, DEF or LOS. It is configured per property. [V]
- OPERA Cloud also has an **"Open for Pickup"** state that controls whether reservations can be booked against the block. [V] ([Room and Rate Grid 24.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_blocks_managing_room_and_rate_grid.htm))
- Rooms status and catering status are commonly tracked separately on a block in S&C. [I]

### 3.5 Block mechanics (what matters for parity)

- **Room and rate grid** [V]:
  - allocation and rate per date and room type;
  - an **Original** (contracted) grid that is available only before the block is opened for pickup;
  - a **Current** grid;
  - **Pickup** counts;
  - rate editing per date when the relevant control allows it.
  - ([Grid 23.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.1/ocsuh/t_blocks_managing_room_and_rate_grid.htm))
- **Cutoff** [V]:
  - a cutoff **date** releases unpicked rooms on that night;
  - cutoff **days** release one night at a time (with 7, each night releases a week ahead);
  - when block-level and grid-level cutoffs conflict, the last one entered wins;
  - the Allotment Cutoff EOD procedure must be active.
- **Elastic blocks** let pickup exceed the block up to **sell limits** per room type. [V] ([OPERA Controls Blocks 24.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/c_opera_controls_blocks.htm))
- **Rooming list.** Individual reservations deduct from **block** inventory, not house inventory. [V]
- **Posting master.** A master reservation holds group charges. It inherits the block's payment method and is exempt from the cancel restriction. [V] ([Creating blocks 24.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.1/ocsuh/t_osem_creating_blocks.htm))
- **Attrition and wash reporting, and room-revenue forecasts by status**, are expected enterprise features. [I]

### 3.6 Routing instructions and folio windows

**Windows** [V]
- Each reservation has **folio windows**. The 23.1 documentation describes routing destinations as **windows 2 to 8** (window 1 is the default). Each window can have its own payee profile and payment method.

**Window routing** [V]
- Destination: a window on the same reservation.
- Selection: by **transaction codes** or by **routing codes** (named bundles of transaction codes).
- Scope: by **date range** and **days of week**.
- Caps: **Routing Limits**, by amount or percentage, when that control is active.
- An **"apply to existing postings"** option re-routes charges already posted for in-house guests.
- ([Routing 23.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.1/ocsuh/t_manage_reservation_routing_instructions.htm); [24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_manage_reservation_routing_instructions.htm); [Routing limits](https://docs.oracle.com/cd/E81346_01/doc.183/e81527/c_managing_reservations_routing_limits.htm))

**Room routing** [V; mechanics I]
- Routes charges to *another reservation's* folio, for example a parent paying for a child's room or a group posting master.

**Comp routing** [V]
- Routes to comp folios with a required **authorizer**. A **Request** variant exists. ([Comp routing](https://docs.oracle.com/cd/F18689_01/doc.193/f23597/t_comp_accounting_managing_comp_routing_instructions.htm))

**Default routing inheritance** [V]
- Profiles (company, agent, source, contact) with "Auto Populate Routing," and **rate codes**, can carry default routing.
- When several apply, OPERA prompts in a fixed precedence: source, then agent, then company, then contact, then rate code. ([Rate-code default routing](https://docs.oracle.com/cd/F18689_01/doc.193/f33329/t_manage_rate_code_default_routing_instructions.htm))

**Design implication** [I]
- Users must otherwise reason about numbered windows. Model billing instead as **"billing parties" × "charge rules"**:
  - each rule has a ranked priority;
  - selectors cover charge category, date range, day of week, and amount or percentage caps;
  - each rule records its source (manual, profile, rate plan, block or package).
- Show a live **"who pays for what" preview** before saving.
- Always support retroactive re-routing, with an audit trail.

### 3.7 Transaction codes, generates and ledgers

- **Hierarchy** [V]:
  - transaction **codes** roll up into **subgroups**, which roll up into **groups**;
  - the group sets the code type: **revenue, payment or wrapper**;
  - code length grew from 1–8 digits (23.1) to up to 20 digits (25.2).
  - ([About transaction codes](https://docs.oracle.com/cd/F34189_01/doc.201/f42091/c_admin_financial_cashiering_about_transaction_codes.htm); [25.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/25.2/ocsuh/c_admin_financial_cashiering_about_transaction_codes.htm))
- **Generates** [V] are rule-based derived postings, such as taxes and service charges, triggered whenever a sales code posts.
  - They are **inherited** from group and subgroup, and are cumulative.
  - They are **not allowed** on payment or wrapper groups.
  - They can be **chained**, e.g. tax on charge plus service charge, using three subtotal buckets.
  - Each code can be **inclusive or exclusive**.
  - **Tax types** support exemptions and concessions.
  - ([Tax generates 22.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/22.3/ocsuh/c_admin_financial_transaction_management_tax_generates.htm); [21.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/21.4/ocsuh/c_admin_financial_transaction_management_tax_generates.htm))
- **Ledgers** [V partly]:
  - EOD populates the **trial balance**, and steps such as "Creating Guest Ledger" exist;
  - direct-bill invoices waiting in Direct Bill Transfer appear as **accruals** on the trial balance;
  - the usual ledgers are guest, deposit, AR and package. [package and deposit ledgers: I]

### 3.8 Rate codes and the package model

**Rate code** [V partly]
- A rate code has a header, seasons or details by room type and occupancy, and **financial details** (the transaction codes for room and package revenue). ([Rate code financial details](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.2/ocsuh/t_configuring_rate_code_financial_details.htm))
- It also carries category, market and source codes, sell dates, length-of-stay restrictions, derived/negotiated linkages and display sets. [I]
- A rate code's **posting rhythm** controls things such as whether packages post on free nights. [V] ([Rate code posting rhythm 24.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.4/ocsuh/c_rate_code_posting_rhythm.htm))

**Package code (element)** [V]
- **Posting type:** "Included in Rate" or "Added to Rate," with combined or separate line. [Separate/combined line variant: I]
- **Calculation rule:** flat, per person, per adult, per child or per room. Per-bucket pricing is possible when rates are defined by age buckets.
- **Posting rhythm:** default every night; also arrival, departure, or custom schedules by night or stay day.
- **Discount treatment:** a discount is subtracted from the room rate for Add-to-Rate packages, and from the total for inclusive packages.
- A package can be restricted to use only as a rate-code inclusion.
- **Allowances** are tracked, with **package profit/loss** posted at EOD.
- A package's rhythm is locked once in-house reservations use it, per legacy behaviour.
- Sources: [Package codes 26.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_package_codes.htm); [Post attributes 23.4](https://docs.oracle.com/en/industries/hospitality/opera-cloud/23.4/ocsuh/t_configuring_package_code_post_attributes.htm); [Distribution products 26.1](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.1/ohdug/c_pricing_products.htm); [5.6 package rhythms](https://docs.oracle.com/cd/E98457_01/opera_5_6_core_help/package_posting_rhythms_26915.htm)

**Design implication** [I]
- Treat packages as **entitlements** with:
  - a price allocation (revenue split);
  - a fulfilment channel (outlet, spa, golf, activity);
  - an allowance balance visible to staff *and the guest*;
  - automatic breakage and profit/loss.
- This is exactly where Agilysys is pushing (section 6).
- Avoid the rate-code proliferation that OPERA encourages, where properties often carry hundreds of codes [I]. Use **base rate plus derivation rules plus inclusions** instead.

### 3.9 AR, direct bill and city ledger

- A **Direct Bill / City Ledger pseudo-payment** settles a window's balance to an AR account. The payee profile must have an AR account. [V]
- The settlement code is set by an OPERA Control. [V]
- With **Automatic Transfer of Direct Bill Folios** on, invoices move to AR at EOD. With it off, staff review them in **Direct Bill Transfer** first; they show as accruals until transferred. [V]
- **Restricted/flagged AR accounts** need a specific override permission. [V]
- Invoices then **age** until payments are applied in AR. [V-legacy]
- Sources: [Settling balances 24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/t_manage_billing_settling_a_reservation_account_balance.htm); [Direct bill transfer 24.3](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.3/ocsuh/t_accounts_receivable_direct_bill_transfer.htm); [Financial handling 5.4](https://docs.oracle.com/cd/E53547_01/opera_5_04_03_core_help/financial_handling.htm); [AR chapter 24.2](https://docs.oracle.com/en/industries/hospitality/opera-cloud/24.2/ocsuh/c_accounts_receivable_accounts_receivable_ch.htm)
- AR also covers statements, reminder letters, payments applied to invoices, credit limits and **consolidated credit-card receivables**. [V for the credit-card AR concept ([AR credit card transfer](https://docs.oracle.com/cd/F18689_01/doc.193/f38312/c_accounts_receivable_consolidated_credit_cards.htm)); remainder I]

---

## 4. Infor HMS (Hospitality Management Solution)

### 4.1 Positioning, segments, customers, pricing

- **What it is.** A cloud PMS for "hotels, resorts, and casino operators," running on **multi-tenant AWS**. Infor states that updates deploy to all properties at once. [V, vendor claim] ([Infor HMS](https://www.infor.com/products/hotel-property-management-system); [Infor SG](https://www.infor.com/en-sg/products/hms); [Capterra](https://www.capterra.com/p/251669/Infor-HMS/))
  - One review describes on-premise, public cloud (AWS) or private-cloud deployment. [V, third party] ([TRG overview](https://blog.trginternational.com/infor-hospitality-management-solution-hms))
- **Ownership and suite.** Infor is a **Koch** company. [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4102962.html))
  - HMS sits alongside Infor **Sales & Catering (SCS)**, **EzRMS** (revenue management), an AI revenue-management product, analytics with GenAI (Birst), EAM (maintenance), HCM/WFM and CloudSuite financials. [V for SCS, EzRMS, AI RMS, analytics ([HotelManagement](https://www.hotelmanagement.net/tech/infor-launches-ai-focused-revenue-management-solution)); others I]
- **Customers** [V]:

| Customer | Detail | Source |
|---|---|---|
| Mandarin Oriental | Planned across 31 properties | [Hospitality Net](https://www.hospitalitynet.org/news/4111201.html) |
| White Lodging, The Study Hotel Group, Gun Lake Casino, River Spirit Casino Resort | Named in the same growth release | [Hospitality Net](https://www.hospitalitynet.org/news/4111201.html) |
| El Palace Barcelona | HMS plus Sales & Catering | [Hospitality Net](https://www.hospitalitynet.org/news/4102962.html) |
| The Mayo Hotel (Tulsa) | 102 rooms | [Infor](https://www.infor.com/news/mayo-hotel-guest-experience-infor-hospitality) |
| Seven Feathers Casino Resort | PMS plus Sales & Catering | [Hospitality Net](https://www.hospitalitynet.org/news/4108350.html) |
| Live! Casino & Hotel | Moved to cloud HMS | [Hospitality Upgrade](https://new.hospitalityupgrade.com/news/live-casino-and-hotel-moves-to-cloud-with-infor-hospitality-management-solution) |
| Valley View Casino & Hotel | 20-year Infor customer | [PR Newswire](https://prnewswire.com/news-releases/valley-view-casino-and-hotel-doubles-down-on-infor-to-deliver-a-seamless-guest-experience-302040723.html) |
| Pechanga Resort Casino | HMS and EzRMS since 2016 | [Hotel-Online](https://www.hotel-online.com/news/pechanga-resort-casino-drives-automation-and-visibility-with-infor-cloudsuite) |
| Margaritaville | Grew from 5 to 42 venues on HMS (vendor claim) | Infor marketing |

  - Infor also claims "20,000+ customers in the industry, including nine of the top ten hotel brands." This counts the whole Infor hospitality suite, not HMS. [V, vendor claim]
- **Pricing.** Quote-based; not public. [V]
- **Cadence.** HMS v2026.04 release highlights cover reservations, call centre, **gaming**, mobility and **resort fees**. [V] ([Infor Community](https://community.infor.com/discussion/36287/hms-v2026-04-release-highlights-now-available))

### 4.2 Real competitive advantage

1. **Casino and gaming integration.** Infor links gaming-system **player profiles** to the PMS CRM, automates **comp management and billing**, and lets users search and link player value. It integrates room charges so that charges can post to checked-out rooms "without the need for front desk intervention," and automates reward redemption. [V] ([Infor casinos](https://www.infor.com/industries/hospitality/casinos-gaming); [Valley View](https://prnewswire.com/news-releases/valley-view-casino-and-hotel-doubles-down-on-infor-to-deliver-a-seamless-guest-experience-302040723.html))
   - Its casino heritage likely traces to the SoftBrands/MAI lineage. [I]
2. **Mobility early.** The iPad app has long covered check-in, in-house, check-out, housekeeping updates, fast posting of room charges, concierge, lost and found, work orders, and arrivals/departures. Live! Casino cited mobile apps as a selection reason. [V] ([App Store](https://apps.apple.com/app/id494846832))
3. **Single-vendor enterprise stack.** HMS, S&C, RMS, EAM, HR and financials come from one vendor with a single integration layer, **Infor ION**. Its **ION API Gateway** provides OAuth2, throttling and security policy. [V] ([Infor developer](https://developer.infor.com/?p=162); [Surety Systems](https://www.suretysystems.com/insights/the-power-of-infor-ion-api-in-seamless-enterprise-integration/))
   - A hospitality group used HMS's "open API and webservices" to localise for China quickly. [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4090781.html))
4. **Multi-tenant, true SaaS from early on.** One codebase with simultaneous updates. [V, vendor claim]

### 4.3 Praise and complaints

| Source | Rating | Notes |
|---|---|---|
| Hotel Tech Report | 3.7/5 from 47 reviews (main profile), or 4.04 from 46 (compare pages; the figures conflict) | Strengths: housekeeping module, reporting, integration, ease of use. Weaknesses: support, ease of use, **"bugs caused by frequent updates and server downtime,"** slower support during major updates. [V] ([HTR](https://hoteltechreport.com/operations/property-management-systems/infor-hms)) |
| Capterra | 3.3 from 6 reviews; customer service 2.7 | One 2022 reviewer gave 0/10. Reviewers call it "not user friendly, requiring **multiple steps to complete a single task**," citing billing, room assignment and reservation lookup. Others find drop-down navigation easy and praise iPad paperless check-in. [V] ([Capterra NZ](https://www.capterra.co.nz/reviews/191402/infor-hms)) |
| G2 | 4.4 from 4 reviews | "Complex for new users… steep learning curve… occasional system lags." [V] ([G2](https://www.g2.com/products/infor-hms/reviews)) |
| GetApp | Sparse | Support hard to understand; **slow printing**. [V] ([GetApp](https://www.getapp.com.au/software/134167/infor-hms)) |

### 4.4 Architecture and openness

- **Hosting:** multi-tenant on AWS. [V, vendor claim]
- **APIs:** ION, the ION API Gateway, and "open API and webservices." [V]
  - One directory listing claims HMS "does not provide API." This conflicts with the above and is probably stale or wrong. [V, conflicting]
- **Gaps:** No public developer portal for HMS, nor an HTNG/marketplace catalogue, was found. [I: openness appears enterprise-integration-oriented rather than ecosystem-oriented]
- **Mobile:** an iPad staff app, plus web check-in and check-out with folio viewing on the phone and an emailed copy. [V]

### 4.5 Finance specifics

- Documentation covers:
  - applying a **direct bill settlement**;
  - posting directly to a folio;
  - **guest and property ledgers**;
  - in-house guest balances;
  - an **A/R Aging Details** report;
  - group block, group list and group forecast reports;
  - an **End of Day Status Report**, which lists success or failure for each EOD step.
  - [V] ([HMS help 2025](https://docs.infor.com/hms/2025.x/en-us/hmsolh/default.html); [AR aging](https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/aragingdetailsreport_help.html); [EOD status report](https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/endofdaycompletionsummaryreport_help.html); [Group block report](https://docs.infor.com/hms/3.8/en-us/hmsolh/pages/groupblockreport_help.html))
- **Resort-fee handling** was enhanced in 2026.04. [V]
- Folio-window and routing specifics were not retrievable. [gap]

### 4.6 Adopt and avoid

**Adopt**
- Gaming and comp concepts as an optional vertical pack: player-value linkage, comp authorisation, comp posting as a payment type.
- Charges to checked-out rooms routed automatically (post-departure charges).
- A per-step EOD status report.
- Staff mobile apps that cover *full* tasks, not just status views.

**Avoid**
- Update-induced regressions. Use release rings, canaries, per-tenant feature flags and published release notes with toggles.
- Multi-step flows for common tasks (billing, room assignment, lookup).
- Support that degrades during upgrades.

---

## 5. Shiji Daylight PMS (formerly Shiji Enterprise Platform)

### 5.1 Positioning, segments, customers, pricing

- **Brand.** At ITB Berlin in March 2025, Shiji rebranded around **"Day and Night."** [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4126221/shijis-new-era-unveiled-at-itb-berlin); [hospitality.today](https://hospitality.today/article/shiji-unveils-comprehensive-rebrand))
  - **Daylight PMS** (formerly Shiji Enterprise Platform);
  - **Twilight** (data lake, analytics and AI);
  - **Horizon Distribution**;
  - **Stellaris Digital** (guest messaging, digital stay, and **Payby** embedded payments);
  - **Infrasys Cloud POS** and **ReviewPro**.
- **Target.** Luxury and enterprise groups, and multi-country portfolios. [V]
- **Analyst position.** Daylight was a **Major Player** in IDC MarketScape 2025, up from Contender in 2022. Shiji reports the **fastest growth** of any provider over three years and **third in market share** in the report (Shiji press, repeated in independent coverage). [V, vendor-sourced] ([Hotel-Online](https://www.hotel-online.com/news/shiji-daylight-pms-recognized-as-fastest-growing-pms-in-idc-marketscape-research))
- **Scale.** 449 cities in 36 countries, "with full fiscal compliance." [V, vendor claim; the body text says 440] ([Hospitality Net](https://www.hospitalitynet.org/news/4132990/shijis-daylight-pms-expands-across-449-cities-and-36-countries-with-full-fiscal-compliance))
- **Customers** [V]:
  - **Peninsula Hotels** (2023) ([Hospitality Net](https://www.hospitalitynet.org/news/4118556.html))
  - **Langham Hospitality Group** (February 2024) ([Hospitality Net](https://www.hospitalitynet.org/news/4120291/langham-hospitality-group-enhances-guest-experiences-with-shijis-cutting-edge-pms-technology))
  - **MGM Grand Paradise**: MGM Macau and MGM Cotai (2025) ([Shiji](https://it.shijigroup.com/press-news/shiji-inks-mgm-grand-paradise-deal-to-deploy-daylight-pms-in-macau-resorts))
  - Amadria Park (Croatia)
  - New Hotel Collection ([Shiji](https://www.shijigroup.com/press-news/new-hotel-collection-selects-shiji-daylight-pms-for-seamless-multi-property-management))
  - GenoHotels ([Shiji](https://www.shijigroup.com/press-news/genohotels-modernizes-with-shiji-daylight-pms-bringing-cloud-innovation-to-business-and-conference-hospitality))
  - Park Hotel Group, Japan ([Hospitality Net](https://www.hospitalitynet.org/news/4123255/park-hotel-group-replaces-legacy-pms-with-shiji-enterprise-platform-for-superior-guest-experience))
  - Pearl Continental, Pakistan ([Hospitality Net](https://www.hospitalitynet.org/news/4130885/shiji-brings-cloud-native-hospitality-technology-to-pakistan-with-first-daylight-pms-deployment))
  - Stanglwirt, Palacio Arriluce, TIME Hotels and Ruby Hotels.
- **Rollout velocity.** **100+ hotels for one group in two months**, averaging about 7 properties a day across 6 go-live waves (May 2026). [V, vendor claim] ([Hospitality Net](https://www.hospitalitynet.org/news/4132562/shiji-sets-new-benchmark-with-100-hotel-pms-rollout-for-a-single-group-completed-in-two-months))
- **Pricing.** One HTR comparison page lists "starting at $1,200 per month." This is low confidence. [V, weak]

### 5.2 Real competitive advantage

1. **Portfolio-first configuration.** "A portfolio is configured once from the global, regional or brand perspective," and central changes flow to the network. A "single global configuration that ensures standardisation while still allowing tailored local setups." [V, vendor] ([Hotel Tech Report profile](https://hoteltechreport.com/operations/property-management-systems/shiji-enterprise-platform); [Caterer guide](https://www.thecaterer.com/indepth/technology-buying-guide-2026-reimagining-hospitality-how-shiji-powers-hotels-day-and-night))
   - This is the structural opposite of OPERA, which is property-configured first, with chain or template tools layered on top. [I]
2. **A single global guest profile across the portfolio**, by design. A real-time integration with dailypoint (CDP) aims for a "single source of guest truth." [V] ([HTR news](https://hoteltechreport.com/news/shiji-and-dailypoint-launch-real-time-integration-for-a-single-source-of-guest-truth-in-hotels))
3. **Cloud-native microservices and event-driven design**, claimed at "1,600+ APIs" (sponsored source). Shiji's API listing shows a **webhooks management API, sandbox, OAuth and GraphQL playgrounds**. [V, mixed quality] ([API Tracker](https://apitracker.io/a/shijigroup); [Caterer](https://www.thecaterer.com/indepth/technology-buying-guide-2026-reimagining-hospitality-how-shiji-powers-hotels-day-and-night))
   - Runs on **AWS**, with an AWS Competency. [V] ([Shiji AWS](https://ja.shijigroup.com/press-news/shijis-aws-competency-pioneering-data-security-for-hotel-technology))
4. **Fiscal and local compliance as a product capability**, with local service units in every major region. Mexico is an example, through a partnership with Origon Interfactura. [V] ([HTR news](https://hoteltechreport.com/news/shiji-and-origon-interfactura-partner-to-simplify-fiscal-compliance-in-mexicos-hospitality-industry))
5. **Integrated adjacent stack**: POS (Infrasys), payments (Payby), guest app (Stellaris Digital Stay), distribution (Horizon) and data (Twilight). [V] ([Embedded payments](https://hoteltechreport.com/news/shiji-launches-embedded-payments-for-daylight-pms-powered-by-stellaris-digital-payby); [Digital Stay](https://www.hospitalitynet.org/news/4132655/shiji-accelerates-digital-guest-journeys-with-stellaris-digital-stay-natively-integrated-with-daylight-pms))
6. **Enterprise migration factory.** The 7-hotels-a-day waves show tooling for templated configuration and data conversion. [V for velocity; I for the tooling]

**What "portfolio search" means here** [I, not verified this session]: cross-property search of reservations and profiles is native, because profile and reservation data live in one platform instance rather than in per-property databases.

### 5.3 Praise and complaints

- **Praise** [V]:
  - HTR compare pages give **4.63/5 for ease of use**, praising the "intuitive interface, comprehensive training materials, straightforward onboarding," with a 90% likelihood to recommend.
  - A Capterra user gave 10/10 for integrations, onboarding, and a "fast and intuitive" experience.
  - ([HTR](https://hoteltechreport.com/operations/property-management-systems/shiji-enterprise-platform); [Capterra UK](https://www.capterra.co.uk/software/1021683/Daylight-PMS))
- **Complaints** [V]:
  - "Quite some bugs and issues that need to be handled to make it more accurate and reliable" (Capterra).
  - Users cite **system speed, reporting enhancements, and customization limitations** (HTR Japanese page).
  - Few recent reviews; HTR pages are inconsistent.
- **Inference** [I]: "customization limitations" is the natural trade-off of a configure-once global platform. Properties that want OPERA-level local flexibility will push back.

### 5.4 Architecture and openness

- Cloud-native, microservices, event-driven, on AWS. [V]
- API surface: an API and webhooks catalogue, sandbox, OAuth and GraphQL. [V, third-party listing]
- Shiji's CEO framed the company in 2019 as an "infrastructure platform" rather than a marketplace. [V] ([Skift](https://skift.com/2019/06/18/skift-tech-forum-shiji-helps-hotels-crack-china-market-with-a-la-carte-approach))
- Multi-tenancy and data-residency approach were not verified. [gap]

### 5.5 Finance specifics

- Daylight's folio-routing, end-of-day and AR documentation was **not retrievable** this session. [gap]
- Verified points: fiscal compliance in 36 countries (vendor claim) and embedded payments via Payby. [V]
- **Inference** [I]: Daylight was designed by teams steeped in the Fidelio/OPERA lineage. Expect OPERA-equivalent constructs (windows and routing, business date, AR) with a centralised configuration layer. Validate this in a demo.

### 5.6 Adopt and avoid

**Adopt**
- Hierarchical configuration inheritance (global, brand, region, property) with **visible overrides and drift reports**.
- A global profile as the default (not a one-way switch).
- Webhooks plus a sandbox from day one.
- Productised fiscal and localisation.
- A migration factory capable of rolling out more than 5 properties a day.

**Avoid**
- Over-centralising so that properties cannot localise legitimate differences (outlets, taxes, packages).
- Shipping before reporting is mature. Reporting is a recurring complaint across all four vendors.

---

## 6. Agilysys: the connected-resort story

### 6.1 Positioning, segments, customers, financials

- **Portfolio** [V for categories ([10-K FY2026](https://www.sec.gov/Archives/edgar/data/0000078749/000119312526234423/agys-20260331.htm)); product names partly I]:
  - **PMS:** Stay (cloud-native, formerly rGuest Stay), Versa (formerly Visual One) and LMS (legacy casino PMS);
  - **POS:** InfoGenesis;
  - **Book:** booking engine and itinerary;
  - **Spa:** Book4Time;
  - Golf, Dining/Reserve, Activities;
  - Inventory and procurement (Eatec);
  - **Agilysys Pay;**
  - a Guest App.
- **Segments:** hotels, resorts, **cruise lines, casinos**, restaurants, universities, stadiums and healthcare. [V]
- **Financials, FY2026** (ended 31 March 2026) [V] ([8-K](https://www.sec.gov/Archives/edgar/data/0000078749/000119312526228898/agys-ex99_1.htm)):
  - revenue **$319.3M** (+15.9%);
  - recurring revenue $205.9M (64.5%);
  - **subscription revenue +30.2%**;
  - adjusted EBITDA $67.7M;
  - FY2027 guidance: $365–370M, with at least 30% subscription growth for a third straight year.
- **Notable customers** [V, earnings-call summaries]:
  - The **Marriott** "large-scale PMS project": "hundreds of Marriott sites" installing, a rollout of at least two years, excluded from backlog and guidance. ([Yahoo Finance](https://finance.yahoo.com/markets/stocks/articles/agilysys-q4-earnings-call-highlights-220259013.html); [StatementDog](https://statementdog.com/analysis/AGYS/earnings_calls/321037))
  - A **Las Vegas Strip casino resort** under construction chose Agilysys POS, PMS and more.
  - A **nine-property Australian resort group** left a competitor after more than 20 years. ([MarketBeat](https://www.marketbeat.com/instant-alerts/agilysys-q1-earnings-call-highlights-2026-07-27/))
- **Acquisition.** **Book4Time** (spa, activities, golf and member clubs, in more than 100 countries) was acquired for **$150M cash** in August 2024 to raise "solutions-per-customer." Marriott and Hilton were shared clients, with otherwise minimal overlap. Book4Time contributed **$21.3M** of FY2026 subscription revenue. [V] ([Agilysys](https://www.agilysys.com/en/news/agilysys-announces-strategic-acquisition-of-book4time-spa-management-saas-solution-leader-2/); [Yahoo](https://finance.yahoo.com/news/hospitality-software-provider-agilysys-acquires-061210188.html))
- **Pricing.** Not public. [V]

### 6.2 Real competitive advantage: the stay as an itinerary

1. **One itinerary, one confirmation, one card.** rGuest Book lets guests "combine their room reservations and stay activities into a single booking" (spa, golf, dining, activities). A **Common Guest Profile** applies preferences at each step of the itinerary. [V] ([Hotel-Online](https://www.hotel-online.com/news/agilysys-announces-state-of-the-art-enhancements-to-its-online-reservations-solution-rguest-book))
2. **Book with S.P.E.N.D. (Stay Package Entitlements, HITEC 2025).** Guests reserve every entitlement in a package themselves, "from spa and golf to dining and activities and tours," in a single guided online flow "with zero staff involvement." It is integrated with Agilysys PMS, POS, spa, golf, dining and activities, and won a 2025 Gaming & Leisure platinum award. [V] ([Hospitality Net](https://www.hospitalitynet.org/news/4127719/debuting-at-hitec-2025-agilysys-book-with-spend-lets-guests-reserve-package-entitlements-with-zero-staff-involvement); [Business Wire](https://www.businesswire.com/news/home/20251007619148/en/Agilysys-Receives-The-2025-Gaming-Leisure-Gaming-Hospitality-Platinum-Award-For-Agilysys-Book-With-S.P.E.N.D.-Stay-Package-Entitlements-New-Dynamic-Booking-Technology))
   - **This directly addresses OPERA's weakest package experience:** in OPERA, package allowances are back-office constructs that the guest never sees. [I]
3. **Intelligent Guest Profiles (HITEC 2025).** Unified search across **Versa, Stay and LMS** and the ancillary systems (spa, golf, reserve dining, activities) to drive ancillary revenue and personalisation. [V] ([Business Wire](https://secure.businesswire.com/news/home/20250618540579/en/Agilysys-Launches-Intelligent-Guest-Profiles-at-HITEC-2025-to-Transform-How-Hoteliers-Harness-Guest-Data-to-Expand-Ancillary-Revenue-and-Personalize-Service))
4. **Charge-to-room everywhere.** Book4Time integrates directly with Agilysys PMS (Stay), InfoGenesis POS, Golf and Memberships, with **room-charge capability and property-level guest recognition**. [V] ([Book4Time by Agilysys](https://www.agilysys.com/en/products/book4time/))
5. **POS dominance in casino and resort F&B** gives PMS land-and-expand leverage. [I, InfoGenesis heritage]

### 6.3 Praise and complaints

- **Thin data** [V]: Capterra 4.3 from 9 reviews; G2 4.7 from 3. ([Capterra](https://www.capterra.com/p/193533/Agilysys-Stay/reviews/); [G2](https://www.g2.com/products/agilysys-stay))
- **Complaints** [V]:
  - "There is **NEVER a level 2 tech** available after hours (after 5pm) or weekends."
  - Reaching qualified support was "the most frustrating part."
  - **On-site work was lost during the cloud integration/migration.**
  - Aggregators cite timeouts and slow processing during busy periods (for a related Agilysys product), and billing-resolution friction. ([rfp.wiki](https://www.rfp.wiki/specialty-industries/hospitality-travel/agilysys/guestline))
- **Inference** [I]: three PMS products (LMS, Versa, Stay) create roadmap and support dilution, and migration risk for long-tenured LMS and Versa sites.

### 6.4 Architecture and openness

- **APIs** [V, low-confidence, from a vendor with a commercial interest]:
  - REST APIs on an **Azure API Management** developer portal, listed in the HTNG registry;
  - access only through the **Solution Partners program**: apply, sign an NDA, certify per integration type;
  - no public reference docs or OpenAPI specs;
  - legacy **LMS, Visual One and Eatec still use XML and file interfaces**.
  - ([Supergood report card](https://supergood.ai/api-report-card/agilysys); [Supergood docs](https://supergood.ai/docs/agilysys-api))
- **Mobile:** Agilysys Guest App. [V] ([App Store](https://apps.apple.com/se/app/id6449189252))
- **Hosting:** Stay is cloud SaaS, and Agilysys emphasises "cloud-native and on-premises SaaS." [V] Azure as the underlying cloud is inferred from the API Management detail [I].

### 6.5 Finance specifics (Agilysys Stay, from the rGuest Stay help site)

- **Split charges** [V] ([Split charges](https://help.rguest.com/stay/UserGuide/Split%20Charges%20Between%20Accounts.htm)):
  - by account or via a **routing-rule template**;
  - split by **percentage**;
  - across reservation, group and house-account folios;
  - must be enabled under Guest Accounting, Folio Defaults.
- **Rules-based folio routing, patented** [V] ([USPTO](https://uspto.report/patent/app/20170124610); [Add routing rule](https://help.rguest.com/stay/UserGuide/Add%20a%20New%20Routing%20Rule.htm)):
  - Agilysys's US 2017/0124610 evaluates each charge against the stay's routing rules and assigns a destination folio;
  - it then processes the charge per that folio's payment method;
  - rules can be **ranked** and applied to an individual guest or to a group;
  - **check freedom-to-operate before copying the exact claimed mechanism.**
- **Date roll versus fiscal-day close are separate concepts** [V]:
  - **Auto Date Roll** is configurable for remaining departures. Options include check-out with balance (permission-gated), and "continue" or "stop" the roll on payment failure.
  - Errors appear in a Night Audit log.
  - In a **manual date roll**, failed tasks show red and can be **retried**. The roll completes only when every task succeeds.
  - **Closing the accounting (fiscal) day** is a *separate* act that blocks further postings to that day. It can be automatic (off by default) or manual, after reviewing the AR, City and Guest ledgers and the **Ledger Summary Report**.
  - ([Auto Date Roll](https://help.rguest.com/stay/UserGuide/Auto%20Date%20Roll.htm); [Managing departures](https://help.rguest.com/stay/UserGuide/Managing%20Departures%20for%20Automatic.htm); [Manual date roll](https://help.rguest.com/stay/UserGuide/Manual%20Date%20Roll.htm); [Auto fiscal close](https://help.rguest.com/stay/UserGuide/Automatically%20Closing%20a%20Fiscal.htm); [Manual fiscal close](https://help.rguest.com/stay/UserGuide/Manually%20Closing%20a%20Fiscal.htm); [Night Audit](https://help.rguest.com/stay/UserGuide/Night%20Audit.htm))
- **Agilysys Pay.** Positioned as the integrated payments layer across PMS, POS and ancillaries. Details were **not verified** this session (search budget exhausted). [I]

### 6.6 Adopt and avoid

**Adopt**
- The **itinerary** as the top-level guest object, with the room stay as one component alongside spa, golf, dining and activities, under one confirmation and one payment method.
- **Guest-self-serviceable package entitlements.**
- Separate **operational day roll** from **accounting close**.
- Ranked routing rules with **percentage splits**.
- Configurable failure policies for automated rolls (continue or stop on payment failure).

**Avoid**
- Multiple PMS codebases.
- NDA-gated APIs with no public specs.
- No tier-2 support after hours. Hospitality runs 24/7, so tiered on-call support is mandatory.
- Data loss during migrations. Use dual-run reconciliation and immutable import logs.

---

## 7. Cross-vendor comparison of finance and operations patterns

| Capability | OPERA Cloud | Infor HMS | Shiji Daylight | Agilysys Stay | Monoclay stance [I] |
|---|---|---|---|---|---|
| Business date | Yes; EOD rolls it; global logout at roll [V] | Yes; EOD with per-step status report [V] | Not verified | Date roll **separate from fiscal close** [V] | Business date for accounting; non-blocking roll; separate close |
| EOD automation | Scheduler; 3 retries; halts on exceptions; human prints final reports [V] | Not verified | Not verified | Auto date roll with failure policies [V] | Continuous exception queue; one-click or zero-click close |
| Folio model | Windows 1–8 plus payees [V] | Ledgers; direct bill [V] | Not verified | Folios; split by percentage [V] | Unlimited "billing parties," labelled by payer, not by number |
| Routing | Transaction/routing codes; dates, days, limits; room and comp; profile and rate defaults with precedence [V] | Not verified | Not verified | Ranked rules; group or individual; templates [V] | Ranked rules from any source, with live preview and retro-apply |
| Taxes | Generates; inheritance; chaining; inclusive/exclusive; tax types [V] | Not verified | Fiscal in 36 countries (claim) [V] | Not verified | Rule engine with a jurisdiction pack, chaining and an exemptions model |
| AR / city ledger | Direct-bill pseudo-payment; auto or manual transfer; accruals; aging; restricted accounts [V] | AR aging, direct bill [V] | Not verified | AR, City and Guest ledgers at close [V] | Full AR with invoice review queue and payer portal |
| Packages | Posting type, calculation rule, rhythm, allowance, profit/loss [V] | Not verified | Not verified | **Guest-bookable entitlements (S.P.E.N.D.)** [V] | Entitlements with allocation, fulfilment, guest visibility and breakage |
| Groups | Status types and flow; grids; cutoff; elastic; posting master [V] | Group block and forecast reports [V] | M&E integrated [V] | Group folios; routing [V] | OPERA-parity statuses, with defaults pre-built |
| Fiscal | OFIS Cloud; 3 partners; triggers; retries [V] | Not verified | Productised per country [V] | Not verified | Adapter SDK plus country packs |
| Events and API | OHIP REST plus GraphQL streaming; 7-day replay; partner pays; enabled by Professional Services [V] | ION API Gateway (OAuth2) [V] | Webhooks API, sandbox, GraphQL [V] | Partner-gated Azure APIM; NDA [V] | Self-serve keys, webhooks plus streaming, public OpenAPI, replay |
| Multi-property | One-way profile-sharing switch [V] | Not verified | **Configure-once portfolio**; global profile [V] | Unified profile search across PMS products [V] | Global-first hierarchy with inheritance and drift reports |

---

## 8. Consolidated patterns and anti-patterns

**Patterns to adopt (what the market treats as table stakes)** [V for existence, I for recommendation]

1. Business date and a deterministic end-of-day, with restartable idempotent steps and a per-step status log (OPERA, Infor).
2. Typed block statuses (none, deduct or release), a configurable status flow, and mandatory reasons for lost, cancel and refused outcomes (OPERA).
3. Original versus current versus pickup grids; cutoff by date and by rolling days; elastic sell limits (OPERA).
4. Routing defaults inherited from company, agent, source and contact profiles and from rate plans, with deterministic precedence (OPERA).
5. Tax and service generation via an inheritable, chainable rule tree (OPERA).
6. Package posting rhythms, calculation rules and allowance profit and loss (OPERA), surfaced to guests as entitlements (Agilysys).
7. A direct-bill review queue before invoices hit AR, with accruals reported until transfer (OPERA).
8. Event streaming with replay and field-level payload selection (OHIP).
9. Hierarchical portfolio configuration (Shiji).
10. Itinerary-centric guest journeys with ancillary charge-to-room (Agilysys).
11. Gaming player-value and comp linkage as an optional vertical (Infor, Agilysys).

**Anti-patterns to avoid**

1. Global user logout to roll the date (OPERA). [V]
2. Irreversible configuration switches, such as OPERA's profile sharing. [V]
3. Platform capabilities that need the vendor's professional services to enable (OPERA streaming). [V]
4. NDA-gated, undocumented APIs (Agilysys, per a third party). [V, low confidence]
5. Frequent releases that cause regressions and downtime (Infor reviews). [V]
6. UIs that need more than one shift to learn for front-desk basics (OPERA reviews). [V]
7. Multiple steps for everyday tasks such as billing, room assignment and lookup (Infor reviews). [V]
8. Performance that collapses on weak hotel internet (OPERA reviews). [V]
9. Thin after-hours support (Agilysys reviews). [V]
10. Several parallel PMS codebases (Agilysys). [I]
11. Statistics available only after the audit (OPERA legacy). [V-legacy]

---

## 9. Top 15 takeaways for Monoclay (ranked by impact)

1. **Match OPERA's data model concept for concept, under original names. That is the actual moat.**
   - Business date, typed block statuses, window-equivalent billing, routing precedence, transaction-code hierarchy with generates, packages with rhythms and allowances, direct bill to AR.
   - Enterprise buyers, controllers and the OPERA-trained labour pool will judge Monoclay on whether every OPERA workflow has a mapped equivalent.
   - Publish an "OPERA concept map" in the docs and the migration tooling.

2. **Make end-of-day non-blocking and mostly invisible. Separate the day roll from the accounting close.**
   - Keep business-date semantics for accounting, but never force a global logout.
   - Keep pre-roll checks as a live exception queue all day.
   - Post room and tax idempotently, and keep statistics real-time.
   - Add a separate, reversible-until-closed **accounting close**, as Agilysys does.
   - This is the clearest "same depth, far easier" win against OPERA's roll procedures, its 12-hour constraint and its halt conditions.

3. **Build a ranked, explainable billing-rules engine instead of numbered windows.**
   - Rules are parties × charge selectors (category, date range, day of week, amount or percentage cap).
   - Sources are manual, profile, rate plan, block or package, with deterministic precedence.
   - Show a live "who pays for what" preview, and allow retroactive re-application with an audit trail.
   - Check Agilysys's routing patent (US 2017/0124610) for freedom-to-operate.

4. **Run real double-entry ledgers in real time.**
   - Guest, deposit, AR, package/allowance and house ledgers, with an always-balanced trial balance.
   - End-of-day becomes a snapshot, not a computation. This also eliminates whole classes of OPERA EOD defects, such as invoices with wrong AR amounts created during the guest-ledger step.

5. **Packages become guest-visible entitlements.**
   - Revenue allocation, fulfilment at outlets, spa, golf and activities, live allowance balances, automatic breakage and profit/loss, and guest self-booking (Agilysys S.P.E.N.D.).
   - This is the connected-resort story without owning every ancillary system.

6. **Ship enterprise-grade group blocks with opinionated defaults.**
   - Typed statuses (none, deduct or release), a pre-built status flow, mandatory reasons, original, current and pickup grids, cutoff and elastic limits, rooming-list import and a posting master.
   - OPERA forces each property to configure all of this itself. Monoclay should work on day one.

7. **Make the portfolio the root of the data model from day one.**
   - Configuration inherits from global to brand to region to property, with visible overrides and drift reports (Shiji).
   - A global guest profile with property-scoped data and consent.
   - Never ship OPERA-style irreversible switches.

8. **Make the integration platform self-serve, event-first and publicly documented.**
   - Public OpenAPI, instant sandbox keys, webhooks plus a durable stream with at least 7 days of replay, and field-level payload selection.
   - Transparent per-usage partner pricing; OHIP's $10 per 100k events is the benchmark.
   - Nothing should require vendor professional services or an NDA to enable. This is the main openness gap across OPERA (Professional Services gating) and Agilysys (NDA-gated).

9. **Productise fiscal and localisation.**
   - A fiscal-adapter SDK with multiple prioritised partners, triggers (checkout, settlement, payment), retries and dead-letter queues (OFIS pattern).
   - Country packs for taxes, invoice numbering and exports such as SAF-T.
   - Shiji uses "fiscal compliance in 36 countries" as a sales weapon.

10. **Design for "productive in one shift."**
    - Task-based screens and progressive disclosure, so the full depth is reachable without shown-by-default density.
    - Keyboard-first for power users, and in-product guidance.
    - Measure time-to-competency as a KPI. Training time is the most consistent OPERA complaint.

11. **Engineer for hotel-grade connectivity and 24/7 operations.**
    - Resilient clients that tolerate degraded internet and keep critical front-desk flows (check-in, key, posting) usable.
    - Published uptime, and real tier-2 on-call at night.
    - These address OPERA's "runs slowly and crashes" and Agilysys's "no level-2 after 5pm" complaints.

12. **Make release safety a feature.**
    - Release rings, per-tenant feature flags, canaries, zero-downtime deploys, and release notes with opt-in windows for disruptive UI changes.
    - Infor's top complaint is bugs and downtime after frequent updates.

13. **Treat payments as token-first and PSP-agnostic, with optional embedded payments.**
    - HTNG-style token exchange, bulk tokenization for channel bookings, and an internal vault for properties without a PSP vault (OPI pattern).
    - Plus an embedded-payments offering (Shiji Payby, Agilysys Pay) for revenue share.

14. **Turn migration into a factory, and make "OPERA-in, Monoclay-out" a product.**
    - Config mapping from OPERA codes (rate codes, transaction codes, block statuses, routing codes), profile and AR history import, and dual-run reconciliation reports.
    - Benchmarks: Shiji's 7 properties a day and Wyndham's 20 hotels a week. Avoid Agilysys's lost-data-during-migration failure.

15. **Offer vertical packs for resorts and casinos rather than a monolith.**
    - Itinerary booking (room plus spa, golf, dining) under one confirmation and payment method (Agilysys).
    - Ancillary charge-to-room including after checkout (Infor).
    - Gaming player-value and comp posting as a payment type (Infor, Agilysys).
    - Deliver these via open integrations to best-of-breed spa, POS and gaming systems. This lets Monoclay compete in Agilysys's and Infor's strongholds without building POS or spa software.

---

### Appendix A: open questions to validate in demos and discovery [I]

- Does Shiji Daylight implement OPERA-style windows and routing, and how does it handle the end-of-day roll? Does it block users?
- How do multi-currency and multi-legal-entity work in each vendor's AR?
- How deep is Agilysys Pay (PSP, payfac model, cross-outlet token reuse)?
- What exactly is Marriott deploying from Agilysys (which brands or segments), and why not OPERA Cloud?
- Is Infor HMS truly single-codebase multi-tenant for every customer, or are some hosted single-tenant?
- What is OPERA Cloud's current per-room price band for Premium versus Foundation, and how much do partners' OHIP costs get passed to hotels?
