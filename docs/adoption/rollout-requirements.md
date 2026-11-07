# Rollout requirements: independent-property simplicity, enterprise control, on-site systems

> Deliverable 8 (adoption brief §11–§12; product brief §2, §13; operational-readiness brief §9, §13, §17).
> Status date: 2026-11-07. Requirements are numbered **RR-nn** and are testable. Implemented foundations
> referenced: organization/brand/region/legal-entity/property structure and policies with local overrides and
> preview (`modules/platform`), scoped role assignments (`modules/identity`).

## 1. One product, two experiences

Complexity is enabled, not imposed (product brief §3, CLAUDE.md §10). The organization's edition and
structure decide what appears:

| Concern | Independent property (e.g. RS-1) | Group / enterprise (e.g. RS-3, S4) |
|---|---|---|
| Structure | One organization, one legal entity, one property; brands and regions hidden | Organization → brands → regions → legal entities → properties |
| Integration setup | Guided, one connection at a time, recommended defaults | Templates, bulk setup, central policies, approvals |
| Approvals | One-person setup with safeguards (RR-06) | Separation of duties (RR-05) |
| Health | Property view only | Portfolio view with filters and audit |
| Costs | One bill line per connection | Allocation by property, legal entity and brand (RR-09) |

## 2. Independent-property requirements

- **RR-01 Property-type templates.** Setup starts from a template per property profile (`guesthouse`, `hotel`,
  `resort`, `serviced_apartments`, `hostel`, `boutique_hotel`) with defaults for departments, charge codes,
  housekeeping rules and the market's tax pack (Maldives: TGST, Green Tax and service charge as dated rules,
  verified per CLAUDE.md rule 13).
- **RR-02 Guided setup with a finish line.** A checklist shows each remaining step, who must do it and the
  estimated time; "ready for go-live" is a computed state, not a promise.
- **RR-03 Defaults that are safe.** New connections start with read-only workflows; money-moving and
  inventory-publishing workflows require an explicit choice.
- **RR-04 No enterprise noise.** A single-property organization never sees brand, region, rollout-wave,
  cost-allocation or central-policy screens unless it enables them.
- **RR-06 Single-approver safeguard.** Where an organization has fewer than two users holding an approval
  permission, consequential actions that normally need two people (RR-05) require re-authentication with MFA,
  a preview acknowledgement, a 10-minute delay before taking effect (cancellable), and a notification to the
  organization's registered owner contact. The audit record states "single approver".

## 3. Enterprise requirements

- **RR-05 Separation of duties for integrations.**

  | Action | Who may request | Who must approve (different person) |
  |---|---|---|
  | Create or edit a connection draft | Property or corporate integration administrator | — |
  | Authorize credentials at the vendor | Holder of the vendor account (hotel IT or vendor admin) | — |
  | Confirm financially significant mappings | Integration administrator proposes | Finance role |
  | Activate read-only workflows | Integration administrator | Property manager |
  | Activate workflows that move money, publish inventory or contact guests | Integration administrator | Property manager **and** finance or revenue role (by workflow) |
  | Change data authority for `charges`, `payments`, `accounting`, `availability` | Property manager | Corporate or finance approver (CR-10) |
  | Production activation of a property | Property GM | Monoclay launch-gate owner (operational-readiness brief §21) |
  | Central integration policy change | Corporate integration owner | Second corporate administrator, after preview |
  | Local exception to a central policy | Property manager | Corporate integration owner |

- **RR-07 Configuration templates.** Reusable, versioned templates for: property setup, connection setup
  (provider, workflows, mapping rules such as "group charge-code map v3"), automations and message templates,
  roles. Applying a template shows a per-property diff; properties record which template version they use and
  show drift from it.
- **RR-08 Bulk setup and validation.** Properties, units, users, mappings and connections can be created in
  bulk (file or API). Bulk operations run validation first and report per property: will apply / will apply
  with warnings / blocked (with reasons). Nothing is partially applied to a property: each property's bulk
  change is all-or-nothing.
- **RR-09 Cost allocation.** Every connection and usage record has a cost owner (property, legal entity or
  organization). Shared fixed costs (e.g. a channel hub's platform fee) are allocated by a chosen rule (equal,
  per active property, per unit). Reports show per property and legal entity: Monoclay subscription items,
  pass-through provider charges, and hotel-paid vendor fees as separate lines. None of this touches guest money
  (CLAUDE.md rule 14).
