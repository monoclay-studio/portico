# Spec: contracting (tour operators, DMCs, wholesalers)

Status: Draft v1 · 2026-11-07 · Proposed by the guest-journey audit (`docs/journey/`) · Wave 2 (contracts, offers,
allotments, contract check, booking intake) / Wave 3 (statements, rate sheets, bedbank XML via hub) ·
Schema `contracting` · Prefix `CTR`
Entitlements (proposed, SCR-03): `contracting.contracts` (Professional, Resort, Enterprise; Essentials add-on for
guesthouses that sell through DMCs), `groups.allotments` (existing) for allotment compilation.

## 1. Purpose

A Maldivian resort typically earns most of its room nights through tour operators and DMCs on seasonal contracts
[A — confirm in discovery, Q64]: net or commissionable rates per market and meal plan, supplements, child policies,
allotments with release periods, early-bird, free-night and honeymoon offers with combinability rules, stop-sales,
emailed vouchers and monthly statements. Today this lives in spreadsheets and the reservations team re-computes
every voucher by hand. `contracting` turns a signed contract into **data Portico prices with**, so the booked price
is computed by the same quote engine as every other booking, the voucher a tour operator sends is checked
automatically against it, allotments release on time, stop-sales are notified with proof, and the month ends with a
statement both sides can reconcile.

`contracting` is an authoring, governance and settlement layer. It does **not** add a second pricing engine: an
approved contract **compiles** into `rates` objects (rate plans, prices, promotions, policies) and `groups`
allotments, all marked as managed by the contract.

## 2. Scope and non-goals

**In scope:** contract partners (agencies of kind tour operator, DMC, wholesaler, bedbank), contracts and versions,
seasons and periods, markets (source-market/residency eligibility), rate tables (net or commissionable) by unit
type, occupancy and meal plan, supplements and reductions (meal plan, transfers, festive and gala dinners,
single/extra adult/child/extra bed), child and occupancy policies, booking/cancellation/no-show/payment terms,
offers (early booking, long stay/free nights, honeymoon and occasions, last minute, special offers by addendum) with
combinability, application base and order, proof requirements, compilation into rates/groups with preview and
four-eyes approval, allotments (guaranteed, free sale, on request) and release, stop-sale and open-sale notices with
acknowledgement, tour-operator booking intake (voucher entry, rooming-list/file import, extranet transcription,
XML through the hub), **contract check**, name changes and amendments, voucher verification at arrival,
statements, commission vs net settlement, remittance reconciliation, production reports, rate-sheet export.

**Non-goals:** the quote engine and tax engine (`rates`), inventory arithmetic (`inventory`), booking state
(`reservations`), receivables ledger (`finance`), group sales (`groups` pipeline — MICE and weddings), OTA channel
transport (`distribution`), negotiation tooling and e-signature of the contract document itself (store the signed
PDF; LATER), demand-side tour-operator systems.

## 3. Capabilities

### 3.1 Contract structure

