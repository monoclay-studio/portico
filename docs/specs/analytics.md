# Spec: analytics

Status: Draft v1 · 2026-11-07 · Wave 2 · Schema `analytics` · Prefix `ANL`
Entitlements: standard reports (`core.reports`, all editions); `analytics.customReports` (Professional+);
`portfolio.consolidatedReporting` (Enterprise); `analytics.warehouseSync` (add-on; Enterprise included).

## 1. Purpose

Reporting is the most repeated complaint against every modern competitor (research 02 §1, §8 item 4). Analytics
gives every role numbers it can trust: each metric has a definition, period, currency treatment and source; every
number drills down to the records behind it; historical reports remain understandable after corrections; and data
problems are visible instead of silently skewing results.

## 2. Scope and non-goals

**In scope:** metric definitions catalog, daily facts (from Day Close snapshots and domain events), report catalog,
drill-down, as-of and restated views, portfolio consolidation with currency policy, saved and scheduled reports,
exports and warehouse sync, data-quality checks, integration-health reporting, comparison with external reports
(trial/connected mode).
**Non-goals:** ledger-level finance reports that must be computed from the ledger in real time (`finance` owns them;
analytics links to them), pricing recommendations (`rates` uses analytics facts), BI tool replacement for enterprise
data teams (warehouse sync instead).

## 3. Capabilities

- **ANL-R01** [MUST] **Metric catalog**: key, name, definition in plain language, formula, unit, period semantics
  (business date vs stay date vs booking date), inclusion rules (e.g. comp and house use excluded from ADR), currency
  treatment, source module, owner, version. Every displayed metric links to its definition (brief §13).
- **ANL-R02** [MUST] Core metrics: rooms available/sold/OOO/comp/house use, occupancy, ADR, RevPAR, TRevPAR, revenue by
  department/charge code/segment/source/channel, pickup and pace (on-the-books by stay date as of booking date),
  cancellations and no-shows (count, nights, revenue), length of stay, lead time, channel costs (commissions),
  ancillary revenue, guest-nights by nationality, arrivals/departures, housekeeping productivity (units/attendant,
  minutes vs expected), task SLA compliance, response times (comms), integration health (delay, failures, recovery).
- **ANL-R03** [MUST] **Drill-down** from any figure to the underlying records (stays, postings, tasks, messages) within
  the user's permissions; counts match exactly.
- **ANL-R04** [MUST] **As-of vs restated**: reports for a past period show "as closed" (Day Close snapshot) and
  "current (incl. restatements)" with the differences itemized and linked to the corrections (brief §10, FIN-R04).
- **ANL-R05** [MUST] Standard report catalog for every edition: manager's daily report, arrivals/departures/in-house,
  occupancy & revenue forecast (on the books), pickup/pace, segment/source/channel mix, cancellation/no-show, revenue
  by department, tax report link (finance), housekeeping and maintenance performance, guest-service response, data
  quality, integration health. Export to CSV/XLSX/PDF.
- **ANL-R06** [MUST] **Data-quality checks** with counts and fix links: stays without market segment/source, unmapped
  external codes, profiles missing nationality where required, folios with suspense postings, stale integrations,
  bookings with field-loss reviews pending.
- **ANL-R07** [SHOULD] Custom reports (`analytics.customReports`): choose metrics, dimensions, filters, period; save,
  share by role, schedule email delivery (`message.staff` effect).
- **ANL-R08** [MUST] **Portfolio consolidation** (`portfolio.consolidatedReporting`): comparable metrics across
  properties with a declared FX policy (rate source and date: business-date rates or period-average), local currency
  always available; property exceptions listed (properties excluded, stale, restated).
- **ANL-R09** [SHOULD] Warehouse sync (`analytics.warehouseSync`): nightly incremental export of facts and
  dimensions to a customer-owned destination (S3/BigQuery/Snowflake-style connectors via `integration`), documented
  schema, no PII by default.
