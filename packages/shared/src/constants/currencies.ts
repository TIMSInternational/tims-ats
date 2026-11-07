export const DEFAULT_CURRENCY = 'USD';
export const PLATFORM_BILLING_CURRENCY = 'USD';

// The pilot countries' currencies first (Costa Rica, Guatemala, Honduras, Nicaragua, Panama, Dominican
// Republic), then the rest of the Americas and the common reserve currencies. Every code here is also in
// the FX refresh seed (C# RefreshFxRatesUseCase.SeedQuoteCurrencies) so conversions work from day one.
export const POPULAR_CURRENCY_CODES = [
  'CRC',
  'GTQ',
  'HNL',
  'NIO',
  'PAB',
  'DOP',
  'COP',
  'USD',
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
 * Currencies whose salaries are typed, stored and shown as WHOLE numbers in this product (no minor unit):
 * the Costa Rican colón, the Colombian and Chilean pesos, the yen, the won, the guaraní and the đồng. The salary
 * inputs refuse decimals for them and the server rounds a stored vacancy salary to an integer. A demo offer of
 * CRC 1 000 000 / month was stored as 12 000 000.12 when an arrow-key step turned it into 1 000 000.01.
 */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ['COP', 'CRC', 'CLP', 'JPY', 'KRW', 'PYG', 'VND'];

export function isZeroDecimalCurrency(code: string | null | undefined): boolean {
  return ZERO_DECIMAL_CURRENCIES.includes((code ?? '').trim().toUpperCase());
}

export function normalizeCurrencyCode(code: string | null | undefined, fallback = DEFAULT_CURRENCY): CurrencyCode {
  const normalized = (code ?? '').trim().toUpperCase();
  return isCurrencyCode(normalized) ? normalized : fallback;
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

const LISTED_CURRENCY_CODES: ReadonlySet<string> = new Set(FALLBACK_CURRENCY_CODES);

/**
 * True only for a code on the platform's ISO 4217 list (the same list as C# CurrencyCodes). Stricter than
 * isCurrencyCode, which accepts any well-formed code Intl will format (Intl does not reject "XYZ").
 */
export function isListedCurrencyCode(code: string | null | undefined): code is CurrencyCode {
  return typeof code === 'string' && LISTED_CURRENCY_CODES.has(code);
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
