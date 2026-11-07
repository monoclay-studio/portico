// Public API contracts for the rates module. No server-only imports here: web apps import this file.
// Configuration structures (tax rule definitions, policies, inclusions…) are validated with these schemas at
// the boundary and stored as JSON; the pure domain code works on their parsed (output) types.
import { z } from 'zod';

// ───────────────────────────── Building blocks ─────────────────────────────

export const uuid = z.uuid();
export const localDate = z.iso.date();
export const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. USD');
/** Integer minor units (cents). Never floats. */
export const minorAmount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const signedMinorAmount = z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const money = z.object({ amountMinor: signedMinorAmount, currency: currencyCode });
export type MoneyDto = z.infer<typeof money>;
/** Decimal number as a string (exact). e.g. "17", "12.50", "-10". */
export const decimalString = z
  .string()
  .regex(/^-?\d{1,12}(\.\d{1,8})?$/, 'Use a decimal number written as text, such as "17" or "12.50"');
export const nonNegativeDecimal = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,8})?$/, 'Use a non-negative decimal number written as text, such as "17"');
/** A percentage 0–100 written as text (bounded so prices, penalties and allocations never go negative). */
export const percent0to100 = nonNegativeDecimal.refine((v) => Number(v) <= 100, {
  message: 'A percentage must be between 0 and 100.',
});
/** A signed percentage adjustment ≥ −100 (a −100% derivation is free; never below zero). */
export const percentAdjustment = decimalString.refine((v) => Number(v) >= -100, {
  message: 'A percentage reduction cannot exceed 100%.',
});
/** A fixed amount in MAJOR units of a currency (e.g. Green Tax "12.00" USD). Converted exactly to minor units. */
export const fixedAmount = z.object({ value: nonNegativeDecimal, currency: currencyCode });
export type FixedAmount = z.infer<typeof fixedAmount>;

/** Half-open night range [from, to): from = arrival, to = departure. */
export const dateRange = z.object({ from: localDate, to: localDate }).refine((r) => r.to > r.from, {
  message: 'The end date must be after the start date (ranges are [from, to)).',
});

export const occupancy = z.object({
  adults: z.number().int().min(1).max(20),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(20).default([]),
});
export type OccupancyDto = z.infer<typeof occupancy>;

export const roundingMode = z.enum(['half_up', 'half_even', 'down', 'up']);

// ───────────────────────────── Tax & fee rules ─────────────────────────────

export const taxRuleKind = z.enum([
  'percentage',
  'per_person_night',
  'per_unit_night',
  'per_stay',
  'banded',
  'fixed_per_charge',
]);
export type TaxRuleKind = z.infer<typeof taxRuleKind>;

const classificationValue = z.union([z.string(), z.number(), z.boolean()]);
export const classificationCondition = z
  .object({
    key: z.string().min(1).max(100),
    equals: classificationValue.optional(),
    in: z.array(classificationValue).min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  })
  .refine((c) => c.equals !== undefined || c.in !== undefined || c.min !== undefined || c.max !== undefined, {
    message: 'A classification condition needs equals, in, min or max.',
  });
export type ClassificationCondition = z.infer<typeof classificationCondition>;
/** Property classification predicate, e.g. Maldives Green Tax: inhabited island AND ≤ 50 rooms. */
export const classificationPredicate = z.object({
  all: z.array(classificationCondition).optional(),
  any: z.array(classificationCondition).optional(),
});
export type ClassificationPredicate = z.infer<typeof classificationPredicate>;

export const taxBand = z.object({
  /** Upper bound (inclusive) of the net price per unit-night for this band; null = no upper bound. */
  upToPerUnitNight: fixedAmount.nullable(),
  ratePercent: percent0to100,
});

export const taxExemption = z.discriminatedUnion('kind', [
  /** Long-stay exemption: the rule does not apply when the stay is longer than `nights`. */
  z.object({ kind: z.literal('stay_nights_over'), nights: z.number().int().positive() }),
  /** Exemption certificates (e.g. a tax-exempt company) may be presented for this rule. */
  z.object({ kind: z.literal('certificate'), note: z.string().max(500).optional() }),
]);

export const taxRuleDefinition = z
  .object({
    kind: taxRuleKind,
    /** Percentage rules: e.g. "17" for 17%. */
    ratePercent: percent0to100.optional(),
    /** Fixed-amount rules (per person-night, per unit-night, per stay, per charge). */
    amount: fixedAmount.optional(),
    /** Banded rules: rate switches by the net price per unit-night (e.g. India GST threshold). */
    bands: z.array(taxBand).min(1).optional(),
    /** Compounding: what the percentage applies to. `includeRuleCodes` lists rules computed first (e.g. service charge). */
    base: z
      .object({
        includeNet: z.boolean().default(true),
        includeRuleCodes: z.array(z.string()).default([]),
      })
      .default({ includeNet: true, includeRuleCodes: [] }),
    appliesTo: z.object({
      /** Tax categories of charge lines (e.g. accommodation, food_beverage, transfer, spa, activity). */
      taxCategories: z.array(z.string().min(1)).min(1),
      outletKinds: z.array(z.string()).optional(),
      /** Outlet kinds this rule never applies to (e.g. a general-sector outlet outside tourism GST). */
      excludeOutletKinds: z.array(z.string()).optional(),
      classification: classificationPredicate.optional(),
      stayNights: z.object({ min: z.number().int().optional(), max: z.number().int().optional() }).optional(),
    }),
    /** Per-person rules: children younger than this age (years) are exempt. Omit = no child exemption. */
    persons: z.object({ exemptChildrenUnderAge: z.number().int().min(0).max(18).optional() }).optional(),
    exemptions: z.array(taxExemption).default([]),
    caps: z
      .object({
        /** Applies only to the first N nights of a stay (e.g. a 30-night cap). */
        maxNights: z.number().int().positive().optional(),
        maxAmountPerLine: fixedAmount.optional(),
      })
      .optional(),
    /** Whether prices include this rule unless a line says otherwise. */
    inclusiveDefault: z.boolean().default(false),
    rounding: z
      .object({
        mode: z.enum(['half_up', 'half_even']).default('half_up'),
        scope: z.literal('per_line').default('per_line'),
      })
      .default({ mode: 'half_up', scope: 'per_line' }),
  })
  .superRefine((d, ctx) => {
    if (d.kind === 'percentage' && d.ratePercent === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'A percentage rule needs ratePercent.',
        path: ['ratePercent'],
      });
    if (
      ['per_person_night', 'per_unit_night', 'per_stay', 'fixed_per_charge'].includes(d.kind) &&
      d.amount === undefined
    )
      ctx.addIssue({ code: 'custom', message: `A ${d.kind} rule needs an amount.`, path: ['amount'] });
    if (d.kind === 'banded' && !d.bands)
      ctx.addIssue({ code: 'custom', message: 'A banded rule needs bands.', path: ['bands'] });
  });
export type TaxRuleDefinition = z.output<typeof taxRuleDefinition>;

export const sourceCitation = z.object({
  url: z.url(),
  title: z.string().min(1).max(300),
  retrievedOn: localDate.optional(),
});
/**
 * unverified: not checked against an official source · verified_official_source: read from the authority's own
 * published text (still not legal advice) · verified: confirmed by a qualified adviser for production use.
 */
export const verificationStatus = z.enum(['unverified', 'verified_official_source', 'verified']);
export type VerificationStatus = z.infer<typeof verificationStatus>;
export const verification = z.object({
  status: verificationStatus,
  verifiedBy: z.string().max(200).optional(),
  verifiedOn: localDate.optional(),
  note: z.string().max(2000).optional(),
});

