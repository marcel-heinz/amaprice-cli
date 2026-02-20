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

/**
 * Scrape product title and price from an Amazon URL.
 * Returns { title, priceRaw, price, asin, domain, url }
 */
async function scrapePrice(url) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

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

    return {
      title,
      priceRaw,
      price: parsed,
      asin,
      domain,
      url,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapePrice };
