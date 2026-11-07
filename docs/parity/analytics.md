# Parity: analytics

Module: `analytics` (metric catalog, daily facts, standard and custom reports, drill-down, as-of vs restated,
portfolio consolidation, scheduling and export, warehouse sync, data quality, external comparison) · Spec:
`docs/specs/analytics.md`.

**Baseline.** OPERA Cloud 26.2 *Reports* (report catalogue, scheduled reports, report groups, definable manager's
report, stationery, Reporting and Analytics), Mews Business Intelligence and scheduled exports, Apaleo Reports API,
plus the finance/F&B/back-office report expectations recorded in the other matrices of this cluster. Evidence links at
the end; **all verified 2026-11-07**.

**Status rule.** No `analytics` code on `main` or any branch. Finance reports implemented on `feat/finance-core` are
tracked in `finance.md`, not here. Rows are `specified` (ANL-Rnn or another spec), `deferred`, or `missing`.

## Capabilities

### Metrics and definitions

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ANL-001 | Metric catalog with plain-language definition, formula, period semantics, inclusion rules, currency treatment, version | assumption (reporting is the #1 modern-PMS complaint, research 02 §8) | P0 | specified | analytics.md ANL-R01 | — |
| PAR-ANL-002 | Core rooms metrics: available, sold, OOO, comp, house use, occupancy, ADR, RevPAR | Apaleo [property performance ADR/RevPAR][ap-reports] · OPERA [manager report][op-rpt-mgr] | P0 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-003 | TRevPAR and revenue by department, charge code, segment, source, channel | OPERA [financial payment and revenue][op-rpt-fin] · Apaleo [revenues report][ap-reports] | P0 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-004 | Room nights and bed (guest) nights per month | Apaleo [room-nights, bed-nights][ap-reports-beta] | P0 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-005 | Guest-nights by nationality (authority statistics) | OPERA [statistics exports][op-export-api] | P0 | specified | analytics.md ANL-R02; Q43 | — |
| PAR-ANL-006 | Cancellations and no-shows (count, nights, revenue); lead time; length of stay | OPERA [cancellations by EOD][op-rpt-eod] · [reservation reports][op-rpt-res] | P0 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-007 | Channel costs (commissions) and net revenue by channel | assumption (distribution cost analysis) | P1 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-008 | Housekeeping productivity, task SLA, guest-service response times | OPERA [housekeeping reports][op-rpt-hk] | P1 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-009 | GOPPAR, flow-through, labour %, F&B cost %, utilities per occupied room | assumption (USALI KPIs) | P1 | specified | accounting.md ACC-R35 | — |
| PAR-ANL-010 | F&B covers, average check, sales mix, menu engineering | Simphony [reporting][sim-reporting] | P1 | specified | fnb-pos.md FNB-R29 (menu engineering missing — fnb-pos.md PAR-POS-103) | — |
| PAR-ANL-011 | Package/allowance consumption and breakage value by meal plan | OPERA [package ledger, effective package allowance][op-rpt-fin] | P1 | specified | finance.md FIN-R42; fnb-pos.md FNB-R29 | — |
| PAR-ANL-012 | Green Tax collected and guest-days by rate category | OPERA [Maldives Green Tax report][op-rpt-fin] | P0 | specified | analytics.md §11; finance (branch report) | — |

### Reports catalogue and forecasting

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ANL-020 | Standard report catalogue in every edition with export CSV/XLSX/PDF | OPERA [report descriptions][op-rpt-desc] · [generating reports][op-rpt-gen] | P0 | specified | analytics.md ANL-R05 | — |
| PAR-ANL-021 | Manager's daily report, configurable which statistics appear | OPERA [definable manager's report][op-rpt-mgr] | P0 | specified | analytics.md ANL-R05 (configurability missing) | — |
| PAR-ANL-022 | Arrivals, departures, in-house lists | OPERA [arrivals][op-rpt-arr] · [departures][op-rpt-dep] · Apaleo [arrivals report][ap-reports] | P0 | specified | analytics.md ANL-R05; reservations.md RES-R35 | — |
| PAR-ANL-023 | Occupancy and revenue forecast on the books (history and forecast) | OPERA [history and forecast][op-rpt-hist-fc] · [reservation forecast][op-rpt-fc] | P0 | specified | analytics.md ANL-R05 | — |
| PAR-ANL-024 | Pickup and pace (on the books by stay date as of booking date) | OPERA [booking pace][op-rpt-pace] | P0 | specified | analytics.md ANL-R02, ANL-R05 | — |
| PAR-ANL-025 | Package / meal forecast for kitchens (covers by meal per day) | OPERA [package forecast][op-rpt-pkg-fc] · [meal type forecast][op-rpt-meal-fc] | P1 | missing | — | — |
| PAR-ANL-026 | Group/block pickup and pace reports | OPERA [blocks and groups reports][op-rpt-blocks] | P1 | specified | groups.md (block reports) | — |
| PAR-ANL-027 | Profile/company/agent production statistics | OPERA [profile production][op-rpt-profile] | P1 | missing | — | — |
| PAR-ANL-028 | Matrix / pivot statistics report | OPERA [matrix report][op-rpt-matrix] | P1 | specified | analytics.md ANL-R07 (custom reports) | — |
| PAR-ANL-029 | Yearly forecast and budget vs actual vs forecast | OPERA [yearly forecast][op-rpt-yearly] | P1 | specified | accounting.md ACC-R32, ACC-R41 | — |
| PAR-ANL-030 | Rate checks / in-house rate check and rate discrepancy report | OPERA [guests in-house rate check][op-rpt-ratecheck] | P1 | missing | — | — |
| PAR-ANL-031 | Revenue by service ordered (ancillaries) | Apaleo [ordered services][ap-reports] | P1 | specified | analytics.md ANL-R02 (ancillary revenue) | — |
| PAR-ANL-032 | Data-quality report with fix links | assumption | P0 | specified | analytics.md ANL-R06 | — |
| PAR-ANL-033 | Integration-health report (delay, failures, recovery) | assumption | P0 | specified | analytics.md ANL-R02, ANL-R05 | — |

