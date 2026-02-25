const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAmazonInput } = require('../src/url');

function mockResponse({
  status = 200,
  location = null,
  contentType = null,
  body = '',
} = {}) {
  const headers = new Map();
  if (location) {
    headers.set('location', location);
  }
  if (contentType) {
    headers.set('content-type', contentType);
  }

  return {
    status,
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) ?? null;
      },
    },
    body: {
      async cancel() {},
    },
    async text() {
      return body;
    },
  };
}

async function withMockedFetch(mockFetch, fn) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

test('normalizeAmazonInput accepts ASIN directly', async () => {
  const normalized = await normalizeAmazonInput('B0DZ5P7JD6');
  assert.deepEqual(normalized, {
    asin: 'B0DZ5P7JD6',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0DZ5P7JD6',
  });
});

test('normalizeAmazonInput resolves amzn short URL redirects', async () => {
  const calls = [];
  const normalized = await withMockedFetch(async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://amzn.eu/d/03CEMKdC') {
      return mockResponse({
        status: 302,
        location: 'https://www.amazon.de/dp/B0GGR4QF8C?psc=1',
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput('https://amzn.eu/d/03CEMKdC'));

  assert.deepEqual(normalized, {
    asin: 'B0GGR4QF8C',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0GGR4QF8C',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
});

test('normalizeAmazonInput returns null for unresolved short URL', async () => {
  const normalized = await withMockedFetch(
    async () => mockResponse({ status: 404 }),
    async () => normalizeAmazonInput('https://amzn.eu/d/not-a-product'),
  );

  assert.equal(normalized, null);
});

test('normalizeAmazonInput resolves Amazon handoff URL redirects', async () => {
  const handoffUrl = 'https://www.amazon.de/-/en/hz/mobile/mission/?_encoding=UTF8&p=abc123';
  const normalized = await withMockedFetch(async (url) => {
    if (url === handoffUrl) {
      return mockResponse({
        status: 302,
        location: '/gp/aw/d/B0GGR4QF8C?ref_=something',
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput(handoffUrl));

  assert.deepEqual(normalized, {
    asin: 'B0GGR4QF8C',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0GGR4QF8C',
  });
});

test('normalizeAmazonInput resolves Amazon handoff HTML canonical fallback', async () => {
  const handoffUrl = 'https://www.amazon.de/-/en/hz/mobile/mission/?_encoding=UTF8&p=abc123';
  const normalized = await withMockedFetch(async (url) => {
    if (url === handoffUrl) {
      return mockResponse({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<html><head><link rel="canonical" href="https://www.amazon.de/dp/B0DZ5P7JD6?th=1"></head></html>',
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput(handoffUrl));

  assert.deepEqual(normalized, {
    asin: 'B0DZ5P7JD6',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0DZ5P7JD6',
  });
});
