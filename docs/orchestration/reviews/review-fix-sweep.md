# Fix re-attack sweep — every merged P0 and money/security P1 fix (steward playbook v2.1, focused re-review variant)

| | |
|---|---|
| **Commit reviewed** | `main` @ `4ea8905` (722b345 + two docs-only commits: `docs/chronicle/01-timeline.md`, `STATUS.md`) |
| **Scratch copy** | `…/scratchpad/review-sweep-copy` (detached worktree, removed at the end) |
| **DB prefix** | `PORTICO_TEST_DB_PREFIX=review_sweep` (every test database dropped; none left) |
| **PoCs** | `docs/orchestration/reviews/fix-sweep-poc/*.ts.txt` (each asserts the SAFE outcome; a failing test is a residual) |
| **Modules** | guests, inventory, rates, payments, operations, reservations, integration, finance, backoffice (UI: P0-1 and P1-2 only) |

## Verdict per module

| Module | Verdict | Why |
|---|---|---|
| **payments** | **residual found** | P1-2 guard bypassed through authorize → capture (SW-PAY-1) and the `custom` purpose (SW-PAY-2). The P0-1 scope check covers the ledger target but not the **card** (SW-PAY-3). The P1-8 "fact, not claim" fix uses a field the client declares (SW-PAY-4) |
| **guests** | **residual found** | G-P0-1: erasure completes while `core.idempotency_keys` still holds the guest's name and date of birth, and a replay returns them (SW-GUE-1) |
| finance | fix holds | F-01/F-02 lock before measuring; concurrent tests are genuine. One P2 boundary in F-04 (SW-FIN-1) |
| rates | fix holds | R-01 pinning works for rules marked `commercial`. A hotel-created rule defaults to `statutory`, so R-01 recurs for any fee a hotel adds (SW-RAT-1, P2) |
| backoffice | fix holds | P0-1 guard and per-user keys are in place, but the e2e regression test cannot fail (SW-BO-1, P2). P1-2 holds |
| inventory | fix holds | INV-01/02/03/05 hold; one P3 race note (SW-INV-1) |
| operations | fix holds | P0-1/P0-2 hold. P1-12 is detection-only; the inventory-side refusal is tracked in `pending-fixes.md` |
| reservations | fix holds on main | rates, finance and payments ports are stubs on main, so R-01 fails closed (503). Real bindings live on `feat/integration-step` (not merged, not swept) |
| integration | fix holds | F1–F8 hold; one P3 address-policy nit (SW-INT-1) |

**Counts (new findings):** P0 0 · **P1 4** · P2 4 · P3 2.
Original findings re-attacked: **15 P0 + 41 in-class P1 = 56**. 48 refused on main. 4 bypassed through a sibling or boundary
(payments P1-2, P1-8, the P0-1 card scope; guests G-P0-1). 2 hold only as detection or fail-closed (operations P1-12,
reservations R-01, both tracked). 2 not re-probed or not applicable on main (finance F-09; reservations R-14).

