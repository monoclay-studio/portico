# Agent run: Parity research: ops cluster (resume)

- Started: 2026-11-07T17:03:56.030Z · last activity: 2026-11-07T18:02:35.046Z
- Turns: 387 · tool uses: 197 · output tokens: 989,478
- Type: general-purpose

## Brief (2026-11-07T17:03:56.030Z)

````text
You are a competitive-parity researcher for Portico, a cloud hospitality management platform (repo /home/user/portico; read CLAUDE.md first). You are resuming a workstream another researcher started earlier today and couldn't finish: its agent log was lost in a container restart, but its committed work survives.

Your worktree is /home/user/wt/parity-ops (branch docs/parity-ops). Write only under docs/parity/. Commit locally after each module; never push. Start with `git merge main`.

Read:
- **Your instructions:** docs/orchestration/parity-researcher-brief.md (on main).
- **The original brief for this workstream, verbatim:** docs/chronicle/agents/20261107T0812-parity-operations-guests-comms-resort.md (on main).
- **The gate:** docs/parity/README.md and `node tools/parity-report.mjs`.
- **Examples of finished matrices:** inventory, rates, reservations, finance and payments on main. Match their format exactly so the parity tool parses them.

Already done on this branch: docs/parity/operations.md, docs/parity/guests.md and gaps-ops.md.

Since then, operations and guests (and integration) have merged to main with real code and tests. Update those two matrices: each row's status must reflect the real implementation and tests on main. Read modules/<module>/README.md (Known gaps, Checkpoint) and the test names. Never mark a row better than its evidence: `tested` needs a test that proves it.

Remaining modules:
- **integration:** built, on main. Status from code and tests.
- **identity:** built on branch feat/identity-platform-enterprise in /home/user/wt/identity-plus. Read only; it is mid-fix, so use its README and tests.
- **Spec-only modules:** comms, resort, access, guest-experience, crm and ai. Specs are in docs/specs/. Status is specified, missing or deferred, with reasons.

For each module produce a parity matrix and an edge-case catalogue, covering what OPERA Cloud, Mews, Cloudbeds, Apaleo, Stayntouch, Shiji, Agilysys, Infor, Guesty, SiteMinder, RMS and RoomRaccoon do:
- cite our research (docs/research/01–05, including the 05 market deep dive);
- mark uncertain competitor facts as unverified;
- give P0/P1/P2 priorities.

Put spec gaps you discover in gaps-ops.md as change requests. Don't edit specs.

Before finishing:
- run `node tools/parity-report.mjs` and check its exit code and output;
- run `pnpm lint`; Markdown is excluded from Biome, but check anyway.

Reply with:
- per module: row counts, % tested, open P0 rows;
- the top 10 gaps vs competitors across these modules;
- the files written.
````

## Follow-up message (2026-11-07T17:31:31.068Z)

````text
[Request interrupted by user]
````

## Follow-up message (2026-11-07T17:38:53.513Z)

````text
The coordinator sent a message while you were working:
Resume after the owner's checkpoint. Your WIP is committed on docs/parity-ops as "wip(...): usage-limit checkpoint". Continue where you stopped, on crm, then finish the remaining modules.

One change: follow docs/quality/playbooks/parity-researcher.md, latest version, now on main. It supersedes the old brief, so `git merge main` first. Key rule: a row counts as `tested` only when a test on main asserts it.

The same report applies at the end.

Address this before completing your current task.
````

## Report (2026-11-07T18:02:34.893Z)

````text
I resumed on crm, merged main and followed playbook v2. All ten matrices plus gaps-ops.md are done and committed on `docs/parity-ops`, nothing pushed. No module in this cluster passes the gate: `--gate` exits 1 for all ten, because each has open P0 rows.

**Checks**
- **Parity report:** `node tools/parity-report.mjs` exits 0 with no unknown statuses.
- **Lint:** `pnpm lint` couldn't run here because the worktree has no `node_modules`. I ran main's Biome binary instead: exit 0, 723 files. Markdown is excluded by `!**/*.md`, so I checked the tables myself: widths consistent, no undefined links, no ID collisions. `check-boundaries` is OK.

**Per module** (Tested % counts `different` rows as equivalent):

