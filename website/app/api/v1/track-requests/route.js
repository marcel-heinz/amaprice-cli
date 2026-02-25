import { NextResponse } from "next/server";

import {
  extractDomain,
  isAmazonUrl,
  normalizeAmazonInput
} from "../../../lib/server/amazon-input";
import {
  getSupabaseAdmin,
  hasSupabaseAdminConfig
} from "../../../lib/server/supabase-admin";
import {
  VISITOR_COOKIE_NAME,
  buildTrackStatusPatch,
  checkTrackRateLimit,
  deriveTrackRequestState,
  ensureVisitorIdFromCookies,
  enqueueCollectionJobForProduct,
  getLatestPriceForProduct,
  getProductByAsin,
  hashIpAddress,
  insertTrackRequest,
  readClientIp,
  sanitizeTrackSource,
  serializeTrackRequestResponse,
  shouldPersistTrackStatus,
  upsertProductForWebsiteTracking,
  updateTrackRequestById
} from "../../../lib/server/track-requests";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const INPUT_MAX_LENGTH = 2048;

async function parseRequestBody(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

function withVisitorCookie(response, visitorId, shouldSetCookie) {
  if (!shouldSetCookie) {
    return response;
  }

  response.cookies.set({
    name: VISITOR_COOKIE_NAME,
    value: visitorId,
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/"
  });

  return response;
}

async function verifyTurnstileToken({ token, ipAddress }) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    return { ok: true, skipped: true, reason: null };
  }

  if (!token || !String(token).trim()) {
    return { ok: true, skipped: true, reason: "captcha_token_missing" };
  }

  const payload = new URLSearchParams();
  payload.set("secret", secret);
  payload.set("response", String(token).trim());
  if (ipAddress && ipAddress !== "unknown") {
    payload.set("remoteip", ipAddress);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: payload,
        cache: "no-store"
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        skipped: false,
        reason: `captcha_http_${response.status}`
      };
    }

    const data = await response.json();
    if (!data?.success) {
      const code = Array.isArray(data?.["error-codes"])
        ? data["error-codes"].join(",")
        : "captcha_failed";
      return { ok: false, skipped: false, reason: code };
    }

    return { ok: true, skipped: false, reason: null };
  } catch {
    return { ok: false, skipped: false, reason: "captcha_unreachable" };
  }
}

function rejectedResponse({ requestRow, message, error, status = 400 }) {
  return NextResponse.json(
    {
      ...serializeTrackRequestResponse({
        requestRow,
        derivedState: {
          status: "rejected",
          product: null,
          latestPrice: null,
          lastError: message
        }
      }),
      error
    },
    { status }
  );
}

