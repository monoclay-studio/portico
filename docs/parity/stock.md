# Parity: stock

Module: `stock` (goods inventory: items, units, stores, movements, counts, valuation, cost of sales, recipes and menu
costing, theoretical vs actual, beverage control, amenities, linen, minibar, reorder, days of cover, lots and expiry,
fuel) · Spec: `docs/specs/stock.md` (merged on `main`).

**Baseline.** Oracle Food & Beverage back-office Inventory Management and Simphony inventory (counts, transfers,
recipes, production, yield, waste, stock on hand, forecast out of stock, menu item linking, booking POS sales), OPERA
consumable inventory and reservation item inventory; resort realities (fuel, water, linen, minibar). Evidence links
at the end; **all verified 2026-11-07**.

**Status rule.** No `stock` code on `main` or any branch: `specified` (STK-Rnn), `deferred`, or `missing`.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-STK-001 | Stock items with category tree, units of measure and conversions | Oracle F&B [items, groups][fb-masterdata] · [units][fb-units] | P0 | specified | stock.md STK-R01 | — |
| PAR-STK-002 | Partial units for bar control (tenths, weight, pours) | Oracle F&B [production units][fb-prod-units] | P1 | specified | stock.md STK-R02 | — |
| PAR-STK-003 | Store tree per property (main, cold room, bar, minibar, engineering, in-transit, returns) | Oracle F&B [cost centers][fb-cc] · [storage locations][fb-storage] | P0 | specified | stock.md STK-R03 | — |
| PAR-STK-004 | Par, min/max, reorder point, safety stock per store and item | Oracle [par levels per item][fb-inv-marketing] | P0 | specified | stock.md STK-R04 | — |
| PAR-STK-005 | Movement kinds: receipt, issue, transfer, return, wastage, adjustment, production, consumption | Oracle F&B [transfers][fb-transfers] · [waste][fb-waste] · [production][fb-production] | P0 | specified | stock.md STK-R05 | — |
| PAR-STK-006 | Issue requests from departments with accept/decline | Oracle F&B [issue requests][fb-requests] | P0 | specified | stock.md STK-R05 | — |
| PAR-STK-007 | Negative stock policy (block or allow with exception) | assumption | P0 | specified | stock.md STK-R06 | — |
| PAR-STK-008 | Mobile/offline issues, receipts, wastage and counts with barcode scanning | Oracle [tablet spot checks][fb-inv-marketing] | P0 | specified | stock.md STK-R07 | — |
| PAR-STK-009 | Counts: full, cycle, spot; freeze book quantities; book/unbook; variance report | Oracle F&B [inventory counts][fb-inventory] · [freeze][fb-freeze] · [variance report][fb-variance] | P0 | specified | stock.md STK-R08 | — |
| PAR-STK-010 | Valuation method per legal entity (weighted average, FIFO) changeable from a period start | assumption (accounting practice) | P0 | specified | stock.md STK-R09 | — |
| PAR-STK-011 | Valuation journals in the same transaction as the movement | assumption | P0 | specified | stock.md STK-R10 | — |
| PAR-STK-012 | Cost-of-sales method per outlet (issues-based or count-based) | Oracle [cost of sales reporting][fb-inv-marketing] | P0 | specified | stock.md STK-R11 | — |
| PAR-STK-013 | Recipes with sub-recipes, yield %, waste %, portions, scaling, print | Oracle F&B [recipes][fb-recipes] · [scaling][fb-recipe-scale] | P0 | specified | stock.md STK-R12 | — |
| PAR-STK-014 | Search and replace an ingredient across recipes | Oracle F&B [replace ingredients][fb-replace] | P2 | missing | — | — |
| PAR-STK-015 | Menu costing: theoretical cost per portion and cost % | Oracle [plate costs][fb-inv-marketing] | P0 | specified | stock.md STK-R13 | — |
| PAR-STK-016 | Theoretical vs actual consumption from sold items × recipes | Oracle F&B [booking POS sales][fb-booking-sales] · [menu item linking][fb-mi-linking] | P0 | specified | stock.md STK-R14 | — |
| PAR-STK-017 | Unlinked/unknown POS items listed for booking | Oracle F&B [book items not linked][fb-not-linked] | P0 | specified | fnb-pos.md FNB-R27; stock.md STK-R14 | — |
| PAR-STK-018 | Beverage control: bar par, shift counts, pour cost | assumption (bar control practice) | P1 | specified | stock.md STK-R15 | — |
| PAR-STK-019 | Production (batch cooking) and yield management (butchery, filleting) | Oracle F&B [production][fb-production] · [yield][fb-yield] | P1 | specified | stock.md STK-R05 (`production` movement), STK-R12 (yield %); butchery yield tests not specified | — |
| PAR-STK-020 | Forecast out-of-stock and prep/thaw-pull lists | Oracle F&B [forecast out of stock][fb-forecast-oos] · [prep and thaw pull][fb-thaw] | P2 | missing | — | — |
| PAR-STK-021 | Event menu planning (banquet quantities) | Oracle F&B [event menu planning][fb-event-menu] | P2 | missing | — | — |
| PAR-STK-022 | Amenity standards per unit type and occupancy, consumption from occupancy | OPERA [consumable inventory][op-consumable] | P1 | specified | stock.md STK-R16 | — |
| PAR-STK-023 | Linen circulation by location with par per bed and discard | assumption (housekeeping practice) | P1 | specified | stock.md STK-R17 | — |
| PAR-STK-024 | Minibar store per unit with consumption → folio posting and par restore | OPERA [consumable inventory][op-consumable] | P1 | specified | stock.md STK-R18, STK-R19 | — |
| PAR-STK-025 | Reservation item inventory (rentable items: cribs, bikes, snorkel sets) | OPERA [reservation item inventory][op-item-inventory] | P2 | missing | — | — |
| PAR-STK-026 | Reorder suggestions from projected stock (on hand + inbound − demand) feeding orders | Oracle F&B [suggested order quantity][fb-order-suggested] | P0 | specified | stock.md STK-R20 | — |
| PAR-STK-027 | Days of cover for critical items (fuel, water, LPG, chemicals) with alerts | assumption (island resort) | P0 | specified | stock.md STK-R21 | — |
| PAR-STK-028 | Lot/batch and expiry, FEFO picking, quarantine, temperature logs | assumption (food safety) | P1 | specified | stock.md STK-R22 | — |
| PAR-STK-029 | Fuel tanks as stores with dip/flow readings and loss tracking | assumption (island power) | P1 | specified | stock.md STK-R23 | — |
| PAR-STK-030 | Stock on hand view by store and item | Oracle F&B [stock on hand][fb-soh] | P0 | specified | stock.md §9 | — |
| PAR-STK-031 | Waste documents with waste groups and reasons | Oracle F&B [waste][fb-waste] · Simphony [waste reasons][sim-waste-reasons] | P0 | specified | stock.md STK-R05 (wastage) | — |
| PAR-STK-032 | Allergen/additive data on items and recipes | Oracle F&B [additive management][fb-additive] | P1 | specified | stock.md STK-R12 (allergens derived from ingredients) | — |
| PAR-STK-033 | Master-data audit trail and visibility per cost centre | Oracle F&B [audit trail][fb-audit] · [visibility criteria][fb-visibility] | P1 | specified | CLAUDE.md §4 rule 9 (audit) | — |
| PAR-STK-034 | Inter-property transfers (sister resort) | Oracle F&B [transfer to/from][fb-transfer-tofrom] | P1 | specified | stock.md STK-R05 (transfer via in-transit) | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-STK-001 | Issue requested for more than on hand in the main store | Blocked (main store policy `block`) with quantity available and inbound; partial issue offered | P0 | specified | — |
| EC-STK-002 | Bar sells items recorded before the transfer from the main store is received | Bar store goes negative only if policy allows, raising an exception; reconciled on receipt | P1 | specified | — |
| EC-STK-003 | Count started while issues continue during service | Book quantities frozen at snapshot time; movements after the snapshot adjust the comparison; no false variance | P0 | specified | — |
| EC-STK-004 | Count booked with a typo (100 instead of 10 bottles) | Variance above threshold requires recount/approval before booking; unbook allowed only before period close | P0 | specified | — |
| EC-STK-005 | Landed cost actualized after part of the stock was consumed | Difference split: on-hand part to stock value, consumed part to cost of sales/variance (PRC-R17) | P0 | specified | — |
| EC-STK-006 | Valuation method change requested mid-period | Refused; allowed only from a period start with permission | P0 | specified | — |
| EC-STK-007 | Recipe ingredient price changes daily (fresh fish) | Menu costing shows current cost and the change; historical cost of sales unchanged | P1 | specified | — |
| EC-STK-008 | POS sale of an item with no recipe link | Listed as unlinked; theoretical consumption flagged incomplete, never silently zero | P0 | specified | — |
| EC-STK-009 | Theoretical vs actual variance of 8% on spirits | Variance report by item and shift with drill-down to counts, issues and sales; investigation task to bar manager | P1 | specified | — |
| EC-STK-010 | Supply boat late; drinking water below safety stock in 3 days | Days-of-cover alert to the owner with options (air freight, desalination output, sister transfer) | P0 | specified | — |
| EC-STK-011 | Fuel dip reading lower than book by more than tolerance | Loss exception with readings history; engineering task; valuation adjusted only after approval | P1 | specified | — |
| EC-STK-012 | Offline issue recorded on two devices for the same item | Both queued commands applied in device order; negative-stock rule evaluated on server; conflicts surfaced | P0 | specified | — |
| EC-STK-013 | Lot recalled after partial consumption | Trace shows stores, issues and outlets using the lot; quarantine moves remaining; returns flow | P1 | specified | — |
| EC-STK-014 | Expired items found in a cold room | Wastage with reason `expired`; FEFO compliance metric updated | P1 | specified | — |
| EC-STK-015 | Minibar consumption reported after the guest checked out | Late charge per finance FIN-R25; stock movement recorded at service date; par restore task | P0 | specified | — |
| EC-STK-016 | Guest disputes a minibar charge | Folio adjustment in finance; stock movement unchanged (item consumed or recorded loss) | P1 | specified | — |
| EC-STK-017 | Linen discarded after salt/stain damage beyond par | Discard movement with reason; par shortfall drives reorder suggestion | P1 | specified | — |
| EC-STK-018 | Unit of measure conversion error (case of 12 entered as each) | Receipt preview shows converted quantity and value; anomaly threshold warns before posting | P1 | missing | — |
| EC-STK-019 | Stock movement posted in a period that is soft-closed for stock | Refused unless within the cut-off rule (ACC-R28); count-based stores close after counts | P0 | specified | — |
| EC-STK-020 | Inter-island transfer arrives with breakage | Received quantity recorded; difference is transfer variance with photos; not a supplier claim | P0 | specified | — |
| EC-STK-021 | Weighted average cost when receiving at zero or negative on-hand | Cost resets to receipt cost; negative-quantity revaluation posted to variance; documented rule | P1 | missing | — |
| EC-STK-022 | Item price in MVR from a local supplier, stock valued in USD | Valuation in functional currency at business-date rate; original currency kept on the receipt | P0 | specified | — |
| EC-STK-023 | Void after send marked `made` at the POS | Wastage movement created from the void; cost stays with the outlet | P0 | specified | — |
| EC-STK-024 | Sub-recipe yield changes after a chef updates it | New recipe version effective from now; past theoretical consumption keeps the old version | P1 | specified | — |
| EC-STK-025 | Store deleted while it still holds stock | Refused; transfer or count to zero first | P1 | missing | — |

