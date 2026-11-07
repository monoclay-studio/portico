# Spec: stock

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-3) · Schema `stock` · Prefix `STK`
Entitlements (proposed, CR-29): `stock.core` (items, stores, movements, counts, costing, replenishment, fuel),
`stock.recipes` (recipes, menu costing, theoretical vs actual), `stock.minibar`, `stock.linen` (linen and amenity
standards driven by occupancy).

**Naming.** *Stock* means goods the hotel holds for use or sale: ingredients, beverages, guest amenities, linen,
cleaning chemicals, engineering spares, fuel. In Portico, **inventory** means accommodation availability (glossary).
UI, API and code never call goods "inventory"; places where goods are kept are **stores** (CR-23).

## 1. Purpose

On an island, running out of drinking water, diesel or the house champagne is not an inconvenience — the next boat
is days away. Stock gives every store an exact, auditable quantity and value; tells the chef what a dish really costs
and how far actual use drifted from what the recipes say was sold; replenishes linen, amenities and minibars from the
occupancy forecast; and warns early enough to act when a shipment slips. Every movement is immutable, every valuation
reconciles to the ledger, and nothing sold disappears from the analysis because a recipe was missing.

## 2. Scope and non-goals

**In scope:** stock items and units, stores and bins, store-level replenishment settings, movements (receipt, issue,
transfer, internal requisition, production, wastage, adjustment, return, minibar, staff meals), counts and variances,
costing (weighted average, FIFO) incl. landed costs and revaluation, valuation journals, cost-of-sales methods,
recipes and menu costing, theoretical vs actual consumption, linen and amenity standards, minibar, reorder suggestions
and days-of-cover, batch/expiry, fuel tanks.

**Non-goals:** purchasing, receiving workflow and landed-cost calculation (`procurement` — stock receives and values);
supplier invoices (`accounting`); outlet sales (`fnb-pos` or external POS — stock consumes sold-item facts); fixed
assets (`accounting` — equipment is not stock once in service); laundry production management (LATER via
`operations`/integration); food-safety HACCP management systems (integrate; Portico records temperatures and expiry).

## 3. Capabilities

### 3.1 Items and units

- **STK-R01** [MUST] **Stock item**: code, localized name, category tree (food — meat, seafood, dairy, produce, dry;
  beverage — wine, spirits, beer, soft drinks, water; guest amenities; linen; cleaning chemicals; engineering spares;
  fuel and gas; stationery; retail goods; minibar), **stock unit**, purchase units (supplier packs come from
  `procurement`), recipe units (g, ml, each, portion) with conversions incl. density where needed, tracking flags (batch,
  expiry, serial for spares), shelf life, storage class (`ambient | chilled | frozen | hazardous | bonded`), barcodes,
  **valuation category** → GL accounts (stock asset; default consumption account per department), status.
- **STK-R02** [MUST] Partial units for bar control (a 700 ml bottle counted in tenths or by weight; pours in recipes),
  pack hierarchy (case → bottle), unit conversions validated (no silent rounding: conversion residuals shown).

### 3.2 Stores

- **STK-R03** [MUST] **Store** tree per property: kind (`main_store`, `cold_room`, `freezer`, `beverage_store`,
  `outlet_store` (kitchen, bar), `minibar` (one per unit, created from the unit catalogue), `housekeeping_linen`,
  `linen_in_circulation`, `amenities_store`, `engineering_store`, `fuel_tank`, `staff_canteen_store`, `boutique`,
  `male_warehouse`, `in_transit`, `quarantine`, `returns`), owning department, consumption cost centre, **count
  method** (`perpetual` | `periodic`), responsible person, optional bins.
- **STK-R04** [MUST] Store-level item settings: par, min/max, reorder point, safety stock, reorder quantity and pack
  rounding, default source (transfer from store X, or purchase via route), count frequency (ABC class), negative-stock
  policy (STK-R06).

### 3.3 Movements

