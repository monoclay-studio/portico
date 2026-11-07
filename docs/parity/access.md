# Parity matrix and edge cases: access

Module: `access` (guest credentials and keys bound to stays: cards, wristbands, mobile, wallet, PIN, mechanical keys;
lock-system connections and encoders; pre-encoded packets; lost keys; door audit trails; outage behaviour). Spec:
`docs/specs/access.md` (Draft v1, wave 2 manual key log / wave 3 connectors, prefix ACC), proposed by the guest-journey
audit. Researched 2026-11-07 by the parity-ops researcher. **No code exists** (`modules/access` not started; the
integration catalogue lists `doorLock.encoders` as a planned R1 entry), so every row is `specified`, `missing`,
`deferred` or `different`.

**Baseline:** OPERA Cloud 26.3 *Property Interfaces — Managing Keys* (door lock system), *Managing Room Keys*,
*Enhanced Room Key Generation*, *Creating Room Keys for Block Reservations*, *Key Packet Labels*, encoder
workstations in *Configuring Property Interface* and the room-key-encoding outbound system type. **Modern additions:**
Mews Digital Key (keys from online check-in, messages, portal or kiosk), Stayntouch (Salto and other direct key
integrations, kiosk key pick-up, contactless mobility), Cloudbeds (Salto Space connection), Infor HMS (mobile keys
through partners). Lock-vendor facts: Salto Space operator guide, Seam's ASSA ABLOY Vostio guide, journey coverage
§1.4 (Vostio cloud API; Salto Space PMS interface over TCP/IP and Apple Wallet keys; dormakaba Ambiance interfaces,
mobile-key licences, no remote web unlock). Our research: R02 §2.2 and §8 item 12 (Mews digital key), §4.2
(Stayntouch kiosk with encoder and ID scan), R03 §8.4 (Clock PMS+ keyless self-service), R04 D4 (RFP: certified
lock interfaces; offline continuity incl. emergency key encoding), R05 digest §2 access row (dense patents on
mobile-to-kiosk keys and passport-face matching: use vendors' certified SDKs). Portico terms in the Capability column
(credential, key operation, encoder, key packet, lock-system connection, capability truth table).
**Evidence:** a source marked "search-located" under *Sources* was found by web search but its host blocks direct
fetches here — facts resting only on it are unverified. Priorities: P0 compete/pilot, P1 full-service/resort
expectation, P2 differentiator or rare.

## Capabilities

### 1. Credentials, lock systems and encoders

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-001 | Credential kinds (card, wristband, mobile, wallet, PIN, mechanical) with holder, units, validity in property time, sequence and issuing source | OPERA [managing room keys][op-keycreate] · [door lock interface][op-keys] · verified 2026-11-07 | P0 | specified | access.md ACS-R01 | — |
| PAR-ACS-002 | Lock-system connection by integration model: cloud API, on-premise server through the local connector, credential service, smart-lock API, manual | journey coverage §1.4 · Seam [Vostio guide][seam-vostio] · Salto [Space hotel guide][salto-hotel] · OPERA [room key encoding outbound type][op-outbound] · verified 2026-11-07 (Seam, Salto search-located, unverified) | P0 | specified | access.md ACS-R02 | — |
| PAR-ACS-003 | Capability truth table per connection; every screen that ends a credential says how it ends (cancelled at the lock system, expires at, invalidated by the next guest's key, cannot be ended remotely — collect) | assumption (no competitor documents this; access.md §12) | P0 | specified | access.md ACS-R03 | — |
| PAR-ACS-004 | Encoders with location and status; default encoder per workstation, tablet or kiosk; unreachable encoders flagged on the arrivals board | OPERA [encoder workstations][op-pifc] · verified 2026-11-07 | P0 | specified | access.md ACS-R04 | — |
| PAR-ACS-005 | Unit ↔ door mapping (entrance, connecting door, pool gate) reviewed; activation blocked while a sellable unit is unmapped | OPERA [door lock interface][op-keys] · verified 2026-11-07 | P0 | specified | access.md ACS-R05, ACC-I07 | — |
| PAR-ACS-006 | Connectors for the lock systems hotels run (ASSA ABLOY Vostio/Visionline, Salto Space, dormakaba Ambiance/Saflok) | Stayntouch [Salto direct key][snt-salto] · [direct key integrations][snt-directkeys] · Cloudbeds [connect Salto Space][cb-salto] · Mews [Digital Key][mews-dkey] · search-located 2026-11-07, unverified | P1 | specified | access.md ACS-R02 (wave 3; vendor programmes Q80, protocols Q62) | — |

### 2. Key lifecycle bound to the stay

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-007 | Issue keys at check-in (count by policy, validity to departure + grace in property time); the step is done only when every requested key is issued; partial success per credential | OPERA [managing room keys][op-keycreate] · [enhanced key generation][op-keyenh] · verified 2026-11-07 | P0 | specified | access.md ACS-R06 | — |
| PAR-ACS-008 | Additional and duplicate keys with a recorded identity check; requests from non-occupants refused | OPERA [managing room keys][op-keycreate] · verified 2026-11-07 | P0 | specified | access.md ACS-R07 | — |
| PAR-ACS-009 | Extension, late check-out and early check-in change validity (remote extend where supported, otherwise a re-encode task); keys expiring while the guest is in house raise a warning | OPERA [enhanced key generation][op-keyenh] · verified 2026-11-07 | P0 | specified | access.md ACS-R08 | — |
| PAR-ACS-010 | Room move issues keys for the new unit and ends the old ones per capability, with a collect task when needed | OPERA [managing room keys][op-keycreate] · verified 2026-11-07 | P0 | specified | access.md ACS-R09 | — |
| PAR-ACS-011 | End of stay per credential: cancelled, expires at, collected or outstanding; outstanding keys are a Day Close warning and a handover item | assumption | P0 | specified | access.md ACS-R10, ACC-I03 | — |
| PAR-ACS-012 | Pre-encoded key packets for jetty, airport-lounge or in-villa check-in with a future start; voided on reassignment, cancellation or no-show | OPERA [keys for block reservations][op-keyblock] · [key packet labels][op-keypacket] · verified 2026-11-07 | P0 | specified | access.md ACS-R11 | — |
| PAR-ACS-013 | Bulk encoding for a group's assigned rooms ahead of arrival | OPERA [keys for block reservations][op-keyblock] · verified 2026-11-07 | P1 | specified | access.md ACS-R11 | — |
| PAR-ACS-014 | Key packet labels with stay code and unit | OPERA [key packet labels][op-keypacket] · verified 2026-11-07 | P2 | specified | access.md ACS-R11 | — |
| PAR-ACS-015 | Lost or stolen key: end that credential, replacement after identity check, optional lost-key charge, incident reference | assumption | P0 | specified | access.md ACS-R12 | — |
| PAR-ACS-016 | Read a card at the encoder to see which stay, unit and validity it carries | OPERA [managing room keys][op-keycreate] · verified 2026-11-07 | P1 | specified | access.md ACS-R02 (`doorKeys` read status) | — |
| PAR-ACS-017 | Joiner keys for connecting rooms and multi-door credentials (villa gate, private pool) | OPERA [enhanced key generation][op-keyenh] · verified 2026-11-07 | P1 | specified | access.md ACS-R01, ACS-R03 (`joinerKey`), ACS-R05 | — |

### 3. Mobile, wallet and PIN credentials

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-018 | Mobile keys through the vendor's SDK or app, delivered after check-in; status shown as the credential service reports it; opening works offline at the door | Mews [Digital Key][mews-dkey] · Stayntouch [Guest Mobility][snt-mobility] · Infor [HMS mobile keys (press)][infor-hms] · search-located 2026-11-07, unverified | P1 | specified | access.md ACS-R13 [SHOULD] | — |
| PAR-ACS-019 | Wallet keys (Apple/Google) | journey coverage §1.4 (Salto and dormakaba wallet keys) | P2 | deferred | access.md ACS-R14 [LATER] (reader generation and vendor credential partner dependent) | — |
| PAR-ACS-020 | PIN codes for self check-in released only when conditions pass (guarantee, online check-in, identity); stored encrypted; rotated on move or extension; never in bulk messages | R03 §8.4 (Clock PMS+ keyless self-service) | P1 | specified | access.md ACS-R15 [SHOULD] | — |
| PAR-ACS-021 | Lockbox codes handled as manual PIN credentials with a rotation reminder | assumption (guesthouses, apartments) | P2 | specified | access.md ACS-R15 | — |
| PAR-ACS-022 | Kiosk key encoding together with ID scan and payment | Stayntouch [kiosk key pick-up][snt-kioskkeys] · R02 §4.2 · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R30; access.md ACS-R04 | — |

### 4. Manual and mechanical keys

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-023 | Manual key log when keys are made in the lock vendor's software (the pilot path and the outage fallback); check-in step `done (manual)` with provenance `external` | assumption (rollout acceptance RO-08) | P0 | specified | access.md ACS-R16 | — |
| PAR-ACS-024 | Mechanical-key register per unit with spares; issue and return per stay; lost key → lock-change work order suggestion and optional charge | assumption (Maldives guesthouses, access.md §11) | P0 | specified | access.md ACS-R17 | — |

### 5. Safety, audit and failure behaviour

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-025 | Lock simulator for demo, trial and training (success, timeout then success, encoder offline, rejection, remote cancel unsupported); results labelled simulated or sandbox | R04 A9 (safe testing without partner access) | P0 | specified | access.md ACS-R18, ACC-I05 | — |
| PAR-ACS-026 | Key operations idempotent and truthful: persisted before the call; `pending_verification` on timeout; repeats blocked; read-back or staff verification | R04 B7 (idempotency pattern) | P0 | specified | access.md ACS-R19, ACC-I04 | — |
| PAR-ACS-027 | Audit of every credential change (actor, device, encoder, validity before and after, identity-check method) without PINs, secrets or card UIDs in clear | OPERA [property interface logs][op-ifclogs] · verified 2026-11-07 | P0 | specified | access.md ACS-R20, ACC-I06 | — |
| PAR-ACS-028 | Door audit trail for a unit and time window, with permission and reason, provenance `external`, attached to an incident only by explicit action | Salto [Space hotel guide][salto-hotel] · search-located 2026-11-07, unverified | P1 | specified | access.md ACS-R21 [SHOULD] | — |
| PAR-ACS-029 | Outage behaviour: manual path offered, banner with since-when and impact, no key operation replayed without revalidation | R04 D4 (offline continuity, emergency key encoding) | P0 | specified | access.md ACS-R22; integration.md INT-R19 | — |
| PAR-ACS-030 | Key exceptions (outstanding after departure, expiring in house, re-encode tasks, pending operations, unmapped doors, encoders offline, packets not handed over) in Day Close, handover and the desk workspace | assumption | P0 | specified | access.md ACS-R23 | — |

### 6. Common areas, staff keys and adjacent systems

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-031 | Access groups for common areas (club lounge, gym, adults-only pool, spa wet area) from rate plan, package, tier or upsell | Salto [Space hotel guide][salto-hotel] · search-located 2026-11-07, unverified | P2 | deferred | access.md ACS-R24 [LATER] (after per-stay keys are proven) | — |
| PAR-ACS-032 | Staff credentials and master keys | Salto [Space hotel guide][salto-hotel] · search-located 2026-11-07, unverified | P2 | different | access.md §2 (the lock system stays the system of record for staff keys) | — |
| PAR-ACS-033 | Lock battery and fault alerts turned into maintenance work orders | assumption | P2 | different | access.md §2 (lock system owns maintenance data; Portico records work orders only) | — |
| PAR-ACS-034 | Room energy management or GRMS presence linked to key status | assumption | P2 | deferred | guest-services.md GSV-R34 [LATER] | — |

### 7. Connected mode, guest surface and control

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ACS-035 | Mobile keys and PIN self check-in next to an external PMS only when that PMS does not also issue keys to the same lock system | assumption (dual-control risk) | P1 | specified | access.md §14 (CR-11) | — |
| PAR-ACS-036 | Key validity follows mirrored stay dates; a delayed check-out feed is shown honestly ("check-out not yet received; key still valid") | assumption | P1 | specified | access.md §14 | — |
| PAR-ACS-037 | Guest-facing key card in the portal with status as reported by the credential service | Mews [Digital Key][mews-dkey] · search-located 2026-11-07, unverified | P1 | specified | guest-experience.md GXP-R23 | — |
| PAR-ACS-038 | Lost-key charges forwarded to the PMS folio when charges are external | assumption | P2 | specified | access.md §14 | — |
| PAR-ACS-039 | Permissions: issue, duplicate, end, manage connections and encoders, audit-trail read ⚑ | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P0 | specified | access.md §8 | — |
| PAR-ACS-040 | Pilot scope: key issuance live only when the pilot includes the `doorKeys` workflow | assumption | P0 | specified | access.md ACS-R18; platform.md PLT-R14 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-ACS-001 | The encoder times out while cutting a key | Operation `pending_verification`; a second encode is blocked with an explanation; resolved by read-back or staff verification; the check-in step resumes without a duplicate credential | P0 | specified | — |
| EC-ACS-002 | The lock connector is down during the arrivals rush (S20) | Banner with since-when and impact; manual path recorded; on recovery nothing replayed without revalidation | P0 | specified | — |
| EC-ACS-003 | An extension becomes a split stay: 214 for the original nights, 216 for the new ones (S03) | Keys for 214 end at the original departure; keys for 216 issued for the new nights; nothing opens 214 on the next guest's nights | P0 | specified | — |
| EC-ACS-004 | A failed inspection forces reassignment after a packet was pre-encoded (S07/S08) | Packet voided with a collect task; keys issued for the new villa | P0 | specified | — |
| EC-ACS-005 | Room move at 22:00 with offline card locks | New keys issued; old cards shown "valid until 13:00 tomorrow — collect"; Day Close warning until collected | P0 | specified | — |
| EC-ACS-006 | Someone who is not an occupant asks for a duplicate key; an occupant asks without ID | Non-occupant refused with reason; occupant blocked by policy until the identity check is recorded | P0 | specified | — |
| EC-ACS-007 | A key was issued to the wrong stay (E15) | Ended and re-issued; audit shows both operations | P0 | specified | — |
| EC-ACS-008 | A trial organization checks a guest in | Every key action simulated; zero lock-system calls; results labelled simulated | P0 | specified | — |
| EC-ACS-009 | Check-out at 10:00 with cards that cannot be cancelled remotely | Shown as "expires at 13:00" (check-out time + grace) or "invalidated when the next guest's key is first used"; never "deactivated" | P0 | specified | — |
| EC-ACS-010 | Late check-out to 18:00 approved after keys were encoded to 13:00 | Extended remotely where supported, otherwise a re-encode task; warning before 13:00 if still in house | P0 | specified | — |
| EC-ACS-011 | A pre-encoded packet belongs to a no-show | Packet voided automatically; collect task for the physical packet | P0 | specified | — |
| EC-ACS-012 | A guest loses their wristband in the lagoon | Credential ended where possible; replacement after identity check; optional charge with key `lostkey:{credentialId}` | P1 | specified | — |
| EC-ACS-013 | A guest asks for their PIN while the deposit is unpaid | PIN not released; the portal says exactly what is missing | P1 | specified | — |
| EC-ACS-014 | A PIN is shared after check-out | It stops working at validity end; a new stay gets a new code | P1 | specified | — |
| EC-ACS-015 | The guest's phone has no data at the villa door | Mobile key opens over BLE offline; connectivity needed only to install | P1 | specified | — |
| EC-ACS-016 | The credential service says "installed" but the door does not open | Status shown exactly as reported; staff issue a card as fallback; Portico never assumes "active" | P1 | specified | — |
| EC-ACS-017 | A villa is renumbered in inventory | Door mapping flagged for review; keys cannot be issued until reviewed (ACC-I07) | P1 | specified | — |
| EC-ACS-018 | A new villa is sellable but has no door mapping | Keys refused with "Villa 214 has no door in Visionline — keys cannot be issued"; exception on the desk workspace | P0 | specified | — |
| EC-ACS-019 | A two-bedroom villa is a composite of two rooms | Credentials cover each door; ending the stay ends all of them | P1 | specified | — |
| EC-ACS-020 | A family books connecting rooms | Joiner key where the lock system supports it; otherwise separate keys with the connecting door explained | P2 | specified | — |
| EC-ACS-021 | The jetty encoder has been unreachable for 3 minutes | Shown on the arrivals board and in integration health; staff switch to another encoder | P1 | specified | — |
| EC-ACS-022 | Two agents encode for the same stay at once | One operation per idempotency key and sequence number; the second agent sees the first one's result | P0 | specified | — |
| EC-ACS-023 | Connected mode: the external PMS already issues keys to the same lock system | Portico refuses to activate its own key issuing for that lock system and says why | P1 | specified | — |
| EC-ACS-024 | Connected mode: the check-out has not arrived from the PMS yet | "Check-out not yet received from <PMS>; key still valid" instead of assuming | P1 | specified | — |
| EC-ACS-025 | A guest leaves two days early | Keys ended now (not at the original departure) by the end-of-stay step | P0 | specified | — |
| EC-ACS-026 | A check-in is reversed because it was done by mistake | Keys ended; any packet voided; audit shows both | P1 | specified | — |
| EC-ACS-027 | Day Close finds a departed stay with an outstanding card | Warning and a handover item until resolved (collected, expired or written off) | P0 | specified | — |
| EC-ACS-028 | A guesthouse guest leaves without returning the mechanical key | Owner exception; lock-change work order suggested; optional charge | P0 | specified | — |
| EC-ACS-029 | Door audit trail requested for a theft complaint | Requires `access.auditTrail.read` ⚑ and a reason; results labelled `external`; attached to the incident only by explicit action | P1 | specified | — |
| EC-ACS-030 | A group of 60 rooms arrives together and encoding is slow | Keys pre-encoded ahead of arrival for assigned rooms; packets tracked to hand-over | P1 | specified | — |
| EC-ACS-031 | A pilot property's scope excludes `doorKeys` | Key issuance stays manual (logged) even in a live organization | P0 | specified | — |
| EC-ACS-032 | A support export or log would include a PIN or card UID | Never present: hashed references only (ACC-I06) | P0 | specified | — |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Cloudbeds — How to connect Salto Space][cb-salto] (search-located)
- [Infor — Next generation of Hospitality Management Solution (press)][infor-hms] (search-located)
- [Mews — Mews Digital Key][mews-dkey] (search-located)
- [OPERA Cloud 26.3 — Assigning Tasks to a Role][op-roletasks] (opened)
- [OPERA Cloud 26.3 — Configuring Property Interface (rights, postings, room status, encoder workstations)][op-pifc] (opened)
- [OPERA Cloud 26.3 — Creating (Encoding) Room Keys for Block Reservations][op-keyblock] (opened)
- [OPERA Cloud 26.3 — Enhanced Room Key Generation][op-keyenh] (opened)
- [OPERA Cloud 26.3 — Key Packet Labels][op-keypacket] (opened)
- [OPERA Cloud 26.3 — Managing Room Keys][op-keycreate] (opened)
- [OPERA Cloud 26.3 — Outbound System Types (CRM lookup, address/phone/email validation, room key encoding, profile residency)][op-outbound] (opened)
- [OPERA Cloud 26.3 — Property Interfaces — Managing Keys (Door Lock System)][op-keys] (opened)
- [OPERA Cloud 26.3 — Viewing Property Interface Logs][op-ifclogs] (opened)
- [Salto — Salto Space operator guide — hotel][salto-hotel] (search-located)
- [Seam — ASSA ABLOY Vostio integration guide][seam-vostio] (search-located)
- [Stayntouch — Direct Key Integrations guide][snt-directkeys] (search-located)
- [Stayntouch — Guest Kiosk Pick-Up Keys Settings][snt-kioskkeys] (search-located)
- [Stayntouch — Guest Mobility: contactless check-in/out][snt-mobility] (search-located)
- [Stayntouch — SALTO Direct Key Integration][snt-salto] (search-located)

[cb-salto]: https://myfrontdesk.cloudbeds.com/hc/en-us/articles/37588053064731
[infor-hms]: https://www.infor.com/news/infor-next-gen-hospitality-management
[mews-dkey]: https://www.mews.com/en/products/marketplace/mews-digital-key
[op-ifclogs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_viewing_property_interface_logs.htm
[op-keyblock]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_blocks_creating_room_keys_for_block_reservations.htm
[op-keycreate]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_creating_keys_from_the_property_interface_control_screen.htm
[op-keyenh]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_enhanced_room_key_generation.htm
[op-keypacket]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_front_desk_workspace_key_packet_labels.htm
[op-keys]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_about_managing_keys.htm
[op-outbound]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_toolbox_outbound_system_types_and_respective_configurations.htm
[op-pifc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_property_interfaces.htm
[op-roletasks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm
[salto-hotel]: https://support.saltosystems.com/space/user-guide/operator/hotel/introduction/
[seam-vostio]: https://docs.seam.co/device-and-system-integration-guides/assa-abloy-vostio-access-control-system
[snt-directkeys]: https://stayntouch.freshdesk.com/support/solutions/articles/24000018938-direct-key-integrations-rover-guide
[snt-kioskkeys]: https://stayntouch.freshdesk.com/support/solutions/articles/24000075627-stayntouch-guest-kiosk-pick-up-keys-settings
[snt-mobility]: https://stayntouch.freshdesk.com/support/solutions/articles/24000055126-stayntouch-guest-mobility-your-tool-for-a-contactless-check-in-out-experience
[snt-salto]: https://stayntouch.freshdesk.com/support/solutions/articles/24000090574-salto-direct-key-integration
