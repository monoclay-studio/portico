# @portico/backoffice — staff web app

React 19 + Vite SPA for desk staff, reservations, housekeeping supervisors, managers and administrators
(ADR-0013). Built on `@portico/ui`. Talks to the real Portico API for everything that exists on `main`, and to an
isolated, clearly labelled **simulated** data layer for the operational workspaces whose modules are still being
built in wave 1.

## Status (wave 1)

| Area | State | Evidence |
|---|---|---|
| Sign-in incl. organization selection, session, sign-out, session-expired handling | **Real** (POST /v1/auth/login, /v1/auth/logout, 401 handling) | e2e `smoke.spec.ts` |
| `/v1/me`, organization, properties + switcher, legal entities (create with Idempotency-Key), users & roles (invite with Idempotency-Key) | **Real** | e2e smoke, Vitest client tests |
| Property settings with `If-Match` and the **409 ConflictDialog** (yours vs theirs, re-apply on latest version) | **Real** | e2e smoke (`409 version conflict`) |
| Global search (`/`) + command palette (`Ctrl/⌘K`) on `GET /v1/search`; hover previews on `GET /v1/records/:type/:id/summary`; record history on `GET /v1/records/:type/:id/history` | **Real** for property (+ legal entity history); other types plug in as modules register search providers | e2e smoke |
| Front-desk arrivals board (readiness + single blocker), housekeeping board, reservations timeline, change preview (extend stay), Today dashboard, My work inbox, stay/unit/guest records | **SIMULATED** (`src/mocks`) — badged SIMULATED on every screen and record | Vitest `maldives.test.ts`; e2e screenshots |
| Learning layer: help anchors on every screen, help panel, learning centre (role paths + progress), first-run checklist, "Practise in training" | Implemented; website content map empty (by design) | Vitest `app.test.ts`; screenshots |

Readiness (CLAUDE.md §7): the real integrations above are **R3** (implemented and tested internally against the
local API). The simulated workspaces are **R2** (demonstrated with sample data) — they are *not* integrations.
No usability validation with real staff has been done yet (that is a separate column).

## How to run

```bash
pnpm install
export DATABASE_URL=postgres://postgres@127.0.0.1:5432/portico_w1_ui
export APP_DATABASE_URL=postgres://portico_app:portico_app_dev@127.0.0.1:5432/portico_w1_ui
pnpm migrate                                                # creates the DB if needed
pnpm --filter @portico/backoffice seed:dev                  # demo orgs + a training org (idempotent)
PORT=4100 pnpm --filter @portico/api exec tsx src/main.ts   # API on :4100
pnpm --filter @portico/backoffice dev                       # Vite on :5180 (proxies /v1 → :4100)
```

Open <http://127.0.0.1:5180>, sign in as `group.director@demo-azure-atoll.demo.portico.invalid` / password
`portico-demo-2026` (demo environment only — printed by `seed:demo`). The account belongs to the demo and the
training organization, so sign-in shows **organization selection**. Other seeded staff (front desk, housekeeping
supervisor, reservations agent, …) use the same password and see their own role workspaces.
`PORTICO_API_URL` overrides the proxy target. CLAUDE.md lists `:5173`/`:4000` defaults; this wave uses 5180/4100
so parallel agents never collide.

Tests:

```bash
pnpm --filter @portico/backoffice test        # Vitest (no database needed): 27 tests
pnpm --filter @portico/ui test                # design system: 73 tests (Testing Library + axe)
pnpm --filter @portico/backoffice e2e         # Playwright smoke against the real API (starts API + Vite if needed)
pnpm --filter @portico/backoffice screenshots # regenerates screenshots/ at deviceScaleFactor 2
```

Playwright uses the pre-installed Chromium (`PLAYWRIGHT_BROWSERS_PATH`); `@playwright/test` is pinned to 1.63.0
to match it. Global setup migrates and seeds; login is rate-limited (20/min), so tests sign in once per worker
over the API and inject the session (only the sign-in tests use the form).

## Architecture

