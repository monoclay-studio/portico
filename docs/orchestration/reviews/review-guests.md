# Steward review: `feat/guests-core` (module `guests`)

- **Worktree:** /home/user/wt/guests
- **Head:** 17b5fe0
- **Base:** merge-base 7da7d98. The branch is now 3 commits behind main (df48df7, 272cdf3, 82b004a).
- **Reviewer:** architecture steward. No worktree files were modified.
- **Probe tests:** the probes I wrote are in the scratchpad (`probe/probe.test.ts`) and were run against the worktree.

## Verdict: **do not merge** (yet)

The module is unusually thorough. It has:
- a careful reversible merge with snapshots, and a strong S15 test;
- real encryption and blind indexes;
- honest connected-mode refusals;
- the universal record contract and a search provider.

However, probes confirm **two P0 privacy defects**:
- erasure leaves personal data behind (GUE-I06);
- profile resolution bypasses the sharing policy and the guest's objection (GUE-I05).

There are also **six P1 issues**:
- three property-scope authorization or visibility leaks;
- a provider/consumer contract mismatch with the reservations worktree;
- partial MUSTs;
- README claims that the P0s contradict.

All fixes are local to the module. One focused fix round should make it mergeable.

## Command results (PORTICO_TEST_DB_PREFIX=review_guests)

| Command | Result |
|---|---|
| `pnpm install` | OK (lockfile up to date) |
| `pnpm lint` | PASS. Biome: 147 files, no issues. `check-boundaries`: OK, 3 modules. |
| `pnpm typecheck` | PASS, 9/9. Re-ran with `turbo --force` to avoid the cache replay: PASS. |
| `pnpm --filter @portico/guests test` | **FAIL on the first run (exit 1).** 14 files, 157/157 tests passed, but Vitest reported **1 unhandled error**: `error: terminating connection due to administrator command` (57P01, db `review_guests_901b0f76f0`), originating in `test/profiles.test.ts`. Three re-runs: 157/157, clean. **Flaky** (1 of 4 runs). |
| `pnpm --filter @portico/api test` | PASS (4 files, 17 tests, including 6 guests HTTP tests) |
| `git merge-tree main HEAD` | **CONFLICT** in `apps/api/src/composition.ts`. Main's 272cdf3 added `jobs: ScheduledJob[]`. |
| Parity gate | Skipped as instructed. `docs/parity/guests.md` does not exist on the branch, on main or in `/home/user/wt/parity-ops`. `node tools/parity-report.mjs --gate guests` on main: *"No parity file for module guests — a module cannot pass the gate without one."* |

### Steward probes (`probe/probe.test.ts`), all reproduced against the branch code

| Probe | Result |
|---|---|
| P1 erasure leftovers | After erasing a merged survivor, these remain: `duplicate_candidates.exact_keys` holds `email:zanele.mokoena@guest.example`; `merges` holds `Zanele`, `Mokoena`, `1977-04-04` (in `decisions`); `consent_events` holds `198.51.100.77`. |
| P2 cross-property resolution | Setup: sharing is off org-wide, the guest has withdrawn `cross_property_sharing`, and desk B holds read+update at B only. Before: `getProfile` → **404**. `createProfile` (suggest) at B returns the hidden profile id with reason "Same name". `resolveProfile` (exact_only) at B with the same email **reuses A's profile**. Afterwards B gets `visibility: full`, `dob: 1985-05-05` and the phone captured at A. |
| P3 property-private item writes | Desk B cannot see A's scoped preference or A's private alert (`seesPref:false`, `seesAlert:false`), yet `updatePreference` → updated, `resolveAlert` → resolved, `removePreference` → deleted. |
| P4 links leak | Sharing is off and the guest is known at A and B. Desk B's history shows only B, but `profile.links` contains A's stay id and booking id, and `knownAtPropertyIds` = 2. |
| P5 repoint idempotency | `recordReferenceRepoints` with the same ref twice (`field` omitted): recorded 1, then 1 again. `referencesRepointed = {reservations: 2}`. |
| P6 expired alert | A critical alert with `activeTo: 2020-01-31` still appears in `getRecognitionSummary.criticalAlerts` and in `issues`. |
| P7 unguarded service | A user with **no grants** calls `svc.snapshotProfile(id)` → returns PII. `getConsent` → returns. |
| P8 export scope | A DPO scoped to A only (export + document.read + sensitive.read at A) exports a profile known at A and B. The export contains B's passport number `BPASS9876`, B's medical detail and B's property-private note. The same user's profile view correctly shows none of them. |

