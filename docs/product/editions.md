# Editions, entitlements and property profiles

Status: Proposal v1 · 2026-11-07 · Owner decision pending on prices and final packaging (OPEN_QUESTIONS **Q3**).
Canonical source for entitlement keys referenced by `docs/specs/*.md` and by `modules/platform/src/domain/plans.ts`.

**No prices appear in this document.** Prices are a commercial decision (Q3) and will live as configuration in
`billing`. Usage-based third-party costs follow Q45.

## 1. Two separate mechanisms

| Mechanism | Answers | Decided by | Effect |
|---|---|---|---|
| **Edition + add-ons → entitlements** | What may this organization use (commercially)? | Contract / plan | Server-side gate (`requireEntitlement`, `EntitlementError`). |
| **Property profile → defaults and visibility** | What should this property see and how should it behave by default? | Property setup, changeable | Policy defaults and feature visibility (`ui.features.<key>.visible`). Never grants anything. |
| **Data authority → usability** | Which system is the system of record for each domain here? | Adoption path (ADR-0014) | Features that would write to an externally-owned domain are forwarded or hidden (PLT-R40). |

A feature appears to a user only when **entitled ∧ visible for the profile (or revealed by an admin) ∧ usable under
the property's data authority ∧ permitted by the user's role**. This is how a guesthouse never sees resort or
enterprise complexity it did not enable, and a resort never hits a simplistic ceiling.

## 2. Packaging principles

1. **Never gate correctness, safety or trust.** Change previews, audit, MFA, data export, migration import, trial and
   training environments, distribution health, profile merge/unmerge, Day Close, cashier sessions, multi-currency,
   the tax engine, data authority/connected mode, standard reports and accessibility are in every edition.
2. **Gate scale and specialist depth, not basics.** Editions differ by property/unit limits and by specialist
   capabilities (groups, events, resort operations, portfolio governance, enterprise identity) — never by rate counts,
   channel counts or data history (research 02 §2.8 item 5 anti-pattern).
3. **Integration is a core product capability** (adoption brief §1): the catalogue, connections, mappings, health and
   connected mode are in every edition. Only POS charge intake is gated (`integration.pos`).
4. **Automation and pricing help are not premium-only** (research 03 §5.6, §14 items 9 and 11): guest-message
   automation and the pricing assistant are in every edition.
5. **Usage that costs money is metered, capped and visible** (`usage.*`), never silently bundled (readiness §16, Q45).
6. **Downgrades never delete data** (PLT-R23). Limits block only *activation* of more properties/units, never
   operation of existing ones.
7. **Staff accounts should not be priced** — per-user limits push hotels to share logins, which destroys attribution
   and audit (IDN-R04). Recommendation below: remove `limits.users` (owner decision under Q3).

## 3. Editions

| Edition | For | Typical customer |
|---|---|---|
| **Essentials** | One small property run by a few people | 6–40-unit guesthouse, B&B, small boutique hotel, small hostel |
| **Professional** | Full-service hotels and small groups | 40–300-unit hotel, serviced apartments, 2–3-property group |
| **Resort** | Destination resorts with outlets, transfers and experiences | 30–1,000-villa island resort, resort group up to 5 properties |
| **Enterprise** | Portfolios with central governance | Regional/international groups, management companies, multi-brand |
| **Connect** (proposed) | Hotels keeping their PMS and adopting selected Portico modules | Any segment on the "connect alongside" or "replace selected capabilities" path |

## 4. Feature and limit matrix

✓ included · ＋ available as add-on · — not available · L = LATER (designed, built in a later wave).
"Δ plans.ts" marks a recommended change to the implemented `modules/platform/src/domain/plans.ts` (see §7).

### 4.1 Core (every edition, including Connect where the module is subscribed)

