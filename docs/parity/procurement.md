# Parity: procurement

Module: `procurement` (supplier purchasing profiles, price lists, contracts, RFQ, requisitions, approvals, purchase
orders, shipments and landed cost, receiving, returns, three-way match, GRNI, supplier performance) · Spec:
`docs/specs/procurement.md` (merged on `main`).

**Baseline.** Oracle Food & Beverage back-office Inventory Management (ordering, receiving, invoicing, B2B, vendor
catalogue) as the hospitality reference, QuickBooks purchase-order and bill-approval workflows, NetSuite, Xero bills;
island-logistics realities of Maldivian resorts. Evidence links at the end; **all verified 2026-11-07**.

**Status rule.** No `procurement` code on `main` or any branch: `specified` (PRC-Rnn), `deferred`, or `missing`.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-PRC-001 | Purchasing profile per supplier (order contact, delivery settings, lead times, minimums) | Oracle F&B [vendor order settings][fb-vendor-order] · [delivery settings][fb-vendor-delivery] | P0 | specified | procurement.md PRC-R01 | — |
| PAR-PRC-002 | Supplier onboarding workflow with vetting checklist | assumption (procurement practice) | P1 | specified | procurement.md PRC-R02 | — |
| PAR-PRC-003 | Supplier price lists by item, pack, currency, dates, quantity breaks | Oracle F&B [vendor purchase catalog][fb-vpc] · [effectivity range][fb-vpi-effectivity] | P0 | specified | procurement.md PRC-R03 | — |
| PAR-PRC-004 | Compare vendor items and copy catalogues between suppliers | Oracle F&B [copy and compare VPIs][fb-vpi-compare] | P2 | missing | — | — |
| PAR-PRC-005 | Supplier contracts with volume commitments and renewal reminders | assumption | P1 | specified | procurement.md PRC-R04 | — |
| PAR-PRC-006 | RFQ to several suppliers with comparison | assumption (procurement suites) | P1 | specified | procurement.md PRC-R05 | — |
| PAR-PRC-007 | Electronic catalogue, order and invoice exchange with suppliers (B2B) incl. price-variance acceptance | Oracle F&B [B2B solutions][fb-b2b] · [accept price variances][fb-b2b-variance] | P2 | deferred | procurement.md PRC-R01 — portal and EDI LATER | — |
| PAR-PRC-010 | Purchase requisitions from departments (stock, non-stock catalogue, free text, services, capex) | Oracle F&B [issue requests][fb-requests] | P0 | specified | procurement.md PRC-R06 | — |
| PAR-PRC-011 | Island-aware order-by dates from lead times, sailing schedules and customs | assumption (Maldives logistics) | P0 | specified | procurement.md PRC-R07 | — |
| PAR-PRC-012 | Budget check at submission (warn / extra approval / block) | QuickBooks [approval workflows][qb-approval] | P1 | specified | procurement.md PRC-R08; accounting.md ACC-R40 | — |
| PAR-PRC-013 | Approval rules as data by amount, category, department, capex/opex | QuickBooks [PO and bill approval][qb-po-approval] | P0 | specified | procurement.md PRC-R09 | — |
| PAR-PRC-014 | Separation of duties (requester ≠ approver, PO creator ≠ approver, receiver ≠ buyer) | QuickBooks [payment release roles][qb-approval] | P0 | specified | procurement.md PRC-R10 | — |
| PAR-PRC-020 | Purchase orders with supplier codes, packs, tax, delivery location and terms | Oracle F&B [ordering][fb-ordering] | P0 | specified | procurement.md PRC-R11 | — |
| PAR-PRC-021 | Create orders by order cycle, by list, by vendor, from suggested quantities | Oracle F&B [order by cycle][fb-order-cycle] · [suggested quantity][fb-order-suggested] | P0 | specified | procurement.md PRC-R11; stock.md STK-R20 (suggestions) | — |
| PAR-PRC-022 | Change orders as new immutable PO versions | assumption (procurement control) | P0 | specified | procurement.md PRC-R12 | — |
| PAR-PRC-023 | Send PO by email (PDF) with supplier acknowledgement | Oracle F&B [B2B load orders][fb-b2b-load] | P0 | specified | procurement.md PRC-R13 | — |
| PAR-PRC-024 | Standing and recurring orders with call-offs | Oracle F&B [master order list][fb-master-order-list] | P1 | specified | procurement.md PRC-R14 | — |
| PAR-PRC-025 | View open, suspended, pending and booked orders | Oracle F&B [view orders][fb-view-orders] | P0 | specified | procurement.md §9 | — |
| PAR-PRC-026 | Close purchase orders with remaining quantities | Oracle F&B [close PO][fb-close-po] | P1 | specified | procurement.md §4 (PO states) | — |
| PAR-PRC-030 | Shipments grouping PO lines with legs, milestones, documents and parties | assumption (Maldives import logistics) | P0 | specified | procurement.md PRC-R15 | — |
| PAR-PRC-031 | ETA changes propagate to requisitions and stock projections with suggested actions | assumption | P0 | specified | procurement.md PRC-R16 | — |
| PAR-PRC-032 | Landed cost (freight, insurance, duty, import GST, port, clearing, inter-island freight) estimated then actualized and allocated | Oracle F&B [foreign currency per vendor][fb-fcy] · NetSuite [landed cost in close][ns-close] | P0 | specified | procurement.md PRC-R17 | — |
| PAR-PRC-033 | Customs data per line (HS code, origin, duty rate as data, declaration number) | assumption (customs practice) | P1 | specified | procurement.md PRC-R18 | — |
| PAR-PRC-040 | Goods receipt against PO or shipment; blind receiving; partial and over-receipt tolerance | Oracle F&B [receipt from PO][fb-receipt-po] · [blank receipt][fb-receipt-blank] | P0 | specified | procurement.md PRC-R19 | — |
| PAR-PRC-041 | Rejects with reason/photo, temperature readings, lot and expiry capture | Oracle F&B [add rating to reason code][fb-reason-rating] | P0 | specified | procurement.md PRC-R19 | — |
| PAR-PRC-042 | Substitutions on receipt with buyer approval | Oracle F&B [substitute items on receipt][fb-receipt-substitute] | P1 | specified | procurement.md PRC-R19 | — |
| PAR-PRC-043 | Offline receiving at the jetty in the staff app | assumption (night arrivals) | P0 | specified | procurement.md PRC-R19 | — |
| PAR-PRC-044 | Change cost centre on receipt lines | Oracle F&B [change cost centres on receipt][fb-receipt-cc] | P1 | specified | procurement.md PRC-R20 (PO-line dimensions) | — |
| PAR-PRC-045 | Receipt posting to stock (valuation) or expense/asset, with GRNI | assumption (accrual accounting) | P0 | specified | procurement.md PRC-R20 | — |
| PAR-PRC-046 | Service confirmation receipts by the requesting department | assumption | P1 | specified | procurement.md PRC-R20 | — |
| PAR-PRC-047 | Returns to supplier with debit-note request | Oracle F&B [return items to vendor][fb-returns] | P0 | specified | procurement.md PRC-R21 | — |
| PAR-PRC-048 | Malé warehouse → island transfers through in-transit store | assumption (Maldives) | P0 | specified | procurement.md PRC-R22 | — |
| PAR-PRC-050 | Three-way match engine (PO ↔ receipt ↔ invoice) with tolerances | Oracle F&B [invoice by receipt][fb-invoice-receipt] | P0 | specified | procurement.md PRC-R23 | — |
| PAR-PRC-051 | Price/quantity variance exceptions: accept, dispute, request credit | Oracle F&B [accept price variances][fb-b2b-variance] | P0 | specified | procurement.md PRC-R24 | — |
| PAR-PRC-052 | GRNI aging and control-account equality | assumption | P0 | specified | procurement.md PRC-R25 | — |
| PAR-PRC-053 | Send approved invoices to AP | Oracle F&B [approved invoice to AP][fb-invoice-ap] | P0 | specified | accounting.md ACC-R13 | — |
| PAR-PRC-060 | Supplier performance (on-time in-full, lead time, rejects) | Oracle F&B [reason code ratings][fb-reason-rating] | P1 | specified | procurement.md PRC-R26 | — |
| PAR-PRC-061 | Spend analytics by category, supplier, department, origin, mode | assumption | P1 | specified | procurement.md PRC-R27 | — |
| PAR-PRC-062 | Connected mode with an external procurement suite (mirrors POs/receipts) | assumption (adoption brief) | P1 | specified | procurement.md PRC-R28 | — |
| PAR-PRC-063 | Supplier self-service portal (acknowledge PO, upload invoice, see payment status) | assumption (procurement suites) | P2 | deferred | procurement.md PRC-R01 — supplier portal LATER | — |
| PAR-PRC-064 | Punch-out catalogues to large online suppliers | assumption | P2 | missing | — | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-PRC-001 | Supply boat delayed 9 days by weather | ETA change propagates; stock projection shows which items fall below safety stock and when; actions suggested (air top-up, substitute, sister-property transfer, Malé purchase) | P0 | specified | — |
| EC-PRC-002 | Goods arrive at the jetty at 23:00 with no connectivity | Offline GRN in staff app with signature and photos; queued idempotent commands post once on reconnect | P0 | specified | — |
| EC-PRC-003 | Chilled delivery arrives above temperature limit | Line rejected with reading and photo; return/debit-note flow; supplier performance records the reject | P0 | specified | — |
| EC-PRC-004 | Delivery is 12% over the ordered quantity (tolerance 5%) | Over-receipt blocked beyond tolerance; buyer approval needed to accept extra; otherwise returned | P0 | specified | — |
| EC-PRC-005 | Supplier substitutes a different brand | Substitution needs buyer approval; price and item recorded as delivered; recipe costs update via stock | P1 | specified | — |
| EC-PRC-006 | Requester tries to approve their own requisition | Refused (SoD); routed to next approver | P0 | specified | — |
| EC-PRC-007 | PO changed after the supplier acknowledged it | New PO version; supplier sent the change; earlier version kept; receipts match the latest version | P0 | specified | — |
| EC-PRC-008 | Supplier invoice price higher than PO beyond tolerance | Match exception to buyer: accept, dispute, or credit note; AP voucher not approved meanwhile | P0 | specified | — |
| EC-PRC-009 | Invoice arrives before goods are received | Match waits (`awaiting_receipt`); no payment approval; aging shows the hold | P0 | specified | — |
| EC-PRC-010 | Goods received, invoice never arrives by month end | GRNI accrual stays; GRNI aging flags it; accrual relieved when invoice matches | P0 | specified | — |
| EC-PRC-011 | Import duty assessed differs from the estimate | Actualization posts the difference once: to stock for quantities on hand, to cost of sales/variance for consumed quantities | P0 | specified | — |
| EC-PRC-012 | Import GST is recoverable for one registration and not for another | Rule-pack data decides (unverified, Q106); non-recoverable share added to landed cost; recoverable to input tax | P1 | specified | — |
| EC-PRC-013 | Island receives fewer cases than left the Malé warehouse | Difference recorded as transfer variance (not a supplier claim) with in-transit leg evidence | P0 | specified | — |
| EC-PRC-014 | Supplier quotes in EUR, pays in USD, freight invoiced in MVR | Each document in its currency with business-date rates; landed cost allocated in functional currency; realized FX at payment | P0 | specified | — |
| EC-PRC-015 | Budget exhausted for the department this month | Policy outcome shown before submission (warn, extra approval, or block) with budget, actual and commitments | P1 | specified | — |
| EC-PRC-016 | Emergency purchase (generator part) bypassing normal approval | Allowed only with an emergency reason code and post-approval within policy hours; flagged in reports | P1 | missing | — |
| EC-PRC-017 | Partial shipment: half the PO arrives on one boat, the rest next week | Partial receipts; PO stays open; GRNI per receipt line; match per receipt | P0 | specified | — |
| EC-PRC-018 | Product recall notice for a lot already issued to outlets | Lot traced to stores and issues (stock); quarantine and return flow; affected outlets alerted | P1 | specified | — |
| EC-PRC-019 | Supplier changes price list effective mid-order cycle | Price snapshotted on the PO line with the list version; later lists don't change sent POs | P0 | specified | — |
| EC-PRC-020 | Clearing agent invoice covers three shipments | Components coded to each shipment; allocation per component basis; actualization per shipment | P1 | specified | — |
| EC-PRC-021 | Duplicate PO email sent twice due to retry | Message effect keyed; supplier receives one send per version; resend explicit | P1 | specified | — |
| EC-PRC-022 | Demo/trial environment creates a PO | Supplier message simulated and labelled; no real email leaves the environment | P0 | specified | — |
| EC-PRC-023 | Capex item received (desalination pump) | Receipt creates a pending fixed asset with landed cost; capitalization in accounting | P1 | specified | — |
| EC-PRC-024 | Supplier is on hold in accounting when a requisition is approved | PO creation blocked with the hold reason; buyer may choose another supplier | P0 | specified | — |
| EC-PRC-025 | Receiver and buyer are the same person at a small guesthouse | Policy allows SoD relaxation for small profiles with a visible warning and audit; never silently | P1 | specified | — |
| EC-PRC-026 | Customs holds a shipment for missing certificate of origin | Milestone `customs declared` stalls; document checklist shows the missing document; ETA updated; dependent requisitions warned | P1 | specified | — |

