# Operational readiness brief (owner's companion brief — verbatim)

> Mandatory companion to `docs/product/brief.md`. The owner states these are **recommendations to be
> applied with judgment**: preserve the outcomes they require, choose implementations that fit the project.
> Deliverables required by §22 live in `docs/readiness/`.

This is a mandatory companion to the hospitality platform product brief. Preserve the product ambition and user experience requirements already established, and incorporate everything below into the project's requirements, planning, acceptance criteria, and documentation.
We are building a serious hospitality platform intended to operate real hotels and resorts. Completing the code is only one part of completing the product.
Our definition of readiness must also account for external access, certification, commercial agreements, payments, jurisdictional requirements, infrastructure, migrations, staff training, ongoing support, and operating costs.
This brief defines required outcomes. Choose appropriate implementation approaches based on the actual project rather than treating it as a prescribed technology stack.

## 1. Business context and boundaries

The founder is based in the Maldives and owns Monoclay LLC, a Delaware company established through Stripe Atlas. Monoclay has a Stripe account and may operate several separate software products.
The hospitality product's name is not yet final.
Account for these distinctions:

* Monoclay's business and finances.
* This hospitality software product's revenue and expenses.
* Each customer organization.
* Each hotel's operating legal entity.
* Each brand, property, and outlet.
* Hotel owners and management companies.
* Guests, bookers, corporate accounts, travel agents, and payers.

Monoclay collecting a subscription fee for its software is different from a hotel collecting accommodation payments from guests.
Do not assume that Monoclay's US incorporation or existing Stripe account makes it eligible to collect, hold, or distribute money on behalf of hotels in every country.
Keep product-level bookkeeping identifiable even when several products operate under Monoclay. Guest funds must not be confused with software subscription revenue.
Treat Maldives resort operations as an important initial use case, but do not assume a particular hotel has agreed to pilot the software.

## 2. Maintain honest readiness statuses

For each feature and integration, distinguish:

1. Planned.
2. Demonstrated with sample data.
3. Implemented and tested internally.
4. Tested against the provider's sandbox.
5. Submitted for required external approval.
6. Approved for the specific production scope.
7. Configured and validated for a particular hotel.
8. Operating successfully in a controlled live pilot.
9. Supported for wider production use.

Track technical implementation and external approval separately. One must not imply the other.
Never describe a mock connection as a working integration, a successful API request as certification, or a provider's certification as certification of our entire platform.
Evidence should identify what was tested, where, when, by whom, and with what result.

## 3. Create a complete external dependency register

For every external service, identify:

* Business purpose and affected workflows.
* Whether it is necessary for the first pilot, optional, or needed later.
* Direct connection versus connection through an intermediary.
* Supported countries, property types, currencies, and capabilities.
* API access eligibility and application process.
* Sandbox availability, limitations, and expiry.
* Production access requirements.
* Certification, assessment, security review, or contractual requirements.
* Hotel authorization and credentials required.
* Who owns the account and who pays.
* One-time, recurring, usage, minimum, overage, and cancellation charges.
* Billing commencement date and any minimum commitment.
* Dependencies on hardware, local software, or another vendor.
* Rate limits, service commitments, support arrangements, and maintenance obligations.
* Consequences of outages, suspension, expired credentials, or termination.
* Data ownership, export, retention, deletion, and portability.
* Responsible owner, current status, supporting source, and verification date.

Label unavailable information as "unconfirmed" or "quote required." Never treat an unpublished fee as zero.
Keep provider claims, verified contractual terms, estimates, and our assumptions visibly separate.

## 4. Channel distribution and OTA connectivity

Evaluate Channex as a possible distribution intermediary without assuming it is the mandatory final choice.
A channel listed by an intermediary does not necessarily support every capability. Establish a capability matrix covering:

* Availability, rates, and restrictions.
* Reservations, modifications, and cancellations.
* Room and rate-plan mapping.
* Occupancy and child pricing.
* Promotions and derived rates.
* Taxes, fees, meal plans, and packages.
* Content and photographs.
* Guest messages and reviews.
* Payment information and virtual cards.
* Reservation recovery and reconciliation.
* Property onboarding and disconnection.

