## What and why

## Scenarios / evidence
<!-- Which operational proof scenarios (docs/scenarios) or readiness items does this advance? Link test names. -->

## Checklist
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass
- [ ] Migrations are new files (merged migrations are never edited)
- [ ] Permissions checked in the service layer; tenant isolation covered by tests
- [ ] Money-moving or external-effect paths are idempotent and respect environment safety
- [ ] Audit entries for consequential changes
- [ ] Docs updated (domain-map contracts, specs, readiness register) where behavior changed
