const { normalizeAmazonInput } = require('../url');
const { resolveCliInput } = require('../input');
const { scrapePrice } = require('../scraper');
const { upsertProduct, insertPrice, updateProductById } = require('../db');
const { normalizeTier, computeNextScrapeAt } = require('../tiering');

module.exports = function (program) {
  program
    .command('price [input...]')
    .description('One-shot price lookup for an Amazon product URL or ASIN')
    .option('--json', 'Output as JSON')
    .action(async (inputParts, opts) => {
      const input = await resolveCliInput(inputParts);
      const normalized = await normalizeAmazonInput(input);
      if (!normalized) {
        console.error('Error: Input must be an Amazon product URL or a valid ASIN.');
        process.exit(1);
      }

      try {
        const result = await scrapePrice(normalized.url);

        if (opts.json) {
          console.log(JSON.stringify({
            product: result.title,
            price: result.priceRaw ?? 'Not found',
            priceNumeric: result.price?.numeric ?? null,
            currency: result.price?.currency ?? null,
            url: result.url,
            asin: result.asin,
            scrapedAt: new Date().toISOString(),
          }));
        } else {
          console.log(`Product: ${result.title}`);
          console.log(`Price:   ${result.priceRaw ?? 'Not found'}`);
          console.log(`URL:     ${result.url}`);
        }

        // Silently record to Supabase for data gathering
        if (result.price && result.asin) {
          try {
            const product = await upsertProduct({
              asin: result.asin,
              title: result.title,
              url: result.url,
              domain: result.domain,
            });
            await insertPrice({
              productId: product.id,
              price: result.price.numeric,
              currency: result.price.currency,
            });
            const tier = normalizeTier(product.tier, 'daily');
            await updateProductById(product.id, {
              last_price: result.price.numeric,
              last_scraped_at: new Date().toISOString(),
              consecutive_failures: 0,
              last_error: null,
              next_scrape_at: computeNextScrapeAt(tier),
              last_price_change_at: new Date().toISOString(),
            });
          } catch {
            // Silent — don't disrupt the user experience
          }
        }
      } catch (err) {
        console.error(`Error scraping price: ${err.message}`);
        process.exit(1);
      }
    });
};
