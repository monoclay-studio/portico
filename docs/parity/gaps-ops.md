# Gaps: ops cluster — spec change requests, sweep record and opportunities

Status: v2 · 2026-11-07 · cluster `ops` · playbook `docs/quality/playbooks/parity-researcher.md` **v2** · Source
matrices in this folder: `operations.md`, `guests.md`, `integration.md`, `identity.md`, `comms.md`, `resort.md`,
`access.md`, `guest-experience.md`, `crm.md`, `ai.md`. This file holds no matrix tables, so
`tools/parity-report.mjs` reports it with zero rows. Specs are not edited here: every change below is a request for
the spec owner. Owner questions are proposed in §8 without numbers (this workstream writes only under
`docs/parity/`, and Q140–Q144 are already taken in `docs/OPEN_QUESTIONS.md`).

## 1. Status at a glance

| Module | Code on `main` | Capabilities (P0/P1/P2) | Tested | Edge cases (sweep rows) | Tested | Open P0 | Missing P0/P1 |
|---|---|---|---|---|---|---|---|
| operations | yes | 98 (39/43/16) | 16 | 70 (22) | 17 | 43 | 1/34 |
| guests | yes | 75 (34/32/9) | 22 | 54 (17) | 26 | 23 | 0/20 |
| integration | yes (wave 1) | 87 (50/30/7) | 46 | 59 (15) | 42 | 19 | 3/10 |
| identity | wave 0; wave 1 on branch `abbd5e9` | 56 (22/26/8) | 6 | 50 (16) | 4 | 42 | 0/5 |
| comms | no (spec) | 56 (26/27/3) | 0 | 49 (17) | 0 | 46 | 11/22 |
| resort | no (spec) | 60 (29/19/12) | 0 | 61 (27) | 0 | 58 | 3/20 |
| access | no (spec) | 40 (21/11/8) | 0 | 48 (16) | 0 | 47 | 2/1 |
| guest-experience | no (spec) | 56 (25/22/9) | 0 | 55 (23) | 0 | 48 | 1/14 |
| crm | no (spec) | 47 (3/34/10) | 0 | 51 (21) | 0 | 12 | 1/6 |
| ai | no (spec) | 33 (14/14/5) | 0 | 39 (19) | 0 | 36 | 1/6 |

No module in this cluster passes the gate (`node tools/parity-report.mjs --gate <module>` exits 1 for all ten): every
one has open P0 rows. That is the honest state; the gate is not a target to be met by rewording rows.

## 2. Playbook v2 self-check

**Tested rows with an assertion quote: 179 / 179.** Every `tested` row quotes the asserting line on `main` as
`file:line` with what it proves (operations 33, guests 48, integration 88, identity 10). Concurrency rows cite tests
that run `Promise.all` / `Promise.allSettled`.

**Rows downgraded in this pass (and why):**

| Row | From → to | Reason |
|---|---|---|
| PAR-OPS-004 | tested → building | Recording asserted; no per-unit history read asserted |
| PAR-OPS-007, EC-OPS-012 | tested → building | Skip exception asserted; the sleep case's front-office exception is not |
| PAR-OPS-020 | tested → building | Credits used in balancing asserted; credits per unit type not |
| PAR-OPS-048 | tested → building | Guesthouse defaults asserted; the one-screen owner list is UI (not built) |
| PAR-OPS-062 | tested → building | The doer cannot verify; per-kind verification policy not asserted |
| PAR-OPS-066, EC-OPS-019 | tested → building | Affected stays proven only against the fake inventory (pattern AP-51); real provider covers block and refusal |
| PAR-OPS-069 | tested → built | Parts are accepted but never read back by an assertion |
| PAR-OPS-084 | tested → building | Expected minutes per unit type not asserted |
| PAR-GUE-008 | tested → built | Important dates passed to recognition but not asserted |
| PAR-GUE-043, EC-GUE-001 | tested → building | References restored only through a fake reservations consumer; the real consumer does not follow the protocol yet (AP-51) |
| PAR-GUE-074, EC-GUE-012 | tested → building | Names-only profile asserted; enrichment at check-in not |
| EC-GUE-010 | tested → building | Cross-script matching asserted; adding the native script later is not |
| PAR-IDN-023 | tested → building | Property scope asserted; brand and region scopes not |
| identity wave-1 rows (55) | building → `built (feat/identity-platform-enterprise@abbd5e9)` | Proven only on the unmerged branch: capped at `built` (PR2-1). Four partial ones stay `building`. Rows touched by the third review's open findings say so (R3-P1-1, R3-P1-2, R3-P2-1..3) |