```
src/
  api/          typed client (Zod contracts from @portico/platform|identity/contracts), problem+json → ApiError,
                IntentKeys (Idempotency-Key per user intent), ETag/If-Match, session (sessionStorage), connectivity
  app/          router (TanStack Router), providers (Query, i18n, UiProvider), shell (workspace rail + section list,
                property switcher, search/palette, user menu), workspaces (role → navigation), ONE shortcut
                registry (shortcuts.ts → bindings + ? overlay), screen verbs (N = new), theme, density
  records/      record type registry (universal record anatomy per type), RecordHost (drawer over any screen,
                trail in the URL `?record=type:id,…`), RecordLink (EntityLink bound to the API), recent/pinned
  learning/     help anchors → website map (empty), help panel, learning paths, first-run checklist, progress
  features/     sign-in, today, my-work, learn, front-desk, housekeeping, reservations, settings, design system
  data/         sources.ts — the binding table: which workspace domain is simulated vs live
  mocks/        ISOLATED simulated data layer: provisional Zod contracts, Maldives simulation, adapter
  i18n/         en (source) + ar (RTL stub)
```

- **Contracts**: real calls validate responses with the modules' Zod schemas; an unexpected shape becomes a
  `contract_mismatch` problem instead of being trusted. `/v1/search`, `/summary`, `/history` and `/v1/roles` have
  no exported contracts on main yet, so their schemas are mirrored in `api/endpoints.ts` (see Foundation requests).
- **Idempotency**: `IntentKeys` creates one key per intent; retries of the *same* payload reuse it (so
  "Try again" after a timeout can never duplicate), a changed payload gets a new key, success settles it.
- **Optimistic concurrency**: reads keep the ETag version; PATCH sends `If-Match`; a 409 `version_conflict`
  loads the latest version and its last audit entry (who/when), classifies every field (both / mine / theirs)
  and re-applies the chosen fields with the new version — their change survives, nothing is silently lost.
- **Records open in a drawer** over the current screen (filters and scroll stay), with a breadcrumb trail;
  `Esc` steps back; `Shift+Enter` / the button opens the full page; the trail is in the URL (deep-linkable).
- **One keyboard map**: `/` search, `Ctrl/⌘K` palette, `?` shortcuts, `N` new (screens register it), `E` edit the
  open record, `G` then a key to go to a screen, `G P` property switcher.
- **Learning layer**: every screen passes a stable `helpKey` (`<module>.<screen>[.<element>]`) to its header;
  tables, timeline, sections and forms carry `data-help-key`. `learning/help-map.ts` resolves keys (with parent
  fallback) to article/video URLs — empty until the website publishes courses.
- **Switching to real endpoints**: implement `WorkspaceDataSource` (`mocks/adapter.ts` interface) with the
  merged module's contracts and bind it in `data/sources.ts`. Screens do not change; provenance flips from
  SIMULATED to live because it comes from the source, never from the screen. The provisional contracts in
  `mocks/contracts.ts` follow the in-progress `reservations.frontDeskRow` and `operations.boardRow` shapes.

## Real vs mocked (exactly)

| Real (API on main) | Simulated (`src/mocks`, labelled SIMULATED) |
|---|---|
| Sign-in, org selection, sessions, `/me`, organization, properties, property PATCH + 409, legal entities, users, roles, search (property provider), record summaries & history (property/legal entity) | Arrivals + readiness, housekeeping board, timeline, extend-stay preview/commit, stay/unit/guest records, Today KPIs, My work, simulated guest/booking search results |

Simulated sample content: a 120-villa resort (Beach / Water / Sunset Water villas, residences), a 12-room
guesthouse, a hotel and apartments; seaplane / speedboat / domestic-flight arrivals via Velana International
Airport, a delayed seaplane, a failed inspection, a payment pending verification, missing passport details. Guest
names are invented. Tax lines in the preview are labelled *sample* — real taxes are rates-module data.

## Accessibility checklist (WCAG 2.2 AA)

