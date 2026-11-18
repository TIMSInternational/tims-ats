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
import { projectOrganizationProfile } from '../../packages/api/src/services/organization-profile';
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
      borrowed: { timezone: true, currency: true, country: true },
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
    ).toEqual({
      choice: 'GT',
      country: 'GT',
      timezone: 'America/Guatemala',
      currency: 'GTQ',
      locale: 'es-GT',
      borrowed: { timezone: false, currency: false, country: false },
    });
    expect(orgLocaleFormFromOrg(null, { country: 'AR' }).choice).toBe(OTHER_COUNTRY);
    expect(orgLocaleFormFromOrg(null, null)).toEqual({
      ...EMPTY_ORG_LOCALE_FORM,
      borrowed: { timezone: false, currency: false, country: false },
    });
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
    // A save writes the values the form only borrowed from the company too (Codex round 3 on #424).
    expect(orgLocalePatch(initial, { ...initial, timezone: 'America/Costa_Rica' })).toEqual({
      timezone: 'America/Costa_Rica',
      currency: 'USD',
      country: 'CR',
    });
    // Selecting US with the legacy company USD default: the shown USD is saved, not silently dropped.
    expect(orgLocalePatch(initial, applyCountryChoice(initial, 'US'))).toMatchObject({ country: 'US', currency: 'USD' });
    // Values stored in settings are only sent when changed.
    const stored = orgLocaleFormFromOrg({ country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' }, null);
    expect(orgLocalePatch(stored, { ...stored, locale: 'es-CR' })).toEqual({ locale: 'es-CR' });
    expect(orgLocalePatch(initial, { ...initial, choice: OTHER_COUNTRY, country: 'A' })).toBeNull();
  });

  it('offers every preset locale plus a non-preset current value, and Chile in the zone picker', () => {
    expect(localeOptions('')).toContain('es-GT');
    expect(localeOptions('pt-BR')[0]).toBe('pt-BR');
    expect(COMMON_TIME_ZONES).toContain('America/Santiago');
  });
});

const own = (currency: string | null, locale: string | null) => ({
  currency,
  currencySource: currency === null ? null : ('organization' as const),
  locale,
  localeSource: locale === null ? null : ('organization' as const),
});

// organization.getCurrent's real projection, from the row shape it selects.
const projected = (settings: unknown, company?: { currency: string; language: string }) =>
  projectOrganizationProfile({
    id: 'org-1',
    name: 'Org',
    slug: 'org',
    logo: null,
    settings,
    billingEmail: null,
    companies: company ? [{ name: 'Org Co', country: 'CR', timezone: 'America/Bogota', ...company }] : [],
  });

describe('tenant locale (vacancy and offer defaults, money formatting)', () => {
  it('INVU and any organization without a profile keep CRC / es-CR exactly as before', () => {
    expect(DEFAULT_TENANT_LOCALE).toEqual({ currency: 'CRC', intlLocale: 'es-CR' });
    expect(resolveTenantLocale(null)).toEqual(DEFAULT_TENANT_LOCALE);
    expect(resolveTenantLocale(own(null, null))).toEqual(DEFAULT_TENANT_LOCALE);
    expect(resolveTenantLocale(own('CRC', 'es-CR'))).toEqual(DEFAULT_TENANT_LOCALE);
    expect(plain(formatMoneyCode(850_000, 'CRC', DEFAULT_TENANT_LOCALE.intlLocale))).toBe('CRC 850 000');
  });

  it('getCurrent → provider: a company fallback (legacy USD / "es" column defaults) never replaces CRC / es-CR', () => {
    // Codex review of #424 (P1): the projection falls back to the primary company, whose currency and
    // language are column defaults on every organization provisioned before the profile existed.
    const legacy = projected({}, { currency: 'USD', language: 'es' });
    expect(legacy).toMatchObject({ currency: 'USD', currencySource: 'company', locale: 'es', localeSource: 'company' });
    expect(resolveTenantLocale(legacy)).toEqual(DEFAULT_TENANT_LOCALE);
    expect(resolveTenantLocale(projected({}))).toEqual(DEFAULT_TENANT_LOCALE);
    // The organization's own profile wins over its company, field by field.
    expect(resolveTenantLocale(projected({ currency: 'GTQ', locale: 'es-GT' }, { currency: 'USD', language: 'es' }))).toEqual({
      currency: 'GTQ',
      intlLocale: 'es-GT',
    });
    expect(resolveTenantLocale(projected({ currency: 'GTQ' }, { currency: 'USD', language: 'es' }))).toEqual({
      currency: 'GTQ',
      intlLocale: 'es-CR',
    });
  });

  it('a Guatemalan organization defaults to GTQ and formats with es-GT', () => {
    const gt = resolveTenantLocale(own('GTQ', 'es-GT'));
    expect(gt).toEqual({ currency: 'GTQ', intlLocale: 'es-GT' });
    expect(defaultOfferCurrency(null, gt.currency)).toBe('GTQ');
    expect(defaultOfferCurrency('usd', gt.currency)).toBe('USD'); // the vacancy's own currency still wins
    expect(plain(formatMoneyCode(8_500.5, 'GTQ', gt.intlLocale))).toBe('GTQ 8,500.50');
  });

  it('falls back per field on an unusable value', () => {
    expect(resolveTenantLocale(own('quetzal', 'es-GT'))).toEqual({
      currency: 'CRC',
      intlLocale: 'es-GT',
    });
    expect(resolveTenantLocale(own('gtq', 'es_GT'))).toEqual({ currency: 'GTQ', intlLocale: 'es-CR' });
    expect(defaultOfferCurrency(null)).toBe('CRC');
  });
});

describe('currency picker (Codex round 4 on #424)', () => {
  it('offers only codes the org profile validation accepts', async () => {
    const { currencyOptions } = await import('../../apps/web/lib/currency-options');
    const { isOrgCurrencyCode } = await import('@tims/shared');
    const offered = currencyOptions().filter((o: { code: string }) => isOrgCurrencyCode(o.code));
    expect(offered.length).toBeGreaterThan(10);
    expect(offered.every((o: { code: string }) => isOrgCurrencyCode(o.code))).toBe(true);
    expect(offered.map((o: { code: string }) => o.code)).toEqual(expect.arrayContaining(['CRC', 'GTQ', 'USD']));
  });
});
