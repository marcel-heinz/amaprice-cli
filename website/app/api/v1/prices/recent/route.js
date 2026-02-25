import { NextResponse } from "next/server";

import { getSupabaseAdmin, hasSupabaseAdminConfig } from "../../../../lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
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
  const hours = parseInteger(url.searchParams.get("hours"), 72, 1, 24 * 30);
  const limit = parseInteger(url.searchParams.get("limit"), 3500, 100, 10000);

  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from("price_history")
    .select("product_id, price, currency, scraped_at")
    .gte("scraped_at", since)
    .order("scraped_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json(
      {
        error: `Supabase price_history error: ${error.message}`
      },
      { status: 500 }
    );
  }

  const response = NextResponse.json(Array.isArray(data) ? data : [], {
    status: 200
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
