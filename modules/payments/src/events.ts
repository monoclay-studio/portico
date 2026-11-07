/** Event types emitted by payments (`<module>.<aggregate>.<pastTenseVerb>`). Payloads never carry card data. */
export const PaymentsEvents = {
  accountCreated: 'payments.account.created',
  accountStatusChanged: 'payments.account.statusChanged',
  /** Internal: an operation's intent is committed; the executor consumer sends it (once). */
  operationRequested: 'payments.operation.requested',
  /** Internal: an operation's outcome is unknown; the reconciler consumer verifies it by provider lookup. */
  operationPendingVerification: 'payments.operation.pendingVerification',
  authorizationAuthorized: 'payments.authorization.authorized',
  authorizationFailed: 'payments.authorization.failed',
  authorizationVoided: 'payments.authorization.voided',
  authorizationExpired: 'payments.authorization.expired',
  authorizationCaptured: 'payments.authorization.captured',
  paymentSucceeded: 'payments.payment.succeeded',
  paymentFailed: 'payments.payment.failed',
  paymentPendingVerification: 'payments.payment.pendingVerification',
  paymentRecorded: 'payments.payment.recorded',
  paymentVerified: 'payments.payment.verified',
  paymentAdjusted: 'payments.payment.adjusted',
  refundSucceeded: 'payments.refund.succeeded',
  refundFailed: 'payments.refund.failed',
  refundPendingVerification: 'payments.refund.pendingVerification',
  refundRecorded: 'payments.refund.recorded',
  requestCreated: 'payments.request.created',
  requestPaid: 'payments.request.paid',
  requestExpired: 'payments.request.expired',
  requestCancelled: 'payments.request.cancelled',
  disputeOpened: 'payments.dispute.opened',
  disputeUpdated: 'payments.dispute.updated',
  disputeClosed: 'payments.dispute.closed',
  payoutPaid: 'payments.payout.paid',
  payoutFailed: 'payments.payout.failed',
  providerDegraded: 'payments.provider.degraded',
  providerRestored: 'payments.provider.restored',
  exceptionRaised: 'payments.exception.raised',
  exceptionResolved: 'payments.exception.resolved',
  vccCharged: 'payments.vcc.charged',
  vccFailed: 'payments.vcc.failed',
  statementImported: 'payments.statement.imported',
} as const;

/** Events of other modules payments consumes (their owners' type strings). */
export const ConsumedEvents = {
  guestsProfileMerged: 'guests.profile.merged',
  guestsProfileUnmerged: 'guests.profile.unmerged',
} as const;

export interface OperationEventPayload extends Record<string, unknown> {
  operationId: string;
  kind: string;
  accountId: string;
}
