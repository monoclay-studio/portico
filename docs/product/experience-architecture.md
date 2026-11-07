# Experience architecture — one product, not a suite of modules

> Owner direction (2026-11-07): every module must be seamless and really easy to use; switching between modules
> must feel intuitive; the learning curve must be very easy **while remaining more powerful than OPERA**. User
> courses and tutorial videos will be published on the website later — the product must be built to support them.

Staff never think "now I am in the finance module". They think "this guest's bill", "villa 214", "tonight's
arrivals". Portico is organised around **records and work**, not around modules.

## 1. The universal record

Every primary record (booking, stay, guest, company, unit, folio, invoice, task, work order, connection,
purchase order, …) has the same anatomy, everywhere it appears:

| Part | Content | Backend contract |
|---|---|---|
| **Header** | Title, reference code, the record's **separate** status chips (e.g. booking status · occupancy · payment status), provenance badge | `GET` returns `status` per status family + `provenance` |
| **Next actions** | The 1–3 most likely actions as buttons; everything else in an actions menu. Disabled actions say **why** ("Room not inspected yet") | `allowedActions: [{ action, label, enabled, reason? }]` computed server-side with permissions |
| **Issues** | Open exceptions and blockers with owner and severity | `issues: [{ code, severity, message, owner? }]` |
| **Owner** | Responsible person/team | `owner: { kind: 'user' \| 'department', id, name }` |
| **Details** | Sections; progressive disclosure for rarely used fields | — |
| **Related** | Linked records across modules (guest ↔ stays ↔ folios ↔ requests ↔ conversations) | `links: [{ rel, type, id, title }]` |
| **History** | One timeline of what happened, by whom, why — from the audit log, across modules | `GET /v1/records/{type}/{id}/history` (foundation) |

Because the server computes `allowedActions` and `issues`, the UI, the API, integrations and the AI assistant all
see the same truth — and a new module gets a consistent screen almost for free.

## 2. Moving between modules without losing context

- **Records open in a side drawer** over the current screen (arrivals board → guest → folio → back) with a
  breadcrumb trail; `Esc` returns. "Open full page" is one key away. Nothing loses the user's filters or scroll.
- **Entity links everywhere**: any reference to a guest, unit, booking, company or invoice is a link with a hover
  preview (`summarize`), so people stop navigating to check simple facts.
- **Global search** (`/`) and **command palette** (`Ctrl/Cmd+K`) across every module, permission-aware: find
  "Aisha", "214", "BK-7K3Q9X", "late checkout", or run "move room", "post charge", "new booking" from anywhere.
  Backed by `GET /v1/search` aggregating every module's search provider.
- **One "My work" inbox**: exceptions, tasks, approvals, handover items and conversations assigned to me or my
  department — from all modules — in one prioritised list.
- **Recent and pinned records**, split view for side-by-side (e.g. two folios during a transfer), deep links that
  open exactly the same view for a colleague.
- **Same verbs, same places, same keys** in every module: *New*, *Edit*, *Move*, *Cancel*, *Post*, *Assign*,
  *Resolve*; `N` new, `E` edit, `/` search, `?` shortcuts, `G then X` go-to. One glossary (`glossary.md`).

## 3. Easy to learn, more powerful than OPERA

| For a new staff member | For an expert |
|---|---|
| Role workspace shows only today's work for that role | Keyboard-only operation, command palette, bulk select + bulk actions with preview |
| Next actions on every record — the screen tells you what to do | Saved views, custom columns, filters shareable across the team |
| Disabled actions explain why; errors explain how to recover | Automations (trigger → condition → action) with history |
| Progressive disclosure: guesthouse never sees enterprise options | Full configurability where hotel policies genuinely differ |
| Guided first-run checklist per role; contextual help on every screen | Public API, webhooks, exports for everything they can see |
| Practise safely in the **training** environment (resettable scenarios) | Portfolio views and policies across properties |

The OPERA-class depth exists; it is just never in the way. Target (to be validated with real staff, adoption
brief §14): a new front-desk agent completes check-in, room move and check-out unaided after **one shift**.

## 4. Built for courses and tutorial videos (future website)

- **Stable help anchors.** Every screen, panel and complex control carries a `helpKey`
  (`<module>.<screen>[.<element>]`, e.g. `reservations.checkIn.payment`). The help panel resolves a key to an
  article/video URL from configuration, so the website's courses and videos plug in without code changes.
- **In-app learning centre** — role learning paths (Front desk, Reservations, Housekeeping, Night audit,
  Finance, Revenue, Manager, Guesthouse owner) with progress, linking to website courses and in-product guided tours.
- **Tutorial-ready data.** The training environment has scripted, resettable scenarios (e.g. "seaplane delay",
  "last villa", "late restaurant charge") so videos and courses always show the same realistic situation.
- **Repeatable screen capture.** Playwright scripts drive the demo/training scenarios to regenerate screenshots
  (and later recordings) whenever the UI changes, so documentation never goes stale.
- **What's new.** In-product release notes per role; breaking UX changes flagged in advance for trainers.
- **Measure learning.** Training time by role and help-anchor usage feed the success metrics.

## 5. Rules for every module (enforced in review)

1. Primary records implement the universal record contract (§1) and a search provider + `summarize`.
2. No module-specific navigation patterns, icons for shared verbs, or private keyboard shortcuts.
3. Every screen has a `helpKey`; every complex control has one.
4. Lists use the shared DataTable with saved views; calendars use the shared Timeline.
5. New concepts go into the glossary first.
6. Usability evidence (task time, errors, help points) is recorded per workflow before claiming it "easy".
