const { chromium } = require('playwright');
const { parsePrice } = require('./format');
const { extractAsin, extractDomain } = require('./url');

const PRICE_SELECTORS = [
  '#corePrice_feature_div .a-price .a-offscreen',
  '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
  '.a-price .a-offscreen',
  '#priceblock_ourprice',
  '#priceblock_dealprice',
];

const CONTAINER_SAFE_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

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
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const httpStatus = response ? response.status() : null;

    // Product title
    const titleEl = await page.$('#productTitle');
    const title = titleEl ? (await titleEl.textContent()).trim() : 'Unknown';

    // Price — try selectors in order of specificity
    let priceRaw = null;
    for (const sel of PRICE_SELECTORS) {
      const el = await page.$(sel);
      if (el) {
        const text = (await el.textContent()).trim();
        if (text) {
          priceRaw = text;
          break;
        }
      }
    }

    const parsed = parsePrice(priceRaw);
    const asin = extractAsin(url);
    const domain = extractDomain(url);
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
