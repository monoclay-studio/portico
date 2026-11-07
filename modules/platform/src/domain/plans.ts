/**
 * Monoclay's commercial plans (editions), add-ons and Connect module packs. Plans grant features and limits;
 * prices are NOT here (owner decision, OPEN_QUESTIONS Q3). Feature keys are stable identifiers used across modules;
 * the canonical list and the reasoning live in docs/product/editions.md (§4 matrix, §5 packs, §7 reconciliation).
 *
 * Principles applied (editions.md §2): correctness, safety and trust are never gated (MFA, audit, previews, data
 * export, trial/training environments, data authority/connected mode); staff accounts are not limited (shared
 * logins destroy attribution); usage that costs money (messages, AI) is metered and capped, not bundled.
 */
export interface PlanDefinition {
  code: string;
  name: string;
  features: readonly string[];
  limits: Readonly<Record<string, number | null>>; // null = unlimited / set by contract
  /** Feature keys the organization may buy on top of the plan (organization- or property-scoped grants). */
  addOns: readonly string[];
  /** Connect module packs the organization may buy (only the Connect plan offers packs). */
  packs: readonly string[];
}

/** A Connect module pack: a bundle of feature keys with the connector workflows it depends on (editions.md §5). */
export interface ModulePack {
  key: string;
  name: string;
  features: readonly string[];
  /** Plain-language dependencies on the hotel's existing systems, shown before purchase. */
  requires: readonly string[];
}

export const MODULE_PACKS: readonly ModulePack[] = [
  {
    key: 'pack.housekeepingMaintenance',
    name: 'Housekeeping & Maintenance',
    features: ['core.housekeeping', 'core.maintenance', 'operations.assets'],
    requires: ['PMS reservations: read', 'PMS roomStatus: update (recommended)'],
  },
  {
    key: 'pack.guestCommunications',
    name: 'Guest Communications',
    features: ['comms.inbox', 'comms.automation'],
    requires: ['PMS reservations: read', 'PMS guestProfiles: read'],
  },
  {
    key: 'pack.reporting',
    name: 'Reporting',
    features: ['core.reports', 'analytics.customReports'],
    requires: ['PMS reservations: read', 'PMS journals/folios: read (for revenue reports)'],
  },
  {
    key: 'pack.experiences',
    name: 'Experiences',
    features: ['resort.transfers', 'resort.activities', 'resort.itinerary'],
    requires: ['PMS reservations: read', 'PMS posCharges: create (to bill to the PMS folio)'],
  },
  {
    key: 'pack.payments',
    name: 'Payments',
    features: ['core.payments'],
    requires: ['PMS reservations: read', 'PMS payments: create (to post to the PMS folio)'],
  },
  {
    key: 'pack.salesEvents',
    name: 'Sales & Events',
    features: ['groups.salesPipeline', 'groups.events'],
    requires: ['None for events; group blocks need the full PMS'],
  },
];

/** Every edition (editions.md §4.1). */
const CORE = [
  'core.reservations',
  'core.frontDesk',
  'core.housekeeping',
  'core.maintenance',
  'core.folios',
  'core.payments',
  'core.dayClose',
  'core.guestProfiles',
  'core.reports',
  'distribution.channelManager',
  'distribution.bookingEngine',
  'comms.inbox',
  'comms.automation',
  'finance.receivables',
  'api.public',
] as const;

const PROFESSIONAL = [
  ...CORE,
  'inventory.overbooking',
  'rates.packages',
  'finance.creditControl',
  'groups.blocks',
  'groups.allotments',
  'groups.salesPipeline',
  'groups.events',
  'integration.pos',
  'operations.assets',
  'analytics.customReports',
  'portfolio.crossPropertyProfiles',
] as const;

const RESORT = [
  ...PROFESSIONAL,
  'resort.outlets',
  'resort.mealPlans',
  'resort.transfers',
  'resort.activities',
  'resort.itinerary',
  'resort.weatherDisruptions',
] as const;