| Key | Capability | Ess | Pro | Resort | Ent |
|---|---|---|---|---|---|
| `core.reservations` | Bookings, stays, change previews, Timeline, waitlist, walk-ins, multi-stay bookings | ✓ | ✓ | ✓ | ✓ |
| `core.frontDesk` | Arrivals/departures/in-house, check-in/out checklists, handover, relocation | ✓ | ✓ | ✓ | ✓ |
| `core.housekeeping` | Unit condition, tasks, inspections, staff mobile app (offline) | ✓ | ✓ | ✓ | ✓ |
| `core.maintenance` | Work orders with inventory impact, lost & found | ✓ | ✓ | ✓ | ✓ |
| `core.folios` | Ledger, folios, billing rules, deposits, invoices, cashier sessions, multi-currency, meal plans & inclusions | ✓ | ✓ | ✓ | ✓ |
| `core.payments` | Payment accounts, links, cash, bank transfer, external terminal records, collection plans, VCC | ✓ | ✓ | ✓ | ✓ |
| `core.dayClose` | Day Close with continuous exception queue | ✓ | ✓ | ✓ | ✓ |
| `core.guestProfiles` | Profiles, companies/agencies, consent, duplicates, merge/unmerge | ✓ | ✓ | ✓ | ✓ |
| `core.reports` | Standard report catalog with definitions and drill-down | ✓ | ✓ | ✓ | ✓ |
| `distribution.channelManager` | Channel connections via hub, ARI, revision log, distribution health | ✓ | ✓ | ✓ | ✓ |
| `distribution.bookingEngine` | Direct booking engine, Google free booking links (when built) | ✓ | ✓ | ✓ | ✓ |
| `comms.inbox` | Unified inbox, templates, translation | ✓ | ✓ | ✓ | ✓ |
| `comms.automation` | Automation engine (triggers, conditions, waiting/expired, run history) | ✓ Δ | ✓ | ✓ | ✓ |
| `finance.receivables` | Receivables accounts (agency/company invoicing), payments allocation, aging | ✓ Δ | ✓ | ✓ | ✓ |
| `api.public` | Public REST API, OAuth clients, outbound webhooks (rate-limited per edition) | ✓ Δ | ✓ | ✓ | ✓ |

### 4.2 Specialist capabilities

| Key | Capability | Ess | Pro | Resort | Ent |
|---|---|---|---|---|---|
| `inventory.overbooking` | Authorized overbooking allowances | — | ✓ | ✓ | ✓ |
| `rates.packages` | Packages with monetary/quantity allowances, breakage, package P&L | — | ✓ | ✓ | ✓ |
| `finance.creditControl` | Enforced credit limits, dunning schedules, periodic statements | — | ✓ | ✓ | ✓ |
| `owners.accounting` | Owner shares and statements (L) | — | ＋ Δ | ＋ Δ | ✓ |
| `groups.blocks` | Group blocks, grids, cut-off, rooming lists, attrition | — | ✓ | ✓ | ✓ |
| `groups.allotments` | Agency/tour-operator allotments with release days | — | ✓ | ✓ | ✓ |
| `groups.salesPipeline` | Inquiry → proposal → contract pipeline | — | ✓ | ✓ | ✓ |
| `groups.events` | Function space, events, event orders, weather alternates | — | ✓ Δ | ✓ | ✓ |
| `integration.pos` | POS charge intake (guest lookup, posting, balancing) | — | ✓ | ✓ | ✓ |
| `resort.outlets` | Resort outlet posting app (no-POS outlets, entitlement-aware) | — | — | ✓ | ✓ |
| `resort.mealPlans` | Meal-plan entitlement consumption at outlets | — | — | ✓ | ✓ |
| `resort.transfers` | Transfers, manifests, disruptions | ＋ | ＋ | ✓ | ✓ |
| `resort.activities` | Activities, spa, dive, excursions with resources and waivers | ＋ | ＋ | ✓ | ✓ |
| `resort.itinerary` | Unified guest itinerary (implied by transfers or activities add-on) | ＋ | ＋ | ✓ | ✓ |
| `resort.weatherDisruptions` | Bulk weather disruption handling | — | — | ✓ | ✓ |
| `operations.assets` | Asset register and preventive maintenance | — | ✓ | ✓ | ✓ |
| `analytics.customReports` | Custom and scheduled reports | — | ✓ | ✓ | ✓ |
| `analytics.warehouseSync` | Nightly export to customer data platform | — | ＋ | ＋ | ✓ |
| `api.eventStream` | Durable event stream with 7-day replay (L) | — | ＋ | ＋ | ✓ |
| `portfolio.crossPropertyProfiles` | Guest profile sharing across the organization's properties (Q46) | n/a (1 property) | ✓ Δ | ✓ Δ | ✓ |
| `portfolio.policies` | Brands/regions, policy locks, scheduled and staged policy rollouts | — | — | — | ✓ |
| `portfolio.consolidatedReporting` | Consolidated cross-property reporting with FX policy | — | — | — | ✓ |
| `portfolio.centralReservations` | Book/move/relocate across properties from one screen | — | — | — | ✓ |
| `identity.sso` | SAML/OIDC single sign-on | — | — | — | ✓ |
| `identity.scim` | SCIM provisioning (L) | — | — | — | ✓ |
| `ai.assistant` | Assistant: cited answers, summaries, drafts, proposals — metered by `usage.aiCredits` | ＋ | ＋ | ＋ Δ | ＋ Δ |
| `payments.embedded` | Portico-integrated payment account where available (separate payment agreement; Q2) | ＋ | ＋ | ＋ | ＋ |
| `distribution.gds` | GDS via CRS partner (L) | — | — | — | ＋ |
| `distribution.aggregatedChannels` | Single-contract aggregated channel distribution (L) | ＋ | ＋ | ＋ | ＋ |