## Findings (ranked)

### P0

| ID | File:line | Problem | Why it matters | Fix |
|---|---|---|---|---|
| **G-P0-1** | `src/service/privacy.ts:294-406`; `src/service/merge.ts:522` (`decisions` stored with values), `:1010-1018` (pair memory stores `exact_keys`); `src/service/duplicates.ts:134-151` (`exact_keys`, `reasons`); `migrations/0001_guests.sql:260-273,379,404,414` | **Erasure leaves personal data behind.** These are never redacted (probe P1): <br>• `duplicate_candidates.exact_keys` = plaintext `email:<addr>` / `phone:<E.164>`; <br>• `merges.decisions` (survivor/merged values for names, DOB, nationality), `survivor_updates` (consent evidence) and `unmerge_result` (field-conflict values); <br>• `consent_events.evidence` (append-only, carries `reference`, e.g. an IP address). <br>The I06 test (`test/privacy.test.ts:240-253`) dumps only 5 of 19 tables. | Violates GUE-I06 and GUE-R18. The request is still marked `completed`, so the hotel would tell a data subject they were erased when they were not. README claims I06 is proven. | • Store exact keys as keyed blind-index hashes (`email:<hmac>`), never plaintext. <br>• On erasure, null the values in `decisions` (keep field + side + rule) and clear `survivor_updates`, `unmerge_result` and candidate `reasons`/`exact_keys`. <br>• Consent evidence: keep only `{textVersion, channel, capturedAt}` in the append-only `consent_events`. Put free-text `reference` in a redactable column/table, or have erasure run a guarded `SECURITY DEFINER` redaction. <br>• Make the I06 test dump **every** table in schema `guests` (iterate `information_schema.tables`) after erasing a merged + duplicated + consented profile. |
| **G-P0-2** | `src/service/profiles.ts:237-298` (resolve), `:272` (`linkProperty(...,'resolved')`), `:283/:296` (suggestions unfiltered), `:301-309` (`createProfile` returns them); `src/service/duplicates.ts:67-100` (tenant-wide candidates) | **Profile resolution ignores the sharing policy, the entitlement and the guest's objection.** `exact_only` (the default for channels and imports) reuses a profile from any property. It then links it to the resolving property, which gives that property a `full` view: DOB, contacts captured elsewhere, VIP, tags, important dates. This happens even when sharing is off and the guest objected. `suggest` returns hidden profile ids with match reasons (an existence/attribute oracle). Probe P2. | Violates GUE-I05 ("sees nothing (404)"), GUE-R16 (sharing switchable) and the recorded objection (`cross_property_sharing = withdrawn`). Every OTA booking at property B for a guest known at A silently "shares" the profile. The link persists after sharing is switched off. | • Reuse a profile known only at other properties only when `sharingApplies` at the resolving property: entitlement + policy enabled + consent not withdrawn (or `granted` when `requireConsent`). Otherwise create a property-local profile and queue an org-level duplicate candidate for an org-wide reviewer. <br>• Filter `suggestions`/`possibleDuplicates` through the caller's visibility (`visibleIds`). <br>• Add tests for sharing off, objection, and missing entitlement. |

### P1

