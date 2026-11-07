import { describe, expect, it } from 'vitest';
import { ZERO_DECIMAL_CURRENCIES, isZeroDecimalCurrency } from '@tims/shared';
import {
  checkSalaryRange,
  formatMoneyAmount,
  normalizeMoneyText,
  parseMoneyAmount,
} from '../../apps/web/lib/money-amount';

// apps/web/lib/money-amount.ts — the one parser behind every typed salary (vacancy wizard, vacancy edit drawer,
// offer create/edit). Pilot call audit 2026-11-05: a demo offer of CRC 1 000 000 / month was stored as
// 12 000 000.12 because <input type="number" step="0.01"> let an arrow key make it 1 000 000.01.

const ok = (value: number) => ({ kind: 'ok', value });
const err = (error: string) => ({ kind: 'error', error });

describe('parseMoneyAmount — digit grouping, as people write amounts', () => {
  it.each([
    ['1000000', 1_000_000],
    ['1,000,000', 1_000_000],
    ['1.000.000', 1_000_000],
    ['1 000 000', 1_000_000],
    ['1 000 000', 1_000_000], // es-CR groups with a non-breaking space (what the input shows)
    ['1 000 000', 1_000_000], // narrow no-break space (fr-style)
    ['  850000  ', 850_000],
    ['1.000', 1_000], // one mark + exactly 3 digits = grouping
    ['1,000', 1_000],
    ['12.345.678', 12_345_678],
    ['0', 0],
    ['007', 7],
  ])('CRC %j → %d', (text, value) => {
    expect(parseMoneyAmount(text, 'CRC')).toEqual(ok(value));
  });

  it.each([
    ['1500.5', 1500.5],
    ['1500,5', 1500.5],
    ['1500.50', 1500.5],
    ['1500,50', 1500.5],
    ['1,000,000.50', 1_000_000.5],
    ['1.000.000,50', 1_000_000.5],
    ['1 000 000,50', 1_000_000.5],
    ['1 234,05', 1234.05],
    ['1,000', 1000], // 3 digits after a single mark: thousands, never 1.0
    ['2500', 2500],
  ])('USD %j → %d (the last mark followed by 1–2 digits is the decimal one)', (text, value) => {
    expect(parseMoneyAmount(text, 'USD')).toEqual(ok(value));
  });

  it('an empty or blank field is empty, not 0', () => {
    expect(parseMoneyAmount('', 'CRC')).toEqual({ kind: 'empty' });
    expect(parseMoneyAmount('   ', 'USD')).toEqual({ kind: 'empty' });
    expect(parseMoneyAmount(' ', 'USD')).toEqual({ kind: 'empty' });
  });
});

describe('parseMoneyAmount — refusals', () => {
  it.each([
    'abc',
    '1e6',
    '-1000',
    '+1000',
    '₡1000',
    '1000 CRC',
    '1..000',
    '1,,000',
    '1. 000',
    '1,00,000', // Indian grouping is not ours
    '1,0000',
    '1000.000', // 4 digits before a grouping mark
    '1.000,000', // both marks, the last with 3 digits
    '1,000.000',
    '1.000.50', // a mark used twice cannot be decimal
    '12.3456',
    '.5',
    '5.',
    '1 000.000', // two kinds of grouping
    '0x10',
    'NaN',
    'Infinity',
  ])('%j is invalid', (text) => {
    expect(parseMoneyAmount(text, 'USD')).toEqual(err('invalid'));
  });

  it('a zero-decimal currency takes whole numbers only (",00" is still whole)', () => {
    expect(parseMoneyAmount('1000000,01', 'CRC')).toEqual(err('decimals'));
    expect(parseMoneyAmount('1 000 000,5', 'CRC')).toEqual(err('decimals'));
    expect(parseMoneyAmount('1500.50', 'COP')).toEqual(err('decimals'));
    expect(parseMoneyAmount('1.000.000,00', 'CRC')).toEqual(ok(1_000_000));
    expect(parseMoneyAmount('1000,0', 'crc')).toEqual(ok(1000)); // the code is case-insensitive
    expect(parseMoneyAmount('1000000,01', 'USD')).toEqual(ok(1_000_000.01));
  });

  it('caps the value (max) and refuses more than 15 integer digits', () => {
    expect(parseMoneyAmount('1 000 001', 'CRC', { max: 1_000_000 })).toEqual(err('tooLarge'));
    expect(parseMoneyAmount('1 000 000', 'CRC', { max: 1_000_000 })).toEqual(ok(1_000_000));
    expect(parseMoneyAmount('1234567890123456', 'USD')).toEqual(err('tooLarge'));
    expect(parseMoneyAmount('123456789012345', 'USD')).toEqual(ok(123_456_789_012_345));
  });
});

