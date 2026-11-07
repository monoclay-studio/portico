# Success metrics: baselines and testable targets

> Deliverable 10 (adoption brief §14; product brief §15 on usability evidence). Status date: 2026-11-07.
> **Every number labeled TARGET is a proposed target, not a result.** Portico has no measured baseline yet
> (nothing is built beyond the foundation). Competitor figures are cited with their evidence labels and are
> mostly vendor claims; they are references, not proof.

## 1. Rules for every metric

1. **No speed by cheating.** A metric improvement does not count if it was achieved by hiding or deferring
   errors, weakening permissions or approvals, skipping or loosening reconciliation, auto-accepting mappings that
   require review, or excluding failed and abandoned attempts from the denominator. Each speed metric has paired
   quality guardrails (below); a release that improves speed while a guardrail worsens is a regression.
2. **Measured from events, not self-report.** Timings come from product events (e.g. `connection.setup.step_completed`)
   or observed sessions; surveys only supplement.
3. **Real people and realistic workloads.** Usability metrics use actual hotel staff in their roles; until a pilot
   exists, results with proxy participants (people with hotel experience) are labeled **proxy** and never
   presented as hotel validation (CLAUDE.md §7).
4. **Report medians and p90**, with sample size and date. Small samples are labeled as such.
5. **External waiting time is separate.** Time spent waiting for a vendor, OTA or hotel decision is reported
   separately from time under Portico's control, so neither hides the other.

## 2. Representative workloads (assumptions for test data)

| Workload | Units | Stay history | Future stays | Guest profiles | Daily volumes | Peak |
|---|---|---|---|---|---|---|
| RS-1 guesthouse | 12 | ~3,000 (3 years) | ~150 | ~4,000 | ~5 bookings, ~20 messages | 10 OTA messages in 1 minute |
| RS-2 resort | 120 villas | ~16,000 (3 years) | ~1,500 | ~40,000 | ~40 bookings/modifications, ~300 POS postings, ~60 transfers legs | 50 OTA messages/min; 30 POS postings/min at dinner |
| RS-3 group | 3 × ~150 rooms | read from OPERA | read from OPERA | read from OPERA | ~1,200 room-status changes/day across the group | 200 status changes in 15 min after morning departures |
| Enterprise scale test | 50 properties | — | — | — | Synthetic multi-property load per operational-readiness brief §19 | — |

Volumes are planning assumptions derived from room counts and typical stay lengths; they are replaced by real
figures when a pilot hotel provides data.

## 3. Metrics

### M-01 Time to a useful demonstration

- **Definition:** from first visit to the demo entry page until the visitor completes one guided role task with
  sample data (e.g. "check in today's arrival").
- **Baseline:** Portico none. Competitors: most tested vendors are quote-only with sales-led demos
  (Cloudbeds, Mews, RoomRaccoon — research 02/03) [V r02, 3P r03]; a self-serve figure has not been measured.
- **TARGET:** median ≤ 5 minutes; no sales contact required.
- **Method:** product analytics on demo sessions; 10 moderated sessions per segment.
- **Guardrail:** ≥ 90% of moderated participants correctly answer "is any of this data real?" (label comprehension).

### M-02 Time to first successful connection

- **Definition:** from selecting a provider (setup step 1) to the first validated exchange (validation run passed).
  Active hotel staff time and elapsed time reported separately; vendor waiting time reported separately.
- **Baseline:** Portico none. Reference: Expedia's Autonomous Onboarding for properties already on a connected
  PMS/channel manager: under 24 hours [V2 r04]; OHIP streaming requires Oracle Professional Services enablement
  per environment [V r01] (vendor wait).
- **TARGET:** active staff time median ≤ 30 minutes for P0 API connectors once vendor prerequisites are met;
  for file imports (RS-1), ≤ 30 minutes from upload to a validated import preview.
- **Method:** setup step events; moderated sessions with integration administrators.
- **Guardrail:** 0 activations with an unreviewed financially significant mapping; validation must have passed.

### M-03 Staff time required for setup

- **Definition:** total hotel staff hours (all roles) from project start to go-live readiness, excluding
  training (M-08). Monoclay onboarding hours tracked alongside (cost driver for M-11).
- **Baseline:** Portico none. References: Cloudbeds guided onboarding 2–4 weeks, 3–4 calls [V r03]; RoomRaccoon
  28-day standard implementation with daily cohort sessions [V r03]. These are elapsed times, not staff hours.
