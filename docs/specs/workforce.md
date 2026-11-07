# Spec: workforce

Status: Draft v1 · 2026-11-07 · Wave 4 (back-of-house stage BOH-4) · Schema `workforce` · Prefix `WFM`
Entitlements (proposed, CR-29): `workforce.rostering`, `workforce.timeAttendance`, `workforce.compliance` (documents,
certifications, expatriate permits), `workforce.housing`, `workforce.serviceCharge`.

## 1. Purpose

A 120-villa Maldivian resort employs several hundred people, a large share of them expatriates, who live on the island,
eat in the staff canteen and share in the service charge. Workforce gives the hotel one truthful picture of **who
works when, where they sleep, whether they are qualified and legally permitted to work, and what share of the service
charge they earned** — driven by the same occupancy forecast that drives housekeeping and F&B — and stops cleanly at
payroll: Portico prepares exact, approved payroll inputs and checks the payroll journal that comes back, while the
payroll provider computes pay, withholding and pension.

## 2. Scope and non-goals

**In scope:** employee records linked to identity users, positions and headcount, labour standards and forecast-driven
staffing requirements, rosters and shift scheduling with rule checks, shift swaps and open shifts, time and
attendance, timesheets and days-worked ledger, leave, staff accommodation (staff village), staff meals, training and
certifications, expatriate work-permit and document compliance (Maldives Xpat), **service-charge distribution
calculation**, payroll input export and payroll journal checks, labour analytics using cost bands.

**Non-goals (boundary — §15):** payroll gross-to-net, payslips, salary bank payments, employee withholding tax (MIRA
601) and pension filings (payroll provider); storing individual salaries or bank accounts (Q102); recruitment/ATS,
performance reviews, learning-content delivery (integrate); submitting anything to the Xpat portal or other government
systems (manual, references recorded); guest-unit availability (staff housing is never accommodation inventory).

## 3. Capabilities

### 3.1 Employees

- **WFM-R01** [MUST] **Employee** (distinct from the identity **staff member**; linked to at most one user): employee
  number, names as in passport and preferred name, nationality category (`maldivian | expatriate`), date of birth and
  identity numbers (field-encrypted), contacts and emergency contact, employing legal entity, property/work site,
  department, position, grade, manager, employment type (`permanent | fixed_term | probation | casual | intern | agency |
  contractor`), contract dates, probation end, status (§4), working pattern, **labour cost band** (department-level
  hourly cost band set by finance — never an individual salary), documents (passport, work permit, visa, medical, police
  clearance, contract, certificates) as encrypted attachments with expiry. Reads of documents and identity numbers need
  `workforce.document.read` ⚑ and are audited per read (IDN-R13).
- **WFM-R02** [MUST] **Identity link**: hiring may invite a user with a role template by position; employees without
  back-office roles get staff-app access for rosters, leave and punches only; **separation** revokes access at the
  effective time (end of last working day by default, immediate with ⚑) through identity.
- **WFM-R03** [SHOULD] Positions and headcount: approved positions per department with budgeted headcount (`accounting`
  budgets), vacancies, link to expatriate quota slots (WFM-R18).

### 3.2 Forecast-driven rosters (`workforce.rostering`)

