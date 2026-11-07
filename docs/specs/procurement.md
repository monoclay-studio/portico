# Spec: procurement

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-3) · Schema `procurement` · Prefix `PRC`
Entitlements (proposed, CR-29): `procurement.purchasing` (requisitions, approvals, purchase orders, receiving, matching),
`procurement.logistics` (shipments, island routes, landed cost), `procurement.sourcing` (contracts, price lists, RFQ).

## 1. Purpose

A resort on a private island cannot run to the shop. Everything — flour, wine, chlorine, generator filters, bath
amenities — is ordered weeks ahead, shipped to Malé, cleared through customs, consolidated and carried by boat to the
jetty. Procurement turns a department's need into an approved, budget-checked purchase order with a realistic
arrival date, follows the goods through each leg, receives them honestly at the jetty, loads their **landed cost**
into stock, and proves every supplier invoice against what was ordered and received before a cent is paid — with
separation of duties so that no single person can order, receive and pay.

## 2. Scope and non-goals

**In scope:** supplier purchasing profiles (catalogue, packs, lead times, compliance documents), contracts and price
lists, RFQ and quote comparison, purchase requisitions from departments and from stock suggestions, approval workflows
with limits and separation of duties, budget checks and commitments, purchase orders with change orders, supplier
communication, shipments with island logistics legs and milestones, customs data, landed cost estimation and
actualization, goods receiving (GRN) incl. jetty receiving offline, returns to supplier, three-way match feeding
accounts payable, GRNI management, supplier performance and spend analytics.

**Non-goals:** supplier legal/bank master, supplier invoices and payments (`accounting` AP — procurement extends the
supplier and supplies match results); stock levels, valuation and recipes (`stock`); customs declarations and filing
(the clearing agent and Maldives Customs systems — Portico records their outcome); freight booking platforms and
carrier tracking APIs (LATER via `integration`); construction tenders and project procurement (integrate); supplier
marketplaces/e-procurement networks (integrate).

## 3. Capabilities

### 3.1 Suppliers (purchasing profile)

- **PRC-R01** [MUST] Purchasing profile per supplier (identity, tax registration, terms and bank details stay in
  `accounting`, ACC-R10/R11): categories supplied, supplier items with supplier codes and **pack sizes** (conversion
  to the stock unit — e.g. case of 24 × 330 ml), lead time per **route** (origin → Malé → island), minimum order
  quantity/value, order days and cut-offs, default incoterms, ordering channel (email/PDF; portal and EDI LATER),
  compliance documents (trade licence, food-safety and halal certificates, insurance) with expiry, purchasing status
  (`prospect → approved ⇄ suspended`). Suppliers with expired mandatory documents or `suspended` status cannot receive
  new POs without `procurement.supplier.override` ⚑.
- **PRC-R02** [SHOULD] Supplier onboarding workflow: department request → vetting checklist → `accounting` creates and
  approves the supplier master → purchasing approval; requester, master-data maintainer and approver are different
  people (CR-21).

### 3.2 Contracts, price lists and quotes (`procurement.sourcing`)

- **PRC-R03** [MUST] **Price lists**: supplier × item × pack × currency × effective dates × quantity breaks, with
  contract or quote reference and source (contract, quote, catalogue CSV import); POs default to the valid price;
  deviations show % and need a reason, and approval above tolerance.
- **PRC-R04** [SHOULD] **Contracts**: term, volume commitments, payment terms, price-review dates, renewal reminders,
  documents; consumption vs commitment report; rebates tracked LATER.
- **PRC-R05** [SHOULD] **RFQ**: request quotes from several suppliers (`message.supplier`, CR-25), record responses,
  comparison matrix including **estimated landed cost** and lead time (not only unit price), award to a price list or
  PO; policy for minimum quotes above thresholds with recorded exception reasons.

### 3.3 Requisitions

- **PRC-R06** [MUST] **Purchase requisition**: requester, department/cost centre, lines (stock item, non-stock catalogue
  item, or free text with category), quantity and unit, needed-by date and delivery location (store, Malé warehouse,
  department), suggested supplier and price, account and dimensions (defaulted from item/category), capex flag and
  project, justification, attachments. **Sources** carried as references: manual, `stock` reorder suggestions
  (STK-R20), internal requisition shortfall (stock), work-order parts (`operations`, CR-16), event orders (`groups`,
  CR-26).
