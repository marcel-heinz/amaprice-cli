const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
  readCollectorState,
  writeCollectorState,
  clearCollectorState,
  getCollectorStatePath,
} = require('../src/collector/state');

test('collector state read/write/clear lifecycle', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amaprice-state-'));
  const prevDir = process.env.AMAPRICE_STATE_DIR;
  process.env.AMAPRICE_STATE_DIR = tmpDir;

  await clearCollectorState();
  assert.equal(await readCollectorState(), null);

  const state = {
    collectorId: '1234',
    userId: 'user-1',
    status: 'active',
  };
  const target = await writeCollectorState(state);
  assert.equal(target, getCollectorStatePath());

  const roundTrip = await readCollectorState();
  assert.equal(roundTrip.collectorId, '1234');
  assert.equal(roundTrip.status, 'active');

  await clearCollectorState();
  assert.equal(await readCollectorState(), null);

  if (prevDir === undefined) delete process.env.AMAPRICE_STATE_DIR;
  else process.env.AMAPRICE_STATE_DIR = prevDir;
});
