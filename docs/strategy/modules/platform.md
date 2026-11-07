# platform — 10x brief

Status: v1 · 2026-11-07 · Gap strategist · Built (wave 0→1, R3); enterprise wave on branch
`feat/identity-platform-enterprise` (not merged) · Spec `docs/specs/platform.md` · Parity `docs/parity/platform.md` ·
Source key: `docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with hotel staff.**

## 1. Current state (evidence)

- **On `main` (R3):** organizations, environments (live/trial/training/sandbox/demo), brands/regions, properties with
  profile, timezone, currency and **business date** with advance, legal entities, plans and entitlements, policies with
  inheritance and preview, data authority per domain with `assertWritable` (STATUS § 3).
- **On the identity-plus branch (README-platform there):** editions incl. the Connect plan and module packs;
  property-scoped entitlement grants; owners and effective-dated unit ownership; outlets; configuration bundles with
  dry-run per property; rollout groups and approval with separation of duties; trial lifecycle (copied provenance,
  reset, export, close); property activation `setup → pilot → active` with a different approver; activation scope
  documents with `assertEffectInScope`; data-authority hardening (10th domain `guestCommunications`, `planned → frozen →
  effective` transitions, second approver for money/availability domains); `getPropertyFacts`. 62 platform tests there.
  **Merge blocked** by the identity P0 (REV-identity-plus-2).
- **Parity (main):** 28% tested/equivalent, 30 P0 open (environments as separate orgs, banner, trial copy, property
  facts incl. atoll/island, effective-dated tax classification, activation checklist, pilot scope enforcement,
  departments/outlets templates, policy catalog, downgrade read-only, Day Close timing, authority change preview and
  coherence rules, feature visibility combining entitlement + profile + authority, guided setup ≈ 8 steps); many are
  built on the branch but untested on `main`.
- **Not built:** usage meters, feature visibility, policy locks, profile layer, effective-dated classification;
  authority-transition preview per module (PLT-R37) and coherence rules (R38); trial purge job; launch-gate sign-off on
  production approval; `active → inactive` preconditions; platform records not yet in the universal record contract
  (README-platform § Known gaps, branch); `lockBusinessDate` for finance (PF).
- **UX1 persona 7:** no portfolio comparison, no policy centre with overrides (blocker), no Add property; raw Zod JSON
  on an empty property name with "Reload the page" advice; properties shown "not yet operating" while 106 guests are in
  house (simulated contradiction).

## 2. Best on the market today

| Area | Who does it best | How | Source |
|---|---|---|---|
| Portfolio configuration | Shiji Daylight | Configure once globally, local setups allowed; 100+ hotels in 2 months (vendor claim) | R01 §5.2; DD07 §1 |
| Release safety | OPERA | Features ship disabled behind OPERA Controls per property ("steps needed to enable") — safe but configuration-heavy | DD02a §1.1, §6 |
| Environments | Apaleo | Property clone / test / live / archive | R02 §3.6 |
| Standard shells | Oracle OCCS workbook; Mews property cloning (Ligula) | Pre-installation configuration; clone a property to roll out others | DD07 §1; DD02b §1.2 |
| Fair packaging | (anti-pattern) Mews tier limits on rates/connections/history; RoomRaccoon top-tier gating | Forces mid-life upgrades | R02 §2.8 #5; R03 §5.4 |

## 3. Gaps vs market (ranked)

| # | Gap | Why it matters | Parity rows / edge cases |
|---|---|---|---|
| 1 | Merge the enterprise wave once identity is safe; reconcile parity with the branch's tests | Half the module is unmerged | PAR-PLT-002, 006, 023, 024, 029 |
| 2 | Policy centre: catalog registered by modules, inheritance with highlighted overrides, locks, "where is this overridden?", previewed portfolio change (S16) | Group director blocker | PAR-PLT-038; EC-PLT-010; S16 |
| 3 | Guided setup by profile ending in a go-live checklist (guesthouse ≈ 8 steps); Add property; standard shells (guesthouse / resort / city) | Onboarding in hours, not weeks | PAR-PLT-060; DD07 §6 #3 |
| 4 | Authority change preview with module impact and coherence rules | Safe adoption ramp | PAR-PLT-056, 057; EC-PLT-014, 015, 016 |
| 5 | Feature visibility = entitlement × profile × authority; downgrade read-only | Progressive disclosure (brief §2) | PAR-PLT-021, 033, 035, 059; EC-PLT-021 |
| 6 | Effective-dated property classification (Green Tax tier) and property facts (atoll/island, arrival points, transport modes) | Maldives tax and transfers | PAR-PLT-018, 022, 026; EC-PLT-024 |
| 7 | Day Close timing policy and lag exceptions; `lockBusinessDate` | Day Close module | PAR-PLT-051, 052; EC-PLT-004, 005 |
| 8 | Change calendar per property: upcoming behaviour changes with previews and a defer window; feature adoption metric | Release safety beats OPERA Controls (DG §2 platform row) | DD07 §4 |
| 9 | Usage meters with caps and cost previews | Costs visible before incurred | PLT-R24; Q45 |
| 10 | Property sold to a new legal entity from date D | Ownership changes in resorts | EC-PLT-025 |

## 4. The 10x outcome (TARGETS)

**Picture:** a group director changes the cancellation policy for three islands, sees which properties keep a local
override and why, previews the effect and confirms knowingly; a guesthouse owner goes from sign-up to a sellable,
correctly taxed property in under an hour; no property ever gets a behaviour change it did not see coming.

| Dimension | Metric | Today | Market reference | Target |
|---|---|---|---|---|
| Powerful | P0 rows + P0 edge cases tested | 28% / 30 open | — | 100% |
| Seamless | Portfolio policy change with override visibility (S16) | not available | Shiji configure-once (R01 §5.2) | ≤ 3 interactions to preview; affected properties and overrides listed before commit |
| Seamless | Guesthouse from sign-up to first booking (demo) | — | RoomRaccoon fixed 28-day implementation (R03 §5.2) | ≤ 30 min, ≤ 2 help requests (UXP §19) |
| Seamless | New resort property from a standard shell to configuration review | — | OCCS workbook (DD07 §1) | ≤ 1 day of hotel time |
| Friendly | Validation errors shown as raw schema text | yes (UX1 persona 7) | — | 0; every field error names the field and the fix |
| Friendly | Behaviour changes reaching a property without preview and defer option | n/a | OPERA opt-in controls (DD02a §1.1) | 0 |
| Well-rounded | Environments with honest banners and blocked effects | built | — | 100% of effects routed through `assertExternalEffectAllowed` + scope (E-tests) |

## 5. Next 3 increments

### Increment 1 — Land the enterprise wave
- After the identity ADR-0017 amendment passes review: merge, adapt cross-module tests, register platform records in
  the universal record contract (outlet, owner, activation request, authority transition, configuration change,
  trial), provide `lockBusinessDate`; reconcile `docs/parity/platform.md` with the branch's tests.
- **Acceptance:** PAR-PLT-002, 004, 006, 023, 024, 029, 031 tested on `main`; S17 isolation still green; parity shows
  the true share.

### Increment 2 — Policy centre and authority preview
- Policy catalog registered by modules (schema, default, levels, lockable) with an API for "effective value + source +
  overrides" per property; previewed portfolio change listing affected properties and preserved overrides (S16);
  authority-change preview with per-module impact (open items, required reconciliation) and coherence rules.
- **Acceptance:** S16 through `apps/api`; PAR-PLT-038, 056, 057 and EC-PLT-010, 014, 015, 016 tested.

### Increment 3 — Setup by profile and progressive disclosure
- Profile layer (guesthouse/resort/city/apartments/group) supplying defaults and visibility; feature visibility API
  combining entitlement × profile × authority for the UI; guided setup with go-live checklist; effective-dated tax
  classification; property facts incl. arrival points and transport modes; usage meters with caps.
- **Acceptance:** PAR-PLT-018, 021, 022, 026, 033, 059, 060 and EC-PLT-024 tested; a guesthouse demo reaches a first
  booking in a scripted run with ≤ 8 setup steps.

## 6. Cross-module dependencies and contract changes

- **identity:** ADR-0017 amendment first; human approvers. **integration:** authority transitions (FR-2). **rates:**
  classification history (EC-RAT-007). **day-close:** timing policy, `advanceBusinessDate` contract. **all modules:**
  register policies in the catalog; declare visibility keys; record types for platform records. **backoffice:** policy
  centre, setup wizard, portfolio Today. **billing:** plan changes drive entitlements (BIL-R02).
- **New contract:** `getEffectivePolicy(tx, key, propertyId) → {value, source, overriddenAt[]}`,
  `previewAuthorityChange`, `getVisibility(propertyId) → {features}`, `lockBusinessDate`.

## 7. Power check — never lose or hide

Tenant isolation (RLS + application) on every table; environments never leak effects; business date only advances by
the close and never logs anyone out; downgrades never delete data; local overrides are never silently deleted by a
portfolio change; separation of duties compares people, not principals; exactly one system of record per domain.