| ID | File:line | Problem | Why it matters | Fix |
|---|---|---|---|---|
| **G-P1-1** | `src/service/profiles.ts:567-632` (`updatePreference`, `removePreference`), `:698-738` (`resolveAlert`) | Property-private children are loaded by id and authorized only against the **profile**, not the item's property. Staff at B can change, delete or resolve A's scoped preference and private alert, which they cannot even see (probe P3). | Property-scope authorization bypass. Integrity of another property's data; deny-by-default (CLAUDE.md §6). | • After loading the child, 404 if `itemVisible`/scope check fails. <br>• `requirePermission(perm, {propertyId: item.property_id ?? item.scope_property_id})` for scoped items. <br>• Add tests. |
| **G-P1-2** | `src/service/record.ts:70-76,223-233`; `src/service/view.ts:107` | `links` include up to 20 stays and bookings of **all** properties, unfiltered by `stayVisible`. `knownAtPropertyIds` lists every property. When sharing is off, B still learns A's stay ids, dates (in `title`) and booking ids (probe P4). `possible_duplicate` issues likewise ignore the other profile's visibility (`record.ts:166-174`). | R16: "turning off hides shared data". Stay history is a shared field gated by sharing. | Pass the visibility-filtered stays into `profileRecord`. Filter `knownAtPropertyIds` to the viewer's properties unless sharing applies. Show duplicate issues only when the viewer can see both profiles. |
| **G-P1-3** | `src/service/privacy.ts:128-240` (`tx.authz.can('guests.document.read')` / `can('guests.sensitive.read')` without `propertyId`, `:130,:150`; all notes and alerts at `:197-206`) | A data-subject export by a user scoped to property A decrypts **B's passport numbers and medical details** and includes B's property-private and department notes (probe P8). Document details get no per-document reveal audit. | Breaks the README's own rule ("reveal with `guests.document.read` at the capturing property"), Q46 (documents never shared) and least privilege for ⚑ data. | Either require **org-wide** `guests.privacy.export` (a DPO role), or include sensitive and private items only for properties where the actor holds the permission, marking the rest "withheld" in the manifest. Audit each document reveal in the export. |
| **G-P1-4** | `src/service/profiles.ts:224-227` (`ProfileInput`), `src/service/merge.ts:1047-1056` (unmerged payload), `src/events.ts`; `docs/architecture/domain-map.md:145-155` unchanged | **Contract mismatch with the reservations worktree** (`/home/user/wt/reservations`). See the breakdown below this table. | GUE-I03 and S15 hold only against the test's fake consumer. With the real reservations module, unmerge restores **nothing** and the reference map stays empty. | In this branch, write the provider shapes into `domain-map.md`: `ProfileInput`, the `merged`/`unmerged` payloads and the consumer protocol (re-point + `recordReferenceRepoints` in the same tx; on `merge_not_active`, skip). The orchestrator then aligns reservations' port (or adds a composition adapter) and its consumer. |
| **G-P1-5** | README "Capabilities" | Spec MUSTs only partially implemented (declared honestly in the README, but still missing MUSTs): <br>• **R14**: no consumption of `reservations.stay.*` or `finance.posting.created`; no requests/service recovery. <br>• **R15**: no service-recovery items or balance flags. <br>• **R19**: identity documents only; not scheduled; no per-category schedules or run report. <br>• **R20**: no booking-code search; p95 not measured. <br>• **R12**: post-merge communications not covered; see G-P2-9 on owner suggestion. <br>• **R03**: active period not enforced (G-P2-7). <br>• **R10**: unverified emails used as exact keys (G-P2-5). <br>• **E15**: no restore. | Missing MUSTs per the brief. | Track each in the readiness register. Wire R14 as an idempotent event consumer when reservations merges. Register the R19 job (G-P2-2). |
| **G-P1-6** | `modules/guests/README.md` (capability table, invariants table, scenarios table, record-contract paragraph) | Claims that the probes contradict: <br>• R16 "Done R3" and R18 "Done R3"; <br>• GUE-I05 and GUE-I06 "proven"; <br>• E09 "cross-property 404"; <br>• "the merge record, not the audit log, holds snapshots — and erasure redacts them" (`decisions` is not redacted); <br>• Contract change 1 called "additive" (it is not, for the existing reservations port). | Honest readiness (CLAUDE.md §7, checklist 11). | Downgrade these to Partial until G-P0-1/2 and G-P1-1/2/3 are fixed and their tests are added. |

**G-P1-4 breakdown: what does not line up between guests and reservations**

- **`ProfileInput` shape.**
  - Guests: requires `propertyId`; uses `givenName`/`familyName`, `contactPoints[]`, `dateOfBirth`.
  - Reservations' port (`modules/reservations/src/ports.ts:266-282`): `firstName`/`lastName`/`email`/`phone`/`birthDate`, no `propertyId`.
- **Unmerge consumer.** Reservations' consumer (`modules/reservations/src/service/subscriptions.ts:55-92`):
  - reads `p.mergedId` and `p.restored[{module,type,id}]`, but guests emits `{mergeId, restoredId, survivorId, referencesToRestore:{module:[…]}, reassigned}`, so the unmerge handler is a **no-op**;
  - re-points everything on merge without calling `recordReferenceRepoints`.
