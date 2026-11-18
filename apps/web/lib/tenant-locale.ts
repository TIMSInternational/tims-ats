// Tenant locale for the web app: the organization's own currency and number locale (its locale profile,
// `organizations.settings.currency` / `.locale`, as organization.getCurrent reports them — never the primary
// company's columns it falls back to), else the closed pilot tenant's (Costa Rica) when the organization has
// none or it has not loaded yet. Pure, so node tests cover it; components read it through
// lib/tenant-locale-context.tsx.

/** The currency a vacancy or offer starts with when the organization has none configured. */
export const DEFAULT_TENANT_CURRENCY = 'CRC';

/**
 * The Intl locale money and number formats use when the organization has none configured (es-CR:
 * "₡1 000 000", digits grouped with a non-breaking space). Never es-CO or en-US by default.
 */
export const TENANT_LOCALE = 'es-CR';

export interface TenantLocale {
  /** ISO 4217 default currency for new vacancies and offers. */
  currency: string;
  /** Intl locale for money and number formatting. */
  intlLocale: string;
}

export const DEFAULT_TENANT_LOCALE: TenantLocale = { currency: DEFAULT_TENANT_CURRENCY, intlLocale: TENANT_LOCALE };

const ISO_CURRENCY = /^[A-Z]{3}$/;
const LOCALE_TAG = /^[a-z]{2}(-[A-Z]{2})?$/;

function supportedLocale(tag: string): boolean {
  try {
    return Intl.NumberFormat.supportedLocalesOf([tag]).length === 1;
  } catch {
    return false;
  }
}

/** What organization.getCurrent says about the currency and locale, and where each came from. */
export interface TenantLocaleProfile {
  currency: string | null;
  currencySource: 'organization' | 'company' | null;
  locale: string | null;
  localeSource: 'organization' | 'company' | null;
}

/**
 * The organization's OWN currency and locale (its locale profile in `organizations.settings`) when they are
 * usable values, else the defaults (per field). A value organization.getCurrent took from the primary
 * company is ignored on purpose: those columns hold their defaults (USD, "es") on every organization
 * provisioned before the profile existed, so honouring them would silently move an organization without a
 * profile off CRC / es-CR.
 */
export function resolveTenantLocale(profile: TenantLocaleProfile | null | undefined): TenantLocale {
  const currency = profile?.currencySource === 'organization' ? (profile.currency?.trim().toUpperCase() ?? '') : '';
  const locale = profile?.localeSource === 'organization' ? (profile.locale?.trim() ?? '') : '';
  return {
    currency: ISO_CURRENCY.test(currency) ? currency : DEFAULT_TENANT_CURRENCY,
    intlLocale: LOCALE_TAG.test(locale) && supportedLocale(locale) ? locale : TENANT_LOCALE,
  };
}

/** The offer currency defaults to the vacancy's own currency, else the tenant's. */
export function defaultOfferCurrency(
  vacancyCurrency: string | null | undefined,
  tenantCurrency: string = DEFAULT_TENANT_CURRENCY,
): string {
  const code = (vacancyCurrency ?? '').trim().toUpperCase();
  return code || tenantCurrency;
}
