import { NextResponse } from "next/server";

import { getSupabaseAdmin, hasSupabaseAdminConfig } from "../../../lib/server/supabase-admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!hasSupabaseAdminConfig()) {
    return NextResponse.json(
      {
        error:
          "Website API is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
      },
      { status: 500 }
    );
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("worker_health")
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      {
        error: `Supabase worker_health error: ${error.message}`
      },
      { status: 500 }
    );
  }

  const response = NextResponse.json(data || null, { status: 200 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
