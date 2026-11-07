# Operational readiness — index

Deliverables required by `docs/product/operational-readiness-brief.md` §22 (owner decision D9). Owner: Operational
Readiness lead. Created 2026-11-07. These are living documents; update them whenever a fact is verified, a provider
answers, or a capability changes readiness level.

## Files

| # | File | Brief § | What it answers |
|---|---|---|---|
| 1 | [gap-assessment.md](gap-assessment.md) | §22 | What exists vs both briefs; prioritised gaps |
| 2 | [dependency-register.md](dependency-register.md) | §3, §9, §14 | Every external service, its terms, costs, risks, questions |
| 3 | [channel-capability-matrix.md](channel-capability-matrix.md) | §4–§6 | Which channel capabilities exist directly vs via Channex; Channex baseline |
| 4 | [certification-approval-matrix.md](certification-approval-matrix.md) | §8, §10 | Legal, payment-network, provider, contractual, procurement, voluntary, internal requirements |
| 5 | [market-matrix.md](market-matrix.md) | §11 | Supported-market register; Maldives in depth; next markets |
| 6 | [cost-model.md](cost-model.md) | §15–§16 | 0 / 1 / 10 / 50 / 100-property scenarios; zero-cost demo; sensitivity |
| 7 | [responsibility-matrix.md](responsibility-matrix.md) | §1, §7 | Money flows for every payment scenario; RACI |
| 8 | [security-privacy-readiness.md](security-privacy-readiness.md) | §8, §12–§14 | Acceptance criteria, processing roles per purpose, retention, support access, incidents |
| 9 | [migration-onboarding-checklist.md](migration-onboarding-checklist.md) | §18 | Source-system exports, reconciliation, cutover and rollback |
| 10 | [launch-checklist.md](launch-checklist.md) | §21 | Five gates, evidence, blockers, decision-makers |
| 11 | [support-recovery-plan.md](support-recovery-plan.md) | §17 | SLO/RPO/RTO targets, continuity procedures, incidents, restore drills, time risks |
| 12 | [roadmap-critical-path.md](roadmap-critical-path.md) | §22 | Engineering waves and the external critical path |
| — | [readiness-register.md](readiness-register.md) | §2 | R1–R9 level per capability/integration, approvals and hotel validation separate |
| — | [business-documents-register.md](business-documents-register.md) | §20 | Documents needing professional review; recurring obligations |

## Evidence labels (used in every file)

| Label | Meaning |
|---|---|
| `[verified 2026-11-07]` | Checked on 7 Nov 2026 against the linked official/primary source, by the research session behind `docs/research/04-connectivity-payments-compliance.md` (or 01/02/03 where marked R01/R02/R03). |
| `[secondary, read 2026-11-07]` | Read on 7 Nov 2026 from a secondary source (vendor blog, press, review site, consultancy). |
| `[owner baseline 2026-11-07]` | The owner's dated Channex baseline (readiness brief §5). |
| `[reference 2026-10-06]` | Anthropic's `claude-api` reference shipped with Claude Code (pricing table cached 2026-10-06), not re-checked live. |
| `[unconfirmed]` | Background knowledge or inference — must be verified before anyone relies on it. |
| `[quote required]` | Not published or negotiated; never treated as zero. |
| `[estimate]` | Our arithmetic/approximation. |
| `[assumption]` | Our planning choice. |
| `TARGET` | A service objective not yet supported by testing or capacity. |

## Verification status of this work (read before relying on any figure)

During this session the shared web-search budget was exhausted and the network policy refused `stripe.com` and
`channex.io`; following the environment's guidance no further sites were attempted. Consequently:

- **Nothing was freshly verified by this session.** Claims marked `[verified 2026-11-07]` come from the same-day
  research reports, with their source URLs.
