// Public API contracts for the platform module. No server-only imports here: web apps import this file.
import { z } from 'zod';

export const propertyProfile = z.enum([
  'guesthouse',
  'boutique_hotel',
  'hotel',
  'resort',
  'serviced_apartments',
  'hostel',
]);
export const tenantEnvironment = z.enum(['live', 'trial', 'sandbox', 'training', 'demo']);

const countryCode = z.string().regex(/^[A-Z]{2}$/, 'Use a two-letter ISO country code, e.g. MV');
const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, e.g. USD');

export const organization = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  environment: tenantEnvironment,
  status: z.enum(['active', 'suspended', 'closed']),
  planCode: z.string(),
  defaultLocale: z.string(),
});
export type Organization = z.infer<typeof organization>;

export const legalEntityInput = z.object({
  name: z.string().min(1).max(200),
  legalName: z.string().min(1).max(300),
  registrationNumber: z.string().max(100).optional(),
  taxId: z.string().max(100).optional(),
  countryCode,
  baseCurrency: currencyCode,
  address: z.record(z.string(), z.string()).optional(),
});
export const legalEntity = legalEntityInput.extend({ id: z.uuid(), version: z.number().int() });
export type LegalEntity = z.infer<typeof legalEntity>;

/**
 * Jurisdiction classification consumed by tax & fee rules. Free-form per country; Maldives uses e.g.
 * { "mv.establishmentType": "resort" | "guesthouse" | "hotel" | "vessel", "mv.inhabitedIsland": true, "mv.registeredRooms": 12 }.
 */
export const classification = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const propertyInput = z.object({
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and dashes'),
  name: z.string().min(1).max(200),
  profile: propertyProfile,
  legalEntityId: z.uuid(),
  brandId: z.uuid().optional(),
  regionId: z.uuid().optional(),
  countryCode,
  timezone: z.string().min(1),
  baseCurrency: currencyCode,
  classification: classification.optional(),
  businessDate: z.iso.date(),
  checkInTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  checkOutTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});
export const propertyUpdate = propertyInput
  .omit({ code: true, businessDate: true, legalEntityId: true })
  .partial()
  .extend({
    status: z.enum(['setup', 'pilot', 'active', 'inactive']).optional(),
  });
export const property = propertyInput.extend({
  id: z.uuid(),
  status: z.enum(['setup', 'pilot', 'active', 'inactive']),
  classification,
  checkInTime: z.string(),
  checkOutTime: z.string(),
  version: z.number().int(),
});
export type Property = z.infer<typeof property>;
export type PropertyInput = z.infer<typeof propertyInput>;

export const policyValue = z.object({
  key: z.string(),
  value: z.unknown(),
  source: z.enum(['default', 'organization', 'brand', 'region', 'property']),
  isLocalOverride: z.boolean(),
});
export type ResolvedPolicy = z.infer<typeof policyValue>;

export const dataDomain = z.enum([
  'reservations',
  'availability',
  'rates',
  'guestProfiles',
  'charges',
  'payments',
  'roomStatus',
  'maintenance',
  'accounting',
  'guestCommunications',
]);
export type DataDomain = z.infer<typeof dataDomain>;
export const dataAuthority = z.object({
  domain: dataDomain,
  authority: z.enum(['portico', 'external']),
  connectionId: z.uuid().nullable(),
  systemName: z.string().nullable(),
  writeMode: z.enum(['exclusive', 'forward', 'read_only']),
  isDefault: z.boolean(),
});
export type DataAuthority = z.infer<typeof dataAuthority>;

// ───────────────────────────── Data authority history and transitions (G-01/G-02) ─────────────────────────────

export const authorityChange = z.object({
  domain: dataDomain,
  authority: z.enum(['portico', 'external']),
  connectionId: z.uuid().optional(),
  systemName: z.string().max(200).optional(),
  writeMode: z.enum(['exclusive', 'forward', 'read_only']),
});
export const setDataAuthorityInput = authorityChange.extend({ reason: z.string().min(3).max(1000) });
export const authorityTransitionInput = z.object({
  changes: z.array(authorityChange).min(1).max(10),
  reason: z.string().min(3).max(1000),
  rollbackCriteria: z.string().max(2000).optional(),
  plannedStartAt: z.iso.datetime().optional(),
  freezeMinutes: z.number().int().min(1).max(1440),
});
export const authorityTransition = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  status: z.enum(['planned', 'frozen', 'effective', 'cancelled']),
  changes: z.array(authorityChange),
  reason: z.string(),
  rollbackCriteria: z.string().nullable(),
  freezeMinutes: z.number().int(),
  approvalRequired: z.boolean(),
  plannedBy: z.string(),
  approvedBy: z.string().nullable(),
  frozenAt: z.string().nullable(),
  expectedEndAt: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  version: z.number().int(),
});
export type AuthorityTransition = z.infer<typeof authorityTransition>;
export const authorityHistoryEntry = z.object({
  domain: dataDomain,
  version: z.number().int(),
  authority: z.enum(['portico', 'external']),
  connectionId: z.uuid().nullable(),
  systemName: z.string().nullable(),
  writeMode: z.enum(['exclusive', 'forward', 'read_only']),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  changedBy: z.string(),
  approvedBy: z.string().nullable(),
  reason: z.string(),
  transitionId: z.uuid().nullable(),
});

