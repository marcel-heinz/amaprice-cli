const { createClient } = require('@supabase/supabase-js');
const { SUPABASE_URL, SUPABASE_KEY } = require('./config');

let _client = null;

function getClient() {
  if (_client) return _client;
  _client = createClient(SUPABASE_URL, SUPABASE_KEY);
  return _client;
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

function isMissingSchedulingSchema(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42703' || code === 'PGRST204' || /column .* does not exist/i.test(message);
}

function isMissingRelation(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return code === '42P01' || code === 'PGRST205' || /relation .* does not exist/i.test(message);
}

function isMissingRpc(error) {
  const code = String(error?.code || '');
  return code === '42883' || code === 'PGRST202';
}

function isMissingHybridSchema(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  return (
    code === '42P01'
    || code === 'PGRST205'
    || code === '42703'
    || code === 'PGRST204'
    || /relation .* does not exist/i.test(message)
    || /column .* does not exist/i.test(message)
    || /collection_jobs/i.test(message)
    || /collection_attempts/i.test(message)
    || /user_subscriptions/i.test(message)
    || /product_latest_price/i.test(message)
    || /collectors/i.test(message)
  );
}

/**
 * Upsert a product by ASIN. Returns the product row.
 */
async function upsertProduct({
  asin,
  title,
  url,
  domain,
  tier,
  tierMode,
  isActive,
  nextScrapeAt,
}) {
  const supabase = getClient();
  const payload = cleanPayload({
    asin,
    title,
    url,
    domain,
    tier,
    tier_mode: tierMode,
    is_active: isActive,
    next_scrape_at: nextScrapeAt,
  });

  const { data, error } = await supabase
    .from('products')
    .upsert(payload, { onConflict: 'asin' })
    .select()
    .single();
  if (error) throw new Error(`Supabase products error: ${error.message}`);
  return data;
}

/**
 * Insert a price record for a product.
 */
async function insertPrice({ productId, price, currency }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('price_history')
    .insert({ product_id: productId, price, currency })
    .select()
    .single();
  if (error) throw new Error(`Supabase price_history error: ${error.message}`);
  return data;
}

/**
 * Get price history for a product by ASIN.
 */
async function getPriceHistory(asin, limit = 30) {
  const supabase = getClient();
  const { data: product, error: pErr } = await supabase
    .from('products')
    .select('id, title, url')
    .eq('asin', asin)
    .single();
  if (pErr) throw new Error(`Product not found for ASIN ${asin}: ${pErr.message}`);

  const { data: history, error: hErr } = await supabase
    .from('price_history')
    .select('price, currency, scraped_at')
    .eq('product_id', product.id)
    .order('scraped_at', { ascending: false })
    .limit(limit);
  if (hErr) throw new Error(`Supabase price_history error: ${hErr.message}`);

  return { product, history };
}

/**
 * List all tracked products with their latest price.
 */
async function listProducts() {
  const supabase = getClient();
  const firstAttempt = await supabase
    .from('products')
    .select('id, asin, title, url, domain, created_at, tier, tier_mode, is_active, next_scrape_at, last_scraped_at, consecutive_failures')
    .order('created_at', { ascending: false });
  let products = firstAttempt.data;

  if (firstAttempt.error) {
    if (!isMissingSchedulingSchema(firstAttempt.error)) {
      throw new Error(`Supabase products error: ${firstAttempt.error.message}`);
    }

    const fallback = await supabase
      .from('products')
      .select('id, asin, title, url, domain, created_at')
      .order('created_at', { ascending: false });
    if (fallback.error) throw new Error(`Supabase products error: ${fallback.error.message}`);
    products = (fallback.data || []).map((p) => ({
      ...p,
      tier: 'daily',
      tier_mode: 'auto',
      is_active: true,
      next_scrape_at: null,
      last_scraped_at: null,
      consecutive_failures: 0,
    }));
  }

  const results = [];
  for (const product of products) {
    const { data: prices } = await supabase
      .from('price_history')
      .select('price, currency, scraped_at')
      .eq('product_id', product.id)
      .order('scraped_at', { ascending: false })
      .limit(1);

    results.push({
      ...product,
      latestPrice: prices?.[0] ?? null,
    });
  }

  return results;
}

async function getProductByAsin(asin) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .select('id, asin, title, url, domain, tier, tier_mode, is_active, next_scrape_at, last_scraped_at, consecutive_failures, last_price, created_at')
    .eq('asin', asin)
    .maybeSingle();

  if (error) {
    if (isMissingSchedulingSchema(error)) {
      throw new Error(`Supabase products error: ${error.message}. Did you run the tier scheduler migration?`);
    }
    throw new Error(`Supabase products error: ${error.message}`);
  }
  return data;
}

