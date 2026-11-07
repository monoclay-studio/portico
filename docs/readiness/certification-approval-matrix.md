# Certification and approval matrix

Deliverable 4 of the operational-readiness brief (§8, §10). Owner: Operational Readiness lead. Last updated: 2026-11-07.
Labels as defined in `dependency-register.md`.

**Ground rules (readiness brief §10, CLAUDE.md §7):**

- There is **no universal "hospitality software certification"**. Each item below has its own scope and owner.
- SOC 2 and ISO 27001 are **customer-assurance options**, not universal legal requirements, not interchangeable, and
  **not obtained**.
- A provider's certification (AWS, Stripe, Channex) is **never** presented as Portico's.
- No compliance badge, certification claim or partner logo is displayed anywhere without evidence and permission.
- Nothing in this matrix has been obtained, submitted or started as of 2026-11-07. Costs are `[quote required]` unless
  stated; lead times are **not published** unless stated — we do not invent them.

Columns: **Applies?** (now / pilot / later / conditional) · **Scope** · **Evidence** · **Owner** (role) · **Cost** ·
**Lead time** · **Renewal** · **Triggers** (changes that re-open the item).

---

## 1. Legal obligations

| # | Item | Applies? | Scope | Evidence | Owner | Cost | Lead time | Renewal | Triggers |
|---|---|---|---|---|---|---|---|---|---|
| L1 | Maldives TGST charging, invoicing, filing (**hotel's** legal obligation) | Pilot (Maldives) | Hotel legal entity; Portico must calculate and report correctly | MIRA-confirmed rule set in `rates`; tested invoices; period report reconciled by hotel accountant | Hotel finance controller (obligation); Portico product (correct tooling) | Adviser `[quote required]` | Not published | On rate/rule change | MIRA rate or rule change; new supply types |
| L2 | Maldives green tax (hotel) | Pilot | Per guest-night by property class | Same as L1 | Hotel; Portico tooling | — | — | On change | Rate change, property class change (room count crosses 50) |
| L3 | MIRA tax-invoice requirements (hotel) | Pilot | Invoice content, numbering, currency | Adviser-confirmed template; sample invoices signed off by hotel accountant | Hotel; Portico tooling | Adviser `[quote required]` | — | On change | Rule change |
| L4 | Service-charge distribution (Employment Act) (hotel) | Pilot | Reporting of service charge collected | Confirmed rule; report signed off | Hotel HR/finance | — | — | — | Law change |
| L5 | Guest register / tourism & immigration reporting (hotel) | Pilot `[unconfirmed applicability]` | Fields, frequency, channel | Official requirement text; export tested | Hotel front office manager | — | — | — | Regulation change |
| L6 | Data protection — Maldives (no comprehensive law confirmed `[unconfirmed]`), GDPR/UK GDPR where applicable, other markets' laws | Now (design) / per market | Processing roles per purpose (`security-privacy-readiness.md` §2) | Counsel memo per market; DPA; records of processing | Founder + counsel | Counsel `[quote required]` | — | Annual review | New market; new processing purpose (e.g. AI); new sub-processor |
| L7 | US sanctions / export controls (Monoclay is a US company) | Now | Customer and sub-processor screening; restricted destinations | Screening procedure; records | Founder | Low `[estimate]` | — | Ongoing | New country or customer |
| L8 | Monoclay corporate compliance (Delaware annual obligations, US federal tax) | Now (existing — **excluded** from product cost) | Monoclay LLC | Company records | Founder | Existing | — | Annual | — |
| L9 | Tax on Monoclay's SaaS revenue (Maldives withholding/GST on digital services; US state sales tax later) | Pilot (if paid) | Monoclay | Adviser opinion | Founder + tax adviser | `[quote required]` | — | Annual | New market; pricing model change |
| L10 | US FTC rule on unfair or deceptive fees (all-in price for short-term lodging) | Later (US market) | Booking engine and feeds for US properties | Price display tests; Google price accuracy | Product | — | — | — | US launch `[verified 2026-11-07]` ([Federal Register](https://www.govinfo.gov/content/pkg/FR-2025-01-10/html/2024-30293.htm)) |
| L11 | Fiscalization / e-invoicing (DE, AT, IT, FR, PT, ES, KSA, UAE, India) | Later, per market | Fiscal ledger + country adapter | Middleware certification / authority acceptance | Product + Ops Readiness | `[quote required]` | Varies (dates in R04 §C3) | Per regime | Market entry |
| L12 | Consumer, accessibility and marketing laws (booking engine, guest messaging) | Later | Guest-facing surfaces | Counsel review; WCAG 2.2 AA audit `[assumption: target]` | Product | `[quote required]` | — | Per release | New market; booking engine launch |

## 2. Payment-network and acquiring requirements

| # | Item | Applies? | Scope | Evidence | Owner | Cost | Lead time | Renewal | Triggers |
|---|---|---|---|---|---|---|---|---|---|
| P1 | **PCI DSS — Monoclay as service provider** | Pilot if Portico hosts any page with payment fields/iframes or touches payment flows; **mandatory before** Booking.com direct, Channex PCI card access, enterprise sales | Systems that can affect the security of cardholder data (payment pages hosting PSP iframes, integrations, admin access). Target: **no cardholder data stored, processed or transmitted** by Portico. | Scoping memo; data-flow diagrams; responsibility matrix per PSP; for service providers the self-assessment is the **SAQ D for Service Providers**, or a QSA-led Report on Compliance at higher volumes — level thresholds and which applies must be confirmed with the PSP/acquirer/QSA `[unconfirmed]`. A merchant SAQ (e.g. SAQ A) is **not** sufficient for a service provider (readiness brief §8). | Founder (accountable) + security engineer | Self-assessment: staff time; QSA: `[quote required]` | Not published | Annual attestation `[unconfirmed]` | New payment flow; storing any card data; new PSP; OTA card handling without proxy |
| P2 | PCI DSS — hotel as merchant | Pilot (hotel's obligation) | Hotel's payment channels: PSP-hosted e-commerce pages (SAQ A eligibility depends partly on **our** page/script controls — 2025 SAQ A eligibility criterion `[verified 2026-11-07]` ([PCI SSC blog](https://blog.pcisecuritystandards.org/faq-clarifies-new-saq-a-eligibility-criteria-for-e-commerce-merchants))); terminals (SAQ B / B-IP / P2PE variants `[unconfirmed]`) | Portico provides CSP, SRI, script inventory, change detection evidence for payment pages; hotel completes SAQ with its acquirer | Hotel (obligation); Portico (supporting evidence) | Hotel's | — | Annual | Payment page changes |
| P3 | Card-scheme lodging rules (extended authorization ~30 days, incremental auth, MIT/CIT flags, no-show charges, descriptors) | Pilot (if processing via PSP) | Payment state machine per scheme | Sandbox tests per scheme; PSP confirmation of lodging eligibility | Payments engineer | — | — | On scheme rule change | `[verified 2026-11-07]` ([Stripe extended auth](https://docs.stripe.com/payments/extended-authorization)) |
| P4 | Strong customer authentication / 3-D Secure | Later (EEA/UK); Maldives acquirer rules `[unconfirmed]` | Booking engine, card-on-file mandates | Test evidence of 3DS at mandate set-up and MIT flags later `[verified 2026-11-07]` ([EBA Q&A](https://www.eba.europa.eu/single-rule-book-qa/qna/view/publicId/2019_4791)) | Payments engineer | — | — | — | Market entry |
| P5 | PSP/acquirer KYC & underwriting of each hotel | Pilot (if processing) | Hotel legal entity | Provider approval of hotel account | Hotel (applicant) | Hotel's | Not published | Ongoing reviews | Change of ownership/bank details |
| P6 | Platform agreements (Stripe Connect platform; Adyen for Platforms; local acquirer partner terms) | Pilot (if processing) | Monoclay as technology platform, **not** merchant or money transmitter | Signed agreements; platform review approval `[unconfirmed process]` | Founder | `[quote required]` | Not published | Contract term | New charge type; any flow where funds touch Monoclay (prohibited by D2) |

## 3. Provider-specific integration certifications

| # | Item | Applies? | Scope | Evidence | Owner | Cost | Lead time | Renewal | Triggers |
|---|---|---|---|---|---|---|---|---|---|
| C1 | **Channex PMS certification** | Pilot (if Portico manages OTAs) | Real Portico workflows: ARI, reservations, modifications, cancellations, mapping | Channex certification test suite passed through the product UI/API, recorded evidence `[verified 2026-11-07 that a suite exists]` | Distribution engineer | No setup fee published `[verified 2026-11-07]`; certification fee `[quote required]` | Not published | `[unconfirmed]` | Major distribution changes |
| C2 | Channex PCI certified partner (card access) | Optional | Card display via tokenised iframe / Payment Application API | Channex approval `[verified 2026-11-07 that approval is required]` | Payments engineer | `[quote required]` | Not published | `[unconfirmed]` | — |
| C3 | Booking.com Connectivity Partner (direct) | Later | Direct R&A, Reservations, Content, Payments, Messaging | Booking.com certification via Connectivity Support; PCI/PII compliance expected `[verified 2026-11-07]` | Distribution lead | — | Not published (R04 inference 3–9 months is an estimate, not a fact) | Ongoing API version changes | Booking.com deprecations (e.g. 31 Dec 2026 sunsets) |
| C4 | Expedia Group connectivity (direct) | Later | GraphQL reservations + webhooks; ARI | Expedia certification `[unconfirmed process]` | Distribution lead | — | Not published | — | API migrations |
| C5 | Agoda YCS partner (direct) | Later | YCS API | Agoda approval `[unconfirmed]` | Distribution lead | — | Not published | — | — |
| C6 | Google Hotel Center connectivity partner + price accuracy "Excellent" | Optional / later | ARI feed + booking engine landing pages | Price-accuracy score; partner approval `[verified 2026-11-07]` | Distribution + booking engine | Free for free booking links `[verified 2026-11-07]` | Not published | Continuous (score monitored) | Tax/fee rule changes |
| C7 | Meta WhatsApp: business verification, display name, template approval; Tech Provider status if Monoclay onboards hotels | Optional | Per hotel WABA | Meta approvals `[unconfirmed]` | Comms engineer + each hotel | Rate card `[quote required]` | Not published | Ongoing quality ratings | Template changes |
| C8 | Amazon SES production access; domain authentication | Pilot | Sending domains | SES production approval; DKIM/SPF/DMARC records `[unconfirmed process]` | Platform engineer | — | Not published | — | New domain (Q1) |
| C9 | Door-lock vendor partner programs (ASSA ABLOY, dormakaba, Salto) | Optional | Per lock product line & firmware | Vendor interface certification/sign-off `[unconfirmed]` | Integrations engineer | `[quote required]` | Not published | Per vendor release | Lock firmware/product change at hotel |
| C10 | POS partner programs (Oracle Simphony, Lightspeed, Agilysys, Toast) | Optional | Charge posting interface | Vendor sign-off `[unconfirmed]` | Integrations engineer | `[quote required]` | Not published | — | — |
| C11 | Oracle OHIP partner access (OPERA Cloud migration/coexistence) | Conditional | API usage | Partner registration; environment-owner approval `[verified 2026-11-07, sources conflict on route]` | Migration lead | Usage-based `[verified 2026-11-07]` | Not published | — | — |
| C12 | Accounting app partner programs (Xero, Intuit) / Salesforce AppExchange security review | Later (only for marketplace listing) | App listing | Vendor review `[unconfirmed]` | Integrations | `[quote required]` | Not published | — | — |
| C13 | Local acquirer integration sign-off (BML/MIB/other) | Pilot (if processing locally) | Gateway API | Bank sign-off `[unconfirmed]` | Payments engineer | `[quote required]` | Not published | — | — |

## 4. Contractual obligations

| # | Item | Applies? | Scope | Evidence | Owner | Notes |
|---|---|---|---|---|---|---|
| K1 | Customer agreement (MSA/terms), order form, SLA/support policy, DPA, sub-processor list | Pilot | Monoclay ↔ hotel organization | Signed documents after professional review (`business-documents-register.md`) | Founder + counsel | Must reflect *targets*, not untested promises |
| K2 | Channex agreement (SLA, exit, mapping export, PCI split, DPA) | Pilot (if Channex) | Monoclay ↔ Channex | Signed agreement | Founder | R04 open item 3 |
| K3 | PSP platform agreements and flow-down terms to hotels | Pilot (if processing) | See P6 | — | Founder | — |
| K4 | AWS customer agreement + data processing terms | Pilot | Hosting | Accepted terms `[unconfirmed]` | Founder | — |
| K5 | Anthropic commercial terms + DPA (or AWS Bedrock terms) | When AI enabled | AI processing | Accepted terms `[unconfirmed]` | Founder | Q25 |
| K6 | Meta / Twilio terms | When messaging enabled | Messaging | — | Founder / hotel | Hotel-owned accounts preferred `[assumption]` |
| K7 | Hotel ↔ OTA contracts (commissions, payment models) | Pilot | Hotel's own | — | Hotel | Not Monoclay's |
| K8 | Hotel ↔ source-system vendor (export rights, fees) | Pilot (migration) | Hotel's own | Written export authorization | Hotel | See migration checklist |
| K9 | Vendor branding / logo permissions (OTA logos, payment marks, Channex white-label) | Before any public material | Marketing | Written permissions | Founder | No logos without permission |

## 5. Customer procurement requirements (enterprise and groups)

Typical asks (R04 §C4, D4 — `[secondary, read 2026-11-07]` / `[unconfirmed]`): SOC 2 Type II report, ISO 27001
certificate, PCI service-provider AOC, annual penetration-test summary, security questionnaire (SIG/CAIQ), DPA and
sub-processor list, data residency, SSO (SAML/OIDC) and SCIM, MFA enforcement, audit logs, 99.9–99.95% uptime SLA with
credits, RPO/RTO, cyber insurance certificate, vulnerability disclosure, incident-notification commitments.

| # | Item | Applies? | Evidence we can produce early (no certification needed) | Owner | Trigger to invest |
|---|---|---|---|---|---|
| PR1 | Security questionnaire answers | Pilot (likely from groups) | Honest answers from the controls in `security-privacy-readiness.md`, marked implemented/planned | Founder + security | First group prospect |
| PR2 | Penetration test summary | Pilot (recommended before live guest data) | Independent test report; remediation log | Founder | Before pilot go-live (`[quote required]`) |
| PR3 | SSO/SCIM | Later | Implemented and tested | Engineering | First group/enterprise deal |
| PR4 | Data residency statement | Pilot | Region (Q4), sub-processor locations | Founder | RFP |
| PR5 | Insurance (cyber, professional liability) | Pilot | Broker quote and policy | Founder | Before signing first customer agreement |

## 6. Voluntary assurance programmes

| # | Programme | Applicability | What it is (and is not) | Cost | Lead time | Renewal | Decision trigger |
|---|---|---|---|---|---|---|---|
| VA1 | **SOC 2 (Type I, then Type II)** | Optional; common enterprise expectation in North America and increasingly elsewhere `[secondary, read 2026-11-07]` | Independent CPA attestation on controls (security + chosen criteria). Type II covers an observation period. **Not** a certification and **not** a legal requirement. | Audit + tooling — R04 estimate "about $100–250k per year" covers SOC 2/ISO programmes broadly and is an inference `[estimate]`; real figure `[quote required]` | Observation period length set with the auditor `[unconfirmed]` | Annual report | First enterprise/group deal that requires it (Q24) |
| VA2 | **ISO/IEC 27001** | Optional; often requested by European and Middle Eastern groups `[secondary, read 2026-11-07]` | Certification of an information-security management system by an accredited body. Not interchangeable with SOC 2. | `[quote required]` | `[unconfirmed]` | Certificate cycle with surveillance audits `[unconfirmed]` | Same (Q24) |
| VA3 | NIST SP 1800-27 (securing property management systems) mapping | Optional | Voluntary US reference `[secondary, read 2026-11-07]` | Staff time | — | — | US enterprise prospects |
| VA4 | ISO 27701 / CSA STAR | Optional | Privacy extension / cloud-security registry | `[quote required]` | — | — | Specific RFP |

## 7. Internal quality standards (our own gates — evidence required, never self-declared "certified")

| # | Standard | Evidence | Owner | Cadence |
|---|---|---|---|---|
| IQ1 | Readiness levels R1–R9 per capability, technical vs external approval separate | `readiness-register.md` rows with evidence links | Ops Readiness lead | Every merge that changes a capability |
| IQ2 | 20 operational proof scenarios (brief §17) + external-dependency scenarios (readiness brief §19) | Scenario test reports in `docs/scenarios/` | Engineering | Per release |
| IQ3 | Tenant isolation (app authz + RLS), incl. exports, reports, search, integrations, guessed IDs | Automated isolation suite in `packages/testing`; periodic manual test | Security | Every release |
| IQ4 | Backup restore verification | Automated restore drill logs (`support-recovery-plan.md` §5) | Platform | Weekly/quarterly |
| IQ5 | Migration rehearsal with reconciliation sign-off | Signed reconciliation report | Migration lead + hotel controller | Per hotel |
| IQ6 | Accessibility target WCAG 2.2 AA for staff and guest apps `[assumption]` | Automated + manual audit results | Design | Per release |
| IQ7 | Secure development (dependency scanning, SAST, secret scanning, code review) | CI logs | Engineering | Continuous |
| IQ8 | Incident response drills | Drill reports | Founder | Before pilot, then twice yearly `[assumption]` |
| IQ9 | Demo/sandbox safety (`assertExternalEffectAllowed` on every external-effect adapter) | Tests proving non-live environments cannot charge, message, publish, submit or spend | Engineering | Every adapter |

## 8. Open questions for professionals

1. **PSP/acquirer/QSA:** Given Portico hosts booking-engine pages embedding PSP iframes, receives OTA card data only via a
   proxy, and never stores PANs — what is Monoclay's PCI DSS validation requirement (SAQ D-SP vs ROC), and which brand/
   acquirer requires it at our volumes?
2. **QSA:** What evidence do hotels need from Monoclay to remain SAQ A–eligible on Portico-hosted payment pages?
3. **Counsel:** Do any Maldives laws require registration or approval of hotel/invoicing software? (None identified.)
4. **Auditor (when triggered):** SOC 2 scope and observation period suitable for a single-founder company; ISO 27001
   readiness path.
