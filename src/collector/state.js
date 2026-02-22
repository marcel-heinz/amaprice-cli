const fs = require('fs/promises');
const path = require('path');
const os = require('os');

function getStateDir() {
  return process.env.AMAPRICE_STATE_DIR || path.join(os.homedir(), '.amaprice');
}

function getCollectorStatePath() {
  return path.join(getStateDir(), 'collector.json');
}

async function readCollectorState() {
  const target = getCollectorStatePath();
  try {
    const raw = await fs.readFile(target, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function writeCollectorState(state) {
  const dir = getStateDir();
  await fs.mkdir(dir, { recursive: true });
  const target = getCollectorStatePath();
  await fs.writeFile(target, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return target;
}

async function clearCollectorState() {
  const target = getCollectorStatePath();
  try {
    await fs.unlink(target);
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      throw err;
    }
  }
}

module.exports = {
  getCollectorStatePath,
  readCollectorState,
  writeCollectorState,
  clearCollectorState,
};
