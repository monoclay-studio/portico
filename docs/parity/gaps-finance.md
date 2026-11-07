# Gaps: finance cluster — spec change requests and opportunities

Cluster: `finance`, `payments`, `day-close`, `accounting`, `fnb-pos`, `procurement`, `stock`, `analytics`
(matrices in this folder). Every `missing` P0/P1 row is listed below as a **spec change request**: what to add, to
which spec section, citing the parity IDs it closes. Where an earlier change-request register already covers a gap
(`docs/journey/spec-change-requests.md` SCR-nn, `docs/backofhouse/spec-change-requests.md` CR-nn), it is referenced
instead of repeated. Evidence for each row is in the module matrix.

Note for the steward: `tools/parity-report.mjs` treats every `.md` here except README/COVERAGE as a module, so this
file appears as an empty "gaps-finance" row in `COVERAGE.md`; it holds no PAR/EC rows on purpose. `COVERAGE.md` was
not committed on this branch (regenerate after merging all parity branches).

## Status at a glance (2026-11-07)

| Module | Capabilities | Edge cases | P0 / P1 / P2 (capabilities) | Missing P0+P1 (capabilities / edge cases) | Evidence of build |
|---|---|---|---|---|---|
| finance | 270 | 84 | 117 / 111 / 42 | 61 / 25 | `feat/finance-core` @ 232be3a (under review) |
| payments | 74 | 54 | 46 / 20 / 8 | 8 / 6 | `feat/payments-core` @ a219850 (under review) |
| day-close | 64 | 35 | 34 / 23 / 7 | 6 / 6 | business-date advance only (`main`) |
| accounting | 89 | 37 | 45 / 33 / 11 | 2 / 4 | none |
| fnb-pos | 82 | 38 | 40 / 26 / 16 | 5 / 4 | none |
| procurement | 41 | 26 | 24 / 13 / 4 | 0 / 1 | none |
| stock | 34 | 25 | 19 / 11 / 4 | 0 / 3 | none |
| analytics | 49 | 30 | 21 / 24 / 4 | 5 / 3 | none |

The back-of-house specs (accounting, fnb-pos, procurement, stock) are thorough: almost every market capability is
already `specified`. The large gap is in **finance**, where OPERA's cashiering, receivables and commission depth is
only partly in the spec.

## Deviations between implementation branches and specs (decide at merge)

1. **Billing-rule overlap (FIN-R14 vs `feat/finance-core`).** The spec rejects every overlap (Q40 default); the branch
   resolves *strictly nested* rules by specificity (more specific wins) and rejects ties/partial overlaps
   (`modules/finance/src/domain/routing.test.ts`). Either amend FIN-R14/FIN-I13 to "no ranking; strictly nested rules
   resolve by specificity" (finance README says the orchestrator asked for this) or flip the branch switch. Parity:
   PAR-FIN-106, PAR-FIN-107. Counsel review under Q40 still applies.
2. **Branch features not in the spec** (add to `finance.md` so the matrix can cite them): Green Tax monthly report
   (PAR-FIN-297), credit-note `cancel` that re-opens postings for a corrected invoice (PAR-FIN-203), hash-chained
   fiscal ledger (PAR-FIN-220), mandatory tax-invoice particulars (PAR-FIN-221), invoice-issue deadline exception
   (PAR-FIN-222, SCR-24), MMA ±2% reference-rate check (PAR-FIN-223), retention dates and legal holds (PAR-FIN-224),
   TGST on deposits at receipt (PAR-FIN-133; Q41/Q42).
3. **Silent FX fallback.** The branch picks the latest earlier rate when today's rate is missing
   (`modules/finance/src/domain/domain.test.ts`); EC-FIN-019 expects a block or a visible stale-rate warning. Add to
   FIN-R40: "a rate older than the business date is used only per policy with a visible `stale_rate` warning; never
   a default".
4. **Two payments matrices.** `modules/payments/PARITY.md` (branch draft) is superseded by `docs/parity/payments.md`,
   which carries every draft row (ID map inside). Delete the draft at merge.
5. **Period close moved.** The branch did not build FIN-R43 because GL period close now belongs to `accounting`
   (CR-04/05). Update FIN-R43 to point at ACC-R28 and keep only the guest-ledger cut-off in finance.
