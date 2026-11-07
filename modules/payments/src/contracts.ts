// Public API contracts for the payments module. No server-only imports: web apps import this file.
// Card data is impossible by construction: inputs are `.strict()` (unknown fields such as "cardNumber" or "cvc"
// are rejected) and token fields refuse card-number-shaped values.
import { z } from 'zod';

const currency = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. USD');
export const money = z.object({ amountMinor: z.number().int().positive(), currency }).strict();
const signedMoney = z.object({ amountMinor: z.number().int(), currency }).strict();
/** Ledger target of a payment: a folio, or a booking (deposit = liability). */
export const ledgerRef = z.object({ type: z.enum(['folio', 'booking']), id: z.uuid() }).strict();
/** Any business reference (authorizations may guarantee a stay/booking/folio). */
export const anyRef = z.object({ type: z.string().min(1).max(40), id: z.uuid() }).strict();

const noLongDigits = (field: string) =>
  z.string().refine((v) => !/\d(?:[ -]?\d){11,}/.test(v), {
    message: `${field} must not contain a run of 12 or more digits: it could be a card number, which Portico never stores. Use the provider's token for cards; for a long bank reference enter only its last digits.`,
  });
/** Free text anywhere in payments (names, notes, reasons, references): never a card number (PAY-I05). */
const text = (max: number, min = 0) => noLongDigits('This field').pipe(z.string().min(min).max(max));
/** Staff state why a second collection for the same purpose is legitimate (audited). */
const separateCollection = z.object({ reason: text(500, 3) }).strict();

export const providerKind = z.enum(['simulator', 'stripe_connect', 'external_terminal']);
export const accountStatus = z.enum(['pending', 'active', 'restricted', 'disabled']);
export const capability = z.enum([
  'hostedCardEntry',
  'authorize',
  'incrementalAuthorize',
  'capture',
  'partialCapture',
  'multiCapture',
  'void',
  'charge',
  'refund',
  'partialRefund',
  'paymentLinks',
  'webhooks',
  'payoutReports',
  'disputes',
  'lookup',
  'recordOnly',
]);

export const accountInput = z
  .object({
    legalEntityId: z.uuid(),
    provider: providerKind,
    /**
     * Own-terminal accounts: the bank's merchant/terminal id (free text). Stripe connected accounts are NOT
     * claimed by id: ownership is linked by Portico-initiated onboarding / a Monoclay operator (P0-2).
     */
    externalAccountId: text(100, 1).optional(),
    displayName: text(200, 1),
    currencies: z.array(currency).min(1).max(20),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    statementDescriptor: text(22).optional(),
  })
  .strict();
export const accountUpdate = z
  .object({
    displayName: text(200, 1).optional(),
    /** Stripe accounts: only `disabled` may be set by the hotel; activation comes from the provider. */
    status: accountStatus.optional(),
    statusReason: text(500).optional(),
    currencies: z.array(currency).min(1).max(20).optional(),
    statementDescriptor: text(22).optional(),
  })
  .strict();
export const account = z.object({
  id: z.uuid(),
  legalEntityId: z.uuid(),
  provider: providerKind,
  externalAccountId: z.string().nullable(),
  displayName: z.string(),
  capabilities: z.array(z.string()),
  onboardingStatus: z.string(),
  countryCode: z.string().nullable(),
  currencies: z.array(z.string()),
  statementDescriptor: z.string().nullable(),
  status: accountStatus,
  statusReason: z.string().nullable(),
  applicationFeeBps: z.number().nullable(),
  /** How this account behaves in the CURRENT environment: live / sandbox / simulated / recorded only. */
  effectiveMode: z.enum(['live', 'sandbox', 'simulate', 'recorded']),
  version: z.number().int(),
});
export type PaymentAccount = z.infer<typeof account>;

export const simulatorControls = z
  .object({
    outage: z.enum(['refuse', 'timeout']).nullable().optional(),
    duplicateWebhooks: z.boolean().optional(),
    outOfOrderWebhooks: z.boolean().optional(),
    settlementDelayDays: z.number().int().min(0).max(30).optional(),
    scenarioOverrides: z
      .record(
        z.enum(['authorize', 'charge', 'capture', 'refund', 'increment', 'void']),
        z.string().regex(/^(approve|timeout_then_succeeded|timeout_then_failed|decline:[a-z_]+)$/),
      )
      .optional(),
  })
  .strict();
export type SimulatorControlsInput = z.infer<typeof simulatorControls>;