- **TARGETS:** RS-1 ≤ 6 hours; RS-2 ≤ 120 hours across roles; RS-3 ≤ 32 hours for the first property and ≤ 16
  hours for each further property (SM-01 + SM-04 + SM-05).
- **Method:** time logged per checklist task (in product) plus onboarding lead's log.
- **Guardrail:** reconciliation and sign-off steps cannot be skipped (they are mandatory states).

### M-04 Percentage of mappings suggested correctly

- **Definition:** for each entity kind, share of suggestions accepted unchanged by the reviewer (precision), and
  share of entities that received a suggestion (coverage).
- **Baseline:** none; competitors' figures unknown.
- **TARGETS:** unit types and units: precision ≥ 95%, coverage ≥ 90%; rate plans: precision ≥ 80%; charge
  codes, tax codes and ledger accounts: precision ≥ 70% (these are always reviewed regardless).
- **Method:** computed from `integration.mappings` (status, confidence, reviewer changes) across rehearsals.
- **Guardrail:** mandatory-review rules unchanged (lifecycle spec §3.2); measured precision of `high`-confidence
  suggestions ≥ 98% or the threshold is raised.

### M-05 Time to complete a migration rehearsal

- **Definition:** from receipt of a complete source export to a signed-off reconciliation report.
- **Baseline:** none. Reference: Cloudbeds sells reservation import separately [V r03] (cost, not time).
- **TARGETS:** RS-1 ≤ 1 business day; RS-2 first rehearsal ≤ 5 business days, each repeat ≤ 1 business day.
- **Method:** import job timestamps.
- **Guardrail:** all thresholds in [migration-acceptance-criteria.md](migration-acceptance-criteria.md) §6 met.

### M-06 Migration exceptions and reconciliation accuracy

- **Definition:** open exceptions as a share of source records; unexplained financial differences.
- **TARGETS:** 0 unexplained financial differences (to the minor unit); 0 silently dropped records; after the
  final rehearsal ≤ 0.5% of records with open non-blocking exceptions and 0 blocking.
- **Method:** reconciliation report and import record states.
- **Guardrail:** "accepted as loss" items reported separately and signed by the hotel decision-maker.

### M-07 Time to first operational value

- **Definition:** from trial start (or, for connected mode, from vendor access granted) to the first real
  operational outcome in scope: first room status confirmed in the PMS through Portico (RS-3); first guest
  conversation handled in Portico; first OTA booking received and visible (RS-1). For trials: first time the
  hotel sees its own data in Portico.
- **Baseline:** none. References: Cloudbeds go-live in week 4 [V r03]; Duetto RMS ~3.5 weeks from PMS
  integration [V r03].
- **TARGETS:** own data visible in a trial ≤ 1 business day; RS-3 first confirmed room status ≤ 5 business days
  after OHIP access; RS-1 first live booking ≤ 3 business days from production authorization, excluding OTA
  activation waiting time.
- **Guardrail:** pilot scope and approvals in place before any live effect.

### M-08 Training time by role

- **Definition:** time until a staff member completes the role's scenario checklist unaided with at most one
  error (checklists from the product brief §17 scenarios relevant to the role).
- **Baseline:** Portico none. Reference: OPERA Cloud reviewers report a new front-desk agent cannot learn it in
  one shift [V r01, Capterra].
- **TARGETS:** front desk agent ≤ 2 hours; housekeeper ≤ 20 minutes; housekeeping supervisor ≤ 1 hour; night
  manager (Day Close) ≤ 1 hour; finance user ≤ 4 hours; integration administrator ≤ 2 hours.
- **Method:** moderated sessions; ≥ 5 participants per role per segment where available; record completion time,
  errors, unnecessary navigation, help requests (product brief §15).
- **Guardrail:** error rate on financial tasks does not rise as training time falls.

### M-09 Synchronization delay and failure recovery

| Workflow | TARGET (p95 unless stated) | Reference baseline |
|---|---|---|
| OTA reservation received by hub → applied in Portico | ≤ 60 s | — |
| Availability/rate change in Portico → accepted by hub | ≤ 120 s | SiteMinder asks PMSs to send ARI "ideally within 2 minutes"; channel rounds every 2 minutes [V r03] |
| Room status in Portico → acknowledged by external PMS (forward) | ≤ 30 s | — |
| External PMS change (stream) → applied in Portico | ≤ 60 s | OHIP streaming retains events 7 days [V r01] |
| POS posting → visible on folio | ≤ 10 s | — |
| Detection of a missed booking | ≤ 15 min (sweep interval) | — |
| Backlog cleared after provider recovery (RS-2 volume) | ≤ 15 min | — |
| Fault-injection suite (duplicates, reordering, outages, expired credentials) | **0** duplicate business effects; **0** lost updates | Operational-readiness brief §19 |

