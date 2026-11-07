# Agent run: Integration step: bind module ports

- Started: 2026-11-07T16:16:26.294Z · last activity: 2026-11-07T18:07:07.678Z
- Turns: 813 · tool uses: 505 · output tokens: 729,876
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

## Follow-up message (2026-11-07T17:27:08.129Z)

````text
The coordinator sent a message while you were working:
The steward review of feat/integration-step says **merge after fixes**: P0 0 · P1 3 · P2 7 · P3 9.
- Report: /home/user/portico/docs/orchestration/reviews/review-integration-step.md (main working tree; read the latest file).
- PoCs: docs/orchestration/reviews/integration-step-poc/*.ts.txt. Each one passes today because it asserts the buggy behaviour; turn every one into a regression test asserting the fix.

Fix the P1s:
- **P1-1:** a deposit for another property's booking, or for a booking that exists nowhere, is accepted and posted to the wrong legal entity.
  - Add a booking-directory port from reservations for payments and finance.
  - Refuse unknown and other-property bookings exactly like folios.
  - Finance must never bind a booking to "whichever property takes the first deposit".
- **P1-2:** check-in could hold any card for any amount without payments permission.
  - Require `payments.payment.collect` when the card or amount is overridden.
  - Verify the card belongs to the booking's guest or payer.
  - Cap the amount by policy.
- **P1-3:** late-charge collection must request at most what the folio actually owes, never the full charge on a folio in credit. Also fix the bindings test so it asserts the amount.

Fix the P2s:
- **FD-15:** hide the money-derived payment-check status, and totals and payment status on booking and stay reads, for roles without money permissions.
- **Finance delegation:** make the property parameter REQUIRED; no all-properties grant.
- **Rates adapter:** verify the terms seal before using a stored document.
- **S04:** make it truly prove child ages and Green Tax drive the price.
- **Your report:** correct the "every stubbed port bound" claim. Integration inbound handlers and catalogs, and rates' `affectedAgreements`, are still stubbed; list them.
- **Rates and guests port re-checks (ADR-0015):** remove them, or record the decision in pending-fixes with a real reason. Pending-fixes points to an OPEN_QUESTIONS entry that doesn't exist; fix that reference.
- Cheap P3s.

New process (on main under docs/quality, after you merge main):
- Before you report done, run docs/quality/playbooks/module-builder-self-check.md and include its tables in your reply.
- Follow docs/quality/playbooks/scenario-tests.md v2: each scenario states which ports were real and which assertion proves each expected outcome.
- For every P1 fix, attack your own fix once more (the re-attack table) before reporting.

Merge main first: backoffice and the quality system are now on main. Conflicts in OPEN_QUESTIONS.md and pending-fixes.md are append-only, so keep both sides. If your late-charge question collides with identity-plus's Q146–Q149, renumber yours to the next free number above Q155.

Gates:
`pnpm lint && pnpm turbo run typecheck --force && pnpm turbo run test --force --concurrency=2`
Use PORTICO_TEST_DB_PREFIX=w1_intstep_fix and check the exit codes.

Commit (Conventional Commits) and don't push. Reply with finding → commit → test, the self-check tables and the command results.

Address this before completing your current task.
````

## Follow-up message (2026-11-07T17:31:30.337Z)

````text
[Request interrupted by user]
````

## Follow-up message (2026-11-07T17:38:53.297Z)

````text
The coordinator sent a message while you were working:
Resume after the owner's checkpoint. Your WIP is committed on feat/integration-step as "wip(...): usage-limit checkpoint". Run `git log -3` to confirm, and amend or keep it as you prefer. Continue the fix round exactly where you stopped: you were reading the check-in guarantee step for P1-2. The brief is unchanged: P1-1 to P1-3 and the P2s from reviews/review-integration-step.md, the self-check tables, and the scenario-tests v2 rules. The gates are unchanged too.

Address this before completing your current task.
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

## Report (2026-11-07T18:07:07.577Z)

````text
## Integration-step fix round: all P1s and P2s fixed, gates green

I fixed the 3 P1s, all 7 P2s, and six of the nine P3s: P3-1, P3-2, P3-4, P3-5, P3-6, P3-8 and P3-9. P3-3 and P3-7 are recorded in pending-fixes, not fixed. Every reviewer PoC is now a regression test in `apps/api/test/review-regressions.test.ts` that asserts the attack is refused. Branch `feat/integration-step` @ `6fb1d00`, worktree /home/user/wt/integration-step, not pushed.

I merged main twice; conflicts were only in the append-only docs and were resolved as unions. My late-charge question is renumbered **Q156** (Q146–Q149 belong to identity-plus, Q150–Q155 were on main). I replaced the usage-limit WIP checkpoint with a proper commit. The pending-fixes reference to a non-existent OPEN_QUESTIONS entry is gone; it now records the rates and guests decisions below.

### Correction to my previous report (P2-5)
"Every port bound" was wrong. These are still stubs on main, now listed in pending-fixes:
- **integration:** `inbound` handlers (`{}`: reservations, roomStatus, charges); catalogs for `taxRule`, `chargeCode`, `ledgerAccount` and `outlet`; `activationScope` and `transitions` (wait for identity-plus).
- **rates:** `affectedAgreements` and `channelForApiClient`.
- **guests:** `referenceCounters`, `personalDataContributors`, `bookingLookup`, `communications`.
- **reservations:** `access` (environment fallback adapter; no access module exists).
- **Reads still made with system scope** (routing metadata, not ADR-0015 port commands): integration's catalog reads of inventory and rates, rates' `getProperty`/`listUnitTypes`/`companyExists`, and platform `getProperty` reads in finance, guests and payments.

### Finding → commit → test
| Finding | Commit | Regression test |
|---|---|---|
| P1-1 deposit for another property's or an unknown booking | `6d0cae8` | review-regressions "P1-1" (2 tests); finance payments-ledger-port test (unknown → `ledger_target_unknown`) |
| P1-2 check-in holds any card for any amount | `6d0cae8`, `e47ef37` | review-regressions "P1-2" (2 tests); reservations check-in-resume "review P1-2" |
| P1-3 late charge over-collects | `4e061b3` | review-regressions "P1-3"; bindings test now asserts the requested amount |
| P2-1 FD-15 money still visible | `7b81cc9` | review-regressions "P2-1"; reservations isolation-permissions FD-15 |
| P2-2 organization-wide finance delegation | `8b3fdfb` | review-regressions "P2-2" (scoped → 403; omitted scope → refused, never widened) |
| P2-3 rates seal not verified before use | `216200e` | review-regressions "P2-3" |
| P2-4 S04 claim weaker than its test | `ee4fcb4` | s04: same villa type, with and without children; Green Tax 12 × persons × nights; infant exempt |
| P2-5 stub list | `1b9cf7b` | pending-fixes entry; `apps/api/test/scenarios/README.md` binding manifest |
| P2-6 rates and guests re-check their own keys | `e9e8b7d` (rates), `1b9cf7b` (guests decision) | review-regressions "P2-6" |
| P2-7 misleading 403 at check-in | `6d0cae8` | guarantee step fails with the recovery instead of throwing |
| P3-1 / P3-2 / P3-4 / P3-5 / P3-6 / P3-8 / P3-9 | `216200e` / `eaa99fc` / `eaa99fc` / `4e061b3` / `eaa99fc` / `eaa99fc` / `eaa99fc` | rates and guests unit tests; s05 (user path) and s01 (no postings asserted); review-regressions "P3-9" ×2 |

What changed:
- **P1-1:** reservations now answers "which property owns this booking or stay". Finance uses it before recording any deposit: unknown booking → `ledger_target_unknown`, another property → `scope_mismatch`. A booking is never bound to the first property that pays. Payments no longer lets unknown bookings through, and refuses holds for another property's or an unknown stay or booking.
- **P1-2:** choosing another card or an amount at check-in needs `payments.payment.collect`. The card must belong to the booking's booker, an occupant, the company/agency or the billing payer; this is also checked when a booking records or patches its card. The amount is capped by policy `reservations.checkIn.guaranteeCapPercent` (default 150 % of the agreed stay total).
- **P1-3:** finance requests `min(late charge, folio balance after posting)`. When the folio is still in credit nothing is requested and a routine exception records `covered_by_credit`. The payer type now reaches payments (P3-5).
- **P2-1:** for roles without finance or payments read permissions, payments is not read at all. The payment check shows `unknown` / "not shown for your role" and does not count towards ready or the blocking reason. Booking and stay records and booking lists return no totals, deposit requirement, payment status or folio links (`moneyRedacted`). `totals` is now nullable on booking and stay views.
- **P2-2:** finance's delegation helper always needs a property (or `null` for legal-entity-level calls) and throws otherwise. Every function of the reservations adapter requires `propertyId`.
- **P2-3:** the reservations rates adapter verifies the seal before evaluating penalties, deposits, complimentary terms or price changes (`terms_seal_invalid`). For P3-1, the preview digest now includes the provider's policies verbatim.
- **P2-6 rates:** a rates port surface grants `rates.quote.read` at the quoted property only. Complimentary terms and price overrides still need `rates.price.override`, and backdating still needs its own key.
- **P2-6 guests (decided, not changed):** `resolveProfile` keeps checking `guests.profile.update`. Matching reveals whether a guest exists by email, phone or document, so delegating it would let roles without guest access probe for guests. Every booking role template already holds that key.
- **P3-9:** when charges or payments are external, the deposits or guarantee step is marked done and names the system of record, instead of interrupting check-in.
- **New global consistency check:** every deposit finance holds must belong to a reservations booking of the same property.

### Re-attack table (self-check §3)
| Finding | (a) reverse order | (b) siblings checked | (c) failure path | (d) griefing | (e) atomic |
|---|---|---|---|---|---|
| P1-1 | Ghost-booking deposit refused first, so nothing can be bound later; first deposit at the owner, later one from another property refused (finance test) | payments charge, capture, payment request, VCC (all through the ledger-target check); finance via payments and the reservations port; Route-D recorded authorization; hold for a stay ref | 0 new payments, 0 deposit accounts (row counts compared before and after) | Hiyani can no longer put Kandu's stay or booking into the refused state (stay/booking holds refused); owner's deposit and check-in still work | n/a (no counter) |
| P1-2 | Stranger's card attached at booking creation or patch is refused before the desk acts | check-in override, booking create, patch booking, the payments route itself | 0 authorizations; booking count and version unchanged | No outside party can make a guest's own card fail; the guest's card succeeds | Cap is a fixed limit per stay; one authorization in flight per reference (payments unique index) |
| P1-3 | Credit first, then a larger charge → exactly the remaining debt is requested | finance's collection request is the only caller | Folio in credit → no request row | n/a | Balance is read after posting, under the folio row lock; a concurrent second request is refused by payments (one in flight). **No concurrent test** |
| P2-1 | n/a | arrivals board, booking and stay records, booking lists (departures were already done) | n/a | n/a | n/a |
| P2-2 | n/a | finance: reservations adapter, credit notes, receivables invoices | omitted scope throws before any read | n/a | n/a |
| P2-3 | n/a | penalties, schedule, complimentary terms, price changes | refused before any evaluation | n/a | n/a |

### Self-check §2 (items 5–32): 19 yes · 5 N/A · 4 no
- **Yes:** 5, 6, 7, 8, 10, 12, 14, 15, 16, 19, 20, 21, 22, 24, 25, 27, 30, 31, 32.
- **N/A:** 18, 23, 26, 28, 29.
- **No, each listed as a gap:**
  - 9 and 11: no concurrent test for two late charges on the same folio.
  - 13: payments events still carry no `aggregateVersion` (in pending-fixes).
  - 17: no ±1 boundary test at the guarantee cap.

### Scenario-tests v2
- **Binding manifest** in `apps/api/test/scenarios/README.md`: no module fakes are imported. Every exercised port is real except access (simulated keys), which S03, S05 and S15 touch only in the check-in keys step. That step is outside their catalogue lines; they are marked accordingly, not as blocked.
- **Assertion map:** every State, Money, Inventory, Audit and Recovery line of the 12 passing scenarios points to a file:line or a named `.todo`. Still todo: S02, S09–S12, S18–S20.

### Commands (merged tree, exit codes read directly, `PORTICO_TEST_DB_PREFIX=w1_intstep_fix`)
| Gate | Exit |
|---|---|
| `pnpm install --frozen-lockfile` | 0 |
| `pnpm lint` | 0, boundaries OK, no warnings |
| `pnpm turbo run typecheck --force` | 0, 18/18 |
| `pnpm turbo run test --force --concurrency=2` | 0, 16/16 |
| `pnpm turbo run test --force` (default concurrency) | 0, 16/16 |

- **Test counts:** api 79 passed, 29 todo; reservations 149; payments 113; finance 85; rates 130; guests 174; operations 120; inventory 98; integration 173; ui 87; backoffice 36; kernel 26; db 12; platform 9; identity 5; http 3.
- **Slowest API files (CI run):** review-regressions 7.7 s, rates 6.7 s, bindings 6.4 s, inventory 6.2 s, demo-seed 6.0 s, s01 4.8 s. All are within the 30 s per-test budget.
- **Test databases:** none with the `w1_intstep_fix` prefix left behind.

### Still open, recorded in pending-fixes
- **P3-3:** operations' `getUnitCondition` and provider `createTask` do not check stay, guest or department refs against the property.
- **P3-7:** `booking.depositRequirement` should come from the agreed payment schedule, not client input.
- **Saved-card ownership:** payments returns an already-saved token's method with its original owner. With the new owner check, a second guest saving the same token gets a card they cannot use; payments needs to decide refuse vs owner link.
- **Q156** (owner): automatic charging of a departed guest's card for late charges. Default: always a payment request.
````

