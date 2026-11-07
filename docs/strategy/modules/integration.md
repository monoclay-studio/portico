# integration — 10x brief (connector framework, connected mode, open APIs)

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1 framework, R3) · Spec `docs/specs/integration.md` · Adoption
docs `docs/adoption/*` · Parity: **none** (planned on `docs/parity-ops`) · Migration has its own brief:
`modules/migration.md` · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with
hotel staff.**

## 1. Current state (evidence)

- **Built, R3** (README-integration § What is built): connector SDK and honest catalogue (technical readiness and
  external approval as separate fields; planned entries `connectable: false`), resumable 9-step setup journey, encrypted
  credentials with expiry reminders and rotation, mapping suggestions with confidence and mandatory review for financial
  mappings, held (never dropped) unmapped records, exchange log, inbound idempotency and ordering, outbound queue with
  **no blind replay** for money/inventory actions, second approval for charges/payments/accounting/availability,
  health with freshness and provenance, exceptions with owners, self-serve webhooks (wildcards, property filters, thin
  signed events, 10 attempts over ≈ 25.9 h, replay), SSRF-safe `safeFetch`. Connectors: PMS **simulator**, CSV
  import/export, outbound webhooks. ≈ 116 tests.
- **Review:** P0 webhook SSRF and F2–F9 fixed (REV-integration).
- **Real vendor connectors (OPERA/OHIP, Channex, POS, accounting, locks) are R1**; nothing sandbox-tested (R4).
- **No owning module binds an inbound handler yet** — received records are stored as `accepted`, never shown as
  applied (README § Known gaps). Platform transitions (FR-2) await identity-plus.
- **Not built:** XLSX import, inbound HTTP receiver, guests/units/balances import, scope change on an active
  connection, shadow comparison on replace, vendor cursors and nightly full-window reconciliation, validation checks
  (counts, round trip, financial recompute), staff notifications, local connector agent, **partner apps with consent
  and scopes**, "affected records" on mapping change, usage costs from provider reports.
- **UX1 persona 8:** no Integrations/Connections area in the UI at all; `/integrations` is a 404 (blocker).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Openness | Apaleo | OpenAPI per context, OAuth with consent screen, self-serve webhooks with wildcards, property clone/test/live, MCP server (~260 tools) | R02 §3.2, §3.6; DD02b §2 |
| Platform scale and bulk paths | Oracle OHIP | 45 modules / 3,580 operations, async bulk jobs, streaming with replay, Data APIs (paid SKU), module-level access + Sensitive Data Access approvals | DD02a §1.4; DG #2–#5 |
| Bulk export | Mews Exports API | Async JSONL incl. ledger entries, incremental windows | DD02b §1.3; DG #17 |
| Marketplace breadth | Mews | 1,000+ integrations — but support-gated webhooks and portfolio tokens | R02 §2.3, §2.8 #1 |
| Channel mechanics | SiteMinder | Ack-or-resend, backoff, mapping completeness counters, replay | R03 §4.3 |
| Anti-pattern | Agilysys NDA-gated APIs; Mews support tickets for webhooks; RoomRaccoon no self-serve portal | — | R01 §6.4; R02 §2.8; DD02b §6 |