### Trust: drill-down, restatements, provenance

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ANL-040 | Drill-down from any figure to underlying records within permissions; counts match exactly | Mews [ledger activity drill][mw-ledger-activity] | P0 | specified | analytics.md ANL-R03, ANL-I02 | — |
| PAR-ANL-041 | As-of (as closed) vs restated views with itemized differences | assumption (Stayntouch lacks "as-of", research 02 §4.4) | P0 | specified | analytics.md ANL-R04 | — |
| PAR-ANL-042 | Statistics available live during the day (not only after the audit) | OPERA [statistics after EOD][op-eod-procs] (contrast) | P1 | specified | analytics.md ANL-R02 | — |
| PAR-ANL-043 | Provenance markers (estimate, external, delayed, incomplete) on figures | assumption (architecture rule 16) | P0 | specified | analytics.md §9, §14 | — |
| PAR-ANL-044 | Regenerate past reports and keep the filed version | OPERA [EOD reports regenerate][op-eod-reports] | P1 | specified | day-close.md DCL-R07 | — |
| PAR-ANL-045 | Tenant/property scope enforced on every report and export | assumption (E09, S17) | P0 | specified | analytics.md ANL-I03 | — |

### Custom reports, scheduling, delivery

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ANL-050 | Custom reports: metrics × dimensions × filters × period; save and share by role | Mews [Business Intelligence dashboards][mw-bi] | P1 | specified | analytics.md ANL-R07 | — |
| PAR-ANL-051 | Scheduled report delivery by email/file with formats | OPERA [scheduled reports][op-rpt-sched] · Mews [scheduled BI exports][mw-bi-schedule] · [Operations scheduled exports][mw-ops-schedule] | P1 | specified | analytics.md ANL-R07 | — |
| PAR-ANL-052 | Pause, force-run and view executed scheduled reports | OPERA [manage scheduled reports][op-rpt-sched] | P2 | missing | — | — |
| PAR-ANL-053 | Shift reports (per user at shift end) | OPERA [shift reports][op-rpt-shift] | P1 | specified | finance.md FIN-R37; fnb-pos.md FNB-R23 | — |
| PAR-ANL-054 | Report groups and favourites per role | OPERA [report groups][op-rpt-groups] | P1 | specified | analytics.md §9 role dashboards | — |
| PAR-ANL-055 | Copy report configuration to many properties | OPERA [copy reports][op-rpt-copy] | P1 | missing | — | — |
| PAR-ANL-056 | Branded templates (stationery) with logos, QR codes, watermarks | OPERA [stationery editor][op-stationery] · [watermarks][op-rpt-watermark] | P2 | missing | — | — |
| PAR-ANL-057 | Role dashboards (GM day shape, revenue pace, housekeeping, finance exceptions) | Mews [BI vs Analytics][mw-bi-compare] | P0 | specified | analytics.md §9 | — |
| PAR-ANL-058 | Natural-language questions over the data with cited answers | assumption (Cloudbeds Signals, research 03 §3.1) | P2 | specified | ai.md (on top of analytics) | — |
| PAR-ANL-059 | Embedded BI / external BI tool access (e.g., Power BI) | Mews [Analytics on Power BI][mw-bi-compare] · OPERA [Reporting and Analytics][op-rpt-ra] | P1 | specified | analytics.md ANL-R09 (warehouse sync) | — |

