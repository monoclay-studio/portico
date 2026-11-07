# platform

## Checkpoint (2026-11-07, in progress)

**Done (committed):**
- Editions per `docs/product/editions.md` §7 + Connect plan with module packs (`domain/plans.ts`), entitlement
  grants (add-ons/packs, org- or property-scoped; operator-only), `hasEntitlement(tx, feature, { propertyId })`.
- Owners + effective-dated unit ownership (≤ 100 % per unit/date under a per-unit lock; no bank data).
- Outlets (kinds, legal entity, charge code key, opening hours incl. overnight, room-charge flag).
- Configuration bundles (registry of section providers), dry-run plans, rollout groups, separation-of-duties approval,
  stale-plan protection.
- Trials: lifecycle record, reset (participants), export (TRIAL label), close (tenant closed + deletion due),
  carry-forward to live as a bundle (never operational data), environment info / banner / provenance.
- Activation: status requests approved by a different person with `platform.property.activate`; versioned
  pilot/production scopes; `assertEffectInScope` / `assertWorkflowInScope` (G-04); direct stop-pilot/deactivate.
- Orchestrator follow-ups: data authority G-01 (external+exclusive rejected), G-07 (constraint), G-06
  (`guestCommunications`), G-02 (append-only history + planned → frozen → effective | cancelled transitions,
  `authority_transition_in_progress` while frozen, CR-10 second approver); `getPropertyFacts` (module-internal).
- Migrations 0002 and 0003; routes + contracts; 56 platform tests passing.

**Next steps:** full README (capabilities, invariants→tests, permissions, events, ports, readiness, gaps),
FOUNDATION_REQUESTS.md (kernel hook for activation scope), API e2e tests in `apps/api/test/platform-*.test.ts`.

**Known failing tests:** none.
