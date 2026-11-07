import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest } from '@portico/kernel';

export const paymentsManifest: ModuleManifest = {
  name: 'payments',
  schema: 'payments',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  // payments.route_webhook() calls the platform.tenant_environment() SECURITY DEFINER lookup.
  migrateAfter: ['platform'],
  permissions: [
    {
      key: 'payments.payment.read',
      description: 'View payments, authorizations, refunds, payment status and payment exceptions',
      scope: 'property',
    },
    {
      key: 'payments.payment.collect',
      description: 'Take card authorizations, captures and charges through the payment provider',
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
      key: 'payments.externalRecord.create',
      description:
        "Record payments taken outside Portico: the hotel's own terminal, cash, expected bank transfers",
      scope: 'property',
    },
    {
      key: 'payments.bankTransfer.confirm',
      description: 'Confirm that an expected bank transfer was received (it is then posted to the bill)',
      scope: 'property',
      sensitive: true,
    },
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
    {
      key: 'payments.account.read',
      description: 'View payment accounts and provider health',
      scope: 'organization',
    },
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
  // Universal record contract: `type` equals the audit `target.type` used by this module.
  recordTypes: [
    {
      type: 'payment',
      label: 'Payment',
      readPermission: 'payments.payment.read',
      route: '/payments/transactions/:id',
    },
    {
      type: 'authorization',
      label: 'Card authorization (hold)',
      readPermission: 'payments.payment.read',
      route: '/payments/authorizations/:id',
    },
    {
      type: 'refund',
      label: 'Refund',
      readPermission: 'payments.payment.read',
      route: '/payments/refunds/:id',
    },
    {
      type: 'payment_request',
      label: 'Payment request',
      readPermission: 'payments.payment.read',
      route: '/payments/requests/:id',
    },
    { type: 'payment_method', label: 'Saved payment method', readPermission: 'payments.payment.read' },
    {
      type: 'virtual_card',
      label: 'Virtual card (OTA)',
      readPermission: 'payments.payment.read',
      route: '/payments/virtual-cards/:id',
    },
    {
      type: 'dispute',
      label: 'Dispute (chargeback)',
      readPermission: 'payments.payment.read',
      route: '/payments/disputes/:id',
    },
    { type: 'payment_exception', label: 'Payment exception', readPermission: 'payments.payment.read' },
    {
      type: 'payment_account',
      label: 'Payment account',
      readPermission: 'payments.account.read',
      route: '/payments/accounts/:id',
    },
    { type: 'payout', label: 'Payout', readPermission: 'payments.account.read' },
    {
      type: 'statement',
      label: 'Settlement statement import',
      readPermission: 'payments.reconciliation.manage',
    },
  ],
};
