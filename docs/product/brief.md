# Product brief (owner's original requirements — verbatim)

> This is the owner's brief. It is the top-level requirement document. Specs in `docs/specs/` refine it;
> they must never contradict it. Owner decisions made after the brief are in `docs/product/decisions.md`.

Build a complete hospitality management platform with the operational depth to compete with Oracle OPERA Cloud, Mews, Cloudbeds, and other leading systems, combined with an exceptionally clear, efficient user experience.
Use your judgment about the technical approach. This brief specifies the product, its behavior, and the standard it must meet.
The ambition is a serious commercial product that hotels can depend on throughout every shift. Achieving that requires accurate operations, dependable financial records, useful integrations, thoughtful design, and demonstrable readiness.

## 1. Product ambition and competitive foundations

Combine these strengths into a coherent experience:

* OPERA Cloud: complex hotel operations, corporate and group business, financial controls, and portfolio management.
* Mews: approachable workflows, automation, embedded payments, connected guest journeys, and extensibility.
* Cloudbeds: tightly connected reservations, distribution, direct bookings, payments, and guest operations.
* SiteMinder: reliable distribution, channel visibility, and direct-booking capabilities.
* Apaleo: openness, data portability, and flexibility to connect specialist tools.
* Stayntouch: effective mobile workflows for staff working throughout a property.
* Shiji Daylight: portfolio configuration, guest recognition across properties, and strong search.
* Agilysys: connected resort experiences and revenue from dining, spa, activities, and other outlets.
* Infor HMS: role-specific operations and sophisticated property requirements.
* Guesty, RMS, and RoomRaccoon: flexible accommodation models, communication automation, and practical workflows for smaller operators.

These are capability references. Create an original product with consistent terminology, behavior, and design.
Our competitive advantage should be that a property can handle complicated operations with less effort, fewer mistakes, better visibility, and more confidence.

## 2. Customers, scope, and ownership

Support independent hotels, boutique hotels, full-service hotels, resorts, serviced apartments, and hotel groups.
Provide appropriate configurations for different property types. A small hotel should not have to navigate unnecessary enterprise complexity. A large resort should not run into simplistic operational limits.
Distinguish:

* The software customer or hospitality organization.
* Its brands, regions, properties, departments, and outlets.
* The legal entities that operate those properties.
* Individual owners where ownership arrangements require separate accounting.
* Staff members and their authorized responsibilities.
* Guests, bookers, companies, travel agents, and other payers.

Treat each hospitality customer's information and money as separate from every other customer.
The platform's subscription billing is separate from payments hotels collect from guests. Monoclay may sell the software, but that does not automatically make Monoclay the merchant for hotel stays.

## 3. Product principles

Every important record should show its current state, relevant history, outstanding issues, responsible person or team, and available next actions.
The same operational facts must agree across departments. A room move, payment, maintenance restriction, or booking cancellation must have consistent consequences wherever that information appears.
Use sensible defaults and progressive disclosure. Allow configuration where real hotel policies differ, while keeping ordinary tasks straightforward.
Critical operations must remain usable without AI.
Clearly distinguish confirmed facts, pending updates, estimates, suggestions, and information received from external services.

## 4. Reservations, accommodation, and availability

Support rooms, villas, suites, apartments, beds where applicable, and other configured accommodation units.
Distinguish room-type inventory from assignment to a specific room. Support connecting rooms and configurations where selling one unit affects availability of another.
Provide clear calendars and lists for reservations, occupancy, assignments, and availability. Users must understand why a unit is available, unavailable, held, blocked, or oversold.
Cover:

* Direct, OTA, corporate, travel-agent, group, and walk-in reservations.
* Inquiries, quotations, temporary holds, tentative bookings, confirmations, cancellations, no-shows, and completed stays.
* Multiple rooms, multiple occupants, children and age-based rules.
* Split stays, room moves, extensions, shortened stays, early arrivals, and late departures.
* Waitlists, upgrade offers, complimentary stays, and house-use inventory.
* Group blocks, allotments, release dates, pickup, and rooming lists.
* Guaranteed versus nonguaranteed reservations and deposit requirements.
* Booking source, market segment, commission arrangements, and cancellation terms.

