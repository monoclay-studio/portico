-- Migration module ("Move to Portico", owner decision D13): job pipeline, source extracts, the import ledger that
-- makes every source record land exactly once, exceptions with owners, reconciliation reports (the sign-off
-- artefact), the seven human checklist steps, production authorizations, the cutover journal and the card
-- re-collection list. Rules: every table is tenant-isolated (RLS forced); reports, extracts, sign-offs and
-- authorizations are append-only; no foreign keys into other modules' schemas (ids are references only).
create schema if not exists migration;

---------------------------------------------------------------------------------------------------------
-- Jobs
---------------------------------------------------------------------------------------------------------
create table migration.jobs (
  id                       uuid primary key,
  tenant_id                uuid not null,
  property_id              uuid not null,
  purpose                  text not null check (purpose in ('rehearsal', 'production')),
  environment              text not null check (environment in ('live', 'trial', 'sandbox', 'training', 'demo')),
  source_adapter           text not null,
  source_system            text not null,
  -- Simulator account id (simulator sources); null for file packs.
  source_ref               text,
  -- Identity of the source in data authority while it is the system of record (the job id for file sources).
  source_identity          uuid not null,
  state                    text not null check (state in (
                             'draft', 'in_progress', 'waiting', 'rehearsed', 'in_sync', 'frozen', 'switched',
                             'rollback_window', 'completed', 'rolled_back', 'cancelled', 'failed')),
  steps                    jsonb not null,
  step_detail              jsonb not null default '{}',
  plan                     jsonb not null,
  plan_fingerprint         text,
  domains                  text[] not null,
  -- Production: the linked trial organization and property used for rehearsals.
  rehearsal_link           jsonb,
  -- Rehearsal job created for a live job: { organizationId, jobId } of that live job.
  live_job_ref             jsonb,
  -- Rehearsal: the certificate issued after two consecutive exact reconciliations; production: evidence copy.
  certificate              jsonb,
  transition_id            uuid,
  rollback_transition_id   uuid,
  cutover_planned_at       timestamptz,
  frozen_at                timestamptz,
  switched_at              timestamptz,
  opened_at                timestamptz,
  freeze_minutes           numeric(10, 2),
  rollback_window_ends_at  timestamptz,
  rolled_back_at           timestamptz,
  -- Personal data of the source (extract content, record payloads) purged after the retention period.
  purged_at                timestamptz,
  -- Lease for a running pipeline (crash-safe: an expired lease may be taken over by a resume).
  running_until            timestamptz,
  running_by               text,
  -- Correlation ids of the pipeline's own runs: their events are never journaled as post-cutover activity.
  run_correlations         text[] not null default '{}',
  owner_user_id            text,
  created_by               text not null,
  created_at               timestamptz not null,
  updated_at               timestamptz not null,
  version                  int not null default 1
);
select core.enable_tenant_isolation('migration.jobs');
-- One open migration per property (a second "Move to Portico" resumes the first).
create unique index jobs_one_open_per_property on migration.jobs (tenant_id, property_id)
  where state not in ('completed', 'rolled_back', 'cancelled', 'failed');
create unique index jobs_one_rehearsal_per_live_job on migration.jobs (tenant_id, ((live_job_ref ->> 'jobId')))
  where live_job_ref is not null;

---------------------------------------------------------------------------------------------------------
-- Extracts: every read of the source (initial, delta, final capture, post-cutover sweep). Append-only.
---------------------------------------------------------------------------------------------------------
create table migration.extracts (
  id              uuid primary key,
  tenant_id       uuid not null,
  job_id          uuid not null references migration.jobs(id),
  seq             int not null,
  -- initial / delta (before the rehearsal is certified: preparation runs again), sync (staged until cutover),
  -- final (capture at freeze start), sweep (after the switch).
  kind            text not null check (kind in ('initial', 'delta', 'sync', 'final', 'sweep')),
  files           jsonb not null,
  counts          jsonb not null,
  control_totals  jsonb not null,
  delta           jsonb not null,
  fingerprint     text not null,
  taken_by        text not null,
  taken_at        timestamptz not null,
  unique (job_id, seq)
);
select core.enable_tenant_isolation('migration.extracts');

create table migration.extract_payloads (
  tenant_id  uuid not null,
  job_id     uuid not null references migration.jobs(id),
  seq        int not null,
  content    jsonb not null,
  primary key (job_id, seq)
);
select core.enable_tenant_isolation('migration.extract_payloads');

---------------------------------------------------------------------------------------------------------
-- Source records: the current state of every record the source has shown (normalized; never card data).
---------------------------------------------------------------------------------------------------------
create table migration.source_records (
  tenant_id        uuid not null,
  job_id           uuid not null references migration.jobs(id),
  data_class       text not null,
  source_key       text not null,
  content_hash     text not null,
  payload          jsonb,
  raw              jsonb,
  origin           jsonb not null,
  -- Parsing problems (from the extract) and cross-record quality findings (replaced on every validation).
  problems         jsonb not null default '[]',
  quality          jsonb not null default '[]',
  first_extract    int not null,
  last_extract     int not null,
  changed_extract  int not null,
  -- Seq of the extract in which the record was no longer present (never deleted in Portico).
  missing_since    int,
  primary key (job_id, data_class, source_key)
);
select core.enable_tenant_isolation('migration.source_records');

