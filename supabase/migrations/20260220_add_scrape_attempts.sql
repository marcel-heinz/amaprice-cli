-- Scrape telemetry for block-rate and reliability monitoring.
-- Run this migration in Supabase SQL editor.

create table if not exists public.scrape_attempts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  status text not null,
  http_status integer,
  blocked_signal boolean not null default false,
  error_code text,
  error_message text,
  price numeric,
  currency text,
  scraped_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'scrape_attempts_status_check'
  ) then
    alter table public.scrape_attempts
      add constraint scrape_attempts_status_check
      check (
        status in (
          'ok',
          'no_price',
          'captcha',
          'robot_check',
          'http_503',
          'http_429',
          'timeout',
          'network_error',
          'other_error'
        )
      );
  end if;
end $$;

create index if not exists scrape_attempts_product_scraped_idx
  on public.scrape_attempts (product_id, scraped_at desc);

create index if not exists scrape_attempts_scraped_idx
  on public.scrape_attempts (scraped_at desc);

create index if not exists scrape_attempts_blocked_idx
  on public.scrape_attempts (blocked_signal, scraped_at desc);

