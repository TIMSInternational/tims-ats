export const DEFAULT_CURRENCY = 'USD';
export const PLATFORM_BILLING_CURRENCY = 'USD';

export const POPULAR_CURRENCY_CODES = [
  'CRC',
  'USD',
  'COP',
  'EUR',
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'PEN',
  'GBP',
  'CAD',
  'AUD',
  'JPY',
] as const;

const FALLBACK_CURRENCY_CODES = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BRL',
  'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHF', 'CLP', 'CNY',
  'COP', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF', 'DKK', 'DOP', 'DZD', 'EGP',
  'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP', 'GEL', 'GHS', 'GIP', 'GMD',
  'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG', 'HUF', 'IDR', 'ILS', 'INR',
  'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY', 'KES', 'KGS', 'KHR', 'KMF',
  'KRW', 'KWD', 'KYD', 'KZT', 'LAK', 'LBP', 'LKR', 'LRD', 'LSL', 'LYD',
  'MAD', 'MDL', 'MGA', 'MKD', 'MMK', 'MNT', 'MOP', 'MRU', 'MUR', 'MVR',
  'MWK', 'MXN', 'MYR', 'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD',
  'OMR', 'PAB', 'PEN', 'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON',
  'RSD', 'RUB', 'RWF', 'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP',
  'SLE', 'SOS', 'SRD', 'SSP', 'STN', 'SYP', 'SZL', 'THB', 'TJS', 'TMT',
  'TND', 'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'UYU',
  'UZS', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XCD', 'XOF', 'XPF', 'YER',
  'ZAR', 'ZMW', 'ZWG',
] as const;

export type CurrencyCode = string;

/**
 * Normalises a code and falls back to `fallback` (USD) when it is not ISO-4217.
 * @deprecated for display; use parseCurrencyCode + formatMoney. Kept unchanged
 * because the FX code and its parity twins depend on the fallback.
 */
export function normalizeCurrencyCode(code: string | null | undefined, fallback = DEFAULT_CURRENCY): CurrencyCode {
  const normalized = (code ?? '').trim().toUpperCase();
  return isCurrencyCode(normalized) ? normalized : fallback;
}

/**
 * Strict parse: trims and upper-cases, then returns the ISO-4217 code or null.
 * Never falls back to USD, so an unknown value stays visibly unknown.
 */
export function parseCurrencyCode(code: string | null | undefined): CurrencyCode | null {
  const normalized = (code ?? '').trim().toUpperCase();
  return isKnownCurrencyCode(normalized) ? normalized : null;
}

let knownCurrencyCodes: ReadonlySet<string> | null = null;

/**
 * Stricter than isCurrencyCode: Intl formats ANY well-formed 3-letter code (e.g. "ZZZ"),
 * so this also requires the code to be in the runtime's ISO-4217 list (or the bundled
 * fallback list when Intl.supportedValuesOf is unavailable).
 */
export function isKnownCurrencyCode(code: string | null | undefined): code is CurrencyCode {
  if (!isCurrencyCode(code)) return false;
  if (!knownCurrencyCodes) {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] };
    const codes = typeof intl.supportedValuesOf === 'function'
      ? intl.supportedValuesOf('currency')
      : [...FALLBACK_CURRENCY_CODES];
    knownCurrencyCodes = new Set(codes.map((c) => c.toUpperCase()));
  }
  return knownCurrencyCodes.has(code);
}

export function supportedCurrencyCodes(): CurrencyCode[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] };
  const codes = typeof intl.supportedValuesOf === 'function'
    ? intl.supportedValuesOf('currency')
    : [...FALLBACK_CURRENCY_CODES];

  return Array.from(new Set([...POPULAR_CURRENCY_CODES, ...codes]))
    .map((code) => code.toUpperCase())
    .filter(isCurrencyCode)
    .sort((a, b) => {
      const ai = POPULAR_CURRENCY_CODES.indexOf(a as (typeof POPULAR_CURRENCY_CODES)[number]);
      const bi = POPULAR_CURRENCY_CODES.indexOf(b as (typeof POPULAR_CURRENCY_CODES)[number]);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    });
}

export function isCurrencyCode(code: string | null | undefined): code is CurrencyCode {
  if (!code || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).format(1);
    return true;
  } catch {
    return false;
  }
}
