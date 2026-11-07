# Round 1 refinements — Settings, identity and group administration

Scope: sign-in, staff and roles, properties, policies, portfolio view, forbidden pages and settings wording. Personas P7
(group director) and P1 (owner signing in on a phone); access hygiene from X. Connections and data authority are in
`connections-integration.md`. Citation keys, categories and the power-check rule are defined at the top of
`front-desk.md`. Outcomes are **TARGETS** until validated with hotel staff.

These screens are **live** (identity and platform on main), so the findings here are mostly **(c) design**. Two
capabilities exist in the platform *service* without an HTTP route (policies, data authority) — classified (a) with
"route needed" stated.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| SET-01 | Add staff with least privilege by default and several roles | (c) | identity | major |
| SET-02 | Sign-in on a phone without retyping everything | (c) | identity | major |
| SET-03 | Stay signed in safely: device sessions, PIN unlock, reset, invitations | (b) | identity | major |
| SET-04 | Add a property | (a) | platform | major |
| SET-05 | Policy centre: change once, see every override | (a) | platform | blocker |
| SET-06 | Compare properties at a glance | (b) | platform | major |
| SET-07 | "Not allowed" pages explain and don't tempt | (c) | identity | minor |
| SET-08 | Labels people read (roles, counts, organization chooser) | (c) | identity | minor |
| SET-09 | Editing another property says so | (c) | platform | minor |
| SET-10 | Demo settings tell the truth | (c) | platform | minor |

---

### SET-01 · Add staff with least privilege by default and several roles

**Category** (c) — the API already accepts several role/scope pairs (`createUserRequest.roles[]` in
`modules/identity/src/contracts.ts`) · **Owner** identity (+ backoffice users page) · **Priority** major
**Evidence** P7 › Invite staff member: works in ~8 clicks, ~100 keystrokes, ~90 s, but "'Applies to' defaults to
**Whole organization**, the riskiest choice; one role per invite; 'Safe to retry…' is developer copy; validation copy is
raw; 'Invite' sends nothing; the staff table shows raw role codes"; T20 · `[screens/p7-11-invite.jpg]`
`[screens/p7-12-invite-invalid.jpg]` `[screens/p7-15-invite-done.jpg]` `[screens/p7-10-users.jpg]`
**Overlaps** SR P3-4 (role names in the table), SR P3-10 (password in the request fingerprint)

**Proposed change.**
- Title **Add staff member** — honest while no email is sent (invitations are SET-03, (b)).
- **Applies to** defaults to the **current property**. "Whole organization" is an explicit choice with a caution line:
  "Can act in all 3 properties."
- **Roles** as chips, each carrying its scope ("Front desk agent · Azure Lagoon Hotel"), with **+ Add role**.
- **Access preview** under the roles, from role descriptions: "Shifa will be able to see arrivals and departures,
  check guests in and out, and take payments — at Azure Lagoon Hotel only."
- **Temporary password** with a generator and Copy, and "Share it privately"; promise a forced change only once
  identity supports it.
- Remove "Safe to retry: this form reuses one request key…" (the idempotent behaviour stays); inline validation per
  NAV-08.
- Staff table: role **names** with scope; filter by property.

**Expected outcome (targets).** Add a user limited to one property in ≤ 45 s (baseline ~90 s); 0 organization-wide
grants by default.

**Power check.** Organization-wide scope and every role template remain; several roles per person adds power.

---

### SET-02 · Sign-in on a phone without retyping everything

**Category** (c) · **Owner** identity (+ backoffice sign-in page) · **Priority** major
**Evidence** P1 › Sign-in: "The email is 55 characters long and the session 'ends when the browser closes'… the owner
retypes it every morning on a phone"; ~75 keystrokes, ~40 s; wrong-password title "Sign-in required" with a UUID
reference; no "forgot password" · `[screens/01-landing.jpg]` `[screens/p1-01-wrong-password.jpg]`

**Proposed change.**
- `type="email"`, `autocomplete="username"` and `autocomplete="current-password"` so password managers and phone
  keychains fill both fields (WCAG 3.3.8 accessible authentication; paste allowed).
