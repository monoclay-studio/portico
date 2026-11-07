# Spec: fnb-pos (F&B and outlet point of sale)

Status: Draft v1 · 2026-11-07 · Wave 3b (back-of-house stage BOH-1) · Module `fnb-pos` · Schema `fnb_pos` ·
Permission key `fnbPos` · Prefix `FNB`
Entitlements (proposed, CR-29): `fnb.pos` (Portico POS: menus, tables, checks, kitchen routing, settlement — Resort
included, Professional add-on), `fnb.kds` (kitchen display), `integration.pos` (existing: external POS intake),
`resort.outlets` (existing: quick-post mode), `resort.mealPlans` (existing: entitlement consumption). Offline operation
is never gated (safety).

## 1. Purpose

Every outlet charge must land on the right bill with the right entitlement applied, the right service charge and
TGST, exactly once — whether it comes from Portico's own tablets at a beach bar with weak Wi-Fi or from the resort's
existing Simphony. `fnb-pos` is Portico's outlet point of sale (menus, tables, orders, kitchen tickets, settlement)
**and** the single intake for charges from external POS systems, so an outlet cashier never wonders what the
all-inclusive covers, a server never sees "posted to room" for a charge that is still queued offline, and the
kitchen keeps cooking when the internet drops.

## 2. Scope and non-goals

**In scope:** POS configuration of outlets (revenue centres, service periods, devices, prep stations), menus,
modifiers, combos, price schedules by time, floor plans and table states, checks and order lines, courses and
firing, kitchen order tickets (KOT) and kitchen display (KDS) routing, split/merge/transfer, discounts, voids and
comps with approvals, house and staff checks, settlement (cash, card through `payments`, room charge, house account,
entitlement-covered), room-charge eligibility with posting privileges, credit limits and signature, meal-plan and
all-inclusive consumption (through `resort`), service charge, TGST and tips (through `rates` and `finance`), tax
receipts in per-device fiscal series, server banks and cashier shifts (through `finance` cashier sessions), outlet
close, **offline operation**, **quick-post mode** (former RST-R02), **external POS intake** (former RST-R01), sold-item
facts for `stock`, POS hardware boundary.

**Non-goals:** table-reservation engine (resort dining sessions RST-R09 or an external reservation system — `fnb-pos`
seats them); recipes, costing and stock levels (`stock`); entitlement definitions (`rates`/`resort`); tax rules
(`rates.computeTaxes`); card processing (`payments` adapters); staff scheduling and tip distribution payroll
(`workforce`); guest in-villa ordering through the guest app (guest journey — not specified here); delivery
marketplaces and self-order kiosks (LATER); payment-terminal firmware, fiscal printers, hardware resale (never).

## 3. Capabilities

### 3.1 Outlet configuration

