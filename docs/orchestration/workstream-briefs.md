# Workstream briefs (for relaunching any agent identically)

Every module agent follows `module-agent-playbook.md` (setup, reading list, boundaries, quality bar, git rules,
deliverables). Below: each workstream's scope plus **every follow-up instruction** sent after launch. Test DB prefix
per agent: `PORTICO_TEST_DB_PREFIX=w1_<module>`. Launch prompt pattern: "You are the engineer for Portico's
<module> module. Read and follow docs/orchestration/module-agent-playbook.md. Worktree … branch … Spec
docs/specs/<module>.md. Continue from the README Checkpoint section. <scope below>".

## Follow-ups sent to ALL module agents
1. `git merge --no-edit main` regularly (test-harness fixes, boundary guardrail, demo seeder with `DEMO_SEED_STEPS`
   — export a `(tx, org) => Promise<void>` demo seed).
2. **Universal record contract** (domain-map § Universal record contract): primary GETs return `status` per family,
   `allowedActions` with plain-language disabled reasons, `issues`, `owner`, `links`; declare `recordTypes`;
   export a permission-aware `SearchProvider` with `summarize` (pattern: `modules/platform/src/search.ts`); never
   put secrets/sensitive identity values in audit before/after.
3. Periodic work uses `ScheduledJob` (`packages/db/src/jobs.ts`) exported as `<module>Jobs`.
4. Checkpoint discipline: README "## Checkpoint" section + frequent commits.

## inventory — DONE (feat/inventory-core)
Unit types/units/features, composite units (connecting rooms), per-night availability ledger with guarded updates
(S01 truly concurrent test), holds with expiry job, authorized overbooking vs conflicts, assignments with exclusion
constraint (S03), unit blocks OOO/OOS/house use returning affected assignments (S08), availability grid and
explanations, `limits.units`, Maldives demo seed. Follow-up: hold-expiry job.

## rates — DONE (feat/rates-core)
Rate plans (base/derived, cycle-safe), prices per type/night/occupancy incl. child bands, restrictions with
explanations, promotions, packages/inclusions/allowances, policies, tax & fee engine as dated cited data with
tax-point policies, quote engine with sealed TermsSnapshot, priceChange, Maldives demo seed. Follow-up: verified
Maldives rules (`docs/readiness/maldives-tax-rules.md`): TGST by time of supply, Green Tax USD 12/6 by
`mv.registeredRooms` + `mv.inhabitedIsland`, under-2 exempt, 12-hour check-out block, GST not on Green Tax, service
charge in GST base, tips outside, USD reporting with MMA ±2% conversion.

## guests — DONE (feat/guests-core)
Profiles (scripts/transliteration), companies/agencies, consent per purpose with legal basis, encrypted identity
documents with audited reveals, duplicates (exact + fuzzy), reversible merge/unmerge (S15), cross-property sharing
gated by entitlement + policy + permission + guest objection, permission-aware search, DSR export/erasure with
retention, connected mode, demo seed.

## reservations (feat/reservations-core)
Bookings/stays/segments/occupants with separate status families; quote → hold → tentative → confirm; walk-ins;
multi-room; cancellation fee from snapshot; no-show; waitlist; comps/house use; CHANGE PREVIEW with commit token for
date/type/occupancy/rate changes, moves, extensions, shortenings, split stays, early/late; S03 alternatives; check-in
and check-out as resumable step workflows; front-desk arrivals/departures/in-house with readiness + single blocker;
shift handover; `ingestChannelBooking` idempotent by (connection, externalId, revision) with relocation-required on
conflict (S02); optimistic concurrency (S14); data authority `reservations` incl. forwarded-change records; ports
to inventory/rates/guests/finance/payments/operations/platform with high-fidelity fakes. Follow-ups: **AccessPort
as a real key-lifecycle contract** — issueKeys/extendKeys/moveKeys/cancelKeys returning issued|pending|unavailable|
simulated; lock-system-down = recorded manual-fallback step, never silently done; checkout/moves cancel/move keys.
Record contract for bookings and stays (check in, move unit, extend, cancel, check out with reasons; issues like
unassigned unit, payment pending verification, relocation required).

## finance (feat/finance-core)
Chart of accounts per legal entity (USALI-inspired), balanced append-only journal with business/service/revenue
dates, folios per payer, postings, charge codes, tax via TaxPort, billing rules with SPECIFICITY-based resolution
(no ranked lists — patent caution, Q40) + preview, transfers/splits/split tenders, deposits as liability + apply at
check-in + forfeiture, allowances consumption, late charges after departure (S10), gapless invoices/credit notes
with hash chain, AR with credit limits & aging, cashier sessions, FX, Day Close checks, idempotent provider functions
for payments. Follow-ups: Maldives invoice rules (tax point = time of supply; deposits carry TGST at receipt rate and
final invoice credits it; mandatory particulars; Green Tax own line excluded from GST base; service charge in base;
3-day issuance check; USD conversion within ±2% of MMA rate recorded; ≥5-year retention; monthly Green Tax report).
Record contract for folios, invoices, AR, cashier sessions.

## payments (feat/payments-core)
Provider-agnostic domain; payment accounts per legal entity; tokens only; SimulatorProvider with scenario controls;
StripeConnectProvider (direct charges, never called for real); provider-operation journal; pending_verification
(S05); refunds never twice (S06); webhook dedupe/out-of-order; reconciliation; LedgerPort only after confirmation;
payouts ≠ revenue; payment requests; VCC records; disputes; outage handling (S20). Follow-ups: **"Route D" recorded
external-terminal payments** (`recorded_unverified` until matched to acquirer settlement statement CSV import; cash
and bank transfer recorded methods; mismatches → payment exceptions; refunds recorded likewise); scheduled jobs for
reconciliation/authorization expiry/VCC; record contract.

