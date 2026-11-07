# procurement — 10x brief (island-aware purchasing)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 4, BOH-3) · Spec `docs/specs/procurement.md`
(PRC-R01–R28) · Parity `docs/parity/procurement.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are
TARGETS until validated with resort purchasing staff.**

## 1. Current state (evidence)

- **No `procurement` code exists.** Dependencies not yet built either: `accounting` (supplier master, three-way match
  into supplier invoices, budget check) and `stock` (receiving into stores).
- **Parity:** 41 rows / 26 edge cases, 0% tested, **40 P0 open**; P1 missing EC-PRC-016 (emergency purchase of a generator
  part bypassing normal approval). Baseline: Oracle F&B back-office inventory (ordering, receiving, vendor catalogue),
  QuickBooks/NetSuite/Xero purchasing (parity file header).
- **Maldives context:** everything is shipped to Malé, cleared, consolidated and carried by boat (spec §1); resort diesel
  averages 33.2 L per bed-night and fuel prices shocked costs in 2026 (DD09 §5; DG §2 procurement/stock row).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Hospitality purchasing | Oracle F&B back office | Vendor order settings, purchase catalogues with effectivity, compare/copy catalogues | PAR-PRC baseline |
| SMB approvals | QuickBooks, Xero | PO and bill approval workflows | PAR-PRC baseline |
| Mid-market | NetSuite | Three-way match | PAR-PRC baseline |

No research found a purchasing product built for island logistics (shipment legs, Malé consolidation, boat transfer,
landed cost) — this is where Portico can be measurably better (assumption to validate in discovery, Q64).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Requisition → approval rules as data → PO with island-aware dates (lead time incl. Malé consolidation and boat) | PRC-R06–R13 |
| 2 | Shipments with delays propagating to requisitions and departments | PRC-R15, R16 |
| 3 | Landed cost (freight, duty, handling) and customs data per line | PRC-R17, R18 |
| 4 | Goods receipt at the island store; Malé → island transfer; returns | PRC-R19–R22 |
| 5 | Three-way match with exceptions; GRNI | PRC-R23–R25 |
| 6 | Supplier price lists and performance (on-time, fill rate) | PRC-R03, R26 |
| 7 | Emergency purchase path with after-the-fact approval and audit | EC-PRC-016 |
| 8 | External procurement suite coexistence (authority `purchasing`) | PRC-R28 |

## 4. The 10x outcome (TARGETS)

**Picture:** the chef requests 40 kg of flour on Monday; the system knows the Thursday boat is the last that arrives
before the weekend, routes approval, sends the PO, tracks the shipment from Malé, and when the boat is delayed the
kitchen and the stock days-of-cover alert update by themselves — and the invoice matches the receipt without anyone
re-typing it.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Invoices auto-matched (PO × GRN × invoice within tolerance) | ≥ 85%, the rest as owned exceptions |
| Seamless | Requisition to sent PO | ≤ 2 min for catalogue items |
| Friendly | Delays discovered only at receiving | 0 (shipment events propagate) |
| Well-rounded | Landed cost applied to stock valuation | 100% of imported receipts |

## 5. Next 3 increments

Start only after `stock` increment 1 and `accounting` increment 2 (supplier master, journals) exist.

### Increment 1 — Requisitions, approvals, POs
- Requisitions with island-aware need-by dates, approval rules as data with separation of duties, budget check through
  accounting, POs (immutable versions on change), sending (environment effect), emergency path.
- **Acceptance:** PRC-R06–R13 and EC-PRC-016 tested.

### Increment 2 — Shipments, landed cost, receiving
- Shipment legs (supplier → Malé → island), delay propagation, landed cost allocation, customs data, GRN at the island
  store posting to stock and GRNI, returns.
- **Acceptance:** PRC-R15–R22, R25 tested; landed cost flows into stock valuation.

### Increment 3 — Match and supplier performance
- Three-way match engine with tolerances and exceptions, supplier price lists, performance metrics, external suite
  coexistence.
- **Acceptance:** PRC-R03, R23, R24, R26, R28 tested.

## 6. Cross-module dependencies and contract changes

**accounting:** supplier master, invoices, budget check, journals. **stock:** stores, receipts, valuation, reorder
suggestions as requisition input. **operations:** work orders requesting parts. **utilities:** fuel purchases.
**platform:** departments and approval policies. **identity:** approvals primitive.

## 7. Power check — never lose or hide

Separation of duties by default; every PO version kept; approvals by people, not principals; emergency purchases are
audited and reviewed, never invisible; Portico never pays suppliers itself.
