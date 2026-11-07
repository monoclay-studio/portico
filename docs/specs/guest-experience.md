# Spec: guest-experience

Status: Draft v1 · 2026-11-07 · Proposed by the guest-journey audit (`docs/journey/`) · Wave 3 (portal core) /
Wave 4 (kiosk, digital ordering) · Schema `guest_experience` · Prefix `GXP` · App: `apps/guest`
Entitlements (proposed, SCR-03): `guest.portal` (all editions — pre-arrival, requests, folio, express checkout),
`guest.onlineCheckIn` (all editions), `guest.upsells` (all editions), `guest.kiosk` (Professional+ add-on),
`access.mobileKeys` (add-on, from `access`).

## 1. Purpose

Give every guest one web page — no app to install, works on a weak island connection — that carries the whole stay:
what was booked and what it costs, what still needs doing before arrival, the itinerary, requests with their real
status, the bill as it grows, the key, and a two-minute checkout. Collect information **once** (brief §7: "Guests
should not repeatedly enter information already available") and hand it to the department that needs it. Tell the
guest the truth with the same discipline staff get: *requested* is not *confirmed*, *submitted* is not *paid*, a
pending item is labelled pending.

`guest-experience` owns the guest-facing surface and its own small state (access links, online check-in
submissions, upsell catalogue, kiosk devices). Every consequence — a booking change, a payment, a task, a key, a
posting — is executed by the owning module through its normal command, preview, idempotency and audit.

## 2. Scope and non-goals

**In scope:** guest access links and step-up verification, booking summary and policies, manage-my-booking within
policy, arrival and transfer details (incl. passport-exact names and seaplane weights), entry-requirement checklist
(e.g. IMUGA), preferences and structured requests, payments (deposits, balance, incidental authorization), online
check-in (registration card per market, document capture, e-signature, emergency contact), staff review of
submissions, upsell catalogue and offers, leisure quote acceptance, itinerary, in-stay requests and chat, digital
folio and entitlement balances, property information (Wi-Fi, guide, house rules, emergency numbers), mobile key and
PIN display, dining/activity self-booking, express checkout, e-folio/invoice download and buyer details, folio
queries, post-stay page (survey link, invoice, lost-item claim, rebook), kiosk and assisted tablet modes.

**Non-goals:** the direct booking engine (`distribution` DST-R16 — shares `apps/guest` and design system),
conversation storage and delivery (`comms`), survey definitions and review requests (`crm`), task execution
(`operations`, `guest-services`), payment execution (`payments`), key issuance (`access`), itinerary data
(`resort`), native mobile apps (LATER, only if web cannot meet a need such as wallet keys), guest accounts with
passwords (LATER — magic links first).

## 3. Capabilities

### 3.1 Access, identity and the guest surface

- **GXP-R01** [MUST] **Stay-scoped links**: every booking and each staying adult can receive a link carrying a
  signed, expiring token (scope: booking or stay; role: booker or occupant; purpose; `linkVersion`) produced by the
  shared signed-link library (SCR-30) so `comms` can render links without calling this module. Revocation: bumping
  the stay's `linkVersion` (on cancellation, on request, after checkout + `guest.link.postStayDays`, default 30).
- **GXP-R02** [MUST] **Step-up verification** before sensitive actions (viewing the folio, paying, uploading a
  document, receiving a key or PIN, changing contact details): one-time code to a verified contact point of that
  booking (email or WhatsApp/SMS via comms) or booking code + surname + arrival date; rate-limited; failures audited.
  A forwarded link alone never reveals another occupant's personal data or documents.
- **GXP-R03** [MUST] **Who sees what**: the booker sees the booking and payment status; each occupant sees and edits
  their own registration data; the payer sees their folio(s) only; children's data is edited by an adult occupant
  of the same stay; agency- or company-paid amounts are hidden from guests unless policy
  `guest.portal.showAgencyAmounts` allows (net rates are commercial secrets — contracting).
- **GXP-R04** [MUST] **Usable everywhere**: WCAG 2.2 AA; languages of the property plus guest language (incl.
  Chinese, Russian, Italian, German, Arabic with RTL — ux-principles §13–14); a page weight budget (target ≤ 300 KB
  first load on 3G) and offline caching of itinerary, key card and property info once loaded; time shown in property
  local time with the zone named.

### 3.2 Pre-arrival

- **GXP-R05** [MUST] **Booking summary** with the same vocabulary as staff screens: booking and stay status, dates,
  unit type, occupants, inclusions, policies rendered from the terms snapshot, payment schedule with each item's
  state (`scheduled`, `due`, `pending verification`, `paid` only on provider confirmation), request statuses
  (`requested`, `confirmed`, `declined`, `done`) and what the hotel still needs from the guest (checklist).
- **GXP-R06** [MUST] **Manage my booking** (SCR-15): the property's policy lists guest-permitted changes (add or
  remove nights, change occupancy, add extras, change arrival details, cancel) and for each whether it is
  **instant** (executed through `reservations.previewChange/commitChange` showing the guest-language preview with
  price, taxes and penalty) or **a request** (creates a reservations task for staff). Channel-owned bookings show
  "Change this with <channel>" for channel-owned fields (RES-R14). Tour-operator bookings show "Contact your travel
  agent" for commercial changes (contracting).
