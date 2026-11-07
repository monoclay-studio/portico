# Launch checklist — five gates

Deliverable 10 of the operational-readiness brief (§21). Owner: Operational Readiness lead. Last updated: 2026-11-07.

**Rules (readiness brief §21):** every gate has evidence and a **responsible human decision-maker**. An unresolved
requirement blocks only the **affected capability or market**, not unrelated safe development. Paid contracts, live
guest transactions, live hotel connections and production data migrations require the owner's explicit authorization.
Development, research, documentation and safe (simulated/sandbox) testing continue without asking.

Decision-maker roles: **Founder** (Monoclay LLC owner — currently the only person who can authorize spend, contracts
and live activity), **Engineering lead**, **Operational Readiness lead**, **Hotel GM** (pilot hotel), **Hotel finance
controller**. Professional advisers give inputs; they are not gate decision-makers.

Current position (2026-11-07): **before Gate 1.** Foundation in progress; no module, environment or integration exists.

---

## Gate 1 — Demonstration

*Sample workflows work and external limitations are visible.*

| Required evidence | Status |
|---|---|
| Core workflows run end-to-end on sample data (guesthouse, ~120-villa resort, 3-property group — D8): search/create reservation, quote with Maldives taxes (TGST, green tax, service charge as configurable rules with sources), assign room, check-in, post charges, take simulated payment, check-out, Day Close | Not started |
| Each operational proof scenario (brief §17) demonstrated or explicitly marked "not yet" | Not started |
| Every external effect is simulated and **visibly labelled** (payments, channels, messages, AI, government reports) | Not started |
| Readiness register shows R2 only where demonstrated, with evidence links | Not started |
| Demo cannot charge cards, send guest messages, publish to channels, issue production keys, submit reports or make uncapped paid AI calls (tests for `assertExternalEffectAllowed`) | Not started |
| Demo incremental cost ≈ $0 (cost-model §3) and budget alert in place if hosted | Not started |
| Known limitations page (what is simulated, unavailable, unverified) | Not started |

| Blockers | Decision-maker | What proceeds meanwhile |
|---|---|---|
| Foundation + wave-1 modules not built | **Engineering lead** (Founder informed) | Everything else in development; this gate needs no external party |
| Tax rule data for Maldives unverified at primary source | Engineering lead may demo with labelled "unverified sample rules" | Demo proceeds with labels |

---

## Gate 2 — Sandbox integration

*Selected workflows work against approved test systems.*

| Required evidence | Status |
|---|---|
| Channex staging: ARI push, booking revisions ingest (create/modify/cancel, duplicates, out-of-order) through **real Portico workflows**, with acknowledgement evidence | Not started |
| Payment provider sandbox(es): Stripe test mode (Route A) and/or local acquirer sandbox (Route B, if one exists — `[unconfirmed]`); auth/increment/capture/release/refund/dispute webhooks; timeout-then-success (scenario 5); retried refund (scenario 6) | Not started |
| Email via SES sandbox to verified addresses; WhatsApp test number if enabled | Not started |
| AI against demo data with spend cap | Not started |
| Each sandbox result recorded as **R4** with what/where/when/who/result; never described as certification | Not started |
| Readiness-brief §19 dependency scenarios exercised in sandbox where possible (expired credentials, revoked permissions, provider outage, cost-limit exhaustion) | Not started |

