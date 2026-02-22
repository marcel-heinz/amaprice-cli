const { getUserSubscriptions } = require('../db');
const { getUserId } = require('../user-context');
const { formatPrice } = require('../format');

module.exports = function (program) {
  program
    .command('subscriptions')
    .description('List current user subscriptions and latest known prices')
    .option('--all', 'Include inactive subscriptions')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const userId = getUserId();

      try {
        const rows = await getUserSubscriptions(userId, {
          activeOnly: !opts.all,
        });

        if (opts.json) {
          console.log(JSON.stringify(rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            active: row.is_active,
            tierPref: row.tier_pref,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            product: {
              id: row.product?.id || null,
              asin: row.product?.asin || null,
              title: row.product?.title || null,
              url: row.product?.url || null,
              domain: row.product?.domain || null,
              tier: row.product?.tier || null,
            },
            latestPrice: row.latestPrice ? Number(row.latestPrice.price) : null,
            latestCurrency: row.latestPrice?.currency || null,
            latestAt: row.latestPrice?.scraped_at || null,
          }))));
          return;
        }

        if (rows.length === 0) {
          console.log('No subscriptions found. Use `amaprice subscribe <url-or-asin>` to add one.');
          return;
        }

        console.log(`Subscriptions for ${userId}:`);
        for (const row of rows) {
          const price = row.latestPrice
            ? formatPrice(Number(row.latestPrice.price), row.latestPrice.currency)
            : 'N/A';
          const subStatus = row.is_active ? 'active' : 'inactive';
          const tier = row.product?.tier || 'daily';
          console.log(`  ${row.product?.asin || 'unknown'}  ${price}  [${subStatus}] [tier=${tier}]  ${row.product?.title || ''}`);
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
