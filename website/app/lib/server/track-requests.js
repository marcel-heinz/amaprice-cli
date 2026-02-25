import crypto from "node:crypto";

export const VISITOR_COOKIE_NAME = "amaprice_vid";

const VALID_VISITOR_ID = /^[a-f0-9-]{16,64}$/i;
const VALID_ROUTE_HINTS = new Set([
  "collector_first",
  "collector_only",
  "railway_only"
]);
const TERMINAL_STATUSES = new Set([
  "live",
  "failed",
  "duplicate_live",
  "rate_limited",
  "rejected"
]);

const STATUS_RANK = {
  queued: 1,
  collecting: 2,
  live: 3,
  failed: 3,
  duplicate_live: 3,
  rate_limited: 3,
  rejected: 3
};

function nowIso() {
  return new Date().toISOString();
}

function cleanPayload(payload) {
  const next = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return next;
}

function safeInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeStatus(value, fallback = "queued") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!STATUS_RANK[normalized]) {
    return fallback;
  }
  return normalized;
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toDateMs(value) {
  const ts = Date.parse(String(value || ""));
  return Number.isFinite(ts) ? ts : null;
}

function isMissingRpc(error) {
  const code = String(error?.code || "");
  return code === "42883" || code === "PGRST202";
}

function isMissingRelation(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /relation .* does not exist/i.test(message) ||
    /column .* does not exist/i.test(message)
  );
}

export function sanitizeTrackSource(value) {
  const normalized = String(value || "website")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!normalized) {
    return "website";
  }

  return normalized.slice(0, 40);
}

export function ensureVisitorIdFromCookies(cookiesStore) {
  const existing = String(cookiesStore?.get(VISITOR_COOKIE_NAME)?.value || "");
  if (VALID_VISITOR_ID.test(existing)) {
    return {
      visitorId: existing,
      shouldSetCookie: false
    };
  }

  return {
    visitorId: crypto.randomUUID(),
    shouldSetCookie: true
  };
}

export function readClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = String(forwarded)
      .split(",")
      .map((item) => item.trim())
      .find(Boolean);
    if (first) {
      return first;
    }
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    return String(realIp).trim();
  }

  return "unknown";
}

export function hashIpAddress(ipAddress) {
  const pepper = process.env.WEB_TRACK_IP_HASH_PEPPER || "amaprice-default-pepper";
  return crypto
    .createHash("sha256")
    .update(`${String(ipAddress || "unknown").trim()}|${pepper}`)
    .digest("hex");
}

export function getRateLimitConfig() {
  return {
    windowSeconds: safeInt(
      process.env.WEB_TRACK_RATE_LIMIT_WINDOW_SECONDS,
      300,
      30,
      3600
    ),
    maxRequestsPerIp: safeInt(
      process.env.WEB_TRACK_RATE_LIMIT_MAX_REQUESTS_PER_IP,
      8,
      1,
      200
    ),
    maxRequestsPerVisitor: safeInt(
      process.env.WEB_TRACK_RATE_LIMIT_MAX_REQUESTS_PER_VISITOR,
      12,
      1,
      300
    )
  };
}

export async function checkTrackRateLimit({ supabase, ipHash, visitorId }) {
  const config = getRateLimitConfig();
  const sinceIso = new Date(Date.now() - config.windowSeconds * 1000).toISOString();

  const [ipResp, visitorResp] = await Promise.all([
    supabase
      .from("web_track_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", sinceIso),
    supabase
      .from("web_track_requests")
      .select("id", { count: "exact", head: true })
      .eq("visitor_id", visitorId)
      .gte("created_at", sinceIso)
  ]);

  if (ipResp.error) {
    throw new Error(`Supabase web_track_requests error: ${ipResp.error.message}`);
  }

  if (visitorResp.error) {
    throw new Error(`Supabase web_track_requests error: ${visitorResp.error.message}`);
  }

  const ipCount = Number(ipResp.count || 0);
  const visitorCount = Number(visitorResp.count || 0);
  const allowed =
    ipCount < config.maxRequestsPerIp &&
    visitorCount < config.maxRequestsPerVisitor;

  return {
    allowed,
    ipCount,
    visitorCount,
    ...config
  };
}

export async function insertTrackRequest(supabase, payload) {
  const { data, error } = await supabase
    .from("web_track_requests")
    .insert(cleanPayload(payload))
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase web_track_requests error: ${error.message}`);
  }

  return data;
}

export async function updateTrackRequestById(supabase, requestId, patch) {
  const { data, error } = await supabase
    .from("web_track_requests")
    .update(cleanPayload({ ...patch, updated_at: nowIso() }))
    .eq("id", requestId)
    .select()
    .single();

  if (error) {
    throw new Error(`Supabase web_track_requests error: ${error.message}`);
  }

  return data;
}

export async function getProductByAsin(supabase, asin) {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, asin, title, url, domain, is_active, next_scrape_at, tier, tier_mode, last_error"
    )
    .eq("asin", asin)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase products error: ${error.message}`);
  }

  return data;
}