- **PRC-R07** [MUST] **Island-aware dates**: each line shows the **order-by date** computed backwards from needed-by
  through the supplier's route lead time and the **shipping calendar** (consolidation cut-offs, supply-boat sailing
  days, public holidays); infeasible dates are flagged with the earliest realistic arrival and an air-freight option with
  estimated cost.
- **PRC-R08** [MUST] **Budget check** at submission through `accounting.getBudgetAvailability` (budget − actual −
  commitments for account, dimensions and period) with policy per account class (`warn | extra_approval | block`);
  approval records a **commitment** (`accounting.recordCommitment`), relieved by receipt/invoice or cancellation.
  Without `accounting.budgets`, the check is skipped and labelled "no budget configured".

### 3.4 Approvals and controls

- **PRC-R09** [MUST] **Approval rules** as data: by total in functional currency, category, department, capex/opex,
  budget status, new or single-source supplier, price deviation; multi-step chains (department head → purchasing
  manager → financial controller → GM → owner representative for capex above a limit); delegations with dates;
  executed through identity approval chains (CR-21); mobile approval shows budget impact, last price paid, quotes and
  landed-cost estimate.
- **PRC-R10** [MUST] **Separation of duties** (policy, default on): requester ≠ approver; PO creator ≠ PO approver above
  threshold; receiver ≠ PO creator for the same PO (policy); match-exception acceptor ≠ requester; supplier master
  maintainer ≠ payment releaser (accounting). Violations return `segregation_of_duties` naming the rule and an
  alternative approver (IDN-R14). The guesthouse profile may run a documented single-person policy; every such action is
  flagged on the SoD report (ACC-R47).

### 3.5 Purchase orders

- **PRC-R11** [MUST] **Purchase order**: legal entity, property, supplier, currency, lines (item, supplier code, pack and
  conversion, quantity, unit price, discount, tax code, delivery location, needed-by, requisition line refs, account and
  dimensions, capex/project), incoterms, route (direct to resort, via Malé consolidator, air), expected dates, price-list
  version snapshot, attachments; **PO number** gapless per entity series, allocated at approval; requisition lines
  consolidated by supplier and route.
- **PRC-R12** [MUST] **Change orders** after sending create a new immutable PO version (quantity, price, date, cancel
  line), re-approved per rules when value increases, communicated to the supplier; close short with reason.
- **PRC-R13** [MUST] **Sending**: PDF by email to the supplier's ordering contact through `message.supplier` (simulated
  in demo/trial/training; documents rendered `SAMPLE — NOT AN ORDER`); supplier acknowledgement captured (confirmed
  quantities, prices, dates) and differences flagged for the buyer.
- **PRC-R14** [SHOULD] **Standing orders** (e.g. weekly fresh produce from Malé) with call-offs, and recurring orders.

### 3.6 Shipments, imports and landed cost (`procurement.logistics`)

- **PRC-R15** [MUST] **Shipment**: groups PO lines from one or more suppliers and POs that travel together; mode (sea
  FCL/LCL, air, local boat), **legs** (origin → Malé port → Malé warehouse/consolidator → inter-island vessel → resort
  jetty), **milestones** with planned / estimated / actual (booked, departed, arrived Malé, customs declared, duty
  assessed, cleared, dispatched to island, arrived at resort, received), documents (bill of lading or air waybill,
  commercial invoice, packing list, certificate of origin, customs declaration and assessment, delivery note), parties
  (forwarder, clearing agent, carrier — all suppliers), packages (weight, volume, temperature class).
- **PRC-R16** [MUST] **Delays propagate**: a changed ETA updates every linked PO line and requisition, and `stock`
  projections show the consequence ("Arrives 9 days late — Water 1.5 L falls below safety stock on 12 Dec") with
  suggested actions: air-freight top-up, substitute item, transfer from a sister property, local Malé purchase.
