# @portico/ui — Portico design system

Accessible React components, design tokens and the operational status vocabularies shared by every Portico
web app (back office now; staff PWA and guest journey later — ADR-0013). Examples ("stories") for every
component render at **`/design-system`** in the back office (`pnpm --filter @portico/backoffice dev`, then
open <http://127.0.0.1:5180/design-system>).

## Principles (CLAUDE.md §10, `docs/product/design-direction.md`, `docs/product/experience-architecture.md`)

- **Tokens in one place.** `src/styles/tokens.css` holds every colour, type size, radius, density and motion
  value (light + dark). Tailwind's default palette is disabled in `theme.css`, so components *cannot* use raw
  colours — rebranding is a token swap (brand is not final, OPEN_QUESTIONS Q1).
- **Calm neutral surfaces, one accent, status colours only for meaning** — and never colour alone: every
  status has an icon + text; provenance and environments also have a hatch pattern.
- **Two voices**: UI text, and the monospace *data voice* (`.pt-data`, `<DataText>`, `<Code>`) for counts,
  codes and IDs. Tabular figures in columns.
- **Separate status vocabularies, never merged** (glossary): booking, stay, occupancy, unit condition,
  availability, payment — each with its own shape grammar (`StatusBadge`).
- **Provenance is visible** (`ProvenanceBadge`: live, simulated, copied, delayed, incomplete, external + last
  sync) and **non-live environments are unmistakable** (`EnvironmentBanner`: persistent, hatched, framed).
- **Failed actions never look successful**: errors and pending outcomes never auto-dismiss (`Toaster`),
  `ProblemAlert` renders RFC 9457 problems with recovery text, retry hint and reference id.
- **Density**: compact (desk boards, tables, timeline) and comfortable (dashboards/touch), user-selectable;
  touch layouts always get ≥ 44 px targets.
- **RTL**: logical CSS properties throughout, Radix `Direction`, mirrored arrow-key navigation.

## Components

| Area | Components |
|---|---|
| Primitives | `Button`, `IconButton` (named + tooltip + shortcut), `Field` (label/description/error wiring), `Input`, `Textarea`, `Select`, `Combobox` (ARIA 1.2), `DatePicker`, `DateRangePicker`, `Calendar` (APG grid), `Popover`, `Tooltip`, `Kbd`, `Dialog`, `Drawer`, `Tabs`, `Toaster`/`useToast`, `EmptyState`, `Skeleton`, `SkeletonList` |
| Operational truth | `StatusBadge` (+ `STATUS_VALUES`), `ProvenanceBadge`, `EnvironmentBanner`, `OfflineIndicator`, `ProblemAlert` (+ `ProblemDetails`) |
| Consequential change | `ConflictDialog` + `classifyConflict`/`reapplyPatch` (409 `version_conflict`), `ChangePreview` (availability / price / taxes / deposits / balance), `StepTracker` (resumable workflows) |
| Lists & calendars | `DataTable` (sort, column + quick filters, column visibility, saved views, filter chips, WAI-ARIA grid keyboard navigation, row virtualization for thousands of rows) with a pure model in `data-table/model.ts`; `Timeline` (units × nights, stays/blocks/holds, lanes for overlaps, virtualized rows, keyboard) with pure layout in `timeline/layout.ts` |
| Navigation | `CommandPalette` (+ `rankCommands`), `EntityLink` (hover/focus preview), `FilterChips`, `HelpButton` (help anchors) |
| Universal record | `RecordView` (header with separate status chips + provenance, next actions — 1–3 buttons + menu, disabled ones say why — issues, owner, details, related, history), `RecordDrawer` (breadcrumb trail, Esc steps back, open full page), `RecordPage`, `HistoryTimeline` |
| Understanding (dashboards) | `KpiTile` (value + delta vs named period + raw counts + definition + drill-down), `SegmentedBar` (≤ 6 parts, status palette with icon+label legend), `SmallMultiples` (one series per chart on a shared scale, keyboard readout, table view) |

Strings: every built-in string is in `src/strings.ts` (English); apps pass translations through
`<UiProvider strings locale dir density weekStartsOn>`.

## Data-viz palette

Chart marks use `--pt-viz-*` tokens: one sequential hue (`#2a78d6` light / `#3987e5` dark) and the fixed status
set (good `#0ca30c`, warning `#fab219`, critical `#d03b3b`, neutral grey). Validated with the dataviz palette
validator against both surfaces (CVD and normal-vision separation pass; warning is sub-3:1 on light by design
and always ships with an icon + label; every chart has a table view or printed values).

## Tests

`pnpm --filter @portico/ui test` — Vitest + Testing Library + axe-core (WCAG 2.x A/AA rules; colour contrast is
checked on real screens by the back-office Playwright suite in light and dark). 73 tests cover every component
family: vocabularies stay distinct, provisional payment states are dashed, keyboard navigation (grid, timeline,
calendar, combobox, palette), RTL mirroring, virtualization, saved views, conflict classification, change
preview staleness, record anatomy, drawer trail, KPI semantics.

## Dependencies (pinned exactly; not in the pnpm catalog)

`radix-ui 1.8.1`, `@tanstack/react-virtual 3.14.22`, `lucide-react 1.61.0`, `clsx 2.1.1`; peers `react/react-dom
^19.3`; dev: `tailwindcss 4.3.3`, `@testing-library/* (react 16.3.3, dom 10.4.2, user-event 14.6.8, jest-dom
7.0.1)`, `jsdom 30.1.3`, `axe-core 4.14.0`, `@vitejs/plugin-react 6.1.2`.
