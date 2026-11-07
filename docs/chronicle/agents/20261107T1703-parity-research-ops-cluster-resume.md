# Agent run: Parity research: ops cluster (resume)

- Started: 2026-11-07T17:03:56.030Z · last activity: 2026-11-07T17:31:31.068Z
- Turns: 223 · tool uses: 116 · output tokens: 530,316
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

