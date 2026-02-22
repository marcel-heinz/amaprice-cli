const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/extractors/vision');

test('vision normalizer parses valid price payload', () => {
  const input = JSON.stringify({
    price: 159.97,
    currency: 'EUR',
    confidence: 0.91,
    is_blocked: false,
    reason: 'visible',
    raw_text: '159,97€',
  });

  const out = __test.normalizeVisionResult(input, 'EUR');
  assert.ok(out);
  assert.equal(out.status, 'ok');
  assert.equal(out.price.numeric, 159.97);
  assert.equal(out.price.currency, 'EUR');
});

test('vision normalizer flags blocked payload', () => {
  const input = JSON.stringify({
    price: null,
    currency: null,
    confidence: 0.2,
    is_blocked: true,
    reason: 'captcha page',
    raw_text: 'enter the characters',
  });

  const out = __test.normalizeVisionResult(input, 'EUR');
  assert.ok(out);
  assert.equal(out.status, 'blocked');
  assert.equal(out.blockedSignal, true);
  assert.equal(out.blockedReason, 'captcha page');
});

test('vision confidence coercion clamps values', () => {
  assert.equal(__test.toConfidence(2), 1);
  assert.equal(__test.toConfidence(-1), 0);
  assert.equal(__test.toConfidence('0.5'), 0.5);
});
