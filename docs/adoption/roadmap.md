# Adoption and integration roadmap

> Deliverable 11 (adoption brief §15; operational-readiness brief §21–§22). Status date: 2026-11-07.
> This roadmap covers adoption and integration only. Product module delivery (PMS core, finance, etc.) is in
> the product roadmap (`docs/product/`, product strategy agent); the external critical path for the whole
> product is in `docs/readiness/` (readiness agent). Where those documents exist, they take precedence for their
> scope; this file names the dependencies on them.

## 1. Principles

1. **Depth before breadth.** Finish a complete, trustworthy experience for RS-1, RS-3 and RS-2 (in that order)
   before adding providers outside their needs.
2. **Two tracks, never merged.** Internal development (we control it) and external approvals, partnerships and
   hotel actions (we do not) are planned and reported separately. An external dependency is shown as pending
   until there is written evidence; it is never shown as resolved because the code is ready.
3. **Unblocked work continues.** Simulators and sandboxes let internal work reach R3/R4 while approvals wait.
4. **Every milestone has exit evidence** recorded in `docs/readiness/readiness-register.md`.

Track legend: **I** internal development · **E** external approval, partnership or commercial agreement ·
**H** hotel-side action · **O** owner decision. Sizes are relative internal effort (S, M, L, XL); external
durations are **unknown** until the provider answers and are never estimated as fact.

## 2. Milestones

### AM-0 Foundation — done

Platform (organizations, environments, properties, legal entities, policies with overrides and preview, data
authority), identity (users, scoped roles, API clients), kernel effect policy and provenance type, db rails
(outbox, idempotency, audit, RLS). Evidence: commit `02f4e14`.

### AM-1 Adoption backbone (I) — size XL, starts now

| Item | Track | Exit evidence (readiness) |
|---|---|---|
| Data authority changes G-01, G-02 (history + transitions), G-06 (`guestCommunications`), G-07 (constraint) | I | R3: tests ST-01..ST-13 pass |
| Activation scope enforcement (G-04) and trial read-only guard (G-03) | I | R3: EV-02, EV-04, EV-05 pass |
| Provenance freshness rules (G-05) | I | R3 |
| Integration module core: connections, credential refs, workflow activations, mappings + suggestions, validation runs, exchange log, outbound operations, exceptions, health, console | I | R3: CL-01..CL-13 pass against simulators |
| Simulators: OTA hub, OPERA-like PMS (from public OHIP docs), POS, payment, door lock, messaging | I | R2/R3; labeled simulators, never "integrations" |
| Demo environment with the Maldives sample organizations | I | R2: EV-01 passes |
| Import engine with reconciliation (CSV templates first) | I | R3: MG-01, MG-02, MG-08 pass |

### AM-2 RS-1 complete: "12-room guesthouse fully on Portico"

Depends on: PMS core, finance, comms modules reaching R3 (product roadmap).

| Item | Track | Readiness target | Notes |
|---|---|---|---|
| Spreadsheet and eZee/Cloudbeds file importers | I | R3 | eZee/Cloudbeds export formats need sample files from a hotel (H) |
| Channex adapter (ARI, revisions feed, acks, mapping, recovery) | I | R4 on Channex staging | Staging is free per owner brief §5 (re-verify) |
| Channex production agreement and PMS certification | E + O | R5 → R6 | Paid contract activation needs owner authorization (CLAUDE.md §1) |
| OTA connectivity authorization per hotel (Booking.com, Expedia, Agoda) | H | R7 | Each hotel requests/approves the provider in its extranet |
| Email channel; WhatsApp Business Platform sender approval | I + E + H | R4 → R6 | Business verification and templates (operational-readiness brief §14) |
| Recorded payments + reconciliation; acquirer adapter if Q2 resolves | I + E + O | R3 (recorded); acquirer unknown | Live guest payments need owner authorization |
| Journal file export; MIRA return data report | I | R3 | Filing format verification (market matrix) |
| Trial flow (copy, masking, reset/export/delete, promotion package) | I | R3 | Q63 for retention defaults |

**Exit:** an RS-1 rehearsal with real or realistic guesthouse data meets every M-01..M-11 target applicable,
with staff-validation evidence labeled proxy until a real guesthouse participates.

### AM-3 RS-3 complete: "3-property group keeping OPERA Cloud, adopting Portico housekeeping + messaging"

| Item | Track | Readiness target | Notes |
|---|---|---|---|
| OHIP connector: read stays, units, room status, profiles, revenue; forward room status and out-of-order; streaming receive | I | R3 on simulator → R4 if an OHIP test environment is provided [Unconfirmed] | Built from public OHIP docs (research 01) |
| Oracle partner access for OHIP (partner pays per call/event) | E + O | R5 → R6 | Q61; paid usage needs owner authorization |
| Hotel enables streaming (Oracle Professional Services per environment) and approves subscription | H + E | R7 | Vendor-side step shown in setup |
| SM-01 housekeeping, SM-03 tasks, SM-04 messaging, SM-05 reporting in connected mode | I | R3 | Depends on operations, comms, analytics modules supporting mirror mode |
| Path A → B transition for `roomStatus` | I | R3 | ST-05, ST-06 |

