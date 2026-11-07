# Parity: fnb-pos

Module: `fnb-pos` (outlet point of sale: menus, prices, floor, checks, courses, kitchen routing and KDS, settlement,
room charge, meal plans/all-inclusive, receipts, offline operation, outlet close, quick post, external POS intake,
hardware list, F&B reporting) · Spec: `docs/specs/fnb-pos.md` (merged on `main`).

**Baseline.** Oracle Simphony 19.8 POS user guide and configuration guide (the hotel-POS reference, incl. its OPERA
integration), Toast (offline, course pacing), Lightspeed K-Series room-charge integrations, Mews POS, Apaleo/Mews POS
posting APIs and OPERA's POS touchpoints. Evidence links at the end; **all verified 2026-11-07**.

**Status rule.** No `fnb-pos` code exists on `main` or any branch: rows are `specified` (FNB-Rnn or another spec),
`deferred` (spec boundary says integrate/LATER) or `missing`. Priority is relative to competing as an outlet POS;
for a Maldives pilot that keeps its POS, the external-intake rows (FNB-R26) are the P0 path.

## Capabilities

### Outlet setup, menus and prices

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-001 | Outlet profile with revenue centres, service periods, tax sector, service-charge, tip and room-charge policy | Simphony [revenue centers][sim-rvc] · [serving periods][sim-serving] | P0 | specified | fnb-pos.md FNB-R01 | — |
| PAR-POS-002 | Exactly one charge source per outlet (Portico POS, external POS, quick post) | assumption (data authority) | P0 | specified | fnb-pos.md FNB-R01 | — |
| PAR-POS-003 | Menu items with charge code, category, modifiers (forced/optional, min/max), combos with price allocation | Simphony [menu items][sim-menu] · [combo meals][sim-combo] · [condiments][sim-condiments] | P0 | specified | fnb-pos.md FNB-R02 | — |
| PAR-POS-004 | Allergen and dietary tags with highlight on tickets | Simphony [allergen classes][sim-allergen] | P0 | specified | fnb-pos.md FNB-R02, FNB-R07 | — |
| PAR-POS-005 | Nutrition information per item | Simphony [allergen, nutrition and consumer advisory][sim-nutrition] | P2 | missing | — | — |
| PAR-POS-006 | Live sold-out ("86") with remaining count on all devices | Simphony [menu item availability][sim-availability] | P0 | specified | fnb-pos.md FNB-R02 | — |
| PAR-POS-007 | Effective-dated price schedules with price levels (happy hour, resident, staff) switching by time | Simphony [menu levels][sim-menu-levels] · [effectivity groups][sim-effectivity] | P0 | specified | fnb-pos.md FNB-R03 | — |
| PAR-POS-008 | Price snapshotted at order time; price-change preview of affected outlets/items | assumption (agreed-price principle) | P0 | specified | fnb-pos.md FNB-R03 | — |
| PAR-POS-009 | Menu versions draft → published with cost and margin from recipes | Oracle F&B [menu item linking to recipes][fb-mi-linking] | P1 | specified | fnb-pos.md FNB-R04; stock.md | — |
| PAR-POS-010 | Weighed items (price by weight, tare) | Simphony [weighed menu items][sim-weighed] | P2 | missing | — | — |
| PAR-POS-011 | Central menu management and distribution to many outlets/properties | Simphony [enterprise distribution][sim-emc] | P1 | missing | — | — |
| PAR-POS-012 | Menu import/export (CSV) and configuration cloning | Simphony [import/export][sim-import] · [cloning][sim-clone] | P1 | missing | — | — |
| PAR-POS-013 | Multi-language item names and receipts | Simphony [multiple-language receipts][sim-lang-receipt] | P1 | specified | fnb-pos.md FNB-R02 (localized names); receipt language missing | — |

