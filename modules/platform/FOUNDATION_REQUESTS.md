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

## FR-3 — `responsiblePerson` / `assertHumanApprover` in the kernel
Same as identity FR-6 (ADR-0017 §7). Platform has local copies in `src/service.ts` until the kernel provides them.

## FR-4 — Durable refusal audits
`assertEffectInScope` takes an optional `database` so its refusal audit is written in its own committed transaction
(review P2-6). A kernel/db-level `ctx.auditDurable(entry)` (separate transaction or outbox) would let every module
record refusals that survive the caller's rollback without passing the database around.
