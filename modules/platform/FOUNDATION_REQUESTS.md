# Foundation requests (platform)

## FR-1 — Activation scope in the kernel effect check (G-04)
**Problem:** `assertExternalEffectAllowed(ctx, effect)` only knows the environment. Pilots run in `live`, where every
effect is `live`, so adapters must also call `platform.assertEffectInScope(tx, propertyId, effect, { connectionId,
workflow })`. Nothing forces them to.
**Proposed diff (packages/kernel/src/environment.ts):** an optional property-aware variant
```ts
export interface EffectScopeChecker {
  check(ctx: RequestContext, propertyId: string, effect: ExternalEffect,
        opts?: { connectionId?: string; workflow?: string }): Promise<Exclude<EffectMode, 'blocked'>>;
}
```
carried on `TxContext` (bound by the composition root to `platform.assertEffectInScope`), and an adapter base class /
lint rule in `packages/db` that requires property-scoped effects to go through it.

## FR-2 — Cross-tenant transactions for environment provisioning
Creating a trial touches two tenants (trial organization, live organization's environment link), today in two
transactions (an orphan unlinked trial is possible if the second fails; it is harmless and re-linkable). A reviewed
helper to run a short multi-tenant provisioning transaction would remove that window.
