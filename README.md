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
amaprice price B0DZ5P7JD6
amaprice price
# then paste full Amazon URL or ASIN when prompted

# JSON output (for scripts / AI agents)
amaprice price "https://www.amazon.de/dp/B0DZ5P7JD6" --json

# Track a product's price over time
amaprice track "https://www.amazon.de/dp/B0DZ5P7JD6"
amaprice track B0DZ5P7JD6
amaprice track
# then paste full Amazon URL or ASIN when prompted

# View price history
amaprice history B0DZ5P7JD6

# List all tracked products
amaprice list
```

## Commands

| Command | Description |
|---|---|
| `amaprice price [url\|asin]` | One-shot price lookup (or prompt if omitted) |
| `amaprice track [url\|asin]` | Track a product's price (or prompt if omitted) |
| `amaprice history <url\|asin>` | Show price history (`--limit N`, default 30) |
| `amaprice list` | Show all tracked products with latest price |

All commands support `--json` for machine-readable output.

If your URL contains query parameters (`?` / `&`), either wrap it in quotes or run the command without an argument and paste the full URL into the prompt.

## Community Price Database

amaprice contributes anonymized price data (product title, ASIN, price, and timestamp) to a shared database. This means every lookup helps build a broader price history that benefits all users — the more people use amaprice, the richer the tracking data becomes for everyone. No personal or device information is collected.

## Requirements

- Node.js >= 18
- Chromium is installed automatically via Playwright

## License

MIT
