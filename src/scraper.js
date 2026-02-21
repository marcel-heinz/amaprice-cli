const { chromium } = require('playwright');
const { parsePrice } = require('./format');
const { extractAsin, extractDomain } = require('./url');

const PRICE_SELECTORS = [
  '#corePrice_feature_div .apex-pricetopay-value .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .apex-pricetopay-value .a-offscreen',
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  '#buybox .a-price .a-offscreen',
  '#desktop_buybox .a-price .a-offscreen',
  '#newAccordionRow .a-price .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
];

const CONTAINER_SAFE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

const DOMAIN_PREFS = {
  'amazon.de': { currency: 'EUR' },
  'amazon.com': { currency: 'USD' },
  'amazon.co.uk': { currency: 'GBP' },
  'amazon.fr': { currency: 'EUR' },
  'amazon.it': { currency: 'EUR' },
  'amazon.es': { currency: 'EUR' },
  'amazon.nl': { currency: 'EUR' },
  'amazon.co.jp': { currency: 'JPY' },
  'amazon.ca': { currency: 'CAD' },
  'amazon.com.au': { currency: 'AUD' },
  'amazon.in': { currency: 'INR' },
  'amazon.com.br': { currency: 'BRL' },
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

const ROBOT_TEXT_PATTERNS = [
  /robot check/,
  /not a robot/,
  /kein roboter/,
  /pas un robot/,
  /no eres un robot/,
  /non sei un robot/,
];

const CAPTCHA_TEXT_PATTERNS = [
  /captcha/,
  /enter the characters/,
  /zeichen ein/,
  /caracteres/,
  /inserisci i caratteri/,
];

const BLOCK_URL_PATTERNS = [
  /\/errors\/validatecaptcha/,
  /\/sorry\/index/,
  /\/ap\/challenge/,
  /\/errors\/captcha/,
  /\/ap\/signin/,
];

const PRODUCT_INDICATOR_SELECTOR = '#productTitle, #dp, #feature-bullets, #corePrice_feature_div, #corePriceDisplay_desktop_feature_div, #add-to-cart-button, #buy-now-button';
const CHALLENGE_INDICATOR_SELECTOR = 'form[action*="validateCaptcha"], input[name*="captcha" i], img[src*="captcha" i]';

function getDomainPrefs(domain) {
  return DOMAIN_PREFS[domain] || { currency: null };
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function scorePriceCandidate(candidate) {
  let score = 0;
  const top = Number.isFinite(candidate.top) ? candidate.top : 1e9;
  const ctx = String(candidate.context || '').toLowerCase();

  if (candidate.visible) score += 100;
  if (top >= 0 && top <= 1600) {
    score += 30;
  } else if (top > 1600) {
    score -= 20;
  }
  score -= Math.floor(Math.max(0, top) / 250);

  if (/apex-pricetopay|pricetopay|coreprice|priceblock_ourprice|priceblock_dealprice|buybox/.test(ctx)) {
    score += 35;
  }
  if (/basisprice|a-text-price|strike|wasprice/.test(ctx)) {
    score -= 60;
  }

  score -= candidate.index;
  return score;
}

function chooseBestPriceCandidate(rawCandidates, fallbackCurrency) {
  const candidates = (rawCandidates || [])
    .filter((c) => c && c.text)
    .map((c) => ({
      ...c,
      parsed: parsePrice(c.text, fallbackCurrency),
    }))
    .filter((c) => c.parsed && Number.isFinite(c.parsed.numeric) && c.parsed.numeric > 0);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => scorePriceCandidate(b) - scorePriceCandidate(a));
  return candidates[0];
}

async function pickPriceTextForSelector(page, selector, fallbackCurrency) {
  const rawCandidates = await page.$$eval(selector, (nodes) => nodes.map((node, index) => {
    const text = (node.textContent || '').trim();
    const rect = node.getBoundingClientRect();
    const style = window.getComputedStyle(node);
    const visible = rect.width > 0
      && rect.height > 0
      && style.display !== 'none'
      && style.visibility !== 'hidden';

    let ctx = '';
    let cursor = node;
    for (let i = 0; i < 5 && cursor; i += 1) {
      const id = cursor.id ? `#${cursor.id}` : '';
      const cls = typeof cursor.className === 'string'
        ? `.${cursor.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
      ctx += ` ${cursor.tagName || ''}${id}${cls}`;
      cursor = cursor.parentElement;
    }

    return {
      index,
      text,
      top: Number.isFinite(rect.top) ? rect.top : null,
      visible,
      context: ctx.trim(),
    };
  }));

  const best = chooseBestPriceCandidate(rawCandidates, fallbackCurrency);
  return best ? best.text : null;
}

function detectBlockedPage({
  httpStatus,
  pageTitle,
  bodyText,
  finalUrl,
  hasProductTitle,
  productIndicatorCount = 0,
  challengeIndicatorCount = 0,
}) {
  const normalizedTitle = normalizeForMatch(pageTitle);
  const normalizedBody = normalizeForMatch(bodyText);
  const normalizedUrl = normalizeForMatch(finalUrl);
  const combined = `${normalizedTitle}\n${normalizedBody}`;

  if (httpStatus === 429) {
    return { blockedSignal: true, blockedReason: 'http_429' };
  }
  if (httpStatus === 503) {
    return { blockedSignal: true, blockedReason: 'http_503' };
  }
  if (matchesAny(normalizedUrl, BLOCK_URL_PATTERNS)) {
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }
  if (challengeIndicatorCount > 0) {
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }
  if (matchesAny(combined, BLOCK_TEXT_PATTERNS)) {
    if (matchesAny(combined, ROBOT_TEXT_PATTERNS)) {
      return { blockedSignal: true, blockedReason: 'robot_check' };
    }
    if (matchesAny(combined, CAPTCHA_TEXT_PATTERNS)) {
      return { blockedSignal: true, blockedReason: 'captcha' };
    }
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }

  const looksLikeProductUrl = /\/dp\/|\/gp\/product\//.test(normalizedUrl);
  if (!hasProductTitle && productIndicatorCount === 0 && !looksLikeProductUrl) {
    return { blockedSignal: true, blockedReason: 'challenge_page' };
  }

  return { blockedSignal: false, blockedReason: null };
}

function shouldRetryNoPrice(result, attempt, maxAttempts) {
  return Boolean(result && !result.price && !result.blockedSignal && attempt < maxAttempts);
}

async function scrapePageOnce(page, url, prefs) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const httpStatus = response ? response.status() : null;

  // Product title
  const titleEl = await page.$('#productTitle');
  const rawTitle = titleEl ? (await titleEl.textContent()) : null;
  const title = rawTitle ? rawTitle.trim() : 'Unknown';
  const hasProductTitle = Boolean(titleEl && title && title !== 'Unknown');

  // Price — try selectors in order of specificity
  let priceRaw = null;
  let parsed = null;
  for (const sel of PRICE_SELECTORS) {
    const text = await pickPriceTextForSelector(page, sel, prefs.currency);
    if (!text) continue;

    const candidate = parsePrice(text, prefs.currency);
    if (candidate) {
      priceRaw = text;
      parsed = candidate;
      break;
    }
  }

  const asin = extractAsin(url);
  const pageTitle = await page.title();
  const finalUrl = page.url();
  const bodyText = (await page.textContent('body') || '').slice(0, 12000);
  const [productIndicatorCount, challengeIndicatorCount] = await Promise.all([
    page.$$eval(PRODUCT_INDICATOR_SELECTOR, (nodes) => nodes.length).catch(() => 0),
    page.$$eval(CHALLENGE_INDICATOR_SELECTOR, (nodes) => nodes.length).catch(() => 0),
  ]);

  const blocked = detectBlockedPage({
    httpStatus,
    pageTitle,
    bodyText,
    finalUrl,
    hasProductTitle,
    productIndicatorCount,
    challengeIndicatorCount,
  });

  return {
    title,
    priceRaw,
    price: parsed,
    asin,
    httpStatus,
    blockedSignal: blocked.blockedSignal,
    blockedReason: blocked.blockedReason,
  };
}

async function createDomainContext(browser, domain) {
  const prefs = getDomainPrefs(domain);
  const context = await browser.newContext();

  if (prefs.currency) {
    try {
      await context.addCookies([{
        name: 'i18n-prefs',
        value: prefs.currency,
        domain: `.${domain}`,
        path: '/',
        secure: true,
      }]);
    } catch {
      // Best effort only; scraping can continue without this cookie.
    }
  }

  return { context, prefs };
}

async function launchBrowser() {
  const attempts = [
    {
      headless: true,
      channel: 'chromium',
      chromiumSandbox: false,
      args: CONTAINER_SAFE_ARGS,
    },
    {
      headless: true,
      chromiumSandbox: false,
      args: CONTAINER_SAFE_ARGS,
    },
  ];

  let lastError = null;
  for (const opts of attempts) {
    try {
      return await chromium.launch(opts);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Failed to launch Chromium.');
}

/**
 * Scrape product title and price from an Amazon URL.
 * Returns { title, priceRaw, price, asin, domain, url }
 */
async function scrapePrice(url) {
  const domain = extractDomain(url);
  const browser = await launchBrowser();
  try {
    const { context, prefs } = await createDomainContext(browser, domain);
    const maxAttempts = 2;
    let result = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const page = await context.newPage();
      try {
        result = await scrapePageOnce(page, url, prefs);
      } finally {
        await page.close().catch(() => {});
      }

      if (!shouldRetryNoPrice(result, attempt, maxAttempts)) {
        break;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    const safeResult = result || {
      title: 'Unknown',
      priceRaw: null,
      price: null,
      asin: extractAsin(url),
      httpStatus: null,
      blockedSignal: false,
      blockedReason: null,
    };

    return {
      title: safeResult.title,
      priceRaw: safeResult.priceRaw,
      price: safeResult.price,
      asin: safeResult.asin,
      domain,
      url,
      httpStatus: safeResult.httpStatus,
      blockedSignal: safeResult.blockedSignal,
      blockedReason: safeResult.blockedReason,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePrice };
module.exports.__test = {
  PRICE_SELECTORS,
  scorePriceCandidate,
  chooseBestPriceCandidate,
  detectBlockedPage,
  shouldRetryNoPrice,
};
