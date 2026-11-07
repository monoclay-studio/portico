# Competitive synthesis

Status: v1 · 2026-11-07 · Sources: `docs/research/01-enterprise-vendors.md` (R01), `02-modern-cloud-vendors.md` (R02),
`03-smb-distribution-vendors.md` (R03), `04-connectivity-payments-compliance.md` (R04). Section references are to those
files. Evidence quality follows the research labels ([V] verified, [3P]/[VC] third-party/vendor claim, [I]/[INF]
inference); review samples are small and directional (R01 §0, R03 §0).

Competitor names are used here **only** for analysis. Portico's features use original names from the glossary.

**Honest starting point.** Portico has no customers, pilots, certifications, partner tiers or integrations in
production. Everything below labelled "how Portico does it better" is **design intent at readiness R1** until the
evidence described in `docs/scenarios/README.md` and the usability targets in `ux-principles.md` §19 exist.

---

## 1. Competitor by competitor

### Oracle OPERA Cloud
- **Real advantage:** a canonical operational and financial data model the industry has learned — business date and
  End of Day, folio windows and routing, transaction-code hierarchy with generated taxes, rate codes with packages and
  allowances, typed block statuses, AR/direct bill, fiscal partner framework — plus a labour pool trained on it
  (R01 §2.2, §1 "the data model is the moat").
- **What it does right:** completeness; restartable EOD with per-step status and automatic scheduler; OHIP REST +
  streaming with 7-day replay (R01 §2.4, §3.1).
- **Where it fails:** cannot be learned in one shift; click-heavy, crowded UI; slow on weak internet; uneven support;
  configuration needs specialists; global logout to roll the date; irreversible profile-sharing switch; streaming needs
  professional services (R01 §2.3, §2.6, §8).
- **Portico takes and improves:** concept-for-concept parity under original names (business date, Day Close, billing
  rules, charge codes with a single tax engine, packages/allowances, typed block statuses, receivables) — with a
  non-blocking Day Close and continuous exception queue (`day-close.md`), billing labelled by payer with a "who pays for
  what" preview (FIN-R13–R16), reversible profile sharing (GUE-R16), self-serve APIs and webhooks (INT-R26), and
  "productive in one shift" as a measured target (ux §19). An OPERA concept map in migration tooling (wave 2) lets
  OPERA-trained staff find every concept.

### Mews
- **Real advantage:** PMS + embedded payments + marketplace (1,000+ integrations), with automation that removes chores:
  no night audit, rate-group payment automation, VCC handling, payment requests (R02 §2.3).
- **What it does right:** approachable UI ("easy" for OPERA switchers), app-less guest portal and kiosk, Timeline with
  density modes and zoom, locked vs unlocked assignment (R02 §2.6–2.7).
- **Where it fails:** reporting; fee opacity and SaaS fee netted against payouts; silent automation failures and
  double-charge risk between payment links and automation; support responsiveness; weak events and complex resorts;
  late-outlet/over-short pain from midnight rollover; support-gated webhooks; tier gating on configuration counts
  (R02 §2.5–2.8).
- **Portico takes and improves:** payment automation through **collection plans with exactly one executor per item**
  (PAY-R20) so links and automation cannot double-charge; failures always become tasks (PAY-R22); pending verification
  as a first-class state (PAY-R13); Timeline as the primary view with previews on drag (ux §9); native reporting with
  definitions and drill-down (`analytics.md`); controlled Day Close instead of editable-history windows; self-serve
  webhooks; no limits on rates/connections/data history (`editions.md` §2); never net SaaS fees against hotel money
  (BIL, architecture rule 14).

### Cloudbeds
- **Real advantage:** PMS, channel manager, booking engine and payments on one inventory; linked dorm/private inventory
  (R03 §3.2).
- **What it does right:** "closes rooms across agencies automatically"; Last Room Available default with optional
  allotments; guided onboarding; AI over unified data (Signals) (R03 §3.1–3.6).
