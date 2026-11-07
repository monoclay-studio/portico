# Cost model

Deliverable 6 of the operational-readiness brief (§15, §16). Owner: Operational Readiness lead; decisions by the founder.
Last updated: 2026-11-07. Labels as defined in `dependency-register.md`.

> **Read this first.** No AWS, Channex, messaging or AI price could be re-verified live in this session (network policy
> and exhausted search budget — see README). Channex figures are the owner's dated baseline. Claude API figures come from
> Anthropic's bundled reference (cached 2026-10-06). **All AWS, monitoring, messaging and support-tool figures are
> `[estimate]`** — order-of-magnitude planning numbers to be replaced by AWS Pricing Calculator output for `ap-south-1`
> and provider quotes before any spending decision. Unpublished fees are shown as `[quote required]` and are **never
> treated as zero**.

## 1. Scope and exclusions

**Included:** incremental cash costs created by deploying and operating Portico (hosting, integrations, communications,
AI, monitoring, support tools), one-time readiness costs, and human support capacity (as FTE).

**Excluded (existing Monoclay expenses, not caused by Portico):**

| Excluded item | Why |
|---|---|
| Stripe Atlas formation and its ongoing fees; Delaware/US company obligations | Existing company expense (D1) |
| Claude subscription used for development | Existing; **does not pay for in-product AI** (readiness brief §14) — in-product AI is costed below |
| Founder's laptop, internet, existing email/workspace tools, existing GitHub plan | Existing company expenses |
| Monoclay's existing Stripe account | Existing; Stripe **fees on Portico SaaS revenue** are included in §6 |

**Hotel-paid (not Monoclay costs, but shown so hotels see the full picture):** §7.

## 2. Usage assumptions `[assumption]`

| Driver | Average property | Heavy / resort sensitivity | Basis |
|---|---|---|---|
| Units (rooms/villas) | 40 | 120 villas | Spans guesthouse (6–20) to resort (100+) per D4/D8 |
| Active staff users | 12 | 150 | Front office, housekeeping, F&B, finance |
| Occupancy / average stay | 70% / 4 nights | 80% / 6 nights | Planning values, not market data |
| Bookings per month | ≈ 210 | ≈ 490 | 40 × 0.7 × 30.4 ÷ 4; 120 × 0.8 × 30.4 ÷ 6 |
| Guests per booking | 1.9 | 2.2 | — |
| Documents per month | ≈ 630 PDFs (confirmation, invoice, receipt) at ~150 KB; ≈ 400 ID images at ~400 KB | ×2.5 plus maintenance photos (~10/day at 2 MB ≈ 600 MB/month) | Storage growth ≈ 250 MB/month average; ≈ 1.2 GB/month heavy |
| Database growth | 50–100 MB/month (postings, audit, events, channel message log) | 300–500 MB/month | Channel/ARI logs pruned per retention policy |
| Emails | ≈ 1,800/month (6 per booking + staff notifications) | ≈ 5,000 | — |
| WhatsApp template messages | ≈ 630/month (3 per booking) | ≈ 1,500 | Hotel-paid by default |
| SMS segments | ≈ 60/month (fallback) | ≈ 300 | Hotel-paid by default |
| AI: staff assistant | 40 requests/day (≈ 1,200/month), ~8k input tokens (6k cached) + 600 output | 200/day on a larger model | — |
| AI: translation | 600 guest messages/month, both directions, ~1k in + 300 out | 3,000 | — |
| AI: handover/stay summaries | 3/day (≈ 90/month), ~20k in + 1k out | 15/day on a larger model | — |
| Channel connections | 1 hub property with active channels | same | Channex bills per property with ≥1 active channel `[verified 2026-11-07]` |

Costs created **even with no new bookings** (readiness brief §15): staff logins and AI usage, stored documents and
backups growing over time, log retention, channel ARI traffic (rates/availability pushed daily), monitoring, the
Channex platform fee once production is activated, and staging environments.

## 3. Zero-cost demonstration mode (0 live hotels)

Goal: incremental spend **as close to $0 as practical** until a committed pilot (readiness brief §16).

