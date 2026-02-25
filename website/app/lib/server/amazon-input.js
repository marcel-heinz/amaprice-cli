export const AMAZON_DOMAINS = [
  "amazon.de",
  "amazon.com",
  "amazon.co.uk",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.nl",
  "amazon.co.jp",
  "amazon.ca",
  "amazon.com.au",
  "amazon.in",
  "amazon.com.br"
];

export const AMAZON_SHORT_DOMAINS = ["amzn.eu", "amzn.to", "a.co"];

const ASIN_REGEX = /(?:\/(?:dp|gp\/product|ASIN)\/)([A-Z0-9]{10})/i;

function safeTrim(value) {
  return String(value || "").trim();
}

export function isAmazonUrl(url) {
  try {
    const parsed = new URL(url);
    return AMAZON_DOMAINS.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname === `www.${domain}`
    );
  } catch {
    return false;
  }
}

export function isAmazonShortUrl(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    return AMAZON_SHORT_DOMAINS.includes(hostname);
  } catch {
    return false;
  }
}

export function extractAsin(urlOrAsin) {
  const value = safeTrim(urlOrAsin);
  if (!value) {
    return null;
  }

  if (/^[A-Z0-9]{10}$/i.test(value)) {
    return value.toUpperCase();
  }

  const match = value.match(ASIN_REGEX);
  return match ? match[1].toUpperCase() : null;
}

export function extractDomain(url) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    if (AMAZON_DOMAINS.includes(hostname)) {
      return hostname;
    }
    return "amazon.de";
  } catch {
    return "amazon.de";
  }
}

export function canonicalUrl(asin, domain = "amazon.de") {
  return `https://www.${domain}/dp/${asin}`;
}

export async function resolveAmazonShortUrl(url, maxRedirects = 8) {
  if (!isAmazonShortUrl(url)) {
    return url;
  }

  let current = url;
  for (let i = 0; i < maxRedirects; i += 1) {
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual"
      });
    } catch {
      return current;
    }

    const location = response.headers?.get
      ? response.headers.get("location")
      : null;

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

export async function normalizeAmazonInput(input, defaultDomain = "amazon.de") {
  const raw = safeTrim(input);
  if (!raw) {
    return null;
  }

  const asin = extractAsin(raw);
  if (asin) {
    const domain = isAmazonUrl(raw) ? extractDomain(raw) : defaultDomain;
    return {
      asin,
      domain,
      url: canonicalUrl(asin, domain)
    };
  }

  const resolved = await resolveAmazonShortUrl(raw);
  const resolvedAsin = extractAsin(resolved);
  if (!resolvedAsin) {
    return null;
  }

  const domain = isAmazonUrl(resolved) ? extractDomain(resolved) : defaultDomain;
  return {
    asin: resolvedAsin,
    domain,
    url: canonicalUrl(resolvedAsin, domain)
  };
}
