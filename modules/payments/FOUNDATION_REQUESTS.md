# Foundation requests from payments (wave 1, after steward review)

The earlier §1 (teardown race in `@portico/testing`) was fixed on main (`b484de3`); the local harness guard is
removed. The module draft `PARITY.md` is deleted; main's `docs/parity/payments.md` supersedes it (re-verified).

## 1. Role templates (identity, `modules/identity/src/domain/role-templates.ts`)

New payments permissions after the review: `payments.externalRecord.create` (record own-terminal / cash / expected
bank-transfer payments) and `payments.bankTransfer.confirm` (sensitive: confirms a transfer arrived, which posts it
to the bill). Proposed:

| Role | Add |
|---|---|
| `front_desk` | `payments.payment.read`, `payments.externalRecord.create` |
| `reservations_agent` | `payments.payment.read`, `payments.vcc.manage`, `payments.externalRecord.create` |
| `night_auditor` | `payments.externalRecord.create` |
| finance roles (already `payments.*`) | — (`payments.bankTransfer.confirm` is included by the wildcard) |

Until then a front-desk user cannot record a cash or own-terminal payment (403 naming the missing permission).

## 2. Log redaction (`packages/http/src/server.ts` `LOG_REDACT`)

Add `'*.providerToken'`, `'*.vaultToken'`, `'*.providerCustomerRef'` and `'req.headers["stripe-signature"]'`.
Payments never logs these itself, but request logging of bodies/headers must not either (review P2-6).

## 3. Provenance `sandbox` (`packages/kernel/src/context.ts`)

`Provenance` has no `sandbox`, so sandbox-mode records are labeled `simulated` (rule 12 asks for *simulated* or
*sandbox*). Every payments view also carries `mode: 'simulate' | 'sandbox' | 'live' | 'recorded'`, so the UI can
label precisely today. Proposed: add `'sandbox'` to `Provenance` (review P3-2).

## 4. Worker / webhook database role (`packages/db`)

`payments.route_webhook()` and `payments.tenants_for_jobs()` are SECURITY DEFINER functions over the non-RLS
`payments.account_directory`; they return only routing metadata (tenant id, account id, environment) but are
executable by `portico_app`, i.e. by request handlers. Proposed: a `portico_worker` role (used by apps/worker and
the public webhook route) and grant these functions to it only (review P3-5). Same pattern for other modules' job
routing functions.

## 5. Finance (binding `LedgerPort` at merge)

Finance must implement, and the composition root bind, the `LedgerPort` in `modules/payments/src/ports.ts`
(`financeLedgerForPayments(finance)`):

- `describeTarget(tx, ref)` → `{ propertyId, legalEntityId } | null` for a folio/booking. Payments refuses to
  collect against a folio finance does not know or that belongs to another property / legal entity (review P0-1).
- Every posting call carries `{ propertyId, legalEntityId }` and the clearing account (`clearing: { provider,
  accountId }`); finance must **re-check** that the folio/booking belongs to that scope and refuse otherwise.
- `recordDeposit` carries `propertyId` (P1-5); `recordPaymentAdjustment` is signed, and a refund of a corrected
  payment is bounded by the corrected amount on the payments side (P1-4).
- New: `markPaymentVerified` (statement match / receipt confirmation → the bill stops showing "awaiting
  verification") and `recordSettlementFees` (acquirer fees from net-of-fee statements).
- Until bound, `apps/api/src/composition.ts` uses a stub that refuses folio collections (nobody can place the
  folio) and accepts booking deposits flagged "not yet on the bill".

## 6. Domain map — payments contract

The final provider contract is in `modules/payments/README.md` § Provider contract (for reservations and finance).
Please apply it to `docs/architecture/domain-map.md` § payments at merge.
