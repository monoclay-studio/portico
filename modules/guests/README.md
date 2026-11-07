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
| `src/crypto.ts` | `localGuestsCrypto(key)` — development binding of the crypto port |

## Capabilities (spec MUST items) and status

Readiness uses CLAUDE.md §7. Nothing here is external; nothing is above R3. "Tested" = automated tests on a real
Postgres 16 in this worktree (2026-11-07, `pnpm --filter @portico/guests test`, 157 tests passing; plus 6 HTTP
tests in `apps/api/test/guests.test.ts`).

| Spec | Capability | Status | Readiness |
|---|---|---|---|
| R01 | Profiles: Latin + native-script names (auto ICAO transliteration for Cyrillic; Han/Arabic need the passport name), preferred name, language, nationality, DOB, VIP, tags, important dates, contact points (type, verification state, source, low-confidence), relationships, source record | Done | R3 |
| R02 | Structured preferences (category, value, scope all/property, source, last confirmed); special needs as a **sensitive category** (encrypted, `guests.sensitive.read`, audited) surfaced only as the guest-agreed alert text | Done | R3 |
| R03 | Alerts: severity, audience, active period, visibility shared/property-private; critical alerts in recognition summary + `guests.alert.raised` | Done | R3 |
| R04 | Notes with visibility shared/property-private/department; never edited in place (revision supersedes; DB trigger refuses in-place edits and deletes) | Done | R3 |
| R05 | Identity documents: FieldCipher-encrypted (AAD-bound to tenant+row), keyed blind indexes (full number+country, last 4), masked by default, reveal with `guests.document.read` at the capturing property, every reveal audited with a reason, image refs only when property policy enables them, retention dates | Done | R3 (dev cipher; KMS binding R1) |
| R06 | Consent per purpose per legal entity, granted/withdrawn/unknown, source + evidence, append-only evidence history; lawful-basis registry (marketing/profiling = consent; operations = contract/legal obligation; cross-property sharing = legitimate interests unless policy requires consent) | Done | R3 |
| R07/R08 | Companies & agencies (kind), legal/trading name, tax id, IATA (check digit), parent hierarchy (cycle-safe), default market segment, commission terms (basis points + reference), AR account reference, billing address/email, contacts with roles, status active/on_hold/inactive | Done | R3 |
| R09 | `resolveProfile` strategies exact_only / suggest / create_new; never merges; proxy emails never exact keys | Done | R3 |
| R10 | Duplicate detection on create/update (exact email/E.164/document hash + pg_trgm names across scripts + DOB + nationality), scores + reasons, review queue, dismissal memory (re-opened only by a new exact key), bounded scan for a nightly job | Done (scan not scheduled — worker) | R3 |
| R11 | Merge: field choices (default keep survivor / fill gaps / higher VIP), union of child records, preview with per-module reference counts (port), full snapshots + decisions + moved-row ids + survivor-row before/after; merged profile → status merged | Done | R3 |
| R12 | Unmerge: exact reversal, post-merge items listed with suggested owner and reassigned per review, `guests.profile.unmerged` with exact references per module + reassigned refs; blocked while the survivor is itself merged | Done | R3 |
| R13 | Reads of merged ids resolve to the survivor with `resolvedFrom` (chain-safe) | Done | R3 |
| R14 | Stay history projection via `recordStayHistory` (roles occupant/booker/payer; idempotent upsert); spend summary placeholder labelled `incomplete` | Partial — revenue from `finance.posting.created`, requests/service recovery not consumed yet | R3 (projection) / R1 (finance/comms feeds) |
| R15 | Recognition summary (returning guest, stays, VIP, critical alerts, key preferences, important dates) | Partial — service-recovery items and balance flags need operations/finance | R3 |
| R16 | Cross-property sharing: entitlement `portfolio.crossPropertyProfiles` + policy `guests.crossPropertySharing` (`{enabled, requireConsent}`, default `{true,false}` per Q46, property overrides) + `guests.profile.readShared` + guest objection; property-private data never shared; reversible | Done | R3 |
| R17 | Data-subject export (JSON + manifest, contributions from other modules via port, document details only with permission); data rebuilt per download, never stored | Done | R3 |
| R18 | Erasure = anonymization with retention: PII removed/redacted, consent kept as minimal evidence, stay/booking/revenue refs kept under the pseudonymous id, merged-in profiles anonymized and merge snapshots redacted (merge → `erased`), blocked by legal hold (request `on_hold`) | Done | R3 |
| R19 | Retention schedules | Partial — identity documents only (policy `guests.retention.identityDocumentDays`, default 365 after last departure per Q44); job function exists, not scheduled | R2 |
| R20 | Search: names any script (typo-tolerant, transliteration-aware, word order), email, phone any format (E.164 + trailing national number), company, document (last 4 / `CC:NUMBER`, permission-gated + audited); permission/sharing predicate inside the SQL | Done — booking code search needs reservations; p95 target not measured | R3 |
| §14 | Connected mode: `upsertMirroredProfile` (provenance external, last sync, stable ids), identity edits refused for mirrored profiles / external authority, `forward` mode refused honestly ("forwarding not available"), extension data Portico-only and labelled, merge refused for mirrored profiles; trial → provenance `copied` | Done (no integration exception for suspected duplicates yet) | R3 |
| E15 | Wrongly edited preference/alert visible in history and restorable | Partial — audit records who changed what field (no values, by privacy design); no one-click restore | R1 |

