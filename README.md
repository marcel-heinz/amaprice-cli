# amaprice

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

`amaprice` is a terminal-first CLI to check Amazon prices, track products, and build shared price history automatically.

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
- resets/backs off on failures
- updates next run with jitter

## Database Migration (Supabase)

Run this SQL in Supabase SQL Editor:

`supabase/migrations/20260220_add_tier_scheduler.sql`

It adds tier fields, indexes, and the `claim_due_products` RPC for safe worker claiming.

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
- `railway.json` (`npm run worker`)

Steps:
1. Create a Railway project from this repo.
2. Add env vars: `SUPABASE_URL`, `SUPABASE_KEY`.
3. Optional env vars:
   - `SYNC_INTERVAL_MINUTES=5`
   - `SYNC_LIMIT=20`
4. Deploy.
5. Confirm logs show `[worker] processed=...`.

One-shot run for testing:

```bash
npm run worker:once
```

## Vercel Website Deployment (`amaprice.sh`)

Lean marketing site is in `website/`.

Steps:
1. Import the repo in Vercel.
2. Set **Root Directory** to `website`.
3. Deploy.
4. Add domain `amaprice.sh` in Vercel Domains and assign to this project.
5. Set `www.amaprice.sh` redirect to `amaprice.sh`.

## Community Price Data

`amaprice` contributes anonymized price snapshots (title, ASIN, price, timestamp) to a shared dataset.
No personal/device data is stored.

## License

MIT

