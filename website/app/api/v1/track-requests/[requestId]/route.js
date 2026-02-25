import { NextResponse } from "next/server";

import { getSupabaseAdmin, hasSupabaseAdminConfig } from "../../../../lib/server/supabase-admin";
import {
  VISITOR_COOKIE_NAME,
  buildTrackStatusPatch,
  deriveTrackRequestState,
  ensureVisitorIdFromCookies,
  getTrackRequestById,
  serializeTrackRequestResponse,
  shouldPersistTrackStatus,
  updateTrackRequestById
} from "../../../../lib/server/track-requests";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  try {
    const params = await Promise.resolve(context?.params || {});
    const requestId = String(params?.requestId || "").trim();
    if (!requestId) {
      return NextResponse.json({ error: "Missing request id." }, { status: 400 });
    }

    const { visitorId } = ensureVisitorIdFromCookies(request.cookies);
    const supabase = getSupabaseAdmin();
    const requestRow = await getTrackRequestById(supabase, requestId);

    if (!requestRow) {
      return NextResponse.json({ error: "Tracking request not found." }, { status: 404 });
    }

    if (requestRow.visitor_id !== visitorId) {
      // Keep this as 404 to avoid exposing request existence across visitors.
      return NextResponse.json({ error: "Tracking request not found." }, { status: 404 });
    }

    const derivedState = await deriveTrackRequestState(supabase, requestRow);
    let latestRequestRow = requestRow;

    if (shouldPersistTrackStatus(requestRow.status, derivedState.status)) {
      latestRequestRow = await updateTrackRequestById(
        supabase,
        requestRow.id,
        buildTrackStatusPatch(requestRow, derivedState.status, derivedState.lastError)
      );
    }

    const response = NextResponse.json(
      serializeTrackRequestResponse({
        requestRow: latestRequestRow,
        derivedState
      }),
      { status: 200 }
    );

    response.headers.set("Cache-Control", "no-store");

    if (!request.cookies.get(VISITOR_COOKIE_NAME)?.value) {
      response.cookies.set({
        name: VISITOR_COOKIE_NAME,
        value: visitorId,
        maxAge: 60 * 60 * 24 * 365,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
      });
    }

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: String(err?.message || "Could not load tracking request.") },
      { status: 500 }
    );
  }
}
