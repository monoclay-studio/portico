# Spec change requests for the back-of-house modules

Status: Proposed · 2026-11-07. The new specs (`accounting`, `fnb-pos`, `procurement`, `stock`, `workforce`,
`concessions`, `utilities`) depend on the changes below. Nothing here is in force until the owning document is updated
(domain-map rule 1); existing specs were deliberately **not** edited on this branch. Each request names the target,
the change, the reason and which back-of-house stage it blocks (README §3). IDs `CR-nn` are referenced from the specs.

## A. Product direction

**CR-01 — Record the owner's back-of-house direction** · `docs/product/decisions.md`, `docs/product/vision.md` ·
blocks: nothing (documentation).
- Add decision **D12** (proposed text): "Portico will also cover back-of-house — accounting, F&B POS, procurement,
  stock, workforce, concessions and utilities — as deep, staged modules that coexist with systems a hotel keeps (all
  three adoption paths). Payroll computation stays with payroll providers unless the owner decides otherwise (Q101)."
- Vision "What we will not do": replace "No shallow clones of payroll, procurement or ERP; we define clean boundaries
  and integrate." with "No shallow clones: back-of-house modules are built deep, in stages, with explicit boundaries;
  hotels may keep their ERP, POS, procurement and HR systems and Portico integrates with them; payroll computation is
  integrated, not built (Q101)."
- Brief §12 is satisfied by explicit boundaries in each spec's §15. Owner confirmation of scope and sequencing: Q100.

## B. Finance (the ledger kernel)

**CR-02 — `postJournal` for sub-ledgers, control-account ownership, clearing accounts** · `finance.md` §3.1, §6;
domain map; new ADR-0015 · blocks BOH-2/3.
- New provider: `postJournal(tx, { legalEntityId, propertyId?, accountingDate, source: { module, docType, docId },
  lines: [{ accountId, debit|credit, currency, fxRateId?, dims, clearingKey?, subLedgerRef? }], description,
  reversesEntryId?, idempotencyKey })` → `{ entryId }`.
- Every account gets `control_owner` (`finance | accounting.payables | accounting.bank | accounting.fixedAssets |
  accounting.prepayments | accounting.intercompany | stock | clearing | null`). A line on a control account is accepted
  only from its owner module; `clearing` accounts accept declared modules and every line carries a `clearingKey`
  (e.g. `grn:{lineId}`, `lc:{shipmentId}:{component}`, `scdist:{runId}`, `cnc:{settlementId}`); open clearing items per
  key are listed and must net to zero when the business document completes. P&L accounts (`control_owner = null`)
  accept any authorized module subject to dimension rules.
- Dimension validation (ACC-R03) runs inside `postJournal`.
- **Proposed ADR-0015** "Sub-ledgers post through the finance journal": one journal per legal entity (ADR-0008) is
  kept; sub-ledger modules own their open items and post through finance; control accounts are owned; hand-offs
  between sub-ledgers use clearing accounts with keys. Rejected alternative: a separate accounting ledger fed by
  summaries (duplicates ADR-0008, guarantees reconciliation differences).

**CR-03 — Account records vs classification** · FIN-R01, domain-map catalog · blocks BOH-2.
- Finance keeps posting identity (code, type, currency, control owner, active); `accounting` owns classification,
  reporting trees, dimension rules and the CoA templates/UX. New `finance.upsertAccount(tx, {...})`. Without
  `accounting`, FIN-R01's seeded template remains as is.

**CR-04 — Accounting date** · FIN-R02, FIN-R04, glossary; ADR-0016 · blocks BOH-2.
- Journal entries gain `accounting_date` (and derived period). Guest-ledger postings: `accounting_date = business date`
  (FIN-I10 unchanged). Sub-ledger and manual journals: chosen date within a period open for the source.
- **Proposed ADR-0016** "Accounting date and period states are separate from business date": business date belongs to
  Day Close; accounting date belongs to period close (research 01 §6.5: date roll separate from fiscal close).

**CR-05 — Period states and cut-off matrix** · FIN-R43, §4.2 Period · blocks BOH-2.
- Period: `open → soft_closed → closed`, year `closed → final`; `closed → open` only via `finance.period.reopen` ⚑.
  Soft close holds a **cut-off matrix** (source module × allowed until × permission), e.g. guest ledger closes when the
  last business date of the period completes Day Close. New `setPeriodState(tx, {...})`, event
  `finance.period.stateChanged`. Without `accounting`, FIN-R43 behaves as today (`open → closed`).

