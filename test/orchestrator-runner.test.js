const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/orchestrator/runner');

test('orchestrator classifyFailure maps blocked captcha signal', () => {
  const classified = __test.classifyFailure({
    blockedSignal: true,
    blockedReason: 'captcha',
    httpStatus: 200,
  });

  assert.equal(classified.status, 'captcha');
  assert.equal(classified.blockedSignal, true);
});

test('orchestrator classifyFailure maps extraction miss to no_price', () => {
  const classified = __test.classifyFailure({
    message: 'Could not extract price from the page.',
    httpStatus: 200,
  });

  assert.equal(classified.status, 'no_price');
  assert.equal(classified.httpStatus, 200);
});

test('orchestrator nextJobStateAfterFailure honors max attempts', () => {
  assert.equal(__test.nextJobStateAfterFailure({ attempt_count: 1, max_attempts: 3 }), 'queued');
  assert.equal(__test.nextJobStateAfterFailure({ attempt_count: 3, max_attempts: 3 }), 'dead');
});

test('orchestrator no-price message contains diagnostics', () => {
  const message = __test.buildNoPriceErrorMessage({
    httpStatus: 200,
    finalUrl: 'https://www.amazon.de/dp/B0G1BV5JQP?th=1',
    pageTitle: 'Example Product',
  });

  assert.match(message, /http=200/);
  assert.match(message, /final_url=/);
  assert.match(message, /title=Example Product/);
});