Universal record contract (CLAUDE.md §4.17): `GuestProfile` and `CompanyView` carry `status` per family
(`{profile, privacy}` / `{company}`), `allowedActions` with plain-language disabled reasons and
`previewRequired` for merge/unmerge/erase, `issues` (possible duplicate, expired document, critical alert, no
verified contact, sparse profile, legal hold, mirrored profile / company on hold, no billing contact, no
commission terms), `links` (companies, relationships, stays, bookings, merges, merged-from, parent/subsidiaries,
contacts, AR account), `provenance`. Manifest `recordTypes`: `guest_profile`, `company`, `identity_document`,
`special_need`, `duplicate_candidate`. `guestsSearchProvider` returns `guest_profile` and `company` hits and
summaries — permission- and sharing-aware (403/404 → no result). Audit `before`/`after` never contain names,
contacts, document numbers or sensitive details (field names only); the merge record, not the audit log, holds
snapshots — and erasure redacts them.

## Invariants and the tests that prove them

| Invariant | Test |
|---|---|
| GUE-I01 merge chains end at an active profile; cycles refused | `src/domain/merge.test.ts`, `test/scenario-s15…` "chains resolve" |
| GUE-I02 merge→unmerge with no intervening change restores both profiles field-for-field and every child row | `test/scenario-s15…` "GUE-I02" (snapshot comparison) and the S15 test |
| GUE-I03 every re-pointed external reference is in the merge's reference map and replayed on unmerge | S15 test (fake reservations consumer via the real outbox dispatcher) |
| GUE-I04 document numbers never in tables in plaintext, audit, outbox, profile views or exports without permission | `test/documents.test.ts` (tenant dump), `test/privacy.test.ts` (export withheld) |
| GUE-I05 user without readShared at P sees nothing for a profile not known at P | `test/sharing.test.ts` (404 + search empty + property view narrowing) |
| GUE-I06 anonymized profile holds no personal data outside fiscal references | `test/privacy.test.ts` (table dump regex, search empty, consent not processable) |
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
| `platform.assertWritable / hasEntitlement / resolvePolicy` | `@portico/platform` | Bound (real) |
| `platform.listPropertyIds / getPropertyCountry / getPropertyLegalEntityId` | `platform.listProperties/getProperty` with a system authorizer (see FOUNDATION_REQUESTS) | Bound (real) |
| `crypto` (FieldCipher + blind index) | `localGuestsCrypto(PORTICO_FIELD_ENCRYPTION_KEY)`; dev-only derived key outside production; refuses to start in production without a key | Dev binding; **KMS binding pending** |
| `referenceCounters` (merge preview counts per module) | `[]` | Orchestrator binds reservations/finance/comms at merge |
| `personalDataContributors` (DSR export) | `[]` | Orchestrator binds |
| `communications` (history) | unbound → history shows `not_connected` | comms (wave 2) |