Overlap note: `groups.events` and the sales pipeline are SHOULD-standalone under Connect (groups spec §14).

### 4.3 Limits

| Key | Meaning | Ess | Pro | Resort | Ent |
|---|---|---|---|---|---|
| `limits.properties` | Properties in status `pilot` or `active` | 1 | 3 | 5 | contract |
| `limits.units` | Active units across those properties | 40 | 300 | 1,000 | contract |
| `limits.users` | Staff memberships | **recommend unlimited** (implemented: 15 / 150 / 600 / ∞) Δ | | | |
| `limits.apiRequestsPerMinute` | Sustained API rate per organization (burst ×2) | 120 | 600 | 600 | 3,000 |
| `limits.environments.training` | Training environments | 1 | 1 | 1 | 3 |
| `limits.environments.sandbox` | Integrator sandbox organizations | — | 1 | 1 | 3 |

Trial environments are not limited by edition: every evaluating hotel gets one trial per property (adoption brief §3).
Data history is never limited.

### 4.4 Usage meters (metered, capped, visible — Q45)

| Key | Counts | Default cap |
|---|---|---|
| `usage.messages` | Paid outbound guest messages (SMS, WhatsApp conversations), per channel | 0 until an admin sets a cap |
| `usage.aiCredits` | AI inference units | 0 until an admin enables AI and sets a cap |

Channel-hub per-property fees (readiness §5 baseline) are pass-through line items, not meters.

## 5. Connect plan and module packs (proposed)

For hotels that keep their PMS (adoption paths "connect alongside" and "replace selected capabilities"). The Connect
plan contains no core PMS keys; it is assembled from **packs** — bundles of the keys above — each of which states its
dependencies before purchase (spec §14 of each module):

| Pack | Keys granted | Requires (connector workflows) |
|---|---|---|
| Housekeeping & Maintenance | `core.housekeeping`, `core.maintenance`, `operations.assets` | PMS `reservations: read`; `roomStatus: update` recommended |
| Guest Communications | `comms.inbox`, `comms.automation` | PMS `reservations: read`, `guestProfiles: read` |
| Reporting | `core.reports`, `analytics.customReports` | PMS `reservations: read`; journals/folio workflows for revenue reports |
| Experiences | `resort.transfers`, `resort.activities`, `resort.itinerary` | PMS `reservations: read`; `posCharges: create` to bill to the PMS folio |
| Payments | `core.payments` | PMS `reservations: read`; `payments: create` to post to the PMS folio |
| Sales & Events | `groups.salesPipeline`, `groups.events` | none for events; blocks need full PMS |

A Connect organization can move to a full edition without migration of the module data it already has.

## 6. Property profiles

Profile values (implemented in `modules/platform/src/contracts.ts`): `guesthouse`, `boutique_hotel`, `hotel`
(full-service hotel), `resort`, `serviced_apartments`, `hostel`. Profiles set **defaults**; any default can be
changed per property and is then labelled a local override.

### 6.1 What each profile turns on or hides by default