- **STK-R05** [MUST] Movement kinds: `receipt` (from `procurement` GRN, opening balance, migration), `issue` (store →
  consumption cost centre — e.g. chemicals to housekeeping, spares to a work order), `transfer` (store → store,
  two-step `dispatched → received` through `in_transit` with variance), `internal_requisition` fulfilment (a department
  requests from a store; approve, pick, issue or transfer; shortfall → purchase requisition via `procurement`),
  `sale_consumption` (perpetual outlet stores consume from sold-item facts per recipes — policy), `production` (batch
  recipe consumes ingredients and produces an item), `wastage` (reason: spoiled, expired, breakage, over-production,
  quality, made-and-voided from `fnb-pos`; photo; approval above threshold), `adjustment` (count variance or approved
  manual correction), `return_to_supplier`, `minibar_consumption`, `staff_meal`. Every movement is **immutable**
  (corrections are linked reversals), in stock units, valued at cost, with accounting date, source reference, actor,
  device and idempotency key.
- **STK-R06** [MUST] **Negative stock**: `block` (default for main and engineering stores) or `allow_with_exception`
  (outlet stores where sales consume before a transfer is recorded); negative balances raise exceptions resolved by
  transfer or count.
- **STK-R07** [MUST] **Mobile and offline** (staff app): issues, transfer receipts, wastage, counts with barcode scanning;
  queued commands with idempotency and per-item sync state (OPS-R21 semantics); stale lists labelled `delayed`.

### 3.4 Counts

- **STK-R08** [MUST] Counts: full, cycle (ABC) and spot; the count sheet freezes book quantities at a snapshot time and
  accounts separately for movements after it; blind count option; several counters with recount when variance exceeds a
  threshold; partial units; offline entry; variance report (quantity, value, %; high-risk items such as spirits
  highlighted); approval by the financial controller above a value threshold; approval posts adjustment movements once.
  Count-based (periodic) stores' approved closing values drive cost of sales (STK-R11).

### 3.5 Costing and valuation

- **STK-R09** [MUST] **Valuation method** per legal entity, changeable only from a period start (`stock.valuation.manage`
  ⚑, previewed): **weighted average** (perpetual moving average per item per property) by default; **FIFO** (cost layers
  per item per property) as option; standard cost LATER. Receipt cost = PO price × business-date FX + landed-cost
  estimate (PRC-R17). Later differences (invoice price variance, landed-cost actualization) revalue the quantity still on
  hand proportionally; the consumed share goes to cost of sales or purchase price variance (policy).
- **STK-R10** [MUST] **Valuation journals** through `finance.postJournal` in the same transaction as the movement command
  (one entry per command, summarized by account and dimensions; detail stays in stock; key `stock:{commandId}`):
  receipts (Dr stock / Cr GRNI — on `procurement`'s call), issues and sale consumption (Dr consumption or cost of sales
  by department/outlet / Cr stock), transfers across valuation accounts or properties (reclass; across legal entities via
  intercompany LATER), wastage (Dr wastage or cost of sales per policy), count adjustments (Dr/Cr stock variance),
  revaluations. Stock asset accounts have control owner `stock` (CR-02).
- **STK-R11** [MUST] **Cost of sales method** per outlet (policy): **issues-based** (consumption = issues and sale
  consumption) or **count-based** (opening + transfers in − transfers out − closing count). Month-end reclassifications
  follow a USALI-aligned policy: credits to cost of food and beverage sales for employee meals and for complimentary and
  entertainment use, charged to the receiving departments.

### 3.6 Recipes, menu costing, theoretical vs actual (`stock.recipes`)

- **STK-R12** [MUST] **Recipes**: ingredients (item or sub-recipe, quantity in recipe units, yield %, waste %), portions,
  method notes, effective-dated versions; **menu-item ↔ recipe** link per outlet (Portico POS item or external POS item
  via mapping kind `menuItem` — CR-18); modifier recipe deltas ("add cheese"); allergens derived from ingredients are
  **suggestions** to the menu item's tags (FNB-R02), applied only after review.
- **STK-R13** [MUST] **Menu costing**: theoretical cost per portion at current cost, cost % of net selling price
  (excluding service charge and taxes), contribution margin; alerts above target cost %; [SHOULD] menu-engineering
  matrix (popularity × margin) from sold-item facts.
- **STK-R14** [MUST] **Theoretical vs actual**: theoretical consumption = Σ sold items × recipes (including
  entitlement-covered, comped and made-and-voided lines; excluding not-made voids) per outlet store and period; actual
  consumption = opening + transfers in − transfers out − recorded wastage − closing count; variance per item (quantity,
  value, %) with drill-down to checks and movements and reason codes (portioning, unrecorded wastage, loss, recipe
  error). **Sold items without a recipe are listed as unmapped**, with their sales value — never ignored (STK-I07).
