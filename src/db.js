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
};