| Element | Zero-cost approach | Incremental cost |
|---|---|---|
| Application + database | Runs locally (Docker Postgres, `pnpm dev:*`) with seeded Maldives sample data: a guesthouse, a ~120-villa resort, a 3-property group (D8) | $0 |
| Hosted demo (optional) | Only after owner authorization (Q4, Q22): one small instance with app + Postgres together, budget alert + automated stop action, auto-shutdown outside demo hours | ≈ $10–30/month `[estimate]`; AWS new-account credits are time-limited and **not** treated as permanent `[unconfirmed]` |
| Payments | Built-in **simulator** provider; Stripe test mode when sandbox-testing (no charge `[unconfirmed]`) | $0 |
| Channels | Built-in OTA simulator; Channex **staging** (free `[owner baseline 2026-11-07]`) only for sandbox tests. **Do not activate Channex production** (platform fee starts) | $0 |
| Email | Local mail catcher (no real sends); SES only in sandbox mode to verified addresses | $0 |
| WhatsApp/SMS | Simulated adapters; UI labels "simulated" | $0 |
| AI | Default **off** in demo, or recorded fixture responses; live calls only with a dev key and a hard monthly cap set by the owner | $0 (or the cap, e.g. single-digit dollars) |
| Monitoring | Free developer tiers `[unconfirmed]` or none for local demo | $0 |
| Domain | Not required for local demo; needed for hosted demo/email (Q1) | ≈ $10–50/year `[estimate]` |

**Safety:** every external-effect adapter calls `assertExternalEffectAllowed(ctx, effect)` (CLAUDE.md §4.12). Demo and
training environments cannot charge cards, send guest messages, publish to live channels, issue production keys, submit
government reports, or make uncontrolled paid AI calls. The UI labels every effect *simulated*, *sandbox* or
*unavailable*.

**Budget notification vs hard cap** (readiness brief §16):

| Provider | Notification | Hard cap |
|---|---|---|
| AWS | AWS Budgets alerts | **No native hard cap** `[unconfirmed]`; Budgets *actions* (restrictive policy, stop instances) approximate one |
| Anthropic API | Usage alerts | Organization/workspace spend limits `[reference 2026-10-06 — enforcement behaviour unconfirmed]` |
| Twilio / Meta | Usage alerts `[unconfirmed]` | Generally none `[unconfirmed]` → Portico enforces per-tenant send quotas |
| Channex | — | Fixed price per active property (bounded) |
| Portico itself | Per-tenant usage meters | **Portico-enforced hard limits** for AI tokens, messages and exports per tenant/plan (entitlements) |

## 4. Scenario summary (monthly, USD, excluding people)

| Line (monthly) | 0 hotels (demo) | 1 pilot | 10 properties | 50 properties | 100 properties | Type |
|---|---|---|---|---|---|---|
| AWS production + staging | $0 local (optional hosted demo $10–30) | $300–500 | $450–700 | $900–1,500 | $1,800–2,800 | Fixed-ish, steps with scale `[estimate]` |
| Channex (base) | $0 (staging) | $137 | $200 | $480 | $830 | Fixed $130 + $7/property `[owner baseline 2026-11-07]` |
| Channex messaging & reviews add-on (optional) | — | +$7 | +$70 | +$350 | +$700 | Variable `[owner baseline 2026-11-07]` |
| Monitoring, uptime, paging | $0 | $0–60 | $30–100 | $100–300 | $200–500 | Fixed-ish `[estimate]` |
| Support desk tooling | $0 | $0–50 | $30–150 | $100–300 | $200–500 | Per agent `[estimate]` |
| Domain, DNS, certificates | $0–4 | $2–5 | $2–5 | $5 | $5 | Fixed `[estimate]` |
| Email (SES) | $0 | ≈ $1 | ≈ $2 | ≈ $10 | ≈ $20 | Variable `[estimate]` |
| AI (base usage, §2) | $0 | ≈ $18 | ≈ $182 | ≈ $912 | ≈ $1,824 | Variable `[estimate]` from `[reference 2026-10-06]` prices |
| **Total (range)** | **$0–34** | **≈ $460–780** | **≈ $900–1,410** | **≈ $2,510–3,860** | **≈ $4,880–7,180** | `[estimate]` |
| **Per property** | — | **≈ $460–780** | **≈ $90–141** | **≈ $50–77** | **≈ $49–72** | `[estimate]` |

Notes:
- Channex volume tiers begin at 500 properties `[verified 2026-11-07]`, so they do not apply here. VAT/overages
  `[quote required]`.
