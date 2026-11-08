import type { ColumnType, Generated } from '@portico/db';

type Ts = ColumnType<Date, Date | string, Date | string>;
type TsNullable = ColumnType<Date | null, Date | string | null, Date | string | null>;
type Json = ColumnType<unknown, string, string>;
type JsonNullable = ColumnType<unknown, string | null, string | null>;

export interface RunsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  business_date: string;
  status: string;
  trigger: string;
  started_by: string;
  started_by_name: string | null;
  started_at: Ts;
  finished_at: TsNullable;
  current_step: string | null;
  failure: JsonNullable;
  lease_owner: string | null;
  lease_until: TsNullable;
  heartbeat_at: TsNullable;
  auto_continue: Generated<boolean>;
  retry_count: Generated<number>;
  next_retry_at: TsNullable;
  cancel_reason: string | null;
  executions: ColumnType<unknown, string | undefined, string>;
  version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StepsTable {
  tenant_id: string;
  run_id: string;
  key: string;
  ordinal: number;
  status: string;
  total: number | null;
  done: Generated<number>;
  failed: Generated<number>;
  skipped: Generated<number>;
  detail: ColumnType<unknown, string | undefined, string>;
  error: JsonNullable;
  attempts: Generated<number>;
  started_at: TsNullable;
  finished_at: TsNullable;
  version: Generated<number>;
}

export interface StepItemsTable {
  id: string;
  tenant_id: string;
  run_id: string;
  step_key: string;
  item_key: string;
  ref_type: string | null;
  ref_id: string | null;
  status: string;
  result: ColumnType<unknown, string | undefined, string>;
  error: JsonNullable;
  attempts: Generated<number>;
  updated_at: Ts;
}

export interface NightPostingsTable {
  tenant_id: string;
  property_id: string;
  stay_id: string;
  night: string;
  run_id: string;
  business_date: string;
  posting_keys: string[];
  entry_ids: string[];
  amounts: Json;
  catch_up: boolean;
  posted_at: Ts;
}

export interface LinePostingsTable {
  tenant_id: string;
  property_id: string;
  stay_id: string;
  line_key: string;
  night: string;
  service_date: string;
  kind: string;
  amount_minor: number;
  currency: string;
  outcome: string;
  entry_id: string | null;
  run_id: string;
  business_date: string;
  posted_at: Ts;
}

export interface DeferredLinesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  stay_id: string;
  line_key: string;
  night: string;
  service_date: string;
  line: Json;
  status: string;
  status_reason: string | null;
  created_run_id: string;
  updated_run_id: string;
  updated_at: Ts;
  version: Generated<number>;
}

export interface NightDecisionsTable {
  id: string;
  tenant_id: string;
  property_id: string;
  stay_id: string;
  night: string;
  decision: string;
  run_id: string | null;
  reason: string;
  actor: string;
  created_at: Ts;
}

export interface WatchedStaysTable {
  tenant_id: string;
  property_id: string;
  stay_id: string;
  from_night: string;
  departure: string;
  reason: string;
  created_at: Ts;
  updated_at: Ts;
  resolved_at: TsNullable;
}

export interface OverridesTable {
  id: string;
  tenant_id: string;
  run_id: string;
  property_id: string;
  item_key: string;
  code: string;
  ref: JsonNullable;
  reason: string;
  actor: string;
  actor_name: string | null;
  created_at: Ts;
}

export interface IssuesTable {
  id: string;
  tenant_id: string;
  property_id: string;
  business_date: string;
  run_id: string | null;
  code: string;
  severity: string;
  dedupe_key: string;
  ref_type: string | null;
  ref_id: string | null;
  message: string;
  owner: JsonNullable;
  details: ColumnType<unknown, string | undefined, string>;
  status: string;
  created_at: Ts;
  resolved_at: TsNullable;
  resolved_by: string | null;
  resolution: string | null;
  version: Generated<number>;
}

export interface DayFactsTable {
  tenant_id: string;
  property_id: string;
  business_date: string;
  run_id: string;
  facts: Json;
  generated_at: Ts;
}

export interface DayReportsTable {
  tenant_id: string;
  property_id: string;
  business_date: string;
  run_id: string;
  pack: Json;
  generated_at: Ts;
}

export interface SchedulesTable {
  tenant_id: string;
  property_id: string;
  enabled: boolean;
  local_time: string;
  timezone: string;
  auto_continue: Generated<boolean>;
  configured_by: string | null;
  next_due_at: TsNullable;
  skip_date: string | null;
  version: Generated<number>;
  updated_at: Ts;
}

export interface ScheduleLogTable {
  id: string;
  tenant_id: string;
  property_id: string;
  event: string;
  business_date: string | null;
  detail: ColumnType<unknown, string | undefined, string>;
  actor: string;
  created_at: Ts;
}

export interface DayCloseDB {
  'day_close.runs': RunsTable;
  'day_close.steps': StepsTable;
  'day_close.step_items': StepItemsTable;
  'day_close.night_postings': NightPostingsTable;
  'day_close.deferred_lines': DeferredLinesTable;
  'day_close.line_postings': LinePostingsTable;
  'day_close.night_decisions': NightDecisionsTable;
  'day_close.watched_stays': WatchedStaysTable;
  'day_close.overrides': OverridesTable;
  'day_close.issues': IssuesTable;
  'day_close.day_facts': DayFactsTable;
  'day_close.day_reports': DayReportsTable;
  'day_close.schedules': SchedulesTable;
  'day_close.schedule_log': ScheduleLogTable;
}
