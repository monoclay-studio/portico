-- Scheduled background jobs: one row per job, claimed atomically so only one worker replica runs a job per interval.
create table core.job_runs (
  name             text primary key,
  last_started_at  timestamptz,
  last_finished_at timestamptz,
  last_status      text check (last_status in ('running', 'succeeded', 'failed')),
  last_error       text,
  run_count        bigint not null default 0
);

create or replace function core.claim_job(p_name text, p_interval_seconds int, p_lease_seconds int) returns boolean
  language plpgsql security definer set search_path = core, pg_temp as $$
declare claimed boolean;
begin
  insert into core.job_runs (name) values (p_name) on conflict (name) do nothing;
  update core.job_runs
     set last_started_at = clock_timestamp(), last_status = 'running', run_count = run_count + 1
   where name = p_name
     and (last_started_at is null
          or (last_status <> 'running' and last_started_at < clock_timestamp() - make_interval(secs => p_interval_seconds))
          or (last_status = 'running' and last_started_at < clock_timestamp() - make_interval(secs => p_lease_seconds)))
  returning true into claimed;
  return coalesce(claimed, false);
end $$;

create or replace function core.finish_job(p_name text, p_ok boolean, p_error text) returns void
  language sql security definer set search_path = core, pg_temp as $$
    update core.job_runs set last_finished_at = clock_timestamp(),
      last_status = case when p_ok then 'succeeded' else 'failed' end, last_error = left(p_error, 4000)
     where name = p_name
$$;

-- Idempotency records hold response bodies, which can contain personal data: expire them.
alter table core.idempotency_keys add column expires_at timestamptz not null default (clock_timestamp() + interval '30 days');
create index idempotency_keys_expiry_idx on core.idempotency_keys (expires_at);

create or replace function core.purge_expired_idempotency_keys(p_batch int) returns int
  language plpgsql security definer set search_path = core, pg_temp as $$
declare n int;
begin
  delete from core.idempotency_keys where ctid in (
    select ctid from core.idempotency_keys where expires_at < clock_timestamp() limit p_batch);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on core.job_runs from portico_app;
revoke execute on function core.claim_job(text, int, int), core.finish_job(text, boolean, text),
  core.purge_expired_idempotency_keys(int) from public;
grant execute on function core.claim_job(text, int, int), core.finish_job(text, boolean, text),
  core.purge_expired_idempotency_keys(int) to portico_app;
