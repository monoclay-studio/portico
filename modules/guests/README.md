# @portico/guests — guest profiles, companies & agencies

Knows **who** people and organizations are — guests, bookers, payers, company contacts, companies and travel
agents — so staff recognise returning guests, honour preferences and alerts, address the right payer and never
lose history to duplicates, with privacy built in: least-privilege access to sensitive fields, consent per
purpose, reversible merges and erasure that respects legal retention.

Spec: `docs/specs/guests.md` (GUE-R01…R20, GUE-I01…I07). Provider contract: `docs/architecture/domain-map.md`
§ guests. Schema `guests` (migration `migrations/0001_guests.sql`, 19 tables, all RLS-isolated).

## Layout

| Path | What |
|---|---|
| `src/domain/` | Pure logic + unit tests: names across scripts (ICAO 9303 Cyrillic transliteration, pg_trgm-identical trigram similarity), contact normalization (E.164, OTA proxy emails), duplicate scoring, profile scoping/visibility, merge decisions & chain resolution, consent/legal bases, companies (IATA check digit, commission in basis points, hierarchy), documents (keyed-hash inputs, retention), erasure plan |
| `src/service/` | Application services (`createGuestsService(ports)`): profiles, duplicates, merge/unmerge, consent, documents, history, search, companies, privacy, universal record contract (`record.ts`) |
| `src/routes.ts` | HTTP (`/v1/guests/...`) — Zod contracts, Idempotency-Key, ETag/If-Match, problem+json |
| `src/search-provider.ts` | `guestsSearchProvider(service)` for `GET /v1/search` and record summaries |
| `src/seed.ts` | `createGuestsDemoSeed(service)` → DemoSeedStep-compatible `{ name, run(tx, org) }` |
| `src/jobs.ts` | `guestsJobs(service)` — scheduled retention purge and nightly duplicate scan |

## Capabilities (spec MUST items) and status

Readiness uses CLAUDE.md §7. Nothing here is external; nothing is above R3. "Tested" = automated tests on a real
Postgres 16 in this worktree (2026-11-07, `pnpm --filter @portico/guests test`: 173 tests, 5 consecutive green
runs; plus 6 HTTP tests in `apps/api/test/guests.test.ts`). The steward review of 17b5fe0 (2 P0, 6 P1) is
addressed in 742f8e3; every finding has a regression test (see "Review fixes" below).