- **Where it fails:** post-go-live support; overbooking after sync failure with scripted answers; payment holds/fees;
  reservation import sold separately; quote-only pricing and surprise contract terms (R03 §3.4–3.7).
- **Portico takes and improves:** one inventory ledger shared by desk, booking engine and channels (INV-R09), composite
  units with exact availability for dorms and connecting units (INV-R05–R07), shared-pool allotment default
  (DST-R03); distribution health and recovery tools staff can act on (DST-R13); migration import always included
  (INT-R30, editions principle 1); published packaging without hidden terms (`editions.md`).

### SiteMinder (incl. Little Hotelier, Channels Plus)
- **Real advantage:** the largest channel network and the best-documented channel-manager mechanics; transaction
  revenue via payments and Channels Plus (R03 §4.1–4.3).
- **What it does right:** delta ARI with ≤ 2-minute rounds, full-replacement modifications with stable ids,
  ack-or-resend, backoff, no retry on payload errors, mapping completeness counters, delivery-timeout escalation,
  replay (R03 §4.3, §9.1).
- **Where it fails:** cost for small properties; billing during trial/after cancellation; bot-first support; accepts
  unmapped bookings without decrementing availability (R03 §4.4, §4.6).
- **Portico takes and improves:** the same message semantics (DST-R04–R11) with a ≤ 60 s target, **provisional holds**
  for unmapped bookings (DST-R10), field-loss diffs on modifications (RES-R30), parking of orphans (DST-R09), and a
  distribution health console (DST-R13). Aggregated single-contract distribution is a LATER partnership option
  (`distribution.aggregatedChannels`).

### Apaleo
- **Real advantage:** API-first openness and a real double-entry accounting core (receivable sub-account per
  reservation, deposit liabilities, business date vs posting date, scheduled audit) (R02 §3.2–3.3).
- **What it does right:** OpenAPI per bounded context, OAuth with consent screen, self-serve webhooks with wildcards,
  property clone/test/live/archive, derived-rate depth limit, integrity reports, first MCP server (R02 §3.6).
- **Where it fails:** hollow core — reporting/CRM pushed to marketplace, costly for small hotels; restrictions not
  inherited by derived plans (surprising); Adyen specifics leak into integrations (R02 §3.5, §3.7).
- **Portico takes and improves:** ledger-first finance with folios as projections (FIN-R01–R04), business date on
  every posting, integrity checks as Day Close step (DCL-R02); OpenAPI/OAuth/self-serve webhooks (INT-R26); explicit
  inheritance choices for derived plans (RAT-R04); a **non-hollow core** — reporting, messaging, housekeeping and
  payments native in every edition; PSP-agnostic payment API (PAY-R02).

### Stayntouch
- **Real advantage:** mobile/tablet-first operations — tablet front desk, mobile housekeeping with auto-assignment,
  forward planning and points, kiosk with ID scan and key encoding, upsell at every self-service touchpoint (R02 §4.3).
- **What it does right:** drag arrival/departure flags with safe validation; priority cleaning linked to early check-in
  (R02 §4.5).
- **Where it fails:** room diary "barely usable"; no "as-of" historical reports; no profile merge; inconsistent polish;
  auto-assign locks the whole diary; long payment onboarding (R02 §4.4, §4.6).
- **Portico takes and improves:** staff PWA built offline-first with explicit sync rules (OPS-R21–R23), forward
  planning and points (OPS-R05–R07), touch targets ≥ 44 px (ux §12); merge **and unmerge** (GUE-R11–R12); as-of vs
  restated reporting (ANL-R04); auto-assign that never locks a calendar (INV-R23).

### Shiji Daylight
- **Real advantage:** portfolio-first configuration (configure once globally, local setups allowed), single global
  guest profile, cloud-native event-driven platform, productized fiscal compliance, migration velocity (100+ hotels in
  two months) (R01 §5.2).
