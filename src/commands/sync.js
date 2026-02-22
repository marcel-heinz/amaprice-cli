const { runDueSync } = require('../sync-runner');

module.exports = function (program) {
  program
    .command('sync')
    .description('Run background sync for due products (for cron/worker usage)')
    .option('--limit <n>', 'Max products to process in one run', '20')
    .option('--orchestrator', 'Use orchestrator queue flow')
    .option('--legacy', 'Force legacy due-products flow')
    .option('--json', 'Output as JSON')
    .action(async (opts) => {
      const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
      const useOrchestrator = opts.legacy
        ? false
        : (opts.orchestrator ? true : undefined);

      try {
        const report = await runDueSync({ limit, useOrchestrator });
        if (opts.json) {
          console.log(JSON.stringify(report));
        } else {
          if (report.processed === 0) {
            console.log('No due products.');
            return;
          }

          console.log(`Processed: ${report.processed}`);
          console.log(`Success:   ${report.success}`);
          console.log(`Failed:    ${report.failed}`);
          for (const item of report.items) {
            if (item.status === 'ok') {
              console.log(`  OK    ${item.asin}  ${item.price} ${item.currency}  tier=${item.tier}`);
            } else {
              console.log(`  FAIL  ${item.asin}  tier=${item.tier}  ${item.error}`);
            }
          }
        }
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
