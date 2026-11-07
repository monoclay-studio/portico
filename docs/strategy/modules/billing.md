# billing — 10x brief (Monoclay's own SaaS billing, never hotel money)

Status: v1 · 2026-11-07 · Gap strategist · **Planned** (wave 3e; needed before the first **paid** customer, not for a
free pilot) · Spec `docs/specs/billing.md` (BIL-R01–R09) · Parity: **none** · Architecture rule 14 · Decisions D1, D10,
D11 · Source key: `docs/strategy/gap-plan.md` §0. **No prices are set here (D11, Q3).** All targets are TARGETS.

## 1. Current state (evidence)

- **No `billing` module exists.** Platform plans and entitlements exist, incl. the Connect plan and module packs and
  property-scoped grants by Monoclay operators only (identity-plus branch README-platform); usage meters are **not
  built** (PLT-R24); payments refuses to mix money worlds (application fee set only by operators; hotel = merchant).
- **Owner questions:** Q3 prices (after costs, D11), Q45 usage costs to hotels, Q47 tax on Monoclay's SaaS invoices,
  Q60/Q143 standalone modules and migration packaging, Q109 back-of-house packaging, Q153 AI included (new).

## 2. Best (and worst) on the market today

| Area | Who | How | Source |
|---|---|---|---|
| Published, simple pricing | Apaleo | €8/room/month with a €400 minimum (third-party; unit uncertain) | DD06 §1 |
| Price churn | Little Hotelier | Tiers changed twice in 2026 | DD06 §1; DD02b §4 |
| Quote-only, surprise terms | Cloudbeds, Mews | Quote-based; paid imports; renewal shocks | DD06 §1; R03 §3.7 |
| Anti-patterns | Mews; SiteMinder | SaaS fee netted against payouts, opaque fees; billing during trial/after cancellation | R02 §2.8 #3; R03 §4.4 |
| Tier gating | Mews, RoomRaccoon | Limits on rates/connections/data history; pricing tools in the top tier only | R02 §2.8 #5; R03 §5.4 |
| Included AI/archive vs add-ons | Oracle | AI included; archive and data access sold separately | DD06 §1 |

## 3. Gaps vs market (ranked)

| # | Gap | Spec |
|---|---|---|
| 1 | Effective-dated price book per plan/add-on/usage item (configuration, no hard-coded prices) | BIL-R01 |
| 2 | Subscription changes drive platform entitlements; downgrades never delete data | BIL-R02; editions principle 6 |
| 3 | Usage items from platform meters with line detail; pass-through costs shown before they are incurred and capped | BIL-R04; Q45 |
| 4 | Gapless invoices tagged with product code `portico`; Stripe Billing on Monoclay's own account; dunning that never touches hotel funds | BIL-R05, R06; rule 14 |
| 5 | Trials that never bill; cancellation that never bills afterwards | BIL-R03; R03 §4.4 |
| 6 | Environment safety for every charge and email | BIL-R07 |
| 7 | Customer billing portal; SaaS revenue/deferred revenue export for Monoclay's books | BIL-R08, R09 |

## 4. The 10x outcome (TARGETS)

**Picture:** a hotel always knows what it will pay before it pays it, including usage such as OHIP calls during a
migration; its SaaS invoice is separate from every guest payment; and a downgrade or cancellation never deletes its
data or bills it afterwards.

| Dimension | Metric | Target |
|---|---|---|
| Powerful | Code paths that can move guest funds into Monoclay's account | 0 (separation test) |
| Seamless | Usage costs incurred without a prior estimate and cap | 0 |
| Friendly | Lines on a SaaS invoice the customer cannot trace to a plan, add-on or meter | 0 |
| Well-rounded | Charges in demo/trial/training | 0 (environment safety) |

## 5. Next 3 increments

### Increment 1 — Price book and entitlement sync (no live charging)
- Effective-dated price book as configuration (values entered by the owner later — placeholders now), subscription
  aggregate driving platform plans/entitlements, trial and cancellation rules, separation tests proving no path to guest
  money.
- **Acceptance:** BIL-R01–R03, R07 tested in non-live environments only; no price published.

### Increment 2 — Usage meters and previews (with platform)
- Platform meters (properties, units, messages, AI credits, OHIP calls via integration) → usage lines; cost preview and
  caps shown to the customer before incurring (Q45 default).
- **Acceptance:** BIL-R04 tested; an over-cap action is refused with an explanation, never silently billed.

### Increment 3 — Invoices and collection (sandbox only)
- Gapless invoices with product tag, Stripe Billing in **test mode** on Monoclay's account, dunning, customer portal,
  export for Monoclay's accounting; live activation only with owner authorization.
- **Acceptance:** BIL-R05, R06, R08, R09 tested in sandbox; R4 evidence recorded; Q47 tax treatment flagged on invoices
  as pending until answered.

## 6. Cross-module dependencies and contract changes

**platform:** plans, entitlements, meters. **integration:** pass-through usage (OHIP calls, channel hub). **ai:** credits
(Q153). **identity:** billing admin role. **payments/finance:** must stay unreachable from billing (tests).

## 7. Power check — never lose or hide

Guest money and Monoclay money never mix; correctness, safety, migration import, data export and standard reports are
never gated (editions principle 1); downgrades never delete data; no surprise charges; no prices invented by engineering.
