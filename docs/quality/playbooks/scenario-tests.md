# Scenario tests (L3) — playbook

| | |
|---|---|
| **Current version** | **v3** (2026-11-07, round 2) |
| **Theme of v3** | Cross-module invariants: the global consistency checks state the money and ownership invariants that span modules, and every writer of their inputs is exercised by some scenario. v2 (real-path evidence) stays in force. **v2 theme:** | Real-path evidence: a scenario counts only if it ran through real providers, asserted its catalogue lines, and held under the CI gate |
| **Previous** | `archive/scenario-tests-v2.md` (v2); `archive/scenario-tests-v1.md` (the integration-step brief: Phase A binds ports, Phase B runs the scenarios) |
| **Launch** | Every merge batch (`README.md` L3). For the first run, Phase A (binding) comes first; afterwards, Phase B alone on the merged `main` |
| **Measured by** | `scorecard.md`: scenarios passing / todo / fake-bound; consistency violations found; cross-module escapes found later (by L4, merge or the owner) that a scenario should have caught; L3 canaries C-L3-01/02 |

## Why v2 changes L3 before its first result

No L3 run has finished, so there are no L3 escapes yet. The v2 changes come from what **L2 found about scenario claims
built on fakes**:

- guests S15 and GUE-I03 held "only against the test's fake consumer" (guests review G-P1-4);
- reservations' "never authorizes twice" test used a synchronous fake, while real payments is two-phase (reservations
  review R-11);
- the fakes never checked permissions (reservations review R-14);
- README scenario claims were contradicted by probes (guests G-P1-6; backoffice P2-17; identity S17).

L3 exists to catch cross-module breaks. It can do that only if it never runs on fakes.

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Integration-step brief: bind every port; S01–S20 through public APIs; global consistency checks; `.todo` with the missing capability; no weakened tests | Baseline | — | First L3 result |
| v2 | 2026-11-07 | **ST2-1** | **A binding manifest** per scenario: each port it exercises, and whether it is bound to the real provider or a stub. Module fakes are not allowed in `apps/api/test/scenarios/`. A scenario that touches a stubbed port is reported as `blocked-by-binding`, never as `passing` | Scenario claims that held only on fakes | AP-51; G-P1-4, R-11, R-14 | Scenarios reported passing with every port real; canary C-L3-02 |
| v2 | 2026-11-07 | **ST2-2** | **An assertion map** per scenario: each catalogue line (State, Money, Inventory, Audit, Recovery in `docs/scenarios/README.md`) maps to the asserting line in the test, or to `.todo: <missing capability>` | README scenario claims were broader than their tests | AP-50; G-P1-6, P2-17, S17 | % of catalogue lines asserted |
| v2 | 2026-11-07 | **ST2-3** | **Hold under the CI gate.** Run the suite with `pnpm test` (CI concurrency) **and** `pnpm turbo run test --force` (default concurrency). Record the 5 slowest tests and their time budgets. Size budgets for the fully composed app | The demo-seed test passed alone and timed out under parallel runs. The briefs' gate commands differed | E-015; RC-8 | Zero timeouts under either command; flake rate |
| v3 | 2026-11-07 | **ST3-1** | **Cross-module invariants** in `assertGlobalConsistency`: (a) every deposit account's booking belongs to the same property and legal entity. The integration-step builder already added this, and canary C-L3-03(a) confirmed it catches the plant. (b) Every open balance request is ≤ its folio's current debt, and a departed folio has at most one. (c) No payment state reaches a role without money permissions in any stored or derived artefact the scenario produced | The checks would not catch P1-1 or P1-3 (review § 7). R2-P1-2 (collection drift) was found by L2, not L3 | E-039, E-041, E-074, E-076; canary r2-l3 | C-L3-03(a) and (b) caught; L2-found cross-module money defects that a scenario invariant should have caught |
| v3 | 2026-11-07 | **ST3-2** | **Writer coverage.** For each invariant, the binding manifest lists every writer path of its inputs, and the scenario or dedicated test that exercises it. Example: the opening-deposit import path (S18) must run the deposit invariant, even before S18 is complete | C-L3-03(a): the stray-deposit check exists and works, but no scenario exercises the import writer, so R2-P1-3 passed every scenario | E-075 | Writers with no exercising scenario (target 0) |

### Queued for later versions (one theme each)

- **Round-1 evidence for v2 (no version change).** The integration step ran under v1. Its S04 overclaimed child-age and
  Green Tax pricing, S01's "nothing posted" was not asserted, and S05 used the port rather than the user path (E-042,
  the first L3 escape). That is exactly what ST2-2's assertion map targets. The fix round now runs under v2, and round
  2 measures it.
