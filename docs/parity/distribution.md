# Parity: distribution (channel manager, booking engine, metasearch, GDS via intermediaries)

Status: v1 · 2026-11-07 · Cluster `front` · Spec `docs/specs/distribution.md` (DST, wave 2) · Code on `main`: none, so
no row is `built`/`tested`. Decision D7 (hub first, e.g. Channex) shapes what Portico builds itself.

**Baseline.** OPERA Cloud 26.3 *Distribution Administration* (channel distribution, availability, offers, rate
plans, rate access, room types, connectivity messages, publication, channel/property controls, reservation code
mappings, content management), *Channel* (channel sell limits and inventory), *Exchange* (interface mapping,
message status, resync, monitoring) and the OPERA Cloud Distribution 26.3 user guide (availability, pricing,
channels, configuration, content). Modern rows from SiteMinder (help platform and pmsXchange), Mews Channel
Manager and Booking Engine APIs, Apaleo channel-integration guides, Cloudbeds (one inventory, Google free booking
links) and research 03/04 (Channex hub, Google ARI). Links opened (or found by web search where the vendor blocks
direct fetch) on 2026-11-07. Capability column uses Portico terms (channel, connection, mapping, ARI, discrepancy,
connection health, provisional hold).

## Capabilities

### 1. Connections, mapping and content

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-001 | Channel connections (via hub) with per-channel workflows and declared support levels | OPERA Distribution [Channel Configuration](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_channel_channel_configuration.htm) · Mews [Channel Manager API](https://docs.mews.com/channel-manager-api/readme.md) — verified 2026-11-07 | P0 | specified | DST-R01 | — |
| PAR-DST-002 | Map unit types × rate plans to channel room/rate codes with completeness counter and go-live block | OPERA [Channel Rate Mapping](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_channel_rate_mapping.htm) · [Channel Room Types](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_channel_room_types.htm) — verified 2026-11-07 | P0 | specified | DST-R02 | — |
| PAR-DST-003 | Mapping validation (max occupancy, child pricing compatibility, required attributes) | Apaleo [channel onboarding guide](https://apaleo.dev/guides/business-cases/channel-integration/onboarding-guide.html) — verified 2026-11-07 | P0 | specified | DST-R02 | — |
| PAR-DST-004 | Map channel guarantee codes, payment types and card types on inbound bookings | OPERA [Configuring Reservation Codes](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_reservation_codes.htm) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-005 | Channel-specific sell prices (derived plan with markup/discount per channel) | OPERA [Channel Rate Plans](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_channel_rate_plans.htm) · [Channel Offers](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_channel_offers.htm) — verified 2026-11-07 | P1 | specified | RAT-R03, RAT-R10 | — |
| PAR-DST-006 | Which rate plans each channel may sell | OPERA [Channel Rate Access](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_channel_rate_access.htm) — verified 2026-11-07 | P0 | specified | RAT-R10, DST-R02 | — |
| PAR-DST-007 | Per-channel commission terms recorded for reconciliation | OPERA [Commission Management](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_commissions_commissions_ch.htm) — verified 2026-11-07 | P1 | specified | RAT-R06 (channel/agency commission) | — |
| PAR-DST-008 | Rates published in a channel's currency | Mews BE [supported currency codes](https://docs.mews.com/booking-engine-guide/booking-engine-api/guidelines/supported-currency-codes.md) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-DST-009 | Property and unit-type content (photos, descriptions, amenities, policies) published to channels | OPERA [Content Management](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_configuring_content_management.htm) · OPERA Distribution [Content](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/ch_content.htm) — verified 2026-11-07 | P2 | deferred | DST-R18 (LATER) | — |
| PAR-DST-010 | Tax and fee information published so channels show the right all-in price (e.g. Green Tax payable at property) | OPERA Distribution [Taxes](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_content_taxes.htm) · [Fees](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_content_fees.htm) — verified 2026-11-07 | P1 | missing | — | — |

### 2. ARI outbound

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-011 | Delta ARI from change events with idempotent message ids and a ≤ 60 s target | SiteMinder delta rounds (research 03 §4.3) · Apaleo [ARI subscriptions](https://apaleo.dev/guides/business-cases/channel-integration/ari-subscriptions.html) · Mews CHM [inventory updates](https://docs.mews.com/channel-manager-api/use-cases/inventory-updates.md) — verified 2026-11-07 | P0 | specified | DST-R04 | — |
| PAR-DST-012 | Rejection classification: payload errors not retried, transient errors backed off, then urgent | SiteMinder (research 03 §9.1) | P0 | specified | DST-R04 | — |
| PAR-DST-013 | Full ARI resync (on connect, nightly, on demand), non-destructive | OPERA [Interface Resync](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_interface_resync.htm) · [Rates Resynchronization](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_interface_resync_rates.htm) — verified 2026-11-07 | P0 | specified | DST-R05 | — |
| PAR-DST-014 | Last-acknowledged channel state per cell beside Portico's state | assumption (no competitor shows it) | P0 | specified | DST-R06, DST-I04 | — |
| PAR-DST-015 | Shared availability pool by default ("last room available") | SiteMinder pooled availability ([pmsXchange](https://developer.siteminder.com/siteminder-apis/pms-rms/introduction/pmsxchange/api-reference/availability-and-restrictions)) · Cloudbeds one inventory (research 03 §3.2) — verified 2026-11-07 | P0 | specified | DST-R03 | — |
| PAR-DST-016 | Per-channel caps and holdbacks | OPERA [Managing Channel Sell Limits](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_channel_sell_limits.htm) · [Setting Channel Sell Limits](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_availability_setting_channel_sell_limits.htm) — verified 2026-11-07 | P1 | specified | DST-R03 | — |
| PAR-DST-017 | Manual stop-sell per channel, per channel rate or for all channels | SiteMinder [add or remove stop sells](https://help-platform.siteminder.com/en/articles/13211684-add-or-remove-stop-sells) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | specified | DST §8 (`stopSell.manage`), DST-R07 | — |
| PAR-DST-018 | Automatic stop-sell protection at low availability or for degraded channels | Cloudbeds sends 0 to all channels when a type is overbooked ([help](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/220747288-Overbooking-types-in-Cloudbeds-PMS)) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P1 | specified | DST-R07 | — |
| PAR-DST-019 | Per-channel translation of restrictions the channel cannot express (e.g. stay-through → arrival-based), shown to staff | Cloudbeds MinLOS on Agoda/Priceline applies to arrival date only ([help](https://myfrontdesk.cloudbeds.com/hc/en-us/articles/11035397464603)) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P1 | missing | — | — |
| PAR-DST-020 | Restrictions for one channel only (close a rate on one OTA) | SiteMinder [stop sell per channel rate](https://help-platform.siteminder.com/en/articles/13211684-add-or-remove-stop-sells) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P1 | missing | — (RAT-R08 scopes are plan/type only) | — |
| PAR-DST-021 | Publication controls: pause a channel, choose published types/plans/dates | OPERA [Configuring Channel Publication](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_configuring_channel_publication.htm) · OPERA Distribution [Publish](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_channel_publish.htm) — verified 2026-11-07 | P0 | specified | DST-R02, DST-R13 | — |
| PAR-DST-022 | Rate parity monitoring of prices actually displayed on OTAs | Lighthouse class tools (research 03 §8.7) | P2 | missing | — | — |

### 3. Reservations inbound

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-023 | Immutable inbound revision log; ordered per property; ack only after commit | SiteMinder ack-or-resend (research 03 §4.3) · Apaleo [send bookings guide](https://apaleo.dev/guides/business-cases/channel-integration/send-bookings.html) — verified 2026-11-07 | P0 | specified | DST-R08, DST-I02 | — |
| PAR-DST-024 | Orphan modifications/cancellations parked until the create arrives | assumption | P0 | specified | DST-R09 | — |
| PAR-DST-025 | Unmapped bookings accepted with a provisional hold and blocking alert | SiteMinder accepts unmapped without decrementing (research 03 §4.6) | P0 | specified | DST-R10, DST-I03 | — |
| PAR-DST-026 | Recovery: re-request bookings since T and reconcile booking lists | Apaleo [trouble-shooting guide](https://apaleo.dev/guides/business-cases/channel-integration/trouble-shooting.html) — verified 2026-11-07 | P0 | specified | DST-R11 | — |
| PAR-DST-027 | Field-loss and price discrepancies listed with resolution actions | assumption | P0 | specified | DST-R12 | — |
| PAR-DST-028 | Virtual card metadata (amount, activation date) intake through the hub's PCI service | Mews [payment automation](https://docs.mews.com/connector-api/use-cases/payment-automation.md) — verified 2026-11-07 | P0 | specified | DST §2, PAY | — |
| PAR-DST-029 | Channel-collect vs hotel-collect bookings distinguished (prepaid by OTA vs pay at hotel) | Mews CHM [reservations](https://docs.mews.com/channel-manager-api/channel-manager-operations/reservations.md) — verified 2026-11-07 | P0 | specified | RES-R01 (`prepaid_channel` guarantee) | — |
| PAR-DST-030 | Channel commission per booking reconciled with OTA invoices | OPERA [Commission Management](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_commissions_commissions_ch.htm) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-031 | Channel-supplied cancellation policy and price honoured as agreed terms | Apaleo [modify bookings guide](https://apaleo.dev/guides/business-cases/channel-integration/modify-bookings.html) — verified 2026-11-07 | P0 | specified | RES-R30, RES-R33 | — |
| PAR-DST-032 | Message history per booking and per channel (received, applied, acknowledged) | OPERA [Using Channel Messages](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_distribution_using_channel_messages.htm) · OPERA Distribution [From/To Channels](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_channel_messages_from_to_channels.htm) — verified 2026-11-07 | P0 | specified | DST-R08, INT-R15 | — |
| PAR-DST-033 | OTA guest messaging and reviews through the hub | Mews [reputation management](https://docs.mews.com/connector-api/use-cases/reputation-management.md) — verified 2026-11-07 | P2 | deferred | DST-R18 (LATER) | — |
| PAR-DST-034 | Tour-operator booking e-mails turned into draft bookings for review | assumption (Maldives tour operators often confirm by e-mail) | P1 | missing | — | — |

### 4. Health and incidents

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-035 | Health console per channel (status, last push, last booking, queue, errors, mapping, discrepancies) | OPERA [Interface Monitoring](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_interface_monitoring.htm) · [Message Status](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_message_status.htm) — verified 2026-11-07 | P0 | specified | DST-R13 | — |
| PAR-DST-036 | Outage never shown as synced; banner states what is stale since when | SiteMinder [troubleshoot stop sells](https://help-platform.siteminder.com/en/articles/13211820-troubleshoot-stop-sell-issues) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P0 | specified | DST-R14 | — |
| PAR-DST-037 | Credentials revoked at the OTA: urgent exception, ARI paused for that channel only | assumption | P0 | specified | DST §10 (E04) | — |
| PAR-DST-038 | No two systems publishing ARI for one property | assumption (dual-PMS hazard, research 03 §3.3) | P0 | specified | DST-R15, DST-I05 | — |
| PAR-DST-039 | Replay/resend individual messages and queues | OPERA [Monitoring Async Queue](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_monitoring_async_queue.htm) · [Business Event Queue](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_monitoring_business_event_queue.htm) — verified 2026-11-07 | P0 | specified | DST-R13 | — |
| PAR-DST-040 | Urgent alerts (push/SMS/e-mail) for delivery timeouts and overbookings | SiteMinder delivery-timeout escalation (research 03 §9.1) | P0 | specified | DST-R13 | — |

### 5. Direct booking engine

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-041 | Booking engine: search, offers with all-in total, policies, extras, guest details, payment, confirmation | Mews [Booking Engine Guide](https://docs.mews.com/booking-engine-guide/readme.md) · SiteMinder booking engine (research 03 §4) · Cloudbeds [booking engine](https://www.cloudbeds.com/booking-engine-usa/) — verified 2026-11-07 | P0 | specified | DST-R16 | — |
| PAR-DST-042 | Unit-type content for the booking engine (photos, descriptions, size, amenities, bed types) | Mews BE [images](https://docs.mews.com/booking-engine-guide/booking-engine-api/guidelines/images.md) — verified 2026-11-07 | P0 | missing | — (DST-R18 defers content; booking engine needs it now) | — |
| PAR-DST-043 | Multilingual booking engine | Mews BE [language codes](https://docs.mews.com/booking-engine-guide/booking-engine-api/guidelines/supported-language-codes.md) — verified 2026-11-07 | P0 | specified | DST-R16 | — |
| PAR-DST-044 | Display in the guest's currency with the charge currency clearly stated | Mews BE [currency codes](https://docs.mews.com/booking-engine-guide/booking-engine-api/guidelines/supported-currency-codes.md) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-045 | Deep links with dates, unit type, promo code prefilled | Mews BE [deeplinks](https://docs.mews.com/booking-engine-guide/booking-engine-standalone/deeplinks.md) · SiteMinder [links and widgets](https://help-classic.siteminder.com/en/articles/8673807-booking-engine-integrate-the-booking-engine-with-your-website-using-links-and-widgets) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P1 | missing | — | — |
| PAR-DST-046 | Embeddable widget on the hotel's website plus hosted standalone page | Mews [Booking Engine Widget](https://docs.mews.com/booking-engine-guide/booking-engine-widget.md) · [Standalone](https://docs.mews.com/booking-engine-guide/booking-engine-standalone.md) — verified 2026-11-07 | P1 | missing | — (DST-R16 does not state delivery forms) | — |
| PAR-DST-047 | Analytics and conversion tracking (Google Tag Manager, GA4 cross-domain) | Mews BE [Google Tag Manager](https://docs.mews.com/booking-engine-guide/integrations/google-tag-manager.md) · [GA cross-domain](https://docs.mews.com/booking-engine-guide/integrations/ga-cross-domain-tracking.md) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-048 | Portfolio booking engine (search across properties) | Mews BE [multiple enterprises](https://docs.mews.com/booking-engine-guide/booking-engine-widget/use-cases/multi-enterprises.md) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-DST-049 | Extras/add-ons in the booking path (transfers, spa, celebration packages) | Mews BE [services](https://docs.mews.com/booking-engine-guide/booking-engine-api/operations/services.md) · Apaleo [service offers](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P0 | specified | DST-R16, RAT-R16 | — |
| PAR-DST-050 | Card authorization/on-session payment with 3DS through hosted fields | Mews BE [payment card authorization](https://docs.mews.com/booking-engine-guide/booking-engine-api/use-cases/payment-card-authorization.md) · [on-session payments](https://docs.mews.com/booking-engine-guide/booking-engine-api/use-cases/on-session-payments.md) — verified 2026-11-07 | P0 | specified | DST-R16 | — |
| PAR-DST-051 | Multi-room bookings in one checkout | Mews BE [reservation groups](https://docs.mews.com/booking-engine-guide/booking-engine-api/operations/reservation-groups.md) — verified 2026-11-07 | P1 | specified | DST-R16, RAT proposed change 1 | — |
| PAR-DST-052 | Group attendees book into a block via a code or link | Mews BE [availability blocks](https://docs.mews.com/booking-engine-guide/booking-engine-api/use-cases/availability-blocks.md) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-053 | Accessible booking engine (WCAG 2.2 AA) | assumption | P0 | specified | DST-R16 | — |
| PAR-DST-054 | Guests modify or cancel their own booking online within policy | Mews guest portal links ([reservations](https://docs.mews.com/connector-api/operations/reservations.md)) — verified 2026-11-07 | P1 | missing | — | — |
| PAR-DST-055 | Lowest-price calendar in the booking engine | Apaleo [offer-index](https://api.apaleo.com/swagger/index.html) — verified 2026-11-07 | P1 | missing | — (see PAR-RAT-074) | — |
| PAR-DST-056 | Bot and card-testing protection on the public booking path | assumption | P1 | missing | — | — |
| PAR-DST-057 | Vouchers/gift codes redeemable in the booking engine | Mews BE [vouchers](https://docs.mews.com/booking-engine-guide/booking-engine-api/operations/vouchers.md) — verified 2026-11-07 | P2 | missing | — | — |

### 6. Metasearch, GDS, wholesale

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-058 | Google free booking links / Hotel Ads ARI using the booking engine's price computation | Cloudbeds Google free booking links ([page](https://www.cloudbeds.com/booking-engine-usa/)) · research 04 §A5 — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P1 | specified | DST-R17 | — |
| PAR-DST-059 | Other metasearch (Tripadvisor, trivago) via a partner | SiteMinder metasearch visibility (research 03 §4) | P2 | missing | — | — |
| PAR-DST-060 | GDS distribution through an intermediary CRS (Sabre, Amadeus, Travelport) | SiteMinder [GDS](https://www.siteminder.com/r/hotel-distribution/hotel-global-distribution-system) · [Sirvoy help: GDS via SiteMinder](https://help.sirvoy.com/en_US/connect-to-gds-with-siteminder-or-bookvisit) — verified 2026-11-07 (web search; vendor site blocks direct fetch) | P2 | deferred | DST-R18 (LATER, `distribution.gds`) | — |
| PAR-DST-061 | GDS rate loading, IATA commission handling and GDS exceptions | OPERA [Monitoring IATA Exception](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_monitoring_iata_exception.htm) — verified 2026-11-07 | P2 | deferred | DST-R18 (LATER) | — |
| PAR-DST-062 | Wholesaler/bedbank connections (Hotelbeds class) via hub | research 04 §A6 | P1 | specified | DST §4 (channel kind `wholesale`), DST §11 | — |
| PAR-DST-063 | Aggregated channel contracting (single contract/invoice) | SiteMinder Channels Plus (research 03 §4.2) | P2 | deferred | DST-R18 (LATER) | — |
| PAR-DST-064 | AI-agent booking channels (MCP/agentic APIs) | Apaleo MCP server (research 02 §3.6) | P2 | deferred | DST-R18 (LATER) | — |

### 7. Permissions, reports, adoption

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-DST-065 | Permissions for connections ⚑, mapping, resync, recovery, stop-sell, booking-engine settings | OPERA Distribution [Role Permissions](https://docs.oracle.com/en/industries/hospitality/opera-cloud-distribution/26.3/ohdug/c_role_manager_role_permissions.htm) — verified 2026-11-07 | P0 | specified | DST §8 | — |
| PAR-DST-066 | Production by channel (bookings, room nights, revenue, commission, cancellations) | OPERA [Statistics Reports](https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_reports_statistics.htm) — verified 2026-11-07 | P1 | specified | ANL-R02 (by channel) | — |
| PAR-DST-067 | Booking-engine funnel (searches, offers viewed, abandonment, conversion) | Mews BE [Google triggers reference](https://docs.mews.com/booking-engine-guide/integrations/google-triggers-reference.md) — verified 2026-11-07 | P2 | missing | — | — |
| PAR-DST-068 | OTA simulator for demo/trial; no real channel effects outside live | assumption (D7) | P0 | specified | DST §14, PLT-R04 | — |
| PAR-DST-069 | Import mappings from the hotel's current channel manager for review in trial | assumption | P1 | specified | DST §14 (Trial) | — |
| PAR-DST-070 | Channel manager / booking engine fed by an external PMS (standalone) | SiteMinder standalone channel manager (research 03 §4) | P2 | deferred | DST §14 (LATER) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-DST-001 | Same booking revision delivered twice | Outcome `duplicate`; acknowledged again; one effect (DST-I01) | P0 | specified | — |
| EC-DST-002 | Cancellation arrives before its create | Parked as orphan; applied when the create arrives; parked > 15 min → urgent exception | P0 | specified | — |
| EC-DST-003 | Modification arrives for a booking already cancelled locally | Stored, not applied; conflict exception with both versions for staff to resolve with the channel | P1 | missing | — |
| EC-DST-004 | Booking for an unmapped room type | Accepted; provisional hold on the best-matching unit type (or property total); blocking alert | P0 | specified | — |
| EC-DST-005 | Booking for a mapped room but unmapped rate | Accepted at channel price; rate/mapping discrepancy raised | P0 | specified | — |
| EC-DST-006 | Ack lost after commit; channel resends | Detected as duplicate; ack sent; no second booking | P0 | specified | — |
| EC-DST-007 | Reservations transaction fails after receipt | No ack; message stays `received` in the revision log; retry or channel resend applies it once | P0 | specified | — |
| EC-DST-008 | Hub outage of 3 hours at peak (S20) | Banner with stale-since time; stop-sell protection on degraded channels; ARI queued and coalesced; on recovery latest state resent and recovery pull ingests missed bookings | P0 | specified | — |
| EC-DST-009 | ARI rejected for a payload error (price below channel minimum) | Not retried; exception with plain-language fix; cell shows "not accepted by channel" | P0 | specified | — |
| EC-DST-010 | Fifty price edits in a minute | Coalesced; only the latest state per cell sent; superseded messages marked | P0 | specified | — |
| EC-DST-011 | Older ARI processed by the channel after a newer one | Last-acknowledged state shows the mismatch; discrepancy after the freshness SLA; targeted resend | P1 | specified | — |
| EC-DST-012 | Channel booking for the last unit races a desk sale | Inventory conflict recorded and relocation case opened; never a silent oversell | P0 | specified | — |
| EC-DST-013 | Hotel revokes credentials at the OTA | Urgent exception; ARI paused for that channel only; other channels unaffected (E04) | P0 | specified | — |
| EC-DST-014 | Room type remapped while future channel bookings exist | Existing bookings keep their unit type; preview of ARI changes before saving the new mapping | P1 | missing | — |
| EC-DST-015 | Unit type retired but still mapped | Mapping marked invalid; channel receives closed availability; warning in health console | P1 | missing | — |
| EC-DST-016 | Channel sends tax-inclusive amounts for one channel and exclusive for another | Connector normalizes per channel tax mode; snapshot stores channel amounts and the interpretation; mismatch with Portico's tax computation flagged | P0 | missing | — |
| EC-DST-017 | OTA collected Green Tax in its prepayment vs Green Tax payable at the hotel | Booking records which taxes the channel collected; folio never charges them twice; mismatch raises an exception | P0 | missing | — |
| EC-DST-018 | Virtual card activates after check-in date | Guarantee shows VCC pending until activation; charge scheduled at activation; never shown paid before capture | P0 | specified | — |
| EC-DST-019 | VCC covers room only; guest adds extras | Billing rule routes room to the VCC folio, extras to the guest folio automatically; preview shows it | P1 | missing | — |
| EC-DST-020 | Channel shortens an in-house stay | Not applied automatically; exception; staff decide (guest present) | P1 | missing | — |
| EC-DST-021 | Booking-engine guest double-submits or 3DS times out | Idempotent booking; payment `pending_verification`; no second booking or charge | P0 | specified | — |
| EC-DST-022 | Unit sold elsewhere while a booking-engine guest is paying | Cart hold (15 min) protects the unit; if expired and sold, clear message and alternatives; authorization voided | P0 | specified | — |
| EC-DST-023 | Booking-engine total differs from the confirmed total | Impossible by design: same quote engine and config vector; stale vector re-quotes before payment | P0 | specified | — |
| EC-DST-024 | Google price feed disagrees with booking-engine price | Same computation; mismatch detected and alerted before Google suspends the listing | P1 | specified | — |
| EC-DST-025 | Guest views prices in EUR but is charged in USD | Display marked approximate with rate source; charge currency stated before payment and on confirmation | P1 | missing | — |
| EC-DST-026 | Channel booking with OTA proxy e-mail and non-Latin name | Stored as received; transliteration kept alongside; proxy e-mail flagged so comms uses the OTA channel | P2 | missing | — |
| EC-DST-027 | Channel booking arrives for a property in `setup`, or a channel outside pilot scope | Accepted (the guest is confirmed by the OTA) and raised as urgent; ARI for out-of-scope channels never published | P1 | missing | — |
| EC-DST-028 | Trial environment attempts ARI publication | Blocked by environment policy; simulator receives it; UI labels results simulated | P0 | specified | — |
| EC-DST-029 | Nightly full resync collides with peak delta traffic | Resync chunked and rate-limited; deltas prioritized; resync progress visible | P2 | missing | — |
| EC-DST-030 | Channel throttles (HTTP 429) | Backoff without dropping messages; urgent exception if backlog exceeds the freshness SLA | P0 | specified | — |
| EC-DST-031 | Parked orphan never matched | Recovery pull; after the window, urgent exception to contact the channel | P0 | specified | — |
| EC-DST-032 | Same revision number with different content | Treated as a conflict by content hash and flagged, never silently ignored | P1 | missing | — |
| EC-DST-033 | Availability authority switched to an external PMS while channels are connected | Publication stops at the switch (DST-I05); health shows "published by <system>" | P0 | specified | — |
| EC-DST-034 | Seasonal closure of a guesthouse for Ramadan renovations | Bulk close via stop-sell or unit blocks propagates to all channels; reopening re-publishes with resync | P1 | specified | — |