**CR-06 — Scope and non-goals** · `finance.md` §2 · documentation.
- Replace "general ledger beyond hospitality revenue and its balance-sheet counterparts (expenses, payroll, procurement
  belong to the hotel's accounting/ERP — boundary per brief §12)" with "back-office accounting (payables, bank, fixed
  assets, close, statements, budgets) belongs to `accounting` or to the hotel's ERP when `accounting` is external;
  payroll computation belongs to the payroll provider". Add "journal-only mode" (CR-27) to §14.

**CR-07 — Commission accrual hand-off** · FIN-R31 · blocks ACC-R16.
- Emit `finance.commission.accrued { agencyId, stayId, amount }`; new `relieveCommissionAccrual(tx, { agencyId,
  stayRefs | amount, voucherRef, idempotencyKey })` posting Dr commissions accrued / Cr commission clearing
  (`comm:{voucherId}`), which the AP voucher clears.

**CR-08 — Cash deposits from cashier sessions** · FIN-R37 · blocks ACC-R23.
- New `recordCashDeposit(tx, { cashierSessionIds | amount, bankAccountRef, slipRef, idempotencyKey })`: Dr cash in
  transit (clearing `dep:{slipRef}`) / Cr cashier cash; bank reconciliation clears it.

**CR-09 — Charge eligibility and posting privileges** · finance §3.6/§3.7, reservations · blocks BOH-1.
- New `getChargeEligibility(tx, { propertyId, stayId | unitId, amount? })` → `{ privilege: allowed | cash_only |
  blocked, remainingLimit, limitSource: policy | authorization | deposit, folioPreview, reasons[] }`, used by `fnb-pos`,
  quick post, external POS intake (W-POS-01), concessions and minibar. Posting privilege is a stay attribute set at
  check-in (CR-34). Replaces the ad-hoc "room-charge permission and credit status" wording in RST-R01.

**CR-10 — Per-device fiscal series for POS receipts** · FIN-R32, FIN-I06; ADR-0017 · blocks BOH-1.
- Fiscal series may be scoped to a **device** (`allocateDeviceSeries(tx, { deviceId, kind: 'receipt' })`); numbers are
  assigned on the device, gapless within its series, verified on sync (`issueReceipt(tx, { seriesId, number, snapshot,
  idempotencyKey })` rejects duplicates and records gaps as exceptions). FIN-I06 extends to device series.
- **Proposed ADR-0017** "Offline POS: check leases, append-only lines and device-scoped fiscal series".
- Whether MIRA accepts device-scoped series and receipt timing for offline sales: Q106.

**CR-11 — Service-charge fund** · FIN-R01 (service charge account), §11 · blocks BOH-4.
- Service charge payable is tracked per **collection currency** (transaction currency of the underlying postings and
  payments). New `getServiceChargePool(tx, { scope, period })` → posted basis and collected basis per currency (payment
  allocations pro rata to service-charge components), and `allocateServiceChargeFund(tx, { runId, pools, deduction,
  idempotencyKey })`. Replaces "service charge account mapping configurable (payable to staff fund vs revenue) pending
  Q41" with the fund model when `workforce.serviceCharge` is enabled.

**CR-13 — Charge-code groups and POS keys** · FIN-R08, FIN-R12 · blocks BOH-1/5.
- New charge-code groups `tip` (liability "tips payable", never in the service-charge/TGST base) and `concession`
  (agent model → "due to concessionaire" liability; principal model → revenue).
- Comp policy per property: `comp_allowance` (revenue + contra allowance) or `house_folio`.
- Key for Portico POS settlements: `pos:{outletId}:{checkId}:{settlementId}:{chargeCode}`; FIN-R08's line-level key stays
  for external POS. Minibar key `minibar:{unitId}:{recordId}:{itemId}`.

## C. Platform, kernel, identity

**CR-12 — Governed data domains** · ADR-0014, CLAUDE.md rule 15, `platform.md`, glossary, `source-of-truth-matrix.md` ·
blocks connected modes of BOH-2…4.
- Narrow `accounting` to: general ledger, statutory statements, bank accounts and reconciliation, fixed assets, period
  close. Add: **`payables`** (supplier master, supplier invoices, supplier payments), **`purchasing`** (requisitions,
  purchase orders, receipts), **`stock`** (stock on hand and valuation), **`staffRecords`** (employee master, documents),
  **`timeAttendance`** (rosters of record, punches, leave balances). Payroll is not a domain (always external).
