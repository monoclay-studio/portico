# Agent run: Integration step: bind module ports

- Started: 2026-11-07T16:16:26.294Z · last activity: 2026-11-07T17:04:17.628Z
- Turns: 533 · tool uses: 331 · output tokens: 492,418
- Type: general-purpose

## Brief (2026-11-07T16:16:26.294Z)

````text
You are the integration engineer for Portico, a cloud hospitality management platform: a TypeScript modular monolith at /home/user/portico. Read these first:
- CLAUDE.md (non-negotiable rules)
- docs/orchestration/module-agent-playbook.md
- docs/architecture/domain-map.md
- ADR-0003 (ports and adapters), ADR-0015 (authorization across ports), ADR-0016 (finance decisions)
- docs/orchestration/pending-fixes.md: the queue of cross-module fixes. Many entries are yours.

Your worktree is /home/user/wt/integration-step (branch feat/integration-step, created from main). Commit locally after each meaningful step with Conventional Commits; never push. Postgres: postgres://postgres@127.0.0.1:5432/postgres; use PORTICO_TEST_DB_PREFIX=w1_intstep.

Situation: guests, inventory, operations, rates, payments, reservations, integration and finance are all on main, but many ports in apps/api/src/composition.ts are still bound to stubs that answer 503 `module_not_available`. Your job is to make them one product.

PHASE A — bind every port for real (composition root plus adapters):
1. finance ↔ rates: bind finance's tax port to rates (`bindFinanceTax`, already proven to type-check in apps/api/test/finance.test.ts).
2. payments → finance: bind payments' `LedgerPort` to `financeLedgerForPayments(finance)`, and finance's collection requests to payments. Update apps/api/test/payments.test.ts, which currently expects the stubs. Folio collections must then work, and money must still never cross property or legal entity.
3. reservations → rates: write `ratesPortFrom`. It maps rates' sealed TermsSnapshot v1, Offer and RepricingResult to the fields reservations reads. Store rates' terms document unchanged and pass it back as-is to `priceChange`, `evaluateCancellationPenalty` and `complimentaryTerms`. Deposits use `rates.instantiatePaymentSchedule`. The canonical contract is modules/rates/README.md § Provider contract.
4. reservations → guests, finance, payments, operations: bind each with an adapter in the owning direction. Contract notes are in each module's README "Ports" / "Contract changes" and in pending-fixes.md:
   - reservations passes `propertyId` on the finance calls listed there;
   - reservations reads `getPaymentStatus` first and never re-authorizes while pending;
   - reservations sends v2 booking/stay events (with `stays[]` and `aggregateVersion`), which operations consumes.
5. ADR-0015: inventory and payments must stop re-checking the caller's own permission keys on PORT calls. Keep the checks on their own HTTP routes. Remove the system-scope workarounds this made necessary in composition (operations' and reservations' inventory adapters). Each provider must still verify that every referenced record belongs to the passed property and legal entity.
6. Remaining pending-fixes entries that are cheap and cross-module: the `aggregateVersion` / `isNewerThan` adoption, and payer-type terminology in the glossary. Mark each one you finish as DONE in pending-fixes.md.

Every binding gets an API-level test proving the real path works end to end, plus a refusal test (wrong property, or external system of record). Use the module contracts; never import across modules (`tools/check-boundaries.mjs` runs in `pnpm lint`).

PHASE B — proof scenarios: docs/scenarios/README.md defines S01–S20 with normative test names (`scenarios/sNN-*.test.ts`); host them in apps/api/test/scenarios/.
- Implement every scenario that is possible with the merged modules, through public service/HTTP APIs, ending with the global consistency checks listed in that README.
- For any scenario not yet possible (day close, distribution, comms and similar are wave 2), add a `.todo` with the exact missing capability.
- IMPORTANT: a parallel branch (identity-plus) will soon make sensitive permissions require MFA and data-authority changes require a second approver. Write scenarios so they survive that: build contexts with the existing test helpers or service-level contexts rather than password-only HTTP sign-in, or use helpers I can update in one place. When I tell you identity-plus has merged, `git merge main` and adapt.

