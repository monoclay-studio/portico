# Foundation requests (identity)

## FR-1 — First-class actor markers in `@portico/kernel` `Actor`
**Problem:** Monoclay support actions and break-glass actions must be distinguishable on every audit record. The kernel
`Actor` has no operator kind and no `via` field, so identity uses `kind: 'user'` + `impersonatedBy:
'monoclay-operator:<id>'` and adds `via`, `supportSessionId`, `operatorId`, `elevationId` as extra JSON properties.
**Proposed diff (packages/kernel/src/context.ts):**
```ts
| { kind: 'user'; userId: string; displayName?: string; sessionId?: string; impersonatedBy?: string;
    via?: 'support' | 'elevation' | 'ai' | 'pin'; elevationId?: string; supportSessionId?: string }
| { kind: 'operator'; operatorId: string; displayName?: string; supportSessionId: string }
```
and `actorLabel`/`actorId` cases for `operator`. Identity would then emit `kind: 'operator'` for support sessions.

## FR-2 — `requirePermission` should explain step-up denials
**Problem:** the authorizer knows when a permission is granted but blocked by MFA; kernel `requirePermission` throws
a plain `forbidden`, so identity rewrites the problem in an `onSend` hook.
**Proposed diff:** add optional `explainDenial?(permission, scope): string | null` to `Authorizer`; in
`requirePermission`, when it returns `mfa_required`/`mfa_enrollment_required`, throw a `DomainError` with that code
(403). Then delete `installStepUpTranslator` in `modules/identity/src/routes.ts`.

## FR-3 — `jose` in the pnpm catalog
`modules/identity/package.json` pins `jose@6.2.15` directly; move it to `pnpm-workspace.yaml` `catalog:`.

## FR-4 — Tenant-scoped retention jobs
Expired `identity.mfa_challenges`, `identity.sso_login_states` and `identity.credential_tokens` should be purged per
tenant. A small reviewed SECURITY DEFINER "list tenants with expired rows" helper (or a core pattern for per-tenant
purges) would let identity do this without bypassing RLS.