- **GXP-R07** [MUST] **Arrival and transfer details**: international flight (validated format, date sanity), arrival
  time, transfer choice where offered; for seaplane/domestic-flight legs the passenger data the operator requires
  — names exactly as in passport, body weight and baggage weight when the operator requires them — collected per
  passenger with purpose text and deleted after the transfer per retention policy (SCR-37).
- **GXP-R08** [MUST] **Entry-requirement checklist** from the market content pack (SCR-30): for the Maldives,
  "Each traveller, including children, completes the free IMUGA Traveller Declaration on the official
  Immigration portal within 96 hours before arrival" with the official link only, the visa-on-arrival note
  (booking confirmation needed) and a downloadable confirmation document (JG-07). The guest may tick "done";
  Portico **never submits** declarations and never stores declaration contents (environment effect
  `government.submit` is not used).
- **GXP-R09** [MUST] **Preferences and requests**: structured categories (bed, pillow, dietary, allergy, accessibility,
  occasion, amenities, housekeeping time) mapped to `reservations` structured requests and `guests` preferences
  (SCR-10, SCR-21); allergy and health information is collected only with explicit consent text and marked
  sensitive; each request shows its live status as decided by the owning department.
- **GXP-R10** [MUST] **Payments**: pay deposits/balances and give incidental authorization via `payments` payment
  requests and hosted fields (PAY-R06, PAY-R19); outcomes shown exactly (`pending verification` stays pending);
  local gateway hosted pages where the property's acquirer requires them (Q2).

### 3.3 Online check-in

- **GXP-R11** [MUST] **Registration card per market** (`guest.registration.fields` policy, data-driven per
  country pack, Q43): per adult occupant — names (native script + Latin as in passport), nationality, document type
  and country, date of birth, address, emergency contact (SCR-21), optional travel insurance; children — name and
  date of birth (tax-relevant ages, JG-12); prefilled from what Portico already knows; nothing asked twice.
- **GXP-R12** [SHOULD] **Document capture**: photo of the passport data page with on-device MRZ reading (no image
  leaves the device unless policy `guests.document.storeImage` is on); optional ID-verification vendor through
  `integration` (dependency register 6.5); captured data lands in `guests` encrypted fields (GUE-R05) with
  `source = portal` and `verification = unverified | vendor_verified | staff_verified`.
- **GXP-R13** [MUST] **E-signature with evidence**: registration card, house rules, policies (cancellation, damage,
  incidental authorization, mobile-key terms) signed by drawn or typed signature; stored evidence = rendered document
  version, signature, timestamp, IP/device summary, link principal — reusable as dispute evidence (PAY-R18).
- **GXP-R14** [MUST] **Submission → desk**: a completed online check-in becomes a `pre_checkin` record attached to
  the stay; the desk checklist (RES-R24) imports completed steps (`registration`, `documents`, `guarantee`) as `done
  (guest, pending staff review)`; staff with `guestExperience.checkin.review` accept or return items with a reason
  shown to the guest. Policy decides whether staff review is mandatory before keys are released.
- **GXP-R15** [SHOULD] **Self check-in** (guesthouses, apartments, late arrivals; `access` ACC-R15): when the release
  conditions pass, the portal shows unit number, directions, PIN or mobile key and emergency contact; otherwise it
  says exactly what is missing.

### 3.4 Upsells, offers and quotes

- **GXP-R16** [MUST] **Upsell catalogue** (`guest.upsells`): items of kind `upgrade` (unit-type ladder, price per night
  difference via `rates.priceChange`), `early_check_in`, `late_check_out`, `transfer` (e.g. private seaplane or
  speedboat upgrade), `package`, `experience` (resort activity), `amenity`/`celebration` (guest-services amenity
  order), `custom`; each with eligibility (stay dates, unit types, rate plans/markets, channel — e.g. exclude
  tour-operator bookings if the contract forbids), availability/capacity check through the owning module, price
  and tax display through `rates.computeTaxes`, time windows (pre-arrival from T−n, at check-in, in-stay), and
  images/text per language.
