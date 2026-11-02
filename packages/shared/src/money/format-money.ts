import { parseCurrencyCode } from '../constants/currencies';

// The one money formatter for recruiter and candidate surfaces (WP-09).
// Decision D-A: in es, use the tenant locale (es-CR for a Costa Rican tenant); the
// locale's home currency shows its symbol, other currencies show their ISO code.

export type MoneyUi = 'es' | 'en';
export type MoneyDisplay = 'symbol' | 'code' | 'auto';

/**
 * Currencies shown without decimals. CRC is display-only: ISO lists 2 minor units,
 * but colón amounts are not written with céntimos. The rest is the ISO zero-exponent set.
 */
export const DISPLAY_ZERO_DECIMAL: ReadonlySet<string> = new Set([
  'CRC',
  'COP',
  'CLP',
  'JPY',
  'KRW',
  'PYG',
  'VND',
  'ISK',
  'HUF',
  'UGX',
  'XAF',
  'XOF',
  'BIF',
  'DJF',
  'GNF',
  'KMF',
  'RWF',
  'VUV',
  'XPF',
]);

/** The es locale a currency is written in when the tenant has no locale. */
export const CURRENCY_HOME_LOCALE: Readonly<Record<string, string>> = {
  CRC: 'es-CR',
  COP: 'es-CO',
  MXN: 'es-MX',
  ARS: 'es-AR',
  CLP: 'es-CL',
  PEN: 'es-PE',
  GTQ: 'es-GT',
  HNL: 'es-HN',
  NIO: 'es-NI',
  DOP: 'es-DO',
  UYU: 'es-UY',
  PYG: 'es-PY',
  BOB: 'es-BO',
  VES: 'es-VE',
};

/** The currency each locale treats as its own (shown with its symbol in auto mode). */
const LOCALE_HOME_CURRENCY: Readonly<Record<string, string>> = {
  'en-US': 'USD',
  'es-US': 'USD',
  'es-PA': 'PAB',
  'es-SV': 'USD',
  'es-EC': 'USD',
  'es-PR': 'USD',
  'es-ES': 'EUR',
  ...Object.fromEntries(Object.entries(CURRENCY_HOME_LOCALE).map(([code, locale]) => [locale, code])),
};

export const DEFAULT_MONEY_LOCALE = 'es-CR';
const NOT_A_NUMBER = '—';
const NBSP = /[  ]/g;

export function moneyLocaleFor(currency: string, ui: MoneyUi, tenantLocale?: string | null): string {
  if (ui === 'en') return 'en-US';
  const tenant = tenantLocale?.trim();
  if (tenant && isSupportedLocale(tenant)) return tenant;
  const code = parseCurrencyCode(currency);
  return (code && CURRENCY_HOME_LOCALE[code]) || DEFAULT_MONEY_LOCALE;
}

export interface FormatMoneyOptions {
  ui?: MoneyUi;
  tenantLocale?: string | null;
  display?: MoneyDisplay;
  fractionDigits?: number;
}

export function formatMoney(amount: number, currency: string, opts: FormatMoneyOptions = {}): string {
  if (!Number.isFinite(amount)) return NOT_A_NUMBER;
  const ui = opts.ui ?? 'es';
  const code = parseCurrencyCode(currency);
  const locale = moneyLocaleFor(currency, ui, opts.tenantLocale);

  if (!code) {
    // Unknown code: show it verbatim next to plain digits, never as a guessed USD.
    const digits = new Intl.NumberFormat(locale, {
      minimumFractionDigits: opts.fractionDigits ?? 0,
      maximumFractionDigits: opts.fractionDigits ?? 2,
    }).format(amount);
    const label = currency.trim();
    return clean(label ? `${label} ${digits}` : digits);
  }

  const display = opts.display ?? 'auto';
  const useSymbol = display === 'symbol' || (display === 'auto' && homeCurrencyOf(locale) === code);
  const digits = opts.fractionDigits ?? (DISPLAY_ZERO_DECIMAL.has(code) ? 0 : isoMinorUnits(code));
  return clean(
    new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      currencyDisplay: useSymbol ? 'narrowSymbol' : 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount),
  );
}

/** The ISO minor units Intl knows for a currency (2 for USD, 3 for KWD). */
function isoMinorUnits(code: string): number {
  return (
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function homeCurrencyOf(locale: string): string | undefined {
  return LOCALE_HOME_CURRENCY[locale];
}

function isSupportedLocale(locale: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

function clean(out: string): string {
  return out.replace(NBSP, ' ');
}
