# Business documents register

Readiness brief §20. Owner: founder (Monoclay LLC). Last updated: 2026-11-07.

**No document listed here is drafted, reviewed or approved as of 2026-11-07.** Any draft an AI or engineer produces is a
**working draft for professional review** and must never be presented to a customer, guest or provider as legally
approved. Reviewer types are recommendations; no adviser has been engaged (Q20).

Status values: Not started · Outline · Draft (unreviewed) · In professional review · Approved (date, reviewer) · Signed.

## 1. Customer-facing (Monoclay ↔ hotel organization)

| # | Document | Purpose | Reviewer | Status | Depends on | Renewal / triggers |
|---|---|---|---|---|---|---|
| D1 | Customer terms / master services agreement | Software licence, responsibilities (merchant of record = hotel; Monoclay not a payment provider), liability caps, acceptable use | US counsel; local counsel for Maldives enforceability | Not started | Q3 pricing; D2 | Annual review; new market |
| D2 | Order form / pilot agreement | Scope, edition, price, term, pilot success/exit criteria | US counsel | Not started | Q3, Q26 | Per customer |
| D3 | Pricing, billing, renewal and cancellation terms | Editions, billing cycle, taxes, late payment, renewal caps, cancellation | US counsel + tax adviser | Not started | Q3, Q20 | Price changes |
| D4 | Service level and support policy | Availability **targets**, support hours, severity definitions, credits (if any) — must match staffed capacity | US counsel | Not started | Q21; `support-recovery-plan.md` | Capacity change |
| D5 | Data processing agreement (DPA) | Monoclay as processor for hotel data (per-purpose roles), sub-processors, transfers, breach notice, assistance, deletion | Privacy counsel | Not started | `security-privacy-readiness.md` §2 | New sub-processor; new market |
| D6 | Sub-processor list | AWS, Channex, SES, Meta/Twilio (if Monoclay-operated), Anthropic/Bedrock, monitoring, support desk — with locations | Privacy counsel | Not started | Contracts | Every change (notice to customers) |
| D7 | Migration and onboarding statement of work | Responsibilities, data authorization, rehearsal, reconciliation sign-off, cutover/rollback, fees | US counsel | Not started | `migration-onboarding-checklist.md` | Per customer |
| D8 | Third-party charges and pass-through terms | OTA commissions, PSP fees, Channex add-ons, messaging, lock/POS licences — who pays whom | US counsel | Not started | `cost-model.md` §7 | Provider price changes |
| D9 | Data ownership, export and portability | Hotel owns its data; export formats; timelines | US counsel | Not started | Integration export features | — |
| D10 | Termination assistance and deletion | Export window, deletion certificates, backups ageing out | US + privacy counsel | Not started | Retention schedule | — |
| D11 | Incident communication policy | How and when hotels are told about incidents; status page | US + privacy counsel | Not started | Incident outline | — |
| D12 | Payments terms flow-down | Provider terms hotels accept (e.g. Stripe connected account agreement), Monoclay's "not the principal payment provider; does not hold funds" statement | US counsel + PSP | Not started | Route decision (Q2) | PSP changes |
| D13 | Merchant/payment-page security responsibilities (PCI responsibility matrix) | What Monoclay vs hotel vs PSP does for PCI | QSA / PSP | Not started | Certification matrix P1/P2 | Payment changes |

## 2. Guest-facing templates (hotel is the publisher; Monoclay provides templates)

| # | Document | Purpose | Reviewer | Status |
|---|---|---|---|---|
| G1 | Guest privacy notice template | Hotel as controller; purposes, retention, rights | Hotel's counsel (per market) | Not started |
| G2 | Booking terms / cancellation & no-show policy text templates | Snapshotted at booking; mandate for MIT charges | Hotel's counsel | Not started |
| G3 | Cookie/analytics notice for booking engine | — | Privacy counsel | Not started |
| G4 | Accessibility statement for booking engine | — | Counsel | Not started |
| G5 | Registration card template (Maldives fields) | Legal registration fields `[unconfirmed]` | Maldives adviser | Not started |

