import type { Generated } from '@portico/db';

type Ts = Generated<Date>;

export interface AccountsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  system_key: string | null;
  functional_currency: string;
  active: Generated<boolean>;
  created_at: Ts;
  version: Generated<number>;
}

export interface ChargeCodesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  code: string;
  name: string;
  charge_group: string;
  revenue_account_id: string | null;
  tax_group: string | null;
  department: string | null;
  allowance_tags: string[];
  restricted: boolean;
  active: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface FxRatesTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  business_date: string;
  from_currency: string;
  to_currency: string;
  rate: string;
  source: string;
  reason: string | null;
  entered_by: string;
  created_at: Ts;
}

export interface FoliosTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  owner_type: string;
  owner_id: string;
  payer_type: string;
  payer_id: string | null;
  payer_name: string;
  payer_name_unresolved: Generated<boolean>;
  label: string | null;
  currency: string;
  is_default: boolean;
  status: Generated<'open' | 'settled' | 'closed' | 'voided'>;
  reopen_count: Generated<number>;
  reopened_reason: string | null;
  supplementary_of: string | null;
  post_departure: Generated<boolean>;
  opened_at: Date;
  settled_at: Date | null;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface OwnerDeparturesTable {
  tenant_id: string;
  owner_type: string;
  owner_id: string;
  property_id: string;
  departed_on: string;
  recorded_at: Date;
}

export interface CashierSessionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  user_key: string;
  cashier_name: string;
  status: Generated<'open' | 'closed'>;
  opened_at: Date;
  opened_business_date: string;
  opening_floats: unknown;
  closed_at: Date | null;
  counted: unknown;
  expected: unknown;
  variance: unknown;
  close_note: string | null;
  version: Generated<number>;
}

export interface JournalEntriesTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  property_id: string | null;
  entry_type: string;
  business_date: string;
  occurred_at: Date;
  idempotency_key: string;
  request_hash: string;
  source_type: string | null;
  source_id: string | null;
  reverses_entry_id: string | null;
  corrects_entry_id: string | null;
  relates_to_business_date: string | null;
  same_day_correction: Generated<boolean>;
  reason_code: string | null;
  description: string;
  actor: unknown;
  actor_key: string;
  correlation_id: string;
  txid: Generated<number>;
  created_at: Ts;
}

export interface PostingsTable {
  id: string;
  tenant_id: string;
  entry_id: string;
  legal_entity_id: string;
  property_id: string;
  folio_id: string;
  kind: string;
  origin_kind: Generated<string | null>;
  amount_minor: number;
  currency: string;
  original_amount_minor: number | null;
  original_currency: string | null;
  fx_rate_id: string | null;
  charge_code_id: string | null;
  charge_code: string | null;
  tax_rule_id: string | null;
  tax_rule_version_id: string | null;
  tax_name: string | null;
  tax_kind: string | null;
  tax_units: string | null;
  tax_exempt_units: string | null;
  tax_rate_category: string | null;
  tax_rate: string | null;
  quantity: string | null;
  unit_price_minor: number | null;
  description: string;
  service_date: string | null;
  revenue_date: string | null;
  business_date: string;
  parent_posting_id: string | null;
  corrects_posting_id: string | null;
  transfer_peer_id: string | null;
  billing_rule_id: string | null;
  allowance_instance_id: string | null;
  counter_account_id: string | null;
  payment_ref_type: string | null;
  payment_ref_id: string | null;
  payment_method: string | null;
  payment_verification: string | null;
  cashier_session_id: string | null;
  source_type: string | null;
  source_id: string | null;
  post_departure: Generated<boolean>;
  created_at: Ts;
}

export interface JournalLinesTable {
  id: string;
  tenant_id: string;
  entry_id: string;
  legal_entity_id: string;
  line_no: number;
  account_id: string;
  sub_ledger_type: string | null;
  sub_ledger_id: string | null;
  amount_minor: number;
  currency: string;
  functional_amount_minor: number;
  functional_currency: string;
  fx_rate_id: string | null;
  posting_id: string | null;
  charge_code: string | null;
  service_date: string | null;
  revenue_date: string | null;
  memo: string | null;
}

export interface BillingRulesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  owner_type: string;
  owner_id: string;
  destination_folio_id: string;
  label: string;
  selector: unknown;
  cap: unknown;
  source: string;
  supersedes_rule_id: Generated<string | null>;
  active: Generated<boolean>;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface DepositAccountsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  property_id: string;
  booking_id: string;
  currency: string;
  balance_minor: Generated<number>;
  declared_tax: Generated<unknown>;
  version: Generated<number>;
}

export interface DepositMovementsTable {
  id: string;
  tenant_id: string;
  deposit_account_id: string;
  booking_id: string;
  kind: string;
  amount_minor: number;
  currency: string;
  entry_id: string;
  folio_id: string | null;
  payment_ref_type: string | null;
  payment_ref_id: string | null;
  payment_method: Generated<string | null>;
  payment_verification: Generated<string | null>;
  taxes: Generated<unknown>;
  business_date: string;
  created_at: Ts;
}

