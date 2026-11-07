# Foundation requests from `integration`

Changes outside this module that would improve it. Nothing here blocks the module: each item has a local
workaround already in place.

## FR-1 — Register `platform.dataAuthority.manage` in the platform manifest — **resolved on main**

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

Platform (identity-plus branch) ships authority transitions and activation scope. Integration declares both as
ports (`AuthorityTransitionPort`, `ActivationScopePort` in `src/ports.ts`). Bind them in
`apps/api/src/composition.ts` when identity-plus is on main:

```ts
activationScope: {
  assertEffectInScope: (tx, i) =>
    platform
      .assertEffectInScope(tx, i.propertyId, i.effect, { connectionId: i.connectionId, workflow: i.workflow })
      .then(() => undefined),
},
transitions: {
  async activeTransition(tx, i) {
    const t = await platform.openTransitionFor(tx, i.propertyId, i.domain);
    return t ? { id: t.id, state: t.status } : null;
  },
  plan: (tx, i) =>
    platform.planAuthorityTransition(tx, i.propertyId, { changes: i.changes, reason: i.reason, freezeMinutes: 30 }),
},
// and platform's ports: transitionGuard: { pendingOperations: integrationProvider.pendingOperations }
```

Until `plan` is bound, activation changes authority directly; identity-plus's `setDataAuthority` then refuses the
second-approval domains and integration explains it (`second_approval_required`) without activating anything.

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

## FR-5 — Shared outbound address policy (`safeFetch`) — **done in module; extraction proposed**

DNS-rebinding and SSRF protection are built (`src/net/address-policy.ts`, `src/net/safe-fetch.ts`: resolve once,
vet every address, pin the socket, no redirects, bounded time). Both files depend only on Node built-ins so they
can move unchanged to a shared package (e.g. `@portico/http/outbound`) for comms, payments callbacks and future
connectors. An egress proxy with an allow-list remains a defence-in-depth option for production
(`infra/terraform`).

## FR-6 — Cross-module "My work" inbox contract

The experience architecture asks for one inbox of exceptions, tasks and approvals. Integration exposes
`IntegrationProvider.listWorkItems(tx, { userId, departmentIds })` and `GET /v1/integration/my-work` returning
integration exceptions in the universal record shape (owner user/department, allowedActions). A shared
`WorkItemProvider` contract in `@portico/db` (like `SearchProvider`) would let the records/inbox route aggregate
every module.
