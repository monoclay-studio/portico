import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

/** Permission keys follow docs/specs/integration.md §8 (plus technical.read and simulator.control). */
export const P = {
  catalogueRead: 'integration.catalogue.read',
  connectionRead: 'integration.connection.read',
  connectionManage: 'integration.connection.manage',
  connectionActivate: 'integration.connection.activate',
  credentialsManage: 'integration.credentials.manage',
  mappingReview: 'integration.mapping.review',
  mappingReviewFinancial: 'integration.mapping.reviewFinancial',
  exceptionResolve: 'integration.exception.resolve',
  syncRunTrigger: 'integration.syncRun.trigger',
  technicalRead: 'integration.technical.read',
  webhookManage: 'integration.webhook.manage',
  simulatorControl: 'integration.simulator.control',
} as const;

export const integrationManifest: ModuleManifest = {
  name: 'integration',
  schema: 'integration',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  recordTypes: [
    {
      type: 'integration_connection',
      label: 'Connection',
      readPermission: P.connectionRead,
      route: '/integrations/connections/:id',
    },
    {
      type: 'integration_mapping',
      label: 'Mapping',
      readPermission: P.connectionRead,
      route: '/integrations/mappings/:id',
    },
    {
      type: 'integration_exception',
      label: 'Integration exception',
      readPermission: P.connectionRead,
      route: '/integrations/exceptions/:id',
    },
    {
      type: 'integration_outbound_command',
      label: 'Action sent to another system',
      readPermission: P.connectionRead,
    },
    {
      type: 'integration_webhook_subscription',
      label: 'Webhook subscription',
      readPermission: P.webhookManage,
      route: '/integrations/webhooks/:id',
    },
    { type: 'integration_webhook_delivery', label: 'Webhook delivery', readPermission: P.webhookManage },
  ],
  permissions: [
    {
      key: P.catalogueRead,
      description: 'Browse the integration catalogue (what each connector can and cannot do)',
      scope: 'organization',
    },
    {
      key: P.connectionRead,
      description: 'View connections, setup progress, health, exchange history and integration exceptions',
      scope: 'property',
    },
    {
      key: P.connectionManage,
      description: 'Set up connections (setup journey), pause, resume, disconnect or replace them',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.connectionActivate,
      description: 'Activate a connection’s approved scope (changes which system is the system of record)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.credentialsManage,
      description: 'Enter and rotate connection credentials',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.mappingReview,
      description: 'Confirm, change or ignore mappings (properties, units, rates, statuses)',
      scope: 'property',
    },
    {
      key: P.mappingReviewFinancial,
      description:
        'Confirm financially significant mappings (charge codes, tax rules, ledger accounts, outlets)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.exceptionResolve,
      description:
        'Own, resolve or ignore integration exceptions and decide on actions held for revalidation',
      scope: 'property',
    },
    {
      key: P.syncRunTrigger,
      description:
        'Start a manual synchronization or reconciliation, import a file or generate an export file',
      scope: 'property',
    },
    {
      key: P.technicalRead,
      description: 'See technical detail (payloads, vendor responses) behind exchanges and exceptions',
      scope: 'property',
      sensitive: true,
    },
    {
      key: P.webhookManage,
      description:
        'Create and manage partner webhook subscriptions, rotate signing secrets and replay deliveries',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: P.simulatorControl,
      description: 'Create simulated external systems and control their faults (demonstration and testing)',
      scope: 'organization',
    },
  ],
};
