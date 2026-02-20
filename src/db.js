const { createClient } = require('@supabase/supabase-js');
const { requireConfig } = require('./config');

let _client = null;

function getClient() {
  if (_client) return _client;
  const config = requireConfig();
  _client = createClient(config.supabaseUrl, config.supabaseKey);
  return _client;
}

/**
 * Upsert a product by ASIN. Returns the product row.
 */
async function upsertProduct({ asin, title, url, domain }) {
  const supabase = getClient();
  const { data, error } = await supabase
    .from('products')
    .upsert({ asin, title, url, domain }, { onConflict: 'asin' })
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
  // First get the product
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
  const { data: products, error } = await supabase
    .from('products')
    .select('id, asin, title, url, domain, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Supabase products error: ${error.message}`);

  // Fetch latest price for each product
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

module.exports = { getClient, upsertProduct, insertPrice, getPriceHistory, listProducts };
