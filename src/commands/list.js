const { listProducts } = require('../db');
const { formatPrice } = require('../format');

module.exports = function (program) {
  program
    .command('list')
    .description('Show all tracked products with latest price')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        const products = await listProducts();

        if (opts.json) {
          console.log(JSON.stringify(products.map((p) => ({
            asin: p.asin,
            title: p.title,
            url: p.url,
            domain: p.domain,
            latestPrice: p.latestPrice ? parseFloat(p.latestPrice.price) : null,
            currency: p.latestPrice?.currency ?? null,
            lastScraped: p.latestPrice?.scraped_at ?? null,
          }))));
        } else {
          if (products.length === 0) {
            console.log('No tracked products. Use `amaprice track <url-or-asin>` to start tracking.');
            return;
          }

          for (const p of products) {
            const price = p.latestPrice
              ? formatPrice(parseFloat(p.latestPrice.price), p.latestPrice.currency)
              : 'N/A';
            console.log(`  ${p.asin}  ${price}  ${p.title}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
