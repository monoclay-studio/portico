// Public API contracts for the finance module. No server-only imports here: web apps import this file.
import { z } from 'zod';

export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. USD');
export const moneyInput = z.object({
  amountMinor: z.number().int().safe(),
  currency: currencyCode,
});
export type MoneyInput = z.infer<typeof moneyInput>;
const localDate = z.iso.date();
const uuid = z.uuid();

export const chargeGroup = z.enum([
  'room',
  'package',
  'food',
  'beverage',
  'spa',
  'activity',
  'transfer',
  'retail',
  'minibar',
  'fee',
  'penalty',
  'misc',
  'allowance',
  'gratuity',
]);
export const folioOwnerType = z.enum(['stay', 'booking', 'group', 'company', 'house']);
export const ruleOwnerType = z.enum(['stay', 'booking', 'group']);
export const payerType = z.enum(['guest', 'company', 'agency', 'house']);
export const paymentMethod = z.enum([
  'card',
  'virtual_card',
  'payment_link',
  'external_terminal',
  'wallet',
  'cash',
  'bank_transfer',
  'cheque',
  'other',
]);
export const entityRef = z.object({ type: z.string().min(1).max(60), id: z.string().min(1).max(200) });
export const ownerRef = z.object({ type: folioOwnerType, id: uuid });
export const payerRef = z.object({
  type: payerType,
  id: uuid.optional(),
  name: z.string().min(1).max(200),
});
export type OwnerRef = z.infer<typeof ownerRef>;
export type PayerRef = z.infer<typeof payerRef>;

// ───────────────────────────── Universal record contract (docs/product/experience-architecture.md) ───────────

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
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});
export const recordFields = {
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  owner: z
    .object({ kind: z.enum(['user', 'department']), id: z.string(), name: z.string().optional() })
    .optional(),
  links: z.array(recordLink),
};

// ───────────────────────────── Chart of accounts & charge codes ─────────────────────────────

export const account = z.object({
  id: uuid,
  legalEntityId: uuid,
  code: z.string(),
  name: z.string(),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  systemKey: z.string().nullable(),
  functionalCurrency: z.string(),
  active: z.boolean(),
});
export type Account = z.infer<typeof account>;

export const accountInput = z.object({
  legalEntityId: uuid,
  code: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']),
  systemKey: z.string().min(1).max(80).optional(),
});

export const chargeCodeInput = z.object({
  propertyId: uuid,
  code: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Z0-9_-]+$/, 'Use capital letters, digits, dashes and underscores'),
  name: z.string().min(1).max(200),
  group: chargeGroup,
  revenueAccountId: uuid.optional(),
  taxGroup: z.string().min(1).max(60).nullable().optional(),
  department: z.string().max(60).optional(),
  allowanceTags: z.array(z.string().min(1).max(40)).max(20).optional(),
  restricted: z.boolean().optional(),
});
export type ChargeCodeInput = z.infer<typeof chargeCodeInput>;
export const chargeCodeUpdate = chargeCodeInput
  .omit({ propertyId: true, code: true, group: true })
  .partial()
  .extend({ active: z.boolean().optional() });
export const chargeCode = chargeCodeInput.extend({
  id: uuid,
  taxGroup: z.string().nullable(),
  revenueAccountId: uuid.nullable(),
  department: z.string().nullable(),
  allowanceTags: z.array(z.string()),
  restricted: z.boolean(),
  active: z.boolean(),
  version: z.number().int(),
});
export type ChargeCode = z.infer<typeof chargeCode>;

// ───────────────────────────── Folios & postings ─────────────────────────────

export const openFolioInput = z.object({
  propertyId: uuid,
  owner: ownerRef,
  payer: payerRef,
  label: z.string().max(200).optional(),
  currency: currencyCode.optional(),
  isDefault: z.boolean().optional(),
});
export type OpenFolioInput = z.infer<typeof openFolioInput>;