### Floor, checks and ordering

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-020 | Floor plans, table states, server sections, merge/split tables, transfer to another server | Simphony [dining room management][sim-tms] | P0 | specified | fnb-pos.md FNB-R05 | — |
| PAR-POS-021 | Host stand: reservation list and wait list with quoted wait times | Simphony [seating management][sim-waitlist] | P1 | specified | resort.md RST-R09 (dining reservations); wait list missing | — |
| PAR-POS-022 | Checks with order type (dine-in, in-villa, bar tab, takeaway, event, staff), covers, seats | Simphony [guest checks][sim-checks] | P0 | specified | fnb-pos.md FNB-R06 | — |
| PAR-POS-023 | Several stays sharing one table/check | assumption (resort practice) | P1 | specified | fnb-pos.md FNB-R06 | — |
| PAR-POS-024 | Add guest room number to a check at open | Simphony [adding room number][sim-room-no] | P0 | specified | fnb-pos.md FNB-R06, FNB-R15 | — |
| PAR-POS-025 | Repeat round / refills | Simphony [repeat menu items][sim-repeat] · [refills][sim-refills] | P2 | missing | — | — |
| PAR-POS-026 | Seat filtering and memo (pre-)bill | Simphony [seat filtering and memo checks][sim-memo] | P1 | specified | fnb-pos.md FNB-R05 (`bill_requested`), FNB-R06 (seats) | — |
| PAR-POS-027 | Suspend/resume checks; follow-me checks; team service checks | Simphony [suspend/resume][sim-suspend] · [team checks][sim-team] | P2 | missing | — | — |
| PAR-POS-028 | Combine checks within and across revenue centres; transfer checks between revenue centres | Simphony [combine checks][sim-combine] · [check transfers][sim-transfer] | P1 | specified | fnb-pos.md FNB-R08 | — |
| PAR-POS-029 | Guest self-ordering (QR at table, in-villa app) | Simphony [order channels][sim-order-channels] | P2 | missing | — | — |
| PAR-POS-030 | Third-party delivery marketplaces | Simphony [delivery connectors][sim-delivery] | P2 | deferred | fnb-pos.md §15 (integrate / LATER) | — |
| PAR-POS-031 | Self-service kiosks | Simphony [kiosks][sim-kiosk] | P2 | deferred | fnb-pos.md §15 (LATER) | — |
| PAR-POS-032 | Event (banquet) checks linked to the group event order and master folio | Simphony [posting checks to events][sim-events] · OPERA [banquet folios][op-event-post] | P1 | specified | fnb-pos.md FNB-R06 (`event`); groups.md | — |

### Courses, kitchen routing and KDS

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-040 | Hold and fire by course; auto-fire rules; fire now; rush | Simphony [firing items][sim-fire] · [hold items][sim-hold] · Toast [hold and course pacing][toast-faq] | P0 | specified | fnb-pos.md FNB-R07 | — |
| PAR-POS-041 | Send and stay on the check | Simphony [send while remaining on check][sim-send-stay] | P1 | specified | fnb-pos.md FNB-R07 | — |
| PAR-POS-042 | Re-fire to kitchen marked REPRINT/REFIRE with permission | Simphony [re-firing][sim-refire] | P1 | specified | fnb-pos.md FNB-R11 | — |
| PAR-POS-043 | Routing rules item → prep stations per service period; change chits (ADD, VOID — DO NOT MAKE) | Simphony [printer order devices][sim-printers] | P0 | specified | fnb-pos.md FNB-R11 | — |
| PAR-POS-044 | KDS with timers, bump/recall, all-day counts, expo course pacing, ready notifications | Toast [KDS offline][toast-kds-offline] · InfoGenesis [IG KDS][ig-kds] | P0 | specified | fnb-pos.md FNB-R12 | — |
| PAR-POS-045 | Pre-production chits for prep before service | Simphony [pre-production chits][sim-preprod] | P2 | missing | — | — |
| PAR-POS-046 | Ticket-time targets and analytics | assumption (KDS vendors) | P1 | specified | fnb-pos.md FNB-R13 | — |

