# Security and privacy readiness assessment

Deliverable 8 of the operational-readiness brief (§8, §12, §13, §14). Owner: Operational Readiness lead with the
security engineer; legal characterisations require counsel review (not engaged — Q20). Last updated: 2026-11-07.
Labels as defined in `dependency-register.md`.

Current state: the codebase is a **foundation in progress** (`packages/kernel`: ids, Money, dates, errors, request
context, events, module manifest). No authentication, database, RLS, encryption, audit or hosting exists yet. Every
control below is therefore **Planned (R1)**. "Evidence required" says what must exist before a control may be called
working.

---

## 1. Acceptance criteria — security and enterprise administration (readiness brief §13)

| # | Criterion (acceptance) | Planned design | Evidence required | Status |
|---|---|---|---|---|
| SEC-1 | **Organization isolation.** A user with a valid login cannot read or change another organization's data through UI, API, exports, reports, search, integrations, webhooks, files or guessed identifiers. | App-level authorization **and** Postgres RLS forced on every tenant table; `withTenantTx`; UUIDv7 IDs (unguessable but never relied on); tenant-scoped storage prefixes and signed URLs; search index filtered by tenant | Automated isolation suite covering every endpoint, export, report, search and webhook; DB-level test that a query without tenant context returns nothing; independent pen test result (scenario 17) | Planned |
| SEC-2 | **Property / department / role / field-level access** where justified | Permission keys `<module>.<resource>.<action>` scoped to org/brand/region/property/department; field-level masks for ID documents, guest medical/allergy notes, card metadata, payroll-like data | Permission matrix tests per role; denial tests; UI hides and API refuses | Planned |
| SEC-3 | **MFA for privileged access** (admins, finance, support staff, Monoclay operators) | TOTP and passkeys (WebAuthn); MFA mandatory for privileged roles; SMS OTP not used for privileged roles | Login tests; policy enforcement test; Monoclay operator accounts audited | Planned |
| SEC-4 | **Staff onboarding, transfers, termination** | Role assignments with start/end dates; property transfer moves scope; termination revokes sessions/API keys immediately; leaver report | Tests: terminated user's sessions invalid within one request; audit entries | Planned |
| SEC-5 | **Enterprise identity integration when required** | SAML 2.0 / OIDC SSO and SCIM provisioning (later wave) | Interop tests with at least two IdPs | Planned (later) |
| SEC-6 | **Controlled emergency access** ("break-glass") | Time-boxed elevation with mandatory reason, second-person notification, automatic expiry, full audit | Drill evidence; audit trail sample | Planned |
| SEC-7 | **Audit trails** for financial, security and operational changes | Append-only `audit` rows (actor, action, target, before/after, reason); DB grants forbid update/delete; export for hotels | Test that audit rows cannot be modified by the app role; sample trails for scenarios 5, 6, 9, 15 | Planned |
| SEC-8 | **Credential management and rotation** | Secrets in AWS Secrets Manager; per-hotel provider credentials encrypted per legal entity; rotation runbook; no secrets in code/logs | Secret scanning in CI; rotation drill; log redaction tests | Planned |
| SEC-9 | **Encryption and access restriction** | TLS everywhere; encryption at rest (RDS, S3, backups) with KMS; envelope field encryption for identity documents (`packages/db/crypto`) | Config evidence (Terraform); test that ID fields are ciphertext in DB | Planned |
| SEC-10 | **Protection of exports and uploads** | Exports permissioned, watermarked with requester, time-limited signed URLs, logged; uploads malware-scanned, type-checked, size-limited; guest documents never public | Tests for unauthorized export download; scan pipeline test | Planned |
| SEC-11 | **Vulnerability and dependency management** | Dependency scanning, SAST, container image scanning, patch SLAs (targets), lockfile review | CI reports; patch log | Planned |
| SEC-12 | **Independent security testing** appropriate to launch risk | External penetration test before pilot go-live with live guest data; retest after fixes | Report + remediation evidence (`[quote required]`) | Planned |
| SEC-13 | **Abuse prevention and suspicious activity detection** | Rate limits, login throttling, anomaly alerts (mass export, unusual hours, impossible travel), WAF | Alert tests; WAF config | Planned |
| SEC-14 | **Secure support and admin tools** | See §5 (support access) | Audit samples; approval flow tests | Planned |
| SEC-15 | **Payment security boundary** — raw card data never in application storage, logs, analytics, tickets, AI prompts or dev environments; CVV never retained | PSP hosted fields/terminals; OTA cards via PCI proxy; log/ticket/AI redaction of PAN patterns; payment-page CSP + SRI + script inventory + change detection | Data-flow diagram; PAN-detection tests on logs/tickets/AI inputs; SAQ evidence pack (certification matrix P1/P2) | Planned |
| SEC-16 | **Demo/sandbox safety** | `assertExternalEffectAllowed` on every external-effect adapter | Tests per adapter that non-live environments cannot effect real-world actions | Planned |

