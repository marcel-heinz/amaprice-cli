const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function isMaybeMissingColumnError(error) {
  const text = `${error?.code || ""} ${error?.message || ""} ${error?.details || ""}`;
  return /PGRST204|42703|column .* does not exist/i.test(text);
}

function normalizeCurrency(value) {
  const next = String(value || "").trim().toUpperCase();
  return next || null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildUrl(path, query = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function fetchRows(path, query = {}) {
  if (!hasSupabaseConfig()) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  const response = await fetch(buildUrl(path, query), {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const raw = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const error = new Error(parsed?.message || `Supabase request failed (${response.status}).`);
    error.status = response.status;
    error.code = parsed?.code || null;
    error.details = parsed?.details || raw;
    throw error;
  }

  const rows = await response.json();
  return Array.isArray(rows) ? rows : [];
}

function normalizeProduct(row) {
  return {
    id: row?.id || null,
    asin: String(row?.asin || "").trim().toUpperCase(),
    title: String(row?.title || "").trim() || "Untitled product",
    url: String(row?.url || "").trim() || null,
    domain: String(row?.domain || "").trim() || "unknown",
    createdAt: row?.created_at || null,
    lastScrapedAt: row?.last_scraped_at || null,
    lastPrice: asNumber(row?.last_price)
  };
}

function toTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

export function normalizePriceRow(row) {
  const price = asNumber(row?.price);
  const scrapedAt = row?.scraped_at || row?.scrapedAt;
  const timestamp = toTimestamp(scrapedAt);

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(timestamp)) {
    return null;
  }

  return {
    productId: row?.product_id || row?.productId || null,
    price,
    currency: normalizeCurrency(row?.currency),
    scrapedAt,
    timestamp
  };
}

export function filterValidPriceRows(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map(normalizePriceRow)
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

export async function fetchProducts({ limit = 400 } = {}) {
  const select = "id,asin,title,url,domain,created_at,last_price,last_scraped_at";
  try {
    const rows = await fetchRows("products", {
      select,
      order: "created_at.desc",
      limit
    });
    return rows.map(normalizeProduct).filter((row) => row.id && row.asin);
  } catch (error) {
    if (!isMaybeMissingColumnError(error)) {
      throw error;
    }

    const fallbackRows = await fetchRows("products", {
      select: "id,asin,title,url,domain,created_at",
      order: "created_at.desc",
      limit
    });

    return fallbackRows.map(normalizeProduct).filter((row) => row.id && row.asin);
  }
}

export async function fetchProductHistory(productId, { limit = 1500 } = {}) {
  const rows = await fetchRows("price_history", {
    select: "product_id,price,currency,scraped_at",
    product_id: `eq.${productId}`,
    order: "scraped_at.asc",
    limit
  });
  return filterValidPriceRows(rows);
}

export async function fetchRecentPriceHistory({ hours = 72, limit = 3500 } = {}) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await fetchRows("price_history", {
    select: "product_id,price,currency,scraped_at",
    scraped_at: `gte.${since}`,
    order: "scraped_at.desc",
    limit
  });
  return filterValidPriceRows(rows);
}

export function formatMoney(value, currency = "USD") {
  const amount = asNumber(value);
  if (!Number.isFinite(amount)) {
    return "n/a";
  }

  const code = normalizeCurrency(currency) || "USD";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${code}`;
  }
}

export function formatDateShort(value) {
  const ts = toTimestamp(value);
  if (!Number.isFinite(ts)) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(new Date(ts));
}

export function formatDateTime(value) {
  const ts = toTimestamp(value);
  if (!Number.isFinite(ts)) {
    return "n/a";
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(ts));
}

export function getChangeInfo(points) {
  if (!Array.isArray(points) || points.length < 2) {
    return {
      change: null,
      changePct: null
    };
  }

  const first = points[0]?.price;
  const last = points[points.length - 1]?.price;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) {
    return {
      change: null,
      changePct: null
    };
  }

  const change = last - first;
  const changePct = (change / first) * 100;
  return { change, changePct };
}

export { hasSupabaseConfig };
