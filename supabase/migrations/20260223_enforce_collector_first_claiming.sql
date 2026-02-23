-- Enforce strict collector-first queue claiming.
-- Railway (p_collector_id is null) may claim:
--   - railway_only jobs always
--   - collector_first jobs only when no live active collector exists
-- Collector callers may claim collector_first/collector_only (or only collector_only if requested).

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
declare
  v_limit integer := greatest(coalesce(p_limit, 5), 1);
  v_lease_seconds integer := greatest(coalesce(p_lease_seconds, 90), 30);
  v_route_hint text := coalesce(p_route_hint, 'collector_first');
  v_has_live_collectors boolean := false;
begin
  -- A collector is considered live when active + recently seen.
  -- 10 minutes covers a 180s poll cadence with buffer for jitter/restarts.
  select exists (
    select 1
    from public.collectors c
    where c.status = 'active'
      and (c.paused_until is null or c.paused_until <= now())
      and c.last_seen_at is not null
      and c.last_seen_at >= now() - interval '10 minutes'
  )
  into v_has_live_collectors;

  return query
  with candidates as (
    select j.id
    from public.collection_jobs j
    where j.state = 'queued'
      and j.scheduled_for <= now()
      and (
        (
          -- Collector claim path.
          p_collector_id is not null
          and (
            (v_route_hint = 'collector_only' and j.route_hint = 'collector_only')
            or (v_route_hint <> 'collector_only' and j.route_hint in ('collector_first', 'collector_only'))
          )
        )
        or
        (
          -- Railway claim path.
          p_collector_id is null
          and (
            (v_route_hint = 'railway_only' and j.route_hint = 'railway_only')
            or (
              v_route_hint <> 'railway_only'
              and (
                j.route_hint = 'railway_only'
                or (j.route_hint = 'collector_first' and not v_has_live_collectors)
              )
            )
          )
        )
      )
    order by j.priority desc, j.scheduled_for asc
    for update skip locked
    limit v_limit
  ),
  leased as (
    update public.collection_jobs j
    set state = 'leased',
        leased_by = p_collector_id,
        lease_until = now() + make_interval(secs => v_lease_seconds),
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