## 2. Processing roles per purpose (readiness brief §12 — one label is **not** applied to everything)

Proposed characterisation, framed in GDPR-style controller/processor terms because they are widely understood;
whether GDPR or another law applies is decided per hotel and per market (market matrix §2.9). **All rows require
counsel review.**

| # | Purpose | Data | Hotel | Monoclay | Others | Proposed legal basis (examples) | Notes |
|---|---|---|---|---|---|---|---|
| PR-1 | Hotel operations: reservations, stays, folios, housekeeping, maintenance | Guest identity, contact, stay, preferences, charges | **Controller** | **Processor** | Sub-processors: AWS, Channex, SES | Contract with guest; legal obligation (tax, registration); legitimate interests | Monoclay acts only on documented hotel instructions (DPA) |
| PR-2 | Guest registration / government reporting | ID documents, nationality, passport numbers | **Controller** | Processor | Authorities (recipients) | Legal obligation `[unconfirmed per market]` | Field-encrypted; restricted roles; shortest lawful retention |
| PR-3 | Payments | Tokens, last-4, payment metadata | Controller | Processor | PSP: typically independent controller for KYC/fraud/scheme duties `[unconfirmed per PSP terms]` | Contract | No PAN in Portico |
| PR-4 | OTA bookings | Booking data from OTAs | Controller | Processor | OTA: independent controller for its own customer; Channex: sub-processor | Contract | — |
| PR-5 | Guest communications (email, WhatsApp, SMS) | Messages, phone/email | Controller | Processor | Meta/Twilio: role per their terms `[unconfirmed]` | Contract / legitimate interests; **marketing** needs the market's consent rules | Marketing opt-out never erases legally retained financial records |
| PR-6 | AI features on hotel data | Prompts containing guest/stay data | Controller | Processor | Anthropic (or AWS Bedrock): sub-processor `[unconfirmed terms]` | Same as underlying purpose; hotel must enable (Q25) | Minimisation; no card data; per-tenant opt-in |
| PR-7 | Cross-property guest profile sharing within an organization | Profiles shared across properties | Organization's legal entities — possibly **joint controllers** when entities differ `[unconfirmed]` | Processor | — | Legitimate interests / consent depending on market | Sharing controlled by organization policy + consent rules (brief §7) |
| PR-8 | Monoclay SaaS billing and account management | Hotel org contacts, billing details | Hotel = customer | **Controller** | Stripe: processor/independent controller per terms `[unconfirmed]` | Contract | Separate from guest data |
| PR-9 | Product analytics (feature usage) | Staff user usage events, pseudonymised | — | **Controller** for aggregated/pseudonymised usage `[proposal]` | Analytics tool if any | Legitimate interests `[proposal]` | No guest data in product analytics; staff can be informed via hotel |
| PR-10 | Platform security logging and abuse detection | Staff IPs, login events | Controller for its tenant audit trail | **Controller** for platform security logs `[proposal]`; processor for tenant audit logs | AWS | Legitimate interests / legal obligation | Retention limited (§4) |
| PR-11 | Support | Data viewed during support sessions | Controller | Processor (acting on hotel request); **controller** for support-ticket metadata `[proposal]` | Help-desk vendor: sub-processor | Contract | Access controls §5 |
| PR-12 | Demo, training and testing | Synthetic data only | — | Controller of synthetic data | — | — | **Production data never copied** to demo/training/dev (brief §12) |