describe('formatMoneyAmount / normalizeMoneyText — what the input shows', () => {
  it('groups digits in es-CR (non-breaking space) and never shows decimals for CRC', () => {
    expect(formatMoneyAmount(1_000_000, 'CRC')).toBe('1 000 000');
    expect(formatMoneyAmount(850_000, 'CRC')).toBe('850 000');
    expect(formatMoneyAmount(1234.5, 'USD')).toBe('1 234,50');
    expect(formatMoneyAmount(2500, 'USD')).toBe('2 500');
  });

  it('round-trips: what it shows parses back to the same amount', () => {
    for (const [value, currency] of [
      [1_000_000, 'CRC'],
      [12_000_000, 'CRC'],
      [999, 'COP'],
      [1234.5, 'USD'],
      [0.5, 'EUR'],
      [1_000_000.01, 'USD'],
    ] as const) {
      expect(parseMoneyAmount(formatMoneyAmount(value, currency), currency)).toEqual(ok(value));
    }
  });

  it('normalizes a valid entry on blur and leaves an invalid one as typed', () => {
    expect(normalizeMoneyText('1000000', 'CRC')).toBe('1 000 000');
    expect(normalizeMoneyText('1.000.000', 'CRC')).toBe('1 000 000');
    expect(normalizeMoneyText('1..000', 'CRC')).toBe('1..000');
    expect(normalizeMoneyText('1000,5', 'CRC')).toBe('1000,5');
    expect(normalizeMoneyText('', 'CRC')).toBe('');
  });
});

describe('checkSalaryRange', () => {
  it('min > max is an error; min below a tenth of max is a soft warning', () => {
    expect(checkSalaryRange(900_000, 650_000)).toEqual({ error: 'minAboveMax', wide: false });
    expect(checkSalaryRange(650_000, 900_000)).toEqual({ error: null, wide: false });
    expect(checkSalaryRange(85_000, 1_200_000)).toEqual({ error: null, wide: true });
    expect(checkSalaryRange(120_000, 1_200_000)).toEqual({ error: null, wide: false }); // exactly a tenth
    expect(checkSalaryRange(500_000, 500_000)).toEqual({ error: null, wide: false });
  });

  it('a missing bound checks nothing', () => {
    expect(checkSalaryRange(undefined, 1_000)).toEqual({ error: null, wide: false });
    expect(checkSalaryRange(1_000, undefined)).toEqual({ error: null, wide: false });
  });
});

describe('the zero-decimal list is the one offer-salary.ts used', () => {
  it('keeps the seven currencies and is case-insensitive', () => {
    expect([...ZERO_DECIMAL_CURRENCIES].sort()).toEqual(['CLP', 'COP', 'CRC', 'JPY', 'KRW', 'PYG', 'VND']);
    expect(isZeroDecimalCurrency(' crc ')).toBe(true);
    expect(isZeroDecimalCurrency('USD')).toBe(false);
    expect(isZeroDecimalCurrency(null)).toBe(false);
  });
});