- **What it does right:** visible central configuration; webhooks/sandbox; integrated adjacent stack (R01 §5.6).
- **Where it fails:** "customization limitations" and bugs; thin review base; reporting immaturity (R01 §5.3).
- **Portico takes and improves:** policy inheritance with labelled local overrides, locks that never silently delete
  overrides, and a **change preview listing affected properties** (PLT-R25–R30); data-authority matrix so central teams
  see which system owns what per property (PLT-R35–R39); staged rollout groups and per-property activation
  (PLT-R14, R29).

### Agilysys
- **Real advantage:** the connected resort — PMS + POS + spa/golf/activities on one itinerary and one confirmation;
  guest-bookable package entitlements (S.P.E.N.D.); charge-to-room everywhere (R01 §6.2).
- **What it does right:** separate date roll from fiscal close with failure policies; ranked routing rules with
  percentage splits (R01 §6.5).
- **Where it fails:** no tier-2 support after hours; work lost during migration; several PMS codebases; NDA-gated APIs
  (R01 §6.3–6.4).
- **Portico takes and improves:** itinerary across transfers, dining, activities and stay with disruption cascades and
  owners (RST-R06, R10); allowances designed for guest visibility (RAT-R15, RST-R11); POS intake with balancing and
  idempotency (RST-R01); integrate best-of-breed spa/POS instead of building them. **Legal caution:** see §3 item 1 on
  ranked routing.

### Infor HMS
- **Real advantage:** casino/gaming integration and an early full-task iPad app; single-vendor enterprise stack
  (R01 §4.2).
- **What it does right:** post-departure charges without desk intervention; per-step EOD status report (R01 §4.6).
- **Where it fails:** multiple steps for common tasks; bugs after frequent updates and downtime; support during
  upgrades (R01 §4.3).
- **Portico takes and improves:** late charges handled by policy with collection follow-up (FIN-R25); Day Close step
  log (DCL-R03); release safety (rings, flags, release notes with opt-in windows — ux §16). Gaming/casino is out of
  scope for the Maldives launch.

### Guesty
- **Real advantage:** unified inbox, a well-designed two-level automation engine, owner accounting for property
  managers (R03 §6.2).
- **What it does right:** waiting/expired automation states, tag scoping, owner statements with review-before-send,
  payout reserve traceability (R03 §6.2, §6.4).
- **Where it fails:** large price increases and minimums; uneven support; repeated OTA sync incidents; destructive
  "unlist and relist" resync; automations not re-evaluated after modifications; reports not matching OTA payouts
  (R03 §6.3, §6.5).
- **Portico takes and improves:** automation with waiting/expired **and re-evaluation on change** plus idempotent steps
  (COM-R06); non-destructive resync tools (DST-R05, INT-R17); owner accounting as add-on (`owners.accounting`, LATER);
  payout reconciliation (PAY-R25).

### RMS Cloud
- **Real advantage:** flexible category/area inventory for parks and apartments, with typed constraints and explanations
  for visible-but-unbookable inventory; payment schedules at rate/payer level; RMS Pay optional but rewarding
  (R03 §7.2–7.3).
- **Where it fails:** configuration depth without guided defaults; site-map edits by support ticket; integrations
  connected only after go-live (R03 §7.4–7.6).
- **Portico takes and improves:** type-agnostic units and composites (INV-R01–R07), availability explanations
  (INV-R28), payment schedule templates (RAT-R20) executed by collection plans, guided setup with profile defaults
  (PLT-R35, `editions.md` §6), connections set up and validated **before** go-live (INT-R06).

### RoomRaccoon
- **Real advantage:** easy all-in-one for small independents with auto-pricing and upsell built in; fixed 28-day
  implementation ending at "first channel live" (R03 §5.2).
- **Where it fails:** mandatory house payments with high commissions; dynamic pricing gated to the top tier;
  unexpected gateway costs at go-live; weak support on complex issues (R03 §5.3–5.4).
- **Portico takes and improves:** pricing assistant in every edition (RAT-R31), payments optional and provider-agnostic
  (PAY-R03), costs visible before they are incurred (vision pillar 4), a clear onboarding finish line per property.

