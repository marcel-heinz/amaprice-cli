const { parsePrice } = require('../format');

function extractJsonBlock(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {}

  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

function extractOutputText(payload) {
  if (!payload || typeof payload !== 'object') return '';

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (Array.isArray(payload.output)) {
    const parts = [];
    for (const item of payload.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (typeof content?.text === 'string') parts.push(content.text);
      }
    }
    return parts.join('\n').trim();
  }

  return '';
}

function toConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

function normalizeVisionResult(raw, fallbackCurrency = null) {
  const parsed = extractJsonBlock(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const isBlocked = Boolean(parsed.is_blocked);
  const reason = String(parsed.reason || '').trim() || null;
  const rawPrice = parsed.price == null ? null : String(parsed.price).trim();
  const currency = String(parsed.currency || '').trim() || null;
  const confidence = toConfidence(parsed.confidence);

  if (isBlocked) {
    return {
      status: 'blocked',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence,
      blockedSignal: true,
      blockedReason: reason || 'blocked_detected',
      debug: {
        source: 'vision',
        raw_text: String(parsed.raw_text || ''),
      },
    };
  }

  if (!rawPrice) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence,
      blockedSignal: false,
      blockedReason: null,
      debug: {
        source: 'vision',
        reason: reason || 'no_price',
      },
    };
  }

  const merged = currency ? `${currency} ${rawPrice}` : rawPrice;
  const structured = parsePrice(merged, fallbackCurrency);
  if (!structured || !Number.isFinite(structured.numeric) || structured.numeric <= 0) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: rawPrice,
      price: null,
      confidence,
      blockedSignal: false,
      blockedReason: null,
      debug: {
        source: 'vision',
        reason: 'unparseable_price',
      },
    };
  }

  return {
    status: 'ok',
    method: 'vision',
    priceRaw: rawPrice,
    price: structured,
    confidence,
    blockedSignal: false,
    blockedReason: null,
    debug: {
      source: 'vision',
      reason,
    },
  };
}

function isVisionEnabled() {
  return process.env.VISION_FALLBACK_ENABLED === '1';
}

async function extractPriceFromScreenshotBuffer(imageBuffer, {
  fallbackCurrency = null,
  model = process.env.VISION_MODEL || 'gpt-4.1-mini',
  apiKey = process.env.OPENAI_API_KEY,
} = {}) {
  if (!isVisionEnabled()) {
    return null;
  }

  if (!apiKey) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence: 0,
      blockedSignal: false,
      blockedReason: null,
      debug: { source: 'vision', reason: 'missing_api_key' },
    };
  }

  const base64 = Buffer.from(imageBuffer || '').toString('base64');
  if (!base64) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence: 0,
      blockedSignal: false,
      blockedReason: null,
      debug: { source: 'vision', reason: 'empty_image' },
    };
  }

  const prompt = [
    'Extract the currently visible final product price from this e-commerce screenshot.',
    'Respond with JSON only and keys: price, currency, confidence, is_blocked, reason, raw_text.',
    'Use decimal number for price (example: 79.99).',
    'If price is not clearly visible, set price=null and confidence<=0.5.',
  ].join(' ');

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: `data:image/png;base64,${base64}` },
          ],
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  const outputText = extractOutputText(payload);
  const normalized = normalizeVisionResult(outputText, fallbackCurrency);

  if (!normalized) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence: 0,
      blockedSignal: false,
      blockedReason: null,
      debug: {
        source: 'vision',
        reason: 'invalid_model_output',
        httpStatus: response.status,
      },
    };
  }

  return {
    ...normalized,
    debug: {
      ...(normalized.debug || {}),
      httpStatus: response.status,
      model,
    },
  };
}

module.exports = {
  extractPriceFromScreenshotBuffer,
  isVisionEnabled,
};

module.exports.__test = {
  extractJsonBlock,
  normalizeVisionResult,
  toConfidence,
};
