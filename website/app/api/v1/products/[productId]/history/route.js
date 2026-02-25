import { NextResponse } from "next/server";

import { getSupabaseAdmin, hasSupabaseAdminConfig } from "../../../../../lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, Math.round(parsed)));
}

export async function GET(request, context) {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json(
      {
        error:
          "Website API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
  }

  const params = await Promise.resolve(context?.params || {});
  const productId = String(params?.productId || "").trim();
  if (!productId) {
    return NextResponse.json({ error: "Missing product id." }, { status: 400 });
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"), 1500, 4000);

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("price_history")
    .select("product_id, price, currency, scraped_at")
    .eq("product_id", productId)
    .order("scraped_at", { ascending: true })
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