6. **Not yet built on the branches but P0 in the specs:** write-off (FIN-R30), retroactive rule re-application
   (FIN-R16), effective-dated revenue mapping (FIN-R12), commissions (FIN-R31), collection plans (PAY-R20–R22),
   hosted card entry (PAY-R06). They stay `specified` in the matrices.

## Spec change requests

### finance.md

- **§3.2 Folios** — add *external (passer-by) folios* for non-staying customers with a business-date close
  (PAR-FIN-025, P0); *interim bills* that settle and invoice part of an open stay, which also serve long stays
  (PAR-FIN-151, P0; EC-FIN-062; SCR-28); *pro-forma folio* clearly labelled "not a tax invoice" (PAR-FIN-033);
  *folio presentation styles* (detailed by date, summary per code, package arrangement, group summary) (PAR-FIN-031).
- **§3.2 Postings** — add *articles* (retail items with UPC/barcode) (PAR-FIN-043); *batch charges* to many folios
  with preview (PAR-FIN-044); *scheduled fixed charges* posted by Day Close with key `fixed:{id}:{date}`
  (PAR-FIN-045, PAR-DCL-043); *pre-stay charging* window (PAR-FIN-046); *transitory charges* collected for third
  parties outside revenue (aligns with the concessions agent model, Q104) (PAR-FIN-049); *post the full stay
  up-front* for prepaid stays (PAR-FIN-051); edit non-financial fields with audit (PAR-FIN-075).
- **§3.2 Corrections** — add *in-place split* of a charge by amount, % or quantity, and *split/move payments*
  (PAR-FIN-064, PAR-FIN-065, PAR-FIN-068); *service-recovery* reason class reported separately (PAR-FIN-071);
  *reverse a direct-bill settlement* while its receivables invoice is unpaid (PAR-FIN-073); rule "an adjustment can
  never exceed the remaining correctable amount" (EC-FIN-012, P0).
- **§3.3 Charge codes** — add *subgroup level* and *revenue buckets* for reporting independent of accounts
  (PAR-FIN-080, PAR-FIN-083); *chain templates* copied to properties with labelled local overrides (PAR-FIN-090);
  *cash rounding factor* per currency for cash tenders only, difference to a rounding code (PAR-FIN-085,
  EC-FIN-047); *tax exemptions per guest/company* with certificate reference and an exempt-revenue report
  (PAR-FIN-086, PAR-FIN-298, EC-FIN-064).
- **§3.4 Billing rules** — add *comp routing* with authorizer (PAR-FIN-110); resolve deviation 1.
- **§3.6 Settlement** — add *checkout preview* per payer and document (PAR-FIN-161); *automatic folio settlement*
  rules (PAR-FIN-156, PAR-PAY-078); *credit limit per card type* auto-charge with posting stop on failure
  (PAR-FIN-157, PAR-PAY-041; relates to SCR-23); *batch folios and delivery* by email/SFTP (PAR-FIN-158,
  PAR-FIN-159; SCR-24); *advance folio payment* for cash guests gating key validity (PAR-FIN-163); *express checkout
  before the desk opens* for early seaplanes (EC-FIN-066, P0); *weather-forced extra night* policy (charge,
  discounted, or complimentary with reason linked to the disruption) (EC-FIN-065, P0; EC-DCL-020).
- **§3.6 Deposits** — reverse a deposit application when check-in is reversed (EC-FIN-025); cross-entity booking
  move flow (EC-FIN-026); Day Close check for arrivals with deposit balance (PAR-FIN-141, PAR-DCL-025).
- **§3.7 Receivables** — add *account types* with aging/reminder cycles (PAR-FIN-171); *direct-bill review queue*
  with accruals on the trial balance (PAR-FIN-174); *unapply / re-apply / reverse / transfer receivables payments*
  with history (PAR-FIN-178, P0; EC-FIN-032, EC-FIN-033); *bulk allocation* of one bank transfer to many invoices with
  reference auto-match and bank-fee handling under a threshold (EC-FIN-035, EC-FIN-031, both P0); *charges on AR
  invoices* and *transfer between invoices/accounts* (PAR-FIN-184, PAR-FIN-187); *consolidated (compressed)
  invoices* (PAR-FIN-186, EC-FIN-072); *notes and follow-ups*, *year view*, *changes log* (PAR-FIN-189,
  PAR-FIN-190); *card receivables* consolidation (PAR-FIN-192); *one account across properties* of a legal entity
  (PAR-FIN-195); short payments flagged as possible commission deductions (EC-FIN-034).
