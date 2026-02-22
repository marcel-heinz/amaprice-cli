const { listProducts, getUserSubscriptions } = require('../db');
const { formatPrice } = require('../format');
const { getUserId } = require('../user-context');

module.exports = function (program) {
  program
    .command('list')
    .description('Show tracked products (subscriptions by default)')
    .option('--global', 'Show global tracked products instead of current user subscriptions')
    .option('--all', 'Include inactive subscriptions (subscriptions mode only)')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      try {
        if (!opts.global) {
          const userId = getUserId();
          try {
            const subscriptions = await getUserSubscriptions(userId, { activeOnly: !opts.all });
            if (opts.json) {
              console.log(JSON.stringify(subscriptions.map((row) => ({
                asin: row.product?.asin || null,
                title: row.product?.title || null,
                url: row.product?.url || null,
                domain: row.product?.domain || null,
                active: row.is_active,
                tier: row.product?.tier || 'daily',
                tierPref: row.tier_pref || null,
                latestPrice: row.latestPrice ? parseFloat(row.latestPrice.price) : null,
                currency: row.latestPrice?.currency || null,
                lastScraped: row.latestPrice?.scraped_at || null,
              }))));
              return;
            }

            if (subscriptions.length === 0) {
              console.log('No subscriptions found. Use `amaprice subscribe <url-or-asin>` to start tracking.');
              return;
            }

            console.log(`Subscriptions for ${userId}:`);
            for (const row of subscriptions) {
              const price = row.latestPrice
                ? formatPrice(parseFloat(row.latestPrice.price), row.latestPrice.currency)
                : 'N/A';
              const tier = row.product?.tier || 'daily';
              const status = row.is_active ? tier : 'paused';
              console.log(`  ${row.product?.asin || 'unknown'}  ${price}  [${status}]  ${row.product?.title || ''}`);
            }
            return;
          } catch (err) {
            const msg = String(err.message || '');
            if (!/hybrid orchestration migration/i.test(msg)) {
              throw err;
            }
            // Hybrid schema unavailable; fallback to legacy global listing.
          }
        }

        const products = await listProducts();

        if (opts.json) {
          console.log(JSON.stringify(products.map((p) => ({
            asin: p.asin,
            title: p.title,
            url: p.url,
            domain: p.domain,
            tier: p.tier ?? 'daily',
            tierMode: p.tier_mode ?? 'auto',
            active: p.is_active ?? true,
            nextScrapeAt: p.next_scrape_at ?? null,
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
            const tier = p.tier || 'daily';
            const status = p.is_active === false ? 'paused' : tier;
            console.log(`  ${p.asin}  ${price}  [${status}]  ${p.title}`);
          }
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
