-- Worker health rollup view for quick operational checks.
-- Run this migration in Supabase SQL editor.

create or replace view public.worker_health as
with
attempts_1h as (
  select
    count(*)::bigint as total_attempts_1h,
    count(*) filter (where status = 'ok')::bigint as ok_attempts_1h,
    count(*) filter (where status <> 'ok')::bigint as failed_attempts_1h,
    count(*) filter (where blocked_signal)::bigint as blocked_attempts_1h
  from public.scrape_attempts
  where scraped_at >= now() - interval '1 hour'
),
attempts_24h as (
  select
    count(*)::bigint as total_attempts_24h,
    count(*) filter (where status = 'ok')::bigint as ok_attempts_24h,
    count(*) filter (where status <> 'ok')::bigint as failed_attempts_24h,
    count(*) filter (where blocked_signal)::bigint as blocked_attempts_24h
  from public.scrape_attempts
  where scraped_at >= now() - interval '24 hours'
),
last_events as (
  select
    max(scraped_at) as last_attempt_at,
    max(scraped_at) filter (where status = 'ok') as last_ok_at,
    max(scraped_at) filter (where status <> 'ok') as last_error_at,
    max(scraped_at) filter (where blocked_signal) as last_blocked_at
  from public.scrape_attempts
),
queue_stats as (
  select
    count(*) filter (where is_active = true)::bigint as active_products,
    count(*) filter (where is_active = true and next_scrape_at <= now())::bigint as due_now_products,
    count(*) filter (where is_active = true and consecutive_failures >= 3)::bigint as products_with_failures
  from public.products
)
select
  now() as observed_at,
  a1.total_attempts_1h,
  a1.ok_attempts_1h,
  a1.failed_attempts_1h,
  a1.blocked_attempts_1h,
  round((a1.blocked_attempts_1h::numeric * 100) / nullif(a1.total_attempts_1h, 0), 2) as blocked_pct_1h,
  a24.total_attempts_24h,
  a24.ok_attempts_24h,
  a24.failed_attempts_24h,
  a24.blocked_attempts_24h,
  round((a24.blocked_attempts_24h::numeric * 100) / nullif(a24.total_attempts_24h, 0), 2) as blocked_pct_24h,
  l.last_attempt_at,
  l.last_ok_at,
  l.last_error_at,
  l.last_blocked_at,
  q.active_products,
  q.due_now_products,
  q.products_with_failures,
  case
    when a1.total_attempts_1h = 0 and q.due_now_products > 0 then 'idle_or_stuck'
    when a1.blocked_attempts_1h > 0
      and ((a1.blocked_attempts_1h::numeric * 100) / nullif(a1.total_attempts_1h, 0)) >= 20 then 'blocked'
    when a1.total_attempts_1h >= 5 and a1.failed_attempts_1h >= a1.ok_attempts_1h then 'degraded'
    else 'healthy'
  end as health_status
from attempts_1h a1
cross join attempts_24h a24
cross join last_events l
cross join queue_stats q;

