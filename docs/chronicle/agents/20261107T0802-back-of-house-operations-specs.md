# Agent run: Back-of-house operations specs

- Started: 2026-11-07T08:02:08.311Z · last activity: 2026-11-07T11:18:40.744Z
- Turns: 118 · tool uses: 80 · output tokens: 502,812
- Type: general-purpose

## Brief (2026-11-07T08:02:08.311Z)

````text
You are Portico's back-of-house product architect. The owner wants Portico to also solve hotel accounting, room charges, F&B, procurement and the rest of back-of-house ("it would be really cool if we solve accounting, room charges, f&b, procurement etc etc"). The original brief warned against shallow versions of enterprise functions and asked to define boundaries — so design these as REAL, deep modules (staged), that also coexist with external systems a hotel keeps (adoption paths: connect alongside / replace selected capabilities / full migration).

WORK ONLY in the git worktree /home/user/wt/backofhouse (branch docs/back-of-house-specs). Only create files under docs/backofhouse/ and NEW spec files under docs/specs/ (do not edit existing specs — put proposed changes to existing specs, especially finance.md and resort.md, in docs/backofhouse/spec-change-requests.md). You may append owner questions to docs/OPEN_QUESTIONS.md numbered from Q100 upward. Commit with Conventional Commits ending with exactly:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do not push. Do not ask questions.