- **§3.8 Fiscal documents** — add *reissue* (credit + corrected invoice in one previewed action, already on the
  branch) (PAR-FIN-203, EC-FIN-039); *advance invoice* (PAR-FIN-206); *folio/document types per country*
  (PAR-FIN-209); *templates* with logo, QR, language and copy legend (PAR-FIN-212); numbering-audit report
  (PAR-FIN-302).
- **§3.9 Cashier sessions** — add *cashier PIN re-authentication* on shared desks (PAR-FIN-230); *shift drops* with
  bag numbers and locations (PAR-FIN-234); *float carry-over* and *negative banking* policy (PAR-FIN-235,
  EC-FIN-045); *drawer deposits/withdrawals* (PAR-FIN-244); *bank/safe deposit record* linking sessions to the deposit
  slip (PAR-FIN-246; CR-08); pending-verification items at close (EC-FIN-042); *change in another currency* as a
  linked exchange (EC-FIN-018, P0).
- **§3.10 Multi-currency** — stale-rate rule (deviation 3, EC-FIN-019, P0) and *rate correction workflow* listing
  affected postings (EC-FIN-020); residual write-off threshold (EC-FIN-060, P0).
- **FIN-R31 Commissions** — expand into a sub-section (SCR-27, CR-07): prepaid commission on net deposits
  (PAR-FIN-263, EC-FIN-059); holds with reasons (PAR-FIN-266); payment runs and activity handed to `accounting`
  ACC-R16 (PAR-FIN-267, PAR-FIN-268); attach/detach agent and adjust with reason (PAR-FIN-269, PAR-FIN-270);
  commission on cancellation revenue flag (EC-FIN-058); OTA commission invoice matching (PAR-FIN-271 → ACC-R17).
- **§3.5 Allowances** — state that allowance periods follow the business date at commit (EC-FIN-049, P0).
- **New §3.12 Stored value** — gift cards/vouchers as liabilities, redemption as a tender (PAR-FIN-280,
  PAR-FIN-281; SCR-26; Q83).
- **§3.11 Reports and exports** — add *posting journal search* (PAR-FIN-294, P0); *month-end details*
  (PAR-FIN-303); *gross/net transaction export API by business day* (PAR-FIN-328, P0); *ledger balances API*
  (PAR-FIN-014); *recalculate unposted future charges after configuration change* with preview (PAR-FIN-011).
- **Day use and DST** — state day-use handling (EC-FIN-061, EC-DCL-033) and the DST scheduling rule (EC-FIN-068,
  EC-DCL-024) in `finance.md` §4 and `day-close.md` §3.

### payments.md

- **§3.2** card expiry/replacement flow by link (PAR-PAY-028).
- **§3.3** *authorization rules* estimating expected spend (PAR-PAY-031); credit-limit overage with finance
  (PAR-PAY-041); checkout above the authorized amount: capture up to the hold plus a new consented charge
  (EC-PAY-013, P0); nightly incremental-authorization decline handling (EC-PAY-012); company card shared across
  bookings (EC-PAY-035).
- **§3.4** supervisor *manual resolve* of a pending payment with evidence (PAR-PAY-054).
- **§3.5** unlinked refund to another method and outbound bank-transfer refunds (PAR-PAY-062, PAR-PAY-063,
  EC-PAY-023).
- **§3.6** per-rate/channel *policy exceptions* (PAR-PAY-076); unknown VCC activation date rule (EC-PAY-010).
- **§3.7** bank transfer *returned after confirmation* (EC-PAY-021, P0).

### day-close.md

- **DCL-R01** add exceptions: arrivals with deposit balance (PAR-DCL-025), scheduled room moves not completed
  (PAR-DCL-026), *arrival with a delayed transfer* is never auto-no-showed (EC-DCL-010, P0), *departure blocked by a
  cancelled transfer* (EC-DCL-020, P0).
- **DCL-R02 step 3** post fixed charges (PAR-DCL-043); per-stay errors do not stop other stays (EC-DCL-015, P0).
- **DCL-R03** record the code version per step; resume across versions relies only on keyed effects (EC-DCL-031).
- **DCL-R05** skip-today and schedule change log (PAR-DCL-083); failure policy for remaining departures
  (PAR-DCL-084); public API trigger (PAR-DCL-014).

### accounting.md

