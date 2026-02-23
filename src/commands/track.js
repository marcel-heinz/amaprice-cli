const { normalizeAmazonInput } = require('../url');
const { resolveCliInput } = require('../input');
const { scrapePrice } = require('../scraper');
const {
  upsertProduct,
  insertPrice,
  updateProductById,
  upsertUserSubscription,
  upsertProductLatestPrice,
} = require('../db');
const { getUserId } = require('../user-context');
const { maybeEnsureBackgroundOn } = require('../background/service');
const { normalizeTier, computeNextScrapeAt } = require('../tiering');

module.exports = function (program) {
  program
    .command('track [input...]')
    .description('Save product + current price to Supabase')
    .option('--tier <tier>', 'Set polling tier: hourly|daily|weekly')
    .option('--manual-tier', 'Pin this product to its current tier (disable auto-tier)')
    .option('--auto-tier', 'Enable automatic tiering for this product')
    .option('--inactive', 'Track product but do not include it in background sync')
    .option('--json', 'Output as JSON')
    .action(async (inputParts, opts) => {
      const input = await resolveCliInput(inputParts);
      const normalized = await normalizeAmazonInput(input);
      if (!normalized) {
        console.error('Error: Input must be an Amazon product URL or a valid ASIN.');
        process.exit(1);
      }

      const selectedTier = opts.tier ? normalizeTier(opts.tier) : undefined;
      if (opts.tier && !selectedTier) {
        console.error('Error: Tier must be one of: hourly, daily, weekly.');
        process.exit(1);
      }
      if (opts.manualTier && opts.autoTier) {
        console.error('Error: Use either --manual-tier or --auto-tier, not both.');
        process.exit(1);
      }

      try {
        const result = await scrapePrice(normalized.url);

        if (!result.price) {
          console.error('Error: Could not extract price from the page.');
          process.exit(1);
        }

        const product = await upsertProduct({
          asin: result.asin,
          title: result.title,
          url: result.url,
          domain: result.domain,
          tier: selectedTier,
          tierMode: opts.manualTier ? 'manual' : (opts.autoTier ? 'auto' : undefined),
          isActive: opts.inactive ? false : undefined,
          nextScrapeAt: selectedTier ? computeNextScrapeAt(selectedTier) : undefined,
        });

        const priceRecord = await insertPrice({
          productId: product.id,
          price: result.price.numeric,
          currency: result.price.currency,
        });
        await upsertProductLatestPrice({
          productId: product.id,
          price: result.price.numeric,
          currency: result.price.currency,
          scrapedAt: priceRecord.scraped_at,
          source: 'railway_dom',
          confidence: 0.8,
        }).catch(() => {});

        const nextTier = normalizeTier(product.tier, selectedTier || 'daily');
        const userId = getUserId();
        let subscription = null;
        const background = await maybeEnsureBackgroundOn({ userId });
        try {
          await updateProductById(product.id, {
            last_price: result.price.numeric,
            last_scraped_at: priceRecord.scraped_at,
            consecutive_failures: 0,
            last_error: null,
            next_scrape_at: computeNextScrapeAt(nextTier),
            last_price_change_at: priceRecord.scraped_at,
          });
          subscription = await upsertUserSubscription({
            userId,
            productId: product.id,
            tierPref: selectedTier || null,
            isActive: true,
          });
        } catch {
          // Background scheduling/subscription fields may not exist before migration.
        }

        if (opts.json) {
          console.log(JSON.stringify({
            product: result.title,
            asin: result.asin,
            price: result.priceRaw,
            priceNumeric: result.price.numeric,
            currency: result.price.currency,
            productId: product.id,
            priceRecordId: priceRecord.id,
            trackedAt: priceRecord.scraped_at,
            tier: nextTier,
            tierMode: opts.manualTier ? 'manual' : (opts.autoTier ? 'auto' : (product.tier_mode || 'auto')),
            active: opts.inactive ? false : (product.is_active ?? true),
            userId,
            subscribed: Boolean(subscription),
            background,
          }));
        } else {
          console.log(`Tracking: ${result.title}`);
          console.log(`ASIN:     ${result.asin}`);
          console.log(`Price:    ${result.priceRaw}`);
          console.log(`Tier:     ${nextTier}`);
          if (background.running) {
            console.log(`Background collector: running (${background.pollSeconds || 180}s poll)`);
          } else if (background.attempted && background.error) {
            console.log(`Background collector: setup failed (${background.error})`);
          }
          console.log(`Saved to Supabase.`);
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
