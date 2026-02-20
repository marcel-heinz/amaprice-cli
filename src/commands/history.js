const { extractAsin } = require('../url');
const { getPriceHistory } = require('../db');
const { formatPrice } = require('../format');

module.exports = function (program) {
  program
    .command('history <url-or-asin>')
    .description('Show price history for a product')
    .option('--limit <n>', 'Number of entries to show', '30')
    .option('--json', 'Output as JSON')
    .action(async (urlOrAsin, opts) => {
      const asin = extractAsin(urlOrAsin);
      if (!asin) {
        console.error('Error: Could not extract ASIN from input.');
        process.exit(1);
      }

      try {
        const { product, history } = await getPriceHistory(asin, parseInt(opts.limit, 10));

        if (opts.json) {
          console.log(JSON.stringify({
            product: product.title,
            asin,
            url: product.url,
            history: history.map((h) => ({
              price: parseFloat(h.price),
              currency: h.currency,
              scrapedAt: h.scraped_at,
            })),
          }));
        } else {
          console.log(`Price history for: ${product.title}\n`);

          if (history.length === 0) {
            console.log('No price history found.');
            return;
          }

          for (const entry of history) {
            const date = new Date(entry.scraped_at).toLocaleString();
            const price = formatPrice(parseFloat(entry.price), entry.currency);
            console.log(`  ${date}  ${price}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
