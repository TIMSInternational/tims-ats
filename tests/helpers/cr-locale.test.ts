import { describe, it, expect } from 'vitest';
import { CR, crMoney, crDateTime, crDate, bogotaRendering, crSalaryTermsMonthly } from './cr-locale';
import { CR as FIXTURE_CR } from '../../e2e/fixtures/cr-tenant';

// WP-02 PR-2: Costa Rica locale builders shared by vitest and the e2e specs.
//
// These literals are PINNED on purpose. A Node or ICU upgrade that changes how es-CR
// money or dates render must turn this file red, so the drift is decided by a person
// instead of silently changing every assertion that builds on these helpers.
// Separators are written as escapes so the exact code point is reviewable:
//   \u00a0 = NO-BREAK SPACE (es-CR thousands separator in ICU 78).
//
// Mutation proof (run once, revert): swap the helper's timeZone to 'America/Bogota'.
// The 08:30 case must fail, because Bogota is UTC-5 and renders 14:30Z as 09:30.

describe('CR re-export', () => {
  it('re-exports the fixture constants, not a copy', () => {
    expect(CR).toBe(FIXTURE_CR);
    expect(CR.company.currency).toBe('CRC');
    expect(CR.company.timezone).toBe('America/Costa_Rica');
    expect(CR.company.country).toBe('CR');
  });
});

describe('crMoney', () => {
  it('formats colones with two decimals by default (pinned literal)', () => {
    expect(crMoney(1_050_000)).toBe('\u20a11\u00a0050\u00a0000,00');
  });

  it('formats whole colones when decimals is 0 (pinned literal)', () => {
    expect(crMoney(850_000, { decimals: 0 })).toBe('\u20a1850\u00a0000');
  });

  it('never renders the dollar sign or a Colombian peso code', () => {
    const out = crMoney(1_100_000);
    expect(out.startsWith('\u20a1')).toBe(true);
    expect(out).not.toMatch(/\$|COP|USD/);
  });

  it('refuses a non-finite amount instead of rendering NaN', () => {
    expect(() => crMoney(Number.NaN)).toThrow();
    expect(() => crMoney(Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('crDateTime', () => {
  const INTERVIEW_UTC = '2026-11-16T14:30:00Z';

  it('renders 14:30Z as 08:30 Costa Rica time (pinned literal)', () => {
    expect(crDateTime(INTERVIEW_UTC)).toBe('16 nov 2026, 08:30');
  });

  it('contains 08:30 and never the Bogota hour 09:30', () => {
    const out = crDateTime(INTERVIEW_UTC);
    expect(out).toContain('08:30');
    expect(out).not.toContain('09:30');
  });

  it('accepts an explicit offset as well as Z', () => {
    expect(crDateTime('2026-11-16T08:30:00-06:00')).toBe('16 nov 2026, 08:30');
  });

  it('refuses a zone-less timestamp, which would be read in the machine time zone', () => {
    expect(() => crDateTime('2026-11-16T14:30:00')).toThrow();
  });

  it('refuses an unparseable timestamp', () => {
    expect(() => crDateTime('not-a-date')).toThrow();
  });

  it('refuses a well-shaped but impossible timestamp (hour 25), not just a malformed one', () => {
    // Passes the zoned-ISO shape check, so only the invalid-date guard can reject it.
    expect(() => crDateTime('2026-11-16T25:00:00Z')).toThrow(/unparseable/);
  });

  it('refuses an overflow calendar day that Date would silently roll into the next month', () => {
    // new Date('2026-02-30T14:30:00Z') is 2026-03-02, a plausible but wrong expected value.
    expect(() => crDateTime('2026-02-30T14:30:00Z')).toThrow(/impossible calendar date/);
    expect(() => crDateTime('2026-04-31T14:30:00Z')).toThrow(/impossible calendar date/);
    expect(() => crDate('2026-02-30T14:30:00Z')).toThrow(/impossible calendar date/);
    expect(() => bogotaRendering('2026-02-30T14:30:00Z')).toThrow(/impossible calendar date/);
  });

  it('refuses February 29 in a non-leap year but accepts it in a leap year', () => {
    expect(() => crDateTime('2026-02-29T14:30:00Z')).toThrow(/impossible calendar date/);
    expect(() => crDateTime('2028-02-29T14:30:00Z')).not.toThrow();
  });

  it('checks the calendar day as written, before any offset is applied', () => {
    // The written day is valid even though the instant falls on the next UTC day.
    expect(() => crDateTime('2026-02-28T23:30:00-06:00')).not.toThrow();
    expect(() => crDateTime('2026-02-30T08:00:00-06:00')).toThrow(/impossible calendar date/);
  });
});

describe('bogotaRendering', () => {
  it('renders the WRONG (Bogota, UTC-5) value used in negative assertions', () => {
    expect(bogotaRendering('2026-11-16T14:30:00Z')).toBe('16 nov 2026, 09:30');
  });

  it('differs from the Costa Rica rendering for the seeded interview', () => {
    const iso = '2026-11-16T14:30:00Z';
    expect(bogotaRendering(iso)).not.toBe(crDateTime(iso));
  });
});

describe('crDate', () => {
  it('uses the Costa Rica calendar day across the 00:00-06:00Z window', () => {
    // 03:00Z on the 17th is 21:00 on the 16th in Costa Rica (UTC-6).
    expect(crDate('2026-11-17T03:00:00Z')).toBe('16 nov 2026');
  });

  it('is still the previous day one second before 06:00Z', () => {
    expect(crDate('2026-11-17T05:59:59Z')).toBe('16 nov 2026');
  });

  it('rolls over to the next day exactly at 06:00Z (Costa Rica midnight)', () => {
    expect(crDate('2026-11-17T06:00:00Z')).toBe('17 nov 2026');
  });

  it('refuses a zone-less timestamp', () => {
    expect(() => crDate('2026-11-17T03:00:00')).toThrow();
  });
});

describe('crSalaryTermsMonthly', () => {
  it('returns the placeholder monthly CRC shape that WP-25 adopts', () => {
    expect(crSalaryTermsMonthly(1_050_000)).toEqual({
      gross: 1_050_000,
      currency: 'CRC',
      period: 'monthly',
      display: '\u20a11\u00a0050\u00a0000,00',
    });
  });

  it('refuses a negative gross salary', () => {
    expect(() => crSalaryTermsMonthly(-1)).toThrow();
  });
});
