// The currency an offer gets when the caller sends none (Pilot UX re-audit, company-admin data-62): the
// organization's own currency (`organizations.settings.currency`), then the vacancy company's currency, and
// only then the legacy 'USD'. The web form always sends a currency; this default protects every other caller
// from storing USD for a tenant that pays in another currency.

export const LEGACY_OFFER_CURRENCY = 'USD';

const ISO_CURRENCY = /^[A-Z]{3}$/;

function isoCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return ISO_CURRENCY.test(code) ? code : null;
}

/** `organizations.settings.currency` when it is an ISO-4217-shaped code, else null. */
export function orgSettingsCurrency(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  return isoCode((settings as Record<string, unknown>).currency);
}

export function resolveDefaultOfferCurrency(orgSettings: unknown, companyCurrency?: string | null): string {
  return orgSettingsCurrency(orgSettings) ?? isoCode(companyCurrency) ?? LEGACY_OFFER_CURRENCY;
}
