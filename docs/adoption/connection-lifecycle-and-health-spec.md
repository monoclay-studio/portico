# Connection lifecycle, health and recovery specification

> Deliverable 6 (adoption brief §7–§9; operational-readiness brief §6, §19). Status date: 2026-11-07.
> This is the product specification for the `integration` module's connection features. The module's
> technical spec (`docs/specs/integration.md`, product/specs agent) must conform to it. Terms: **connection**
> (an authorized link between a Portico organization/property and one external product), **workflow** (a
> defined exchange from [integration-coverage-matrix.md](integration-coverage-matrix.md) §3), **exchange**
> (one message or record sent or received), **integration exception** (an exchange or workflow problem that
> needs a person), **discrepancy** (a detected mismatch in state between Portico and the other system).

## 1. Principles

1. Staff never need to read payloads or logs. Every problem is described in business terms (§10).
2. Nothing is "synced", "sent" or "confirmed" until the other system confirmed it.
3. Retries never duplicate business effects; reconnecting never blindly replays (§9).
4. Activation is scoped and approved; scope is enforced in code, not by convention.
5. Setup progress is never lost.

## 2. The setup journey

### 2.1 States

```
selecting → reviewing_compatibility → awaiting_authorization → mapping → resolving_issues
          → validating → previewing → awaiting_approval → active
(any state) → abandoned (after 90 days idle, recoverable for 30 more days)
active ⇄ paused;  active/paused → disconnecting → disconnected
active → suspended (system-initiated: credential problem, provider suspension, security)
```

A connection can go back to an earlier setup step (e.g. new room types appeared) without losing later work;
dependent steps are marked "needs re-check" rather than erased.

### 2.2 Step by step

| # | Step | What the user sees | What Portico automates | Vendor-side or hotel-side steps (shown explicitly) | Exit criteria |
|---|---|---|---|---|---|
| 1 | Select the existing system | Search by product name; product and version picker ("OPERA Cloud", "OPERA 5.6 on-premise") | Detects likely version from answers or a test call where possible | — | Product and version chosen |
| 2 | Review compatibility, permissions, prerequisites and charges | One page: workflows available (with capabilities, sync mode and readiness level), what will **not** work, prerequisites, permissions requested in plain English, charges and who pays | Builds the page from the coverage matrix; flags workflows below R4 as "not yet available" | Vendor approvals (e.g. OHIP partner access), hotel licences, local connector need | Hotel accepts the listed scope and costs, or stops here |
| 3 | Authorize access | The authorization method for that vendor (OAuth consent, token entry, vendor activation ticket, local connector pairing code) with a status tracker | Least-privilege scope request; credential stored in the secret store; test call | Steps only the vendor or hotel can perform, with expected owner | A verified credential with recorded scopes |
| 4 | Review suggested mappings | Mapping tables per entity kind with suggestions, confidence and reasons | Suggestions (§3) | — | Every required entity mapped or explicitly excluded |
| 5 | Resolve flagged issues | A list of blocking and non-blocking issues with owners | Groups similar issues; proposes fixes | E.g. "create rate code X in OPERA" | No blocking issue open |
| 6 | Run meaningful validation | Validation report (§4) | Runs checks | — | Validation passed (warnings acknowledged by a named person) |
| 7 | Preview expected behavior | Plain-English list of what will happen and what will not (§5) | Generated from enabled workflows and mappings | — | Preview accepted |
| 8 | Activate the approved scope | Scope summary and approval request (separation of duties, RR-05 in [rollout-requirements.md](rollout-requirements.md) §3) | Initial synchronization plan | — | Approved and activated (`active`) |
| 9 | Monitor connection health | Integration console (§6) | Health computation, alerts | — | Continuous |

### 2.3 Preserved progress

- Each step's results are saved as they are made; leaving and returning resumes at the same place.
- Steps can be assigned to different people (e.g. finance reviews charge-code mappings); each assignee sees
  their pending items.
