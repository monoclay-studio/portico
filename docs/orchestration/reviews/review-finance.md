# Steward review — `feat/finance-core` (module `finance`)

Reviewer: architecture steward (independent) · 2026-11-07 · worktree `/home/user/wt/finance` @ `232be3a`
(merge-base with main `7da7d98`). Experiments ran in a scratch copy:
`/tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/review-finance-copy`. The worktree under
review was not modified.

## Verdict: **do not merge** (yet). It becomes **merge after fixes** once the 2 P0s and the finance-side P1s are fixed.

The ledger core is strong. Balance is enforced per currency and in functional currency by a deferred DB trigger.
Rows are append-only through grants and triggers. Lines cannot be added after the creating transaction.
Idempotency claims a key first and is proven under concurrency. Fiscal numbering is gapless, uses row locks and is
hash-chained. Payouts never touch revenue. There is no authorization concept. Billing rules have no rank or
priority field.

However, corrections and credit notes have **check-then-lock races that over-correct money** (proven). A valid
billing-rule set can **block posting** (proven). Re-applying a rule set **resets limits** (proven). Some tax
invoices **misstate tax** (proven). Two of the three provider contracts do not match their consumers (one does not
compile).

**Counts:** P0 = 2 · P1 = 10 · P2 = 17 · P3 = 12

---

## 1. Command results

| Command (scratch copy, `PORTICO_TEST_DB_PREFIX=review_finance`) | Result |
|---|---|
| `pnpm install --frozen-lockfile` | pass |
| `pnpm lint` (biome + boundaries) | pass. "Checked 153 files… Module boundaries OK (3 modules checked)" |
| `pnpm typecheck` | pass (9/9 tasks) |
| `pnpm --filter @portico/finance test` | **pass**: 15 files / 64 tests, 9.7 s |
| `pnpm --filter @portico/api test` | **pass**: 4 files / 13 tests |
| `git merge-tree main feat/finance-core` | **conflict** in `apps/api/src/composition.ts` (trivial). The branch lacks `b484de3` (teardown fix), `9363f2d` (`pgCode`/`withSavepoint`) and `944ff0f` (tz helpers). |
| `node tools/parity-report.mjs --gate finance` (parity-finance worktree) | **gate fails**: 78 P0 rows not tested, 70 P1 rows missing (expected: merge gate ≠ completion gate). Note: the tool always rewrites `docs/parity/COVERAGE.md`, so that generated file in `/home/user/wt/parity-finance` was regenerated (an active researcher also writes there; content is deterministic). |
| Review experiments: `modules/finance/test/zz-review-experiments.test.ts` (scratch only) | 8 probes, output below |

**Probe output (verbatim, abridged):**
```
X9  nested rules then post BRKF: {"ok":false,"code":"billing_rule_conflict","message":"Billing rules \"Company: breakfast and restaurant\" and \"Agency: all food\" both match this charge but neither is more specific…"}
X7  adjustments fulfilled: 3 · folio balance after 3 concurrent full corrections of a 12870 charge: -25740 · spa revenue: +20000 (debit)
X8  credit notes: [CN-000001 total -12870, CN-000002 total -12870] for invoice total 12870 → folio -12870
X10 company folio (per-stay cap 30000): 51480
X11 company invoice after 2-hop transfer: taxChargedMinor 0, valueBeforeTaxMinor 12870; lines [["value","Massage…"],["value","Service charge 10%…"],["value","TGST 17%…"]]
X12 deposit at 16%, stay at 17%: lines [["value","TGST 17%: rate in force when the deposit was paid…",-1100], …, ["tax","TGST 17%",18700]];
    depositTaxCredits [{"name":"TGST 17%","declaredAtDepositMinor":17600}]; ledger TGST payable 17600 (correct)
X6  20 concurrent retries, same key: fulfilled 20, distinct entries 1, notReplayed 1, rows 1   ✔
X1  balanced per currency, not functional → rejected ✔ · X3b header without lines → rejected ✔
X4  update posting / delete entry → permission denied ✔ · X5d update fiscal document → denied ✔
X2  functional-currency line with functional ≠ amount → ACCEPTED · X3 folio sub-ledger line without posting → ACCEPTED (integrity check flags it)
X5a fiscal_series.next_number + 5 → ACCEPTED · X5b rewrite fiscal_chains.last_hash → ACCEPTED · X5c delete posting_document_locks → ACCEPTED
```

**Type check of the adapters against the consumer ports** (consumer `ports.ts` files copied, `tsc --noEmit`):
`financeLedgerForPayments` → payments `LedgerPort`: **compiles** ✔. `financeForReservations` → reservations
`FinancePort`: **does not compile**:
- `postCharge`: `target: EntityRef` is not assignable to `{type:'stay'|'booking'|'group'}`.
- `TaxLine` is missing `ruleId` and `accountKey`.
- `listFolios`: `payer.type: string` is not assignable to `'profile'|'company'|'agency'|'house'`.

---

## 2. Findings (ranked)

### P0: money correctness

**F-01 · P0 · Concurrent corrections over-correct a charge (proven, X7)**
- **Where:** `modules/finance/src/service/postings.ts:1423-1446`. `remainingOf` and the allowed amount are computed
  before `claimEntry` (`:1459`) and before the folio lock (`:1473`).
- **Same pattern:** `reverseEntry`'s `touched` check (`:1677`) runs before `lockFolios` (`:1715`). An adjust racing
  a reverse, or an adjust racing a transfer, over-corrects too.
- **Problem:** two or three adjustments of the same charge with different idempotency keys each see the full
  remainder, then serialize on the folio lock and each post a full correction. In X7 a 128.70 charge was corrected
  three times: folio −257.40 and spa revenue +200.00 (debit).
- **Why it matters:**
  - Revenue goes negative and money is refunded that was never owed.
  - "Retries must never duplicate…" (CLAUDE.md §5) is met only for the same key.
  - Two staff members, a double-click that mints a new key, or two tabs are realistic triggers.
- **Fix:**
  - Lock the posting's folio (`lockFolios`) before computing `remaining`, and recompute after the lock.
  - Do the same in `reverseEntry`: lock, then check `touched`.
  - Add a genuinely concurrent test with three adjustments under different keys.

**F-02 · P0 · Concurrent credit notes credit one invoice twice (proven, X8)**
- **Where:** `service/fiscal.ts:700` (`creditedTotal`, no lock) → `:743` (`adjustPosting` per charge) → `:756`
  (`allocateAndInsert` takes the chain/series locks but does not re-check credit).
- **Problem:**
  - Two "adjust" credit notes on the same invoice both pass the "not fully credited" check. Both adjust every
    charge and both are numbered (CN-000001 and CN-000002, each −128.70), so the invoice is 200% credited.
  - A `cancel` racing an `adjust` is also possible.
- **Why it matters:** these are fiscal documents and ledger corrections, and both are wrong.
- **Fix:**
  - At the start of `issueCreditNote`, lock the invoice's folio (or take a per-invoice advisory lock).
  - Re-evaluate `creditedTotal` after the lock.
  - F-01's fix also closes the inner adjustment race.
  - Add a concurrent test.

### P1: contract or architecture violation, missing MUST, false claim

**F-03 · P1 · A rule set accepted at save blocks posting (proven, X9)**
- **Where:** `service/postings.ts:344` builds `groupOf` that knows only the posted code. `matchingChain`
  (`domain/routing.ts:247-269`) re-checks nesting with it.
- **Problem:**
  - A = codes `[BRKF, FOOD]` and B = group `food` are strictly nested, and `createBillingRule` accepts them.
  - At posting, `isSubset(A,B)` needs the group of `FOOD` (not the posted code), gets `undefined`, and returns
    false.
  - The chain check then throws `billing_rule_conflict` ("the charge was not posted").
  - Every breakfast or dinner for that stay fails, including Day Close postings.
- **Fix:**
  - Pass the full property `chargeGroupMap` to routing in `postCharge`, as `previewRouting` does.
  - Add an integration test with multi-code versus group rules.

**F-04 · P1 · Replacing a rule set resets limits and wipes manual rules (proven, X10)**
- **Where:** `service/billing-rules.ts:412-470` (`replaceBillingRules`, called by reservations `setBillingRules`);
  `capUsage` (`service/postings.ts:134-143`) is keyed by `billing_rule_id`.
- **Problem:**
  - Re-applying the same company default after a stay change creates new rule ids, so per-stay and per-night
    usage restarts at 0. The company paid 514.80 against a 300.00 per-stay cap.
  - Replace also deactivates every active rule on the owner, including staff-created `manual` rules.
- **Why it matters:** the wrong payer is billed above an agreed limit, and staff configuration disappears silently.
- **Fix:**
  - Make replace scoped to `source` (replace only rules of the sources given), or diff-and-keep unchanged rules.
  - Carry usage to successors: store `supersedes_rule_id` and have `capUsage` sum over the lineage, or key usage
    by a stable `rule_key`.
  - Add tests.

**F-05 · P1 · Tax invoices misstate tax charged in two common or real flows (proven, X11 and X12)**
- **Where:** `service/fiscal.ts:380-392` (`toItems` resolves the effective kind one hop only);
  `service/deposits.ts:521-545` (the rate-difference credit is a plain `adjustment`, named with the *current* rule
  name).
- **Problem:**
  - (a) A charge moved guest → companion → company (two transfers) is invoiced with TGST and service charge as
    "value before tax", so `taxChargedMinor` is 0. Green Tax would land inside the GST base the same way.
  - (b) A deposit taxed at 16% and applied after a rate rise to 17%:
    - the invoice shows TGST 17% = 187.00 and books the 11.00 difference as negative *value*;
    - `depositTaxCredits` labels the 16% declaration "TGST 17%".
  - The ledger is right (TGST payable 176.00); the legal document is not.
