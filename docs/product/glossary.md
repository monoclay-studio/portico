# Portico glossary

One term per concept, used identically in UI copy, API, code and docs. Code identifiers use the
`camelCase`/`snake_case` form in brackets. If you need a concept that is not here, add it here first.

Portico's terms are original. Where staff know an industry term, the UI may show it as a hint
(e.g. "Day Close (night audit)") but the product term is the one below.

## Organization and ownership

| Term | Meaning |
|---|---|
| **Organization** [`tenant`] | The software customer (a hotel company, group, or single-property owner). The hard isolation boundary for data and money. Code uses `tenantId`. |
| **Environment** | Every organization has a `live` environment and may have `trial` (isolated organization holding an authorized copy of a hotel's data), `sandbox` (partner/integration testing against provider sandboxes), `training` and `demo` environments. They are separate tenants, visibly labeled, and never share data or money. Non-live environments cannot cause real-world effects. |
| **Brand** | A named product line within an organization (e.g. "Azure Isles Resorts"). Optional. |
| **Region** | A geographic or management grouping of properties. Optional; nestable. |
| **Portfolio** | The hierarchy Organization → Brand/Region → Property used for policy inheritance and reporting. |
| **Property** [`property`] | A single operated hotel, resort, guesthouse, apartment building, etc. Has a timezone, base currency, business date and a **property profile** (guesthouse, hotel, resort, serviced apartments, hostel). |
| **Legal entity** [`legalEntity`] | The company that operates a property, issues invoices, owns the payment account and the books. A property has exactly one operating legal entity at a time. |
| **Owner** [`owner`] | An individual or company that owns units (e.g. condo-hotel villas, apartments) and requires separate owner accounting/statements. |
| **Department** | An operational team at a property (Front Office, Housekeeping, Engineering, F&B, Reservations, Finance…). Tasks and conversations are owned by departments. |
| **Outlet** | A revenue point (restaurant, bar, spa, dive center, boutique, transfer desk) that posts charges. |
| **Plan / Edition** | Monoclay's commercial package (Essentials, Professional, Resort, Enterprise). Determines **entitlements** (features and limits). Separate from anything guests pay. |
| **Policy** | A configuration value defined at organization/brand/region level and inherited by properties. A property value that differs is a **local override**, always labeled as such. |

## People

| Term | Meaning |
|---|---|
| **Staff member** [`user`] | A person who signs in. Has **role assignments** scoped to the organization, a brand/region, a property, or a department. |
| **Role** | A named set of permissions (e.g. Front Desk Agent, Night Manager, Housekeeping Supervisor). |
| **Guest profile** [`guestProfile`] | A person known to the organization (guest, booker, payer contact). |
| **Company** [`company`] | An organization that books or pays (corporate account). Can have a receivables account and credit limit. |
| **Travel agent** [`agency`] | An agency/tour operator/OTA-as-merchant that books on behalf of guests; may earn commission. Modeled as a company with `kind=agency`. |
| **Booker** | Whoever made the booking (person, company, agency, channel). |
| **Occupant** | A person staying in a unit on a stay (adult/child with age). |
| **Payer** | The party responsible for a folio. |

## Accommodation and inventory

| Term | Meaning |
|---|---|
| **Unit** [`unit`] | A physical sellable accommodation: room, villa, suite, apartment, bed, tent, pitch. Has a number/name, location, features, max occupancy. |
| **Unit type** [`unitType`] | The category that is sold and priced (e.g. "Beach Villa with Pool"). Inventory is counted per unit type per night. |
| **Composite unit** | A unit made of other units (e.g. a 2-bedroom suite = two connecting rooms). Selling or assigning it consumes its components and vice versa. |
| **Night** [`stayDate`] | One overnight period identified by its arrival-side date. A stay from 10 → 13 Mar has nights 10, 11, 12. |
| **Availability** | Per unit type per night: `capacity − out of order − sold − held + authorized overbooking`. Always explainable ("why"). |
| **Hold** [`inventoryHold`] | A temporary claim on inventory with an expiry (quote, cart, group option). |
| **Assignment** | Linking a stay to a specific unit for a date range. Guaranteed by the database never to overlap. |
| **Out of order (OOO)** | Unit removed from sellable inventory (maintenance). Reduces availability. |
| **Out of service (OOS)** | Unit temporarily not assignable but still counted in inventory (short fix). |
| **House use** | Unit used by the hotel itself (staff, owner) — consumes inventory, no revenue. |
| **Authorized overbooking** | An explicit, permissioned allowance to sell beyond capacity for a unit type/night. Distinct from an **inventory conflict** (unintended). |

## Reservations

| Term | Meaning |
|---|---|
| **Booking** [`booking`] | What a booker made: one confirmation code, one or more stays, a source, terms and a guarantee. |
| **Stay** [`stay`] | One unit (of a unit type) for a date range with its occupants, rate plan and agreed price. The thing that is checked in and out. |
| **Stay segment** | Part of a stay with a different unit type / rate / unit (split stays, room moves). |
| **Quote** | Priced offer(s) for a stay request; not yet a booking. May create a hold. |
| **Booking status** | `inquiry` → `quoted` → `held` → `tentative` → `confirmed`; terminal: `cancelled`, `declined`, `expired`, `completed`. |
| **Stay status** | `expected`, `in_house`, `departed`, `cancelled`, `no_show`, `waitlisted`. Separate from **occupancy**, **unit condition**, **unit availability**, and **payment status** — never merged into one field. |
| **Guarantee** | How the booking is secured: `none`, `card`, `deposit`, `company`, `agency`, `prepaid_channel`. |
| **Agreed terms** [`termsSnapshot`] | Immutable snapshot of nightly prices, taxes/fees rules, inclusions, cancellation and deposit policy captured when the stay was confirmed or last re-priced with consent. |
| **Change preview** | The computed effect of a proposed change (availability, price, taxes, inclusions, deposits, balance) shown before commit. |
| **Group** [`group`] | A sales account for multiple rooms/events (wedding, tour, conference) with a **block**. |
| **Block** [`block`] | Rooms reserved for a group per unit type per night, with a release (cut-off) date and **pickup** (stays booked against it). Status: `inquiry`, `tentative`, `definite`, `released`, `cancelled`, `lost`. |
| **Allotment** | A block contracted to an agency/channel with its own release rules. |
| **Rooming list** | The list of occupants and stays for a block. |
| **Source** / **Channel** / **Market segment** | Where the booking came from (direct web, phone, OTA X, GDS, walk-in), which connection delivered it, and the commercial segment (leisure, corporate, group, wholesale…). |

## Pricing

| Term | Meaning |
|---|---|
| **Rate plan** [`ratePlan`] | A sellable price + conditions bundle (meal plan, cancellation policy, guarantee policy, restrictions, channels). May be **derived** from a parent plan (± amount/percent). |
| **Price** | Amount per unit type per night per occupancy for a rate plan. |
| **Restriction** | Min/max length of stay, closed, closed to arrival (CTA), closed to departure (CTD), min/max advance, sales limit. |
| **Inclusion** | A component included in a rate/package (breakfast, transfer, spa credit). |
| **Allowance** | A monetary or quantity entitlement the guest may consume (e.g. $100 dining credit/day). Tracked to consumption; unused remainder handled by policy. |
| **Package** | A sellable bundle of inclusions/allowances attached to a rate plan or added to a stay. |
| **Meal plan** | Room only, bed & breakfast, half board, full board, all inclusive (+ custom). Implemented as inclusions/allowances. |
| **Tax & fee rule** | A rule that computes taxes, levies and service charges (percentage, per person-night, per unit-night, banded, capped, exempt; inclusive or exclusive). E.g. Maldives TGST, Green Tax, service charge. |

## Finance

| Term | Meaning |
|---|---|
| **Ledger** | Double-entry journal per legal entity. The source of truth for money. |
| **Ledger account** | An account in the chart of accounts (revenue, tax payable, deposits held, guest receivables, cash, card clearing…). |
| **Journal entry** | A balanced, immutable set of ledger lines. Corrections are new entries linked to the original. |
| **Folio** [`folio`] | A bill for one payer, attached to a stay, booking, group, company or house account. A stay can have several folios (split billing). |
| **Posting** | A line on a folio: charge, payment, adjustment, transfer, allowance usage. Each posting is backed by journal entries. |
| **Charge code** | Classifies postings (Room, Breakfast, Spa, Minibar…) and maps them to revenue accounts and tax rules. |
| **Billing rule** | Routing: which folio a posting goes to, by charge code group, date range, payer and limit. Previewable. |
| **Deposit** | Money received before service. A liability until applied. |
| **Receivables account** [`arAccount`] | A company/agency account that is invoiced (city ledger). Aging and credit limits apply. |
| **Invoice / Credit note** | Fiscal documents issued from a folio, numbered gaplessly per legal entity series, immutable. |
| **Cashier session** | A staff member's cash/card drawer for a shift, opened and closed with counts and variance. |
| **Business date** | The property's accounting day, advanced by Day Close. Differs from the calendar date around midnight. |
| **Day Close** (night audit) | The controlled, resumable end-of-day process: checks, room/package postings, no-shows, ledger checks, statistics, business-date advance. |
| **Restatement** | A labeled adjustment to a closed period, shown in reports with reason and link. |

## Payments

| Term | Meaning |
|---|---|
| **Payment account** | A legal entity's account at a payment provider (e.g. Stripe connected account). The legal entity is merchant of record. |
| **Payment method** | A tokenized card/wallet/bank method stored at the provider. Portico never stores card numbers. |
| **Authorization** | Funds reserved on a card. **Not** a payment. |
| **Capture** / **Payment** | Funds actually collected. Only a provider-confirmed capture/payment is "paid". |
| **Pending verification** | Outcome unknown (timeout, provider outage). Resolved by reconciliation, never by guessing. |
| **Refund** | A new transaction linked to the original payment. |
| **Dispute** | A chargeback/inquiry raised by the card holder. |
| **Payout** | Provider transfer of settled funds to the hotel's bank. Reconciled, never revenue. |
| **Payment request** | A link/message asking a guest to pay or authorize. Submitted ≠ paid. |
| **Virtual card (VCC)** | A single-use card issued by an OTA to pay for a stay, with an activation date and amount. |

## Operations

| Term | Meaning |
|---|---|
| **Unit condition** | Housekeeping state: `dirty`, `cleaning`, `clean`, `inspected`, `failed_inspection`. Separate from occupancy. |
| **Occupancy (physical)** | `vacant` / `occupied` derived from in-house stays, plus housekeeping-reported discrepancies (`skip`, `sleep`). |
| **Task** [`task`] | Any unit of work with an owning department, assignee, due time, status (`open`, `in_progress`, `blocked`, `done`, `verified`, `cancelled`) and escalation path. Guest requests, cleaning, inspections and work orders are tasks. |
| **Service request** | A guest-originated request that creates a task. "Done" means the task is done, not that a message was sent. |
| **Work order** | A maintenance task with asset/location, urgency, photos, parts, and inventory impact. |
| **Handover** | A shift log of unresolved tasks, financial exceptions and guest commitments, each with an owner. |
| **Itinerary** | The guest's timeline across stay, transfers, dining, activities and spa. |
| **Transfer** | A transport leg (seaplane, speedboat, domestic flight, car) with manifest, capacity and status. |
| **Activity / Experience** | A bookable session (dive, excursion, spa treatment) with capacity, resources, staff, eligibility and waivers. |

## Integration and data

| Term | Meaning |
|---|---|
| **Integration status** | `supported` (code exists) → `configured` (credentials/mapping set) → `tested` (verified in sandbox) → `live` (exchanging production data). Never collapsed. |
| **Connection health** | Last successful exchange, pending updates, failures, mapping problems, open discrepancies. |
| **Discrepancy** | A detected mismatch between Portico and an external system (inventory, reservation, payment), with a resolution workflow. |
| **Import job** | A migration run with mapping, validation, a comparison report, and financial reconciliation. |

## Adoption and integration

| Term | Meaning |
|---|---|
| **Adoption path** | A: connect alongside existing systems; B: replace selected capabilities; C: full migration to Portico. Defined by data authority, so it is checkable in data. |
| **System of record** [`dataAuthority`] | The one system authoritative for a governed data domain at a property: Portico or an external connection. |
| **Governed domain** | `reservations`, `availability`, `rates`, `guestProfiles`, `charges`, `payments`, `roomStatus`, `maintenance`, `accounting`. |
| **Room status** [`roomStatus`] | The governed domain covering unit condition, occupancy discrepancies and DND. UI copy keeps the term **unit condition** for the housekeeping state. |
| **Write mode** | `exclusive` (Portico authoritative), `forward` or `read_only` (external authoritative). |
| **Authority transition** | A controlled move of a domain's system of record: `planned → frozen → effective`. |
| **Connected mode** | A module working on mirrored records whose system of record is external. |
| **Standalone module** | A capability offered without the Portico PMS core, running in connected mode. |
| **Connection** | An authorized link between a Portico organization/property and one external product. |
| **Connector** | Portico's adapter code for a provider product/version. |
| **Local connector** | Portico software installed on the hotel network for systems that cannot reach the cloud. |
| **Workflow** | A defined exchange (e.g. POS charge posting) with capabilities read / create / update / receive-changes and a sync mode. |
| **Sync mode** | Immediate, periodic, manual or file. A file exchange is never presented as a live connection. |
| **Mapping** / **Mapping suggestion** | A link between a Portico entity and an external one / a proposed link with confidence and reasons, requiring review when ambiguous or financially significant. |
| **Validation run** | Recorded checks proving a connection behaves correctly before activation. |
| **Activation scope** | The approved set of properties, workflows and external effects a connection or pilot may perform. |
| **Exchange** / **Exchange log** | One message or record sent or received / the log of all of them. |
| **Outbound operation** | A change Portico sends to another system, tracked until confirmed or resolved. Never blindly replayed after reconnection. |
| **Integration exception** | A failed or incomplete exchange or workflow needing a person; severity urgent or routine; with business impact, responsible party and next step. |
| **Sender register** | Per property, which system sends each automated guest message type (prevents duplicate messages). |
| **Promotion package** | Configuration carried from a trial to production after review. |
| **Cutover journal** | Record of every business change after a migration switch, used for rollback without losing post-cutover activity. |
| **Historical archive** | Read-only record of source-system history that was not migrated. |
| **Continuity snapshot** | Read-only local copy of essential operational lists for outages. |
| **Provenance** | Where displayed information comes from: `live`, `simulated`, `copied`, `delayed`, `incomplete`, `external`. |
