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

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapProduct(row, latestPriceByProductId) {
  const latest = latestPriceByProductId.get(row.id) || null;
  const latestPrice = toNumberOrNull(latest?.price ?? row?.last_price);

  if (!Number.isFinite(latestPrice)) {
    return null;
  }

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
  const limit = parseLimit(url.searchParams.get("limit"), 400, 800);
  const includeInactive = url.searchParams.get("include_inactive") === "1";

  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("products")
    .select(
      "id, asin, title, url, domain, created_at, last_price, last_scraped_at, is_active"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (!includeInactive) {
    query = query.eq("is_active", true);
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

  const ids = (products || []).map((row) => row.id).filter(Boolean);
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

  const mapped = (products || [])
    .map((row) => mapProduct(row, latestPriceByProductId))
    .filter(Boolean);

  const response = NextResponse.json(mapped, { status: 200 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