- **ACC-R14/R15** repeating supplier bills (PAR-ACC-028); intermediary bank fees on outbound telegraphic transfers
  (EC-ACC-006, P0); supplier advance applied across currencies (EC-ACC-023).
- **ACC-R06** reversal date when the next period is closed (EC-ACC-010).
- **ACC-R29** a missing period-end rate blocks revaluation (EC-ACC-028).
- **New ACC-R52** non-guest customer invoices (rent, concession and utility recharges) issued as finance receivables
  documents (PAR-ACC-126; coordinate with `concessions.md` and `utilities.md`).

### fnb-pos.md

- **FNB-R02/R04** central menu distribution across outlets/properties with local overrides; menu import/export
  (PAR-POS-011, PAR-POS-012).
- **FNB-R09** reopen/adjust/void closed checks with audit; a room-charged check corrects through finance
  (PAR-POS-054, EC-POS-038).
- **FNB-R14** bar tab secured by a card pre-authorization (PAR-POS-073); email receipts (PAR-POS-081).
- **FNB-R21** offline sold-out conflict handling (EC-POS-027); tax-sector change on check transfer (EC-POS-034);
  in-villa order follows the stay after a room move (EC-POS-036).

### procurement.md and stock.md

- **PRC-R09** emergency purchase path with post-approval (EC-PRC-016).
- **STK-R01/R05** unit-of-measure anomaly warning at receipt (EC-STK-018); weighted-average rule at zero/negative
  on-hand (EC-STK-021); store deletion guard (EC-STK-025).

### analytics.md

- **ANL-R05** package/meal forecast for kitchens (PAR-ANL-025), profile/company/agent production (PAR-ANL-027),
  in-house rate check (PAR-ANL-030).
- **ANL-R07** delivery failures and provisional labelling during Day Close (EC-ANL-010, EC-ANL-011); copy report
  configuration across properties (PAR-ANL-055).
- **New ANL-R11** reports API (PAR-ANL-062); export formatting rules (EC-ANL-014).

## Ten "beat the market" opportunities

1. **Truthful payment states end to end.** Competitors show "paid" for links sent and VCC charges fail silently
   (Mews). Portico already has pending verification and recorded-but-unverified terminal payments on the payments
   branch; finishing collection plans (PAY-R20–R22) makes double-charging impossible by construction.
2. **Day Close without nights of dread.** OPERA re-initialises sessions and halts on exceptions; Mews has no audit and
   pushes over/short pain to finance. A continuous exception queue, keyed resumable steps and transfer-aware
   no-show/departure logic (seaplane delays) is a clear Maldives differentiator.
3. **"Who pays for what" preview and payer-labelled folios.** No incumbent previews routing outcomes; the finance
   branch already proves preview equals posting (S04).
4. **One Green Tax / TGST truth.** OPERA ships a Maldives Green Tax report; Portico can go further: per-person-night
   computation, deposit time of supply, MMA tolerance and the MIRA 501/206 working papers from one ledger.
5. **Receivables built for DMCs.** Bulk allocation of one bank transfer to dozens of agency invoices with reference
   auto-match, short-pay detection (commission deductions, bank fees) and net-rate invoicing — daily pain for
   Maldivian resorts, served generically by OPERA AR.
6. **Offline-honest outlets.** Room charges offline within an exposure limit, lease-based settlement and
   re-validation on sync (FNB-R20–R22) go beyond POS offline modes that cannot check folio eligibility.
7. **Entitlement-aware POS.** All-inclusive and half-board coverage evaluated per line *before sending* (FNB-R17).
8. **Island-aware procurement and stock.** Order-by dates from sailing schedules, shipment legs, landed-cost
   actualization and days of cover for water and fuel (PRC-R07, PRC-R15–R17, STK-R21).
9. **As-closed vs restated everywhere.** Day reports with restatement annexes, analytics as-of views and statements
   with deltas (DCL-R07, ANL-R04, ACC-R34) answer the missing "as-of" reporting at Stayntouch and Mews' editable
   history.
10. **Reconciliation by construction.** Payouts, terminal settlements, cash deposits and bank lines matched by ids with
    every difference owned (PAY-R24/R25, ACC-R23/R24): "reports don't match payouts" is a recurring complaint about
    Mews and Guesty.

## Open questions raised

Q130 (Maldives foreign-exchange rules for tourism businesses), Q131 (offline card and room-charge exposure
liability), Q132 (unclaimed guest credits and expired deposits) — see `docs/OPEN_QUESTIONS.md`.
