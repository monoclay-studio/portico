# fnb-pos — 10x brief (outlet POS, kitchen, room charge, meal plans, external POS intake)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3b / BOH-1; POS **intake** is resort-pilot critical) ·
Spec `docs/specs/fnb-pos.md` (FNB-R01–R29) · Parity `docs/parity/fnb-pos.md` · Source key:
`docs/strategy/gap-plan.md` §0. **All targets are TARGETS until validated with outlet staff.** Owner question: Q108 POS
hardware and on-site support.

## 1. Current state (evidence)

- **No `fnb-pos` code exists.** Finance has the posting side: charge codes with restricted posting, routing, allowance
  consumption, late charges after checkout with supplementary folios (S10), cashier sessions (README-finance); platform
  outlets with room-charge eligibility (identity-plus branch). Finance parity rows for POS posting, eligibility and
  outlet balancing are `specified` (PAR-FIN-330–332).
- **Parity:** 82 rows / 38 edge cases, 0% tested, **68 P0 open**; P1 missing: central menu management, menu import/
  export, reopen/adjust a closed check with audit, bar tab with card pre-auth, email receipt; edge cases for items 86'd
  while offline, transfers between tax sectors, in-villa dining after a villa move, reopening a check settled to room
  yesterday.
- **Maldives context:** resorts buy PMS + POS as a pair (Cinnamon: OPERA Cloud + Simphony) (DD09 §3; DD02c §6).

## 2. Best on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Hotel POS reference | Oracle Simphony | Revenue centres, serving periods, menus, combos, allergens, OPERA integration | PAR-POS baseline; DD02c §6 |
| Offline and pacing | Toast | Offline operation, course pacing | PAR-POS baseline |
| Award | Mews POS (HTA 2026 Best Hotel Restaurant POS) | PMS-integrated POS | DD02c §6 |
| Scale | Shiji Infrasys (60+ countries) | Full stack with Daylight | DD02a §3 |
| Room charge integrations | Lightspeed K-Series | Room-charge integrations | PAR-POS baseline |

Research reading: if Portico integrates POS, the integrated experience must be **indistinguishable from a suite at the
folio** (posting, balancing, entitlement use) (DD02c §6).

## 3. Gaps vs market (ranked)

| # | Gap | Spec / parity |
|---|---|---|
| 1 | External POS intake (Simphony first): posting with outlet attribution, lines, tips, tax; eligibility check; outlet balancing | FNB-R26; RST-R01; PAR-FIN-330–332 |
| 2 | Room charge with guest lookup showing entitlements, credit status and allergies; refusals and overrides | FNB-R15, R16; JG-09, JG-11 |
| 3 | Meal plans and all-inclusive consumption | FNB-R17 (with resort RST-R03) |
| 4 | Service charge, TGST by tax sector, tips; receipts | FNB-R18, R19; EC-POS-034 |
| 5 | Quick-post mode for outlets without a POS | FNB-R25 |
| 6 | Connectivity tiers shown on every device; sync rules; honest status | FNB-R20–R22 |
| 7 | Checks, courses, split/merge/transfer, discounts/voids/comps, KDS | FNB-R06–R13 |
| 8 | Outlet close per business date; cashier shifts as finance sessions | FNB-R23, R24 |
| 9 | Menus, prices, floor plans; central menu management | FNB-R01–R05; PAR-POS-011, 012 |
| 10 | Hardware compatibility list with evidence | FNB-R28; Q108 |

## 4. The 10x outcome (TARGETS)

**Picture:** a guest signs for cocktails at the beach bar; the charge lands on the right folio with the half-board
entitlement applied, the right service charge and TGST, exactly once — whether it came from the resort's Simphony or
Portico's own tablet on weak Wi-Fi — and the outlet closes its day balanced to the ledger.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Duplicate or lost outlet postings under retries and offline replays | 0 |
| Powerful | Outlet totals vs postings at outlet close | 0 unexplained differences |
| Seamless | Post an outlet charge (cashier) | ≤ 20 s, 1 screen, ≤ 1 error / 50 (UXP §19) |
| Friendly | Room-charge refusals without a reason and an override path | 0 |
| Well-rounded | Integration paths | Simphony intake (R4 with a sandbox) + Portico quick post + Portico POS |

## 5. Next 3 increments

### Increment 1 — POS intake and quick post (resort-pilot path)
- Intake contract (posting with outlet, lines, tax sector, tips, idempotency per check id/revision), eligibility check
  (in-house, posting allowed, credit status, entitlements), refusals with reasons; quick-post app for outlets without a
  POS; outlet balancing at close against intake totals.
- **Acceptance:** PAR-FIN-330–332 and FNB-R15, R16, R24–R26 tested with a POS simulator; EC-RES-022 (open bar tab at
  checkout), EC-POS-036, 038 tested.

### Increment 2 — Entitlements, taxes and receipts
- Meal-plan and all-inclusive consumption with resort/finance; service charge and TGST per tax sector; transfer between
  outlets with different sectors; receipts (print/email) and fiscal rules from finance.
- **Acceptance:** FNB-R17–R19 and EC-POS-034 tested; S19 extended with outlet charges.

### Increment 3 — Portico POS core (offline tier)
- Menus, price schedules, checks, courses, split/merge/transfer, voids/comps with reasons, KDS, connectivity tiers with
  honest status, offline sync with 86'd-item conflicts; cashier shifts as finance sessions.
- **Acceptance:** FNB-R01–R14, R20–R23 tested; EC-POS-027 tested; hardware list entries carry evidence (Q108).

## 6. Cross-module dependencies and contract changes

**finance:** posting contract, eligibility, outlet balancing, cashier sessions. **resort:** entitlements, outlet posting app
shared with quick post. **guest-services:** allergies at lookup. **stock:** sold-item facts for recipes and theoretical
cost (FNB-R27). **integration:** Simphony connector, local connector for on-site POS. **platform:** outlets, tax sector,
business date. **analytics:** F&B reports.

## 7. Power check — never lose or hide

Exactly one charge source per outlet; every posting lands once; offline status is always visible; voids and comps keep
reasons and audit; closed checks reopen only with permission and history.
