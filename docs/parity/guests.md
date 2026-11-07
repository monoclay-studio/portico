# Parity matrix and edge cases: guests

Module: `guests` (guest profiles, companies and agencies, preferences, alerts, consent, identity documents,
duplicates, reversible merge, cross-property sharing, privacy). Spec: `docs/specs/guests.md` (Draft v1); related
specs written since: `guest-experience.md` (portal data capture), `guest-services.md` (guest-relations lists),
`crm-marketing.md` (external programmes). Researched 2026-11-07; **statuses updated 2026-11-07 against
`modules/guests` on `main`** (README: spec MUSTs done except R14 feeds, R15 recovery flags, R19 beyond documents,
R20 booking-code binding; steward review fixes in; no known failing tests).

**Test column:** paths are relative to `modules/guests/` unless they start with `apps/`, `modules/` or `packages/`.
A row is `tested` only when a test on `main` **asserts** the row (parity playbook v2, PR2-1): the Test cell quotes
each asserting line as `file:line` with what it proves. `building` = part of the row is asserted and the "partial:"
note says what is missing (also used where the proof runs only against a fake provider, pattern AP-51); `built` =
implemented without an asserting test. Everything is at most readiness R3 (env/dev keys, no
KMS, no external system).

**Baseline:** OPERA Cloud 26.3 Client Relations (Profiles) and Client Relations Administration. **Modern additions:**
Shiji Daylight (single global profile with guest-controlled sharing), Mews (guest portal data capture), Stayntouch
(ID collection). Portico terms in the Capability column; OPERA *profile* = Portico *guest profile*, OPERA *sales
account / travel agent / source profile* = Portico *company* (`kind=company|agency`), OPERA *anonymization* = Portico
*erasure*. Loyalty programs and marketing live in `crm.md`. **Evidence:** a source marked "search-located" under
*Sources* was found by web search but its host blocks direct fetches here — facts resting only on it are unverified.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GUE-001 | Names in native script plus Latin transliteration, title, preferred name, language, nationality | OPERA [alternate (name) language][op-altname] · verified 2026-11-07 | P0 | tested | guests.md GUE-R01 | test/profiles.test.ts:34 (Cyrillic native + ICAO Latin); test/profiles.test.ts:59 (Han native + passport name); src/domain/names.test.ts:125 (title and preferred name) |
| PAR-GUE-002 | Contact points (emails, E.164 phones, addresses) each with type, verification state and source | OPERA [profile communication][op-profcomm] · verified 2026-11-07 | P0 | tested | guests.md GUE-R01 | src/domain/contact.test.ts:43 (E.164 normalization); src/domain/contact.test.ts:18 (proxy email low confidence); test/duplicates.test.ts:73 (unverified email never exact) |
| PAR-GUE-003 | Country-specific address formats (atoll and island for the Maldives) | OPERA [managing profiles][op-profmanage] · verified 2026-11-07 | P1 | specified | guests.md GUE-R01; platform.md PLT-R11 | — |
| PAR-GUE-004 | Address, email and phone validation services at entry | OPERA [outbound validation services][op-outbound] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-005 | VIP levels configurable with meaning and operational effect (amenity, inspection) | OPERA [VIP levels][op-vip] · verified 2026-11-07 | P0 | building | guests.md GUE-R01 | src/domain/merge.test.ts (VIP never downgraded); test/profiles.test.ts (VIP on recognition) — partial: VIP levels are a fixed code list, not configurable with operational effect |
| PAR-GUE-006 | Tags/keywords for quick classification and search | OPERA [keywords][op-keywords] · verified 2026-11-07 | P1 | built | guests.md GUE-R01 | — tags stored on the profile (GUE-R01); no test asserts tag search or classification |
| PAR-GUE-007 | Relationships between profiles (spouse, child, assistant, travel companion, employee of) | OPERA [profile relationships][op-profrel] · verified 2026-11-07 | P1 | built | guests.md GUE-R01 | — relationships stored (GUE-R01, links in the record contract); no dedicated test |
| PAR-GUE-008 | Important dates (birthday, anniversary, honeymoon) | OPERA [personal details][op-profid] · verified 2026-11-07 | P1 | built | guests.md GUE-R01 | — important dates are stored and passed to recognition (test/profiles.test.ts input) but no assertion reads them back |
| PAR-GUE-009 | Profile photo (consented) for recognition at outlets and arrival | OPERA [profile image][op-profimage] · verified 2026-11-07 | P2 | missing | resort.md RST-R02 (consumer only) | — |
| PAR-GUE-010 | Attachments on profiles and companies (contracts, letters, scanned forms) | OPERA [profile attachments][op-profattach] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-011 | Organization-defined custom fields (typed, validated, permissioned) | OPERA [flexible dynamic fields][op-profudf] · [UDF groups][op-udf] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-012 | Structured preferences with category, scope (all properties / one property), source, last confirmed | OPERA [profile preferences][op-profprefs] · [preference groups][op-prefgroups] · verified 2026-11-07 | P0 | tested | guests.md GUE-R02 | test/profiles.test.ts:150 (versioned preference update); test/sharing.test.ts:406 (property-scoped preference stays at its property) |
| PAR-GUE-013 | Health data (allergies) as a sensitive category with its own permission; shown operationally only as consented alert text | assumption (GDPR special category) | P0 | tested | guests.md GUE-R02 | test/documents.test.ts:264 (detail hidden, alert text shown); test/documents.test.ts:265 (not in plaintext anywhere); test/documents.test.ts:280 (every sensitive read audited) |
| PAR-GUE-014 | Alerts with severity, audience departments, active period; critical alerts on arrival, check-in, room move and outlet screens | assumption | P0 | building | guests.md GUE-R03 | test/profiles.test.ts "alert active periods (R03)", critical alert event; recognition summary — partial: room-move and outlet screens are other modules' (not built) |
| PAR-GUE-015 | Notes with visibility (shared, property-private, department), never edited in place | OPERA [profile notes][op-profnotes] · verified 2026-11-07 | P0 | tested | guests.md GUE-R04 | test/profiles.test.ts:122 (revisions supersede); test/profiles.test.ts:127 (superseded note cannot be revised); test/sharing.test.ts:278 (department note hidden from colleague) |
| PAR-GUE-016 | Identity documents field-encrypted, reads permissioned and audited, never indexed | OPERA [identification details][op-profid] · verified 2026-11-07 | P0 | tested | guests.md GUE-R05, GUE-I04 | test/documents.test.ts:75 (never in plaintext); test/documents.test.ts:114 (reveal audited with reason); test/documents.test.ts:153 (search audited) |
| PAR-GUE-017 | ID/passport scanning (desktop scanner, phone camera) populating profile and document fields | OPERA [desktop ID scanner][op-idscan] · [mobile ID scanner][op-idscanmob] · Stayntouch [ID collection][snt-idcollect] · verified 2026-11-07 (Stayntouch search-located, unverified) | P1 | specified | guest-experience.md GXP-R12 (phone MRZ capture), GXP-R30 (kiosk scanner) | — |
| PAR-GUE-018 | Consent per purpose per legal entity with evidence (text version, time, channel) | OPERA [correspondence and privacy options][op-profpriv] · verified 2026-11-07 | P0 | tested | guests.md GUE-R06 | test/privacy.test.ts:122 (evidence history); test/privacy.test.ts:90 (per purpose); src/domain/rules.test.ts:33 (grant needs evidence) |
| PAR-GUE-019 | Channel subscriptions and preferred contact channel (email, SMS, WhatsApp) | OPERA [profile subscription][op-subscription] · verified 2026-11-07 | P1 | specified | guests.md GUE-R06 | — |
| PAR-GUE-020 | Protected profiles (celebrities, executives): restricted view/edit list | OPERA [profile protection][op-protect] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-021 | Incognito/alias name used on lists, keys and messages while the real identity is protected | OPERA [alias/incognito field][op-anon] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-022 | Name validation rules (reject "Guest", "TBA", all-caps, digits) | OPERA [profile name validations][op-namevalid] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-023 | Recently viewed profiles list | OPERA [recently viewed profiles][op-recent] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-024 | Stored payment cards (tokens only) visible on the profile | OPERA [credit card wallet][op-wallet] · verified 2026-11-07 | P1 | specified | payments.md PAY-R05 | — |
| PAR-GUE-025 | Company/agency default billing ("company pays room and tax") applied to new bookings | OPERA [default routing instructions][op-profrouting] · verified 2026-11-07 | P1 | specified | finance.md FIN-R17 [SHOULD] | — |
| PAR-GUE-026 | Negotiated/contracted rates attached to companies and agencies | OPERA [profile negotiated rates][op-negrates] · verified 2026-11-07 | P0 | specified | rates.md RAT-R06 | — |
| PAR-GUE-027 | External loyalty/frequent-flyer memberships stored on the profile | OPERA [external loyalty enrolment][op-extloyalty] · verified 2026-11-07 | P1 | specified | crm-marketing.md CRM-R18 (external programme numbers) | — |
| PAR-GUE-028 | Company: legal and trading name, tax id, billing address, contacts, status | OPERA [sales account profiles][op-salesacct] · verified 2026-11-07 | P0 | tested | guests.md GUE-R07 | test/profiles.test.ts:439 (company identity); test/profiles.test.ts:487 (status and AR reference) |
| PAR-GUE-029 | Travel agent / tour operator / DMC with IATA or agency id and commission arrangement | OPERA [commission details][op-commission] · verified 2026-11-07 | P0 | tested | guests.md GUE-R07 | test/profiles.test.ts:460 (commission validated); src/domain/rules.test.ts:42 (IATA check digit) |
| PAR-GUE-030 | Company sub-types (corporate, DMC, tour operator, wholesaler, government, OTA-as-merchant) | OPERA [company types][op-companytypes] · verified 2026-11-07 | P1 | missing | guests.md GUE-R07 (only company/agency) | — |
| PAR-GUE-031 | Company hierarchy (parent → subsidiaries) for reporting | assumption | P1 | tested | guests.md GUE-R08 | test/profiles.test.ts:475 (hierarchy, cycles refused) |
| PAR-GUE-032 | Receivables account and credit status shown read-only on the company | OPERA [profile AR accounts][op-profar] · verified 2026-11-07 | P0 | building | guests.md GUE-R07; finance.md | test/profiles.test.ts "AR linkage is a reference" — partial: credit status is not read from finance |
| PAR-GUE-033 | Contacts at companies with role; a contact can also be a guest | OPERA [merge contacts with guests][op-merge] · verified 2026-11-07 | P1 | tested | guests.md GUE-R07 | test/profiles.test.ts:269 (contact with role, also a guest) |
| PAR-GUE-034 | Sales information on accounts (owner, industry, potential, territory) | OPERA [sales account profiles][op-salesacct] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-035 | Production statistics per company/agency (room nights, revenue, cancellations) | OPERA [profile production statistics][op-prodstat] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-036 | Profile resolution for bookings, channels and imports; never silently merges; OTA alias emails low-confidence | OPERA [profile match list][op-matchlist] · verified 2026-11-07 | P0 | tested | guests.md GUE-R09 | test/duplicates.test.ts:337 (exact_only reuse, no merge); test/duplicates.test.ts:106 (proxy email ignored) |
| PAR-GUE-037 | Possible-duplicate suggestions while staff type a new profile | OPERA [profile match list][op-matchlist] · verified 2026-11-07 | P0 | building | guests.md GUE-R09 | test/duplicates.test.ts (suggestions returned on create) — partial: no type-ahead suggestion flow |
| PAR-GUE-038 | Duplicate detection on save and nightly; review queue with score and reasons; dismissals remembered | OPERA [smart profiles][op-smart] · [match and merge rules][op-smartrules] · verified 2026-11-07 | P0 | tested | guests.md GUE-R10 | test/duplicates.test.ts:48 (score and reasons on save); test/duplicates.test.ts:280 (dismissal remembered); test/duplicates.test.ts:315 (nightly scan) |
| PAR-GUE-039 | Configurable match rules (keys, weights, thresholds) per organization | OPERA [profile merge rules][op-mergerules] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-040 | Automatic merge of exact matches | OPERA [auto merge rules][op-mergerules] · verified 2026-11-07 | P2 | different | guests.md GUE-R09 (never silent; staff merge with reversible unmerge) | — |
| PAR-GUE-041 | Merge with field-level choices, result preview and per-module reference preview | OPERA [merging profiles][op-merge] · verified 2026-11-07 | P0 | tested | guests.md GUE-R11 | test/scenario-s15-mistaken-merge.test.ts:463 (reference counts per module); test/scenario-s15-mistaken-merge.test.ts:467 (field choices in preview) |
| PAR-GUE-042 | Merge blocking conditions explained (open receivables, unpaid commissions, different kinds, anonymized) | OPERA [merge conditions][op-merge] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-043 | Unmerge that restores both profiles and every re-pointed reference | assumption (not offered by OPERA; Stayntouch lacks merge — research R02 §4.4) | P0 | building | guests.md GUE-R12, GUE-I02 | test/scenario-s15-mistaken-merge.test.ts:330 (both profiles restored); test/scenario-s15-mistaken-merge.test.ts:352 (reference restored) — partial: references restored only with a fake reservations consumer; reservations' real consumer does not follow the protocol yet (README, AP-51) |
| PAR-GUE-044 | Reads of a merged id resolve to the survivor and say so | assumption | P0 | tested | guests.md GUE-R13 | test/scenario-s15-mistaken-merge.test.ts:254 (merged id resolves to survivor); test/scenario-s15-mistaken-merge.test.ts:438 (chains) |
| PAR-GUE-045 | Batch update of a field across selected profiles (VIP level, market segment) | OPERA [batch profile update][op-batchupd] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-046 | Past and future stays per profile across properties | OPERA [future and past stays][op-profstays] · verified 2026-11-07 | P0 | building | guests.md GUE-R14 | test/profiles.test.ts (S04 stay history roles) — partial: reservations calls `recordStayHistory` directly for the primary occupant; no event feed |
| PAR-GUE-047 | Stay and revenue statistics per profile (nights, revenue by category, currency noted) | OPERA [stay and revenue statistics][op-profstats] · verified 2026-11-07 | P0 | building | guests.md GUE-R14 | test/profiles.test.ts (spend counted once per stay, labelled incomplete) — partial: no finance revenue feed |
| PAR-GUE-048 | Recognition summary for arrival screens (returning, VIP, alerts, key preferences, open recovery items) | assumption | P0 | building | guests.md GUE-R15 | test/profiles.test.ts "recognition summary for the arrivals screen" — partial: no service-recovery items or balance flags |
| PAR-GUE-049 | Accompanying guests and children (with ages) linked to the stay as occupants | OPERA [accompanying guests][op-accomp] · verified 2026-11-07 | P0 | specified | reservations.md RES-R02 | — |
| PAR-GUE-050 | Service requests and complaints history on the profile | OPERA [profile service requests][op-profsvc] · verified 2026-11-07 | P1 | specified | guests.md GUE-R14 | — |
| PAR-GUE-051 | Conversation history on the profile timeline | assumption | P1 | specified | guests.md §9 | — |
| PAR-GUE-052 | One profile across all properties of an organization | Shiji [single guest profile][shiji-sgp] · search-located 2026-11-07, unverified | P0 | tested | guests.md GUE-R16 | test/sharing.test.ts:115 (shared at sister property) |
| PAR-GUE-053 | Guest-controlled opt-in/out of cross-property sharing | Shiji [opt in or out of sharing][shiji-sgp] · search-located 2026-11-07, unverified | P1 | tested | guests.md GUE-R06 (`cross_property_sharing`) | test/sharing.test.ts:212 (objection stops sharing) |
| PAR-GUE-054 | Property-private fields never leave their property; sharing switch reversible | assumption (OPERA switch irreversible — research R01 §2.4) | P0 | tested | guests.md GUE-R16 | test/sharing.test.ts:120 (private data never crosses); test/sharing.test.ts:156 (sharing off deletes nothing) |
| PAR-GUE-055 | Data access/export request producing a machine-readable export across modules | OPERA [privacy customization][op-privcfg] · verified 2026-11-07 | P0 | tested | guests.md GUE-R17 | test/privacy.test.ts:233 (manifest of withheld data); test/privacy.test.ts:281 (export request completed) |
| PAR-GUE-056 | Erasure by irreversible anonymization while fiscal records keep legally required data | OPERA [profile anonymization][op-anon] · verified 2026-11-07 | P0 | tested | guests.md GUE-R18 | test/privacy.test.ts:460 (no PII left in any table); test/privacy.test.ts:464 (financial reference kept) |
| PAR-GUE-057 | Anonymization pre-checks (open folios, future stays, receivables, payee on billing rules) listed all at once | OPERA [anonymization conditions][op-anon] · verified 2026-11-07 | P1 | missing | guests.md GUE-R18 (legal hold only) | — |
| PAR-GUE-058 | Retention schedules and automatic purge of inactive profiles with a report | OPERA [profile purge][op-purge] · verified 2026-11-07 | P0 | building | guests.md GUE-R19 | test/documents.test.ts (retention purge job, legal hold, audit per document) — partial: identity documents only; no schedules for inactive profiles |
| PAR-GUE-059 | Country privacy configuration (mandatory fields, consent purposes, retention defaults) | OPERA [privacy customization][op-privcfg] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-060 | Profile data residency (region where personal data is stored) | OPERA [profile residency][op-outbound] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-061 | Profile search by name in any script, email, phone in any format, company, confirmation code, document hash | assumption | P0 | building | guests.md GUE-R20 | test/profiles.test.ts (typo-tolerant, phone formats, booking-code via port); test/documents.test.ts (last 4) — partial: booking-code port unbound in apps/api |
| PAR-GUE-062 | Permissioned profile list export (CSV) with audit | OPERA [exports][op-exports] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-063 | Profile lookup in an external CRM/PMS while creating a booking | OPERA [profile lookup with integrated solutions][op-proflookup] · verified 2026-11-07 | P1 | specified | guests.md §14 | — |
| PAR-GUE-064 | Connected mode: mirrored profiles plus Portico-only extension fields labelled as such | assumption | P0 | tested | guests.md §14 | test/profiles.test.ts:380 (mirrored with provenance); test/profiles.test.ts:397 (Portico-only extension kept) |
| PAR-GUE-065 | Profile events (created, updated, merged) for partners without personal data in payload | OPERA [business events — profile][op-busevents] · verified 2026-11-07 | P1 | building | guests.md §7 | test/profiles.test.ts (events carry changed field names, never values) — partial: guests events are not in the public webhook catalogue |
| PAR-GUE-066 | Import of profiles and relationships from the previous system | OPERA [data import: profiles and relationships][op-dataimport] · verified 2026-11-07 | P0 | specified | integration.md INT-R05, INT-R30 | — |
| PAR-GUE-067 | Unit-owner profiles and owner referrals | OPERA [ownership records][op-ownership] · verified 2026-11-07 | P2 | specified | platform.md PLT-R17 | — |
| PAR-GUE-068 | Guest self-service profile and preference editing (portal) with provenance | Mews [guest portal][mews-portal] · verified 2026-11-07 | P1 | specified | guest-experience.md GXP-R03, GXP-R09 | — |
| PAR-GUE-069 | Guest-submitted data (online check-in) staged and merged into the profile with source and review on conflict | Mews [online check-in journey][mews-oci] · verified 2026-11-07 | P1 | specified | guest-experience.md GXP-R12, GXP-R14 (submission reviewed by the desk) | — |
| PAR-GUE-070 | Guest-relations lists: in-house VIPs, birthdays and anniversaries this week, returning arrivals | assumption | P1 | specified | guest-services.md GSV-R04 (VIP arrivals, celebrations lists) | — |
| PAR-GUE-071 | Guest-nights by nationality and residence for authority statistics | assumption (Maldives tourism statistics) | P0 | specified | analytics.md ANL-R02 | — |
| PAR-GUE-072 | Granular permissions (merge, unmerge, sensitive, documents, privacy export/erase) | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P0 | tested | guests.md §8 | test/isolation.test.ts:170 (no guests permission → 403); test/scenario-s15-mistaken-merge.test.ts:541 (merge needs the sensitive permission); test/privacy.test.ts:593 (erasure needs the sensitive permission) |
| PAR-GUE-073 | Pseudonymous ids only in analytics facts | assumption | P1 | specified | guests.md §6 | — |
| PAR-GUE-074 | Sparse profiles from tour operators (names only), enriched at check-in | assumption (Maldives DMC bookings) | P0 | building | guests.md §11 | test/duplicates.test.ts:368 (names-only profile accepted) — partial: enrichment at check-in not asserted |
| PAR-GUE-075 | Versioned company names and tax ids (past invoices keep the old values) | assumption | P1 | missing | — | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-GUE-001 | Two different "Ahmed Ali" profiles merged by mistake | Unmerge restores both field-for-field; references in reservations, finance and comms restored from the reference map; post-merge stay assigned after review; audit shows both events (S15) | P0 | building | test/scenario-s15-mistaken-merge.test.ts:329 (profiles restored field for field); test/scenario-s15-mistaken-merge.test.ts:372 (audit shows both) — partial: references restored only with a fake reservations consumer (AP-51) |
| EC-GUE-002 | A was merged into B, later B into C; staff try to unmerge A | Refused with guidance: unmerge B from C first; then A from B (GUE-R12) | P1 | tested | test/scenario-s15-mistaken-merge.test.ts:440 (unmerge refused while survivor is merged); test/scenario-s15-mistaken-merge.test.ts:441 (guidance names the later merge) |
| EC-GUE-003 | After a merge, a new stay and a note were added to the survivor; then the merge is reversed | Post-merge items listed with a suggested owner each (by identifiers carried); staff confirm; nothing reassigned silently | P0 | tested | test/scenario-s15-mistaken-merge.test.ts:306 (post-merge stay suggested owner); test/scenario-s15-mistaken-merge.test.ts:308 (post-merge note listed) |
| EC-GUE-004 | Two staff merge A+B and B+C at the same moment | One succeeds; the other gets 409 with the current state; chains never form cycles (GUE-I01) | P0 | tested | test/scenario-s15-mistaken-merge.test.ts:523 (concurrent merges: one wins); test/scenario-s15-mistaken-merge.test.ts:530 (one active merge) |
| EC-GUE-005 | Merging a profile that has an open receivables balance or unpaid commissions | Merge refused or AR re-pointing previewed by finance; the reason names the open items; never strands a balance | P1 | missing | — |
| EC-GUE-006 | Merged profiles hold different consent states for the same purpose and legal entity | Survivor keeps the most restrictive current state (withdrawn wins) with both evidence histories; marketing stops until fresh consent | P0 | building | src/domain/merge.test.ts "the most recent statement wins" — implementation keeps the most recent statement, this row expects withdrawn to win (decision in gaps-ops.md) |
| EC-GUE-007 | Two different guests share an OTA alias email from the same booking channel | Never matched or merged on that address (low-confidence contact point) | P0 | tested | test/duplicates.test.ts:106 (proxy email never matched) |
| EC-GUE-008 | Same passport number and country on two profiles | Exact-key duplicate candidate with high score; not auto-merged | P1 | tested | test/duplicates.test.ts:133 (same passport → candidate); test/duplicates.test.ts:134 (high score) |
| EC-GUE-009 | Twins with the same name, birth date and address | Proposed as duplicates; staff dismiss with reason; pair not proposed again unless a new exact key matches | P1 | tested | test/duplicates.test.ts:280 (dismissed pair not re-proposed); test/duplicates.test.ts:289 (re-opened only on a new exact key) |
| EC-GUE-010 | Channel delivers a Chinese guest's name in Latin only; passport scan later adds native script | Native script added as the primary native name with source; duplicate matching works across scripts | P1 | building | test/duplicates.test.ts:219 (Chinese native match across romanizations) — partial: adding the native script later from a passport scan is not asserted |
| EC-GUE-011 | Transliteration variants (Aleksandr / Alexander, Mohamed / Muhammad) | Fuzzy match proposes candidates with reasons; never merges automatically | P1 | tested | test/duplicates.test.ts:186 (typo variant proposed); test/duplicates.test.ts:198 (Cyrillic ↔ ICAO) |
| EC-GUE-012 | Tour operator sends names only, no email or phone | Profile created with `exact_only` matching (no fuzzy auto-link); enriched at check-in; returning-guest link suggested after enrichment | P0 | building | test/duplicates.test.ts:368 (names-only accepted) — partial: returning-guest link after enrichment not asserted |
| EC-GUE-013 | Erasure requested by a guest with a future reservation | Refused with reason (future stay) and options: cancel first or schedule erasure after departure; request status `on_hold` | P1 | missing | — |
| EC-GUE-014 | Erasure requested while fiscal invoices are under retention | Profile anonymized; fiscal documents keep legally required data until retention ends, then purged by the retention job | P0 | tested | test/privacy.test.ts:489 (anonymized); test/privacy.test.ts:464 (financial reference kept) |
| EC-GUE-015 | Erasure of a profile that was booker for other people's stays | Booker reference anonymized; occupants' profiles and stays untouched | P1 | missing | — |
| EC-GUE-016 | An anonymized guest returns and books again | New profile; no attempt to re-link the anonymized history | P1 | missing | — |
| EC-GUE-017 | Access/export request while one module is unavailable | Export marked `incomplete` with the missing module listed; never delivered as complete; retried | P1 | building | test/privacy.test.ts (manifest `complete`/`withheld`) — partial: a module failing during export not tested |
| EC-GUE-018 | Staff at property P2 without shared-read permission searches a guest who stayed only at P1 | No result and 404 on direct id (GUE-I05) | P0 | tested | test/sharing.test.ts:94 (404); test/sharing.test.ts:98 (search empty) |
| EC-GUE-019 | Organization switches cross-property sharing off, then on again | Off hides shared data at other properties, deletes nothing; on restores it exactly | P0 | tested | test/sharing.test.ts:149 (off hides); test/sharing.test.ts:157 (nothing deleted) |
| EC-GUE-020 | A property-private note on a shared profile, viewed from a sister property | Never shown, not even as a count | P0 | tested | test/sharing.test.ts:117 (only shared notes at sister property); src/domain/visibility.test.ts:53 (property-private items never leave) |
| EC-GUE-021 | Waiter posting a charge for a guest with a nut allergy | Outlet screen shows the consented alert text only; the health record stays hidden without `guests.sensitive.read` | P0 | tested | test/documents.test.ts:260 (agreed alert text); test/documents.test.ts:264 (detail hidden) — outlet screens are fnb-pos/resort |
| EC-GUE-022 | Consent withdrawn while a campaign is queued | Send-time check blocks the message; run history shows "skipped — consent withdrawn" (GUE-I07) | P0 | specified | — |
| EC-GUE-023 | Marketing consent given to legal entity A; guest later stays at sister property owned by legal entity B | No marketing from B until B obtains consent | P0 | building | test/privacy.test.ts (consent per legal entity); src/domain/rules.test.ts — partial: send-time enforcement is comms (not built) |
| EC-GUE-024 | Child profile (minor) | No marketing consent purposes offered; guardian relationship recorded; age-at-arrival computed per stay | P1 | missing | — |
| EC-GUE-025 | Birth date known without year, or 29 February | Partial date stored; age-based rules treat unknown year as unknown (not 0); leap-day birthdays shown on 28 Feb in non-leap years by policy | P2 | missing | — |
| EC-GUE-026 | Desk edits a profile while the guest submits online check-in for the same profile | Version conflict detected; guest-submitted values staged with source "guest" and shown to staff where they differ; nothing overwritten silently | P1 | specified | — (guest-experience.md GXP-R14 stages guest submissions for desk review) |
| EC-GUE-027 | Channel ingestion and a desk walk-in create the same person simultaneously | Both profiles exist; the duplicate job proposes the pair; no data lost | P1 | tested | test/duplicates.test.ts:316 (nightly scan proposes the pair) |
| EC-GUE-028 | Identity document expired at check-in | Flag on the check-in step per registration policy (Q43); staff choose to capture another document or record an override with permission | P1 | building | — record issue `expired document` exists (record contract); check-in step flag is reservations' |
| EC-GUE-029 | Staff type a passport number into a free-text note | Pattern warning before saving; redaction tool (permissioned, audited) for existing notes | P2 | missing | — |
| EC-GUE-030 | Connected mode: the PMS updates a profile that has Portico-only preferences | Extension fields kept, matched by external id; provenance shows which fields came from the PMS and when | P0 | tested | test/profiles.test.ts:396 (PMS update applied); test/profiles.test.ts:397 (extension fields kept) |
| EC-GUE-031 | Connected mode: the external PMS merges two profiles | Portico receives the merge; extension fields of both combined on the survivor; flagged for review; no data dropped | P1 | missing | — |
| EC-GUE-032 | Importing 50,000 legacy profiles with ~8% duplicates | Import never auto-merges; duplicates queued with scores; import report counts created, parked and candidates | P1 | specified | — |
| EC-GUE-033 | The `guests.profile.merged` event is delivered twice to a consumer | Re-pointing is idempotent by merge id; second delivery changes nothing | P0 | tested | test/scenario-s15-mistaken-merge.test.ts:487 (re-delivery records nothing) |
| EC-GUE-034 | A company is put on hold while it has upcoming bookings | Status visible on those bookings; new direct-bill blocked by finance with reason; existing bookings not cancelled | P1 | building | test/profiles.test.ts (status changes versioned and evented) — partial: finance's direct-bill block not built |
| EC-GUE-035 | An agency changes its legal name and tax id | New version effective from a date; past invoices and folios keep the old values | P1 | missing | — |
| EC-GUE-036 | Search "+960 777-1234" for a profile stored as "7771234" with country MV | Normalised E.164 matching finds it | P0 | tested | test/duplicates.test.ts:91 (formats normalised to E.164); test/profiles.test.ts:78 (national-format search) |
| EC-GUE-037 | Search with a typo ("Mohamd") | Typo-tolerant match ranks "Mohamed" profiles first; only profiles the user may see | P1 | tested | test/profiles.test.ts:73 (typo-tolerant search) |

