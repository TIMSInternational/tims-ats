// ---------------------------------------------------------------------------
// The organization's locale profile, as an admin should see it (pure)
// ---------------------------------------------------------------------------
// Country, currency, time zone and language live in two places: `organizations.settings` (jsonb keys
// `currency`, `timezone`, `locale`, `candidateContactEmail`) and the organization's companies (`country`,
// `currency`, `timezone`, `language`). Interview emails resolve the zone organization → company → UTC
// (packages/shared/src/time-zone.ts); this projection follows the same order so the "Datos de la
// organización" card shows the values the product actually uses (audit finding D-11). Every value is
// validated and bounded: a malformed stored value is shown as "not configured", never echoed raw.

import { orgSettingsTimeZone, isValidTimeZone } from '@tims/shared';
import { candidateContactEmail } from './candidate-contact';

export type ProfileSource = 'organization' | 'company' | null;

export interface OrganizationProfileInput {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  settings: unknown;
  billingEmail: string | null;
  /** Active companies, oldest first. The first one is the organization's primary company. */
  companies: readonly { name: string; country: string; currency: string; timezone: string; language: string }[];
}

export interface OrganizationProfile {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  country: string | null;
  currency: string | null;
  currencySource: ProfileSource;
  timeZone: string | null;
  timeZoneSource: ProfileSource;
  locale: string | null;
  candidateContactEmail: string | null;
  companyName: string | null;
}

const CURRENCY = /^[A-Z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;

function settingsString(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length <= 64 ? value.trim() : null;
}

function matching(value: string | null | undefined, pattern: RegExp): string | null {
  return value && pattern.test(value) ? value : null;
}

export function projectOrganizationProfile(org: OrganizationProfileInput): OrganizationProfile {
  const company = org.companies[0] ?? null;

  const orgCurrency = matching(settingsString(org.settings, 'currency'), CURRENCY);
  const companyCurrency = matching(company?.currency, CURRENCY);
  const orgTimeZone = orgSettingsTimeZone(org.settings);
  const companyTimeZone = isValidTimeZone(company?.timezone) ? (company?.timezone ?? null) : null;
  const locale = matching(settingsString(org.settings, 'locale'), LOCALE) ?? matching(company?.language, LOCALE);

  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo,
    country: matching(company?.country, COUNTRY),
    currency: orgCurrency ?? companyCurrency,
    currencySource: orgCurrency ? 'organization' : companyCurrency ? 'company' : null,
    timeZone: orgTimeZone ?? companyTimeZone,
    timeZoneSource: orgTimeZone ? 'organization' : companyTimeZone ? 'company' : null,
    locale,
    candidateContactEmail: candidateContactEmail({ settings: org.settings, billingEmail: org.billingEmail }),
    companyName: company?.name ?? null,
  };
}