- **Domain map not updated.** `domain-map.md` was not updated in the same commit (rule "Update this file in the same commit as the provider change"). The README defers this to the orchestrator.

### P2

| ID | File:line | Problem | Fix |
|---|---|---|---|
| G-P2-1 | `test/profiles.test.ts` (origin per Vitest) / `packages/testing/src/database.ts:66-75` | **Flaky suite.** In 1 of 4 runs an unhandled 57P01 from a connection still alive at `drop database … with (force)` makes `pnpm --filter @portico/guests test` exit 1. Root cause not isolated: a connection outlives `db.close()`, possibly a pg pool without an `error` listener. | Find the leaked or unawaited connection. Add a pool `error` listener in the harness. Main requires green before merge (CLAUDE.md §8). |
| G-P2-2 | `apps/api/src/composition.ts` | Merge conflict with main (272cdf3 `jobs`). The guests jobs (`purgeExpiredDocuments`, `scanDuplicates`) are not registered, although FR-7's framework now exists on main. | Rebase. Add `ScheduledJob`s for both (system context, per tenant, cursor for the scan). |
| G-P2-3 | `src/service/index.ts:149,167,50,77,72` | Public provider surface without authorization: `snapshotProfile` (full PII snapshot incl. ciphertexts, to a user with no grants, probe P7), `detectDuplicates` (writes), `recordStayHistory`, `recordReferenceRepoints`, `getConsent`. All are exposed via `Composition.services.guests`. | Remove `snapshotProfile`/`detectDuplicates` from the public service (keep test-only exports). For trusted provider calls, assert a system/provider actor or a provider permission, and document the trust model in the domain map. |
| G-P2-4 | `src/service/duplicates.ts:67-82` | `candidateIds` is `limit 50` with **no ORDER BY**, mixing exact-key and trigram matches. For common names (e.g. "Mohamed Ali", very common in the Maldives) the exact email/document match can be dropped, so `exact_only` creates duplicates. | Query exact keys first (always included), then trigram `order by similarity desc limit n`. |
| G-P2-5 | `src/service/duplicates.ts:44-56`, `src/service/profiles.ts:262-267`, `src/contracts.ts:61` | Exact keys use **unverified** emails and phones; the spec says "verified email". Clients can self-assert `verified: true` on create, which also drives reuse. | Reuse only on a verified email, a document hash or a trusted source. Treat unverified matches as strong evidence for the queue. Restrict who may set `verified`. |
| G-P2-6 | `migrations/0001_guests.sql:435`, `src/service/merge.ts:574-611` | `recordReferenceRepoints` claims to be idempotent, but the unique key includes the nullable `field`. Re-delivery duplicates rows and inflates counts (probe P5). | `unique nulls not distinct (…)` (PG15+) or `coalesce(field,'')`. |
| G-P2-7 | `src/service/history.ts:186-188`, `src/service/record.ts:185-189` | Alert `active_from`/`active_to` is ignored. Expired critical alerts surface on arrival screens and as issues (probe P6). | Filter by the property business date (`platform.getBusinessDate`). |
| G-P2-8 | `src/service/internal.ts:413-418` | **Any** write with `propertyId` (e.g. adding a preference) by a readShared+update holder permanently links the profile to that property. It becomes `full` for all readers there and survives sharing being switched off. | Link only via resolve, stay, or an explicit audited "known at this property" action. Or treat `manual` links as shared-only. |
| G-P2-9 | `src/domain/merge.ts:245-256`, `src/service/merge.ts:645-680` | The post-merge owner suggestion relies on `requested_profile_id`, which is set only if the caller still uses the old id, and on contact values. Once consumers re-point (the documented protocol), every post-merge stay is suggested to the survivor. The spec's rule is "stay → the profile whose passport matches". | Carry identifying keys on post-merge records (booking contact, document hash captured at check-in). Score each item against both snapshots with `scoreMatch`. |
| G-P2-10 | `src/service/documents.ts:241-262` | The retention purge ignores **legal hold**. It also uses an unscoped `requirePermission('guests.document.manage')`, so a manager at one property can purge org-wide. | Skip `legal_hold` profiles. Run as a system job. Scope manual invocation. |
| G-P2-11 | `apps/api/src/composition.ts` `guestsCrypto()` | A hard-coded, publicly known key is used whenever `NODE_ENV !== 'production'`, and `apps/api/src/config.ts` defaults to `development`. A mis-set staging, trial or demo deploy would encrypt passports and health data with a public key. The code reads `process.env` directly instead of the app config. There is no key-rotation path even though `key_id` is stored. | Require an explicit dev opt-in (e.g. `PORTICO_ALLOW_DEV_KEYS=1`, refused outside local). Read through the config. Plan keyring decrypt-by-`key_id` and a re-encrypt/re-index job (see FR-3). |
| G-P2-12 | `src/domain/company.ts:26-43`, `src/contracts.ts:228-232`, `migrations/0001_guests.sql:290-291` | Cross-module modelling drift, detailed below this table. | Guests stores a `commissionArrangementRef` (rates) and shows terms read-only. Finance owns the AR link (guests reads AR accounts by `companyId` via a port). Glossary: distinguish *company status* from *credit/AR status*. |
| G-P2-13 | `packages/db/src/idempotency.ts:22-80` (foundation) | Idempotency records are keyed by (tenant, scope, key), not by actor. Any user in the tenant who replays the same key and body receives the stored response, which for guests is a full profile with PII, without authorization. | Fold into FR-1 (see the FR-1 row in the foundation table). |

