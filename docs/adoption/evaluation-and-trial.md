# Evaluation and trial experience

> Deliverable 4 (adoption brief §3–§4; operational-readiness brief §16, §21). Status date: 2026-11-07.
> Builds on the implemented environment policy (`packages/kernel/src/environment.ts`), organization
> environments and property status (`modules/platform/migrations/0001_platform.sql`).

## 1. The five stages

| Stage | Environment (`tenants.environment`) | Property status | Data | Real systems touched | Exit to next stage needs |
|---|---|---|---|---|---|
| 1. Demonstration | `demo` (shared sample organizations, one copy per visitor) | n/a | Maldives sample data (§3) | None | Visitor chooses to start a trial |
| 2. Isolated trial | `trial` (a separate organization; `live_tenant_id` set if a live organization exists) | `setup` | Authorized **copy** of the hotel's data, imported from export files | None | Hotel wants live reading, or a pilot |
| 3. Read-only connection (optional) | `trial` | `setup` | Copy + data read through an approved read-only connection | The hotel's systems are **read** only | Hotel requests a pilot |
| 4. Controlled pilot | `live` | `pilot` | Production data for the pilot scope | Only the effects in the approved pilot scope | Pilot success criteria met and production activation approved |
| 5. Production activation | `live` | `active` | Production data | Effects in the approved production scope | — |

`training` (staff practice with synthetic or copied configuration) and `sandbox` (partner and integration
testing against provider sandboxes) are supporting environments, not evaluation stages.

## 2. Labeling (always visible)

- **Environment banner** on every screen of a non-live organization: text first, color second (accessible, not
  color-only). Examples: "DEMO — sample hotel, nothing here is real", "TRIAL — copy of Azure Isles data taken
  2026-11-03 14:20. Messages, payments and channel updates are simulated."
- **Pilot banner** in `live` for a `pilot` property: "PILOT — limited scope. Guest messages: on. Payments: off."
  The banner links to the approved pilot scope.
- **Provenance badge** on data (`live`, `simulated`, `copied`, `delayed`, `incomplete`, `external`) per CLAUDE.md
  rule 16. `copied` shows the copy timestamp; `external` shows the system and last-sync time; `delayed` shows age.
- **Result labels** for effects: an action routed to a simulator says "Simulated: no message was sent"; to a
  provider sandbox, "Sandbox: test card, no money moved". A simulated result never uses the words *paid*,
  *sent*, *published* or *confirmed* without the qualifier.
- Exported files from non-live organizations carry the environment in the file name and in a header row
  (e.g. `TRIAL-azure-isles-arrivals-2026-11-07.csv`), so a trial report cannot be mistaken for a live one.

## 3. Stage 1 — Demonstration

**Goal:** a hotelier understands Portico's value for their property type within minutes, without a sales call
and at near-zero cost (operational-readiness brief §16).