---------------------------------------------------------------------------------------------------------
-- Import ledger: exactly one outcome per (property, source system, class, source key) — across jobs, reruns,
-- retries, delta syncs and sweeps. This unique constraint is the zero-duplicate invariant.
---------------------------------------------------------------------------------------------------------
create table migration.import_ledger (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  source_system   text not null,
  data_class      text not null,
  source_key      text not null,
  state           text not null check (state in (
                    'imported', 'merged', 'rejected', 'excluded', 'exception', 'suggested', 'pending')),
  target_type     text,
  target_id       text,
  imported_hash   text,
  first_job_id    uuid not null,
  last_job_id     uuid not null,
  reason          text,
  imported_at     timestamptz,
  updated_at      timestamptz not null,
  version         int not null default 1,
  unique (tenant_id, property_id, source_system, data_class, source_key)
);
select core.enable_tenant_isolation('migration.import_ledger');
create index import_ledger_job on migration.import_ledger (tenant_id, last_job_id, data_class);

---------------------------------------------------------------------------------------------------------
-- Exceptions with owners (phase M5). Deduplicated per job, class, record and problem.
---------------------------------------------------------------------------------------------------------
create table migration.exceptions (
  id                   uuid primary key,
  tenant_id            uuid not null,
  job_id               uuid not null references migration.jobs(id),
  property_id          uuid not null,
  data_class           text not null,
  source_key           text not null default '',
  code                 text not null,
  severity             text not null check (severity in ('blocking', 'warning')),
  financial            boolean not null,
  problem              text not null,
  impact               text not null,
  proposed_resolution  text not null,
  owner_role           text not null,
  owner_user_id        text,
  due_at               timestamptz,
  status               text not null check (status in (
                         'open', 'in_progress', 'resolved', 'accepted_as_loss', 'deferred', 'excluded')),
  -- How it was closed: corrected (in the source), import_as_is, excluded, accepted_as_loss, deferred.
  outcome              text check (outcome in ('corrected', 'import_as_is', 'excluded', 'accepted_as_loss', 'deferred')),
  resolution           text,
  closed_by            text,
  closed_at            timestamptz,
  repeat_count         int not null default 1,
  first_seen_at        timestamptz not null,
  last_seen_at         timestamptz not null,
  version              int not null default 1,
  unique (job_id, data_class, source_key, code)
);
select core.enable_tenant_isolation('migration.exceptions');
create index exceptions_open on migration.exceptions (tenant_id, job_id, status, severity);

---------------------------------------------------------------------------------------------------------
-- Reconciliation reports (versioned per job; the sign-off artefact). Append-only.
---------------------------------------------------------------------------------------------------------
create table migration.reports (
  id            uuid primary key,
  tenant_id     uuid not null,
  job_id        uuid not null references migration.jobs(id),
  seq           int not null,
  context       text not null check (context in ('rehearsal', 'certification', 'verify', 'sweep')),
  extract_seq   int not null,
  exact         boolean not null,
  fingerprint   text not null,
  result        jsonb not null,
  generated_by  text not null,
  generated_at  timestamptz not null,
  unique (job_id, seq)
);
select core.enable_tenant_isolation('migration.reports');

---------------------------------------------------------------------------------------------------------
-- Sign-offs and production authorizations (append-only; a revocation is a new row).
---------------------------------------------------------------------------------------------------------
create table migration.signoffs (
  id           uuid primary key,
  tenant_id    uuid not null,
  job_id       uuid not null references migration.jobs(id),
  kind         text not null,
  report_id    uuid,
  report_fingerprint text,
  signer       text not null,
  signer_name  text,
  note         text,
  evidence     jsonb,
  signed_at    timestamptz not null
);
select core.enable_tenant_isolation('migration.signoffs');

create table migration.authorizations (
  id                uuid primary key,
  tenant_id         uuid not null,
  job_id            uuid not null references migration.jobs(id),
  kind              text not null check (kind in ('production', 'revocation')),
  plan_fingerprint  text,
  granted_by        text not null,
  granted_by_name   text,
  evidence_ref      text,
  note              text,
  granted_at        timestamptz not null,
  expires_at        timestamptz
);
select core.enable_tenant_isolation('migration.authorizations');