**G-P2-12 detail: three overlapping models**

- **Commission, three vocabularies:**
  - guests: `percent_of_room|percent_of_total|net_rate|none` + `basisPoints`;
  - rates (`rates/src/contracts.ts:711-717`): `commissionable|net`, decimal `percent`, `amountPerNightMinor`, `base`;
  - reservations TermsSnapshot: `{kind: percent|net_rate}`.
  Spec R07 asks guests for a commission arrangement *reference (rates)*.
- **AR link cardinality:** guests keeps one `ar_account_ref` per company, while finance keys `receivables_accounts` by `(legal_entity_id, company_id)`, i.e. many per company.
- **"On hold", two concepts:** guests' company `on_hold` ("confirm payment arrangements…") duplicates finance's AR `on_hold`.

### P3

| ID | File:line | Problem / fix |
|---|---|---|
| G-P3-1 | `src/domain/merge.ts:221-226` | `followMergeChain` throws a plain `Error`, which becomes a 500 with no recovery text. Use a `DomainError` (`merge_chain_corrupt`). |
| G-P3-2 | `src/domain/documents.ts:287` (`maskDocumentNumber`), `src/domain/consent.ts` (`OPERATIONAL_ACTIVITIES`) | Dead in production code. Use or delete. |
| G-P3-3 | `src/service/companies.ts:104` | `assertParent` loads **every** company of the tenant per write. Use a recursive CTE. |
| G-P3-4 | `src/service/history.ts:119-122` | The spend summary double-counts revenue when one profile holds several roles on the same stay. |
| G-P3-5 | `src/service/consent.ts:68-77` | `legalEntityId` is not validated as belonging to the organization. |
| G-P3-6 | `src/routes.ts:356-363` | `DELETE /guests/documents/:id` requires a JSON body, which some proxies and clients strip. Use `POST …/delete` or a reason header. |
| G-P3-7 | `test/scenario-s15-mistaken-merge.test.ts:327` | The expected retention uses `new Date()` while the code uses `tx.now`, so the test is clock-sensitive around UTC midnight. |
| G-P3-8 | `src/service/record.ts` | No `owner` on profiles or companies. The company account manager is standard (see parity gaps). |
| G-P3-9 | `src/service/companies.ts:164-169` | The audit `after: {...input}` includes free-text `notes` and the billing address, and history is shown to every `company.read` holder. Mask or omit. |
| G-P3-10 | `src/domain/merge.ts:146` | `VIP_ORDER` is a code constant. VIP codes and levels should be configuration data per organization. The ordering rule then breaks for custom codes. |

**Counts:** P0 = 2, P1 = 6, P2 = 13, P3 = 10.

## Checklist summary
1. **Tenant isolation:**
   - Pass: all 19 tables have `tenant_id` and `core.enable_tenant_isolation`; there are no cross-schema FKs; the isolation tests (`test/isolation.test.ts`, HTTP S17) are good.
   - Fail: property-level isolation, see G-P0-2 and G-P1-1/2/3.
2. **Authorization:**
   - Pass: the manifest is complete, sensitive permissions are flagged, and deny-by-default is tested.
   - Gaps: G-P1-1, G-P1-3, G-P2-3 and G-P2-10.
   - The identity role templates (identity-plus) still lack the desk grants (see FR-5).
