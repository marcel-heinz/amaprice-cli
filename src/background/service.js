const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const { getUserId } = require('../user-context');
const { readCollectorState, writeCollectorState, getStateDir } = require('../collector/state');
const { upsertCollector, heartbeatCollector, getCollectorById } = require('../db');

const execFileAsync = promisify(execFile);

const DEFAULT_COLLECTOR_LIMIT = 10;
const DEFAULT_POLL_SECONDS = 180;
const MIN_POLL_SECONDS = 30;
const MAX_POLL_SECONDS = 3600;

function sanitizeLabelPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'user';
}

function resolveCollectorLimit(value = null) {
  const parsed = Number(value ?? process.env.COLLECTOR_LIMIT);
  if (!Number.isFinite(parsed)) return DEFAULT_COLLECTOR_LIMIT;
  return Math.min(100, Math.max(1, Math.round(parsed)));
}

function resolvePollSeconds(value = null) {
  const parsed = Number(value ?? process.env.COLLECTOR_POLL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_SECONDS;
  return Math.min(MAX_POLL_SECONDS, Math.max(MIN_POLL_SECONDS, Math.round(parsed)));
}

function getDefaultCollectorName() {
  return `${os.hostname()}-collector`;
}

function getDaemonEntryPath() {
  return path.join(__dirname, '../collector/daemon-entry.js');
}

function getLaunchdLabel(userId) {
  return `sh.amaprice.collector.${sanitizeLabelPart(userId)}`;
}

function getLaunchdPlistPath(label) {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

function getDaemonLogPath() {
  return path.join(getStateDir(), 'collector-daemon.log');
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function renderLaunchdPlist({
  label,
  programArguments,
  stdoutPath,
  stderrPath,
  environment = {},
}) {
  const argsXml = (programArguments || [])
    .map((arg) => `      <string>${xmlEscape(arg)}</string>`)
    .join('\n');

  const envRows = Object.entries(environment || {})
    .filter(([, value]) => value != null && String(value).trim() !== '')
    .map(([key, value]) => (
      `      <key>${xmlEscape(key)}</key>\n      <string>${xmlEscape(value)}</string>`
    ))
    .join('\n');

  const envXml = envRows
    ? `\n    <key>EnvironmentVariables</key>\n    <dict>\n${envRows}\n    </dict>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${xmlEscape(label)}</string>
    <key>ProgramArguments</key>
    <array>
${argsXml}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${xmlEscape(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${xmlEscape(stderrPath)}</string>${envXml}
  </dict>
</plist>
`;
}

function isLaunchdSupported(platform = process.platform) {
  return platform === 'darwin';
}

function getLaunchdDomain() {
  if (typeof process.getuid !== 'function') {
    throw new Error('launchd requires a POSIX uid');
  }
  return `gui/${process.getuid()}`;
}

function buildServiceTarget(label) {
  return `${getLaunchdDomain()}/${label}`;
}

async function runLaunchctl(args, { allowFailure = false } = {}) {
  try {
    const out = await execFileAsync('launchctl', args);
    return {
      ok: true,
      stdout: String(out.stdout || ''),
      stderr: String(out.stderr || ''),
    };
  } catch (err) {
    if (allowFailure) {
      return {
        ok: false,
        stdout: String(err.stdout || ''),
        stderr: String(err.stderr || ''),
        error: err,
      };
    }
    const stderr = String(err.stderr || err.message || '').trim();
    throw new Error(`launchctl ${args.join(' ')} failed: ${stderr || 'unknown error'}`);
  }
}

function isAlreadyLoadedError(result) {
  const text = `${result?.stderr || ''}\n${result?.stdout || ''}`.toLowerCase();
  return text.includes('already loaded') || text.includes('service already loaded');
}

function pickDaemonEnvironment(userId) {
  const passthrough = [
    'SUPABASE_URL',
    'SUPABASE_KEY',
    'SUPABASE_ANON_KEY',
    'ORCHESTRATOR_ENABLED',
    'VISION_FALLBACK_ENABLED',
    'OPENROUTER_API_KEY',
    'VISION_MODEL',
    'VISION_PROVIDER',
    'OPENROUTER_HTTP_REFERER',
    'OPENROUTER_TITLE',
    'VISION_GUARDRAIL_ENABLED',
    'VISION_GUARDRAIL_MIN_CONFIDENCE',
    'VISION_GUARDRAIL_MAX_REL_DELTA',
    'PATH',
  ];

  const env = {
    AMAPRICE_USER_ID: userId,
  };
  for (const key of passthrough) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function ensureCollectorEnabled({
  userId = getUserId(),
  collectorName = null,
  status = 'active',
  capabilities = null,
} = {}) {
  const existing = await readCollectorState();
  const collector = await upsertCollector({
    collectorId: existing?.collectorId || null,
    userId,
    name: collectorName || existing?.name || getDefaultCollectorName(),
    kind: 'cli',
    status,
    capabilities: capabilities || existing?.capabilities || {
      html_json: true,
      vision: true,
      railway_dom: true,
    },
    metadata: {
      platform: process.platform,
      node: process.version,
    },
  });

  const state = {
    collectorId: collector.id,
    userId,
    name: collector.name,
    status,
    capabilities: collector.capabilities,
    enabledAt: existing?.enabledAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    background: {
      ...(existing?.background || {}),
    },
  };
  const statePath = await writeCollectorState(state);
  return { collector, state, statePath };
}

async function getLaunchdServiceStatus({ label }) {
  const plistPath = getLaunchdPlistPath(label);
  let installed = true;
  try {
    await fs.access(plistPath);
  } catch {
    installed = false;
  }

  if (!installed) {
    return {
      backend: 'launchd',
      label,
      plistPath,
      installed: false,
      loaded: false,
      running: false,
    };
  }

  const print = await runLaunchctl(['print', buildServiceTarget(label)], { allowFailure: true });
  const output = `${print.stdout}\n${print.stderr}`;
  const loaded = print.ok;
  const running = loaded && (/state = running/i.test(output) || /pid = \d+/i.test(output));

  return {
    backend: 'launchd',
    label,
    plistPath,
    installed: true,
    loaded,
    running,
  };
}

async function enableLaunchdService({
  label,
  pollSeconds,
  limit,
  userId,
}) {
  const plistPath = getLaunchdPlistPath(label);
  const logPath = getDaemonLogPath();
  const daemonEntry = getDaemonEntryPath();

  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const plist = renderLaunchdPlist({
    label,
    programArguments: [
      process.execPath,
      daemonEntry,
      '--limit',
      String(limit),
      '--poll-seconds',
      String(pollSeconds),
    ],
    stdoutPath: logPath,
    stderrPath: logPath,
    environment: pickDaemonEnvironment(userId),
  });
  await fs.writeFile(plistPath, plist, 'utf8');

  const bootstrap = await runLaunchctl(['bootstrap', getLaunchdDomain(), plistPath], { allowFailure: true });
  if (!bootstrap.ok && !isAlreadyLoadedError(bootstrap)) {
    throw new Error(`Could not bootstrap launchd service: ${bootstrap.stderr || bootstrap.stdout || 'unknown error'}`);
  }

  await runLaunchctl(['enable', buildServiceTarget(label)], { allowFailure: true });
  const kick = await runLaunchctl(['kickstart', '-k', buildServiceTarget(label)], { allowFailure: true });
  if (!kick.ok) {
    await runLaunchctl(['start', label], { allowFailure: true });
  }

  return getLaunchdServiceStatus({ label });
}

async function disableLaunchdService({ label }) {
  const plistPath = getLaunchdPlistPath(label);
  await runLaunchctl(['bootout', buildServiceTarget(label)], { allowFailure: true });
  await runLaunchctl(['disable', buildServiceTarget(label)], { allowFailure: true });
  try {
    await fs.unlink(plistPath);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      throw err;
    }
  }

  return getLaunchdServiceStatus({ label });
}

async function ensureBackgroundOn({
  userId = getUserId(),
  collectorName = null,
  pollSeconds = null,
  limit = null,
} = {}) {
  if (!isLaunchdSupported()) {
    return {
      supported: false,
      running: false,
      reason: `unsupported_platform:${process.platform}`,
    };
  }

  const safePollSeconds = resolvePollSeconds(pollSeconds);
  const safeLimit = resolveCollectorLimit(limit);
  const label = getLaunchdLabel(userId);
  const { collector, statePath } = await ensureCollectorEnabled({
    userId,
    collectorName,
    status: 'active',
  });

  const service = await enableLaunchdService({
    label,
    pollSeconds: safePollSeconds,
    limit: safeLimit,
    userId,
  });

  await heartbeatCollector({
    collectorId: collector.id,
    status: 'active',
  }).catch(() => {});

  const local = await readCollectorState();
  await writeCollectorState({
    ...(local || {}),
    collectorId: collector.id,
    userId,
    name: collector.name,
    status: 'active',
    background: {
      enabled: true,
      backend: 'launchd',
      label,
      pollSeconds: safePollSeconds,
      limit: safeLimit,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: new Date().toISOString(),
  });

  return {
    supported: true,
    running: service.running,
    service,
    statePath,
    collectorId: collector.id,
    pollSeconds: safePollSeconds,
    limit: safeLimit,
  };
}

async function ensureBackgroundOff({
  userId = getUserId(),
} = {}) {
  const state = await readCollectorState();
  const label = state?.background?.label || getLaunchdLabel(userId);

  let service = {
    backend: 'launchd',
    label,
    installed: false,
    loaded: false,
    running: false,
  };

  if (isLaunchdSupported()) {
    service = await disableLaunchdService({ label });
  }

  if (state?.collectorId) {
    await heartbeatCollector({
      collectorId: state.collectorId,
      status: 'paused',
    }).catch(() => {});
  }

  if (state) {
    await writeCollectorState({
      ...state,
      status: 'paused',
      background: {
        ...(state.background || {}),
        enabled: false,
        backend: 'launchd',
        label,
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    supported: isLaunchdSupported(),
    running: false,
    service,
  };
}

async function getBackgroundStatus({
  userId = getUserId(),
} = {}) {
  const state = await readCollectorState();
  const remote = state?.collectorId
    ? await getCollectorById(state.collectorId).catch(() => null)
    : null;
  const label = state?.background?.label || getLaunchdLabel(userId);

  const service = isLaunchdSupported()
    ? await getLaunchdServiceStatus({ label })
    : {
      backend: null,
      label,
      installed: false,
      loaded: false,
      running: false,
    };

  return {
    supported: isLaunchdSupported(),
    userId,
    local: state,
    remote,
    service,
  };
}

function isAutoBackgroundEnabled() {
  return process.env.AMAPRICE_AUTO_BACKGROUND !== '0';
}

async function maybeEnsureBackgroundOn({
  userId = getUserId(),
} = {}) {
  if (!isAutoBackgroundEnabled()) {
    return {
      attempted: false,
      running: false,
      reason: 'disabled_by_env',
    };
  }

  try {
    const report = await ensureBackgroundOn({ userId });
    return {
      attempted: true,
      ...report,
    };
  } catch (err) {
    return {
      attempted: true,
      running: false,
      error: err.message,
    };
  }
}

module.exports = {
  DEFAULT_COLLECTOR_LIMIT,
  DEFAULT_POLL_SECONDS,
  MIN_POLL_SECONDS,
  MAX_POLL_SECONDS,
  ensureBackgroundOn,
  ensureBackgroundOff,
  getBackgroundStatus,
  maybeEnsureBackgroundOn,
  resolveCollectorLimit,
  resolvePollSeconds,
};

module.exports.__test = {
  sanitizeLabelPart,
  resolveCollectorLimit,
  resolvePollSeconds,
  getLaunchdLabel,
  getLaunchdPlistPath,
  renderLaunchdPlist,
  isLaunchdSupported,
};
