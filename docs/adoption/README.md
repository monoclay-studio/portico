# Adoption and integration (docs/adoption)

Deliverables required by `docs/product/adoption-integration-brief.md` §15: how hotels evaluate, connect to,
gradually adopt and migrate to Portico. Status date of all documents: **2026-11-07**. Nothing described here is
built yet beyond the foundation (platform, identity, data authority, environments); every integration and
migration capability is at readiness **R1 (planned)**.

## Documents

| # | Document | Answers | Brief § |
|---|---|---|---|
| 1 | [gap-assessment.md](gap-assessment.md) | What exists, what is missing, what is internal vs external; findings in the implemented foundation (G-01..G-14) | §15 |
| 2 | [adoption-paths.md](adoption-paths.md) | The three paths defined by data authority; module-by-module dependencies; **standalone module catalogue** (SM-01..SM-10); representative setups RS-1..RS-4 | §2 |
| 3 | [source-of-truth-matrix.md](source-of-truth-matrix.md) | Which system controls each domain per path and setup; coordination rules CR-1..CR-10; authority transition (cutover) protocol and in-flight bookings | §2, §8 |
| 4 | [evaluation-and-trial.md](evaluation-and-trial.md) | Demo → trial → read-only connection → pilot → production; labeling; what can never happen per stage; reset/export/delete; carry-forward; showing value with the hotel's own data | §3, §4 |
| 5 | [integration-coverage-matrix.md](integration-coverage-matrix.md) | Workflow catalogue, segment denominators, provider × workflow matrix with access model, sync mode, costs, limitations, tiers P0/P1/P2 | §5, §6 |
| 6 | [connection-lifecycle-and-health-spec.md](connection-lifecycle-and-health-spec.md) | 9-step setup journey, mapping suggestions, validation, preview, activation; health, urgent vs routine, safe operations; delayed/duplicate/out-of-order/missing handling; no blind replay; data model; error standard | §7, §8, §9 |
| 7 | [migration-acceptance-criteria.md](migration-acceptance-criteria.md) | Feasibility, mapping, quality, rehearsals, numeric reconciliation targets, exceptions, final capture, sign-off, cutover, rollback, archive; per-source notes | §10 |
| 8 | [rollout-requirements.md](rollout-requirements.md) | Independent-property simplicity vs enterprise control (RR-01..RR-16); local connector and outage behavior | §11, §12 |
| 9 | [ecosystem-and-developer-experience.md](ecosystem-and-developer-experience.md) | Partner OAuth apps, sandboxes, docs, errors, versioning, risk-based approval, verification, support, removal, listing rules | §13 |
| 10 | [success-metrics.md](success-metrics.md) | Baselines and **targets** for the 12 metrics; anti-gaming rule; competitor comparison method | §14 |
| 11 | [roadmap.md](roadmap.md) | Milestones AM-0..AM-6, internal vs external tracks, critical path | §15 |

## Key decisions in this folder

- **Paths are defined by data authority.** Path A = Portico authoritative for no governed domain; Path B = one or
  more domains moved to Portico (e.g. `roomStatus`); Path C = Portico is the PMS. Testable from
  `platform.data_authority`.
- **Standalone (connected-mode) catalogue:** housekeeping (SM-01), maintenance (SM-02), tasks (SM-03), guest
  messaging (SM-04), reporting over an external PMS (SM-05), transfers (SM-06); conditional later: group sales
  without blocks, guest recognition, payment links to external folios, activities/spa. **Not standalone:**
  inventory/rates/reservations individually, finance, payments (at launch), distribution, Day Close, group room
  blocks, meal-plan entitlements, AI as a product.
- **Housekeeping alongside a PMS defaults to `roomStatus` = external + forward**; Path B (Portico-owned status
  with the safe-direction rule) is opt-in.
- **Representative setups first:** RS-1 guesthouse fully on Portico; RS-3 group keeping OPERA Cloud with Portico
  housekeeping + messaging; RS-2 resort keeping POS, accounting and spa.
- **P0 for a Maldives pilot:** spreadsheet/CSV and OPERA migration importers; Channex hub (Booking.com, Expedia,
  Agoda); email + WhatsApp; recorded payments (acquirer adapter pending Q2); journal file export; MIRA return
  data; OHIP for RS-3; Portico POS posting API plus one POS interface for RS-2.