3. **Money:**
   - Revenue is stored as integer minor units with a safe-integer check, labelled `incomplete`.
   - The only issue is the spend double count (G-P3-4).
4. **Idempotency & concurrency:**
   - Create endpoints use `runIdempotent`; PATCHes use If-Match.
   - Concurrent merges are tested with real parallel transactions.
   - Gaps: G-P2-6 and G-P2-13.
5. **Events & audit:**
   - Domain-map event names are used, payloads are PII-free, and audits store field names only.
   - G-P3-9 is the exception.
6. **Contracts:** G-P1-4.
7. **Data authority:**
   - `assertWritable` is used for identity and contact edits, merges and companies; forward mode is honestly refused; mirrored profiles are protected.
   - There are no external effects, so `assertExternalEffectAllowed` is not applicable.
8. **Errors:** recovery-oriented messages throughout. G-P3-1 is the exception.
9. **Spec coverage:** see the table below.
10. **Scenarios:** see the scenario-claim section below.
11. **Readiness claims:** G-P1-6.
12. **Code quality:** no `any`, no default exports, no `new Date()` in domain code, and no PII in logs from this module. Dead code: G-P3-2.
13. **One-product experience:**
    - `status` families, `allowedActions` with reasons and `previewRequired`, `issues`, `links`, `provenance`, `recordTypes` and the search provider are all present.
    - `owner` is missing.
    - There is no UI, so no `helpKey`s apply.
    - Record history for org-wide records: see FR-6.
14. **Parity:** see the parity section below.
15. **Coherence:** G-P2-12, G-P2-11 and the cross-module notes.

## Spec coverage

| Req | Status |
|---|---|
| R01 Profiles (both scripts, contacts, relationships, important dates, source) | Done. Addresses are free text only (no structured address). |
| R02 Preferences + sensitive special needs | Done (free-text categories; no configurable catalogue). |
| R03 Alerts | Partial. Active period ignored (G-P2-7). |
| R04 Notes immutable | Done (DB trigger). |
| R05 Documents | Done in-property. Export bypass: G-P1-3. KMS: R1. |
| R06 Consent | Done. Evidence is not minimal after erasure (G-P0-1). |
| R07/R08 Companies, hierarchy | Done. Commission and AR modelling drift: G-P2-12. |
| R09 resolveProfile | Done, but the cross-property policy bypass is G-P0-2. |
| R10 Duplicates | Done. Gaps: G-P2-4 and G-P2-5; the nightly scan is not scheduled. |
| R11 Merge | Done. Default rule deviates from "most recently verified" (documented). |
| R12 Unmerge | Done. Weak suggestion (G-P2-9); comms items absent. |
| R13 Resolve merged ids | Done. |
| R14 Stay history | Partial: no event consumption, no finance revenue, no ops/comms. |
| R15 Recognition | Partial: service recovery, balance flags, expired alerts. |
| R16 Sharing | Partial: G-P0-2, G-P1-2, G-P2-8. |
| R17 Export | Done, but property-scope bypass (G-P1-3). Not via the integration framework. |
| R18 Erasure | **Fails I06** (G-P0-1). |
| R19 Retention | Partial: documents only, unscheduled, ignores legal hold. |
| R20 Search | Done except booking code and p95. |
| I01 | Done (tested). |
| I02 | Done (tested). |
| I03 | Holds only with the test's fake consumer (G-P1-4). |
| I04 | Done for tables, audit, events and views. Exports: G-P1-3. |
| I05 | **Violated** (G-P0-2, G-P1-2). |
| I06 | **Violated** (G-P0-1). |
| I07 | Provider exists (`getConsent`); enforcement is in comms. |
| §14 Connected mode | Done (mirror, read-only identity, forward refused, extension data labelled). No duplicate integration exception (needs `integration`). |

## Scenario-claim assessment
- **S15** (`test/scenario-s15-mistaken-merge.test.ts`): **strong test, claim partially true.**
  - What it shows: field-for-field snapshot comparison, child-row restoration, post-merge review, outbox-driven re-point and restore, audit on both profiles with reason and actor, the pair not re-proposed, a second unmerge refused, concurrency, and chains.
  - Limit 1: references are proven only against a fake consumer that implements guests' protocol. The real reservations consumer is incompatible (G-P1-4).
  - Limit 2: finance and comms references and "messages added" are not covered.
  - Limit 3: the suggested-owner rule would not pick the right owner once references are re-pointed (G-P2-9).