## Edge cases from the failure-class sweep (playbook v2)

Classes from `docs/quality/patterns.md` groups A–D that apply to this module and are not already covered by a
row above; the class is named in brackets. Classes already covered by earlier rows, and classes that do not
apply (with the reason), are listed in `gaps-ops.md` § Failure-class sweep.

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-GUE-038 | [AP-01 / AP-45] Staff at property B try to read or change property A's property-scoped preference or private alert by id | Not visible and not changeable; A's item unchanged | P0 | tested | test/sharing.test.ts:407 (not visible at B); test/sharing.test.ts:426 (unchanged after the attempt) |
| EC-GUE-039 | [AP-02] A query forgets the tenant filter on any guests table | RLS hides every row of another tenant; the suite enumerates the schema's tables | P0 | tested | test/isolation.test.ts:143 (RLS hides every guests table); test/privacy.test.ts:318 (table list from information_schema) |
| EC-GUE-040 | [AP-04] A channel, import or guest submission declares a contact point "verified" | The flag is honoured only for staff users; otherwise the contact is unverified and never an exact matching key | P0 | building | — partial: unverified email never exact (test/duplicates.test.ts); the non-staff flag path is not asserted |
| EC-GUE-041 | [AP-05] Internal provider functions (snapshots, repoint recording) are called through the public service | Not exposed; consent reads need a guests permission | P0 | tested | test/isolation.test.ts:192 (no snapshot on the public service) |
| EC-GUE-042 | [AP-06] Guests code checks a permission key that its manifest does not register | The catalogue test fails on the merged tree | P0 | tested | apps/api/test/permission-catalog.test.ts:28 (catalogue complete) |
| EC-GUE-043 | [AP-08] Someone creates a profile with another person's email before that person ever books | The real guest's later booking never attaches to it (an unverified email is not an exact key); staff see a candidate pair | P0 | tested | test/duplicates.test.ts:73 (unverified email never an exact key) |
| EC-GUE-044 | [AP-15] A different user of the organization replays the Idempotency-Key of a profile create | The stored response (with personal data) is not returned to them | P0 | tested | packages/db/test/core.test.ts:236 (replay refused for a different user) |
| EC-GUE-045 | [AP-18] Sharing is off: links, known-at properties, duplicate issues and stay history are read at property B | Nothing from property A appears, not even ids | P0 | tested | test/sharing.test.ts:466 (no stay ids from A); test/sharing.test.ts:468 (no duplicate issue leak) |
| EC-GUE-046 | [AP-19] A live organization runs without a production key-management binding | Identity documents and sensitive details refuse to be stored with a development key; the operator is told | P0 | building | — partial: kernel env/dev keys only (README); no assertion that a live org refuses them |
| EC-GUE-047 | [AP-29] An alert's active period ended on the property's previous business date | Not critical on arrival screens and not an issue (judged on the viewing property's business date) | P1 | tested | test/profiles.test.ts:200 (only the active alert) |
| EC-GUE-048 | [AP-31] A consumer processes `guests.profile.merged` after the merge was already reversed | `recordReferenceRepoints` answers `merge_not_active`; the consumer does not re-point | P1 | built | — README provider contract; no test |
| EC-GUE-049 | [AP-35] A consent purpose or legal basis not in the registry is submitted | Refused; processing for unknown purposes is never allowed | P1 | specified | — (GUE-R06 registry; not asserted) |
| EC-GUE-050 | [AP-38] Guest profiles are external (read-only or forward) and staff create or edit identity fields | Read-only: refused with the system name; forward: refused honestly ("forwarding not available"); nothing written | P0 | tested | test/profiles.test.ts:361 (read-only refusal); test/profiles.test.ts:409 (forward refused honestly) |
| EC-GUE-051 | [AP-39] Two saves of the same pair run duplicate detection at the same moment | One candidate row; neither save aborts | P1 | missing | — (not asserted concurrently) |
| EC-GUE-052 | [AP-40 / AP-43] Reservations calls `resolveProfile` with its old input shape (firstName/lastName, no propertyId) | Fails at compile time or with a validation error; never a silently created nameless profile | P0 | building | — partial: contract published (README "Provider contract"); reservations not yet aligned |
| EC-GUE-053 | [AP-44] A retention policy is saved as 0 or a negative number of days | Refused at save with the valid range | P2 | missing | — |
| EC-GUE-054 | [AP-46] A merge fails half-way through re-pointing child rows | Nothing changes: one transaction; both profiles as before | P1 | specified | — (CLAUDE.md §4.5; not asserted) |

<!-- sources (generated from a verified registry; do not edit by hand) -->

## Sources

Registry checked 2026-11-07. **Opened** = the page was fetched from this environment. **Search-located** = found by web search; the host blocks direct fetches here, so the fact is unverified until re-checked. Press releases and trade press are vendor claims, not verified behaviour.

- [Mews — The online check-in journey in the Guest Portal][mews-oci] (opened)
- [Mews — Understanding the Guest Portal][mews-portal] (opened)
- [OPERA Cloud 26.3 — About Data Import (profiles, reservations, rooms management, Track It, ledgers)][op-dataimport] (opened)
- [OPERA Cloud 26.3 — About Profile Purge][op-purge] (opened)
- [OPERA Cloud 26.3 — About Smart Profiles][op-smart] (opened)
- [OPERA Cloud 26.3 — Assigning Tasks to a Role][op-roletasks] (opened)
- [OPERA Cloud 26.3 — Configuring Alternate (Name) Language Titles][op-altname] (opened)
- [OPERA Cloud 26.3 — Configuring Business Events][op-busevents] (opened)
- [OPERA Cloud 26.3 — Configuring Company Types][op-companytypes] (opened)
- [OPERA Cloud 26.3 — Configuring Profile Merge Rules][op-mergerules] (opened)
- [OPERA Cloud 26.3 — Configuring Profile Privacy Customization][op-privcfg] (opened)
- [OPERA Cloud 26.3 — Configuring Profile Protection][op-protect] (opened)
- [OPERA Cloud 26.3 — Creating Sales Account Profiles][op-salesacct] (opened)
- [OPERA Cloud 26.3 — Enrolling Guests in External Loyalty Programs][op-extloyalty] (opened)
- [OPERA Cloud 26.3 — Exports][op-exports] (opened)
- [OPERA Cloud 26.3 — Managing Accompanying Guests][op-accomp] (opened)
- [OPERA Cloud 26.3 — Managing Guest or Contact Profiles][op-profmanage] (opened)
- [OPERA Cloud 26.3 — Managing Profile AR Accounts][op-profar] (opened)
- [OPERA Cloud 26.3 — Managing Profile Attachments][op-profattach] (opened)
- [OPERA Cloud 26.3 — Managing Profile Communication][op-profcomm] (opened)
- [OPERA Cloud 26.3 — Managing Profile Correspondence and Privacy Options][op-profpriv] (opened)
- [OPERA Cloud 26.3 — Managing Profile Credit Card Wallet][op-wallet] (opened)
- [OPERA Cloud 26.3 — Managing Profile Default Routing Instructions][op-profrouting] (opened)
- [OPERA Cloud 26.3 — Managing Profile Flexible Dynamic Fields][op-profudf] (opened)
- [OPERA Cloud 26.3 — Managing Profile Identification and Personal Details][op-profid] (opened)
- [OPERA Cloud 26.3 — Managing Profile Image][op-profimage] (opened)
- [OPERA Cloud 26.3 — Managing Profile Negotiated Rates][op-negrates] (opened)
- [OPERA Cloud 26.3 — Managing Profile Notes][op-profnotes] (opened)
- [OPERA Cloud 26.3 — Managing Profile Ownership Records and Owner Referrals][op-ownership] (opened)
- [OPERA Cloud 26.3 — Managing Profile Preferences][op-profprefs] (opened)
- [OPERA Cloud 26.3 — Managing Profile Relationships][op-profrel] (opened)
- [OPERA Cloud 26.3 — Managing Profile Service Requests][op-profsvc] (opened)
- [OPERA Cloud 26.3 — Managing Profile Subscription][op-subscription] (opened)
- [OPERA Cloud 26.3 — Managing Sales Account Keywords][op-keywords] (opened)
- [OPERA Cloud 26.3 — Managing Travel Agent / Source Commission Details][op-commission] (opened)
- [OPERA Cloud 26.3 — Merging Profiles][op-merge] (opened)
- [OPERA Cloud 26.3 — Outbound System Types (CRM lookup, address/phone/email validation, room key encoding, profile residency)][op-outbound] (opened)
- [OPERA Cloud 26.3 — Preference Groups][op-prefgroups] (opened)
- [OPERA Cloud 26.3 — Profile Anonymization][op-anon] (opened)
- [OPERA Cloud 26.3 — Profile Name Validations][op-namevalid] (opened)
- [OPERA Cloud 26.3 — Profile Production Statistics Report][op-prodstat] (opened)
- [OPERA Cloud 26.3 — SMART Profile — Match and Merge Rules][op-smartrules] (opened)
- [OPERA Cloud 26.3 — UDF Groups and Values][op-udf] (opened)
- [OPERA Cloud 26.3 — Using Batch Profile Update][op-batchupd] (opened)
- [OPERA Cloud 26.3 — Using Profile Lookup and Download with Integrated Solutions][op-proflookup] (opened)
- [OPERA Cloud 26.3 — Using Profile Match List][op-matchlist] (opened)
- [OPERA Cloud 26.3 — Using the Desktop ID Document Scanner][op-idscan] (opened)
- [OPERA Cloud 26.3 — Using the Mobile ID Document Scanner][op-idscanmob] (opened)
- [OPERA Cloud 26.3 — VIP Levels][op-vip] (opened)
- [OPERA Cloud 26.3 — Viewing Profile Future and Past Stays][op-profstays] (opened)
- [OPERA Cloud 26.3 — Viewing Profile History Stay and Revenue Statistics][op-profstats] (opened)
- [OPERA Cloud 26.3 — Viewing Recently Viewed Profiles][op-recent] (opened)
- [Shiji — Enhanced Single Guest Profile in Daylight PMS (press)][shiji-sgp] (search-located)
- [Stayntouch — ID Collection][snt-idcollect] (search-located)

[mews-oci]: https://help.mews.com/s/article/The-online-check-in-journey-in-the-guest-portal
[mews-portal]: https://help.mews.com/s/article/what-is-online-guest-services
[op-accomp]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profiles_accompanying_guests.htm
[op-altname]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_client_relations_configuring_alternate_name_titles.htm
[op-anon]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_create_manage_profiles_profile_anonymization.htm
[op-batchupd]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_using_batch_profile_update.htm
[op-busevents]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_interfaces_configuring_business_events.htm
[op-commission]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_commissions_copying_bank_accounts_to_other_properties.htm
[op-companytypes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_client_relations_configuring_company_types.htm
[op-dataimport]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_system_setup-importing_data.htm
[op-exports]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/ch_exports.htm
[op-extloyalty]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profiles_enrolling_guests_in_external_loyalty_programs.htm
[op-idscan]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_profiles_using_desktop_id_document_scanner.htm
[op-idscanmob]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_profiles_using_mobile_id_document_scanner.htm
[op-keywords]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_adding_search_keywords_to_a_profile.htm
[op-matchlist]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_using_profile_match_list.htm
[op-merge]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_profile_merge_merging_profiles.htm
[op-mergerules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_client_relations_configuring_profile_auto_merge_rules.htm
[op-namevalid]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_client_relations_profile_name_validations.htm
[op-negrates]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_negotiated_rates.htm
[op-outbound]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_toolbox_outbound_system_types_and_respective_configurations.htm
[op-ownership]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_ownership_records_and_owner_referrals.htm
[op-prefgroups]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_client_relations_preference_groups.htm
[op-privcfg]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_configuring_profile_privacy_customization.htm
[op-prodstat]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_reports_profile_production_statistics_profileproductivitystat.htm
[op-profar]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_ar_accounts.htm
[op-profattach]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_attachment.htm
[op-profcomm]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_adding_profile_communications.htm
[op-profid]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_managing_profile_identification_and_personal_details.htm
[op-profimage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_image.htm
[op-proflookup]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_using_profile_lookup_from_external_systems.htm
[op-profmanage]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_viewing_and_editing_a_profile.htm
[op-profnotes]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_adding_notes_to_a_profile.htm
[op-profprefs]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_adding_guest_preferences_to_profiles.htm
[op-profpriv]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_correspondence_options.htm
[op-profrel]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_linking_profiles.htm
[op-profrouting]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profiles_creating_routing_instructions.htm
[op-profstats]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_application_client_relations_profiles_guest_stay_statistics.htm
[op-profstays]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_viewing_profile_future_past_stays.htm
[op-profsvc]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profiles_service_requests.htm
[op-profudf]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_flexible_dynamic_fields.htm
[op-protect]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_client_relations_configuring_profile_protection.htm
[op-purge]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_about_profile_purge.htm
[op-recent]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_create_manage_viewing_a_list_of_recently_viewed_profiles.htm
[op-roletasks]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_manage_property_roles_assigning_tasks_to_roles.htm
[op-salesacct]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_creating_sales_account_profile.htm
[op-smart]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_smart_profiles.htm
[op-smartrules]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_admin_client_relations_smart_profile_match_and_merge_rules.htm
[op-subscription]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_subscription.htm
[op-udf]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_enterprise_udf_groups.htm
[op-vip]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/c_admin_client_relations_vip_levels.htm
[op-wallet]: https://docs.oracle.com/en/industries/hospitality/opera-cloud/26.3/ocsuh/t_managing_profile_credit_card_wallet.htm
[shiji-sgp]: https://www.shijigroup.com/press-news/shiji-unveils-enhanced-single-guest-profile-feature-in-hotel-pms
[snt-idcollect]: https://stayntouch.freshdesk.com/support/solutions/articles/24000038916-id-collection
