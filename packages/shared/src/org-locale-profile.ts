// ---------------------------------------------------------------------------
// An organization's locale profile: country, time zone, currency and number locale
// ---------------------------------------------------------------------------
// Stored as four keys of `organizations.settings` (`country`, `timezone`, `currency`, `locale`) — the same
// keys every reader already resolves (interview and invitation emails, offer and vacancy currency defaults,
// the "Datos de la organización" card) — and, at creation, on the default company row (country, currency,
// timezone). Picking a country fills in the other three from its preset; each stays editable.
//
// Mirrored in C# by Tims.Application.PlatformOrganizations.OrgLocaleProfileRules (same presets, same rules);
// tests/organization/org-locale-profile.test.ts pins the two preset tables equal.

import { z } from 'zod';
import { isValidTimeZone } from './time-zone';
import { isListedCurrencyCode } from './constants/currencies';

export interface OrgLocaleProfile {
  /** ISO 3166-1 alpha-2, upper case ("GT"). */
  country: string;
  /** IANA zone ("America/Guatemala"). */
  timezone: string;
  /** ISO 4217 ("GTQ"). */
  currency: string;
  /** BCP 47 language[-REGION] used for number and money formatting ("es-GT"). */
  locale: string;
}

/** The countries the creation form offers as presets, in display order. Anything else is "Other". */
export const ORG_COUNTRY_PRESETS: readonly OrgLocaleProfile[] = [
  { country: 'CR', timezone: 'America/Costa_Rica', currency: 'CRC', locale: 'es-CR' },
  { country: 'GT', timezone: 'America/Guatemala', currency: 'GTQ', locale: 'es-GT' },
  { country: 'HN', timezone: 'America/Tegucigalpa', currency: 'HNL', locale: 'es-HN' },
  { country: 'SV', timezone: 'America/El_Salvador', currency: 'USD', locale: 'es-SV' },
  { country: 'NI', timezone: 'America/Managua', currency: 'NIO', locale: 'es-NI' },
  // Panama's balboa is pegged 1:1 and salaries are quoted in US dollars.
  { country: 'PA', timezone: 'America/Panama', currency: 'USD', locale: 'es-PA' },
  { country: 'DO', timezone: 'America/Santo_Domingo', currency: 'DOP', locale: 'es-DO' },
  { country: 'MX', timezone: 'America/Mexico_City', currency: 'MXN', locale: 'es-MX' },
  { country: 'CO', timezone: 'America/Bogota', currency: 'COP', locale: 'es-CO' },
  { country: 'PE', timezone: 'America/Lima', currency: 'PEN', locale: 'es-PE' },
  { country: 'CL', timezone: 'America/Santiago', currency: 'CLP', locale: 'es-CL' },
  { country: 'US', timezone: 'America/New_York', currency: 'USD', locale: 'en-US' },
];

const COUNTRY_CODE = /^[A-Z]{2}$/;
const LOCALE_TAG = /^[a-z]{2}(-[A-Z]{2})?$/;

/** The preset for `country`, or null when it is not one of the offered countries. */
export function orgCountryPreset(country: string | null | undefined): OrgLocaleProfile | null {
  return ORG_COUNTRY_PRESETS.find((preset) => preset.country === country) ?? null;
}

export function isOrgCountryCode(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_CODE.test(value);
}

export function isOrgLocaleTag(value: unknown): value is string {
  return typeof value === 'string' && LOCALE_TAG.test(value);
}

/** An ISO 4217 code from the platform's currency list (the same list C# CurrencyCodes holds). */
export function isOrgCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && isListedCurrencyCode(value);
}

/** A usable IANA zone, bounded at 64 characters (the same check every time-zone reader applies). */
export function isOrgTimeZone(value: unknown): value is string {
  return isValidTimeZone(value);
}

const country = z.string().max(2).refine(isOrgCountryCode, 'country must be an ISO 3166-1 alpha-2 code');
const timezone = z.string().max(64).refine(isOrgTimeZone, 'timezone must be a valid IANA time zone');
const currency = z.string().max(3).refine(isOrgCurrencyCode, 'currency must be an ISO 4217 code');
const locale = z.string().max(5).refine(isOrgLocaleTag, 'locale must look like es-CR');

/** A complete profile, as the organization-creation forms send it. All four keys, nothing else. */
export const orgLocaleProfileSchema = z.object({ country, timezone, currency, locale }).strict();

/**
 * A partial profile for the platform owner's edit: each key optional, the same rules. It is MERGED into
 * `organizations.settings` — the keys it does not name (candidateContactEmail and any other) are kept.
 * Declaration order (locale, timezone, currency, country) is the audit `changes` key order C# reproduces.
 */
export const orgLocaleSettingsPatchSchema = z
  .object({
    locale: locale.optional(),
    timezone: timezone.optional(),
    currency: currency.optional(),
    country: country.optional(),
  })
  .strict();

export type OrgLocaleSettingsPatch = z.infer<typeof orgLocaleSettingsPatchSchema>;

/** `organizations.settings.locale` when it is a well-formed tag Intl can format with, else null. */
export function orgSettingsLocale(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>).locale;
  if (!isOrgLocaleTag(value)) return null;
  try {
    return Intl.NumberFormat.supportedLocalesOf([value]).length === 1 ? value : null;
  } catch {
    return null;
  }
}

/** The `organizations.settings` object a new organization starts with when a profile is chosen. */
export function orgLocaleSettings(profile: OrgLocaleProfile): Record<string, string> {
  return {
    country: profile.country,
    timezone: profile.timezone,
    currency: profile.currency,
    locale: profile.locale,
  };
}

/**
 * `settings` with the patch's keys written over it and every other key kept — the TypeScript twin of the
 * C# `settings || patch` (jsonb concatenation). A settings value that is not a JSON object (never written
 * by the product) is treated as empty, exactly as the SQL side does.
 */
export function mergeOrgSettings(settings: unknown, patch: OrgLocaleSettingsPatch): Record<string, unknown> {
  const base =
    settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}
