# Spec: utilities (resort utilities and sustainability)

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-5) · Schema `utilities` · Prefix `UTL`
Entitlements (proposed, CR-29): `utilities.metering` (meters, readings, plant logs, KPIs, alerts),
`utilities.allocation` (cost pools and recharges), `utilities.sustainability` (emissions and reporting packs).

## 1. Purpose

A Maldivian resort is its own power station, water works and waste depot. Diesel generators run day and night,
reverse-osmosis plants make drinking water from the sea, and waste leaves by boat. Utilities turns meter readings and
plant logs into operational truth (how much power, water and waste per occupied villa, whether a generator is
degrading, how many days of fuel remain) and into money (what a kWh or m³ really costs, which department, staff
building or concession used it) and into sustainability reporting that can be checked line by line — without claiming
any certification Portico has not earned.

## 2. Scope and non-goals

**In scope:** meter registry and hierarchy, readings (manual rounds, imports, connectors), validation and estimates,
generation and plant logs, fuel cross-checks with `stock`, water production, waste streams and shipments, normalized
KPIs, emissions with versioned factors, cost pools, unit costs and allocation/recharge bases, alerts, sustainability
reporting packs.

**Non-goals:** controlling plant equipment (SCADA/BMS remain the control systems; Portico reads), engineering asset
maintenance (`operations` work orders and preventive schedules — utilities raises them), fuel stock levels (`stock`),
posting journals (`accounting` posts allocations proposed here), certification or verified emission claims (never
without evidence — CLAUDE.md §7).

## 3. Capabilities

- **UTL-R01** [MUST] **Meter registry**: kind (`genset_output`, `solar_pv`, `battery`, `electricity_submeter`,
  `ro_water_output`, `water_submeter`, `fuel_flow`, `tank_level`, `lpg`, `waste_scale`, `sewage_flow`, other), unit,
  multiplier, rollover value, location (operations location path), parent meter (hierarchy), served cost centres
  (departments, outlets, staff-housing buildings, concessionaires), linked physical asset (`operations` OPS-R19),
  reading frequency, source (`manual | import | connector`), status; meter replacement keeps history (closing and
  opening readings).
- **UTL-R02** [MUST] **Readings**: engineering rounds in the staff app in route order (offline, photo of the meter,
  expected range shown), CSV import, connectors (`utilityReadings` workflow from BMS/SCADA, generator controllers, solar
  monitoring portals — via the local connector where needed; vendor support `unverified`, CR-18); validation (rollover,
  negative consumption, spikes vs expected from occupancy and history) → flagged; missing readings estimated and
  labelled `estimated`; corrections are new readings with reason (originals kept).
- **UTL-R03** [MUST] **Plant logs**: per generator run hours, kWh, fuel used (flow meter or tank difference from
  `stock` STK-R23), **specific fuel consumption** (kWh/litre) with thresholds → `operations` work order when it degrades;
  RO plant output (m³), energy per m³, membrane cleaning cycles; sewage treatment volumes. **Fuel reconciliation**:
  litres issued from tanks vs generator fuel meters vs expected from kWh — unexplained differences beyond tolerance raise
  an exception with owner (loss or leak investigation).
- **UTL-R04** [MUST] **Waste**: categories (food/organic, recyclables by stream, general, hazardous — oil, batteries,
  chemicals — e-waste, construction), daily weights, treatment (composted, compacted, incinerated where permitted,
  shipped), shipments to the receiving facility (vessel, weigh bill, collector), costs (supplier vouchers).
- **UTL-R05** [MUST] **Normalized KPIs** using Day Close and workforce facts: kWh, diesel litres, water m³ and waste kg
  per occupied unit-night, per guest-night and per **island person-night** (guests + staff in house from staff housing
  — more meaningful on a resort island); solar share; generator efficiency; trends and targets; every KPI shows its
  definition and source (ANL-R01).
- **UTL-R06** [MUST] **Emissions**: scope 1 (diesel, LPG, petrol for boats; refrigerants LATER) and scope 2 (purchased
  grid electricity, e.g. a Malé office) from activity data × **emission factors** that are effective-dated data with
  source and verification date; every calculation records the factor version (reproducible); scope 3 LATER; a
  methodology statement accompanies every report.
- **UTL-R07** [MUST] **Cost pools and allocation** (`utilities.allocation`): monthly cost per utility (fuel cost from
  stock consumption, spares and chemicals, contracted operations and maintenance from AP, labour from cost bands,
  depreciation from fixed assets) → unit cost (per kWh, per m³) → allocation by sub-meter consumption to departments,
  outlets, staff housing and concessionaires. Outputs: an **allocation journal proposal** to `accounting`
  (`proposeAllocationJournal`; the USALI tree keeps Utilities undistributed, the allocated view is a separate tree —
  ACC-R06) and **recharge quantities and rates** for `concessions`.
- **UTL-R08** [MUST] **Alerts** with owners: fuel days of cover (with `stock` and inbound deliveries), water storage
  low, plant output drop, missing readings beyond N days, abnormal consumption at a meter (e.g. a leaking villa).
- **UTL-R09** [SHOULD] **Sustainability reporting pack** (`utilities.sustainability`): energy, water, waste and emissions
  per period and per occupied room, structured to the publicly described sustainability section of the USALI 12th
  Revised Edition (detailed definitions need HFTP materials — Q105) and exportable for certification bodies or group
  ESG reporting; no certification badge or "verified" wording without evidence.