- Optional **"Remember my email on this device"** — off by default; stores the email only, never a token (shared desk
  computers stay safe).
- Show/hide password toggle.
- Wrong-password copy per NAV-08 ("Email or password doesn't match"), no reference on a 401.
- Organization chooser labelled by name and environment (SET-08).

**Expected outcome (targets).** Repeat sign-in on one's own phone ≤ 10 s with the keychain (baseline ~40 s).

**Power check.** Session lifetime and security are unchanged.

---

### SET-03 · Stay signed in safely: device sessions, PIN unlock, reset, invitations

**Category** (b) — IDN-R04 shift unlock and IDN-R05 session policies are specified but not built; no reset or
invitation flow; invitation email needs comms · **Owner** identity (+ comms) · **Priority** major
**Evidence** P1 › Sign-in (no "remember this device", no "forgot password"); P7 ("'Invite' sends nothing; you set a
password yourself")

**Proposed change (design to build against).**
- **Trusted personal device** for owners and mobile staff: mobile session policy (IDN-R05, e.g. 12 h) with PIN or
  biometric unlock.
- **Shift unlock** on registered desk devices: personal PIN, large targets, staff on shift (identity §9), limited to
  permissions not marked `requiresFullAuth`.
- **Forgot password?** → email reset that revokes existing sessions.
- **Invitation email** with a set-password link and expiry, replacing the temporary password.

**Expected outcome (targets).** The owner's daily return to Portico ≤ 3 s (unlock).

**Power check.** MFA for sensitive permissions (IDN-R03) is unchanged; PIN unlock never covers money movement above
policy, user admin or exports.

---

### SET-04 · Add a property

**Category** (a) — `POST /v1/properties` exists in platform · **Owner** platform · **Priority** major
**Evidence** P7 › Add a new property — **No**: "No 'New property'; `N` does nothing; only 'New legal entity' exists" ·
`[screens/p7-04-properties.jpg]`

**Proposed change.**
- **+ Add property** (and `N` on Properties) → a short journey: name and code → type/profile (guesthouse, hotel,
  resort — this drives progressive disclosure) → country, which defaults timezone and currency → legal entity (pick or
  create) → check-in/check-out times.
- Then a **Next steps** checklist (rooms/villas and types, rates, staff, payment account) linking to each setup area
  (platform §3.11 guided setup).
- Plan limits stated before creating ("Your plan includes 3 properties; this would be the 4th") — no silent charge.

**Expected outcome (targets).** Create a property in ≤ 2 min.

**Power check.** Adds; entitlement and limit checks stay server-side.

---

### SET-05 · Policy centre: change once, see every override

**Category** (a) — platform service has `resolvePolicy`, `previewPolicyChange` and `setPolicy`
(`modules/platform/src/service.ts`); **an HTTP route is needed** · **Owner** platform · **Priority** blocker (group
director)
**Evidence** P7 › Change a policy for all properties, see overrides — **No**: "Property settings = name, type, timezone,
check-in/out time, status"; vision moment "Group policy change: the director sees which properties change, which keep
local overrides, and confirms knowingly"; T19 · `[screens/p7-06-property-record.jpg]` `[screens/p7-07-edit-property.jpg]`

**Proposed change.**
- **Settings › Policies**, grouped by area (Check-in & check-out, Cancellation defaults, Housekeeping, Payments, Day
  Close). Each row: the organization value and "2 overrides".
- Opening a policy shows a per-property table: inherited values in grey "From organization", local overrides with an
  accent "Local" badge, and **Where is this overridden?**.
- **Change for organization** → preview: "Changes at Azure Lagoon Hotel and Coral Nest; Azure Atoll Resort keeps its
  local value (14:00)" (scenario 16) → Confirm.
- Property settings show each policy with its source badge and **Reset to organization value**.

**Expected outcome (targets).** Change a group policy and know its effect in ≤ 2 min; 0 surprise overrides.

**Power check.** Local overrides are preserved (persona P14: over-centralisation frustrates local needs); permission
`platform.policy.manage`.

---

### SET-06 · Compare properties at a glance

**Category** (b) — portfolio analytics are not built; an interim view can use existing per-property endpoints (a) ·
**Owner** platform (later analytics) · **Priority** major
**Evidence** P7 › Compare the properties — **No**: "Must switch property and read each Today"; T19 ·
`[screens/p7-02-switch-property.jpg]`

**Proposed change.**
- **Interim (a)**: the property switcher lists each property with three live facts — arrivals blocked, in house,
  payments pending verification — and its business date.
- **Target (b)**: a **Portfolio** Today (personas P14): small multiples per property (occupancy, arrival readiness,
  Day Close status, exceptions by department); click → that property's view.

**Expected outcome (targets).** Compare three properties in ≤ 10 s (baseline: three switches and three reads).

**Power check.** Adds.

---

### SET-07 · "Not allowed" pages explain and don't tempt

**Category** (c) (request access is (b), identity §9 "Why can't I?") · **Owner** identity (+ shell) · **Priority** minor
**Evidence** X › Error handling: "Not allowed … (`identity.user.read`)" while the **Invite staff member** button stays
visible

**Proposed change.**
- Copy: "You can't see staff accounts. Organization administrators manage staff." + names of those admins where the
  viewer may see them + **Request access** (when built).
- Page-level create buttons are hidden when the user lacks the permission (effective permissions in `/me`,
  FOUNDATION_REQUESTS #3); the permission code appears only under "Details for IT".

**Expected outcome (targets).** 0 actionable-looking buttons on forbidden pages.

**Power check.** Strengthens permissions; no data existence leaks.

---

### SET-08 · Labels people read (roles, counts, organization chooser)

**Category** (c) · **Owner** identity (+ backoffice user menu, sign-in) · **Priority** minor
**Evidence** P7: account menu "Front desk agent, Front desk agent, Front desk agent"; Roles tab "Organization
administrator · **1 PERMISSIONS**"; organization radio buttons "announced by **UUID** to screen readers"; Pol ·
`[screens/p7-17-roles.jpg]`
**Overlaps** SR P3-4 (role keys), SR P2-15 (plurals)

**Proposed change.** Account menu groups roles: "Front desk agent · 3 properties". Counts pluralise ("1 permission").
Organization chooser options are labelled "Azure Atoll Collection — Demo". Role names everywhere a code appears today.

**Expected outcome (targets).** 0 raw ids or codes in identity screens (also covered by the NAV-09 lint).

**Power check.** n/a.

---

### SET-09 · Editing another property says so

**Category** (c) · **Owner** platform (property settings screen) · **Priority** minor
**Evidence** P7: "While editing Azure Lagoon Hotel, the header switcher still says Azure Atoll Resort"

**Proposed change.** The property settings header reads "Settings for Azure Lagoon Hotel" with the note "You're working
in Azure Atoll Resort. Changes here apply to Azure Lagoon Hotel." and **Switch to this property**.

**Expected outcome (targets).** 0 wrong-property edits in round 2.

**Power check.** n/a.

---

### SET-10 · Demo settings tell the truth

**Category** (c) · **Owner** platform (demo seed: status, system-actor label) + backoffice organization page ·
**Priority** minor
**Evidence** P7 › Properties: "All three show status **setup** and the issue 'This property is in setup — it is not yet
operating', while the resort Today shows 106 guests in house"; "History says 'Property created by **demo-seeder**'".
P8: "'What is live in this build' … wording is still developer language" · `[screens/p7-04-properties.jpg]`
`[screens/p7-06-property-record.jpg]` `[screens/p7-03-settings-org.jpg]`

**Proposed change.** Seed demo properties as `operating`; label system actors for staff ("Portico demo setup",
"Portico (automatic)"); rename the table "What's real in this demo" with rows in hotel language ("Arrivals and
check-in — sample data", "Staff and roles — real in this demo organization").

**Expected outcome (targets).** 0 contradictions between settings and operations in the demo.

**Power check.** n/a — keeps the honest provenance table the tester praised (B4), in better words.
