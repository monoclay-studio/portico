# Round 1 refinements — Connections and integration

Scope: connecting an existing system, the setup journey, data authority (system of record), connection health and
developer tools. Persona P8 (IT administrator). The adoption brief makes integration and migration core capabilities
"with the same importance as reservations and finance", so this area gets its own file. Citation keys, categories and
the power-check rule are defined at the top of `front-desk.md`. Outcomes are **TARGETS** until validated with hotel
staff.

The integration module merged today (catalogue, connections, compatibility preview, authorize, mapping suggestions
and review, validation runs, activation preview, lifecycle, health, exceptions, webhooks, PMS simulator —
`modules/integration/README.md`). The UI has no Connections area at all, so these are **(a) wiring** with the design
defined here.

| ID | Refinement | Cat | Owner | Priority |
|---|---|---|---|---|
| INT-01 | Settings › Connections: a catalogue of workflows, read-only first | (a) | integration | blocker |
| INT-02 | A setup journey you can leave and resume | (a) | integration | major |
| INT-03 | Data authority you can see and change safely | (a) | platform | major |
| INT-04 | Connection health and exceptions where people work | (a) | integration | major |
| INT-05 | Developer tools for the IT administrator | (a) | integration | minor |

---

### INT-01 · Settings › Connections: a catalogue of workflows, read-only first

**Category** (a) — `/v1/integration/catalogue`, `/integration/connections` (+ lifecycle), PMS simulator ·
**Owner** integration · **Priority** blocker
**Evidence** P8 — **No**: "Settings has only Organization / Properties / Legal entities / Users & roles. There is no
Integrations, Connections, API keys, webhooks or data-authority screen. Search for 'connect' and 'integration' returns
nothing. `/integrations` returns 'Page not found'"; "This contradicts the 'connect alongside your current system'
positioning"; T7 · `[screens/p7-03-settings-org.jpg]`; `x-05-404.png` (cited by the findings; not in `screens/`)

**Proposed change.**
- **Settings › Connections** (and an Admin workspace entry for the IT role; palette synonyms per NAV-01).
- **Catalogue** by kind: PMS, channel manager, POS, accounting, door locks, payments. Each card describes the
  connection as **workflows**, not a logo: "Reads reservations every 5 min · Creates nothing · Receives changes
  live", with costs, prerequisites (e.g. "the hotel's OPERA admin must approve access") and its honest readiness level
  ("Simulator only", "Sandbox-tested") — no partner logos or certification claims without evidence (CLAUDE.md §7).
- Primary call to action: **Connect read-only** (the adoption ramp's first step); write modes under "More options".
- Existing connections list: state, last sync, health dot, owner.

**Expected outcome (targets).** First read-only connection (simulator PMS) by hotel staff in ≤ 30 min and ≤ 2 help
requests (ux §19). Baseline: impossible (404).

**Power check.** Exposes the full lifecycle (pause, resume, replace, rotate credentials, disconnect with lifecycle
preview); nothing removed.

---

### INT-02 · A setup journey you can leave and resume

**Category** (a) — compatibility preview, authorize, mapping suggest/review, validation runs, activation preview,
activate · **Owner** integration · **Priority** major
**Evidence** P8; vision pillar 3 ("Setup is a guided journey ordinary staff can complete, with suggested mappings and a
preview of behavior before activation")

**Proposed change.** A stepper with saved progress and an owner per step (Journey page type, ux §2):
1. **System and property.**
2. **Authorize** — credentials stored as secrets and never shown again.
3. **Compatibility** — what is supported, in workflows.
4. **Mappings** — suggestions with confidence chips; **bulk-accept** high-confidence non-financial items; "Needs finance
   review" badges on charge codes and tax mappings.
5. **Test run** — a validation run on a sample of real records with differences explained ("3 reservations have a
   rate code Portico doesn't know").
6. **Activation preview** — "Portico will read 412 future reservations from OPERA. Nothing will be written to OPERA."
   → **Activate**.
Errors in plain language with impact, responsible party and next step — never raw payloads for hotel staff; the
exchange log (redacted, permission-gated) is for technical users.

**Expected outcome (targets).** A hotel IT person completes steps 1–6 unaided (validate in a later round).

**Power check.** Technical detail stays available to permitted users; nothing hidden from IT.

---

### INT-03 · Data authority you can see and change safely

**Category** (a) — platform service has `listDataAuthority`, `getDataAuthority`, `setDataAuthority`
(`modules/platform/src/service.ts`); **an HTTP route is needed** · **Owner** platform (+ integration) · **Priority**
major
**Evidence** P8 ("no … data-authority screen"); CLAUDE.md §4 rule 15

**Proposed change.**
- A matrix: domains (Reservations, Availability, Rates, Guest profiles, Charges, Payments, Room status, Maintenance,
  Accounting) × the authoritative system (Portico / a named connection), write mode (read-only / forward), health
  dot, last sync.
- **Change** → preview: "If Room status moves to Portico: housekeeping updates are no longer forwarded to OPERA; the
  front desk reads Portico's status" → Confirm (permission-gated, audited).
- Records from an external authority carry the **External** marker with system and last-sync time (ux §3).

**Expected outcome (targets).** "Who owns room status here?" answered in 1 click.

**Power check.** Enforcement (`assertWritable`) is unchanged; the preview is mandatory (ux §5: data-authority changes).

---

### INT-04 · Connection health and exceptions where people work

**Category** (a) — `/integration/health`, `/connections/:id/health`, `/integration/exceptions` (+ assign, resolve,
ignore), `/integration/my-work`, outbound revalidate, webhook replay · **Owner** integration · **Priority** major
**Evidence** P8; vision moment "Channel outage at peak: a plain banner: what is stale, since when, which bookings may be
affected, what to do now"

**Proposed change.**
- Connection page: per-workflow health tiles (Healthy · Delayed · Degraded · Failing · Paused, with "since"), a delay
  timeline, recovery buttons (Retry, Revalidate, Replay).
- Integration exceptions go to the owners' **My work**.
- A property-level banner when a system of record is failing: "Room status from OPERA is 12 min old — changes may be
  missing. What to do: …" with affected values marked *Delayed* (ux §11).

**Expected outcome (targets).** A failing connection noticed within 1 min by the people it affects.

**Power check.** Adds; nothing ever shows as synced while failing.

---

### INT-05 · Developer tools for the IT administrator

**Category** (a) for webhooks (`/integration/webhooks/subscriptions` + test, deliveries, replay, secret rotation);
API clients/keys are (b) (identity §3.3 machine identities not built) · **Owner** integration (+ identity) ·
**Priority** minor
**Evidence** P8 ("no … API keys, webhooks")

**Proposed change.** **Connections › Developer**: webhook subscriptions (event types, **Send test**, delivery log with
**Replay**, secret rotation); API clients with scopes and consent once identity provides them; a link to the API
documentation.

**Expected outcome (targets).** Create and test a webhook in ≤ 3 min.

**Power check.** Adds; secrets are never displayed after creation.