- **Outlet charge-source registration** (not a domain): each outlet names exactly one charge source (`portico_pos |
  external:<connectionId> | quick_post | none`); a second POS posting for the same outlet is rejected (extends CR-4 of
  the source-of-truth matrix).
- Matrix rows per adoption path and representative setup for the new domains (RS-2: `payables`/`accounting` usually
  external, `purchasing`/`stock` Portico or external).

**CR-21 — Identity: approvals, segregation, elevation, auditors, employees** · `identity.md` IDN-R13…R15, §2 · blocks
BOH-1…4.
- IDN-R15: **multi-step approval chains** with conditions, delegations (dated), mobile decision, consumption per step.
- IDN-R14: SoD rule set as data incl. P2P pairs (requester/approver, PO creator/approver, receiver/creator, invoice
  approver/payment releaser, supplier-bank maintainer/payment releaser, service-charge calculator/approver), a
  documented single-person policy for the guesthouse profile that flags instead of blocking.
- **Elevation on shared devices**: a manager authorizes an action on a server's tablet with PIN/passkey; recorded as a
  distinct actor (POS voids, comps, overrides).
- **Auditor role**: time-boxed read-only access to accounting data with per-read audit (ACC-R48).
- **Employee ≠ staff member**: identity stores users; `workforce` stores employees and links them; §2 non-goal "HR
  records, payroll, rosters" becomes "owned by `workforce` (payroll external)".
- IDN-R13 "salary-like data never stored": amend to "individual salaries and salary bank accounts are never stored;
  per-employee service-charge shares and days worked may be stored field-restricted (`workforce.serviceCharge.
  readIndividual` ⚑, audited)" — owner decision Q102.

**CR-22 — Platform attributes** · PLT-R18, PLT-R19 · blocks BOH-1/5.
- Outlet: `sector` (`tourism | general`), `alcoholLicensed`, `operatedBy` (`hotel | concessionaire:<id>`), `chargeSource`
  (CR-12). Departments: USALI department mapping key (ACC-R03). Locations: staff-housing buildings and plant areas as
  operations locations. Legal entity: link to the accounting fiscal calendar (owned by `accounting`).

**CR-25 — Environment effects** · `packages/kernel/src/environment.ts`, PLT-R04, CLAUDE.md rule 12 · blocks BOH-2/3.
- New effects: `message.supplier` (POs, RFQs, remittances, debit notes, bank-detail notices, partner statements —
  simulated in demo/trial/training, live only in `live`) and `bank.payment` (submitting payment instructions to a bank
  API — LATER; blocked outside live). Rule: payment and payroll **files** generated outside `live` are watermarked
  `NOT FOR BANK — <environment>` / `NOT FOR PAYROLL — <environment>` (B19).

## D. Other module specs