- **STK-R15** [SHOULD] Beverage control: bar par with daily or shift counts of high-value bottles, pour cost by shift
  (from `fnb-pos`), keg yield LATER.

### 3.7 Linen and amenities (`stock.linen`)

- **STK-R16** [MUST] **Amenity standards** per unit type and occupancy: items per arrival, per occupied unit-night, per
  guest-night, per turndown, per departure clean; theoretical use from Day Close facts (arrivals, occupied unit-nights,
  guest-nights by unit type) vs issues to housekeeping stores → variance; forecast for the next N weeks from on-the-books
  occupancy (analytics) → reorder suggestions that respect island lead times.
- **STK-R17** [MUST] **Linen**: circulating stock by location (units, pantries, laundry, store, discard), par per bed or
  unit (e.g. 4 sets), periodic linen counts, losses and rejects (stain, tear) → replacement need; cost policy per entity
  (expense on issue to circulation, or capitalize and amortize as operating supplies — ACC-R39 policy).

### 3.8 Minibar (`stock.minibar`)

- **STK-R18** [MUST] **Minibar**: a minibar store per unit with par per unit type; the attendant records consumption in
  the staff app (par-difference count or item taps); **one command** issues stock from the unit's minibar store, charges
  the stay via `finance.postCharge` (key `minibar:{unitId}:{recordId}:{itemId}`) — or, when the stay's entitlements
  cover minibar (all-inclusive tiers via `resort.evaluateEntitlements`), records an entitlement use at cost and no
  charge — and adds the item to the replenishment list. With `charges` external the charge is **forwarded** (pending
  until acknowledged). Consumption found after check-out follows the late-charge rules (FIN-R25). A disputed item
  ("guest says not consumed") reverses the charge (finance adjustment) and the stock issue together.
- **STK-R19** [MUST] Replenishment route list by location path, par-restore transfers from the minibar store, expiry
  rotation of date-coded items. Replaces the minibar part of OPS-R08 when `stock.minibar` is enabled (CR-16).

### 3.9 Replenishment and days of cover

- **STK-R20** [MUST] **Reorder suggestions** per store and item: projected stock = on hand + inbound (open transfers;
  purchase ETAs supplied by `procurement` through `setInboundExpectations`) − forecast consumption (moving average of
  actual consumption, scaled by forecast occupancy for occupancy-driven items and by forecast covers for F&B) − safety
  stock; when the projection falls below the reorder point within lead time plus the next shipping cut-off, suggest a
  quantity to reach max/par rounded to pack. Internal transfer from a main store first; otherwise a purchase-requisition
  proposal (`stock.reorder.suggested`) that `procurement` turns into a requisition after a person reviews it.
