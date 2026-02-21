const AMAZON_DOMAINS = [
  'amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr',
  'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.co.jp',
  'amazon.ca', 'amazon.com.au', 'amazon.in', 'amazon.com.br',
];
const AMAZON_SHORT_DOMAINS = ['amzn.eu', 'amzn.to', 'a.co'];

const ASIN_REGEX = /(?:\/(?:dp|gp\/product|ASIN)\/)([A-Z0-9]{10})/i;

function isAmazonUrl(url) {
  try {
    const parsed = new URL(url);
    return AMAZON_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname === `www.${d}`);
  } catch {
    return false;
  }
}

function isAmazonShortUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return AMAZON_SHORT_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

function extractAsin(urlOrAsin) {
  // If it's already a bare ASIN (10 alphanumeric chars)
  if (/^[A-Z0-9]{10}$/i.test(urlOrAsin)) {
    return urlOrAsin.toUpperCase();
  }
  const match = urlOrAsin.match(ASIN_REGEX);
  return match ? match[1].toUpperCase() : null;
}

function extractDomain(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return 'amazon.de';
  }
}

function canonicalUrl(asin, domain = 'amazon.de') {
  return `https://www.${domain}/dp/${asin}`;
}

async function resolveAmazonShortUrl(url, maxRedirects = 8) {
  if (!isAmazonShortUrl(url)) return url;

  let current = url;
  for (let i = 0; i < maxRedirects; i += 1) {
    let response;
    try {
      response = await fetch(current, {
        method: 'GET',
        redirect: 'manual',
      });
    } catch {
      return current;
    }

    const location = response.headers?.get ? response.headers.get('location') : null;
    try {
      await response.body?.cancel?.();
    } catch {
      // Ignore body cancellation failures.
    }

    if (!location || response.status < 300 || response.status > 399) {
      return current;
    }

    try {
      current = new URL(location, current).toString();
    } catch {
      return current;
    }

    if (isAmazonUrl(current) && extractAsin(current)) {
      return current;
    }
  }

  return current;
}

async function normalizeAmazonInput(input, defaultDomain = 'amazon.de') {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const asin = extractAsin(raw);
  if (asin) {
    const domain = isAmazonUrl(raw) ? extractDomain(raw) : defaultDomain;
    return {
      asin,
      domain,
      url: canonicalUrl(asin, domain),
    };
  }

  const resolved = await resolveAmazonShortUrl(raw);
  const resolvedAsin = extractAsin(resolved);
  if (resolvedAsin) {
    const domain = isAmazonUrl(resolved) ? extractDomain(resolved) : defaultDomain;
    return {
      asin: resolvedAsin,
      domain,
      url: canonicalUrl(resolvedAsin, domain),
    };
  }

  return null;
}

module.exports = {
  isAmazonUrl,
  isAmazonShortUrl,
  extractAsin,
  extractDomain,
  canonicalUrl,
  resolveAmazonShortUrl,
  normalizeAmazonInput,
  AMAZON_DOMAINS,
  AMAZON_SHORT_DOMAINS,
};
