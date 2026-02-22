-- Hybrid orchestration model:
-- - shared product subscriptions
-- - collector registry + heartbeat
-- - collection jobs + attempts
-- - latest-price materialization table
-- - queue helper RPCs
--
-- This migration is additive and does not remove existing worker tables/functions.

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  product_id uuid not null references public.products(id) on delete cascade,
  tier_pref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_subscriptions_tier_pref_check'
  ) then
    alter table public.user_subscriptions
      add constraint user_subscriptions_tier_pref_check
      check (tier_pref is null or tier_pref in ('hourly', 'daily', 'weekly'));
  end if;
end $$;

create index if not exists user_subscriptions_user_active_idx
  on public.user_subscriptions (user_id, is_active, created_at desc);

create index if not exists user_subscriptions_product_active_idx
  on public.user_subscriptions (product_id, is_active);

create table if not exists public.collectors (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null,
  kind text not null default 'cli',
  status text not null default 'active',
  capabilities jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  heartbeat_interval_seconds integer not null default 30,
  last_seen_at timestamptz,
  paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'collectors_kind_check'
  ) then
    alter table public.collectors
      add constraint collectors_kind_check
      check (kind in ('cli', 'extension'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'collectors_status_check'
  ) then
    alter table public.collectors
      add constraint collectors_status_check
      check (status in ('active', 'paused', 'revoked'));
  end if;
end $$;

create index if not exists collectors_user_status_idx
  on public.collectors (user_id, status, last_seen_at desc);

create table if not exists public.collection_jobs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  asin text,
  domain text,
  scheduled_for timestamptz not null default now(),
  priority integer not null default 100,
  state text not null default 'queued',
  route_hint text not null default 'collector_first',
  leased_by uuid references public.collectors(id) on delete set null,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  dedupe_key text not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'collection_jobs_state_check'
  ) then
    alter table public.collection_jobs
      add constraint collection_jobs_state_check
      check (state in ('queued', 'leased', 'done', 'failed', 'dead'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'collection_jobs_route_hint_check'
  ) then
    alter table public.collection_jobs
      add constraint collection_jobs_route_hint_check
      check (route_hint in ('collector_first', 'collector_only', 'railway_only'));
  end if;
end $$;

create index if not exists collection_jobs_state_schedule_idx
  on public.collection_jobs (state, scheduled_for, priority desc);

create index if not exists collection_jobs_product_state_idx
  on public.collection_jobs (product_id, state, created_at desc);

create unique index if not exists collection_jobs_active_dedupe_idx
  on public.collection_jobs (dedupe_key)
  where state in ('queued', 'leased');

create table if not exists public.collection_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.collection_jobs(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  collector_id uuid references public.collectors(id) on delete set null,
  executor text not null,
  method text not null,
  status text not null,
  http_status integer,
  blocked_signal boolean not null default false,
  error_code text,
  error_message text,
  price numeric,
  currency text,
  confidence numeric,
  debug jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'collection_attempts_executor_check'
  ) then
    alter table public.collection_attempts
      add constraint collection_attempts_executor_check
      check (executor in ('collector', 'railway'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'collection_attempts_method_check'
  ) then
    alter table public.collection_attempts
      add constraint collection_attempts_method_check
      check (method in ('html_json', 'vision', 'railway_dom'));
  end if;
end $$;

create index if not exists collection_attempts_job_started_idx
  on public.collection_attempts (job_id, started_at desc);

create index if not exists collection_attempts_product_started_idx
  on public.collection_attempts (product_id, started_at desc);

create table if not exists public.product_latest_price (
  product_id uuid primary key references public.products(id) on delete cascade,
  price numeric not null,
  currency text,
  scraped_at timestamptz not null,
  source text not null,
  confidence numeric,
  updated_at timestamptz not null default now()
);

create index if not exists product_latest_price_scraped_idx
  on public.product_latest_price (scraped_at desc);

create or replace function public.enqueue_due_collection_jobs(p_limit integer default 20)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 20), 1);
  v_count bigint := 0;