- If authorization expires during setup, mappings and decisions are kept; only step 3 is redone.
- Reminders for setups idle more than 3 days (to the setup owner) and 14 days (to the property's manager).

## 3. Mapping suggestions

### 3.1 What is mapped

Properties, unit types, units, rate plans, restrictions semantics, packages/inclusions, outlets, charge codes
(vendor transaction codes), tax codes, ledger accounts and dimensions, payment methods, departments, market
segments and sources, currencies, room statuses, reservation statuses, and guest title/language code lists.

### 3.2 Suggestion and review rules

| Rule | Detail |
|---|---|
| Signals | Codes, normalized names, capacity/occupancy, counts per type, price levels, tax behavior on sample postings, usage frequency |
| Confidence | `high` (≥ 0.90), `medium` (0.60–0.89), `low` (< 0.60), always with the reasons shown ("Same code 'DLX'; same max occupancy 3; 24 units in both") |
| Ambiguous | Two candidates within 0.10 of each other, many-to-one or one-to-many mappings, or a status whose meaning differs (e.g. vendor has no "inspected") → **mandatory review** |
| Financially significant | Charge codes, tax codes, ledger accounts, outlets, payment methods, deposit treatment, package components → **mandatory review by a user with the finance permission, regardless of confidence** |
| Bulk accept | Allowed only for `high`-confidence, non-ambiguous, non-financial mappings; the user still sees the list |
| Unmapped values later | A new external value arriving after activation creates a mapping exception (§8); nothing is posted or counted against a guessed mapping |
| Measured | Suggestion accuracy is a tracked metric ([success-metrics.md](success-metrics.md) M-04) |

## 4. Validation runs

| Check type | Example | Pass rule |
|---|---|---|
| Structural | Every unit type that has future stays is mapped | 0 missing |
| Count | Units per type, future stays per night (next 30 days) equal between systems | Exact match, or each difference listed and accepted |
| Sample comparison | 20 random future stays (or all if fewer): dates, unit type, occupants, status, assigned unit | 100% match or explained |
| Financial (where charges are read or posted) | Recompute taxes for 20 sample postings with mapped tax codes | Totals equal to the minor unit |
| Round trip (forward workflows) | In the vendor sandbox, or on a hotel-designated test unit with explicit approval, send one status change and read it back | Acknowledged and visible within the freshness target |
| Timing | Measure read latency and event delivery for 15 minutes | Within targets in [success-metrics.md](success-metrics.md) M-09 or flagged |
| Permissions | Credential scopes are the minimum required; no extra write scope in a trial | Exact (G-03) |

Every validation run is stored with its checks and results; activation requires the latest run to have passed
after the last mapping change.

## 5. Behavior preview (example for RS-3)

> When this connection is active for **Lagoon Beach**:
> - Portico reads arrivals, departures and in-house stays from OPERA Cloud within about 1 minute of changes.
> - When a housekeeper marks a room **Clean** in Portico, OPERA Cloud receives **Clean** (usually within 30
>   seconds). Until OPERA confirms, Portico shows it as *waiting for OPERA*.
> - OPERA has an **Inspected** status; inspections in Portico will set it.
> - Portico will **not** change reservations, rates, availability, guest profiles or folios in OPERA.
> - Pre-arrival WhatsApp messages (template set A) will be sent by Portico. OPERA's confirmation letters
>   continue unchanged.
> - If OPERA is unreachable, housekeepers can keep working; updates are held and checked before sending.

## 6. Integration management area

### 6.1 Views

- **Property view** (property staff): connections for the property, their health, urgent problems first,
  and the systems-of-record panel.
- **Portfolio view** (corporate teams): all properties × connections, filters by provider, region, brand and
  health; portfolio-wide audit history (brief §11).

### 6.2 What each connection shows (brief §9)

| Item | Detail |
|---|---|
| Connected system and authorized scope | Product/version, properties, workflows with capabilities and sync mode, credential scopes, authority rows |
| Last successful exchange and current delay | Per workflow; delay vs freshness target |
| Failed or incomplete workflows | Counts and lists of held, failed, pending-verification exchanges |
| Mapping problems | Unmapped external values with first seen time and affected records |
| Credential expiry and vendor-required changes | Days to expiry; vendor notices with effective dates (e.g. API version sunsets) |
| Affected properties and operational impact | Plain English: "Arrivals for today may be missing up to 4 bookings" |
| Available recovery actions | Retry now, reconcile now, pause, rotate credential, re-map, open exception |
| Usage and associated charges | Calls/events/properties billed where the provider reports them (e.g. OHIP calls; hub properties), labeled estimate or provider-reported |
| Support ownership and escalation | Who supports which part (hotel IT, Monoclay, vendor), contacts, escalation times |

### 6.3 Health status

| Status | Rule (per workflow; the connection shows its worst workflow) |
|---|---|
| Healthy | Last success within freshness target; no urgent exceptions |
| Delayed | Last success older than target but within 3× target |
| Degraded | Errors on part of the traffic, or delay beyond 3× target for a non-authoritative workflow |
| Failing | No success beyond 3× target for a workflow on which a system-of-record domain depends, or circuit breaker open |
| Credential problem | Authentication/authorization failures |
| Paused | Paused by a person (with reason and who) |
| Unknown | No data yet (e.g. just activated) |

### 6.4 Urgent versus routine

An integration exception is **urgent** if any of:

1. It affects arrivals, departures or in-house guests within the next 24 hours (configurable per property).
2. Availability or prices published to channels may be wrong.
3. Money may be duplicated, lost or unrecorded (e.g. posting failures, payments pending verification).
4. A workflow feeding a system-of-record domain is `failing`.
5. Security: unexpected scope use, credential compromise suspicion, access from an unknown connector.

Urgent exceptions appear at the top of every relevant operational screen for users with responsibility,
notify the duty owner (in app, and by `message.staff` where configured), and require acknowledgement.
Everything else is **routine**: shown in the console and a daily digest. Routine items never interrupt.

## 7. Safe operations with impact preview

Each operation first shows an impact preview: affected properties, workflows, domains of record, staff roles,
screens and automations, and what staff should do meanwhile.

| Operation | What happens | Safeguards |
|---|---|---|
| **Pause** | Inbound reads stop; outbound operations are **held** (not dropped, not sent); data becomes `delayed` as it ages | Reason required; urgent banner on affected screens; auto-reminder every 4 hours while paused |
| **Resume** | Inbound catches up from cursor or by window reconciliation; outbound held operations go through the reconnect rules (§9) | Never a bulk resend |
| **Credential rotation** | New credential added and verified while the old one still works; switch; old one revoked | Zero-downtime target; if the vendor allows only one credential, a planned short pause with preview |
| **Disconnect** | Credentials revoked, workflows disabled, exchange log retained per retention policy | **Refused** while the connection is the system of record for any domain; requires an authority transition first ([source-of-truth-matrix.md](source-of-truth-matrix.md) §6) |
| **Replace provider** | New connection set up in parallel; authority or source registration moved via transition; old connection paused until reconciliation passes | Both connections cannot be active publishers for the same channel (CR-7) |

## 8. Information exchange rules

### 8.1 Two kinds of workflows

- **State workflows** (room status, availability, rates, restrictions, profiles, unit lists): the goal is that
  both sides converge on the authoritative state. Ordering by source version or timestamp; older inbound
  values are recorded as `superseded` and ignored; periodic full-state reconciliation heals drift.
- **Transaction workflows** (reservation revisions, charge postings, payments, journals): every item has a
  business identity and must be applied **exactly once**, in order per entity.

### 8.2 Specific situations

| Situation | Detection | Behavior |
|---|---|---|
| **Duplicate message** | `dedupe_key` = connection + entity type + external id + revision (or payload hash when the provider has no revision), enforced by a unique constraint | Recorded as `duplicate`, acknowledged to the sender so it stops resending, no business effect |
| **Out-of-order message** | Revision lower than the last applied, or modification/cancellation for an unknown entity | Older revision → `superseded`. Unknown entity → `held` for up to 10 minutes while Portico fetches the entity from the provider; if still unknown, an exception is raised. A cancellation for an unknown booking is recorded (no inventory consumed) for traceability |
| **Delayed message** | Provider timestamp vs receipt time; freshness target exceeded | Data labeled `delayed`; if it affects urgent criteria (§6.4), urgent exception |
| **Missing message** | Sequence gaps (where offered); reconciliation sweeps: arrivals next 48 h every 15 min, next 30 days hourly, full horizon nightly (targets); POS end-of-day totals vs postings | Fetch and apply the missing items; if not fetchable, exception with the affected records; affected lists labeled `incomplete` until resolved |
| **Conflicting edits (forward mode)** | Precondition fails, or an inbound change touches a field with a pending outbound operation | Outbound operation becomes `needs_review`, not sent; both values shown; the user chooses; nothing is silently overwritten |
| **Conflicting edits (Portico authoritative)** | Inbound change from a system holding a copy | Safe-direction rule CR-6 |
| **Expired or revoked credential** | 401/403 or vendor error codes | Connection `suspended` (credential problem); reads stop; outbound operations held; one urgent exception (not one per failed call); no retry storm; on renewal, resume with §9 rules |
| **Provider outage** | 5xx, timeouts | Retries with exponential backoff (5 s, 10 s, 20 s, 40 s, then every 60 s for 30 min, then every 5 min — pattern documented by SiteMinder, research 03 §4.3); circuit breaker opens after 10 consecutive failures; payload errors are **not** retried (they go to an exception); operations whose outcome is unknown become **pending verification** |
| **Unmapped value** | Mapping lookup fails | Exchange `held`; mapping exception; for reservations: booking stored as received and visible, **inventory consumption decided by the reservations rules** (unmapped OTA bookings are placed on a provisional hold against the property total and raise an urgent exception — research 03 §4.6 "avoid") |
| **Acknowledgements** | — | Inbound items are acknowledged to the provider only after Portico's transaction commits (outbox), never before |

### 8.3 Preserving business meaning

| Difference | Rule |
|---|---|
| Identifiers | Store external ids per connection; never reuse Portico ids as external ids; merges and splits keep a mapping history |
| Currencies | Amounts carried in the source currency with minor units; conversions only with an explicit rate and date; never implicit |
| Time zones | Provider timestamps stored in UTC plus the provider's stated zone; stay dates and business dates are local dates, never derived from UTC timestamps |
| Business dates | Postings carry the source's business date; if absent, Portico derives it from the property's business-date log, labeled derived |
| Tax treatment | Inclusive vs exclusive declared per mapping; tax lines taken from the source when provided (`taxMode: provided`), else computed and labeled |
| Room classifications | Unit types mapped explicitly; composite/connecting units mapped as such or flagged unsupported |
| Transaction codes | Mapped to charge codes with tax and ledger effect reviewed (financially significant) |
| Status definitions | Mapped by meaning (e.g. vendor "Pickup" status), with differences shown at setup |

## 9. Reconnecting never blindly replays

On resume after a pause, outage or credential renewal:

| Operation class | Examples | Rule |
|---|---|---|
| **S — state-setting** | Room status, availability, rates, restrictions, profile fields | The held queue is **discarded as a queue**. Portico computes the current authoritative state for the affected window and sends that once (full state for the window). |
| **M — money-moving** | Charge postings, payments, refunds, journals | Each held or unknown operation is first **verified** at the provider by idempotency key or business key. It is sent only if (a) verified not applied, (b) still valid (folio open, stay status unchanged, amount unchanged), and (c) younger than its staleness limit (default 24 h). Otherwise it becomes `needs_review` for a finance user. |
| **I — inventory-consuming or inventory-reopening** | Forwarded reservation creation/cancellation, block release, out-of-order removal | Never sent automatically if the target state changed during the outage. Re-evaluated against current availability; anything that would reopen sold inventory or consume inventory now taken requires review. |
| **Inbound backlog** | Missed reservations, postings | Fetched by cursor or window and applied in order with deduplication |

Test evidence required: scenarios 2, 5, 6 and 20 of the product brief and operational-readiness brief §19
items (delayed/duplicated/reordered updates, missing bookings after outage, expired credentials, duplicate
callbacks).

## 10. Error message standard

Every integration problem shown to staff has four mandatory parts, plus context:

| Part | Content | Rule |
|---|---|---|
| **Problem** | What happened, in business terms | Names systems by product name; no codes, no payload terms |
| **Business impact** | What it means now for guests, inventory, money or work | Quantified where possible ("4 arrivals today may be missing") |
| **Responsible party** | Who must act: a hotel role, Monoclay support, or the named vendor | Never "contact your administrator" without saying which role |
| **Next step** | The action (button) or instruction | Says what happens to held work after the fix |
| Context | Since when (property local time), affected properties and records, reference id for support | Technical detail available behind "Details for support" only to permitted users |

In the API, the same parts are carried in RFC 9457 problem+json extension members `impact`,
`responsibleParty` and `nextStep`, alongside the stable `code` (CLAUDE.md §9).

**Examples**

1. **Problem:** Portico can no longer read from OPERA Cloud for Lagoon Beach because the access granted on
   3 October expired today at 09:12. **Impact:** Room statuses and arrivals in Portico are 47 minutes old; 12
   housekeeping updates are waiting and are not yet in OPERA. **Responsible:** your OPERA administrator.
   **Next step:** renew Portico's access in OPERA. Waiting updates will be checked against OPERA before sending.
2. **Problem:** Booking.com sent a booking for "Deluxe Water Villa (New)", which is not linked to a Portico villa
   type. **Impact:** Booking for 12–15 December is saved, held against the property total, and may cause an
   oversell. **Responsible:** reservations manager. **Next step:** link the room type, then confirm the booking.
3. **Problem:** The 6 November journal file has not been confirmed as imported into your accounting system.
   **Impact:** Revenue and deposits for that day are not yet in your general ledger. **Responsible:** finance
   manager. **Next step:** confirm the import or re-download the file (it is the same file; importing it twice
   will duplicate entries in your accounting system).

## 11. Data model sketch (integration schema)

All tables are tenant-owned (`tenant_id`, RLS forced), follow CLAUDE.md conventions, and are owned by the
`integration` module. Secrets are **never** stored here; only references to the secret store.

```sql
integration.connections (
  id, tenant_id, provider_key, product_key, product_version, name,
  target_kind        -- 'production' | 'provider_sandbox' | 'simulator'
  setup_state,       -- §2.1 setup states
  operational_state, -- 'setup' | 'active' | 'paused' | 'suspended' | 'disconnecting' | 'disconnected'
  health_status,     -- §6.3
  owner_user_id, support_owner, created_by, created_at, updated_at, version)

integration.connection_properties (connection_id, property_id, external_property_ref, status)

integration.credential_refs (
  id, connection_id, kind,            -- 'oauth' | 'api_token' | 'vendor_activation' | 'local_connector'
  secret_ref,                         -- pointer into the secret store, never the secret
  scopes_granted text[], read_only_at_vendor boolean,
  issued_at, expires_at, rotation_due_at, last_verified_at, status)

integration.workflow_activations (
  id, connection_id, property_id, workflow_key, capabilities text[],  -- R, C, U, RC
  sync_mode, interval_seconds, freshness_target_seconds, effect,       -- maps to ExternalEffect
  state,                              -- 'proposed' | 'approved' | 'active' | 'paused' | 'disabled'
  activation_scope_version, approved_by, approved_at)

integration.mappings (
  id, connection_id, property_id, entity_kind, portico_ref, external_ref, external_label,
  status,                             -- 'suggested' | 'confirmed' | 'rejected' | 'excluded' | 'superseded'
  confidence numeric, reasons jsonb, financially_significant boolean, ambiguous boolean,
  reviewed_by, reviewed_at, version)

integration.validation_runs (id, connection_id, kind, started_at, finished_at, result, checks jsonb, triggered_by)

integration.sync_runs (
  id, connection_id, workflow_key, property_id,
  kind,                               -- 'initial' | 'incremental' | 'reconciliation' | 'sweep' | 'manual'
  window jsonb, started_at, finished_at, status,
  records_read, records_applied, records_skipped, exceptions_created, cursor_before, cursor_after)

integration.stream_cursors (connection_id, workflow_key, property_id, cursor, updated_at)

integration.exchanges (            -- the exchange log; payloads in encrypted object storage, redacted
  id, connection_id, property_id, workflow_key, direction, operation,
  external_entity_type, external_entity_id, external_revision,
  dedupe_key unique, portico_ref jsonb,
  status,                             -- 'received' | 'applied' | 'duplicate' | 'superseded' | 'held' | 'rejected'
                                      -- | 'sent' | 'acknowledged' | 'failed' | 'pending_verification'
  occurred_at, received_at, applied_at, attempts, payload_ref, payload_hash, error_code, correlation_id)

integration.outbound_operations (
  id, connection_id, property_id, workflow_key, operation_class,  -- 'S' | 'M' | 'I' (§9)
  idempotency_key unique, business_key, target_ref jsonb, requested_value jsonb, precondition jsonb,
  state,                              -- 'prepared' | 'held' | 'sent' | 'acknowledged' | 'rejected' | 'unknown'
                                      -- | 'verified_applied' | 'verified_not_applied' | 'needs_review' | 'cancelled'
  stale_after, attempts, last_error, created_by, created_at)

integration.exceptions (
  id, connection_id, property_id, workflow_key, kind, severity,  -- 'urgent' | 'routine'
  status,                             -- 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'dismissed'
  problem, business_impact, responsible_party, next_step,
  owner_user_id, due_at, related_exchanges uuid[], related_records jsonb, resolution, resolved_by, resolved_at)

integration.health_snapshots (connection_id, workflow_key, at, status, last_success_at, lag_seconds, queue_depth, error_rate)

integration.vendor_notices (id, provider_key, kind, effective_date, summary, impact, affected_connections uuid[], status)

integration.usage_records (connection_id, period, metric, quantity, cost_minor, currency, source)  -- 'provider_report' | 'estimate'
```

Related platform changes: `platform.data_authority.connection_id` gets a foreign key to
`integration.connections` (G-07); authority history and transitions (G-02); activation scopes (G-04).

## 12. Acceptance tests

| # | Test |
|---|---|
| CL-01 | Leaving setup at step 5 and returning a week later restores every decision; expired authorization only re-opens step 3. |
| CL-02 | A financially significant mapping with confidence 0.97 cannot be bulk-accepted; a finance user must confirm it individually. |
| CL-03 | Activation is refused if the last validation run predates the last mapping change. |
| CL-04 | The same OTA reservation revision delivered 3 times results in one booking, two `duplicate` exchanges and three acknowledgements. |
| CL-05 | A modification received before its creation is held, the creation is fetched, and both apply in order. |
| CL-06 | During a simulated provider outage, a forwarded room status is retried with backoff; after recovery, only the current state is sent (class S), not the queue. |
| CL-07 | A charge posting whose outcome is unknown is verified by business key before any resend; if the provider already has it, it becomes `verified_applied` and nothing is sent. |
| CL-08 | A held cancellation that would reopen a unit since sold elsewhere is not sent automatically after reconnect; it becomes `needs_review`. |
| CL-09 | An expired credential produces exactly one urgent exception per connection with all four message parts. |
| CL-10 | Disconnecting a connection that is the system of record for `reservations` is refused with a pointer to the transition protocol. |
| CL-11 | Credential rotation completes without any exchange failing (where the vendor supports two credentials). |
| CL-12 | No log line, exception or exchange record contains a secret or a raw card number (log scanning test). |
| CL-13 | Routine exceptions never trigger staff notifications outside the app; urgent ones do, once, with acknowledgement tracking. |