// ───────────────────────────── Entitlements (plans, add-ons, Connect packs) ─────────────────────────────

export const entitlementGrantInput = z.object({
  kind: z.enum(['add_on', 'pack']),
  key: z.string().min(1).max(100),
  propertyId: z.uuid().optional(),
  reason: z.string().min(3).max(500),
});
export const entitlementSummary = z.object({
  plan: z.object({ code: z.string(), name: z.string() }),
  features: z.array(z.string()),
  limits: z.record(z.string(), z.number().int().nullable()),
  availableAddOns: z.array(z.string()),
  availablePacks: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      features: z.array(z.string()),
      requires: z.array(z.string()),
    }),
  ),
  grants: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['add_on', 'pack']),
      key: z.string(),
      propertyId: z.uuid().nullable(),
      features: z.array(z.string()),
      grantedAt: z.string(),
    }),
  ),
});

// ───────────────────────────── Owners and unit ownership ─────────────────────────────

const noBankData = (v: string) => !/\d{5,}/.test(v.replace(/[\s-]/g, ''));
export const ownerInput = z.object({
  reference: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dots, dashes or underscores'),
  kind: z.enum(['person', 'company']),
  displayName: z.string().min(1).max(200),
  legalName: z.string().max(300).optional(),
  taxId: z.string().max(100).optional(),
  countryCode: countryCode.optional(),
  email: z.email().optional(),
  phone: z.string().max(40).optional(),
  payoutAccountRef: z
    .string()
    .max(200)
    .refine(noBankData, 'Store a reference to the payout account, never the bank account number itself')
    .optional(),
  payoutHint: z
    .string()
    .max(40)
    .refine(noBankData, 'A payout hint may show at most the last 4 digits')
    .optional(),
});
export const ownerUpdate = ownerInput.omit({ reference: true }).partial();
export const owner = ownerInput.extend({
  id: z.uuid(),
  status: z.enum(['active', 'archived']),
  version: z.number().int(),
});
export type Owner = z.infer<typeof owner>;
export type OwnerInput = z.infer<typeof ownerInput>;

export const ownershipShareInput = z.object({
  ownerId: z.uuid(),
  propertyId: z.uuid(),
  unitId: z.uuid(),
  shareBps: z.number().int().min(1).max(10000),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().optional(),
});
export const ownershipShare = ownershipShareInput.extend({
  id: z.uuid(),
  effectiveTo: z.iso.date().nullable(),
  ownerDisplayName: z.string(),
  endReason: z.string().nullable(),
});
export type OwnershipShare = z.infer<typeof ownershipShare>;
export const endShareInput = z.object({ effectiveTo: z.iso.date(), reason: z.string().min(3).max(500) });
export const unitOwnership = z.object({
  unitId: z.uuid(),
  date: z.iso.date(),
  owners: z.array(z.object({ ownerId: z.uuid(), displayName: z.string(), shareBps: z.number().int() })),
  allocatedBps: z.number().int(),
  unallocatedBps: z.number().int(),
});

// ───────────────────────────── Outlets ─────────────────────────────

