# Agent run: Steward review: backoffice UI

- Started: 2026-11-07T11:33:42.446Z · last activity: 2026-11-07T12:02:00.528Z
- Turns: 163 · tool uses: 173 · output tokens: 114,193
- Type: general-purpose

## Brief (2026-11-07T11:33:42.446Z)

````text
You are Portico's architecture steward reviewing the FRONT END. Read and follow the review brief at /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/steward-review.md, adapted to a UI codebase.
Branch under review: `feat/backoffice-core` in worktree /home/user/wt/backoffice — `packages/ui` (design system) and `apps/backoffice` (staff web app). Read: apps/backoffice/README.md, packages/ui/README.md, FOUNDATION_REQUESTS.md, and the owner direction docs on main: /home/user/portico/docs/product/design-direction.md (power before prettiness; Fin reference = qualities only), /home/user/portico/docs/product/experience-architecture.md (universal record, drawer navigation, search/palette, My work, help anchors, learning), /home/user/portico/docs/product/ux-principles.md, /home/user/portico/docs/product/personas-and-workspaces.md, ADR-0013, CLAUDE.md §10. Screenshots: apps/backoffice/screenshots/*.png (view them with your Read tool).
Review: (a) correctness/robustness of the API client — Idempotency-Key per intent reused on retry, If-Match/409 ConflictDialog re-apply without losing others' changes, problem+json rendering, 401 handling, no tokens in localStorage if avoidable (judge the session storage choice and XSS exposure; CSP readiness); (b) the mock layer is truly isolated and every simulated datum is labeled; switching to real endpoints is clean; mock contracts vs the real reservations/operations/payments branches (/home/user/wt/reservations, /home/user/wt/operations, /home/user/wt/payments) — list mismatches; (c) accessibility WCAG 2.2 AA: run the Playwright + axe suite yourself (Chromium is pre-installed; `require('playwright')` works — do not install browsers), keyboard-only operation of the arrivals board, drawer, palette, dialogs; focus management; screen-reader labels; colour never the only signal; (d) design-direction adherence and POWER: density, keyboard speed, bulk actions, saved views — and specifically: on the arrivals board the single most important "blocker" text is truncated (e.g. "Deposit charge of USD 2…", "Villa 131 failed inspection…"), and the Stay column is cut off — judge layout priorities for real desk widths (1280–1920) and propose fixes; (e) consistency of status vocabularies, provenance and environment banner; (f) performance basics (bundle size, virtualization for 1000+ rows, query caching); (g) i18n/RTL readiness; (h) tests meaningful vs superficial.
Run: pnpm install, pnpm lint, pnpm typecheck, the ui and backoffice test suites, and the Playwright suite (needs the local API — follow apps/backoffice/README.md; use your own DB name `portico_review_ui` and ports API 4200 / Vite 5280 so you don't collide with anything).
Do not modify the worktree; experiment in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-backoffice-copy. Write your report to /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-backoffice.md (verdict, findings ranked P0–P3 with file:line, screenshots you took to show issues saved next to the report).
````

## Follow-up message (2026-11-07T11:34:03.919Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:08.749Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:09.183Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:09.541Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:14.390Z)

````text
[Image: original 2880x2480, displayed at 2000x1722. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:14.821Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:34:15.204Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:49:46.798Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Follow-up message (2026-11-07T11:49:47.205Z)

````text
[Image: original 2880x1800, displayed at 2000x1250. Multiply coordinates by 1.44 to map to original image.]
````

## Report (2026-11-07T12:02:00.433Z)

````text
## Verdict: merge after fixes. Counts: P0 1 · P1 6 · P2 18 · P3 10

The base is strong. The API client checks every response against the module contracts and gives every failure a reference id. The 409 flow really keeps the other person's change (the Playwright test proves it against the real API). Every simulated datum I found is labelled. One security bug and several accessibility and layout failures must be fixed first. I did not modify the worktree.

**Command results**
- On a copy of the branch, everything passes:
  - `pnpm install`, `pnpm lint` and `pnpm typecheck` (10/10).
  - ui tests 73/73 and backoffice tests 27/27.
  - The Playwright smoke suite 7/7 against the real API (API :4200, Vite :5280, DB `portico_review_ui`).
- `vite build` passes but ships one 938 kB chunk (288 kB gzip) and a public 4.2 MB source map.
- The production build runs under the infra default CSP with no violations.
- The branch is 91 commits behind main:
  - Git merges cleanly, but the merged `pnpm-lock.yaml` breaks `pnpm install --frozen-lockfile`; running `pnpm install` once fixes it.
  - After that, typecheck, lint and unit tests pass.
  - The Playwright suite then fails 1 of 7: a dark-mode colour-contrast failure on Today. It only shows up with some seed data, so the branch is green by luck (P2-6).
- A full axe run (all impacts, including WCAG 2.1 A, the drawer and the palette) finds:
  - a serious "label doesn't match visible text" error on every screen;
  - a serious nested-controls error (18 nodes) in the palette;
  - heading-order on Today and empty headers on the Timeline.

**Top 5 findings**
1. **P0-1: cached data leaks to the next user on a shared desk tab.** The session ends with a 401, and a front-desk agent signs in on the same tab. The app still shows "Account: Group Director" and the director's workspaces. It renders all 10 staff with their emails, which the server refuses this user (403). Cause: the query cache is cleared only on explicit sign-out, and its keys aren't per user (`app-shell.tsx:88-107`, `api/queries.ts`, `sign-in-page.tsx:55`). Fix: clear the cache on every session change and add `userId` to query keys.
2. **P1-1: the record drawer never takes focus.** `bodyRef` is never attached (`record-drawer.tsx:42,50-54`). Focus stays on the board cell behind the scrim, and 17 Tab presses walk hidden background links before reaching the drawer. The README says this works.
3. **P1-4: on the arrivals board you can't read the blocker.**
   - 14 of 14 blockers are truncated at 1280, 1440 and 1600 px, and 11 of 14 at 1920.
   - Stay and Owner are off-screen at 1280 and 1440; the full text is only in a `title` attribute.
   - About 480 px of chrome leaves 7 rows above the fold at 1280×900.
   - I prototyped a fix in the copy (`proposal-arrivals-layout.diff`, `proposal-arrivals-1280.png`): readiness as column 2 on two lines with its owner, condition and payment stacked in one column, stay status only when not "Expected", and no section column for single-item workspaces. At 1280 every column fits and every blocker is readable.
4. **P1-3: the badge vocabularies don't match the real modules, and an unknown value crashes the screen.** The badge throws (`status-badge.tsx:229`) and there is no error boundary. The UI's payment list shares only 4 values with what payments and reservations send (`succeeded`, `processing`, `requires_action`, `recorded_unverified`…). Operations adds `occupied_no_luggage` and `house_use`.
5. **P1-2 / P1-5 / P1-6:**
   - P1-2: a network failure is reported as "nothing was sent… retrying is safe" even when the outcome is uncertain. That breaks the CLAUDE.md §5 "pending verification" rule (`api/errors.ts:37-42`, `ui/strings.ts:27`). There is also no request timeout.
   - P1-5: the shared table has no selection, bulk actions or j/k/x/e keys, which the owner's design direction and the parity P0 "bulk transfer delay" (EC-RES-003) require. The modal drawer blocks the board: moving to the next arrival takes two clicks.
   - P1-6: the simulated data layer is not cleanly swappable. Its interface is typed with simulator types, five screens hard-code the "simulated" note, and one source serves every domain. Against the real reservations contract, the arrival time is `HH:MM` and readiness can be null; both crash the board cells once wired.

**Other notable P2s:**
- Today's numbers are padded and contradict the boards (`maldives.ts:1160-1167`).
- In-house guests show "Ready for check-in".
- A booking status falls back to "confirmed" when unknown (`registry.tsx:355`).
- Focus goes to the page body after the palette, search or a dialog closes.
- Focus can end up hidden under the sticky top bar (WCAG 2.4.11).
- The axe gate in the Playwright suite is too narrow.
- Conflict-flow edge cases: a silent failure, a re-apply loop, and wrong "changed by" attribution, because record history returns the oldest 500 entries.
- Guest names stay in localStorage after sign-out.
- The simulator also runs inside live organizations.
- Saved views are personal and can't be linked.
- The board filter can't find a booking code.
- Plurals, date formats and right-to-left text isolation are missing.
- `g d` opens Today, but the UX principles reserve it for Departures.
- The README claims Playwright coverage of sign-out and session expiry that doesn't exist.

**Mismatches with the real branches** (detailed in the report's cross-module section):
- **Reservations front-desk row:** a wrapped response, different readiness keys and statuses, nullable readiness and guest name, and missing vip, condition, payment, arrival details and owner. The change preview carries Money per night, alternatives and a stale-preview payload, and commit can return 202 "forwarded".
- **Operations board row:** nested unit fields with a version, per-unit provenance and pending forwarded changes.
- **Payments:** separate state machines, plus a server-computed status label and tone the UI should render.

**Shared-code candidates:**
- One status-vocabulary and provenance package; provenance alone has four definitions today, and none includes `sandbox`.
- The record facet schemas (actions, issues, owner, links), now duplicated in three modules.

Files are in /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad:
- review-backoffice.md (full report: findings ranked with file:line and fixes, spec coverage)
- review-backoffice-shots/ (screenshots, prototype diff, merged-run failure output)
- bo-probe/ (Playwright probe scripts)
- bo-*.log (command logs)
````

