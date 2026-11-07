# Competitive parity and edge-case coverage

**Purpose:** make sure no module ships weaker than what hotels already have. Owner direction (2026-11-07): "we
can't miss anything that current systems on the market do to remain competitive" — and cover everything that
could possibly arise.

## The four checks

1. **Parity matrix (per module)** — every capability competitors offer, at feature level, with evidence from the
   competitor's **official documentation** (OPERA Cloud user guides, Mews help & API docs, Apaleo API, Cloudbeds,
   SiteMinder, Stayntouch, Shiji, Agilysys, Infor, Guesty, RMS, RoomRaccoon, Little Hotelier, eZee, protel…) and
   Portico's status. OPERA Cloud's documentation is the baseline inventory (it is the deepest system); modern
   systems add the ease/automation rows.
2. **Edge-case catalogue (per module)** — every unusual, failure or "2 a.m." situation that could arise, the exact
   expected Portico behavior, and the test that proves it.
3. **Gates** — a module cannot be called complete (CLAUDE.md §7) while any **P0** parity row or **P0** edge case is
   not `tested`, or any **P1** row is neither `specified` nor explicitly `deferred`/`different` with a reason the
   owner can see. The architecture steward checks this on every merge; `pnpm parity` reports it.
4. **Refresh** — competitors ship continuously. Each quarter (and before any sales push) review their release
   notes / "what's new" pages and add rows. Rows record the verification date.

Beyond documentation: hotel RFP checklists, user reviews (complaints reveal missing capabilities) and real hotel
staff walkthroughs (OPEN_QUESTIONS Q64) feed the same matrices.

## File format (machine-checked by `tools/parity-report.mjs`)

One file per module: `docs/parity/<module>.md` with two tables. Column order is fixed.

```
| ID | Capability | Market evidence | Priority | Status | Spec | Test |
|---|---|---|---|---|---|---|
| PAR-RES-001 | Split a stay across two room types | OPERA [guide](url) · Mews [help](url) | P0 | specified | reservations.md R-12 | — |

| ID | Situation | Expected Portico behavior | Priority | Status | Test |
|---|---|---|---|---|---|
| EC-RES-001 | Guest arrives after midnight before Day Close has run | Stay is checked in on the current business date; arrival night charge posts once | P0 | missing | — |
```

- **Priority:** `P0` = required to compete / run a pilot; `P1` = expected by full-service hotels, resorts or groups;
  `P2` = valuable differentiator or rare need.
- **Status:** `missing` → `specified` → `building` → `built` → `tested`; or `deferred` (with reason/date),
  `different` (we deliberately do it differently — say how in the spec), `n/a` (does not apply to Portico).
- **Market evidence:** competitor name + link to its official documentation, "verified YYYY-MM-DD". No evidence →
  write `assumption`.
- **Better, not just equal:** where Portico intends to beat the market on a row, say how in the spec (fewer steps,
  preview, automation, honesty about state).
