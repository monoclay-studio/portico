# Architecture overview

Portico is a **modular monolith** in TypeScript on Node 22 and PostgreSQL 16, deployed to AWS. It is built so
that modules can later become services without rewriting them, and so that correctness properties (tenant
isolation, exactly-once money movement, honest status) are enforced by the platform rather than remembered by
each developer. Decisions and their reasons are in `docs/adr/`.

```
            ┌──────────── Web apps (React) ────────────┐   ┌── Partners / integrations ──┐
            │ backoffice · staff PWA · guest journey    │   │ public API · webhooks       │
            └───────────────────┬───────────────────────┘   └──────────────┬──────────────┘
                                │  HTTPS /v1 (OpenAPI, problem+json, ETag, Idempotency-Key)
┌───────────────────────────────▼─────────────────────────────────────────▼──────────────┐
│ apps/api  — composition root: auth → RequestContext → module routes                     │
│   modules/*  (platform, identity, inventory, rates, guests, reservations, finance,      │
│               payments, operations, integration, day-close, distribution, …)            │
│   packages/http · packages/db · packages/kernel                                         │
└───────────────┬───────────────────────────────────────────────┬────────────────────────┘
                │ one transaction per command (RLS-scoped)       │ outbox
┌───────────────▼───────────────┐                     ┌─────────▼───────────────────────┐
│ PostgreSQL 16                  │◄────────────────────│ apps/worker                      │
│ one schema per module, RLS     │  claim (SKIP LOCKED)│ event consumers, schedulers,     │
│ core: outbox, idempotency,     │                     │ webhook delivery, connector sync │
│ audit (append-only)            │                     └─────────┬───────────────────────┘
└────────────────────────────────┘                               │ adapters (env-safety gated)
                                                     Stripe · channel hub · POS · locks · …
```

## Request lifecycle

1. **Authenticate** (`packages/http` hook → identity authenticator): bearer token `pts.<tenant>.<secret>` (staff
   session) or `ptk.<tenant>.<client>.<secret>` (API client) → `RequestContext { tenantId, environment, actor,
   authz, correlationId }`.
2. **Validate** body/params with the route's Zod schema (contracts double as OpenAPI).
3. **Execute** the command through a module service inside `withTenantTx` (or `runIdempotent` for creates and
   money movement). The transaction sets `app.tenant_id`; Postgres RLS hides every other tenant's rows.
4. Inside the transaction the service: checks permission (`requirePermission`), checks data authority where
   relevant (`platform.assertWritable`), changes state, writes audit (`tx.audit`) and events (`tx.emit`).
5. **Commit.** The idempotency record, state, audit and events commit atomically.
6. The worker fans events out to consumers, each consumer's effects committing atomically with its delivery
   record. External effects go through adapters gated by `assertExternalEffectAllowed`.

## Tenancy and security model

| Layer | Mechanism |
|---|---|
| Network | AWS WAF, private subnets, TLS everywhere |
| Identity | Sessions (hashed tokens, idle + absolute expiry, lockout); MFA + SSO (OIDC/SAML) in identity wave 1 |
| Authorization | Deny by default; permissions `<module>.<resource>.<action>` scoped to organization/brand/region/property; checked in the service layer (so API, AI and integrations share the same checks) |
| Data isolation | `tenant_id` on every tenant-owned row + RLS **enabled and forced**; app connects as `portico_app` (never owner, never superuser); fail-closed when no tenant is set |
| Cross-tenant needs | Only through reviewed `SECURITY DEFINER` functions that return routing metadata (sign-in, outbox claiming, environment lookup) — never business data |
| Integrity | Append-only audit and ledger tables (grants + triggers); optimistic concurrency (`version`) on aggregates |
| Secrets & PII | No secrets in code; logger redaction; identity documents field-encrypted (KMS envelope in production) |
| Payments | Hotel is merchant of record; tokens only; PSP hosted fields; no raw card data anywhere |
| Environments | `live`, `trial`, `sandbox`, `training`, `demo` are separate organizations; non-live can never charge, message guests, publish to channels, write to a hotel's systems or submit to governments |