A reservation change must show its effects on availability, rates, taxes, packages, deposits, and remaining balance before it is committed.
Two employees attempting to sell the last available unit must receive a consistent result.
Authorized deliberate overbooking must be distinguishable from an accidental inventory conflict. External-channel conflicts need an explicit resolution workflow, including guest relocation when necessary.

## 5. Rates, packages, and revenue

Support seasonal pricing, negotiated rates, derived rates, promotions, occupancy-based pricing, length-of-stay rules, minimum and maximum stays, closed-to-arrival/departure restrictions, and sales limits.
Support inclusive and exclusive taxes, service charges, meal plans, and packages with component allowances.
Preserve the terms and price agreed at booking. A subsequent rate or tax configuration change must not silently rewrite historical agreements.
Show demand, pickup, pace, occupancy, ADR, RevPAR, cancellations, no-shows, channel costs, and relevant ancillary revenue.
Recommendations should explain their assumptions, data freshness, expected effect, and uncertainty. Allow controlled automation with explicit limits and a clear history of changes.

## 6. Front desk and guest service

Make these everyday actions exceptionally clear:
Find a reservation, prepare an arrival, assign a room, verify required information, collect or authorize payment, issue access, check in, handle a request, move rooms, extend a stay, resolve a balance, and check out.
Show arrivals, departures, in-house guests, room readiness, waiting guests, important requests, and unresolved issues in an operational view suited to the role.
Keep booking status, physical occupancy, housekeeping condition, maintenance availability, and payment status distinct.
An interrupted workflow must make it clear which steps succeeded and which remain incomplete.
Support shift handovers with unresolved tasks, financial exceptions, guest commitments, and ownership. Important information must survive a change of shift.

## 7. Guest identity, relationships, and communication

Distinguish the booker, staying guests, payer, company, and travel agent. They may be different people or organizations.
Provide a useful guest history covering reservations, preferences, requests, communications, service recovery, and relevant spending.
Support duplicate detection and careful profile merging. Preserve the ability to investigate or correct a mistaken merge.
Share guest information across properties only within appropriate organizational permissions and consent rules.
Provide a unified communication workspace with the guest's context, channel, responsible team, response status, and history. Avoid duplicate or contradictory replies from different departments.
Support multilingual communication and translation while preserving the original message.
Guest-facing experiences should cover direct booking, pre-arrival information, requests, permitted booking changes, payments, upsells, itinerary, and checkout. Guests should not repeatedly enter information already available.

## 8. Housekeeping, maintenance, and service delivery

Support cleaning assignments, inspections, priorities, expected completion, turndown where relevant, do-not-disturb status, room discrepancies, lost and found, and guest requests.
Assignments should account for room status, departures, arrivals, priority, and staff workload.
Maintenance should include faults, asset/location, urgency, ownership, photographs, work history, preventive work, and the effect on sellable inventory.
Taking a room out of service must identify affected reservations and require resolution. Returning it to sale must respect required maintenance and inspection steps.
Mobile staff workflows should be practical for actual working conditions: quick actions, readable screens, clear synchronization status, and minimal typing.
Every service request needs a responsible team, status, and escalation path. A message saying "done" is insufficient if the operational task remains open.

## 9. Hotel finance, folios, and payments

Provide guest, group, company, and house accounts with clear responsibility for charges.
Support:

* Separate folio windows and split bills.
* Charge routing by category, date, payer, and agreed limits.
* Deposits, authorizations, captures, payments, partial payments, refunds, and disputes.
* Room, package, outlet, transfer, activity, and incidental charges.
* Taxes, service charges, exemptions, discounts, commissions, and gratuities where applicable.
* Invoices, credit notes, receipts, accounts receivable, debtor aging, and credit limits.
* Cashier shifts, cash movements, cash/card reconciliation, and payout reconciliation.
* Multiple currencies with explicit exchange rates and settlement differences.

