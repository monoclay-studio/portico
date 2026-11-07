/**
 * The connector catalogue: built connectors (simulated PMS, CSV files, partner webhooks) plus PLANNED entries
 * listed honestly so hotels can see what is coming and what it depends on. Planned entries cannot be connected,
 * their workflows are "unverified", their costs say "quote required" unless a dated source exists, and their
 * external approval is "not started". Sources: docs/readiness/dependency-register.md,
 * docs/readiness/channel-capability-matrix.md, docs/research/01..04.
 */
import { FILE_CSV_KEY, fileCsvAdapter, fileCsvDefinition } from './file-csv';
import { PmsSimulatorHub, pmsSimulatorAdapter, pmsSimulatorDefinition } from './pms-simulator';
import { type ConnectorDefinition, ConnectorRegistry, type WorkflowDefinition } from './sdk';

export const WEBHOOKS_OUTBOUND_KEY = 'webhooks.outbound';

export const webhooksOutboundDefinition: ConnectorDefinition = {
  key: WEBHOOKS_OUTBOUND_KEY,
  name: 'Partner webhooks',
  category: 'dataPlatform',
  vendor: { name: 'Any partner application with an HTTPS endpoint' },
  products: [{ name: 'Portico webhooks', versions: ['v1 (thin events, HMAC-SHA256 signatures)'] }],
  regions: ['global'],
  accessModel: 'public_api',
  localConnectorRequired: false,
  localConnectorNote: null,
  credentialSchema: null,
  credentialFields: [],
  vendorSetupSteps: [
    'The partner provides an HTTPS endpoint that answers 2xx within 10 seconds.',
    'Portico shows a signing secret once; the partner verifies the Portico-Signature header on every request.',
    'Events are thin (type, ids, time): the partner fetches details through the API with its own permissions.',
  ],
  prerequisites: ['An administrator with integration.webhook.manage.'],
  workflows: [
    {
      workflow: 'webhooks',
      label: 'Partner notifications',
      description: 'Notify partner applications when bookings, stays, rooms, invoices or connections change.',
      operations: ['create'],
      sync: 'realtime',
      status: 'supported',
      limitations: [
        'Delivery is at least once: partners must ignore repeats using the Portico-Event-Id header.',
        'Order is not guaranteed; partners should fetch the current state.',
        'Retries stop after 8 attempts (about 21 hours); an endpoint failing 10 times in a row is disabled.',
      ],
      dataDomain: null,
      whenUnavailable: 'Deliveries are retried with backoff and can be replayed by an administrator.',
      freshnessTargetSeconds: 60,
      expectedIntervalSeconds: null,
      sequentialRevisions: false,
      mappedFields: [],
      effects: {},
    },
  ],
  governableDomains: [],
  costNotes: ['No cost.'],
  implementation: {
    level: 'R3',
    label: 'Implemented and tested internally',
    evidence: [
      'modules/integration/test/webhooks.test.ts — signatures, retries, disable, replay, environment safety.',
    ],
  },
  externalApproval: {
    status: 'not_required',
    note: 'Partners subscribe themselves under the hotel’s control.',
  },
  provenance: 'live',
  isSimulator: false,
  fileBased: false,
  setupPath: 'webhook_subscriptions',
  support: {
    vendor: 'The partner, for its endpoint.',
    escalation: 'Monoclay support for delivery problems.',
  },
  vendorNotices: [],
};

function plannedWorkflow(
  workflow: string,
  label: string,
  operations: WorkflowDefinition['operations'],
  sync: WorkflowDefinition['sync'],
  dataDomain: WorkflowDefinition['dataDomain'],
  limitation: string,
): WorkflowDefinition {
  return {
    workflow,
    label,
    description: `${label} — planned, not built.`,
    operations,
    sync,
    status: 'unverified',
    limitations: [limitation],
    dataDomain,
    whenUnavailable: 'Not available yet: keep using the existing system for this workflow.',
    freshnessTargetSeconds: null,
    expectedIntervalSeconds: null,
    sequentialRevisions: false,
    mappedFields: [],
    effects: {},
  };
}

const PLANNED_COMMON = {
  credentialSchema: null,
  credentialFields: [],
  prerequisites: [],
  governableDomains: [],
  isSimulator: false,
  fileBased: false,
  setupPath: 'not_available' as const,
  provenance: 'live' as const,
  vendorNotices: [],
  implementation: { level: 'R1' as const, label: 'Planned — no code yet', evidence: [] },
};

