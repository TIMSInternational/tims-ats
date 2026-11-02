// Tenant locale defaults for the web app.
//
// TODO(tenant-locale-profile): replace with the tenant's locale profile (currency, timezone,
// country) once organizations carry one. Until then the closed pilot tenant (Costa Rica) is the
// default — change it here, in one place.
export const DEFAULT_TENANT_CURRENCY = 'CRC';

/** The offer currency defaults to the vacancy's own currency, else the tenant default. */
export function defaultOfferCurrency(vacancyCurrency: string | null | undefined): string {
  const code = (vacancyCurrency ?? '').trim().toUpperCase();
  return code || DEFAULT_TENANT_CURRENCY;
}