| Area | guesthouse | boutique_hotel | hotel | resort | serviced_apartments | hostel |
|---|---|---|---|---|---|---|
| Unit noun | Room | Room | Room | Villa | Apartment | Bed / Room |
| Suggested edition | Essentials | Essentials / Professional | Professional | Resort | Professional | Essentials |
| Home workspace | Owner (all-in-one) | Front desk | Front desk / role | Role workspaces | Front desk | Front desk |
| Timeline density | Comfortable | Default | Compact | Compact | Default (months zoom) | Compact (beds) |
| Composite units / beds | hidden | hidden | shown | shown (multi-bedroom villas) | shown | **beds + private dorms on** |
| Cashier sessions | optional (one drawer) | on | on | on | on | on |
| Day Close mode | automatic, surface blockers only | scheduled + review | scheduled + review | scheduled + review | automatic | automatic |
| Check-in required condition | clean | inspected | inspected | inspected | clean | clean |
| Inspection after clean | off | VIP only | all | all | sampled 20% | off |
| Stayover cleaning | on request | daily | daily | daily + turndown | weekly | daily (dorm common areas) |
| Turndown | hidden | optional | on | on | hidden | hidden |
| Billing rules / split folios | simple split shown, rules hidden | shown | shown | shown | shown (monthly cycles) | hidden |
| Receivables (agencies/companies) | shown (DMC invoicing) | shown | shown | shown | shown (corporate leases) | hidden |
| Groups & blocks | hidden | hidden | shown if entitled | shown if entitled | hidden | shown if entitled (tour groups) |
| Events / function space | hidden | hidden | shown if entitled | shown if entitled (weddings) | hidden | hidden |
| Packages & allowances | meal plans only | shown if entitled | shown if entitled | shown | hidden | hidden |
| Transfers / activities | shown if add-on (speedboat, excursions) | shown if add-on | hidden | shown | hidden | shown if add-on (tours) |
| Outlets / meal-plan consumption | hidden | hidden | POS intake if entitled | shown | hidden | hidden |
| Authorized overbooking | hidden | hidden | shown if entitled | shown if entitled | hidden | hidden |
| Payment schedule template | 30% deposit + balance at arrival | card guarantee | card guarantee | deposit schedule per rate | monthly in advance | pay at booking |
| Long-stay billing cycles | hidden | hidden | hidden | hidden | **on** | hidden |
| Departments template | Owner, Housekeeping | FO, HK, Maintenance | FO, Res, HK, Eng, F&B, Finance, Sales | + Guest Relations, Recreation, Transport, Marine, Spa | FO, HK, Maintenance, Finance | FO, HK |
| Staff app roles | owner does all | attendant, supervisor | attendant, supervisor, inspector | + buggy/transport, recreation | attendant | attendant |

### 6.2 Profile change

Changing profile shows a preview of defaults and visibility that would change and keeps all data and local
overrides; revealed features stay revealed (PLT-R12).

## 7. Reconciliation with the implemented `plans.ts`

The foundation implemented provisional plans before this document. Recommended changes (each is a configuration
edit; no data migration because no live customers exist):

| Change | Reason |
|---|---|
| Add `comms.automation` to Essentials | Automation is SMB table stakes; owners who do everything benefit most (research 03 §6.2, §14 item 9). |
| Add `finance.receivables` to Essentials | Maldivian guesthouses invoice DMCs/tour operators and receive bank transfers; basic AR is not enterprise depth. Gate depth with new `finance.creditControl`. |
| Add `api.public` to Essentials (rate-limited) | Openness and adoption are core (adoption brief §13; research 02 §8 item 7); limit by `limits.apiRequestsPerMinute`. |
| Add `groups.events` to Professional | Full-service hotels sell meetings and events. |
| Add `portfolio.crossPropertyProfiles` to Professional and Resort | Multi-property editions need guest recognition across their properties (Q46 default governs sharing). |
| Move `ai.assistant` from included (Resort/Enterprise) to metered add-on in every edition | Inference cost is usage-driven (readiness §14, Q45); keeps AI optional and capped. |
| Make `owners.accounting` an add-on for Professional and Resort | Serviced apartments and villa ownership schemes exist below Enterprise. |
| Remove `limits.users` (or set null) | Per-user limits encourage shared logins and break attribution (IDN-R04); owner decision under Q3. |
| Add new keys: `inventory.overbooking`, `rates.packages` meaning clarified, `finance.creditControl`, `groups.allotments`, `groups.salesPipeline`, `resort.itinerary`, `resort.weatherDisruptions`, `operations.assets`, `analytics.customReports`, `analytics.warehouseSync`, `api.eventStream`, `portfolio.centralReservations`, `identity.scim`, `payments.embedded`, `distribution.gds`, `distribution.aggregatedChannels`, `limits.apiRequestsPerMinute`, `limits.environments.*`, `usage.messages`, `usage.aiCredits` | Referenced by module specs. |
| Add add-on support (organization- and property-scoped grants) and a `connect` plan with packs | PLT-R20/R22; adoption paths. |
| Clarify `limits.properties` counts `pilot` + `active`; `limits.units` counts active units across them | PLT-R10. |

## 8. Enforcement rules (for engineers)

- Check entitlements in the service layer for every gated command and query; UI hiding is not enforcement.
- `EntitlementError` messages name the feature in plain language and who can enable it; never "upgrade now" dark
  patterns inside operational workflows (a front-desk agent mid-check-in is not the buyer).
- Removing an entitlement switches its data to read-only (PLT-R23); scheduled operational items created under it
  (future transfers, events) stay visible with a banner and remain operable until they complete or are cancelled.
- Limits are checked at activation (`pilot`/`active` property, unit activation), never on day-to-day operation.
- Every key is stable; renaming requires an alias period.