**CR-14 — payments** · `payments.md` §2, §3.8 · documentation.
- Non-goals: supplier, payroll and concession payments are not `payments` (they are `accounting` payment runs executed
  by the hotel's bank). PAY-R25: expose `listPayouts(tx, { legalEntityId, range })` for bank reconciliation (ACC-R23);
  merchant-model OTA payouts carry the deducted commission as a fee component posted to commission expense (ACC-R17).
  PAY-R24: acquirer batch settlements recorded via `finance.recordPayout` with gross/fees/net. POS terminals are
  `payments` terminals; `fnb-pos` is a caller like the front desk.

**CR-15 — resort** · `resort.md` §2, §3.1, §3.5, §6 · blocks BOH-1.
- Move RST-R01 (POS intake) to FNB-R26 and RST-R02 (outlet posting app) to FNB-R25 (retire with strikethrough and a
  pointer). Resort keeps RST-R03 and exposes `evaluateEntitlements(tx, { stayId, occupantRefs, serviceDate, period,
  outletId, lines: [{ itemRef, entitlementClasses, amount }] })` and `recordEntitlementUse(tx, {...,
  idempotencyKey })` for `fnb-pos`, minibar (`stock`) and quick post. Entitlement classes come from rates package
  definitions (rates adds `entitlementClasses` to inclusions — note to `rates.md`).
- RST-R14 (requisitions LATER, "Portico does not manage stock levels or purchase orders") is superseded by
  `procurement`/`stock`; non-goals "full POS (integrate…)" and "procurement/stock (integrate)" are replaced by
  references to the new modules with coexistence. RST-R07 staff qualifications read from `workforce`
  (`findQualifiedStaff`). Concession partners: see `concessions.md`. Domain-map arrow `resort ─► …` unchanged; new
  arrow `fnb-pos ─► resort`.

**CR-16 — operations** · `operations.md` §2, OPS-R08, OPS-R16, §6 · blocks BOH-3/4/5.
- Non-goals "purchasing, stock and payroll (integrate)" and "laundry/linen inventory management (LATER)" become
  references to `procurement`, `stock` (STK-R17 linen) and `workforce`, payroll external.
- OPS-R08 minibar consumption delegates to `stock.recordMinibarConsumption` when `stock.minibar` is enabled; otherwise
  the SHOULD direct charge remains.
- OPS-R16 parts notes: "request parts" creates a stock internal requisition or a procurement requisition
  (`operations.workOrder.partsRequested`); parts issued are stock issues to the work order (cost on the work order).
- Work orders are created by `utilities` (plant degradation) and `workforce` (staff housing) through a public
  `createWorkOrder` (already proposed as contract change 3).

**CR-17 — analytics** · `analytics.md` ANL-R02, ANL-R05, ANL-R06 · blocks BOH-2+ reporting.
- Metric families: F&B (covers, average check, food/beverage cost %, theoretical vs actual), stock (days of cover,
  wastage %, variance), procurement (OTIF, landed-cost share), labour (hours per occupied room, covers per labour hour,
  overtime %), utilities (kWh, m³, waste kg per occupied unit-night and per island person-night, emissions), financial
  (GOPPAR, flow-through, budget vs actual from `accounting`).
- Data-quality checks: unmapped sold items, unmapped external POS items, missing meter readings, expired certifications
  in active rosters, open clearing items older than N days.
- Statements remain owned by `accounting` (ledger-computed); analytics links to them, like finance reports today.

**CR-18 — integration workflows and mappings** · INT-R02, INT-R10, INT-R25 · blocks connected modes.
- Workflow identifiers: `posSales`, `menuItems`, `supplierInvoices`, `supplierPayments`, `suppliers`,
  `purchaseRequisitions`, `purchaseOrders`, `goodsReceipts`, `stockIssues`, `stockLevels`, `bankStatements`,
  `paymentInstructions` (LATER), `payrollInputs`, `payrollJournals`, `staffRecords`, `timePunches`, `utilityReadings`,
  `concessionSales`; `journals` gains `read` (external PMS revenue journals).
- Mapping kinds: `supplier`, `stockItem`, `menuItem`, `employee`, `costCentre`, `taxCode`, `meter`, `bankAccount`;
  financially significant: `supplier`, `taxCode`, `bankAccount`, `costCentre`.
- INT-R25 local connector gains the **outlet hub** role (local sync of checks/KDS/printers, ESC/POS print bridge) with
  documented outage behaviour; and Modbus/BMS reading role for utilities (unverified).
- ERP export connectors (ACC-R49) registered as connector definitions starting at R1.

**CR-19 — coverage matrix rows** · `docs/adoption/integration-coverage-matrix.md` §3, §5 · documentation.
- Add W-ACC-06 supplier invoices to ERP AP, W-ACC-07 supplier payments status, W-ACC-08 bank statements, W-POS-08
  item-level sales, W-PROC-02 purchase orders, W-PROC-03 goods receipts, W-HR-01 staff records, W-HR-02 time punches,
  W-HR-03 payroll inputs, W-HR-04 payroll journals, W-UTL-01 meter readings; providers: payroll providers (P2,
  discovery), biometric clocks (P2), bank statement formats (P1, Q107). W-PROC-01 changes from "Boundary: Portico does
  not become the procurement system" to "coexistence with external procurement".

**CR-20 — day-close** · DCL-R01 · blocks BOH-1.
- Exception sources: `fnbPos.outlet.notClosed`, `fnbPos.roomCharge.unposted`, `fnbPos.device.queueStale` (warning),
  `stock.negative.detected` (warning), `fnbPos.fiscalSeries.gapDetected` (blocking per policy).

**CR-26 — groups** · GRP-R12 · blocks nothing core.
- Event orders may create stock internal requisitions and procurement requisitions (catering, décor) with source
  reference; BEO costing from recipes (STK-R13) shown to the sales manager.

**CR-33 — guests** · guests provider contract · blocks BOH-1.
- `getServiceAlerts(tx, { profileId, purpose: 'fnb' })` returning minimal allergy/dietary fields and photo-consent flag,
  so outlets never load full profiles; partner (concessionaire) scopes receive name match only.

**CR-34 — reservations** · check-in workflow, stay attributes · blocks BOH-1.
- Stay attribute `postingPrivilege` (`allowed | cash_only | blocked`) with reason, set at check-in (default from
  guarantee: no guarantee → `cash_only`), changeable with permission and audit; shown on the stay and to outlets via
  CR-09. Bar tabs auto-posted at outlet close appear on the folio with a description. Staff housing never appears in
  front-desk views (WFM-R14).

## E. Architecture and adoption documents

**CR-23 — Glossary additions** · `docs/product/glossary.md` · blocks naming in code.
- **Stock** (goods held for use or sale — never "inventory"), **Stock item**, **Store** (place where stock is kept),
  **Stock movement**, **Par level**, **Count sheet**, **Recipe**, **Theoretical consumption**, **Supplier**,
  **Purchase requisition**, **Purchase order**, **Shipment** (consolidated goods movement with legs), **Landed cost**,
  **Goods receipt (GRN)**, **GRNI** (goods received not invoiced), **Three-way match**, **Supplier invoice (voucher)**,
  **Payment run**, **Bank statement**, **Bank reconciliation**, **Accounting date**, **Accounting period** (states),
  **Control account / sub-ledger**, **Clearing account**, **Dimension**, **Budget / Forecast**, **Fixed asset**,
  **Depreciation run**, **Intercompany**, **Management agreement**, **Check** (an outlet bill before settlement),
  **Course**, **Kitchen ticket**, **Prep station**, **Service period**, **Posting privilege**, **Comp**, **Void**,
  **Outlet hub**, **Employee** (may have no user), **Roster**, **Shift**, **Punch**, **Days worked**, **Staff housing**,
  **Work permit**, **Quota slot**, **Service-charge distribution run**, **Payroll input**, **Concessionaire**,
  **Settlement statement**, **Meter**, **Reading**, **Cost pool**, **Emission factor**, **Island person-night**.

**CR-24 — Domain map** · `docs/architecture/domain-map.md` · blocks BOH-1 start.
- Catalog rows: `accounting` (`accounting`; reporting structure, payables, bank, close, statements, tax return data,
  assets, budgets, agreements; wave 4), `fnb-pos` (`fnb_pos`; outlet POS, external POS intake, quick post; wave 3b),
  `procurement` (`procurement`; wave 4), `stock` (`stock`; wave 4), `workforce` (`workforce`; wave 4), `concessions`
  (`concessions`; wave 4), `utilities` (`utilities`; wave 4).
- Arrows (no cycles; verified):
  ```
  accounting   ─► finance, platform, identity, integration
  fnb-pos      ─► finance, reservations, guests, rates, resort, payments, platform
  procurement  ─► accounting, stock, finance, platform, identity
  stock        ─► finance, resort, platform
  workforce    ─► identity, platform, finance, analytics, operations
  concessions  ─► finance, accounting, utilities, workforce, platform
  utilities    ─► operations, stock, accounting, platform
  finance      ─► rates (already proposed), platform
  ```
  `accounting` never calls `procurement`, `stock`, `workforce`, `concessions` or `utilities` synchronously (events
  only); `stock` never calls `procurement` (inbound ETAs are pushed by procurement); `resort` never calls `fnb-pos`.
- Provider contracts as listed in each spec's §6 "Proposed contract changes" and CR-02…CR-13 above.

**CR-27 — Adoption paths: new standalone modules** · `docs/adoption/adoption-paths.md` §3–§5 · documentation.
- **SM-11 Procurement & stock** (Yes): alongside any PMS; journals to Portico accounting or exported to the ERP.
- **SM-12 Outlet POS alongside a PMS** (Conditional): needs a verified `posCharges` forward for room charges; otherwise
  daily posting list labelled as manual.
- **SM-13 Back-office accounting alongside a PMS** (Conditional): finance in **journal-only mode** fed by the PMS
  revenue journal (file or API); folio drill-down `incomplete`.
- **SM-14 Workforce** (Yes): rosters, attendance, housing, compliance, service charge (from the PMS revenue journal or
  report when the PMS holds charges).
- **SM-15 Utilities & sustainability** (Yes).
- §5 "Not offered standalone": keep "Finance (folios, ledger)" but add the journal-only exception for SM-13; keep
  "Meal-plan entitlements, outlet charge intake" as not standalone **except** through SM-12 with mirrored entitlements
  (`incomplete` when the PMS does not expose them).

**CR-28 — Readiness documents** · `docs/readiness/market-matrix.md` §2.4, `maldives-tax-rules.md` open items,
`dependency-register.md`, `readiness-register.md`, `docs/adoption/roadmap.md` · documentation.
- Market matrix §2.4: replace "Portico does not calculate staff distributions" with the WFM-R21 calculation (rule pack
  `unverified`, Q103).
- Adviser list additions (Q106): input tax and import GST recovery, withholding on non-resident payments (e.g. foreign
  OTA commissions), concession agent/principal treatment (Q104), device-scoped receipt series and offline receipt
  timing, staff purchases and staff meals, utilities recharges to partners, employment rule pack values, statutory
  financial statement presentation.
- Dependency register: payroll providers (discovery), biometric clocks, bank statement formats and payment-file formats
  per bank (BML, MIB — Q107), POS printers/KDS hardware (Q108), Xpat portal (manual only), customs clearing agents
  (manual), emission-factor sources.
- Readiness register: every requirement of the seven specs enters at R1; ERP connectors and POS hardware rows have
  separate technical and external-approval columns.

**CR-29 — Editions and entitlement keys** · `docs/product/editions.md` §4.2, §5, §7 · blocks commercial packaging only.
- New keys: `accounting.core`, `accounting.payables`, `accounting.fixedAssets`, `accounting.budgets`,
  `accounting.consolidation`, `accounting.managementAgreements`, `fnb.pos`, `fnb.kds`, `procurement.purchasing`,
  `procurement.logistics`, `procurement.sourcing`, `stock.core`, `stock.recipes`, `stock.minibar`, `stock.linen`,
  `workforce.rostering`, `workforce.timeAttendance`, `workforce.compliance`, `workforce.housing`,
  `workforce.serviceCharge`, `concessions.settlement`, `utilities.metering`, `utilities.allocation`,
  `utilities.sustainability`.
- Proposed packaging (no prices — Q3/Q109): Essentials add-on "Guesthouse books" (`accounting.core` compact CoA,
  bank reconciliation, MIRA return data); Professional add-ons per module; Resort includes `fnb.pos`, `fnb.kds`,
  `stock.minibar`; Enterprise includes all; Connect packs SM-11…SM-15. Never gated: ERP export profiles, offline POS,
  environment safety, audit.

**CR-30 — Scenario catalogue** · `docs/scenarios/README.md` · documentation.
- Add §4 "Back-of-house proof scenarios" B01–B20 from `docs/backofhouse/scenarios.md` and the participation matrix;
  test names `scenarios/bNN-*.test.ts`.

**CR-31 — Personas** · `docs/product/personas-and-workspaces.md` · documentation.
- P18 Financial controller ("Nadia" — close cockpit), P19 AP & purchasing officer ("Rasheed"), P20 Storekeeper
  ("Suresh" — jetty receiving, counts), P21 Executive chef ("Antonio" — recipes, theoretical vs actual), P22 Server/
  bartender ("Dilshan" — tablet, offline), P23 HR & compliance manager ("Aminath" — rosters, Xpat, service charge),
  P24 Chief engineer ("Ibrahim" extends P7 — utilities), P25 Concession manager. P8 (outlet cashier) gains the Portico
  POS workspace.

**CR-32 — Specs README** · `docs/specs/README.md` · documentation.
- Wave table: 3b `fnb-pos`; 4 `accounting`, `procurement`, `stock`, `workforce`, `concessions`, `utilities`. Prefixes:
  ACC, FNB, PRC, STK, WFM, CNC, UTL. Spec sections add §15 "Boundary — build here, integrate instead" for back-of-house
  specs.

**CR-35 — Alignment with rules added on `main` after this branch was cut** · all seven specs · blocks merge review.
- `main`'s CLAUDE.md now has rule 17 (universal record contract: `status`, `allowedActions` with disabled reasons,
  `issues`, `owner`, `links`; modules declare `recordTypes` and a `SearchProvider`) and a parity gate
  (`docs/parity/README.md`). On merge, each back-of-house spec adds its record types (e.g. accounting: supplier,
  supplier invoice, payment run, bank reconciliation, period; fnb-pos: check, outlet day; procurement: requisition,
  purchase order, shipment, goods receipt; stock: item, store, count sheet, transfer; workforce: employee, roster,
  service-charge run, work permit; concessions: agreement, settlement; utilities: meter, cost pool) and a parity matrix
  before any module is called complete.
