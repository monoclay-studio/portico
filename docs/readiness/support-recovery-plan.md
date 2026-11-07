# Operational support and recovery plan

Deliverable 11 of the operational-readiness brief (§17; product brief §16, scenarios 9, 13, 20). Owner: Operational
Readiness lead with the Engineering lead. Last updated: 2026-11-07. Labels as defined in `dependency-register.md`.

> Every number in this document is a **TARGET**, not a commitment or a measured result, until supported by testing and
> actual operational capacity (readiness brief §17). Hosting the application 24/7 does **not** mean 24/7 support exists.

---

## 1. Service objectives (TARGETS)

| Objective | Pilot TARGET | Wider-release TARGET | How measured | Status |
|---|---|---|---|---|
| Availability — core staff operations (reservations, front desk, folios, housekeeping) | 99.5% monthly | 99.9% monthly | Synthetic checks every minute from outside AWS + server-side SLIs | TARGET (untested) |
| Availability — booking engine | 99.5% | 99.9% | Synthetic checkout (simulated payment) | TARGET |
| Latency — interactive staff actions | p95 < 500 ms server time | same | APM | TARGET |
| Channel sync freshness | ARI change visible at hub ≤ 2 min p95 | ≤ 1 min | Ack timestamps | TARGET |
| Channel booking ingestion | ≤ 2 min p95 from hub availability | ≤ 1 min | Revision timestamps | TARGET |
| Background work delay (outbox) | ≤ 1 min p95 | ≤ 30 s | Queue age | TARGET |
| **RPO** (max acceptable data loss) — database | ≤ 5 minutes (point-in-time recovery) | ≤ 1 minute (Multi-AZ synchronous standby + PITR) | Restore drills | TARGET |
| **RTO** — single-AZ/instance failure | ≤ 15 minutes | ≤ 5 minutes | Failover drills | TARGET |
| **RTO** — data corruption / bad deploy | ≤ 4 hours (PITR to side instance + forward repair) | ≤ 2 hours | Drills | TARGET |
| **RTO** — full region loss | ≤ 24 hours (restore from cross-region backups) | ≤ 8 hours | Annual DR exercise | TARGET |
| Support first response — P1 (property cannot check in/out, take payments, or sees wrong availability) | Within agreed support hours: 30 minutes; outside: best effort (Q21) | 24/7: 15 minutes (only when a staffed rota exists) | Ticket timestamps | TARGET |
| Support first response — P2 (degraded) / P3 (question) | 4 business hours / 1 business day | 2 hours / 8 hours | Ticket timestamps | TARGET |

Error budgets: monthly; releases freeze when the budget is spent.

## 2. Failure modes and responses (readiness brief §17)

| Failure | Detection | Immediate response | Recovery | Staff-facing behaviour |
|---|---|---|---|---|
| Property internet failure | Hotel reports; client heartbeat loss | Continuity procedures (§3) | Reconnect; enter paper log with original times; reconcile | Offline banner; cached data labelled **stale** with timestamp; no "current" claims |
| Provider outage (Channex, PSP, SES, Meta, AI) | Health checks, error rates | Queue outbound work; switch to manual alternatives | Replay queues; reconcile (missed bookings from feed; payment status queries) | Integration health panel: last success, pending items, impact, safe actions |
| Cloud outage (AZ / region) | AWS health + synthetic checks | Multi-AZ failover; status page | Region restore runbook | Status page + in-app banner |
| Delayed background work | Queue age alerts | Scale workers; prioritise money and channel queues | Drain; verify idempotency | "Pending" states, never "done" |
| Failed deployment | Canary/health checks | Automatic rollback of application version | Database migrations are backward-compatible (expand/contract) so app rollback is safe | None, or brief banner |
| Corrupted/accidentally changed data | Integrity checks (ledger balance, invariants), user reports | Stop affected writers; legal hold on logs | PITR to a **side** instance, extract correct state, apply **forward corrections** (reversing/adjusting entries) — never overwrite live data | Explanation of correction on affected records |
| Lost credentials / compromised account | Anomaly alerts, user report | Revoke sessions/keys; force MFA reset | Audit review; notify hotel | — |
| Hardware failure (terminal, encoder, printer, tablet) | Staff | Manual alternatives (§3) | Vendor replacement | — |
| Incomplete night audit / Day Close | Day Close run status | Day Close resumes from the last completed step; postings idempotent per (stay, date, charge) | Re-run safe; exceptions listed (scenario 9) | Shows completed vs remaining steps |
| Business-date / timezone issue | Monitoring of Day Close timing vs property clock | See §7 | — | Business date displayed prominently |
| Provider suspension (PSP, Channex, Meta) | Provider notices/webhooks | Disable affected feature; manual route | Contract/escalation | Clear banner with alternative |
| Cost-limit exhaustion (AI, messaging) | Quota meters | Degrade gracefully (AI unavailable; messages queued or email fallback) | Owner raises limit | "Unavailable — budget reached" |