export const taxRuleVersionInput = z
  .object({
    /** null = open start (the start date is not recorded / not verified). */
    effectiveFrom: localDate.nullable(),
    effectiveTo: localDate.nullable().default(null),
    definition: taxRuleDefinition,
    verification: verification.default({ status: 'unverified' }),
    sources: z.array(sourceCitation).min(1, 'Cite at least one source for a tax or fee rule.'),
    notes: z.string().max(4000).optional(),
  })
  .refine((v) => !v.effectiveFrom || !v.effectiveTo || v.effectiveTo > v.effectiveFrom, {
    message: 'effectiveTo must be after effectiveFrom.',
  });
export type TaxRuleVersionInput = z.output<typeof taxRuleVersionInput>;

/**
 * Which date selects the rule version: the service date (default), the booking date, the invoice date, or the
 * time of supply = the earlier of invoice issue or payment (Maldives TGST). A line's explicit `taxPointDate`
 * (e.g. a deposit already taxed at payment) always wins, so later rule changes never re-tax fixed amounts.
 */
export const taxPointPolicy = z.enum(['service_date', 'booking_date', 'invoice_date', 'time_of_supply']);
export type TaxPointPolicy = z.infer<typeof taxPointPolicy>;

export const taxRuleInput = z.object({
  code: z.string().regex(/^[A-Z0-9_-]{2,40}$/, 'Use 2–40 capital letters, digits, dashes or underscores'),
  name: z.string().min(1).max(200),
  /** ISO country (e.g. MV) optionally with a subdivision (e.g. AE-DU). */
  jurisdiction: z.string().regex(/^[A-Z]{2}(-[A-Z0-9]{1,3})?$/),
  category: z.enum(['tax', 'fee']),
  /**
   * statutory = set by law, follows its tax point at posting (e.g. TGST, Green Tax);
   * commercial = set by the hotel (service charge, resort fee): part of the agreement — agreed stays keep the
   * version recorded in their terms; later versions apply only to new agreements and non-agreement charges.
   */
  nature: z.enum(['statutory', 'commercial']).default('statutory'),
  /** Restrict to specific properties; null = every property in the jurisdiction. */
  propertyIds: z.array(uuid).nullable().default(null),
  taxPointPolicy: taxPointPolicy.default('service_date'),
  /** Finance maps this key to a tax-payable / fee ledger account. */
  ledgerMappingKey: z.string().min(1).max(100),
  /** Compounding order tie-breaker (lower first). Base dependencies always come first. */
  sequence: z.number().int().min(0).max(10_000).default(100),
  firstVersion: taxRuleVersionInput,
});
export type TaxRuleInput = z.output<typeof taxRuleInput>;

export const taxRuleVersion = z.object({
  id: uuid,
  taxRuleId: uuid,
  versionNo: z.number().int(),
  status: z.enum(['draft', 'active', 'withdrawn']),
  effectiveFrom: localDate.nullable(),
  effectiveTo: localDate.nullable(),
  definition: z.unknown(),
  verification,
  sources: z.array(sourceCitation),
  notes: z.string().nullable(),
  activatedAt: z.string().nullable(),
  activatedBy: z.string().nullable(),
});
export const taxRule = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  jurisdiction: z.string(),
  category: z.enum(['tax', 'fee']),
  nature: z.enum(['statutory', 'commercial']),
  propertyIds: z.array(uuid).nullable(),
  taxPointPolicy,
  ledgerMappingKey: z.string(),
  sequence: z.number().int(),
  status: z.enum(['active', 'retired']),
  version: z.number().int(),
  versions: z.array(taxRuleVersion),
});
export type TaxRuleDto = z.infer<typeof taxRule>;

// ───────────────────────────── Charge lines and tax output ─────────────────────────────

export const taxInclusion = z.discriminatedUnion('mode', [
  /** Amount excludes every applicable rule (taxes are added on top). */
  z.object({ mode: z.literal('exclusive') }),
  /** Amount includes every applicable rule (taxes are backed out). */
  z.object({ mode: z.literal('inclusive') }),
  /** Amount includes exactly these rules (e.g. service charge + TGST included, Green Tax added). */
  z.object({ mode: z.literal('rules'), includedRuleCodes: z.array(z.string()).min(1) }),
  /** Each rule's inclusiveDefault decides. */
  z.object({ mode: z.literal('rule_default') }),
]);
export type TaxInclusion = z.infer<typeof taxInclusion>;

export const chargeLine = z.object({
  /** Caller's identifier, echoed on every tax line. */
  lineId: z.string().min(1).max(200),
  chargeCode: z.string().min(1).max(50),
  taxCategory: z.string().min(1).max(50),
  amount: money,
  quantity: z.number().int().min(1).max(100_000).default(1),
  serviceDate: localDate,
  taxInclusion: taxInclusion.default({ mode: 'exclusive' }),
  outletKind: z.string().max(50).optional(),
  /** Nights covered by this line for per-night rules (default 1). */
  nights: z.number().int().min(1).max(366).default(1),
  /** Units covered by this line for per-unit rules (default 1). */
  units: z.number().int().min(1).max(1000).default(1),
  occupancy: occupancy.optional(),
  /** Position in a stay (0 = first night) for per-stay rules and night caps. */
  nightIndex: z.number().int().min(0).optional(),
  /** Tax point already fixed for this amount (e.g. deposit taxed at payment). Overrides each rule's policy. */
  taxPointDate: localDate.optional(),
  /**
   * Parts of the amount whose tax point is already fixed (e.g. a 30% deposit taxed at payment). Value-based rules
   * are computed per part with the version in force at that part's tax point; quantity-based levies (Green Tax)
   * are computed ONCE for the whole line. The remainder follows each rule's tax point policy.
   */
  taxPointSplits: z
    .array(z.object({ amountMinor: minorAmount, taxPointDate: localDate }))
    .max(20)
    .optional(),
  /**
   * The line is posted under agreed terms: commercial rules (service charge, hotel fees) apply ONLY in these
   * versions (TermsSnapshot.taxes.commercialRuleVersionIds). Omit for charges outside an agreement.
   */
  agreedRuleVersionIds: z.array(uuid).optional(),
  /**
   * supply (default for amount ≥ 0) · reversal (undoes a supply: every rule mirrors, per-guest levies included) ·
   * price_adjustment (default for amount < 0: a rebate on price; per-guest levies are not touched).
   */
  adjustment: z.enum(['supply', 'reversal', 'price_adjustment']).optional(),
  /** Only quantity-based levies apply (e.g. a Green Tax true-up for actual 24-hour blocks). */
  levyOnly: z.boolean().default(false),
});
export type ChargeLineInput = z.input<typeof chargeLine>;
export type ChargeLine = z.output<typeof chargeLine>;

export const exemptionCertificate = z.object({
  ruleCode: z.string(),
  reference: z.string().min(1).max(200),
  validFrom: localDate,
  validTo: localDate,
});

export const fxRate = z.object({
  from: currencyCode,
  to: currencyCode,
  rate: nonNegativeDecimal,
  /** Where the rate comes from (e.g. MMA) and its date — recorded for tax evidence. */
  source: z.string().max(100).optional(),
  asOf: localDate.optional(),
});
export type FxRate = z.infer<typeof fxRate>;

