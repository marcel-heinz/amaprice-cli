// Currency symbol -> ISO code mapping (longest symbol first for disambiguation).
const CURRENCY_MAP = {
  'CA$': 'CAD',
  'A$': 'AUD',
  'R$': 'BRL',
  '€': 'EUR',
  '$': 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
};

const CURRENCY_CODES = ['EUR', 'USD', 'GBP', 'JPY', 'INR', 'BRL', 'AUD', 'CAD'];
const CURRENCY_SYMBOL_BY_CODE = Object.entries(CURRENCY_MAP).reduce((acc, [symbol, code]) => {
  if (!acc[code]) acc[code] = symbol;
  return acc;
}, {});

function detectCurrency(trimmed) {
  for (const [symbol, code] of Object.entries(CURRENCY_MAP)) {
    if (trimmed.includes(symbol)) {
      return code;
    }
  }

  const upper = trimmed.toUpperCase();
  for (const code of CURRENCY_CODES) {
    if (new RegExp(`(^|[^A-Z])${code}([^A-Z]|$)`).test(upper)) {
      return code;
    }
  }
  return null;
}

/**
 * Parse a price string like "EUR 249,00" or "$1,299.99" into structured data.
 * Returns { display, numeric, currency } or null if unparseable.
 */
function parsePrice(raw, fallbackCurrency = null) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();

  // Detect currency from symbols/codes. If absent, use caller fallback.
  const currency = detectCurrency(trimmed) || (fallbackCurrency ? String(fallbackCurrency).toUpperCase() : null);

  // Extract numeric portion: strip everything except digits, commas, dots
  const numStr = trimmed.replace(/[^\d.,]/g, '');
  if (!numStr) return null;

  // Determine decimal separator:
  // "1.299,00" → comma is decimal (EU)
  // "1,299.00" → dot is decimal (US)
  // "249,00"   → comma is decimal (EU)
  // "249.00"   → dot is decimal (US)
  let numeric;
  const lastComma = numStr.lastIndexOf(',');
  const lastDot = numStr.lastIndexOf('.');

  if (lastComma > lastDot) {
    // EU format: 1.299,00 or 249,00
    numeric = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
  } else {
    // US format: 1,299.00 or 249.00
    numeric = parseFloat(numStr.replace(/,/g, ''));
  }

  if (isNaN(numeric)) return null;

  return {
    display: trimmed,
    numeric,
    currency,
  };
}

/**
 * Format a numeric price with currency for display.
 */
function formatPrice(numeric, currency = 'EUR') {
  const normalizedCurrency = String(currency || '').toUpperCase();
  const symbol = CURRENCY_SYMBOL_BY_CODE[normalizedCurrency] || null;

  if (!symbol) {
    return normalizedCurrency
      ? `${normalizedCurrency} ${numeric.toFixed(2)}`
      : numeric.toFixed(2);
  }

  if (normalizedCurrency === 'EUR') {
    return `${symbol}${numeric.toFixed(2).replace('.', ',')}`;
  }
  return `${symbol}${numeric.toFixed(2)}`;
}

module.exports = { parsePrice, formatPrice };
