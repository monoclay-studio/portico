# Spec: access

Status: Draft v1 · 2026-11-07 · Proposed by the guest-journey audit (`docs/journey/`) · Wave 2 (manual key log and
key rules, with the lock simulator) / Wave 3 (lock-system connectors) · Schema `access` · Prefix `ACC`
Entitlements (proposed, SCR-03): `access.keys` (all editions — manual key log, mechanical keys, key rules),
`integration.locks` (Professional+ — lock-system connectors and encoders), `access.mobileKeys` (add-on — mobile,
wallet and PIN credentials), `access.commonAreas` (Resort, Enterprise).

## 1. Purpose

Getting into the room is the one thing a guest cannot do without, and a key that still opens a door after the
guest has left is the one thing a hotel cannot afford. `access` makes keys part of the stay: every credential —
plastic card, wristband, phone key, wallet key, keypad code or brass key — is issued for a known stay, unit, person
and validity window, changes when the stay changes (room move, extension, late checkout, early departure), and
ends when the stay ends. It tells the truth about what the lock system actually did: a key is **issued** only when
the lock system confirms it, a timeout is **pending verification**, and an offline lock that cannot be cancelled
remotely is shown as "valid until 12:00 tomorrow — collect the cards", never as "deactivated".

Portico does not replace the lock system. The lock vendor's software remains the authority over its credential
database and door hardware; Portico is the system that decides *who should have which key for how long* and asks
the lock system to make it so — or records what staff did by hand when the lock system cannot be reached.

## 2. Scope and non-goals

**In scope:** credential kinds, lock-system connections (via `integration`) and their integration models, key
encoders and their locations, unit ↔ lock mapping, key lifecycle bound to stays (issue, additional/duplicate,
extend, re-key on room move, end at checkout/early departure/no-show/cancellation), pre-encoded key packets for
remote check-in (jetty, airport, villa), mobile and wallet keys, PIN/keypad codes for self check-in, mechanical-key
register, manual key log when keys are made outside Portico, lost/stolen key handling and charges, common-area
access groups by entitlement, door audit-trail retrieval for incidents and disputes, key exceptions for the desk,
handover and Day Close, environment safety, audit.

**Non-goals:** staff credentials, master keys, lock programming, lock firmware and battery maintenance (the lock
system and `operations` assets own these — Portico only records maintenance work orders); physical security
operations (CCTV, patrols — `guest-services` incident log records references only); building access control for
back-of-house areas; replacing the lock vendor's software as the system of record for credentials; card-printing
design.

## 3. Capabilities

### 3.1 Credentials, lock systems and encoders

- **ACC-R01** [MUST] **Credential** (proposed glossary term): kind ∈ `card` (RFID), `wristband` (RFID), `mobile`
  (vendor app or Portico guest portal using the vendor's mobile SDK), `wallet` (Apple/Google wallet pass via the
  vendor's credential service), `pin` (keypad code), `mechanical` (numbered physical key); holder (occupant
  profile, optional), stay, units (one or more — connecting rooms, composite units), access groups, `valid_from`,
  `valid_to` (property local time), sequence number for the stay, issuing source (`portico_connector`,
  `manual_lock_system`, `mechanical_register`), lock-system reference, status (§4), provenance.
