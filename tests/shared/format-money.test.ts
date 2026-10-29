import { describe, it, expect } from 'vitest';
import { formatMoney, moneyLocaleFor } from '@tims/shared';

// WP-09 PR-1. Findings: company-admin-data-66 / hiring-team-data-58 / recruiter-data-82
// (four formatters, never es-CR, CRC shown with fake cents) and platform-owner-data-69 /
// company-admin-data-64 (an unknown code is relabelled as USD). formatMoney is the one
// formatter PR-2 makes every recruiter and candidate surface delegate to.

const NBSP = /[  ]/;

describe('moneyLocaleFor', () => {
  it('uses en-US for the en UI', () => {
    expect(moneyLocaleFor('CRC', 'en')).toBe('en-US');
  });

  it('prefers the tenant locale, then the currency home locale, then es-CR', () => {
    expect(moneyLocaleFor('USD', 'es', 'es-CR')).toBe('es-CR');
    expect(moneyLocaleFor('CRC', 'es')).toBe('es-CR');
    expect(moneyLocaleFor('COP', 'es')).toBe('es-CO');
    expect(moneyLocaleFor('XYZ', 'es')).toBe('es-CR');
  });
});

describe('formatMoney', () => {
  it('formats CRC in es as ₡ with es-CR grouping and no céntimos', () => {
    expect(formatMoney(1500000.4, 'CRC', { ui: 'es' })).toBe('₡1 500 000');
  });

  it('pins Intl half-up rounding for CRC (1500000.5 → ₡1 500 001)', () => {
    expect(formatMoney(1500000.5, 'CRC', { ui: 'es' })).toBe('₡1 500 001');
  });

  it('formats COP in es with es-CO grouping and its home symbol', () => {
    expect(formatMoney(1500000, 'COP', { ui: 'es' })).toBe('$ 1.500.000');
    expect(formatMoney(1500000, 'COP', { ui: 'es', display: 'code' })).toBe('COP 1.500.000');
  });

  it('shows a foreign currency as its code in auto mode', () => {
    expect(formatMoney(1500, 'USD', { ui: 'es', tenantLocale: 'es-CR' })).toBe('USD 1 500,00');
    expect(formatMoney(1500, 'USD', { ui: 'es', tenantLocale: 'es-CO' })).toBe('USD 1.500,00');
    expect(formatMoney(1500, 'EUR', { ui: 'en' })).toBe('EUR 1,500.00');
  });

  it('uses en-US for the en UI', () => {
    expect(formatMoney(1500, 'USD', { ui: 'en' })).toBe('$1,500.00');
    expect(formatMoney(1500000.4, 'CRC', { ui: 'en' })).toBe('CRC 1,500,000');
  });

  it('accepts a lower-case code', () => {
    expect(formatMoney(850000, 'crc', { ui: 'es' })).toBe('₡850 000');
  });

  it('shows an unknown code verbatim and never as USD', () => {
    const out = formatMoney(1500000, 'colones', { ui: 'es' });
    expect(out).toBe('colones 1 500 000');
    expect(out).not.toMatch(/USD|US\$/);
  });

  it.each([NaN, Infinity, -Infinity])('renders the non-finite amount %s as —', (v) => {
    expect(formatMoney(v, 'CRC', { ui: 'es' })).toBe('—');
  });

  it('never emits a non-breaking space', () => {
    for (const out of [
      formatMoney(1500000, 'CRC', { ui: 'es' }),
      formatMoney(1500, 'USD', { ui: 'es', tenantLocale: 'es-CR' }),
      formatMoney(1500000, 'COP', { ui: 'es' }),
      formatMoney(1500000, 'colones', { ui: 'es' }),
    ]) {
      expect(out).not.toMatch(NBSP);
    }
  });
});