## Command results (scratch copy, exit codes read directly)

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm lint` | exit 0 (biome 723 files; "Module boundaries OK (10 modules checked)") |
| `pnpm turbo run typecheck --force` | exit 0 (18/18, 0 cached) |
| `pnpm --filter @portico/<m> test` | all exit 0: payments 113, finance 85, inventory 96, operations 120, guests 173, rates 128, reservations 147, integration 173, api 46, backoffice 36 |
| `payments/test/zz-review-sweep.test.ts` | **4 of 4 fail** (SW-PAY-1…4: residuals confirmed) |
| `api/test/zz-review-sweep-guests.test.ts` | **1 of 1 fails** (SW-GUE-1 confirmed) |

## New findings

| id | sev | where | problem (attack run) | why it matters | fix: principle, siblings, attack on the fix, load-bearing check |
|---|---|---|---|---|---|
| **SW-PAY-1** | **P1** | `payments/src/service/collect.ts:441-520` (`capture`: no `assertCollectionOwnership`; purpose = `defaultPurpose(ref)` at :521); `:253` (`authorize`: no check either); `:153-183` (the guard itself reads without a lock) | **P1-2 is bypassed through the hold path.** A guest pays the USD 500 deposit through a link. The desk's `chargeNow` for the same deposit is refused (`collection_owned_by_payment_request`), so the original attack is closed. Then the desk **authorizes** the card on the same booking and **captures**: no reason is asked, and **2 deposit postings** result (PoC `SW-PAY-1`). | This is the exact double-collection that P1-2 and AP-28 exist to prevent. Holds-then-capture is the normal resort flow (check-in guarantee), so this is the common path, not an edge case. | **Principle:** every path that turns money into a posting on a ref checks purpose ownership *where the money is collected*: charge, capture, recorded payment, VCC charge, link payment, check-in guarantee capture, and later automation. **Siblings:** `capture`, `authorize` (warn early), `registerVirtualCard`/`runDueVirtualCards`, reservations' guarantee step (integration-step). **Concurrency:** both guards read without a lock (AP-36), so a link paid by webhook can race a desk capture. Take `pg_advisory_xact_lock(hashtext(ref‖purpose))` in every path, including link creation and the link-payment webhook. **Attack on the fix:** capture with `ledgerRef` changed to the stay folio (purpose `balance`) while a deposit link is paid. The guard must consider the booking's deposit too, or refuse the capture until collection plans (PAY-R20) exist. |
| **SW-PAY-2** | P2 | `collect.ts:159` (`if (purpose === 'custom') return;`); `contracts.ts:296,320` (purpose is client-chosen) | With a paid deposit link, a desk `chargeNow` with `purpose: 'custom'` succeeds. No reason is asked and **no override audit** is written (PoC `SW-PAY-2`: 2 deposit postings, 0 `ownershipOverride` audits). | The guard can be skipped by a label the client picks, without the reason and audit that P1-2's fix requires for a real exception. | **Principle:** an exception to a money guard always needs a stated reason and an audit, whatever the label. `custom` on a ref that has an open or paid request (any purpose) requires `separateCollection.reason`. **Attack on the fix:** `custom` on a folio when the deposit link sits on the booking. Treat a booking and its stays' folios as one ref family. |
| **SW-PAY-3** | **P1** | `collect.ts:96-110` (`loadActiveMethod`: no property or owner check), used by `authorize` :274 and `charge` :669; contrast `accounts.ts:468-501` (`getMethod`/`listMethods` hide methods by `method.property_id`); migration `0001_payments.sql:63` ("permission scope") | **AP-01 on the card record.** A card saved at property B (sister resort, same legal entity) cannot be **read** by a desk user scoped to A (`getMethod` → not found). The same user **charges it USD 2,500** onto an A folio, and it succeeds (PoC `SW-PAY-3`). P0-1's fix checks the ledger target and the account's legal entity, but not the method. | A property-scoped user moves money from a card the system says they cannot see. Overlaps integration-step P1-2 (check-in holds any card through delegation). This is the **direct payments route**, which exists on main today. | **Principle:** a record the actor cannot read at the acting property cannot be a parameter of a command there: methods, authorizations, requests, VCCs, accounts. **Fix:** `loadActiveMethod(tx, methodId, property)` requires `method.property_id === property.id`, or `payments.payment.collect` at the method's property, plus the owner binding from integration-step P1-2 (the method's owner is the booker, an occupant or the payer of the ref). **Siblings:** `authorize`, `charge`, `incrementAuthorization` (inherits the hold), `recordAuthorization`, VCC. **Attack on the fix:** a group guest whose card was saved at A, now staying at B. This needs an explicit, audited cross-property use, never an implicit one. |
| **SW-PAY-4** | **P1** | `contracts.ts:156` (`entryChannel … .default('hosted_entry')`, client-supplied); `accounts.ts:439`; `collect.ts:80` (30 min), `:117-123` (`deriveInitiator`) | **The P1-8 fix trusts a field the client declares.** "Who initiates is a fact, not a claim" was implemented as `entry_channel ∈ {hosted_entry, terminal}` and `created_at` within 30 min. `entry_channel` comes from the create request and **defaults to `hosted_entry`**. Staff with `payments.method.manage` save a token with no mandate and no `entryChannel`, then charge it **twice for USD 900 each** as customer-initiated (PoC `SW-PAY-4`). | Scheme-rule non-compliance (merchant-initiated charges without an agreement) and lost disputes: the original P1-8 harm, reopened. The window also allows unlimited charges, for any amount, by anyone, at any property (combined with SW-PAY-3). | **Principle:** "customer present" comes only from evidence the server verified for **this** transaction: a guest actor, or a hosted-entry/terminal session result bound to this payment and amount. Never from a stored field the client set. **Fix:** set `entry_channel` server-side from the provider (setup or hosted-entry result id); default unknown to `import` (merchant). Consume the customer-present allowance once, for the first charge only, bound to that session's amount. **Siblings:** `authorize` (same `deriveInitiator`), import and vault creation paths. **Load-bearing (AP-54):** the P1-8 fix depends on `entry_channel` and `created_at`, so both are re-rated to P1 here. |
| **SW-GUE-1** | **P1** | `packages/db/src/idempotency.ts:44-77` (stores `response_body`); `guests/src/routes.ts:67-86` `idem()` on every create or change (:107 profiles, :174 contacts, :214, :250, :279, :294, :310…); `guests/test/privacy.test.ts:314-329` (`tenantDump` scans guests.*, `core.outbox`, `core.audit_log`, **not** `core.idempotency_keys`); `privacy.ts:79` claims "personal data does not sit in … idempotency records" | **G-P0-1 residual (AP-17/AP-15).** Create a profile over HTTP (name, DOB, email), then erase it: the request reports `completed`. `core.idempotency_keys` row `POST /guests/profiles` still holds the name and DOB. Replaying the same key returns **201 `Idempotent-Replayed: true` with the erased name and DOB** (PoC `SW-GUE-1`). | The hotel tells a data subject they were erased while their data remains, retrievable through the API for up to 30 days. GUE-I06 ("no personal data remains in ANY table") is proven only for the tables the test scans. | **Principle:** erasure reaches every store that holds the guest's data, or that store must not hold personal data: module tables, outbox, audit, **idempotency responses**, export artefacts, other modules' copies. **Fix:** guests routes store a minimal replay body (ids and status) and rebuild the view on replay, so a replay after erasure answers 404/410. Alternatively, tag idempotency rows with subject refs and redact them on erasure. Add `core.idempotency_keys` (and any `core` jsonb store) to `tenantDump`. **Siblings:** every guests `idem()` route; other modules' idempotent responses that embed guest names (reservations booker, finance payer name, payments `payer.name`); integration inbound payloads (integration F18, tracked). **Attack on the fix:** replay the original key after erasure. It must not return the person's data. |
| **SW-BO-1** | P2 | `apps/backoffice/e2e/smoke.spec.ts:27-60` (`page.goto` at :47 and :55); `src/app/session-guard.ts` (no unit test) | **AP-55: the P0-1 regression test cannot fail.** Every step after the revocation uses `page.goto`, a full document load that discards the in-memory React Query cache whatever the fix. The leak in P0-1 needed in-app navigation (no reload). Removing `guardSessionChanges` and the `userId` key segment would still pass this test. | The P0 fix (`session-guard.ts`, `queries.ts:15`) is correct by code reading, but nothing would catch a regression. | Drive the second half in-app: let a 401 occur while on `/settings/users`, sign in, then click to Users with no `goto`. Assert no `/v1/users` row renders and the account label is correct. Add a unit test: after an identity change, `queryClient.getQueryCache().getAll()` is empty. |
| **SW-RAT-1** | P2 | `rates/src/contracts.ts:206` (`nature … .default('statutory')`); `domain/tax-engine.ts:219` (pinning only for `commercial`) | **R-01 boundary (principle versus flag).** R-01's principle is that anything the hotel sets (service charge, resort fee) is part of the agreement. The fix is a per-rule flag that **defaults to statutory**. Only the MV pack's MV-SC sets it. A resort fee a hotel adds through `/tax-rules` without `nature` is recomputed at posting, so agreed stays are re-priced. | R-01 (P0) recurs for every hotel-added fee. | Make `nature` required (no default) for tenant-created rules, or default it to `commercial`; statutory only for verified jurisdiction packs. **Attack on the fix:** a hotel clones the MV pack's TGST as a "local tax" to change its rate. That must stay statutory only with a source citation (rule 13). |
| **SW-FIN-1** | P2 | `finance/src/service/billing-rules.ts:491-493` (`keyOf = source | destinationFolioId | selector`); `postings.ts:138-153` (`capUsage` lineage) | **F-04 boundary (code-read).** Usage carries over only when source, destination folio and selector are all unchanged. A company agreement edited to also cover minibar (selector change), or re-pointed to a re-opened company folio, becomes a *new* rule with usage 0. The per-stay cap restarts, and the company can be billed past it, which was the original F-04 harm. | The limit belongs to the agreement (owner + payer + period), not to a rule row. | Carry `supersedes_rule_id` whenever the replaced rule has the same owner, source and payer, whatever the selector or folio, or key usage by a stable `rule_key`. Show the carried usage in the preview. **Attack on the fix:** two rules split from one capped rule must share, not double, the remaining cap. |
| SW-INV-1 | P3 | `inventory/src/service/consumption.ts:586-602` | Release locks only the cells it read before locking (`session.has` filter). A concurrent `changeConsumption` that **adds** nights commits first, and its new rows survive the cancellation as orphan consumption. This is under-sale, not oversell; the INV-10 consistency job does not flag it, because `sold` equals Σ consumption. | Silent capacity loss. | After locking, re-read the ref's full row set, extend the session (or retry) when new cells appear, and add a "consumption for a cancelled ref" check to INV-10. |
| SW-INT-1 | P3 | `integration/src/net/address-policy.ts` (`ipv6Blocked`) | `::ffff:0:a.b.c.d` (RFC 2765 IPv4-translated, `::ffff:0:0:0/96`) is not decoded: `::ffff:0:7f00:1` is "public". IP literals are refused, so only a DNS answer could carry it, and Linux does not route it to loopback. Defence in depth only. | — | Decode and check ::ffff:0:0:0/96 like the mapped and compatible forms, or deny it outright. |

## Re-attack of the original findings (inverted: each must be refused on main)

Evidence key: **T** = builder regression test, read for its asserting line and green in this run; **P** = probe run in
this sweep; **C** = code path read on main.

| Module | Finding | Original attack on main | Evidence | Fix holds? |
|---|---|---|---|---|
| payments | P0-1 foreign folio / entity | refused (`ledger_target_other_property`, `wrong_merchant_of_record`, `ledger_target_unknown`) for charge, capture, recordPayment, request, VCC | T `review-regressions` "P0-1"; real finance: T `finance/test/payments-ledger-port` "refuses targets of another property…" | **yes for folios**. Booking: known residual (integration-step P1-1). Card: **SW-PAY-3** |
| payments | P0-2 claimable `acct_` | refused: typed id rejected (`accounts.ts:88`); operator-only link; global directory unique (`0001:634`); ambiguous route → ignored (`webhooks.ts:85`); tenant cannot set Stripe status (`:252`) or fee (operator only) | T "P0-2"; C | yes |
| payments | P0-3 lost webhook | redelivery reprocesses when `processed_at` is null; backstop job | T "P0-3" ×2; C `webhooks.ts:160-260` (concurrent redeliveries may both process; every effect is unique-keyed, so the second fails and is retried) | yes |
| payments | P1-1 concurrent charges | partial unique index `payments_one_inflight_per_ref`; 3 genuinely concurrent tx → 1 | T "P1-1" | yes |
| payments | P1-2 link + desk | desk charge refused | T "P1-2"; **P SW-PAY-1/2** | **sibling bypass** |
| payments | P1-3 duplicate approval code | DB unique index + audited override | T "P1-3" (concurrent) | yes |
| payments | P1-4 refund vs adjustment | `adjusted_minor` in ceiling; lock-first in `recordRefund`/`adjustRecordedPayment` | T "P1-4"; C | yes |
| payments | P1-7 bank transfer posted at record | `awaiting_receipt`; sensitive `payments.bankTransfer.confirm` | T "P1-5/6/7/9" | yes |
| payments | P1-8 MIT self-declared | `initiator` no longer accepted | T `authorizations` "P1-8"; **P SW-PAY-4** | **replacement fact is client-declared** |
| payments | P1-11 env change | `environment_changed` at execution (`operations.ts:359`) and for links (`requests.ts:229-241`) | T "P1-11" | yes |
| payments | P1-5/6/9 finance side | `LedgerScope` required; `markPaymentVerified`; fees as expense | T finance `payments-ledger-port` | yes (LedgerPort still a stub on main: tracked) |
| finance | F-01 over-correction | lock folio, then measure (`postings.ts:1549`); reverse locks first (`:1805`); transfer measures after lock (`:1310-1380`) | T "F-01" ×3 (concurrent) | yes |
| finance | F-02 double credit note | folio lock before `creditedTotal` (`fiscal.ts:744,758`) | T "F-02" (concurrent) | yes |
| finance | F-04 cap reset | lineage usage | T "F-04"; C | yes; boundary **SW-FIN-1** |
| finance | F-05 tax on invoices | effective kind and rate carried on every hop | T "F-05" ×3 | yes |
| finance | F-09 imported deposit taxed twice | — | suite green; assertion not inspected | not re-probed |
| finance | F-11 first deposit property | payments passes the property and entity | T `payments-ledger-port` "records deposits…" | yes (ownership: known residual) |
| inventory | INV-01 expired hold double-subtract | lock, then re-read `status='active'` (`consumption.ts:586-602`) | T "INV-01" | yes |
| inventory | INV-02 concurrent release | same; delete/update returning | T "INV-02" (concurrent) | yes; P3 **SW-INV-1** |
| inventory | INV-03 availability authority | `guardAvailabilityWrite` on every ledger, hold, overbooking and assignment write; `origin` only from service callers, never routes | C (`consumption.ts:107,589,759,892`; `holds.ts:176,258,441,470`; `assignments.ts:92,374`; `overbooking.ts:83`) | yes |
| inventory | INV-05 hold → two bookings | branch on status under lock (`holds.ts:267-306`) | T "INV-05" | yes |
| rates | R-01 fee re-priced | agreed versions only (`tax-engine.ts:219`); new commercial rule skipped | T "posts hotel-set fees at the AGREED version…" | yes for `commercial`; **SW-RAT-1** |
| rates | R-04 client-declared channel/date/company | channel bound to principal; backdate needs staff + `rates.quote.backdate`; company staff-only (`quote.ts:91-120,443-452`) | T "who is asking decides what they see" | yes |
| rates | R-05 unkeyed hash; reprice re-seals | HMAC seal (`terms-seal.ts:15`); `/terms/penalty` verifies | C | yes. Sibling pure functions: known residual (integration-step P2-3) |
| rates | R-06/R-07 boundaries | per-offer isolation; percent bounds (`contracts.ts:24,28`) | T "robust pricing" | yes |
| rates | R-08 split deposits | fixed tax points; Green Tax once | T "splits a line…" | yes |
| operations | P0-1 stale no-op absorbs foreign changes | version check before no-op (`sync.ts:444-476`); unit ops require `baseVersion` (`contracts.ts:881-926`, `metaFor`) | T "P0-1 offline sync never applies a stale change…" | yes |
| operations | P0-2 ungated `/sync/mutations` | `authorizeMutation` before any read (`sync.ts:198`); response filtered by read permission (`:148-170`); replay bound to actor (`:335`) | T "P0-2 … never leaks records" | yes |
| operations | P1-1 late `unit.blocked` | block mirror by id | T "P1-1 / P1-12 / ADR-0015" | yes |
| operations | P1-2 out-of-order stay events | `aggregateVersion` + monotonic status | T "P1-2 stay projection is order-tolerant" | yes |
| operations | P1-12 release via inventory | inventory still releases directly; operations flags `releasedExternallyAt` + blocking issue | C (`inventory/src/service/blocks.ts:384-400`: no owner check) | **detection only**: inventory-side refusal tracked in `pending-fixes.md` |
| reservations | R-01 channel taxes dropped | delegated to `rates.termsFromChannelPrices` (`channel.ts:101-116`), a stub on main → 503, no booking with empty taxes | T "R-01" (fake rates); C | yes on main (fails closed); rates provider tracked |
| reservations | R-04 stale preview | policy in fingerprint | T "R-04" | yes |
| reservations | R-05/R-06 channel order and states | | T "R-05", "R-06" ×2 | yes |
| reservations | R-07/R-08 authority | `guardAuthority` on every write; `markNoShow` `assertWritable` | T "data authority on every write" | yes |
| reservations | R-09 keys inside tx | after commit | T "R-09" | yes |
| reservations | R-14 provider permission delegation | providers are stubs on main | — | not applicable on main (integration-step) |
| integration | F1 SSRF | literal and DNS checks, pinned socket (`address-policy.ts`, `safe-fetch.ts:72-79`) | T `address-policy.test.ts`; C | yes; P3 **SW-INT-1** |
| integration | F2 blind replay race | | T "PROBE-5" | yes |
| integration | F3 effect class fails open | undeclared → `money`/`inventory`; a hint can only be stricter (`outbound-policy.ts:63-71`, `exchange.ts:1949`) | T `registry.test.ts`; C | yes |
| integration | F4 disconnect → cancelled | uncertain kept + exception | T "PROBE-6" | yes |
| integration | F5 concurrent ordering | guarded upsert (`exchange.ts:464`) | T "PROBE-2", "PROBE-7" (concurrent) | yes |
| integration | F6 applied ≠ applied | inbound handler port in same tx | T "inbound handler port (F6)" | yes |
| integration | F8 simulator authority in live | simulators refused in live outright | T "(F8)" | yes (reverse order through a trial conversion: n/a, trials are separate orgs on identity-plus) |
| guests | G-P0-1 erasure leftovers | guests.* + outbox + audit clean | T "GUE-I06"; **P SW-GUE-1** | **residual in idempotency store** |
| guests | G-P0-2 resolution ignores sharing | visible-only reuse (`profiles.ts:259-299`) | T "GUE-I05: resolution at B never reuses…", "with sharing fully permitted…" | yes |
| guests | G-P1-1 B edits A's items | item scope via `requirePreferenceAccess`, alert visibility | T "staff at B can neither see nor change…" | yes (siblings `reviseNote`, `readSpecialNeed`, `addNote` checked by code read: clean) |
| guests | G-P1-2 links leak | | T "links, known-at … do not leak" | yes |
| guests | G-P1-3 export decrypts B's documents | per-property `can()` (`privacy.ts:167,194`) | T "a property-scoped requester gets only…" | yes |
| backoffice | P0-1 cache leak | guard clears cache on identity change; keys include `userId` | C; T e2e (cannot fail) | yes; **SW-BO-1** |
| backoffice | P1-2 uncertain outcomes | write failures → "Not confirmed — pending verification"; retry offered only with an idempotency key; client timeout; gateway 5xx on write = unknown | C `errors.ts:72-106`, `client.ts:60-150`, `intent.ts` | yes (the key lives per page or dialog; extend-stay is also protected server-side by its preview token) |

## Exemption audit (focus c)

| Exemption left by a fix | Where | Attacked? | Result |
|---|---|---|---|
| "first deposit: finance binds the booking" | `payments/src/service/shared.ts:149`; `finance/src/service/ledger-port.ts:315-325` | not re-reported | **known residual**, integration-step P1-1, tracked in STATUS (integration-step fix round) |
| `purpose === 'custom'` skips ownership | `collect.ts:159` | yes | **SW-PAY-2** |
| capture/authorize not covered by the ownership guard | `collect.ts:253,441` | yes | **SW-PAY-1** |
| customer-present window (30 min, `entry_channel`) | `collect.ts:117-123` | yes | **SW-PAY-4** |
| `describeTarget` → `null` accepted for bookings in the main stub | `apps/api/src/composition.ts:155-165` | read | same as the first row (tracked) |
| `delegated(tx, perms, undefined)` = all properties | `finance/src/service/support.ts:48-68`, `index.ts:526` | not re-reported | **known residual** (integration-step P2-2; `pending-fixes.md` foundation line) |
| rates pure functions without seal check | `rates` `evaluateCancellationPenalty`, `instantiatePaymentSchedule` | not re-reported | **known residual** (integration-step P2-3). The HTTP `/terms/penalty` does verify |
| `origin.connectionId === authority.connectionId` passes the availability guard | `inventory/src/service/context.ts:100` | yes | clean: `origin` is reachable only from service callers, never routes |
| `base !== null` skips the version check | `operations/src/service/sync.ts:448,479` | yes | clean: the contract requires `baseVersion` on unit ops and `task.transition`; `metaFor` refuses without one |
| sync duplicate replay | `sync.ts:335` | yes | clean: bound to actor and request hash |
| Stripe status: tenant may set `disabled` | `payments/src/service/accounts.ts:252` | yes | clean: cannot re-enable; only the provider activates |
| simulator/dev seal key when `NODE_ENV ≠ production` | `rates/src/seal-key.ts:13` | read | same gate as `packages/kernel/src/crypto.ts:104` (the accepted AP-19 pattern); infra must set `PORTICO_TERMS_SEAL_KEY` (tracked) |
| inventory releases an operations-owned block | `inventory/src/service/blocks.ts:384` | read | tracked in `pending-fixes.md` (operations detects and flags) |
| integration effect hint | `exchange.ts:1949` `stricterEffect` | read | clean (can only tighten) |

## Coverage declaration

### Checklist (1–15)

| # | Item | Status |
|---|---|---|
| 1 | Tenant isolation | code-read only; every module's isolation suite green; not re-enumerated per table |
| 2 | Authorization | probed: finding SW-PAY-3; operations sync and guests item scope clean |
| 3 | Money and finance principles | probed: findings SW-PAY-1/2/4, SW-FIN-1, SW-RAT-1 |
| 4 | Idempotency and concurrency | probed: finding SW-GUE-1 (replay after erasure); finance/inventory/payments lock-first clean; SW-INV-1 |
| 5 | Events and audit | code-read: payments webhook dedupe and backstop, operations/integration ordering clean; SW-PAY-2 (missing override audit) |
| 6 | Contracts | not probed (integration-step owns port binding) |
| 7 | Data authority and environment safety | code-read: inventory INV-03, reservations R-07/R-08, integration F8, payments P1-11 clean |
| 8 | Errors and UX contract | code-read: backoffice P1-2 clean |
| 9 | Spec coverage | not applicable (sweep of fixes) |
| 10 | Scenario claims | code-read: reservations scenarios run against stubs on main (AP-51) |
| 11 | Honest readiness | probed: guests `privacy.ts:79` claim contradicted (SW-GUE-1) |
| 12 | Code quality | code-read only; lint and typecheck green |
| 13 | One-product experience | not applicable |
| 14 | Parity gate | not applicable (no parity file for a sweep) |
| 15 | Cross-module coherence | see notes below |

### Patterns

| ID | Status |
|---|---|
| AP-01 | probed: **SW-PAY-3** (card record); folios clean; booking = known residual |
| AP-02 | code-read only (module isolation suites green) |
| AP-03 | probed (code + T): clean (payments account directory) |
| AP-04 | probed: **SW-PAY-4**, **SW-PAY-2**; rates R-04 clean |
| AP-05 | code-read: operations `/sync/mutations` clean; catalogue test green; full route enumeration not re-run |
| AP-06 | probed: `apps/api/test/permission-catalog.test.ts` green |
| AP-07 | not applicable (identity not in this sweep) |
| AP-08 | probed: payments P1-2 reversed (desk first → link refused: clean); P0-2 (an org cannot pre-claim `acct_`: clean); F8 via trial conversion: not applicable |
| AP-09 | not probed (identity). Note: `payments.method.manage` currently implies "may make charges customer-initiated" (SW-PAY-4) |
| AP-10 | not applicable (no separation-of-duties flow among the swept fixes) |
| AP-11 | not applicable (identity) |
| AP-12 | not applicable |
| AP-13 | not applicable |
| AP-14 | code-read: clean; **SW-INT-1** (P3) |
| AP-15 | probed: **SW-GUE-1**; operations sync replay is actor-bound: clean |
| AP-16 | code-read: fix holds; **SW-BO-1** (test cannot fail) |
| AP-17 | probed: **SW-GUE-1** |
| AP-18 | code-read: guests sharing paths clean (T green) |
| AP-19 | code-read: payments P1-11 and integration F8 clean; seal-key gate same as kernel |
| AP-20 | code-read + T: finance, payments and inventory clean |
| AP-21 | code-read: suites green |
| AP-22 | probed (code): **SW-RAT-1**; reservations R-04 clean |
| AP-23 | code-read: rates R-06/R-07 clean |
| AP-24 | not re-probed (rates R-08 and finance F-05 tests green) |
| AP-25 | code-read: **SW-FIN-1** |
| AP-26 | code-read: backoffice P1-2, integration F4 and payments P1-7 clean |
| AP-27 | not re-probed (payments P1-9 test green) |
| AP-28 | probed: **SW-PAY-1**, **SW-PAY-2** |
| AP-29 | not probed (deadlines and time zones are outside the money/isolation focus; budget) |
| AP-30 | code-read: payments P0-3 clean |
| AP-31 | code-read + T: operations P1-1/P1-2 and integration F5 clean |
| AP-32 | code-read + T: reservations R-06 clean |
| AP-33 | probed (code): operations P0-1 clean (no `baseVersion`-less unit op is accepted) |
| AP-34 | code-read + T: integration F2 clean |
| AP-35 | code-read: integration F3 clean; omitted finance scope = known residual |
| AP-36 | code-read: finance, inventory and payments refunds/captures clean; payments ownership guards unlocked (inside SW-PAY-1) |
| AP-37 | code-read + T: reservations R-09 clean |
| AP-38 | code-read: inventory INV-03 and reservations R-07/R-08 clean |
| AP-39 | not probed (budget) |
| AP-40 | not probed (integration-step owns the port contracts) |
| AP-41 | code-read: payments fake ledger enforces scope (`harness.ts:87-110`); real finance test exists: clean |
| AP-42 | not probed (tracked: `pending-fixes.md` RC-2) |
| AP-43 | not probed |
| AP-44 | not probed (finance F-03 test green) |
| AP-45 | applied to every fix: **SW-PAY-1**, **SW-PAY-3**, SW-GUE-1 |
| AP-46 | not probed (budget) |
| AP-47 | code-read: sync mutation-id reuse cannot grief (actor-bound): clean |
| AP-48 | not probed |
| AP-50 | probed: guests `privacy.ts:79` claim (SW-GUE-1) |
| AP-51 | code-read: reservations scenarios on main use fakes for rates, finance and payments |
| AP-52 | partial: exit codes read, typecheck `--force`; no canaries planted |
| AP-53 | probed: **SW-PAY-3** (direct route); check-in variant = known (integration-step P1-2) |
| AP-54 | applied: **SW-PAY-4** (the P1-8 fix relies on `entry_channel`), SW-GUE-1 (the GUE-I06 test defines what "erased" means) |
| AP-55 | probed: **SW-BO-1** |
| AP-56 | not applicable (no one-time security transition among the swept fixes) |
| UX-15 / UX-11 / UX-05 | code-read for backoffice P0-1 and P1-2 (other UX traps out of scope by run parameters) |

**Patterns:** 55 listed. 6 not applicable, 49 applicable: 38 probed or code-read, 11 not probed (reasons above).

## Known residuals confirmed tracked (not re-reported)

- Payments/finance booking-deposit ownership: integration-step P1-1. `STATUS.md` 17:31 resume item 1 (integration-step fix
  round P1-1…P1-3). The exemption is still on main at `payments/src/service/shared.ts:149` and in the composition stub
  (`composition.ts:155-165`).
- Finance optional all-property scope: integration-step P2-2, plus the `pending-fixes.md` foundation line ("move a
  PROPERTY-SCOPED provider-delegation helper … finance's version widened to all properties").
- Rates seal not verified on sibling functions: integration-step P2-3 (adapter). The pure functions on main still take
  unverified documents. The only HTTP entry (`/terms/penalty`) verifies.
- Operations P1-12 inventory-side refusal: `pending-fixes.md` ("inventory: blocks created by another module … cannot be
  released directly").

## Not reached (budget)

- Reservations attacks against **real** providers: they exist only on `feat/integration-step`, which is not merged and was
  not swept. Reservations R-14 is not applicable on main.
- Finance F-09 assertion not inspected. AP-24, AP-27, AP-29, AP-39, AP-40…AP-44, AP-46 and AP-48 not run.
- SW-FIN-1 and SW-INV-1 are code-read only; no PoC was run.
- Concurrent duplicate webhook delivery (payments P0-3) reasoned from code only.
- P2-class originals (integration F12, F18; guests G-P2-*) not re-run.

## Cross-module notes for the orchestrator

1. **Payments fix round (owner: payments, P1).** SW-PAY-1/3/4 plus SW-PAY-2. SW-PAY-3 and integration-step P1-2 share one
   fix: card scope and owner binding inside payments, so every caller (desk route, check-in delegation, automation)
   inherits it. Proposed `pending-fixes.md` line: *payments: method use is scoped like method reads (property + owner);
   initiator from server-verified evidence only; purpose ownership enforced in capture/authorize/VCC under a
   per-(ref, purpose) lock; `custom` needs a reason.*
2. **Guests and foundation (owner: guests + db, P1).** Erasure versus `core.idempotency_keys`. Decide platform-wide: either
   idempotent responses hold no personal data (ids only, rebuilt on replay), or erasure redacts them. Every module that
   embeds guest names in idempotent responses inherits the decision. Proposed line: *foundation: idempotency
   stores carry a subject ref or a minimal body; GUE-I06 scans every `core` jsonb store.*
3. **Backoffice (P2).** Rewrite the P0-1 e2e test without `page.goto` after the 401, and add a unit test for
   `guardSessionChanges`.
4. **Rates (P2).** `nature` required for tenant-created rules.
5. **Finance (P2).** Cap lineage across selector and folio edits.
6. **Process observation for the quality steward.** Three of the four P1s are the "fix moved the trust to a new field"
   shape (P1-8 → `entryChannel`) or the "fix guarded the named path only" shape (P1-2 → capture; P0-1 → folio but not
   card). Both are already in the pattern library as AP-04/AP-54 and AP-45. The builders' regression tests encode the
   reviewer's exact attack, so sibling paths stay untested. Suggest that self-check v3 require one test per **sibling
   entry point** named in the fix.
