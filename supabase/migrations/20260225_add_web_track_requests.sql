-- Website tracking intake queue and targeted enqueue helper.
-- This migration is additive.

create table if not exists public.web_track_requests (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  ip_hash text not null,
  source text not null default 'website',
  raw_input text not null,
  asin text,
  domain text,
  normalized_url text,
  product_id uuid references public.products(id) on delete set null,
  status text not null default 'queued',
  status_reason text,
  last_error text,
  request_meta jsonb not null default '{}'::jsonb,
  queued_at timestamptz,
  first_claimed_at timestamptz,
  first_live_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'web_track_requests_status_check'
  ) then
    alter table public.web_track_requests
      add constraint web_track_requests_status_check
      check (
        status in (
          'queued',
          'collecting',
          'live',
          'failed',
          'duplicate_live',
          'rate_limited',
          'rejected'
        )
      );
  end if;
end $$;

create index if not exists web_track_requests_created_idx
  on public.web_track_requests (created_at desc);

create index if not exists web_track_requests_status_created_idx
  on public.web_track_requests (status, created_at desc);

create index if not exists web_track_requests_product_created_idx
  on public.web_track_requests (product_id, created_at desc);

create index if not exists web_track_requests_visitor_created_idx
  on public.web_track_requests (visitor_id, created_at desc);

create index if not exists web_track_requests_ip_created_idx
  on public.web_track_requests (ip_hash, created_at desc);

create or replace function public.web_track_requests_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_web_track_requests_set_updated_at on public.web_track_requests;

create trigger trg_web_track_requests_set_updated_at
before update on public.web_track_requests
for each row
execute function public.web_track_requests_set_updated_at();

create or replace function public.enqueue_product_collection_job(
  p_product_id uuid,
  p_route_hint text default 'collector_first',
  p_priority integer default 180,
  p_schedule_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route_hint text := case
    when p_route_hint in ('collector_first', 'collector_only', 'railway_only') then p_route_hint
    else 'collector_first'
  end;
  v_schedule_at timestamptz := coalesce(p_schedule_at, now());
  v_product public.products;
  v_existing_job_id uuid;
begin
  if p_product_id is null then
    return null;
  end if;

  select p.*
  into v_product
  from public.products p
  where p.id = p_product_id
  for update;

  if not found then
    return null;
  end if;

  select j.id
  into v_existing_job_id
  from public.collection_jobs j
  where j.product_id = p_product_id
    and j.state in ('queued', 'leased')
  order by j.created_at desc
  limit 1;

  if v_existing_job_id is not null then
    return v_existing_job_id;
  end if;

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
  values (
    v_product.id,
    v_product.asin,
    v_product.domain,
    v_schedule_at,
    greatest(coalesce(p_priority, 180), 1),
    'queued',
    v_route_hint,
    concat(
      v_product.id::text,
      ':web:',
      to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'),
      ':',
      substr(gen_random_uuid()::text, 1, 8)
    )
  )
  returning id into v_existing_job_id;

  return v_existing_job_id;
end;
$$;