- *(Published as v3 in round 2: ST3-1 and ST3-2. The remaining queued part, running the checks after the demo seed
  and every L4 lab refresh, stays queued as v4.)* **v3, consistency as invariants everywhere, now including cross-module ownership and money invariants.** Add to
  `assertGlobalConsistency`:
  - every `finance.deposit_accounts` booking belongs to a reservations booking of the same property and legal entity;
  - every open payment request is ≤ its folio's debit balance;
  - no payment state is visible to a role without money permissions.

  The integration-step review (§ 7) showed that today's checks would not catch P1-1 or P1-3 (E-039, E-041); canary
  C-L3-03 tests this. Also run the checks after the demo seed and each L4 lab refresh.
- *(Superseded wording, kept for history:)* **v3, consistency as invariants everywhere.** Run the global consistency checks after **every** scenario, and also
  after the demo seed and after each L4 lab refresh. A seed that breaks an invariant is caught before a tester sees
  contradictory numbers (cf. the simulator contradictions in round 1, `review-backoffice.md` P2-1).
- **v4 (round-3 addition), the harness uses the real ports.** Scenario helpers that set up state (for example
  `makeExternal`, which completes a data-authority transition) bind the composition's ports, never `{}`, and act as
  a real user with the setup role. Prompted by E-093 (re-review #3 R3-P3-4).
- **v4, a negative path per binding.** For each bound port, a scenario variant runs the AP-01 wrong-property probe and
  the AP-38 external-authority probe through the real path. v1 asked for these per binding; v4 makes them part of the
  scenario proof and reports them in the manifest.

---

## Run parameters (filled by the orchestrator)

```
WORKTREE / BRANCH:  /home/user/wt/<integration-or-scenarios> (feat/…), from main @ <sha>
PHASE:              A+B (first run: bind ports, then scenarios) | B (scenario proof on the merged main)
DB PREFIX:          PORTICO_TEST_DB_PREFIX=<prefix>
PENDING FIXES:      docs/orchestration/pending-fixes.md entries assigned to this run
NOTES:              behaviour changes landing in parallel (e.g. MFA for ⚑ permissions, second approver for data authority)
```

## Round-2 measurement of v2

The integration-step fix round adopted v2 fully:
- the binding manifest is in `apps/api/test/scenarios/README.md`, with no module fakes;
- the assertion map covers every catalogue line, or names a todo;
- both gate commands were run, and the slowest tests were reported.

S04 is now closed: the re-review re-read it and found it proves the claim. **ST2 worked.**

## Launch brief (v3 additions)

Add to the v2 Phase B block:

````text
4. Cross-module invariants (ST3-1). assertGlobalConsistency also checks: (a) every finance deposit account's booking
   belongs to a reservations booking of the same property and legal entity; (b) every open payments balance request
   is <= its folio's current debt, and a departed folio has at most one; (c) no payment state is visible to a role
   without money permissions in the scenario's stored or derived artefacts (records, issues, workflow step results).
5. Writer coverage (ST3-2). In the binding manifest, list for each invariant every writer path of its inputs
   (including imports, reversals, transfers, channel paths) and the scenario or dedicated test that exercises it.
   A writer with no exercising test is reported as a gap, not hidden.
````

## Launch brief (v2)

v2 keeps the v1 brief (`archive/scenario-tests-v1.md`) unchanged. Phase A applies on the first run only. Add the
block below to Phase B and to the reply format.

````text
PHASE B additions (scenario-tests playbook v2)

1. Binding manifest (ST2-1). For every scenario test, keep a table in apps/api/test/scenarios/README.md:
   scenario | ports exercised | real or stub for each | result.
   - Scenario tests must not import module test fakes. Use only the composition root and test helpers.
   - A scenario that touches a port still bound to a stub is reported `blocked-by-binding: <port>`, never `passing`.
2. Assertion map (ST2-2). For each scenario, map every line of its catalogue entry in docs/scenarios/README.md
   (State, Money, Inventory, Audit, Recovery) to the asserting line in the test (file:line), or to
   `.todo: <missing capability>`. Every scenario ends with the global consistency checks listed at the top of
   docs/scenarios/README.md.
3. Hold under the CI gate (ST2-3). Run the suite twice:
   `pnpm test` (CI concurrency 2) and `pnpm turbo run test --force` (default concurrency).
   Read the exit codes directly; never pipe them. List the 5 slowest tests with their durations and timeouts. If a
   test needs a larger budget, size it for the fully composed app and say why.

Reply additions:
- the binding manifest summary: real / stub per port, scenarios blocked by binding;
- the assertion map: catalogue lines asserted / total, per scenario;
- both gate commands' exit codes, and the slowest tests.
````