Financial principles are non-negotiable:

* An authorization is not a collected payment.
* A deposit is not automatically earned revenue.
* A payout is not a new sale.
* Refunds do not erase the original transaction.
* Retried actions must not duplicate charges, refunds, invoices, or accounting entries.
* Posted financial records must have traceable corrections.
* Totals must reconcile across folios, transaction records, payment providers, and financial exports.
* Hotel operating records must distinguish revenue dates, transaction timestamps, stay dates, and business dates.

Support late charges after departure, disputed items, third-party payments, OTA virtual cards where supported, and failed or uncertain payment outcomes.
Do not show "paid" merely because a payment request was submitted.

## 10. Night audit and daily close

Treat night audit as a controlled operational and financial process.
Show outstanding arrivals, departures, unresolved cashier items, missing postings, unbalanced accounts, and other relevant exceptions.
Support room and package postings, no-show handling, ledger checks, business-date advancement, reporting, and exports according to property policy.
If processing stops halfway through, staff must know what completed and be able to recover without duplicate postings.
Historical reports should remain understandable after later corrections. Explain restatements and adjustments rather than silently changing past results.

## 11. Distribution and direct booking

Provide a branded, accessible booking experience with accurate availability, transparent pricing, clear policies, and useful extras.
For external channels, handle new reservations, modifications, cancellations, acknowledgements, delayed messages, duplicates, and missed-message recovery.
Show connection health, last successful exchange, pending updates, mapping problems, and unresolved discrepancies.
A channel outage must not appear as successful synchronization. Staff need to understand the impact and their available actions.
Do not promise absolute prevention of overbooking across independent external systems. Minimize avoidable conflicts, detect discrepancies promptly, and provide practical recovery.
Actual connections may require partner approval or certification. Clearly distinguish supported, configured, tested, and live integrations.

## 12. Groups, events, outlets, and resort operations

Support group and corporate sales from inquiry through proposal, contract, room block, event planning, pickup, billing, and settlement.
Include function-space availability, event orders, schedules, resource requirements, deposits, and changes visible to affected departments.
Connect dining, bars, spa, activities, transport, retail, and other amenities to the guest stay and financial records. Allow specialist systems to participate without requiring duplicate entry.
Support resort-specific needs such as:

* Meal-plan entitlements, allowances, exclusions, and consumption.
* Airport, boat, or seaplane transfers with arrival details, manifests, capacity, and disruptions.
* Shared guest itineraries across accommodation and experiences.
* Activities requiring equipment, staff, capacity, waivers, or eligibility checks.
* Weather-driven cancellations, rebooking, and refunds.
* Family and group coordination.
* Different charging and payment responsibilities for accommodation and extras.

Include operational purchasing requests, stock consumption, and replenishment needs where they affect hospitality workflows. Define the boundary with specialist accounting, procurement, payroll, and workforce systems rather than assuming shallow versions of every enterprise function are sufficient.

## 13. Portfolio controls and analytics

Allow central policies with clearly identified local overrides. Show the affected properties before applying a portfolio-wide change.
Support property-scoped permissions, consolidated reporting, comparable metrics, and visibility into local exceptions.
Every metric should have an understandable definition, reporting period, currency treatment, and source.
Managers must be able to move from a summary to the underlying operational records.
Include financial, commercial, operational, guest-service, and integration-health reporting. Make unresolved exceptions and data-quality problems visible.

## 14. Automation and AI

