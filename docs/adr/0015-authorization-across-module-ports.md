# ADR-0015: Authorization and integrity across module ports

**Status:** Accepted · **Date:** 2026-11-07

## Context

Reviews found both failure modes of cross-module calls:
- *Too loose:* finance's delegated functions were unscoped, so a desk user at property A recorded a payment onto a
  folio at property B (payments review P0-1).
- *Too strict:* operations asked inventory to block a unit for a work order; inventory re-checked
  `inventory.block.manage`, which the engineer (holding every operations permission) lacked, and the whole command
  rolled back (operations review P1).

## Decision

1. **The entry module authorizes the user's intent.** The module whose HTTP route / command the user invoked checks
   the user's permission *and property scope* for the whole business action (e.g. `operations.maintenance.manage`
   at property P).
2. **Port calls carry the authorized scope.** Every provider function called through a port receives the
   `propertyId` (and legal entity where relevant) that the caller authorized.
3. **Providers enforce integrity, not the caller's permission keys.** A provider invoked through a port does not
   re-check *its own* permission keys for that user, but it MUST verify that every referenced record belongs to the
   given property/legal entity (and tenant, via RLS), enforce its invariants, and enforce **data authority** for the
   domains it owns. Violations throw — they are never silently accepted.
4. **Provider HTTP routes keep their own permissions.** Direct calls to a provider's routes check that provider's
   permission keys as usual.
5. **Sensitive cross-module effects are explicit.** The explicit capability names the module whose key is checked
   (e.g. `payments.payment.collect`). Choosing the payment method, amount or account is explicit unless it is bound to
   the agreed guarantee (integration-step review P1-2). Where a port call performs something the entry permission should
   not imply (e.g. refunds, overbooking), the provider requires an explicit capability argument whose presence the
   entry module checked (e.g. `overbooking: { authorizedBy }` after `inventory.overbooking.authorize`).
6. **Composite failures do not lose user work.** When a port call refuses (e.g. unit already blocked, external system
   of record), the entry module records its own record (e.g. the work order) with the refusal reason and next step
   instead of rolling everything back — use `withSavepoint` around the port call.

## Consequences

Ports are exercised with real providers in integration tests; each provider adds tests that a call with a mismatched
property/legal entity is refused. Implemented per module during the integration step (`docs/orchestration/pending-fixes.md`).
