# Design direction

> Owner direction (2026-11-07): the owner likes how **simple, minimal yet aesthetic** Intercom's Fin analytics
> dashboard is — **as a reference only**. Do not copy its look, layout or branding. **Power comes before looking
> pretty.** This page extracts the *qualities* worth having and states how Portico applies them. It complements
> `docs/product/ux-principles.md` (interaction rules) and CLAUDE.md §10.

## Priority order (when they conflict)

1. **Correct and honest** — the screen never implies something that isn't true (status, provenance, freshness).
2. **Powerful and fast** — dense where work is dense, keyboard-first at the desk, few clicks, bulk actions.
3. **Clear** — one obvious next action per record, calm hierarchy, nothing decorative competing for attention.
4. **Beautiful** — restraint, rhythm and typography; never at the cost of 1–3.

## Qualities we take from the reference

| Quality observed | Why it works | How Portico applies it |
|---|---|---|
| **One big number, with its denominator** ("62% · 5,181 out of 8,356") | The headline is honest: you see the ratio *and* what it is a ratio of | Every KPI tile shows value, delta vs comparison period, and the raw counts behind it. Clicking drills into the records (brief §13). |
| **Info icon next to each metric name** | Definitions are one hover away, not a separate manual | Every metric links to its definition, period, currency treatment and source (analytics spec). |
| **Two voices: UI text vs data annotations** (small monospace uppercase labels for counts) | Data reads as data; labels never get confused with controls | Tabular figures everywhere numbers align; a monospace "data voice" for counts, codes and IDs (confirmation codes, unit numbers, amounts in tables). |
| **Calm surfaces, one accent, semantic colours only for meaning** | Colour carries information, so there is little of it | Neutral surfaces; one brand accent for focus/selection; status colours reserved for meaning and **always paired with text/icon** (WCAG — colour is never the only signal). |
| **Few, well-chosen visual forms**: flow diagram for "where things went", treemap for volume × quality, small multiples for trends | Each chart answers one question | Flow (Sankey) for booking funnel & channel → outcome; small multiples for occupancy/ADR per property or unit type; treemap for request topics or revenue mix. No pie charts, no 3-D, no chart without a question. |
| **Two-level navigation**: icon rail for areas + section list | Large product, still feels small | Rail = workspaces (Front desk, Reservations, Housekeeping, Finance, Revenue, Admin…); section list shows only what the role and property profile enable (progressive disclosure). |
| **Page header = title + date range + filter chips** | Context is always visible and editable in place | Every list/dashboard header shows property, business date/date range, active filters as removable chips, and the saved view name. |
| **Generous padding inside cards, tight grid between them** | Dense information without clutter | Two density modes: *comfortable* (dashboards, mobile) and *compact* (desk tables, timeline) — user-selectable, remembered per user. |

## What we deliberately do differently

- **Light and dark themes, both first-class.** Front desks in bright lobbies need light; night audit and
  back offices may prefer dark. Neither theme may drop below WCAG 2.2 AA contrast — muted grey-on-grey text that
  looks elegant but fails contrast is not allowed.
- **Operational screens are not dashboards.** Arrivals boards, the timeline, folios and housekeeping boards are
  working surfaces: dense tables, inline actions, keyboard navigation, bulk selection — dashboards are for
  understanding, boards are for doing.
- **State is louder than decoration.** Environment banners (demo / trial / training / sandbox), provenance badges
  (simulated, copied, delayed, incomplete, external) and blocking problems are always visible and unmistakable.
- **No empty minimalism.** Hiding a needed control to look clean is a defect. Progressive disclosure removes what a
  role/property does not need — never what it does.

## Tokens (brand not final — rebrand is a token swap)

Neutral grey scale (11 steps) · one accent · semantic set: success, warning, danger, info, plus neutral for
"not applicable" · status palettes per status family (booking, stay, occupancy, unit condition, availability,
payment) that are visually distinct from each other · type scale with a display size for KPI numerals,
tabular-lining figures, and a monospace family for data annotations · 4-px spacing grid · radius scale small
(controls) / medium (cards) · elevation via surface tone, not heavy shadows · motion ≤ 200 ms, respects
reduced-motion.