export const computeTaxesInput = z.object({
  propertyId: uuid,
  lines: z.array(chargeLine).min(1).max(2000),
  occupancy: occupancy.optional(),
  stayContext: z
    .object({
      stayNights: z.number().int().min(1),
      arrival: localDate.optional(),
      bookingDate: localDate.optional(),
    })
    .optional(),
  /** Invoice date (taxPointPolicy invoice_date / time_of_supply). */
  invoiceDate: localDate.optional(),
  /**
   * A payment covering ALL lines of this request in full (time_of_supply). For a partial payment such as a
   * deposit use `ChargeLine.taxPointSplits`, so only the paid part is fixed.
   */
  fullPaymentDate: localDate.optional(),
  /** Estimate for quotes when neither invoice nor payment exists yet (e.g. departure). Lines are flagged `estimated`. */
  expectedInvoiceDate: localDate.optional(),
  /** Pin exact rule versions (audit recompute): only these versions are used. */
  ruleVersionIds: z.array(uuid).optional(),
  fxRates: z.array(fxRate).default([]),
  exemptionCertificates: z.array(exemptionCertificate).default([]),
});
export type ComputeTaxesInput = z.input<typeof computeTaxesInput>;

export const taxLine = z.object({
  lineId: z.string(),
  ruleId: uuid,
  ruleCode: z.string(),
  ruleName: z.string(),
  ruleVersionId: uuid,
  /** tax = statutory tax or levy; fee = fee/service charge (the reporting split of totals). */
  category: z.enum(['tax', 'fee']),
  /** statutory (law) or commercial (hotel-set, pinned to the agreement). */
  nature: z.enum(['statutory', 'commercial']),
  /**
   * How the amount is computed. Value-based (`percentage`, `banded`) follows the price; quantity-based
   * (`per_person_night`, `per_unit_night`, `per_stay`, `fixed_per_charge`) does not — e.g. Green Tax on a
   * complimentary night.
   */
  basis: taxRuleKind,
  inclusive: z.boolean(),
  /** Value-based rules: the base the rate applied to. Quantity-based: null (see quantity and fixedAmount). */
  base: money.nullable(),
  ratePercent: z.string().nullable(),
  quantity: z
    .object({ persons: z.number(), exemptPersons: z.number(), nights: z.number(), units: z.number() })
    .nullable(),
  /** Quantity-based rules: the per-unit amount in the rule's own currency (e.g. USD 12.00). */
  fixedAmount: fixedAmount.nullable(),
  /** Exchange rate used to convert `fixedAmount` into the line currency (evidence for USD reporting). */
  fx: fxRate.nullable(),
  amount: money,
  ledgerMappingKey: z.string(),
  verificationStatus,
  taxPointDate: localDate,
  /** True when the tax point is an estimate (no invoice or payment yet) — the amount may change at posting. */
  estimated: z.boolean(),
});
export type TaxLine = z.infer<typeof taxLine>;

export const lineTaxResult = z.object({
  lineId: z.string(),
  net: money,
  taxes: z.array(taxLine),
  gross: money,
  /** Minor units moved to the net so that net + taxes = gross exactly (inclusive lines only). */
  roundingResidueMinor: z.number().int(),
  exemptionsApplied: z.array(z.object({ ruleCode: z.string(), reference: z.string() })),
});
export type LineTaxResult = z.infer<typeof lineTaxResult>;

export const taxComputation = z.object({
  lines: z.array(lineTaxResult),
  totals: z.object({ net: money, taxes: money, fees: money, gross: money }),
  ruleVersionIds: z.array(uuid),
});
export type TaxComputation = z.infer<typeof taxComputation>;

// ───────────────────────────── Policies ─────────────────────────────

export const penalty = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('first_night') }),
  z.object({ kind: z.literal('nights'), nights: z.number().int().min(1).max(366) }),
  z.object({ kind: z.literal('percent_of_stay'), percent: percent0to100 }),
  z.object({ kind: z.literal('amount'), amountMinor: minorAmount }),
]);
export type Penalty = z.infer<typeof penalty>;

export const deadline = z.discriminatedUnion('kind', [
  /** From booking (non-refundable). */
  z.object({ kind: z.literal('at_booking') }),
  /** N days before arrival at a local time (property time zone), default 00:00. */
  z.object({
    kind: z.literal('days_before_arrival'),
    days: z.number().int().min(0).max(730),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .default('00:00'),
  }),
  /** N hours before the property's check-in time on the arrival date. */
  z.object({
    kind: z.literal('hours_before_checkin'),
    hours: z
      .number()
      .int()
      .min(0)
      .max(24 * 60),
  }),
]);
export type Deadline = z.infer<typeof deadline>;

export const cancellationStructure = z.object({
  /** "From this deadline onwards, this penalty applies". Before the earliest deadline cancellation is free. */
  tiers: z.array(z.object({ from: deadline, penalty })).max(10),
  noShow: penalty.default({ kind: 'first_night' }),
  earlyDeparture: penalty.default({ kind: 'none' }),
  /** Amounts penalties are computed on. */
  basis: z.enum(['net_and_fees', 'gross', 'net']).default('net_and_fees'),
});
export type CancellationStructure = z.output<typeof cancellationStructure>;

export const guaranteeKind = z.enum(['none', 'card', 'deposit', 'company', 'agency', 'prepaid_channel']);
export const guaranteeStructure = z.object({
  accepted: z.array(guaranteeKind).min(1),
  /** Local time on the arrival date when non-guaranteed bookings are released. */
  holdUntil: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export type GuaranteeStructure = z.infer<typeof guaranteeStructure>;

export const scheduleItem = z.object({
  kind: z.enum(['deposit', 'preauthorization', 'balance']),
  amount: z.discriminatedUnion('basis', [
    z.object({ basis: z.literal('percent'), percent: percent0to100 }),
    z.object({ basis: z.literal('nights'), nights: z.number().int().min(1) }),
    z.object({ basis: z.literal('amount'), amountMinor: minorAmount }),
    z.object({ basis: z.literal('remaining') }),
  ]),
  due: z.object({
    anchor: z.enum(['booking', 'arrival', 'departure']),
    offsetDays: z.number().int().min(-730).max(730).default(0),
  }),
  method: z.enum(['card_on_file', 'payment_request', 'bank_transfer', 'agency_invoice']),
  onOverdue: z
    .discriminatedUnion('action', [
      z.object({ action: z.literal('remind') }),
      z.object({ action: z.literal('task') }),
      z.object({ action: z.literal('auto_cancel'), afterDays: z.number().int().min(0).max(60) }),
    ])
    .default({ action: 'remind' }),
});
export const depositStructure = z.object({ items: z.array(scheduleItem).max(10) });
export type DepositStructure = z.output<typeof depositStructure>;

export const policyKind = z.enum(['cancellation', 'guarantee', 'deposit']);
export type PolicyKind = z.infer<typeof policyKind>;

export const policyInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('cancellation'),
    propertyId: uuid,
    code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().min(1).max(200),
    structure: cancellationStructure,
  }),
  z.object({
    kind: z.literal('guarantee'),
    propertyId: uuid,
    code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().min(1).max(200),
    structure: guaranteeStructure,
  }),
  z.object({
    kind: z.literal('deposit'),
    propertyId: uuid,
    code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().min(1).max(200),
    structure: depositStructure,
  }),
]);
export type PolicyInput = z.output<typeof policyInput>;
export const policyUpdate = z.object({ name: z.string().min(1).max(200).optional(), structure: z.unknown() });