## Evidence labels

| Label | Meaning |
|---|---|
| **[V r0N]** / "verified 2026-11-07" | Stated in `docs/research/0N-*.md` with the cited URL, verified on 2026-11-07 from search-engine extracts (direct fetches were blocked; see each report's limitations) |
| **[V2 r0N]** | From secondary sources in that report |
| **[VC]**, **[3P]**, **[BK]** | Vendor claim, third-party source, background knowledge — as defined in the research reports |
| **[Unconfirmed]** | Not verified; must be checked with the vendor before any claim |
| **[Assumption]** | Our planning assumption (often: which systems Maldivian hotels use) |
| **TARGET** | Proposed target, not a measured result |

During this session, further web research was not possible (search budget exhausted; `channex.io` and
`developer.xero.com` did not resolve from the sandbox). No new vendor facts were added beyond the research
reports; everything else is labeled.

## Identifier conventions

`G-` gaps · `SM-` standalone modules · `RS-` representative setups · `CR-` coordination rules · `ST-`, `EV-`,
`CL-`, `MG-`, `RO-`, `EC-` acceptance tests · `W-` workflows · `RR-` rollout requirements · `M-` metrics ·
`AM-` roadmap milestones · `R1..R9` readiness levels (CLAUDE.md §7) · `P0..P2` priority tiers.

## Proposed glossary additions

`docs/product/glossary.md` is the single source of terms. These terms are used in this folder and should be added
there (by the glossary owner) — they are not yet official:

| Term | Meaning |
|---|---|
| **Environment** (amend) | Add `trial` (isolated organization holding an authorized copy of a hotel's data) and `sandbox` (partner/integration testing against provider sandboxes) to the existing `live`, `training`, `demo` |
| **Room status** [`roomStatus`] | The governed domain covering unit condition, occupancy discrepancies and DND. In UI copy, the housekeeping state keeps the glossary term **unit condition** |
| **System of record** [`dataAuthority`] | The one system authoritative for a governed domain at a property: Portico or an external connection |
| **Write mode** | `exclusive` (Portico authoritative), `read_only` or `forward` (external authoritative) |
| **Authority transition** | A controlled move of a domain's system of record: `planned → frozen → effective` |
| **Adoption path** | A: connect alongside; B: replace selected capabilities; C: full migration |
| **Connected mode** | A module working on mirrored records whose system of record is external |
| **Standalone module** | A capability offered without the Portico PMS core, running in connected mode |
| **Connection** | An authorized link between a Portico organization/property and one external product |
| **Connector** | Portico's adapter code for a provider product/version |
| **Local connector** | Portico software installed on the hotel network for systems that cannot reach the cloud |
| **Workflow** | A defined exchange (e.g. POS charge posting) with capabilities read/create/update/receive-changes and a sync mode |
| **Sync mode** | Immediate, periodic, manual or file. A file exchange is never a live connection |
| **Mapping** / **Mapping suggestion** | Link between a Portico entity and an external one / a proposed link with confidence and reasons |
| **Validation run** | Recorded checks proving a connection behaves correctly before activation |
| **Activation scope** | The approved set of properties, workflows and external effects a connection or pilot may perform |
| **Exchange** / **Exchange log** | One message or record sent or received / the log of all of them |
| **Outbound operation** | A change Portico sends to another system, tracked until confirmed or resolved |
| **Integration exception** | A failed or incomplete exchange or workflow needing a person; severity urgent or routine |
| **Sender register** | Per property, which system sends each automated guest message type |
| **Promotion package** | Configuration carried from a trial to production after review |
| **Cutover journal** | Record of every business change after a migration switch, used for rollback |
| **Historical archive** | Read-only record of source-system history not migrated |
| **Continuity snapshot** | Read-only local copy of essential operational lists for outages |

## Related documents outside this folder

- `docs/readiness/dependency-register.md`, `docs/readiness/certification-matrix.md`,
  `docs/readiness/market-matrix.md`, `docs/readiness/provider-costs.md`, `docs/readiness/readiness-register.md`
  (operational readiness agent).
- `docs/specs/integration.md` and other module specs (product strategy / specs agent); `docs/product/editions.md`.
- Owner questions raised from this work: Q60–Q64 in `docs/OPEN_QUESTIONS.md`.