## 3. Monoclay internal and corporate

| # | Document / decision | Purpose | Reviewer | Status |
|---|---|---|---|---|
| M1 | Monoclay privacy notice (as controller for billing, product analytics, security logs) | — | Privacy counsel | Not started |
| M2 | Product-level bookkeeping policy | Keep Portico revenue/expenses identifiable within Monoclay (D1) | Accountant | Not started |
| M3 | Tax position memo: Maldives withholding/GST on SaaS; founder residence question; US sales tax | — | Tax adviser (US + Maldives) | Not started (Q20) |
| M4 | Insurance review (cyber, professional liability/E&O, general) | Appropriate cover and liability alignment with D1 | Insurance broker | Not started |
| M5 | Open-source licence inventory and policy | Licence compatibility for a commercial product (repository is UNLICENSED/proprietary) | Counsel (light) | Not started — automate inventory in CI |
| M6 | Commercial software licences | Third-party SDKs (lock vendors, POS) | Counsel | Not started |
| M7 | Vendor branding and redistribution permissions | OTA logos, payment marks, Channex white-label, partner badges — none used without written permission | Counsel | Not started |
| M8 | Trademark clearance for the final product name | Before public launch (Q1) | Trademark counsel | Not started |
| M9 | Contractor/employee IP assignment and confidentiality | All code owned by Monoclay | Counsel | Not started |
| M10 | Sanctions/export-control screening procedure | US company obligations | Counsel | Not started |
| M11 | Security policy set (access control, incident response, vulnerability management, vendor management, backup) | Basis for questionnaires and future SOC 2/ISO | Security lead | Not started |
| M12 | Vulnerability disclosure policy | Public contact for researchers | Security lead | Not started |
| M13 | Records retention policy | Implements `security-privacy-readiness.md` §4 | Privacy counsel | Not started |

## 4. Provider agreements to review before signing

| # | Agreement | Key points to check | Status |
|---|---|---|---|
| P1 | Channex commercial agreement | Pricing, VAT, overages, billing start, SLA, support, exit & mapping export, PCI split, DPA | Not started |
| P2 | Stripe Connect platform terms | Charge types, loss liability, fees, platform obligations | Not started |
| P3 | Local acquirer partner/aggregator terms (BML etc.) | Whether Monoclay must sign anything; liability | Not started |
| P4 | AWS customer agreement and DPA | Standard terms | Not started |
| P5 | Anthropic / Bedrock terms and DPA | Retention, training use, regions | Not started |
| P6 | Meta WhatsApp / Twilio terms | Roles, data, billing | Not started |

## 5. Recurring obligations tracker

| Obligation | Cadence | Owner | Trigger to revisit |
|---|---|---|---|
| Domain and TLS certificate renewals | Annual / automatic | Platform engineer | Expiry alerts |
| Provider API deprecations (e.g. Booking.com sunsets 31 Dec 2026 `[verified 2026-11-07]` — relevant only if direct) | Continuous | Distribution engineer | Provider changelogs |
| Channex price/terms re-verification | Before purchase and annually | Ops Readiness | Invoice changes |
| Tax-rule verification (MIRA) | Quarterly and on announcements | Ops Readiness + adviser | Budget announcements, gazette |
| Sub-processor list review | On change | Founder | New vendor |
| PCI attestation (if required) | Annual `[unconfirmed]` | Founder | Payment changes |
| Pen test | Annual + major change `[assumption]` | Founder | Major release |
| Insurance renewal | Annual | Founder | Contract changes |
| Credential/key rotation | Per policy | Platform engineer | Staff changes, incidents |
| Restore drills | Weekly/quarterly (`support-recovery-plan.md` §5) | Platform engineer | — |