### Discounts, voids, comps, waste

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-050 | Discounts (item/check, %/amount) with reason and approval above threshold | Simphony [discounts][sim-discounts] · [discount privileges][sim-discount-priv] | P0 | specified | fnb-pos.md FNB-R09 | — |
| PAR-POS-051 | Void before send without approval; void after send with reason, approval and made/not-made flag | Simphony [void reasons, closed check void][sim-void-closed] | P0 | specified | fnb-pos.md FNB-R09 | — |
| PAR-POS-052 | Comps with reason and manager approval, cost of sales retained | Simphony [returns][sim-returns] | P0 | specified | fnb-pos.md FNB-R09 | — |
| PAR-POS-053 | Manager approval on a shared device by PIN/passkey elevation | Simphony [employee privileges][sim-privileges] | P0 | specified | fnb-pos.md FNB-R09 (identity elevation) | — |
| PAR-POS-054 | Reopen, adjust or void a closed check (change tender, tip, items) with audit | Simphony [reopen closed check][sim-reopen] · [adjust closed check][sim-adjust-closed] · [adjust card payment][sim-adjust-cc] | P1 | missing | — | — |
| PAR-POS-055 | Waste checks with reasons and waste reports | Simphony [declaring waste][sim-waste] · [waste reasons][sim-waste-reasons] | P1 | specified | fnb-pos.md FNB-R09 (made → wastage to stock); stock.md | — |
| PAR-POS-056 | House/officer checks to house folios; staff purchases at staff price level | Simphony [employee/house checks][sim-checks] | P1 | specified | fnb-pos.md FNB-R10 | — |
| PAR-POS-057 | Item tax-class override (e.g., takeaway rate) | Simphony [tax class override][sim-tax-override] | P2 | missing | — | — |

### Settlement, room charge and entitlements

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-060 | Tenders: cash in two currencies with change in either, card (integrated or record-only), room charge, house, split tenders | Simphony [alternate currency][sim-alt-currency] · [multiple cards][sim-multi-cc] · [currency config][sim-currency] | P0 | specified | fnb-pos.md FNB-R14 | — |
| PAR-POS-061 | Pending card outcome keeps the check `payment_pending`, never paid | assumption (payments semantics) | P0 | specified | fnb-pos.md FNB-R14 | — |
| PAR-POS-062 | Room charge with guest lookup (unit + surname, name, booking code, QR) returning only eligible stays | Simphony [OPERA guest lookup][sim-opera-lookup] · [room charge tender][sim-opera-tender] · Lightspeed [room charge setup][ls-omni] | P0 | specified | fnb-pos.md FNB-R15 | — |
| PAR-POS-063 | Posting privileges (allowed / cash only / blocked) and remaining credit at lookup | OPERA [credit limit overage][op-cl-overage] | P0 | specified | fnb-pos.md FNB-R15, FNB-R16 | — |
| PAR-POS-064 | Signature capture or signed chit as settlement evidence | assumption (hotel POS practice) | P0 | specified | fnb-pos.md FNB-R15 | — |
| PAR-POS-065 | "Posted to room" only after server commit; itemized check viewable from the folio | OPERA [POS check image][op-pos-check] | P0 | specified | fnb-pos.md FNB-R15, FNB-R22 | — |
| PAR-POS-066 | Split a check between room charge and another tender | Lightspeed [split room + cash][ls-snt] | P0 | specified | fnb-pos.md FNB-R14 | — |
| PAR-POS-067 | Transfer an F&B bill to a company or event folio | Lightspeed [transfer to room, company or event folio][ls-clock] | P1 | specified | fnb-pos.md FNB-R10, FNB-R15 (billing rules route) | — |
| PAR-POS-068 | Meal-plan and all-inclusive evaluation per line shown before sending (covered / partial / not covered) | Simphony [OPERA guest packages][sim-opera-pkg] · OPERA [package consumption][op-pwa-pkg] | P0 | specified | fnb-pos.md FNB-R17 | — |
| PAR-POS-069 | Monetary dining allowance consumed automatically; overflow charged | OPERA [package allowances][op-pkg-allow] | P0 | specified | fnb-pos.md FNB-R17; finance.md FIN-R19 | — |
| PAR-POS-070 | Service charge, taxes per line from the tax engine; tax summary per rule | Simphony [taxes][sim-taxes] · [service charges][sim-svc] | P0 | specified | fnb-pos.md FNB-R18 | — |
| PAR-POS-071 | Tips as separate add-on to tips payable, outside tax base; tip pool export | Simphony [charged tips][sim-charged-tips] · [tip tracking][sim-tips] | P0 | specified | fnb-pos.md FNB-R18 | — |
| PAR-POS-072 | Pay at table / QR self-pay | Simphony [pay using QR][sim-qr] · [consumer self pay][sim-self-pay] | P2 | missing | — | — |
| PAR-POS-073 | Bar tab secured with a card pre-authorization | Simphony [reauthorize released authorizations][sim-reauth] | P1 | missing | — | — |
| PAR-POS-074 | High-amount lockout per tender | Simphony [HALO][sim-halo] | P2 | missing | — | — |
| PAR-POS-075 | Gift card and loyalty redemption at the POS | Simphony [loyalty and gift cards][sim-gift] | P2 | missing | — | — |
| PAR-POS-076 | Equipment rental deposits on checks (e.g., snorkel gear) | Simphony [rental deposits][sim-deposits] | P2 | missing | — | — |
| PAR-POS-077 | Age verification prompt for restricted items | Simphony [age verification][sim-age] | P2 | missing | — | — |

