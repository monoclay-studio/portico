# 05 — Market deep dive: hospitality technology 2024–2026 (index)

Prepared for: Portico (Monoclay LLC) · Research date: 2026-11-07 · Status: v1
Scope owner: research agent (worktree `docs/market-deep-dive`) · Feeds: `docs/research/05-digest.md`

This report goes **broader and deeper than research files 01–04** and the parity matrices. It does not repeat
feature-level parity (that lives in `docs/parity/`) or the vendor basics already captured in
`docs/research/01..04` and `docs/product/competitive-synthesis.md`. Where a finding only confirms or updates an
earlier file, it says so and cites the earlier section (R01–R04).

## Files

| File | What it covers |
|---|---|
| [01-market-structure.md](01-market-structure.md) | Market size disagreements, concentration, analyst positions, chain PMS decisions, funding and M&A 2024–2026, public-company financials, structural forces |
| [02-vendor-profiles-enterprise.md](02-vendor-profiles-enterprise.md) | Oracle OPERA Cloud release-by-release evolution 24.2→26.4 (primary docs), OHIP as it really is (3,580 operations, limits, approvals), Agilysys, Shiji, Infor, Amadeus, SynXis, Access Group |
| [02-vendor-profiles-cloud-smb.md](02-vendor-profiles-cloud-smb.md) | Mews (OS launch, 2026 Connector API changelog, Exports API), Apaleo (MCP ~260 tools), Cloudbeds (Signals), SiteMinder FY26, Stayntouch, RoomRaccoon, Little Hotelier, eZee, protel, Hotelogix |
| [02-vendor-profiles-adjacent.md](02-vendor-profiles-adjacent.md) | Connected stack: RMS/intelligence, guest messaging and AI front office, CRM/marketing/reputation, payments, housekeeping/operations, POS/F&B, integration platforms and migration specialists |
| [03-academic-research.md](03-academic-research.md) | Academic and institutional research: PMS usability and acceptance, workforce/technostress, self-service, revenue management and overbooking, cancellation prediction, channel economics and parity clauses, generative AI, sustainability |
| [04-patents.md](04-patents.md) | Patents that could constrain or inspire designs (room assignment, demand models, folio routing, housekeeping scheduling, upsell, keys/kiosks, parity monitoring) — **not legal advice** |
| [05-technology-trends-ai.md](05-technology-trends-ai.md) | AI in hotel operations 2024–2026: vendor AI features, MCP and agents, agentic distribution (ChatGPT apps, Google AI Mode), regulation and standards trends |
| [06-pricing-and-go-to-market.md](06-pricing-and-go-to-market.md) | Short: observed price points and go-to-market patterns (shrunk at owner request; migration took its place) |
| [07-implementation-and-support.md](07-implementation-and-support.md) | Implementation timelines, support models, training evidence, release management, failure modes |
| [08-customer-evidence.md](08-customer-evidence.md) | Awards, analyst reports, satisfaction and switching surveys, case studies — with sponsorship caveats |
| [09-regional-maldives-indian-ocean.md](09-regional-maldives-indian-ocean.md) | Maldives market numbers 2024–2026, segments, systems in use, payments rails, e-invoicing signals, macro risk, Indian Ocean context |
| [10-bibliography.md](10-bibliography.md) | Every source, keyed (e.g. `[ORA-RR-26.4]`), with organisation, title, date, URL, accessed 2026-11-07 |
| [11-one-button-migration.md](11-one-button-migration.md) | **Owner priority:** one-button migration from OPERA (legacy V5 and Cloud) and other PMSs — access paths, limits, market tooling, failure modes, what can and cannot be automated, OPERA→Portico mapping tables, proposed design |
| [../05-digest.md](../05-digest.md) | Decision digest fed back into the process (findings, per-module implications, one-button migration, risks/patents, open debates) |

## Method

