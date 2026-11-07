# identity

## Checkpoint (2026-11-07, in progress)

**Done (committed or in this checkpoint):**
- Domain (unit-tested): TOTP RFC 6238 + replay protection, recovery codes, permission catalog validation and
  sensitivity, central MFA step-up policy (`domain/step-up.ts`), IdP group → role mapping, SCIM parsing,
  suspicious-activity rules.
- Migration `0002_identity_enterprise.sql` (MFA factors, challenges, org security policy, credential tokens, SSO,
  SCIM groups, support sessions + access log, elevations, security alerts, login attempts, definer functions).
- Services: security policy, sessions (list/revoke), MFA (enrol/confirm/step-up/recovery/disable/admin reset/login
  challenge), step-up-aware authorizer in `buildAuthorizer` + `authenticateToken` (elevation and support tokens),
  login with SSO-required check + MFA challenge + sign-in signals, custom roles, staff lifecycle (invite, accept,
  password reset, transfer, reactivate, remove, member detail), break-glass, support access + operator directory,
  security signals, OIDC SSO (jose), SCIM Users/Groups, default adapters.
- Routes + Zod contracts for all of the above, `onSend` step-up translator (`mfa_required`).
- Composition wiring (`apps/api/src/composition.ts`) and trial provisioning (`apps/api/src/provisioning.ts`).
- Existing identity tests pass (42).

**In progress / next steps:**
1. Run `apps/api` tests (existing + new) — was running at checkpoint time.
2. New integration tests: `modules/identity/test/{mfa,sso,scim,roles,lifecycle,support,break-glass,security}.test.ts`
   and `apps/api/test/identity-*.test.ts` (step-up `mfa_required` over HTTP, fake IdP with jose keys, SCIM, operator).
3. Full README (capabilities, invariants→tests, permissions, events, ports, readiness), FOUNDATION_REQUESTS.md
   (operator actor kind, `requirePermission` using `explainDenial`, jose in catalog).
4. `pnpm lint && pnpm typecheck` and Biome format.

**Known failing tests:** none known at checkpoint (new suites not yet written).