export const staffAction = z.object({ key: z.string(), label: z.string(), detail: z.string() });
export const accountHealth = z.object({
  accountId: z.uuid(),
  displayName: z.string(),
  provider: providerKind,
  state: z.enum(['closed', 'open', 'half_open']),
  cardPaymentsAvailable: z.boolean(),
  consecutiveFailures: z.number().int(),
  lastSuccessAt: z.string().nullable(),
  lastFailureAt: z.string().nullable(),
  lastError: z.string().nullable(),
  retryAfter: z.string().nullable(),
  message: z.string(),
  actions: z.array(staffAction),
});
export type AccountHealth = z.infer<typeof accountHealth>;

export const mandateInput = z
  .object({
    termsVersion: text(100, 1),
    acceptedAt: z.iso.datetime(),
    channel: text(60, 1),
    networkTransactionId: text(100).optional(),
    threeDsResult: z
      .enum(['authenticated', 'attempted', 'not_authenticated', 'exempt', 'unknown'])
      .optional(),
  })
  .strict();

export const paymentMethodInput = z
  .object({
    accountId: z.uuid(),
    propertyId: z.uuid(),
    kind: z.enum(['card', 'virtual_card', 'wallet']),
    providerToken: noLongDigits('providerToken').pipe(z.string().min(3).max(200)),
    providerCustomerRef: noLongDigits('providerCustomerRef').pipe(z.string().max(200)).optional(),
    brand: text(30).optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/, 'last4 is exactly the last four digits')
      .optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().min(2000).max(2100).optional(),
    holderName: noLongDigits('holderName').pipe(z.string().max(200)).optional(),
    owner: z
      .object({ type: z.enum(['guest_profile', 'company', 'agency', 'booking']), id: z.uuid() })
      .strict(),
    /** How the card reached the provider; a guest-present entry makes the first charge customer-initiated. */
    entryChannel: z.enum(['hosted_entry', 'terminal', 'vault', 'import']).default('hosted_entry'),
    mitAgreement: z.boolean().default(false),
    /** Required when mitAgreement is true: the guest's recorded agreement to later charges (PAY-R11). */
    mandate: mandateInput.optional(),
    tokenPortability: z.enum(['provider_bound', 'network_token', 'vault_portable', 'unknown']).optional(),
    portabilityNote: text(500).optional(),
  })
  .strict()
  .refine((m) => !m.mitAgreement || m.mandate !== undefined, {
    message:
      'A saved card with an agreement to later charges needs the mandate (terms version and acceptance time).',
    path: ['mandate'],
  });
export const paymentMethod = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  propertyId: z.uuid(),
  kind: z.string(),
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().nullable(),
  expYear: z.number().nullable(),
  holderName: z.string().nullable(),
  owner: z.object({ type: z.string(), id: z.uuid() }),
  mitAgreement: z.boolean(),
  mandate: z.record(z.string(), z.unknown()),
  tokenPortability: z.string(),
  portabilityNote: z.string(),
  status: z.string(),
  version: z.number().int(),
});
export type PaymentMethod = z.infer<typeof paymentMethod>;

/** How a status must be presented: facts vs pending vs failed vs recorded-unverified are visually distinct. */
export const statusPresentation = z.object({
  label: z.string(),
  tone: z.enum(['success', 'pending', 'failure', 'neutral', 'recorded']),
  explanation: z.string(),
  /** Never true unless the provider (or statement matching) confirmed it. */
  confirmed: z.boolean(),
});

export const declineView = z.object({
  code: z.string(),
  category: z.string(),
  message: z.string(),
  recovery: z.string(),
  retryable: z.boolean(),
});

const modeEnum = z.enum(['live', 'sandbox', 'simulate', 'recorded']);

/** Universal record contract (domain-map § Universal record contract; types in @portico/kernel records.ts). */
export const recordAction = z.object({
  action: z.string(),
  label: z.string(),
  enabled: z.boolean(),
  reason: z.string().optional(),
  previewRequired: z.boolean().optional(),
});
export const recordIssue = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  owner: z
    .object({ kind: z.enum(['user', 'department']), id: z.string(), name: z.string().optional() })
    .optional(),
  since: z.string().optional(),
});
export const recordParts = {
  /** One entry per status family (e.g. { payment: 'pending_verification', ledger: 'pending' }) — never merged. */
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: z
    .object({ kind: z.enum(['user', 'department']), id: z.string(), name: z.string().optional() })
    .optional(),
  links: z.array(
    z.object({ rel: z.string(), type: z.string(), id: z.string(), title: z.string().optional() }),
  ),
  provenance: z.enum(['live', 'simulated', 'sandbox', 'copied', 'delayed', 'incomplete', 'external']).optional(),
};