- **GXP-R17** [MUST] **Acceptance modes**: `instant` (executed as a previewed change in the owning module and posted
  per policy), `on_request` (staff confirm within a target time; the guest sees *requested* until then),
  `pay_now` (payment request first). Every acceptance stores guest consent evidence. Upsell revenue is attributed
  (source `guest_portal`, offer id) for analytics.
- **GXP-R18** [SHOULD] **Leisure quote acceptance** (SCR-11): a quote created by reservations staff renders as a page
  with options, inclusions, policies, hold expiry and an "Accept and pay" action that converts the hold through the
  normal booking command; expired quotes say so and offer to contact the hotel.

### 3.5 In-stay

- **GXP-R19** [SHOULD] **Itinerary** from `resort` (RST-R11) and `guest-services` venue reservations: confirmed
  versus requested items distinguished; delays and weather changes shown as they are flagged (S12).
- **GXP-R20** [MUST] **Requests and chat**: request templates (towels, maintenance, buggy, amenities) create
  service requests via `operations`/`guest-services` and show their real task status (OPS-I03); chat is a `comms`
  conversation on channel `portal`, with department routing, translation and quiet-hours rules unchanged.
- **GXP-R21** [MUST] **Digital folio**: the payer's folios with postings grouped as staff see them (packages with
  breakdown), pending-verification items labelled, allowance and entitlement balances (FIN-R21, RST-R03), and the
  provenance `external` when charges are mirrored from another PMS.
- **GXP-R22** [MUST] **Property information**: guide, outlets and hours, Wi-Fi credentials (`guest-services`
  GSV-R33), house rules and local customs, emergency numbers and what to do in an emergency, clinic hours; content
  from the property content catalogue (SCR-38).
- **GXP-R23** [SHOULD] **Mobile key and PIN** card from `access` (status as reported by the credential service).
- **GXP-R24** [SHOULD] **Self-booking** of dining slots (`guest-services`) and activities (`resort`) with
  eligibility, waivers (e-signed per participant) and charges per normal rules.
- **GXP-R25** [LATER] **Digital ordering** (in-villa dining menu → POS order via integration, BOH).

### 3.6 Departure and after the stay

- **GXP-R26** [MUST] **Express checkout**: available from `guest.expressCheckout.opensAt` (e.g. 18:00 the evening
  before); shows final folio(s) with pending charges warning (RES-R27 `charges`), lets the payer settle with card on
  file or a new card, confirms luggage pick-up time and departure transfer, asks for buyer details for the invoice
  (company name, address, TIN — MIRA buyer TIN where applicable); the stay is checked out by the desk or by an
  automation when policy allows (`reservations.checkOut` with initiator `guest_portal`), never by the portal
  assuming success.
- **GXP-R27** [MUST] **E-folio and invoice**: download of issued fiscal documents and receipts (finance, SCR-24),
  delivery status shown; re-download for `guest.link.postStayDays`.
- **GXP-R28** [MUST] **Folio queries**: the guest marks a line "I don't recognise this" with a note; this opens a
  folio query (a `guest-services` case of kind `folio_query`) visible to the desk before settlement; the line shows
  *queried* until staff resolve it (adjustment through FIN-R10 or explanation).
- **GXP-R29** [SHOULD] **Post-stay page**: survey (`crm`), invoices, lost-item claim (creates an `operations` lost &
  found enquiry with shipping address and consent to pay shipping — SCR-32), rebook link to the booking engine.

### 3.7 Kiosk and assisted tablet mode

- **GXP-R30** [SHOULD] **Kiosk** (`guest.kiosk`): lobby device in kiosk mode — find booking (QR from confirmation,
  code, name + date), online check-in steps, document scan (camera or attached scanner), payment through a
  card-present terminal where the adapter supports it (PAY W-PAY-05, SCR-29), key encoding at an attached encoder
  (`access`), registration card print/email, walk-in sale (RES-R22 via the booking-engine quote), express checkout.
  Kiosk never shows another guest's data after a session ends (auto-reset, no back navigation into prior sessions).
- **GXP-R31** [MUST] **Assisted mode**: the same flows on a staff tablet (jetty, airport lounge, villa), with the
  staff member's identity on every action (IDN-R04 quick switch) and the guest signing on the device.
