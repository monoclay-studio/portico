# Channel capability matrix

Deliverable 3 of the operational-readiness brief (§4–§6). Owner: Operational Readiness lead with the distribution
engineer. Last updated: 2026-11-07. Labels as defined in `dependency-register.md` ("How to read this register").

**Important:** a channel listed by an intermediary does not necessarily support every capability (readiness brief §4).
This matrix separates **direct** connections (Portico is the connectivity provider) from connections **via Channex**.
Nothing in this file is "supported by Portico": every Portico capability is **R1 Planned**. The cells describe what the
*provider* is documented to offer, so we know what we can build toward.

Cell values:

| Value | Meaning |
|---|---|
| **Supported** | Provider documentation (cited) shows the capability exists for connectivity partners. |
| **Limited** | Exists with documented restrictions (noted). |
| **Unsupported** | Documented as not available on that route. |
| **Unverified** | Not established from documentation we could read. Treat as unavailable for planning. |
| **N/A** | Not applicable to that route. |

Why so many "Unverified": direct page fetches to `channex.io`, `docs.channex.io` and `developers.booking.com` were
blocked in the research sessions, and this session's search budget was exhausted. Each "Unverified" cell maps to a
question in §6.

---

## 1. Channex planning baseline (readiness brief §5, verbatim as dated)

Use the following published pricing only as a dated planning baseline, **checked on 7 November 2026**, and verify it
again before purchasing:

* Platform fee: $130/month.
* Hotel channel manager: $7/month per property with an active channel.
* Optional hotel messaging and reviews: another $7/property/month.
* VAT, applicable extras, and overages are additional.
* Free staging is available for development.
* Production requires integration testing, certification, and OTA account authorization.

This implies **$137/month for the base platform and one connected hotel**, excluding extras and our own infrastructure.
Do not assume the platform fee disappears merely because no properties are connected after production subscription
activation. Certification must validate real PMS workflows; standalone scripts that demonstrate API requests do not prove
that the product works. Confirm current certification steps, commercial terms, size limits, optional fees, and
production billing start directly from official documentation or the provider.