export const authorizeInput = z
  .object({
    propertyId: z.uuid(),
    methodId: z.uuid(),
    amount: money,
    ref: anyRef,
    description: text(200).optional(),
  })
  .strict();
export const incrementInput = z.object({ additionalAmount: money }).strict();
export const captureInput = z.object({ amount: money.optional(), ledgerRef: ledgerRef.optional() }).strict();
export const voidInput = z.object({ reason: text(500, 1) }).strict();
export const recordAuthorizationInput = z
  .object({
    propertyId: z.uuid(),
    accountId: z.uuid(),
    amount: money,
    ref: anyRef,
    approvalCode: noLongDigits('approvalCode').pipe(z.string().min(1).max(60)),
    cardBrand: text(30).optional(),
    cardLast4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    expiresAt: z.iso.datetime().optional(),
  })
  .strict();

export const authorization = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  accountId: z.uuid(),
  methodId: z.uuid().nullable(),
  ref: z.object({ type: z.string(), id: z.uuid() }),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  capturedMinor: z.number().int(),
  capturableMinor: z.number().int(),
  ...recordParts,
  mode: modeEnum,
  providerRef: z.string().nullable(),
  externalReference: z.string().nullable(),
  expiresAt: z.string().nullable(),
  decline: declineView.nullable(),
  presentation: statusPresentation,
  version: z.number().int(),
});
export type Authorization = z.infer<typeof authorization>;

export const chargeInput = z
  .object({
    propertyId: z.uuid(),
    methodId: z.uuid(),
    amount: money,
    ref: ledgerRef,
    /** Defaults: booking → deposit, folio → balance. A payment request owns its purpose on a reference. */
    purpose: z.enum(['deposit', 'balance', 'incidentals', 'custom']).optional(),
    separateCollection: separateCollection.optional(),
    description: text(200).optional(),
  })
  .strict();

export const recordPaymentInput = z
  .object({
    propertyId: z.uuid(),
    method: z.enum(['external_terminal', 'cash', 'bank_transfer']),
    /** Required for external_terminal (the hotel's own terminal/gateway account, Route D). */
    accountId: z.uuid().optional(),
    amount: money,
    ref: ledgerRef,
    /** Terminal approval code, bank transfer reference or cash receipt number. */
    reference: noLongDigits('reference').pipe(z.string().min(1).max(100)),
    terminalId: text(60).optional(),
    cardBrand: text(30).optional(),
    cardLast4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    receivedAt: z.iso.datetime(),
    authorizationId: z.uuid().optional(),
    purpose: z.enum(['deposit', 'balance', 'incidentals', 'custom']).optional(),
    separateCollection: separateCollection.optional(),
    /** The same approval code/receipt number really is a second payment: say why (audited). */
    duplicateOverride: separateCollection.optional(),
    note: text(500).optional(),
  })
  .strict();
export const confirmBankTransferInput = z
  .object({ bankReference: text(100, 1), receivedAt: z.iso.datetime().optional() })
  .strict();
export const cancelBankTransferInput = z.object({ reason: text(500, 1) }).strict();

export const payment = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  legalEntityId: z.uuid(),
  accountId: z.uuid().nullable(),
  kind: z.string(),
  method: z.string(),
  ref: z.object({ type: z.string(), id: z.uuid() }),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  /** Σ linked corrections (Route D); the original amount is never edited. */
  adjustedMinor: z.number().int(),
  refundedMinor: z.number().int(),
  refundableMinor: z.number().int(),
  purpose: z.string().nullable(),
  ...recordParts,
  mode: modeEnum,
  providerVerified: z.boolean(),
  providerRef: z.string().nullable(),
  externalReference: z.string().nullable(),
  cardBrand: z.string().nullable(),
  cardLast4: z.string().nullable(),
  authorizationId: z.uuid().nullable(),
  paymentRequestId: z.uuid().nullable(),
  receivedAt: z.string().nullable(),
  decline: declineView.nullable(),
  ledger: z.object({ status: z.string(), postingId: z.string().nullable() }),
  presentation: statusPresentation,
  createdAt: z.string(),
  version: z.number().int(),
});
export type Payment = z.infer<typeof payment>;