Integration is the top pain for 38% of hotels (DG #28 [S], sponsored by best-of-breed vendors).

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Evidence |
|---|---|---|---|
| 1 | Connections UI and the 9-step journey usable by hotel staff | Persona 8 blocker; "first read-only connection ≤ 30 min" target | UX1 persona 8; UXP §19 |
| 2 | Inbound handlers bound by owning modules (reservations mirror, operations stays, guests profiles, finance charges, inventory status) | Connected mode is the adoption ramp | README § Known gaps; gap plan M7 |
| 3 | Platform authority transitions bound (FR-2) | Safe switch of system of record | PF last item |
| 4 | Public API product: OpenAPI per module, OAuth partner apps with consent scopes incl. sensitive data, per-integration clients, re-approval on scope change | Groups planning agents; OHIP pattern | DG §2 identity/integration rows; INT-R27 |
| 5 | Bulk export and import APIs (async JSONL, incremental windows, ledger export) | "Easiest system to join and to leave" | DG §2 integration row; DD02a §6 #3 |
| 6 | First real connector to sandbox (Channex for distribution — D7; then an OPERA/Mews read path) | Nothing is R4 | dependency register; Q23, Q140 |
| 7 | Validation runs (counts, round-trip, financial recompute) and nightly full-window reconciliation | Trust gate | INT-R17; F15 list |
| 8 | Local connector agent (on-prem OPERA 5, locks, POS) | Maldives resorts on OPERA 5 + on-site encoders | INT-R25; Q62 |
| 9 | Staff notifications for exceptions; usage-cost meters per connection (e.g. OHIP calls) | Costs visible before incurred (vision pillar 4) | Q45 |
| 10 | MCP server mirroring public scopes with dry-run for money tools | Apaleo parity + safety | DD05 §2, §6; gap plan M12 |

## 4. The 10x outcome (TARGETS)

**Picture:** a hotel's IT person (or the guesthouse owner) connects Portico read-only to the system they already use in
under 30 minutes, sees their own yesterday inside Portico with a short list of discrepancies, and can switch one
domain at a time to Portico with a preview of what changes — while partners self-serve sandbox keys, scoped consent and
webhooks without a support ticket.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | Domains supporting mirror + forward through bound handlers | 0 bound | — | all 10 data-authority domains |
| Powerful | Records dropped or silently unapplied in the fault matrix (delay, duplicates, out-of-order, outage, credential expiry) | 0 in simulator tests | — | 0 with every bound handler |
| Seamless | First read-only connection (simulator PMS) by hotel staff | no UI | baseline to measure | ≤ 30 min staff time, ≤ 2 help requests (UXP §19) |
| Seamless | Mapping suggestions accepted unchanged | measured (`suggestionAccuracy`) | baseline to measure | ≥ 85% (non-financial), 100% of financial mappings reviewed |
| Friendly | Partner from sign-up to sandbox webhook received | — | Mews support-gated (R02 §2.8) | ≤ 15 min, self-serve |
| Well-rounded | Full tenant export → re-import reconciles exactly | not built | Mews Exports; Cloudbeds access ends at deactivation (DG #22) | exact match on every gate in `docs/adoption/migration-acceptance-criteria.md` |
| Well-rounded | Connectors at R4 (sandbox-tested) | 0 | — | Channex + one PMS read path before the resort pilot |

## 5. Next 3 increments

### Increment 1 — Bind the ramp
- Bind platform authority transitions (FR-2) and `pendingOperations`; define the **inbound handler contract** per
  domain (idempotent on `(connection, externalId, revision)`, `aggregateVersion`-aware, freshness → `delayed`) and bind
  the first three: reservations mirror, operations stays (with the operations brief's increment 1), guests profiles;
  staff notifications for exceptions; write the parity file (with `docs/parity-ops`).
- **Acceptance:** A01–A03 adoption evidence through `pms.simulator` (read-only connection, mirrored bookings with
  provenance `external` and last-sync time, housekeeping loop); `accepted` records become `applied` only after the
  owning module commits.

### Increment 2 — Public API and partner apps
- Generated OpenAPI per module under `/v1`; OAuth partner apps with consent screens listing module scopes and
  sensitive-data scopes, re-approval on scope change, per-integration clients, human principal on every agent action
  (with identity); usage meters per connection with caps shown before incurring cost (Q45); sandbox organizations with
  sample data for partners.
- **Acceptance:** a partner app is created, consented and receives a webhook in a test without operator involvement;
  scope escalation requires re-consent (tested); API reference published from the contracts.

### Increment 3 — Bulk export/import and the first sandbox connector
- Async bulk export (JSONL per entity incl. ledger entries, incremental by updated time, signed short-lived links)
  and the matching import API keyed by source id (shared with migration); validation runs (counts, round-trip,
  financial recompute); Channex adapter against staging (with distribution) as the first R4 connector.
- **Acceptance:** full tenant export → import into a fresh tenant reconciles exactly (reservation counts by status,
  room nights and revenue on the books per stay date, deposits, AR, folio balances); Channex staging run recorded as
  R4 evidence in the readiness register (no production activation — Q23).

## 6. Cross-module dependencies and contract changes

- **Every data-owning module:** register inbound handlers and forward contracts; import APIs keyed by source id (gap
  plan §7.4–7.5). **platform:** authority transitions, usage meters, sandbox organizations. **identity:** partner apps,
  consent scopes, agent principals (`via` marker). **distribution:** Channex adapter on the connector SDK.
  **migration:** shares mapping engine, import APIs and reconciliation. **ai:** MCP server built on the same scopes.
  **finance:** accounting journal export via `file.csv` / ERP connector.

## 7. Power check — never lose or hide

Never present a simulator or file exchange as a live connection; technical readiness and external approval stay
separate; unmapped records are held, never dropped; money and inventory commands are never replayed blindly; a
disconnect never turns an uncertain charge into "cancelled"; credentials never appear in responses or audit; every
outbound call goes through `safeFetch`; no connection without the hotel's authorization; webhooks stay self-serve.