| Blockers | Decision-maker | What proceeds meanwhile |
|---|---|---|
| Sandbox accounts not opened (Channex staging, Stripe Connect test platform, BML sandbox existence unknown) | **Founder** (accounts in Monoclay's name; free sandboxes) | Simulators, contract tests, provider-agnostic payment domain |
| Local acquirer API documentation not obtained | Founder (outreach) | Route D (record-only) built and tested |

---

## Gate 3 — Pilot preparation (for a named hotel)

*Dependencies, costs, contracts, migration, training, recovery and required approvals are resolved for a named hotel.*

| Area | Required evidence | Blocking if missing? |
|---|---|---|
| Named hotel | Signed pilot agreement/letter of intent with scope (modules, channels, outlets, hardware) | Yes |
| Market (Maldives) | Market-matrix §2 rows marked "must validate before pilot" confirmed by MIRA source and/or adviser; tax configuration signed by hotel accountant | Yes for invoicing/tax features |
| Payments | Route decided (responsibility-matrix §2). If A/B/C: provider approval of hotel account, sandbox evidence, live test plan. If D: SOP + reconciliation drill | Yes for the chosen route only |
| Distribution | Channex certification passed (if Portico manages OTAs); contract signed; hotel OTA authorizations planned; authority table agreed | Yes for distribution; pilot can run without channels if hotel keeps its CM **and** Portico does not touch inventory |
| Contracts | Customer agreement, DPA, support terms, pilot pricing (Q3) — professionally reviewed (`business-documents-register.md`) | Yes |
| Security | Pen test done and critical/high findings fixed; isolation suite green; MFA enforced; support-access controls live | Yes |
| Privacy | Processing roles and retention confirmed for the hotel's markets; guest privacy notice template provided to hotel | Yes |
| Migration | Rehearsal completed with signed reconciliation; cutover and rollback runbook timed | Yes |
| Training | Role-based training done on training environment; staff validation notes recorded | Yes |
| Recovery | Backup **restore verified** within the last 7 days `[target]`; continuity pack tested at the hotel (internet-loss drill) | Yes |
| Support | Support hours, contacts and escalation agreed and staffed as promised (Q21) | Yes |
| Costs | Cost model re-run with verified prices; Founder approved spend (AWS Q4, Channex Q23, pen test, advisers Q20) | Yes |
| Hardware | Lock/POS/terminal interfaces either tested with the hotel's actual models/firmware or excluded with manual alternatives | Yes for included hardware |

| Decision-makers | What proceeds meanwhile |
|---|---|
| **Founder** (Monoclay side) **and Hotel GM** (hotel side); **Hotel finance controller** signs reconciliation and tax configuration | All development; additional sandbox work; other hotels' discovery |

---

## Gate 4 — Controlled live pilot

*Authorized scope, monitoring, reconciliation, support, rollback and escalation are active.*

| Required evidence | Status |
|---|---|
| Founder's explicit written authorization for: production keys, live channel connection, live payment processing (if any), production data migration | Not started |
| Scope switches configured: only authorized modules/channels/payment routes enabled for the property | Not started |
| Monitoring and alerting live (availability, error rates, channel sync lag, payment pending-verification queue, Day Close status); on-call rota per support promise | Not started |
| Daily reconciliation running (payments vs PSP/terminal batches; channel bookings vs Channex; Day Close exceptions) with hotel sign-off cadence | Not started |
| Rollback procedure ready until end of rollback window (migration checklist §4.4) | Not started |
| Incident escalation tested (who, how, times) | Not started |
| Pilot success criteria and exit criteria agreed (e.g. zero unreconciled financial differences after N days; channel discrepancy rate; staff task times) `[targets to set with hotel]` | Not started |
| Readiness register updated to **R7** (configured & validated for this hotel) per capability, then **R8** only after operating successfully | Not started |

| Blockers | Decision-maker | What proceeds meanwhile |
|---|---|---|
| Any Gate 3 item open for an in-scope capability | **Founder + Hotel GM** jointly; either can stop the pilot | Out-of-scope capabilities stay in sandbox/demo |

---

## Gate 5 — Wider release

*Pilot evidence supports expansion; known limitations documented; support capacity matches the promise.*

| Required evidence | Status |
|---|---|
| Pilot report: incidents, reconciliation results, staff feedback (task completion times, errors, help needed), uptime vs targets | Not started |
| Known limitations published per capability and market | Not started |
| Support capacity matches advertised hours/SLA (cost-model §8); 24/7 claimed **only** if staffed | Not started |
| Market register: each new market validated before being offered | Not started |
| Capacity evidence at representative volumes (multi-property, peak check-in/out, channel bursts) — a small demo is not capacity evidence (readiness brief §19) | Not started |
| Provider approvals for the production scope (R6) documented per integration | Not started |
| Assurance items triggered by target customers (PCI SP validation, SOC 2/ISO decisions — Q24) | Not started |

| Decision-maker | What proceeds meanwhile |
|---|---|
| **Founder** (with Engineering lead and Ops Readiness lead sign-off) | Pilot continues under its scope |

---

## Blocker register (cross-gate)

| # | Blocker | Affected outcome | Owner | Next action | What proceeds meanwhile |
|---|---|---|---|---|---|
| B1 | Maldivian entities likely ineligible for Stripe/Adyen `[unconfirmed]` | Integrated card payments for Maldives pilot | Founder | Verify Stripe country list; request BML/MIB/"CBM" gateway docs (dependency register §8) | Route D (record-only) + simulator + Stripe sandbox for eligible entities |
| B2 | Maldives tax/invoice/service-charge rules unconfirmed at primary source | Live invoices, tax reports | Ops Readiness → adviser | Engage adviser (Q20); read MIRA publications when network allows | Tax engine with rules as data; demo with labelled sample rules |
| B3 | No pilot hotel | Gates 3–5 | Founder | Pilot outreach; choose pilot profile (Q26) | Everything before Gate 3 |
| B4 | No AWS account/region authorization | Hosted demo, staging, production | Founder | Q4 | Local development, Terraform written but not applied |
| B5 | Channex not contracted/certified | Managed OTA distribution | Founder + distribution engineer | Open staging; request terms (Q23) | OTA simulator; adapter boundary |
| B6 | Customer contract set not drafted/reviewed | Pilot agreement | Founder | Engage counsel | Business-documents register; draft outlines |
| B7 | Support promise undefined | Pilot agreement, staffing | Founder | Q21 | Runbooks and tooling |
| B8 | Pen test not scheduled | Pilot with live guest data | Founder | Quotes | Internal testing |
| B9 | Network access for verification (stripe.com, channex.io, mira.gov.mv, etc. blocked in agent sessions) | Verification of current claims | Founder / environment admin | Allow-list hosts or verify manually (README) | Labelled unconfirmed claims |