### Portfolio, exports and adoption

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-ANL-060 | Portfolio consolidation with declared FX policy and excluded/stale properties listed | Mews [portfolio access][mw-ledger-api] | P1 | specified | analytics.md ANL-R08 | — |
| PAR-ANL-061 | Warehouse sync (nightly incremental, documented schema, no PII by default) | OPERA [Reporting and Analytics][op-rpt-ra] | P1 | specified | analytics.md ANL-R09 | — |
| PAR-ANL-062 | Reports API for integrators | Apaleo [reports API][ap-reports] | P1 | missing | — | — |
| PAR-ANL-063 | External comparison with the source system's reports in trial/connected mode | assumption (adoption brief §4) | P0 | specified | analytics.md ANL-R10 | — |
| PAR-ANL-064 | Statistics exports to authorities and tourism bodies | OPERA [HESTA / ISTAT statistics exports][op-export-api] | P1 | specified | analytics.md ANL-R02; Q43 (formats unverified) | — |
| PAR-ANL-065 | Revenue-management system feeds (IDeaS/Duetto class) | assumption (research 03 §8.7–8.9) | P2 | deferred | rates.md RAT-R32 [LATER] | — |
| PAR-ANL-066 | Report permissions and export permission separately controlled | OPERA [report tasks][op-roles] | P0 | specified | analytics.md §8 | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-ANL-001 | A night's rate is corrected two days after Day Close | "As closed" report unchanged; "current" shows the restatement delta linked to the correction (E15) | P0 | specified | — |
| EC-ANL-002 | Drill-down count differs from the headline figure | Treated as a defect: invariant ANL-I02 check fails the report generation with an integrity alert, never shown silently | P0 | specified | — |
| EC-ANL-003 | Complimentary and house-use rooms in ADR | Excluded per metric definition and shown separately; definition tooltip says so | P0 | specified | — |
| EC-ANL-004 | Portfolio report mixes USD and EUR properties | Converted by declared policy (business-date or period-average rate) with rate source; local currency available | P1 | specified | — |
| EC-ANL-005 | One property has not completed Day Close for yesterday | Portfolio report lists it as stale/excluded with reason; totals labelled incomplete | P1 | specified | — |
| EC-ANL-006 | Staff with access to one property requests a group report | Only permitted properties included; others not even named | P0 | specified | — |
| EC-ANL-007 | Connected mode: PMS revenue journal not received for a date | Revenue metrics `incomplete` naming the missing input ("needs the PMS journal workflow"); occupancy still shown | P0 | specified | — |
| EC-ANL-008 | Trial comparison: Portico occupancy 82.4% vs source 83.1% | Difference listed with known causes (e.g., day-use counting) or "unexplained — investigate"; never auto-corrected | P0 | specified | — |
| EC-ANL-009 | Forecast for future dates after a tax change | Forecast shows new tax effect labelled estimate; closed-day facts unchanged (E08) | P1 | specified | — |
| EC-ANL-010 | Scheduled report email bounces | Delivery failure recorded with owner; next run proceeds; no silent loss | P1 | missing | — |
| EC-ANL-011 | Scheduled report runs during the Day Close of its date | Report uses the business date selected; if the snapshot is not yet final, labelled provisional | P1 | missing | — |
| EC-ANL-012 | Metric definition changes (new version) | Historical reports keep the version they used; comparisons across versions labelled | P1 | specified | — |
| EC-ANL-013 | Guest profile missing nationality | Counted under "unknown" and listed in data-quality with fix link; authority export blocked if required field missing | P0 | specified | — |
| EC-ANL-014 | Exported CSV opened in Excel with leading-zero codes and MVR decimals | Codes exported as text; amounts in minor-unit-safe decimal format with currency column; documented | P1 | missing | — |
| EC-ANL-015 | Very large export (3 years of postings) | Runs asynchronously as a report run with progress; size limit and pagination; never times out silently | P1 | specified | — |
| EC-ANL-016 | Warehouse sync interrupted midway | Next run resumes from the last committed watermark; no gaps or duplicates (incremental keys) | P1 | specified | — |
| EC-ANL-017 | PII requested in warehouse sync | Off by default; enabling requires permission and records lawful basis; masked fields documented | P1 | specified | — |
| EC-ANL-018 | Report on a business date before the property went live (migrated history) | Historical facts labelled `copied`/migrated with source; restatements not applied to archive data | P1 | specified | — |
| EC-ANL-019 | Day-use stays and split stays across midnight | Counted per metric definition (day use not a room night); split segments counted once per night | P0 | specified | — |
| EC-ANL-020 | Composite unit (2-bedroom villa sold as one) | Rooms available/sold counted per definition (sellable unit), components not double-counted | P0 | specified | — |
| EC-ANL-021 | Out-of-order unit returned mid-day | Daily availability uses the Day Close snapshot rule; live view shows current; both labelled | P1 | specified | — |
| EC-ANL-022 | Revenue in a period with a credit note for a prior period | Revenue report shows the credit in the current period and links the restatement to the original; tax report per tax-point rule | P0 | specified | — |
| EC-ANL-023 | Channel commission unknown for a booking | Net revenue shown as estimate with missing-input flag; data-quality item created | P1 | specified | — |
| EC-ANL-024 | Report generated in demo/training environment | Watermarked simulated; scheduled emails to real recipients blocked by environment safety | P0 | specified | — |
| EC-ANL-025 | Property time zone differs from the viewer's | Business-date reports use property dates; timestamps shown with time zone; never shifted by viewer locale | P0 | specified | — |
| EC-ANL-026 | Green Tax report month boundary: guest stays 28 Feb–3 Mar | Guest-days split by month; carried-over guests reported per OPERA-equivalent rule; total reconciles to postings | P0 | specified | — |
| EC-ANL-027 | Custom report shared with a role that lacks finance permissions | Finance columns hidden or report refused with reason; never leaks restricted fields | P0 | specified | — |
| EC-ANL-028 | Same report requested twice concurrently | Second request reuses the running run or creates its own with identical results; no partial file | P2 | missing | — |
| EC-ANL-029 | Integration-health report when a connector is silently stuck | Stale threshold breach shown as delayed with last success time; alert to owner | P0 | specified | — |
| EC-ANL-030 | Outlet revenue from an external POS arrives after the snapshot | Fact added as late data with restatement delta on that date; outlet balancing exception referenced | P1 | specified | — |