| Module | Capabilities, tested % | Edge cases (sweep rows), tested % | Open P0 |
|---|---|---|---|
| operations | 98, 17% | 70 (22), 24% | 43 |
| guests | 75, 31% | 54 (17), 48% | 23 |
| integration | 87, 53% | 59 (15), 71% | 19 |
| identity | 56, 11% | 50 (16), 8% | 42 |
| comms | 56, 2% | 49 (17), 0% | 46 |
| resort | 60, 0% | 61 (27), 0% | 58 |
| access | 40, 5% | 48 (16), 0% | 47 |
| guest-experience | 56, 2% | 55 (23), 0% | 48 |
| crm | 47, 0% | 51 (21), 0% | 12 |
| ai | 33, 3% | 39 (19), 0% | 36 |

**Playbook v2 self-check**
- **Assertion quotes:** all 179 `tested` rows quote the asserting `file:line` on main (operations 33, guests 48, integration 88, identity 10). Concurrency rows cite tests that really run in parallel.
- **Operations downgrades:** PAR-OPS-004, 007, 020, 048, 062, 066, 069, 084, EC-OPS-012 and EC-OPS-019. Reasons: parts of the row not asserted, or affected stays proven only against a fake inventory.
- **Guests downgrades:** PAR-GUE-008, 043, 074, EC-GUE-001, 010 and 012. PAR-GUE-043 and EC-GUE-001 restore references only through a fake reservations consumer.
- **Identity downgrade:** PAR-IDN-023 (brand and region scopes not asserted).
- **Identity branch rows:** 55 rows proven only on the unmerged identity branch are capped at `built (feat/identity-platform-enterprise@abbd5e9)`. The branch's third review still has two open P1s (a race in the first-verification wipe, and SSO group mapping not treated as a root change); the affected rows say so.
- **Failure-class sweep:** done for every module. Applied, covered and N/A classes, with reasons, are recorded in gaps-ops.md §5.

**Other fixes along the way**
- **Access IDs:** access rows were `PAR-ACC`/`EC-ACC`, which collide with accounting.md. They are now `PAR-ACS`/`EC-ACS`, matching the spec's new prefix on main.
- **guests.md sources:** it had no Sources section, so its links were dangling. I regenerated it from the verified registry.
- **Unverified sources:** many vendor sites block direct fetches from here. Those sources are marked "search-located", and rows resting only on them say "unverified".

**Decisions needed** — the implementation and the matrix disagree on:
- **EC-OPS-017:** on a room move, in-progress tasks follow the guest instead of staying with the old unit.
- **EC-OPS-020:** out-of-order on an occupied unit is accepted rather than requiring a relocation first.
- **EC-GUE-006:** on profile merge, the most recent consent statement wins rather than the most restrictive. This needs privacy advice.

I left owner questions unnumbered because Q140–Q144 are already taken in OPEN_QUESTIONS.

**Top 10 gaps against competitors**
1. Seaplane transit-night planning (PAR-RST-019, EC-RST-002). Journey request SCR-34 isn't applied to the resort spec.
2. Housekeeping next to an external PMS isn't a closed loop (PAR-OPS-086, EC-OPS-026/027).
3. Comms basics missing from the spec:
   - the WhatsApp 24-hour window;
   - signed guest links in templates;
   - a guard against unresolved template variables;
   - card and passport detection in chat (PAR-COM-019/020/047/054).
4. Housekeeping depth against OPERA and Stayntouch:
   - bulk status change and bulk out-of-order;
   - paper task sheets;
   - cleaning time and turndown set per stay;
   - work orders by trade;
   - public-area rounds.
5. Enterprise identity (MFA, SSO/SCIM, custom roles, support access) isn't on main. Department scope, approvals and access-review reports aren't built anywhere.
6. Room-ready notification and advance or automatic check-in (PAR-GXP-021/022, PAR-OPS-032).
7. Guest-profile enterprise features:
   - protected and incognito profiles;
   - custom fields and attachments;
   - configurable match rules;
   - merge and anonymization pre-checks.
8. Partner integration platform: sandbox and certification, published rate limits, SFTP exports, legacy FIAS-style interfaces, async bulk extraction.
9. Resort leisure depth: diving records, kids club, spa and activity utilisation, airport meet and greet.
10. AI: competitors bundle it free and pilot natural-language analytics; our spec meters it and has neither.

The sweep also found a P0 safety gap the specs don't cover. Two kernel/platform rules would close it:
- **Trial-to-live switch:** queued external effects must be re-checked when they execute after the switch.
- **External identifiers:** provider accounts, sender numbers, POS outlets and lock sites must be unique across tenants or proven.

Files are in /home/user/wt/parity-ops/docs/parity:
- operations.md
- guests.md
- integration.md
- identity.md
- comms.md
- resort.md
- access.md
- guest-experience.md
- crm.md
- ai.md
- gaps-ops.md
- COVERAGE.md
````

