const { scrapePrice } = require('./scraper');
const {
  claimDueProducts,
  getRecentPrices,
  insertPrice,
  updateProductById,
} = require('./db');
const {
  normalizeTier,
  computeNextScrapeAt,
  computeFailureBackoffMinutes,
  demoteTier,
  recommendAutoTier,
} = require('./tiering');

function trimErrorMessage(value) {
  return String(value || 'Unknown error').slice(0, 500);
}

async function runDueSync({ limit = 20 } = {}) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const dueProducts = await claimDueProducts(safeLimit);

  if (dueProducts.length === 0) {
    return {
      processed: 0,
      success: 0,
      failed: 0,
      items: [],
    };
  }

  const items = [];
  let success = 0;
  let failed = 0;

  for (const product of dueProducts) {
    const productTier = normalizeTier(product.tier, 'daily');
    const tierMode = String(product.tier_mode || 'auto');

    try {
      const result = await scrapePrice(product.url);
      if (!result.price) {
        throw new Error('Could not extract price from the page.');
      }

      await insertPrice({
        productId: product.id,
        price: result.price.numeric,
        currency: result.price.currency,
      });

      let nextTier = productTier;
      if (tierMode === 'auto') {
        const history = await getRecentPrices(product.id, 120);
        nextTier = recommendAutoTier(history);
      }

      const nowIso = new Date().toISOString();
      const lastPrice = Number(product.last_price);
      const hasLastPrice = Number.isFinite(lastPrice);
      const didPriceChange = !hasLastPrice || Math.abs(lastPrice - result.price.numeric) > 0.00001;

      const patch = {
        tier: nextTier,
        last_price: result.price.numeric,
        last_scraped_at: nowIso,
        next_scrape_at: computeNextScrapeAt(nextTier),
        consecutive_failures: 0,
        last_error: null,
      };
      if (didPriceChange) {
        patch.last_price_change_at = nowIso;
      }

      await updateProductById(product.id, patch);

      success += 1;
      items.push({
        asin: product.asin,
        status: 'ok',
        tier: nextTier,
        price: result.price.numeric,
        currency: result.price.currency,
        nextScrapeAt: patch.next_scrape_at,
      });
    } catch (err) {
      const nextFailures = (Number(product.consecutive_failures) || 0) + 1;
      let nextTier = productTier;
      if (tierMode === 'auto' && nextFailures >= 3) {
        nextTier = demoteTier(productTier);
      }

      const backoffMinutes = computeFailureBackoffMinutes(nextFailures);
      const nextScrapeAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      const errorMessage = trimErrorMessage(err.message);

      await updateProductById(product.id, {
        tier: nextTier,
        consecutive_failures: nextFailures,
        last_error: errorMessage,
        next_scrape_at: nextScrapeAt,
      });

      failed += 1;
      items.push({
        asin: product.asin,
        status: 'failed',
        tier: nextTier,
        nextScrapeAt,
        error: errorMessage,
      });
    }
  }

  return {
    processed: dueProducts.length,
    success,
    failed,
    items,
  };
}

module.exports = { runDueSync };

