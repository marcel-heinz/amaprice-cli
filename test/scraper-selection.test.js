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

test('blocked detector catches localized challenge pages', () => {
  const detected = __test.detectBlockedPage({
    httpStatus: 200,
    pageTitle: 'Sicherheitsuberprufung',
    bodyText: 'Automatisierte Zugriffe auf Amazon sind eingeschrankt. Geben Sie die Zeichen ein.',
    finalUrl: 'https://www.amazon.de/errors/validateCaptcha',
    hasProductTitle: false,
    productIndicatorCount: 0,
    challengeIndicatorCount: 1,
  });

  assert.equal(detected.blockedSignal, true);
  assert.equal(detected.blockedReason, 'challenge_page');
});

test('blocked detector does not flag normal product pages', () => {
  const detected = __test.detectBlockedPage({
    httpStatus: 200,
    pageTitle: 'Product page title',
    bodyText: 'Normal product body with shipping details.',
    finalUrl: 'https://www.amazon.de/dp/B0DZ5P7JD6',
    hasProductTitle: true,
    productIndicatorCount: 3,
    challengeIndicatorCount: 0,
  });

  assert.equal(detected.blockedSignal, false);
  assert.equal(detected.blockedReason, null);
});

test('retry helper retries only transient no-price result once', () => {
  assert.equal(
    __test.shouldRetryNoPrice({ price: null, blockedSignal: false }, 1, 2),
    true,
  );
  assert.equal(
    __test.shouldRetryNoPrice({ price: null, blockedSignal: false }, 2, 2),
    false,
  );
  assert.equal(
    __test.shouldRetryNoPrice({ price: null, blockedSignal: true }, 1, 2),
    false,
  );
  assert.equal(
    __test.shouldRetryNoPrice({ price: { numeric: 329 }, blockedSignal: false }, 1, 2),
    false,
  );
});

test('twister fallback parser extracts display price payload', () => {
  const payload = JSON.stringify({
    desktop_buybox_group_1: [{
      displayPrice: '79,99&nbsp;EUR',
      priceAmount: 79.99,
      currencySymbol: 'EUR',
    }],
  });

  const parsed = __test.parseTwisterPriceData(payload, 'EUR');
  assert.ok(parsed);
  assert.equal(parsed.text, '79,99 EUR');
  assert.equal(parsed.parsed.numeric, 79.99);
  assert.equal(parsed.parsed.currency, 'EUR');
});

test('twister fallback parser uses numeric amount when display text missing', () => {
  const payload = JSON.stringify({
    desktop_buybox_group_1: [{
      priceAmount: 159.97,
      currencySymbol: 'EUR',
    }],
  });

  const parsed = __test.parseTwisterPriceData(payload, 'EUR');
  assert.ok(parsed);
  assert.equal(parsed.parsed.numeric, 159.97);
  assert.equal(parsed.parsed.currency, 'EUR');
});