export const outletKind = z.enum([
  'restaurant',
  'bar',
  'cafe',
  'spa',
  'dive_center',
  'water_sports',
  'excursions',
  'boutique',
  'transfer_desk',
  'minibar',
  'in_room_dining',
  'laundry',
  'kids_club',
  'other',
]);
export const openingInterval = z.object({
  day: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
    z.literal(7),
  ]),
  opens: z.string().regex(/^\d{2}:\d{2}$/),
  closes: z.string().regex(/^\d{2}:\d{2}$/),
});
export const outletInput = z.object({
  code: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Use capital letters, digits and dashes'),
  name: z.string().min(1).max(200),
  kind: outletKind,
  legalEntityId: z.uuid().optional(),
  defaultChargeCodeKey: z.string().max(60).optional(),
  openingHours: z.array(openingInterval).max(50).default([]),
  acceptsRoomCharge: z.boolean().default(false),
});
export const outletUpdate = outletInput.omit({ code: true }).partial();
export const outlet = outletInput.extend({
  id: z.uuid(),
  propertyId: z.uuid(),
  legalEntityId: z.uuid(),
  defaultChargeCodeKey: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  version: z.number().int(),
});
export type Outlet = z.infer<typeof outlet>;
export type OutletInput = z.input<typeof outletInput>;

// ───────────────────────────── Configuration bundles, rollout groups, changes ─────────────────────────────

export const bundleContent = z.object({
  formatVersion: z.number().int(),
  sections: z.record(
    z.string(),
    z.object({
      schemaVersion: z.number().int(),
      items: z.array(z.object({ key: z.string(), value: z.record(z.string(), z.unknown()) })),
    }),
  ),
});
export const bundleExportInput = z.object({
  name: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Use lowercase letters, digits, dots, dashes or underscores'),
  description: z.string().max(1000).optional(),
  sections: z.array(z.string()).optional(),
});
export const bundleImportInput = z.object({
  name: bundleExportInput.shape.name,
  description: z.string().max(1000).optional(),
  content: bundleContent,
});
export const configurationBundle = z.object({
  id: z.uuid(),
  name: z.string(),
  version: z.number().int(),
  description: z.string().nullable(),
  sourceKind: z.enum(['property', 'trial', 'upload']),
  sourceRef: z.string().nullable(),
  checksum: z.string(),
  createdAt: z.string(),
  content: bundleContent,
});
export const rolloutStage = z.enum(['pilot', 'wave1', 'wave2', 'wave3', 'wave4', 'final']);
export const rolloutGroupInput = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(200),
  stage: rolloutStage,
  propertyIds: z.array(z.uuid()).max(500).default([]),
});
export const rolloutGroup = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  stage: rolloutStage,
  propertyIds: z.array(z.uuid()),
  version: z.number().int(),
});
export const configurationChangeInput = z.object({
  bundleId: z.uuid(),
  propertyIds: z.array(z.uuid()).min(1).max(500).optional(),
  rolloutGroupId: z.uuid().optional(),
  sections: z.array(z.string()).optional(),
  mode: z.enum(['preserve_local', 'overwrite']).default('preserve_local'),
});
const plannedItem = z.object({
  key: z.string(),
  action: z.enum(['create', 'update', 'unchanged', 'local_preserved', 'conflict']),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  note: z.string().optional(),
});
export const configurationPlan = z.array(
  z.object({
    propertyId: z.uuid(),
    propertyName: z.string(),
    sections: z.array(z.object({ section: z.string(), items: z.array(plannedItem) })),
  }),
);
export const configurationChange = z.object({
  id: z.uuid(),
  bundleId: z.uuid(),
  rolloutGroupId: z.uuid().nullable(),
  targetPropertyIds: z.array(z.uuid()),
  sections: z.array(z.string()),
  mode: z.enum(['preserve_local', 'overwrite']),
  status: z.enum(['pending_approval', 'approved', 'applied', 'rejected', 'cancelled']),
  approvalRequired: z.boolean(),
  plan: configurationPlan,
  summary: z.object({
    properties: z.number().int(),
    create: z.number().int(),
    update: z.number().int(),
    unchanged: z.number().int(),
    localPreserved: z.number().int(),
    conflicts: z.number().int(),
  }),
  preparedBy: z.string(),
  approvedBy: z.string().nullable(),
  appliedAt: z.string().nullable(),
  version: z.number().int(),
});
export const decisionInput = z.object({ note: z.string().max(2000).optional() });

// ───────────────────────────── Environments and trials ─────────────────────────────