export const refundInput = z.object({ paymentId: z.uuid(), amount: money, reason: text(500, 1) }).strict();
export const recordRefundInput = z
  .object({
    paymentId: z.uuid(),
    amount: money,
    reason: text(500, 1),
    reference: noLongDigits('reference').pipe(z.string().min(1).max(100)),
  })
  .strict();
export const refund = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  propertyId: z.uuid(),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  reason: z.string(),
  ...recordParts,
  mode: modeEnum,
  providerVerified: z.boolean(),
  providerRef: z.string().nullable(),
  externalReference: z.string().nullable(),
  failure: declineView.nullable(),
  ledger: z.object({ status: z.string(), postingId: z.string().nullable() }),
  presentation: statusPresentation,
  createdAt: z.string(),
  version: z.number().int(),
});
export type Refund = z.infer<typeof refund>;

export const adjustmentInput = z
  .object({
    paymentId: z.uuid(),
    amount: signedMoney.refine((m) => m.amountMinor !== 0, 'An adjustment cannot be zero.'),
    reason: text(500, 1),
    exceptionId: z.uuid().optional(),
  })
  .strict();
export const adjustment = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  reason: z.string(),
  ledgerPostingId: z.string(),
  createdAt: z.string(),
});

export const paymentRequestInput = z
  .object({
    propertyId: z.uuid(),
    accountId: z.uuid().optional(),
    payer: z
      .object({
        type: z.enum(['guest_profile', 'company', 'agency', 'other']),
        id: z.uuid().optional(),
        name: text(200, 1),
        email: z.email().optional(),
      })
      .strict(),
    amount: money,
    purpose: z.enum(['deposit', 'balance', 'incidentals_preauth', 'custom']),
    description: text(200).optional(),
    ref: ledgerRef,
    expiresAt: z.iso.datetime(),
    separateCollection: separateCollection.optional(),
  })
  .strict();
export const paymentRequest = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  legalEntityId: z.uuid(),
  accountId: z.uuid(),
  payer: z.record(z.string(), z.unknown()),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  paidMinor: z.number().int(),
  purpose: z.string(),
  description: z.string().nullable(),
  ref: z.object({ type: z.string(), id: z.uuid() }),
  expiresAt: z.string(),
  ...recordParts,
  mode: z.enum(['live', 'sandbox', 'simulate']),
  link: z.object({ status: z.string(), url: z.string().nullable() }),
  presentation: statusPresentation,
  version: z.number().int(),
});
export type PaymentRequest = z.infer<typeof paymentRequest>;
export const cancelRequestInput = z.object({ reason: text(500, 1) }).strict();

export const virtualCardInput = z
  .object({
    propertyId: z.uuid(),
    accountId: z.uuid(),
    /** Token/alias issued by the PCI vault or proxy that received the OTA card (never the card number). */
    vaultToken: noLongDigits('vaultToken').pipe(z.string().min(3).max(200)),
    brand: text(30).optional(),
    last4: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    expMonth: z.number().int().min(1).max(12).optional(),
    expYear: z.number().int().min(2000).max(2100).optional(),
    bookingId: z.uuid(),
    ledgerRef: ledgerRef.optional(),
    channel: text(60, 1),
    channelReference: text(100, 1),
    amount: money,
    activationDate: z.iso.date(),
    expiresOn: z.iso.date().optional(),
  })
  .strict();
export const virtualCard = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  methodId: z.uuid(),
  bookingId: z.uuid(),
  channel: z.string(),
  channelReference: z.string(),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  activationDate: z.string(),
  expiresOn: z.string().nullable(),
  status: z.string(),
  attempts: z.number().int(),
  nextAttemptAt: z.string().nullable(),
  lastFailure: declineView.nullable(),
  chargedPaymentId: z.uuid().nullable(),
  version: z.number().int(),
});
export type VirtualCard = z.infer<typeof virtualCard>;

export const evidenceItem = z.object({
  key: z.string(),
  label: z.string(),
  done: z.boolean(),
  note: z.string().nullable(),
});
export const dispute = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  propertyId: z.uuid(),
  providerDisputeId: z.string(),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  reason: z.string(),
  status: z.string(),
  evidenceDueAt: z.string().nullable(),
  evidence: z.array(evidenceItem),
  fundsWithdrawn: z.boolean(),
  ledgerMovements: z.array(z.record(z.string(), z.unknown())),
  version: z.number().int(),
});
export type Dispute = z.infer<typeof dispute>;
export const evidenceUpdate = z
  .object({
    items: z.array(
      z.object({ key: z.string().max(60), done: z.boolean(), note: text(1000).optional() }).strict(),
    ),
  })
  .strict();

