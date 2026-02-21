# AMAprice.sh - Terminal-first e-commerce price tracking

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

`amaprice` is a terminal-first CLI to check Amazon prices, track products, and build shared price history automatically.

![AMAprice CLI preview](docs/preview.png)

## Install

```bash
npm install -g amaprice
```

## Quickstart

```bash
# one-shot lookup
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6"

# start tracking with a tier
amaprice track B0DZ5P7JD6 --tier daily

# show history
amaprice history B0DZ5P7JD6 --limit 30

# list tracked products
amaprice list
```

## Commands

| Command | Description |
|---|---|
| `amaprice [url\|asin]` | Shortcut for `amaprice price [url\|asin]` |
| `amaprice price [url\|asin]` | One-shot lookup and silent history insert |
| `amaprice track [url\|asin]` | Track product + current price |
| `amaprice history <url\|asin>` | Show history (`--limit N`) |
| `amaprice list` | List tracked products + latest price |
| `amaprice sync --limit <n>` | Run background sync for due products |
| `amaprice tier <url\|asin> <hourly\|daily\|weekly>` | Set tier for tracked product |

All commands support `--json`.

## Testing

Run regression and parser tests:

```bash
npm test
```

## Tiered Background Model

Each product has:
- `tier`: `hourly`, `daily`, or `weekly`
- `tier_mode`: `auto` or `manual`
- `next_scrape_at`: when the worker should scrape next

How tiers are determined in `auto` mode:
- `hourly`: 2+ price changes in 48h, or >=5% change across 7 days
- `daily`: normal active products
- `weekly`: no observed change in 30 days

Worker behavior:
- claims due products
- scrapes with Playwright
- writes `price_history`
- writes `scrape_attempts` telemetry for block/error monitoring
- resets/backs off on failures
- updates next run with jitter

## Database Migration (Supabase)

Run this SQL in Supabase SQL Editor:

`supabase/migrations/20260220_add_tier_scheduler.sql`

`supabase/migrations/20260220_add_scrape_attempts.sql`

`supabase/migrations/20260220_add_worker_health_view.sql`

`supabase/migrations/20260220_grant_worker_health_select.sql`

`supabase/migrations/20260220_add_price_history_currency.sql`

These migrations add tier fields, indexes, telemetry, worker health rollups, and `price_history.currency`.

## Block Detection Queries

Products currently failing or likely blocked:

```sql
select asin, tier, consecutive_failures, last_error, last_scraped_at, next_scrape_at
from products
where consecutive_failures >= 3
   or last_error ilike '%captcha%'
   or last_error ilike '%robot%'
   or last_error ilike '%503%'
order by consecutive_failures desc, next_scrape_at asc;
```

Hourly block-rate from telemetry:

```sql
select
  date_trunc('hour', scraped_at) as hour,
  count(*) as total,
  sum(case when blocked_signal then 1 else 0 end) as blocked,
  round(100.0 * sum(case when blocked_signal then 1 else 0 end) / nullif(count(*), 0), 2) as blocked_pct
from scrape_attempts
where scraped_at >= now() - interval '24 hours'
group by 1
order by 1 desc;
```

Single-row worker health view:

```sql
select * from worker_health;
```

## Local/Worker Environment

Use env vars (recommended):

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_KEY="<anon-or-service-role-key>"
```

For production background workers, prefer the Supabase **service role key**.

## Railway Worker Deployment

This repo includes:
- `src/worker.js` (long-running loop worker)
- `railway.json` + `Dockerfile` (Playwright-ready runtime)

Steps:
1. Create a Railway project from this repo.
2. Add env vars: `SUPABASE_URL`, `SUPABASE_KEY`.
3. Optional env vars:
   - `SYNC_INTERVAL_MINUTES=5`
   - `SYNC_LIMIT=20`
4. Ensure builder is Dockerfile (root `Dockerfile`).
5. Deploy.
6. Confirm logs show `[worker] processed=...`.

If Railway still uses Railpack instead of Dockerfile, set builder to Dockerfile manually in Railway service settings and redeploy.

One-shot run for testing:

```bash
npm run worker:once
```

## Vercel Website Deployment (`amaprice.sh`)

Lean marketing site is a Next.js app in `website/`.

Steps:
1. Import the repo in Vercel.
2. Leave the project at repo root (deployment is controlled by root `vercel.json`).
3. Set website env vars:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy.
5. Add domain `amaprice.sh` in Vercel Domains and assign to this project.
6. Set `www.amaprice.sh` redirect to `amaprice.sh`.

Local website development:

```bash
cd website
npm install
npm run dev
```

## Community Price Data

`amaprice` contributes anonymized price snapshots (title, ASIN, price, timestamp) to a shared dataset.
No personal/device data is stored.

## License

MIT
