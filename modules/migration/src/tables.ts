import type { ColumnType, Generated } from '@portico/db';

type Json = ColumnType<unknown, string, string>;
type JsonNullable = ColumnType<unknown | null, string | null, string | null>;
type Ts = ColumnType<Date, Date, Date>;
type TsNullable = ColumnType<Date | null, Date | null, Date | null>;

export interface JobsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  purpose: 'rehearsal' | 'production';
  environment: string;
  source_adapter: string;
  source_system: string;
  source_ref: string | null;
  source_identity: string;
  state: string;
  steps: Json;
  step_detail: Json;
  plan: Json;
  plan_fingerprint: string | null;
  domains: string[];
  rehearsal_link: JsonNullable;
  live_job_ref: JsonNullable;
  certificate: JsonNullable;
  transition_id: string | null;
  rollback_transition_id: string | null;
  restricted: ColumnType<unknown, string | undefined, string>;
  restore_transition_id: ColumnType<string | null, string | null | undefined, string | null>;
  cutover_planned_at: TsNullable;
  frozen_at: TsNullable;
  switched_at: TsNullable;
  opened_at: TsNullable;
  freeze_minutes: ColumnType<string | null, number | null, number | null>;
  rollback_window_ends_at: TsNullable;
  rolled_back_at: TsNullable;
  purged_at: TsNullable;
  running_until: TsNullable;
  running_by: string | null;
  run_correlations: ColumnType<string[], string[] | undefined, string[]>;
  owner_user_id: string | null;
  created_by: string;
  created_at: Ts;
  updated_at: Ts;
  version: Generated<number>;
}

export interface ExtractsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  seq: number;
  kind: 'initial' | 'delta' | 'sync' | 'final' | 'sweep';
  files: Json;
  counts: Json;
  control_totals: Json;
  delta: Json;
  fingerprint: string;
  taken_by: string;
  taken_at: Ts;
}

export interface ExtractPayloadsTable {
  tenant_id: string;
  job_id: string;
  seq: number;
  content: Json;
}

export interface SourceRecordsTable {
  tenant_id: string;
  job_id: string;
  data_class: string;
  source_key: string;
  content_hash: string;
  payload: JsonNullable;
  raw: JsonNullable;
  origin: Json;
  problems: Json;
  quality: ColumnType<unknown, string | undefined, string>;
  first_extract: number;
  last_extract: number;
  changed_extract: number;
  missing_since: number | null;
}

export interface ImportLedgerTable {
  id: string;
  tenant_id: string;
  property_id: string;
  source_system: string;
  data_class: string;
  source_key: string;
  state: string;
  target_type: string | null;
  target_id: string | null;
  imported_hash: string | null;
  first_job_id: string;
  last_job_id: string;
  reason: string | null;
  imported_at: TsNullable;
  updated_at: Ts;
  version: Generated<number>;
}

export interface ExceptionsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  property_id: string;
  data_class: string;
  source_key: string;
  code: string;
  severity: 'blocking' | 'warning';
  financial: boolean;
  problem: string;
  impact: string;
  proposed_resolution: string;
  owner_role: string;
  owner_user_id: string | null;
  due_at: TsNullable;
  status: string;
  outcome: 'corrected' | 'import_as_is' | 'excluded' | 'accepted_as_loss' | 'deferred' | null;
  resolution: string | null;
  closed_by: string | null;
  closed_at: TsNullable;
  repeat_count: Generated<number>;
  first_seen_at: Ts;
  last_seen_at: Ts;
  version: Generated<number>;
}

export interface ReportsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  seq: number;
  context: 'rehearsal' | 'certification' | 'verify' | 'sweep';
  extract_seq: number;
  exact: boolean;
  fingerprint: string;
  result: Json;
  generated_by: string;
  generated_at: Ts;
}

export interface SignoffsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  kind: string;
  report_id: string | null;
  report_fingerprint: string | null;
  signer: string;
  signer_name: string | null;
  note: string | null;
  evidence: JsonNullable;
  signed_at: Ts;
}

export interface AuthorizationsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  kind: 'production' | 'revocation';
  plan_fingerprint: string | null;
  granted_by: string;
  granted_by_name: string | null;
  evidence_ref: string | null;
  note: string | null;
  granted_at: Ts;
  expires_at: TsNullable;
}

export interface ChecklistTable {
  tenant_id: string;
  job_id: string;
  key: string;
  status: 'waiting' | 'done' | 'not_applicable';
  owner_user_id: string | null;
  due_at: Ts;
  evidence: JsonNullable;
  completed_by: string | null;
  completed_at: TsNullable;
  reminders: Generated<number>;
  last_reminded_at: TsNullable;
  version: Generated<number>;
}

export interface CutoverJournalTable {
  id: string;
  tenant_id: string;
  job_id: string;
  property_id: string;
  event_id: string;
  event_type: string;
  occurred_at: Ts;
  record_type: string;
  record_id: string;
  summary: string;
  worklist_status: Generated<'to_replay' | 'replayed' | 'not_needed'>;
  ticked_by: string | null;
  ticked_at: TsNullable;
}

export interface CardRecollectionsTable {
  id: string;
  tenant_id: string;
  job_id: string;
  property_id: string;
  source_key: string;
  booking_id: string;
  guest_profile_id: string | null;
  arrival: ColumnType<string, string, string>;
  status: 'to_request' | 'requested' | 'simulated' | 'collected' | 'not_needed';
  reference: string | null;
  note: string | null;
  updated_at: Ts;
  version: Generated<number>;
}

export interface MigrationDB {
  'migration.jobs': JobsTable;
  'migration.extracts': ExtractsTable;
  'migration.extract_payloads': ExtractPayloadsTable;
  'migration.source_records': SourceRecordsTable;
  'migration.import_ledger': ImportLedgerTable;
  'migration.exceptions': ExceptionsTable;
  'migration.reports': ReportsTable;
  'migration.signoffs': SignoffsTable;
  'migration.authorizations': AuthorizationsTable;
  'migration.checklist': ChecklistTable;
  'migration.cutover_journal': CutoverJournalTable;
  'migration.card_recollections': CardRecollectionsTable;
}
