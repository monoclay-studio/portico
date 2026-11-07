# Agent run: Build migration module (increments 1–2)

- Started: 2026-11-07T22:00:30.646Z · last activity: 2026-11-07T22:33:31.205Z
- Turns: 122 · tool uses: 131 · output tokens: 225,934
- Type: general-purpose

## Brief (2026-11-07T22:00:30.646Z)

````text
You are the module owner for **migration** ("Move to Portico") in Portico, a cloud hospitality management platform: a TypeScript modular monolith at /home/user/portico. The owner's decision D13 is one-button migration from any PMS. The hotel presses one button and Portico does the rest. Only the legally or technically unavoidable steps remain, as a short guided checklist that is never hidden or faked. Your mandate is to make this 3x–10x better than anything on the market, measured. Research found that no vendor sells a turnkey migration today.

Read first:
- CLAUDE.md, especially rules 1–17 and money principles §5;
- docs/orchestration/module-agent-playbook.md;
- docs/quality/playbooks/module-builder-self-check.md (the latest version, v4). It is mandatory: § 5 invariant closure, a test per sibling entry point, and each test shown failing without its fix;
- **your 10x brief** docs/strategy/modules/migration.md, especially §5 "Next 3 increments";
- the specs: INT-R29–R34 in docs/specs/integration.md, docs/adoption/migration-acceptance-criteria.md (phases M0–M10) and docs/readiness/migration-onboarding-checklist.md;
- the research: docs/research/05-market-deep-dive/11-one-button-migration.md and docs/research/05-digest.md §3;
- the owner questions Q140–Q144, Q61, Q62 and Q64 in docs/OPEN_QUESTIONS.md. Their defaults are in force: no Oracle contact, no database extraction without written rights, cards re-collected;
- the provider contracts in docs/architecture/domain-map.md and the module READMEs of reservations, guests, finance (opening balances, S18), inventory, rates, integration and platform (data-authority transitions planned → frozen → effective);
- ADRs 0005, 0008, 0014 and 0015.

Your worktree is /home/user/wt/migration, on branch feat/migration, created from main. Decide in your README whether migration is a new module (`modules/migration`, schema `migration`) or extends integration, and justify it. A new module that uses integration's mapping, exchange and connection framework through ports is the likely fit. Commit locally after each meaningful step, with Conventional Commits. Never push, and never amend, reset or rebase a pushed checkpoint commit. Postgres is at postgres://postgres@127.0.0.1:5432/postgres; use PORTICO_TEST_DB_PREFIX=w2_mig.

A parallel branch (feat/integration-step) is binding cross-module ports and will merge soon. Use the providers through their public contracts and ports, so merging main later is mechanical.

Build increments 1 and 2 from your brief: the guesthouse same-day path.
1. **Pipeline:** discover → extract → map → validate → rehearse (a trial organization with `copied` provenance) → reconcile → sign-off → delta sync → freeze → cutover → verify → rollback window. It must be resumable, idempotent and audited.
2. **Sources:**
   - Generic CSV/XLSX packs with templates and column auto-detection.
   - Importers for the common SMB exports research names, behind a source-adapter port. Mark each format "unverified" until a real sample exists.
   - The PMS simulator as a source.
   - Masked-value detection (OPERA-style masked exports).
3. **Entities:**
   - property setup (unit types and units; rate plans as a mapping suggestion, never invented prices);
   - guest profiles, with duplicate scoring through guests;
   - future reservations through reservations' migration import, terms snapshotted, with NO double tax and NO double inventory;
   - opening balances and deposits through finance's opening-balance import, with tax already declared;
   - in-house stays.
4. **Reconciliation:** counts and money totals per entity, source versus Portico. The reconciliation report is the sign-off artefact. Zero duplicate reservations is a hard invariant.
5. **Cutover:**
   - a freeze of 15 minutes or less (TARGET), through platform data-authority transitions;
   - delta sync of changes since rehearsal;
   - rollback within the window;
   - card re-collection list (Q142 default);
   - the guided checklist of the unavoidable human steps: authorization, source access, card transfer request, opening-balance sign-off, channel switch, cutover time, staff acceptance.
6. **Environment safety:** rehearsals only in trial or sandbox organizations. Production migration needs explicit owner/hotel authorization (CLAUDE.md §1); build the gate, not the authorization.
7. **Records:** the universal record contract, permissions in the manifest (migration is sensitive), role templates, and a demo seed with a sample guesthouse CSV pack.
8. **Proof:**
   - scenario S18 extended, plus a same-day guesthouse migration scenario end to end on the simulator;
   - concurrency and interruption tests (resume after a crash; delta sync racing live bookings);
   - a parity file docs/parity/migration.md, with `tested` rows quoting their asserting tests.

Gates before reporting, on a tree merged with main:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Check exit codes.

Reply with:
- what is built against the brief's targets (e.g. a guesthouse moved the same day; zero duplicate reservations);
- the self-check tables;
- the contract requests to other modules;
- what stays unverified (real source samples);
- the next increment (OPERA).

A steward review will follow.
````

