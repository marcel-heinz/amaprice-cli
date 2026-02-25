const AMAZON_DOMAINS = [
  'amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr',
  'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.co.jp',
  'amazon.ca', 'amazon.com.au', 'amazon.in', 'amazon.com.br',
];
const AMAZON_SHORT_DOMAINS = ['amzn.eu', 'amzn.to', 'a.co'];

const ASIN_PATH_REGEX = /(?:\/(?:dp|gp\/product|gp\/aw\/d|ASIN)\/)([A-Z0-9]{10})(?=[/?]|$)/i;
const DIRECT_ASIN_REGEX = /^[A-Z0-9]{10}$/i;
const QUERY_ASIN_KEYS = new Set(['asin', 'pd_rd_i']);
const QUERY_NESTED_URL_KEYS = new Set(['url', 'u', 'redirecturl', 'path']);
const HTML_ASIN_PATTERNS = [
  /<link[^>]+rel=["']canonical["'][^>]+href=["'][^"']*(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?=[/?"'&]|$)/i,
  /<link[^>]+href=["'][^"']*(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?=[/?"'&]|$)[^>]*rel=["']canonical["']/i,
  /"(?:currentAsin|parentAsin|landingAsin)"\s*:\s*"([A-Z0-9]{10})"/i,
  /"(?:canonicalUrl|productUrl|dpUrl|redirectUrl)"\s*:\s*"[^"]*(?:\/dp\/|\/gp\/product\/|\/gp\/aw\/d\/)([A-Z0-9]{10})(?=[/?"&]|$)/i,
];

function safeTrim(value) {
  return String(value || '').trim();
}

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
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return AMAZON_SHORT_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

function extractAsinFromPathLikeValue(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) {
    return null;
  }

  if (DIRECT_ASIN_REGEX.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const match = trimmed.match(ASIN_PATH_REGEX);
  return match ? match[1].toUpperCase() : null;
}

function extractAsinFromQueryParams(parsed) {
  for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
    const key = safeTrim(rawKey).toLowerCase();
    const value = safeTrim(rawValue);
    if (!key || !value) {
      continue;
    }

    if (QUERY_ASIN_KEYS.has(key) && DIRECT_ASIN_REGEX.test(value)) {
      return value.toUpperCase();
    }

    if (!QUERY_NESTED_URL_KEYS.has(key)) {
      continue;
    }

    const nestedDirect = extractAsinFromPathLikeValue(value);
    if (nestedDirect) {
      return nestedDirect;
    }

    try {
      const decoded = decodeURIComponent(value);
      const nestedDecoded = extractAsinFromPathLikeValue(decoded);
      if (nestedDecoded) {
        return nestedDecoded;
      }
    } catch {
      // Ignore decode failures for non-encoded payloads.
    }
  }

  return null;
}

function extractAsinFromHtml(html) {
  const body = safeTrim(html);
  if (!body) {
    return null;
  }

  for (const pattern of HTML_ASIN_PATTERNS) {
    const match = body.match(pattern);
    if (match?.[1]) {
      return match[1].toUpperCase();
    }
  }

  return null;
}

function extractAsin(urlOrAsin) {
  const value = safeTrim(urlOrAsin);
  if (!value) {
    return null;
  }

  const direct = extractAsinFromPathLikeValue(value);
  if (direct) {
    return direct;
  }

  try {
    const parsed = new URL(value);
    return extractAsinFromQueryParams(parsed);
  } catch {
    return null;
  }
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

function isResolvableAmazonUrl(url) {
  return isAmazonShortUrl(url) || isAmazonUrl(url);
}

async function extractAsinFromResponse(response) {
  const contentType = response.headers?.get
    ? String(response.headers.get('content-type') || '').toLowerCase()
    : '';
  if (contentType && !contentType.includes('text/html')) {
    return null;
  }

  if (typeof response.text !== 'function') {
    return null;
  }

  try {
    const html = await response.text();
    return extractAsinFromHtml(String(html || '').slice(0, 512_000));
  } catch {
    return null;
  }
}

async function resolveAmazonShortUrl(url, maxRedirects = 8) {
  if (!isResolvableAmazonUrl(url)) {
    return url;
  }

  let current = url;
  const visited = new Set();
  for (let i = 0; i < maxRedirects; i += 1) {
    if (visited.has(current)) {
      return current;
    }
    visited.add(current);

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
    if (!location || response.status < 300 || response.status > 399) {
      const htmlAsin = await extractAsinFromResponse(response);
      if (htmlAsin) {
        const domain = isAmazonUrl(current) ? extractDomain(current) : 'amazon.de';
        return canonicalUrl(htmlAsin, domain);
      }
      return current;
    }

    try {
      await response.body?.cancel?.();
    } catch {
      // Ignore body cancellation failures.
    }

    try {
      current = new URL(location, current).toString();
    } catch {
      return current;
    }

    if (extractAsin(current)) {
      return current;
    }

    if (!isResolvableAmazonUrl(current)) {
      return current;
    }
  }

  return current;
}

async function normalizeAmazonInput(input, defaultDomain = 'amazon.de') {
  const raw = safeTrim(input);
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