### Receipts, offline and resilience

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-080 | Tax receipts from a per-device gapless series, also offline; reprints marked COPY | Simphony [reprint closed check][sim-reprint] | P0 | specified | fnb-pos.md FNB-R19 | — |
| PAR-POS-081 | Email receipt to guest | Simphony [email receipts][sim-email] | P1 | missing | — | — |
| PAR-POS-082 | Offline operation on the device with local sync among outlet devices (hub) | Toast [offline mode][toast-offline] · Simphony [offline posting time][sim-offline] | P0 | specified | fnb-pos.md FNB-R20 | — |
| PAR-POS-083 | Offline room charges within an exposure limit, signature mandatory, queued and re-validated | assumption (offline risk control) | P0 | specified | fnb-pos.md FNB-R20, FNB-R21 | — |
| PAR-POS-084 | Device sequence, check lease and append-only line events so no order is lost or double-settled | Toast [offline check numbers][toast-offline] | P0 | specified | fnb-pos.md FNB-R21 | — |
| PAR-POS-085 | Honest connectivity status and queue depth per device; printed backup list | assumption | P0 | specified | fnb-pos.md FNB-R22 | — |
| PAR-POS-086 | Hardware compatibility list with evidence and manual fallbacks | Simphony [POS workstations / peripherals][sim-workstations] | P1 | specified | fnb-pos.md FNB-R28 | — |
| PAR-POS-087 | Cash drawer assignment and kick | Simphony [cash drawer][sim-drawer] | P1 | specified | fnb-pos.md FNB-R28 | — |
| PAR-POS-088 | Remote lease revocation for a lost device | assumption | P1 | specified | fnb-pos.md FNB-R28 | — |

### Cashiering, outlet close, quick post and intake

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-090 | Server banks / cashier shifts as finance cashier sessions with blind declaration and tips | Mews [cash drawer report][mw-cash-drawer] · Simphony [shift reports][sim-shift-reports] | P0 | specified | fnb-pos.md FNB-R23 | — |
| PAR-POS-091 | Enterprise cash management (tills, safes, deposits, pulls) | Simphony [enterprise cash management][sim-ecm] | P1 | specified | fnb-pos.md FNB-R23; accounting.md ACC-R23 (deposit slips) | — |
| PAR-POS-092 | Outlet close per business date: open checks closed/transferred, Z report, balancing | Simphony [start of day / reset totals][sim-sod] · Mews [outlet end-of-day][mw-pos-uc] | P0 | specified | fnb-pos.md FNB-R24 | — |
| PAR-POS-093 | Automatic start of day; behaviour with offline workstations | Simphony [automatic start of day][sim-sod-auto] · [SOD offline][sim-sod-offline] | P1 | specified | fnb-pos.md FNB-R24 | — |
| PAR-POS-094 | Quick-post app for outlets without menus (spa desk, dive centre, boutique) | OPERA [Post It][op-postit] · [PWA Post It][op-pwa-postit] | P0 | specified | fnb-pos.md FNB-R25 | — |
| PAR-POS-095 | External POS intake (eligibility, lookup, posting, corrections, balancing) through API/connectors | Mews [POS use case][mw-pos-uc] · Apaleo [POS postings][ap-pos-nonres] · Simphony [transaction services][sim-ts] | P0 | specified | fnb-pos.md FNB-R26 | — |
| PAR-POS-096 | Item-level sales facts for stock consumption and analytics (incl. external POS) | Oracle F&B [booking POS sales][fb-booking-sales] | P1 | specified | fnb-pos.md FNB-R27 | — |
| PAR-POS-097 | Time clock and tip declaration at the POS | Simphony [clock in/out][sim-clock] · [tip track][sim-tiptrack] | P2 | deferred | workforce.md (time & attendance) | — |
| PAR-POS-098 | Training mode with no real postings | Oracle [POS training][sim-training] | P1 | specified | CLAUDE.md §4 rule 12 (training environment) | — |

