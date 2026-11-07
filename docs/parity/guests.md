# Parity matrix and edge cases: guests

Module: `guests` (guest profiles, companies and agencies, preferences, alerts, consent, identity documents,
duplicates, reversible merge, cross-property sharing, privacy). Spec: `docs/specs/guests.md` (Draft v1). Code on
`main`: **none** (`modules/guests` is on a feature branch, not merged), so nothing here is `built` or `tested`.
Researched 2026-11-07.

**Baseline:** OPERA Cloud 26.3 Client Relations (Profiles) and Client Relations Administration. **Modern additions:**
Shiji Daylight (single global profile with guest-controlled sharing), Mews (guest portal data capture), Stayntouch
(ID collection). Portico terms in the Capability column; OPERA *profile* = Portico *guest profile*, OPERA *sales
account / travel agent / source profile* = Portico *company* (`kind=company|agency`), OPERA *anonymization* = Portico
*erasure*. Loyalty programs and marketing live in `crm.md`.

## Capabilities

| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-GUE-001 | Names in native script plus Latin transliteration, title, preferred name, language, nationality | OPERA [alternate (name) language][op-altname] · verified 2026-11-07 | P0 | specified | guests.md GUE-R01 | — |
| PAR-GUE-002 | Contact points (emails, E.164 phones, addresses) each with type, verification state and source | OPERA [profile communication][op-profcomm] · verified 2026-11-07 | P0 | specified | guests.md GUE-R01 | — |
| PAR-GUE-003 | Country-specific address formats (atoll and island for the Maldives) | OPERA [managing profiles][op-profmanage] · verified 2026-11-07 | P1 | specified | guests.md GUE-R01; platform.md PLT-R11 | — |
| PAR-GUE-004 | Address, email and phone validation services at entry | OPERA [outbound validation services][op-outbound] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-005 | VIP levels configurable with meaning and operational effect (amenity, inspection) | OPERA [VIP levels][op-vip] · verified 2026-11-07 | P0 | specified | guests.md GUE-R01 | — |
| PAR-GUE-006 | Tags/keywords for quick classification and search | OPERA [keywords][op-keywords] · verified 2026-11-07 | P1 | specified | guests.md GUE-R01 | — |
| PAR-GUE-007 | Relationships between profiles (spouse, child, assistant, travel companion, employee of) | OPERA [profile relationships][op-profrel] · verified 2026-11-07 | P1 | specified | guests.md GUE-R01 | — |
| PAR-GUE-008 | Important dates (birthday, anniversary, honeymoon) | OPERA [personal details][op-profid] · verified 2026-11-07 | P1 | specified | guests.md GUE-R01 | — |
| PAR-GUE-009 | Profile photo (consented) for recognition at outlets and arrival | OPERA [profile image][op-profimage] · verified 2026-11-07 | P2 | missing | resort.md RST-R02 (consumer only) | — |
| PAR-GUE-010 | Attachments on profiles and companies (contracts, letters, scanned forms) | OPERA [profile attachments][op-profattach] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-011 | Organization-defined custom fields (typed, validated, permissioned) | OPERA [flexible dynamic fields][op-profudf] · [UDF groups][op-udf] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-012 | Structured preferences with category, scope (all properties / one property), source, last confirmed | OPERA [profile preferences][op-profprefs] · [preference groups][op-prefgroups] · verified 2026-11-07 | P0 | specified | guests.md GUE-R02 | — |
| PAR-GUE-013 | Health data (allergies) as a sensitive category with its own permission; shown operationally only as consented alert text | assumption (GDPR special category) | P0 | specified | guests.md GUE-R02 | — |
| PAR-GUE-014 | Alerts with severity, audience departments, active period; critical alerts on arrival, check-in, room move and outlet screens | assumption | P0 | specified | guests.md GUE-R03 | — |
| PAR-GUE-015 | Notes with visibility (shared, property-private, department), never edited in place | OPERA [profile notes][op-profnotes] · verified 2026-11-07 | P0 | specified | guests.md GUE-R04 | — |
| PAR-GUE-016 | Identity documents field-encrypted, reads permissioned and audited, never indexed | OPERA [identification details][op-profid] · verified 2026-11-07 | P0 | specified | guests.md GUE-R05, GUE-I04 | — |
| PAR-GUE-017 | ID/passport scanning (desktop scanner, phone camera) populating profile and document fields | OPERA [desktop ID scanner][op-idscan] · [mobile ID scanner][op-idscanmob] · Stayntouch [ID collection][snt-idcollect] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-018 | Consent per purpose per legal entity with evidence (text version, time, channel) | OPERA [correspondence and privacy options][op-profpriv] · verified 2026-11-07 | P0 | specified | guests.md GUE-R06 | — |
| PAR-GUE-019 | Channel subscriptions and preferred contact channel (email, SMS, WhatsApp) | OPERA [profile subscription][op-subscription] · verified 2026-11-07 | P1 | specified | guests.md GUE-R06 | — |
| PAR-GUE-020 | Protected profiles (celebrities, executives): restricted view/edit list | OPERA [profile protection][op-protect] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-021 | Incognito/alias name used on lists, keys and messages while the real identity is protected | OPERA [alias/incognito field][op-anon] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-022 | Name validation rules (reject "Guest", "TBA", all-caps, digits) | OPERA [profile name validations][op-namevalid] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-023 | Recently viewed profiles list | OPERA [recently viewed profiles][op-recent] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-024 | Stored payment cards (tokens only) visible on the profile | OPERA [credit card wallet][op-wallet] · verified 2026-11-07 | P1 | specified | payments.md PAY-R05 | — |
| PAR-GUE-025 | Company/agency default billing ("company pays room and tax") applied to new bookings | OPERA [default routing instructions][op-profrouting] · verified 2026-11-07 | P1 | specified | finance.md FIN-R17 [SHOULD] | — |
| PAR-GUE-026 | Negotiated/contracted rates attached to companies and agencies | OPERA [profile negotiated rates][op-negrates] · verified 2026-11-07 | P0 | specified | rates.md RAT-R06 | — |
| PAR-GUE-027 | External loyalty/frequent-flyer memberships stored on the profile | OPERA [external loyalty enrolment][op-extloyalty] · verified 2026-11-07 | P1 | missing | crm.md (planned) | — |
| PAR-GUE-028 | Company: legal and trading name, tax id, billing address, contacts, status | OPERA [sales account profiles][op-salesacct] · verified 2026-11-07 | P0 | specified | guests.md GUE-R07 | — |
| PAR-GUE-029 | Travel agent / tour operator / DMC with IATA or agency id and commission arrangement | OPERA [commission details][op-commission] · verified 2026-11-07 | P0 | specified | guests.md GUE-R07 | — |
| PAR-GUE-030 | Company sub-types (corporate, DMC, tour operator, wholesaler, government, OTA-as-merchant) | OPERA [company types][op-companytypes] · verified 2026-11-07 | P1 | missing | guests.md GUE-R07 (only company/agency) | — |
| PAR-GUE-031 | Company hierarchy (parent → subsidiaries) for reporting | assumption | P1 | specified | guests.md GUE-R08 | — |
| PAR-GUE-032 | Receivables account and credit status shown read-only on the company | OPERA [profile AR accounts][op-profar] · verified 2026-11-07 | P0 | specified | guests.md GUE-R07; finance.md | — |
| PAR-GUE-033 | Contacts at companies with role; a contact can also be a guest | OPERA [merge contacts with guests][op-merge] · verified 2026-11-07 | P1 | specified | guests.md GUE-R07 | — |
| PAR-GUE-034 | Sales information on accounts (owner, industry, potential, territory) | OPERA [sales account profiles][op-salesacct] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-035 | Production statistics per company/agency (room nights, revenue, cancellations) | OPERA [profile production statistics][op-prodstat] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-036 | Profile resolution for bookings, channels and imports; never silently merges; OTA alias emails low-confidence | OPERA [profile match list][op-matchlist] · verified 2026-11-07 | P0 | specified | guests.md GUE-R09 | — |
| PAR-GUE-037 | Possible-duplicate suggestions while staff type a new profile | OPERA [profile match list][op-matchlist] · verified 2026-11-07 | P0 | specified | guests.md GUE-R09 | — |
| PAR-GUE-038 | Duplicate detection on save and nightly; review queue with score and reasons; dismissals remembered | OPERA [smart profiles][op-smart] · [match and merge rules][op-smartrules] · verified 2026-11-07 | P0 | specified | guests.md GUE-R10 | — |
| PAR-GUE-039 | Configurable match rules (keys, weights, thresholds) per organization | OPERA [profile merge rules][op-mergerules] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-040 | Automatic merge of exact matches | OPERA [auto merge rules][op-mergerules] · verified 2026-11-07 | P2 | different | guests.md GUE-R09 (never silent; staff merge with reversible unmerge) | — |
| PAR-GUE-041 | Merge with field-level choices, result preview and per-module reference preview | OPERA [merging profiles][op-merge] · verified 2026-11-07 | P0 | specified | guests.md GUE-R11 | — |
| PAR-GUE-042 | Merge blocking conditions explained (open receivables, unpaid commissions, different kinds, anonymized) | OPERA [merge conditions][op-merge] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-043 | Unmerge that restores both profiles and every re-pointed reference | assumption (not offered by OPERA; Stayntouch lacks merge — research R02 §4.4) | P0 | specified | guests.md GUE-R12, GUE-I02 | — |
| PAR-GUE-044 | Reads of a merged id resolve to the survivor and say so | assumption | P0 | specified | guests.md GUE-R13 | — |
| PAR-GUE-045 | Batch update of a field across selected profiles (VIP level, market segment) | OPERA [batch profile update][op-batchupd] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-046 | Past and future stays per profile across properties | OPERA [future and past stays][op-profstays] · verified 2026-11-07 | P0 | specified | guests.md GUE-R14 | — |
| PAR-GUE-047 | Stay and revenue statistics per profile (nights, revenue by category, currency noted) | OPERA [stay and revenue statistics][op-profstats] · verified 2026-11-07 | P0 | specified | guests.md GUE-R14 | — |
| PAR-GUE-048 | Recognition summary for arrival screens (returning, VIP, alerts, key preferences, open recovery items) | assumption | P0 | specified | guests.md GUE-R15 | — |
| PAR-GUE-049 | Accompanying guests and children (with ages) linked to the stay as occupants | OPERA [accompanying guests][op-accomp] · verified 2026-11-07 | P0 | specified | reservations.md RES-R02 | — |
| PAR-GUE-050 | Service requests and complaints history on the profile | OPERA [profile service requests][op-profsvc] · verified 2026-11-07 | P1 | specified | guests.md GUE-R14 | — |
| PAR-GUE-051 | Conversation history on the profile timeline | assumption | P1 | specified | guests.md §9 | — |
| PAR-GUE-052 | One profile across all properties of an organization | Shiji [single guest profile][shiji-sgp] · verified 2026-11-07 | P0 | specified | guests.md GUE-R16 | — |
| PAR-GUE-053 | Guest-controlled opt-in/out of cross-property sharing | Shiji [opt in or out of sharing][shiji-sgp] · verified 2026-11-07 | P1 | specified | guests.md GUE-R06 (`cross_property_sharing`) | — |
| PAR-GUE-054 | Property-private fields never leave their property; sharing switch reversible | assumption (OPERA switch irreversible — research R01 §2.4) | P0 | specified | guests.md GUE-R16 | — |
| PAR-GUE-055 | Data access/export request producing a machine-readable export across modules | OPERA [privacy customization][op-privcfg] · verified 2026-11-07 | P0 | specified | guests.md GUE-R17 | — |
| PAR-GUE-056 | Erasure by irreversible anonymization while fiscal records keep legally required data | OPERA [profile anonymization][op-anon] · verified 2026-11-07 | P0 | specified | guests.md GUE-R18 | — |
| PAR-GUE-057 | Anonymization pre-checks (open folios, future stays, receivables, payee on billing rules) listed all at once | OPERA [anonymization conditions][op-anon] · verified 2026-11-07 | P1 | missing | guests.md GUE-R18 (legal hold only) | — |
| PAR-GUE-058 | Retention schedules and automatic purge of inactive profiles with a report | OPERA [profile purge][op-purge] · verified 2026-11-07 | P0 | specified | guests.md GUE-R19 | — |
| PAR-GUE-059 | Country privacy configuration (mandatory fields, consent purposes, retention defaults) | OPERA [privacy customization][op-privcfg] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-060 | Profile data residency (region where personal data is stored) | OPERA [profile residency][op-outbound] · verified 2026-11-07 | P2 | missing | — | — |
| PAR-GUE-061 | Profile search by name in any script, email, phone in any format, company, confirmation code, document hash | assumption | P0 | specified | guests.md GUE-R20 | — |
| PAR-GUE-062 | Permissioned profile list export (CSV) with audit | OPERA [exports][op-exports] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-063 | Profile lookup in an external CRM/PMS while creating a booking | OPERA [profile lookup with integrated solutions][op-proflookup] · verified 2026-11-07 | P1 | specified | guests.md §14 | — |
| PAR-GUE-064 | Connected mode: mirrored profiles plus Portico-only extension fields labelled as such | assumption | P0 | specified | guests.md §14 | — |
| PAR-GUE-065 | Profile events (created, updated, merged) for partners without personal data in payload | OPERA [business events — profile][op-busevents] · verified 2026-11-07 | P1 | specified | guests.md §7 | — |
| PAR-GUE-066 | Import of profiles and relationships from the previous system | OPERA [data import: profiles and relationships][op-dataimport] · verified 2026-11-07 | P0 | specified | integration.md INT-R05, INT-R30 | — |
| PAR-GUE-067 | Unit-owner profiles and owner referrals | OPERA [ownership records][op-ownership] · verified 2026-11-07 | P2 | specified | platform.md PLT-R17 | — |
| PAR-GUE-068 | Guest self-service profile and preference editing (portal) with provenance | Mews [guest portal][mews-portal] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-069 | Guest-submitted data (online check-in) staged and merged into the profile with source and review on conflict | Mews [online check-in journey][mews-oci] · verified 2026-11-07 | P1 | missing | — | — |
| PAR-GUE-070 | Guest-relations lists: in-house VIPs, birthdays and anniversaries this week, returning arrivals | assumption | P1 | missing | — | — |
| PAR-GUE-071 | Guest-nights by nationality and residence for authority statistics | assumption (Maldives tourism statistics) | P0 | specified | analytics.md ANL-R02 | — |
| PAR-GUE-072 | Granular permissions (merge, unmerge, sensitive, documents, privacy export/erase) | OPERA [role tasks][op-roletasks] · verified 2026-11-07 | P0 | specified | guests.md §8 | — |
| PAR-GUE-073 | Pseudonymous ids only in analytics facts | assumption | P1 | specified | guests.md §6 | — |
| PAR-GUE-074 | Sparse profiles from tour operators (names only), enriched at check-in | assumption (Maldives DMC bookings) | P0 | specified | guests.md §11 | — |
| PAR-GUE-075 | Versioned company names and tax ids (past invoices keep the old values) | assumption | P1 | missing | — | — |