## 3. Privacy requirements (readiness brief §12) — planned controls and evidence

| Requirement | Planned control | Evidence required |
|---|---|---|
| Defined purposes and legal grounds | §2 table maintained as a record of processing | Counsel-reviewed record |
| Data minimisation | Registration fields configurable per market; optional fields off by default | Field inventory per market |
| Processing agreements & sub-processor disclosure | DPA + public sub-processor list with locations; change notification | Signed DPA; published list |
| Retention schedules & legal holds | §4 schedule as data; legal hold flag stops deletion | Retention job tests; hold test |
| Access, correction, export, deletion workflows | Guest data request tooling for hotels (search, export, correct, anonymise) with fiscal records locked | Workflow tests; sample export |
| International transfers | Region choice (Q4); transfer mechanisms per market `[unconfirmed]` | Counsel memo |
| Restricted access to identity documents & sensitive info | Field encryption + specific permission + view logging | Access log samples |
| Control over cross-property sharing | Organization policy with property overrides; consent flags | Tests |
| Controlled support access with recorded reasons | §5 | Audit samples |
| Incident and breach response | §6 | Drill report |
| Separate production and training data | Separate tenants/environments; no copy path from live to demo | Infrastructure review |

## 4. Retention schedule — draft `[assumption — requires counsel and Maldives adviser confirmation]`

Defaults are configurable per hotel and market; a hotel may shorten only within legal minimums and may extend for
legal holds. Statutory periods for the Maldives are **unconfirmed** (market matrix §2.10).

| Data category | Proposed default | Basis | End-of-retention action |
|---|---|---|---|
| Fiscal documents (invoices, credit notes), ledger postings | Keep until the hotel's statutory period is confirmed; default **indefinite** within tenant | Tax law `[unconfirmed period]` | Delete document and anonymise links when period ends |
| Folios, payments, refunds, disputes metadata | Same as fiscal | Tax / dispute evidence | Same |
| Reservations and stay records | Statutory/accounting period; operational detail anonymisable earlier | Contract + accounting | Anonymise guest identity, keep statistics |
| Guest profile (non-fiscal) | While relationship active + configurable inactivity period (e.g. 3 years `[assumption]`) | Legitimate interests | Anonymise |
| Marketing consents and preferences | Life of consent + proof period | Consent records | Delete preference, keep proof of withdrawal |
| Identity document images / numbers | **Shortest lawful period**; default delete images N days after check-out unless law requires longer (N per market `[unconfirmed]`) | Legal obligation `[unconfirmed]` | Crypto-shred field key |
| OTA virtual-card metadata | Until charge settled + dispute window | Payment | Delete (R04 notes one vendor purges 14 days after check-out `[secondary, read 2026-11-07]`) |
| Card tokens | Until guarantee/no-show/dispute window ends or guest removes | Contract | Detach token at PSP |
| Guest messages | Configurable (e.g. 2 years `[assumption]`) | Legitimate interests | Delete/anonymise |
| AI prompts/outputs stored by Portico | Short (e.g. 30 days `[assumption]`) unless saved by user into a record | Purpose limitation | Delete |
| Audit logs | Long (e.g. 7 years `[assumption]`) — append-only | Accountability, fraud | Archive then delete |
| Platform security logs | e.g. 1 year hot `[assumption]` | Security | Delete |
| Backups | Rolling (e.g. 35 days PITR + monthly snapshots for 12 months `[assumption]`) | Recovery | Expire; deletions propagate as backups age out (documented) |
| Monoclay billing records | Monoclay's statutory period `[unconfirmed]` | Tax | Delete |

## 5. Support access controls