Additional detail read on 7 Nov 2026 by research report 04: volume pricing $6/property at 500+, $5 at 1,000+, $4 at
2,000+; vacation rentals $0.50/unit; only properties with at least one active channel are billed; no commission, no
setup fee; Chat & Reviews add-on $7/hotel; prices exclude VAT `[verified 2026-11-07]` ([pricing](https://channex.io/pricing.md)).
This session could not re-fetch channex.io (network policy).

---

## 2. What Channex covers versus what remains ours

| Obligation | Covered by Channex? | Remains with Monoclay / hotel |
|---|---|---|
| OTA connectivity certifications (Booking.com, Airbnb, etc.) | Channex holds its own OTA partnerships `[unconfirmed per OTA]` | Monoclay must pass **Channex's** PMS certification `[verified 2026-11-07]`. |
| PCI handling of OTA card data | Channex PCI tokenises and logs card views; card data only to certified partners `[verified 2026-11-07]` | Monoclay must obtain certified-partner status; Monoclay's own PCI service-provider obligations remain (certification matrix). |
| Mapping UI | White-label UI available `[verified 2026-11-07]` ([channex.io](https://channex.io/)) | Portico must validate mapping completeness before activation (readiness brief §6). |
| Reservation delivery | Booking revisions feed with explicit acknowledgement `[verified 2026-11-07]` ([bookings](https://docs.channex.io/api-v.1-documentation/bookings-collection)) | Idempotent ingestion keyed by (channel, booking id, revision); acknowledge only after commit. |
| Hotel's OTA contracts and commissions | No | Hotel. |
| Hotel authorization of the connection in each extranet | No | Hotel (guided by Portico onboarding). |
| Overbooking resolution | No | Hotel staff with Portico workflows (relocation, discrepancy queue). |
| Data protection terms | Channex as sub-processor `[assumption — DPA required]` | Monoclay DPA with hotels lists Channex. |

---

## 3. Matrix — via Channex

Channex-level facts apply to all channels; per-channel depth is **Unverified** unless stated. "Channel supports X"
on the direct matrix (§4) does **not** imply Channex passes X through.

| Capability (brief §4) | Booking.com via Channex | Expedia via Channex | Airbnb via Channex | Agoda via Channex | Trip.com via Channex | Hotelbeds / bedbanks via Channex | Google via Channex |
|---|---|---|---|---|---|---|---|
| Availability, rates, restrictions | Supported at hub level (ARI is the core product) `[verified 2026-11-07]`; restriction set per channel Unverified | Unverified (Channex Expedia certification status open — R04) | Unverified | Unverified | Unverified | Unverified | Unverified (Portico plans a direct Google connection) |
| Reservations, modifications, cancellations | Supported at hub level (revisions feed + ack) `[verified 2026-11-07]` | Unverified | Unverified | Unverified | Unverified | Unverified | N/A (bookings happen on our booking engine) |
| Room & rate-plan mapping | Supported (white-label mapping UI) `[verified 2026-11-07]` | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Occupancy & child pricing | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Promotions & derived rates | Unverified (derived rates likely computed in Portico and sent as plain rates `[assumption]`) | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Taxes, fees, meal plans, packages | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Content & photos | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |
| Guest messages & reviews | Limited — paid add-on exists (+$7/property) `[owner baseline 2026-11-07]`; which channels Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| Payment information & virtual cards | Supported at hub level via Channex PCI (tokenised iframe, certified partners only) `[verified 2026-11-07]`; Booking.com test accounts referenced `[verified 2026-11-07]` | Unverified | Airbnb test accounts referenced in Channex PCI docs `[verified 2026-11-07]`; payment data scope Unverified | Unverified | Unverified | Unverified | N/A |
| Reservation recovery & reconciliation | Supported at hub level — unacknowledged revisions retrievable `[verified 2026-11-07]`; full-window resync Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | N/A |
| Property onboarding & disconnection | Supported at hub level (white-label UI) `[verified 2026-11-07]`; disconnection steps Unverified | Unverified | Unverified | Unverified | Unverified | Unverified | Unverified |

---

## 4. Matrix — direct connections (Portico as connectivity provider)

All direct routes are **later** (owner decision D7: hub first), except Google, which research recommends building
directly because it depends on our own price computation (R04 §A5).

| Capability | Booking.com direct | Expedia direct | Airbnb direct | Agoda direct (YCS) | Trip.com direct | Hotelbeds direct | GDS (via CRS/switch) | Google Hotel Center direct |
|---|---|---|---|---|---|---|---|---|
| Access / eligibility | Limited — partner acceptance + "specific onboarding requirements", PCI & PII compliance expected `[verified 2026-11-07]` | Limited — Connectivity Partner Program `[verified 2026-11-07]` | **Unsupported** — not accepting new API access requests `[secondary, read 2026-11-07]` | Limited — YCS API for channel-manager partners `[verified 2026-11-07]` | **Unverified** — no public direct program found `[secondary, read 2026-11-07]` | Unverified | Requires CRS/switch partner `[unconfirmed]` | Supported — open to connectivity partners `[verified 2026-11-07]` |
| Availability, rates, restrictions | Supported — OTA XML / B.XML R&A endpoints `[verified 2026-11-07]` | Supported — EQC AR XML `[unconfirmed]` | Unsupported | Supported — rates, availability, inventory `[verified 2026-11-07]` | Unverified | Unverified | Unverified | Supported — ARI or Pull `[verified 2026-11-07]` |
| Reservations, modifications, cancellations | Supported — Reservations API `[verified 2026-11-07]` | Supported — webhook + GraphQL fetch; Booking Retrieval in maintenance; Booking Notification closed to new adopters `[verified 2026-11-07]` | Unsupported | Supported — booking list/details `[verified 2026-11-07]`; must cover full window `[secondary, read 2026-11-07]` | Unverified | Unverified | Unverified | N/A (booking on Portico booking engine) |
| Room & rate-plan mapping | Supported — Content API product/rate-plan creation `[verified 2026-11-07]` | Supported — product APIs `[unconfirmed]` | Unsupported | Supported — product retrieval + hotel supplies IDs `[verified 2026-11-07]` | Unverified | Unverified | Unverified | Supported — property/room data in Hotel Center `[unconfirmed]` |
| Occupancy & child pricing | Unverified (occupancy-based pricing believed available `[unconfirmed]`) | Unverified | Unsupported | Unverified | Unverified | Unverified | Unverified | Unverified |
| Promotions & derived rates | Unverified (promotions API believed to exist `[unconfirmed]`) | Unverified | Unsupported | Unverified | Unverified | Unverified | Unverified | Unverified |
| Taxes, fees, meal plans, packages | Unverified | Unverified | Unsupported | Unverified | Unverified | Unverified | Unverified | Limited — price accuracy "Excellent" required, so taxes/fees must match landing page `[verified 2026-11-07]` |
| Content & photos | Supported — Content API; legacy content endpoints sunset 31 Dec 2026 `[verified 2026-11-07]` | Supported — image/property APIs `[unconfirmed]` | Unsupported | Unverified | Unverified | Unverified | Unverified | Unverified |
| Guest messages & reviews | Supported — Messaging API `[verified 2026-11-07]`; reviews Unverified | Unverified | Unsupported | Unverified | Unverified | Unverified | N/A | N/A |
| Payment information & virtual cards | Supported — Payments API; VCC activation rules conflict across sources `[secondary, read 2026-11-07]` | Limited — Expedia Collect VCC vs Hotel Collect card details `[unconfirmed]` | Unsupported | Unverified | Unverified | Unverified | Unverified | N/A |
| Reservation recovery & reconciliation | Unverified (retrieval semantics not read) | Supported — fetch by reservation ID after webhook `[verified 2026-11-07]` | Unsupported | Supported — booking list over window `[verified 2026-11-07]` | Unverified | Unverified | Unverified | N/A |
| Property onboarding & disconnection | Limited — live testing needs property consent; certification via Connectivity Support `[verified 2026-11-07]` | Supported — Autonomous Onboarding via connected providers `[secondary, read 2026-11-07]` | Unsupported | Supported — hotel enables channel-manager mode in YCS `[verified 2026-11-07]` | Unverified | Unverified | Unverified | Unverified |

---

## 5. Portico responsibilities regardless of route (readiness brief §6)

| Requirement | Portico design (planned, R1) |
|---|---|
| Clear ownership of availability, rates, restrictions | `distribution.connection.authority` per property: exactly one system is the ARI master; Portico refuses to publish when another master is declared. |
| Correct mapping before activation | Activation blocked until every sellable unit type/rate plan is mapped or explicitly excluded; preview of what each channel will receive. |
| Evidence that updates were accepted | Store downstream acknowledgement per ARI batch; "last acknowledged state" shown beside "Portico state". |
| Detect incomplete sync | Periodic full-window resync (e.g. nightly 365-day) and diff against last acknowledgement `[assumption — R04 recommendation]`. |
| Recoverable failures & staff alerts | Outbox retries with backoff; discrepancy queue with owner and next action; health panel (last success, pending updates, mapping problems). |
| Safe disconnection & provider replacement | Disconnection workflow: stop-sell or hand ARI authority to another system first; export mappings; adapter boundary. |
| Reconciliation after outages | Pull unacknowledged revisions; compare channel booking list over the full stay window where the channel supports it. |
| Delayed, duplicate, missing, out-of-order events | Immutable revision log keyed by (channel, external id, revision); out-of-order modify-before-create parked until create arrives or recovered via fetch. |
| Overbooking | Never promised to be impossible. Prevention (single ARI master, coalesced fast push), detection (inventory goes negative → alert), escalation (duty manager task), resolution (relocation workflow, brief §4). |
| Migration | No two systems control the same live inventory without an explicitly validated arrangement (see `migration-onboarding-checklist.md` §4). |
| Channel simulator | Built first: emits duplicates, reorderings, cancels of unknown bookings, late VCC data, 5xx/timeouts/rate limits (R04 §A9). A simulator result is **never** labelled as a working integration. |

---

## 6. Questions to settle the "Unverified" cells

**For Channex (written request):**

1. Provide the per-channel capability list (ARI fields incl. occupancy and child pricing, restrictions, derived/
   promotional rates, taxes and fees, meal plans, content/photos, messaging, reviews, payment/VCC data, cancellations,
   modifications, recovery) for Booking.com, Expedia, Airbnb, Agoda, Trip.com, Hotelbeds and any wholesalers/bedbanks
   relevant to the Maldives.
2. Is Channex certified/approved with Expedia Group, Agoda and Trip.com today? For which payment models (hotel collect,
   OTA collect / VCC)?
3. Which channels does the messaging & reviews add-on cover?
4. How do hotels authorize and revoke the Channex connection per OTA; what happens to bookings in flight on disconnection?
5. What recovery tools exist after an outage (full booking list by stay window, revision replay)?
6. Can Channex PCI forward card data to acquirers other than Stripe (e.g. a Maldivian bank gateway)?
7. Size limits (rooms, rate plans, date horizon), rate limits, and ARI update throughput.

**For OTAs (later, if going direct):** Booking.com acceptance of new connectivity partners and onboarding checklist;
Expedia ARI on GraphQL vs EQC; Agoda messaging/content scope; Trip.com direct program existence.

**For pilot candidates:** which channels produce the hotel's bookings today (incl. tour operators/wholesalers that send
email/extranet bookings) — this determines which cells must be verified first.