export const folioStatus = z.enum(['open', 'settled', 'closed', 'voided']);
export const folio = z.object({
  id: uuid,
  propertyId: uuid,
  legalEntityId: uuid,
  /** The record the folio belongs to (stay, booking, group, company, house). `owner` in provider calls. */
  attachedTo: ownerRef,
  payer: payerRef,
  label: z.string().nullable(),
  displayName: z.string(),
  currency: z.string(),
  isDefault: z.boolean(),
  /** Status per family (never merged): lifecycle, balance, invoicing. */
  status: z.object({
    folio: folioStatus,
    balance: z.enum(['due', 'zero', 'credit']),
    invoicing: z.enum(['nothing_to_invoice', 'not_invoiced', 'partly_invoiced', 'invoiced']),
  }),
  reopenCount: z.number().int(),
  reopenedReason: z.string().nullable(),
  supplementaryOf: uuid.nullable(),
  postDeparture: z.boolean(),
  balance: moneyInput,
  version: z.number().int(),
});
export type Folio = z.infer<typeof folio>;

export const postingKind = z.enum([
  'charge',
  'tax',
  'allowance_usage',
  'payment',
  'refund',
  'deposit_application',
  'transfer_in',
  'transfer_out',
  'adjustment',
  'write_off',
  'paid_out',
  'receivables_transfer',
  'allowance_return',
  'opening_balance',
]);
export const posting = z.object({
  id: uuid,
  folioId: uuid,
  entryId: uuid,
  kind: postingKind,
  amount: moneyInput,
  originalAmount: moneyInput.nullable(),
  chargeCode: z.string().nullable(),
  taxName: z.string().nullable(),
  description: z.string(),
  quantity: z.string().nullable(),
  serviceDate: z.string().nullable(),
  revenueDate: z.string().nullable(),
  businessDate: z.string(),
  parentPostingId: uuid.nullable(),
  correctsPostingId: uuid.nullable(),
  billingRuleId: uuid.nullable(),
  allowanceInstanceId: uuid.nullable(),
  paymentRef: entityRef.nullable(),
  paymentMethod: z.string().nullable(),
  /** provider_confirmed | recorded_unverified (awaiting statement reconciliation) — never shown as verified otherwise. */
  paymentVerification: z.enum(['provider_confirmed', 'recorded_unverified']).nullable(),
  postDeparture: z.boolean(),
  invoicedOn: uuid.nullable(),
  createdAt: z.string(),
});
export type Posting = z.infer<typeof posting>;

export const folioDetail = folio.extend({ postings: z.array(posting), ...recordFields });
export type FolioDetail = z.infer<typeof folioDetail>;

export const providedTaxLine = z.object({
  ruleId: z.string().min(1),
  ruleVersionId: z.string().min(1),
  name: z.string().min(1),
  accountKey: z.string().min(1),
  amount: moneyInput,
});

/** Manual or system charge (HTTP form of `postCharge`). The Idempotency-Key header is the posting key. */
export const postChargeInput = z
  .object({
    propertyId: uuid,
    folioId: uuid.optional(),
    target: z.object({ type: ruleOwnerType, id: uuid }).optional(),
    chargeCode: z.string().min(1).max(30),
    amount: moneyInput,
    quantity: z.number().positive().max(100000).optional(),
    priceMode: z.enum(['inclusive', 'exclusive']).optional(),
    serviceDate: localDate.optional(),
    revenueDate: localDate.optional(),
    description: z.string().min(1).max(300),
    reason: z.string().max(500).optional(),
    sourceRef: entityRef.optional(),
    taxMode: z.enum(['compute', 'provided']).optional(),
    taxLines: z.array(providedTaxLine).max(20).optional(),
    allowanceRef: z.union([z.literal('auto'), uuid]).optional(),
  })
  .refine((v) => !!v.folioId !== !!v.target, {
    message: 'Give either folioId or target (a stay, booking or group), not both.',
  });
export type PostChargeHttpInput = z.infer<typeof postChargeInput>;

export const postChargeResult = z.object({
  entryId: uuid,
  postingIds: z.array(uuid),
  folioId: uuid,
  folioIds: z.array(uuid),
  allowanceUsage: moneyInput.nullable(),
  replayed: z.boolean(),
});
export type PostChargeResult = z.infer<typeof postChargeResult>;

