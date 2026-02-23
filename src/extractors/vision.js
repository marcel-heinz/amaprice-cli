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

  if (Array.isArray(payload.choices)) {
    const parts = [];
    for (const choice of payload.choices) {
      const content = choice?.message?.content;
      if (typeof content === 'string') {
        parts.push(content);
        continue;
      }

      if (!Array.isArray(content)) continue;
      for (const chunk of content) {
        if (typeof chunk?.text === 'string') parts.push(chunk.text);
      }
    }
    return parts.join('\n').trim();
  }

  return '';
}

function getProvider({
  preferredProvider = null,
  openRouterApiKey = process.env.OPENROUTER_API_KEY,
  openAiApiKey = process.env.OPENAI_API_KEY,
  model = process.env.VISION_MODEL || null,
} = {}) {
  const preferred = String(preferredProvider || '').trim().toLowerCase();

  if (preferred === 'openai' && openAiApiKey) {
    return {
      name: 'openai',
      apiKey: openAiApiKey,
      model: model || 'gpt-4.1-mini',
    };
  }

  if (preferred === 'openrouter' && openRouterApiKey) {
    return {
      name: 'openrouter',
      apiKey: openRouterApiKey,
      model: model || 'google/gemini-3-flash-preview',
    };
  }

  if (openRouterApiKey) {
    return {
      name: 'openrouter',
      apiKey: openRouterApiKey,
      model: model || 'google/gemini-3-flash-preview',
    };
  }

  if (openAiApiKey) {
    return {
      name: 'openai',
      apiKey: openAiApiKey,
      model: model || 'gpt-4.1-mini',
    };
  }

  return null;
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

function buildVisionPrompt() {
  return [
    'You extract the final payable price from an Amazon product-detail screenshot.',
    'Respond with JSON only using exactly keys: price, currency, confidence, is_blocked, reason, raw_text.',
    'price must be a decimal number (dot separator), or null when uncertain.',
    'Only use the main buy-box product price for the shown product.',
    'Ignore list/strike prices, "from" ranges, installment/monthly values, coupons, shipping, used/new offers, bundle prices, and sponsored/related product prices.',
    'If the page is captcha/challenge/login/cookie-wall and price is not clearly visible, set is_blocked=true and price=null.',
    'If multiple plausible prices exist, set price=null.',
    'confidence must be a number between 0 and 1.',
  ].join(' ');
}

async function requestOpenRouter({ apiKey, model, prompt, base64 }) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${apiKey}`,
      'content-type': 'application/json',
      ...(process.env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER } : {}),
      ...(process.env.OPENROUTER_TITLE ? { 'X-Title': process.env.OPENROUTER_TITLE } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } },
          ],
        },
      ],
      temperature: 0,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  return {
    response,
    payload,
    outputText: extractOutputText(payload),
  };
}

async function requestOpenAi({ apiKey, model, prompt, base64 }) {
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
  return {
    response,
    payload,
    outputText: extractOutputText(payload),
  };
}

async function extractPriceFromScreenshotBuffer(imageBuffer, {
  fallbackCurrency = null,
  model = process.env.VISION_MODEL || null,
  provider = process.env.VISION_PROVIDER || null,
  openRouterApiKey = process.env.OPENROUTER_API_KEY,
  openAiApiKey = process.env.OPENAI_API_KEY,
} = {}) {
  if (!isVisionEnabled()) {
    return null;
  }

  const selected = getProvider({
    preferredProvider: provider,
    openRouterApiKey,
    openAiApiKey,
    model,
  });

  if (!selected) {
    return {
      status: 'no_price',
      method: 'vision',
      priceRaw: null,
      price: null,
      confidence: 0,
      blockedSignal: false,
      blockedReason: null,
      debug: { source: 'vision', reason: 'missing_api_key', expected: 'OPENROUTER_API_KEY or OPENAI_API_KEY' },
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

  const prompt = buildVisionPrompt();

  const transport = selected.name === 'openrouter'
    ? await requestOpenRouter({
      apiKey: selected.apiKey,
      model: selected.model,
      prompt,
      base64,
    })
    : await requestOpenAi({
      apiKey: selected.apiKey,
      model: selected.model,
      prompt,
      base64,
    });

  const outputText = transport.outputText;
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
        httpStatus: transport.response.status,
        provider: selected.name,
        model: selected.model,
        providerError: transport.payload?.error?.message || null,
      },
    };
  }

  return {
    ...normalized,
    debug: {
      ...(normalized.debug || {}),
      httpStatus: transport.response.status,
      provider: selected.name,
      model: selected.model,
    },
  };
}

module.exports = {
  extractPriceFromScreenshotBuffer,
  isVisionEnabled,
};

module.exports.__test = {
  buildVisionPrompt,
  extractJsonBlock,
  extractOutputText,
  getProvider,
  normalizeVisionResult,
  toConfidence,
};