Rules:
- Preserve every module's guarantees (idempotency, ETags, audit, RLS, environment safety, data authority).
- Never weaken a test to make a binding pass. If a module has a real contract bug, fix it in that module with a regression test and record it in your report.
- Before you finish: `pnpm lint`, `pnpm turbo run typecheck --force` and `pnpm turbo run test --force`, checking exit codes.

Reply with:
- a table of each port → bound? (adapter file, test name);
- scenarios: passing / todo, each with its reason;
- contract bugs you fixed;
- command results;
- anything that needs an owner decision. Don't block on it: add it to docs/OPEN_QUESTIONS.md with a default.
````

## Report (2026-11-07T17:04:17.381Z)

````text
## Integration step: report (branch `feat/integration-step`, worktree /home/user/wt/integration-step, HEAD `dcddb8b`, not pushed)

Every reservations, finance and payments port that was still a 503 stub now goes to its real provider. Operations and reservations no longer reach inventory with system scope. I merged main after UX round 1 landed (`a5d0069`).

### 1. Ports
| Port | Bound? | Adapter | Proof → refusal test |
|---|---|---|---|
| finance.tax → rates | yes | `bindFinanceTax` in `apps/api/src/composition.ts` | `finance.test.ts` (a spa charge gets TGST from rates; live invoice refused `tax_rules_unverified`) |
| payments `LedgerPort` → finance | yes | `financeLedgerForPayments(finance)` | `payments.test.ts` "folio collections post to finance…" (posted once; refused: unknown folio, other-property folio). s05 and s06 |
| finance `PaymentsPort.requestCollection` → payments | yes | new `modules/payments/src/finance-collections.ts` (creates a payment request, records intent only) | `bindings.test.ts` "whole stay" (a late charge after departure creates a payment request). Refused: another property's folio → `not_possible`, nothing recorded |
| finance payer directory → guests | yes, now also companies and agencies | composition | s04 (the company folio is named) |
| reservations.rates → rates | yes | new `modules/reservations/src/adapters/rates.ts` `ratesPortFrom` | `bindings.test.ts` (seal verifies on the stored document; extension via `priceChange`; penalty from rates). Refused: `rates_managed_externally` |
| reservations.inventory → inventory | yes, no system scope | `inventoryPortFrom(inventoryProvider(...))`; new `modules/inventory/src/provider.ts` | `bindings.test.ts` (an agent with no inventory keys books and assigns). Refused: `scope_mismatch`. Also `modules/inventory/test/provider-port.test.ts` |
| reservations.guests → guests | yes, direct and type-checked | composition | `bindings.test.ts` (stay history). Refused: guest profiles external. s15 |
| reservations.finance → finance | yes | `financeForReservations` (`propertyId` on every call) | `bindings.test.ts`. Refused: another property's folio → 403; charges external. s04 |
| reservations.payments → payments | yes, direct | `payments.service.provider` (property-scoped) | `bindings.test.ts` (one authorization, sent once). Refused: `scope_mismatch`; payments external. s05 |
| reservations.operations → operations | yes | new `modules/operations/src/reservations-port.ts` | `bindings.test.ts`. Refused: `unit_property_mismatch`. s07 |
| operations.inventory → inventory | yes, no system scope | `inventoryProvider` (`propertyId` added) | `operations/test/real-inventory.test.ts`. s08 (engineer with no inventory keys) |

- **Still unbound (out of scope here):**
  - integration: catalog for tax rules, charge codes and outlets; activation scope; authority transitions (wait for identity-plus, FR-2); inbound handlers.
  - rates: `channelForApiClient`, `affectedAgreements`.
  - guests: reference counters, data-export contributors, booking lookup, comms.
  - reservations: door locks/keys still use the environment-safe fallback (simulated outside live).
- **ADR-0015:**
  - The property-scoped delegation helper now lives in the kernel (`delegateAtProperty`).
  - Inventory and payments no longer re-check their own permissions on port calls; they refuse records of another property instead. Their HTTP routes keep their checks.
  - Refunds, overbooking, house-use blocks and lock overrides still need explicit permission.
  - Operations' `createTask` provider no longer re-checks its own permission.
- **Other cleanup items:**
  - v2 booking and stay events: confirmed working end to end with operations (s07).
  - Payer types are now defined once in the glossary.
  - `aggregateVersion` is only partly adopted: inventory unit and unit-type events now carry it; payments does not yet.
  - 13 entries in `pending-fixes.md` marked DONE, 3 marked PARTLY DONE with what remains, and follow-ups added.