## operations (feat/operations-core)
Unit condition separate from occupancy; DND/turndown; housekeeping tasks from events/day plans with workload
suggestions; inspections (S07 event + readiness ETA); generic tasks with SLA escalation; service requests ("done"
requires task done); work orders, assets, preventive schedules, OOO via InventoryPort with affected stays (S08);
return-to-service requires WO completion + inspection; lost & found; OFFLINE SYNC API (S13); event consumers;
connected mode for `roomStatus`/`maintenance` with forwarded changes. Follow-ups: jobs for escalation/preventive;
record contract; "My work" inbox listing efficient.

## integration (feat/integration-core)
Connector SDK with workflow-level capabilities and honest statuses; reference connectors `pms.simulator` (fault
injection), `file.csv` (never "live"), `webhooks.outbound` (HMAC, retries, replay); connections with the 9-step
setup state machine; encrypted credentials via SecretStore port; mappings with suggestions + mandatory review; exchange
log, sync runs, inbound dedupe/ordering, outbound queue that never blindly replays money/inventory actions; health
with urgent vs routine and impact; exceptions in plain English; pause/disconnect/rotate/replace with impact preview;
environment safety. Follow-ups: reconcile with `docs/adoption/*`; **G-03** trial reads only with read-only scope;
**G-05** freshness targets → `delayed`/`incomplete` provenance; port for platform activation scope and authority
transitions; record contract; exceptions into "My work".

## backoffice (feat/backoffice-core) — packages/ui + apps/backoffice
React 19/Vite/TanStack/Tailwind v4 tokens/Radix; accessible components (DataTable with saved views, status badges per
family, ProvenanceBadge, EnvironmentBanner, ProblemAlert, ConflictDialog, ChangePreview, StepTracker, Timeline,
CommandPalette…); real API for auth/me/org/properties/users; mocked (labeled simulated) role workspaces. Ports: API
4100, Vite 5180, DB `portico_w1_ui`. Follow-ups: (a) demo seeder for real sign-in; (b) **design direction**
(`docs/product/design-direction.md`; owner's Fin reference images were in the session scratchpad — qualities only,
never copied): KPI tiles with counts + definitions, data voice, calm neutrals, rail + section nav, header with
property/date/filter chips, purposeful charts, light AND dark WCAG AA, density modes, "Today" dashboard; (c)
**experience architecture**: RecordDrawer/RecordPage, EntityLink hover previews, global search + command palette on
`/v1/search`, recent/pinned, "My work" shell, one shortcut registry, helpKeys + help panel + learning centre + role
checklists + "practise in training"; screenshots light/dark.

## identity-platform-enterprise (feat/identity-platform-enterprise)
MFA (TOTP, recovery codes, step-up for sensitive permissions centrally), OIDC SSO with fake IdP tests + JIT + role
mapping + SSO-required, SCIM, custom roles, staff lifecycle (invite, reset, transfer, time-limited, sessions),
support access (time-boxed, reasoned, customer-visible), break-glass, security alerts; platform owners & ownership,
outlets, configuration bundles with dry-run + rollout groups + separation of duties, trial lifecycle (create/reset/
export/delete/carry-forward), activation stages with approval. Follow-ups: data-authority **G-01** (reject
external+exclusive), **G-07** (DB check), **G-02** (history + planned→frozen→effective transitions), **G-06**
(`guestCommunications` domain), **G-04** (activation scope `assertEffectInScope`); editions.md §7 changes + **Connect**
plan for standalone modules; `getPropertyFacts`.

## infra (feat/infra-aws)
Terraform modules (network, Aurora PG16, ECS Fargate api/worker/migration task, S3, CloudFront+WAF, Secrets, KMS,
observability, SES, budgets with alert-vs-hard-cap explanation), envs demo/staging/production (ap-south-1 default),
remote state bootstrap, deploy pipeline as `infra/ci/deploy.yml.example` (GitHub OIDC), Dockerfiles, runbooks
(deploy, rollback, backup-restore verification, incident response, DB roles, DR targets). Nothing deployed; validate
honestly (registry blocked earlier; now allowed). Follow-up: single `tier` variable demo|lean|resilient with per-tier
cost table.

## Docs workstreams
- **journey** (docs/guest-journey-audit): stage-by-stage guest-journey coverage map, gap register, new specs
  `access`, `guest-experience`, `crm-marketing`, `contracting`, guest-services; spec change requests; Q80+.
- **backofhouse** (docs/back-of-house-specs): specs `accounting`, `fnb-pos`, `procurement`, `stock`, `workforce`
  (payroll computation = boundary/export by default), `concessions-and-utilities`; month-end walkthrough; spec change
  requests; Q100+.
- **parity-front / parity-finance / parity-ops**: `docs/parity/<module>.md` per `parity-researcher-brief.md`; gap
  files `docs/parity/gaps-<cluster>.md`; Q120+/Q130+/Q140+.

## Completed docs workstreams (merged)
Operational readiness (docs/readiness), adoption & integration (docs/adoption), product strategy (docs/product +
docs/specs + docs/scenarios), competitor research (docs/research).