async function updateProductById(productId, patch) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .update(cleanPayload(patch))
    .eq('id', productId)
    .select()
    .single();
  if (error) {
    if (isMissingSchedulingSchema(error)) {
      throw new Error(`Supabase products error: ${error.message}. Did you run the tier scheduler migration?`);
    }
    throw new Error(`Supabase products error: ${error.message}`);
  }
  return data;
}

async function updateProductByAsin(asin, patch) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .update(cleanPayload(patch))
    .eq('asin', asin)
    .select()
    .single();
  if (error) {
    if (isMissingSchedulingSchema(error)) {
      throw new Error(`Supabase products error: ${error.message}. Did you run the tier scheduler migration?`);
    }
    throw new Error(`Supabase products error: ${error.message}`);
  }
  return data;
}

async function getRecentPrices(productId, limit = 120) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('price_history')
    .select('price, currency, scraped_at')
    .eq('product_id', productId)
    .order('scraped_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Supabase price_history error: ${error.message}`);
  return data || [];
}

async function claimDueProducts(limit = 20) {
  const supabase = getClient();
  const safeLimit = Math.max(1, Number(limit) || 20);

  const rpcResp = await supabase.rpc('claim_due_products', { p_limit: safeLimit });
  if (!rpcResp.error) {
    return rpcResp.data || [];
  }

  const isMissingRpc = rpcResp.error.code === '42883' || rpcResp.error.code === 'PGRST202';
  if (!isMissingRpc) {
    throw new Error(`Supabase claim_due_products error: ${rpcResp.error.message}`);
  }

  const nowIso = new Date().toISOString();
  const { data: products, error } = await supabase
    .from('products')
    .select('id, asin, title, url, domain, tier, tier_mode, is_active, next_scrape_at, last_scraped_at, consecutive_failures, last_price')
    .eq('is_active', true)
    .lte('next_scrape_at', nowIso)
    .order('next_scrape_at', { ascending: true })
    .limit(safeLimit);

  if (error) {
    throw new Error(`Supabase products error: ${error.message}. Did you run the tier scheduler migration?`);
  }

  if (!products || products.length === 0) return [];

  const lockUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const ids = products.map((p) => p.id);
  const { error: lockErr } = await supabase
    .from('products')
    .update({ next_scrape_at: lockUntil })
    .in('id', ids);
  if (lockErr) throw new Error(`Supabase lock error: ${lockErr.message}`);

  return products.map((p) => ({ ...p, next_scrape_at: lockUntil }));
}

async function insertScrapeAttempt({
  productId,
  status,
  httpStatus = null,
  blockedSignal = false,
  errorCode = null,
  errorMessage = null,
  price = null,
  currency = null,
}) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('scrape_attempts')
    .insert({
      product_id: productId,
      status,
      http_status: httpStatus,
      blocked_signal: blockedSignal,
      error_code: errorCode,
      error_message: errorMessage,
      price,
      currency,
    })
    .select()
    .single();

  if (error) {
    if (isMissingRelation(error)) {
      throw new Error(`Supabase scrape_attempts error: ${error.message}. Did you run the scrape attempts migration?`);
    }
    throw new Error(`Supabase scrape_attempts error: ${error.message}`);
  }
  return data;
}

async function upsertUserSubscription({
  userId,
  productId,
  tierPref = null,
  isActive = true,
}) {
  const supabase = getClient();
  const payload = cleanPayload({
    user_id: userId,
    product_id: productId,
    tier_pref: tierPref,
    is_active: isActive,
    updated_at: new Date().toISOString(),
  });

  const { data, error } = await supabase
    .from('user_subscriptions')
    .upsert(payload, { onConflict: 'user_id,product_id' })
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase user_subscriptions error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase user_subscriptions error: ${error.message}`);
  }
  return data;
}

async function setUserSubscriptionActive({
  userId,
  productId,
  isActive,
}) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('user_subscriptions')
    .update({
      is_active: Boolean(isActive),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('product_id', productId)
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase user_subscriptions error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase user_subscriptions error: ${error.message}`);
  }
  return data;
}

