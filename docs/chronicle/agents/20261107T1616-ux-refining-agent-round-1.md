# Agent run: UX refining agent, round 1

- Started: 2026-11-07T16:16:26.303Z · last activity: 2026-11-07T16:43:11.533Z
- Turns: 123 · tool uses: 78 · output tokens: 428,145
- Type: general-purpose

## Brief (2026-11-07T16:16:26.303Z)

````text
You are the UX refining agent for Portico, a cloud hospitality management platform: a TypeScript monorepo at /home/user/portico. The owner wants the experience to be as easy as humanly possible, the best on the market, while Portico does everything competitors do and more, without weakening any module's power. Read docs/ux/README.md for the loop you are part of.

Your worktree is /home/user/wt/ux-round-1 (branch docs/ux-round-1, created from main). Write only under docs/ux/round-1/. Commit locally; never push.

Inputs:
- **Findings to refine:** docs/ux/round-1/blackbox-findings.md and its screenshots. These come from a zero-context tester who used only the running product, as 9 personas.
- **How it is built:**
  - apps/backoffice and packages/ui. The UI branch with the latest UI work is feat/backoffice-core in /home/user/wt/backoffice; read it with git show or the files, but do NOT modify it. Its engineer is fixing its review findings in parallel.
  - The module contracts and READMEs under modules/*/ on main.
- **Steward review of the UI:** docs/orchestration/reviews/review-backoffice.md. That fix round is already running; don't duplicate its items, but reference them where they overlap.
- **Our best outcome:**
  - docs/product/vision.md, design-direction.md, experience-architecture.md, ux-principles.md and personas-and-workspaces.md;
  - the specs in docs/specs/;
  - the competitor parity matrices in docs/parity/;
  - the market digest docs/research/05-digest.md.

Important context: many findings come from modules not yet being wired to the UI. Screens are SIMULATED because the real modules only merged today. An integration step is running now to bind the modules. Separate the findings into:
- (a) wiring: the capability exists in a module but the UI doesn't use it yet;
- (b) missing capability: no module provides it yet;
- (c) true design or UX problems.
Spend most of your design effort on (c) and on how (a) should look and flow when wired. Don't redesign things only because they are simulated.

Output, per module or area (front desk, reservations, housekeeping/operations, finance/cashier, payments, guests, search/navigation/shell, settings/identity, help/learning), one file at docs/ux/round-1/refinements/<area>.md. For each refinement give:
- the problem, with evidence (finding id and screenshot);
- the proposed change, concretely: layout, flow, wording, shortcuts, components;
- the expected measurable outcome: steps, clicks, time, errors or new-user success;
- category (a), (b) or (c);
- an explicit **power check**: nothing competitors do is lost; no capability is removed or hidden from those who need it; progressive disclosure may move rarely used power one click away, never remove it;
- the owning module and a priority: blocker, major or minor.

Also write docs/ux/round-1/summary.md with:
- the top 15 refinements across the product, in order;
- the cross-module consistency rules you propose (shared verbs, navigation, status vocabulary, drawer and keyboard behaviour);
- new-user metrics to track in docs/ux/scorecard.md. Update the scorecard with round-1 baselines.

Rules:
- Never propose hiding errors, weakening permissions or skipping reconciliation.
- Usability targets are labelled targets until validated with real hotel staff.
- Be concrete and evidence-based.

When done, reply with:
- the top 10 refinements in plain English;
- counts per category and per module;
- the files written.
````

## Report (2026-11-07T16:43:11.366Z)

````text
## Round-1 UX refinement: 83 refinements written; `summary.md` blocked, full text at the end of this report

I wrote 83 refinements in 10 area files and updated the scorecard with round-1 baselines. Everything is committed on `docs/ux-round-1` and not pushed.

**`summary.md` was not written.** The harness refused it as a "report file", and I did not work around that. Its full text is at the end of this report, ready to commit as `docs/ux/round-1/summary.md`. One line in `refinements/payments.md` (PAY-02) refers to it.

I added a tenth area file, `connections-integration.md`. The adoption brief ranks integration alongside reservations and finance, and the IT-admin persona's blocker needed a home.

### Top 10 refinements, in plain English
1. **Check-in becomes a real checklist** (FD-01). It runs identity, room, payment guarantee, deposit, keys, confirm. Finished steps collapse and an interrupted check-in can be resumed. Target: a prepared arrival in 60 seconds or less. In round 1, check-in was impossible.
2. **Staff can create anything from anywhere** (FD-09, RSV-01, NAV-02). Walk-in fits in one sheet. A booking/quote sheet handles several rooms with child ages, offers by type and plan, and free counts. The `N` key always creates something.
3. **Departures, In-house, and check-out with a split bill** (FD-06, FD-07, FIN-02). Bills are labelled by who pays. Each one can be paid now, sent to the company account, or left open with a reason.
4. **No dead ends** (FD-04, FD-05, RSV-02). Every blocker carries the button that fixes it. A failed inspection leads to a ready villa in three clicks. A change that can't work shows alternatives instead of an active Confirm.
5. **The command palette runs actions in hotel words** (NAV-01): "night audit", "folio", "walk in", "connect". Round 1 found the right action for 0 of 17 such words.
6. **Search finds every guest and stay** (NAV-03, GST-01). That includes in-house and past stays, partial names and phone fragments. Every result opens a record. Round 1 got 3 of 9 lookups right, and guest results did nothing.
7. **Housekeeping can do housekeeping** (HK-01, HK-02, HK-05). Condition changes take one tap. Inspection pass/fail records reasons. Attendants see "My rooms" instead of a 120-villa scroll.
8. **Money is collected the same way everywhere** (PAY-01, PAY-02, PAY-03). One Collect panel, cash or bank transfer recorded in three taps, and "Check now" beside every pending payment.
9. **Never "Paid" while money is owed** (FD-03). What is *secured* and the *balance* are shown separately.
10. **The screens fit the device** (NAV-05, NAV-06). Tablet overflow goes from 111 px to 0. On a phone the day comes first: the first number moves from about 830 px down to 300 px or less. Phones get a bottom navigation bar.

Ranks 11–15 are:
- error messages that help you recover, plus a CI check that bans developer language (NAV-08, NAV-09);
- every KPI tile equals the list it opens (NAV-07);
- a Connections area (INT-01–03);
- a Finance workspace and Day Close readiness (FIN-01, DC-01/02);
- built-in help on every screen (HLP-01).

### Counts
**By category:** 44 wiring (a), 6 missing capability (b), 33 design (c). **By priority:** 23 blocker, 46 major, 14 minor.

| Area file | Total | (a) | (b) | (c) |
|---|---|---|---|---|
| front-desk | 15 | 8 | 1 | 6 |
| reservations | 9 | 8 | 0 | 1 |
| housekeeping-operations | 9 | 7 | 0 | 2 |
| finance-cashier (incl. Day Close) | 7 | 6 | 1 | 0 |
| payments | 4 | 3 | 0 | 1 |
| guests | 5 | 4 | 0 | 1 |
| search-navigation-shell | 13 | 1 | 0 | 12 |
| settings-identity | 10 | 2 | 2 | 6 |
| connections-integration | 5 | 5 | 0 | 0 |
| help-learning | 6 | 0 | 2 | 4 |

| Primary owner | Total | (a) | (b) | (c) |
|---|---|---|---|---|
| backoffice/ui | 22 | 0 | 1 | 21 |
| reservations | 20 | 16 | 1 | 3 |
| operations | 8 | 7 | 0 | 1 |
| platform | 7 | 3 | 2 | 2 |
| finance | 5 | 5 | 0 | 0 |
| guests | 5 | 4 | 0 | 1 |
| identity | 5 | 0 | 1 | 4 |
| payments | 4 | 3 | 0 | 1 |
| integration | 4 | 4 | 0 | 0 |
| day-close | 2 | 1 | 1 | 0 |
| foundation search | 1 | 1 | 0 | 0 |

### Things found in the code
- **Guest search results do nothing when clicked.** The guests module returns the type `guest_profile`, but the UI only knows `guest`, so the palette closes silently (`apps/backoffice/src/app/shell/global-palette.tsx`).
- **The property-save error shows raw JSON.** `problemFromUnknown` turns client-side validation errors into a text dump and adds "Reload the page" (`apps/backoffice/src/api/errors.ts`).
- **Policies and data authority have no HTTP routes.** Both exist in the platform service (`resolvePolicy`, `previewPolicyChange` and `setPolicy`; `listDataAuthority` and `setDataAuthority`). SET-05 and INT-03 need routes added.
- **Housekeeping would see money on the real arrivals list.** The housekeeping supervisor role holds `reservations.booking.read`, and the real list includes `balance`. FD-15 proposes returning money fields only to roles that handle money.
- **None of these items duplicates a steward-review item.** Overlaps are cited, for example SR P1-1, P1-4, P1-5, P2-1 and P2-16.
- **Simulator contradictions are left to the steward fix round** (SR P2-1). The fix for "simulated actions don't change anything" is to bind the real modules in the demo tenant, not to build a stateful simulator.
- **Evidence gaps.**
  - The findings cite `x-01`…`x-06` .png screenshots that are not in `screens/`.
  - `p1-03-today-full.jpg` shows only loading skeletons.
  - Findings have no stable IDs, so the next tester round should number them.

### Files (all in `/home/user/wt/ux-round-1`)
Refinements, in `docs/ux/round-1/refinements/`:
- `front-desk.md`
- `reservations.md`
- `housekeeping-operations.md`
- `finance-cashier.md`
- `payments.md`
- `guests.md`
- `search-navigation-shell.md`
- `settings-identity.md`
- `connections-integration.md`
- `help-learning.md`

Scorecard: `docs/ux/scorecard.md` now has R1 baselines, 10 new-user metrics, a round log and how each baseline was measured.

Commits: 5b84c99, cc8781d, 37049a3, 9cb0921.

---

### Content for `docs/ux/round-1/summary.md` (verbatim; please commit)

```markdown
# UX round 1: summary from the refining agent

**Date:** 2026-11-07 · **Branch:** `docs/ux-round-1`

**Inputs:**

- `blackbox-findings.md`: 9 personas and 70 screenshots in `screens/`;
- the UI on `feat/backoffice-core` (`apps/backoffice`, `packages/ui`);
- the module contracts and READMEs on `main`;
- the steward review `docs/orchestration/reviews/review-backoffice.md` (cited as **SR**);
- vision, design direction, experience architecture, UX principles, personas, specs, parity matrices and research
  digest 05.

**Outputs:**

- 83 refinements in `refinements/<area>.md`;
- this summary;
- round-1 baselines in `docs/ux/scorecard.md`.

All outcomes are **TARGETS** until they are validated with real hotel staff (ux-principles §19).

---

## 1. Round 1 in one paragraph

**What the tester could do.**

- The tester fully completed **5 of 34 tasks** (15%), partly completed 11 and could not complete 18.
- They hit **14 blocker** and **13 major** task-level frictions.
- The flows that fail most are the core ones: create a booking, check in, take payment, check out, mark a room clean,
  run Day Close, open finance, and connect a system.

**What they praised.** They also named things they found better than OPERA, Mews and Cloudbeds, and those must
survive every change:

- the arrival readiness model (B1);
- the change preview (B2);
- honest payment wording (B3);
- unmistakable provenance labels (B4);
- the keyboard map (B5);
- one anatomy for every record (B6);
- disabled actions that explain themselves (B7).

**Where the problems sit.**

- **Most blockers are wiring (a).** Reservations, operations, payments, finance, guests and integration merged
  today with these capabilities. The UI still runs on a simulator.
- **The design problems (c) sit mainly in the shell.** They would survive wiring:
  - a palette with no verbs and an `N` key that creates nothing;
  - error messages that leak raw output;
  - developer language on screen;
  - tablet and phone layouts that overflow or bury the day;
  - KPI tiles that don't match the lists they open.

---

## 2. How the findings classify

### Per category

| Category | Count | What it means for the next step |
|---|---|---|
| (a) wiring | **44** | The module already does it. These refinements are the UX specification for the integration step that is binding modules now. |
| (b) missing capability | **6** | Goes to module backlogs: FD-12 transfer disruptions, DC-02 Day Close run, SET-03 device sessions / reset / invitations, SET-06 portfolio view, HLP-04 guided tours, HLP-05 training org for every role. |
| (c) design / UX | **33** | Stays broken after wiring unless it is designed. 21 of the 33 are in the shared shell and UI. |

### Per area file

| Area file | Total | (a) | (b) | (c) | Blocker | Major | Minor |
|---|---|---|---|---|---|---|---|
| `front-desk.md` | 15 | 8 | 1 | 6 | 6 | 9 | 0 |
| `reservations.md` | 9 | 8 | 0 | 1 | 3 | 5 | 1 |
| `housekeeping-operations.md` | 9 | 7 | 0 | 2 | 3 | 6 | 0 |
| `finance-cashier.md` (incl. Day Close) | 7 | 6 | 1 | 0 | 4 | 2 | 1 |
| `payments.md` | 4 | 3 | 0 | 1 | 2 | 2 | 0 |
| `guests.md` | 5 | 4 | 0 | 1 | 1 | 3 | 1 |
| `search-navigation-shell.md` | 13 | 1 | 0 | 12 | 2 | 7 | 4 |
| `settings-identity.md` | 10 | 2 | 2 | 6 | 1 | 5 | 4 |
| `connections-integration.md` | 5 | 5 | 0 | 0 | 1 | 3 | 1 |
| `help-learning.md` | 6 | 0 | 2 | 4 | 0 | 4 | 2 |
| **Total** | **83** | **44** | **6** | **33** | **23** | **46** | **14** |

### Per owning module (primary owner)

| Owner | Total | (a) | (b) | (c) |
|---|---|---|---|---|
| backoffice/ui (shell, `packages/ui`, learning) | 22 | 0 | 1 | 21 |
| reservations | 20 | 16 | 1 | 3 |
| operations | 8 | 7 | 0 | 1 |
| platform | 7 | 3 | 2 | 2 |
| finance | 5 | 5 | 0 | 0 |
| guests | 5 | 4 | 0 | 1 |
| identity | 5 | 0 | 1 | 4 |
| payments | 4 | 3 | 0 | 1 |
| integration | 4 | 4 | 0 | 0 |
| day-close | 2 | 1 | 1 | 0 |
| foundation search (`apps/api` aggregator) | 1 | 1 | 0 | 0 |

Two platform items have a capability in the service but no HTTP route yet: SET-05 (policies) and INT-03 (data
authority). Both are counted as (a), with "route needed" stated.

### The tester's top 20 friction points, mapped

| T | Friction | Category | Refinements | SR overlap |
|---|---|---|---|---|
| 1 | No way to create anything | (a) + (c) | FD-09, RSV-01, NAV-01, NAV-02 | P1-5 |
| 2 | No checkout, bill, payment or split | (a) | FD-06, FD-07, FIN-02, PAY-01, PAY-03 | — |
| 3 | Key actions disabled with "wave 1" text | (a) + (c) | FD-04, FD-05, RSV-02, RSV-03, RSV-08, HK-08, NAV-09 | — |
| 4 | Housekeeping can't do housekeeping | (a) | HK-01 … HK-08 | P1-5 (bulk) |
| 5 | No Day Close | (a) readiness + (b) run | DC-01, DC-02 | — |
| 6 | No finance area; tile totals match nothing | (a) + (c) | FIN-01, PAY-04, NAV-07 | P2-1 |
| 7 | No integrations area | (a) | INT-01 … INT-04 | — |
| 8 | Search narrow; result does nothing | (a) + (c) | NAV-03, GST-01, NAV-01, NAV-04 | P2-11 |
| 9 | Simulated actions don't change the simulation | (a) | Solved by binding real modules in the demo tenant. **Do not build a stateful simulator.** | P1-6, P2-9 |
| 10 | Tablet overflow of 111 px | (c) | NAV-05, HK-09 | P1-4 |
| 11 | Contradictory status | (c) + simulation | FD-02, FD-03, NAV-07; simulator contradictions belong to SR | P2-1 |
| 12 | Raw validation output | (c) | NAV-08, SET-01 | P1-2, P2-7 |
| 13 | Developer jargon | (c) | NAV-09, SET-10, HLP-03 | — |
| 14 | Help and learning are empty shells | (c) + (b) | HLP-01, HLP-03, HLP-04, HLP-05 | — |
| 15 | Keyboard breaks at the drawer | (c) | FD-13 | P1-1, P1-5, P2-4, P2-16 |
| 16 | No date navigation; inconsistent tiles | (a) + (c) | FD-10, FD-06, NAV-07 | P3-8 |
| 17 | The phone is a squeezed desktop | (c) | NAV-06, NAV-05, FD-14, HK-05, SET-02 | — |
| 18 | Delayed transfers can't be managed | (a) + (b) | FD-11, FD-12 | — |
| 19 | Group tooling is missing | (a) + (b) | SET-04, SET-05, SET-06 | — |
| 20 | Access hygiene | (c) | SET-01, SET-07, SET-08, FD-15 | P3-4 |

The steward fix round already owns the simulator's contradictory facts: Paid shown next to a balance, 9 vs 7 ready,
in-house shown as ready, future-dated history, and invented KPI offsets (SR P2-1). These are **not** duplicated here.
The refinements add the rules that keep the *real* data from contradicting itself (FD-03, NAV-07).

---

## 3. Top 15 refinements across the product, in order

**How they are ordered.**

1. First, close the core desk loop: create, check in, fix blockers, check out.
2. Then the shell that every module inherits: verbs, search, layout, errors, numbers.
3. Then the workspaces that are missing entirely: housekeeping, money, connections, Day Close.
4. Last, help.

| # | Refinement | IDs | Cat | Owner | Priority | Expected outcome (targets) |
|---|---|---|---|---|---|---|
| 1 | **Check in opens a resumable checklist**: identity, room, guarantee, deposits, keys, confirm. Satisfied steps are collapsed. | FD-01 | (a) | reservations | blocker | Prepared arrival ≤ 60 s and ≤ 4 interactions. New hire's first check-in ≤ 10 min. Baseline: impossible. |
| 2 | **Create anything from anywhere**: a walk-in sheet, a booking/quote sheet (multi-room, child ages, offers by type × plan with free counts), and `N` that always creates. | FD-09, RSV-01, NAV-02 | (a) + (c) | reservations, backoffice/ui | blocker | Walk-in ≤ 3 min and ≤ 3 screens. Two-villa family booking ≤ 3 min. 0 dead `N` presses. |
| 3 | **Departures, In house and check-out with a split bill.** Bills are labelled by payer, each with Pay now / Send to company account / Leave open. | FD-06, FD-07, FIN-02 | (a) | reservations, finance | blocker | Split check-out ≤ 90 s with 0 wrong payer. Departures reachable in 1 key (`g d`). |
| 4 | **No dead ends.** Every blocker carries its fix button. A failed inspection leads to a ready villa in three clicks. An infeasible preview offers alternatives and never an enabled Confirm. | FD-04, FD-05, RSV-02 | (a) | reservations (+ inventory, operations, payments) | blocker | Blocker fixed in ≤ 1 click from the board. Room move ≤ 30 s. 0 dead ends in previews. |
| 5 | **The palette runs actions and speaks hotel.** It has a command registry with synonyms ("night audit", "folio", "walk in", "connect") and puts record verbs first. | NAV-01 | (c) | backoffice/ui | blocker | Action-word queries: 0/17 → 17/17. Start a walk-in in ≤ 6 keystrokes. |
| 6 | **Search finds every guest and stay** (in house, past, phone fragment, partial names), ranked per ux §8. Every result opens a record. | NAV-03, GST-01, NAV-04 | (a) + (c) | foundation search, guests | blocker | Round-1 lookups 3/9 → 9/9. 100% of results open. p95 ≤ 300 ms. |
| 7 | **Housekeeping can do housekeeping**: one-tap condition changes by state, inspection pass/fail with reason, and "My rooms" for attendants. | HK-01, HK-02, HK-05 | (a) | operations | blocker | Condition update ≤ 2 taps / 3 s. The attendant sees only their own rooms (baseline: 120 rooms over 10,514 px). |
| 8 | **Money is collected the same way everywhere**: the Collect panel, record cash or bank transfer in three taps, and "Check now" on every pending payment. | PAY-01, PAY-03, PAY-02 | (a) + (c) | payments | blocker | Take or record a payment ≤ 20 s. 0 duplicate charges. |
| 9 | **Never "Paid" while money is due.** Show what is *Secured* and the *Balance* separately. | FD-03 | (c) | reservations (+ payments) | major | 0 screens showing Paid next to a positive balance. |
| 10 | **Fit the device.** Rail-only navigation and header tabs at mid widths, a bottom bar on phones, the day first on a phone, and a layout contract test. | NAV-05, NAV-06, HK-09 | (c) | backoffice/ui | major | Overflow at 1024 px: 111 → 0 px. First operational number on a phone: ≈ 830 → ≤ 300 px. |
| 11 | **Errors that recover, in staff language.** Inline validation, no raw payloads or "reload" advice, and a CI copy lint that bans developer terms. | NAV-08, NAV-09 | (c) | backoffice/ui (+ every module's strings) | major | Errors without recovery: 4 → 0. Developer terms on screen: ≥ 14 → 0. |
| 12 | **Every number opens the list it counts.** A tile *is* a saved view, and its count equals the destination's count. | NAV-07 | (c) | backoffice/ui | major | Today tiles that are wrong, mismatched or not clickable: 4 of 6 → 0. |
| 13 | **Connections area**: a catalogue of workflows, read-only first, a resumable setup journey, and a data-authority matrix with preview. | INT-01, INT-02, INT-03 | (a) | integration, platform | blocker | First read-only connection ≤ 30 min of staff time. Baseline: 404. |
| 14 | **A Finance workspace and Day Close readiness**: exceptions first, and every Day Close item with its fix. The run itself is (b). | FIN-01, DC-01, DC-02 | (a) + (b) | finance, day-close | blocker | Finance exceptions in 1 click. Every blocking Day Close item on one screen. Day Close ≤ 2 min of attention. |
| 15 | **Built-in help on every screen now.** What the screen is for, its tasks with "Show me", and its chips. Website content plugs in later. | HLP-01, HLP-03 | (c) | backoffice/ui | major | Screens with help: 0% → 100%. Help requests ≤ 1 per persona. |

**Also blockers, next in line:**

- RSV-03: cancel with the fee previewed;
- HK-03: assignment planning with suggestions;
- SET-05: policy centre with overrides.

---

## 4. Cross-module consistency rules (proposed)

These make the modules feel like one product. They extend experience-architecture §2 and §5 and ux-principles
§1–§9. The orchestrator should adopt them, and module agents should apply them in their decisions.

### C1 · Shared verbs

Use the same words, places and keys in every module. "Room/villa" stands for the property's own noun for a unit
(NAV-13).

| Verb | Means | Key | Preview? | Never say instead |
|---|---|---|---|---|
| **New** *record* | Create a primary record (booking, task, work order) | `n` | When it consumes inventory or money | "Create", "Add new" |
| **Add** *thing* | Attach to an existing record or collection (add room, add role, add staff member, add property) | — | When it consumes inventory or money | "Insert" |
| **Edit** | Change fields, with no consequences beyond the record | `e` (record) | No | "Modify", "Update" |
| **Change dates** / **Extend** / **Shorten** | Change a stay's nights | — | Always | "Amend" |
| **Move** *room/villa* | Put a stay in another unit | `m` | Always | "Move unit", "Reassign" |
| **Assign** | Set a unit, attendant or owner | `a` | Only if the price changes | "Allocate" |
| **Check in** / **Check out** | Run the checklist workflow | `c` / `o` | The checklist is the preview | "Process arrival" |
| **Cancel** | End a booking, stay or task | — | Always when money is involved (fee) | "Delete" |
| **Post charge** / **Adjust** | Add to a bill / correct posted lines with a linked entry | — | Adjust: yes | "Edit charge", "Void" for posted lines |
| **Take payment** / **Record payment** | We charge the guest / it happened elsewhere (cash, bank, external terminal) | `p` | Shown in the Collect panel | "Pay", "Mark paid" |
| **Settle** | Bring a bill to zero | — | Yes | "Close bill" |
| **Check now** | Ask the authoritative system for the current state | — | No | "Refresh", "Sync now" (unless it really syncs) |
| **Resolve** / **Acknowledge** / **Approve** | Close an issue with an outcome / accept ownership / authorise a decision | — | Resolve money items: needs evidence | "Dismiss", "OK" |
| **Mark** *clean / dirty* · **Inspect** | Change condition / record an inspection | — | No (undo instead) | "Set status" |
| **Report issue** | Create a work order or a discrepancy | — | Only when it affects inventory | "Raise ticket" |

### C2 · Navigation

1. The rail shows the role's workspaces. The section list appears only when a workspace has two or more sections.
   - On mid widths, sections become a flyout and header tabs.
   - On phones, they become a bottom bar plus **More** (NAV-05).
2. Every workspace home uses the same skeleton: **Now / Today / Watch** (personas doc).
3. **Go-to map** (resolves SR P2-16; ux §7):

   | Keys | Destination |
   |---|---|
   | `g o` | Overview / Today |
   | `g w` | My work |
   | `g a` | Arrivals |
   | `g i` | In house |
   | `g d` | Departures |
   | `g t` | Timeline |
   | `g h` | Housekeeping |
   | `g f` | Finance |
   | `g c` | Day Close |
   | `g l` | Learning |
   | `g s` | Switch property |

   The section list shows a hint only for bindings that exist.
4. Every date-scoped list has the same date control: Today · Tomorrow · ‹ › · picker. The keys `[` and `]` step a day,
   and the state goes in the URL (FD-10).
5. View state (filters, sort, columns, date) lives in the URL, so a colleague's link opens the same view (SR P2-10).

### C3 · Status vocabulary and truth

1. ux-principles §4 is the only vocabulary. Its values live in one shared contracts package (SR cross-module note;
   FOUNDATION_REQUESTS #1). An unknown value renders as a neutral chip and never crashes the page (SR P1-3).
2. **Separate questions get separate chips**:
   - Secured ≠ Balance ≠ Payment status (FD-03);
   - Readiness ≠ Stay status: an in-house stay is never shown as "Ready".
3. **The weakest part decides a summary, and it is named**: "Not ready · Villa 208 failed inspection". "Ready",
   "Paid", "Confirmed" and "Synced" need the authoritative confirmation (CLAUDE.md §5).
4. Every projection carries its marker: *Estimate*, *Pending verification*, *Pending in <system>*, *External · synced
   hh:mm*, *Delayed*.

### C4 · Records, drawers and keyboard

1. `Enter` on a row opens the record and moves focus to its title. `Esc` closes it and returns focus to the row
   (SR P1-1, P2-2).
   - Boards use the non-modal split view: `j` / `k` move to the next or previous record while the drawer stays open
     (SR P1-5).
2. **The primary slot is the next valid action** for the record's state. Disabled actions live in "…" with their reason.
   A blocked natural action shows its fix beside it (FD-08).
3. Record verb keys are listed in C1. Each button shows its key on desktop.
   - `Ctrl/⌘ Enter` confirms a preview.
   - `Shift+Enter` opens the full page.
   - Keys never fire inside inputs.
4. The drawer is `min(560px, 100vw − 48px)` wide, and its Close button is always inside the viewport.
   - On phones the record opens as a full-screen sheet.
   - `Esc`, Back and swipe-down close it without losing unsaved edits (ux §7).
5. Every palette command also exists in the visible UI.

### C5 · Lists and numbers

1. Every list uses the shared DataTable (experience-architecture §5.4):
   - low-priority columns hide behind "+n columns" instead of scrolling sideways (SR P1-4);
   - the quick filter searches everything visible (SR P2-11);
   - selection and bulk actions go through a preview (SR P1-5);
   - empty states teach the next step.
2. **A KPI tile is a saved view.** It is computed by the same query as its destination, and a contract test proves the
   two agree (NAV-07).

### C6 · Previews

1. Every change that touches inventory, money, policy or authority has a preview (ux §5).
2. **An infeasible preview never has an enabled Confirm.** It offers the server's alternatives as choices (RSV-02).
3. On `preview_stale`, the preview is re-rendered with the changes highlighted and a plain explanation (SR P2-13).

### C7 · Messages

1. **Success** says what happened and what happens next.
2. **Errors** say what happened, why, and what to do now, ideally with a button.
   - Validation is shown inline at the field (NAV-08).
   - The support reference is small, in a corner.
3. **Uncertain outcomes are pending verification, never "nothing was sent"** (SR P1-2).
4. **Anything that asks staff to check something carries the button that checks it** (PAY-02, FD-04).
5. No retry boilerplate. Retry guidance appears only when the server says it helps.

### C8 · Language

1. Staff words from the glossary.
2. The property's noun for a unit (room, villa) in every verb.
3. CI fails on developer terms (NAV-09).
4. Not-yet-available features say so in plain words, in non-live environments only.

### C9 · Provenance and environment

1. The environment banner shows on every screen and is never dismissible. On phones it shrinks to one line (NAV-06).
2. There is one provenance badge per page and per record. Explanatory notes collapse after the first view.
3. Sample data never contradicts itself (SR P2-1).

### C10 · Touch and devices

1. Touch targets are ≥ 44 px, and primary actions sit in the thumb zone.
2. Nothing works on hover alone (NAV-10).
3. No horizontal page scroll at 360, 768, 1024, 1280 or 1440 px. A Playwright contract test checks this on every
   route (NAV-05).

### C11 · Permissions shown honestly

1. Page-level create buttons are hidden when the user lacks the permission. Record actions stay visible but disabled,
   with the reason.
2. Money fields are returned only to roles that handle money (FD-15).
3. Navigation hiding is never access control. The server decides.

### C12 · Create and find

1. `N` always creates (NAV-02).
2. The palette offers verbs, then records, then destinations, with synonyms (NAV-01).
3. Every result and link opens something (NAV-04).

---

## 5. New-user metrics to track

These are added to `docs/ux/scorecard.md` with their round-1 baselines. The new rows measure what a zero-context user
actually feels.

| New metric | Target | R1 baseline |
|---|---|---|
| Distinct dead ends met (silent no-op, "not available" toast, disabled with no alternative, wrong destination) | 0 | 15 |
| Distinct developer terms visible to staff | 0 | ≥ 14 |
| Search: correct first result on the round's lookup set | 100% | 3 of 9 |
| Palette: right action first for action words | 100% | 0 of 17 |
| Today tiles with wrong, mismatched or missing destination | 0 | 4 of 6 |
| Keystrokes from an arrival row to the check-in sheet | ≤ 2 (3 including confirm) | 17 Tabs + Enter, no action keys |
| Horizontal overflow at 1024×768 | 0 px | 111 px |
| First operational number from the top, phone 390×844 | ≤ 300 px | ≈ 830 px |
| Screens whose help panel has content | 100% | 0% |
| Roles able to open a training organization in 1 click | 100% | 1 of 3 tested |

---

## 6. Hand-off and sequencing

- **Integration step (running now).** Treat the (a) refinements as the UX specification for each binding, in
  top-15 order: FD-01, FD-09/RSV-01, FD-06/07/FIN-02, FD-04/05/RSV-02, NAV-03/GST-01, HK-01/02/05, PAY-01/02/03, INT-01,
  FIN-01/DC-01. Each item lists its wiring acceptance criteria.
- **backoffice/ui (after the SR fix round).** The remaining items:
  - the shell: NAV-01, 02, 04–13;
  - front desk: FD-08, FD-13, FD-14;
  - housekeeping: HK-09;
  - help: HLP-01, 03, 06.
  - SR P1-1, P1-4, P1-5, P2-4, P2-10 and P2-16 are prerequisites, and these items reference them so they are not
    redone.
- **Module agents** record a decision per refinement in `docs/ux/round-1/decisions/<module>.md`: accepted, adapted or
  rejected with a reason (`docs/ux/README.md` step 3).
- **No owner decision is needed** for round 1. Every item is an ordinary product or engineering choice. The proposed
  *Owner (all-in-one)* role template is already in personas P17.
- **Round 2** re-runs the same 34 tasks once modules are bound. Improvements are claimed only when that round
  confirms them.

### Evidence gaps for the next tester round

1. The findings cite `x-01`–`x-06` `.png` screenshots that are not in `screens/`.
2. `screens/p1-03-today-full.jpg` shows only loading skeletons.
3. Findings have no stable IDs. Ask the tester to number them (`P1-F03`) so decisions can cite them exactly.

---

## 7. Power check: the whole round

- **0 capabilities removed.** Every one of the 83 refinements states its power check.
- **Power moved one click away**, by progressive disclosure:
  - disabled actions move into "…" with their reason (FD-08);
  - sections become a flyout and header tabs at mid widths (NAV-05);
  - the simulated explanation collapses behind its badge (NAV-06);
  - low-priority board columns go behind "+n columns" (HK-09);
  - booking terms collapse to one line (RSV-06);
  - empty lessons go under "Coming later" (HLP-03).
  - None of these is hidden from the people who need it, and the environment banner is never hidden.
- **Refinements that strengthen permissions or reconciliation:**
  - FD-15: money fields only for money roles;
  - SET-01: least-privilege default;
  - SET-07: no tempting buttons on forbidden pages;
  - PAY-04: no "mark verified" without evidence;
  - PAY-02: pending verification never invites a second charge.
- **Refinements that add power competitors lack:**
  - a ranked, explained room shortlist on failed inspection (FD-05);
  - bulk transfer delay and the missed-last-seaplane path (FD-12);
  - Day Close readiness all day with resume (DC-01, DC-02);
  - a data-authority matrix with preview (INT-03);
  - a portfolio policy centre with an override report (SET-05).
```
````

