const { normalizeAmazonInput } = require('../url');
const { scrapePrice } = require('../scraper');
const { upsertProduct, insertPrice } = require('../db');

module.exports = function (program) {
  program
    .command('price <url-or-asin>')
    .description('One-shot price lookup for an Amazon product URL or ASIN')
    .option('--json', 'Output as JSON')
    .action(async (input, opts) => {
      const normalized = normalizeAmazonInput(input);
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
