const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/sync-runner');

test('classifySyncError maps generic blocked challenge to captcha status', () => {
  const classified = __test.classifySyncError({
    message: 'Blocked page detected (challenge_page)',
    blockedSignal: true,
    httpStatus: 200,
  });

  assert.equal(classified.status, 'captcha');
  assert.equal(classified.blockedSignal, true);
  assert.equal(classified.httpStatus, 200);
});

test('classifySyncError keeps no_price for extraction failures', () => {
  const classified = __test.classifySyncError({
    message: 'Could not extract price from the page.',
    blockedSignal: false,
    httpStatus: 200,
  });

  assert.equal(classified.status, 'no_price');
  assert.equal(classified.blockedSignal, false);
  assert.equal(classified.httpStatus, 200);
});
