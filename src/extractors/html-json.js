const { parsePrice } = require('../format');
const { extractDomain } = require('../url');

const DOMAIN_PREFS = {
  'amazon.de': { currency: 'EUR', language: 'de-DE,de;q=0.9,en;q=0.7' },
  'amazon.com': { currency: 'USD', language: 'en-US,en;q=0.9' },
  'amazon.co.uk': { currency: 'GBP', language: 'en-GB,en;q=0.9' },
  'amazon.fr': { currency: 'EUR', language: 'fr-FR,fr;q=0.9,en;q=0.7' },
  'amazon.it': { currency: 'EUR', language: 'it-IT,it;q=0.9,en;q=0.7' },
  'amazon.es': { currency: 'EUR', language: 'es-ES,es;q=0.9,en;q=0.7' },
  'amazon.nl': { currency: 'EUR', language: 'nl-NL,nl;q=0.9,en;q=0.7' },
  'amazon.co.jp': { currency: 'JPY', language: 'ja-JP,ja;q=0.9,en;q=0.6' },
  'amazon.ca': { currency: 'CAD', language: 'en-CA,en;q=0.9' },
  'amazon.com.au': { currency: 'AUD', language: 'en-AU,en;q=0.9' },
  'amazon.in': { currency: 'INR', language: 'en-IN,en;q=0.9' },
  'amazon.com.br': { currency: 'BRL', language: 'pt-BR,pt;q=0.9,en;q=0.7' },
};

const BLOCK_TEXT_PATTERNS = [
  /robot check/,
  /captcha/,
  /enter the characters/,
  /not a robot/,
  /automated access/,
  /automatisierte zugriffe/,
  /geben sie die zeichen ein/,
  /gib die zeichen ein/,
  /sicherheitsuberprufung/,
  /sicherheitsprufung/,
  /kein roboter/,
  /acceso automatizado/,
  /introduce los caracteres/,
  /verificacion de seguridad/,
  /entrez les caracteres/,
  /pas un robot/,
  /accesso automatico/,
  /inserisci i caratteri/,
  /verifica di sicurezza/,
];

const BLOCK_URL_PATTERNS = [
  /\/errors\/validatecaptcha/,
  /\/sorry\/index/,
  /\/ap\/challenge/,
  /\/errors\/captcha/,
  /\/ap\/signin/,
];

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function cleanText(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&pound;/gi, '£')
    .replace(/&yen;/gi, '¥')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeJsonLikeString(raw) {
  const candidate = cleanText(raw);
  if (!candidate) return candidate;
  try {
    const escaped = candidate
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    return cleanText(JSON.parse(`"${escaped}"`));
  } catch {
    return candidate;
  }
}

function contextScore(context, index) {
  const lower = String(context || '').toLowerCase();
  let score = 0;

  if (/desktop_buybox_group_1|buybox|coreprice|pricetopay|apex/.test(lower)) score += 90;
  if (/group_2|group_3/.test(lower)) score -= 10;
  if (/used|buying options|basisprice|a-text-price|strike|wasprice|listprice/.test(lower)) score -= 70;
  if (/twister/.test(lower)) score += 20;

  score -= index;
  return score;
}

function collectDisplayCandidates(html, fallbackCurrency) {
  const candidates = [];
  const regex = /"displayPrice"\s*:\s*"([^\"]+)"/g;
  let match = null;
  let idx = 0;

  while ((match = regex.exec(html)) !== null) {
    const decoded = decodeJsonLikeString(match[1]);
    if (!decoded) {
      idx += 1;
      continue;
    }

    const parsed = parsePrice(decoded, fallbackCurrency);
    if (!parsed || !Number.isFinite(parsed.numeric) || parsed.numeric <= 0) {
      idx += 1;
      continue;
    }

    const context = html.slice(Math.max(0, match.index - 180), Math.min(html.length, match.index + 40));
    const score = contextScore(context, idx);

    candidates.push({
      method: 'displayPrice',
      score,
      text: decoded,
      parsed,
      context,
    });
    idx += 1;
  }

  return candidates;
}

function collectPriceAmountCandidates(html, fallbackCurrency) {
  const candidates = [];
  const regex = /"priceAmount"\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"currency(?:Symbol|Code)"\s*:\s*"([^\"]+)"/g;
  let match = null;
  let idx = 0;

  while ((match = regex.exec(html)) !== null) {
    const amount = Number(match[1]);
    const symbol = decodeJsonLikeString(match[2]);
    if (!Number.isFinite(amount) || amount <= 0) {
      idx += 1;
      continue;
    }

    const text = symbol ? `${symbol} ${amount}` : String(amount);
    const parsed = parsePrice(text, fallbackCurrency);
    if (!parsed || !Number.isFinite(parsed.numeric) || parsed.numeric <= 0) {
      idx += 1;
      continue;
    }

    const context = html.slice(Math.max(0, match.index - 180), Math.min(html.length, match.index + 40));
    const score = contextScore(context, idx) + 10;

    candidates.push({
      method: 'priceAmount',
      score,
      text,
      parsed,
      context,
    });

    idx += 1;
  }

  return candidates;
}