**Other corrections in this pass.** `guests.md` had no Sources section (its reference links were dangling); it is
regenerated from the verified registry. Access IDs were `PAR-ACC-*`/`EC-ACC-*`, which collide with `accounting.md`;
they are now `PAR-ACS-*`/`EC-ACS-*`, following the access spec's prefix change to `ACS` on `main` (its invariants
still read `ACC-I0x`). A guest-experience citation pointed at the wrong RMS page and was fixed. Sources are marked
**opened** or **search-located** (host blocks direct fetch here → the fact is unverified); rows resting only on
search-located sources say "unverified".

## 3. Decisions needed: implementation and matrix disagree

| Row | Implementation on `main` | Matrix expectation | Recommendation |
|---|---|---|---|
| EC-OPS-017 | In-progress service tasks follow the guest to the new unit on a room move | Started work stays with the old unit (now a departure clean) | Keep started tasks on the old unit; move only unstarted in-room service. Add to OPS-R07/§7 |
| EC-OPS-020 | Out-of-order on an in-house unit is accepted; the stay becomes a resolution item | Preview shows the stay; OOO only together with a relocation case | Implementation is close; add the preview and the in-house test (OPS-R17) |
| EC-GUE-006 | Merge keeps the most recent consent statement (`merge.test.ts` "the most recent statement wins") | Most restrictive (withdrawn wins) until fresh consent | Owner/legal call (§8); conservative default is "withdrawn wins" |
| PAR-OPS-028, EC-OPS-048 | Re-running the day plan is insert-only by business key | Preserve manual changes, preview before applying | Add a test after manual reassignments; add the preview to OPS-R05 |

## 4. Spec change requests

Each bullet names the target spec section and the matrix rows it closes. P0 marked.

### operations.md
- **§4 / OPS-R05:** Day Close interaction — a departure clean belongs to the check-out business date and survives
  the date advance; the overnight stayover transition runs once per unit per night (EC-OPS-008 **P0**, EC-OPS-009).
- **OPS-R01/R10:** bulk condition change with preview (PAR-OPS-006); optional pickup/touch-up condition
  (PAR-OPS-002, P2); vacant-unit decay and water-flush rules (PAR-OPS-012, EC-OPS-047).
- **OPS-R02:** person discrepancy (occupant count differs; per-person taxes such as Green Tax re-priced by
  reservations) (PAR-OPS-008, EC-OPS-014).
- **OPS-R05:** per-stay cleaning time and room instructions consumed from GXP-R09 (PAR-OPS-018); turndown per stay
  (PAR-OPS-019); public-area and back-of-house rounds (PAR-OPS-049); composite and connecting units as one assignment
  (PAR-OPS-034, decision P1-8); overload warning with shortfall (EC-OPS-046); policy change mid-day (EC-OPS-043).
- **OPS-R07:** shift end returns unfinished tasks to the section queue with a handover entry (EC-OPS-030); escalation
  to the next level when nobody is on shift (EC-OPS-035); work orders assigned by trade/skill (PAR-OPS-065).
- **OPS-R08/§11:** printable task sheets as paper fallback (PAR-OPS-035); staff app languages incl. Dhivehi RTL
  (PAR-OPS-043); photo upload never blocks completion on 2G (EC-OPS-040); suspended attendant's queued actions held
  for review (EC-OPS-042); shared-device switch (EC-OPS-054).
- **OPS-R11:** future-dated and recurring general tasks (PAR-OPS-054); request catalogue with default department and
  expected time (PAR-OPS-057); re-pointing a request logged against the wrong stay (EC-OPS-033).
- **OPS-R17:** bulk out-of-order by location as one previewed, all-or-nothing action (PAR-OPS-068, EC-OPS-024);
  resort-wide outage as out-of-service, not out-of-order (EC-OPS-025).
- **OPS-R20:** high-value items and identity documents with restricted access, two-person custody, claimant identity
  check (PAR-OPS-080, EC-OPS-036, EC-OPS-037); erasure contributor for lost-and-found and task titles (EC-OPS-055).