- **RR-10 One property's success is not group readiness.** Readiness, pilot scope and production activation are
  per property. A successful pilot at one property does not change any other property's status. Each further
  property needs its own validation run, mapping review, staff training records and sign-off; the group
  dashboard shows each property's readiness separately.
- **RR-11 Pilot properties and staged rollout groups (waves).** Properties are assigned to waves (Wave 0 =
  pilot; then waves of similar profile). A wave starts only when the previous wave's exit criteria (from
  [success-metrics.md](success-metrics.md)) are met or explicitly waived by the named decision-maker with reason.
- **RR-12 Controlled configuration changes.** Portfolio-wide changes (policies, templates, connection settings)
  use the existing policy preview (`previewPolicyChange`) and can be released in rings: pilot properties first,
  then the rest after a hold period. A change can be stopped and reverted between rings without affecting
  properties not yet reached.
- **RR-13 Central integration policies with local exceptions.** Policies (stored as `platform.policies`) can
  define: approved providers per category, required workflows (e.g. "all properties send daily journals to the
  group ERP"), forbidden workflows (e.g. "no guest data to unapproved CRMs"), credential rotation intervals,
  data-sharing scope. A property deviation is a **local override**, always labeled, with a reason, an approver
  and an expiry date; expired exceptions raise a routine exception to the corporate owner.
- **RR-14 Enterprise identity and access.** SSO (SAML 2.0 / OIDC) and SCIM provisioning (W-ID-01/02,
  P1); integration permissions follow the same scoped roles; partner apps never inherit a user's
  organization-wide rights ([ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md)).
- **RR-15 Region-specific data and compliance.** Each property declares its market; market packs (tax rules,
  fiscal workflows, guest registration, retention) come from `docs/readiness/market-matrix.md`. Data residency
  follows the hosting decision (Q4) and, for enterprise customers, the regional cell their contract requires.
- **RR-16 Portfolio-wide health and audit.** One view of all connections across properties, with filters, and an
  audit history of every connection, mapping, authority and policy change (who, when, why, before/after).

## 4. Rolling out a group (procedure)

1. **Discovery per property:** systems in use, versions, contracts, local equipment (feeds the coverage matrix).
2. **Template design** at group level (RR-07), reviewed by group finance and operations.
3. **Wave 0 pilot property:** full setup journey, pilot scope, success metrics.
4. **Wave review:** metrics, exceptions, staff feedback; template corrections versioned.
5. **Subsequent waves:** bulk setup (RR-08) per wave; per-property validation and sign-off (RR-10).
6. **Steady state:** central policies enforced; exceptions tracked to expiry.

## 5. On-site systems and the local connector (brief §12)

The main product is cloud-only and needs no local PMS installation. Some equipment and legacy software cannot
talk to a cloud service; for those, a **Portico Local Connector** is required. Portico never promises an
installation-free experience for such equipment.

### 5.1 What needs a local connector

| System | Why | Example products (verify per hotel) |
|---|---|---|
| Door-lock servers and key encoders installed on site | Encoders sit on the hotel LAN; on-premise lock servers have no cloud endpoint | ASSA ABLOY Vingcard Visionline, Salto Space [Unconfirmed per product; market evidence of PMS integrations: research 02 §2.2] |
| On-premise POS servers | POS–PMS interfaces often run on the hotel network | Legacy MICROS/Simphony on-premise deployments [Unconfirmed] |
| OPERA 5.x and other on-premise PMS (for connected mode or extraction) | Database and interfaces are on the hotel's server | OPERA 5.x [Unconfirmed interface rights, Q61/Q62] |
| Telephony (PBX/call accounting), Wi-Fi/IPTV, energy management | Legacy serial or LAN protocols | P2 |
| Card terminals on a local network | Some acquirer terminals are semi-integrated over LAN | Depends on acquirer (Q2) |

Cloud-native lock, POS and PMS products connect directly and do **not** need the connector.

### 5.2 Supported environments (targets for the first release)

| Item | Requirement |
|---|---|
| Host | Dedicated small PC or virtual machine on the hotel LAN; Windows Server 2019+ / Windows 10/11 64-bit, or Linux x86-64 with a container runtime |
| Resources | 2 CPU cores, 4 GB RAM, 20 GB disk (target sizing; validated in testing) |
| Network | Outbound HTTPS (TLS 1.2+) to Portico only; **no inbound ports**; LAN access to the specific systems it connects; works through the hotel's proxy |
| Power | On a UPS together with the systems it serves (e.g. the lock server) |
| Legacy serial interfaces | Via a supported serial-to-IP converter |

### 5.3 Security

- Pairing with a one-time code from the integration console; then a per-device certificate; revocable at any
  time from the console.
- Signed updates only; the connector refuses unsigned or downgraded builds.
- Local queue encrypted at rest; holds only what is needed for pending exchanges; no card data ever.
- Least privilege on the local systems (e.g. a lock-system interface account limited to encoding).
- Every connector action is an exchange in the exchange log with the device identity.

### 5.4 Responsibilities

| Task | Monoclay | Hotel IT / owner | Equipment vendor |
|---|---|---|---|
| Provide, sign and update the connector software | **Responsible** | Informed | — |
| Provide and maintain the host machine, OS patches, network, power, physical security | Advises | **Responsible** | — |
| Install and pair | Remote guidance (or on-site partner, quote required) | **Responsible** (executes) | — |
| Interface licences and configuration on the vendor system | Documents requirements | Pays/holds licence | **Responsible** |
| Monitoring (heartbeat, queue depth, version) | **Responsible** (alerts in console) | Acts on alerts for host/network | — |
| Updates | **Responsible** (staged: 5% → 25% → 100% of connectors over at least 72 h, pausable) | Can defer within a window (max 14 days) | — |
| Incident response | Software faults | Host/network faults | Vendor system faults |

Support hours and escalation follow the support plan in `docs/readiness/` (not promised as 24/7 until staffed —
operational-readiness brief §17; Q62).

## 6. What keeps working when something fails

| Failure | What keeps working | What stops or degrades | What staff do |
|---|---|---|---|
| **Property internet down** | Lock encoding through the lock vendor's own workstation (if installed); POS standalone mode per POS vendor; Portico staff PWA continues offline for housekeeping updates (queued, labeled not synced); local connector queues exchanges | Portico web screens unavailable on site (cloud); channel bookings still arrive in Portico but staff cannot see them; payments via cloud links stop | Use the **continuity snapshot** (below) and the paper procedures from `docs/readiness/` support and recovery plan; reconcile when back online |
| **Local connector down** (host off, crash) | Everything cloud-based; keys can be encoded in the lock vendor's software | Key requests from Portico, on-premise POS postings | Console raises an urgent exception; front desk switches to manual key encoding; POS holds postings (if supported) or prints a posting list; postings are reconciled on recovery |
| **Portico unavailable** | Lock and POS systems in their standalone modes; staff PWA offline queue | All Portico functions | Continuity snapshot; manual procedures; Portico status page |
| **External vendor system down** (e.g. POS server) | Portico | That vendor's functions and its exchanges | Console shows impact; vendor's own continuity procedure |
| **Power failure** | Whatever is on UPS | Depends on site | Site procedure |

**Continuity snapshot (requirement):** a read-only, encrypted, access-controlled snapshot of today's and
tomorrow's arrivals, in-house guests with units, room status, departures, emergency contacts and open balances,
refreshed every 15 minutes (target) to a designated device on site (the local connector host where present, or
a staff device). It is labeled with its time and never presented as current; it contains no card data.

## 7. Acceptance tests

| # | Test |
|---|---|
| RO-01 | A single-property organization's settings never show brand, region, wave or cost-allocation screens. |
| RO-02 | In an organization with two approvers, the requester of a `charges` authority change cannot approve it. |
| RO-03 | In an organization with one approver, the same change requires MFA re-authentication and takes effect only after 10 minutes, with an owner notification. |
| RO-04 | A bulk setup for 10 properties where one has a blocking validation error applies to 9 and leaves the tenth untouched, with a per-property report. |
| RO-05 | Activating production for a pilot property leaves the other properties' status and scopes unchanged (RR-10). |
| RO-06 | A local exception past its expiry raises a routine exception to the corporate owner and remains labeled as an override. |
| RO-07 | A local connector with a revoked certificate cannot exchange anything; its queued items are reported, not lost. |
| RO-08 | With the connector offline, a key request from Portico shows "Encode in the lock system", and the stay records "key issued outside Portico" when staff confirm. |
| RO-09 | The continuity snapshot opens on the designated device with the network disconnected, shows its timestamp, and contains no card data. |
