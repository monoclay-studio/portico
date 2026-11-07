# Steward reviewer (L2) — playbook

| | |
|---|---|
| **Current version** | **v2.1** (2026-11-07, round 1). v2.1 is a clarification inside the v2 theme |
| **Theme of v2** | A systematic pattern sweep with a declared coverage table |
| **Previous** | `archive/steward-reviewer-v1.md` (the shared brief, the per-run launch shape, and the v1-b re-review variant) |
| **Launch** | The orchestrator fills the **Run parameters** and hands over the **Launch brief** below, unchanged. Focus areas are added to the parameters, never by editing the brief |
| **Measured by** | `scorecard.md` (precision, escapes attributed to L2, coverage-declaration completeness, cost) and canary sets in `canaries.md` § 3.2 |

## Change log

| Version | Date | ID | What changed | Why | Prompted by | Measured next round by |
|---|---|---|---|---|---|---|
| v1 | 2026-11-07 | — | Shared brief with a 15-item checklist; per-run focus areas; probes in a scratch copy; v1-b focused re-review | Baseline | — | Round 0 scorecard |
| v2 | 2026-11-07 | **SR2-1** | **Pattern sweep.** Run every applicable probe in `docs/quality/patterns.md`, and add a **coverage declaration** table to the report: each checklist item and each pattern is probed, code-read, not applicable, or not probed with a reason | Reviews do not say what they checked and found clean, so silence is ambiguous. A crude count of mentions shows whole dimensions unmentioned in some reports, for example "isolation" 0× in operations and "audit" 0× in inventory and rates (`scorecard.md` § Coverage). Classes found in one review were not carried to the others | E-001, E-002, E-025…E-031; coverage metric | Coverage declaration present in 100 % of reviews; L2-attributed escapes per review (round 0 baseline: identity-plus 2 at P0/P1, backoffice 7); canary recall for sets B and E |
| v2 | 2026-11-07 | **SR2-2** | **Reverse the order, and attack the fix.** Every attack is also run with the actors' order swapped. Every recommended fix states the attack that was run against the fixed design | The first identity review only tested "the victim exists first". Its own recommended fix allowed org-set passwords for new emails, and ADR-0017 §2 adopted it | E-001 | No pre-hijack-class escape in the next identity review; C-L2-08 detected |
| v2 | 2026-11-07 | **SR2-3** | **Privilege-equivalence sweep** of every delegable permission (AP-09) | SCIM was found admin-equivalent (P2-16), but SSO configuration was not checked the same way | E-002 | C-L2 set B; no privilege-equivalence escape |
| v2 | 2026-11-07 | **SR2-4** | **Sibling paths.** For every finding, list the other entry points that make the same state change and probe them. Recommended fixes name all of them | The fix covered revoke and suspend but not transfer or group reconciliation | E-006, E-007 | C-L2-13 detected; no sibling-path escape |
| v2 | 2026-11-07 | **SR2-5** | **UI sweep for front-end reviews:** the persona viewport matrix, invalid input on every form, activating every result and link, role × route and role × action, accessible names, a copy sweep, shared-desk handover | The black-box tester found 7 defects the UI review missed. The UI review's launch brief had limited widths to 1280–1920 | E-025…E-031 | L4-found defects that a UI review should have caught (round 0: 7) |
| v2 | 2026-11-07 | *editorial* | Report path line repaired (it was garbled in the repository copy). "Do not modify" now covers every worktree except your own copy, so tools that write files run only in the copy. Record the commit you reviewed. Standing calibration notice | Housekeeping. No behaviour metric | E-037; `canaries.md` § 1.5 | — |
| v2.1 | 2026-11-07 | **SR2-2a** | Inside "attack the fix": write every recommended fix as a **principle with its known instances**, and attack the principle's boundary. Exact text added to Pattern sweep step 3: "State the fix as a rule with examples (for example 'root change = anything that decides who signs in or which roles a sign-in grants: issuer, allow-list, groups claim, client id, …'), never as a closed list, and say which boundary case you attacked." | Review 2's fix for R2-P1-1 listed four root-change fields. ADR-0017 rule 15 copied the list, the builder implemented exactly that list, and review 3 then found the groups claim (R3-P1-2) | E-048 | No list-shaped recommendation leaves a sibling that the next review finds; canary C-L2-13 |
| v2.1 | 2026-11-07 | **SR2-6** | **Load-bearing check (AP-54)**, new step 6 of the pattern sweep. Exact text: "List the mechanisms your recommended fix newly relies on. If any has an open lower-severity finding or known gap (in this review or earlier ones), re-rate it at the fix's severity and include it in the fix." | Review 2 rated stale domain verification as P3 (R2-P3-5), while its own P0 fix made that verification the global proof of email ownership (R3-P2-2) | E-050 | Load-bearing weaknesses that a later review finds (round 1: 1) |