- **New §5 invariants (sweep):** sample units never in live (EC-OPS-056); consumer dedupe after processing
  (EC-OPS-058); concurrent discrepancy reports reuse one exception (EC-OPS-065); timezone display (EC-OPS-011).
- **Notify the room-ready moment** to comms/guest-experience (PAR-OPS-032 = PAR-GXP-022).

### guests.md
- **GUE-R01:** attachments (PAR-GUE-010); organization custom fields (PAR-GUE-011); company sub-types
  (PAR-GUE-030); versioned company legal names and tax ids (PAR-GUE-075, EC-GUE-035).
- **New GUE-R21 protected and incognito profiles:** restricted view list and alias names on lists, keys and messages
  (PAR-GUE-020, PAR-GUE-021).
- **GUE-R10:** configurable match rules per organization (PAR-GUE-039); concurrent detection reuses one candidate
  (EC-GUE-051).
- **GUE-R11:** merge pre-checks listed all at once — open receivables, unpaid commissions, different kinds
  (PAR-GUE-042, EC-GUE-005); consent rule on merge (EC-GUE-006, decision).
- **GUE-R14:** production statistics per company and agency (PAR-GUE-035).
- **GUE-R17/R18:** anonymization pre-checks (future stays, open folios, receivables, payer on billing rules)
  (PAR-GUE-057, EC-GUE-013); erasure of a booker leaves occupants untouched (EC-GUE-015); an anonymized guest returns
  as a new profile (EC-GUE-016); permissioned CSV export (PAR-GUE-062).
- **New GUE-R22 country privacy configuration** (mandatory fields, purposes, retention defaults) (PAR-GUE-059);
  minors: no marketing purposes, guardian link, age at arrival (EC-GUE-024).
- **§14:** external PMS merges two profiles → extension fields combined and flagged (EC-GUE-031).

### integration.md
- **INT-R16/R17:** claimable identifiers — a PMS account id, hotel code or webhook endpoint is unique across tenants
  or needs ownership proof; inbound routing resolves to one tenant (EC-INT-046, **P0**).
- **INT-R18/R19:** environment re-checked at execution; trial → live switch refuses queued commands
  (`environment_changed`) (EC-INT-052, **P0**).
- **INT-R20:** per-workflow tax-treatment declaration; hold records until declared (EC-INT-053, **P0**).
- **New INT-R35 vendor limits:** rate budgets shared by a hotel's integrations (OHIP 50 rps per gateway), 429
  back-off with `delayed` labels, per-tenant budget per tick (PAR-INT-038, EC-INT-035); async bulk extraction jobs
  for large windows (PAR-INT-039).
- **INT-R26/R27:** published rate limits, deprecation policy and changelog (PAR-INT-058); partner sandbox and
  certification path (PAR-INT-060).
- **INT-R05:** scheduled exports to SFTP/HTTPS with delivery status (PAR-INT-068).
- **INT-R25:** legacy hotel-interface protocols (FIAS-style) through the on-site agent for locks, PBX, Wi-Fi,
  minibar (PAR-INT-070).
- **INT-R30/R31:** import every reservation status, including cancelled and no-show (PAR-INT-077).
- **INT-R13:** archived mapping targets hold records (EC-INT-059).
- **§3.8 privacy:** per-guest erasure reaches inbound and outbound payloads (EC-INT-039).

### identity.md
- **New IDN-R22 access review:** roles-and-permissions report and export (PAR-IDN-030); activity search per user and
  date range (PAR-IDN-051).
- **IDN-R02:** per-IP limits keyed only on the trusted proxy's client IP (EC-IDN-041); breached-password check
  (PAR-IDN-003).
- **IDN-R06:** staff identity erasure keeps pseudonymous audit attribution (EC-IDN-044); concurrent invitations
  (EC-IDN-048).
- **ADR-0017 rules 12/15 (branch fixes before merge):** serialize the first-verification wipe (EC-IDN-039,
  R3-P1-1); groups-claim changes are root changes (EC-IDN-040, R3-P1-2); domain verification exclusive and
  re-checked (EC-IDN-037, R3-P2-2).

### comms.md
- **COM-R05:** a step never sends an unresolved variable — wait or block the preview (PAR-COM-019, EC-COM-029,
  **P0**); signed guest links `{guestLink:purpose}` (PAR-COM-020, **P0**, SCR-30); market content packs as versioned,
  cited data (PAR-COM-021, EC-COM-049).
