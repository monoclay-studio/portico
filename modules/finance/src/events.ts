/** Events emitted by finance (outbox). Payloads are versioned (v1). */
export const FINANCE_EVENTS = {
  postingCreated: 'finance.posting.created',
  postingAdjusted: 'finance.posting.adjusted',
  postingsTransferred: 'finance.postings.transferred',
  folioOpened: 'finance.folio.opened',
  folioSettled: 'finance.folio.settled',
  folioReopened: 'finance.folio.reopened',
  invoiceIssued: 'finance.invoice.issued',
  creditNoteIssued: 'finance.creditNote.issued',
  depositRecorded: 'finance.deposit.recorded',
  depositApplied: 'finance.deposit.applied',
  depositRefunded: 'finance.deposit.refunded',
  depositForfeited: 'finance.deposit.forfeited',
  billingRuleChanged: 'finance.billingRule.changed',
  allowanceBreakagePosted: 'finance.allowance.breakagePosted',
  receivablesTransferred: 'finance.receivables.transferred',
  receivablesPaymentRecorded: 'finance.receivables.paymentRecorded',
  cashierSessionClosed: 'finance.cashierSession.closed',
  payoutRecorded: 'finance.payout.recorded',
} as const;

/** Events finance consumes. Payload fields read defensively (the provider module defines them). */
export const CONSUMED_EVENTS = {
  stayCheckedOut: 'reservations.stay.checkedOut',
} as const;