- **WFM-R04** [MUST] **Labour standards** per department and task (data), e.g. departure clean 45 min, stayover 25 min,
  turndown 10 min by unit type (shared with OPS-R05 expected minutes), covers per server per service period, bartender
  per n covers, transfer coordinator per n arrivals. **Requirements** per department × day × shift come from forecast
  drivers: occupied units, arrivals and departures, guest-nights (on-the-books via `analytics`), covers per outlet and
  period (capture ratio × in-house guests + events from `groups`), transfers and activity sessions (`resort`, with the
  qualifications they need). Each requirement explains itself ("Housekeeping 14 Dec: 86 departures × 45 min + 34
  stayovers × 25 min → 79 attendant hours → 10 attendants") and is labelled an **estimate**.
- **WFM-R05** [MUST] **Roster building** with rule checks from an employment **rule pack** (data, effective-dated,
  sourced; Maldives values `unverified` until the adviser confirms — Q106): maximum weekly and daily hours, rest between
  shifts, weekly rest day, public holidays, reduced working hours during Ramadan for employees whose flag is set by HR,
  leave and training blocks, **required qualifications** per shift (lifeguard on the pool shift, dive instructor for a
  dive session, licensed skipper for a boat), work-site/transport constraints (staff housed on another island).
  Deterministic auto-fill suggestions; AI proposals optional and never auto-applied. Cost view uses cost bands and is
  labelled an estimate.
- **WFM-R06** [MUST] **Publish** to the staff app (`message.staff` for notifications), acknowledgement, change notices
  ("Your 16 Dec shift now starts at 14:00"), shift swaps (peer accepts → supervisor approves after rule checks), open
  shifts claimable by qualified staff; published roster versions are immutable with diffs.
- **WFM-R07** [MUST] **Resort staffing link**: activity sessions and transfers request staff with qualifications
  (`resort` RST-R07 reads `findQualifiedStaff` and assigns); conflicts are visible on both the roster and the session.

### 3.3 Time and attendance (`workforce.timeAttendance`)

- **WFM-R08** [MUST] **Punches** from the staff app (personal device with app PIN), a shared kiosk tablet (PIN + photo),
  QR at a work site, or external clock devices (biometric terminals via `integration` workflow `timePunches`, file or
  API); offline queue with idempotency; manual corrections need reason and supervisor approval.
- **WFM-R09** [MUST] **Timesheets** per employee and pay period: scheduled vs actual, exceptions (missed punch, late,
  early leave, unscheduled shift, no-show, unapproved overtime), supervisor approval; pay codes as rule-pack data
  (regular, overtime categories, public holiday worked, rest-day worked).
- **WFM-R10** [MUST] **Days-worked ledger** per employee per month (input to service charge): worked days from approved
  timesheets plus paid leave days and public holidays as the rule pack counts them; locked when the month's payroll
  inputs are approved; later corrections are adjustment lines in the next month with reason.

### 3.4 Leave

- **WFM-R11** [MUST] Leave types, accrual and evidence rules as rule-pack data (Maldives defaults `unverified`: annual,
  sick, maternity, paternity, family responsibility, religious pilgrimage, unpaid, compensatory off, contractual home
  leave); balances; requests in the staff app → approval → roster blocks; balances imported at onboarding; leave
  liability (days × cost band) for an accounting accrual [SHOULD].
- **WFM-R12** [SHOULD] Expatriate home-leave and air-ticket entitlements from contracts, with booking reference and cost
  (supplier voucher in `accounting`).

### 3.5 Staff accommodation (`workforce.housing`)

- **WFM-R13** [MUST] **Staff village**: buildings (on the resort island, a staff island, Malé apartments), rooms, beds
  (category by gender/seniority policy, amenities), **allocations** to employees or to visitors/contractors with dates —
  no overlapping allocations per bed (database exclusion constraint); move-in/out checklist (keys, linen issued from
  `stock`); capacity planning (beds vs headcount incl. joining expatriates, seasonal staff and contractors); housing
  issues become `operations` work orders and cleaning tasks (location = building/room, CR-16); metered utilities per
  building from `utilities` for cost allocation and concessionaire recharges.
- **WFM-R14** [MUST] Staff housing is **never** accommodation inventory: staff beds never appear in availability, the
  Timeline, occupancy statistics or guest reports.

### 3.6 Staff meals

- **WFM-R15** [SHOULD] Staff canteen: expected meals per service from roster and housing (who is on the island), actual
  counts (badge/QR scan or headcount), meal cost from issues to the staff canteen store (`stock`) → cost per meal →
  allocation by department headcount (accounting allocation journal; USALI-aligned employee-meal treatment, STK-R11);
  concessionaire staff meals counted for recharge (CNC-R02).

### 3.7 Training and certifications

- **WFM-R16** [MUST] **Certification catalogue** (data): kind, issuing body, validity, verification method, required for
  (positions, shift types, resort activity kinds) — e.g. dive instructor levels, emergency first response, lifeguard,
  boat skipper licence, food handler, fire safety (issuing authorities in the Maldives `unverified`). Employee
  certifications with document, expiry and verifier; alerts at 90/60/30 days; an employee without a valid required
  certification **cannot be rostered** to that shift or assigned to that activity session (override ⚑, logged).
- **WFM-R17** [SHOULD] Training sessions (internal/external) with attendance and a mandatory-training matrix per
  department; learning content stays in an LMS (integrate).

### 3.8 Expatriate compliance — Maldives Xpat (`workforce.compliance`)

- **WFM-R18** [MUST] Per employer legal entity: **quota pool** (job categories × approved slots; quota fee per slot per
  12 months), slot allocation to employees; per expatriate: work permit (number, issue/expiry, job category, work
  site), **monthly work-permit fee** schedule with paid-until and payment references (supplier vouchers to the
  ministry), work-permit entry pass, **work visa deadline** (to be obtained through the Xpat system within 15 days of
  arrival — tracked from the recorded arrival date), passport expiry, medical, insurance (requirement `unverified`).
  Fee amounts are effective-dated data with sources (current summary: quota fee MVR 2,000 per slot per 12 months, work
  permit fee MVR 350 per month — Sources). An employer **compliance dashboard** shows expiries in 30/60/90 days, overdue
  fees (the ministry has suspended access to the Xpat system for non-payment — Sources), unused or over-allocated
  slots.
- **WFM-R19** [MUST] **No Xpat interface**: for each Xpat action (quota request, permit, renewal, visa, cancellation on
  separation) Portico prepares the data and document checklist; a licensed Xpat user performs it on the portal (the
  regulation requires active users to be licensed after an Employment Intermediary course — Sources) and records the
  outcome and reference. Any future interface is a `government.submit` effect needing owner authorization.
- **WFM-R20** [MUST] **Expatriate separation checklist**: permit cancellation, final fees, housing check-out, return
  ticket, access revocation, document return — each with owner and due date.

### 3.9 Service-charge distribution (`workforce.serviceCharge`)

- **WFM-R21** [MUST] Monthly **distribution run** per scope (legal entity or property, policy) and period:
  1. **Pool** from `finance` (CR-11): service charge **posted** with service dates in the period, by **collection
     currency**, net of adjustments and write-offs; the **collected** basis (payments allocated to service-charge
     components) is computed alongside and the difference shown (which basis the law requires — Q103).
  2. **Administrative deduction**: policy value ≤ the rule-pack maximum (current summary: at most 1% of the service
     charge collected per month — Sources).
  3. **Eligible employees** per rule pack and policy (non-discrimination; whether temporary and agency staff are
     included follows the law — the pending amendment would extend it — Q103).
  4. **Formula**: share by **days worked** (default; the Regulation summary ties each share to the employee's days
     worked over all employees' days, paid leave and holidays counting as worked) or **equal shares** (policy) — both
     data.
  5. **Rounding**: half-up per employee in minor units; residual assigned deterministically (largest remainders) and
     shown.
  6. **Currency**: pools per collection currency; **payout currency** per property policy — `collection_currency`
     (default; compatible with the amendment accepted by Parliament in April 2026), `functional`, or `mvr_at_rate` with
     employee consent records (Q103).
- **WFM-R22** [MUST] Run lifecycle `draft → calculated → reviewed (HR) → approved (finance; approver ≠ calculator) →
  exported → paid → closed`; recalculation creates a new version; an approved run never changes — corrections are
  adjustment lines in the next run with reason.
- **WFM-R23** [MUST] **Journal**: approval calls `finance.allocateServiceChargeFund` (CR-11): Dr service charge payable
  (pool) / Cr administrative-deduction income / Cr service-charge distribution clearing (key `scdist:{runId}`). The
  imported payroll journal clears the clearing account (ACC-R07); a non-zero clearing balance after payroll is a close
  exception (ACC-R27).
- **WFM-R24** [MUST] **Evidence pack** per run (inputs, rule-pack version, formula, per-employee calculation,
  approvals, payment confirmation) retained for the Labour Relations Authority; due-date tracking (distribution before
  the end of the following month per the Regulation summary) with an exception when at risk; each employee sees their
  own amount and how it was computed in the staff app.

### 3.10 Payroll boundary — inputs out, journal back

- **WFM-R25** [MUST] **Payroll input export** per pay period and payroll-provider profile (generic CSV first; provider
  formats as connectors; workflow `payrollInputs` — CR-18): employee mapping (kind `employee`), hours by pay code,
  overtime, leave taken (paid/unpaid), days worked, **service-charge amount per currency**, staff deductions (outlet staff
  charges, advances — from source events), joiners/leavers/changes; approval before export (SoD); batches idempotent and
  versioned; exports contain **no salaries, bank accounts or identity numbers** (WFM-I08).
- **WFM-R26** [MUST] **Payroll journal check**: when `accounting` imports the provider's payroll journal (gross by
  department, employer pension, employee withholding tax, deductions, net pay, service charge), workforce compares
  headcount and service-charge amounts with the approved run and raises an exception for any difference.
- **WFM-R27** [MUST] The boundary decision and its trade-offs are recorded in §15 and Q101; a change of decision is an
  owner decision, not an engineering one.

### 3.11 Labour analytics

- **WFM-R28** [SHOULD] Hours per occupied room, attendant productivity (with `operations`), covers per labour hour,
  overtime %, absenteeism, turnover, expatriate ratio, certification compliance %, labour cost % from cost bands
  (estimate) or from imported payroll journals (actual) — the source is labelled.

## 4. Entities and states

`employee(id, number, user_id?, legal_entity_id, property_id, department_id, position_id, type, status, cost_band_id,
enc_identity jsonb, version)` UNIQUE (organization, user_id) · `employee_document(employee_id, kind, enc_file_ref,
number_enc?, expires_at)` · `position(id, department_id, budget_headcount)` · `labour_standard(department_id, task,
minutes, driver)` · `requirement(property_id, date, department_id, shift, hours, explanation jsonb, forecast_ref)` ·
`shift_template` · `roster(id, property_id, period, version, status)` · `assignment(roster_id, employee_id, shift,
starts_at, ends_at, station, override_ref?)` · `swap_request` · `punch(id, employee_id, at, source, device_id,
idempotency_key)` · `timesheet(employee_id, period, lines jsonb, status)` · `days_worked(employee_id, month, days,
locked)` · `leave_request` · `leave_balance` · `housing_building/room/bed` · `bed_allocation(bed_id, occupant_ref,
during tstzrange, EXCLUDE overlap)` · `meal_count` · `certification_kind` · `employee_certification(employee_id, kind,
expires_at, verified_by)` · `quota_slot(legal_entity_id, category, fee_paid_until)` · `work_permit(employee_id, number,
expires_at, fee_paid_until, visa_due_at?)` · `sc_run(id, scope, period, version, pool jsonb, deduction, formula,
status, approvals)` · `sc_line(run_id, employee_id, days, share jsonb)` · `payroll_export(id, period, profile, version,
status, file_ref)` · `rule_pack(country, version, rules jsonb, source jsonb, verified_at?)`.

**Employee:** `onboarding → active ⇄ on_leave` · `active → suspended → active` · `active|on_leave → leaving → separated`.
**Roster:** `draft → published → (new version) published` · `published → locked` (after timesheets approved).
**Timesheet:** `open → submitted → approved → exported` · `submitted → returned → submitted`.
**Leave request:** `requested → approved | declined` · `approved → cancelled` (before start).
**Bed allocation:** `planned → occupied → vacated`.
**Work permit:** `applying → active → expiring → renewed | cancelled | expired`.
**Service-charge run:** `draft → calculated → reviewed → approved → exported → paid → closed` · `calculated|reviewed →
superseded` (new version).

## 5. Invariants

- **WFM-I01** At most one active employment per (person, legal entity); a user links to at most one employee per
  organization.
- **WFM-I02** A bed never has overlapping allocations.
- **WFM-I03** Published roster versions are immutable; every change is a new version with a diff.
- **WFM-I04** No assignment requires a certification the employee lacks on that date, unless an override with an
  approver exists.
- **WFM-I05** Per run and currency: Σ employee shares + administrative deduction = pool exactly (residual assigned);
  deduction ≤ rule-pack maximum; every eligible employee in scope has a line (zero only with a reason).
- **WFM-I06** An approved run's lines are immutable; the fund allocation posts exactly once (`scdist:{runId}`).
- **WFM-I07** Days worked per employee and month ≤ calendar days; locked months change only through next-month
  adjustments.
- **WFM-I08** No payroll export, event payload or analytics fact contains salaries, bank accounts or identity numbers
  (static schema test + payload test).
- **WFM-I09** A separated employee's user has no active role assignment after the separation effective time.
- **WFM-I10** Each punch applies at most once; corrections carry reason and approver.
- **WFM-I11** Staff housing never contributes to accommodation availability or occupancy statistics.

## 6. Cross-module interactions

Calls `identity` (users, role templates, revocation), `platform` (legal entities, departments, data authority
`staffRecords`/`timeAttendance`), `finance` (`getServiceChargePool`, `allocateServiceChargeFund` — CR-11), `analytics`
(forecast drivers — read), `operations` (`createTask`/work orders for housing), `stock` (canteen cost — read),
`integration` (`timePunches`, `payrollInputs`, `staffRecords` mirrors). Called by `resort` (`findQualifiedStaff`,
assignments), `accounting` (payroll-journal check result), `concessions` (meal and housing recharge quantities).
Dependency arrow (proposed): `workforce ─► identity, platform, finance, analytics, operations`.

## 7. Events

`workforce.employee.hired|changed|separated` · `workforce.roster.published|changed` · `workforce.shift.swapApproved` ·
`workforce.timesheet.approved` · `workforce.leave.approved` · `workforce.certification.expiring|expired` ·
`workforce.permit.expiring|feeOverdue|visaDue` · `workforce.housing.allocated|vacated` ·
`workforce.serviceChargeRun.approved|exported|paid` · `workforce.payrollInput.exported`.
Consumed: `identity.membership.removed`, `resort.session.staffRequested`, `accounting.journal.posted` (payroll
journal), `fnbPos.check.closed` (staff charges, LATER), `platform.dataAuthority.changed`.

## 8. Permissions

`workforce.employee.read` · `workforce.employee.manage` ⚑ · `workforce.document.read` ⚑ · `workforce.costBand.manage` ⚑
· `workforce.roster.read` · `workforce.roster.manage` · `workforce.roster.publish` · `workforce.shift.swapApprove` ·
`workforce.time.punch` · `workforce.time.correct` · `workforce.timesheet.approve` · `workforce.leave.request` ·
`workforce.leave.approve` · `workforce.housing.manage` · `workforce.certification.manage` ·
`workforce.assignment.override` ⚑ · `workforce.compliance.manage` ⚑ · `workforce.serviceCharge.calculate` ·
`workforce.serviceCharge.approve` ⚑ · `workforce.serviceCharge.readIndividual` ⚑ · `workforce.payroll.export` ⚑ ·
`workforce.rulePack.manage` ⚑ (org) · `workforce.report.read`.

## 9. UX surfaces

- **Roster board** (department × day grid; requirement vs scheduled hours with explanations; rule violations inline;
  qualification chips; cost-band estimate).
- **Staff app**: my shifts, punch, leave, swap, housing, my service-charge statement, certifications expiring.
- **HR workspace**: joiners/leavers, expiring documents and permits, fee due dates, housing capacity, timesheet
  exceptions.
- **Compliance dashboard** (Xpat): slots, permits, visas due within 15 days of arrival, overdue fees, Xpat action
  checklists with recorded references.
- **Service-charge run**: pool by currency with posted vs collected basis, deduction, formula, per-employee lines with
  explanation, approvals, evidence pack download.
- **Staff village**: building/room/bed map, allocations timeline, issues.

## 10. Proof scenarios and evidence

| ID | Workforce must demonstrate |
|---|---|
| B01 (supporting) | Payroll journal imported and service-charge clearing zero before soft close. |
| B15 | October run: USD and MVR pools, 1% deduction, days worked incl. leave, a mid-month joiner and leaver; approval posts the fund allocation once; payroll journal clears it; evidence pack complete. |
| B16 | A lifeguard's certification and an expatriate's work permit expire: roster blocks the pool shift, dashboard and alerts show owners and due dates, override needs approval. |
| S17 / E09 (supporting) | Employee documents and service-charge lines are invisible without the field-level permissions and to other tenants. |

## 11. Maldives specifics

- **Expatriate employment** (verified 2026-11-07 via search-indexed summaries — Sources): employer obtains a quota, then a
  work-permit entry pass for workers coming from abroad, and the work visa through the Xpat system within 15 days of
  arrival; quota fee MVR 2,000 per slot per 12 months (instalments possible); work-permit fee MVR 350 per employee per
  month; Xpat active users must be licensed; unpaid fees have led to suspension from the Xpat system. The ministry
  responsible has changed names over time — the rule pack records the source and date.
- **Service charge** (Sources): tourism establishments levy at least 10%; Regulation on Service Charge (2021/R-41) allows
  at most a 1% administrative deduction from the service charge collected per month; distribution by days worked
  (paid leave and holidays counted) per a law-firm guide, while press describes equal distribution — Portico supports
  both and defaults to days worked; distribution before the end of the following month; non-discrimination. An
  Employment Act amendment requiring payment in the **currency collected** was accepted by Parliament in April 2026 and
  sent to committee; enactment was **not found** as of 2026-11-07. Some resort groups moved service-charge payments to
  MVR in January 2026; an MP and resort owner warned that changing the currency without employee consent could raise
  legal issues. Hence pools per currency and payout currency as policy (Q103).
- **Payroll side facts for the boundary** (Sources): employee withholding tax is filed on MIRA 601 by the 15th of the
  following month, computed on remuneration after the employee's pension contribution, prepared in USD by employers whose
  functional currency is not MVR; pension contributions are 7% employer and 7% employee (secondary source). These sit
  with the payroll provider.
- Staff live on the island: housing capacity, canteen counts and transport between islands are operational constraints
  of rostering, not HR afterthoughts.

## 12. Competitive inspirations

Operations already uses Stayntouch-style points and expected minutes (research 02 §4.3) — the same standards drive
labour requirements, so housekeeping planning and rostering never disagree. No incumbent PMS researched combines
service-charge distribution with the ledger; Portico computes it from the posted service charge (`docs/readiness/
market-matrix.md` §2.4 previously excluded this — CR-28).

## 13. Open questions

Q101 (payroll boundary), Q102 (pay-related data in Portico vs IDN-R13), Q103 (service-charge basis, eligibility,
payout currency), Q106 (employment rule pack values for the adviser).

## 14. Adoption modes

- **Standalone alongside an external PMS:** **yes** (proposed SM-14 Workforce — CR-27): rostering, attendance, housing,
  certifications and Xpat compliance need no PMS; forecast-driven requirements need the PMS reservation mirror
  (`reservations: read`) or are shown as `incomplete`; service-charge distribution needs the service charge from the
  ledger — with an external PMS, from its revenue journal (ACC §14) or an imported service-charge report (labelled
  `external`).
- **Hard dependencies:** `platform`, `identity`; `finance` for service charge; `integration` for payroll and clocks.
- **Connected mode:** `staffRecords` external (HRIS is authoritative — CR-12): employees mirrored read-only with mapping
  kind `employee`; Portico-owned data (rosters, housing, certifications) attaches to mirrored employees.
  `timeAttendance` external (clock system authoritative): punches and leave mirrored; Portico rosters forwarded where
  supported.
- **Data-authority domains:** owns proposed `staffRecords` and `timeAttendance` when authoritative; respects `charges`
  (service charge is read, never written by workforce).
- **Trial:** copied employees with identity numbers masked; no payroll export leaves the environment; staff notifications
  simulated.

## 15. Boundary — payroll trade-offs and integrate-instead

| Factor | Build payroll in Portico | Export to a payroll provider (**default**) |
|---|---|---|
| Statutory calculation (EWT brackets after pension, 7%/7% pension, annual reconciliation, currency rules, future amendments) | Portico must track and certify law changes per country; liability for wrong pay | Provider's responsibility; Portico supplies exact inputs |
| Data sensitivity (salaries, bank accounts) | Expands security scope; conflicts with IDN-R13 "salary-like data never stored" | Stays out of Portico |
| Multi-country groups (Maldives, Sri Lanka, India, UAE) | One engine per country | One provider per country |
| Salary payment execution | Bank integration needed | Provider or hotel bank |
| Service charge (Portico data) | Native | Computed and approved in Portico, exported as an earning line — nothing lost |
| Rosters, attendance, leave | Native | Native in Portico, exported |
| One system for the hotel | Fewer systems | One more system; consistency proven by the payroll-journal check (WFM-R26) |
| Time to first pilot | Months plus adviser sign-off | Weeks |

**Revisit triggers:** discovery (Q64) shows Maldivian hotels lack adequate payroll providers or pay heavily for them,
or the owner wants a Maldives payroll pack as a differentiator — then a separate decision with adviser sign-off (Q101).

| Capability | Decision |
|---|---|
| Recruitment/ATS, performance management, LMS content, benefits administration | **Integrate** |
| HRIS as employee master (groups with an HR system) | **Coexist** (mirror `staffRecords`) |
| Biometric clocks | **Integrate** (`timePunches`) |
| Xpat portal, LRA filings | **Manual**, references recorded; interface only with owner authorization |

## Sources (verified 2026-11-07 via web search; Maldivian pages read through search-indexed content — direct fetches
of `.mv` hosts were blocked in this session)

