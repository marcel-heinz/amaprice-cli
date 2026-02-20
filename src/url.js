const AMAZON_DOMAINS = [
  'amazon.de', 'amazon.com', 'amazon.co.uk', 'amazon.fr',
  'amazon.it', 'amazon.es', 'amazon.nl', 'amazon.co.jp',
  'amazon.ca', 'amazon.com.au', 'amazon.in', 'amazon.com.br',
];

const ASIN_REGEX = /(?:\/(?:dp|gp\/product|ASIN)\/)([A-Z0-9]{10})/i;

function isAmazonUrl(url) {
  try {
    const parsed = new URL(url);
    return AMAZON_DOMAINS.some((d) => parsed.hostname === d || parsed.hostname === `www.${d}`);
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

module.exports = { isAmazonUrl, extractAsin, extractDomain, canonicalUrl, AMAZON_DOMAINS };