- **COM-R09:** WhatsApp 24-hour window enforced (PAR-COM-047, EC-COM-007, **P0**); provider callbacks verified by
  signature (EC-COM-036, **P0**); sender numbers and provider webhooks unique across tenants or proven (EC-COM-035,
  **P0**); media URLs fetched through safe-fetch (EC-COM-037); unknown outcome → pending verification, never resent
  blindly (EC-COM-043, **P0**); environment re-checked at send (EC-COM-040, **P0**).
- **New COM-R12 sensitive data in chat:** card numbers masked on receipt with a secure payment link; passport photos
  moved to encrypted capture (PAR-COM-054, EC-COM-026, EC-COM-027, **P0**).
- **COM-R06:** ready-made automation library (PAR-COM-031); audience preview before activation (PAR-COM-032);
  explicit choice for past-due sends (PAR-COM-033, EC-COM-022); one-off scheduled messages (PAR-COM-034); event
  ordering and payload tolerance (EC-COM-042); budget cap under concurrency (EC-COM-044); missing-language fallback
  at save and send (EC-COM-048).
- **New COM-R13 sender register** (one sender per message type per property, coexistence with an existing tool)
  (PAR-COM-037, EC-COM-024).
- **COM-R01:** unknown sender → suggested profile match, never auto-merge (PAR-COM-015, EC-COM-016); departing staff
  member's conversations reassigned (PAR-COM-016, EC-COM-032); one conversation under concurrent channels
  (EC-COM-047); sharing respected in search (EC-COM-039).
- **§5:** conversations in the guest erasure plan (PAR-COM-053, EC-COM-038).

### resort.md (apply journey SCR-33 to SCR-37, then)
- **RST-R04/R06:** seaplane daylight cut-off, minimum connection time and transit-night planning (PAR-RST-019,
  EC-RST-002, **P0**, SCR-34); departure leg planned from the outbound flight (PAR-RST-020); airport meet and greet
  (PAR-RST-021, SCR-35); cascades on extension, room move and cancellation (EC-RST-025, EC-RST-026, EC-RST-027);
  event ordering (EC-RST-050).
- **RST-R07:** diving record and refresher rule, kids club registration and pick-up (PAR-RST-033, PAR-RST-034,
  EC-RST-012, SCR-36); waiver versioning and re-signature policy (EC-RST-013); staff unavailability re-planning
  (EC-RST-010); activity and spa utilisation reports (PAR-RST-045).
- **RST-R01:** POS outlet codes and vendor accounts unique across tenants (EC-RST-037, **P0**); the same coverage
  decision on every posting path (EC-RST-058); one collection across portal and desk (EC-RST-048).
- **RST-R12/R13:** entitlement restored for included excursions cancelled by weather (EC-RST-008); concurrent and
  partial refund handling (EC-RST-041, EC-RST-059); allowance usage never reset by re-applying a package
  (EC-RST-046); trial manifests never treated as sent (EC-RST-040); erasure of waivers and medical statements
  (EC-RST-039).

### access.md
- **ACS-R02/R05:** lock site and encoder ids unique across tenants or proven (EC-ACS-035, **P0**).
- **ACS-R08–R10:** stay events applied in order — a late extension never re-extends a checked-out stay
  (EC-ACS-042, **P0**); trial packets void on going live (EC-ACS-039).

### guest-experience.md
- **GXP-R10/R33:** a trial payment link opened after going live is refused (EC-GXP-040, **P0**).
- **GXP-R14/§3.3:** batch registration-card printing as paper fallback (PAR-GXP-020); advance and automatic
  check-in when the room is ready (PAR-GXP-021); room-ready notification (PAR-GXP-022); duplicate passport warning
  (EC-GXP-010).
- **GXP-R16/R17:** refund or credit when a sold upsell cannot be delivered (PAR-GXP-034, EC-GXP-017).
- **New GXP-R36 self-service quality:** failure rate measured, hand-off to staff with context (PAR-GXP-054,
  EC-GXP-032); recovery when someone locks a guest's link (EC-GXP-053).
- **GXP-R01/R04:** property branding and own domain (PAR-GXP-007); tokens removed from URLs after exchange
  (EC-GXP-038); offline cache shows its age (EC-GXP-047); content-pack versions (EC-GXP-054); portal data in the
  erasure plan (EC-GXP-039).