- Xpat system, quota and permit fees, licensed users: [Regulation on Foreign Employment (PDF)](https://trade.gov.mv/wp-content/uploads/Regulation-on-Foreign-Employment.pdf);
  [CTL Strategies — Regulation on Employment of Expatriate Workers](https://www.ctlstrategies.com/latest/regulation-on-employment-of-expatriate-workers/);
  suspensions for unpaid fees: [Corporate Maldives](https://corporatemaldives.com/?p=70395).
- Service charge: [Regulation on Service Charge (PDF)](https://trade.gov.mv/wp-content/uploads/Regulation-on-Service-Charge.pdf);
  [LRA — Service Charge Regulation gazetted](https://lra.gov.mv/?p=3156);
  [CTL Strategies — Service Charge Guide (PDF)](https://www.ctlstrategies.com/wp-content/uploads/2021/04/20210329_Service-Charge-Guide.pdf);
  amendment accepted by Parliament: [Atoll Times](https://atolltimes.mv/post/business/15673);
  resort group paying in MVR: [Edition.mv](https://edition.mv/business/47489);
  currency and consent warning: [Atoll Times](https://atolltimes.mv/post/business/12650).
- Employee withholding tax: [MIRA — How to file EWT return](https://www.mira.gov.mv/Pages/View/ewtfile),
  [MIRA — How to compute EWT](https://www.mira.gov.mv/Pages/View/ewthowto); pension 7%/7% (secondary):
  [Maldives Pension Administration Office — members FAQ](https://old.pension.gov.mv/en/faq/members).
