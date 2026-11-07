# Spec: guests

Status: Draft v1 · 2026-11-07 · Wave 1 · Schema `guests` · Prefix `GUE`

## 1. Purpose

Know **who** people and organizations are — guests, bookers, payers, company contacts, companies and travel
agents — so staff recognize returning guests, honour preferences and alerts, address the right payer, and
never lose history to duplicates. Do it with privacy built in: least-privilege access to sensitive fields,
consent per purpose, reversible merges and erasure that respects legal retention.

## 2. Scope and non-goals

**In scope:** guest profiles, companies and agencies (`kind=agency`), contacts, relationships, preferences,
alerts, notes, consent, identity documents (field-encrypted), stay history projection, duplicate detection,
reversible merge/unmerge, cross-property sharing, privacy requests (access/export, erasure/anonymization),
retention schedules, profile search.

**Non-goals:** receivables balances and credit limits (`finance` — guests shows them read-only); negotiated
rates (`rates`); messages (`comms`); loyalty programs (LATER); marketing campaigns (out of scope — integrate a
CRM via `integration`, e.g. Salesforce).

## 3. Capabilities

### 3.1 Profiles

- **GUE-R01** [MUST] Guest profile: names (given, family, optional middle, title; **native script and Latin
  transliteration** both stored), preferred name, language, nationality, date of birth, contact points (emails,
  phones in E.164, addresses) each with type, verification state and source, VIP level, tags, relationships
  (spouse, child, assistant, travel companion), important dates (anniversary), source records (which channel or
  import created it).
- **GUE-R02** [MUST] **Preferences** are structured (category, value, scope `all properties | property`,
  source, last confirmed) — e.g. bed type, pillow, villa side, dietary. Health-related data (allergies) is a
  **sensitive category**: separate field set, readable with `guests.sensitive.read`, shown operationally only
  as an alert text the guest agreed to share.
- **GUE-R03** [MUST] **Alerts**: short operational messages with severity (`info`, `important`, `critical`),
  audience (departments), active period and visibility (`shared` | `property-private`). Critical alerts
  surface in arrivals, check-in, room move and outlet charge screens.
- **GUE-R04** [MUST] Notes with visibility (`shared` | `property-private` | `department`), author and time;
  never edited in place (edit = new version, history visible).
- **GUE-R05** [MUST] **Identity documents** (passport, national ID): type, number, issuing country, expiry,
  optional image reference (only if property policy enables storage). Fields are envelope-encrypted; reads
  require `guests.document.read` ⚑ and each read is audited; never indexed for search except a keyed hash of
  number+country for duplicate detection; never logged, never sent to AI without explicit field permission.
- **GUE-R06** [MUST] **Consent** per purpose (`marketing_email`, `marketing_sms`, `marketing_whatsapp`,
  `profiling`, `cross_property_sharing` where required) per **legal entity**, state `granted | withdrawn |
  unknown`, source (booking engine checkbox, front desk, import), evidence (text version, timestamp, channel).
  Operational communications (confirmations, pre-arrival logistics) are not consent-gated (lawful basis is the
  contract) — classification per message template in `comms`.

### 3.2 Companies, agencies and contacts

- **GUE-R07** [MUST] Company: legal name, trading name, `kind ∈ {company, agency}`, tax id, billing address,
  contacts (profiles with role), IATA/agency id for agencies, default market segment, commission arrangement
  reference (rates), receivables account link (finance), notes, status (`active | on_hold | inactive`).
- **GUE-R08** [MUST] Companies can be hierarchical (parent company → subsidiaries) for reporting; credit
  responsibility stays per receivables account.

### 3.3 Resolution, duplicates and merging

- **GUE-R09** [MUST] `resolveProfile(input, {matchStrategy})` for bookings, channel ingestion and imports:
  strategies `exact_only` (channels, imports default), `suggest` (staff entry: returns `possibleDuplicates`
  with scores and reasons), `create_new`. Never silently merges. Channel proxy emails (OTA alias addresses) are
  stored as low-confidence contact points and never used as exact match keys.
- **GUE-R10** [MUST] **Duplicate detection** runs on create/update and nightly: exact keys (verified email,
  E.164 phone, document hash) and fuzzy (name similarity across scripts + DOB + nationality). Candidates go to a
  queue with score and reasons; staff `merge` or `dismiss` (dismissal remembered so the pair is not proposed again).
- **GUE-R11** [MUST] **Merge** (`guests.profile.merge` ⚑): survivor and merged profile; field-level choice for
  conflicting scalars (default: most recently verified), union of lists (contacts, preferences, notes, alerts),
  preview of the result and of references that will be re-pointed in other modules (counts per module).
  The merge record stores both full pre-merge snapshots and the field decisions. The merged profile becomes
  status `merged` with `mergedInto = survivorId` (never deleted).