- The pilot carries almost the whole fixed platform (production, staging, Channex platform fee) for one property —
  hence ≈ $460–780 per property for one pilot versus ≈ $50–75 at 50+.
- **Not included above and potentially larger than everything above:** human support/on-call capacity (§8) and Stripe
  fees on Monoclay's SaaS revenue (§6).

## 5. AWS line items for the pilot (`ap-south-1`, on-demand) `[estimate]`

These are planning estimates from recalled list prices, **not verified for `ap-south-1` on 2026-11-07**. Replace with
AWS Pricing Calculator output before Q4 authorization.

| Line item | Pilot sizing | Est. $/month | Scaling notes |
|---|---|---|---|
| ECS Fargate — API | 2 tasks × 0.5 vCPU / 1 GB, 24×7 | 30–40 | +tasks at 10/50/100 properties |
| ECS Fargate — worker | 1 task × 0.5 vCPU / 1 GB | 15–20 | +1–2 tasks at 50+ |
| RDS PostgreSQL | db.t4g.medium, **Multi-AZ**, 50 GB gp3, PITR 7–35 days | 110–150 | larger class at 10 (t4g.large), 50 (m7g.large), 100 (m7g.xlarge + read replica). Single-AZ halves DB cost but lengthens recovery (RTO) |
| Application Load Balancer | 1 ALB, low LCU | 20–30 | LCU grows with traffic |
| NAT gateway | 1 gateway + data processing | 35–50 | Can be avoided with VPC endpoints/public-subnet tasks; trade-off documented in ADR |
| Public IPv4 addresses | ~3 | ≈ 11 | AWS charges per public IPv4 hour `[unconfirmed]` |
| S3 (documents, exports) | < 50 GB | 2–5 | Grows ≈ 3 GB/property/year average |
| Backups (snapshots, cross-region copy) | DB + S3 | 5–15 | Grows with retention |
| CloudWatch (logs, metrics, alarms) | 5–10 GB logs/month | 10–30 | Largest variable risk if debug logging left on |
| AWS WAF | 1 web ACL + managed rules | 10–20 | + per-million-request fee |
| KMS + Secrets Manager | ~3 keys, ~15 secrets | 8–12 | + per hotel gateway credentials |
| Route 53 | 1–2 hosted zones | 1–3 | — |
| CloudFront (staff SPA, booking engine assets) | low | 1–5 | — |
| GuardDuty / Security Hub (threat detection) | small account | 5–20 | Usage-based |
| Staging environment | scaled down, stopped off-hours | 40–80 | Must exist for safe releases |
| **Total** | | **≈ 300–500** | |

Data egress: first tier and Maldives-bound traffic are small for staff web use; large exports (hotel off-boarding,
backups to the hotel) are billed per GB `[unconfirmed]`.

## 6. Payment costs

