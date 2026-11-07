# Adoption, integration and migration brief (owner's final product ambition — verbatim)

> Third owner brief. Extends `docs/product/brief.md` and `docs/product/operational-readiness-brief.md`;
> all previous requirements still apply. Deliverables required by §15 live in `docs/adoption/`.

Extend the existing hospitality platform brief with the following requirements. Preserve the previous operational, financial, security, certification, and launch requirements.

## 1. Product ambition

Our ambition is to build the easiest hospitality platform to integrate, evaluate, adopt, and operate—from an independent property to a multinational hotel group.
Hotels should be able to experience meaningful value before committing to a full migration. They should be able to retain systems they like, adopt our capabilities gradually, and replace existing systems when the benefits justify it.
Treat ease of integration and migration as core product capabilities, with the same importance as reservations, front desk, finance, and guest experience.
"Better, faster, and more efficient" must translate into measurable improvements: fewer steps, less repeated data entry, shorter onboarding, fewer reconciliation problems, faster staff training, and quicker recovery from mistakes.
Treat market leadership as an ambition to validate against competitors, not an unsupported marketing claim.

## 2. Three supported adoption paths

Support three clearly defined ways to use the platform:
Connect alongside existing systems.
The property keeps its current PMS or other applications and uses selected capabilities from our platform. Clearly identify the information we can read, actions we can perform, and limitations.
Replace selected capabilities.
The property adopts our housekeeping, guest communications, reporting, or other independently usable modules while keeping its remaining systems.
Migrate to our full platform.
The property adopts our PMS and selected operational modules, retaining compatible external tools where preferred.
Not every module can operate independently without dependencies. Document those dependencies before offering it.
For every adoption path, establish which system controls reservations, availability, guest records, charges, payments, and room status. Prevent competing systems from independently modifying the same information without defined coordination.

## 3. A useful trial before migration

Cloud delivery should make evaluation accessible through a browser. However, hosting in the cloud does not itself make live-system experimentation safe.
Provide distinct evaluation stages:

* An immediately usable demonstration with realistic sample properties and workflows.
* An isolated trial using an authorized copy of the hotel's data.
* An optional read-only connection to supported existing systems.
* A controlled pilot with narrowly defined permissions and scope.
* A separately approved production activation.

Clearly show which environment the user is in and whether information is simulated, copied, live, delayed, or incomplete.
Trial activity must not accidentally alter live rates, inventory, reservations, accounting records, payments, door keys, government submissions, or guest communications.
Prevent trial notifications and background jobs from reaching real guests or production services.
Read-only connections still require appropriate authorization and data protection. Do not assume every vendor permits them or provides complete data.
Allow the hotel to reset, export, or delete its trial according to applicable retention obligations. Define what configuration can safely carry forward into production.

## 4. Show value using the hotel's own operation

A trial should help a property assess real questions:

* Can reception handle arrivals and room changes more easily?
* Can housekeeping see and complete work faster?
* Can finance reconcile deposits, charges, and balances?
* Can management understand performance across departments and properties?
* Can existing channels and applications work with our platform?
* What information or functionality would be lost during migration?
* What would adoption cost, and what work remains?

Where authorized and supported, compare our results with existing reports and workflows.
Show discrepancies for investigation rather than silently declaring our interpretation correct.
Make it possible to validate proposed configuration changes without applying them to live systems.

## 5. Broad integration coverage

Build a maintained integration catalogue covering:

* PMS and central reservation systems.
* Channel managers, OTAs, wholesalers, and distribution networks.
* Booking engines.
* Accounting, ERP, accounts payable, and financial reporting.
* POS and restaurant systems.
* Housekeeping and maintenance applications.
* Payment processors, terminals, and payment links.
* Door locks, key encoders, and mobile keys.
* Revenue management and rate intelligence.
* CRM, loyalty, guest communications, and reputation management.
* Spa, golf, activities, recreation, and transport.
* Procurement, stock, and inventory.
* Identity, guest registration, fiscal, and government reporting.
* Enterprise identity, analytics, and data platforms.

Research and prioritize actual providers used by our target customers, including independent hotels, resorts, regional groups, and large international operators.
Do not claim "most major systems" based on the number of logos in a catalogue. Measure coverage against the systems and essential workflows used by the customer segments we intend to serve.
For every integration, show supported products, versions, regions, capabilities, access requirements, costs, and limitations.

## 6. Define what each connection actually does

A vendor-level connection is not enough. Describe supported workflows precisely.
For example:

* Accounting: daily journals, invoices, credit notes, receivables, settlements, or reconciliation.
* POS: room-charge eligibility, guest lookup, charge posting, corrections, taxes, tips, and outlet attribution.
* Housekeeping: assignments, cleaning progress, inspection, maintenance blocks, and room readiness.
* Distribution: availability, rates, restrictions, reservations, modifications, and cancellations.

Distinguish reading information, creating records, updating records, and receiving changes.
Show whether synchronization is immediate, periodic, manually triggered, or file-based. A file export must not be presented as a live connection.
Identify what happens when required information is unavailable or a vendor does not support an action.

## 7. Make connection setup understandable

The intended user journey is:

1. Select the existing system.
2. Review compatibility, permissions, prerequisites, and charges.
3. Authorize access.
4. Review suggested mappings.
5. Resolve flagged issues.
6. Run meaningful validation.
7. Preview expected behavior.
8. Activate the approved scope.
9. Monitor connection health.