## Evidence sources (all verified 2026-11-07)

[fb-masterdata]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_setup_overgrp_mjrgrp_itmgrp_items_vendors.htm
[fb-units]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_managestore_change_uom_for_item.htm
[fb-prod-units]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_production_units.htm
[fb-cc]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_cc.htm
[fb-storage]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_managestore_manage_store_locations.htm
[fb-inv-marketing]: https://www.oracle.com/industries/food-beverage/products/inventory-management.html
[fb-transfers]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_transfers.htm
[fb-transfer-tofrom]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_transfer_to_from.htm
[fb-waste]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_waste.htm
[fb-production]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_production.htm
[fb-yield]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_yield_mgt.htm
[fb-requests]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_requests.htm
[fb-inventory]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_inventory.htm
[fb-freeze]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_inventory_freeze_unfreeze_counts.htm
[fb-variance]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_inventory_generate_inv_variance_rpt.htm
[fb-recipes]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_recipes.htm
[fb-recipe-scale]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_recipes_scale_recipe.htm
[fb-replace]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_replaceingredients.htm
[fb-booking-sales]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_booking_sales.htm
[fb-mi-linking]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_mi_linking.htm
[fb-not-linked]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_booking_sales_book_mi_not_linked.htm
[fb-forecast-oos]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_production_forecast_out_of_stock.htm
[fb-thaw]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_prep_and_thawpull.htm
[fb-event-menu]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_evntmenuplan.htm
[fb-order-suggested]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/t_ordering_create_order_using_suggested_order_qty.htm
[fb-soh]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_soh.htm
[fb-additive]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_additive_management.htm
[fb-audit]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_audit_trail.htm
[fb-visibility]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_masterdata_visibility_criteria.htm
[sim-waste-reasons]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_menu_items_waste_reasons.htm
[op-consumable]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_cashiering_finance_monitoring_consumable_inventory.htm
[op-item-inventory]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_managing_reservations_item_inventory.htm