- **GUE-R12** [MUST] **Unmerge** (`guests.profile.unmerge` ⚑) restores the merged profile from its snapshot;
  data added to the survivor *after* the merge is listed for review (stays, communications, notes, contacts)
  with a suggested owner per item (based on the identifiers it carries); staff confirm; references in other
  modules are restored through `guests.profile.unmerged` with the exact reference list. Unmerging is allowed
  when the survivor is not itself merged; otherwise the UI guides unmerging the later merge first.
- **GUE-R13** [MUST] Every profile read for a `merged` id transparently resolves to the survivor (following
  chains) and tells the caller (`resolvedFrom`).

### 3.4 History and recognition

- **GUE-R14** [MUST] Stay history projection fed by `reservations` (`recordStayHistory` and events): stays per
  property with dates, unit type, rate plan, nights, status; revenue totals from `finance.posting.created`
  (by category, in property base currency with currency noted); requests and service recovery items from
  `operations`/`comms`.
- **GUE-R15** [MUST] **Recognition summary** for arrival screens: returning guest (stays count, last stay),
  VIP, critical alerts, key preferences, open service-recovery items, unresolved balance flags (from finance).

### 3.5 Sharing, privacy and retention

- **GUE-R16** [MUST] Cross-property sharing within one organization per Q46 default: shared fields (identity,
  contacts, shared preferences/alerts/notes, stay history) visible to holders of `guests.profile.readShared` at
  other properties; property-private fields never leave their property; sharing switchable per organization,
  reversibly (turning off hides shared data, deletes nothing). Never across organizations.
- **GUE-R17** [MUST] **Access/export request**: produce a machine-readable export of all personal data about a
  profile across modules (via `integration` export framework) with a manifest; logged.
- **GUE-R18** [MUST] **Erasure** = anonymization: profile PII fields replaced by irreversible tokens, contacts
  and documents deleted, notes redacted, consent history kept as minimal evidence; **fiscal documents and
  ledger postings keep the data required by law until their retention ends** (finance immutability), then are
  purged by retention jobs. Blocked by **legal hold**. Status → `anonymized`.
- **GUE-R19** [MUST] Retention schedules per data category per property (Q44 defaults) executed by a daily job
  with a report of what was anonymized/deleted.

### 3.6 Search

- **GUE-R20** [MUST] Profile search by name (any script, transliteration-aware, typo-tolerant), email, phone
  (any format), company, booking confirmation code (via reservations index) and document hash (exact, with
  permission), returning only profiles the user may see; p95 < 300 ms at 1 M profiles (target).

## 4. Entities and states

`guest_profile(id, status, names jsonb, language, nationality, dob, vip_level, tags[], sharing_scope,
merged_into?, version)` · `contact_point(profile_id, kind, value, normalized, verified, source, low_confidence)` ·
`preference(profile_id, category, value, scope_property_id?, source, confirmed_at)` · `alert(profile_id,
severity, text, audience[], visibility, property_id?, active_from, active_to?)` · `note(...)` ·
`identity_document(profile_id, type, enc_payload, number_hash, expiry, image_ref?)` · `consent(profile_id,
legal_entity_id, purpose, state, evidence jsonb, changed_at)` · `company(id, kind, legal_name, tax_id, parent_id?,
ar_account_ref?, status, version)` · `company_contact(company_id, profile_id, role)` · `stay_history(profile_id,
stay_ref, property_id, arrival, departure, status, revenue jsonb)` · `duplicate_candidate(a_id, b_id, score,
reasons, status)` · `merge_record(id, survivor_id, merged_id, snapshots jsonb, decisions jsonb, reference_map jsonb,
status, reason, merged_by, reversed_by?)` · `privacy_request(id, kind, profile_id, status, legal_hold?)`.

**Profile status:** `active → merged` (merge) · `merged → active` (unmerge) · `active → anonymized` (erasure;
terminal). A `merged` profile cannot be anonymized directly (anonymize the survivor or unmerge first).

**Merge record:** `active → reversed` (unmerge; terminal).

**Duplicate candidate:** `open → merged | dismissed`; `dismissed` pairs are not re-proposed unless a new exact
key matches.

**Privacy request:** `received → in_progress → completed | rejected (with reason) | on_hold (legal hold)`.

## 5. Invariants

- **GUE-I01** A `merged` profile has exactly one `merged_into`; following `merged_into` terminates at an
  `active` profile (no cycles).
- **GUE-I02** Merge followed by unmerge with no intervening changes restores both profiles field-for-field and
  every external reference to its pre-merge target (S15 test compares snapshots).
- **GUE-I03** Every reference re-pointed due to a merge is listed in that merge's `reference_map`.
- **GUE-I04** Identity document numbers and images never appear in logs, search indexes, analytics facts,
  exports without the document permission, or AI context.
- **GUE-I05** A user without `guests.profile.readShared` at property P sees, for a profile with no stay at P,
  nothing (404); with it, only shared fields.
- **GUE-I06** An anonymized profile contains no personal data outside fiscal records under retention.
- **GUE-I07** Marketing messages are sent only when consent for that purpose and legal entity is `granted`
  (enforced in comms by reading consent here).

