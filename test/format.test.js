const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePrice } = require('../src/format');

test('parsePrice parses EU formatted values', () => {
  const parsed = parsePrice('329,00€', 'EUR');
  assert.equal(parsed.numeric, 329);
  assert.equal(parsed.currency, 'EUR');
});

test('parsePrice parses grouped EU values', () => {
  const parsed = parsePrice('EUR 1.299,00', 'EUR');
  assert.equal(parsed.numeric, 1299);
  assert.equal(parsed.currency, 'EUR');
});

test('parsePrice parses US formatted values', () => {
  const parsed = parsePrice('$1,299.99');
  assert.equal(parsed.numeric, 1299.99);
  assert.equal(parsed.currency, 'USD');
});