---------------------------------------------------------------------------------------------------------
-- The seven human steps (DD11 §6.2) with owners, due times and reminders.
---------------------------------------------------------------------------------------------------------
create table migration.checklist (
  tenant_id         uuid not null,
  job_id            uuid not null references migration.jobs(id),
  key               text not null,
  status            text not null check (status in ('waiting', 'done', 'not_applicable')),
  owner_user_id     text,
  due_at            timestamptz not null,
  evidence          jsonb,
  completed_by      text,
  completed_at      timestamptz,
  reminders         int not null default 0,
  last_reminded_at  timestamptz,
  version           int not null default 1,
  primary key (job_id, key)
);
select core.enable_tenant_isolation('migration.checklist');

---------------------------------------------------------------------------------------------------------
-- Cutover journal: business changes at the property after the switch (rollback worklist). Facts are immutable;
-- only the worklist status of an entry changes.
---------------------------------------------------------------------------------------------------------
create table migration.cutover_journal (
  id               uuid primary key,
  tenant_id        uuid not null,
  job_id           uuid not null references migration.jobs(id),
  property_id      uuid not null,
  event_id         uuid not null,
  event_type       text not null,
  occurred_at      timestamptz not null,
  record_type      text not null,
  record_id        text not null,
  summary          text not null,
  worklist_status  text not null default 'to_replay' check (worklist_status in ('to_replay', 'replayed', 'not_needed')),
  ticked_by        text,
  ticked_at        timestamptz,
  unique (job_id, event_id)
);
select core.enable_tenant_isolation('migration.cutover_journal');
create or replace function migration.journal_facts_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'cutover journal entries are never deleted'; end if;
  if (new.event_id, new.event_type, new.occurred_at, new.record_type, new.record_id, new.summary, new.job_id)
     is distinct from
     (old.event_id, old.event_type, old.occurred_at, old.record_type, old.record_id, old.summary, old.job_id) then
    raise exception 'cutover journal facts are immutable';
  end if;
  return new;
end $$;
create trigger journal_facts_immutable before update or delete on migration.cutover_journal
  for each row execute function migration.journal_facts_immutable();

---------------------------------------------------------------------------------------------------------
-- Card re-collection list (Q142 default): migrated future stays whose guarantee card stayed at the old provider.
---------------------------------------------------------------------------------------------------------
create table migration.card_recollections (
  id                uuid primary key,
  tenant_id         uuid not null,
  job_id            uuid not null references migration.jobs(id),
  property_id       uuid not null,
  source_key        text not null,
  booking_id        text not null,
  guest_profile_id  text,
  arrival           date not null,
  status            text not null check (status in ('to_request', 'requested', 'simulated', 'collected', 'not_needed')),
  reference         text,
  note              text,
  updated_at        timestamptz not null,
  version           int not null default 1,
  unique (job_id, source_key)
);
select core.enable_tenant_isolation('migration.card_recollections');

---------------------------------------------------------------------------------------------------------
-- Routing metadata for the scheduler (reminders, rollback-window closing, retention purge): tenant ids only.
---------------------------------------------------------------------------------------------------------
create or replace function migration.tenants_with_open_jobs(p_after uuid, p_limit int)
  returns table (tenant_id uuid, environment text, closed boolean)
  language sql stable security definer set search_path = migration, pg_temp as $$
    -- Paged by tenant id (a cursor), so every tenant is visited however many there are (R-P2-7). A tenant leaves
    -- the set once its jobs have ended and been purged (rehearsal copies end with their live job, R-P1-6). A closed
    -- organization (an ended trial) is still listed, flagged, so its source data is purged at once.
    select t.tenant_id, s.environment, coalesce(s.status = 'closed', false)
      from (select distinct j.tenant_id from migration.jobs j
             where (j.state not in ('completed', 'rolled_back', 'cancelled', 'failed') or j.purged_at is null)
               and (p_after is null or j.tenant_id > p_after)) t
      cross join lateral (select * from platform.tenant_summaries(array[t.tenant_id])) s
     order by t.tenant_id
     limit p_limit
$$;
revoke execute on function migration.tenants_with_open_jobs(uuid, int) from public;
grant execute on function migration.tenants_with_open_jobs(uuid, int) to portico_app;

-- The state of a live job, for its rehearsal copy in a trial organization (routing metadata only: one state word,
-- 'missing' when the job or its organization no longer exists). Lets the trial's housekeeping end the copy even when
-- the live side cannot answer (R-P1-6).
create or replace function migration.live_job_state(p_job uuid)
  returns text
  language sql stable security definer set search_path = migration, pg_temp as $$
    select coalesce((select j.state from migration.jobs j where j.id = p_job), 'missing')
$$;
revoke execute on function migration.live_job_state(uuid) from public;
grant execute on function migration.live_job_state(uuid) to portico_app;

select core.apply_standard_grants('migration');
-- Append-only after the standard grants (the grants would otherwise restore update/delete).
select core.make_append_only('migration.extracts');
select core.make_append_only('migration.reports');
select core.make_append_only('migration.signoffs');
select core.make_append_only('migration.authorizations');
revoke delete, truncate on migration.cutover_journal from portico_app;
