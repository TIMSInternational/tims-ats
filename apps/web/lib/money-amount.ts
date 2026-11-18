// Money amounts typed by staff (vacancy salary band, offer salary). Pure module (no React) so node tests can
// exercise it; the input that uses it is components/money-input.tsx.
//
// Why: the salary fields were <input type="number">: no digit grouping, a mouse wheel or an arrow key stepped the
// value (a demo offer of CRC 1 000 000 / month became 1 000 000.01, stored as 12 000 000.12 a year), and
// "1.000.000" was either refused or read as 1. People type amounts the way they write them, so the parser accepts
// digit grouping with commas, dots or spaces and decides which separator (if any) is the decimal one:
//   - a space (any Unicode space, incl. the es-CR non-breaking one) only ever groups digits;
//   - with both "." and ",", the LAST one is the decimal separator ("1,000,000.50", "1.000.000,50");
//   - with one kind used once, it is decimal when 1–2 digits follow ("1500,5", "1500.50") and grouping when
//     exactly 3 follow ("1,000", "1.000" = one thousand);
//   - the same kind used more than once only groups ("1.000.000", "1,000,000");
//   - grouping must be well formed: 1–3 leading digits, then groups of exactly 3, one kind of separator.
// Zero-decimal currencies (@tims/shared ZERO_DECIMAL_CURRENCIES: CRC, COP…) take whole numbers only: a fraction
// other than ",00" is refused. Anything else (letters, signs, "1..000", "1,00,000", "12.3456") is invalid.

import { isZeroDecimalCurrency } from '@tims/shared';
import { TENANT_LOCALE } from './tenant-locale';

export type MoneyAmountError = 'invalid' | 'decimals' | 'tooLarge';
export type MoneyAmountParse =
  | { kind: 'empty' }
  | { kind: 'ok'; value: number }
  | { kind: 'error'; error: MoneyAmountError };

/** 15 significant integer digits: every value stays an exact integer in a JS number. */
const MAX_INTEGER_DIGITS = 15;
const SPACES = /[\s    ]/g;

function groupsAreWellFormed(integer: string, separator: string | null): boolean {
  if (separator === null) return /^\d+$/.test(integer);
  const groups = integer.split(separator);
  return /^\d{1,3}$/.test(groups[0] ?? '') && groups.slice(1).every((group) => /^\d{3}$/.test(group));
}

/**
 * Parses what the person typed into a non-negative amount in `currency`. `max` (optional) caps the value;
 * a larger one is `tooLarge`.
 */
export function parseMoneyAmount(text: string, currency: string, options: { max?: number } = {}): MoneyAmountParse {
  const raw = text.replace(SPACES, ' ').trim();
  if (raw === '') return { kind: 'empty' };
  if (!/^\d[\d., ]*$/.test(raw) || !/\d$/.test(raw) || /[., ]{2,}/.test(raw))
    return { kind: 'error', error: 'invalid' };

  const lastMark = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  let integer = raw;
  let fraction = '';
  if (lastMark !== -1) {
    const mark = raw[lastMark]!;
    const after = raw.slice(lastMark + 1);
    const usedOnce = raw.indexOf(mark) === lastMark;
    const decimalShaped = usedOnce && /^\d{1,2}$/.test(after);
    // Both "." and ",": the last one MUST be the decimal separator ("1,000.000" is not an amount).
    if (raw.includes(mark === '.' ? ',' : '.') && !decimalShaped) return { kind: 'error', error: 'invalid' };
    if (decimalShaped) {
      integer = raw.slice(0, lastMark);
      fraction = after;
    }
  }

  const separators = new Set(integer.replace(/\d/g, '').split(''));
  if (separators.size > 1) return { kind: 'error', error: 'invalid' };
  const [separator] = [...separators];
  if (!groupsAreWellFormed(integer, separator ?? null)) return { kind: 'error', error: 'invalid' };

  const digits = integer.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (digits.length > MAX_INTEGER_DIGITS) return { kind: 'error', error: 'tooLarge' };
  if (fraction && isZeroDecimalCurrency(currency) && /[1-9]/.test(fraction))
    return { kind: 'error', error: 'decimals' };

  const value = isZeroDecimalCurrency(currency) ? Number(digits) : Number(fraction ? `${digits}.${fraction}` : digits);
  if (!Number.isFinite(value)) return { kind: 'error', error: 'invalid' };
  if (options.max !== undefined && value > options.max) return { kind: 'error', error: 'tooLarge' };
  return { kind: 'ok', value };
}

/** Grouped digits in the tenant locale ("1 000 000", "1 234,50"), without the currency; what the input shows. */
export function formatMoneyAmount(value: number, currency: string, locale = TENANT_LOCALE): string {
  const whole = isZeroDecimalCurrency(currency) || Number.isInteger(value);
  return new Intl.NumberFormat(locale, {
    useGrouping: true,
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/** The text an input should show after the person leaves it: the grouped amount, or what they typed when invalid. */
export function normalizeMoneyText(text: string, currency: string): string {
  const parsed = parseMoneyAmount(text, currency);
  return parsed.kind === 'ok' ? formatMoneyAmount(parsed.value, currency) : text;
}

/** Below this ratio of max the band is suspicious (e.g. 85 000 – 1 200 000): a soft warning to confirm. */
export const WIDE_RANGE_RATIO = 10;

export type SalaryRangeCheck = { error: 'minAboveMax' | null; wide: boolean };

/** min > max is an error; min < max / 10 is a warning the person can confirm. Missing bounds check nothing. */
export function checkSalaryRange(min: number | undefined, max: number | undefined): SalaryRangeCheck {
  if (min === undefined || max === undefined) return { error: null, wide: false };
  if (min > max) return { error: 'minAboveMax', wide: false };
  return { error: null, wide: min * WIDE_RANGE_RATIO < max };
}

/** The amount, or undefined when empty or invalid (callers validate first). */
export function moneyValue(text: string, currency: string): number | undefined {
  const parsed = parseMoneyAmount(text, currency);
  return parsed.kind === 'ok' ? parsed.value : undefined;
}

export type SalaryBandStatus = {
  min: number | undefined;
  max: number | undefined;
  /** Either bound is not a valid amount in the currency. */
  invalid: boolean;
  range: SalaryRangeCheck;
  /** Identifies the parsed band, so a "the range is correct" confirmation lapses when the amounts change. */
  rangeKey: string;
};

/** Everything a salary band form needs to validate before it can be saved. */
export function salaryBandStatus(minText: string, maxText: string, currency: string): SalaryBandStatus {
  const minParse = parseMoneyAmount(minText, currency);
  const maxParse = parseMoneyAmount(maxText, currency);
  const min = minParse.kind === 'ok' ? minParse.value : undefined;
  const max = maxParse.kind === 'ok' ? maxParse.value : undefined;
  return {
    min,
    max,
    invalid: minParse.kind === 'error' || maxParse.kind === 'error',
    range: checkSalaryRange(min, max),
    rangeKey: `${min ?? ''}-${max ?? ''}`,
  };
}

/** The band cannot be saved: an invalid amount, min above max, or a wide band not confirmed for these amounts. */
export function isSalaryBandBlocked(status: SalaryBandStatus, confirmedRangeKey: string | null): boolean {
  return status.invalid || status.range.error !== null || (status.range.wide && confirmedRangeKey !== status.rangeKey);
}