### Reporting and controls

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-POS-100 | Sales by outlet, period, revenue centre, category, item, server, hour; covers and average check | Simphony [reporting][sim-reporting] | P0 | specified | fnb-pos.md FNB-R29 | — |
| PAR-POS-101 | Loss prevention: voids, comps, discounts with approvers; employee check journal | Simphony [employee check journal indicators][sim-journal] · [auditing][sim-audit] | P0 | specified | fnb-pos.md FNB-R29 | — |
| PAR-POS-102 | Entitlement consumption value by meal plan | assumption (all-inclusive costing) | P1 | specified | fnb-pos.md FNB-R29 | — |
| PAR-POS-103 | Menu engineering (popularity × margin) | Oracle F&B [recipes and costing][fb-inv-marketing] | P2 | missing | — | — |
| PAR-POS-104 | Role privileges per employee class (who may void, discount, reopen, transfer) | Simphony [roles and employee classes][sim-roles] | P0 | specified | fnb-pos.md §8 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-POS-001 | Internet drops at the beach bar during sunset service | Devices switch to hub or device-alone tier with visible status; ordering, printing and cash/record-only card continue; nothing shown as posted to room until commit | P0 | specified | — |
| EC-POS-002 | Offline room charge would exceed the per-stay offline exposure limit | Refused offline with the limit shown; alternatives offered (card, cash, partial up to the limit) | P0 | specified | — |
| EC-POS-003 | Queued offline room charge syncs after the guest has checked out | Posted as a late charge (reopened or supplementary folio) with collection follow-up; outlet sees the outcome | P0 | specified | — |
| EC-POS-004 | Queued offline room charge for a stay now `blocked` | "Unposted room charge" exception owned by the outlet manager with actions (payment link, house folio with reason, write-off ⚑) | P0 | specified | — |
| EC-POS-005 | Two tablets try to settle the same check | Only the lease holder can settle; the other sees read-only `delayed`; no double settlement | P0 | specified | — |
| EC-POS-006 | A tablet with 6 queued items is lost | Lease revoked remotely; queued items reconciled from server-side events and printed chits; differences become exceptions | P1 | specified | — |
| EC-POS-007 | Device sync replays the same command after reconnect | Idempotency key and device sequence dedupe; posting key `pos:{outlet}:{check}:{settlement}:{code}` prevents double charge | P0 | specified | — |
| EC-POS-008 | Kitchen printer jams during dinner | KDS-only routing or handwritten chit fallback; reprint marked REPRINT when restored | P1 | specified | — |
| EC-POS-009 | Check opened at 23:40, settled at 00:20, Day Close for the date still running | Posting carries the business date current at commit; outlet close for the earlier date lists the check if still open | P0 | specified | — |
| EC-POS-010 | Happy-hour price ends at 19:00; item ordered 18:59, settled 19:30 | Price snapshot from order time is kept; receipt shows happy-hour price | P0 | specified | — |
| EC-POS-011 | Menu price changed while a check is open | Lines already ordered keep their snapshot; new lines use the new price; preview listed affected outlets before publish | P0 | specified | — |
| EC-POS-012 | One bottle of wine split three ways (USD 100.00) | Shares 33.33/33.33/33.34 with residual to the last part, taxes recomputed per check, shown on each | P0 | specified | — |
| EC-POS-013 | Main course voided after it was sent and cooked | Reason + manager approval; flagged `made` → wastage to stock; revenue not recognised | P0 | specified | — |
| EC-POS-014 | All-inclusive guest orders a premium wine excluded from the plan | Badge "not covered — premium excluded" before sending; line charged | P0 | specified | — |
| EC-POS-015 | Half-board guest orders dinner at an outlet not included in the plan | "Not covered — outlet not included"; charged or allowance applied per definition | P0 | specified | — |
| EC-POS-016 | Child on a meal plan orders from the adult menu | Entitlement evaluated per occupant (age band); overflow charged with reason | P1 | specified | — |
| EC-POS-017 | Two in-house guests with the same surname in villas 214 and 241 | Lookup requires unit + surname letters or QR; photo (consented) shown; never auto-selects among ambiguous results | P0 | specified | — |
| EC-POS-018 | Guest is `cash_only` (set at check-in) and asks to charge to room | Refused with the front-desk reason; manager override within limit logged and front office notified | P0 | specified | — |
| EC-POS-019 | Room charge would exceed remaining credit | Partial room charge up to the limit, remainder by another tender, or override with permission | P0 | specified | — |
| EC-POS-020 | Tip added on a room-charged check | Tip line to tips payable attributed to the server; not in service-charge or TGST base; visible on folio | P0 | specified | — |
| EC-POS-021 | Comp of a dish on a check with service charge | Service charge recomputed on the remaining eligible net; comp reason and approver recorded; cost of sales stays with outlet | P0 | specified | — |
| EC-POS-022 | Guest pays a USD 47.30 bill with a USD 50 note and wants change in MVR | Change converted at finance's business-date rate, paid from the session's MVR float, both legs recorded | P0 | specified | — |
| EC-POS-023 | Card terminal is offline | Record-only external-terminal tender with approval code (later matched to batch) or cash; no fake "approved" | P0 | specified | — |
| EC-POS-024 | Integrated card payment times out | Check stays `payment_pending`; no second charge until verified; table can be released only by manager with the pending item visible | P0 | specified | — |
| EC-POS-025 | In-house guest's bar tab still open at outlet close | Per policy: transfer to room (default off; if on, visible as "closed at outlet close") or keep open for the next shift; listed as `fnbPos.outlet.notClosed` | P0 | specified | — |
| EC-POS-026 | Per-device receipt series shows a gap after sync | Gap exception with device and numbers; never renumbered | P0 | specified | — |
| EC-POS-027 | Item 86'd on the server while a device is offline and orders it | Order accepted offline; on sync the kitchen sees the conflict and the server is alerted to substitute; nothing silently dropped | P1 | missing | — |
| EC-POS-028 | Guest with a recorded nut allergy is linked to the check | Allergy badge on check and KOT; items tagged with nuts require server confirmation | P0 | specified | — |
| EC-POS-029 | Guesthouse outlet on an inhabited island where alcohol cannot be sold | Alcohol-tagged items unavailable when the outlet's alcohol-licensed flag is off; rule data unverified (Q106) | P1 | specified | — |
| EC-POS-030 | External POS sends the same check line twice | Key `pos:{outlet}:{check}:{line}` returns the original posting; balancing unaffected | P0 | specified | — |
| EC-POS-031 | External POS "deletes" a posted line | Converted to a linked reversal; original kept; balancing report shows both | P0 | specified | — |
| EC-POS-032 | External POS item code not mapped in Portico | Sale posted to the outlet's default charge code only if policy allows; unmapped item listed (never dropped) for stock and analytics | P0 | specified | — |
| EC-POS-033 | External POS end-of-day total differs from Portico postings | Balancing exception with the difference per tender/room; owner outlet manager; Day Close warning | P0 | specified | — |
| EC-POS-034 | Check transferred between outlets with different tax sectors (tourism vs general) | Lines re-evaluated with the receiving outlet's sector only if not yet settled; preview shows tax change | P1 | missing | — |
| EC-POS-035 | Staff purchase paid by payroll deduction | Settles to a staff deduction account and exports via workforce; never posted to a guest folio | P2 | specified | — |
| EC-POS-036 | In-villa dining order delivered after the guest moved villas | Check linked to the stay (not the unit); delivery address updated from the move; room charge goes to the stay's folio | P1 | missing | — |
| EC-POS-037 | Tax rule change at midnight during a late service | Lines taxed by the rule effective on their service date; check summary shows both rates if lines span | P1 | specified | — |
| EC-POS-038 | Server tries to reopen a closed check settled to room yesterday | Requires permission; adjustment posts as linked correction to the folio (or credit note if invoiced) | P1 | missing | — |