- **UTL-R10** [LATER] Demand and solar optimization suggestions (AI proposals, never automatic control).

## 4. Entities and states

`meter(id, property_id, kind, unit, multiplier, rollover, location_ref, parent_id?, served jsonb, asset_ref?, source,
status, version)` · `reading(id, meter_id, at, value, source, photo_ref?, estimated bool, corrects_id?, idempotency_key)`
· `plant_log(id, asset_ref, period, values jsonb)` · `waste_entry(id, category, kg, treatment, at)` ·
`waste_shipment(id, vessel, weigh_bill, kg_by_category jsonb, collector_ref)` · `emission_factor(id, fuel, unit,
kgco2e, source, effective_from, verified_at)` · `cost_pool(id, utility, period, components jsonb, unit_cost, status)` ·
`allocation(id, pool_id, lines jsonb, journal_proposal_ref?, status)`.

**Meter:** `active → replaced | retired`. **Reading:** `recorded → flagged → accepted | corrected`. **Cost pool:**
`open → computed → approved → allocated` (allocation proposal sent) · `computed → superseded`.

## 5. Invariants

- **UTL-I01** Consumption derived from readings is never negative except across a documented rollover or meter
  replacement.
- **UTL-I02** Allocated amounts of a pool sum exactly to the pool cost (residual assigned deterministically).
- **UTL-I03** Every reading carries source and provenance; estimates are labelled wherever shown.
- **UTL-I04** An allocation for (pool, period) is proposed at most once; corrections supersede with a reason.
- **UTL-I05** Each emission figure references the factor version used and is reproducible from its activity data.

## 6. Cross-module interactions

Calls `operations` (locations, assets, `createWorkOrder`), `stock` (fuel issues and tank counts — read), `accounting`
(`proposeAllocationJournal`; AP costs — read), `analytics` (occupancy facts — read), `workforce` (staff in house —
read), `platform`, `integration` (`utilityReadings`). Called by `concessions` (recharge quantities). Dependency arrow
(proposed): `utilities ─► operations, stock, accounting, platform`.

## 7. Events

`utilities.reading.flagged` · `utilities.fuel.varianceDetected` · `utilities.plant.degraded` ·
`utilities.alert.raised|resolved` · `utilities.costPool.allocated`. Consumed: `dayClose.run.completed`,
`stock.movement.posted` (fuel), `operations.workOrder.completed` (plant maintenance closes degradation alerts).

## 8. Permissions

`utilities.meter.manage` · `utilities.reading.record` · `utilities.reading.correct` · `utilities.plant.log` ·
`utilities.waste.record` · `utilities.factor.manage` ⚑ · `utilities.costPool.approve` ⚑ · `utilities.report.read`.

## 9. UX surfaces

Engineering rounds (staff app, offline, camera-first); utilities dashboard (power, water, fuel days of cover, waste,
alerts); generator and RO plant pages; fuel reconciliation view; allocation preview; sustainability pack builder with
methodology notes.

## 10. Proof scenarios and evidence

| ID | Utilities must demonstrate |
|---|---|
| B18 | Diesel tank dips vs generator fuel meters show 3% unexplained loss: exception, work order, investigation trail; days of cover recalculated. |
| B17 (supporting) | Spa partner's metered electricity and water recharge computed from readings × unit cost. |
| B01 (supporting) | Monthly cost pools allocated and proposed to accounting before close. |

## 11. Maldives specifics

Resorts generate their own electricity mostly from diesel, increasingly with solar; one industry forum figure (2023)
put average diesel use at about 33 litres per bed night with about 85% of diesel used for electricity — a conference
presentation, not a verified study, used only to size validation ranges. Water comes from on-site reverse-osmosis
desalination. Waste leaves islands by vessel (receiving facility and rules `unverified` — Q64). Fuel is a life-critical
stock with long resupply intervals → UTL-R08 alerts escalate to the GM.

## 12. Competitive inspirations

No PMS in the research covers resort utilities; specialist energy platforms do. Portico's advantage is normalization by
the same occupancy and staff-in-house facts the PMS already holds, and fuel reconciliation against stock.

## 13. Open questions

Q105 (USALI sustainability definitions); emission-factor source selection is an engineering decision recorded with
citations when implemented.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** (proposed SM-15 — CR-27); normalization needs the PMS reservation
  mirror or imported occupancy (otherwise KPIs per occupied room are `incomplete`).
- **Hard dependencies:** `platform`, `identity`, `operations` (locations/assets).
- **Connected mode:** readings from BMS/SCADA are `external` with last-sync time; no governed domain.
- **Data-authority domains:** none owned; respects `accounting` (allocations are proposals).
- **Trial:** readings imported as `copied`; alerts go to staff in-app only.

## 15. Boundary — build here, integrate instead

| Capability | Decision |
|---|---|
| Metering, readings, plant logs, fuel reconciliation, KPIs, allocation, reporting packs | **Build** |
| Equipment control, SCADA/BMS, generator controllers | **Integrate** (read only) |
| Verified ESG assurance, certifications | **Never claimed**; export data for external verifiers |

## Sources (verified 2026-11-07 via web search)

- Diesel per bed night and share for electricity (industry forum report, 2023):
  [Hotelier Maldives — GM Forum 2023, net-zero transformation](https://hoteliermaldives.com/hotelier-maldives-gm-forum-2023-dr-simad-saeed-highlights-tourism-net-zero-transformation/).
- USALI 12th edition sustainability section: see `accounting.md` Sources.