1. **Phased searching.** Broad market queries first (market size, analyst reports, funding, M&A), then follow-up
   queries on each extracted name, product, institution and technical term (e.g. "OHIP async APIs",
   "OCMO", "Mews Exports API", "US 11,514,374").
2. **Primary sources first.** Where the network allowed it, primary documents were downloaded and parsed:
   - Oracle OPERA Cloud *Release Readiness Guides* for **twelve releases (24.2 → 26.4)**, parsed into
     per-release feature counts and AI/large-scale feature lists.
   - Oracle Hospitality Integration Platform (OHIP) user guide pages (async APIs, Data APIs, limits, partner
     connections) and the **public OpenAPI specifications** (`oracle/hospitality-api-docs`, v26.3) — 45 property
     API modules, 3,580 operations, enumerations for profile types and reservation statuses.
   - Oracle's *OPERA to Cloud Migration (OCM)* release notes and customer guide (PDF), the OHIP datasheet and an
     Oracle Consulting deck on "Journey to OPERA Cloud".
   - Mews Connector API changelog (2026) and Exports operation; Apaleo developer portal (AI/MCP page, rate limits).
3. **Everything else** (trade press, analyst summaries, academic abstracts, patents, statistics) came through a
   web-search tool that returns summaries of the cited pages. These are labelled `[S]`.
4. **Exhaustive extraction** of metrics, methods, timelines, conflicts and open debates, each tied to a
   bibliography key.

## Evidence labels (used in every file)

| Label | Meaning |
|---|---|
| **[V]** | Verified by reading the primary document itself in this session (file saved in the scratch directory). |
| **[S]** | Stated by the cited source as surfaced through search-result summaries; full text not read. |
| **[VC]** | Vendor claim (press release, vendor blog, vendor-commissioned study). |
| **[3P]** | Third-party aggregator, review site, consultancy or vendor-sponsored survey — directional only. |
| **[C]** | Conflicting evidence; the conflict is described. |
| **[I]** | Inference or recommendation by the author. |

## Limitations (read before relying on numbers)

- Network access in this session allowed direct fetches only of `docs.oracle.com`, `oracle.com`,
  `docs.mews.com`, `help.mews.com`, `apaleo.dev` and public GitHub clones. Trade press (Hospitality Net,
  PhocusWire, Skift, Hotel Tech Report), academic publishers, Google Patents/USPTO and government statistics sites
  were **not** directly reachable; their content is from search summaries `[S]`.
- Paywalled analyst reports (IDC MarketScape, Phocuswright, Skift Research) were not read; only vendor and press
  summaries of them.
- Patent status (granted/pending/abandoned) and assignee fields were confirmed only where a search summary
  quoted them. **Nothing in 04-patents.md is a legal opinion**; freedom-to-operate questions go to counsel (Q40).
- Survey statistics from vendor-sponsored studies (Hotel Tech Report, NYU/Stayntouch/IDeaS, Cloudbeds/NYU,
  IDC/Mews) are labelled with their sponsor; several have internal inconsistencies, which are noted.
- Scraped pages were treated as untrusted data; nothing from them was executed.

## Continuation plan (what a further pass should add)

Nothing in the requested scope is missing a file. A further pass, ideally with the trade-press and patent hosts
allowed in the network settings, should:

1. Read the full texts of the HTR 2026 PMS Impact Study, NYU 2026 Hotel Technology Outlook and Cloudbeds/NYU PMS
   UX report to resolve the sample-size and percentage conflicts noted in 08.
2. Confirm legal status, assignee and claims of each patent in 04 on USPTO/Espacenet, and have counsel review
   US 11,514,374 and US 2017/0124610 (Q40).
3. Pull Maldives Ministry of Tourism monthly statistics and MMA quarterly bulletins directly (09) and confirm
   MIRA e-invoicing regulation texts and dates.
4. Run a live OHIP sandbox test of the async reservation and Data API paths to measure real extraction times for a
   100- and 400-room property (11 §6).