begin
  with due as (
    select p.id, p.asin, p.domain
    from public.products p
    where p.is_active = true
      and p.next_scrape_at <= now()
    order by p.next_scrape_at asc
    limit v_limit
  ),
  ins as (
    insert into public.collection_jobs (
      product_id,
      asin,
      domain,
      scheduled_for,
      priority,
      state,
      route_hint,
      dedupe_key
    )
    select
      d.id,
      d.asin,
      d.domain,
      now(),
      100,
      'queued',
      'collector_first',
      concat(d.id::text, ':', to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI'))
    from due d
    where not exists (
      select 1
      from public.collection_jobs j
      where j.product_id = d.id
        and j.state in ('queued', 'leased')
    )
    returning 1
  )
  select count(*) into v_count from ins;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.claim_collection_jobs(
  p_collector_id uuid,
  p_limit integer default 5,
  p_lease_seconds integer default 90,
  p_route_hint text default null
)
returns table (
  id uuid,
  product_id uuid,
  asin text,
  domain text,
  url text,
  tier text,
  tier_mode text,
  last_price numeric,
  consecutive_failures integer,
  state text,
  attempt_count integer,
  max_attempts integer,
  scheduled_for timestamptz,
  lease_until timestamptz,
  route_hint text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select j.id
    from public.collection_jobs j
    where j.state = 'queued'
      and j.scheduled_for <= now()
      and (
        p_route_hint is null
        or j.route_hint = p_route_hint
        or (p_route_hint = 'collector_first' and j.route_hint = 'collector_only')
      )
    order by j.priority desc, j.scheduled_for asc
    for update skip locked
    limit greatest(coalesce(p_limit, 5), 1)
  ),
  leased as (
    update public.collection_jobs j
    set state = 'leased',
        leased_by = p_collector_id,
        lease_until = now() + make_interval(secs => greatest(coalesce(p_lease_seconds, 90), 30)),
        attempt_count = coalesce(j.attempt_count, 0) + 1,
        updated_at = now()
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select
    l.id,
    l.product_id,
    p.asin,
    p.domain,
    p.url,
    p.tier,
    p.tier_mode,
    p.last_price,
    p.consecutive_failures,
    l.state,
    l.attempt_count,
    l.max_attempts,
    l.scheduled_for,
    l.lease_until,
    l.route_hint
  from leased l
  join public.products p on p.id = l.product_id;
end;
$$;

create or replace function public.complete_collection_job(
  p_job_id uuid,
  p_state text,
  p_last_error text default null,
  p_next_scheduled_for timestamptz default null
)
returns public.collection_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.collection_jobs;
begin
  update public.collection_jobs j
  set state = p_state,
      last_error = p_last_error,
      scheduled_for = coalesce(p_next_scheduled_for, j.scheduled_for),
      leased_by = null,
      lease_until = null,
      updated_at = now()
  where j.id = p_job_id
  returning j.* into v_job;

  return v_job;
end;
$$;

create or replace function public.requeue_expired_collection_jobs(p_limit integer default 100)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 100), 1);
  v_count bigint := 0;
begin
  with expired as (
    select j.id
    from public.collection_jobs j
    where j.state = 'leased'
      and j.lease_until is not null
      and j.lease_until < now()
    order by j.lease_until asc
    limit v_limit
  ),
  bumped as (
    update public.collection_jobs j
    set
      state = case
        when j.attempt_count >= j.max_attempts then 'dead'
        else 'queued'
      end,
      leased_by = null,
      lease_until = null,
      scheduled_for = case
        when j.attempt_count >= j.max_attempts then j.scheduled_for
        else now() + interval '2 minutes'
      end,
      updated_at = now()
    from expired e
    where j.id = e.id
    returning 1
  )
  select count(*) into v_count from bumped;

  return coalesce(v_count, 0);
end;
$$;

create or replace function public.heartbeat_collector(
  p_collector_id uuid,
  p_status text default 'active',
  p_capabilities jsonb default null,
  p_metadata jsonb default null
)
returns public.collectors
language plpgsql
security definer
set search_path = public
as $$
declare
  v_collector public.collectors;
begin
  update public.collectors c
  set status = coalesce(p_status, c.status),
      capabilities = coalesce(p_capabilities, c.capabilities),
      metadata = coalesce(p_metadata, c.metadata),
      last_seen_at = now(),
      updated_at = now()
  where c.id = p_collector_id
  returning c.* into v_collector;

  return v_collector;
end;
$$;