## 3. Continuity procedures for property internet loss

Prepared per property during onboarding; drilled before go-live (launch Gate 3).

**Continuity pack (planned feature):** an encrypted snapshot refreshed every 15 minutes `[target]` to a designated
on-property device (front-desk PC or tablet) and printable on demand. Contents: today's and tomorrow's arrivals,
departures, in-house list (room, names, adults/children, balance, payment guarantee status), room status board,
housekeeping assignments, group/VIP notes, transfer manifest, and **emergency guest information** (names, rooms,
nationality, emergency contacts, medical/allergy alerts where recorded and permitted). Access restricted to duty manager
role; device encryption required. Backup connectivity: hotel's 4G/5G router or mobile hotspot `[assumption — hotel SOP]`.

| Area | Procedure during outage | Recovery after reconnect |
|---|---|---|
| Reception — arrivals | Use continuity pack; assign rooms from printed board; registration on paper cards; key cards via the lock system's own encoder software (works independently of PMS `[unconfirmed per lock model]`) | Check in guests in Portico with actual times; attach scanned cards |
| Reception — departures | Print/hand-write folio totals from last snapshot + manual charges since; collect payment on standalone terminal | Post late charges with original service dates; record payments with terminal references; Day Close reconciles |
| Payments | Standalone terminal (with own SIM) or imprint/guarantee per acquirer rules; never key card numbers into spreadsheets | Record each tender with reference (Route D); match terminal batch |
| Reservations & walk-ins | Paper booking log; **no** sell of the last rooms without checking channels' stop-sell (phone duty manager) | Enter bookings; Portico flags conflicts; resolve overbookings |
| Channels | Portico keeps pushing ARI from the cloud (hotel's internet is not needed for channel sync); staff cannot see new OTA bookings → duty manager checks OTA extranets via mobile data | Review new bookings list |
| Housekeeping | Printed assignment sheets; status changes on paper; staff PWA queues offline updates (stale-update rules: last-known state shown, conflicts surfaced — scenario 13) | Sync; supervisor resolves conflicts |
| Outlets / POS | POS continues locally if it supports offline; charges posted to room later with check IDs (idempotent) | Post with original service date |
| Emergency guest information | Printed in-house list with emergency fields kept at the duty desk; refreshed each shift | — |

## 4. Incident roles, contact and escalation

| Role | Pilot staffing | Duties |
|---|---|---|
| Incident commander | Founder | Severity, decisions, external comms approval |
| Technical lead | On-call engineer | Diagnosis, mitigation, recovery |
| Hotel liaison / communications | Founder or support lead | Updates to hotel GM/duty manager; status page |
| Scribe | Any | Timeline for review |

| Severity | Definition | Hotel contact path | Escalation TARGETS |
|---|---|---|---|
| SEV1 | Property cannot operate core workflows, money/inventory correctness at risk, or suspected data exposure | Phone/WhatsApp hotline + in-app "report outage" | Acknowledge 15–30 min (in covered hours); updates every 30 min; founder engaged immediately |
| SEV2 | Degraded feature with workaround | In-app ticket / email | Acknowledge 2 h; updates every 4 h |
| SEV3 | Minor issue/question | Ticket | 1 business day |

Hotel side: duty manager is the default contact; GM for SEV1. Communication responsibilities: Monoclay informs hotels;
hotels inform guests. Provider escalation contacts (Channex, PSP, AWS support plan) recorded once contracts exist.

## 5. Backup and restore verification

Backups' existence is not evidence; **restores** are (readiness brief §17).

| Check | Method | Cadence TARGET | Evidence |
|---|---|---|---|
| Automated snapshot restore | Restore latest snapshot to an isolated account/VPC; run integrity checks: migrations at expected version, row counts vs source, RLS enabled/forced on all tenant tables, **ledger trial balance sums to zero per tenant**, folio balances = ledger projection, audit table append-only grants intact, sample document objects readable | Weekly | Drill log with timings (measured RTO) |
| Point-in-time recovery drill | Restore to a timestamp to a side instance; compare a known transaction set | Monthly | Measured RPO |
| Cross-region restore | Restore from cross-region copy in second region | Quarterly (pilot: before go-live) | DR report |
| Object storage recovery | Versioning + restore of deleted object | Quarterly | Log |
| Tenant-level export | Export one tenant's full data and re-import into a scratch environment | Before go-live; then semi-annually | Report |
| Corruption repair drill | Simulate bad update; repair by forward correction from PITR side copy | Semi-annually | Report |

## 6. Change and release safety

Expand/contract database migrations; feature flags per tenant; canary or staged rollout; no deploys during a property's
Day Close window `[target]`; release notes to hotels for behaviour changes; maintenance windows announced in advance.

## 7. Business date, timezone and daylight-saving risks

| Risk | Detail | Control |
|---|---|---|
| Business date ≠ calendar date | Day Close often runs after midnight; postings after midnight belong to the previous business date until Day Close | Business date is explicit per property, advanced only by Day Close (`platform.advanceBusinessDate` with expected-date check); every posting stores business date, service date, stay date and `occurred_at` UTC (CLAUDE.md §5) |
| Maldives "island time" | Many resorts reportedly set clocks ahead of official Malé time (UTC+5) `[unconfirmed]`; transfers/seaplanes and authorities use Malé time | Property has a legal timezone **and** an optional operating-clock offset decision made at onboarding; guest-facing times labelled; transfers stored in UTC and shown with their reference clock |
| No DST in the Maldives `[unconfirmed — IANA tzdb]`, but groups span DST zones | European and US properties have 23-hour and 25-hour days | Schedules defined in property-local time using tz database rules; jobs keyed by local date, not by "24 hours later"; tests across DST transitions |
| Half-hour offsets | Sri Lanka and India UTC+05:30 `[unconfirmed]` | No assumption of whole-hour offsets |
| Cross-property reports | Portfolio spanning time zones | Reports by business date per property; consolidated views state their convention |
| Night stays | A night is a date, not a timestamp | Half-open night ranges `[arrival, departure)` |
| Server clock vs property clock | All servers UTC | Conversion only at edges via `localDateIn(instant, tz)` |
| Weekend/bank days | Maldives weekend Friday–Saturday `[unconfirmed]` affects bank settlement expectations | Settlement "expected date" uses provider/bank calendars where known; otherwise shown as pending |

## 8. Gaps

| Gap | Owner | Next action | Proceeds meanwhile |
|---|---|---|---|
| Support promise undefined (Q21) | Founder | Decide pilot support hours | Tooling, runbooks |
| No hosting → no measured SLIs | Founder (Q4) | Authorize staging | Local chaos/restore tests on Docker Postgres |
| Continuity pack not designed in detail | Engineering | Spec in `docs/specs/` when `reservations`/`operations` exist | — |
| "Island time" practice unconfirmed | Ops Readiness | Ask pilot candidates | Property operating-clock setting designed as optional |
