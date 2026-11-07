# Foundation requests from `integration`

Changes outside this module that would improve it. Nothing here blocks the module: each item has a local
workaround already in place.

## FR-1 — Register `platform.dataAuthority.manage` in the platform manifest

**Problem.** `platform.setDataAuthority` checks `platform.dataAuthority.manage`, but the permission is not in
`platformManifest.permissions`, so role editors cannot grant it and no role template except `org_admin` (`*`)
holds it. Activation of a connection (step 8) calls `setDataAuthority`; a user with
`integration.connection.activate` but without `*` is refused by platform.

**Proposed diff** (`modules/platform/src/manifest.ts`):

```ts
{ key: 'platform.dataAuthority.manage', description: 'Change which system is the system of record for a property', scope: 'property', sensitive: true },
```

and add it to the `general_manager` role template if the owner agrees that GMs may switch systems of record.
**Workaround:** none needed for org admins; documented in the README.

## FR-2 — Data-authority transitions and activation scope (G-02, G-04)

The platform agent is adding authority transitions (`planned → frozen → effective`) and activation scope
(`assertEffectInScope`). Integration declares both as ports (`AuthorityTransitionPort`, `ActivationScopePort` in
`src/ports.ts`). Bind them in `apps/api/src/composition.ts` when platform ships them:

```ts
activationScope: { assertEffectInScope: (tx, input) => platform.assertEffectInScope(tx, input) },
transitions: { activeTransition: (tx, input) => platform.activeTransition(tx, input) },
```

**Current binding:** `unavailableActivationScope` (refuses every LIVE external effect of a real connector —
conservative) and `noAuthorityTransitions` (true on main today: no transitions exist). Simulators and file
connectors never touch a real system and skip the scope check.

## FR-3 — Platform data-authority constraint (G-07)

Once `integration.connections` exists on main, `platform.data_authority.connection_id` can be checked against it.
A cross-schema foreign key would break module extractability; prefer the corrected check constraint from the gap
assessment (`(authority = 'portico' and connection_id is null) or (authority = 'external' and connection_id is not
null)`) plus a consistency job in integration that reports authority rows pointing at disconnected connections.

## FR-4 — AWS Secrets Manager `SecretStore`

`src/secrets.ts` defines the `SecretStore` port and a local implementation over the kernel field cipher (bound to
`fieldCryptoFromEnv().cipher`). Production should bind an AWS Secrets Manager store (one secret per credential,
`portico/<tenant>/<id>`, per-environment KMS key, short in-memory cache, scheduled deletion on destroy). Needs the
AWS SDK dependency and IAM in `infra/terraform`; the interface does not change.

## FR-5 — Webhook delivery: DNS-rebinding protection

`checkEndpointUrl` rejects private/reserved literal hosts at subscription time. A production transport should also
resolve the host at delivery time and refuse private addresses (custom `lookup` on the HTTP agent), or deliver
through an egress proxy with an allow-list. `fetchWebhookTransport` is the place to add it.

## FR-6 — Cross-module "My work" inbox contract

The experience architecture asks for one inbox of exceptions, tasks and approvals. Integration exposes
`IntegrationProvider.listWorkItems(tx, { userId, departmentIds })` and `GET /v1/integration/my-work` returning
integration exceptions in the universal record shape (owner user/department, allowedActions). A shared
`WorkItemProvider` contract in `@portico/db` (like `SearchProvider`) would let the records/inbox route aggregate
every module.