- **Sample organizations (D8):**
  - *Coral Thila Guesthouse* — 12 rooms on an inhabited island, USD and MVR, TGST and Green Tax rules
    (sourced per research 04, [KPMG](https://kpmg.com/us/en/taxnewsflash/news/2024/11/tnf-maldives-amendments-gst-tourism-act-airport-fees-ratified.html), verified 2026-11-07),
    OTA bookings via a simulated hub, WhatsApp-style simulated inbox.
  - *Azure Isles Resort* — 120 villas, seaplane transfers, meal plans, spa and dive centre, a simulated POS and
    a simulated door-lock system.
  - *Lagoon Collection* — 3 properties, one shown in Path A ("connected to a simulated OPERA Cloud") to
    demonstrate connected mode, with housekeeping forward and group reporting.
  - All names are fictional; all guests are synthetic.
- **What the user sees:** role-based guided tours (front desk, housekeeping, finance, manager), the 20 proof
  scenarios as replayable stories (brief §17), the integration console with simulated healthy, delayed and
  failing connections, and a migration preview using a sample OPERA-style export.
- **Mechanics:** each visitor gets a fresh copy of the sample organization (reset after 24 hours of inactivity);
  sample dates roll forward daily so arrivals are always "today". Simulated connectors use the same connector
  framework as real ones (so the demo exercises real code paths), flagged `simulated`.
- **Cost guard:** demo AI is `simulate` (canned, labeled answers); no paid service is called.

## 4. Stage 2 — Isolated trial with an authorized copy

### 4.1 Authorization before any hotel data is copied

1. A person with authority for the hotel accepts the trial terms and the data processing terms
   (templates owned by the readiness agent; professional review required — `docs/readiness/` contracts register).
2. They confirm they may export and share the data under their current vendor contract (Portico does not assume
   this; the source-system feasibility checklist in [migration-acceptance-criteria.md](migration-acceptance-criteria.md) §2 applies).
3. They choose the scope: properties, date range (default: future reservations + 12 months of history), and data
   classes.

### 4.2 What is copied, and what never is

| Data class | Default in trial | Notes |
|---|---|---|
| Property structure, unit types, units, rate plans, tax and fee setup, charge codes | Copied | Needed for meaningful evaluation |
| Future and recent reservations, stays, group blocks | Copied | Labeled `copied` |
| Guest names | Copied | Needed to recognise records |
| Guest email and phone | **Masked by default** (e.g. `g***@***.com`) | The hotel may unmask; messages remain simulated either way |
| Identity documents and images | **Never copied** in a trial | Not needed for evaluation |
| Card data, payment tokens | **Never copied** | Tokens are not portable anyway; card numbers never enter Portico |
| Open folios, deposits, AR balances | Copied as balances with references | For finance reconciliation questions |
| Staff user accounts | Not copied; trial users are invited | Each trial user has MFA and a trial-only membership |

### 4.3 What can never happen in a trial (enforced by the effect policy)

Policy values below are from `packages/kernel/src/environment.ts` (trial column).

| Effect | Trial mode | What the user experiences |
|---|---|---|
| `payment.charge` | simulate | Payments go to the payment simulator; results labeled simulated |
| `message.guest` | simulate | Messages land in a **simulated outbox** inside the trial; nothing is delivered |
| `message.staff` | simulate | Same, for notifications to staff outside the app |
| `channel.publish` | simulate | Availability and rate changes go to the channel simulator |
| `government.submit` | blocked | Action unavailable, with explanation |
| `ai.inference` | simulate | Labeled canned answers (owner question Q63 on real AI in trials) |
| `credentials.production` | blocked | No production API keys or webhooks can be issued |
| `access.key` | simulate | Key requests go to the lock simulator |
| `integration.read` | live | Only through an approved read-only connection (§5, G-03) |
| `integration.write` | blocked | No write to any hotel system, ever, from a trial organization |

**Background jobs:** every scheduled job and automation runs inside its organization's context and therefore
passes through the same policy. In addition, the worker refuses to start any adapter for a trial, demo or
training organization that is not a simulator, sandbox or approved read connector (defense in depth). A test
fixture with a "canary" real-looking guest contact proves that no trial automation reaches a real provider
(acceptance test EV-03).

## 5. Stage 3 — Optional read-only connection

- Offered only for providers whose read workflows are at R4 or higher ([integration-coverage-matrix.md](integration-coverage-matrix.md)).
- Goes through the normal setup journey ([connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) §2)
  with only read workflows selectable.
- **Authorization is still required.** The hotel authorizes at the vendor (OAuth consent, API token or vendor
  activation). Some vendors require partner approval before any hotel can authorize us (e.g. OHIP partner access
  for OPERA Cloud; Mews webhooks registered through Mews support — research 01 §2.4, research 02 §2.4, verified
  2026-11-07 via search extracts). Portico shows these vendor-side steps and their status; it does not assume a
  vendor permits read-only access.
- **Residual risk is shown.** If the vendor cannot issue a read-only credential, the connection page says
  "This credential would allow changes in <system>. Portico blocks all writes from trials." (G-03).
- **Incomplete data is shown.** If the vendor does not expose something (e.g. folio detail), reports that need it
  are labeled `incomplete` with the missing input named.
- **Data protection:** read data inherits the masking defaults of §4.2; the connection's credential is stored in
  the secret store, never in the database or logs; disconnecting deletes the credential reference and stops all
  reads within one minute (target).

## 6. Stages 4 and 5 — Controlled pilot and production activation

### 6.1 Pilot scope (approved document, stored and versioned)

| Element | Example (RS-3, property 1 of 3) |
|---|---|
| Properties | Lagoon Collection — Property A only |
| Domains and authority | `roomStatus` external · forward; `guestCommunications` Portico for pre-arrival + in-stay |
| Workflows enabled | OPERA Cloud: read stays, read room status, forward room status; WhatsApp + email outbound |
| Effects allowed | `integration.read`, `integration.write` (room status only), `message.guest` (pre-arrival template set A only) |
| Effects not allowed | `payment.charge`, `channel.publish`, `access.key`, `government.submit` |
| Users | Housekeeping team (14), front office managers (3) |
| Guest scope | Guests with arrival in the window who have a contact channel and no opt-out |
| Window | 4 weeks, with weekly review |
| Success criteria | From [success-metrics.md](success-metrics.md): e.g. M-09 room-status p95 ≤ 30 s, zero lost updates, housekeeping training ≤ 20 min/person |
| Rollback | Disable workflows; authority stays with OPERA (nothing to migrate back) |
| Support | Named contacts, hours and escalation (operational-readiness brief §17) |
| Approvals | Hotel general manager + Monoclay launch-gate owner (operational-readiness brief §21) |

**Enforcement (G-04):** in `live`, an effect is performed only if the environment policy allows it **and** the
property's current approved scope includes that effect for that connection and workflow. Everything else
behaves as `blocked`, with a message naming the scope document. A scope change is a new version with approval.

### 6.2 Production activation

- A separate, explicit decision after the pilot, recorded with evidence (pilot metrics, open exceptions, support
  readiness) and a named decision-maker (operational-readiness brief §21).
- Changes property status `pilot → active` and installs the production scope. One property's activation never
  changes another property's status (rollout requirement RR-10).

## 7. Showing value with the hotel's own operation (brief §4)

Each question is answered with **evidence the hotel can inspect**. Where a comparison with the hotel's current
system is possible, differences are listed as discrepancies for investigation, never resolved silently in
Portico's favor.

| Hotel question | Stage | How it is answered | Evidence produced | Discrepancy handling |
|---|---|---|---|---|
| Can reception handle arrivals and room changes more easily? | 2–3 | Moderated task sessions with the hotel's own reception staff on the hotel's copied arrivals: find reservation, assign room, room move, extension, check-out. Same tasks timed in the current system (observed, not self-reported) | Task comparison report: time, steps, errors, help requests per task, per user ([success-metrics.md](success-metrics.md) M-08 method) | Tasks Portico cannot complete with the copied data are listed as gaps, not skipped |
| Can housekeeping see and complete work faster? | 3–4 | Housekeeping board built from read-only stays; in a pilot, forward mode. Measure time from departure to "clean confirmed in PMS" and supervisor time to build assignments | Before/after timings; list of status updates and their confirmation times | Updates rejected by the PMS listed with reasons |
| Can finance reconcile deposits, charges and balances? | 2–3 | Portico recomputes deposit, folio and AR balances from the copied data and compares them with the hotel's own reports (trial balance, deposit ledger, AR aging) | Reconciliation report per account/folio to the minor unit | Every difference is an exception with records on both sides; Portico never adjusts the source figures |
| Can management understand performance across departments and properties? | 2–3 | SM-05 reports over copied or connected data, each metric with definition, period, currency treatment and source (brief §13) | Side-by-side with the hotel's existing reports for the same period | Metric differences explained by definition or listed as unexplained |
| Can existing channels and applications work with Portico? | 2 | Inventory of the hotel's systems against the coverage matrix: workflow by workflow, with readiness level | Compatibility report: supported / partial / unsupported / unverified, with consequences | Unsupported workflows are named with the manual alternative |
| What information or functionality would be lost in migration? | 2 | Source feasibility assessment and a trial import | Migration loss report: records not importable, history limits, non-portable tokens, features with no Portico equivalent | Each item has a decision owner (keep in archive / re-create / accept loss) |
| What would adoption cost, and what work remains? | 2 | Adoption plan generated from the chosen path | Costs split into Portico subscription (per Q3/Q60 — placeholder until priced), third-party fees (from `docs/readiness/provider-costs.md`; "quote required" where unpublished), hotel-side vendor fees, and a task list with owners and estimates | Unknown costs shown as unknown, never as zero (operational-readiness brief §3) |

### 7.1 Validating configuration changes without touching live systems

- **Proposed configuration** can be prepared in the trial organization and previewed against copied data: rate
  and restriction changes (effect on future stays and quotes), tax and fee rule changes (future vs historical
  effect, brief §5), billing rules (which folio each posting would go to), and mappings (validated against the
  channel hub's staging or the vendor sandbox where available).
- In `live`, consequential changes keep their normal previews (change preview, policy change preview —
  `previewPolicyChange` already exists in `modules/platform/src/service.ts`).

## 8. Trial reset, export, delete and retention

| Action | Who | Effect | Target timing |
|---|---|---|---|
| **Reset** | Trial administrator | Restores the trial to a chosen checkpoint (empty configuration, after-import baseline, or a saved checkpoint). Audit history of the trial is kept | Completes in ≤ 5 min for RS-2 size data (target) |
| **Export** | Trial administrator | Download configuration (machine-readable) and all trial data (CSV), labeled TRIAL | Available at any time, ≤ 15 min (target) |
| **Delete** | Trial administrator or Monoclay on expiry | Deletes the trial organization and all copied data; read-only connection credentials revoked first | Primary data deleted within 7 days of request; backup copies age out within the backup retention period (stated in the processing terms; Q63) |
| **Expiry** | System | A trial with no activity for 60 days is scheduled for deletion; warnings at 14 and 3 days; one extension by the hotel | Default 60 days (Q63 confirms) |
| **Retention exceptions** | Monoclay | Minimal audit records of access to the trial (who, when, what action — no guest data) are retained for the security retention period | Per security policy (`docs/readiness/` security assessment) |

Retention obligations that apply to the hotel's own records do not apply to a trial copy, because the trial
is not a system of record; this assumption needs professional confirmation (Q63).

## 9. What carries forward into production

Production is a **different organization** (`live`). Nothing moves automatically. A **promotion package** is
generated from the trial, reviewed as a diff, and applied to the live organization while its properties are in
`setup`.

| Item | Carried forward? | Validation before use |
|---|---|---|
| Property structure, unit types, units, features, composite units | Yes | Re-checked against the source system at final capture |
| Rate plans, restrictions, packages | Yes | Effective dates reviewed; agreed prices on migrated stays come from the source, never re-priced |
| Tax and fee rules | Yes, as configuration with source and verification date | Re-verified against current rules (CLAUDE.md rule 13); finance sign-off |
| Charge codes, billing rules, ledger accounts | Yes | Finance sign-off (financially significant) |
| Mappings to external systems | Yes, as **proposals** | Re-run validation against the production connection; any mapping marked financially significant needs fresh review |
| Roles, permissions, saved views, report definitions | Yes | Role assignments re-approved for real users |
| Message templates and automations | Templates yes; automations **disabled** | Each automation enabled individually with the sender register check (CR-9) |
| Users | No — invitations only | Real users enrolled with MFA |
| Reservations, guests, folios, deposits copied in trial | **Never** | Production data comes from a fresh import with final change capture ([migration-acceptance-criteria.md](migration-acceptance-criteria.md)) |
| Simulated transactions, simulated messages | **Never** | — |
| Trial connection credentials | **Never** (revoked) | Production connections are authorized fresh with production scopes |

## 10. Acceptance tests

| # | Test |
|---|---|
| EV-01 | In a `demo` organization, every action in the 20 proof scenarios completes with simulated effects and visible labels; no network call leaves the simulator layer (verified with a network-deny test harness). |
| EV-02 | In a `trial` organization, each of the 10 effects behaves as in §4.3; `integration.write` attempts produce `effect_blocked_in_environment` and an audit record. |
| EV-03 | A trial automation addressed to a canary contact results only in a simulated-outbox entry; the email/SMS/WhatsApp provider adapters record zero calls. |
| EV-04 | A trial read connection whose approved scope contains a write workflow cannot be activated (G-03). |
| EV-05 | A `live` property in `pilot` attempts an effect outside its scope: the effect is refused with the scope reference; the attempt is audited. |
| EV-06 | Activating production for property A leaves properties B and C in their current status and scope. |
| EV-07 | A report exported from a trial carries "TRIAL" in the file name and header. |
| EV-08 | Trial deletion revokes connection credentials before deleting data and produces a deletion record listing data classes deleted. |
| EV-09 | A promotion package never contains reservations, guest profiles, folios or credentials (schema-level test). |
| EV-10 | Finance reconciliation in a trial lists every difference with both source and Portico records; the trial cannot "accept" a difference by editing source figures. |