### Notable others
- **Hostaway** — unified inbox incl. WhatsApp, self-serve owner portal (R03 §8.1) → comms channels and owner portal LATER.
- **eZee Absolute** — low-cost bundles strong in South Asia/Middle East; weak revenue tools, hard migration away
  (R03 §8.2) → regional price competitor for guesthouses; Portico competes on clarity and trust, not lowest price.
- **protel (Planet)** — deep configurability, support complaints after acquisition (R03 §8.3).
- **Clock PMS+** — strong guest self-service and upsell in booking path (R03 §8.4) → guest journey later wave.
- **WebRezPro** — local support 7 days, no setup fees, tax-inclusive display (R03 §8.5) → support promise must be real
  (readiness §17).
- **Hotelogix** — multi-property central control for emerging markets (R03 §8.6).
- **Lighthouse, Duetto, IDeaS** — rate intelligence and RMS (R03 §8.7–8.9) → integrate via open ARI/forecast APIs
  (RAT-R32), don't compete on market data.
- **Channex** (hub, R04 §A8) — not a competitor but our planned distribution intermediary (D7).

---

## 2. The Portico synthesis — differentiators

Portico's competitive advantage is that **a property handles complicated operations with less effort, fewer mistakes,
better visibility and more confidence** (brief §1). Each differentiator below names the gap it closes (evidence) and
where it is specified. All are R1 until proven.

| # | Differentiator | Evidence of the gap | Where specified |
|---|---|---|---|
| D1 | **OPERA depth, one-shift learnability.** Every OPERA operational/financial concept has a Portico equivalent, reached through role workspaces and progressive disclosure, measured against "productive in one shift". | OPERA learning curve, click-heavy UI (R01 §2.3); depth vs ease trade-off across vendors (R02 §1). | all specs; `personas-and-workspaces.md`; ux §19 |
| D2 | **Truth markers everywhere.** Confirmed, pending, estimate, suggestion and provenance (external, delayed, copied, simulated) are visually distinct; "paid/synced/delivered" only on authoritative confirmation. | Mews silent VCC failures (R02 §2.5); channel outages shown as sync (R03 §3.6, §6.3); brief §3, §15. | ux §3; PAY-R13; INT-R22; DST-R14 |
| D3 | **Previews before consequences.** Every change touching inventory, money, guests, portfolio policy or system authority shows its effects first; stale previews never commit. | Brief §4, §13; OPERA routing without "who pays" preview (R01 §3.6). | RES-R11–R12; FIN-R15; PLT-R28, R37; ux §5 |
| D4 | **Ledger-first finance with exact reconciliation.** Real-time double-entry per legal entity; folios as projections; idempotent keyed postings; gapless fiscal series; integrity checks every Day Close. | Apaleo accounting core (R02 §3.3.6); OPERA EOD AR defects (R01 §3.1); payouts vs reports mismatches (R03 §6.5). | `finance.md`; DCL-R02 step 6 |
| D5 | **Day Close that never blocks and always resumes.** Continuous exception queue, keyed postings, no logout, per-step progress. | OPERA global logout and halts (R01 §3.1); Mews no-audit pain (R02 §2.6). | `day-close.md` |
| D6 | **Payments that cannot double-charge.** Collection plans with one executor per item, pending verification, re-validation after outages, provider-agnostic with external-terminal recording for markets without embedded acquiring. | Mews link/automation double-charge risk (R02 §2.5); Maldives Stripe uncertainty (Q2). | `payments.md` |
| D7 | **Distribution you can see and recover.** One inventory ledger, provisional holds for unmapped bookings, orphan parking, field-loss diffs, health console with non-destructive replay. | Overbooking-after-sync-failure is the most damaging SMB review theme (R03 §1, §12). | `distribution.md`, `inventory.md` |
| D8 | **Exact composite and linked inventory.** Multi-bedroom villas, connecting rooms and dorm beds with provably consistent availability and explanations of every number. | Cloudbeds linked-inventory trade-offs, RMS associated categories (R03 §3.2, §7.2). | INV-R05–R07, R28 |
| D9 | **Adoption as a ramp.** Demo → trial with copied data → read-only connection → one module → pilot → full platform, with data authority per domain preventing split-brain and every module's standalone dependencies documented. | Adoption brief §2–§4; dual-PMS hazard (R03 §3.3); support fading after go-live (R03 §12). | `platform.md` §3.9; `integration.md`; §14 of every spec; `editions.md` §5 |
| D10 | **Integrations described as workflows and set up by hotel staff.** Catalogue by read/create/update/receive and live/periodic/file, nine-step journey, mapping suggestions with mandatory finance review, self-serve webhooks. | Mews support-gated webhooks, OPERA PS-gated streaming, Agilysys NDA APIs (R02 §2.8, R01 §8). | `integration.md` |
| D11 | **Connected resort without owning every system.** Itinerary across transfers, dining, activities and stay; disruption cascades with owners; entitlement-aware outlet posting; POS intake with balancing. | Agilysys itinerary advantage (R01 §6.2); seaplane-driven operations (brief §12). | `resort.md` |
| D12 | **Portfolio control with visible local truth.** Policy inheritance, labelled overrides, change previews listing affected properties, reversible sharing, per-property activation. | Shiji configure-once (R01 §5.2); OPERA irreversible switches (R01 §2.4). | `platform.md` §3.7; GUE-R16 |
| D13 | **Mobile operations that are honest offline.** Offline-first staff app with explicit sync conflicts and freshness labels. | Stayntouch mobile strength; island connectivity; brief §8, §16. | OPS-R21–R23; ux §11 |
| D14 | **Native reporting with definitions, drill-down and restatements.** | Reporting is the #1 complaint at modern vendors (R02 §8 item 4). | `analytics.md` |
| D15 | **Fair, transparent packaging.** Never gate correctness or basics; no limits on rates, channels or data history; usage costs metered and capped; migration included. | Pricing opacity, renewal shocks, top-tier gating (R03 §12, §14 item 4; R02 §2.8 item 5). | `editions.md` |