- **FNB-R01** [MUST] POS profile per outlet (extends PLT-R19 outlets): revenue centres (e.g. "Main restaurant —
  dinner", "In-villa dining"), service periods with local times (breakfast, lunch, dinner, all-day, late), **tax
  sector** (`tourism | general` — CR-22), service-charge applicability, price display (`exclusive` with the notice
  text, or `inclusive`), covers prompt, tip policy (allowed, suggested %, pool), room-charge policy, **charge source**
  (`portico_pos | external:<connectionId> | quick_post | none` — exactly one per outlet, CR-12), alcohol-licensed flag,
  devices, prep stations, printers, receipt templates, banking mode (`server_bank | central_cashier`).

### 3.2 Menus and pricing

- **FNB-R02** [MUST] **Menu item**: localized name and description, category, **charge code** (finance revenue account,
  department, tax applicability), prep-station routing, default course, modifiers (groups with min/max, forced or
  optional, priced or free, nested one level), combos/set menus (components with price allocation across charge codes,
  e.g. a wine-pairing dinner splits food and beverage), dietary and allergen tags (configurable list), **entitlement
  classes** (e.g. `ai.house_beverage`, `ai.excluded_premium`, `hb.dinner_main` — evaluated by `resort`), recipe link
  (`stock`), resale stock-item link, availability (outlets, periods, days), image; live "86" (sold out) with optional
  remaining count shown on every device.
- **FNB-R03** [MUST] **Price schedules**: effective-dated price lists per outlet × price level (`standard`,
  `happy_hour` by time window, `resident`, `staff`, custom); time-based levels switch automatically; the price of a line
  is **snapshotted at order time** with the schedule version and never recomputed at settlement; a price change shows
  which outlets and items it affects before publishing.
- **FNB-R04** [SHOULD] Menu versions `draft → published`; managers see cost and margin per item from `stock`
  (STK-R13) beside the price.

### 3.3 Tables and floor

- **FNB-R05** [MUST] Floor plans per outlet and area (beach deck, over-water deck, bar), tables (capacity, shape,
  combinable), table state `available → seated → ordered → bill_requested → paid → needs_reset`, server sections,
  merge/split tables, transfer to another server; seating a dining reservation (resort session or mirrored external
  reservation) links party size, stays, occasion and allergies; walk-in seating without reservation.

### 3.4 Checks and orders

- **FNB-R06** [MUST] **Check** (glossary term, CR-23): outlet, revenue centre, order type (`dine_in`, `in_villa`,
  `bar_tab`, `takeaway`, `event` — linked to a groups event order GRP-R12, `staff`), table(s) or tab name, covers,
  server, linked stays/occupants (several stays may share a table), seats, lines, status (§4). **Line**: item,
  modifiers, quantity, seat, course, notes, price snapshot, entitlement evaluation, state, actor and device.
- **FNB-R07** [MUST] **Courses and firing**: hold/fire per course, auto-fire rules (e.g. starters on send), "fire mains"
  from the table, rush flag; KOT shows table, server, seat, course, modifiers, allergen highlight, order time.
- **FNB-R08** [MUST] **Split, merge, transfer**: split by seat, by item (fractional shares of one item, e.g. one bottle
  three ways), evenly by N, or by amount; merge checks; move lines between checks or tables. Line identity and audit are
  preserved; taxes are recomputed per resulting check; rounding residuals (≤ 1 minor unit per part) go to the last part
  deterministically and are shown.
- **FNB-R09** [MUST] **Discounts, voids, comps**: discounts (item or check, % or amount, reason, approval above
  threshold); removal before send logged without approval; **void after send** needs reason + manager approval and a
  `made`/`not_made` flag (made → wastage to `stock`); **comps** need manager approval, a comp reason (service recovery,
  guest relations, management entertainment) and post per finance comp policy (revenue with a comp allowance, or to a
  house folio) — cost of sales stays with the outlet. Manager approval on a shared device uses identity elevation (PIN
  or passkey, recorded as a separate actor — CR-21).
- **FNB-R10** [MUST] **House and staff checks**: officer/entertainment checks settle to finance house folios with an
  authorizer; staff purchases use the `staff` price level and settle by cash/card, or by payroll deduction exported
  through `workforce` (SHOULD). Staff cafeteria meals are not POS sales (WFM-R15).

### 3.5 Kitchen routing and display

- **FNB-R11** [MUST] Routing rules: item/category → prep station(s) per outlet and service period (in-villa dining
  routed to the main kitchen), bar items → bar station; expo station optional; tickets to network printers and/or KDS;
  change chits (`ADD`, `VOID — DO NOT MAKE`, `MODIFIED`); reprint marked `REPRINT`.
- **FNB-R12** [MUST] **KDS** (`fnb.kds`): queue per station with timers (colour plus text), bump/recall, all-day counts,
  course pacing for expo, allergen badges, ready → server notification ("Table 12 mains ready"); keeps working on the
  outlet network when the internet is down (FNB-R20).
- **FNB-R13** [SHOULD] Ticket-time targets per station and period; ticket-time analytics.

### 3.6 Settlement

- **FNB-R14** [MUST] **Tenders**: cash (USD, MVR; change in either at finance's business-date rate; attributed to the
  open cashier session), card through `payments` (integrated terminal where an adapter supports it; otherwise a
  record-only external-terminal tender with approval code — the default path in the Maldives, PAY-R24), room charge
  (FNB-R15), house account, entitlement-covered (no tender for fully covered lines), split tenders. Payment outcomes
  keep `payments` semantics: `pending_verification` is never paid; the check stays `payment_pending`.
- **FNB-R15** [MUST] **Room charge with guest lookup**: search by unit + first letters of surname, by name or booking
  code, or by guest card QR; results list only **eligible stays** from `finance.getChargeEligibility` (CR-09): in house
  (or departing today before the policy cut-off), **posting privilege** `allowed | cash_only | blocked` (set at
  check-in by the front desk — CR-34), **remaining credit limit** (policy limit, authorization headroom or deposit
  balance), consented photo, F&B alerts (allergies, dietary needs) from `guests` with minimal fields. Billing rules
  route each charge to the right folio. **Signature**: on-device capture stored as an attachment of the settlement, or
  a printed chit signed and filed (policy). Posting: one `finance.postCharge` per settlement per charge code with key
  `pos:{outletId}:{checkId}:{settlementId}:{chargeCode}` (CR-13) and the itemized check as the source document. The
  server sees "Posted to Villa 214 — Ivanov (incidentals folio)" only after commit.
- **FNB-R16** [MUST] **Refusals and overrides**: `blocked`/`cash_only` and over-limit settlements are refused with the
  reason ("Villa 214 is cash only — set by the front desk at check-in") and alternatives (card, cash, partial room
  charge up to the limit); a manager override within the override limit (`fnbPos.roomCharge.override` ⚑) is logged and
  creates a front-office notice.
- **FNB-R17** [MUST] **Meal plans and all-inclusive**: when a check is linked to stays, each line is evaluated by
  `resort.evaluateEntitlements` (stay, occupants, service date and period, outlet, entitlement classes, quotas) →
  `covered | partially_covered (amount) | not_covered (reason: premium excluded, outlet not included, quota used)`;
  servers see the badge **before sending**; covered lines settle through `resort.recordEntitlementUse` (consumption at
  internal value for cost tracking, zero to the guest); monetary dining allowances use `allowanceRef: 'auto'`
  (FIN-R19); overflow is charged. Dine-around at sister properties LATER (RST-R03).
- **FNB-R18** [MUST] **Service charge, taxes, tips**: computed per line by `rates.computeTaxes` with the outlet's sector
  and the rule-pack version (Maldives default: 10% service charge on eligible net, TGST 17% on net + service charge, Q41);
  the check shows a tax summary per rule; **tips** are a separate tender add-on (card, cash or room-charge tip line)
  posted with charge code group `tip` to tips payable, outside the service-charge and TGST base, attributed to the
  server; tip-pool data exported to `workforce` (SHOULD). Service charge is never labelled a tip.
- **FNB-R19** [MUST] **Receipts**: a check settled with non-room tenders gets a tax receipt from a **per-device fiscal
  series** (CR-10): gapless within the series, numbers allocated on the device (also offline), continuity verified on
  sync (gap → exception); reprints marked `COPY`; an invoice with buyer TIN on request (finance document). Room-charged
  checks print an itemized copy; the fiscal document is the folio invoice. Live issuance is blocked while the rule pack
  is unverified (FIN-R35; MIRA specifics Q20/Q41/Q106).

### 3.7 Offline and resilience

- **FNB-R20** [MUST] Three connectivity tiers, each shown on every device:
  1. **Cloud reachable** — normal operation.
  2. **Outlet network up, internet down** — an optional **outlet hub** (a local connector, INT-R25) keeps checks, KDS and
     printers in sync among the outlet's devices on the local network.
  3. **Device alone** — the tablet keeps the published menu and prices, its leased checks, a snapshot of in-house stays
     (unit, surname, privilege, remaining limit **as of** the snapshot, entitlement summary) with its age; it can open
     checks, order, print to reachable printers and settle cash or record-only card. **Room charges offline** are
     allowed up to an **offline exposure limit** per stay and per check (policy; default USD 200 per stay) with a
     mandatory signature and are queued as `room_charge_queued`.
- **FNB-R21** [MUST] **Sync rules**: queued commands carry device id, device sequence, base versions and idempotency
  keys; the server applies them per check in device order. An open check has one **lease holder** (device or hub);
  offline edits are possible only on the lease holder, other devices show the check read-only and `delayed`. Line
  additions are append-only events, so no order is lost; settlement requires the lease, so two devices cannot settle the
  same check. Queued room charges are re-validated on sync: still eligible → posted; guest departed meanwhile → late
  charge per FIN-R25 (reopened or supplementary folio) plus a collection follow-up; blocked/not found → **unposted room
  charge** exception owned by the outlet manager with actions (payment link via `payments`, transfer to a house folio
  with reason, write-off ⚑).
- **FNB-R22** [MUST] Honest status: "Posted to room" appears only after the server commit; devices show "Offline since
  14:02 · 3 room charges waiting · guest list as of 13:58"; the outlet manager board lists every device's queue depth
  and oldest item; a device offline beyond policy (default 2 h) prompts a printed backup list of open checks.

### 3.8 Cashiering and outlet close

- **FNB-R23** [MUST] Server banks and cashier shifts are finance cashier sessions (FIN-R37): opening float, blind cash
  declaration, variance, card totals vs terminal batch, declared cash tips; shift report (sales by category, tenders,
  voids, comps, discounts, covers, tips, open checks handed over).
- **FNB-R24** [MUST] **Outlet close** per business date: open checks closed or transferred (bar tabs of in-house guests
  may auto-post to the room at close — policy, default off, guest-visible on the folio as "Sunset Bar tab closed at
  outlet close"), Z report, balancing (Σ room-charge settlements = Σ postings; any difference is an integrity alarm),
  `fnbPos.outlet.notClosed` and `fnbPos.roomCharge.unposted` exceptions for Day Close (CR-20).

### 3.9 Quick post and external POS intake

- **FNB-R25** [MUST] **Quick-post mode** (`resort.outlets`; replaces RST-R02): for outlets without menu operation (spa
  reception, dive desk, boutique, transfer desk, concessionaire desks — CNC-R03): find guest → choose items or charge
  codes → entitlement/allowance applied → signature → post; same eligibility, offline and idempotency rules.
- **FNB-R26** [MUST] **External POS intake** (`integration.pos`; replaces RST-R01): workflows W-POS-01..07 (eligibility,
  guest lookup with minimum fields, posting with outlet/check/line ids, corrections only as linked reversals, provided
  or computed taxes, service charge, tips, outlet attribution, meal-plan consumption) for any POS through `integration`
  connectors or the public POS posting API; idempotency `pos:{outletId}:{checkId}:{lineId}` (FIN-R08); provided taxes
  accepted only from a connection whose tax configuration is verified (FIN-R07); daily balancing report (POS totals vs
  postings) with differences as exceptions.
- **FNB-R27** [MUST] **Sold-item facts**: closed Portico checks and imported item-level sales from external POS
  (workflow `posSales`, file or API — CR-18) become standardized facts (item, modifiers, quantity, outlet, service date
  and period, net price, comp/void-made/entitlement-covered flags) for `stock` theoretical consumption and `analytics`.
  Unmapped external items are listed, never dropped (INT-R12).

### 3.10 Hardware boundary

- **FNB-R28** [MUST] A **hardware compatibility list** with evidence (model, firmware, date, tester, result) per device
  class: tablets and phones (browser PWA), KDS screens (browser), receipt and kitchen printers (network printers that
  accept printing from the browser on the local network, or ESC/POS through the outlet hub's print bridge), cash drawers
  (printer-driven kick), barcode scanners (keyboard emulation), payment terminals (only through `payments` adapters;
  otherwise record-only). Untested hardware is labelled `unverified`; Monoclay does not sell hardware (Q108). Manual
  fallbacks are documented: printer down → KDS only or handwritten chit; KDS down → printed tickets; terminal down →
  record-only/cash; internet down → hub/offline; tablet lost → lease revoked remotely, its queued items reconciled.

### 3.11 Reporting

- **FNB-R29** [MUST] Sales by outlet, period, revenue centre, category, item, server and hour; covers and average check;
  voids, comps and discounts with approvers (loss prevention); tips; entitlement consumption value by meal plan;
  open/unposted items; facts to `analytics`.

## 4. Entities and states

`pos_outlet_profile(outlet_id, sector, sc_applicable, price_display, charge_source, policies jsonb, version)` ·
`revenue_centre` · `service_period` · `menu(id, outlet_ids[], version, status)` · `menu_item(id, charge_code,
station_ids[], modifiers jsonb, entitlement_classes[], recipe_ref?, tags[], status, version)` ·
`price_schedule(id, outlet_id, level, window jsonb, effective_from, items jsonb, version)` · `floor_plan` · `table` ·
`check(id, outlet_id, revenue_centre_id, order_type, table_ids[], covers, server_id, stay_refs jsonb, status,
lease_holder, version)` · `check_line(id, check_id, item_id, modifiers jsonb, qty, seat, course, price_snapshot jsonb,
entitlement jsonb, state, device_id, device_seq)` · `settlement(id, check_id, tender, amount, currency,
payment_ref?, posting_refs jsonb?, signature_ref?, status, idempotency_key)` · `approval_record(check_id, action,
approver_id, reason)` · `kitchen_ticket(id, check_id, station_id, lines jsonb, state)` · `device(id, outlet_id, kind,
fiscal_series_id?, last_seen, queue_depth)` · `outlet_day(outlet_id, business_date, status, z_report_ref)` ·
`sold_item_fact(...)` · `external_pos_batch(connection_id, business_date, totals, status)`.

**Check:** `open → bill_requested → settling → closed` · `settling → payment_pending → closed` (pending payment
verified or queued room charge posted) · `open → voided` (no sent lines, or all voided with approval) · `closed →
reopened` (⚑, reason, only before outlet close; later corrections are finance adjustments).
**Line:** `ordered → sent → served` · `ordered → removed` (before send) · `sent|served → voided` (approval;
made/not made) · `served → comped` (approval).
**Room-charge settlement:** `queued (offline) → posting → posted | rejected → resolved` (payment link, house transfer
or write-off).
**Kitchen ticket:** `new → in_progress → ready → bumped` · `bumped → recalled`.
**Outlet day:** `open → closing → closed` (Z report) · `closed → reopened` (⚑).

## 5. Invariants

- **FNB-I01** Σ settlements of a closed check = net + service charge + taxes + tips − discounts − entitlement-covered
  value, to the minor unit.
- **FNB-I02** A room-charge settlement posts at most once (finance key uniqueness); a check is never `closed` while a
  room-charge settlement is not `posted` or `resolved`.
- **FNB-I03** No room charge posts to a stay whose privilege is `blocked`/`cash_only`, or beyond its remaining limit,
  without an approved override record.
- **FNB-I04** A line's price equals the price schedule version effective at order time; schedule changes never alter
  existing lines.
- **FNB-I05** Split/merge conserves quantities and amounts; each resulting check's tax residual ≤ 1 minor unit,
  assigned deterministically.
- **FNB-I06** Every void after send, comp, and discount above threshold has a reason and an approver distinct from the
  requester (single-staff outlets flagged on the loss-prevention report).
- **FNB-I07** Per device fiscal series, issued numbers after sync are `1..n` with no gaps or duplicates; any gap is an
  open exception.
- **FNB-I08** Entitlement-covered consumption per occupant/day/meal never exceeds the entitlement (RST-I03 enforced by
  the provider).
- **FNB-I09** A queued offline command applies at most once; an open check has at most one lease holder.
- **FNB-I10** For a closed outlet day: Σ room-charge postings from the outlet = Σ room-charge settlements, and sold-item
  facts = Σ closed check lines (excluding removed lines).
- **FNB-I11** Service charge and TGST come from the tax engine with recorded rule versions; tips are never in their base.

## 6. Cross-module interactions

Calls `finance` (`postCharge`, `getChargeEligibility`, cashier sessions, device fiscal series and receipts, house
folios — CR-09/10/13), `reservations` (in-house lookup, dining-seat links), `guests` (minimal alert fields, photo
consent), `rates` (`computeTaxes`), `resort` (`evaluateEntitlements`, `recordEntitlementUse`, dining sessions — CR-15),
`payments` (terminal tenders, payment requests for unposted charges), `identity` (approvals, device registration,
elevation), `platform` (outlets, business date, charge-source registration, data authority), `integration` (external POS
connectors, outlet hub, `posSales`). Consumed by `stock` (sold items via events), `analytics`, `day-close`,
`concessions` (charges on behalf), `workforce` (tips, staff charges — LATER).
Dependency arrow (proposed): `fnb-pos ─► finance, reservations, guests, rates, resort, payments, platform`.

### Proposed contract changes

1. Provider: `getOutletDayStatus(tx, { propertyId, businessDate })`, `listExceptions` (common shape),
   `listSoldItems(tx, { propertyId, range })`.
2. Consumes the new `finance.getChargeEligibility`, `finance.allocateDeviceSeries`/`issueReceipt` and
   `resort.evaluateEntitlements`/`recordEntitlementUse` (CR-09, CR-10, CR-15).

## 7. Events

`fnbPos.check.opened|closed|reopened|voided` · `fnbPos.line.voided|comped` · `fnbPos.roomCharge.queued|posted|rejected`
· `fnbPos.outlet.closed` · `fnbPos.soldItems.recorded` · `fnbPos.device.offline|syncConflict` ·
`fnbPos.fiscalSeries.gapDetected`. Consumed: `reservations.stay.checkedIn|checkedOut` (snapshot refresh, tabs),
`finance.folio.settled`, `resort.session.*` (dining reservations), `platform.dataAuthority.changed` (`charges`).

## 8. Permissions

`fnbPos.check.operate` · `fnbPos.check.transfer` · `fnbPos.check.reopen` ⚑ · `fnbPos.line.voidAfterSend` ⚑ ·
`fnbPos.discount.apply` · `fnbPos.discount.approve` ⚑ · `fnbPos.comp.approve` ⚑ · `fnbPos.roomCharge.post` ·
`fnbPos.roomCharge.postOffline` · `fnbPos.roomCharge.override` ⚑ · `fnbPos.quickPost.post` · `fnbPos.kds.operate` ·
`fnbPos.menu.manage` · `fnbPos.price.manage` ⚑ · `fnbPos.floor.manage` · `fnbPos.device.manage` ⚑ ·
`fnbPos.outlet.close` · `fnbPos.unposted.resolve` ⚑ · `fnbPos.report.read`.

## 9. UX surfaces

- **Server tablet**: table map → check → menu grid (repeat item ≤ 2 taps), modifiers sheet, seat and course chips,
  entitlement badges on each line ("Covered — FB dinner", "Not covered — premium wine"), send/fire buttons; dark theme
  for night bars; large targets.
- **Settlement sheet**: guest lookup with photo, unit, privilege chip, remaining limit, allergies; tender buttons;
  signature pad; result states that never look successful before commit.
- **Bar tab** list, **KDS** station and expo views, **quick post**, **outlet manager board** (devices, queues, open
  checks, unposted items, voids/comps awaiting approval), **menu and price admin** with preview, **floor-plan editor**.
- Offline banner and per-check sync chips follow `ux-principles.md` §11.

## 10. Proof scenarios and evidence

| ID | fnb-pos must demonstrate |
|---|---|
| S10 | A restaurant check settled to a guest who checked out meanwhile posts as a late charge (FIN-R25) exactly once on retry. |
| S19 (supporting) | Half-board and all-inclusive consumption with over-entitlement and allowance usage reconcile on the folio. |
| S20 (supporting) | Internet outage during dinner service: KDS and printing continue via the outlet hub; no duplicate postings on recovery. |
| B08 | Beach bar offline 40 minutes: 12 checks, 5 queued room charges (one guest departed, one blocked) → posted, late charge, exception; fiscal series continuous. |
| B09 | All-inclusive guest and non-AI friend split a check with a premium wine; entitlements, service charge, TGST, tips and stock facts correct. |
| B10 | Void after send with manager approval and `made` flag → wastage in stock; comp to service recovery; loss-prevention report. |
| B20 (supporting) | Resort keeps Simphony: intake API postings with retries create no duplicates; daily balancing differences raised. |

## 11. Maldives specifics

- Resort menus are typically priced in USD **exclusive** of service charge and TGST with a notice line; the default rule
  pack applies 10% service charge then TGST 17% on net + service charge, Green Tax never at outlets (Q41 defaults).
- Outlets inside a tourist establishment register in the tourism sector; an outlet registered in the general sector
  (8%) must be configured explicitly (`maldives-tax-rules.md` §2) → FNB-R01 `sector`.
- Alcohol may be sold only by licensed tourist establishments (resorts, licensed vessels); guesthouses on inhabited
  islands do not sell alcohol [unverified this session — confirm with the adviser, Q106] → outlet `alcoholLicensed`
  flag hides alcoholic items where false.
- Beach bars, sandbank dinners, dhoni excursions and over-water decks have unreliable Wi-Fi → the outlet hub and
  device-offline tiers are MUST.
- Cash in USD and MVR at outlets; card terminals are usually the acquiring bank's standalone devices → record-only tender
  matched to batches (PAY-R24) is the default.
- POS estate: branded resorts commonly run Oracle Simphony (Oracle positions it as the standard for full-service hotel
  F&B) and some run Shiji Infrasys (a review attributed to Radisson Blu Resort Maldives); which POS Maldivian resorts use
  is otherwise unconfirmed (Q64). Toast availability in the region is unconfirmed (dependency register 6.2).

## 12. Competitive inspirations

- Agilysys charge-to-room everywhere with property-level guest recognition (research 01 §6.2) → one eligibility service
  for Portico POS, quick post and external POS.
- OPERA and Mews POS interfaces (research 01 §2.4; research 02 §2.3 POS use case: POS systems map to accounting
  categories) → FNB-R26 mapping and provided-tax verification.
- Mews late-outlet pain (research 02 §2.6) → outlet close and unposted-charge exceptions feeding Day Close.
- OPERA package allowances invisible to the guest vs Agilysys S.P.E.N.D. (research 01 §6.2) → entitlement badges shown
  to servers before sending.

## 13. Open questions

Q108 (POS hardware and on-site support), Q106 (receipt numbering offline, alcohol and staff-sale tax treatment), Q62
(local connector support), Q41 (tax computation order).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **conditional** (proposed SM-12 — CR-27). Portico POS runs outlets for a
  hotel that keeps its PMS; room charges are **forwarded** to the PMS folio through a verified `posCharges` workflow
  (`charges` external + `forward`), shown pending until acknowledged, rejected forwards are urgent exceptions ("charge
  not on guest bill"). Without a verified posting workflow, room charges are produced as a **daily posting list**
  for manual entry, labelled as such. Cash/card outlets work fully. Entitlements come from mirrored rate/package codes
  via mapping or are `incomplete`.
- **Hard dependencies:** `platform`, `identity`, `rates` (tax engine), `finance` (cashier sessions, fiscal series —
  in journal-only mode when `charges` is external), `reservations` mirror for guest lookup, `integration`.
- **Connected mode (hotel keeps its POS):** Portico POS is not used; FNB-R26 intake and FNB-R27 sales import run; menus
  are mirrored read-only for recipe mapping.
- **Data-authority domains:** respects `charges`, `reservations`, `guestProfiles`, `payments`; owns POS checks (the
  creating system owns them — source-of-truth matrix §2) and registers as the outlet's single **charge source** (CR-12).
- **Trial:** POS runs on copied stays; room charges post to copied folios marked `copied`; nothing is forwarded; receipts
  print `TRIAL — NOT A TAX RECEIPT`.

## 15. Boundary — build here, integrate instead

| Capability | Decision | Why |
|---|---|---|
| Outlet POS for resort and hotel F&B, bars, in-villa dining, quick post | **Build** | Entitlements, room charges and offline consistency are where hotels lose money; one model for all outlets |
| KDS and kitchen routing | **Build** (browser KDS) | Needed for offline integrity; low hardware dependency |
| External POS (Simphony, Infrasys, InfoGenesis, Lightspeed, local) | **Integrate** through the intake API and `posSales` | Hotels keep systems they like; Portico stays the single eligibility and posting point |
| Payment terminals, EMV, card data | **Integrate** through `payments` adapters; record-only fallback | PCI scope and acquirer certification |
| Printers, drawers, scanners | **Support listed hardware**, no resale | Hardware support burden (Q108) |
| Table-reservation marketing platforms, delivery marketplaces, kiosks | **Integrate / LATER** | Not core to the resort promise |
| Fiscal printers / e-invoice clearance | **Not needed in the Maldives** (no mandate found — `maldives-tax-rules.md` §4); per market LATER via fiscal adapters | Country-specific |

## Sources (verified 2026-11-07 via web search; vendor claims are not evidence of Maldives usage)

- Oracle Simphony positioned for hotel food and beverage: [Oracle — Hotel food and beverage POS](https://www.oracle.com/hospitality/hotel-food-beverage/).
- Infrasys POS review attributed to an IT manager at Radisson Blu Resort Maldives (2020):
  [Capterra — Infrasys POS reviews, page 2](https://www.capterra.com/p/186493/Infrasys-POS/reviews/?page=2).
- Infrasys resort deployment across F&B outlets (Thailand, 2026):
  [Hospitality Net — Wyndham Garden Phuket Kamala deploys Infrasys](https://www.hospitalitynet.org/news/4134064/wyndham-garden-phuket-kamala-deploys-shijis-infrasys-pos-across-3-outlets-in-resort-dining-operations).
