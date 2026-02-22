#!/usr/bin/env node

const { getClient } = require('../src/db');

function usage() {
  console.log([
    'Usage: node scripts/analyze-scrape-attempts.js [options]',
    '',
    'Options:',
    '  --hours <n>       Look back window in hours (default: 24)',
    '  --since <iso>     Absolute lower bound for scraped_at (overrides --hours)',
    '  --limit <n>       Max scrape_attempts rows to fetch (default: 5000)',
    '  --top <n>         Top rows for per-domain/per-asin sections (default: 10)',
    '  --status <value>  Filter by status (e.g. ok, no_price, captcha)',
    '  --domain <value>  Filter output to one domain (e.g. amazon.de)',
    '  --asin <value>    Filter output to one ASIN',
    '  --json            Print machine-readable JSON report',
    '  --help            Show this help',
  ].join('\n'));
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseArgs(argv) {
  const opts = {
    hours: 24,
    limit: 5000,
    top: 10,
    since: null,
    status: null,
    domain: null,
    asin: null,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--json') {
      opts.json = true;
      continue;
    }
    if (arg === '--hours') {
      opts.hours = toNumber(argv[++i], opts.hours);
      continue;
    }
    if (arg === '--limit') {
      opts.limit = Math.max(1, toNumber(argv[++i], opts.limit));
      continue;
    }
    if (arg === '--top') {
      opts.top = Math.max(1, toNumber(argv[++i], opts.top));
      continue;
    }
    if (arg === '--since') {
      opts.since = argv[++i] || null;
      continue;
    }
    if (arg === '--status') {
      opts.status = argv[++i] || null;
      continue;
    }
    if (arg === '--domain') {
      opts.domain = argv[++i] || null;
      continue;
    }
    if (arg === '--asin') {
      opts.asin = argv[++i] || null;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (opts.since) {
    const date = new Date(opts.since);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid --since value: ${opts.since}`);
    }
    opts.since = date.toISOString();
  }

  return opts;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function bumpCounter(map, key, delta = 1) {
  const safeKey = key == null || key === '' ? 'unknown' : String(key);
  map.set(safeKey, (map.get(safeKey) || 0) + delta);
}

function bucketHour(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.toISOString().slice(0, 13)}:00:00Z`;
}

function pct(num, den) {
  if (!den) return '0.00%';
  return `${((num / den) * 100).toFixed(2)}%`;
}

function pad(value, width) {
  return String(value).padEnd(width, ' ');
}

function truncate(value, max = 80) {
  const raw = String(value || '');
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max - 1)}…`;
}

async function fetchProductMap(db, productIds) {
  if (!productIds.length) return new Map();

  const rows = [];
  for (const idChunk of chunk(productIds, 500)) {
    const { data, error } = await db
      .from('products')
      .select('id, asin, domain, title, url')
      .in('id', idChunk);

    if (error) throw new Error(`Supabase products error: ${error.message}`);
    rows.push(...(data || []));
  }

  return new Map(rows.map((row) => [row.id, row]));
}

function buildReport(attempts, options) {
  const statusCounts = new Map();
  const httpCounts = new Map();
  const domainStats = new Map();
  const asinStats = new Map();
  const hourlyStats = new Map();

  let blocked = 0;
  let ok = 0;
  let noPrice = 0;
  let noPrice200 = 0;

  for (const row of attempts) {
    bumpCounter(statusCounts, row.status || 'unknown');
    bumpCounter(httpCounts, row.http_status == null ? 'null' : row.http_status);

    if (row.blocked_signal) blocked += 1;
    if (row.status === 'ok') ok += 1;
    if (row.status === 'no_price') noPrice += 1;
    if (row.status === 'no_price' && row.http_status === 200 && !row.blocked_signal) {
      noPrice200 += 1;
    }

    const domain = row.domain || 'unknown';
    if (!domainStats.has(domain)) {
      domainStats.set(domain, {
        domain,
        total: 0,
        ok: 0,
        failed: 0,
        blocked: 0,
        noPrice200: 0,
        lastScrapedAt: null,
      });
    }
    const ds = domainStats.get(domain);
    ds.total += 1;
    if (row.status === 'ok') ds.ok += 1;
    else ds.failed += 1;
    if (row.blocked_signal) ds.blocked += 1;
    if (row.status === 'no_price' && row.http_status === 200 && !row.blocked_signal) ds.noPrice200 += 1;
    if (!ds.lastScrapedAt || row.scraped_at > ds.lastScrapedAt) ds.lastScrapedAt = row.scraped_at;

    const asinKey = row.asin || `unknown:${row.product_id || 'none'}`;
    if (!asinStats.has(asinKey)) {
      asinStats.set(asinKey, {
        asin: row.asin || 'unknown',
        domain,
        title: row.title || '',
        total: 0,
        ok: 0,
        failed: 0,
        blocked: 0,
        noPrice200: 0,
        lastStatus: null,
        lastError: null,
        lastScrapedAt: null,
      });
    }
    const as = asinStats.get(asinKey);
    as.total += 1;
    if (row.status === 'ok') as.ok += 1;
    else as.failed += 1;
    if (row.blocked_signal) as.blocked += 1;
    if (row.status === 'no_price' && row.http_status === 200 && !row.blocked_signal) as.noPrice200 += 1;
    if (!as.lastScrapedAt || row.scraped_at > as.lastScrapedAt) {
      as.lastScrapedAt = row.scraped_at;
      as.lastStatus = row.status;
      as.lastError = row.error_message || null;
    }

    const hour = bucketHour(row.scraped_at);
    if (!hourlyStats.has(hour)) {
      hourlyStats.set(hour, {
        hour,
        total: 0,
        ok: 0,
        failed: 0,
        blocked: 0,
        noPrice200: 0,
      });
    }
    const hs = hourlyStats.get(hour);
    hs.total += 1;
    if (row.status === 'ok') hs.ok += 1;
    else hs.failed += 1;
    if (row.blocked_signal) hs.blocked += 1;
    if (row.status === 'no_price' && row.http_status === 200 && !row.blocked_signal) hs.noPrice200 += 1;
  }

  const sortedDomain = [...domainStats.values()].sort((a, b) => b.failed - a.failed || b.total - a.total);
  const sortedAsin = [...asinStats.values()].sort((a, b) => b.failed - a.failed || b.total - a.total);
  const sortedHourly = [...hourlyStats.values()].sort((a, b) => a.hour.localeCompare(b.hour));

  const recentNoPrice200 = attempts
    .filter((row) => row.status === 'no_price' && row.http_status === 200 && !row.blocked_signal)
    .slice(0, 20)
    .map((row) => ({
      scraped_at: row.scraped_at,
      asin: row.asin || 'unknown',
      domain: row.domain || 'unknown',
      error_code: row.error_code,
      error_message: row.error_message,
    }));

  return {
    generatedAt: new Date().toISOString(),
    filters: {
      since: options.since,
      hours: options.hours,
      limit: options.limit,
      status: options.status,
      domain: options.domain,
      asin: options.asin,
    },
    totals: {
      attempts: attempts.length,
      ok,
      failed: attempts.length - ok,
      blocked,
      noPrice,
      noPrice200,
      successRate: pct(ok, attempts.length),
      failRate: pct(attempts.length - ok, attempts.length),
      blockedRate: pct(blocked, attempts.length),
      noPrice200Rate: pct(noPrice200, attempts.length),
    },
    statusCounts: Object.fromEntries([...statusCounts.entries()].sort((a, b) => b[1] - a[1])),
    httpStatusCounts: Object.fromEntries([...httpCounts.entries()].sort((a, b) => b[1] - a[1])),
    byDomain: sortedDomain,
    byAsin: sortedAsin,
    hourly: sortedHourly,
    recentNoPrice200,
  };
}

function printTextReport(report, top) {
  console.log(`Scrape Attempts Analysis`);
  console.log(`Generated: ${report.generatedAt}`);
  console.log(`Window: since=${report.filters.since}  limit=${report.filters.limit}`);
  if (report.filters.status) console.log(`Filter status: ${report.filters.status}`);
  if (report.filters.domain) console.log(`Filter domain: ${report.filters.domain}`);
  if (report.filters.asin) console.log(`Filter asin: ${report.filters.asin}`);
  console.log('');

  const t = report.totals;
  console.log(`Totals: attempts=${t.attempts} ok=${t.ok} failed=${t.failed} blocked=${t.blocked} no_price=${t.noPrice} no_price_200=${t.noPrice200}`);
  console.log(`Rates: success=${t.successRate} fail=${t.failRate} blocked=${t.blockedRate} no_price_200=${t.noPrice200Rate}`);
  console.log('');

  console.log('Status Counts:');
  for (const [status, count] of Object.entries(report.statusCounts)) {
    console.log(`  ${pad(status, 14)} ${count}`);
  }
  console.log('');

  console.log(`Top Domains (by failed attempts, top ${top}):`);
  console.log(`${pad('domain', 14)} ${pad('attempts', 8)} ${pad('ok', 6)} ${pad('failed', 7)} ${pad('np200', 6)} ${pad('blocked', 7)} fail_rate`);
  for (const row of report.byDomain.slice(0, top)) {
    console.log(`${pad(row.domain, 14)} ${pad(row.total, 8)} ${pad(row.ok, 6)} ${pad(row.failed, 7)} ${pad(row.noPrice200, 6)} ${pad(row.blocked, 7)} ${pct(row.failed, row.total)}`);
  }
  console.log('');

  console.log(`Top ASINs (by failed attempts, top ${top}):`);
  console.log(`${pad('asin', 12)} ${pad('domain', 12)} ${pad('attempts', 8)} ${pad('failed', 7)} ${pad('np200', 6)} ${pad('last', 10)} title`);
  for (const row of report.byAsin.slice(0, top)) {
    console.log(`${pad(row.asin, 12)} ${pad(row.domain, 12)} ${pad(row.total, 8)} ${pad(row.failed, 7)} ${pad(row.noPrice200, 6)} ${pad(row.lastStatus || '-', 10)} ${truncate(row.title, 70)}`);
  }
  console.log('');

  console.log('Recent no_price with http=200 (up to 20):');
  if (report.recentNoPrice200.length === 0) {
    console.log('  none');
  } else {
    for (const row of report.recentNoPrice200) {
      console.log(`  ${row.scraped_at}  ${pad(row.asin, 12)} ${pad(row.domain, 10)} ${truncate(row.error_message || row.error_code || '', 120)}`);
    }
  }
}

async function main() {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const db = getClient();

    const sinceIso = opts.since || new Date(Date.now() - opts.hours * 60 * 60 * 1000).toISOString();
    let query = db
      .from('scrape_attempts')
      .select('id, product_id, status, http_status, blocked_signal, error_code, error_message, price, currency, scraped_at')
      .gte('scraped_at', sinceIso)
      .order('scraped_at', { ascending: false })
      .limit(opts.limit);

    if (opts.status) {
      query = query.eq('status', opts.status);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Supabase scrape_attempts error: ${error.message}`);

    const attempts = data || [];
    const productIds = [...new Set(attempts.map((row) => row.product_id).filter(Boolean))];
    const productMap = await fetchProductMap(db, productIds);

    let enriched = attempts.map((row) => {
      const product = productMap.get(row.product_id) || {};
      return {
        ...row,
        asin: product.asin || null,
        domain: product.domain || null,
        title: product.title || null,
        url: product.url || null,
      };
    });

    if (opts.domain) {
      enriched = enriched.filter((row) => row.domain === opts.domain);
    }
    if (opts.asin) {
      enriched = enriched.filter((row) => row.asin === opts.asin);
    }

    const report = buildReport(enriched, {
      ...opts,
      since: sinceIso,
    });

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    printTextReport(report, opts.top);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
