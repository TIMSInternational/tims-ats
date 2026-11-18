import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ORG_COUNTRY_PRESETS,
  POPULAR_CURRENCY_CODES,
  isCurrencyCode,
  isOrgCountryCode,
  isOrgCurrencyCode,
  isOrgLocaleTag,
  isOrgTimeZone,
  mergeOrgSettings,
  orgCountryPreset,
  orgLocaleProfileSchema,
  orgLocaleSettings,
  orgLocaleSettingsPatchSchema,
  orgSettingsLocale,
  timeZoneLabel,
} from '@tims/shared';
import { blockAt } from '../helpers/source-blocks';

// The organization locale profile (country, time zone, currency, number locale) that "Invitar organización",
// "Nueva organización" and the platform owner's edit write — and the pins that keep the C# twin
// (Tims.Application.PlatformOrganizations.OrgLocaleProfileRules) identical.

const CS = (path: string) => readFileSync(join(__dirname, '../../services/Tims.Platform/src', path), 'utf8');
const GUATEMALA = { country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' };

describe('country presets', () => {
  it('offers the pilot countries, Costa Rica first, each preset valid by every rule', () => {
    expect(ORG_COUNTRY_PRESETS.map((p) => p.country)).toEqual([
      'CR',
      'GT',
      'HN',
      'SV',
      'NI',
      'PA',
      'DO',
      'MX',
      'CO',
      'PE',
      'CL',
      'US',
    ]);
    for (const preset of ORG_COUNTRY_PRESETS) {
      expect(orgLocaleProfileSchema.safeParse(preset).success, preset.country).toBe(true);
    }
    expect(orgCountryPreset('GT')).toEqual(GUATEMALA);
    expect(orgCountryPreset('CR')).toEqual({
      country: 'CR',
      timezone: 'America/Costa_Rica',
      currency: 'CRC',
      locale: 'es-CR',
    });
    expect(orgCountryPreset('AR')).toBeNull();
  });

  it('parity pin: the C# preset table is the same twelve rows in the same order', () => {
    const cs = CS('Tims.Application/PlatformOrganizations/OrgLocaleProfile.cs');
    const rows = [...cs.matchAll(/new\("([A-Z]{2})", "([^"]+)", "([A-Z]{3})", "([a-z]{2}-[A-Z]{2})"\)/g)].map(
      ([, country, timezone, currency, locale]) => ({ country, timezone, currency, locale }),
    );
    expect(rows).toEqual([...ORG_COUNTRY_PRESETS]);
  });

  it('every preset zone has a country-named label in both stacks (no "hora de Santiago")', () => {
    const at = new Date('2026-11-06T12:00:00Z');
    expect(timeZoneLabel('America/Guatemala', 'es', at)).toBe('hora de Guatemala (GMT-6)');
    expect(timeZoneLabel('America/Santiago', 'es', at)).toBe('hora de Chile (GMT-3)');
    const cs = CS('Tims.Domain/Localization/ZonedDateTimeText.cs');
    for (const zone of ['America/Guatemala', 'America/Tegucigalpa', 'America/Managua', 'America/Santiago']) {
      expect(cs, zone).toContain(`["${zone}"]`);
    }
  });
});

describe('validation rules', () => {
  it('accepts only listed ISO 4217 codes — stricter than Intl, which formats any well-formed code', () => {
    expect(isCurrencyCode('XYZ')).toBe(true); // why isOrgCurrencyCode exists
    expect(isOrgCurrencyCode('XYZ')).toBe(false);
    for (const code of ['GTQ', 'HNL', 'NIO', 'PAB', 'DOP', 'PEN', 'CLP', 'CRC', 'USD']) {
      expect(isOrgCurrencyCode(code), code).toBe(true);
    }
    expect(isOrgCurrencyCode('gtq')).toBe(false);
  });

  it('parity pin: the TS currency list is exactly C# CurrencyCodes.KnownCurrencyCodes', () => {
    const cs = CS('Tims.Domain/Compensation/CurrencyCodes.cs');
    const block = blockAt(cs, 'KnownCurrencyCodes = new', { minLines: 10 });
    const codes = [...block.matchAll(/"([A-Z]{3})"/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(150);
    for (const code of codes) expect(isOrgCurrencyCode(code), code).toBe(true);
    for (const code of ['XYZ', 'XXX', 'ABC']) expect(codes).not.toContain(code);
  });

  it('country, locale and zone shapes', () => {
    expect(isOrgCountryCode('GT')).toBe(true);
    for (const bad of ['gt', 'GTM', 'G', 'GT\n', 42]) expect(isOrgCountryCode(bad)).toBe(false);
    expect(isOrgLocaleTag('es-GT')).toBe(true);
    expect(isOrgLocaleTag('es')).toBe(true);
    for (const bad of ['es_GT', 'ES-GT', 'es-gt', 'es-GT\n', 'spanish']) expect(isOrgLocaleTag(bad)).toBe(false);
    expect(isOrgTimeZone('America/Guatemala')).toBe(true);
    expect(isOrgTimeZone('Mars/Olympus')).toBe(false);
    expect(isOrgTimeZone('x'.repeat(65))).toBe(false);
  });

  it('the creation schema needs all four keys and nothing else', () => {
    expect(orgLocaleProfileSchema.safeParse(GUATEMALA).success).toBe(true);
    expect(orgLocaleProfileSchema.safeParse({ ...GUATEMALA, extra: 'x' }).success).toBe(false);
    expect(orgLocaleProfileSchema.safeParse({ ...GUATEMALA, locale: undefined }).success).toBe(false);
    expect(orgLocaleProfileSchema.safeParse({ ...GUATEMALA, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(orgLocaleProfileSchema.safeParse({ ...GUATEMALA, currency: 'XYZ' }).success).toBe(false);
    expect(orgLocaleProfileSchema.safeParse(null).success).toBe(false);
  });

  it('the edit patch takes any subset, the same rules, and rejects unknown keys', () => {
    expect(orgLocaleSettingsPatchSchema.safeParse({}).success).toBe(true);
    expect(orgLocaleSettingsPatchSchema.safeParse({ country: 'GT' }).success).toBe(true);
    expect(orgLocaleSettingsPatchSchema.safeParse({ candidateContactEmail: 'x@y.z' }).success).toBe(false);
    expect(orgLocaleSettingsPatchSchema.safeParse({ currency: 'gtq' }).success).toBe(false);
  });
});

describe('settings writes', () => {
  it('a new organization starts with exactly the four profile keys', () => {
    expect(orgLocaleSettings(GUATEMALA)).toEqual(GUATEMALA);
  });

  it('the edit MERGES: candidateContactEmail and every other key survive', () => {
    const stored = {
      candidateContactEmail: 'talento@acme.test',
      locale: 'es-CR',
      timezone: 'America/Costa_Rica',
      x: { y: 1 },
    };
    expect(mergeOrgSettings(stored, { timezone: 'America/Guatemala', country: 'GT', currency: undefined })).toEqual({
      candidateContactEmail: 'talento@acme.test',
      locale: 'es-CR',
      timezone: 'America/Guatemala',
      country: 'GT',
      x: { y: 1 },
    });
    expect(stored.timezone).toBe('America/Costa_Rica'); // not mutated
    // A non-object stored value is treated as empty, exactly like the C# `settings || patch`.
    expect(mergeOrgSettings(['legacy'], { locale: 'es-GT' })).toEqual({ locale: 'es-GT' });
    expect(mergeOrgSettings(null, {})).toEqual({});
  });

  it('orgSettingsLocale reads a usable locale only', () => {
    expect(orgSettingsLocale({ locale: 'es-GT' })).toBe('es-GT');
    expect(orgSettingsLocale({ locale: 'xx-YY' })).toBeNull();
    expect(orgSettingsLocale({ locale: 'es_GT' })).toBeNull();
    expect(orgSettingsLocale({})).toBeNull();
    expect(orgSettingsLocale(['es-GT'])).toBeNull();
  });
});

describe('currencies of the pilot countries', () => {
  it('are popular (top of every currency picker) and pinned by the FX refresh from cold start', () => {
    const cs = CS('Tims.Application/Fx/RefreshFxRatesUseCase.cs');
    const seed = blockAt(cs, 'SeedQuoteCurrencies =', { minLines: 2 });
    for (const code of ['GTQ', 'HNL', 'NIO', 'PAB', 'DOP', 'PEN', 'CLP']) {
      expect(POPULAR_CURRENCY_CODES, code).toContain(code);
      expect(seed, code).toContain(`"${code}"`);
    }
    // Every preset currency except the base (USD) is seeded.
    for (const { currency } of ORG_COUNTRY_PRESETS)
      if (currency !== 'USD') expect(seed, currency).toContain(`"${currency}"`);
  });
});