## 6. Cross-module interactions

Provider contract (domain map): `resolveProfile`, `getProfile`, `getCompany`, `recordStayHistory`,
`mergeProfiles`, `unmergeProfiles`. Consumers: `reservations` (booker/occupants/payer/company/agency),
`finance` (payer identity, company for AR), `comms` (contacts, consent, language), `distribution` (channel
guest data via reservations), `resort`, `analytics` (pseudonymous ids only), `ai` (permission-filtered reads).
Depends on `platform`, `identity`. Consumes `finance` events for revenue history.

### Proposed contract changes

1. `getProfile(tx, profileId, opts?: { propertyId; fields?: 'operational'|'full' })` returns
   `{ profile, resolvedFrom? }` honouring sharing and field permissions. Additive.
2. New `getRecognitionSummary(tx, { profileId, propertyId })` (GUE-R15).
3. New `getConsent(tx, { profileId, legalEntityId, purpose })` for comms.
4. New `searchProfiles(tx, { query, propertyId, limit })`.
5. `unmergeProfiles(tx, { mergeId, reason, postMergeAssignments })` — assignments from the review step.

## 7. Events

Emitted: `guests.profile.merged {mergeId, survivorId, mergedId}` · `guests.profile.unmerged {mergeId,
restoredId, survivorId, referencesToRestore}` · proposed: `guests.profile.created`, `guests.profile.updated
{changedFields}` (no PII values in payload), `guests.profile.anonymized`, `guests.consent.changed`,
`guests.alert.raised`, `guests.company.statusChanged`.
Consumed: `reservations.stay.checkedIn|checkedOut|noShow|cancelled` (history), `finance.posting.created`
(revenue history), `operations.serviceRequest.completed` (proposed; service history).

**Re-pointing rule for consumers:** modules holding profile ids handle `merged` by re-pointing references
(idempotent by `mergeId`) and record what they re-pointed; on `unmerged` they restore exactly the references in
`referencesToRestore` for their module.

## 8. Permissions

`guests.profile.read` · `guests.profile.readShared` · `guests.profile.manage` · `guests.profile.merge` ⚑ ·
`guests.profile.unmerge` ⚑ · `guests.sensitive.read` ⚑ · `guests.document.read` ⚑ · `guests.document.manage` ⚑ ·
`guests.privacy.export` ⚑ · `guests.privacy.erase` ⚑ · `guests.company.read` · `guests.company.manage` ·
`guests.alert.manage` · `guests.note.readPrivate` (department/property-private notes beyond own department).

## 9. UX surfaces

- **Profile page**: header (name in both scripts, VIP, critical alerts, consent chips, merged-from indicator),
  tabs: Overview (recognition summary, preferences, upcoming stays), History (timeline of stays, requests,
  communications, service recovery, spend), Companies & relationships, Documents (permission-gated), Privacy.
- **Duplicate queue**: side-by-side comparison with matching fields highlighted and score reasons; merge wizard
  with field choices and reference-impact preview; dismiss with reason.
- **Unmerge review**: list of post-merge items with suggested owner and checkboxes; preview before commit.
- **Company page**: contacts, negotiated plans (from rates), AR status (from finance, read-only), bookings.

## 10. Proof scenarios and evidence

| ID | Guests must demonstrate |
|---|---|
| S04 | Booker (company assistant), occupants (family members incl. children ages), payer (company for accommodation; each adult for incidentals) are distinct profiles/companies linked to the booking. |
| S15 | Wrong merge of two "Ahmed Ali" profiles → unmerge restores both, references in reservations/finance/comms restored, post-merge stay assigned correctly after review; full audit trail. |
| S17 / E09 | Cross-organization: 404. Cross-property inside organization: shared fields only with `readShared`; private notes never. |
| E15 | Staff error: wrongly edited preference or alert is visible in history and restorable. |

## 11. Maldives specifics

Source markets include China, Russia, India and Europe: names in Chinese and Cyrillic scripts must be stored
natively with Latin transliteration for passports and transfer manifests. Many resort bookings arrive from
tour operators/DMCs with minimal guest data (names only) — profiles must tolerate sparse data and be enriched
at check-in. Honeymoon and anniversary dates are commercially important (important dates). Guesthouses host
local and expatriate resident guests identified by national ID cards. Passport data needs for
registration/reporting are pending Q43.

## 12. Competitive inspirations

- Single global profile across a portfolio — Shiji Daylight; unified profile search across systems —
  Agilysys (research 01 §5.2, §6.2). Improved: sharing is reversible, field-scoped and permissioned.
- No profile merge in Stayntouch is a cited complaint (research 02 §4.4, §4.6) — merge and **unmerge** are MUST.
- OPERA's irreversible profile-sharing switch is an anti-pattern (research 01 §2.4).
- GDPR erasure vs fiscal retention via anonymization and retention schedules (research 04 §C1).

## 13. Open questions

Q43 (registration/document storage), Q44 (retention), Q46 (sharing default).