export const payoutInput = z
  .object({
    accountId: z.uuid(),
    providerPayoutId: text(100, 1),
    currency,
    grossMinor: z.number().int(),
    feesMinor: z.number().int().min(0),
    netMinor: z.number().int(),
    arrivalDate: z.iso.date(),
    status: z.enum(['in_transit', 'paid', 'failed']),
    failureReason: text(500).optional(),
    paymentIds: z.array(z.uuid()).max(5000).default([]),
    refundIds: z.array(z.uuid()).max(5000).default([]),
  })
  .strict()
  .refine((p) => p.grossMinor - p.feesMinor === p.netMinor, {
    message: 'Gross minus fees must equal net.',
    path: ['netMinor'],
  });
export const payout = z.object({
  id: z.uuid(),
  accountId: z.uuid(),
  legalEntityId: z.uuid(),
  providerPayoutId: z.string(),
  currency: z.string(),
  grossMinor: z.number().int().nullable(),
  feesMinor: z.number().int().nullable(),
  netMinor: z.number().int(),
  arrivalDate: z.string().nullable(),
  status: z.string(),
  failureReason: z.string().nullable(),
  source: z.string(),
  ledger: z.object({ status: z.string(), ref: z.string().nullable() }),
  itemCount: z.number().int(),
  version: z.number().int(),
});
export type Payout = z.infer<typeof payout>;

export const statementImportInput = z
  .object({
    propertyId: z.uuid(),
    accountId: z.uuid().optional(),
    source: z.enum(['terminal_batch', 'acquirer_settlement', 'bank_statement', 'cash_deposit']),
    fileName: text(200, 1),
    periodFrom: z.iso.date(),
    periodTo: z.iso.date(),
    csv: z.string().min(1).max(5_000_000),
  })
  .strict();
export const statementLine = z.object({
  lineNo: z.number().int(),
  day: z.string(),
  amount: z.object({ amountMinor: z.number().int(), currency: z.string() }),
  feeMinor: z.number().int(),
  reference: z.string().nullable(),
  matchStatus: z.string(),
  matchBasis: z.string().nullable(),
  matchedPaymentId: z.uuid().nullable(),
  matchedRefundId: z.uuid().nullable(),
});
export const statementResult = z.object({
  id: z.uuid(),
  source: z.string(),
  fileName: z.string(),
  /** File-based import — always labeled as such; it is not a live connection. */
  provenance: z.literal('file_import'),
  periodFrom: z.string(),
  periodTo: z.string(),
  lineCount: z.number().int(),
  matchedCount: z.number().int(),
  exceptionCount: z.number().int(),
  /** Acquirer fees found in the file, posted to finance as an expense (never deducted from guest payments). */
  feesMinor: z.number().int(),
  lines: z.array(statementLine),
  exceptionIds: z.array(z.uuid()),
});
export type StatementResult = z.infer<typeof statementResult>;

export const paymentException = z.object({
  id: z.uuid(),
  propertyId: z.uuid().nullable(),
  kind: z.string(),
  severity: z.enum(['urgent', 'routine']),
  problem: z.string(),
  businessImpact: z.string(),
  nextStep: z.string(),
  ownerRole: z.string(),
  responsibleParty: z.string(),
  ref: z.object({ type: z.string(), id: z.uuid() }).nullable(),
  ...recordParts,
  resolution: z.string().nullable(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type PaymentException = z.infer<typeof paymentException>;
export const resolveExceptionInput = z.object({ resolution: text(1000, 1) }).strict();

export const paymentsStatus = z.object({
  propertyId: z.uuid(),
  environment: z.string(),
  cardPaymentsAvailable: z.boolean(),
  banner: z.string().nullable(),
  accounts: z.array(accountHealth),
  unresolved: z.object({
    pendingVerification: z.array(
      z.object({
        type: z.string(),
        id: z.uuid(),
        amountMinor: z.number(),
        currency: z.string(),
        since: z.string(),
      }),
    ),
    recordedUnverified: z.number().int(),
    ledgerPending: z.number().int(),
    openExceptions: z.number().int(),
  }),
});
export type PaymentsStatus = z.infer<typeof paymentsStatus>;

export const reconciliationResult = z.object({
  checked: z.number().int(),
  resolved: z.number().int(),
  stillPending: z.number().int(),
  ledgerRetried: z.number().int(),
  authorizationsExpired: z.number().int(),
  exceptionsRaised: z.number().int(),
});
export type ReconciliationResult = z.infer<typeof reconciliationResult>;
