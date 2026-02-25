const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repoRoot = path.resolve(__dirname, '..');
const modulePath = path.join(
  repoRoot,
  'website',
  'app',
  'lib',
  'server',
  'amazon-input.js'
);

async function loadModule() {
  return import(pathToFileURL(modulePath).href);
}

function mockResponse(status, location = null) {
  const headers = new Map();
  if (location) {
    headers.set('location', location);
  }

  return {
    status,
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) || null;
      }
    },
    body: {
      async cancel() {}
    }
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

test('website normalizeAmazonInput accepts ASIN directly', async () => {
  const { normalizeAmazonInput } = await loadModule();
  const normalized = await normalizeAmazonInput('B0DZ5P7JD6');

  assert.deepEqual(normalized, {
    asin: 'B0DZ5P7JD6',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0DZ5P7JD6'
  });
});

test('website normalizeAmazonInput resolves short URLs', async () => {
  const { normalizeAmazonInput } = await loadModule();

  const normalized = await withMockedFetch(async (url) => {
    if (url === 'https://amzn.to/example') {
      return mockResponse(302, 'https://www.amazon.com/dp/B0GGR4QF8C?psc=1');
    }
    return mockResponse(200);
  }, async () => normalizeAmazonInput('https://amzn.to/example'));

  assert.deepEqual(normalized, {
    asin: 'B0GGR4QF8C',
    domain: 'amazon.com',
    url: 'https://www.amazon.com/dp/B0GGR4QF8C'
  });
});