- **Fix:**
  - Store the effective kind, tax kind, rate and rule id on every transfer, adjustment or correction posting.
    Copy them from the root posting (`taxKind`, `taxRate`, `taxRuleId` are not copied today; `postings.ts:1270-1280`).
    Categorize from those stored values, not by joining one hop.
  - Mark the deposit rate-difference posting as `tax_kind='tax'` with the deposit-era rule version and rate, so
    the tax summary shows 16% on the prepaid part and 17% on the rest.
  - Name credits by the declared rule.
  - Add tests for both cases.

**F-06 · P1 · S19 allowance or package modeling makes the tax invoice double-count value; breakage is untaxed (false scenario claim on the invoice)**
- **Where:** `service/allowances.ts:56-240` (the grant posts an untaxed `charge` of group `allowance`);
  `domain/invoice.ts:36-62` (allowance usage is a "settlement"); `test/scenario-s19…:139-150` asserts the result.
- **Problem:**
  - The S19 invoice shows value-before-tax 1,047.00, which includes the 200.00 dining credit *and* the 132.00
    food plus service charge that the credit paid for.
  - The invoice total is 1,238.99 while the guest bought and paid 1,087.51.
  - The credit carries no TGST, while consumption is taxed. Breakage of 48.52 becomes untaxed revenue.
  - FIN-R18 (allocate the package price to components) is not modelled: the room and the allowance are posted
    independently.
  - Rates quotes TGST on the package price, so the billed TGST differs from the agreed terms.
- **Why it matters:**
  - The Maldives tax invoice must show value before tax and tax charged truthfully.
  - Time of supply for a prepaid allowance is a tax question that is not recorded anywhere.
- **Fix:**
  - Write an ADR. Either the allowance is a taxed package component (consumption is then an internal draw-down,
    shown as zero-value lines) or it is a non-supply prepayment (excluded from value before tax).
  - Add "TGST on allowance breakage" to Q20.
  - Change S19 to assert the chosen presentation.

**F-07 · P1 · `financeForReservations` does not implement the reservations `FinancePort` (README claims it does), and runtime semantics break**
- **Where:** `service/index.ts:326-444` vs `/home/user/wt/reservations/modules/reservations/src/ports.ts:335-401`;
  `test/reservations-port.test.ts` uses inputs reservations never sends (`payer.name`, code `ROOM`).
- **Problem:** a compile failure (§1), plus:
  - reservations posts `NO_SHOW`, `EARLY_DEPARTURE` and `CANCEL_FEE`, but finance seeds only `CXL`, so the
    charge code is unknown;
  - reservations posts booking-level fees to `{type:'booking'}`, but it opens only stay folios, so finance
    raises `no_default_folio`;
  - reservations never sends payer names, so folios are named "Incidentals" or "Accommodation" and **tax invoice
    buyer = "Accommodation"** (live particulars only check non-empty);
  - `chargeCodeGroups` is cast to `ChargeGroup[]` without validation (`index.ts:421`), so a typo silently routes
    everything to the default folio.
