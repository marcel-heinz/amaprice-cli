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

function mockResponse({
  status = 200,
  location = null,
  contentType = null,
  body = '',
  url = null
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
    url,
    headers: {
      get(name) {
        return headers.get(String(name).toLowerCase()) || null;
      }
    },
    body: {
      async cancel() {}
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
      return mockResponse({
        status: 302,
        location: 'https://www.amazon.com/dp/B0GGR4QF8C?psc=1'
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput('https://amzn.to/example'));

  assert.deepEqual(normalized, {
    asin: 'B0GGR4QF8C',
    domain: 'amazon.com',
    url: 'https://www.amazon.com/dp/B0GGR4QF8C'
  });
});

test('website normalizeAmazonInput resolves Amazon handoff URL redirects', async () => {
  const { normalizeAmazonInput } = await loadModule();
  const handoffUrl =
    'https://www.amazon.de/-/en/hz/mobile/mission/?_encoding=UTF8&p=abc123';

  const normalized = await withMockedFetch(async (url) => {
    if (url === handoffUrl) {
      return mockResponse({
        status: 302,
        location: '/gp/aw/d/B0GGR4QF8C?ref_=something'
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput(handoffUrl));

  assert.deepEqual(normalized, {
    asin: 'B0GGR4QF8C',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0GGR4QF8C'
  });
});

test('website normalizeAmazonInput resolves Amazon handoff HTML canonical fallback', async () => {
  const { normalizeAmazonInput } = await loadModule();
  const handoffUrl =
    'https://www.amazon.de/-/en/hz/mobile/mission/?_encoding=UTF8&p=abc123';

  const normalized = await withMockedFetch(async (url) => {
    if (url === handoffUrl) {
      return mockResponse({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: '<html><head><link rel=\"canonical\" href=\"https://www.amazon.de/dp/B0DZ5P7JD6?th=1\"></head></html>'
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput(handoffUrl));

  assert.deepEqual(normalized, {
    asin: 'B0DZ5P7JD6',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0DZ5P7JD6'
  });
});

test('website normalizeAmazonInput resolves Amazon handoff via followed final URL', async () => {
  const { normalizeAmazonInput } = await loadModule();
  const handoffUrl =
    'https://www.amazon.de/-/en/hz/mobile/mission/?_encoding=UTF8&p=abc123';
  const calls = [];

  const normalized = await withMockedFetch(async (url, options) => {
    calls.push({ url, options });
    if (url === handoffUrl && options?.redirect === 'follow') {
      return mockResponse({
        status: 200,
        url: 'https://www.amazon.de/gp/aw/d/B0CF14M4PJ?ref_=abc'
      });
    }
    return mockResponse();
  }, async () => normalizeAmazonInput(handoffUrl));

  assert.deepEqual(normalized, {
    asin: 'B0CF14M4PJ',
    domain: 'amazon.de',
    url: 'https://www.amazon.de/dp/B0CF14M4PJ'
  });
  assert.equal(calls[0].options.redirect, 'follow');
});
