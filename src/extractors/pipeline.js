const { chromium } = require('playwright');
const { extractDomain } = require('../url');
const { scrapePrice } = require('../scraper');
const { runHtmlJsonExtraction } = require('./html-json');
const { extractPriceFromScreenshotBuffer, isVisionEnabled } = require('./vision');

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

function fallbackCurrencyForDomain(domain) {
  return DOMAIN_PREFS[domain]?.currency || null;
}

async function captureScreenshot(url, domain) {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: false,
    args: CONTAINER_SAFE_ARGS,
  });

  try {
    const context = await browser.newContext();
    const currency = fallbackCurrencyForDomain(domain);

    if (currency) {
      try {
        await context.addCookies([{
          name: 'i18n-prefs',
          value: currency,
          domain: `.${domain}`,
          path: '/',
          secure: true,
        }]);
      } catch {
        // Best effort only.
      }
    }

    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const screenshot = await page.screenshot({ type: 'png', fullPage: true });
    const pageTitle = await page.title().catch(() => null);
    const finalUrl = page.url();
    await page.close().catch(() => {});

    return {
      screenshot,
      httpStatus: response ? response.status() : null,
      pageTitle,
      finalUrl,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

function normalizeScraperResult(result, method) {
  if (!result) {
    return {
      status: 'no_price',
      method,
      priceRaw: null,
      price: null,
      confidence: 0,
      blockedSignal: false,
      blockedReason: null,
      httpStatus: null,
      pageTitle: null,
      finalUrl: null,
      debug: { source: method },
    };
  }

  return {
    status: result.price ? 'ok' : (result.blockedSignal ? 'blocked' : 'no_price'),
    method,
    priceRaw: result.priceRaw || null,
    price: result.price || null,
    confidence: Number(result.confidence) || (result.price ? 0.8 : 0),
    blockedSignal: Boolean(result.blockedSignal),
    blockedReason: result.blockedReason || null,
    httpStatus: Number(result.httpStatus) || null,
    pageTitle: result.pageTitle || result.title || null,
    finalUrl: result.finalUrl || result.url || null,
    debug: result.debug || { source: method },
  };
}

async function runCollectionPipeline({
  url,
  domain = null,
  allowVision = true,
  allowRailwayDomFallback = true,
}) {
  const effectiveDomain = domain || extractDomain(url);
  const fallbackCurrency = fallbackCurrencyForDomain(effectiveDomain);

  const htmlJsonResult = normalizeScraperResult(
    await runHtmlJsonExtraction(url, { fallbackCurrency }),
    'html_json',
  );

  if (htmlJsonResult.price) {
    return htmlJsonResult;
  }

  if (htmlJsonResult.blockedSignal) {
    return htmlJsonResult;
  }

  if (allowVision && isVisionEnabled()) {
    try {
      const shot = await captureScreenshot(url, effectiveDomain);
      const visionResult = await extractPriceFromScreenshotBuffer(shot.screenshot, { fallbackCurrency });
      const normalizedVision = normalizeScraperResult({
        ...(visionResult || {}),
        httpStatus: shot.httpStatus,
        pageTitle: shot.pageTitle,
        finalUrl: shot.finalUrl,
      }, 'vision');

      if (normalizedVision.price || normalizedVision.blockedSignal) {
        return normalizedVision;
      }
    } catch (err) {
      // Continue to DOM fallback.
    }
  }

  if (allowRailwayDomFallback) {
    const domResult = await scrapePrice(url);
    return normalizeScraperResult(domResult, 'railway_dom');
  }

  return htmlJsonResult;
}

module.exports = {
  runCollectionPipeline,
  fallbackCurrencyForDomain,
};

module.exports.__test = {
  fallbackCurrencyForDomain,
  normalizeScraperResult,
};
