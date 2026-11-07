# Foundation requests from the guests module

Problems found while building `@portico/guests` that need a change outside this module. Each lists the problem,
the proposed change, and how the module works around it today.

## 1. Idempotency records keep personal data indefinitely (`packages/db`)

**Problem.** `runIdempotent` stores the full response body in `core.idempotency_keys`. For `POST /v1/guests/profiles`
that body contains names and contact details; erasure (GUE-R18 / GUE-I06) cannot reach it, and nothing expires it.
**Proposal.** Add `expires_at timestamptz` (default `created_at + interval '7 days'`) and a purge job in the
worker; optionally `runIdempotent(…, { storeBody: false })` that stores only `{status, id}` and lets the route
re-read the record on replay.
**Workaround.** Privacy exports are never stored (the POST returns only the request record; data is downloaded
separately and rebuilt per download). Profile-create responses still contain PII until this lands.

## 2. Query strings with personal data reach request logs (`packages/http`)

**Problem.** Fastify logs `req.url`, so `GET /v1/guests/search?q=anna.schmidt@…` and `GET /v1/search?q=…` write
names, emails and phone numbers into logs (CLAUDE.md §6: PII is never logged).
**Proposal.** In `createServer`, a request serializer that logs the path without the query string (or redacts
`q`), e.g. `serializers: { req: (r) => ({ method: r.method, url: r.url.split('?')[0], id: r.id }) }`. Also add
`*.number` (document number in `POST …/documents`) and `*.detail` (special needs) to `LOG_REDACT` in case bodies
are ever logged.
**Workaround.** None in-module (routes follow the shared GET search convention).

## 3. Production `FieldCipher` (KMS) and a separate blind-index key (`packages/kernel` / infra)

**Problem.** Only `localFieldCipher` exists. Guests also needs a keyed hash (HMAC) for document numbers whose key
must be separate from the encryption key and never leave the secrets manager.
**Proposal.** `kmsFieldCipher(kmsKeyArn)` (envelope encryption, data-key caching) and `hmacBlindIndex(secretRef)`
in the kernel/infra layer; the composition root binds `GuestsCryptoPort { cipher, keyId, blindIndex }`.
**Workaround.** `localGuestsCrypto(PORTICO_FIELD_ENCRYPTION_KEY)` derives a separate HMAC key from the same secret;
the composition refuses to start in production without a configured key. Key rotation re-encryption is not built.

## 4. Unpermissioned property directory for module ports (`modules/platform`)

**Problem.** Guests must evaluate policies for "all properties of the organization" and read a property's
country/legal entity regardless of the caller's `platform.property.read` scope (e.g. a desk agent at property A
viewing a shared profile). Platform only exposes permission-checked `listProperties`/`getProperty`.
**Proposal.** `platform.propertyDirectory(tx): Promise<Array<{ id, countryCode, legalEntityId, timezone }>>`
— routing metadata only, no permission check, for provider use.
**Workaround.** The composition root calls `listProperties`/`getProperty` with `{ ...tx, authz: systemAuthorizer }`.

## 5. Role templates for the guests permissions (`modules/identity`)

**Proposal.** front_desk / reservations_agent: add `guests.company.read`, `guests.alert.manage`,
`guests.profile.readShared` (organizations with sharing). general_manager already has `guests.*`. A new
"Data protection officer" template: `guests.profile.read`, `guests.privacy.export`, `guests.privacy.erase`,
`guests.document.read`, `guests.sensitive.read`. Also: `platform.dataAuthority.manage` is checked by
`platform.setDataAuthority` but not registered in the platform manifest.

## 6. Record history permission for organization-wide records (`apps/api/src/records-routes.ts`)

**Problem.** `GET /v1/records/:type/:id/history` checks `readPermission` against the property of the first audit
row. Guest profiles are organization-wide and their visibility depends on links, the sharing policy and consent;
the first row's property is merely where the profile was created.
**Proposal.** Optional `RecordTypeDefinition.canRead?(tx, id): Promise<boolean>` (or delegate to the module's
`SearchProvider.summarize` returning non-null) before returning history.
**Workaround.** Guest audit rows carry no personal values (field names only), so the exposure is limited to
the existence of changes and their reasons.

## 7. Scheduled jobs (`apps/worker`)

Daily: `purgeExpiredDocuments(tx)` (retention) and `scanDuplicates(tx, {afterId, batch})` (nightly duplicate
scan, cursor-based) per tenant, running with a system context.