Provide useful automation for reminders, payment requests, housekeeping tasks, communications, and escalation.
Users should understand the trigger, conditions, action, owner, and history of each automation. Prevent repeated or contradictory actions.
AI should help staff find information, summarize a stay or handover, draft responses, identify anomalies, and propose appropriate actions.
AI answers about a guest, booking, policy, balance, or report should identify the supporting records and respect the user's permissions.
Require appropriate approval for consequential actions. Never allow a model to invent a payment outcome, room availability, policy, or confirmed reservation.

## 15. User experience requirements

Aim for a polished interface that makes busy operational work feel manageable.
Prioritize:

* Clear information hierarchy and readable typography.
* Efficient tables, calendars, filters, and saved views.
* Fast global search with permission-aware results.
* Keyboard support for experienced users.
* Touch-friendly controls for mobile staff.
* Consistent interaction patterns and terminology.
* Preserved context when switching between related records.
* Clear previews for consequential changes.
* Useful errors that explain the problem and recovery.
* Confirmation only where consequences justify interruption.
* Accessible contrast, focus behavior, labels, and alternatives to color.
* Persistent work and clear handling of concurrent edits.

A failed action must not look successful. A successful action must not leave the user uncertain whether to repeat it.
Evaluate the experience using realistic hotel tasks and representative users. Record completion time, errors, unnecessary navigation, and points where staff need help.
Proposed usability targets should be clearly identified as targets, then validated. Visual polish alone is not evidence of superior usability.

## 16. Migration, continuity, and trust

Hotels must be able to import future reservations, guest records, deposits, balances, rates, inventory, company accounts, and relevant history with clear mapping and validation.
Provide comparison reports showing what matched, what was rejected, what is incomplete, and whether financial totals reconcile.
Support training and demonstration environments clearly separated from live operations.
During connectivity failures, show what is available, what is stale, and which actions are safe. Never imply that offline inventory or payment information is current.
Provide meaningful backup, recovery, audit, privacy, retention, access-control, and export capabilities. Validate applicable country and payment requirements before claiming compliance.
Customer data must remain accessible and exportable when they leave the platform.

## 17. Required operational proof

Use these scenarios to judge whether the product actually works:

1. Two reservation agents attempt to sell the final available room.
2. An OTA reservation is delivered twice, then modified and cancelled.
3. A guest extends a stay into dates when their assigned villa is already booked.
4. A family books several rooms, while a company pays accommodation and guests pay incidentals.
5. A payment succeeds externally, but the screen times out before confirmation.
6. A refund request is retried after an interruption.
7. A room fails inspection just before its arriving guest reaches reception.
8. A maintenance outage makes several assigned rooms unavailable.
9. Night audit stops after some charges have been posted.
10. A restaurant charge arrives after the guest has checked out.
11. A group reduces its room block after a contractual deadline.
12. A transfer delay affects check-in, dining, and an activity booking.
13. A staff member loses connectivity while updating housekeeping.
14. Two users edit the same reservation.
15. A profile is merged incorrectly and needs correction.
16. A group administrator changes a policy that some properties have overridden.
17. A user tries to access another hotel customer's records.
18. Imported deposits disagree with the previous system's closing balance.
19. A guest's bill combines packages, allowances, different taxes, and partial payments.
20. A channel or payment integration goes unavailable during a busy shift.

For each scenario, show the user experience, resulting state, financial and inventory effects, audit history, and recovery behavior.

## 18. Standard for completion

Preserve the full product ambition while delivering coherent, usable capabilities.
Do not call a feature complete because its screen exists. Completion requires working behavior, persistent records, correct permissions, appropriate error handling, and evidence from relevant operational scenarios.
Distinguish:

* Demonstrated with sample data.
* Working within the application.
* Integrated and verified with an external service.
* Validated with real hospitality users.
* Ready for a controlled live pilot.
* Proven in live operation.

Make unresolved assumptions, limitations, dependencies, and readiness gaps explicit.
Use your judgment to resolve ordinary product details. Ask only about decisions that materially change the product or its business responsibilities.
The goal is a system hotel staff can learn easily, operate confidently, and trust when a shift becomes difficult.