- **PRC-R17** [MUST] **Landed cost**: cost components per shipment — international freight, insurance, **import duty**
  (by tariff line, on the customs value), **import GST** (recorded separately; included in cost only where not
  recoverable per the rule pack — Q106), port and handling, clearing-agent fees, Malé warehousing, inter-island freight,
  offloading and customs-officer travel fees at the resort, other. Each component is **estimated** at shipment creation
  (rate cards, history) and **actualized** from supplier vouchers coded to the shipment; allocation basis per component
  (`value | weight | volume | quantity | manual`) to receipt lines. Estimates enter stock cost at receipt (Dr stock / Cr
  landed-cost accrual, clearing key `lc:{shipmentId}:{component}`); actualization posts the difference once — to stock
  for quantities still on hand, to cost of sales/variance for quantities consumed (STK-R09).
- **PRC-R18** [MUST] **Customs data** per line: tariff (HS) code, origin, customs value basis, duty rate (effective-dated
  data with source and verification date; `unverified` until confirmed), exemption reference when an exemption is
  granted (never assumed); declaration number and assessment recorded from the clearing agent. Portico does not file
  declarations.

### 3.7 Receiving

- **PRC-R19** [MUST] **Goods receipt (GRN)** at the receiving location (resort store, jetty, Malé warehouse,
  department): against PO lines or a shipment; **blind receiving** option (ordered quantity hidden); quantities in the
  delivered unit with conversion; rejects with reason (damaged, wrong item, short shelf life, temperature breach) and
  photos; temperature readings for chilled/frozen; batch/lot and expiry capture where the stock item requires it;
  partial receipts; over-receipt within tolerance (policy) else blocked; substitutions need buyer approval; signature of
  the delivering party; works **offline** in the staff app (night arrivals at the jetty) with queued idempotent commands
  (OPS-R21 semantics).
- **PRC-R20** [MUST] **Posting**: stock lines call `stock.receive` (valuation at PO price × business-date FX + landed
  estimate) and post Dr stock / Cr GRNI (clearing key `grn:{grnLineId}`); non-stock lines post Dr expense or asset
  (PO-line account and dimensions) / Cr GRNI through `finance.postJournal`; capex lines create a pending fixed asset
  (ACC-R39); service lines are confirmed by the requesting department ("service confirmation" receipt).
- **PRC-R21** [MUST] **Returns to supplier**: from a GRN (later rejects, recalls) — stock issue to the `returns` store, debit
  note request to the supplier (`message.supplier`), supplier credit note matched in AP; GRNI or stock reversed by
  linked entries.
- **PRC-R22** [MUST] **Malé → island**: goods received at the Malé warehouse travel to the island as a `stock` transfer
  through an in-transit store linked to the shipment leg; island-side differences are transfer variances, not supplier
  claims, unless traced to supplier packing (claim workflow).

### 3.8 Three-way match

- **PRC-R23** [MUST] **Match engine**, triggered by `accounting.supplierInvoice.awaitingMatch`: voucher lines ↔ PO lines
  ↔ GRN lines received and not yet invoiced, with unit conversions, currencies and taxes; tolerances as data (unit price
  ±% / absolute, quantity, line and header totals); landed-cost vouchers match to shipment components (two-way); service
  lines two-way (PO + service confirmation). Outcome per line: `matched | price_variance | quantity_variance |
  awaiting_receipt | no_po_line | already_invoiced`. The result goes back through `accounting.recordMatchResult` with GL
  coding derived from the PO lines (GRNI clearing keys; price variance to purchase price variance or stock revaluation
  per stock policy).
- **PRC-R24** [MUST] **Exceptions**: price variance → buyer decides (accept, dispute with supplier, request credit note);
  quantity → wait for the receipt (automatic re-match when the GRN posts) or short-pay with a debit note; every exception
  has an owner and due date; who accepted which variance is auditable.
- **PRC-R25** [MUST] **GRNI**: open (uninvoiced) receipt lines with aging; the GRNI control account equals Σ open receipt
  line values at all times; old GRNI items require review at month end (ACC-R27 check).

### 3.9 Performance and analytics

