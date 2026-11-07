# @portico/backoffice — staff web app

## Checkpoint

**Done (typechecks clean; packages/ui has 63 passing Vitest+axe tests):**
- `packages/ui`: tokens (11-step grey scale, light/dark, density, data voice, viz tokens), Button/IconButton, Field/Input/Select/Combobox,
  DatePicker/DateRangePicker, Dialog/Drawer/Toast/Tooltip/Tabs, StatusBadge (6 separate vocabularies), ProvenanceBadge,
  EnvironmentBanner, ProblemAlert, ConflictDialog (+ classifyConflict), ChangePreview, StepTracker, DataTable (virtualized,
  saved views, filter chips), Timeline, CommandPalette, EmptyState/Skeleton, OfflineIndicator, KpiTile, SegmentedBar,
  SmallMultiples, RecordView/RecordDrawer/RecordPage/HistoryTimeline/EntityLink, HelpButton, examples page.
- `apps/backoffice`: typed API client (Zod contracts, problem+json, Idempotency-Key per intent, If-Match), session, sign-in with
  organization selection, app shell (workspace rail + section list, property switcher, global search `/` + palette ⌘K wired to
  GET /v1/search, one shortcut registry + ? overlay, environment banner, offline indicator, help panel), record drawer with
  URL trail (`?record=`), recent/pinned records, Today dashboard, My work, Learning centre + first-run checklist + practise in
  training, arrivals / housekeeping / timeline (SIMULATED data layer in `src/mocks`), settings pages incl. real 409 conflict flow.
- `scripts/seed-dev.ts` seeds demo orgs + a training org (run once; idempotent).

**In progress:** first run in a browser (API :4100, Vite :5180), Biome lint, backoffice Vitest tests, Playwright smoke + screenshots.

**Next steps:** fix runtime issues found in the browser; `npx biome check --write packages/ui apps/backoffice`; write
`src/**/*.test.ts(x)` (api client, intent keys, readiness, workspaces, i18n parity); `e2e/smoke.spec.ts` + `e2e/screenshots.spec.ts`;
full README (architecture, run, a11y checklist, real vs mocked).

**Known failing tests:** none known (backoffice tests not written yet).
