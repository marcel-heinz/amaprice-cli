const { normalizeAmazonInput } = require('../url');
const { resolveCliInput } = require('../input');
const { runCollectionPipeline } = require('../extractors/pipeline');
const {
  getProductByAsin,
  upsertProduct,
  insertPrice,
  upsertProductLatestPrice,
  updateProductById,
  upsertUserSubscription,
} = require('../db');
const { getUserId } = require('../user-context');
const { maybeEnsureBackgroundOn } = require('../background/service');
const { normalizeTier, computeNextScrapeAt } = require('../tiering');

module.exports = function (program) {
  program
    .command('subscribe [input...]')
    .description('Subscribe the current user to a tracked product (shared product catalog)')
    .option('--tier <tier>', 'Preferred refresh tier for this subscription: hourly|daily|weekly')
    .option('--json', 'Output as JSON')
    .action(async (inputParts, opts) => {
      const input = await resolveCliInput(inputParts);
      const normalized = await normalizeAmazonInput(input);
      if (!normalized) {
        console.error('Error: Input must be an Amazon product URL or a valid ASIN.');
        process.exit(1);
      }

      const selectedTier = opts.tier ? normalizeTier(opts.tier) : null;
      if (opts.tier && !selectedTier) {
        console.error('Error: Tier must be one of: hourly, daily, weekly.');
        process.exit(1);
      }

      const userId = getUserId();

      try {
        let product = await getProductByAsin(normalized.asin);
        let initial = null;

        if (!product) {
          initial = await runCollectionPipeline({
            url: normalized.url,
            domain: normalized.domain,
            allowVision: true,
            allowRailwayDomFallback: true,
          });

          product = await upsertProduct({
            asin: normalized.asin,
            title: initial.pageTitle || `ASIN ${normalized.asin}`,
            url: normalized.url,
            domain: normalized.domain,
            tier: selectedTier || 'daily',
            nextScrapeAt: computeNextScrapeAt(selectedTier || 'daily'),
          });

          if (initial.price) {
            const priceRecord = await insertPrice({
              productId: product.id,
              price: initial.price.numeric,
              currency: initial.price.currency,
            });

            await upsertProductLatestPrice({
              productId: product.id,
              price: initial.price.numeric,
              currency: initial.price.currency,
              scrapedAt: priceRecord.scraped_at,
              source: initial.method,
              confidence: initial.confidence,
            }).catch(() => {});

            await updateProductById(product.id, {
              last_price: initial.price.numeric,
              last_scraped_at: priceRecord.scraped_at,
              consecutive_failures: 0,
              last_error: null,
              next_scrape_at: computeNextScrapeAt(selectedTier || product.tier || 'daily'),
              last_price_change_at: priceRecord.scraped_at,
            }).catch(() => {});
          }
        }

        if (selectedTier && normalizeTier(product.tier) !== selectedTier) {
          await updateProductById(product.id, {
            tier: selectedTier,
            next_scrape_at: computeNextScrapeAt(selectedTier),
          }).catch(() => {});
        }

        const subscription = await upsertUserSubscription({
          userId,
          productId: product.id,
          tierPref: selectedTier,
          isActive: true,
        });
        const background = await maybeEnsureBackgroundOn({ userId });

        if (opts.json) {
          console.log(JSON.stringify({
            userId,
            subscriptionId: subscription.id,
            active: subscription.is_active,
            tierPref: subscription.tier_pref,
            product: {
              id: product.id,
              asin: product.asin,
              domain: product.domain,
              url: product.url,
              title: product.title,
            },
            initialPrice: initial?.price?.numeric || null,
            initialCurrency: initial?.price?.currency || null,
            background,
          }));
          return;
        }

        console.log(`Subscribed: ${product.asin} (${product.title})`);
        console.log(`User:       ${userId}`);
        console.log(`Tier pref:  ${subscription.tier_pref || 'default'}`);
        if (background.running) {
          console.log(`Background: running (${background.pollSeconds || 180}s poll)`);
        } else if (background.attempted && background.error) {
          console.log(`Background: setup failed (${background.error})`);
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
