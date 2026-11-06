// Tenant locale for the web app: the organization's own currency and number locale (its locale profile,
// `organizations.settings.currency` / `.locale`, as organization.getCurrent resolves them), falling back to
// the closed pilot tenant's (Costa Rica) when the organization has none or it has not loaded yet. Pure, so
// node tests cover it; components read it through lib/use-tenant-locale.ts.

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

/** The organization's currency and locale when they are usable values, else the defaults (per field). */
export function resolveTenantLocale(
  profile: { currency?: string | null; locale?: string | null } | null | undefined,
): TenantLocale {
  const currency = profile?.currency?.trim().toUpperCase() ?? '';
  const locale = profile?.locale?.trim() ?? '';
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
