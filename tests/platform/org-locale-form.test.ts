import { describe, expect, it } from 'vitest';
import {
  EMPTY_ORG_LOCALE_FORM,
  OTHER_COUNTRY,
  applyCountryChoice,
  localeOptions,
  orgLocaleFormFromOrg,
  orgLocaleFormToProfile,
  orgLocalePatch,
  sanitizeCountryCode,
} from '../../apps/web/lib/org-locale-form';
import { DEFAULT_TENANT_LOCALE, defaultOfferCurrency, resolveTenantLocale } from '../../apps/web/lib/tenant-locale';
import { formatMoneyCode } from '../../apps/web/lib/offer-salary';
import { COMMON_TIME_ZONES } from '../../apps/web/lib/time-zone-options';

const plain = (text: string) => text.replace(/[  ]/g, ' ');

describe('"País y formato regional" form helpers', () => {
  it('a preset country fills time zone, currency and locale; each stays editable', () => {
    const gt = applyCountryChoice(EMPTY_ORG_LOCALE_FORM, 'GT');
    expect(gt).toEqual({
      choice: 'GT',
      country: 'GT',
      timezone: 'America/Guatemala',
      currency: 'GTQ',
      locale: 'es-GT',
    });
    expect(orgLocaleFormToProfile({ ...gt, currency: 'USD' })).toEqual({
      country: 'GT',
      timezone: 'America/Guatemala',
      currency: 'USD',
      locale: 'es-GT',
    });
  });

  it('"Other" keeps the three values, clears a preset country and needs a valid ISO code', () => {
    const other = applyCountryChoice(applyCountryChoice(EMPTY_ORG_LOCALE_FORM, 'MX'), OTHER_COUNTRY);
    expect(other).toMatchObject({
      choice: OTHER_COUNTRY,
      country: '',
      timezone: 'America/Mexico_City',
      currency: 'MXN',
    });
    expect(orgLocaleFormToProfile(other)).toBeNull();
    expect(sanitizeCountryCode('ar1x')).toBe('AR');
    expect(orgLocaleFormToProfile({ ...other, country: 'AR' })).toMatchObject({ country: 'AR', currency: 'MXN' });
  });

  it('nothing is sendable until every field is valid', () => {
    expect(orgLocaleFormToProfile(EMPTY_ORG_LOCALE_FORM)).toBeNull();
    const gt = applyCountryChoice(EMPTY_ORG_LOCALE_FORM, 'GT');
    expect(orgLocaleFormToProfile({ ...gt, timezone: 'Mars/Olympus' })).toBeNull();
    expect(orgLocaleFormToProfile({ ...gt, currency: 'XYZ' })).toBeNull();
    expect(orgLocaleFormToProfile({ ...gt, locale: '' })).toBeNull();
  });

  it('the edit form starts from settings, else the primary company — what the product uses today', () => {
    expect(orgLocaleFormFromOrg({}, { country: 'CR', currency: 'USD', timezone: 'America/Bogota' })).toEqual({
      choice: 'CR',
      country: 'CR',
      timezone: 'America/Bogota',
      currency: 'USD',
      locale: '',
    });
    expect(
      orgLocaleFormFromOrg(
        {
          country: 'GT',
          timezone: 'America/Guatemala',
          currency: 'GTQ',
          locale: 'es-GT',
          candidateContactEmail: 'x@y.z',
        },
        { country: 'CR', currency: 'USD', timezone: 'America/Bogota' },
      ),
    ).toEqual({ choice: 'GT', country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' });
    expect(orgLocaleFormFromOrg(null, { country: 'AR' }).choice).toBe(OTHER_COUNTRY);
    expect(orgLocaleFormFromOrg(null, null)).toEqual(EMPTY_ORG_LOCALE_FORM);
  });

  it('the edit sends only what changed (so a rename writes no settings), and blocks an invalid change', () => {
    const initial = orgLocaleFormFromOrg({}, { country: 'CR', currency: 'USD', timezone: 'America/Bogota' });
    expect(orgLocalePatch(initial, initial)).toEqual({});
    expect(orgLocalePatch(initial, applyCountryChoice(initial, 'GT'))).toEqual({
      locale: 'es-GT',
      timezone: 'America/Guatemala',
      currency: 'GTQ',
      country: 'GT',
    });
    expect(orgLocalePatch(initial, { ...initial, timezone: 'America/Costa_Rica' })).toEqual({
      timezone: 'America/Costa_Rica',
    });
    expect(orgLocalePatch(initial, { ...initial, choice: OTHER_COUNTRY, country: 'A' })).toBeNull();
  });

  it('offers every preset locale plus a non-preset current value, and Chile in the zone picker', () => {
    expect(localeOptions('')).toContain('es-GT');
    expect(localeOptions('pt-BR')[0]).toBe('pt-BR');
    expect(COMMON_TIME_ZONES).toContain('America/Santiago');
  });
});

describe('tenant locale (vacancy and offer defaults, money formatting)', () => {
  it('INVU and any organization without a profile keep CRC / es-CR exactly as before', () => {
    expect(DEFAULT_TENANT_LOCALE).toEqual({ currency: 'CRC', intlLocale: 'es-CR' });
    expect(resolveTenantLocale(null)).toEqual(DEFAULT_TENANT_LOCALE);
    expect(resolveTenantLocale({ currency: null, locale: null })).toEqual(DEFAULT_TENANT_LOCALE);
    expect(resolveTenantLocale({ currency: 'CRC', locale: 'es-CR' })).toEqual(DEFAULT_TENANT_LOCALE);
    expect(plain(formatMoneyCode(850_000, 'CRC', DEFAULT_TENANT_LOCALE.intlLocale))).toBe('CRC 850 000');
  });

  it('a Guatemalan organization defaults to GTQ and formats with es-GT', () => {
    const gt = resolveTenantLocale({ currency: 'GTQ', locale: 'es-GT' });
    expect(gt).toEqual({ currency: 'GTQ', intlLocale: 'es-GT' });
    expect(defaultOfferCurrency(null, gt.currency)).toBe('GTQ');
    expect(defaultOfferCurrency('usd', gt.currency)).toBe('USD'); // the vacancy's own currency still wins
    expect(plain(formatMoneyCode(8_500.5, 'GTQ', gt.intlLocale))).toBe('GTQ 8,500.50');
  });

  it('falls back per field on an unusable value', () => {
    expect(resolveTenantLocale({ currency: 'quetzal', locale: 'es-GT' })).toEqual({
      currency: 'CRC',
      intlLocale: 'es-GT',
    });
    expect(resolveTenantLocale({ currency: 'gtq', locale: 'es_GT' })).toEqual({ currency: 'GTQ', intlLocale: 'es-CR' });
    expect(defaultOfferCurrency(null)).toBe('CRC');
  });
});
