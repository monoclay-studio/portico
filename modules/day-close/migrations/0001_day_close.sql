-- Day Close (spec docs/specs/day-close.md, DCL-*). Ends a property's business day as a resumable, non-blocking
-- process: runs and their ordered steps, per-item progress committed with each effect, the stay-night posting
-- register (one row per stay and night, whatever the number of runs, resumes or crashes), deferred lines whose
-- service date is later than their night, overrides with reasons, Day Close's own follow-up issues, immutable day
-- facts and day reports, and per-property schedules. No foreign keys into other schemas: property, stay, booking,
-- folio and user ids are references only.
create schema day_close;

---------------------------------------------------------------------------------------------------------
-- Runs: one per property and business date (unless cancelled); at most one non-terminal run per property.
---------------------------------------------------------------------------------------------------------
create table day_close.runs (
  id              uuid primary key,
  tenant_id       uuid not null,
  property_id     uuid not null,
  business_date   date not null,
  status          text not null check (status in ('preflight', 'blocked', 'running', 'failed', 'completed', 'cancelled')),
  trigger         text not null check (trigger in ('manual', 'schedule', 'api')),
  started_by      text not null,
  started_by_name text,
  started_at      timestamptz not null,
  finished_at     timestamptz,
  current_step    text,
  failure         jsonb,
  -- Execution lease: only the holder commits step effects; a crashed holder's lease expires and resume takes over.
  lease_owner     text,
  lease_until     timestamptz,
  heartbeat_at    timestamptz,
  auto_continue   boolean not null default false,
  retry_count     int not null default 0,
  next_retry_at   timestamptz,
  cancel_reason   text,
  executions      jsonb not null default '[]',
  version         int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
select core.enable_tenant_isolation('day_close.runs');
-- DCL-I05 / DCL-R06: at most one non-terminal run per property.
create unique index runs_one_active_per_property on day_close.runs (tenant_id, property_id)
  where status in ('preflight', 'blocked', 'running', 'failed');
-- One run per business date (a cancelled run can be followed by a new one).
create unique index runs_one_per_business_date on day_close.runs (tenant_id, property_id, business_date)
  where status <> 'cancelled';
create index runs_property_date_idx on day_close.runs (tenant_id, property_id, business_date desc);

-- A completed or cancelled run is final.
create or replace function day_close.guard_run_update() returns trigger
  language plpgsql as $$
begin
  if old.status in ('completed', 'cancelled') and new.status <> old.status then
    raise exception 'Day Close run % is % and cannot change to %.', old.id, old.status, new.status
      using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger runs_guard before update on day_close.runs
  for each row execute function day_close.guard_run_update();
create trigger runs_no_delete before delete on day_close.runs
  for each row execute function core.reject_mutation();

---------------------------------------------------------------------------------------------------------
-- Steps: ordered, idempotent; status, counts, timings, errors.
---------------------------------------------------------------------------------------------------------
create table day_close.steps (
  tenant_id   uuid not null,
  run_id      uuid not null references day_close.runs(id),
  key         text not null check (key in ('preflight', 'no_shows', 'room_and_package_postings', 'allowance_close',
                                           'payments_housekeeping', 'integrity', 'final_sweep', 'advance',
                                           'post_advance')),
  ordinal     int  not null,
  status      text not null check (status in ('pending', 'running', 'completed', 'failed', 'skipped')),
  total       int,
  done        int  not null default 0,
  failed      int  not null default 0,
  skipped     int  not null default 0,
  detail      jsonb not null default '{}',
  error       jsonb,
  attempts    int  not null default 0,
  started_at  timestamptz,
  finished_at timestamptz,
  version     int  not null default 1,
  primary key (run_id, key),
  unique (run_id, ordinal)
);
select core.enable_tenant_isolation('day_close.steps');

-- Resume never redoes: a completed step stays completed. DCL-I02: `advance` completes only after `integrity`
-- completed in the same run (enforced here as well as in the engine).
create or replace function day_close.guard_step_update() returns trigger
  language plpgsql as $$
begin
  if old.status in ('completed', 'skipped') and new.status <> old.status then
    raise exception 'Day Close step % of run % is already % and is never re-run.', old.key, old.run_id, old.status
      using errcode = 'P0001';
  end if;
  if new.key = 'advance' and new.status = 'completed' and not exists (
      select 1 from day_close.steps s where s.run_id = new.run_id and s.key = 'integrity' and s.status = 'completed') then
    raise exception 'The business date cannot advance before the integrity step of run % has passed (DCL-I02).', new.run_id
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger steps_guard before update on day_close.steps
  for each row execute function day_close.guard_step_update();
create trigger steps_no_delete before delete on day_close.steps
  for each row execute function core.reject_mutation();

---------------------------------------------------------------------------------------------------------
-- Step items: per-item progress committed in the SAME transaction as the item's effects ("88 of 112").
---------------------------------------------------------------------------------------------------------
create table day_close.step_items (
  id          uuid primary key,
  tenant_id   uuid not null,
  run_id      uuid not null references day_close.runs(id),
  step_key    text not null,
  item_key    text not null,
  ref_type    text,
  ref_id      uuid,
  status      text not null check (status in ('done', 'failed', 'skipped')),
  result      jsonb not null default '{}',
  error       jsonb,
  attempts    int  not null default 1,
  updated_at  timestamptz not null,
  unique (tenant_id, run_id, step_key, item_key)
);
select core.enable_tenant_isolation('day_close.step_items');
create index step_items_run_idx on day_close.step_items (run_id, step_key, status);

-- A done item stays done (its effects are committed with it).
create or replace function day_close.guard_item_update() returns trigger
  language plpgsql as $$
begin
  if old.status = 'done' and new.status <> 'done' then
    raise exception 'Day Close item % (%) is done and is never redone.', old.item_key, old.step_key
      using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger step_items_guard before update on day_close.step_items
  for each row execute function day_close.guard_item_update();
create trigger step_items_no_delete before delete on day_close.step_items
  for each row execute function core.reject_mutation();

---------------------------------------------------------------------------------------------------------
-- Stay-night posting register (DCL-I01 at Day Close level; finance's unique idempotency keys are the ledger guard).
---------------------------------------------------------------------------------------------------------
create table day_close.night_postings (
  tenant_id     uuid not null,
  property_id   uuid not null,
  stay_id       uuid not null,
  night         date not null,
  run_id        uuid not null references day_close.runs(id),
  business_date date not null,
  posting_keys  text[] not null,
  entry_ids     uuid[] not null,
  amounts       jsonb not null,
  catch_up      boolean not null,
  posted_at     timestamptz not null,
  primary key (tenant_id, stay_id, night)
);
select core.enable_tenant_isolation('day_close.night_postings');
select core.make_append_only('day_close.night_postings');
create index night_postings_property_night_idx on day_close.night_postings (tenant_id, property_id, night);

---------------------------------------------------------------------------------------------------------
-- Agreement-line register (review P0-1): every plan line Day Close posted, keyed by rates' stable line identity
-- (`lineKey`: the component and its occurrence, never the night it happens to be allocated to). A re-price that moves
-- a line to another night keeps its identity, so it is never posted twice and a missing one is visible.
---------------------------------------------------------------------------------------------------------
create table day_close.line_postings (
  tenant_id      uuid not null,
  property_id    uuid not null,
  stay_id        uuid not null,
  line_key       text not null,
  night          date not null,
  service_date   date not null,
  kind           text not null,
  amount_minor   bigint not null,
  currency       char(3) not null,
  -- posted: Day Close posted it; conflict: finance already held the key with other content (follow-up raised).
  outcome        text not null check (outcome in ('posted', 'conflict')),
  entry_id       uuid,
  run_id         uuid not null references day_close.runs(id),
  business_date  date not null,
  posted_at      timestamptz not null,
  primary key (tenant_id, stay_id, line_key)
);
select core.enable_tenant_isolation('day_close.line_postings');
select core.make_append_only('day_close.line_postings');
create index line_postings_service_idx on day_close.line_postings (tenant_id, property_id, service_date);

---------------------------------------------------------------------------------------------------------
-- Expected future-dated lines (e.g. the departure transfer, allocated to the last night but served on departure
-- day): recomputed from the agreement in force at every close (pending → posted | cancelled), posted the moment
-- their service date becomes the business date (right after the advance, before the guest checks out).
---------------------------------------------------------------------------------------------------------
create table day_close.deferred_lines (
  id               uuid primary key,
  tenant_id        uuid not null,
  property_id      uuid not null,
  stay_id          uuid not null,
  line_key         text not null,
  night            date not null,
  service_date     date not null,
  line             jsonb not null,
  status           text not null check (status in ('pending', 'posted', 'cancelled')),
  status_reason    text,
  created_run_id   uuid not null,
  updated_run_id   uuid not null,
  updated_at       timestamptz not null,
  version          int not null default 1,
  unique (tenant_id, stay_id, line_key)
);
select core.enable_tenant_isolation('day_close.deferred_lines');
create index deferred_lines_due_idx on day_close.deferred_lines (tenant_id, property_id, status, service_date);

---------------------------------------------------------------------------------------------------------
-- Decisions about a stay-night a person took over (review P1-1): an overridden night is a decision, not a gap.
-- The latest decision per stay-night wins: skip_pending (blocks until decided), posted_elsewhere, post_by_day_close.
---------------------------------------------------------------------------------------------------------
create table day_close.night_decisions (
  id           uuid primary key,
  tenant_id    uuid not null,
  property_id  uuid not null,
  stay_id      uuid not null,
  night        date not null,
  decision     text not null check (decision in ('skip_pending', 'posted_elsewhere', 'post_by_day_close')),
  run_id       uuid,
  reason       text not null,
  actor        text not null,
  created_at   timestamptz not null
);
select core.enable_tenant_isolation('day_close.night_decisions');
select core.make_append_only('day_close.night_decisions');
create index night_decisions_stay_idx on day_close.night_decisions (tenant_id, stay_id, night, created_at);

---------------------------------------------------------------------------------------------------------
-- Stays to keep in sight until their nights are posted (review P2-2): checked in after a night of theirs closed, or
-- seen at a close and gone before the next one. Lets the next close charge them, or flag them, even after departure.
---------------------------------------------------------------------------------------------------------
create table day_close.watched_stays (
  tenant_id    uuid not null,
  property_id  uuid not null,
  stay_id      uuid not null,
  from_night   date not null,
  -- Last departure reservations announced for the stay (check-in / extension / shortening / check-out events): the
  -- bound of the nights to check even when the stay's agreement can no longer be read.
  departure    date not null,
  reason       text not null,
  created_at   timestamptz not null,
  updated_at   timestamptz not null,
  resolved_at  timestamptz,
  primary key (tenant_id, stay_id)
);
select core.enable_tenant_isolation('day_close.watched_stays');

---------------------------------------------------------------------------------------------------------
-- Overrides of blocking items: permission + reason per item, append-only (EC-DCL-009).
---------------------------------------------------------------------------------------------------------
create table day_close.overrides (
  id           uuid primary key,
  tenant_id    uuid not null,
  run_id       uuid not null references day_close.runs(id),
  property_id  uuid not null,
  item_key     text not null,
  code         text not null,
  ref          jsonb,
  reason       text not null check (length(btrim(reason)) >= 3),
  actor        text not null,
  actor_name   text,
  created_at   timestamptz not null,
  unique (tenant_id, run_id, item_key)
);
select core.enable_tenant_isolation('day_close.overrides');
select core.make_append_only('day_close.overrides');

---------------------------------------------------------------------------------------------------------
-- Day Close's own follow-ups (no-show fee to collect, failed items, integrity alarm, export pending…).
---------------------------------------------------------------------------------------------------------
create table day_close.issues (
  id             uuid primary key,
  tenant_id      uuid not null,
  property_id    uuid not null,
  business_date  date not null,
  run_id         uuid,
  code           text not null,
  severity       text not null check (severity in ('blocking', 'warning', 'info')),
  dedupe_key     text not null,
  ref_type       text,
  ref_id         text,
  message        text not null,
  owner          jsonb,
  details        jsonb not null default '{}',
  status         text not null check (status in ('open', 'resolved')),
  created_at     timestamptz not null,
  resolved_at    timestamptz,
  resolved_by    text,
  resolution     text,
  version        int not null default 1,
  unique (tenant_id, dedupe_key)
);
select core.enable_tenant_isolation('day_close.issues');
create index issues_open_idx on day_close.issues (tenant_id, property_id, status);

---------------------------------------------------------------------------------------------------------
-- Immutable day facts (DCL-I03) and day reports (DCL-R07). Later corrections appear as restatements.
---------------------------------------------------------------------------------------------------------
create table day_close.day_facts (
  tenant_id      uuid not null,
  property_id    uuid not null,
  business_date  date not null,
  run_id         uuid not null references day_close.runs(id),
  facts          jsonb not null,
  generated_at   timestamptz not null,
  primary key (tenant_id, property_id, business_date)
);
select core.enable_tenant_isolation('day_close.day_facts');
select core.make_append_only('day_close.day_facts');

create table day_close.day_reports (
  tenant_id      uuid not null,
  property_id    uuid not null,
  business_date  date not null,
  run_id         uuid not null references day_close.runs(id),
  pack           jsonb not null,
  generated_at   timestamptz not null,
  primary key (tenant_id, property_id, business_date)
);
select core.enable_tenant_isolation('day_close.day_reports');
select core.make_append_only('day_close.day_reports');

---------------------------------------------------------------------------------------------------------
-- Schedules (DCL-R05) and their log (changes, skip-today, fired).
---------------------------------------------------------------------------------------------------------
create table day_close.schedules (
  tenant_id      uuid not null,
  property_id    uuid not null,
  enabled        boolean not null,
  local_time     text not null check (local_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  timezone       text not null,
  auto_continue  boolean not null default true,
  -- Who enabled the schedule (they held platform.businessDate.advance at the property — review P2-12).
  configured_by  text,
  next_due_at    timestamptz,
  skip_date      date,
  version        int not null default 1,
  updated_at     timestamptz not null,
  primary key (tenant_id, property_id)
);
select core.enable_tenant_isolation('day_close.schedules');

create table day_close.schedule_log (
  id            uuid primary key,
  tenant_id     uuid not null,
  property_id   uuid not null,
  event         text not null check (event in ('configured', 'skipped_today', 'fired', 'fire_refused', 'overdue')),
  business_date date,
  detail        jsonb not null default '{}',
  actor         text not null,
  created_at    timestamptz not null
);
select core.enable_tenant_isolation('day_close.schedule_log');
select core.make_append_only('day_close.schedule_log');

---------------------------------------------------------------------------------------------------------
-- Routing for the worker (reviewed SECURITY DEFINER): which tenants/properties have due schedules, crashed or
-- auto-continuing runs, or failed runs due for an automatic retry. Returns routing metadata only.
---------------------------------------------------------------------------------------------------------
create or replace function day_close.due_work(p_now timestamptz)
  returns table (tenant_id uuid, property_id uuid, run_id uuid, kind text)
  language sql stable security definer set search_path = day_close, pg_temp as $$
    select s.tenant_id, s.property_id, null::uuid, 'schedule'::text
      from day_close.schedules s
     where s.enabled and s.next_due_at is not null and s.next_due_at <= p_now
    union all
    select r.tenant_id, r.property_id, r.id, 'resume'::text
      from day_close.runs r
     where (r.status in ('preflight', 'running', 'blocked') and r.auto_continue
            and (r.lease_until is null or r.lease_until < p_now))
        or (r.status = 'failed' and r.next_retry_at is not null and r.next_retry_at <= p_now)
$$;
revoke execute on function day_close.due_work(timestamptz) from public;

-- Dead-man's switch (review P2-7): schedules whose close should have fired and finished (next due long past, or an
-- active run started long ago). Checked by a separate job; returns routing metadata only.
create or replace function day_close.overdue_closes(p_now timestamptz, p_grace interval)
  returns table (tenant_id uuid, property_id uuid)
  language sql stable security definer set search_path = day_close, pg_temp as $$
    select s.tenant_id, s.property_id from day_close.schedules s
     where s.enabled and s.next_due_at is not null and s.next_due_at < p_now - p_grace
    union
    select r.tenant_id, r.property_id from day_close.runs r
     where r.status in ('preflight', 'blocked', 'running', 'failed') and r.started_at < p_now - p_grace * 3
$$;
revoke execute on function day_close.overdue_closes(timestamptz, interval) from public;

select core.apply_standard_grants('day_close');