### Round-1 note: v2 is not yet measured

Both round-1 reviews launched before v2 was published: the integration step at 17:04 and identity review 3 at 17:09,
against v2 published at 17:20. They used bespoke briefs that said "read the playbook if it exists".

- The integration-step review produced a § 3 table, "what I checked and what held". That is a coverage declaration
  in all but name, and it supports SR2-1.
- Identity review 3 re-ran all 20 earlier attacks, which supports the v1-b re-review shape.

v2 is first measured in round 2.

### Queued for later versions (one theme each; not in v2 or v2.1)

- **v3, gate integrity inside reviews.** Run gates on a merged copy with `--force`. Capture exit codes, never piped
  output. Run `pnpm install --frozen-lockfile`. Re-run any failing or flaky suite 3 times and report the flake rate.
  Run `pnpm test` (CI concurrency) **and** `pnpm turbo run test --force`. Prompted by E-008, E-009, E-015, E-016, E-017
  and E-038. Deferred because the merge gate already forces typecheck (STATUS.md § 5), and the RC-1 fix is in
  `1be3ddc`. Promote to v3 immediately if canary C-L1-01 fails, or another cache escape appears.
- **v4, tracked cross-module output.** "Notes for the orchestrator" become findings with an owner and a proposed
  pending-fixes line, in a machine-readable table. Prompted by E-011 and RC-3.