| Spec | Capability | Status | Readiness |
|---|---|---|---|
| R01 | Profiles: Latin + native-script names (auto ICAO transliteration for Cyrillic; Han/Arabic need the passport name), preferred name, language, nationality, DOB, VIP, tags, important dates, contact points (type, verification state, source, low-confidence), relationships, source record | Done | R3 |
| R02 | Structured preferences (category, value, scope all/property, source, last confirmed); special needs as a **sensitive category** (encrypted, `guests.sensitive.read`, audited) surfaced only as the guest-agreed alert text | Done | R3 |
| R03 | Alerts: severity, audience, active period (judged on the viewing property's business date — `activeNow`), visibility shared/property-private; only active critical alerts reach recognition and issues; `guests.alert.raised`; property-private alerts are managed only at their property | Done | R3 |
| R04 | Notes with visibility shared/property-private/department; never edited in place (revision supersedes; DB trigger refuses in-place edits and deletes) | Done | R3 |
| R05 | Identity documents: encrypted with the kernel `fieldCryptoFromEnv()` cipher (AAD-bound to tenant+row; key id stored), keyed blind indexes with a separate key (full number+country, last 4), masked by default, reveal with `guests.document.read` at the capturing property, every reveal (and every export decryption) audited with a reason, image refs only when property policy enables them, retention dates | Done | R3 (env/dev keys; KMS binding R1) |
| R06 | Consent per purpose per legal entity (validated as the organization's), granted/withdrawn/unknown, source + minimal evidence (text version, channel, time) in an append-only history; free-text references kept in a separately erasable column; lawful-basis registry (marketing/profiling = consent; cross-property sharing = legitimate interests unless policy requires consent) | Done | R3 |
| R07/R08 | Companies & agencies (kind), legal/trading name, tax id, IATA (check digit), parent hierarchy (cycle-safe, recursive CTE), default market segment, commission terms (basis points + reference), AR account reference, billing address/email, contacts with roles, status active/on_hold/inactive | Done — modelling overlaps with rates/finance noted below | R3 |
| R09 | `resolveProfile` strategies exact_only / suggest / create_new; never merges; proxy and unverified emails never exact keys; reuse and suggestions limited to profiles visible at the resolving property (sharing + entitlement + objection), otherwise a property-local profile is created and the pair queued | Done | R3 |
| R10 | Duplicate detection on create/update (exact keys = verified email, E.164 phone, document hash; unverified email = strong evidence only; pg_trgm names across scripts + DOB + nationality), exact-key candidates always considered before trigram ones, scores + reasons, exact keys stored as keyed hashes, review queue, dismissal memory, nightly cursor scan registered as a job (`guests.scanDuplicates`) | Done | R3 |
| R11 | Merge: field choices (default keep survivor / fill gaps / higher VIP), union of child records, preview with per-module reference counts (port), full snapshots + decisions + moved-row ids + survivor-row before/after; merged profile → status merged | Done | R3 |
| R12 | Unmerge: exact reversal, post-merge items listed with suggested owner (old id used, merged profile's contact value or document) and reassigned per review, `guests.profile.unmerged` with exact references per module + reassigned refs; blocked while the survivor is itself merged | Partial — once consumers re-point references, post-merge stays carry no identifier, so they are suggested to the survivor (staff decide); comms items not covered | R3 |
| R13 | Reads of merged ids resolve to the survivor with `resolvedFrom` (chain-safe) | Done | R3 |
| R14 | Stay history projection via `recordStayHistory` (roles occupant/booker/payer; idempotent upsert); spend summary counted once per stay, labelled `incomplete` | **Partial (MUST open)** — no consumption of `reservations.stay.*` events (reservations calls `recordStayHistory` directly, primary occupant only), no `finance.posting.created` revenue, no requests/service recovery | R3 (projection) / R1 (feeds) |
| R15 | Recognition summary (returning guest, stays, VIP, active critical alerts, key preferences, important dates) | **Partial (MUST open)** — service-recovery items and balance flags need operations/finance | R3 (what exists) |
| R16 | Cross-property sharing: entitlement `portfolio.crossPropertyProfiles` + policy `guests.crossPropertySharing` (`{enabled, requireConsent}`, default `{true,false}` per Q46, property overrides) + `guests.profile.readShared` + guest objection — applied to reads, search, resolution/reuse, suggestions, links, known-at properties and duplicate issues; writes never link a profile to a new property; property-private data never shared; reversible | Done (fixed after review; regression tests) | R3 |
| R17 | Data-subject export (JSON + manifest with `complete` and `withheld`): property-bound data only for properties where the requester holds `guests.privacy.export`, document/sensitive details only with `document.read`/`sensitive.read` there (each decryption audited); other modules via port; rebuilt per download, never stored. Not via the integration export framework | Done | R3 |
| R18 | Erasure = anonymization with retention across ALL 19 tables (test enumerates `information_schema` so a new table cannot be forgotten): PII deleted/redacted incl. duplicate keys, merge snapshots/decisions/results/reasons and consent references; consent kept as minimal evidence; stay/booking/revenue refs kept under the pseudonymous id; merged-in profiles anonymized (merge → `erased`); blocked by legal hold (request `on_hold`) ; erasure also reaches stored idempotent responses (SW-GUE-1: guests endpoints store ids only and rebuild on replay; any module's stored response mentioning the person's ids/emails/phones is redacted and replays as 410) and staff-typed reasons are scrubbed of the subject's identifiers before reaching the append-only audit log | Done (fixed after review and after the fix sweep) — residuals listed under "Erasure reach" | R3 |
| R19 | Retention schedules | **Partial (MUST open)** — identity documents only (policy `guests.retention.identityDocumentDays`, default 365 after last departure per Q44), daily job `guests.purgeExpiredDocuments` registered (skips legal holds, returns a run report); no schedules for other categories | R3 (documents) / R1 (others) |
| R20 | Search: names any script (typo-tolerant, transliteration-aware, word order), email, phone any format (E.164 + trailing national number), company, booking code (via `bookingLookup` port), document (last 4 / `CC:NUMBER`, permission-gated + audited); permission/sharing predicate inside the SQL | **Partial** — booking-code port unbound until reservations provides it; p95 at 1M profiles not measured | R3 |
| §14 | Connected mode: `upsertMirroredProfile` (provenance external, last sync, stable ids), identity edits refused for mirrored profiles / external authority, `forward` mode refused honestly ("forwarding not available"), extension data Portico-only and labelled, merge refused for mirrored profiles; trial → provenance `copied` | Done (no integration exception for suspected duplicates yet) | R3 |
| E15 | Wrongly edited preference/alert visible in history and restorable | Partial — audit records who changed what field (no values, by privacy design); no one-click restore | R1 |

Universal record contract (CLAUDE.md §4.17): `GuestProfile` and `CompanyView` carry `status` per family
(`{profile, privacy}` / `{company}`), `allowedActions` with plain-language disabled reasons and
`previewRequired` for merge/unmerge/erase, `issues` (possible duplicate, expired document, critical alert, no
verified contact, sparse profile, legal hold, mirrored profile / company on hold, no billing contact, no
commission terms), `links` (companies, relationships, stays, bookings, merges, merged-from, parent/subsidiaries,
contacts, AR account — only what the viewer may see), `provenance`. Manifest `recordTypes`: `guest_profile`, `company`, `identity_document`,
`special_need`, `duplicate_candidate`. `guestsSearchProvider` returns `guest_profile` and `company` hits and
summaries — permission- and sharing-aware (403/404 → no result). Audit `before`/`after` never contain names,
contacts, document numbers or sensitive details (field names only); the merge record, not the audit log, holds
snapshots and field values — and erasure redacts them. Staff-typed reasons are scrubbed of the subject's own
identifiers before they are stored (`scrubReason`); a misspelled name is the residual (FR-8).

## Invariants and the tests that prove them

| Invariant | Test |
|---|---|
| GUE-I01 merge chains end at an active profile; cycles refused | `src/domain/merge.test.ts`, `test/scenario-s15…` "chains resolve" |
| GUE-I02 merge→unmerge with no intervening change restores both profiles field-for-field and every child row | `test/scenario-s15…` "GUE-I02" (snapshot comparison) and the S15 test |
| GUE-I03 every re-pointed external reference is in the merge's reference map and replayed on unmerge | S15 test with a consumer implementing the protocol below via the real outbox dispatcher; idempotent re-delivery test. **Holds in production only once reservations' consumer follows the published protocol** (it does not yet) |
| GUE-I04 document numbers never in tables in plaintext, audit, outbox, profile views or exports without permission | `test/documents.test.ts` (tenant dump), `test/privacy.test.ts` (scoped export test) |
| GUE-I05 user without readShared at P sees nothing for a profile not known at P — including via resolution, suggestions, links and issues | `test/sharing.test.ts` (404, search, property narrowing, and the "review regressions" block) |
| GUE-I06 anonymized profile holds no personal data outside fiscal references | `test/privacy.test.ts` "GUE-I06" (every guests table AND every tenant-scoped `core` table — outbox, event deliveries, audit log, idempotency responses; both lists come from `information_schema`, so a new table fails the test until classified — scanned for 15 PII values after erasing a merged, duplicated, consented, mirrored guest; replays of stored responses answer 410); `apps/api/test/guests-erasure-idempotency.test.ts` (every idempotent guests endpoint over HTTP) |
| GUE-I07 marketing only with `granted` consent for that legal entity | `getConsent` + `src/domain/rules.test.ts`; enforcement is in comms |
| One active merge per merged profile; concurrent merges → exactly one wins | `test/scenario-s15…` "concurrent merges" (DB unique index + row locks) |
| Notes immutable | `test/profiles.test.ts` (DB trigger refuses update/delete) |
| Tenant isolation (RLS + app) incl. cross-tenant merge/unmerge/erase/reveal by id | `test/isolation.test.ts`, `apps/api/test/guests.test.ts` S17 |

## Scenarios covered

| Test file | Demonstrates |
|---|---|
| `test/scenario-s15-mistaken-merge.test.ts` | **S15**: two different "Ahmed Ali" merged by mistake; reservations (fake consumer) re-points a booking; post-merge stays/notes added (one via the old id); investigation preview suggests owners; unmerge restores both profiles and every child record, reassigns the post-merge stay, re-points the booking back via `guests.profile.unmerged`, document retention recomputed from each guest's own stays; audit shows merge then unmerge on both profiles with reasons and actor; pair not re-proposed; second unmerge refused |
| `test/profiles.test.ts` | **S04** roles: booker (company assistant), occupants (parent + child), payer are roles on stays/companies, not profile types; names across scripts; connected mode; companies; record contract + global search |
| `test/sharing.test.ts` | **S17/E09** cross-property: readShared, entitlement, policy on/off (reversible), property opt-out, guest objection, explicit-consent policy, department notes |
| `test/duplicates.test.ts` | Duplicate precision: same-name different DOB not proposed, shared family email not proposed, proxy emails ignored, typo / Cyrillic / Chinese matches, dismissal memory, nightly scan, exact-only reuse |
| `test/documents.test.ts` | Encryption at rest, AAD binding, masked view, audited reveal, cross-property refusal, last-4 search, retention purge/extension, special needs |
| `test/privacy.test.ts` | Consent bases, withdrawal keeps financial references, guest self-consent, export, erasure with retention, legal hold, survivor erasure seals merges |
| `test/isolation.test.ts` | Cross-tenant reads/writes/merges by id, RLS on raw SQL, deny-by-default, property scope |
| `apps/api/test/guests.test.ts` | HTTP: Idempotency-Key replay, validation problem+json, ETag/If-Match 409, search, audited reveal with `Cache-Control: no-store`, merge/unmerge over HTTP, `/v1/search` + `/v1/records/guest_profile/:id/history`, privacy export download, S17 over HTTP |

## Permissions (manifest)

`guests.profile.read` · `guests.profile.readShared` · `guests.profile.update` · `guests.profile.merge` ⚑ ·
`guests.profile.unmerge` ⚑ · `guests.alert.manage` · `guests.note.readPrivate` · `guests.sensitive.read` ⚑ ·
`guests.document.read` ⚑ · `guests.document.manage` ⚑ · `guests.privacy.export` ⚑ · `guests.privacy.erase` ⚑ ·
`guests.company.read` · `guests.company.manage` (⚑ = sensitive). All property-scoped. The task brief's
`guests.dsr.manage` is split into `guests.privacy.export` + `guests.privacy.erase` (spec §8). Company reads are
also allowed with `guests.profile.read` (operational need at the desk).

## Events

Emitted (payloads never contain personal values): `guests.profile.created`, `guests.profile.updated
{changedFields}`, `guests.profile.merged {mergeId, survivorId, mergedId}`, `guests.profile.unmerged {mergeId,
restoredId, survivorId, referencesToRestore: {module: EntityRef[]}, reassigned: EntityRef[]}`,
`guests.profile.anonymized`, `guests.consent.changed`, `guests.alert.raised`, `guests.company.created|updated|
statusChanged`, `guests.duplicate.detected`.
Consumed: none yet (stay history arrives through `recordStayHistory`; `finance.posting.created` revenue and
`operations.serviceRequest.completed` are future consumers).

**Consumer rule** for modules holding profile ids: on `merged`, re-point (idempotent by mergeId) and call
`recordReferenceRepoints(tx, {mergeId, module, references})` in the same transaction; on `unmerged`, restore
exactly `referencesToRestore[module]` to `restoredId` and re-point `reassigned`.

## Ports (`src/ports.ts`) and binding status

| Port | Bound in `apps/api/src/composition.ts` to | Status |
|---|---|---|
| `platform.assertWritable / hasEntitlement / resolvePolicy / getBusinessDate / legalEntityExists` | `@portico/platform` | Bound (real) |
| `platform.listPropertyIds / getPropertyCountry / getPropertyLegalEntityId` | `platform.listProperties/getProperty` with a system authorizer (FR-4) | Bound (real) |
| `crypto` (`{cipher, blindIndex}`) | kernel `fieldCryptoFromEnv()` — the module never handles keys or env names; key id read from the ciphertext | Bound (env/dev keys; KMS pending) |
| `referenceCounters` (merge preview counts per module) | `[]` | Orchestrator binds reservations/finance/comms at merge |
| `personalDataContributors` (DSR export) | `[]` | Orchestrator binds |
| `bookingLookup` (booking-code search) | unbound → no results | reservations |
| `communications` (history) | unbound → history shows `not_connected` | comms (wave 2) |

`Composition.services.guests` exposes the provider service; `Composition.jobs` includes `guestsJobs(service)`:
`guests.purgeExpiredDocuments` (daily) and `guests.scanDuplicates` (daily, cursor batches of 200 per transaction).
Tenants are discovered through `guests.tenants_with_expired_documents(date)` /
`guests.tenants_with_active_profiles()` (SECURITY DEFINER, tenant ids only; the function owner must bypass RLS).

## Provider contract (exact shapes — consumers align to this)

All provider functions are methods of `createGuestsService(ports)` and take the caller's `tx` first. They are
in-process calls bound in the composition root, never HTTP; "trusted" below means the calling module authorizes
its own command and guests does not re-check the user's guest permissions.

### `resolveProfile(tx, input: ProfileInput, opts?: { matchStrategy?: 'exact_only' | 'suggest' | 'create_new' })`

```ts
interface ProfileInput {
  propertyId: string;                 // REQUIRED — the property of the booking/stay (data authority + visibility)
  familyName?: string;                // Latin (passport) family name; optional only when nativeFamilyName is Cyrillic
  givenName?: string;                 //   (auto ICAO transliteration); Han/Arabic need the Latin name too
  middleName?: string; title?: string; preferredName?: string;
  nativeGivenName?: string; nativeFamilyName?: string;   // as written (王 / Иван …)
  language?: string;                  // BCP 47, e.g. 'ru', 'zh-Hans'
  nationality?: string;               // ISO 3166-1 alpha-2
  dateOfBirth?: string;               // 'YYYY-MM-DD'
  vipLevel?: string; tags?: string[];
  importantDates?: Array<{ kind: 'anniversary' | 'honeymoon' | 'birthday_celebration' | 'other'; date: string; note?: string }>;
  contactPoints?: Array<{ kind: 'email' | 'phone' | 'whatsapp' | 'address'; value: string; label?: string;
                          isPrimary?: boolean; verified?: boolean /* honoured for staff users only */;
                          verificationMethod?: string; source?: string }>;
  source?: { kind: string; ref?: string };   // e.g. { kind: 'channel', ref: 'BDC-123456' }
}
// → { profileId: string; created: boolean; possibleDuplicates: string[]; suggestions: Array<{ profileId; score; band; reasons }> }
```
Mapping from the shape currently in reservations' port: `firstName → givenName`, `lastName → familyName`,
`email → contactPoints: [{ kind: 'email', value }]`, `phone → contactPoints: [{ kind: 'phone', value }]`,
`birthDate → dateOfBirth`, plus `propertyId` = the booking's property. Permission: `guests.profile.update` at
`propertyId` (system consumers pass). Reuse happens only on an exact key (verified email / E.164 phone /
document) with a compatible name, when exactly one such profile is visible at `propertyId`; ids the caller may not
see are never returned.

### Other provider functions

| Function | Shape | Authorization |
|---|---|---|
| `getProfile(tx, profileId, opts?: { propertyId?: string })` | `GuestProfile` (`contracts.ts`), `resolvedFrom` set when a merged id was followed | 404 when not visible; 403 when the actor has no guests permission at all |
| `getCompany(tx, companyId)` | `CompanyView` | `guests.company.read` or `guests.profile.read` |
| `recordStayHistory(tx, { profileId, stayRef: { type: 'stay', id }, propertyId, bookingId?, role?: 'occupant' \| 'booker' \| 'payer' (default occupant), arrival, departure, status, unitTypeId?, ratePlanId?, companyId?, revenue?: Money, revenueProvenance? })` | `void`; idempotent per (profile, stay, role); links the profile to the property | trusted |
| `mergeProfiles(tx, { survivorId, mergedId, reason, fieldChoices? })` | `{ mergeId }` | `guests.profile.merge` at a property of each profile |
| `unmergeProfiles(tx, { mergeId, reason, assignments?: Array<{ kind, id, owner: 'survivor' \| 'restored' }> })` | `{ restoredId, survivorId, reassigned, conflicts }` | `guests.profile.unmerge` |
| `recordReferenceRepoints(tx, { mergeId, module, references: Array<{ type, id, field?: string \| null }> })` | `{ recorded }` — idempotent | system actors only (event consumers); `merge_not_active` (422) when the merge was already reversed/erased |
| `getConsent(tx, { profileId, legalEntityId, purpose, propertyId? })` | `{ state, legalBasis, mayProcess, changedAt }` | system actors or `guests.profile.read` |
| `getRecognitionSummary`, `searchProfiles`, `previewMerge`, `previewUnmerge`, `upsertMirroredProfile` | see `src/service/index.ts` | permissioned |

### Events (payloads never carry personal values)

```ts
// guests.profile.merged   (aggregate guest_profile = survivorId)
{ mergeId: string; survivorId: string; mergedId: string }
// guests.profile.unmerged (aggregate guest_profile = restoredId)
{ mergeId: string;
  restoredId: string;      // the profile that had been merged away and is active again
  survivorId: string;
  referencesToRestore: Record<string /* module */, Array<{ type: string; id: string; field?: string | null }>>;
  reassigned: Array<{ type: string; id: string }> }   // records created after the merge that belong to restoredId
```

### Consumer protocol (reservations, finance, comms, …)

1. **On `guests.profile.merged`** (in the delivery transaction, system context): re-point every reference you hold
   from `mergedId` to `survivorId`, then call
   `guests.recordReferenceRepoints(tx, { mergeId, module: '<your module>', references })` listing exactly what you
   changed (`field` names the column when one record holds several profile references). Re-delivery records
   nothing new. If it throws `merge_not_active`, the merge was reversed before you processed it — do not re-point.
2. **On `guests.profile.unmerged`**: restore exactly `referencesToRestore['<your module>']` to `restoredId`, and
   re-point each record in `reassigned` that you hold (e.g. `type: 'stay'`) to `restoredId`. Ignore other modules'
   entries. (Do not read `mergedId` or `restored[]` — they are not in the payload.)
3. Keep calling `resolveProfile`/`recordStayHistory` with whatever id you hold — merged ids resolve to the survivor
   and the original id is remembered for the unmerge review.

Contract changes vs `domain-map.md` § guests (additive except where noted): `ProfileInput.propertyId` is required
(**breaking** for reservations' current port — use the mapping above); `resolveProfile` also returns
`suggestions`; `getProfile` takes `{propertyId?}` and returns `resolvedFrom`; `unmergeProfiles` accepts
`assignments` and returns a result; `recordStayHistory` accepts `role`, `bookingId`, `companyId`, `revenue`; new
functions listed above. `domain-map.md` is outside this module's write scope — the orchestrator should copy this
section there.

## Adoption modes

- **Standalone alongside an external PMS:** yes (guest context for messaging, requests, transfers, analytics);
  hard dependencies `platform`, `identity`.
- **Data authority `guestProfiles`:** every identity/contact write calls `platform.assertWritable` for the
  profile's home property (creates: the creating property). `read_only` → explanatory refusal; `forward` →
  "forwarding not available yet" (nothing written — no fake success). Mirrored profiles (`external_refs`) are
  read-only for identity; preferences/alerts/notes/consent stay Portico-only and are labelled as such.
- **Trial:** profiles/companies created in a trial organization have provenance `copied`.

## Erasure reach (every place a guest's personal data can sit)

| Store | How erasure reaches it | Evidence |
|---|---|---|
| `guests.*` (19 tables) | deleted / anonymized / redacted per `ERASURE_PLAN` | `privacy.test.ts` "GUE-I06" (enumerates `information_schema`) |
| `core.idempotency_keys` (stored API responses, 30-day expiry) | guests endpoints store ids only and rebuild on replay (`src/replay.ts`, erased guest → 410); erasure replaces any module's stored response mentioning the person's profile ids, emails or phone numbers with an erased marker (replay → 410) | `privacy.test.ts` "GUE-I06" + race test; `guests-erasure-idempotency.test.ts` (PoC + 16 entry points); `packages/db/test/core.test.ts` |
| `core.audit_log` before/after | never written with personal values (field names, states, ids only) | "GUE-I06" scan |
| `core.audit_log` reason (free text, append-only) | staff-typed reasons are scrubbed of the subject's names (all scripts), contact values and date of birth before storing | `privacy.test.ts` "staff-typed reasons"; API sibling test (reasons containing the name) |
| `core.outbox` / `core.event_deliveries` | event payloads carry ids/states only; delivery errors carry no personal values | "GUE-I06" scan; API test `coreDump` |
| Search (pg_trgm indexes, global `/v1/search`) | indexes are on `guests.profiles` columns, updated by the anonymization itself; no separate index store | `privacy.test.ts` (search after erasure), API test |
| Data-subject exports | never stored; rebuilt per download from current data (an earlier export downloaded after erasure has no personal data) | API test "export requested before erasure" |
| HTTP caches (browsers, proxies) | every guests response is `Cache-Control: private, no-store` | API test "never cacheable" |
| Other modules' copies (reservations booker, finance payer, payments payer name, comms) | `guests.profile.anonymized` event for consumers; their stored idempotent responses are redacted when they mention the profile id, email or phone | consumers' own tests (outside this module) |
| Fiscal records (finance) | retained by law under the pseudonymous id (research 04 §C1) | by design |
| Backups / PITR | outside the application (retention per infra policy) | infra (not in scope) |

Residuals (honest): another module's stored response that embeds a guest's name **without** their id, email or
phone is not recognised — such endpoints must adopt replay plans (`ReplayPlan`) like guests; a misspelled name in
a staff-typed reason is not scrubbed (FR-8); request hashes (`request_hash`, SHA-256 of the request) remain until
expiry — not reversible without the full original request.

Replay semantics (contract change): a retried guests request returns the **current** state of the record it created
(same status code, current ETag), never a stored copy; after erasure it answers `410 idempotent_response_erased`.

## Known gaps

- KMS `FieldCipher` + secrets-manager blind-index key (production) — kernel helper is env-based today; no key
  rotation / re-encryption / re-index job yet (`key_id` is stored for it).
- MUSTs still open: R14 feeds (reservations events, finance revenue, ops/comms history), R15 service recovery and
  balance flags, R19 schedules beyond identity documents, R20 booking-code binding and p95 measurement.
- R12: after consumers re-point references, post-merge stays carry no identifier, so the unmerge review suggests
  the survivor for them (staff decide per item); comms items are not in the review.
- Merge field default is "keep survivor, fill gaps, higher VIP" rather than the spec's "most recently verified"
  (scalars carry no verification timestamps); the wizard can choose per field. VIP levels are a code list, not
  per-organization configuration.
- E15 one-click restore of a preference/alert edit — not built (audit shows the change without values).
- No integration exception for suspected duplicates of mirrored profiles (needs `integration`).
- No `owner` (account manager) on companies yet.
- Cross-module modelling to settle with rates/finance: commission vocabulary (guests: model + basis points;
  rates: commissionable/net + percent; reservations terms: percent/net_rate) — guests should hold a reference to
  the rates arrangement; AR account is keyed by (legal entity, company) in finance while guests keeps one
  `ar_account_ref`; company `on_hold` overlaps finance's AR `on_hold`.
- Identity role templates still lack `guests.alert.manage` / explicit `guests.company.read` for desk roles and a
  data-protection role (FR-5).

## Review fixes (steward review of 17b5fe0)

| Finding | Fix | Regression test |
|---|---|---|
| G-P0-1 erasure left PII | duplicate keys hashed; erasure clears merge decisions/results/reasons, candidate evidence, consent references (append-only history keeps minimal evidence; reference column erasable) | `privacy.test.ts` "GUE-I06" (all tables) |
| G-P0-2 resolution bypassed sharing | reuse/suggestions limited to profiles visible at the resolving property | `sharing.test.ts` review block |
| G-P1-1 scoped items writable from other properties | visibility + permission at the item's property | `sharing.test.ts` |
| G-P1-2 links/known-at leaked | filtered by stay visibility / sharing; duplicate issues need the other profile visible | `sharing.test.ts` |
| G-P1-3 export crossed properties | export scoped by `guests.privacy.export` per property, manifest `complete`/`withheld`, audited decryptions | `privacy.test.ts` |
| G-P1-4 contract mismatch | "Provider contract" section above | reservations to align |
| G-P1-5/6 README claims | statuses above corrected | — |
| G-P2 | jobs registered; exact-first candidates; verified-only email keys; idempotent repoints (`nulls not distinct`); alert periods; purge honours legal hold and scope; kernel crypto; no write-time linking; snapshot removed from the public service; document-hash post-merge suggestion | duplicates/documents/profiles/isolation/S15 tests |
| G-P3 | `merge_chain_corrupt` DomainError; dead code removed; recursive CTE for hierarchy; spend counted once per stay; legal entity validated; `POST …/documents/:id/delete`; company audit masks notes/address | domain + integration tests |
| G-P2-1 flaky 57P01 | main's harness fix (b484de3) merged; 5 consecutive green runs | — |
| SW-GUE-1 (fix sweep) erased guest still in stored idempotent responses | replay plans (ids only + rebuild) for every guests endpoint with personal data; erasure redacts stored responses of any module mentioning the person; replay reads FOR SHARE (waits for a racing erasure); reasons scrubbed; `no-store` responses | `guests-erasure-idempotency.test.ts`; "GUE-I06"; "an erasure racing a replay"; `core.test.ts` "idempotency without personal data" |

## Open questions for the owner

- **Q43** (registration / passport storage): default — document fields optional, encrypted; images refused unless
  property policy `guests.documentImages.enabled` is set.
- **Q44** (retention): default — identity documents 365 days after last departure (policy-configurable).
- **Q46** (sharing default): implemented as written (sharing on within the organization for readShared holders,
  reversible per organization and per property, objection respected, explicit-consent mode available).
- New: is keeping **nationality** after erasure (for anonymous tourism statistics) acceptable? Default: kept.
- New: lawful bases per purpose are product defaults (marketing/profiling = consent; sharing = legitimate
  interests) — the hotel as controller must confirm them per jurisdiction; not a legal opinion.