## Data authority and adoption modes

For every property and data domain exactly one system is the **system of record**
(`platform.data_authority`). Default: Portico, exclusive. When an external system is authoritative, Portico
either mirrors it read-only or forwards changes to it and treats them as effective only when acknowledged. This
single mechanism supports all three adoption paths — connect alongside, replace selected capabilities, full
migration — and prevents two systems from silently overwriting each other. Modules that can run standalone
must document their dependencies and connected-mode behavior in their spec.

## Building a module (the recipe)

Use `modules/platform` and `modules/identity` as reference implementations.

```
modules/<name>/
  package.json          @portico/<name>; exports "." and "./contracts"
  migrations/0001_<name>.sql
  src/manifest.ts       ModuleManifest: name, schema, migrationsDir, permissions, migrateAfter
  src/contracts.ts      Zod schemas for the public API (no server imports — web apps import this)
  src/tables.ts         Kysely table typings for this schema only
  src/domain/*.ts       Pure logic (state machines, calculations, policies) + *.test.ts
  src/ports.ts          Interfaces for what this module needs from other modules
  src/service.ts        Application services: (tx: TxContext, …) — permission, authority, state, audit, events
  src/routes.ts         HttpModule: thin handlers calling services; ETag/If-Match; Idempotency-Key
  src/events.ts         Event type constants + payload types (and consumers for other modules' events)
  src/index.ts          Public surface: manifest, http module factory, services namespace, types
  test/*.test.ts        Integration tests on a real database via @portico/testing
```

Migration checklist for every table:
1. `tenant_id uuid not null` and `select core.enable_tenant_isolation('<schema>.<table>');`
2. `version int not null default 1` on mutable aggregates.
3. Unique constraints that enforce business identity (e.g. one room charge per stay per night) — idempotency
   is a database guarantee, not only an application check.
4. `select core.make_append_only(...)` for financial and history tables.
5. End the file with `select core.apply_standard_grants('<schema>');`.
6. No foreign keys into another module's schema (reference ids only) — keeps modules extractable.

Wire the module in `apps/api/src/composition.ts`: add its manifest to `MANIFESTS`, bind its ports, add its
HTTP module and event subscriptions. Nothing else may import another module's internals.

## Concurrency patterns

| Problem | Pattern |
|---|---|
| Last unit sold twice (scenario 1) | Per-night inventory counters updated with a guarded `UPDATE … WHERE sold + held + n <= sellable` in deterministic lock order; all nights in one transaction |
| Same unit assigned twice (scenario 3) | `EXCLUDE USING gist (unit_id WITH =, nights WITH &&)` on active assignments |
| Two users edit a booking (scenario 14) | `version` + `If-Match`; 409 returns current version for a diff-and-reapply UX |
| Retried command (scenarios 5, 6) | `runIdempotent` (record committed with the effect) + deterministic business keys with unique constraints |
| External call inside a command | Provider-operation journal: record intent → call provider with the same idempotency key → record outcome; unknown outcomes become *pending verification* and are reconciled |
| Event consumer retried | Delivery marked done in the same transaction as the consumer's effects |

## Deployment (target — nothing is deployed yet)

AWS, region per OPEN_QUESTIONS Q4 (default `ap-south-1`): ECS Fargate services for `api` and `worker`,
Aurora PostgreSQL (Multi-AZ, PITR, encrypted with KMS), S3 for documents (SSE-KMS, signed URLs), CloudFront +
WAF for web apps, Secrets Manager, CloudWatch + OpenTelemetry tracing, SES for email. Terraform in
`infra/terraform`, one state per environment, cell-ready so additional regions can be added for data
residency. See ADR-0011.
