const { runDueSync } = require('./sync-runner');

const intervalMinutes = Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES) || 5);
const limit = Math.max(1, Number(process.env.SYNC_LIMIT) || 20);
const runOnce = process.env.SYNC_RUN_ONCE === '1';

let stopping = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnceWithLogs() {
  const started = new Date();
  try {
    const report = await runDueSync({ limit });
    const tookMs = Date.now() - started.getTime();
    console.log(`[worker] processed=${report.processed} success=${report.success} failed=${report.failed} took_ms=${tookMs}`);
  } catch (err) {
    console.error(`[worker] error=${err.message}`);
  }
}

async function main() {
  console.log(`[worker] starting interval=${intervalMinutes}m limit=${limit} run_once=${runOnce ? 'yes' : 'no'}`);

  if (runOnce) {
    await runOnceWithLogs();
    return;
  }

  while (!stopping) {
    const started = Date.now();
    await runOnceWithLogs();
    const elapsed = Date.now() - started;
    const waitMs = Math.max(0, intervalMinutes * 60 * 1000 - elapsed);
    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

main().catch((err) => {
  console.error(`[worker] fatal=${err.message}`);
  process.exit(1);
});

