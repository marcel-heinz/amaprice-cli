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
const FETCH_TIMEOUT_MS = 9000;
const BROWSERISH_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

const DOMAIN_ACCEPT_LANGUAGE = {
  'amazon.de': 'de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.fr': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.it': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.es': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.nl': 'nl-NL,nl;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.co.jp': 'ja-JP,ja;q=0.9,en-US;q=0.7,en;q=0.6',
  'amazon.com.br': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'amazon.co.uk': 'en-GB,en;q=0.9',
  'amazon.com': 'en-US,en;q=0.9',
  'amazon.ca': 'en-CA,en;q=0.9,fr-CA;q=0.6',
  'amazon.com.au': 'en-AU,en;q=0.9',
  'amazon.in': 'en-IN,en;q=0.9',
};

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

function defaultDomainForUrl(url) {
  return isAmazonUrl(url) ? extractDomain(url) : 'amazon.de';
}

function buildResolveHeaders(url) {
  const domain = defaultDomainForUrl(url);
  return {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': DOMAIN_ACCEPT_LANGUAGE[domain] || 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': BROWSERISH_USER_AGENT,
  };
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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

function resolveAsinFromAmazonUrl(url, fallbackDomain = 'amazon.de') {
  const asin = extractAsin(url);
  if (!asin || !isAmazonUrl(url)) {
    return null;
  }

  const domain = extractDomain(url) || fallbackDomain;
  return canonicalUrl(asin, domain);
}

async function resolveByFollowingRedirects(url) {
  const originDomain = defaultDomainForUrl(url);
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    redirect: 'follow',
    headers: buildResolveHeaders(url),
  });
  if (!response) {
    return null;
  }

  const responseUrl = safeTrim(response.url);
  const fromUrl = resolveAsinFromAmazonUrl(responseUrl, originDomain);
  if (fromUrl) {
    try {
      await response.body?.cancel?.();
    } catch {
      // Ignore body cancellation failures.
    }
    return fromUrl;
  }

  const htmlAsin = await extractAsinFromResponse(response);
  if (!htmlAsin) {
    return null;
  }

  const domain = isAmazonUrl(responseUrl)
    ? extractDomain(responseUrl)
    : originDomain;
  return canonicalUrl(htmlAsin, domain);
}

async function resolveAmazonShortUrl(url, maxRedirects = 8) {
  if (!isResolvableAmazonUrl(url)) {
    return url;
  }

  const followed = await resolveByFollowingRedirects(url);
  if (followed) {
    return followed;
  }

  let current = url;
  const originDomain = defaultDomainForUrl(url);
  const visited = new Set();
  for (let i = 0; i < maxRedirects; i += 1) {
    if (visited.has(current)) {
      return current;
    }
    visited.add(current);

    const response = await fetchWithTimeout(current, {
      method: 'GET',
      redirect: 'manual',
      headers: buildResolveHeaders(current),
    });
    if (!response) {
      return current;
    }

    const fromResponseUrl = resolveAsinFromAmazonUrl(
      safeTrim(response.url),
      originDomain,
    );
    if (fromResponseUrl) {
      try {
        await response.body?.cancel?.();
      } catch {
        // Ignore body cancellation failures.
      }
      return fromResponseUrl;
    }

    const location = response.headers?.get ? response.headers.get('location') : null;
    if (!location || response.status < 300 || response.status > 399) {
      const htmlAsin = await extractAsinFromResponse(response);
      if (htmlAsin) {
        const domain = isAmazonUrl(current) ? extractDomain(current) : originDomain;
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

    const fromLocation = resolveAsinFromAmazonUrl(current, originDomain);
    if (fromLocation) {
      return fromLocation;
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