export const adjustmentInput = z.object({
  /** Positive amount to take off the posting (in folio currency); omit for a full correction. */
  amountMinor: z.number().int().positive().optional(),
  reasonCode: z.string().min(1).max(60),
  note: z.string().min(1).max(500),
});
export const entryResult = z.object({ entryId: uuid, postingIds: z.array(uuid), replayed: z.boolean() });
export type EntryResult = z.infer<typeof entryResult>;

export const transferInput = z
  .object({
    fromFolioId: uuid,
    toFolioId: uuid,
    items: z
      .array(z.object({ postingId: uuid, amountMinor: z.number().int().positive().optional() }))
      .max(200)
      .optional(),
    amountMinor: z.number().int().positive().optional(),
    reason: z.string().min(1).max(500),
  })
  .refine((v) => !!v.items !== (v.amountMinor !== undefined), {
    message: 'Transfer either selected postings (items) or an amount, not both.',
  });
export type TransferInput = z.infer<typeof transferInput>;

export const tenderInput = z.object({
  method: z.enum(['cash', 'bank_transfer', 'cheque', 'other']),
  amount: moneyInput,
  reference: z.string().max(200).optional(),
});
export const collectPaymentInput = z.object({ tenders: z.array(tenderInput).min(1).max(10) });

export const settleInput = z.object({ note: z.string().max(500).optional() });

// ───────────────────────────── Billing rules ─────────────────────────────

export const ruleSelector = z.object({
  chargeCodes: z.array(z.string().min(1).max(30)).max(100).optional(),
  chargeGroups: z.array(chargeGroup).max(20).optional(),
  serviceDateFrom: localDate.optional(),
  serviceDateTo: localDate.optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});
export const ruleCap = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('per_night'),
    amountMinor: z.number().int().positive(),
    currency: currencyCode,
  }),
  z.object({ kind: z.literal('per_stay'), amountMinor: z.number().int().positive(), currency: currencyCode }),
  z.object({
    kind: z.literal('percent'),
    percent: z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, 'A percentage such as 50 or 33.3333'),
  }),
]);
export const billingRuleInput = z.object({
  propertyId: uuid,
  owner: z.object({ type: ruleOwnerType, id: uuid }),
  destinationFolioId: uuid,
  label: z.string().min(1).max(200),
  selector: ruleSelector,
  cap: ruleCap.nullable().optional(),
  source: z.enum(['manual', 'company_default', 'rate_plan', 'group', 'package']).optional(),
});
export type BillingRuleInput = z.infer<typeof billingRuleInput>;
export const billingRuleUpdate = billingRuleInput
  .pick({ destinationFolioId: true, label: true, selector: true, cap: true })
  .partial();
export const billingRule = billingRuleInput.extend({
  id: uuid,
  cap: ruleCap.nullable(),
  source: z.string(),
  active: z.boolean(),
  description: z.string(),
  version: z.number().int(),
});
export type BillingRule = z.infer<typeof billingRule>;

