# Guest-journey coverage map

Status: v1 · 2026-11-07 · Guest-journey audit (branch `docs/guest-journey-audit`).
Scope: every touchpoint a guest, booker or staff member meets from *before the reservation* to *after the stay*,
for five property types. Back-of-house (accounting/GL/AP, F&B POS and kitchen, procurement, stock, workforce/HR,
utilities, concessions) is audited separately; this map only names the hand-off points (marked **BOH**).

Companion documents: [gap-register.md](gap-register.md) (every MISSING or partial item, with owner and priority),
[spec-change-requests.md](spec-change-requests.md) (proposed edits to existing specs), [README.md](README.md) (top 25).
New specs proposed by this audit: [access](../specs/access.md), [guest-experience](../specs/guest-experience.md),
[crm-marketing](../specs/crm-marketing.md), [contracting](../specs/contracting.md),
[guest-services](../specs/guest-services.md).

---

## 1. How to read this map

### 1.1 Columns

| Column | Meaning |
|---|---|
| **ID** | Stable touchpoint id `T-<stage><nn>` (stages A–G below). Referenced by the gap register. |
| **Who** | The role doing it, using the personas in `docs/product/personas-and-workspaces.md` where they exist (FD front desk, RV reservations, GR guest relations/butler, HK housekeeping, ENG engineering, FB outlet staff, SPA spa/activities, TR transfer coordinator, SAL sales, FIN finance/AR, GM general manager, OWN guesthouse owner, IT integration admin, MKT marketing — new, SEC security — new, G guest, B booker/agent). |
| **Systems** | What is touched today in a typical hotel (Portico or other systems). |
| **Portico coverage** | Owning module and requirement ids as they stand on `main` (before this audit's proposals). |
| **Status** | See §1.2. A `→ JG-nn` pointer names the gap in [gap-register.md](gap-register.md). |
| **Ext. dependency** | The external party/system the touchpoint depends on, if any. |
| **Maldives** | Maldives / Indian Ocean specifics. |
| **Applies** | `G` 12-room guesthouse on an inhabited island · `R` 120-villa resort with seaplane transfers · `H` city/full-service hotel · `A` serviced apartments · `M` multi-property group (adds a cross-property dimension). |
| **Pri** | Priority for a **Maldives pilot**: **P0** pilot-critical (cannot run the pilot without it or a documented manual alternative), **P1** needed for a convincing pilot or the first resort, **P2** later. Where a segment differs it is noted, e.g. `P2 (A: P1)`. |

### 1.2 Coverage status vocabulary

| Status | Meaning |
|---|---|
| **built** | Implemented on `main` with tests (R3+). **No guest-journey capability is built yet**: only the `platform` and `identity` foundations exist (`modules/`, readiness register 2026-11-07). Every row below is therefore R1 at best. |
| **specified** | A MUST/SHOULD requirement in an existing spec covers the touchpoint (R1). |
| **partial** | Something is specified, but an operationally important part is not (named in the gap). |
| **planned** | Mentioned as LATER, as a non-goal "integrate instead", or in the coverage matrix, without requirements. |
| **MISSING** | Not covered anywhere in `docs/` before this audit. |
| **integration-only** | Portico deliberately integrates rather than builds (a workflow is or should be defined). |

### 1.3 Evidence labels

**[V-web]** verified in this session (2026-11-07) from search-engine extracts of the cited page (several official
hosts block direct fetches, e.g. `transmaldivian.com` and `mfr.mv` did not resolve from this environment) —
re-verify before building; **[R]** verified earlier and recorded in this repository (e.g.
`docs/readiness/maldives-tax-rules.md`); **[DK]** industry domain knowledge, unverified; **[A]** planning
assumption. No claim below is a legal conclusion.

### 1.4 Verified Maldives and vendor facts used in this audit

| Fact | Source | Label |
|---|---|---|
| Every arriving traveller except Maldivian citizens must submit the online **IMUGA Traveller Declaration within 96 hours before arrival**; one declaration per traveller, children included; the official portal is `imuga.immigration.gov.mv` and it is free. Whether **departing** travellers must also file is **conflicting** (a CAA circular says yes; later reports say outbound declarations were discontinued) — treat departure as unconfirmed. | [CAA circular](https://www.caa.gov.mv/attachments/GeoIWGEBZdZ3bWbNgJFI5rlTPZ3iBns6ZcjVY7PV.pdf), [Wego IMUGA guide](https://blog.wego.com/imuga/) — verified 2026-11-07 | [V-web] |
| Tourists receive a free **30-day visa on arrival**; they need **confirmation of a hotel/resort booking** (or evidence of sufficient funds). Guides describe the booking as one at a **registered** tourist establishment. | [Maldives mission — Entry to Maldives](https://tr.mdvmission.gov.mv/index.php/en/consular/for-foreigners/entry-to-maldives) — verified 2026-11-07 | [V-web] |
| Seaplane transfers fly **daylight only** (visual flight rules); sources give roughly **06:00 to 15:00–16:00**; late international arrivals overnight in **Malé/Hulhumalé** and fly next morning; the transit night is usually paid by the guest; operators allocate seaplane times after the international flight is known, often confirming the day before. The operator's own site could not be reached from this environment. | [Blue Bay Travel](https://bluebaytravel.co.uk/blog/2023/11/seaplane-transfer-in-the-maldives/), [aMaldives missed seaplane](https://amaldives.com/blog/maldives-missed-seaplane-what-to-do), [Centara transfer page](https://prod.centarahotelsresorts.com/centaragrand/CIRM/sea-plane-transfer), [Travelsort](https://travelsort.com/?p=18404) — verified 2026-11-07 (secondary) | [V-web] secondary |
| Recreational diving is limited to **30 m**; decompression diving is prohibited; dive centres must be **registered and licensed** by the Ministry of Tourism and keep the regulation available to divers; a 40 m change has been consulted on but not adopted. | [Maldives Recreational Diving Regulation (Ministry of Tourism)](https://old.mvlaw.gov.mv/pdf/gavaid/minTourism/10.pdf), [Thulhagiri diving page](https://www.thulhagiri.com.mv/activities/diving), [edition.mv](https://edition.mv/news/51203) — verified 2026-11-07 | [V-web] |
| A tax invoice/receipt must be issued **within 3 days** of completing the service; Green Tax shown separately; tips outside the GST base; Green Tax counts the check-out 24-hour block if the guest spent **≥ 12 hours** in it; children under 2 exempt; complimentary stays still taxable; TIMS occupancy/nationality reports weekly and monthly. | `docs/readiness/maldives-tax-rules.md` §4, §5, §7 | [R] |
| **ASSA ABLOY Vostio** is cloud-hosted (no local servers) and integrates with a PMS through an API; supports app-based and wallet mobile keys. **Visionline** (on-premise) PMS-style functions need a separately sold converter. | [VingCard Vostio](https://www.vingcard.com/en/the-vingcard-solution/access-control/access-management-systems/cloud-based), [ASSA ABLOY Japan (ipros)](https://pr.www.ipros.com/en/assaabloyglobalsolutions/product/detail/2000500816) — verified 2026-11-07 | [V-web] |
| **Salto Space** (on-premise) talks to PMSs through its PMS interface over TCP/IP — "Industry Standard" interface versions and a FIAS option; encoder names must match between Space and the PMS; mobile keys need a Salto JustIN licence; Salto announced **Apple Wallet** room keys in June 2026. | [Salto × IDS Next](https://saltosystems.com/en/technology-partners/ids-next/), [Cloudbeds: connect Salto Space](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/37588053064731), [Stayntouch Salto integration](https://stayntouch.freshdesk.com/support/solutions/articles/24000090574-salto-direct-key-integration), [SecurityInfoWatch](https://www.securityinfowatch.com/access-identity/product/55383399/salto-systems-inc-salto-adds-room-key-support-in-apple-wallet-for-hospitality-properties) — verified 2026-11-07 | [V-web] |
| **dormakaba Ambiance** offers PMS interfaces (web services, TCP/IP, serial); mobile keys need a dormakaba Mobile Access licence plus a LEGIC Connect account and recent lock firmware; Ambiance locks do not support remote web unlock; dormakaba sells Apple Wallet room keys. | [Seam — Ambiance guide](https://docs.seam.co/latest/device-and-system-integration-guides/dormakaba-ambiance-access-control-system/dormakaba-ambiance-setup-guide), [Clock PMS+ Saflok/Ambiance](https://support.clock-software.com/en/support/solutions/articles/9000213350-saflok-by-dormakaba), [dormakaba Apple Wallet](https://dormakaba.com/us-en/offering/products/lodging-systems/digital-wallet/apple-wallet--dk_98103) — verified 2026-11-07 | [V-web] |
| Hotel Wi-Fi gateways commonly authenticate guests by **room number + last name** synced from the PMS over the FIAS interface, and can post paid internet charges to the folio. | [RANSNET hotel Wi-Fi](https://docs.ransnet.com/cases/cp/hotelwifi/), [LANCOM PMS accounting datasheet](https://www.lancom-systems.com//fileadmin/produkte/lc_PMS_accounting/PS-PMS-AC-PLUS_EN.pdf) — verified 2026-11-07 | [V-web] |
| WhatsApp Business Platform bills **per delivered message by category** (since 1 Jul 2025); only **templates** may be sent outside the 24-hour customer-service window; marketing templates are charged even inside it. | [Meta — WhatsApp pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) — verified 2026-11-07 | [V-web] |
| Google **free booking links** carry no fee and their ranking is not affected by bids. | [Google Hotel Center help](https://support.google.com/hotelprices/answer/10472393) — verified 2026-11-07 | [V-web] |

---

## 2. Five journeys, one product

The tables in §3 are the exhaustive list. This section shows how the same journey bends per property type, and
which gaps hurt each type most.

**G — Hiyani Guesthouse (12 rooms, inhabited island, owner "Ali" on a phone).** Most guests arrive through
Booking.com/Agoda or a Malé DMC that emails a voucher; enquiries come by WhatsApp. Ali quotes by WhatsApp, takes a
bank-transfer deposit or a card at arrival, arranges the public speedboat or ferry, sells sandbank and snorkel trips,
hands over a **mechanical key**, cooks breakfast (no alcohol on inhabited islands [DK]), and must issue a tax invoice
within 3 days and file Green Tax ($6 class) and TIMS statistics. Late-night arrivals need self check-in instructions.
*Biggest gaps:* DMC contracts and net-rate vouchers (JG-02), WhatsApp quote → hold → payment link → booking
(JG-36), booking confirmation fit for the immigration desk (JG-07), invoice deadline and delivery (JG-08), key log
(JG-01), review replies on OTAs (JG-40).

**R — Kandu Atoll Resort (120 villas, seaplane).** Most room nights come from tour operators on seasonal net
contracts with allotments, release periods, early-bird/free-night/honeymoon offers and festive supplements [A];
the rest from OTAs and direct. Before arrival the resort needs passport names and weights for the seaplane
manifest, the international flight, dietary needs, celebrations and preferences routed to the right departments; a
butler is assigned. A representative meets guests at Velana, the seaplane lounge holds them until a slot, late
arrivals are sent to a Hulhumalé transit hotel. At the jetty: welcome, check-in on a tablet, keys (often cards or
wristbands prepared in advance), Wi-Fi details, buggy, luggage to the villa. In-stay: meal-plan dining across
outlets, table reservations, in-villa dining, minibar, laundry, spa, diving (certification, 30 m limit), excursions,
kids club, clinic, weather disruptions. Departure is timed to the international flight via the daylight seaplane.
*Biggest gaps:* contracting (JG-02), keys (JG-01), charge privileges for room charging (JG-09), allergy propagation
(JG-11), muster list (JG-10), seaplane cut-off and transit nights (JG-29), arrival preparation and butler
(JG-14, JG-15), dining reservations (JG-19), minibar/laundry/luggage (JG-20–22).

**H — City hotel (full-service, corporate and leisure).** Corporate negotiated rates, company billing with PO/cost
centre on invoices, airport shuttle, parking and valet, kiosk or mobile check-in, mobile keys, restaurant table
bookings from outside guests, meeting rooms, late arrivals after midnight, PBX and Wi-Fi integrations, reputation
on Google/TripAdvisor. *Biggest gaps:* access/mobile keys (JG-01), guest portal and kiosk (JG-03, JG-05), parking
(JG-55), table reservations (JG-19), telephony/Wi-Fi (JG-25, JG-26), reputation (JG-40).

**A — Serviced apartments (weekly/monthly stays).** Rental agreement signed online, security deposit held and
returned after a condition check, recurring weekly/monthly billing, metered utilities recharged, keypad or app
keys, cleaning every *n* days, parcels, notice periods for extension or early leave. *Biggest gaps:* long-stay
billing and deposits (JG-54), PIN/app keys and self check-in (JG-01, JG-60), condition reports (JG-54).

**M — Azure Isles Group (3 properties).** One guest recognized across properties, dine-around between sister
islands, central reservations moving a booking between properties, group-wide contracts with the same tour
operators, consolidated reputation and NPS, loyalty recognition, one guest-portal brand. *Biggest gaps:* contracting
across properties (JG-02), group search and central reservations (JG-52), group reputation/NPS (JG-39, JG-40),
loyalty (JG-44).

---

## 3. Stage-by-stage coverage

### Stage A — Discover and decide (before a reservation exists)

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-A01 | Hotel website and content management | MKT, OWN | Website CMS, web agency | — (Portico supplies booking widget only) | MISSING → JG-50 | Hotel's website/CMS vendor | Many guesthouses rely on OTA pages + Instagram/Facebook [A] | all | P2 |
| T-A02 | Property and unit-type content (texts, photos, amenities, policies, house rules, local customs) reused by booking engine, guest portal, OTAs, Google | MKT, RV | Booking engine, OTA extranets, website | `distribution` DST-R18 (content LATER) | planned → JG-49 | OTAs' content APIs via hub | Local-island rules (dress code, no alcohol on inhabited islands [DK]) must be shown before booking | all | P1 |
| T-A03 | Direct booking engine (search, offers, all-in price, policies) | G, B | Booking engine | `distribution` DST-R16; `rates` RAT-R27 | specified | Payment gateway (Q2) | USD pricing; Green Tax shown per person-night | all | P1 |
| T-A04 | Extras, packages, multi-room, promo codes in the booking path | G | Booking engine | DST-R16 extras; RAT-R10/R11/R16 | specified | — | Honeymoon packages, seaplane transfer as extra | all | P1 |
| T-A05 | Booking-engine abuse protection (card testing, bot/fake bookings, rate scraping) | IT | Booking engine, PSP risk tools | — | MISSING → JG-48 | PSP fraud tooling | Local gateways' 3DS/risk features unconfirmed (Q2) | all | P1 |
| T-A06 | Privacy notice, cookie/tracking consent on guest-facing pages | MKT | Booking engine, website | — (GUE-R06 covers marketing consent only) | MISSING → JG-48 | — | Source markets include EU/UK guests [A] | all | P1 |
| T-A07 | Conversion tracking and source attribution (UTM, ads conversion with consent) | MKT | Booking engine, analytics tags | — | MISSING → JG-48 | Google/Meta tags | — | all | P2 |
| T-A08 | Google free booking links / hotel ARI | RV | Google Hotel Center | DST-R17 (SHOULD) | specified | Google Hotel Center partner status | Price must include Green Tax/TGST exactly | all | P1 |
| T-A09 | Paid metasearch (Hotel Ads CPC, Tripadvisor, trivago) | MKT | Metasearch platforms | — | MISSING → JG-50 (integration-only) | Metasearch partners | — | R H M | P2 |
| T-A10 | OTA distribution (ARI, bookings, cancellations) | RV | Channel hub, OTAs | `distribution` DST-R01–R15 | specified | Channex + OTAs (dependency register 3.1–3.6) | Booking.com/Agoda dominant for guesthouses [A] | all | P0 |
| T-A11 | OTA content, photos and amenity sync | MKT | OTA extranets | DST-R18 (LATER) | planned → JG-49 | Hub content APIs | — | all | P2 |
| T-A12 | Rate parity monitoring (own channels vs direct; market rate shopping) | RV | Rate shopper | — | MISSING → JG-51 | Rate-intelligence vendor | TO contracts often carry parity clauses [A] | R H M | P2 |
| T-A13 | Promotions and promo codes | RV | Rates | RAT-R11, RAT-R12 | specified | — | Early-booking and "stay X pay Y" common | all | P1 |
| T-A14 | Member/recognition rates and benefits at booking | MKT | CRM/loyalty | RAT-R10 member-only (LATER); GUE-R15 recognition | planned → JG-44 | — | — | H M | P2 |
| T-A15 | Gift vouchers/cards (sell, deliver, redeem, expire) | MKT, FD | Voucher platform | — | MISSING → JG-45 | Payment gateway | Spa/dinner vouchers sold to residents and expatriates [A] | R H M | P2 |
| T-A16 | Enquiries by email | RV, OWN | Inbox | `comms` COM-R01/R02 | specified | Email provider (SES) | — | all | P1 |
| T-A17 | Enquiries by WhatsApp | RV, OWN | WhatsApp | COM-R09 | specified | Meta WhatsApp Cloud API (dependency 4.4) | Dominant channel [A, Q64] | all | P0 |
| T-A18 | Web chat on the website | RV | Chat widget | COM channel "web chat/guest portal" (widget not specified) | partial → JG-03 | — | — | all | P2 |
| T-A19 | Phone enquiries (caller identified, call logged on the profile) | RV | PBX/CTI | — (comms: voice LATER) | MISSING → JG-59 | PBX/CTI vendor | — | R H M | P2 |
| T-A20 | Enquiry → inquiry booking, follow-up date, lost reason | RV, OWN | PMS, inbox | RES-R08 statuses; COM-R04 (tasks) — no link from conversation to inquiry | partial → JG-36 | — | Guesthouse owner answers 10–30 WhatsApp enquiries a day [A] | all | P1 |
| T-A21 | Individual quote/proposal (options, hold with expiry, accept and pay online) | RV, OWN, G | PMS, email/WhatsApp, payment link | RES `quoted`/`held`; INV-R15 holds; PAY-R19 links — no quote document or guest acceptance | partial → JG-36 | Payment gateway | Quotes usually in USD incl. taxes and transfer | all | P1 |
| T-A22 | Agent availability/price lookup | RV | Quote panel | RAT-R27; rates UX "Quote panel" | specified | — | — | all | P0 |
| T-A23 | Tour-operator/DMC **contract loading**: seasons, net/commissionable rates per market and meal plan, supplements, child and extra-bed policy | RV, revenue | Contracting spreadsheets, PMS | RAT-R06 (net/commissionable plan), RAT-R13–R16 — no contract object, seasons, markets or supplements | partial → JG-02 | — | Core resort revenue model; contracts Nov–Oct, USD/EUR [A] | R G M | P0 |
| T-A24 | **Allotments and release periods** per contract season (free sale, on request, guaranteed) | RV | PMS | GRP-R11 (one release rule, no seasons, no free-sale/on-request) | partial → JG-02 | — | Release 7–30 days by season [A] | R G M | P0 |
| T-A25 | **Combinable offers** (early bird, free nights, honeymoon, long stay) with combinability matrix, application base and order, proof (marriage certificate) | RV | PMS, contracts | RAT-R11 (exclusive/stackable only) | partial → JG-02 | — | Honeymoon offers require proof of marriage within a period [A] | R G M | P0 |
| T-A26 | **Stop-sale** notices to tour operators (timestamped, acknowledged, effective time) | RV | Email, TO extranets | `closed` restriction RAT-R08 (no notice/ack to contract partners) | MISSING → JG-02 | TO extranets/email | High-season stop-sales are routine [A] | R G M | P0 |
| T-A27 | Wholesaler/bedbank XML (Hotelbeds, WebBeds…) | RV | Bedbank extranets/XML | Coverage matrix 5.2 (via hub, P1) | planned → JG-02 | Hub or bedbank partner | Common for resorts [A] | R M | P1 |
| T-A28 | **Contract check** of TO bookings (TO price vs contract computation; offers applied correctly) | RV, FIN | Spreadsheets | — | MISSING → JG-02 | — | Daily resort reservations task [A] | R G M | P0 |
| T-A29 | Corporate negotiated rates; RFP season | SAL | Rates, RFP portals | RAT-R06 (rates); RFP process — | partial → JG-62 | GDS/RFP platforms | — | H M | P2 |
| T-A30 | Group/event enquiries and proposals | SAL | S&C | GRP-R02 | specified | — | Weddings, incentive and dive groups | R H M | P1 |
| T-A31 | Wedding/vow-renewal enquiries for individual couples | SAL, GR | Events, activities | GRP-R12, RST-R07 (no individual-couple ceremony flow) | partial → JG-14 | Celebrant/photographer suppliers | Symbolic ceremonies on beaches/sandbanks [DK] | R | P2 |
| T-A32 | Dynamic pricing and recommendations | Revenue | RMS | RAT-R31; RAT-R32 (LATER) | specified | RMS vendors (P2) | — | all | P2 |
| T-A33 | Multi-property search in one booking engine | G | Group booking engine | — | MISSING → JG-52 | — | Multi-island groups | M | P2 |
| T-A34 | Central reservations / contact centre across properties | RV | CRS | `portfolio.centralReservations` (LATER) | planned → JG-52 | — | — | M | P2 |
| T-A35 | Guest-facing AI concierge answering pre-booking questions | G | Chatbot | `ai` is staff-only (AI-R04) | MISSING → JG-57 | LLM provider (Q25) | Multilingual demand | all | P2 |
| T-A36 | Display of prices in guest currency (indicative) | G | Booking engine | — | MISSING → JG-49 | FX rate source | Agreed price stays USD | all | P2 |
| T-A37 | Day visits/day passes (resort day trips, pool/spa passes) | SAL, FD | Booking engine, POS | INV-R30 time-sliced inventory (LATER) | planned → JG-35 | — | Resort day trips from Malé [A] | R H | P2 |
| T-A38 | Accessibility and languages (WCAG 2.2 AA; zh, ru, it, de, ar incl. RTL) | G | Booking engine | DST-R16; ux-principles §13–14 | specified | — | Chinese/Russian/GCC markets | all | P1 |

### Stage B — Book

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-B01 | Booking by staff (phone, email, walk-in) | RV, FD | PMS | RES-R01–R04, RES-R22 | specified | — | — | all | P0 |
| T-B02 | Booking-engine checkout and payment (hosted fields, 3DS) | G | Booking engine, PSP | DST-R16, PAY-R06 | specified | Local acquirer/gateway (Q2, dependency 2.4) | Stripe unavailable for Maldivian entities (D10) | all | P1 |
| T-B03 | OTA booking ingestion, VCC handling | RV | Hub, PMS | DST-R08–R12, PAY-R07 | specified | Channex, PCI proxy | VCC common for resorts | all | P0 |
| T-B04 | **TO/DMC booking intake** (emailed voucher, rooming list, extranet), voucher number, contract check | RV | Email, PMS | RES-R01 `external_refs.voucher`; GRP-R08 rooming-list import (groups only) | partial → JG-02 | TO systems (email/file) | Vouchers with names only; enriched later [R guests §11] | R G M | P0 |
| T-B05 | Booking confirmation message | RV, auto | Email/WhatsApp | COM-R05/R06 | specified | Email/WhatsApp providers | — | all | P0 |
| T-B06 | **Confirmation document usable at the immigration desk** (registered establishment name/address/licence, guest names as in passport, dates, reference, paid/unpaid) | RV, auto | PMS document | — | MISSING → JG-07 | — | Visa on arrival requires a booking confirmation [V-web] | all | P0 |
| T-B07 | Payment schedule, deposits, payment links, bank transfers | FIN, RV | PMS, PSP, bank | RAT-R20, PAY-R19–R23 | specified | Acquirer/bank | DMCs pay by bank transfer | all | P0 |
| T-B08 | Guarantee and card capture | RV | PSP | RES-R06, PAY-R05 | specified | PSP | — | all | P0 |
| T-B09 | Special requests captured **structured** (bed, dietary, accessibility, occasion, arrival) | RV, G | PMS notes | RES-R01 free-text `special requests`; GUE-R02 preferences | partial → JG-33 | — | Honeymoon/anniversary dominant [R guests §11] | all | P1 |
| T-B10 | Celebrations and occasions (dates, setups, proof for offers) | RV, GR | PMS, notes | GUE-R01 important dates; RAT-R16 packages | partial → JG-14 | — | Honeymoon benefits per TO contract [A] | R G H | P1 |
| T-B11 | Arrival flight capture | RV, G | PMS | RES-R39 | specified | — | MLE arrival time decides seaplane vs transit night | all | P0 |
| T-B12 | Transfer booked with the stay (per-person inclusion or chargeable leg) | RV, TR | PMS, transfer desk | RST-R04; RAT §11 inclusion per person | specified | Transfer operators | Seaplane/domestic flight/speedboat | R G | P1 |
| T-B13 | Children's ages; cots, extra beds, rollaways as **limited ancillary inventory** | RV | PMS | RES-R02 ages; INV — no ancillary items | partial → JG-34 | — | Child age bands vary by resort | all | P1 |
| T-B14 | Guest self-service changes/cancellation ("manage my booking") | G | Booking engine/portal | — | MISSING → JG-37 | — | — | all | P1 |
| T-B15 | Booker ≠ guest ≠ payer | RV | PMS | RES-R01/R02, GUE-R07, FIN-R13 (S04) | specified | — | DMC books, guest pays extras | all | P0 |
| T-B16 | Consent capture at booking (marketing opt-in, separate and unticked) | G | Booking engine | GUE-R06 (UI in booking path unspecified) | partial → JG-48 | — | — | all | P1 |
| T-B17 | Upsell during booking (packages, transfer, experiences) | G | Booking engine | DST-R16 extras | specified | — | — | all | P1 |
| T-B18 | Waitlist for sold-out dates | RV | PMS | RES-R21 | specified | — | — | all | P2 |
| T-B19 | Commission terms snapshotted (agency/OTA) | RV | PMS | RAT-R06, RAT-R28 | specified | — | — | all | P0 |
| T-B20 | Multi-room family bookings | RV | PMS | RES-R04 | specified | — | — | all | P0 |
| T-B21 | Group/allotment pickup | RV | PMS | GRP-R05, GRP-R11 | specified | — | — | R H M | P1 |
| T-B22 | Abandoned-booking capture and recovery | MKT | Booking engine, email | — | MISSING → JG-43 | Email provider | — | all | P2 |
| T-B23 | Duplicate-profile detection at booking | RV | PMS | GUE-R09/R10 | specified | — | Sparse TO data | all | P0 |
| T-B24 | Source market / guest residency for market-restricted contract rates; nationality for statistics | RV | PMS | Market segment ✓ (RES-R01); residency eligibility — | partial → JG-02, JG-13 | — | TO rates are often valid for one source market [A] | R G M | P1 |
| T-B25 | Direct-booking fraud screening (risky cards, mismatched names) | FIN | PSP risk | — | MISSING → JG-48 | PSP risk tools | — | all | P2 |

### Stage C — Pre-arrival

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-C01 | Pre-arrival message sequence (T−7, T−2, T−1) | GR, auto | Messaging | COM-R06/R07 | specified | Email/WhatsApp | Template content for transfers is core | all | P1 |
| T-C02 | Arrival details request and flight confirmation | GR, TR | Messaging, PMS | RES-R39, COM templates | specified | — | International flight number decides transfer plan | all | P0 |
| T-C03 | Guest portal (web, no app install) with booking summary, policies, requests | G | Guest app | `apps/guest` (later wave); RST-R11 (SHOULD) — no spec | MISSING → JG-03 | — | Low bandwidth on islands | all | P1 |
| T-C04 | Online check-in: registration card fields per market | G | Guest portal | RES-R24 `registration` step (staff-side only) | partial → JG-04 | — | Registration fields unconfirmed (Q43) | all | P1 |
| T-C05 | Passport/ID capture (photo, MRZ OCR, optional NFC) | G | Portal, ID-verification vendor | GUE-R05 storage only | partial → JG-04 | ID verification vendor (dependency 6.5) | Storage rules unconfirmed (Q43) | all | P1 |
| T-C06 | E-signature of registration card, terms and policies | G | Portal | RES-R24 (SHOULD, staff-side) | partial → JG-04 | — | Evidence also serves disputes (PAY-R18) | all | P1 |
| T-C07 | Pre-arrival payment (deposit, balance, incidental authorization) | G | Portal, PSP | PAY-R19, PAY-R22 | specified | Gateway (Q2) | — | all | P1 |
| T-C08 | **Passport-exact names, weights and baggage for seaplane manifests** | G, TR | Email, spreadsheets | RST-R04/R05 fields; no guest-facing collection | partial → JG-04 | Seaplane operator | Weight/baggage limits per operator [V-web secondary] | R | P1 |
| T-C09 | **IMUGA reminder** (each traveller incl. children, within 96 h before arrival, official free portal only) | GR, auto | Messaging | — | MISSING → JG-38 | Maldives Immigration portal (guest submits) | [V-web]; departure filing unconfirmed | all | P1 |
| T-C10 | Entry-requirement guidance (visa on arrival needs booking confirmation; return ticket) | GR, auto | Messaging | — | MISSING → JG-38, JG-07 | — | [V-web] | all | P1 |
| T-C11 | Transfer planning (legs, operator booking, confirmation reference) | TR | Transfer desk | RST-R04/R05 | specified | Operators (email/file) | — | R G | P1 |
| T-C12 | **Seaplane daylight cut-off**: detect arrivals too late for a seaplane; propose domestic flight + speedboat or transit night | TR, RV | Transfer desk | — | MISSING → JG-29 | Operator schedules | Cut-off ~15:00–16:00 [V-web secondary] | R | P1 |
| T-C13 | **Transit-hotel night in Malé/Hulhumalé** (sister property or external hotel, voucher, airport pickup, morning seaplane) | TR, RV | PMS, email | RES §11 note only | partial → JG-29 | External transit hotels | Usually paid by guest [V-web secondary] | R | P1 |
| T-C14 | Pre-arrival upsells (upgrade, early check-in, transfer upgrade, spa, dining, celebrations) | GR, auto | Upsell tool | RES-R23 (SHOULD, upgrades only) | partial → JG-06 | — | Seaplane private charter upsell [A] | all | P1 |
| T-C15 | Preference and request propagation to departments (pre-arrival task plan) | GR | PMS traces | GUE-R03 alerts with department audience; OPS-R11 tasks — no arrival preparation plan | partial → JG-14 | — | — | all | P1 |
| T-C16 | **Dietary requirements and allergies reach the kitchen and every outlet, with acknowledgement** | GR, FB | PMS, POS, kitchen | GUE-R02 (sensitive, alert text); no propagation/ack; POS lookup W-POS-02 lacks alerts | partial → JG-11 | POS/KDS (BOH) | Island resorts have limited emergency medical capacity [DK] | all | P0 |
| T-C17 | Amenity orders and VIP setups (welcome fruit, wine, decoration) with cost routing (house/guest/TO) | GR, HK, FB | Paper, PMS traces | — | MISSING → JG-14 | Stock (BOH) | Honeymoon bed decoration routine [DK] | R G H | P1 |
| T-C18 | Butler/host assignment and introduction | GR | Rosters, WhatsApp | — | MISSING → JG-15 | Workforce rosters (BOH) | Luxury resorts assign a butler per villa [DK] | R | P1 |
| T-C19 | Kids club pre-registration (guardian, authorized pick-up, allergies, age group) | SPA | Paper | RST-R07 kind `kids club` only | partial → JG-30 | — | Family resorts | R | P1 |
| T-C20 | Dive pre-booking: certification, last dive, medical statement, equipment sizes, nitrox | SPA | Dive-centre system | RST-R07 eligibility/waivers (generic) | partial → JG-31 | Dive-centre system (often a concession, BOH) | 30 m limit; licensed dive centres [V-web] | R G | P1 |
| T-C21 | Spa pre-booking | SPA | Spa system | RST-R07/R08; Book4Time integration P1 | specified | Spa system | Spa often a concession [R resort §11] | R H | P1 |
| T-C22 | Dining reservations made before arrival (special dinners, sandbank, private dining) | GR, FB | Paper, table system | RST-R09 (SHOULD) | partial → JG-19 | Table-reservation system (H) | Weather alternates | R H | P1 |
| T-C23 | Room/villa pre-assignment with preferences and lock | FD | PMS | INV-R20, INV-R22 | specified | — | Villa side/sunset preferences | all | P0 |
| T-C24 | Arrival readiness (room, payment, requests, transfer) | FD | PMS | RES-R35; personas §cross-persona 1 | specified | — | — | all | P0 |
| T-C25 | **Key packets prepared before seaplane arrival** (pre-encoded cards/wristbands, activation on check-in) | FD | Lock system | — | MISSING → JG-01 | Lock vendor | Check-in happens at the jetty/villa | R | P1 |
| T-C26 | Emergency contact, travel-insurance and next-of-kin details | G, FD | Registration card | Continuity snapshot needs "emergency contacts" (rollout §6) but no field exists in `guests` | MISSING → JG-33 | — | Medevac by seaplane/speedboat [DK] | all | P1 |
| T-C27 | Accessibility/mobility needs propagated (villa choice, buggy, manifest special assistance) | RV, TR | PMS notes | RST-R05 special assistance on manifests | partial → JG-33 | — | Long jetties, sand paths [DK] | all | P1 |
| T-C28 | Deposit/balance reminders, overdue → task or auto-cancel | FIN | PMS | RAT-R20, PAY-R22 | specified | — | Bank-transfer DMCs | all | P0 |
| T-C29 | TO rooming-list updates and name changes before arrival | RV | Email, PMS | GRP-R08 (re-import diff, groups only) | partial → JG-02 | TO (email/file) | Names arrive late for TO bookings [R guests §11] | R G | P1 |
| T-C30 | Pre-arrival lists: VIP, allergy, amenity, celebration, transfer, butler assignment | GR, FB, HK | Reports | ANL-R05 arrivals; no amenity/allergy lists | partial → JG-11, JG-14 | — | — | R H | P1 |
| T-C31 | Guest sees request status truthfully (requested / confirmed / declined) | G | Portal | — | MISSING → JG-03 | — | — | all | P1 |
| T-C32 | Long-stay agreement e-signature, house rules, security deposit | G, FD | Paper/e-sign | — | MISSING → JG-54 | E-sign (built-in) | — | A | P2 (A: P1) |
| T-C33 | Self check-in instructions, PIN codes, lockbox for late arrivals | OWN, G | WhatsApp | — | MISSING → JG-60 | Keypad/smart-lock vendor | Late ferry/speedboat arrivals at guesthouses [A] | G A H | P1 |

### Stage D — Arrival

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-D01 | Airport meet and greet (representative, arrivals board by flight, lounge allocation) | TR | Spreadsheets, radio | — | MISSING → JG-28 | Airport lounge/handling agents | Resort counters/lounges at Velana [DK] | R | P1 |
| T-D02 | Flight-status tracking (delays) | TR | Airline sites | RES-R39 ETA (manual) | partial → JG-28 | Flight-data provider (paid, Q85) | — | R G | P2 |
| T-D03 | Transfer manifests and seaplane lounge | TR | Transfer desk | RST-R05 | specified | Operators | — | R | P1 |
| T-D04 | Speedboat/ferry arrivals for guesthouses (jetty pick-up) | OWN | WhatsApp | RST-R04 (`resort.transfers` add-on) | specified | Ferry/speedboat operators | Public ferry schedules | G | P1 |
| T-D05 | Departed-Malé / ETA-at-jetty notification to the island | TR, FD | Radio, WhatsApp | RST transfer status → itinerary (RST-R06) | specified | — | — | R | P1 |
| T-D06 | Jetty or in-villa check-in on a tablet (assisted mode) | FD, GR | Tablet | RES-R24 (touch-usable), §11 | specified | — | Check-in at the jetty/villa | R | P0 |
| T-D07 | Registration card completion and signature | FD, G | Paper/tablet | RES-R24 `registration` (e-sign SHOULD) | partial → JG-04 | — | — | all | P0 |
| T-D08 | Passport/ID scan at the desk (scanner, OCR) | FD | Scanner | GUE-R05 storage; capture flow — | partial → JG-04 | Document scanners (BOH IT) | Q43 | all | P1 |
| T-D09 | Incidental authorization / cash deposit | FD | PSP, cashier | PAY-R09/R22, FIN-R37 | specified | Acquirer | Cash USD/MVR | all | P0 |
| T-D10 | **Charge privileges and credit limit set at check-in** (allowed / cash only / no post; limit tied to authorization) | FD | PMS, POS | RST-R01 "room-charge permission and credit status" — no model | partial → JG-09 | POS (BOH) | All-inclusive vs room-only guests charge differently | R H | P0 |
| T-D11 | **Key issue: RFID cards** | FD | Lock system, encoder | RES-R24 `access` step ("via integration or manual key log") — no module | MISSING → JG-01 | Lock vendor, local connector | Lock usage unconfirmed (Q64) | R H A M | P0 (manual log) |
| T-D12 | Key issue: RFID wristbands (waterproof) | FD | Lock system | — | MISSING → JG-01 | Lock vendor | Beach/water villas [A] | R | P2 |
| T-D13 | Mobile keys / wallet keys | G | Guest app, lock cloud | — (Mews Digital Key in research 02) | MISSING → JG-01 | Lock vendor credential service, Apple/Google wallets | Phone connectivity varies; BLE works offline [DK] | H A M | P2 (H/A: P1) |
| T-D14 | Mechanical keys register (key numbers, issued/returned, lost-key charge) | OWN | Key board | — | MISSING → JG-01 | — | Guesthouses usually mechanical [A, coverage matrix §4] | G | P0 |
| T-D15 | PIN/keypad codes (self check-in) | OWN, G | Smart-lock app | — | MISSING → JG-01 | Smart-lock vendor | — | G A H | P1 |
| T-D16 | Common-area access by entitlement (club lounge, gym, adults-only pool, spa) | FD | Lock system | — | MISSING → JG-01 | Lock vendor | — | R H | P2 |
| T-D17 | Wi-Fi credentials (per stay or per unit) and tiers | FD, G | Wi-Fi gateway | — | MISSING → JG-26 | Wi-Fi gateway (FIAS-style) | Villa-specific networks common [DK] | all | P1 (display) / P2 (gateway) |
| T-D18 | Luggage tagging, bell desk, delivery to villa | Bell, TR | Paper, radio | — | MISSING → JG-22 | — | Seaplane baggage arrives separately [DK] | R H | P1 |
| T-D19 | Buggy dispatch | Driver | Radio | — | MISSING → JG-23 | — | Long jetties | R | P2 |
| T-D20 | Villa orientation by host (checklist) | GR | Paper | — | MISSING → JG-15 | — | — | R | P2 |
| T-D21 | Welcome amenity delivered, first-impression notes | GR | Paper | — | MISSING → JG-14 | — | — | R H | P2 |
| T-D22 | Early check-in approval and priority clean | FD, HK | PMS | RES-R18, OPS-R06 | specified | — | Morning international arrivals | all | P0 |
| T-D23 | Day room / hospitality room / shower before the room is ready | FD | PMS | INV-R30 (LATER) | planned → JG-35 | — | Red-eye arrivals [A] | R H | P2 |
| T-D24 | Waiting guests (arrived, unit not ready) | FD | PMS | RES-R35 | specified | — | — | all | P0 |
| T-D25 | Room fails inspection as guest arrives | FD, HK | PMS | OPS-R09, S07 | specified | — | — | all | P0 |
| T-D26 | Walk-ins | FD | PMS | RES-R22 | specified | — | — | G H | P1 |
| T-D27 | Relocation on arrival (overbooked / OOO) | FD | PMS | RES-R34 | specified | — | Sister island relocation | all | P1 |
| T-D28 | Deposit applied to folio at check-in | FD | PMS | FIN-R23 | specified | — | — | all | P0 |
| T-D29 | Phone extension opened, guest name and language on PBX | FD | PBX | — | MISSING → JG-25 | PBX vendor, local connector | Villa phones used to call butlers [DK] | R H | P2 |
| T-D30 | Kiosk self check-in (find booking, ID, pay, key) | G | Kiosk | — | MISSING → JG-05 | Card terminal, encoder | — | H A | P2 (H/A: P1) |
| T-D31 | TO voucher verification at arrival (meal plan, room type, offers as contracted) | FD | Voucher, PMS | — | MISSING → JG-02 | — | Mismatched vouchers are common [A] | R G | P0 |
| T-D32 | **Occupant ages verified for tax** (Green Tax under-2 exemption; child bands) | FD | PMS | RES-R02 age at arrival, RES-R19 — no verification step | partial → JG-12 | — | Under-2 exempt; comp stays taxable [R] | all | P0 |
| T-D33 | **Nationality and document country captured per guest** (TIMS arrivals by nationality; guest register) | FD | PMS | ANL-R02 guest-nights by nationality; Q43 | partial → JG-13 | — | TIMS weekly/monthly [R] | all | P0 |
| T-D34 | Emergency contact and allergy confirmation at check-in | FD | Registration card | — | MISSING → JG-33 | — | — | all | P1 |
| T-D35 | Long-stay check-in condition report (photos, inventory list) | FD, HK | Paper | — | MISSING → JG-54 | — | — | A | P2 (A: P1) |

### Stage E — In-stay

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-E01 | Guest requests (housekeeping, maintenance, amenities) by desk/phone/chat | GR, HK, ENG | PMS, radio | OPS-R13, COM-R04 | specified | — | — | all | P0 |
| T-E02 | Requests made in the guest portal with truthful status | G | Portal | — | MISSING → JG-03 | — | — | all | P1 |
| T-E03 | In-villa dining order (phone → POS) | FB | POS | RST-R01 posting (POS = BOH) | integration-only | POS (BOH) | 24 h in-villa dining at resorts [DK] | R H | P1 |
| T-E04 | In-villa dining ordered digitally (portal menu → POS check) | G | Portal, POS | — | MISSING → JG-03 | POS order API (BOH) | — | R H | P2 |
| T-E05 | Restaurant table reservations (slots, covers, meal-plan aware, walk-ins, no-shows) | FB, GR | Paper, table system | RST-R09 (SHOULD) | partial → JG-19 | Table-reservation system (H) | Theme nights; dine-around | R H | P1 |
| T-E06 | Meal-plan entitlements and dine-around across outlets | FB | POS, PMS | RST-R03 | specified | POS (BOH) | HB/FB/AI tiers | R | P0 |
| T-E07 | Special dining (sandbank dinner, private chef) with resources and weather alternates | GR, FB | Paper | RST-R07 sessions; RST-R12 weather | partial → JG-19 | — | Sandbank dinners [DK] | R | P1 |
| T-E08 | Bar tabs and outlet charges to the villa | FB | POS | RST-R01/R02 | specified | POS (BOH) | — | R H | P0 |
| T-E09 | **Charge-to-room validation** (posting privileges, credit limit, no-post flag, all-inclusive coverage) | FB | POS, PMS | RST-R01 lookup (credit status undefined) | partial → JG-09 | POS (BOH) | — | R H | P0 |
| T-E10 | Guest signature on charge slips | FB | POS, app | RST-R02 | specified | — | — | R H | P1 |
| T-E11 | Minibar consumption posting | HK | Paper, PMS | OPS-R08 (SHOULD) | partial → JG-20 | Minibar sensors (P2) | Often included in AI tiers | R H | P1 |
| T-E12 | Minibar audits, refills, late detection after departure, disputes | HK, FIN | Paper | — | MISSING → JG-20 | Stock (BOH) | — | R H | P1 |
| T-E13 | Laundry and valet orders (price list, express, damage claims) | HK | Paper | OPS non-goal "linen LATER" (house linen) | MISSING → JG-21 | Laundry (often outsourced, BOH) | — | R H A | P1 |
| T-E14 | Spa bookings and charges | SPA | Spa system | RST-R07/R08; integration Book4Time | specified | Spa system | Concession spas | R H | P1 |
| T-E15 | Excursions (sandbank, snorkel, fishing, local island) with capacity and weather | SPA, OWN | Paper | RST-R07, RST-R12 | specified | Boat operators | Sold by guesthouses too | R G | P1 |
| T-E16 | Diving: certification check, waivers, equipment, depth limits, dive logs | SPA | Dive system | RST-R07 (generic eligibility) | partial → JG-31 | Dive-centre system (BOH concession) | 30 m limit [V-web] | R G | P1 |
| T-E17 | Equipment loans (snorkel gear, bikes, towel cards, umbrellas) with deposits | SPA, HK | Paper | — | MISSING → JG-32 | — | — | R | P2 |
| T-E18 | Kids club attendance (sign-in/out, authorized pick-up) | SPA | Paper | RST-R07 kind only | partial → JG-30 | — | — | R | P1 |
| T-E19 | Inter-island transfers (excursions, sister-property visits) | TR | Transfer desk | RST-R04 legs | specified | Operators | — | R M | P1 |
| T-E20 | Concierge third-party bookings (tours, Malé restaurants, car hire) with commissions | GR | Paper | — | MISSING → JG-24 | Suppliers | Malé city tours for transit guests [A] | R H | P2 |
| T-E21 | Call accounting / telephony charges | — | PBX | — | MISSING → JG-25 (integration-only) | PBX, local connector | — | R H | P2 |
| T-E22 | Wake-up calls (manual or PBX-automated, unanswered → visit) | FD | PBX, paper | OPS-R14 (as guest commitment) | partial → JG-25 | PBX | Early seaplane departures | all | P1 |
| T-E23 | Wi-Fi tiers / premium internet charges | G | Wi-Fi gateway | — | MISSING → JG-26 | Wi-Fi gateway | — | R H | P2 |
| T-E24 | In-room entertainment / IPTV (welcome, folio view, express checkout) | G | IPTV | — | MISSING → JG-27 (integration-only) | IPTV vendor | — | R H | P2 |
| T-E25 | Room move (incl. key re-issue, old keys invalidated) | FD | PMS, locks | RES-R17 (keys not covered) | partial → JG-01 | Lock vendor | — | all | P0 |
| T-E26 | Extension (key validity, transfer rebooking) | FD | PMS, locks | RES-R15; key validity — | partial → JG-01, JG-29 | Lock vendor | Seaplane rebooking | all | P0 |
| T-E27 | Early departure / shortened stay | FD | PMS | RES-R16 | specified | — | — | all | P1 |
| T-E28 | Mid-stay courtesy contact / pulse check | GR | Paper | OPS-R14 tasks (generic) | partial → JG-15, JG-39 | — | — | R H | P2 |
| T-E29 | Complaints logged, routed and resolved | GR, GM | Email, paper | Conversations + tasks (COM-R04) | partial → JG-16 | — | — | all | P1 |
| T-E30 | Service recovery (compensation within approval limits, follow-up, history) | GR, GM | PMS adjustments | FIN-R10 adjustments; GUE-R14 "service recovery items" (no case model) | partial → JG-16 | — | — | all | P1 |
| T-E31 | Incident and security log (theft, injury, damage, disturbance, police reference) | SEC, GM | Paper log | — | MISSING → JG-17 | Police/insurers | Remote islands, police on request [DK] | all | P1 |
| T-E32 | Medical clinic visits, clinic charges, medevac coordination | Doctor, GM | Clinic records | — | MISSING → JG-18 | Clinic (often concession, BOH), medevac providers | Decompression chambers are limited [DK] | R | P1 |
| T-E33 | Damage, smoking and lost-key charges with evidence | FD, HK | PMS | FIN-R09 manual charge (no evidence link) | partial → JG-17 | — | — | all | P1 |
| T-E34 | Lost and found | HK | Log | OPS-R20 | specified | — | — | all | P1 |
| T-E35 | Turndown | HK | HK app | OPS-R05 | specified | — | Resort default | R H | P1 |
| T-E36 | DND / make-up-room (incl. in-room sensors) | HK | HK app, GRMS | OPS-R03; GRMS integration — | partial → JG-27 | GRMS vendor | — | all | P1 |
| T-E37 | Housekeeping preferences (service time, green option) | G, HK | Notes | OPS-R05 policy | partial → JG-03 | — | — | all | P2 |
| T-E38 | Celebrations in stay (cake, decoration, photo shoot) | GR, FB | Paper | — | MISSING → JG-14 | — | — | R H G | P1 |
| T-E39 | Currency exchange at the desk | FD | Cashier | FIN-R37, FIN-R40 | specified | — | MVR/USD; licensing for money-changing unverified [DK] | R G | P1 |
| T-E40 | Retail/boutique purchases | FB | POS/outlet app | RST-R01/R02 | specified | POS (BOH) | — | R H | P1 |
| T-E41 | Photography (often concession) | Vendor | Vendor POS | Outlet posting RST-R02 / concessions (BOH) | integration-only | Concession (BOH) | — | R | P2 |
| T-E42 | **Guest locator** (in villa, at spa, on excursion, off island) | FD, SEC | Radio | — | MISSING → JG-10 | — | Excursions take guests off island [DK] | R | P1 |
| T-E43 | **Emergency muster list / continuity snapshot** (occupants incl. children, special assistance, off-property) | SEC, GM | Printouts | Continuity snapshot (rollout §6, RO-09) — no muster workflow | partial → JG-10 | — | Tsunami/fire/medical evacuation from islands [DK] | all | P0 |
| T-E44 | Weather disruption handling | GM, SPA | Radio | RST-R12/R13 | specified | — | Monsoon | R G | P1 |
| T-E45 | Transfer delay ripple (S12) | TR | — | RST-R06 | specified | — | — | R | P1 |
| T-E46 | Itinerary visible to the guest | G | Portal | RST-R11 (SHOULD) | partial → JG-03 | — | — | R | P1 |
| T-E47 | Allowance and entitlement balances visible to the guest | G | Portal | FIN-R21 (LATER), RST-R11 | planned → JG-03 | — | AI tiers / dining credits | R | P2 |
| T-E48 | Digital folio during the stay (live, pending items labelled) | G | Portal | — | MISSING → JG-03 | — | — | all | P1 |
| T-E49 | Guest chat with department ownership | GR | WhatsApp, inbox | COM-R01–R04 | specified | WhatsApp | — | all | P0 |
| T-E50 | Translation with original preserved | GR | Inbox | COM-R02 | specified | Translation provider | zh/ru/it/de | all | P1 |
| T-E51 | Visitors and day guests (visitor log, day passes) | SEC, FD | Paper | — | MISSING → JG-56 | — | Visitors arriving by boat [DK] | R H | P2 |
| T-E52 | Parking and valet | Valet | Ticket system | — | MISSING → JG-55 | Parking system | Rare in the Maldives | H A | P2 (H: P1) |
| T-E53 | Parcels and mail | FD | Logbook | — | MISSING → JG-54 | — | — | A H | P2 (A: P1) |
| T-E54 | Long-stay recurring billing and utilities recharge | FIN | PMS, meters | — | MISSING → JG-54 | Utility meters (BOH) | — | A | P2 (A: P1) |
| T-E55 | Long-stay cleaning plans (every *n* days, linen change) | HK | HK app | OPS-R05 | specified | — | — | A | P2 |
| T-E56 | In-stay feedback (QR pulse survey) | G | Survey | — | MISSING → JG-39 | — | — | all | P2 |
| T-E57 | Night-time emergency at a guesthouse (guest reaches owner; emergency numbers) | G, OWN | Phone | — | MISSING → JG-03, JG-10 | — | Owner not on site at night [A] | G A | P1 |
| T-E58 | Dine-around/visits at sister properties with inter-property settlement | FB, FIN | POS | RST-R03 (LATER) | planned → JG-52 | — | Multi-island groups | M | P2 |
| T-E59 | In-stay upsells (spa offers, late checkout offers, experiences) | GR, auto | Messaging | — | MISSING → JG-06 | — | — | all | P1 |

### Stage F — Departure

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-F01 | Departure transfer timed to the international flight (seaplane daylight → wait in lounge or Malé) | TR | Transfer desk | RST-R04; RES-R39 — no flight-based scheduling | partial → JG-29 | Operators | Seaplane slots allocated the day before [V-web secondary] | R | P1 |
| T-F02 | Late checkout request and approval | FD | PMS | RES-R18 | specified | — | — | all | P0 |
| T-F03 | Departure lounge / day room / showers after checkout | FD | PMS | — | MISSING → JG-35 | — | Night flights after daylight seaplane [DK] | R H | P2 |
| T-F04 | **Green Tax check-out block** (≥ 12 h in the last 24-hour block counts) affected by late checkout and day use | FIN | PMS | maldives-tax-rules §5 [R]; RAT §11 still per person-night | partial → JG-12 | — | Q20 item 1 (day use) | all (MV) | P0 |
| T-F05 | Express checkout (portal, TV, kiosk) | G | Portal | — | MISSING → JG-03 | — | — | all | P1 |
| T-F06 | Guest queries/disputes a folio item before paying | G, FD | PMS | FIN-R10 adjustments (staff) — no guest-raised dispute | partial → JG-58 | — | — | all | P1 |
| T-F07 | Settlement and split tenders (card, cash USD/MVR, company/agency AR) | FD | PMS, PSP | FIN-R26, PAY | specified | Acquirer | — | all | P0 |
| T-F08 | **Tax invoice within 3 days of completing the service**, with deadline monitoring | FIN | PMS | FIN-R32–R35 (no deadline monitor) | partial → JG-08 | — | MIRA [R] | all (MV) | P0 |
| T-F09 | **Invoice / e-folio delivery** (email, portal download, print) | FD, auto | PMS | FIN-R33 rendering; delivery — | partial → JG-08 | Email provider | — | all | P0 |
| T-F10 | Buyer company name and TIN on the invoice (B2B guests, DMCs) | G, FD | PMS | FIN-R33 payer data; capture — | partial → JG-03 | — | MIRA buyer TIN where applicable [R] | all | P1 |
| T-F11 | **Key deactivation/collection at checkout** (offline locks only expire; collect cards; mobile keys revoked) | FD | Lock system | RES-R27 `access` step only | MISSING → JG-01 | Lock vendor | — | R H A M | P0 |
| T-F12 | Luggage collection, left-luggage storage with claim ticket | Bell | Paper | — | MISSING → JG-22 | — | Bags travel ahead on seaplane [DK] | R H | P1 |
| T-F13 | Final minibar check before checkout | HK | Phone | — | MISSING → JG-20 | — | — | R H | P1 |
| T-F14 | Pending outlet charges warning | FD | PMS | RES-R27 `charges` step | specified | POS (BOH) | — | all | P0 |
| T-F15 | Deposit / authorization release | FD | PSP | PAY-R09 release | specified | Acquirer | — | all | P0 |
| T-F16 | Gratuities (staff fund; tips outside GST base) | FD, FIN | PMS | Brief §9 mention; no charge-code group | partial → JG-47 | Payroll distribution (BOH) | Tips outside GST base [R] | all | P1 |
| T-F17 | Service-charge distribution evidence | FIN | Payroll | — | BOH (reference) | Payroll (BOH) | ≥ 10% distributed to staff [R] | all (MV) | P1 |
| T-F18 | Checkout with balance to company/agency receivables | FD, FIN | PMS | FIN-R26/R27 | specified | — | DMC net invoicing | all | P0 |
| T-F19 | Departure manifests and seaplane baggage | TR | Transfer desk | RST-R05 | specified | Operators | — | R | P1 |
| T-F20 | Farewell experience (amenity, photo, survey invite) | GR | Paper | — | MISSING → JG-14, JG-39 | — | — | R H | P2 |
| T-F21 | Early-departure penalty | FD | PMS | RES-R16 | specified | — | — | all | P1 |
| T-F22 | Departure survey trigger | auto | Survey | — | MISSING → JG-39 | — | — | all | P1 |
| T-F23 | Outbound transit night in Malé before a morning flight | TR | PMS | RES §11 note | partial → JG-29 | Transit hotels | — | R | P1 |

### Stage G — Post-stay and follow-up

| ID | Touchpoint | Who | Systems | Portico coverage | Status | Ext. dependency | Maldives | Applies | Pri |
|---|---|---|---|---|---|---|---|---|---|
| T-G01 | Thank-you message | auto | Messaging | COM-R06 (generic automation) | specified | Email/WhatsApp | — | all | P1 |
| T-G02 | Post-stay survey and NPS (low score → owner) | GR, GM | Survey tool | — | MISSING → JG-39 | — | — | all | P1 |
| T-G03 | Review solicitation (direct/agency guests; OTAs invite their own) | auto | Review platforms | — | MISSING → JG-41 | TripAdvisor, Google | — | all | P1 |
| T-G04 | Review aggregation, sentiment and **replies** (OTA, Google, TripAdvisor) | GM, GR, OWN | Extranets | DST-R18 reviews (LATER); comms non-goal | planned → JG-40 | Hub reviews add-on (+$7/property, readiness §5), Google Business Profile | OTA scores drive guesthouse demand [A] | all | P1 |
| T-G05 | Complaint follow-up after departure | GM | Email | — | MISSING → JG-16 | — | — | all | P1 |
| T-G06 | Lost-and-found shipping (courier, guest pays, customs declaration) | HK, FD | Courier | OPS-R20 `shipped` status only | partial → JG-53 | Couriers | International shipping from Malé [DK] | all | P2 |
| T-G07 | Late charges after departure | FIN | PMS | FIN-R25, S10 | specified | — | — | all | P0 |
| T-G08 | Company/agency invoicing, statements, collections | FIN | PMS, ERP | FIN-R27–R30 | specified | ERP (BOH) | DMC bank transfers | all | P0 |
| T-G09 | Tour-operator statements and remittance reconciliation | FIN | Spreadsheets | FIN-R28 allocations (no TO statement) | partial → JG-02 | TO remittances | Monthly TO settlements [A] | R G M | P1 |
| T-G10 | Travel-agent/TO **commission processing** (accrual, statements, payment runs, no-show rules) | FIN | AP | FIN-R31 (SHOULD, accrual only) | partial → JG-46 | Bank / AP (BOH) | — | all | P1 |
| T-G11 | OTA commission invoice reconciliation | FIN | AP | — | BOH (reference) → JG-61 | OTAs | — | all | P2 |
| T-G12 | Chargebacks and disputes after stay | FIN | PSP | PAY-R18 | specified | Acquirer | — | all | P1 |
| T-G13 | Loyalty and recognition (tiers, benefits, stay counts) | MKT | CRM | GUE-R15 recognition; loyalty LATER | partial → JG-44 | — | — | H M | P2 |
| T-G14 | Remarketing and re-booking offers (consent-gated) | MKT | CRM/email | — (comms non-goal: campaigns) | MISSING → JG-42 | Email/WhatsApp | WhatsApp marketing templates are charged [V-web] | all | P2 |
| T-G15 | Birthday/anniversary campaigns | MKT | CRM | GUE-R01 dates | MISSING → JG-42 | — | Anniversary returns are a resort pattern [A] | R H | P2 |
| T-G16 | Guest data access/erasure requests | FIN, IT | — | GUE-R17/R18 | specified | — | — | all | P1 |
| T-G17 | Data retention (ID documents, messages, incidents) | IT | — | GUE-R19 (Q44) | specified | — | Fiscal ≥ 5 years after year-end [R] | all | P1 |
| T-G18 | Guest history and preferences updated for the next stay | GR | PMS | GUE-R14 | specified | — | — | all | P1 |
| T-G19 | Statistics and tax returns (TIMS nationality, Green Tax MIRA 501, TGST) | FIN | Reports | ANL-R02, FIN-R42 | specified | Government portals (hotel files) | [R] | all (MV) | P0 |
| T-G20 | Post-stay portal (invoice download, lost item claim, rebook) | G | Portal | — | MISSING → JG-03 | — | — | all | P2 |
| T-G21 | Referral, gift-voucher purchase after stay | MKT | — | — | MISSING → JG-45 | — | — | H M | P2 |
| T-G22 | Recognition of a repeat guest at another group property | FD | PMS | GUE-R16 | specified | — | — | M | P1 |

---

## 4. Coverage summary

Counts are touchpoints in §3 (one row per touchpoint).

| Stage | Touchpoints | specified | partial | planned | MISSING | integration-only / BOH |
|---|---|---|---|---|---|---|
| A Discover and decide | 38 | 11 | 8 | 6 | 13 | 0 |
| B Book | 25 | 15 | 6 | 0 | 4 | 0 |
| C Pre-arrival | 33 | 8 | 14 | 0 | 11 | 0 |
| D Arrival | 35 | 11 | 6 | 1 | 17 | 0 |
| E In-stay | 59 | 17 | 17 | 2 | 21 | 2 |
| F Departure | 23 | 7 | 8 | 0 | 7 | 1 |
| G Post-stay | 22 | 9 | 4 | 1 | 7 | 1 |
| **Total** | **235** | **78 (33%)** | **63 (27%)** | **10 (4%)** | **80 (34%)** | **4 (2%)** |

(MISSING rows whose intended answer is "integrate" — T-A09, T-E21, T-E24 — are counted as MISSING because no
workflow is defined for them yet.)

Reading the numbers honestly:

- **Nothing in the guest journey is built.** "Specified" means a reviewed design exists at R1.
- The existing specs are strong where the owner's brief was explicit (reservations, finance, payments, operations,
  distribution, transfers/activities). The misses cluster in four places: **access** (keys, Wi-Fi, PBX), **the
  guest's own surface** (portal, online check-in, kiosk, upsells, e-folio), **commercial contracting** for tour
  operators, and **service delivery around the stay** (amenities, butlers, dining reservations, minibar, laundry,
  luggage, incidents, muster), plus everything **after** the stay (surveys, reviews, marketing, loyalty, vouchers).
- Seven Maldives-specific obligations or realities had no home: visa-on-arrival booking confirmation, IMUGA
  guidance, seaplane cut-off and transit nights, the Green Tax 12-hour check-out block, the 3-day invoice deadline,
  TIMS nationality capture, and diving limits.

## 5. Maintenance

Owner: product (guest journey). Update a row when a spec change lands (status `specified`) and when the readiness
register moves its capability to R2+ (status `built` only at R3 with evidence). Never delete a row; mark retired
touchpoints with ~~strikethrough~~. New touchpoints get the next free id in their stage.