Automate what can safely be automated. Explain unavoidable vendor-side steps clearly.
Suggest mappings for properties, rooms, rates, outlets, taxes, accounts, and statuses. Require review for ambiguous or financially significant mappings.
Preserve setup progress. Provide actionable errors that explain the problem, business impact, responsible party, and next step.
Do not require ordinary hotel staff to interpret API payloads or technical logs.

## 8. Reliable information exchange

Integrations must preserve business meaning, not merely move data.
Handle differences in identifiers, currencies, timezones, business dates, tax treatment, room classifications, transaction codes, and status definitions.
Prevent duplicate reservations, duplicate charges, lost updates, and silent overwriting.
Provide clear behavior for delayed messages, missing events, conflicting edits, expired credentials, disconnected systems, and provider outages.
Allow authorized staff to understand and resolve exceptions without corrupting records.
Financial corrections must remain traceable. Reconnecting a service must not blindly replay actions that could charge a guest twice or reopen sold inventory.

## 9. One place to manage integrations

Provide an integration management area appropriate to both property staff and corporate teams.
It should show:

* Connected systems and authorized scope.
* Last successful exchange and current delays.
* Failed or incomplete workflows.
* Mapping problems.
* Credential expiry and vendor-required changes.
* Affected properties and operational impact.
* Available recovery actions.
* Usage and associated charges where available.
* Support ownership and escalation.

Separate routine status information from urgent operational problems.
Support safe pause, disconnection, credential rotation, and replacement of a provider. Explain which hotel functions will be affected before taking action.

## 10. Migration as a product capability

Make migration guided, repeatable, inspectable, and recoverable.
Before committing to a migration, establish what the source system can legally and technically export. Identify vendor fees, access restrictions, historical-data limitations, and nonportable payment tokens.
Support:

* Data preview and mapping.
* Quality checks and duplicate detection.
* Trial imports.
* Reconciliation of reservations, deposits, open balances, and inventory.
* Historical-data treatment.
* An exception list with responsible owners.
* Final change capture before cutover where supported.
* Staff acceptance and sign-off.
* A defined cutover and recovery plan.

Never silently discard unsupported records or convert ambiguous financial information.
Rollback must account for activity after cutover. Restoring an earlier database alone is not a complete recovery plan.
Allow hotels to retain a clearly identified historical archive when full historical migration is impractical.

## 11. Small-property simplicity and enterprise control

Independent properties should get useful defaults, guided setup, and a manageable interface.
Large organizations should have:

* Organization, brand, region, legal-entity, and property structures.
* Central integration policies with controlled local exceptions.
* Reusable configuration templates.
* Bulk setup and validation.
* Pilot properties and staged rollout groups.
* Separation of duties and approval controls.
* Enterprise identity and access management.
* Region-specific data and compliance requirements.
* Portfolio-wide connection health and audit history.
* Clear allocation of integration costs.
* Controlled changes that do not disrupt an entire portfolio.

Make complexity available when needed rather than exposing every enterprise option to every user.
A successful pilot at one property must not automatically establish readiness for every property in the group.

## 12. Support cloud and existing on-site systems

The main product should be cloud-based and accessible without installing a full PMS locally.
Where legacy software or physical equipment requires a local connector, make that requirement explicit. Define supported environments, installation responsibility, updates, monitoring, and outage behavior.
Do not promise a completely installation-free experience for equipment that cannot communicate directly with cloud services.
Hotels must understand what continues working when their internet connection or a local component fails.

## 13. Build an extensible ecosystem

Provide a documented, permission-controlled way for external vendors and partners to integrate with our platform.
The developer experience should include test environments, representative sample data, clear capability documentation, understandable errors, change notices, and a production approval process appropriate to risk.
Support reusable third-party integrations without giving partners unrestricted access to hotel data.
Define compatibility verification, support ownership, version maintenance, and removal of integrations that become unsafe or unsupported.
A marketplace listing must communicate demonstrated capabilities rather than imply universal certification.

## 14. Measure whether we are actually easier and faster

Establish baselines and testable targets for:

* Time to a useful demonstration.
* Time to first successful connection.
* Staff time required for setup.
* Percentage of mappings suggested correctly.
* Time to complete migration rehearsal.
* Migration exceptions and reconciliation accuracy.
* Time to first operational value.
* Training time by role.
* Synchronization delay and failure recovery.
* Support requests per onboarding.
* Cost per connected property.
* Rollout time across a hotel group.

Measure realistic workflows with actual hotel staff and representative workloads.
Do not improve speed by hiding errors, weakening permissions, or skipping reconciliation.
Evaluate competing products through verifiable documentation and practical testing where available. Record where we are better, comparable, or still behind.

## 15. Delivery priorities and evidence

First inspect the existing project and incorporate these requirements without unnecessarily rebuilding working functionality.
Deliver:

* An integration and adoption gap assessment.
* A prioritized provider and workflow coverage matrix.
* The trial and gradual-adoption experience.
* A clear source-of-truth responsibility matrix.
* Migration and reconciliation acceptance criteria.
* A connection health and recovery specification.
* Independent-property and enterprise rollout requirements.
* Measurable usability and performance targets.
* A roadmap that distinguishes internal development from external approvals.

Prioritize a complete, trustworthy experience for representative customer setups before expanding superficially across hundreds of providers.
Keep unsupported capabilities visible. Continue useful development while external approvals are pending, but never represent those dependencies as resolved.
Our desired outcome is a platform that hotels can confidently test, connect, and adopt with minimal disruption—retaining their preferred systems while gaining a substantially better operating experience.