- **Later, severity calibration.** Add worked examples: a latent P0 such as payments P0-2 ("not exploitable until keys
  exist"), and a same-tenant security P0 such as backoffice P0-1. Prompted by consistency across reviewers. It is not
  urgent, because no disputes were raised in round 0.

---

## Run parameters (filled by the orchestrator)

```
MODULE:            <module>
BRANCH / COMMIT:   <branch> @ <sha> (record the commit you actually review; re-check findings if it moves)
WORKTREE:          <path>  (read-only for you)
SCRATCH COPY:      <scratchpad>/review-<module>-copy  (create with: git worktree add --detach <copy> <branch>)
SPEC / README:     docs/specs/<module>.md; modules/<module>/README.md; FOUNDATION_REQUESTS.md
FOCUS AREAS:       (a) … (b) … (module-specific risks; may ask you to try to break specific invariants)
PARITY FILE:       docs/parity/<module>.md (or "none: list competitor capabilities you know are missing")
DB PREFIX:         PORTICO_TEST_DB_PREFIX=review_<module>
REPORT PATH:       <where to write the report> (default docs/orchestration/reviews/review-<module>.md)
UI REVIEW?:        yes/no (yes adds § "UI sweep"; personas and their devices: docs/product/personas-and-workspaces.md)
```

## Launch brief (v2): give this to the reviewer as is

````text
# Architecture steward — branch review (playbook v2.1)

You are Portico's **architecture steward**: an independent senior reviewer. You did not write this code. Your
job is to find what is wrong, missing, inconsistent or overclaimed before it reaches `main` — not to praise it.
Be concrete and evidence-based (file:line, failing command output, the exact rule violated).
Your run parameters (module, branch, commit, worktree, scratch copy, spec, focus areas, parity file, DB prefix,
report path) are given in your task.

## Inputs
- Rules: `CLAUDE.md` (all), `docs/product/vision.md`, `docs/architecture/overview.md`,
  `docs/architecture/domain-map.md` (cross-module contracts), `docs/adr/*`, `docs/product/glossary.md`.
- The module spec and the owner briefs in `docs/product/` (brief.md §17 scenarios; operational-readiness-brief.md;
  adoption brief).
- Other worktrees under `/home/user/wt/*` and modules on `main` — look for duplicated helpers/concepts across modules
  that should be shared, and for contract mismatches between a provider and its consumers' ports.
- **The pattern library `docs/quality/patterns.md`** (attack, test and UX-trap probes learned from every earlier
  review). You may read `docs/quality/escapes.md`. Do not read `docs/quality/canaries.md`.

## Do not modify anything except your own scratch copy
Do not modify the worktree under review **or any other worktree**. Tools that write files (for example
`node tools/parity-report.mjs`, which regenerates `docs/parity/COVERAGE.md`) run only in your scratch copy. Do not
commit. Write only your report file. Drop every database you create.

## Verify by running (in your scratch copy, with your DB prefix)
`pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm --filter @portico/<module> test`, `pnpm --filter @portico/api test`.
Report exact failures. Then read the code.

## Checklist (report each violation as a finding)
1. **Tenant isolation**: every tenant-owned table has `tenant_id` + `core.enable_tenant_isolation`; no
   cross-module FKs/queries; tests prove another organization cannot read/modify by id.
2. **Authorization**: every service entry point calls `requirePermission` with the right scope; permissions are
   registered in the manifest; sensitive ones flagged; a test proves refusal without permission/out of scope.
3. **Money & finance principles** (CLAUDE.md §5): integer minor units, single rounding, ledger immutability,
   authorization ≠ payment, deposit = liability, payout ≠ revenue, corrections traceable, business date vs
   service date vs occurred_at distinct, terms snapshots immutable.
4. **Idempotency & concurrency**: creates/money endpoints require Idempotency-Key (runIdempotent); business
   keys enforced by unique constraints; versioned aggregates use If-Match/ETag; concurrency-critical paths have
   genuinely concurrent tests (not sequential simulations).
5. **Events & audit**: consequential changes audited; events emitted with domain-map names; consumers idempotent.
6. **Contracts**: provider functions match `domain-map.md` names/shapes; ports match providers in other
   worktrees; deviations documented under "Contract changes" in the README.
7. **Data authority & environment safety**: `platform.assertWritable` used for governed domains; every external
   effect calls `assertExternalEffectAllowed`; trial/demo cannot reach real providers.
8. **Errors & UX contract**: errors explain problem + recovery; statuses kept separate (booking/stay/occupancy/
   condition/availability/payment); provenance where data comes from elsewhere.
9. **Spec coverage**: list MUST requirements from the spec that are missing or only partially implemented.
10. **Scenario claims**: for each scenario the README claims, open the test and judge whether it truly
    demonstrates the scenario's resulting state, financial/inventory effects, audit history and recovery.
11. **Honest readiness**: README readiness levels never exceed evidence (simulator ≠ integration; R3 max for
    internal implementation; external items R1/R2).
12. **Code quality**: no `any`, no default exports, pure domain logic separated, no `new Date()` in domain
    code, no dead code, no secrets/PII in logs, migrations append-only friendly, naming per glossary.
13. **One-product experience** (docs/product/experience-architecture.md, domain-map § Universal record contract):
    primary records return `status` per family, `allowedActions` with plain-language disabled reasons,
    `issues`, `owner`, `links`; `recordTypes` declared; a permission-aware `SearchProvider` with `summarize`;
    no sensitive values in audit before/after; shared verbs; UI work has `helpKey`s.
14. **Competitive parity gate**: `docs/parity/<module>.md` exists; run `node tools/parity-report.mjs --gate <module>`
    (in your copy); check that rows claimed `tested` really have a test that proves them; flag capabilities you know
    competitors have that are absent from the matrix.
15. **Cross-module coherence**: duplicated code that belongs in a shared package; terminology drift; two
    modules modeling the same concept differently.

## Pattern sweep (v2)
1. For every pattern in `docs/quality/patterns.md` groups A–E (and group F if this is a UI review), decide whether it
   applies to this module. If it applies, run its probe in your scratch copy, or, where a probe is impossible, read
   the code path. Write a throwaway test for each probe you can (`zz-review-*.test.ts` in your copy) and keep it as
   evidence.
2. **Reverse the order** (AP-08). For every attack you run, also run it with the actors' order swapped: the attacker
   creates the identity, link, account, record or configuration first, and the legitimate owner arrives later. Ask
   who controls this email, identity, domain or external account before the real person or hotel does.
3. **Attack the fix.** Before recommending a fix, state in the finding which attack you ran against the fixed
   design. For example: "if this is allowed only for brand-new emails, who controls a brand-new email?" A fix that
   creates a new exception must say why the exception is safe.
   State the fix as a rule with examples (for example "root change = anything that decides who signs in or which
   roles a sign-in grants: issuer, allow-list, groups claim, client id, …"), never as a closed list, and say which
   boundary case you attacked. (v2.1)
4. **Sibling paths** (AP-45). For every finding, list the other entry points that make the same state change:
   routes, services, SCIM/SSO, jobs, event consumers, imports. Probe them, and name all of them in the fix.
5. **Privilege equivalence** (AP-09). For every permission that can be delegated, list what it reaches transitively.
   Any permission that reaches administrator power must be reported as administrator-equivalent.
6. **Load-bearing check** (AP-54, v2.1). List the mechanisms your recommended fix newly relies on. If any has an open
   lower-severity finding or known gap (in this review or earlier ones), re-rate it at the fix's severity and include
   it in the fix.

## UI sweep (front-end reviews only, v2)
- **Viewports from the personas:** 390×844, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080. Report any horizontal
  page scroll, controls out of reach, and decision-critical text that cannot be read (UX-07, UX-16).
- **Invalid input:** submit every form empty, too long, and with a wrong type. The message must be inline and in staff
  language, with no raw payloads, and its advice must not lose work (UX-04, UX-05).
- **Activate everything:** every button, link, palette result type, tile and shortcut. Each must change state or
  navigate where its label says (UX-01, UX-02, UX-11).
- **Role × route and role × action:** sign in as each persona role. Request every route by URL and look at every
  action offered. Nothing the server would refuse may render, risky defaults count as findings, and hidden
  navigation is never treated as access control (UX-09, AP-05).
- **Accessible names:** no UUIDs, codes or keys in accessible names. axe does not catch this (UX-13).
- **Copy sweep:** no developer terms, i18n keys or internal ids visible to staff (UX-04).
- **Shared-desk handover:** user 1, then session expiry, then user 2 signs in on the same tab. Nothing of user 1's may
  show (AP-16, UX-15).

## Report
Write the report to the report path in your run parameters (default `docs/orchestration/reviews/review-<module>.md`):
- Verdict: `merge` / `merge after fixes` / `do not merge`. The commit reviewed.
- Command results (pass/fail with key output).
- Findings table ranked: **P0** (security, isolation, money correctness, data loss), **P1** (contract or
  architecture violation, missing MUST, false scenario claim), **P2** (missing tests, UX/error quality,
  maintainability), **P3** (nits). Each: id, severity, file:line, problem, why it matters, concrete fix (naming every
  sibling path, and the attack you ran against the fix).
- **Coverage declaration** (required): one row per checklist item 1–15 and per pattern ID: `probed — clean`,
  `probed — finding <id>`, `code-read only`, `not applicable (why)` or `not probed (why)`. Silence is not allowed.
- Spec coverage summary and scenario-claim assessment.
- Cross-module notes for the orchestrator (contract mismatches with other worktrees, shared-code candidates).
Final reply: verdict + counts by severity + the top 5 findings in one line each + the number of patterns probed /
applicable.

## Calibration notice
Any review may be a calibration run on a copy that contains seeded defects. Review every branch the same way. You
will not be told which runs are calibration runs.
````

## Variant: focused re-review (after a fix round)

Use the v1-b shape (`archive/steward-reviewer-v1.md`, Part 3). Do this for any branch whose first review raised a P0,
and for any module whose fix round added a new state machine or exception. Since v2, the re-review brief must also
include:
- re-run every original PoC, inverted; each must now be refused;
- re-run the **Pattern sweep** steps 2–5 against the *fix commits*;
- add the coverage declaration.
