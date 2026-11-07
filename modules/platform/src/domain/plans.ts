/**
 * Monoclay's commercial plans (editions). Plans grant features and limits; prices are NOT here (owner decision,
 * OPEN_QUESTIONS Q3). Feature keys are stable identifiers used across modules; see docs/product/editions.md.
 */
export interface PlanDefinition {
  code: string;
  name: string;
  features: readonly string[];
  limits: Readonly<Record<string, number | null>>; // null = unlimited
}

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
] as const;

export const PLANS: readonly PlanDefinition[] = [
  {
    code: 'essentials',
    name: 'Essentials',
    features: [...CORE],
    limits: { 'limits.properties': 1, 'limits.units': 40, 'limits.users': 15 },
  },
  {
    code: 'professional',
    name: 'Professional',
    features: [
      ...CORE,
      'groups.blocks',
      'finance.receivables',
      'rates.packages',
      'comms.automation',
      'api.public',
      'integration.pos',
    ],
    limits: { 'limits.properties': 3, 'limits.units': 300, 'limits.users': 150 },
  },
  {
    code: 'resort',
    name: 'Resort',
    features: [
      ...CORE,
      'groups.blocks',
      'groups.events',
      'finance.receivables',
      'rates.packages',
      'comms.automation',
      'api.public',
      'integration.pos',
      'resort.mealPlans',
      'resort.transfers',
      'resort.activities',
      'resort.outlets',
      'ai.assistant',
    ],
    limits: { 'limits.properties': 5, 'limits.units': 1000, 'limits.users': 600 },
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    features: [
      ...CORE,
      'groups.blocks',
      'groups.events',
      'finance.receivables',
      'rates.packages',
      'comms.automation',
      'api.public',
      'integration.pos',
      'resort.mealPlans',
      'resort.transfers',
      'resort.activities',
      'resort.outlets',
      'ai.assistant',
      'portfolio.policies',
      'portfolio.crossPropertyProfiles',
      'portfolio.consolidatedReporting',
      'identity.sso',
      'owners.accounting',
    ],
    limits: { 'limits.properties': null, 'limits.units': null, 'limits.users': null },
  },
];

export function planByCode(code: string): PlanDefinition | undefined {
  return PLANS.find((p) => p.code === code);
}
