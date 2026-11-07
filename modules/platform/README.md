# platform

The root of every other module's world: organizations and environments, portfolio structure, properties and their
activation, legal entities, owners, departments, outlets, plans and entitlements, policies, the data-authority
matrix, configuration bundles and the trial lifecycle. Spec: `docs/specs/platform.md` (PLT-R*); adoption brief §2,
§3, §11; `docs/adoption/{gap-assessment,source-of-truth-matrix,evaluation-and-trial}.md`; ADR-0014.

## Status (2026-11-07)

Implemented and tested internally (R3). No external system is involved except where noted. `docs/parity/platform.md`
does not exist yet (outside this module's write scope), so the parity gate cannot pass.

**Steward-review fix round (ADR-0017):** separation of duties now compares people (P1-4), authority transitions fail
closed without the integration guard (P2-5), scope refusals can be audited durably (P2-6), trial creation and
carry-forward honour the Idempotency-Key (P2-7), activation approvals take a tenant lock (P2-8), owner audits hold no
personal data (P2-11), status history is written only for changes that happened (P3-7), the carry-forward denylist
matches words inside keys (P3-9) and a live organization may hold at most 3 open trials (P3-10). Evidence:
`test/review-regressions.test.ts`, `modules/identity/test/review-regressions.test.ts`,
`apps/api/test/review-regressions.test.ts`.

## Capabilities

| Capability | Spec | Status | Readiness | Evidence |
|---|---|---|---|---|
| Editions per `docs/product/editions.md` §7 (receivables, message automation and API in Essentials; AI assistant as a metered add-on in every plan; no staff-user limit) and the proposed **Connect** plan with module packs (SM-01..SM-06) | PLT-R20 | done (no prices — Q3) | R3 | `src/domain/plans.test.ts` |
| Entitlement grants: add-ons and packs, organization- or property-scoped (`hasEntitlement(tx, feature, { propertyId })`); only Monoclay operators (system context) grant; revoking never deletes data | PLT-R20/R22/R23 | done | R3 | `test/portfolio.test.ts` |
| Owners (person/company, opaque payout reference + last-4 hint; bank data refused) and effective-dated unit ownership shares in basis points, ≤ 100 % per unit and date under a per-unit lock, one share per owner/unit/period (exclusion constraint), end-dating, `getUnitOwnership` for finance | brief §2, PLT-R17 | done (owner statements LATER, finance) | R3 | `src/domain/domain.test.ts`, `test/portfolio.test.ts` |
| Outlets: kinds (restaurant, bar, cafe, spa, dive centre, water sports, excursions, boutique, transfer desk, minibar, in-room dining, laundry, kids club, other), legal entity (defaults to the property's), default charge code by key, opening hours incl. overnight and week wrap, room-charge eligibility, archive, ETag/If-Match | PLT-R19 | done | R3 | `src/domain/domain.test.ts`, `test/portfolio.test.ts`, HTTP test |
| Configuration bundles: versioned JSON exported from a property via a section registry (platform contributes property settings, property policies, departments, outlets; other modules add sections through `PlatformPorts.configurationSections`), import, dry-run plan per property/section (create / update / unchanged / local preserved / conflict), apply never deletes | PLT-R15/R42, adoption §11 | done | R3 | `test/portfolio.test.ts` |
| Rollout groups (pilot, wave1…final) and approval with separation of duties (policy `platform.configuration.separationOfDuties`: `portfolio_changes` default, `all_changes`, `off`); stale-plan protection on apply | PLT-R29, adoption §11 | done | R3 | `test/portfolio.test.ts`, HTTP test |
| Trial lifecycle: create from the live organization (or for a prospect via the operator console), environment link, banner/effects/provenance (`copied`), import record, reset (registered participants delete operational data; configuration kept), export (labelled TRIAL), close (organization closed immediately, primary-data deletion due in 7 days, legal hold blocks), carry configuration forward to live as a bundle — never reservations, guests, money or credentials | PLT-R05, adoption §3 | done (purge job LATER) | R3 | `test/portfolio.test.ts`, `apps/api/test/platform-enterprise.test.ts` |
| Property activation: `setup → pilot → active` (and `setup → active`) by request + approval by a **different person** (ADR-0017 §7: an API client counts as the user who issued it; approvals must be made by a person signed in as themselves) with `platform.property.activate` ⚑, fresh checklist at approval under a tenant advisory lock (live environment, plan limit on pilot+active, valid scope, module checks), status history only for changes that happened; stop pilot / deactivate as recorded direct actions; direct status edits refused | PLT-R14, PLT-R10 | done | R3 | `test/activation.test.ts`, `test/review-regressions.test.ts` |
| Activation scope (G-04): versioned, approved pilot and production scope documents (effects per connection/workflow, workflows, window, success criteria, rollback); `assertEffectInScope` (kernel environment check + scope) and `assertWorkflowInScope`; refusals audited | G-04, evaluation-and-trial §6 | done | R3 | `src/domain/domain.test.ts`, `test/activation.test.ts` |
| Data authority hardening: external+exclusive rejected (G-01), constraint matches the service (G-07), tenth domain `guestCommunications` (G-06), append-only version history and `planned → frozen → effective | cancelled` transitions with `authority_transition_in_progress` while frozen, second approver for charges/payments/accounting/availability (CR-10; never an API client and never the planner's own API client), pending forwarded operations block completion (ST-08) — and completion out of `forward` is **refused while no transition guard is bound** (fails closed) | G-01/02/06/07 | done (ST-08 needs integration's guard to complete such moves) | R3 | `test/data-authority.test.ts`, `test/review-regressions.test.ts`, HTTP test |
| `getPropertyFacts` — permission-free, RLS-scoped facts for module-internal use (never over HTTP) | orchestrator | done | R3 | `test/activation.test.ts` |
| Environment info `GET /v1/environment` (banner, effect modes, imported-data provenance, trial details) and `provenanceFor` | PLT-R03, rule 16 | done | R3 | `test/portfolio.test.ts`, HTTP test |
| Usage meters, feature visibility, policy locks, profile layer, effective-dated classification | PLT-R24/R40/R27/R26/R13 | not built | R1 | — |

## Invariants → tests

| Invariant | Test |
|---|---|
| Shares of a unit never exceed 100 % on any date, also under concurrency | `test/portfolio.test.ts` "never stores bank data…", "concurrent share additions…" |
| No bank data stored for owners | `test/portfolio.test.ts`, HTTP test |
| A preparer cannot approve their own portfolio change; an approved plan is applied only if still identical | `test/portfolio.test.ts` |
| Local differences are preserved by default; bundles never delete | `test/portfolio.test.ts`, `src/domain/domain.test.ts` |
| Activation needs a different approver with `platform.property.activate`; one property's activation never changes another's (EV-06) | `test/activation.test.ts` |
| Live effects outside the approved scope are refused and audited (EV-05); with `{ database }` the audit row survives the caller's rollback; non-live environments keep simulating | `test/activation.test.ts`, `test/review-regressions.test.ts` "P2-6" |
| Separation of duties compares people: an API client resolves to its issuer; API clients, system processes and support sessions cannot approve | `test/review-regressions.test.ts` "P1-4", identity `test/review-regressions.test.ts` |
| Owner audit rows never contain personal data (names, email, phone, tax id, payout data) | `test/review-regressions.test.ts` "P2-11" |
| A retried trial creation or carry-forward with the same Idempotency-Key replays the first result | `apps/api/test/review-regressions.test.ts` |
| PLT-I06/G-07: an external authority always has a connection; Portico never has one; external+exclusive impossible (DB-level) | `test/data-authority.test.ts` |
| ST-07: no writes in a frozen domain; ST-11: the planner cannot approve; ST-13: history rows with approver | `test/data-authority.test.ts` |
| EV-09: carry-forward bundles never contain operational data, even if a provider claims otherwise | `test/portfolio.test.ts` "reset, export and close a trial…" |
| Trials cannot be reset/closed in a live organization; a closed trial no longer authenticates | `test/portfolio.test.ts`, HTTP test |
| PLT-I01: tenant isolation for outlets, owners, bundles, trials (another org gets 404 / cannot pull) | `test/portfolio.test.ts`, HTTP test |

## Permissions (new)
`platform.dataAuthority.manage` ⚑ (now registered) · `platform.property.activate` ⚑ · `platform.outlet.manage` ·
`platform.owner.read` · `platform.owner.manage` ⚑ · `platform.plan.read` · `platform.configuration.export` ·
`platform.configuration.manage` ⚑ · `platform.configuration.approve` ⚑ · `platform.rolloutGroup.manage` ·
`platform.trial.manage` ⚑.

## Events
Emitted (new): `platform.entitlement.changed`, `platform.owner.created`, `platform.unitOwnership.changed`,
`platform.outlet.created|updated`, `platform.configuration.applied`, `platform.trial.reset|closed`,
`platform.property.statusChanged`, `platform.activationScope.approved`,
`platform.authorityTransition.planned|frozen|completed` (plus the existing `platform.dataAuthority.changed`, now with
`version`). Consumed: none.

## Ports (`src/ports.ts`) and binding status
| Port | Binding (composition root) |
|---|---|
| `configurationSections` | platform's four sections; other modules append theirs (rates, finance charge codes …) |
| `trialParticipants` | empty — wave-1 modules holding operational data must register reset/export |
| `activationChecks` | empty — modules add readiness checks (tax pack, payment account, mappings …) |
| `transitionGuard` | unbound — integration must report pending forwarded operations; until then a move out of `forward` cannot complete (`pending_operations_unknown`) |
| `trialProvisioner` | `createTrialForOrganization` in `apps/api/src/provisioning.ts` |

## Contract changes
- `hasEntitlement` / `requireEntitlement` gain optional `{ propertyId }` (additive).
- `dataDomain` gains `guestCommunications`; `listDataAuthority` returns 10 domains.
- `setDataAuthority` now rejects external+exclusive, refuses while a transition is open, and requires an authority
  transition (second approver) for charges/payments/accounting/availability unless the actor is a system process.
- `updateProperty` refuses status changes (`use_activation_workflow`); the field stays in the contract for compatibility.
- `platformHttp({ database, ports? })`. New providers: `getPropertyFacts`, `assertEffectInScope`,
  `assertWorkflowInScope`, `getPilotScope`, `getUnitOwnership`, `listOutlets`, `provenanceFor`, `responsiblePerson`,
  `assertHumanApprover`.
- Fix round: `requested_by` / `planned_by` / `prepared_by` store the responsible person (`user:<id>` for a user or
  for an API client that user issued). Approvals by API clients return `human_approval_required`.
  `assertEffectInScope(…, { database })` audits refusals in their own transaction. `pullTrialConfiguration` takes
  an optional live transaction. Property creation is capped by `limits.properties` over properties that are not
  inactive (a setup cap); PLT-R10 (pilot + active) is enforced at activation.

## Adoption modes
Required by every adoption path. The Connect plan sells modules standalone; trials, data authority, activation scope
and configuration bundles are never gated except multi-property rollouts and rollout groups (`portfolio.policies`)
and owners (`owners.accounting`). Owns the authority registry for all ten governed domains.

## Known gaps
- Trial primary-data purge after `deletion_due_at` (job) and backup age-out evidence; trial expiry after 60 days idle.
- Re-copy on reset needs the integration importer; reset only clears registered participants (none registered yet).
- Authority-transition preview of affected workflows per module (PLT-R37) and coherence rules (PLT-R38).
- `assertEffectInScope` is not yet called by any adapter (no adapters exist); kernel hook proposed (FOUNDATION_REQUESTS).
- Pilot `participantUserIds` is informational (enforcement is through role assignments).
- `docs/parity/platform.md` missing.
- Review P2-9 (not done, larger than this fix round): the activation scope has no "domains and authority" element
  validated against `listDataAuthority`; production approval has no Monoclay launch-gate sign-off; `active → inactive`
  has no precondition port (in-house stays, open folios). Tracked for the next platform wave.
- Review P2-12 (not done): identity and the new platform records (outlet, owner, activation request, authority
  transition, configuration change, trial) are not yet declared as `recordTypes` with `allowedActions`/`issues`/
  `links`; needs the records module's summary contract for each.
- P2-8: the property-limit race is closed with an advisory lock, but there is no concurrent-approval test yet.
- Trial creation spans two tenants; with the idempotent record held during creation a retry replays, but an
  orphan trial is still possible if the live link fails after the trial commits (FR-2).

## Open questions for the owner
- Q63/Q44: trial deletion grace (7 days assumed) versus retention obligations for copied data.
- Q3/Q60: prices and final packaging of editions, add-ons and Connect packs.
- Q149 (`docs/OPEN_QUESTIONS.md`): open trials per live organization (3 assumed).