### crm-marketing.md
- **CRM-R04/R09:** environment re-checked at send for campaigns scheduled in trial (EC-CRM-036, **P0**); campaign
  resume never re-sends uncertain recipients (EC-CRM-043); keyed seals on survey and unsubscribe links (EC-CRM-034).
- **CRM-R12/R13:** review source accounts unique across tenants (EC-CRM-033); reply publication timeouts → pending
  verification (EC-CRM-040).
- **CRM-R25:** voucher codes masked in logs, audit and replays (EC-CRM-035).
- **§5:** erasure leaves a minimal keyed-hash suppression record (EC-CRM-027).

### ai.md
- **AI-R04:** segregation of duties and step-up apply to AI proposals exactly as to humans; AI is never the second
  approver (EC-AI-025, **P0**).
- **AI-R07:** budget reserved before the call (EC-AI-032); **AI-R09:** model calls outside transactions
  (EC-AI-036); ai logs in the erasure plan (EC-AI-028); trial proposals expire on going live (EC-AI-030).
- **New AI-R12 governed analytics questions** answered only from defined metrics (PAR-AI-012, EC-AI-017), with
  `analytics.md`.

### Cross-cutting (platform / kernel)
- **Environment change mid-operation (AP-19):** `assertExternalEffectAllowed` at execution time for every queued
  effect, with `environment_changed` — missing in five specs (EC-INT-052, EC-COM-040, EC-GXP-040, EC-CRM-036,
  EC-AI-030). One kernel rule closes all of them.
- **Claimable external identifiers (AP-03):** one platform rule — tenant-unique is not enough; ownership proof or
  global uniqueness for provider accounts, sender numbers, POS outlets, lock sites and review accounts (EC-INT-046,
  EC-COM-035, EC-RST-037, EC-ACS-035, EC-CRM-033).

## 5. Failure-class sweep record (playbook v2, PR2-2)

Classes from `docs/quality/patterns.md` groups A–D (AP-01 … AP-48). **Applied** = new edge-case rows added (the
class is in brackets in the row). **Covered** = an earlier row already states the behaviour. **N/A** = does not
apply, with the reason. "Code-structure probe" means the class has no guest- or staff-visible behaviour to state as
an edge case (enum duplication, port type drift); it is left to the steward's sweep (SR2-1) and the builder
self-check.

