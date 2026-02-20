# amaprice

CLI tool to look up and track Amazon product prices.

## Install

```bash
npm install -g amaprice
```

## Usage

```bash
# One-shot price lookup
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6"

# JSON output (for scripts / AI agents)
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6" --json

# Track a product's price over time
amaprice track "https://www.amazon.de/dp/B0DZ5P7JD6"

# View price history
amaprice history B0DZ5P7JD6

# List all tracked products
amaprice list
```

## Commands

| Command | Description |
|---|---|
| `amaprice price <url>` | One-shot price lookup |
| `amaprice track <url>` | Track a product's price |
| `amaprice history <url\|asin>` | Show price history (`--limit N`, default 30) |
| `amaprice list` | Show all tracked products with latest price |

All commands support `--json` for machine-readable output.

## Requirements

- Node.js >= 18
- Chromium is installed automatically via Playwright

## License

MIT
