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

function getDomainPrefs(domain) {
  return DOMAIN_PREFS[domain] || { currency: null };
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
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const httpStatus = response ? response.status() : null;

    // Product title
    const titleEl = await page.$('#productTitle');
    const title = titleEl ? (await titleEl.textContent()).trim() : 'Unknown';

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
    const bodyText = (await page.textContent('body') || '').slice(0, 5000).toLowerCase();
    const lowerTitle = String(pageTitle || '').toLowerCase();

    let blockedSignal = false;
    let blockedReason = null;
    if (httpStatus === 429) {
      blockedSignal = true;
      blockedReason = 'http_429';
    } else if (httpStatus === 503) {
      blockedSignal = true;
      blockedReason = 'http_503';
    } else if (
      /robot check|captcha|enter the characters|not a robot/.test(lowerTitle)
      || /robot check|captcha|enter the characters|automated access|not a robot/.test(bodyText)
    ) {
      blockedSignal = true;
      blockedReason = /robot check/.test(lowerTitle + bodyText) ? 'robot_check' : 'captcha';
    }

    return {
      title,
      priceRaw,
      price: parsed,
      asin,
      domain,
      url,
      httpStatus,
      blockedSignal,
      blockedReason,
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
};