## Evidence sources (all verified 2026-11-07)

Verification method: pages on docs.oracle.com, docs.mews.com, help.mews.com, api.apaleo.com, apaleo.dev and
docs.stripe.com were fetched and read on 2026-11-07. Pages on hosts this environment's proxy blocks
(central.xero.com, quickbooks.intuit.com, help.rguest.com, docs.infor.com, apaleo.zendesk.com,
mewssystems.freshdesk.com, Toast, Omniboost, Stayntouch, Clock, TrustRadius, oracle.com marketing) were verified
2026-11-07 through web-search results showing the page and its content, or through `docs/research/` citations;
re-open them before any external use. Third-party pages (Omniboost, Stayntouch, Clock, TrustRadius) describe a
competitor's behaviour indirectly and are weaker evidence than the vendor's own documentation.

Oracle Simphony 19.8 (`docs.oracle.com/en/industries/food-beverage/simphony/19.8/`): POS user guide `sipou/`,
configuration guide `simcg/`.

[sim-rvc]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_revenue_centers.htm
[sim-serving]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_serving_periods.htm
[sim-menu]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_menu_items.htm
[sim-combo]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_combo_meals.htm
[sim-condiments]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_menu_items_condiments.htm
[sim-allergen]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_menu_items_definitions_config_allergens.htm
[sim-nutrition]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_menu_items_definitions_allergen_nutrition.htm
[sim-availability]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_menu_items_configure_mi_availability.htm
[sim-menu-levels]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_menu_items_menu_levels.htm
[sim-effectivity]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_menu_items_effectivity.htm
[sim-weighed]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_menu_items_weighed.htm
[sim-emc]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_ent_mgmt_console.htm
[sim-import]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_import_export.htm
[sim-clone]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_clone_DB.htm
[sim-lang-receipt]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_multiple_language_printing.htm
[sim-tms]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_tms.htm
[sim-waitlist]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_waitlist_seating.htm
[sim-checks]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_checks.htm
[sim-room-no]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_add_guest_room_no.htm
[sim-repeat]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_menu_items_repeat_mi.htm
[sim-refills]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_menu_item_refills.htm
[sim-memo]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_check_filter_and_memo_check.htm
[sim-suspend]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_checks_suspend_resume.htm
[sim-team]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_checks_team_check.htm
[sim-combine]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_combine_btwn_rvc.htm
[sim-transfer]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_checks_transfers.htm
[sim-order-channels]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_order_management.htm
[sim-delivery]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_delivery_connectors.htm
[sim-kiosk]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_kiosk.htm
[sim-events]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_events.htm
[sim-fire]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_fire_mi.htm
[sim-hold]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_hold_mi.htm
[sim-send-stay]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_send_mi_kds_check_open_ug.htm
[sim-refire]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_refire_items.htm
[sim-printers]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_printers_output_devices.htm
[sim-preprod]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_preprod_chits.htm
[sim-discounts]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_discounts_svc_applying.htm
[sim-discount-priv]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_discounts_privileges.htm
[sim-void-closed]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_closed_check_void.htm
[sim-returns]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_discounts_return.htm
[sim-privileges]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_people_privileges.htm
[sim-reopen]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_closed_check_reopen.htm
[sim-adjust-closed]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_closed_check_adjust.htm
[sim-adjust-cc]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_cc_adjust.htm
[sim-waste]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_menu_items_declare_waste.htm
[sim-waste-reasons]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_menu_items_waste_reasons.htm
[sim-tax-override]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_checks_apply_menu_item_tax_class_override.htm
[sim-alt-currency]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_payment_alternate_currency.htm
[sim-multi-cc]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_payment_multiple_credit_card.htm
[sim-currency]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_payments_currency.htm
[sim-opera-lookup]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_opera_connect_guest_lookup.htm
[sim-opera-tender]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_opera_connect_tender_room_charge.htm
[sim-opera-pkg]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_opera_guest_packages.htm
[sim-taxes]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_taxes.htm
[sim-svc]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_service_charges.htm
[sim-charged-tips]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_payments_charged_tips.htm
[sim-tips]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_employee_tip_track.htm
[sim-qr]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_payment_qr_code.htm
[sim-self-pay]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_payment_consumer_self_pay.htm
[sim-reauth]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_payment_reauthorize_released_cc.htm
[sim-halo]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_payments_halo.htm
[sim-gift]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_loyalty_svc.htm
[sim-deposits]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/c_deposits.htm
[sim-age]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_menu_items_age_verification.htm
[sim-reprint]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_closed_check_reprint.htm
[sim-email]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_email_receipt.htm
[sim-offline]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_properties_offline.htm
[sim-workstations]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_pos_workstations.htm
[sim-drawer]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_cash_drawer.htm
[sim-shift-reports]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_start_shift_run_reports.htm
[sim-ecm]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_ecm.htm
[sim-sod]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_reset_totals_sod.htm
[sim-sod-auto]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/t_reset_auto_totals_sod.htm
[sim-sod-offline]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_reset_totals_sod_offline.htm
[sim-ts]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_web_service.htm
[sim-clock]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_start_shift_clock_in_out.htm
[sim-tiptrack]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/t_start_shift_tip_track.htm
[sim-reporting]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_reporting.htm
[sim-journal]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/sipou/r_checks_held_check_indicators_emp_journal_report.htm
[sim-audit]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_audit.htm
[sim-roles]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_roles.htm
[sim-training]: https://www.oracle.com/industries/micros/pos-training-videos/
[toast-offline]: https://doc.toasttab.com/doc/platformguide/platformOfflineMode.html
[toast-kds-offline]: https://doc.toasttab.com/doc/platformguide/platformOfflineKDSDevices.html
[toast-faq]: https://support.toasttab.com/en/article/New-POS-FAQ
[ls-omni]: https://help.omniboost.io/en/articles/11904362-lightspeed-k-series-room-charge-re-configuration
[ls-snt]: https://stayntouch.freshdesk.com/support/solutions/articles/24000081237-lightspeed-restaurant-k-series-
[ls-clock]: https://clock-software.com/products/integrations/k-series-by-lightspeed
[ig-kds]: https://www.trustradius.com/products/agilysys-infogenesis
[mw-cash-drawer]: https://help.mews.com/s/article/cash-drawer-reports
[mw-pos-uc]: https://docs.mews.com/connector-api/use-cases/point-of-sale
[ap-pos-nonres]: https://apaleo.dev/guides/business-cases/pos-integration/non-reservation-postings.html
[op-event-post]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_osem_managing_event_posting.htm
[op-cl-overage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_using_credit_limit_overage.htm
[op-pos-check]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_viewing_pos_check_image_for_a_charge.htm
[op-pwa-pkg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_package_consumption_mobile_app_pwa.htm
[op-pkg-allow]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_reservation_package_allowances_and_charges.htm
[op-postit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_manage_billing_charging_purchases_using_post_it.htm
[op-pwa-postit]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_charge_it_mobile_app_pwa.htm
[fb-mi-linking]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_mi_linking.htm
[fb-booking-sales]: https://docs.oracle.com/en/industries/food-beverage/back-office/invug/c_booking_sales.htm
[fb-inv-marketing]: https://www.oracle.com/industries/food-beverage/products/inventory-management.html