- **GXP-R32** [SHOULD] **Devices**: kiosk/tablet registration by QR pairing, bound encoder and terminal, health
  (last heartbeat, paper, encoder status), remote lock; device actions audited.

### 3.8 Truthfulness and safety

- **GXP-R33** [MUST] **Environment safety**: in demo, trial and training the portal shows the environment banner,
  payments and keys are simulated (`payment.charge`, `access.key`), messages land in the simulated outbox.
- **GXP-R34** [MUST] Every guest action that changes something calls the owning module's command with an
  idempotency key derived from the link principal and action (`gxp:{stayId}:{action}:{clientNonce}`); retries are
  harmless; failures show the module's plain-language reason and the recovery ("The upgrade is no longer available
  — the villa was just sold. Here are other options.").
- **GXP-R35** [MUST] **Privacy**: pages never cache sensitive data in shared caches; document images are never shown
  back to the guest after submission (only "received"); links in screenshots or forwarded messages expose only
  non-sensitive summary data without step-up (GXP-R02).

## 4. Entities and states

`guest_link(stay_id, booking_id, link_version, issued_count, last_used_at)` · `principal_session(id, stay_id,
role, verified_at?, method, expires_at)` · `pre_checkin(id, stay_id, occupant_ref, sections jsonb, status,
submitted_at?, reviewed_by?, review_notes?)` · `signature_evidence(id, stay_id, occupant_ref, document_kind,
document_version, signature_ref, signed_at, client_summary)` · `upsell_item(id, property_id, kind, eligibility jsonb,
pricing jsonb, mode, windows jsonb, content jsonb, status, version)` · `upsell_offer(id, item_id, stay_id, presented_at,
accepted_at?, outcome, owning_ref?)` · `kiosk_device(id, property_id, encoder_id?, terminal_ref?, status,
last_heartbeat_at)`.

**Pre-check-in:** `not_started → in_progress → submitted → accepted | returned` · `returned → submitted`.
**Upsell offer:** `presented → accepted → fulfilled | declined_by_hotel | failed` · `presented → expired`.
**Upsell item:** `draft → active ⇄ paused → retired`. **Kiosk device:** `pairing → active ⇄ locked → retired`.

## 5. Invariants

- **GXP-I01** No guest-facing page shows `paid`, `confirmed` or `done` unless the owning module's authoritative state
  says so.
- **GXP-I02** A principal can read only the booking/stay in its token scope and, for personal data, only its own
  occupant record (children excepted per GXP-R03).
- **GXP-I03** Document images, document numbers and PINs are never in URLs, logs, analytics events or caches.
- **GXP-I04** Each guest action produces at most one effect per idempotency key.
- **GXP-I05** In non-live environments no payment, key, message or vendor call reaches a real party.

## 6. Cross-module interactions

Top-level consumer (nothing calls it synchronously): `reservations` (summary, previews/commits, check-in step
import, check-out request), `guests` (profile and document fields, consent), `payments` (requests, hosted fields,
terminals), `finance` (folios, documents), `comms` (portal channel, OTP delivery), `operations` and
`guest-services` (requests, amenity orders, venue reservations, folio queries), `resort` (itinerary, activities,
waivers), `access` (mobile key/PIN status), `rates` (`computeTaxes`, `priceChange` for upgrades), `crm` (survey
links), `distribution` (booking engine shares the app; property content catalogue), `platform` (policies,
environment, entitlements), `identity` (staff identity in assisted/kiosk modes).

### Proposed contract changes (SCR-01)

1. Module row `guest-experience` (schema `guest_experience`), arrows to the modules above; no module depends on it.
2. Shared `packages/guest-links` (or within `packages/http`): `signGuestLink({ stayId, scope, role, purpose,
   linkVersion, expiresAt })` / `verifyGuestLink(token)` so `comms` renders links without calling this module.
3. `reservations.importPreCheckIn(tx, { stayId, steps })` and `reservations.requestCheckOut(tx, { stayId,
   initiator })` (SCR-13, SCR-15).

## 7. Events

Emitted: `guestExperience.preCheckIn.submitted|accepted|returned`, `guestExperience.upsell.accepted|fulfilled`,
`guestExperience.expressCheckout.requested`, `guestExperience.folioQuery.raised`, `guestExperience.kiosk.offline`.
Consumed: `reservations.booking.confirmed|modified|cancelled` (links, checklist), `reservations.stay.checkedIn|
checkedOut`, `payments.request.paid|expired`, `operations.serviceRequest.completed`, `access.credential.issued|ended`,
`finance.invoice.issued`, `resort.itinerary.flagged`.

## 8. Permissions