export async function getLatestPriceForProduct(supabase, productId) {
  const { data, error } = await supabase
    .from("product_latest_price")
    .select("product_id, price, currency, scraped_at, source, confidence")
    .eq("product_id", productId)
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      return null;
    }
    throw new Error(`Supabase product_latest_price error: ${error.message}`);
  }

  return data || null;
}

export async function upsertProductForWebsiteTracking(supabase, { asin, domain, url }) {
  const existing = await getProductByAsin(supabase, asin);
  if (!existing) {
    const { data, error } = await supabase
      .from("products")
      .insert({
        asin,
        domain,
        url,
        title: `ASIN ${asin}`,
        tier: "daily",
        tier_mode: "auto",
        is_active: true,
        next_scrape_at: nowIso()
      })
      .select(
        "id, asin, title, url, domain, is_active, next_scrape_at, tier, tier_mode, last_error"
      )
      .single();

    if (error) {
      throw new Error(`Supabase products error: ${error.message}`);
    }

    return data;
  }

  const { data, error } = await supabase
    .from("products")
    .update({
      is_active: true,
      next_scrape_at: nowIso(),
      domain,
      url
    })
    .eq("id", existing.id)
    .select(
      "id, asin, title, url, domain, is_active, next_scrape_at, tier, tier_mode, last_error"
    )
    .single();

  if (error) {
    throw new Error(`Supabase products error: ${error.message}`);
  }
  return data;
}