- **CTR-R01** [MUST] **Contract**: partner (company of kind `agency` with sub-kind `tour_operator | dmc |
  wholesaler | bedbank`, GUE-R07), properties covered (one or several of the organization), contract period (e.g.
  1 Nov – 31 Oct), currency (USD/EUR…; RAT-R07 for second currency), pricing model `net` or `commissionable`
  (commission % and base, RAT-R06), tax inclusion statement (e.g. "rates include service charge and TGST; Green Tax
  payable by the guest at the resort" — drives how prices are entered: inclusive prices are decomposed by RAT-R24),
  sales model per unit type (`allotment`, `free_sale`, `on_request`), signed document (file), contacts for
  reservations/stop-sales/accounts, status and version (§4).
- **CTR-R02** [MUST] **Seasons and periods**: named date ranges per contract (e.g. Peak 24 Dec–6 Jan, High,
  Shoulder, Low) — reusable across tables; validated to cover the contract period without gaps or overlaps per
  table; minimum stay per period (e.g. 7 nights over festive) and arrival/departure day rules.
- **CTR-R03** [MUST] **Rate tables**: per season × unit type × occupancy (base occupancy, single, extra adult, child
  bands per the contract's age bands) × base meal plan; net or gross amounts; validation that every sellable unit
  type and season has a value or an explicit "not contracted".
- **CTR-R04** [MUST] **Supplements and reductions**: meal-plan supplements per person per night (adult/child bands,
  e.g. HB/FB/AI over BB), compulsory supplements on dates (Christmas/New Year gala dinners per person, adults and
  children separately), transfer supplements per person per leg/return (seaplane, domestic flight + speedboat),
  extra-bed and single reductions/supplements, all as data with season applicability.
- **CTR-R05** [MUST] **Terms**: booking cut-off and release default, cancellation tiers and no-show per season,
  payment terms (`prepayment` before arrival by n days, `credit` n days after departure/invoice, deposit for
  guaranteed allotments), child policy (ages, max children, free child rules), occupancy limits, name-change rules,
  amendment rules (whether early-booking eligibility follows the original booking date).
- **CTR-R06** [MUST] **Markets**: the contract (or a rate table/offer) may be restricted to source markets (country
  groups by guest residency or nationality, as the contract defines); the restriction is checked at booking intake
  and at check-in (guest documents), mismatches become exceptions — never silent repricing.

### 3.2 Offers

- **CTR-R07** [MUST] **Offer types**: `early_booking` (book ≥ n days before arrival or by a fixed date; % off),
  `long_stay` / `free_nights` (stay x pay y; cheapest/last/first nights free; repeatable or not), `honeymoon` and
  occasions (benefits: % off, free upgrade, amenities, spa credit, dinner — monetary or non-monetary),
  `last_minute`, `special_offer` (ad-hoc addendum), `reduction_per_person` (e.g. third adult free); each with booking
  window, stay window (per-night applicability when stays straddle), markets, unit types, meal plans, minimum nights,
  blackout dates.
- **CTR-R08** [MUST] **Combinability and application**: a combinability matrix between offers (combinable /
  not combinable / best-of), **application base** (room only, room + meal supplements, + compulsory supplements,
  + transfers), **application order** (e.g. free nights computed before early-booking discount) and compounding
  (sequential vs additive percentages) — expressed in data and compiled to promotions via SCR-16. The quote shows
  each offer line separately (RAT-R12).
- **CTR-R09** [MUST] **Proof requirements**: offers may require evidence (e.g. marriage certificate dated within
  n months for honeymoon, birthday date); the requirement is a check-in checklist item (RES-R24 `documents`)
  created on the stay; failing proof at check-in triggers the contract's rule (charge the difference to the TO or
  the guest per terms) through a previewed change — never automatically.
- **CTR-R10** [MUST] **Addenda**: mid-season offers and rate changes are contract versions with effective booking
  dates; already-confirmed bookings keep their terms snapshot (RAT-I04); the addendum shows which future bookings
  *would* qualify (information only, policy decides whether they are re-priced on request).

### 3.3 Compilation and governance

- **CTR-R11** [MUST] **Compilation**: an approved contract version compiles into `rates` rate plans (one per
  contract × property × base meal plan or per meal-plan variant, with eligibility = partner + markets + channel
  `agency`), price grids computed from tables and supplements, promotions for offers with combinability metadata,
  policies (cancellation/no-show/payment schedule templates) and into `groups` allotments (CTR-R15). Compiled
  objects carry `managedBy: contract:{id}@{version}` and are read-only in the rates UI ("Edit in contract"). A
  **compile preview** lists every object created/changed/retired with per-cell before/after.
- **CTR-R12** [MUST] **Four-eyes approval**: the loader (`contracting.contract.edit`) and the approver
  (`contracting.contract.approve` ⚑) must differ when the organization has ≥ 2 holders (IDN-R14 pattern); approval
  records the signed-document reference; activation is effective-dated.
- **CTR-R13** [MUST] **Loading QA**: test-price panel ("price a 7-night HB stay for 2 adults + child 6, booked 95
  days ahead, UK market") using the compiled objects and `rates.quote`, compared to the expected value typed from
  the TO's own example if provided; differences block approval until explained.
- **CTR-R14** [SHOULD] **Multi-property contracts** with property schedules and shared offers; group-level
  production reports (M).

### 3.4 Allotments and sales controls

- **CTR-R15** [MUST] **Allotments** per season × unit type: quantity, release days (per season), kind
  `guaranteed` (partner pays for unpicked rooms per terms — compiled with attrition terms), `allotment` (released
  at release date), `free_sale` (sell until stop-sale), `on_request` (each booking needs hotel confirmation within
  a target time); compiled into `groups` allotments (GRP-R11 extended by SCR-40) so inventory treatment, pickup
  and idempotent release (`release:{allotmentId}:{night}`) stay in one engine.
- **CTR-R16** [MUST] **Release visibility**: upcoming releases per partner and night; release runs are logged;
  bookings received for released nights become `on_request` decisions, not automatic confirmations.
- **CTR-R17** [MUST] **Stop-sale / open-sale notices**: scope (properties, unit types, dates, partners, markets),
  effective time (with the contract's notice period), generated notice (email/PDF via `comms`, effect
  `message.partner` — SCR-04) per partner contact, **acknowledgement tracking** (link or manual record), and the
  matching sales control in `rates`/`distribution` for connected channels. Notices are immutable and numbered.
- **CTR-R18** [MUST] **Bookings after a stop-sale**: a booking whose partner booking time is after the effective
  stop-sale time (+ notice period) is flagged "received after stop-sale" with the evidence (notice sent, acknowledged
  at); the hotel decides to honour (normal confirmation, possibly relocation) or decline with reason; before the
  effective time the booking is honoured per contract.

### 3.5 Tour-operator bookings

- **CTR-R19** [MUST] **Intake**: (a) **voucher entry** — a fast form (or paste) for emailed vouchers: partner,
  voucher number (unique per partner), guest names, occupancy and ages, dates, unit type, meal plan, offers claimed,
  partner-stated price, flight details; (b) **file import** (CSV/XLSX rooming lists with column mapping, reusing
  GRP-R08 mechanics); (c) **XML through the hub** where a wholesaler/bedbank is connected (`distribution` channel
  of kind `wholesale`; revisions and acks per DST-R08) [unverified support per partner]. Each booking is created via
  `reservations` with source `agency`, booker = partner, contract version reference, voucher number in
  `external_refs`, guarantee `agency`.
- **CTR-R20** [MUST] **Contract check**: Portico prices the booking with `rates.quote` using the partner, market,
  booking date and the compiled contract (offers applied per CTR-R08) and compares with the partner-stated price
  (tolerance policy, default 1 currency unit per stay). Outcomes: `match`, `mismatch` (explanation per line: "EB 15%
  not applicable — booked 41 days before arrival, offer needs 60"), `not_contracted` (unit type/meal plan/market not
  in contract), `allotment_exceeded`. A mismatch is an exception owned by reservations with actions: accept
  partner price (snapshot carries `priceSource: 'partner'`, as RES-R33 does for channels), re-price to contract and
  notify partner, or hold for clarification.
- **CTR-R21** [MUST] **Amendments and name changes**: re-run the contract check; early-booking eligibility follows
  CTR-R05 amendment rules; name changes update occupants and transfer manifests; "names to follow" bookings get a
  rooming-list due date and a reminder task.
- **CTR-R22** [MUST] **Voucher verification at arrival**: check-in shows contracted entitlements (meal plan, unit
  type, offers, transfers, honeymoon benefits) and any open contract-check exception; the desk confirms or raises a
  discrepancy with the partner (task).

### 3.6 Settlement and reporting

- **CTR-R23** [MUST] **Settlement model** per contract: `net_credit` (hotel invoices partner the net amount after
  departure or monthly; guest pays extras), `net_prepay` (partner prepays before arrival; deposit liability until
  applied — TGST time of supply on prepayment per `docs/readiness/maldives-tax-rules.md` §1), `commission`
  (guest pays hotel the gross; hotel owes commission), `commission_deducted` (partner collects gross and remits
  net). Billing rules route accommodation and contracted inclusions to the partner folio (FIN-R13 company/agency
  defaults) automatically.
- **CTR-R24** [MUST] **Statements**: per partner and period — bookings, room nights, contracted amounts, commission,
  cancellations/no-show charges per terms, invoices issued (finance), payments received and allocated, balance;
  exportable (PDF/XLSX) and sendable to the partner; disputes on lines tracked to resolution.
- **CTR-R25** [SHOULD] **Remittance reconciliation**: import a partner remittance (file), match to invoices
  (finance FIN-R28 allocations), list short-pays and over-pays with reasons.
- **CTR-R26** [SHOULD] **Commission processing** (JG-46): accrual at departure from the snapshot's commission terms
  (FIN-R31), rules for no-show and cancellation commissions per contract, commission statements, and a payment-run
  export to the hotel's accounts-payable process (BOH); OTA and travel-agent commissions use the same engine.
- **CTR-R27** [SHOULD] **Production reports**: by partner, market, season, unit type and offer — bookings, nights,
  net ADR, allotment utilisation and release performance, offer cost, cancellations; pace vs last year.
- **CTR-R28** [SHOULD] **Rate sheets**: per partner and market, versioned PDF/XLSX generated from the contract
  (what was agreed, not what is compiled) for distribution to the partner.

## 4. Entities and states

`partner_profile(company_id, sub_kind, markets jsonb, contacts jsonb)` · `contract(id, partner_id, property_ids,
period daterange, currency, model, tax_statement, status, current_version)` · `contract_version(id, contract_id,
version, effective_booking_from, document_ref, payload jsonb (seasons, tables, supplements, terms, offers, allotments,
markets), compiled_refs jsonb, loaded_by, approved_by?, approved_at?)` · `sales_notice(id, kind stop|open, scope
jsonb, effective_at, number, status)` · `notice_delivery(notice_id, contact, message_ref, acknowledged_at?, method)` ·
`booking_check(id, booking_id, contract_version_id, partner_price, portico_price, outcome, lines jsonb, resolution?,
resolved_by?)` · `statement(id, partner_id, period, lines jsonb, totals jsonb, status, sent_at?)` ·
`remittance(id, partner_id, file_ref, lines jsonb, status)`.

**Contract version:** `draft → in_review → approved → active → superseded | expired` · `in_review → draft`
(returned with notes) · `approved → active` at its effective time (compilation committed atomically with activation).
**Sales notice:** `draft → sent → acknowledged (per contact)` · `sent → superseded` (by an open-sale or a new notice).
**Booking check:** `match` (terminal) · `mismatch|not_contracted|allotment_exceeded → resolved (accepted_partner_price |
repriced | cancelled)`. **Statement:** `draft → sent → disputed → agreed` · `sent → agreed`.

## 5. Invariants

- **CTR-I01** Every compiled rates/groups object references exactly one active contract version; editing it outside
  `contracting` is rejected.
- **CTR-I02** Compiling the same contract version twice produces identical objects (deterministic; idempotent).
- **CTR-I03** A booking created from a contract references the contract version whose effective booking date covers
  the partner booking date; its terms snapshot is never changed by later versions (RAT-I04).
- **CTR-I04** A voucher number is unique per partner (duplicate intake → `duplicate`, like RES-I06).
- **CTR-I05** Every booking check with outcome ≠ `match` has an open exception or a recorded resolution.
- **CTR-I06** A stop-sale notice is immutable once sent; its effective time and deliveries are auditable.

## 6. Cross-module interactions

Calls `rates` (create/update managed plans, prices, promotions, policies; `quote` for checks), `groups` (allotments),
`inventory` (unit types), `guests` (partner companies, profiles for names), `reservations` (create/modify bookings
from intake; read bookings for statements and checks), `finance` (partner receivables, invoices, statements data,
commission accruals), `comms` (notices, statements, rooming-list reminders), `distribution` (wholesale channel
bookings via hub; sales controls on connected channels), `platform`. Nothing calls `contracting` synchronously (no
cycle): `reservations` and `distribution` publish events that `contracting` consumes to run checks.

### Proposed contract changes (SCR-01)

Module row `contracting` (schema `contracting`); arrows `contracting ─► rates, groups, inventory, guests,
reservations, finance, comms, distribution, platform`. `rates` gains managed-object markers and the promotion
extensions in SCR-16/17; `groups` allotment extensions in SCR-40.

## 7. Events

Emitted: `contracting.contract.activated|superseded`, `contracting.notice.sent|acknowledged`,
`contracting.bookingCheck.mismatch|resolved`, `contracting.statement.sent`. Consumed:
`reservations.booking.created|modified|cancelled` (checks, statements), `groups.allotment.released`,
`finance.invoice.issued`, `finance.payment.allocated` (proposed), `distribution.booking.received` (wholesale).

## 8. Permissions

`contracting.contract.read` · `contracting.contract.edit` · `contracting.contract.approve` ⚑ ·
`contracting.notice.send` · `contracting.booking.intake` · `contracting.check.resolve` (accepting a partner price
below contract above a policy amount requires ⚑ `contracting.check.acceptBelowContract`) · `contracting.statement.manage`
· `contracting.reports.read`. Net rates are commercially sensitive: `contracting.contract.read` is not in front-desk
role templates by default; desk users see entitlements, not net prices.

## 9. UX surfaces

Contract editor (seasons strip, rate grid by season × unit type × occupancy, supplements, offers with a
combinability matrix, terms), compile preview and approval view, test-price panel, partner workspace (contracts,
allotments and releases, notices with ack status, production, statement), voucher intake form optimised for speed
(keyboard-first, paste of voucher text, instant contract check result with explanations), contract-check exception
queue, stop-sale wizard ("Water Villas, 20 Dec – 5 Jan, all UK partners, effective 18:00 Malé time; 7 partners, 11
contacts"), statements.

## 10. Proof scenarios and evidence

| ID | Contracting must demonstrate |
|---|---|
| S01 (supporting) | Allotment pickup never competes with house availability; free-sale bookings for the last villa race the desk with one winner. |
| S02 (supporting) | The same voucher imported twice → one booking (`duplicate`); an amendment re-runs the contract check. |
| S11 (supporting) | Guaranteed allotment reduced after release: attrition per contract posted to the partner folio. |
| E08 | An addendum changes rates and offers: existing bookings keep their snapshots; new bookings use the new version by partner booking date. |
| J08 (proposed, SCR-06) | Voucher for 7 nights HB with EB 20% + stay 7 pay 6 + honeymoon: Portico computes per combinability and order, finds the partner applied EB on the free night, raises a mismatch with an explanation; resolution accepted; statement shows the agreed amount. |
| J09 (proposed) | Stop-sale at 18:00 with 24 h notice: booking stamped 17:30 next day honoured; booking stamped 19:00 next day flagged "after stop-sale" with evidence. |

## 11. Maldives specifics

Contract years commonly run November–October with festive peaks, compulsory gala dinners and festive minimum
stays; markets include the UK, Germany, Italy, Russia, China, India and the GCC; net rates in USD (sometimes EUR),
often stated inclusive of service charge and TGST with Green Tax payable at the resort; seaplane transfers priced per
person; honeymoon offers with proof of marriage; DMCs in Malé sell guesthouses with vouchers and bank-transfer
settlement [all A — confirm in discovery, Q64]. Prepayments create a TGST time of supply at payment
(`docs/readiness/maldives-tax-rules.md` §1).

## 12. Competitive inspirations

- Allotments with release rules and contracted net/commissionable rates — OPERA blocks and allotments (research 01
  §3.4–3.5); Mews availability blocks that cannot be exceeded (research 02 §2.4) — Portico keeps elastic/free-sale
  options explicit.
- Wholesale net rates and allotments "often contracted outside APIs" (coverage matrix §5.2; research 04) — hence
  first-class voucher intake with automatic contract check rather than assuming XML.
- Improvement: one quote engine for contracts and everything else; contract versions with effective booking dates;
  stop-sale evidence instead of email archaeology.

## 13. Open questions

Q81 (contracting in the first pilot slice; contract loading as a service), Q64 (which partners, formats and
extranets Maldivian properties use). Product decisions: compiled plans are read-only; mismatches never auto-reprice;
desk users do not see net rates by default.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **no** for compilation (prices must live where bookings are priced);
  **conditional (P2)** for contract check and statements next to an external PMS — reading the PMS's agency
  bookings (`reservations: read`) and comparing them with contracts loaded in Portico, producing exceptions and
  statements without writing to the PMS.
- **Hard dependencies:** `rates`, `groups` (allotments), `reservations`, `inventory`, `guests`, `finance`, `platform`.
- **Connected mode:** read-only checks and statements as above; any correction is a task for staff in the PMS.
- **Data-authority domains:** respects `rates`, `availability`, `reservations`, `charges`; owns none (contracts are
  Portico-owned configuration that compiles into the `rates` domain when Portico is authoritative).
- **Trial:** contracts can be loaded and test-priced against copied bookings to show mismatches the hotel did not
  know about — a strong trial value proof; no notices or statements leave the trial.