Staff: `guestExperience.config.manage` ⚑ (portal content, fields, policies) · `guestExperience.checkin.review` ·
`guestExperience.upsell.manage` · `guestExperience.upsell.fulfil` · `guestExperience.kiosk.manage` ⚑ ·
`guestExperience.link.revoke`. Guest principals are not staff users (SCR-44): their abilities derive from token
scope and role, checked server-side on every call.

## 9. UX surfaces

Guest: Stay home (checklist, countdown, transfer, weather note), Booking & payments, Arrival details, Check-in
wizard (per occupant, resumable), Requests, Itinerary, Folio, Info & Wi-Fi, Key, Express checkout, After your stay.
Staff: pre-check-in review queue (with document "verified by" chips), upsell catalogue and performance, kiosk devices,
portal preview in any language ("see what the guest sees"). Follows `docs/product/ux-principles.md` §3 trust markers
in guest-appropriate wording.

## 10. Proof scenarios and evidence

| ID | Guest experience must demonstrate |
|---|---|
| S05 (supporting) | Portal payment times out: the guest sees "We are confirming your payment" (pending), cannot pay twice, and sees "Paid" only after reconciliation. |
| S12 (supporting) | Seaplane delay: one message, itinerary shows shifted times with *requested/confirmed* labels. |
| S19 (supporting) | Guest folio matches staff folio to the minor unit, packages grouped, allowance balance shown. |
| A01 | Trial: portal flows run with simulated payments/keys/messages and the environment banner. |
| J01 (proposed, SCR-06) | Online check-in for a family of four: two adults sign, children's ages verified, seaplane manifest receives passport names, desk imports steps; nothing re-asked at the jetty. |
| J02 (proposed) | Upgrade upsell accepted while the last Water Villa sells at the desk: one succeeds; the guest gets "no longer available" with alternatives. |
| J03 (proposed) | Express checkout with a queried minibar line: query resolved by adjustment, invoice issued within the deadline, e-folio delivered. |

## 11. Maldives specifics

IMUGA guidance and visa-on-arrival confirmation are part of the pre-arrival checklist [V-web, journey coverage §1.4];
seaplane manifests need passport names and weights; arrival flights decide seaplane vs transit night (resort
SCR-34); low-bandwidth design for islands; WhatsApp is the expected delivery channel for links [A]; buyer TIN
on invoices for B2B guests and DMCs (MIRA, `docs/readiness/maldives-tax-rules.md` §4).

## 12. Competitive inspirations

- App-less guest portal with registration, payment, messaging, ID capture and e-signature; kiosk that cuts keys and
  sells upsells — Mews Guest Journey and Kiosk (research 02 §2.2, §8 item 12).
- Upsell at every self-service touchpoint with algorithmic pricing and priority cleaning for early check-in —
  Stayntouch (research 02 §4.3); built-in upsell for small hotels — RoomRaccoon (research 03 §5); guest self-service
  portal, kiosk, keyless entry — Clock PMS+ (research 03 §8.4).
- Itinerary-centred guest app — Agilysys (research 01 §6.2).
- Improvement: request and payment states shown to guests with staff-grade truthfulness; nothing re-asked.

## 13. Open questions

Q43 (registration fields and document storage), Q2 (local gateways for portal payments), Q84 (guest-facing AI in
portal chat). Product decisions: magic links before accounts; staff review of online check-in optional by policy;
express checkout opens the evening before by default.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **conditional (P1 for adoption)** — a guest portal next to an
  existing PMS is a common "replace selected capabilities" purchase. Requires mirrored bookings/stays and profiles
  (`reservations: read` + receive changes, `guestProfiles: read`).
- **Hard dependencies:** `platform`, `identity`, `reservations` (mirror or authoritative), `guests`, `comms`.
  Payments, folio, keys, upsell posting each depend on their module's authority.
- **Connected mode:** registration data is stored in Portico and **forwarded** to the PMS profile where the connector
  supports `guestProfiles: update` (pending until acknowledged), else labelled "Portico only — re-key into <PMS>";
  check-in remains a PMS action (the portal sets a "pre-checked-in" flag forwarded as a note/trace where supported);
  folio view uses mirrored balances (`external`, last-sync time) and hides line detail the PMS does not provide;
  payments only through Portico `payments` with forwarding to the external folio (SM-09 conditions); upsells that
  change the booking are **requests** (forwarded or staff-actioned), never instant.
- **Data-authority domains:** owns none; respects all; online check-in data follows `guestProfiles` authority.
- **Trial:** portal previews on copied stays with all effects simulated; no real guest receives a link.