export async function POST(request) {
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
    const supabase = getSupabaseAdmin();
    const body = await parseRequestBody(request);
    const rawInput = String(body?.input || "").trim();
    const source = sanitizeTrackSource(body?.source || "website");
    const captchaToken = String(body?.captchaToken || "").trim();

    const { visitorId, shouldSetCookie } = ensureVisitorIdFromCookies(
      request.cookies
    );
    const ipAddress = readClientIp(request);
    const ipHash = hashIpAddress(ipAddress);

    if (!rawInput || rawInput.length > INPUT_MAX_LENGTH) {
      const requestRow = await insertTrackRequest(supabase, {
        visitor_id: visitorId,
        ip_hash: ipHash,
        source,
        raw_input: rawInput || "",
        status: "rejected",
        status_reason: "invalid_input",
        completed_at: new Date().toISOString(),
        request_meta: {
          reason: "Input is empty or exceeds the maximum allowed length."
        }
      });

      return withVisitorCookie(
        rejectedResponse({
          requestRow,
          message: "Input is empty or too long.",
          error: "Please provide a valid Amazon URL or ASIN."
        }),
        visitorId,
        shouldSetCookie
      );
    }

    const captcha = await verifyTurnstileToken({
      token: captchaToken,
      ipAddress
    });

    if (!captcha.ok) {
      const requestRow = await insertTrackRequest(supabase, {
        visitor_id: visitorId,
        ip_hash: ipHash,
        source,
        raw_input: rawInput,
        status: "rejected",
        status_reason: captcha.reason,
        completed_at: new Date().toISOString(),
        request_meta: {
          captcha_required: !captcha.skipped,
          captcha_reason: captcha.reason
        }
      });

      return withVisitorCookie(
        rejectedResponse({
          requestRow,
          message: "Captcha verification failed.",
          error: "Captcha validation failed.",
          status: 403
        }),
        visitorId,
        shouldSetCookie
      );
    }

    const rateLimit = await checkTrackRateLimit({
      supabase,
      ipHash,
      visitorId
    });

    if (!rateLimit.allowed) {
      const requestRow = await insertTrackRequest(supabase, {
        visitor_id: visitorId,
        ip_hash: ipHash,
        source,
        raw_input: rawInput,
        status: "rate_limited",
        status_reason: "too_many_requests",
        completed_at: new Date().toISOString(),
        request_meta: {
          ip_count: rateLimit.ipCount,
          visitor_count: rateLimit.visitorCount,
          window_seconds: rateLimit.windowSeconds
        }
      });

      const response = NextResponse.json(
        {
          ...serializeTrackRequestResponse({
            requestRow,
            derivedState: {
              status: "rate_limited",
              product: null,
              latestPrice: null,
              lastError: "Rate limit exceeded."
            },
            rateLimit: {
              windowSeconds: rateLimit.windowSeconds,
              maxRequestsPerIp: rateLimit.maxRequestsPerIp,
              maxRequestsPerVisitor: rateLimit.maxRequestsPerVisitor
            }
          }),
          error: "Rate limit exceeded. Try again in a few minutes."
        },
        { status: 429 }
      );

      return withVisitorCookie(response, visitorId, shouldSetCookie);
    }

    const normalized = await normalizeAmazonInput(rawInput);
    if (!normalized) {
      if (isAmazonUrl(rawInput)) {
        const now = new Date().toISOString();
        const requestRow = await insertTrackRequest(supabase, {
          visitor_id: visitorId,
          ip_hash: ipHash,
          source,
          raw_input: rawInput,
          domain: extractDomain(rawInput),
          normalized_url: rawInput,
          status: "queued",
          status_reason: "pending_url_resolution",
          queued_at: now,
          request_meta: {
            pending_url_resolution: true,
            resolution_stage: "collector"
          }
        });

        const response = NextResponse.json(
          serializeTrackRequestResponse({
            requestRow,
            derivedState: {
              status: "queued",
              product: null,
              latestPrice: null,
              lastError: null
            }
          }),
          { status: 202 }
        );

        return withVisitorCookie(response, visitorId, shouldSetCookie);
      }

      const requestRow = await insertTrackRequest(supabase, {
        visitor_id: visitorId,
        ip_hash: ipHash,
        source,
        raw_input: rawInput,
        status: "rejected",
        status_reason: "invalid_amazon_input",
        completed_at: new Date().toISOString(),
        request_meta: {
          reason: "Could not parse Amazon URL or ASIN."
        }
      });

      return withVisitorCookie(
        rejectedResponse({
          requestRow,
          message: "Input is not a supported Amazon URL or ASIN.",
          error: "Input must be an Amazon product URL or valid ASIN."
        }),
        visitorId,
        shouldSetCookie
      );
    }

    const existingProduct = await getProductByAsin(supabase, normalized.asin);
    const existingLatest = existingProduct?.id
      ? await getLatestPriceForProduct(supabase, existingProduct.id)
      : null;

    if (existingProduct && existingLatest) {
      const now = new Date().toISOString();
      const requestRow = await insertTrackRequest(supabase, {
        visitor_id: visitorId,
        ip_hash: ipHash,
        source,
        raw_input: rawInput,
        asin: normalized.asin,
        domain: normalized.domain,
        normalized_url: normalized.url,
        product_id: existingProduct.id,
        status: "duplicate_live",
        status_reason: "already_tracked",
        first_live_at: now,
        completed_at: now,
        request_meta: {
          duplicate_live: true
        }
      });

      const response = NextResponse.json(
        serializeTrackRequestResponse({
          requestRow,
          derivedState: {
            status: "live",
            product: existingProduct,
            latestPrice: {
              productId: existingLatest.product_id,
              price: Number(existingLatest.price),
              currency: existingLatest.currency || null,
              scrapedAt: existingLatest.scraped_at || null,
              source: existingLatest.source || null,
              confidence:
                existingLatest.confidence == null
                  ? null
                  : Number(existingLatest.confidence)
            },
            lastError: null
          }
        }),
        { status: 200 }
      );

      return withVisitorCookie(response, visitorId, shouldSetCookie);
    }

    const product = await upsertProductForWebsiteTracking(supabase, {
      asin: normalized.asin,
      domain: normalized.domain,
      url: normalized.url
    });

    const now = new Date().toISOString();
    const jobId = await enqueueCollectionJobForProduct(supabase, {
      productId: product.id,
      routeHint: "collector_first",
      priority: 220,
      scheduledFor: now
    });

    let requestRow = await insertTrackRequest(supabase, {
      visitor_id: visitorId,
      ip_hash: ipHash,
      source,
      raw_input: rawInput,
      asin: normalized.asin,
      domain: normalized.domain,
      normalized_url: normalized.url,
      product_id: product.id,
      status: "queued",
      queued_at: now,
      request_meta: {
        enqueued_job_id: jobId || null
      }
    });

    const derivedState = await deriveTrackRequestState(supabase, requestRow);
    if (shouldPersistTrackStatus(requestRow.status, derivedState.status)) {
      requestRow = await updateTrackRequestById(
        supabase,
        requestRow.id,
        buildTrackStatusPatch(requestRow, derivedState.status, derivedState.lastError)
      );
    }

    const response = NextResponse.json(
      serializeTrackRequestResponse({ requestRow, derivedState }),
      { status: 202 }
    );

    return withVisitorCookie(response, visitorId, shouldSetCookie);
  } catch (err) {
    return NextResponse.json(
      {
        error: String(err?.message || "Could not create tracking request.")
      },
      { status: 500 }
    );
  }
}
