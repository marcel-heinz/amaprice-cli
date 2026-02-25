function hasSupabaseConfig() {
  // Data is served via internal API routes now.
  return true;
}

function normalizeCurrency(value) {
  const next = String(value || "").trim().toUpperCase();
  return next || null;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toTimestamp(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

function buildEndpoint(path, query = {}) {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return `${url.pathname}${url.search}`;
}

async function fetchJson(path, query = {}) {
  const endpoint = buildEndpoint(path, query);
  const response = await fetch(endpoint, {
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

    throw new Error(
      parsed?.error || parsed?.message || `API request failed (${response.status}).`
    );
  }

  return response.json();
}

function normalizeProduct(row) {
  return {
    id: row?.id || null,
    asin: String(row?.asin || "").trim().toUpperCase(),
    title: String(row?.title || "").trim() || "Untitled product",
    url: String(row?.url || "").trim() || null,
    domain: String(row?.domain || "").trim() || "unknown",
    createdAt: row?.createdAt || row?.created_at || null,
    lastScrapedAt: row?.lastScrapedAt || row?.last_scraped_at || null,
    lastPrice: asNumber(row?.lastPrice ?? row?.last_price)
  };
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
  const rows = await fetchJson("/api/v1/products", {
    limit
  });

  return (Array.isArray(rows) ? rows : [])
    .map(normalizeProduct)
    .filter((row) => row.id && row.asin && Number.isFinite(row.lastPrice));
}

export async function fetchProductHistory(productId, { limit = 1500 } = {}) {
  const rows = await fetchJson(`/api/v1/products/${encodeURIComponent(productId)}/history`, {
    limit
  });
  return filterValidPriceRows(rows);
}

export async function fetchRecentPriceHistory({ hours = 72, limit = 3500 } = {}) {
  const rows = await fetchJson("/api/v1/prices/recent", {
    hours,
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
