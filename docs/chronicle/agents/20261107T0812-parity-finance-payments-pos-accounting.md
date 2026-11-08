# Agent run: Parity: finance, payments, POS, accounting

- Started: 2026-11-07T08:12:22.021Z · last activity: 2026-11-07T11:42:41.944Z
- Turns: 125 · tool uses: 247 · output tokens: 233,253
- Type: general-purpose

## Brief (2026-11-07T08:12:22.021Z)

````text
You are a Portico competitive-parity researcher. Read and follow /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/parity-brief.md exactly.
Worktree: /home/user/wt/parity-finance (branch docs/parity-finance). Cluster name: "finance". OPEN_QUESTIONS range: Q130–Q139.
Your modules (one parity file each): finance (folios, routing/billing rules, postings, deposits, AR/city ledger, invoices & credit notes, cashiering, FX, commissions), payments, day-close (night audit / end of day), accounting (GL, AP, bank reconciliation, assets, budgets, statements — spec being written at /home/user/wt/backofhouse/docs/specs/accounting.md), fnb-pos (outlet POS, kitchen, room charge — spec at /home/user/wt/backofhouse/docs/specs/fnb-pos.md), procurement and stock (specs at /home/user/wt/backofhouse/docs/specs/), analytics (reports, KPIs, BI). Primary baselines: OPERA Cloud Cashiering, Accounts Receivable, End of Day, Commissions, Reports user guides; Apaleo finance/accounting API; Mews payments & accounting; Oracle Simphony / Lightspeed / Toast for POS; Xero/QuickBooks/NetSuite for accounting expectations; Agilysys and Infor for resort finance.
````

## Follow-up message (2026-11-07T08:12:22.021Z)

````text
You are a Portico competitive-parity researcher. Read and follow /tmp/claude-0/-home-user/4f98af2a-3564-5e4b-aedc-2d94c911507d/scratchpad/parity-brief.md exactly.
Worktree: /home/user/wt/parity-finance (branch docs/parity-finance). Cluster name: "finance". OPEN_QUESTIONS range: Q130–Q139.
Your modules (one parity file each): finance (folios, routing/billing rules, postings, deposits, AR/city ledger, invoices & credit notes, cashiering, FX, commissions), payments, day-close (night audit / end of day), accounting (GL, AP, bank reconciliation, assets, budgets, statements — spec being written at /home/user/wt/backofhouse/docs/specs/accounting.md), fnb-pos (outlet POS, kitchen, room charge — spec at /home/user/wt/backofhouse/docs/specs/fnb-pos.md), procurement and stock (specs at /home/user/wt/backofhouse/docs/specs/), analytics (reports, KPIs, BI). Primary baselines: OPERA Cloud Cashiering, Accounts Receivable, End of Day, Commissions, Reports user guides; Apaleo finance/accounting API; Mews payments & accounting; Oracle Simphony / Lightspeed / Toast for POS; Xero/QuickBooks/NetSuite for accounting expectations; Agilysys and Infor for resort finance.
````

## Follow-up message (2026-11-07T11:23:30.502Z)

````text
The coordinator sent a message while you were working:
Orchestrator: the usage limit has reset. Continue exactly where you stopped (you were about to write the finance parity file). Prioritise finance, payments and day-close first (finance and payments are built and under review now — compare against /home/user/wt/finance and /home/user/wt/payments; payments has its own draft at modules/payments/PARITY.md you can reconcile with), then accounting, fnb-pos, procurement, stock, analytics (their specs are now merged on main in docs/specs/). Commit after each module file; deliver your final report as originally specified.

Address this before completing your current task.
````

## Report (2026-11-07T11:42:41.826Z)

````text
Finance-cluster parity work is finished and committed on branch `docs/parity-finance` (not pushed). I rebased the branch onto current `main` so it has the merged back-of-house specs, and every file passes `node tools/parity-report.mjs`.

| Module | Capabilities | P0/P1/P2 | Edge cases | Missing P0+P1 (cap/edge) |
|---|---|---|---|---|
| finance | 270 | 117/111/42 | 84 | 61/25 |
| payments | 74 | 46/20/8 | 54 | 8/6 |
| day-close | 64 | 34/23/7 | 35 | 6/6 |
| accounting | 89 | 45/33/11 | 37 | 2/4 |
| fnb-pos | 82 | 40/26/16 | 38 | 5/4 |
| procurement | 41 | 24/13/4 | 26 | 0/1 |
| stock | 34 | 19/11/4 | 25 | 0/3 |
| analytics | 49 | 21/24/4 | 30 | 5/3 |

**Built/tested status.** As you asked, finance and payments rows marked `built`/`tested` cite tests on the unmerged branches `feat/finance-core@232be3a` and `feat/payments-core@a219850`; the file headers say so. That puts finance at 30% tested and payments at 54%. If either branch merges with changes, those rows need re-checking. The only tested item on `main` is the business-date advance in `modules/platform/test/platform.test.ts`. Accounting, fnb-pos, procurement, stock and analytics have no code anywhere yet.

**Evidence.** I fetched and read pages from OPERA 26.2, Simphony 19.8, Oracle F&B inventory, Mews, Apaleo and Stripe. Xero, QuickBooks, Agilysys, Infor and Toast pages are blocked by this environment's proxy, so they are backed by search results only; the files say this.

**Most important missing capabilities:**
- Finance: guest folios for non-staying customers and mid-stay interim bills; un-applying and reversing payments on company accounts; one bank transfer allocated across many agency invoices; posting-journal search; transaction export by business day; much of OPERA's cashier and commission depth.
- Day Close: never auto-no-show a guest whose seaplane is delayed, and handle departures when a seaplane is cancelled.
- Payments: a checkout bill larger than the card pre-authorization, and a bank transfer returned after it was confirmed.

**Decide at merge:**
- **Billing rules.** The finance branch lets a more specific rule win over a broader one it sits inside. The spec (FIN-R14) rejects every overlap. Amend the spec or switch the branch.
- **Missing exchange rate.** When today's rate is missing, the branch silently uses the last earlier rate; it should block or show a warning.
- **Two payments matrices.** `modules/payments/PARITY.md` is superseded by `docs/parity/payments.md`, which carries all its rows with an ID map. Delete the draft.
- **Coverage report.** I didn't commit `COVERAGE.md`; regenerate it after merging. The tool also lists `gaps-finance.md` as an empty module row.

I added owner questions Q130–Q132 to `docs/OPEN_QUESTIONS.md`: Maldives foreign-exchange rules, who carries the risk of offline card and room charges, and what to do with unclaimed guest credits.

Files are in /home/user/wt/parity-finance/docs/parity/:
- finance.md
- payments.md
- day-close.md
- accounting.md
- fnb-pos.md
- procurement.md
- stock.md
- analytics.md
- gaps-finance.md (spec change requests and the top 10 "beat the market" opportunities)
````

