const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(
  repoRoot,
  'website',
  'app',
  'lib',
  'server',
  'track-requests.js'
);

async function loadModule() {
  return import(pathToFileURL(modulePath).href);
}

test('sanitizeTrackSource normalizes noisy input', async () => {
  const { sanitizeTrackSource } = await loadModule();
  assert.equal(sanitizeTrackSource('  Home Page / CTA  '), 'home-page-cta');
  assert.equal(sanitizeTrackSource(''), 'website');
});

test('shouldPersistTrackStatus only allows forward transitions', async () => {
  const { shouldPersistTrackStatus } = await loadModule();

  assert.equal(shouldPersistTrackStatus('queued', 'collecting'), true);
  assert.equal(shouldPersistTrackStatus('collecting', 'live'), true);
  assert.equal(shouldPersistTrackStatus('live', 'queued'), false);
  assert.equal(shouldPersistTrackStatus('failed', 'collecting'), false);
});

test('buildTrackStatusPatch sets lifecycle timestamps', async () => {
  const { buildTrackStatusPatch } = await loadModule();
  const queuedPatch = buildTrackStatusPatch({ status: 'queued' }, 'collecting', null);
  assert.equal(queuedPatch.status, 'collecting');
  assert.ok(queuedPatch.first_claimed_at, 'expected first_claimed_at timestamp');

  const livePatch = buildTrackStatusPatch(
    {
      status: 'collecting',
      first_claimed_at: '2026-02-25T00:00:00.000Z'
    },
    'live',
    null
  );
  assert.equal(livePatch.status, 'live');
  assert.ok(livePatch.first_live_at, 'expected first_live_at timestamp');
  assert.ok(livePatch.completed_at, 'expected completed_at timestamp');
});
