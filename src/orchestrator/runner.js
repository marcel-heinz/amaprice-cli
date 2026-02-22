const { runCollectionPipeline } = require('../extractors/pipeline');
const {
  enqueueDueCollectionJobs,
  claimCollectionJobs,
  completeCollectionJob,
  requeueExpiredCollectionJobs,
  insertCollectionAttempt,
  insertPrice,
  insertScrapeAttempt,
  upsertProductLatestPrice,
  updateProductById,
  getRecentPrices,
} = require('../db');
const {
  normalizeTier,
  computeNextScrapeAt,
  computeFailureBackoffMinutes,
  demoteTier,
  recommendAutoTier,
} = require('../tiering');

function trimErrorMessage(value) {
  return String(value || 'Unknown error').slice(0, 4000);
}

function classifyFailure(resultOrError) {
  const message = String(resultOrError?.message || '').toLowerCase();
  const httpStatus = Number(resultOrError?.httpStatus) || null;

  if (resultOrError?.blockedSignal) {
    const reason = String(resultOrError?.blockedReason || '').toLowerCase();
    if (reason.includes('captcha')) {
      return { status: 'captcha', blockedSignal: true, httpStatus };
    }
    if (reason.includes('robot')) {
      return { status: 'robot_check', blockedSignal: true, httpStatus };
    }
    if (httpStatus === 429) {
      return { status: 'http_429', blockedSignal: true, httpStatus: 429 };
    }
    if (httpStatus === 503) {
      return { status: 'http_503', blockedSignal: true, httpStatus: 503 };
    }
    return { status: 'captcha', blockedSignal: true, httpStatus };
  }

  if (httpStatus === 429 || message.includes('429')) {
    return { status: 'http_429', blockedSignal: true, httpStatus: 429 };
  }
  if (httpStatus === 503 || message.includes('503')) {
    return { status: 'http_503', blockedSignal: true, httpStatus: 503 };
  }
  if (message.includes('timeout') || message.includes('timed out')) {
    return { status: 'timeout', blockedSignal: false, httpStatus };
  }
  if (message.includes('econn') || message.includes('enotfound') || message.includes('network')) {
    return { status: 'network_error', blockedSignal: false, httpStatus };
  }
  if (message.includes('no price') || message.includes('could not extract price')) {
    return { status: 'no_price', blockedSignal: false, httpStatus };
  }
  return { status: 'other_error', blockedSignal: false, httpStatus };
}

function buildNoPriceErrorMessage(result) {
  const details = [];
  if (result?.httpStatus) details.push(`http=${result.httpStatus}`);
  if (result?.finalUrl) details.push(`final_url=${result.finalUrl}`);
  if (result?.pageTitle) details.push(`title=${String(result.pageTitle).replace(/\s+/g, ' ').slice(0, 120)}`);
  return details.length > 0
    ? `Could not extract price from the page. ${details.join(' | ')}`
    : 'Could not extract price from the page.';
}

function nextJobStateAfterFailure(job) {
  const attempts = Number(job?.attempt_count) || 0;
  const maxAttempts = Number(job?.max_attempts) || 5;
  return attempts >= maxAttempts ? 'dead' : 'queued';
}