What Portico deliberately does **not** try to win at launch: OTA partner-tier badges and direct certifications
(hub-first, D7), marketplace size, casino/gaming, market rate-shopping data, enterprise brand-mandated PMS lists
(R04 §D2, Key decision 11).

---

## 3. Legal and compliance caution items (for review — no legal conclusions)

1. **Billing-rule precedence and a patent application.** R01 §6.5 notes Agilysys US patent application 2017/0124610 on
   evaluating charges against **ranked** routing rules and processing per destination folio payment method, and advises a
   freedom-to-operate check. Portico's finance spec avoids ranked precedence (FIN-R14, non-overlapping rules) **until
   qualified counsel reviews the application** (OPEN_QUESTIONS **Q40**). We make no statement about validity, status or
   infringement.
2. **Trademarks in comparisons and migration tooling.** Names such as OPERA, Mews or SiteMinder may appear in migration
   importers ("import from …") and internal analysis; any public comparison, concept map or marketing use needs legal
   review for nominative use and comparative-advertising rules before publication.
3. **Comparative claims.** The adoption brief §1/§14 and vision forbid unsupported "market-leading" claims; any public
   "faster than X" claim requires recorded, reproducible evidence and legal review.
4. **Source-system data rights.** Exporting data from an incumbent system may be limited by that vendor's contract or
   terms; migration must establish what can legally be exported (adoption brief §10; INT-R29) per vendor and customer.
5. **Use of competitor documentation and interfaces.** Build only against documented, permitted interfaces and the
   hotel's authorized exports; no reverse engineering of proprietary protocols without legal clearance.
6. **Partner and certification claims.** No partner logos, certification badges or "integrates with" claims without
   evidence and permission (CLAUDE.md §7; readiness §10).

---

## 4. How to keep this current

Re-verify vendor facts before any external use (research tags [BK]/[I] are hypotheses). Add a dated entry when a
competitor ships something that changes a differentiator; record where Portico is **better, comparable or behind** from
practical testing (adoption brief §14).
