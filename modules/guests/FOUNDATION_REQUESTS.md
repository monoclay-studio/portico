# Foundation requests from the guests module

Problems found while building `@portico/guests` that need a change outside this module. Each lists the problem,
the proposed change, and how the module works around it today.

## 1. Idempotency records keep personal data indefinitely (`packages/db`) — DONE (30-day expiry, actor-bound replay, replay plans + erasure redaction in fix/guests-erasure-idempotency)

**Problem.** `runIdempotent` stores the full response body in `core.idempotency_keys`. For `POST /v1/guests/profiles`
that body contains names and contact details; erasure (GUE-R18 / GUE-I06) cannot reach it, and nothing expires it.
**Proposal.** Add `expires_at timestamptz` (default `created_at + interval '7 days'`) and a purge job in the
worker; optionally `runIdempotent(…, { storeBody: false })` that stores only `{status, id}` and lets the route
re-read the record on replay.
**Workaround.** Privacy exports are never stored (the POST returns only the request record; data is downloaded
separately and rebuilt per download). Still open: erasure cannot purge a profile-create response before its 30-day
expiry — `runIdempotent(…, { storeBody: false })` (store `{status, resourceRef}`, re-read with the caller's
permissions on replay) would close it.
**Done (SW-GUE-1).** `runIdempotent(…, { replay: { store, rebuild } })` stores ids only and rebuilds the response
in the replaying caller's transaction; `redactIdempotencyResponses(tx, { mentions })` turns stored responses that
mention a data subject into an erased marker (replay → 410); replays read FOR SHARE. **Ask of other modules:** every
endpoint whose response embeds a guest's name or contact (reservations booker/occupants, payments payer, finance
payer details) should adopt a replay plan — redaction by id/email/phone is only the safety net.

## 2. Query strings with personal data reach request logs (`packages/http`) — DONE on main (path-only request logs)

**Problem.** Fastify logs `req.url`, so `GET /v1/guests/search?q=anna.schmidt@…` and `GET /v1/search?q=…` write
names, emails and phone numbers into logs (CLAUDE.md §6: PII is never logged).
**Proposal.** In `createServer`, a request serializer that logs the path without the query string (or redacts
`q`), e.g. `serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0], id: r.id }) }`. Also add
`*.number` (document number in `POST …/documents`) and `*.detail` (special needs) to `LOG_REDACT` in case bodies
are ever logged.
**Workaround.** None in-module (routes follow the shared GET search convention).

## 3. Production `FieldCipher` (KMS) and a separate blind-index key (`packages/kernel` / infra) — PARTLY DONE (kernel `fieldCryptoFromEnv`)

**Problem.** Only `localFieldCipher` exists. Guests also needs a keyed hash (HMAC) for document numbers whose key
must be separate from the encryption key and never leave the secrets manager.
**Proposal.** `kmsFieldCipher(kmsKeyArn)` (envelope encryption, data-key caching) and `hmacBlindIndex(secretRef)`
in the kernel/infra layer; the composition root binds `GuestsCryptoPort { cipher, keyId, blindIndex }`.
**Status.** Guests now takes `{cipher, blindIndex}` from kernel `fieldCryptoFromEnv()` (separate keys, production
refuses dev keys). Still needed: KMS envelope encryption, decrypt-by-`key_id` keyring, and re-encrypt / re-index
jobs (guests stores `key_id` per row).

## 4. Unpermissioned property directory for module ports (`modules/platform`)

**Problem.** Guests must evaluate policies for "all properties of the organization" and read a property's
country/legal entity regardless of the caller's `platform.property.read` scope (e.g. a desk agent at property A
viewing a shared profile). Platform only exposes permission-checked `listProperties`/`getProperty`.
**Proposal.** `platform.propertyDirectory(tx): Promise<Array<{ id, countryCode, legalEntityId, timezone }>>`
— routing metadata only, no permission check, for provider use.
**Workaround.** The composition root calls `listProperties`/`getProperty` with `{ ...tx, authz: systemAuthorizer }`.

## 5. Role templates for the guests permissions (`modules/identity`)

**Proposal.** front_desk / reservations_agent: add `guests.alert.manage` and an explicit `guests.company.read`;
`guests.profile.readShared` only where the organization enables sharing (the resolution leak it would have widened
is fixed). general_manager: replace `guests.*` with an explicit list WITHOUT `guests.privacy.erase`,
`guests.document.read` and `guests.sensitive.read` (those belong to named roles). A new organization-scoped
"Data protection officer" template: `guests.profile.read`, `guests.privacy.export`, `guests.privacy.erase`,
`guests.document.read`, `guests.sensitive.read` — an organization-wide grant produces a complete export (a
property-scoped one is marked incomplete by design).

## 6. Record history permission for organization-wide records (`apps/api/src/records-routes.ts`)

**Problem.** `GET /v1/records/:type/:id/history` checks `readPermission` against the property of the first audit
row. Guest profiles are organization-wide and their visibility depends on links, the sharing policy and consent;
the first row's property is merely where the profile was created.
**Proposal.** Optional `RecordTypeDefinition.canRead?(tx, id): Promise<boolean>` (or delegate to the module's
`SearchProvider.summarize` returning non-null) before returning history.
**Workaround.** Guest audit rows carry no personal values (field names only), so the exposure is limited to
the existence of changes and their reasons.

## 7. Scheduled jobs (`apps/worker`) — DONE on main; guests registers its jobs

`guestsJobs(service)` registers `guests.purgeExpiredDocuments` and `guests.scanDuplicates` in `Composition.jobs`.
Tenant discovery uses SECURITY DEFINER functions in schema `guests` returning tenant ids only. **Requirement:** the
function owner (migration role) must bypass RLS — the guests tables use FORCE ROW LEVEL SECURITY, so a
non-superuser owner without BYPASSRLS would see no rows. A generic, reviewed "tenants with work" mechanism in
`@portico/db` would remove this per-module pattern.

## 8. Free-text audit reasons and erasure (`packages/db`)

**Problem.** `core.audit_log.reason` is append-only free text typed by staff (merge reasons, reveal reasons). If a
reason contains a guest's name, erasure cannot remove it (GUE-I06 holds for every guests table, but not for
reasons typed into the shared audit log).
**Proposal.** UI guidance + a reason-redaction mechanism for erasure (e.g. an `audit_log_redactions` table read by
the history endpoint, or reasons stored by reference in a redactable table).
**Mitigation in guests (SW-GUE-1).** Every staff-typed reason guests writes is scrubbed of the subject's own names
(all scripts), contact values and date of birth before it is stored (`scrubReason`). Misspellings and other
people's names remain the residual; other modules' reasons are not covered.

## 9. Runtime provenance vocabulary for contracts (`packages/kernel`)

**Problem.** `Provenance` is a type only. Contracts (web-importable, Zod) need a runtime list, so modules copy
literals (self-check BS3-1).
**Proposal.** Export `PROVENANCES = [...] as const` from a web-safe kernel entry (no `node:` imports), and derive
`Provenance` from it.
**Workaround.** Guests declares its subset with `as const satisfies readonly Provenance[]` (type-only import), so
drift fails the build.