## Evidence sources (all verified 2026-11-07)

Verification method: pages on docs.oracle.com, docs.mews.com, help.mews.com, api.apaleo.com, apaleo.dev and
docs.stripe.com were fetched and read on 2026-11-07. Pages on hosts this environment's proxy blocks
(central.xero.com, quickbooks.intuit.com, help.rguest.com, docs.infor.com, apaleo.zendesk.com,
mewssystems.freshdesk.com, Toast, Omniboost, Stayntouch, Clock, TrustRadius, oracle.com marketing) were verified
2026-11-07 through web-search results showing the page and its content, or through `docs/research/` citations;
re-open them before any external use. Third-party pages (Omniboost, Stayntouch, Clock, TrustRadius) describe a
competitor's behaviour indirectly and are weaker evidence than the vendor's own documentation.

Oracle Food & Beverage back-office Inventory Management user guide (`docs.oracle.com/en/industries/food-beverage/back-office/invug/`):

[fb-vendor-order]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_masterdata_config_vendor_ordersettings.htm
[fb-vendor-delivery]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_masterdata_config_vendor_deliverysettings.htm
[fb-vpc]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_vendor_purchase_catalog.htm
[fb-vpi-effectivity]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_vpi_set_effectivity_range_for_vendor.htm
[fb-vpi-compare]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_copycompare_vpis.htm
[fb-b2b]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_b2b_solutions.htm
[fb-b2b-variance]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_b2b_accept_price_variance.htm
[fb-b2b-load]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_b2b_load_catalog_ordercycle_and_invoice.htm
[fb-requests]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_requests.htm
[fb-ordering]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_ordering.htm
[fb-order-cycle]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_ordering_create_order_by_order_cycle.htm
[fb-order-suggested]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_ordering_create_order_using_suggested_order_qty.htm
[fb-master-order-list]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_maintenance_create_masterorderlist.htm
[fb-view-orders]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_ordering_view_suspended_pending_booked_orders.htm
[fb-close-po]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_receiving_close_po.htm
[fb-fcy]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_masterdata_link_foreign_currency_to_vendor.htm
[fb-receipt-po]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_create_receipt_using_existing_po.htm
[fb-receipt-blank]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_create_blank_receipt.htm
[fb-reason-rating]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_add_rating_reason_code.htm
[fb-receipt-substitute]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_substitute_items_suspended_receipts.htm
[fb-receipt-cc]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_change_cc_for_items_on_receipts.htm
[fb-returns]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_receiving_return_items_to_vendor.htm
[fb-invoice-receipt]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_invoicing_create_invoice_by_receipt.htm
[fb-invoice-ap]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_invoicing_send_approved_invoice_to_ap.htm
[qb-approval]: https://quickbooks.intuit.com/learn-support/en-us/help-article/manage-workflows/set-use-bill-approval-and-payment-release-workflows/L1IOLL9hv_US_en_US
[qb-po-approval]: https://quickbooks.intuit.com/learn-support/en-us/help-article/pay-bills/set-bill-approval-enterprise-22-0/L5DsRjlOr_US_en_US
[ns-close]: https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N1455781.html
