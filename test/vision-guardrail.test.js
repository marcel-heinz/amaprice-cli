const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/extractors/pipeline');

test('vision guardrail rejects low-confidence vision results', () => {
  const out = __test.evaluateVisionGuardrails({
    method: 'vision',
    price: { numeric: 99.99, currency: 'EUR' },
    confidence: 0.7,
  }, {
    baselinePrice: 100,
    enabled: true,
    minConfidence: 0.92,
    maxRelativeDelta: 0.5,
  });

  assert.equal(out.accepted, false);
  assert.match(out.reason, /low_confidence/);
});

test('vision guardrail rejects large relative deltas against baseline', () => {
  const out = __test.evaluateVisionGuardrails({
    method: 'vision',
    price: { numeric: 299.99, currency: 'EUR' },
    confidence: 0.99,
  }, {
    baselinePrice: 2300,
    enabled: true,
    minConfidence: 0.92,
    maxRelativeDelta: 0.5,
  });

  assert.equal(out.accepted, false);
  assert.match(out.reason, /relative_delta/);
});

test('vision guardrail accepts plausible high-confidence results', () => {
  const out = __test.evaluateVisionGuardrails({
    method: 'vision',
    price: { numeric: 154.9, currency: 'EUR' },
    confidence: 0.98,
  }, {
    baselinePrice: 159.97,
    enabled: true,
    minConfidence: 0.92,
    maxRelativeDelta: 0.5,
  });

  assert.equal(out.accepted, true);
  assert.equal(out.reason, null);
});

test('vision guardrail is no-op for non-vision methods', () => {
  const out = __test.evaluateVisionGuardrails({
    method: 'html_json',
    price: { numeric: 210.02, currency: 'EUR' },
    confidence: 0.96,
  }, {
    baselinePrice: 220,
    enabled: true,
    minConfidence: 0.92,
    maxRelativeDelta: 0.5,
  });

  assert.equal(out.accepted, true);
});
