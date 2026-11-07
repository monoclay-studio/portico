# guests — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 1, R3) · Spec `docs/specs/guests.md` · Parity: draft only on
branch `docs/parity-ops` (`docs/parity/guests.md`, not on `main`) · Source key: `docs/strategy/gap-plan.md` §0.
**All targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **Built, R3**, 173 module tests + 6 HTTP tests, 5 consecutive green runs (README-guests § Capabilities): profiles
  with native-script names and ICAO transliteration, structured preferences, sensitive special needs (encrypted,
  audited), alerts, append-only notes, encrypted identity documents with blind indexes, consent per purpose per legal
  entity, companies/agencies with hierarchy and IATA check, `resolveProfile` strategies, duplicate scoring across
  scripts, merge with snapshots and **unmerge**, cross-property sharing with objection, data-subject export, erasure
  across all 19 tables with legal holds, connected-mode mirrored profiles.
- **Review:** two P0 privacy defects (erasure left PII; resolution bypassed sharing) and six P1s fixed with regression
  tests (REV-guests; README § Review fixes).
- **MUSTs still open:** R14 stay-history feeds (only `recordStayHistory` by reservations, primary occupant), R15
  service recovery and balance flags, R19 retention schedules beyond documents, R20 booking-code binding and p95 at
  1M profiles; E15 one-click restore; KMS cipher in production (README § Known gaps).
- **Parity (draft, parity-ops):** 34 P0 rows specified, 17 P1 missing (attachments, custom fields, ID scanning,
  protected/incognito profiles, company sub-types, production statistics per company, configurable match rules,
  merge blocking conditions, anonymization pre-checks, country privacy config, guest self-service edits, guest-
  relations lists, versioned company names/tax ids).
- **UX1:** guest record holds only name and VIP; "Edit — available when the guests module is connected"; phone search
  "+960"/"7712" finds nothing; selecting a live profile result does nothing; past and in-house guests not searchable
  (UX1 persona 1, 2).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Single profile across properties | Shiji Daylight | One global guest profile, portfolio-first | R01 §5.2 |
| Profile sharing control | OPERA | Deep but the sharing switch is irreversible | R01 §2.4, §2.6 |
| Duplicate handling | OPERA profile matching; Mews warns old profiles "pollute" data | Match on import; clean-up advice | DG §2 guests row; DD07 §5 |
| Merge | Most vendors merge; Stayntouch **cannot merge** duplicates | — | R02 §4.4 |
| Digital registration | OPERA 26.4 | Nationality-based e-forms, e-sign, purge-after-days | DD02a §1.2; DG #13 |
| AI recognition | OPERA 26.4 | AI reservation summary and profile summary at check-in | DD02a §1.3 |
| Consented profile for partners | CRM suites consolidating (Revinate, Cendyn, dailypoint) | Partners read a unified profile | DD02c §3 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases (draft ids) |
|---|---|---|---|
| 1 | Stay-history and spend feeds from reservations/finance/operations/comms events (R14) and recognition with service recovery and balance flags (R15) | "Recognise returning guests" is the module's promise | GUE-R14, R15 |
| 2 | Search reach: phone fragment any format, booking code binding, past stays | UX1 blocker for search | GUE-R20; UX1 top-20 #8 |
| 3 | ID/passport scanning (camera/desktop) populating profile and registration | Maldives registration per occupant (JG-13) | PAR-GUE-017; EC-GUE-028 |
| 4 | Protected and incognito profiles | Resorts host VIPs and celebrities | PAR-GUE-020, 021; EC-RES-045 |
| 5 | Merge blocking conditions and anonymization pre-checks (open AR, future stays, payer on bills) | Safe privacy and merges | PAR-GUE-042, 057; EC-GUE-005, 013, 015 |
| 6 | Company depth: sub-types (DMC, tour operator, wholesaler), production statistics, versioned legal names/tax ids | Maldives is DMC-heavy (contracting spec §1) | PAR-GUE-030, 035, 075; EC-GUE-035 |
| 7 | Guest-submitted data staged and merged with provenance (online check-in, portal) | Never ask twice | PAR-GUE-068, 069; EC-GUE-026 |
| 8 | Guest-relations lists (in-house VIPs, birthdays this week, returning guests arriving) | Daily work of guest relations | PAR-GUE-070 |
| 9 | Retention schedules per category; country privacy configuration | Privacy by design beyond documents | GUE-R19; PAR-GUE-059 |
| 10 | One-click restore of a wrongly edited preference/alert (E15) | Recovery | E15 |

