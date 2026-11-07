# crm — 10x brief (feedback, reputation, recognition, consented marketing, vouchers)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3) · Spec `docs/specs/crm-marketing.md` (CRM-R01–R26) ·
Parity: **none** · Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel
staff.** Owner questions: Q82 review platforms, Q83 gift vouchers, Q87 loyalty.

## 1. Current state (evidence)

- **No `crm` module exists.** Foundations: guests' consent per purpose per legal entity with lawful-basis registry,
  duplicate scoring, reversible merges, recognition summary (partial), cross-property sharing with objection
  (README-guests R06, R09–R16); no comms channels yet (comms brief).
- **Gaps visible elsewhere:** external loyalty numbers on profiles (PAR-GUE-027 draft, missing), production statistics
  per company (PAR-GUE-035), guest-relations lists (PAR-GUE-070).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| CRM suites | Revinate, Cendyn (PE-backed, consolidating) | Marketing, reservation sales, guest messaging | DD02c §3 |
| Reputation | Shiji ReviewPro (sold with Daylight) | Review aggregation and replies | DD02c §3 |
| CDP around migrations | dailypoint (Motel One OPERA migration) | Profile clean-up during migration | DD02c §3; DG §2 crm row |
| Guest marketing on PMS data | Cloudbeds Signals | Causal-AI guest marketing | DD02b §3 |
| Bundled messaging | Mews OS | Guest messaging in the OS | DD02b §1.2 |

Research reading: for Portico, CRM depth is less a feature race than a **consented, unified guest profile that partners
can read** (DD02c §3).

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Segments with consent enforcement, suppression and fatigue rules | CRM-R01–R03 |
| 2 | Surveys after stay with alerts and same-day recovery (links to guest-services cases) | CRM-R08–R11 |
| 3 | Partner read API for a consented profile (keep an external CRM) | CRM-R26 |
| 4 | Review aggregation, replies and solicitation within platform rules | CRM-R12–R14; Q82 |
| 5 | Recognition tiers and benefits; external programme numbers | CRM-R16–R18; Q87 |
| 6 | Campaigns, lifecycle journeys, abandoned-booking recovery, attribution | CRM-R04–R07 |
| 7 | Gift vouchers as a tender with liability, expiry and fraud controls | CRM-R20–R25; Q83 |

## 4. The 10x outcome (TARGETS)

**Picture:** an unhappy survey answer at 10:00 becomes a case with an owner by 10:05 and a recovered guest before
checkout; a returning guest is recognised at every property that may see her — and no message ever reaches someone who
did not consent.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Marketing messages sent without a valid consent for that purpose and legal entity | 0 (enforced at send) |
| Seamless | Negative survey → owned case | ≤ 5 min, automatic |
| Friendly | Segment built by a GM without help | ≤ 5 min with a preview of count and consent coverage |
| Well-rounded | Coexistence with an external CRM via partner read API | tested with a simulator partner |

## 5. Next 3 increments

### Increment 1 — Consent-safe segments and suppression
- Segments over guests' profiles and stay facts with consent filtering per purpose and legal entity, suppression and
  fatigue rules, preview of counts; partner read API for consented profile fields (with integration's partner apps).
- **Acceptance:** CRM-R01–R03, R26 tested; a segment never includes a profile without consent (property test).

### Increment 2 — Surveys and same-day recovery
- Survey definitions, distribution through comms, alerts on thresholds creating guest-services cases, results with
  drill-down.
- **Acceptance:** CRM-R08–R11 tested; a detractor answer creates a case with owner within the SLA in tests.

### Increment 3 — Recognition and external programmes
- Recognition tiers and benefits applied at check-in and outlets, external programme numbers on profiles, review
  aggregation design behind Q82 (no platform access until approved).
- **Acceptance:** CRM-R16–R18 tested; benefits appear in the recognition summary with sources.

## 6. Cross-module dependencies and contract changes

**guests:** consent, profile reads, merges/unmerges propagated to CRM records. **comms:** channels, templates, quiet
hours, suppression. **guest-services:** cases from survey alerts. **analytics:** stay facts for segments and attribution.
**distribution:** abandoned-booking data from the booking engine. **finance:** voucher liability and breakage (Q83).
**integration:** partner read API.

## 7. Power check — never lose or hide

Consent is checked at send time, per purpose and legal entity; guest objection to sharing is respected; review replies
follow platform rules; vouchers are liabilities until redeemed; marketing never uses sensitive categories.