### 2. Scenarios (`apps/api/test/scenarios/`; shared helpers in `harness.ts`)
- **Passing (12), each ending with the global consistency checks:** S01 (+ 20-way stress), S03, S04, S05 (+ failure variant), S06, S07, S08, S13, S14, S15, S16, S17.
- **Parts of passing scenarios left as todo, each naming the missing piece:**
  - payment authorization increase on extension and the 12 Mar move task (S03);
  - Day Close, receivables and invoices per payer, transfer preview (S04);
  - desk alert and waiting-guest timer (S07);
  - relocation to a sister property and relocation costs (S08);
  - "Delayed" labels on the offline device (S13);
  - finance and comms consuming unmerge (S15);
  - policy locks and exemptions (S16);
  - security log, exports and webhook replays (S17).
- **Todo only:**
  - S02: needs distribution, rates channel-price terms and payment collection plans.
  - S09: Day Close.
  - S10: needs resort POS intake, automatic card-on-file charging and a supplementary folio after an invoice. The finance → payments part is already proven in `bindings.test.ts`.
  - S11: groups module.
  - S12: resort and comms modules.
  - S18: migration import.
  - S19: Day Close, POS and cashier (rates' pricing part is proven in the rates module).
  - S20: distribution and collection plans (payments' own S20 test covers its part).
- **For identity-plus:** staff act through service-level contexts built from role templates. Password sign-in happens only in `signIn()` and data-authority changes only in `makeExternal()`, both in `harness.ts`. When identity-plus merges, those two are the places to update.

### 3. Contract bugs fixed
1. **Every booking deposit failed to post to the ledger when the Maldives tax rules were installed.** Finance taxes a deposit at receipt without knowing occupancy, and the per-person Green Tax rule refused (`tax_occupancy_required`). Fix: rates' charge line gets `valueOnly`, and finance sets it for deposits. Regression tests in the rates tax-engine test and the "whole stay" binding test.
2. **Quotes with real rates would need a backdating permission.** Reservations sent the business date as `bookingDate`/`asOf`, which rates treats as backdating (`rates.quote.backdate`). The adapter now omits them, so rates evaluates "now".
3. **Previews would always go stale with real rates.** The preview fingerprint included the sealed document, whose quote id and seal change on every quote. The fingerprint now excludes it.
4. **Operations' `createTask` provider re-checked its own permission**, contrary to its README and ADR-0015. Removed.
5. **Company folios showed a placeholder payer name.** Finance's payer directory now names companies and agencies through guests.

### 4. Commands (final)
- `pnpm lint`: exit 0 (module boundaries OK).
- `pnpm turbo run typecheck --force`: exit 0, 16/16 tasks.
- `pnpm turbo run test --force`: exit 0, 14/14 tasks. API: 68 passed, 29 todo. Reservations 148, guests 173, integration 173, rates 129, operations 120, payments 113, inventory 98, finance 85, kernel 26, plus db, platform, identity and http.
- After that run I added one more refusal test (finance → payments); I re-ran that file, lint and the api typecheck, all green.

### 5. Decisions and next steps
- **Q146 (owner)** in `docs/OPEN_QUESTIONS.md`: should late charges be charged automatically to the card on file? Default: always send a payment request; staff decide on any card charge.
- **Engineering, not owner:** complimentary stays still need both `reservations.stay.complimentary` and `rates.price.override`. Rates also still checks `rates.quote.read` on port calls. Recorded in pending-fixes.
- **UX round 1 wiring:**
  - Added `GET /v1/properties/:id/data-authority`, `GET /v1/properties/:id/policies/:key` and `POST /v1/policies/preview` (INT-03, SET-05). Write routes should wait for identity-plus.
  - Search now matches phone fragments of 3 or more digits (NAV-03). Search hits resolve to record types the UI knows, `guest_profile` included (GST-01).
  - FD-15: balances and payment detail are hidden on the front-desk boards for roles without money permissions (tested).
  - Still open:
    - NAV-03 ranking by stay status and the "why it matched" line;
    - money on booking and stay records beyond the boards (FD-15).
- **Domain map:** the contract changes are recorded in `docs/architecture/domain-map.md` under "Integration step".
````