export interface AllowanceInstancesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  stay_id: string;
  folio_id: string;
  definition_ref: string;
  label: string;
  period_key: string;
  valid_from: string;
  valid_to: string;
  eligible_charge_codes: string[];
  eligible_groups: string[];
  eligible_tags: string[];
  covers_taxes: boolean;
  tax_treatment: Generated<'taxed_at_grant' | 'prepayment'>;
  unused_policy: string;
  currency: string;
  granted_minor: number;
  used_minor: Generated<number>;
  status: Generated<'active' | 'consumed' | 'closed' | 'cancelled'>;
  grant_entry_id: string;
  close_entry_id: string | null;
  carried_to_id: string | null;
  carried_from_id: string | null;
  version: Generated<number>;
}

export interface ReceivablesAccountsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  company_id: string;
  kind: 'company' | 'agency';
  name: string;
  currency: string;
  terms_days: number;
  credit_limit_minor: number | null;
  credit_limit_mode: 'block' | 'warn';
  status: Generated<'active' | 'on_hold' | 'closed'>;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface ReceivablesItemsTable {
  id: string;
  tenant_id: string;
  account_id: string;
  kind: string;
  amount_minor: number;
  currency: string;
  business_date: string;
  due_date: string | null;
  document_id: string | null;
  folio_id: string | null;
  entry_id: string;
  reference: string | null;
  created_at: Ts;
}

export interface ReceivablesAllocationsTable {
  id: string;
  tenant_id: string;
  account_id: string;
  debit_item_id: string;
  credit_item_id: string;
  amount_minor: number;
  business_date: string;
  created_at: Ts;
}

export interface FiscalSeriesTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  property_id: string | null;
  kind: 'invoice' | 'credit_note';
  prefix: string;
  next_number: Generated<number>;
  active: Generated<boolean>;
  created_at: Ts;
  version: Generated<number>;
}

export interface FiscalChainsTable {
  tenant_id: string;
  legal_entity_id: string;
  last_hash: string;
  document_count: Generated<number>;
}

export interface FiscalDocumentsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  property_id: string;
  series_id: string;
  number: number;
  document_number: string;
  kind: 'invoice' | 'credit_note';
  folio_id: string;
  original_document_id: string | null;
  credit_mode: 'cancel' | 'adjust' | null;
  currency: string;
  total_minor: number;
  snapshot: unknown;
  business_date: string;
  issued_at: Date;
  idempotency_key: string;
  request_hash: string;
  chain_position: number;
  previous_hash: string;
  hash: string;
  issued_by: string;
  retain_until: string;
  created_at: Ts;
}

export interface LegalHoldsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  reason: string;
  placed_by: string;
  placed_at: Date;
  released_by: string | null;
  released_at: Date | null;
  release_reason: string | null;
  version: Generated<number>;
}

export interface PostingDocumentLocksTable {
  tenant_id: string;
  posting_id: string;
  document_id: string;
}

export interface CashMovementsTable {
  id: string;
  tenant_id: string;
  session_id: string;
  kind: string;
  amount_minor: number;
  currency: string;
  entry_id: string | null;
  posting_id: string | null;
  reference: string | null;
  created_at: Ts;
}

export interface OpeningBalanceImportsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  property_id: string;
  import_ref: string;
  kind: 'deposits';
  currency: string;
  provided_closing_minor: number;
  imported_total_minor: number;
  difference_minor: number;
  status: 'reconciled' | 'difference';
  entry_id: string | null;
  report: unknown;
  business_date: string;
  created_at: Ts;
}

export interface ExceptionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  kind: string;
  severity: 'urgent' | 'routine';
  ref_type: string;
  ref_id: string;
  message: string;
  details: unknown;
  status: Generated<'open' | 'resolved'>;
  business_date: string;
  created_at: Ts;
  resolved_at: Date | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface PaymentVerificationsTable {
  id: string;
  tenant_id: string;
  payment_ref_type: string;
  payment_ref_id: string;
  evidence_type: string;
  evidence_id: string;
  idempotency_key: string;
  verified_at: Date;
  verified_by: string;
}

export interface FinanceDB {
  'finance.accounts': AccountsTable;
  'finance.charge_codes': ChargeCodesTable;
  'finance.fx_rates': FxRatesTable;
  'finance.folios': FoliosTable;
  'finance.owner_departures': OwnerDeparturesTable;
  'finance.cashier_sessions': CashierSessionsTable;
  'finance.journal_entries': JournalEntriesTable;
  'finance.postings': PostingsTable;
  'finance.journal_lines': JournalLinesTable;
  'finance.billing_rules': BillingRulesTable;
  'finance.deposit_accounts': DepositAccountsTable;
  'finance.deposit_movements': DepositMovementsTable;
  'finance.allowance_instances': AllowanceInstancesTable;
  'finance.receivables_accounts': ReceivablesAccountsTable;
  'finance.receivables_items': ReceivablesItemsTable;
  'finance.receivables_allocations': ReceivablesAllocationsTable;
  'finance.fiscal_series': FiscalSeriesTable;
  'finance.fiscal_chains': FiscalChainsTable;
  'finance.fiscal_documents': FiscalDocumentsTable;
  'finance.posting_document_locks': PostingDocumentLocksTable;
  'finance.cash_movements': CashMovementsTable;
  'finance.opening_balance_imports': OpeningBalanceImportsTable;
  'finance.exceptions': ExceptionsTable;
  'finance.legal_holds': LegalHoldsTable;
  'finance.payment_verifications': PaymentVerificationsTable;
}
