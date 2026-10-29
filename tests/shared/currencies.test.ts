import { describe, it, expect } from 'vitest';
import { POPULAR_CURRENCY_CODES, supportedCurrencyCodes, parseCurrencyCode, normalizeCurrencyCode } from '@tims/shared';

// WP-09 PR-1. Findings: company-admin-spec-38, recruiter-spec-52, recruiter-data-76
// (CRC is not a popular choice) and platform-owner-data-69 / company-admin-data-64
// (an unknown code is silently relabelled as USD). The pickers read the popular list
// first, so a Costa Rican tenant must find CRC at the top, and a strict parser must
// return null instead of inventing USD.

describe('POPULAR_CURRENCY_CODES', () => {
  it('includes CRC', () => {
    expect(POPULAR_CURRENCY_CODES).toContain('CRC');
  });

  it('puts CRC first, then USD, in supportedCurrencyCodes()', () => {
    const codes = supportedCurrencyCodes();
    expect(codes[0]).toBe('CRC');
    expect(codes[1]).toBe('USD');
  });

  it('offers every code parseCurrencyCode accepts, including fund codes', () => {
    expect(supportedCurrencyCodes()).toEqual(expect.arrayContaining(['CLF', 'UYW', 'VED']));
  });
});

describe('parseCurrencyCode', () => {
  it('trims and upper-cases a valid ISO code', () => {
    expect(parseCurrencyCode('crc ')).toBe('CRC');
    expect(parseCurrencyCode(' usd')).toBe('USD');
  });

  it.each(['colones', '₡', '', '   ', 'ZZZ', 'US', null, undefined])(
    'returns null for %j and never falls back to USD',
    (raw) => {
      expect(parseCurrencyCode(raw)).toBeNull();
    },
  );

  // Intl.supportedValuesOf('currency') omits ISO-4217 fund codes (CLF, UYW, ...) and VED,
  // so the strict parser must not use it as the whole allowlist.
  it.each(['CLF', 'UYW', 'UYI', 'BOV', 'CHE', 'CHW', 'COU', 'MXV', 'USN', 'VED'])(
    'accepts the ISO-4217 code %s that Intl does not list',
    (raw) => {
      expect(parseCurrencyCode(raw.toLowerCase())).toBe(raw);
    },
  );

  it.each(['XXX', 'XTS'])('rejects the non-currency ISO code %s', (raw) => {
    expect(parseCurrencyCode(raw)).toBeNull();
  });
});

describe('normalizeCurrencyCode (unchanged, still used by the FX parity twins)', () => {
  it('keeps its documented USD fallback', () => {
    expect(normalizeCurrencyCode('colones')).toBe('USD');
    expect(normalizeCurrencyCode('crc')).toBe('CRC');
  });
});
