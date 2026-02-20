# Armor Price: Price Tracking in Your Terminal

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Playwright](https://img.shields.io/badge/Playwright-Chromium-2EAD33?logo=playwright&logoColor=white)](https://playwright.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![npm version](https://img.shields.io/npm/v/amaprice?logo=npm)](https://www.npmjs.com/package/amaprice)

`amaprice` is a CLI for fast product price lookup and tracking across major online stores, directly from your terminal.

## What "AMA Price" Means

**AMA Price** means **Ask Me Anything Price**.

Current reality:
- Amazon is fully supported today.
- Walmart and other major stores are planned next.

## Features

- One-shot price lookup from product URL or ASIN.
- Price tracking with timestamped history.
- Product list with latest tracked price.
- JSON output for scripts and AI agents (`--json`).
- Prompt mode when input is omitted.
- Shared community price database to improve market visibility over time.

## Store Support

| Store | Status | Notes |
|---|---|---|
| Amazon | ✅ | Implemented now |
| Walmart | ❌ | Planned (next priority) |
| eBay | ❌ | Planned |
| Target | ❌ | Planned |
| Best Buy | ❌ | Planned |
| Newegg | ❌ | Planned |

## Roadmap

1. Walmart support.
2. eBay and Target support.
3. Best Buy and Newegg support.
4. Additional major online stores.

## Installation

```bash
npm install -g amaprice
```

## Quick Start

```bash
# 1) One-shot price lookup
amaprice "https://www.amazon.de/dp/B0DZ5P7JD6"
amaprice B0DZ5P7JD6

# 2) Track a product (saves current price)
amaprice track "https://www.amazon.de/dp/B0DZ5P7JD6"
amaprice track B0DZ5P7JD6

# 3) View history
amaprice history B0DZ5P7JD6

# 4) List tracked products
amaprice list
```

If you run a command without input, `amaprice` prompts you to paste a full product URL or ASIN.

## Command Reference

| Command | Description |
|---|---|
| `amaprice [url\|asin]` | Shortcut for `amaprice price [url\|asin]` |
| `amaprice price [url\|asin]` | One-shot price lookup (or prompt if omitted) |
| `amaprice track [url\|asin]` | Save product and current price (or prompt if omitted) |
| `amaprice history <url\|asin>` | Show price history (`--limit N`, default 30) |
| `amaprice list` | Show all tracked products with latest price |

All commands support `--json` for machine-readable output.

If a URL contains query parameters (`?` / `&`), wrap it in quotes or run the command without an argument and paste the full URL into the prompt.

## Community Price Data

`amaprice` contributes anonymized price snapshots (product title, ASIN, price, timestamp) to a shared database. Every lookup helps build richer price history for everyone.

No personal or device information is collected.

## Requirements

- Node.js >= 18
- Chromium is installed automatically by Playwright during install

## License

MIT