| Module | Applied (new rows) | Covered by earlier rows | N/A (reason) |
|---|---|---|---|
| operations | AP-01 EC-OPS-049 · AP-02 050 · AP-05/45 051 · AP-06 052 · AP-10 053 · AP-16 054 · AP-17 055 · AP-19 056 · AP-25/48 057 · AP-30 058 · AP-31 059 · AP-32 060 · AP-33 061 · AP-35 062 · AP-36 063 · AP-38 064 · AP-39 065 · AP-40/41 066 · AP-42 067 · AP-43 068 · AP-44 069 · AP-46 070 | AP-04 EC-OPS-006 (device clock) · AP-21 005, 009 · AP-26 026 · AP-29 008, 010, 011, 034 · AP-34 026 (forwards go through integration) | AP-03 no externally claimable id (PMS refs come through integration mappings) · AP-07–09, 11–13 identity-owned credential classes, enforced centrally · AP-14 no outbound URLs (photos are object refs) · AP-15 issues no secrets · AP-18 shows only the stay's label at its own property · AP-20, 22–24, 27, 28 posts no money (minibar moves to guest-services, SCR-32) · AP-37 no external calls · AP-47 no third party can put a unit or task into a refused state |
| guests | AP-01/45 EC-GUE-038 · AP-02 039 · AP-04 040 · AP-05 041 · AP-06 042 · AP-08 043 · AP-15 044 · AP-18 045 · AP-19 046 · AP-29 047 · AP-31 048 · AP-35 049 · AP-38 050 · AP-39 051 · AP-40/43 052 · AP-44 053 · AP-46 054 | AP-17 EC-GUE-014 (+ PAR-GUE-056) · AP-21 033 · AP-36 004 · AP-48 035 | AP-03 external profile ids are scoped to one connection in one tenant (routing is integration's, EC-INT-046) · AP-07, 09–13 identity · AP-14 no outbound calls · AP-16 no client of its own · AP-20, 22–28 holds no money (revenue is a labelled projection) · AP-30, 32 consumes no events yet · AP-33, 34 no offline writes or outbound commands · AP-37 no external effects · AP-41 fakes noted under AP-51 (S15) · AP-42 code-structure probe · AP-47 only staff with permission set legal holds or dismissals |
| integration | AP-02 EC-INT-045 · AP-03 046 · AP-04 047 · AP-05 048 · AP-06 049 · AP-10 050 · AP-15 051 · AP-19 052 · AP-24 053 · AP-29 054 · AP-32 055 · AP-35 056 · AP-37 057 · AP-40/41 058 · AP-44 059 | AP-01 EC-INT-029 · AP-09 019 · AP-14 024 · AP-17 038, 039 · AP-21 010, 014 · AP-26 010, 013 · AP-30 028 · AP-31 002, 003 · AP-34 012, 043 · AP-36 003 · AP-38 019, 020 · AP-39 027 · AP-45 012, 013 · AP-46 019 · AP-47 018 | AP-07, 08, 11–13 identity · AP-16 no client · AP-18 rows carry no sharing-scoped profile data (property filtering is AP-01) · AP-20, 22, 23, 25, 27, 28 moves no money itself (forwarded commands use business keys, AP-21) · AP-33 no offline writes · AP-42 code-structure probe · AP-43 public events are thin ids; partners fetch details through the API · AP-48 no effective-dated rule packs; currencies never converted |
| identity | AP-01 EC-IDN-035 · AP-02 036 · AP-03 037 · AP-05 038 · AP-08/36 039 · AP-09 040 · AP-13 041 · AP-14 042 · AP-15 043 · AP-17 044 · AP-19 045 · AP-35 046 · AP-37 047 · AP-39 048 · AP-44 049 · AP-47 050 | AP-04 EC-IDN-011 · AP-06 PAR-IDN-019 · AP-07 008 · AP-08 009, 010 · AP-10 034 · AP-11 014 · AP-12 013 · AP-29 019, 022, 023 · AP-36 012, 013 · AP-45 033 · AP-46 010 · AP-48 023 | AP-16 client caches are `apps/backoffice` (session switch is EC-IDN-028) · AP-18 no sharing settings · AP-20–28 no money · AP-30–34 consumes no events; no offline or outbound commands · AP-38 owns no governed domain · AP-40–43 kernel `Actor` lacks an operator kind (FR-1): contract issue, code-structure probe |
| comms | AP-01 EC-COM-033 · AP-02 034 · AP-03 035 · AP-04 036 · AP-14 037 · AP-17 038 · AP-18 039 · AP-19 040 · AP-29 041 · AP-31/43 042 · AP-34/46 043 · AP-25/36 044 · AP-37 045 · AP-38 046 · AP-39 047 · AP-44 048 · AP-48 049 | AP-21 EC-COM-004 · AP-26 006 · AP-32 020 · AP-35 029 · AP-05/06 033 (plus the platform catalogue test once composed) | AP-07–13 identity · AP-15 channel credentials live in integration (INT-R08) · AP-16 portal chat on shared devices is guest-experience (EC-GXP-018) · AP-20, 22–24, 27, 28 no money (payment requests via payments) · AP-33 no offline writes · AP-40–42 code-structure probes once built · AP-45 single send path through adapters · AP-47 unsubscribe and suppression belong to crm (EC-CRM-034) |
| resort | AP-01 EC-RST-035 · AP-02 036 · AP-03 037 · AP-04 038 · AP-16 061 · AP-17 039 · AP-19 040 · AP-20 041 · AP-21 042 · AP-22 043 · AP-23 044 · AP-24 045 · AP-25 046 · AP-26 047 · AP-28 048 · AP-29 049 · AP-31 050 · AP-34 051 · AP-35 052 · AP-36 053 · AP-37 054 · AP-39 055 · AP-41 056 · AP-44 057 · AP-45 058 · AP-46 059 · AP-48 060 | AP-29 EC-RST-002 · AP-32 021 · AP-33 023 · AP-38 028 | AP-05, 06 generic route and catalogue probes once built · AP-07–13 identity · AP-14 operator APIs via integration's safe-fetch · AP-15 holds no secrets · AP-18 itineraries are per stay at its property · AP-27 settlement reconciliation is payments/concessions · AP-30 outbox framework once built · AP-40, 42, 43 code-structure probes · AP-47 waitlists are first-come with expiry (EC-RST-049) |
| access | AP-01 EC-ACS-033 · AP-02 034 · AP-03 035 · AP-04 036 · AP-12 037 · AP-17 038 · AP-19 039 · AP-29 040, 041 · AP-31 042 · AP-32 043 · AP-35 044 · AP-37/46 045 · AP-41 046 · AP-45 047 · AP-47 048 | AP-15 EC-ACS-032 · AP-21 001, 012, 022 · AP-26 001, 016 · AP-34 002 · AP-36 022 · AP-38 023, 024 · AP-44 017, 018 | AP-05, 06 once built · AP-07–11, 13 identity (staff credentials are a non-goal) · AP-14 connectors via integration · AP-16 kiosk is guest-experience · AP-18 no shared data · AP-20, 22–25, 27, 28 only money is the lost-key charge with a business key (AP-21) · AP-30 outbox framework · AP-33 manual key log is online · AP-39 one operation per idempotency key · AP-40, 42, 43 code-structure · AP-48 no effective-dated rules |
| guest-experience | AP-01 EC-GXP-033 · AP-02 034 · AP-04 036 · AP-08 035 · AP-12/13 037 · AP-15 038 · AP-17 039 · AP-19 040 · AP-21 041 · AP-22 042 · AP-24 043 · AP-28 044 · AP-29 045 · AP-31 046 · AP-33 047 · AP-35 048 · AP-38 049 · AP-39 055 · AP-44 050 · AP-45 051 · AP-46 052 · AP-47 053 · AP-48 054 | AP-16 EC-GXP-018 (+ PAR-GXP-047) · AP-18 008 · AP-20 006 · AP-26 001, 031 | AP-03 no guest accounts yet; links are signed tokens · AP-05, 06 once built · AP-07, 09–11 staff identity · AP-14 ID vendor via integration · AP-23, 25, 27 money handled by payments/finance · AP-30, 32, 34 no own consumers or outbound commands · AP-36, 37 commands and effects run in the owning modules · AP-40–43 code-structure |
| crm | AP-01/18 EC-CRM-031 · AP-02 032 · AP-03 033 · AP-04/47 034 · AP-15 035 · AP-19 036 · AP-22 051 · AP-23 037 · AP-24/48 038 · AP-25 039 · AP-26 040 · AP-29 041 · AP-31 042 · AP-34 043 · AP-35 044 · AP-37 045 · AP-38 046 · AP-39 047 · AP-44 048 · AP-46 049 · AP-48 050 | AP-12 EC-CRM-023 · AP-17 027 · AP-20, 21, 28 020 | AP-05, 06 once built · AP-07–11, 13 identity · AP-14 review sources via integration · AP-16 no client of its own · AP-27 voucher settlement in payments · AP-30, 32 outbox framework · AP-33 no offline · AP-36 voucher balances live in finance (CRM-I04) · AP-40–43 code-structure · AP-45 single send path through comms |
| ai | AP-01 EC-AI-021 · AP-02 022 · AP-04 023 · AP-05 024 · AP-10/11 025 · AP-14 026 · AP-15 027 · AP-17 028 · AP-18 029 · AP-19 030 · AP-21 031 · AP-25/36 032 · AP-26 033 · AP-29 034 · AP-35 035 · AP-37 036 · AP-38 037 · AP-45 038 · AP-47 039 | AP-06 platform catalogue test once composed · AP-34 EC-AI-007 (re-preview on change, never replayed) | AP-03 no external identifiers · AP-07–09, 12, 13 identity · AP-16 assistant panel lives in the apps (apps AP-16 probe) · AP-20, 22–24, 27, 28 money only through module commands with their own guards · AP-30–33 consumes only the usage-threshold event; no offline · AP-39–44, 46, 48 proposals execute through module commands, which own atomicity and validation |

## 6. Top 10 gaps against competitors (this cluster)

1. **Seaplane transit-night planning** — P0 for the Maldives and solved by nobody; the resort spec lacks it
   (PAR-RST-019, EC-RST-002; journey SCR-34 not applied).
2. **Housekeeping next to an external PMS is not a closed loop** — OPERA/Mews interfaces push room status both ways;
   ours forwards and refuses honestly but the round trip and inbound stays contract are not built (PAR-OPS-086,
   EC-OPS-026/027).
3. **Comms safety and basics missing from the spec** — WhatsApp 24-hour window, signed guest links, unresolved
   variables, card/passport detection in chat (PAR-COM-019/020/047/054) — table stakes at Mews, Guesty, Duve.
4. **Housekeeping depth vs OPERA and Stayntouch** — bulk condition change, paper task sheets, per-stay cleaning time
   and turndown, vacant decay, trade-based work orders, bulk OOO by jetty, public-area rounds
   (PAR-OPS-006/012/018/019/035/049/065/068).
5. **Enterprise identity not on `main`** — MFA, SSO/SCIM, custom roles and support access sit on a branch with two
   open P1s; department scope, generic approvals, who-can-do-what report and per-user activity search are unbuilt
   (PAR-IDN-024/029/030/051) vs OPERA Role Manager and Changes Log, Mews free SSO.
6. **Room-ready notification, advance and automatic check-in** — OPERA queue and auto check-in, Mews portal
   (PAR-GXP-021/022 = PAR-OPS-032).
7. **Guest-profile enterprise features** — protected and incognito profiles, attachments, custom fields,
   configurable match rules, company sub-types and production statistics, merge and anonymization pre-checks
   (PAR-GUE-010/011/020/021/030/035/039/042/057) vs OPERA Client Relations.
8. **Integration platform for partners** — sandbox and certification path, published rate limits and deprecation
   policy, scheduled SFTP exports, legacy FIAS-style interfaces through the on-site agent, async bulk extraction
   (PAR-INT-038/039/058/060/068/070) vs OHIP, Mews, Apaleo, SiteMinder SMX.
9. **Resort leisure depth** — diving records, kids club, spa and activity utilisation, airport meet and greet
   (PAR-RST-021/033/034/045) vs OPERA 26.4 Leisure Management and Agilysys.
10. **AI parity on price and analytics** — competitors bundle assistive AI free (Oracle, Lighthouse) and pilot
    natural-language analytics (Cloudbeds Ask Signals); our spec meters AI and has no governed NL analytics
    (PAR-AI-012, PAR-AI-029).

Not a competitor feature but a **P0 safety gap found by the sweep**: no spec in this cluster says how an
environment change mid-operation (AP-19) or a claimable external identifier (AP-03) is handled (§4 cross-cutting).

## 7. Ten "beat the market" opportunities

1. **Honest key ending per lock capability** — every screen says *how* a key ends (cancelled, expires at,
   invalidated by the next guest, collect); competitors present "deactivated" as one action (ACS-R03).
2. **One itinerary with disruption cascades and one guest message** — beyond OPERA scheduling and Agilysys itinerary
   views (RST-R06, RST-R10).
3. **Seaplane-aware arrivals** — transit-night plans, cut-offs and readiness from flight data (SCR-34), unique to
   island resorts.
4. **Reversible merge with exact unmerge** — tested on `main`; OPERA's merge is irreversible and Stayntouch lacks one.
5. **No blind replay and "pending verification" everywhere** — tested in integration; vendors still double-post after
   outages (R03 §6.3).
6. **Offline-first housekeeping with explicit conflicts** — server side tested; Mews and Stayntouch mobile apps are
   online-first.
7. **Automations that re-evaluate after booking changes, with a sender register** — fixes Guesty's documented gap
   and the coexistence problem during adoption.
8. **Self-serve webhooks with replay and an honest catalogue** — tested; Mews registration is support-gated and
   catalogues elsewhere list logos, not workflows.
9. **Guest portal with staff-grade truthfulness and an assisted jetty mode** — nothing shown paid, ready or confirmed
   before it is; check-in where Maldives guests actually arrive.
10. **AI that cites, proposes through previews and never acts alone** — the trust model competitors are only
    announcing; an MCP server with dry-run for money tools later (INT-R28).

## 8. Proposed owner questions (numbers to be assigned by the orchestrator)

- **SSO and SCIM in every edition?** Mews made SSO free in 2025; our editions gate `identity.sso`/`identity.scim`.
  Default: keep MFA ungated and SSO gated; revisit at pricing (PAR-IDN-038).
- **AI assistant included in every edition?** Oracle and Lighthouse bundle assistive AI; our spec meters it.
  Default: metered with a small included allowance (Q45; PAR-AI-029).
- **Which consent state wins on profile merge** — the most recent statement (current code) or the most restrictive
  until fresh consent? Default proposed: most restrictive. Needs privacy advice (EC-GUE-006).
- Migration and archive pricing is already **Q143** (PAR-INT-083 cites it).