`Composition.services.guests` exposes the provider service so reservations/finance/comms ports can bind to it.

## Provider contract and contract changes

Domain map functions, as methods of `createGuestsService(ports)` (factory because the module needs ports):
`resolveProfile(tx, input, {matchStrategy})`, `getProfile(tx, id)`, `getCompany(tx, id)`,
`recordStayHistory(tx, {profileId, stayRef, propertyId, …})`, `mergeProfiles(tx, {survivorId, mergedId, reason})`,
`unmergeProfiles(tx, {mergeId, reason})`.

Contract changes (all additive):
1. `ProfileInput` requires `propertyId` (where the guest is being recorded: data authority + visibility).
2. `resolveProfile` also returns `suggestions` (scores + reasons).
3. `getProfile(tx, id, {propertyId?})`; the returned `GuestProfile` carries `resolvedFrom` (spec §6.1 proposed a
   wrapper object — kept flat to stay compatible with the domain map's `Promise<GuestProfile>`).
4. `unmergeProfiles(tx, {mergeId, reason, assignments?})` returns `{restoredId, survivorId, reassigned, conflicts}`.
5. New: `getRecognitionSummary`, `getConsent`, `searchProfiles` (spec §6 proposals), `recordReferenceRepoints`
   (consumer reporting for GUE-I03), `upsertMirroredProfile` (integration, connected mode), `previewMerge`,
   `previewUnmerge`.
6. `recordStayHistory` accepts `role` (occupant/booker/payer), `bookingId`, `companyId`, `revenue: Money`.
   `domain-map.md` should be updated by the orchestrator (outside this module's write scope).

## Adoption modes

- **Standalone alongside an external PMS:** yes (guest context for messaging, requests, transfers, analytics);
  hard dependencies `platform`, `identity`.
- **Data authority `guestProfiles`:** every identity/contact write calls `platform.assertWritable` for the
  profile's home property (creates: the creating property). `read_only` → explanatory refusal; `forward` →
  "forwarding not available yet" (nothing written — no fake success). Mirrored profiles (`external_refs`) are
  read-only for identity; preferences/alerts/notes/consent stay Portico-only and are labelled as such.
- **Trial:** profiles/companies created in a trial organization have provenance `copied`.

## Known gaps

- KMS `FieldCipher` + separate blind-index key from a secrets manager (production) — not built.
- Nightly duplicate scan and retention purge are functions; the worker does not schedule them yet.
- Retention schedules other than identity documents (communications, profiles of non-returning guests) — R1.
- Finance revenue feed and comms/operations history — placeholders (`incomplete` / `not_connected`).
- Merge field default is "keep survivor, fill gaps, higher VIP" rather than the spec's "most recently verified"
  (scalars carry no verification timestamps); the wizard can choose per field.
- E15 one-click restore of a preference/alert edit — not built (audit shows the change without values).
- No integration exception for suspected duplicates of mirrored profiles (needs `integration`).
- Search p95 at 1M profiles not measured (GIN trigram indexes in place).
- Identity role templates do not yet include `guests.company.read`, `guests.alert.manage`, `guests.profile.readShared`
  for desk roles (identity module) — see FOUNDATION_REQUESTS.

## Open questions for the owner

- **Q43** (registration / passport storage): default — document fields optional, encrypted; images refused unless
  property policy `guests.documentImages.enabled` is set.
- **Q44** (retention): default — identity documents 365 days after last departure (policy-configurable).
- **Q46** (sharing default): implemented as written (sharing on within the organization for readShared holders,
  reversible per organization and per property, objection respected, explicit-consent mode available).
- New: is keeping **nationality** after erasure (for anonymous tourism statistics) acceptable? Default: kept.
- New: lawful bases per purpose are product defaults (marketing/profiling = consent; sharing = legitimate
  interests) — the hotel as controller must confirm them per jurisdiction; not a legal opinion.