async function getUserSubscriptions(userId, { activeOnly = true } = {}) {
  const supabase = getClient();
  let query = supabase
    .from('user_subscriptions')
    .select(`
      id,
      user_id,
      tier_pref,
      is_active,
      created_at,
      updated_at,
      product:products(
        id,
        asin,
        title,
        url,
        domain,
        tier,
        tier_mode,
        is_active,
        next_scrape_at,
        last_scraped_at,
        last_price
      )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase user_subscriptions error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase user_subscriptions error: ${error.message}`);
  }

  const rows = data || [];
  const productIds = [...new Set(rows.map((row) => row.product?.id).filter(Boolean))];
  let latestByProduct = new Map();

  if (productIds.length > 0) {
    const latestResp = await supabase
      .from('product_latest_price')
      .select('product_id, price, currency, scraped_at, source, confidence')
      .in('product_id', productIds);

    if (!latestResp.error) {
      latestByProduct = new Map((latestResp.data || []).map((row) => [row.product_id, row]));
    } else if (!isMissingHybridSchema(latestResp.error)) {
      throw new Error(`Supabase product_latest_price error: ${latestResp.error.message}`);
    }
  }

  return rows.map((row) => ({
    ...row,
    latestPrice: latestByProduct.get(row.product?.id) || null,
  }));
}

async function upsertCollector({
  collectorId = null,
  userId,
  name,
  kind = 'cli',
  status = 'active',
  capabilities = {},
  metadata = {},
  heartbeatIntervalSeconds = 30,
}) {
  const supabase = getClient();
  const payload = cleanPayload({
    id: collectorId || undefined,
    user_id: userId,
    name,
    kind,
    status,
    capabilities,
    metadata,
    heartbeat_interval_seconds: heartbeatIntervalSeconds,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const { data, error } = await supabase
    .from('collectors')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase collectors error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase collectors error: ${error.message}`);
  }
  return data;
}

async function getCollectorById(collectorId) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('collectors')
    .select('*')
    .eq('id', collectorId)
    .maybeSingle();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase collectors error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase collectors error: ${error.message}`);
  }
  return data;
}