- **ANL-R10** [MUST] **External comparison** (adoption brief §4): in trial and connected mode, import or read the
  source system's reports (e.g. occupancy, revenue, balances) and show side-by-side with Portico's computation, with
  differences explained where known and otherwise listed for investigation — never silently "corrected".

## 4. Entities and states

`metric_definition(key, version, definition jsonb)` · `daily_fact(property_id, business_date, metric_key, dimensions
jsonb, value, currency?, snapshot_id)` · `stay_date_fact(...)` for on-the-books/pace (as-of booking date) ·
`report_definition(id, kind standard|custom, spec jsonb, owner, sharing)` · `report_run(id, definition_id, params,
generated_at, artifact_ref)` · `dq_check(key, property_id, count, sample_refs, checked_at)` ·
`external_comparison(id, property_id, source, period, ours jsonb, theirs jsonb, differences jsonb)`.
Report run: `queued → running → completed | failed`.

## 5. Invariants

- **ANL-I01** Facts for a closed business date equal the Day Close snapshot; corrections appear only as restatement
  deltas linked to their source records.
- **ANL-I02** Drill-down record counts and sums equal the displayed figure.
- **ANL-I03** No report returns data outside the user's tenant or property scope (E09, S17).
- **ANL-I04** Every displayed metric has a catalog definition version.

## 6. Cross-module interactions

Reads events and module query APIs (domain map: "reads events + module query APIs"); receives Day Close snapshots;
reads `integration` health; never writes to other modules.

## 7. Events

Emitted: `analytics.report.generated`, `analytics.dataQuality.issueDetected`. Consumed: reservations, finance,
operations, comms, integration, day-close events.

## 8. Permissions

Implemented in role templates: `analytics.report.read`. Defined: `analytics.report.read` · `analytics.report.manage`
(custom) · `analytics.report.schedule` · `analytics.export.run` ⚑ · `analytics.portfolio.read` (org) ·
`analytics.metric.manage` ⚑ (org).

## 9. UX surfaces

Role dashboards (GM day shape, revenue manager pace, housekeeping productivity, finance exceptions), report viewer
with definition tooltips and provenance markers (estimate for forecasts, external for mirrored data, restated
badges), drill-down drawers, data-quality page, external comparison view.

## 10. Proof scenarios and evidence

| ID | Analytics must demonstrate |
|---|---|
| E08 | A rate or tax change shows future impact in forecasts while closed-day facts are unchanged. |
| E15 / S09 | Restatement after correction visible as delta on the original date's report. |
| S16 (supporting) | Portfolio report lists local overrides and excluded/stale properties. |
| A02 (adoption) | Trial comparison of Portico's occupancy/revenue vs the source system's reports lists discrepancies. |

## 11. Maldives specifics

Guest-nights by nationality and Green Tax collected are routine management and authority figures (reporting
obligations unverified — Q43); USD reporting with MVR presentation for tax-related views; resort ancillary revenue
(F&B, spa, excursions, transfers) is a large share of revenue, so TRevPAR and outlet reporting matter.

## 12. Competitive inspirations

Reporting as top complaint at Mews/Apaleo/Stayntouch; "as-of" past-date reporting missing at Stayntouch; Mews BI
launched to answer it (research 02 §2.6, §3.5, §4.4, §8 item 4); OPERA statistics only after audit (research 01 §3.1);
Cloudbeds "Ask Signals" over unified data (research 03 §3.1) — informs `ai` on top of analytics.

## 13. Open questions

Q43.

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes — reporting is a "replace selected capabilities" module.**
- **Hard dependencies:** `platform`, `identity`, mirrored data from `reservations`/`inventory`/`guests` via
  `integration` connectors (reservations and, where available, folio/revenue workflows).
- **Connected mode:** metrics computed from mirrored data carry provenance `external` with freshness; metrics needing
  data the connector cannot supply are shown as `incomplete` with the missing input named (e.g. "Revenue by
  department needs the PMS journal workflow").
- **Data-authority domains:** owns none; respects all (never writes back).
- **Trial:** central to the trial value proposition — "your yesterday in Portico" with an external comparison report.
