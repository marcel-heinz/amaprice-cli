import { NextResponse } from "next/server";

import { getSupabaseAdmin, hasSupabaseAdminConfig } from "../../../lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

function parseOffset(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(max, Math.round(parsed)));
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSearchTerm(value) {
  return String(value || "").trim().slice(0, 120);
}

function normalizeAsin(value) {
  return String(value || "").trim().toUpperCase();
}

function mapProduct(row, latestPriceByProductId) {
  const latest = latestPriceByProductId.get(row.id) || null;
  const latestPrice = toNumberOrNull(latest?.price ?? row?.last_price);

  return {
    id: row.id,
    asin: String(row.asin || "").trim().toUpperCase(),
    title: String(row.title || "").trim() || "Untitled product",
    url: String(row.url || "").trim() || null,
    domain: String(row.domain || "").trim() || "unknown",
    createdAt: row.created_at || null,
    lastScrapedAt: latest?.scraped_at || row.last_scraped_at || null,
    lastPrice: latestPrice,
    latestCurrency: latest?.currency || null
  };
}

export async function GET(request) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json(
      {
        error:
          "Website API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const paginate = url.searchParams.get("paginate") === "1";
  const limit = parseLimit(url.searchParams.get("limit"), paginate ? 24 : 400, paginate ? 120 : 800);
  const offset = parseOffset(url.searchParams.get("offset"), 0, 2_000_000);
  const searchTerm = normalizeSearchTerm(url.searchParams.get("q"));
  const asin = normalizeAsin(url.searchParams.get("asin"));
  const includeInactive = url.searchParams.get("include_inactive") === "1";
  const fetchSize = paginate ? limit + 1 : limit;

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("products")
    .select(
      "id, asin, title, url, domain, created_at, last_price, last_scraped_at, is_active"
    )
    .order("created_at", { ascending: false });

  if (!includeInactive) {
    query = query.eq("is_active", true);
  }

  if (asin) {
    query = query.eq("asin", asin);
  } else if (searchTerm) {
    const normalized = searchTerm.replace(/[%_]/g, "\\$&").replace(/,/g, " ");
    query = query.or(
      `title.ilike.%${normalized}%,asin.ilike.%${normalized}%,domain.ilike.%${normalized}%`
    );
  }

  if (paginate) {
    query = query.range(offset, offset + fetchSize - 1);
  } else {
    query = query.limit(fetchSize);
  }

  const { data: products, error } = await query;
  if (error) {
    return NextResponse.json(
      {
        error: `Supabase products error: ${error.message}`
      },
      { status: 500 }
    );
  }

  const rows = Array.isArray(products) ? products : [];
  const pageRows = paginate ? rows.slice(0, limit) : rows;
  const hasMore = paginate ? rows.length > limit : false;

  const ids = pageRows.map((row) => row.id).filter(Boolean);
  const latestPriceByProductId = new Map();

  if (ids.length > 0) {
    const latestResp = await supabase
      .from("product_latest_price")
      .select("product_id, price, currency, scraped_at")
      .in("product_id", ids);

    if (!latestResp.error) {
      for (const row of latestResp.data || []) {
        latestPriceByProductId.set(row.product_id, row);
      }
    }
  }

  const mapped = pageRows
    .map((row) => mapProduct(row, latestPriceByProductId))
    .filter(Boolean);

  const payload = paginate
    ? {
        items: mapped,
        hasMore,
        limit,
        offset,
        nextOffset: hasMore ? offset + mapped.length : null
      }
    : mapped;

  const response = NextResponse.json(payload, { status: 200 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