export const previewInput = z.object({
  propertyId: uuid,
  owner: z.object({ type: ruleOwnerType, id: uuid }),
  /** Proposed full rule set to preview instead of the saved one (not saved). */
  proposedRules: z
    .array(billingRuleInput.omit({ propertyId: true, owner: true }).extend({ id: uuid.optional() }))
    .max(50)
    .optional(),
  charges: z
    .array(
      z.object({
        chargeCode: z.string().min(1).max(30),
        serviceDate: localDate,
        amount: moneyInput,
        ref: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type PreviewInput = z.infer<typeof previewInput>;
export const previewResult = z.object({
  lines: z.array(
    z.object({
      ref: z.string().nullable(),
      chargeCode: z.string(),
      serviceDate: z.string(),
      amount: moneyInput,
      allocations: z.array(
        z.object({
          folioId: uuid,
          folioName: z.string(),
          ruleId: uuid.nullable(),
          amount: moneyInput,
          explanation: z.string(),
        }),
      ),
    }),
  ),
  totalsByFolio: z.array(z.object({ folioId: uuid, folioName: z.string(), total: moneyInput })),
});
export type PreviewResult = z.infer<typeof previewResult>;

// ───────────────────────────── Deposits & allowances ─────────────────────────────

export const depositSummary = z.object({
  bookingId: uuid,
  balance: moneyInput,
  movements: z.array(
    z.object({
      kind: z.string(),
      amount: moneyInput,
      folioId: uuid.nullable(),
      businessDate: z.string(),
      entryId: uuid,
    }),
  ),
});
export type DepositSummary = z.infer<typeof depositSummary>;
export const applyDepositsInput = z.object({
  toFolioId: uuid,
  amountMinor: z.number().int().positive().optional(),
});
export const forfeitDepositInput = z.object({
  chargeCode: z.string().min(1).max(30),
  amountMinor: z.number().int().positive().optional(),
  reason: z.string().min(1).max(500),
});

export const grantAllowanceInput = z.object({
  propertyId: uuid,
  stayId: uuid,
  folioId: uuid,
  definitionRef: z.string().min(1).max(100),
  label: z.string().min(1).max(200),
  period: z.union([
    z.object({ night: localDate }),
    z.object({ stay: z.object({ from: localDate, to: localDate }) }),
  ]),
  amount: moneyInput,
  chargeCode: z.string().min(1).max(30),
  eligibleChargeCodes: z.array(z.string()).max(100).optional(),
  eligibleGroups: z.array(chargeGroup).max(20).optional(),
  eligibleTags: z.array(z.string()).max(20).optional(),
  coversTaxes: z.boolean().optional(),
  unusedPolicy: z.enum(['forfeit', 'carry_forward', 'credit_back']),
  /**
   * ADR-0016 §5 (Q48 pending): taxed_at_grant (default when the allowance code has a tax category) = the package
   * price including the allowance is taxed once at grant and consumption draws it down; prepayment = untaxed credit.
   */
  taxTreatment: z.enum(['taxed_at_grant', 'prepayment']).optional(),
});
export type GrantAllowanceInput = z.infer<typeof grantAllowanceInput>;
export const allowanceInstance = z.object({
  id: uuid,
  stayId: uuid,
  folioId: uuid,
  definitionRef: z.string(),
  label: z.string(),
  periodKey: z.string(),
  validFrom: z.string(),
  validTo: z.string(),
  granted: moneyInput,
  used: moneyInput,
  remaining: moneyInput,
  unusedPolicy: z.string(),
  status: z.string(),
});
export type AllowanceInstance = z.infer<typeof allowanceInstance>;

// ───────────────────────────── Fiscal documents ─────────────────────────────

export const fiscalSeriesInput = z.object({
  legalEntityId: uuid,
  propertyId: uuid.optional(),
  kind: z.enum(['invoice', 'credit_note']),
  prefix: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9/-]+$/, 'Use capital letters, digits, slashes and dashes'),
});
export const fiscalSeries = fiscalSeriesInput.extend({
  id: uuid,
  propertyId: uuid.nullable(),
  nextNumber: z.number().int(),
  active: z.boolean(),
});
export type FiscalSeries = z.infer<typeof fiscalSeries>;

export const issueInvoiceInput = z.object({
  seriesId: uuid.optional(),
  payerDetails: z
    .object({
      address: z.string().max(500).optional(),
      taxId: z.string().max(100).optional(),
      email: z.email().optional(),
    })
    .optional(),
});
export const creditNoteInput = z.object({
  mode: z.enum(['cancel', 'adjust']),
  reason: z.string().min(1).max(500),
  /** adjust mode: lines to credit (charge postings) — omit to credit the whole invoice. */
  lines: z
    .array(z.object({ postingId: uuid, amountMinor: z.number().int().positive().optional() }))
    .max(200)
    .optional(),
  seriesId: uuid.optional(),
});
export const fiscalDocument = z.object({
  id: uuid,
  kind: z.enum(['invoice', 'credit_note']),
  documentNumber: z.string(),
  number: z.number().int(),
  seriesId: uuid,
  folioId: uuid,
  originalDocumentId: uuid.nullable(),
  creditMode: z.string().nullable(),
  total: moneyInput,
  businessDate: z.string(),
  issuedAt: z.string(),
  hash: z.string(),
  previousHash: z.string(),
  status: z.object({ document: z.enum(['issued', 'partially_credited', 'credited']) }),
  snapshot: z.record(z.string(), z.unknown()),
  ...recordFields,
});
export type FiscalDocument = z.infer<typeof fiscalDocument>;

// ───────────────────────────── Receivables ─────────────────────────────

export const receivablesAccountInput = z.object({
  legalEntityId: uuid,
  companyId: uuid,
  kind: z.enum(['company', 'agency']),
  name: z.string().min(1).max(200),
  currency: currencyCode,
  termsDays: z.number().int().min(0).max(365),
  creditLimitMinor: z.number().int().min(0).nullable().optional(),
  creditLimitMode: z.enum(['block', 'warn']).optional(),
});
export const receivablesAccountUpdate = receivablesAccountInput
  .pick({ name: true, termsDays: true, creditLimitMinor: true, creditLimitMode: true })
  .partial()
  .extend({ status: z.enum(['active', 'on_hold', 'closed']).optional() });
export const receivablesAccount = receivablesAccountInput.extend({
  id: uuid,
  creditLimitMinor: z.number().int().nullable(),
  creditLimitMode: z.enum(['block', 'warn']),
  status: z.object({
    account: z.enum(['active', 'on_hold', 'closed']),
    credit: z.enum(['no_limit', 'within_limit', 'over_limit']),
  }),
  balance: moneyInput,
  version: z.number().int(),
  ...recordFields,
});
export type ReceivablesAccount = z.infer<typeof receivablesAccount>;
export const transferToReceivablesInput = z.object({
  receivablesAccountId: uuid,
  overrideCreditLimit: z.boolean().optional(),
});
export const receivablesPaymentInput = z.object({
  amount: moneyInput,
  method: z.enum(['bank_transfer', 'card', 'cash', 'cheque', 'other']),
  provider: z.string().max(60).optional(),
  reference: z.string().max(200).optional(),
  allocations: z
    .array(z.object({ itemId: uuid, amountMinor: z.number().int().positive() }))
    .max(200)
    .optional(),
});
export const agingReport = z.object({
  asOf: z.string(),
  accounts: z.array(
    z.object({
      accountId: uuid,
      name: z.string(),
      currency: z.string(),
      buckets: z.object({
        current: z.number().int(),
        d1_30: z.number().int(),
        d31_60: z.number().int(),
        d61_90: z.number().int(),
        over_90: z.number().int(),
      }),
      unallocatedCredits: z.number().int(),
      balance: z.number().int(),
    }),
  ),
});
export type AgingReport = z.infer<typeof agingReport>;

// ───────────────────────────── Cashier ─────────────────────────────

export const amountsByCurrency = z.record(currencyCode, z.number().int());
export const openSessionInput = z.object({ propertyId: uuid, openingFloats: amountsByCurrency });
export const closeSessionInput = z.object({
  counted: amountsByCurrency,
  note: z.string().max(500).optional(),
});
export const paidOutInput = z.object({
  folioId: uuid,
  amount: moneyInput,
  description: z.string().min(1).max(300),
});
export const cashierSummary = z.object({
  id: uuid,
  propertyId: uuid,
  cashierName: z.string(),
  status: z.object({
    session: z.enum(['open', 'closed']),
    count: z.enum(['not_counted', 'balanced', 'over', 'short']),
  }),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  openingFloats: amountsByCurrency,
  expected: amountsByCurrency,
  counted: amountsByCurrency.nullable(),
  variance: amountsByCurrency.nullable(),
  byMethod: z.array(
    z.object({
      method: z.string(),
      currency: z.string(),
      totalMinor: z.number().int(),
      count: z.number().int(),
    }),
  ),
  version: z.number().int(),
  ...recordFields,
});
export type CashierSummary = z.infer<typeof cashierSummary>;

// ───────────────────────────── FX ─────────────────────────────

export const fxRateInput = z.object({
  legalEntityId: uuid,
  businessDate: localDate,
  fromCurrency: currencyCode,
  toCurrency: currencyCode,
  rate: z.string().regex(/^\d{1,12}(\.\d{1,12})?$/, 'A positive decimal such as 15.42'),
  source: z.string().min(1).max(200),
});
export const fxRate = fxRateInput.extend({ id: uuid });
export type FxRate = z.infer<typeof fxRate>;

// ───────────────────────────── Reports & checks ─────────────────────────────

export const trialBalance = z.object({
  legalEntityId: uuid,
  functionalCurrency: z.string(),
  asOf: z.string().nullable(),
  accounts: z.array(
    z.object({
      accountId: uuid,
      code: z.string(),
      name: z.string(),
      type: z.string(),
      systemKey: z.string().nullable(),
      debitMinor: z.number().int(),
      creditMinor: z.number().int(),
      balanceMinor: z.number().int(),
    }),
  ),
  totalDebitMinor: z.number().int(),
  totalCreditMinor: z.number().int(),
  balanced: z.boolean(),
});
export type TrialBalance = z.infer<typeof trialBalance>;

export const dailyRevenue = z.object({
  propertyId: uuid,
  businessDate: z.string(),
  currency: z.string(),
  byChargeCode: z.array(
    z.object({ chargeCode: z.string(), accountCode: z.string(), netMinor: z.number().int() }),
  ),
  taxes: z.array(z.object({ accountCode: z.string(), name: z.string(), amountMinor: z.number().int() })),
  totalRevenueMinor: z.number().int(),
  restatements: z.array(
    z.object({
      entryId: uuid,
      relatesTo: z.string(),
      reason: z.string().nullable(),
      amountMinor: z.number().int(),
    }),
  ),
});
export type DailyRevenue = z.infer<typeof dailyRevenue>;

export const financeException = z.object({
  id: uuid,
  propertyId: uuid,
  kind: z.string(),
  severity: z.enum(['urgent', 'routine']),
  ref: entityRef,
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
  status: z.enum(['open', 'resolved']),
  businessDate: z.string(),
  createdAt: z.string(),
  version: z.number().int(),
});
export type FinanceException = z.infer<typeof financeException>;

export const unbalancedItem = z.object({
  code: z.string(),
  severity: z.enum(['blocking', 'warning']),
  ref: entityRef.nullable(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type UnbalancedItem = z.infer<typeof unbalancedItem>;

export const integrityReport = z.object({
  legalEntityId: uuid,
  checks: z.array(
    z.object({
      check: z.string(),
      ok: z.boolean(),
      expectedMinor: z.number().int(),
      actualMinor: z.number().int(),
      detail: z.string(),
    }),
  ),
  ok: z.boolean(),
});
export type IntegrityReport = z.infer<typeof integrityReport>;

// ───────────────────────────── Opening balances (migration, scenario 18) ─────────────────────────────

export const openingDepositsInput = z.object({
  propertyId: uuid,
  importRef: z.string().min(1).max(120),
  currency: currencyCode,
  /** The previous system's reported closing balance of the deposits ledger. */
  providedClosingMinor: z.number().int(),
  items: z
    .array(
      z.object({
        bookingId: uuid,
        externalRef: z.string().max(120).optional(),
        amountMinor: z.number().int(),
      }),
    )
    .min(1)
    .max(5000),
});
export type OpeningDepositsInput = z.infer<typeof openingDepositsInput>;
export const openingImportReport = z.object({
  importId: uuid,
  importRef: z.string(),
  status: z.enum(['reconciled', 'difference']),
  currency: z.string(),
  importedCount: z.number().int(),
  importedTotalMinor: z.number().int(),
  providedClosingMinor: z.number().int(),
  differenceMinor: z.number().int(),
  rejected: z.array(z.object({ row: z.number().int(), bookingId: z.string(), reason: z.string() })),
  entryId: uuid.nullable(),
  suspenseBalanceMinor: z.number().int(),
  explanation: z.string(),
});
export type OpeningImportReport = z.infer<typeof openingImportReport>;
