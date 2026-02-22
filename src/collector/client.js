const { runOrchestratedSync } = require('../orchestrator/runner');
const { readCollectorState } = require('./state');
const { heartbeatCollector } = require('../db');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureCollectorState() {
  const state = await readCollectorState();
  if (!state || !state.collectorId) {
    throw new Error('Collector is not enabled. Run `amaprice collector enable` first.');
  }
  return state;
}

async function runCollectorOnce({ limit = 5 } = {}) {
  const state = await ensureCollectorState();
  await heartbeatCollector({
    collectorId: state.collectorId,
    status: state.status === 'paused' ? 'paused' : 'active',
    capabilities: state.capabilities || { html_json: true, vision: true },
  }).catch(() => {});

  if (state.status === 'paused') {
    return {
      processed: 0,
      success: 0,
      failed: 0,
      items: [],
      paused: true,
    };
  }

  return runOrchestratedSync({
    limit,
    collectorId: state.collectorId,
    executor: 'collector',
    routeHint: 'collector_first',
    allowVision: true,
    allowRailwayDomFallback: true,
  });
}

async function runCollectorLoop({ limit = 5, pollSeconds = 20 } = {}) {
  const safePollMs = Math.max(5, Number(pollSeconds) || 20) * 1000;

  while (true) {
    const started = Date.now();
    const report = await runCollectorOnce({ limit });
    const elapsed = Date.now() - started;
    const waitMs = Math.max(0, safePollMs - elapsed);

    if (report.paused) {
      await sleep(safePollMs);
      continue;
    }

    if (waitMs > 0) {
      await sleep(waitMs);
    }
  }
}

module.exports = {
  runCollectorOnce,
  runCollectorLoop,
};