- **PRC-R26** [MUST] **Supplier performance**: on time in full at the receiving location vs confirmed date, lead time by
  route (actual vs promised), reject rate, price variance vs contract, invoice accuracy (match exceptions), acknowledgement
  time; scorecards per period and category.
- **PRC-R27** [SHOULD] Spend analytics by category, supplier, department, property, origin, mode (air premium paid), and
  landed-cost share; savings vs previous price.

### 3.10 Coexistence

- **PRC-R28** [MUST] When `purchasing` is external (a procurement suite or ERP purchasing — CR-12): POs and receipts are
  mirrored read-only where the connector supports it (for stock receiving and commitments); Portico requisitions may be
  **forwarded** (`purchaseRequisitions: create`), pending until acknowledged. When `purchasing` is Portico but `payables`
  external: either matched invoice packs are forwarded to the ERP AP, or PO and GRN data are exported so the ERP matches
  (profile choice); never both.

## 4. Entities and states

`supplier_profile(supplier_id, categories[], routes jsonb, ordering jsonb, status, version)` · `supplier_item(supplier_id,
item_ref, supplier_code, pack jsonb)` · `compliance_document(supplier_id, kind, expires_at, file_ref)` ·
`price_list(id, supplier_id, currency, effective_from, effective_to?, source_ref)` · `price_list_line(...)` ·
`contract(id, supplier_id, terms jsonb, renew_at)` · `rfq(id, lines jsonb, invited[], status)` · `quote(rfq_id,
supplier_id, lines jsonb)` · `requisition(id, department_id, requester_id, status, source_ref?, version)` ·
`requisition_line(...)` · `approval_rule(id, conditions jsonb, chain jsonb, version)` · `purchase_order(id, number,
supplier_id, currency, route, status, version)` · `po_version(po_id, version, lines jsonb, sent_at?, approved_by)` ·
`po_ack(po_id, version, lines jsonb)` · `shipping_calendar(property_id, route, sailings jsonb)` · `shipment(id, mode,
legs jsonb, milestones jsonb, documents jsonb, status, version)` · `cost_component(shipment_id, kind, estimate, actual?,
basis, voucher_refs[])` · `landed_allocation(component_id, grn_line_id, amount)` · `goods_receipt(id, location_ref,
po_id?, shipment_id?, status, device_id?)` · `grn_line(id, grn_id, po_line_id, qty, unit, rejects jsonb, lots jsonb,
temperature?, value)` · `return_to_supplier(id, grn_line_ids[], status)` · `match_result(id, voucher_id, lines jsonb,
outcome, decided_by?)`.

**Requisition:** `draft → submitted → in_approval → approved → partially_ordered → ordered → closed` · `in_approval →
rejected` · `draft|submitted|approved → cancelled`.
**Purchase order:** `draft → in_approval → approved → sent → acknowledged → partially_received → received → closed` ·
`approved|sent|acknowledged → change_pending → approved` (new version) · `draft…acknowledged → cancelled` (no receipts) ·
`partially_received → closed_short` (reason).
**Shipment:** `planned → booked → in_transit → at_male → cleared → dispatched → arrived → received → costed_final` ·
any non-terminal may carry `delayed` with a new ETA.
**GRN:** `draft → posted` · `posted → reversed` (⚑, only lines not invoiced; linked reversal).
**Match result:** `pending → matched | exception → accepted | disputed → resolved`.

## 5. Invariants

- **PRC-I01** Σ received quantity per PO line (stock unit) ≤ ordered × (1 + over-receipt tolerance), unless an approved
  over-receipt exists.
- **PRC-I02** Σ invoiced quantity per GRN line ≤ received quantity; each GRN line value is relieved from GRNI at most
  once (clearing key).
- **PRC-I03** GRNI control account = Σ open receipt line values per entity after every committed transaction.
- **PRC-I04** PO numbers are gapless per entity series; sent PO versions are immutable.
- **PRC-I05** No requisition approved by its requester and no PO above threshold approved by its creator (SoD), except
  under the flagged single-person policy.