**Exit:** simulated group passes the fault-injection suite (M-09) and the connected-mode acceptance tests;
R7/R8 only with a named group (Q64).

### AM-4 RS-2 complete: "120-villa resort keeping its POS, accounting and spa"

| Item | Track | Readiness target | Notes |
|---|---|---|---|
| Portico POS posting API (W-POS-01..07) | I | R3 | The target interface for any POS |
| One POS vendor interface, chosen after discovery | E + H | R4 → R6 | Vendor terms and licences (Q62); manual posting fallback meanwhile |
| ERP journal file profile (e.g. SunSystems if confirmed) | I | R3 | Q64 to confirm the ERP |
| Local connector (pairing, signed updates, queue, heartbeat) | I | R3 | Support obligation Q62 |
| One door-lock vendor via the local connector | E + H | R4 → R6 | Vendor SDK terms; manual encoding fallback |
| Transfers with file/email manifests (SM-06 / resort module) | I | R3 | No operator API assumed |
| OPERA 5.x and OPERA Cloud migration importers | I (+E for OHIP extraction) | R3 | D8: OPERA formats first |
| Channex PCI for OTA virtual cards | I + E | R4 → R6 | |
| Spa system posting (e.g. Book4Time if used) | E | R4 | P1 |

**Exit:** RS-2 migration rehearsal on the sample resort meets [migration-acceptance-criteria.md](migration-acceptance-criteria.md)
§6 thresholds; rollback drill MG-07 passes.

### AM-5 Ecosystem and selected breadth (after AM-2..AM-4 exit, or in parallel where staffing allows)

Partner program and sandbox organizations (EC-01..EC-07); Mews and Cloudbeds connected-mode connectors (P1);
Google free booking links (P1); Xero/QuickBooks (P1); SSO/SCIM (P1); Airbnb/Trip.com/Hotelbeds via hub (P1).

### AM-6 Enterprise rollout capabilities

Templates, bulk setup, rollout waves, cost allocation, portfolio console (RR-05..RR-16), measured against M-12.

## 3. Critical path

```
Internal:  AM-1 backbone ──► Channex adapter (R4) ──► RS-1 rehearsal ──► pilot-ready (internal)
                         └─► OHIP connector on simulator (R3) ──► RS-3 connected-mode tests
                         └─► POS API + local connector (R3) ──► RS-2 rehearsal

External:  [O] named pilot hotel (Q64) ───────────────────────────────────────────► gates every R7/R8
           [E/O] Channex production + certification ──► [H] OTA authorizations ──► RS-1 live distribution
           [E/O] payment acquiring for Maldivian entities (Q2) ──────────────────► live guest payments
           [E/O] Oracle OHIP partner access (Q61) ──► [H] streaming enabled ─────► RS-3 live
           [E/H] POS and lock vendor interface terms (Q62) ──────────────────────► RS-2 live (manual fallbacks meanwhile)
           [E/H] WhatsApp sender approval ───────────────────────────────────────► live guest messaging
```

The longest external poles are expected to be **a named pilot hotel** and **payment acquiring in the Maldives**:
neither can be shortened by engineering. Everything up to R4 proceeds without them.

## 4. External dependency status (adoption-related only)

| Dependency | Status 2026-11-07 | What proceeds meanwhile | Register |
|---|---|---|---|
| Named pilot hotel | None (D8) | Sample data, proxy usability tests | Q64 |
| Channex production and certification | Not started | Staging integration (re-verify free staging) | `docs/readiness/dependency-register.md` |
| Oracle OHIP partner access | Not applied | Simulator from public docs | Q61 |
| Payment acquiring (Maldives) | Unverified | Simulator; recorded payments | Q2 |
| POS vendor interface | Not started; vendor unknown | POS posting API + simulator | Q62, Q64 |
| Door-lock vendor SDK | Not started; vendor unknown | Lock simulator; manual alternative | Q62 |
| WhatsApp sender approval | Not started | Email; simulator | readiness register |
| Vendor documentation access for verification | Hosts blocked in research sessions | Claims kept unconfirmed | gap-assessment §6 |

## 5. Deliberately deferred

Direct Booking.com/Expedia certification; Apaleo, Infor, Shiji, Agilysys, Stayntouch and protel connectors;
RMS, CRM, reputation and procurement integrations; e-invoicing outside the first market; marketplace listing
pages. Each stays visible in the coverage matrix as "planned (P2)" so customers see what is not supported.

## 6. Review

Monthly review by the Integration & Adoption lead with the architecture steward and readiness lead; any change in
an external dependency's status is recorded with evidence and date the same day.