- **S04** (`test/profiles.test.ts:176`): guests' share only (roles on stays and companies, child DOB). Adequate for guests. It does not show company-as-payer or any financial effects (finance-owned).
- **S17** (`test/isolation.test.ts`, HTTP test): true for cross-tenant. The spec's "security log for denied attempts" is not done (foundation).
- **E09 / cross-property** (`test/sharing.test.ts`): the tests pass, but the claim is **false in general**. Probes P2 and P4 show B obtaining A's profile and A's stays. P8 shows sensitive data crossing via export.
- **E15:** honestly marked R1.

## Foundation requests: assessment

| FR | Verdict | Notes / proposed fix |
|---|---|---|
| FR-1 Idempotency keeps PII | **Agree; partly done on main** (272cdf3: 30-day expiry + hourly purge). | Still needed: <br>1. Erasure cannot purge within the 30 days. Add `runIdempotent(…, {storeBody:false})`, which stores `{status, resourceRef}` and re-reads with the **caller's** permissions on replay, and use it for every guests route that returns a profile. <br>2. **Scope replay to the actor** (add `actor_key` to the key, or re-authorize on replay). Today any tenant user can replay another's key and body and receive PII (G-P2-13). |
| FR-2 Query strings in logs | **Agree; done on main** (path-only `req` serializer). | Adding `*.number` and `*.detail` to `LOG_REDACT` is cheap defence in depth, so agree. Also make sure validation problem details never echo submitted values. |
| FR-3 KMS FieldCipher + separate blind-index key | **Agree.** | Also: <br>• unify configuration: three env names today (`PORTICO_FIELD_KEY` in identity-plus, `PORTICO_FIELD_ENCRYPTION_KEY` here, `PORTICO_INTEGRATION_SECRET_KEY`) and two copies of the same dev key string; <br>• provide one kernel `fieldCipherFromEnv` with an explicit dev opt-in; <br>• keyring decrypt by `key_id`; <br>• a re-encrypt job and a blind-index re-key job (decrypt → re-HMAC). |
| FR-4 Unpermissioned property directory | **Agree; partly addressed** in identity-plus (`getPropertyFacts`, 99c5d9c: permission-free per-property facts incl. country and legal entity). | Still needed: a permission-free `listPropertyIds(tx)` / `propertyDirectory(tx)` as a documented **trusted provider** call, so the composition stops wrapping user transactions with `systemAuthorizer`. Rebind guests' port to `getPropertyFacts` when identity-plus merges. |
| FR-5 Role templates | **Agree, with changes.** | identity-plus `role-templates.ts`: front_desk and reservations_agent still have only `guests.profile.read/update`. Add `guests.alert.manage` (`guests.company.read` is implied by `profile.read` in code but should be explicit). Add `guests.profile.readShared` only after G-P0-2 is fixed. <br>**Disagree** with `general_manager: 'guests.*'`: that grants `privacy.erase`, `document.read` and `sensitive.read` to every GM. Use an explicit list and a separate DPO template, as FR-5 proposes. <br>`platform.dataAuthority.manage` is now registered in identity-plus's platform manifest. |
| FR-6 Record history permission for org-wide records | **Agree.** | `records-routes.ts` authorizes on the first audit row's property. For guests this gives false 404s at linked properties and true access at the creation property even when visibility has narrowed. Add `RecordTypeDefinition.canRead(tx, id)` (or delegate to `SearchProvider.summarize !== null`). Audit `reason` text is free text and can contain names, which strengthens the need. |
| FR-7 Scheduled jobs | **Agree; framework done on main** (272cdf3 `ScheduledJob`/`runDueJobs`). | Guests must register its jobs at rebase (G-P2-2). The retention purge must respect legal hold (G-P2-10). |

## Cross-module notes for the orchestrator
1. **Reservations ↔ guests (blocking for S15 integration):** see G-P1-4. Decide the canonical `ProfileInput`. Recommendation: guests' shape plus a composition adapter, with reservations passing `propertyId`. Reservations' merge/unmerge consumer must:
   - call `recordReferenceRepoints` in the same transaction;
   - read `referencesToRestore[module]` / `restoredId` / `reassigned`;
   - treat `merge_not_active` as "skip".
   Reservations records stay history only for the primary occupant at check-in and check-out. Bookers and payers never reach guests' roles, which is fine for now, but recognition counts will be partial. Status vocabulary matches (`in_house`, `departed`, `cancelled`, `no_show`).
