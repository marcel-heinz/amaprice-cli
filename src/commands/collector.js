const os = require('os');
const { getUserId } = require('../user-context');
const {
  upsertCollector,
  getCollectorById,
  heartbeatCollector,
} = require('../db');
const {
  readCollectorState,
  writeCollectorState,
  clearCollectorState,
  getCollectorStatePath,
} = require('../collector/state');
const {
  runCollectorOnce,
  runCollectorLoop,
} = require('../collector/client');

function getDefaultCollectorName() {
  return `${os.hostname()}-collector`;
}

module.exports = function (program) {
  program
    .command('collector <action>')
    .description('Manage local collector process (advanced/debug)')
    .option('--name <name>', 'Collector name override')
    .option('--limit <n>', 'Max jobs per loop/once run', '10')
    .option('--poll-seconds <n>', 'Polling interval for start loop', '180')
    .option('--json', 'Output as JSON')
    .action(async (action, opts) => {
      const normalizedAction = String(action || '').trim().toLowerCase();
      const userId = getUserId();
      const limit = Math.max(1, Number(opts.limit) || 10);
      const pollSeconds = Math.max(30, Number(opts.pollSeconds) || 180);

      try {
        if (normalizedAction === 'enable') {
          const existing = await readCollectorState();
          const collector = await upsertCollector({
            collectorId: existing?.collectorId || null,
            userId,
            name: opts.name || existing?.name || getDefaultCollectorName(),
            kind: 'cli',
            status: 'active',
            capabilities: {
              html_json: true,
              vision: true,
              railway_dom: true,
            },
            metadata: {
              platform: process.platform,
              node: process.version,
            },
          });

          const nextState = {
            collectorId: collector.id,
            userId,
            name: collector.name,
            status: 'active',
            capabilities: collector.capabilities,
            enabledAt: new Date().toISOString(),
          };
          const statePath = await writeCollectorState(nextState);

          if (opts.json) {
            console.log(JSON.stringify({
              enabled: true,
              collectorId: collector.id,
              statePath,
            }));
            return;
          }

          console.log(`Collector enabled: ${collector.id}`);
          console.log(`State file:        ${statePath}`);
          return;
        }

        if (normalizedAction === 'disable') {
          const existing = await readCollectorState();
          if (existing?.collectorId) {
            await heartbeatCollector({
              collectorId: existing.collectorId,
              status: 'revoked',
            }).catch(() => {});
          }
          await clearCollectorState();

          if (opts.json) {
            console.log(JSON.stringify({ enabled: false }));
            return;
          }

          console.log('Collector disabled.');
          return;
        }

        if (normalizedAction === 'status') {
          const state = await readCollectorState();
          const remote = state?.collectorId
            ? await getCollectorById(state.collectorId).catch(() => null)
            : null;

          if (opts.json) {
            console.log(JSON.stringify({
              statePath: getCollectorStatePath(),
              local: state,
              remote,
            }));
            return;
          }

          if (!state) {
            console.log('Collector is not enabled.');
            console.log(`State file: ${getCollectorStatePath()}`);
            return;
          }

          console.log(`Collector ID: ${state.collectorId}`);
          console.log(`Status:       ${state.status || 'active'}`);
          console.log(`State file:   ${getCollectorStatePath()}`);
          if (remote) {
            console.log(`Last seen:    ${remote.last_seen_at || 'never'}`);
            console.log(`Remote:       ${remote.status}`);
          }
          return;
        }

        if (normalizedAction === 'pause' || normalizedAction === 'resume') {
          const state = await readCollectorState();
          if (!state?.collectorId) {
            throw new Error('Collector is not enabled. Run `amaprice collector enable` first.');
          }

          const status = normalizedAction === 'pause' ? 'paused' : 'active';
          await heartbeatCollector({ collectorId: state.collectorId, status });
          await writeCollectorState({
            ...state,
            status,
            updatedAt: new Date().toISOString(),
          });

          if (opts.json) {
            console.log(JSON.stringify({ collectorId: state.collectorId, status }));
            return;
          }

          console.log(`Collector ${status}.`);
          return;
        }

        if (normalizedAction === 'run-once') {
          const report = await runCollectorOnce({ limit });
          if (opts.json) {
            console.log(JSON.stringify(report));
            return;
          }

          if (report.paused) {
            console.log('Collector is paused.');
            return;
          }

          console.log(`Processed: ${report.processed}`);
          console.log(`Success:   ${report.success}`);
          console.log(`Failed:    ${report.failed}`);
          return;
        }

        if (normalizedAction === 'start') {
          if (!opts.json) {
            console.log(`[collector] starting limit=${limit} poll_seconds=${pollSeconds}`);
          }
          await runCollectorLoop({ limit, pollSeconds });
          return;
        }

        console.error('Unknown collector action. Use: enable, disable, status, pause, resume, run-once, start.');
        process.exit(1);
      } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
      }
    });
};