export const policy = z.object({
  id: uuid,
  propertyId: uuid,
  kind: policyKind,
  code: z.string(),
  name: z.string(),
  structure: z.unknown(),
  text: z.string(),
  version: z.number().int(),
});
export type PolicyDto = z.infer<typeof policy>;

// ───────────────────────────── Inclusions, allowances, packages ─────────────────────────────

export const inclusionBasis = z.enum(['per_unit', 'per_person', 'per_adult', 'per_child', 'per_stay']);
export const inclusionRhythm = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('nightly') }),
  z.object({ kind: z.literal('arrival') }),
  z.object({ kind: z.literal('departure') }),
  /** 1-based nights of the stay, e.g. [1, 3]. */
  z.object({ kind: z.literal('days_of_stay'), nights: z.array(z.number().int().min(1).max(366)).min(1) }),
]);
export type InclusionRhythm = z.infer<typeof inclusionRhythm>;

export const inclusionPricing = z.discriminatedUnion('kind', [
  /** Fixed amount per basis unit per occurrence (in the rate plan currency). */
  z.object({
    kind: z.literal('fixed'),
    amountMinor: minorAmount,
    /** per_person / per_child bases: amount per child age band code (adults use amountMinor). */
    childBandAmountsMinor: z.record(z.string(), minorAmount).optional(),
  }),
  /** Percentage of the night price (allocation / revenue split). */
  z.object({ kind: z.literal('percent_of_night'), percent: percent0to100 }),
]);

export const allowanceTerms = z.object({
  kind: z.enum(['monetary', 'quantity']),
  /** Monetary: entitlement per period in minor units. */
  amountMinor: minorAmount.optional(),
  /** Quantity: number of items per period (e.g. 2 spa treatments). */
  quantity: z.number().int().min(1).optional(),
  period: z.enum(['per_night', 'per_stay']),
  perPerson: z.boolean().default(false),
  eligibleChargeCodes: z.array(z.string()).default([]),
  eligibleOutlets: z.array(z.string()).default([]),
  excludedChargeCodes: z.array(z.string()).default([]),
  remainderPolicy: z.enum(['forfeit', 'carry_within_stay']),
  /** Charge code that receives breakage revenue when the remainder is forfeited. */
  breakageChargeCode: z.string().optional(),
});
export type AllowanceTerms = z.output<typeof allowanceTerms>;

export const inclusionInput = z
  .object({
    propertyId: uuid,
    code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
    name: z.string().min(1).max(200),
    kind: z.enum(['component', 'allowance']),
    chargeCode: z.string().min(1).max(50),
    taxCategory: z.string().min(1).max(50),
    pricing: inclusionPricing,
    basis: inclusionBasis,
    rhythm: inclusionRhythm,
    /** included = allocated out of the night price (revenue split); added = charged on top of the price. */
    priceMode: z.enum(['included', 'added']),
    fulfilmentOutlets: z.array(z.string()).default([]),
    /** Tax-relevant outlet kind of the fulfilling outlet (e.g. 'general_sector' outside tourism GST). */
    outletKind: z.string().min(1).max(50).optional(),
    allowance: allowanceTerms.optional(),
  })
  .refine((i) => i.kind !== 'allowance' || i.allowance !== undefined, {
    message: 'An allowance inclusion needs allowance terms.',
    path: ['allowance'],
  });
export type InclusionInput = z.output<typeof inclusionInput>;
export type InclusionDefinition = Omit<InclusionInput, 'propertyId'> & { id: string; version: number };

export const inclusion = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  kind: z.enum(['component', 'allowance']),
  chargeCode: z.string(),
  taxCategory: z.string(),
  pricing: z.unknown(),
  basis: inclusionBasis,
  rhythm: z.unknown(),
  priceMode: z.enum(['included', 'added']),
  fulfilmentOutlets: z.array(z.string()),
  outletKind: z.string().nullable(),
  allowance: z.unknown().nullable(),
  status: z.enum(['active', 'retired']),
  version: z.number().int(),
});

export const mealPlanCode = z
  .string()
  .regex(/^[A-Z0-9_]{2,10}$/, 'Meal plan codes: RO, BB, HB, FB, AI or custom');

export const packageInput = z.object({
  propertyId: uuid,
  code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Set when the package implements a meal plan (BB, HB, FB, AI or custom). */
  mealPlanCode: mealPlanCode.optional(),
  inclusionIds: z.array(uuid).min(1),
});
export type PackageInput = z.output<typeof packageInput>;
export const packageUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  inclusionIds: z.array(uuid).min(1).optional(),
});
export const pkg = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  mealPlanCode: z.string().nullable(),
  inclusionIds: z.array(uuid),
  version: z.number().int(),
});

// ───────────────────────────── Promotions ─────────────────────────────

export const promotionDiscount = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('percent'), percent: percent0to100 }),
  z.object({ kind: z.literal('amount_per_night'), amountMinor: minorAmount }),
  /** "Stay N pay M": for every `stayNights` nights, `freeNights` are free (repeats). */
  z.object({
    kind: z.literal('free_nights'),
    stayNights: z.number().int().min(2).max(60),
    freeNights: z.number().int().min(1).max(30),
    which: z.enum(['cheapest', 'last']).default('cheapest'),
  }),
]);
export type PromotionDiscount = z.output<typeof promotionDiscount>;

export const promotionConditions = z.object({
  promoCode: z.string().min(2).max(50).optional(),
  /** Early booking: booked at least N days before arrival. */
  minAdvanceDays: z.number().int().min(0).optional(),
  /** Last minute: booked at most N days before arrival. */
  maxAdvanceDays: z.number().int().min(0).optional(),
  minNights: z.number().int().min(1).optional(),
  maxNights: z.number().int().min(1).optional(),
  bookingWindow: z.object({ from: localDate.optional(), to: localDate.optional() }).optional(),
  stayWindow: z.object({ from: localDate.optional(), to: localDate.optional() }).optional(),
  blackoutDates: z.array(localDate).default([]),
  channels: z.array(z.string()).optional(),
  unitTypeIds: z.array(uuid).optional(),
  ratePlanIds: z.array(uuid).optional(),
});
export type PromotionConditions = z.output<typeof promotionConditions>;

export const promotionInput = z.object({
  propertyId: uuid,
  code: z.string().regex(/^[A-Z0-9_-]{1,30}$/),
  name: z.string().min(1).max(200),
  discount: promotionDiscount,
  conditions: promotionConditions.default({ blackoutDates: [] }),
  combinability: z.enum(['exclusive', 'stackable']).default('exclusive'),
  /** Stackable promotions combine only with promotions listed here (by code). */
  stackableWith: z.array(z.string()).default([]),
  sequence: z.number().int().min(0).max(1000).default(100),
});
export type PromotionInput = z.output<typeof promotionInput>;
export const promotionUpdate = promotionInput
  .omit({ propertyId: true, code: true })
  .partial()
  .extend({
    status: z.enum(['active', 'paused', 'retired']).optional(),
  });
export const promotion = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  discount: z.unknown(),
  conditions: z.unknown(),
  combinability: z.enum(['exclusive', 'stackable']),
  stackableWith: z.array(z.string()),
  sequence: z.number().int(),
  status: z.enum(['active', 'paused', 'retired']),
  version: z.number().int(),
});

// ───────────────────────────── Rate plans ─────────────────────────────

export const restrictionKind = z.enum([
  'closed',
  'closedToArrival',
  'closedToDeparture',
  'minLos',
  'minLosThrough',
  'maxLos',
  'minAdvanceDays',
  'maxAdvanceDays',
  'salesLimit',
]);
export type RestrictionKind = z.infer<typeof restrictionKind>;
export const RESTRICTION_KINDS = restrictionKind.options;

