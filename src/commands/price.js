const { isAmazonUrl, extractAsin } = require('../url');
const { scrapePrice } = require('../scraper');

module.exports = function (program) {
  program
    .command('price <url>')
    .description('One-shot price lookup for an Amazon product')
    .option('--json', 'Output as JSON')
    .action(async (url, opts) => {
      if (!isAmazonUrl(url)) {
        console.error('Error: URL does not appear to be an Amazon link.');
        process.exit(1);
      }

      try {
        const result = await scrapePrice(url);

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
      } catch (err) {
        console.error(`Error scraping price: ${err.message}`);
        process.exit(1);
      }
    });
};