- **STK-R21** [MUST] **Days of cover** for critical items (fuel, drinking water, LPG, pool and desalination chemicals,
  top F&B items) with inbound ETAs and alerts ("Diesel: 9 days at forecast burn; next delivery 14 Dec in 11 days — act
  now"), owner and escalation.

### 3.10 Batch, expiry and food safety

- **STK-R22** [SHOULD] Batch/lot and expiry: FEFO picking suggestions, expiry alerts, quarantine store, temperature
  readings from receiving (PRC-R19); recall trace (which outlets received lot X) LATER.

### 3.11 Fuel

- **STK-R23** [MUST] **Fuel tanks** as stores: deliveries received with flow-meter or dip readings and the supplier's
  delivery note; tank dips or level sensors as counts (dip chart per tank; temperature correction LATER); issues to day
  tanks and generators, and boat fuel issues per vessel (transport department); `utilities` cross-checks issued litres
  against generator fuel meters and run logs (UTL-R03) and raises variances.

## 4. Entities and states

`item(id, code, category_id, stock_unit, conversions jsonb, tracking jsonb, valuation_category, status, version)` ·
`store(id, property_id, kind, parent_id?, department_id, count_method, settings jsonb)` · `store_item(store_id,
item_id, par, min, max, reorder_point, safety, source jsonb)` · `movement(id, kind, item_id, from_store_id?,
to_store_id?, qty, unit_cost, value, accounting_date, source_ref, reverses_id?, idempotency_key UNIQUE, actor,
device_id?)` · `balance(store_id, item_id, qty, value)` (projection) · `cost_layer(item_id, property_id, qty_remaining,
unit_cost, receipt_ref)` (FIFO) · `average_cost(item_id, property_id, unit_cost, qty)` · `transfer(id, from, to,
status, lines jsonb)` · `internal_requisition(id, department_id, store_id, status, lines jsonb)` · `count_sheet(id,
store_id, snapshot_at, kind, status, lines jsonb)` · `recipe(id, version, yield, ingredients jsonb, effective_from)` ·
`menu_link(menu_item_ref, outlet_id, recipe_id)` · `sold_item_fact(...)` (received) · `amenity_standard(unit_type_id,
items jsonb)` · `minibar_record(id, unit_id, stay_id?, lines jsonb, charge_refs jsonb, status)` ·
`inbound_expectation(store_id, item_id, qty, eta, source_ref)` · `suggestion(id, store_id, item_id, qty, reason jsonb,
status)`.

**Transfer:** `requested → approved → dispatched → received` (with variance lines) · `requested|approved → cancelled`.
**Internal requisition:** `submitted → approved → picked → fulfilled | partially_fulfilled` · `submitted → rejected`.
**Count sheet:** `open → counting → submitted → (recount) → approved → posted` · `open|counting → cancelled`.
**Suggestion:** `proposed → accepted (→ requisition) | dismissed (reason) | expired`.
**Minibar record:** `recorded → charged | covered | forwarded_pending` · `charged → disputed → reversed`.

## 5. Invariants

- **STK-I01** On hand per (item, store) = Σ movements; never negative where the store policy is `block`.
- **STK-I02** Σ store valuations per valuation account = the stock control account balance in the ledger, after every
  committed command.
- **STK-I03** Movements are immutable; a reversal links to its original; idempotency keys are unique.
- **STK-I04** Transfers conserve quantity: dispatched = received + recorded variance; the `in_transit` balance = Σ
  dispatched, not yet received.
- **STK-I05** Average cost is never negative; FIFO layers' remaining quantities sum to on hand.
- **STK-I06** A count sheet line posts its adjustment at most once; the snapshot is immutable.
- **STK-I07** Every sold-item fact is either consumed through a recipe or listed as unmapped; none is dropped.
- **STK-I08** Each minibar consumption has exactly one stock issue and at most one charge or entitlement use, in the
  same command; a dispute reverses both.
- **STK-I09** Each revaluation (price variance, landed-cost actualization) adjusts a receipt line's value at most once per
  source.

## 6. Cross-module interactions

Calls `finance` (`postJournal`, `postCharge` for minibar, FX), `resort` (minibar entitlement evaluation), `platform`
(units for minibar stores, departments, data authority `stock`), `analytics` (occupancy and covers forecasts — read),
`integration` (`posSales` inbound handler, external stock mirrors). Called by `procurement` (`receive`, transfers,
`setInboundExpectations`, suggestions), `operations` (issues to work orders, minibar entry point), `fnb-pos` (recipe cost
reads for menu admin), `utilities` (fuel issues read), `workforce` (staff canteen consumption read). Consumes
`fnbPos.soldItems.recorded`. Dependency arrow (proposed): `stock ─► finance, resort, platform`.

### Proposed contract changes

Provider: `receive(tx, { grnLineRef, storeId, itemId, qty, unitCost, landedEstimate, lots?, idempotencyKey })`,
`issue`, `transfer`, `revalue(tx, { receiptRef, amount, reason, idempotencyKey })`, `setInboundExpectations(tx, {
sourceRef, lines })`, `listSuggestions`, `getOnHand`, `getDaysOfCover`, `getRecipeCost`, `recordMinibarConsumption`,
`listExceptions` (common shape).

## 7. Events

`stock.movement.posted` · `stock.count.approved` · `stock.reorder.suggested` · `stock.belowSafety` ·
`stock.minibar.consumed` · `stock.variance.thresholdExceeded` · `stock.expiry.approaching` · `stock.negative.detected`.
Consumed: `fnbPos.soldItems.recorded`, `integration` `posSales` records, `reservations.stay.checkedOut` (final minibar
check task), `dayClose.run.completed` (amenity theoretical use), `procurement.shipment.delayed`,
`platform.dataAuthority.changed` (`stock`).

## 8. Permissions

`stock.item.manage` · `stock.store.manage` · `stock.par.manage` · `stock.movement.issue` · `stock.movement.transfer` ·
`stock.movement.receive` · `stock.requisition.create` · `stock.requisition.approve` · `stock.wastage.record` ·
`stock.wastage.approve` ⚑ · `stock.adjustment.approve` ⚑ · `stock.count.perform` · `stock.count.approve` ⚑ ·
`stock.recipe.manage` · `stock.cost.read` · `stock.valuation.manage` ⚑ · `stock.minibar.record` ·
`stock.minibar.reverse` ⚑ · `stock.report.read`.

## 9. UX surfaces

Storekeeper workspace (requisitions to pick, transfers in transit, expiring lots, negative balances, days-of-cover
alerts); counting app (offline, scanner, partial bottles, blind mode); recipe editor with live cost; chef's dashboard
(theoretical vs actual by outlet, top variances, unmapped sold items); housekeeping amenities view (standards vs issues);
minibar attendant flow (unit list in route order → par difference → done; covered/charged result per item);
fuel and critical-items board.

## 10. Proof scenarios and evidence

| ID | Stock must demonstrate |
|---|---|
| B01 (supporting) | Count-based stores counted and approved before soft close; Σ valuations = control accounts. |
| B09 (supporting) | Covered all-inclusive items and the premium wine both produce theoretical consumption. |
| B10 (supporting) | Made-and-voided line becomes wastage with the outlet's cost. |
| B11 | Delayed shipment changes projections and days of cover; landed-cost actualization splits on hand vs consumed. |
| B13 | Month-end bar count variance → recount → approval → cost of sales; theoretical vs actual report with unmapped items. |
| B14 | Minibar consumption found after check-out → late charge; guest dispute reverses charge and stock together. |
| B18 (supporting) | Diesel tank dips vs issues and generator meters show an unexplained loss. |

## 11. Maldives specifics

- Lead times of weeks and fixed sailing days make **projection with inbound ETAs** and **days of cover** the core of
  replenishment, not min/max alone.
- Diesel, drinking water (bottled or from desalination), LPG and desalination chemicals are life-critical stocks on a
  resort island → STK-R21 alerts with escalation.
- A Malé warehouse and `in_transit` stores model goods waiting for the supply boat (PRC-R22).
- All-inclusive consumption is valued at cost through recipes even though the guest pays nothing at the outlet — cost
  control of AI tiers is a main use of theoretical vs actual.
- Alcohol is stored and controlled separately (bonded/beverage stores) and only where the establishment is licensed
  (FNB §11).

## 12. Competitive inspirations

Agilysys Eatec and Oracle Materials Control as the incumbent hotel inventory/procurement tools integrated by file
(research 01 §6.1, §6.4; coverage matrix §5.9) — Portico builds stock on the same events as POS and accounting so
theoretical consumption and valuation reconcile by construction, and still imports/exports for hotels that keep them.

## 13. Open questions

Q64 (discovery of stock systems and store structures in Maldivian resorts); valuation-method default is an engineering
decision (weighted average) changeable by the entity.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** (with procurement, proposed SM-11 — CR-27). Minibar charges and
  amenity forecasts need the PMS reservation mirror (`reservations: read`) and, for minibar charges, a verified
  `posCharges` forward; otherwise minibar runs as stock-only with a daily posting list labelled as such.
- **Hard dependencies:** `platform`, `identity`, `finance` journal kernel (or journal-only mode exporting to the ERP).
- **Connected mode:** `stock` external (hotel keeps its stock system): on-hand and costs mirrored read-only where
  available; Portico POS sales and minibar consumption exported (`posSales: create`, `stockIssues: create` — CR-18);
  recipe costing works on mirrored costs labelled `external`.
- **Data-authority domains:** owns the proposed `stock` domain when authoritative; respects `charges` (minibar) and
  `purchasing`.
- **Trial:** copied item master and on-hand; counts and recipes rehearsed; no charges forwarded.

## 15. Boundary — build here, integrate instead

| Capability | Decision | Why |
|---|---|---|
| Stores, movements, counts, costing, recipes, theoretical vs actual, minibar, linen/amenities, fuel | **Build** | Shares POS, occupancy and ledger data that external tools only see by file |
| HACCP/food-safety management, temperature sensor networks | **Integrate** (record readings) | Specialist compliance tooling |
| Laundry production systems, RFID linen tracking | **Integrate / LATER** | Hardware-dependent |
| Warehouse management for central kitchens of large groups | **Integrate** | Beyond hotel scope |

## Sources

No external facts beyond those cited in `procurement.md` and `fnb-pos.md`; Maldives logistics statements are labelled
assumptions pending discovery (Q64).