const ENTERPRISE = [
  ...RESORT,
  'owners.accounting',
  'analytics.warehouseSync',
  'api.eventStream',
  'portfolio.policies',
  'portfolio.consolidatedReporting',
  'portfolio.centralReservations',
  'identity.sso',
  'identity.scim',
] as const;

/** Add-ons available in every edition (metered or separately contracted). */
const UNIVERSAL_ADD_ONS = ['ai.assistant', 'payments.embedded', 'distribution.aggregatedChannels'] as const;
const EXPERIENCE_ADD_ONS = ['resort.transfers', 'resort.activities', 'resort.itinerary'] as const;

export const PLANS: readonly PlanDefinition[] = [
  {
    code: 'essentials',
    name: 'Essentials',
    features: [...CORE],
    limits: {
      'limits.properties': 1,
      'limits.units': 40,
      'limits.apiRequestsPerMinute': 120,
      'limits.environments.training': 1,
      'limits.environments.sandbox': 0,
    },
    addOns: [...UNIVERSAL_ADD_ONS, ...EXPERIENCE_ADD_ONS],
    packs: [],
  },
  {
    code: 'professional',
    name: 'Professional',
    features: [...PROFESSIONAL],
    limits: {
      'limits.properties': 3,
      'limits.units': 300,
      'limits.apiRequestsPerMinute': 600,
      'limits.environments.training': 1,
      'limits.environments.sandbox': 1,
    },
    addOns: [
      ...UNIVERSAL_ADD_ONS,
      ...EXPERIENCE_ADD_ONS,
      'owners.accounting',
      'analytics.warehouseSync',
      'api.eventStream',
    ],
    packs: [],
  },
  {
    code: 'resort',
    name: 'Resort',
    features: [...RESORT],
    limits: {
      'limits.properties': 5,
      'limits.units': 1000,
      'limits.apiRequestsPerMinute': 600,
      'limits.environments.training': 1,
      'limits.environments.sandbox': 1,
    },
    addOns: [...UNIVERSAL_ADD_ONS, 'owners.accounting', 'analytics.warehouseSync', 'api.eventStream'],
    packs: [],
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    features: [...ENTERPRISE],
    limits: {
      'limits.properties': null,
      'limits.units': null,
      'limits.apiRequestsPerMinute': 3000,
      'limits.environments.training': 3,
      'limits.environments.sandbox': 3,
    },
    addOns: [...UNIVERSAL_ADD_ONS, 'distribution.gds'],
    packs: [],
  },
  {
    // Proposed (editions.md §5): hotels keeping their PMS adopt selected modules. No core PMS keys; capabilities come
    // from packs. Integration (catalogue, connections, data authority) is never gated, and the public API is included.
    code: 'connect',
    name: 'Connect',
    features: ['api.public'],
    limits: {
      'limits.properties': null,
      'limits.units': null,
      'limits.apiRequestsPerMinute': 600,
      'limits.environments.training': 1,
      'limits.environments.sandbox': 1,
    },
    addOns: [...UNIVERSAL_ADD_ONS],
    packs: MODULE_PACKS.map((p) => p.key),
  },
];

export function planByCode(code: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.code === code);
}

export function packByKey(key: string): ModulePack | undefined {
  return MODULE_PACKS.find((p) => p.key === key);
}

/** Whether a grant key (feature add-on or pack) may be bought on top of a plan. */
export function grantableOn(plan: PlanDefinition, kind: 'add_on' | 'pack', key: string): boolean {
  return kind === 'add_on' ? plan.addOns.includes(key) : plan.packs.includes(key);
}

/** Feature keys a grant provides (an add-on grants itself; a pack grants its bundle). */
export function featuresOfGrant(kind: 'add_on' | 'pack', key: string): readonly string[] {
  if (kind === 'add_on') return [key];
  return packByKey(key)?.features ?? [];
}