export const environmentInfo = z.object({
  organizationId: z.uuid(),
  environment: tenantEnvironment,
  banner: z.object({ title: z.string(), detail: z.string() }).nullable(),
  effects: z.record(z.string(), z.enum(['live', 'sandbox', 'simulate', 'blocked'])),
  /** Provenance of data imported into this organization (trial copies are `copied`). */
  importedDataProvenance: z.enum(['live', 'copied', 'simulated']),
  trial: z
    .object({
      sourceOrganizationId: z.uuid().nullable(),
      prospectName: z.string().nullable(),
      status: z.enum(['active', 'closed']),
      lastCopiedAt: z.string().nullable(),
      resetCount: z.number().int(),
      lastResetAt: z.string().nullable(),
      deletionDueAt: z.string().nullable(),
    })
    .nullable(),
});
export const createTrialInput = z.object({ name: z.string().min(1).max(200) });
export const linkedEnvironment = z.object({
  organizationId: z.uuid(),
  environment: z.enum(['trial', 'training', 'sandbox']),
  name: z.string(),
  status: z.string(),
  createdAt: z.string(),
});
export const trialImportInput = z.object({
  sourceSystem: z.string().min(1).max(200),
  copiedAt: z.iso.datetime(),
  recordCounts: z.record(z.string(), z.number().int().min(0)).default({}),
});
export const resetTrialInput = z.object({
  reason: z.string().min(3).max(500),
  confirmOrganizationName: z.string(),
});
export const closeTrialInput = resetTrialInput;
export const pullTrialConfigurationInput = z.object({
  trialOrganizationId: z.uuid(),
  trialPropertyId: z.uuid(),
  bundleName: bundleExportInput.shape.name,
  sections: z.array(z.string()).optional(),
});

// ───────────────────────────── Property activation ─────────────────────────────

export const externalEffect = z.enum([
  'payment.charge',
  'message.guest',
  'message.staff',
  'channel.publish',
  'government.submit',
  'ai.inference',
  'credentials.production',
  'access.key',
  'integration.read',
  'integration.write',
]);
export const activationScopeContent = z.object({
  allEffects: z.boolean().optional(),
  effects: z
    .array(
      z.object({
        effect: externalEffect,
        connectionIds: z.array(z.uuid()).max(50).optional(),
        workflows: z.array(z.string().max(100)).max(100).optional(),
      }),
    )
    .max(20)
    .default([]),
  workflows: z.array(z.string().max(100)).max(200).default([]),
  modules: z.array(z.string().max(60)).max(50).default([]),
  participantUserIds: z.array(z.uuid()).max(500).optional(),
  startsOn: z.iso.date().optional(),
  endsOn: z.iso.date().optional(),
  successCriteria: z.string().max(4000).optional(),
  rollbackPlan: z.string().max(4000).optional(),
  guestScope: z.string().max(2000).optional(),
  supportContacts: z.string().max(2000).optional(),
});
export const propertyStatus = z.enum(['setup', 'pilot', 'active', 'inactive']);
export const statusChangeRequestInput = z.object({
  toStatus: z.enum(['pilot', 'active']),
  reason: z.string().min(3).max(2000),
  scope: activationScopeContent.optional(),
});
export const scopeChangeRequestInput = z.object({
  stage: z.enum(['pilot', 'production']),
  scope: activationScopeContent,
  reason: z.string().min(3).max(2000),
});
export const directStatusChangeInput = z.object({
  toStatus: z.enum(['setup', 'inactive']),
  reason: z.string().min(3).max(2000),
});
export const checklistItem = z.object({
  key: z.string(),
  label: z.string(),
  level: z.enum(['blocker', 'warning']),
  passed: z.boolean(),
  detail: z.string().optional(),
});
export const activationRequest = z.object({
  id: z.uuid(),
  propertyId: z.uuid(),
  kind: z.enum(['status_change', 'scope_change']),
  fromStatus: z.string(),
  toStatus: propertyStatus.nullable(),
  scopeStage: z.enum(['pilot', 'production']).nullable(),
  scope: activationScopeContent.nullable(),
  reason: z.string(),
  checklist: z.array(checklistItem),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']),
  requestedBy: z.string(),
  decidedBy: z.string().nullable(),
  decisionNote: z.string().nullable(),
  version: z.number().int(),
});
export type ActivationRequest = z.infer<typeof activationRequest>;
export const activationOverview = z.object({
  propertyId: z.uuid(),
  status: propertyStatus,
  allowedTransitions: z.array(propertyStatus),
  scopes: z.object({
    pilot: z
      .object({ version: z.number().int(), content: activationScopeContent, approvedBy: z.string() })
      .nullable(),
    production: z
      .object({ version: z.number().int(), content: activationScopeContent, approvedBy: z.string() })
      .nullable(),
  }),
  pendingRequest: activationRequest.nullable(),
  history: z.array(
    z.object({
      fromStatus: z.string(),
      toStatus: z.string(),
      requestedBy: z.string(),
      approvedBy: z.string().nullable(),
      reason: z.string(),
      changedAt: z.string(),
    }),
  ),
});