## Edge cases

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-GUE-001 | Two different "Ahmed Ali" profiles merged by mistake | Unmerge restores both field-for-field; references in reservations, finance and comms restored from the reference map; post-merge stay assigned after review; audit shows both events (S15) | P0 | specified | — |
| EC-GUE-002 | A was merged into B, later B into C; staff try to unmerge A | Refused with guidance: unmerge B from C first; then A from B (GUE-R12) | P1 | specified | — |
| EC-GUE-003 | After a merge, a new stay and a note were added to the survivor; then the merge is reversed | Post-merge items listed with a suggested owner each (by identifiers carried); staff confirm; nothing reassigned silently | P0 | specified | — |
| EC-GUE-004 | Two staff merge A+B and B+C at the same moment | One succeeds; the other gets 409 with the current state; chains never form cycles (GUE-I01) | P0 | specified | — |
| EC-GUE-005 | Merging a profile that has an open receivables balance or unpaid commissions | Merge refused or AR re-pointing previewed by finance; the reason names the open items; never strands a balance | P1 | missing | — |
| EC-GUE-006 | Merged profiles hold different consent states for the same purpose and legal entity | Survivor keeps the most restrictive current state (withdrawn wins) with both evidence histories; marketing stops until fresh consent | P0 | missing | — |
| EC-GUE-007 | Two different guests share an OTA alias email from the same booking channel | Never matched or merged on that address (low-confidence contact point) | P0 | specified | — |
| EC-GUE-008 | Same passport number and country on two profiles | Exact-key duplicate candidate with high score; not auto-merged | P1 | specified | — |
| EC-GUE-009 | Twins with the same name, birth date and address | Proposed as duplicates; staff dismiss with reason; pair not proposed again unless a new exact key matches | P1 | specified | — |
| EC-GUE-010 | Channel delivers a Chinese guest's name in Latin only; passport scan later adds native script | Native script added as the primary native name with source; duplicate matching works across scripts | P1 | specified | — |
| EC-GUE-011 | Transliteration variants (Aleksandr / Alexander, Mohamed / Muhammad) | Fuzzy match proposes candidates with reasons; never merges automatically | P1 | specified | — |
| EC-GUE-012 | Tour operator sends names only, no email or phone | Profile created with `exact_only` matching (no fuzzy auto-link); enriched at check-in; returning-guest link suggested after enrichment | P0 | specified | — |
| EC-GUE-013 | Erasure requested by a guest with a future reservation | Refused with reason (future stay) and options: cancel first or schedule erasure after departure; request status `on_hold` | P1 | missing | — |
| EC-GUE-014 | Erasure requested while fiscal invoices are under retention | Profile anonymized; fiscal documents keep legally required data until retention ends, then purged by the retention job | P0 | specified | — |
| EC-GUE-015 | Erasure of a profile that was booker for other people's stays | Booker reference anonymized; occupants' profiles and stays untouched | P1 | missing | — |
| EC-GUE-016 | An anonymized guest returns and books again | New profile; no attempt to re-link the anonymized history | P1 | missing | — |
| EC-GUE-017 | Access/export request while one module is unavailable | Export marked `incomplete` with the missing module listed; never delivered as complete; retried | P1 | missing | — |
| EC-GUE-018 | Staff at property P2 without shared-read permission searches a guest who stayed only at P1 | No result and 404 on direct id (GUE-I05) | P0 | specified | — |
| EC-GUE-019 | Organization switches cross-property sharing off, then on again | Off hides shared data at other properties, deletes nothing; on restores it exactly | P0 | specified | — |
| EC-GUE-020 | A property-private note on a shared profile, viewed from a sister property | Never shown, not even as a count | P0 | specified | — |
| EC-GUE-021 | Waiter posting a charge for a guest with a nut allergy | Outlet screen shows the consented alert text only; the health record stays hidden without `guests.sensitive.read` | P0 | specified | — |
| EC-GUE-022 | Consent withdrawn while a campaign is queued | Send-time check blocks the message; run history shows "skipped — consent withdrawn" (GUE-I07) | P0 | specified | — |
| EC-GUE-023 | Marketing consent given to legal entity A; guest later stays at sister property owned by legal entity B | No marketing from B until B obtains consent | P0 | specified | — |
| EC-GUE-024 | Child profile (minor) | No marketing consent purposes offered; guardian relationship recorded; age-at-arrival computed per stay | P1 | missing | — |
| EC-GUE-025 | Birth date known without year, or 29 February | Partial date stored; age-based rules treat unknown year as unknown (not 0); leap-day birthdays shown on 28 Feb in non-leap years by policy | P2 | missing | — |
| EC-GUE-026 | Desk edits a profile while the guest submits online check-in for the same profile | Version conflict detected; guest-submitted values staged with source "guest" and shown to staff where they differ; nothing overwritten silently | P1 | missing | — |
| EC-GUE-027 | Channel ingestion and a desk walk-in create the same person simultaneously | Both profiles exist; the duplicate job proposes the pair; no data lost | P1 | specified | — |
| EC-GUE-028 | Identity document expired at check-in | Flag on the check-in step per registration policy (Q43); staff choose to capture another document or record an override with permission | P1 | missing | — |
| EC-GUE-029 | Staff type a passport number into a free-text note | Pattern warning before saving; redaction tool (permissioned, audited) for existing notes | P2 | missing | — |
| EC-GUE-030 | Connected mode: the PMS updates a profile that has Portico-only preferences | Extension fields kept, matched by external id; provenance shows which fields came from the PMS and when | P0 | specified | — |
| EC-GUE-031 | Connected mode: the external PMS merges two profiles | Portico receives the merge; extension fields of both combined on the survivor; flagged for review; no data dropped | P1 | missing | — |
| EC-GUE-032 | Importing 50,000 legacy profiles with ~8% duplicates | Import never auto-merges; duplicates queued with scores; import report counts created, parked and candidates | P1 | specified | — |
| EC-GUE-033 | The `guests.profile.merged` event is delivered twice to a consumer | Re-pointing is idempotent by merge id; second delivery changes nothing | P0 | specified | — |
| EC-GUE-034 | A company is put on hold while it has upcoming bookings | Status visible on those bookings; new direct-bill blocked by finance with reason; existing bookings not cancelled | P1 | specified | — |
| EC-GUE-035 | An agency changes its legal name and tax id | New version effective from a date; past invoices and folios keep the old values | P1 | missing | — |
| EC-GUE-036 | Search "+960 777-1234" for a profile stored as "7771234" with country MV | Normalised E.164 matching finds it | P0 | specified | — |
| EC-GUE-037 | Search with a typo ("Mohamd") | Typo-tolerant match ranks "Mohamed" profiles first; only profiles the user may see | P1 | specified | — |

<!-- sources (generated from a verified registry; do not edit by hand) -->
