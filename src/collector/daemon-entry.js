#!/usr/bin/env node

const { runCollectorLoop } = require('./client');

function parseArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  const value = Number(process.argv[idx + 1]);
  if (!Number.isFinite(value)) return fallback;
  return value;
}

async function main() {
  const limit = Math.max(1, Math.round(parseArg('--limit', Number(process.env.COLLECTOR_LIMIT) || 10)));
  const pollSeconds = Math.max(30, Math.round(parseArg('--poll-seconds', Number(process.env.COLLECTOR_POLL_SECONDS) || 180)));
  await runCollectorLoop({ limit, pollSeconds });
}

main().catch((err) => {
  console.error(`[collector-daemon] fatal=${err.message}`);
  process.exit(1);
});
