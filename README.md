# amaprice

CLI tool to scrape and track Amazon product prices, with optional Supabase-backed price history.

## Install

```bash
npm install -g amaprice
```

## Quick Start

```bash
# One-shot price lookup (no Supabase needed)
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6"

# JSON output (for scripts / AI agents)
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6" --json
```

## Commands

| Command | Description | Requires Supabase |
|---|---|---|
| `amaprice price <url>` | One-shot price lookup | No |
| `amaprice track <url>` | Save product + current price to Supabase | Yes |
| `amaprice history <url\|asin>` | Show price history (`--limit N`, default 30) | Yes |
| `amaprice list` | Show all tracked products with latest price | Yes |
| `amaprice init` | Interactive Supabase credential setup | N/A |

All commands support `--json` for machine-readable output.

## Supabase Setup

1. Create a [Supabase](https://supabase.com) project
2. Run `amaprice init` and enter your project URL + anon key
3. Execute the SQL schema printed by `init` in your Supabase SQL editor

### Config Priority

1. Environment variables `SUPABASE_URL` + `SUPABASE_KEY`
2. `~/.amaprice/config.json` (created by `amaprice init`)
3. `.env` file in current directory

## Requirements

- Node.js >= 18
- Chromium is installed automatically via Playwright

## License

MIT