- [x] Colour contrast AA in **light and dark** — axe (incl. `color-contrast`) on Today, Arrivals, Housekeeping,
      Users in both themes: no serious/critical violations (e2e smoke).
- [x] No colour-only meaning: status = icon + text + shape; provenance/environments add hatching; chart parts have
      labels, legend names and table views.
- [x] Visible focus (2 px ring, offset) on every control; skip link; focus lands in opened drawers/dialogs and
      returns on close.
- [x] Keyboard: everything operable; WAI-ARIA grid navigation in DataTable and Timeline (arrows, Home/End,
      PageUp/Down, Enter), calendar grid, combobox, command palette; one shortcut map shown with `?`.
- [x] Names and descriptions: icon buttons named; disabled actions keep their reason as an accessible
      description; fields wire label/description/error; live regions for offline state, counts and results.
- [x] Touch targets ≥ 44 px on coarse pointers / phone widths (density tokens); phone layouts switch tables to cards.
- [x] Reduced motion honoured; no flashing content.
- [x] RTL: logical properties, mirrored keyboard navigation, `dir` on `<html>` (Arabic stub).
- [x] Errors explain what happened and how to recover, with a reference id; failed/pending outcomes never
      auto-dismiss.
- [ ] Screen-reader walkthroughs (NVDA/VoiceOver) and usability sessions with real staff — not done yet.

## Screenshots (`screenshots/`, deviceScaleFactor 2)

`sign-in`, `sign-in-choose-organization`, `today-light`, `today-dark`, `arrivals-board`, `record-drawer-stay`,
`record-drawer-trail`, `change-preview`, `timeline`, `housekeeping-board`, `my-work`, `search-palette`,
`keyboard-shortcuts`, `conflict-dialog` (a real 409 from the API), `environment-banner-demo`,
`environment-banner-training`, `learning-centre`, `help-panel`, `arrivals-rtl`, `arrivals-tablet`,
`arrivals-phone`, `design-system`.

## Dependency versions (pinned exactly; candidates for the pnpm catalog)

react / react-dom 19.3.1 · vite 8.3.5 · @vitejs/plugin-react 6.1.2 · @tanstack/react-router 1.170.46 ·
@tanstack/react-query 5.104.5 · @tanstack/react-virtual 3.14.22 · tailwindcss / @tailwindcss/vite 4.3.3 ·
radix-ui 1.8.1 · react-i18next 17.1.5 · i18next 26.5.7 · lucide-react 1.61.0 · clsx 2.1.1 · @types/react(-dom)
19.3.0 · @testing-library/react 16.3.3 · @testing-library/dom 10.4.2 · @testing-library/user-event 14.6.8 ·
@testing-library/jest-dom 7.0.1 · jsdom 30.1.3 · axe-core / @axe-core/playwright 4.14.0 · @playwright/test 1.63.0
(matches the pre-installed Chromium revision 1243). All were published at least two weeks before 2026-11-07.

## Known gaps

- Saved table views, recent/pinned records, density, learning progress are per-browser (localStorage) until a
  preferences/learning API exists. The session token lives in sessionStorage (per tab; cleared on browser close).
- Workspace navigation is derived from role keys (`/v1/me` returns roles, not effective permissions); the server
  still enforces every permission.
- "Practise in training" re-authenticates with the password: no endpoint lists the account's organizations
  after sign-in.
- Timeline is click/keyboard driven; drag-to-move with change preview arrives with the reservations module.
- Only the Arabic stub exists as an RTL locale; it is unreviewed.

## Open questions for the owner

1. **RTL staff locale**: Dhivehi (`dv`, Thaana) is the likely Maldives staff language; the Arabic stub only proves
   RTL. Default: English UI; commission a reviewed Dhivehi translation before any pilot.
2. **Brand** (Q1): tokens use a placeholder calm teal-blue accent; the final brand is a token swap.
3. **Shared desk computers**: default is per-tab sessions (sign in again after closing the browser). Some hotels
   may want "stay signed in on this device" — needs a policy decision.

## Foundation requests

See `FOUNDATION_REQUESTS.md`.