async function heartbeatCollector({
  collectorId,
  status = 'active',
  capabilities = null,
  metadata = null,
}) {
  const supabase = getClient();
  const rpcResp = await supabase.rpc('heartbeat_collector', {
    p_collector_id: collectorId,
    p_status: status,
    p_capabilities: capabilities,
    p_metadata: metadata,
  });

  if (!rpcResp.error) {
    return rpcResp.data;
  }

  if (!isMissingRpc(rpcResp.error)) {
    if (isMissingHybridSchema(rpcResp.error)) {
      throw new Error(`Supabase heartbeat_collector error: ${rpcResp.error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase heartbeat_collector error: ${rpcResp.error.message}`);
  }

  const { data, error } = await supabase
    .from('collectors')
    .update(cleanPayload({
      status,
      capabilities: capabilities || undefined,
      metadata: metadata || undefined,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }))
    .eq('id', collectorId)
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase collectors error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase collectors error: ${error.message}`);
  }
  return data;
}

async function enqueueDueCollectionJobs(limit = 20) {
  const supabase = getClient();
  const safeLimit = Math.max(1, Number(limit) || 20);
  const rpcResp = await supabase.rpc('enqueue_due_collection_jobs', { p_limit: safeLimit });

  if (!rpcResp.error) {
    return Number(rpcResp.data || 0);
  }

  if (!isMissingRpc(rpcResp.error)) {
    if (isMissingHybridSchema(rpcResp.error)) {
      throw new Error(`Supabase enqueue_due_collection_jobs error: ${rpcResp.error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase enqueue_due_collection_jobs error: ${rpcResp.error.message}`);
  }

  // Fallback behavior: no-op if RPC is unavailable.
  return 0;
}

async function claimCollectionJobs({
  collectorId,
  limit = 5,
  leaseSeconds = 90,
  routeHint = null,
}) {
  const supabase = getClient();
  const safeLimit = Math.max(1, Number(limit) || 5);
  const safeLeaseSeconds = Math.max(30, Number(leaseSeconds) || 90);
  const rpcResp = await supabase.rpc('claim_collection_jobs', {
    p_collector_id: collectorId,
    p_limit: safeLimit,
    p_lease_seconds: safeLeaseSeconds,
    p_route_hint: routeHint,
  });

  if (!rpcResp.error) {
    return rpcResp.data || [];
  }

  if (!isMissingRpc(rpcResp.error)) {
    if (isMissingHybridSchema(rpcResp.error)) {
      throw new Error(`Supabase claim_collection_jobs error: ${rpcResp.error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase claim_collection_jobs error: ${rpcResp.error.message}`);
  }

  // Fallback behavior: no-op if RPC is unavailable.
  return [];
}

async function completeCollectionJob({
  jobId,
  state,
  lastError = null,
  nextScheduledFor = null,
}) {
  const supabase = getClient();
  const rpcResp = await supabase.rpc('complete_collection_job', {
    p_job_id: jobId,
    p_state: state,
    p_last_error: lastError,
    p_next_scheduled_for: nextScheduledFor,
  });

  if (!rpcResp.error) {
    return rpcResp.data;
  }

  if (!isMissingRpc(rpcResp.error)) {
    if (isMissingHybridSchema(rpcResp.error)) {
      throw new Error(`Supabase complete_collection_job error: ${rpcResp.error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase complete_collection_job error: ${rpcResp.error.message}`);
  }

  const { data, error } = await supabase
    .from('collection_jobs')
    .update(cleanPayload({
      state,
      last_error: lastError,
      scheduled_for: nextScheduledFor,
      leased_by: null,
      lease_until: null,
      updated_at: new Date().toISOString(),
    }))
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase collection_jobs error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase collection_jobs error: ${error.message}`);
  }
  return data;
}

async function requeueExpiredCollectionJobs(limit = 100) {
  const supabase = getClient();
  const safeLimit = Math.max(1, Number(limit) || 100);
  const rpcResp = await supabase.rpc('requeue_expired_collection_jobs', { p_limit: safeLimit });
  if (!rpcResp.error) {
    return Number(rpcResp.data || 0);
  }

  if (!isMissingRpc(rpcResp.error)) {
    if (isMissingHybridSchema(rpcResp.error)) {
      throw new Error(`Supabase requeue_expired_collection_jobs error: ${rpcResp.error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase requeue_expired_collection_jobs error: ${rpcResp.error.message}`);
  }

  return 0;
}

async function insertCollectionAttempt({
  jobId,
  productId,
  collectorId = null,
  executor,
  method,
  status,
  httpStatus = null,
  blockedSignal = false,
  errorCode = null,
  errorMessage = null,
  price = null,
  currency = null,
  confidence = null,
  debug = null,
  startedAt = null,
  finishedAt = null,
}) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('collection_attempts')
    .insert(cleanPayload({
      job_id: jobId,
      product_id: productId,
      collector_id: collectorId,
      executor,
      method,
      status,
      http_status: httpStatus,
      blocked_signal: blockedSignal,
      error_code: errorCode,
      error_message: errorMessage,
      price,
      currency,
      confidence,
      debug,
      started_at: startedAt,
      finished_at: finishedAt,
    }))
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase collection_attempts error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase collection_attempts error: ${error.message}`);
  }
  return data;
}

async function upsertProductLatestPrice({
  productId,
  price,
  currency,
  scrapedAt,
  source,
  confidence = null,
}) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('product_latest_price')
    .upsert({
      product_id: productId,
      price,
      currency,
      scraped_at: scrapedAt,
      source,
      confidence,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'product_id' })
    .select()
    .single();

  if (error) {
    if (isMissingHybridSchema(error)) {
      throw new Error(`Supabase product_latest_price error: ${error.message}. Did you run the hybrid orchestration migration?`);
    }
    throw new Error(`Supabase product_latest_price error: ${error.message}`);
  }
  return data;
}

module.exports = {
  getClient,
  upsertProduct,
  insertPrice,
  getPriceHistory,
  listProducts,
  getProductByAsin,
  updateProductById,
  updateProductByAsin,
  getRecentPrices,
  claimDueProducts,
  insertScrapeAttempt,
  upsertUserSubscription,
  setUserSubscriptionActive,
  getUserSubscriptions,
  upsertCollector,
  getCollectorById,
  heartbeatCollector,
  enqueueDueCollectionJobs,
  claimCollectionJobs,
  completeCollectionJob,
  requeueExpiredCollectionJobs,
  insertCollectionAttempt,
  upsertProductLatestPrice,
};
