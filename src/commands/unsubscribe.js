const { normalizeAmazonInput } = require('../url');
const { getProductByAsin, setUserSubscriptionActive } = require('../db');
const { getUserId } = require('../user-context');

module.exports = function (program) {
  program
    .command('unsubscribe <url-or-asin>')
    .description('Disable the current user subscription for a product')
    .option('--json', 'Output as JSON')
    .action(async (urlOrAsin, opts) => {
      const normalized = await normalizeAmazonInput(urlOrAsin);
      if (!normalized) {
        console.error('Error: Input must be an Amazon product URL or a valid ASIN.');
        process.exit(1);
      }

      const userId = getUserId();

      try {
        const product = await getProductByAsin(normalized.asin);
        if (!product) {
          console.error(`Error: Product ${normalized.asin} is not known yet.`);
          process.exit(1);
        }

        const subscription = await setUserSubscriptionActive({
          userId,
          productId: product.id,
          isActive: false,
        });

        if (opts.json) {
          console.log(JSON.stringify({
            userId,
            asin: normalized.asin,
            active: subscription.is_active,
            updatedAt: subscription.updated_at,
          }));
          return;
        }

        console.log(`Unsubscribed: ${normalized.asin}`);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
