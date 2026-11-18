// Display helpers for the "Datos de la organización" card (audit finding D-11). Pure (Intl only) so node
// tests can exercise them. Every helper returns null for a missing value so the card can say "No
// configurado" instead of printing a raw code or "undefined".

type UiLocale = 'es' | 'en';

function displayName(type: 'region' | 'currency' | 'language', code: string, locale: UiLocale): string | null {
  try {
    return new Intl.DisplayNames([locale], { type }).of(code) ?? null;
  } catch {
    return null;
  }
}

/** "Costa Rica (CR)". */
export function countryLabel(code: string | null | undefined, locale: UiLocale): string | null {
  if (!code) return null;
  const name = displayName('region', code, locale);
  return name && name !== code ? `${name} (${code})` : code;
}

/** "CRC · colón costarricense". */
export function currencyLabel(code: string | null | undefined, locale: UiLocale): string | null {
  if (!code) return null;
  const name = displayName('currency', code, locale);
  return name && name !== code ? `${code} · ${name}` : code;
}

/** "español (Costa Rica)". */
export function languageLabel(tag: string | null | undefined, locale: UiLocale): string | null {
  if (!tag) return null;
  return displayName('language', tag, locale) ?? tag;
}

/** The public careers page of an organization, on the current origin. */
export function careersPageUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, '')}/careers/${encodeURIComponent(slug)}`;
}
