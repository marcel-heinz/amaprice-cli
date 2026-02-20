-- Tiered scheduling model for automated price syncing.
-- Run this migration in Supabase SQL editor.

alter table public.products
  add column if not exists tier text not null default 'daily',
  add column if not exists tier_mode text not null default 'auto',
  add column if not exists is_active boolean not null default true,
  add column if not exists next_scrape_at timestamptz not null default now(),
  add column if not exists last_scraped_at timestamptz,
  add column if not exists last_price numeric,
  add column if not exists last_price_change_at timestamptz,
  add column if not exists consecutive_failures integer not null default 0,
  add column if not exists last_error text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_tier_check'
  ) then
    alter table public.products
      add constraint products_tier_check
      check (tier in ('hourly', 'daily', 'weekly'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'products_tier_mode_check'
  ) then
    alter table public.products
      add constraint products_tier_mode_check
      check (tier_mode in ('auto', 'manual'));
  end if;
end $$;

create index if not exists products_next_scrape_at_idx
  on public.products (next_scrape_at);

create index if not exists products_active_due_idx
  on public.products (is_active, next_scrape_at);

-- Atomically claim due products for a worker run.
create or replace function public.claim_due_products(p_limit integer default 20)
returns setof public.products
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select p.id
    from public.products p
    where p.is_active = true
      and p.next_scrape_at <= now()
    order by p.next_scrape_at asc
    for update skip locked
    limit greatest(coalesce(p_limit, 20), 1)
  ),
  claimed as (
    update public.products p
    set next_scrape_at = now() + interval '10 minutes'
    from due
    where p.id = due.id
    returning p.*
  )
  select * from claimed;
end;
$$;

