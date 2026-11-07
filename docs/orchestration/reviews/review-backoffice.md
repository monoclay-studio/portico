# Steward review: `feat/backoffice-core` (packages/ui + apps/backoffice)

Reviewer: architecture steward (independent). Worktree `/home/user/wt/backoffice` @ `71e280c`. I did not change the worktree.
All experiments ran in `…/scratchpad/review-backoffice-copy` (API :4200, Vite :5280, DB `portico_review_ui`) and in a merge-with-main
clone `…/scratchpad/review-backoffice-merged` (API :4201, Vite :5281, DB `portico_review_ui_merged`). Evidence (screenshots, probe
output, the layout prototype diff) is in `…/scratchpad/review-backoffice-shots/`.

## Verdict: **merge after fixes**

The foundation is strong. The API client is typed and validated with Zod. The 409 flow really preserves the other person's change
(the e2e test proves it: their name survives and the version is +2). Every simulated datum I found carries a label. Tokens and
status shapes are well thought out, and the production build runs under the infra CSP with no violations. But one security bug
must be fixed before merge: a cached session leaks to the next user on a shared desk computer. There is also a WCAG failure in
the record drawer, the most-used surface, which the README says works. The arrivals board also fails at its one job at real desk
widths: you cannot read the blocker. Fix P0-1 and P1-1…P1-4 before merging. P1-5/P1-6 can be tracked, but they must land before
any module swaps in its live source.

Counts: **P0 1 · P1 6 · P2 18 · P3 10**