- **PRC-I06** Open commitments per budget line = Σ approved, not-yet-invoiced PO line values (functional currency).
- **PRC-I07** Landed cost: Σ allocations of a component = the component amount (estimate, then actual) to the minor unit;
  each actualization difference posts once.
- **PRC-I08** In non-live environments no PO, RFQ, debit note or remittance reaches a real supplier (`message.supplier`
  simulated).
- **PRC-I09** A supplier that is `suspended` or missing a mandatory valid document receives no new PO without an
  override record.

## 6. Cross-module interactions

Calls `accounting` (supplier master, `recordMatchResult`, budget availability, commitments), `stock` (`receive`, item
catalogue, reorder suggestions, transfer for the island leg, projections), `finance` (`postJournal` for non-stock
receipts and landed-cost accruals; FX rates), `identity` (approval chains, SoD), `platform` (properties, policies, data
authority `purchasing`), `integration` (supplier messages, external procurement mirrors). Consumes events from
`accounting`, `stock`, `operations`, `groups`. Never called synchronously by `accounting` or `stock`.
Dependency arrow (proposed): `procurement ─► accounting, stock, finance, platform, identity`.

### Proposed contract changes

Provider: `listOpenCommitments`, `getPurchaseOrder`, `listInboundForItem(tx, { propertyId, itemId })` (ETAs for stock
projections are pulled by `procurement` and pushed to `stock` via `stock.setInboundExpectations` to avoid a cycle),
`listExceptions` (common shape).

## 7. Events

`procurement.requisition.submitted|approved|rejected` · `procurement.po.approved|sent|acknowledged|changed|cancelled` ·
`procurement.shipment.delayed|arrived` · `procurement.receipt.posted|reversed` · `procurement.match.completed|exception`
· `procurement.landedCost.finalized` · `procurement.supplier.documentExpiring`.
Consumed: `accounting.supplierInvoice.awaitingMatch`, `accounting.supplier.blocked`, `stock.reorder.suggested`,
`operations.workOrder.partsRequested` (CR-16), `groups.eventOrder.distributed` (CR-26), `platform.dataAuthority.changed`.

## 8. Permissions

`procurement.requisition.create` · `procurement.requisition.approve` · `procurement.po.create` ·
`procurement.po.approve` ⚑ · `procurement.po.send` · `procurement.receipt.post` · `procurement.receipt.reverse` ⚑ ·
`procurement.return.create` · `procurement.priceList.manage` ⚑ · `procurement.contract.manage` ·
`procurement.rfq.manage` · `procurement.supplierProfile.manage` · `procurement.supplier.override` ⚑ ·
`procurement.shipment.manage` · `procurement.landedCost.finalize` ⚑ · `procurement.match.resolve` ⚑ ·
`procurement.approvalRule.manage` ⚑ · `procurement.calendar.manage` · `procurement.report.read`.

## 9. UX surfaces

- **Requisition** (desk and phone): item search with last price and stock on hand, order-by helper showing the next
  sailing, budget chip.
- **Approval inbox** (mobile-first): one card per request with budget impact, quotes, landed estimate, approve/decline
  with reason.
- **Purchasing workspace**: approved requisitions to convert, POs awaiting acknowledgement, late shipments, match
  exceptions, expiring supplier documents.
- **Shipment board**: legs and milestones as a timeline per shipment; documents checklist; cost components estimate vs
  actual.
- **Receiving app** (jetty/store, offline, scanner, blind mode, camera-first rejects, temperature entry).
- **Match exceptions queue** with PO/GRN/voucher side by side; **supplier scorecard**.

## 10. Proof scenarios and evidence

| ID | Procurement must demonstrate |
|---|---|
| B01 (supporting) | GRNI review and landed-cost finalization in the month-end close; GRNI = open receipts. |
| B11 | A container is delayed 10 days: ETAs, stock projections and suggestions update; air-freight top-up ordered; the duty voucher actualizes landed cost split between stock on hand and consumed. |
| B12 | Three-way match: price variance accepted partially with a debit note; a short delivery waits for the receipt and re-matches automatically. |
| B19 | In trial, POs and RFQs are simulated and watermarked; nothing reaches suppliers. |
| B20 | Hotel keeps its ERP for AP: matched packs forwarded once; no double posting of GRNI. |

