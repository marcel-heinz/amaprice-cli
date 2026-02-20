// Currency symbol → ISO code mapping
const CURRENCY_MAP = {
  '€': 'EUR',
  '$': 'USD',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  'R$': 'BRL',
  'A$': 'AUD',
  'CA$': 'CAD',
};

/**
 * Parse a price string like "€249,00" or "$1,299.99" into structured data.
 * Returns { display, numeric, currency } or null if unparseable.
 */
function parsePrice(raw) {
  if (!raw || typeof raw !== 'string') return null;

  const trimmed = raw.trim();

  // Detect currency
  let currency = null;
  for (const [symbol, code] of Object.entries(CURRENCY_MAP)) {
    if (trimmed.includes(symbol)) {
      currency = code;
      break;
    }
  }
  currency = currency || 'EUR';

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
  const symbol = Object.entries(CURRENCY_MAP).find(([, c]) => c === currency)?.[0] || '€';
  if (currency === 'EUR') {
    return `${symbol}${numeric.toFixed(2).replace('.', ',')}`;
  }
  return `${symbol}${numeric.toFixed(2)}`;
}

module.exports = { parsePrice, formatPrice };
