import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const paymentsManifest: ModuleManifest = {
  name: 'payments',
  schema: 'payments',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  permissions: [
    {
      key: 'payments.payment.read',
      description: 'View payments, authorizations, refunds, payment status and payment exceptions',
      scope: 'property',
    },
    {
      key: 'payments.payment.collect',
      description:
        'Take card authorizations, captures and charges; record terminal, cash and bank-transfer payments',
      scope: 'property',
    },
    {
      key: 'payments.payment.refund',
      description: 'Refund payments (money leaves the hotel)',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'payments.paymentRequest.create',
      description: 'Create and cancel payment requests (links) for guests',
      scope: 'property',
    },
    {
      key: 'payments.method.manage',
      description: 'Save and detach tokenized payment methods (never card numbers)',
      scope: 'property',
    },
    { key: 'payments.vcc.manage', description: 'Register and charge OTA virtual cards', scope: 'property' },
    {
      key: 'payments.reconciliation.manage',
      description: 'Import settlement statements, resolve payment exceptions, record corrections',
      scope: 'property',
      sensitive: true,
    },
    {
      key: 'payments.dispute.manage',
      description: 'Work disputes (chargebacks): evidence, accept',
      scope: 'property',
      sensitive: true,
    },
    { key: 'payments.account.read', description: 'View payment accounts and provider health', scope: 'organization' },
    {
      key: 'payments.account.manage',
      description: 'Create and change payment accounts of legal entities (merchant of record)',
      scope: 'organization',
      sensitive: true,
    },
    {
      key: 'payments.payout.manage',
      description: 'Record payouts from providers to the hotel bank',
      scope: 'organization',
      sensitive: true,
    },
  ],
};
