# Agent run: Product strategy and capability catalog

- Started: 2026-11-07T07:07:25.247Z · last activity: 2026-11-07T07:52:27.413Z
- Turns: 62 · tool uses: 85 · output tokens: 275,074
- Type: general-purpose

## Brief (2026-11-07T07:07:25.247Z)

````text
You are the Product Strategy lead for "Portico" (working name), a cloud hospitality management platform by Monoclay. Goal: OPERA Cloud's operational depth with the clarity of the best modern systems, for every segment from 6-room Maldivian guesthouses to 400-villa resorts and multi-property groups. First market: Maldives.

WORK ONLY in the git worktree /home/user/wt/product (branch `docs/product-strategy`). Commit there with Conventional Commit messages ending with exactly these trailer lines:
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XDtqZDkxkzHxUrbV9kDsKR
Do NOT push. Only create/edit files under docs/product/ (do not modify brief.md, operational-readiness-brief.md, decisions.md or glossary.md — if the glossary needs a term, list proposed additions in your final reply) and docs/specs/. You may append questions to docs/OPEN_QUESTIONS.md using its template, numbering from Q40 upward.

READ FIRST: CLAUDE.md, docs/product/brief.md, docs/product/operational-readiness-brief.md, docs/product/decisions.md, docs/product/glossary.md (use ONLY these terms), docs/architecture/domain-map.md (module catalog and contracts), and all four research reports in docs/research/ (01 enterprise vendors, 02 modern cloud vendors, 03 SMB/distribution vendors, 04 connectivity/payments/compliance). These are long — read them fully; they are your raw material.

