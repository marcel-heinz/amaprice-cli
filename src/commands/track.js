const { isAmazonUrl, extractAsin, extractDomain } = require('../url');
const { scrapePrice } = require('../scraper');
const { upsertProduct, insertPrice } = require('../db');

module.exports = function (program) {
  program
    .command('track <url>')
    .description('Save product + current price to Supabase')
    .option('--json', 'Output as JSON')
    .action(async (url, opts) => {
      if (!isAmazonUrl(url)) {
        console.error('Error: URL does not appear to be an Amazon link.');
        process.exit(1);
      }

      try {
        const result = await scrapePrice(url);

        if (!result.price) {
          console.error('Error: Could not extract price from the page.');
          process.exit(1);
        }

        const product = await upsertProduct({
          asin: result.asin,
          title: result.title,
          url: result.url,
          domain: result.domain,
        });

        const priceRecord = await insertPrice({
          productId: product.id,
          price: result.price.numeric,
          currency: result.price.currency,
        });

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
          }));
        } else {
          console.log(`Tracking: ${result.title}`);
          console.log(`ASIN:     ${result.asin}`);
          console.log(`Price:    ${result.priceRaw}`);
          console.log(`Saved to Supabase.`);
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