export const adjustment = z.discriminatedUnion('kind', [
  /** e.g. "-10" for 10% below the parent. */
  z.object({ kind: z.literal('percent'), percent: percentAdjustment }),
  /** e.g. -2000 for 20.00 below the parent (minor units, plan currency). */
  z.object({ kind: z.literal('amount'), amountMinor: signedMinorAmount }),
  /** Percent first, then amount, in one step (e.g. BAR −10% + USD 30). */
  z.object({ kind: z.literal('combined'), percent: percentAdjustment, amountMinor: signedMinorAmount }),
]);
export type Adjustment = z.infer<typeof adjustment>;

export const priceRounding = z.object({
  /** Round derived prices to a multiple of this many minor units (1 = cents, 100 = whole dollars). */
  incrementMinor: z.number().int().min(1).max(1_000_000).default(1),
  mode: roundingMode.default('half_up'),
});
export type PriceRounding = z.output<typeof priceRounding>;

export const derivationInput = z.object({
  parentRatePlanId: uuid,
  adjustment,
  rounding: priceRounding.default({ incrementMinor: 1, mode: 'half_up' }),
  /** Optional per-unit-type differential replacing the plan-level adjustment. */
  unitTypeAdjustments: z.record(z.string(), adjustment).default({}),
  /** Optional bounds for derived unit prices (base, single, occupancy overrides), in minor units. */
  floorMinor: minorAmount.optional(),
  ceilingMinor: minorAmount.optional(),
});
export type DerivationInput = z.output<typeof derivationInput>;

export const inheritance = z.object({
  /** Restriction kinds taken from the parent plan (others are the plan's own values). Sales limits are never inherited. */
  restrictions: z.array(restrictionKind).default(restrictionKind.options.filter((k) => k !== 'salesLimit')),
  cancellationPolicy: z.boolean().default(true),
  guaranteePolicy: z.boolean().default(true),
  depositPolicy: z.boolean().default(true),
  packages: z.boolean().default(true),
});
export type Inheritance = z.output<typeof inheritance>;

export const eligibility = z.object({
  /** Channels allowed to sell the plan; omit = all channels and direct. 'direct' = staff / own booking engine. */
  channels: z.array(z.string().min(1).max(100)).optional(),
  /** Negotiated / contracted: only these companies or agencies (guests profile ids from `guests`). */
  companyIds: z.array(uuid).optional(),
  minAdults: z.number().int().min(1).optional(),
  maxAdults: z.number().int().min(1).optional(),
  maxChildren: z.number().int().min(0).optional(),
  maxGuests: z.number().int().min(1).optional(),
  /** Sell dates (booking date window). */
  sellDates: z.object({ from: localDate.optional(), to: localDate.optional() }).optional(),
  /** Stay dates (nights must fall inside). */
  stayDates: z.object({ from: localDate.optional(), to: localDate.optional() }).optional(),
});
export type Eligibility = z.output<typeof eligibility>;

export const commission = z.object({
  /** commissionable: guest pays the hotel, agency earns commission; net: agency collects, hotel invoices net. */
  model: z.enum(['commissionable', 'net']),
  percent: percent0to100.optional(),
  amountPerNightMinor: minorAmount.optional(),
  base: z.enum(['room_net', 'stay_net', 'stay_gross']).default('room_net'),
});
export type Commission = z.output<typeof commission>;

export const ratePlanStatus = z.enum(['draft', 'active', 'paused', 'retired']);

export const ratePlanInput = z.object({
  propertyId: uuid,
  code: z.string().regex(/^[A-Z0-9_-]{1,30}$/, 'Use capital letters, digits, dashes or underscores'),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  currency: currencyCode.optional(),
  derivation: derivationInput.optional(),
  inherit: inheritance.default({
    restrictions: restrictionKind.options.filter((k) => k !== 'salesLimit'),
    cancellationPolicy: true,
    guaranteePolicy: true,
    depositPolicy: true,
    packages: true,
  }),
  mealPlan: mealPlanCode.default('RO'),
  packageIds: z.array(uuid).default([]),
  cancellationPolicyId: uuid.optional(),
  guaranteePolicyId: uuid.optional(),
  depositPolicyId: uuid.optional(),
  eligibility: eligibility.default({}),
  commission: commission.nullable().default(null),
  taxInclusion: taxInclusion.default({ mode: 'exclusive' }),
  roomChargeCode: z.string().min(1).max(50).default('ROOM'),
  marketSegment: z.string().max(50).optional(),
});
export type RatePlanInput = z.output<typeof ratePlanInput>;

export const ratePlanUpdate = ratePlanInput
  .omit({ propertyId: true, code: true, currency: true })
  .partial()
  .extend({ derivation: derivationInput.nullable().optional() });
export type RatePlanUpdate = z.output<typeof ratePlanUpdate>;

export const ratePlan = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  currency: currencyCode,
  kind: z.enum(['base', 'derived']),
  derivation: derivationInput.nullable(),
  inherit: inheritance,
  mealPlan: z.string(),
  packageIds: z.array(uuid),
  cancellationPolicyId: uuid.nullable(),
  guaranteePolicyId: uuid.nullable(),
  depositPolicyId: uuid.nullable(),
  eligibility,
  commission: commission.nullable(),
  taxInclusion,
  roomChargeCode: z.string(),
  marketSegment: z.string().nullable(),
  status: ratePlanStatus,
  version: z.number().int(),
});
export type RatePlanDto = z.infer<typeof ratePlan>;

export const ratePlanStatusChange = z.object({
  status: ratePlanStatus,
  reason: z.string().max(500).optional(),
});

// ───────────────────────────── Prices (calendar) ─────────────────────────────

export const priceValues = z.object({
  baseOccupancy: z.number().int().min(1).max(20).optional(),
  baseAmountMinor: minorAmount.optional(),
  singleAmountMinor: minorAmount.nullable().optional(),
  extraAdultMinor: minorAmount.nullable().optional(),
  /** Amount per child per night by property child age band code. */
  childAmountsMinor: z.record(z.string(), minorAmount).optional(),
  /** Total price for a specific number of adults (overrides base/extra-adult math). */
  occupancyAmountsMinor: z.record(z.string().regex(/^\d{1,2}$/), minorAmount).optional(),
});
export type PriceValues = z.infer<typeof priceValues>;

export const weekdays = z.array(z.number().int().min(1).max(7)).min(1).max(7);

export const priceBulkUpdate = z
  .object({
    propertyId: uuid,
    ratePlanId: uuid,
    unitTypeIds: z.array(uuid).min(1).max(100),
    /** Half-open stay-date ranges [from, to). */
    ranges: z.array(dateRange).min(1).max(50),
    /** ISO weekdays to include (1 = Monday … 7 = Sunday). Omit = every day. */
    weekdays: weekdays.optional(),
    set: priceValues.optional(),
    /** Relative change to the existing base / single / extra-adult amounts. */
    adjust: adjustment.optional(),
    rounding: priceRounding.optional(),
    reason: z.string().max(500).optional(),
  })
  .refine((u) => (u.set ? 1 : 0) + (u.adjust ? 1 : 0) === 1, {
    message: 'Provide exactly one of set (absolute values) or adjust (relative change).',
  });
export type PriceBulkUpdate = z.output<typeof priceBulkUpdate>;