Method: exchange log timestamps (provider `occurred_at`, `received_at`, `applied_at`); nightly fault-injection
runs against simulators and sandboxes. Guardrail: freshness labels (`delayed`) must match measured age.

### M-10 Support requests per onboarding

- **Definition:** support contacts (tickets, chats, calls) from project start until 30 days after go-live, per
  property; share resolved by in-product guidance.
- **Baseline:** none. Reference: post-go-live support is a recurring complaint for Cloudbeds and RoomRaccoon
  [3P r03].
- **TARGETS:** RS-1 ≤ 3; RS-2 ≤ 30; RS-3 ≤ 8 per property.
- **Guardrail:** contacts are never discouraged or hidden (e.g. no forced bot-only path for urgent issues).

### M-11 Cost per connected property

- **Definition:** monthly third-party connectivity cost + attributable Monoclay infrastructure + onboarding and
  support labour, per property, for each representative setup. Hotel-paid vendor fees shown separately.
- **Baseline (planning):** Channex at US$130/month platform + US$7/property/month (owner brief §5, to
  re-verify) ⇒ at 50 properties ≈ US$9.60/property/month for distribution connectivity; OHIP partner fees
  ~US$10 per 10,000 REST calls and US$10 per 100,000 streamed events [V r01].
- **TARGETS:** RS-1: third-party connectivity ≤ US$12/property/month at 50 properties; RS-3: OHIP fees estimated
  per property from measured call/event volumes before pilot and kept ≤ the estimate +20%.
- **Method:** usage records per connection (`integration.usage_records`) and the cost model in
  `docs/readiness/` (readiness agent) — this metric consumes that model.
- **Guardrail:** reconciliation sweeps and health checks are not reduced to save API costs below the frequencies
  in the lifecycle spec §8.2.

### M-12 Rollout time across a hotel group

- **Definition:** for waves after Wave 0, properties reaching production activation per week per onboarding
  lead, and elapsed time per wave.
- **Baseline (vendor claims):** Shiji reports 100+ hotels for one group in two months, about 7 per day across 6
  waves [V r01, vendor claim]; Wyndham's OPERA Cloud rollout at "20 hotels a week" [V r01].
- **TARGETS:** connected-mode modules (RS-3 type): ≥ 3 properties per week per onboarding lead; full resort
  migrations: ≥ 1 per 2 weeks per lead; a wave of 5 similar properties completes within 4 weeks.
- **Guardrail:** RR-10 — every property passes its own validation and sign-off; no property inherits readiness.

## 4. Competitor comparison method

1. **Evidence classes:** documented (vendor docs, contracts), observed (our hands-on testing with a trial or
   sandbox account where terms allow), customer-reported (reviews, interviews). Each comparison states its class.
2. **Same task, same data size.** Compare on the representative workloads and the same scenario steps.
3. **Verdict:** *better* (our measured result beats the competitor's by more than 20% with equal or better
   guardrails), *comparable* (within ±20%), *behind* (worse by more than 20%), or *unknown* (no comparable
   evidence). A verdict without our own measurement is always *unknown*.
4. **Record** in a table per metric: competitor, figure, source URL, date, evidence class, our figure, sample,
   verdict. Reviewed quarterly.

### 4.1 Current comparison (2026-11-07)

| Metric | Reference figure | Source | Our result | Verdict |
|---|---|---|---|---|
| M-03/M-07 onboarding elapsed | Cloudbeds 2–4 weeks; RoomRaccoon 28 days | [V r03] | not measured | unknown |
| M-08 front-desk training | OPERA: more than one shift | [V r01] | not measured | unknown |
| M-09 ARI latency | SiteMinder ≤ 2 min ideal | [V r03] | not measured | unknown |
| M-12 group rollout | Shiji ~7 properties/day (vendor claim) | [V r01] | not measured | unknown |
| Ecosystem listing bar | Mews: certification + live pilot | [V r02] | program not built | unknown |
