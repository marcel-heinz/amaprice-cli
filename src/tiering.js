const VALID_TIERS = ['hourly', 'daily', 'weekly'];

const TIER_INTERVAL_MS = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const TIER_DEMOTION = {
  hourly: 'daily',
  daily: 'weekly',
  weekly: 'weekly',
};

function normalizeTier(value, fallback = null) {
  const tier = String(value || '').trim().toLowerCase();
  return VALID_TIERS.includes(tier) ? tier : fallback;
}

function computeNextScrapeAt(tier, now = new Date(), minJitterMinutes = 2, maxJitterMinutes = 10) {
  const normalized = normalizeTier(tier, 'daily');
  const interval = TIER_INTERVAL_MS[normalized];
  const jitterSpan = Math.max(0, maxJitterMinutes - minJitterMinutes);
  const jitterMinutes = minJitterMinutes + Math.floor(Math.random() * (jitterSpan + 1));
  const next = new Date(now.getTime() + interval + jitterMinutes * 60 * 1000);
  return next.toISOString();
}

function computeFailureBackoffMinutes(consecutiveFailures) {
  const failures = Math.max(1, Number(consecutiveFailures) || 1);
  const minutes = Math.min(24 * 60, Math.pow(2, failures) * 5);
  return minutes;
}

function demoteTier(tier) {
  const normalized = normalizeTier(tier, 'daily');
  return TIER_DEMOTION[normalized];
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function recommendAutoTier(historyRows, now = new Date()) {
  if (!Array.isArray(historyRows) || historyRows.length < 2) {
    return 'daily';
  }

  const rows = [...historyRows]
    .filter((row) => row && row.scraped_at)
    .sort((a, b) => new Date(b.scraped_at) - new Date(a.scraped_at));

  if (rows.length < 2) return 'daily';

  const nowTs = now.getTime();
  const cutoff48h = nowTs - (48 * 60 * 60 * 1000);
  const cutoff7d = nowTs - (7 * 24 * 60 * 60 * 1000);
  const cutoff30d = nowTs - (30 * 24 * 60 * 60 * 1000);

  let changes48h = 0;
  let changes30d = 0;
  for (let i = 0; i < rows.length - 1; i += 1) {
    const currentPrice = toNumber(rows[i].price);
    const previousPrice = toNumber(rows[i + 1].price);
    const ts = new Date(rows[i].scraped_at).getTime();
    if (!Number.isFinite(ts) || currentPrice === null || previousPrice === null) continue;

    if (Math.abs(currentPrice - previousPrice) > 0.00001) {
      if (ts >= cutoff48h) changes48h += 1;
      if (ts >= cutoff30d) changes30d += 1;
    }
  }

  const prices7d = rows
    .filter((row) => new Date(row.scraped_at).getTime() >= cutoff7d)
    .map((row) => toNumber(row.price))
    .filter((value) => value !== null);

  let pctChange7d = 0;
  if (prices7d.length >= 2) {
    const newest = prices7d[0];
    const oldest = prices7d[prices7d.length - 1];
    if (oldest > 0) {
      pctChange7d = Math.abs((newest - oldest) / oldest);
    }
  }

  if (changes48h >= 2 || pctChange7d >= 0.05) {
    return 'hourly';
  }

  if (changes30d === 0) {
    return 'weekly';
  }

  return 'daily';
}

module.exports = {
  VALID_TIERS,
  normalizeTier,
  computeNextScrapeAt,
  computeFailureBackoffMinutes,
  demoteTier,
  recommendAutoTier,
};

