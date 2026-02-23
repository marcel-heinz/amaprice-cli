const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/background/service');

test('background poll default is 180 seconds', () => {
  assert.equal(__test.resolvePollSeconds(null), 180);
});

test('background poll seconds are clamped to safe range', () => {
  assert.equal(__test.resolvePollSeconds(5), 30);
  assert.equal(__test.resolvePollSeconds(99999), 3600);
  assert.equal(__test.resolvePollSeconds(240), 240);
});

test('background launchd label sanitizes user id', () => {
  const label = __test.getLaunchdLabel('User Name@Example');
  assert.equal(label, 'sh.amaprice.collector.user-name-example');
});

test('background launchd plist renderer includes core fields', () => {
  const xml = __test.renderLaunchdPlist({
    label: 'sh.amaprice.collector.user',
    programArguments: ['/usr/local/bin/node', '/app/daemon.js', '--poll-seconds', '180'],
    stdoutPath: '/tmp/out.log',
    stderrPath: '/tmp/err.log',
    environment: { AMAPRICE_USER_ID: 'user-1' },
  });

  assert.match(xml, /<key>Label<\/key>/);
  assert.match(xml, /sh\.amaprice\.collector\.user/);
  assert.match(xml, /--poll-seconds/);
  assert.match(xml, /AMAPRICE_USER_ID/);
});
