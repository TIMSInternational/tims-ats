import { describe, expect, it } from 'vitest';
import es from '../../apps/web/lib/i18n/es.json';
import en from '../../apps/web/lib/i18n/en.json';
import {
  enumLabel,
  formatPortalSalary,
  formatTimeAgo,
  parsePortalSalary,
  profileItemLabels,
  salaryPeriodLabel,
} from '../../apps/web/app/(portal)/careers/[orgSlug]/_lib/vacancy-display';

// Intl separates es-CR digit groups with a (narrow) no-break space; compare on plain spaces.
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, ' ');

describe('portal salary display', () => {
  it('renders colones with the ₡ symbol and es-CR grouping, monthly as "/ mes"', () => {
    const salary = parsePortalSalary({ min: 4500000, max: 6000000, currency: 'CRC', period: 'monthly' });
    expect(salary).not.toBeNull();
    expect(plain(formatPortalSalary(salary!, 'ES', es.portal))).toBe('₡4 500 000 – ₡6 000 000 / mes');
  });

  it('keeps the ISO code for any other currency (never a bare "$"), "/ año" (es) and "/ year" (en)', () => {
    const salary = parsePortalSalary({ min: 90000, max: 120000, currency: 'usd', period: 'yearly' })!;
    expect(plain(formatPortalSalary(salary, 'ES', es.portal))).toBe('USD 90 000 – USD 120 000 / año');
    expect(plain(formatPortalSalary(salary, 'EN', en.portal))).toBe('USD 90,000 – USD 120,000 / year');
    expect(formatPortalSalary(salary, 'EN', en.portal)).not.toContain('$');
  });

  it('never formats with Colombian conventions (es-CO dot grouping)', () => {
    const salary = parsePortalSalary({ min: 3000000, currency: 'COP' })!;
    expect(formatPortalSalary(salary, 'ES', es.portal)).not.toContain('3.000.000');
  });

  it('never invents a period: a salary without one shows only the amount', () => {
    const salary = parsePortalSalary({ min: 3000000, currency: 'CRC' })!;
    expect(salaryPeriodLabel(salary.period, es.portal)).toBeNull();
    expect(plain(formatPortalSalary(salary, 'ES', es.portal))).toBe('Desde ₡3 000 000');
  });

  it('handles an upper bound only and a missing currency', () => {
    const salary = parsePortalSalary({ max: 5000000, period: 'monthly' })!;
    expect(plain(formatPortalSalary(salary, 'ES', es.portal))).toBe('Hasta 5 000 000 / mes');
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
    // Costa Rican labels for the stored (unchanged) contract-type slugs.
    expect(enumLabel('indefinido', es.portal.contractTypes)).toBe('Plazo indefinido');
    expect(enumLabel('termino_fijo', es.portal.contractTypes)).toBe('Plazo fijo');
    expect(enumLabel('obra_labor', es.portal.contractTypes)).toBe('Por obra determinada');
    expect(enumLabel('prestacion', es.portal.contractTypes)).toBe('Servicios profesionales');
    expect(Object.values(es.portal.contractTypes).join(' ')).not.toMatch(/Término|Obra o labor|Prestación de servicios/);
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

describe('job profile list items', () => {
  it('renders the stored { text } / { name } objects and legacy strings — never "[object Object]"', () => {
    expect(profileItemLabels([{ text: 'Excel avanzado', isRequired: true }, 'Inglés B2', { text: ' ' }], 'text')).toEqual([
      'Excel avanzado',
      'Inglés B2',
    ]);
    expect(profileItemLabels([{ name: 'Liderazgo', level: 4 }, { level: 2 }, 7, null], 'name')).toEqual(['Liderazgo']);
    expect(profileItemLabels(null, 'text')).toEqual([]);
    expect(profileItemLabels({ text: 'x' }, 'text')).toEqual([]);
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