PRODUCE:
1. docs/product/competitive-synthesis.md — for each competitor (OPERA Cloud, Mews, Cloudbeds, SiteMinder, Apaleo, Stayntouch, Shiji Daylight, Agilysys, Infor HMS, Guesty, RMS, RoomRaccoon, + notable others): their real competitive advantage, what they do right, where they fail (review themes), and exactly what Portico takes from them and how we do it better. Then "The Portico synthesis": the 10–15 differentiators that form our competitive advantage ("complicated operations with less effort, fewer mistakes, better visibility, more confidence"), each traceable to evidence. Flag legal caution items (e.g. research 01 mentions an Agilysys patent application on ranked folio routing — note it needs legal review before we design billing-rule precedence; do not give legal conclusions).
2. docs/product/editions.md — packaging so small and large customers can be priced differently: proposed editions (e.g. Essentials for guesthouses/small hotels, Professional for full-service hotels, Resort, Enterprise/portfolio) as a feature-and-limit matrix keyed by stable entitlement keys (e.g. `groups.blocks`, `resort.transfers`, `portfolio.policies`, `api.public`, `limits.properties`, `limits.units`). Plus property profiles (guesthouse, boutique hotel, full-service hotel, resort, serviced apartments, hostel) that drive progressive disclosure and sensible defaults — what each profile turns on/hides by default. NO prices (commercial decision is the owner's; Q3 in OPEN_QUESTIONS). Note add-ons.
3. docs/product/personas-and-workspaces.md — role personas (front desk agent, night auditor, reservations agent, revenue manager, housekeeping attendant & supervisor, engineer, F&B/outlet cashier, spa/activities coordinator, transfer coordinator (seaplane/speedboat), sales & events manager, finance/AR clerk, general manager, group/portfolio director, guest-relations, IT admin; guesthouse owner who does everything) with their top tasks, frequency, devices, pain points from research, and the role-based workspace (home screen) each gets.
4. docs/product/ux-principles.md — Portico's design language & interaction standards: information hierarchy, state badges (confirmed / pending / estimate / suggestion / external / simulated), status vocabulary separation (booking vs occupancy vs condition vs availability vs payment), change previews, error message standard (problem + recovery), keyboard model and command palette, global search, saved views, tables/calendars/timeline (the "timeline" as primary reservation view), concurrency UX (409 conflict handling), offline/stale data UX, touch targets for mobile staff, accessibility (WCAG 2.2 AA), i18n/RTL, usability targets clearly labeled as TARGETS with how they'll be validated (task completion time, errors, navigation, help points).
5. docs/specs/ — one spec per module in the domain map for waves 1–3: platform, identity, inventory, rates, guests, reservations, finance, payments, operations, day-close, distribution, groups, comms, resort, analytics, integration, ai, billing. Each spec: purpose; scope & non-goals; capabilities (numbered requirements, each tagged MUST/SHOULD/LATER and with the edition/entitlement key where applicable); key entities & states (state machines with allowed transitions); invariants (things that must always be true — be precise, these become tests); cross-module interactions (consistent with domain-map.md contracts; if you think a contract must change, write it under "Proposed contract changes" rather than silently diverging); events emitted/consumed; permissions (keys `<module>.<resource>.<action>`); UX surfaces; which of the 20 operational proof scenarios (brief §17) and which readiness-brief §19 evidence items it participates in and what the module must demonstrate for each; Maldives specifics; competitive inspirations (cite research doc); open questions. Specs for wave-1 modules (platform, identity, inventory, rates, guests, reservations, finance, payments, operations) must be the most detailed — engineers will build from them in parallel shortly, so WRITE AND COMMIT THOSE NINE FIRST (commit after each few), then the rest.
6. docs/scenarios/README.md — the 20 proof scenarios + readiness-brief §19 evidence items, each with: preconditions, steps (user experience), expected resulting state, financial effects, inventory effects, audit history, recovery behavior, the modules involved, and the automated test name it should map to (e.g. `scenarios/s01-last-room.test.ts`).

Use original Portico terminology (glossary) — never adopt competitor product names for our features. Write for engineers and the founder: precise, testable, no fluff. Your final reply: ~300 words with the key differentiators, the edition structure, any glossary additions you propose, the files created, and questions added. Do not ask me questions.
````

## Follow-up message (2026-11-07T07:52:18.073Z)

````text
[handback-send-enforce] Your report has not been delivered. Call SubagentHandback({message: <your full report>}) now; the call ends your run.
````

## Report (2026-11-07T07:52:27.181Z)

````text
Done. Everything is committed on `docs/product-strategy` in `/home/user/wt/product`: 13 commits with the required trailers, nothing pushed, working tree clean. The worktree branches from `f65dff9`, which is older than main.

**Your mid-task update is incorporated.** The platform and identity specs now match the code on main: global users with memberships, property status `setup → pilot → active → inactive`, the `trial` environment, the kernel's effect rules, and data authority via `assertWritable`. Every spec ends with a §14 "Adoption modes" section. `integration.md` was written right after the nine wave-1 specs, with migration marked as wave 2.

**Key differentiators (15, each traced to research evidence):**
- OPERA-level depth that a new agent can learn in one shift.
- Labels that show whether data is confirmed, pending, estimated, a suggestion, from another system, stale, copied or simulated.
- A preview before any consequential change.
- Real-time double-entry ledger.
- An end-of-day close that never logs anyone out and always resumes.
- Payments that cannot double-charge: each scheduled collection has exactly one owner.
- Channel sync that staff can see and recover.
- Exact availability for connecting rooms, multi-bedroom villas and dorm beds.
- Adoption as a ramp: demo → trial → read-only connection → one module → pilot → full platform.
- Integrations described workflow by workflow.
- Resort itinerary covering transfers, dining and activities.
- Portfolio policies with visible local overrides.
- A mobile staff app that is honest when offline.
- Built-in reporting with definitions and drill-down.
- Fair packaging.

**Editions:** Essentials, Professional, Resort, Enterprise, plus a proposed Connect plan that sells modules as packs to hotels keeping their PMS. Property profiles control what each property sees by default. No prices are given (Q3). `editions.md` §7 lists recommended changes to the already-implemented `plans.ts`:
- Include receivables, message automation and the public API in Essentials.
- Make the AI assistant a metered add-on.
- Remove the staff-user limit (it pushes hotels to share logins).

**Legal caution:** Agilysys's patent application on ranked folio routing (US 2017/0124610) needs counsel's review. Until then, finance billing rules have no ranking; overlapping rules are rejected instead (Q40). I give no legal conclusion.

**Proposed glossary additions:** Workspace, Exception, Certainty/Provenance markers, Data authority, Connected mode, Mirror, Forwarding, Trial, Pilot scope, Payment schedule, Collection plan, Relocation, Unit block, Breakage, Service date, Revenue date, Supplementary folio, Resource, Saved view, Timeline, Command palette, Connect plan/Pack. Also add `boutique_hotel` as a profile and state that `hotel` means full-service hotel.

**Questions added:** Q40–Q47 (billing-rule precedence and the patent; Maldives tax details; which tax applies when tax law changes after booking; Maldives guest registration; retention periods; how usage costs reach hotels; cross-property profile sharing; tax on Monoclay's own invoices). These don't collide with main's Q20–26 and Q60–64, but both branches appended to the end of the file, so expect a small merge conflict there.

Files are in `/home/user/wt/product/docs`:
- `product/`: `competitive-synthesis.md`, `editions.md`, `personas-and-workspaces.md`, `ux-principles.md`
- `specs/`: `README.md` plus 18 module specs
- `scenarios/README.md`: S01–S20, E01–E15, A01–A07, each mapped to a test file name
````