Explain which capabilities are supported, limited, unsupported, or unverified for each channel.
For direct connections, investigate the relevant supplier connectivity programs for Booking.com, Expedia Group, Airbnb, Agoda, wholesalers, bedbanks, GDS providers, and other selected channels.
Do not confuse APIs used to sell travel inventory with APIs used by hotels to distribute inventory and receive reservations.
Do not assume public documentation grants production access. Partner acceptance, commercial agreements, certification, and hotel authorization are separate dependencies.
Using an intermediary may simplify our approval obligations, but determine precisely what it covers and what remains our responsibility.
Hotel OTA commissions are separate from our connectivity provider's charges and our SaaS fees.

## 5. Channex planning baseline

Use the following published pricing only as a dated planning baseline, checked on 7 November 2026, and verify it again before purchasing:

* Platform fee: $130/month.
* Hotel channel manager: $7/month per property with an active channel.
* Optional hotel messaging and reviews: another $7/property/month.
* VAT, applicable extras, and overages are additional.
* Free staging is available for development.
* Production requires integration testing, certification, and OTA account authorization.

This implies $137/month for the base platform and one connected hotel, excluding extras and our own infrastructure.
Do not assume the platform fee disappears merely because no properties are connected after production subscription activation.
Certification must validate real PMS workflows. Standalone scripts that demonstrate API requests do not prove that the product itself works correctly.
Confirm current certification steps, commercial terms, size limits, optional fees, and production billing start directly from official documentation or the provider.

## 6. Integration correctness and hotel control

Distribution must handle delayed, duplicate, missing, and out-of-order events without silently corrupting reservations or inventory.
Require:

* Clear ownership of availability, rates, and restrictions.
* Correct mapping before activation.
* Evidence that updates were accepted by the downstream service.
* Detection of incomplete synchronization.
* Recoverable failures and understandable staff alerts.
* Safe disconnection and provider replacement.
* Reconciliation after outages.
* Visibility into what the PMS knows versus what a channel last acknowledged.

Never promise that all overbooking can be eliminated. Define prevention, detection, escalation, and resolution for situations outside our control.
Do not allow two systems to independently control the same live inventory during migration without an explicitly validated arrangement.

## 7. Payments and financial responsibilities

Document the actual money flow for each payment scenario.
Identify the merchant of record, payment processor, acquiring arrangement, recipient bank account, fees, settlement timing, refund responsibility, dispute responsibility, and reconciliation owner.
Cover:

* Monoclay charging hotels for software.
* Hotels collecting deposits and final balances.
* Online booking-engine payments.
* Front-desk card payments and terminals.
* Payment links.
* Authorizations, incremental authorizations, capture, release, and expiry.
* No-show and cancellation charges.
* Partial payments and split tenders.
* Refunds and partial refunds.
* OTA virtual cards.
* Payments collected by an OTA.
* Corporate credit and travel-agent settlement.
* Cash and bank transfers.
* Chargebacks, disputes, reserves, and failed payouts.
* Currency conversion and settlement differences.

Verify provider availability for the hotel's operating country and legal entity. A US software company's payment access does not establish payment eligibility for a Maldivian resort.
Treat payment collection on behalf of third parties as a separate business and compliance decision, not an automatic feature of our existing Stripe account.

## 8. Payment security and PCI scope

Determine the responsibilities of our platform, each hotel, the processor, and other involved providers.
Using hosted payment components or tokenization may reduce exposure; it does not automatically remove every PCI obligation.
Establish the applicable assessment and validation requirements with the relevant provider, acquirer, or qualified assessor where necessary. Do not assume that a merchant questionnaire is sufficient for a software service provider.
Our desired product boundary is that raw card details never enter ordinary application storage, logs, analytics, support tickets, AI prompts, or development environments.
Never retain card verification codes after authorization.
Verify token ownership and portability before promising that saved payment methods can move between systems.
Use approved test payment instruments in testing. Clearly distinguish authorization, capture, settlement, refund, and reconciliation in the interface.

## 9. Other hospitality integrations

Investigate external requirements for every selected integration category:

* POS and restaurant billing.
* Accounting and ERP.
* Revenue management and rate intelligence.
* Door locks, key encoders, and mobile keys.
* Identity and document verification.
* Guest registration and government reporting.
* Fiscal devices and electronic invoicing.
* Spa, activities, golf, and recreation.
* Transport, airport, boat, and seaplane operations.
* Procurement and inventory.
* Telephony, Wi-Fi, and in-room systems.
* Guest communication and CRM.
* Loyalty and corporate booking.
* Owner reporting.
* Business intelligence and data exports.

For hardware-dependent features, account for model compatibility, firmware, local gateways, installation, replacement equipment, licenses, and vendor support.
A documented API does not establish compatibility with a hotel's installed equipment.
Define safe manual alternatives when a lock, terminal, printer, network, or integration is unavailable.

## 10. Certifications, assessments, and legal requirements

Maintain a requirements matrix that distinguishes:

* Legal obligations.
* Payment-network or acquiring requirements.
* Provider-specific integration certifications.
* Contractual obligations.
* Customer procurement requirements.
* Voluntary assurance programs.
* Internal quality standards.

For each item, establish applicability, scope, evidence, owner, cost, lead time, renewal, and triggering changes.
Investigate PCI DSS, relevant OTA certifications, security assessments, local fiscal approvals, and any other requirements created by the chosen markets and features.
Evaluate SOC 2 reports and ISO 27001 certification as potential customer assurance requirements. Do not label them universally mandatory, interchangeable, or already obtained.
Do not invent a universal "hospitality software certification."
Do not display compliance badges, certification claims, or partner logos without the necessary evidence and permissions.

## 11. Country and market readiness

A global product must have an explicit supported-market register.
Before declaring a country supported, validate applicable requirements for:

* Accommodation taxes and tourism levies.
* VAT, GST, sales tax, and exemptions.
* Service charges and their treatment.
* Invoice numbering, credit notes, and fiscal reporting.
* Electronic invoicing and government submission.
* Guest registration and identity records.
* Passport and document retention.
* Currency, rounding, and exchange-rate treatment.
* Privacy, data location, and international transfers.
* Accessibility and consumer-facing disclosures.
* Payment authentication and local payment methods.
* Marketing and electronic communications.
* Record retention and audit access.

For Maldives operations, specifically investigate current tourism GST, Green Tax, service-charge treatment, reporting requirements, and relevant MIRA guidance.
Do not hard-code assumed tax rates or legal conclusions from memory. Preserve historical calculations when rules change.
Separate our software-company obligations from the hotel operator's obligations, while providing the functionality and evidence hotels need.

## 12. Privacy and data governance

Determine the parties' roles for each processing purpose rather than applying one label to every activity.
Cover hotel operational data, Monoclay's billing data, product analytics, support access, guest communication, and AI processing separately.
Require:

* Defined purposes and appropriate legal grounds.
* Data minimization.
* Relevant processing agreements and subprocessor disclosures.
* Retention schedules and legal holds.
* Access, correction, export, and deletion workflows.
* Appropriate international-transfer arrangements where applicable.
* Restricted access to identity documents and sensitive guest information.
* Clear control over guest-profile sharing between properties.
* Controlled support access with recorded reasons.
* Incident and breach response procedures.
* Separate production and training data.

Do not assume consent is the correct basis for every hotel operation, or that withdrawing marketing consent requires erasing legally retained financial records.
Do not assume GDPR applicability solely from a guest's nationality. Assess the actual processing and relevant jurisdiction.

## 13. Security and enterprise administration

Set acceptance criteria for:

* Isolation between customer organizations.
* Property, department, role, and field-level access where justified.
* Multifactor authentication for privileged access.
* Staff onboarding, transfers, and termination.
* Enterprise identity integration when required.
* Controlled emergency access.
* Audit trails for financial, security, and operational changes.
* Secure credential management and rotation.
* Encryption and access restrictions.
* Protection of exports and uploaded files.
* Vulnerability management and dependency maintenance.
* Independent security testing appropriate to launch risk.
* Abuse prevention and suspicious activity detection.
* Secure support and administrative tools.

