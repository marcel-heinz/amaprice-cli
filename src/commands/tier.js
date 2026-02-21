const { extractAsin, normalizeAmazonInput } = require('../url');
const { getProductByAsin, updateProductByAsin } = require('../db');
const { normalizeTier, computeNextScrapeAt } = require('../tiering');

module.exports = function (program) {
  program
    .command('tier <url-or-asin> <tier>')
    .description('Set polling tier for a tracked product (hourly|daily|weekly)')
    .option('--auto', 'Enable automatic re-tiering based on price behavior')
    .option('--manual', 'Keep this tier fixed')
    .option('--activate', 'Enable background sync for this product')
    .option('--deactivate', 'Disable background sync for this product')
    .option('--json', 'Output as JSON')
    .action(async (urlOrAsin, tierArg, opts) => {
      let asin = extractAsin(urlOrAsin);
      if (!asin) {
        const normalized = await normalizeAmazonInput(urlOrAsin);
        asin = normalized?.asin ?? null;
      }
      if (!asin) {
        console.error('Error: Could not extract ASIN from input.');
        process.exit(1);
      }

      const tier = normalizeTier(tierArg);
      if (!tier) {
        console.error('Error: Tier must be one of: hourly, daily, weekly.');
        process.exit(1);
      }

      if (opts.activate && opts.deactivate) {
        console.error('Error: Use either --activate or --deactivate, not both.');
        process.exit(1);
      }

      try {
        const product = await getProductByAsin(asin);
        if (!product) {
          console.error(`Error: Product with ASIN ${asin} is not tracked yet.`);
          process.exit(1);
        }

        let tierMode = product.tier_mode || 'auto';
        if (opts.auto) tierMode = 'auto';
        if (opts.manual) tierMode = 'manual';
        if (!opts.auto && !opts.manual) tierMode = 'manual';

        const patch = {
          tier,
          tier_mode: tierMode,
          next_scrape_at: computeNextScrapeAt(tier),
        };
        if (opts.activate) patch.is_active = true;
        if (opts.deactivate) patch.is_active = false;

        const updated = await updateProductByAsin(asin, patch);

        if (opts.json) {
          console.log(JSON.stringify({
            asin: updated.asin,
            tier: updated.tier,
            tierMode: updated.tier_mode,
            active: updated.is_active,
            nextScrapeAt: updated.next_scrape_at,
          }));
        } else {
          console.log(`ASIN:        ${updated.asin}`);
          console.log(`Tier:        ${updated.tier}`);
          console.log(`Tier mode:   ${updated.tier_mode}`);
          console.log(`Active:      ${updated.is_active ? 'yes' : 'no'}`);
          console.log(`Next scrape: ${updated.next_scrape_at}`);
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