## Command results

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` (copy of branch) | pass |
| `pnpm lint` | pass (biome 255 files; boundaries OK) |
| `pnpm typecheck` | pass (10/10 tasks) |
| `pnpm --filter @portico/ui test` | pass, 73 tests / 11 files |
| `pnpm --filter @portico/backoffice test` | pass, 27 tests / 3 files |
| `pnpm --filter @portico/backoffice e2e` (Playwright smoke, real API) | pass, 7/7 (37 s) |
| `vite build` | pass. **One 938 kB chunk (288 kB gzip)** + 4.2 MB public source map; chunk-size warning |
| Merge with `main` (branch is **91 commits behind**) | git merges cleanly, **but the auto-merged `pnpm-lock.yaml` breaks `--frozen-lockfile`** (`ERR_PNPM_LOCKFILE_MISSING_DEPENDENCY vitest@5.1.0(...)`). It needs `pnpm install` (2-line lock diff). After that, typecheck 12/12, lint, ui 73 and backoffice 27 pass |
| Playwright smoke on the merged tree (fresh DB) | **6/7: axe fails**, `dark /today color-contrast` on the SegmentedBar neutral-segment label (see P2-6). The failure depends on the data, so the branch is green only by luck of its seed |
| Full axe (all impacts, incl. `wcag21a` and best-practice; 10 screens × 2 themes + drawer + palette) | `label-content-name-mismatch` (serious) on **every** screen; `nested-interactive` (serious, 18 nodes) in the palette; `heading-order` (moderate) on Today; `empty-table-header` (minor) on the Timeline. Log: `scratchpad/bo-axe-full.log` |
| Production build under infra default CSP (`/home/user/wt/infra/.../edge/variables.tf:77`) | **no CSP violations** (Today, Arrivals, Timeline, Housekeeping, drawer, palette) |

## Findings

### P0

| id | file:line | problem | why it matters | fix |
|---|---|---|---|---|
| **P0-1** Cross-user cache leak on a shared desk tab | `apps/backoffice/src/api/index.ts:9` (401 → `sessionStore.clear('expired')` only); `app/shell/app-shell.tsx:88-107` (cache cleared only on explicit sign-out); `features/auth/sign-in-page.tsx:55` (sign-in does not clear); `api/queries.ts:7-31` (keys are `['org', orgId, …]`, not per user) | **Reproduced** (`bo-probe/leak.cjs`). The director opens Users. The server ends the session, the tab gets a 401, and the sign-in page appears. The **front-desk agent** signs in on the same tab. The shell still says *"Account: Group Director"*, shows the director's workspaces (Settings), and `/settings/users` renders all **10 staff with emails and roles** and the *Invite staff member* button. No request is made in the 30 s stale window. The server refuses the same call for this user (`GET /v1/users` → 403 `identity.user.read`). Saved views, pinned/recent records and density then bind to the director's `me.userId`. Screenshots: `cache-leak-after-signin.png`, `cache-leak-users.png` | Shared desk PCs are the threat model the README names (owner Q3). Staff PII is shown to someone not permitted to see it, and the identity on screen is wrong. Security issue, so P0 by the brief. It is same-tenant, not cross-tenant | Call `queryClient.clear()` whenever the session identity changes: in `sessionStore.set` and `clear`, or by subscribing in `Providers`. Add `userId` to every query key (`['org', orgId, 'user', userId, …]`). Add an e2e test: expire → sign in as a different user → no cached rows, account label correct |

### P1

| id | file:line | problem | why it matters | fix |
|---|---|---|---|---|
| **P1-1** Record drawer never takes focus, and Tab walks hidden background content | `packages/ui/src/components/record/record-drawer.tsx:42,50-54,119` (`bodyRef` is never attached to an element; `onOpenAutoFocus` calls `preventDefault()` and then focuses `null`) | **Reproduced** (`bo-probe/keyboard.cjs`, `focus2.cjs`, `drawer-tabs.cjs`). After Enter on an arrival, focus stays on the board cell under the scrim (`aria-hidden` ancestor). The next **17 Tab presses land on aria-hidden villa links behind the modal**; the 18th reaches the drawer. Screen-reader users get no cue that the drawer opened. Screenshot `drawer-focus.png` shows the focus ring still on the background cell. README a11y checklist claims "focus lands in opened drawers/dialogs and returns on close" | WCAG 2.4.3 / 1.3.2 / 4.1.2 failure on the most-used surface (every record opens here). False claim in the README. Not caught because no test asserts drawer focus | Attach `ref={bodyRef}` with `tabIndex={-1}` to the record body, or focus the record heading. Add a ui test: open → `document.activeElement` inside `[data-record-drawer]`; Esc → focus back on the originating cell. Correct the README checklist |
| **P1-2** Uncertain outcomes are reported as "nothing was sent / safe to retry" | `apps/backoffice/src/api/errors.ts:37-42` (`offlineProblem`: "Portico could not be reached, so nothing was sent… retrying is safe"); `packages/ui/src/strings.ts:27` (`retryableHint`: "a retry never repeats an action that already happened"); `api/client.ts:64-77` (every fetch rejection maps to "offline"; no client timeout, so a hung request spins forever) | A fetch rejection after the request was sent (connection drop, proxy reset, laptop sleep) is uncertain, not "not sent". The hint promises safety even for calls with no Idempotency-Key. For a PATCH with If-Match, a "safe" retry gets a 409 and the ConflictDialog says "Someone else changed this", when it was you | CLAUDE.md §5: "Uncertain outcomes are shown as **pending verification** and resolved by reconciliation". This client is the foundation every money flow will use | For mutations: "We could not confirm whether this was saved. Check the record before trying again." Show *Try again* only when an idempotency key or If-Match makes it safe, and say which. Add `AbortSignal.timeout()` per request with a distinct `timeout` problem. Make `retryableHint` depend on the call (pass `safeToRetry` from the client) |
| **P1-3** Status vocabularies don't match the real providers, and an unknown value crashes the screen | `packages/ui/src/components/status-badge.tsx:50-78,229` (`throw new Error('Unknown … status')`); no error boundary or route `errorComponent` anywhere (`app/router.tsx`) | The values that live data will send are absent from `STATUS_VALUES`. **Payments:** `succeeded`, `processing`, `requires_action`, `recorded_unverified`, `recorded_verified`, `cancelled`, `captured`/`voided`/`expired`; `disputed` is also required by ux-principles §4. **Operations:** discrepancy `occupied_no_luggage`, block `house_use`. **Reservations** `stayStatusFamilies.payment` is a free string (`succeeded`, `none`, `unknown`). The UI's `guaranteed`/`unpaid`/`not_required` exist nowhere server-side. `guaranteed` is a guarantee, not a payment status; reservations keeps `guaranteeKind` separate | The first live payload replaces the board with TanStack's default English "Something went wrong!". The UI's labels also replace the server-computed `statusPresentation {label, tone, explanation, confirmed}` from payments, which carries the "simulated / sandbox" suffix and "recorded" tone | Render unknown values as a neutral chip showing the raw code (and report them), never throw. Add an app-level error boundary that renders a `ProblemAlert`. Reconcile the payment vocabulary with payments' state machine, and render `statusPresentation` when the server provides it. Move the enums to one shared contracts package (see cross-module notes) |
| **P1-4** Arrivals board: the single blocker can't be read at real desk widths; Stay and Owner are off-screen | `features/front-desk/arrivals-page.tsx:97-216` (column min widths add up to 78.5 rem ≈ 1256 px; readiness is the 6th column at `minmax(14rem,2fr)`); `features/front-desk/readiness.tsx:36-40` (`truncate` to one line, full text only in `title`); `app/shell/app-shell.tsx:233` (224 px section list even when the workspace has one item) | Measured (`bo-probe/layout.cjs`). At **1280** the grid is 914 px wide for 1260 px of columns: Readiness is half visible, Stay and Owner hidden, **14 of 14 blockers truncated** to 178 px (e.g. "Deposit charge of USD 2…" is 604 px of text). At **1440**: Stay cut, Owner hidden, 14/14 truncated. At **1600**: Owner cut, 14/14 truncated. At **1920**: 11/14 still truncated. The ready-with-attention text truncates to "Ba…". The full text is only in a `title` attribute, which keyboard and touch users can't reach. ~480 px of chrome means only 7 arrivals fit above the fold at 1280×900. The blocker's owner is never shown, though the cell's docstring promises it. Screenshots `arrivals-1280/1440/1600/1920.png` | The board exists to answer "what is the one thing stopping this guest" (vision 07:30, personas P1: "the single blocker per arrival"). Design direction priority 2: "power before prettiness" | Prototype (copy only; `proposal-arrivals-layout.diff`, `proposal-arrivals-1280.png`): at 1280 every column fits and every blocker is readable. (1) Put Readiness 2nd, `minmax(18rem,3fr)`, two lines (`line-clamp-2`) with owner and age on line 2; set row height to fit 2–3 lines. (2) Stack condition and payment chips in one 10 rem column. Show stay status only when not *Expected*, as a chip in the Guest cell. (3) Hide the section column when a workspace has ≤ 1 section, and collapse it below 1536 px. (4) Give DataTable column *priority* so low-priority columns hide (with a "+n hidden" chip) rather than scrolling sideways, and freeze the identity column. (5) Ask the servers for a short `summary` plus a `detail` per blocker (drop the unit number already shown in the Unit column). Show the full text in a focusable "Why?" popover. (6) Drop the duplicated property·date breadcrumb line. Fold the SIMULATED note into one line. Make the stat tiles clickable filter chips |
| **P1-5** No selection, bulk actions or list keys in the shared DataTable; the modal drawer blocks the board | `packages/ui/src/components/data-table/data-table.tsx` (no selection model; `aria-selected` is reused for "open record", l.464); `moveCell` has no j/k/x/e (`model.ts:157-185`); `record-drawer.tsx:44-58` (modal with scrim; click outside closes, so moving to the next arrival takes 2 clicks, verified); palette has no record actions (`global-palette.tsx:96-215`); My work items have no Resolve/Assign/Acknowledge | design-direction: "dense tables, inline actions, keyboard navigation, **bulk selection**". experience-architecture §3: "bulk select + bulk actions with preview". ux-principles §7: `j/k`, `x`, `Shift+click`, `e`; palette runs actions on the current record. parity `gaps-front.md` EC-RES-003 (**P0**): *bulk transfer delay* for many arrivals. §9: export | Every module must use this DataTable (experience rule 4). Without selection, either every board ships without bulk work or each module forks the table. The usability target "assign tomorrow's housekeeping, 40 units ≤ 5 min" can't be met | Add a selection model (checkbox column, `x`, Space, Shift+click range, select all filtered) with a bulk-action bar that opens a preview. Add `j/k`, `e`. Offer a **non-modal** side-panel mode for boards (no scrim; arrow or j/k moves the record shown; "split view"). Add record actions to the palette. Add CSV export (permission-gated) |
| **P1-6** Mock layer is not cleanly swappable, and its contracts diverge from the real branches | `mocks/adapter.ts:38-54` (`WorkspaceDataSource` is typed with simulator types `SimProperty`, `SimStayDetail`, `SimUnitDetail`, `SimWorkItem`, `SimToday`; `stay/unit/myWork/today` are not Zod-validated); `data/sources.ts:11` (one source and one `mode` for all domains); screens import `mocks/contracts` types and the runtime class `SimulatedProblem` (`extend-stay-dialog.tsx:19,22-35`); `SimulatedNote` is hard-coded on 5 screens (`arrivals-page.tsx:251`, `housekeeping-page.tsx:218`, `my-work-page.tsx:159`, `today-page.tsx:70`, `timeline-page.tsx:90`); `records/registry.tsx` computes allowedActions/issues/owner client-side from simulator rows | README says "Screens do not change; provenance flips … automatically". It doesn't hold: swapping needs edits in every screen and the registry, and one module can't go live while the others stay simulated. The mock validates against **its own** copies of the contracts, so it *can* drift silently from the real ones (it already has; list below). Concrete crashes once wired: real `frontDeskRow.eta` is `HH:MM` (`stayInput.eta`), and `EtaCell` calls `formatTime(new Date('09:40'))`, a RangeError. Real `readiness` is `null` for non-expected stays, so `row.readiness.ready` throws a TypeError in `ReadinessCell` and the stat counts | Split the source per domain (`arrivalsSource`, `boardSource`, …), each typed **only** with module contracts or view models the app owns. Map real payloads in an adapter (`frontDeskRow` + operations unit condition + payments status → board row). Derive the simulated note and badge from `source.provenance`. Map simulator errors to `ProblemDetails` inside the adapter. Add contract-compat tests that parse a real fixture from each module through the adapter |

### P2

| id | file:line | problem | fix |
|---|---|---|---|
| P2-1 Simulated facts contradict each other and invent statuses | `mocks/maldives.ts:1160-1167` (`open: work.length + 2`, `yesterday: work.length + 4`, `pendingVerification.count: pending.length + 1`, `+ 48_000` minor units); `today-page.tsx:117-123` ("12 OF 18 READY" = ready + checked-in, while the arrivals board says **10 Ready**); `readiness.tsx:17` (in-house guests show "Ready for check-in" next to "In house", seen in `drawer-focus.png`); `registry.tsx:355` (booking status falls back to **`'confirmed'`** when unknown) | Never fabricate: drop the fudge factors and derive every KPI from the same rows its drill-down shows. Label checked-in arrivals "Checked in hh:mm". Omit the booking chip when unknown (CLAUDE.md §5 "never show confirmed unless…") |
| P2-2 Focus is not returned after palette, search or programmatic dialogs | Probe: Ctrl+K→Esc and /→Esc from a grid cell leave focus on `BODY`; Extend stay → Esc leaves `BODY` (`global-palette.tsx`, `record-host.tsx:124-136`; Dialog opened without a Trigger) | Remember `document.activeElement` on open and restore it on close (Radix `onCloseAutoFocus`) |
| P2-3 Focus hidden under the sticky top bar (WCAG 2.4.11) | `bo-probe/obscured.cjs`: Shift+Tab on /today put the focused badge at y 6–28 under the 56 px header; no `scroll-padding-top` anywhere | `html { scroll-padding-top: calc(var(--header-h) + 8px) }`, plus `scroll-margin` on grid cells |
| P2-4 Grid is not a single tab stop; nested interactives; label-in-name | 17 `RecordLink`s inside the arrivals grid are tabbable (Tab from a cell jumps to "Villa 149"); palette `role=option` contains a button (axe `nested-interactive` ×18); property switcher's `aria-label` drops the visible **business date**; ProvenanceBadge name ≠ visible text (axe `label-content-name-mismatch`, WCAG 2.5.3, every screen) | Set `tabIndex=-1` on in-cell controls and reach them with Enter/F2 (APG grid). Render the badge inside the option as non-interactive. Start each `aria-label` with its visible text ("Azure Atoll Resort… · Business date 2026-11-07, switch property"; "Simulated · last synced now. Sample data…") |
| P2-5 Axe gate is too narrow | `e2e/smoke.spec.ts:149-151` uses tags without `wcag21a`, keeps only serious/critical, and never runs with the drawer, palette, dialogs, Timeline or My work open. Keyboard focus is never asserted | Add `wcag21a`; fail on moderate too (or keep an explicit allowlist); run axe with each overlay open; add keyboard e2e (drawer focus, Esc return, Tab trap) |
| P2-6 Contrast failure depends on the data | `packages/ui/src/components/segmented-bar.tsx:18-21` (labels `text-[oklch(0.18_0_0)]` on `--pt-viz-neutral #7a7a75` in dark, ≈ 4.3:1 for 12 px text; raw colour bypasses tokens). Fails on the merged run (`merged-axe-error-context.md`), passes on the branch DB only because the segment was too narrow to show a label | Token-based label colours checked per segment (or labels outside the bar). Seed the e2e simulation deterministically (fixed property id) so results repeat |
| P2-7 Conflict flow edge cases | `property-detail-page.tsx:108-136` (`async onError` with no try/catch: if `api.property()` fails, the user sees nothing); `:142-150,281-288` (a 409 during re-apply shows a raw problem, the rows go stale, and *Re-apply* resends the same stale version, looping); "changed by" uses `history.at(-1)`, but `/history` returns the **oldest** 500 entries (`apps/api/src/records-routes.ts:154-155`), so busy records get the wrong attribution | Catch inside `onError` and show a ProblemAlert. On a 409 in re-apply, reclassify against the newest version. Ask the foundation for `order=desc&limit=` (or a `lastChange` field) |
| P2-8 Token storage, expiry and PII at rest | `api/session.ts:180-190` (expiry checked only on the first read; the comment claims more); the token is readable by any script (verified). `records/stores.ts:152-175` keeps **guest names** (recent/pinned titles) in `localStorage` after sign-out on shared desks | Acceptable for wave 1 *with* the infra CSP (verified clean). Record the choice in an ADR. Keep the token in memory with sessionStorage only for reload; add `require-trusted-types-for 'script'`; re-check expiry on every read and with a timer. Store record refs without titles, or clear them on sign-out |
| P2-9 Simulator runs inside live organizations | `data/sources.ts:11` (unconditional), `features/common/sim-property.ts` (fake guests attached to the real property) | Bind simulated sources only when `environment !== 'live'` (or behind a dev flag). In live, show "Available when <module> is connected" |
| P2-10 Saved views are personal, local and not addressable | `features/common/use-saved-views.ts` (localStorage); view state is not in the URL, so a deep link loses its filters; no live count; no shared-to-role views (ux-principles §9, experience §2 "deep links that open exactly the same view for a colleague") | Put view id + state in the search params now. Add a preferences API for shared views later (FOUNDATION_REQUESTS) |
| P2-11 Quick filter can't find a booking code or blocker text | `arrivals-page.tsx:100-104,176` (searchable accessors are the guest name and `'ready'`/`'blocked'`). Verified: filtering by `5TNU6CCN` gives **0 rows**; global search finds it | Add `searchText?: (row) => string` to `ColumnDef`, covering code, flags and blocker message |
| P2-12 Session expiry loses the page and unsaved edits | `app-shell.tsx:88-91` navigates to `/sign-in` with no `redirect`, so after re-login staff land on `/`; a dirty property form is lost | Pass `redirect: location.href`. Keep dirty form state in sessionStorage per record until saved |
| P2-13 Change preview contract & stale/forwarded flows missing | `extend-stay-dialog.tsx` + `mocks/contracts.ts:177-200` (string rows, client-clock staleness, no alternatives, commit returns `{stayId, departure}`, no Idempotency-Key) vs reservations `changePreview` (`contracts.ts:491-523`: Money per night, `feasible`, `blockers`, `alternatives`, `expiresAt`) and commit (`routes.ts:220-235`: Idempotency-Key, **202 forwarded**, **409 `preview_stale` with `freshPreview` + `differences` + `explanation`**) | Model the real preview (per-night table, alternatives such as "move extra nights"). Handle `preview_stale` by re-rendering with highlighted differences (ux §5/§10). Render 202 as "Pending in <system>". Send an intent-scoped Idempotency-Key on commit |
| P2-14 Vocabulary drift inside the UI | `status-badge.tsx:65` (`availability` mixes unit availability and inventory-cell states; no Out of order / Out of service / House use / Assigned); unit record shows OOO and OOS both as "Blocked" (`registry.tsx` unit status); `provenance-badge.tsx:17` has no **`sandbox`** (CLAUDE.md §12 requires labelling sandbox results) | Split `unitAvailability` from `inventoryCell` per ux-principles §4; add `sandbox` (and payments' `recorded`) |
| P2-15 i18n readiness | No plural forms (`en.ts:195` "{{count}} arrivals", `:310` "night(s)", "1 adults"); uppercase baked into strings (`en.ts:144,155,159`); hard-coded `'Conflict'` (`extend-stay-dialog.tsx:26`); mixed date formats on one screen (`2026-11-07`, "Sat, Nov 7, 2026" from `'en'`, not en-GB/property locale); no bidi isolation, so untranslated or data strings render reversed in RTL (`arrivals-rtl.png`: ".Sample data…"); `weekStartsOn={0}` hard-coded (`providers.tsx:30`); ux-principles §14 asks for ICU | Use i18next plurals (`_one/_other`, Arabic and Dhivehi categories) or ICU. Apply uppercase with CSS. Use one locale-aware date style plus the business-date chip. Wrap data in `<bdi>`/`dir="auto"`. Derive week start and locale from property or user |
| P2-16 Shortcut map deviates from ux-principles §7 | `app/workspaces.ts:61` binds **`g d` = Today** (§7: `g d` = Departures, so it must change when Departures ships). The section list shows a **`G P` hint next to Properties**, but `g p` opens the property switcher (`shortcuts.ts:34-42`) | Agree the map in ux-principles first (e.g. `g o` Overview/Today, `g s` switch property). Hint only bindings that exist |
| P2-17 README overclaims | Status table cites e2e evidence for "sign-out, session-expired handling", but `smoke.spec.ts` tests neither. The a11y checklist ticks "focus lands in opened drawers/dialogs and returns on close" and "Keyboard: everything operable" (both disproved above) | Correct the claims or add the tests (CLAUDE.md §7 honest readiness) |
| P2-18 Timeline lacks the required alternatives | `timeline-page.tsx:42` fixed 21 days, no zoom (RES-R36 hours/days/months), no list view "one keystroke away for screen-reader users" (ux §9); drag gap is documented | Add a list view toggle (shared DataTable on the same data) and zoom levels |

### P3

| id | file:line | note |
|---|---|---|
| P3-1 | `vite.config.ts:23`, `dist/` | Single chunk (288 kB gzip) includes the simulator (~40 kB src), all admin screens and full zod. Public 4.2 MB source maps. → route-level `lazy()`, vendor chunk for cache reuse across deploys, `sourcemap: 'hidden'` |
| P3-2 | `environment-banner.tsx:54` | Unknown environment strings render **no** banner (fails open). Session env is `z.string()` in identity. → show a banner for anything except exactly `'live'` |
| P3-3 | `api/client.ts:103` | Any 401 ends the *current* session, even one from an in-flight request made with a previous token → compare the token used |
| P3-4 | `features/admin/users-page.tsx:126-133` | Roles column shows raw keys (`front_desk`, `org_admin`) → role names |
| P3-5 | `app/shell/navigation.tsx:44` | Rail labels 10 px, VIP tag 10 px; ux-principles §2 minimum body is 14 px in the back office |
| P3-6 | `lib/format.ts:18-32`, `mocks/maldives.ts:503` | `formatMoney` shows "$" while messages say "USD 2136.00" (`toFixed`, no grouping). With USD and MVR both in play, show the code (ux §2). Digits come from Intl; share the kernel's ISO-4217 exponent table instead |
| P3-7 | `playwright.config.ts:24,35-46` | Ports hard-coded, with `reuseExistingServer: true`, so the suite can silently test another branch's server → env-driven ports |
| P3-8 | `arrivals-page.tsx:34-46` | Stat tiles aren't actionable (design direction: numbers drill into records) → make them filter chips |
| P3-9 | `provenance-badge.tsx` | "SIMULATED · last synced now" reads as if something synced → "generated hh:mm" for simulated |
| P3-10 | `api/intent.ts` + `users-page.tsx:71` | The fingerprint masks the password as `'•'`. A resubmit with only a new password reuses the key, and the server answers `idempotency_conflict` (safe but confusing) → include a hash of the secret in the fingerprint |

## What is good (keep)

- Typed client with Zod on every response; `contract_mismatch` instead of trusting unexpected shapes; client `X-Request-Id`, so
  every failure has a reference.
- IntentKeys is correct against `runIdempotent` (failed attempts roll back, the same payload reuses its key, success settles).
  It is wired into both create flows.
- The 409 flow keeps the base snapshot while background refetches run, classifies fields both/mine/theirs, and re-applies only
  mine on the latest ETag. The e2e test runs it against the real API and proves no lost update.
- Simulated data is labelled everywhere I looked: page badge, note, every KPI, record chips, search hits, hover previews, toasts
  ("simulated. Nothing real changed"), preview sections, sample tax lines.
- Environment banner and frame are hatched and non-dismissible; the training banner is distinct.
- DataTable and Timeline virtualize rows (1200-row table: 22 rows in the DOM; Ctrl+End in 246 ms; Timeline renders 27 of 121 rows).
  Pure, well-tested models.
- No inline scripts, no `dangerouslySetInnerHTML`; CSP-ready.

## Spec / owner-direction coverage

| Requirement | State |
|---|---|
| Universal record anatomy (experience §1) | UI side done (`RecordView`). For real types, allowedActions/issues/owner are computed **client-side** (`registry.tsx`), ignoring permissions (FOUNDATION_REQUESTS #3), so they must switch to server facets when modules land |
| Drawer + trail + Esc + full page (§2) | Done, but modal (P1-5) and focus broken (P1-1) |
| Global search + palette (§2, ux §7/§8) | Done for navigation and search; **no record actions** in the palette |
| My work inbox | List only; no handling actions (P1-5) |
| Recent/pinned | Done (localStorage; PII note P2-8) |
| One keyboard map | Done; deviates from ux §7 (P2-16); list keys missing (P1-5) |
| Saved views (ux §9) | Personal and local only (P2-10) |
| Bulk selection / actions (design direction, experience §3, EC-RES-003) | **Missing** (P1-5) |
| helpKeys on every screen (§4/§5.3) | Done and tested |
| Learning centre, first-run checklist, practise in training | Done (website map empty by design) |
| Repeatable screenshots (§4) | Done (but the seed depends on the property UUID, see P2-6) |
| RES-R35 lists: arrivals ✓ (simulated); departures, in-house, **waiting guests** ✗ | Not claimed in the README; Today "Departures" has nowhere to drill to |
| RES-R36 timeline | Partial (no drag by design, no zoom, no list view) |
| WCAG 2.2 AA | Contrast passes on the seeded data; fails 2.4.3, 2.4.11 and 2.5.3, plus the latent contrast failure (P1-1, P2-2…P2-6) |

**Scenario claims.** The S14-pattern 409 claim holds: the e2e test shows the resulting state, version and preserved foreign field.
The arrivals "07:30" scenario and the extend-stay preview are demonstrated on simulated data only. The README rates them R2, which
is honest. The preview's mention of "scenario S03" is internal jargon leaking into a staff screen. Readiness levels in the README
(R3 real, R2 simulated, usability not done) are consistent with the evidence, except the e2e claims in P2-17.

## Cross-module notes for the orchestrator

**Mock vs real contract mismatches** (fix in the adapter before binding live sources):

- **Reservations `frontDeskRow`** (`/home/user/wt/reservations/modules/reservations/src/contracts.ts:593-622`, route
  `routes.ts:398-418`) vs mock `arrivalRow` (`apps/backoffice/src/mocks/contracts.ts:93-123`):
  - **Shape and types:** the response is wrapped (`{date, businessDate, items, counts}`), while the mock returns a bare array.
    `guestName` is nullable. **`eta` is `HH:MM`, not ISO.**
  - **Readiness:** **`readiness` is nullable** (null for non-expected stays). Check keys are `unit_assigned | unit_ready |
    payment_secured | registration | requests`; the mock uses `unit_condition | guarantee | documents | transfer`, so 3 of 5 real
    keys have no i18n label. Statuses are `ok | blocking | unknown` (no `attention`). Open requests are **blocking** in the real
    module and only "attention" in the mock. The blocker is the first non-ok check, where the mock takes the first blocking, else
    the first unknown. `blockingReason` has no owner.
  - **Missing fields** the UI renders: `vip`, `nights`, `unitTypeName` (real has `unitTypeId`), `unitCondition`, `arrivalDetails`,
    `paymentStatus`, `requests`, `owner`. `balance` is nullable. `checkInRun` is `{status: string, remaining: string[]}`, not
    steps.
  - **Stay record families** are keyed `unitCondition`, not `condition`, and `payment` is a free string.
- **Reservations change preview and commit:** see P2-13 (Money per night, alternatives, blockers, `preview_stale` payload, 202
  forwarded, Idempotency-Key).
- **Operations `boardRow`/`board`** (`/home/user/wt/operations/modules/operations/src/contracts.ts:98-153,212-250`) vs mock
  `housekeepingRow` (`mocks/contracts.ts:126-145`):
  - Unit fields are nested under `unit`, with `version`, per-unit `provenance`, `externalSyncedAt`, **`pendingChange`**
    (forwarded writes, so the UI needs a "pending in PMS" rendering) and `readiness{expectedReadyAt, estimateBasis}`.
  - The board is wrapped with `counts`. `unitTypeCode`/`unitTypeId` replace `unitTypeName`, and `sectionName` is nullable.
  - Vocabulary: discrepancy adds **`occupied_no_luggage`**; block kind adds **`house_use`**, plus dates, blockId and workOrderId.
  - `departureToday` is `{stayId, status} | null`, assignees live in `openTasks[]`, and `arrival.earlyCheckIn` is added.
  - The operations provenance enum lacks `delayed`/`incomplete`.
- **Payments** (`/home/user/wt/payments/modules/payments/src/domain/states.ts:8-40`, `presentation.ts`, `contracts.ts:176-182`):
  - Separate state machines for payments, authorizations, requests and disputes.
  - The reservations port forwards `succeeded | authorized | pending_verification | requires_action | requested | failed | unknown
    | none`.
  - The UI payment vocabulary overlaps on only 4 values (P1-3).
  - Payments already serves `statusPresentation`, which the UI should render.

**Shared-code candidates:**

- One status-vocabulary contracts package (kernel `contracts` or `packages/contracts`, FOUNDATION_REQUESTS #1). Today booking,
  stay, condition, occupancy/discrepancy, availability, payment, provenance and money are declared separately in reservations,
  operations, payments, `@portico/ui` `STATUS_VALUES` and the backoffice mocks.
- **provenance** alone has four definitions: operations has 4 values, the reservations preview 2, payments/reservations 6, the
  UI 6. None has `sandbox`.
- The universal-record facet schemas (`recordAction/Issue/Owner/Link`) are duplicated in reservations, operations and payments
  contracts. Move them to kernel and have `RecordModel` map from them.

**Foundation:**

- `/v1/records/:type/:id/history` returns oldest-first with `limit 500` (`apps/api/src/records-routes.ts:154-155`), so the newest
  changes are truncated on busy records. Add `order`/`limit`/cursor, or a `lastChange`.
- FOUNDATION_REQUESTS #3 (effective permissions in `/me`) blocks correct `allowedActions` for real types.

**Merge mechanics:**

- The branch is 91 commits behind main. After merging, run `pnpm install` (the lockfile auto-merge is broken for
  `--frozen-lockfile`) and re-run the Playwright suite on a fresh DB.
- Inventory is already on main, so the Timeline's simulated source should bind to inventory + reservations next.
- ADR-0017 (global identity) landed on main after this branch. Reconcile it with FOUNDATION_REQUESTS #4 (`/me/organizations`) and
  the "Practise in training" re-auth.

## Evidence index (`…/scratchpad/review-backoffice-shots/`)

- `arrivals-1280.png`, `arrivals-1440.png`, `arrivals-1600.png`, `arrivals-1920.png`: current board at desk widths (P1-4)
- `proposal-arrivals-1280.png` (+1440/1600/1920) and `proposal-arrivals-layout.diff`: prototype of the proposed layout (copy only)
- `drawer-focus.png`: drawer open, focus ring still on the background cell (P1-1)
- `cache-leak-after-signin.png`, `cache-leak-users.png`: front-desk agent sees the director's identity and the staff list (P0-1)
- `merged-e2e.log`, `merged-axe-error-context.md`: merged-tree axe failure (P2-6)
- Probe scripts: `…/scratchpad/bo-probe/*.cjs` (layout, keyboard, focus2, drawer-tabs, axe, leak, perf, csp, obscured)
- Logs: `…/scratchpad/bo-*.log`