function extractPriceFromHtml(html, fallbackCurrency = null) {
  const source = String(html || '');
  if (!source) return null;

  const candidates = [
    ...collectPriceAmountCandidates(source, fallbackCurrency),
    ...collectDisplayCandidates(source, fallbackCurrency),
  ];

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  let confidence = 0.7;
  if (best.score >= 90) confidence = 0.96;
  else if (best.score >= 50) confidence = 0.86;
  else if (best.score >= 20) confidence = 0.78;

  return {
    text: cleanText(best.text),
    parsed: best.parsed,
    confidence,
    method: best.method,
    score: best.score,
  };
}

function extractTitleFromHtml(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  return cleanText(match[1].replace(/<[^>]+>/g, ''));
}

function detectBlockedPage({
  httpStatus,
  pageTitle,
  bodyText,
  finalUrl,
}) {
  const title = normalizeForMatch(pageTitle);
  const body = normalizeForMatch(bodyText);
  const url = normalizeForMatch(finalUrl);
  const combined = `${title}\n${body}`;

  if (httpStatus === 429) {
    return { blockedSignal: true, blockedReason: 'http_429' };
  }
  if (httpStatus === 503) {
    return { blockedSignal: true, blockedReason: 'http_503' };
  }
  if (BLOCK_URL_PATTERNS.some((pattern) => pattern.test(url))) {
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }
  if (BLOCK_TEXT_PATTERNS.some((pattern) => pattern.test(combined))) {
    if (/captcha|enter the characters|zeichen ein|caracteres/.test(combined)) {
      return { blockedSignal: true, blockedReason: 'captcha' };
    }
    if (/robot check|not a robot|kein roboter/.test(combined)) {
      return { blockedSignal: true, blockedReason: 'robot_check' };
    }
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }

  return { blockedSignal: false, blockedReason: null };
}

function defaultHeadersForDomain(domain) {
  const prefs = DOMAIN_PREFS[domain] || { currency: null, language: 'en-US,en;q=0.9' };
  const headers = {
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'accept-language': prefs.language,
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'upgrade-insecure-requests': '1',
    'user-agent': process.env.AMAPRICE_USER_AGENT
      || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  };

  if (prefs.currency) {
    headers.cookie = `i18n-prefs=${prefs.currency}`;
  }

  return headers;
}

async function runHtmlJsonExtraction(url, {
  timeoutMs = 30000,
  fallbackCurrency = null,
  headers = null,
} = {}) {
  const domain = extractDomain(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: headers || defaultHeadersForDomain(domain),
      signal: controller.signal,
    });

    const body = await response.text();
    const finalUrl = response.url || url;
    const httpStatus = response.status;
    const pageTitle = extractTitleFromHtml(body) || 'Unknown';

    const blocked = detectBlockedPage({
      httpStatus,
      pageTitle,
      bodyText: body.slice(0, 16000),
      finalUrl,
    });

    if (blocked.blockedSignal) {
      return {
        status: 'blocked',
        method: 'html_json',
        priceRaw: null,
        price: null,
        confidence: 0,
        httpStatus,
        blockedSignal: true,
        blockedReason: blocked.blockedReason,
        pageTitle,
        finalUrl,
        debug: {
          extractor: 'html_json',
          domain,
        },
      };
    }

    const candidate = extractPriceFromHtml(body, fallbackCurrency || DOMAIN_PREFS[domain]?.currency || null);
    if (!candidate) {
      return {
        status: 'no_price',
        method: 'html_json',
        priceRaw: null,
        price: null,
        confidence: 0,
        httpStatus,
        blockedSignal: false,
        blockedReason: null,
        pageTitle,
        finalUrl,
        debug: {
          extractor: 'html_json',
          domain,
          hasDisplayPrice: /"displayPrice"\s*:\s*"/.test(body),
          hasPriceAmount: /"priceAmount"\s*:\s*/.test(body),
        },
      };
    }

    return {
      status: 'ok',
      method: 'html_json',
      priceRaw: candidate.text,
      price: candidate.parsed,
      confidence: candidate.confidence,
      httpStatus,
      blockedSignal: false,
      blockedReason: null,
      pageTitle,
      finalUrl,
      debug: {
        extractor: 'html_json',
        domain,
        candidateMethod: candidate.method,
        candidateScore: candidate.score,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  runHtmlJsonExtraction,
};

module.exports.__test = {
  cleanText,
  decodeJsonLikeString,
  extractPriceFromHtml,
  extractTitleFromHtml,
  detectBlockedPage,
  defaultHeadersForDomain,
};