- **Fix:**
  - Accept `EntityRef` and narrow it with an error; return the declared `PayerRef` types; map `TaxLine`
    explicitly or reject `provided` until the shapes are agreed.
  - Agree a charge-code vocabulary (seed `NO_SHOW`, `EARLY_DEPARTURE`, `CANCEL_FEE`, or have reservations use
    finance's codes) and auto-open a booking folio for booking-level fees, or require a stay target.
  - Resolve payer names through a guests port, and block live invoices whose buyer is a placeholder.
  - Validate groups.
  - Rewrite the port test with reservations' real inputs.

**F-08 · P1 · `TaxPort` does not match rates' `computeTaxes`, and the semantic mapping is dangerous (cross-reference: rates review R-03 and R-08)**
- **Where:** `src/ports.ts:43-91` vs `/home/user/wt/rates/modules/rates/src/contracts.ts:263-403`.
- **Problem:** besides field names (`taxGroup`/`taxCategory`, `priceMode`/`taxInclusion.mode`,
  `stayContext{stayId}`/`{stayNights}`, decimal quantity where rates requires int ≥ 1):
  - **(1) Kind is inverted.** In rates' MV pack, service charge is `category:'fee'` and Green Tax is
    `category:'tax'`. Finance treats `kind:'fee'` as a levy outside the GST base. A naive adapter would put
    service charge outside the GST base and Green Tax inside the tax total.
  - **(2) Account keys don't match.** Rates' `ledgerMappingKey` is `tax.tgst` / `tax.green_tax` /
    `fee.service_charge`. Finance's `taxAccountKey` turns these into `tax:tax_tgst` etc., auto-creating new
    liability accounts. The seeded 2200/2210/2220 accounts stay unused, and `greenTaxReport` (keyed
    `tax:green_tax`) returns nothing.
  - **(3)** Rates has no `getRulePackStatus` provider.
  - **(4) Time of supply is modelled twice.** Finance declares TGST on a `chargeGroup:'deposit'` line and
    releases or credits it at application. Rates expects `taxPointSplits` on the charge line. Using both
    double-handles deposits.
- **Fix:**
  - The orchestrator picks rates' `ChargeLine`/`TaxLine` as canonical.
  - Write a finance-side adapter that maps `basis ∈ per_person_*` → levy, rule nature/code → service charge, and
    normalizes `ledgerMappingKey` → system key.
  - Choose **one** time-of-supply mechanism and record it in an ADR.
  - Add a contract test against `computeTaxesPure` with the MV template.

**F-09 · P1 · Opening deposits are imported without the tax already declared by the previous system: migrated deposits are taxed twice**
- **Where:** `service/deposits.ts:905-1075`. Imported accounts have an empty `declared_tax`, so `applyDeposits`
  releases nothing (`:436-461`) while the stay's charges carry full TGST.
- **Why it matters:**
  - The previous PMS declared TGST at receipt; Portico declares it again. That is double TGST on every migrated
    prepaid booking (S18 / E12, Maldives).
- **Fix:**
  - Add `taxDeclared: [{accountKey, amountMinor, ruleVersion?}]` per import row, posted against
    `deposit_tax_declared` and migration suspense.
  - Or require an explicit `taxDeclaredInPreviousSystem` flag and raise an exception when it is unknown.
  - Extend the S18 test.

**F-10 · P1 · Missing MUST not listed: FIN-R32 receipts (incl. deposit receipts at the time of supply)**
- **Where:** `fiscal_documents.kind in ('invoice','credit_note')` (migration `:520`); the README R32–R34 row and
  "Known gaps" are silent.
- **Problem:**
  - MIRA requires a tax invoice *or receipt* within 3 days of the time of supply.
  - For deposits, the time of supply is the payment, and nothing is issued.
  - The parity row PAR-FIN-132 ("deposit payment with deposit receipt") is marked `tested`.
- **Fix:** add a `receipt` kind (its own series and chain) issued for deposits and payments, or list it as a gap
  and correct the parity rows.

**F-11 · P1 · Folio postings depend on the payments fix for the first deposit; finance should not need it**
- **Where:** `service/deposits.ts:56-79` (`resolveDepositProperty`), `service/index.ts:218-232`.
- **Problem:**
  - Payments' `LedgerPort.recordDeposit` has no `propertyId`.
  - Finance falls back to a booking-owned folio, but reservations never opens one (it opens only stay folios).
  - Every first deposit from payments is therefore refused (`property_required`), in the most common Maldives
    flow (prepayment).
- **Fix:**
  - Short term: the payments one-liner already in `pending-fixes.md`.
  - Better: finance resolves booking → property through a reservations or platform port, or the deposit account
    is opened by reservations at booking.
  - Track this as a cross-module merge blocker.

**F-12 · P1 · The parity matrix over-claims `tested` for capabilities the branch lacks (parity-finance worktree)**
- **Over-claims:**
  - PAR-FIN-066: transfer *with before/after preview* (README: preview not built).
  - PAR-FIN-310: permissions incl. write-off and period close (they don't exist).
  - PAR-FIN-295: restatement register (not built).
  - PAR-FIN-120: package revenue allocation (S19 doesn't allocate a package price; F-06).
  - PAR-FIN-132 / PAR-FIN-133: deposit receipt and deposit invoice (F-10).
  - PAR-FIN-107: rules rejected (nested are allowed; F-03).
  - PAR-FIN-109: "who pays" preview from agreed terms (preview needs caller-supplied gross; P2-13).
  - PAR-FIN-313: exceptions incl. pending verification (missing; P2-07).
- **Fix:** downgrade these to `building` or `specified` with reasons before the parity branch merges.

### P2: missing tests, UX or error quality, maintainability, partial MUSTs

- **P2-01 · FIN-I10 is not guaranteed.**
  - Finance reads the business date without a lock (`postings.ts:279`, `:765`, `:933`…). A Day Close committing
    D+1 mid-command leaves a posting stamped D after D closed.
  - Fix: a platform port `lockBusinessDate` (`select … for share`) taken at the start of every posting command.
- **P2-02 · FX settlement models the gain or loss as a functional-only line with transaction amount 0 in the
  functional currency** (`payouts.ts:230-238`).
  - The functional-currency position in `fx_position` never closes (it keeps USD and MVR residues).
  - Line-currency reports disagree with the trial balance.
  - Fix: close the foreign position at its *carried* functional value, and post the gain or loss as a normal USD
    line (the standard four-to-five-line bridge).
- **P2-03 · Cash session race.**
  - `openSessionFor` (`tender.ts:124-160`) reads the session without `FOR SHARE`, while
    `closeCashierSession` locks `FOR UPDATE`.
  - Cash recorded concurrently with a close lands in a closed session after "expected" was frozen.
- **P2-04 · Minor units shown to staff.**
  - Error messages, record issues, exception messages and the plain-language rule description say
    "30000 USD (minor units)".
  - `formatMoney` already exists in `@portico/kernel` (`packages/kernel/src/money.ts:177`), so
    FOUNDATION_REQUESTS #2 is moot.
- **P2-05 · Provided tax lines from any non-user actor are trusted unchecked** (`postings.ts:157-190`).
  - `ruleVersionId` is not verified against rates.
  - An arbitrary `accountKey` auto-creates a `tax:*` ledger account (`support.ts accountId` →
    `derivedAccountTemplate`).
  - Fix: restrict to declared integration actors, validate the version, and refuse unknown keys.
- **P2-06 · Unverified (Route D) payments never become verified in finance.**
  - The folio issue `payments_awaiting_verification` never clears.
  - Settlement is not blocked.
  - The Day Close item is missing (FIN-R44).
  - LedgerPort has no verification-result call. Add one, or read status from payments through a port.
- **P2-07 · FIN-R44 Day Close items missing:** pending-verification payments, over-limit transfers awaiting
  approval, invoices blocked from issuance, and breakage pending.
- **P2-08 · Authorization scope.**
  - `transferPostings` checks the permission on the *from* property only (`postings.ts:1150`); the *to* folio
    may be in another property of the same legal entity the user cannot access.
  - `applyDeposits` doesn't check the deposit's property.
- **P2-09 · Forfeiting a deposit to revenue needs only `finance.posting.create`** (route
  `/finance/bookings/:bookingId/deposits/forfeit`). It turns a liability into revenue and should need a sensitive
  permission, or be derived from agreed terms.
- **P2-10 · FX rates.**
  - There is no correction path: append-only plus a unique key per date and source. A mistyped 154.2 instead of
    15.42 converts all day.
  - There is no plausibility check.
  - With two operational sources on one date, the choice is nondeterministic (`domain/fx.ts:30-40`).
- **P2-11 · The adjusting credit note can credit only `kind='charge'` postings** (`fiscal.ts:730`). Transferred-in
  charges on a company invoice cannot be credited, and "credit everything" silently omits them.
- **P2-12 · TGST payable is recognized at nightly posting, not at the tax point** (the earlier of invoice or
  payment, per `maldives-tax-rules.md` §1). The monthly TGST picture by business date is not the MIRA return
  basis. Needs an ADR and the Q20 adviser.
- **P2-13 · FIN-R15 preview is partial.**
  - It routes caller-supplied gross amounts; S04 "preview equals posting" holds only because the test feeds the
    exact gross.
  - There is no projection from agreed terms, and allowances and conversion are ignored.
- **P2-14 · Tests.**
  - Tenant isolation is proven only for folios and search (not fiscal documents, receivables accounts, deposits,
    billing rules or journal entries).
  - There are no concurrent tests for corrections, credit notes, refunds or cash close (F-01, F-02, P2-03).
  - The reservations-port test does not use reservations' real inputs (F-07).
- **P2-15 · Spec-consumed events missing:**
  - `reservations.booking.cancelled` (deposit outcome tasks);
  - `guests.profile.merged|unmerged` (payer refs: invoices keep stale payer ids, with no re-point report).
- **P2-16 · Proration math uses JS numbers, not Decimal** (`deposits.ts releaseShare :352`,
  `postings.ts :1452 usageBack`, `:546` tax units). This contradicts CLAUDE.md §5 and loses precision above 2^53
  (VND/IDR).
- **P2-17 · Branch hygiene.**
  - It is behind main (conflict in `composition.ts`).
  - Remove the local teardown workaround (`test/helpers.ts:105-115`; fixed on main `b484de3`).
  - Replace `isUniqueViolation` with main's `pgCode`.
  - The domain-map "Contract changes" are not yet folded into `docs/architecture/domain-map.md`.

### P3: nits and defense in depth

- **P3-01 · DB hardening.** The app role can:
  - jump `fiscal_series.next_number` (gap; X5a);
  - rewrite `fiscal_chains.last_hash` (X5b);
  - delete `posting_document_locks` (X5c, unlocks invoiced postings).
  Fix: add triggers (`new.next_number = old.next_number + 1` only together with a document insert; lock rows
  deletable only by a credit-note path, or record lock and release as append-only events).
- **P3-02 · The balance trigger does not enforce `functional_amount = amount` when `currency = functional_currency`**
  (X2), nor a posting for every folio sub-ledger line (X3; only the aggregate integrity check catches it).
- **P3-03 · Integrity controls sum `amount_minor` across currencies** (`reports.ts:449-457`). Group by currency.
- **P3-04 · PDF formatting assumes 2 decimals** (`fiscal.ts:868`). Use the kernel currency exponent.
- **P3-05 · Payments `recordDeposit` returns `postingId` = journal entry id** (`index.ts:231`). Name it, or
  document it in the port.
- **P3-06 · A booking refund larger than the held balance is posted entirely to the last applied folio**
  (`index.ts:261-275`) instead of being split.
- **P3-07 · Allowance usage credits land on the first allocation** (often the company folio) when a charge is split
  by rules (`postings.ts:577-603`).
- **P3-08 · `importOpeningDeposits` is idempotent on `importRef` without a content hash** (`deposits.ts:916`): a
  corrected re-upload under the same ref silently returns the old report.
- **P3-09 · The HTTP business key `http:${Idempotency-Key}` is not scoped per route.** A client reusing a key on
  another endpoint gets an idempotency conflict.
- **P3-10 · Error code drift for "module not connected":** `module_unavailable` (finance, integration) vs
  `module_not_available` (reservations). Put one in the kernel.
- **P3-11 · `markOwnerDeparted` / `clearOwnerDeparture` have no permission check and no audit**
  (`folios.ts:459-492`). They are provider-only today; add audit and keep them unrouted.
- **P3-12 · Unit price uses `Math.round(amount/quantity)`, and folio status `voided` is mapped to `settled` for
  reservations.**

---

## 3. Focus areas (as requested)

### (a) Ledger

| Check | Result |
|---|---|
| Balanced per currency **and** in functional currency, in the DB | ✔ deferred constraint triggers `entry_balanced`, `line_balanced` (`0001_finance.sql:280-355`); X1 rejected |
| ≥ 2 lines; every posting mirrored by a guest-ledger line | ✔ (X3b rejected) |
| Lines or postings only in the creating transaction | ✔ txid triggers (existing test) |
| Append-only (grants + trigger, owner included) | ✔ X4; `core.make_append_only` |
| Reversal at most once | ✔ unique `journal_entries_reversal_once` |
| Duplicate posting under concurrent same-key retries | ✔ X6: 20 concurrent → 1 row (claim-first `on conflict do nothing`) |
| Over-correction under concurrent *different-key* corrections | ✘ F-01 / F-02 |
| Gaps | functional ≠ amount for functional lines accepted (P3-02); FX gain/loss line shape (P2-02) |

### (b) Fiscal documents

| Check | Result |
|---|---|
| Gapless numbering | ✔ chain and series `FOR UPDATE` in the issuing tx (author's 24-request concurrent test) |
| Hash chain | ✔ `verifyChain` |
| Credit notes reference originals; immutability | ✔ |
| Double credit under concurrency | ✘ F-02 |
| DB cannot prevent number skips or chain-head rewrite | P3-01 |
| Receipts | missing (F-10) |

### (c) Deposits and taxes

| Check | Result |
|---|---|
| Deposits are a liability | ✔ |
| TGST declared at receipt via the tax engine; refund releases it; forfeit keeps it due | ✔ |
| No double taxation in the ledger after application | ✔ (X12 TGST payable 176.00 = 16% of 1,100) |
| Invoice tax figures | wrong after a rate change (F-05b) |
| Migrated deposits | double-taxed (F-09) |
| Green Tax outside the GST base, service charge inside | ✔ in invoice composition *with the fake engine*; at risk with rates' categories (F-08) and multi-hop transfers (F-05a) |
| MMA ±2% | ✔ exact-date MMA plus operational rate, deviation stored; requires a direct `X→USD` pair (an inverse-only entry fails, with a clear message) |

### (d) Billing rules

| Check | Result |
|---|---|
| No rank or priority field anywhere (schema, contracts, UI text) | ✔ (patent caution respected; README documents the specificity deviation from the FIN-R14 default for Q40) |
| Tie and partial-overlap detection at save, under an advisory owner lock | ✔ (concurrent saves serialized) |
| Determinism | no wrong winner possible, but valid sets can block posting (F-03) |
| Limits: per night / per stay / percent; overflow → default folio; capped rules `FOR UPDATE` | ✔ (concurrent test exists) |
| Limits after a rule-set replace | reset (F-04) |
| Preview accuracy | caller-dependent (P2-13) |

### (e) Payouts, authorizations, FX

| Check | Result |
|---|---|
| Payout = Dr bank or payout clearing, Dr fees, Cr card clearing; never revenue | ✔ |
| Authorizations | no concept in finance ✔ |
| FX bridging through `fx_position` keeps each currency balanced | ✔ |
| Realized gain or loss | computed, but modelled with a zero-amount functional line (P2-02); revaluation not built (listed) |

### (f) Provider ↔ port compatibility

**`financeLedgerForPayments` vs payments `LedgerPort`** (`/home/user/wt/payments/modules/payments/src/ports.ts`):

| Method | Input shape | Output | Types | Runtime semantics |
|---|---|---|---|---|
| `recordPayment` | identical (`folioId, amount, paymentRef, method∈6, idempotencyKey, verification`) | `{postingId}` | ✔ | ✔ cash without a session → posted and flagged; no `provider` passed → generic `card_clearing` (consistent with payouts); `verification` stored but never updated (P2-06) |
| `recordDeposit` | payments has no `propertyId`; finance accepts optional | `{postingId}` = **journal entry id** | ✔ | ✘ first deposit refused `property_required` unless a booking folio exists, and reservations opens none (F-11); TGST declared on receipt (choice vs rates' taxPointSplits, F-08) |
| `recordRefund` | identical (`folioId\|null, bookingId\|null`) | `{postingId}` | ✔ | ✔ held → deposit refund (releases tax); else refund on the last applied folio; partial held + applied not split (P3-06); over-refund check races (pre-lock) |
| `recordPayout` | identical | `{journalEntryId}` | ✔ | ✔ never revenue; business date = UTC date (listed gap) |
| `recordPaymentAdjustment` | identical | `{postingId}` | ✔ | ✔ signed; the booking path re-uses deposit or refund (deposit path computes TGST on the adjustment) |
| `recordDisputeMovement` | identical | `{journalEntryId}` | ✔ | ✔ card clearing ↔ disputed funds; bill untouched; emits `finance.dispute.recorded` (not in README/events list) |
| Delegation | `finance.folio.read`, `finance.posting.create`, `finance.ledger.manage` (property scope 'all') | | | acceptable; note `ledger.manage` is ⚑ |

**`financeForReservations` vs reservations `FinancePort`** (`/home/user/wt/reservations/modules/reservations/src/ports.ts`):

| Method | Types | Runtime semantics |
|---|---|---|
| `openFolio` | ✔ | ✘ no payer name → folio and invoice buyer named "Incidentals" / "Accommodation" (F-07); `profile` → `guest` ✔ |
| `postCharge` | ✘ `target: EntityRef` vs narrowed union; `taxLines` shape (`code`/`kind` vs `ruleId`/`accountKey`/kind incl. `service_charge`) | ✘ codes `NO_SHOW`, `EARLY_DEPARTURE`, `CANCEL_FEE` unknown to finance; `{type:'booking'}` targets → `no_default_folio`; NO_SHOW `serviceDate = arrival` < business date is fine for system actors |
| `recordDeposit` → `void` | ✔ | same property issue as payments (F-11) |
| `applyDeposits` → `{applied}\|undefined` | ✔ | ✔ applies **all** booking deposits to the first stay that checks in (FIN-R23 "by stay share" not done by the caller); key derived from movement count (safe) |
| `getFolioBalance` | ✔ | ✔ (`status` string) |
| `listFolios` | ✘ `payer.type: string` | `voided`/`closed` → `'settled'` |
| `setBillingRules` → `{ruleIds}` | ✔ | ✘ resets limits and wipes manual rules (F-04); groups unchecked (F-07) |
| `getDepositBalance` | ✔ | ✔ |
| `stay.checkedOut` consumer | n/a | ✔ reads `payload.stayId`, `event.propertyId`, `payload.businessDate` (matches reservations' payload) |

**`TaxPort` vs rates `computeTaxesDetailed`**: see F-08. It mismatches in every field family. Rates has no
`getRulePackStatus`.

---

## 4. Checklist summary

| # | Area | Status |
|---|---|---|
| 1 | Tenant isolation | ✔ every table `tenant_id` + `core.enable_tenant_isolation` (24/24); no cross-module FKs; tests cover folios and search only (P2-14) |
| 2 | Authorization | ✔ `requirePermission` on every service entry; 23 permissions in the manifest, sensitive ones flagged; refusal tests exist. Gaps: P2-08, P2-09, P3-11 |
| 3 | Money principles | integer minor units ✔; immutability ✔; deposit = liability ✔; payout ≠ revenue ✔; authorization ≠ payment ✔. ✘ F-01, F-02, F-05, F-06, F-09, P2-16 |
| 4 | Idempotency and concurrency | all money routes go through `runIdempotent`; business keys unique ✔; ETag/If-Match on folios, rules and accounts ✔. ✘ check-then-lock races (F-01, F-02, P2-03, refund) |
| 5 | Events and audit | ✔ domain-map names; postings audited against the folio; consumer idempotent (upsert). Missing consumers: P2-15 |
| 6 | Contracts | ✘ F-07, F-08, F-11; README "Contract changes" documented ✔ |
| 7 | Data authority and environment safety | ✔ `assertWritable('charges')` on writes; forward refused honestly; no external effects in finance (collection is a DB-only port) |
| 8 | Errors and UX | messages explain problem and recovery ✔; minor units shown (P2-04); status families separate ✔ |
| 9 | Spec coverage | see §5 |
| 10 | Scenario claims | see §6 |
| 11 | Honest readiness | R3 only, external R1 ✔. Over-claims: "implements reservations' FinancePort" (F-07); parity rows (F-12) |
| 12 | Code quality | no `any`, no default exports ✔; pure domain separated ✔; the only `new Date` in domain is a deterministic weekday parse ✔; no TODOs; JS-number proration (P2-16) |
| 13 | One-product experience | ✔ `recordTypes`, `allowedActions` with reasons, `issues`, links; `financeSearch` permission-aware with `summarize`; no secrets in audit |
| 14 | Parity gate | fails (expected for completion); over-claims (F-12) |
| 15 | Cross-module coherence | see §7 |

---

## 5. Spec coverage (MUSTs not met or partial)

**Missing**
- **R16** retroactive re-application.
- **R30** write-offs.
- **R43** period close and restatement register (moved to `accounting` per domain map; restatement flags exist).
- **R21** package grouping (data only).
- **R32** receipts (F-10, unlisted).

**Partial**
- **R04:** FIN-I10 race (P2-01).
- **R09:** no "resulting balance" preview.
- **R10:** no threshold approvals; reason codes free text, not a configurable list.
- **R11:** no transfer preview.
- **R12:** no effective-dated mapping or localized names.
- **R14:** nested rules allowed per the orchestrator, with a bug (F-03).
- **R15:** P2-13.
- **R18:** package price not allocated (F-06).
- **R23:** multi-stay allocation left to the caller.
- **R24:** "keep as guest credit" missing.
- **R26:** write-off and leave-open-with-permission missing.
- **R29:** override permission instead of an approval flow; no dunning.
- **R35:** fiscal adapter metadata check missing.
- **R37:** floats are memo amounts.
- **R39:** policy `finance.cashier.closeBeforeDayClose` not read.
- **R40:** no buy/sell spread.
- **R41:** no revaluation.
- **R42:** deposits and receivables ledger drill-down partial.
- **R44:** P2-07.

The README lists most of these honestly. The exceptions are R32 receipts, R44's missing items, and the R18
package-allocation semantics.

## 6. Scenario-claim assessment

| Scenario | Verdict |
|---|---|
| **S04** | Credible for routing, limit, invoice per payer and direct bill. "Preview equals posting" is true only for caller-supplied gross (P2-13). |
| **S09** | Credible (sequential replay plus 3 concurrent duplicates; X6 confirms with 20). |
| **S10** | Credible (reopen, supplementary-if-invoiced, post-departure flag, collection request, exception, staff reason). |
| **S18** | Ledger and reconciliation credible. The difference is reported in total, not "by booking". Imported deposits lose the declared tax (F-09). |
| **S19** | The ledger, tax accounts, Green Tax report and trial balance reconcile to the cent. **The invoice assertion encodes double-counted value** (F-06). The test uses the fake engine's semantics (F-08). |
| **API e2e** | Credible (Idempotency-Key replay, ETag, 503 when the tax engine is not connected, live gate, isolation). |

## 7. Cross-module notes for the orchestrator

1. **Merge order impact.**
   - `financeForReservations` will not compile at binding (F-07).
   - `TaxPort` cannot be bound to rates without an adapter and a decision on time of supply (F-08; rates
     R-03/R-08).
   - Payments' deposit binding needs `propertyId` (F-11; already in `pending-fixes.md`).
2. **One time-of-supply design.** Finance (declare on a deposit line plus release) and rates (`taxPointSplits`)
   both model the deposit tax point. Decide in an ADR; F-05b and F-09 depend on it.
3. **Charge-code vocabulary.** Reservations uses `NO_SHOW`, `EARLY_DEPARTURE` and `CANCEL_FEE`; finance seeds
   `CXL`. Put a canonical list in the domain map, seeded by finance.
4. **Payer names.** Reservations' `PayerRef` has no name; finance needs one for folios and tax invoices. Add a
   guests port to finance, or add `name` to `PayerRef`.
5. **Verification lifecycle.** Payments verifies Route D payments, but finance has no way to learn the outcome
   (P2-06).
6. **Shared code.**
   - Use main's `pgCode`/`withSavepoint`, not local `isUniqueViolation` (finance and rates both define one).
   - Add an `advisoryXactLock(tx, key)` helper (used in finance, rates, inventory, reservations, identity-plus).
   - Use kernel `formatMoney` in problem messages (all modules).
   - Standardize the "module not connected" error code (P3-10).
   - Use main's tz helpers (`944ff0f`) for business-date/UTC needs (payout and dispute business date).
7. **Back-of-house CRs (proposed, not in force).**
   - CR-02 `postJournal` and control-account ownership fit the existing `writeEntryBody` and `system_key` design.
     Prepare `accounts.control_owner`.
   - CR-04 `accounting_date` should be added before the journal is consumed by `accounting`.
   - CR-10 device fiscal series conflicts with the single per-legal-entity hash chain; decide before fnb-pos.

## 8. Top fixes before merge (in order)

1. **F-01 / F-02:** lock before checking in adjust, reverse and credit note, with concurrent tests.
2. **F-03:** full `groupOf` at posting.
3. **F-04:** replace scoped to source, with limit-usage lineage.
4. **F-05:** carry tax kind, rate and rule on derived postings; deposit rate-difference as tax.
5. **F-07:** fix the reservations adapter types and codes, booking folio, payer names; correct the README claim.
6. **F-09 / F-10:** carry declared tax on import; receipts, or list them as a gap.
7. **F-06 / F-08:** ADR on allowance taxation and the tax-port mapping, before S19 is called demonstrated.
8. **Rebase on main:** drop the teardown workaround and adopt `pgCode`.