export const PLANNED_CONNECTORS: readonly ConnectorDefinition[] = [
  {
    ...PLANNED_COMMON,
    key: 'channel.channex',
    name: 'Channex (channel manager hub)',
    category: 'channel',
    vendor: { name: 'Channex', note: 'White-label channel API; owner decision D7 (connectivity hub first).' },
    products: [{ name: 'Channex API', versions: ['v1'] }],
    regions: ['global'],
    accessModel: 'partner_program',
    localConnectorRequired: false,
    localConnectorNote: null,
    vendorSetupSteps: [
      'Monoclay holds the Channex contract and certification (not started).',
      'The hotel authorizes the connectivity provider in each OTA extranet (per OTA; unconfirmed).',
    ],
    workflows: [
      plannedWorkflow(
        'availability',
        'Availability',
        ['create', 'update'],
        'realtime',
        'availability',
        'Requires Channex PMS certification.',
      ),
      plannedWorkflow(
        'rates',
        'Rates and restrictions',
        ['create', 'update'],
        'realtime',
        'rates',
        'Requires Channex PMS certification.',
      ),
      plannedWorkflow(
        'reservations',
        'OTA reservations',
        ['receive'],
        'realtime',
        'reservations',
        'Booking revisions feed with acknowledgement (documented by Channex; not built).',
      ),
    ],
    costNotes: [
      'Planning baseline checked 2026-11-07 (verify before purchase): $130/month platform fee + $7/month per property with an active channel; VAT and extras additional (docs/readiness/channel-capability-matrix.md §1).',
    ],
    externalApproval: {
      status: 'not_started',
      note: 'Channex PMS certification and contract not started (dependency register 3.1).',
    },
    support: { vendor: 'Channex support (via Monoclay).', escalation: 'Monoclay support.' },
  },
  {
    ...PLANNED_COMMON,
    key: 'pms.opera-cloud',
    name: 'OPERA Cloud via OHIP',
    category: 'pms',
    vendor: { name: 'Oracle Hospitality' },
    products: [{ name: 'OPERA Cloud', versions: ['unverified'] }],
    regions: ['global'],
    accessModel: 'partner_program',
    localConnectorRequired: false,
    localConnectorNote:
      'OPERA 5.x on-premise would need a local connector or a file-based route (unconfirmed).',
    vendorSetupSteps: ['Partner access to the Oracle Hospitality Integration Platform (not applied).'],
    workflows: [
      plannedWorkflow(
        'reservations',
        'Reservations',
        ['read', 'receive'],
        'realtime',
        'reservations',
        'Partner access required; not built.',
      ),
      plannedWorkflow(
        'roomStatus',
        'Room status',
        ['read', 'update'],
        'realtime',
        'roomStatus',
        'Partner access required; not built.',
      ),
      plannedWorkflow(
        'charges',
        'Guest charges',
        ['read', 'create'],
        'realtime',
        'charges',
        'Partner access required; not built.',
      ),
    ],
    costNotes: [
      'Quote required: the partner pays OHIP usage; amounts unconfirmed (dependency register 6.8).',
    ],
    externalApproval: { status: 'not_started', note: 'Oracle partner access not applied for.' },
    support: { vendor: 'Oracle (hotel’s support contract).', escalation: 'Monoclay support.' },
  },
  {
    ...PLANNED_COMMON,
    key: 'accounting.erp',
    name: 'Accounting / ERP (API)',
    category: 'accounting',
    vendor: { name: 'Various (Xero, QuickBooks, NetSuite, SAP — unconfirmed per vendor)' },
    products: [{ name: 'Accounting APIs', versions: ['unverified'] }],
    regions: ['global'],
    accessModel: 'partner_program',
    localConnectorRequired: false,
    localConnectorNote: null,
    vendorSetupSteps: ['Vendor app-partner terms (unconfirmed). Until then use the CSV journal export.'],
    workflows: [
      plannedWorkflow(
        'journals',
        'Daily journals',
        ['create'],
        'periodic',
        'accounting',
        'Use the CSV file export meanwhile.',
      ),
    ],
    costNotes: ['Quote required: hotel licences and possible partner fees (dependency register 6.3).'],
    externalApproval: { status: 'not_started', note: 'App partner terms not started.' },
    support: { vendor: 'Accounting vendor.', escalation: 'Monoclay support.' },
  },
  {
    ...PLANNED_COMMON,
    key: 'doorLock.encoders',
    name: 'Door locks and key encoders',
    category: 'doorLock',
    vendor: { name: 'Various (ASSA ABLOY Vingcard, Salto, dormakaba — unconfirmed)' },
    products: [{ name: 'Lock management systems', versions: ['unverified'] }],
    regions: ['global'],
    accessModel: 'on_prem_interface',
    localConnectorRequired: true,
    localConnectorNote:
      'Key encoders sit on the hotel network and cannot talk to cloud services directly: a small on-site connector would be required. Installation, updates and outage behavior are not defined yet.',
    vendorSetupSteps: [
      'Vendor SDK and licence (unconfirmed). Meanwhile encode keys in the lock vendor’s own software.',
    ],
    workflows: [
      plannedWorkflow(
        'keys',
        'Key issuance',
        ['create'],
        'realtime',
        null,
        'Requires vendor SDK and an on-site connector.',
      ),
    ],
    costNotes: ['Quote required: vendor licence and on-site hardware.'],
    externalApproval: { status: 'not_started', note: 'Vendor SDK/licensing not started.' },
    support: { vendor: 'Lock vendor.', escalation: 'Monoclay support.' },
  },
];

export interface ConnectorDeps {
  pmsSimulator: PmsSimulatorHub;
}

/** The registry with every built connector and the planned entries. */
export function createConnectorRegistry(deps: ConnectorDeps): ConnectorRegistry {
  const registry = new ConnectorRegistry()
    .register(pmsSimulatorDefinition, pmsSimulatorAdapter(deps.pmsSimulator))
    .register(fileCsvDefinition, fileCsvAdapter())
    .register(webhooksOutboundDefinition, null);
  for (const p of PLANNED_CONNECTORS) registry.register(p, null);
  return registry;
}

export { FILE_CSV_KEY, PmsSimulatorHub };