async function processClaimedJob(job, {
  collectorId = null,
  executor = 'railway',
  allowVision = true,
  allowRailwayDomFallback = true,
} = {}) {
  const startedAtIso = new Date().toISOString();
  const productTier = normalizeTier(job.tier, 'daily');
  const tierMode = String(job.tier_mode || 'auto');

  try {
    const result = await runCollectionPipeline({
      url: job.url,
      domain: job.domain,
      allowVision,
      allowRailwayDomFallback,
    });

    if (!result.price) {
      const error = new Error(
        result.blockedSignal
          ? `Blocked page detected (${result.blockedReason || 'challenge'})`
          : buildNoPriceErrorMessage(result),
      );
      error.httpStatus = result.httpStatus;
      error.blockedSignal = Boolean(result.blockedSignal);
      error.blockedReason = result.blockedReason;
      throw error;
    }

    const priceRecord = await insertPrice({
      productId: job.product_id,
      price: result.price.numeric,
      currency: result.price.currency,
    });

    await upsertProductLatestPrice({
      productId: job.product_id,
      price: result.price.numeric,
      currency: result.price.currency,
      scrapedAt: priceRecord.scraped_at,
      source: result.method,
      confidence: result.confidence,
    }).catch(() => {});

    let nextTier = productTier;
    if (tierMode === 'auto') {
      const history = await getRecentPrices(job.product_id, 120);
      nextTier = recommendAutoTier(history);
    }

    const nowIso = new Date().toISOString();
    const lastPrice = Number(job.last_price);
    const hasLastPrice = Number.isFinite(lastPrice);
    const didPriceChange = !hasLastPrice || Math.abs(lastPrice - result.price.numeric) > 0.00001;

    const patch = {
      tier: nextTier,
      last_price: result.price.numeric,
      last_scraped_at: nowIso,
      next_scrape_at: computeNextScrapeAt(nextTier),
      consecutive_failures: 0,
      last_error: null,
    };
    if (didPriceChange) {
      patch.last_price_change_at = nowIso;
    }

    await updateProductById(job.product_id, patch);

    await insertScrapeAttempt({
      productId: job.product_id,
      status: 'ok',
      httpStatus: result.httpStatus,
      blockedSignal: false,
      price: result.price.numeric,
      currency: result.price.currency,
    }).catch(() => {});

    await insertCollectionAttempt({
      jobId: job.id,
      productId: job.product_id,
      collectorId,
      executor,
      method: result.method,
      status: 'ok',
      httpStatus: result.httpStatus,
      blockedSignal: false,
      price: result.price.numeric,
      currency: result.price.currency,
      confidence: result.confidence,
      debug: result.debug,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
    });

    if (job.id) {
      await completeCollectionJob({
        jobId: job.id,
        state: 'done',
        nextScheduledFor: patch.next_scrape_at,
      });
    }

    return {
      asin: job.asin,
      status: 'ok',
      tier: nextTier,
      price: result.price.numeric,
      currency: result.price.currency,
      method: result.method,
      confidence: result.confidence,
      nextScrapeAt: patch.next_scrape_at,
    };
  } catch (err) {
    const classified = classifyFailure(err);
    const nextFailures = (Number(job.consecutive_failures) || 0) + 1;
    let nextTier = productTier;
    if (tierMode === 'auto' && nextFailures >= 3) {
      nextTier = demoteTier(productTier);
    }

    const backoffMinutes = computeFailureBackoffMinutes(nextFailures);
    const nextScrapeAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
    const errorMessage = trimErrorMessage(err.message);

    await updateProductById(job.product_id, {
      tier: nextTier,
      consecutive_failures: nextFailures,
      last_error: errorMessage,
      next_scrape_at: nextScrapeAt,
    });

    await insertScrapeAttempt({
      productId: job.product_id,
      status: classified.status,
      httpStatus: classified.httpStatus,
      blockedSignal: classified.blockedSignal,
      errorCode: classified.status,
      errorMessage,
    }).catch(() => {});

    await insertCollectionAttempt({
      jobId: job.id,
      productId: job.product_id,
      collectorId,
      executor,
      method: 'html_json',
      status: classified.status,
      httpStatus: classified.httpStatus,
      blockedSignal: classified.blockedSignal,
      errorCode: classified.status,
      errorMessage,
      startedAt: startedAtIso,
      finishedAt: new Date().toISOString(),
    }).catch(() => {});

    if (job.id) {
      const state = nextJobStateAfterFailure(job);
      await completeCollectionJob({
        jobId: job.id,
        state,
        lastError: errorMessage,
        nextScheduledFor: state === 'queued' ? nextScrapeAt : null,
      }).catch(() => {});
    }

    return {
      asin: job.asin,
      status: 'failed',
      tier: nextTier,
      method: 'html_json',
      error: errorMessage,
      nextScrapeAt,
    };
  }
}

async function runOrchestratedSync({
  limit = 20,
  collectorId = null,
  executor = 'railway',
  routeHint = 'collector_first',
  allowVision = true,
  allowRailwayDomFallback = true,
} = {}) {
  const safeLimit = Math.max(1, Number(limit) || 20);

  await requeueExpiredCollectionJobs(200).catch(() => {});
  await enqueueDueCollectionJobs(Math.max(safeLimit * 2, safeLimit)).catch(() => {});

  const jobs = await claimCollectionJobs({
    collectorId,
    limit: safeLimit,
    leaseSeconds: 120,
    routeHint,
  });

  if (!jobs || jobs.length === 0) {
    return {
      processed: 0,
      success: 0,
      failed: 0,
      items: [],
    };
  }

  const items = [];
  let success = 0;
  let failed = 0;

  for (const job of jobs) {
    const item = await processClaimedJob(job, {
      collectorId,
      executor,
      allowVision,
      allowRailwayDomFallback,
    });
    items.push(item);
    if (item.status === 'ok') success += 1;
    else failed += 1;
  }

  return {
    processed: jobs.length,
    success,
    failed,
    items,
  };
}

module.exports = {
  runOrchestratedSync,
  processClaimedJob,
};

module.exports.__test = {
  classifyFailure,
  buildNoPriceErrorMessage,
  nextJobStateAfterFailure,
};