export const priceCell = z.object({
  ratePlanId: uuid,
  unitTypeId: uuid,
  date: localDate,
  currency: currencyCode,
  baseOccupancy: z.number().int(),
  baseAmountMinor: z.number().int(),
  singleAmountMinor: z.number().int().nullable(),
  extraAdultMinor: z.number().int().nullable(),
  childAmountsMinor: z.record(z.string(), z.number().int()),
  occupancyAmountsMinor: z.record(z.string(), z.number().int()),
  /** Derived plans: computed from the parent, not editable here. */
  derived: z.boolean(),
  derivedFrom: uuid.nullable(),
  version: z.number().int().nullable(),
});
export type PriceCell = z.infer<typeof priceCell>;

export const pricePreview = z.object({
  changes: z.array(
    z.object({
      unitTypeId: uuid,
      date: localDate,
      before: priceCell.nullable(),
      after: priceCell.nullable(),
    }),
  ),
  rejected: z.array(z.object({ unitTypeId: uuid, date: localDate, reason: z.string() })),
  affectedDerivedPlans: z.array(z.object({ ratePlanId: uuid, code: z.string() })),
  summary: z.object({
    cells: z.number().int(),
    unitTypes: z.number().int(),
    nights: z.number().int(),
    derivedPlans: z.number().int(),
    ranges: z.array(z.object({ from: localDate, to: localDate })),
  }),
});
export type PricePreview = z.infer<typeof pricePreview>;

export const priceHistoryEntry = z.object({
  id: uuid,
  changeSetId: uuid,
  ratePlanId: uuid,
  unitTypeId: uuid,
  date: localDate,
  before: z.unknown().nullable(),
  after: z.unknown(),
  changedAt: z.string(),
  changedBy: z.string(),
  reason: z.string().nullable(),
});

// ───────────────────────────── Restrictions ─────────────────────────────

export const restrictionValues = z.object({
  closed: z.boolean().nullable().optional(),
  closedToArrival: z.boolean().nullable().optional(),
  closedToDeparture: z.boolean().nullable().optional(),
  minLos: z.number().int().min(1).max(366).nullable().optional(),
  minLosThrough: z.number().int().min(1).max(366).nullable().optional(),
  maxLos: z.number().int().min(1).max(366).nullable().optional(),
  minAdvanceDays: z.number().int().min(0).max(730).nullable().optional(),
  maxAdvanceDays: z.number().int().min(0).max(730).nullable().optional(),
  salesLimit: z.number().int().min(0).max(10_000).nullable().optional(),
});
export type RestrictionValues = z.infer<typeof restrictionValues>;

export const restrictionBulkUpdate = z.object({
  propertyId: uuid,
  /** null = all rate plans. */
  ratePlanId: uuid.nullable(),
  /** null = all unit types. */
  unitTypeIds: z.array(uuid.nullable()).min(1).max(100),
  ranges: z.array(dateRange).min(1).max(50),
  weekdays: weekdays.optional(),
  /** Set a value; null clears it. Omitted kinds are unchanged. */
  set: restrictionValues,
  reason: z.string().max(500).optional(),
});
export type RestrictionBulkUpdate = z.output<typeof restrictionBulkUpdate>;

export const restrictionCell = z.object({
  ratePlanId: uuid.nullable(),
  unitTypeId: uuid.nullable(),
  date: localDate,
  values: restrictionValues,
  version: z.number().int().nullable(),
});

export const restrictionPreview = z.object({
  changes: z.array(
    z.object({
      ratePlanId: uuid.nullable(),
      unitTypeId: uuid.nullable(),
      date: localDate,
      before: restrictionValues.nullable(),
      after: restrictionValues,
    }),
  ),
  affectedDerivedPlans: z.array(z.object({ ratePlanId: uuid, code: z.string() })),
  summary: z.object({
    cells: z.number().int(),
    ranges: z.array(z.object({ from: localDate, to: localDate })),
  }),
});

// ───────────────────────────── Quotes, offers and agreed terms ─────────────────────────────

export const violationKind = z.enum([
  'closed',
  'closed_to_arrival',
  'closed_to_departure',
  'min_los',
  'min_los_through',
  'max_los',
  'min_advance',
  'max_advance',
  'sales_limit',
  'no_price',
  'no_child_price',
  'occupancy_not_allowed',
  'not_eligible_channel',
  'not_eligible_company',
  'outside_sell_dates',
  'outside_stay_dates',
  'plan_not_active',
  'inclusion_exceeds_price',
  'derived_price_below_zero',
  'tax_computation_failed',
]);
export type ViolationKind = z.infer<typeof violationKind>;

export const violation = z.object({
  kind: violationKind,
  date: localDate.nullable(),
  message: z.string(),
  required: z.number().nullable(),
  actual: z.number().nullable(),
  /** Restriction violations may be overridden by staff with rates.restriction.override; others never. */
  overridable: z.boolean(),
  source: z.object({ ratePlanId: uuid.nullable(), unitTypeId: uuid.nullable() }).nullable(),
});
export type Violation = z.infer<typeof violation>;

export const quoteRequest = z.object({
  propertyId: uuid,
  nights: dateRange,
  occupancy,
  unitTypeIds: z.array(uuid).max(100).optional(),
  ratePlanIds: z.array(uuid).max(100).optional(),
  /** Channel id/code (e.g. an OTA connection). Omit for direct (staff) quotes. */
  channelId: z.string().min(1).max(100).optional(),
  companyId: uuid.optional(),
  promoCode: z.string().min(1).max(50).optional(),
  /** Defaults to today in the property's time zone. */
  bookingDate: localDate.optional(),
  /** Staff only (rates.restriction.override): quote through restriction violations with a reason. */
  restrictionOverride: z.object({ reason: z.string().min(3).max(500) }).optional(),
  /** Packages added to the stay on top of the plan (RAT-R16), e.g. a honeymoon or diving package. */
  addOnPackageIds: z.array(uuid).max(10).optional(),
});
export type QuoteRequest = z.input<typeof quoteRequest>;

const component = z.object({
  kind: z.enum(['room', 'inclusion', 'allowance']),
  inclusionId: uuid.nullable(),
  code: z.string(),
  chargeCode: z.string(),
  taxCategory: z.string(),
  outletKind: z.string().nullable(),
  amount: money,
});
export type PriceComponent = z.infer<typeof component>;

export const occupancyPricing = z.object({
  baseOccupancy: z.number().int(),
  baseAmountMinor: z.number().int(),
  singleAmountMinor: z.number().int().nullable(),
  extraAdultMinor: z.number().int().nullable(),
  childAmountsMinor: z.record(z.string(), z.number().int()),
  occupancyAmountsMinor: z.record(z.string(), z.number().int()),
});
export type OccupancyPricing = z.infer<typeof occupancyPricing>;

export const promotionEffect = z.object({
  promotionId: uuid,
  promotionVersion: z.number().int(),
  code: z.string(),
  kind: z.enum(['percent', 'amount_per_night', 'free_night']),
  /** percent value for percent effects */
  percent: z.string().nullable(),
  /** Discount applied to this night (positive number = reduction). */
  discount: money,
});
export type PromotionEffect = z.infer<typeof promotionEffect>;

export const nightPrice = z.object({
  date: localDate,
  /** Price for the occupancy before promotions. */
  baseAmount: money,
  promotions: z.array(promotionEffect),
  /** Agreed night price (after promotions), in the plan's tax-inclusion mode. */
  amount: money,
  /** Revenue split of the night: room + included components. */
  components: z.array(component),
  /** Occupancy pricing parameters of the (derived) plan for this night — lets occupancy changes be repriced from the agreement. */
  occupancyPricing: occupancyPricing,
  taxes: z.array(taxLine),
  net: money,
  gross: money,
});
export type NightPrice = z.infer<typeof nightPrice>;