- The three verifications specifically requested were **not** completed live:
  1. *Stripe and Maldivian businesses* — not verified; planning assumption: **unavailable** for Maldivian legal entities
     `[unconfirmed]`; Stripe "cross-border payouts" would make Monoclay the settlement merchant and are incompatible with
     D2 regardless.
  2. *TGST 17% (from 1 Jul 2025) and green tax $12/$6* — verified 2026-11-07 via KPMG and Maldivian news sources
     (R04); **MIRA's own publication not read**.
  3. *Channex pricing today* — not re-fetched; the owner's baseline and R04 (both 2026-11-07) agree: $130/month +
     $7/property, +$7 messaging & reviews.

### Verification backlog (allow-list these hosts for agent sessions, or check manually)

| Check | Where to look | Updates |
|---|---|---|
| Stripe supported countries (Maldives) | `stripe.com/global` | dependency register §2.1, Q2 |
| Stripe Connect cross-border payouts country list and terms | `docs.stripe.com` (Connect cross-border payouts) | §2.1 |
| Stripe Connect, Billing, Terminal pricing for Monoclay | `stripe.com/pricing`, Connect and Billing pricing pages | cost model §6 |
| Channex pricing, certification steps, per-channel capabilities | `channex.io/pricing`, `docs.channex.io` | channel matrix, cost model |
| TGST, green tax, invoice requirements, filing, service-charge guidance | `mira.gov.mv` (MIRA publications, GST/green tax guides) | market matrix §2 |
| Guest register / tourism reporting | `tourism.gov.mv` | market matrix §2.7 |
| Foreign-exchange and pricing-currency rules | `mma.gov.mv` | market matrix §2.8 |
| Service-charge distribution law | Employment Act (as amended) text | market matrix §2.4 |
| BML Connect gateway, API, sandbox | Bank of Maldives website / developer documentation | dependency register §2.4 |
| MIB merchant/e-commerce services | Maldives Islamic Bank website | §2.5 |
| AWS `ap-south-1` prices (Fargate, RDS, ALB, NAT, S3, CloudWatch, WAF, SES) | AWS pricing pages / Pricing Calculator | cost model §5 |
| WhatsApp per-message rate card; Tech Provider requirements | Meta for Developers (WhatsApp Business Platform pricing) | dependency register §4.4 |
| Twilio SMS price and sender rules for the Maldives | Twilio SMS pricing (Maldives) | §4.3 |
| Claude API pricing | `platform.claude.com/docs/en/about-claude/pricing` | §5.1, cost model |

## Most decision-relevant findings

1. **Payments:** a Maldivian resort is very likely **not** eligible for Stripe or Adyen as merchant (unverified). A
   Maldives pilot can start with **Route D** — the hotel keeps its bank terminal/gateway and Portico *records* tenders —
   so integrated payments are **off the pilot's critical path**. Local bank gateway APIs (BML, MIB, "CBM") are the next
   thing to establish (questions ready in the dependency register §8.2).
2. **Tax:** TGST 17% and green tax $12/$6 per guest-night are the only Maldives facts with dated sources. Service-charge
   tax treatment and distribution, invoice contents and currency, filing formats, guest reporting, FX rules and
   retention periods are **unconfirmed** and need a Maldives adviser (Q20) before any live invoice.
3. **Costs:** demo mode ≈ $0; one pilot ≈ $460–780/month excluding people (fixed platform for one property); 10
   properties ≈ $900–1,410/month (≈ $90–141 each); 50 ≈ $50–77 each; 100 ≈ $49–72 each — all `[estimate]`. Human
   support capacity, not infrastructure, is the dominant cost and the limit on what can honestly be promised.
4. **Distribution:** Channex covers OTA certifications on its side, but Portico must pass Channex certification with real
   workflows; per-channel capability depth through Channex is largely unverified. A pilot can keep its current channel
   manager as long as Portico does not also control inventory.
5. **Critical path to a pilot:** a named pilot hotel, a Maldives adviser, AWS authorization, reviewed contracts, a
   penetration test, and a defined support promise — not provider certifications.

## Open questions raised

Q20–Q26 in `docs/OPEN_QUESTIONS.md` (advisers, support promise, pre-pilot spend cap, Channex activation timing,
security assurance roadmap, AI processing of guest data, first pilot profile). Q2 and Q4 (existing) remain the main
payment and hosting decisions.
