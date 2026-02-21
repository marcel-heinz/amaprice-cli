const test = require('node:test');
const assert = require('node:assert/strict');

const { __test } = require('../src/scraper');

test('price selectors avoid generic global offscreen fallback', () => {
  assert.equal(__test.PRICE_SELECTORS.includes('.a-price .a-offscreen'), false);
});

test('candidate chooser prefers buy-box main price over unrelated low price', () => {
  const best = __test.chooseBestPriceCandidate([
    {
      index: 0,
      text: '3,43€',
      top: 3265,
      visible: true,
      context: 'span.a-price > a.a-link-normal.a-text-normal > div.a-row',
    },
    {
      index: 1,
      text: '329,00€',
      top: 280,
      visible: true,
      context: 'span.a-offscreen > span.a-price.apex-pricetopay-value > div#corePrice_feature_div',
    },
  ], 'EUR');

  assert.ok(best);
  assert.equal(best.text, '329,00€');
  assert.equal(best.parsed.numeric, 329);
});

test('candidate chooser rejects non-parsable candidates', () => {
  const best = __test.chooseBestPriceCandidate([
    {
      index: 0,
      text: 'Not available',
      top: 200,
      visible: true,
      context: 'div#corePrice_feature_div',
    },
    {
      index: 1,
      text: '',
      top: 210,
      visible: true,
      context: 'div#corePrice_feature_div',
    },
  ], 'EUR');

  assert.equal(best, null);
});
