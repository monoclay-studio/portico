# Ecosystem and developer experience

> Deliverable 9 (adoption brief §13; product brief §14 for AI agents). Status date: 2026-11-07.
> Current state: `identity.api_clients` supports a hotel's **own** integrations (hashed secret, permission list,
> property list, expiry). There is no partner app model, consent flow or partner sandbox yet (gap G-12 in
> [gap-assessment.md](gap-assessment.md) §5). Public API conventions are fixed by CLAUDE.md rule 10
> (Zod contracts, generated OpenAPI, `/v1`).

## 1. Principles

1. Partners get **exactly the access a hotel grants**, per property, per scope, per environment — never more.
2. Partner writes obey the same rules as staff: permissions, data authority (`assertWritable`), idempotency,
   optimistic concurrency, audit, environment safety.
3. Monoclay's own connectors follow the same program (no private shortcuts), so the program is tested daily.
4. A listing says what has been **demonstrated**, with evidence and date, never "certified for everything".

## 2. Who integrates, and how

| Integrator | Access model | Example |
|---|---|---|
| A hotel's own scripts | Client credentials (`identity.api_clients`), limited to that organization and listed properties | Export to the owner's spreadsheet |
| A partner app used by many hotels | **Scoped OAuth app**: registered once by the partner; installed per organization with consent | POS vendor posting charges; housekeeping app |
| Monoclay-built connector | Same as a partner app, owned by Monoclay | Channex adapter, OHIP adapter |
| AI agents (later) | Same OAuth scopes; consequential actions require human approval | MCP server over the public API |

## 3. Scoped OAuth apps

- **Registration:** partner organization in the partner portal; app with name, publisher, support contact,
  redirect URIs, requested scopes, risk tier (§5) and a public description.
- **Installation:** authorization-code flow with PKCE; the consent screen lists, in plain English, the data
  domains the app can read, the actions it can take, the external effects involved (e.g. "can post charges to
  guest folios"), and the properties selected. Only an organization administrator (or property administrator,
  for property-scoped installs) can consent.
- **Scopes:** bundles of permission keys (`<module>.<resource>.<action>`, the existing permission catalog), with
  separate scopes for guest contact details and identity documents (minimization).
- **Tokens:** bound to organization, environment and properties; short-lived access tokens; rotating refresh
  tokens; revocable instantly by the hotel. A sandbox token can never call a live organization.
- **Data authority still applies:** a partner write to a domain whose system of record is external is rejected
  or forwarded exactly as a staff action would be.
- **Least privilege by default:** apps request the minimum; scope upgrades require a new consent.

## 4. Sandbox organizations and sample data

- Self-serve **sandbox organizations** (`environment = sandbox`) for every registered partner, created with the
  Maldives sample dataset used in the demo (guesthouse, 120-villa resort, 3-property group;
  [evaluation-and-trial.md](evaluation-and-trial.md) §3).
- **Reset on demand** and a nightly roll-forward so arrivals are always current.
- **Scenario generator:** produces realistic traffic and failures to test against — duplicate OTA bookings,
  out-of-order modifications, a room move, a late restaurant charge after check-out, a payment timeout, a
  provider outage (product brief §17 scenarios).
- **Payment and messaging simulators** only; no real money or messages are possible from sandbox (effect
  policy: `payment.charge: sandbox`, `message.guest: simulate`, `credentials.production: blocked`).

## 5. Production approval by risk

| Tier | What the app does | Required before production |
|---|---|---|
| T1 | Reads operational data without guest personal data | Automated checks (scopes, rate-limit behavior); publisher identity verified |
| T2 | Reads guest personal data | T1 + security questionnaire, processing terms, data-minimization review, retention statement |
| T3 | Operational writes (tasks, room status, notes) | T2 where applicable + certification suite for each workflow + live pilot at one property |
| T4 | Financial or inventory writes (charge posting, payments, reservations, availability) | T3 + manual review of idempotency and correction handling + pilot of at least 2 weeks with reconciliation evidence |
| T5 | Contacts guests or controls physical access (messages, keys) | T3/T4 + consent and opt-out handling, sending limits, key-validity tests |

Approval is per app **and per workflow and API version**; adding a workflow starts a new review for that
workflow only.

## 6. Capability documentation

- Generated OpenAPI per module (from Zod contracts) plus **workflow guides** written around business tasks:
  "Post a restaurant charge to a stay", "Update room status from a housekeeping app", "Receive reservation
  changes".
- **Semantics pages** that integrators must understand: money in minor units with currency; business date vs
  stay date vs service date vs timestamps; `Idempotency-Key`; `ETag`/`If-Match` and 409 conflicts; provenance
  values; data authority errors; environment banners; pending verification.
- **Published limits:** request rate and concurrency per app per organization, with `429` and `Retry-After`
  (pattern seen at Apaleo and Mews — research 02 §5.2).
- **Readiness per endpoint:** beta or generally available, and the readiness level of each workflow.

## 7. Error standard (API)

All errors are RFC 9457 problem+json with a stable `code` (CLAUDE.md §9) and these extension members:

| Member | Content |
|---|---|
| `code` | Stable machine code, e.g. `external_system_of_record`, `effect_blocked_in_environment`, `authority_transition_in_progress`, `version_conflict`, `idempotency_key_reused`, `not_eligible_for_room_charge` |
| `detail` | Plain-English problem |
| `impact` | Business effect ("The charge was not posted; the guest's folio is unchanged.") |
| `responsibleParty` | `integrator`, `hotel`, `monoclay` or a named external system |
| `nextStep` | What to do ("Retry with the same Idempotency-Key", "Ask the hotel to enable room charging for outlet X") |
| `retryable` | `true` / `false` (payload errors are never retryable) |
| `correlationId` | For support |
| `current` | For 409 conflicts: the current version so the client can show what changed |

## 8. Webhooks

- **Thin events** (type, entity id, version, occurred_at) plus fetch; event id for deduplication; per-aggregate
  sequence number so receivers can detect gaps and reordering.
- **Signed** with a per-subscription secret (rotatable with overlap).
- **Delivery:** at least once; retries with backoff for 24 hours; a delivery log visible to the partner and to
  the hotel; replay of the last 7 days by the partner (receivers must deduplicate).
- **Self-serve subscriptions** via API and console, with topic wildcards and property filters — not via support
  tickets (research 02 takeaway 8).

## 9. Change notices and versioning

| Change | Rule |
|---|---|
| Additive (new field, new endpoint, new event type) | No notice required; changelog entry; clients must ignore unknown fields |
| Behavior change within a version | Treated as breaking unless it fixes a documented bug; notice ≥ 3 months |
| Breaking change | New version (`/v2`); the old version is deprecated with `Deprecation` and `Sunset` headers; notice ≥ 12 months for generally available APIs, ≥ 3 months for beta (targets) |
| Security-driven change | May be immediate; affected partners and hotels notified the same day with impact |

Notices go to partner contacts, appear in the partner portal, and appear in each affected hotel's integration
console as a vendor-required change with its date and impact (lifecycle spec §6.2).

## 10. Compatibility verification

- A **certification suite per workflow**, run by the partner in sandbox against their app: idempotent retries,
  duplicate and out-of-order events, 409 handling, 429 handling, timeouts with unknown outcome, corrections by
  reversal, environment safety (no live calls from sandbox).
- Results are stored per app version and API version as a **compatibility record** (pass/fail per check, date,
  who ran it).
- Re-verification triggers: our new API version, the partner's declared major release, annually for T4/T5,
  and after any production incident attributed to the app.

## 11. Support ownership

| Problem area | First contact | Owner of the fix |
|---|---|---|
| App behavior, app configuration | Partner support (contact and hours required in the listing) | Partner |
| Portico API availability, platform bugs | Monoclay support | Monoclay |
| Hotel configuration (mappings, permissions, consent) | Hotel administrator, with help from either side | Hotel |
| Ambiguous ownership | Monoclay support triages within the support plan's response targets and assigns | Monoclay coordinates |

Each installed app shows these owners in the hotel's integration console.

## 12. Removal of unsafe or unsupported integrations

| Trigger | Action |
|---|---|
| Security incident, data misuse, or scope abuse | Immediate suspension (global kill switch); hotels notified with impact; partner must report and remediate |
| Repeated business-integrity failures (e.g. duplicate postings above an agreed threshold, failing reconciliations) | Suspension of the affected workflow at affected properties; hotel notified; reinstatement after root cause and re-verification |
| Use of a sunset API version past its sunset date | Calls rejected; hotel shown the app as "needs update" |
| Abandonment (no response to notices for 90 days) or certification lapse | Listing hidden; existing installs warned; scheduled removal with at least 30 days' notice to hotels |

Before any suspension takes effect (except security emergencies), each affected hotel sees an impact preview:
which functions stop, what to do instead. Partners must delete hotel data on removal per their processing terms.

## 13. Marketplace listing rules

A listing shows only what has been demonstrated:

- **Workflows** with capabilities (read/create/update/receive-changes), sync mode and **readiness level** with
  the evidence date; products, versions and regions verified.
- **Costs:** who charges what (partner, Monoclay pass-through, vendor), or "quote required".
- **Limitations** in plain English, including unsupported workflows.
- **Data accessed** (scopes), **risk tier**, and **support** contacts and hours.
- Wording: "Verified by Portico for: <workflows>, API v1, <date>". No "certified", partner logo, award or
  compliance badge without evidence and permission (CLAUDE.md §7). A partner's own certifications are labeled
  as theirs.
- Ratings only from verified installations; ordering is never sold.

## 14. Acceptance tests

| # | Test |
|---|---|
| EC-01 | A partner app installed for property A receives `403` for property B in the same organization. |
| EC-02 | A sandbox token used against a live organization is rejected before any data access. |
| EC-03 | A partner write to a domain with an external system of record returns `external_system_of_record` with `impact`, `responsibleParty` and `nextStep`. |
| EC-04 | Replaying a charge posting with the same `Idempotency-Key` returns the original result and creates no second posting. |
| EC-05 | Revoking an app's consent stops its access within 60 seconds (target) and stops webhook deliveries. |
| EC-06 | A listing cannot be published with a workflow whose readiness evidence is missing. |
| EC-07 | The global kill switch suspends an app across all organizations and each hotel's console shows the impact. |
