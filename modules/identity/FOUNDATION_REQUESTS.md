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

## FR-5 — A shared SSRF-safe outbound client (`safeFetch`)
**Problem:** identity calls customer-supplied identity providers (discovery, JWKS, token endpoint); integration calls
customer-supplied webhook URLs. Both need the same protection: https only, DNS names only, every resolved address
public, the socket pinned to the vetted address (no DNS rebinding), no redirects, bounded time and size. Modules may
not import each other, so identity carries a copy of integration's `net/address-policy.ts` (unchanged) plus a JSON
companion `net/safe-json.ts` (review P2-2).
**Proposed change:** move `address-policy.ts` + `safe-fetch.ts` (with a JSON/response-size option) into a shared
package (e.g. `packages/http/outbound` or a new `packages/net`) and delete both module copies.

## FR-6 — The responsible person on the kernel `Actor` (ADR-0017 §7)
**Problem:** separation-of-duties checks must compare people, not principals. An API client resolves to the user who
issued it; a support session to its operator. Identity puts `createdBy` on API-client actors as an extra property
and platform reads it (`responsiblePerson` in `modules/platform/src/service.ts`).
**Proposed diff (packages/kernel/src/context.ts):**
```ts
| { kind: 'api_client'; clientId: string; displayName?: string; onBehalfOf?: string /* user id of the issuer */ }
export function responsiblePerson(actor: Actor): string // 'user:<id>' | 'operator:<id>' | '<kind>:<id>'
export function assertHumanApprover(ctx: Pick<RequestContext, 'actor'>, what: string): void
```
Then every module with approvals (finance corrections, rate approvals, configuration) uses the same helper.