## 11. Maldives specifics

- Almost everything is imported; Malé is the port of entry; resorts consolidate in Malé and ship by supply boat on a
  weekly or fortnightly cycle; fresh produce often comes by air; monsoon weather delays sailings [assumptions — confirm
  in discovery, Q64]. Hence shipping calendars, order-by dates and delay propagation are MUST.
- Import duty is levied under the Maldives Export Import Act (Law 31/79), with presidential discretion to waive it for
  certain goods; duty is generally assessed on the CIF value (Ministry of Finance; third-party guides). Resort-specific
  rules exist for offloading cargo at resorts (a permit after the customs declaration, offloading and customs-officer
  travel fees under schedule 36 of the Customs General Regulation, per a law-firm summary) — modelled as landed-cost
  components, rates as data marked `unverified`.
- Import GST and input-tax recovery for tourism-sector registrants need adviser confirmation (Q106).
- Foreign suppliers are commonly paid in advance by telegraphic transfer → supplier advances (ACC-R14) linked to POs.
- Halal certification for meat and special import permits for pork and alcohol for resorts are expected requirements
  [unverified — Q106]; compliance documents per supplier carry them.

## 12. Competitive inspirations

- Agilysys Eatec and Oracle Materials Control exist as separate inventory/procurement products integrated by file
  (research 01 §6.1, §6.4; coverage matrix §5.9) — Portico builds P2P on the same data as stock and accounting, and keeps
  file/API coexistence for hotels that keep those systems.
- Approval and separation-of-duty patterns follow IDN-R14/R15 rather than a separate workflow engine.

## 13. Open questions

Q106 (import GST recovery, customs data, halal/alcohol permits), Q107 (bank payment instructions — affects supplier
advances), Q64 (discovery of actual procurement systems and logistics patterns).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** (proposed SM-11 Procurement & stock — CR-27). Procurement needs no
  reservation data; budgets and AP may be in Portico or in the hotel's ERP.
- **Hard dependencies:** `platform`, `identity`, `stock` (for stock items), `finance` journal kernel (or journal-only mode
  exporting to the ERP), `accounting` supplier master (in connected mode a **mirror** of the ERP's vendors, read-only).
- **Connected mode:** `purchasing` external → mirror POs/receipts, forward requisitions (PRC-R28); `payables` external →
  forward matched packs or export PO/GRN data; supplier master mirrored from the ERP with mapping kind `supplier`
  (CR-18); budgets mirrored or absent.
- **Data-authority domains:** owns the proposed `purchasing` domain when authoritative; respects `payables`,
  `accounting`, `stock`.
- **Trial:** copied open POs and suppliers; receiving and matching rehearsed; no supplier communication.

## 15. Boundary — build here, integrate instead

| Capability | Decision | Why |
|---|---|---|
| Requisition → approval → PO → shipment → receipt → match | **Build** | Island logistics and landed cost are where generic tools fail Maldivian resorts |
| Supplier invoices, payments, supplier master | **`accounting`** (not procurement) | One payee master and one payment path |
| Customs filing, freight booking, carrier tracking | **Integrate / record** | Done by clearing agents and carriers; Portico records outcomes |
| Supplier networks, e-procurement marketplaces, group central procurement suites | **Integrate** (forward/mirror) | Hotels keep systems they like |
| Construction/capex tenders | **Integrate / LATER** | Different process, low frequency |

## Sources (verified 2026-11-07 via web search; Maldivian official pages read through search-indexed content)

- Import duty basis and waivers under the Export Import Act (Law 31/79):
  [Ministry of Finance — Revenue policy](https://www.finance.gov.mv/public-finance/revenue-policy); CIF basis (third-party):
  [Deepbeez — Maldives customs tariff](https://deepbeez.com/import-duty/maldives-customs-tariff).
- Offloading cargo at resorts and fees under schedule 36 of the Customs General Regulation (law-firm summary, undated):
  [CTL Strategies — Customs guidelines on offloading at resorts](https://www.ctlstrategies.com/?p=4653).