A user with a valid login must still be prevented from accessing another hotel's data through exports, reports, search, integrations, or guessed identifiers.
Document what evidence establishes that these controls work.

## 14. Communications and AI services

For email, SMS, WhatsApp, voice, and push notifications, identify:

* Provider accounts and approvals.
* Sender identities and domain setup.
* Template or business-verification requirements.
* Country restrictions.
* Consent and unsubscribe requirements.
* Per-message, conversation, or usage charges.
* Delivery failures and fallback options.
* Language support and retention.
* Duplicate-message prevention.

For AI capabilities, identify inference, transcription, voice, embedding, retrieval, storage, and monitoring costs where applicable.
A Claude development subscription does not automatically pay for AI features used by hotel staff or guests inside the deployed product.
AI must respect the same permissions as the user. Sensitive data must not be sent to models without appropriate authorization and provider arrangements.
Treat guest messages and imported documents as untrusted input. They must not be able to instruct an AI assistant to disclose data or perform unauthorized actions.
Critical hotel operations must remain usable when AI services are unavailable or their budget is exhausted.

## 15. Infrastructure and recurring operating costs

Account for the deployed product independently of the development environment.
Include:

* Application hosting and background processing.
* Databases and file storage.
* Network traffic and data export.
* Backups and disaster recovery.
* Logs, monitoring, and error reporting.
* Security services.
* Staging and testing environments.
* Domains and email.
* Integration subscriptions.
* Communications and AI.
* Software licenses.
* Support systems.
* Human operations, maintenance, and incident response.

For free tiers, verify commercial-use terms, quotas, sleeping or pausing, retention, backup availability, and service commitments.
Do not treat development credits or introductory offers as permanent zero-cost infrastructure.
Include costs created by staff usage, stored documents, integration traffic, and retained data even when no new guest bookings occur.

## 16. Zero-cost demonstration mode and cost control

We want to keep incremental spending as close to zero as practical before a committed hotel pilot.
Support a useful demonstration environment using sample data, local resources or suitable free tiers, and approved sandboxes.
Clearly identify existing subscriptions and company expenses excluded from that calculation.
Demonstration mode must not accidentally:

* Charge real cards.
* Send guest communications.
* Publish availability to live channels.
* Issue production keys.
* Submit government reports.
* Trigger uncontrolled paid AI or background usage.

Show which capabilities are simulated, sandbox-tested, or unavailable.
Require usage visibility, alerts, and enforceable limits where supported. Distinguish a budget notification from a hard spending cap.
Prepare cost scenarios for zero live hotels, one pilot, and 10, 50, and 100 properties. State assumptions for room count, users, bookings, documents, messages, and AI usage.
Separate fixed costs, variable costs, one-time onboarding expenses, and hotel-paid charges. Show expected cost per property and sensitivity to heavy usage.

## 17. Reliability, recovery, and continuous operation

Define measurable service objectives appropriate to a hotel operating around the clock.
Specify proposed availability targets, acceptable data loss, and acceptable recovery time. Mark them as targets until supported by testing and actual operational capacity.
Account for:

* Internet failure at the property.
* Provider and cloud outages.
* Delayed background work.
* Failed deployments.
* Corrupted or accidentally changed data.
* Lost credentials and compromised accounts.
* Hardware failures.
* Incomplete night audit.
* Business-date and timezone differences.
* Daylight-saving changes where relevant.

Backups must be restored and verified in tests. Their existence alone is insufficient.
Provide practical continuity procedures for reception, housekeeping, payments, arrivals, departures, and emergency guest information.
Define who responds to incidents, how hotels contact them, escalation times, and communication responsibilities.
Do not claim 24/7 support simply because the application is hosted continuously.

## 18. Hotel migration and onboarding

Before a hotel goes live, establish:

* Authorized data access and export rights.
* Source-system export limitations and vendor charges.
* Data mapping and quality checks.
* Property configuration and room inventory.
* Rates, packages, taxes, and policies.
* Future reservations and group blocks.
* Deposits, open folios, accounts receivable, and balances.
* Guest profiles and communication preferences.
* OTA mappings.
* Payment and hardware configuration.
* User roles, training, and operating procedures.