async function enqueueProductCollectionJobFallback(
  supabase,
  { productId, routeHint, priority, scheduledFor }
) {
  const activeJob = await supabase
    .from("collection_jobs")
    .select("id")
    .eq("product_id", productId)
    .in("state", ["queued", "leased"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (activeJob.error && !isMissingRelation(activeJob.error)) {
    throw new Error(`Supabase collection_jobs error: ${activeJob.error.message}`);
  }

  if (activeJob.data?.id) {
    return activeJob.data.id;
  }

  const productResp = await supabase
    .from("products")
    .select("id, asin, domain")
    .eq("id", productId)
    .single();

  if (productResp.error) {
    throw new Error(`Supabase products error: ${productResp.error.message}`);
  }

  const dedupeKey = `${productId}:web:${Date.now()}:${crypto
    .randomUUID()
    .slice(0, 8)}`;

  const insertResp = await supabase
    .from("collection_jobs")
    .insert({
      product_id: productResp.data.id,
      asin: productResp.data.asin,
      domain: productResp.data.domain,
      scheduled_for: scheduledFor,
      priority,
      state: "queued",
      route_hint: routeHint,
      dedupe_key: dedupeKey
    })
    .select("id")
    .single();

  if (!insertResp.error) {
    return insertResp.data.id;
  }

  if (!isMissingRelation(insertResp.error)) {
    throw new Error(
      `Supabase collection_jobs error: ${insertResp.error.message}`
    );
  }

  return null;
}

export async function enqueueCollectionJobForProduct(
  supabase,
  {
    productId,
    routeHint = "collector_first",
    priority = 180,
    scheduledFor = nowIso()
  } = {}
) {
  const safeRouteHint = VALID_ROUTE_HINTS.has(routeHint)
    ? routeHint
    : "collector_first";

  const rpcResp = await supabase.rpc("enqueue_product_collection_job", {
    p_product_id: productId,
    p_route_hint: safeRouteHint,
    p_priority: priority,
    p_schedule_at: scheduledFor
  });

  if (!rpcResp.error) {
    return rpcResp.data || null;
  }

  if (!isMissingRpc(rpcResp.error)) {
    throw new Error(
      `Supabase enqueue_product_collection_job error: ${rpcResp.error.message}`
    );
  }

  return enqueueProductCollectionJobFallback(supabase, {
    productId,
    routeHint: safeRouteHint,
    priority,
    scheduledFor
  });
}

export async function getTrackRequestById(supabase, requestId) {
  const { data, error } = await supabase
    .from("web_track_requests")
    .select("*")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw new Error(`Supabase web_track_requests error: ${error.message}`);
  }

  return data;
}

export async function deriveTrackRequestState(supabase, requestRow) {
  const baseStatus = normalizeStatus(requestRow?.status, "queued");
  const normalizedBase = baseStatus === "duplicate_live" ? "live" : baseStatus;

  if (!requestRow?.product_id) {
    return {
      status: normalizedBase,
      product: null,
      latestPrice: null,
      lastError: requestRow?.last_error || null
    };
  }

  const [productResp, latestResp, activeJobResp, recentFailureResp] =
    await Promise.all([
      supabase
        .from("products")
        .select("id, asin, title, url, domain, last_error")
        .eq("id", requestRow.product_id)
        .maybeSingle(),
      supabase
        .from("product_latest_price")
        .select("product_id, price, currency, scraped_at, source, confidence")
        .eq("product_id", requestRow.product_id)
        .maybeSingle(),
      supabase
        .from("collection_jobs")
        .select(
          "id, state, scheduled_for, lease_until, attempt_count, max_attempts, updated_at"
        )
        .eq("product_id", requestRow.product_id)
        .in("state", ["queued", "leased"])
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("collection_attempts")
        .select("status, error_message, started_at, finished_at")
        .eq("product_id", requestRow.product_id)
        .gte("started_at", requestRow.created_at)
        .neq("status", "ok")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    ]);

  if (productResp.error) {
    throw new Error(`Supabase products error: ${productResp.error.message}`);
  }

  if (latestResp.error && !isMissingRelation(latestResp.error)) {
    throw new Error(
      `Supabase product_latest_price error: ${latestResp.error.message}`
    );
  }

  if (activeJobResp.error && !isMissingRelation(activeJobResp.error)) {
    throw new Error(
      `Supabase collection_jobs error: ${activeJobResp.error.message}`
    );
  }

  if (recentFailureResp.error && !isMissingRelation(recentFailureResp.error)) {
    throw new Error(
      `Supabase collection_attempts error: ${recentFailureResp.error.message}`
    );
  }

  const product = productResp.data || null;
  const latest = latestResp.data || null;
  const activeJob = activeJobResp.data || null;
  const recentFailure = recentFailureResp.data || null;

  const latestTs = toDateMs(latest?.scraped_at);
  const requestTs = toDateMs(requestRow?.created_at);
  const hasLivePrice =
    Number.isFinite(latestTs) &&
    Number.isFinite(requestTs) &&
    latestTs >= requestTs - 5000;

  let status = normalizedBase;
  if (hasLivePrice) {
    status = "live";
  } else if (activeJob?.state === "leased") {
    status = "collecting";
  } else if (activeJob?.state === "queued") {
    status = "queued";
  } else if (recentFailure?.status) {
    status = "failed";
  }

  const lastError =
    recentFailure?.error_message || requestRow?.last_error || product?.last_error || null;

  return {
    status,
    product,
    latestPrice: latest
      ? {
          productId: latest.product_id,
          price: toNumberOrNull(latest.price),
          currency: latest.currency || null,
          scrapedAt: latest.scraped_at || null,
          source: latest.source || null,
          confidence: toNumberOrNull(latest.confidence)
        }
      : null,
    activeJob,
    lastError
  };
}

export function shouldPersistTrackStatus(fromStatus, nextStatus) {
  const from = normalizeStatus(fromStatus, "queued");
  const next = normalizeStatus(nextStatus, from);
  if (from === next) {
    return false;
  }

  if (TERMINAL_STATUSES.has(from)) {
    return false;
  }

  const fromRank = STATUS_RANK[from] || 0;
  const nextRank = STATUS_RANK[next] || 0;
  return nextRank >= fromRank;
}

export function buildTrackStatusPatch(existingRow, nextStatus, lastError = null) {
  const now = nowIso();
  const status = normalizeStatus(nextStatus, normalizeStatus(existingRow?.status));

  const patch = {
    status,
    last_error: lastError || null,
    updated_at: now
  };

  if (status === "collecting" && !existingRow?.first_claimed_at) {
    patch.first_claimed_at = now;
  }

  if (status === "live") {
    if (!existingRow?.first_live_at) {
      patch.first_live_at = now;
    }
    if (!existingRow?.completed_at) {
      patch.completed_at = now;
    }
  }

  if (status === "failed") {
    if (!existingRow?.completed_at) {
      patch.completed_at = now;
    }
  }

  if (status === "queued" && !existingRow?.queued_at) {
    patch.queued_at = now;
  }

  return patch;
}

export function serializeTrackRequestResponse({
  requestRow,
  derivedState,
  rateLimit = null
}) {
  const status = normalizeStatus(
    derivedState?.status || requestRow?.status,
    "queued"
  );

  return {
    requestId: requestRow?.id || null,
    status,
    source: requestRow?.source || "website",
    asin: requestRow?.asin || derivedState?.product?.asin || null,
    domain: requestRow?.domain || derivedState?.product?.domain || null,
    normalizedUrl:
      requestRow?.normalized_url || derivedState?.product?.url || null,
    product: derivedState?.product
      ? {
          id: derivedState.product.id,
          asin: derivedState.product.asin,
          title: derivedState.product.title,
          url: derivedState.product.url,
          domain: derivedState.product.domain,
          pricesUrl: `/prices?asin=${encodeURIComponent(
            derivedState.product.asin || ""
          )}`
        }
      : null,
    latestPrice: derivedState?.latestPrice || null,
    lastError: derivedState?.lastError || requestRow?.last_error || null,
    createdAt: requestRow?.created_at || null,
    updatedAt: requestRow?.updated_at || null,
    pollAfterMs:
      status === "queued" ? 3500 : status === "collecting" ? 2200 : null,
    rateLimit
  };
}
