// The "País y formato regional" fields of the platform owner's organization forms (create, invite, edit).
// Pure (no React) so node tests cover it. Picking a preset country fills in time zone, currency and number
// locale from the shared preset table (packages/shared org-locale-profile.ts); each stays editable.
// "Other" keeps the current three and asks for the ISO country code.

import {
  ORG_COUNTRY_PRESETS,
  isOrgCountryCode,
  isOrgCurrencyCode,
  isOrgLocaleTag,
  isOrgTimeZone,
  orgCountryPreset,
  type OrgLocaleProfile,
  type OrgLocaleSettingsPatch,
} from '@tims/shared';

/** '' = not chosen yet, a preset country code, or OTHER_COUNTRY. */
export const OTHER_COUNTRY = 'OTHER';

export interface OrgLocaleForm {
  choice: string;
  country: string;
  timezone: string;
  currency: string;
  locale: string;
}

export const EMPTY_ORG_LOCALE_FORM: OrgLocaleForm = { choice: '', country: '', timezone: '', currency: '', locale: '' };

/** The preset country codes, in the order the select lists them. */
export const PRESET_COUNTRY_CODES: readonly string[] = ORG_COUNTRY_PRESETS.map((preset) => preset.country);

export function applyCountryChoice(form: OrgLocaleForm, choice: string): OrgLocaleForm {
  const preset = orgCountryPreset(choice);
  if (preset) return { choice, ...preset };
  if (choice === OTHER_COUNTRY)
    return { ...form, choice, country: PRESET_COUNTRY_CODES.includes(form.country) ? '' : form.country };
  return { ...EMPTY_ORG_LOCALE_FORM };
}

/** Upper-cases and strips anything but letters, at most two (the "Other" country code input). */
export function sanitizeCountryCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2);
}

/** The complete profile the create forms send, or null while any field is missing or invalid. */
export function orgLocaleFormToProfile(form: OrgLocaleForm): OrgLocaleProfile | null {
  if (!isOrgCountryCode(form.country) || !isOrgTimeZone(form.timezone)) return null;
  if (!isOrgCurrencyCode(form.currency) || !isOrgLocaleTag(form.locale)) return null;
  return { country: form.country, timezone: form.timezone, currency: form.currency, locale: form.locale };
}

function settingsValue(settings: unknown, key: string): string {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return '';
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The edit form's starting values: the organization's own settings, else its primary company's columns
 * (what the product falls back to today), so the owner sees the values in use.
 */
export function orgLocaleFormFromOrg(
  settings: unknown,
  company: { country?: string | null; currency?: string | null; timezone?: string | null } | null | undefined,
): OrgLocaleForm {
  const country = settingsValue(settings, 'country') || (company?.country ?? '').trim();
  const timezone = settingsValue(settings, 'timezone') || (company?.timezone ?? '').trim();
  const currency = settingsValue(settings, 'currency') || (company?.currency ?? '').trim();
  const locale = settingsValue(settings, 'locale');
  const choice = !country ? '' : PRESET_COUNTRY_CODES.includes(country) ? country : OTHER_COUNTRY;
  return { choice, country, timezone, currency, locale };
}

/**
 * Only the keys the owner changed, each valid — merged server-side into settings, so every other key
 * (candidateContactEmail, ...) is kept. `null` = a changed value is invalid (block saving); `{}` = nothing
 * changed (send no settings at all).
 */
export function orgLocalePatch(initial: OrgLocaleForm, form: OrgLocaleForm): OrgLocaleSettingsPatch | null {
  const patch: OrgLocaleSettingsPatch = {};
  if (form.locale !== initial.locale) {
    if (!isOrgLocaleTag(form.locale)) return null;
    patch.locale = form.locale;
  }
  if (form.timezone !== initial.timezone) {
    if (!isOrgTimeZone(form.timezone)) return null;
    patch.timezone = form.timezone;
  }
  if (form.currency !== initial.currency) {
    if (!isOrgCurrencyCode(form.currency)) return null;
    patch.currency = form.currency;
  }
  if (form.country !== initial.country) {
    if (!isOrgCountryCode(form.country)) return null;
    patch.country = form.country;
  }
  return patch;
}

/** The number-locale choices: every preset's, plus the current value when it is another valid tag. */
export function localeOptions(current: string): string[] {
  const tags = [...new Set(ORG_COUNTRY_PRESETS.map((preset) => preset.locale))];
  if (current && isOrgLocaleTag(current) && !tags.includes(current)) tags.unshift(current);
  return tags;
}
