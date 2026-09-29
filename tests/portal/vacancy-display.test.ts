import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  enumLabel,
  formatPortalSalary,
  formatTimeAgo,
  parsePortalSalary,
  salaryPeriodLabel,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/_lib/vacancy-display';

describe('portal salary display', () => {
  it('renders a monthly salary as "/ mes" with es-CO grouping and the currency code', () => {
    const salary = parsePortalSalary({ min: 4500000, max: 6000000, currency: 'COP', period: 'monthly' });
    expect(salary).not.toBeNull();
    expect(formatPortalSalary(salary!, 'ES', es.portal)).toBe('COP 4.500.000 – 6.000.000 / mes');
  });

  it('renders a yearly salary as "/ año" (es) and "/ year" with en grouping', () => {
    const salary = parsePortalSalary({ min: 90000, max: 120000, currency: 'usd', period: 'yearly' })!;
    expect(formatPortalSalary(salary, 'ES', es.portal)).toBe('USD 90.000 – 120.000 / año');
    expect(formatPortalSalary(salary, 'EN', en.portal)).toBe('USD 90,000 – 120,000 / year');
  });

  it('never invents a period: a salary without one shows only the amount', () => {
    const salary = parsePortalSalary({ min: 3000000, currency: 'COP' })!;
    expect(salaryPeriodLabel(salary.period, es.portal)).toBeNull();
    expect(formatPortalSalary(salary, 'ES', es.portal)).toBe('Desde COP 3.000.000');
  });

  it('handles an upper bound only and a missing currency', () => {
    const salary = parsePortalSalary({ max: 5000000, period: 'monthly' })!;
    expect(formatPortalSalary(salary, 'ES', es.portal)).toBe('Hasta 5.000.000 / mes');
  });

  it('treats missing, empty, malformed or zero salaries as no salary', () => {
    expect(parsePortalSalary(null)).toBeNull();
    expect(parsePortalSalary({})).toBeNull();
    expect(parsePortalSalary({ min: 0, max: 0, currency: 'COP' })).toBeNull();
    expect(parsePortalSalary({ min: '5000', currency: 'COP' })).toBeNull();
    expect(parsePortalSalary([1, 2])).toBeNull();
  });

  it('drops a currency that is not a 3-letter code rather than rendering it', () => {
    const salary = parsePortalSalary({ min: 100, currency: '<b>X</b>', period: 'monthly' })!;
    expect(salary.currency).toBeUndefined();
  });
});

describe('portal enum labels', () => {
  it('maps contract type and remote policy enum values to localized labels', () => {
    expect(enumLabel('indefinido', es.portal.contractTypes)).toBe('Término indefinido');
    expect(enumLabel('indefinido', en.portal.contractTypes)).toBe('Permanent');
    expect(enumLabel('onsite', es.portal.remotePolicies)).toBe('Presencial');
    expect(enumLabel('hybrid', es.portal.remotePolicies)).toBe('Híbrido');
  });

  it('shows free-form legacy values as typed and hides empty ones', () => {
    expect(enumLabel('Contrato especial', es.portal.contractTypes)).toBe('Contrato especial');
    expect(enumLabel('toString', es.portal.contractTypes)).toBe('toString');
    expect(enumLabel(null, es.portal.contractTypes)).toBeNull();
  });
});

describe('portal relative dates', () => {
  const now = Date.parse('2026-09-29T12:00:00Z');
  it('uses accented Spanish copy', () => {
    expect(formatTimeAgo('2026-09-26T12:00:00Z', es.portal, now)).toBe('Hace 3 días');
    expect(formatTimeAgo('2026-09-29T08:00:00Z', es.portal, now)).toBe('Hoy');
    expect(formatTimeAgo('2026-09-15T12:00:00Z', en.portal, now)).toBe('2 weeks ago');
  });
});
