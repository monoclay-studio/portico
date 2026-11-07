import type { Generated } from '@portico/db';
import type {
  AuthorizationStatus,
  DisputeStatus,
  OperationStatus,
  PaymentRequestStatus,
  PaymentStatus,
  VirtualCardStatus,
} from './domain/states';

type Ts = Date;
type LedgerStatus = 'not_required' | 'pending' | 'posted' | 'failed';
type RecordMode = 'live' | 'sandbox' | 'simulate' | 'recorded';

export interface AccountsTable {
  id: string;
  tenant_id: string;
  legal_entity_id: string;
  provider: 'simulator' | 'stripe_connect' | 'external_terminal';
  external_account_id: string | null;
  display_name: string;
  capabilities: unknown;
  onboarding_status: 'not_started' | 'in_progress' | 'complete' | 'not_applicable';
  country_code: string | null;
  currencies: string[];
  statement_descriptor: string | null;
  status: 'pending' | 'active' | 'restricted' | 'disabled';
  status_reason: string | null;
  application_fee_bps: number | null;
  simulator_controls: unknown;
  provider_status_at: Generated<Ts | null>;
  linked_by: Generated<string | null>;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface AccountHealthTable {
  account_id: string;
  tenant_id: string;
  state: 'closed' | 'open' | 'half_open';
  consecutive_failures: number;
  opened_at: Ts | null;
  probe_after: Ts | null;
  last_success_at: Ts | null;
  last_failure_at: Ts | null;
  last_error: string | null;
  updated_at: Ts;
}

export interface PaymentMethodsTable {
  id: string;
  tenant_id: string;
  account_id: string;
  property_id: string;
  kind: 'card' | 'virtual_card' | 'wallet';
  provider_token: string;
  provider_customer_ref: string | null;
  brand: string | null;
  last4: string | null;
  exp_month: number | null;
  exp_year: number | null;
  holder_name: string | null;
  owner_type: 'guest_profile' | 'company' | 'agency' | 'booking';
  owner_id: string;
  mit_agreement: boolean;
  mandate: unknown;
  entry_channel: Generated<'hosted_entry' | 'terminal' | 'vault' | 'import' | 'staff_entry'>;
  /** What the client said about the entry channel (information only; `entry_channel` is the server fact). */
  declared_entry_channel: string | null;
  /** R2-P2-1: the owner before a guest-profile merge (restored by an unmerge). */
  merged_from_owner_id: string | null;
  token_portability: 'provider_bound' | 'network_token' | 'vault_portable' | 'unknown';
  portability_note: string | null;
  status: 'active' | 'detached' | 'expired';
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface AuthorizationsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  account_id: string;
  method_id: string | null;
  ref_type: string;
  ref_id: string;
  business_key: string;
  request_hash: Generated<string | null>;
  currency: string;
  amount_minor: number;
  captured_minor: Generated<number>;
  capture_reserved_minor: Generated<number>;
  status: AuthorizationStatus;
  mode: RecordMode;
  initiator: 'customer' | 'merchant';
  provider_ref: string | null;
  external_reference: string | null;
  expires_at: Ts | null;
  decline: unknown;
  created_by: string;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface PaymentsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  account_id: string | null;
  method_id: string | null;
  authorization_id: string | null;
  payment_request_id: string | null;
  virtual_card_id: string | null;
  kind: 'charge' | 'capture' | 'link' | 'recorded';
  purpose: Generated<'deposit' | 'balance' | 'incidentals' | 'no_show' | 'custom' | null>;
  method: 'card' | 'virtual_card' | 'payment_link' | 'external_terminal' | 'cash' | 'bank_transfer';
  initiator: 'customer' | 'merchant' | null;
  ref_type: 'folio' | 'booking';
  ref_id: string;
  business_key: string;
  request_hash: Generated<string | null>;
  currency: string;
  amount_minor: number;
  adjusted_minor: Generated<number>;
  refunded_minor: Generated<number>;
  refund_reserved_minor: Generated<number>;
  status: PaymentStatus;
  mode: RecordMode;
  provider_ref: string | null;
  external_reference: string | null;
  terminal_id: string | null;
  card_brand: string | null;
  card_last4: string | null;
  received_at: Ts | null;
  received_on: Generated<string | null>;
  duplicate_override: Generated<string | null>;
  decline: unknown;
  ledger_status: LedgerStatus;
  ledger_posting_id: string | null;
  ledger_error: string | null;
  ledger_attempts: Generated<number>;
  ledger_next_attempt_at: Generated<Ts | null>;
  verification_ledger_status: Generated<LedgerStatus>;
  payout_id: string | null;
  note: string | null;
  created_by: string;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface RefundsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  payment_id: string;
  account_id: string | null;
  business_key: string;
  request_hash: Generated<string | null>;
  currency: string;
  amount_minor: number;
  reason: string;
  status: PaymentStatus;
  mode: RecordMode;
  provider_ref: string | null;
  external_reference: string | null;
  failure: unknown;
  ledger_status: LedgerStatus;
  ledger_posting_id: string | null;
  ledger_error: string | null;
  ledger_attempts: Generated<number>;
  ledger_next_attempt_at: Generated<Ts | null>;
  verification_ledger_status: Generated<LedgerStatus>;
  created_by: string;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface PaymentAdjustmentsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  payment_id: string;
  business_key: string;
  currency: string;
  amount_minor: number;
  reason: string;
  exception_id: string | null;
  ledger_posting_id: string;
  created_by: string;
  created_at: Generated<Ts>;
}

export interface ProviderOperationsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  account_id: string;
  kind: 'authorize' | 'increment' | 'capture' | 'void' | 'charge' | 'refund';
  target_type: 'authorization' | 'payment' | 'refund';
  target_id: string;
  authorization_id: string | null;
  currency: string;
  amount_minor: number;
  idempotency_key: string;
  mode: 'live' | 'sandbox' | 'simulate';
  status: OperationStatus;
  attempts: Generated<number>;
  provider_ref: string | null;
  outcome: unknown;
  failure_code: string | null;
  failure_message: string | null;
  sent_at: Ts | null;
  completed_at: Ts | null;
  next_check_at: Ts | null;
  check_count: Generated<number>;
  not_found_at: Generated<Ts | null>;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface OperationJournalTable {
  id: string;
  tenant_id: string;
  operation_id: string;
  attempt: number;
  phase: 'intent' | 'outcome' | 'lookup' | 'webhook' | 'short_circuit';
  status: string;
  detail: unknown;
  recorded_at: Ts;
}

export interface WebhookEventsTable {
  id: string;
  tenant_id: string;
  account_id: string;
  provider: string;
  provider_event_id: string;
  event_type: string;
  object_kind: string;
  object_ref: string | null;
  livemode: boolean;
  payload: unknown;
  received_at: Ts;
  processed_at: Generated<Ts | null>;
  attempts: Generated<number>;
  outcome: 'received' | 'failed' | 'applied' | 'no_change' | 'stale' | 'unknown_type' | 'no_match';
  outcome_detail: string | null;
}

export interface PaymentRequestsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  legal_entity_id: string;
  account_id: string;
  business_key: string;
  request_hash: Generated<string | null>;
  payer: unknown;
  currency: string;
  amount_minor: number;
  paid_minor: Generated<number>;
  purpose: 'deposit' | 'balance' | 'incidentals_preauth' | 'custom';
  description: string | null;
  ref_type: 'folio' | 'booking';
  ref_id: string;
  expires_at: Ts;
  status: PaymentRequestStatus;
  mode: 'live' | 'sandbox' | 'simulate';
  provider_link_ref: string | null;
  link_url: string | null;
  link_status: 'pending' | 'created' | 'failed' | 'unknown' | 'deactivating' | 'completed' | 'deactivated';
  /** R4-P2-2: when `link_status` last changed (deadline for an unconfirmed stop). */
  link_status_at: Ts | null;
  /** R3-P2-1: the booking the request's reference belongs to (booking, stay or folio of it). */
  family_booking_id: string | null;
  cancelled_reason: string | null;
  created_by: string;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface VirtualCardsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  method_id: string;
  booking_id: string;
  ref_type: 'folio' | 'booking';
  ref_id: string;
  channel: string;
  channel_reference: string;
  currency: string;
  amount_minor: number;
  activation_date: string;
  expires_on: string | null;
  status: VirtualCardStatus;
  attempts: Generated<number>;
  next_attempt_at: Ts | null;
  last_failure: unknown;
  charged_payment_id: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface DisputesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  payment_id: string;
  account_id: string;
  provider_dispute_id: string;
  currency: string;
  amount_minor: number;
  reason: string;
  status: DisputeStatus;
  evidence_due_at: Ts | null;
  evidence: unknown;
  funds_withdrawn: boolean;
  ledger_movements: unknown;
  opened_at: Ts;
  closed_at: Ts | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface PayoutsTable {
  id: string;
  tenant_id: string;
  account_id: string;
  legal_entity_id: string;
  provider_payout_id: string;
  currency: string;
  gross_minor: number | null;
  fees_minor: number | null;
  net_minor: number;
  arrival_date: string | null;
  status: 'in_transit' | 'paid' | 'failed';
  failure_reason: string | null;
  source: 'webhook' | 'statement' | 'manual';
  ledger_status: LedgerStatus;
  ledger_ref: string | null;
  ledger_error: string | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface PayoutItemsTable {
  id: string;
  tenant_id: string;
  payout_id: string;
  kind: 'payment' | 'refund' | 'fee' | 'dispute' | 'adjustment';
  payment_id: string | null;
  refund_id: string | null;
  amount_minor: number;
  created_at: Generated<Ts>;
}

export interface StatementsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  account_id: string | null;
  source: 'terminal_batch' | 'acquirer_settlement' | 'bank_statement' | 'cash_deposit';
  file_name: string;
  file_sha256: string;
  period_from: string;
  period_to: string;
  line_count: number;
  matched_count: number;
  exception_count: number;
  fees_minor: Generated<number>;
  fees_ledger_status: Generated<'not_required' | 'posted' | 'failed'>;
  imported_by: string;
  imported_at: Ts;
}

export interface StatementLinesTable {
  id: string;
  tenant_id: string;
  statement_id: string;
  line_no: number;
  occurred_on: string;
  currency: string;
  amount_minor: number;
  fee_minor: Generated<number>;
  net_minor: Generated<number | null>;
  reference: string | null;
  approval_code: string | null;
  card_last4: string | null;
  description: string | null;
  match_status: 'matched' | 'unmatched' | 'amount_mismatch' | 'duplicate' | 'ambiguous';
  match_basis: string | null;
  matched_payment_id: string | null;
  matched_refund_id: string | null;
}

export interface ExceptionsTable {
  id: string;
  tenant_id: string;
  property_id: string | null;
  kind: string;
  severity: 'urgent' | 'routine';
  problem: string;
  business_impact: string;
  next_step: string;
  owner_role: string;
  responsible_party: 'hotel' | 'monoclay' | 'provider';
  assignee_user_id: string | null;
  ref_type: string | null;
  ref_id: string | null;
  dedupe_key: string;
  occurrences: Generated<number>;
  status: 'open' | 'resolved';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: Ts | null;
  created_at: Generated<Ts>;
  updated_at: Generated<Ts>;
  version: Generated<number>;
}

export interface EventCursorsTable {
  account_id: string;
  tenant_id: string;
  cursor: string | null;
  last_run_at: Ts | null;
  last_error: string | null;
}

export interface SimulatorObjectsTable {
  tenant_id: string;
  account_id: string;
  idempotency_key: string;
  object_id: string;
  kind: string;
  status: string;
  currency: string;
  amount_minor: number;
  data: unknown;
  created_at: Ts;
  updated_at: Ts;
}

export interface SimulatorWebhooksTable {
  id: string;
  tenant_id: string;
  account_id: string;
  seq: Generated<number>;
  event_id: string;
  payload: unknown;
  delivered: boolean;
  created_at: Ts;
}

export interface PaymentsDB {
  'payments.accounts': AccountsTable;
  'payments.account_health': AccountHealthTable;
  'payments.payment_methods': PaymentMethodsTable;
  'payments.authorizations': AuthorizationsTable;
  'payments.payments': PaymentsTable;
  'payments.refunds': RefundsTable;
  'payments.payment_adjustments': PaymentAdjustmentsTable;
  'payments.provider_operations': ProviderOperationsTable;
  'payments.operation_journal': OperationJournalTable;
  'payments.webhook_events': WebhookEventsTable;
  'payments.payment_requests': PaymentRequestsTable;
  'payments.virtual_cards': VirtualCardsTable;
  'payments.disputes': DisputesTable;
  'payments.payouts': PayoutsTable;
  'payments.payout_items': PayoutItemsTable;
  'payments.statements': StatementsTable;
  'payments.statement_lines': StatementLinesTable;
  'payments.exceptions': ExceptionsTable;
  'payments.event_cursors': EventCursorsTable;
  'payments.simulator_objects': SimulatorObjectsTable;
  'payments.simulator_webhooks': SimulatorWebhooksTable;
}