- **ACC-R02** [MUST] **Lock-system connection** = an `integration` connection with workflows (SCR-07):
  `doorKeys` (issue/duplicate/extend/cancel/read status), `keyEncoders` (list encoders and their state),
  `doorAuditTrail` (read door events, permissioned), `mobileCredentials`, `pinCodes`. The connector declares its
  **integration model** and **capabilities** per workflow (supported / limited / unsupported / unverified), shown
  in the catalogue and before activation:
  1. *Cloud API* — lock vendor's cloud service reachable from Portico (e.g. ASSA ABLOY Vostio is cloud-hosted and
     integrates with a PMS through an API [V-web, journey coverage §1.4]).
  2. *On-premise server through the local connector* — the lock server sits on the hotel LAN and exposes a PMS
     interface over TCP/IP, web services or serial (e.g. Salto Space PMS interface, dormakaba Ambiance PMS
     interface, ASSA ABLOY Visionline with a converter [V-web]); requires the Portico Local Connector
     (`docs/adoption/rollout-requirements.md` §5) and, where the protocol is vendor-owned, a licence (Q62).
  3. *Credential service* — mobile/wallet credentials issued by the vendor's credential service on behalf of the
     lock system (wallet keys need the vendor's credential-manager partner and compatible reader hardware [V-web]).
  4. *Smart-lock API* — keypad/BLE locks common in apartments and small properties, directly or via an aggregator.
  5. *Manual* — no connection: staff use the lock vendor's own workstation and record the result (ACC-R16).
- **ACC-R03** [MUST] **Capability truth table** per connection (examples of capabilities: `remoteCancel`,
  `encodeNewGuest` (invalidates previous guests' cards at first use), `joinerKey`, `extendWithoutReencode`,
  `preEncodeWithFutureStart`, `mobileKeys`, `walletKeys`, `pinCodes`, `auditTrail`, `encoderStatus`). Every key
  action that depends on a capability is offered only if the connection declares it, and every screen that ends a
  credential states **how** it ends: `cancelled at lock system`, `expires at <time>`, `invalidated when next guest's
  key is first used`, or `cannot be ended remotely — collect`.
- **ACC-R04** [MUST] **Encoders**: id, connection, location (front desk 1, jetty kiosk, airport lounge), status (from
  `keyEncoders` where supported, else last successful use); each workstation/tablet/kiosk has a default encoder and
  may switch; an encode request names the encoder; encoders unreachable for > 2 min appear on the arrivals board and
  in integration health.
- **ACC-R05** [MUST] **Unit ↔ lock mapping** (`integration` mapping kind `lockDoor`, financially neutral but
  safety-relevant → review required): every sellable unit maps to one or more lock doors (entrance, connecting door,
  private pool gate) and to the lock system's room identifier; activation of a lock connection is blocked while a
  sellable unit is unmapped ("Villa 214 has no door in Visionline — keys cannot be issued").

### 3.2 Key lifecycle bound to the stay

- **ACC-R06** [MUST] **Issue at check-in** (RES-R24 `access` step through `AccessPort.issueKeys`): number of
  credentials (policy default by occupancy, e.g. one per adult, max per unit), kinds, holder per credential (optional),
  validity `valid_from = now` (or the pre-encoded start) and `valid_to = departure date at the property checkout
  time + policy grace` (`access.validity.graceMinutes`, default 60), in property local time. The step is `done` only
  when every requested credential is `issued`; partial success is shown per credential.
- **ACC-R07** [MUST] **Additional and duplicate keys**: an additional key for an in-house stay requires
  `access.key.duplicate` and an **identity check** recorded with the request (`id_document_seen`, `photo_match`,
  `known_to_staff`, `portal_verified`) — policy `access.duplicate.requireIdentityCheck` (default on); requests for a
  unit from someone who is not an occupant are refused with the reason. A lost-key report (ACC-R12) may accompany it.
- **ACC-R08** [MUST] **Extension, late checkout, early check-in**: `reservations.stay.extended`, approved late
  checkout (RES-R18) and shortened stays change `valid_to`. If the connection supports `extendWithoutReencode`
  Portico extends remotely; otherwise the stay gets a **re-encode task** ("Bring cards to the desk or send new
  mobile key") visible on the in-house list and in handover. A guest is never locked out silently: keys due to expire
  within `access.expiryWarningMinutes` (default 120) while the stay is still in house appear as an exception.
- **ACC-R09** [MUST] **Room move** (RES-R17): new credentials for the new unit (issued like ACC-R06); credentials
  for the old unit end per ACC-R03 (remote cancel where supported; otherwise `valid_to` set to now if the lock system
  can shorten validity on the next encode; otherwise a **collect-cards task** with owner). The move is not shown as
  complete until the new keys are issued or the `access` step is skipped with permission and reason.
- **ACC-R10** [MUST] **End of stay** (checkout, early departure, no-show, cancellation, reverse check-in):
  RES-R27 `access` step calls `AccessPort.endKeys`. Outcome per credential: `cancelled` (confirmed by the lock
  system), `expires_at` (time shown), `collected` (staff ticks returned cards; a card return box count may be
  entered), or `outstanding` (exception with owner). A departed stay with an `outstanding` credential or one valid
  beyond departure + grace is a Day Close **warning** (SCR-41) and a handover item until resolved.
- **ACC-R11** [MUST] **Pre-encoded key packets** for remote check-in (jetty, airport lounge, villa): for arrivals
  with an assigned unit, staff may encode keys ahead of arrival when the connection supports
  `preEncodeWithFutureStart` (validity starts at the planned check-in time or on activation) — otherwise keys are
  encoded at a mobile encoder at check-in. Packets carry the stay code and unit, are tracked (`prepared →
  handed_over | voided`), and are **voided** automatically on room re-assignment, cancellation or no-show (with a
  collect task for the physical packet). A packet is never handed over for a stay that is not `in_house`.
- **ACC-R12** [MUST] **Lost or stolen keys**: report (who, when, which credential), immediate end of that credential
  where possible (ACC-R03), replacement per ACC-R07, optional lost-key charge (charge code with policy amount,
  posted through `finance.postCharge` with key `lostkey:{credentialId}`), incident reference if theft is suspected
  (`guest-services` incident log).

### 3.3 Mobile, wallet and PIN credentials

- **ACC-R13** [SHOULD] **Mobile keys** (`access.mobileKeys`): offered only when the connection declares
  `mobileKeys`; delivered after check-in (online or at the desk) through the guest portal or the vendor's app;
  requires the guest's acceptance of terms and device consent; revocation and expiry follow ACC-R08–R10; the portal
  shows key status exactly as the credential service reports it (`ready`, `installed`, `revoked`), never "active"
  on assumption. Phone keys must keep working offline at the door (BLE) — connectivity is needed only to install.
- **ACC-R14** [LATER] **Wallet keys**: where the vendor's credential service and the property's readers support
  them [V-web: vendor and reader-generation dependent]; same lifecycle; a property lists the device requirements
  before offering them.
- **ACC-R15** [SHOULD] **PIN codes and self check-in** (guesthouses, apartments, late arrivals): codes generated by
  the lock/smart-lock system or Portico (per connector), valid for the stay window, released to the guest only
  when **release conditions** pass (policy: guarantee satisfied or prepaid, online check-in completed, identity
  verified if required) via the portal and a message (comms `message.guest`); never sent in plain text in a
  marketing or bulk message; rotated on move/extension; the code itself is stored encrypted and shown to staff only
  with permission. Lockbox codes (no lock integration) are handled as `pin` credentials with `issuing source =
  manual` and a rotation reminder.

### 3.4 Manual and mechanical keys

- **ACC-R16** [MUST] **Manual key log** — the P0 path for every pilot without a live lock connection, and the
  fallback when a connection or encoder fails: staff encode in the lock vendor's software and record in Portico
  "key issued outside Portico" (count, kinds, validity entered or defaulted, encoder/workstation name, staff); the
  check-in `access` step becomes `done (manual)` with provenance `external`. End-of-stay uses the same outcomes as
  ACC-R10. Satisfies rollout acceptance test RO-08 (`docs/adoption/rollout-requirements.md` §7).
- **ACC-R17** [MUST] **Mechanical-key register** (guesthouse default): keys per unit with numbers/tags and spares;
  issue and return per stay; status `in_drawer | issued | lost | retired`; a departed stay with an un-returned key is
  an owner exception; lost key → lock-change work order suggestion (`operations`) and optional charge (ACC-R12).

### 3.5 Safety, audit and failure behaviour

- **ACC-R18** [MUST] **Environment safety**: every outbound lock operation calls
  `assertExternalEffectAllowed(ctx, 'access.key')` (effect exists, PLT-R04). Demo, trial and training route to the
  **lock simulator** (deterministic: success, timeout-then-success, encoder offline, lock system rejects, remote
  cancel unsupported); sandbox routes to a vendor test system; results carry provenance `simulated` / `sandbox`. In a
  `pilot` property, key issuance is live only if the pilot scope includes `doorKeys` (PLT-R14).
- **ACC-R19** [MUST] **Key operations are idempotent and truthful**: each request is a persisted key operation with
  an idempotency key `key:{stayId}:{operation}:{seq}` committed **before** the call (ADR-0007 pattern); outcomes
  `confirmed`, `failed` (vendor reason translated), `pending_verification` (timeout or ambiguous reply). A pending
  operation blocks a repeat for the same credential with an explanation and a "check now" that reads status from the
  lock system where supported; otherwise staff confirm what the encoder did (card works / does not) and the answer is
  recorded as staff-verified.
- **ACC-R20** [MUST] **Audit**: every credential state change and key operation writes an audit row (actor, device,
  encoder, stay, unit, credential kind, validity before/after, reason, identity-check method for duplicates).
  Audit rows never contain PIN values, mobile credential secrets or card UIDs in clear (hashed reference only).
- **ACC-R21** [SHOULD] **Door audit trail retrieval** (`doorAuditTrail` workflow, where the lock system exposes it):
  read door events for a unit and time window for an incident, dispute or welfare check; requires
  `access.auditTrail.read` ⚑ and a recorded reason; results are shown with provenance `external`, attached to the
  incident or dispute evidence pack (PAY-R18) only by explicit action, and are personal data under retention
  policy.
- **ACC-R22** [MUST] **Outage behaviour**: when a lock connection, local connector or encoder is unavailable, the
  check-in step offers "Encode in the lock system" with ACC-R16 recording; the arrivals board shows a banner with
  since-when and impact; on recovery, **no queued key operation is replayed** without re-validation (stay still in
  house? unit unchanged? credential still needed?) — INT-R19. Emergency access (master keys) stays a hotel SOP outside
  Portico, referenced in the continuity procedures.
- **ACC-R23** [MUST] **Exceptions** (common shape) contributed to Day Close, handover and the front-desk
  workspace: credentials outstanding after departure, keys expiring while in house, re-encode tasks open, pending
  verification operations, unmapped doors, encoders offline, pre-encoded packets not handed over or voided.

### 3.6 Common areas

- **ACC-R24** [LATER] **Access groups** (`access.commonAreas`): named areas (club lounge, gym, adults-only pool, spa
  wet area) mapped to lock doors; entitlement from rate plan, package, recognition tier or a purchased upsell;
  credentials carry the groups for their validity; changes in entitlement re-issue or extend per ACC-R08.

## 4. Entities and states

`lock_connection_profile(connection_id, model, capabilities jsonb, validity_policy jsonb)` ·
`lock_door(id, connection_id, unit_id?, area?, external_ref)` · `encoder(id, connection_id, location, external_ref,
status, last_seen_at)` · `credential(id, property_id, stay_id, unit_ids uuid[], kind, holder_profile_id?,
access_groups text[], valid_from, valid_to, seq, issuing_source, lock_ref_hash?, status, provenance, version)` ·
`key_operation(id, credential_id?, stay_id, kind issue|duplicate|extend|reencode|cancel|read, idempotency_key UNIQUE,
encoder_id?, status, vendor_reason?, attempts, created_by, created_at, resolved_at?)` · `key_packet(id, stay_id,
credential_ids uuid[], status, prepared_by, handed_over_by?)` · `mechanical_key(id, unit_id, tag, status)` ·
`mechanical_key_issue(key_id, stay_id, issued_at, returned_at?)` · `lost_key_report(id, credential_id |
mechanical_key_id, reported_by, reported_at, charge_posting_id?, incident_ref?)` · `pin_secret(credential_id,
enc_payload)` · `access_group(id, name, door_ids uuid[])`.

**Credential:** `requested → issued` (lock system confirmed, or manual record) `→ active` (valid_from reached)
`→ ended` with `end_kind ∈ {cancelled, expired, collected, superseded}` · `requested → failed` ·
`requested → pending_verification → issued | failed` · `issued|active → lost` (then `ended` with cancellation
where possible) · `issued|active → outstanding` (end requested but not achievable or not confirmed) `→ ended`.
**Key operation:** `queued → sent → confirmed | failed | pending_verification` · `pending_verification → confirmed |
failed` (read-back or staff verification) · `queued → revalidating → queued | cancelled` (after outage).
**Key packet:** `prepared → handed_over` · `prepared → voided` (collect task until physically retrieved).
**Mechanical key:** `in_drawer ⇄ issued` · `issued → lost` · any → `retired`.

## 5. Invariants

- **ACC-I01** No credential is `issued`/`active` for a stay that is not `in_house`, except a pre-encoded packet
  whose validity starts at or after the planned check-in and which is `prepared`, never `handed_over`.
- **ACC-I02** A credential's `valid_to` never exceeds the stay's departure date at checkout time + grace, unless a
  late checkout approval or an override with `access.key.override` ⚑ and reason exists.
- **ACC-I03** After a stay is `departed`, every credential is `ended` or has an open exception (`outstanding`).
- **ACC-I04** A key operation is executed at most once per idempotency key; a `pending_verification` operation is
  never repeated without resolution.
- **ACC-I05** In non-live environments no key operation reaches a real lock system.
- **ACC-I06** PIN values and credential secrets never appear in logs, events, exports, audit payloads or AI context.
- **ACC-I07** Every sellable unit of a property with an active lock connection has a reviewed door mapping.

## 6. Cross-module interactions

Calls `integration` (connections, mappings, exchange log, exceptions, local connector), `inventory` (units, unit
types, composite units — read), `finance` (`postCharge` for lost-key charges), `operations` (`createTask` for
collect/re-encode tasks and lock-change work-order suggestions), `platform` (policies, environment, pilot scope).
Called by `reservations` through **`AccessPort`** (bound in the composition root) at check-in, room move,
extension/late checkout and check-out; by `guest-experience` (mobile key and PIN delivery status); by
`guest-services` (incident evidence: door trail). Consumes events instead of calling `reservations` (no cycle):
`reservations.stay.moved|extended|shortened|checkedOut|noShow|cancelled|reinstated`, `reservations.checkIn.*`.

### Proposed contract changes (domain map — SCR-01)

1. New module row `access` (schema `access`) and arrow `access ─► integration, inventory, finance, operations,
   platform`; `reservations ─► access (port)`; `guest-experience ─► access`.
2. `AccessPort` (declared in `reservations/src/ports.ts`):
   `issueKeys(tx, { stayId, unitIds, validFrom, validTo, count, kinds, holders?, encoderId?, idempotencyKey })`,
   `changeValidity(tx, { stayId, validTo, idempotencyKey })`, `rekeyForMove(tx, { stayId, fromUnitIds, toUnitIds,
   effectiveAt, idempotencyKey })`, `endKeys(tx, { stayId, reason, idempotencyKey })`,
   `recordManualIssue(tx, {...})`, `getKeyStatus(tx, { stayId })` → per-credential status and end mechanism.
3. `listExceptions(tx, { propertyId, businessDate })` in the common exception shape.

## 7. Events

Emitted: `access.credential.issued|failed|ended|lost`, `access.keyOperation.pendingVerification|resolved`,
`access.encoder.offline|restored`, `access.packet.voided`. Consumed: reservations stay events (above),
`integration.connection.statusChanged`, `platform.dataAuthority.changed` (connected mode, §14).

## 8. Permissions

`access.key.read` · `access.key.issue` · `access.key.duplicate` · `access.key.end` · `access.key.override` ⚑ (issue
outside stay rules or beyond validity) · `access.packet.manage` · `access.pin.reveal` ⚑ · `access.manualLog.record` ·
`access.mechanical.manage` · `access.lostKey.report` · `access.auditTrail.read` ⚑ · `access.encoder.manage` ·
`access.configuration.manage` ⚑ (validity policies, door mapping review; connection setup itself uses
`integration.connection.manage` ⚑).

## 9. UX surfaces

Check-in and check-out checklist `access` step (credential list with per-credential status chip and end mechanism
text; encoder picker; "Encode in the lock system" manual path), key panel on the stay record (who holds what, valid
until, how it ends), arrivals board encoder/connection banner, key packets list for tomorrow's seaplane arrivals,
mechanical-key board for guesthouses (drawer view), lost-key flow, door-trail viewer (permissioned, reason first),
exceptions in the front-desk workspace and handover. Guest-facing: mobile key and PIN card in the guest portal
(`guest-experience`). Copy example on checkout: "2 cards for Villa 214 cannot be cancelled remotely; they stop
working at 13:00 today. Collect them or note them as not returned."

## 10. Proof scenarios and evidence

| ID | Access must demonstrate |
|---|---|
| S03 (supporting) | Extension into a split stay: keys for 214 end at the original departure, keys for 216 are issued for the new nights; nothing lets the guest into 214 on Mr Chen's nights. |
| S05-style (supporting) | Encoder times out: operation `pending_verification`; second encode blocked with explanation; resolution by read-back or staff verification; the check-in step resumes without a duplicate credential. |
| S07 / S08 (supporting) | Re-assignment after a failed inspection or OOO voids a pre-encoded packet and issues keys for the new villa. |
| S20 (supporting) | Lock connector down during the arrivals rush: banner, manual path recorded, no replay on recovery without re-validation. |
| A01 | Trial: every key action is simulated; zero lock-system calls. |
| E15 | A key issued to the wrong stay is ended and re-issued; audit shows both. |
| J04 (proposed, SCR-06) | Room move at 22:00 with offline locks: new keys issued, old cards shown "valid until 13:00 tomorrow — collect", Day Close warning until collected. |
| J05 (proposed) | Duplicate-key request by a non-occupant is refused; by an occupant without identity check is blocked by policy. |

## 11. Maldives specifics

Resort check-in often happens on the jetty or in the villa after a seaplane landing, so pre-encoded packets and
mobile encoders matter; salt air and water villas make waterproof wristbands attractive [A]; guesthouses on
inhabited islands mostly use mechanical keys [A, coverage matrix §4] — the mechanical register is their key module;
island connectivity drops, so phone keys must work offline at the door and Portico must never block check-in on a
cloud round-trip (manual path always available). Which lock systems Maldivian resorts run is unconfirmed (Q64);
lock-vendor partner access is Q80.

## 12. Competitive inspirations

- Digital keys reachable from online check-in, messages, portal or kiosk; support for Vostio, Visionline and Salto
  Space — Mews Digital Key (research 02 §2.2; takeaway §8 item 12).
- Kiosk with key encoder, ID scan and payment in one flow — Stayntouch (research 02 §4.2); Clock PMS+ keyless entry
  in self-service (research 03 §8.4).
- Improvement: every competitor reviewed presents "key deactivated at checkout" as a single action; Portico states
  the actual end mechanism per lock capability (ACC-R03) because offline card locks generally cannot be cancelled
  remotely [DK].

## 13. Open questions

Q80 (lock-vendor partner programmes and licences), Q62 (local connector support and legacy protocol licensing),
Q64 (which lock systems target hotels use). Product decisions: default validity grace 60 min; duplicate keys
require an identity check by default; manual key log is always available.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **conditional** (P2) — offered for mobile keys and PIN self check-in
  next to an external PMS only when the PMS does **not** already issue keys to the same lock system, because two key
  issuers for one lock system recreate the dual-control problem (proposed coordination rule CR-11, SCR-05). Needs
  mirrored stays (`reservations: read` with receive-changes for moves, extensions and checkouts — a periodic-only
  feed is refused because keys would outlive a checkout by the polling interval).
- **Hard dependencies:** `platform`, `identity`, `inventory` (units), `integration` (connections, local connector),
  `reservations` (Portico-authoritative or mirrored stays), `finance` only for lost-key charges (forwarded as
  charges when `charges` is external).
- **Connected mode:** key validity follows mirrored stay dates with provenance `external`; check-out detection
  depends on the PMS feed's freshness — when the feed is `delayed`, Portico shows "checkout not yet received from
  <PMS>; key still valid" rather than assuming.
- **Data-authority domains:** owns none of the nine governed domains; **key validity is owned by the lock system**
  (source-of-truth matrix §2) — Portico is the requesting system. Respects `reservations`, `charges`.
- **Trial:** lock simulator only (`access.key` = simulate); copied stays can be used to rehearse check-in and room
  moves; nothing reaches the lock system.
