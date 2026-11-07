# Round 1 refinements — Guests

Scope: the guest profile, how guests are found and matched, VIP/alerts, and identity details at check-in. Personas P1
(find a past guest by partial name) and P2 (phone-number lookup, guest record). Search ranking and coverage are in
`search-navigation-shell.md` NAV-03. Citation keys, categories and the power-check rule are defined at the top of
`front-desk.md`. Outcomes are **TARGETS** until validated with hotel staff.

The guests module is on main (profiles, contact points with verification, preferences, alerts, notes, relationships,
documents with audited reveal, duplicates, merge/unmerge, companies, privacy) and its search provider already covers
names in any script, email and phone (`modules/guests/src/search-provider.ts`).

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| GST-01 | A guest found in search opens a guest record | (a) | guests | blocker |
| GST-02 | A guest profile that answers the desk's questions | (a) | guests | major |
| GST-03 | VIP and alerts on every header that concerns the guest | (c) | guests | minor |
| GST-04 | "Is this the same guest?" while typing | (a) | guests | major |
| GST-05 | Identity details captured once, at the right step | (a) | guests | major |

---

### GST-01 · A guest found in search opens a guest record

**Category** (a) — record type `guest_profile` (`GET /v1/guests/profiles/:id`, history via
`/v1/records/guest_profile/:id/history`) · **Owner** guests (+ backoffice record registry) · **Priority** blocker
(a dead click on the most-used search)
**Evidence** P2 › Search: "Selecting a live guest-profile result such as 'Anna Smirnova' **does nothing**: the palette
closes and no record opens"; T8 · `[screens/p2-08-live-guest.jpg]` `[screens/p2-09-live-guest-click.jpg]`

**Root cause.** The guests search provider returns `type: 'guest_profile'`; the UI registry knows only a simulated
`guest` type, so `definitionFor('guest_profile')` is undefined and `openRecord` in
`apps/backoffice/src/app/shell/global-palette.tsx` silently returns (branch `feat/backoffice-core`).

**Proposed change.** Register `guest_profile` and `company` record definitions bound to the guests API; point the stay
record's guest link at the real profile once reservations links stays to profiles; plus the shell rule NAV-04 (any
result without a specialised view opens the generic record view — never nothing).

**Expected outcome (targets).** 100 % of search results open a record (baseline: guest results 0 %).

**Power check.** Fix only.

---

### GST-02 · A guest profile that answers the desk's questions

**Category** (a) — profile, contact points (+ verify), preferences, alerts, notes, relationships, documents, history,
recognition · **Owner** guests · **Priority** major
**Evidence** P2: "The guest record holds only name and VIP; 'Edit — Available when the guests module is connected'";
phone queries "+960" and "7712" return nothing because the record has no phone · `[screens/p2-06-guest.jpg]`

**Proposed change.** The profile follows guests spec §9 inside the universal record:
- **Header**: name (native script + Latin), VIP level, critical alerts (allergy, accessibility) as chips, consent chips,
  "merged from" indicator.
- **Overview**: contact points with a *verified* marker (on a phone: tap to call, tap to open WhatsApp); **Stays** —
  in house, upcoming and past, each a link with dates and villa; preferences; notes.
- Tabs: **History** (stays, requests, messages, spend), **Companies & relationships**, **Documents** (permission-gated;
  every reveal is audited), **Privacy**.
- **Edit** inline per section (`e`), with the existing 409 conflict flow (B10).

**Expected outcome (targets).** A guest's phone number in 1 click from any stay; "has this guest stayed before?"
answered on the profile header.

**Power check.** Everything in guests §9; sensitive data stays permission-gated and audited.

---

### GST-03 · VIP and alerts on every header that concerns the guest

**Category** (c) · **Owner** guests (alerts, VIP) + reservations (stay header) + packages/ui · **Priority** minor
**Evidence** P2 › Failed inspection: "The VIP tag is on the list row but **not on the stay record header**" ·
`[screens/p2-05-emma.jpg]`

**Proposed change.** Every record that concerns a guest (stay, booking, bill, task for their villa) shows the same guest
flags after the name, identical to list rows: VIP level, Honeymoon / Family, Repeat guest (n stays), Allergy. Critical
alerts also appear as an issue line in the check-in sheet.

**Expected outcome (targets).** Flags identical between list rows and record headers (UI test).

**Power check.** Adds.

---

### GST-04 · "Is this the same guest?" while typing

**Category** (a) — `resolveProfile`, `/guests/search`, `/guests/duplicates`, merge preview and unmerge ·
**Owner** guests · **Priority** major
**Evidence** P1 › Past guest by partial name: "'lukas' → only 'Lukas Müller', a profile not linked to any stay";
persona ask "Make search find anyone who ever stayed, by name, phone or email"

**Proposed change.**
- In the walk-in and new-booking guest fields: match-as-you-type, each candidate showing name, last stay ("Nov 2025 ·
  Villa 130"), country and the phone's last digits ("…7712"). Pick → linked; **New guest** if none.
- When a likely duplicate is created anyway: a non-blocking chip "Possible duplicate of Lukas Becker (2 stays)" →
  duplicate queue with merge preview; unmerge stays one action away (vision moment "Mistaken profile merge").

**Expected outcome (targets).** Duplicate profiles created at the desk ≤ 1 % of new profiles.

**Power check.** Never auto-merges; merge/unmerge with previews preserved (guests §3.3).

---

### GST-05 · Identity details captured once, at the right step

**Category** (a) — guests documents (field-encrypted, audited reveal), the check-in `registration` step · **Owner**
guests (+ reservations) · **Priority** major
**Evidence** P1 › Check in ("no ID, no registration card, no signature"); P2: Sara Lindqvist blocked by "Passport
details missing" · `[screens/p2-13-arrivals-full.jpg]`

**Proposed change.**
- The registration step shows what is already on file ("Passport ••••4821, expires 2029 — received at pre-arrival")
  and asks only for missing fields that property policy requires.
- Capture by typing now; document scan/OCR and e-signature on a registration card are (b) follow-ups
  (guest-experience digital registration).
- Never ask twice (WCAG 3.3.7, brief "guests should not repeatedly enter information").

**Expected outcome (targets).** 0 repeated entry; registration step ≤ 30 s when details are missing.

**Power check.** Compliance data captured; reveal permissions and encryption unchanged.