## Evidence sources (all verified 2026-11-07)

Verification method: pages on docs.oracle.com, docs.mews.com, help.mews.com, api.apaleo.com, apaleo.dev and
docs.stripe.com were fetched and read on 2026-11-07. Pages on hosts this environment's proxy blocks
(central.xero.com, quickbooks.intuit.com, help.rguest.com, docs.infor.com, apaleo.zendesk.com,
mewssystems.freshdesk.com, Toast, Omniboost, Stayntouch, Clock, TrustRadius, oracle.com marketing) were verified
2026-11-07 through web-search results showing the page and its content, or through `docs/research/` citations;
re-open them before any external use. Third-party pages (Omniboost, Stayntouch, Clock, TrustRadius) describe a
competitor's behaviour indirectly and are weaker evidence than the vendor's own documentation.

[op-rpt-mgr]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_configure_definable_managers_report.htm
[op-rpt-fin]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_financials.htm
[op-rpt-eod]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_end_of_day.htm
[op-rpt-res]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_reservations.htm
[op-rpt-hk]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_housekeeping.htm
[op-rpt-desc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/s_report_overview_descriptions.htm
[op-rpt-gen]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_generating_run_reports.htm
[op-rpt-arr]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_arrival.htm
[op-rpt-dep]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_departure.htm
[op-rpt-hist-fc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_history_and_forecast_history_forecast.htm
[op-rpt-fc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_reservation_forecast_market_segment_res_forecast.htm
[op-rpt-pace]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_reservation_booking_pace_reservation_pace.htm
[op-rpt-pkg-fc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_package_forecast_pkgforecast.htm
[op-rpt-meal-fc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_meal_type_forecast_by_day_report.htm
[op-rpt-blocks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_blocks_and_groups.htm
[op-rpt-profile]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_profile_production_statistics_profileproductivitystat.htm
[op-rpt-matrix]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_matrix_report_statistics_matrix_report.htm
[op-rpt-yearly]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_yearly_forecast_report_stat_forecastyearly.htm
[op-rpt-ratecheck]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_guests_in_house_rate_check_giratecheck.htm
[op-rpt-sched]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_manage_scheduled_reports.htm
[op-rpt-shift]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_configuring_shift_reports.htm
[op-rpt-groups]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_groups.htm
[op-rpt-copy]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_copying_reports.htm
[op-rpt-watermark]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_managing_watermarks.htm
[op-rpt-ra]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_reports_accessing_reporting_and_analytics.htm
[op-stationery]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_reports_stationery_editor_bi_pub.htm
[op-eod-procs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_mandatory_optional_procedures.htm
[op-eod-reports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/t_processing_endofday_reports.htm
[op-export-api]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_export_api_files.htm
[op-roles]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.2/ocsuh/c_manage_roles.htm
[ap-reports]: https://api.apaleo.com/swagger/reports-v1/swagger.json
[ap-reports-beta]: https://api.apaleo.com/swagger/reports-v0-nsfw/swagger.json
[mw-bi]: https://help.mews.com/s/article/Using-Mews-Business-Intelligence
[mw-bi-schedule]: https://help.mews.com/s/article/How-to-schedule-exports-in-Mews-Business-Intelligence
[mw-ops-schedule]: https://help.mews.com/s/article/schedule-report-exports
[mw-bi-compare]: https://help.mews.com/s/article/Comparing-Mews-Business-Intelligence-and-Mews-Analytics
[mw-ledger-activity]: https://help.mews.com/s/article/The-Ledger-activity-report-in-Mews-Operations
[mw-ledger-api]: https://docs.mews.com/connector-api/operations/ledgerbalances
[sim-reporting]: https://docs.oracle.com/en/industries/food-beverage/simphony/19.8/simcg/c_reporting.htm