export const addedComponent = z.object({
  inclusionId: uuid,
  code: z.string(),
  name: z.string(),
  chargeCode: z.string(),
  taxCategory: z.string(),
  serviceDate: localDate,
  /** The night this component belongs to (for posting with that night). */
  nightDate: localDate,
  quantity: z.number().int(),
  amount: money,
  taxes: z.array(taxLine),
  net: money,
  gross: money,
});
export type AddedComponent = z.infer<typeof addedComponent>;

export const allowanceEntitlement = z.object({
  inclusionId: uuid,
  code: z.string(),
  name: z.string(),
  terms: allowanceTerms,
  periods: z.array(
    z.object({
      periodKey: z.string(),
      from: localDate,
      to: localDate,
      amount: money.nullable(),
      quantity: z.number().int().nullable(),
    }),
  ),
});
export type AllowanceEntitlement = z.infer<typeof allowanceEntitlement>;

export const inclusionSnapshot = z.object({
  id: uuid,
  version: z.number().int(),
  code: z.string(),
  name: z.string(),
  kind: z.enum(['component', 'allowance']),
  chargeCode: z.string(),
  taxCategory: z.string(),
  pricing: inclusionPricing,
  basis: inclusionBasis,
  rhythm: inclusionRhythm,
  priceMode: z.enum(['included', 'added']),
  fulfilmentOutlets: z.array(z.string()),
  outletKind: z.string().nullable(),
  allowance: allowanceTerms.nullable(),
});
export type InclusionSnapshot = z.infer<typeof inclusionSnapshot>;

export const taxSummaryLine = z.object({
  ruleId: uuid,
  ruleCode: z.string(),
  ruleName: z.string(),
  category: z.enum(['tax', 'fee']),
  nature: z.enum(['statutory', 'commercial']),
  basis: taxRuleKind,
  inclusive: z.boolean(),
  ruleVersionIds: z.array(uuid),
  amount: money,
  verificationStatus,
});
export type TaxSummaryLine = z.infer<typeof taxSummaryLine>;

export const totals = z.object({ net: money, taxes: money, fees: money, gross: money, allInTotal: money });
export type Totals = z.infer<typeof totals>;

export const cancellationTierResolved = z.object({
  fromInstant: z.string().nullable(),
  penalty,
  description: z.string(),
});

export const scheduleInstance = z.object({
  kind: z.enum(['deposit', 'preauthorization', 'balance']),
  dueDate: localDate,
  amount: money,
  method: z.enum(['card_on_file', 'payment_request', 'bank_transfer', 'agency_invoice']),
  onOverdue: z.unknown(),
});
export type ScheduleInstance = z.infer<typeof scheduleInstance>;

export const policyRef = z.object({
  id: uuid,
  code: z.string(),
  name: z.string(),
  version: z.number().int(),
  text: z.string(),
});

export const offerPolicies = z.object({
  cancellation: policyRef
    .extend({ structure: cancellationStructure, tiers: z.array(cancellationTierResolved) })
    .nullable(),
  guarantee: policyRef.extend({ structure: guaranteeStructure }).nullable(),
  deposit: policyRef.extend({ structure: depositStructure, schedule: z.array(scheduleInstance) }).nullable(),
});
export type OfferPolicies = z.infer<typeof offerPolicies>;

/**
 * Commission / net terms. commissionable: the guest pays the hotel; the agency earns `amount`. net: the agency
 * collects from the guest and the hotel invoices the agency `invoiceable` (no commission).
 */
export const commissionTerms = commission
  .extend({ amount: money, agencyCollects: z.boolean(), invoiceable: money })
  .nullable();

/** A price override, complimentary or house-use agreement (RAT-R28 "price override details"). */
export const priceOverrideRecord = z.object({
  kind: z.enum(['nightly', 'total', 'complimentary', 'house_use']),
  reason: z.string(),
  by: z.string(),
  at: z.string(),
  /** What the agreement said before the override. */
  original: z.object({ seal: z.string(), totals }),
});

export const TERMS_SCHEMA_VERSION = 1 as const;

/**
 * Agreed terms. Self-contained and versioned: sufficient to post every night later without reading current
 * configuration (brief §5). Reservations persists it; its `hash` lets anyone verify it was not altered.
 */
export const termsSnapshot = z.object({
  schemaVersion: z.literal(TERMS_SCHEMA_VERSION),
  kind: z.literal('portico.rates.terms'),
  quoteId: uuid,
  quotedAt: z.string(),
  configVector: z.string(),
  propertyId: uuid,
  propertyTimezone: z.string(),
  checkInTime: z.string(),
  currency: currencyCode,
  priceSource: z.enum(['portico_quote', 'channel', 'manual_override', 'complimentary', 'house_use']),
  ratePlan: z.object({
    id: uuid,
    code: z.string(),
    name: z.string(),
    version: z.number().int(),
    mealPlan: z.string(),
    roomChargeCode: z.string(),
    marketSegment: z.string().nullable(),
    derivationChain: z.array(z.object({ id: uuid, code: z.string(), version: z.number().int() })),
  }),
  unitTypeId: uuid,
  stay: z.object({ arrival: localDate, departure: localDate, nights: z.number().int() }),
  bookingDate: localDate,
  occupancy,
  childAgeBands: z.array(z.object({ code: z.string(), minAge: z.number(), maxAge: z.number() })),
  taxInclusion,
  nights: z.array(nightPrice),
  addedComponents: z.array(addedComponent),
  allowances: z.array(allowanceEntitlement),
  inclusions: z.array(inclusionSnapshot),
  promotions: z.array(
    z.object({
      id: uuid,
      version: z.number().int(),
      code: z.string(),
      name: z.string(),
      discount: promotionDiscount,
    }),
  ),
  policies: offerPolicies,
  commission: commissionTerms,
  taxes: z.object({
    summary: z.array(taxSummaryLine),
    /** Every rule version used for the quote (statutory ones are re-selected at posting by tax point). */
    ruleVersionIds: z.array(uuid),
    /**
     * Commercial (hotel-set) rule versions of the agreement, e.g. the service charge. Posting passes them as
     * `ChargeLine.agreedRuleVersionIds`, so a later service-charge change never re-prices an agreed stay.
     */
    commercialRuleVersionIds: z.array(uuid),
  }),
  totals,
  restrictionOverride: z
    .object({ reason: z.string(), by: z.string(), at: z.string(), violations: z.array(violation) })
    .nullable(),
  priceOverride: priceOverrideRecord.nullable(),
  supersedesSeal: z.string().nullable(),
  /** HMAC-SHA256 with a server key over the canonical JSON of every other field (forgery-evident). */
  seal: z.string(),
});
export type TermsSnapshot = z.infer<typeof termsSnapshot>;

