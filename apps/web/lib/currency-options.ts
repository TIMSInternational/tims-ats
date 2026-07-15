import { POPULAR_CURRENCY_CODES, supportedCurrencyCodes } from '@tims/shared';

const displayNames = typeof Intl.DisplayNames === 'function'
  ? new Intl.DisplayNames(['es'], { type: 'currency' })
  : null;

export function currencyOptions(): Array<{ code: string; label: string; popular: boolean }> {
  const popular = new Set<string>(POPULAR_CURRENCY_CODES);
  return supportedCurrencyCodes().map((code) => ({
    code,
    label: `${code} - ${displayNames?.of(code) ?? code}`,
    popular: popular.has(code),
  }));
}
