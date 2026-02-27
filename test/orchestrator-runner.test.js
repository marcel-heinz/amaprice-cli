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

test('orchestrator pickProductTitle prefers extracted title', () => {
  const title = __test.pickProductTitle({
    asin: 'B09R9BTN9Y',
    existingTitle: 'ASIN B09R9BTN9Y',
    extractedTitle: 'Belkin USB-C Docking Station',
    pageTitle: 'Belkin USB-C Docking Station : Amazon.de',
  });

  assert.equal(title, 'Belkin USB-C Docking Station');
});

test('orchestrator pickProductTitle uses page title only for placeholder records', () => {
  const fromPlaceholder = __test.pickProductTitle({
    asin: 'B09R9BTN9Y',
    existingTitle: 'ASIN B09R9BTN9Y',
    extractedTitle: null,
    pageTitle: 'Belkin USB-C Docking Station : Amazon.de: Electronics',
  });
  const fromExisting = __test.pickProductTitle({
    asin: 'B09R9BTN9Y',
    existingTitle: 'Belkin USB-C Docking Station',
    extractedTitle: null,
    pageTitle: 'Belkin USB-C Docking Station : Amazon.de: Electronics',
  });

  assert.equal(fromPlaceholder, 'Belkin USB-C Docking Station : Amazon.de: Electronics');
  assert.equal(fromExisting, null);
});

test('orchestrator buildProductMetadataPatch updates canonical URL and title', () => {
  const patch = __test.buildProductMetadataPatch({
    job: {
      asin: 'B09R9BTN9Y',
      domain: 'amazon.de',
    },
    result: {
      title: 'Belkin USB-C Docking Station',
      pageTitle: 'Belkin USB-C Docking Station : Amazon.de',
      finalUrl: 'https://www.amazon.de/gp/product/B09R9BTN9Y?th=1',
    },
    existingProduct: {
      asin: 'B09R9BTN9Y',
      title: 'ASIN B09R9BTN9Y',
      domain: 'amazon.de',
      url: 'https://www.amazon.de/dp/B09R9BTN9Y?psc=1',
    },
  });

  assert.deepEqual(patch, {
    title: 'Belkin USB-C Docking Station',
    url: 'https://www.amazon.de/dp/B09R9BTN9Y',
  });
});

test('orchestrator buildProductMetadataPatch avoids low-signal page titles', () => {
  const patch = __test.buildProductMetadataPatch({
    job: {
      asin: 'B09R9BTN9Y',
      domain: 'amazon.de',
    },
    result: {
      title: null,
      pageTitle: 'Amazon.de: Robot Check',
      finalUrl: 'https://www.amazon.de/dp/B09R9BTN9Y',
    },
    existingProduct: {
      asin: 'B09R9BTN9Y',
      title: 'ASIN B09R9BTN9Y',
      domain: 'amazon.de',
      url: 'https://www.amazon.de/dp/B09R9BTN9Y',
    },
  });

  assert.deepEqual(patch, {});
});
