# Module specs

One spec per bounded context in `docs/architecture/domain-map.md`. Specs refine the owner briefs and never
contradict them. Engineers build from these; reviewers test against them.

| Wave | Specs |
|---|---|
| 1 | [platform](platform.md) · [identity](identity.md) · [inventory](inventory.md) · [rates](rates.md) · [guests](guests.md) · [reservations](reservations.md) · [finance](finance.md) · [payments](payments.md) · [operations](operations.md) |
| 2 | [day-close](day-close.md) · [distribution](distribution.md) · [groups](groups.md) · [comms](comms.md) · [analytics](analytics.md) · [integration](integration.md) |
| 3 | [resort](resort.md) · [ai](ai.md) · [billing](billing.md) |

Related product documents: `docs/product/editions.md` (entitlement keys), `docs/product/ux-principles.md`
(interaction standards every surface must follow), `docs/product/personas-and-workspaces.md`,
`docs/product/competitive-synthesis.md`, `docs/scenarios/README.md` (proof scenarios and evidence tests).

## Conventions

**Requirement IDs.** `<PREFIX>-Rnn` for capabilities, `<PREFIX>-Inn` for invariants. Prefixes: PLT platform,
IDN identity, INV inventory, RAT rates, GUE guests, RES reservations, FIN finance, PAY payments, OPS operations,
DCL day-close, DST distribution, GRP groups, COM comms, RST resort, ANL analytics, INT integration, AI ai,
BIL billing. IDs are stable: never renumber; retire with ~~strikethrough~~.

**Priority tags.**

- **MUST** — required for the module's wave to be called done (brief §18 definition of done applies).
- **SHOULD** — expected in the wave; may slip one wave with a recorded reason.
- **LATER** — designed for now (data model must not preclude it), built in a later wave.

**Entitlements.** Where a capability is commercially gated, the requirement names the entitlement key in
backticks, e.g. `groups.blocks`. The canonical key list, per-edition values and the never-gated list are in
`docs/product/editions.md`. A requirement without a key is available in every edition. Server-side checks use
`platform.hasEntitlement`; UI visibility additionally depends on the property profile (progressive disclosure).

**Invariants** are written to become tests. Each names the condition that must hold after every committed
transaction (or, where stated, after reconciliation). Invariants are enforced in the database (constraints,
exclusion constraints, unique keys) wherever possible, and in domain logic otherwise.

**Contracts.** Function signatures shown in specs repeat or extend `docs/architecture/domain-map.md`. Anything that
differs from the domain map is listed under *Proposed contract changes* in the spec and is **not** in force
until the domain map is updated (domain-map rule 1).

**Permissions** follow `<module>.<resource>.<action>`. Scope is `property` unless marked `(org)`. Sensitive
permissions (money movement, exports, user admin, overrides) are marked ⚑.

**Scenario participation.** `S01`–`S20` are the brief §17 proof scenarios; `E01`–`E15` are the readiness-brief §19
evidence items. Both are defined, with test names, in `docs/scenarios/README.md`.

**Terminology.** Glossary terms only (`docs/product/glossary.md`). Competitor product names appear only in
*Competitive inspirations* sections, citing `docs/research/0n-*.md`.