READ FIRST: CLAUDE.md, docs/product/vision.md, the three briefs in docs/product/ (note brief §12 on purchasing/stock and the boundary with accounting/procurement/payroll/workforce), docs/product/glossary.md, docs/architecture/domain-map.md, docs/architecture/overview.md, docs/adr/0008 (double-entry ledger), ALL specs in docs/specs/ (especially finance.md, payments.md, resort.md, operations.md, groups.md, analytics.md, integration.md, billing.md), docs/readiness/maldives-tax-rules.md, docs/readiness/dependency-register.md, docs/adoption/*.md, docs/research/*.md.

A separate agent is auditing the guest-facing journey (keys, guest app, CRM, contracting, in-stay services) — do not spec those.

DELIVER (each new spec follows the existing spec structure incl. invariants that become tests, events, permissions, UX surfaces, scenarios, Maldives specifics, §14 Adoption modes, and a clear "boundary / integrate instead" section):
1. docs/specs/accounting.md — full hotel accounting on top of the existing finance ledger (do NOT duplicate finance; extend it): USALI-aligned chart of accounts & departmental P&L, general ledger journals beyond guest ledger, period close (month/year), accounts payable (supplier invoices, approvals, payments, travel-agent commissions payable, OTA commission invoices), bank accounts & bank reconciliation (statement import), cash management, fixed assets & depreciation, budgets & forecasts, multi-entity consolidation & intercompany, owner accounting & statements, management company fees, financial statements (P&L, balance sheet, cash flow), tax returns data (Maldives TGST return, Green Tax MIRA 501, general GST), audit trail, exports to external ERPs (Xero, QuickBooks, NetSuite, SAP) when a hotel keeps its own accounting. Define clearly which parts are the "hotel ledger" (finance) vs "back-office accounting" (accounting).
2. docs/specs/fnb-pos.md — F&B and outlet point of sale: outlets, menus/modifiers/pricing by time, table plans, table reservations interface, orders, kitchen order tickets & kitchen display (KDS) routing, courses, split/merge checks, room charge with guest lookup & posting privileges & credit limits & signature, meal-plan/all-inclusive entitlement consumption, service charge & TGST per Maldives rules, tips handling, voids/comps with approvals, cashier shifts, offline operation (tablets at a beach bar with bad Wi-Fi), POS hardware boundary (printers, cash drawers, payment terminals), and integration mode for hotels keeping Micros/Simphony, Lightspeed, Toast, local POS.
3. docs/specs/procurement.md — suppliers, purchase requisitions from departments, approval workflows with limits & separation of duties, purchase orders, Maldives realities (imports, sea-freight lead times to islands, consolidated shipments from Malé, customs duty, landed cost), goods receiving (GRN), three-way match (PO/GRN/invoice) feeding accounting AP, supplier performance, contracts & price lists.
4. docs/specs/stock.md (inventory of goods — avoid confusion with accommodation "inventory"; use the glossary-safe name e.g. "stock") — items & units of measure, stores/locations (main store, outlet stores, minibar, housekeeping linen & amenities, engineering spares), issues/transfers, par levels & reorder suggestions, stock counts & variances, costing (FIFO/weighted average), recipes & menu costing with F&B consumption (theoretical vs actual), wastage, linen & guest amenity consumption driven by occupancy, minibar replenishment.
5. docs/specs/workforce.md — the boundary-aware workforce module: staff records linked to identity users, rosters/shift scheduling driven by forecast occupancy, time & attendance, leave, staff accommodation (resort staff village), staff meals, training & certifications (e.g. dive instructors, lifeguards), expatriate work permits & document expiry tracking (Maldives has a large expatriate workforce — research the Xpat system briefly and cite), and the Maldives service-charge distribution calculation to employees (with the currency question from the pending Employment Act amendment) — PAYROLL computation itself as an explicit boundary: export to payroll providers unless the owner later decides otherwise (document trade-offs).
6. docs/specs/concessions-and-utilities.md (or two specs) — third-party concession operators inside resorts (dive centres, spas, boutiques run by partners): room charges on behalf of concessionaires, revenue share/commission, settlement statements; and resort utilities & sustainability (power generation/diesel, desalinated water, waste, metering, sustainability reporting) as operational data with cost allocation.
7. docs/backofhouse/README.md — overview, recommended build order with dependencies on existing modules, what to build natively vs integrate, top risks, and "how a resort's month-end close works in Portico end-to-end" walkthrough from posted folios → AP → bank rec → financial statements → MIRA returns.
8. docs/backofhouse/spec-change-requests.md — changes needed in finance.md, payments.md, resort.md, operations.md, analytics.md, integration.md, domain-map.md to fit these modules (contracts between modules: e.g. POS → finance.postCharge with posting privileges; stock → accounting cost of sales journals; procurement → accounting AP).
Use web search where it adds verified facts (USALI 12th edition structure, Maldives import/customs, Xpat work permits, common POS used by Maldives resorts), citing URLs with "verified 2026-11-07"; label assumptions. Final reply (~300 words): modules proposed, key boundary decisions, build order, files, questions added.
````

## Follow-up message (2026-11-07T11:13:08.763Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (concessions and utilities spec is committed; check what remains: README walkthrough, spec-change-requests). Finish and deliver your final report as originally specified.

Address this before completing your current task.
````

## Report (2026-11-07T11:18:40.457Z)

````text
I've written seven back-of-house specs plus three supporting documents in /home/user/wt/backofhouse (branch docs/back-of-house-specs), committed in 8 Conventional Commits with the required trailers and not pushed. Everything is at R1 (planned); no spec is built or tested, and no existing spec, domain map or glossary was edited.

**Modules (new files in docs/specs/):** accounting.md, fnb-pos.md, procurement.md, stock.md, workforce.md, concessions.md and utilities.md. I split concessions and utilities into two specs because they are separate bounded contexts. Each spec has the standard sections plus §15 "build here vs integrate instead" and cited sources.

**Key boundary decisions:**
- **One journal, not two ledgers.** `finance` keeps the journal and the hotel ledger (folios, deposits, receivables, cashier sessions). `accounting` adds payables, bank reconciliation, period close, USALI-aligned statements, MIRA 206/205/501 return data, assets, budgets, management fees and ERP export. Every module posts through a new `finance.postJournal` onto control accounts it owns, with keyed clearing accounts for hand-offs between modules.
- **Payroll is not built.** Portico exports payroll inputs (hours, leave, days worked, service-charge shares) and checks the payroll journal that comes back. No salaries are stored.
- **Money and filings stay with the hotel.** Portico prepares bank payment instructions but never executes them. MIRA, Xpat and Labour Relations Authority filings are manual, with references recorded in Portico.
- **Hotels can keep their systems.** External POS posts through a single intake API, with one charge source per outlet. ERPs receive journals and documents. Five new data-authority domains are proposed: `payables`, `purchasing`, `stock`, `staffRecords`, `timeAttendance`.

**Build order:** BOH-0 ledger contracts → BOH-1 F&B POS → BOH-2 accounting core → BOH-3 procurement and stock → BOH-4 workforce → BOH-5 concessions, utilities and accounting depth. None of it starts before the pilot slice (Q26), apart from the small ledger contracts in BOH-0.

**Supporting files (docs/backofhouse/):** README.md has the overview, build order, native-vs-integrate table, top risks and the month-end close walkthrough. scenarios.md defines proof scenarios B01–B20. spec-change-requests.md holds CR-01 to CR-35 for finance, payments, resort, operations, analytics, integration, the domain map, identity, platform, glossary, editions and the adoption and readiness docs. All CR references in the specs resolve.

**Questions added:** Q100–Q109 cover scope and the vision wording, payroll, storing service-charge shares against the identity rule that forbids salary-like data, service-charge rules and payout currency, concession agent vs principal, USALI materials, adviser items, bank formats, POS hardware support and packaging.

**Research limits:** facts were verified 2026-11-07 via web search only; direct fetches of .mv sites were blocked, and USALI 12th-edition line items are unverified. Maldives logistics and POS usage are labelled assumptions. `main` has since added CLAUDE.md rule 17 and a parity gate; CR-35 lists the alignment needed on merge.

````