| Control | Design |
|---|---|
| Default | Monoclay staff have **no standing access** to tenant data. |
| Request | Access is requested from a support ticket, with reason, scope (organization/property, read-only vs write) and duration. |
| Approval | Hotel-configurable: automatic for read-only within a ticket, or hotel admin approval required; write access always requires hotel approval except declared emergencies. |
| Session | Time-boxed (e.g. 60 minutes `[assumption]`), MFA re-check, visible banner to the support user, hotel sees active support sessions in real time. |
| Masking | ID documents, card metadata and sensitive notes masked unless the ticket scope requires them. |
| Logging | Every view and action audited with ticket ID; monthly access report to the hotel. |
| Prohibited | Bulk export by support; copying production data to non-production; support tickets containing card data (redaction on ingest). |
| Break-glass | §1 SEC-6, with founder notification and post-incident review. |

## 6. Incident and breach response — outline

| Phase | Actions | Evidence |
|---|---|---|
| Detect | Alerts (monitoring, anomaly detection, provider notices, hotel reports) open an incident with severity (SEV1 data exposure / outage of core operations; SEV2 degraded; SEV3 minor) | Incident record |
| Triage (target: within 30 minutes of alert during covered hours `[target]`) | Incident commander assigned; scope, data categories, tenants affected | Timeline |
| Contain | Revoke credentials, isolate components, block attacker paths; preserve logs (legal hold) | Actions log |
| Assess | Personal data involved? Which hotels (controllers)? Which jurisdictions? | Assessment memo |
| Notify | Notify affected hotels **without undue delay** with facts known, data categories, measures, contact; hotels decide notifications to guests/authorities as controllers; Monoclay notifies authorities where it is itself controller (PR-8–PR-10). Statutory deadlines vary by law (e.g. 72 hours to the supervisory authority for controllers under GDPR) `[unconfirmed applicability per market]`; contractual notice target `[target — define in DPA]` | Notification copies |
| Recover | Restore from verified backups if needed; forward-only corrections for financial data | Restore log |
| Review | Post-incident review within 5 business days `[target]`; actions tracked | Review report |

Roles: Incident commander (founder during pilot), technical lead, communications lead (hotel liaison), scribe. See
`support-recovery-plan.md` §4 for escalation.

## 7. AI-specific controls (readiness brief §14)

| Control | Design | Evidence |
|---|---|---|
| Same permissions as the user | Retrieval through the same permission-checked service APIs; no direct DB access by the AI layer | Tests: AI cannot cite records the user cannot open |
| Cited answers | Answers about guests/bookings/balances cite record links; unsupported claims refused | Evaluation set |
| No invented outcomes | AI cannot state payment results, availability, policies or confirmations — these come from tools reading authoritative state | Tests |
| Prompt injection | Guest messages and imported documents are untrusted; they are passed as data, never as instructions; actions are **proposals requiring human approval** | Red-team test set |
| Sensitive data | No card data; ID documents excluded; hotel opt-in per property (Q25); provider terms in place | Config + DPA |
| Budget exhaustion / outage | All critical workflows work without AI; AI panels show "unavailable" | Chaos test |

## 8. Gaps and blockers

| Gap | Affected outcome | Owner | Next action | Proceeds meanwhile |
|---|---|---|---|---|
| No counsel review of processing roles, DPA, retention | Pilot contract readiness | Founder | Engage counsel (Q20) | Engineering builds configurable retention and DSR tooling |
| Maldives retention/registration rules unconfirmed | Retention defaults; registration fields | Ops Readiness | Adviser questions (market matrix §2.12) | Conservative defaults, configurable |
| No pen test budgeted | Pilot gate | Founder | Obtain quotes | Internal security testing, isolation suite |
| AI provider terms not reviewed | AI enablement for live hotels | Founder | Review Anthropic/Bedrock DPA (Q25) | AI built against demo data only |
| PCI service-provider scope not confirmed | Payment flows, OTA cards | Founder + payments engineer | Ask PSP/QSA (certification matrix §8) | Build with hosted fields + proxy design |