| Flow | Who pays | Cost | Label |
|---|---|---|---|
| Monoclay SaaS subscription collected by card (Stripe, Monoclay's account) | Monoclay | Stripe card processing for international cards with currency conversion + Stripe Billing % of volume — plausibly **~4–6% + a fixed fee per charge** for a Maldivian card | `[estimate]` — rates `[unconfirmed]` |
| Monoclay SaaS by bank transfer | Monoclay / hotel (bank fees) | Correspondent/wire fees `[unconfirmed]` | — |
| Guest payments via any PSP/acquirer | **Hotel** (merchant) | Hotel's merchant pricing | Hotel-paid; **never** Monoclay money (D2) |
| Platform application fee (if Monoclay charges one on guest payments) | Hotel → Monoclay revenue | Commercial decision (Q3) | — |

## 7. Hotel-paid charges (outside Monoclay's costs)

| Charge | Paid to | Notes |
|---|---|---|
| OTA commissions | Booking.com, Expedia, Agoda, etc. | Hotel's own contracts; separate from Channex fees and SaaS fees (readiness brief §4) |
| Card processing, terminals, chargeback fees | Hotel's acquirer/PSP | Merchant agreement |
| WhatsApp/SMS messages (default) | Meta / Twilio | Hotel-owned accounts `[assumption]`; rate cards `[quote required]` |
| Door-lock and POS interface licences | Lock/POS vendors | `[quote required]`; sometimes charged to the PMS vendor instead |
| Source-system export / migration fees | Previous PMS vendor | `[quote required]`; check contract notice periods |
| GDS/CRS fees | CRS / GDS | Later |
| Taxes (TGST, green tax) | MIRA | Pass-through from guests; not a cost to Monoclay |
| Hardware (encoders, terminals, printers, tablets) | Vendors | Hotel-owned |

## 8. People: support, on-call, onboarding `[assumption — owner to set]`

The application being hosted 24/7 does **not** mean 24/7 support exists (readiness brief §17). Salaries/contractor rates
were not researched; cost = FTE × owner-set loaded monthly cost.

| Scenario | Support / on-call capacity | Onboarding capacity | Honest support promise |
|---|---|---|---|
| 0 hotels | Founder (part-time) | — | None (demo) |
| 1 pilot | Founder ≈ 0.5 FTE + engineer on-call best effort | Founder | Named contact; agreed hours (Maldives time); P1 best-effort out of hours — **no 24/7 claim** (Q21) |
| 10 | ≈ 1.5–2 FTE | 0.5–1 FTE | Extended hours; a real 24/7 rota needs ≥ 4 people `[assumption]` |
| 50 | ≈ 4–5 FTE + rota | 1–2 FTE | 24/7 P1 possible if rota staffed |
| 100 | ≈ 6–8 FTE + rota | 2–3 FTE | 24/7 P1 with SLA |

## 9. One-time costs

| Item | When | Cost | Label |
|---|---|---|---|
| Channex certification | Before pilot (if Channex) | No setup fee published; engineering time | `[verified 2026-11-07]` / effort `[estimate]` |
| Independent penetration test | Before pilot go-live with live guest data | `[quote required]` | — |
| Professional reviews: customer contract set, DPA, privacy notices (US counsel) | Before first signed customer | `[quote required]` | — |
| Maldives tax/legal adviser (market-matrix §2.12) | Before pilot | `[quote required]` | — |
| Cyber / professional liability insurance | Before first signed customer | `[quote required]` (recurring premium) | — |
| Per-property onboarding & migration labour | Per hotel | Guesthouse 10–20 h; hotel 30–60 h; resort 80–200 h | `[assumption]` |
| Source-system data export | Per hotel | `[quote required]` (hotel-paid by default) | — |
| PCI service-provider validation (QSA if required) | Before enterprise / Booking.com direct | `[quote required]` | — |
| SOC 2 / ISO 27001 programme | Only when triggered (Q24) | R04 inference "$100–250k per year" `[estimate]` | — |

## 10. Heavy-usage sensitivity

| Driver | Base | Heavy | Effect on monthly cost |
|---|---|---|---|
| AI usage (5× requests, larger model for assistant and summaries) | ≈ $18/property | ≈ $174/property | 10 properties: +≈ $1,560 → total up to ≈ $2,960 (≈ $296/property); 100 properties: up to ≈ $22,700 (≈ $227/property). **Mitigation:** per-plan AI quotas, smaller models for translation/classification, prompt caching, batch for non-urgent summaries (50% `[reference 2026-10-06]`), hard per-tenant caps with graceful degradation |
| Document & photo storage (resort with maintenance photos) | ≈ 250 MB/month | ≈ 1.2 GB/month | S3 cost small (cents–dollars per property/month `[estimate]`); backup copies multiply it; lifecycle to cheaper tiers |
| Logs (verbose channel/ARI logging) | 5–10 GB/month total | 50+ GB/month | Can add tens to hundreds of dollars per month `[estimate]`; enforce sampling and retention |
| Messaging volume (if Monoclay pays instead of hotel) | — | 1,500 WhatsApp + 300 SMS per resort | `[quote required]` per country; reason the default is hotel-paid |
| Channel count/ARI frequency | — | — | **No** Channex per-message fee (no commission) `[verified 2026-11-07]`; affects our compute/logs only |
| Large exports (off-boarding, BI) | rare | monthly full exports | Egress per GB `[unconfirmed]`; quota exports per plan |
| Staff count | 12 | 150 | Small infra effect; larger support load |

## 11. Unit economics guardrails `[assumption]`

- Track cost per property per month (infra share + Channex + AI + messaging if Monoclay-paid) in `analytics`; alert when a
  tenant exceeds its plan's cost envelope.
- Price editions (Q3) above the per-property cost at the expected scale plus support capacity — this model provides the
  floor, not the price.
- Re-run this model with verified prices before: Q4 authorization, Channex production activation (Q23), and the first
  paid pilot.