Perform a migration rehearsal and obtain agreement on reconciliation results.
Do not promise transfer of stored cards, tokens, historical documents, or audit records without verifying portability.
Define the cutover window, authoritative systems, handling of bookings arriving during cutover, and rollback procedure.
Rollback must account for transactions created after cutover. Restoring an old backup must not silently erase new reservations or financial activity.

## 19. Quality and acceptance evidence

Preserve all acceptance scenarios from the main brief and extend them to cover external dependencies.
Require evidence for:

* Concurrent attempts to sell the last room.
* Delayed, duplicated, and reordered channel updates.
* Missing bookings recovered after an outage.
* Expired credentials and revoked hotel permissions.
* Payment timeouts followed by a successful charge.
* Retried refunds and duplicate callbacks.
* Interrupted night audit and recovery.
* Tax or rate changes affecting future versus historical records.
* Cross-property access attempts.
* Stale offline updates.
* Backup restoration.
* Migration balance discrepancies.
* Provider suspension.
* Cost-limit exhaustion.
* Staff error and recovery.

Test through real product workflows wherever the claim concerns user-facing functionality.
Use representative reservation volumes, multi-property workloads, and peak activity. A small demonstration is not evidence of enterprise capacity.
Have hotel staff validate workflows. Distinguish automated test coverage from operational acceptance.

## 20. Contracts, support, and commercial readiness

Prepare a register of required business documents and decisions, including:

* Customer terms and service agreements.
* Pricing, billing, renewal, and cancellation.
* Processing agreements and privacy notices.
* Support scope and service commitments.
* Migration and onboarding responsibilities.
* Third-party charges and pass-through billing.
* Data ownership and export.
* Termination assistance and deletion.
* Incident communication.
* Appropriate insurance and liability review.
* Open-source and commercial software licensing.
* Vendor branding and redistribution permissions.

Identify documents needing professional review rather than representing generated drafts as legally approved.
Track ongoing renewals, certificate expiry, mandatory API changes, vendor deprecations, security reviews, and recurring compliance work.

## 21. Launch gates

Define explicit gates for:
Demonstration: sample workflows work and external limitations are visible.
Sandbox integration: selected workflows work against approved test systems.
Pilot preparation: dependencies, costs, contracts, migration, training, recovery, and required approvals are resolved for a named hotel.
Controlled live pilot: authorized scope, monitoring, reconciliation, support, rollback, and escalation are active.
Wider release: pilot evidence supports expansion, known limitations are documented, and support capacity matches the promise.
Each gate must have evidence and a responsible human decision-maker.
An unresolved requirement should block the affected capability or market. It should not automatically block unrelated safe development.
Do not activate paid contracts, live guest transactions, live hotel connections, or production data migrations without explicit authorization. Continue ordinary development, research, documentation, and safe testing without repeatedly requesting permission.

## 22. Required deliverables and working approach

Start by inspecting the existing project and comparing it against this brief. Preserve working functionality.
Produce and maintain:

1. A gap assessment against the product and operational requirements.
2. The external dependency register.
3. A provider capability matrix.
4. A certification and approval matrix.
5. A supported-market and jurisdiction matrix.
6. A cost model with transparent assumptions.
7. A responsibility matrix covering Monoclay, hotels, and providers.
8. A security and privacy readiness assessment.
9. A migration and onboarding checklist.
10. A launch checklist with evidence and blockers.
11. An operational support and recovery plan.
12. A prioritized delivery roadmap and external critical path.

For every blocker, identify the affected outcome, owner, next action, and what can proceed meanwhile.
Research official documentation before making current claims. Record source URLs and verification dates. Where public documentation cannot settle a requirement, identify the precise question that needs provider or professional confirmation.
Do not invent approval timelines, negotiated prices, partnerships, certifications, legal conclusions, or completed work.
Ask the founder only for decisions that materially affect scope, spending, commercial commitments, or live operations. Explain those decisions in plain English.
The goal is a powerful, dependable hospitality product with an excellent user experience and a credible path to operating real hotels. Treat "flawless" as an ambition supported by measurable quality, recovery, and continuous improvement—not a claim that software can never fail.
