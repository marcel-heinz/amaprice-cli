const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAmazonInput } = require('../src/url');

function mockResponse(status, location = null) {
  const headers = new Map();
  if (location) {
    headers.set('location', location);
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
      return mockResponse(302, 'https://www.amazon.de/dp/B0GGR4QF8C?psc=1');
    }
    return mockResponse(200);
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
    async () => mockResponse(404),
    async () => normalizeAmazonInput('https://amzn.eu/d/not-a-product'),
  );

  assert.equal(normalized, null);
});