## 4. The 10x outcome (TARGETS)

**Picture:** the desk agent types four characters of a surname or phone and lands on the right person, sees in one
line that this is her third stay, her husband is allergic to shellfish (acknowledged by the kitchen), there was a
broken AC last time and it was compensated — and no screen ever showed data the agent wasn't allowed to see.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | Duplicate pairs caught before creation (seeded test corpus incl. Cyrillic/Arabic/Han names, OTA proxy emails) | scoring built; no corpus metric | baseline to measure | ≥ 95% recall, ≤ 2% false-positive merges suggested |
| Powerful | Unmerge restores every linked record across modules | guests + ports | Stayntouch none (R02 §4.4) | 100%, incl. comms items (R12 gap) |
| Seamless | Find a guest by name/phone/email/code | partial | baseline to measure | ≤ 5 s, ≤ 2 interactions (UXP §19); p95 ≤ 300 ms at 1M profiles |
| Seamless | Fields re-typed at check-in for a guest who completed online check-in or stayed before | — | — | 0 |
| Friendly | Recognition summary visible at arrival, check-in, POS lookup and messaging | API only | OPERA AI summary at check-in (DD02a §1.3) | same 1-line summary on every surface, with sources |
| Well-rounded | Privacy operations (export, erasure, objection, retention) completed without engineering help | built (API) | — | 100% self-service by the data-protection role, each audited |
| Well-rounded | Profiles imported in a migration that are duplicates of each other | — | dirty profiles migrate intact elsewhere (DD07 §5) | duplicates scored and merged or archived **before** import (with migration) |

## 5. Next 3 increments

### Increment 1 — Feeds, recognition and search reach
- Consume `reservations.stay.*` (all occupant/booker/payer roles), `finance` posting events (spend per stay, once),
  operations service recovery and comms threads into history; recognition summary with service recovery and balance
  flags; bind the booking-code lookup; phone search by trailing digits any format; parity file moved to `main` and
  reconciled.
- **Acceptance:** GUE-R14, R15, R20 closed with tests (incl. out-of-order events ignored via `aggregateVersion`);
  p95 search measured on 1M synthetic profiles and recorded; UX1 search queries ("Kowal", "beck", "+960 7712") pass in
  an API test.

### Increment 2 — Safe privacy and merges
- Merge blocking conditions and anonymization pre-checks via ports (finance open AR/commissions, reservations future
  stays, payer on bills) with plain-language reasons; retention schedules per category as policy data; country privacy
  configuration (mandatory fields, purposes, retention); one-click restore of preference/alert edits (E15) without
  storing values in audit (keep the merge-record pattern).
- **Acceptance:** EC-GUE-005, 006, 013, 015, 016 tested; PAR-GUE-042, 057, 059 tested; E15 restore test.

### Increment 3 — Identity capture and protected guests
- Document capture (MRZ parse from a camera image or scanner text — images stored only when policy allows, Q43) feeding
  registration fields per occupant; protected profiles (restricted viewer list) and incognito alias used on lists,
  keys and messages; company sub-types and versioned legal name/tax id (past invoices keep old values); staged
  guest-submitted data with provenance for guest-experience.
- **Acceptance:** PAR-GUE-017, 020, 021, 030, 069, 075 and EC-GUE-024, 026, 028, 035 tested; no biometric matching
  (Q150).

## 6. Cross-module dependencies and contract changes

- **reservations:** all roles on stay events; booker history; occupant nationality/document per occupant (JG-13).
- **finance:** posting events with stay refs for spend; open AR/commission checks for merge/erasure; company AR
  vocabulary convergence (README-guests § Known gaps: commission model vs rates/reservations).
- **comms:** threads linked to profiles; unmerge covers comms items. **guest-experience:** staged submissions.
  **crm:** consented segments read from guests. **migration:** pre-import duplicate scoring API
  (`scoreCandidates(batch)` without creating profiles).
- **identity:** role templates need `guests.alert.manage`, `guests.company.read` for desk roles, and a data-protection
  role (FR-5).

## 7. Power check — never lose or hide

Merges stay reversible with full snapshots; sensitive data stays encrypted, masked by default and every reveal is
audited with a reason; sharing respects entitlement, policy and guest objection on every read path; property-private
data never crosses properties; mirrored profiles stay read-only for identity fields; erasure never breaks financial
retention; audit never stores personal values.