2. **Finance:** `receivables_accounts` keyed `(legal_entity_id, company_id)` is the AR source of truth. Drop or derive guests' `ar_account_ref`; the company record shows AR read-only through a port. Align company `on_hold` with AR `on_hold`.
3. **Rates / reservations:** three commission vocabularies (G-P2-12). Put one `Commission` type in kernel or rates contracts. Guests should hold a reference.
4. **Shared code:** move the field-cipher bootstrap into kernel (duplicated in identity-plus `fieldCipherFromEnv`, guests `guestsCrypto()`, integration `secretStoreFromEnv`). Name normalization and transliteration and E.164 phone normalization live only in guests today. Comms (wave 2) will need the same phone and email normalization, so export them from a shared package rather than re-implementing.
5. **Domain map:** must record the guests provider additions (`getRecognitionSummary`, `getConsent`, `searchProfiles`, `recordReferenceRepoints`, `upsertMirroredProfile`, `previewMerge`/`previewUnmerge`), the event payloads, and the trusted-provider rule for `recordStayHistory`/`getConsent`.
6. **Rebase needed:** conflict in `composition.ts` (`jobs` vs `services`).

## Competitive parity (no `docs/parity/guests.md` yet): capabilities competitors offer that are absent or under-specified

The parity-ops author should add these rows. Each is marked with my suggested priority.

- **Restricted / "do not rent" (blacklist) flag with reason**, blocking or warning at booking and check-in. OPERA *Restricted* profiles; Mews *Blacklist* classification. Guests has only free-text alerts. **P0.**
- **Configurable catalogues:** preference groups and codes, note types, VIP codes, classifications (OPERA preference groups and VIP codes; Mews classifications such as Media, Staff, Problematic). Today categories are free text and `VIP_ORDER` is hard-coded. **P1.**
- **Memberships:** loyalty, frequent-flyer and partner programme numbers on the profile (OPERA *Memberships*; Mews loyalty code). **P1** (loyalty programmes themselves are LATER).
- **Structured addresses:** type, lines, city, state, postal code, country, primary flag (OPERA address types). Today an address is a single free-text contact value. **P1.**
- **Guest-level invoicing data:** tax id and billing details on an individual for fiscal invoices (Mews; OPERA "Tax ID" on individual profiles). **P1**, interacts with finance.
- **ID capture:** MRZ/passport scan and OCR, kiosk ID capture, visa document type, place and date of issue (Mews kiosk / ID scanning; OPERA ID scan integrations). Doc types lack `visa`. **P1** (needs integration).
- **Central survivorship rules per field and a data-stewardship console:** golden record, configurable "most recently verified / source priority" per field (Shiji Daylight cross-property profiles). The spec default "most recently verified" is not implemented. **P1.**
- **Real-time cross-property duplicate check at entry, respecting sharing:** Shiji. Today this is broken, see G-P0-2. **P0.**
- **Profile purge / anonymization of inactive profiles** after N years without activity, with a report (OPERA profile purge). R19 is partial. **P1.**
- **Company and agent account manager ("owner"), account type** (corporate / wholesaler / tour operator / DMC), **commission payment details for agents, negotiated-rate links on the profile** (OPERA account profiles). **P1.**
- **Salutation / letter greeting, gender, name-title lists** for correspondence (OPERA). **P2.**
- **Profile statistics:** revenue, room nights and stays per year/property, future reservations from the profile (OPERA profile statistics; Mews customer overview). Partial pending reservations and finance. **P1.**
- **External CRM subscription/sync of profile changes** (Shiji / OPERA OXI profile interfaces). Integration-owned. **P2.**

## Top fixes before merge (in order)
1. G-P0-1 erasure completeness, with an all-tables test.
2. G-P0-2 resolution respects the sharing policy and objection, and suggestions are filtered.
3. G-P1-1, G-P1-2 and G-P1-3 property-scope fixes, each with a test.
4. G-P1-4: domain-map update; the orchestrator aligns reservations.
5. G-P2-1 flaky suite and G-P2-2 rebase plus job registration. Then correct the README claims (G-P1-6).