export const offer = z.object({
  unitTypeId: uuid,
  ratePlanId: uuid,
  ratePlanCode: z.string(),
  ratePlanName: z.string(),
  mealPlan: z.string(),
  currency: currencyCode,
  bookable: z.boolean(),
  nightly: z.array(nightPrice),
  inclusions: z.object({
    included: z.array(
      z.object({ inclusionId: uuid, code: z.string(), name: z.string(), priceMode: z.string() }),
    ),
    added: z.array(addedComponent),
    allowances: z.array(allowanceEntitlement),
  }),
  /** Every tax / fee line of the offer (domain-map shape): one per rule × charge line. */
  taxesAndFees: z.array(taxLine),
  /** The same, summed per rule (display). */
  taxSummary: z.array(taxSummaryLine),
  totals,
  policies: offerPolicies,
  commission: commissionTerms,
  restrictionViolations: z.array(violation),
  overriddenViolations: z.array(violation),
  /** Codes of applied rules not yet confirmed by a qualified adviser (status other than `verified`). */
  unverifiedTaxRules: z.array(z.string()),
  terms: termsSnapshot,
});
export type Offer = z.infer<typeof offer>;

export const quoteResponse = z.object({
  quoteId: uuid,
  configVector: z.string(),
  offers: z.array(offer),
});

export const stayChangeRequest = z
  .object({
    /** New night range. Omit to keep the agreed range. */
    nights: dateRange.optional(),
    occupancy: occupancy.optional(),
    unitTypeId: uuid.optional(),
    /** Change of rate plan: every night is priced on the new plan at current rates, with its policies. */
    ratePlanId: uuid.optional(),
    /** Pricing of nights not in the agreement. Defaults to policy `reservations.repricing.newNights`. */
    newNights: z.enum(['current_rates', 'agreed_average', 'manual']).optional(),
    manualNightAmountsMinor: z.record(z.string(), minorAmount).optional(),
    /** Unit-type change pricing. Defaults to policy `reservations.repricing.typeChange`. */
    typeChange: z.enum(['keep_agreed', 'difference', 'reprice']).optional(),
    /**
     * When the change is evaluated (penalties for removed nights): an ISO instant, or a LocalDate (business date:
     * today → now; another date → 12:00 property time). Anything other than now needs `rates.quote.backdate`.
     */
    asOf: z.union([localDate, z.iso.datetime({ offset: true })]).optional(),
  })
  .strict();
export type StayChangeRequest = z.input<typeof stayChangeRequest>;

export const priceChangeRequest = z.object({ terms: termsSnapshot, change: stayChangeRequest });

export const repricingResult = z.object({
  nightly: z.array(
    z.object({
      date: localDate,
      before: money.nullable(),
      after: money.nullable(),
      source: z.enum([
        'agreed',
        'occupancy_repriced',
        'current_rates',
        'agreed_average',
        'manual',
        'removed',
        'type_difference',
        'type_repriced',
        'plan_changed',
      ]),
      difference: money,
    }),
  ),
  penalties: z.array(
    z.object({
      kind: z.enum(['cancellation', 'early_departure']),
      nights: z.array(localDate),
      amount: money,
      description: z.string(),
    }),
  ),
  before: totals,
  after: totals,
  difference: money,
  violations: z.array(violation),
  /** The NEW sealed agreement for the changed stay (supersedes the old seal). Persist it only on commit. */
  terms: termsSnapshot,
});
export type RepricingResult = z.infer<typeof repricingResult>;

// ───────────────────────────── Misc HTTP shapes ─────────────────────────────

export const propertyQuery = z.object({ propertyId: uuid });
export const calendarQuery = z.object({
  from: localDate,
  to: localDate,
  unitTypeId: uuid.optional(),
});
export const restrictionQuery = z.object({
  propertyId: uuid,
  from: localDate,
  to: localDate,
  ratePlanId: uuid.optional(),
});
export const taxRuleActivation = z.object({
  reason: z.string().min(3).max(500),
  acknowledgeReport: z.boolean(),
});
export const taxTemplateInstall = z.object({
  template: z.enum(['MV']),
  propertyIds: z.array(uuid).nullable().default(null),
});

// ───────────────────────────── Universal record contract (experience-architecture §1) ─────────────────────────────

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
  since: z.string().optional(),
});
export const recordLink = z.object({
  rel: z.string(),
  type: z.string(),
  id: z.string(),
  title: z.string().optional(),
});
const recordParts = {
  status: z.record(z.string(), z.string()),
  allowedActions: z.array(recordAction),
  issues: z.array(recordIssue),
  links: z.array(recordLink),
};

/** Rate plan as a record: `status` per family ({ ratePlan }), next actions, issues and related records. */
export const ratePlanRecord = ratePlan.omit({ status: true }).extend(recordParts);
export type RatePlanRecord = z.infer<typeof ratePlanRecord>;

/** Tax/fee rule as a record: `status` = { taxRule, verification } of the version in force today. */
export const taxRuleRecord = taxRule.omit({ status: true }).extend(recordParts);
export type TaxRuleRecord = z.infer<typeof taxRuleRecord>;

// ───────────────────────────── Provider shapes for consumers (reservations, finance) ─────────────────────────────

export const penaltyEvaluation = z.object({
  event: z.enum(['cancellation', 'no_show', 'early_departure']),
  at: z.string(),
  nights: z.array(localDate),
  /** The tier in force (cancellation) or null = free. */
  tier: z.object({ fromInstant: z.string().nullable(), description: z.string() }).nullable(),
  penalty,
  /** The night amounts the penalty was computed on (by `structure.basis`). */
  basisAmount: money,
  amount: money,
  description: z.string(),
});
export type PenaltyEvaluation = z.infer<typeof penaltyEvaluation>;

export const priceOverrideRequest = z
  .object({
    terms: termsSnapshot,
    override: z.discriminatedUnion('kind', [
      /** New price per night (minor units, plan's tax-inclusion mode); nights not listed keep their price. */
      z.object({ kind: z.literal('nightly'), nightsMinor: z.record(z.string(), minorAmount) }),
      /** New total for all nights, spread over the nights in proportion (largest remainder). */
      z.object({ kind: z.literal('total'), totalMinor: minorAmount }),
      z.object({ kind: z.literal('complimentary') }),
      z.object({ kind: z.literal('house_use') }),
    ]),
    reason: z.string().min(3).max(500),
  })
  .strict();
export type PriceOverrideRequest = z.input<typeof priceOverrideRequest>;

export const rulePackStatus = z.object({
  propertyId: uuid,
  jurisdiction: z.string(),
  /** True only when every rule in force at the property is confirmed by a qualified adviser (`verified`). */
  verified: z.boolean(),
  note: z.string(),
  rules: z.array(
    z.object({
      ruleId: uuid,
      code: z.string(),
      name: z.string(),
      category: z.enum(['tax', 'fee']),
      nature: z.enum(['statutory', 'commercial']),
      versionInForceId: uuid.nullable(),
      verificationStatus: verificationStatus.nullable(),
    }),
  ),
  unverifiedRuleCodes: z.array(z.string()),
});
export type RulePackStatus = z.infer<typeof rulePackStatus>;

export const levyTrueUp = z.object({
  agreedDays: z.number().int(),
  actualDays: z.number().int(),
  deltaDays: z.number().int(),
  lastBlockHours: z.number(),
  /** A levy-only charge line to post through computeTaxes (null when nothing changes). */
  line: chargeLine.nullable(),
});

const effectiveValue = z.object({
  value: z.union([z.number(), z.boolean()]),
  scope: z.enum(['plan', 'all_plans']),
  ratePlanId: uuid.nullable(),
  ratePlanCode: z.string().nullable(),
  inherited: z.boolean(),
  unitTypeSpecific: z.boolean(),
});
/** Effective restrictions of a plan × unit type on one night, with where each value comes from (RAT-R04). */
export const effectiveRestrictionDay = z.object({
  date: localDate,
  values: z.record(z.string(), effectiveValue),
});
