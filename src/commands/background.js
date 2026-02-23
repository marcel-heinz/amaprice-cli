const { getUserId } = require('../user-context');
const {
  ensureBackgroundOn,
  ensureBackgroundOff,
  getBackgroundStatus,
  resolveCollectorLimit,
  resolvePollSeconds,
} = require('../background/service');

module.exports = function (program) {
  program
    .command('background <action>')
    .description('Manage automatic background collector service (on|off|status)')
    .option('--poll-seconds <n>', 'Polling interval in seconds (default: 180)')
    .option('--limit <n>', 'Max jobs per poll (default: 10)')
    .option('--json', 'Output as JSON')
    .action(async (action, opts) => {
      const normalizedAction = String(action || '').trim().toLowerCase();
      const userId = getUserId();

      try {
        if (normalizedAction === 'on') {
          const report = await ensureBackgroundOn({
            userId,
            pollSeconds: opts.pollSeconds,
            limit: opts.limit,
          });

          if (opts.json) {
            console.log(JSON.stringify(report));
            return;
          }

          if (!report.supported) {
            console.log(`Background service unsupported on platform: ${process.platform}`);
            return;
          }

          const pollSeconds = resolvePollSeconds(opts.pollSeconds);
          const limit = resolveCollectorLimit(opts.limit);
          console.log(`Background collector ON (poll=${pollSeconds}s limit=${limit})`);
          return;
        }

        if (normalizedAction === 'off') {
          const report = await ensureBackgroundOff({ userId });

          if (opts.json) {
            console.log(JSON.stringify(report));
            return;
          }

          if (!report.supported) {
            console.log(`Background service unsupported on platform: ${process.platform}`);
            return;
          }

          console.log('Background collector OFF');
          return;
        }

        if (normalizedAction === 'status') {
          const report = await getBackgroundStatus({ userId });
          if (opts.json) {
            console.log(JSON.stringify(report));
            return;
          }

          if (!report.supported) {
            console.log(`Background service unsupported on platform: ${process.platform}`);
            return;
          }

          console.log(`Background collector: ${report.service.running ? 'running' : 'stopped'}`);
          if (report.local?.background?.pollSeconds) {
            console.log(`Poll interval:       ${report.local.background.pollSeconds}s`);
          }
          if (report.local?.background?.limit) {
            console.log(`Poll limit:          ${report.local.background.limit}`);
          }
          if (report.local?.collectorId) {
            console.log(`Collector ID:        ${report.local.collectorId}`);
          }
          if (report.remote?.last_seen_at) {
            console.log(`Last heartbeat:      ${report.remote.last_seen_at}`);
          }
          return;
        }

        console.error('Unknown background action. Use: on, off, status.');
        process.exit(1);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
