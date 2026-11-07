# @portico/finance

## Checkpoint

- **Done:** schema + migration; pure domain (routing by specificity, splits, ledger/FX, fiscal hash chain, aging,
  cashier, allowances, invoice composition, PDF); services (folios, postings, payments/refunds, transfers,
  adjustments, billing rules + preview, deposits with time-of-supply tax, allowances, fiscal documents, receivables,
  cashier, payouts, FX settlement, reports, Day Close checks, retention, Green Tax report); universal record
  contract, search provider, HTTP routes, composition wiring; tests (domain, integration, scenarios S04/S09/S10/
  S18/S19, API e2e).
- **In progress:** full-entry reversal (`reverseEntry`) just added — needs a test and a route; legal-hold routes;
  README body.
- **Next steps:** test `reverseEntry`; add routes for reversal/legal holds/retention; finish README sections;
  final `pnpm lint && pnpm typecheck && pnpm --filter @portico/finance test && pnpm --filter @portico/api test`.
- **Known failing tests:** none at last run.
