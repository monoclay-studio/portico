import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModuleManifest, PermissionDefinition } from '@portico/kernel';

const p = (key: string, description: string, scope: 'organization' | 'property', sensitive = false): PermissionDefinition => ({
  key,
  description,
  scope,
  ...(sensitive ? { sensitive: true } : {}),
});

export const FINANCE_PERMISSIONS: PermissionDefinition[] = [
  p('finance.folio.read', 'View folios, postings, balances, deposits and allowances', 'property'),
  p('finance.folio.manage', 'Open, settle, close and void folios', 'property'),
  p('finance.posting.create', 'Post charges, record payments and apply deposits', 'property'),
  p('finance.posting.correct', 'Correct postings with linked adjustments', 'property', true),
  p('finance.posting.transfer', 'Transfer postings between folios', 'property'),
  p('finance.posting.restrictedCodes', 'Post restricted charge codes', 'property', true),
  p('finance.billingRule.manage', 'Create and change billing rules (who pays for what)', 'property'),
  p('finance.folio.settleToReceivables', 'Transfer folio balances to receivables accounts (direct bill)', 'property'),
  p('finance.invoice.issue', 'Issue invoices', 'property'),
  p('finance.creditNote.issue', 'Issue credit notes', 'property', true),
  p('finance.receivables.read', 'View receivables accounts, statements and aging', 'organization'),
  p('finance.receivables.manage', 'Manage receivables accounts, payments and allocations', 'organization', true),
  p('finance.creditLimit.override', 'Approve direct-bill transfers above a credit limit', 'property', true),
  p('finance.cashier.operate', 'Operate a cashier session and take cash', 'property'),
  p('finance.cashier.paidOut', 'Pay out cash on behalf of guests', 'property', true),
  p('finance.cashier.review', "Review and close other staff members' cashier sessions", 'property'),
  p('finance.fx.manage', 'Record exchange rates and FX settlements', 'organization', true),
  p('finance.chargeCode.manage', 'Manage charge codes and their revenue mapping', 'property', true),
  p('finance.ledger.read', 'View the ledger, trial balance, fiscal ledger and tax reports', 'organization'),
  p('finance.ledger.manage', 'Manage the chart of accounts, fiscal series, payouts and legal holds', 'organization', true),
  p('finance.report.read', 'View finance reports and Day Close checks for a property', 'property'),
  p('finance.openingBalance.import', 'Import opening balances during migration', 'property', true),
];

export const financeManifest: ModuleManifest = {
  name: 'finance',
  schema: 'finance',
  migrationsDir: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
  permissions: FINANCE_PERMISSIONS,
};
